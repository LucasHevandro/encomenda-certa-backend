import { ErroDeDominio } from '../compartilhado/ErroDeDominio.js';

export type FormaDePagamento = 'pix' | 'dinheiro' | 'cartao';

/** O que muda de um estabelecimento para outro, editado na tela Configurações. */
export interface Configuracao {
  readonly nomeEstabelecimento: string;
  /** Cor principal (botões, destaques), em #rrggbb. */
  readonly corPrincipal: string;
  /** Endereço de uma imagem pública com o logo (opcional). */
  readonly logoUrl?: string;
  /** Onde o cliente busca o pedido; entra na mensagem do WhatsApp. */
  readonly enderecoRetirada?: string;
  /** Dias da semana em que se vende: 0 = domingo … 6 = sábado. */
  readonly diasDeVenda: readonly number[];
  /** Com essa quantidade ou menos, o produto aparece como "Atenção". */
  readonly limiteAtencao: number;
  /** "Pendente" sempre existe; estas são as formas aceitas para marcar como pago. */
  readonly formasDePagamento: readonly FormaDePagamento[];
  /** Modelo da confirmação. Campos: {cliente} {numero} {itens} {total} {data} {estabelecimento} {endereco}. */
  readonly mensagemWhatsapp: string;
}

export const NOMES_DOS_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
export const FORMAS_DE_PAGAMENTO: readonly FormaDePagamento[] = ['pix', 'dinheiro', 'cartao'];
export const CAMPOS_DA_MENSAGEM = ['cliente', 'numero', 'itens', 'total', 'data', 'estabelecimento', 'endereco'] as const;

export const CONFIGURACAO_PADRAO: Configuracao = {
  nomeEstabelecimento: 'Encomenda Certa',
  corPrincipal: '#b5441a',
  diasDeVenda: [6, 0],
  limiteAtencao: 3,
  formasDePagamento: ['pix', 'dinheiro', 'cartao'],
  mensagemWhatsapp: [
    'Olá, {cliente}! 🍗',
    'Sua reserva no {estabelecimento} está confirmada.',
    '',
    '*Pedido {numero}*',
    '{itens}',
    '',
    '*Total: {total}*',
    'Retirada: {data}',
    '{endereco}',
    '',
    'Obrigado pela preferência!',
  ].join('\n'),
};

/** Confere e limpa o que veio da tela; lança ErroDeDominio com a frase para quem está configurando. */
export function validarConfiguracao(c: Configuracao): Configuracao {
  const nome = c.nomeEstabelecimento.trim();
  if (nome === '' || nome.length > 60) throw new ErroDeDominio('config-nome', 'Informe o nome do estabelecimento (até 60 letras).');
  const cor = c.corPrincipal.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(cor)) throw new ErroDeDominio('config-cor', 'Escolha uma cor no formato #rrggbb.');
  const logo = c.logoUrl?.trim() || undefined;
  if (logo && !/^https:\/\/\S+$/.test(logo)) throw new ErroDeDominio('config-logo', 'O logo precisa ser um endereço https.');
  const dias = [...new Set(c.diasDeVenda)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (dias.length === 0) throw new ErroDeDominio('config-dias', 'Escolha pelo menos um dia de venda.');
  if (!Number.isInteger(c.limiteAtencao) || c.limiteAtencao < 0 || c.limiteAtencao > 99) {
    throw new ErroDeDominio('config-limite', 'O limite de atenção vai de 0 a 99.');
  }
  const formas = FORMAS_DE_PAGAMENTO.filter((f) => c.formasDePagamento.includes(f));
  if (formas.length === 0) throw new ErroDeDominio('config-pagamento', 'Aceite pelo menos uma forma de pagamento.');
  const mensagem = c.mensagemWhatsapp.trim();
  if (mensagem === '' || mensagem.length > 1000) throw new ErroDeDominio('config-mensagem', 'Escreva a mensagem do WhatsApp (até 1000 letras).');
  return {
    nomeEstabelecimento: nome,
    corPrincipal: cor,
    logoUrl: logo,
    enderecoRetirada: c.enderecoRetirada?.trim() || undefined,
    // Ordem da semana começando no domingo, para a tela e as mensagens.
    diasDeVenda: dias.sort((a, b) => a - b),
    limiteAtencao: c.limiteAtencao,
    formasDePagamento: formas,
    mensagemWhatsapp: mensagem,
  };
}

/** "sábado ou domingo", "segunda a sexta"… para as mensagens de erro e de ajuda. */
export function descreverDias(dias: readonly number[]): string {
  const ordem = [...dias].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // segunda primeiro
  const nomes = ordem.map((d) => NOMES_DOS_DIAS[d]);
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}`;
}

/** Troca {campo} pelo valor; linhas que ficarem vazias por falta de valor somem. */
export function preencherMensagem(modelo: string, valores: Partial<Record<(typeof CAMPOS_DA_MENSAGEM)[number], string>>): string {
  return modelo
    .split('\n')
    .map((linha) => {
      let vazia = false;
      const preenchida = linha.replace(/\{(\w+)\}/g, (inteiro, campo: string) => {
        const valor = valores[campo as keyof typeof valores];
        if (valor === undefined) {
          if (CAMPOS_DA_MENSAGEM.includes(campo as never)) vazia = true;
          return CAMPOS_DA_MENSAGEM.includes(campo as never) ? '' : inteiro;
        }
        return valor;
      });
      return vazia && preenchida.trim() === '' ? null : preenchida;
    })
    .filter((linha): linha is string => linha !== null)
    .join('\n');
}
