import { and, asc, desc, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  AlteracaoProducao,
  ClienteEncontrado,
  ClienteRepo,
  ConfiguracaoRepo,
  DiaFechado,
  DiaRepo,
  Empresa,
  EmpresaRepo,
  EsperaRepo,
  FechamentoRepo,
  FiltroPedidos,
  PedidoRepo,
  ProducaoRepo,
  ProdutoRepo,
  Repositorios,
  SugestaoProducao,
  Usuario,
  UsuarioComEmpresa,
  UsuarioRepo,
} from '../../../application/portas/repositorios.js';
import { empresaAtual } from '../../../application/contextoDaEmpresa.js';
import { centavos, type Dinheiro } from '../../../domain/compartilhado/Dinheiro.js';
import type { Configuracao, FormaDePagamento } from '../../../domain/configuracao/Configuracao.js';
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

const paraProduto = (p: typeof t.produto.$inferSelect): Produto => ({
  id: p.id,
  nome: p.nome,
  preco: centavos(p.precoAtual),
  ativo: p.ativo,
});
const paraDia = (d: typeof t.diaVenda.$inferSelect): DiaVenda => ({
  id: d.id,
  data: d.data,
  status: d.status,
});

const paraUsuario = (u: typeof t.usuario.$inferSelect): Usuario => ({
  id: u.id,
  nome: u.nome,
  email: u.email,
  empresaId: u.empresaId,
});

class UsuariosPg implements UsuarioRepo {
  constructor(private readonly db: Banco) {}

  private async comEmpresa(onde: SQL) {
    const [linha] = await this.db
      .select({ u: t.usuario, ativa: t.empresa.ativa })
      .from(t.usuario)
      .leftJoin(t.empresa, eq(t.empresa.id, t.usuario.empresaId))
      .where(onde);
    return linha
      ? {
          ...paraUsuario(linha.u),
          empresaAtiva: linha.u.empresaId === null || linha.ativa === true,
          senhaHash: linha.u.senhaHash,
        }
      : null;
  }

  async porEmail(email: string) {
    return this.comEmpresa(eq(t.usuario.email, email));
  }

  async porId(id: string): Promise<UsuarioComEmpresa | null> {
    if (!ehUuid(id)) return null;
    const u = await this.comEmpresa(eq(t.usuario.id, id));
    if (!u) return null;
    const { senhaHash: _, ...semSenha } = u;
    return semSenha;
  }

  async criar(usuario: { nome: string; email: string; senhaHash: string }): Promise<Usuario> {
    const [u] = await this.db
      .insert(t.usuario)
      .values({ ...usuario, empresaId: empresaAtual() })
      .returning();
    return paraUsuario(u);
  }

  async listar(): Promise<Usuario[]> {
    return (await this.db.select().from(t.usuario).where(eq(t.usuario.empresaId, empresaAtual())).orderBy(asc(t.usuario.nome))).map(paraUsuario);
  }

  async senhaHash(id: string): Promise<string | null> {
    if (!ehUuid(id)) return null;
    const [u] = await this.db.select({ senhaHash: t.usuario.senhaHash }).from(t.usuario).where(eq(t.usuario.id, id));
    return u?.senhaHash ?? null;
  }

  async mudarSenha(id: string, senhaHash: string): Promise<void> {
    await this.db.update(t.usuario).set({ senhaHash }).where(eq(t.usuario.id, id));
  }
}

class ProdutosPg implements ProdutoRepo {
  constructor(private readonly db: Banco) {}

  async listar() {
    return (await this.db.select().from(t.produto).where(eq(t.produto.empresaId, empresaAtual())).orderBy(asc(t.produto.nome))).map(paraProduto);
  }

  async porIds(ids: readonly string[]) {
    const validos = ids.filter(ehUuid);
    if (validos.length === 0) return [];
    return (
      await this.db
        .select()
        .from(t.produto)
        .where(and(eq(t.produto.empresaId, empresaAtual()), inArray(t.produto.id, validos)))
    ).map(paraProduto);
  }

  async criar(produto: { nome: string; preco: Dinheiro }) {
    const [p] = await this.db
      .insert(t.produto)
      .values({
        empresaId: empresaAtual(),
        nome: produto.nome,
        precoAtual: produto.preco,
      })
      .returning();
    return paraProduto(p);
  }

  async atualizar(id: string, mudancas: { preco?: Dinheiro; ativo?: boolean }) {
    if (!ehUuid(id)) return null;
    const [p] = await this.db
      .update(t.produto)
      .set({
        ...(mudancas.preco != null && { precoAtual: mudancas.preco }),
        ...(mudancas.ativo != null && { ativo: mudancas.ativo }),
      })
      .where(and(eq(t.produto.id, id), eq(t.produto.empresaId, empresaAtual())))
      .returning();
    return p ? paraProduto(p) : null;
  }
}

/** O dia, se for da empresa do contexto. */
const doDia = (id: string) => and(eq(t.diaVenda.id, id), eq(t.diaVenda.empresaId, empresaAtual()));
/** O pedido, se for da empresa do contexto. */
const doPedido = (id: string) => and(eq(t.pedido.id, id), eq(t.pedido.empresaId, empresaAtual()));
/** Subconsulta com os dias da empresa do contexto, para as tabelas que pendem do dia. */
const diasDaEmpresa = () => sql`(select id from dia_venda where empresa_id = ${empresaAtual()})`;

class DiasPg implements DiaRepo {
  constructor(private readonly db: Banco) {}

  async listar() {
    return (await this.db.select().from(t.diaVenda).where(eq(t.diaVenda.empresaId, empresaAtual())).orderBy(asc(t.diaVenda.data))).map(paraDia);
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(doDia(id));
    return d ? paraDia(d) : null;
  }

  async travar(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(doDia(id)).for('update');
    return d ? paraDia(d) : null;
  }

  async travarParaEscrita(id: string) {
    if (!ehUuid(id)) return null;
    const [d] = await this.db.select().from(t.diaVenda).where(doDia(id)).for('share');
    return d ? paraDia(d) : null;
  }

  async datas() {
    return (await this.db.select({ data: t.diaVenda.data }).from(t.diaVenda).where(eq(t.diaVenda.empresaId, empresaAtual()))).map((d) => d.data);
  }

  async criar(data: string) {
    const [d] = await this.db.insert(t.diaVenda).values({ empresaId: empresaAtual(), data }).returning();
    return paraDia(d);
  }

  async encerrar(id: string, em: Date) {
    await this.db.update(t.diaVenda).set({ status: 'encerrado', fechadoEm: em }).where(doDia(id));
  }
}

class ProducaoPg implements ProducaoRepo {
  constructor(private readonly db: Banco) {}

  /** Disponibilidade calculada, não digitada: produção menos itens de pedidos não cancelados. */
  async estoques(diaId: string, somente?: readonly string[]): Promise<EstoqueDoProduto[]> {
    if (!ehUuid(diaId)) return [];
    const filtro = somente
      ? sql`and p.produto_id in (${sql.join(
          somente.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const { rows } = await this.db.execute<{
      produto_id: string;
      nome: string;
      producao: number;
      reservados: string;
      vendidos: string;
    }>(sql`
      select p.produto_id, pr.nome, p.quantidade as producao,
        coalesce(sum(i.quantidade) filter (where pe.retirada = 'reservado'), 0) as reservados,
        coalesce(sum(i.quantidade) filter (where pe.retirada = 'retirado'), 0) as vendidos
      from producao p
      join produto pr on pr.id = p.produto_id
      left join pedido pe on pe.dia_id = p.dia_id and pe.retirada <> 'cancelado'
      left join pedido_item i on i.pedido_id = pe.id and i.produto_id = p.produto_id
      where p.dia_id = ${diaId} and p.dia_id in ${diasDaEmpresa()} ${filtro}
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
      .where(and(eq(t.producao.diaId, diaId), sql`${t.producao.diaId} in ${diasDaEmpresa()}`, inArray(t.producao.produtoId, ids)))
      .orderBy(asc(t.producao.produtoId))
      .for('update');
    return this.estoques(diaId, ids);
  }

  async definir(diaId: string, produtoId: string, quantidade: number) {
    await this.db
      .insert(t.producao)
      .values({ diaId, produtoId, quantidade })
      .onConflictDoUpdate({
        target: [t.producao.diaId, t.producao.produtoId],
        set: { quantidade },
      });
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
      .where(and(eq(t.producaoAlteracao.diaId, diaId), sql`${t.producaoAlteracao.diaId} in ${diasDaEmpresa()}`))
      .orderBy(asc(t.producaoAlteracao.id));
    return linhas.map(({ a, usuario }) => ({
      produtoId: a.produtoId,
      de: a.de,
      para: a.para,
      em: a.em.toISOString(),
      usuario,
    }));
  }

  /** Das fotos dos últimos 4 dias fechados: último valor, média e sobra média por produto ativo. */
  async sugestao(): Promise<SugestaoProducao[]> {
    const { rows } = await this.db.execute<{
      produto_id: string;
      nome: string;
      ultimo: number;
      media: string;
      sobra_media: string;
    }>(sql`
      with ultimos as (
        select id, data from dia_venda where empresa_id = ${empresaAtual()} and status = 'encerrado' order by data desc limit 4
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
    return rows.map((r) => ({
      produtoId: r.produto_id,
      nome: r.nome,
      ultimo: Number(r.ultimo),
      media: Number(r.media),
      sobraMedia: Number(r.sobra_media),
    }));
  }
}

class PedidosPg implements PedidoRepo {
  constructor(private readonly db: Banco) {}

  async listar(diaId: string, filtro: FiltroPedidos = {}): Promise<Pedido[]> {
    if (!ehUuid(diaId)) return [];
    const condicoes = [eq(t.pedido.diaId, diaId), eq(t.pedido.empresaId, empresaAtual())];
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

  async doCliente(clienteId: string) {
    if (!ehUuid(clienteId)) return [];
    const linhas = await this.db
      .select({ pedido: t.pedido, cliente: t.cliente, data: t.diaVenda.data })
      .from(t.pedido)
      .innerJoin(t.cliente, eq(t.cliente.id, t.pedido.clienteId))
      .innerJoin(t.diaVenda, eq(t.diaVenda.id, t.pedido.diaId))
      .where(and(eq(t.pedido.clienteId, clienteId), eq(t.pedido.empresaId, empresaAtual())))
      .orderBy(desc(t.diaVenda.data), desc(t.pedido.numero));
    const pedidos = await this.montar(linhas);
    return pedidos.map((pedido, i) => ({ pedido, data: linhas[i].data }));
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    const linhas = await this.db
      .select({ pedido: t.pedido, cliente: t.cliente })
      .from(t.pedido)
      .innerJoin(t.cliente, eq(t.cliente.id, t.pedido.clienteId))
      .where(doPedido(id));
    return (await this.montar(linhas))[0] ?? null;
  }

  async travar(id: string) {
    if (!ehUuid(id)) return null;
    const [linha] = await this.db.select({ id: t.pedido.id }).from(t.pedido).where(doPedido(id)).for('update');
    return linha ? this.obter(id) : null;
  }

  async criar(novo: {
    diaId: string;
    clienteId: string;
    itens: readonly {
      produtoId: string;
      quantidade: number;
      precoUnitario: Dinheiro;
    }[];
    usuarioId: string;
    em: Date;
  }) {
    // Número da empresa: o UPDATE trava a linha da empresa até o fim da transação, então dois pedidos nunca pegam o mesmo.
    const empresaId = empresaAtual();
    const [{ numero }] = await this.db
      .update(t.empresa)
      .set({ proximoPedido: sql`${t.empresa.proximoPedido} + 1` })
      .where(eq(t.empresa.id, empresaId))
      .returning({ numero: sql<number>`${t.empresa.proximoPedido} - 1` });
    const [p] = await this.db
      .insert(t.pedido)
      .values({
        empresaId,
        numero,
        diaId: novo.diaId,
        clienteId: novo.clienteId,
        criadoPor: novo.usuarioId,
        criadoEm: novo.em,
      })
      .returning({ id: t.pedido.id });
    await this.db.insert(t.pedidoItem).values(novo.itens.map((i) => ({ ...i, pedidoId: p.id })));
    return (await this.obter(p.id))!;
  }

  async substituirItens(
    id: string,
    itens: readonly {
      produtoId: string;
      quantidade: number;
      precoUnitario: Dinheiro;
    }[],
  ) {
    await this.db.delete(t.pedidoItem).where(eq(t.pedidoItem.pedidoId, id));
    if (itens.length) await this.db.insert(t.pedidoItem).values(itens.map((i) => ({ ...i, pedidoId: id })));
  }

  async mudarRetirada(id: string, retirada: Retirada, usuarioId: string, em: Date) {
    // Voltar para "reservado" (reativar) apaga o registro do cancelamento.
    const quem =
      retirada === 'retirado'
        ? { retiradoPor: usuarioId, retiradoEm: em }
        : retirada === 'cancelado'
          ? { canceladoPor: usuarioId, canceladoEm: em }
          : { canceladoPor: null, canceladoEm: null };
    await this.db
      .update(t.pedido)
      .set({ retirada, ...quem })
      .where(doPedido(id));
  }

  async mudarPagamento(id: string, pagamento: Pagamento) {
    await this.db.update(t.pedido).set({ pagamento }).where(doPedido(id));
  }

  private async montar(
    linhas: {
      pedido: typeof t.pedido.$inferSelect;
      cliente: typeof t.cliente.$inferSelect;
    }[],
  ): Promise<Pedido[]> {
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

    // Nomes de quem reservou, retirou e cancelou, numa consulta só.
    const ids = [...new Set(linhas.flatMap(({ pedido: p }) => [p.criadoPor, p.retiradoPor, p.canceladoPor]).filter((id): id is string => !!id))];
    const pessoas = new Map(
      ids.length
        ? (await this.db.select({ id: t.usuario.id, nome: t.usuario.nome }).from(t.usuario).where(inArray(t.usuario.id, ids))).map((u) => [u.id, u.nome])
        : [],
    );
    const nome = (id: string | null) => (id ? pessoas.get(id) : undefined);
    const data = (em: Date | null) => em?.toISOString();

    return linhas.map(({ pedido, cliente }) => ({
      id: pedido.id,
      numero: pedido.numero,
      diaId: pedido.diaId,
      cliente: {
        nome: cliente.nome,
        ...(cliente.telefone && { telefone: cliente.telefone }),
      },
      itens: itens
        .filter((i) => i.item.pedidoId === pedido.id)
        .map((i) => ({
          produtoId: i.item.produtoId,
          nome: i.nome,
          quantidade: i.item.quantidade,
          precoUnitario: centavos(i.item.precoUnitario),
        })),
      retirada: pedido.retirada,
      pagamento: pedido.pagamento,
      registro: {
        reservadoPor: nome(pedido.criadoPor),
        reservadoEm: data(pedido.criadoEm),
        retiradoPor: nome(pedido.retiradoPor),
        retiradoEm: data(pedido.retiradoEm),
        canceladoPor: nome(pedido.canceladoPor),
        canceladoEm: data(pedido.canceladoEm),
      },
    }));
  }
}

class ClientesPg implements ClienteRepo {
  constructor(private readonly db: Banco) {}

  async obterOuCriar(c: { nome: string; telefone?: string }) {
    if (!c.telefone) {
      const [novo] = await this.db.insert(t.cliente).values({ empresaId: empresaAtual(), nome: c.nome }).returning({ id: t.cliente.id });
      return novo.id;
    }
    // Telefone é único na empresa: quem já comprou é reconhecido e o nome fica atualizado.
    const [linha] = await this.db
      .insert(t.cliente)
      .values({ empresaId: empresaAtual(), nome: c.nome, telefone: c.telefone })
      .onConflictDoUpdate({
        target: [t.cliente.empresaId, t.cliente.telefone],
        set: { nome: c.nome },
      })
      .returning({ id: t.cliente.id });
    return linha.id;
  }

  async porTelefone(telefone: string) {
    return (await this.consultar(eq(t.cliente.telefone, telefone)))[0] ?? null;
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    return (await this.consultar(eq(t.cliente.id, id)))[0] ?? null;
  }

  listar() {
    return this.consultar();
  }

  private async consultar(onde?: SQL): Promise<ClienteEncontrado[]> {
    const linhas = await this.db
      .select({
        id: t.cliente.id,
        nome: t.cliente.nome,
        telefone: t.cliente.telefone,
        pedidos: sql<string>`count(${t.pedido.id})`,
      })
      .from(t.cliente)
      .leftJoin(t.pedido, and(eq(t.pedido.clienteId, t.cliente.id), ne(t.pedido.retirada, 'cancelado')))
      .where(and(eq(t.cliente.empresaId, empresaAtual()), onde))
      .groupBy(t.cliente.id)
      .orderBy(asc(t.cliente.nome));
    return linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      ...(l.telefone && { telefone: l.telefone }),
      pedidosAnteriores: Number(l.pedidos),
    }));
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
        empresaId: empresaAtual(),
        posicao: sql`(select coalesce(max(posicao), 0) + 1 from lista_espera where dia_id = ${e.diaId} and produto_id = ${e.produtoId})`,
      })
      .returning({ id: t.listaEspera.id });
    return (await this.obter(nova.id))!;
  }

  async mudarStatus(id: string, status: EntradaEspera['status']) {
    await this.db
      .update(t.listaEspera)
      .set({ status })
      .where(and(eq(t.listaEspera.id, id), eq(t.listaEspera.empresaId, empresaAtual())));
    return (await this.obter(id))!;
  }

  private async consultar(onde: SQL): Promise<EntradaEspera[]> {
    const linhas = await this.db
      .select({ e: t.listaEspera, cliente: t.cliente })
      .from(t.listaEspera)
      .innerJoin(t.cliente, eq(t.cliente.id, t.listaEspera.clienteId))
      .where(and(eq(t.listaEspera.empresaId, empresaAtual()), onde))
      .orderBy(asc(t.listaEspera.posicao));
    return linhas.map(({ e, cliente }) => ({
      id: e.id,
      diaId: e.diaId,
      produtoId: e.produtoId,
      cliente: {
        nome: cliente.nome,
        ...(cliente.telefone && { telefone: cliente.telefone }),
      },
      quantidade: e.quantidade,
      posicao: e.posicao,
      status: e.status,
    }));
  }
}

class FechamentosPg implements FechamentoRepo {
  constructor(private readonly db: Banco) {}

  async ultimos(limite: number): Promise<DiaFechado[]> {
    const dias = await this.db
      .select({
        id: t.diaVenda.id,
        data: t.diaVenda.data,
        faturamento: t.diaVenda.faturamento,
      })
      .from(t.diaVenda)
      .where(and(eq(t.diaVenda.empresaId, empresaAtual()), eq(t.diaVenda.status, 'encerrado')))
      .orderBy(desc(t.diaVenda.data))
      .limit(limite);
    if (dias.length === 0) return [];
    const fotos = await this.db
      .select({ f: t.fechamentoProduto, nome: t.produto.nome })
      .from(t.fechamentoProduto)
      .innerJoin(t.produto, eq(t.produto.id, t.fechamentoProduto.produtoId))
      .where(
        inArray(
          t.fechamentoProduto.diaId,
          dias.map((d) => d.id),
        ),
      )
      .orderBy(asc(t.produto.nome));
    return dias.map((d) => ({
      diaId: d.id,
      data: d.data,
      faturamento: centavos(d.faturamento ?? 0),
      produtos: fotos
        .filter(({ f }) => f.diaId === d.id)
        .map(({ f, nome }) => ({
          produtoId: f.produtoId,
          nome,
          produzidos: f.produzidos,
          reservados: f.reservados,
          retirados: f.retirados,
          naoRetirados: f.naoRetirados,
          sobras: f.sobras,
        })),
    }));
  }

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
    await this.db.update(t.diaVenda).set({ faturamento }).where(doDia(diaId));
  }

  async resumo(diaId: string) {
    if (!ehUuid(diaId)) return null;
    const [dia] = await this.db.select({ faturamento: t.diaVenda.faturamento }).from(t.diaVenda).where(doDia(diaId));
    if (dia?.faturamento == null) return null;
    const [soma] = await this.db
      .select({
        sobras: sql<string>`coalesce(sum(${t.fechamentoProduto.sobras}), 0)`,
      })
      .from(t.fechamentoProduto)
      .where(eq(t.fechamentoProduto.diaId, diaId));
    return {
      faturamento: centavos(dia.faturamento),
      sobras: Number(soma.sobras),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id que não é uuid não existe; evita erro de tipo do Postgres e responde 404. */
function ehUuid(id: string) {
  return UUID.test(id);
}

class ConfiguracaoPg implements ConfiguracaoRepo {
  constructor(private readonly db: Banco) {}

  async obter(): Promise<Configuracao | null> {
    const [c] = await this.db.select().from(t.configuracao).where(eq(t.configuracao.empresaId, empresaAtual()));
    if (!c) return null;
    return {
      nomeEstabelecimento: c.nomeEstabelecimento,
      corPrincipal: c.corPrincipal,
      ...(c.logoUrl && { logoUrl: c.logoUrl }),
      ...(c.enderecoRetirada && { enderecoRetirada: c.enderecoRetirada }),
      diasDeVenda: c.diasDeVenda,
      limiteAtencao: c.limiteAtencao,
      formasDePagamento: c.formasDePagamento as FormaDePagamento[],
      mensagemWhatsapp: c.mensagemWhatsapp,
    };
  }

  async salvar(c: Configuracao) {
    const valores = {
      nomeEstabelecimento: c.nomeEstabelecimento,
      corPrincipal: c.corPrincipal,
      logoUrl: c.logoUrl ?? null,
      enderecoRetirada: c.enderecoRetirada ?? null,
      diasDeVenda: [...c.diasDeVenda],
      limiteAtencao: c.limiteAtencao,
      formasDePagamento: [...c.formasDePagamento],
      mensagemWhatsapp: c.mensagemWhatsapp,
      atualizadoEm: new Date(),
    };
    await this.db
      .insert(t.configuracao)
      .values({ empresaId: empresaAtual(), ...valores })
      .onConflictDoUpdate({ target: t.configuracao.empresaId, set: valores });
  }
}

class EmpresasPg implements EmpresaRepo {
  constructor(private readonly db: Banco) {}

  async listar(): Promise<Empresa[]> {
    return this.consultar();
  }

  async obter(id: string) {
    if (!ehUuid(id)) return null;
    return (await this.consultar(eq(t.empresa.id, id)))[0] ?? null;
  }

  async criar(nome: string) {
    const [e] = await this.db.insert(t.empresa).values({ nome }).returning({ id: t.empresa.id });
    return (await this.obter(e.id))!;
  }

  async mudarAtiva(id: string, ativa: boolean) {
    if (!ehUuid(id)) return null;
    await this.db.update(t.empresa).set({ ativa }).where(eq(t.empresa.id, id));
    return this.obter(id);
  }

  async criarUsuario(empresaId: string, usuario: { nome: string; email: string; senhaHash: string }) {
    const [u] = await this.db
      .insert(t.usuario)
      .values({ ...usuario, empresaId })
      .returning();
    return paraUsuario(u);
  }

  async criarAdministrador(usuario: { nome: string; email: string; senhaHash: string }) {
    const [u] = await this.db
      .insert(t.usuario)
      .values({ ...usuario, empresaId: null })
      .returning();
    return paraUsuario(u);
  }

  private async consultar(onde?: SQL): Promise<Empresa[]> {
    const linhas = await this.db
      .select({ e: t.empresa, usuarios: sql<string>`count(${t.usuario.id})` })
      .from(t.empresa)
      .leftJoin(t.usuario, eq(t.usuario.empresaId, t.empresa.id))
      .where(onde)
      .groupBy(t.empresa.id)
      .orderBy(asc(t.empresa.nome));
    return linhas.map(({ e, usuarios }) => ({
      id: e.id,
      nome: e.nome,
      ativa: e.ativa,
      criadaEm: e.criadaEm.toISOString(),
      usuarios: Number(usuarios),
    }));
  }
}

export function repositoriosPg(db: Banco): Repositorios {
  return {
    empresas: new EmpresasPg(db),
    configuracao: new ConfiguracaoPg(db),
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
