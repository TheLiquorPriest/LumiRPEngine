// Build's Character page (DESIGN §13 characters): a person opens it, never the generic editor; an
// edit saves as a draft patch of only what changed (choosing a bed writes `bed` and nothing else);
// relations show by group.

import { describe, expect, test } from "bun:test";
import { bedValue } from "../../src/frontend/character/bed-picker";
import { employerPicker, entityFormSpecs, entityPatch, opensCharacterPage, relationGroups } from "../../src/frontend/build/character-model";
import type { JsonObject } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { createRegistry } from "../../src/engine/registry-impl";
import { modernUsWorld } from "../packs/riverton";

const reg = createRegistry(ALL_PACKS);

/** The draft as Build holds it: the packs' kinds beside the world's own. */
function draft(): WorldDoc {
  const world = modernUsWorld("w", "Riverton");
  return { ...world, kinds: { ...Object.fromEntries(reg.kinds), ...world.kinds } };
}

describe("Build's Character page", () => {
  test("a person opens the Character page; a thing, a new entity and a place keep their editors", () => {
    const doc = draft();
    expect(opensCharacterPage(doc, "entities", "you")).toBe(true);
    expect(opensCharacterPage(doc, "entities", "maya")).toBe(true);
    expect(opensCharacterPage(doc, "entities", "phone")).toBe(false);
    expect(opensCharacterPage(doc, "entities", "new:sam")).toBe(false);
    expect(opensCharacterPage(doc, "places", "apartment")).toBe(false);
  });

  test("choosing a bed saves a patch that writes bed and nothing else, and sleeping at home clears it", () => {
    const doc = draft();
    const before = structuredClone(doc.entities.you) as unknown as JsonObject;
    const fields = before.fields as JsonObject;
    const bed = bedValue({ kind: "place", place: { id: "apartment", name: "Apartment", path: [], parent: null, visibility: "public" }, item: null });
    const after: JsonObject = { ...before, fields: { ...fields, bed } };
    const ops = entityPatch("you", before, after);
    expect(ops).toEqual([{ op: "add", path: "/entities/you/fields/bed", value: "apartment" }]);
    const patched = applyPatch(structuredClone(doc) as unknown as JsonObject, ops) as unknown as WorldDoc;
    expect(patched.entities.you?.fields.bed).toBe("apartment");
    expect({ ...patched.entities.you, fields: { ...patched.entities.you?.fields, bed: undefined } }).toEqual({ ...doc.entities.you, fields: { ...doc.entities.you?.fields, bed: undefined } } as never);
    expect(bedValue({ kind: "home", place: null, item: null })).toBeNull();
    expect(entityPatch("you", after, before)).toEqual([{ op: "remove", path: "/entities/you/fields/bed" }]);
    expect(entityPatch("you", before, structuredClone(before))).toEqual([]);
  });

  test("relations group as family, feelings, groups and other, and what holds them stays out", () => {
    const groups = relationGroups([
      { type: "spouse_of", to: "maya" },
      { type: "regard", to: "jordan", fields: { warmth: 40 } },
      { type: "member_of", to: "union" },
      { type: "mentor_of", to: "rosa" },
      { type: "in", to: "car" },
    ]);
    expect(Object.fromEntries(Object.entries(groups).map(([g, rows]) => [g, rows.map((r) => `${r.index}:${r.to}`)]))).toEqual({ family: ["0:maya"], feelings: ["1:jordan"], groups: ["2:union"], other: ["3:rosa"] });
  });

  test("a thing's page leaves out what only a person has; a person's keeps it", () => {
    const doc = draft();
    const keys = (id: string): string[] => entityFormSpecs(doc, doc.entities[id] as unknown as JsonObject).map((s) => s.key);
    for (const key of ["life", "characterId", "cues", "agent"]) {
      expect(keys("phone")).not.toContain(key);
      expect(keys("maya")).toContain(key);
    }
    expect(keys("phone")).toContain("visibility");
  });

  test("Works for shows a workplace under A place and a business under A business, from the world alone", () => {
    const doc = draft();
    // The office is a place, Brightline a business; a page opening before its model arrives shows each where it is.
    expect(employerPicker(doc, "office")).toBe("place");
    expect(employerPicker(doc, "brightline")).toBe("business");
    expect(employerPicker(doc, "")).toBe("place");
    expect(employerPicker(doc, "gone_shop")).toBe("business");
  });
});
