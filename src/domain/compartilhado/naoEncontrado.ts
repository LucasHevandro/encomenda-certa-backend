import { ErroDeDominio } from './ErroDeDominio.js';

export function naoEncontrado(oQue: string): ErroDeDominio {
  return new ErroDeDominio('nao-encontrado', `${oQue} não encontrado.`);
}

/** Devolve o valor ou lança "não encontrado". */
export function existir<T>(valor: T | null | undefined, oQue: string): T {
  if (valor == null) throw naoEncontrado(oQue);
  return valor;
}
