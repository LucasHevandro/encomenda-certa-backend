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
    expect(() => validarNovaData('2026-10-05', [])).toThrow('sábado ou um domingo');
    expect(() => validarNovaData('2026-10-04', ['2026-10-04'])).toThrow(ErroDeDominio);
    expect(() => validarNovaData('2026-10-10', [])).not.toThrow();
  });
});
