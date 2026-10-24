// Maps (`lre-map-v1`): a map compiles, when the world is read, into the places inside its scope, a
// grid and routes it owns, and compiles the same again from a stored or exported copy; travel
// follows the compiled routes; and the map lint names each problem where it sits in the map.

import { describe, expect, test } from "bun:test";
import type { MapDoc, WorldDoc } from "../../src/shared/world";
import { areaPlaceAt } from "../../src/shared/grid";
import { hashJson } from "../../src/shared/hash";
import { compileMaps, formatMap, mapLint, mapProblems, mapTemplate, readMap } from "../../src/shared/maps";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { findRoute } from "../../src/packs/space/core/travel";
import { startState } from "../packs/support";

const COTTAGE: MapDoc = {
  id: "cottage",
  scope: "home",
  title: "Cottage",
  layout: ["#########", "#kkk+bbb#", "#kkk#bbb#", "##+###+##", "#hhhhhhh#", "####+####"],
  legend: { k: { place: "kitchen" }, b: { place: "bedroom" }, h: { place: "hall" } },
  places: [{ id: "kitchen" }, { id: "bedroom", name: "Back bedroom" }, { id: "hall", at: [1, 4] }],
};

const TOWN: MapDoc = {
  id: "town_map",
  scope: "town",
  size: [100, 60],
  places: [{ id: "square", at: [50, 30] }, { id: "inn", name: "The Inn", at: [20, 20] }, { id: "docks" }],
  links: [
    { from: "square", to: "inn", minutes: 3 },
    { from: "square", to: "docks", minutes: 6 },
    { from: "square", to: "docks", mode: "road", minutes: 2 },
    { from: "home", to: "square", minutes: 4 },
  ],
};

function world(maps: Record<string, unknown>): WorldDoc {
  const w = blankWorld("w_maps", "Maps");
  w.places = {
    town: { id: "town", name: "Town", fields: {} },
    home: { id: "home", name: "Home", parent: "town", fields: {} },
  };
  w.maps = maps as Record<string, MapDoc>;
  return w;
}

function issuesOf(w: WorldDoc, id: string) {
  return mapProblems(w).get(id) ?? [];
}

describe("maps compile into places, grids and routes", () => {
  test("a grid map makes its places inside the scope, at their cells, and gives the scope its grid", () => {
    const doc = migrateWorld(world({ cottage: COTTAGE }));
    expect(doc.places.home?.grid).toBe("cottage");
    expect(doc.places.kitchen).toEqual({ id: "kitchen", name: "Kitchen", parent: "home", fields: {}, map: "cottage", cell: { x: 2, y: 1 } });
    expect(doc.places.bedroom).toMatchObject({ name: "Back bedroom", parent: "home", cell: { x: 6, y: 1 } });
    expect(doc.places.hall?.cell).toEqual({ x: 1, y: 4 });
    const grid = doc.grids.cottage;
    expect(grid && [grid.width, grid.height, grid.map]).toEqual([9, 6, "cottage"]);
    expect(grid?.terrain[4 + 9]).toBe("door");
    expect(grid?.blocked).toContain(0);
    expect(grid?.blocked).not.toContain(4 + 9);
    expect(grid?.zones.kitchen?.length).toBe(6);
    expect(grid?.zones.hall?.length).toBe(7);
    // No links: the cottage's rooms walk to each other freely, as any place's children do.
    expect(Object.values(doc.routes)).toEqual([]);
    expect(findRoute(doc, "kitchen", "bedroom", "walk")?.minutes).toBe(5);
  });

  test("a node map places its places by `at` and turns its links into routes, a pair's modes merged", () => {
    const doc = migrateWorld(world({ town_map: TOWN }));
    expect(doc.places.square).toMatchObject({ parent: "town", layoutPos: { x: 50, y: 30 }, map: "town_map" });
    expect(doc.places.square?.cell).toBeUndefined();
    expect(doc.places.docks?.layoutPos).toBeUndefined();
    expect(doc.routes["town_map:square:docks"]).toEqual({ id: "town_map:square:docks", from: "square", to: "docks", modes: { walk: { minutes: 6 }, road: { minutes: 2 } }, bidirectional: true, map: "town_map" });
    expect(Object.keys(doc.routes).sort()).toEqual(["town_map:home:square", "town_map:square:docks", "town_map:square:inn"]);
  });

  test("travel follows the compiled routes", () => {
    const doc = migrateWorld(world({ town_map: TOWN }));
    expect(findRoute(doc, "inn", "docks", "walk")?.legs.map((l) => [l.to, l.minutes])).toEqual([
      ["square", 3],
      ["docks", 6],
    ]);
    expect(findRoute(doc, "inn", "home", "walk")?.minutes).toBe(7);
    const reg = createRegistry(ALL_PACKS);
    doc.realism.levels.space = 2;
    doc.entities.you!.fields.place = "inn";
    const w = new Working(reg, doc, startState(doc));
    const go = resolveAction(reg, w, { action: "go", params: { to: "docks" } }, createRng("go"));
    expect([go.ok, go.duration, w.state.entities.you?.fields.place]).toEqual([true, 9, "docks"]);
  });

  test("compiling again, from a stored or exported copy, reads the same; a removed map takes everything it made", () => {
    const doc = migrateWorld(world({ cottage: COTTAGE, town_map: TOWN }));
    expect(compileMaps(doc)).toEqual(doc);
    expect(migrateWorld(JSON.parse(JSON.stringify(doc)) as WorldDoc)).toEqual(doc);
    const without = compileMaps({ ...doc, maps: { town_map: TOWN } });
    expect(Object.keys(without.places).sort()).toEqual(["docks", "home", "inn", "square", "town"]);
    expect(without.places.home?.grid).toBeUndefined();
    expect(without.grids).toEqual({});
    const none = compileMaps({ ...doc, maps: {} });
    expect(none.places).toEqual(world({}).places);
    expect(none.routes).toEqual({});
    // A world with no maps and nothing a map made is left as it is.
    const plain = world({});
    expect(compileMaps(plain)).toBe(plain);
  });

  test("an authored place keeps its id: the map's place of the same id is left out", () => {
    const w = world({ cottage: { ...COTTAGE, places: [...(COTTAGE.places ?? []), { id: "town" }] } });
    const doc = migrateWorld(w);
    expect(doc.places.town).toEqual(w.places.town);
    expect(issuesOf(w, "cottage")).toContainEqual(expect.objectContaining({ severity: "error", path: ["places", 3, "id"], code: "map_place" }));
  });

  test("the formatter keeps the layout a row per line and short lists on one line", () => {
    const text = formatMap(COTTAGE);
    expect(text).toContain('    "#kkk+bbb#",\n');
    expect(text).toContain('"at": [1, 4]');
    expect(JSON.parse(text)).toEqual(COTTAGE);
  });

  test("both templates are clean maps", () => {
    for (const kind of ["grid", "node"] as const) {
      const w = world({ m: mapTemplate(kind, "m", "home") });
      expect(readMap(w.maps.m).problems).toEqual([]);
      expect(issuesOf(w, "m")).toEqual([]);
    }
  });
});

describe("doors on a room's edge", () => {
  /** Two rooms with a wall between them and, in it, the parlour's own door (`d`). */
  const ROOMS: MapDoc = {
    id: "house",
    scope: "home",
    layout: ["#########", "#pppdsss#", "#ppp#sss#", "#########"],
    legend: { p: { place: "parlour" }, s: { place: "study" }, d: { door: true, place: "parlour" } },
    places: [{ id: "parlour" }, { id: "study" }],
  };
  const walking = (maps: Record<string, unknown>): WorldDoc => ({ ...world(maps), mapSettings: { display: "knowledge", grid: { movement: true, sightRadius: 3 } } });

  test("a door cell inside a room's area keeps the room's place and joins the two rooms", () => {
    const doc = migrateWorld(walking({ house: ROOMS }));
    const grid = doc.grids.house;
    if (!grid) throw new Error("no grid");
    const door = 1 * 9 + 4;
    expect(grid.terrain[door]).toBe("door");
    expect(grid.blocked).not.toContain(door);
    expect(areaPlaceAt(doc, "home", grid, door)).toBe("parlour");
    // The parlour stands on its floor, not in its doorway.
    expect(doc.places.parlour?.cell).not.toEqual({ x: 4, y: 1 });
    const route = Object.values(doc.routes).find((r) => [r.from, r.to].sort().join() === "parlour,study");
    expect(route?.modes.walk?.minutes).toBeGreaterThan(0);
    expect(issuesOf(walking({ house: ROOMS }), "house")).toEqual([]);
  });

  test("a room door that touches none of its room is a warning", () => {
    const w = walking({ house: { ...ROOMS, layout: ["#########", "#ppp#sss#", "#ppp#sds#", "#########"] } });
    expect(issuesOf(w, "house").map((p) => [p.severity, p.code])).toContainEqual(["warning", "map_door"]);
  });

  test("an old map, with every kind of cell but a room door, compiles exactly as before", () => {
    const OLD: MapDoc = {
      id: "cottage",
      scope: "home",
      layout: ["#########", "#kkk+bbb#", "#kzk#bbb#", "##+###+##", "#hhhh~hh#", "####+####"],
      legend: { k: { place: "kitchen" }, b: { place: "bedroom" }, h: { place: "hall" }, z: { zone: "hearth" }, "~": { terrain: "water", blocked: true } },
      places: [{ id: "kitchen" }, { id: "bedroom", name: "Back bedroom" }, { id: "hall", at: [1, 4] }],
    };
    // What the compiler made of it before room doors, with the grid system off and on.
    const before: Record<string, string> = { off: "8df0d9fb0d894d7d7b43830669c4b476", on: "f960aeddd741505320ed775ec4031963" };
    for (const movement of [false, true]) {
      const doc = compileMaps({ ...world({ cottage: OLD }), mapSettings: { display: "knowledge", grid: { movement, sightRadius: 3 } } });
      expect(hashJson({ places: doc.places, routes: doc.routes, grids: doc.grids })).toBe(before[movement ? "on" : "off"] ?? "");
    }
  });
});

describe("map lint", () => {
  const codes = (w: WorldDoc, id: string) => issuesOf(w, id).map((p) => [p.code, JSON.stringify(p.path)]);

  test("the schema's problems sit where they are", () => {
    const w = world({ bad: { id: "bad", scope: "home", places: [{ id: "a", at: [1] }], colour: "red", links: [{ from: "a", to: "home" }] } });
    expect(codes(w, "bad")).toEqual([
      ["map_shape", '["places",0,"at"]'],
      ["map_shape", '["colour"]'],
      ["map_shape", '["links",0]'],
    ]);
    expect(issuesOf(w, "bad")[2]?.message).toBe('needs "minutes"');
  });

  test("unknown legend characters, ragged rows and places outside the grid", () => {
    const w = world({ cottage: { ...COTTAGE, layout: ["#########", "#kkk+bbb#", "#kkk#bbbx#", "##+###+##", "#hhhhhhh#", "####+###"], places: [...(COTTAGE.places ?? []), { id: "attic", at: [12, 2] }] } });
    expect(codes(w, "cottage")).toEqual([
      ["map_layout", '["layout",0]'],
      ["map_layout", '["layout",1]'],
      ["map_layout", '["layout",3]'],
      ["map_layout", '["layout",4]'],
      ["map_layout", '["layout",5]'],
      ["map_legend", '["layout",2]'],
      ["map_place", '["places",3,"at"]'],
    ]);
  });

  test("unknown places and maps: the scope, a legend place, a link's end, what a place opens", () => {
    const w = world({ m: { id: "m", scope: "nowhere", layout: ["xy"], legend: { x: { place: "ghost" }, y: "floor" }, places: [{ id: "p", opens: "missing" }], links: [{ from: "p", to: "elsewhere", minutes: 2 }] } });
    expect(codes(w, "m")).toEqual([
      ["map_scope", '["scope"]'],
      ["map_opens", '["places",0,"opens"]'],
      ["map_legend", '["legend","x"]'],
      ["map_link", '["links",0,"from"]'],
      ["map_link", '["links",0,"to"]'],
    ]);
    // A map opening one whose scope is another place.
    const both = world({ town_map: { ...TOWN, places: [{ id: "square", opens: "cottage" }] }, cottage: COTTAGE });
    expect(codes(both, "town_map")).toContainEqual(["map_opens", '["places",0,"opens"]']);
  });

  test("links that leave some of the scope's places out are a warning naming them", () => {
    const partial = world({ town_map: { ...TOWN, links: [{ from: "square", to: "inn", minutes: 3 }] } });
    const warning = issuesOf(partial, "town_map").find((p) => p.code === "map_partial_links");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("Docks and Home");
    // Every place linked, or no links at all: nothing to say.
    expect(issuesOf(world({ town_map: TOWN }), "town_map")).toEqual([]);
    expect(issuesOf(world({ town_map: { ...TOWN, links: [] } }), "town_map")).toEqual([]);
  });

  test("a grid map can't give a grid to a scope that has one, and a map's id must match its key", () => {
    const w = world({ cottage: COTTAGE, other: { ...COTTAGE, id: "other_id", places: [] } });
    expect(codes(w, "other")).toEqual([
      ["map_id", '["id"]'],
      ["map_legend", '["legend","k"]'],
      ["map_legend", '["legend","b"]'],
      ["map_legend", '["legend","h"]'],
      ["map_grid", '["scope"]'],
    ]);
    const authored = world({ cottage: COTTAGE });
    authored.grids.floor = { id: "floor", width: 1, height: 1, terrain: ["floor"], blocked: [], zones: {} };
    authored.places.home = { ...authored.places.home!, grid: "floor" };
    expect(codes(authored, "cottage")).toEqual([["map_grid", '["scope"]']]);
    expect(migrateWorld(authored).places.home?.grid).toBe("floor");
  });

  test("the world's lint carries each problem at maps.<id>.<path>", () => {
    const lint = mapLint(world({ cottage: { ...COTTAGE, legend: { ...COTTAGE.legend, "#": { place: "nobody" } } } }));
    expect(lint).toContainEqual(expect.objectContaining({ severity: "error", path: 'maps.cottage.legend["#"]', code: "map_legend" }));
  });
});
