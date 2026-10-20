// Build's grid editors (DESIGN §13): the canvas they share with the map editor (pan, wheel and
// pinch zoom, Fit, and a tool that takes one finger to paint or drag while two fingers still pan
// and pinch), the grid painter (terrain, blocked cells and zones), and the place editor, which adds
// tap-to-place on the parent's grid to the schema form. Canvases paint with the theme's canvas
// tokens (`canvas-theme`) and redraw when the theme changes.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Cell } from "../../../shared/grid";
import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { nameOfId } from "../../../shared/maps";
import type { GridDef } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { MapOwned, SchemaEditor } from "../../../frontend/build/build";
import { deleteItem, ItemHeader } from "../../../frontend/build/chrome";
import { Chip, Issues } from "../../../frontend/build/form-kit";
import { useHeld } from "../../../frontend/build/held";
import { FieldInput } from "../../../frontend/build/schema-form";
import { Button, Disclosure, Field, IconButton, NumberStepper, SaveBar, Section, Seg, useBusy } from "../../../frontend/components";
import { fit, GestureTracker, IDENTITY, toScreen, toWorld, zoomAt } from "../../../frontend/map-math";
import type { Bounds, Point, Transform } from "../../../frontend/map-math";
import type { EditorProps } from "../../../frontend/registry";
import { canvasPalette, useThemeVersion, type CanvasPalette } from "./canvas-theme";
import { areaFill, FRAME_UNITS, terrainFill, type Paint } from "./map-draw";

const TERRAINS = ["grass", "road", "building", "water", "forest", "sand", "rock"];

type Tool = "pan" | "paint" | "block" | "zone";

/** A resized grid: the overlapping rectangle keeps its terrain, blocked cells and zones. */
export function resizeGrid(grid: GridDef, width: number, height: number, fill: string): GridDef {
  const remap = (index: number): number | null => {
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    return x < width && y < height ? y * width + x : null;
  };
  const terrain: string[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) terrain.push(x < grid.width && y < grid.height ? grid.terrain[y * grid.width + x] ?? fill : fill);
  const keep = (cells: number[]) => cells.map(remap).filter((cell): cell is number => cell !== null);
  return { ...grid, width, height, terrain, blocked: keep(grid.blocked), zones: Object.fromEntries(Object.entries(grid.zones).map(([zone, cells]) => [zone, keep(cells)])) };
}

/** The strip along an editing canvas's bottom that its zoom buttons sit in (a 40 px row and its margins). */
export const ZOOM_STRIP = 56;

/** Drawing units per cell: any grid, a 3 × 2 room or a 64-cell hall, fits the shared zoom range (map-math clamps k to 0.25–4). */
export function gridUnit(grid: { width: number; height: number }): number {
  return FRAME_UNITS / Math.max(1, grid.width, grid.height);
}

/** The view in screen px per cell. */
export function cellView(t: Transform, unit: number): Transform {
  return { ...t, k: t.k * unit };
}

/** The cell index under a screen point, through a view in px per cell; null outside the grid. */
export function cellAt(t: Transform, grid: Pick<GridDef, "width" | "height">, screen: Point): number | null {
  const w = toWorld(t, screen);
  const x = Math.floor(w.x);
  const y = Math.floor(w.y);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? y * grid.width + x : null;
}

/** The cells a stroke crosses from `a` to `b`, both included, so a quick drag leaves no gaps. */
export function strokeCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = a;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** One brush stroke on one cell. Painting blocked or a zone is a toggle decided by the stroke's first cell. */
export function paintCell(grid: GridDef, index: number, tool: Exclude<Tool, "pan">, brush: string, zone: string, adding: boolean): GridDef {
  if (tool === "paint") {
    if (grid.terrain[index] === brush) return grid;
    const terrain = grid.terrain.slice();
    terrain[index] = brush;
    return { ...grid, terrain };
  }
  if (tool === "block") {
    const has = grid.blocked.includes(index);
    if (has === adding) return grid;
    return { ...grid, blocked: adding ? [...grid.blocked, index].sort((a, b) => a - b) : grid.blocked.filter((cell) => cell !== index) };
  }
  const cells = grid.zones[zone] ?? [];
  const has = cells.includes(index);
  if (has === adding || !zone) return grid;
  return { ...grid, zones: { ...grid.zones, [zone]: adding ? [...cells, index].sort((a, b) => a - b) : cells.filter((cell) => cell !== index) } };
}

/** The theme's canvas palette as read from an element inside the drawer, read again when the theme changes; null before mount. */
export function usePalette(ref: { readonly current: Element | null }): CanvasPalette | null {
  const theme = useThemeVersion();
  const [palette, setPalette] = useState<CanvasPalette | null>(null);
  useEffect(() => {
    if (ref.current) setPalette(canvasPalette(ref.current));
  }, [theme]);
  return palette;
}

/** A small square of a canvas fill, for a legend chip or a list row. */
export function Swatch(props: { fill: Paint | null; mark?: string }) {
  return (
    <span class="lre-ve-swatch" aria-hidden="true">
      {props.fill ? <i style={{ background: props.fill.color, opacity: props.fill.alpha }} /> : null}
      {props.mark ? <b>{props.mark}</b> : null}
    </span>
  );
}

/** A cross through a cell: blocked, by shape as well as colour. */
export function crossCell(g: CanvasRenderingContext2D, p: Point, size: number, color: string): void {
  const inset = Math.max(1.5, size * 0.18);
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, Math.min(3, size * 0.08));
  g.beginPath();
  g.moveTo(p.x + inset, p.y + inset);
  g.lineTo(p.x + size - inset, p.y + size - inset);
  g.moveTo(p.x + size - inset, p.y + inset);
  g.lineTo(p.x + inset, p.y + size - inset);
  g.stroke();
}

/** Cell outlines, once cells are big enough to tell apart. */
export function gridLines(g: CanvasRenderingContext2D, t: Transform, cols: number, rows: number, palette: CanvasPalette): void {
  if (t.k < 10) return;
  g.strokeStyle = palette.line;
  g.globalAlpha = 0.55;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= cols; x += 1) {
    const a = toScreen(t, { x, y: 0 });
    const b = toScreen(t, { x, y: rows });
    g.moveTo(Math.round(a.x) + 0.5, a.y);
    g.lineTo(Math.round(b.x) + 0.5, b.y);
  }
  for (let y = 0; y <= rows; y += 1) {
    const a = toScreen(t, { x: 0, y });
    const b = toScreen(t, { x: cols, y });
    g.moveTo(a.x, Math.round(a.y) + 0.5);
    g.lineTo(b.x, Math.round(b.y) + 0.5);
  }
  g.stroke();
  g.globalAlpha = 1;
}

/** What a canvas tool does with one finger: a press it doesn't take pans the view, and a quick one that didn't move is a tap. */
export interface CanvasTool {
  /** A press at a screen point: true takes this finger for the tool (painting, dragging) instead of panning. */
  press?(p: Point, t: Transform): boolean;
  move?(p: Point, t: Transform): void;
  /** The finger lifted, or a second one landed: the stroke ends there and the two fingers pinch. */
  release?(p: Point, t: Transform): void;
  tap?(p: Point, t: Transform): void;
}

function localPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (rect.width > 0 ? canvas.clientWidth / rect.width : 1), y: (event.clientY - rect.top) * (rect.height > 0 ? canvas.clientHeight / rect.height : 1) };
}

/**
 * An editing canvas: fitted to `bounds` when `fitKey` changes and on every resize until the view is
 * moved, panned with one finger (or the tool's press), zoomed by pinch, wheel and the zoom buttons.
 * `draw` paints over the palette's background after every render (its inputs are the caller's), and
 * again when the theme changes.
 */
export function EditCanvas(props: { label: string; bounds: Bounds; fitKey: string; height?: number; tool: CanvasTool; draw(g: CanvasRenderingContext2D, t: Transform, width: number, height: number, palette: CanvasPalette): void; children?: ComponentChildren }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  const [view, setView] = useState<Transform>(IDENTITY);
  // The view was panned or zoomed since the last fit, so a resize keeps it.
  const moved = useRef(false);
  // The pointer a tool holds, and every pressed pointer's latest point.
  const held = useRef<number | null>(null);
  const points = useRef(new Map<number, Point>());
  const latest = useRef(props);
  latest.current = props;
  // A theme change renders this again, and every render repaints with the palette the theme gives.
  useThemeVersion();

  const paint = (t: Transform) => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
    }
    const g = el.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const palette = canvasPalette(el);
    g.clearRect(0, 0, width, height);
    g.fillStyle = palette.bg;
    g.fillRect(0, 0, width, height);
    latest.current.draw(g, t, width, height, palette);
  };
  const refit = () => {
    const el = canvas.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    // The zoom buttons sit in a strip along the bottom: the fit keeps the drawing above them.
    const next = fit(latest.current.bounds, el.clientWidth, el.clientHeight - ZOOM_STRIP, 12);
    tracker.current.transform = next;
    moved.current = false;
    setView(next);
  };
  const show = (next: Transform) => {
    tracker.current.transform = next;
    moved.current = true;
    setView(next);
  };
  const zoom = (factor: number) => {
    const el = canvas.current;
    if (el) show(zoomAt(tracker.current.transform, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor));
  };

  useEffect(refit, [props.fitKey]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // It can mount at no size inside a sliding drawer, so a resize refits until the view is moved.
    const observer = new ResizeObserver(() => {
      if (!moved.current) refit();
      else paint(tracker.current.transform);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Painting is cheap next to a render, so every render repaints: the caller's drawing inputs are many.
  useEffect(() => paint(view));

  return (
    <div class="lre-ve-stage" style={{ height: `${props.height ?? 320}px` }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={props.label}
        data-zoom={view.k.toFixed(2)}
        onPointerDown={(event) => {
          const el = canvas.current;
          if (!el) return;
          el.setPointerCapture(event.pointerId);
          const p = localPoint(el, event);
          points.current.set(event.pointerId, p);
          const tool = latest.current.tool;
          if (points.current.size === 1 && tool.press?.(p, tracker.current.transform)) {
            held.current = event.pointerId;
            return;
          }
          const first = held.current;
          if (first !== null) {
            held.current = null;
            const at = points.current.get(first) ?? p;
            tool.release?.(at, tracker.current.transform);
            tracker.current.down(first, at, event.timeStamp);
          }
          tracker.current.down(event.pointerId, p, event.timeStamp);
        }}
        onPointerMove={(event) => {
          const el = canvas.current;
          // A mouse moves without a press: only pressed pointers count.
          if (!el || !points.current.has(event.pointerId)) return;
          const p = localPoint(el, event);
          points.current.set(event.pointerId, p);
          if (event.pointerId === held.current) {
            latest.current.tool.move?.(p, tracker.current.transform);
            return;
          }
          const before = tracker.current.transform;
          const after = tracker.current.move(event.pointerId, p).transform;
          if (after !== before) show(after);
        }}
        onPointerUp={(event) => {
          const el = canvas.current;
          if (!el || !points.current.has(event.pointerId)) return;
          const p = localPoint(el, event);
          points.current.delete(event.pointerId);
          if (event.pointerId === held.current) {
            held.current = null;
            latest.current.tool.release?.(p, tracker.current.transform);
            return;
          }
          const result = tracker.current.up(event.pointerId, p, event.timeStamp);
          if (result.tap) latest.current.tool.tap?.(result.tap, tracker.current.transform);
        }}
        onPointerCancel={(event) => {
          const at = points.current.get(event.pointerId);
          points.current.delete(event.pointerId);
          if (event.pointerId === held.current) {
            held.current = null;
            if (at) latest.current.tool.release?.(at, tracker.current.transform);
            return;
          }
          tracker.current.cancel(event.pointerId);
        }}
        onWheel={(event) => {
          const el = canvas.current;
          if (!el) return;
          event.preventDefault();
          show(tracker.current.wheel(localPoint(el, event), event.deltaY, event.deltaMode));
        }}
      />
      {props.children}
      <div class="lre-ve-zoom">
        <IconButton icon="plus" label="Zoom in" variant="secondary" onClick={() => zoom(1.4)} />
        <IconButton icon="minus" label="Zoom out" variant="secondary" onClick={() => zoom(1 / 1.4)} />
        <IconButton icon="expand" label="Fit" variant="secondary" onClick={refit} />
      </div>
    </div>
  );
}

/** Paints a grid: terrain, zone tints, blocked cells crossed, cell lines, and a marker on one cell. */
function drawGrid(g: CanvasRenderingContext2D, grid: GridDef, view: Transform, width: number, height: number, palette: CanvasPalette, marker: Cell | null): void {
  const t = cellView(view, gridUnit(grid));
  const size = Math.ceil(t.k);
  const blocked = new Set(grid.blocked);
  const zoneOf = new Map<number, number>();
  Object.values(grid.zones).forEach((cells, i) => cells.forEach((cell) => zoneOf.set(cell, i)));
  const neg = palette.series[3] ?? palette.ink;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const p = toScreen(t, { x, y });
      if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0) continue;
      const index = y * grid.width + x;
      const fill = terrainFill(grid.terrain[index] ?? "", palette);
      g.globalAlpha = fill.alpha;
      g.fillStyle = fill.color;
      g.fillRect(p.x, p.y, size, size);
      const zone = zoneOf.get(index);
      if (zone !== undefined) {
        const tint = areaFill(zone, palette);
        g.globalAlpha = tint.alpha;
        g.fillStyle = tint.color;
        g.fillRect(p.x, p.y, size, size);
      }
      g.globalAlpha = 1;
      if (blocked.has(index)) crossCell(g, p, t.k, neg);
    }
  }
  gridLines(g, t, grid.width, grid.height, palette);
  if (marker) {
    const p = toScreen(t, { x: marker.x + 0.5, y: marker.y + 0.5 });
    g.fillStyle = palette.pov;
    g.strokeStyle = palette.bg;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x, p.y, Math.max(6, t.k * 0.35), 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

/** A grid on an editing canvas; `tool` decides what one finger does. */
function GridCanvas(props: { grid: GridDef; marker: Cell | null; tool: CanvasTool; label: string; height?: number }) {
  const { grid } = props;
  return (
    <EditCanvas
      label={props.label}
      bounds={{ minX: 0, minY: 0, maxX: grid.width * gridUnit(grid), maxY: grid.height * gridUnit(grid) }}
      fitKey={`${grid.width}x${grid.height}`}
      height={props.height}
      tool={props.tool}
      draw={(g, t, width, height, palette) => drawGrid(g, grid, t, width, height, palette, props.marker)}
    />
  );
}

const TOOLS = [
  { value: "pan", label: "Pan" },
  { value: "paint", label: "Terrain" },
  { value: "block", label: "Blocked" },
  { value: "zone", label: "Zone" },
] as const satisfies readonly { value: Tool; label: string }[];

const HINT: Record<Tool, string> = {
  pan: "Drag to pan; pinch, scroll or the buttons to zoom.",
  paint: "Drag to paint terrain; two fingers pan and zoom.",
  block: "Drag to block cells, or start on a blocked cell to clear them; two fingers pan and zoom.",
  zone: "Drag to add cells to the zone, or start on one of its cells to take them out; two fingers pan and zoom.",
};

export function GridEditor(props: EditorProps) {
  const app = useApp();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.grids[id] : undefined;
  const blank: GridDef = { id: id ?? "", width: 16, height: 16, terrain: Array.from({ length: 256 }, () => "grass"), blocked: [], zones: {} };
  const [grid, setGrid] = useState<GridDef>(stored ? structuredClone(stored) : blank);
  const [tool, setTool] = useState<Tool>("paint");
  const [brush, setBrush] = useState("road");
  const [zone, setZone] = useState(Object.keys(stored?.zones ?? {})[0] ?? "");
  const [newZone, setNewZone] = useState("");
  const [history, setHistory] = useState<GridDef[]>([]);
  const stroke = useRef<{ last: Cell; adding: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const palette = usePalette(root);
  const [busy, run] = useBusy();
  const [jsonProblem, setJsonProblem] = useState<string | null>(null);
  useHeld(grid, setGrid, stored ?? blank, `${props.world.id}/grids/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  if (!id) return <SchemaEditor {...props} />;
  if (stored?.map) return <MapOwned worldId={props.world.id} collection="grids" id={id} value={stored} map={stored.map} />;
  const changed = JSON.stringify(grid) !== JSON.stringify(stored ?? null);
  const terrains = [...new Set([...TERRAINS, ...grid.terrain])];
  const zones = Object.keys(grid.zones);
  const unit = gridUnit(grid);
  const cellUnder = (p: Point, t: Transform): Cell | null => {
    const index = cellAt(cellView(t, unit), grid, p);
    return index === null ? null : { x: index % grid.width, y: Math.floor(index / grid.width) };
  };
  const paint = (cells: readonly Cell[], adding: boolean) => {
    if (tool === "pan") return;
    setGrid((current) => cells.reduce((g, c) => paintCell(g, c.y * g.width + c.x, tool, brush, zone, adding), current));
  };
  const brushTool: CanvasTool =
    tool === "pan" || (tool === "zone" && !zone)
      ? {}
      : {
          press: (p, t) => {
            const cell = cellUnder(p, t);
            if (!cell) return false;
            const index = cell.y * grid.width + cell.x;
            const adding = tool === "block" ? !grid.blocked.includes(index) : tool === "zone" ? !(grid.zones[zone] ?? []).includes(index) : true;
            setHistory((h) => [...h.slice(-29), grid]);
            stroke.current = { last: cell, adding };
            paint([cell], adding);
            return true;
          },
          move: (p, t) => {
            const s = stroke.current;
            const cell = cellUnder(p, t);
            if (!s || !cell || (cell.x === s.last.x && cell.y === s.last.y)) return;
            paint(strokeCells(s.last, cell).slice(1), s.adding);
            s.last = cell;
          },
          release: () => {
            stroke.current = null;
          },
        };
  const resize = (width: number, height: number) => {
    setHistory((h) => [...h.slice(-29), grid]);
    setGrid(resizeGrid(grid, width, height, brush));
  };
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "grids", id, value: { ...grid, id } as unknown as JsonValue });
      if (message.type === "lre.result" && isNew) app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "grids", id } }));
    });
  const remove = () =>
    run(async () => {
      await deleteItem(app, props.send, { worldId: props.world.id, collection: "grids", id });
    });
  return (
    <div ref={root} class="lre-build-page" data-lre-editor="grids">
      <ItemHeader title={nameOfId(id)} id={id} onDelete={isNew ? undefined : remove} busy={busy} />
      <Section title="Size">
        <NumberStepper label="Width (cells)" value={grid.width} min={1} max={256} integer onChange={(width) => resize(width, grid.height)} />
        <NumberStepper label="Height (cells)" value={grid.height} min={1} max={256} integer onChange={(height) => resize(grid.width, height)} />
        <Field label="Cell size (metres)" help="Leave it empty for 80 m. Walking times on the grid use it.">
          <input class="lre-input" inputMode="decimal" value={grid.cellMeters !== undefined ? String(grid.cellMeters) : ""} onChange={(event) => setGrid({ ...grid, cellMeters: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
        </Field>
      </Section>
      <Section title="Paint" aside={<IconButton icon="undo" label="Undo" disabled={history.length === 0} onClick={() => {
        const last = history.at(-1);
        if (!last) return;
        setHistory(history.slice(0, -1));
        setGrid(last);
      }} />}>
        <div class="lre-stack">
          <Seg<Tool> label="Tool" value={tool} options={TOOLS} onChange={setTool} />
          {tool === "paint" ? (
            <div class="lre-form-chips lre-ve-brushes" role="group" aria-label="Terrain">
              {terrains.map((terrain) => (
                <Chip key={terrain} pressed={terrain === brush} onToggle={() => setBrush(terrain)}>
                  <span class="lre-ve-brush">
                    <Swatch fill={palette ? terrainFill(terrain, palette) : null} />
                    {terrain}
                  </span>
                </Chip>
              ))}
            </div>
          ) : null}
          {tool === "zone" ? (
            <div class="lre-stack">
              {zones.length > 0 ? (
                <div class="lre-form-chips lre-ve-brushes" role="group" aria-label="Zones">
                  {zones.map((name, i) => (
                    <Chip key={name} pressed={name === zone} onToggle={() => setZone(name)}>
                      <span class="lre-ve-brush">
                        <Swatch fill={palette ? areaFill(i, palette) : null} />
                        {name} <span class="lre-muted lre-num">{grid.zones[name]?.length ?? 0}</span>
                      </span>
                    </Chip>
                  ))}
                </div>
              ) : (
                <span class="lre-small lre-muted">No zones yet: name one to paint it.</span>
              )}
              <form
                class="lre-form-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newZone.trim();
                  if (!name || name in grid.zones) return;
                  setGrid({ ...grid, zones: { ...grid.zones, [name]: [] } });
                  setZone(name);
                  setNewZone("");
                }}
              >
                <input class="lre-input" placeholder="New zone" aria-label="New zone" value={newZone} onInput={(event) => setNewZone(event.currentTarget.value.replace(/\s+/g, "_"))} />
                <Button type="submit" icon="plus" disabled={!newZone.trim() || newZone.trim() in grid.zones}>
                  Add zone
                </Button>
              </form>
            </div>
          ) : null}
          <GridCanvas grid={grid} marker={null} tool={brushTool} label={`Grid ${nameOfId(id)}, ${grid.width} by ${grid.height} cells`} />
          <span class="lre-small lre-muted">{HINT[tool]}</span>
        </div>
      </Section>
      <Disclosure summary="JSON (Advanced)">
        <FieldInput
          spec={{ kind: "json", key: "", label: "The grid as JSON", hint: "Terrain per cell row by row, blocked cells and zones by cell index. A change applies when you leave the box." }}
          value={grid as unknown as JsonValue}
          ctx={{ doc: props.world, lint: [], path: `grids.${id}`, identifiers: [], functions: [] }}
          path={`grids.${id}`}
          parent={{}}
          onChange={(next) => {
            const ok = isRecord(next) && typeof next.width === "number" && typeof next.height === "number" && Array.isArray(next.terrain) && next.terrain.length === next.width * next.height && Array.isArray(next.blocked) && isRecord(next.zones);
            if (!ok) return setJsonProblem("A grid needs its width and height, a terrain per cell (width × height of them), its blocked cells and its zones; the last grid is kept.");
            setJsonProblem(null);
            setHistory((h) => [...h.slice(-29), grid]);
            // The painter needs that shape to draw; the backend lints the rest, as it does every save.
            setGrid({ ...(next as unknown as GridDef), id });
          }}
        />
        {jsonProblem ? <Issues issues={[{ severity: "error", path: `grids.${id}`, code: "json", message: jsonProblem }]} /> : null}
      </Disclosure>
      <SaveBar>
        <Button variant="primary" disabled={(!changed && !isNew) || busy} onClick={save}>
          {isNew ? "Create grid" : "Save to draft"}
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setGrid(stored ? structuredClone(stored) : blank)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

/** Places: the schema form, plus tap-to-place on the parent place's grid; a place a map draws is edited in the map. */
export function PlaceEditor(props: EditorProps) {
  const app = useApp();
  const id = props.id?.startsWith("new:") ? null : props.id;
  const place = id ? props.world.places[id] : undefined;
  const parent = place?.parent ? props.world.places[place.parent] : undefined;
  const grid = parent?.grid ? props.world.grids[parent.grid] : undefined;
  const [busy, run] = useBusy();
  const onGrid =
    place && grid && !place.map ? (
      <Section title={`On ${parent?.name ?? "its parent"}'s grid`}>
        <div class="lre-stack" data-lre-place-grid={grid.id}>
          <GridCanvas
            grid={grid}
            marker={place.cell ?? null}
            label={`${parent?.name ?? "Parent"}'s grid`}
            height={280}
            tool={{
              tap: (p, t) => {
                const index = cellAt(cellView(t, gridUnit(grid)), grid, p);
                if (busy || !id || index === null) return;
                const cell = { x: index % grid.width, y: Math.floor(index / grid.width) };
                run(async () => {
                  const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "places", id, value: { ...place, cell } as unknown as JsonValue });
                  if (message.type === "lre.result") app.toast(`Placed at ${cell.x}, ${cell.y}.`, "info");
                });
              },
            }}
          />
          <span class="lre-small lre-muted">{place.cell ? `At cell ${place.cell.x}, ${place.cell.y}. Tap another cell to move it there.` : "Not on the grid yet: tap a cell to place it."}</span>
        </div>
      </Section>
    ) : null;
  return <SchemaEditor {...props}>{onGrid}</SchemaEditor>;
}
