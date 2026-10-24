import { describe, expect, test } from "bun:test";
import type { GridDef, WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { paramCandidates, resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { runTimelapse } from "../../../src/engine/time";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { modernUsWorld } from "../riverton";
import { findRoute, routeAt } from "../../../src/packs/space/core/travel";
import { findPath } from "../../../src/shared/grid";
import { buildMapView } from "../../../src/packs/space/core/view";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

describe("space: routes", () => {
  test("the fastest walking route uses authored routes and the place hierarchy", () => {
    const world = modernUsWorld("w", "R");
    const plan = findRoute(world, "apartment", "office", "walk");
    expect(plan?.minutes).toBe(30); // 5 out of the building + 25 on foot (beats 5 + 12 + 15 via the café)
    expect(plan?.legs.map((l) => l.to)).toEqual(["apartment_bldg", "office"]);
    expect(findRoute(world, "apartment", "lake", "walk")).toBeNull();
    const drive = findRoute(world, "garage", "lake", "road");
    expect([drive?.minutes, drive?.distanceKm]).toEqual([37, 48]);
    expect(findRoute(world, "lake", "trailhead", "water")?.minutes).toBe(50);
  });

  test("levels: nominal moves at 1, routes at 2, terrain at 4", () => {
    const world = modernUsWorld("w", "R");
    const s = startState(world);
    s.realism.levels.space = 1;
    expect(routeAt(reg.context(world, s), "apartment", "lake", "walk")?.minutes).toBe(15);
    s.realism.levels.space = 2;
    expect(routeAt(reg.context(world, s), "riverton", "trailhead", "offroad")?.minutes).toBe(40);
    s.realism.levels.space = 4;
    expect(routeAt(reg.context(world, s), "riverton", "trailhead", "offroad")?.minutes).toBe(Math.round(40 * 1.4));
  });

  test("the go action takes the walk's time and moves the POV; story first, it goes where only a road leads, and under the travel simulation it needs the walk", () => {
    const world = modernUsWorld("w", "R");
    world.realism.levels.space = 2;
    const w = new Working(reg, world, startState(world));
    const r = resolveAction(reg, w, { action: "go", params: { to: "cafe" } }, createRng("g"));
    expect(r.ok).toBe(true);
    expect(r.duration).toBe(17);
    expect(w.state.entities.you?.fields.place).toBe("cafe");
    const lake = resolveAction(reg, new Working(reg, world, w.state), { action: "go", params: { to: "lake" } }, createRng("g2"));
    expect(lake.ok).toBe(true);
    world.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: 3 }, travelSimulation: true };
    const nowhere = resolveAction(reg, new Working(reg, world, w.state), { action: "go", params: { to: "lake" } }, createRng("g2"));
    expect(nowhere.failed?.code).toBe("requirement");
  });

  test("Go to offers places, not people or things: visible ones, those a route joins to here first", () => {
    const world = modernUsWorld("w", "R");
    world.places.hideout = { id: "hideout", name: "A hideout", fields: {}, visibility: "secret" };
    const state = startState(world);
    const go = reg.actions.get("go");
    const options = go ? paramCandidates(reg, world, state, go, "to") : [];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((id) => world.places[id] !== undefined)).toBe(true);
    expect(options).not.toContain("apartment");
    expect(options).not.toContain("hideout");
    expect(options[0]).toBe("apartment_bldg");
    const w = new Working(reg, world, state);
    expect(resolveAction(reg, w, { action: "go", params: { to: "maya" } }, createRng("g3")).failed?.code).toBe("bad_param");
  });

  test("the location proposal rejects unknown places; a move no route reaches lands, unless the travel simulation is on", () => {
    const world = modernUsWorld("w", "R");
    world.realism.levels.space = 2;
    const s = startState(world);
    const ctx = reg.context(world, s);
    const ch = reg.proposals.get("location");
    expect(ch?.validate({ entity: "you", place: "atlantis" }, ctx)?.code).toBe("missing_place");
    expect(ch?.validate({ entity: "you", place: "cafe" }, ctx)).toBeNull();
    expect(ch?.toEffects({ entity: "you", place: "cafe" }, ctx)).toEqual([{ type: "move", args: { entity: "you", to: "cafe" } }]);
    world.places.islet = { id: "islet", name: "The islet", fields: {} };
    s.entities.you!.fields.place = "islet";
    expect(ch?.validate({ entity: "you", place: "cafe" }, reg.context(world, s))).toBeNull();
    world.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: 3 }, travelSimulation: true };
    // A move's own refusal, never a payment's decline (`declined`): its chip ends the sentence.
    expect(ch?.validate({ entity: "you", place: "cafe" }, reg.context(world, s))).toEqual({ code: "no_route", reason: `There's no way from The islet to ${world.places.cafe?.name}` });
  });

  test("a POV stranded where no route leads home stays put through a timelapse; its routine resumes once it can get there", () => {
    const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
    for (const d of Object.keys(world.realism.levels) as (keyof typeof world.realism.levels)[]) world.realism.levels[d] = 3;
    const s = startState(world);
    s.entities[world.pov]!.fields.place = "gull_island";
    const w = new Working(reg, world, s);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 24 * 60 }, { runSeed: "r", overrides: ALL_NOTE });
    expect("code" in out).toBe(false);
    expect(w.state.entities[world.pov]?.fields.place).toBe("gull_island");
    expect(w.events.some((e) => e.type === "set" && e.entity === world.pov && e.field === "place")).toBe(false);
    const home = new Working(reg, world, startState(world));
    runTimelapse(reg, home, { type: "duration", minutes: 24 * 60 }, { runSeed: "r", overrides: ALL_NOTE });
    expect(home.events.some((e) => e.type === "set" && e.entity === world.pov && e.field === "place")).toBe(true);
  });

  test("the map lists known places and travel options, including the POV's vehicles", () => {
    const world = modernUsWorld("w", "R");
    world.entities.you!.fields.place = "garage";
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.scopes.some((s) => s.places.some((p) => p.id === "maya_flat"))).toBe(false); // known_by, not known yet
    expect(view.travel.some((t) => t.action === "go" && t.to === "cafe")).toBe(true);
    expect(view.travel.some((t) => t.action === "drive" && t.to === "lake" && t.params.vehicle === "truck")).toBe(true);
  });
});

describe("space: A* on grids", () => {
  const grid: GridDef = {
    id: "g",
    width: 5,
    height: 4,
    terrain: ["", "", "", "", "", "", "mud", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    blocked: [2, 7, 12],
    zones: {},
  };

  test("finds the cheapest path around blocked cells and costly terrain", () => {
    const p = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(p?.cells[0]).toEqual({ x: 0, y: 0 });
    expect(p?.cells.at(-1)).toEqual({ x: 4, y: 0 });
    expect(p?.cells.some((c) => c.y * 5 + c.x === 2 || c.y * 5 + c.x === 7 || c.y * 5 + c.x === 12)).toBe(false);
    expect(p?.cost).toBe(10); // down to row 3, across, back up
  });

  test("blocked targets and the expansion cap return null", () => {
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, 3)).toBeNull();
  });
});
