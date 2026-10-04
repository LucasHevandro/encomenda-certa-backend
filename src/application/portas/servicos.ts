import type { Repositorios } from './repositorios.js';

/** Executa `fn` numa transação: tudo é gravado junto, ou nada é. */
export interface UnidadeDeTrabalho {
  executar<T>(fn: (repos: Repositorios) => Promise<T>): Promise<T>;
  /** Leituras fora de transação. */
  readonly leitura: Repositorios;
}

export type EventoDoDia =
  | { readonly tipo: 'disponibilidade-mudou' }
  | { readonly tipo: 'unidades-liberadas'; readonly produtoId: string; readonly quantidade: number };

/** Avisa os outros aparelhos. Só é chamado depois que a transação confirmou. */
export interface PublicadorDeEventos {
  publicar(diaId: string, evento: EventoDoDia): void;
}

export interface HashDeSenha {
  gerar(senha: string): Promise<string>;
  conferir(senha: string, hash: string): Promise<boolean>;
}

export interface Relogio {
  agora(): Date;
}

export const TOKENS = {
  uow: Symbol('UnidadeDeTrabalho'),
  eventos: Symbol('PublicadorDeEventos'),
  hash: Symbol('HashDeSenha'),
  relogio: Symbol('Relogio'),
} as const;
