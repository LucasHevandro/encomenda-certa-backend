import type { Dinheiro } from '../compartilhado/Dinheiro.js';

export interface Produto {
  readonly id: string;
  readonly nome: string;
  /** Preço atual. Pedidos já feitos guardam o preço da época em ItemPedido. */
  readonly preco: Dinheiro;
  /** Inativo não aparece no novo pedido, mas continua no histórico. */
  readonly ativo: boolean;
}
