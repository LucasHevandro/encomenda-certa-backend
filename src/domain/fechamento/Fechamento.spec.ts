import { centavos } from '../compartilhado/Dinheiro.js';
import type { Pedido } from '../pedido/Pedido.js';
import { calcularFechamento } from './Fechamento.js';

const item = (quantidade: number) => ({ produtoId: 'frango', nome: 'Frango', quantidade, precoUnitario: centavos(5500) });
const pedido = (numero: number, quantidade: number, retirada: Pedido['retirada']): Pedido => ({
  id: `p${numero}`,
  numero,
  diaId: 'd',
  cliente: { nome: 'X' },
  itens: [item(quantidade)],
  retirada,
  pagamento: 'pendente',
});

describe('calcularFechamento', () => {
  it('separa retirados, não retirados e sobras; cancelado não conta', () => {
    const fechamento = calcularFechamento(
      [{ produtoId: 'frango', nome: 'Frango', producao: 40, reservados: 3, vendidos: 5 }],
      [pedido(1, 5, 'retirado'), pedido(2, 3, 'reservado'), pedido(3, 2, 'cancelado')],
    );
    expect(fechamento.produtos[0]).toMatchObject({ produzidos: 40, reservados: 8, retirados: 5, naoRetirados: 3, sobras: 32 });
    expect(fechamento.totalVendido).toBe(8 * 5500);
    expect(fechamento.valorNaoRetirado).toBe(3 * 5500);
    expect(fechamento.pedidos).toBe(2);
    expect(fechamento.pedidosNaoRetirados).toBe(1);
    expect(fechamento.itensVendidos).toBe(8);
  });
});
