// Changing part of a grid in play (plan §8.2, `map_edit`): squares, rectangles and lines drawn with
// a symbol, and the legend added to or taken from, the rest of the map left as it is. Today's draft
// of a chat's world carries a map whole, so the change is the map with those squares changed,
// written into the chat's own draft (`engine.world`), as today's `world_map` tool writes it.

import type { PlaceId } from "../../shared/ids";
import { hasOwn, type JsonObject } from "../../shared/json";
import { gridOf } from "../../shared/grid";
import { DEFAULT_LEGEND, readMap } from "../../shared/maps";
import type { MapCellDef, MapDoc, WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import type { WorldState } from "../../engine/state";
import type { Report } from "../../store/types";
import { indexOf, type Square } from "./grid";
import type { Laid } from "./lay";
import { draftChange } from "./record";

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
 * The grid of `place` with `strokes` drawn on it and `legend` laid over its legend (a symbol
 * given null is taken out). Each square off the grid, and each symbol no legend names, is
 * reported; the rest is applied. `world` is the revision the chat plays, `state` its state now.
 */
export function editMap(world: WorldDoc, state: Readonly<WorldState>, place: PlaceId, strokes: readonly Stroke[], legend: Readonly<Record<string, MapCellDef | null>> = {}): Laid {
  const played = playedWorld(world, state);
  const grid = gridOf(played, place);
  const map = grid?.map !== undefined && hasOwn(played.maps, grid.map) ? played.maps[grid.map] : undefined;
  if (!grid || !map?.layout) return { changes: [], scope: null, reports: [{ code: "no_map", values: { place } }] };
  const rows = Array.from({ length: grid.height }, (_, r) => {
    const row = [...(map.layout?.[r] ?? "")];
    while (row.length < grid.width) row.push(" ");
    return row;
  });
  const legendNow: Record<string, MapCellDef> = { ...(map.legend ?? {}) };
  for (const [symbol, what] of Object.entries(legend)) {
    if (what === null) delete legendNow[symbol];
    else legendNow[symbol] = what;
  }
  const reports: Report[] = [];
  for (const stroke of strokes) {
    if ([...stroke.symbol].length !== 1) {
      reports.push({ code: "bad_symbol", values: { symbol: stroke.symbol } });
      continue;
    }
    if (!hasOwn(legendNow, stroke.symbol) && !hasOwn(DEFAULT_LEGEND, stroke.symbol)) reports.push({ code: "not_in_legend", values: { symbol: stroke.symbol } });
    for (const s of strokeSquares(stroke)) {
      const row = indexOf(grid, s) === null ? undefined : rows[s[1] - 1];
      if (row) row[s[0] - 1] = stroke.symbol;
      else reports.push({ code: "off_grid", values: { square: [...s] } });
    }
  }
  const next: MapDoc = { ...map, layout: rows.map((r) => r.join("")) };
  if (Object.keys(legendNow).length > 0) next.legend = legendNow;
  else delete next.legend;
  const { problems } = readMap(next);
  if (problems.length > 0) return { changes: [], scope: place, reports: [...reports, ...problems.map((p) => ({ code: "bad_map", values: { at: p.path } }))] };
  return { changes: [draftChange(world, state, { collection: "maps", id: map.id, value: next as unknown as JsonObject })], scope: place, reports };
}
