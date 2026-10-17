// The map (DESIGN §12): places, routes and the grid on a canvas; pan, wheel and pinch zoom through
// Pointer Events (`frontend/map-math`); tap a place to see its exact travel options, tap one to
// move or drive (`lre.action` from the map). Rendered in the fullscreen float widget, or in the
// drawer when the drawer could not be closed.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Empty, JsonView, useBusy } from "../../../frontend/components";
import { formatCents, formatMinutes } from "../../../frontend/format";
import { fit, GestureTracker, hitTest, IDENTITY, toScreen, zoomAt } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { PanelProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import { controlBoxes, LABEL_PAD, labelAt, labelPadding, LINE, placeLabels, type PlacedLabel } from "./labels";
import { decodeMapView } from "./view";
import type { MapView } from "../core/view";

const MODE_ICON: Record<string, string> = { walk: "🚶", road: "🚗", offroad: "🛻", water: "⛵" };
const TERRAIN_COLOR: Record<string, string> = { road: "#3a3d48", grass: "#1f3326", water: "#1b2c44", building: "#3b2f2a", forest: "#18301f", sand: "#4a422c", rock: "#34343a" };

function boundsOf(view: MapView) {
  if (view.grid) return { minX: 0, minY: 0, maxX: view.grid.width, maxY: view.grid.height };
  if (view.places.length === 0) return { minX: 0, minY: 0, maxX: view.scope.width, maxY: view.scope.height };
  return {
    minX: Math.min(...view.places.map((p) => p.x)),
    minY: Math.min(...view.places.map((p) => p.y)),
    maxX: Math.max(...view.places.map((p) => p.x)),
    maxY: Math.max(...view.places.map((p) => p.y)),
  };
}

/** Paints the map and returns where the place names went (for taps on a name). */
function draw(canvas: HTMLCanvasElement, view: MapView, t: Transform, selected: string | null): PlacedLabel[] {
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
  if (view.grid) {
    const { grid } = view;
    const blocked = new Set(grid.blocked);
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = y * grid.width + x;
        const p = toScreen(t, { x, y });
        if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0) continue;
        g.fillStyle = blocked.has(index) ? "#0a0b0f" : TERRAIN_COLOR[grid.terrain[index] ?? ""] ?? "#1d2029";
        g.fillRect(p.x, p.y, Math.ceil(t.k), Math.ceil(t.k));
      }
    }
    if (grid.pov) {
      const p = toScreen(t, { x: grid.pov.x + 0.5, y: grid.pov.y + 0.5 });
      g.fillStyle = "#7c6cff";
      g.beginPath();
      g.arc(p.x, p.y, Math.max(5, t.k * 0.35), 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1;
    const step = 100 * t.k;
    if (step > 12) {
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
  }
  const byId = new Map(view.places.map((p) => [p.id, p]));
  for (const route of view.routes) {
    const a = byId.get(route.from);
    const b = byId.get(route.to);
    if (!a || !b) continue;
    const pa = toScreen(t, a);
    const pb = toScreen(t, b);
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
  for (const place of view.places) {
    const p = toScreen(t, place);
    const here = place.id === view.here;
    const isSelected = place.id === selected;
    g.globalAlpha = place.known ? 1 : 0.45;
    g.fillStyle = here ? "#7c6cff" : "#d8d8e4";
    g.beginPath();
    g.arc(p.x, p.y, here || isSelected ? 9 : 7, 0, Math.PI * 2);
    g.fill();
    if (here || isSelected) {
      g.strokeStyle = isSelected ? "#f2c46b" : "rgba(124,108,255,0.5)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, 15, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Names go where they don't collide (labels.ts): beside the dot, or further out on a leader line,
  // on two lines, or shortened with "…"; the place's card shows the full name on tap.
  const known = new Map(view.places.map((place) => [place.id, place.known]));
  const labels = placeLabels(
    view.places.map((place) => ({ id: place.id, ...toScreen(t, place), r: place.id === view.here || place.id === selected ? 16 : 8, text: place.known ? place.name : `${place.name}?` })),
    { width, height, measure: (s) => g.measureText(s).width, avoid: controlBoxes(width, height), first: [view.here, selected].filter((id): id is string => id !== null) },
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
    g.globalAlpha = known.get(label.id) === false ? 0.45 : 1;
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(label.box.x, label.box.y, label.box.w, label.box.h);
    g.fillStyle = "#f0f0f6";
    label.lines.forEach((line, i) => g.fillText(line, label.box.x + LABEL_PAD, label.box.y + 15 + i * LINE));
    g.globalAlpha = 1;
  }
  return labels;
}

/** Canvas-local layout px from a pointer event, correcting for host UI scale. */
function localPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.clientWidth / rect.width : 1;
  const sy = rect.height > 0 ? canvas.clientHeight / rect.height : 1;
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
}

export function MapPanel(props: PanelProps) {
  const view = useMemo(() => decodeMapView(props.view), [props.view]);
  if (!view) return props.view === undefined || props.view === null ? <Empty>No map for this world yet.</Empty> : <JsonView value={props.view} />;
  return <MapCanvas view={view} chatId={props.chatId} />;
}

function MapCanvas(props: { view: MapView; chatId: string }) {
  const app = useApp();
  const { view } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  const fitted = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [busy, run] = useBusy();
  const labels = useRef<PlacedLabel[]>([]);

  const refit = () => {
    const el = canvas.current;
    if (!el || el.clientWidth === 0) return;
    // Room around the places for their names (a ring of places gets names around its rim).
    const t = fit(boundsOf(view), el.clientWidth, el.clientHeight, view.grid ? 16 : labelPadding(el.clientWidth, el.clientHeight));
    tracker.current.transform = t;
    setTransform(t);
    fitted.current = true;
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!fitted.current) refit();
      else labels.current = draw(el, view, tracker.current.transform, selected);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    if (canvas.current) labels.current = draw(canvas.current, view, transform, selected);
  }, [view, transform, selected]);

  // A dot first (48 px across), then a name (at least 40 px tall).
  const placeAt = (p: Point): MapView["places"][number] | null => {
    const dot = view.grid
      ? hitTest(tracker.current.transform, view.places.map((place) => ({ ...place, x: place.x + 0.5, y: place.y + 0.5 })), p, 24)
      : hitTest(tracker.current.transform, view.places, p, 24);
    const id = dot?.id ?? labelAt(labels.current, p)?.id;
    return id ? (view.places.find((place) => place.id === id) ?? null) : null;
  };

  const onPointerDown = (event: PointerEvent) => {
    const el = canvas.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    tracker.current.down(event.pointerId, localPoint(el, event), event.timeStamp);
  };
  const onPointerMove = (event: PointerEvent) => {
    const el = canvas.current;
    if (!el) return;
    const before = tracker.current.transform;
    const after = tracker.current.move(event.pointerId, localPoint(el, event)).transform;
    if (after !== before) setTransform(after);
  };
  const onPointerUp = (event: PointerEvent) => {
    const el = canvas.current;
    if (!el) return;
    const result = tracker.current.up(event.pointerId, localPoint(el, event), event.timeStamp);
    if (result.tap) setSelected(placeAt(result.tap)?.id ?? null);
  };
  const onWheel = (event: WheelEvent) => {
    const el = canvas.current;
    if (!el) return;
    event.preventDefault();
    setTransform(tracker.current.wheel(localPoint(el, event), event.deltaY, event.deltaMode));
  };
  const zoom = (factor: number) => {
    const el = canvas.current;
    if (!el) return;
    const t = zoomAt(tracker.current.transform, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor);
    tracker.current.transform = t;
    setTransform(t);
  };

  const place = selected ? view.places.find((p) => p.id === selected) ?? null : null;
  const options = place ? view.travel.filter((t) => t.to === place.id) : [];
  return (
    <div class="lre-map" data-lre-map data-zoom={transform.k.toFixed(2)}>
      <canvas ref={canvas} data-lre-canvas="map" role="img" aria-label={`Map of ${view.scope.name}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={(event) => tracker.current.cancel(event.pointerId)} onWheel={onWheel} />
      <div class="zoom" style={place ? { display: "none" } : undefined}>
        <button type="button" class="lre-btn" aria-label="Zoom in" onClick={() => zoom(1.4)}>
          +
        </button>
        <button type="button" class="lre-btn" aria-label="Zoom out" onClick={() => zoom(1 / 1.4)}>
          −
        </button>
        <button type="button" class="lre-btn" aria-label="Fit map" onClick={refit}>
          ⤢
        </button>
      </div>
      {place ? (
        <div
          class="dock"
          data-lre-map-dock={place.id}
          role="group"
          aria-label={place.name}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setSelected(null);
          }}
        >
          <div class="lre-spread">
            <strong>{place.name}</strong>
            <button type="button" class="lre-btn small ghost" aria-label={`Close ${place.name}`} onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          {place.id === view.here ? <span class="lre-muted">You are here.</span> : null}
          {place.id !== view.here && options.length === 0 ? <span class="lre-muted">No route from here.</span> : null}
          {options.map((option) => (
            <button
              key={`${option.action}:${option.mode}:${option.vehicle ?? ""}`}
              type="button"
              class="lre-item"
              disabled={busy || option.disabled !== undefined}
              title={option.disabled}
              onClick={() =>
                run(async () => {
                  const result = await app.request(travelRequest(option.action, option.params, props.chatId));
                  if (result) {
                    setSelected(null);
                    app.overlays.closeMap();
                  }
                })
              }
            >
              <span aria-hidden="true">{MODE_ICON[option.mode] ?? "➜"}</span>
              <span class="grow">
                <span class="title">{option.label}</span>
                <span class="sub">{[option.disabled === undefined ? formatMinutes(option.minutes) : null, option.vehicle, option.disabled].filter((part) => part).join(" · ")}</span>
              </span>
              {option.cents !== undefined ? <span class="lre-num">{formatCents(option.cents)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
