import { boolean, check, integer, pgTable, real, serial, text, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { abilityEffectEnum } from "./enums";
import { abilities } from "./gameplay";
import { creatures } from "./creatures";
import { timestamps } from "./timestamps";

/**
 * The numbers layer. Everything the Godot build needs to actually *run* a
 * turn-based battle, kept separate from the editorial catalog so the
 * bestiary tables stay descriptive and these stay tunable.
 *
 * Four tables, matching the agreed scope:
 *   creature_stats   — 1:1 with creatures, base values + growth curve
 *   ability_stats    — 1:1 with abilities, the executable move numbers
 *   capture_rules    — 1:1 with creatures, capture difficulty
 *   creature_abilities — junction; which creature knows which move, at what level
 *
 * `elemental_advantages` (the fifth piece of the layer) already existed as a
 * table and only needed data.
 */

/**
 * Base values are the stat at level 1. The effective value at any level is
 *
 *     valor(nivel) = floor(base * (1 + growthRate * (nivel - 1)))
 *
 * A single `growthRate` scales every stat of the creature — one knob per
 * species instead of five. Typical range 0.02 (lento) to 0.05 (rapido);
 * at nivel 50 that spans base x1.98 to base x3.45.
 *
 * `baseCharge` feeds the Despertar Ancestral meter — see the
 * `carga-e-despertar` design document for the fill formula. It is a stat
 * like any other and scales with the same curve.
 */
export const creatureStats = pgTable(
  "creature_stats",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .unique()
      .references(() => creatures.id, { onDelete: "cascade" }),
    baseHp: integer("base_hp").notNull(),
    baseAttack: integer("base_attack").notNull(),
    baseDefense: integer("base_defense").notNull(),
    baseSpeed: integer("base_speed").notNull(),
    baseCharge: integer("base_charge").notNull(),
    growthRate: real("growth_rate").notNull().default(0.03),
    /** Multiplier applied to attack and defense while the Despertar is active. */
    awakeningMultiplier: real("awakening_multiplier").notNull().default(1.5),
    awakeningDurationTurns: integer("awakening_duration_turns").notNull().default(3),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    hpRange: check("creature_stats_hp_range", sql`${t.baseHp} > 0 AND ${t.baseHp} <= 999`),
    attackRange: check("creature_stats_attack_range", sql`${t.baseAttack} > 0 AND ${t.baseAttack} <= 999`),
    defenseRange: check("creature_stats_defense_range", sql`${t.baseDefense} > 0 AND ${t.baseDefense} <= 999`),
    speedRange: check("creature_stats_speed_range", sql`${t.baseSpeed} > 0 AND ${t.baseSpeed} <= 999`),
    chargeRange: check("creature_stats_charge_range", sql`${t.baseCharge} > 0 AND ${t.baseCharge} <= 999`),
    growthRange: check("creature_stats_growth_range", sql`${t.growthRate} > 0 AND ${t.growthRate} <= 0.2`),
    durationRange: check(
      "creature_stats_duration_range",
      sql`${t.awakeningDurationTurns} >= 1 AND ${t.awakeningDurationTurns} <= 10`,
    ),
  }),
);

/**
 * The executable half of an ability. `abilities.effect` stays as prose for
 * humans; these are the numbers the battle system reads.
 *
 * `power` 0 means the move deals no direct damage — it is a status move and
 * its work happens through `effectCode` / `effectValue`.
 */
export const abilityStats = pgTable(
  "ability_stats",
  {
    id: serial("id").primaryKey(),
    abilityId: integer("ability_id")
      .notNull()
      .unique()
      .references(() => abilities.id, { onDelete: "cascade" }),
    power: integer("power").notNull().default(0),
    accuracy: integer("accuracy").notNull().default(100),
    /** Times the move can be used per rest. PP by another name. */
    uses: integer("uses").notNull().default(15),
    /** Higher goes first regardless of speed. 0 is normal. */
    priority: integer("priority").notNull().default(0),
    effectCode: abilityEffectEnum("effect_code").notNull().default("damage"),
    /** Magnitude of the effect: percent for buffs/debuffs, flat for heal/charge. */
    effectValue: integer("effect_value").notNull().default(0),
    targetSelf: boolean("target_self").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    powerRange: check("ability_stats_power_range", sql`${t.power} >= 0 AND ${t.power} <= 250`),
    accuracyRange: check("ability_stats_accuracy_range", sql`${t.accuracy} >= 1 AND ${t.accuracy} <= 100`),
    usesRange: check("ability_stats_uses_range", sql`${t.uses} >= 1 AND ${t.uses} <= 40`),
    priorityRange: check("ability_stats_priority_range", sql`${t.priority} >= -3 AND ${t.priority} <= 3`),
  }),
);

/**
 * Capture difficulty, 1:1 with a creature. `catchRate` follows the familiar
 * 1–255 convention (higher = easier) so the numbers read intuitively to
 * anyone who has balanced a collection game.
 *
 * `awakenedMultiplier` answers the open question in the `captura` document:
 * yes, a wild creature in Despertar Ancestral is harder to capture. Below 1
 * makes it harder; the default halves the odds.
 */
export const captureRules = pgTable(
  "capture_rules",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .unique()
      .references(() => creatures.id, { onDelete: "cascade" }),
    catchRate: integer("catch_rate").notNull(),
    awakenedMultiplier: real("awakened_multiplier").notNull().default(0.5),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    catchRange: check("capture_rules_catch_range", sql`${t.catchRate} >= 1 AND ${t.catchRate} <= 255`),
    awakenedRange: check(
      "capture_rules_awakened_range",
      sql`${t.awakenedMultiplier} > 0 AND ${t.awakenedMultiplier} <= 2`,
    ),
  }),
);

/**
 * Which moves a creature knows. Upsert semantics on (creature, ability),
 * matching the `drops` / `map_biomes` junction pattern already in the repo.
 *
 * `learnLevel` 1 means the creature starts with it.
 */
export const creatureAbilities = pgTable(
  "creature_abilities",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .references(() => creatures.id, { onDelete: "cascade" }),
    abilityId: integer("ability_id")
      .notNull()
      .references(() => abilities.id, { onDelete: "cascade" }),
    learnLevel: integer("learn_level").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    uniquePair: unique().on(t.creatureId, t.abilityId),
    levelRange: check("creature_abilities_level_range", sql`${t.learnLevel} >= 1 AND ${t.learnLevel} <= 100`),
  }),
);

export type CreatureStat = typeof creatureStats.$inferSelect;
export type NewCreatureStat = typeof creatureStats.$inferInsert;
export type AbilityStat = typeof abilityStats.$inferSelect;
export type NewAbilityStat = typeof abilityStats.$inferInsert;
export type CaptureRule = typeof captureRules.$inferSelect;
export type NewCaptureRule = typeof captureRules.$inferInsert;
export type CreatureAbility = typeof creatureAbilities.$inferSelect;
export type NewCreatureAbility = typeof creatureAbilities.$inferInsert;
