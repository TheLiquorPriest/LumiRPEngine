// Paths on squares (plan §8.2): eight directions, a diagonal counted as the grid counts it, and no
// cutting across the corner of anything that blocks the way. Entering a square costs its terrain's
// (today's table, `shared/grid.ts cellCost`), so the cheapest way round the mud is the one taken.
// The answer gives the squares passed, how far that is in squares, and the movement it cost.

import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { ASTAR_CAP, cellCost } from "../../shared/grid";
import { blockersOf, indexOf, place, squareAt, standsAt, type Drawn, type Moving, type Placed, type Square } from "./grid";
import { distance } from "./measure";
import { moveTime, type Took } from "./time";

/** A way across a grid. */
export interface Walk {
  /** The squares passed, both ends included. */
  squares: Square[];
  /** How far, in squares, by the grid's rule for diagonals. */
  distance: number;
  /** The movement it takes: each square entered costs its terrain's (at least one), a diagonal counted by the rule. */
  cost: number;
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * The cheapest way from `from` to `to`, or null when there is none (the end blocked, walls and
 * shut doors between, or a search past today's cap). For `mover`, its whole footprint stands on
 * each square of the way, and its own footprint never blocks it. A diagonal step needs both
 * squares beside it clear. Under the alternating rule, which diagonal is the second counts, so
 * each square is searched twice: after an even and after an odd number of diagonals.
 */
export function walk(drawn: Drawn, moving: Moving, from: Square, to: Square, mover?: EntityId): Walk | null {
  const way = blockersOf(drawn, moving, mover !== undefined ? [mover] : []).way;
  const [w, h] = (mover !== undefined && hasOwn(moving.pieces, mover) ? moving.pieces[mover]?.size : undefined) ?? [1, 1];
  const fits = (c: number, r: number): boolean => {
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const i = indexOf(drawn, [c + dc, r + dr]);
        if (i === null || way.has(i)) return false;
      }
    }
    return true;
  };
  const enters = (c: number, r: number): number => {
    let most = 1;
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) most = Math.max(most, cellCost(drawn, indexOf(drawn, [c + dc, r + dr]) ?? -1));
    return most;
  };
  const start = indexOf(drawn, from);
  const goal = indexOf(drawn, to);
  if (start === null || goal === null || !fits(to[0], to[1])) return null;
  const rule = drawn.scale.diagonal;
  const left = (i: number): number => distance(rule, squareAt(drawn, i), to);
  const straight = (i: number): number => {
    const [c, r] = squareAt(drawn, i);
    return (c - to[0]) ** 2 + (r - to[1]) ** 2;
  };
  // A node is a square and whether an odd number of diagonals led to it.
  const g = new Map<number, number>([[start * 2, 0]]);
  const came = new Map<number, number>();
  const open = new Map<number, number>([[start * 2, left(start)]]);
  // The lowest estimate first; among equals the square nearer the goal, then nearer in a straight
  // line (so a way reads straight), then the lower node, so the same grid always gives the same way.
  const ahead = (a: number, b: number): boolean => {
    const fa = open.get(a) ?? Infinity;
    const fb = open.get(b) ?? Infinity;
    if (fa !== fb) return fa < fb;
    const la = left(a >> 1);
    const lb = left(b >> 1);
    if (la !== lb) return la < lb;
    const sa = straight(a >> 1);
    const sb = straight(b >> 1);
    return sa !== sb ? sa < sb : a < b;
  };
  let expanded = 0;
  while (open.size > 0) {
    let cur = -1;
    for (const node of open.keys()) if (cur === -1 || ahead(node, cur)) cur = node;
    const at = cur >> 1;
    if (at === goal) return wayTo(drawn, came, cur, g.get(cur) ?? 0);
    open.delete(cur);
    if (++expanded > ASTAR_CAP) return null;
    const odd = cur & 1;
    const [c, r] = squareAt(drawn, at);
    for (const [dc, dr] of STEPS) {
      if (!fits(c + dc, r + dr)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (diagonal && (!fits(c + dc, r) || !fits(c, r + dr))) continue;
      const counts = diagonal && rule === "alternate" && odd === 1 ? 2 : 1;
      const next = (indexOf(drawn, [c + dc, r + dr]) ?? 0) * 2 + (diagonal && rule === "alternate" ? 1 - odd : odd);
      const ng = (g.get(cur) ?? 0) + enters(c + dc, r + dr) * counts;
      if (ng < (g.get(next) ?? Infinity)) {
        g.set(next, ng);
        came.set(next, cur);
        open.set(next, ng + left(next >> 1));
      }
    }
  }
  return null;
}

/** The way that ends at `end`, read back along `came`, with its distance counted step by step. */
function wayTo(drawn: Drawn, came: ReadonlyMap<number, number>, end: number, cost: number): Walk {
  const squares: Square[] = [];
  for (let node: number | undefined = end; node !== undefined; node = came.get(node)) squares.unshift(squareAt(drawn, node >> 1));
  let far = 0;
  let diagonals = 0;
  for (let k = 1; k < squares.length; k++) {
    const a = squares[k - 1];
    const b = squares[k];
    const diagonal = a !== undefined && b !== undefined && a[0] !== b[0] && a[1] !== b[1];
    if (diagonal) diagonals++;
    far += diagonal && drawn.scale.diagonal === "alternate" && diagonals % 2 === 0 ? 2 : 1;
  }
  return { squares, distance: far, cost };
}

/** What a move came to: the moving layer after, the way taken and how long it took on the grid's step (null where no way was walked), and what does not add up. */
export interface Moved extends Placed {
  walk: Walk | null;
  took: Took | null;
}

/**
 * Moves someone or something to a square along the cheapest way from where it stands, at `speed`
 * squares a round when its speed is known. With no way there it is put there all the same, and
 * that is reported; one that stood nowhere on the grid is put there, with no way walked.
 */
export function move(drawn: Drawn, moving: Moving, id: EntityId, to: Square, speed?: number): Moved {
  const from = standsAt(moving, id);
  const way = from ? walk(drawn, moving, from, to, id) : null;
  const placed = place(drawn, moving, id, to);
  if (placed.moving === moving) return { ...placed, walk: null, took: null };
  const took = way ? moveTime(drawn.scale, way.cost, speed) : null;
  return { ...placed, walk: way, took, reports: from && !way ? [{ code: "no_way", values: { what: id, from: [...from], to: [...to] } }, ...placed.reports] : placed.reports };
}
