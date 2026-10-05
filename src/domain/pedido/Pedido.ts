import { type Dinheiro, multiplicar, somar } from '../compartilhado/Dinheiro.js';
import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';

export type Retirada = 'reservado' | 'retirado' | 'cancelado';
export type Pagamento = 'pendente' | 'pix' | 'dinheiro' | 'cartao';

export interface ItemPedido {
  readonly produtoId: string;
  readonly nome: string;
  readonly quantidade: number;
  /** Preço do momento do pedido; não muda se o produto mudar de preço. */
  readonly precoUnitario: Dinheiro;
}

export interface ClienteDoPedido {
  readonly nome: string;
  readonly telefone?: string;
}

export interface Pedido {
  readonly id: string;
  /** Número sequencial mostrado como #0258. */
  readonly numero: number;
  readonly diaId: string;
  readonly cliente: ClienteDoPedido;
  readonly itens: readonly ItemPedido[];
  /** Retirada e pagamento são independentes (os dois selos do pedido). */
  readonly retirada: Retirada;
  readonly pagamento: Pagamento;
  /** Quem fez cada passo e quando (nome da pessoa e data ISO). */
  readonly registro?: RegistroDoPedido;
}

export interface RegistroDoPedido {
  readonly reservadoPor?: string;
  readonly reservadoEm?: string;
  readonly retiradoPor?: string;
  readonly retiradoEm?: string;
  readonly canceladoPor?: string;
  readonly canceladoEm?: string;
}

export function totalDoItem(item: ItemPedido): Dinheiro {
  return multiplicar(item.precoUnitario, item.quantidade);
}

export function totalDoPedido(pedido: Pick<Pedido, 'itens'>): Dinheiro {
  return somar(...pedido.itens.map(totalDoItem));
}

export function estaPago(pedido: Pedido): boolean {
  return pedido.pagamento !== 'pendente';
}

/** Só pedido reservado pode ser retirado, editado ou cancelado. */
export function estaAberto(pedido: Pedido): boolean {
  return pedido.retirada === 'reservado';
}

/** Regras para confirmar uma reserva: só o nome é obrigatório, e pelo menos um item. */
export function validarNovoPedido(cliente: ClienteDoPedido, itens: readonly { quantidade: number }[]): void {
  if (cliente.nome.trim() === '') {
    throw new ErroDeDominio('cliente-sem-nome', 'Informe o nome do cliente.');
  }
  const comQuantidade = itens.filter((item) => item.quantidade > 0);
  if (comQuantidade.length === 0) {
    throw new ErroDeDominio('pedido-sem-itens', 'Escolha pelo menos um produto.');
  }
  if (itens.some((item) => !Number.isInteger(item.quantidade) || item.quantidade < 0)) {
    throw new ErroDeDominio('quantidade-invalida', 'Quantidade inválida.');
  }
}
