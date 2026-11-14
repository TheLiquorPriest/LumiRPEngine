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
import { cellOf, indexOf, squareKey, type Square } from "./grid";
import type { Laid } from "./lay";
import { squaresEvent } from "./record";

/** Squares drawn with one symbol: single squares, a filled rectangle between two corners, or a line between two ends. */
export interface Stroke {
  symbol: string;
  squares?: readonly Square[];
  rect?: readonly [Square, Square];
  line?: readonly [Square, Square];
}

/** The squares a stroke covers: a line square by square, a diagonal step where it runs on a slant. */
function strokeSquares(stroke: Stroke): Square[] {
  const out: Square[] = [...(stroke.squares ?? [])];
  if (stroke.rect) {
    const [[c0, r0], [c1, r1]] = stroke.rect;
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) out.push([c, r]);
  }
  if (stroke.line) {
    const [[c0, r0], [c1, r1]] = stroke.line;
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    for (let t = 0; t <= n; t++) out.push(n === 0 ? [c0, r0] : [Math.round(c0 + ((c1 - c0) * t) / n), Math.round(r0 + ((r1 - r0) * t) / n)]);
  }
  return out;
}

/**
 * The grid of `place` with `strokes` drawn on it and `legend` laid over its legend (a symbol given
 * null is taken out), as one change kept square by square over its map. Each square off the grid,
 * and each symbol no legend names, is reported, and the rest is drawn; a change the map's format
 * cannot hold is not recorded and says why. `world` is the revision the chat plays, `state` its
 * state now.
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
  for (const stroke of strokes) {
    if ([...stroke.symbol].length !== 1) {
      reports.push({ code: "bad_symbol", values: { symbol: stroke.symbol } });
      continue;
    }
    const named = hasOwn(legendNow, stroke.symbol) ? legendNow[stroke.symbol] !== null : hasOwn(map.legend ?? {}, stroke.symbol) || hasOwn(DEFAULT_LEGEND, stroke.symbol);
    if (!named) reports.push({ code: "not_in_legend", values: { symbol: stroke.symbol } });
    for (const s of strokeSquares(stroke)) {
      if (indexOf(grid, s) === null) reports.push({ code: "off_grid", values: { square: [...s], width: grid.width, height: grid.height } });
      else drawn.set(squareKey(s), { at: s, symbol: stroke.symbol });
    }
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
