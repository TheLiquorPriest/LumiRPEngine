// Time on a grid (plan §8.2): each grid counts time in its own step (`Scale.step`). A room-scale
// grid counts rounds of a few seconds, in each of which someone moves so many squares, so a fight
// does not run the clock forward; a coarser one counts today's walking minutes (`shared/grid.ts
// costMinutes`: 80 m a minute, at least one minute for any step). The clock is moved by today's
// `clock` event, which counts minutes and takes a part of one.

import { costMinutes } from "../../shared/grid";
import type { ChangeInput } from "../../store/types";
import type { Scale } from "./grid";

/** How long something took on a grid. */
export interface Took {
  seconds: number;
  /** On a grid that counts rounds, how many. */
  rounds?: number;
}

/**
 * How long a move that costs `cost` (a way's movement, `Walk.cost`) takes on a grid of `scale`:
 * whole rounds at the grid's squares a round, or at `speed` squares a round for a mover whose
 * speed is known; on a coarser grid, today's walking minutes.
 */
export function moveTime(scale: Scale, cost: number, speed?: number): Took {
  if (scale.step.per === "round") {
    const rounds = cost > 0 ? Math.ceil(cost / (speed !== undefined && speed > 0 ? speed : scale.step.squares)) : 0;
    return { seconds: rounds * scale.step.seconds, rounds };
  }
  return { seconds: cost > 0 ? Math.max(1, costMinutes({ cellMeters: scale.metres }, cost)) * 60 : 0 };
}

/** How long `rounds` rounds of a fight take on a grid of `scale`; null on a grid that does not count rounds. */
export function roundsTime(scale: Scale, rounds: number): Took | null {
  return scale.step.per === "round" ? { seconds: rounds * scale.step.seconds, rounds } : null;
}

/** The change that moves the clock on by `seconds` (today's `clock` event, which counts minutes). */
export function clockChange(seconds: number): ChangeInput {
  return { lane: "engine", op: "clock", value: { type: "clock", minutes: seconds / 60, cause: "action" } };
}
