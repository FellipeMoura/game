# Atualizar o banco de dev com o snapshot de prod

Guia operacional do `pnpm db:pull`. Vale para hidratar máquina nova, refrescar depois de escrever em prod, ou destravar quando o `checkStaleness` avisa que o dev ficou para trás.

## O princípio

**Prod é a fonte de verdade.** Escrita vai por API contra `https://bestiary.sysnode.com.br` (ver [DATA_WORKFLOW.md](DATA_WORKFLOW.md)); o dev existe para ler, testar, gerar `game:export` e rodar `pnpm dev`. Sincronizar é sempre no sentido `prod → dev` — nunca o inverso.

O sync **trunca** as 15 tabelas de conteúdo do dev antes de reinserir, preservando IDs de prod para as FKs continuarem 1:1. Não há merge; qualquer coisa que você escreveu no local **desaparece**. Se estava tentando um cenário de teste, salve antes.

## O caminho normal

```powershell
pnpm db:pull
```

Só isso. O script:

1. Aplica migrations pendentes no dev (não precisa `pnpm db:migrate` antes)
2. Lê a versão do changelog de prod e do dev
3. Se são iguais, sai sem tocar em nada (`dev database already up to date, nothing to do`)
4. Caso contrário, `TRUNCATE ... CASCADE` e reinsere em ordem pai→filho
5. Reseta as sequences para `MAX(id)` de cada tabela

Uso típico:

```powershell
# depois de escrever em prod
pnpm db:pull

# em máquina nova, depois de db:create + db:migrate
pnpm db:pull

# quando o nudge no `pnpm dev` reclamar
pnpm db:pull
```

## O nudge (staleness check)

`pnpm dev` roda `pnpm db:check-stale` antes de subir api + web. É consulta silenciosa que compara a versão do changelog local com a de prod (fetch com 3s de timeout) e imprime uma linha se estiver atrás:

```
[bestiary] dev DB is behind prod: dev 0.87, prod 0.91 — run `pnpm db:pull` to sync
```

Nunca bloqueia startup — se offline, se o DB não existe, se a API de prod está fora, o check sai silencioso com `exit 0`. É lembrete, não portão.

## Dois modos de transporte

Escolha via `PULL_MODE` no `.env`. Ambos preservam IDs.

| Modo | Setup | Velocidade | Quando usar |
|---|---|---|---|
| `api` *(default)* | zero | mais lento — GETs paginados de 500 em 500 | uso normal, ~15 tabelas do bestiário são rápidas assim |
| `db` | requer tunnel SSH | mais rápido — `SELECT * FROM ...` direto | catálogo grande, ou muitos pulls seguidos |

**Você quase sempre quer o default `api`.** O modo `db` só compensa quando os pulls estão doendo — o volume atual do bestiário roda em segundos pelo API.

### Modo `api` (default)

```powershell
# .env
PULL_MODE=          # vazio ou "api"
PROD_API_URL=       # vazio → usa https://bestiary.sysnode.com.br
```

Sem setup. Se estiver testando contra outra instância (staging, ambiente pessoal), aponte `PROD_API_URL` para a base.

### Modo `db` (via tunnel SSH)

Prod não expõe 5432/5434 publicamente — o Postgres na sysnode fica preso em `localhost` do container Docker. Para ler direto, abra um tunnel SSH e faça `PROD_DATABASE_URL` apontar para a porta local que sai do outro lado como Postgres de prod.

```powershell
# 1) Abrir o tunnel num terminal separado (mantém aberto durante o pull)
ssh -L 5434:localhost:5434 <seu-user>@bestiary.sysnode.com.br

# 2) Configurar o .env:
#   PULL_MODE=db
#   PROD_DATABASE_URL=postgres://bestiary_app:<senha>@localhost:5434/bestiary_prod

# 3) Rodar o pull normalmente
pnpm db:pull
```

A senha do `bestiary_app` está no `/srv/bestiary/current/.env` da VPS (extraível com o mesmo `sed` do runbook — ver [VPS_RUNBOOK.md](VPS_RUNBOOK.md#snapshot-manual-do-banco)).

**Se `PROD_DATABASE_URL` estiver localhost sem tunnel aberto**, o pull falha com uma mensagem que explica exatamente isso e sugere o comando `ssh -L`. Não silencie a mensagem — é o script te salvando de rodar contra o dev pensando ser prod.

**Guarda-corpos do modo db:**
- `PROD_DATABASE_URL == DATABASE_URL` → aborta com "refusing to truncate prod" (evita você fazer `TRUNCATE` na prod achando ser dev)
- Conexão em prod entra em `read only` na sessão antes de qualquer consulta

## Guarda-corpos gerais

O `pull.ts` recusa três cenários independentes do modo:

- `NODE_ENV=production` → refuses; "db:pull is a dev tool"
- `DATABASE_URL` ausente → erro imediato
- `PULL_MODE` que não seja `api` ou `db` → erro nomeando o valor inválido

Nada disso é opcional. Se algum guard triggerar, ele **está protegendo você** — reveja o `.env` antes de tentar contornar.

## O que fica de fora do pull

- **Migrations aplicadas.** O script roda `migrate` antes do truncate — o schema do dev fica igual ao repo, não ao de prod. Se prod está em migration mais nova que o repo local, refresque o `git pull` primeiro.
- **Arquivos de `./fontes/`.** São dos originais em `.docx`/`.xlsx`, cada dev tem a cópia. O pull não sabe deles.
- **Modelos 3D.** Servidos por `/models/*.glb` do Nginx, não vão pelo pull. O que atravessa é a coluna `modelUrl` das criaturas.
- **`.env` da VPS.** Nem `API_KEY`, nem senha do Postgres — o pull só lê tabelas de conteúdo.

## Quando o pull não é o que você quer

- **Copiar apenas uma tabela** ou linhas específicas: use `docker exec ... pg_dump -t <tabela>` diretamente contra prod (ver runbook), depois `psql` no container local. O `db:pull` não sabe fazer sync parcial de propósito — ou é o snapshot inteiro, ou é chirurgia manual.
- **Copiar do dev para outra máquina de dev**: apontar `PROD_API_URL=http://<ip-do-outro-dev>:5101` funciona, mas o modo `db` não — o Postgres do outro dev está atrás de `localhost` dele. Mais simples: aquele dev roda `pnpm db:pull` da prod.
- **Testar uma migration destrutiva**: `pnpm db:reset` recria do zero (create + generate + migrate + seed). O seed é o bootstrap curado, não o snapshot de prod — para snapshot completo, encadeie `pnpm db:reset && pnpm db:pull`.

## Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `dev database already up to date, nothing to do` mas você **sabe** que prod mudou | O cache de versão do dev acidentalmente bate — talvez a última escrita não fez incrementar? | Cheque o changelog de prod: `curl.exe -s https://bestiary.sysnode.com.br/api/v1/changelog?limit=3`. Se a versão realmente subiu, tem bug — abra issue. |
| `cannot reach prod database via PROD_DATABASE_URL (ECONNREFUSED) — target: localhost:5434` | Modo `db` sem tunnel aberto, ou o tunnel caiu | Reabra o `ssh -L ...` num terminal separado e rode o pull de novo |
| `PROD_DATABASE_URL must differ from DATABASE_URL — refusing to truncate prod` | Você colou a `DATABASE_URL` de prod literal no `.env` local | Corrija: `PROD_DATABASE_URL` deve apontar para a **ponta local** do tunnel, `DATABASE_URL` para o Postgres do docker local |
| `GET .../creatures?limit=500&offset=0 → 429` no modo `api` | Rate limit de prod te pegou (leitura é aberta, mas há teto de higiene) | Aguarde 1 min e refaça. Se recorrente, prefira modo `db` |
| `PULL_MODE=db requires PROD_DATABASE_URL` | `.env` incompleto | Ou preencha `PROD_DATABASE_URL`, ou apague `PULL_MODE=db` (volta ao default `api`) |
| `db:pull is a dev tool — refusing to run with NODE_ENV=production` | Você está numa máquina com `NODE_ENV=production` no ambiente | Correto! Ele está te salvando. Não force. |
| Pull terminou mas `pnpm dev` ainda mostra dados velhos no browser | Cache do TanStack Query | Hard reload na UI, ou reinicie o vite |

## Depois do pull

O dev fica igual a prod no momento da leitura. A partir daí:

- **Continue escrevendo em prod**, não no local. Este é o ponto do fluxo — o pull é para ler, não para se acostumar a escrever local e promover depois. Ver [DATA_WORKFLOW.md](DATA_WORKFLOW.md#o-principio).
- **Se for exportar para o jogo agora**, prefira apontar direto para prod:
  ```powershell
  pnpm game:export --from https://bestiary.sysnode.com.br --out ..\avyron
  ```
  Assim o `dataVersion` do bundle é o de prod, não uma foto do que estava no dev quando você puxou.
