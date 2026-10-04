import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Repositorios } from '../../../application/portas/repositorios.js';
import type { UnidadeDeTrabalho } from '../../../application/portas/servicos.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { type BancoDrizzle, repositoriosPg } from './repositorios.js';
import * as schema from './schema.js';

/** Violação de unicidade que pode acontecer numa corrida: vira erro do balcão. */
function traduzirErroDoBanco(erro: unknown): unknown {
  const causa = (erro as { cause?: { code?: string; constraint?: string } })?.cause ?? (erro as { code?: string; constraint?: string });
  if (causa?.code === '23505' && causa.constraint === 'dia_venda_data_unique') {
    return new ErroDeDominio('dia-ja-existe', 'Já existe um dia de venda nessa data.');
  }
  if (causa?.code === '23505' && causa.constraint === 'usuario_email_unique') {
    return new ErroDeDominio('email-ja-existe', 'Já existe um usuário com esse e-mail.');
  }
  return erro;
}

export class UnidadeDeTrabalhoDrizzle implements UnidadeDeTrabalho {
  readonly db: BancoDrizzle;
  readonly leitura: Repositorios;

  constructor(readonly pool: pg.Pool) {
    this.db = drizzle(pool, { schema });
    this.leitura = repositoriosPg(this.db);
  }

  static conectar(url: string) {
    return new UnidadeDeTrabalhoDrizzle(new pg.Pool({ connectionString: url, max: 10 }));
  }

  /** READ COMMITTED + travas explícitas (FOR UPDATE/FOR SHARE) nos repositórios. */
  async executar<T>(fn: (repos: Repositorios) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction((tx) => fn(repositoriosPg(tx)));
    } catch (erro) {
      throw traduzirErroDoBanco(erro);
    }
  }

  encerrar() {
    return this.pool.end();
  }
}
