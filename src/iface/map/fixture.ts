// A fixture drawn on a map (plan §8.2: "anything drawn can start to move"): the table the map draws
// as blocked terrain, which an overturned table, a pushed bar or a barricade dragged across the room
// makes a thing of its own. The fixture is the squares around one square that are drawn with the
// same symbol of terrain; what becomes a thing is its name (the terrain's), its footprint (the box
// around those squares) and what it blocks (the terrain's: the way, and the view unless the legend
// lets it pass). Its squares become floor in the same call, as the chat's change, so that the thing
// stands where the fixture was drawn and the way over it is the thing's to block.

import { hasOwn } from "../../shared/json";
import { seesThrough } from "../../packs/space/core/grid-play";
import { indexOf, squareAt, type Drawn, type Square } from "../../packs/space/core/grid-model";

/** A fixture read off a grid. */
export interface Fixture {
  /** The terrain's name, unless the call names it. */
  name: string;
  /** Its top left square, and the box around its squares: columns and rows. */
  at: Square;
  size: readonly [number, number];
  blocks: { way: boolean; view: boolean };
  /** Every square it is drawn on. */
  squares: Square[];
}

/**
 * The fixture drawn on `square`: the squares joined to it (up, down, left and right) that are drawn
 * with the same symbol, when that symbol stands for terrain of a name. Null where the square is
 * drawn with anything else (a wall, floor, a door, a zone, a place's area, a thing the map lays):
 * no fixture is there to lift.
 */
export function fixtureAt(drawn: Drawn, square: Square): Fixture | null {
  const start = indexOf(drawn, square);
  if (start === null) return null;
  const symbol = drawn.symbols[start] ?? " ";
  const cell = hasOwn(drawn.legend, symbol) ? drawn.legend[symbol] : undefined;
  if (cell === undefined || typeof cell !== "object" || !("terrain" in cell) || cell.terrain.trim() === "") return null;
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] ?? 0;
    const x = i % drawn.width;
    const next = [i - drawn.width, i + drawn.width, x > 0 ? i - 1 : -1, x < drawn.width - 1 ? i + 1 : -1];
    for (const n of next) {
      if (n < 0 || n >= drawn.width * drawn.height || seen.has(n) || drawn.symbols[n] !== symbol) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  const squares = [...seen].sort((a, b) => a - b).map((i) => squareAt(drawn, i));
  const columns = squares.map((s) => s[0]);
  const rows = squares.map((s) => s[1]);
  const [left, top] = [Math.min(...columns), Math.min(...rows)];
  const way = cell.blocked === true;
  return { name: cell.terrain, at: [left, top], size: [Math.max(...columns) - left + 1, Math.max(...rows) - top + 1], blocks: { way, view: way && !seesThrough(cell) }, squares };
}
