// Side-effect import: monkey-patches Express 4 to forward async handler
// rejections to `next(err)`. Without it, throws in async controllers hang
// the request until the client times out.
import "express-async-errors";
import cors from "cors";
import express from "express";
import { env, isProd } from "./env.js";
import { handleError } from "./shared/middleware/handleError.js";
import { buildOpenApiDocument } from "./shared/openapi/registry.js";
import { checkHealth } from "./shared/services/health.js";
import { abilitiesRouter } from "./modules/abilities/AbilitiesRoutes.js";
import { awakeningsRouter } from "./modules/awakenings/AwakeningsRoutes.js";
import { biomesRouter } from "./modules/biomes/BiomesRoutes.js";
import { changelogRouter } from "./modules/changelog/ChangelogRoutes.js";
import { contextRouter } from "./modules/context/ContextRoutes.js";
import { creatureClassesRouter } from "./modules/creatureClasses/CreatureClassesRoutes.js";
import { creaturesRouter } from "./modules/creatures/CreaturesRoutes.js";
import { designDocumentsRouter } from "./modules/designDocuments/DesignDocumentsRoutes.js";
import { dropsRouter } from "./modules/drops/DropsRoutes.js";
import { elementalAdvantagesRouter } from "./modules/elementalAdvantages/ElementalAdvantagesRoutes.js";
import { elementsRouter } from "./modules/elements/ElementsRoutes.js";
import { gameMapsRouter } from "./modules/gameMaps/GameMapsRoutes.js";
import { itemsRouter } from "./modules/items/ItemsRoutes.js";
import { mapBiomesRouter } from "./modules/mapBiomes/MapBiomesRoutes.js";
import { missionsRouter } from "./modules/missions/MissionsRoutes.js";
import { npcsRouter } from "./modules/npcs/NpcsRoutes.js";

/**
 * Resolve the CORS origin at boot. In dev, an empty CORS_ORIGIN means
 * "allow anything" (convenient for tsx/vite). In prod, an empty
 * CORS_ORIGIN blocks all cross-origin traffic — deliberate: forgetting to
 * set the env should fail closed, not open.
 */
function resolveCorsOrigin(): boolean | string[] {
  if (env.corsOrigin) {
    return env.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return isProd ? false : true;
}

export function createApp() {
  const app = express();
  app.disable("etag");
  // Trust the first proxy so express-rate-limit sees the real client IP
  // (Nginx sets X-Forwarded-For in front of us in prod).
  if (isProd) app.set("trust proxy", 1);
  app.use(cors({ origin: resolveCorsOrigin(), credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  // Liveness + DB probe. Public, no auth — deploy.sh polls this after reload.
  app.get("/health", async (_req, res) => {
    const h = await checkHealth();
    res.status(h.ok ? 200 : 503).json(h);
  });

  app.get("/", (_req, res) => {
    res.json({ app: "bestiary", docs: "/openapi.json", api: "/api/v1" });
  });

  // OpenAPI is generated dynamically from the registry — every module that
  // calls `registry.registerPath(...)` shows up automatically.
  app.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiDocument());
  });

  const v1 = express.Router();
  v1.use("/context", contextRouter);
  v1.use("/elements", elementsRouter);
  v1.use("/elemental-advantages", elementalAdvantagesRouter);
  v1.use("/creature-classes", creatureClassesRouter);
  v1.use("/creatures", creaturesRouter);
  v1.use("/awakenings", awakeningsRouter);
  v1.use("/maps", gameMapsRouter);
  v1.use("/biomes", biomesRouter);
  v1.use("/map-biomes", mapBiomesRouter);
  v1.use("/abilities", abilitiesRouter);
  v1.use("/items", itemsRouter);
  v1.use("/npcs", npcsRouter);
  v1.use("/missions", missionsRouter);
  v1.use("/drops", dropsRouter);
  v1.use("/documents", designDocumentsRouter);
  v1.use("/changelog", changelogRouter);
  app.use("/api/v1", v1);

  app.use(handleError);
  return app;
}
