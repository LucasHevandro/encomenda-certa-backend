# API do Encomenda Certa para produção (Railway ou qualquer lugar que rode Docker).
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# Dependências (todas, para compilar)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Compila e deixa só as dependências de produção
FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

# Imagem final, pequena
FROM node:24-alpine AS producao
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# As migrações rodam sozinhas na subida e são lidas daqui.
COPY --from=build /app/src/adapters/saida/postgres/migrations ./src/adapters/saida/postgres/migrations
USER node
EXPOSE 3333
CMD ["node", "dist/main.js"]
