// The text map (plan §8.2): a grid as the world state prints it, whole up to the size the settings
// give (Appendix D.1: 40 by 30 squares), and a larger one around a centre, saying which part is
// shown. The picture is data: the column numbers, then each row's number and its squares' symbols,
// as plan §8.2 lays it out. A thing the map draws is drawn where it stands now, over its footprint.
// The legend (each symbol, what the map's legend says it is, and where it is shown), who and what
// stands where, and the doors' states are data as well: whoever shows the map words them from a file.

import type { EntityId, PlaceId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { MapCellDef } from "../../shared/world";
import { doorState, footprint, GRID_DEFAULTS, squareAt, standsAt, type DoorState, type Drawn, type GridSettings, type Moving, type Piece, type Scale, type Square } from "./grid";

/** One symbol of the picture: what the map's legend says it is, and the squares shown that carry it. */
export interface LegendEntry {
  symbol: string;
  /** As the map's legend gives it (today's `MapCellDef`); a symbol the legend lacks is floor, as the compiler reads it. */
  what: MapCellDef;
  where: Square[];
}

/** Someone or something on the grid as the map lists it. */
export interface Listed {
  id: EntityId;
  /** Where it stands; for what lies on something, that one's square. */
  at: Square | null;
  size?: Square;
  on?: EntityId;
  blocks?: Piece["blocks"];
  /** Whether it stands in the part shown. */
  shown: boolean;
}

export interface Printed {
  /** The grid's id, the place it draws, and the map that draws it. */
  grid: string;
  scope: PlaceId;
  map?: string;
  width: number;
  height: number;
  scale: Scale;
  /** The part shown: its top left square and its bottom right one. */
  from: Square;
  to: Square;
  whole: boolean;
  picture: string;
  /** In the order each symbol first appears, row by row. */
  legend: LegendEntry[];
  /** Everyone and everything on the grid, by id, shown or not. */
  pieces: Listed[];
  /** Every door of the grid and its state. */
  doors: { at: Square; state: DoorState }[];
}

/** Where a window of `size` squares starts on a side of `length` squares, centred on `centre` as far as the edges allow. */
function windowStart(length: number, size: number, centre: number): number {
  return Math.min(Math.max(1, centre - Math.floor((size - 1) / 2)), length - size + 1);
}

/**
 * The grid as text, with its legend, who and what stands where, and its doors. Whole when it fits
 * the settings' size; otherwise the part of that size around `centre` (the grid's middle when none
 * is given).
 */
export function printMap(drawn: Drawn, moving: Moving, opts: { centre?: Square; settings?: Readonly<GridSettings> } = {}): Printed {
  const settings = opts.settings ?? GRID_DEFAULTS;
  const cols = Math.min(drawn.width, settings.printColumns);
  const rows = Math.min(drawn.height, settings.printRows);
  const centre = opts.centre ?? [Math.ceil(drawn.width / 2), Math.ceil(drawn.height / 2)];
  const c0 = windowStart(drawn.width, cols, centre[0]);
  const r0 = windowStart(drawn.height, rows, centre[1]);
  const c1 = c0 + cols - 1;
  const r1 = r0 + rows - 1;

  // What the map draws of a thing is drawn where the thing stands now: its drawn square shows floor.
  const symbols = [...drawn.symbols];
  const marks = new Map<EntityId, string>();
  const floor = Object.keys(drawn.legend).find((s) => drawn.legend[s] === "floor") ?? ".";
  for (const [symbol, what] of Object.entries(drawn.legend)) if (typeof what === "object" && "item" in what) marks.set(what.item, symbol);
  symbols.forEach((s, i) => {
    const what = hasOwn(drawn.legend, s) ? drawn.legend[s] : undefined;
    if (typeof what === "object" && "item" in what) symbols[i] = floor;
  });
  for (const id of Object.keys(moving.pieces).sort()) {
    const mark = marks.get(id);
    if (mark !== undefined && moving.pieces[id]?.at) for (const i of footprint(drawn, moving, id)) symbols[i] = mark;
  }

  const columns: number[] = [];
  for (let c = c0; c <= c1; c++) columns.push(c);
  const lines = [" ".repeat(6) + columns.join(" ")];
  const legend = new Map<string, LegendEntry>();
  for (let r = r0; r <= r1; r++) {
    const row: string[] = [];
    for (const c of columns) {
      const s = symbols[(r - 1) * drawn.width + (c - 1)] ?? " ";
      // Each symbol under the first digit of its column's number.
      row.push(s.padEnd(String(c).length));
      const entry = legend.get(s) ?? { symbol: s, what: (hasOwn(drawn.legend, s) ? drawn.legend[s] : undefined) ?? "floor", where: [] };
      entry.where.push([c, r]);
      legend.set(s, entry);
    }
    lines.push(`${String(r).padStart(4)}  ${row.join(" ")}`.trimEnd());
  }

  const pieces: Listed[] = Object.keys(moving.pieces)
    .sort()
    .map((id) => {
      const p = moving.pieces[id];
      const at = standsAt(moving, id);
      return { id, at, ...(p?.size ? { size: p.size } : {}), ...(p?.on !== undefined ? { on: p.on } : {}), ...(p?.blocks ? { blocks: p.blocks } : {}), shown: at !== null && at[0] >= c0 && at[0] <= c1 && at[1] >= r0 && at[1] <= r1 };
    });
  const doors = [...drawn.doors].sort((a, b) => a - b).map((i) => ({ at: squareAt(drawn, i), state: doorState(drawn, moving, i) ?? "open" }));
  return {
    grid: drawn.id,
    scope: drawn.scope,
    ...(drawn.map !== undefined ? { map: drawn.map } : {}),
    width: drawn.width,
    height: drawn.height,
    scale: drawn.scale,
    from: [c0, r0],
    to: [c1, r1],
    whole: cols === drawn.width && rows === drawn.height,
    picture: lines.join("\n"),
    legend: [...legend.values()],
    pieces,
    doors,
  };
}
