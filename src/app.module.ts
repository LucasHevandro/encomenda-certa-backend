import { type DynamicModule, type FactoryProvider, type MiddlewareConsumer, Module, type NestModule, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { FiltroDeErros } from './adapters/entrada/http/erros.js';
import { AdminRotas, CadastrosRotas, DiasRotas, PedidosRotas, SessaoRotas } from './adapters/entrada/http/rotas.js';
import { LimiteDeTentativas } from './adapters/entrada/http/limiteDeTentativas.js';
import { AbrirContexto, CookieDeSessao, ENV, GuardaDeSessao } from './adapters/entrada/http/sessao.js';
import { HashScrypt, PublicadorSSE, RelogioDoSistema } from './adapters/saida/servicos.js';
import { Acesso, Clientes, Configuracoes, Empresas, Espera, Produtos } from './application/casos-de-uso/cadastros/Cadastros.js';
import { Dias } from './application/casos-de-uso/dias/Dias.js';
import { Pedidos } from './application/casos-de-uso/pedidos/Pedidos.js';
import { Producao } from './application/casos-de-uso/producao/Producao.js';
import type { HashDeSenha, PublicadorDeEventos, Relogio, UnidadeDeTrabalho } from './application/portas/servicos.js';
import { TOKENS } from './application/portas/servicos.js';
import type { Env } from './config/env.js';

type Com3 = (u: UnidadeDeTrabalho, e: PublicadorDeEventos, r: Relogio) => unknown;
const comEventos = (provide: Type, criar: Com3): FactoryProvider => ({ provide, useFactory: criar, inject: [TOKENS.uow, TOKENS.eventos, TOKENS.relogio] });

/**
 * Container: único lugar que liga as portas aos adaptadores.
 * A unidade de trabalho vem de fora, para os testes usarem outro banco.
 */
@Module({})
export class AppModule implements NestModule {
  /** Cada requisição ganha o seu contexto de empresa (preenchido pela guarda de sessão). */
  configure(consumidor: MiddlewareConsumer) {
    consumidor.apply(AbrirContexto).forRoutes('{*caminho}');
  }

  static configurar(env: Env, uow: UnidadeDeTrabalho): DynamicModule {
    const publicador = new PublicadorSSE();
    return {
      module: AppModule,
      controllers: [SessaoRotas, DiasRotas, PedidosRotas, CadastrosRotas, AdminRotas],
      providers: [
        { provide: ENV, useValue: env },
        { provide: TOKENS.uow, useValue: uow },
        { provide: TOKENS.eventos, useValue: publicador },
        { provide: PublicadorSSE, useValue: publicador },
        { provide: TOKENS.hash, useClass: HashScrypt },
        { provide: TOKENS.relogio, useClass: RelogioDoSistema },
        comEventos(Pedidos, (u, e, r) => new Pedidos(u, e, r)),
        comEventos(Dias, (u, e, r) => new Dias(u, e, r)),
        comEventos(Producao, (u, e, r) => new Producao(u, e, r)),
        comEventos(Espera, (u, e) => new Espera(u, e)),
        { provide: Produtos, useFactory: (u: UnidadeDeTrabalho) => new Produtos(u), inject: [TOKENS.uow] },
        { provide: Clientes, useFactory: (u: UnidadeDeTrabalho) => new Clientes(u), inject: [TOKENS.uow] },
        { provide: Configuracoes, useFactory: (u: UnidadeDeTrabalho) => new Configuracoes(u), inject: [TOKENS.uow] },
        { provide: Empresas, useFactory: (u: UnidadeDeTrabalho, h: HashDeSenha) => new Empresas(u, h), inject: [TOKENS.uow, TOKENS.hash] },
        { provide: Acesso, useFactory: (u: UnidadeDeTrabalho, h: HashDeSenha) => new Acesso(u, h), inject: [TOKENS.uow, TOKENS.hash] },
        CookieDeSessao,
        { provide: LimiteDeTentativas, useValue: new LimiteDeTentativas() },
        { provide: APP_GUARD, useClass: GuardaDeSessao },
        { provide: APP_FILTER, useClass: FiltroDeErros },
      ],
    };
  }
}
