// The map (DESIGN §12): one scope at a time, a place's own map with the places inside it, on a
// canvas; pan, wheel and pinch zoom through Pointer Events (`frontend/map-math`). Breadcrumbs lead
// out to the places around it, and a place with places inside it (or a grid) opens. Tap a place to
// see its exact travel options, tap one to move or drive (`lre.action` from the map). With the grid
// system on, tap a cell of the grid you stand on to walk there (`step`), or one with things lying
// in it to see them. Known shows what the POV knows, places only heard of dashed; Fog fogs what it
// hasn't seen; the choice is the chat's (`lre.map`), and the backend builds the view for it, so
// what the display hides never reaches the page. Rendered in the fullscreen float widget, or in
// the drawer when the drawer could not be closed.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { findPath, gridMinutes, type Cell } from "../../../shared/grid";
import type { MapDisplay } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Empty, JsonView, Seg, useBusy } from "../../../frontend/components";
import { formatCents, formatMinutes } from "../../../frontend/format";
import { fit, GestureTracker, hitTest, IDENTITY, toWorld, zoomAt } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { PanelProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import type { MapPlaceView, MapScopeView, MapView } from "../core/view";
import { labelAt, labelPadding, type PlacedLabel } from "./labels";
import { drawScope, placePoint, scopeBounds, unitOf } from "./map-draw";
import { decodeMapView } from "./view";

const MODE_ICON: Record<string, string> = { walk: "🚶", road: "🚗", offroad: "🛻", water: "⛵" };

const DISPLAYS = [
  { value: "knowledge", label: "Known", title: "What you know: places you've only heard of are dashed" },
  { value: "fog", label: "Fog", title: "Fog of war over what you haven't seen" },
] as const satisfies readonly { value: MapDisplay; label: string; title: string }[];

/** Canvas-local layout px from a pointer event, correcting for host UI scale. */
function localPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.clientWidth / rect.width : 1;
  const sy = rect.height > 0 ? canvas.clientHeight / rect.height : 1;
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
}

export interface MapStageProps {
  scope: MapScopeView;
  here: string | null;
  /** Places the POV is inside. */
  inside: ReadonlySet<string>;
  selected: string | null;
  onTap(place: MapPlaceView | null): void;
  /** A tap on a grid cell that hit no place; without it, such a tap is a tap on nothing. */
  onCell?(cell: Cell): void;
  /** A picked cell, outlined. */
  cell?: Cell | null;
  display: MapDisplay;
  /** Screen px along the top covered by bars over the map. */
  top: number;
  /** Hides the zoom buttons (while a card covers them). */
  hideZoom?: boolean;
}

/**
 * A scope on a pannable, zoomable canvas, fitted whenever the scope changes and on every resize
 * until the player pans or zooms: the stage opens at no size, or grows while its panel opens, and a
 * fit taken then would leave the map blank or in a corner. Play's map and Build's preview share it.
 */
export function MapStage(props: MapStageProps) {
  const { scope } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  // The player has panned or zoomed since the last fit, so a resize keeps their view.
  const moved = useRef(false);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const labels = useRef<PlacedLabel[]>([]);
  const options = { selected: props.selected, here: props.here, inside: props.inside, top: props.top, display: props.display, cell: props.cell ?? null };

  const refit = () => {
    const el = canvas.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    // Room around the places for their names (a ring of places gets names around its rim).
    const t = fit(scopeBounds(scope), el.clientWidth, el.clientHeight, scope.grid ? 16 : labelPadding(el.clientWidth, el.clientHeight));
    tracker.current.transform = t;
    setTransform(t);
    moved.current = false;
  };

  useEffect(() => {
    moved.current = false;
    refit();
  }, [scope.id, scope.frame.width, scope.frame.height]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!moved.current) refit();
      else labels.current = drawScope(el, scope, tracker.current.transform, options);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scope, props.selected, props.top, props.display, props.cell]);

  useEffect(() => {
    if (canvas.current) labels.current = drawScope(canvas.current, scope, transform, options);
  }, [scope, transform, props.selected, props.here, props.inside, props.top, props.display, props.cell]);

  // A dot first (48 px across), then a name (at least 40 px tall).
  const placeAt = (p: Point): MapPlaceView | null => {
    const dot = hitTest(
      tracker.current.transform,
      scope.places.map((place) => ({ id: place.id, ...placePoint(scope, place) })),
      p,
      24,
    );
    const id = dot?.id ?? labelAt(labels.current, p)?.id;
    return id ? (scope.places.find((place) => place.id === id) ?? null) : null;
  };

  // The grid cell under a screen point, or null off the grid.
  const cellAt = (p: Point): Cell | null => {
    const grid = scope.grid;
    if (!grid) return null;
    const w = toWorld(tracker.current.transform, p);
    const unit = unitOf(scope);
    const cell = { x: Math.floor(w.x / unit), y: Math.floor(w.y / unit) };
    return cell.x >= 0 && cell.y >= 0 && cell.x < grid.width && cell.y < grid.height ? cell : null;
  };

  const zoom = (factor: number) => {
    const el = canvas.current;
    if (!el) return;
    const t = zoomAt(tracker.current.transform, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor);
    tracker.current.transform = t;
    moved.current = true;
    setTransform(t);
  };

  return (
    <>
      <canvas
        ref={canvas}
        data-lre-canvas="map"
        data-zoom={transform.k.toFixed(2)}
        role="img"
        aria-label={`Map of ${scope.name}`}
        onPointerDown={(event) => {
          const el = canvas.current;
          if (!el) return;
          el.setPointerCapture(event.pointerId);
          tracker.current.down(event.pointerId, localPoint(el, event), event.timeStamp);
        }}
        onPointerMove={(event) => {
          const el = canvas.current;
          if (!el) return;
          const before = tracker.current.transform;
          const after = tracker.current.move(event.pointerId, localPoint(el, event)).transform;
          if (after === before) return;
          moved.current = true;
          setTransform(after);
        }}
        onPointerUp={(event) => {
          const el = canvas.current;
          if (!el) return;
          const result = tracker.current.up(event.pointerId, localPoint(el, event), event.timeStamp);
          if (!result.tap) return;
          const place = placeAt(result.tap);
          const cell = place || !props.onCell ? null : cellAt(result.tap);
          if (cell && props.onCell) props.onCell(cell);
          else props.onTap(place);
        }}
        onPointerCancel={(event) => tracker.current.cancel(event.pointerId)}
        onWheel={(event) => {
          const el = canvas.current;
          if (!el) return;
          event.preventDefault();
          moved.current = true;
          setTransform(tracker.current.wheel(localPoint(el, event), event.deltaY, event.deltaMode));
        }}
      />
      <div class="zoom" style={props.hideZoom ? { display: "none" } : undefined}>
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
    </>
  );
}

export function MapPanel(props: PanelProps) {
  const view = useMemo(() => decodeMapView(props.view), [props.view]);
  if (!view) return props.view === undefined || props.view === null ? <Empty>No map for this world yet.</Empty> : <JsonView value={props.view} />;
  if (view.scopes.length === 0) return <Empty>No places on the map yet.</Empty>;
  return <MapCanvas view={view} chatId={props.chatId} />;
}

/** Walking to a cell from the POV's, as the step action will judge it: its minutes, or why not. */
function walkPlan(grid: NonNullable<MapScopeView["grid"]>, from: Cell, to: Cell): { minutes: number; disabled?: string } {
  if (from.x === to.x && from.y === to.y) return { minutes: 0, disabled: "You're here." };
  const path = findPath(grid, from, to);
  return path ? { minutes: gridMinutes(grid, path) } : { minutes: 0, disabled: "No way there from here." };
}

function MapCanvas(props: { view: MapView; chatId: string }) {
  const app = useApp();
  const { view } = props;
  // The scope the player opened; it follows the POV when the POV's own scope changes.
  const [opened, setOpened] = useState<string | null>(view.scope);
  const [selected, setSelected] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [busy, run] = useBusy();
  const crumbs = useRef<HTMLElement>(null);
  const [top, setTop] = useState(52);
  useEffect(() => {
    setOpened(view.scope);
    setSelected(null);
    setCell(null);
  }, [view.scope]);
  const scope = view.scopes.find((s) => s.id === opened) ?? view.scopes.find((s) => s.id === view.scope) ?? view.scopes[0];
  const inside = useMemo(() => new Set(view.path), [view.path.join("\u0000")]);
  // Labels keep clear of the breadcrumbs, wherever the bars above the map put them.
  useEffect(() => {
    const el = crumbs.current;
    if (el) setTop(Math.max(52, el.offsetTop + el.offsetHeight + 4));
  });
  useEffect(() => {
    const el = crumbs.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [scope?.id]);
  if (!scope) return <Empty>No places on the map yet.</Empty>;
  const display = view.display;
  const grid = scope.grid;
  // With the grid system on, the grid the POV stands on is walked: a tapped cell is somewhere to go.
  const walkable = view.movement && grid?.pov !== undefined;
  const lying = (c: Cell | null) => (c && grid?.items ? grid.items.filter((i) => i.x === c.x && i.y === c.y) : []);
  const things = lying(cell);
  const walk = cell && walkable && grid?.pov ? walkPlan(grid, grid.pov, cell) : null;
  const open = (id: string | null) => {
    setOpened(id);
    setSelected(null);
    setCell(null);
  };
  const place = selected ? (scope.places.find((p) => p.id === selected) ?? null) : null;
  const options = place ? view.travel.filter((t) => t.to === place.id) : [];
  const opens = place !== null && view.scopes.some((s) => s.id === place.id);
  const dockKeys = (close: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };
  return (
    <div class="lre-map" data-lre-map data-lre-map-scope={scope.id ?? ""} data-lre-map-display={display}>
      <MapStage
        scope={scope}
        here={view.here}
        inside={inside}
        selected={selected}
        onTap={(p) => {
          setSelected(p?.id ?? null);
          setCell(null);
        }}
        onCell={
          grid
            ? (c) => {
                setSelected(null);
                setCell(walkable || lying(c).length > 0 ? c : null);
              }
            : undefined
        }
        cell={cell}
        display={display}
        top={top}
        hideZoom={place !== null || cell !== null}
      />
      <nav class="crumbs" ref={crumbs} aria-label="Map levels">
        {scope.trail.map((crumb) => (
          <span key={crumb.id ?? ""} class="crumb">
            <button type="button" class="lre-btn small" onClick={() => open(crumb.id)}>
              {crumb.name}
            </button>
            <span aria-hidden="true">›</span>
          </span>
        ))}
        <span class="crumb current" aria-current="page">
          {scope.name}
          {scope.id !== null && scope.id === view.here ? <span class="lre-muted"> · you are here</span> : null}
        </span>
      </nav>
      {place === null && cell === null ? (
        <div class="mode">
          <Seg<MapDisplay> label="The map shows" value={display} options={DISPLAYS} disabled={busy} onChange={(next) => run(() => app.request({ type: "lre.map", chatId: props.chatId, display: next }))} />
        </div>
      ) : null}
      {cell ? (
        <div class="dock" data-lre-map-cell={`${cell.x},${cell.y}`} role="group" aria-label={things.length > 0 ? things.map((t) => t.name).join(", ") : "This spot"} onKeyDown={dockKeys(() => setCell(null))}>
          <div class="lre-spread">
            <strong>{things.length > 0 ? things.map((t) => t.name).join(", ") : "This spot"}</strong>
            <button type="button" class="lre-btn small ghost" aria-label="Close" onClick={() => setCell(null)}>
              ✕
            </button>
          </div>
          {things.length > 0 ? <span class="lre-muted">{things.length === 1 ? "It lies here." : "They lie here."}</span> : null}
          {walk ? (
            <button
              type="button"
              class="lre-item"
              data-lre-map-walk
              disabled={busy || walk.disabled !== undefined}
              title={walk.disabled}
              onClick={() =>
                run(async () => {
                  const result = await app.request(travelRequest("step", { x: cell.x, y: cell.y }, props.chatId));
                  if (result) {
                    setCell(null);
                    app.overlays.closeMap();
                  }
                })
              }
            >
              <span aria-hidden="true">{MODE_ICON.walk}</span>
              <span class="grow">
                <span class="title">Walk here</span>
                <span class="sub">{walk.disabled ?? formatMinutes(walk.minutes)}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      {place ? (
        <div class="dock" data-lre-map-dock={place.id} role="group" aria-label={place.name} onKeyDown={dockKeys(() => setSelected(null))}>
          <div class="lre-spread">
            <strong>{place.name}</strong>
            <button type="button" class="lre-btn small ghost" aria-label={`Close ${place.name}`} onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          {place.id === view.here ? <span class="lre-muted">You are here.</span> : null}
          {place.id !== view.here && inside.has(place.id) ? <span class="lre-muted">You're inside.</span> : null}
          {place.id !== view.here && !inside.has(place.id) && place.known && !place.visited ? <span class="lre-muted">You've heard of it, but you haven't been there.</span> : null}
          {opens ? (
            <button type="button" class="lre-item" onClick={() => open(place.id)} data-lre-map-open={place.id}>
              <span aria-hidden="true">🔍</span>
              <span class="grow">
                <span class="title">Open {place.name}</span>
                <span class="sub">See the places inside</span>
              </span>
            </button>
          ) : null}
          {!inside.has(place.id) && options.length === 0 ? <span class="lre-muted">No route from here.</span> : null}
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
