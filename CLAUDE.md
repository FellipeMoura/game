# CLAUDE.md — briefing para sessões do Claude Code

Contexto essencial para trabalhar neste repositório. Leitura obrigatória antes de propor mudanças. Complementa o `README.md` (que foca em como rodar).

## O que é isto

App web de catálogo/documentação de um jogo 3D de coleção de criaturas com tema paleontológico. **Este repositório NÃO é o jogo** — o jogo em Godot vive em um repositório irmão em `code/games/` e não deve ser tocado a partir daqui. A ponte entre os dois é `pnpm game:export`, que escreve um bundle JSON versionado lá.

O jogo: Godot, câmera isométrica ortográfica travada em 30°/45°, exploração em tempo real e **combate por turnos** (1v1 com troca livre, in-world, sem arena separada).

**Dois públicos com necessidades opostas:**
- **Humanos leem** o bestiário, mapas, lore e histórico na UI. Frontend é 100% somente-leitura.
- **Agentes de IA escrevem** via API. Não existe formulário de edição, painel admin ou login de usuário no frontend.

Essa separação é deliberada — sem CRUD na UI, sem sessão, sem edição concorrente no navegador.

## Modelo de ameaça

**Os dados do bestiário não são valiosos.** Vazamento total do banco não geraria prejuízo — é catálogo de design de um jogo, nada pessoal, nada financeiro. Isso muda como pensamos segurança:

- **O que importa proteger:** os vizinhos do servidor. Uma vulnerabilidade no bestiário não pode ser trampolim para o quartzo, o Postgres compartilhado, ou o sistema operacional.
- **O que NÃO precisa de rigor:** confidencialidade dos dados, integridade forte, backup diário obsessivo, alertas 24/7.
- **Consequência prática:** role Postgres `bestiary_app` estritamente sem `SUPERUSER`/`BYPASSRLS` e sem grants em outros DBs; processo PM2 rodando como user não-root sem sudo; sem endpoints que executem comandos de shell / uploads arbitrários; UFW seguindo o padrão da VPS (só 22/80/443); Nginx com `server_name` específico, sem catch-all. Rate limit leve ainda vale — protege a VPS de saturar, não os dados.

Ao propor mudanças, calibrar por este modelo. Não perder tempo com criptografia de campos, auditoria fina, backup horário; **não** relaxar isolamento de perímetro.

## Stack

Monorepo pnpm workspaces:

- **`apps/api`** — Node + TypeScript + Express + Drizzle + Zod + zod-to-openapi + PostgreSQL
- **`apps/web`** — Vite + React 19 + React Router 7 + TanStack Query + Tailwind + openapi-fetch
- **`packages/db`** — schemas Drizzle e migrations. O `seed/` está **congelado** (ver abaixo).
- **`scripts/export-game-data.mjs`** — export build-time do bundle para o repo Godot

**Não usamos:** Docker em prod, Redis, BullMQ, Socket.io, MinIO, RLS multi-tenant, JWT, OAuth, migrations com Alembic-like, rate limiting. Padrão inspirado no `c:\code\saas\frostie` mas enxuto.

Portas: web 5100, api 5101, postgres 5102.

## Regras invioláveis

Estas quatro regras não têm exceção. Se algo parecer conflitar com elas, elas ganham.

1. **Escrita só via API.** Frontend nunca envia `POST`/`PATCH`/`DELETE`.
2. **Terminologia travada.** Termo oficial: **"Despertar Ancestral"** (transformação temporária, retorno à forma base). Os termos **"Evolução"** e **"Forma Ancestral"** estão descontinuados. Middleware `rejectForbiddenTerms` scaneia todo body de escrita e retorna `422` se achar essas expressões em qualquer campo de texto, apontando o campo ofensor. Ver `apps/api/src/shared/services/terminology.ts`.
3. **Toda escrita gera changelog na mesma transação.** Campos `reason` e `impact` são obrigatórios em todo body de POST/PATCH. O servidor grava a entrada de changelog e incrementa a versão (formato `0.NN`) sozinho — agente **nunca** escolhe a versão. Ver `apps/api/src/shared/services/changelog.ts`.
4. **Economia de tokens é requisito funcional.** Quem consome a API é LLM pagando por token. `POST` responde só `{"code","version"}`. `GET` aceita `?fields=code,name`. Erros nomeiam campo e valores válidos: `"classCode: 'CLS-999' does not exist"`, não `"invalid"`.

5. **O seed está congelado.** `packages/db/src/seed/` existiu para tirar o corpus dos `.docx`/`.xlsx` antes do primeiro deploy. Esse trabalho acabou. **Nunca adicionar lote de conteúdo novo lá.** Conteúdo entra pela API — que gera changelog e versão sozinha. Conteúdo commitado como TypeScript não tem nem um nem outro. Para hidratar uma máquina de dev, `pnpm db:pull`.

## Naming (aprendido na marra)

- **Código = inglês:** tabelas (`creatures`, `awakenings`, `creature_classes`, `game_maps`, `design_documents`), colunas (`original_name`, `activation_chance_pct`), endpoints (`/api/v1/creatures/{code}`), variáveis, componentes, pastas.
- **Colisões TS resolvidas:** `CreatureClass` (não `Class`), `GameMap` (não `Map`), `DesignDocument` (não `Document`).
- **UI = português:** títulos, botões, labels, mensagens de estado, mensagens de erro. Nunca inline nas rotas — passa por `apps/web/src/lib/labels.ts`.
- **Conteúdo do domínio = português:** valores em campos de texto (nomes de criaturas, notas, corpo dos documentos, motivo/impacto do changelog).
- **Enums no banco = inglês** (`reinforcement`, `swap`, `paleozoic`), traduzidos na apresentação via `labels.ts` (`AWAKENING_TYPE_LABEL`, `ERA_LABEL`, `DOCUMENT_STATUS_LABEL`).
- **Prefixos de código dos dados** preservados dos fontes originais em português: `CRT`, `DSP`, `ELE`, `CLS`, `BIO`, `HAB`, `ITM`, `NPC`, `MIS`, `DRP`. São valores, não código.

## Convenções por camada

**API — feature-folder por recurso** em `apps/api/src/modules/<feature>/`:
- `{Feature}Types.ts` — Zod schemas com `.openapi()` (single source of truth para validação + docs)
- `{Feature}Service.ts` — data access, escreve dentro de `db.transaction` com `recordChange`
- `{Feature}Controller.ts` — thin, delega para Service, `satisfies RequestHandler`
- `{Feature}Routes.ts` — Express router + `registerPath` no `registry`

**Quatro helpers reduzem boilerplate** em `apps/api/src/shared/services/`:
- `crudFactory.ts` — gera list/get/create/update/batchCreate para tabelas SEM FKs (elements, biomes, items, creature-classes)
- `crudRoutes.ts` — gera as 5 rotas padrão + registerPath OpenAPI a partir dos schemas
- `childUpsertFactory.ts` — para tabelas 1:1 filhas de um pai com `code`, endereçadas pelo código do pai e escritas por upsert (creature-stats, ability-stats, capture-rules)
- `childUpsertRoutes.ts` — as 4 rotas desse padrão: list, get-by-parent-code, upsert, batch

**Quando NÃO usar factory:**
- Recursos com FK (creatures, awakenings, missions, npcs, abilities, drops, junctions) — Service manual porque precisa resolver códigos para ids dentro da transação via `resolveCodeInTx` (`apps/api/src/shared/services/fkResolver.ts`)
- Awakenings tem constraint 1-para-1 em `creatureCode` — POST em criatura que já tem despertar responde `409`
- Junções (`drops`, `map-biomes`, `elemental-advantages`) usam semântica upsert (`onConflictDoUpdate`), sem PATCH/DELETE

**Endpoints especiais:**
- `GET /context` — snapshot markdown compacto (terminologia + elementos + classes + contagens + últimas 5 versões). Primeira leitura de qualquer agente escritor.
- `GET /documents/{slug}` — content negotiation: `Accept: text/markdown` devolve texto puro, senão JSON com envelope.

## Regras de domínio (não estão no código)

- **Elenco fechado em 3 classes:** Artrópodes (CLS-001), Sinapsídeos (CLS-002), Sauropsídeos (CLS-003). Criatura que não cabe em nenhuma delas não entra no jogo. "Vertebrados Primitivos" e "Incertos" foram removidas.
- **Classes NÃO influenciam combate** nem captura. Hard rule do Changelog 0.01. Nunca adicionar campo de dano/multiplicador em `creature_classes`.
- **Elementos SIM, em anel fechado:** Água → Fogo → Natureza → Terra → Gelo → Eletricidade → Água (seta = vence). Vantagem 2.0, desvantagem 0.5, resto 1.0 por omissão. Cada elemento vence exatamente um e perde para exatamente um — a simetria é o ponto, não um acidente.
- **Criatura ↔ Despertar é 1-para-1.** Tabela `awakenings` tem `UNIQUE(creature_id)`. Ausência de linha = criatura sem despertar. Hoje a cobertura é 26/26.
- **3 eras × 3 mapas × ~20 criaturas inéditas** — escopo total do jogo. Reaparições em mapas posteriores não contam para o limite.
- **Regra 70/30** do Despertar Ancestral: ~70% "reforço" (mesma espécie amplificada, multiplicador 1.5), ~30% "troca" (vira outra espécie relacionada, multiplicador 1.7).
- **Silhueta é critério de corte** — cada criatura deve ser reconhecível pela sombra, projetada em 30°/45°.

## Camada de números (o que o jogo consome)

Quatro tabelas separam o catálogo editorial dos valores que o jogo executa. Todas usam upsert — re-POST para mudar, sem PATCH.

- `creature_stats` — 1:1 com criatura. `baseHp`, `baseAttack`, `baseDefense`, `baseSpeed`, `baseCharge`, `growthRate`. Valor efetivo: `floor(base * (1 + growthRate * (nível - 1)))`.
- `ability_stats` — 1:1 com habilidade. `power` 0 = movimento de status; `effectCode` é o switch que o Godot roda.
- `capture_rules` — 1:1 com criatura. `catchRate` 1–255.
- `creature_abilities` — junção: qual criatura sabe qual golpe, em que nível.

**Dano:** `floor((power * attack / defense) * 0.4 * multElemental * random(0.90, 1.10))`, mínimo 1.
**Carga do Despertar:** enche com dano recebido (×1.0) e causado (×0.5), escalado por `baseCharge / 50`. Cheia em 100, dura 3 turnos, zera na reversão. Receber enche o dobro de causar — deliberado, para o Despertar ser virada de jogo e não amplificador de vitória.

Especificação legível para humanos: documentos `combate`, `carga-e-despertar` e `captura` na API.

## Frontend visual

Direção: **arquivo científico dark editorial**. Não é padrão frostie/shadcn — tokens próprios em `apps/web/tailwind.config.ts`:

- Paleta: `void #0A0B0D`, `slate`, `bone`, `moss`, `graphite`, `ember`
- Fontes: Space Grotesk (display) + JetBrains Mono (códigos) + Inter (body)
- Cards angulares (radius 0-2px), sem sombra, escala tipográfica não-linear
- **`ember` é o único acento quente.** Regra: máximo 1 uso por tela, nunca como fundo de botão
- **A ficha de criatura é o único lugar com peso visual.** Hero number CRT-XXX em display XL + barra `moss` de escala à esquerda. Bestiário/docs/changelog ficam quietos.
- Piso: `prefers-reduced-motion` respeitado, foco de teclado visível (`outline ember`), `bone` só ≥14px (abaixo cair para `#F5F1E6`)

## Comandos frequentes

```powershell
pnpm dev                  # sobe api + web em paralelo
pnpm typecheck            # três workspaces
pnpm db:pull              # hidrata o dev com um snapshot de prod — o caminho normal
pnpm db:studio            # drizzle-kit GUI para inspecionar
pnpm openapi:generate     # regera schema.d.ts do web a partir da API rodando
pnpm game:export          # gera o bundle JSON no repo Godot irmão
pnpm db:seed              # CONGELADO — bootstrap offline, não usar para conteúdo novo
pnpm db:reset             # create + generate + migrate + seed (setup do zero, sem dados de prod)
```

`pnpm game:export` aceita `--from <url>` (default API local) e `--out <path>` (default `../godot`). Ele **falha** se alguma criatura estiver sem stats, sem regra de captura ou sem golpes — em vez de gerar um bundle que quebra o jogo em runtime.

## Coisas para NÃO fazer

- Não adicionar campo de combate em `creature_classes`.
- Não adicionar lote de conteúdo em `packages/db/src/seed/`. Está congelado — conteúdo entra pela API.
- Não criar criatura fora das três classes. Se não é artrópode, sinapsídeo ou sauropsídeo, está fora do escopo.
- Não citar os termos descontinuados em documento, nem para explicar que estão descontinuados. Foi exatamente assim que o documento `despertar-ancestral` se corrompeu: o replace automático do import reescreveu as citações e produziu uma frase dizendo que o termo oficial estava descontinuado. A lista vive em `terminology.ts`, que sabe a diferença entre usar um termo e falar sobre ele.
- Não usar "Evolução" ou "Forma Ancestral" em nenhum lugar — código, comentário, exemplo, mock, teste. Se aparecer em texto vindo de fora (tabela do usuário, docx importado), fazer replace automático `Evolução → Despertar`, `Forma Ancestral → Despertar Ancestral` no ato do import.
- Não escrever changelog manualmente pelo lado do agente/frontend. Sempre `recordChange(tx, ...)` dentro da transação do write.
- Não devolver o objeto criado inteiro em `POST` — só `{code, version}`. O agente já enviou; devolver duplica tokens.
- Não usar shadcn/ui. Componentes trazem radius e paleta que brigam com a direção visual — mais retrabalho refinar do que HTML nativo + Tailwind.
- Não instalar Alembic, Prisma, tRPC, GraphQL, MinIO, Redis, Docker Compose. Se propuser algo que puxe uma dessas, questionar antes.
- Não commitar arquivos de `./fontes/` (xlsx/docx). Cada dev traz sua cópia — `.gitignore` cobre.
- Não commitar `.env`. Só `.env.example` vai para o repo.

## Onde procurar informação

- **README.md** — como clonar e rodar
- **`packages/db/src/schema/`** — modelo de dados (19 tabelas + junctions + enums)
- **`packages/db/src/schema/stats.ts`** — a camada de números, com as fórmulas documentadas
- **`apps/api/src/shared/services/`** — as decisões arquiteturais principais (terminology, changelog, crudFactory, crudRoutes, childUpsertFactory, childUpsertRoutes, fkResolver, query)
- **`apps/api/src/modules/elements/`** — módulo de referência para o padrão sem FK
- **`apps/api/src/modules/creatures/`** — módulo de referência para o padrão com múltiplas FKs
- **`apps/api/src/modules/drops/`** — padrão upsert para junctions
- **`apps/api/src/modules/creatureStats/`** — padrão filho-1:1-por-código-do-pai
- **`scripts/export-game-data.mjs`** — o contrato de dados com o jogo
- **`apps/web/src/routes/CreatureDetail.tsx`** — a única tela com peso visual; referência da direção editorial
- **`apps/web/src/lib/labels.ts`** — todas as traduções enum → português
- **`fontes/README.md`** — o que vai na pasta ignorada
