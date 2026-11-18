// What the world's own records do while the clock moves in play (plan §6.1, §6.4). A payroll, a bill, a standing
// payment, interest, an invoice, a plan to pay: each is arranged by a record the world holds, so when time passes over
// its day it happens, in its order, with its own record, as it would have if the time had passed a turn at a time.
// What a record does not arrange is left to the Author, listed as due: where people went, what they did, whether a
// meal was eaten, the weather, a price's drift.
//
// The run is `advance`'s turn, narrowed. It steps the same slots in the same order (schedule edges at their instants,
// the clock to the slot's end, then the processes the packs mark `standing`), but the last piece ends where the clock
// does, so a payday at nine is paid when the clock reads half past, not at the end of the day part. The schedule edges
// it applies are the ones that set a thing's own value (a business's hours): a routine's moves of a person (`place`,
// `activity`) are the Author's. No agent is stepped, no rule fires and no quest or secret moves here: a stage moves
// when the Author or the GM says it is met.

import { hashParts } from "../shared/hash";
import type { ClockEvent, LedgerEvent } from "../shared/ledger";
import { calendarOf, clockOfSeconds, clockSeconds, slotIndexAt, slotsEnding } from "./calendar";
import { chatWorld } from "./holidays";
import type { SlotInfo } from "./registry";
import { rulesetFloor, type Registry } from "./registry-impl";
import { appliedInPlay, chatSchedulesIn, instantEvents, scheduleInstants } from "./schedules";
import { ranTo, rngFactory } from "./simulate";
import { clampUnitCap, TIME_LIMITS } from "./time-limits";
import type { Working } from "./working";

export interface StandingOptions {
  runSeed: string;
  /** The cause the clock events carry. */
  cause: ClockEvent["cause"];
  /** What the caller makes of the first clock event it moves by (a move that sets the date and time it reaches marks it so). */
  first?: (move: ClockEvent) => LedgerEvent;
}

export interface StandingResult {
  /** Where the clock was, and where it is now. */
  from: number;
  to: number;
  /** The clock the run was asked to reach. */
  asked: number;
  /** The pieces of time it stepped, and the events it recorded besides the clock's own. */
  pieces: number;
  events: number;
  /** True when the run stopped short of `asked`: it reached a year, or recorded as many changes as the world's unit cap allows. What lies past `to` has not run. */
  cut: boolean;
}

/**
 * Moves the clock to `asked`, running over the span everything the world's own records arrange. The run reaches at most a timelapse's
 * reach (`TIME_LIMITS.timelapseMinutes`, a year) and records at most the unit cap's events (`state.time.unitCap`); where either is
 * met first, the clock stands where the last whole piece ended, and the result says it was cut.
 */
export function standingRun(reg: Registry, w: Working, asked: number, opts: StandingOptions): StandingResult {
  const from = w.state.clock;
  const result: StandingResult = { from, to: from, asked, pieces: 0, events: 0, cut: false };
  if (asked <= from) return result;
  const to = Math.min(asked, from + TIME_LIMITS.timelapseMinutes);
  result.cut = to < asked;
  const cal = calendarOf(w.world);
  const cap = clampUnitCap(w.state.time.unitCap).events;
  // Up to how far the world has run (after the clock was set back), everything already happened: only the clock moves across it.
  const since = ranTo(w.state);
  let clocks = 0;
  let moved = false;
  const clockTo = (at: number): void => {
    const seconds = clockSeconds(at) - clockSeconds(w.state.clock);
    if (seconds <= 0) return;
    const move: ClockEvent = { type: "clock", minutes: clockOfSeconds(seconds), cause: opts.cause };
    w.applyAll([moved || opts.first === undefined ? move : opts.first(move)]);
    moved = true;
    clocks++;
  };
  const instants = scheduleInstants(chatWorld(w.ctx), chatSchedulesIn(w.ctx).filter(appliedInPlay), since, to);
  const processes = reg.processes.filter((d) => d.standing === true && d.scope !== "agent");
  // The pieces: each whole slot ending in the span, then what is left of the one the clock ends in.
  const pieces: { start: number; end: number; index: number }[] = [];
  let start = since;
  for (const slot of slotsEnding(cal, since, to)) {
    pieces.push({ start, end: slot.end, index: slot.index });
    start = slot.end;
  }
  if (start < to) pieces.push({ start, end: to, index: slotIndexAt(cal, to) });
  const before = w.events.length;
  if (pieces.length === 0) clockTo(to);
  let next = 0;
  let made = 0;
  for (const piece of pieces) {
    const mark = result.pieces > 0 ? w.lightMark() : null;
    const used = w.events.length;
    const clocksBefore = clocks;
    // Schedule edges up to the piece's end, each at its own instant.
    for (; next < instants.length && (instants[next]?.at ?? Infinity) <= piece.end; next++) {
      const edge = instants[next];
      if (edge === undefined) break;
      clockTo(edge.at);
      w.applyAll(instantEvents(reg, w.ctx, edge, opts.runSeed, { povRoutine: false }));
    }
    clockTo(piece.end);
    const info: SlotInfo = { start: piece.start, end: piece.end, index: piece.index, povRoutine: false, run: { from, to } };
    for (const def of processes) {
      if (rulesetFloor(w.world, def.domain, w.state.realism.levels[def.domain] ?? 0) < def.minLevel) continue;
      w.applyAll(def.step(info, w.ctx, rngFactory(hashParts(opts.runSeed, "standing", String(piece.start)), def.id, piece.index)));
    }
    // The cap holds for the whole run, as a slot's does in `advance`: the first piece always runs, and one that takes the run over goes back.
    // What it counts is what the records did, not the clock's steps.
    made += w.events.length - used - (clocks - clocksBefore);
    if (mark !== null && made > cap && w.events.length > used) {
      w.restore(mark);
      result.cut = true;
      break;
    }
    result.pieces++;
  }
  // The clock's steps from one piece to the next are one move where nothing else came between them: only the record is shorter.
  w.joinClockMoves(before);
  result.to = w.state.clock;
  result.events = w.events.slice(before).filter((e) => e.type !== "clock").length;
  return result;
}
