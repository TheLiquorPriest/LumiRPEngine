// A chat that names no world plays on a blank one (plan §12: "A new chat needs none of this: the
// card, the lore and the first message seed it"). The blank world is the packs as shipped, with
// nothing in them: no places, no people, no things. It is the same for every such chat and is
// never stored; the store answers for it under its own revision. Play records into it from the
// first turn, and a world attached later is an Upgrade from it, as from any revision.

import type { RevisionId } from "../shared/ids";
import { isRecord, type JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { newBlankWorld } from "../engine/authoring";
import type { Registry } from "../engine/registry-impl";
import type { StoreState } from "./types";

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

/**
 * What a change of the clock carries when it states the date and time it reaches, not only how far
 * the clock moves; and the name of the world's mark for the change that last did (`marks.world.set`).
 */
export const CLOCK_SET = "set";

/**
 * A change of the clock (a `clock` move, or the set-back `engine.rewind`) that states the date and
 * time it reaches: the fold marks the world's clock set by it (`clockRecorded`). The engine reads only
 * how far it moves.
 */
export function settingClock<E extends LedgerEvent>(ev: E): E {
  return { ...ev, [CLOCK_SET]: true };
}

/** Whether a change's value sets the clock (`settingClock`). */
export function setsClock(value: JsonValue): boolean {
  return isRecord(value) && value[CLOCK_SET] === true;
}

/**
 * Whether a state's clock is a recorded value. A real world's is: its author set the calendar. The
 * blank world's starts from the authoring template, a date nobody set, so it is one only once a
 * change has set the clock (`settingClock`), stating the date and time it reaches; a change that only
 * moves it, by a span or to a time of day, leaves the date where nobody chose it. Its time zone and
 * currency are never one: only a world attached gives them.
 */
export function clockRecorded(state: StoreState): boolean {
  return state.world.revision !== BLANK_REVISION || state.marks.world?.[CLOCK_SET] !== undefined;
}
