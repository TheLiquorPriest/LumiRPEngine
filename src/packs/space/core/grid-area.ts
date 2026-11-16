// Areas as shapes laid over squares (plan §8.2, R-160): a radius is a disc, a cone a triangle, a line
// a strip, a cube a square, each placed from a point of origin; how much of a square a shape covers
// is worked out exactly (a polygon clipped against the square, a disc by the integral of its chord),
// so that "at least half" and "any of it" are the rule's to say. Squares are counted as the map
// prints them, [column, row] from 1: the square (c, r) is the box from (c - 1, r - 1) to (c, r).

/** A point on the grid in squares: x grows to the east and y to the south, a square's corner at whole numbers. */
export type Point = readonly [number, number];

/** How much of a square a shape covers, from 0 to 1. */
export interface Shape {
  /** The box around it: left, top, right, bottom. */
  box: readonly [number, number, number, number];
  covered(column: number, row: number): number;
}

const EPSILON = 1e-9;

/** Whether a square covered by `fraction` counts by `share`: some of it, and at least the share. */
export function counts(fraction: number, share: number): boolean {
  return fraction > EPSILON && fraction >= share - EPSILON;
}

function areaOf(poly: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] ?? [0, 0];
    const b = poly[(i + 1) % poly.length] ?? [0, 0];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** `subject` cut to the inside of the convex polygon `clip` (Sutherland–Hodgman). */
function clipped(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const edges = areaOf(clip) < 0 ? [...clip].reverse() : clip;
  let out: Point[] = [...subject];
  for (let i = 0; i < edges.length && out.length > 0; i++) {
    const a = edges[i] ?? [0, 0];
    const b = edges[(i + 1) % edges.length] ?? [0, 0];
    const side = (p: Point): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j] ?? [0, 0];
      const q = input[(j + 1) % input.length] ?? [0, 0];
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

/** A convex polygon as a shape. */
export function polygonShape(poly: readonly Point[]): Shape {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    covered(column, row) {
      const square: Point[] = [
        [column - 1, row - 1],
        [column, row - 1],
        [column, row],
        [column - 1, row],
      ];
      return Math.abs(areaOf(clipped(square, poly)));
    },
  };
}

/** How much of the box from (x0, y0) to (x1, y1) a disc of radius `r` about the origin covers: the integral, piece by piece, of the chord the box leaves of it. */
function discOver(r: number, x0: number, y0: number, x1: number, y1: number): number {
  const lo = Math.max(x0, -r);
  const hi = Math.min(x1, r);
  if (lo >= hi) return 0;
  // The area under the half chord, from -r to x.
  const under = (x: number): number => {
    const t = Math.max(-r, Math.min(r, x));
    return (t * Math.sqrt(Math.max(0, r * r - t * t)) + r * r * Math.asin(t / r)) / 2;
  };
  const cuts = [lo, hi];
  // Where the chord's end meets the box's top or bottom, the piece changes.
  for (const y of [y0, y1]) {
    if (Math.abs(y) >= r) continue;
    const x = Math.sqrt(r * r - y * y);
    for (const cut of [-x, x]) if (cut > lo && cut < hi) cuts.push(cut);
  }
  cuts.sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const p = cuts[i] ?? 0;
    const q = cuts[i + 1] ?? 0;
    if (q <= p) continue;
    const h = Math.sqrt(Math.max(0, r * r - ((p + q) / 2) ** 2));
    const upper = h < y1;
    const lower = -h > y0;
    if ((upper ? h : y1) - (lower ? -h : y0) <= 0) continue;
    total += ((upper ? 1 : 0) + (lower ? 1 : 0)) * (under(q) - under(p)) + ((upper ? 0 : y1) + (lower ? 0 : -y0)) * (q - p);
  }
  return total;
}

/** A disc of `radius` squares about `centre`. */
export function discShape(centre: Point, radius: number): Shape {
  return {
    box: [centre[0] - radius, centre[1] - radius, centre[0] + radius, centre[1] + radius],
    covered: (column, row) => (radius > 0 ? discOver(radius, column - 1 - centre[0], row - 1 - centre[1], column - centre[0], row - centre[1]) : 0),
  };
}

/** A unit vector from `from` toward `toward`, perpendicular to it (turned a quarter), or null where they are the one point. */
function axisOf(from: Point, toward: Point): { u: Point; p: Point } | null {
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  const n = Math.hypot(dx, dy);
  return n === 0 ? null : { u: [dx / n, dy / n], p: [-dy / n, dx / n] };
}

/** A cone from `apex` along the way from `from` to `toward`, `length` squares long and as wide at its end as it is long. */
export function coneShape(apex: Point, from: Point, toward: Point, length: number): Shape | null {
  const axis = axisOf(from, toward);
  if (!axis || length <= 0) return null;
  const end: Point = [apex[0] + axis.u[0] * length, apex[1] + axis.u[1] * length];
  const half = length / 2;
  return polygonShape([apex, [end[0] + axis.p[0] * half, end[1] + axis.p[1] * half], [end[0] - axis.p[0] * half, end[1] - axis.p[1] * half]]);
}

/** A line from `start` along the way from `from` to `toward`, `length` squares long and `width` squares wide. */
export function lineShape(start: Point, from: Point, toward: Point, length: number, width = 1): Shape | null {
  const axis = axisOf(from, toward);
  if (!axis || length <= 0) return null;
  const end: Point = [start[0] + axis.u[0] * length, start[1] + axis.u[1] * length];
  const half = width / 2;
  return polygonShape([
    [start[0] + axis.p[0] * half, start[1] + axis.p[1] * half],
    [end[0] + axis.p[0] * half, end[1] + axis.p[1] * half],
    [end[0] - axis.p[0] * half, end[1] - axis.p[1] * half],
    [start[0] - axis.p[0] * half, start[1] - axis.p[1] * half],
  ]);
}

/** A cube of `side` squares whose face lies against `face`, its middle there, reaching the way `dx`, `dy` points (one of them 0). */
export function cubeShape(face: Point, dx: number, dy: number, side: number): Shape | null {
  if (side <= 0 || (dx === 0) === (dy === 0)) return null;
  const half = side / 2;
  const [x0, x1] = dx === 0 ? [face[0] - half, face[0] + half] : dx > 0 ? [face[0], face[0] + side] : [face[0] - side, face[0]];
  const [y0, y1] = dy === 0 ? [face[1] - half, face[1] + half] : dy > 0 ? [face[1], face[1] + side] : [face[1] - side, face[1]];
  return polygonShape([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
}
