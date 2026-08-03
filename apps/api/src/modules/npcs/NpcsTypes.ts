import { z } from "../../shared/openapi/zod";
import { changeMetadataSchema, paginationSchema } from "../../shared/services/query";

export const NpcSchema = z
  .object({
    id: z.number().int(),
    code: z.string().openapi({ example: "NPC-001" }),
    name: z.string(),
    faction: z.string().nullable(),
    mapId: z.number().int().nullable(),
    role: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Npc");

export const NPC_FIELDS = [
  "id", "code", "name", "faction", "mapId", "role", "notes", "createdAt", "updatedAt",
] as const;

export const ListNpcsQuerySchema = paginationSchema.extend({
  fields: z.string().optional(),
  mapCode: z.string().optional(),
  faction: z.string().optional(),
});
export const CodeParamsSchema = z.object({ code: z.string().openapi({ example: "NPC-001" }) });

const coreSchema = z.object({
  code: z.string().min(3).max(16),
  name: z.string().min(1).max(128),
  faction: z.string().max(64).nullish(),
  mapCode: z.string().nullish().openapi({ example: "PZ-01" }),
  role: z.string().max(64).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const CreateNpcBodySchema = coreSchema.merge(changeMetadataSchema).openapi("CreateNpcBody");
export const UpdateNpcBodySchema = coreSchema.partial().merge(changeMetadataSchema).openapi("UpdateNpcBody");
export const BatchCreateNpcsBodySchema = z.object({
  items: z.array(coreSchema).min(1).max(100),
  reason: changeMetadataSchema.shape.reason,
  impact: changeMetadataSchema.shape.impact,
}).openapi("BatchCreateNpcsBody");

export const CreatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("CreatedResponse");
export const UpdatedResponseSchema = z.object({ code: z.string(), version: z.string() }).openapi("UpdatedResponse");
export const BatchCreatedResponseSchema = z.object({ codes: z.array(z.string()), version: z.string() }).openapi("BatchCreatedResponse");

export type CreateNpcBody = z.infer<typeof CreateNpcBodySchema>;
export type UpdateNpcBody = z.infer<typeof UpdateNpcBodySchema>;
export type BatchCreateNpcsBody = z.infer<typeof BatchCreateNpcsBodySchema>;
