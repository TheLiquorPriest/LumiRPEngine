// Drawing one map scope on a canvas (DESIGN §12): the grid behind its places (terrain, walls,
// doors, each place's area tinted), the routes, the places' dots and their names, and the things
// lying in cells. The display mode decides how what the POV knows only in part is drawn: by
// knowledge, a place only heard of is a dashed ring; in fog, places never visited are dimmed and
// the cells the view leaves out of `seen` lie under fog. Play's map and Build's map preview both
// draw through here, so a map looks the same while it's being written. Every colour comes from
// the canvas palette (canvas-theme.ts), read at draw time, so the map follows the host theme.

import type { Bounds, Point, Transform } from "../../../frontend/map-math";
import { toScreen } from "../../../frontend/map-math";
import { hasCell } from "../../../shared/grid";
import { VOID_TERRAIN } from "../../../shared/maps";
import type { MapDisplay } from "../../../shared/world";
import type { MapPlaceView, MapScopeView } from "../core/map-scope";
import type { CanvasPalette } from "./canvas-theme";
import { canvasPalette } from "./canvas-theme";
import { controlBoxes, LABEL_PAD, LINE, placeLabels, type PlacedLabel } from "./labels";

/** Drawing units along a scope's longer side: any scope, a 4×3 room or a 200-cell field, fits the shared zoom range. */
export const FRAME_UNITS = 400;

/** A fill: one of the palette's colours and how strongly it's laid over the ground. */
export interface Paint {
  color: string;
  alpha: number;
}

/**
 * Terrain fills by the words a terrain is named with, first match wins; a wood floor is a floor, not
 * a forest. Walls take the ink, half strength, so they stand out without glaring in a dark theme;
 * ground the POV walks on stays near the ground colour; growing things, water and sand take the
 * categorical series, so terrain reads in both themes.
 */
const TERRAIN_PAINT: readonly [RegExp, (p: CanvasPalette) => Paint][] = [
  [/door|gate|arch/, (p) => ({ color: p.series[2] ?? p.item, alpha: 0.5 })],
  [/wall|cliff/, (p) => ({ color: p.ink, alpha: 0.42 })],
  [/water|lake|sea|river|pond|well|canal/, (p) => ({ color: p.series[1] ?? p.pov, alpha: 0.3 })],
  [/floor|tile|flag|carpet|board|stone|parquet|marble|stair|step|hall/, (p) => ({ color: p.ink, alpha: 0.08 })],
  [/dock|pier|jetty|wharf|ramp|deck/, (p) => ({ color: p.series[2] ?? p.item, alpha: 0.26 })],
  [/grass|lawn|garden|park|field|meadow/, (p) => ({ color: p.series[0] ?? p.muted, alpha: 0.2 })],
  [/road|street|cobble|gravel|path|asphalt|parking|pav|dirt|track|yard/, (p) => ({ color: p.muted, alpha: 0.18 })],
  [/sand|beach|dune|shore/, (p) => ({ color: p.series[2] ?? p.item, alpha: 0.16 })],
  [/forest|tree|wood|brush/, (p) => ({ color: p.series[0] ?? p.muted, alpha: 0.36 })],
  [/rock|quarry|rubble/, (p) => ({ color: p.muted, alpha: 0.32 })],
  [/stall|market|shop|building|house|barn|office|room/, (p) => ({ color: p.muted, alpha: 0.24 })],
];

/** How a cell of `terrain` is filled; a wall's fill is also `terrainFill("wall", palette)`. Ground with no name of its own reads as floor. */
export function terrainFill(terrain: string, palette: CanvasPalette): Paint {
  const name = terrain.toLowerCase();
  return (TERRAIN_PAINT.find(([words]) => words.test(name))?.[1] ?? ((p: CanvasPalette) => ({ color: p.ink, alpha: 0.08 })))(palette);
}

/** The tint of the `index`th drawn place's area on a grid. */
export function areaFill(index: number, palette: CanvasPalette): Paint {
  return { color: palette.series[index % palette.series.length] ?? palette.pov, alpha: 0.2 };
}

/** Drawing units per frame unit (per grid cell on a grid). */
export function unitOf(scope: Pick<MapScopeView, "frame">): number {
  return FRAME_UNITS / Math.max(1, scope.frame.width, scope.frame.height);
}

/** A place's position in drawing units. */
export function placePoint(scope: Pick<MapScopeView, "frame">, place: Pick<MapPlaceView, "x" | "y">): Point {
  const unit = unitOf(scope);
  return { x: place.x * unit, y: place.y * unit };
}

/** What fitting the map frames: a grid whole, else its places (or the empty frame). */
export function scopeBounds(scope: Pick<MapScopeView, "frame" | "grid" | "places">): Bounds {
  const unit = unitOf(scope);
  if (scope.grid || scope.places.length === 0) return { minX: 0, minY: 0, maxX: scope.frame.width * unit, maxY: scope.frame.height * unit };
  const xs = scope.places.map((p) => p.x * unit);
  const ys = scope.places.map((p) => p.y * unit);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface DrawOptions {
  selected: string | null;
  /** The POV's place. */
  here: string | null;
  /** Places the POV is inside (its place's ancestors and the place itself). */
  inside: ReadonlySet<string>;
  /** Screen px along the top that the map's own bars cover. */
  top: number;
  display: MapDisplay;
  /** A cell picked on the grid, outlined. */
  cell: { x: number; y: number } | null;
}

/** Whether a place is known of but never visited, and not where the POV is: heard of, or under fog. */
function unvisited(place: MapPlaceView, opts: DrawOptions): boolean {
  return place.known && !place.visited && place.id !== opts.here && !opts.inside.has(place.id);
}

function fill(g: CanvasRenderingContext2D, paint: Paint, x: number, y: number, w: number, h: number): void {
  g.globalAlpha = paint.alpha;
  g.fillStyle = paint.color;
  g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
}

function paintGrid(g: CanvasRenderingContext2D, scope: MapScopeView, t: Transform, width: number, height: number, opts: DrawOptions, palette: CanvasPalette): void {
  const grid = scope.grid;
  if (!grid) return;
  const unit = unitOf(scope);
  const size = unit * t.k;
  const span = Math.ceil(size);
  const blocked = new Set(grid.blocked);
  const tint = new Map<number, Paint>();
  scope.places.forEach((place, i) => {
    for (const cell of grid.areas[place.id] ?? []) tint.set(cell, areaFill(i, palette));
  });
  const wall = terrainFill("wall", palette);
  // In fog, the cells the view didn't show (never seen, or a room not yet been in) lie under fog:
  // only the fog is drawn there, never the ground under it.
  const fog = opts.display === "fog";
  const seen = grid.seen ?? "";
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const p = toScreen(t, { x: x * unit, y: y * unit });
      if (p.x > width || p.y > height || p.x + size < 0 || p.y + size < 0) continue;
      const index = y * grid.width + x;
      if (fog && !hasCell(seen, index)) {
        fill(g, { color: palette.fog, alpha: 1 }, p.x, p.y, span, span);
        continue;
      }
      const terrain = grid.terrain[index] ?? "";
      // Nothing (outside a layout, a hidden place's cells, a cell the display hides) is the bare ground.
      if (terrain === "" || terrain === VOID_TERRAIN) continue;
      const shut = blocked.has(index);
      const ground = terrainFill(terrain, palette);
      fill(g, ground, p.x, p.y, span, span);
      const area = tint.get(index);
      if (area && !shut) fill(g, area, p.x, p.y, span, span);
      // A cell nobody can enter that isn't a wall (deep water, a counter) keeps its terrain under a hatch.
      if (shut && ground.color !== wall.color && size >= 8) {
        g.save();
        g.beginPath();
        g.rect(p.x, p.y, span, span);
        g.clip();
        g.globalAlpha = 0.35;
        g.strokeStyle = palette.ink;
        g.lineWidth = 1;
        g.beginPath();
        for (let d = -size; d < size; d += 6) {
          g.moveTo(p.x + d, p.y + size);
          g.lineTo(p.x + d + size, p.y);
        }
        g.stroke();
        g.restore();
      }
      if (size >= 14) {
        g.strokeStyle = palette.line;
        g.lineWidth = 1;
        g.strokeRect(p.x + 0.5, p.y + 0.5, size, size);
      }
    }
  }
  // Places without a cell sit in a row below the grid, set off by a dashed line.
  if (scope.frame.height > grid.height) {
    const a = toScreen(t, { x: 0, y: (grid.height + 0.5) * unit });
    const b = toScreen(t, { x: grid.width * unit, y: (grid.height + 0.5) * unit });
    g.globalAlpha = 0.5;
    g.strokeStyle = palette.muted;
    g.lineWidth = 1;
    g.setLineDash([4, 6]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
  // Things lying in cells: a small diamond each.
  for (const item of grid.items ?? []) {
    const c = toScreen(t, { x: (item.x + 0.5) * unit, y: (item.y + 0.5) * unit });
    const r = Math.max(4, size * 0.24);
    g.beginPath();
    g.moveTo(c.x, c.y - r);
    g.lineTo(c.x + r, c.y);
    g.lineTo(c.x, c.y + r);
    g.lineTo(c.x - r, c.y);
    g.closePath();
    g.fillStyle = palette.item;
    g.fill();
    g.globalAlpha = 0.6;
    g.strokeStyle = palette.ink;
    g.lineWidth = 1.5;
    g.stroke();
    g.globalAlpha = 1;
  }
  if (opts.cell) {
    const p = toScreen(t, { x: opts.cell.x * unit, y: opts.cell.y * unit });
    g.strokeStyle = palette.item;
    g.lineWidth = 2;
    g.strokeRect(p.x + 1, p.y + 1, Math.max(2, size - 2), Math.max(2, size - 2));
  }
  if (grid.pov) {
    const p = toScreen(t, { x: (grid.pov.x + 0.5) * unit, y: (grid.pov.y + 0.5) * unit });
    g.fillStyle = palette.pov;
    g.beginPath();
    g.arc(p.x, p.y, Math.max(5, size * 0.35), 0, Math.PI * 2);
    g.fill();
  }
}

/** A faint square grid behind a node map, so panning and zooming read. */
function paintBackdrop(g: CanvasRenderingContext2D, t: Transform, width: number, height: number, palette: CanvasPalette): void {
  const step = 100 * t.k;
  if (step <= 12) return;
  g.strokeStyle = palette.line;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = t.x % step; x < width; x += step) {
    g.moveTo(x, 0);
    g.lineTo(x, height);
  }
  for (let y = t.y % step; y < height; y += step) {
    g.moveTo(0, y);
    g.lineTo(width, y);
  }
  g.stroke();
}

/** Paints a scope and returns where the place names went (for taps on a name). */
export function drawScope(canvas: HTMLCanvasElement, scope: MapScopeView, t: Transform, opts: DrawOptions): PlacedLabel[] {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g) return [];
  const palette = canvasPalette(canvas);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The element's own background (opaque, themed) shows through; the ground is laid over it.
  g.clearRect(0, 0, width, height);
  g.fillStyle = palette.bg;
  g.fillRect(0, 0, width, height);
  if (scope.grid) paintGrid(g, scope, t, width, height, opts, palette);
  else paintBackdrop(g, t, width, height, palette);
  const screen = new Map(scope.places.map((p) => [p.id, toScreen(t, placePoint(scope, p))]));
  // Roads solid, footpaths dashed, water dotted: the line's pattern says what it is, not only its colour.
  for (const route of scope.routes) {
    const pa = screen.get(route.from);
    const pb = screen.get(route.to);
    if (!pa || !pb) continue;
    const road = route.modes.road !== undefined;
    const water = !road && route.modes.water !== undefined;
    g.globalAlpha = road ? 0.5 : water ? 0.7 : 0.35;
    g.strokeStyle = water ? (palette.series[1] ?? palette.pov) : palette.ink;
    g.lineWidth = road ? 3 : 2;
    g.setLineDash(road ? [] : water ? [2, 5] : [6, 6]);
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
  }
  g.setLineDash([]);
  g.globalAlpha = 1;
  for (const place of scope.places) {
    const p = screen.get(place.id) ?? { x: 0, y: 0 };
    const here = place.id === opts.here;
    const inside = !here && opts.inside.has(place.id);
    const isSelected = place.id === opts.selected;
    // Known of but never visited: by knowledge a dashed ring, in fog a dot under the fog.
    const away = unvisited(place, opts);
    const dim = !place.known ? 0.45 : away && opts.display === "fog" ? 0.35 : 1;
    g.globalAlpha = dim;
    g.beginPath();
    g.arc(p.x, p.y, here || isSelected ? 9 : 7, 0, Math.PI * 2);
    if (away && opts.display === "knowledge") {
      g.strokeStyle = palette.ink;
      g.lineWidth = 2;
      g.setLineDash([3, 3]);
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = here ? palette.pov : palette.ink;
      g.fill();
    }
    if (here || inside || isSelected) {
      g.globalAlpha = dim * (isSelected ? 1 : here ? 0.5 : 0.85);
      g.strokeStyle = isSelected ? palette.item : palette.pov;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, here || isSelected ? 15 : 12, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Names go where they don't collide (labels.ts): beside the dot, or further out on a leader line,
  // on two lines, or shortened with "…"; the place's sheet shows the full name on tap.
  g.font = `13px ${palette.font}`;
  const dimmed = new Map(scope.places.map((place) => [place.id, !place.known ? 0.45 : opts.display === "fog" && unvisited(place, opts) ? 0.55 : 1]));
  const labels = placeLabels(
    scope.places.map((place) => ({ id: place.id, ...(screen.get(place.id) ?? { x: 0, y: 0 }), r: place.id === opts.here || place.id === opts.selected || opts.inside.has(place.id) ? 16 : 8, text: place.known ? place.name : `${place.name}?` })),
    { width, height, measure: (s) => g.measureText(s).width, avoid: controlBoxes(width, height, opts.top), first: [opts.here, opts.selected].filter((id): id is string => id !== null) },
  );
  g.globalAlpha = 0.5;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  for (const label of labels) {
    if (!label.leader) continue;
    g.moveTo(label.leader.from.x, label.leader.from.y);
    g.lineTo(label.leader.to.x, label.leader.to.y);
  }
  g.stroke();
  for (const label of labels) {
    const { x, y, w, h } = label.box;
    // A label sits on a cut-out of the drawing, so the element's own surface shows behind its
    // name and the ink reads in either theme; a hairline sets it off from the ground.
    g.globalAlpha = 0.9;
    g.globalCompositeOperation = "destination-out";
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.strokeStyle = palette.line;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.globalAlpha = dimmed.get(label.id) ?? 1;
    g.fillStyle = palette.ink;
    label.lines.forEach((line, i) => g.fillText(line, x + LABEL_PAD, y + 15 + i * LINE));
    g.globalAlpha = 1;
  }
  return labels;
}
