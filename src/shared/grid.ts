// Grids (DESIGN §3 Locations, §7, §12): cells, the cost of entering one, walking minutes, the cheapest
// cost to every cell (travel between a map's places), and where someone stands on a grid at a place.
// Pure over grids and the world's places. Ways, measuring and sight on a grid are the space pack's one
// geometry (`packs/space/core/grid-model.ts`, `grid-path.ts`, `grid-measure.ts`), not read here.

import type { PlaceId } from "./ids";
import { hasOwn } from "./json";
import type { GridDef, PlaceDef, WorldDoc } from "./world";

export interface Cell {
  x: number;
  y: number;
}

/** What the cheapest costs read of a grid. */
export type GridShape = Pick<GridDef, "width" | "height" | "terrain" | "blocked">;

/** Cost to enter a cell by its terrain code; blocked cells are impassable. */
export const GRID_TERRAIN_COST: Readonly<Record<string, number>> = Object.freeze({ "": 1, ".": 1, floor: 1, road: 1, grass: 1.2, sand: 1.8, mud: 2, water: 4, rough: 1.6, "~": 4, "^": 3 });

/** The grid system's sight radius, in cells, is a whole number up to this. */
export const SIGHT_MAX = 32;

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

/** How wide a cell is, in metres, where a map gives none: a block of a town. The one home of this default; the grid and the walking minutes read it here. */
export const DEFAULT_CELL_METRES = 80;

/** How far someone walks in a minute, in metres. */
export const WALK_METRES_PER_MINUTE = 80;

/** Walking minutes for a path's cost: the cost × the cell size, at the walking speed (a cell is `DEFAULT_CELL_METRES` where its map gives none). */
export function costMinutes(grid: Pick<GridDef, "cellMeters">, cost: number): number {
  return Math.round(((grid.cellMeters ?? DEFAULT_CELL_METRES) * cost) / WALK_METRES_PER_MINUTE);
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
