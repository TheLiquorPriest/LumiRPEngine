import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { applyMarker } from "../../src/engine/events";
import type { PackDef } from "../../src/engine/registry";
import type { Registry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import { applyTimeAdvance, buildMontage, clockFix, clockPaused, minimumUnitCap, parseTarget, pauseBookkeeping, resolveTarget, runTimelapse, speedThrough, tickMinutes, turnElapsed } from "../../src/engine/time";
import { planTurn, postTurn, timelapseIntent } from "../../src/engine/turn";
import { ALL_NOTE, ranTo } from "../../src/engine/simulate";
import { placeOfEntity } from "../../src/engine/scope";
import { Working } from "../../src/engine/working";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld, fold, POV, registryOf, startState, trialBalance } from "../packs/support";

function timeWorld(): WorldDoc {
  const world = baseWorld();
  world.actions.bed = { id: "bed", label: "Go to bed", params: {}, requires: [], outcomes: { default: [] }, duration: "5", activity: { type: "sleep", until: "next_time('07:00')" }, lexicon: ["go to bed", "sleep"] };
  world.actions.chat = { id: "chat", label: "Chat", params: {}, requires: [], outcomes: { default: [{ type: "set", args: { entity: POV, field: "scene", value: "conversation" } }] }, duration: "0" };
  world.schedules.shift = { id: "shift", owner: POV, target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "09:00", end: "17:00", value: "work_shift" }] };
  return world;
}

/** A pack that pays the POV daily and bills it: money moves inside a timelapse. */
const payPack: PackDef = {
  id: "paytest",
  label: "Pay test",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.process({
      id: "paytest.flow",
      domain: "money",
      minLevel: 1,
      step(slot, ctx) {
        if (slot.index % 4 !== 1) return [];
        return [
          { type: "post", lines: [{ account: "economy.external:employer", amount: -10000 }, { account: "acct", amount: 10000 }], memo: "Pay" },
          { type: "post", lines: [{ account: "acct", amount: -2500 }, { account: "economy.external:landlord", amount: 2500 }], memo: "Rent" },
          { type: "engine.signal", data: { class: "bill", text: `Rent paid (${ctx.world.name})` } },
        ];
      },
    });
  },
};

describe("elapsed time and time controls", () => {
  test("a plain turn elapses the scene tick × scale; an action its duration; a paused clock nothing", () => {
    const world = timeWorld();
    const s = startState(world);
    expect(tickMinutes(world, s)).toBe(30); // home is a downtime scene
    s.entities[POV]!.fields.scene = "conversation";
    expect(turnElapsed(world, s, null)).toEqual({ minutes: 2, source: "tick" });
    applyMarker(s, { kind: "time", control: "tick", scope: { sceneType: "conversation" }, to: 10 });
    applyMarker(s, { kind: "time", control: "scale", scope: { all: true }, to: 2 });
    expect(turnElapsed(world, s, null).minutes).toBe(20);
    expect(turnElapsed(world, s, 45)).toEqual({ minutes: 45, source: "action" });
    applyMarker(s, { kind: "time", control: "pause", scope: { all: true }, to: true });
    expect(turnElapsed(world, s, 45)).toEqual({ minutes: 0, source: "paused" });
  });

  test("a pause holds for its scene; a scene change resumes the clock", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s = startState(world);
    applyMarker(s, { kind: "time", control: "pause", scope: { all: true }, to: true });
    const pinned = fold(reg, world, s, pauseBookkeeping(world, s));
    expect(clockPaused(world, pinned)).toBe(true);
    pinned.entities[POV]!.fields.place = "cafe";
    expect(clockPaused(world, pinned)).toBe(false);
    applyMarker(pinned, { kind: "time", control: "pause", scope: { all: true }, to: false });
    expect(pauseBookkeeping(world, pinned)).toEqual([{ type: "engine.pause", data: { scene: null } }]);
  });

  test("pausing again in a scene left since holds the clock there, though the raw flag never cleared", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s = startState(world);
    applyMarker(s, { kind: "time", control: "pause", scope: { all: true }, to: true });
    const left = fold(reg, world, s, pauseBookkeeping(world, s));
    left.entities[POV]!.fields.place = "cafe";
    // The raw flag stays set, but the clock runs in the new scene.
    expect([left.time.paused, clockPaused(world, left)]).toEqual([true, false]);
    applyMarker(left, { kind: "time", control: "pause", scope: { all: true }, to: true });
    expect(clockPaused(world, left)).toBe(true);
    const pinned = fold(reg, world, left, pauseBookkeeping(world, left));
    expect(clockPaused(world, pinned)).toBe(true);
    expect(turnElapsed(world, pinned, 45)).toEqual({ minutes: 0, source: "paused" });
  });

  test("plan turns: every unpaused turn advances the clock (L26); a paused one doesn't", () => {
    const world = timeWorld();
    const reg = registryOf();
    let state: WorldState = startState(world);
    const base = { registry: reg, world, runSeed: "run", kind: "normal" as const, userTexts: ["hi"] };
    for (let i = 0; i < 3; i++) {
      const plan = planTurn({ ...base, state, seed: `t${i}`, intent: null });
      expect(plan.elapsedMinutes).toBe(30);
      state = fold(reg, world, state, plan.events);
    }
    applyMarker(state, { kind: "time", control: "pause", scope: { all: true }, to: true });
    const paused = planTurn({ ...base, state, seed: "p", intent: null });
    expect(paused.elapsedMinutes).toBe(0);
    state = fold(reg, world, state, paused.events);
    expect(planTurn({ ...base, state, seed: "p2", intent: null }).elapsedMinutes).toBe(0);
  });
});

describe("timelapse targets", () => {
  test("parse and resolve: durations, day parts, absolute times, next shift and arrival", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s = startState(world); // Fri 08:00
    expect(parseTarget({ type: "duration", minutes: -5 })).toBeNull();
    expect(parseTarget({ type: "shift" })).toEqual({ type: "shift" });
    const at = (t: Parameters<typeof resolveTarget>[3]): number => {
      const r = resolveTarget(reg, world, s, t);
      if ("code" in r) throw new Error(r.reason);
      return r.to;
    };
    expect(at({ type: "duration", minutes: 90 })).toBe(s.clock + 90);
    expect(at({ type: "day_part", dayPart: "evening" })).toBe(18 * 60);
    expect(at({ type: "shift" })).toBe(9 * 60);
    s.clock = 10 * 60;
    expect(at({ type: "shift" })).toBe(3 * 1440 + 9 * 60); // next Monday
    expect("code" in resolveTarget(reg, world, s, { type: "arrival" })).toBe(true);
    s.entities[POV]!.fields.activity_until = 11 * 60;
    expect(at({ type: "arrival" })).toBe(11 * 60);
  });

  test("Calendar level 1 rounds a time target up to the next day part; level 0 has no timelapse", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s = startState(world);
    s.realism.levels.calendar = 1;
    const r = resolveTarget(reg, world, s, { type: "duration", minutes: 90 });
    expect("code" in r ? null : r.to).toBe(12 * 60);
    s.realism.levels.calendar = 0;
    expect("code" in resolveTarget(reg, world, s, { type: "duration", minutes: 90 })).toBe(true);
  });

  test("a paused clock refuses a timelapse until resumed", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s = startState(world);
    applyMarker(s, { kind: "time", control: "pause", scope: { all: true }, to: true });
    const out = runTimelapse(reg, new Working(reg, world, s), { type: "duration", minutes: 60 }, { runSeed: "r" });
    expect("code" in out && out.code).toBe("paused");
  });

  test("the timelapse intent runs through the pipeline: summary event, elapsed time, a coarsened record", () => {
    const world = timeWorld();
    const reg = registryOf([payPack]);
    world.entities.acct = { id: "acct", kind: "person", name: "Checking", tier: "background", fields: { owner: POV }, relations: [] };
    const s0 = startState(world);
    const plan = planTurn({ registry: reg, world, state: s0, runSeed: "run", seed: "x", kind: "normal", userTexts: ["/timelapse 3 days"], intent: timelapseIntent({ type: "duration", minutes: 3 * 1440 }) });
    expect(plan.elapsedMinutes).toBe(3 * 1440);
    expect(plan.events.filter((e) => e.type === "timelapse")).toHaveLength(1);
    const after = fold(reg, world, s0, plan.events);
    expect(after.clock).toBe(s0.clock + 3 * 1440);
    expect(trialBalance(after)).toBe(0);
    // Montage money equals the ledger totals for the interval
    const m = plan.montage;
    expect(m?.money).toEqual([{ account: "acct", label: "Checking", in: 30000, out: 7500 }]);
    expect(after.accounts.acct).toBe(30000 - 7500);
    expect(m?.groups[0]?.lines.filter((l) => l.startsWith("Rent paid"))).toHaveLength(3);
  });
});

describe("speed through", () => {
  test("offer elapses only the action and offers the rest; auto runs the night; short spans elapse", () => {
    const world = timeWorld();
    const reg = registryOf();
    const s0 = startState(world);
    s0.clock = 22 * 60;
    const input = { registry: reg, world, runSeed: "run", seed: "b", kind: "normal" as const, userTexts: ["I go to bed"], intent: { action: "bed", params: {}, probabilities: {} } };
    const offer = planTurn({ ...input, state: s0 });
    expect(offer.elapsedMinutes).toBe(5);
    expect(offer.chips).toEqual([{ kind: "timelapse_offer", activity: "sleep", target: { type: "at", at: 1440 + 420 }, remaining: 1440 + 420 - (22 * 60 + 5) }]);
    const auto = structuredClone(s0);
    applyMarker(auto, { kind: "time", control: "speed_through", scope: { activity: "sleep" }, to: { mode: "auto", thresholdMinutes: 30 } });
    const ran = planTurn({ ...input, state: auto });
    expect(ran.timelapse).not.toBeNull();
    expect(fold(reg, world, auto, ran.events).clock).toBe(1440 + 420);
    expect(speedThrough(auto, "sleep", 20)).toBe("elapse");
  });
});

describe("the time.advance channel", () => {
  test("under the cap it applies whole like a timelapse the story holds the POV through, with every class at note (L28)", () => {
    const world = timeWorld();
    const reg = registryOf([payPack]);
    world.entities.acct = { id: "acct", kind: "person", name: "Checking", tier: "background", fields: { owner: POV }, relations: [] };
    const s0 = startState(world);
    const a = new Working(reg, world, s0);
    expect(applyTimeAdvance(reg, a, 600, { runSeed: "run", capMinutes: 720 }).applied).toBe(true);
    const b = new Working(reg, world, s0);
    runTimelapse(reg, b, { type: "duration", minutes: 600 }, { runSeed: "run", overrides: ALL_NOTE, povRoutine: false });
    const strip = (s: WorldState): string => hashJson(s);
    expect(strip(a.state)).toBe(strip(b.state));
    // The narration told what the POV did in the skip: its shift (09:00 to 17:00) never moved it.
    expect(a.events.some((e) => e.type === "set" && e.entity === POV && e.field === "activity")).toBe(false);
    const lapsed = new Working(reg, world, s0);
    runTimelapse(reg, lapsed, { type: "duration", minutes: 600 }, { runSeed: "run", overrides: ALL_NOTE });
    expect(lapsed.events.some((e) => e.type === "set" && e.entity === POV && e.field === "activity")).toBe(true);
  });

  test("over the cap, or past the unit cap, nothing applies and a Timelapse chip is offered", () => {
    const world = timeWorld();
    const reg = registryOf([payPack]);
    world.entities.acct = { id: "acct", kind: "person", name: "Checking", tier: "background", fields: { owner: POV }, relations: [] };
    const s0 = startState(world);
    const w = new Working(reg, world, s0);
    const over = applyTimeAdvance(reg, w, 2000, { runSeed: "run", capMinutes: 720 });
    expect([over.applied, over.reason, over.chip?.target]).toEqual([false, "over_cap", { type: "duration", minutes: 2000 }]);
    const capped = applyTimeAdvance(reg, w, 700, { runSeed: "run", capMinutes: 720, unitCap: { agentDays: 0.3, events: 5000 } });
    expect([capped.applied, capped.reason]).toEqual([false, "unit_cap"]);
    expect(w.events).toEqual([]);
    expect(w.state).toEqual(s0);
  });

  test("lint helper: the smallest cap that fits one slot for every agent plus the POV", () => {
    const world = timeWorld();
    expect(minimumUnitCap(world, startState(world))).toBe((2 * 360) / 1440);
  });
});

describe("the clock's ✎ fix (DESIGN §9.2, §12)", () => {
  /** The pay pack pays at noon (the morning slot's end); Dev spends 10:00 to 16:00 at Sam's home every day. */
  function fixWorld(): { world: WorldDoc; reg: Registry; s0: WorldState } {
    const world = timeWorld();
    world.entities.acct = { id: "acct", kind: "person", name: "Checking", tier: "background", fields: { owner: POV }, relations: [] };
    world.schedules.visit = { id: "visit", owner: "dev", target: "place", recurrence: { every: "week", weekdays: [0, 1, 2, 3, 4, 5, 6] }, slots: [{ start: "10:00", end: "16:00", value: "home" }] };
    return { world, reg: registryOf([payPack]), s0: startState(world) };
  }

  /** The state once the clock's ✎ sets a local `YYYY-MM-DD HH:MM` (the POV's place keeps the world's own time zone). */
  function fixed(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, at: string): WorldState {
    const fix = clockFix(reg, world, state, at, "run");
    if ("code" in fix) throw new Error(fix.reason);
    return fold(reg, world, state, fix.events);
  }

  test("later, the time passes as a timelapse to then with every class at note does (L28), the story holding the POV, recorded as one unit", () => {
    const { world, reg, s0 } = fixWorld();
    const fix = clockFix(reg, world, s0, "2026-10-16 14:00", "run");
    if ("code" in fix) throw new Error(fix.reason);
    // One unit: a rebased view, a held write or a Re-run keeps or drops the whole of it.
    expect([...new Set(fix.events.map((e) => e.group))]).toEqual([expect.stringMatching(/^time:/)]);
    const after = fold(reg, world, s0, fix.events);
    const lapsed = new Working(reg, world, s0);
    runTimelapse(reg, lapsed, { type: "at", at: 14 * 60 }, { runSeed: "run", overrides: ALL_NOTE, povRoutine: false });
    expect([after.clock, after.accounts, after.entities]).toEqual([lapsed.state.clock, lapsed.state.accounts, lapsed.state.entities]);
    expect([after.accounts.acct, placeOfEntity(after, "dev")]).toEqual([7500, "home"]);
  });

  test("earlier, the clock goes back: nothing that ran up to where it stood is undone or runs again (L48), and past there the world steps as it would have", () => {
    const { world, reg, s0 } = fixWorld();
    const ran = fixed(reg, world, s0, "2026-10-16 14:00");
    // Back to 09:00, before the noon pay and Dev's 10:00 visit: both stand.
    const back = fixed(reg, world, ran, "2026-10-16 09:00");
    expect([back.clock, back.accounts.acct, placeOfEntity(back, "dev")]).toEqual([9 * 60, 7500, "home"]);
    // The GM sends Dev back to the cafe. Passing 10:00 and noon again pays nothing and moves no one,
    // by turns, a Timelapse, a narrated advance or the ✎ again.
    const moved = fold(reg, world, back, [{ type: "set", entity: "dev", field: "place", value: "cafe" }]);
    let turns = moved;
    for (let i = 0; turns.clock < 14 * 60; i++) {
      const plan = planTurn({ registry: reg, world, state: turns, runSeed: "run", seed: `wait${i}`, kind: "normal", userTexts: ["I wait."], intent: null });
      const planned = fold(reg, world, turns, plan.events);
      turns = fold(reg, world, planned, postTurn({ registry: reg, world, state: planned, runSeed: "run", seed: `wait${i}`, appliedMinutes: plan.elapsedMinutes, extracted: [] }));
    }
    const lapse = new Working(reg, world, moved);
    runTimelapse(reg, lapse, { type: "at", at: 14 * 60 }, { runSeed: "run" });
    const narrated = new Working(reg, world, moved);
    expect(applyTimeAdvance(reg, narrated, 5 * 60, { runSeed: "run", capMinutes: 720 }).applied).toBe(true);
    const again = fixed(reg, world, moved, "2026-10-16 14:00");
    for (const s of [turns, lapse.state, narrated.state, again]) expect([s.clock, s.accounts.acct, placeOfEntity(s, "dev")]).toEqual([14 * 60, 7500, "cafe"]);
    // Past where the clock had stood, the world steps as it would have: the next noon pays, and Dev visits at 10:00.
    const next = fixed(reg, world, again, "2026-10-17 12:00");
    expect([next.accounts.acct, placeOfEntity(next, "dev")]).toEqual([15000, "home"]);
    expect(trialBalance(next)).toBe(0);
  });

  test("a second set-back inside the window keeps how far the clock had run", () => {
    const { world, reg, s0 } = fixWorld();
    const back = fixed(reg, world, fixed(reg, world, fixed(reg, world, s0, "2026-10-16 14:00"), "2026-10-16 11:00"), "2026-10-16 09:00");
    expect([back.clock, ranTo(back)]).toEqual([9 * 60, 14 * 60]);
    expect(fixed(reg, world, back, "2026-10-16 13:00").accounts.acct).toBe(7500);
  });

  test("it reads the world's calendar where the POV is, and refuses with why: no such day, before the story starts, past the unit cap or the timelapse reach, Calendar & time off", () => {
    const { world, reg, s0 } = fixWorld();
    const refusal = (state: Readonly<WorldState>, at: string): string => {
      const fix = clockFix(reg, world, state, at, "run");
      return "code" in fix ? fix.reason : "applied";
    };
    expect(refusal(s0, "2026-02-30 10:00")).toContain("isn't a date and time of day");
    expect(refusal(s0, "2026-10-16 07:59")).toBe("the story starts at Fri 16 Oct 2026, 8:00 AM");
    const tight = structuredClone(s0);
    tight.time.unitCap = { agentDays: 1, events: 5000 };
    expect(refusal(tight, "2026-10-20 08:00")).toContain("a Timelapse to that time gets there in steps");
    expect(refusal(s0, "2027-12-01 08:00")).toBe("the clock moves on at most 366 days at a time");
    const off = structuredClone(s0);
    off.realism.levels.calendar = 0;
    expect(refusal(off, "2026-10-16 09:00")).toBe("Calendar & time is off");
    // Already that time: nothing to record.
    expect(clockFix(reg, world, s0, "2026-10-16 08:00", "run")).toEqual({ events: [] });
  });
});

describe("post steps and the montage filter", () => {
  test("post runs turn rules and tracks; the montage hides secret signals", () => {
    const world = timeWorld();
    world.rules.turnly = { id: "turnly", on: { tick: "turn" }, do: [{ type: "add", args: { entity: POV, field: "skill", delta: 1 } }] };
    const reg = registryOf();
    const s0 = startState(world);
    const events = postTurn({ registry: reg, world, state: s0, runSeed: "r", seed: "s", appliedMinutes: 2, extracted: [] });
    expect(fold(reg, world, s0, events).entities[POV]?.fields.skill).toBe(3);
    const m = buildMontage(reg, world, s0, s0, [
      { type: "engine.signal", data: { class: "incident", text: "public news" } },
      { type: "engine.signal", data: { class: "incident", text: "gm only", visibility: "secret" } },
    ], "key");
    expect(m.groups.flatMap((g) => g.lines)).toEqual(["public news"]);
    void createRng;
  });
});
