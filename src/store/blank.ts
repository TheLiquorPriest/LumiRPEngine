// A chat that names no world plays on a blank one (plan §12: "A new chat needs none of this: the
// card, the lore and the first message seed it"). The blank world is the packs as shipped, with
// nothing in them: no places, no people, no things. It is the same for every such chat and is
// never stored; the store answers for it under its own revision. Play records into it from the
// first turn, and a world attached later is an Upgrade from it, as from any revision.

import type { RevisionId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import { newBlankWorld } from "../engine/authoring";
import type { Registry } from "../engine/registry-impl";

/** The revision a chat that names no world plays on. */
export const BLANK_REVISION: RevisionId = "blank";

/** The blank world: every pack as shipped, its default tables in, and nothing else. */
export function blankWorld(registry: Registry): WorldDoc {
  const made = newBlankWorld(BLANK_REVISION, "", registry);
  return {
    ...made,
    packs: Object.fromEntries(registry.packs.map((p) => [p.id, { version: p.version, config: {} }])),
    kinds: {},
    entities: {},
    places: {},
    pov: "",
    start: { ...made.start, place: "" },
  };
}
