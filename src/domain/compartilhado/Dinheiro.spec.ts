import { centavos, multiplicar, somar } from './Dinheiro.js';

describe('Dinheiro', () => {
  it('soma e multiplica em centavos', () => {
    expect(multiplicar(centavos(5500), 2)).toBe(11000);
    expect(somar(centavos(11000), centavos(8990))).toBe(19990);
  });

  it('recusa valor negativo ou com fração de centavo', () => {
    expect(() => centavos(-1)).toThrow();
    expect(() => centavos(10.5)).toThrow();
  });
});
