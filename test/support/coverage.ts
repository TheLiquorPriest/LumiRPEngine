// What the ledger test runner (ops.ts) counts as it runs a sequence.

import type { Plays } from "./harness";

/**
 * How often a run exercised a funds drop, a grouped drop on a rebased view, a unit kept apart from a
 * payment (an overdraft link's transfer) dropped there, a Keep conversion of one or of its payment, a
 * correction dropped with the purchase it was tied to, a Re-run carrying or dropping a fix, a Re-run
 * dropping a fix whose materialization its new swipe had already made, a Re-run carrying a GM edit
 * that keeps its request, a rebased view holding one, either of those with one already so where it
 * was made (no events of its own), a copy of an earlier build's chat whose starting markers it had
 * to restore, a turn checked on the chain it was planned on after a deletion moved a swipe it saw, a
 * fight's start, acts, turns and end, a turn's planned life changes and tellings, and queued turns
 * and each way one stops early.
 */
export interface Coverage {
  fundsDrops: number;
  groupDrops: number;
  apartDrops: number;
  apartConverts: number;
  tiedDrops: number;
  carried: number;
  carryDrops: number;
  stripped: number;
  askedCarried: number;
  askedViews: number;
  askedEmpty: number;
  earlierCopies: number;
  shiftedPlans: number;
  fights: Record<"start" | "act" | "turn" | "end", number>;
  lives: Record<"life" | "told", number>;
  minds: Record<"mind" | "memory" | "presence" | "fix", number>;
  queues: Plays;
}

/** A fresh count for a runner. */
export function noCoverage(): Coverage {
  return { fundsDrops: 0, groupDrops: 0, apartDrops: 0, apartConverts: 0, tiedDrops: 0, carried: 0, carryDrops: 0, stripped: 0, askedCarried: 0, askedViews: 0, askedEmpty: 0, earlierCopies: 0, shiftedPlans: 0, fights: { start: 0, act: 0, turn: 0, end: 0 }, lives: { life: 0, told: 0 }, minds: { mind: 0, memory: 0, presence: 0, fix: 0 }, queues: { queued: 0, check: 0, failure: 0, interruption: 0 } };
}
