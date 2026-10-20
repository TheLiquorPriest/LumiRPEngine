// What the ledger gate's generated sequences must exercise (DESIGN §14): the runners in ops.ts count
// it, the property suite holds a run to it, and a run split into shards adds its shards' counts up.

import type { Plays } from "./harness";

/**
 * How often a run exercised a funds drop, a grouped drop on a rebased view, a Re-run carrying or
 * dropping a fix, a Re-run dropping a fix whose materialization its new swipe had already made, a
 * copy of an earlier build's chat whose starting markers it had to restore, a turn checked on the
 * chain it was planned on after a deletion moved a swipe it saw, a fight's start, acts, turns and
 * end, a turn's planned life changes and tellings, and queued turns and each way one stops early
 * (the suite asserts they happen).
 */
export interface Coverage {
  fundsDrops: number;
  groupDrops: number;
  carried: number;
  carryDrops: number;
  stripped: number;
  earlierCopies: number;
  shiftedPlans: number;
  fights: Record<"start" | "act" | "turn" | "end", number>;
  lives: Record<"life" | "told", number>;
  minds: Record<"mind" | "memory" | "presence" | "fix", number>;
  queues: Plays;
}

/** A fresh count for a runner or a whole suite. */
export function noCoverage(): Coverage {
  return { fundsDrops: 0, groupDrops: 0, carried: 0, carryDrops: 0, stripped: 0, earlierCopies: 0, shiftedPlans: 0, fights: { start: 0, act: 0, turn: 0, end: 0 }, lives: { life: 0, told: 0 }, minds: { mind: 0, memory: 0, presence: 0, fix: 0 }, queues: { queued: 0, check: 0, failure: 0, interruption: 0 } };
}

/** Adds one run's counts to another's: a long run split into shards counts as the whole run. */
export function addCoverage(into: Coverage, from: Coverage): void {
  for (const key of ["fundsDrops", "groupDrops", "carried", "carryDrops", "stripped", "earlierCopies", "shiftedPlans"] as const) into[key] += from[key];
  for (const k of ["start", "act", "turn", "end"] as const) into.fights[k] += from.fights[k];
  for (const k of ["life", "told"] as const) into.lives[k] += from.lives[k];
  for (const k of ["mind", "memory", "presence", "fix"] as const) into.minds[k] += from.minds[k];
  for (const k of ["queued", "check", "failure", "interruption"] as const) into.queues[k] += from.queues[k];
}

/**
 * What a generated run of `runs` sequences failed to reach. Some of it is rare, so only a long run
 * is held to it: the fixed base's 200 sequences reach all of it, and any 40 the minds' records
 * (deterministic for the fixed base).
 */
export function coverageGaps(coverage: Coverage, runs: number): string[] {
  const gaps: string[] = [];
  const need = (kind: string, count: number): void => {
    if (count <= 0) gaps.push(kind);
  };
  if (runs >= 100) {
    // L40/L41: the runs rebase a payment, and a grouped purchase, onto a branch that can't cover it.
    need("fundsDrops", coverage.fundsDrops);
    need("groupDrops", coverage.groupDrops);
    // L43: Re-runs carry fixes forward, and drop ones that no longer apply.
    need("carried", coverage.carried);
    need("carryDrops", coverage.carryDrops);
    // L46: a Re-run carries a fix without the materialization its new swipe already made.
    need("stripped", coverage.stripped);
    // L45: copies of an earlier build's chats restore its starting markers to fold alike.
    need("earlierCopies", coverage.earlierCopies);
    // L5: turns are checked on the chain they were planned on after a deletion moved a swipe it holds.
    need("shiftedPlans", coverage.shiftedPlans);
    // Fights start, act, pass the turn and end (on any view, swipes and rebases included).
    for (const k of ["start", "act", "turn", "end"] as const) need(`fights.${k}`, coverage.fights[k]);
    // Life changes and tellings land in planned turns (through the engine's `life` effect and a rule),
    // and queued turns play several actions and stop at a check, a failure and an interruption.
    for (const k of ["life", "told"] as const) need(`lives.${k}`, coverage.lives[k]);
    for (const k of ["queued", "check", "failure", "interruption"] as const) need(`queues.${k}`, coverage.queues[k]);
  }
  // Minds' records fold on every view: Dev's minds before the plan, presence and memory after the reply, and GM minds controls.
  if (runs >= 40) for (const k of ["mind", "memory", "presence", "fix"] as const) need(`minds.${k}`, coverage.minds[k]);
  return gaps;
}
