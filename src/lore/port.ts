// RPH's lore port (`rp-harness/contract` `LorePort`) over RPE's lore: what RPH's `lore_read` and
// `lore_search` read, and what activated for a turn. A reader that plays no character (the lead, the
// GM) reads every entry, each marked with who may know it. A reader that plays a character reads as
// that character: only what that character may know, so that giving a character's agent the lore
// tools in its definition file shows it no more than its character would have.

import type { LorePort } from "rp-harness/contract";
import type { Lore } from "./lore";

export function lorePort(lore: Lore): LorePort {
  return {
    read: (scope, ids, reader) => (reader.plays === undefined ? lore.read(scope, ids) : lore.readAs(scope, reader.plays, ids)),
    search: (scope, query, reader) => (reader.plays === undefined ? lore.search(scope, query) : lore.searchAs(scope, reader.plays, query)),
    activated: (scope) => lore.activated(scope),
  };
}
