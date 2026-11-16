// Levels follow experience as sums, level-ups are offered and never rolled when asked, and a stated value stands over a formula.
// Every name here is invented.

import { describe, expect, test } from "bun:test";
import { applyEffects } from "../../src/engine/effects";
import type { Registry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { formulaFigure, scopeEnv } from "../../src/engine/scope";
import { Working } from "../../src/engine/working";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

function levelsWorld(): WorldDoc {
  const world = baseWorld();
  const person = world.kinds.person;
  if (person) {
    person.fields.xp = { type: "number", default: 0 };
    person.fields.level = { type: "number", default: 1, min: 1, max: 20 };
    person.fields.perks = { type: "number", default: 0 };
    person.fields.ac = { type: "number", derived: "10 + self.level * 5" };
  }
  world.ruleset = { progression: { character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300, 900, 2700], onLevel: [{ type: "add", args: { entity: "self", field: "perks", delta: "=level * 10 + from" } }] } } };
  return world;
}

function working(): { w: Working; reg: Registry } {
  const world = levelsWorld();
  const reg = registryOf();
  return { w: new Working(reg, world, startState(world)), reg };
}

describe("levels as sums, offers and stated values", () => {
  test("with offers asked, experience that reaches level 3 sets level 3, runs no onLevel effect and offers levels 2 and 3's", () => {
    const { w, reg } = working();
    const out = applyEffects(reg, w, [{ type: "award", args: { entity: "self", progression: "character", amount: 1000 } }], { bindings: { self: POV }, rng: createRng("a"), offers: true });
    expect(out.rejected).toEqual([]);
    expect(w.state.entities[POV]?.fields.level).toBe(3);
    expect(w.state.entities[POV]?.fields.perks ?? 0).toBe(0);
    expect(out.applied.some((e) => e.type === "engine.note")).toBe(false);
    expect(out.offered?.map((o) => o.level)).toEqual([2, 3]);
  });

  test("a person spawned at level 5 with no experience keeps it and is advised; an unknown tier is refused with the tiers; no tier is handed back as filled in", () => {
    const { w, reg } = working();
    const scope = { bindings: { self: POV }, rng: createRng("b"), asGiven: true } as const;
    const bad = applyEffects(reg, w, [{ type: "spawn", args: { kind: "person", id: "odo", name: "Odo", tier: "nobody", fields: { level: 5 } } }], scope);
    expect(bad.rejected[0]?.rejection.code).toBe("bad_tier");
    expect(bad.rejected[0]?.rejection.choices?.length).toBeGreaterThan(0);
    const made = applyEffects(reg, w, [{ type: "spawn", args: { kind: "person", id: "odo", name: "Odo", fields: { level: 5 } } }], scope);
    expect(made.rejected).toEqual([]);
    expect(w.state.entities.odo?.fields.level).toBe(5);
    expect(made.advice?.map((a) => a.code)).toContain("level_beside_xp");
    expect(made.filled?.length).toBe(1);
  });

  test("armour class set to 18 reads 18 where the formula gives 15, the 15 is readable, and clearing it reads the formula again", () => {
    const { w, reg } = working();
    const read = (): unknown => scopeEnv({ reg, ctx: w.ctx, bindings: { self: POV } }).lookup(["self", "ac"]);
    expect(read()).toBe(15);
    const e = w.state.entities[POV];
    if (e) e.fields.ac = 18;
    expect(read()).toBe(18);
    expect(formulaFigure(reg, w.ctx, POV, "ac")).toBe(15);
    if (e) e.fields.ac = null;
    expect(read()).toBe(15);
  });
});
