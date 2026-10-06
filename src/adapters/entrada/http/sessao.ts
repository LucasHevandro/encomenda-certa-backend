import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable, type NestMiddleware, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { Acesso } from '../../../application/casos-de-uso/cadastros/Cadastros.js';
import type { Usuario } from '../../../application/portas/repositorios.js';
import { definirEmpresa, noContexto } from '../../../application/contextoDaEmpresa.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import type { Env } from '../../../config/env.js';

export const ENV = Symbol('Env');

/**
 * Sessão longa em cookie httpOnly assinado: "usuarioId.expiraEm.assinatura".
 * Não precisa de tabela; para derrubar todas as sessões, troque SESSAO_SEGREDO.
 */
@Injectable()
export class CookieDeSessao {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private assinar(conteudo: string) {
    return createHmac('sha256', this.env.SESSAO_SEGREDO).update(conteudo).digest('base64url');
  }

  private opcoes(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      ...(this.env.COOKIE_DOMINIO && { domain: this.env.COOKIE_DOMINIO }),
    };
  }

  gravar(resposta: Response, usuarioId: string) {
    const validade = this.env.SESSAO_DIAS * 24 * 60 * 60 * 1000;
    const conteudo = `${usuarioId}.${Date.now() + validade}`;
    resposta.cookie(this.env.COOKIE_NOME, `${conteudo}.${this.assinar(conteudo)}`, { ...this.opcoes(), maxAge: validade });
  }

  apagar(resposta: Response) {
    resposta.clearCookie(this.env.COOKIE_NOME, this.opcoes());
  }

  /** Devolve o id do usuário se o cookie for válido e não tiver vencido. */
  ler(requisicao: Request): string | null {
    const valor: unknown = requisicao.cookies?.[this.env.COOKIE_NOME];
    if (typeof valor !== 'string') return null;
    const partes = valor.split('.');
    if (partes.length !== 3) return null;
    const [usuarioId, expiraEm, assinatura] = partes;
    const esperada = Buffer.from(this.assinar(`${usuarioId}.${expiraEm}`));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
    if (Number(expiraEm) < Date.now()) return null;
    return usuarioId;
  }
}

const PUBLICO = 'rota-publica';
const PARA_TODOS = 'rota-para-todos';
const SO_ADMINISTRADOR = 'rota-so-administrador';
/** Rota aberta sem login (POST /sessao, saúde). Com sessão válida, entra na empresa dela mesmo assim. */
export const Publico = () => SetMetadata(PUBLICO, true);
/** Qualquer pessoa logada, da empresa ou administrador (quem sou eu, trocar senha). */
export const ParaTodos = () => SetMetadata(PARA_TODOS, true);
/** Só o administrador do sistema (painel de empresas). */
export const SoAdministrador = () => SetMetadata(SO_ADMINISTRADOR, true);

type RequisicaoComUsuario = Request & { usuario?: Usuario };

/** Abre o contexto vazio de cada requisição; a guarda preenche a empresa depois de ler o cookie. */
@Injectable()
export class AbrirContexto implements NestMiddleware {
  use(_requisicao: Request, _resposta: Response, proximo: NextFunction) {
    noContexto({}, () => proximo());
  }
}

/**
 * Toda rota exige sessão, salvo as marcadas com @Publico().
 * Por padrão a rota é da empresa: o administrador (sem empresa) só passa nas marcadas
 * com @SoAdministrador() ou @ParaTodos(), e a equipe de uma empresa nunca passa nas do administrador.
 */
@Injectable()
export class GuardaDeSessao implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CookieDeSessao) private readonly cookie: CookieDeSessao,
    @Inject(Acesso) private readonly acesso: Acesso,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const marcada = (chave: string) => this.reflector.getAllAndOverride<boolean>(chave, [contexto.getHandler(), contexto.getClass()]) === true;
    const requisicao = contexto.switchToHttp().getRequest<RequisicaoComUsuario>();
    const usuarioId = this.cookie.ler(requisicao);

    if (marcada(PUBLICO)) {
      const usuario = usuarioId ? await this.acesso.usuario(usuarioId).catch(() => null) : null;
      if (usuario?.empresaId) definirEmpresa(usuario.empresaId);
      return true;
    }

    const usuario = usuarioId ? await this.acesso.usuario(usuarioId) : null;
    if (!usuario) throw new ErroDeDominio('sessao-expirada', 'Sua sessão terminou. Entre de novo.');
    requisicao.usuario = usuario;
    if (marcada(PARA_TODOS)) {
      if (usuario.empresaId) definirEmpresa(usuario.empresaId);
      return true;
    }
    if (marcada(SO_ADMINISTRADOR)) {
      if (usuario.empresaId !== null) throw new ErroDeDominio('so-administrador', 'Só o administrador do sistema acessa o painel de empresas.');
      return true;
    }
    if (usuario.empresaId === null) throw new ErroDeDominio('so-empresa', 'O administrador usa só o painel de empresas.');
    definirEmpresa(usuario.empresaId);
    return true;
  }
}

/** Usuário logado, colocado na requisição pela GuardaDeSessao. */
export const UsuarioLogado = createParamDecorator(
  (_: unknown, contexto: ExecutionContext) => contexto.switchToHttp().getRequest<RequisicaoComUsuario>().usuario!,
);
