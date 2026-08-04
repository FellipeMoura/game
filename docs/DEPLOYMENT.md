# Deployment — Cronograma de Publicação

Plano de subida do bestiário na mesma VPS que já hospeda o `quartzo`. Segue o padrão bash + PM2 + Nginx + Postgres compartilhado do quartzo — nada de CI/CD automático nem stack Docker dedicada nesta primeira leva.

## Alvo

- **URL:** `https://bestiary.sysnode.com.br` (UI na raiz, API sob `/api/v1/*`)
- **VPS:** mesma do quartzo (Ubuntu 22.04)
- **Postgres:** mesma instância do quartzo (porta 5434) — apenas um novo DB `bestiary_prod` e um role dedicado `bestiary_app`
- **TLS:** wildcard existente `*.sysnode.com.br` (verificar; senão emitir novo cert DNS-01)
- **Reverse proxy:** Nginx compartilhado (adicionar novo server block)
- **Processo:** PM2 gerenciando `apps/api` (o `apps/web` é dist estático servido pelo Nginx)
- **Deploy:** `scripts/deploy.sh` manual via SSH
- **Backup:** cron diário, `pg_dump` → Cloudflare R2 (rclone do quartzo)

## Portas

Para não colidir com quartzo (`5601` core, `5602` chat, `5603` evolution, `5434` postgres, `6381` redis):

| Serviço | Porta interna |
|---|---|
| API bestiário (PM2) | **5610** |
| Postgres | 5434 (compartilhado) |

Nenhuma nova porta exposta externamente — UFW segue `22/80/443`.

---

## Cronograma

Total estimado: **~11h** de trabalho concentrado (1.5 a 2 dias úteis com folga para bugs). Cada fase produz artefatos verificáveis.

### Fase 0 — Alinhamento *(feito nesta conversa)*

Decisões travadas:

- ✓ VPS compartilhada com quartzo
- ✓ Postgres compartilhado (novo DB dentro da mesma instância)
- ✓ Subdomínio `bestiary.sysnode.com.br`
- ✓ Deploy manual estilo quartzo (bash + PM2, sem CI/CD por ora)

### Fase 1 — Preparo do repositório para produção *(≈2h)*

Ajustes de código antes de qualquer coisa de infra. Tudo entra em PR local, sobe para `main`.

1. **`GET /health` no api** — endpoint público, sem X-API-Key, retorna `200 {"ok":true,"db":"up"}` após um `SELECT 1` no Postgres. É o que `deploy.sh` vai chamar em loop pós-reload.
2. **CORS restrito em produção** — `apps/api/src/app.ts` hoje usa `origin: true`. Trocar para ler `CORS_ORIGIN` do env; em prod aceitar apenas `https://bestiary.sysnode.com.br`.
3. **`env.ts` — novos campos:**
   - `CORS_ORIGIN` (required em prod, optional em dev)
   - `NODE_ENV` (default `development`)
4. **`apps/web` build config** — garantir `base: "/"` no vite, output em `dist/` limpo, sem source maps em prod.
5. **`.env.production.example` na raiz** — template com as vars de produção. Documenta cada campo. **Nunca** commita o `.env.production` real.
6. **Rate limit leve nas rotas de escrita** — `express-rate-limit`, 60 req/min por IP nas rotas com `requireApiKey`. Public reads ficam sem limite (Cloudflare já protege).
7. **Ajustar `openapi:generate`** para funcionar apontando para prod: aceitar `API_URL` via env.

**Critério de aceite:** `pnpm typecheck && pnpm build` limpo. `curl localhost:5101/health` responde 200.

### Fase 2 — Scripts de infra no repositório *(≈4h)*

Espelham a estrutura `infra/` + `scripts/` do quartzo.

**Novos arquivos:**

```
game/
├── ecosystem.config.cjs        # PM2 config para apps/api
├── infra/
│   ├── nginx/
│   │   └── bestiary.conf       # server block: 443 → PM2 5610 + dist estático
│   └── postgres/
│       └── init-bestiary.sql   # CREATE DATABASE + CREATE ROLE (one-off)
├── scripts/
│   ├── deploy.sh               # pull → install → build → migrate → pm2 reload → healthcheck
│   └── backup-pg.sh            # pg_dump | gzip | rclone → R2
└── docs/
    ├── DEPLOYMENT.md           # este arquivo
    └── VPS_RUNBOOK.md          # onde encontrar logs, como reverter, como ver status
```

**`ecosystem.config.cjs`** — PM2 gerencia só o processo `bestiary-api`:
```js
module.exports = {
  apps: [{
    name: "bestiary-api",
    script: "apps/api/dist/index.js",
    instances: 1,               // sem cluster; o volume não justifica
    max_memory_restart: "400M",
    env: { NODE_ENV: "production" },
    error_file: "/srv/bestiary/logs/api.err.log",
    out_file: "/srv/bestiary/logs/api.out.log",
  }],
};
```

**`scripts/deploy.sh`** — porta do padrão quartzo, adaptada:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /srv/bestiary/current
git fetch --tags && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm build                             # web + api
pnpm db:migrate                        # drizzle-kit, transacional
pm2 reload ecosystem.config.cjs --update-env
# healthcheck retry
for i in {1..10}; do
  curl -sfo /dev/null https://bestiary.sysnode.com.br/health && exit 0
  sleep 3
done
echo "healthcheck failed"; exit 1
```

**`infra/nginx/bestiary.conf`** — bloco 443 seguindo padrão quartzo (HSTS, security headers, cache imutável para assets, no-cache para `index.html`, proxy `/api/*` para `localhost:5610`). Não repete `redirect 80→443` porque o quartzo já tem um bloco default cobrindo.

**`scripts/backup-pg.sh`** — usa o mesmo rclone já configurado do quartzo, apenas com `PGDATABASE=bestiary_prod`. Retenção 30 dias no R2, 2 dias local.

**Critério de aceite:** todos os scripts commitados no repo, `chmod +x`, shellcheck limpo.

### Fase 3 — Setup inicial na VPS *(≈2h, one-time via SSH)*

Ações manuais, feitas uma vez. Vão para um runbook (`docs/VPS_RUNBOOK.md`) para referência.

1. **Criar DB e role no Postgres** (rodar via `sudo -u postgres psql`):
   ```sql
   CREATE ROLE bestiary_app WITH LOGIN PASSWORD '<forte>' NOSUPERUSER NOBYPASSRLS;
   CREATE DATABASE bestiary_prod OWNER bestiary_app;
   GRANT CONNECT ON DATABASE bestiary_prod TO bestiary_app;
   ```
2. **Diretórios em `/srv/bestiary/`:**
   ```bash
   sudo mkdir -p /srv/bestiary/{current,logs,backups}
   sudo chown -R deploy:deploy /srv/bestiary
   ```
3. **Clone inicial:**
   ```bash
   cd /srv/bestiary
   git clone https://github.com/FellipeMoura/game current
   ```
4. **`.env.production` na VPS** (fora do repo, `/srv/bestiary/current/.env`):
   ```
   NODE_ENV=production
   DATABASE_URL=postgres://bestiary_app:<senha>@localhost:5434/bestiary_prod
   API_KEY=<gerar 32+ chars random>
   API_PORT=5610
   CORS_ORIGIN=https://bestiary.sysnode.com.br
   FONTES_DIR=./fontes
   ```
5. **Cloudflare DNS:** adicionar A record `bestiary → <IP da VPS>`, proxy laranja on.
6. **Nginx:**
   ```bash
   sudo ln -s /srv/bestiary/current/infra/nginx/bestiary.conf /etc/nginx/sites-enabled/bestiary
   sudo nginx -t && sudo systemctl reload nginx
   ```
7. **TLS:** verificar se cert `*.sysnode.com.br` já cobre (`sudo certbot certificates`). Se não, emitir:
   ```bash
   sudo certbot certonly --dns-cloudflare -d bestiary.sysnode.com.br
   ```
8. **Cron do backup:**
   ```
   0 3 * * * /srv/bestiary/current/scripts/backup-pg.sh >> /srv/bestiary/logs/backup.log 2>&1
   ```
9. **Logrotate** — adicionar em `/etc/logrotate.d/bestiary`:
   ```
   /srv/bestiary/logs/*.log {
     daily rotate 14 compress delaycompress missingok notifempty
   }
   ```

**Critério de aceite:** `psql -h localhost -p 5434 -U bestiary_app bestiary_prod -c '\dt'` conecta (mesmo sem tabelas ainda). Nginx serve `bestiary.sysnode.com.br` (404 do PM2 esperado — API ainda não subiu).

### Fase 4 — Primeiro deploy *(≈1h)*

1. SSH na VPS, `cd /srv/bestiary/current`.
2. Rodar `scripts/deploy.sh` pela primeira vez. Esperado:
   - install (~1 min)
   - build (~30s)
   - migrate cria as 15 tabelas
   - seed **não** roda automaticamente — rodar manual uma vez: `pnpm db:seed` (popula o lote curado de arthropods; sem fontes, avisa `[skip]` para xlsx/docx e prossegue)
   - pm2 sobe o processo, healthcheck passa
3. **Smoke test:**
   ```bash
   curl https://bestiary.sysnode.com.br/health
   curl https://bestiary.sysnode.com.br/api/v1/elements
   curl https://bestiary.sysnode.com.br/api/v1/creatures
   ```
4. Abrir `https://bestiary.sysnode.com.br/bestiary/CRT-001` no browser — a ficha deve carregar com Trilobita + Isotelus.

**Critério de aceite:** os 3 curls devolvem 200 com payload esperado. UI renderiza a ficha completa.

### Fase 5 — Backup + monitor mínimo *(≈2h)*

1. **Testar backup end-to-end:**
   ```bash
   /srv/bestiary/current/scripts/backup-pg.sh
   # verificar em R2 se o arquivo apareceu
   # restaurar em um DB temporário para validar integridade:
   createdb bestiary_test
   gunzip -c /srv/bestiary/backups/latest.sql.gz | psql bestiary_test
   ```
2. **Uptime monitor** — adicionar `https://bestiary.sysnode.com.br/health` no Uptime Kuma (ou criar um health check no Cloudflare). Alerta por e-mail se cair.
3. **Sentry (opcional):** se o volume de erros justificar, adicionar SENTRY_DSN em `.env.production` e chamar `Sentry.init()` no `apps/api/src/index.ts`.
4. **Documentar** procedimentos em `docs/VPS_RUNBOOK.md`:
   - Como ver logs (`pm2 logs bestiary-api`, `tail -f /srv/bestiary/logs/*.log`)
   - Como reverter (`git reset --hard <sha>` + `deploy.sh`)
   - Como rodar um seed manual (`pnpm db:seed`)
   - Como restaurar backup

**Critério de aceite:** backup rodou, arquivo está no R2, restore em DB temporário abre sem erro. Alerta de uptime dispara quando `systemctl stop nginx` (teste breve, depois retomar).

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Migration falha em prod | `deploy.sh` roda tudo em transação; se `pnpm db:migrate` falhar, script sai antes de `pm2 reload` — apps continuam servindo versão antiga |
| Cert wildcard não cobre subdomínio | Fallback: emitir cert específico via `certbot --dns-cloudflare` — testado antes de apontar DNS |
| CORS quebra no browser | Testar `curl -H "Origin: https://bestiary.sysnode.com.br" -v` já na fase 4 |
| Conflito de porta com quartzo | 5610 escolhida com folga; sanity-check antes: `ss -tlnp \| grep 5610` |
| Deploy corrompe estado | Backup automático diário + snapshot manual antes de deploys estranhos |
| Agente floods a API | Rate limit leve nas rotas de escrita (fase 1) |
| Perda do `.env.production` | Cópia cifrada no cofre pessoal (1Password / age / etc) — o `API_KEY` é a única coisa que não dá para regerar sem invalidar os agentes ativos |

## Fora do escopo desta primeira leva

- CI (typecheck/build em PR) — próxima iteração; hoje o typecheck é local
- Deploy automático em push para main — próxima iteração
- Cluster PM2 / múltiplas instâncias — volume não justifica
- CDN dedicada para assets — Cloudflare na frente já resolve
- Autenticação de usuário — não faz parte do escopo do produto
- Rate limit em leitura — Cloudflare cobre

## Checklist enxuto (para colar em issue)

- [ ] Fase 1: `/health`, CORS, `.env.production.example`, rate limit
- [ ] Fase 2: `deploy.sh`, `backup-pg.sh`, `ecosystem.config.cjs`, `infra/nginx/bestiary.conf`
- [ ] Fase 3: DB + role Postgres, `/srv/bestiary/` dirs, DNS Cloudflare, Nginx symlink + reload, TLS, cron, logrotate
- [ ] Fase 4: primeiro `deploy.sh`, `pnpm db:seed` manual, smoke tests de 3 endpoints + UI
- [ ] Fase 5: backup end-to-end testado, Uptime Kuma configurado, `VPS_RUNBOOK.md` escrito
