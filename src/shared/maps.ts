// Maps (`lre-map-v1`; DESIGN §4.1, §12): the source of truth for a place's interior, one JSON
// document per map in `WorldDoc.maps`. A grid map draws an interior cell by cell (`layout` rows of
// characters, each standing for what the `legend` says); a node map lists places and the links
// between them, for a town or a region. When the world is read, each map compiles into the places
// inside its scope, a grid and routes, each marked as the map's own (`map`). Compiling first
// clears what an earlier compile made, so a stored, exported or reloaded world reads the same.
// Pure: the engine compiles on read, the space pack lints, Build's map editor checks and previews
// every keystroke, and the Describe a map job checks the helper's answer, all through here.

import schemaJson from "./lre-map-v1.schema.json";
import { areaOf, cellIndex, costMinutes, gridCosts, nearestMiddle, SIGHT_MAX } from "./grid";
import type { EntityId, MapId, PlaceId, TravelMode } from "./ids";
import { hasOwn, isRecord, safeKey } from "./json";
import type { LintIssue } from "./protocol";
import { checkSchema, pathText, type JsonPath, type Schema } from "./schema-check";
import type { GridDef, MapCellDef, MapDoc, MapPlaceDef, MapSettings, PlaceDef, RouteDef, RouteLeg, TravelTuning, WorldDoc } from "./world";

export const MAP_FORMAT = "lre-map-v1";

/** The published JSON Schema (`lre-map-v1.schema.json`): Build's editor, the helper's prompt and outside tools read the same file. */
// A JSON module's inferred type spells out every node, which `Schema` describes in general.
export const MAP_SCHEMA = schemaJson as unknown as Schema;

/** The terrain of a cell where nothing is: a layout's blank, and on the player's map every cell of a place it can't see. */
export const VOID_TERRAIN = "void";

/** Layout characters a legend needn't list. */
export const DEFAULT_LEGEND: Readonly<Record<string, MapCellDef>> = { "#": "wall", ".": "floor", "+": "door", " ": { terrain: VOID_TERRAIN, blocked: true } };

export interface MapProblem {
  severity: "error" | "warning";
  /** Where in the map, as a JSON path (`["places", 1, "at"]`). */
  path: JsonPath;
  code: string;
  message: string;
}

/** Checks a candidate map against the schema: its problems, and the typed map when there are none. */
export function readMap(value: unknown): { map: MapDoc | null; problems: MapProblem[] } {
  const problems = checkSchema(MAP_SCHEMA, value).map((p): MapProblem => ({ severity: "error", path: p.path, code: "map_shape", message: p.message }));
  // The schema check is the shape check: a value with no problems is a MapDoc.
  return { map: problems.length === 0 ? (value as MapDoc) : null, problems };
}

/** A place's name when the map gives none: its id in words ("dining_room" → "Dining room"). */
export function nameOfId(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : id;
}

/** What a layout character stands for: the map's legend, else the default one. */
function cellOf(map: MapDoc, ch: string): MapCellDef | undefined {
  const legend = map.legend ?? {};
  return hasOwn(legend, ch) ? legend[ch] : hasOwn(DEFAULT_LEGEND, ch) ? DEFAULT_LEGEND[ch] : undefined;
}

/** The layout's rows as characters (code points, so any character is one cell) and its size: the widest row by the row count. */
function layoutOf(map: MapDoc): { rows: string[][]; width: number; height: number } {
  const rows = (map.layout ?? []).map((row) => [...row]);
  return { rows, width: Math.max(0, ...rows.map((r) => r.length)), height: rows.length };
}

function owned(item: unknown): boolean {
  return isRecord(item) && typeof item.map === "string";
}

/** The id of the route a map's link compiles into: one route per map and ordered pair, its modes merged. */
export function linkRouteId(map: MapId, from: PlaceId, to: PlaceId): string {
  return `${map}:${from}:${to}`;
}

interface Plan {
  key: MapId;
  map: MapDoc;
  /** The map's places that compile: an id the world (or an earlier map) already has is left out. */
  places: MapPlaceDef[];
}

/** The maps that compile, in id order. A map whose scope doesn't exist, or is one of its own places, compiles nothing. */
function plan(maps: Readonly<Record<string, unknown>>, authored: Readonly<Record<PlaceId, PlaceDef>>): Plan[] {
  const taken = new Set(Object.keys(authored));
  const candidates: Plan[] = [];
  for (const key of Object.keys(maps).sort()) {
    const { map } = readMap(maps[key]);
    if (!map || !safeKey(key)) continue;
    const places: MapPlaceDef[] = [];
    for (const p of map.places ?? []) {
      if (taken.has(p.id)) continue;
      taken.add(p.id);
      places.push(p);
    }
    candidates.push({ key, map, places });
  }
  // Dropping a map's places can leave a map scoped to one of them without its scope: settle.
  let live = candidates;
  for (let guard = 0; guard <= candidates.length; guard++) {
    const ids = new Set([...Object.keys(authored), ...live.flatMap((c) => c.places.map((p) => p.id))]);
    const next = live.filter((c) => ids.has(c.map.scope) && !c.places.some((p) => p.id === c.map.scope));
    if (next.length === live.length) break;
    live = next;
  }
  return live;
}

/** The cells the POV sees around it while the grid system is on, when the world doesn't say. */
export const DEFAULT_SIGHT_RADIUS = 3;

/**
 * A world's map settings (DESIGN §12), each part read for itself: one missing or malformed is the
 * default (the map shows what the POV knows; the grid system off, sight 3 cells; no travel
 * simulation, so moves are story first).
 */
export function mapSettingsOf(world: { readonly mapSettings?: unknown }): MapSettings {
  const raw = isRecord(world.mapSettings) ? world.mapSettings : {};
  const grid = isRecord(raw.grid) ? raw.grid : {};
  const radius = grid.sightRadius;
  return {
    display: raw.display === "fog" ? "fog" : "knowledge",
    grid: { movement: grid.movement === true, sightRadius: typeof radius === "number" && Number.isFinite(radius) ? Math.min(SIGHT_MAX, Math.max(0, Math.round(radius))) : DEFAULT_SIGHT_RADIUS },
    travelSimulation: raw.travelSimulation === true,
  };
}

/** A vehicle trip's overheads when the world doesn't tune them; no speeds, so every route keeps its own minutes. */
export const DEFAULT_TRAVEL: Readonly<TravelTuning> = Object.freeze({ speeds: {}, vehicleSpeeds: {}, startMinutes: 1, parkMinutes: 1, fetchMinutes: 30 });

const TRAVEL_MODES: readonly TravelMode[] = ["walk", "road", "offroad", "water"];

/** A world's travel tuning (DESIGN §9.1), each part read for itself: one missing or malformed is the default; a speed is kept only when above 0. */
export function travelTuningOf(world: { readonly mapSettings?: unknown }): TravelTuning {
  const raw = isRecord(world.mapSettings) && isRecord(world.mapSettings.travel) ? world.mapSettings.travel : {};
  const speed = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const minutes = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  const speeds: Partial<Record<TravelMode, number>> = {};
  const rawSpeeds = isRecord(raw.speeds) ? raw.speeds : {};
  for (const mode of TRAVEL_MODES) {
    const s = speed(hasOwn(rawSpeeds, mode) ? rawSpeeds[mode] : undefined);
    if (s !== null) speeds[mode] = s;
  }
  const vehicleSpeeds: Record<string, number> = {};
  const rawVehicles = isRecord(raw.vehicleSpeeds) ? raw.vehicleSpeeds : {};
  for (const [cls, v] of Object.entries(rawVehicles)) {
    const s = speed(v);
    if (s !== null && safeKey(cls)) vehicleSpeeds[cls] = s;
  }
  return {
    speeds,
    vehicleSpeeds,
    startMinutes: minutes(raw.startMinutes, DEFAULT_TRAVEL.startMinutes),
    parkMinutes: minutes(raw.parkMinutes, DEFAULT_TRAVEL.parkMinutes),
    fetchMinutes: minutes(raw.fetchMinutes, DEFAULT_TRAVEL.fetchMinutes),
  };
}

/**
 * A grid map's grid, given to its scope, and its places' cells: `at`, else the middle of the
 * place's area. Each place's area is kept as a zone named by the place. A thing in the legend lies
 * on its cell (`items`), which joins the area of the place the legend names, else of the place most
 * of the cells beside it belong to. A scope that already has a grid, or a grid id already taken,
 * gets nothing (lint says which).
 */
function compileGrid(key: MapId, map: MapDoc, mine: readonly MapPlaceDef[], places: Record<PlaceId, PlaceDef>, grids: Record<string, GridDef>): void {
  const scope = places[map.scope];
  if (!scope || scope.grid !== undefined || hasOwn(grids, key)) return;
  const { rows, width, height } = layoutOf(map);
  const ids = new Set(mine.map((p) => p.id));
  const terrain: string[] = [];
  const blocked: number[] = [];
  const zones = new Map<string, number[]>();
  const rooms = new Map<number, PlaceId>();
  const things: { id: EntityId; index: number; place: PlaceId | null }[] = [];
  const doors = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      // A short row is padded with nothing; a character the legend lacks reads as floor (lint flags both).
      const cell = cellOf(map, rows[y]?.[x] ?? " ") ?? "floor";
      if (cell === "wall") {
        terrain.push("wall");
        blocked.push(index);
      } else if (cell === "floor" || cell === "door") terrain.push(cell);
      else if ("door" in cell) {
        // A door on a room's edge: walked as a door, and in the room's area, so whoever stands in it
        // is in the room; touching another room's area, it joins the two (`compileFloorRoutes`).
        terrain.push("door");
        if (ids.has(cell.place)) {
          zones.set(cell.place, [...(zones.get(cell.place) ?? []), index]);
          rooms.set(index, cell.place);
          doors.add(index);
        }
      } else if ("terrain" in cell) {
        terrain.push(cell.terrain);
        if (cell.blocked === true) blocked.push(index);
      } else if ("item" in cell) {
        terrain.push("floor");
        things.push({ id: cell.item, index, place: cell.place !== undefined && ids.has(cell.place) ? cell.place : null });
      } else {
        terrain.push("floor");
        const zone = "place" in cell ? (ids.has(cell.place) ? cell.place : null) : cell.zone;
        if (zone !== null) zones.set(zone, [...(zones.get(zone) ?? []), index]);
        if ("place" in cell && zone !== null) rooms.set(index, zone);
      }
    }
  }
  const items: Record<EntityId, number> = {};
  for (const t of things) {
    // One cell per thing: the first; lint flags the rest.
    if (hasOwn(items, t.id)) continue;
    items[t.id] = t.index;
    const votes = new Map<PlaceId, number>();
    const x = t.index % width;
    for (const n of [t.index - width, t.index + width, x > 0 ? t.index - 1 : -1, x < width - 1 ? t.index + 1 : -1]) {
      const room = rooms.get(n);
      if (room !== undefined) votes.set(room, (votes.get(room) ?? 0) + 1);
    }
    const room = t.place ?? [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    if (room !== undefined) zones.set(room, [...(zones.get(room) ?? []), t.index].sort((a, b) => a - b));
  }
  grids[key] = { id: key, width, height, ...(map.cellMeters !== undefined ? { cellMeters: map.cellMeters } : {}), terrain, blocked, zones: Object.fromEntries(zones), ...(things.length > 0 ? { items } : {}), map: key };
  places[map.scope] = { ...scope, grid: key };
  for (const p of mine) {
    const def = places[p.id];
    if (!def) continue;
    // A place stands at the middle of its area: its floor, not a door on its edge, while it has floor.
    const area = zones.get(p.id) ?? [];
    const floor = area.filter((i) => !doors.has(i));
    const cell = p.at ? (p.at[0] < width && p.at[1] < height ? { x: p.at[0], y: p.at[1] } : null) : nearestMiddle(floor.length > 0 ? floor : area, width);
    if (cell) places[p.id] = { ...def, cell };
  }
}

/**
 * With the grid system on, a grid map without links joins its places as its floor plan does
 * (DESIGN §4.1): two places get a route when someone can walk from one's cell to the other's
 * through doors, corridors and open floor without crossing a third place's area, the route's
 * minutes those of the walk.
 */
function compileFloorRoutes(key: MapId, mine: readonly MapPlaceDef[], places: Readonly<Record<PlaceId, PlaceDef>>, grids: Readonly<Record<string, GridDef>>, routes: Record<string, RouteDef>): void {
  const grid = hasOwn(grids, key) ? grids[key] : undefined;
  if (!grid || grid.map !== key) return;
  const ids = mine.map((p) => p.id).filter((id) => places[id]?.map === key).sort();
  const rooms = new Map<number, PlaceId>();
  for (const id of ids) for (const cell of areaOf(grid, id)) rooms.set(cell, id);
  const cells = new Map<PlaceId, number>();
  for (const id of ids) {
    const at = places[id]?.cell;
    const index = at ? cellIndex(grid, at) : null;
    if (index !== null) cells.set(id, index);
  }
  for (const [a, from] of cells) {
    // Inside another place's area a walk stays there: it reaches that place, never one beyond it.
    const cost = gridCosts(grid, from, (step, next) => {
      const room = rooms.get(step);
      return room === undefined || room === a || rooms.get(next) === room;
    });
    for (const [b, to] of cells) {
      const walk = cost[to] ?? Infinity;
      const id = linkRouteId(key, a, b);
      if (b <= a || !Number.isFinite(walk) || hasOwn(routes, id)) continue;
      routes[id] = { id, from: a, to: b, modes: { walk: { minutes: Math.max(1, costMinutes(grid, walk)) } }, bidirectional: true, map: key };
    }
  }
}

/** A map's links as routes, one per ordered pair; a pair's links merge their modes (the quickest of each). */
function compileLinks(key: MapId, map: MapDoc, places: Readonly<Record<PlaceId, PlaceDef>>, routes: Record<string, RouteDef>): void {
  const made = new Map<string, RouteDef>();
  for (const link of map.links ?? []) {
    if (link.from === link.to || !hasOwn(places, link.from) || !hasOwn(places, link.to)) continue;
    const id = linkRouteId(key, link.from, link.to);
    const route = made.get(id) ?? { id, from: link.from, to: link.to, modes: {}, bidirectional: true, map: key };
    const mode: TravelMode = link.mode ?? "walk";
    const had: RouteLeg | undefined = route.modes[mode];
    if (!had || link.minutes < had.minutes) route.modes[mode] = { minutes: link.minutes };
    route.bidirectional = route.bidirectional && link.bidirectional !== false;
    made.set(id, route);
  }
  for (const [id, route] of made) if (!hasOwn(routes, id)) routes[id] = route;
}

/**
 * The world with its maps compiled: what earlier compiles made is cleared (items marked `map`, and
 * a place's link to a grid a map made), then each map makes the places inside its scope, its grid
 * and its routes again. The same document whenever it has no maps and nothing made by one.
 */
export function compileMaps(doc: WorldDoc): WorldDoc {
  const maps: Readonly<Record<string, unknown>> = isRecord(doc.maps) ? doc.maps : {};
  if (Object.keys(maps).length === 0 && ![doc.places, doc.routes, doc.grids].some((items) => Object.values(items).some(owned))) return doc;
  const madeGrids = new Set(Object.keys(doc.grids).filter((id) => owned(doc.grids[id])));
  const places: Record<PlaceId, PlaceDef> = {};
  for (const [id, p] of Object.entries(doc.places)) {
    if (owned(p)) continue;
    if (p.grid !== undefined && madeGrids.has(p.grid)) {
      const authored = { ...p };
      delete authored.grid;
      places[id] = authored;
    } else places[id] = p;
  }
  const routes: Record<string, RouteDef> = Object.fromEntries(Object.entries(doc.routes).filter(([, r]) => !owned(r)));
  const grids: Record<string, GridDef> = Object.fromEntries(Object.entries(doc.grids).filter(([, g]) => !owned(g)));
  const plans = plan(maps, places);
  for (const { key, map, places: mine } of plans) for (const p of mine) places[p.id] = { id: p.id, name: p.name ?? nameOfId(p.id), parent: map.scope, fields: {}, map: key };
  const movement = mapSettingsOf(doc).grid.movement;
  for (const { key, map, places: mine } of plans) {
    if (map.layout) compileGrid(key, map, mine, places, grids);
    else {
      for (const p of mine) {
        const def = places[p.id];
        if (def && p.at) places[p.id] = { ...def, layoutPos: { x: p.at[0], y: p.at[1] } };
      }
    }
    // Travel between a map's places follows its links. With none, a grid map's floor plan while the
    // grid system is on; otherwise the scope's free walking between the places inside it, its walls
    // and doors drawn, not walked.
    compileLinks(key, map, places, routes);
    if (map.layout && movement && (map.links ?? []).length === 0) compileFloorRoutes(key, mine, places, grids, routes);
  }
  return { ...doc, places, routes, grids };
}

/** The child of `scope` that is `place` or holds it, in the compiled world; null outside it. */
function childIn(places: Readonly<Record<PlaceId, PlaceDef>>, scope: PlaceId, place: PlaceId): PlaceId | null {
  let cur: PlaceId | undefined = place;
  for (let guard = 0; cur !== undefined && guard < 64; guard++) {
    const parent: PlaceId | undefined = hasOwn(places, cur) ? places[cur]?.parent : undefined;
    if (parent === scope) return cur;
    cur = parent;
  }
  return null;
}

/**
 * The places inside a map's scope that its links leave unreachable from the linked ones. With a
 * route between places inside it, a place is "spread out" (travel then joins its places only by
 * routes), so a map that links some of its scope's places and not others cuts those off.
 */
function cutOff(doc: WorldDoc, map: MapDoc): PlaceId[] {
  const kids = Object.values(doc.places)
    .filter((p) => p.parent === map.scope)
    .map((p) => p.id)
    .sort();
  const linked = (map.links ?? []).find((l) => childIn(doc.places, map.scope, l.from) !== null && childIn(doc.places, map.scope, l.to) !== null);
  const start = linked ? childIn(doc.places, map.scope, linked.from) : null;
  if (start === null || kids.length < 2) return [];
  const root = new Map(kids.map((id) => [id, id]));
  const find = (id: PlaceId): PlaceId => {
    let cur = id;
    for (let guard = 0; root.get(cur) !== cur && guard < kids.length; guard++) cur = root.get(cur) ?? cur;
    return cur;
  };
  for (const route of Object.values(doc.routes)) {
    const a = childIn(doc.places, map.scope, route.from);
    const b = childIn(doc.places, map.scope, route.to);
    if (a !== null && b !== null && a !== b) root.set(find(a), find(b));
  }
  return kids.filter((id) => find(id) !== find(start));
}

/**
 * With the grid system on, the places a grid map without links leaves apart: the floor plan joins
 * them to its first place (in id order) by no door or open floor.
 */
function apartOnFloor(doc: WorldDoc, key: MapId): PlaceId[] {
  const grid = hasOwn(doc.grids, key) ? doc.grids[key] : undefined;
  if (!grid || grid.map !== key) return [];
  const ids = Object.values(doc.places)
    .filter((p) => p.map === key && p.cell !== undefined && cellIndex(grid, p.cell) !== null)
    .map((p) => p.id)
    .sort();
  const reached = new Set(ids.slice(0, 1));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of Object.values(doc.routes)) {
      if (r.map !== key || reached.has(r.from) === reached.has(r.to)) continue;
      reached.add(r.from);
      reached.add(r.to);
      grew = true;
    }
  }
  return ids.filter((id) => !reached.has(id));
}

/** Every map's problems, by map id: the schema's, then what the compiled world says about it. */
export function mapProblems(world: WorldDoc): Map<MapId, MapProblem[]> {
  const doc = compileMaps(world);
  const maps: Readonly<Record<string, unknown>> = isRecord(world.maps) ? world.maps : {};
  const out = new Map<MapId, MapProblem[]>();
  const placeName = (id: PlaceId): string => (hasOwn(doc.places, id) ? (doc.places[id]?.name ?? id) : id);
  for (const key of Object.keys(maps).sort()) {
    const { map, problems } = readMap(maps[key]);
    out.set(key, problems);
    if (!map) continue;
    const err = (path: JsonPath, code: string, message: string): void => void problems.push({ severity: "error", path, code, message });
    if (map.id !== key) err(["id"], "map_id", `the id should be "${key}", the map's key in the world`);
    const ids = (map.places ?? []).map((p) => p.id);
    const scope = hasOwn(doc.places, map.scope) ? doc.places[map.scope] : undefined;
    if (!scope) err(["scope"], "map_scope", `there's no place "${map.scope}" for the map to draw`);
    else if (ids.includes(map.scope)) err(["scope"], "map_scope", `"${map.scope}" is one of this map's own places; a map draws the inside of another place`);
    const placed = scope !== undefined && !ids.includes(map.scope);
    // Places: ids new to the world, `opens` naming the map of their inside.
    const seen = new Set<string>();
    (map.places ?? []).forEach((p, i) => {
      if (seen.has(p.id)) err(["places", i, "id"], "map_place", `"${p.id}" is listed twice`);
      else {
        const made = hasOwn(doc.places, p.id) ? doc.places[p.id] : undefined;
        if (placed && made && made.map !== key) err(["places", i, "id"], "map_place", made.map ? `the map "${made.map}" already has a place "${p.id}"` : `the world already has a place "${p.id}" (${made.name}); give this one another id`);
      }
      seen.add(p.id);
      if (p.opens !== undefined) {
        const inner = hasOwn(maps, p.opens) ? maps[p.opens] : undefined;
        if (!isRecord(inner)) err(["places", i, "opens"], "map_opens", `there's no map "${p.opens}"`);
        else if (inner.scope !== p.id) err(["places", i, "opens"], "map_opens", `the map "${p.opens}" draws "${String(inner.scope)}", not "${p.id}"`);
      }
    });
    if (map.layout) {
      const { rows, width, height } = layoutOf(map);
      rows.forEach((row, y) => {
        if (row.length !== width) err(["layout", y], "map_layout", `row ${y + 1} is ${row.length} wide; every row needs the widest's width, ${width}`);
      });
      if (map.size && (map.size[0] !== width || map.size[1] !== height)) err(["size"], "map_layout", `the layout is ${width} × ${height}, not ${map.size[0]} × ${map.size[1]}`);
      const unknown = new Map<string, number>();
      rows.forEach((row, y) => row.forEach((ch) => (cellOf(map, ch) || unknown.has(ch) ? undefined : unknown.set(ch, y))));
      for (const [ch, y] of unknown) err(["layout", y], "map_legend", `"${ch}" isn't in the legend: add it, or use # (wall), . (floor), + (door) or a space`);
      // A thing in the legend is one the world has, lying free, on one cell of one map.
      const lying = new Map<string, number>();
      rows.forEach((row) =>
        row.forEach((ch) => {
          const cell = cellOf(map, ch);
          if (typeof cell === "object" && "item" in cell) lying.set(cell.item, (lying.get(cell.item) ?? 0) + 1);
        }),
      );
      for (const [ch, cell] of Object.entries(map.legend ?? {})) {
        if (typeof cell !== "object") continue;
        if ("place" in cell && cell.place !== undefined && !ids.includes(cell.place)) err(["legend", ch], "map_legend", `"${cell.place}" isn't one of this map's places`);
        if (!("item" in cell)) continue;
        const thing = hasOwn(world.entities, cell.item) ? world.entities[cell.item] : undefined;
        const drawn = lying.get(cell.item) ?? 0;
        const other = Object.values(doc.grids).find((g) => g.map !== key && g.items !== undefined && hasOwn(g.items, cell.item));
        if (!thing) err(["legend", ch, "item"], "map_item", `there's no "${cell.item}" in the world to lie here`);
        else if (thing.relations.some((r) => r.type === "in")) problems.push({ severity: "warning", path: ["legend", ch, "item"], code: "map_item", message: `${thing.name} starts inside something, so it won't lie on the map` });
        else if (drawn > 1) err(["legend", ch, "item"], "map_item", `${thing.name} is drawn on ${drawn} cells; a thing lies on one`);
        else if (drawn > 0 && other) problems.push({ severity: "warning", path: ["legend", ch, "item"], code: "map_item", message: `${thing.name} already lies on the map "${other.map ?? other.id}"` });
      }
      // A room door sits on its room's edge: one that touches none of the room's area is a room of a
      // single doorway, which is never what was meant.
      const roomOf = (x: number, y: number): PlaceId | null => {
        const cell = cellOf(map, rows[y]?.[x] ?? " ");
        return typeof cell === "object" && "place" in cell && !("item" in cell) && cell.place !== undefined ? cell.place : null;
      };
      rows.forEach((row, y) =>
        row.forEach((ch, x) => {
          const cell = cellOf(map, ch);
          if (typeof cell !== "object" || !("door" in cell) || !ids.includes(cell.place)) return;
          const beside = [roomOf(x - 1, y), roomOf(x + 1, y), roomOf(x, y - 1), roomOf(x, y + 1)];
          if (!beside.includes(cell.place)) problems.push({ severity: "warning", path: ["layout", y], code: "map_door", message: `The door of ${placeName(cell.place)} at [${x}, ${y}] touches none of its room: put it on the room's edge` });
        }),
      );
      (map.places ?? []).forEach((p, i) => {
        if (p.at && (p.at[0] >= width || p.at[1] >= height)) err(["places", i, "at"], "map_place", `[${p.at[0]}, ${p.at[1]}] is outside the ${width} × ${height} layout`);
      });
      if (placed && scope) {
        const grid = hasOwn(doc.grids, key) ? doc.grids[key] : undefined;
        if (grid && grid.map !== key) err(["id"], "map_grid", `the world already has a grid "${key}"; give the map another id`);
        else if (scope.grid !== key) {
          const other = scope.grid !== undefined && hasOwn(doc.grids, scope.grid) ? doc.grids[scope.grid]?.map : undefined;
          err(["scope"], "map_grid", other ? `the map "${other}" already draws ${scope.name}'s grid` : `${scope.name} already has the grid "${scope.grid ?? ""}"; take it off the place for this map to draw its grid`);
        }
        const apart = mapSettingsOf(world).grid.movement && (map.links ?? []).length === 0 ? apartOnFloor(doc, key).map(placeName) : [];
        const listed = apart.length <= 1 ? apart.join("") : `${apart.slice(0, -1).join(", ")} and ${apart.at(-1) ?? ""}`;
        if (apart.length > 0) problems.push({ severity: "warning", path: ["layout"], code: "map_floor_apart", message: `With the grid system on, people walk ${scope.name}'s floor plan, and no door or open floor joins ${listed} to the rest: add a door (+), or give the map links.` });
      }
    } else if (map.size) {
      const [w, h] = map.size;
      (map.places ?? []).forEach((p, i) => {
        if (p.at && (p.at[0] > w || p.at[1] > h)) err(["places", i, "at"], "map_place", `[${p.at[0]}, ${p.at[1]}] is outside the ${w} × ${h} map`);
      });
    }
    // Links: places that exist, and every place inside the scope linked or none.
    (map.links ?? []).forEach((l, i) => {
      if (l.from === l.to) err(["links", i], "map_link", "a link joins two different places");
      for (const end of ["from", "to"] as const) if (!hasOwn(doc.places, l[end])) err(["links", i, end], "map_link", `there's no place "${l[end]}"`);
      const route = hasOwn(doc.routes, linkRouteId(key, l.from, l.to)) ? doc.routes[linkRouteId(key, l.from, l.to)] : undefined;
      if (route && route.map !== key) err(["links", i], "map_link", `the world already has a route "${route.id}"`);
    });
    if (placed && scope) {
      const cut = cutOff(doc, map).map(placeName);
      const listed = cut.length <= 1 ? cut.join("") : `${cut.slice(0, -1).join(", ")} and ${cut.at(-1) ?? ""}`;
      if (cut.length > 0) problems.push({ severity: "warning", path: ["links"], code: "map_partial_links", message: `With links, ${scope.name}'s places join only where they're linked, and nothing links ${listed} to the rest: link ${cut.length === 1 ? "it" : "them"} too, or take the links out.` });
    }
  }
  return out;
}

/** The maps' problems as world lint, each at `maps.<id>.<path>`. */
export function mapLint(world: WorldDoc): LintIssue[] {
  const out: LintIssue[] = [];
  for (const [key, problems] of mapProblems(world)) {
    for (const p of problems) {
      const at = pathText(p.path);
      out.push({ severity: p.severity, path: at === "" ? `maps.${key}` : `maps.${key}.${at}`, code: p.code, message: p.message });
    }
  }
  return out;
}

function compact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compact).join(", ")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length === 0 ? "{}" : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function pretty(value: unknown, indent: string, expand: boolean): string {
  const one = compact(value);
  if (!(Array.isArray(value) || isRecord(value)) || (!expand && indent.length + one.length <= 96)) return one;
  const next = `${indent}  `;
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[\n${value.map((v) => `${next}${pretty(v, next, false)}`).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value);
  return entries.length === 0 ? "{}" : `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${pretty(v, next, k === "layout")}`).join(",\n")}\n${indent}}`;
}

/** A map as JSON for people: a field per line, the layout a row per line (so it reads as a plan), short lists and objects on one line. */
export function formatMap(value: unknown): string {
  return pretty(value, "", true);
}

/** A small grid map (three rooms with doors between them) or node map (three places, linked), for the editor's Insert template. */
export function mapTemplate(kind: "grid" | "node", id: MapId, scope: PlaceId): MapDoc {
  const place = (name: string): string => `${id}_${name}`;
  if (kind === "grid") {
    return {
      id,
      scope,
      title: "Ground floor",
      layout: ["#############", "#ppppp#kkkkk#", "#ppppp+kkkkk#", "#ppppp#kkkkk#", "###+#####+###", "#hhhhhhhhhhh#", "#####+#######"],
      legend: { p: { place: place("parlour") }, k: { place: place("kitchen") }, h: { place: place("hallway") } },
      places: [
        { id: place("parlour"), name: "Parlour" },
        { id: place("kitchen"), name: "Kitchen" },
        { id: place("hallway"), name: "Hallway" },
      ],
    };
  }
  return {
    id,
    scope,
    title: "Town",
    size: [100, 100],
    places: [
      { id: place("square"), name: "Square", at: [50, 50] },
      { id: place("inn"), name: "Inn", at: [25, 30] },
      { id: place("docks"), name: "Docks", at: [80, 75] },
    ],
    links: [
      { from: place("square"), to: place("inn"), minutes: 3 },
      { from: place("square"), to: place("docks"), minutes: 6 },
    ],
  };
}
