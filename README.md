# Expresso café — API

API do Expresso café: NestJS, Drizzle e PostgreSQL, em arquitetura hexagonal. A regra central mora aqui: **nunca reservar mais do que foi produzido**, nem com dois aparelhos pedindo o último frango no mesmo segundo.

## Rodar

```bash
pnpm install
cp .env.example .env        # e troque o SESSAO_SEGREDO
pnpm db:subir               # PostgreSQL no Docker (banco "expresso" e "expresso_teste")
pnpm usuario:criar "Seu nome" voce@exemplo.com uma-senha-forte
pnpm start:dev              # http://localhost:3333
```

As migrações rodam sozinhas quando a API sobe. O `usuario:criar` também cadastra os produtos de partida num banco vazio (não há cadastro de pessoas pela tela).

No front, coloque `NEXT_PUBLIC_API_URL=http://localhost:3333` no `.env.local`.

## Testes

```bash
pnpm test               # domínio
pnpm test:integracao    # API inteira contra o Postgres do Docker
```

O `test/integracao/reserva.e2e-spec.ts` dispara pedidos simultâneos para o último item. O ambiente de teste segura cada transação por um instante logo depois de ler a disponibilidade, para a corrida acontecer de verdade: sem o `SELECT … FOR UPDATE`, esse teste falha.

Para usar outro Postgres nos testes, defina `DATABASE_URL_TESTE`.

## Contrato (OpenAPI)

O formato de cada resposta está em `src/adapters/entrada/http/contrato.ts` (Zod). Dele sai o `openapi.json` (`pnpm openapi`), que também é servido em `GET /openapi.json`. O front gera os tipos com `pnpm api:tipos`.

- Um teste de unidade falha se o `openapi.json` estiver desatualizado.
- Um teste de integração confere as respostas reais contra o contrato e que todas as rotas existem.

## Como a reserva fica segura

1. A transação trava o dia em modo compartilhado (`FOR SHARE`), para ninguém fechar o dia no meio.
2. Trava as linhas de `producao` dos produtos do pedido (`FOR UPDATE`, sempre na ordem do id, para evitar travamento cruzado).
3. Soma o que já está reservado e vendido e confere com o domínio (`verificarItens`).
4. Faltou: desfaz e responde **409** `{ codigo: "quantidade-indisponivel", maximo }`, que vira o "Reservar N" no app.
5. Coube: grava pedido e itens, confirma e avisa os outros aparelhos por SSE.

Editar pedido, reduzir produção e fechar o dia usam a mesma trava.

## Estrutura

```
src/
├── domain/                     # regras puras (as mesmas do front)
├── application/
│   ├── casos-de-uso/           # Pedidos, Dias, Producao, Cadastros (produtos, clientes, espera, acesso)
│   └── portas/                 # repositórios, unidade de trabalho, eventos, hash, relógio
├── adapters/
│   ├── entrada/http/           # rotas Nest, sessão por cookie, erros → { codigo, mensagem }
│   └── saida/
│       ├── postgres/           # schema Drizzle, migrações, repositórios (aqui mora o FOR UPDATE)
│       └── servicos.ts         # SSE, hash scrypt, relógio
├── config/                     # env validado com Zod, HTTP (CORS, cookies)
└── app.module.ts               # liga as portas aos adaptadores
```

## Produção

- Hospede app e API no mesmo domínio (`app.seudominio.com` e `api.seudominio.com`) e use `COOKIE_DOMINIO=.seudominio.com`, para o `proxy.ts` do Next enxergar o cookie de sessão.
- `ORIGEM_APP` libera o CORS (com credenciais) só para o app.
- Os eventos em tempo real ficam na memória do processo: com mais de uma instância da API, troque o `PublicadorSSE` por Postgres `LISTEN/NOTIFY` ou Redis.
