// Paths on squares (plan §8.2): eight directions, a diagonal counted as the grid counts it, and no
// cutting across the corner of anything that blocks the way. Entering a square costs its terrain's
// (today's table, `shared/grid.ts cellCost`), so the cheapest way round the mud is the one taken.
// The answer gives the squares passed, how far that is in squares, and the movement it cost. The
// search takes its next square from a heap and has no step cap: it is bounded by the grid, which
// the map format bounds, and "no way" is said only when every reachable square was searched.

import type { EntityId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import { cellCost } from "../../../shared/grid";
import { distance } from "./grid-measure";
import { blockersOf, indexOf, moveTime, place, squareAt, standsAt, type Drawn, type Moving, type Placed, type Square, type Took } from "./grid-model";

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

/** A search's open squares: a binary heap that pops the entry `before` says comes first. */
class Open<T> {
  readonly #items: T[] = [];
  readonly #before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.#before = before;
  }

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    const items = this.#items;
    let i = items.length;
    items.push(item);
    for (let parent = items[(i - 1) >> 1]; i > 0 && parent !== undefined && this.#before(item, parent); parent = items[(i - 1) >> 1]) {
      items[i] = parent;
      i = (i - 1) >> 1;
    }
    items[i] = item;
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (last === undefined || items.length === 0) return top;
    for (let i = 0; ; ) {
      const left = items[2 * i + 1];
      const right = items[2 * i + 2];
      const child = left !== undefined && right !== undefined && this.#before(right, left) ? 2 * i + 2 : 2 * i + 1;
      const next = items[child];
      if (next === undefined || !this.#before(next, last)) {
        items[i] = last;
        break;
      }
      items[i] = next;
      i = child;
    }
    return top;
  }
}

/**
 * The cheapest way from `from` to `to`, or null when there is none (the end blocked, walls and
 * shut doors between). For `mover`, its whole footprint stands on each square of the way, and its
 * own footprint never blocks it; nor does that of `target`, the someone or something the way goes
 * to, as sight leaves out both ends. `also` squares block the way besides (what the mover may not
 * enter for being no place it can see). A diagonal step needs both squares beside it clear. Under
 * the alternating rule, which diagonal is the second counts, so each square is searched twice:
 * after an even and after an odd number of diagonals.
 */
export function walk(drawn: Drawn, moving: Moving, from: Square, to: Square, mover?: EntityId, target?: EntityId, also?: ReadonlySet<number>): Walk | null {
  const blocked = blockersOf(drawn, moving, [mover, target].filter((id): id is EntityId => id !== undefined)).way;
  const way = also === undefined || also.size === 0 ? blocked : new Set([...blocked, ...also]);
  const [w, h] = (mover !== undefined && hasOwn(moving.pieces, mover) ? moving.pieces[mover]?.size : undefined) ?? [1, 1];
  // Whether the footprint fits with its top left on a square, and what entering there costs, is
  // worked out once for each square, so a footprint's size adds no more to the search than the map holds.
  const known = new Uint8Array(drawn.width * drawn.height);
  const costs = new Float64Array(drawn.width * drawn.height);
  const fits = (c: number, r: number): boolean => {
    if (c < 1 || r < 1 || c + w - 1 > drawn.width || r + h - 1 > drawn.height) return false;
    const at = (r - 1) * drawn.width + (c - 1);
    if (known[at] === 0) {
      let most = 1;
      let clear = true;
      for (let dr = 0; dr < h && clear; dr++) {
        for (let dc = 0; dc < w; dc++) {
          const i = at + dr * drawn.width + dc;
          if (way.has(i)) {
            clear = false;
            break;
          }
          most = Math.max(most, cellCost(drawn, i));
        }
      }
      known[at] = clear ? 1 : 2;
      costs[at] = most;
    }
    return known[at] === 1;
  };
  const enters = (c: number, r: number): number => costs[(r - 1) * drawn.width + (c - 1)] ?? 1;
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
  // The lowest estimate first; among equals the square nearer the goal, then nearer in a straight
  // line (so a way reads straight), then the lower node, so the same grid always gives the same way.
  const open = new Open<{ node: number; g: number; f: number }>((a, b) => {
    if (a.f !== b.f) return a.f < b.f;
    const la = left(a.node >> 1);
    const lb = left(b.node >> 1);
    if (la !== lb) return la < lb;
    const sa = straight(a.node >> 1);
    const sb = straight(b.node >> 1);
    return sa !== sb ? sa < sb : a.node < b.node;
  });
  open.push({ node: start * 2, g: 0, f: left(start) });
  for (let item = open.pop(); item !== undefined; item = open.pop()) {
    const cur = item.node;
    // An entry a cheaper way to its square has left behind.
    if (item.g > (g.get(cur) ?? Infinity)) continue;
    const at = cur >> 1;
    if (at === goal) return wayTo(drawn, came, cur, item.g);
    const odd = cur & 1;
    const [c, r] = squareAt(drawn, at);
    for (const [dc, dr] of STEPS) {
      if (!fits(c + dc, r + dr)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (diagonal && (!fits(c + dc, r) || !fits(c, r + dr))) continue;
      const counts = diagonal && rule === "alternate" && odd === 1 ? 2 : 1;
      const next = (indexOf(drawn, [c + dc, r + dr]) ?? 0) * 2 + (diagonal && rule === "alternate" ? 1 - odd : odd);
      const ng = item.g + enters(c + dc, r + dr) * counts;
      if (ng < (g.get(next) ?? Infinity)) {
        g.set(next, ng);
        came.set(next, cur);
        open.push({ node: next, g: ng, f: ng + left(next >> 1) });
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
