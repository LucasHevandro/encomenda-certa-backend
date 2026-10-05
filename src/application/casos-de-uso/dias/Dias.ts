import { type Dinheiro, somar } from '../../../domain/compartilhado/Dinheiro.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir } from '../../../domain/compartilhado/naoEncontrado.js';
import { type DiaVenda, garantirAberto, validarNovaData } from '../../../domain/dia-venda/DiaVenda.js';
import { disponiveis, type EstoqueDoProduto } from '../../../domain/disponibilidade/Disponibilidade.js';
import { calcularFechamento } from '../../../domain/fechamento/Fechamento.js';
import { totalDoPedido } from '../../../domain/pedido/Pedido.js';
import type { DiaFechado, SugestaoProducao } from '../../portas/repositorios.js';
import type { PublicadorDeEventos, Relogio, UnidadeDeTrabalho } from '../../portas/servicos.js';

/** Linha da tela "Dias de venda". */
export interface ResumoDia {
  readonly dia: DiaVenda;
  readonly pedidos: number;
  readonly itensDisponiveis: number;
  readonly faturamento?: Dinheiro;
  readonly sobras?: number;
}

/** Tudo o que a tela Início mostra. */
export interface PainelDoDia {
  readonly dia: DiaVenda;
  readonly estoques: readonly EstoqueDoProduto[];
  readonly pedidos: number;
  readonly itensReservados: number;
  readonly valorReservado: Dinheiro;
  readonly aguardandoRetirada: number;
  readonly proximoARetirar?: { readonly numero: number; readonly cliente: string };
  readonly clientesAguardando: Readonly<Record<string, number>>;
}

export interface AbrirDia {
  readonly data: string;
  readonly producao: readonly { readonly produtoId: string; readonly quantidade: number }[];
}

export class Dias {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly eventos: PublicadorDeEventos,
    private readonly relogio: Relogio,
  ) {}

  /** Abertos com pedidos e disponíveis; encerrados com faturamento e sobras da foto do fechamento. */
  async listar(): Promise<ResumoDia[]> {
    const r = this.uow.leitura;
    const dias = await r.dias.listar();
    return Promise.all(
      dias.map(async (dia) => {
        const [pedidos, estoques, fechamento] = await Promise.all([r.pedidos.listar(dia.id), r.producao.estoques(dia.id), r.fechamentos.resumo(dia.id)]);
        return {
          dia,
          pedidos: pedidos.filter((p) => p.retirada !== 'cancelado').length,
          itensDisponiveis: estoques.reduce((t, e) => t + disponiveis(e), 0),
          faturamento: fechamento?.faturamento,
          sobras: fechamento?.sobras,
        };
      }),
    );
  }

  async painel(diaId: string): Promise<PainelDoDia> {
    const r = this.uow.leitura;
    const dia = existir(await r.dias.obter(diaId), 'Dia de venda');
    const [estoques, pedidos, espera] = await Promise.all([r.producao.estoques(diaId), r.pedidos.listar(diaId), r.espera.listar(diaId)]);
    const validos = pedidos.filter((p) => p.retirada !== 'cancelado');
    const reservados = validos.filter((p) => p.retirada === 'reservado').sort((a, b) => a.numero - b.numero);
    const clientesAguardando: Record<string, number> = {};
    for (const entrada of espera) {
      if (entrada.status === 'aguardando') clientesAguardando[entrada.produtoId] = (clientesAguardando[entrada.produtoId] ?? 0) + 1;
    }
    return {
      dia,
      estoques,
      pedidos: validos.length,
      itensReservados: reservados.flatMap((p) => p.itens).reduce((t, i) => t + i.quantidade, 0),
      valorReservado: somar(...reservados.map(totalDoPedido)),
      aguardandoRetirada: reservados.length,
      proximoARetirar: reservados[0] && { numero: reservados[0].numero, cliente: reservados[0].cliente.nome },
      clientesAguardando,
    };
  }

  sugestaoProducao(): Promise<SugestaoProducao[]> {
    return this.uow.leitura.producao.sugestao();
  }

  /** Últimos dias fechados (até 26, meio ano de domingos), com a foto de cada produto. */
  relatorio(dias = 8): Promise<DiaFechado[]> {
    return this.uow.leitura.fechamentos.ultimos(Math.min(Math.max(1, Math.trunc(dias) || 8), 26));
  }

  async abrir(comando: AbrirDia): Promise<DiaVenda> {
    if (comando.producao.some((p) => !Number.isInteger(p.quantidade) || p.quantidade < 0)) {
      throw new ErroDeDominio('producao-invalida', 'Produção inválida.');
    }
    return this.uow.executar(async (r) => {
      validarNovaData(comando.data, await r.dias.datas());
      const ids = comando.producao.map((p) => p.produtoId);
      const produtos = await r.produtos.porIds(ids);
      if (produtos.length !== new Set(ids).size) throw new ErroDeDominio('nao-encontrado', 'Produto não encontrado.');
      const dia = await r.dias.criar(comando.data);
      for (const p of comando.producao) await r.producao.definir(dia.id, p.produtoId, p.quantidade);
      return dia;
    });
  }

  /** Grava a foto do dia (por produto e faturamento) e deixa o dia somente leitura. */
  async fechar(diaId: string): Promise<void> {
    await this.uow.executar(async (r) => {
      garantirAberto(await r.dias.travar(diaId));
      const [estoques, pedidos] = await Promise.all([r.producao.estoques(diaId), r.pedidos.listar(diaId)]);
      const fechamento = calcularFechamento(estoques, pedidos);
      await r.fechamentos.gravar(diaId, fechamento.produtos, fechamento.totalVendido);
      await r.dias.encerrar(diaId, this.relogio.agora());
    });
    this.eventos.publicar(diaId, { tipo: 'disponibilidade-mudou' });
  }
}
