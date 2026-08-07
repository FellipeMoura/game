/**
 * Build-time export: turns the bestiary into a single JSON bundle the Godot
 * project reads at startup.
 *
 *   pnpm game:export                        # from the local API
 *   pnpm game:export --from https://...     # from prod
 *   pnpm game:export --out ../my-godot-repo # override destination
 *
 * Why build-time and not a runtime API call: the game must open offline, and
 * a build has to be reproducible. The bundle carries a `dataVersion` taken
 * from the changelog, so any build can be traced back to the exact state of
 * the catalog it was cut from.
 *
 * Numeric database ids never cross this boundary. Everything is addressed by
 * the same stable codes agents use (`CRT-001`, `ELE-002`), so the bundle is
 * diffable in a pull request and survives a database rebuild.
 *
 * The export FAILS on incomplete data rather than shipping it. A creature
 * without stats would be a creature the battle system divides by zero on.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FROM = arg("from", process.env.EXPORT_API_URL ?? "http://localhost:5101");
/**
 * Default destination is a sibling checkout — the Godot project is its own
 * git repo, per the rule that this repository is not the game.
 */
const OUT_REPO = resolve(REPO_ROOT, arg("out", process.env.GODOT_REPO ?? "../godot"));
const OUT_FILE = resolve(OUT_REPO, "data/bestiary.json");

/**
 * Reshapes the flat `combat_rules` row into the nested block the game reads.
 *
 * The nesting exists for the consumer's sake — `rules.damage.constant` is
 * what the GDScript reads — while the table stays flat so each constant is a
 * typed, range-checked column. This function is the only place the two
 * shapes meet.
 */
function shapeRules(row) {
  return {
    damage: {
      constant: row.damageConstant,
      varianceMin: row.damageVarianceMin,
      varianceMax: row.damageVarianceMax,
      minimum: row.damageMinimum,
    },
    charge: {
      max: row.chargeMax,
      takenMultiplier: row.chargeTakenMultiplier,
      dealtMultiplier: row.chargeDealtMultiplier,
      neutralCharge: row.chargeNeutralCharge,
    },
    capture: {
      minChance: row.captureMinChance,
      maxChance: row.captureMaxChance,
    },
    levels: { min: row.levelMin, max: row.levelMax },
    elementNeutralMultiplier: row.elementNeutralMultiplier,
  };
}

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

async function get(path) {
  const url = `${FROM}/api/v1${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

const LIMIT = "limit=500";

console.log(`source:      ${FROM}`);

const [
  elements,
  advantages,
  classes,
  creatures,
  awakenings,
  abilities,
  abilityStats,
  creatureStats,
  captureRules,
  creatureAbilities,
  maps,
  biomes,
  changelog,
  combatRules,
] = await Promise.all([
  get(`/elements?${LIMIT}`),
  get(`/elemental-advantages?${LIMIT}`),
  get(`/creature-classes?${LIMIT}`),
  get(`/creatures?${LIMIT}`),
  get(`/awakenings?${LIMIT}`),
  get(`/abilities?${LIMIT}`),
  get(`/ability-stats?${LIMIT}`),
  get(`/creature-stats?${LIMIT}`),
  get(`/capture-rules?${LIMIT}`),
  get(`/creature-abilities?${LIMIT}`),
  get(`/maps?${LIMIT}`),
  get(`/biomes?${LIMIT}`),
  get(`/changelog?limit=1`),
  get(`/combat-rules`),
]);

// ---------------------------------------------------------------------------
// id → code lookups, so no numeric id reaches the bundle
// ---------------------------------------------------------------------------

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
const elementById = byId(elements);
const classById = byId(classes);
const creatureById = byId(creatures);
const abilityById = byId(abilities);
const mapById = byId(maps);
const biomeById = byId(biomes);

const code = (map, id) => (id == null ? null : (map.get(id)?.code ?? null));

const statsByCreature = byId([]);
for (const s of creatureStats) statsByCreature.set(s.creatureId, s);
const captureByCreature = new Map(captureRules.map((c) => [c.creatureId, c]));
const awakeningByCreature = new Map(awakenings.map((a) => [a.creatureId, a]));
const abilityStatByAbility = new Map(abilityStats.map((s) => [s.abilityId, s]));

const movesByCreature = new Map();
for (const link of creatureAbilities) {
  const list = movesByCreature.get(link.creatureId) ?? [];
  list.push(link);
  movesByCreature.set(link.creatureId, list);
}

// ---------------------------------------------------------------------------
// shaping + validation
// ---------------------------------------------------------------------------

const problems = [];

const outAbilities = abilities.map((a) => {
  const s = abilityStatByAbility.get(a.id);
  if (!s) problems.push(`ability ${a.code} (${a.name}) has no ability_stats row`);
  return {
    code: a.code,
    name: a.name,
    element: code(elementById, a.elementId),
    type: a.type,
    effect: a.effect,
    awakeningOnly: a.awakeningOnly,
    power: s?.power ?? 0,
    accuracy: s?.accuracy ?? 100,
    uses: s?.uses ?? 10,
    priority: s?.priority ?? 0,
    effectCode: s?.effectCode ?? "damage",
    effectValue: s?.effectValue ?? 0,
    targetSelf: s?.targetSelf ?? false,
  };
});

const outCreatures = creatures.map((c) => {
  const s = statsByCreature.get(c.id);
  const cap = captureByCreature.get(c.id);
  const awk = awakeningByCreature.get(c.id);
  const moves = (movesByCreature.get(c.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);

  if (!s) problems.push(`creature ${c.code} (${c.originalName}) has no creature_stats row`);
  if (!cap) problems.push(`creature ${c.code} (${c.originalName}) has no capture_rules row`);
  if (moves.length === 0) problems.push(`creature ${c.code} (${c.originalName}) knows no abilities`);

  return {
    code: c.code,
    name: c.originalName,
    baseSpecies: c.baseSpecies,
    class: code(classById, c.classId),
    element: code(elementById, c.elementId),
    map: code(mapById, c.mapId),
    biome: code(biomeById, c.biomeId),
    role: c.role,
    silhouetteNote: c.silhouetteNote,
    modelUrl: c.modelUrl,
    stats: s
      ? {
          hp: s.baseHp,
          attack: s.baseAttack,
          defense: s.baseDefense,
          speed: s.baseSpeed,
          charge: s.baseCharge,
          growthRate: s.growthRate,
          awakeningMultiplier: s.awakeningMultiplier,
          awakeningDurationTurns: s.awakeningDurationTurns,
        }
      : null,
    capture: cap ? { catchRate: cap.catchRate, awakenedMultiplier: cap.awakenedMultiplier } : null,
    abilities: moves.map((m) => ({
      code: code(abilityById, m.abilityId),
      learnLevel: m.learnLevel,
    })),
    awakening: awk
      ? {
          code: awk.code,
          name: awk.name,
          type: awk.type,
          referenceSpecies: awk.referenceSpecies,
        }
      : null,
  };
});

const bundle = {
  dataVersion: changelog[0]?.version ?? "0.00",
  generatedAt: new Date().toISOString(),
  source: FROM,
  rules: shapeRules(combatRules),
  elements: elements.map((e) => ({ code: e.code, name: e.name })),
  elementalAdvantages: advantages.map((a) => ({
    attacker: code(elementById, a.attackerElementId),
    defender: code(elementById, a.defenderElementId),
    multiplier: a.multiplier,
  })),
  classes: classes.map((c) => ({
    code: c.code,
    name: c.name,
    biologicalScope: c.biologicalScope,
  })),
  maps: maps.map((m) => ({ code: m.code, name: m.name, era: m.era, sortOrder: m.sortOrder })),
  biomes: biomes.map((b) => ({
    code: b.code,
    name: b.name,
    predominantElements: b.predominantElements,
  })),
  abilities: outAbilities,
  creatures: outCreatures,
};

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

if (problems.length > 0) {
  console.error(`\nexport aborted — ${problems.length} incomplete record(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nFix the data through the API, then re-run. Nothing was written.");
  process.exit(1);
}

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

const kb = (Buffer.byteLength(JSON.stringify(bundle)) / 1024).toFixed(1);
console.log(`dataVersion: ${bundle.dataVersion}`);
console.log(`written:     ${OUT_FILE} (${kb} KB)`);
console.log(
  `contents:    ${bundle.creatures.length} creatures, ${bundle.abilities.length} abilities, ` +
    `${bundle.elementalAdvantages.length} elemental pairs, ${bundle.classes.length} classes`,
);
