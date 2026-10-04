import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';

/** Números de um produto dentro de um dia de venda. */
export interface EstoqueDoProduto {
  readonly produtoId: string;
  readonly nome: string;
  readonly producao: number;
  /** Itens de pedidos ainda não retirados (cancelados não contam). */
  readonly reservados: number;
  /** Itens de pedidos já retirados. */
  readonly vendidos: number;
}

export interface ItemSolicitado {
  readonly produtoId: string;
  readonly quantidade: number;
}

export type Situacao = 'disponivel' | 'atencao' | 'esgotado';

/** Com essa quantidade ou menos, o produto aparece como 'Atenção'. */
export const LIMITE_ATENCAO = 3;

export function comprometidos(estoque: EstoqueDoProduto): number {
  return estoque.reservados + estoque.vendidos;
}

export function disponiveis(estoque: EstoqueDoProduto): number {
  return Math.max(0, estoque.producao - comprometidos(estoque));
}

export function situacao(estoque: EstoqueDoProduto): Situacao {
  const restantes = disponiveis(estoque);
  if (restantes === 0) return 'esgotado';
  if (restantes <= LIMITE_ATENCAO) return 'atencao';
  return 'disponivel';
}

export class QuantidadeIndisponivel extends ErroDeDominio {
  constructor(
    readonly produtoId: string,
    readonly nome: string,
    readonly solicitado: number,
    /** O máximo que ainda dá para reservar; vira o botão 'Reservar N'. */
    readonly maximo: number,
  ) {
    super(
      'quantidade-indisponivel',
      `Existem apenas ${maximo} unidades de ${nome} disponíveis para reserva.`,
    );
  }
}

/**
 * Confere se os itens cabem no que resta. Itens repetidos do mesmo produto são somados.
 * O front usa para avisar antes de enviar; quem decide de verdade é a API.
 */
export function verificarItens(
  estoques: readonly EstoqueDoProduto[],
  itens: readonly ItemSolicitado[],
): void {
  const porProduto = new Map<string, number>();
  for (const item of itens) {
    porProduto.set(item.produtoId, (porProduto.get(item.produtoId) ?? 0) + item.quantidade);
  }
  for (const [produtoId, solicitado] of porProduto) {
    const estoque = estoques.find((e) => e.produtoId === produtoId);
    if (!estoque) {
      throw new ErroDeDominio('produto-fora-do-dia', `Produto ${produtoId} não está neste dia de venda.`);
    }
    const maximo = disponiveis(estoque);
    if (solicitado > maximo) {
      throw new QuantidadeIndisponivel(produtoId, estoque.nome, solicitado, maximo);
    }
  }
}
