// Grids (DESIGN §3 Locations, §7, §12): cells, A* with a hard expansion cap, walking minutes, the
// cells someone sees from where they stand, and where someone stands on a grid at a place. Pure
// over grids and the world's places, so the engine, the space pack, the map compiler and Play's map
// all read one geometry.

import type { PlaceId } from "./ids";
import { hasOwn } from "./json";
import type { GridDef, PlaceDef, WorldDoc } from "./world";

export interface Cell {
  x: number;
  y: number;
}

/** What paths and sight read of a grid. */
export type GridShape = Pick<GridDef, "width" | "height" | "terrain" | "blocked">;

/** Cost to enter a cell by its terrain code; blocked cells are impassable. */
export const GRID_TERRAIN_COST: Readonly<Record<string, number>> = Object.freeze({ "": 1, ".": 1, floor: 1, road: 1, grass: 1.2, sand: 1.8, mud: 2, water: 4, rough: 1.6, "~": 4, "^": 3 });

/** Expanded-node cap for one A* search: a search past it returns null. */
export const ASTAR_CAP = 20_000;

/** The grid system's sight radius, in cells, is a whole number up to this. */
export const SIGHT_MAX = 32;

export interface GridPath {
  cells: Cell[];
  cost: number;
}

/** The cost of entering a cell: its terrain's, at least 1. */
export function cellCost(grid: Pick<GridDef, "terrain">, index: number): number {
  const terrain = grid.terrain[index] ?? "";
  return Math.max(1, (hasOwn(GRID_TERRAIN_COST, terrain) ? GRID_TERRAIN_COST[terrain] : undefined) ?? 1);
}

/** A cell's index on a grid, or null when it lies off it (or isn't a whole cell). */
export function cellIndex(grid: Pick<GridDef, "width" | "height">, c: Cell): number | null {
  return Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < grid.width && c.y < grid.height ? c.y * grid.width + c.x : null;
}

export function cellAt(grid: Pick<GridDef, "width">, index: number): Cell {
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

/**
 * A* on a grid, 4-connected, Manhattan heuristic (admissible: every step costs ≥ 1). Returns the
 * cheapest path including both ends, or null when blocked, off-grid or past `cap` expansions.
 */
export function findPath(grid: GridShape, from: Cell, to: Cell, cap = ASTAR_CAP): GridPath | null {
  const blocked = new Set(grid.blocked);
  const start = cellIndex(grid, from);
  const goal = cellIndex(grid, to);
  if (start === null || goal === null || blocked.has(start) || blocked.has(goal)) return null;
  const h = (i: number): number => Math.abs((i % grid.width) - to.x) + Math.abs(Math.floor(i / grid.width) - to.y);
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open = new Map<number, number>([[start, h(start)]]);
  let expanded = 0;
  while (open.size > 0) {
    let cur = -1;
    let best = Infinity;
    for (const [i, f] of open) if (f < best || (f === best && i < cur)) {
      best = f;
      cur = i;
    }
    if (cur === goal) {
      const cells: Cell[] = [];
      for (let i: number | undefined = cur; i !== undefined; i = came.get(i)) cells.unshift(cellAt(grid, i));
      return { cells, cost: g.get(cur) ?? 0 };
    }
    open.delete(cur);
    if (++expanded > cap) return null;
    const cx = cur % grid.width;
    const cy = Math.floor(cur / grid.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = cellIndex(grid, { x: cx + dx, y: cy + dy });
      if (ni === null || blocked.has(ni)) continue;
      const ng = (g.get(cur) ?? 0) + cellCost(grid, ni);
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, cur);
        open.set(ni, ng + h(ni));
      }
    }
  }
  return null;
}

/** Walking minutes for a path's cost: the cost × the cell size, at 80 m per minute (a cell is 80 m by default). */
export function costMinutes(grid: Pick<GridDef, "cellMeters">, cost: number): number {
  return Math.round(((grid.cellMeters ?? 80) * cost) / 80);
}

/** Walking minutes along a grid path, at least one for any step. */
export function gridMinutes(grid: Pick<GridDef, "cellMeters">, path: GridPath): number {
  return Math.max(path.cells.length > 1 ? 1 : 0, costMinutes(grid, path.cost));
}

/**
 * The cheapest cost from one cell to every cell (Dijkstra, 4-connected, entering a cell costs its
 * terrain's), where `enters(from, to)` decides which steps are allowed; unreachable is Infinity.
 */
export function gridCosts(grid: GridShape, from: number, enters: (from: number, to: number) => boolean): Float64Array {
  const size = grid.width * grid.height;
  const cost = new Float64Array(size).fill(Infinity);
  if (from < 0 || from >= size) return cost;
  const blocked = new Set(grid.blocked);
  // A binary heap of [cost, cell] that pops in (cost, cell) order, so ties settle the same way every time.
  const heap: [number, number][] = [];
  const before = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: [number, number]): void => {
    let i = heap.length;
    heap.push(item);
    for (let parent = heap[(i - 1) >> 1]; i > 0 && parent && before(item, parent); parent = heap[(i - 1) >> 1]) {
      heap[i] = parent;
      i = (i - 1) >> 1;
    }
    heap[i] = item;
  };
  const pop = (): [number, number] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (!last || heap.length === 0) return top;
    // Sift `last` down from the root, moving the smaller child up while it comes first.
    for (let i = 0; ; ) {
      const left = heap[2 * i + 1];
      const right = heap[2 * i + 2];
      const child = left && right && before(right, left) ? 2 * i + 2 : 2 * i + 1;
      const next = heap[child];
      if (!next || !before(next, last)) {
        heap[i] = last;
        break;
      }
      heap[i] = next;
      i = child;
    }
    return top;
  };
  cost[from] = 0;
  push([0, from]);
  for (let item = pop(); item; item = pop()) {
    const [c, cur] = item;
    if (c > (cost[cur] ?? Infinity)) continue;
    const cx = cur % grid.width;
    const cy = Math.floor(cur / grid.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = cellIndex(grid, { x: cx + dx, y: cy + dy });
      if (next === null || blocked.has(next) || !enters(cur, next)) continue;
      const nc = c + cellCost(grid, next);
      if (nc < (cost[next] ?? Infinity)) {
        cost[next] = nc;
        push([nc, next]);
      }
    }
  }
  return cost;
}

/**
 * Whether nothing blocks the straight line between two cells: every cell Bresenham's line crosses
 * between them is open. The two ends don't count, so a wall is itself seen and hides what's past it.
 */
export function lineOfSight(grid: Pick<GridDef, "width" | "height">, blocked: ReadonlySet<number>, from: Cell, to: Cell): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  let x = from.x;
  let y = from.y;
  for (let guard = 0; guard <= grid.width + grid.height; guard++) {
    if (x === to.x && y === to.y) return true;
    if ((x !== from.x || y !== from.y) && blocked.has(y * grid.width + x)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

/**
 * The cells seen from a cell (the grid system, DESIGN §7): within `radius` cells (a round disc),
 * each with an unbroken line of sight, so walls block the view and doorways let it through. In
 * index order.
 */
export function sightCells(grid: GridShape, from: Cell, radius: number): number[] {
  if (cellIndex(grid, from) === null) return [];
  const r = Math.min(SIGHT_MAX, Math.max(0, Math.floor(radius)));
  const blocked = new Set(grid.blocked);
  const out: number[] = [];
  for (let y = Math.max(0, from.y - r); y <= Math.min(grid.height - 1, from.y + r); y++) {
    for (let x = Math.max(0, from.x - r); x <= Math.min(grid.width - 1, from.x + r); x++) {
      const dx = x - from.x;
      const dy = y - from.y;
      // r² + r rounds the disc's edge (no lone cells sticking out of it at the axes).
      if (dx * dx + dy * dy <= r * r + r && lineOfSight(grid, blocked, from, { x, y })) out.push(y * grid.width + x);
    }
  }
  return out;
}

/**
 * A set of cells as text: four cells to a hex digit (cell i is bit i mod 4 of digit ⌊i / 4⌋),
 * trailing zeros dropped. The same set always reads the same, so state holding one compares by
 * hash, and a floor of thousands of cells stays a short string.
 */
export function hasCell(set: string, cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0) return false;
  const digit = Number.parseInt(set.charAt(cell >> 2) || "0", 16);
  return Number.isFinite(digit) && (digit & (1 << (cell & 3))) !== 0;
}

/** A cell set with `cells` added (`hasCell`). */
export function addCells(set: string, cells: Iterable<number>): string {
  const digits = [...set].map((ch) => Number.parseInt(ch, 16) || 0);
  for (const cell of cells) {
    if (!Number.isInteger(cell) || cell < 0) continue;
    const at = cell >> 2;
    while (digits.length <= at) digits.push(0);
    digits[at] = (digits[at] ?? 0) | (1 << (cell & 3));
  }
  let end = digits.length;
  while (end > 0 && digits[end - 1] === 0) end--;
  return digits
    .slice(0, end)
    .map((d) => d.toString(16))
    .join("");
}

/** The cell of an area nearest its middle: where a room's dot goes when nothing else places it. */
export function nearestMiddle(cells: readonly number[], width: number): Cell | null {
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

// ---------------------------------------------------------------- standing on a grid

type GridWorld = Pick<WorldDoc, "places" | "grids">;

/** Where someone stands: the place whose grid it is, the grid, and (once known) the cell. */
export interface Standing {
  scope: PlaceId;
  grid: GridDef;
}

function placeOf(world: Pick<WorldDoc, "places">, id: PlaceId): PlaceDef | undefined {
  return hasOwn(world.places, id) ? world.places[id] : undefined;
}

/** A place's own grid, if it has one. */
export function gridOf(world: GridWorld, place: PlaceId): GridDef | undefined {
  const id = placeOf(world, place)?.grid;
  return id !== undefined && hasOwn(world.grids, id) ? world.grids[id] : undefined;
}

/** A place's area on its parent's grid: the zone named after it (each room of a grid map). */
export function areaOf(grid: GridDef, place: PlaceId): readonly number[] {
  return (hasOwn(grid.zones, place) ? grid.zones[place] : undefined) ?? [];
}

/**
 * The grid someone at `place` stands on (DESIGN §7, §12): the place's own grid; else its parent's,
 * when the place is drawn on it (a cell there, or an area: a room of a floor plan); else none.
 */
export function standingGrid(world: GridWorld, place: PlaceId | null): Standing | null {
  if (place === null) return null;
  const def = placeOf(world, place);
  if (!def) return null;
  const own = gridOf(world, place);
  if (own) return { scope: place, grid: own };
  const up = def.parent !== undefined ? gridOf(world, def.parent) : undefined;
  if (def.parent === undefined || !up) return null;
  const drawn = (def.cell !== undefined && cellIndex(up, def.cell) !== null) || areaOf(up, place).length > 0;
  return drawn ? { scope: def.parent, grid: up } : null;
}

/** The place inside `scope` whose area holds a cell of the scope's grid; null on open floor, a door or a corridor. */
export function areaPlaceAt(world: Pick<WorldDoc, "places">, scope: PlaceId, grid: GridDef, cell: number): PlaceId | null {
  for (const id of Object.keys(grid.zones).sort()) if (placeOf(world, id)?.parent === scope && areaOf(grid, id).includes(cell)) return id;
  return null;
}

const DOOR_TERRAIN = /door|gate|arch/i;

/** Where someone entering a gridded place stands: a door on the grid's edge, else any door, else the open cell nearest its middle. */
export function entranceCell(grid: GridDef): Cell | null {
  const blocked = new Set(grid.blocked);
  const open: number[] = [];
  const doors: number[] = [];
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (blocked.has(i)) continue;
    open.push(i);
    if (DOOR_TERRAIN.test(grid.terrain[i] ?? "")) doors.push(i);
  }
  const door = doors.find((i) => i % grid.width === 0 || i % grid.width === grid.width - 1 || i < grid.width || i >= grid.width * (grid.height - 1)) ?? doors[0];
  return door !== undefined ? cellAt(grid, door) : nearestMiddle(open, grid.width);
}

/**
 * Where someone arriving at a place stands while the grid system is on (DESIGN §7): at the
 * entrance of a place with a grid of its own; else on the cell the place is drawn at on its
 * parent's grid, or, for a room drawn only as an area, the cell nearest its middle. Null off any grid.
 */
export function arrivalCell(world: GridWorld, place: PlaceId): (Standing & { cell: Cell }) | null {
  const stand = standingGrid(world, place);
  if (!stand) return null;
  if (stand.scope === place) {
    const cell = entranceCell(stand.grid);
    return cell ? { ...stand, cell } : null;
  }
  const at = placeOf(world, place)?.cell;
  if (at && cellIndex(stand.grid, at) !== null) return { ...stand, cell: { x: at.x, y: at.y } };
  const middle = nearestMiddle(areaOf(stand.grid, place), stand.grid.width);
  return middle ? { ...stand, cell: middle } : null;
}

/**
 * Where the things a grid places start (`GridDef.items`, DESIGN §4.1): each thing at its cell, in
 * the place whose area holds the cell, else in the place the grid draws. Places in id order.
 */
export function placedItems(world: GridWorld): { id: string; place: PlaceId; cell: Cell }[] {
  const out: { id: string; place: PlaceId; cell: Cell }[] = [];
  const taken = new Set<string>();
  for (const scope of Object.keys(world.places).sort()) {
    const grid = gridOf(world, scope);
    if (!grid?.items) continue;
    for (const id of Object.keys(grid.items).sort()) {
      const index = grid.items[id];
      if (index === undefined || taken.has(id) || !Number.isInteger(index) || index < 0 || index >= grid.width * grid.height) continue;
      taken.add(id);
      out.push({ id, place: areaPlaceAt(world, scope, grid, index) ?? scope, cell: cellAt(grid, index) });
    }
  }
  return out;
}
