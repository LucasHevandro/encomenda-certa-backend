import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';

/**
 * Freio contra robôs na página pública: no máximo `maximo` ações por chave (endereço de
 * quem acessa) dentro da janela. Fica na memória do processo, como o LimiteDeTentativas.
 */
export class LimiteDeFrequencia {
  private readonly registros = new Map<string, number[]>();

  constructor(
    // Folgado: vários clientes podem sair pelo mesmo endereço da operadora do celular.
    private readonly maximo = 30,
    private readonly janelaMs = 60 * 60 * 1000,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Conta uma ação; lança 429 "muitas-tentativas" se passou do limite. */
  registrar(chave: string): void {
    const agora = this.agora();
    const recentes = (this.registros.get(chave) ?? []).filter((em) => agora - em < this.janelaMs);
    if (recentes.length >= this.maximo) {
      this.registros.set(chave, recentes);
      throw new ErroDeDominio('muitas-tentativas', 'Muitos pedidos seguidos deste aparelho. Tente de novo mais tarde.');
    }
    recentes.push(agora);
    this.registros.set(chave, recentes);
    if (this.registros.size > 5000) this.limpar(agora);
  }

  private limpar(agora: number) {
    for (const [chave, ems] of this.registros) {
      if (ems.every((em) => agora - em >= this.janelaMs)) this.registros.delete(chave);
    }
  }
}
