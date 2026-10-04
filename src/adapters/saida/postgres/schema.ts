import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, pgSequence, pgTable, primaryKey, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Banco do Expresso café. O dia de venda é o centro: pedidos, produção, lista de espera
 * e fechamento pertencem a um dia. Dinheiro sempre em centavos (integer).
 */

export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  email: text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const produto = pgTable(
  'produto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
    precoAtual: integer('preco_atual').notNull(),
    ativo: boolean('ativo').notNull().default(true),
  },
  (t) => [check('produto_preco_positivo', sql`${t.precoAtual} > 0`)],
);

export const diaVenda = pgTable(
  'dia_venda',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    data: date('data', { mode: 'string' }).notNull().unique(),
    status: text('status', { enum: ['aberto', 'encerrado'] }).notNull().default('aberto'),
    fechadoEm: timestamp('fechado_em', { withTimezone: true }),
    /** Gravado ao fechar: soma dos pedidos não cancelados, retirados ou não. */
    faturamento: integer('faturamento'),
  },
  (t) => [check('dia_venda_status', sql`${t.status} in ('aberto', 'encerrado')`)],
);

/** A linha travada (FOR UPDATE) em toda reserva: chave (dia, produto). */
export const producao = pgTable(
  'producao',
  {
    diaId: uuid('dia_id')
      .notNull()
      .references(() => diaVenda.id),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id),
    quantidade: integer('quantidade').notNull(),
  },
  (t) => [primaryKey({ columns: [t.diaId, t.produtoId] }), check('producao_nao_negativa', sql`${t.quantidade} >= 0`)],
);

export const producaoAlteracao = pgTable('producao_alteracao', {
  id: serial('id').primaryKey(),
  diaId: uuid('dia_id')
    .notNull()
    .references(() => diaVenda.id),
  produtoId: uuid('produto_id')
    .notNull()
    .references(() => produto.id),
  de: integer('de').notNull(),
  para: integer('para').notNull(),
  usuarioId: uuid('usuario_id')
    .notNull()
    .references(() => usuario.id),
  em: timestamp('em', { withTimezone: true }).notNull(),
});

export const cliente = pgTable('cliente', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  /** Opcional e único: é como o balcão reconhece quem já comprou. */
  telefone: text('telefone').unique(),
});

/** O número #0258 segue crescendo entre os dias. */
export const pedidoNumero = pgSequence('pedido_numero_seq', { startWith: 1 });

export const pedido = pgTable(
  'pedido',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: integer('numero')
      .notNull()
      .unique()
      .default(sql`nextval('pedido_numero_seq')`),
    diaId: uuid('dia_id')
      .notNull()
      .references(() => diaVenda.id),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id),
    retirada: text('retirada', { enum: ['reservado', 'retirado', 'cancelado'] })
      .notNull()
      .default('reservado'),
    pagamento: text('pagamento', { enum: ['pendente', 'pix', 'dinheiro', 'cartao'] })
      .notNull()
      .default('pendente'),
    criadoPor: uuid('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull(),
    retiradoPor: uuid('retirado_por').references(() => usuario.id),
    retiradoEm: timestamp('retirado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por').references(() => usuario.id),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
  },
  (t) => [
    check('pedido_retirada', sql`${t.retirada} in ('reservado', 'retirado', 'cancelado')`),
    check('pedido_pagamento', sql`${t.pagamento} in ('pendente', 'pix', 'dinheiro', 'cartao')`),
  ],
);

/** Preço copiado na hora: mudar o preço do produto não altera pedidos antigos. */
export const pedidoItem = pgTable(
  'pedido_item',
  {
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedido.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id),
    quantidade: integer('quantidade').notNull(),
    precoUnitario: integer('preco_unitario').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pedidoId, t.produtoId] }), check('pedido_item_quantidade', sql`${t.quantidade} > 0`)],
);

export const listaEspera = pgTable(
  'lista_espera',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diaId: uuid('dia_id')
      .notNull()
      .references(() => diaVenda.id),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id),
    quantidade: integer('quantidade').notNull(),
    posicao: integer('posicao').notNull(),
    status: text('status', { enum: ['aguardando', 'atendido', 'desistiu'] })
      .notNull()
      .default('aguardando'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('lista_espera_quantidade', sql`${t.quantidade} > 0`)],
);

/** Foto do dia gravada ao fechar: histórico e médias rápidos e imunes a mudanças de preço. */
export const fechamentoProduto = pgTable(
  'fechamento_produto',
  {
    diaId: uuid('dia_id')
      .notNull()
      .references(() => diaVenda.id),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id),
    produzidos: integer('produzidos').notNull(),
    reservados: integer('reservados').notNull(),
    retirados: integer('retirados').notNull(),
    naoRetirados: integer('nao_retirados').notNull(),
    sobras: integer('sobras').notNull(),
  },
  (t) => [primaryKey({ columns: [t.diaId, t.produtoId] })],
);
