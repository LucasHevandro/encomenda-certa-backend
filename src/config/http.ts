import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Cookie de sessão, CORS só para o app (com credenciais) e encerramento limpo. */
export function prepararHttp(app: NestExpressApplication, origens: string) {
  app.use(cookieParser());
  app.enableCors({ origin: origens.split(',').map((o) => o.trim()), credentials: true });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
