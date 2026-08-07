/**
 * Enum values are stored in English in the database (`reinforcement`,
 * `paleozoic`, ...) but the UI shows everything in Portuguese. This file is
 * the single source of truth for those translations — call the helpers when
 * rendering, never inline the strings.
 */

/**
 * The eras carry in-world names, not geological ones — see the `nomenclatura`
 * document. The database enum stays `paleozoic` / `mesozoic` / `cenozoic`
 * because that is code; only the label changes.
 */
export const ERA_LABEL: Record<"paleozoic" | "mesozoic" | "cenozoic", string> = {
  paleozoic: "Aetheris",
  mesozoic: "Titanor",
  cenozoic: "Novaterra",
};

/** Real geological era behind each in-world name, for tooltips and docs. */
export const ERA_SCIENTIFIC_LABEL: Record<"paleozoic" | "mesozoic" | "cenozoic", string> = {
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
