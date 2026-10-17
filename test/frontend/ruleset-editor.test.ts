import { describe, expect, test } from "bun:test";
import { moved, parseThresholds, progressionFields, rowChoices, sectionId, tidyRuleset } from "../../src/frontend/build/ruleset-editor";
import { sheetPreviewRequest } from "../../src/frontend/requests";
import { previewSheet } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { RulesetDef, WorldDoc } from "../../src/shared/world";
import { baseWorld } from "../packs/support";

/** A world whose POV is a hero: an inherited field, a derived one and a pool. */
function heroWorld(): WorldDoc {
  const world = baseWorld();
  world.kinds.hero = {
    id: "hero",
    label: "Hero",
    extends: "person",
    fields: {
      might: { type: "number", label: "Might", default: 14 },
      might_mod: { type: "number", label: "Might mod", derived: "floor((self.might - 10) / 2)" },
      hp: { type: "number", label: "Hit points", pool: { max: "10 + self.might_mod" } },
      xp: { type: "number", default: 350 },
      level: { type: "number", default: 1 },
    },
  };
  const pov = world.entities[world.pov];
  if (pov) pov.kind = "hero";
  return world;
}

describe("Sheet Designer helpers", () => {
  test("moving a row or section swaps it with its neighbour and stops at either end", () => {
    expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  test("a new section's id comes from its label and never repeats one already taken", () => {
    expect(sectionId("Skills & Feats", [])).toBe("skills_feats");
    expect(sectionId("Skills", ["skills"])).toBe("skills_2");
    expect(sectionId("Skills", ["skills", "skills_2"])).toBe("skills_3");
    expect(sectionId("!!!", [])).toBe("section");
  });

  test("rows offer the POV kind's own, inherited and derived fields, its pools, and the progressions as edited", () => {
    const choices = rowChoices(heroWorld(), { character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300] } });
    const fields = choices.fields.map((c) => c.value);
    expect(fields).toContain("might");
    expect(fields).toContain("might_mod");
    expect(fields).toContain("skill");
    expect(choices.fields.find((c) => c.value === "might_mod")?.label).toContain("derived");
    expect(choices.pools.map((c) => c.value)).toEqual(["hp"]);
    expect(choices.progressions.map((c) => c.value)).toEqual(["character"]);
  });

  test("an emptied sheet, progression or floor set saves as no such part, and other ruleset keys are kept", () => {
    const ruleset = { sheet: { sections: [] }, progression: {}, minLevels: {}, adjudication: { mode: "check" } } as unknown as RulesetDef;
    expect(tidyRuleset(ruleset)).toEqual({ adjudication: { mode: "check" } });
    expect(tidyRuleset({ sheet: { sections: [] } })).toEqual({});
  });

  test("the live preview asks for the edited ruleset on the draft, and the engine builds the POV's sheet from it", () => {
    const world = heroWorld();
    const ruleset: RulesetDef = {
      progression: { character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300, 900] } },
      sheet: { sections: [{ id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { progression: "character" }, { field: "might_mod" }, { formula: "self.might * 2", label: "Twice might" }] }] },
    };
    const request = sheetPreviewRequest(world.id, tidyRuleset(ruleset));
    expect(request).toEqual({ type: "lre.world", op: "sheet", worldId: world.id, ruleset: tidyRuleset(ruleset) });
    expect(sheetPreviewRequest(world.id, {}, "dev")).toMatchObject({ entity: "dev" });
    const sheet = previewSheet(createRegistry(ALL_PACKS), { ...world, ruleset: request.op === "sheet" ? (request.ruleset as unknown as RulesetDef) : undefined });
    expect(sheet?.[0]?.rows.map((r) => [r.label, r.value])).toEqual([
      ["Hit points", "12 / 12"],
      ["Level", "1"],
      ["Might mod", "2"],
      ["Twice might", "28"],
    ]);
  });
});

describe("progression editor helpers", () => {
  test("XP and level pickers offer only number fields the engine can set, of the kind with its inherited fields", () => {
    const world = heroWorld();
    const ids = progressionFields(world, "hero").map((c) => c.value);
    expect(ids).toEqual(expect.arrayContaining(["might", "xp", "level", "hp", "skill", "stress"]));
    expect(ids).not.toContain("might_mod");
    expect(ids).not.toContain("activity");
    // With no kind named, any kind's number fields, each once.
    const any = progressionFields(world, undefined).map((c) => c.value);
    expect(any).toContain("xp");
    expect(new Set(any).size).toBe(any.length);
  });

  test("thresholds read as numbers separated by commas or spaces, and anything else is refused", () => {
    expect(parseThresholds("0, 300, 900")).toEqual([0, 300, 900]);
    expect(parseThresholds("0 300\n900;2700")).toEqual([0, 300, 900, 2700]);
    expect(parseThresholds("")).toEqual([]);
    expect(parseThresholds("0, three")).toBeNull();
  });
});
