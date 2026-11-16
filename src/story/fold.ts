// The story as an area of the store (plan §6.2, §6.3, §8.1, Appendix B "Story"). Every write the story lane takes is a change of
// the area, `story.<op>`, folded along the path with the engine's: a swipe or a delete takes a turn's writes off the path with the
// turn, and showing that swipe again brings them back; a branch has those of the turns it shares; a job's take effect where the
// store places a job's (§10.9); and one is undone by the area's own reverse and listed in the story lane of the review card. The
// area's slice of the state holds the record's items (eleven parts), the lore's overlays, and the Author's horizon. An item as it
// stands is its changes merged in order; its history is those changes. A later write never changes an earlier one. Code merges and
// counts; it never judges what an item says.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { AreaOp, AreaOutcome, AreaPart, Source, StoreArea, StoreState } from "../store";

/** The parts of the record, as the plan names them (§8.1). */
export const STORY_PARTS = ["premise", "chapter", "scene", "beat", "thread", "arc", "player", "future", "canon", "retcon", "record"] as const;
export type StoryPart = (typeof STORY_PARTS)[number];

/** The area's name: its operations are `story.<op>`. */
export const STORY_AREA_ID = "story";

/** The operations of the area, by their names in the changes. */
export const STORY_OPS = {
  /** One write of an item: `{ part, item, value }`; `value` holds the fields it sets, `close` and `drop` among them. */
  write: "story.write",
  /** An item put back as it stood (what undoes a write): `{ part, item, set, unset, closed, dropped }`. */
  restore: "story.restore",
  /** The Author's note that the story has moved past part of a lore entry (plan §9.3): `{ entry, note }`. */
  overlay: "story.overlay",
  /** An overlay taken off again (what undoes one): `{ entry, note }`. */
  unoverlay: "story.unoverlay",
  /** The Author's horizon (§6.4), replaced whole by one change: `{ list }`, each entry a tree ref or the Author's words, with a depth if set. */
  horizon: "story.horizon",
} as const;

/** One write of an item as its change holds it. */
export interface StoryWriteValue {
  part: StoryPart;
  item: string;
  value: JsonObject;
}

/** One write of an item as the item keeps it: the turn that made it (and that turn's number on the path), who, and what it said. */
export interface StoryRowDoc {
  turn: string;
  n: number;
  by: string | null;
  value: JsonObject;
}

/** An item as the slice keeps it. */
export interface StoryItemDoc {
  part: StoryPart;
  id: string;
  /** Every field its writes set, the latest of each. */
  fields: JsonObject;
  /** The turn that first wrote it, and the one that wrote it last. */
  opened: string;
  touched: string;
  /** The turn whose write closed it; null while it is open. */
  closedBy: string | null;
  dropped: boolean;
  /** Its writes on the path, oldest first. */
  rows: StoryRowDoc[];
}

/** An overlay as the slice keeps it: the entry, the note, and the turn that wrote it (with its number on the path). */
export interface OverlayDoc {
  entry: string;
  note: string;
  turn: string;
  n: number;
  by: string | null;
}

/** An entry of the horizon as the slice keeps it: a tree ref or the Author's words as he wrote them, and how deep the world state shows it (`full` when he set none). */
export interface HorizonEntry {
  at: string;
  depth: number | "full";
}

/** The area's slice of the folded state. */
export interface StorySlice {
  /** The record's items by id, in the order they were first written (an object keeps its keys in the order they were made, and no id is a whole number). */
  items: Record<string, StoryItemDoc>;
  /** The lore's overlays, in the order they were written along the path. */
  overlays: OverlayDoc[];
  /** The Author's horizon: one list for the chat, replaced whole by each change that sets it. */
  horizon: HorizonEntry[];
}

/** The id a new item of `part` is given: its part's prefix and the id of its first change, so an id says its part and is the change's. */
const PREFIX: Readonly<Record<StoryPart, string>> = { premise: "premise", chapter: "ch", scene: "sc", beat: "b", thread: "th", arc: "arc", player: "pm", future: "fu", canon: "ca", retcon: "rc", record: "rec" };

export function newItemId(part: StoryPart, change: number): string {
  return `${PREFIX[part]}-${change}`;
}

/** A name as the record compares names: trimmed, spaces folded, case ignored. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The id of the one item of a part there is per key: the premise, a person's arc, a turn's record. */
export function keyedItemId(part: "premise" | "arc" | "record", key: string): string {
  return part === "premise" ? PREFIX.premise : `${PREFIX[part]}:${nameKey(key)}`;
}

export function emptySlice(): StorySlice {
  return { items: {}, overlays: [], horizon: [] };
}

/** The story's slice of a folded state; the starting one where the state holds none. */
export function storySliceOf(state: Pick<StoreState, "areas">): StorySlice {
  const slice = state.areas?.[STORY_AREA_ID] as unknown as StorySlice | undefined;
  return slice ?? emptySlice();
}

function asSlice(slice: Readonly<JsonObject>): StorySlice {
  return slice as unknown as StorySlice;
}

function json(slice: StorySlice): JsonObject {
  return slice as unknown as JsonObject;
}

/** One change of the area as the replays of this file take it: the way the fold hands it to its reducer, without the marks. */
export interface StoryReplayed {
  op: string;
  value: JsonValue;
  turn: string;
  n: number;
  by: string | null;
  source?: Source | null;
}

/**
 * A slice with `changes` applied to it in order, each by its operation's reducer, as the fold applies them but for the store's checks
 * and marks: what a reading that stands outside the fold needs (a job of his own, a migration's starting state). A change a reducer
 * does not take is left out.
 */
export function applyStory(slice: StorySlice, changes: readonly StoryReplayed[]): StorySlice {
  let at = slice;
  for (const c of changes) {
    const name = c.op.slice(STORY_AREA_ID.length + 1);
    const def = c.op.startsWith(`${STORY_AREA_ID}.`) && hasOwn(STORY_STORE_AREA.ops, name) ? STORY_STORE_AREA.ops[name] : undefined;
    const out = def?.apply(json(at), { op: name, value: c.value, turn: c.turn, n: c.n, by: c.by, standing: null, precision: null, source: c.source ?? null, cite: null });
    if (out !== undefined && !("applied" in out)) at = asSlice(out.slice);
  }
  return at;
}

/**
 * An item after one more write of it (`prev` is null for the write that makes it): its fields merged, whether it is closed or struck,
 * the turn that touched it, and the write kept as its newest row. Nothing of `prev` is changed.
 */
export function mergeWrite(prev: StoryItemDoc | undefined, part: StoryPart, id: string, value: JsonObject, row: StoryRowDoc): StoryItemDoc {
  const base = prev ?? { part, id, fields: {}, opened: row.turn, touched: row.turn, closedBy: null, dropped: false, rows: [] };
  const fields: JsonObject = { ...base.fields };
  let closedBy = base.closedBy;
  let dropped = base.dropped;
  for (const [key, v] of Object.entries(value)) {
    if (key === "close") closedBy = v === true ? row.turn : null;
    else if (key === "drop") dropped = v === true;
    else fields[key] = v;
  }
  return { ...base, fields, closedBy, dropped, touched: row.turn, rows: [...base.rows, row] };
}

function readsAsWrite(value: JsonValue): string | null {
  if (!isRecord(value)) return "a write of the story is an object";
  if (typeof value.part !== "string" || !(STORY_PARTS as readonly string[]).includes(value.part)) return "a write of the story names its part (premise, chapter, scene, beat, thread, arc, player, future, canon, retcon or record)";
  if (typeof value.item !== "string" || value.item === "") return "a write of the story names its item";
  if (!isRecord(value.value)) return "a write of the story holds the fields it sets";
  return null;
}

const WRITE: AreaOp = {
  check: readsAsWrite,
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as unknown as StoryWriteValue;
    const item = mergeWrite(hasOwn(s.items, v.item) ? s.items[v.item] : undefined, v.part, v.item, v.value, { turn: change.turn, n: change.n, by: change.by, value: v.value });
    return { slice: json({ ...s, items: { ...s.items, [v.item]: item } }) };
  },
  touches(value): readonly AreaPart[] {
    const v = value as unknown as StoryWriteValue;
    const fields = Object.keys(v.value);
    return (fields.length === 0 ? ["item"] : fields).map((part) => ({ ref: `story:${v.item}`, part }));
  },
  undo(value, before, now) {
    const v = value as unknown as StoryWriteValue;
    const was = hasOwn(asSlice(before).items, v.item) ? asSlice(before).items[v.item] : undefined;
    // What the write made is struck, never taken away: its item stays on the record with its history.
    if (was === undefined) return [{ op: "write", value: { part: v.part, item: v.item, value: { drop: true } } }];
    const now_ = hasOwn(asSlice(now).items, v.item) ? asSlice(now).items[v.item] : undefined;
    if (now_ === undefined) return null;
    const keys = Object.keys(v.value).filter((k) => k !== "close" && k !== "drop");
    const set: JsonObject = {};
    const unset: string[] = [];
    for (const k of keys) {
      if (hasOwn(was.fields, k)) set[k] = was.fields[k] as JsonValue;
      else unset.push(k);
    }
    return [{ op: "restore", value: { part: v.part, item: v.item, set, unset, closed: "close" in v.value ? was.closedBy !== null : now_.closedBy !== null, dropped: "drop" in v.value ? was.dropped : now_.dropped } }];
  },
};

function readsAsRestore(value: JsonValue): string | null {
  if (!isRecord(value)) return "a restore of the story is an object";
  if (typeof value.part !== "string" || !(STORY_PARTS as readonly string[]).includes(value.part)) return "a restore of the story names its part";
  if (typeof value.item !== "string" || value.item === "") return "a restore of the story names its item";
  if (!isRecord(value.set)) return "a restore holds the fields it sets back";
  if (!Array.isArray(value.unset) || !value.unset.every((k) => typeof k === "string")) return "a restore holds the fields it takes off";
  if (typeof value.closed !== "boolean" || typeof value.dropped !== "boolean") return "a restore says whether the item is closed and whether it is struck";
  return null;
}

interface RestoreValue {
  part: StoryPart;
  item: string;
  set: JsonObject;
  unset: string[];
  closed: boolean;
  dropped: boolean;
}

const RESTORE: AreaOp = {
  check: readsAsRestore,
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as unknown as RestoreValue;
    const known = hasOwn(s.items, v.item) ? s.items[v.item] : undefined;
    if (known === undefined) return { applied: false, reports: [{ code: "no_item", values: { item: v.item } }] };
    const fields: JsonObject = { ...known.fields };
    for (const k of v.unset) delete fields[k];
    Object.assign(fields, v.set);
    const row: StoryRowDoc = { turn: change.turn, n: change.n, by: change.by, value: { ...v.set, ...(v.unset.length > 0 ? { unset: v.unset } : {}), close: v.closed, drop: v.dropped } };
    const item: StoryItemDoc = { ...known, fields, closedBy: v.closed ? (known.closedBy ?? change.turn) : null, dropped: v.dropped, touched: change.turn, rows: [...known.rows, row] };
    return { slice: json({ ...s, items: { ...s.items, [v.item]: item } }) };
  },
  touches(value): readonly AreaPart[] {
    const v = value as unknown as RestoreValue;
    return [...Object.keys(v.set), ...v.unset, "close", "drop"].map((part) => ({ ref: `story:${v.item}`, part }));
  },
};

function readsAsOverlay(value: JsonValue): string | null {
  if (!isRecord(value)) return "an overlay is an object";
  if (typeof value.entry !== "string" || value.entry === "") return "an overlay names the lore entry it is a note on";
  if (typeof value.note !== "string") return "an overlay holds its note";
  return null;
}

const OVERLAY: AreaOp = {
  check: readsAsOverlay,
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as { entry: string; note: string };
    return { slice: json({ ...s, overlays: [...s.overlays, { entry: v.entry, note: v.note, turn: change.turn, n: change.n, by: change.by }] }) };
  },
  undo(value) {
    return [{ op: "unoverlay", value }];
  },
};

const UNOVERLAY: AreaOp = {
  check: readsAsOverlay,
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as { entry: string; note: string };
    const at = s.overlays.findLastIndex((o) => o.entry === v.entry && o.note === v.note);
    if (at < 0) return { applied: false, reports: [{ code: "no_overlay", values: { entry: v.entry } }] };
    return { slice: json({ ...s, overlays: s.overlays.filter((_, i) => i !== at) }) };
  },
};

/** What a horizon change sends: a list whose entries are a tree ref or words, or an object with the entry in `at` and a `depth` (a whole number, or `full`). */
function horizonEntry(e: unknown): HorizonEntry | string {
  if (typeof e === "string") return e.trim() === "" ? "an entry of the horizon is not empty" : { at: e, depth: "full" };
  if (!isRecord(e) || typeof e.at !== "string" || e.at.trim() === "") return "an entry of the horizon is a tree ref or words, or an object with its place in `at`";
  const depth = e.depth ?? "full";
  if (depth !== "full" && !(typeof depth === "number" && Number.isInteger(depth) && depth >= 0)) return "an entry's depth is a whole number or `full`";
  return { at: e.at, depth };
}

const HORIZON: AreaOp = {
  check(value) {
    if (!isRecord(value) || !Array.isArray(value.list)) return "the horizon is sent as `{ list }`";
    const bad = value.list.map(horizonEntry).find((e) => typeof e === "string");
    return typeof bad === "string" ? bad : null;
  },
  apply(slice, change): AreaOutcome {
    // `check` has read the value: it is `{ list }` of entries `horizonEntry` reads.
    const sent = change.value as { list: unknown[] };
    const horizon = sent.list.map(horizonEntry) as HorizonEntry[];
    return { slice: json({ ...asSlice(slice), horizon }) };
  },
  touches: () => [{ ref: "story:horizon", part: "list" }],
  undo: (_value, before) => [{ op: "horizon", value: { list: horizonOf(asSlice(before)) as unknown as JsonValue } }],
};

/** The horizon of a slice, as the Author last set it. */
export function horizonOf(slice: Readonly<StorySlice>): HorizonEntry[] {
  return slice.horizon ?? [];
}

function namesIn(field: JsonValue | undefined): string[] {
  if (typeof field === "string") return [field];
  return Array.isArray(field) ? field.filter((w): w is string => typeof w === "string") : [];
}

function placeIn(item: StoryItemDoc): string | null {
  const place = item.fields.place;
  return typeof place === "string" && place.trim() !== "" ? place : null;
}

/**
 * The scene the chat is in, as the slice alone tells it: the one made last that is neither closed nor struck and names no end of its
 * own (a scene with a `last` is a stretch of the past). The story's readers that know the chat's messages place it by where it
 * starts (`StoryRecord.current`); this is the read the store and the world state ask, which hold no messages.
 */
export function openSceneOf(slice: Readonly<StorySlice>): StoryItemDoc | null {
  let found: StoryItemDoc | null = null;
  for (const item of Object.values(slice.items)) if (item.part === "scene" && item.closedBy === null && !item.dropped && item.fields.last === undefined) found = item;
  return found;
}

/** The threads still open, in the order they were made, with the names and the place the Author recorded on each and every field it holds. */
export function openThreadsOf(slice: Readonly<StorySlice>): { id: string; who: string[]; place: string | null; fields: JsonObject }[] {
  return Object.values(slice.items)
    .filter((i) => i.part === "thread" && i.closedBy === null && !i.dropped)
    .map((i) => ({ id: i.id, who: namesIn(i.fields.who), place: placeIn(i), fields: i.fields }));
}

const READS: NonNullable<StoreArea["reads"]> = {
  /** The horizon: `[{ at, depth }]`. */
  horizon: (slice) => horizonOf(asSlice(slice)) as unknown as JsonValue,
  /** The scene the chat is in: `{ scene, place, who }`, null when none is open. */
  scene(slice) {
    const scene = openSceneOf(asSlice(slice));
    return scene === null ? null : { scene: scene.id, place: placeIn(scene), who: namesIn(scene.fields.who) };
  },
  /** The threads still open: `[{ id, who, place, fields }]`. */
  threads: (slice) => openThreadsOf(asSlice(slice)) as unknown as JsonValue,
};

/** The story's area, as the store opens with it. */
export const STORY_STORE_AREA: StoreArea = {
  id: STORY_AREA_ID,
  initial: () => json(emptySlice()),
  ops: { write: WRITE, restore: RESTORE, overlay: OVERLAY, unoverlay: UNOVERLAY, horizon: HORIZON },
  reads: READS,
};
