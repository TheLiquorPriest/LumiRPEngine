// Changing part of a grid in play (plan §8.2, `map_edit`): squares, rectangles and lines drawn with
// a symbol, and the legend added to or taken from, the rest of the map left as it is. The change is
// kept as that change, square by square, over the map (`space.squares`), so a later edit of the
// world's own map still shows through wherever this one did not draw.

import type { PlaceId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { gridOf } from "../../shared/grid";
import { DEFAULT_LEGEND, readMap } from "../../shared/maps";
import type { MapCellDef, WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import { cellKey, editedMap, SQUARES_EVENT, squareEditsOf } from "../../packs/space/core/grid-play";
import type { Report } from "../../store/types";
import { cellOf, indexOf, squareKey, type Drawn, type Square } from "./grid";
import type { Laid } from "./lay";
import { squaresEvent } from "./record";

/** Squares drawn with one symbol: single squares, a filled rectangle between two corners, or a line between two ends. */
export interface Stroke {
  symbol: string;
  squares?: readonly Square[];
  rect?: readonly [Square, Square];
  line?: readonly [Square, Square];
}

/**
 * A stroke clipped to the grid before any square of it is listed, so that the work is the grid's
 * size whatever numbers it was sent: the squares it draws on the grid (a line square by square, a
 * diagonal step where it runs on a slant), and how many of its squares lie off the grid.
 */
function strokeOn(grid: Pick<Drawn, "width" | "height">, stroke: Stroke): { on: Square[]; off: bigint } {
  const on: Square[] = [];
  // A rectangle far off the grid holds more squares than a number counts exactly.
  let all = 0n;
  for (const s of stroke.squares ?? []) {
    all++;
    if (indexOf(grid, s) !== null) on.push(s);
  }
  if (stroke.rect) {
    const [[c0, r0], [c1, r1]] = stroke.rect;
    all += BigInt(Math.abs(c1 - c0) + 1) * BigInt(Math.abs(r1 - r0) + 1);
    for (let r = Math.max(1, Math.min(r0, r1)); r <= Math.min(grid.height, Math.max(r0, r1)); r++) for (let c = Math.max(1, Math.min(c0, c1)); c <= Math.min(grid.width, Math.max(c0, c1)); c++) on.push([c, r]);
  }
  if (stroke.line) {
    const [[c0, r0], [c1, r1]] = stroke.line;
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    all += BigInt(n + 1);
    // Along its longer side a line moves one square a step, so only the steps whose square on that side is on the grid can draw.
    const across = Math.abs(c1 - c0) >= Math.abs(r1 - r0);
    const [start, sign, side] = across ? [c0, Math.sign(c1 - c0), grid.width] : [r0, Math.sign(r1 - r0), grid.height];
    const first = sign > 0 ? Math.max(0, 1 - start) : sign < 0 ? Math.max(0, start - side) : 0;
    const last = sign > 0 ? Math.min(n, side - start) : sign < 0 ? Math.min(n, start - 1) : 0;
    for (let t = first; t <= last; t++) {
      const along = start + sign * t;
      const s: Square = n === 0 ? [c0, r0] : across ? [along, Math.round(r0 + ((r1 - r0) * t) / n)] : [Math.round(c0 + ((c1 - c0) * t) / n), along];
      if (indexOf(grid, s) !== null) on.push(s);
    }
  }
  return { on, off: all - BigInt(on.length) };
}

/**
 * The grid of `place` with `strokes` drawn on it and `legend` laid over its legend (a symbol given
 * null is taken out), as one change kept square by square over its map. A stroke that reaches off
 * the grid is reported once, with how many of its squares lie off it, and each symbol no legend
 * names is reported; the rest is drawn. A change the map's format cannot hold is not recorded and
 * says why. `world` is the revision the chat plays, `state` its state now.
 */
export function editMap(world: WorldDoc, state: Readonly<WorldState>, place: PlaceId, strokes: readonly Stroke[], legend: Readonly<Record<string, MapCellDef | null>> = {}): Laid {
  const played = playedWorld(world, state);
  const grid = gridOf(played, place);
  const map = grid?.map !== undefined && hasOwn(played.maps, grid.map) ? played.maps[grid.map] : undefined;
  if (!grid || !map?.layout) return { changes: [], scope: null, reports: [{ code: "no_map", values: { place } }] };
  const was = squareEditsOf(state, map.id);
  const legendNow: Record<string, MapCellDef | null> = { ...(was?.legend ?? {}), ...legend };
  const reports: Report[] = [];
  const drawn = new Map<string, { at: Square; symbol: string }>();
  for (const [k, stroke] of strokes.entries()) {
    if ([...stroke.symbol].length !== 1) {
      reports.push({ code: "bad_symbol", values: { symbol: stroke.symbol } });
      continue;
    }
    const named = hasOwn(legendNow, stroke.symbol) ? legendNow[stroke.symbol] !== null : hasOwn(map.legend ?? {}, stroke.symbol) || hasOwn(DEFAULT_LEGEND, stroke.symbol);
    if (!named) reports.push({ code: "not_in_legend", values: { symbol: stroke.symbol } });
    const { on, off } = strokeOn(grid, stroke);
    if (off > 0n) reports.push({ code: "fell_off", values: { stroke: k + 1, symbol: stroke.symbol, count: off <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(off) : off.toString(), width: grid.width, height: grid.height } });
    for (const s of on) drawn.set(squareKey(s), { at: s, symbol: stroke.symbol });
  }
  if (drawn.size === 0 && Object.keys(legend).length === 0) return { changes: [], scope: place, reports: [...reports, { code: "nothing_drawn", values: { place } }] };
  const cells: Record<string, string> = { ...(was?.cells ?? {}) };
  for (const d of drawn.values()) {
    const c = cellOf(d.at);
    cells[cellKey(c.x, c.y)] = d.symbol;
  }
  const { problems } = readMap(editedMap(map, { cells, legend: legendNow }));
  if (problems.length > 0) return { changes: [], scope: place, reports: [...reports, ...problems.map((p) => ({ code: "bad_map", values: { at: p.path } }))] };
  return { changes: [{ lane: "engine", op: SQUARES_EVENT, value: squaresEvent(map.id, [...drawn.values()], legend) }], scope: place, reports };
}
