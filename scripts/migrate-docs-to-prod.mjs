const LOCAL = "http://localhost:5101/api/v1";
const PROD = "https://bestiary.sysnode.com.br/api/v1";
const API_KEY = process.env.PROD_API_KEY;
if (!API_KEY) {
  console.error("Set PROD_API_KEY before running.");
  process.exit(1);
}
const SKIP = new Set([
  "camera-e-perspectiva",
  "direcao-3d-arte",
  "movimento-e-controles",
  "escala-e-camera-de-batalha",
]);

const REASON = "Import: migração inicial do Design Bible do ambiente de dev";
const IMPACT = "Popula prod com os capítulos base já iterados em local";

// Per CLAUDE.md: on any import from outside sources, deprecated terminology is
// auto-rewritten to the official term. The docx seeder never enforced this, so
// three chapters (filosofia-do-projeto, despertar-ancestral, glossario) still
// carry the old terms in local. Applying the rewrite here keeps prod clean.
function sanitize(text) {
  const cased = (repl) => (m) =>
    m[0] === m[0].toUpperCase() ? repl : repl[0].toLowerCase() + repl.slice(1);
  return text
    .replace(/formas ancestrais/gi, cased("Despertares Ancestrais"))
    .replace(/forma ancestral/gi, cased("Despertar Ancestral"))
    .replace(/evolu[çc][aã]o/gi, cased("Despertar"));
}

// Optional CLI positional args → migrate only those slugs. Empty → migrate all
// (minus stubs already in prod). Lets us re-run just failures without touching
// what already succeeded.
const argSlugs = process.argv.slice(2);
const index = await fetch(`${LOCAL}/documents?fields=slug&limit=200`).then((r) => r.json());
const slugs = argSlugs.length > 0
  ? argSlugs
  : index.map((d) => d.slug).filter((s) => !SKIP.has(s));
console.log(`Migrating ${slugs.length} docs → ${PROD}`);

for (const slug of slugs) {
  const doc = await fetch(`${LOCAL}/documents/${slug}`).then((r) => r.json());
  const body = {
    slug: doc.slug,
    title: doc.title,
    sortOrder: doc.sortOrder,
    status: doc.status,
    bodyMarkdown: sanitize(doc.bodyMarkdown),
    reason: REASON,
    impact: IMPACT,
  };
  const res = await fetch(`${PROD}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(body),
  });
  const out = await res.text();
  console.log(`${res.status.toString().padEnd(3)} ${slug.padEnd(35)} ${out}`);
  await new Promise((r) => setTimeout(r, 250));
}
