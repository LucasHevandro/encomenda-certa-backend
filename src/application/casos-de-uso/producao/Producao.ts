import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir } from '../../../domain/compartilhado/naoEncontrado.js';
import { garantirAberto } from '../../../domain/dia-venda/DiaVenda.js';
import type { EstoqueDoProduto } from '../../../domain/disponibilidade/Disponibilidade.js';
import { validarNovaProducao } from '../../../domain/producao/Producao.js';
import type { AlteracaoProducao } from '../../portas/repositorios.js';
import type { PublicadorDeEventos, Relogio, UnidadeDeTrabalho } from '../../portas/servicos.js';

export interface NovaProducao {
  readonly produtoId: string;
  readonly quantidade: number;
}

export class Producao {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly eventos: PublicadorDeEventos,
    private readonly relogio: Relogio,
  ) {}

  async obter(diaId: string): Promise<EstoqueDoProduto[]> {
    existir(await this.uow.leitura.dias.obter(diaId), 'Dia de venda');
    return this.uow.leitura.producao.estoques(diaId);
  }

  historico(diaId: string): Promise<AlteracaoProducao[]> {
    return this.uow.leitura.producao.historico(diaId);
  }

  /**
   * Trava a produção, bloqueia abaixo de reservados + vendidos e registra quem mudou de quanto para quanto.
   * Produto que ainda não estava no dia entra com produção zero.
   */
  async salvar(diaId: string, novas: readonly NovaProducao[], usuarioId: string): Promise<void> {
    const ids = novas.map((n) => n.produtoId);
    if (new Set(ids).size !== ids.length) throw new ErroDeDominio('producao-invalida', 'Produto repetido.');
    const mudou = await this.uow.executar(async (r) => {
      garantirAberto(await r.dias.travarParaEscrita(diaId));
      const produtos = await r.produtos.porIds(ids);
      if (produtos.length !== ids.length) throw new ErroDeDominio('nao-encontrado', 'Produto não encontrado.');
      const estoques = await r.producao.travar(diaId, ids);
      const em = this.relogio.agora();
      let alguma = false;
      for (const nova of novas) {
        const estoque = estoques.find((e) => e.produtoId === nova.produtoId) ?? {
          produtoId: nova.produtoId,
          nome: '',
          producao: 0,
          reservados: 0,
          vendidos: 0,
        };
        validarNovaProducao(estoque, nova.quantidade);
        if (estoque.producao === nova.quantidade) continue;
        await r.producao.definir(diaId, nova.produtoId, nova.quantidade);
        await r.producao.registrarAlteracao({ diaId, produtoId: nova.produtoId, de: estoque.producao, para: nova.quantidade, usuarioId, em });
        alguma = true;
      }
      return alguma;
    });
    if (mudou) this.eventos.publicar(diaId, { tipo: 'disponibilidade-mudou' });
  }
}
