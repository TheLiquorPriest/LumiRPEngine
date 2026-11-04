// Who may use and dispose of a thing (ITEMS-SPEC §3.4, §12 Phase 1), one resolver, on Port Alder:
// Jordan may use Alder Automotive's tools at the shop as its mechanic and not at home; Jess works
// for The Rusty Anchor, a place employer; Maddie may use the milk and the TV the Kowalczyks own, and
// dispose of the milk alone; Jordan has no say over Danny's keys until Danny lets him use his things
// (`permits`); and the shop's places are its own. The palette reads it through `may_use` and
// `may_assign`.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { ItemOp } from "../../src/shared/things";
import type { EntityDef, RelationInstance, WorldDoc } from "../../src/shared/world";
import { accessFor, assignFor, reachOf } from "../../src/engine/access";
import { isStaff, orgPlaces, orgPower } from "../../src/engine/org";
import { createRegistry } from "../../src/engine/registry-impl";
import { evalExpr, scopeEnv } from "../../src/engine/scope";
import { applyItemOp } from "../../src/engine/thing-ops";
import { whoseOf } from "../../src/engine/things";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const MADDIE = "maddie_kowalczyk";
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";

function thing(id: string, name: string, fields: JsonObject, relations: RelationInstance[] = []): EntityDef {
  return { id, kind: "item", name, tier: "background", fields, relations };
}

/** The shop's floor jack at the shop, its torque wrench taken home to 114 Harbor Street, the Kowalczyks' milk and TV at home, and Danny's truck keys on him. */
const THINGS: readonly EntityDef[] = [
  thing("shop_jack", "Floor jack", { owner: SHOP, place: "alder_automotive" }),
  thing("shop_torque_wrench", "Torque wrench", { owner: SHOP, place: "harbor_street_114" }),
  thing("milk", "Gallon of milk", { owner: HOUSEHOLD, place: "harbor_street_114", consumable: true }),
  thing("kowalczyk_tv", "Television", { owner: HOUSEHOLD, place: "harbor_street_114", catalog: "tv_55_4k" }),
  thing("danny_keys", "Truck keys", { owner: DANNY, catalog: "keys_set" }, [{ type: "in", to: DANNY }]),
  thing("danny_creeper", "Mechanic's creeper", { owner: DANNY, place: "alder_automotive" }),
];

/** Port Alder with the things above, and the world changes a test makes. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const e of THINGS) world.entities[e.id] = structuredClone(e);
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** Applies item ops in order, as the GM would; a refusal is a test failure. */
function apply(w: Working, ...ops: Exclude<ItemOp, { do: "remove" }>[]): void {
  ops.forEach((op, i) => {
    const out = applyItemOp(w, op, { by: "gm", confirmed: true, gm: true, salt: `test:${i}` });
    if ("code" in out) throw new Error(`${op.do} refused: ${out.reason}`);
  });
}

const formula = (w: Working, src: string, self: string): unknown => evalExpr(src, scopeEnv({ reg, ctx: w.ctx, bindings: { self } }), null);

describe("staff (ITEMS-SPEC §3.4 step 4)", () => {
  test("Jordan may use an Alder Automotive tool at the shop as its mechanic, and not at home", () => {
    const w = portAlder();
    expect(isStaff(w.ctx, JORDAN, SHOP)).toEqual({ basis: "job", id: "job_pov_mechanic" });
    expect(accessFor(w.ctx, JORDAN, "shop_jack")).toEqual({ use: { basis: "staff", via: SHOP, by: "job_pov_mechanic" }, dispose: null });
    expect(accessFor(w.ctx, JORDAN, "shop_torque_wrench")).toEqual({ use: null, dispose: null });
    // The same jack taken home to 114 Harbor Street is no longer his to use.
    apply(w, { do: "move", item: "shop_jack", to: { place: "harbor_street_114" }, why: "borrowed overnight" });
    expect(accessFor(w.ctx, JORDAN, "shop_jack")).toEqual({ use: null, dispose: null });
    // Marcus owns the shop: every power over its things is his.
    expect(accessFor(w.ctx, "marcus_delgado", "shop_torque_wrench")).toEqual({ use: { basis: "owner", via: SHOP }, dispose: { basis: "owner", via: SHOP } });
    expect(assignFor(w.ctx, "marcus_delgado", "shop_jack")).toEqual({ basis: "owner", via: SHOP });
    expect(assignFor(w.ctx, JORDAN, "shop_jack")).toBeNull();
  });

  test("Jess Kowalczyk is staff at The Rusty Anchor, a place employer", () => {
    const w = portAlder();
    expect(isStaff(w.ctx, "jess_kowalczyk", "rusty_anchor")).toEqual({ basis: "job", id: "job_jess_kowalczyk" });
    expect(isStaff(w.ctx, MADDIE, "rusty_anchor")).toBeNull();
  });

  test("the shop's places are its own, as ORG-SPEC's own test says", () => {
    const w = portAlder();
    expect(orgPlaces(w.ctx, SHOP)).toEqual(["alder_automotive"]);
  });
});

describe("an organization's things (ITEMS-SPEC §3.4 step 1)", () => {
  test("Maddie may use the milk and the TV the Kowalczyks own, and dispose of the milk alone", () => {
    const w = portAlder();
    expect(accessFor(w.ctx, MADDIE, "milk")).toEqual({ use: { basis: "member", via: HOUSEHOLD }, dispose: { basis: "member", via: HOUSEHOLD } });
    expect(accessFor(w.ctx, MADDIE, "kowalczyk_tv")).toEqual({ use: { basis: "member", via: HOUSEHOLD }, dispose: null });
    expect(orgPower(w.ctx, MADDIE, HOUSEHOLD, "assets.dispose", "milk")).toEqual({ basis: "member" });
    expect(orgPower(w.ctx, MADDIE, HOUSEHOLD, "assets.dispose", "kowalczyk_tv")).toBeNull();
    expect(orgPower(w.ctx, MADDIE, HOUSEHOLD, "assets.use", "kowalczyk_tv")).toEqual({ basis: "member" });
    // Jordan lives in the building and isn't one of the household.
    expect(accessFor(w.ctx, JORDAN, "kowalczyk_tv")).toEqual({ use: null, dispose: null });
  });

  test("an unowned thing at the Kowalczyks' is presumed the household's, and read as theirs, marked presumed", () => {
    const w = portAlder((world) => {
      world.entities.couch = thing("couch", "Couch", { place: "harbor_street_114", catalog: "sofa" });
    });
    // Everyone living at 114 Harbor Street isn't one household: the building's owner is presumed.
    expect(whoseOf(w.ctx, "couch")).toEqual({ owners: ["helen_kowalczyk"], presumed: "property" });
    expect(accessFor(w.ctx, "helen_kowalczyk", "couch")).toEqual({ use: { basis: "owner", presumed: true }, dispose: { basis: "owner", presumed: true } });
    // Jordan shares the building as his home: a housemate may use what its owner owns.
    expect(accessFor(w.ctx, JORDAN, "couch").use).toEqual({ basis: "housemate", via: "helen_kowalczyk", presumed: true });
  });
});

describe("Danny's keys (ITEMS-SPEC §3.4 steps 2, 3)", () => {
  test("Jordan may not dispose of Danny's keys, nor use or lend them", () => {
    const w = portAlder();
    expect(accessFor(w.ctx, JORDAN, "danny_keys")).toEqual({ use: null, dispose: null });
    expect(assignFor(w.ctx, JORDAN, "danny_keys")).toBeNull();
    expect(accessFor(w.ctx, DANNY, "danny_keys")).toEqual({ use: { basis: "owner" }, dispose: { basis: "owner" } });
  });

  test("a permits relation works: all Danny's things, or only those at his home, and only until it ends", () => {
    const all = portAlder();
    apply(all, { do: "permit", from: DANNY, to: JORDAN, scope: "all" });
    expect(all.state.entities[DANNY]?.relations).toContainEqual({ type: "permits", to: JORDAN, fields: { scope: "all" } });
    expect(accessFor(all.ctx, JORDAN, "danny_keys")).toEqual({ use: { basis: "permit", via: DANNY }, dispose: null });
    expect(accessFor(all.ctx, JORDAN, "danny_creeper").use).toEqual({ basis: "permit", via: DANNY });
    // Leave to use is no say over them.
    expect(assignFor(all.ctx, JORDAN, "danny_keys")).toBeNull();
    apply(all, { do: "unpermit", from: DANNY, to: JORDAN });
    expect(accessFor(all.ctx, JORDAN, "danny_keys").use).toBeNull();

    // At home: the keys on Danny at 114 Harbor Street, not his creeper at the shop.
    const home = portAlder();
    apply(home, { do: "permit", from: DANNY, to: JORDAN, scope: "home" });
    expect(accessFor(home.ctx, JORDAN, "danny_keys").use).toEqual({ basis: "permit", via: DANNY });
    expect(accessFor(home.ctx, JORDAN, "danny_creeper").use).toBeNull();

    // Until it ends.
    const lapsed = portAlder();
    apply(lapsed, { do: "permit", from: DANNY, to: JORDAN, until: lapsed.state.clock + 60 });
    expect(accessFor(lapsed.ctx, JORDAN, "danny_keys").use).toEqual({ basis: "permit", via: DANNY });
    lapsed.state.clock += 61;
    expect(accessFor(lapsed.ctx, JORDAN, "danny_keys").use).toBeNull();
  });

  test("an organization's permit reaches the things at its places", () => {
    const w = portAlder();
    apply(w, { do: "permit", from: SHOP, to: MADDIE, scope: "home", by: "marcus_delgado" });
    expect(accessFor(w.ctx, MADDIE, "shop_jack").use).toEqual({ basis: "permit", via: SHOP });
    expect(accessFor(w.ctx, MADDIE, "shop_torque_wrench").use).toBeNull();
    // Given by someone with the say over the shop's things, it carries no note for the GM.
    expect(w.events.some((e) => e.type === "engine.note")).toBe(false);
  });

  test("a grant in force is use: a hold, a loan to its end, an assignment", () => {
    const w = portAlder();
    apply(w, { do: "grant", item: "danny_keys", who: JORDAN, basis: "hold", by: DANNY });
    expect(accessFor(w.ctx, JORDAN, "danny_keys")).toEqual({ use: { basis: "grant", grant: "hold", via: DANNY }, dispose: null });
    apply(w, { do: "revoke", item: "danny_keys", who: JORDAN }, { do: "grant", item: "danny_keys", who: JORDAN, until: w.state.clock + 120 });
    expect(accessFor(w.ctx, JORDAN, "danny_keys").use).toEqual({ basis: "grant", grant: "loan", until: w.state.clock + 120 });
    // A grant from someone without the say lands, flagged for the GM.
    apply(w, { do: "grant", item: "kowalczyk_tv", who: JORDAN, by: MADDIE });
    expect(accessFor(w.ctx, JORDAN, "kowalczyk_tv").use).toMatchObject({ basis: "grant", grant: "assign", via: MADDIE });
    expect(w.events.filter((e) => e.type === "engine.note").length).toBe(1);
  });
});

describe("a thing's own access (ITEMS-SPEC §3.4 step 5)", () => {
  test("it replaces the implied rules: public for anyone, members for the owner's household, owner for the owner alone", () => {
    const w = portAlder((world) => {
      world.entities.bench = thing("bench", "Park bench", { owner: "helen_kowalczyk", place: "lakefront_park", access: "public" });
      world.entities.radio = thing("radio", "Helen's radio", { owner: "helen_kowalczyk", place: "harbor_street_114", access: "members" });
      world.entities.lamp = thing("lamp", "Hall lamp", { owner: "helen_kowalczyk", place: "harbor_street_114" });
      const jack = world.entities.shop_jack;
      if (jack) jack.fields.access = "owner";
    });
    expect(accessFor(w.ctx, JORDAN, "bench").use).toEqual({ basis: "public" });
    // Kept to Helen's household: Maddie may use it, and Jordan, her tenant, no longer may as a housemate.
    expect(accessFor(w.ctx, MADDIE, "radio").use).toEqual({ basis: "household", via: "helen_kowalczyk" });
    expect(accessFor(w.ctx, JORDAN, "radio").use).toBeNull();
    expect(accessFor(w.ctx, JORDAN, "lamp").use).toEqual({ basis: "housemate", via: "helen_kowalczyk" });
    // Staff get nothing from a thing kept to its owner.
    expect(accessFor(w.ctx, JORDAN, "shop_jack").use).toBeNull();
  });
});

describe("the palette's formulas and reach (ITEMS-SPEC §3.4, §4.5)", () => {
  test("may_use and may_assign read the resolver", () => {
    const w = portAlder();
    expect(formula(w, "may_use(self, 'shop_jack')", JORDAN)).toBe(true);
    expect(formula(w, "may_use(self, 'shop_torque_wrench')", JORDAN)).toBe(false);
    expect(formula(w, "may_assign(self, 'shop_jack')", JORDAN)).toBe(false);
    expect(formula(w, "may_assign(self, 'shop_jack')", "marcus_delgado")).toBe(true);
    expect(formula(w, "may_assign(self, 'danny_keys')", DANNY)).toBe(true);
  });

  test("reach: on him, here, and away", () => {
    const w = portAlder();
    expect(reachOf(w.ctx, JORDAN, "pov_keys")).toEqual({ reach: "on", place: "harbor_street_114" });
    expect(reachOf(w.ctx, JORDAN, "danny_keys")).toEqual({ reach: "here", place: "harbor_street_114", on: DANNY });
    expect(reachOf(w.ctx, JORDAN, "milk")).toEqual({ reach: "here", place: "harbor_street_114" });
    expect(reachOf(w.ctx, JORDAN, "shop_jack")).toEqual({ reach: "away", place: "alder_automotive" });
  });
});
