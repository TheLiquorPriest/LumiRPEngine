// The map (DESIGN §12): one scope at a time, a place's own map with the places inside it, on a
// canvas drawn in the theme's canvas colours; pan, wheel and pinch zoom through Pointer Events
// (`frontend/map-math`). Breadcrumbs lead out to the places around it. In the drawer (Play →
// Places) a tapped place opens its place sheet (place.tsx); in the map overlay, which has no sheet
// stack, the same details dock over the map. With the grid system on, tap a cell of the grid you
// stand on to walk there (`step`), or one with things lying in it to see them. Known shows what
// the POV knows, places only heard of dashed; Fog fogs what it hasn't seen; the choice is the
// chat's (`lre.map`), and the backend builds the view for it, so what the display hides never
// reaches the page. A list gives the scope's known places; Full screen opens the map overlay.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Cell } from "../../../shared/grid";
import type { MapDisplay } from "../../../shared/world";
import { pushSheet, useApp } from "../../../frontend/app";
import { Empty, IconButton, JsonView, List, ListRow, Section, Seg, useBusy } from "../../../frontend/components";
import { formatMinutes } from "../../../frontend/format";
import { Icon } from "../../../frontend/icons";
import { fit, GestureTracker, hitTest, IDENTITY, toWorld, zoomAt } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { PanelProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import { useSelect } from "../../../frontend/store";
import type { MapPlaceView, MapScopeView, MapView } from "../core/view";
import { useThemeVersion } from "./canvas-theme";
import { labelAt, labelPadding, type PlacedLabel } from "./labels";
import { drawScope, placePoint, scopeBounds, unitOf } from "./map-draw";
import { mapFocus, MODE_ICON, PlaceDetail, placeStatus } from "./place";
import { decodeMapView } from "./view";

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
  /** Called with the transform after every draw, so something laid over the map can follow it. */
  onView?(t: Transform): void;
}

/**
 * A scope on a pannable, zoomable canvas, fitted whenever the scope changes and on every resize
 * until the player pans or zooms: the stage opens at no size, or grows while its panel opens, and a
 * fit taken then would leave the map blank or in a corner. It redraws when the host theme changes.
 * Play's map and Build's preview share it.
 */
export function MapStage(props: MapStageProps) {
  const { scope } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef(new GestureTracker(IDENTITY));
  // The player has panned or zoomed since the last fit, so a resize keeps their view.
  const moved = useRef(false);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const labels = useRef<PlacedLabel[]>([]);
  const theme = useThemeVersion();
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
  const paint = (t: Transform) => {
    const el = canvas.current;
    if (!el) return;
    labels.current = drawScope(el, scope, t, options);
    props.onView?.(t);
  };
  // The resize observer outlives renders; it reaches this render's fit and paint through here.
  const latest = useRef({ refit, paint });
  latest.current = { refit, paint };

  useEffect(() => {
    moved.current = false;
    refit();
  }, [scope.id, scope.frame.width, scope.frame.height]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!moved.current) latest.current.refit();
      else latest.current.paint(tracker.current.transform);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => paint(transform), [scope, transform, props.selected, props.here, props.inside, props.top, props.display, props.cell, theme]);

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
      <div class="lre-world-zoom" hidden={props.hideZoom}>
        <IconButton icon="plus" label="Zoom in" variant="secondary" onClick={() => zoom(1.4)} />
        <IconButton icon="minus" label="Zoom out" variant="secondary" onClick={() => zoom(1 / 1.4)} />
        <IconButton icon="home" label="Fit map" variant="secondary" onClick={refit} />
      </div>
    </>
  );
}

export function MapPanel(props: PanelProps) {
  const view = useMemo(() => decodeMapView(props.view), [props.view]);
  if (!view) return props.view === undefined || props.view === null ? <Empty icon="map">No map for this world yet.</Empty> : <JsonView value={props.view} />;
  if (view.scopes.length === 0) return <Empty icon="map">No places on the map yet.</Empty>;
  return <MapCanvas view={view} chatId={props.chatId} />;
}

/** The newest place-sheet request any map has taken: a map opened later doesn't take an old one again. */
let takenFocus = 0;

/** The scope's known places as a list: where the POV is first, then by name, each with its quickest way there. */
function PlaceList(props: { view: MapView; scope: MapScopeView; top: number; onPick(place: MapPlaceView): void }) {
  const { view, scope } = props;
  const rank = (p: MapPlaceView): number => (p.id === view.here ? 0 : view.path.includes(p.id) ? 1 : 2);
  const places = scope.places.filter((p) => p.known).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return (
    <div class="lre-world-maplist" style={{ top: `${props.top}px` }} data-lre-map-list>
      <Section title={`Places in ${scope.name}`} flush>
        {places.length === 0 ? (
          <Empty icon="map">You don't know any places here yet.</Empty>
        ) : (
          <List>
            {places.map((p) => {
              const status = placeStatus(view, p);
              const ways = view.travel.filter((t) => t.to === p.id && t.disabled === undefined).map((t) => t.minutes);
              return <ListRow key={p.id} id={p.id} icon={status.icon} title={p.name} subtitle={status.short} value={ways.length > 0 ? formatMinutes(Math.min(...ways)) : undefined} valueTone="muted" chevron onClick={() => props.onPick(p)} />;
            })}
          </List>
        )}
      </Section>
    </div>
  );
}

function MapCanvas(props: { view: MapView; chatId: string }) {
  const app = useApp();
  const { view } = props;
  // The scope the player opened; it follows the POV when the POV's own scope changes.
  const [opened, setOpened] = useState<string | null>(view.scope);
  const [selected, setSelected] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [listing, setListing] = useState(false);
  const [busy, run] = useBusy();
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const crumbs = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(52);
  // In the map overlay there's no sheet stack: a place's details dock over the map, and the overlay
  // frame has its own full screen and close. Known before the first effects run.
  const overlayRef = useRef(false);
  const [overlay, setOverlay] = useState(false);
  useLayoutEffect(() => {
    overlayRef.current = root.current?.closest("[data-lre-overlay]") != null;
    setOverlay(overlayRef.current);
  }, []);
  useEffect(() => {
    setOpened(view.scope);
    setSelected(null);
    setCell(null);
  }, [view.scope]);
  // A place sheet's "Open" or "Show on the map": the sheet is the drawer's, so the drawer's map takes it.
  const focus = useSelect(mapFocus, (f) => f);
  useEffect(() => {
    if (!focus || overlayRef.current || focus.n <= takenFocus || focus.chatId !== props.chatId) return;
    takenFocus = focus.n;
    setOpened(focus.scope);
    setSelected(focus.place);
    setCell(null);
    setListing(false);
  }, [focus?.n]);
  const scope = view.scopes.find((s) => s.id === opened) ?? view.scopes.find((s) => s.id === view.scope) ?? view.scopes[0];
  const inside = useMemo(() => new Set(view.path), [view.path.join("\u0000")]);
  // Labels keep clear of the bar of breadcrumbs, wherever the bars above the map put it.
  useEffect(() => {
    const el = bar.current;
    if (el) setTop(Math.max(52, el.offsetTop + el.offsetHeight + 4));
  });
  useEffect(() => {
    const el = crumbs.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [scope?.id]);
  const grid = scope?.grid;
  // With the grid system on, the grid the POV stands on is walked: a tapped cell is somewhere to go.
  const walkable = view.movement && grid?.pov !== undefined;
  const pov = grid?.pov;
  // Walk here's way and minutes come from the backend, judged on the real ground as the step will
  // be: this grid is cut to the display, and under fog it lacks the walls the POV hasn't seen.
  const [walk, setWalk] = useState<{ minutes: number; disabled?: string } | null>(null);
  useEffect(() => {
    setWalk(null);
    if (!cell || !walkable || !pov) return;
    if (cell.x === pov.x && cell.y === pov.y) {
      setWalk({ minutes: 0, disabled: "You're here." });
      return;
    }
    let live = true;
    const unknown = { minutes: 0, disabled: "No way there from here." };
    app.request({ type: "lre.map", op: "walk", chatId: props.chatId, x: cell.x, y: cell.y }).then(
      (result) => {
        if (live) setWalk(result?.walk ?? unknown);
      },
      () => {
        if (live) setWalk(unknown);
      },
    );
    return () => {
      live = false;
    };
  }, [cell?.x, cell?.y, walkable, pov?.x, pov?.y, props.chatId]);
  // A dock that opens takes focus, so Escape closes it before the overlay and assistive tech lands on it.
  const dockKey = cell ? `cell:${cell.x},${cell.y}` : selected !== null && (overlay || !app.catalog.sheets.has("place")) ? `place:${selected}` : null;
  useEffect(() => {
    if (dockKey !== null) dock.current?.focus({ preventScroll: true });
  }, [dockKey]);
  if (!scope) return <Empty icon="map">No places on the map yet.</Empty>;
  const display = view.display;
  const lying = (c: Cell | null) => (c && grid?.items ? grid.items.filter((i) => i.x === c.x && i.y === c.y) : []);
  const things = lying(cell);
  const open = (id: string | null) => {
    setOpened(id);
    setSelected(null);
    setCell(null);
  };
  const place = selected ? (scope.places.find((p) => p.id === selected) ?? null) : null;
  // A place's details: its sheet in the drawer, a dock over the map in the overlay.
  const docked = overlay || !app.catalog.sheets.has("place");
  const dockedPlace = docked ? place : null;
  const pick = (p: MapPlaceView | null) => {
    setSelected(p?.id ?? null);
    setCell(null);
    if (p && !docked) app.ui.update((ui) => pushSheet(ui, { kind: "place", id: p.id }));
  };
  const dockKeys = (close: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    // Back to the overlay, so the next Escape closes it.
    root.current?.closest<HTMLElement>("[data-lre-overlay]")?.focus({ preventScroll: true });
  };
  const cellTitle = things.length > 0 ? things.map((t) => t.name).join(", ") : "This spot";
  return (
    <div ref={root} class={overlay ? "lre-map lre-world-map in-overlay" : "lre-map lre-world-map"} data-lre-map data-lre-map-scope={scope.id ?? ""} data-lre-map-display={display}>
      <MapStage
        scope={scope}
        here={view.here}
        inside={inside}
        selected={selected}
        onTap={pick}
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
        hideZoom={listing || dockedPlace !== null || cell !== null}
      />
      <div class="lre-world-mapbar" ref={bar}>
        <nav class="lre-world-crumbs" ref={crumbs} aria-label="Map levels">
          {scope.trail.map((crumb) => (
            <span key={crumb.id ?? ""} class="lre-world-crumb">
              <button type="button" class="lre-world-pill" onClick={() => open(crumb.id)}>
                {crumb.name}
              </button>
              <Icon name="chevron-right" size={16} class="lre-world-crumb-sep" />
            </span>
          ))}
          <span class="lre-world-pill current" aria-current="page">
            {scope.name}
            {scope.id !== null && scope.id === view.here ? <span class="lre-world-pill-note"> · you are here</span> : null}
          </span>
        </nav>
        <IconButton icon="list" label="List of places" variant="secondary" pressed={listing} onClick={() => setListing(!listing)} />
        {!overlay ? <IconButton icon="expand" label="Full screen" variant="secondary" onClick={() => void app.overlays.openMap()} /> : null}
      </div>
      {listing ? (
        <PlaceList
          view={view}
          scope={scope}
          top={top}
          onPick={(p) => {
            if (docked) setListing(false);
            pick(p);
          }}
        />
      ) : null}
      {!listing && dockedPlace === null && cell === null ? (
        <div class="lre-world-mode">
          <Seg<MapDisplay> label="The map shows" value={display} options={DISPLAYS} disabled={busy} onChange={(next) => run(() => app.request({ type: "lre.map", chatId: props.chatId, display: next }))} />
        </div>
      ) : null}
      {cell ? (
        <div ref={dock} tabIndex={-1} class="lre-world-dock" data-lre-map-cell={`${cell.x},${cell.y}`} role="group" aria-label={cellTitle} onKeyDown={dockKeys(() => setCell(null))}>
          <div class="lre-world-dock-head">
            <strong>{cellTitle}</strong>
            <IconButton icon="close" label="Close" onClick={() => setCell(null)} />
          </div>
          {things.length > 0 ? <span class="lre-muted">{things.length === 1 ? "It lies here." : "They lie here."}</span> : null}
          {walkable ? (
            <div data-lre-map-walk>
              <List>
                <ListRow
                  icon={MODE_ICON.walk}
                  title="Walk here"
                  subtitle={walk === null ? "…" : (walk.disabled ?? formatMinutes(walk.minutes))}
                  disabled={busy || walk === null || walk.disabled !== undefined}
                  onClick={() =>
                    run(async () => {
                      const result = await app.request(travelRequest("step", { x: cell.x, y: cell.y }, props.chatId));
                      if (result) {
                        setCell(null);
                        app.overlays.closeMap();
                      }
                    })
                  }
                />
              </List>
            </div>
          ) : null}
        </div>
      ) : null}
      {dockedPlace ? (
        <div ref={dock} tabIndex={-1} class="lre-world-dock" data-lre-map-dock={dockedPlace.id} role="group" aria-label={dockedPlace.name} onKeyDown={dockKeys(() => setSelected(null))}>
          <div class="lre-world-dock-head">
            <strong>{dockedPlace.name}</strong>
            <IconButton icon="close" label={`Close ${dockedPlace.name}`} onClick={() => setSelected(null)} />
          </div>
          <PlaceDetail
            view={view}
            place={dockedPlace}
            chatId={props.chatId}
            onOpen={() => open(dockedPlace.id)}
            onTravelled={() => {
              setSelected(null);
              app.overlays.closeMap();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
