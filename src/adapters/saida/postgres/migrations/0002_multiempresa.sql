-- Multiempresa: cada estabelecimento vira uma empresa; os dados que já existiam ficam na primeira.
CREATE TABLE "empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"proximo_pedido" integer DEFAULT 1 NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A empresa de quem já usava o sistema, com o nome das configurações e a numeração de pedidos de onde parou.
-- Num banco novo (sem usuários nem dias) nenhuma empresa é criada: o administrador cria pelo painel.
INSERT INTO "empresa" ("nome", "proximo_pedido")
SELECT
	coalesce((SELECT "nome_estabelecimento" FROM "configuracao" LIMIT 1), 'Expresso café'),
	coalesce((SELECT max("numero") FROM "pedido"), 0) + 1
WHERE EXISTS (SELECT 1 FROM "usuario") OR EXISTS (SELECT 1 FROM "dia_venda") OR EXISTS (SELECT 1 FROM "produto");
--> statement-breakpoint
ALTER TABLE "cliente" DROP CONSTRAINT "cliente_telefone_unique";--> statement-breakpoint
ALTER TABLE "dia_venda" DROP CONSTRAINT "dia_venda_data_unique";--> statement-breakpoint
ALTER TABLE "pedido" DROP CONSTRAINT "pedido_numero_unique";--> statement-breakpoint
ALTER TABLE "pedido" ALTER COLUMN "numero" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE "public"."pedido_numero_seq";--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "dia_venda" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "lista_espera" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "produto" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
UPDATE "usuario" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
UPDATE "cliente" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
UPDATE "dia_venda" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
UPDATE "lista_espera" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
UPDATE "pedido" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
UPDATE "produto" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
-- Configuração salva sem nenhum outro dado: não há empresa para ela, então sai.
DELETE FROM "configuracao" WHERE NOT EXISTS (SELECT 1 FROM "empresa");--> statement-breakpoint
UPDATE "configuracao" SET "empresa_id" = (SELECT "id" FROM "empresa" LIMIT 1);--> statement-breakpoint
ALTER TABLE "cliente" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dia_venda" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lista_espera" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "produto" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" DROP CONSTRAINT "configuracao_uma_linha";--> statement-breakpoint
ALTER TABLE "configuracao" DROP CONSTRAINT "configuracao_pkey";--> statement-breakpoint
ALTER TABLE "configuracao" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "configuracao" ADD PRIMARY KEY ("empresa_id");--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dia_venda" ADD CONSTRAINT "dia_venda_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto" ADD CONSTRAINT "produto_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuracao" ADD CONSTRAINT "configuracao_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_empresa_telefone" UNIQUE("empresa_id","telefone");--> statement-breakpoint
ALTER TABLE "dia_venda" ADD CONSTRAINT "dia_venda_empresa_data" UNIQUE("empresa_id","data");--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_empresa_numero" UNIQUE("empresa_id","numero");
