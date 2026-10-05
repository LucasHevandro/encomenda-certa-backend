import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().default(3333),
  /** Endereço do app (CORS com cookie), ex.: https://app.seudominio.com. Vários separados por vírgula. */
  ORIGEM_APP: z.string().default('http://localhost:3000'),
  COOKIE_NOME: z.string().default('expresso_sessao'),
  /** Ex.: .seudominio.com, para o proxy.ts do Next enxergar o cookie. Vazio em desenvolvimento. */
  COOKIE_DOMINIO: z.string().optional(),
  /** Segredo da assinatura do cookie de sessão; pelo menos 32 caracteres. */
  SESSAO_SEGREDO: z.string().min(32),
  SESSAO_DIAS: z.coerce.number().int().positive().default(30),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Quantos proxies há na frente da API (Railway = 1; Vercel + Railway = 2). Serve para achar o IP de quem tenta entrar. */
  PROXIES_NA_FRENTE: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof esquema>;

/** Lê o .env da pasta do projeto, se existir; variáveis já definidas no ambiente têm prioridade. */
export function carregarArquivoEnv(caminho = '.env') {
  try {
    process.loadEnvFile(caminho);
  } catch {
    // Sem .env: vale o ambiente (produção, CI).
  }
}

/** Variáveis validadas: a API nem sobe com configuração faltando. */
export function lerEnv(origem: NodeJS.ProcessEnv = process.env): Env {
  const resultado = esquema.safeParse(origem);
  if (!resultado.success) {
    const faltando = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${faltando}`);
  }
  return resultado.data;
}
