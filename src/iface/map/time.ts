// Time on a grid (plan §8.2): each grid counts time in its own step (`Scale.step`, with how long a
// move or a round takes in `packs/space/core/grid-model.ts`). A room-scale grid counts rounds of a
// few seconds, in each of which someone moves so many squares, so a fight does not run the clock
// forward by minutes; a coarser one counts today's walking minutes. The clock is moved by the `clock`
// event, which counts a part of a minute to the second. The one function that turns rounds into a
// change of the clock is here: `pass_time`'s `rounds` and the round tool both take theirs from it.

import type { PlaceId } from "../../shared/ids";
import type { LedgerEvent } from "../../shared/ledger";
import type { MapConfig } from "../../shared/map-config";
import { groundAt, roundsTime, type GroundSource, type Took } from "../../packs/space/core/grid-model";

/** What rounds do to the clock on a grid: how long they take, and the event that moves the clock by it. */
export interface RoundsClock {
  took: Took;
  event: LedgerEvent;
}

/**
 * The clock change for `rounds` rounds on the grid someone at `place` stands on, as play stands (`config`:
 * the chat's map settings): the seconds the grid's step makes of them, and the `clock` event, caused by
 * `cause`, that moves the clock by those seconds. Null where there is no such grid there, or it counts
 * no rounds (a coarser one counts walking minutes), or `rounds` is not above 0: no clock time is made up.
 */
export function roundsClock(source: GroundSource, place: PlaceId | null, rounds: number, cause: "action" | "advance", config?: MapConfig): RoundsClock | null {
  const ground = rounds > 0 && place !== null ? groundAt(source, place, config) : null;
  const took = ground === null ? null : roundsTime(ground.drawn.scale, rounds);
  return took === null ? null : { took, event: { type: "clock", minutes: took.seconds / 60, cause } };
}
