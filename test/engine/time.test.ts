import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { applyMarker } from "../../src/engine/events";
import type { PackDef } from "../../src/engine/registry";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import { applyTimeAdvance, buildMontage, clockPaused, minimumUnitCap, parseTarget, pauseBookkeeping, resolveTarget, runTimelapse, speedThrough, tickMinutes, turnElapsed } from "../../src/engine/time";
import { planTurn, postTurn, timelapseIntent } from "../../src/engine/turn";
import { ALL_NOTE } from "../../src/engine/simulate";
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
  test("under the cap it applies whole like a timelapse with every class at note (L28)", () => {
    const world = timeWorld();
    const reg = registryOf([payPack]);
    world.entities.acct = { id: "acct", kind: "person", name: "Checking", tier: "background", fields: { owner: POV }, relations: [] };
    const s0 = startState(world);
    const a = new Working(reg, world, s0);
    expect(applyTimeAdvance(reg, a, 600, { runSeed: "run", capMinutes: 720 }).applied).toBe(true);
    const b = new Working(reg, world, s0);
    runTimelapse(reg, b, { type: "duration", minutes: 600 }, { runSeed: "run", overrides: ALL_NOTE });
    const strip = (s: WorldState): string => hashJson(s);
    expect(strip(a.state)).toBe(strip(b.state));
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
