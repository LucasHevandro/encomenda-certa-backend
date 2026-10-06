import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';
import { ehFimDeSemana, sugerirProximaData, validarNovaData } from './DiaVenda.js';

describe('DiaVenda', () => {
  it('reconhece sábado e domingo', () => {
    expect(ehFimDeSemana('2026-10-03')).toBe(true);
    expect(ehFimDeSemana('2026-10-04')).toBe(true);
    expect(ehFimDeSemana('2026-10-05')).toBe(false);
  });

  it('sugere o próximo domingo livre', () => {
    expect(sugerirProximaData('2026-10-01', [])).toBe('2026-10-04');
    expect(sugerirProximaData('2026-10-04', [])).toBe('2026-10-04');
    expect(sugerirProximaData('2026-10-01', ['2026-10-04', '2026-10-11'])).toBe('2026-10-18');
  });

  it('recusa dia útil e data repetida', () => {
    expect(() => validarNovaData('2026-10-05', [])).toThrow('sábado ou domingo');
    expect(() => validarNovaData('2026-10-04', ['2026-10-04'])).toThrow(ErroDeDominio);
    expect(() => validarNovaData('2026-10-10', [])).not.toThrow();
  });
});

describe('DiaVenda com dias configurados', () => {
  it('aceita e sugere só os dias de venda do estabelecimento', () => {
    const uteis = [1, 2, 3, 4, 5];
    expect(() => validarNovaData('2026-10-05', [], uteis)).not.toThrow();
    expect(() => validarNovaData('2026-10-04', [], uteis)).toThrow('segunda, terça, quarta, quinta ou sexta');
    expect(sugerirProximaData('2026-10-03', ['2026-10-05'], uteis)).toBe('2026-10-06');
  });
});
