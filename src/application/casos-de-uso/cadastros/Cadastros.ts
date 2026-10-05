import type { Dinheiro } from '../../../domain/compartilhado/Dinheiro.js';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';
import { existir } from '../../../domain/compartilhado/naoEncontrado.js';
import { garantirAberto } from '../../../domain/dia-venda/DiaVenda.js';
import type { EntradaEspera } from '../../../domain/lista-espera/EntradaEspera.js';
import type { Produto } from '../../../domain/produto/Produto.js';
import type { ClienteEncontrado } from '../../portas/repositorios.js';
import type { HashDeSenha, PublicadorDeEventos, UnidadeDeTrabalho } from '../../portas/servicos.js';
import type { Usuario } from '../../portas/repositorios.js';

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

/** Login por e-mail e senha; um usuário por pessoa, todos com as mesmas permissões. */
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
    return { id: usuario.id, nome: usuario.nome, email: usuario.email };
  }

  usuario(id: string): Promise<Usuario | null> {
    return this.uow.leitura.usuarios.porId(id);
  }

  listarUsuarios(): Promise<Usuario[]> {
    return this.uow.leitura.usuarios.listar();
  }

  /** Qualquer pessoa com acesso cria outra: todos têm as mesmas permissões. */
  async criarUsuario(nome: string, email: string, senha: string): Promise<Usuario> {
    const nomeLimpo = nome.trim();
    const emailLimpo = email.trim().toLowerCase();
    if (nomeLimpo === '') throw new ErroDeDominio('usuario-sem-nome', 'Informe o nome da pessoa.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) throw new ErroDeDominio('email-invalido', 'Informe um e-mail válido.');
    validarSenha(senha);
    const senhaHash = await this.hash.gerar(senha);
    return this.uow.executar((r) => r.usuarios.criar({ nome: nomeLimpo, email: emailLimpo, senhaHash }));
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

function validarSenha(senha: string) {
  if (senha.length < 8) throw new ErroDeDominio('senha-curta', 'A senha precisa de pelo menos 8 caracteres.');
}
