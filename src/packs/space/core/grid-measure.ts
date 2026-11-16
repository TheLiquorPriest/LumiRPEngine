// Measuring on squares (plan §8.2, `map_measure`): distance by the grid's rule for diagonals, who
// is within a range, the squares an area covers (a radius, a cone, a line, a cube) and who stands in
// it, cover, and line of sight. What blocks is worked out as play stands (`blockersOf`): walls,
// every door that is not open, and the footprints that block. Something bigger than a square is
// measured from its nearest square, and sees and is seen from any square it covers (a line between
// the squares of one and the squares of the other that nothing blocking the view cuts). Sight is
// bounded by the world's sight radius, and says whether the target stands lit or dark, as facts: the
// one who rules decides what is seen. An area is a shape laid over the squares from a point of
// origin, and a square counts by the rule the world's ruleset (or the settings) gives
// (`Scale.areas`): where the area starts, and the share of the square it must cover. Cover is the
// least of the four corners of the attacker's square by how many of the four lines to the corners of
// the target's square something blocks (`Scale.cover`).

import type { EntityId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import { SIGHT_MAX } from "../../../shared/grid";
import { blockersOf, footprint, indexOf, standsAt, squareAt, type Diagonal, type Drawn, type Moving, type Square } from "./grid-model";
import { counts, coneShape, cubeShape, discShape, lineShape, type Point, type Shape } from "./grid-area";

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

/** The part of a rectangle that is on the grid; null where none is. */
function clipped(drawn: Drawn, r: Rect): Rect | null {
  const out = { c0: Math.max(1, r.c0), r0: Math.max(1, r.r0), c1: Math.min(drawn.width, r.c1), r1: Math.min(drawn.height, r.r1) };
  return out.c0 > out.c1 || out.r0 > out.r1 ? null : out;
}

/**
 * Whether a run of squares leads from the rectangle `a` to the rectangle `b` that a line of sight could follow: each square a view
 * does not block, a step across a corner only where the two squares beside it are not both blocked. A necessary condition of a
 * clear line, no more, but worked out over the grid once, so that two large footprints with a wall between them are told apart
 * without a line being followed from every square of one to every square of the other.
 */
function leads(drawn: Drawn, view: Uint8Array, a: Rect, b: Rect): boolean {
  const { width, height } = drawn;
  const reached = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let tail = 0;
  for (let r = a.r0; r <= a.r1; r++) {
    for (let c = a.c0; c <= a.c1; c++) {
      const i = (r - 1) * width + (c - 1);
      reached[i] = 1;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const at = queue[head] ?? 0;
    const [c, r] = [(at % width) + 1, Math.floor(at / width) + 1];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const [nc, nr] = [c + dc, r + dr];
        if ((dc === 0 && dr === 0) || nc < 1 || nr < 1 || nc > width || nr > height) continue;
        const next = (nr - 1) * width + (nc - 1);
        if (reached[next] === 1) continue;
        if (dc !== 0 && dr !== 0 && view[(r - 1) * width + (nc - 1)] === 1 && view[(nr - 1) * width + (c - 1)] === 1) continue;
        if (nc >= b.c0 && nc <= b.c1 && nr >= b.r0 && nr <= b.r1) return true;
        if (view[next] === 1) continue;
        reached[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return false;
}

/**
 * Whether some square of one rectangle and some square of the other have a clear line between them
 * (and, when `radius` is given, lie within it, as `sightFrom` counts: a round disc). Squares they
 * share see each other; the first pair that does decides.
 */
function lineBetween(drawn: Drawn, view: Uint8Array, a: Rect, b: Rect, radius: number | null): boolean {
  const ra = clipped(drawn, a);
  const rb = clipped(drawn, b);
  if (!ra || !rb) return false;
  if (ra.c0 <= rb.c1 && rb.c0 <= ra.c1 && ra.r0 <= rb.r1 && rb.r0 <= ra.r1) return true;
  if ((ra.c1 > ra.c0 || ra.r1 > ra.r0 || rb.c1 > rb.c0 || rb.r1 > rb.r0) && !leads(drawn, view, ra, rb)) return false;
  const reach = radius === null ? Infinity : radius * radius + radius;
  for (let r0 = ra.r0; r0 <= ra.r1; r0++) {
    for (let c0 = ra.c0; c0 <= ra.c1; c0++) {
      for (let r1 = rb.r0; r1 <= rb.r1; r1++) {
        const dy = r1 - r0;
        for (let c1 = rb.c0; c1 <= rb.c1; c1++) {
          const dx = c1 - c0;
          if (dx * dx + dy * dy <= reach && clear(drawn, view, [c0, r0], [c1, r1])) return true;
        }
      }
    }
  }
  return false;
}

/** Whether a clear line runs between two spots, from any square one covers to any the other covers (walls, doors not open and footprints that block the view leave it clear; the two spots' own footprints never block); the radius of sight is not asked. Null when one stands nowhere. */
export function sees(drawn: Drawn, moving: Moving, a: Spot, b: Spot): boolean | null {
  const ra = rectOf(moving, a);
  const rb = rectOf(moving, b);
  if (!ra || !rb) return null;
  return lineBetween(drawn, maskOf(drawn, blockersOf(drawn, moving, [a, b].filter((s): s is EntityId => typeof s === "string")).view), ra, rb, null);
}

/** What there is to say of one spot looking at another. */
export interface Sight {
  /** A clear line runs between them (`sees`), whatever the distance. */
  clear: boolean;
  /** One of them is within the world's sight radius of the other, by a clear line: as far as the grid goes, the one sees the other. */
  seen: boolean;
  /** How many squares apart they are, from the nearest square of one to the nearest of the other. */
  apart: number;
  /** The radius of sight, in squares. */
  radius: number;
  /** That the target stands lit: some square it covers does not read dark. */
  lit: boolean;
}

/**
 * Sight from `a` to `b` as facts: whether a clear line runs between them, whether one runs within the
 * world's sight radius (`Drawn.radius`, today's), how far apart they are and whether the target
 * stands lit. Whether it is seen is the ruling of whoever rules; none is made here. Null when one
 * stands nowhere.
 */
export function sightOf(drawn: Drawn, moving: Moving, a: Spot, b: Spot): Sight | null {
  const ra = rectOf(moving, a);
  const rb = rectOf(moving, b);
  const apart = between(drawn, moving, a, b);
  if (!ra || !rb || apart === null) return null;
  const view = maskOf(drawn, blockersOf(drawn, moving, [a, b].filter((s): s is EntityId => typeof s === "string")).view);
  const seen = lineBetween(drawn, view, ra, rb, drawn.radius);
  const target = clipped(drawn, rb);
  let lit = false;
  if (target) for (let row = target.r0; row <= target.r1 && !lit; row++) for (let column = target.c0; column <= target.c1 && !lit; column++) lit = !drawn.dark.has((row - 1) * drawn.width + (column - 1));
  return { clear: seen || lineBetween(drawn, view, ra, rb, null), seen, apart, radius: drawn.radius, lit };
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
 * An area from a shape laid over the grid: each square on it that the shape covers by the rule in
 * force, that is not a wall or a shut door, and is reached by a line from the origin that nothing
 * blocking the view cuts (what walls stop, an area does not pass).
 */
function areaFrom(drawn: Drawn, moving: Moving, origin: Square, shape: Shape | null): Area {
  if (shape === null) return { squares: [], who: [] };
  const view = maskOf(drawn, blockersOf(drawn, moving).view);
  const shut = blockersOf(drawn, { ...moving, pieces: {} }).view;
  const [x0, y0, x1, y1] = shape.box;
  const picked = new Set<number>();
  for (let r = Math.max(1, Math.floor(y0) + 1); r <= Math.min(drawn.height, Math.ceil(y1)); r++) {
    for (let c = Math.max(1, Math.floor(x0) + 1); c <= Math.min(drawn.width, Math.ceil(x1)); c++) {
      const i = (r - 1) * drawn.width + (c - 1);
      if (!shut.has(i) && counts(shape.covered(c, r), drawn.scale.areas.share) && clear(drawn, view, origin, [c, r])) picked.add(i);
    }
  }
  return covering(drawn, moving, picked);
}

/** The middle of a square. */
const middleOf = (s: Square): Point => [s[0] - 0.5, s[1] - 0.5];

/** Where an area starts at `origin`: the middle of its square, or, at a point where squares meet, the corner of it nearest `aim` (the first of the top left, top right, bottom left and bottom right where two are as near); with none to aim at, each corner. */
function startsOf(drawn: Drawn, origin: Square, aim: Square | null): Point[] {
  if (drawn.scale.areas.start === "middle") return [middleOf(origin)];
  const [c, r] = origin;
  const corners: Point[] = [
    [c - 1, r - 1],
    [c, r - 1],
    [c - 1, r],
    [c, r],
  ];
  if (aim === null) return corners;
  const q = middleOf(aim);
  const far = (p: Point): number => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  return [corners.reduce((best, p) => (far(p) < far(best) - 1e-9 ? p : best))];
}

/** A burst, a radius of `radius` squares about where the area starts: the squares it covers; started at a point where squares meet, from the corner of `centre`'s square that covers the most. */
export function burst(drawn: Drawn, moving: Moving, centre: Square, radius: number): Area {
  return startsOf(drawn, centre, null)
    .map((p) => areaFrom(drawn, moving, centre, discShape(p, radius)))
    .reduce((best, a) => (a.squares.length > best.squares.length ? a : best));
}

/**
 * A cone from `origin` toward `toward`, `length` squares long, as wide at each point as that point
 * is far from its apex, which is where the area starts. The squares it covers.
 */
export function cone(drawn: Drawn, moving: Moving, origin: Square, toward: Square, length: number): Area {
  const [apex] = startsOf(drawn, origin, toward);
  return apex ? areaFrom(drawn, moving, origin, coneShape(apex, middleOf(origin), middleOf(toward), length)) : { squares: [], who: [] };
}

/**
 * A line from `origin` toward `toward`, `length` squares long and one square wide, starting where the
 * area starts: the squares it covers, stopping at the grid's edge, at a wall or a shut door, and
 * after a footprint that blocks the view.
 */
export function line(drawn: Drawn, moving: Moving, origin: Square, toward: Square, length: number): Area {
  const [start] = startsOf(drawn, origin, toward);
  return start ? areaFrom(drawn, moving, origin, lineShape(start, middleOf(origin), middleOf(toward), length)) : { squares: [], who: [] };
}

/**
 * A cube of `side` squares from `origin` toward `toward`, its face against the origin: reaching the
 * way `toward` lies most (east or west where it lies as far across as down), centred on the middle
 * of the edge of `origin`'s square that faces that way, or, where an area starts at a square's
 * middle, on the middle of the square. The squares it covers.
 */
export function cube(drawn: Drawn, moving: Moving, origin: Square, toward: Square, side: number): Area {
  const dx = toward[0] - origin[0];
  const dy = toward[1] - origin[1];
  if (dx === 0 && dy === 0) return { squares: [], who: [] };
  const across = Math.abs(dx) >= Math.abs(dy);
  const [mx, my] = middleOf(origin);
  const face: Point = drawn.scale.areas.start === "middle" ? [mx, my] : across ? [mx + Math.sign(dx) * 0.5, my] : [mx, my + Math.sign(dy) * 0.5];
  return areaFrom(drawn, moving, origin, cubeShape(face, across ? Math.sign(dx) : 0, across ? 0 : Math.sign(dy), side));
}

/** How much cover stands between an attacker and a target: its degree, how many of the four lines something blocked, and what blocked them. */
export interface Cover {
  degree: "none" | "half" | "three-quarters" | "total";
  blocked: number;
  by: string[];
}

/** Whether the segment from `a` to `b` passes through the inside of the box (touching its edge or corner is not through it). */
function through(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  let lo = 0;
  let hi = 1;
  for (const [start, step, from, to] of [
    [a[0], b[0] - a[0], x0, x1],
    [a[1], b[1] - a[1], y0, y1],
  ] as const) {
    if (step === 0) {
      if (!(start > from && start < to)) return false;
      continue;
    }
    const [t0, t1] = [(from - start) / step, (to - start) / step].sort((p, q) => p - q);
    lo = Math.max(lo, t0 ?? 0);
    hi = Math.min(hi, t1 ?? 1);
  }
  return lo < hi - 1e-12;
}

/**
 * The cover `b` has from `a`: from each corner of `a`'s square (or the box of its footprint), the
 * lines to the four corners of `b`'s are tried, and each that something stands across is blocked; the
 * corner that gives the least cover is the one taken. What stands across: walls, shut doors, and
 * footprints that block the way or the view, and (where the rule says creatures obstruct) everyone
 * and everything else on the grid. The degree is by how many of the four are blocked (`Scale.cover`).
 * Null when one stands nowhere on the grid.
 */
export function coverOf(drawn: Drawn, moving: Moving, a: Spot, b: Spot): Cover | null {
  const ra = rectOf(moving, a);
  const rb = rectOf(moving, b);
  if (!ra || !rb) return null;
  const here = [a, b].filter((s): s is EntityId => typeof s === "string");
  const blocking = blockersOf(drawn, moving, here);
  const rule = drawn.scale.cover;
  // What each obstructing square is: the one standing on it, else its terrain.
  const across = new Map<number, string>();
  for (const i of new Set([...blocking.way, ...blocking.view])) across.set(i, drawn.terrain[i] ?? "wall");
  for (const [id, p] of Object.entries(moving.pieces)) {
    if (here.includes(id) || p.on !== undefined) continue;
    if (rule.creatures || p.blocks?.way || p.blocks?.view) for (const i of footprint(drawn, moving, id)) across.set(i, id);
  }
  const own = (r: Rect, i: number): boolean => {
    const s = squareAt(drawn, i);
    return s[0] >= r.c0 && s[0] <= r.c1 && s[1] >= r.r0 && s[1] <= r.r1;
  };
  const boxes = [...across].filter(([i]) => !own(ra, i) && !own(rb, i)).map(([i, what]) => ({ what, at: squareAt(drawn, i) }));
  const corners = (r: Rect): Point[] => [
    [r.c0 - 1, r.r0 - 1],
    [r.c1, r.r0 - 1],
    [r.c0 - 1, r.r1],
    [r.c1, r.r1],
  ];
  let best: { blocked: number; by: string[] } | null = null;
  for (const from of corners(ra)) {
    const by: string[] = [];
    let blocked = 0;
    for (const to of corners(rb)) {
      const stopped = boxes.filter((o) => through(from, to, o.at[0] - 1, o.at[1] - 1, o.at[0], o.at[1])).map((o) => o.what);
      if (stopped.length > 0) blocked++;
      for (const what of stopped) if (!by.includes(what)) by.push(what);
    }
    if (best === null || blocked < best.blocked) best = { blocked, by };
  }
  const { blocked, by } = best ?? { blocked: 0, by: [] };
  const degree = blocked >= rule.total ? "total" : blocked >= rule.threeQuarters ? "three-quarters" : blocked >= rule.half ? "half" : "none";
  return { degree, blocked, by: degree === "none" ? [] : by };
}

/**
 * The squares seen from one square (the grid system's sight, DESIGN §7): within `radius` squares
 * of it (a round disc, up to `SIGHT_MAX`), each reached by a line that walls, doors not open and
 * footprints that block the view leave clear (`except`, whoever looks, never blocks), by index.
 */
export function sightFrom(drawn: Drawn, moving: Moving, from: Square, radius: number, except: readonly EntityId[] = []): number[] {
  const view = maskOf(drawn, blockersOf(drawn, moving, except).view);
  const r = Math.min(SIGHT_MAX, Math.max(0, Math.floor(radius)));
  const out: number[] = [];
  for (let row = Math.max(1, from[1] - r); row <= Math.min(drawn.height, from[1] + r); row++) {
    for (let column = Math.max(1, from[0] - r); column <= Math.min(drawn.width, from[0] + r); column++) {
      const dx = column - from[0];
      const dy = row - from[1];
      // r² + r rounds the disc's edge (no lone squares sticking out of it at the axes).
      if (dx * dx + dy * dy <= r * r + r && clear(drawn, view, from, [column, row])) out.push((row - 1) * drawn.width + (column - 1));
    }
  }
  return out;
}
