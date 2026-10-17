// The map/grid special widget (DESIGN §13): paint terrain, blocked cells and zones on a grid with
// pan and pinch zoom; and the place editor, which adds tap-to-place on the parent's grid to the
// schema form.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../../../shared/json";
import type { GridDef } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { MapOwned, SchemaEditor } from "../../../frontend/build/build";
import { Seg, useBusy } from "../../../frontend/components";
import { fit, GestureTracker, IDENTITY, toScreen, toWorld } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { EditorProps } from "../../../frontend/registry";

const TERRAINS = ["grass", "road", "building", "water", "forest", "sand", "rock"];
const TERRAIN_COLOR: Record<string, string> = { road: "#3a3d48", grass: "#1f3326", water: "#1b2c44", building: "#3b2f2a", forest: "#18301f", sand: "#4a422c", rock: "#34343a" };
const ZONE_COLORS = ["rgba(124,108,255,0.45)", "rgba(242,196,107,0.45)", "rgba(127,224,160,0.45)", "rgba(255,138,138,0.45)", "rgba(107,197,242,0.45)"];

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

/** World units per grid cell: keeps a whole grid inside the shared zoom range (map-math clamps k to 0.25–4). */
const CELL = 32;

/** The view transform in screen px per cell. */
function cellPx(t: Transform): Transform {
  return { ...t, k: t.k * CELL };
}

/** The cell index under a screen point, or null outside the grid. */
export function cellAt(t: Transform, grid: Pick<GridDef, "width" | "height">, screen: Point): number | null {
  const w = toWorld(t, screen);
  const x = Math.floor(w.x);
  const y = Math.floor(w.y);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? y * grid.width + x : null;
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

function drawGrid(canvas: HTMLCanvasElement, grid: GridDef, view: Transform, marker: Point | null): void {
  const t = cellPx(view);
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0e1015";
  g.fillRect(0, 0, width, height);
  const blocked = new Set(grid.blocked);
  const zoneOf = new Map<number, number>();
  Object.values(grid.zones).forEach((cells, i) => cells.forEach((cell) => zoneOf.set(cell, i)));
  const size = Math.ceil(t.k);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const p = toScreen(t, { x, y });
      if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0) continue;
      const index = y * grid.width + x;
      g.fillStyle = TERRAIN_COLOR[grid.terrain[index] ?? ""] ?? "#26293a";
      g.fillRect(p.x, p.y, size, size);
      const zone = zoneOf.get(index);
      if (zone !== undefined) {
        g.fillStyle = ZONE_COLORS[zone % ZONE_COLORS.length] ?? "rgba(255,255,255,0.3)";
        g.fillRect(p.x, p.y, size, size);
      }
      if (blocked.has(index)) {
        g.strokeStyle = "rgba(255,138,138,0.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p.x + 2, p.y + 2);
        g.lineTo(p.x + t.k - 2, p.y + t.k - 2);
        g.moveTo(p.x + t.k - 2, p.y + 2);
        g.lineTo(p.x + 2, p.y + t.k - 2);
        g.stroke();
      }
      if (t.k >= 10) {
        g.strokeStyle = "rgba(0,0,0,0.35)";
        g.lineWidth = 1;
        g.strokeRect(p.x + 0.5, p.y + 0.5, t.k, t.k);
      }
    }
  }
  if (marker) {
    const p = toScreen(t, { x: marker.x + 0.5, y: marker.y + 0.5 });
    g.fillStyle = "#f2c46b";
    g.beginPath();
    g.arc(p.x, p.y, Math.max(5, t.k * 0.35), 0, Math.PI * 2);
    g.fill();
  }
}

function local(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (rect.width > 0 ? canvas.clientWidth / rect.width : 1), y: (event.clientY - rect.top) * (rect.height > 0 ? canvas.clientHeight / rect.height : 1) };
}

/** A pannable, zoomable grid canvas; in a paint tool a single finger paints and two fingers still pinch. */
function GridCanvas(props: { grid: GridDef; tool: Tool; marker: Point | null; onCell(index: number, first: boolean): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  const pointers = useRef(new Set<number>());
  const painting = useRef<number | null>(null);
  const [t, setT] = useState<Transform>(IDENTITY);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // Fit once the canvas has its laid-out size (it can mount at 0 × 0 inside a sliding drawer).
    const refit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const next = fit({ minX: 0, minY: 0, maxX: props.grid.width * CELL, maxY: props.grid.height * CELL }, el.clientWidth, el.clientHeight, 8);
      tracker.current.transform = next;
      setT(next);
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [props.grid.width, props.grid.height]);
  useEffect(() => {
    if (canvas.current) drawGrid(canvas.current, props.grid, t, props.marker);
  }, [props.grid, t, props.marker]);
  const paintAt = (event: PointerEvent, first: boolean) => {
    const el = canvas.current;
    if (!el) return;
    const cell = cellAt(cellPx(tracker.current.transform), props.grid, local(el, event));
    if (cell !== null && cell !== painting.current) {
      painting.current = cell;
      props.onCell(cell, first);
    }
  };
  return (
    <div class="lre-grid-editor">
      <canvas
        ref={canvas}
        role="img"
        aria-label="Grid"
        onPointerDown={(event) => {
          const el = canvas.current;
          if (!el) return;
          el.setPointerCapture(event.pointerId);
          pointers.current.add(event.pointerId);
          tracker.current.down(event.pointerId, local(el, event), event.timeStamp);
          if (props.tool !== "pan" && pointers.current.size === 1) {
            painting.current = null;
            paintAt(event, true);
          }
        }}
        onPointerMove={(event) => {
          const el = canvas.current;
          if (!el || !pointers.current.has(event.pointerId)) return;
          if (props.tool !== "pan" && pointers.current.size === 1) paintAt(event, false);
          else setT(tracker.current.move(event.pointerId, local(el, event)).transform);
        }}
        onPointerUp={(event) => {
          const el = canvas.current;
          pointers.current.delete(event.pointerId);
          if (el) {
            const result = tracker.current.up(event.pointerId, local(el, event), event.timeStamp);
            if (props.tool === "pan" && result.tap) {
              const cell = cellAt(cellPx(tracker.current.transform), props.grid, result.tap);
              if (cell !== null) props.onCell(cell, true);
            }
          }
          painting.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          tracker.current.cancel(event.pointerId);
          painting.current = null;
        }}
        onWheel={(event) => {
          const el = canvas.current;
          if (!el) return;
          event.preventDefault();
          setT(tracker.current.wheel(local(el, event), event.deltaY, event.deltaMode));
        }}
      />
    </div>
  );
}

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
  const adding = useRef(true);
  const [busy, run] = useBusy();
  useEffect(() => setGrid(stored ? structuredClone(stored) : blank), [JSON.stringify(stored)]);
  if (!id) return <SchemaEditor {...props} />;
  if (stored?.map) return <MapOwned worldId={props.world.id} collection="grids" id={id} value={stored} map={stored.map} />;
  const changed = JSON.stringify(grid) !== JSON.stringify(stored ?? null);
  const palette = [...new Set([...TERRAINS, ...grid.terrain])];
  return (
    <div class="lre-stack" data-lre-editor="grids">
      <div class="lre-h2">
        <code>{id}</code> · {grid.width}×{grid.height}
      </div>
      <div class="lre-inline">
        <label class="lre-field" style={{ width: "88px" }}>
          <span class="label">Width</span>
          <input class="lre-input" inputMode="numeric" value={String(grid.width)} onChange={(event) => setGrid(resizeGrid(grid, Math.max(1, Math.min(256, Number(event.currentTarget.value) || 1)), grid.height, brush))} />
        </label>
        <label class="lre-field" style={{ width: "88px" }}>
          <span class="label">Height</span>
          <input class="lre-input" inputMode="numeric" value={String(grid.height)} onChange={(event) => setGrid(resizeGrid(grid, grid.width, Math.max(1, Math.min(256, Number(event.currentTarget.value) || 1)), brush))} />
        </label>
        <label class="lre-field" style={{ width: "100px" }}>
          <span class="label">Cell (m)</span>
          <input class="lre-input" inputMode="decimal" value={grid.cellMeters !== undefined ? String(grid.cellMeters) : ""} onChange={(event) => setGrid({ ...grid, cellMeters: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
        </label>
      </div>
      <Seg<Tool>
        label="Tool"
        value={tool}
        options={[
          { value: "pan", label: "Pan" },
          { value: "paint", label: "Terrain" },
          { value: "block", label: "Blocked" },
          { value: "zone", label: "Zone" },
        ]}
        onChange={(next) => setTool(next)}
      />
      {tool === "paint" ? (
        <div class="lre-inline">
          {palette.map((terrain) => (
            <button key={terrain} type="button" class={terrain === brush ? "lre-btn small primary" : "lre-btn small"} aria-pressed={terrain === brush} onClick={() => setBrush(terrain)}>
              <span aria-hidden="true" style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: TERRAIN_COLOR[terrain] ?? "#26293a", border: "1px solid rgba(255,255,255,.3)" }} /> {terrain}
            </button>
          ))}
        </div>
      ) : null}
      {tool === "zone" ? (
        <div class="lre-inline">
          {Object.keys(grid.zones).map((name, i) => (
            <button key={name} type="button" class={name === zone ? "lre-btn small primary" : "lre-btn small"} aria-pressed={name === zone} onClick={() => setZone(name)}>
              <span aria-hidden="true" style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: ZONE_COLORS[i % ZONE_COLORS.length] }} /> {name} ({grid.zones[name]?.length ?? 0})
            </button>
          ))}
          <form
            class="lre-inline"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newZone.trim();
              if (!name || name in grid.zones) return;
              setGrid({ ...grid, zones: { ...grid.zones, [name]: [] } });
              setZone(name);
              setNewZone("");
            }}
          >
            <input class="lre-input" style={{ width: "120px" }} placeholder="New zone" aria-label="New zone" value={newZone} onInput={(event) => setNewZone(event.currentTarget.value.replace(/\s+/g, "_"))} />
            <button type="submit" class="lre-btn small" aria-label="Add zone">
              +
            </button>
          </form>
        </div>
      ) : null}
      <GridCanvas
        grid={grid}
        tool={tool}
        marker={null}
        onCell={(index, first) => {
          if (tool === "pan") return;
          if (first) adding.current = tool === "block" ? !grid.blocked.includes(index) : tool === "zone" ? !(grid.zones[zone] ?? []).includes(index) : true;
          setGrid((current) => paintCell(current, index, tool, brush, zone, adding.current));
        }}
      />
      <span class="lre-small lre-muted">{tool === "pan" ? "Drag to pan, pinch or scroll to zoom." : "Drag to paint; two fingers pan and zoom."}</span>
      <div class="lre-inline">
        <button
          type="button"
          class="lre-btn primary"
          disabled={(!changed && !isNew) || busy}
          onClick={() =>
            run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "grids", id, value: { ...grid, id } as unknown as JsonValue });
              if (message.type === "lre.result" && isNew) app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "grids", id } }));
            })
          }
        >
          {isNew ? "Create grid" : "Save to draft"}
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setGrid(stored ? structuredClone(stored) : blank)}>
          Revert
        </button>
      </div>
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
  return (
    <div class="lre-stack">
      <SchemaEditor {...props} />
      {place && grid && !place.map ? (
        <section class="lre-card">
          <div class="lre-h">Position on {parent?.name ?? "parent"}'s grid</div>
          <GridCanvas
            grid={grid}
            tool="pan"
            marker={place.cell ?? null}
            onCell={(index) => {
              if (busy || !id) return;
              const cell = { x: index % grid.width, y: Math.floor(index / grid.width) };
              run(async () => {
                const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "places", id, value: { ...place, cell } as unknown as JsonValue });
                if (message.type === "lre.result") app.toast(`Placed at ${cell.x}, ${cell.y}.`, "info");
              });
            }}
          />
          <span class="lre-small lre-muted">Tap a cell to place it.</span>
        </section>
      ) : null}
    </div>
  );
}
