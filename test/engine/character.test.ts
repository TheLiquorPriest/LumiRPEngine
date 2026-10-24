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
    expect(field(marcus, "pay_prefs")?.help ?? "").not.toMatch(/[{}]/);
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

describe("the Character model in words", () => {
  test("who they work for is a place, with its path, or a business", async () => {
    const marcus = character(await portAlder(), "marcus_delgado");
    expect(marcus.employer).toMatchObject({ kind: "place", place: { id: "alder_automotive", path: ["Lakeshore County", "Port Alder"] } });
    const you = character(migrateWorld(modernUsWorld("w", "R")), "you");
    expect(you.employer).toMatchObject({ kind: "business", thing: { id: "brightline" } });
  });

  test("their schedules read as days, times and places, never as ids", async () => {
    const world = await portAlder();
    const marcus = character(world, "marcus_delgado");
    const ids = Object.values(world.schedules).filter((s) => s.owner === "marcus_delgado").map((s) => s.id).sort();
    expect(marcus.schedules.map((s) => s.id).sort()).toEqual(ids);
    for (const s of marcus.schedules) {
      expect(s.label).not.toContain(s.id);
      expect(s.summary).not.toContain("_");
    }
    // The weekday place schedule names the shop by name, at the times its slots give.
    const place = marcus.schedules.find((s) => s.id === "marcus_delgado_place_1");
    expect(place?.summary).toContain(world.places.alder_automotive?.name ?? "");
    expect(place?.summary).toMatch(/6:30/);
  });

  test("their relations read as words: regard in the world's band words, the rest by their fields, each in its group", () => {
    const world = modernUsWorld("w", "R");
    // The world's own band words for regard.
    world.packs.relationships = { ...(world.packs.relationships ?? {}), config: { bands: [{ label: "frosty", max: 0 }, { label: "chummy", min: 0 }] } };
    const you = world.entities.you;
    if (!you) throw new Error("fixture");
    you.relations.push({ type: "regard", to: "maya", fields: { warmth: 60, trust: 60, respect: 60 } }, { type: "parent_of", to: "rosa" }, { type: "member_of", to: "chen_household", fields: { role: "Lodger" } });
    world.entities.chen_household = { id: "chen_household", kind: "household", name: "The Chens", tier: "background", fields: {}, relations: [] };
    const built = buildCharacter(reg, migrateWorld(world), "you");
    const rel = (type: string) => built?.character.relations.find((r) => r.type === type);
    expect(rel("regard")).toMatchObject({ group: "feelings", to: { id: "maya", name: "Maya Chen" }, words: "chummy" });
    expect(rel("parent_of")?.group).toBe("family");
    expect(rel("member_of")).toMatchObject({ group: "groups", to: { name: "The Chens" } });
    expect(rel("member_of")?.words).toContain("Lodger");
  });

  test("a field's help says only what tells something, and a number's range is its hint", async () => {
    const marcus = character(await portAlder(), "marcus_delgado");
    expect(field(marcus, "might")).toMatchObject({ hint: "3–18" });
    expect(field(marcus, "might")?.help).toBeUndefined();
    // A table named as the field is ("Occupation", "Occupations") says nothing more.
    expect(field(marcus, "occupation")?.help).toBeUndefined();
    for (const f of marcus.sections.flatMap((s) => s.fields)) expect([f.id, /optional|From level/i.test(f.help ?? "")]).toEqual([f.id, false]);
  });
});
