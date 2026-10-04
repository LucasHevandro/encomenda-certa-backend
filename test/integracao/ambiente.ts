import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { migrar } from '../../src/adapters/saida/postgres/migrar.js';
import { UnidadeDeTrabalhoDrizzle } from '../../src/adapters/saida/postgres/UnidadeDeTrabalhoDrizzle.js';
import { HashScrypt } from '../../src/adapters/saida/servicos.js';
import { AppModule } from '../../src/app.module.js';
import { Acesso } from '../../src/application/casos-de-uso/cadastros/Cadastros.js';
import type { UnidadeDeTrabalho } from '../../src/application/portas/servicos.js';
import { lerEnv } from '../../src/config/env.js';
import { prepararHttp } from '../../src/config/http.js';

/** Postgres de verdade (docker compose): a corrida pelo último frango só se prova com o banco real. */
export const URL_TESTE = process.env.DATABASE_URL_TESTE ?? 'postgres://expresso:expresso@localhost:5432/expresso_teste';

export interface Ambiente {
  app: INestApplication;
  uow: UnidadeDeTrabalhoDrizzle;
  /** Agente com o cookie de sessão de uma pessoa logada. */
  logado: ReturnType<typeof request.agent>;
  encerrar(): Promise<void>;
}

/**
 * Segura cada transação por um instante logo depois de ler a disponibilidade.
 * Assim a janela da corrida fica larga de verdade: sem a trava FOR UPDATE, vários
 * pedidos leriam o mesmo número e passariam juntos (o teste falha).
 */
function comJanelaDeCorrida(uow: UnidadeDeTrabalhoDrizzle, ms: number): UnidadeDeTrabalho {
  return {
    leitura: uow.leitura,
    executar: (fn) =>
      uow.executar((repos) =>
        fn({
          ...repos,
          producao: Object.assign(Object.create(repos.producao), {
            travar: async (diaId: string, ids: readonly string[]) => {
              const estoques = await repos.producao.travar(diaId, ids);
              await new Promise((r) => setTimeout(r, ms));
              return estoques;
            },
          }),
        }),
      ),
  };
}

export async function subirAmbiente({ janelaDeCorridaMs = 0 } = {}): Promise<Ambiente> {
  const env = lerEnv({ DATABASE_URL: URL_TESTE, SESSAO_SEGREDO: 'segredo-de-teste-com-mais-de-32-caracteres', NODE_ENV: 'test' });
  const uow = UnidadeDeTrabalhoDrizzle.conectar(URL_TESTE);
  await uow.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrar(uow.db);
  await new Acesso(uow, new HashScrypt()).criarUsuario('Lusca', 'lusca@expressocafe.com', 'senha-forte-123');

  const usada = janelaDeCorridaMs > 0 ? comJanelaDeCorrida(uow, janelaDeCorridaMs) : uow;
  const modulo = await Test.createTestingModule({ imports: [AppModule.configurar(env, usada)] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>();
  prepararHttp(app, env.ORIGEM_APP);
  // Escutando de verdade: o supertest reaproveita o mesmo servidor nas requisições simultâneas.
  await app.listen(0);

  const logado = request.agent(app.getHttpServer());
  await logado.post('/sessao').send({ email: 'lusca@expressocafe.com', senha: 'senha-forte-123' }).expect(200);

  return {
    app,
    uow,
    logado,
    async encerrar() {
      await app.close();
      await uow.encerrar();
    },
  };
}

/** Cria um produto e abre um dia (sábado/domingo livre) com a produção pedida. */
export async function abrirDia(amb: Ambiente, data: string, producao: Record<string, { preco: number; quantidade: number }>) {
  const ids: Record<string, string> = {};
  for (const [nome, { preco }] of Object.entries(producao)) {
    const { body } = await amb.logado.post('/produtos').send({ nome, preco }).expect(201);
    ids[nome] = body.id;
  }
  const { body: dia } = await amb.logado
    .post('/dias')
    .send({ data, producao: Object.entries(producao).map(([nome, p]) => ({ produtoId: ids[nome], quantidade: p.quantidade })) })
    .expect(201);
  return { diaId: dia.id as string, ids };
}
