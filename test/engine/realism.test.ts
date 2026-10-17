import { describe, expect, test } from "bun:test";
import { applyMarker } from "../../src/engine/events";
import type { PackDef } from "../../src/engine/registry";
import { effectiveLevel } from "../../src/engine/registry-impl";
import { fieldLive, levelContract, presetOf, previewLevelChange, realismMarkers, REALISM_PRESETS } from "../../src/engine/realism";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

const moneyPack: PackDef = {
  id: "moneytest",
  label: "Money test",
  version: 1,
  domain: "money",
  requires: [],
  register(r) {
    r.kind({ id: "spender", label: "Spender", extends: "person", fields: { wealth: { type: "enum", values: ["poor", "rich"], domain: "money", level: 1 }, balance: { type: "money", domain: "money", level: 2 }, apr: { type: "number", domain: "money", level: 4 } } });
    r.materializer({ domain: "money", version: 1, materialize: () => [] });
    r.process({ id: "moneytest.interest", domain: "money", minLevel: 4, step: () => [] });
  },
};

describe("realism", () => {
  test("presets match DESIGN §9.1 and round-trip through markers", () => {
    expect(REALISM_PRESETS.story.levels.space).toBe(2);
    expect(REALISM_PRESETS.simulation.tierCaps.background.money).toBe(2);
    for (const id of ["story", "grounded", "simulation"] as const) {
      const s = startState(baseWorld());
      for (const m of realismMarkers(REALISM_PRESETS[id])) applyMarker(s, m);
      expect(presetOf(s.realism)).toBe(id);
    }
    const s = startState(baseWorld());
    applyMarker(s, { kind: "resolve", domain: "money", scope: { all: true }, to: 3 });
    expect(presetOf(s.realism)).toBe("custom");
  });

  test("effective level = override (never above the domain), else min(domain, tier cap)", () => {
    const s = startState(baseWorld());
    for (const m of realismMarkers(REALISM_PRESETS.simulation)) applyMarker(s, m);
    expect(effectiveLevel(s, POV, "money")).toBe(4);
    expect(effectiveLevel(s, "dev", "money")).toBe(4); // principal cap 4
    s.entities.dev!.tier = "background";
    expect(effectiveLevel(s, "dev", "money")).toBe(2);
    s.entities.dev!.levels.money = 3;
    expect(effectiveLevel(s, "dev", "money")).toBe(3);
    applyMarker(s, { kind: "resolve", domain: "money", scope: { all: true }, to: 1 });
    expect(effectiveLevel(s, "dev", "money")).toBe(1);
  });

  test("a demotion preview lists predicates whose inputs freeze, and processes that switch off", () => {
    const world = baseWorld();
    world.entities[POV]!.kind = "spender";
    world.rules.rich = { id: "rich", on: { tick: "day" }, when: "pov.apr > 20 and pov.wealth == 'rich'", do: [] };
    world.actions.splurge = { id: "splurge", label: "Splurge", params: {}, requires: ["self.balance > 1000"], outcomes: { default: [] }, duration: "1" };
    const reg = registryOf([moneyPack]);
    const s = startState(world);
    for (const m of realismMarkers(REALISM_PRESETS.simulation)) applyMarker(s, m);
    const p = previewLevelChange(reg, world, s, { kind: "resolve", domain: "money", scope: { all: true }, to: 2 });
    expect(p.demoted.map((d) => d.entity).sort()).toEqual(["dev", POV].sort());
    expect(p.processesOff).toEqual(["moneytest.interest"]);
    expect(p.frozen.map((f) => [f.where, f.id, f.field])).toEqual([["rule", "rich", "apr"]]);
    const up = previewLevelChange(reg, world, startState(world), { kind: "resolve", domain: "money", scope: { all: true }, to: 4 });
    expect(up.materialize.map((m) => m.entity).sort()).toEqual(["dev", POV].sort());
  });

  test("level contracts: the fields live per level; fields stay in the state at every level (D18)", () => {
    const world = baseWorld();
    world.entities[POV]!.kind = "spender";
    world.entities[POV]!.fields.balance = 500;
    const reg = registryOf([moneyPack]);
    expect(levelContract(reg, world, "spender", "money")).toEqual({ 0: [], 1: ["wealth"], 2: ["balance", "wealth"], 3: ["balance", "wealth"], 4: ["apr", "balance", "wealth"] });
    const s = startState(world);
    expect(fieldLive(reg, world, s, POV, "balance")).toBe(false);
    expect(s.entities[POV]?.fields.balance).toBe(500);
    applyMarker(s, { kind: "resolve", domain: "money", scope: { all: true }, to: 2 });
    expect(fieldLive(reg, world, s, POV, "balance")).toBe(true);
  });
});
