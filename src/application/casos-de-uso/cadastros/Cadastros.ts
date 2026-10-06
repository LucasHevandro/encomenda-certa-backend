import { type Dinheiro, somar } from '../../../domain/compartilhado/Dinheiro.js';
import { type Pedido, totalDoPedido } from '../../../domain/pedido/Pedido.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir } from '../../../domain/compartilhado/naoEncontrado.js';
import { CONFIGURACAO_PADRAO, type Configuracao, validarConfiguracao } from '../../../domain/configuracao/Configuracao.js';
import { garantirAberto } from '../../../domain/dia-venda/DiaVenda.js';
import type { EntradaEspera } from '../../../domain/lista-espera/EntradaEspera.js';
import type { Produto } from '../../../domain/produto/Produto.js';
import type { ClienteEncontrado, Empresa, Usuario } from '../../portas/repositorios.js';
import type { HashDeSenha, PublicadorDeEventos, UnidadeDeTrabalho } from '../../portas/servicos.js';
import { naEmpresa, temEmpresa } from '../../contextoDaEmpresa.js';

/** O que muda de um estabelecimento para outro: marca, dias de venda, pagamentos, mensagem. */
export class Configuracoes {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  /** Sem login (tela de entrar) não há empresa: valem os padrões. */
  async obter(): Promise<Configuracao> {
    if (!temEmpresa()) return CONFIGURACAO_PADRAO;
    return (await this.uow.leitura.configuracao.obter()) ?? CONFIGURACAO_PADRAO;
  }

  async salvar(nova: Configuracao): Promise<Configuracao> {
    const limpa = validarConfiguracao(nova);
    await this.uow.executar((r) => r.configuracao.salvar(limpa));
    return limpa;
  }
}

/** Produtos e preços. Mudar o preço não mexe em pedidos já feitos: cada item guarda o preço da época. */
export class Produtos {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  listar(): Promise<Produto[]> {
    return this.uow.leitura.produtos.listar();
  }

  criar(nome: string, preco: Dinheiro): Promise<Produto> {
    const limpo = nome.trim();
    if (limpo === '') throw new ErroDeDominio('produto-sem-nome', 'Informe o nome do produto.');
    if (!Number.isInteger(preco) || preco <= 0) throw new ErroDeDominio('preco-invalido', 'Informe um preço maior que zero.');
    return this.uow.executar((r) => r.produtos.criar({ nome: limpo, preco }));
  }

  async atualizar(id: string, mudancas: { preco?: Dinheiro; ativo?: boolean }): Promise<Produto> {
    if (mudancas.preco != null && (!Number.isInteger(mudancas.preco) || mudancas.preco <= 0)) {
      throw new ErroDeDominio('preco-invalido', 'Informe um preço maior que zero.');
    }
    return existir(await this.uow.executar((r) => r.produtos.atualizar(id, mudancas)), 'Produto');
  }
}

/** Clientes nascem sozinhos no primeiro pedido; só o nome é obrigatório. */
export class Clientes {
  constructor(private readonly uow: UnidadeDeTrabalho) {}

  async porTelefone(telefone: string): Promise<ClienteEncontrado[]> {
    const digitos = telefone.replace(/\D/g, '');
    if (digitos.length < 10) return [];
    const cliente = await this.uow.leitura.clientes.porTelefone(digitos);
    return cliente ? [cliente] : [];
  }

  listar(): Promise<ClienteEncontrado[]> {
    return this.uow.leitura.clientes.listar();
  }

  /** Pedidos anteriores, quanto já comprou e o que costuma pedir. Cancelados aparecem, mas não somam. */
  async historico(id: string): Promise<HistoricoDoCliente> {
    const r = this.uow.leitura;
    const cliente = existir(await r.clientes.obter(id), 'Cliente');
    const pedidos = await r.pedidos.doCliente(id);
    const validos = pedidos.filter(({ pedido }) => pedido.retirada !== 'cancelado');
    const porProduto = new Map<string, { produtoId: string; nome: string; quantidade: number }>();
    for (const { pedido } of validos) {
      for (const item of pedido.itens) {
        const atual = porProduto.get(item.produtoId) ?? { produtoId: item.produtoId, nome: item.nome, quantidade: 0 };
        porProduto.set(item.produtoId, { ...atual, quantidade: atual.quantidade + item.quantidade });
      }
    }
    return {
      cliente,
      totalGasto: somar(...validos.map(({ pedido }) => totalDoPedido(pedido))),
      naoRetirados: validos.filter(({ pedido }) => pedido.retirada === 'reservado').length,
      favoritos: [...porProduto.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 3),
      pedidos: pedidos.map(({ pedido, data }) => ({ ...pedido, data })),
    };
  }
}

export interface HistoricoDoCliente {
  readonly cliente: ClienteEncontrado;
  readonly totalGasto: Dinheiro;
  /** Pedidos ainda reservados (de dias abertos ou que ficaram sem retirar). */
  readonly naoRetirados: number;
  /** Até 3 produtos que mais pede, em quantidade. */
  readonly favoritos: readonly { produtoId: string; nome: string; quantidade: number }[];
  readonly pedidos: readonly (Pedido & { data: string })[];
}

export interface NovaEntradaEspera {
  readonly diaId: string;
  readonly produtoId: string;
  readonly cliente: { readonly nome: string; readonly telefone?: string };
  readonly quantidade: number;
}

/** Lista de espera por produto, em ordem de chegada. */
export class Espera {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly eventos: PublicadorDeEventos,
  ) {}

  listar(diaId: string): Promise<EntradaEspera[]> {
    return this.uow.leitura.espera.listar(diaId);
  }

  async adicionar(entrada: NovaEntradaEspera): Promise<EntradaEspera> {
    const nome = entrada.cliente.nome.trim();
    if (nome === '') throw new ErroDeDominio('cliente-sem-nome', 'Informe o nome do cliente.');
    if (!Number.isInteger(entrada.quantidade) || entrada.quantidade < 1) {
      throw new ErroDeDominio('quantidade-invalida', 'Escolha pelo menos 1 unidade.');
    }
    const telefone = entrada.cliente.telefone?.replace(/\D/g, '') || undefined;
    const nova = await this.uow.executar(async (r) => {
      garantirAberto(await r.dias.travarParaEscrita(entrada.diaId));
      existir((await r.produtos.porIds([entrada.produtoId]))[0], 'Produto');
      const clienteId = await r.clientes.obterOuCriar({ nome, telefone });
      return r.espera.adicionar({ diaId: entrada.diaId, produtoId: entrada.produtoId, clienteId, quantidade: entrada.quantidade });
    });
    this.eventos.publicar(entrada.diaId, { tipo: 'disponibilidade-mudou' });
    return nova;
  }

  async mudarStatus(id: string, status: EntradaEspera['status']): Promise<EntradaEspera> {
    if (!['aguardando', 'atendido', 'desistiu'].includes(status)) throw new ErroDeDominio('status-invalido', 'Situação inválida.');
    const salva = await this.uow.executar(async (r) => {
      const atual = existir(await r.espera.obter(id), 'Cliente na lista de espera');
      garantirAberto(await r.dias.travarParaEscrita(atual.diaId));
      return r.espera.mudarStatus(id, status);
    });
    this.eventos.publicar(salva.diaId, { tipo: 'disponibilidade-mudou' });
    return salva;
  }
}

/** Login por e-mail e senha; um usuário por pessoa, todos da empresa com as mesmas permissões. */
export class Acesso {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly hash: HashDeSenha,
  ) {}

  async entrar(email: string, senha: string): Promise<Usuario> {
    const usuario = await this.uow.leitura.usuarios.porEmail(email.trim().toLowerCase());
    // Mesma resposta para e-mail inexistente e senha errada.
    if (!usuario || !(await this.hash.conferir(senha, usuario.senhaHash))) {
      throw new ErroDeDominio('login-invalido', 'E-mail ou senha incorretos.');
    }
    if (!usuario.empresaAtiva) throw empresaInativa();
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: usuario.empresaId };
  }

  /** Para a guarda de sessão: null se a pessoa não existe mais; erro se a empresa foi desativada. */
  async usuario(id: string): Promise<Usuario | null> {
    const usuario = await this.uow.leitura.usuarios.porId(id);
    if (!usuario) return null;
    if (!usuario.empresaAtiva) throw empresaInativa();
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: usuario.empresaId };
  }

  listarUsuarios(): Promise<Usuario[]> {
    return this.uow.leitura.usuarios.listar();
  }

  /** Qualquer pessoa com acesso cria outra na mesma empresa: todos têm as mesmas permissões. */
  async criarUsuario(nome: string, email: string, senha: string): Promise<Usuario> {
    const novo = await prepararUsuario(nome, email, senha, this.hash);
    return this.uow.executar((r) => r.usuarios.criar(novo));
  }

  /** Troca a própria senha, conferindo a atual. */
  async mudarSenha(usuarioId: string, senhaAtual: string, novaSenha: string): Promise<void> {
    const guardada = await this.uow.leitura.usuarios.senhaHash(usuarioId);
    if (!guardada || !(await this.hash.conferir(senhaAtual, guardada))) {
      throw new ErroDeDominio('senha-atual-incorreta', 'A senha atual está incorreta.');
    }
    validarSenha(novaSenha);
    const hash = await this.hash.gerar(novaSenha);
    await this.uow.executar((r) => r.usuarios.mudarSenha(usuarioId, hash));
  }
}

const empresaInativa = () => new ErroDeDominio('empresa-inativa', 'O acesso deste estabelecimento está desativado. Fale com o suporte.');

/** Confere nome, e-mail e senha e devolve pronto para gravar, com a senha já em hash. */
async function prepararUsuario(nome: string, email: string, senha: string, hash: HashDeSenha) {
  const nomeLimpo = nome.trim();
  const emailLimpo = email.trim().toLowerCase();
  if (nomeLimpo === '') throw new ErroDeDominio('usuario-sem-nome', 'Informe o nome da pessoa.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) throw new ErroDeDominio('email-invalido', 'Informe um e-mail válido.');
  validarSenha(senha);
  return { nome: nomeLimpo, email: emailLimpo, senhaHash: await hash.gerar(senha) };
}

export interface NovaEmpresa {
  readonly nome: string;
  /** Primeira pessoa com acesso; ela cadastra as outras pela tela Pessoas. */
  readonly usuario: { readonly nome: string; readonly email: string; readonly senha: string };
}

/** Painel do administrador do sistema: cria empresas com o primeiro acesso e liga ou desliga cada uma. */
export class Empresas {
  constructor(
    private readonly uow: UnidadeDeTrabalho,
    private readonly hash: HashDeSenha,
  ) {}

  listar(): Promise<Empresa[]> {
    return this.uow.leitura.empresas.listar();
  }

  /** Empresa, primeiro usuário e configuração com o nome dela, tudo junto ou nada. */
  async criar(nova: NovaEmpresa): Promise<{ empresa: Empresa; usuario: Usuario }> {
    const nome = nova.nome.trim();
    if (nome === '' || nome.length > 60) throw new ErroDeDominio('empresa-sem-nome', 'Informe o nome do estabelecimento (até 60 letras).');
    const usuario = await prepararUsuario(nova.usuario.nome, nova.usuario.email, nova.usuario.senha, this.hash);
    return this.uow.executar(async (r) => {
      const { id } = await r.empresas.criar(nome);
      const criado = await r.empresas.criarUsuario(id, usuario);
      await naEmpresa(id, () => r.configuracao.salvar({ ...CONFIGURACAO_PADRAO, nomeEstabelecimento: nome }));
      return { empresa: existir(await r.empresas.obter(id), 'Empresa'), usuario: criado };
    });
  }

  /** Desativada, ninguém da empresa entra, e quem estava logado cai na próxima ação. Os dados ficam guardados. */
  async mudarAtiva(id: string, ativa: boolean): Promise<Empresa> {
    return existir(await this.uow.executar((r) => r.empresas.mudarAtiva(id, ativa)), 'Empresa');
  }

  /** Administrador do sistema, sem empresa. Só pelo script admin:criar. */
  async criarAdministrador(nome: string, email: string, senha: string): Promise<Usuario> {
    const usuario = await prepararUsuario(nome, email, senha, this.hash);
    return this.uow.executar((r) => r.empresas.criarAdministrador(usuario));
  }
}

function validarSenha(senha: string) {
  if (senha.length < 8) throw new ErroDeDominio('senha-curta', 'A senha precisa de pelo menos 8 caracteres.');
}
