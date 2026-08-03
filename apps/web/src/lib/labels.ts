/**
 * Enum values are stored in English in the database (`reinforcement`,
 * `paleozoic`, ...) but the UI shows everything in Portuguese. This file is
 * the single source of truth for those translations — call the helpers when
 * rendering, never inline the strings.
 */

export const ERA_LABEL: Record<"paleozoic" | "mesozoic" | "cenozoic", string> = {
  paleozoic: "paleozoico",
  mesozoic: "mesozoico",
  cenozoic: "cenozoico",
};

export const AWAKENING_TYPE_LABEL: Record<"reinforcement" | "swap", string> = {
  reinforcement: "reforço",
  swap: "troca",
};

export const DOCUMENT_STATUS_LABEL: Record<"defined" | "partial" | "pending", string> = {
  defined: "definido",
  partial: "parcial",
  pending: "pendente",
};

/**
 * Pluralization helper. Portuguese doesn't need much beyond adding "s", but a
 * few nouns we render often (like "resultado") deserve the small ceremony to
 * keep call sites readable.
 */
export function plural(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}
