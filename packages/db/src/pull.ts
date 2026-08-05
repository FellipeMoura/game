import "./loadEnv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Hydrates the local dev database with a snapshot of production.
 *
 * Two transports:
 *   - PULL_MODE=api (default) — paginated GETs against the public API. Zero
 *     setup, slower for big tables.
 *   - PULL_MODE=db — direct Postgres via PROD_DATABASE_URL, which requires
 *     an SSH tunnel since prod does not expose 5432 publicly. Faster.
 *
 * Both modes: preserve IDs so FKs stay 1:1 with prod, then reset sequences.
 *
 * Guarded: refuses NODE_ENV=production; in db-mode refuses if
 * PROD_DATABASE_URL equals DATABASE_URL.
 */

const localUrl = process.env.DATABASE_URL;
const prodApiBase = (process.env.PROD_API_URL || "https://bestiary.sysnode.com.br").replace(
  /\/+$/,
  "",
);
const prodDbUrl = process.env.PROD_DATABASE_URL;
const mode = (process.env.PULL_MODE || "api").toLowerCase();

if (!localUrl) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production") {
  throw new Error("db:pull is a dev tool — refusing to run with NODE_ENV=production");
}
if (mode !== "api" && mode !== "db") {
  throw new Error(`invalid PULL_MODE "${mode}" — expected "api" or "db"`);
}
if (mode === "db") {
  if (!prodDbUrl) throw new Error("PULL_MODE=db requires PROD_DATABASE_URL (set in .env)");
  if (prodDbUrl === localUrl) {
    throw new Error("PROD_DATABASE_URL must differ from DATABASE_URL — refusing to truncate prod");
  }
}

// Insert order: parents before children. TRUNCATE ... CASCADE ignores order.
const TABLES = [
  { name: "elements", endpoint: "elements" },
  { name: "creature_classes", endpoint: "creature-classes" },
  { name: "biomes", endpoint: "biomes" },
  { name: "game_maps", endpoint: "maps" },
  { name: "items", endpoint: "items" },
  { name: "design_documents", endpoint: "documents" },
  { name: "changelog", endpoint: "changelog" },
  { name: "elemental_advantages", endpoint: "elemental-advantages" },
  { name: "map_biomes", endpoint: "map-biomes" },
  { name: "npcs", endpoint: "npcs" },
  { name: "creatures", endpoint: "creatures" },
  { name: "abilities", endpoint: "abilities" },
  { name: "awakenings", endpoint: "awakenings" },
  { name: "missions", endpoint: "missions" },
  { name: "drops", endpoint: "drops" },
] as const;

type Row = Record<string, unknown>;

const dev = postgres(localUrl, { max: 2, connect_timeout: 5 });
const prodDb =
  mode === "db" ? postgres(prodDbUrl!, { max: 2, connect_timeout: 10, prepare: false }) : null;

try {
  console.log(`mode: ${mode}${mode === "api" ? ` (${prodApiBase})` : ""}`);

  if (prodDb) {
    try {
      await prodDb`SELECT 1`;
    } catch (err) {
      handleProdDbConnectError(err);
      await dev.end({ timeout: 1 }).catch(() => {});
      await prodDb.end({ timeout: 1 }).catch(() => {});
      process.exit(1);
    }
    await prodDb`SET default_transaction_read_only = on`;
  }

  console.log("ensuring dev schema is up to date...");
  const migrationClient = postgres(localUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();

  const prodVersion = await getProdVersion();
  const devVersion = await maxVersion(dev);
  console.log(`prod version: ${prodVersion ?? "(empty)"}`);
  console.log(`dev  version: ${devVersion ?? "(empty)"}`);

  if (prodVersion && prodVersion === devVersion && (await rowCountsMatch())) {
    console.log("dev database already up to date, nothing to do");
    process.exit(0);
  }

  console.log(`truncating ${TABLES.length} dev tables...`);
  await dev.unsafe(`TRUNCATE ${TABLES.map((t) => t.name).join(", ")} RESTART IDENTITY CASCADE`);

  for (const t of TABLES) {
    const rows = normalizeKeys(await fetchTable(t));
    if (rows.length === 0) {
      console.log(`  ${t.name.padEnd(24)} 0 rows`);
      continue;
    }
    const columns = Object.keys(rows[0]!);
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await dev`INSERT INTO ${dev(t.name)} ${dev(chunk as never, columns)}`;
    }
    if (columns.includes("id")) {
      await dev.unsafe(
        `SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${t.name}), 1))`,
      );
    }
    console.log(`  ${t.name.padEnd(24)} ${rows.length} rows`);
  }
  console.log("sync complete");
} finally {
  await dev.end();
  if (prodDb) await prodDb.end();
}

// --- helpers ---

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function normalizeKeys(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[toSnake(k)] = v;
    return out;
  });
}

async function fetchTable(t: { name: string; endpoint: string }): Promise<Row[]> {
  if (prodDb) {
    return prodDb.unsafe<Row[]>(`SELECT * FROM ${t.name} ORDER BY id`);
  }
  const PAGE = 500;
  const all: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${prodApiBase}/api/v1/${t.endpoint}?limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    const page = (await res.json()) as Row[];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}

async function getProdVersion(): Promise<string | null> {
  if (prodDb) return maxVersion(prodDb);
  try {
    const res = await fetch(`${prodApiBase}/api/v1/changelog?fields=version&limit=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string }[];
    return data?.[0]?.version ?? null;
  } catch {
    return null;
  }
}

async function maxVersion(client: postgres.Sql): Promise<string | null> {
  try {
    const rows = await client<{ version: string }[]>`
      SELECT version FROM changelog ORDER BY version DESC LIMIT 1
    `;
    return rows[0]?.version ?? null;
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return null;
    throw err;
  }
}

// In api mode we can't cheaply count remote rows, so we trust version equality.
async function rowCountsMatch(): Promise<boolean> {
  if (!prodDb) return true;
  for (const t of TABLES) {
    const [pc] = await prodDb.unsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM ${t.name}`);
    const [dc] = await dev.unsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM ${t.name}`);
    if (pc!.n !== dc!.n) return false;
  }
  return true;
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function handleProdDbConnectError(err: unknown): void {
  const code = (err as { code?: string })?.code ?? "";
  const parsed = tryParseUrl(prodDbUrl!);
  console.error(`\ncannot reach prod database via PROD_DATABASE_URL (${code || "unknown error"})`);
  if (parsed) {
    console.error(`  target: ${parsed.hostname}:${parsed.port}`);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      console.error(`\nyou copied the prod DATABASE_URL literally — prod's Postgres is bound to`);
      console.error(`localhost on the VPS, not on your machine. Either open a tunnel:`);
      console.error(`  ssh -L ${parsed.port}:localhost:${parsed.port} <user>@bestiary.sysnode.com.br`);
      console.error(`or drop PULL_MODE=db (default 'api' hits public endpoints, no tunnel).`);
    }
  }
}
