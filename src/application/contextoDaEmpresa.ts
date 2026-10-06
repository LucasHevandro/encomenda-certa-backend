import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Em qual empresa a requisição está. Cada requisição ganha um contexto vazio na entrada
 * e a guarda de sessão preenche com a empresa de quem está logado. Os repositórios leem
 * daqui, então nenhum caso de uso precisa passar a empresa adiante (nem consegue esquecer).
 */
export interface ContextoDaEmpresa {
  empresaId?: string;
}

const armazenamento = new AsyncLocalStorage<ContextoDaEmpresa>();

/** Abre um contexto (vazio ou já com empresa) para tudo o que `fn` fizer, inclusive o que for assíncrono. */
export function noContexto<T>(contexto: ContextoDaEmpresa, fn: () => T): T {
  return armazenamento.run(contexto, fn);
}

/** Executa `fn` dentro de uma empresa (scripts, testes, cadastro feito pelo painel). */
export function naEmpresa<T>(empresaId: string, fn: () => T): T {
  return armazenamento.run({ empresaId }, fn);
}

/** Preenche a empresa do contexto aberto na entrada da requisição. */
export function definirEmpresa(empresaId: string) {
  const contexto = armazenamento.getStore();
  if (!contexto) throw new Error('Nenhum contexto de requisição aberto.');
  contexto.empresaId = empresaId;
}

/** A empresa atual. Sem empresa, é erro de programação: nenhum dado é lido ou gravado. */
export function empresaAtual(): string {
  const empresaId = armazenamento.getStore()?.empresaId;
  if (!empresaId) throw new Error('Consulta sem empresa definida.');
  return empresaId;
}

/** Se há empresa no contexto: rotas abertas (como a configuração na tela de login) funcionam sem login. */
export function temEmpresa(): boolean {
  return !!armazenamento.getStore()?.empresaId;
}
