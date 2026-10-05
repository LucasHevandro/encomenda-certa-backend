import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { QuantidadeIndisponivel } from '../../../domain/disponibilidade/Disponibilidade.js';
import { ProducaoAbaixoDoComprometido } from '../../../domain/producao/Producao.js';

const STATUS: Record<string, number> = {
  'nao-encontrado': 404,
  'sessao-expirada': 401,
  'login-invalido': 401,
  'quantidade-indisponivel': 409,
  'producao-abaixo-do-comprometido': 409,
  'dia-ja-existe': 409,
  'email-ja-existe': 409,
  'pedido-fechado': 409,
  'dia-encerrado': 409,
  'pedido-nao-cancelado': 409,
  'senha-atual-incorreta': 422,
  'muitas-tentativas': 429,
};

/**
 * ErroDeDominio → { codigo, mensagem, ...detalhes } com a mensagem do balcão.
 * O 409 de quantidade indisponível traz o máximo, que o app usa no "Reservar N".
 */
@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly log = new Logger('Erros');

  catch(erro: unknown, host: ArgumentsHost) {
    const resposta = host.switchToHttp().getResponse<Response>();

    if (erro instanceof QuantidadeIndisponivel) {
      const { codigo, message, produtoId, nome, solicitado, maximo } = erro;
      return resposta.status(409).json({ codigo, mensagem: message, produtoId, nome, solicitado, maximo });
    }
    if (erro instanceof ProducaoAbaixoDoComprometido) {
      const { codigo, message, produtoId, novaProducao, minimo } = erro;
      return resposta.status(409).json({ codigo, mensagem: message, produtoId, novaProducao, minimo });
    }
    if (erro instanceof ErroDeDominio) {
      return resposta.status(STATUS[erro.codigo] ?? 422).json({ codigo: erro.codigo, mensagem: erro.message });
    }
    if (erro instanceof HttpException) {
      const status = erro.getStatus();
      return resposta.status(status).json({ codigo: status === 404 ? 'rota-inexistente' : 'requisicao-invalida', mensagem: erro.message });
    }
    this.log.error(erro);
    return resposta.status(500).json({ codigo: 'erro-interno', mensagem: 'Algo deu errado. Tente de novo.' });
  }
}
