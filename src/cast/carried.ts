// What a carried character brings besides its mind files (plan §7.5, §15.2; READINGS R-146): the older minds pack's own memory of it
// (its notes with their salience, its witness log, its commitments, its summary and its last mind), which the migration carries as pack
// state. It is read where it was carried, from the minds slice of the folded state at the reading's point, so each swipe shows its own,
// and is attached to the character's record as one more carried file, `minds`, which is given whole to its agent until it is filed, as
// the character's old mind files are. Nothing here judges what the notes say.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../shared/json";

/** The kind a carried mind file's item is marked with (the migration's), and the minds notes' marker. */
export const IMPORTED_KIND = "imported";

/** The name the minds pack's notes go by among a character's carried files: what `cast_update` `filed` names to mark them filed. */
export const MINDS_FILE = "minds";

/** The older minds pack's own memory of one character, each part left out when the pack holds none. */
export type MindsNotes = JsonObject;

/**
 * What the minds slice (`state.world.packs.minds`) keeps of the entity: its summary, notes, commitments, witness log and latest mind.
 * Null when it keeps none of them.
 */
export function mindsNotesOf(slice: unknown, entity: string): MindsNotes | null {
  const chars = isRecord(slice) && isRecord(slice.chars) ? slice.chars : null;
  const held = chars !== null && Object.hasOwn(chars, entity) ? chars[entity] : null;
  if (!isRecord(held)) return null;
  const out: JsonObject = {};
  if (typeof held.summary === "string" && held.summary.trim() !== "") out.summary = held.summary;
  for (const part of ["notes", "commitments", "witness"] as const) if (Array.isArray(held[part]) && held[part].length > 0) out[part] = held[part] as JsonValue;
  if (isRecord(held.mind)) out.mind = held.mind as JsonObject;
  return Object.keys(out).length > 0 ? out : null;
}

/** The ids of the entities the minds slice keeps something of. */
export function mindsEntities(slice: unknown): string[] {
  return isRecord(slice) && isRecord(slice.chars) ? Object.keys(slice.chars) : [];
}
