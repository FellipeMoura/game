import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "../openapi/zod";
import type { ZodTypeAny } from "zod";
import { requireApiKey } from "../middleware/apiKey";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import { registry } from "../openapi/registry";
import { rejectForbiddenTerms } from "./terminology";

interface CrudControllers {
  list: RequestHandler;
  getByCode: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  batchCreate: RequestHandler;
}

interface CrudSchemas {
  listQuery: ZodTypeAny;
  codeParams: ZodTypeAny;
  createBody: ZodTypeAny;
  updateBody: ZodTypeAny;
  batchCreateBody: ZodTypeAny;
  /** Shape of a single row in list/getByCode responses. */
  resource: ZodTypeAny;
  createdResponse: ZodTypeAny;
  updatedResponse: ZodTypeAny;
  batchCreatedResponse: ZodTypeAny;
}

interface CrudRoutesOptions {
  /** Base path relative to /api/v1, e.g. "/biomes". No trailing slash. */
  basePath: string;
  /** OpenAPI tag grouping for the endpoints. */
  tag: string;
  schemas: CrudSchemas;
  controllers: CrudControllers;
}

/**
 * Wires up the five standard CRUD endpoints (list, batch, getByCode, create,
 * update) with their OpenAPI registrations and middleware chain. Every write
 * gets `requireApiKey` + `rejectForbiddenTerms`. Modules with extra endpoints
 * or exotic middleware wire those manually AFTER calling this.
 */
export function registerCrudRoutes(opts: CrudRoutesOptions): Router {
  const { basePath, tag, schemas, controllers } = opts;
  const router = Router();

  registry.registerPath({
    method: "get",
    path: basePath,
    tags: [tag],
    summary: `List ${tag}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: { query: schemas.listQuery as any },
    responses: {
      200: { content: { "application/json": { schema: z.array(schemas.resource) } }, description: "OK" },
    },
  });
  router.get("/", validateQuery(schemas.listQuery), controllers.list);

  // /batch registered before /:code so express routes it as literal
  registry.registerPath({
    method: "post",
    path: `${basePath}/batch`,
    tags: [tag],
    security: [{ ApiKey: [] }],
    summary: `Batch create ${tag}`,
    request: {
      body: { content: { "application/json": { schema: schemas.batchCreateBody } }, required: true },
    },
    responses: {
      201: { content: { "application/json": { schema: schemas.batchCreatedResponse } }, description: "Created" },
    },
  });
  router.post(
    "/batch",
    requireApiKey,
    rejectForbiddenTerms,
    validateBody(schemas.batchCreateBody),
    controllers.batchCreate,
  );

  registry.registerPath({
    method: "get",
    path: `${basePath}/{code}`,
    tags: [tag],
    summary: "Get one by code",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: { params: schemas.codeParams as any },
    responses: {
      200: { content: { "application/json": { schema: schemas.resource } }, description: "The row" },
      404: { description: "Not found" },
    },
  });
  router.get("/:code", validateParams(schemas.codeParams), controllers.getByCode);

  registry.registerPath({
    method: "post",
    path: basePath,
    tags: [tag],
    security: [{ ApiKey: [] }],
    summary: `Create ${tag.replace(/s$/, "")}`,
    request: {
      body: { content: { "application/json": { schema: schemas.createBody } }, required: true },
    },
    responses: {
      201: { content: { "application/json": { schema: schemas.createdResponse } }, description: "Created" },
      409: { description: "Code already exists" },
      422: { description: "Validation failed or deprecated term" },
    },
  });
  router.post(
    "/",
    requireApiKey,
    rejectForbiddenTerms,
    validateBody(schemas.createBody),
    controllers.create,
  );

  registry.registerPath({
    method: "patch",
    path: `${basePath}/{code}`,
    tags: [tag],
    security: [{ ApiKey: [] }],
    summary: `Update ${tag.replace(/s$/, "")}`,
    request: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: schemas.codeParams as any,
      body: { content: { "application/json": { schema: schemas.updateBody } }, required: true },
    },
    responses: {
      200: { content: { "application/json": { schema: schemas.updatedResponse } }, description: "Updated" },
      404: { description: "Not found" },
      422: { description: "Validation failed or deprecated term" },
    },
  });
  router.patch(
    "/:code",
    requireApiKey,
    rejectForbiddenTerms,
    validateParams(schemas.codeParams),
    validateBody(schemas.updateBody),
    controllers.update,
  );

  return router;
}
