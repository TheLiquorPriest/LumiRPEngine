// Measuring on squares (plan §8.2, `map_measure`): distance by the grid's rule for diagonals, who
// is within a range, the squares an area covers (a burst, a cone, a line) and who stands in it,
// and line of sight. What blocks is worked out as play stands (`blockersOf`): walls, every door
// that is not open, and the footprints that block. Something bigger than a square is measured
// from its nearest square, and is seen when a square along its edge is (a line out of it crosses
// its edge), so sight between two footprints follows no more lines than the map's sides allow.

import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { blockersOf, footprint, indexOf, standsAt, squareAt, type Diagonal, type Drawn, type Moving, type Square } from "./grid";

/** A square, or someone or something on the grid by id. */
export type Spot = Square | EntityId;

/** How many squares apart two squares are: a diagonal counted as the grid counts it. */
export function distance(diagonal: Diagonal, a: Square, b: Square): number {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  // The alternating rule counts every second diagonal as two: one and a half a diagonal, rounded down.
  return Math.max(dx, dy) + (diagonal === "alternate" ? Math.floor(Math.min(dx, dy) / 2) : 0);
}

interface Rect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** The squares a spot covers, as a rectangle; null for someone or something standing nowhere on the grid. */
function rectOf(moving: Moving, spot: Spot): Rect | null {
  if (typeof spot !== "string") return { c0: spot[0], r0: spot[1], c1: spot[0], r1: spot[1] };
  const at = standsAt(moving, spot);
  if (!at) return null;
  const [w, h] = (hasOwn(moving.pieces, spot) ? moving.pieces[spot]?.size : undefined) ?? [1, 1];
  return { c0: at[0], r0: at[1], c1: at[0] + w - 1, r1: at[1] + h - 1 };
}

/** How many squares lie between two spots, from the nearest square of one to the nearest of the other (0 where they share one); null when one stands nowhere. */
export function between(drawn: Drawn, moving: Moving, a: Spot, b: Spot): number | null {
  const ra = rectOf(moving, a);
  const rb = rectOf(moving, b);
  if (!ra || !rb) return null;
  const dc = Math.max(0, rb.c0 - ra.c1, ra.c0 - rb.c1);
  const dr = Math.max(0, rb.r0 - ra.r1, ra.r0 - rb.r1);
  return distance(drawn.scale.diagonal, [0, 0], [dc, dr]);
}

/** Who and what on the grid is within `range` squares of a spot, by id; the spot itself left out. */
export function within(drawn: Drawn, moving: Moving, from: Spot, range: number): EntityId[] {
  return Object.keys(moving.pieces)
    .filter((id) => id !== from)
    .filter((id) => {
      const d = between(drawn, moving, from, id);
      return d !== null && d <= range;
    })
    .sort();
}

/**
 * Follows a straight line from the middle of `from` toward the middle of `toward`, square by
 * square, on past `toward` for as long as `step` returns true. Where it passes exactly through a
 * corner it goes on diagonally, and `step` is told so: the two squares that meet there are the
 * ones beside it back along each way it went. No square is made as it goes, since sight between
 * two footprints follows many lines.
 */
function follow(from: Square, toward: Square, step: (c: number, r: number, corner: boolean) => boolean): void {
  const nx = Math.abs(toward[0] - from[0]);
  const ny = Math.abs(toward[1] - from[1]);
  const sx = Math.sign(toward[0] - from[0]);
  const sy = Math.sign(toward[1] - from[1]);
  if (nx === 0 && ny === 0) return;
  let [c, r] = from;
  for (let ix = 0, iy = 0, on = true; on; ) {
    // Which grid line the line crosses next, compared without division: (½ + ix) / nx against (½ + iy) / ny.
    const next = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (next === 0) {
      c += sx;
      r += sy;
      ix++;
      iy++;
    } else if (next < 0) {
      c += sx;
      ix++;
    } else {
      r += sy;
      iy++;
    }
    on = step(c, r, next === 0);
  }
}

/** The squares of a set, by index, as one byte each: sight between footprints asks of them on every step of many lines. */
function maskOf(drawn: Drawn, set: ReadonlySet<number>): Uint8Array {
  const mask = new Uint8Array(drawn.width * drawn.height);
  for (const i of set) mask[i] = 1;
  return mask;
}

function blocks(drawn: Drawn, mask: Uint8Array, c: number, r: number): boolean {
  return c >= 1 && r >= 1 && c <= drawn.width && r <= drawn.height && mask[(r - 1) * drawn.width + (c - 1)] === 1;
}

/** Whether nothing in `blocked` stands between two squares. The ends don't count; a corner shuts the view only where both squares at it block. */
function clear(drawn: Drawn, blocked: Uint8Array, a: Square, b: Square): boolean {
  const sx = Math.sign(b[0] - a[0]);
  const sy = Math.sign(b[1] - a[1]);
  let seen = true;
  follow(a, b, (c, r, corner) => {
    if (corner && blocks(drawn, blocked, c, r - sy) && blocks(drawn, blocked, c - sx, r)) seen = false;
    else if (c === b[0] && r === b[1]) return false;
    else if (blocks(drawn, blocked, c, r)) seen = false;
    return seen;
  });
  return seen;
}

/**
 * The squares along the edge of a rectangle, the part of it on the grid: every line out of it
 * leaves through one of them, and however large it is they are no more than the map's own edge.
 */
function edgeOf(drawn: Drawn, r: Rect): Square[] {
  const c0 = Math.max(1, r.c0);
  const r0 = Math.max(1, r.r0);
  const c1 = Math.min(drawn.width, r.c1);
  const r1 = Math.min(drawn.height, r.r1);
  const out: Square[] = [];
  for (let row = r0; row <= r1; row++) {
    if (row === r0 || row === r1) for (let col = c0; col <= c1; col++) out.push([col, row]);
    else {
      out.push([c0, row]);
      if (c1 > c0) out.push([c1, row]);
    }
  }
  return out;
}

/**
 * Whether one spot can see the other: a straight line from some square along the edge of one to
 * some square along the edge of the other that walls, doors not open and footprints that block the
 * view leave clear. The two spots' own footprints never block, and a line out of a footprint
 * crosses its edge, so its edge is where it is seen from; only what lies on the grid sees. Null when
 * one stands nowhere.
 */
export function sees(drawn: Drawn, moving: Moving, a: Spot, b: Spot): boolean | null {
  const ra = rectOf(moving, a);
  const rb = rectOf(moving, b);
  if (!ra || !rb) return null;
  const view = maskOf(drawn, blockersOf(drawn, moving, [a, b].filter((s): s is EntityId => typeof s === "string")).view);
  const to = edgeOf(drawn, rb);
  return edgeOf(drawn, ra).some((sa) => to.some((sb) => clear(drawn, view, sa, sb)));
}

/** The squares an area covers, and who and what stands in it. */
export interface Area {
  squares: Square[];
  /** By id: everyone and everything whose footprint is in it. */
  who: EntityId[];
}

/** The area of the squares picked, in the order picked, and whoever's footprint is in one. */
function covering(drawn: Drawn, moving: Moving, picked: ReadonlySet<number>): Area {
  const who = Object.keys(moving.pieces)
    .filter((id) => footprint(drawn, moving, id).some((i) => picked.has(i)))
    .sort();
  return { squares: [...picked].map((i) => squareAt(drawn, i)), who };
}

/**
 * An area from the squares chosen around `origin`: each on the grid, not a wall or a shut door,
 * and reached by a line from the origin that nothing blocking the view cuts (what walls stop,
 * an area does not pass).
 */
function areaFrom(drawn: Drawn, moving: Moving, origin: Square, chosen: (s: Square) => boolean): Area {
  const view = maskOf(drawn, blockersOf(drawn, moving).view);
  const shut = blockersOf(drawn, { ...moving, pieces: {} }).view;
  const picked = new Set<number>();
  for (let i = 0; i < drawn.width * drawn.height; i++) {
    const s = squareAt(drawn, i);
    if (!shut.has(i) && chosen(s) && clear(drawn, view, origin, s)) picked.add(i);
  }
  return covering(drawn, moving, picked);
}

/** A burst: every square within `radius` squares of `centre`, the centre too. */
export function burst(drawn: Drawn, moving: Moving, centre: Square, radius: number): Area {
  return areaFrom(drawn, moving, centre, (s) => distance(drawn.scale.diagonal, centre, s) <= radius);
}

/**
 * A cone from `origin` toward `toward`, `length` squares long: the squares whose middles lie
 * within it, as wide at each point as that point is far from the origin (half a square of width
 * either side for each square of length), the origin left out.
 */
export function cone(drawn: Drawn, moving: Moving, origin: Square, toward: Square, length: number): Area {
  const vx = toward[0] - origin[0];
  const vy = toward[1] - origin[1];
  if (vx === 0 && vy === 0) return { squares: [], who: [] };
  return areaFrom(drawn, moving, origin, (s) => {
    const wx = s[0] - origin[0];
    const wy = s[1] - origin[1];
    const along = vx * wx + vy * wy;
    const across = Math.abs(vx * wy - vy * wx);
    return along > 0 && 2 * across <= along && distance(drawn.scale.diagonal, origin, s) <= length;
  });
}

/**
 * A line from `origin` toward `toward`, `length` squares long by the grid's count, one square
 * wide: the squares a straight line passes through, the origin left out. It stops at the grid's
 * edge and before a wall or a shut door; a footprint that blocks the view is in it and stops it.
 */
export function line(drawn: Drawn, moving: Moving, origin: Square, toward: Square, length: number): Area {
  const view = blockersOf(drawn, moving).view;
  const shut = maskOf(drawn, blockersOf(drawn, { ...moving, pieces: {} }).view);
  const picked = new Set<number>();
  const sx = Math.sign(toward[0] - origin[0]);
  const sy = Math.sign(toward[1] - origin[1]);
  follow(origin, toward, (c, r, corner) => {
    const i = indexOf(drawn, [c, r]);
    if (i === null || shut[i] === 1 || distance(drawn.scale.diagonal, origin, [c, r]) > length) return false;
    if (corner && blocks(drawn, shut, c, r - sy) && blocks(drawn, shut, c - sx, r)) return false;
    picked.add(i);
    return !view.has(i);
  });
  return covering(drawn, moving, picked);
}
