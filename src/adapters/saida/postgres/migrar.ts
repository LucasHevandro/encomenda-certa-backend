import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { BancoDrizzle } from './repositorios.js';

/** Pasta das migrações geradas pelo drizzle-kit (fica no código-fonte, ao lado do schema). */
export const PASTA_MIGRACOES = fileURLToPath(new URL('../../../../src/adapters/saida/postgres/migrations', import.meta.url));

export function migrar(db: BancoDrizzle, pasta = PASTA_MIGRACOES) {
  return migrate(db, { migrationsFolder: pasta });
}
