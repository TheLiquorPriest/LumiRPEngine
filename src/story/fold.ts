// The story as an area of the store (plan §6.2, §6.3, §8.1, Appendix B "Story"). Every write the story lane takes is a change of
// the area, `story.<op>`, folded along the path with the engine's: a swipe or a delete takes a turn's writes off the path with the
// turn, and showing that swipe again brings them back; a branch has those of the turns it shares; a job's take effect where the
// store places a job's (§10.9); and one is undone by the area's own reverse and listed in the story lane of the review card. The
// area's slice of the state holds the record's items (eleven parts), the lore's overlays, and the Author's horizon. An item as it
// stands is its changes merged in order; its history is those changes. A later write never changes an earlier one. Code merges and
// counts; it never judges what an item says.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { AreaChange, AreaOp, AreaOutcome, AreaPart, StoreArea, StoreState } from "../store";

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

/** The area's slice of the folded state. */
export interface StorySlice {
  /** The record's items by id, in the order they were first written (an object keeps its keys in the order they were made, and no id is a whole number). */
  items: Record<string, StoryItemDoc>;
  /** The lore's overlays, in the order they were written along the path. */
  overlays: OverlayDoc[];
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
  return { items: {}, overlays: [] };
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

/** The story's area, as the store opens with it. */
export const STORY_STORE_AREA: StoreArea = {
  id: STORY_AREA_ID,
  initial: () => json(emptySlice()),
  ops: { write: WRITE, restore: RESTORE, overlay: OVERLAY, unoverlay: UNOVERLAY },
};

export type { AreaChange };
