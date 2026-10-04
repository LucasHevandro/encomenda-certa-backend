import { centavos } from '../compartilhado/Dinheiro.js';
import { estaAberto, estaPago, type Pedido, totalDoPedido, validarNovoPedido } from './Pedido.js';

// Pedido #0258 da tela: 2 × Frango (R$ 55,00) + 1 × Costela (R$ 89,90) = R$ 199,90.
const pedido: Pedido = {
  id: 'p1',
  numero: 258,
  diaId: 'd1',
  cliente: { nome: 'João da Silva', telefone: '44999999999' },
  itens: [
    { produtoId: 'frango', nome: 'Frango assado', quantidade: 2, precoUnitario: centavos(5500) },
    { produtoId: 'costela', nome: 'Costela', quantidade: 1, precoUnitario: centavos(8990) },
  ],
  retirada: 'reservado',
  pagamento: 'pendente',
};

describe('Pedido', () => {
  it('calcula o total em centavos', () => {
    expect(totalDoPedido(pedido)).toBe(19990);
  });

  it('trata retirada e pagamento de forma independente', () => {
    const pagoNaoRetirado = { ...pedido, pagamento: 'pix' as const };
    expect(estaPago(pagoNaoRetirado)).toBe(true);
    expect(estaAberto(pagoNaoRetirado)).toBe(true);
  });
});

describe('validarNovoPedido', () => {
  it('só exige o nome e um item', () => {
    expect(() => validarNovoPedido({ nome: 'Maria' }, [{ quantidade: 1 }])).not.toThrow();
  });

  it('recusa sem nome ou sem itens', () => {
    expect(() => validarNovoPedido({ nome: '  ' }, [{ quantidade: 1 }])).toThrow('Informe o nome');
    expect(() => validarNovoPedido({ nome: 'Maria' }, [{ quantidade: 0 }])).toThrow('pelo menos um produto');
  });
});
