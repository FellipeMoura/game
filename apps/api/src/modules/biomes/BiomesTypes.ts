import { z } from "../../shared/openapi/zod";
import { changeMetadataSchema, paginationSchema } from "../../shared/services/query";

export const BiomeSchema = z
  .object({
    id: z.number().int(),
    code: z.string().openapi({ example: "BIO-001" }),
    name: z.string(),
    predominantElements: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Biome");

export const BIOME_FIELDS = [
  "id", "code", "name", "predominantElements", "notes", "createdAt", "updatedAt",
] as const;

export const ListBiomesQuerySchema = paginationSchema.extend({ fields: z.string().optional() });
export const CodeParamsSchema = z.object({ code: z.string().openapi({ example: "BIO-001" }) });

const coreSchema = z.object({
  code: z.string().min(3).max(16),
  name: z.string().min(1).max(64),
  predominantElements: z.string().max(500).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const CreateBiomeBodySchema = coreSchema.merge(changeMetadataSchema).openapi("CreateBiomeBody");
export const UpdateBiomeBodySchema = coreSchema.partial().merge(changeMetadataSchema).openapi("UpdateBiomeBody");
export const BatchCreateBiomesBodySchema = z.object({
  items: z.array(coreSchema).min(1).max(100),
  reason: changeMetadataSchema.shape.reason,
  impact: changeMetadataSchema.shape.impact,
}).openapi("BatchCreateBiomesBody");

export const CreatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("CreatedResponse");
export const UpdatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("UpdatedResponse");
export const BatchCreatedResponseSchema = z.object({ codes: z.array(z.string()), version: z.string() }).openapi("BatchCreatedResponse");

export type CreateBiomeBody = z.infer<typeof CreateBiomeBodySchema>;
export type UpdateBiomeBody = z.infer<typeof UpdateBiomeBodySchema>;
export type BatchCreateBiomesBody = z.infer<typeof BatchCreateBiomesBodySchema>;
