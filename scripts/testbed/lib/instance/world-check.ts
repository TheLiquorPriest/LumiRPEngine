// "A world with every part filled" (STANDALONE-PLAN §15.5) checked against the world document as
// today's build defines it: every part of `WorldDoc`, the optional ones included, since a part the
// document leaves out is as empty as one it holds empty. And which revision of the world each chat
// plays, told by its place in the world's history, so two runs that made the same revisions with
// different content hashes read the same.

/** Every part of a world document, in the order today's build declares them (on `main`, `src/shared/world.ts:1285-1370`). */
export const WORLD_PARTS = [
  "format", "id", "name", "engineVersion", "packs", "pins", "kinds", "relations", "entities", "places", "routes", "grids", "maps",
  "rules", "actions", "checks", "calendar", "schedules", "routines", "routineSettings", "needs", "tracks", "tables", "realism", "time",
  "sections", "sectionTemplates", "steps", "suppressed", "lore", "loreIndex", "lorePins", "loreBooks", "mapSettings", "classifications",
  "minds", "narrator", "ruleset", "seedMode", "lenientPricing", "currency", "pov", "tiers", "spawnTier", "spawnCap", "placeCap",
  "placesPerTurn", "lifeStates", "start",
] as const;

export type WorldPart = (typeof WORLD_PARTS)[number];

/** Whether a part holds something: a list or an object with an entry, text with a character, any number or switch. */
function holds(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value !== "";
  return true;
}

/** How full each part is: the number of entries of a list or an object, 1 for a value, 0 for nothing. */
export function partSizes(doc: { readonly [part: string]: unknown }): { [part in WorldPart]: number } {
  const out = {} as { [part in WorldPart]: number };
  for (const part of WORLD_PARTS) {
    const value = doc[part];
    out[part] = !holds(value) ? 0 : Array.isArray(value) ? value.length : typeof value === "object" && value !== null ? Object.keys(value).length : 1;
  }
  return out;
}

/** The parts of the document that hold nothing. */
export function emptyParts(doc: { readonly [part: string]: unknown }): WorldPart[] {
  return WORLD_PARTS.filter((part) => !holds(doc[part]));
}

/** Parts of the document that today's build does not declare: a world from a later build, or a typo in a patch. */
export function unknownParts(doc: { readonly [part: string]: unknown }): string[] {
  const known = new Set<string>(WORLD_PARTS);
  return Object.keys(doc).filter((part) => !known.has(part));
}

/**
 * Which revision each chat plays, as its number in the world's history (1 is the first committed),
 * or 0 for a revision the history does not hold. `history` is oldest first, as `lre.world get`
 * gives it.
 */
export function revisionNumbers(history: readonly { revision: string }[], played: { readonly [chat: string]: string | null }): { [chat: string]: number } {
  const order = history.map((h) => h.revision);
  return Object.fromEntries(Object.entries(played).map(([chat, revision]) => [chat, revision === null ? 0 : order.indexOf(revision) + 1]));
}
