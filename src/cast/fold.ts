// The cast's part of the store's one change model (plan §6.3, §7.1, Appendix B "Characters"): casting, growth, mind, memories,
// relationships, knowledge, history and perceptions are changes of the turn that wrote them, like coin and place, operation
// `cast.write`, folded here over the cast's own slice of the state. A swipe, a delete or a branch rewinds them with everything else;
// a job's are placed where the store places a job's (§10.9); the review card lists them and undo takes them back; a continue's held
// ones join the turn it extended by the store's own call. Nothing here reads a table or walks a chat's turns: a reading takes the
// slice from the store's held state.
//
// A write names the character, the part, the item (an item is every write of one id, merged in the order they take effect) and the
// fields it sets (`drop` among them). The slice keeps each write as it was made, so an item's history is its writes; its fields are
// read by merging them. A field a turn after the job's own wrote keeps that turn's value, as the store keeps a later turn's value
// over a job's: the change's place (`n`) says which, and the write that applies keeps the rest.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { AreaChange, AreaOp, AreaOutcome, StoreArea } from "../store";

/** The area's name: its operations are `cast.<op>`. */
export const CAST_AREA = "cast";

/** The one operation of the area: a write of an item. */
export const WRITE_OP = "write";

/** The change's operation as a change names it. */
export const CAST_WRITE = `${CAST_AREA}.${WRITE_OP}`;

/** The parts kept as writes tied to turns. `edit` is the owner's own edit of what the record keeps outside turns (a base document, a source, which person a character is): a note in the story lane that tells the Author of it. */
export const ROW_PARTS = ["casting", "growth", "mind", "relationship", "knowledge", "history", "perception", "memory", "away", "edit"] as const;
export type RowPart = (typeof ROW_PARTS)[number];

/** What a cast change's value holds: one write of one item. */
export interface WriteValue {
  character: string;
  part: RowPart;
  item: string;
  /** The fields this write sets. */
  value: JsonObject;
  /** The fields this write takes away (an undo of a write that set a field the item had none of). */
  unset?: string[];
  /** Story time when it was written, in minutes since the world's epoch; null in a chat that keeps no clock. */
  at?: number | null;
  /** The run (an agent's handle) that wrote it. */
  agent?: string | null;
  /** The moment the writer made the call, in milliseconds: writes of one call share it. */
  when?: number | null;
}

/** One write as the slice keeps it. */
export interface RowState {
  /** Its place among every write of the slice, in the order they took effect. */
  s: number;
  /** The turn it belongs to (a job's: the turn that started it), and that turn's place on the path. */
  turn: string;
  n: number;
  by: string | null;
  agent: string | null;
  at: number | null;
  when: number | null;
  /** The fields it set, those a later turn had written since left out. */
  value: JsonObject;
  unset?: string[];
}

/** An item as the slice keeps it: its part and its writes in the order they take effect. */
export interface ItemState {
  part: RowPart;
  rows: RowState[];
}

/** The cast's slice of the state: each character's items by id, and how many writes it has taken. */
export interface CastSlice {
  seq: number;
  items: { [character: string]: { [item: string]: ItemState } };
}

/** A slice with nothing in it. */
export const emptySlice = (): CastSlice => ({ seq: 0, items: {} });

/** The cast's slice of a state's areas: an empty one where the chat has none yet. */
export function sliceOf(areas: Readonly<Record<string, JsonObject>> | undefined): CastSlice {
  const found = areas?.[CAST_AREA] as unknown as CastSlice | undefined;
  return found === undefined || !isRecord(found.items) ? emptySlice() : found;
}

const maybe = (v: unknown, type: "string" | "number"): boolean => v === undefined || v === null || typeof v === type;

/** Null when `value` reads as a write; else why not. */
function check(value: JsonValue): string | null {
  if (!isRecord(value)) return "a cast write is an object";
  if (typeof value.character !== "string" || value.character === "") return "a cast write names its character";
  if (typeof value.part !== "string" || !(ROW_PARTS as readonly string[]).includes(value.part)) return `a cast write's part is one of ${ROW_PARTS.join(", ")}`;
  if (typeof value.item !== "string" || value.item === "") return "a cast write names its item";
  if (!isRecord(value.value)) return "a cast write's value is an object of the fields it sets";
  if (value.unset !== undefined && !(Array.isArray(value.unset) && value.unset.every((f) => typeof f === "string"))) return "a cast write's unset is a list of field names";
  if (!maybe(value.at, "number") || !maybe(value.when, "number") || !maybe(value.agent, "string")) return "a cast write's at and when are numbers and its agent is text";
  return null;
}

/** The place of the last write of an item that set or took away a field; none when no write did. */
function lastPlace(rows: readonly RowState[], field: string): number | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as RowState;
    if (Object.hasOwn(row.value, field) || row.unset?.includes(field)) return row.n;
  }
  return undefined;
}

/** An item's fields: every write merged in the order they take effect, `drop` apart. */
export function fieldsOf(rows: readonly RowState[]): { fields: JsonObject; dropped: boolean } {
  const fields: JsonObject = {};
  let dropped = false;
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.value)) {
      if (key === "drop") dropped = value === true;
      else fields[key] = value;
    }
    for (const key of row.unset ?? []) delete fields[key];
  }
  return { fields, dropped };
}

function apply(slice: Readonly<JsonObject>, change: AreaChange): AreaOutcome {
  const was = slice as unknown as CastSlice;
  const v = change.value as unknown as WriteValue;
  const mine = was.items[v.character] ?? {};
  const item = mine[v.item];
  const rows = item?.rows ?? [];
  // A field a turn after this change's own place wrote keeps that turn's value: a job's write placed late.
  const later = (field: string): boolean => (lastPlace(rows, field) ?? Number.NEGATIVE_INFINITY) > change.n;
  const set: JsonObject = {};
  const left: string[] = [];
  for (const [field, value] of Object.entries(v.value)) {
    if (later(field)) left.push(field);
    else set[field] = value;
  }
  const unset = (v.unset ?? []).filter((f) => !later(f));
  const reports = left.length > 0 ? [{ code: "later_value", values: { character: v.character, item: v.item, fields: left } }] : [];
  if (Object.keys(set).length === 0 && unset.length === 0 && left.length > 0) return { applied: false, reports };
  const row: RowState = { s: was.seq + 1, turn: change.turn, n: change.n, by: change.by, agent: v.agent ?? null, at: v.at ?? null, when: v.when ?? null, value: set, ...(unset.length > 0 ? { unset } : {}) };
  const next: ItemState = { part: item?.part ?? v.part, rows: [...rows, row] };
  const after: CastSlice = { seq: row.s, items: { ...was.items, [v.character]: { ...mine, [v.item]: next } } };
  return { slice: after as unknown as JsonObject, ...(reports.length > 0 ? { reports } : {}) };
}

/**
 * What undoing a write takes: the fields it set put back as they stood, those the item had none of taken away; an item it made is struck.
 * Changed since, as the store says it, when a later write set or took away a field this one did, whatever its value is now: the item's
 * rows are the record of which write set what, the write's own row sitting right after the rows the item had just before it.
 */
function undo(value: JsonValue, before: Readonly<JsonObject>, now: Readonly<JsonObject>): { op: string; value: JsonValue }[] | null | "changed_since" {
  const v = value as unknown as WriteValue;
  const was = (before as unknown as CastSlice).items[v.character]?.[v.item];
  const is = (now as unknown as CastSlice).items[v.character]?.[v.item];
  if (is === undefined) return null;
  const first = was?.rows.length ?? 0;
  const mine = is.rows[first];
  const set = mine?.value ?? v.value;
  const away = mine?.unset ?? v.unset ?? [];
  const wrote = new Set([...Object.keys(set), ...away]);
  if (is.rows.slice(first + 1).some((row) => Object.keys(row.value).some((f) => wrote.has(f)) || (row.unset ?? []).some((f) => wrote.has(f)))) return "changed_since";
  const same = { character: v.character, part: v.part, item: v.item, agent: v.agent ?? null };
  if (was === undefined) return [{ op: WRITE_OP, value: { ...same, value: { drop: true } } }];
  const beforeOf = fieldsOf(was.rows);
  const restore: JsonObject = {};
  const unset: string[] = [];
  for (const field of Object.keys(set)) {
    if (field === "drop") restore.drop = beforeOf.dropped;
    else if (Object.hasOwn(beforeOf.fields, field)) restore[field] = beforeOf.fields[field] as JsonValue;
    else unset.push(field);
  }
  // What it took away stands again.
  for (const field of away) if (Object.hasOwn(beforeOf.fields, field)) restore[field] = beforeOf.fields[field] as JsonValue;
  return [{ op: WRITE_OP, value: { ...same, value: restore, ...(unset.length > 0 ? { unset } : {}) } }];
}

const textOf = (v: JsonValue | undefined): string | null => (typeof v === "string" ? v : null);
const textsOf = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * What time brings due of the cast, read from the slice alone (the store lists it without knowing the cast): each away item not struck
 * whose intention is meant for a story time, with the character it is of (by the name and the world's person its write kept), where
 * they are and who they mean to see, the refs the write resolved. Nothing here applies it.
 */
function awayDue(slice: Readonly<JsonObject>): JsonValue {
  return Object.entries((slice as unknown as CastSlice).items).flatMap(([character, mine]) =>
    Object.entries(mine).flatMap(([id, item]) => {
      if (item.part !== "away") return [];
      const { fields, dropped } = fieldsOf(item.rows);
      if (dropped || typeof fields.until_at !== "number") return [];
      return [
        {
          id,
          character,
          name: textOf(fields.character_name),
          ref: textOf(fields.person_ref),
          whereabouts: textOf(fields.whereabouts),
          place_ref: textOf(fields.place_ref),
          names: textsOf(fields.names),
          name_refs: textsOf(fields.name_refs),
          intention: textOf(fields.intention),
          until_at: fields.until_at,
        },
      ];
    }),
  );
}

/** The cast as the store registers it (`StoreOptions.areas`): its one operation over its slice, and one named read of it. */
export const CAST_STORE_AREA: StoreArea = {
  id: CAST_AREA,
  initial: () => emptySlice() as unknown as JsonObject,
  ops: { [WRITE_OP]: { check, apply, undo } satisfies AreaOp },
  reads: { away: awayDue },
};
