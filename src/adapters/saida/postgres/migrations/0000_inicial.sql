CREATE SEQUENCE "public"."pedido_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"telefone" text,
	CONSTRAINT "cliente_telefone_unique" UNIQUE("telefone")
);
--> statement-breakpoint
CREATE TABLE "dia_venda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" date NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"fechado_em" timestamp with time zone,
	"faturamento" integer,
	CONSTRAINT "dia_venda_data_unique" UNIQUE("data"),
	CONSTRAINT "dia_venda_status" CHECK ("dia_venda"."status" in ('aberto', 'encerrado'))
);
--> statement-breakpoint
CREATE TABLE "fechamento_produto" (
	"dia_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"produzidos" integer NOT NULL,
	"reservados" integer NOT NULL,
	"retirados" integer NOT NULL,
	"nao_retirados" integer NOT NULL,
	"sobras" integer NOT NULL,
	CONSTRAINT "fechamento_produto_dia_id_produto_id_pk" PRIMARY KEY("dia_id","produto_id")
);
--> statement-breakpoint
CREATE TABLE "lista_espera" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dia_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"posicao" integer NOT NULL,
	"status" text DEFAULT 'aguardando' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lista_espera_quantidade" CHECK ("lista_espera"."quantidade" > 0)
);
--> statement-breakpoint
CREATE TABLE "pedido" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer DEFAULT nextval('pedido_numero_seq') NOT NULL,
	"dia_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"retirada" text DEFAULT 'reservado' NOT NULL,
	"pagamento" text DEFAULT 'pendente' NOT NULL,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone NOT NULL,
	"retirado_por" uuid,
	"retirado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"cancelado_em" timestamp with time zone,
	CONSTRAINT "pedido_numero_unique" UNIQUE("numero"),
	CONSTRAINT "pedido_retirada" CHECK ("pedido"."retirada" in ('reservado', 'retirado', 'cancelado')),
	CONSTRAINT "pedido_pagamento" CHECK ("pedido"."pagamento" in ('pendente', 'pix', 'dinheiro', 'cartao'))
);
--> statement-breakpoint
CREATE TABLE "pedido_item" (
	"pedido_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"preco_unitario" integer NOT NULL,
	CONSTRAINT "pedido_item_pedido_id_produto_id_pk" PRIMARY KEY("pedido_id","produto_id"),
	CONSTRAINT "pedido_item_quantidade" CHECK ("pedido_item"."quantidade" > 0)
);
--> statement-breakpoint
CREATE TABLE "producao" (
	"dia_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	CONSTRAINT "producao_dia_id_produto_id_pk" PRIMARY KEY("dia_id","produto_id"),
	CONSTRAINT "producao_nao_negativa" CHECK ("producao"."quantidade" >= 0)
);
--> statement-breakpoint
CREATE TABLE "producao_alteracao" (
	"id" serial PRIMARY KEY NOT NULL,
	"dia_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"de" integer NOT NULL,
	"para" integer NOT NULL,
	"usuario_id" uuid NOT NULL,
	"em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"preco_atual" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "produto_preco_positivo" CHECK ("produto"."preco_atual" > 0)
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "fechamento_produto" ADD CONSTRAINT "fechamento_produto_dia_id_dia_venda_id_fk" FOREIGN KEY ("dia_id") REFERENCES "public"."dia_venda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_produto" ADD CONSTRAINT "fechamento_produto_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_dia_id_dia_venda_id_fk" FOREIGN KEY ("dia_id") REFERENCES "public"."dia_venda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_dia_id_dia_venda_id_fk" FOREIGN KEY ("dia_id") REFERENCES "public"."dia_venda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_retirado_por_usuario_id_fk" FOREIGN KEY ("retirado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cancelado_por_usuario_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao" ADD CONSTRAINT "producao_dia_id_dia_venda_id_fk" FOREIGN KEY ("dia_id") REFERENCES "public"."dia_venda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao" ADD CONSTRAINT "producao_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao_alteracao" ADD CONSTRAINT "producao_alteracao_dia_id_dia_venda_id_fk" FOREIGN KEY ("dia_id") REFERENCES "public"."dia_venda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao_alteracao" ADD CONSTRAINT "producao_alteracao_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producao_alteracao" ADD CONSTRAINT "producao_alteracao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;