import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir } from '../../../domain/compartilhado/naoEncontrado.js';
import { garantirAberto } from '../../../domain/dia-venda/DiaVenda.js';
import { type EstoqueDoProduto, type ItemSolicitado, verificarItens } from '../../../domain/disponibilidade/Disponibilidade.js';
import { type ClienteDoPedido, estaAberto, type Pagamento, type Pedido, validarNovoPedido } from '../../../domain/pedido/Pedido.js';
import type { Produto } from '../../../domain/produto/Produto.js';
import type { FiltroPedidos, Repositorios } from '../../portas/repositorios.js';
import type { PublicadorDeEventos, Relogio, UnidadeDeTrabalho } from '../../portas/servicos.js';

export interface NovoPedido {
  readonly diaId: string;
  readonly cliente: ClienteDoPedido;
  readonly itens: readonly ItemSolicitado[];
}

export interface ResultadoCancelamento {
  readonly unidadesLiberadas: number;
  readonly clientesAguardando: number;
}

const PAGAMENTOS: readonly Pagamento[] = ['pendente', 'pix', 'dinheiro', 'cartao'];

/** Soma itens repetidos do mesmo produto e tira os zerados. */
function juntarItens(itens: readonly ItemSolicitado[]): ItemSolicitado[] {
  const porProduto = new Map<string, number>();
  for (const item of itens) porProduto.set(item.produtoId, (porProduto.get(item.produtoId) ?? 0) + item.quantidade);
  return [...porProduto].map(([produtoId, quantidade]) => ({ produtoId, quantidade })).filter((i) => i.quantidade !== 0);
}

function limparCliente(cliente: ClienteDoPedido): ClienteDoPedido {
  return { nome: cliente.nome.trim(), telefone: cliente.telefone?.replace(/\D/g, '') || undefined };
}

/** Só produtos ativos entram em pedidos novos; os que já estavam no pedido podem continuar. */
function produtosDoPedido(produtos: readonly Produto[], ids: readonly string[], jaNoPedido: ReadonlySet<string> = new Set()) {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  for (const id of ids) {
    const produto = existir(porId.get(id), 'Produto');
    if (!produto.ativo && !jaNoPedido.has(id)) {
      throw new ErroDeDominio('produto-inativo', `${produto.nome} não está mais à venda.`);
    }
  }
  return porId;
}

/** Estoques como se o pedido não existisse: o que ele reservou volta a ficar disponível. */
export function devolverUnidades(estoques: readonly EstoqueDoProduto[], pedido: Pedido): EstoqueDoProduto[] {
  return estoques.map((e) => ({
    ...e,
    reservados: e.reservados - pedido.itens.filter((i) => i.produtoId === e.produtoId).reduce((t, i) => t + i.quantidade, 0),
  }));
}

export class Pedidos {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly eventos: PublicadorDeEventos,
    private readonly relogio: Relogio,
  ) {}

  listar(diaId: string, filtro?: FiltroPedidos): Promise<Pedido[]> {
    return this.uow.leitura.pedidos.listar(diaId, filtro);
  }

  async obter(id: string): Promise<Pedido> {
    return existir(await this.uow.leitura.pedidos.obter(id), 'Pedido');
  }

  /**
   * Confirmar reserva: trava a produção dos produtos do pedido, confere se cabe e grava.
   * Se faltar, lança QuantidadeIndisponivel com o máximo exato, que vira o "Reservar N".
   */
  async criar(comando: NovoPedido, usuarioId: string): Promise<Pedido> {
    const itens = juntarItens(comando.itens);
    const cliente = limparCliente(comando.cliente);
    validarNovoPedido(cliente, itens);

    const pedido = await this.uow.executar(async (r) => {
      garantirAberto(await r.dias.travarParaEscrita(comando.diaId));
      const ids = itens.map((i) => i.produtoId);
      const produtos = produtosDoPedido(await r.produtos.porIds(ids), ids);
      const estoques = await r.producao.travar(comando.diaId, ids);
      verificarItens(estoques, itens);
      const clienteId = await r.clientes.obterOuCriar(cliente);
      return r.pedidos.criar({
        diaId: comando.diaId,
        clienteId,
        itens: itens.map((i) => ({ ...i, precoUnitario: produtos.get(i.produtoId)!.preco })),
        usuarioId,
        em: this.relogio.agora(),
      });
    });

    this.eventos.publicar(comando.diaId, { tipo: 'disponibilidade-mudou' });
    return pedido;
  }

  /** Mesma checagem da reserva, mas as unidades do próprio pedido voltam para a conta antes. */
  async editar(pedidoId: string, novosItens: readonly ItemSolicitado[]): Promise<Pedido> {
    const itens = juntarItens(novosItens);
    const salvo = await this.uow.executar(async (r) => {
      const atual = existir(await r.pedidos.travar(pedidoId), 'Pedido');
      if (!estaAberto(atual)) throw new ErroDeDominio('pedido-fechado', 'Só dá para editar pedido reservado.');
      validarNovoPedido(atual.cliente, itens);
      garantirAberto(await r.dias.travarParaEscrita(atual.diaId));

      const antigos = new Set(atual.itens.map((i) => i.produtoId));
      const ids = itens.map((i) => i.produtoId);
      const produtos = produtosDoPedido(await r.produtos.porIds(ids), ids, antigos);
      const estoques = await r.producao.travar(atual.diaId, [...new Set([...ids, ...antigos])]);
      verificarItens(devolverUnidades(estoques, atual), itens);

      // Quem já estava no pedido mantém o preço da época.
      await r.pedidos.substituirItens(
        pedidoId,
        itens.map((i) => ({
          ...i,
          precoUnitario: atual.itens.find((a) => a.produtoId === i.produtoId)?.precoUnitario ?? produtos.get(i.produtoId)!.preco,
        })),
      );
      return existir(await r.pedidos.obter(pedidoId), 'Pedido');
    });
    this.eventos.publicar(salvo.diaId, { tipo: 'disponibilidade-mudou' });
    return salvo;
  }

  /** Reservado vira retirado; o item sai de "reservados" e entra em "vendidos". */
  async marcarRetirado(pedidoId: string, usuarioId: string): Promise<Pedido> {
    const salvo = await this.uow.executar(async (r) => {
      const atual = existir(await r.pedidos.travar(pedidoId), 'Pedido');
      if (!estaAberto(atual)) throw new ErroDeDominio('pedido-fechado', 'Este pedido já foi retirado ou cancelado.');
      garantirAberto(await r.dias.travarParaEscrita(atual.diaId));
      await r.pedidos.mudarRetirada(pedidoId, 'retirado', usuarioId, this.relogio.agora());
      return existir(await r.pedidos.obter(pedidoId), 'Pedido');
    });
    this.eventos.publicar(salvo.diaId, { tipo: 'disponibilidade-mudou' });
    return salvo;
  }

  /** Independente da retirada. */
  async registrarPagamento(pedidoId: string, pagamento: Pagamento): Promise<Pedido> {
    if (!PAGAMENTOS.includes(pagamento)) throw new ErroDeDominio('pagamento-invalido', 'Forma de pagamento inválida.');
    const salvo = await this.uow.executar(async (r) => {
      const atual = existir(await r.pedidos.travar(pedidoId), 'Pedido');
      if (atual.retirada === 'cancelado') throw new ErroDeDominio('pedido-fechado', 'Este pedido foi cancelado.');
      await r.pedidos.mudarPagamento(pedidoId, pagamento);
      return existir(await r.pedidos.obter(pedidoId), 'Pedido');
    });
    this.eventos.publicar(salvo.diaId, { tipo: 'disponibilidade-mudou' });
    return salvo;
  }

  /**
   * Reativar um pedido cancelado: volta a segurar unidades, então passa pela mesma trava e
   * conferência da reserva. Se não couber mais, QuantidadeIndisponivel com o máximo.
   */
  async reativar(pedidoId: string, usuarioId: string): Promise<Pedido> {
    const salvo = await this.uow.executar(async (r) => {
      const atual = existir(await r.pedidos.travar(pedidoId), 'Pedido');
      if (atual.retirada !== 'cancelado') throw new ErroDeDominio('pedido-nao-cancelado', 'Só dá para reativar pedido cancelado.');
      garantirAberto(await r.dias.travarParaEscrita(atual.diaId));
      const estoques = await r.producao.travar(
        atual.diaId,
        atual.itens.map((i) => i.produtoId),
      );
      verificarItens(estoques, atual.itens);
      await r.pedidos.mudarRetirada(pedidoId, 'reservado', usuarioId, this.relogio.agora());
      return existir(await r.pedidos.obter(pedidoId), 'Pedido');
    });
    this.eventos.publicar(salvo.diaId, { tipo: 'disponibilidade-mudou' });
    return salvo;
  }

  /** Cancelar só libera unidades, então não precisa checar disponibilidade; avisa a lista de espera. */
  async cancelar(pedidoId: string, usuarioId: string): Promise<ResultadoCancelamento> {
    const { pedido, resultado } = await this.uow.executar(async (r) => {
      const atual = existir(await r.pedidos.travar(pedidoId), 'Pedido');
      if (!estaAberto(atual)) throw new ErroDeDominio('pedido-fechado', 'Este pedido já foi retirado ou cancelado.');
      garantirAberto(await r.dias.travarParaEscrita(atual.diaId));
      await r.pedidos.mudarRetirada(pedidoId, 'cancelado', usuarioId, this.relogio.agora());
      const produtos = new Set(atual.itens.map((i) => i.produtoId));
      const fila = (await r.espera.listar(atual.diaId)).filter((e) => e.status === 'aguardando' && produtos.has(e.produtoId));
      return {
        pedido: atual,
        resultado: { unidadesLiberadas: atual.itens.reduce((t, i) => t + i.quantidade, 0), clientesAguardando: fila.length },
      };
    });
    for (const item of pedido.itens) {
      this.eventos.publicar(pedido.diaId, { tipo: 'unidades-liberadas', produtoId: item.produtoId, quantidade: item.quantidade });
    }
    return resultado;
  }
}

export type { Repositorios };
