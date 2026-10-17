// Loop-sim harness: drives worlds through the real turn pipeline (planTurn → fold → postTurn →
// fold), the same order the backend uses, and exposes the invariants each scenario checks.
import type { JsonValue } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { calendarOf, clockAt, dateAt, MINUTES_PER_DAY } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import type { InterpretOutput } from "../../src/engine/steps";
import { planTurn, postTurn, type EngineTurnPlan } from "../../src/engine/turn";
import { findLeaks, unrevealedTruths } from "../../src/engine/visibility";
import { commitments, dayPlan } from "../../src/packs/castlife/core/index";
import { ALL_PACKS } from "../../src/packs/index";
import { fold, startState } from "../packs/support";

export const reg = createRegistry(ALL_PACKS);

export class Session {
  state: WorldState;
  readonly events: LedgerEvent[] = [];
  turn = 0;

  constructor(
    readonly world: WorldDoc,
    readonly runSeed: string,
  ) {
    this.state = startState(world);
  }

  /** One turn: plan, fold, post, fold (no extraction: the model's reply proposes nothing). */
  take(intent: InterpretOutput | null): EngineTurnPlan {
    const seed = `${this.runSeed}:${this.turn++}`;
    const plan = planTurn({ registry: reg, world: this.world, state: this.state, runSeed: this.runSeed, seed, kind: "normal", userTexts: ["…"], intent });
    this.state = fold(reg, this.world, this.state, plan.events);
    const post = postTurn({ registry: reg, world: this.world, state: this.state, runSeed: this.runSeed, seed, appliedMinutes: plan.elapsedMinutes, extracted: [] });
    this.state = fold(reg, this.world, this.state, post);
    this.events.push(...plan.events, ...post);
    return plan;
  }
}

/** Everything the player can see: every panel view and every narrator slot (the GM view is asked for, never a panel). */
export function playerSurface(world: WorldDoc, state: Readonly<WorldState>): JsonValue[] {
  const ctx = reg.context(world, state);
  const views: JsonValue[] = reg.views.map((v) => v.build(ctx, { mapDisplay: null }));
  const slots: JsonValue[] = reg.renderers.map((r) => r.render(ctx));
  return [...views, ...slots];
}

/** Player-visible strings that contain an unrevealed secret truth. */
export function leaks(world: WorldDoc, state: Readonly<WorldState>): string[] {
  return findLeaks(playerSurface(world, state), unrevealedTruths(world, state));
}

/**
 * Double-booking problems in the agents' day plans (re-derived from state): overlapping blocks,
 * or a commitment that a fixed block of the plan does not cover.
 */
export function doubleBookings(world: WorldDoc, state: Readonly<WorldState>): string[] {
  const ctx = reg.context(world, state);
  const cal = calendarOf(world);
  const out: string[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    if (!state.entities[id]?.agent) continue;
    const plan = dayPlan(ctx, id);
    const blocks = [...plan.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < blocks.length; i++) if ((blocks[i]?.start ?? 0) < (blocks[i - 1]?.end ?? 0)) out.push(`${id}: overlapping blocks at ${blocks[i]?.start}`);
    const start = clockAt(cal, plan.day, 0);
    for (const c of commitments(ctx, id, start, start + MINUTES_PER_DAY)) {
      const from = Math.max(c.start, start);
      const to = Math.min(c.end, start + MINUTES_PER_DAY);
      const covered = blocks.filter((b) => b.fixed && b.start < to && b.end > from).reduce((a, b) => a + Math.min(b.end, to) - Math.max(b.start, from), 0);
      if (covered < to - from) out.push(`${id}: ${c.label} on day ${dateAt(cal, start).dayIndex} is not fully planned`);
    }
  }
  return out;
}
