import { ErroDeDominio } from './ErroDeDominio.js';

/** Valor em centavos (inteiro), para evitar erro de arredondamento: R$ 55,00 = 5500. */
export type Dinheiro = number & { readonly __marca: 'Dinheiro' };

export function centavos(valor: number): Dinheiro {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new ErroDeDominio('valor-invalido', `Valor em centavos inválido: ${valor}`);
  }
  return valor as Dinheiro;
}

export function somar(...valores: Dinheiro[]): Dinheiro {
  return centavos(valores.reduce((total, valor) => total + valor, 0));
}

export function multiplicar(valor: Dinheiro, quantidade: number): Dinheiro {
  return centavos(valor * quantidade);
}
