// Drawing one map scope on a canvas (DESIGN §12): the grid behind its places (terrain, walls,
// doors, each place's area tinted), the routes, the places' dots and their names, and the things
// lying in cells. The display mode decides how what the POV knows only in part is drawn: by
// knowledge, a place only heard of is a dashed ring; in fog, places never visited and cells never
// seen lie under fog. Play's map and Build's map preview both draw through here, so a map looks the
// same while it's being written.

import type { Bounds, Point, Transform } from "../../../frontend/map-math";
import { toScreen } from "../../../frontend/map-math";
import { hasCell } from "../../../shared/grid";
import type { MapDisplay } from "../../../shared/world";
import type { MapPlaceView, MapScopeView } from "../core/map-scope";
import { controlBoxes, LABEL_PAD, LINE, placeLabels, type PlacedLabel } from "./labels";

/** Drawing units along a scope's longer side: any scope, a 4×3 room or a 200-cell field, fits the shared zoom range. */
export const FRAME_UNITS = 400;

/** Terrain colours by the words a terrain is named with, first match wins; a wood floor is a floor, not a forest. */
const TERRAIN_COLORS: readonly [RegExp, string][] = [
  [/door|gate|arch/, "#7a5a2e"],
  [/wall|cliff/, "#0a0b0f"],
  [/water|lake|sea|river|pond|well|canal/, "#1b2c44"],
  [/floor|tile|flag|carpet|board|stone|parquet|marble|stair|step|hall/, "#2f2c36"],
  [/dock|pier|jetty|wharf|ramp|deck/, "#4a3b2a"],
  [/grass|lawn|garden|park|field|meadow/, "#1f3326"],
  [/road|street|cobble|gravel|path|asphalt|parking|pav|dirt|track|yard/, "#3a3d48"],
  [/sand|beach|dune|shore/, "#4a422c"],
  [/forest|tree|wood|brush/, "#18301f"],
  [/rock|quarry|rubble/, "#34343a"],
  [/stall|market|shop|building|house|barn|office|room/, "#3b2f2a"],
];
const TERRAIN_DEFAULT = "#1d2029";
const BLOCKED = "#0a0b0f";
/** Tints for each place's area on a grid, in the order the places are drawn. */
const AREA_TINTS = ["rgba(124,108,255,0.20)", "rgba(242,196,107,0.18)", "rgba(127,224,160,0.18)", "rgba(255,138,138,0.18)", "rgba(107,197,242,0.20)", "rgba(220,140,240,0.18)"];
/** Fog over what the POV hasn't seen: dark enough to hide the terrain, light enough to show there is something there. */
const FOG = "rgba(11,12,16,0.86)";
/** Things lying in cells, and a picked cell's outline. */
const ITEM = "#f2c46b";

export function terrainColor(terrain: string): string {
  const name = terrain.toLowerCase();
  return TERRAIN_COLORS.find(([words]) => words.test(name))?.[1] ?? TERRAIN_DEFAULT;
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

function paintGrid(g: CanvasRenderingContext2D, scope: MapScopeView, t: Transform, width: number, height: number, opts: DrawOptions): void {
  const grid = scope.grid;
  if (!grid) return;
  const unit = unitOf(scope);
  const size = unit * t.k;
  const blocked = new Set(grid.blocked);
  const tint = new Map<number, string>();
  scope.places.forEach((place, i) => {
    for (const cell of grid.areas[place.id] ?? []) tint.set(cell, AREA_TINTS[i % AREA_TINTS.length] ?? AREA_TINTS[0] ?? "");
  });
  // In fog, what the POV hasn't seen: the cells never in its sight while the grid system tracks
  // them, else the areas of the rooms it hasn't been in.
  const fog = opts.display === "fog";
  const seen = grid.seen;
  const fogged = new Set<number>();
  if (fog && seen === undefined) for (const place of scope.places) if (unvisited(place, opts)) for (const cell of grid.areas[place.id] ?? []) fogged.add(cell);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const p = toScreen(t, { x: x * unit, y: y * unit });
      if (p.x > width || p.y > height || p.x + size < 0 || p.y + size < 0) continue;
      const index = y * grid.width + x;
      g.fillStyle = blocked.has(index) ? BLOCKED : terrainColor(grid.terrain[index] ?? "");
      g.fillRect(p.x, p.y, Math.ceil(size), Math.ceil(size));
      const area = tint.get(index);
      if (area && !blocked.has(index)) {
        g.fillStyle = area;
        g.fillRect(p.x, p.y, Math.ceil(size), Math.ceil(size));
      }
      if (fog && (seen !== undefined ? !hasCell(seen, index) : fogged.has(index))) {
        g.fillStyle = FOG;
        g.fillRect(p.x, p.y, Math.ceil(size), Math.ceil(size));
      }
      if (size >= 14) {
        g.strokeStyle = "rgba(0,0,0,0.25)";
        g.lineWidth = 1;
        g.strokeRect(p.x + 0.5, p.y + 0.5, size, size);
      }
    }
  }
  // Places without a cell sit in a row below the grid, set off by a dashed line.
  if (scope.frame.height > grid.height) {
    const a = toScreen(t, { x: 0, y: (grid.height + 0.5) * unit });
    const b = toScreen(t, { x: grid.width * unit, y: (grid.height + 0.5) * unit });
    g.strokeStyle = "rgba(200,200,220,0.3)";
    g.lineWidth = 1;
    g.setLineDash([4, 6]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.setLineDash([]);
  }
  // Things lying in cells: a small diamond each.
  for (const item of grid.items ?? []) {
    const c = toScreen(t, { x: (item.x + 0.5) * unit, y: (item.y + 0.5) * unit });
    const r = Math.max(4, size * 0.24);
    g.fillStyle = ITEM;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(c.x, c.y - r);
    g.lineTo(c.x + r, c.y);
    g.lineTo(c.x, c.y + r);
    g.lineTo(c.x - r, c.y);
    g.closePath();
    g.fill();
    g.stroke();
  }
  if (opts.cell) {
    const p = toScreen(t, { x: opts.cell.x * unit, y: opts.cell.y * unit });
    g.strokeStyle = ITEM;
    g.lineWidth = 2;
    g.strokeRect(p.x + 1, p.y + 1, Math.max(2, size - 2), Math.max(2, size - 2));
  }
  if (grid.pov) {
    const p = toScreen(t, { x: (grid.pov.x + 0.5) * unit, y: (grid.pov.y + 0.5) * unit });
    g.fillStyle = "#7c6cff";
    g.beginPath();
    g.arc(p.x, p.y, Math.max(5, size * 0.35), 0, Math.PI * 2);
    g.fill();
  }
}

function paintBackdrop(g: CanvasRenderingContext2D, t: Transform, width: number, height: number): void {
  g.strokeStyle = "rgba(255,255,255,0.04)";
  g.lineWidth = 1;
  const step = 100 * t.k;
  if (step <= 12) return;
  for (let x = t.x % step; x < width; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke();
  }
  for (let y = t.y % step; y < height; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
  }
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
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#12141a";
  g.fillRect(0, 0, width, height);
  if (scope.grid) paintGrid(g, scope, t, width, height, opts);
  else paintBackdrop(g, t, width, height);
  const screen = new Map(scope.places.map((p) => [p.id, toScreen(t, placePoint(scope, p))]));
  for (const route of scope.routes) {
    const pa = screen.get(route.from);
    const pb = screen.get(route.to);
    if (!pa || !pb) continue;
    g.strokeStyle = route.modes.road ? "rgba(200,200,220,0.45)" : route.modes.water ? "rgba(90,150,230,0.5)" : "rgba(200,200,220,0.25)";
    g.lineWidth = route.modes.road ? 3 : 2;
    g.setLineDash(route.modes.road ? [] : [6, 6]);
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
  }
  g.setLineDash([]);
  g.font = "13px system-ui, sans-serif";
  for (const place of scope.places) {
    const p = screen.get(place.id) ?? { x: 0, y: 0 };
    const here = place.id === opts.here;
    const inside = !here && opts.inside.has(place.id);
    const isSelected = place.id === opts.selected;
    // Known of but never visited: by knowledge a dashed ring, in fog a dot under the fog.
    const away = unvisited(place, opts);
    g.globalAlpha = !place.known ? 0.45 : away && opts.display === "fog" ? 0.35 : 1;
    g.beginPath();
    g.arc(p.x, p.y, here || isSelected ? 9 : 7, 0, Math.PI * 2);
    if (away && opts.display === "knowledge") {
      g.strokeStyle = "#d8d8e4";
      g.lineWidth = 2;
      g.setLineDash([3, 3]);
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = here ? "#7c6cff" : "#d8d8e4";
      g.fill();
    }
    if (here || inside || isSelected) {
      g.strokeStyle = isSelected ? "#f2c46b" : here ? "rgba(124,108,255,0.5)" : "rgba(124,108,255,0.85)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, here || isSelected ? 15 : 12, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Names go where they don't collide (labels.ts): beside the dot, or further out on a leader line,
  // on two lines, or shortened with "…"; the place's card shows the full name on tap.
  const dim = new Map(scope.places.map((place) => [place.id, !place.known ? 0.45 : opts.display === "fog" && unvisited(place, opts) ? 0.55 : 1]));
  const labels = placeLabels(
    scope.places.map((place) => ({ id: place.id, ...(screen.get(place.id) ?? { x: 0, y: 0 }), r: place.id === opts.here || place.id === opts.selected || opts.inside.has(place.id) ? 16 : 8, text: place.known ? place.name : `${place.name}?` })),
    { width, height, measure: (s) => g.measureText(s).width, avoid: controlBoxes(width, height, opts.top), first: [opts.here, opts.selected].filter((id): id is string => id !== null) },
  );
  g.strokeStyle = "rgba(240,240,246,0.45)";
  g.lineWidth = 1;
  for (const label of labels) {
    if (!label.leader) continue;
    g.beginPath();
    g.moveTo(label.leader.from.x, label.leader.from.y);
    g.lineTo(label.leader.to.x, label.leader.to.y);
    g.stroke();
  }
  for (const label of labels) {
    g.globalAlpha = dim.get(label.id) ?? 1;
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(label.box.x, label.box.y, label.box.w, label.box.h);
    g.fillStyle = "#f0f0f6";
    label.lines.forEach((line, i) => g.fillText(line, label.box.x + LABEL_PAD, label.box.y + 15 + i * LINE));
    g.globalAlpha = 1;
  }
  return labels;
}
