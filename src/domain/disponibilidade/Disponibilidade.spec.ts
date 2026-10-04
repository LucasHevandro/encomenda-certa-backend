import {
  disponiveis,
  type EstoqueDoProduto,
  QuantidadeIndisponivel,
  situacao,
  verificarItens,
} from './Disponibilidade.js';

// Números da tela Início: 40 produzidos = 32 reservados + 3 vendidos + 5 disponíveis.
const frango: EstoqueDoProduto = { produtoId: 'frango', nome: 'Frango assado', producao: 40, reservados: 32, vendidos: 3 };
const costela: EstoqueDoProduto = { produtoId: 'costela', nome: 'Costela', producao: 15, reservados: 11, vendidos: 1 };
const pernil: EstoqueDoProduto = { produtoId: 'pernil', nome: 'Pernil', producao: 10, reservados: 10, vendidos: 0 };

describe('disponiveis', () => {
  it('é produção menos reservados e vendidos', () => {
    expect(disponiveis(frango)).toBe(5);
    expect(disponiveis(costela)).toBe(3);
    expect(disponiveis(pernil)).toBe(0);
  });

  it('nunca fica negativo', () => {
    expect(disponiveis({ ...pernil, reservados: 12 })).toBe(0);
  });
});

describe('situacao', () => {
  it('segue as cores da tela', () => {
    expect(situacao(frango)).toBe('disponivel');
    expect(situacao(costela)).toBe('atencao');
    expect(situacao(pernil)).toBe('esgotado');
  });
});

describe('verificarItens', () => {
  const estoques = [frango, costela, pernil];

  it('aceita o que cabe', () => {
    expect(() => verificarItens(estoques, [{ produtoId: 'frango', quantidade: 5 }])).not.toThrow();
  });

  it('recusa além do disponível e informa o máximo', () => {
    try {
      verificarItens(estoques, [{ produtoId: 'frango', quantidade: 6 }]);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(QuantidadeIndisponivel);
      expect((erro as QuantidadeIndisponivel).maximo).toBe(5);
    }
  });

  it('soma itens repetidos do mesmo produto', () => {
    expect(() =>
      verificarItens(estoques, [
        { produtoId: 'costela', quantidade: 2 },
        { produtoId: 'costela', quantidade: 2 },
      ]),
    ).toThrow(QuantidadeIndisponivel);
  });

  it('recusa produto que não está no dia', () => {
    expect(() => verificarItens(estoques, [{ produtoId: 'maionese', quantidade: 1 }])).toThrow();
  });
});
