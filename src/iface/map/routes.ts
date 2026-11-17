// The owner's hand on a chat's maps (plan §14 l.1554, §8.2, §10.10; the Places page and the map
// panel): the chat's grids listed, one read whole (both layers as data: what is drawn as the chat
// plays it, who and what stands where, the doors, the squares the chat changed, the scale and the time
// step, at the chat's head or at a turn), a token dragged to a square, squares edited, a grid laid for a
// place that has none, and a chat's map kept in the world. Every write but the last is his own change,
// recorded the one way an edit of his is (`play/owner-edits.ts`: applied at once on the chat's line, cited
// by an edit id its Undo takes, told to the Author at the next turn as a `player-edit` item), and made of
// the same code as the tools' (`editMap`, `layForPlace`, `layOverSquare`), so a page's squares and a
// model's are one. The last goes through Maps-12's keep (`keep.ts`), into the world's draft, as
// `world_keep` does. Every route is a page's: it answers only for the user this RPE belongs to. What
// the owner sees is the whole grid; nothing is filtered to what the player's character may see.

import { type LiveHub, route, RouteError, shape, type WriteQueue } from "../../app";
import { playedWorld } from "../../engine/places-in-play";
import { relocate } from "../../engine/relocate";
import { placeOfEntity } from "../../engine/scope";
import { chatDraftOf } from "../../engine/world-draft";
import { MAP_SIDE_MAX, squareEditsOf, whereOf } from "../../packs/space/core/grid-play";
import { doorState, drawnOf, indexOf, movingOf, roomAt, squareAt, squareOf as squareOfCell, standsAt, type Drawn, type Square } from "../../packs/space/core/grid-model";
import { type Head, recordOwnerEdit, Refused } from "../../play/owner-edits";
import { type MapConfig, METRES_PER_FOOT } from "../../shared/map-config";
import type { JsonObject, JsonValue } from "../../shared/json";
import { doorTerrainsOf, entranceCell, gridOf } from "../../shared/grid";
import type { LedgerEvent } from "../../shared/ledger";
import type { MapCellDef, WorldDoc } from "../../shared/world";
import { JoinedTurnError, type Report, type Store, type UserStore } from "../../store";
import type { WorldState } from "../../engine/state";
import { editMap, type Stroke } from "./edit";
import { keepInDraft } from "./keep";
import { idFrom, layForPlace, layOverSquare, plainRows, type Laid, type Laying, type Named } from "./lay";
import { positionEvent } from "./record";
import { squareGiven } from "./words";

const T = shape.text();
const N = shape.number();
const W = shape.whole();
const opt = shape.optional;
const nullable = shape.nullable;
/** A square as the tools take it: [column, row], counted from 1 at the top left. */
const SQUARE = shape.list(shape.whole({ least: 1 }));

const mapListed = shape.named(
  "MapListed",
  "A grid of a chat as the Places page lists it: the place it is the grid of and its name, the grid's id, the map that draws it (none for a grid authored without one), where it comes from (the world's own, laid in play, or the world's own changed in play), its size in squares and how wide a square is.",
  shape.object({ place: T, name: T, grid: T, map: nullable(T), from: shape.oneOf("world", "laid", "changed"), width: W, height: W, feet: N, unit: shape.oneOf("feet", "metres") }),
);

const mapsReply = shape.named("MapsReply", "The grids of a chat, by place.", shape.object({ maps: shape.list(mapListed) }));

const pieceShown = shape.named(
  "MapPieceShown",
  "Someone or something on a grid: its id, name and kind, its square (the top left of its footprint), its footprint when it covers more than one square, what it blocks, what it lies on or in, and its life state when it is not alive.",
  shape.object({ id: T, name: T, kind: T, square: SQUARE, size: opt(shape.list(W)), blocks: opt(shape.object({ way: opt(shape.yesNo()), view: opt(shape.yesNo()) })), on: opt(T), within: opt(shape.yesNo()), state: opt(T) }),
);

const mapGridReply = shape.named(
  "MapGridReply",
  "One grid in full, as the chat plays it: both layers as data. What is drawn (its rows of symbols with the squares the chat changed laid over, its legend, where it comes from), what moves (everyone and everything on a square, those at the place with none and where they are kept, each door's state), the squares and symbols the chat changed, and the scale and time step.",
  shape.object({
    place: T,
    name: T,
    grid: T,
    map: nullable(T),
    from: shape.oneOf("world", "laid", "changed"),
    width: W,
    height: W,
    scale: shape.json(),
    rows: shape.list(T),
    legend: shape.record(shape.json()),
    doors: shape.list(shape.object({ square: SQUARE, state: shape.oneOf("open", "closed", "locked") })),
    pieces: shape.list(pieceShown),
    unplaced: shape.list(shape.object({ id: T, name: T, kind: T, zone: opt(T), words: opt(T) })),
    edits: shape.object({ squares: W, legend: shape.list(T) }),
  }),
);

const wroteReply = shape.named(
  "MapWrote",
  "What an edit of his on a map came to: the id its Undo takes (null when it changed nothing), and what the grid found that does not add up, which was done all the same.",
  shape.object({ undo: nullable(T), advised: shape.list(shape.json()) }),
);

const keptReply = shape.named(
  "MapKept",
  "What keeping a chat's map in the world came to: what was copied into the world's draft, what was left (the id and why), and the draft's version after it, with whether anything was written.",
  shape.object({
    kept: shape.object({ maps: shape.list(T), places: shape.list(T), paths: shape.list(T), settings: shape.yesNo() }),
    skipped: shape.list(shape.object({ id: T, code: shape.oneOf("not_changed", "in_draft_already", "no_map") })),
    draft: shape.object({ version: W, written: shape.yesNo() }),
  }),
);

/** What the routes are given. */
export interface MapRoutesDeps {
  store: Store;
  writes: WriteQueue;
  live: Pick<LiveHub, "publish">;
  /** The chat's map settings (`map:` in its config); the defaults where it can say none. */
  config(chat: string): Promise<MapConfig>;
}

/** A square as a body gives it, or the refusal. */
function squareOf(said: unknown, what: string): Square {
  const s = squareGiven(said);
  if (s === null) throw new RouteError(400, `${what} is a square, [column, row], counted from 1 at the top left.`);
  return s;
}

/** Strokes as a body gives them, as the edit takes them. */
function strokesOf(body: readonly { symbol: string; squares?: readonly (readonly number[])[]; rect?: readonly (readonly number[])[]; line?: readonly (readonly number[])[] }[]): Stroke[] {
  return body.map((s, i): Stroke => {
    const pair = (name: "rect" | "line"): [Square, Square] | undefined => {
      const v = s[name];
      return v === undefined ? undefined : v.length === 2 ? [squareOf(v[0], `strokes[${i}].${name}`), squareOf(v[1], `strokes[${i}].${name}`)] : (() => { throw new RouteError(400, `strokes[${i}].${name} is two squares.`); })();
    };
    const rect = pair("rect");
    const line = pair("line");
    return { symbol: s.symbol, ...(s.squares !== undefined ? { squares: s.squares.map((q) => squareOf(q, `strokes[${i}].squares`)) } : {}), ...(rect ? { rect } : {}), ...(line ? { line } : {}) };
  });
}

/** Where a grid comes from, as the chat's draft of its world has it: the world's own, laid in play, or the world's own changed in play. */
function originOf(state: Readonly<WorldState>, drawn: Drawn): "world" | "laid" | "changed" {
  const entry = drawn.map === undefined ? undefined : chatDraftOf(state).maps?.[drawn.map];
  return entry === undefined ? "world" : entry.over === null ? "laid" : "changed";
}

export function mapRoutes(deps: MapRoutesDeps) {
  /** A chat RPE holds is there; any other is not. A turn asked for is one of the chat's; a joined one is answered as a fact. */
  const held = (user: string, chat: string, turn?: string): UserStore => {
    const s = deps.store.user(user);
    if (s.chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat} of yours.`);
    if (turn !== undefined) {
      const row = s.turn(turn);
      if (row === null || row.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
      if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
    }
    return s;
  };

  /** The chat's world as it plays at its head, or at `turn`: the revision it plays, the state, and the world as played. */
  const played = (s: UserStore, chat: string, turn?: string): { doc: WorldDoc; state: WorldState; world: WorldDoc } => {
    const state = (turn === undefined ? s.headState(chat) : s.stateAt(turn)).state.world;
    const doc = deps.store.env.worlds(state.revision);
    if (doc === undefined) throw new RouteError(409, `The world revision ${state.revision} of chat ${chat} is not to hand.`);
    return { doc, state, world: playedWorld(doc, state) };
  };

  /** Records an edit of his, as every page's edit is; a refusal the one way gives is the route's. */
  const edited = async (user: string, chat: string, request: JsonObject, tell: boolean | undefined, resolve: (head: Head, doc: WorldDoc) => { events: LedgerEvent[]; advised?: Report[] }) => {
    try {
      const out = await recordOwnerEdit(
        { store: deps.store, writes: deps.writes, live: deps.live },
        user,
        chat,
        { kind: "map", ...request },
        tell ?? null,
        (head) => {
          const doc = deps.store.env.worlds(head.state.revision);
          if (doc === undefined) throw new RouteError(409, `The world revision ${head.state.revision} of chat ${chat} is not to hand.`);
          const done = resolve(head, doc);
          return { opened: [], events: done.events, ...(done.advised !== undefined && done.advised.length > 0 ? { advised: done.advised } : {}) };
        },
      );
      return { undo: out.undo, advised: out.advised.map((r): JsonObject => ({ code: r.code, ...(r.values !== undefined ? { values: r.values } : {}) })) };
    } catch (error) {
      if (error instanceof Refused) throw new RouteError(409, "line" in error.why ? error.why.line : error.why.words);
      throw error;
    }
  };

  /** What a laid map's changes come to as events, or the refusal when it lays nothing. */
  const eventsOf = (laid: Laid): LedgerEvent[] => {
    if (laid.changes.length === 0 || laid.scope === null) throw new RouteError(400, `Nothing was laid: ${laid.reports.map((r) => r.code).join(", ") || "no change"}.`);
    return laid.changes.map((c) => c.value as unknown as LedgerEvent);
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/maps",
      access: "page",
      group: "places",
      does: "The grids of a chat: each place that has one, the grid's id and the map that draws it, whether it is the world's own, laid in play or the world's own changed in play, its size and how wide a square is.",
      reply: mapsReply,
      handle: async ({ user, params }) => {
        const s = held(user, params.chat);
        const { state, world } = played(s, params.chat);
        const config = await deps.config(params.chat);
        const maps = Object.keys(world.places)
          .sort()
          .flatMap((place) => {
            const drawn = drawnOf(world, place, config, state);
            return drawn === null ? [] : [{ place, name: world.places[place]?.name ?? place, grid: drawn.id, map: drawn.map ?? null, from: originOf(state, drawn), width: drawn.width, height: drawn.height, feet: drawn.scale.feet, unit: drawn.scale.unit }];
          });
        return { maps };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/maps/:place",
      access: "page",
      group: "places",
      does: "One grid in full, both layers as data: what is drawn with the squares the chat changed laid over, everyone and everything on it, the doors as they stand, what the chat changed, the scale and the time step; at the chat's head, or at a turn.",
      query: { turn: opt(shape.turnId(), "Read the grid as the chat stood at this turn; at its head when left out.") },
      joined: true,
      reply: mapGridReply,
      handle: async ({ user, params, query }) => {
        const s = held(user, params.chat, query.turn);
        const { state, world } = played(s, params.chat, query.turn);
        const config = await deps.config(params.chat);
        const drawn = drawnOf(world, params.place, config, state);
        if (drawn === null) throw new RouteError(404, `Place ${params.place} has no grid in chat ${params.chat}.`);
        const ground = movingOf(deps.store.env.registry, world, state, drawn);
        const named = (id: string): { name: string; kind: string } => ({ name: state.entities[id]?.name ?? id, kind: state.entities[id]?.kind ?? "" });
        const rows = Array.from({ length: drawn.height }, (_, r) => drawn.symbols.slice(r * drawn.width, (r + 1) * drawn.width).join(""));
        const edits = squareEditsOf(state, drawn.id);
        return {
          place: params.place,
          name: world.places[params.place]?.name ?? params.place,
          grid: drawn.id,
          map: drawn.map ?? null,
          from: originOf(state, drawn),
          width: drawn.width,
          height: drawn.height,
          scale: { metres: drawn.scale.metres, feet: drawn.scale.feet, unit: drawn.scale.unit, diagonal: drawn.scale.diagonal, step: drawn.scale.step },
          rows,
          legend: drawn.legend as unknown as Record<string, JsonValue>,
          doors: [...drawn.doors].sort((a, b) => a - b).map((i) => ({ square: [...squareAt(drawn, i)], state: doorState(drawn, ground.moving, i) ?? "closed" })),
          pieces: Object.entries(ground.moving.pieces).flatMap(([id, p]) => {
            const at = standsAt(ground.moving, id);
            return at === null ? [] : [{ id, ...named(id), square: [...at], ...(p.size !== undefined && (p.size[0] !== 1 || p.size[1] !== 1) ? { size: [...p.size] } : {}), ...(p.blocks !== undefined ? { blocks: { ...p.blocks } } : {}), ...(p.on !== undefined ? { on: p.on, ...(p.within ? { within: true } : {}) } : {}), ...(state.entities[id]?.life !== undefined ? { state: state.entities[id]?.life } : {}) }];
          }),
          unplaced: ground.unplaced.map((id) => ({ id, ...named(id), ...(whereOf(state, id) ?? {}) })),
          edits: { squares: Object.keys(edits?.cells ?? {}).length, legend: Object.keys(edits?.legend ?? {}) },
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/maps/:place/moves",
      access: "page",
      group: "places",
      does: "Drags someone or something to a square of the grid of a place: his own change, applied at once on the chat's line, with an Undo, told to the Author at the next turn unless he says not to. Dropped on the area of another room of the place, it is in that room (at the room's entrance when the room has a grid of its own); one that lies on or in something is taken off it and stands on the square.",
      body: shape.object({ who: shape.field(T, "Who or what is moved: its id, or its name."), square: shape.field(SQUARE, "Where: [column, row], counted from 1 at the top left."), tell: opt(shape.yesNo(), "Whether the Author is told; the chat's setting when left out.") }),
      reply: wroteReply,
      handle: async ({ user, params, body }) => {
        held(user, params.chat);
        const config = await deps.config(params.chat);
        return edited(user, params.chat, { drag: params.place, who: body.who, square: body.square }, body.tell, (head, doc) => {
          const world = playedWorld(doc, head.state);
          const drawn = drawnOf(world, params.place, config, head.state);
          if (drawn === null) throw new RouteError(404, `Place ${params.place} has no grid in chat ${params.chat}.`);
          const ground = movingOf(head.registry, world, head.state, drawn);
          const to = squareOf(body.square, "square");
          if (indexOf(drawn, to) === null) throw new RouteError(400, `Square (${to[0]},${to[1]}) is off the grid of ${params.place}, which is ${drawn.width} by ${drawn.height} squares.`);
          const here = [...Object.keys(ground.moving.pieces), ...ground.unplaced];
          const key = body.who.trim().toLowerCase();
          const hits = here.includes(body.who) ? [body.who] : here.filter((id) => (head.state.entities[id]?.name ?? "").trim().toLowerCase() === key);
          const who = hits.length === 1 ? hits[0] : undefined;
          if (who === undefined) throw new RouteError(404, hits.length > 1 ? `More than one on the grid of ${params.place} is called ${body.who}: name one by its id (${hits.join(", ")}).` : `Nobody and nothing on the grid of ${params.place} is ${body.who}. On it: ${here.join(", ") || "nobody"}.`);
          const piece = ground.moving.pieces[who];
          const room = roomAt(world, drawn, to);
          // Where he drops it is where it is: in the room whose area holds the square, taken off whatever it lies on or in.
          if (piece?.on === undefined && placeOfEntity(head.state, who) === room) return { events: [positionEvent(drawn, who, to, piece?.at ?? null) as unknown as LedgerEvent] };
          const moved = relocate(head.registry.context(world, head.state), who, room);
          if (!Array.isArray(moved)) throw new RouteError(409, moved.reason);
          // A room with a grid of its own is a map of its own, entered at its entrance on that grid, as a step into it is.
          const inner = room !== drawn.scope ? gridOf(world, room) : undefined;
          const entry = inner ? entranceCell(inner, doorTerrainsOf(world)) : null;
          const stands = inner ? (entry ? positionEvent({ scope: room }, who, squareOfCell(entry), null) : null) : positionEvent(drawn, who, to, null);
          return { events: [...moved, ...(stands ? [stands as unknown as LedgerEvent] : [])] };
        });
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/maps/:place/squares",
      access: "page",
      group: "places",
      does: "Edits squares of the grid of a place, by the same code as the `map_edit` tool: strokes of one symbol over squares, a rectangle or a line, and what a symbol stands for. His own change, applied at once, with an Undo, told to the Author at the next turn unless he says not to.",
      body: shape.object({
        strokes: shape.field(shape.list(shape.object({ symbol: T, squares: opt(shape.list(SQUARE)), rect: opt(shape.list(SQUARE)), line: opt(shape.list(SQUARE)) })), "The strokes, drawn in order: a symbol over each square, a rectangle's two corners, or a line's two ends."),
        legend: opt(shape.record(shape.json()), "What symbols stand for: a symbol to what the map's format holds for it, or null to take it out."),
        tell: opt(shape.yesNo(), "Whether the Author is told; the chat's setting when left out."),
      }),
      reply: wroteReply,
      handle: async ({ user, params, body }) => {
        held(user, params.chat);
        const strokes = strokesOf(body.strokes);
        return edited(user, params.chat, { squares: params.place, strokes: body.strokes }, body.tell, (head, doc) => {
          const laid = editMap(doc, head.state, params.place, strokes, (body.legend ?? {}) as Record<string, MapCellDef | null>);
          return { events: eventsOf(laid), advised: laid.reports };
        });
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/maps",
      access: "page",
      group: "places",
      does: "Lays a grid for a place, by the same code as the `map_lay` tool: rows of symbols, or a walled room of a width and a height; over one square of a coarser map with `over` and `square`. His own change, applied at once, with an Undo, told to the Author at the next turn unless he says not to.",
      body: shape.object({
        place: shape.field(T, "The place to lay it for: its id or name; with `over`, a new place made on that square when none is drawn there."),
        rows: opt(shape.list(T), "The rows, top first, one symbol to a square."),
        width: opt(W, "Without rows: a walled room this many squares wide."),
        height: opt(W, "Without rows: this many squares high."),
        doors: opt(shape.list(SQUARE), "Without rows: the squares of the walls that are doors."),
        legend: opt(shape.record(shape.json()), "What the symbols stand for, as the map's format holds them."),
        feet: opt(N, "How wide a square is, in feet; the settings' when left out."),
        title: opt(T, "The map's title."),
        over: opt(T, "The place whose coarser map this lies over one square of."),
        square: opt(SQUARE, "With `over`: that square of the coarser map."),
        tell: opt(shape.yesNo(), "Whether the Author is told; the chat's setting when left out."),
      }),
      reply: wroteReply,
      handle: async ({ user, params, body }) => {
        held(user, params.chat);
        const config = await deps.config(params.chat);
        const rows = body.rows ?? (body.width !== undefined && body.height !== undefined ? plainRows(body.width, body.height, (body.doors ?? []).map((d) => squareOf(d, "doors"))) : null);
        if (rows === null) throw new RouteError(400, "A grid is laid from rows, or from a width and a height.");
        if (rows.length > MAP_SIDE_MAX || rows.some((r) => [...r].length > MAP_SIDE_MAX)) throw new RouteError(400, `A map is at most ${MAP_SIDE_MAX} by ${MAP_SIDE_MAX} squares: lay a larger place in parts.`);
        const laying: Laying = { rows, ...(body.legend !== undefined ? { legend: body.legend as Record<string, MapCellDef> } : {}), ...(body.title !== undefined ? { title: body.title } : {}), ...(body.feet !== undefined ? { metres: body.feet * METRES_PER_FOOT } : {}) };
        return edited(user, params.chat, { lay: body.place, rows: body.rows ?? null, width: body.width ?? null, height: body.height ?? null, ...(body.over !== undefined ? { over: body.over } : {}) }, body.tell, (head, doc) => {
          const world = playedWorld(doc, head.state);
          const known = (said: string): string | undefined => Object.keys(world.places).find((id) => id === said) ?? Object.keys(world.places).find((id) => (world.places[id]?.name ?? "").trim().toLowerCase() === said.trim().toLowerCase());
          if (body.over !== undefined) {
            const over = known(body.over);
            if (over === undefined) throw new RouteError(404, `There is no place ${body.over}.`);
            const square = squareOf(body.square, "square");
            const there = known(body.place);
            const named: Named = there !== undefined ? { id: there, name: world.places[there]?.name ?? there, made: false } : { id: idFrom(body.place), name: body.place, made: true };
            return { events: eventsOf(layOverSquare(doc, head.state, over, square, laying, config, named)) };
          }
          const at = known(body.place);
          if (at === undefined) throw new RouteError(404, `There is no place ${body.place}.`);
          return { events: eventsOf(layForPlace(doc, head.state, at, laying, config)) };
        });
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/maps/:place/keep",
      access: "page",
      group: "places",
      does: "Keeps the chat's map of a place in the world: its map as the chat plays it, with the squares drawn on it, copied into the world's draft, the working copy Build edits, with the places, paths and settings named; the chat keeps its own changes until the world takes them in.",
      body: shape.object({ places: opt(shape.list(T), "Places of the world's own this chat changed, to keep with the map."), paths: opt(shape.list(T), "Paths of the world's own this chat changed, to keep with the map."), settings: opt(shape.yesNo(), "Whether to keep the map settings this chat changed.") }),
      reply: keptReply,
      handle: async ({ user, params, body }) => {
        const s = held(user, params.chat);
        const { doc, state, world } = played(s, params.chat);
        const map = Object.values(world.maps).find((m) => m.scope === params.place);
        if (map === undefined) throw new RouteError(404, `Place ${params.place} has no map in chat ${params.chat}.`);
        const out = await deps.writes.run(() => keepInDraft(s.worlds, doc, state, { maps: [map.id], places: body.places ?? [], paths: body.paths ?? [], settings: body.settings === true }), "keeping a chat's map in its world");
        if ("failed" in out) throw new RouteError(409, out.failed === "no_world" ? "The store keeps no draft for this chat's world." : out.failed === "unreadable" ? "The world's draft could not be read." : "The world's draft kept changing while it was written; try again.");
        return { kept: out.kept, skipped: out.skipped, draft: { version: out.version, written: out.written } };
      },
    }),
  ];
}
