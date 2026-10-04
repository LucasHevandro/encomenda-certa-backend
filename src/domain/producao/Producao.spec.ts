import type { EstoqueDoProduto } from '../disponibilidade/Disponibilidade.js';
import { ProducaoAbaixoDoComprometido, validarNovaProducao } from './Producao.js';

// Tela Produção: costela com 11 reservados e 1 vendido não pode cair para 10.
const costela: EstoqueDoProduto = { produtoId: 'costela', nome: 'Costela', producao: 15, reservados: 11, vendidos: 1 };

describe('validarNovaProducao', () => {
  it('aceita aumentar ou reduzir até o comprometido', () => {
    expect(() => validarNovaProducao(costela, 20)).not.toThrow();
    expect(() => validarNovaProducao(costela, 12)).not.toThrow();
  });

  it('bloqueia abaixo de reservados + vendidos', () => {
    try {
      validarNovaProducao(costela, 10);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ProducaoAbaixoDoComprometido);
      expect((erro as ProducaoAbaixoDoComprometido).minimo).toBe(12);
    }
  });
});
