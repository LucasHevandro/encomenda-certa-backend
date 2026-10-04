import { type Dinheiro, somar } from '../compartilhado/Dinheiro.js';
import { disponiveis, type EstoqueDoProduto } from '../disponibilidade/Disponibilidade.js';
import { type Pedido, totalDoPedido } from '../pedido/Pedido.js';

/** Uma linha do fechamento: o que aconteceu com cada produto no dia. */
export interface FechamentoDoProduto {
  readonly produtoId: string;
  readonly nome: string;
  readonly produzidos: number;
  /** Todos os itens de pedidos não cancelados, retirados ou não. */
  readonly reservados: number;
  readonly retirados: number;
  readonly naoRetirados: number;
  /** Produção que ninguém reservou. Não retirado não conta como sobra. */
  readonly sobras: number;
}

export interface Fechamento {
  readonly produtos: readonly FechamentoDoProduto[];
  /** Decisão do negócio: soma todos os pedidos não cancelados, retirados ou não. */
  readonly totalVendido: Dinheiro;
  /** Parte do total que ainda não foi retirada. */
  readonly valorNaoRetirado: Dinheiro;
  readonly pedidos: number;
  readonly pedidosNaoRetirados: number;
  readonly itensVendidos: number;
  readonly sobras: number;
}

export function calcularFechamento(estoques: readonly EstoqueDoProduto[], pedidos: readonly Pedido[]): Fechamento {
  const validos = pedidos.filter((p) => p.retirada !== 'cancelado');
  const naoRetirados = validos.filter((p) => p.retirada === 'reservado');
  const produtos = estoques.map((e) => ({
    produtoId: e.produtoId,
    nome: e.nome,
    produzidos: e.producao,
    reservados: e.reservados + e.vendidos,
    retirados: e.vendidos,
    naoRetirados: e.reservados,
    sobras: disponiveis(e),
  }));
  return {
    produtos,
    totalVendido: somar(...validos.map(totalDoPedido)),
    valorNaoRetirado: somar(...naoRetirados.map(totalDoPedido)),
    pedidos: validos.length,
    pedidosNaoRetirados: naoRetirados.length,
    itensVendidos: produtos.reduce((total, p) => total + p.reservados, 0),
    sobras: produtos.reduce((total, p) => total + p.sobras, 0),
  };
}
