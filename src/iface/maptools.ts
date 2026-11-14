// The map tools (plan §8.2): `map_view`, `map_measure`, `map_place`, `map_door`, `map_lay` and
// `map_edit`, found by `tool_search` and pinned for the GM by its definition. Each is a spec in code
// (its arguments, a worked call, what it runs) with its words in files: its description and each
// argument's text in `.tools/<name>.md`, every sentence of its answers in `.prompts/map-answers.md`.
// A read answers from the state at the call's turn. A write is one operation, run as every
// searchable write is (`families/run.ts`): what it cannot read refuses the call before anything is
// recorded, the user's setting for the engine lane is asked, and the rest is applied, recorded in one
// write, and reported where it does not add up (a square in a wall, no way there). Squares are
// [column, row], counted from 1 at the top left, as the map prints them.
//
// The turn lane gives the engine's tools, with `lines = await mapLines(files)` read from the chat's
// files: `deps.grid = gridMoves(lines)` (squares for `world_apply`'s `move` and `place`, with what
// their answer says of it) and `deps.map = mapView(lines)` (the map in the world state and in
// `world_query`).

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { standingGrid } from "../shared/grid";
import type { MapCellDef } from "../shared/world";
import { own } from "../engine/pack-kit";
import { relocate } from "../engine/relocate";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { isThing } from "../engine/things";
import { DOOR_STATES, FOOTPRINT_MAX, type DoorState } from "../packs/space/core/grid-play";
import type { Report } from "../store/types";
import { foundIn, readTool, writeTool, type ReadDef, type WriteDef } from "./families/run";
import { NUMBER, OBJECT, oneOf, Reply, TEXT, TEXTS, WHOLE, YES_NO, type ToolSpec } from "./kit";
import { editMap, type Stroke } from "./map/edit";
import { doorState, GRID_DEFAULTS, indexOf, laidMetres, lift, METRES_PER_FOOT, place, setDoor, squareAt, standsAt, type Piece, type Square } from "./map/grid";
import { layForPlace, layOverSquare, plainRows, type Laid, type Laying } from "./map/lay";
import { between, burst, cone, line, sees, within, type Spot } from "./map/measure";
import { beside, inZone } from "./map/moves";
import { move, walk } from "./map/path";
import { doorEvent, positionEvent, shapeEvent } from "./map/record";
import { moveTime, type Took } from "./map/time";
import { feetOf, layersAt, mapLines, mapWords, reportFields, type Say, spotText, squareGiven, stepFields, timeText, whoIs, type Layers } from "./map/words";
import { find, isUnread, notOneOf, numberArg, textArg, type OpContext, type Unread } from "./ops";
import { putThing } from "./ops-things";
import { type Found, isFound, type Reading } from "./reading";

const FAMILY = "map";

/** A square as the tools take it: [column, row], counted from 1. */
const SQUARE: JsonObject = { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, maxItems: 2 };
/** Someone or something on the map by name, or a square. */
const SPOT: JsonObject = { anyOf: [TEXT, SQUARE] };
const SQUARES: JsonObject = { type: "array", items: SQUARE };
const TWO_SQUARES: JsonObject = { type: "array", items: SQUARE, minItems: 2, maxItems: 2 };

const AREAS = ["burst", "cone", "line"] as const;
const BLOCKS = ["way", "view", "both", "none"] as const;
type Blocks = (typeof BLOCKS)[number];

// ---------------------------------------------------------------- what every map tool shares

/** A map tool answers in the lines of the map's part, not the engine's. */
function mapTool(spec: ToolSpec): ToolSpec {
  return {
    ...spec,
    async run(args, call) {
      const lines = await mapLines(call.deps.files);
      return spec.run(args, { ...call, lines, reply: () => new Reply(lines) });
    },
  };
}

/** A square or someone on the map, as a measure or a placing takes it: where it stands, and who, when named. */
interface At {
  square: Square;
  id?: EntityId;
}

function tookData(took: Took): JsonObject {
  return { seconds: took.seconds, ...(took.rounds !== undefined ? { rounds: took.rounds } : {}) };
}

/** The grid of the place `at` names, or the one the someone or something it names stands on, as `state` has it; or the line that says there is none. */
function layersOn(r: Reading, state: Readonly<WorldState>, at: Found): Layers | Unread {
  const placeId = at.ref.startsWith("place:") ? at.id : placeOfEntity(state, at.id);
  const layers = placeId === null ? null : layersAt(r.registry, r.doc, state, placeId, GRID_DEFAULTS);
  return layers ?? { line: "no_grid", fields: { at: `${at.name} [${at.id}]` } };
}

/** A square on the map `layers` draws, as an argument gives it; or the line that says it cannot be read, or lies off the map. */
function squareOn(say: Say, layers: Layers, field: string, v: JsonValue | undefined): Square | Unread {
  const s = squareGiven(v);
  if (s === null) return { line: "bad_square", fields: { field, value: JSON.stringify(v ?? null) } };
  const { drawn } = layers;
  return indexOf(drawn, s) !== null ? s : { line: "off_map", fields: { field, column: s[0], row: s[1], place: whoIs(say, drawn.scope), width: drawn.width, height: drawn.height } };
}

/** A spot an argument gives: a square on the map, or someone or something `findName` finds that stands on it. */
function spotOn(say: Say, layers: Layers, field: string, v: JsonValue | undefined, findName: (said: string) => Found | Unread): At | Unread {
  if (typeof v !== "string") {
    const s = squareOn(say, layers, field, v);
    return isUnread(s) ? s : { square: s };
  }
  const f = findName(v);
  if (isUnread(f)) return f;
  const s = standsAt(layers.moving, f.id);
  return s ? { square: s, id: f.id } : { line: "not_on_map", fields: { field, name: `${f.name} [${f.id}]`, place: whoIs(say, layers.drawn.scope) } };
}

function atData(say: Say, at: At): JsonObject {
  return { at: [...at.square], ...(at.id !== undefined ? { who: whoIs(say, at.id) } : {}) };
}

/** Applies events the grid's records make on the draft; what says the first did not apply, when one does not. */
function applied(o: OpContext, events: readonly JsonObject[]): Unread | undefined {
  // The grid's records are today's events, written as JSON.
  const ledger = events as unknown as readonly LedgerEvent[];
  const bad = o.draft.applyAll(ledger);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/** Each report of the grid's, as its line (`grid_<code>`), with the operation's number and name. */
function reportAll(o: OpContext, say: Say, reports: readonly Report[]): void {
  for (const r of reports) o.reply.report(`grid_${r.code}`, { n: o.n, op: o.op, ...reportFields(say, r.values) });
}

// ---------------------------------------------------------------- map_view

const view: ReadDef = {
  name: "map_view",
  family: FAMILY,
  properties: { at: TEXT, centre: SPOT },
  required: ["at"],
  example: { at: "The Common Room", centre: "Wren" },
  read(r, args, reply, call) {
    const at = foundIn(r, "at", args.at, "point");
    if (isUnread(at)) return at;
    const layers = layersOn(r, r.state.world, at);
    if (isUnread(layers)) return layers;
    const say: Say = { lines: call.lines, world: layers.world, state: r.state.world };
    const centre = args.centre === undefined || args.centre === null ? undefined : spotOn(say, layers, "centre", args.centre, (s) => foundIn(r, "centre", s, "entity"));
    if (isUnread(centre)) return centre;
    const { text, printed } = mapWords(call.lines, layers, r.state.world, centre ? { centre: centre.square } : {});
    reply.tree(text);
    reply.data({ map: printed.grid, place: whoIs(say, printed.scope), from: [...printed.from], to: [...printed.to], whole: printed.whole });
    return undefined;
  },
};

// ---------------------------------------------------------------- map_measure

const measure: ReadDef = {
  name: "map_measure",
  family: FAMILY,
  properties: { at: TEXT, from: SPOT, to: SPOT, within: WHOLE, area: oneOf(AREAS), size: WHOLE, toward: SPOT, speed: NUMBER },
  required: ["from"],
  example: { from: "Wren", to: "the hooded traveller", within: 6 },
  read(r, args, reply, call) {
    const where = args.at !== undefined && args.at !== null ? foundIn(r, "at", args.at, "point") : typeof args.from === "string" ? foundIn(r, "from", args.from, "entity") : { line: "needs_field", fields: { field: "at" } };
    if (isUnread(where)) return where;
    const layers = layersOn(r, r.state.world, where);
    if (isUnread(layers)) return layers;
    const say: Say = { lines: call.lines, world: layers.world, state: r.state.world };
    const named = (field: string) => (s: string) => foundIn(r, field, s, "entity");
    const from = spotOn(say, layers, "from", args.from, named("from"));
    if (isUnread(from)) return from;
    const to = args.to === undefined || args.to === null ? undefined : spotOn(say, layers, "to", args.to, named("to"));
    if (isUnread(to)) return to;
    const range = args.within;
    if (range !== undefined && range !== null && !(typeof range === "number" && Number.isInteger(range) && range >= 0)) return { line: "unreadable", fields: { field: "within", value: JSON.stringify(range) } };
    const area = args.area;
    if (area !== undefined && area !== null && !(AREAS as readonly unknown[]).includes(area)) return { line: "unreadable", fields: { field: "area", value: JSON.stringify(area), choices: [...AREAS] } };
    const size = args.size;
    if (area !== undefined && area !== null && !(typeof size === "number" && Number.isInteger(size) && size >= 0)) return { line: "needs_field", fields: { field: "size" } };
    const toward = area === "cone" || area === "line" ? spotOn(say, layers, "toward", args.toward ?? undefined, named("toward")) : undefined;
    if (isUnread(toward)) return toward;
    if (to === undefined && (range === undefined || range === null) && (area === undefined || area === null)) return { line: "needs_any", fields: { fields: ["to", "within", "area"] } };
    const speed = numberArg(args, "speed");
    const { drawn, moving } = layers;
    const spot = (a: At): Spot => a.id ?? a.square;
    const fromText = spotText(say, from.square, from.id);
    const data: JsonObject = { from: atData(say, from) };
    if (to !== undefined) {
      const toText = spotText(say, to.square, to.id);
      const squares = between(drawn, moving, spot(from), spot(to)) ?? 0;
      const seen = sees(drawn, moving, spot(from), spot(to)) === true;
      const way = walk(drawn, moving, from.square, to.square, from.id);
      reply.line("measure_distance", { from: fromText, to: toText, squares, feet: feetOf(drawn, squares) });
      reply.line(seen ? "measure_sees" : "measure_blind", { from: fromText, to: toText });
      const took = way ? moveTime(drawn.scale, way.cost, speed !== undefined && speed > 0 ? speed : undefined) : null;
      if (way && took) reply.line("measure_way", { from: fromText, to: toText, distance: way.distance, feet: feetOf(drawn, way.distance), cost: way.cost, time: timeText(say, took) });
      else reply.line("measure_no_way", { from: fromText, to: toText });
      Object.assign(data, { to: atData(say, to), squares, feet: feetOf(drawn, squares), sees: seen, way: way && took ? { squares: way.squares.map((s) => [...s]), distance: way.distance, cost: way.cost, ...tookData(took) } : null });
    }
    if (typeof range === "number") {
      const who = within(drawn, moving, spot(from), range).map((id) => whoIs(say, id));
      reply.line(who.length > 0 ? "measure_within" : "measure_within_none", { from: fromText, range, feet: feetOf(drawn, range), who });
      data.within = { range, who };
    }
    if ((area === "burst" || area === "cone" || area === "line") && typeof size === "number") {
      const covered = area === "burst" ? burst(drawn, moving, from.square, size) : area === "cone" ? cone(drawn, moving, from.square, toward?.square ?? from.square, size) : line(drawn, moving, from.square, toward?.square ?? from.square, size);
      const who = covered.who.map((id) => whoIs(say, id));
      reply.line("measure_area", { area, from: fromText, ...(toward ? { toward: spotText(say, toward.square, toward.id) } : {}), size, feet: feetOf(drawn, size), count: covered.squares.length, who });
      data.area = { kind: area, size, squares: covered.squares.map((s) => [...s]), who };
    }
    reply.data(data);
    return undefined;
  },
};

// ---------------------------------------------------------------- map_place

/** One piece of a placing, read: who, and where it goes (a square, beside someone, in a zone, on a thing, or off the map), its footprint and what it blocks. */
interface PieceAsk {
  who: Found;
  square?: Square;
  near?: Found;
  zone?: string;
  on?: Found;
  lift: boolean;
  walk: boolean;
  size?: Square;
  blocks?: Blocks;
}

const WAYS = ["square", "near", "zone", "on", "lift"];

function readPiece(o: OpContext, raw: JsonValue): PieceAsk | Unread {
  if (!isRecord(raw)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "pieces", value: JSON.stringify(raw) } };
  const who = find(o, "who", "entity", false, raw.who);
  if (isUnread(who)) return who;
  const on = raw.on === undefined || raw.on === null ? undefined : find(o, "on", "thing", false, raw.on);
  if (isUnread(on)) return on;
  const near = raw.near === undefined || raw.near === null ? undefined : find(o, "near", "entity", false, raw.near);
  if (isUnread(near)) return near;
  const square = raw.square === undefined || raw.square === null ? undefined : squareGiven(raw.square);
  if (square === null) return { line: "bad_square", fields: { n: o.n, op: o.op, field: "square", value: JSON.stringify(raw.square) } };
  const size = raw.size === undefined || raw.size === null ? undefined : squareGiven(raw.size);
  if (size === null || (size && (size[0] > FOOTPRINT_MAX || size[1] > FOOTPRINT_MAX))) return { line: "bad_size", fields: { n: o.n, op: o.op, value: JSON.stringify(raw.size), most: FOOTPRINT_MAX } };
  const blocks = raw.blocks;
  if (blocks !== undefined && blocks !== null && !(BLOCKS as readonly unknown[]).includes(blocks)) return notOneOf(o, "blocks", blocks, BLOCKS);
  const zone = typeof raw.zone === "string" && raw.zone.trim() !== "" ? raw.zone.trim() : undefined;
  const ways = [square, near, zone, on, raw.lift === true ? true : undefined].filter((x) => x !== undefined).length;
  if (ways > 1 || (ways === 0 && size === undefined && (blocks === undefined || blocks === null))) return { line: "needs_one", fields: { n: o.n, op: o.op, who: `${who.name} [${who.id}]`, fields: WAYS } };
  return {
    who,
    ...(square ? { square } : {}),
    ...(near ? { near } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(on ? { on } : {}),
    lift: raw.lift === true,
    walk: raw.walk === true,
    ...(size ? { size } : {}),
    ...(typeof blocks === "string" ? { blocks: blocks as Blocks } : {}),
  };
}

function blocksOf(b: Blocks): Piece["blocks"] {
  return { way: b === "way" || b === "both", view: b === "view" || b === "both" };
}

/** The place whose area holds a square of the grid, else the place the grid draws. */
function roomAt(layers: Layers, s: Square): PlaceId {
  const i = indexOf(layers.drawn, s);
  const zones = layers.drawn.zones;
  const room = Object.keys(zones)
    .sort()
    .find((z) => layers.world.places[z]?.parent === layers.drawn.scope && i !== null && (zones[z] ?? []).includes(i));
  return room ?? layers.drawn.scope;
}

/** Moves a person (or anything that is not a thing) to a place through today's one move path. */
function relocated(o: OpContext, who: EntityId, to: PlaceId): Unread | undefined {
  const events = relocate(o.draft.w.ctx, who, to, {});
  if ("code" in events) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: events.code } };
  const bad = o.draft.applyAll(events);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/** One piece placed on the draft: its events applied, its lines and reports said, and what it came to added to `out`. */
function placePiece(o: OpContext, at: Found, p: PieceAsk, why: string, out: JsonObject[]): Unread | undefined {
  const w = o.draft.w;
  const id = p.who.id;
  let layers = layersOn(o.reading, w.state, at);
  if (isUnread(layers)) return layers;
  const say = (): Say => ({ lines: o.call.lines, world: isUnread(layers) ? o.reading.world : layers.world, state: w.state });
  const entry: JsonObject = { who: whoIs(say(), id) };
  if (p.on) {
    if (!isThing(w.ctx, id)) return { line: "not_a_thing", fields: { n: o.n, op: o.op, what: whoIs(say(), id) } };
    const failed = putThing(o, id, { in: p.on.id }, why);
    if (failed) return failed;
    const fields = own(w.state.entities, id)?.fields;
    if (typeof fields?.x === "number" || typeof fields?.y === "number") {
      const bad = applied(o, [positionEvent(layers.drawn, id, null, null)]);
      if (bad) return bad;
    }
    layers = layersOn(o.reading, w.state, at);
    if (isUnread(layers)) return layers;
    const s = standsAt(layers.moving, id);
    if (s === null) reportAll(o, say(), [{ code: "holder_off_grid", values: { what: id, holder: p.on.id } }]);
    o.reply.line("piece_on", { what: whoIs(say(), id), holder: whoIs(say(), p.on.id), ...(s ? { square: spotText(say(), s) } : {}) });
    Object.assign(entry, { on: whoIs(say(), p.on.id), at: s ? [...s] : null });
  } else if (p.lift) {
    const was = layers.moving.pieces[id]?.at;
    if (was) {
      const bad = applied(o, [positionEvent(layers.drawn, id, null, was)]);
      if (bad) return bad;
      o.reply.line("piece_lifted", { what: whoIs(say(), id), square: spotText(say(), was) });
    } else o.reply.report("already_so", { n: o.n, op: o.op, what: whoIs(say(), id) });
    entry.at = null;
  } else if (p.square || p.near || p.zone !== undefined) {
    let to: Square | null = p.square ?? null;
    if (p.near) {
      to = beside(layers.drawn, lift(layers.moving, id), p.near.id);
      if (to === null) return { line: "no_square_near", fields: { n: o.n, op: o.op, what: whoIs(say(), id), near: whoIs(say(), p.near.id) } };
    } else if (p.zone !== undefined) {
      if (!hasOwn(layers.drawn.zones, p.zone)) return { line: "no_zone", fields: { n: o.n, op: o.op, zone: p.zone, zones: Object.keys(layers.drawn.zones).sort() } };
      to = inZone(layers.drawn, lift(layers.moving, id), p.zone);
      if (to === null) return { line: "no_square_free", fields: { n: o.n, op: o.op, zone: p.zone } };
    }
    if (to === null) return undefined;
    if (indexOf(layers.drawn, to) === null) return { line: "off_map", fields: { field: "square", column: to[0], row: to[1], place: whoIs(say(), layers.drawn.scope), width: layers.drawn.width, height: layers.drawn.height } };
    // Someone or something at another place is brought here first, and a thing lying on another comes off it.
    const here = placeOfEntity(w.state, id);
    const onGrid = here !== null && standingGrid(layers.world, here)?.scope === layers.drawn.scope;
    const held = own(w.state.entities, id)?.relations.some((rel) => rel.type === "in") === true && isThing(w.ctx, id);
    if (!onGrid || held) {
      const target = onGrid && here !== null ? here : roomAt(layers, to);
      const failed = isThing(w.ctx, id) ? putThing(o, id, { place: target }, why) : relocated(o, id, target);
      if (failed) return failed;
      if (!onGrid) {
        reportAll(o, say(), [{ code: "brought", values: { what: id, to: target, ...(here !== null ? { from: here } : {}) } }]);
        // A square kept from the place it came from is no square of this map (today's move between places keeps it).
        const kept = own(w.state.entities, id)?.fields;
        if (typeof kept?.x === "number" || typeof kept?.y === "number") {
          const bad = applied(o, [positionEvent(layers.drawn, id, null, null)]);
          if (bad) return bad;
        }
      }
      layers = layersOn(o.reading, w.state, at);
      if (isUnread(layers)) return layers;
    }
    const before = layers.moving;
    const from = before.pieces[id]?.at ?? null;
    const shape: Pick<Piece, "size" | "blocks"> = { ...(p.size ? { size: p.size } : {}), ...(p.blocks ? { blocks: blocksOf(p.blocks) } : {}) };
    const moved = p.walk && from !== null ? move(layers.drawn, before, id, to) : null;
    reportAll(o, say(), moved ? moved.reports : place(layers.drawn, before, id, to, shape).reports);
    const bad = applied(o, [positionEvent(layers.drawn, id, to, from)]);
    if (bad) return bad;
    entry.at = [...to];
    if (moved?.walk && moved.took && from !== null) {
      o.reply.line("piece_walked", { what: whoIs(say(), id), from: spotText(say(), from), to: spotText(say(), to), distance: moved.walk.distance, feet: feetOf(layers.drawn, moved.walk.distance), cost: moved.walk.cost, time: timeText(say(), moved.took) });
      entry.way = { squares: moved.walk.squares.map((s) => [...s]), distance: moved.walk.distance, cost: moved.walk.cost, ...tookData(moved.took) };
    } else o.reply.line("piece_at", { what: whoIs(say(), id), square: spotText(say(), to) });
  }
  if (p.size || p.blocks) {
    const was = layers.moving.pieces[id];
    const size = p.size ?? was?.size ?? [1, 1];
    const blocks = p.blocks ? blocksOf(p.blocks) : was?.blocks;
    const bad = applied(o, [shapeEvent(id, { size, ...(blocks ? { blocks } : {}) })]);
    if (bad) return bad;
    o.reply.line("piece_shape", { what: whoIs(say(), id), columns: size[0], rows: size[1], blocksWay: blocks?.way === true, blocksView: blocks?.view === true });
    Object.assign(entry, { size: [size[0], size[1]], blocks: { way: blocks?.way === true, view: blocks?.view === true } });
  }
  out.push(entry);
  return undefined;
}

const placeDef: WriteDef = {
  name: "map_place",
  family: FAMILY,
  lane: "engine",
  properties: {
    at: TEXT,
    pieces: { type: "array", minItems: 1, items: { type: "object", properties: { who: TEXT, square: SQUARE, near: TEXT, zone: TEXT, on: TEXT, lift: YES_NO, walk: YES_NO, size: SQUARE, blocks: oneOf(BLOCKS) }, required: ["who"] } },
    why: TEXT,
  },
  required: ["at", "pieces"],
  example: { at: "The Common Room", pieces: [{ who: "Wren", square: [6, 5] }, { who: "Bram", near: "Wren" }, { who: "lantern", on: "long table" }], standing: "assumed", source: { from: "prose", message: "m-0040" } },
  run(o) {
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const list = Array.isArray(o.args.pieces) ? o.args.pieces : [];
    if (list.length === 0) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["pieces"] } };
    // Every piece is read before any is placed: one that cannot be read refuses the call whole.
    const asked: PieceAsk[] = [];
    for (const raw of list) {
      const p = readPiece(o, raw);
      if (isUnread(p)) return p;
      asked.push(p);
    }
    const from = o.draft.w.events.length;
    const out: JsonObject[] = [];
    const why = textArg(o.args, "why") ?? "";
    for (const p of asked) {
      const failed = placePiece(o, at, p, why, out);
      if (failed) return failed;
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    o.after(() => ({ pieces: out }));
    return undefined;
  },
};

// ---------------------------------------------------------------- map_door

const doorDef: WriteDef = {
  name: "map_door",
  family: FAMILY,
  lane: "engine",
  properties: { at: TEXT, door: SQUARE, state: oneOf(DOOR_STATES), why: TEXT },
  required: ["at", "door", "state"],
  example: { at: "The Cellar", door: [5, 3], state: "locked", why: "Odile turns the key", source: { from: "prose", message: "m-0041" } },
  run(o) {
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const state = o.args.state;
    if (!(DOOR_STATES as readonly unknown[]).includes(state)) return notOneOf(o, "state", state ?? null, DOOR_STATES);
    const now = state as DoorState;
    const layers = layersOn(o.reading, o.draft.w.state, at);
    if (isUnread(layers)) return layers;
    const say: Say = { lines: o.call.lines, world: layers.world, state: o.draft.w.state };
    const square = squareOn(say, layers, "door", o.args.door);
    if (isUnread(square)) return square;
    const { drawn, moving } = layers;
    const i = indexOf(drawn, square) ?? -1;
    if (!drawn.doors.has(i)) return { line: "not_a_door", fields: { n: o.n, op: o.op, square: spotText(say, square), place: whoIs(say, drawn.scope), doors: [...drawn.doors].sort((a, b) => a - b).map((d) => spotText(say, squareAt(drawn, d))) } };
    const was = doorState(drawn, moving, i);
    const from = o.draft.w.events.length;
    if (was === now) o.reply.report("door_already", { n: o.n, op: o.op, square: spotText(say, square), state: now });
    else {
      reportAll(o, say, setDoor(drawn, moving, square, now).reports);
      const bad = applied(o, [doorEvent(drawn, square, now)]);
      if (bad) return bad;
      o.reply.line("door_set", { square: spotText(say, square), state: now, ...(was !== null ? { was } : {}) });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    o.after(() => ({ door: { at: [...square], was, now } }));
    return undefined;
  },
};

// ---------------------------------------------------------------- map_lay

/** An id for something new, from a name or an id: letters, digits and `_`, not one `taken` holds. */
function freshId(base: string, taken: (id: string) => boolean): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "map";
  let id = stem;
  for (let k = 2; taken(id); k++) id = `${stem}_${k}`;
  return id;
}

/** The rows a laying draws: as given, or a walled room of the width and height given with its doors. */
function rowsOf(o: OpContext): string[] | Unread {
  const rows = o.args.rows;
  if (Array.isArray(rows) && rows.length > 0 && rows.every((r) => typeof r === "string" && r !== "")) return rows as string[];
  if (rows !== undefined && rows !== null) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "rows", value: JSON.stringify(rows) } };
  const width = o.args.width;
  const height = o.args.height;
  if (!(typeof width === "number" && Number.isInteger(width) && width >= 1 && typeof height === "number" && Number.isInteger(height) && height >= 1)) return { line: "needs_rows", fields: { n: o.n, op: o.op } };
  const doors: Square[] = [];
  for (const d of Array.isArray(o.args.doors) ? o.args.doors : []) {
    const s = squareGiven(d);
    if (s === null) return { line: "bad_square", fields: { n: o.n, op: o.op, field: "doors", value: JSON.stringify(d) } };
    doors.push(s);
  }
  return plainRows(width, height, doors);
}

const layDef: WriteDef = {
  name: "map_lay",
  family: FAMILY,
  lane: "engine",
  properties: { place: TEXT, rows: TEXTS, width: WHOLE, height: WHOLE, doors: SQUARES, legend: OBJECT, feet: NUMBER, title: TEXT, over: TEXT, square: SQUARE },
  required: ["place"],
  example: { place: "The Far Road", width: 12, height: 8, standing: "assumed", source: { from: "prose", message: "m-0042" } },
  run(o) {
    const w = o.draft.w;
    const r = o.reading;
    const rows = rowsOf(o);
    if (isUnread(rows)) return rows;
    const legend = o.args.legend;
    if (legend !== undefined && legend !== null && !isRecord(legend)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "legend", value: JSON.stringify(legend) } };
    const feet = numberArg(o.args, "feet");
    if (feet !== undefined && !(feet > 0)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "feet", value: JSON.stringify(feet) } };
    const played = r.world;
    const laying = (scope: string): Laying => ({
      id: freshId(`${scope}_map`, (id) => hasOwn(played.maps, id) || hasOwn(played.grids, id)),
      rows,
      ...(isRecord(legend) ? { legend: legend as Record<string, MapCellDef> } : {}),
      ...(textArg(o.args, "title") !== undefined ? { title: textArg(o.args, "title") ?? "" } : {}),
      metres: feet !== undefined ? feet * METRES_PER_FOOT : laidMetres(GRID_DEFAULTS),
    });
    let laid: Laid;
    if (o.args.over !== undefined && o.args.over !== null) {
      const over = find(o, "over", "place");
      if (isUnread(over)) return over;
      const square = squareGiven(o.args.square);
      if (square === null) return o.args.square === undefined ? { line: "needs", fields: { n: o.n, op: o.op, fields: ["square"] } } : { line: "bad_square", fields: { n: o.n, op: o.op, field: "square", value: JSON.stringify(o.args.square) } };
      const said = textArg(o.args, "place") ?? "";
      const known = r.find(said, "place");
      const id = isFound(known) ? known.id : freshId(said, (x) => hasOwn(played.places, x));
      laid = layOverSquare(r.doc, w.state, over.id, square, { ...laying(id), ...(isFound(known) ? {} : { place: { id, name: said } }) });
      if (isFound(known) && laid.scope !== null && laid.scope !== known.id) return { line: "place_elsewhere", fields: { n: o.n, op: o.op, place: `${known.name} [${known.id}]`, square: spotText({ lines: o.call.lines, world: played, state: w.state }, square) } };
    } else {
      const placeFound = find(o, "place", "place");
      if (isUnread(placeFound)) return placeFound;
      laid = layForPlace(r.doc, w.state, placeFound.id, laying(placeFound.id));
    }
    const say: Say = { lines: o.call.lines, world: played, state: w.state };
    const first = laid.reports[0];
    if (laid.changes.length === 0 || laid.scope === null) return first ? { line: `grid_${first.code}`, fields: { n: o.n, op: o.op, ...reportFields(say, first.values) } } : { line: "nothing_recorded", fields: {} };
    const from = w.events.length;
    const bad = applied(o, laid.changes.map((c) => c.value as JsonObject));
    if (bad) return bad;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const scope = laid.scope;
    const now = layersAt(r.registry, r.doc, w.state, scope, GRID_DEFAULTS);
    if (now === null) return undefined;
    const after: Say = { lines: o.call.lines, world: now.world, state: w.state };
    const off = laid.changes.filter((c) => c.op === "space.pos").map((c) => (isRecord(c.value) && isRecord(c.value.data) && typeof c.value.data.entity === "string" ? whoIs(after, c.value.data.entity) : ""));
    o.reply.line("laid", { place: whoIs(after, scope), width: now.drawn.width, height: now.drawn.height, feet: feetOf(now.drawn, 1), ...stepFields(now.drawn) });
    if (off.length > 0) o.reply.line("laid_off", { who: off });
    o.after(() => ({ laid: { map: now.drawn.id, place: whoIs(after, scope), width: now.drawn.width, height: now.drawn.height, feet: feetOf(now.drawn, 1), step: { ...now.drawn.scale.step } } }));
    return undefined;
  },
};

// ---------------------------------------------------------------- map_edit

/** The strokes an edit draws, read; or what says one cannot be read. */
function strokesOf(o: OpContext): Stroke[] | Unread {
  const out: Stroke[] = [];
  for (const raw of Array.isArray(o.args.strokes) ? o.args.strokes : []) {
    if (!isRecord(raw) || typeof raw.symbol !== "string") return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "strokes", value: JSON.stringify(raw) } };
    const squares: Square[] = [];
    for (const s of Array.isArray(raw.squares) ? raw.squares : []) {
      const sq = squareGiven(s);
      if (sq === null) return { line: "bad_square", fields: { n: o.n, op: o.op, field: "squares", value: JSON.stringify(s) } };
      squares.push(sq);
    }
    const pair = (field: "rect" | "line"): readonly [Square, Square] | Unread | undefined => {
      const v = raw[field];
      if (v === undefined || v === null) return undefined;
      const a = Array.isArray(v) && v.length === 2 ? squareGiven(v[0]) : null;
      const b = Array.isArray(v) && v.length === 2 ? squareGiven(v[1]) : null;
      return a && b ? [a, b] : { line: "bad_square", fields: { n: o.n, op: o.op, field, value: JSON.stringify(v) } };
    };
    const rect = pair("rect");
    if (isUnread(rect)) return rect;
    const ln = pair("line");
    if (isUnread(ln)) return ln;
    out.push({ symbol: raw.symbol, ...(squares.length > 0 ? { squares } : {}), ...(rect ? { rect } : {}), ...(ln ? { line: ln } : {}) });
  }
  return out;
}

/** What an edit could not do at all, as the map's lines say it: the codes that leave nothing drawn. */
const EDIT_REFUSALS: Readonly<Record<string, true>> = { no_map: true, nothing_drawn: true, bad_map: true };

const editDef: WriteDef = {
  name: "map_edit",
  family: FAMILY,
  lane: "engine",
  properties: { at: TEXT, strokes: { type: "array", items: { type: "object", properties: { symbol: TEXT, squares: SQUARES, rect: TWO_SQUARES, line: TWO_SQUARES }, required: ["symbol"] } }, legend: OBJECT },
  required: ["at"],
  example: { at: "The Cellar", strokes: [{ symbol: "#", squares: [[5, 3]] }, { symbol: "t", rect: [[6, 2], [7, 2]] }], legend: { t: { terrain: "table", blocked: true } }, source: { from: "gm" } },
  run(o) {
    const w = o.draft.w;
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const layers = layersOn(o.reading, w.state, at);
    if (isUnread(layers)) return layers;
    const strokes = strokesOf(o);
    if (isUnread(strokes)) return strokes;
    const legend = o.args.legend ?? {};
    if (!isRecord(legend)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "legend", value: JSON.stringify(legend) } };
    const say: Say = { lines: o.call.lines, world: layers.world, state: w.state };
    const done = editMap(o.reading.doc, w.state, layers.drawn.scope, strokes, legend as Record<string, MapCellDef | null>);
    const refusal = done.reports.find((rep) => EDIT_REFUSALS[rep.code]);
    if (done.changes.length === 0 || refusal) {
      const why = refusal ?? done.reports[0];
      return why ? { line: `grid_${why.code}`, fields: { n: o.n, op: o.op, ...reportFields(say, why.values) } } : { line: "nothing_recorded", fields: {} };
    }
    reportAll(o, say, done.reports);
    const from = w.events.length;
    const bad = applied(o, done.changes.map((c) => c.value as JsonObject));
    if (bad) return bad;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const value = done.changes[0]?.value;
    const count = isRecord(value) && isRecord(value.data) && Array.isArray(value.data.squares) ? value.data.squares.length : 0;
    o.reply.line("edited", { place: whoIs(say, layers.drawn.scope), count, symbols: Object.keys(legend) });
    o.after(() => ({ edited: { map: layers.drawn.map ?? layers.drawn.id, squares: count, legend: Object.keys(legend) } }));
    return undefined;
  },
};

/** The map tools, as RPH's search finds them. */
export const MAP_TOOLS: readonly ToolSpec[] = [readTool(view), readTool(measure), writeTool(placeDef), writeTool(doorDef), writeTool(layDef), writeTool(editDef)].map(mapTool);
