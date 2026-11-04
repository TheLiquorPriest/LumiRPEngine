// Manage's three groups (ITEMS-SPEC §10.1, §10.3; N3), derived and never stored, on Port Alder:
// Jordan's outfit (what he wears, by slot), what he carries and doesn't wear, and his wardrobe (his
// clothing at home, by what holds it), in the Gear panel's view and in his Character page's things;
// below Gear 3 everything on him is carried. A thing's row says where Put away takes it, and its
// slot.

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
