import { z } from "../../shared/openapi/zod";
import { changeMetadataSchema, paginationSchema } from "../../shared/services/query";

export const ItemSchema = z
  .object({
    id: z.number().int(),
    code: z.string().openapi({ example: "ITM-001" }),
    name: z.string(),
    category: z.string().nullable(),
    effect: z.string().nullable(),
    acquisition: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Item");

export const ITEM_FIELDS = [
  "id", "code", "name", "category", "effect", "acquisition", "notes", "createdAt", "updatedAt",
] as const;

export const ListItemsQuerySchema = paginationSchema.extend({
  fields: z.string().optional(),
  category: z.string().optional(),
});
export const CodeParamsSchema = z.object({ code: z.string().openapi({ example: "ITM-001" }) });

const coreSchema = z.object({
  code: z.string().min(3).max(16),
  name: z.string().min(1).max(128),
  category: z.string().max(64).nullish(),
  effect: z.string().max(2000).nullish(),
  acquisition: z.string().max(500).nullish(),
  notes: z.string().max(2000).nullish(),
});

// `code` optional on single-create — factory auto-generates `ITM-NNN`.
export const CreateItemBodySchema = coreSchema
  .extend({ code: coreSchema.shape.code.optional() })
  .merge(changeMetadataSchema)
  .openapi("CreateItemBody");
export const UpdateItemBodySchema = coreSchema.partial().merge(changeMetadataSchema).openapi("UpdateItemBody");
export const BatchCreateItemsBodySchema = z.object({
  items: z.array(coreSchema).min(1).max(100),
  reason: changeMetadataSchema.shape.reason,
  impact: changeMetadataSchema.shape.impact,
}).openapi("BatchCreateItemsBody");

export const CreatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("CreatedResponse");
export const UpdatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("UpdatedResponse");
export const BatchCreatedResponseSchema = z.object({ codes: z.array(z.string()), version: z.string() }).openapi("BatchCreatedResponse");
export const DeleteItemBodySchema = changeMetadataSchema.openapi("DeleteItemBody");

export type CreateItemBody = z.infer<typeof CreateItemBodySchema>;
export type UpdateItemBody = z.infer<typeof UpdateItemBodySchema>;
export type BatchCreateItemsBody = z.infer<typeof BatchCreateItemsBodySchema>;
export type DeleteItemBody = z.infer<typeof DeleteItemBodySchema>;
