import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';

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

const DOMINGO = 0;
const SABADO = 6;

function lerIso(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function ehFimDeSemana(iso: string): boolean {
  const dia = lerIso(iso).getUTCDay();
  return dia === DOMINGO || dia === SABADO;
}

/** Vende-se só aos sábados e domingos, e uma data só pode ter um dia de venda. */
export function validarNovaData(iso: string, existentes: readonly string[]): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new ErroDeDominio('data-invalida', 'Escolha uma data.');
  }
  if (!ehFimDeSemana(iso)) {
    throw new ErroDeDominio('data-fora-do-fim-de-semana', 'Escolha um sábado ou um domingo.');
  }
  if (existentes.includes(iso)) {
    throw new ErroDeDominio('dia-ja-existe', 'Já existe um dia de venda nessa data.');
  }
}

/** Próximo domingo (a partir de hoje) que ainda não tem dia de venda. */
export function sugerirProximaData(hoje: string, existentes: readonly string[]): string {
  const data = lerIso(hoje);
  data.setUTCDate(data.getUTCDate() + ((7 - data.getUTCDay()) % 7));
  while (existentes.includes(paraIso(data))) {
    data.setUTCDate(data.getUTCDate() + 7);
  }
  return paraIso(data);
}
