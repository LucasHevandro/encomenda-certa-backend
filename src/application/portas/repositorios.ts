import type { Dinheiro } from '../../domain/compartilhado/Dinheiro.js';
import type { Configuracao } from '../../domain/configuracao/Configuracao.js';
import type { DiaVenda } from '../../domain/dia-venda/DiaVenda.js';
import type { EstoqueDoProduto, ItemSolicitado } from '../../domain/disponibilidade/Disponibilidade.js';
import type { FechamentoDoProduto } from '../../domain/fechamento/Fechamento.js';
import type { EntradaEspera } from '../../domain/lista-espera/EntradaEspera.js';
import type { ClienteDoPedido, Pagamento, Pedido, Retirada } from '../../domain/pedido/Pedido.js';
import type { Produto } from '../../domain/produto/Produto.js';

/**
 * Portas de saída: o que os casos de uso precisam guardar e ler. O adaptador Postgres implementa.
 * Tudo o que pertence a um estabelecimento é lido e gravado na empresa do contexto (contextoDaEmpresa);
 * só usuários (login) e empresas (painel do administrador) enxergam além dela.
 */

export interface Usuario {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  /** null: administrador do sistema, que só usa o painel de empresas. */
  readonly empresaId: string | null;
}

/** Usuário com a situação da empresa, para o login e a guarda de sessão. */
export interface UsuarioComEmpresa extends Usuario {
  /** Sempre true para o administrador. */
  readonly empresaAtiva: boolean;
}

export interface UsuarioRepo {
  /** Em qualquer empresa: o e-mail é único no sistema todo. */
  porEmail(email: string): Promise<(UsuarioComEmpresa & { senhaHash: string }) | null>;
  /** Em qualquer empresa: é a guarda de sessão que descobre a empresa por aqui. */
  porId(id: string): Promise<UsuarioComEmpresa | null>;
  /** Cria na empresa do contexto. */
  criar(usuario: { nome: string; email: string; senhaHash: string }): Promise<Usuario>;
  /** Pessoas da empresa do contexto. */
  listar(): Promise<Usuario[]>;
  senhaHash(id: string): Promise<string | null>;
  mudarSenha(id: string, senhaHash: string): Promise<void>;
}

export interface ProdutoRepo {
  listar(): Promise<Produto[]>;
  porIds(ids: readonly string[]): Promise<Produto[]>;
  criar(produto: { nome: string; preco: Dinheiro }): Promise<Produto>;
  atualizar(id: string, mudancas: { preco?: Dinheiro; ativo?: boolean }): Promise<Produto | null>;
}

export interface DiaRepo {
  listar(): Promise<DiaVenda[]>;
  obter(id: string): Promise<DiaVenda | null>;
  /** Trava o dia (FOR UPDATE) para ninguém escrever enquanto ele é fechado. */
  travar(id: string): Promise<DiaVenda | null>;
  /** Trava compartilhada (FOR SHARE): várias escritas ao mesmo tempo, mas não junto com o fechamento. */
  travarParaEscrita(id: string): Promise<DiaVenda | null>;
  datas(): Promise<string[]>;
  criar(data: string): Promise<DiaVenda>;
  encerrar(id: string, em: Date): Promise<void>;
}

export interface AlteracaoProducao {
  readonly produtoId: string;
  readonly de: number;
  readonly para: number;
  readonly em: string;
  readonly usuario: string;
}

export interface SugestaoProducao {
  readonly produtoId: string;
  readonly nome: string;
  readonly ultimo: number;
  readonly media: number;
  readonly sobraMedia: number;
}

export interface ProducaoRepo {
  /** Produção, reservados e vendidos de cada produto do dia, calculados das tabelas. */
  estoques(diaId: string): Promise<EstoqueDoProduto[]>;
  /**
   * Trava as linhas de produção (SELECT … FOR UPDATE, sempre na mesma ordem de produto)
   * e devolve os números já com a trava. É aqui que a corrida pelo último frango é resolvida.
   */
  travar(diaId: string, produtoIds: readonly string[]): Promise<EstoqueDoProduto[]>;
  definir(diaId: string, produtoId: string, quantidade: number): Promise<void>;
  registrarAlteracao(alteracao: { diaId: string; produtoId: string; de: number; para: number; usuarioId: string; em: Date }): Promise<void>;
  historico(diaId: string): Promise<AlteracaoProducao[]>;
  /** Último dia fechado, média dos últimos 4 e sobra média, por produto ativo. */
  sugestao(): Promise<SugestaoProducao[]>;
}

export interface FiltroPedidos {
  readonly retirada?: Retirada;
  readonly busca?: string;
}

export interface PedidoRepo {
  listar(diaId: string, filtro?: FiltroPedidos): Promise<Pedido[]>;
  /** Todos os pedidos de um cliente, do mais novo para o mais antigo, com a data do dia de venda. */
  doCliente(clienteId: string): Promise<{ pedido: Pedido; data: string }[]>;
  obter(id: string): Promise<Pedido | null>;
  /** Trava o pedido (FOR UPDATE) antes de mudar retirada, itens ou pagamento. */
  travar(id: string): Promise<Pedido | null>;
  criar(pedido: {
    diaId: string;
    clienteId: string;
    itens: readonly { produtoId: string; quantidade: number; precoUnitario: Dinheiro }[];
    usuarioId: string;
    em: Date;
  }): Promise<Pedido>;
  substituirItens(id: string, itens: readonly { produtoId: string; quantidade: number; precoUnitario: Dinheiro }[]): Promise<void>;
  mudarRetirada(id: string, retirada: Retirada, usuarioId: string, em: Date): Promise<void>;
  mudarPagamento(id: string, pagamento: Pagamento): Promise<void>;
}

export interface ClienteEncontrado {
  readonly id: string;
  readonly nome: string;
  readonly telefone?: string;
  readonly pedidosAnteriores: number;
}

export interface ClienteRepo {
  /** Telefone é único: se já existe, atualiza o nome; sem telefone, cria um novo cliente. */
  obterOuCriar(cliente: ClienteDoPedido): Promise<string>;
  porTelefone(telefone: string): Promise<ClienteEncontrado | null>;
  listar(): Promise<ClienteEncontrado[]>;
  obter(id: string): Promise<ClienteEncontrado | null>;
}

export interface EsperaRepo {
  listar(diaId: string): Promise<EntradaEspera[]>;
  obter(id: string): Promise<EntradaEspera | null>;
  /** Entra no fim da fila do produto. */
  adicionar(entrada: { diaId: string; produtoId: string; clienteId: string; quantidade: number }): Promise<EntradaEspera>;
  mudarStatus(id: string, status: EntradaEspera['status']): Promise<EntradaEspera>;
}

export interface FechamentoRepo {
  /** Foto do dia, gravada ao fechar: histórico e médias imunes a mudanças de preço. */
  gravar(diaId: string, produtos: readonly FechamentoDoProduto[], faturamento: Dinheiro): Promise<void>;
  resumo(diaId: string): Promise<{ faturamento: Dinheiro; sobras: number } | null>;
  /** Fotos dos últimos dias fechados, do mais recente para o mais antigo. */
  ultimos(limite: number): Promise<DiaFechado[]>;
}

export interface DiaFechado {
  readonly diaId: string;
  readonly data: string;
  readonly faturamento: Dinheiro;
  readonly produtos: readonly FechamentoDoProduto[];
}

export interface ConfiguracaoRepo {
  /** null quando o estabelecimento ainda não salvou nada (valem os padrões). */
  obter(): Promise<Configuracao | null>;
  salvar(configuracao: Configuracao): Promise<void>;
}

export interface Empresa {
  readonly id: string;
  readonly nome: string;
  readonly ativa: boolean;
  readonly criadaEm: string;
  readonly usuarios: number;
}

/** Só o painel do administrador usa: enxerga todas as empresas. */
export interface EmpresaRepo {
  listar(): Promise<Empresa[]>;
  obter(id: string): Promise<Empresa | null>;
  criar(nome: string): Promise<Empresa>;
  mudarAtiva(id: string, ativa: boolean): Promise<Empresa | null>;
  /** Primeiro usuário da empresa, criado pelo administrador. */
  criarUsuario(empresaId: string, usuario: { nome: string; email: string; senhaHash: string }): Promise<Usuario>;
  /** Administrador do sistema (sem empresa), criado pelo script admin:criar. */
  criarAdministrador(usuario: { nome: string; email: string; senhaHash: string }): Promise<Usuario>;
}

export interface Repositorios {
  readonly empresas: EmpresaRepo;
  readonly configuracao: ConfiguracaoRepo;
  readonly usuarios: UsuarioRepo;
  readonly produtos: ProdutoRepo;
  readonly dias: DiaRepo;
  readonly producao: ProducaoRepo;
  readonly pedidos: PedidoRepo;
  readonly clientes: ClienteRepo;
  readonly espera: EsperaRepo;
  readonly fechamentos: FechamentoRepo;
}

export type { ItemSolicitado };
