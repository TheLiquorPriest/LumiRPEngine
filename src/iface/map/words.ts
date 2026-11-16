// The map in words (plan §8.2): a grid printed as text with its legend, who and what stands where,
// and its doors. How it is laid out, and every line that prints it, are `.prompts/map-layout.md`'s
// (`layout.ts`); the picture (column numbers, row numbers, the map's own symbols) is the grid's
// data, and a distance's unit and a time come from `.prompts/map-answers.md`. The world state shows
// it for each place on the horizon (`mapView`, the engine tools' `MapView`), in two layers, and
// `map_view` answers with it whole. A line the files leave out, or leave empty, is not shown.

import type { EntityId, PlaceId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { gridOf, standingGrid } from "../../shared/grid";
import { VOID_TERRAIN } from "../../shared/maps";
import type { MapCellDef, WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import { own } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import type { WorldState } from "../../engine/state";
import { Lines, type GuidanceFiles } from "../texts";
import { hashJson } from "../../shared/hash";
import { MAP_DEFAULTS, type MapConfig, type Unit } from "../../shared/map-config";
import { kindFields } from "../../engine/scope";
import type { Fact } from "../../store/types";
import { drawnOf, movingOf, runsOf, squareAt, standsAt, type Drawn, type Moving, type Square, type Took } from "../../packs/space/core/grid-model";
import { between } from "../../packs/space/core/grid-measure";
import { whereOf } from "../../packs/space/core/grid-play";
import { layoutLine, MAP_LAYOUT, NO_LAYOUT, parseLayout, type MapLayout } from "./layout";
import type { MapLayer, MapView } from "./ports";
import { printMap, type LegendEntry, type Printed } from "./print";

/** The prompt part every word of a map, and every sentence of the map tools' answers, comes from. */
export const MAP_ANSWERS = "map-answers";

/** The map lines in force for the chat; none when the part is switched off, so a map shows its picture alone and the tools answer with no words. */
export async function mapLines(files: GuidanceFiles): Promise<Lines> {
  const text = await files.read("prompts", MAP_ANSWERS);
  return text === undefined ? Lines.none() : Lines.parse(text, `.prompts/${MAP_ANSWERS}.md`);
}

/** A place's grid as play stands: the world as the chat plays it, what is drawn, what moves, and who is at the place with no square yet. */
export interface Layers {
  registry: Registry;
  world: WorldDoc;
  drawn: Drawn;
  moving: Moving;
  unplaced: EntityId[];
}

/** The grid someone at `place` stands on (its own, or the one its parent draws it on), as the chat's state has it; null where there is none. */
export function layersAt(registry: Registry, doc: WorldDoc, state: Readonly<WorldState>, place: PlaceId, config: Readonly<MapConfig> = MAP_DEFAULTS): Layers | null {
  const world = playedWorld(doc, state);
  const stand = standingGrid(world, place);
  const drawn = stand ? drawnOf(world, stand.scope, config, state) : null;
  if (!drawn) return null;
  const { moving, unplaced } = movingOf(registry, world, state, drawn);
  return { registry, world, drawn, moving, unplaced };
}

/** How many of the unit in force `squares` squares are on a grid, to a tenth. */
export function amountOf(drawn: Drawn, squares: number): number {
  return Math.round(squares * (drawn.scale.unit === "feet" ? drawn.scale.feet : drawn.scale.metres) * 10) / 10;
}

/** A distance as an answer's data gives it: how much, in which unit. */
export function distanceData(drawn: Drawn, squares: number): { amount: number; unit: Unit } {
  return { amount: amountOf(drawn, squares), unit: drawn.scale.unit };
}

/** `squares` squares in words, in the unit in force: the map's `far_feet` or `far_metres` line, filled ("15 ft", "3 m"). */
export function farText(lines: Lines, drawn: Drawn, squares: number): string {
  return lines.line(`far_${drawn.scale.unit}`, { amount: amountOf(drawn, squares) }) ?? "";
}

/** The name an id goes by: an entity's, a place's, else the id. */
export function nameIn(world: WorldDoc, state: Readonly<WorldState>, id: string): string {
  return own(state.entities, id)?.name ?? own(world.places, id)?.name ?? id;
}

/** Where someone or something is kept within its place besides a square: its zone and words as recorded, joined; undefined when it has none. */
export function whereWords(state: Readonly<WorldState>, id: string): string | undefined {
  const where = whereOf(state, id);
  const said = where === null ? [] : [where.zone, where.words].filter((t): t is string => t !== undefined && t.trim() !== "");
  return said.length > 0 ? said.join(", ") : undefined;
}

/**
 * The places that have a map of their own, as answers name them (name and id), for a place that has none: those in the place's
 * own parent, or in the place, or holding it first, then the rest in order of id; at most `limit`, which is the setting for how many near names an answer lists.
 */
export function mapsNear(world: WorldDoc, state: Readonly<WorldState>, place: PlaceId | null, limit: number): string[] {
  const here = place === null ? undefined : own(world.places, place);
  const rank = (id: string): number => {
    const p = own(world.places, id);
    return p !== undefined && here !== undefined && (p.parent === place || (here.parent !== undefined && (p.parent === here.parent || id === here.parent))) ? 0 : 1;
  };
  return Object.keys(world.places)
    .filter((id) => id !== place && gridOf(world, id) !== undefined)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
    .slice(0, limit)
    .map((id) => `${nameIn(world, state, id)} [${id}]`);
}

/** The time step's fields every line about time reads: `round`, with its seconds and its squares, on a grid that counts rounds; none on one that counts minutes. */
export function stepFields(drawn: Drawn): Record<string, unknown> {
  return drawn.scale.step.per === "round" ? { round: { seconds: drawn.scale.step.seconds, squares: drawn.scale.step.squares } } : {};
}

/** What a sentence about the map reads: the map's lines, and names as the chat's state has them. */
export interface Say {
  lines: Lines;
  world: WorldDoc;
  state: Readonly<WorldState>;
}

/** Someone, something or a place as answers name it: its name with its id, as the engine's answers do. */
export function whoIs(say: Say, id: string): string {
  return `${nameIn(say.world, say.state, id)} [${id}]`;
}

/** A square in words, with who stands there when it is someone's: the `spot` line, filled. */
export function spotText(say: Say, square: Square, id?: string): string {
  return say.lines.line("spot", { column: square[0], row: square[1], ...(id !== undefined ? { name: nameIn(say.world, say.state, id), id } : {}) }) ?? "";
}

/** How long something took, in words: the `time` line, filled with its rounds and seconds, or its minutes. */
export function timeText(say: Say, took: Took): string {
  const fields = took.rounds !== undefined ? { round: { rounds: took.rounds, seconds: took.seconds, one: took.rounds === 1 } } : { minutes: Math.round(took.seconds / 6) / 10 };
  return say.lines.line("time", fields) ?? "";
}

/** A square as an argument or a report gives it, when it is one: [column, row], each a whole number from 1 that a number holds exactly. */
export function squareGiven(v: unknown): Square | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1) ? [Number(v[0]), Number(v[1])] : null;
}

/** Runs of squares by row (`[row, from, to]`) as the answers' words: a lone square as the `spot` line, a stretch as the `run` line. */
export function runsText(say: Say, runs: readonly (readonly number[])[]): string[] {
  return runs.map(([row = 0, from = 0, to = 0]) => (from === to ? spotText(say, [from, row]) : (say.lines.line("run", { row, from, to }) ?? "")));
}

/** A report of the grid's, its values worded: an id by its name, a square and a list of squares by the `spot` line, the runs of squares (`runs`) as `squares` by `runsText`. */
export function reportFields(say: Say, values: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const square = squareGiven(v);
    const squares = Array.isArray(v) && v.length > 0 ? v.map(squareGiven) : [];
    if (k === "runs" && Array.isArray(v)) out.squares = runsText(say, v as readonly (readonly number[])[]);
    else if (square) out[k] = spotText(say, square);
    else if (squares.length > 0 && squares.every((s) => s !== null)) out[k] = squares.map((s) => spotText(say, s ?? [0, 0]));
    else if (typeof v === "string" && (own(say.state.entities, v) !== undefined || hasOwn(say.world.places, v))) out[k] = whoIs(say, v);
    else out[k] = v;
  }
  return out;
}

/** What a map is worded by: the answers' lines (a distance's unit, a time) and the layout (where each part goes, and every line that prints a map). */
export interface MapWording {
  lines: Lines;
  layout: MapLayout;
}

/** The wording in force for the chat: the answers' lines, and the layout, none of which prints no map. */
export async function mapWording(files: GuidanceFiles): Promise<MapWording> {
  return { lines: await mapLines(files), layout: parseLayout(await files.read("prompts", MAP_LAYOUT)) };
}

/** No wording: a map prints nothing, and a tool answers with no words. */
export const NO_WORDING: MapWording = Object.freeze({ lines: Lines.none(), layout: NO_LAYOUT });

/** A legend entry in words, by what its symbol stands for: the layout's line of its kind, filled. */
function legendWords(layout: MapLayout, world: WorldDoc, state: Readonly<WorldState>, entry: LegendEntry): string {
  const what: MapCellDef = entry.what;
  const symbol = entry.symbol;
  let said: string | undefined;
  if (what === "wall" || what === "floor" || what === "door") said = layoutLine(layout, `legend_${what}`, { symbol });
  else if ("terrain" in what) said = what.terrain === VOID_TERRAIN ? layoutLine(layout, "legend_nothing", { symbol }) : layoutLine(layout, "legend_terrain", { symbol, terrain: what.terrain, blocked: what.blocked === true, seeThrough: "seeThrough" in what && what.seeThrough === true });
  else if ("item" in what) said = layoutLine(layout, "legend_item", { symbol, id: what.item, name: nameIn(world, state, what.item) });
  else if ("door" in what) said = layoutLine(layout, "legend_room_door", { symbol, id: what.place, name: nameIn(world, state, what.place) });
  else if ("place" in what) said = layoutLine(layout, "legend_place", { symbol, id: what.place, name: nameIn(world, state, what.place) });
  else said = layoutLine(layout, "legend_zone", { symbol, zone: what.zone });
  return said ?? "";
}

/** The picture in words: the column numbers, then each row by its number, by the layout's `columns` and `row` lines; undefined where it has none. */
export function pictureWords(layout: MapLayout, printed: Printed): string | undefined {
  const out: string[] = [];
  const head = layoutLine(layout, "columns", { label: " ".repeat(layout.labelWidth), numbers: printed.columns });
  if (head !== undefined) out.push(head);
  for (const r of printed.rows) {
    const row = layoutLine(layout, "row", { label: String(r.row).padStart(layout.labelWidth), row: r.row, cells: r.cells });
    if (row !== undefined) out.push(row);
  }
  return out.length > 0 ? out.join("\n") : undefined;
}

/** What is recorded for a piece, and nothing inferred: a person's activity and a thing's condition where they are not the kind's default, and the standing facts whose keys the layout names. */
function recordedOf(layers: Layers, state: Readonly<WorldState>, facts: Readonly<Record<string, readonly Fact[]>>, keys: readonly string[], id: EntityId): Record<string, unknown> {
  const e = own(state.entities, id);
  if (!e) return {};
  const fields = kindFields(layers.registry, layers.world, e.kind);
  const out: Record<string, unknown> = {};
  const where = whereOf(state, id);
  const said = where === null ? [] : [where.zone, where.words].filter((t): t is string => t !== undefined);
  if (said.length > 0) out.words = said.join(", ");
  const activity = e.fields.activity;
  if (typeof activity === "string" && activity.trim() !== "" && activity !== fields.activity?.default) out.activity = activity;
  const condition = e.fields.condition;
  const bands = fields.condition?.bands;
  if (typeof condition === "number" && condition !== fields.condition?.default && bands !== undefined) {
    const band = bands.find((b) => (b.min === undefined || condition >= b.min) && (b.max === undefined || condition < b.max));
    if (band !== undefined) out.condition = band.label;
  }
  const standing = keys.length === 0 ? [] : (facts[`entity:${id}`] ?? []).filter((f) => f.replacedBy === undefined && f.value.trim() !== "" && keys.includes(f.key));
  if (standing.length > 0) out.facts = keys.flatMap((k) => standing.filter((f) => f.key === k).map((f) => ({ key: f.key, value: f.value })));
  return out;
}

/** What a map's printing asks of its place: the part a large grid shows (around `centre`, or what `around` holds), the settings, and the layer wanted, both when none. */
export interface MapOpts {
  centre?: Square;
  around?: readonly EntityId[];
  config?: Readonly<MapConfig>;
  layer?: MapLayer;
  /** The facts standing on things, by tree ref, which a piece's line carries when the layout names their keys. */
  facts?: Readonly<Record<string, readonly Fact[]>>;
}

/** A map printed: the text of the layer asked for (both when none), the id of its grid, and a version of the drawn layer as play stands. */
export interface MapWritten {
  text: string;
  grid: string;
  drawn: string;
  printed: Printed;
}

/**
 * The map as text, laid out by the layout file: its title (and which part is shown, when it is not
 * shown whole), the picture, the legend (the drawn layer), then who and what stands where (the player's
 * character as `map_you`, the others with how far they are from it and what is recorded of them), who
 * is at the place with no square yet, and the doors (the layer that moves). `centre` picks the part a
 * large grid shows when everyone `around` does not fit in it. The picture is left out where the
 * settings say so (`map.picture`), for the world state's layers: `layer` given.
 */
export function mapWords(wording: MapWording, layers: Layers, state: Readonly<WorldState>, opts: MapOpts = {}): MapWritten {
  const { lines, layout } = wording;
  const { world, drawn, moving } = layers;
  const config = opts.config ?? MAP_DEFAULTS;
  const printed = printMap(drawn, moving, opts);
  const sayAs = (name: string, fields: Record<string, unknown>): string | undefined => layoutLine(layout, name, fields);
  const title = sayAs("map_title", { place: nameIn(world, state, drawn.scope), id: drawn.scope, width: drawn.width, height: drawn.height, size: farText(lines, drawn, 1), ...stepFields(drawn) });
  const part = printed.whole ? undefined : sayAs("map_part", { fromColumn: printed.from[0], fromRow: printed.from[1], toColumn: printed.to[0], toRow: printed.to[1] });
  const picture = opts.layer !== undefined && !config.picture ? undefined : pictureWords(layout, printed);
  const legend = sayAs("map_legend", { legend: printed.legend.map((e) => legendWords(layout, world, state, e)).filter((t) => t.trim() !== "") });
  const pov = world.pov;
  const povAt = standsAt(moving, pov);
  const listed: string[] = [];
  const noSquare = [...layers.unplaced];
  for (const p of printed.pieces) {
    // What lies on something that stands nowhere on the grid is here with no square.
    if (p.at === null) {
      noSquare.push(p.id);
      continue;
    }
    // What it lies on or in, as recorded: `on` for a support's, `inside` for a holder's.
    const rests = p.on === undefined ? {} : p.within ? { inside: nameIn(world, state, p.on), insideId: p.on } : { on: nameIn(world, state, p.on), onId: p.on };
    const fields = { id: p.id, name: nameIn(world, state, p.id), column: p.at[0], row: p.at[1], shown: p.shown, ...rests };
    const recorded = recordedOf(layers, state, opts.facts ?? {}, layout.facts, p.id);
    const said =
      p.id === pov
        ? sayAs("map_you", { ...fields, ...recorded })
        : (() => {
            const apart = povAt ? between(drawn, moving, pov, p.id) : null;
            const size = p.size && (p.size[0] > 1 || p.size[1] > 1) ? { columns: p.size[0], rows: p.size[1] } : null;
            return sayAs("map_piece", {
              ...fields,
              ...(size ? { size } : {}),
              blocksWay: p.blocks?.way === true,
              blocksView: p.blocks?.view === true,
              ...recorded,
              ...(apart !== null ? { squares: apart, far: farText(lines, drawn, apart) } : {}),
            });
          })();
    if (said !== undefined) listed.push(said);
  }
  for (const id of noSquare) {
    const said = sayAs("map_unplaced", { id, name: nameIn(world, state, id), ...recordedOf(layers, state, opts.facts ?? {}, layout.facts, id) });
    if (said !== undefined) listed.push(said);
  }
  const doors = printed.doors.map((d) => sayAs("map_door", { column: d.at[0], row: d.at[1], state: d.state }) ?? "").filter((t) => t.trim() !== "");
  // What is dark, by the place whose light is out (the map's whole, or a room drawn on it with its squares by row): state that moves with the turn, so the layer that moves lists it.
  const dark = drawn.darkAreas
    .map((a) => sayAs("map_dark_area", { id: a.place, name: nameIn(world, state, a.place), whole: a.whole, count: a.squares.length, ...(a.whole ? {} : { squares: runsText({ lines, world, state }, runsOf(a.squares.map((i) => squareAt(drawn, i)))) }) }) ?? "")
    .filter((t) => t.trim() !== "");
  const drawnFields = { title, part, picture, legend };
  const movingFields = { who: listed.length > 0 ? sayAs("map_who", {}) : undefined, list: listed.length > 0 ? listed.join("\n") : undefined, doors: doors.length > 0 ? sayAs("map_doors", { doors }) : undefined, dark: dark.length > 0 ? sayAs("map_dark", { areas: dark }) : undefined };
  const fields = opts.layer === "drawn" ? drawnFields : opts.layer === "moving" ? movingFields : { ...drawnFields, ...movingFields };
  const text = layout.body === null ? "" : layout.body.render(layout.header, fields).replace(/^\n+/, "").trimEnd();
  // The drawn layer's version: what it is made of, and the world's revision; never who stands where or which door is open.
  const version = hashJson({ revision: state.revision, grid: printed.grid, from: printed.from, to: printed.to, columns: printed.columns, rows: printed.rows, legend: printed.legend, scale: drawn.scale, layout: layout.source, picture: opts.layer === undefined || config.picture });
  return { text, grid: printed.grid, drawn: version, printed };
}

/**
 * The map the world state shows for a place (the engine tools' `MapView`, the world state's
 * `MapText`): the grid someone at the place stands on, around everyone `around` names that stands on
 * it when they fit, else around the player's character when it stands on it, else around the place's
 * own square, laid out by the layout; null for a place with no grid. The turn lane gives it as
 * `deps.map`, with `wording` read by `mapWording` from the chat's files.
 */
export function mapView(wording: MapWording, config: Readonly<MapConfig> = MAP_DEFAULTS): MapView {
  return {
    text({ state, env, place, layer, around }) {
      const doc = env.worlds(state.world.revision);
      const layers = doc ? layersAt(env.registry, doc, state.world, place, config) : null;
      if (!layers) return null;
      const cell = layers.drawn.scope !== place && hasOwn(layers.world.places, place) ? layers.world.places[place]?.cell : undefined;
      const centre = standsAt(layers.moving, layers.world.pov) ?? (cell ? ([cell.x + 1, cell.y + 1] as const) : undefined);
      const held = (around ?? []).flatMap((ref) => (ref.startsWith("entity:") ? [ref.slice("entity:".length)] : []));
      const { text, grid, drawn } = mapWords(wording, layers, state.world, { config, facts: state.facts, ...(centre ? { centre } : {}), ...(held.length > 0 ? { around: held } : {}), ...(layer !== undefined ? { layer } : {}) });
      return { grid, drawn, text };
    },
  };
}
