import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';

export interface ConfigLimite {
  /** Erros seguidos permitidos antes de bloquear. */
  readonly maximo: number;
  /** Janela em que os erros são contados e tempo do bloqueio. */
  readonly janelaMs: number;
}

interface Registro {
  erros: number;
  desde: number;
  bloqueadoAte?: number;
}

/**
 * Freio contra quem tenta adivinhar senha: depois de `maximo` erros seguidos para o mesmo
 * e-mail vindo do mesmo endereço, recusa novas tentativas por um tempo. Acertar zera a conta.
 * Fica na memória do processo; com mais de uma instância da API, mova para o banco ou Redis.
 */
export class LimiteDeTentativas {
  private readonly registros = new Map<string, Registro>();

  constructor(
    private readonly config: ConfigLimite = { maximo: 5, janelaMs: 15 * 60 * 1000 },
    private readonly agora: () => number = Date.now,
  ) {}

  /** Lança 429 "muitas-tentativas" se a chave estiver bloqueada. */
  conferir(chave: string): void {
    const registro = this.registros.get(chave);
    if (!registro?.bloqueadoAte) return;
    const falta = registro.bloqueadoAte - this.agora();
    if (falta <= 0) {
      this.registros.delete(chave);
      return;
    }
    const minutos = Math.ceil(falta / 60_000);
    throw new ErroDeDominio(
      'muitas-tentativas',
      `Muitas tentativas de entrar. Tente de novo em ${minutos === 1 ? '1 minuto' : `${minutos} minutos`}.`,
    );
  }

  registrarErro(chave: string): void {
    const agora = this.agora();
    const atual = this.registros.get(chave);
    const registro = atual && agora - atual.desde < this.config.janelaMs ? atual : { erros: 0, desde: agora };
    registro.erros += 1;
    if (registro.erros >= this.config.maximo) registro.bloqueadoAte = agora + this.config.janelaMs;
    this.registros.set(chave, registro);
    this.limparVencidos(agora);
  }

  registrarAcerto(chave: string): void {
    this.registros.delete(chave);
  }

  /** Evita que a memória cresça com tentativas antigas. */
  private limparVencidos(agora: number) {
    if (this.registros.size < 1000) return;
    for (const [chave, r] of this.registros) {
      if ((r.bloqueadoAte ?? r.desde + this.config.janelaMs) < agora) this.registros.delete(chave);
    }
  }
}
