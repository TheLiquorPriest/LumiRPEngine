// A place's record whole (plan §8.2, §14): the nine parts at the chat's head or at one of its turns, and the list of the chat's places
// as it plays them. Read from the state folded at that point, the entries bound to the place as Lumiverse holds them now, and the story's
// own record; nothing is changed.

import { MAP_DEFAULTS, type MapConfig } from "../iface/map";
import { baseAt } from "./base";
import { baseOf, placeSliceOf, sourcesOf } from "./fold";
import { accessOf, featuresOf, gridOf, type PlaceAt, placeDef, placeKindOf, sinceOf, factReader } from "./record";
import type { PlacesSettings } from "./settings";
import type { PlaceRecordAnswer, PlaceRowShown, PlaceSourceRow } from "./shapes";
import type { CastKnowledge } from "./known";
import { type PlaceSourcesReader, sourcesNow } from "./sources";
import { waysPart } from "./ways";
import { hereOf, historyOf, knownOf } from "./whole";
import { madeOf } from "../engine/places-in-play";

export interface PlaceReadDeps {
  /** What the record reads of the lore; left out, no entry is bound to any place. */
  sources?: PlaceSourcesReader;
  settings: PlacesSettings;
  config?: MapConfig;
  /** The cast at the point read, for who knows of a place; left out, only the world's own record of it. */
  cast?: CastKnowledge;
}

/** One place as a row of the list: its name, the place it is in, its kind, and whether it draws a grid of its own. */
export function placeRow(at: PlaceAt, place: string): PlaceRowShown | null {
  const def = placeDef(at, place);
  if (def === undefined) return null;
  const parent = def.parent === undefined ? undefined : placeDef(at, def.parent);
  return { place, name: def.name, parent: def.parent === undefined ? null : { id: def.parent, name: parent?.name ?? def.parent }, kind: placeKindOf(at, place), grid: gridOf(at, place) !== null, made: madeOf(def) !== null };
}

/** Every place of the chat as it plays them, the places inside a place after it, in the order the world lists them. */
export function placeRows(at: PlaceAt): PlaceRowShown[] {
  const ids = Object.keys(at.ctx.world.places);
  const kids = new Map<string | undefined, string[]>();
  for (const id of ids) {
    const parent = placeDef(at, id)?.parent;
    const key = parent !== undefined && placeDef(at, parent) !== undefined ? parent : undefined;
    kids.set(key, [...(kids.get(key) ?? []), id]);
  }
  const out: PlaceRowShown[] = [];
  const walk = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const row = placeRow(at, id);
    if (row !== null) out.push(row);
    for (const k of kids.get(id) ?? []) walk(k, seen);
  };
  const seen = new Set<string>();
  for (const root of kids.get(undefined) ?? []) walk(root, seen);
  return out;
}

/** A place's sources as the record shows them: each entry bound to it, read live, set against its base. */
export function sourceRows(sources: readonly { entry: string; aspect: string; by: string; title: string | null; revision: string | null; drawn: string | null; newer: boolean }[]): PlaceSourceRow[] {
  return sources.map((s) => ({ entry: s.entry, aspect: s.aspect, by: s.by, title: s.title, revision: s.revision, drawn: s.drawn, newer: s.newer }));
}

/** A place's record in its nine parts at the point read; null where the chat plays no such place. */
export async function readPlace(at: PlaceAt, place: string, deps: PlaceReadDeps): Promise<PlaceRecordAnswer | null> {
  const row = placeRow(at, place);
  if (row === null) return null;
  const slice = placeSliceOf(at.state);
  const sources = deps.sources === undefined ? { sources: [], older: false } : await sourcesNow(deps.sources, { user: at.user, chat: at.chat }, place, baseOf(slice, place), sourcesOf(slice, place));
  const reader = factReader(at);
  const config = deps.config ?? MAP_DEFAULTS;
  return {
    place,
    ref: `place:${place}`,
    name: row.name,
    parent: row.parent,
    kind: row.kind,
    grid: row.grid,
    made: row.made,
    turn: at.turn,
    sources: sourceRows(sources.sources),
    base: baseAt(at, place, sources),
    since: sinceOf(at, place, deps.settings, reader),
    features: featuresOf(at, place, deps.settings, config, reader),
    here: hereOf(at, place),
    ways: waysPart(at, place),
    access: accessOf(at, place, deps.settings, config, reader),
    history: historyOf(at, place, deps.settings),
    known: knownOf(at, place, deps.cast),
  };
}

