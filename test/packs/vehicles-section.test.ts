// The Vehicles section (DESIGN §6, §9.3): everything the player character may use, his own, his
// family's, and what is assigned or lent to him, each with whose it is, as he may know them; the
// ones away from his site fold into one line; a vehicle with no tank shows no fuel.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../src/shared/ids";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);

function vehicle(id: string, name: string, fields: EntityDef["fields"]): EntityDef {
  return { id, kind: "vehicle", name, tier: "background", fields: { class: "pickup_midsize", status: "ok", fuel_pct: 50, ...fields }, relations: [] };
}

function lines(patch: (w: WorldDoc) => void, level: Level = 3): string[] {
  const world = modernUsWorld("w", "R");
  world.realism.levels.vehicles = level;
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  return reg.renderers.filter((r) => r.slot === "vehicles").flatMap((r) => r.render(w.ctx));
}

describe("the Vehicles section", () => {
  test("his family's and a lent vehicle are listed with whose they are; a hidden owner is someone", () => {
    const out = lines((w) => {
      w.entities.riveras = { id: "riveras", kind: "household", name: "The Riveras", tier: "background", fields: {}, relations: [] };
      w.entities.you?.relations.push({ type: "member_of", to: "riveras" }, { type: "uses", to: "van", until: 5000 }, { type: "uses", to: "sedan" });
      w.entities.family_car = vehicle("family_car", "Family wagon", { owner: "riveras", place: "garage" });
      w.entities.van = vehicle("van", "Shop van", { owner: "rosa", place: "garage" });
      w.entities.ghost = { id: "ghost", kind: "person", name: "Victor Kane", tier: "background", fields: {}, relations: [], visibility: "secret" };
      w.entities.sedan = vehicle("sedan", "Black sedan", { owner: "ghost", place: "garage" });
      w.entities.stranger = vehicle("stranger", "Someone's hatchback", { owner: "jordan", place: "garage" });
    });
    const of = (name: string): string | undefined => out.find((l) => l.startsWith(`${name}:`));
    expect(of("Pickup truck")).toContain("yours");
    expect(of("Family wagon")).toContain("The Riveras");
    expect(of("Shop van")).toContain("Rosa Delgado");
    expect(of("Black sedan")).toBeDefined();
    expect(out.join("\n")).not.toContain("Victor");
    // Someone else's at his site is told as theirs, never as one he may use.
    expect(of("Someone's hatchback")).toContain("Jordan Price");
    expect(of("Someone's hatchback")).not.toMatch(/yours|to you/);
  });

  test("his family's at level 2 but not what is lent; at level 1 only his own in the short form", () => {
    const patch = (w: WorldDoc): void => {
      w.entities.riveras = { id: "riveras", kind: "household", name: "The Riveras", tier: "background", fields: {}, relations: [] };
      w.entities.you?.relations.push({ type: "member_of", to: "riveras" }, { type: "uses", to: "van" });
      w.entities.family_car = vehicle("family_car", "Family wagon", { owner: "riveras", place: "garage" });
      w.entities.van = vehicle("van", "Shop van", { owner: "rosa", place: "garage" });
    };
    const two = lines(patch, 2);
    expect(two.find((l) => l.startsWith("Family wagon:"))).toMatch(/The Riveras.*fuel/);
    expect(two.find((l) => l.startsWith("Shop van:"))).not.toMatch(/to you/);
    const one = lines(patch, 1);
    expect(one.find((l) => l.startsWith("Pickup truck:"))).toContain("runs fine");
    expect(one.join("\n")).not.toMatch(/to you|fuel/);
  });

  test("the ones away from his site fold into one line, by where they are", () => {
    const out = lines((w) => {
      w.places.ranch = { id: "ranch", name: "Cedar Draw", fields: {} };
      w.places.boathouse = { id: "boathouse", name: "the boathouse", parent: "ranch", fields: {} };
      for (let i = 0; i < 3; i++) w.entities[`atv${i}`] = vehicle(`atv${i}`, `ATV ${i}`, { owner: "you", place: "ranch" });
      w.entities.skiff = vehicle("skiff", "Skiff", { owner: "you", place: "boathouse" });
    });
    expect(out.filter((l) => /^(ATV|Skiff)/.test(l))).toEqual([]);
    const elsewhere = out.filter((l) => l.startsWith("Elsewhere:"));
    expect(elsewhere).toHaveLength(1);
    expect(elsewhere[0]).toContain("4");
    expect(elsewhere[0]).toContain("3 at Cedar Draw");
    expect(elsewhere[0]).toContain("1 at the boathouse");
    expect(out.some((l) => l.startsWith("Pickup truck:"))).toBe(true);
  });

  test("a trailer has no tank: no fuel or range", () => {
    const out = lines((w) => {
      w.entities.trailer = vehicle("trailer", "Boat trailer", { owner: "you", place: "garage", class: "utility_trailer" });
    });
    const trailer = out.find((l) => l.startsWith("Boat trailer:"));
    expect(trailer).toBeDefined();
    expect(trailer).not.toMatch(/fuel|~\d/);
    expect(out.find((l) => l.startsWith("Pickup truck:"))).toMatch(/fuel \d+%/);
  });
});
