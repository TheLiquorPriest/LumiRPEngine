// The map (DESIGN §12): one scope at a time, a place's own map with the places inside it, on a
// canvas drawn in the theme's canvas colours; pan, wheel and pinch zoom through Pointer Events
// (`frontend/map-math`). Breadcrumbs lead out to the places around it. In the drawer (Play →
// Places) a tapped place opens its place sheet (place.tsx); in the map overlay, which has no sheet
// stack, the same details dock over the map. With the grid system on, tap a cell of the grid you
// stand on to walk there with your next message (`step`): the square stays marked while the walk
// waits, and Walk here on it again takes it back; or tap one with things lying in it to see them. Known shows what
// the POV knows, places only heard of dashed; Fog fogs what it hasn't seen; the choice is the
// chat's (`lre.map`), and the backend builds the view for it, so what the display hides never
// reaches the page. A list gives the scope's known places; Full screen opens the map overlay.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Cell } from "../../../shared/grid";
import type { MapDisplay } from "../../../shared/world";
import { PLACE_MARK_LABEL, PLACE_MARKS } from "../../../shared/maps";
import { pushSheet, useApp, useView } from "../../../frontend/app";
import { WaitingPress } from "../../../ui/kept/waiting";
import { Empty, IconButton, JsonView, List, ListRow, Section, Seg, useBusy } from "../../../frontend/components";
import { formatMinutes } from "../../../frontend/format";
import { isRecord } from "../../../shared/json";
import type { MapWrote } from "../../../shared/api";
import { Icon } from "../../../ui/icons";
import { fit, GestureTracker, hitTest, IDENTITY, toWorld, zoomAt } from "../../../frontend/map-math";
import type { Point, Transform } from "../../../frontend/map-math";
import type { PanelProps } from "../../../frontend/registry";
import { travelRequest } from "../../../frontend/requests";
import { useSelect } from "../../../ui/store";
import type { MapPieceView, MapPlaceView, MapScopeView, MapView } from "../core/view";
import { useThemeVersion } from "./canvas-theme";
import { labelAt, labelPadding, type PlacedLabel } from "./labels";
import { drawScope, MARK_ICON, placePoint, scopeBounds, unitOf } from "./map-draw";
import { isBeing, pieceAt, piecesAt } from "./map-pieces";
import { LayGrid, legendOf, MapTools, tapped, UndoBar, type LegendSymbol, type MapTool } from "./map-tools";
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
  /** A tap on a square tries the grid before the places on it (the edit tools). */
  cellsFirst?: boolean;
  /** The piece picked (its id): drawn outlined, and, held, carried to a square. */
  piece?: string | null;
  /** A tap on a piece of the grid, with the square it stands on; without it a tap on a piece is a tap on its square. */
  onPiece?(piece: MapPieceView, cell: Cell): void;
  /** The picked piece carried to another square. */
  onMove?(piece: MapPieceView, cell: Cell): void;
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
  // A picked piece carried to a square: where it would land is outlined while it is held.
  const dragging = useRef<{ id: number; piece: MapPieceView } | null>(null);
  const [target, setTarget] = useState<Cell | null>(null);
  const options = { selected: props.selected, here: props.here, inside: props.inside, top: props.top, display: props.display, cell: target ?? props.cell ?? null, piece: props.piece ?? null };

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

  useEffect(() => paint(transform), [scope, transform, props.selected, props.here, props.inside, props.top, props.display, props.cell, props.piece, target, theme]);

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

  // The piece under a screen point (a piece's square or a badge on it), on a grid that draws pieces.
  const pieceTapped = (p: Point): MapPieceView | null => (scope.grid ? pieceAt(scope.grid, unitOf(scope), tracker.current.transform, p) : null);

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
          // The picked piece, pressed on, is carried to a square and not the map with it.
          const held = props.piece && props.onMove ? pieceTapped(localPoint(el, event)) : null;
          if (held && held.id === props.piece) {
            dragging.current = { id: event.pointerId, piece: held };
            return;
          }
          tracker.current.down(event.pointerId, localPoint(el, event), event.timeStamp);
        }}
        onPointerMove={(event) => {
          const el = canvas.current;
          if (!el) return;
          if (dragging.current?.id === event.pointerId) {
            const over = cellAt(localPoint(el, event));
            setTarget((was) => (was?.x === over?.x && was?.y === over?.y ? was : over));
            return;
          }
          const before = tracker.current.transform;
          const after = tracker.current.move(event.pointerId, localPoint(el, event)).transform;
          if (after === before) return;
          moved.current = true;
          setTransform(after);
        }}
        onPointerUp={(event) => {
          const el = canvas.current;
          if (!el) return;
          const drag = dragging.current;
          if (drag?.id === event.pointerId) {
            dragging.current = null;
            setTarget(null);
            const cell = cellAt(localPoint(el, event));
            if (cell && (cell.x !== drag.piece.x || cell.y !== drag.piece.y)) props.onMove?.(drag.piece, cell);
            return;
          }
          const result = tracker.current.up(event.pointerId, localPoint(el, event), event.timeStamp);
          if (!result.tap) return;
          const place = props.cellsFirst && props.onCell && cellAt(result.tap) ? null : placeAt(result.tap);
          const piece = place || !props.onPiece ? null : pieceTapped(result.tap);
          const cell = place || !props.onCell ? null : cellAt(result.tap);
          if (piece && cell && props.onPiece) props.onPiece(piece, cell);
          else if (cell && props.onCell) props.onCell(cell);
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

/** What a piece of the grid is, in a line: its kind, where it lies, its footprint, what it blocks and its state. */
function pieceWords(piece: MapPieceView, all: readonly MapPieceView[]): string {
  const parts = [piece.kind];
  if (piece.on !== undefined) parts.push(`${piece.within ? "in" : "on"} ${all.find((o) => o.id === piece.on)?.name ?? "something"}`);
  if (piece.size !== undefined) parts.push(`${piece.size[0]} by ${piece.size[1]} squares`);
  if (piece.blocks?.way === true) parts.push("blocks the way");
  if (piece.state !== undefined) parts.push(piece.state);
  return parts.filter((p) => p !== "").join(" · ");
}

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
  // What stands on the grid and what the owner's hand is doing on it.
  const [piece, setPiece] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [laying, setLaying] = useState(false);
  const [tool, setTool] = useState<MapTool>("square");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<LegendSymbol[]>([]);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [undo, setUndo] = useState<{ edit: string; words: string } | null>(null);
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
  // The walk that waits for the next message, on the grid the POV stands on: its square stays outlined, and Walk here on it takes it back.
  const state = useView();
  const staged = state?.staged ?? null;
  const waiting: Cell | null = walkable && staged?.action === "step" && typeof staged.values.x === "number" && typeof staged.values.y === "number" ? { x: staged.values.x, y: staged.values.y } : null;
  const walksHere = waiting !== null && cell !== null && cell.x === waiting.x && cell.y === waiting.y;
  // A dock that opens takes focus, so Escape closes it before the overlay and assistive tech lands on it.
  const dockKey = cell ? `cell:${cell.x},${cell.y}` : selected !== null && (overlay || !app.catalog.sheets.has("place")) ? `place:${selected}` : null;
  useEffect(() => {
    if (dockKey !== null) dock.current?.focus({ preventScroll: true });
  }, [dockKey]);
  // The map's own symbols, read when the tools are taken up: what a square can be changed to.
  useEffect(() => {
    if (!editing || !app.maps || scope?.id == null) return;
    let live = true;
    app.maps.grid(props.chatId, scope.id).then(
      (g) => {
        if (live) setSymbols(legendOf(g.legend));
      },
      (error: unknown) => app.toast(error instanceof Error ? error.message : String(error), "error"),
    );
    return () => {
      live = false;
    };
  }, [editing, scope?.id, props.chatId]);
  if (!scope) return <Empty icon="map">No places on the map yet.</Empty>;
  const display = view.display;
  const lying = (c: Cell | null) => (c && grid?.items && grid.pieces === undefined ? grid.items.filter((i) => i.x === c.x && i.y === c.y) : []);
  const things = lying(cell);
  const open = (id: string | null) => {
    setOpened(id);
    setSelected(null);
    setCell(null);
  };
  // What stands on the tapped square, and the sheet each opens.
  const hand = app.maps;
  const placeId = scope.id;
  const cellPieces = cell && grid ? piecesAt(grid, cell) : [];
  // A being has a person's sheet and a thing an item's, where the page has them.
  const sheetKindOf = (p: MapPieceView): "person" | "item" | null => {
    const kind = isBeing(p.kind) ? "person" : "item";
    return app.catalog.sheets.has(kind) ? kind : null;
  };
  const openPiece = (p: MapPieceView) => {
    const kind = sheetKindOf(p);
    if (kind === null) return;
    if (overlay) app.overlays.closeMap();
    app.ui.update((ui) => pushSheet(ui, { kind, id: p.id }));
  };
  const told = (error: unknown) => app.toast(error instanceof Error ? error.message : String(error), "error");
  // A change of his on the grid, once made: what RPE found that does not add up is said, and the change can be taken back.
  const done = (wrote: MapWrote, words: string) => {
    setUndo(wrote.undo === null ? null : { edit: wrote.undo, words });
    const found = wrote.advised.flatMap((a) => (isRecord(a) && typeof a.reason === "string" ? [a.reason] : []));
    if (found.length > 0) app.toast(found.join(" "), "info");
  };
  const move = (p: MapPieceView, to: Cell) => {
    if (!hand || placeId === null) return;
    void run(async () => {
      try {
        done(await hand.move(props.chatId, placeId, p.id, [to.x + 1, to.y + 1]), `Moved ${p.name}.`);
      } catch (error) {
        told(error);
      }
    });
  };
  const paint = (c: Cell) => {
    if (!hand || placeId === null || symbol === null) return;
    const next = tapped(tool, symbol, anchor, c);
    setAnchor(next.anchor);
    const stroke = next.stroke;
    if (stroke === null) return;
    void run(async () => {
      try {
        done(await hand.paint(props.chatId, placeId, [stroke]), "Squares changed.");
      } catch (error) {
        told(error);
      }
    });
  };
  const lay = (laying: { width: number; height: number; feet: number }) => {
    if (!hand || placeId === null) return;
    void run(async () => {
      try {
        done(await hand.lay(props.chatId, placeId, { ...laying, title: scope.name }), `A grid laid for ${scope.name}.`);
        setLaying(false);
      } catch (error) {
        told(error);
      }
    });
  };
  const undoLast = () => {
    if (!hand || undo === null) return;
    const edit = undo.edit;
    void run(async () => {
      try {
        await hand.undo(props.chatId, edit);
        setUndo(null);
      } catch (error) {
        told(error);
      }
    });
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
  const cellTitle = [...cellPieces.map((p) => p.name), ...things.map((t) => t.name)].join(", ") || "This spot";
  // The marks this scope's places carry, in the legend's order: one row each.
  const marks = PLACE_MARKS.filter((m) => scope.places.some((p) => p.mark === m));
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
                if (editing) {
                  paint(c);
                  return;
                }
                const here = piecesAt(grid, c);
                setPiece(here.some((p) => p.id === piece) ? piece : (here[0]?.id ?? null));
                setCell(walkable || lying(c).length > 0 || here.length > 0 ? c : null);
              }
            : undefined
        }
        cellsFirst={editing}
        piece={editing ? null : piece}
        onPiece={
          editing
            ? undefined
            : (p, c) => {
                setSelected(null);
                setPiece(p.id);
                setCell(c);
              }
        }
        onMove={hand && placeId !== null && !editing ? move : undefined}
        cell={cell ?? anchor ?? (editing ? null : waiting)}
        display={display}
        top={top}
        hideZoom={listing || dockedPlace !== null || cell !== null || editing}
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
        {hand && placeId !== null && grid ? (
          <IconButton
            icon="edit"
            label="Change squares"
            variant="secondary"
            pressed={editing}
            onClick={() => {
              setEditing(!editing);
              setAnchor(null);
              setCell(null);
            }}
          />
        ) : null}
        {hand && placeId !== null && !grid ? <IconButton icon="plus" label="Lay a grid" variant="secondary" pressed={laying} onClick={() => setLaying(!laying)} /> : null}
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
          <Seg<MapDisplay> label="The map shows" value={display} options={DISPLAYS} disabled={busy} onChange={(next) => run(async () => (hand ? hand.display(props.chatId, next).catch(told) : app.request({ type: "lre.map", chatId: props.chatId, display: next })))} />
          {marks.length > 0 ? (
            <ul class="lre-world-legend" aria-label="Marks" data-lre-map-legend>
              {marks.map((mark) => (
                <li key={mark}>
                  <Icon name={MARK_ICON[mark]} size={14} />
                  {PLACE_MARK_LABEL[mark]}
                </li>
              ))}
            </ul>
          ) : null}
          {waiting !== null && state !== null ? (
            <div data-lre-map-waits={`${waiting.x},${waiting.y}`}>
              <WaitingPress view={state} block />
            </div>
          ) : null}
        </div>
      ) : null}
      {cell ? (
        <div ref={dock} tabIndex={-1} class="lre-world-dock" data-lre-map-cell={`${cell.x},${cell.y}`} role="group" aria-label={cellTitle} onKeyDown={dockKeys(() => setCell(null))}>
          <div class="lre-world-dock-head">
            <strong>{cellTitle}</strong>
            <IconButton icon="close" label="Close" onClick={() => setCell(null)} />
          </div>
          {things.length > 0 ? <span class="lre-muted">{things.length === 1 ? "It lies here." : "They lie here."}</span> : null}
          {cellPieces.length > 0 ? (
            <div data-lre-map-pieces>
              <List>
                {cellPieces.map((p) => (
                  <ListRow
                    key={p.id}
                    id={p.id}
                    icon={isBeing(p.kind) ? "user" : "box"}
                    title={p.name}
                    subtitle={pieceWords(p, grid?.pieces ?? [])}
                    current={p.id === piece}
                    chevron={sheetKindOf(p) !== null}
                    onClick={() => (sheetKindOf(p) !== null ? openPiece(p) : setPiece(p.id))}
                  />
                ))}
              </List>
              {hand && piece !== null && cellPieces.some((p) => p.id === piece) && !editing ? <span class="lre-muted">Drag it to another square to move it.</span> : null}
            </div>
          ) : null}
          {walkable ? (
            <div data-lre-map-walk>
              <List>
                <ListRow
                  icon={walksHere ? "close" : MODE_ICON.walk}
                  title={walksHere ? "Take back Walk here" : "Walk here"}
                  subtitle={walksHere ? "It waits for your next message; pressed again, it no longer does." : walk === null ? "…" : (walk.disabled ?? `${formatMinutes(walk.minutes)}, with your next message`)}
                  disabled={busy || (!walksHere && (walk === null || walk.disabled !== undefined))}
                  onClick={() =>
                    run(async () => {
                      const result = await app.request(travelRequest("step", { x: cell.x, y: cell.y }, props.chatId));
                      if (result === null) return;
                      setCell(null);
                      // Held for the next message, the HUD says so where you play; taken back, the square's mark goes as you watch.
                      if (!("staged" in result) || result.staged) app.overlays.closeMap();
                    })
                  }
                />
              </List>
            </div>
          ) : null}
        </div>
      ) : null}
      {undo ? <UndoBar undo={undo} busy={busy} onUndo={undoLast} /> : null}
      {editing && placeId !== null && grid ? <MapTools tool={tool} symbol={symbol} symbols={symbols} anchor={anchor} busy={busy} undo={null} onTool={(next) => { setTool(next); setAnchor(null); }} onSymbol={setSymbol} onUndo={undoLast} onClose={() => { setEditing(false); setAnchor(null); }} /> : null}
      {laying && placeId !== null && !grid ? <LayGrid place={placeId} name={scope.name} busy={busy} onLay={lay} /> : null}
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
