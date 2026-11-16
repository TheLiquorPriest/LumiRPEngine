// A place's base (plan §7.1, §8.2): what it is and looks like, in the Author's or the player's words, kept with the revision of each bound
// entry it was drawn against. A place the world defines stands on the world's own words for it, shown as the world's at that revision,
// until a base is written. Lore stays the authority for what it defines: the base is marked older than its source where a bound entry
// changed, went or was bound since (`sourcesNow`); code rewrites no base, redrawing is the Author's.

import { baseOf, placeSliceOf } from "./fold";
import { type PlaceAt, placeDef } from "./record";
import type { PlaceSources } from "./sources";
import type { Infer } from "../app";
import type { baseShown } from "./shapes";

export type PlaceBaseShown = Infer<typeof baseShown>;

/** The base that stands for a place at a point of the path: the one written in play, else the world's own description, else none. */
export function baseAt(at: PlaceAt, place: string, sources: Pick<PlaceSources, "older"> | null): PlaceBaseShown {
  const written = baseOf(placeSliceOf(at.state), place);
  if (written !== null) return { text: written.text, world: false, revision: null, by: written.by, turn: written.turn, older: sources?.older ?? false };
  const described = placeDef(at, place)?.fields.description;
  if (typeof described === "string" && described.trim() !== "") return { text: described, world: true, revision: at.world.revision, by: null, turn: null, older: false };
  return { text: null, world: false, revision: null, by: null, turn: null, older: false };
}
