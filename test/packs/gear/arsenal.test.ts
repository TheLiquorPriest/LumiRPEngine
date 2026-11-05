// The arsenal (DESIGN §28.16), descriptive only, on Riverton's Modern US tables: weapons, armor and
// ammunition are things of their categories, each weapon's row naming the ammunition it takes, worn
// in slots that take one each (a holster, a sheath, a quiver) and readied in hand; ammunition is a
// stack of rounds that using draws down, and a gun safe at home keeps what arms someone. World rules
// read it through two formulas: `readied(who, what)`, drawn and held ready, and `ammo_of(who, what)`,
// the rounds someone carries for a weapon or of an ammunition. Nothing of combat reads gear.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { ARSENAL_CATEGORIES, ARSENAL_SLOTS } from "../../../src/shared/things";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { rowOf } from "../../../src/engine/pack-kit";
import { createRegistry } from "../../../src/engine/registry-impl";
import { evalExpr, scopeEnv } from "../../../src/engine/scope";
import { applyItemOp, type ItemOpOptions } from "../../../src/engine/thing-ops";
import { holdsOf, restOf, sizeOf } from "../../../src/engine/things";
import { Working } from "../../../src/engine/working";
import { ammoOf, readied } from "../../../src/packs/gear/core/model";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const YOU = "you";
const STORY: ItemOpOptions = { by: "story", confirmed: false, gm: false, salt: "arsenal" };

/** A thing of yours, in `on`. */
function thing(id: string, name: string, fields: JsonObject, on = YOU): EntityDef {
  return { id, kind: "item", name, tier: "background", fields: { owner: YOU, ...fields }, relations: [{ type: "in", to: on }] };
}

/**
 * Riverton with your 9mm pistol, a hunting knife and a box of fifty 9mm rounds on you, seven more
 * loose in your backpack and a spent box; twenty-five 12-gauge shells; an old revolver of no catalog
 * row of yours that takes .38 rounds, with six of them; and a gun safe in your apartment.
 */
function armed(patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "Riverton");
  for (const e of [
    thing("sidearm", "Pistol", { catalog: "pistol_9mm" }),
    thing("knife", "Hunting knife", { catalog: "hunting_knife" }),
    thing("box_9mm", "Box of 9mm rounds", { catalog: "ammo_9mm", qty: 50 }),
    { id: "backpack", kind: "container", name: "Backpack", tier: "background", fields: { owner: YOU, holds: "armful" }, relations: [{ type: "in", to: YOU }] },
    thing("loose_9mm", "9mm rounds", { catalog: "ammo_9mm", qty: 7 }, "backpack"),
    thing("spent_9mm", "Empty box of 9mm rounds", { catalog: "ammo_9mm", qty: 0 }),
    thing("shells", "Box of shotgun shells", { catalog: "ammo_12ga", qty: 25 }),
    thing("revolver", "Old revolver", { category: "weapon", slot: "holster", ammo: "ammo_38_special" }),
    thing("rounds_38", ".38 rounds", { catalog: "ammo_38_special", qty: 6 }),
    { id: "gun_safe", kind: "item", name: "Gun safe", tier: "background", fields: { owner: YOU, place: "apartment" }, relations: [] },
  ] satisfies EntityDef[])
    world.entities[e.id] = e;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** A world rule's expression, read for you. */
const rule = (w: Working, src: string): unknown => evalExpr(src, scopeEnv({ reg, ctx: w.ctx, bindings: { self: YOU } }), null);

describe("the arsenal's rows", () => {
  test("weapons, armor and ammunition by category, each weapon's ammunition a row of ammunition; their slots take one each, and a gun safe keeps arms", () => {
    const w = armed();
    expect(rowOf(w.ctx, "gear.items", "pistol_9mm")).toMatchObject({ category: "weapon", equip_slot: "holster", ammo: "ammo_9mm" });
    const rows = w.ctx.tables.get("gear.items")?.rows ?? {};
    const weapons = Object.entries(rows).filter(([, r]) => r.category === "weapon");
    expect(weapons.length).toBeGreaterThan(10);
    for (const [id, r] of weapons) if (typeof r.ammo === "string") expect([id, rows[r.ammo]?.category]).toEqual([id, "ammo"]);
    expect(ARSENAL_CATEGORIES.map((c) => Object.values(rows).some((r) => r.category === c))).toEqual([true, true, true]);
    expect(ARSENAL_SLOTS.map((s) => rowOf(w.ctx, "gear.slots", s) !== undefined)).toEqual([true, true, true]);
    // An old revolver of no row is Hand by its category; the gun safe, by its name, is furniture that holds arms.
    expect([sizeOf(w.ctx, "revolver").size, sizeOf(w.ctx, "gun_safe").size, holdsOf(w.ctx, "gun_safe")]).toEqual(["hand", "furniture", "armful"]);
    // A pistol bought in play rests in the gun safe at home, as a shirt rests in a wardrobe.
    w.state.entities.new_pistol = { kind: "item", name: "Pistol", tier: "background", fields: { owner: YOU, catalog: "pistol_45", got: { how: "bought", at: w.state.clock } }, relations: [{ type: "in", to: YOU }], levels: {}, agent: false };
    expect(restOf(w.ctx, "new_pistol")).toEqual({ rest: { in: "gun_safe" }, from: "stored" });
  });
});

describe("readied(who, what): drawn and held ready", () => {
  test("never carried or holstered; drawn, by its category, its id, its name or its type, and only for whoever holds it", () => {
    const w = armed();
    expect(readied(w.ctx, YOU, "weapon")).toBe(false);
    expect(applyItemOp(w, { do: "wear", item: "sidearm", who: YOU }, STORY)).toEqual({});
    expect(w.state.entities.sidearm?.relations).toContainEqual({ type: "worn_by", to: YOU, fields: { slot: "holster" } });
    expect(readied(w.ctx, YOU, "weapon")).toBe(false);
    expect(applyItemOp(w, { do: "wear", item: "sidearm", who: YOU, slot: "hand_held" }, STORY)).toEqual({});
    expect(["weapon", "sidearm", "pistol", "pistol_9mm", "knife", "armor"].map((what) => readied(w.ctx, YOU, what))).toEqual([true, true, true, true, false, false]);
    expect(readied(w.ctx, "rosa", "weapon")).toBe(false);
    // As a world rule reads it.
    expect(rule(w, "readied(self, 'weapon')")).toBe(true);
    expect(rule(w, "readied(self, 'knife')")).toBe(false);
  });
});

describe("ammo_of(who, what): the rounds someone carries", () => {
  test("for a weapon, the ammunition its row or its own field names; of an ammunition, by its name; every stack on them or in their bags counts its rounds, a spent one none", () => {
    const w = armed();
    expect(["sidearm", "pistol_9mm", "ammo_9mm", "ammo_12ga", "revolver", "knife", "ammo"].map((what) => ammoOf(w.ctx, YOU, what))).toEqual([57, 57, 57, 25, 6, 0, 88]);
    expect(ammoOf(w.ctx, "rosa", "sidearm")).toBe(0);
    // Using rounds draws the stack down; the last of one leaves the world.
    expect(applyItemOp(w, { do: "use", item: "box_9mm", qty: 15 }, STORY)).toEqual({});
    expect(applyItemOp(w, { do: "use", item: "rounds_38", qty: 6 }, STORY)).toEqual({});
    expect([ammoOf(w.ctx, YOU, "sidearm"), ammoOf(w.ctx, YOU, "revolver")]).toEqual([42, 0]);
    // As a world rule reads it.
    expect(rule(w, "ammo_of(self, 'sidearm') >= 40")).toBe(true);
    expect(rule(w, "ammo_of(self, 'revolver')")).toBe(0);
  });
});
