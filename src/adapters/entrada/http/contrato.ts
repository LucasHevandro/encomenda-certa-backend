import { z } from 'zod';
import { esquemas } from './validacao.js';

/**
 * Contrato da API: o formato de cada resposta e a lista de rotas.
 * Daqui sai o openapi.json, e o front gera os tipos dele (openapi-typescript).
 * Os testes de integração conferem as respostas reais contra estes esquemas.
 * Dinheiro é sempre inteiro em centavos; datas de dia são "2026-10-04"; instantes são ISO.
 */

const centavos = z.number().int().nonnegative().describe('Valor em centavos (R$ 55,00 = 5500)');
const dataDoDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data do dia de venda, ex.: 2026-10-04');

export const Erro = z
  .object({
    codigo: z.string(),
    mensagem: z.string(),
    produtoId: z.string().optional(),
    nome: z.string().optional(),
    solicitado: z.number().int().optional(),
    maximo: z.number().int().optional().describe('No 409 quantidade-indisponivel: o máximo que ainda cabe'),
    novaProducao: z.number().int().optional(),
    minimo: z.number().int().optional(),
  })
  .meta({ id: 'Erro' });

export const Configuracao = z
  .object({
    nomeEstabelecimento: z.string(),
    corPrincipal: z.string().describe('#rrggbb'),
    logoUrl: z.string().optional(),
    enderecoRetirada: z.string().optional(),
    diasDeVenda: z.array(z.number().int()).describe('0 = domingo … 6 = sábado'),
    limiteAtencao: z.number().int(),
    formasDePagamento: z.array(z.enum(['pix', 'dinheiro', 'cartao'])),
    mensagemWhatsapp: z.string().describe('Campos: {cliente} {numero} {itens} {total} {data} {estabelecimento} {endereco}'),
  })
  .meta({ id: 'Configuracao' });

export const Usuario = z
  .object({ id: z.string(), nome: z.string(), email: z.string(), administrador: z.boolean().describe('Administrador do sistema: só usa o painel de empresas') })
  .meta({ id: 'Usuario' });

export const Empresa = z
  .object({ id: z.string(), nome: z.string(), ativa: z.boolean(), criadaEm: z.string(), usuarios: z.number().int().describe('Pessoas com acesso') })
  .meta({ id: 'Empresa' });

export const EmpresaCriada = z.object({ empresa: Empresa, usuario: Usuario }).meta({ id: 'EmpresaCriada' });

export const Produto = z.object({ id: z.string(), nome: z.string(), preco: centavos, ativo: z.boolean() }).meta({ id: 'Produto' });

export const DiaVenda = z.object({ id: z.string(), data: dataDoDia, status: z.enum(['aberto', 'encerrado']) }).meta({ id: 'DiaVenda' });

export const EstoqueDoProduto = z
  .object({
    produtoId: z.string(),
    nome: z.string(),
    producao: z.number().int(),
    reservados: z.number().int().describe('Itens de pedidos ainda não retirados'),
    vendidos: z.number().int().describe('Itens de pedidos já retirados'),
  })
  .meta({ id: 'EstoqueDoProduto' });

export const ItemPedido = z
  .object({ produtoId: z.string(), nome: z.string(), quantidade: z.number().int(), precoUnitario: centavos })
  .meta({ id: 'ItemPedido' });

export const RegistroDoPedido = z
  .object({
    reservadoPor: z.string().optional(),
    reservadoEm: z.string().optional(),
    retiradoPor: z.string().optional(),
    retiradoEm: z.string().optional(),
    canceladoPor: z.string().optional(),
    canceladoEm: z.string().optional(),
  })
  .meta({ id: 'RegistroDoPedido' });

export const Pedido = z
  .object({
    id: z.string(),
    numero: z.number().int(),
    diaId: z.string(),
    cliente: z.object({ nome: z.string(), telefone: z.string().optional() }),
    itens: z.array(ItemPedido),
    retirada: z.enum(['reservado', 'retirado', 'cancelado']),
    pagamento: z.enum(['pendente', 'pix', 'dinheiro', 'cartao']),
    registro: RegistroDoPedido.optional(),
  })
  .meta({ id: 'Pedido' });

export const ResultadoCancelamento = z
  .object({ unidadesLiberadas: z.number().int(), clientesAguardando: z.number().int() })
  .meta({ id: 'ResultadoCancelamento' });

export const ResumoDia = z
  .object({
    dia: DiaVenda,
    pedidos: z.number().int(),
    itensDisponiveis: z.number().int(),
    faturamento: centavos.optional(),
    sobras: z.number().int().optional(),
  })
  .meta({ id: 'ResumoDia' });

export const PainelDoDia = z
  .object({
    dia: DiaVenda,
    estoques: z.array(EstoqueDoProduto),
    pedidos: z.number().int(),
    itensReservados: z.number().int(),
    valorReservado: centavos,
    aguardandoRetirada: z.number().int(),
    proximoARetirar: z.object({ numero: z.number().int(), cliente: z.string() }).optional(),
    clientesAguardando: z.record(z.string(), z.number().int()),
  })
  .meta({ id: 'PainelDoDia' });

export const SugestaoProducao = z
  .object({ produtoId: z.string(), nome: z.string(), ultimo: z.number(), media: z.number(), sobraMedia: z.number() })
  .meta({ id: 'SugestaoProducao' });

export const AlteracaoProducao = z
  .object({ produtoId: z.string(), de: z.number().int(), para: z.number().int(), em: z.string(), usuario: z.string() })
  .meta({ id: 'AlteracaoProducao' });

export const ClienteEncontrado = z
  .object({ id: z.string(), nome: z.string(), telefone: z.string().optional(), pedidosAnteriores: z.number().int() })
  .meta({ id: 'ClienteEncontrado' });

export const HistoricoDoCliente = z
  .object({
    cliente: ClienteEncontrado,
    totalGasto: centavos,
    naoRetirados: z.number().int(),
    favoritos: z.array(z.object({ produtoId: z.string(), nome: z.string(), quantidade: z.number().int() })),
    pedidos: z.array(Pedido.extend({ data: dataDoDia })),
  })
  .meta({ id: 'HistoricoDoCliente' });

export const EntradaEspera = z
  .object({
    id: z.string(),
    diaId: z.string(),
    produtoId: z.string(),
    cliente: z.object({ nome: z.string(), telefone: z.string().optional() }),
    quantidade: z.number().int(),
    posicao: z.number().int(),
    status: z.enum(['aguardando', 'atendido', 'desistiu']),
  })
  .meta({ id: 'EntradaEspera' });

export const FechamentoDoProduto = z
  .object({
    produtoId: z.string(),
    nome: z.string(),
    produzidos: z.number().int(),
    reservados: z.number().int(),
    retirados: z.number().int(),
    naoRetirados: z.number().int(),
    sobras: z.number().int(),
  })
  .meta({ id: 'FechamentoDoProduto' });

export const DiaFechado = z
  .object({ diaId: z.string(), data: dataDoDia, faturamento: centavos, produtos: z.array(FechamentoDoProduto) })
  .meta({ id: 'DiaFechado' });

// Corpos das requisições, com nome para aparecerem como componentes.
const corpos = {
  Entrar: esquemas.entrar,
  SalvarConfiguracao: esquemas.configuracao,
  NovoUsuario: esquemas.novoUsuario,
  MudarSenha: esquemas.mudarSenha,
  NovoPedido: esquemas.novoPedido,
  EditarPedido: esquemas.editarPedido,
  Pagamento: esquemas.pagamento,
  AbrirDia: esquemas.abrirDia,
  SalvarProducao: esquemas.producao,
  NovoProduto: esquemas.novoProduto,
  MudarProduto: esquemas.mudarProduto,
  NovaEspera: esquemas.novaEspera,
  MudarEspera: esquemas.mudarEspera,
  NovaEmpresa: esquemas.novaEmpresa,
  MudarEmpresa: esquemas.mudarEmpresa,
} as const;
// .meta() devolve uma cópia; para dar nome ao próprio esquema usado na validação, registra direto.
for (const [id, esquema] of Object.entries(corpos)) z.globalRegistry.add(esquema, { id });

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Rota {
  metodo: Metodo;
  caminho: string;
  resumo: string;
  corpo?: z.ZodType;
  /** Sem resposta = 204. */
  resposta?: z.ZodType;
  status?: number;
  publica?: boolean;
  /** Só o administrador do sistema. */
  administrador?: boolean;
  query?: Record<string, string>;
}

/** Todas as rotas. Um teste confere que cada uma existe e responde neste formato. */
export const ROTAS: Rota[] = [
  { metodo: 'post', caminho: '/sessao', resumo: 'Entrar (grava o cookie de sessão)', corpo: esquemas.entrar, resposta: Usuario, status: 200, publica: true },
  { metodo: 'get', caminho: '/sessao', resumo: 'Quem está logado', resposta: Usuario },
  { metodo: 'put', caminho: '/sessao/senha', resumo: 'Trocar a própria senha', corpo: esquemas.mudarSenha },
  { metodo: 'delete', caminho: '/sessao', resumo: 'Sair', publica: true },
  { metodo: 'get', caminho: '/configuracao', resumo: 'Configurações do estabelecimento (sem login, os padrões)', resposta: Configuracao, publica: true },
  { metodo: 'put', caminho: '/configuracao', resumo: 'Salvar configurações', corpo: esquemas.configuracao, resposta: Configuracao },
  { metodo: 'get', caminho: '/usuarios', resumo: 'Pessoas com acesso', resposta: z.array(Usuario) },
  { metodo: 'post', caminho: '/usuarios', resumo: 'Dar acesso a alguém', corpo: esquemas.novoUsuario, resposta: Usuario, status: 201 },
  { metodo: 'get', caminho: '/dias', resumo: 'Dias de venda', resposta: z.array(ResumoDia) },
  { metodo: 'post', caminho: '/dias', resumo: 'Abrir dia de venda', corpo: esquemas.abrirDia, resposta: DiaVenda, status: 201 },
  { metodo: 'get', caminho: '/dias/sugestao-producao', resumo: 'Último, média e sobra média por produto', resposta: z.array(SugestaoProducao) },
  { metodo: 'get', caminho: '/dias/relatorio', resumo: 'Fotos dos últimos dias fechados', resposta: z.array(DiaFechado), query: { dias: 'Quantos dias (1 a 26, padrão 8)' } },
  { metodo: 'get', caminho: '/dias/{id}/painel', resumo: 'Início do dia', resposta: PainelDoDia },
  { metodo: 'post', caminho: '/dias/{id}/fechamento', resumo: 'Fechar o dia (somente leitura depois)' },
  { metodo: 'get', caminho: '/dias/{id}/pedidos', resumo: 'Pedidos do dia', resposta: z.array(Pedido), query: { retirada: 'reservado | retirado | cancelado', busca: 'Nome, telefone ou número' } },
  { metodo: 'post', caminho: '/dias/{id}/pedidos', resumo: 'Confirmar reserva (409 com o máximo se não couber)', corpo: esquemas.novoPedido, resposta: Pedido, status: 201 },
  { metodo: 'get', caminho: '/dias/{id}/producao', resumo: 'Produção, reservados e vendidos', resposta: z.array(EstoqueDoProduto) },
  { metodo: 'put', caminho: '/dias/{id}/producao', resumo: 'Salvar produção (409 abaixo do reservado)', corpo: esquemas.producao },
  { metodo: 'get', caminho: '/dias/{id}/producao/historico', resumo: 'Quem mudou a produção', resposta: z.array(AlteracaoProducao) },
  { metodo: 'get', caminho: '/dias/{id}/espera', resumo: 'Lista de espera do dia', resposta: z.array(EntradaEspera) },
  { metodo: 'post', caminho: '/dias/{id}/espera', resumo: 'Entrar na lista de espera', corpo: esquemas.novaEspera, resposta: EntradaEspera, status: 201 },
  { metodo: 'get', caminho: '/dias/{id}/eventos', resumo: 'Tempo real (text/event-stream): disponibilidade-mudou, unidades-liberadas' },
  { metodo: 'get', caminho: '/pedidos/{id}', resumo: 'Detalhe do pedido', resposta: Pedido },
  { metodo: 'patch', caminho: '/pedidos/{id}', resumo: 'Editar itens (409 se não couber)', corpo: esquemas.editarPedido, resposta: Pedido },
  { metodo: 'post', caminho: '/pedidos/{id}/retirada', resumo: 'Marcar como retirado', resposta: Pedido, status: 200 },
  { metodo: 'put', caminho: '/pedidos/{id}/pagamento', resumo: 'Registrar pagamento', corpo: esquemas.pagamento, resposta: Pedido },
  { metodo: 'post', caminho: '/pedidos/{id}/cancelamento', resumo: 'Cancelar reserva', resposta: ResultadoCancelamento, status: 200 },
  { metodo: 'post', caminho: '/pedidos/{id}/reativacao', resumo: 'Reativar cancelado (409 se não couber)', resposta: Pedido, status: 200 },
  { metodo: 'get', caminho: '/produtos', resumo: 'Produtos', resposta: z.array(Produto) },
  { metodo: 'post', caminho: '/produtos', resumo: 'Cadastrar produto', corpo: esquemas.novoProduto, resposta: Produto, status: 201 },
  { metodo: 'patch', caminho: '/produtos/{id}', resumo: 'Mudar preço ou ativar', corpo: esquemas.mudarProduto, resposta: Produto },
  { metodo: 'get', caminho: '/clientes', resumo: 'Clientes (com ?telefone=, no máximo um)', resposta: z.array(ClienteEncontrado), query: { telefone: 'Só dígitos, com DDD' } },
  { metodo: 'get', caminho: '/clientes/{id}', resumo: 'Histórico do cliente', resposta: HistoricoDoCliente },
  { metodo: 'patch', caminho: '/espera/{id}', resumo: 'Atendido ou desistiu', corpo: esquemas.mudarEspera, resposta: EntradaEspera },
  { metodo: 'get', caminho: '/admin/empresas', resumo: 'Empresas (administrador)', resposta: z.array(Empresa), administrador: true },
  {
    metodo: 'post',
    caminho: '/admin/empresas',
    resumo: 'Criar empresa com o primeiro acesso (administrador)',
    corpo: esquemas.novaEmpresa,
    resposta: EmpresaCriada,
    status: 201,
    administrador: true,
  },
  { metodo: 'patch', caminho: '/admin/empresas/{id}', resumo: 'Ativar ou desativar empresa (administrador)', corpo: esquemas.mudarEmpresa, resposta: Empresa, administrador: true },
];

/** OpenAPI 3.0 montado a partir dos esquemas Zod. */
export function gerarOpenApi() {
  const { schemas } = z.toJSONSchema(z.globalRegistry, { target: 'openapi-3.0', uri: (id) => `#/components/schemas/${id}` }) as {
    schemas: Record<string, Record<string, unknown>>;
  };
  for (const esquema of Object.values(schemas)) delete esquema.$id;
  // Toda resposta é um esquema com nome ou uma lista de um esquema com nome.
  const ref = (s: z.ZodType): Record<string, unknown> => {
    const id = z.globalRegistry.get(s)?.id;
    if (id) return { $ref: `#/components/schemas/${id}` };
    if (s instanceof z.ZodArray) return { type: 'array', items: ref(s.element as z.ZodType) };
    throw new Error('Dê um id (.meta({ id })) ao esquema da rota.');
  };
  const erro = { description: 'Erro com a mensagem para o balcão', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } };

  const paths: Record<string, Record<string, unknown>> = {};
  for (const rota of ROTAS) {
    const parametros = [
      ...(rota.caminho.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] : []),
      ...Object.entries(rota.query ?? {}).map(([name, description]) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } })),
    ];
    const status = String(rota.resposta ? (rota.status ?? 200) : 204);
    paths[rota.caminho] ??= {};
    paths[rota.caminho][rota.metodo] = {
      summary: rota.resumo,
      ...(rota.publica && { security: [] }),
      ...(parametros.length && { parameters: parametros }),
      ...(rota.corpo && { requestBody: { required: true, content: { 'application/json': { schema: ref(rota.corpo) } } } }),
      responses: {
        [status]: rota.resposta ? { description: 'OK', content: { 'application/json': { schema: ref(rota.resposta) } } } : { description: 'Sem conteúdo' },
        '4XX': erro,
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: { title: 'Expresso café — API', version: '1.0.0', description: 'Dinheiro em centavos. Sessão por cookie httpOnly.' },
    components: { schemas, securitySchemes: { cookie: { type: 'apiKey', in: 'cookie', name: 'expresso_sessao' } } },
    security: [{ cookie: [] }],
    paths,
  };
}
