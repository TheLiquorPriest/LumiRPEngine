// Characters as their own model (DESIGN §7): a starter character's fields come in plain-worded
// sections, the bed picker's first choices are their home's rooms and the things lying there (the
// likeliest beds first), and a place shows the places around it.

import { describe, expect, test } from "bun:test";
import type { CharacterDTO } from "../../src/shared/character";
import type { WorldDoc } from "../../src/shared/world";
import { migrateWorld } from "../../src/engine/authoring";
import { buildCharacter, placeRefs } from "../../src/engine/character";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

async function portAlder(): Promise<WorldDoc> {
  return migrateWorld(await Bun.file(new URL("../../src/packs/starters/modern_slice_of_life.json", import.meta.url)).json());
}

function character(world: WorldDoc, id: string): CharacterDTO {
  const built = buildCharacter(reg, world, id);
  if (!built) throw new Error(`${id} isn't a character`);
  return built.character;
}

const section = (c: CharacterDTO, id: string) => c.sections.find((s) => s.id === id)?.fields ?? [];
const field = (c: CharacterDTO, id: string) => c.sections.flatMap((s) => s.fields).find((f) => f.id === id);

describe("the Character model", () => {
  test("a starter character's fields come in sections, labelled in plain words, a list of text as its items", async () => {
    const marcus = character(await portAlder(), "marcus_delgado");
    expect(marcus.sections.map((s) => s.id)).toEqual(["identity", "where", "day", "work", "stats", "advanced"]);
    expect(section(marcus, "where").map((f) => f.id).sort()).toEqual(["bed", "home", "place", "scene"]);
    expect(section(marcus, "day").map((f) => f.id)).toContain("activity");
    expect(section(marcus, "work").map((f) => f.id)).toEqual(expect.arrayContaining(["employer", "pay_prefs", "filing_status", "local_tax"]));
    // The world's own character fields and the person's who-they-are fields are its identity; its
    // sheet numbers are stats, a world kind re-declaring one included; internal fields are advanced.
    expect(section(marcus, "identity").map((f) => f.id)).toEqual(expect.arrayContaining(["traits", "role", "birthday", "occupation", "region", "wealth"]));
    expect(section(marcus, "stats").map((f) => f.id)).toEqual(expect.arrayContaining(["might", "charm", "conditions"]));
    expect(section(marcus, "advanced").map((f) => f.id)).toEqual(expect.arrayContaining(["activity_until", "needs", "x", "y"]));
    expect(field(marcus, "activity_until")?.locked).toBe(true);
    // No label is a shape: a type hint is help.
    for (const f of marcus.sections.flatMap((s) => s.fields)) expect([f.id, /[{}()?]/.test(f.label)]).toEqual([f.id, false]);
    expect(field(marcus, "pay_prefs")?.help).toBeTruthy();
    expect(field(marcus, "birthday")?.help).toBeTruthy();
    expect(field(marcus, "traits")).toMatchObject({ type: "list", of: "text" });
    expect(marcus).toMatchObject({ kind: { id: "character" }, home: { id: "birch_lane_12" }, bed: { kind: "home" }, pov: false });
  });

  test("the bed picker looks in their home first: its rooms nearest first, then the things lying there, the likeliest beds first", () => {
    const world = modernUsWorld("w", "R");
    world.places.bedroom = { id: "bedroom", name: "Bedroom", parent: "apartment", fields: {} };
    world.places.closet = { id: "closet", name: "Walk-in closet", parent: "bedroom", fields: {} };
    world.entities.lamp = { id: "lamp", kind: "item", name: "Reading lamp", tier: "background", fields: { place: "apartment" }, relations: [] };
    world.entities.pullout = { id: "pullout", kind: "item", name: "Pull-out", tier: "background", fields: { place: "bedroom", catalog: "sofa_bed" }, relations: [] };
    world.entities.futon = { id: "futon", kind: "item", name: "Futon", tier: "background", fields: { place: "bedroom" }, relations: [] };
    world.entities.cot = { id: "cot", kind: "item", name: "Camp cot", tier: "background", fields: { place: "cafe" }, relations: [] };
    const you = character(migrateWorld(world), "you");
    expect(you.bedChoices.places.map((p) => [p.id, p.path])).toEqual([
      ["bedroom", ["Your apartment"]],
      ["closet", ["Your apartment", "Bedroom"]],
    ]);
    // The phone and wallet they carry aren't lying there; the cot at the café isn't in their home.
    expect(you.bedChoices.items.map((i) => i.id)).toEqual(["futon", "pullout", "lamp"]);
  });

  test("a place shows the places around it, outermost first, and its parent", () => {
    const refs = placeRefs(modernUsWorld("w", "R"));
    expect(refs.get("garage")).toMatchObject({ name: "Building garage", path: ["Riverton", "Elm Street Apartments"], parent: "apartment_bldg" });
    expect(refs.get("riverton")).toMatchObject({ path: [], parent: null });
  });

  test("the GM's read says where they are now and what they're doing, the party included", () => {
    const world = migrateWorld(modernUsWorld("w", "R"));
    const state = startState(world, reg);
    const maya = state.entities.maya;
    if (!maya) throw new Error("fixture");
    maya.fields.place = "office";
    maya.fields.activity = "work_shift";
    maya.fields.activity_until = state.clock + 120;
    maya.relations.push({ type: "travels_with", to: "you" });
    const built = buildCharacter(reg, world, "maya", state);
    expect(built?.character.place?.id).toBe("office");
    expect(built?.character.now).toMatchObject({ activity: "work_shift", activityLabel: "Work shift", party: true });
    expect(built?.character.now?.until).toBeTruthy();
    // Build's read has no now.
    expect(buildCharacter(reg, world, "maya")?.character.now).toBeUndefined();
    expect(buildCharacter(reg, world, "truck")).toBeNull();
  });
});
