import { describe, expect, test } from "bun:test";
import { readEngineSlice } from "../../src/engine/engine-pack";
import { CASCADE_CAP, runRulesOnEvents, runRulesOnTick } from "../../src/engine/rules";
import { Working } from "../../src/engine/working";
import type { RuleDef } from "../../src/shared/world";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";

function worldWith(rules: RuleDef[]) {
  const world = baseWorld();
  for (const r of rules) world.rules[r.id] = r;
  return world;
}

describe("rules", () => {
  test("an event rule fires with the event bound; `once` holds across later passes", () => {
    const world = worldWith([
      { id: "nervous", on: { event: "add" }, when: "event.field == 'cash' and event.delta < 0", do: [{ type: "add", args: { entity: "self", field: "stress", delta: 7 } }], once: true },
    ]);
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const spend = { type: "add" as const, entity: POV, field: "cash", delta: -10 };
    w.apply(spend);
    const first = runRulesOnEvents(reg, w, [spend], { seed: "s" });
    expect(first.map((f) => f.rule)).toEqual(["nervous"]);
    expect(w.state.entities[POV]?.fields.stress).toBe(7);
    w.apply(spend);
    expect(runRulesOnEvents(reg, w, [spend], { seed: "s" })).toEqual([]);
    expect(readEngineSlice(w.state).fired.nervous?.n).toBe(1);
  });

  test("cooldowns use the clock", () => {
    const world = worldWith([{ id: "tick", on: { tick: "turn" }, do: [{ type: "add", args: { entity: POV, field: "skill", delta: 1 } }], cooldownMinutes: 60 }]);
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    expect(runRulesOnTick(reg, w, "turn", { seed: "a" })).toHaveLength(1);
    w.apply({ type: "clock", minutes: 30, cause: "tick" });
    expect(runRulesOnTick(reg, w, "turn", { seed: "a" })).toHaveLength(0);
    w.apply({ type: "clock", minutes: 30, cause: "tick" });
    expect(runRulesOnTick(reg, w, "turn", { seed: "a" })).toHaveLength(1);
    expect(w.state.entities[POV]?.fields.skill).toBe(4);
  });

  test("a self-triggering cascade stops at the cap of 8 with a note", () => {
    const world = worldWith([{ id: "loop", on: { event: "add" }, when: "event.field == 'skill'", do: [{ type: "add", args: { entity: POV, field: "skill", delta: 1 } }] }]);
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const seed = { type: "add" as const, entity: POV, field: "skill", delta: 1 };
    w.apply(seed);
    const firings = runRulesOnEvents(reg, w, [seed], { seed: "c" });
    expect(firings).toHaveLength(CASCADE_CAP);
    expect(Math.max(...firings.map((f) => f.depth))).toBe(CASCADE_CAP - 1);
    expect(w.state.entities[POV]?.fields.skill).toBe(2 + 1 + CASCADE_CAP);
    expect(w.events.some((e) => e.type === "engine.note")).toBe(true);
  });

  test("place entry, time triggers, beats and interrupt tags", () => {
    const world = worldWith([
      { id: "arrive", on: { enter: "town" }, when: "self == pov", do: [{ type: "note", args: { text: "Welcome." } }], beat: { hint: "Someone waves from the counter." } },
      { id: "late", on: { at: "hour >= 22" }, do: [{ type: "signal", args: { class: "incident", text: "A siren wails." } }], once: true, interrupt: true },
    ]);
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const move = { type: "set" as const, entity: POV, field: "place", value: "cafe" };
    w.apply(move);
    const f = runRulesOnEvents(reg, w, [move], { seed: "e" });
    expect(f[0]?.beat?.hint).toBe("Someone waves from the counter.");
    expect(w.events.filter((e) => e.type === "engine.beat")).toHaveLength(1);
    expect(runRulesOnTick(reg, w, "slot", { seed: "e" })).toEqual([]);
    w.apply({ type: "clock", minutes: 15 * 60, cause: "tick" });
    const late = runRulesOnTick(reg, w, "slot", { seed: "e" });
    expect(late.map((x) => x.rule)).toEqual(["late"]);
    expect(late[0]?.interrupt).toBe(true);
    expect(late[0]?.events.filter((e) => e.type === "engine.signal").length).toBe(2);
  });

  test("rule events re-fold to the same state", () => {
    const world = worldWith([{ id: "r", on: { event: "set" }, when: "event.field == 'place'", do: [{ type: "add", args: { entity: "self", field: "stress", delta: 3 } }] }]);
    const reg = registryOf();
    const start = startState(world);
    const w = new Working(reg, world, start);
    const move = { type: "set" as const, entity: "dev", field: "place", value: "home" };
    w.apply(move);
    runRulesOnEvents(reg, w, [move], { seed: "f" });
    expect(fold(reg, world, start, w.events)).toEqual(w.state);
  });
});
