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
  /** Página pública em que os próprios clientes reservam. */
  readonly pedidosOnline: PedidosOnline;
}

export interface PedidosOnline {
  /** Ligado: a página aceita pedidos. Desligado: mostra que os pedidos pelo site estão fechados. */
  readonly ativo: boolean;
  /** Endereço da página (/loja/expresso-cafe): letras minúsculas, números e hífen, único no sistema. */
  readonly endereco?: string;
  /** Até quando a página aceita pedidos e cancelamentos, em minutos a partir da meia-noite do dia de venda (-240 = véspera às 20h). */
  readonly encerramentoMinutos: number;
  /** Teto de unidades de cada produto em um pedido feito pela página. */
  readonly maximoPorProduto: number;
  /** Recado que aparece no topo da página (opcional). */
  readonly aviso?: string;
}

/** Opções de "Receber pedidos até", em minutos a partir da meia-noite do dia de venda. */
export const ENCERRAMENTOS_ONLINE = [-360, -240, -120, 0, 540] as const;

export const PEDIDOS_ONLINE_PADRAO: PedidosOnline = { ativo: false, encerramentoMinutos: -240, maximoPorProduto: 10 };

const ENDERECO_VALIDO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** "Expresso Café" → "expresso-cafe": sugestão de endereço a partir do nome. */
export function sugerirEndereco(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function validarPedidosOnline(p: PedidosOnline): PedidosOnline {
  const endereco = p.endereco?.trim().toLowerCase() || undefined;
  if (endereco && !ENDERECO_VALIDO.test(endereco)) {
    throw new ErroDeDominio('config-endereco', 'O endereço da página usa de 3 a 40 letras minúsculas, números e hífen.');
  }
  if (p.ativo && !endereco) throw new ErroDeDominio('config-endereco', 'Escolha o endereço da página para receber pedidos online.');
  if (!ENCERRAMENTOS_ONLINE.includes(p.encerramentoMinutos as never)) {
    throw new ErroDeDominio('config-encerramento', 'Escolha até quando a página recebe pedidos.');
  }
  if (!Number.isInteger(p.maximoPorProduto) || p.maximoPorProduto < 1 || p.maximoPorProduto > 99) {
    throw new ErroDeDominio('config-maximo', 'O máximo por produto vai de 1 a 99.');
  }
  const aviso = p.aviso?.trim() || undefined;
  if (aviso && aviso.length > 200) throw new ErroDeDominio('config-aviso', 'O aviso da página tem até 200 letras.');
  return { ativo: p.ativo, endereco, encerramentoMinutos: p.encerramentoMinutos, maximoPorProduto: p.maximoPorProduto, aviso };
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
  pedidosOnline: PEDIDOS_ONLINE_PADRAO,
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
    pedidosOnline: validarPedidosOnline(c.pedidosOnline ?? PEDIDOS_ONLINE_PADRAO),
  };
}

/**
 * Momento em que a página para de aceitar pedidos (e cancelamentos) de um dia de venda.
 * O horário é o de Brasília (UTC−3, sem horário de verão desde 2019).
 */
export function encerramentoDoDia(dataIso: string, encerramentoMinutos: number): Date {
  const meiaNoite = new Date(`${dataIso}T00:00:00-03:00`);
  return new Date(meiaNoite.getTime() + encerramentoMinutos * 60_000);
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
