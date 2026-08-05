import "./loadEnv";
import postgres from "postgres";

/**
 * Pre-dev nudge: compares local changelog version against prod's public API
 * and prints a one-liner if dev is behind. Never fails startup — any error
 * (offline, unmigrated DB, unreachable API) exits silently with 0.
 */

const PROD_API = process.env.PROD_API_URL || "https://bestiary.sysnode.com.br";
const FETCH_TIMEOUT_MS = 3000;
const HARD_TIMEOUT_MS = 5000;

setTimeout(() => process.exit(0), HARD_TIMEOUT_MS).unref();

async function main(): Promise<void> {
  const localUrl = process.env.DATABASE_URL;
  if (!localUrl) return;

  const [prodVersion, devVersion] = await Promise.all([
    fetchProdVersion(),
    fetchDevVersion(localUrl),
  ]);

  if (prodVersion == null) return;
  if (devVersion == null) {
    console.log("[bestiary] dev DB not initialized — run `pnpm db:reset` (or `pnpm db:pull`)");
    return;
  }

  const prodNum = parseFloat(prodVersion);
  const devNum = parseFloat(devVersion);
  if (Number.isFinite(prodNum) && Number.isFinite(devNum) && devNum >= prodNum) return;

  console.log(
    `[bestiary] dev DB is behind prod: dev ${devVersion}, prod ${prodVersion} — run \`pnpm db:pull\` to sync`,
  );
}

async function fetchProdVersion(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${PROD_API}/api/v1/changelog?fields=version&limit=1`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string }[];
    return data?.[0]?.version ?? null;
  } catch {
    return null;
  }
}

async function fetchDevVersion(url: string): Promise<string | null> {
  const sql = postgres(url, { max: 1, connect_timeout: 2 });
  try {
    const rows = await sql<{ version: string }[]>`
      SELECT version FROM changelog ORDER BY version DESC LIMIT 1
    `;
    return rows[0]?.version ?? null;
  } catch {
    return null;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

main().catch(() => {
  /* silent — never block dev */
});
