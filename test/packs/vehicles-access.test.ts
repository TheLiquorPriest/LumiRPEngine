// What someone may drive, by the one reader (DESIGN §9.3; `vehiclesFor`, the `vehicles.for` query):
// over the access resolver, his own (alone or on an owners list), his household's, his company's,
// his employer's where he works, one assigned or lent to him, and one an owner's standing
// permission lets him use; each with what his use rests on, whose it is, whether it is his own and
// whether he may lend it. Never one only because nobody owns it, a stranger's, one whose lend ran
// out, one gone, nor his employer's away from work. The Vehicles section's ladder tells his own
// from Vehicles 1, a group's from 2 (his company's among them: it is the company's, even to the
// owner who runs it) and what is lent, permitted or his at work from 3; the Garage and Drive read
// the same answer.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../src/shared/ids";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { accessFor } from "../../src/engine/access";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { buildMapView } from "../../src/packs/space/core/view";
import { useTier, vehiclesFor } from "../../src/packs/vehicles/core/access";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);

/** A week after the fixture's start: a lend that runs till then is in force. */
const NEXT_WEEK = 7 * 24 * 60;

function vehicle(id: string, name: string, fields: EntityDef["fields"]): EntityDef {
  return { id, kind: "vehicle", name, tier: "background", fields: { class: "pickup_midsize", status: "ok", fuel_pct: 50, ...fields }, relations: [] };
}

/**
 * Riverton at Vehicles `level`, Alex with a household, a company of his own and a job at
 * Brightline, and a vehicle for each way he may drive one (his pickup is the fixture's), with some
 * he may not; `patch` after.
 */
function riverton(level: Level = 3, patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.vehicles = level;
  const add = (e: EntityDef): void => {
    world.entities[e.id] = e;
  };
  add({ id: "riveras", kind: "household", name: "The Riveras", tier: "background", fields: {}, relations: [] });
  add({ id: "hauling", kind: "business", name: "Rivera Hauling", tier: "background", fields: { place: "office", owners: [{ party: "you", role: "owner", share: 100 }] }, relations: [] });
  add({ id: "job_you", kind: "job", name: "Office clerk", tier: "background", fields: { worker: "you", employer: "brightline" }, relations: [] });
  world.entities.you?.relations.push({ type: "member_of", to: "riveras" }, { type: "uses", to: "van", until: NEXT_WEEK }, { type: "uses", to: "sedan" }, { type: "uses", to: "returned", until: 1 });
  world.entities.maya?.relations.push({ type: "permits", to: "you" });
  // His to drive.
  add(vehicle("jeep", "Shared jeep", { owners: [{ party: "rosa", role: "owner", share: 50 }, { party: "you", role: "owner", share: 50 }], place: "garage" }));
  add(vehicle("wagon", "Family wagon", { owner: "riveras", place: "garage" }));
  add(vehicle("box", "Hauling box truck", { owner: "hauling", place: "office", class: "box_truck" }));
  add(vehicle("work_van", "Brightline van", { owner: "brightline", place: "office", class: "cargo_van" }));
  add(vehicle("hatch", "Maya's hatchback", { owner: "maya", place: "cafe", class: "compact_car" }));
  add(vehicle("van", "Rosa's van", { owner: "rosa", place: "garage", class: "cargo_van" }));
  add(vehicle("sedan", "Black sedan", { owner: "jordan", place: "garage", class: "midsize_sedan" }));
  // Not his.
  add(vehicle("stranger", "Jordan's coupe", { owner: "jordan", place: "garage", class: "compact_car" }));
  add(vehicle("returned", "Rosa's old hatchback", { owner: "rosa", place: "garage", class: "compact_car" }));
  add(vehicle("abandoned", "Abandoned sedan", { place: "park", class: "midsize_sedan" }));
  add(vehicle("wreck", "Wrecked pickup", { owner: "you", place: "garage", gone: true }));
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** The Vehicles section's lines, as the narrator is told them. */
const told = (w: Working): string[] => reg.renderers.filter((r) => r.slot === "vehicles").flatMap((r) => r.render(w.ctx));
const line = (lines: readonly string[], name: string): string | undefined => lines.find((l) => l.startsWith(`${name}:`));

describe("what someone may drive", () => {
  test("each way he may drive one, with what it rests on, whose it is, whether it is his own and whether he may lend it", () => {
    const w = riverton();
    const uses = vehiclesFor(w.ctx, "you");
    expect(uses.map((u) => ({ id: u.id, basis: u.use.basis, via: u.use.via ?? null, owner: u.owner, mine: u.mine, canLend: u.canLend }))).toEqual([
      // His company's: through the company, which he runs, so he may lend it; never his own.
      { id: "box", basis: "owner", via: "hauling", owner: "hauling", mine: false, canLend: true },
      { id: "hatch", basis: "permit", via: "maya", owner: "maya", mine: false, canLend: false },
      // On an owners list with Rosa, who comes first: his own all the same.
      { id: "jeep", basis: "owner", via: null, owner: "rosa", mine: true, canLend: true },
      { id: "sedan", basis: "grant", via: null, owner: "jordan", mine: false, canLend: false },
      { id: "truck", basis: "owner", via: null, owner: "you", mine: true, canLend: true },
      { id: "van", basis: "grant", via: null, owner: "rosa", mine: false, canLend: false },
      { id: "wagon", basis: "member", via: "riveras", owner: "riveras", mine: false, canLend: false },
      // His employer's, where he works: by his job.
      { id: "work_van", basis: "staff", via: "brightline", owner: "brightline", mine: false, canLend: false },
    ]);
    // A lend runs till its end; an assignment stands.
    expect(uses.find((u) => u.id === "van")?.use).toMatchObject({ grant: "loan", until: NEXT_WEEK });
    expect(uses.find((u) => u.id === "sedan")?.use).toMatchObject({ grant: "assign" });
    expect(uses.find((u) => u.id === "work_van")?.use.by).toBe("job_you");
    // The query every reader calls answers the same, by id.
    expect(w.ctx.query("vehicles.for")(w.ctx, "you")).toEqual(uses.map((u) => u.id));
  });

  test("never one only because nobody owns it, a stranger's, one whose lend ran out, one gone, nor his employer's away from work", () => {
    const w = riverton(3, (world) => {
      const van = world.entities.work_van;
      if (van) van.fields.place = "cafe";
    });
    const drives = w.ctx.query("vehicles.for")(w.ctx, "you");
    for (const id of ["abandoned", "stranger", "returned", "wreck", "work_van"]) expect(drives).not.toContain(id);
    // The resolver lets anyone use what nobody owns; the reader never counts that.
    expect(accessFor(w.ctx, "you", "abandoned").use?.basis).toBe("public");
    // The reader answers for anyone: Rosa drives her own and the jeep she shares, never Alex's pickup.
    expect(w.ctx.query("vehicles.for")(w.ctx, "rosa")).toEqual(["jeep", "returned", "van"]);
  });
});

describe("the ladder, the Garage and Drive read the one answer", () => {
  test("his own from Vehicles 1, a group's from 2 (his company's the company's), what is lent, permitted or his at work from 3", () => {
    expect(Object.fromEntries(vehiclesFor(riverton().ctx, "you").map((u) => [u.id, useTier(u.use)]))).toEqual({ box: 2, hatch: 3, jeep: 1, sedan: 3, truck: 1, van: 3, wagon: 2, work_van: 3 });
    // Away from where he is, each is told only from its level: the company's box truck as the company's, never his.
    const one = told(riverton(1));
    expect(line(one, "Pickup truck")).toBeDefined();
    expect(line(one, "Hauling box truck")).toBeUndefined();
    const two = told(riverton(2));
    expect(line(two, "Hauling box truck")).toContain("Rivera Hauling's");
    expect(line(two, "Hauling box truck")).not.toContain("yours");
    expect([line(two, "Brightline van"), line(two, "Maya's hatchback")]).toEqual([undefined, undefined]);
    const three = told(riverton(3));
    expect(line(three, "Brightline van")).toContain("Brightline Logistics's, yours to use at work");
    expect(line(three, "Maya's hatchback")).toContain("Maya Chen's, yours to use");
  });

  test("the Garage lists what the reader gives, each saying whose it is; Drive offers his to drive, never a stranger's beside them", () => {
    const w = riverton();
    const garage = buildGarageView(w.ctx);
    expect(garage.vehicles.map((v) => v.id)).toEqual(vehiclesFor(w.ctx, "you").map((u) => u.id));
    const card = (id: string) => garage.vehicles.find((v) => v.id === id);
    expect(card("truck")).toMatchObject({ owner: "self", access: "Yours", mine: true, canLend: true });
    expect(card("box")).toMatchObject({ owner: "other", ownerName: "Rivera Hauling", access: "Rivera Hauling's", mine: false, canLend: true });
    expect(card("wagon")).toMatchObject({ owner: "household", access: "Your household's", mine: false });
    // From his apartment, with the building's garage below him: Drive takes what the reader gives there.
    const driven = new Set(buildMapView(w.ctx).travel.flatMap((r) => (typeof r.params.vehicle === "string" ? [r.params.vehicle] : [])));
    for (const id of ["truck", "jeep", "wagon", "van", "sedan"]) expect(driven.has(id)).toBe(true);
    for (const id of ["stranger", "returned", "wreck"]) expect(driven.has(id)).toBe(false);
  });
});
