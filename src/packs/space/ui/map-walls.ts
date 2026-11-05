// Walls and doors drawn thin (DESIGN §12): a grid's wall cells are joined into strokes 2–4 px wide
// along their centres, with square ends where a wall stops, so a wall reads as a wall and not as a
// band a cell wide; a door in a wall line leaves a gap in it, marked by its jambs and a thin leaf,
// which swings open on a quarter arc once cells are large enough to show one. The map keeps its
// cells: what can be walked, seen and tapped is unchanged, and only the drawing is thinner. A lone
// wall cell is a pillar; four wall cells in a square are a solid mass (a wall two cells thick reads as
// one wall, not a ladder); a door that sits in no wall line, and any cell too small to draw a line
// in, keep their fill. Under fog, a cell the viewer isn't shown never joins anything. Play's map,
// Build's preview and the map editor all draw through here.

import type { Point } from "../../../frontend/map-math";
import type { CanvasPalette } from "./canvas-theme";

/** What a cell is to the wall lines: a wall, a door, open ground, solid ground (blocked, or nothing), or hidden under fog (it never joins). */
export type WallCell = "wall" | "door" | "open" | "solid" | "hidden";

/** A grid as the wall lines read it. */
export interface WallGrid {
  width: number;
  height: number;
  /** Each cell's kind, row-major. */
  cells: readonly WallCell[];
  /** Cells in a room (a place's area): a door swings into one. */
  room?: ReadonlySet<number>;
}

/** One straight stroke, in cell units (cell x spans x to x + 1): from a wall's centre, or from a door's jamb, which `jamb` marks. */
export interface WallSegment {
  from: Point;
  to: Point;
  /** Whether each end is a door's jamb (drawn flat there), else a wall's centre (drawn square, half the stroke past it). */
  jamb: [boolean, boolean];
}

/** A door in a wall line: its cell, the line's direction through it, its jambs (in cell units, on the line) and the side its leaf swings to. */
export interface DoorGap {
  cell: number;
  axis: "h" | "v";
  /** The jamb the leaf turns on, and the one it closes against. */
  hinge: Point;
  latch: Point;
  /** Down or right (1), up or left (-1). */
  side: 1 | -1;
}

/** What a grid's walls are drawn as. */
export interface WallPlan {
  /** The grid's width, which the cells below are numbered across. */
  width: number;
  segments: WallSegment[];
  /** Wall cells joined to nothing: drawn as a pillar. */
  pillars: number[];
  /** The squares between the centres of four wall cells (by the top-left cell): filled, so a thick wall is one mass. */
  masses: number[];
  doors: DoorGap[];
  /** Door cells in no wall line: they keep their fill. */
  loose: number[];
}

/** Cells smaller than this (screen px) draw their walls and doors as fills, as before: there's no room for a line and a gap. */
export const WALL_MIN_CELL = 6;

/** Cells at least this large (screen px) show a door's swing. */
export const DOOR_SWING_CELL = 16;

/** Whether cells of `size` screen px draw thin walls. */
export function thinWalls(size: number): boolean {
  return size >= WALL_MIN_CELL;
}

/** A wall's stroke in CSS px for cells of `size` screen px: a fifth of a cell, at least 2 and at most 4, snapped to whole device pixels. */
export function wallWidth(size: number, dpr: number): number {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const css = Math.min(4, Math.max(2, size * 0.2));
  return Math.max(1, Math.round(css * ratio)) / ratio;
}

/**
 * What a terrain is to the wall lines, by its name as the fills read it (a door's words first, as
 * `terrainFill` reads them): a door, gate or arch; a wall; else neither. A cliff keeps its fill.
 */
export function wallKindOf(terrain: string): "wall" | "door" | null {
  const name = terrain.toLowerCase();
  if (/door|gate|arch/.test(name)) return "door";
  return /wall/.test(name) ? "wall" : null;
}

function kindAt(grid: WallGrid, x: number, y: number): WallCell | null {
  return x < 0 || y < 0 || x >= grid.width || y >= grid.height ? null : (grid.cells[y * grid.width + x] ?? null);
}

/**
 * The doors in wall lines (`doors`) and those in none (`loose`). A run of door cells side by side is
 * in a wall line when a wall closes it at both ends; a run across a row is taken before one down a
 * column. In a run of several, the first half hinge at its start and the rest at its end (a pair of
 * doors opens from the middle). A door swings into a room rather than out of one, else into open
 * ground, else down or right.
 */
export function doorGaps(grid: WallGrid): { doors: DoorGap[]; loose: number[] } {
  const { width, height } = grid;
  const axis = new Map<number, { axis: "h" | "v"; index: number; length: number }>();
  const runs = (h: boolean): void => {
    const lines = h ? height : width;
    const along = h ? width : height;
    for (let line = 0; line < lines; line++) {
      let start = -1;
      for (let i = 0; i <= along; i++) {
        const x = h ? i : line;
        const y = h ? line : i;
        const door = i < along && kindAt(grid, x, y) === "door";
        if (door && start < 0) start = i;
        if (door || start < 0) continue;
        // A run [start, i) closed by walls at both ends.
        const before = h ? kindAt(grid, start - 1, line) : kindAt(grid, line, start - 1);
        const after = h ? kindAt(grid, i, line) : kindAt(grid, line, i);
        if (before === "wall" && after === "wall") {
          for (let j = start; j < i; j++) {
            const cell = h ? line * width + j : j * width + line;
            if (!axis.has(cell)) axis.set(cell, { axis: h ? "h" : "v", index: j - start, length: i - start });
          }
        }
        start = -1;
      }
    }
  };
  runs(true);
  runs(false);
  const doors: DoorGap[] = [];
  const loose: number[] = [];
  grid.cells.forEach((kind, cell) => {
    if (kind !== "door") return;
    const run = axis.get(cell);
    if (!run) {
      loose.push(cell);
      return;
    }
    const x = cell % width;
    const y = Math.floor(cell / width);
    const h = run.axis === "h";
    const start = h ? { x, y: y + 0.5 } : { x: x + 0.5, y };
    const end = h ? { x: x + 1, y: y + 0.5 } : { x: x + 0.5, y: y + 1 };
    const atStart = run.index < run.length / 2;
    const score = (dx: number, dy: number): number => {
      const k = kindAt(grid, x + dx, y + dy);
      if (k !== "open") return 0;
      return grid.room?.has((y + dy) * width + x + dx) ? 2 : 1;
    };
    const before = h ? score(0, -1) : score(-1, 0);
    const after = h ? score(0, 1) : score(1, 0);
    doors.push({ cell, axis: run.axis, hinge: atStart ? start : end, latch: atStart ? end : start, side: before > after ? -1 : 1 });
  });
  return { doors, loose };
}

/**
 * The strokes a grid's walls are drawn with: each run of wall cells across a row or down a column is
 * one segment through their centres, reaching to the jamb of a door in its line; two walls that touch
 * only at a corner are joined straight across it; four walls in a square are filled as one mass, the
 * lines inside it left out; and a wall joined to nothing is a pillar. `doors` are the grid's
 * (`doorGaps`), which say where a line stops at a jamb.
 */
export function wallStrokes(grid: WallGrid, doors: readonly DoorGap[] = doorGaps(grid).doors): Pick<WallPlan, "segments" | "pillars" | "masses"> {
  const { width, height } = grid;
  const wall = (x: number, y: number): boolean => kindAt(grid, x, y) === "wall";
  const doorAxis = new Map(doors.map((d) => [d.cell, d.axis]));
  const inLine = (x: number, y: number, a: "h" | "v"): boolean => kindAt(grid, x, y) === "door" && doorAxis.get(y * width + x) === a;
  const mass = (x: number, y: number): boolean => wall(x, y) && wall(x + 1, y) && wall(x, y + 1) && wall(x + 1, y + 1);
  const masses: number[] = [];
  for (let y = 0; y + 1 < height; y++) for (let x = 0; x + 1 < width; x++) if (mass(x, y)) masses.push(y * width + x);
  const joined = new Set<number>();
  const segments: WallSegment[] = [];
  // Across each row, then down each column: an edge between two cells is drawn when both are walls
  // (centre to centre) or one is a wall and the other a door in this line (centre to jamb), unless
  // a mass lies on both sides of it.
  for (const h of [true, false]) {
    const lines = h ? height : width;
    const along = h ? width : height;
    for (let line = 0; line < lines; line++) {
      let open: WallSegment | null = null;
      for (let i = 0; i + 1 < along; i++) {
        const [ax, ay, bx, by] = h ? [i, line, i + 1, line] : [line, i, line, i + 1];
        const a = wall(ax, ay);
        const b = wall(bx, by);
        const axisOf = h ? "h" : "v";
        const inside = a && b && (h ? mass(ax, ay - 1) && mass(ax, ay) : mass(ax - 1, ay) && mass(ax, ay));
        const drawn = !inside && ((a && b) || (a && inLine(bx, by, axisOf)) || (b && inLine(ax, ay, axisOf)));
        if (!drawn) {
          open = null;
          continue;
        }
        if (a) joined.add(ay * width + ax);
        if (b) joined.add(by * width + bx);
        const from = a ? { x: ax + 0.5, y: ay + 0.5 } : h ? { x: bx, y: by + 0.5 } : { x: bx + 0.5, y: by };
        const to = b ? { x: bx + 0.5, y: by + 0.5 } : h ? { x: bx, y: by + 0.5 } : { x: bx + 0.5, y: by };
        if (open && a && open.to.x === from.x && open.to.y === from.y && !open.jamb[1]) {
          open.to = to;
          open.jamb[1] = !b;
          continue;
        }
        open = { from, to, jamb: [!a, !b] };
        segments.push(open);
      }
    }
  }
  // Two walls touching only at a corner, with neither cell between them a wall: one stroke across.
  for (let y = 0; y + 1 < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!wall(x, y)) continue;
      for (const dx of [-1, 1]) {
        if (!wall(x + dx, y + 1) || wall(x + dx, y) || wall(x, y + 1)) continue;
        joined.add(y * width + x);
        joined.add((y + 1) * width + x + dx);
        segments.push({ from: { x: x + 0.5, y: y + 0.5 }, to: { x: x + dx + 0.5, y: y + 1.5 }, jamb: [false, false] });
      }
    }
  }
  for (const m of masses) for (const c of [m, m + 1, m + width, m + width + 1]) joined.add(c);
  const pillars = grid.cells.flatMap((kind, cell) => (kind === "wall" && !joined.has(cell) ? [cell] : []));
  return { segments, pillars, masses };
}

/** The whole plan for a grid's walls and doors. */
export function wallPlan(grid: WallGrid): WallPlan {
  const { doors, loose } = doorGaps(grid);
  return { width: grid.width, ...wallStrokes(grid, doors), doors, loose };
}

/**
 * Paints a plan: `at` maps cell units to screen px, `size` is a cell's screen size, `dpr` the
 * device's pixel ratio. Strokes, masses and pillars in the ink; a door's leaf thinner, open on its
 * quarter swing once cells are `DOOR_SWING_CELL` px, else shut across its gap.
 */
export function paintWalls(g: CanvasRenderingContext2D, plan: WallPlan, at: (p: Point) => Point, size: number, dpr: number, palette: CanvasPalette): void {
  const w = wallWidth(size, dpr);
  const half = w / 2;
  const cellPoint = (cell: number, dx: number, dy: number): Point => at({ x: (cell % plan.width) + dx, y: Math.floor(cell / plan.width) + dy });
  g.save();
  g.globalAlpha = 0.82;
  g.strokeStyle = palette.ink;
  g.fillStyle = palette.ink;
  g.lineWidth = w;
  g.lineCap = "butt";
  g.lineJoin = "miter";
  g.setLineDash([]);
  // The lines, each wall end half a stroke past the wall's centre (a square end), each jamb end flat;
  // and each jamb's tick across the line.
  g.beginPath();
  for (const s of plan.segments) {
    const a = at(s.from);
    const b = at(s.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    g.moveTo(s.jamb[0] ? a.x : a.x - ux * half, s.jamb[0] ? a.y : a.y - uy * half);
    g.lineTo(s.jamb[1] ? b.x : b.x + ux * half, s.jamb[1] ? b.y : b.y + uy * half);
  }
  const tick = Math.max(w, size * 0.14);
  for (const d of plan.doors) {
    for (const j of [d.hinge, d.latch]) {
      const p = at(j);
      g.moveTo(d.axis === "h" ? p.x : p.x - tick, d.axis === "h" ? p.y - tick : p.y);
      g.lineTo(d.axis === "h" ? p.x : p.x + tick, d.axis === "h" ? p.y + tick : p.y);
    }
  }
  g.stroke();
  // Masses and pillars, as one fill: a mass spans its four cells' centres, a pillar sits in its cell.
  g.beginPath();
  for (const m of plan.masses) {
    const a = cellPoint(m, 0.5, 0.5);
    const b = cellPoint(m, 1.5, 1.5);
    g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
  const side = Math.min(size, Math.max(2 * w, size * 0.4));
  for (const p of plan.pillars) {
    const c = cellPoint(p, 0.5, 0.5);
    g.rect(c.x - side / 2, c.y - side / 2, side, side);
  }
  g.fill();
  // Each door's leaf: open into its side on a quarter arc, or shut across the gap in small cells.
  g.globalAlpha = 0.7;
  g.lineWidth = Math.max(1, half);
  g.beginPath();
  for (const d of plan.doors) {
    const hinge = at(d.hinge);
    const latch = at(d.latch);
    if (size < DOOR_SWING_CELL) {
      g.moveTo(hinge.x, hinge.y);
      g.lineTo(latch.x, latch.y);
      continue;
    }
    const r = Math.hypot(latch.x - hinge.x, latch.y - hinge.y);
    const open = d.axis === "h" ? { x: hinge.x, y: hinge.y + d.side * r } : { x: hinge.x + d.side * r, y: hinge.y };
    g.moveTo(hinge.x, hinge.y);
    g.lineTo(open.x, open.y);
    const from = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    const to = Math.atan2(latch.y - hinge.y, latch.x - hinge.x);
    // The quarter turn the short way round, from the open leaf back to the latch.
    const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    g.arc(hinge.x, hinge.y, r, from, to, turn < 0);
  }
  g.stroke();
  g.restore();
}
