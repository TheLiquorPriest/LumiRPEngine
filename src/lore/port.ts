// RPH's lore port (`rp-harness/contract` `LorePort`) over RPE's lore: what RPH's `lore_read` and
// `lore_search` read, and what activated for a turn. A reader that plays no character (the lead, the
// GM) reads every entry, each marked with who may know it. A reader that plays a character reads as
// that character: only what that character may know, so that giving a character's agent the lore
// tools in its definition file shows it no more than its character would have.
//
// With the index, every entry read carries the notes the story has written on it (its overlays on the
// path the read is at, each with the turn it was written on), as the lore map and a character's known lore do.

import type { LorePort } from "rp-harness/contract";
import type { LoreIndex } from "./indexing";
import type { Lore } from "./lore";

export function lorePort(lore: Lore, index?: Pick<LoreIndex, "read" | "readAs">): LorePort {
  const reader = index ?? lore;
  return {
    read: (scope, ids, who) => (who.plays === undefined ? reader.read(scope, ids) : reader.readAs(scope, who.plays, ids)),
    search: (scope, query, who) => (who.plays === undefined ? lore.search(scope, query) : lore.searchAs(scope, who.plays, query)),
    activated: (scope) => lore.activated(scope),
  };
}
