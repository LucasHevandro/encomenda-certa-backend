export interface EntradaEspera {
  readonly id: string;
  readonly diaId: string;
  readonly produtoId: string;
  readonly cliente: { readonly nome: string; readonly telefone?: string };
  readonly quantidade: number;
  /** 1 = primeiro da fila daquele produto. */
  readonly posicao: number;
  readonly status: 'aguardando' | 'atendido' | 'desistiu';
}
