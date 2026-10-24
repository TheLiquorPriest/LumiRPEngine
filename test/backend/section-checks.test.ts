// What a time skip's Montage tells (DESIGN §9.2) and the checks on sections: a preset that places
// some of the world's section outlets but not all (DESIGN §6.8), and a section nothing fills.

import { describe, expect, test } from "bun:test";
import { planLines } from "../../src/backend/runtime";
import { presetCaveats } from "../../src/backend/preset-lint";
import { lintWorld } from "../../src/engine/authoring";
import type { PackDef } from "../../src/engine/registry";
import { planTurn, timelapseIntent } from "../../src/engine/turn";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

/** Stress climbs from calm to frantic on the skip's second step. */
const stressPack: PackDef = {
  id: "stresstest",
  label: "Stress test",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.process({
      id: "stresstest.climb",
      domain: "castlife",
      minLevel: 1,
      step(slot) {
        return slot.index === 1 ? [{ type: "add", entity: POV, field: "stress", delta: 80 }] : [];
      },
    });
  },
};

describe("the Montage", () => {
  test("a band crossed during a time skip reaches it", () => {
    const world = baseWorld();
    const reg = registryOf([stressPack]);
    const s0 = startState(world);
    const plan = planTurn({ registry: reg, world, state: s0, runSeed: "run", seed: "x", kind: "normal", userTexts: ["/timelapse 1 day"], intent: timelapseIntent({ type: "duration", minutes: 1440 }) });
    expect(plan.montage?.bands.length).toBeGreaterThan(0);
    const montage = planLines(plan, world, reg).montage;
    expect(montage.some((l) => l.includes("calm") && l.includes("frantic"))).toBe(true);
  });
});

describe("section checks", () => {
  const run = { blocks: [], maxTokens: null, model: "deepseek-v4-flash" };
  const sections = [
    { outlet: "lre_scene", label: "Scene" },
    { outlet: "lre_people", label: "People" },
    { outlet: "lre_outcome", label: "Outcome" },
  ];

  test("a preset placing some of the world's section outlets but not all is flagged, naming the missing one", () => {
    const found = presetCaveats(run, "Mine", { outlets: new Set(["lre_scene", "lre_outcome", "lre_narrator"]), sections });
    expect(found.map((c) => c.code)).toEqual(["preset_partial_outlets"]);
    expect(found[0]?.message).toContain("lre_people");
    expect(found[0]?.message).not.toContain("lre_scene");
    // Placing all of them, or none, is a whole layout.
    expect(presetCaveats(run, "Mine", { outlets: new Set(sections.map((s) => s.outlet)), sections })).toEqual([]);
    expect(presetCaveats(run, "Mine", { outlets: new Set(["lre_narrator"]), sections })).toEqual([]);
  });

  test("a custom section nothing fills is linted; a fed one isn't", () => {
    const world = baseWorld();
    const position = { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } as const;
    world.sections = {
      weather: { id: "weather", label: "Weather", rank: 3, template: "{{lines}}", position },
      outcome: { id: "outcome", label: "Outcome", rank: 0, template: "{{lines}}", position },
    };
    const unfed = lintWorld(world, registryOf()).filter((i) => i.code === "section_unfed");
    expect(unfed.map((i) => i.path)).toEqual(["sections.weather"]);
  });
});
