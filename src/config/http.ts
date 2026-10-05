import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/**
 * Cookie de sessão, CORS com credenciais e encerramento limpo.
 * Em produção só ORIGEM_APP é aceita. Fora dela qualquer origem é aceita, para testar
 * no celular pelo IP do computador (ex.: http://192.168.0.10:3000).
 */
export function prepararHttp(app: NestExpressApplication, origens: string, producao = true) {
  app.use(cookieParser());
  app.enableCors({ origin: producao ? origens.split(',').map((o) => o.trim()) : true, credentials: true });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
