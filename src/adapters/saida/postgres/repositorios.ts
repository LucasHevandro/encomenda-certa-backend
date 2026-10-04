import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  AlteracaoProducao,
  ClienteEncontrado,
  ClienteRepo,
  DiaRepo,
  EsperaRepo,
  FechamentoRepo,
  FiltroPedidos,
  PedidoRepo,
  ProducaoRepo,
  ProdutoRepo,
  Repositorios,
  SugestaoProducao,
  Usuario,
  UsuarioRepo,
} from '../../../application/portas/repositorios.js';
import { centavos, type Dinheiro } from '../../../domain/compartilhado/Dinheiro.js';
import type { DiaVenda } from '../../../domain/dia-venda/DiaVenda.js';
import type { EstoqueDoProduto } from '../../../domain/disponibilidade/Disponibilidade.js';
import type { FechamentoDoProduto } from '../../../domain/fechamento/Fechamento.js';
import type { EntradaEspera } from '../../../domain/lista-espera/EntradaEspera.js';
import type { Pagamento, Pedido, Retirada } from '../../../domain/pedido/Pedido.js';
import type { Produto } from '../../../domain/produto/Produto.js';
import * as t from './schema.js';

export type BancoDrizzle = NodePgDatabase<typeof t>;
/** O banco ou uma transação aberta: os repositórios funcionam igual nos dois. */
export type Banco = BancoDrizzle | Parameters<Parameters<BancoDrizzle['transaction']>[0]>[0];

const paraProduto = (p: typeof t.produto.$inferSelect): Produto => ({ id: p.id, nome: p.nome, preco: centavos(p.precoAtual), ativo: p.ativo });
const paraDia = (d: typeof t.diaVenda.$inferSelect): DiaVenda => ({ id: d.id, data: d.data, status: d.status });

class UsuariosPg implements UsuarioRepo {
  constructor(private readonly db: Banco) {}

  async porEmail(email: string) {
    const [u] = await this.db.select().from(t.usuario).where(eq(t.usuario.email, email));
    return u ? { id: u.id, nome: u.nome, email: u.email, senhaHash: u.senhaHash } : null;
  }

  async porId(id: string): Promise<Usuario | null> {
    const [u] = await this.db.select().from(t.usuario).where(eq(t.usuario.id, id));
    return u ? { id: u.id, nome: u.nome, email: u.email } : null;
  }

  async criar(usuario: { nome: string; email: string; senhaHash: string }): Promise<Usuario> {
    const [u] = await this.db.insert(t.usuario).values(usuario).returning();
    return { id: u.id, nome: u.nome, email: u.email };
  }
}

class ProdutosPg implements ProdutoRepo {
  constructor(private readonly db: Banco) {}

  async listar() {
    return (await this.db.select().from(t.produto).orderBy(asc(t.produto.nome))).map(paraProduto);
  }

  async porIds(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return (await this.db.select().from(t.produto).where(inArray(t.produto.id, [...ids]))).map(paraProduto);
  }

  async criar(produto: { nome: string; preco: Dinheiro }) {
    const [p] = await this.db.insert(t.produto).values({ nome: produto.nome, precoAtual: produto.preco }).returning();
    return paraProduto(p);
  }

  async atualizar(id: string, mudancas: { preco?: Dinheiro; ativo?: boolean }) {
    const [p] = await this.db
      .update(t.produto)
      .set({ ...(mudancas.preco != null && { precoAtual: mudancas.preco }), ...(mudancas.ativo != null && { ativo: mudancas.ativo }) })
      .where(eq(t.produto.id, id))
      .returning();
    return p ? paraProduto(p) : null;
  }
}

class DiasPg implements DiaRepo {
  constructor(private readonly db: Banco) {}

  async listar() {
    return (await this.db.select().from(t.diaVenda).orderBy(asc(t.diaVenda.data))).map(paraDia);
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(eq(t.diaVenda.id, id));
    return d ? paraDia(d) : null;
  }

  async travar(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(eq(t.diaVenda.id, id)).for('update');
    return d ? paraDia(d) : null;
  }

  async travarParaEscrita(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(eq(t.diaVenda.id, id)).for('share');
    return d ? paraDia(d) : null;
  }

  async datas() {
    return (await this.db.select({ data: t.diaVenda.data }).from(t.diaVenda)).map((d) => d.data);
  }

  async criar(data: string) {
    const [d] = await this.db.insert(t.diaVenda).values({ data }).returning();
    return paraDia(d);
  }

  async encerrar(id: string, em: Date) {
    await this.db.update(t.diaVenda).set({ status: 'encerrado', fechadoEm: em }).where(eq(t.diaVenda.id, id));
  }
}

class ProducaoPg implements ProducaoRepo {
  constructor(private readonly db: Banco) {}

  /** Disponibilidade calculada, não digitada: produção menos itens de pedidos não cancelados. */
  async estoques(diaId: string, somente?: readonly string[]): Promise<EstoqueDoProduto[]> {
    if (!ehUuid(diaId)) return [];
    const filtro = somente ? sql`and p.produto_id in (${sql.join(somente.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
    const { rows } = await this.db.execute<{ produto_id: string; nome: string; producao: number; reservados: string; vendidos: string }>(sql`
      select p.produto_id, pr.nome, p.quantidade as producao,
        coalesce(sum(i.quantidade) filter (where pe.retirada = 'reservado'), 0) as reservados,
        coalesce(sum(i.quantidade) filter (where pe.retirada = 'retirado'), 0) as vendidos
      from producao p
      join produto pr on pr.id = p.produto_id
      left join pedido pe on pe.dia_id = p.dia_id and pe.retirada <> 'cancelado'
      left join pedido_item i on i.pedido_id = pe.id and i.produto_id = p.produto_id
      where p.dia_id = ${diaId} ${filtro}
      group by p.produto_id, pr.nome, p.quantidade
      order by pr.nome`);
    return rows.map((r) => ({
      produtoId: r.produto_id,
      nome: r.nome,
      producao: Number(r.producao),
      reservados: Number(r.reservados),
      vendidos: Number(r.vendidos),
    }));
  }

  /** SELECT … FOR UPDATE nas linhas de produção, sempre na ordem do id, para evitar travamento cruzado. */
  async travar(diaId: string, produtoIds: readonly string[]) {
    const ids = [...new Set(produtoIds)].sort();
    if (ids.length === 0 || !ehUuid(diaId)) return [];
    await this.db
      .select({ produtoId: t.producao.produtoId })
      .from(t.producao)
      .where(and(eq(t.producao.diaId, diaId), inArray(t.producao.produtoId, ids)))
      .orderBy(asc(t.producao.produtoId))
      .for('update');
    return this.estoques(diaId, ids);
  }

  async definir(diaId: string, produtoId: string, quantidade: number) {
    await this.db
      .insert(t.producao)
      .values({ diaId, produtoId, quantidade })
      .onConflictDoUpdate({ target: [t.producao.diaId, t.producao.produtoId], set: { quantidade } });
  }

  async registrarAlteracao(a: { diaId: string; produtoId: string; de: number; para: number; usuarioId: string; em: Date }) {
    await this.db.insert(t.producaoAlteracao).values(a);
  }

  async historico(diaId: string): Promise<AlteracaoProducao[]> {
    if (!ehUuid(diaId)) return [];
    const linhas = await this.db
      .select({ a: t.producaoAlteracao, usuario: t.usuario.nome })
      .from(t.producaoAlteracao)
      .innerJoin(t.usuario, eq(t.usuario.id, t.producaoAlteracao.usuarioId))
      .where(eq(t.producaoAlteracao.diaId, diaId))
      .orderBy(asc(t.producaoAlteracao.id));
    return linhas.map(({ a, usuario }) => ({ produtoId: a.produtoId, de: a.de, para: a.para, em: a.em.toISOString(), usuario }));
  }

  /** Das fotos dos últimos 4 dias fechados: último valor, média e sobra média por produto ativo. */
  async sugestao(): Promise<SugestaoProducao[]> {
    const { rows } = await this.db.execute<{ produto_id: string; nome: string; ultimo: number; media: string; sobra_media: string }>(sql`
      with ultimos as (
        select id, data from dia_venda where status = 'encerrado' order by data desc limit 4
      ), fotos as (
        select f.produto_id, f.produzidos, f.sobras, u.data,
          row_number() over (partition by f.produto_id order by u.data desc) as ordem
        from fechamento_produto f join ultimos u on u.id = f.dia_id
      )
      select f.produto_id, p.nome,
        max(f.produzidos) filter (where f.ordem = 1) as ultimo,
        round(avg(f.produzidos)) as media,
        round(avg(f.sobras)) as sobra_media
      from fotos f join produto p on p.id = f.produto_id
      where p.ativo
      group by f.produto_id, p.nome
      order by p.nome`);
    return rows.map((r) => ({ produtoId: r.produto_id, nome: r.nome, ultimo: Number(r.ultimo), media: Number(r.media), sobraMedia: Number(r.sobra_media) }));
  }
}

class PedidosPg implements PedidoRepo {
  constructor(private readonly db: Banco) {}

  async listar(diaId: string, filtro: FiltroPedidos = {}): Promise<Pedido[]> {
    if (!ehUuid(diaId)) return [];
    const condicoes = [eq(t.pedido.diaId, diaId)];
    if (filtro.retirada) condicoes.push(eq(t.pedido.retirada, filtro.retirada));
    const busca = filtro.busca?.trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      const termo = `%${busca.replace(/[%_\\]/g, '\\$&')}%`;
      condicoes.push(
        sql`(${t.cliente.nome} ilike ${termo}${digitos ? sql` or ${t.cliente.telefone} like ${`%${digitos}%`} or ${t.pedido.numero}::text like ${`%${Number(digitos)}%`}` : sql``})`,
      );
    }
    return this.montar(
      await this.db
        .select({ pedido: t.pedido, cliente: t.cliente })
        .from(t.pedido)
        .innerJoin(t.cliente, eq(t.cliente.id, t.pedido.clienteId))
        .where(and(...condicoes))
        .orderBy(desc(t.pedido.numero)),
    );
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    const linhas = await this.db
      .select({ pedido: t.pedido, cliente: t.cliente })
      .from(t.pedido)
      .innerJoin(t.cliente, eq(t.cliente.id, t.pedido.clienteId))
      .where(eq(t.pedido.id, id));
    return (await this.montar(linhas))[0] ?? null;
  }

  async travar(id: string) {
    if (!ehUuid(id)) return null;
    const [linha] = await this.db.select({ id: t.pedido.id }).from(t.pedido).where(eq(t.pedido.id, id)).for('update');
    return linha ? this.obter(id) : null;
  }

  async criar(novo: {
    diaId: string;
    clienteId: string;
    itens: readonly { produtoId: string; quantidade: number; precoUnitario: Dinheiro }[];
    usuarioId: string;
    em: Date;
  }) {
    const [p] = await this.db
      .insert(t.pedido)
      .values({ diaId: novo.diaId, clienteId: novo.clienteId, criadoPor: novo.usuarioId, criadoEm: novo.em })
      .returning({ id: t.pedido.id });
    await this.db.insert(t.pedidoItem).values(novo.itens.map((i) => ({ ...i, pedidoId: p.id })));
    return (await this.obter(p.id))!;
  }

  async substituirItens(id: string, itens: readonly { produtoId: string; quantidade: number; precoUnitario: Dinheiro }[]) {
    await this.db.delete(t.pedidoItem).where(eq(t.pedidoItem.pedidoId, id));
    if (itens.length) await this.db.insert(t.pedidoItem).values(itens.map((i) => ({ ...i, pedidoId: id })));
  }

  async mudarRetirada(id: string, retirada: Retirada, usuarioId: string, em: Date) {
    const quem =
      retirada === 'retirado' ? { retiradoPor: usuarioId, retiradoEm: em } : retirada === 'cancelado' ? { canceladoPor: usuarioId, canceladoEm: em } : {};
    await this.db
      .update(t.pedido)
      .set({ retirada, ...quem })
      .where(eq(t.pedido.id, id));
  }

  async mudarPagamento(id: string, pagamento: Pagamento) {
    await this.db.update(t.pedido).set({ pagamento }).where(eq(t.pedido.id, id));
  }

  private async montar(linhas: { pedido: typeof t.pedido.$inferSelect; cliente: typeof t.cliente.$inferSelect }[]): Promise<Pedido[]> {
    if (linhas.length === 0) return [];
    const itens = await this.db
      .select({ item: t.pedidoItem, nome: t.produto.nome })
      .from(t.pedidoItem)
      .innerJoin(t.produto, eq(t.produto.id, t.pedidoItem.produtoId))
      .where(
        inArray(
          t.pedidoItem.pedidoId,
          linhas.map((l) => l.pedido.id),
        ),
      )
      .orderBy(asc(t.produto.nome));
    return linhas.map(({ pedido, cliente }) => ({
      id: pedido.id,
      numero: pedido.numero,
      diaId: pedido.diaId,
      cliente: { nome: cliente.nome, ...(cliente.telefone && { telefone: cliente.telefone }) },
      itens: itens
        .filter((i) => i.item.pedidoId === pedido.id)
        .map((i) => ({ produtoId: i.item.produtoId, nome: i.nome, quantidade: i.item.quantidade, precoUnitario: centavos(i.item.precoUnitario) })),
      retirada: pedido.retirada,
      pagamento: pedido.pagamento,
    }));
  }
}

class ClientesPg implements ClienteRepo {
  constructor(private readonly db: Banco) {}

  async obterOuCriar(c: { nome: string; telefone?: string }) {
    if (!c.telefone) {
      const [novo] = await this.db.insert(t.cliente).values({ nome: c.nome }).returning({ id: t.cliente.id });
      return novo.id;
    }
    // Telefone é único: quem já comprou é reconhecido e o nome fica atualizado.
    const [linha] = await this.db
      .insert(t.cliente)
      .values({ nome: c.nome, telefone: c.telefone })
      .onConflictDoUpdate({ target: t.cliente.telefone, set: { nome: c.nome } })
      .returning({ id: t.cliente.id });
    return linha.id;
  }

  async porTelefone(telefone: string) {
    return (await this.consultar(eq(t.cliente.telefone, telefone)))[0] ?? null;
  }

  listar() {
    return this.consultar();
  }

  private async consultar(onde?: ReturnType<typeof eq>): Promise<ClienteEncontrado[]> {
    const linhas = await this.db
      .select({
        id: t.cliente.id,
        nome: t.cliente.nome,
        telefone: t.cliente.telefone,
        pedidos: sql<string>`count(${t.pedido.id})`,
      })
      .from(t.cliente)
      .leftJoin(t.pedido, and(eq(t.pedido.clienteId, t.cliente.id), ne(t.pedido.retirada, 'cancelado')))
      .where(onde)
      .groupBy(t.cliente.id)
      .orderBy(asc(t.cliente.nome));
    return linhas.map((l) => ({ id: l.id, nome: l.nome, ...(l.telefone && { telefone: l.telefone }), pedidosAnteriores: Number(l.pedidos) }));
  }
}

class EsperaPg implements EsperaRepo {
  constructor(private readonly db: Banco) {}

  async listar(diaId: string) {
    if (!ehUuid(diaId)) return [];
    return this.consultar(eq(t.listaEspera.diaId, diaId));
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    return (await this.consultar(eq(t.listaEspera.id, id)))[0] ?? null;
  }

  async adicionar(e: { diaId: string; produtoId: string; clienteId: string; quantidade: number }) {
    // A trava do dia (FOR SHARE) não impede duas entradas juntas; a posição é calculada na mesma instrução.
    const [nova] = await this.db
      .insert(t.listaEspera)
      .values({
        ...e,
        posicao: sql`(select coalesce(max(posicao), 0) + 1 from lista_espera where dia_id = ${e.diaId} and produto_id = ${e.produtoId})`,
      })
      .returning({ id: t.listaEspera.id });
    return (await this.obter(nova.id))!;
  }

  async mudarStatus(id: string, status: EntradaEspera['status']) {
    await this.db.update(t.listaEspera).set({ status }).where(eq(t.listaEspera.id, id));
    return (await this.obter(id))!;
  }

  private async consultar(onde: ReturnType<typeof eq>): Promise<EntradaEspera[]> {
    const linhas = await this.db
      .select({ e: t.listaEspera, cliente: t.cliente })
      .from(t.listaEspera)
      .innerJoin(t.cliente, eq(t.cliente.id, t.listaEspera.clienteId))
      .where(onde)
      .orderBy(asc(t.listaEspera.posicao));
    return linhas.map(({ e, cliente }) => ({
      id: e.id,
      diaId: e.diaId,
      produtoId: e.produtoId,
      cliente: { nome: cliente.nome, ...(cliente.telefone && { telefone: cliente.telefone }) },
      quantidade: e.quantidade,
      posicao: e.posicao,
      status: e.status,
    }));
  }
}

class FechamentosPg implements FechamentoRepo {
  constructor(private readonly db: Banco) {}

  async gravar(diaId: string, produtos: readonly FechamentoDoProduto[], faturamento: Dinheiro) {
    if (produtos.length) {
      await this.db.insert(t.fechamentoProduto).values(
        produtos.map((p) => ({
          diaId,
          produtoId: p.produtoId,
          produzidos: p.produzidos,
          reservados: p.reservados,
          retirados: p.retirados,
          naoRetirados: p.naoRetirados,
          sobras: p.sobras,
        })),
      );
    }
    await this.db.update(t.diaVenda).set({ faturamento }).where(eq(t.diaVenda.id, diaId));
  }

  async resumo(diaId: string) {
    const [dia] = await this.db.select({ faturamento: t.diaVenda.faturamento }).from(t.diaVenda).where(eq(t.diaVenda.id, diaId));
    if (dia?.faturamento == null) return null;
    const [soma] = await this.db
      .select({ sobras: sql<string>`coalesce(sum(${t.fechamentoProduto.sobras}), 0)` })
      .from(t.fechamentoProduto)
      .where(eq(t.fechamentoProduto.diaId, diaId));
    return { faturamento: centavos(dia.faturamento), sobras: Number(soma.sobras) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id que não é uuid não existe; evita erro de tipo do Postgres e responde 404. */
function ehUuid(id: string) {
  return UUID.test(id);
}

export function repositoriosPg(db: Banco): Repositorios {
  return {
    usuarios: new UsuariosPg(db),
    produtos: new ProdutosPg(db),
    dias: new DiasPg(db),
    producao: new ProducaoPg(db),
    pedidos: new PedidosPg(db),
    clientes: new ClientesPg(db),
    espera: new EsperaPg(db),
    fechamentos: new FechamentosPg(db),
  };
}
