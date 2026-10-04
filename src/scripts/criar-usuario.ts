import { migrar } from '../adapters/saida/postgres/migrar.js';
import { UnidadeDeTrabalhoDrizzle } from '../adapters/saida/postgres/UnidadeDeTrabalhoDrizzle.js';
import { HashScrypt } from '../adapters/saida/servicos.js';
import { Acesso, Produtos } from '../application/casos-de-uso/cadastros/Cadastros.js';
import { carregarArquivoEnv } from '../config/env.js';
import { centavos } from '../domain/compartilhado/Dinheiro.js';

/**
 * Cria uma pessoa com acesso (não há cadastro pela tela) e, num banco vazio, os produtos de partida.
 * Uso: pnpm usuario:criar "Nome" email@exemplo.com senha-com-8-ou-mais
 */
const [nome, email, senha] = process.argv.slice(2);
if (!nome || !email || !senha) {
  console.error('Uso: pnpm usuario:criar "Nome" email@exemplo.com senha');
  process.exit(1);
}

carregarArquivoEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL (veja .env.example).');
  process.exit(1);
}

const uow = UnidadeDeTrabalhoDrizzle.conectar(url);
try {
  await migrar(uow.db);
  const usuario = await new Acesso(uow, new HashScrypt()).criarUsuario(nome, email, senha);
  console.log(`Usuário criado: ${usuario.nome} <${usuario.email}>`);

  const produtos = new Produtos(uow);
  if ((await produtos.listar()).length === 0) {
    for (const [nomeProduto, preco] of [
      ['Frango assado', 5500],
      ['Costela', 8990],
      ['Pernil', 6990],
      ['Maionese', 2500],
    ] as const) {
      await produtos.criar(nomeProduto, centavos(preco));
    }
    console.log('Produtos de partida cadastrados: Frango assado, Costela, Pernil e Maionese. Ajuste os preços na tela de Produtos.');
  }
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await uow.encerrar();
}
