CREATE TABLE "configuracao" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"nome_estabelecimento" text NOT NULL,
	"cor_principal" text NOT NULL,
	"logo_url" text,
	"endereco_retirada" text,
	"dias_de_venda" integer[] NOT NULL,
	"limite_atencao" integer NOT NULL,
	"formas_de_pagamento" text[] NOT NULL,
	"mensagem_whatsapp" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuracao_uma_linha" CHECK ("configuracao"."id" = 1)
);
