// The map's scopes (issue #10): every place with places inside it is a map of its own. A scope draws
// only its children, at their cells on its grid when it has one (the hall's rooms on its 23 × 13
// ground floor, the buildings round Brindlemere's market square), else on the node layout; the map
// opens on the scope around the POV, breadcrumbs lead out, a child with places inside it opens, and
// `known` follows what the POV can see.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { blankWorld, migrateWorld } from "../../../src/engine/authoring";
import { createRegistry } from "../../../src/engine/registry-impl";
import { paramCandidates } from "../../../src/engine/resolve";
import { typedIntent } from "../../../src/engine/typed-intent";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { HIDDEN_PLACE_NAME } from "../../../src/engine/visibility";
import { buildMapView, type MapView } from "../../../src/packs/space/core/view";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function starter(id: string): WorldDoc {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no starter ${id}`);
  return make("w", id);
}

function scopeOf(view: MapView, id: string | null) {
  const scope = view.scopes.find((s) => s.id === id);
  if (!scope) throw new Error(`no scope ${id}`);
  return scope;
}

describe("map scopes", () => {
  test("Harrowmere opens on the hall: its rooms at their cells on the ground floor, the floor drawn, breadcrumbs out", () => {
    const world = starter("mystery_manor");
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.scope).toBe("harrowmere_hall");
    const hall = scopeOf(view, "harrowmere_hall");
    expect(hall.grid && [hall.grid.width, hall.grid.height]).toEqual([23, 13]);
    // Each room sits at its own cell's centre, inside the grid.
    for (const room of ["entrance_hall", "library", "study", "drawing_room", "dining_room", "kitchen", "conservatory"]) {
      const cell = world.places[room]?.cell;
      expect(hall.places.find((p) => p.id === room)).toMatchObject({ x: (cell?.x ?? -1) + 0.5, y: (cell?.y ?? -1) + 0.5 });
    }
    // Rooms without a cell (another floor, the cellar) sit below the grid, not on it.
    for (const id of ["upper_floor", "cellar"]) expect(hall.places.find((p) => p.id === id)?.y ?? 0).toBeGreaterThan(13);
    expect(hall.frame.height).toBeGreaterThan(13);
    // Only the hall's own rooms: nothing from the estate around it.
    expect(hall.places.map((p) => p.id).sort()).toEqual(Object.values(world.places).filter((p) => p.parent === "harrowmere_hall").map((p) => p.id).sort());
    expect(hall.trail).toEqual([
      { id: null, name: "World" },
      { id: "harrowmere_estate", name: "Harrowmere Estate" },
    ]);
    // The trail leads to scopes that exist, and the estate opens back into the hall.
    for (const crumb of hall.trail) expect(view.scopes.some((s) => s.id === crumb.id)).toBe(true);
    expect(scopeOf(view, "harrowmere_estate").places.some((p) => p.id === "harrowmere_hall")).toBe(true);
    expect(view.path).toEqual(["harrowmere_estate", "harrowmere_hall", "entrance_hall"]);
  });

  test("Brindlemere opens on the market square the POV stands in, with the buildings round it on the square's grid", () => {
    const world = starter("fantasy_town");
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.here).toBe("market_square");
    expect(view.scope).toBe("market_square");
    const square = scopeOf(view, "market_square");
    expect(square.grid && [square.grid.width, square.grid.height]).toEqual([14, 10]);
    expect(square.places.map((p) => [p.id, p.x, p.y])).toEqual([
      ["chapel_quiet_bell", 2.5, 8.5],
      ["crooked_kettle", 2.5, 1.5],
      ["dunmore_forge", 12.5, 8.5],
      ["reeves_hall", 6.5, 1.5],
      ["wren_cottage", 11.5, 1.5],
    ]);
    expect(square.trail.map((c) => c.name)).toEqual(["World", "Wend Vale", "Brindlemere"]);
  });

  test("every scope draws only its own children, each place in exactly one frame", () => {
    for (const id of ["mystery_manor", "fantasy_town", "modern_slice_of_life"]) {
      const world = starter(id);
      const view = buildMapView(reg.context(world, startState(world)));
      const seen = new Map<string, number>();
      for (const scope of view.scopes) {
        for (const place of scope.places) {
          expect(world.places[place.id]?.parent ?? null).toBe(scope.id);
          expect([place.x >= 0, place.x <= scope.frame.width, place.y >= 0, place.y <= scope.frame.height]).toEqual([true, true, true, true]);
          seen.set(place.id, (seen.get(place.id) ?? 0) + 1);
        }
        for (const route of scope.routes) expect(scope.places.some((p) => p.id === route.from) && scope.places.some((p) => p.id === route.to)).toBe(true);
      }
      expect([...seen.values()].every((n) => n === 1)).toBe(true);
    }
  });

  test("with no grid around the POV the map opens on its place's parent, the places laid out as nodes", () => {
    const world = starter("modern_slice_of_life");
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.scope).toBe("port_alder");
    const town = scopeOf(view, "port_alder");
    expect(town.grid).toBeUndefined();
    expect(town.places.length).toBe(Object.values(world.places).filter((p) => p.parent === "port_alder").length);
    expect(scopeOf(view, null).places.map((p) => p.id)).toEqual(["chicago_il", "lakeshore_county"]);
  });

  test("a place opens when it has places inside it to show or a grid; a secret place inside keeps its parent closed", () => {
    const world = starter("fantasy_town");
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.scopes.some((s) => s.id === "brindlemere")).toBe(true);
    // The chapel's only room is the secret cistern: nothing to open, and the cistern is nowhere.
    expect(view.scopes.some((s) => s.id === "chapel_quiet_bell")).toBe(false);
    expect(view.scopes.some((s) => s.places.some((p) => p.id === "chapel_cistern"))).toBe(false);
    expect(view.travel.some((t) => t.to === "chapel_cistern")).toBe(false);
    // A grid opens on its own, with no places in it (the marina).
    const alder = starter("modern_slice_of_life");
    const marina = scopeOf(buildMapView(reg.context(alder, startState(alder))), "alder_harbor_marina");
    expect(marina.places).toEqual([]);
    expect(marina.grid?.width).toBe(18);
  });

  test("known follows what the POV can see: a place known to others is left off until the POV knows it; one the POV is inside shows as somewhere, and so does its room", () => {
    const world = modernUsWorld("w", "R");
    world.places.maya_kitchen = { id: "maya_kitchen", name: "Maya's kitchen", parent: "maya_flat", fields: {} };
    const state = startState(world);
    const town = (v: MapView) => scopeOf(v, "riverton").places;
    expect(town(buildMapView(reg.context(world, state))).some((p) => p.id === "maya_flat")).toBe(false);
    state.entities.you!.relations.push({ type: "knows", to: "maya_flat" });
    expect(town(buildMapView(reg.context(world, state))).find((p) => p.id === "maya_flat")?.known).toBe(true);
    state.entities.you!.relations = state.entities.you!.relations.filter((r) => r.to !== "maya_flat");
    state.entities.you!.fields.place = "maya_kitchen";
    const inside = buildMapView(reg.context(world, state));
    // Inside it without knowing it: drawn, but by a stand-in, never by its own id or name.
    expect(JSON.stringify(inside)).not.toContain("maya_flat");
    expect(JSON.stringify(inside)).not.toContain("Maya's flat");
    const flat = town(inside).find((p) => !p.known);
    expect(flat?.name).toBe(HIDDEN_PLACE_NAME);
    // The kitchen the POV stands in is as hidden as the flat around it: a stand-in too.
    expect(JSON.stringify(inside)).not.toContain("Maya's kitchen");
    expect(scopeOf(inside, flat?.id ?? null).places.map((p) => [p.id === inside.here, p.name, p.known])).toEqual([[true, HIDDEN_PLACE_NAME, false]]);
    expect(inside.scope).toBe(flat?.id ?? "");
  });

  test("routes and the grid show from Space 2, the POV's own cell from Space 3", () => {
    const world = starter("fantasy_town");
    const state = startState(world);
    state.entities[world.pov]!.fields.x = 7;
    state.entities[world.pov]!.fields.y = 4;
    const at = (level: 1 | 2 | 3) => {
      state.realism.levels.space = level;
      return buildMapView(reg.context(world, state));
    };
    expect(scopeOf(at(1), "brindlemere").routes).toEqual([]);
    expect(scopeOf(at(1), "market_square").grid).toBeUndefined();
    expect(scopeOf(at(2), "brindlemere").routes.length).toBeGreaterThan(0);
    expect(scopeOf(at(2), "market_square").grid?.pov).toBeUndefined();
    expect(scopeOf(at(3), "market_square").grid?.pov).toEqual({ x: 7, y: 4 });
    // The POV's cell is on the grid it stands on: in the inn, the square's, where the inn is drawn.
    Object.assign(state.entities[world.pov]!.fields, { place: "crooked_kettle", ...world.places.crooked_kettle?.cell });
    expect(scopeOf(at(3), "market_square").grid?.pov).toEqual(world.places.crooked_kettle?.cell);
    // Off every grid (the town around the square is drawn as linked places), it has no cell on the map.
    state.entities[world.pov]!.fields.place = "brindlemere";
    expect(at(3).scopes.some((s) => s.grid?.pov !== undefined)).toBe(false);
  });

  test("a map's places draw in its scope: a node map's at their positions, the rest on a ring; the map opens on the place it draws", () => {
    const w = blankWorld("w_view", "View");
    w.places = { town: { id: "town", name: "Town", fields: {} }, home: { id: "home", name: "Home", parent: "town", fields: {} } };
    w.maps = { town_map: { id: "town_map", scope: "town", size: [200, 100], places: [{ id: "square", at: [100, 50] }, { id: "inn", at: [40, 20] }], links: [{ from: "square", to: "inn", minutes: 3 }, { from: "home", to: "square", minutes: 4 }] } };
    const world = migrateWorld(w);
    world.entities.you!.fields.place = "home";
    const view = buildMapView(reg.context(world, startState(world)));
    expect(view.scope).toBe("town");
    const town = scopeOf(view, "town");
    expect(town.frame).toEqual({ width: 200, height: 100 });
    expect(town.places.filter((p) => p.id !== "home").map((p) => [p.id, p.x, p.y])).toEqual([
      ["inn", 40, 20],
      ["square", 100, 50],
    ]);
    expect(town.routes.map((r) => `${r.from}-${r.to}`).sort()).toEqual(["home-square", "inn-square"]);
  });

  test("a place the POV can see outside the map's scope is still a travel target: on the map, in the palette and typed", () => {
    const world = starter("mystery_manor");
    const state = startState(world);
    const view = buildMapView(reg.context(world, state));
    expect(view.scope).toBe("harrowmere_hall");
    expect(scopeOf(view, "harrowmere_hall").places.some((p) => p.id === "saltreach")).toBe(false);
    // The map draws one scope at a time, but its travel options reach every place the POV can see.
    expect(view.travel.some((t) => t.action === "go" && t.to === "saltreach")).toBe(true);
    const go = reg.actions.get("go");
    expect(go ? paramCandidates(reg, world, state, go, "to") : []).toEqual(expect.arrayContaining(["saltreach", "boathouse", "gatehouse"]));
    expect(typedIntent(reg, world, state, "I walk to Saltreach")).toMatchObject({ action: "go", params: { to: "saltreach" } });
  });
});
