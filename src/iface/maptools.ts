// The map tools (plan §8.2): `map_view`, `map_measure`, `map_place`, `map_door`, `map_lay` and
// `map_edit`, found by `tool_search` and pinned for the GM by its definition. Each is a spec in code
// (its arguments, a worked call, what it runs) with its words in files: its description and each
// argument's text in `.tools/<name>.md`, every sentence of its answers in `.prompts/map-answers.md`.
// A read answers from the state at the call's turn. A write is one operation, run as every
// searchable write is (`families/run.ts`): what it cannot read refuses the call before anything is
// recorded, the user's setting for the engine lane is asked, and the rest is applied, recorded in one
// write, and reported where it does not add up (a square in a wall, no way there, a room with no
// free square). Squares are [column, row], counted from 1 at the top left, as the map prints them.
// Only what does not exist is refused, and the answer says what does: a square off the map or on a
// place with no map (with `map_lay` and the places that have one), a name that is not there (with its
// near names), a door where there is none (with the doors), input that cannot be read (with where);
// a read where there is no map, or about someone on no square, is answered with that fact.
//
// The turn (`src/turn/`) gives the engine's tools, with `lines = await mapLines(files)` read from the chat's
// files: `deps.grid = gridMoves(lines)` (squares for `world_apply`'s `move` and `place`, with what
// their answer says of it) and `deps.map = mapView(lines)` (the map in the world state and in
// `world_query`).

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { EntityId, PlaceId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { standingGrid } from "../shared/grid";
import { readMap } from "../shared/maps";
import type { MapCellDef } from "../shared/world";
import { own } from "../engine/pack-kit";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { isThing } from "../engine/things";
import { DOOR_STATES, MAP_SIDE_MAX, type DoorState } from "../packs/space/core/grid-play";
import type { ChangeInput, Report } from "../store/types";
import { foundIn, readTool, writeTool, type ReadDef, type WriteDef } from "./families/run";
import { NUMBER, OBJECT, oneOf, Reply, TEXT, TEXTS, WHOLE, YES_NO, type Call, type ToolSpec } from "./kit";
import { editMap, type Stroke } from "./map/edit";
import { type Fixture, fixtureAt } from "./map/fixture";
import { MAP_DEFAULTS, METRES_PER_FOOT, type MapConfig } from "../shared/map-config";
import { between, burst, cone, coverOf, cube, line, sightOf, within, type Spot } from "../packs/space/core/grid-measure";
import { doorState, indexOf, lift, moveTime, place, runsOf, setDoor, squareAt, standsAt, type Piece, type Square, type Took } from "../packs/space/core/grid-model";
import { move, walk } from "../packs/space/core/grid-path";
import { idFrom, layForPlace, layOverSquare, plainRows, type Laid, type Laying, type Named } from "./map/lay";
import { TODAY_TOOLS } from "./map/today";
import { beside, inZone, softPositions, stackedOn } from "./map/moves";
import { doorEvent, draftChange, positionEvent, shapeEvent } from "./map/record";
import { distanceData, farText, layersAt, mapsNear, mapWording, mapWords, reportFields, type MapWording, type Say, spotText, squareGiven, stepFields, timeText, whereWords, whoIs, type Layers } from "./map/words";
import { NO_LAYOUT } from "./map/layout";
import { find, isUnread, notOneOf, numberArg, textArg, type OpContext, type Unread } from "./ops";
import { keepWhere, makeThing, moveTo, noSoft, putOnSupport, putThing } from "./ops-things";
import { type Found, isFound, type Reading } from "./reading";
import { PROVENANCE_PROPERTIES, type Provenance, provenanceData, provenanceOf } from "./source";
import { textOf } from "./texts";

const FAMILY = "map";

/** A square as the tools take it: [column, row], counted from 1. */
const SQUARE: JsonObject = { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, maxItems: 2 };
/** Someone or something on the map by name, or a square. */
const SPOT: JsonObject = { anyOf: [TEXT, SQUARE] };
const SQUARES: JsonObject = { type: "array", items: SQUARE };
const TWO_SQUARES: JsonObject = { type: "array", items: SQUARE, minItems: 2, maxItems: 2 };

const AREAS = ["burst", "cone", "line", "cube"] as const;
const BLOCKS = ["way", "view", "both", "none"] as const;
type Blocks = (typeof BLOCKS)[number];

// ---------------------------------------------------------------- what every map tool shares

/** What each call's map wording is: the answers' lines are `call.lines`, and the layout lays a map out (`map_view`). */
const WORDING = new WeakMap<Call, MapWording>();

/** A map tool answers in the lines of the map's part, not the engine's, and prints a map as the layout lays it out. */
function mapTool(spec: ToolSpec): ToolSpec {
  return {
    ...spec,
    async run(args, call) {
      const wording = await mapWording(call.deps.files);
      const mapped: Call = { ...call, lines: wording.lines, reply: () => new Reply(wording.lines) };
      WORDING.set(mapped, wording);
      return spec.run(args, mapped);
    },
  };
}

/** A square or someone on the map, as a measure or a placing takes it: where it stands, and who, when named. */
interface At {
  square: Square;
  id?: EntityId;
}

/** Someone or something named that stands on no square of the map: a measure says so, with where they are kept besides, and measures what it can. */
interface Unplaced {
  unplaced: Found;
}

function tookData(took: Took): JsonObject {
  return { seconds: took.seconds, ...(took.rounds !== undefined ? { rounds: took.rounds } : {}) };
}

/** The map's settings for the chat a call is in. */
function configOf(call: Call): MapConfig {
  return call.deps.mapSettings ?? MAP_DEFAULTS;
}

/** The place a call is about: the place `at` names, or the one the someone or something it names is at; null when it is at none. */
function placeOfAt(state: Readonly<WorldState>, at: Found): PlaceId | null {
  return at.ref.startsWith("place:") ? at.id : placeOfEntity(state, at.id);
}

/** What there is where there is no map: what is kept there by zone or words, and the places near that have a map, so the answer says how a grid is laid (`map_lay`) and what to go by meanwhile. */
function noGrid(r: Reading, state: Readonly<WorldState>, at: Found, call: Call): Unread {
  const here = placeOfAt(state, at);
  const say: Say = { lines: call.lines, world: r.world, state };
  const soft = here === null ? [] : softPositions(r.world, state, here);
  const maps = mapsNear(r.world, state, here, call.settings.nearMatches);
  const inPlace = !at.ref.startsWith("place:") && here !== null ? { place: whoIs(say, here) } : {};
  return { line: "no_grid", fields: { at: whoIs(say, at.id), ...inPlace, soft: soft.join("; "), maps: textOf(maps) }, data: { soft, maps } };
}

/** The grid of the place `at` names, or the one the someone or something it names stands on, as `state` has it; or the line that says there is none. */
function layersOn(r: Reading, state: Readonly<WorldState>, at: Found, call: Call): Layers | Unread {
  const placeId = placeOfAt(state, at);
  const layers = placeId === null ? null : layersAt(r.registry, r.doc, state, placeId, configOf(call));
  return layers ?? noGrid(r, state, at, call);
}

/** A read where there is no map is answered with that fact, as the line and as data; the call is not refused. */
function answerNoGrid(reply: Reply, none: Unread): undefined {
  reply.line(none.line, none.fields);
  reply.data({ map: null, ...(none.data ?? {}) });
  return undefined;
}

/** A square on the map `layers` draws, as an argument gives it; or the line that says it cannot be read, or lies off the map. */
function squareOn(say: Say, layers: Layers, field: string, v: JsonValue | undefined): Square | Unread {
  const s = squareGiven(v);
  if (s === null) return { line: "bad_square", fields: { field, value: JSON.stringify(v ?? null) } };
  const { drawn } = layers;
  return indexOf(drawn, s) !== null ? s : { line: "off_map", fields: { field, column: s[0], row: s[1], place: whoIs(say, drawn.scope), width: drawn.width, height: drawn.height } };
}

/** A spot an argument gives: a square on the map, or someone or something `findName` finds, that stands on it or on none. */
function spotOn(say: Say, layers: Layers, field: string, v: JsonValue | undefined, findName: (said: string) => Found | Unread): At | Unplaced | Unread {
  if (typeof v !== "string") {
    const s = squareOn(say, layers, field, v);
    return isUnread(s) ? s : { square: s };
  }
  const f = findName(v);
  if (isUnread(f)) return f;
  const s = standsAt(layers.moving, f.id);
  return s ? { square: s, id: f.id } : { unplaced: f };
}

/** Says that someone stands on no square of the map, and where they are kept besides (a zone or words); that as data. */
function notOnMap(reply: Reply, say: Say, layers: Layers, field: string, who: Found): JsonObject {
  const words = whereWords(say.state, who.id);
  reply.line("not_on_map", { field, name: whoIs(say, who.id), place: whoIs(say, layers.drawn.scope), ...(words !== undefined ? { words } : {}) });
  return { who: whoIs(say, who.id), at: null, ...(words !== undefined ? { where: words } : {}) };
}

function atData(say: Say, at: At): JsonObject {
  return { at: [...at.square], ...(at.id !== undefined ? { who: whoIs(say, at.id) } : {}) };
}

/** Applies events the grid's records make on the draft; what says the first did not apply, when one does not (the engine's own reason is in the answer: `unreadAs`). */
function applied(o: OpContext, events: readonly JsonObject[]): Unread | undefined {
  // The grid's records are today's events, written as JSON.
  const ledger = events as unknown as readonly LedgerEvent[];
  const bad = o.draft.applyAll(ledger);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/** Events code chose the square for, applied as filled in: each recorded as a change of its own that stands as assumed, from the default (`FILLED_IN`), whatever the call's own provenance. */
function appliedFilled(o: OpContext, events: readonly JsonObject[]): Unread | undefined {
  const bad = o.draft.fillWith(events as unknown as readonly LedgerEvent[]);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/**
 * The changes of a laying or an edit applied on the draft. One that stands as assumed from the
 * default (a grid laid with no square's width given, squares drawn with a symbol no legend names) is
 * filled in: recorded as a change of its own, with standing assumed and source default
 * (`FILLED_IN`), whatever the call's own provenance.
 */
function applyLaid(o: OpContext, changes: readonly ChangeInput[]): Unread | undefined {
  for (const c of changes) {
    const bad = c.standing === "assumed" && c.source === "default" ? appliedFilled(o, [c.value as JsonObject]) : applied(o, [c.value as JsonObject]);
    if (bad) return bad;
  }
  return undefined;
}

/** Each of the grid's reports as its line (`grid_<code>`), with the operation's number and name: what the grid says does not add up, or was read or done otherwise than asked. */
function reportAll(o: OpContext, say: Say, reports: readonly Report[]): void {
  for (const r of reports) o.reply.report(`grid_${r.code}`, { n: o.n, op: o.op, ...reportFields(say, r.values) });
}

/** The kinds of square a legend entry may name in words. */
const SQUARE_KINDS: readonly string[] = ["wall", "floor", "door"];

/** Whether the map's format holds `cell` as what `symbol` stands for. */
function formatHolds(symbol: string, cell: unknown): boolean {
  return readMap({ id: "legend", scope: "legend", legend: { [symbol]: cell } }).problems.length === 0;
}

/** A legend entry read from words: what the format holds for it, and the words it was named by, when it was, with whether it blocks. */
interface WordsRead {
  symbol: string;
  words: string;
  blocks: boolean;
}

/**
 * A legend entry the format does not hold as given, read: a kind of square named (wall, floor,
 * door); words, as a square of floor named by them, or one nobody walks through where the entry says
 * `blocks: true` or names a wall as its kind. Whether words say it blocks is never judged from them.
 * Null when it reads as none of these.
 */
function cellFrom(value: JsonValue): { cell: MapCellDef; words?: string; blocks: boolean } | null {
  const text = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");
  if (typeof value === "string") {
    const kind = text(value).toLowerCase();
    if (SQUARE_KINDS.includes(kind)) return { cell: kind as MapCellDef, blocks: false };
    return text(value) === "" ? null : { cell: { terrain: text(value) }, words: text(value), blocks: false };
  }
  if (!isRecord(value)) return null;
  const kind = text(value.kind).toLowerCase();
  const words = text(value.terrain) || text(value.name);
  const blocks = value.blocks === true || value.blocked === true || kind === "wall";
  if (kind === "door" || (words === "" && SQUARE_KINDS.includes(kind))) return { cell: kind as MapCellDef, blocks };
  if (words === "") return null;
  const cell = { terrain: words, ...(blocks ? { blocked: true } : {}), ...(blocks && value.seeThrough === true ? { seeThrough: true } : {}) };
  return { cell, words, blocks };
}

/**
 * A legend as a call gives it, entry by entry: what the map's format holds kept as it is, the rest
 * read by `cellFrom`, and the entries read from words listed so the answer says how. A symbol of
 * more than one character, or an entry that reads as nothing the format holds, is answered with
 * what a legend entry holds. A null takes a symbol out, where the tool can (`out`).
 */
function legendGiven(o: OpContext, raw: JsonValue | undefined, out: boolean): { legend: Record<string, MapCellDef | null>; read: WordsRead[] } | Unread {
  const legend: Record<string, MapCellDef | null> = {};
  const read: WordsRead[] = [];
  if (raw === undefined || raw === null) return { legend, read };
  if (!isRecord(raw)) return { line: "legend_unreadable", fields: { n: o.n, op: o.op, value: JSON.stringify(raw) } };
  for (const [symbol, value] of Object.entries(raw)) {
    if (value === null) {
      if (out) legend[symbol] = null;
      continue;
    }
    const got = [...symbol].length !== 1 ? null : formatHolds(symbol, value) ? { cell: value as MapCellDef, blocks: false } : cellFrom(value);
    if (got === null || !formatHolds(symbol, got.cell)) return { line: "legend_unreadable", fields: { n: o.n, op: o.op, symbol, value: JSON.stringify(value) } };
    legend[symbol] = got.cell;
    if ("words" in got && got.words !== undefined) read.push({ symbol, words: got.words, blocks: got.blocks });
  }
  return { legend, read };
}

/** How each legend entry given in words was read, as the map's lines say it. */
function sayRead(o: OpContext, read: readonly WordsRead[]): void {
  for (const r of read) o.reply.line(r.blocks ? "legend_read_blocks" : "legend_read_floor", { op: o.op, symbol: r.symbol, words: r.words });
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
    const layers = layersOn(r, r.state.world, at, call);
    if (isUnread(layers)) return answerNoGrid(reply, layers);
    const say: Say = { lines: call.lines, world: layers.world, state: r.state.world };
    const asked = args.centre === undefined || args.centre === null ? undefined : spotOn(say, layers, "centre", args.centre, (s) => foundIn(r, "centre", s, "entity"));
    if (asked !== undefined && isUnread(asked)) return asked;
    // A centre who stands on no square is said so, and the map is shown as it is with none.
    const lost = asked !== undefined && "unplaced" in asked ? notOnMap(reply, say, layers, "centre", asked.unplaced) : undefined;
    const centre = asked !== undefined && !("unplaced" in asked) ? asked : undefined;
    const wording = WORDING.get(call) ?? { lines: call.lines, layout: NO_LAYOUT };
    const { text, grid, drawn, printed } = mapWords(wording, layers, r.state.world, { config: configOf(call), facts: r.state.facts, ...(centre ? { centre: centre.square } : {}) });
    reply.tree(text);
    reply.data({ map: grid, drawn, place: whoIs(say, printed.scope), from: [...printed.from], to: [...printed.to], whole: printed.whole, ...(lost ? { unplaced: [lost] } : {}) });
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
    const layers = layersOn(r, r.state.world, where, call);
    if (isUnread(layers)) return answerNoGrid(reply, layers);
    const say: Say = { lines: call.lines, world: layers.world, state: r.state.world };
    const named = (field: string) => (s: string) => foundIn(r, field, s, "entity");
    const from = spotOn(say, layers, "from", args.from, named("from"));
    if (isUnread(from)) return from;
    const to = args.to === undefined || args.to === null ? undefined : spotOn(say, layers, "to", args.to, named("to"));
    if (to !== undefined && isUnread(to)) return to;
    const range = args.within;
    if (range !== undefined && range !== null && !(typeof range === "number" && Number.isInteger(range) && range >= 0)) return { line: "unreadable", fields: { field: "within", value: JSON.stringify(range) } };
    const area = args.area;
    // A list a line both tests and says is given as one text, so the line says it once (`notOneOf`).
    if (area !== undefined && area !== null && !(AREAS as readonly unknown[]).includes(area)) return { line: "unreadable", fields: { field: "area", value: JSON.stringify(area), choices: textOf(AREAS) } };
    const size = args.size;
    if (area !== undefined && area !== null && !(typeof size === "number" && Number.isInteger(size) && size >= 0)) return { line: "needs_field", fields: { field: "size" } };
    const aimed = area === "cone" || area === "line" || area === "cube" ? spotOn(say, layers, "toward", args.toward ?? undefined, named("toward")) : undefined;
    if (aimed !== undefined && isUnread(aimed)) return aimed;
    if (to === undefined && (range === undefined || range === null) && (area === undefined || area === null)) return { line: "needs_any", fields: { fields: ["to", "within", "area"] } };
    // What can be measured is: someone on no square is said to be, with where they are kept, and what depends on their square is left out.
    const lost: JsonObject[] = [];
    const placed = (field: string, s: At | Unplaced | undefined): At | undefined => {
      if (s === undefined || !("unplaced" in s)) return s;
      lost.push(notOnMap(reply, say, layers, field, s.unplaced));
      return undefined;
    };
    const start = placed("from", from);
    const end = placed("to", to);
    const toward = placed("toward", aimed);
    const speed = numberArg(args, "speed");
    const { drawn, moving } = layers;
    const spot = (a: At): Spot => a.id ?? a.square;
    const data: JsonObject = {};
    if (start !== undefined) {
      data.from = atData(say, start);
      const fromText = spotText(say, start.square, start.id);
      if (end !== undefined) {
        const toText = spotText(say, end.square, end.id);
        const squares = between(drawn, moving, spot(start), spot(end)) ?? 0;
        const sight = sightOf(drawn, moving, spot(start), spot(end));
        const way = walk(drawn, moving, start.square, end.square, start.id, end.id);
        reply.line("measure_distance", { from: fromText, to: toText, squares, far: farText(call.lines, drawn, squares) });
        // Sight as facts: a clear line, within the sight radius, to a target that stands lit; what is seen is the GM's ruling.
        if (sight === null || !sight.clear) reply.line("measure_blind", { from: fromText, to: toText });
        else if (!sight.seen) reply.line("measure_sees_beyond", { from: fromText, to: toText, radius: sight.radius, farRadius: farText(call.lines, drawn, sight.radius), dark: !sight.lit });
        else reply.line(sight.lit ? "measure_sees" : "measure_sees_dark", { from: fromText, to: toText });
        // What stands between them: the cover the one has from the other, by the rule in force.
        const cover = coverOf(drawn, moving, spot(start), spot(end));
        const by = (cover?.by ?? []).map((b) => (own(say.state.entities, b) !== undefined ? whoIs(say, b) : b));
        if (cover) reply.line(cover.degree === "none" ? "measure_no_cover" : "measure_cover", { from: fromText, to: toText, degree: cover.degree, by: textOf(by) });
        const took = way ? moveTime(drawn.scale, way.cost, speed !== undefined && speed > 0 ? speed : undefined) : null;
        if (way && took) reply.line("measure_way", { from: fromText, to: toText, distance: way.distance, far: farText(call.lines, drawn, way.distance), cost: way.cost, time: timeText(say, took) });
        else reply.line("measure_no_way", { from: fromText, to: toText });
        Object.assign(data, { to: atData(say, end), squares, distance: distanceData(drawn, squares), sees: sight?.seen === true, clear: sight?.clear === true, lit: sight?.lit === true, radius: sight?.radius ?? drawn.radius, ...(cover ? { cover: { degree: cover.degree, blocked: cover.blocked, of: 4, by } } : {}), way: way && took ? { squares: way.squares.map((s) => [...s]), distance: way.distance, cost: way.cost, ...tookData(took) } : null });
      }
      if (typeof range === "number") {
        const who = within(drawn, moving, spot(start), range).map((id) => whoIs(say, id));
        reply.line(who.length > 0 ? "measure_within" : "measure_within_none", { from: fromText, range, far: farText(call.lines, drawn, range), who });
        data.within = { range, who };
      }
      if ((area === "burst" || ((area === "cone" || area === "line" || area === "cube") && toward !== undefined)) && typeof size === "number") {
        const aim = toward?.square ?? start.square;
        const covered = area === "burst" ? burst(drawn, moving, start.square, size) : area === "cone" ? cone(drawn, moving, start.square, aim, size) : area === "line" ? line(drawn, moving, start.square, aim, size) : cube(drawn, moving, start.square, aim, size);
        const who = covered.who.map((id) => whoIs(say, id));
        reply.line("measure_area", { area, from: fromText, ...(toward ? { toward: spotText(say, toward.square, toward.id) } : {}), size, far: farText(call.lines, drawn, size), count: covered.squares.length, who: textOf(who) });
        // The squares as runs by row, so a large area is no longer than the grid's rows.
        data.area = { kind: area, size, count: covered.squares.length, runs: runsOf(covered.squares), who };
      }
    }
    if (lost.length > 0) data.unplaced = lost;
    reply.data(data);
    return undefined;
  },
};

// ---------------------------------------------------------------- map_place

/** One piece of a placing, read: who, and where it goes (a square, beside someone, in a zone, on a thing, or off the map), its footprint and what it blocks, and the source and standing it names for itself. */
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
  prov?: Provenance;
}

const WAYS = ["square", "near", "zone", "on", "lift"];

/** What a piece names of its own source, precision and standing, over the call's own (what it leaves out is the call's); undefined when it names none, or what cannot be read. */
function pieceProvenance(o: OpContext, raw: JsonObject): Provenance | Unread | undefined {
  if (raw.source === undefined && raw.precision === undefined && raw.standing === undefined) return undefined;
  const merged: JsonObject = {};
  for (const key of Object.keys(PROVENANCE_PROPERTIES)) {
    const v = raw[key] ?? o.args[key];
    if (v !== undefined) merged[key] = v;
  }
  const prov = provenanceOf(merged, o.call.agent);
  return "field" in prov ? { line: "unreadable_op", fields: { n: o.n, op: o.op, field: `pieces.${prov.field}`, value: JSON.stringify(prov.value), choices: textOf(prov.choices) } } : prov;
}

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
  if (size === null || (size && (size[0] > MAP_SIDE_MAX || size[1] > MAP_SIDE_MAX))) return { line: "bad_size", fields: { n: o.n, op: o.op, value: JSON.stringify(raw.size), most: MAP_SIDE_MAX } };
  const blocks = raw.blocks;
  if (blocks !== undefined && blocks !== null && !(BLOCKS as readonly unknown[]).includes(blocks)) return notOneOf(o, "blocks", blocks, BLOCKS);
  const prov = pieceProvenance(o, raw);
  if (prov !== undefined && isUnread(prov)) return prov;
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
    ...(prov ? { prov } : {}),
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

/** A square asked for at a place with no map of squares: nothing to put it on, and the answer says what there is instead (`map_lay`, what is kept by zone or words, the places near that have a map). */
function noSquare(o: OpContext, r: Reading, state: Readonly<WorldState>, at: Found, who: EntityId, square: Square): Unread {
  const none = noGrid(r, state, at, o.call);
  const say: Say = { lines: o.call.lines, world: r.world, state };
  const here = placeOfAt(state, at);
  return { line: "no_square_no_map", fields: { n: o.n, op: o.op, what: whoIs(say, who), square: spotText(say, square), place: whoIs(say, here ?? at.id), soft: none.fields.soft ?? "", maps: none.fields.maps ?? "" }, ...(none.data ? { data: none.data } : {}) };
}

/** One piece placed on the draft: its events applied, its lines and reports said, and what it came to added to `out`. */
function placePiece(o: OpContext, at: Found, p: PieceAsk, why: string, out: JsonObject[]): Unread | undefined {
  const w = o.draft.w;
  const id = p.who.id;
  // A place with no map has no squares to stand on: a zone or words stay as the position, a square is what does not exist.
  const refresh = (): Layers | null => {
    const l = layersOn(o.reading, w.state, at, o.call);
    return isUnread(l) ? null : l;
  };
  let layers = refresh();
  const room = placeOfAt(w.state, at);
  const say = (): Say => ({ lines: o.call.lines, world: layers?.world ?? o.reading.world, state: w.state });
  const entry: JsonObject = { who: whoIs(say(), id), ...(p.prov ? provenanceData(p.prov) : {}) };
  // What the piece names of its own source and standing marks the events it makes, apart from the call's.
  let cursor = w.events.length;
  const flush = (): void => {
    if (p.prov !== undefined) o.draft.markFilled(w.events.slice(cursor), p.prov);
    cursor = w.events.length;
  };
  const stale = (): Unread | undefined => {
    const fields = own(w.state.entities, id)?.fields;
    return typeof fields?.x === "number" || typeof fields?.y === "number" ? applied(o, [positionEvent({ scope: layers?.drawn.scope ?? room ?? "" }, id, null, null)]) : undefined;
  };
  /** Someone or something at another place is brought to `to` first, and a thing lying on another comes off it. */
  const bring = (to: PlaceId | null): Unread | undefined => {
    const here = placeOfEntity(w.state, id);
    const onGrid = layers !== null && here !== null && standingGrid(layers.world, here)?.scope === layers.drawn.scope;
    const held = own(w.state.entities, id)?.relations.some((rel) => rel.type === "in") === true && isThing(w.ctx, id);
    if (onGrid && !held) return undefined;
    const target = onGrid && here !== null ? here : to;
    if (target === null || (!layers && !held && target === here)) return undefined;
    const failed = moveTo(o, id, target);
    if (failed) return failed;
    flush();
    if (!onGrid) {
      reportAll(o, say(), [{ code: "brought", values: { what: id, to: target, ...(here !== null ? { from: here } : {}) } }]);
      // A square kept from the place it came from is no square of this map (today's move between places keeps it).
      const bad = stale();
      if (bad) return bad;
      flush();
    }
    layers = refresh();
    return undefined;
  };
  if (p.on) {
    // On something (a table, a cart): a thing or someone shares its square and goes where it goes, with no holder's rules.
    const failed = isThing(w.ctx, id) ? putThing(o, id, { on: p.on.id }, why) : putOnSupport(o, id, p.on.id);
    if (failed) return failed;
    flush();
    const bad = stale();
    if (bad) return bad;
    flush();
    layers = refresh();
    const s = layers ? standsAt(layers.moving, id) : null;
    if (layers && s === null) reportAll(o, say(), [{ code: "holder_off_grid", values: { what: id, holder: p.on.id } }]);
    o.reply.line("piece_on", { what: whoIs(say(), id), holder: whoIs(say(), p.on.id), ...(s ? { square: spotText(say(), s) } : {}) });
    Object.assign(entry, { on: whoIs(say(), p.on.id), at: s ? [...s] : null });
  } else if (p.lift) {
    const was = layers?.moving.pieces[id]?.at;
    if (layers && was) {
      const bad = applied(o, [positionEvent(layers.drawn, id, null, was)]);
      if (bad) return bad;
      flush();
      o.reply.line("piece_lifted", { what: whoIs(say(), id), square: spotText(say(), was) });
    } else o.reply.line("already_so", { n: o.n, op: o.op, what: whoIs(say(), id) });
    entry.at = null;
  } else if (p.square || p.near || p.zone !== undefined) {
    let to: Square | null = p.square ?? null;
    // The square code chose (beside someone, in a zone) is an assumption, and in a crowded room one that someone stands on; with none to give, the words or the zone are the position.
    let chosen = false;
    let crowded = false;
    let kept: "kept_no_map" | "kept_nowhere" | "kept_no_zone" | null = null;
    if (layers === null) {
      if (p.square) return noSquare(o, o.reading, w.state, at, id, p.square);
      kept = "kept_no_map";
    } else if (p.near) {
      const others = lift(layers.moving, id);
      if (standsAt(others, p.near.id) !== null) {
        to = beside(layers.drawn, others, p.near.id);
        if (to === null) [to, crowded] = [beside(layers.drawn, others, p.near.id, true), true];
      }
      chosen = to !== null;
      if (to === null) kept = "kept_nowhere";
    } else if (p.zone !== undefined) {
      const others = lift(layers.moving, id);
      if (hasOwn(layers.drawn.zones, p.zone)) {
        to = inZone(layers.drawn, others, p.zone);
        if (to === null) [to, crowded] = [inZone(layers.drawn, others, p.zone, true), true];
      }
      chosen = to !== null;
      if (to === null) kept = "kept_no_zone";
    }
    if (kept !== null) {
      const failed = bring(room);
      if (failed) return failed;
      const words = p.near ? [`near ${o.reading.nameOf(p.near.id)}`] : [];
      const stays = keepWhere(o, id, { ...noSoft(), words, ...(p.zone !== undefined ? { zone: p.zone } : {}) });
      if (stays) return stays;
      flush();
      const shown = p.near ? (words[0] ?? "") : (p.zone ?? "");
      reportAll(o, say(), [{ code: kept, values: { what: id, place: layers?.drawn.scope ?? room ?? at.id, ...(p.near ? { near: p.near.id } : {}), ...(p.zone !== undefined ? { zone: p.zone } : {}), kept: shown } }]);
      entry.at = null;
      entry.kept = shown;
    } else if (to !== null && layers !== null) {
      if (indexOf(layers.drawn, to) === null) return { line: "off_map", fields: { field: "square", column: to[0], row: to[1], place: whoIs(say(), layers.drawn.scope), width: layers.drawn.width, height: layers.drawn.height } };
      const failed = bring(roomAt(layers, to));
      if (failed) return failed;
      if (layers === null) return undefined;
      const before = layers.moving;
      const from = before.pieces[id]?.at ?? null;
      const shape: Pick<Piece, "size" | "blocks"> = { ...(p.size ? { size: p.size } : {}), ...(p.blocks ? { blocks: blocksOf(p.blocks) } : {}) };
      const moved = p.walk && from !== null ? move(layers.drawn, before, id, to) : null;
      const told = moved ? moved.reports : place(layers.drawn, before, id, to, shape).reports;
      reportAll(o, say(), crowded ? [...told, ...stackedOn(layers.drawn, lift(before, id), id, to, told)] : told);
      const bad = chosen ? appliedFilled(o, [positionEvent(layers.drawn, id, to, from)]) : applied(o, [positionEvent(layers.drawn, id, to, from)]);
      if (bad) return bad;
      if (chosen) cursor = w.events.length;
      else flush();
      // Put on a square, it leaves the words it had behind.
      const stays = keepWhere(o, id, { ...noSoft(), squared: true });
      if (stays) return stays;
      flush();
      entry.at = [...to];
      if (moved?.walk && moved.took && from !== null) {
        o.reply.line("piece_walked", { what: whoIs(say(), id), from: spotText(say(), from), to: spotText(say(), to), distance: moved.walk.distance, far: farText(o.call.lines, layers.drawn, moved.walk.distance), cost: moved.walk.cost, time: timeText(say(), moved.took) });
        entry.way = { squares: moved.walk.squares.map((s) => [...s]), distance: moved.walk.distance, cost: moved.walk.cost, ...tookData(moved.took) };
      } else o.reply.line("piece_at", { what: whoIs(say(), id), square: spotText(say(), to) });
    }
  }
  if (p.size || p.blocks) {
    const was = layers?.moving.pieces[id];
    const size = p.size ?? was?.size ?? [1, 1];
    const blocks = p.blocks ? blocksOf(p.blocks) : was?.blocks;
    const bad = applied(o, [shapeEvent(id, { size, ...(blocks ? { blocks } : {}) })]);
    if (bad) return bad;
    flush();
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
    pieces: { type: "array", minItems: 1, items: { type: "object", properties: { who: TEXT, square: SQUARE, near: TEXT, zone: TEXT, on: TEXT, lift: YES_NO, walk: YES_NO, size: SQUARE, blocks: oneOf(BLOCKS), ...PROVENANCE_PROPERTIES }, required: ["who"] } },
    why: TEXT,
  },
  required: ["at", "pieces"],
  example: { at: "The Common Room", pieces: [{ who: "Wren", square: [6, 5], source: { from: "prose", message: "m-0040" } }, { who: "Bram", near: "Wren", standing: "assumed" }, { who: "lantern", on: "long table" }], source: { from: "prose", message: "m-0040" } },
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
  properties: { at: TEXT, door: SQUARE, state: oneOf(DOOR_STATES) },
  required: ["at", "door", "state"],
  example: { at: "The Cellar", door: [5, 3], state: "locked", source: { from: "prose", message: "m-0041" } },
  run(o) {
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const state = o.args.state;
    if (!(DOOR_STATES as readonly unknown[]).includes(state)) return notOneOf(o, "state", state ?? null, DOOR_STATES);
    const now = state as DoorState;
    const layers = layersOn(o.reading, o.draft.w.state, at, o.call);
    if (isUnread(layers)) return layers;
    const say: Say = { lines: o.call.lines, world: layers.world, state: o.draft.w.state };
    const square = squareOn(say, layers, "door", o.args.door);
    if (isUnread(square)) return square;
    const { drawn, moving } = layers;
    const i = indexOf(drawn, square) ?? -1;
    if (!drawn.doors.has(i)) return { line: "not_a_door", fields: { n: o.n, op: o.op, square: spotText(say, square), place: whoIs(say, drawn.scope), doors: textOf([...drawn.doors].sort((a, b) => a - b).map((d) => spotText(say, squareAt(drawn, d)))) } };
    const was = doorState(drawn, moving, i);
    const from = o.draft.w.events.length;
    if (was === now) o.reply.line("door_already", { n: o.n, op: o.op, square: spotText(say, square), state: now });
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

/** The rows a laying draws: as given, or a walled room of the width and height given with its doors; a map larger than the format holds is answered with the most it takes. */
function rowsOf(o: OpContext): string[] | Unread {
  const tooLarge = (width: number, height: number): Unread => ({ line: "too_large", fields: { n: o.n, op: o.op, width, height, most: MAP_SIDE_MAX } });
  const rows = o.args.rows;
  if (Array.isArray(rows) && rows.length > 0 && rows.every((r) => typeof r === "string" && r !== "")) {
    const wide = Math.max(...rows.map((r) => [...String(r)].length));
    return rows.length > MAP_SIDE_MAX || wide > MAP_SIDE_MAX ? tooLarge(wide, rows.length) : (rows as string[]);
  }
  if (rows !== undefined && rows !== null) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "rows", value: JSON.stringify(rows) } };
  const width = o.args.width;
  const height = o.args.height;
  if (!(typeof width === "number" && Number.isInteger(width) && width >= 1 && typeof height === "number" && Number.isInteger(height) && height >= 1)) return { line: "needs_rows", fields: { n: o.n, op: o.op } };
  // The room is built square by square, so a size the format cannot hold is answered before any is.
  if (width > MAP_SIDE_MAX || height > MAP_SIDE_MAX) return tooLarge(width, height);
  const doors: Square[] = [];
  const outside: Report[] = [];
  for (const d of Array.isArray(o.args.doors) ? o.args.doors : []) {
    const s = squareGiven(d);
    if (s === null) return { line: "bad_square", fields: { n: o.n, op: o.op, field: "doors", value: JSON.stringify(d) } };
    if (s[0] > width || s[1] > height) outside.push({ code: "door_off", values: { square: [...s], width, height } });
    else doors.push(s);
  }
  reportAll(o, { lines: o.call.lines, world: o.reading.world, state: o.draft.w.state }, outside);
  return plainRows(width, height, doors);
}

/**
 * Takes the map of a place out of this chat's world (today's "take one out"): the map in the chat's
 * own draft of its world, gone, with whoever stood on its squares on none. Its records of squares and
 * doors stay as they are, so they show again if the map is laid again. A map the world draws is
 * changed square by square (`map_edit`), which the tool's file says; the engine decides whether it may go.
 */
function takeOut(o: OpContext): Unread | undefined {
  const w = o.draft.w;
  const r = o.reading;
  const at = find(o, "place", "place");
  if (isUnread(at)) return at;
  const held = Object.entries(r.world.maps).find(([, m]) => m.scope === at.id);
  const say: Say = { lines: o.call.lines, world: r.world, state: w.state };
  if (held === undefined) return { line: "no_map_to_take_out", fields: { n: o.n, op: o.op, place: whoIs(say, at.id) } };
  const [id] = held;
  const from = w.events.length;
  const layers = layersAt(r.registry, r.doc, w.state, at.id, configOf(o.call));
  const off = Object.entries(layers?.moving.pieces ?? {}).flatMap(([who, p]) => (p.at !== undefined && layers !== null ? [{ who, at: p.at, grid: layers.drawn }] : []));
  const bad = applied(o, [...off.map((p) => positionEvent(p.grid, p.who, null, p.at)), draftChange(r.doc, w.state, { collection: "maps", id, gone: true }).value as JsonObject]);
  if (bad) return bad;
  o.draft.record(o.n, o.op, "engine", o.prov, from);
  o.reply.line("lay_removed", { place: whoIs(say, at.id), map: id, ...(off.length > 0 ? { off: off.map((p) => whoIs(say, p.who)) } : {}) });
  return undefined;
}
const layDef: WriteDef = {
  name: "map_lay",
  family: FAMILY,
  lane: "engine",
  properties: { place: TEXT, rows: TEXTS, width: WHOLE, height: WHOLE, doors: SQUARES, legend: OBJECT, feet: NUMBER, title: TEXT, over: TEXT, square: SQUARE, remove: YES_NO },
  required: ["place"],
  example: { place: "The Far Road", width: 12, height: 8, source: { from: "prose", message: "m-0042" }, standing: "assumed" },
  run(o) {
    if (o.args.remove === true) return takeOut(o);
    const w = o.draft.w;
    const r = o.reading;
    const rows = rowsOf(o);
    if (isUnread(rows)) return rows;
    const given = legendGiven(o, o.args.legend, false);
    if (isUnread(given)) return given;
    const feet = numberArg(o.args, "feet");
    if (feet !== undefined && !(feet > 0)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "feet", value: JSON.stringify(feet) } };
    const played = r.world;
    const laying: Laying = {
      rows,
      ...(Object.keys(given.legend).length > 0 ? { legend: given.legend as Record<string, MapCellDef> } : {}),
      ...(textArg(o.args, "title") !== undefined ? { title: textArg(o.args, "title") ?? "" } : {}),
      ...(feet !== undefined ? { metres: feet * METRES_PER_FOOT } : {}),
    };
    const config = configOf(o.call);
    let laid: Laid;
    if (o.args.over !== undefined && o.args.over !== null) {
      const over = find(o, "over", "place");
      if (isUnread(over)) return over;
      const square = squareGiven(o.args.square);
      if (square === null) return o.args.square === undefined ? { line: "needs", fields: { n: o.n, op: o.op, fields: ["square"] } } : { line: "bad_square", fields: { n: o.n, op: o.op, field: "square", value: JSON.stringify(o.args.square) } };
      const said = textArg(o.args, "place") ?? "";
      const known = r.find(said, "place");
      const named: Named = isFound(known) ? { id: known.id, name: known.name, made: false } : { id: idFrom(said), name: said, made: true };
      laid = layOverSquare(r.doc, w.state, over.id, square, laying, config, named);
    } else {
      const placeFound = find(o, "place", "place");
      if (isUnread(placeFound)) return placeFound;
      laid = layForPlace(r.doc, w.state, placeFound.id, laying, config);
    }
    const say: Say = { lines: o.call.lines, world: played, state: w.state };
    const first = laid.reports[0];
    if (laid.changes.length === 0 || laid.scope === null) return first ? { line: `grid_${first.code}`, fields: { n: o.n, op: o.op, ...reportFields(say, first.values), ...(first.code === "no_grid" ? { maps: textOf(mapsNear(played, w.state, null, o.call.settings.nearMatches)) } : {}) } } : { line: "nothing_recorded", fields: {} };
    const from = w.events.length;
    const bad = applyLaid(o, laid.changes);
    if (bad) return bad;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const scope = laid.scope;
    const now = layersAt(r.registry, r.doc, w.state, scope, config);
    if (now !== null) {
      const after: Say = { lines: o.call.lines, world: now.world, state: w.state };
      const off = laid.changes.filter((c) => c.op === "space.pos").map((c) => (isRecord(c.value) && isRecord(c.value.data) && typeof c.value.data.entity === "string" ? whoIs(after, c.value.data.entity) : ""));
      o.reply.line("laid", { place: whoIs(after, scope), width: now.drawn.width, height: now.drawn.height, size: farText(o.call.lines, now.drawn, 1), ...(laid.sizeDefaulted ? { defaulted: true } : {}), ...stepFields(now.drawn) });
      if (off.length > 0) o.reply.line("laid_off", { who: off });
      reportAll(o, after, laid.reports);
      o.after(() => ({ laid: { map: now.drawn.id, place: whoIs(after, scope), width: now.drawn.width, height: now.drawn.height, size: distanceData(now.drawn, 1), ...(laid.sizeDefaulted ? { sizeAssumed: true } : {}), ...(laid.opens !== undefined ? { opensFrom: laid.opens } : {}), step: { ...now.drawn.scale.step } } }));
    }
    sayRead(o, given.read);
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
/** Why a stroke drew nothing: when no stroke drew anything, the first of these says more than that nothing was drawn. */
const STROKE_LOST: Readonly<Record<string, true>> = { fell_off: true, bad_symbol: true };

/** Fixtures the call lifts into things, each as its footprint and name, with the squares of it as strokes that make them floor; and what could not be lifted, as reports. */
function liftsOf(o: OpContext, say: Say, layers: Layers): { lifted: { fixture: Fixture; name: string }[]; strokes: Stroke[]; reports: Report[] } | Unread {
  const out = { lifted: [] as { fixture: Fixture; name: string }[], strokes: [] as Stroke[], reports: [] as Report[] };
  const asked = o.args.things;
  if (asked === undefined || asked === null) return out;
  if (!Array.isArray(asked)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "things", value: JSON.stringify(asked) } };
  for (const raw of asked) {
    if (!isRecord(raw)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "things", value: JSON.stringify(raw) } };
    const square = squareOn(say, layers, "things", raw.square);
    if (isUnread(square)) return square;
    const fixture = fixtureAt(layers.drawn, square);
    if (fixture === null) {
      out.reports.push({ code: "not_a_fixture", values: { square: [...square] } });
      continue;
    }
    // A fixture named twice is lifted once.
    if (out.lifted.some((l) => l.fixture.squares.some((s) => s[0] === square[0] && s[1] === square[1]))) continue;
    out.lifted.push({ fixture, name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : fixture.name });
    out.strokes.push({ symbol: ".", squares: fixture.squares });
  }
  return out;
}

const editDef: WriteDef = {
  name: "map_edit",
  family: FAMILY,
  lane: "engine",
  properties: { at: TEXT, strokes: { type: "array", items: { type: "object", properties: { symbol: TEXT, squares: SQUARES, rect: TWO_SQUARES, line: TWO_SQUARES }, required: ["symbol"] } }, legend: OBJECT, things: { type: "array", items: { type: "object", properties: { square: SQUARE, name: TEXT }, required: ["square"] } } },
  required: ["at"],
  example: { at: "The Cellar", strokes: [{ symbol: "#", squares: [[5, 3]] }, { symbol: "t", rect: [[6, 2], [7, 2]] }], legend: { t: { terrain: "table", blocked: true } }, things: [{ square: [8, 4], name: "overturned table" }], source: { from: "gm" } },
  run(o) {
    const w = o.draft.w;
    const at = find(o, "at", "point");
    if (isUnread(at)) return at;
    const layers = layersOn(o.reading, w.state, at, o.call);
    if (isUnread(layers)) return layers;
    const strokes = strokesOf(o);
    if (isUnread(strokes)) return strokes;
    const given = legendGiven(o, o.args.legend, true);
    if (isUnread(given)) return given;
    const legend = given.legend;
    const say: Say = { lines: o.call.lines, world: layers.world, state: w.state };
    const lifts = liftsOf(o, say, layers);
    if (isUnread(lifts)) return lifts;
    const done = editMap(o.reading.doc, w.state, layers.drawn.scope, [...lifts.strokes, ...strokes], legend);
    const refusal = done.reports.find((rep) => EDIT_REFUSALS[rep.code]);
    if (done.changes.length === 0 || refusal) {
      const why = lifts.reports[0] ?? (refusal?.code === "nothing_drawn" ? (done.reports.find((rep) => STROKE_LOST[rep.code]) ?? refusal) : (refusal ?? done.reports[0]));
      return why ? { line: `grid_${why.code}`, fields: { n: o.n, op: o.op, ...reportFields(say, why.values) } } : { line: "nothing_recorded", fields: {} };
    }
    reportAll(o, say, [...lifts.reports, ...done.reports]);
    const from = w.events.length;
    const bad = applyLaid(o, done.changes);
    if (bad) return bad;
    // Each fixture lifted is a thing of its name now, standing where it was drawn, with its footprint and what it blocks.
    const things: JsonObject[] = [];
    for (const { fixture, name } of lifts.lifted) {
      const made = makeThing(o, { do: "make", name, at: { place: roomAt(layers, fixture.at) }, why: "" });
      if (made === undefined) continue;
      if (isUnread(made)) return made;
      const placed = applied(o, [positionEvent(layers.drawn, made, fixture.at, null), shapeEvent(made, { size: [fixture.size[0], fixture.size[1]], blocks: fixture.blocks })]);
      if (placed) return placed;
      o.reply.line("fixture_lifted", { what: whoIs({ ...say, state: w.state }, made), square: spotText(say, fixture.at), columns: fixture.size[0], rows: fixture.size[1], blocksWay: fixture.blocks.way, blocksView: fixture.blocks.view });
      things.push({ who: whoIs({ ...say, state: w.state }, made), at: [...fixture.at], size: [...fixture.size], blocks: { ...fixture.blocks } });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    const count = done.changes.reduce((n, c) => n + (isRecord(c.value) && isRecord(c.value.data) && Array.isArray(c.value.data.squares) ? c.value.data.squares.length : 0), 0);
    o.reply.line("edited", { place: whoIs(say, layers.drawn.scope), count, symbols: textOf(Object.keys(legend)) });
    o.after(() => ({ edited: { map: layers.drawn.map ?? layers.drawn.id, squares: count, legend: Object.keys(legend), ...(things.length > 0 ? { things } : {}) } }));
    sayRead(o, given.read);
    return undefined;
  },
};

/** The map tools, as RPH's search finds them. */
export const MAP_TOOLS: readonly ToolSpec[] = [readTool(view), readTool(measure), writeTool(placeDef), writeTool(doorDef), writeTool(layDef), writeTool(editDef), ...TODAY_TOOLS].map(mapTool);
