import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';
import { descreverDias } from '../configuracao/Configuracao.js';

export type StatusDia = 'aberto' | 'encerrado';

export interface DiaVenda {
  readonly id: string;
  /** Data no formato ISO (2026-10-04). Pode ser sábado ou domingo. */
  readonly data: string;
  readonly status: StatusDia;
}

export function estaAberto(dia: DiaVenda): boolean {
  return dia.status === 'aberto';
}

/** Dia encerrado recusa qualquer escrita. */
export function garantirAberto(dia: DiaVenda | null): DiaVenda {
  if (!dia) throw new ErroDeDominio('nao-encontrado', 'Dia de venda não encontrado.');
  if (!estaAberto(dia)) {
    throw new ErroDeDominio('dia-encerrado', 'Este dia já foi fechado e não recebe mais alterações.');
  }
  return dia;
}

/** Sábado e domingo, quando o estabelecimento não configurou outros dias. */
export const DIAS_PADRAO: readonly number[] = [6, 0];

function lerIso(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return lerIso(iso).getUTCDay();
}

export function ehFimDeSemana(iso: string): boolean {
  return DIAS_PADRAO.includes(diaDaSemana(iso));
}

/** Só se vende nos dias configurados, e uma data só pode ter um dia de venda. */
export function validarNovaData(iso: string, existentes: readonly string[], diasDeVenda: readonly number[] = DIAS_PADRAO): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new ErroDeDominio('data-invalida', 'Escolha uma data.');
  }
  if (!diasDeVenda.includes(diaDaSemana(iso))) {
    throw new ErroDeDominio('data-fora-dos-dias-de-venda', `Escolha um dia de venda: ${descreverDias(diasDeVenda)}.`);
  }
  if (existentes.includes(iso)) {
    throw new ErroDeDominio('dia-ja-existe', 'Já existe um dia de venda nessa data.');
  }
}

/** Próximo dia de venda (a partir de hoje) que ainda não foi aberto. */
export function sugerirProximaData(hoje: string, existentes: readonly string[], diasDeVenda: readonly number[] = [0]): string {
  const data = lerIso(hoje);
  // No máximo um ano à frente: sempre há um dia de venda livre antes disso.
  for (let i = 0; i < 366; i++) {
    if (diasDeVenda.includes(data.getUTCDay()) && !existentes.includes(paraIso(data))) return paraIso(data);
    data.setUTCDate(data.getUTCDate() + 1);
  }
  return hoje;
}
