import { describe, expect, test } from "bun:test";
import { actionOdds, checkOdds, NO_BAND, resolveAction, resolveOn, rollCheck } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import type { ActionDef, CheckDef } from "../../src/shared/world";
import type { PackDef } from "../../src/engine/registry";
import { enumerateOutcomes, withoutAmbient } from "./support";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

const lockCheck: CheckDef = {
  id: "lock",
  dice: "2d6",
  modifier: "self.skill - here.security",
  bands: [
    { outcome: "fail", max: 6 },
    { outcome: "partial", min: 7, max: 9 },
    { outcome: "success", min: 10 },
  ],
};

const pickLock: ActionDef = {
  id: "pick_lock",
  label: "Pick the lock",
  params: {},
  requires: ["self.skill >= 1"],
  check: "lock",
  outcomes: {
    fail: [{ type: "add", args: { entity: "self", field: "stress", delta: 10 } }],
    partial: [{ type: "add", args: { entity: "self", field: "stress", delta: 5 } }, { type: "set", args: { entity: "self", field: "activity", value: "picking" } }],
    success: [{ type: "set", args: { entity: "self", field: "activity", value: "inside" } }],
  },
  duration: "10 + 5 * (self.skill < 3)",
  observable: "fiddles with a lock",
};

function lockWorld() {
  const world = baseWorld();
  world.checks.lock = lockCheck;
  world.actions.pick_lock = pickLock;
  world.actions.give_cash = {
    id: "give_cash",
    label: "Give cash",
    params: { to: { type: "ref", ref: "person" }, amount: { type: "money" } },
    requires: ["self.cash >= amount"],
    outcomes: {
      default: [
        { type: "add", args: { entity: "self", field: "cash", delta: "=-amount" } },
        { type: "add", args: { entity: "to", field: "cash", delta: "=amount" } },
      ],
    },
    duration: "1",
  };
  world.actions.sleep = { id: "sleep", label: "Sleep", params: {}, requires: [], outcomes: { default: [] }, duration: "5", activity: { type: "sleep", until: "next_time('07:00')" } };
  return world;
}

describe("checks: shown odds are the real odds", () => {
  test("exact enumeration of the roll equals the displayed distribution, for several modifiers", () => {
    for (const modifier of [-3, 0, 1, 4]) {
      const outcomes = ["fail", "partial", "success", NO_BAND];
      const real = enumerateOutcomes((rng) => outcomes.indexOf(rollCheck(lockCheck, modifier, rng).outcome));
      const shown = checkOdds(lockCheck, modifier);
      for (const [i, name] of outcomes.entries()) expect(real.get(i) ?? 0).toBeCloseTo(shown[name] ?? 0, 12);
      expect(Object.values(shown).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  test("the palette's odds use the same modifier the resolution rolls with", () => {
    const world = lockWorld();
    const reg = registryOf();
    const state = startState(world);
    const shown = actionOdds(reg, world, state, { action: "pick_lock" });
    expect(shown.available).toBe(true);
    expect(shown.modifier).toBe(0); // skill 2 − home security 2
    expect(shown.duration).toBe(15);
    const counts: Record<string, number> = {};
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const { resolution } = resolveOn(reg, world, state, { action: "pick_lock" }, createRng(`trial:${i}`));
      expect(resolution.check?.modifier).toBe(0);
      counts[resolution.outcome ?? ""] = (counts[resolution.outcome ?? ""] ?? 0) + 1;
    }
    for (const [outcome, p] of Object.entries(shown.odds ?? {})) expect(Math.abs((counts[outcome] ?? 0) / trials - p)).toBeLessThan(0.03);
  });

  test("bands with gaps report the uncovered mass under `none`", () => {
    const gappy: CheckDef = { id: "g", dice: "1d6", bands: [{ outcome: "low", max: 2 }, { outcome: "high", min: 5 }] };
    const odds = checkOdds(gappy, 0);
    expect(Object.keys(odds).sort()).toEqual(["high", "low", "none"]);
    for (const p of Object.values(odds)) expect(p).toBeCloseTo(1 / 3, 12);
  });
});

describe("resolution", () => {
  test("requirements gate the action and nothing applies", () => {
    const world = lockWorld();
    world.entities[POV]!.fields.skill = 0;
    const reg = registryOf();
    const { resolution, state } = resolveOn(reg, world, startState(world), { action: "pick_lock" }, createRng("x"));
    expect(resolution.ok).toBe(false);
    expect(resolution.failed?.requirement).toBe("self.skill >= 1");
    expect(resolution.events).toEqual([]);
    expect(state.entities[POV]?.fields.stress).toBeUndefined();
  });

  test("effects become concrete events: deltas for accumulators, final values for assignments", () => {
    const world = lockWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const r = resolveAction(reg, w, { action: "give_cash", params: { to: "dev", amount: 300 } }, createRng("s"));
    expect(r.ok).toBe(true);
    expect(r.events).toEqual([
      { type: "add", entity: POV, field: "cash", delta: -300 },
      { type: "add", entity: "dev", field: "cash", delta: 300 },
    ]);
    expect(w.state.entities.dev?.fields.cash).toBe(1200);
  });

  test("ref params are checked by kind; missing params are refused", () => {
    const world = lockWorld();
    const reg = registryOf();
    const state = startState(world);
    expect(resolveOn(reg, world, state, { action: "give_cash", params: { amount: 1 } }, createRng("a")).resolution.failed?.code).toBe("missing_param");
    expect(resolveOn(reg, world, state, { action: "give_cash", params: { to: "nobody", amount: 1 } }, createRng("a")).resolution.failed?.code).toBe("bad_param");
    expect(resolveOn(reg, world, state, { action: "give_cash", params: { to: "dev", amount: 99999 } }, createRng("a")).resolution.failed?.code).toBe("requirement");
  });

  test("accumulators clamp to the field's range (the delta shrinks)", () => {
    const world = lockWorld();
    world.entities[POV]!.fields.stress = 98;
    world.entities[POV]!.fields.skill = 1;
    world.places.home!.fields.security = 20; // always fails
    const reg = registryOf();
    const { resolution, state } = resolveOn(reg, world, startState(world), { action: "pick_lock" }, createRng("c"));
    expect(resolution.outcome).toBe("fail");
    expect(resolution.events).toEqual([{ type: "add", entity: POV, field: "stress", delta: 2 }]);
    expect(state.entities[POV]?.fields.stress).toBe(100);
  });

  test("an activity records its type and end; the duration is read before the effects", () => {
    const world = lockWorld();
    const reg = registryOf();
    const { resolution, state } = resolveOn(reg, world, startState(world), { action: "sleep" }, createRng("z"));
    expect(resolution.duration).toBe(5);
    expect(resolution.activity).toEqual({ type: "sleep", until: 1440 + 420 });
    expect(state.entities[POV]?.fields.activity).toBe("sleep");
    expect(state.entities[POV]?.fields.activity_until).toBe(1440 + 420);
  });

  test("same seed, same resolution; no ambient randomness or time", () => {
    const world = lockWorld();
    const reg = registryOf();
    const state = startState(world);
    const a = withoutAmbient(() => resolveOn(reg, world, state, { action: "pick_lock" }, createRng("seed-1")));
    const b = withoutAmbient(() => resolveOn(reg, world, state, { action: "pick_lock" }, createRng("seed-1")));
    expect(a).toEqual(b);
  });

  test("participants materialize ahead of the action's effects, once", () => {
    let calls = 0;
    const pack: PackDef = {
      id: "detail",
      label: "Detail",
      version: 1,
      domain: "gear",
      requires: [],
      register(r) {
        r.materializer({
          domain: "gear",
          version: 3,
          materialize: (entity, _ctx, rng) => {
            calls++;
            return [{ type: "set", entity, field: "skill", value: 2 + rng.int(0, 0) }];
          },
        });
      },
    };
    const world = lockWorld();
    const reg = registryOf([pack]);
    const w = new Working(reg, world, startState(world));
    const r = resolveAction(reg, w, { action: "pick_lock" }, createRng("m"), { runSeed: "run" });
    expect(r.events[0]?.type).toBe("materialize");
    expect(w.state.materialized[`${POV}:gear`]).toEqual({ generatorVersion: 3, tablesRevision: expect.any(String) });
    resolveAction(reg, w, { action: "pick_lock" }, createRng("m2"), { runSeed: "run" });
    expect(calls).toBe(1);
  });
});
