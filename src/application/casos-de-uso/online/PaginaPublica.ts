import { randomBytes } from 'node:crypto';
import type { Dinheiro } from '../../../domain/compartilhado/Dinheiro.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir, naoEncontrado } from '../../../domain/compartilhado/naoEncontrado.js';
import { CONFIGURACAO_PADRAO, type Configuracao, encerramentoDoDia } from '../../../domain/configuracao/Configuracao.js';
import { type DiaVenda, estaAberto as diaAberto } from '../../../domain/dia-venda/DiaVenda.js';
import { disponiveis, type ItemSolicitado } from '../../../domain/disponibilidade/Disponibilidade.js';
import type { EntradaEspera } from '../../../domain/lista-espera/EntradaEspera.js';
import { type Pedido, type Retirada, totalDoPedido } from '../../../domain/pedido/Pedido.js';
import { definirEmpresa } from '../../contextoDaEmpresa.js';
import type { PublicadorDeEventos, Relogio, UnidadeDeTrabalho } from '../../portas/servicos.js';
import type { Espera } from '../cadastros/Cadastros.js';
import type { Pedidos } from '../pedidos/Pedidos.js';

/** O que a página pública mostra: a vitrine da empresa, sem nada da operação interna. */
export interface Loja {
  readonly nome: string;
  readonly corPrincipal: string;
  readonly logoUrl?: string;
  readonly enderecoRetirada?: string;
  readonly aviso?: string;
  /** Falso: a empresa desligou os pedidos online (a página só mostra o aviso). */
  readonly aceitandoPedidos: boolean;
  readonly maximoPorProduto: number;
  /** Dias abertos cujo prazo ainda não passou, do mais próximo ao mais distante. */
  readonly dias: readonly DiaDaLoja[];
}

export interface DiaDaLoja {
  readonly id: string;
  readonly data: string;
  /** Até quando dá para pedir e cancelar (ISO). */
  readonly encerraEm: string;
  readonly produtos: readonly { produtoId: string; nome: string; preco: Dinheiro; disponiveis: number }[];
}

/** O pedido visto pelo link do cliente: sem telefone, sem quem atendeu. */
export interface AcompanhamentoPedido {
  readonly numero: number;
  readonly cliente: string;
  readonly itens: readonly { nome: string; quantidade: number; precoUnitario: Dinheiro }[];
  readonly total: Dinheiro;
  readonly retirada: Retirada;
  readonly data: string;
  readonly estabelecimento: { readonly nome: string; readonly corPrincipal: string; readonly enderecoRetirada?: string; readonly endereco?: string };
  readonly cancelavelAte: string;
  readonly podeCancelar: boolean;
}

export interface PedidoDaPagina {
  readonly diaId: string;
  readonly cliente: { readonly nome: string; readonly telefone?: string };
  readonly itens: readonly ItemSolicitado[];
}

/** Quantos pedidos reservados o mesmo telefone pode ter no mesmo dia pela página. */
export const PEDIDOS_POR_TELEFONE = 3;
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * A página em que os próprios clientes reservam. Não há login: a empresa vem do endereço
 * da página (ou do código do pedido), e só o que é da vitrine sai daqui.
 * A reserva passa pela mesma trava do balcão, então nunca vende além da produção.
 */
export class PaginaPublica {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly pedidos: Pedidos,
    private readonly espera: Espera,
    private readonly eventos: PublicadorDeEventos,
    private readonly relogio: Relogio,
  ) {}

  async loja(endereco: string): Promise<Loja> {
    const config = await this.entrarNaLoja(endereco);
    const online = config.pedidosOnline;
    const base = {
      nome: config.nomeEstabelecimento,
      corPrincipal: config.corPrincipal,
      ...(config.logoUrl && { logoUrl: config.logoUrl }),
      ...(config.enderecoRetirada && { enderecoRetirada: config.enderecoRetirada }),
      ...(online.aviso && { aviso: online.aviso }),
      aceitandoPedidos: online.ativo,
      maximoPorProduto: online.maximoPorProduto,
    };
    if (!online.ativo) return { ...base, dias: [] };

    const r = this.uow.leitura;
    const agora = this.relogio.agora();
    const ativos = new Map((await r.produtos.listar()).filter((p) => p.ativo).map((p) => [p.id, p]));
    const dias = (await r.dias.listar()).filter((d) => diaAberto(d) && this.prazo(d, config) > agora);
    return {
      ...base,
      dias: await Promise.all(
        dias.map(async (d) => ({
          id: d.id,
          data: d.data,
          encerraEm: this.prazo(d, config).toISOString(),
          produtos: (await r.producao.estoques(d.id))
            .filter((e) => ativos.has(e.produtoId))
            .map((e) => ({ produtoId: e.produtoId, nome: e.nome, preco: ativos.get(e.produtoId)!.preco, disponiveis: disponiveis(e) })),
        })),
      ),
    };
  }

  /** Reserva feita pelo próprio cliente. Devolve o código secreto do link de acompanhamento. */
  async reservar(endereco: string, pedido: PedidoDaPagina): Promise<{ codigo: string; numero: number }> {
    const config = await this.entrarNaLoja(endereco);
    await this.conferirPrazo(pedido.diaId, config);
    const telefone = exigirTelefone(pedido.cliente.telefone);
    const maximo = config.pedidosOnline.maximoPorProduto;
    if (pedido.itens.some((i) => i.quantidade > maximo)) {
      throw new ErroDeDominio('acima-do-maximo', `Cada pedido leva até ${maximo} unidades de cada produto.`);
    }
    if ((await this.uow.leitura.pedidos.reservadosOnline(pedido.diaId, telefone)) >= PEDIDOS_POR_TELEFONE) {
      throw new ErroDeDominio('muitos-pedidos', 'Este telefone já tem pedidos demais para este dia. Fale com a loja.');
    }
    const codigo = randomBytes(24).toString('base64url');
    const criado = await this.pedidos.criar({ diaId: pedido.diaId, cliente: { nome: pedido.cliente.nome, telefone }, itens: pedido.itens }, null, codigo);
    this.eventos.publicar(criado.diaId, { tipo: 'pedido-online', numero: criado.numero, cliente: criado.cliente.nome });
    return { codigo, numero: criado.numero };
  }

  /** "Me avise se sobrar": entra na lista de espera do produto. */
  async entrarNaEspera(
    endereco: string,
    entrada: { diaId: string; produtoId: string; cliente: { nome: string; telefone?: string }; quantidade: number },
  ): Promise<EntradaEspera> {
    const config = await this.entrarNaLoja(endereco);
    await this.conferirPrazo(entrada.diaId, config);
    const telefone = exigirTelefone(entrada.cliente.telefone);
    if (entrada.quantidade > config.pedidosOnline.maximoPorProduto) {
      throw new ErroDeDominio('acima-do-maximo', `Cada pedido leva até ${config.pedidosOnline.maximoPorProduto} unidades de cada produto.`);
    }
    return this.espera.adicionar({ ...entrada, cliente: { nome: entrada.cliente.nome, telefone } });
  }

  async acompanhar(codigo: string): Promise<AcompanhamentoPedido> {
    const { config, pedido, dia } = await this.entrarNoPedido(codigo);
    return this.paraAcompanhamento(config, pedido, dia);
  }

  /** O cliente cancela pelo link, até o mesmo prazo dos pedidos. */
  async cancelar(codigo: string): Promise<AcompanhamentoPedido> {
    const { config, pedido, dia } = await this.entrarNoPedido(codigo);
    if (pedido.retirada !== 'reservado') throw new ErroDeDominio('pedido-fechado', 'Este pedido já foi retirado ou cancelado.');
    if (!this.podeCancelar(pedido, dia, config)) {
      throw new ErroDeDominio('cancelamento-encerrado', 'O prazo para cancelar pela página acabou. Fale com a loja.');
    }
    await this.pedidos.cancelar(pedido.id, null);
    const atualizado = existir(await this.uow.leitura.pedidos.obter(pedido.id), 'Pedido');
    return this.paraAcompanhamento(config, atualizado, dia);
  }

  /** Acha a empresa pelo endereço e passa a trabalhar dentro dela. Empresa desativada não tem página. */
  private async entrarNaLoja(endereco: string): Promise<Configuracao> {
    const dono = await this.uow.leitura.configuracao.porEndereco(endereco.trim().toLowerCase());
    if (!dono || !dono.empresaAtiva) throw new ErroDeDominio('nao-encontrado', 'Página não encontrada.');
    definirEmpresa(dono.empresaId);
    return (await this.uow.leitura.configuracao.obter()) ?? CONFIGURACAO_PADRAO;
  }

  private async entrarNoPedido(codigo: string) {
    const achado = CODIGO_VALIDO.test(codigo) ? await this.uow.leitura.pedidos.porCodigo(codigo) : null;
    if (!achado || !achado.empresaAtiva) throw naoEncontrado('Pedido');
    definirEmpresa(achado.empresaId);
    const config = (await this.uow.leitura.configuracao.obter()) ?? CONFIGURACAO_PADRAO;
    const pedido = existir(await this.uow.leitura.pedidos.obter(achado.pedidoId), 'Pedido');
    const dia = existir(await this.uow.leitura.dias.obter(pedido.diaId), 'Dia de venda');
    return { config, pedido, dia };
  }

  /** Página ligada, dia aberto e dentro do prazo. */
  private async conferirPrazo(diaId: string, config: Configuracao) {
    if (!config.pedidosOnline.ativo) {
      throw new ErroDeDominio('pedidos-online-fechados', 'Esta loja não está recebendo pedidos pelo site agora.');
    }
    const dia = existir(await this.uow.leitura.dias.obter(diaId), 'Dia de venda');
    if (!diaAberto(dia) || this.prazo(dia, config) <= this.relogio.agora()) {
      throw new ErroDeDominio('pedidos-online-encerrados', 'Os pedidos pelo site para este dia já foram encerrados.');
    }
  }

  private prazo(dia: DiaVenda, config: Configuracao): Date {
    return encerramentoDoDia(dia.data, config.pedidosOnline.encerramentoMinutos);
  }

  private podeCancelar(pedido: Pedido, dia: DiaVenda, config: Configuracao) {
    return pedido.retirada === 'reservado' && diaAberto(dia) && this.prazo(dia, config) > this.relogio.agora();
  }

  private paraAcompanhamento(config: Configuracao, pedido: Pedido, dia: DiaVenda): AcompanhamentoPedido {
    return {
      numero: pedido.numero,
      cliente: pedido.cliente.nome,
      itens: pedido.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, precoUnitario: i.precoUnitario })),
      total: totalDoPedido(pedido),
      retirada: pedido.retirada,
      data: dia.data,
      estabelecimento: {
        nome: config.nomeEstabelecimento,
        corPrincipal: config.corPrincipal,
        ...(config.enderecoRetirada && { enderecoRetirada: config.enderecoRetirada }),
        ...(config.pedidosOnline.ativo && config.pedidosOnline.endereco && { endereco: config.pedidosOnline.endereco }),
      },
      cancelavelAte: this.prazo(dia, config).toISOString(),
      podeCancelar: this.podeCancelar(pedido, dia, config),
    };
  }
}

/** Pela página o telefone é obrigatório: é por ele que a loja confirma e avisa. */
function exigirTelefone(telefone: string | undefined): string {
  const digitos = telefone?.replace(/\D/g, '') ?? '';
  if (digitos.length < 10 || digitos.length > 13) throw new ErroDeDominio('telefone-invalido', 'Informe um WhatsApp com DDD.');
  return digitos;
}
