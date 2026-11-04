// A thing's size and what a holder takes (ITEMS-SPEC §4.1, §12 Phase 1), read when asked and never
// written, on Port Alder: its own installed relay is Built-in, its truck bed a part and its toolbox
// Armful (the Modern US containers row); a home_furnishings refrigerator is Furniture, by its row or
// by its category alone; a misc thing is unknown. A thing's own `size` wins, and the world's things
// config moves the ceiling and the bounds. Sizes by name (N3): a catalog with no size column, as an
// older build copied it, sizes its fridge Furniture and its TV Heavy by name, a TV remote staying a
// remote; the world's entry overrides a name, null takes one out, and storage furniture holds things.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { DataTable } from "../../src/shared/tables";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { thingsConfigOf } from "../../src/shared/things";
import { createRegistry } from "../../src/engine/registry-impl";
import { holdsOf, sizeOf } from "../../src/engine/things";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function thing(id: string, name: string, fields: JsonObject, kind = "item"): EntityDef {
  return { id, kind, name, tier: "background", fields: { place: "harbor_street_114", ...fields }, relations: [] };
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

/**
 * The world's own price catalog as an older build copied it: no size, aliases or holds column, and
 * rows of its own under its own ids, a refrigerator and a TV in household goods and electronics.
 */
function sizeless(world: WorldDoc): void {
  const catalog = world.tables["economy.catalog"] as DataTable | undefined;
  if (!catalog) throw new Error("no catalog");
  for (const column of ["size", "aliases", "holds"]) delete catalog.columns[column];
  for (const row of Object.values(catalog.rows)) for (const column of ["size", "aliases", "holds"]) delete row[column];
  catalog.rows.pa_fridge = { name: "Refrigerator", category: "household_goods", unit: "each", price_cents: { min: 50000, typical: 90000, max: 200000 } };
  catalog.rows.pa_tv = { name: "Flat-screen television, 55 in", category: "electronics", unit: "each", price_cents: { min: 30000, typical: 50000, max: 90000 } };
  catalog.rows.pa_remote = { name: "TV remote", category: "electronics", unit: "each", price_cents: { min: 1000, typical: 2000, max: 4000 } };
}

describe("a thing's size (ITEMS-SPEC §4.1)", () => {
  test("Port Alder's own things: the installed fuel-pump relay is Built-in, the truck bed a part, the toolbox Armful by its row", () => {
    const w = portAlder();
    expect(sizeOf(w.ctx, "relay_fuel_pump")).toEqual({ size: "builtin", from: "fixed" });
    expect(sizeOf(w.ctx, "pov_truck_bed")).toEqual({ size: "part", from: "part" });
    expect(sizeOf(w.ctx, "pov_toolbox")).toEqual({ size: "armful", from: "row" });
    // A vehicle is held as Furniture, and only by another vehicle.
    expect(sizeOf(w.ctx, "pov_truck")).toEqual({ size: "vehicle", from: "vehicle" });
    // Everyday carry is Pocket by its row.
    expect(sizeOf(w.ctx, "pov_keys")).toEqual({ size: "pocket", from: "row" });
  });

  test("a home_furnishings refrigerator is Furniture, by its catalog row or by its category alone; a misc thing is unknown", () => {
    const w = portAlder([
      thing("fridge", "Refrigerator", { catalog: "refrigerator" }),
      thing("old_fridge", "Old sideboard", { category: "home_furnishings" }),
      thing("trinket", "Odd little trinket", { category: "misc" }),
      thing("mystery", "Something wrapped in a towel", {}),
    ]);
    expect(sizeOf(w.ctx, "fridge")).toEqual({ size: "furniture", from: "row" });
    expect(sizeOf(w.ctx, "old_fridge")).toEqual({ size: "furniture", from: "category" });
    expect(sizeOf(w.ctx, "trinket")).toEqual({ size: "unknown", from: "unknown" });
    expect(sizeOf(w.ctx, "mystery")).toEqual({ size: "unknown", from: "unknown" });
  });

  test("the first answer wins: its own size, then fixed, the part trait, its row, its volume, its category", () => {
    const w = portAlder([
      thing("small_fridge", "Fridge", { catalog: "refrigerator", size: "heavy" }),
      thing("bolted_safe", "Safe", { catalog: "refrigerator", fixed: true }),
      thing("cabinet", "Kitchen cabinet", { part: true, category: "home_furnishings" }),
      thing("crate", "Crate", { volume_l: 120, category: "tools_hardware" }),
      thing("jar", "Jar of screws", { volume_l: 0.4 }),
      thing("hammer", "Hammer", { category: "tools_hardware" }),
    ]);
    expect(sizeOf(w.ctx, "small_fridge")).toEqual({ size: "heavy", from: "size" });
    expect(sizeOf(w.ctx, "bolted_safe")).toEqual({ size: "builtin", from: "fixed" });
    expect(sizeOf(w.ctx, "cabinet")).toEqual({ size: "part", from: "part" });
    expect(sizeOf(w.ctx, "crate")).toEqual({ size: "heavy", from: "volume" });
    expect(sizeOf(w.ctx, "jar")).toEqual({ size: "pocket", from: "volume" });
    expect(sizeOf(w.ctx, "hammer")).toEqual({ size: "hand", from: "category" });
  });

  test("the world's things config sizes a category its own way, unsizes one, and moves the volume bounds", () => {
    const w = portAlder([thing("hammer", "Hammer", { category: "tools_hardware" }), thing("fridge", "Old sideboard", { category: "home_furnishings" }), thing("crate", "Crate", { volume_l: 120 })], (world) => {
      world.packs.gear = { version: 1, config: { sizes: { byCategory: { tools_hardware: "armful", home_furnishings: null }, byVolume: { heavy: 100 } } } };
    });
    expect(sizeOf(w.ctx, "hammer")).toEqual({ size: "armful", from: "category" });
    expect(sizeOf(w.ctx, "fridge")).toEqual({ size: "unknown", from: "unknown" });
    expect(sizeOf(w.ctx, "crate")).toEqual({ size: "furniture", from: "volume" });
  });
});

describe("sizes by name (ITEMS-SPEC §4.1)", () => {
  test("a catalog with no size column: its refrigerator reads Furniture and its TV Heavy by name, its TV remote Hand by its category", () => {
    const w = portAlder([thing("fridge", "Refrigerator", { catalog: "pa_fridge" }), thing("tv", "Flat-screen television, 55 in", { catalog: "pa_tv" }), thing("tvs", "TVs", { catalog: "pa_tv" }), thing("remote", "TV remote", { catalog: "pa_remote" })], sizeless);
    expect(sizeOf(w.ctx, "fridge")).toEqual({ size: "furniture", from: "name" });
    expect(sizeOf(w.ctx, "tv")).toEqual({ size: "heavy", from: "name" });
    expect(sizeOf(w.ctx, "tvs")).toEqual({ size: "heavy", from: "name" });
    // The head-noun rule: a TV remote is a remote.
    expect(sizeOf(w.ctx, "remote")).toEqual({ size: "hand", from: "category" });
    // Its row's name sizes a thing named otherwise, and so do its aliases; a longer phrase wins.
    const named = portAlder([thing("gift", "Birthday present", { catalog: "pa_fridge" }), thing("aliased", "Big box", { aliases: ["water heater"] }), thing("mini", "Mini-fridge", {}), thing("micro", "Microwave oven", {})], sizeless);
    expect(sizeOf(named.ctx, "gift")).toEqual({ size: "furniture", from: "name" });
    expect(sizeOf(named.ctx, "aliased")).toEqual({ size: "furniture", from: "name" });
    expect(sizeOf(named.ctx, "mini")).toEqual({ size: "heavy", from: "name" });
    expect(sizeOf(named.ctx, "micro")).toEqual({ size: "armful", from: "name" });
  });

  test("its own size, its row's and its volume still win over its name", () => {
    const w = portAlder([thing("own", "Refrigerator", { catalog: "pa_fridge", size: "heavy" }), thing("row", "Refrigerator", { catalog: "refrigerator" }), thing("litres", "Refrigerator", { volume_l: 30 })], sizeless);
    expect(sizeOf(w.ctx, "own")).toEqual({ size: "heavy", from: "size" });
    expect(sizeOf(w.ctx, "litres")).toEqual({ size: "armful", from: "volume" });
    const shipped = portAlder([thing("row", "Refrigerator", { catalog: "refrigerator" })]);
    expect(sizeOf(shipped.ctx, "row")).toEqual({ size: "furniture", from: "row" });
  });

  test("the world's entry overrides a shipped name, keeping what it leaves out; null takes one out; a new name sizes too", () => {
    const w = portAlder([thing("fridge", "Refrigerator", { catalog: "pa_fridge" }), thing("tv", "Television", {}), thing("piano", "Upright piano", {})], (world) => {
      sizeless(world);
      world.packs.gear = { version: 1, config: { sizes: { byName: { tv: "armful", fridge: null, Piano: { size: "furniture" } } } } };
    });
    expect(sizeOf(w.ctx, "tv")).toEqual({ size: "armful", from: "name" });
    expect(thingsConfigOf(w.world).sizes.byName.tv).toEqual({ size: "armful", also: ["television"] });
    // Without its entry, a household good is Hand by its category.
    expect(sizeOf(w.ctx, "fridge")).toEqual({ size: "hand", from: "category" });
    expect(sizeOf(w.ctx, "piano")).toEqual({ size: "furniture", from: "name" });
  });

  test("storage furniture holds things by its name, as a plain thing; a row's holds hold too; a plain thing else holds nothing", () => {
    const w = portAlder([thing("wardrobe", "Oak wardrobe", {}), thing("dresser", "Dresser", {}), thing("fridge", "Refrigerator", { catalog: "refrigerator" }), thing("hammer", "Hammer", { category: "tools_hardware" })]);
    expect(holdsOf(w.ctx, "wardrobe")).toBe("armful");
    expect(holdsOf(w.ctx, "dresser")).toBe("hand");
    expect(holdsOf(w.ctx, "fridge")).toBe("armful");
    expect(holdsOf(w.ctx, "hammer")).toBeNull();
  });
});

describe("what a holder takes (ITEMS-SPEC §4.1)", () => {
  test("a person up to the ceiling, a vehicle Furniture, a container its own or its row's holds, else its capacity, else Hand", () => {
    const w = portAlder([
      thing("tote", "Canvas tote", { capacity_l: 30 }, "container"),
      thing("tin", "Tin", {}, "container"),
      thing("chest", "Sea chest", { holds: "heavy", capacity_l: 2 }, "container"),
    ]);
    expect(holdsOf(w.ctx, "pov")).toBe("armful");
    expect(holdsOf(w.ctx, "pov_truck")).toBe("furniture");
    expect(holdsOf(w.ctx, "pov_toolbox")).toBe("hand");
    expect(holdsOf(w.ctx, "pov_truck_bed")).toBe("furniture");
    expect(holdsOf(w.ctx, "pov_wallet")).toBe("pocket");
    // 30 litres reaches the Hand bound (5) and not the Armful one (40): it surely takes Hand things.
    expect(holdsOf(w.ctx, "tote")).toBe("hand");
    expect(holdsOf(w.ctx, "tin")).toBe("hand");
    expect(holdsOf(w.ctx, "chest")).toBe("heavy");
    // What holds nothing.
    expect(holdsOf(w.ctx, "pov_keys")).toBeNull();
  });

  test("the world's ceiling is the largest thing a person carries", () => {
    const w = portAlder([], (world) => {
      world.packs.gear = { version: 1, config: { sizes: { ceiling: "hand" } } };
    });
    expect(holdsOf(w.ctx, "pov")).toBe("hand");
  });
});
