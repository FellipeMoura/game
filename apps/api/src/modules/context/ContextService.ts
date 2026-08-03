import { asc, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@bestiary/db";
import { OFFICIAL_TERM } from "../../shared/services/terminology";

/**
 * Builds a compact markdown summary of the project state. Meant to be the
 * first read of any writing agent's session — cheaper than pulling four
 * separate lists.
 */
export async function buildContextMarkdown(): Promise<string> {
  const [classes, elements, creaturesByEra, recentChanges, docCounts] = await Promise.all([
    db
      .select({ code: schema.creatureClasses.code, name: schema.creatureClasses.name, status: schema.creatureClasses.status })
      .from(schema.creatureClasses)
      .orderBy(asc(schema.creatureClasses.code)),
    db
      .select({ code: schema.elements.code, name: schema.elements.name })
      .from(schema.elements)
      .orderBy(asc(schema.elements.code)),
    db
      .select({
        era: schema.gameMaps.era,
        creatureCount: count(schema.creatures.id),
      })
      .from(schema.gameMaps)
      .leftJoin(schema.creatures, eq(schema.creatures.mapId, schema.gameMaps.id))
      .groupBy(schema.gameMaps.era),
    db
      .select({
        version: schema.changelog.version,
        date: schema.changelog.date,
        change: schema.changelog.change,
        reason: schema.changelog.reason,
      })
      .from(schema.changelog)
      .orderBy(desc(schema.changelog.date), desc(schema.changelog.id))
      .limit(5),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(schema.designDocuments),
  ]);

  const lines: string[] = [];
  lines.push("# Bestiary — current context");
  lines.push("");
  lines.push("## Terminology");
  lines.push(`- Official term: **${OFFICIAL_TERM}** (temporary transformation, returns to base form).`);
  lines.push('- Deprecated (rejected with 422): **"Evolução"**, **"Forma Ancestral"**.');
  lines.push("");

  lines.push("## Elements");
  for (const e of elements) lines.push(`- ${e.code} — ${e.name}`);
  lines.push("");

  lines.push("## Creature classes");
  lines.push("_(Classes do NOT influence combat — Changelog 0.01)_");
  for (const c of classes) {
    const status = c.status ? ` [${c.status}]` : "";
    lines.push(`- ${c.code} — ${c.name}${status}`);
  }
  lines.push("");

  lines.push("## Creatures per era");
  const eraOrder = ["paleozoic", "mesozoic", "cenozoic"] as const;
  const eraCounts = new Map(creaturesByEra.map((r) => [r.era, r.creatureCount]));
  for (const era of eraOrder) lines.push(`- ${era}: ${eraCounts.get(era) ?? 0}`);
  lines.push("");

  lines.push(`## Documents`);
  lines.push(`- Total: ${docCounts[0]?.n ?? 0}`);
  lines.push("");

  lines.push("## Last 5 changelog entries");
  for (const c of recentChanges) {
    const dateStr = c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date);
    lines.push(`- **${c.version}** (${dateStr}) — ${c.change}. _${c.reason}_`);
  }

  return lines.join("\n");
}
