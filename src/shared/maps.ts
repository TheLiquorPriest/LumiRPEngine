// Maps (`lre-map-v1`; DESIGN §4.1, §12): the source of truth for a place's interior, one JSON
// document per map in `WorldDoc.maps`. A grid map draws an interior cell by cell (`layout` rows of
// characters, each standing for what the `legend` says); a node map lists places and the links
// between them, for a town or a region. When the world is read, each map compiles into the places
// inside its scope, a grid and routes, each marked as the map's own (`map`). Compiling first
// clears what an earlier compile made, so a stored, exported or reloaded world reads the same.
// Pure: the engine compiles on read, the space pack lints, Build's map editor checks and previews
// every keystroke, and the Describe a map job checks the helper's answer, all through here.

import schemaJson from "./lre-map-v1.schema.json";
import type { MapId, PlaceId, TravelMode } from "./ids";
import { hasOwn, isRecord, safeKey } from "./json";
import type { LintIssue } from "./protocol";
import { checkSchema, pathText, type JsonPath, type Schema } from "./schema-check";
import type { GridDef, MapCellDef, MapDoc, MapPlaceDef, PlaceDef, RouteDef, RouteLeg, WorldDoc } from "./world";

export const MAP_FORMAT = "lre-map-v1";

/** The published JSON Schema (`lre-map-v1.schema.json`): Build's editor, the helper's prompt and outside tools read the same file. */
// A JSON module's inferred type spells out every node, which `Schema` describes in general.
export const MAP_SCHEMA = schemaJson as unknown as Schema;

/** Layout characters a legend needn't list. */
export const DEFAULT_LEGEND: Readonly<Record<string, MapCellDef>> = { "#": "wall", ".": "floor", "+": "door", " ": { terrain: "void", blocked: true } };

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

/** The cell of an area nearest its middle: where a room's dot goes when the map gives it no `at`. */
function middle(cells: readonly number[], width: number): { x: number; y: number } | null {
  if (cells.length === 0 || width === 0) return null;
  const cx = cells.reduce((a, i) => a + (i % width), 0) / cells.length;
  const cy = cells.reduce((a, i) => a + Math.floor(i / width), 0) / cells.length;
  let best = cells[0] ?? 0;
  let bestDistance = Infinity;
  for (const i of cells) {
    const d = (i % width - cx) ** 2 + (Math.floor(i / width) - cy) ** 2;
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return { x: best % width, y: Math.floor(best / width) };
}

/**
 * A grid map's grid, given to its scope, and its places' cells: `at`, else the middle of the
 * place's area. Each place's area is kept as a zone named by the place. A scope that already has
 * a grid, or a grid id already taken, gets nothing (lint says which).
 */
function compileGrid(key: MapId, map: MapDoc, mine: readonly MapPlaceDef[], places: Record<PlaceId, PlaceDef>, grids: Record<string, GridDef>): void {
  const scope = places[map.scope];
  if (!scope || scope.grid !== undefined || hasOwn(grids, key)) return;
  const { rows, width, height } = layoutOf(map);
  const ids = new Set(mine.map((p) => p.id));
  const terrain: string[] = [];
  const blocked: number[] = [];
  const zones = new Map<string, number[]>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      // A short row is padded with nothing; a character the legend lacks reads as floor (lint flags both).
      const cell = cellOf(map, rows[y]?.[x] ?? " ") ?? "floor";
      if (cell === "wall") {
        terrain.push("wall");
        blocked.push(index);
      } else if (cell === "floor" || cell === "door") terrain.push(cell);
      else if ("terrain" in cell) {
        terrain.push(cell.terrain);
        if (cell.blocked === true) blocked.push(index);
      } else {
        terrain.push("floor");
        const zone = "place" in cell ? (ids.has(cell.place) ? cell.place : null) : cell.zone;
        if (zone !== null) zones.set(zone, [...(zones.get(zone) ?? []), index]);
      }
    }
  }
  grids[key] = { id: key, width, height, terrain, blocked, zones: Object.fromEntries(zones), map: key };
  places[map.scope] = { ...scope, grid: key };
  for (const p of mine) {
    const def = places[p.id];
    if (!def) continue;
    const cell = p.at ? (p.at[0] < width && p.at[1] < height ? { x: p.at[0], y: p.at[1] } : null) : middle(zones.get(p.id) ?? [], width);
    if (cell) places[p.id] = { ...def, cell };
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
  for (const { key, map, places: mine } of plans) {
    if (map.layout) compileGrid(key, map, mine, places, grids);
    else {
      for (const p of mine) {
        const def = places[p.id];
        if (def && p.at) places[p.id] = { ...def, layoutPos: { x: p.at[0], y: p.at[1] } };
      }
    }
    // Travel between a map's places follows its links (with none, the scope's free walking between
    // the places inside it): a grid map's walls and doors are drawn, not walked.
    compileLinks(key, map, places, routes);
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
      for (const [ch, cell] of Object.entries(map.legend ?? {})) if (typeof cell === "object" && "place" in cell && !ids.includes(cell.place)) err(["legend", ch], "map_legend", `"${cell.place}" isn't one of this map's places`);
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
