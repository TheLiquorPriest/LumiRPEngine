// A place's record, read at one point of a chat's path (plan §8.2, Appendix B "Places"): the head, or any turn. One reader gathers the
// parts a place keeps from where each lives: its facts (each keeping the part of the record it belongs to and the beat that caused it),
// its grid as the map reads it, the entry the groups system keeps, the base its area folds, the entries bound to it, the ways the world
// and play laid, who and what the tree puts there, the beats that name it and who knows of it. Nothing is inferred: a part with
// nothing recorded says so, and code never judges what a fact or a base says.

import type { JsonObject } from "../shared/json";
import { setEntryOf } from "../engine/org";
import { MAP_DEFAULTS, type MapConfig } from "../iface/map";
import { fixtureAt } from "../iface/map/fixture";
import { doorState, drawnOf, type Drawn, movingOf, squareAt } from "../packs/space/core/grid-model";
import { madeOf } from "../engine/places-in-play";
import { LIGHT_FIELD, lightRead } from "../packs/space/core/light";
import type { ReadContext } from "../engine/registry";
import type { WorldState } from "../engine/state";
import { type Fact, type Store, standing, type StoreState, type UserStore } from "../store";
import { clockOfState } from "../story/kit";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import { storySliceOf } from "../story/fold";
import { questSliceOf } from "../quests";
import type { PlaceFactPart } from "./parts";
import type { PlacesSettings } from "./settings";
import type { PlaceFactRow } from "./shapes";

/** The point of a chat's path a place is read at, with the state folded there and the world as the chat plays it. */
export interface PlaceAt {
  /** What the store folds with: the registry and the world documents by revision. */
  env: Store["env"];
  u: UserStore;
  user: string;
  chat: string;
  /** The turn read at; null: the chat's head. */
  turn: string | null;
  state: StoreState;
  world: WorldState;
  /** The world as the chat plays it (its own places and what play made or changed) with the state read through it. */
  ctx: ReadContext;
}

/** The point `turn` of `chat` (null: its head; a chat the store does not hold, as an untouched one), or null where the world its state is played on is not held. */
export function placeAt(store: Store, user: string, chat: string, turn: string | null): PlaceAt | null {
  const u = store.user(user);
  const state = (turn === null ? u.headState(chat) : u.stateAt(turn)).state;
  const doc = store.env.worlds(state.world.revision);
  if (doc === undefined) return null;
  return { env: store.env, u, user, chat, turn, state, world: state.world, ctx: store.env.registry.context(doc, state.world) };
}

/**
 * The point `turn` of `chat` (null: its head) as a reading that already holds the state folded there reads it, for the engine's tools,
 * which are given the user's store and the fold's environment and the state of the turn they are called in, a job's own changes on it.
 */
export function placeAtState(u: UserStore, env: Store["env"], chat: string, turn: string | null, state: StoreState, ctx: ReadContext): PlaceAt {
  return { env, u, user: u.id, chat, turn, state, world: state.world, ctx };
}

/** The place's own definition as the chat plays it; undefined where it has none. */
export function placeDef(at: PlaceAt, place: string): ReadContext["world"]["places"][string] | undefined {
  return Object.hasOwn(at.ctx.world.places, place) ? at.ctx.world.places[place] : undefined;
}

/** What kind of place it is: one of the world's own, or the room, spot or venue play made inside one. */
export function placeKindOf(at: PlaceAt, place: string): "place" | "room" | "spot" | "venue" {
  return madeOf(placeDef(at, place))?.as ?? "place";
}

// ---------------------------------------------------------------- facts: since, features, access

/** What a fact row is built from: the points of the path its turn and its beat are read at, each once. */
export interface FactReader {
  row(f: Fact): PlaceFactRow;
}

/** A reader of fact rows at a point of the path: each turn's story time and the story record are read once. */
export function factReader(at: PlaceAt): FactReader {
  const times = new Map<string, string | null>();
  const story = new StoryRecord(storyAt(at.u, at.chat, at.turn), storySliceOf(at.state), questSliceOf(at.state));
  const timeOf = (turn: string): string | null => {
    // A fact of his own change is written on the chat, at no turn: no turn's story time is its.
    if (turn === "") return null;
    if (!times.has(turn)) {
      const clock = clockOfState(at.env, at.u.stateAt(turn).state);
      times.set(turn, clock === null ? null : clock.text(clock.now));
    }
    return times.get(turn) ?? null;
  };
  return {
    row(f) {
      const beat = f.beat === undefined ? null : (story.items.get(f.beat) ?? null);
      const text = beat === null || typeof beat.fields.text !== "string" ? null : beat.fields.text;
      return {
        id: f.id,
        key: f.key,
        value: f.value,
        turn: f.turn,
        n: f.n,
        time: timeOf(f.turn),
        beat: f.beat === undefined ? null : { id: f.beat, text, message: beat === null ? null : story.beatAt(beat) },
        precision: f.precision,
        standing: f.standing,
        source: f.source,
        by: f.by,
      };
    },
  };
}

/** The standing facts of a place that belong to a part of its record, oldest first. */
export function factsOfPart(at: PlaceAt, place: string, part: PlaceFactPart): Fact[] {
  return standing(at.state, `place:${place}`).filter((f) => f.part === part);
}

/** A part's entries at most `limit` of the newest, oldest first among them, and how many earlier ones were left out. */
export function newest<T>(all: readonly T[], limit: number): { items: T[]; more: number } {
  return { items: all.slice(Math.max(0, all.length - limit)), more: Math.max(0, all.length - limit) };
}

/** What the story changed at a place: its facts of part `since`, the newest the setting shows, each with its turn, that turn's story time and its beat. */
export function sinceOf(at: PlaceAt, place: string, settings: Pick<PlacesSettings, "since">, reader: FactReader = factReader(at)): { items: PlaceFactRow[]; more: number } {
  const shown = newest(factsOfPart(at, place, "since"), settings.since);
  return { items: shown.items.map((f) => reader.row(f)), more: shown.more };
}

/** The grid a place draws of its own, as play stands; null where it draws none. */
export function gridOf(at: PlaceAt, place: string, config: MapConfig = MAP_DEFAULTS): Drawn | null {
  return placeDef(at, place) === undefined ? null : drawnOf(at.ctx.world, place, config, at.world);
}

/** What a grid draws as a fixture, by the squares joined with the same symbol of named terrain; each once. */
export function fixturesOf(grid: Drawn): { name: string; at: number[]; size: number[] }[] {
  const seen = new Set<number>();
  const out: { name: string; at: number[]; size: number[] }[] = [];
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (seen.has(i)) continue;
    const found = fixtureAt(grid, squareAt(grid, i));
    if (found === null) continue;
    for (const [x, y] of found.squares) seen.add((y - 1) * grid.width + (x - 1));
    out.push({ name: found.name, at: [...found.at], size: [...found.size] });
  }
  return out;
}

/** The zones a grid names, each with how many squares it covers. */
export function zonesOf(grid: Drawn): { name: string; squares: number }[] {
  return Object.entries(grid.zones).map(([name, squares]) => ({ name, squares: squares.length }));
}

/** A place's features: its facts of part `feature` (the newest the setting shows), and the fixtures and zones its grid draws. */
export function featuresOf(at: PlaceAt, place: string, settings: Pick<PlacesSettings, "features">, config: MapConfig = MAP_DEFAULTS, reader: FactReader = factReader(at)) {
  const shown = newest(factsOfPart(at, place, "feature"), settings.features);
  const grid = gridOf(at, place, config);
  return { facts: { items: shown.items.map((f) => reader.row(f)), more: shown.more }, fixtures: grid === null ? [] : fixturesOf(grid), zones: grid === null ? [] : zonesOf(grid) };
}

/** Who may enter, as the groups system keeps it: the entry set on the place or by the nearest place above it; null where none is set. */
export function entryOf(at: PlaceAt, place: string): { audience: string; at: string; name: string; inherited: boolean } | null {
  const set = setEntryOf(at.ctx, place);
  if (set === null) return null;
  return { audience: set.entry, at: set.at, name: placeDef(at, set.at)?.name ?? set.at, inherited: set.at !== place };
}

/** The state of each door on a place's grid, as play stands. */
export function doorsOf(at: PlaceAt, place: string, config: MapConfig = MAP_DEFAULTS): { at: number[]; state: "open" | "closed" | "locked" }[] {
  const grid = gridOf(at, place, config);
  if (grid === null) return [];
  const { moving } = movingOf(at.env.registry, at.ctx.world, at.world, grid);
  return [...grid.doors]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const state = doorState(grid, moving, i);
      return state === null ? [] : [{ at: [...squareAt(grid, i)], state }];
    });
}

/** The light a place records for itself, or that of the nearest place above it that records one; null where none does (nothing is inferred). */
export function lightRecorded(at: PlaceAt, place: string): "lit" | "dark" | null {
  const seen = new Set<string>();
  for (let id: string | undefined = place; id !== undefined && !seen.has(id); id = placeDef(at, id)?.parent) {
    seen.add(id);
    const fields = placeDef(at, id)?.fields;
    const read = fields !== undefined && Object.hasOwn(fields, LIGHT_FIELD) ? lightRead(fields[LIGHT_FIELD]) : null;
    if (read !== null) return read;
  }
  return null;
}

/** A place's access and state: who may enter, whether it is lit, its facts of part `access` (the newest the setting shows), and the state of each door on its grid. */
export function accessOf(at: PlaceAt, place: string, settings: Pick<PlacesSettings, "access">, config: MapConfig = MAP_DEFAULTS, reader: FactReader = factReader(at)) {
  const shown = newest(factsOfPart(at, place, "access"), settings.access);
  return { entry: entryOf(at, place), light: lightRecorded(at, place), facts: { items: shown.items.map((f) => reader.row(f)), more: shown.more }, doors: doorsOf(at, place, config) };
}

/** Every fact row of a part the record shows in a JSON object, for lines that carry them whole. */
export function rowFields(row: PlaceFactRow): JsonObject {
  const out: JsonObject = { id: row.id, key: row.key, value: row.value, turn: row.n };
  if (row.time !== null) out.time = row.time;
  if (row.beat !== null) out.beat = { id: row.beat.id, ...(row.beat.text !== null ? { text: row.beat.text } : {}), ...(row.beat.message !== null ? { message: row.beat.message } : {}) };
  if (row.precision !== null) out.precision = row.precision;
  if (row.standing !== null) out.standing = row.standing;
  if (row.source !== null) out.source = row.source;
  return out;
}
