// Loop-sim scenarios (DESIGN §14 loop-sim): many turns through the real pipeline at mixed levels and at
// the Story default, checking the invariants every turn.
import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { actionOdds, resolveOn, type ActionRequest } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { ALL_NOTE } from "../../src/engine/simulate";
import type { InterpretOutput } from "../../src/engine/steps";
import { timelapseIntent } from "../../src/engine/turn";
import { hashJson } from "../../src/shared/hash";
import { STARTER_WORLDS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState, trialBalance } from "../packs/support";
import { doubleBookings, leaks, reg, Session } from "./harness";

const ATTEMPT: ActionRequest = { action: "attempt", params: { stat: "wits", difficulty: 12 } };

/** A secret ladder whose truth must stay out of every player view until it is revealed. */
function withSecret(world: WorldDoc): WorldDoc {
  world.tracks.thief = {
    id: "thief",
    kind: "secret",
    label: "Missing tips",
    start: "rumor",
    visibility: "public",
    stages: {
      rumor: { label: "Someone is taking the tip jar", cue: "The tip jar keeps coming up short.", truth: "Jordan Price takes the tips", next: [{ to: "caught", when: "flag('caught')" }] },
      caught: { label: "Caught", truth: "Jordan Price confessed", next: [] },
    },
  };
  return world;
}

function mixedWorld(): WorldDoc {
  const world = withSecret(modernUsWorld("mixed", "Riverton (mixed levels)"));
  Object.assign(world.realism.levels, { money: 4, castlife: 4, relationships: 4, gear: 3, weather: 4, space: 3, sheets: 3, calendar: 4, vehicles: 2 });
  world.entities.maya!.levels = { money: 1 };
  world.entities.jordan!.levels = { castlife: 2 };
  world.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 40, trust: 30, respect: 30, t: 0 } });
  return world;
}

function storyWorld(): WorldDoc {
  const world = withSecret(modernUsWorld("story", "Riverton (Story)"));
  world.realism = { preset: "story", ...structuredClone(REALISM_PRESETS.story) };
  return world;
}

/** The intent for turn `i`: talk, eat, a stat check, chat, and a six-hour timelapse, in rotation. */
function intentAt(i: number): InterpretOutput | null {
  switch (i % 5) {
    case 0:
      return null;
    case 1:
      return { action: "eat", params: {}, probabilities: {} };
    case 2:
      return { action: "attempt", params: { stat: "wits", difficulty: 12 }, probabilities: {} };
    case 3:
      return { action: "chat_with", params: { target: "maya" }, probabilities: {} };
    default:
      return timelapseIntent({ type: "duration", minutes: 360 }, ALL_NOTE);
  }
}

/** Runs `turns` turns checking every per-turn invariant; returns the session and a mid-run snapshot. */
function run(world: WorldDoc, turns: number, seed: string, intent = intentAt): { s: Session; mid: { state: Session["state"]; at: number }; rolls: number } {
  const s = new Session(world, seed);
  let mid = { state: structuredClone(s.state), at: 0 };
  let rolls = 0;
  for (let i = 0; i < turns; i++) {
    const before = s.state.clock;
    const want = intent(i);
    const shown = want?.action === ATTEMPT.action ? actionOdds(reg, world, s.state, ATTEMPT) : null;
    const plan = s.take(want);
    // The clock advances every turn.
    expect(plan.elapsedMinutes).toBeGreaterThan(0);
    expect(s.state.clock).toBe(before + plan.elapsedMinutes);
    // Shown odds are the odds the roll used.
    const check = plan.resolutions[0]?.check;
    if (shown?.available && check) {
      expect(check.odds).toEqual(shown.odds ?? {});
      rolls++;
    }
    // The books balance.
    expect(trialBalance(s.state)).toBe(0);
    // No secret truth reaches a player view or slot.
    expect(leaks(world, s.state)).toEqual([]);
    // No agent is double-booked.
    expect(doubleBookings(world, s.state)).toEqual([]);
    if (i === Math.floor(turns / 2)) mid = { state: structuredClone(s.state), at: s.events.length };
  }
  return { s, mid, rolls };
}

/** No stale restore: the ledger replayed from the start, or from a mid-run snapshot, rebuilds the live state. */
function expectRestores(s: Session, mid: { state: Session["state"]; at: number }): void {
  expect(fold(reg, s.world, startState(s.world), s.events)).toEqual(s.state);
  expect(fold(reg, s.world, mid.state, s.events.slice(mid.at))).toEqual(s.state);
}

describe("loop-sim: mixed levels", () => {
  test("40 turns: clock, odds, books, secrets, bookings and restore hold every turn", () => {
    const { s, mid, rolls } = run(mixedWorld(), 40, "mixed");
    expectRestores(s, mid);
    expect(rolls).toBe(8);
    expect(s.events.some((e) => e.type === "set" && e.field === "activity")).toBe(true);
    expect(s.events.some((e) => e.type === "post")).toBe(true);
  });

  test("the run is deterministic: same seed, same ledger", () => {
    const a = run(mixedWorld(), 15, "det").s;
    const b = run(mixedWorld(), 15, "det").s;
    expect(hashJson(b.events)).toBe(hashJson(a.events));
  });

  test("shown odds are real odds: 400 rolls land within four standard errors of each shown probability", () => {
    const world = mixedWorld();
    const s = new Session(world, "odds");
    s.take(null);
    const shown = actionOdds(reg, world, s.state, ATTEMPT).odds ?? {};
    const n = 400;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const out = resolveOn(reg, world, s.state, ATTEMPT, createRng(`roll:${i}`)).resolution.check?.outcome ?? "none";
      counts[out] = (counts[out] ?? 0) + 1;
    }
    for (const [outcome, p] of Object.entries(shown)) {
      const freq = (counts[outcome] ?? 0) / n;
      expect(Math.abs(freq - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
    }
  });
});

describe("loop-sim: Story default", () => {
  test("30 turns at the Story preset hold the same invariants", () => {
    const { s, mid } = run(storyWorld(), 30, "story");
    expectRestores(s, mid);
  });
});

describe("loop-sim: converted starter worlds", () => {
  const starters = Object.entries(STARTER_WORLDS);
  test.skipIf(starters.length > 0)("no converted starter worlds are wired yet", () => {
    expect(starters).toEqual([]);
  });
  for (const [id, make] of starters) {
    test(`${id}: 20 turns as authored hold the invariants`, () => {
      const generic = (i: number): InterpretOutput | null => (i % 4 === 3 ? timelapseIntent({ type: "duration", minutes: 360 }, ALL_NOTE) : i % 4 === 1 ? { action: "eat", params: {}, probabilities: {} } : null);
      const { s, mid } = run(make(`loop-${id}`, id), 20, `starter:${id}`, generic);
      expectRestores(s, mid);
    });
  }
});
