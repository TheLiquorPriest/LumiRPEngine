// Time on a grid (plan §8.2): each grid counts time in its own step (`Scale.step`, with how long a
// move or a round takes in `packs/space/core/grid-model.ts`). A room-scale grid counts rounds of a
// few seconds, in each of which someone moves so many squares, so a fight does not run the clock
// forward; a coarser one counts today's walking minutes. The clock is moved by today's `clock`
// event, which counts minutes and takes a part of one.

import type { ChangeInput } from "../../store/types";

/** The change that moves the clock on by `seconds` (today's `clock` event, which counts minutes). */
export function clockChange(seconds: number): ChangeInput {
  return { lane: "engine", op: "clock", value: { type: "clock", minutes: seconds / 60, cause: "action" } };
}
