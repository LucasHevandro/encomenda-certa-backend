import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';
import { comprometidos, type EstoqueDoProduto } from '../disponibilidade/Disponibilidade.js';

export class ProducaoAbaixoDoComprometido extends ErroDeDominio {
  constructor(
    readonly produtoId: string,
    readonly novaProducao: number,
    /** Reservados + vendidos: a produção não pode ficar abaixo disso. */
    readonly minimo: number,
  ) {
    super(
      'producao-abaixo-do-comprometido',
      `Existem ${minimo} unidades reservadas ou vendidas, mas a nova produção seria de apenas ${novaProducao}. Ajuste para pelo menos ${minimo}.`,
    );
  }
}

export function minimoPermitido(estoque: EstoqueDoProduto): number {
  return comprometidos(estoque);
}

export function validarNovaProducao(estoque: EstoqueDoProduto, novaProducao: number): void {
  if (!Number.isInteger(novaProducao) || novaProducao < 0) {
    throw new ErroDeDominio('producao-invalida', `Produção inválida: ${novaProducao}`);
  }
  const minimo = minimoPermitido(estoque);
  if (novaProducao < minimo) {
    throw new ProducaoAbaixoDoComprometido(estoque.produtoId, novaProducao, minimo);
  }
}
