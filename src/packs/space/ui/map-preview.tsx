// A map as Play will draw it, for Build (the map editor and a proposed map): the map's scope with
// the map compiled into the draft in place of any stored version, every place shown, drawn by the
// same stage and drawing as Play's map, with the map's problems marked over it: the cells, places
// and links they are about, an error's mark solid and a warning's dashed, so the colour isn't the
// only sign. The marks follow the stage's pan and zoom.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { cellAt, gridOf } from "../../../shared/grid";
import { hasOwn, isRecord } from "../../../shared/json";
import { compileMaps, DEFAULT_LEGEND, mapProblems, readMap } from "../../../shared/maps";
import type { JsonPath } from "../../../shared/schema-check";
import type { MapDoc, WorldDoc } from "../../../shared/world";
import { Empty, IdText } from "../../../frontend/components";
import { toScreen, type Transform } from "../../../frontend/map-math";
import type { PreviewProps } from "../../../frontend/registry";
import { scopeView, type MapScopeView } from "../core/map-scope";
import { canvasPalette, useThemeVersion } from "./canvas-theme";
import { MapStage } from "./map";
import { placePoint, unitOf } from "./map-draw";

const NOBODY_INSIDE: ReadonlySet<string> = new Set();

/** The scope `map` draws once it's compiled into `world` under `key`; Build sees every place, visited, and every thing the map lays in a cell, at the highest Space level. */
export function previewScope(world: WorldDoc, key: string, map: MapDoc): MapScopeView {
  const doc = compileMaps({ ...world, maps: { ...world.maps, [key]: map } });
  const grid = gridOf(doc, map.scope);
  const items = grid ? Object.entries(grid.items ?? {}).map(([id, index]) => ({ id, name: doc.entities[id]?.name ?? id, ...cellAt(grid, index) })) : [];
  return scopeView(doc, map.scope, { drawn: () => true, known: () => true, visited: () => true, shown: (id) => id, routeOpen: () => true }, { level: 4, trail: [], items });
}

/** A layout's rows as characters (code points, so any character is one cell) and its size: the widest row by the row count. */
export function layoutCells(layout: readonly string[]): { rows: string[][]; width: number; height: number } {
  const rows = layout.map((row) => [...row]);
  return { rows, width: Math.max(0, ...rows.map((r) => r.length)), height: rows.length };
}

/** The cells lint flags in a layout, as indexes on its widest row: characters neither legend knows, and the cells a short row lacks. */
export function badCells(layout: readonly string[], legend: Readonly<Record<string, unknown>>): number[] {
  const { rows, width } = layoutCells(layout);
  const out: number[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) {
      const ch = row[x];
      if (ch === undefined || !(hasOwn(legend, ch) || hasOwn(DEFAULT_LEGEND, ch))) out.push(y * width + x);
    }
  });
  return out;
}

/** What a map problem is about, from its path: a layout row, the cells of a legend character, a place, a link, or the map as a whole. */
export type MapMark = { kind: "row"; y: number } | { kind: "char"; ch: string } | { kind: "place"; index: number } | { kind: "link"; index: number } | { kind: "map" };

export function markOf(path: JsonPath): MapMark {
  const [head, at] = path;
  if (head === "layout" && typeof at === "number") return { kind: "row", y: at };
  if (head === "legend" && typeof at === "string") return { kind: "char", ch: at };
  if (head === "places" && typeof at === "number") return { kind: "place", index: at };
  if (head === "links" && typeof at === "number") return { kind: "link", index: at };
  return { kind: "map" };
}

/** A problem's mark on a drawing of the map: cells by index on the layout's widest row, a place by id, or a link by its ends. */
export interface PreviewMark {
  severity: "error" | "warning";
  cells?: readonly number[];
  place?: string;
  link?: readonly [string, string];
}

/** The marks a map's problems make on a drawing of it; a problem with the map as a whole marks nothing there (the list names it). */
export function previewMarks(value: unknown, problems: readonly { severity: "error" | "warning"; path: JsonPath }[]): PreviewMark[] {
  if (!isRecord(value)) return [];
  const layout = Array.isArray(value.layout) && value.layout.every((row) => typeof row === "string") ? value.layout.filter((row): row is string => typeof row === "string") : [];
  const legend = isRecord(value.legend) ? value.legend : {};
  const places = Array.isArray(value.places) ? value.places : [];
  const links = Array.isArray(value.links) ? value.links : [];
  const { rows, width } = layoutCells(layout);
  const bad = new Set(badCells(layout, legend));
  const out: PreviewMark[] = [];
  for (const p of problems) {
    const mark = markOf(p.path);
    if (mark.kind === "row" && mark.y < rows.length) {
      const row = Array.from({ length: width }, (_, x) => mark.y * width + x);
      const flagged = row.filter((cell) => bad.has(cell));
      out.push({ severity: p.severity, cells: flagged.length > 0 ? flagged : row });
    } else if (mark.kind === "char") {
      const cells: number[] = [];
      rows.forEach((row, y) => row.forEach((ch, x) => (ch === mark.ch ? cells.push(y * width + x) : undefined)));
      if (cells.length > 0) out.push({ severity: p.severity, cells });
    } else if (mark.kind === "place") {
      const place = places[mark.index];
      if (isRecord(place) && typeof place.id === "string") out.push({ severity: p.severity, place: place.id });
    } else if (mark.kind === "link") {
      const link = links[mark.index];
      if (isRecord(link) && typeof link.from === "string" && typeof link.to === "string") out.push({ severity: p.severity, link: [link.from, link.to] });
    }
  }
  return out;
}

/** A proposed map (Describe a map) as Play will draw it, compiled into the draft, its problems marked. */
export function MapProposalPreview(props: PreviewProps) {
  const key = JSON.stringify(props.value);
  const scope = useMemo(() => {
    const { map } = readMap(props.value);
    return map ? previewScope(props.world, props.id, map) : null;
  }, [props.world, props.id, key]);
  const marks = useMemo(() => {
    // Lint reads every map through the schema check, so the proposal goes in as it came.
    const maps: Record<string, unknown> = { ...props.world.maps, [props.id]: props.value };
    return previewMarks(props.value, mapProblems({ ...props.world, maps: maps as WorldDoc["maps"] }).get(props.id) ?? []);
  }, [props.world, props.id, key]);
  return scope ? <MapPreview scope={scope} height={260} marks={marks} /> : <Empty icon="map">This proposal isn't a map the engine can read.</Empty>;
}

/** Draws the marks over the stage, in step with its view. */
function paintMarks(canvas: HTMLCanvasElement, scope: MapScopeView, t: Transform, marks: readonly PreviewMark[]): void {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const palette = canvasPalette(canvas);
  const unit = unitOf(scope);
  const size = unit * t.k;
  const columns = scope.grid?.width ?? 0;
  const at = (id: string) => {
    const place = scope.places.find((p) => p.id === id);
    return place ? toScreen(t, placePoint(scope, place)) : null;
  };
  for (const mark of marks) {
    g.strokeStyle = mark.severity === "error" ? (palette.series[3] ?? palette.ink) : (palette.series[2] ?? palette.ink);
    g.setLineDash(mark.severity === "error" ? [] : [5, 4]);
    g.lineWidth = 2;
    if (mark.cells && columns > 0) {
      for (const cell of mark.cells) {
        const p = toScreen(t, { x: (cell % columns) * unit, y: Math.floor(cell / columns) * unit });
        g.strokeRect(p.x + 1, p.y + 1, Math.max(2, size - 2), Math.max(2, size - 2));
      }
    }
    if (mark.place) {
      const p = at(mark.place);
      if (p) {
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, 17, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (mark.link) {
      const a = at(mark.link[0]);
      const b = at(mark.link[1]);
      if (a && b) {
        g.lineWidth = 4;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  }
  g.setLineDash([]);
}

export function MapPreview(props: { scope: MapScopeView; height?: number; marks?: readonly PreviewMark[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<Transform | null>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  // A theme change renders this again; every render repaints the marks over the stage's latest view.
  useThemeVersion();
  const marks = props.marks ?? [];
  const place = props.scope.places.find((p) => p.id === selected);
  const grid = props.scope.grid;
  const repaint = () => {
    if (overlay.current && view) paintMarks(overlay.current, props.scope, view, marks);
  };
  const latest = useRef(repaint);
  latest.current = repaint;
  useEffect(repaint);
  useEffect(() => {
    const el = overlay.current;
    if (!el) return undefined;
    // The stage may keep its view through a resize, so the marks follow the size on their own.
    const observer = new ResizeObserver(() => latest.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, [marks.length > 0]);
  return (
    <div class="lre-stack" data-lre-map-preview={props.scope.id ?? ""}>
      <div class="lre-map lre-ve-preview" style={{ height: `${props.height ?? 300}px` }}>
        <MapStage scope={props.scope} here={null} inside={NOBODY_INSIDE} selected={selected} onTap={(p) => setSelected(p?.id ?? null)} display="knowledge" top={8} onView={setView} />
        {marks.length > 0 ? <canvas ref={overlay} class="lre-ve-marks" aria-hidden="true" /> : null}
      </div>
      <span class="lre-small lre-muted">
        {place ? (
          <>
            {place.name} <IdText id={place.id} />
          </>
        ) : (
          `${props.scope.name}: ${props.scope.places.length} place${props.scope.places.length === 1 ? "" : "s"}${grid ? ` on a ${grid.width} × ${grid.height} grid` : ""}. Tap a place for its name.`
        )}
        {marks.length > 0 ? ` ${marks.length} problem${marks.length === 1 ? "" : "s"} marked.` : ""}
      </span>
    </div>
  );
}
