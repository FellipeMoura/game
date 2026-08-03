import { pgEnum } from "drizzle-orm/pg-core";

export const eraEnum = pgEnum("era", ["paleozoic", "mesozoic", "cenozoic"]);
export const awakeningTypeEnum = pgEnum("awakening_type", ["reinforcement", "swap"]);
export const documentStatusEnum = pgEnum("document_status", ["defined", "partial", "pending"]);
