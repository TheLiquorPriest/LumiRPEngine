// The marks the player's map draws (DESIGN §27.9; `economy.place_marks`, `MapPlaceView.mark`): on
// the places the POV knows only, their home, then a property they hold a part of, then one for sale
// (an asking price) that isn't theirs, one mark a place in that order whatever the properties' ids;
// with it, the property the place is where the POV may know it (theirs, or one for sale they can
// see; the first by id between two alike), which the place sheet's Property here reads off the map.
// A place they can't see, a property they can't see, and someone else's not for sale go unmarked.

import { describe, expect, test } from "bun:test";
import type { EntityDef, PlaceDef, WorldDoc } from "../../../src/shared/world";
import { mapPlaceOf } from "../../../src/shared/maps";
import { createRegistry } from "../../../src/engine/registry-impl";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildMapView } from "../../../src/packs/space/core/view";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function place(id: string, name: string): PlaceDef {
  return { id, name, parent: "riverton", fields: {} };
}

function property(id: string, name: string, at: string, fields: EntityDef["fields"], extra: Partial<EntityDef> = {}): EntityDef {
  return { id, kind: "property", name, tier: "background", fields: { place: at, value: 30_000_000, ...fields }, relations: [], ...extra };
}

const solely = (party: string) => [{ party, role: "owner", share: 100 }];

/**
 * Riverton, Alex renting his apartment from Rosa: a lake cabin he holds half of with Jordan, a
 * duplex Maya has up for sale, a lot of hers that isn't, a lot Rosa has for sale that he can't know
 * of, and Jordan's house, for sale at a place Alex doesn't know; `patch` after.
 */
function riverton(patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  for (const p of [place("lake_cabin", "Lake cabin"), place("duplex_lot", "Duplex on Pine"), place("quiet_lot", "Lot on Oak"), place("hidden_lot", "Lot on Ash")]) world.places[p.id] = p;
  const add = (e: EntityDef): void => {
    world.entities[e.id] = e;
  };
  add(property("apt_unit", "Apartment 3C", "apartment", { owners: solely("rosa") }));
  add(property("cabin", "Lake cabin", "lake_cabin", { owners: [{ party: "you", role: "owner", share: 50 }, { party: "jordan", role: "owner", share: 50 }] }));
  add(property("duplex", "Duplex on Pine", "duplex_lot", { owners: solely("maya"), asking_price: 25_000_000 }));
  add(property("oak_lot", "Lot on Oak", "quiet_lot", { owners: solely("maya") }));
  add(property("ash_lot", "Lot on Ash", "hidden_lot", { owners: solely("rosa"), asking_price: 9_000_000 }, { visibility: "secret" }));
  add(property("jordan_home", "Jordan's house", "jordan_house", { owners: solely("jordan"), asking_price: 41_000_000 }));
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

const marks = (w: Working, who = "you") => w.ctx.query("economy.place_marks")(w.ctx, who);

describe("the places the map marks", () => {
  test("home, a property he holds a part of, one for sale: each with its property where he may know it; none where he may not", () => {
    expect(marks(riverton())).toEqual([
      // Rosa's, not for sale: his home all the same, its property not his to know.
      { place: "apartment", mark: "home" },
      { place: "duplex_lot", mark: "for_sale", property: "duplex" },
      { place: "lake_cabin", mark: "owned", property: "cabin" },
    ]);
  });

  test("his home is home before all else: with its property when it is his, or for sale", () => {
    const owned = riverton((world) => {
      const unit = world.entities.apt_unit;
      if (unit) unit.fields.owners = solely("you");
    });
    expect(marks(owned)[0]).toEqual({ place: "apartment", mark: "home", property: "apt_unit" });
    const listed = riverton((world) => {
      const unit = world.entities.apt_unit;
      if (unit) unit.fields.asking_price = 18_000_000;
    });
    expect(marks(listed)[0]).toEqual({ place: "apartment", mark: "home", property: "apt_unit" });
  });

  test("two properties at one place: his before one for sale whatever their ids, and the first by id between two for sale", () => {
    const w = riverton((world) => {
      world.entities.a_boathouse = property("a_boathouse", "Boathouse", "lake_cabin", { owners: solely("jordan"), asking_price: 4_000_000 });
      world.entities.pine_a = property("pine_a", "Duplex on Pine, unit A", "duplex_lot", { owners: solely("maya"), asking_price: 12_000_000 });
    });
    expect(marks(w).filter((m) => m.place !== "apartment")).toEqual([
      { place: "duplex_lot", mark: "for_sale", property: "duplex" },
      { place: "lake_cabin", mark: "owned", property: "cabin" },
    ]);
  });

  test("anyone's map: Rosa's marks her home, the flat she lets Alex, her lot no one else knows of and the duplex for sale", () => {
    expect(marks(riverton(), "rosa")).toEqual([
      { place: "apartment", mark: "owned", property: "apt_unit" },
      { place: "apartment_hall", mark: "home" },
      { place: "duplex_lot", mark: "for_sale", property: "duplex" },
      { place: "hidden_lot", mark: "owned", property: "ash_lot" },
    ]);
  });
});

describe("the map carries them", () => {
  test("each known place's mark and property ride on the map, where the place sheet reads them; a place he doesn't know carries none", () => {
    const w = riverton();
    const view = buildMapView(w.ctx);
    expect(mapPlaceOf(view, "lake_cabin")).toEqual({ name: "Lake cabin", known: true, mark: "owned", property: "cabin" });
    expect(mapPlaceOf(view, "duplex_lot")).toEqual({ name: "Duplex on Pine", known: true, mark: "for_sale", property: "duplex" });
    expect(mapPlaceOf(view, "apartment")).toMatchObject({ known: true, mark: "home" });
    expect(mapPlaceOf(view, "apartment")?.property).toBeUndefined();
    expect(mapPlaceOf(view, "quiet_lot")).toEqual({ name: "Lot on Oak", known: true });
    expect(mapPlaceOf(view, "hidden_lot")).toEqual({ name: "Lot on Ash", known: true });
    // Jordan's house is for sale, but Alex doesn't know the place: drawn or not, nothing of it shows.
    const house = mapPlaceOf(view, "jordan_house");
    expect(house?.mark).toBeUndefined();
    expect(house?.property).toBeUndefined();
  });
});
