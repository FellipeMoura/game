import { boolean, check, integer, pgTable, real, serial, text, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatures } from "./creatures";
import { elements } from "./elements";
import { gameMaps } from "./gameMaps";
import { timestamps } from "./timestamps";

export const abilities = pgTable("abilities", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  elementId: integer("element_id").references(() => elements.id),
  type: text("type"),
  effect: text("effect"),
  awakeningOnly: boolean("awakening_only").notNull().default(false),
  notes: text("notes"),
  ...timestamps,
});

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category"),
  effect: text("effect"),
  acquisition: text("acquisition"),
  notes: text("notes"),
  ...timestamps,
});

export const npcs = pgTable("npcs", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  faction: text("faction"),
  mapId: integer("map_id").references(() => gameMaps.id),
  role: text("role"),
  notes: text("notes"),
  ...timestamps,
});

export const missions = pgTable("missions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type"),
  mapId: integer("map_id").references(() => gameMaps.id),
  npcId: integer("npc_id").references(() => npcs.id),
  requirement: text("requirement"),
  reward: text("reward"),
  status: text("status"),
  ...timestamps,
});

export const drops = pgTable(
  "drops",
  {
    id: serial("id").primaryKey(),
    creatureId: integer("creature_id")
      .notNull()
      .references(() => creatures.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    chance: real("chance").notNull(),
    condition: text("condition"),
    ...timestamps,
  },
  (t) => ({
    uniqueTuple: unique().on(t.creatureId, t.itemId, t.condition),
    chanceRange: check("drops_chance_range", sql`${t.chance} >= 0 AND ${t.chance} <= 1`),
  }),
);

export type Ability = typeof abilities.$inferSelect;
export type NewAbility = typeof abilities.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Npc = typeof npcs.$inferSelect;
export type NewNpc = typeof npcs.$inferInsert;
export type Mission = typeof missions.$inferSelect;
export type NewMission = typeof missions.$inferInsert;
export type Drop = typeof drops.$inferSelect;
export type NewDrop = typeof drops.$inferInsert;
