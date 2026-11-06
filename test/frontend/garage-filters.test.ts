// The Garage's Sort and filter chips on Port Alder: Jordan's pickup, ATV and fishing boat, each of
// its own class at its own place, sorted by name, type or location; a type chip or a location chip
// shows only those; one vehicle shows no controls.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { Seg } from "../../src/frontend/components";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { buildGarageView, type GarageVehicle } from "../../src/packs/vehicles/core/view";
import { decodeGarageView, GarageChips, GarageControls, garageLocation, garageShown, garageType, type GaragePick } from "../../src/packs/vehicles/ui/panel";
import { startState } from "../packs/support";
import { expand, labelled, press, propsOf } from "../support/tree";

const reg = createRegistry(ALL_PACKS);

function jordansVehicles(): GarageVehicle[] {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.realism.levels.vehicles = 3;
  const view = decodeGarageView(JSON.parse(JSON.stringify(buildGarageView(new Working(reg, world, startState(world, reg)).ctx))));
  if (!view) throw new Error("no Garage");
  return view.vehicles;
}

const ANY: GaragePick = { sort: "name", type: null, place: null };
const names = (vs: readonly GarageVehicle[]): string[] => vs.map((v) => v.name);

describe("the Garage's Sort and filters", () => {
  const vehicles = jordansVehicles();
  const byName = ["Your ATV", "Your fishing boat", "Your pickup"];

  test("sorted by name, by type and by location", () => {
    expect(names(garageShown(vehicles, ANY))).toEqual(byName);
    const byType = [...vehicles].sort((a, b) => garageType(a).localeCompare(garageType(b)));
    expect(names(garageShown(vehicles, { ...ANY, sort: "type" }))).toEqual(names(byType));
    const byPlace = [...vehicles].sort((a, b) => garageLocation(a).localeCompare(garageLocation(b)));
    expect(names(garageShown(vehicles, { ...ANY, sort: "location" }))).toEqual(names(byPlace));
  });

  test("Sort, a type chip and a location chip each pick; the pick shows only those", () => {
    const picks: GaragePick[] = [];
    const tree = GarageControls({ vehicles, pick: ANY, onPick: (p) => picks.push(p) });
    press(labelled(tree, Seg, "Sort by"), "location");
    const [types, places] = propsOf(tree, GarageChips).map((p) => expand({ type: GarageChips, props: p }));
    const chip = (rows: unknown, value: string): void => (propsOf(rows, "button").find((b) => b["data-lre-garage-chip"] === value)?.onClick as () => void)();
    // "All" first, then each type, pressed only "All".
    const typeChips = propsOf(types, "button");
    expect(typeChips.map((b) => b["data-lre-garage-chip"])).toEqual(["", ...new Set(vehicles.map(garageType).sort((a, b) => a.localeCompare(b)))]);
    expect(typeChips.map((b) => b["aria-pressed"])).toEqual([true, false, false, false]);
    const boat = vehicles.find((v) => v.name === "Your fishing boat");
    if (!boat) throw new Error("no boat");
    chip(types, garageType(boat));
    chip(places, garageLocation(boat));
    expect(picks).toEqual([
      { ...ANY, sort: "location" },
      { ...ANY, type: garageType(boat) },
      { ...ANY, place: garageLocation(boat) },
    ]);
    expect(names(garageShown(vehicles, { ...ANY, type: garageType(boat) }))).toEqual(["Your fishing boat"]);
    expect(names(garageShown(vehicles, { ...ANY, place: garageLocation(boat) }))).toEqual(["Your fishing boat"]);
  });

  test("a picked chip shows pressed; one vehicle shows no controls", () => {
    const pickup = vehicles.find((v) => v.name === "Your pickup");
    if (!pickup) throw new Error("no pickup");
    const tree = GarageControls({ vehicles, pick: { ...ANY, place: garageLocation(pickup) }, onPick: () => undefined });
    const places = expand({ type: GarageChips, props: propsOf(tree, GarageChips)[1] });
    expect(propsOf(places, "button").filter((b) => b["aria-pressed"] === true).map((b) => b["data-lre-garage-chip"])).toEqual([garageLocation(pickup)]);
    expect(GarageControls({ vehicles: [pickup], pick: ANY, onPick: () => undefined })).toBeNull();
  });
});
