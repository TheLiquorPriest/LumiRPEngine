// RPH's lore port (`rp-harness/contract` `LorePort`) over RPE's lore: what RPH's `lore_read` and
// `lore_search` read, and what activated for a turn. It reads as the lead does, every entry; reading
// as a character stays inside RPE.

import type { LorePort } from "rp-harness/contract";
import type { Lore } from "./lore";

export function lorePort(lore: Lore): LorePort {
  return {
    read: (scope, ids) => lore.read(scope, ids),
    search: (scope, query) => lore.search(scope, query),
    activated: (scope) => lore.activated(scope),
  };
}
