// Add a thing in Play (Belongings' + Add; DESIGN §9.4): the kinds it offers (Item to Ammo, and a
// Vehicle by its class), the catalog's types of each, the ✎ fix a draft makes, and the chat's claims
// policy: Make it real makes it at once (a key, a weapon or a document, or past a capped claim cap,
// asks first), Ask first always asks, Hold me to the world has no Add.

import { describe, expect, test } from "bun:test";
import { addBlocked, type AddDraft } from "../../src/frontend/things/add-thing";
import { KindChips, THING_KINDS, typesOfKind } from "../../src/frontend/things/what-it-is";
import type { ThingType, WhereChoice } from "../../src/shared/thing-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { addAsk, addPolicy, madeWords, playMake } from "../../src/packs/gear/ui/add-sheet";
import { propsOf } from "../support/tree";

// As the engine's `thingTypes` reads them: `category` the catalogs' name for it, `categoryId` its id.
const types: ThingType[] = [
  { id: "hoodie", table: "gear.items", name: "Hoodie", category: "Clothing, basics through outerwear", categoryId: "clothing", size: "hand" },
  { id: "duffel", table: "gear.containers", name: "Duffel bag", category: null, categoryId: null, size: "armful" },
  { id: "first_aid", table: "gear.kits", name: "First-aid kit", category: null, categoryId: null, size: "hand" },
  { id: "pistol_9mm", table: "gear.items", name: "9 mm pistol", category: "Weapon", categoryId: "weapon", size: "hand", priceCents: 50_000 },
  { id: "rounds_9mm", table: "gear.items", name: "9 mm rounds", category: "Ammo", categoryId: "ammo", size: "pocket" },
];
const nobody = { owners: [], presumed: null, at: null };
const onYou: WhereChoice = { id: "pov", is: "person", name: "You", path: [], parent: null, holds: "armful", vehicle: false, whose: null, presumes: nobody, secret: false };
const lot: WhereChoice = { id: "lot", is: "place", name: "Diner lot", path: [], parent: null, holds: null, vehicle: false, whose: null, presumes: nobody, secret: false };
const draft = (over: Partial<AddDraft>): AddDraft => ({ name: "Thing", kind: "item", what: null, qty: 1, at: onYou, ...over });

describe("Add a thing", () => {
  test("the kinds, a chip each, and the catalog's types of each; a vehicle's are the picker's classes", () => {
    expect(propsOf(KindChips({ value: "item", onPick: () => undefined }), "button").map((p) => p["data-lre-kind"])).toEqual([...THING_KINDS]);
    expect(typesOfKind(types, "clothing").map((t) => t.id)).toEqual(["hoodie"]);
    expect(typesOfKind(types, "container").map((t) => t.id)).toEqual(["duffel"]);
    expect(typesOfKind(types, "kit").map((t) => t.id)).toEqual(["first_aid"]);
    expect(typesOfKind(types, "ammo").map((t) => t.id)).toEqual(["rounds_9mm"]);
    expect(typesOfKind(types, "item").length).toBe(types.length);
    expect(typesOfKind(types, "vehicle")).toEqual([]);
  });

  test("the ✎ fix a draft makes: its type, a vehicle's class with its make, model and year, else what it is said to be", () => {
    expect(playMake(draft({ name: "Hoodie", kind: "clothing", what: { type: types[0]! } }))).toEqual({ do: "make", name: "Hoodie", at: { in: "pov" }, type: "hoodie" });
    expect(playMake(draft({ name: "Rounds", kind: "ammo", what: { size: "pocket" }, qty: 50 }))).toEqual({ do: "make", name: "Rounds", at: { in: "pov" }, qty: 50, is: "ammo", size: "pocket" });
    expect(playMake(draft({ name: "Pickup", kind: "vehicle", what: { vehicle: { id: "midsize_pickup", name: "Midsize pickup", domain: "road", make: "Ford", model: "Ranger", year: 2021 } }, at: lot }))).toEqual({ do: "make", name: "Pickup", at: { place: "lot" }, class: "midsize_pickup", details: { make: "Ford", model: "Ranger", year: 2021 } });
    expect(playMake(draft({ name: "Pebble" }))).toEqual({ do: "make", name: "Pebble", at: { in: "pov" } });
    expect(madeWords(draft({ name: "Rounds", qty: 50 }))).toBe("Added: Rounds ×50, on you.");
    expect(addBlocked({ name: "Pickup", kind: "vehicle", what: { vehicle: { id: "midsize_pickup", name: "Midsize pickup", domain: "road", make: "", model: "", year: 2021 } }, at: onYou })).toBe("A vehicle stands at a place.");
    expect(addBlocked({ name: " ", kind: "item", what: null, at: onYou })).toBe("Give it a name.");
  });

  test("the claims policy: Make it real at once but for keys, weapons, documents and what passes a capped cap; Ask first asks; Hold me to the world hides Add", () => {
    const opts = { classes: [], cap: null, currency: DEFAULT_CURRENCY };
    expect(addPolicy({ mode: "hold", capped: false })).toBe("hidden");
    expect(addPolicy({ mode: "ask", capped: false })).toBe("ask");
    expect(addPolicy(null)).toBe("real");
    expect(addAsk({ mode: "real", capped: false }, draft({ what: { type: types[0]! } }), opts)).toBeNull();
    expect(addAsk({ mode: "real", capped: false }, draft({ kind: "weapon", what: { size: "hand" } }), opts)).toBe("Keys, weapons and documents always ask first.");
    expect(addAsk({ mode: "real", capped: false }, draft({ what: { type: types[3]! } }), opts)).toBe("Keys, weapons and documents always ask first.");
    expect(addAsk({ mode: "ask", capped: false }, draft({}), opts)).toBe("This chat asks before it makes real something you say you have.");
    const priced: ThingType = { id: "camera", table: "economy.catalog", name: "Camera", category: "Electronics", categoryId: "electronics", size: "hand", priceCents: 90_000 };
    expect(addAsk({ mode: "real", capped: true }, draft({ what: { type: priced } }), { ...opts, cap: 5_000 })).toBe("It costs about $900.00, over this world's $50.00 for what you say you have.");
    expect(addAsk({ mode: "real", capped: false }, draft({ what: { type: priced } }), { ...opts, cap: 5_000 })).toBeNull();
  });
});
