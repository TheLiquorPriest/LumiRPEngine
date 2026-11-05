// Saved outfits and loadouts (DESIGN §28.16, the gear pack's `sets.ts`) on Port Alder, through the
// item ops `set_save`, `set_apply` and `set_drop` and the actions that make them. An outfit keeps
// what dresses Jordan, never what is in his pockets; a loadout what he carries ready and the armor he
// wears; a name of his replaces its set, and he keeps at most the world's number. Changing into one
// puts each piece on in its slot, takes off what else of its kind he wears, and at home puts back
// what came off where it is kept; a piece out of reach is left and named, and none to hand is
// refused, as is any below Gear 3. The Gear section names them by kind.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { setsOf, type ItemOp, type SavedSet } from "../../../src/shared/things";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { applyItemOp, type ItemOpOptions } from "../../../src/engine/thing-ops";
import { spotOf } from "../../../src/engine/things";
import { Working } from "../../../src/engine/working";
import { gearLines } from "../../../src/packs/gear/core/feed";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const HOME = "harbor_street_114";
/** The story's change, as a reply's read or the Curator makes it. */
const STORY: ItemOpOptions = { by: "story", confirmed: false, gm: false, salt: "sets" };

/** A thing of Jordan's in `on` (worn there in its own slot when `worn`), or lying at home for null. */
function item(id: string, name: string, fields: JsonObject, on: string | null = JORDAN, worn = false): EntityDef {
  const relations: EntityDef["relations"] = on === null ? [] : [{ type: "in", to: on }];
  if (on !== null && worn) relations.push({ type: "worn_by", to: on, fields: { slot: String(fields.slot) } });
  return { id, kind: "item", name, tier: "background", fields: { owner: JORDAN, ...fields, ...(on === null ? { place: HOME } : {}) }, relations };
}

/**
 * Port Alder with Jordan at home in a rain jacket and work boots (and his wristwatch, and his
 * pockets' things); the oak wardrobe there keeps his grey suit jacket, his dress shoes and a silk tie;
 * a pistol and a Kevlar vest on him. `patch` changes the world.
 */
function dressed(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const e of [
    item("jacket", "Rain jacket", { category: "clothing", slot: "torso_outer" }, JORDAN, true),
    item("boots", "Work boots", { category: "clothing", slot: "feet" }, JORDAN, true),
    item("wardrobe", "Oak wardrobe", {}, null),
    item("suit", "Grey suit jacket", { category: "clothing", slot: "torso_outer" }, "wardrobe"),
    item("shoes", "Dress shoes", { category: "clothing", slot: "feet" }, "wardrobe"),
    item("tie", "Silk tie", { category: "clothing", slot: "neck" }, "wardrobe"),
    item("pistol", "Pistol", { category: "weapon", slot: "holster" }),
    item("vest", "Kevlar vest", { category: "armor", slot: "torso_outer" }),
  ])
    world.entities[e.id] = e;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** The world's gear config as given. */
const gearConfig =
  (config: JsonObject) =>
  (world: WorldDoc): void => {
    world.packs.gear = { version: world.packs.gear?.version ?? 1, config };
  };

const run = (w: Working, op: Exclude<ItemOp, { do: "remove" }>) => applyItemOp(w, op, STORY);
const sets = (w: Working): Record<string, SavedSet> => setsOf(w.state.entities[JORDAN]?.fields);
/** The slot a thing is worn or readied in on Jordan, or null. */
const slotOn = (w: Working, id: string): unknown => w.state.entities[id]?.relations.find((r) => (r.type === "worn_by" || r.type === "equipped") && r.to === JORDAN)?.fields?.slot ?? null;

describe("keeping a set (set_save)", () => {
  test("an outfit keeps what dresses him, never his pockets' things; a loadout what he carries ready and his armor; his name for it replaces it, and the same again changes nothing", () => {
    const w = dressed();
    expect(run(w, { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({});
    expect(sets(w).set_work).toEqual({ name: "Work", kind: "outfit", pieces: [{ item: "boots" }, { item: "jacket" }, { item: "pov_watch" }] });
    expect(run(w, { do: "set_save", who: JORDAN, name: "Range", kind: "loadout" })).toEqual({ code: "nothing_worn", reason: "Jordan Ellis wears nothing to keep as a loadout" });
    expect(run(w, { do: "wear", item: "pistol", who: JORDAN })).toEqual({});
    expect(run(w, { do: "wear", item: "vest", who: JORDAN })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Range", kind: "loadout" })).toEqual({});
    expect(sets(w).set_range?.pieces).toEqual([{ item: "pistol" }, { item: "vest" }]);
    // Drawn: the loadout keeps the pistol in his hand, a slot not its own.
    expect(run(w, { do: "wear", item: "pistol", who: JORDAN, slot: "hand_held" })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Range", kind: "loadout" })).toEqual({});
    expect(sets(w).set_range).toEqual({ name: "Range", kind: "loadout", pieces: [{ item: "pistol", slot: "hand_held" }, { item: "vest" }] });
    expect(run(w, { do: "set_save", who: JORDAN, name: "Range", kind: "loadout" })).toEqual({ code: "no_change", reason: "Range is saved as it is" });
    // The vest is armor, a loadout's, though it took the jacket's place: Work again keeps the boots and the watch.
    expect(run(w, { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({});
    expect(sets(w).set_work?.pieces).toEqual([{ item: "boots" }, { item: "pov_watch" }]);
  });

  test("pieces given are kept as named, each in its slot; a thing gone is refused, a name is 1 to 40 characters, and he keeps at most the world's number, 0 keeping none", () => {
    const w = dressed(gearConfig({ sets: { max: 2 } }));
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }, { item: "shoes" }, { item: "tie" }] })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Whittling", kind: "loadout", pieces: [{ item: "pov_pocketknife", slot: "hand_held" }] })).toEqual({});
    expect(Object.keys(sets(w))).toEqual(["set_smart", "set_whittling"]);
    expect(run(w, { do: "set_save", who: JORDAN, name: "Gala", kind: "outfit", pieces: [{ item: "suit" }] })).toEqual({ code: "too_many", reason: "Jordan Ellis keeps at most 2 saved outfits and loadouts: drop one first" });
    // One of a name he keeps is replaced, at the most as below it.
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }, { item: "tie" }] })).toEqual({});
    expect(sets(w).set_smart?.pieces).toEqual([{ item: "suit" }, { item: "tie" }]);
    expect(run(w, { do: "set_save", who: JORDAN, name: "Lost", kind: "outfit", pieces: [{ item: "no_such_thing" }] })).toMatchObject({ code: "missing_entity" });
    expect(run(w, { do: "set_save", who: JORDAN, name: "  ", kind: "outfit" })).toMatchObject({ code: "bad_name" });
    expect(run(w, { do: "set_save", who: JORDAN, name: "x".repeat(41), kind: "outfit" })).toMatchObject({ code: "bad_name" });
    expect(run(dressed(gearConfig({ sets: { max: 0 } })), { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({ code: "too_many", reason: "This world keeps no saved outfits" });
  });
});

describe("changing into a set (set_apply)", () => {
  test("each piece goes on in its slot, what else of its kind he wears comes off, and at home what came off goes back where it is kept", () => {
    const w = dressed();
    expect(run(w, { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }, { item: "shoes" }, { item: "tie" }] })).toEqual({});
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_smart" })).toEqual({});
    expect(["suit", "shoes", "tie", "jacket", "boots", "pov_watch"].map((id) => slotOn(w, id))).toEqual(["torso_outer", "feet", "neck", null, null, null]);
    // What came off is kept on him: it stays carried. His pockets are no outfit's.
    expect([spotOf(w.state, "jacket"), spotOf(w.state, "boots"), slotOn(w, "pov_keys")]).toEqual([{ in: JORDAN }, { in: JORDAN }, "pocket"]);
    // Back into his work clothes at home: the suit, the shoes and the tie go back into the wardrobe.
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_work" })).toEqual({});
    expect(["jacket", "boots", "pov_watch"].map((id) => slotOn(w, id))).toEqual(["torso_outer", "feet", "wrist"]);
    expect(["suit", "shoes", "tie"].map((id) => [slotOn(w, id), spotOf(w.state, id)])).toEqual([
      [null, { in: "wardrobe" }],
      [null, { in: "wardrobe" }],
      [null, { in: "wardrobe" }],
    ]);
  });

  test("away from home a piece out of reach is left and named, none of it to hand is refused, and below Gear 3 it is refused", () => {
    const w = dressed((world) => {
      const pov = world.entities[JORDAN];
      if (pov) pov.fields.place = "alder_market";
      const tie = world.entities.tie;
      if (tie) tie.relations = [{ type: "in", to: "danny_okafor" }];
    });
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }, { item: "shoes" }, { item: "jacket" }] })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Gala", kind: "outfit", pieces: [{ item: "suit" }, { item: "tie" }] })).toEqual({});
    const before = w.events.length;
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_smart" })).toEqual({});
    // The jacket he wears stays on; the rest of what dresses him comes off, and the rest of Smart is at home.
    expect(["jacket", "boots", "pov_watch"].map((id) => slotOn(w, id))).toEqual(["torso_outer", null, null]);
    expect(w.events.slice(before).find((e) => e.type === "engine.note")).toMatchObject({ data: { text: "Not to hand for Smart: Grey suit jacket (isn't with you or close by); Dress shoes (isn't with you or close by).", entity: JORDAN, visibility: "public" } });
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_gala" })).toEqual({ code: "none_to_hand", reason: "None of Gala is to hand: Grey suit jacket (isn't with you or close by); Silk tie (is with Danny Okafor)" });
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_beach" })).toMatchObject({ code: "no_set" });
    w.state.realism.levels.gear = 2;
    expect(run(w, { do: "set_apply", who: JORDAN, set: "set_smart" })).toEqual({ code: "level", reason: "outfits are kept from Gear level 3" });
  });
});

describe("dropping a set (set_drop)", () => {
  test("a set dropped is no longer kept, the rest stay; one he doesn't keep is refused", () => {
    const w = dressed();
    expect(run(w, { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }] })).toEqual({});
    expect(run(w, { do: "set_drop", who: JORDAN, set: "set_work" })).toEqual({});
    expect(Object.keys(sets(w))).toEqual(["set_smart"]);
    expect(run(w, { do: "set_drop", who: JORDAN, set: "set_work" })).toEqual({ code: "no_set", reason: "Jordan Ellis keeps no such outfit" });
    expect(run(w, { do: "set_drop", who: "nobody", set: "set_smart" })).toMatchObject({ code: "missing_entity" });
  });
});

describe("the Gear section and the gear actions", () => {
  test("the Gear section names his saved outfits and loadouts by kind from Gear 3", () => {
    const w = dressed();
    expect(run(w, { do: "set_save", who: JORDAN, name: "Work", kind: "outfit" })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }] })).toEqual({});
    expect(run(w, { do: "set_save", who: JORDAN, name: "Range", kind: "loadout", pieces: [{ item: "pistol" }] })).toEqual({});
    const saved = (): string[] => gearLines(w.ctx, "player").map((l) => l.text).filter((t) => t.startsWith("Saved"));
    expect(saved()).toEqual(["Saved outfits: Smart and Work.", "Saved loadouts: Range."]);
    w.state.realism.levels.gear = 2;
    expect(saved()).toEqual([]);
  });

  test("Save what I'm wearing and Forget an outfit are bookkeeping; Change into is the turn's action, from Gear 3", () => {
    const w = dressed();
    const act = (action: string, params: Record<string, string>) => resolveAction(reg, w, { action, params }, createRng(`${action}:${JSON.stringify(params)}`));
    expect(["set_save", "set_drop", "set_apply"].map((id) => reg.actions.get(id)?.mechanical === true)).toEqual([true, true, false]);
    expect(act("set_save", { name: "Work", kind: "outfit" }).rejected).toEqual([]);
    expect(act("set_save", { name: "Gala", kind: "costume" }).rejected[0]?.rejection.code).toBe("bad_kind");
    expect(run(w, { do: "set_save", who: JORDAN, name: "Smart", kind: "outfit", pieces: [{ item: "suit" }, { item: "shoes" }] })).toEqual({});
    expect(act("set_apply", { set: "set_smart" }).rejected).toEqual([]);
    expect([slotOn(w, "suit"), slotOn(w, "shoes"), slotOn(w, "jacket")]).toEqual(["torso_outer", "feet", null]);
    expect(act("set_drop", { set: "set_smart" }).rejected).toEqual([]);
    expect(Object.keys(sets(w))).toEqual(["set_work"]);
    w.state.realism.levels.gear = 2;
    expect(act("set_apply", { set: "set_work" }).ok).toBe(false);
  });
});
