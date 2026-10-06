# Publicar: API no Railway, app na Vercel

```
celular / tablet ──► app na Vercel (Next) ──/api/...──► API no Railway (Nest) ──► PostgreSQL no Railway
```

O navegador só fala com a Vercel. Ela repassa `/api/...` para o Railway, então o cookie de sessão fica no endereço do app, sem configurar domínio de cookie nem CORS.

## 1. Banco e API no Railway

1. No Railway, crie um projeto com **Deploy from GitHub repo** e escolha `expresso-cafe-backend`. O `railway.json` manda usar o `Dockerfile` e conferir a saúde em `/saude`.
2. No mesmo projeto, adicione um banco: **+ New > Database > PostgreSQL**.
3. Em **Variables** do serviço da API, defina:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao banco do projeto) |
   | `SESSAO_SEGREDO` | um segredo novo, de pelo menos 32 caracteres* |
   | `NODE_ENV` | `production` |
   | `PROXIES_NA_FRENTE` | `2` (Vercel + Railway) |
   | `ORIGEM_APP` | o endereço da Vercel, ex.: `https://expresso-cafe.vercel.app` |

   \* Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Não reaproveite o do `.env` local.

   Não defina `PORT`: o Railway informa sozinho.
4. Em **Settings > Networking**, clique em **Generate Domain**. Anote o endereço, por exemplo `https://expresso-cafe-api.up.railway.app`.
5. As migrações rodam sozinhas quando a API sobe. Confira em `https://SEU-ENDERECO/saude` (deve responder `{"ok":true}`).
6. Crie o administrador do sistema, uma vez só, da sua máquina. No PostgreSQL do Railway, aba **Variables**, copie `DATABASE_PUBLIC_URL`. Na pasta do backend, no PowerShell:

   ```powershell
   $env:DATABASE_URL = "cole-aqui-a-DATABASE_PUBLIC_URL"; pnpm admin:criar "Seu nome" voce@exemplo.com uma-senha-forte
   ```

   Entrando no app com ele, abre o painel de empresas: crie lá cada estabelecimento com o primeiro acesso. As outras pessoas de cada empresa são criadas por ela, na tela **Pessoas**. Se o banco já tinha dados de antes do multiempresa, eles viraram a primeira empresa, com os mesmos logins. Feche o terminal depois, para a variável não ficar apontando para produção.

## 2. App na Vercel

1. Na Vercel, **Add New > Project** e escolha `expresso-cafe-frontend`. Ela reconhece o Next.js e o pnpm sozinha.
2. Em **Environment Variables**, antes do primeiro deploy:

   | Variável | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `/api` |
   | `API_INTERNA` | o endereço do Railway do passo 1.4, sem barra no fim |

3. **Deploy**. Abra o endereço da Vercel no celular, entre e, no menu do navegador, use **Adicionar à tela inicial** para instalar o app.
4. Volte ao Railway e confira se `ORIGEM_APP` está com o endereço final da Vercel.

Mudou `API_INTERNA` ou o endereço do Railway? Faça um novo deploy na Vercel: o repasse de `/api` é montado no build.

## 3. Depois de publicar

- **Backup:** no PostgreSQL do Railway, em **Backups**, ligue os backups automáticos (diários) se o seu plano tiver. Se não tiver, rode `pg_dump` de vez em quando com o endereço público do banco.
- **Domínio próprio (opcional):** aponte `app.seudominio.com` para a Vercel. O app continua chamando `/api`, então nada muda no Railway além de `ORIGEM_APP`.
- **Tempo real:** os avisos entre aparelhos passam pela Vercel. Se a conexão cair, o app reconecta sozinho e recarrega os números.
- **Atualizações:** cada push na branch principal publica de novo nos dois. O CI do GitHub roda os testes antes.
