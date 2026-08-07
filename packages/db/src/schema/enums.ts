import { pgEnum } from "drizzle-orm/pg-core";

export const eraEnum = pgEnum("era", ["paleozoic", "mesozoic", "cenozoic"]);
export const awakeningTypeEnum = pgEnum("awakening_type", ["reinforcement", "swap"]);
export const documentStatusEnum = pgEnum("document_status", ["defined", "partial", "pending"]);

/**
 * Machine-readable effect of an ability. The battle system in Godot switches
 * on this — `abilities.effect` stays as prose for humans, this is what runs.
 * `damage` is the plain case: power + element multiplier, nothing else.
 */
export const abilityEffectEnum = pgEnum("ability_effect", [
  "damage",
  "buff_attack",
  "buff_defense",
  "debuff_attack",
  "debuff_defense",
  "heal",
  "charge_gain",
]);
