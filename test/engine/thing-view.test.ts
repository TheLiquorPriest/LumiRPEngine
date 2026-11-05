// Manage's three groups (ITEMS-SPEC §10.1, §10.3; N3), derived and never stored, on Port Alder:
// Jordan's outfit (what he wears, by slot), what he carries and doesn't wear, and his wardrobe (his
// clothing at home, by what holds it), in the Gear panel's view and in his Character page's things;
// below Gear 3 everything on him is carried. A thing's row says where Put away takes it, and its
// slot. Belongings' parts (DESIGN §28.12): his things stored at home by what keeps them, his saved
// outfits and loadouts, the people here, the vehicles he may use (the Garage's, never a list's),
// and on each thing of his whose it is, who may use it and whom he lets use it, until when.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import type { RelationInstance } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { personThings, thingRow } from "../../src/engine/thing-view";
import { Working } from "../../src/engine/working";
import { buildGearView } from "../../src/packs/gear/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const HOME = "harbor_street_114";
const MINE = ["boots", "jacket", "shirt", "sweater", "jeans", "wardrobe"];

/** Port Alder with Jordan at home at Gear `gear`: a rain jacket and boots worn, a flannel shirt carried, a sweater in his wardrobe and jeans on the floor. */
function dressed(gear: Level = 4): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const add = (id: string, name: string, fields: JsonObject, relations: RelationInstance[] = []): void => {
    world.entities[id] = { id, kind: "item", name, tier: "background", fields: { owner: JORDAN, ...fields }, relations };
  };
  add("jacket", "Rain jacket", { category: "clothing", slot: "torso_outer" }, [{ type: "in", to: JORDAN }, { type: "worn_by", to: JORDAN, fields: { slot: "torso_outer" } }]);
  add("boots", "Work boots", { category: "clothing", slot: "feet" }, [{ type: "in", to: JORDAN }, { type: "worn_by", to: JORDAN, fields: { slot: "feet" } }]);
  add("wardrobe", "Oak wardrobe", { place: HOME });
  add("sweater", "Wool sweater", { category: "clothing", slot: "torso_mid" }, [{ type: "in", to: "wardrobe" }]);
  add("jeans", "Jeans", { category: "clothing", slot: "legs", place: HOME });
  const state: WorldState = startState(world, reg);
  state.realism.levels.gear = gear;
  // Bought in play, so where it rests is read: in what keeps clothing at his home.
  state.entities.shirt = { kind: "item", name: "Flannel shirt", tier: "background", fields: { owner: JORDAN, category: "clothing", slot: "torso_base", got: { how: "bought", at: state.clock } }, relations: [{ type: "in", to: JORDAN }], levels: {}, agent: false };
  return new Working(reg, world, state);
}

describe("the Gear panel's outfit, carried and wardrobe", () => {
  test("Gear 4: the jacket and boots by slot, the shirt carried, the sweater in the wardrobe and the jeans loose at home", () => {
    const view = buildGearView(dressed().ctx);
    expect(view.outfit.filter((i) => MINE.includes(i.id)).map((i) => [i.id, i.slot])).toEqual([
      ["jacket", "torso outer"],
      ["boots", "feet"],
    ]);
    expect(view.carried.map((i) => i.id)).toContain("shirt");
    expect(view.carried.some((i) => i.id === "jacket" || i.id === "boots")).toBe(false);
    expect(view.carried.find((i) => i.id === "shirt")).toMatchObject({ wearable: true, mine: true, size: "hand" });
    const wardrobe = view.wardrobe.map((g) => ({ holder: g.holder, where: g.where, items: g.items.map((i) => i.id).filter((id) => MINE.includes(id)) })).filter((g) => g.items.length > 0);
    expect(wardrobe).toEqual([
      { holder: { id: "wardrobe", name: "Oak wardrobe" }, where: "114 Harbor Street", items: ["sweater"] },
      { holder: null, where: "114 Harbor Street", items: ["jeans"] },
    ]);
    // Where he is: the wardrobe is a holder here, with what is in it.
    expect(view.here?.place).toBe("114 Harbor Street");
    expect(view.here?.room.find((i) => i.id === "wardrobe")).toMatchObject({ holds: "armful", size: "furniture" });
    expect(view.here?.inside.find((g) => g.holder.id === "wardrobe")?.items.map((i) => i.id)).toEqual(["sweater"]);
  });

  test("below Gear 3 everything on him is carried: no outfit, no wardrobe", () => {
    const view = buildGearView(dressed(2).ctx);
    expect(view.outfit).toEqual([]);
    expect(view.wardrobe).toEqual([]);
    expect(view.carried.map((i) => i.id)).toEqual(expect.arrayContaining(["jacket", "boots", "shirt"]));
  });
});

describe("Belongings' parts of the Gear panel's view (DESIGN §28.12)", () => {
  test("home storage: his things at home that nobody has, by what keeps them, loose last; the people here, the vehicles he may use and none listed", () => {
    const view = buildGearView(dressed().ctx);
    expect(view.stored.map((s) => ({ holder: s.holder, where: s.where, items: s.items.map((i) => i.id) }))).toEqual([
      { holder: { id: "wardrobe", name: "Oak wardrobe" }, where: "114 Harbor Street", items: ["sweater"] },
      { holder: null, where: "114 Harbor Street", items: ["jeans"] },
    ]);
    // His pickup is parked at home: the Garage counts it, and no list of these holds it.
    const listed = [...view.stored.flatMap((s) => s.items), ...(view.here?.room ?? []), ...(view.here?.lying ?? []), ...view.carried, ...view.elsewhere].map((i) => i.id);
    expect(listed).not.toContain("pov_truck");
    expect(view.vehicles).toBe(3);
    expect(view.people.map((p) => p.name)).toEqual(["Danny Okafor", "Helen Kowalczyk", "Jess Kowalczyk", "Maddie Kowalczyk"]);
    expect([view.household, view.home, view.ceiling]).toEqual([null, { id: HOME, name: "114 Harbor Street" }, "armful"]);
    expect(view.loans.map((l) => l.label.split(",")[0])).toEqual(["For a day", "For three days", "For a week"]);
  });

  test("a thing of his says whose it is, its category, who may use it, and whom he lets use it until when, overdue once that is past", () => {
    const w = dressed();
    const until = w.state.clock + 60;
    w.state.entities.danny_okafor?.relations.push({ type: "uses", to: "jacket", fields: { basis: "loan", by: JORDAN }, until });
    const jacket = buildGearView(w.ctx).outfit.find((i) => i.id === "jacket");
    expect(jacket).toMatchObject({ ownerId: JORDAN, category: "clothing", mine: true, grants: [{ who: "danny_okafor", name: "Danny Okafor", basis: "loan", until: expect.any(String) }] });
    expect(jacket?.use).toContainEqual({ basis: "owner", label: "Jordan Ellis · owner", who: ["Jordan Ellis"] });
    expect(jacket?.grants?.[0]?.overdue).toBeUndefined();
    w.state.clock = until + 1;
    expect(buildGearView(w.ctx).outfit.find((i) => i.id === "jacket")?.grants?.[0]?.overdue).toBe(true);
    // His jeans made nobody's, lying at home: still his to change, and they say whose they are.
    const jeans = w.state.entities.jeans;
    if (jeans) jeans.fields = { category: "clothing", slot: "legs", place: HOME };
    expect(buildGearView(w.ctx).stored.find((s) => s.holder === null)?.items.find((i) => i.id === "jeans")).toMatchObject({ ownerId: null, mine: true });
  });

  test("his saved outfits and loadouts from Gear 3, by kind and name: what is out of reach marked, and on while all of it to hand is worn; none below Gear 3", () => {
    /** `dressed` at Gear `gear` with three saved sets of his: Work (what he wears), Cosy (at home, and a scarf gone) and a loadout, Ready (the shirt in hand). */
    const withSets = (gear?: Level): Working => {
      const w = dressed(gear);
      const pov = w.state.entities[JORDAN];
      if (pov) pov.fields.sets = { set_work: { name: "Work", kind: "outfit", pieces: [{ item: "jacket" }, { item: "boots" }] }, set_cosy: { name: "Cosy", kind: "outfit", pieces: [{ item: "sweater" }, { item: "jeans" }, { item: "scarf" }] }, set_ready: { name: "Ready", kind: "loadout", pieces: [{ item: "shirt", slot: "hand_held" }] } };
      return w;
    };
    expect(buildGearView(withSets().ctx).sets).toEqual([
      { id: "set_ready", name: "Ready", kind: "loadout", pieces: [{ item: "shirt", name: "Flannel shirt", slot: "hand held" }] },
      { id: "set_cosy", name: "Cosy", kind: "outfit", pieces: [{ item: "sweater", name: "Wool sweater" }, { item: "jeans", name: "Jeans" }, { item: "scarf", name: "scarf", missing: true }] },
      { id: "set_work", name: "Work", kind: "outfit", pieces: [{ item: "jacket", name: "Rain jacket" }, { item: "boots", name: "Work boots" }], on: true },
    ]);
    expect(buildGearView(withSets(2).ctx).sets).toEqual([]);
  });
});

describe("a person's outfit, carried and wardrobe on the Character page", () => {
  test("the same groups for Jordan, rows with their slots and where Put away takes them", () => {
    const w = dressed();
    const person = personThings(w.ctx, JORDAN);
    expect(person?.outfit.filter((r) => MINE.includes(r.id)).map((r) => r.id)).toEqual(["jacket", "boots"]);
    expect(person?.carried.map((r) => r.id)).toContain("shirt");
    expect(person?.wardrobe.map((g) => ({ holder: g.holder?.id ?? null, rows: g.rows.map((r) => r.id).filter((id) => MINE.includes(id)) })).filter((g) => g.rows.length > 0)).toEqual([
      { holder: "wardrobe", rows: ["sweater"] },
      { holder: null, rows: ["jeans"] },
    ]);
    // The shirt rests in his wardrobe at home; it takes the torso base slot.
    expect(thingRow(w.ctx, "shirt")).toMatchObject({ slot: "torso_base", rest: { in: "wardrobe" } });
    expect(personThings(dressed(2).ctx, JORDAN)?.outfit).toEqual([]);
  });
});
