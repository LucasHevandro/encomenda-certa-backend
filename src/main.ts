import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { migrar } from './adapters/saida/postgres/migrar.js';
import { UnidadeDeTrabalhoDrizzle } from './adapters/saida/postgres/UnidadeDeTrabalhoDrizzle.js';
import { AppModule } from './app.module.js';
import { carregarArquivoEnv, lerEnv } from './config/env.js';
import { prepararHttp } from './config/http.js';

async function bootstrap() {
  carregarArquivoEnv();
  const env = lerEnv();
  const uow = UnidadeDeTrabalhoDrizzle.conectar(env.DATABASE_URL);
  // Um serviço só: aplicar as migrações na subida é simples e seguro.
  await migrar(uow.db);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.configurar(env, uow));
  prepararHttp(app, env.ORIGEM_APP, env.NODE_ENV === 'production', env.PROXIES_NA_FRENTE);
  await app.listen(env.PORT);
}
await bootstrap();
