import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reconcile creature modelUrls in prod with the .glb files that live in
 * apps/web/public/models. For each CRT-XXX with local files, pick the
 * highest .vN, verify prod serves it (HEAD 200), and PATCH the record if
 * the URL differs. No-op when already synced.
 *
 * Safe to run after any deploy that adds/replaces model files. Loads env
 * via Node's --env-file flag — run with `pnpm publish:models`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const PROD = "https://bestiary.sysnode.com.br";
const API = `${PROD}/api/v1`;
const MODELS_DIR = resolve(repoRoot, "apps/web/public/models");
const KEY = process.env.PROD_API_KEY;

if (!KEY) {
  console.error("PROD_API_KEY missing. Set it in .env.");
  process.exit(1);
}

// CRT-001.v2.glb → { code: "CRT-001", version: 2 }
const RE = /^(CRT-\d+)\.v(\d+)\.glb$/;

const byCode = new Map();
for (const name of readdirSync(MODELS_DIR)) {
  const m = RE.exec(name);
  if (!m) continue;
  const [, code, vStr] = m;
  const v = Number(vStr);
  const prev = byCode.get(code);
  if (!prev || v > prev.version) byCode.set(code, { version: v, file: name });
}

if (byCode.size === 0) {
  console.log("no local .glb files matched CRT-XXX.vN.glb — nothing to do");
  process.exit(0);
}

console.log(`found ${byCode.size} creature model(s) locally`);

let patched = 0;
let skipped = 0;
let missing = 0;
let failed = 0;

for (const [code, { file }] of [...byCode].sort()) {
  const targetUrl = `/models/${file}`;

  const head = await fetch(`${PROD}${targetUrl}`, { method: "HEAD" });
  if (!head.ok) {
    console.log(`  ${code.padEnd(8)} SKIP  ${file} not on prod (HTTP ${head.status}) — deploy first`);
    missing += 1;
    continue;
  }

  const current = await fetch(`${API}/creatures/${code}?fields=code,modelUrl`).then((r) =>
    r.ok ? r.json() : null,
  );
  if (!current) {
    console.log(`  ${code.padEnd(8)} SKIP  creature not found on prod`);
    missing += 1;
    continue;
  }
  if (current.modelUrl === targetUrl) {
    console.log(`  ${code.padEnd(8)} OK    ${targetUrl} (already set)`);
    skipped += 1;
    continue;
  }

  const bump = current.modelUrl ? `atualizado (${current.modelUrl} → ${targetUrl})` : "publicado";
  const body = {
    modelUrl: targetUrl,
    reason: `Modelo 3D ${bump}. Arte aprovada e servida via /models/.`,
    impact: `Ficha de ${code} e listagens do bestiário passam a exibir o novo modelo no viewer.`,
  };

  const res = await fetch(`${API}/creatures/${code}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify(body),
  });
  const out = await res.text();
  if (res.ok) {
    console.log(`  ${code.padEnd(8)} PATCH ${targetUrl} — ${out}`);
    patched += 1;
  } else {
    console.log(`  ${code.padEnd(8)} FAIL  HTTP ${res.status} — ${out}`);
    failed += 1;
  }
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`\ndone: ${patched} patched, ${skipped} up-to-date, ${missing} missing, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
