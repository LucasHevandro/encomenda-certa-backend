import { z } from 'zod';
import { ErroDeDominio } from '../../../domain/compartilhado/ErroDeDominio.js';

/** Confere o corpo da requisição; erro de formato vira 422 "dados-invalidos". */
export function validar<T extends z.ZodType>(esquema: T, valor: unknown): z.infer<T> {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    const primeiro = resultado.error.issues[0];
    throw new ErroDeDominio('dados-invalidos', `Dado inválido em ${primeiro.path.join('.') || 'corpo'}: ${primeiro.message}`);
  }
  return resultado.data;
}

const id = z.string().min(1);
const inteiro = z.number().int();
const cliente = z.object({ nome: z.string(), telefone: z.string().optional() });
const itens = z.array(z.object({ produtoId: id, quantidade: inteiro.min(0) })).max(50);

export const esquemas = {
  entrar: z.object({ email: z.string(), senha: z.string() }),
  configuracao: z.object({
    nomeEstabelecimento: z.string(),
    corPrincipal: z.string(),
    logoUrl: z.string().max(500).optional(),
    enderecoRetirada: z.string().max(200).optional(),
    diasDeVenda: z.array(z.number().int().min(0).max(6)).max(7),
    limiteAtencao: z.number().int(),
    formasDePagamento: z.array(z.enum(['pix', 'dinheiro', 'cartao'])).max(3),
    mensagemWhatsapp: z.string(),
  }),
  novoUsuario: z.object({ nome: z.string(), email: z.string(), senha: z.string().max(200) }),
  novaEmpresa: z.object({ nome: z.string(), usuario: z.object({ nome: z.string(), email: z.string(), senha: z.string().max(200) }) }),
  mudarEmpresa: z.object({ ativa: z.boolean() }),
  mudarSenha: z.object({ senhaAtual: z.string(), novaSenha: z.string().max(200) }),
  novoPedido: z.object({ cliente, itens }),
  editarPedido: z.object({ itens }),
  pagamento: z.object({ pagamento: z.enum(['pendente', 'pix', 'dinheiro', 'cartao']) }),
  abrirDia: z.object({ data: z.string(), producao: z.array(z.object({ produtoId: id, quantidade: inteiro.min(0) })) }),
  producao: z.object({ quantidades: z.array(z.object({ produtoId: id, quantidade: inteiro.min(0) })).max(50) }),
  novoProduto: z.object({ nome: z.string(), preco: inteiro.positive() }),
  mudarProduto: z.object({ preco: inteiro.positive().optional(), ativo: z.boolean().optional() }),
  novaEspera: z.object({ produtoId: id, cliente, quantidade: inteiro.min(1) }),
  mudarEspera: z.object({ status: z.enum(['aguardando', 'atendido', 'desistiu']) }),
  filtroPedidos: z.object({ retirada: z.enum(['reservado', 'retirado', 'cancelado']).optional(), busca: z.string().max(100).optional() }),
};
