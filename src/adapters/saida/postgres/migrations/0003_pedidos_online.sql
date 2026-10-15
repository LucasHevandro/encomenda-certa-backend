ALTER TABLE "pedido" ALTER COLUMN "criado_por" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "pedidos_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "endereco_pagina" text;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "encerramento_online" integer DEFAULT -240 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "maximo_online" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracao" ADD COLUMN "aviso_online" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "origem" text DEFAULT 'balcao' NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "codigo_acesso" text;--> statement-breakpoint
ALTER TABLE "configuracao" ADD CONSTRAINT "configuracao_endereco_pagina" UNIQUE("endereco_pagina");--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_codigo_acesso" UNIQUE("codigo_acesso");--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_origem" CHECK ("pedido"."origem" in ('balcao', 'online'));