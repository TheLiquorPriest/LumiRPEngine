// The one name resolver for things (ITEMS-SPEC §5.1, §12 Phase 1), on Port Alder: "the keys" Jordan
// says are the keys on him and "Marcus's key" is Marcus's shop key; two wallets lying where someone
// stands are ambiguous until an owner names one; "key" never names a turkey sandwich, and neither
// does `has_item`, which reads names the resolver's way.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { EntityDef, RelationInstance, WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { findThings, nameMeets, namesThing, resolveThing } from "../../src/engine/thing-resolve";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const MADDIE = "maddie_kowalczyk";

function thing(id: string, name: string, fields: JsonObject, relations: RelationInstance[] = [], kind = "item"): EntityDef {
  return { id, kind, name, tier: "background", fields, relations };
}

/** Port Alder, with the things a test adds and the world changes it makes. */
function portAlder(things: readonly EntityDef[] = [], patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const e of things) world.entities[e.id] = e;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** Two wallets lying loose at 114 Harbor Street, Marcus's and Danny's. */
const WALLETS = [thing("marcus_wallet", "Wallet", { owner: "marcus_delgado", place: "harbor_street_114" }, [], "container"), thing("danny_wallet", "Wallet", { owner: "danny_okafor", place: "harbor_street_114" }, [], "container")];

describe("the resolver table on Port Alder (ITEMS-SPEC §5.1)", () => {
  test('"the keys" Jordan says are the keys on him; "Marcus\'s key" is the shop office key Marcus carries', () => {
    const w = portAlder();
    expect(resolveThing(w.ctx, "the keys", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_keys", secret: false });
    expect(resolveThing(w.ctx, "my keys", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_keys", secret: false });
    expect(resolveThing(w.ctx, "Marcus's key", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "shop_office_key", secret: false });
    // Every key the world has is a candidate; the ones on Jordan stand first.
    const keys = findThings(w.ctx, "keys", { actor: JORDAN, viewer: JORDAN });
    expect(keys[0]).toMatchObject({ id: "pov_keys", rank: "on", full: true });
    expect(keys.map((c) => c.id)).toEqual(expect.arrayContaining(["pov_keys", "shop_office_key", "pontoon_keys"]));
  });

  test("two wallets lying here, unqualified, are ambiguous; \"Marcus's wallet\" is his and \"Danny's\" his", () => {
    // Maddie has no wallet of her own; Jordan's is on him, which ranks after what lies loose.
    const w = portAlder(WALLETS);
    expect(resolveThing(w.ctx, "the wallet", { actor: MADDIE, viewer: JORDAN })).toEqual({ ambiguous: ["danny_wallet", "marcus_wallet"], secret: [] });
    expect(resolveThing(w.ctx, "Marcus's wallet", { actor: MADDIE, viewer: JORDAN })).toEqual({ id: "marcus_wallet", secret: false });
    expect(resolveThing(w.ctx, "Danny Okafor's wallet", { actor: MADDIE, viewer: JORDAN })).toEqual({ id: "danny_wallet", secret: false });
    // Jordan's own words mean the wallet on him.
    expect(resolveThing(w.ctx, "the wallet", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_wallet", secret: false });
    // A scope that stops at what is on the actor finds none for Maddie.
    expect(resolveThing(w.ctx, "the wallet", { actor: MADDIE, viewer: JORDAN, scope: "on" })).toEqual({ none: true });
  });

  test("a place or a holder the words end on narrows them; a full name stands before a head noun alone", () => {
    const w = portAlder();
    expect(resolveThing(w.ctx, "the flashlight in the glovebox", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_flashlight", secret: false });
    expect(resolveThing(w.ctx, "the flashlight in your pickup", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_flashlight", secret: false });
    // "The truck" names the shop's tow truck, whose name says truck, and nothing of it is a flashlight.
    expect(resolveThing(w.ctx, "the flashlight in the truck", { actor: JORDAN, viewer: JORDAN })).toEqual({ none: true });
    expect(resolveThing(w.ctx, "the spare relay", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "spare_relay", secret: false });
    // Both relays are at the shop, the installed one in the township's pickup there.
    expect(resolveThing(w.ctx, "the relay at Alder Automotive", { actor: JORDAN, viewer: JORDAN })).toEqual({ ambiguous: ["relay_fuel_pump", "spare_relay"], secret: [] });
    expect(resolveThing(w.ctx, "the relay in the township pickup", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "relay_fuel_pump", secret: false });
  });

  test("an alias counts as a name: Jordan's pickup called the truck", () => {
    const w = portAlder([], (world) => {
      const truck = world.entities.pov_truck;
      if (!truck) throw new Error("no truck");
      truck.fields.aliases = ["truck", "the old Ford"];
    });
    expect(resolveThing(w.ctx, "the flashlight in the truck", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_flashlight", secret: false });
    expect(findThings(w.ctx, "the old Ford", { actor: JORDAN, viewer: JORDAN })[0]).toMatchObject({ id: "pov_truck", by: "alias", full: true });
  });

  test("secrecy is a mark, never a filter: a hidden thing the words name is found, marked for whoever doesn't know it", () => {
    const w = portAlder([thing("hidden_envelope", "Envelope of cash", { owner: "marcus_delgado", place: "alder_automotive", visibility: "discoverable" })], (world) => {
      world.entities.marcus_delgado?.relations.push({ type: "knows", to: "hidden_envelope" });
    });
    expect(resolveThing(w.ctx, "the envelope", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "hidden_envelope", secret: true });
    expect(resolveThing(w.ctx, "the envelope", { actor: JORDAN, viewer: "marcus_delgado" })).toEqual({ id: "hidden_envelope", secret: false });
  });
});

describe('"key" never names a turkey sandwich', () => {
  /** Jordan without his keys, with a turkey sandwich in hand. */
  const lunch = (): Working =>
    portAlder([thing("sandwich", "Turkey sandwich", { owner: JORDAN, consumable: true }, [{ type: "in", to: JORDAN }])], (world) => {
      delete world.entities.pov_keys;
    });

  test("the resolver: the head noun must match", () => {
    const w = lunch();
    expect(findThings(w.ctx, "key", { actor: JORDAN, viewer: JORDAN }).map((c) => c.id)).not.toContain("sandwich");
    expect(findThings(w.ctx, "turkey", { actor: JORDAN, viewer: JORDAN }).map((c) => c.id)).not.toContain("sandwich");
    expect(resolveThing(w.ctx, "the sandwich", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "sandwich", secret: false });
    expect(namesThing(w.ctx, "sandwich", "key")).toBe(false);
    expect(namesThing(w.ctx, "sandwich", "turkey sandwich")).toBe(true);
    expect(nameMeets("key", "Turkey sandwich")).toBe(false);
  });

  test("has_item(pov, 'key') is false for one, and true for what he has", () => {
    const w = lunch();
    const hasItem = w.ctx.query("has_item");
    expect(hasItem(w.ctx, JORDAN, "key")).toBe(false);
    expect(hasItem(w.ctx, JORDAN, "sandwich")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "turkey sandwich")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "phone")).toBe(true);
    // A word inside a name ("pocket" in "Pocketknife") names nothing; its type row's name counts ("Pocket knife").
    expect(hasItem(w.ctx, JORDAN, "pocket")).toBe(false);
    expect(hasItem(w.ctx, JORDAN, "knife")).toBe(true);
    // Kinds, catalog rows and categories read as before.
    expect(hasItem(w.ctx, JORDAN, "container")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "smartphone")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "carried")).toBe(true);
    // With his keys on him, "key" names them.
    const keyed = portAlder();
    expect(keyed.ctx.query("has_item")(keyed.ctx, JORDAN, "key")).toBe(true);
  });

  test("a kit's pieces present meet the words the same way: a hammer is no ham", () => {
    const w = portAlder([], (world) => {
      const toolbox = world.entities.pov_toolbox;
      if (!toolbox) throw new Error("no toolbox");
      delete toolbox.fields.place;
      toolbox.relations = [{ type: "in", to: JORDAN }];
    });
    const hasItem = w.ctx.query("has_item");
    expect(hasItem(w.ctx, JORDAN, "adjustable wrench")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "hammer")).toBe(true);
    expect(hasItem(w.ctx, JORDAN, "ham")).toBe(false);
    expect(hasItem(w.ctx, JORDAN, "torque wrench")).toBe(false);
  });
});
