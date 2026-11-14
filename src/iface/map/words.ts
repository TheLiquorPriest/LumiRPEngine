// The map in words (plan §8.2): a grid printed as text with its legend, who and what stands where,
// and its doors. Every word and the layout of every line are `.prompts/map-answers.md`'s; the
// picture (column numbers, row numbers, the map's own symbols) is the grid's data. The world state
// shows it for each place on the horizon (`mapView`, the engine tools' `MapView`), and `map_view`
// answers with it. A line the file leaves out, or leaves empty, is not shown.

import type { EntityId, PlaceId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { standingGrid } from "../../shared/grid";
import { VOID_TERRAIN } from "../../shared/maps";
import type { MapCellDef, WorldDoc } from "../../shared/world";
import { playedWorld } from "../../engine/places-in-play";
import { own } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import type { WorldState } from "../../engine/state";
import type { MapView } from "../kit";
import { Lines, type GuidanceFiles } from "../texts";
import { drawnOf, GRID_DEFAULTS, movingOf, standsAt, type Drawn, type GridSettings, type Moving, type Square } from "./grid";
import { between } from "./measure";
import { printMap, type LegendEntry, type Printed } from "./print";
import type { Took } from "./time";

/** The prompt part every word of a map, and every sentence of the map tools' answers, comes from. */
export const MAP_ANSWERS = "map-answers";

/** The map lines in force for the chat; none when the part is switched off, so a map shows its picture alone and the tools answer with no words. */
export async function mapLines(files: GuidanceFiles): Promise<Lines> {
  const text = await files.read("prompts", MAP_ANSWERS);
  return text === undefined ? Lines.none() : Lines.parse(text, `.prompts/${MAP_ANSWERS}.md`);
}

/** A place's grid as play stands: the world as the chat plays it, what is drawn, what moves, and who is at the place with no square yet. */
export interface Layers {
  world: WorldDoc;
  drawn: Drawn;
  moving: Moving;
  unplaced: EntityId[];
}

/** The grid someone at `place` stands on (its own, or the one its parent draws it on), as the chat's state has it; null where there is none. */
export function layersAt(registry: Registry, doc: WorldDoc, state: Readonly<WorldState>, place: PlaceId, settings: Readonly<GridSettings> = GRID_DEFAULTS): Layers | null {
  const world = playedWorld(doc, state);
  const stand = standingGrid(world, place);
  const drawn = stand ? drawnOf(world, stand.scope, settings, state) : null;
  if (!drawn) return null;
  const { moving, unplaced } = movingOf(registry, world, state, drawn);
  return { world, drawn, moving, unplaced };
}

/** How many feet `squares` squares are on a grid, to a tenth. */
export function feetOf(drawn: Drawn, squares: number): number {
  return Math.round(squares * drawn.scale.feet * 10) / 10;
}

/** The name an id goes by: an entity's, a place's, else the id. */
export function nameIn(world: WorldDoc, state: Readonly<WorldState>, id: string): string {
  return own(state.entities, id)?.name ?? own(world.places, id)?.name ?? id;
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

/** A report of the grid's, its values worded: an id by its name, a square and a list of squares by the `spot` line. */
export function reportFields(say: Say, values: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const square = squareGiven(v);
    const squares = Array.isArray(v) && v.length > 0 ? v.map(squareGiven) : [];
    if (square) out[k] = spotText(say, square);
    else if (squares.length > 0 && squares.every((s) => s !== null)) out[k] = squares.map((s) => spotText(say, s ?? [0, 0]));
    else if (typeof v === "string" && (own(say.state.entities, v) !== undefined || hasOwn(say.world.places, v))) out[k] = whoIs(say, v);
    else out[k] = v;
  }
  return out;
}

/** A legend entry in words, by what its symbol stands for: the line of its kind, filled. */
function legendWords(lines: Lines, world: WorldDoc, state: Readonly<WorldState>, entry: LegendEntry): string {
  const what: MapCellDef = entry.what;
  const symbol = entry.symbol;
  let said: string | undefined;
  if (what === "wall" || what === "floor" || what === "door") said = lines.line(`legend_${what}`, { symbol });
  else if ("terrain" in what) said = what.terrain === VOID_TERRAIN ? lines.line("legend_nothing", { symbol }) : lines.line("legend_terrain", { symbol, terrain: what.terrain, blocked: what.blocked === true, seeThrough: "seeThrough" in what && what.seeThrough === true });
  else if ("item" in what) said = lines.line("legend_item", { symbol, id: what.item, name: nameIn(world, state, what.item) });
  else if ("door" in what) said = lines.line("legend_room_door", { symbol, id: what.place, name: nameIn(world, state, what.place) });
  else if ("place" in what) said = lines.line("legend_place", { symbol, id: what.place, name: nameIn(world, state, what.place) });
  else said = lines.line("legend_zone", { symbol, zone: what.zone });
  return said ?? "";
}

/**
 * The map as text, in the lines of the map's part: its title (and which part is shown, when it is
 * not shown whole), the picture, the legend, then who and what stands where (the player's
 * character as `map_you`, the others with how far they are from it), who is at the place with no
 * square yet, and the doors. `centre` picks the part a large grid shows.
 */
export function mapWords(lines: Lines, layers: Layers, state: Readonly<WorldState>, opts: { centre?: Square; settings?: Readonly<GridSettings> } = {}): { text: string; printed: Printed } {
  const { world, drawn, moving } = layers;
  const printed = printMap(drawn, moving, opts);
  const out: string[] = [];
  const listed: string[] = [];
  const sayIn = (into: string[], name: string, fields: Record<string, unknown>): void => {
    const text = lines.line(name, fields);
    if (text !== undefined && text.trim() !== "") into.push(text.trimEnd());
  };
  sayIn(out, "map_title", { place: nameIn(world, state, drawn.scope), id: drawn.scope, width: drawn.width, height: drawn.height, feet: feetOf(drawn, 1), metres: Math.round(drawn.scale.metres * 100) / 100, ...stepFields(drawn) });
  if (!printed.whole) sayIn(out, "map_part", { fromColumn: printed.from[0], fromRow: printed.from[1], toColumn: printed.to[0], toRow: printed.to[1] });
  out.push(printed.picture);
  sayIn(out, "map_legend", { legend: printed.legend.map((e) => legendWords(lines, world, state, e)).filter((t) => t.trim() !== "") });
  const pov = world.pov;
  const povAt = standsAt(moving, pov);
  const noSquare = [...layers.unplaced];
  for (const p of printed.pieces) {
    // What lies on something that stands nowhere on the grid is here with no square.
    if (p.at === null) {
      noSquare.push(p.id);
      continue;
    }
    const fields = { id: p.id, name: nameIn(world, state, p.id), column: p.at[0], row: p.at[1], shown: p.shown };
    if (p.id === pov) {
      sayIn(listed, "map_you", fields);
      continue;
    }
    const apart = povAt ? between(drawn, moving, pov, p.id) : null;
    const size = p.size && (p.size[0] > 1 || p.size[1] > 1) ? { columns: p.size[0], rows: p.size[1] } : null;
    sayIn(listed, "map_piece", {
      ...fields,
      ...(p.on !== undefined ? { on: nameIn(world, state, p.on), onId: p.on } : {}),
      ...(size ? { size } : {}),
      blocksWay: p.blocks?.way === true,
      blocksView: p.blocks?.view === true,
      ...(apart !== null ? { squares: apart, feet: feetOf(drawn, apart) } : {}),
    });
  }
  for (const id of noSquare) sayIn(listed, "map_unplaced", { id, name: nameIn(world, state, id) });
  if (listed.length > 0) {
    // A blank line between the picture with its legend and the list, as the plan's map lays it out.
    out.push("");
    sayIn(out, "map_who", {});
    out.push(...listed);
  }
  const doors = printed.doors.map((d) => lines.line("map_door", { column: d.at[0], row: d.at[1], state: d.state }) ?? "").filter((t) => t.trim() !== "");
  if (doors.length > 0) sayIn(out, "map_doors", { doors });
  return { text: out.join("\n"), printed };
}

/**
 * The map the world state shows for a place (the engine tools' `MapView`, the world state's
 * `MapText`): the grid someone at the place stands on, around the player's character when it stands
 * on it, else around the place's own square, worded by `lines`; null for a place with no grid. The
 * turn lane gives it as `deps.map`, with `lines` read by `mapLines` from the chat's files.
 */
export function mapView(lines: Lines, settings: Readonly<GridSettings> = GRID_DEFAULTS): MapView {
  return {
    text({ state, env, place }) {
      const doc = env.worlds(state.world.revision);
      const layers = doc ? layersAt(env.registry, doc, state.world, place, settings) : null;
      if (!layers) return null;
      const cell = layers.drawn.scope !== place && hasOwn(layers.world.places, place) ? layers.world.places[place]?.cell : undefined;
      const centre = standsAt(layers.moving, layers.world.pov) ?? (cell ? ([cell.x + 1, cell.y + 1] as const) : undefined);
      return mapWords(lines, layers, state.world, { settings, ...(centre ? { centre } : {}) }).text;
    },
  };
}
