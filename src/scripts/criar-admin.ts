import { migrar } from '../adapters/saida/postgres/migrar.js';
import { UnidadeDeTrabalhoDrizzle } from '../adapters/saida/postgres/UnidadeDeTrabalhoDrizzle.js';
import { HashScrypt } from '../adapters/saida/servicos.js';
import { Empresas } from '../application/casos-de-uso/cadastros/Cadastros.js';
import { carregarArquivoEnv } from '../config/env.js';

/**
 * Cria o administrador do sistema, que entra no painel de empresas (não há cadastro dele pela tela).
 * Pelo painel ele cria cada empresa com o primeiro acesso, e ativa ou desativa.
 * Uso: pnpm admin:criar "Nome" email@exemplo.com senha-com-8-ou-mais
 */
const [nome, email, senha] = process.argv.slice(2);
if (!nome || !email || !senha) {
  console.error('Uso: pnpm admin:criar "Nome" email@exemplo.com senha');
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
  const admin = await new Empresas(uow, new HashScrypt()).criarAdministrador(nome, email, senha);
  console.log(`Administrador criado: ${admin.nome} <${admin.email}>. Entre no app com ele para abrir o painel de empresas.`);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await uow.encerrar();
}
