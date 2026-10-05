import { Body, Controller, Delete, Get, Header, HttpCode, Inject, type MessageEvent, Param, Patch, Post, Put, Query, Req, Res, Sse } from '@nestjs/common';
import type { Request, Response } from 'express';
import { interval, map, merge, type Observable } from 'rxjs';
import { Acesso, Clientes, Espera, Produtos } from '../../../application/casos-de-uso/cadastros/Cadastros.js';
import { Dias } from '../../../application/casos-de-uso/dias/Dias.js';
import { Pedidos } from '../../../application/casos-de-uso/pedidos/Pedidos.js';
import { Producao } from '../../../application/casos-de-uso/producao/Producao.js';
import type { Usuario } from '../../../application/portas/repositorios.js';
import { centavos } from '../../../domain/compartilhado/Dinheiro.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { LimiteDeTentativas } from './limiteDeTentativas.js';
import { PublicadorSSE } from '../../saida/servicos.js';
import { CookieDeSessao, Publico, UsuarioLogado } from './sessao.js';
import { esquemas, validar } from './validacao.js';

/** Rotas finas: validam a entrada e chamam um caso de uso. A API espelha as ações do guia. */

@Controller('sessao')
export class SessaoRotas {
  constructor(
    @Inject(Acesso) private readonly acesso: Acesso,
    @Inject(CookieDeSessao) private readonly cookie: CookieDeSessao,
    @Inject(LimiteDeTentativas) private readonly limite: LimiteDeTentativas,
  ) {}

  /** Depois de 5 senhas erradas seguidas para o mesmo e-mail e endereço, 429 por 15 minutos. */
  @Publico()
  @Post()
  @HttpCode(200)
  async entrar(@Body() corpo: unknown, @Req() requisicao: Request, @Res({ passthrough: true }) resposta: Response) {
    const { email, senha } = validar(esquemas.entrar, corpo);
    const chave = `${requisicao.ip ?? ''}|${email.trim().toLowerCase()}`;
    this.limite.conferir(chave);
    try {
      const usuario = await this.acesso.entrar(email, senha);
      this.limite.registrarAcerto(chave);
      this.cookie.gravar(resposta, usuario.id);
      return usuario;
    } catch (erro) {
      if (erro instanceof ErroDeDominio && erro.codigo === 'login-invalido') this.limite.registrarErro(chave);
      throw erro;
    }
  }

  @Get()
  atual(@UsuarioLogado() usuario: Usuario) {
    return usuario;
  }

  @Put('senha')
  @HttpCode(204)
  async mudarSenha(@Body() corpo: unknown, @UsuarioLogado() usuario: Usuario) {
    const { senhaAtual, novaSenha } = validar(esquemas.mudarSenha, corpo);
    await this.acesso.mudarSenha(usuario.id, senhaAtual, novaSenha);
  }

  @Publico()
  @Delete()
  @HttpCode(204)
  sair(@Res({ passthrough: true }) resposta: Response) {
    this.cookie.apagar(resposta);
  }
}

@Controller('dias')
export class DiasRotas {
  constructor(
    @Inject(Dias) private readonly dias: Dias,
    @Inject(Pedidos) private readonly pedidos: Pedidos,
    @Inject(Producao) private readonly producao: Producao,
    @Inject(Espera) private readonly espera: Espera,
    @Inject(PublicadorSSE) private readonly eventos: PublicadorSSE,
  ) {}

  @Get()
  listar() {
    return this.dias.listar();
  }

  /** Fotos dos últimos dias fechados, para o relatório entre dias. ?dias=8 */
  @Get('relatorio')
  relatorio(@Query('dias') dias?: string) {
    return this.dias.relatorio(Number(dias ?? 8));
  }

  @Get('sugestao-producao')
  sugestao() {
    return this.dias.sugestaoProducao();
  }

  @Post()
  abrir(@Body() corpo: unknown) {
    return this.dias.abrir(validar(esquemas.abrirDia, corpo));
  }

  @Get(':id/painel')
  painel(@Param('id') id: string) {
    return this.dias.painel(id);
  }

  @Post(':id/fechamento')
  @HttpCode(204)
  async fechar(@Param('id') id: string) {
    await this.dias.fechar(id);
  }

  @Get(':id/pedidos')
  listarPedidos(@Param('id') id: string, @Query() query: unknown) {
    return this.pedidos.listar(id, validar(esquemas.filtroPedidos, query));
  }

  /** Confirmar reserva. 409 com { maximo } quando não cabe. */
  @Post(':id/pedidos')
  criarPedido(@Param('id') id: string, @Body() corpo: unknown, @UsuarioLogado() usuario: Usuario) {
    const { cliente, itens } = validar(esquemas.novoPedido, corpo);
    return this.pedidos.criar({ diaId: id, cliente, itens }, usuario.id);
  }

  @Get(':id/producao')
  obterProducao(@Param('id') id: string) {
    return this.producao.obter(id);
  }

  @Put(':id/producao')
  @HttpCode(204)
  async salvarProducao(@Param('id') id: string, @Body() corpo: unknown, @UsuarioLogado() usuario: Usuario) {
    await this.producao.salvar(id, validar(esquemas.producao, corpo).quantidades, usuario.id);
  }

  @Get(':id/producao/historico')
  historico(@Param('id') id: string) {
    return this.producao.historico(id);
  }

  @Get(':id/espera')
  listarEspera(@Param('id') id: string) {
    return this.espera.listar(id);
  }

  @Post(':id/espera')
  adicionarEspera(@Param('id') id: string, @Body() corpo: unknown) {
    const { produtoId, cliente, quantidade } = validar(esquemas.novaEspera, corpo);
    return this.espera.adicionar({ diaId: id, produtoId, cliente, quantidade });
  }

  /** Tempo real: os aparelhos recebem os números novos sem recarregar. Um comentário a cada 25s mantém a conexão. */
  @Sse(':id/eventos')
  // Sem compressão nem buffer no caminho (proxy do Next, Nginx): cada evento sai na hora.
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  eventosDoDia(@Param('id') id: string): Observable<MessageEvent> {
    return merge(
      this.eventos.doDia(id).pipe(map((evento): MessageEvent => ({ type: evento.tipo, data: evento }))),
      interval(25_000).pipe(map((): MessageEvent => ({ type: 'manter-conexao', data: {} }))),
    );
  }
}

@Controller('pedidos')
export class PedidosRotas {
  constructor(@Inject(Pedidos) private readonly pedidos: Pedidos) {}

  @Get(':id')
  obter(@Param('id') id: string) {
    return this.pedidos.obter(id);
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() corpo: unknown) {
    return this.pedidos.editar(id, validar(esquemas.editarPedido, corpo).itens);
  }

  @Post(':id/retirada')
  @HttpCode(200)
  retirar(@Param('id') id: string, @UsuarioLogado() usuario: Usuario) {
    return this.pedidos.marcarRetirado(id, usuario.id);
  }

  @Put(':id/pagamento')
  pagar(@Param('id') id: string, @Body() corpo: unknown) {
    return this.pedidos.registrarPagamento(id, validar(esquemas.pagamento, corpo).pagamento);
  }

  /** 409 com { maximo } quando as unidades já foram vendidas para outro. */
  @Post(':id/reativacao')
  @HttpCode(200)
  reativar(@Param('id') id: string, @UsuarioLogado() usuario: Usuario) {
    return this.pedidos.reativar(id, usuario.id);
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  cancelar(@Param('id') id: string, @UsuarioLogado() usuario: Usuario) {
    return this.pedidos.cancelar(id, usuario.id);
  }
}

@Controller()
export class CadastrosRotas {
  constructor(
    @Inject(Produtos) private readonly produtos: Produtos,
    @Inject(Clientes) private readonly clientes: Clientes,
    @Inject(Espera) private readonly espera: Espera,
    @Inject(Acesso) private readonly acesso: Acesso,
  ) {}

  @Get('usuarios')
  listarUsuarios() {
    return this.acesso.listarUsuarios();
  }

  @Post('usuarios')
  criarUsuario(@Body() corpo: unknown) {
    const { nome, email, senha } = validar(esquemas.novoUsuario, corpo);
    return this.acesso.criarUsuario(nome, email, senha);
  }

  @Get('produtos')
  listarProdutos() {
    return this.produtos.listar();
  }

  @Post('produtos')
  criarProduto(@Body() corpo: unknown) {
    const { nome, preco } = validar(esquemas.novoProduto, corpo);
    return this.produtos.criar(nome, centavos(preco));
  }

  @Patch('produtos/:id')
  mudarProduto(@Param('id') id: string, @Body() corpo: unknown) {
    const { preco, ativo } = validar(esquemas.mudarProduto, corpo);
    return this.produtos.atualizar(id, { ...(preco != null && { preco: centavos(preco) }), ...(ativo != null && { ativo }) });
  }

  @Get('clientes/:id')
  historicoDoCliente(@Param('id') id: string) {
    return this.clientes.historico(id);
  }

  /** Com ?telefone= devolve no máximo um cliente (telefone é único). */
  @Get('clientes')
  listarClientes(@Query('telefone') telefone?: string) {
    return telefone ? this.clientes.porTelefone(telefone) : this.clientes.listar();
  }

  @Patch('espera/:id')
  mudarEspera(@Param('id') id: string, @Body() corpo: unknown) {
    return this.espera.mudarStatus(id, validar(esquemas.mudarEspera, corpo).status);
  }

  @Publico()
  @Get('saude')
  saude() {
    return { ok: true };
  }
}
