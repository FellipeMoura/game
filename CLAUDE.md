# CLAUDE.md — briefing para sessões do Claude Code

Contexto essencial para trabalhar neste repositório. Leitura obrigatória antes de propor mudanças. Complementa o `README.md` (que foca em como rodar).

## O que é isto

App web de catálogo/documentação de um jogo 2D de coleção de criaturas com tema paleontológico. **Este repositório NÃO é o jogo** — o jogo em Godot vive em outro repositório e não deve ser tocado a partir daqui.

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
- **`packages/db`** — schemas Drizzle, migrations, seed (xlsx + docx + lotes curados em `seed/content/`)

**Não usamos:** Docker em prod, Redis, BullMQ, Socket.io, MinIO, RLS multi-tenant, JWT, OAuth, migrations com Alembic-like, rate limiting. Padrão inspirado no `c:\code\saas\frostie` mas enxuto.

Portas: web 5100, api 5101, postgres 5102.

## Regras invioláveis

Estas quatro regras não têm exceção. Se algo parecer conflitar com elas, elas ganham.

1. **Escrita só via API.** Frontend nunca envia `POST`/`PATCH`/`DELETE`.
2. **Terminologia travada.** Termo oficial: **"Despertar Ancestral"** (transformação temporária, retorno à forma base). Os termos **"Evolução"** e **"Forma Ancestral"** estão descontinuados. Middleware `rejectForbiddenTerms` scaneia todo body de escrita e retorna `422` se achar essas expressões em qualquer campo de texto, apontando o campo ofensor. Ver `apps/api/src/shared/services/terminology.ts`.
3. **Toda escrita gera changelog na mesma transação.** Campos `reason` e `impact` são obrigatórios em todo body de POST/PATCH. O servidor grava a entrada de changelog e incrementa a versão (formato `0.NN`) sozinho — agente **nunca** escolhe a versão. Ver `apps/api/src/shared/services/changelog.ts`.
4. **Economia de tokens é requisito funcional.** Quem consome a API é LLM pagando por token. `POST` responde só `{"code","version"}`. `GET` aceita `?fields=code,name`. Erros nomeiam campo e valores válidos: `"classCode: 'CLS-999' does not exist"`, não `"invalid"`.

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

**Dois helpers reduzem boilerplate** em `apps/api/src/shared/services/`:
- `crudFactory.ts` — gera list/get/create/update/batchCreate para tabelas SEM FKs (elements, biomes, items, creature-classes)
- `crudRoutes.ts` — gera as 5 rotas padrão + registerPath OpenAPI a partir dos schemas

**Quando NÃO usar factory:**
- Recursos com FK (creatures, awakenings, missions, npcs, abilities, drops, junctions) — Service manual porque precisa resolver códigos para ids dentro da transação via `resolveCodeInTx` (`apps/api/src/shared/services/fkResolver.ts`)
- Awakenings tem constraint 1-para-1 em `creatureCode` — POST em criatura que já tem despertar responde `409`
- Junções (`drops`, `map-biomes`, `elemental-advantages`) usam semântica upsert (`onConflictDoUpdate`), sem PATCH/DELETE

**Endpoints especiais:**
- `GET /context` — snapshot markdown compacto (terminologia + elementos + classes + contagens + últimas 5 versões). Primeira leitura de qualquer agente escritor.
- `GET /documents/{slug}` — content negotiation: `Accept: text/markdown` devolve texto puro, senão JSON com envelope.

## Regras de domínio (não estão no código)

- **Classes NÃO influenciam combate.** Hard rule do Changelog 0.01. Nunca adicionar campo de dano/multiplicador em `creature_classes`.
- **Elementos SIM.** A tabela `elemental_advantages` guarda (attacker, defender, multiplier). Simetria não é enforcada.
- **Criatura ↔ Despertar é 1-para-1.** Tabela `awakenings` tem `UNIQUE(creature_id)`. Ausência de linha = criatura sem despertar.
- **3 eras × 3 mapas × ~20 criaturas inéditas** — escopo total do jogo. Reaparições em mapas posteriores não contam para o limite.
- **Regra 70/30** do Despertar Ancestral (roadmap): 70% chance de "reforço" (mesma espécie amplificada), 30% de "troca" (vira outra espécie relacionada).
- **Silhueta é critério de corte** — cada criatura deve ser reconhecível pela sombra.

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
pnpm db:seed              # idempotente; roda xlsx + docx + lotes curados
pnpm db:studio            # drizzle-kit GUI para inspecionar
pnpm openapi:generate     # regera schema.d.ts do web a partir da API rodando
pnpm db:reset             # create + generate + migrate + seed (setup do zero)
```

## Coisas para NÃO fazer

- Não adicionar campo de combate em `creature_classes`.
- Não usar "Evolução" ou "Forma Ancestral" em nenhum lugar — código, comentário, exemplo, mock, teste. Se aparecer em texto vindo de fora (tabela do usuário, docx importado), fazer replace automático `Evolução → Despertar`, `Forma Ancestral → Despertar Ancestral` no ato do import.
- Não escrever changelog manualmente pelo lado do agente/frontend. Sempre `recordChange(tx, ...)` dentro da transação do write.
- Não devolver o objeto criado inteiro em `POST` — só `{code, version}`. O agente já enviou; devolver duplica tokens.
- Não usar shadcn/ui. Componentes trazem radius e paleta que brigam com a direção visual — mais retrabalho refinar do que HTML nativo + Tailwind.
- Não instalar Alembic, Prisma, tRPC, GraphQL, MinIO, Redis, Docker Compose. Se propuser algo que puxe uma dessas, questionar antes.
- Não commitar arquivos de `./fontes/` (xlsx/docx). Cada dev traz sua cópia — `.gitignore` cobre.
- Não commitar `.env`. Só `.env.example` vai para o repo.

## Onde procurar informação

- **README.md** — como clonar e rodar
- **`packages/db/src/schema/`** — modelo de dados (15 tabelas + junctions + enums)
- **`apps/api/src/shared/services/`** — as decisões arquiteturais principais (terminology, changelog, crudFactory, crudRoutes, fkResolver, query)
- **`apps/api/src/modules/elements/`** — módulo de referência para o padrão sem FK
- **`apps/api/src/modules/creatures/`** — módulo de referência para o padrão com múltiplas FKs
- **`apps/api/src/modules/drops/`** — padrão upsert para junctions
- **`packages/db/src/seed/content/paleozoic-batch-1.ts`** — como popular lotes curados de conteúdo
- **`apps/web/src/routes/CreatureDetail.tsx`** — a única tela com peso visual; referência da direção editorial
- **`apps/web/src/lib/labels.ts`** — todas as traduções enum → português
- **`fontes/README.md`** — o que vai na pasta ignorada
