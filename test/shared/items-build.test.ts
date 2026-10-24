// Build's item helpers (DESIGN §13): "Reveal this item" writes a thing the world can hide and the
// player can find, and an objective picked for a thing names ids the world has, so both lint clean.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/engine/registry-impl";
import { lintStructure } from "../../src/engine/world-lint";
import { authoredContents, itemObjective, revealScaffold } from "../../src/shared/items-build";
import type { JsonObject } from "../../src/shared/json";
import type { EntityDef } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";

const reg = createRegistry(ALL_PACKS);

describe("Build's item helpers", () => {
  test("the reveal helper's thing lints clean, and one lying nowhere is refused", () => {
    const world = modernUsWorld("w", "Riverton");
    const ring = { id: "ring", kind: "item", name: "Silver ring", tier: "background", fields: { place: "apartment" }, relations: [] };
    const made = revealScaffold(ring);
    if (!("entity" in made)) throw new Error(made.problem);
    world.entities.ring = made.entity as unknown as EntityDef;
    expect(made.entity.visibility).toBe("discoverable");
    expect(lintStructure(world, reg).filter((i) => i.path.startsWith("entities.ring"))).toEqual([]);
    expect(authoredContents(world, "apartment", "places")).toContainEqual({ id: "ring", name: "Silver ring", hidden: true });
    expect("problem" in revealScaffold({ ...ring, fields: {} } as JsonObject)).toBe(true);
  });

  test("an item check picked for an objective names ids the quest lint finds", () => {
    const world = modernUsWorld("w", "Riverton");
    const stage = world.tracks.first_week?.stages.coffee;
    if (!stage) throw new Error("no stage");
    const phone = { id: "phone", name: "Phone" };
    stage.objectives = [itemObjective("carries", phone), itemObjective("at", phone, { id: "cafe", name: "Café" }), itemObjective("has_item", phone)];
    expect(lintStructure(world, reg).filter((i) => i.path.startsWith("tracks.first_week"))).toEqual([]);
  });
});
