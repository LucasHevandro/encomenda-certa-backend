import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/adapters/saida/postgres/schema.ts',
  out: './src/adapters/saida/postgres/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://expresso:expresso@localhost:5432/expresso' },
});
