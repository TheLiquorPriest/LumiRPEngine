// The map (DESIGN §12): one scope at a time, a place's own map with the places inside it, on a
// canvas; pan, wheel and pinch zoom through Pointer Events (`frontend/map-math`). Breadcrumbs lead
// out to the places around it, and a place with places inside it (or a grid) opens. Tap a place to
// see its exact travel options, tap one to move or drive (`lre.action` from the map). Rendered in
// the fullscreen float widget, or in the drawer when the drawer could not be closed.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Empty, JsonView, useBusy } from "../../../frontend/components";
import { formatCents, formatMinutes } from "../../../frontend/format";
import { fit, GestureTracker, hitTest, IDENTITY, zoomAt } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { PanelProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import type { MapPlaceView, MapScopeView, MapView } from "../core/view";
import { labelAt, labelPadding, type PlacedLabel } from "./labels";
import { drawScope, placePoint, scopeBounds } from "./map-draw";
import { decodeMapView } from "./view";

const MODE_ICON: Record<string, string> = { walk: "🚶", road: "🚗", offroad: "🛻", water: "⛵" };

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
  /** Screen px along the top covered by bars over the map. */
  top: number;
  /** Hides the zoom buttons (while a card covers them). */
  hideZoom?: boolean;
}

/** A scope on a pannable, zoomable canvas, fitted again whenever the scope changes. Play's map and Build's preview share it. */
export function MapStage(props: MapStageProps) {
  const { scope } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  const fitted = useRef(false);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const labels = useRef<PlacedLabel[]>([]);
  const options = { selected: props.selected, here: props.here, inside: props.inside, top: props.top };

  const refit = () => {
    const el = canvas.current;
    if (!el || el.clientWidth === 0) return;
    // Room around the places for their names (a ring of places gets names around its rim).
    const t = fit(scopeBounds(scope), el.clientWidth, el.clientHeight, scope.grid ? 16 : labelPadding(el.clientWidth, el.clientHeight));
    tracker.current.transform = t;
    setTransform(t);
    fitted.current = true;
  };

  useEffect(() => {
    fitted.current = false;
    refit();
  }, [scope.id, scope.frame.width, scope.frame.height]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!fitted.current) refit();
      else labels.current = drawScope(el, scope, tracker.current.transform, options);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scope, props.selected, props.top]);

  useEffect(() => {
    if (canvas.current) labels.current = drawScope(canvas.current, scope, transform, options);
  }, [scope, transform, props.selected, props.here, props.inside, props.top]);

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

  const zoom = (factor: number) => {
    const el = canvas.current;
    if (!el) return;
    const t = zoomAt(tracker.current.transform, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, factor);
    tracker.current.transform = t;
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
          if (after !== before) setTransform(after);
        }}
        onPointerUp={(event) => {
          const el = canvas.current;
          if (!el) return;
          const result = tracker.current.up(event.pointerId, localPoint(el, event), event.timeStamp);
          if (result.tap) props.onTap(placeAt(result.tap));
        }}
        onPointerCancel={(event) => tracker.current.cancel(event.pointerId)}
        onWheel={(event) => {
          const el = canvas.current;
          if (!el) return;
          event.preventDefault();
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

function MapCanvas(props: { view: MapView; chatId: string }) {
  const app = useApp();
  const { view } = props;
  // The scope the player opened; it follows the POV when the POV's own scope changes.
  const [opened, setOpened] = useState<string | null>(view.scope);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const crumbs = useRef<HTMLElement>(null);
  const [top, setTop] = useState(52);
  useEffect(() => {
    setOpened(view.scope);
    setSelected(null);
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
  const open = (id: string | null) => {
    setOpened(id);
    setSelected(null);
  };
  const place = selected ? (scope.places.find((p) => p.id === selected) ?? null) : null;
  const options = place ? view.travel.filter((t) => t.to === place.id) : [];
  const opens = place !== null && view.scopes.some((s) => s.id === place.id);
  return (
    <div class="lre-map" data-lre-map data-lre-map-scope={scope.id ?? ""}>
      <MapStage scope={scope} here={view.here} inside={inside} selected={selected} onTap={(p) => setSelected(p?.id ?? null)} top={top} hideZoom={place !== null} />
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
          {place.id !== view.here && inside.has(place.id) ? <span class="lre-muted">You're inside.</span> : null}
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
