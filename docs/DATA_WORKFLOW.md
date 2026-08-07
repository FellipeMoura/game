# Como inserir e corrigir dados

Guia operacional. Vale para agente e para humano.

## O princípio

**A API é a única via de escrita.** Não existe formulário no frontend, e o `seed/` está congelado desde o primeiro deploy. Toda mudança carrega `reason` e `impact`, e o servidor grava a entrada de changelog e atribui a versão na mesma transação. O changelog é o registro — não um arquivo, não um commit.

**Escreva direto em produção.** Prod é a fonte de verdade. Para trabalhar local, hidrate com `pnpm db:pull` depois. Escrever local e promover depois foi um contorno pontual de quando os endpoints ainda não existiam em prod; não repita — é assim que dois bancos divergem.

```
escrever  →  prod, via API
ler local →  pnpm db:pull
jogo      →  pnpm game:export --from https://bestiary.sysnode.com.br
```

## Antes de qualquer escrita

```powershell
curl.exe -s https://bestiary.sysnode.com.br/api/v1/context
```

Devolve, em markdown compacto: terminologia travada, códigos de referência, invariantes de domínio, a camada de números, o índice de endpoints e as últimas versões. É a leitura mais barata que existe e evita a maioria dos 422.

> **Cuidado no PowerShell:** `curl` é alias de `Invoke-WebRequest` e não aceita as flags do curl real. Use `curl.exe` com o `.exe`, ou `Invoke-RestMethod`.

## Preparo

```powershell
$api = "https://bestiary.sysnode.com.br/api/v1"
$h   = @{ "X-API-Key" = "<chave>"; "Content-Type" = "application/json" }
```

Leitura é aberta; só escrita exige a chave.

## Adicionar uma criatura

Cinco passos, nesta ordem. Os quatro primeiros são obrigatórios — **o export para o jogo aborta** se uma criatura estiver sem stats, sem regra de captura ou sem golpes.

### 1. A criatura

```powershell
$body = @{
  code           = "CRT-028"
  originalName   = "Estemmenosuchus"
  baseSpecies    = "Estemmenosuchus"
  classCode      = "CLS-002"      # Theria
  elementCode    = "ELE-004"      # Terra
  mapCode        = "PZ-01"
  biomeCode      = $null
  role           = "hero"
  silhouetteNote = "Protuberancias osseas no cranio em forma de leque; corpo macico quadrupede."
  status         = "Rascunho"
  reason         = "Preencher lacuna de Theria pesado no fim do PZ-01"
  impact         = "Habilita encontro de chefe no bioma vulcanico"
} | ConvertTo-Json

Invoke-RestMethod "$api/creatures" -Method Post -Headers $h -Body $body
# → { "code": "CRT-028", "version": "0.91" }
```

Chaves estrangeiras vão **por código**, nunca por id. Código desconhecido responde 422 listando os válidos.

### 2. Os stats

```powershell
$body = @{
  creatureCode = "CRT-028"
  baseHp = 90; baseAttack = 60; baseDefense = 75; baseSpeed = 30; baseCharge = 45
  growthRate = 0.034
  reason = "Stats de chefe defensivo do fim do mapa"
  impact = "Encontro exige time com vantagem elemental, nao forca bruta"
} | ConvertTo-Json

Invoke-RestMethod "$api/creature-stats" -Method Post -Headers $h -Body $body
```

Referências para calibrar: o mais frágil do elenco tem HP 40, o mais resistente 100. Ataque vai de 30 a 85. `baseCharge` **50 é o neutro** — acima enche o Despertar mais rápido. `growthRate` fica entre 0.029 e 0.037.

### 3. A regra de captura

```powershell
$body = @{
  creatureCode = "CRT-028"
  catchRate = 65
  awakenedMultiplier = 0.35
  reason = "Chefe deve ser dificil de capturar"
  impact = "Exige enfraquecer antes; captura em Despertar fica quase inviavel"
} | ConvertTo-Json

Invoke-RestMethod "$api/capture-rules" -Method Post -Headers $h -Body $body
```

`catchRate` de 1 a 255, maior é mais fácil. Iniciais ficam perto de 200, chefes entre 50 e 70.

### 4. Os golpes

Seis por criatura é o padrão do elenco: três do elemento, um utilitário, `Concentrar` e a assinatura do Despertar.

```powershell
$body = @{
  items = @(
    @{ creatureCode="CRT-028"; abilityCode="HAB-010"; learnLevel=1;  sortOrder=0 }  # Seixo
    @{ creatureCode="CRT-028"; abilityCode="HAB-019"; learnLevel=8;  sortOrder=1 }  # Encouracar
    @{ creatureCode="CRT-028"; abilityCode="HAB-011"; learnLevel=12; sortOrder=2 }  # Fenda
    @{ creatureCode="CRT-028"; abilityCode="HAB-025"; learnLevel=20; sortOrder=3 }  # Concentrar
    @{ creatureCode="CRT-028"; abilityCode="HAB-012"; learnLevel=28; sortOrder=4 }  # Soterrar
    @{ creatureCode="CRT-028"; abilityCode="HAB-029"; learnLevel=1;  sortOrder=5 }  # Colapso Ancestral
  )
  reason = "Repertorio padrao de Terra com utilitario defensivo"
  impact = "CRT-028 fica jogavel do nivel 1 ao 28"
} | ConvertTo-Json -Depth 4

Invoke-RestMethod "$api/creature-abilities/batch" -Method Post -Headers $h -Body $body
```

A assinatura do Despertar fica em `learnLevel` 1 — ela é travada pela transformação estar ativa, não pelo nível.

### 5. O Despertar (opcional, mas mire no 1:1)

```powershell
$body = @{
  code = "DSP-028"
  creatureCode = "CRT-028"
  name = "Estemmenosuchus Coroado"
  type = "reinforcement"        # ou "swap"
  referenceSpecies = $null      # preencher quando for "swap"
  notes = "As protuberancias crescem em coroa ossea continua."
  reason = "Manter cobertura 1:1 de Despertar no bestiario"
  impact = "Elenco segue dentro da regra 70/30 entre reforco e troca"
} | ConvertTo-Json

Invoke-RestMethod "$api/awakenings" -Method Post -Headers $h -Body $body
```

**Vigie a proporção 70/30.** Hoje: 18 reforço / 8 troca (69% / 31%). Uma criatura já com Despertar responde 409 — é 1:1.

O `awakeningMultiplier` em `creature_stats` deve acompanhar o tipo: **1.5** para reforço, **1.7** para troca.

## Adicionar uma habilidade

Dois passos: a habilidade e os números dela.

```powershell
$body = @{
  code = "HAB-032"; name = "Avalanche"; elementCode = "ELE-006"
  type = "Ataque"; effect = "Dano elemental pesado com precisao reduzida."
  awakeningOnly = $false
  reason = "Gelo so tinha tres golpes"; impact = "Amplia o repertorio de Gelo"
} | ConvertTo-Json
Invoke-RestMethod "$api/abilities" -Method Post -Headers $h -Body $body

$body = @{
  abilityCode = "HAB-032"; power = 100; accuracy = 80; uses = 6
  effectCode = "damage"
  reason = "Alto risco, alta recompensa"; impact = "Alternativa a Nevasca"
} | ConvertTo-Json
Invoke-RestMethod "$api/ability-stats" -Method Post -Headers $h -Body $body
```

`effectCode` válidos: `damage`, `buff_attack`, `buff_defense`, `debuff_attack`, `debuff_defense`, `heal`, `charge_gain`. Com `power` 0 a habilidade não causa dano — é movimento de status e trabalha pelo `effectCode`.

## Balancear o combate

As constantes que governam dano, carga e captura ficam em `combat_rules`, um recurso singleton. Sem código, sem lista, sem POST — só `GET` e `PATCH`.

```powershell
Invoke-RestMethod "$api/combat-rules"     # leitura aberta
```

```powershell
$body = @{
  damageConstant = 0.22
  chargeTakenMultiplier = 3.0
  chargeDealtMultiplier = 1.5
  reason = "lutas duravam 3,6 rodadas, curto demais para troca e buff importarem"
  impact = "alonga para ~5 rodadas e mantem o Despertar como virada de jogo"
} | ConvertTo-Json

Invoke-RestMethod "$api/combat-rules" -Method Patch -Headers $h -Body $body
```

Manda só o que muda. Cada campo tem faixa validada, e os pares ordenados (`damageVarianceMin`/`Max`, `captureMinChance`/`Max`, `levelMin`/`Max`) são checados contra o estado atual — o erro nomeia os dois valores em vez de estourar como violação de constraint.

**Meça antes de gravar.** A sonda do repo do jogo simula 2.600 batalhas e aceita os valores como argumento:

```powershell
cd ..\avyron
& $godot --headless --script res://scripts/dev/balance_probe.gd -- 0.22 3 3.0
```

## Corrigir

Depende da tabela.

**Catálogo** (criaturas, habilidades, itens, mapas, documentos) — `PATCH`, só os campos que mudam:

```powershell
$body = @{ role = "regular"; reason = "..."; impact = "..." } | ConvertTo-Json
Invoke-RestMethod "$api/creatures/CRT-028" -Method Patch -Headers $h -Body $body
```

**`combat-rules`** — singleton, usa `PATCH` (ver acima).

**Camada de números e junções** (`creature-stats`, `ability-stats`, `capture-rules`, `creature-abilities`, `drops`, `map-biomes`, `elemental-advantages`) — **não têm PATCH**. Re-POST com os valores novos; o upsert sobrescreve. Você pode mandar só o campo que mudou:

```powershell
$body = @{ creatureCode="CRT-028"; baseAttack=55; reason="..."; impact="..." } | ConvertTo-Json
Invoke-RestMethod "$api/creature-stats" -Method Post -Headers $h -Body $body
```

## Tirar do escopo

```powershell
$body = @{ reason="..."; impact="..." } | ConvertTo-Json
Invoke-RestMethod "$api/creatures/CRT-028" -Method Delete -Headers $h -Body $body
```

Despertar, stats, regra de captura, vínculos de habilidade e drops caem em cascata. A entrada de changelog sobrevive à remoção — `changelog.entityId` não é chave estrangeira de propósito.

## Depois de escrever

```powershell
cd ..\game
pnpm db:pull                                                    # atualiza o local
pnpm game:export --from https://bestiary.sysnode.com.br --out ..\avyron
cd ..\avyron; git add data/bestiary.json; git commit -m "..."   # bundle versionado
```

O export **aborta sem escrever nada** e lista o que falta se alguma criatura estiver incompleta. Se ele reclamar, o dado está errado — não o script.

## Erros comuns

| Código | Significa | O que fazer |
|---|---|---|
| 401 | falta ou está errado o `X-API-Key` | leitura é aberta, escrita não |
| 409 | `code` duplicado, ou a criatura já tem Despertar | escolha outro código, ou use PATCH |
| 422 | terminologia descontinuada em algum campo | a mensagem aponta o campo; o termo oficial é **Despertar Ancestral** |
| 422 | código de FK inexistente | a mensagem lista os válidos |
| 422 | `?fields=` com coluna desconhecida | a mensagem lista as colunas |

Toda mensagem nomeia o campo e os valores aceitos — leia antes de tentar de novo.

## O que nunca fazer

- **Não adicionar conteúdo em `packages/db/src/seed/`.** Está congelado. Conteúdo lá não gera changelog nem versão, e o `upsertClass` chega a sobrescrever nomes em silêncio na próxima execução.
- **Não editar `data/bestiary.json` à mão** no repo do jogo. É gerado; a próxima exportação sobrescreve.
- **Não escrever no banco por SQL direto.** Pula o changelog, o validador de terminologia e a atribuição de versão.
- **Não criar criatura fora de Loricati, Theria ou Draconis.** Escopo fechado.
- **Não escolher a versão.** O servidor atribui. Mandar `version` no body não faz nada.
- **Não citar os termos descontinuados em documento**, nem para explicar que estão descontinuados — foi assim que o documento `despertar-ancestral` se corrompeu. A lista vive em `terminology.ts`.
