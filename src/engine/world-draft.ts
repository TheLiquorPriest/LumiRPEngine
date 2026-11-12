// This chat's own working draft of its world (DEPTH2-PLAN §2): the world's document as the chat plays
// it, changed in play. A place of the world's own, a path between two places, a map (with the places,
// grid and paths it draws) and the map settings can be made, changed or taken out by an `engine.world`
// event in the chat's own record, which writes the item whole into the engine pack's state
// (`packs.engine.world`), or marks it taken out. Every reader sees it through `playedWorld`
// (`places-in-play.ts`), which lays the draft over the revision the chat plays, compiles the maps
// again, then lays the places made in play over that. So a change plays at once, goes with its turn (a
// swipe, a deleted reply, the whole turn undone), and folds alike wherever its record is folded again.
//
// Each change keeps what it was made over (`over`): a digest of the world's own item then, or null
// where the world had none. It plays only while the world's own item is still that one. An Upgrade
// carries the draft to the new revision (`carryDraft`), as the touched record carries what play wrote
// of the chat's people and things: a change the new revision took in (it has the item as the change
// wrote it) goes, so the world's own plays from then on; one it changed otherwise is kept, made over
// its item now. A change is kept into the world's document by `world_keep`; committing that is a
// separate act. A change that leaves the world as it plays it (written back as the world has it, or
// the taking out of an item only the draft had) is no change: its entry goes.
//
// Only what the engine reads as it plays is carried here, never what a chat's state starts from or
// folds by: the world's places, paths and maps, and how the maps work. Pure.

import { SIGHT_MAX } from "../shared/grid";
import { hashJson } from "../shared/hash";
import type { PlaceVisibility } from "../shared/ids";
import { hasOwn, isRecord, safeKey, type JsonObject } from "../shared/json";
import type { LedgerEvent, PackEvent } from "../shared/ledger";
import { compileMaps, readMap, TRAVEL_MODES } from "../shared/maps";
import type { MapSettings, WorldDoc } from "../shared/world";
import { labelOf, mutableSlice, own } from "./pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "./registry";
import type { WorldState } from "./state";

/** The event that writes one change of this chat's draft of its world. */
export const DRAFT_EVENT = "engine.world";

const PACK = "engine";
const SLICE = "world";

/** The collections of the world's document the draft carries. */
export const DRAFT_COLLECTIONS = ["places", "routes", "maps"] as const;
export type DraftCollection = (typeof DRAFT_COLLECTIONS)[number];
/** The parts it carries. */
export const DRAFT_PARTS = ["mapSettings"] as const;
export type DraftPart = (typeof DRAFT_PARTS)[number];

/** One change as the draft keeps it: the item written whole (`value`) or taken out (`gone`), and the digest of the world's own item it was made over (null: the world had none). */
export interface DraftEntry {
  value?: JsonObject;
  gone?: true;
  over: string | null;
}

/** The draft as the state holds it: each carried collection's changes by id, and each part's. Never changed in place: each write replaces the record, whose identity every played world is kept by. */
export interface WorldDraft {
  places?: Readonly<Record<string, DraftEntry>>;
  routes?: Readonly<Record<string, DraftEntry>>;
  maps?: Readonly<Record<string, DraftEntry>>;
  mapSettings?: DraftEntry;
}

/** One change asked of the draft: an item of a collection, or a part, written whole or taken out. */
export type DraftEdit = ({ collection: DraftCollection; id: string } | { part: DraftPart }) & ({ value: JsonObject } | { gone: true });

/** A change as its event carries it: with what it was made over. */
type DraftChange = DraftEdit & { over: string | null };

/** How a reason names an item of each collection. */
const NOUN: Readonly<Record<DraftCollection, string>> = { places: "place", routes: "path", maps: "map" };

const VISIBILITIES: readonly PlaceVisibility[] = ["public", "known_by", "secret", "discoverable"];

/** The draft of a chat that changed nothing of its world: one object, so a reader keyed on the draft's identity keeps its memo. */
export const NO_DRAFT: Readonly<WorldDraft> = Object.freeze({});

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- the draft and what it plays

/** The draft as this state holds it; one object (`NO_DRAFT`) while it holds none, so a reader keyed on its identity keeps its memo. */
export function chatDraftOf(state: Readonly<WorldState>): Readonly<WorldDraft> {
  const v = state.packs[PACK]?.[SLICE];
  return isRecord(v) ? (v as Readonly<WorldDraft>) : NO_DRAFT;
}

/** A stored change read back, or null where it isn't one (a damaged save is read past, never thrown on). */
function entryOf(raw: unknown): DraftEntry | null {
  if (!isRecord(raw)) return null;
  const over = raw.over;
  if (over !== null && typeof over !== "string") return null;
  if (raw.gone === true) return raw.value === undefined ? { gone: true, over } : null;
  return isRecord(raw.value) ? { value: raw.value as JsonObject, over } : null;
}

/** What a change records it was made over: the digest of the world's own item, key order aside. */
function digestOf(item: unknown): string {
  return hashJson(item);
}

/** Whether a change plays over the world's own item `held`: the world still has what the change was made over. */
function applies(entry: DraftEntry, held: unknown): boolean {
  return entry.over === null ? held === undefined : held !== undefined && digestOf(held) === entry.over;
}

function heldIn(world: WorldDoc, collection: DraftCollection, id: string): unknown {
  return own(world[collection] as Readonly<Record<string, unknown>>, id);
}

/** `base` (a revision as authored) with the draft's changes that play over it, its maps compiled again; `base` itself where none does. */
export function draftedWorld(base: WorldDoc, draft: Readonly<WorldDraft>): WorldDoc {
  if (draft === NO_DRAFT) return base;
  let out: WorldDoc | null = null;
  for (const collection of DRAFT_COLLECTIONS) {
    const entries = draft[collection];
    if (!isRecord(entries)) continue;
    let items: Record<string, unknown> | null = null;
    for (const [id, raw] of Object.entries(entries)) {
      const entry = entryOf(raw);
      if (!entry || !applies(entry, heldIn(base, collection, id))) continue;
      items ??= { ...base[collection] };
      if (entry.value) items[id] = entry.value;
      else delete items[id];
    }
    if (items) out = { ...(out ?? base), [collection]: items } as WorldDoc;
  }
  const settings = entryOf(draft.mapSettings);
  if (settings && applies(settings, base.mapSettings)) {
    out = { ...(out ?? base) };
    if (settings.value) out.mapSettings = settings.value as unknown as MapSettings;
    else delete out.mapSettings;
  }
  return out === null ? base : compileMaps(out);
}

/** The draft's changes that play over `base`, each as what it writes: the collections in order, then the parts. */
export function draftChanges(base: WorldDoc, draft: Readonly<WorldDraft>): DraftEdit[] {
  const out: DraftEdit[] = [];
  for (const collection of DRAFT_COLLECTIONS) {
    const entries = draft[collection];
    if (!isRecord(entries)) continue;
    for (const [id, raw] of Object.entries(entries)) {
      const entry = entryOf(raw);
      if (!entry || !applies(entry, heldIn(base, collection, id))) continue;
      out.push(entry.value ? { collection, id, value: entry.value } : { collection, id, gone: true });
    }
  }
  const settings = entryOf(draft.mapSettings);
  if (settings && applies(settings, base.mapSettings)) out.push(settings.value ? { part: "mapSettings", value: settings.value } : { part: "mapSettings", gone: true });
  return out;
}

/**
 * The event that makes `edit` in the draft over `base` (the revision the chat plays, as authored):
 * made over what the change it replaces was made over, where that one still plays, else over the
 * world's own item as it is now.
 */
export function draftEvent(base: WorldDoc, draft: Readonly<WorldDraft>, edit: DraftEdit): PackEvent {
  const held = "part" in edit ? base[edit.part] : heldIn(base, edit.collection, edit.id);
  const was = entryOf("part" in edit ? draft[edit.part] : own(draft[edit.collection] ?? {}, edit.id));
  const over = was && applies(was, held) ? was.over : held === undefined ? null : digestOf(held);
  return { type: DRAFT_EVENT, data: { ...edit, over } as unknown as JsonObject };
}

/** `entry` as an Upgrade carries it over `held`, the item of the revision the chat moves to: as it was, made over `held`, or null where that revision took it in. */
function carriedOver(entry: DraftEntry, held: unknown): DraftEntry | null {
  if (applies(entry, held)) return entry;
  const takenIn = entry.value ? held !== undefined && digestOf(held) === digestOf(entry.value) : held === undefined;
  return takenIn ? null : { ...entry, over: held === undefined ? null : digestOf(held) };
}

/**
 * The draft as an Upgrade carries it to the revision `to` (a `migrate` marker's step, `upgrade.ts`):
 * a change `to` left alone plays on as it was, one `to` took in goes, and one `to` changed otherwise
 * is kept, made over `to`'s own item, so what the chat wrote plays on over the new revision.
 */
export function carryDraft(state: WorldState, to: WorldDoc): void {
  const draft = chatDraftOf(state);
  const next: JsonObject = {};
  let moved = false;
  const carried = (raw: unknown, held: unknown): JsonObject | null => {
    const entry = entryOf(raw);
    const kept = entry ? carriedOver(entry, held) : null;
    if (kept !== entry) moved = true;
    return kept === null ? null : kept.value ? { value: kept.value, over: kept.over } : { gone: true, over: kept.over };
  };
  for (const collection of DRAFT_COLLECTIONS) {
    const entries = draft[collection];
    if (!isRecord(entries)) continue;
    const items: JsonObject = {};
    for (const [id, raw] of Object.entries(entries)) {
      const kept = carried(raw, heldIn(to, collection, id));
      if (kept) items[id] = kept;
    }
    if (Object.keys(items).length > 0) next[collection] = items;
  }
  if (draft.mapSettings !== undefined) {
    const kept = carried(draft.mapSettings, to.mapSettings);
    if (kept) next.mapSettings = kept;
  }
  if (!moved) return;
  // Replaced, never changed in place, as the event's apply replaces it.
  const slice = mutableSlice(state, PACK);
  if (Object.keys(next).length > 0) slice[SLICE] = next;
  else delete slice[SLICE];
}

/** Whether an event is a change of this chat's draft of its world. */
export function isDraftEvent(e: LedgerEvent): boolean {
  return e.type === DRAFT_EVENT;
}

// ---------------------------------------------------------------- the event

/** An event's change, read for its shape; null when it isn't one. */
function changeOf(data: unknown): DraftChange | null {
  if (!isRecord(data)) return null;
  const over = data.over;
  if (over !== null && typeof over !== "string") return null;
  const body = data.gone === true && data.value === undefined ? { gone: true as const } : isRecord(data.value) && data.gone === undefined ? { value: data.value as JsonObject } : null;
  if (!body) return null;
  if (data.part !== undefined) {
    const part = DRAFT_PARTS.find((p) => p === data.part);
    return part && data.collection === undefined && data.id === undefined ? { part, ...body, over } : null;
  }
  const collection = DRAFT_COLLECTIONS.find((c) => c === data.collection);
  return collection && safeKey(data.id) ? { collection, id: data.id, ...body, over } : null;
}

/** What is wrong with `v` as the world's place `id`, in plain words; null where nothing is. */
function placeProblem(id: string, v: JsonObject): string | null {
  if (v.id !== id) return `a place's id is its key, ${id}`;
  if (typeof v.name !== "string" || v.name.trim() === "") return "a place needs a name";
  if (v.parent !== undefined && (typeof v.parent !== "string" || v.parent === "")) return "a place's parent is the id of a place";
  if (!isRecord(v.fields)) return "a place's fields are an object";
  if (v.visibility !== undefined && !VISIBILITIES.some((s) => s === v.visibility)) return `a place's visibility is one of ${VISIBILITIES.join(", ")}`;
  for (const key of ["timeZone", "sceneType", "grid"] as const) if (v[key] !== undefined && typeof v[key] !== "string") return `a place's ${key} is text`;
  for (const key of ["cell", "layoutPos"] as const) {
    const at = v[key];
    if (at !== undefined && !(isRecord(at) && typeof at.x === "number" && typeof at.y === "number")) return `a place's ${key} is {x, y}`;
  }
  if (v.knownBy !== undefined && !isRecord(v.knownBy)) return "a place's knownBy is a selector";
  if (v.adjudicate !== undefined && typeof v.adjudicate !== "boolean") return "a place's adjudicate is true or false";
  if (v.sources !== undefined && !(Array.isArray(v.sources) && v.sources.every((s) => typeof s === "string"))) return "a place's sources are a list of entries";
  if (v.map !== undefined) return "only a map marks what it draws";
  if (v.made !== undefined) return "a place made in play is changed by place_label and place_remove";
  return null;
}

/** What is wrong with `v` as the world's path `id`; null where nothing is. */
function routeProblem(id: string, v: JsonObject): string | null {
  if (v.id !== id) return `a path's id is its key, ${id}`;
  if (typeof v.from !== "string" || typeof v.to !== "string" || v.from === "" || v.to === "") return "a path joins two places, from and to";
  if (v.from === v.to) return "a path joins two different places";
  if (typeof v.bidirectional !== "boolean") return "a path goes both ways or one way (bidirectional is true or false)";
  if (!isRecord(v.modes) || Object.keys(v.modes).length === 0) return "a path has at least one way of travelling it";
  for (const [mode, leg] of Object.entries(v.modes)) {
    if (!TRAVEL_MODES.some((m) => m === mode)) return `${mode} is no way of travelling: ${TRAVEL_MODES.join(", ")}`;
    if (!isRecord(leg) || typeof leg.minutes !== "number" || !Number.isFinite(leg.minutes) || leg.minutes <= 0) return `the ${mode} way takes some minutes, above 0`;
    if (leg.distanceKm !== undefined && !(typeof leg.distanceKm === "number" && Number.isFinite(leg.distanceKm) && leg.distanceKm > 0)) return `the ${mode} way's distance is kilometres, above 0`;
    if (leg.terrain !== undefined && typeof leg.terrain !== "string") return `the ${mode} way's terrain is text`;
  }
  if (v.map !== undefined) return "only a map marks what it draws";
  return null;
}

/** What is wrong with `v` as the world's map `id`: the map's own published shape, then its key. */
function mapProblem(id: string, v: JsonObject): string | null {
  const { map, problems } = readMap(v);
  if (!map) return problems.slice(0, 3).map((p) => p.message).join("; ") || "that isn't a map";
  return map.id === id ? null : `a map's id is its key, ${id}`;
}

const ITEM_PROBLEM: Readonly<Record<DraftCollection, (id: string, v: JsonObject) => string | null>> = { places: placeProblem, routes: routeProblem, maps: mapProblem };

/** What is wrong with `v` as the map settings, as the space pack's checks read them; null where nothing is. */
function settingsProblem(v: JsonObject): string | null {
  if (v.display !== undefined && v.display !== "knowledge" && v.display !== "fog") return 'the map shows "knowledge" or "fog"';
  const grid = v.grid;
  if (grid !== undefined) {
    if (!isRecord(grid)) return "the grid system's settings are an object: movement and sightRadius";
    if (grid.movement !== undefined && typeof grid.movement !== "boolean") return "grid movement is true or false";
    const r = grid.sightRadius;
    if (r !== undefined && !(typeof r === "number" && Number.isInteger(r) && r >= 0 && r <= SIGHT_MAX)) return `the sight radius is a whole number of cells from 0 to ${SIGHT_MAX}`;
  }
  if (v.travelSimulation !== undefined && typeof v.travelSimulation !== "boolean") return "the travel simulation is true or false";
  if (v.travel !== undefined && !isRecord(v.travel)) return "travel times are an object";
  return null;
}

/** The world as `world` plays with `change` made over it, its maps compiled again (a place made in play carries no map, so it stays). */
function withChange(world: WorldDoc, change: DraftChange): WorldDoc {
  if ("part" in change) {
    const out: WorldDoc = { ...world };
    if ("value" in change) out.mapSettings = change.value as unknown as MapSettings;
    else delete out.mapSettings;
    return compileMaps(out);
  }
  const items: Record<string, unknown> = { ...world[change.collection] };
  if ("value" in change) items[change.id] = change.value;
  else delete items[change.id];
  return compileMaps({ ...world, [change.collection]: items } as WorldDoc);
}

/**
 * What `change` would leave without its place, in plain words: someone or something at a place it
 * takes away, a place or a path that would lose a place it names, a place inside itself, a map with
 * nothing to draw, the place the world starts at. Null where it leaves the world whole.
 */
function leftProblem(ctx: ReadContext, change: DraftChange): string | null {
  const before = ctx.world;
  const after = withChange(before, change);
  const has = (id: string): boolean => hasOwn(after.places, id);
  const lost = (id: string): boolean => hasOwn(before.places, id) && !has(id);
  if (lost(before.start.place)) return `it would take away ${labelOf(ctx, before.start.place)}, where the world starts`;
  for (const [id, e] of Object.entries(ctx.state.entities)) {
    const at = e.fields.place;
    if (typeof at === "string" && lost(at)) return `${e.name} (${id}) is at ${labelOf(ctx, at)}, which it would take away`;
  }
  for (const [id, p] of Object.entries(after.places)) {
    if (p.parent !== undefined && !has(p.parent) && (lost(p.parent) || (!("part" in change) && change.collection === "places" && change.id === id))) return `${p.name} (${id}) would be inside ${p.parent}, which isn't a place`;
  }
  for (const [id, r] of Object.entries(after.routes)) {
    if (has(r.from) && has(r.to)) continue;
    const was = own(before.routes, id);
    // A path the world already had without one of its ends is the world's own fault, not this change's.
    if (was && was.from === r.from && was.to === r.to && !(hasOwn(before.places, r.from) && hasOwn(before.places, r.to))) continue;
    return `the path ${id} would lead to ${has(r.from) ? r.to : r.from}, which isn't a place`;
  }
  if ("part" in change || !("value" in change)) return null;
  if (change.collection === "places") {
    let at = own(after.places, change.id)?.parent;
    for (let guard = Object.keys(after.places).length; at !== undefined && guard >= 0; guard--) {
      if (at === change.id) return `${labelOf(ctx, change.id)} can't be inside itself`;
      at = own(after.places, at)?.parent;
    }
  }
  if (change.collection === "maps" && typeof change.value.scope === "string" && !has(change.value.scope)) return `the map ${change.id} draws ${change.value.scope}, which isn't a place`;
  return null;
}

/** A change of this chat's draft of its world: a place, a path or a map written whole or taken out, or the map settings. */
export const draftEventDef: EventTypeDef<PackEvent> = {
  type: DRAFT_EVENT,
  validate(e, ctx) {
    const change = changeOf(e.data);
    if (!change) return reject("bad_change", "that isn't a change of the world as this chat plays it");
    if ("part" in change) {
      const bad = "value" in change ? settingsProblem(change.value) : null;
      if (bad !== null) return reject("bad_item", bad);
    } else {
      const { collection, id } = change;
      const held = heldIn(ctx.world, collection, id);
      if (isRecord(held) && typeof held.map === "string") return reject("drawn", `the ${NOUN[collection]} ${id} is drawn by the map ${held.map}: change it in that map`);
      if (collection === "places" && isRecord(held) && isRecord(held.made)) return reject("made_in_play", `${labelOf(ctx, id)} was made in play: place_label and place_remove change it`);
      if ("gone" in change && held === undefined) return reject("gone", `there is no ${NOUN[collection]} ${id} to take out`);
      const bad = "value" in change ? ITEM_PROBLEM[collection](id, change.value) : null;
      if (bad !== null) return reject("bad_item", bad);
    }
    const left = leftProblem(ctx, change);
    return left === null ? null : reject("leaves_out", left);
  },
  // The record is replaced, never changed in place: its identity is what every played world is kept by.
  apply(e, state) {
    const change = changeOf(e.data);
    if (!change) return;
    const slice = mutableSlice(state, PACK);
    const was: JsonObject = isRecord(slice[SLICE]) ? (slice[SLICE] as JsonObject) : {};
    const entry: JsonObject = "value" in change ? { value: structuredClone(change.value), over: change.over } : { gone: true, over: change.over };
    // Written back as the world has it, or the taking out of what only the draft had: the world plays as its own again.
    const back = "value" in change ? change.over !== null && digestOf(change.value) === change.over : change.over === null;
    if ("part" in change) {
      const next: JsonObject = { ...was };
      if (back) delete next[change.part];
      else next[change.part] = entry;
      slice[SLICE] = next;
      return;
    }
    const items: JsonObject = { ...(isRecord(was[change.collection]) ? (was[change.collection] as JsonObject) : {}) };
    if (back) delete items[change.id];
    else items[change.id] = entry;
    slice[SLICE] = { ...was, [change.collection]: items };
  },
  // The author's and the game master's line; a player's line has none, as the footer counts it.
  describe(e, ctx, viewer) {
    const change = viewer === undefined ? changeOf(e.data) : null;
    if (!change) return "";
    const how = "gone" in change ? "taken out" : change.over === null ? "made" : "changed";
    if ("part" in change) return `In this chat's world: the map settings ${how}`;
    const v = "value" in change ? change.value : (heldIn(ctx.world, change.collection, change.id) as JsonObject | undefined);
    const what =
      change.collection === "routes"
        ? `the path from ${labelOf(ctx, typeof v?.from === "string" ? v.from : "")} to ${labelOf(ctx, typeof v?.to === "string" ? v.to : "")}`
        : change.collection === "maps"
          ? `the map ${typeof v?.title === "string" ? v.title : change.id}`
          : `the place ${typeof v?.name === "string" ? v.name : labelOf(ctx, change.id)}`;
    return `In this chat's world: ${what} ${how}`;
  },
};
