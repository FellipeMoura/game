# VPS Runbook — bestiary.sysnode.com.br

Comandos prontos para quem opera a VPS. Complementa `docs/DEPLOYMENT.md` (que é o cronograma) — este arquivo é a referência do dia-a-dia.

Assume:

- Você faz SSH na VPS como um user com `sudo`, **não como root** (ex: `elora`, `deploy`, ou qualquer outro do dia-a-dia). Todos os comandos abaixo usam `$USER` — o próprio user logado, seja qual for.
- Postgres 16 já roda em `localhost:5434` (compartilhado com quartzo).
- Nginx e certbot já existem na VPS (herança do quartzo).

## Primeira vez — setup (fases 3 e 4 do DEPLOYMENT.md)

Rodar apenas uma vez. Depois disso, o dia-a-dia é só `./scripts/deploy.sh`.

### 1. Editar o SQL de bootstrap para trocar a senha do Postgres

```bash
# Gere uma senha forte na sua máquina local (não na VPS):
openssl rand -base64 24
```

Guarde essa senha — vai em dois lugares: aqui e no `.env` da VPS (passo 5).

### 2. Clonar o repositório

```bash
sudo mkdir -p /srv/bestiary/{logs,backups}
sudo chown -R $USER:$USER /srv/bestiary
cd /srv/bestiary
git clone https://github.com/FellipeMoura/game current
cd current
```

> **Nota:** `logs/` e `backups/` são criados com `mkdir -p`, mas `current/`
> **não** — o `git clone` precisa criá-lo. Se você já rodou o mkdir com
> `current` no meio das chaves e o clone falhou com "Permission denied":
> `rm -rf /srv/bestiary/current` e refaça o clone.

### 3. Instalar dependências e buildar (para o Nginx ter o `apps/web/dist`)

```bash
pnpm install --frozen-lockfile
pnpm build
```

### 4. Criar DB e role no Postgres

Edite o SQL trocando a senha antes de aplicar:

```bash
# Substitua CHANGE_ME_BEFORE_RUNNING pela senha que você gerou:
sed -i "s/CHANGE_ME_BEFORE_RUNNING/SUA_SENHA_AQUI/" infra/postgres/init-bestiary.sql

sudo -u postgres psql -f /srv/bestiary/current/infra/postgres/init-bestiary.sql
```

Verificar que o role **não** consegue acessar `quartzo_prod`:

```bash
# Deve retornar "permission denied for database" — se conectar, algo está errado.
PGPASSWORD='SUA_SENHA_AQUI' psql -h localhost -p 5434 -U bestiary_app -d quartzo_prod -c '\dt' 2>&1 | head -3
```

Depois **descartar** a versão editada do SQL (não commitar):

```bash
git checkout -- infra/postgres/init-bestiary.sql
```

### 5. Criar o `.env` de produção na VPS

```bash
cp .env.production.example .env

# Editar as três linhas com valores reais:
#   DATABASE_URL — trocar REPLACE_WITH_STRONG_PASSWORD pela senha do passo 1
#   API_KEY      — gerar novo: openssl rand -base64 32
nano .env

chmod 600 .env  # só o dono lê
```

### 6. Rodar migrations e seed (primeira vez)

```bash
pnpm db:migrate    # cria as 15 tabelas
pnpm db:seed       # popula o lote curado (arthropods). Sem fontes/, avisa [skip] e prossegue
```

### 7. DNS no Cloudflare

Painel Cloudflare → zona `sysnode.com.br` → adicionar record:

- **Type:** A
- **Name:** `bestiary`
- **IPv4 address:** IP da VPS (o mesmo do quartzo)
- **Proxy status:** Proxied (laranja)

### 8. TLS — verificar se o wildcard cobre

```bash
sudo certbot certificates | grep -A2 sysnode
```

Se aparecer `*.sysnode.com.br` nos domains, está coberto. Caso contrário:

```bash
sudo certbot certonly --dns-cloudflare -d bestiary.sysnode.com.br
```

E editar `infra/nginx/bestiary.conf` para apontar para o novo cert path (`/etc/letsencrypt/live/bestiary.sysnode.com.br/`).

### 9. Nginx — symlink e reload

```bash
sudo ln -s /srv/bestiary/current/infra/nginx/bestiary.conf /etc/nginx/sites-enabled/bestiary
sudo nginx -t                     # valida sintaxe — se falhar, NÃO reload
sudo systemctl reload nginx
```

### 10. Subir o processo via PM2

```bash
pm2 start ecosystem.config.cjs --update-env
pm2 save                          # persiste a lista de processos
pm2 startup                       # imprime um comando com sudo — copiar e colar para habilitar auto-start no boot
```

### 11. Smoke tests

```bash
curl -i https://bestiary.sysnode.com.br/health
# Esperado: 200 {"ok":true,"db":"up"}

curl -s https://bestiary.sysnode.com.br/api/v1/elements | head -c 200
# Esperado: JSON array com 5+ elementos

curl -s https://bestiary.sysnode.com.br/api/v1/creatures?fields=code,originalName | head -c 300
# Esperado: JSON array com Trilobita, Anomalocaris, etc.
```

E abrir `https://bestiary.sysnode.com.br/bestiary/CRT-001` no browser — deve mostrar a ficha completa com hero number.

### 12. Logrotate

```bash
sudo tee /etc/logrotate.d/bestiary > /dev/null <<'EOF'
/srv/bestiary/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF
```

Pronto. A partir daqui, o dia-a-dia é a próxima seção.

---

## Dia-a-dia

### Deploy nova versão

Depois de fazer merge em `main` no GitHub:

```bash
ssh deploy@vps
cd /srv/bestiary/current
./scripts/deploy.sh
```

O script cuida de: pull → install → build → migrate → reload → healthcheck. Se qualquer passo falhar, ele para antes do reload e o processo antigo continua servindo.

### Ver logs

```bash
pm2 logs bestiary-api                    # streaming das últimas linhas
pm2 logs bestiary-api --lines 200        # backfill
tail -f /srv/bestiary/logs/api.err.log   # só erros
tail -f /srv/bestiary/logs/deploy.log    # histórico de deploys
sudo tail -f /var/log/nginx/bestiary.error.log
```

### Status do processo

```bash
pm2 status bestiary-api
pm2 describe bestiary-api                # memória, uptime, restarts
```

### Restart manual (raro)

```bash
pm2 restart bestiary-api
```

### Reverter para um commit anterior

```bash
cd /srv/bestiary/current
git log --oneline -20                    # achar o SHA que funciona
git reset --hard <sha>
./scripts/deploy.sh                       # aplica o rollback
```

Se a migration reversível quebrar, precisa restaurar de backup — ver próxima seção.

### Snapshot manual do banco (antes de deploy arriscado)

```bash
cd /srv/bestiary/current
PGPASSWORD='...' ./scripts/backup-pg.sh
ls -lh /srv/bestiary/backups/
```

### Restaurar de backup

```bash
# Descompactar
gunzip -k /srv/bestiary/backups/bestiary-YYYYMMDD.sql.gz

# Restaurar numa cópia primeiro para validar (recomendado):
sudo -u postgres psql -c "CREATE DATABASE bestiary_test OWNER bestiary_app;"
PGPASSWORD='...' psql -h localhost -p 5434 -U bestiary_app -d bestiary_test \
  -f /srv/bestiary/backups/bestiary-YYYYMMDD.sql

# Se validou, sobrescrever o real (com o api parado para evitar conexões):
pm2 stop bestiary-api
sudo -u postgres psql -c "DROP DATABASE bestiary_prod;"
sudo -u postgres psql -c "CREATE DATABASE bestiary_prod OWNER bestiary_app;"
PGPASSWORD='...' psql -h localhost -p 5434 -U bestiary_app -d bestiary_prod \
  -f /srv/bestiary/backups/bestiary-YYYYMMDD.sql
pm2 start bestiary-api
```

### Rodar seed novamente

```bash
cd /srv/bestiary/current
pnpm db:seed
```

Idempotente — não duplica registros nem cria changelog extra se o lote já foi importado.

### Regerar tipos OpenAPI do frontend (quando o schema muda)

Feito localmente, não na VPS:

```bash
# No seu laptop, com o repo local:
pnpm openapi:generate                    # aponta para localhost:5101 por padrão
# Ou apontando para prod:
API_URL=https://bestiary.sysnode.com.br pnpm openapi:generate
```

Depois commitar `apps/web/src/lib/api/schema.d.ts` e fazer deploy normal.

### Parar tudo (manutenção)

```bash
pm2 stop bestiary-api
# Nginx continua respondendo, mas devolve 502 em /api/*.
```

Retomar:

```bash
pm2 start bestiary-api
```

---

## Troubleshooting

| Sintoma | Verificar |
|---|---|
| Deploy trava em "healthcheck" | `pm2 logs bestiary-api` — provável erro no boot ou DB fora do ar |
| `502 Bad Gateway` na UI | Processo caído: `pm2 status`; porta trocada: `ss -tlnp \| grep 5610` |
| `429 Too Many Requests` | Rate limit; aguardar 1 min. Se recorrente, aumentar `max` em `rateLimit.ts` |
| `422` sobre "Terminologia descontinuada" | Body do agente contém "Evolução"/"Forma Ancestral" — corrigir para "Despertar Ancestral" |
| Migrations falham | Ver `pm2 logs` e o output do próprio `deploy.sh` — script já reverte transacionalmente |
| Certificado expirando | `sudo certbot renew --dry-run` — o cron do sistema normalmente renova sozinho |
| Disco cheio | `du -sh /srv/bestiary/logs /srv/bestiary/backups` — logrotate deveria conter, ajustar `rotate N` se preciso |
| `bestiary_app` conseguiu acessar `quartzo_prod` | ⚠ **incidente**: revogar imediatamente, revisar `init-bestiary.sql`, verificar se algum grant vazou |

## Contatos e localizações

- Repo: https://github.com/FellipeMoura/game
- URL: https://bestiary.sysnode.com.br
- Código-fonte na VPS: `/srv/bestiary/current`
- Logs: `/srv/bestiary/logs/`
- Backups: `/srv/bestiary/backups/`
- Nginx conf: `/etc/nginx/sites-enabled/bestiary` (symlink → `infra/nginx/bestiary.conf`)
- PM2 dump: `~/.pm2/dump.pm2`
