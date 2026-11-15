// The story record (plan §8.1): the Author's understanding of the story, as items of eleven parts.
// Every write is a row of the item it touches, tied to the turn that wrote it, holding only what that
// write said. An item as it stands is its rows on the reading's path, merged in order; its history is
// those rows. Code merges and counts; it never judges what an item says.
//
// Where an item stands in the chat comes from the records alone: a beat lies at the message it names,
// or at its turn's reply; a scene or a chapter runs from the message it names, or from the first
// message its opening turn answered, to the message it names, or its closing turn's reply, and never
// past the start of the next one.

import type { Database } from "bun:sqlite";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import { joinable, refuseJoined, type Store, StoreInputError } from "../store";
import type { StoryAt } from "./path";

/** The parts of the record, as the plan names them (§8.1). */
export const STORY_PARTS = ["premise", "chapter", "scene", "beat", "thread", "arc", "player", "future", "canon", "retcon", "record"] as const;
export type StoryPart = (typeof STORY_PARTS)[number];

/** The parts of the timeline that span messages. */
export type SpanPart = "chapter" | "scene";

/** What an item's id starts with, so that an id says its part. */
const PREFIX: Readonly<Record<StoryPart, string>> = { premise: "premise", chapter: "ch", scene: "sc", beat: "b", thread: "th", arc: "arc", player: "pm", future: "fu", canon: "ca", retcon: "rc", record: "rec" };

/** One write of an item, as stored. */
export interface StoryRow {
  id: number;
  turn: string;
  ord: number;
  part: StoryPart;
  item: string;
  /** What this write said: the fields it set, `close` and `drop` among them. */
  value: JsonObject;
  /** The agent's definition that wrote it, or the player. */
  by: string | null;
  /** The agent's handle in its run. */
  agent: string | null;
  job: string | null;
  created: number;
}

/** An item as it stands on a path. */
export interface StoryItem {
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
  rows: StoryRow[];
}

/** Messages by number, both ends kept; an end is null where the record cannot place it. */
export interface Span {
  from: number | null;
  to: number | null;
}

interface RowDb {
  id: number;
  turn: string;
  ord: number;
  part: string;
  item: string;
  value: string;
  by: string | null;
  agent: string | null;
  job: string | null;
  created: number;
}

/** The record as one reading sees it. */
export class StoryRecord {
  readonly items = new Map<string, StoryItem>();

  constructor(readonly at: StoryAt) {}

  /** The record at `at`: the rows of the turns on its path, in the path's order. */
  static read(db: Database, user: string, at: StoryAt): StoryRecord {
    const rows = db
      .query<RowDb, [string, string]>("SELECT * FROM story_entry WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2))")
      .all(user, JSON.stringify(at.turns))
      .sort((a, b) => (at.order.get(a.turn) ?? 0) - (at.order.get(b.turn) ?? 0) || a.ord - b.ord);
    const record = new StoryRecord(at);
    for (const r of rows) record.apply({ ...r, part: r.part as StoryPart, value: JSON.parse(r.value) as JsonObject });
    return record;
  }

  /** Merges one write in: the item's fields, whether it is closed or dropped, and when it was touched. */
  apply(row: StoryRow): StoryItem {
    let item = this.items.get(row.item);
    if (item === undefined) {
      item = { part: row.part, id: row.item, fields: {}, opened: row.turn, touched: row.turn, closedBy: null, dropped: false, rows: [] };
      this.items.set(row.item, item);
    }
    for (const [key, value] of Object.entries(row.value)) {
      if (key === "close") item.closedBy = value === true ? row.turn : null;
      else if (key === "drop") item.dropped = value === true;
      else item.fields[key] = value;
    }
    item.touched = row.turn;
    item.rows.push(row);
    return item;
  }

  /** A part's items in the order they were first written; those dropped only when asked. */
  of(part: StoryPart, dropped = false): StoryItem[] {
    return [...this.items.values()].filter((i) => i.part === part && (dropped || !i.dropped));
  }

  /** The number of the message a field holds the id of; null when it holds none or it is not on the chat's path. */
  numberOf(field: JsonValue | undefined): number | null {
    return typeof field === "string" ? this.at.number(field) : null;
  }

  /** Where a beat lies: the message it names, or its turn's reply. */
  beatAt(beat: StoryItem): number | null {
    return beat.fields.message !== undefined ? this.numberOf(beat.fields.message) : this.at.replyOf(beat.opened);
  }

  /** The messages a beat covers: from where it lies through the last message it names, where it names one (a beat recorded from a stretch of the chat's past); else where it lies alone. */
  beatSpan(beat: StoryItem): Span {
    const from = this.beatAt(beat);
    const to = beat.fields.last !== undefined ? this.numberOf(beat.fields.last) : null;
    return { from, to: from === null ? null : to !== null && to > from ? to : from };
  }

  /** Where a scene or a chapter starts: the message it names, or the first message its opening turn answered. */
  startOf(item: StoryItem): number | null {
    return item.fields.first !== undefined ? this.numberOf(item.fields.first) : this.at.startOf(item.opened);
  }

  /** Each scene's or chapter's messages (see the header), by id; dropped ones have none. */
  spans(part: SpanPart): Map<string, Span> {
    const known = this.of(part).map((item, made) => ({ item, made, from: this.startOf(item) }));
    // Placed by where each starts, one that cannot be placed after every other; then by when it was made.
    known.sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY) || a.made - b.made);
    const last = this.at.messages.length - 1;
    const out = new Map<string, Span>();
    known.forEach(({ item, from }, i) => {
      if (from === null) {
        out.set(item.id, { from: null, to: null });
        return;
      }
      if (item.fields.last !== undefined) {
        out.set(item.id, { from, to: this.numberOf(item.fields.last) });
        return;
      }
      // One placed by the messages it names may start where this one does; the next to start later bounds it.
      const next = known.slice(i + 1).find((k) => k.from !== null && k.from > from)?.from ?? null;
      const stop = item.closedBy === null ? last : (this.at.replyOf(item.closedBy) ?? last);
      out.set(item.id, { from, to: next === null ? stop : Math.min(stop, next - 1) });
    });
    return out;
  }

  /**
   * The scene or chapter the chat is in now: the one that starts last, one whose opening turn is not
   * placed yet counting as last. One that names a first message the chat no longer has (deleted) is
   * past, not current. Null when there is none. It may be closed: then the chat is in none.
   */
  current(part: SpanPart): StoryItem | null {
    let best: { item: StoryItem; from: number } | null = null;
    for (const item of this.of(part)) {
      const placed = this.startOf(item);
      if (placed === null && item.fields.first !== undefined) continue;
      const from = placed ?? Number.POSITIVE_INFINITY;
      if (best === null || from >= best.from) best = { item, from };
    }
    return best?.item ?? null;
  }
}

/** One write a call asks for: of an item already there (`item`), or of a new one (`item` null). */
export interface StoryWrite {
  part: StoryPart;
  item: string | null;
  value: JsonObject;
}

/** Who writes, on which turn, and when. */
export interface StoryWriter {
  user: string;
  turn: string;
  by: string | null;
  agent: string | null;
  job: string | null;
  now: number;
}

/** The id a new item of `part` is given from its first row's id. */
export function newItemId(part: StoryPart, row: number): string {
  return `${PREFIX[part]}-${row}`;
}

/** A name as the record compares names: trimmed, spaces folded, case ignored. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The id of the one item of a part there is per key: the premise, a person's arc, a turn's record. */
export function keyedItemId(part: "premise" | "arc" | "record", key: string): string {
  return part === "premise" ? PREFIX.premise : `${PREFIX[part]}:${nameKey(key)}`;
}

/**
 * Records `writes` on the writer's turn, in order, inside the caller's queued write: the rows as
 * stored, a new item's id given from its first row. Each takes the place after the turn's last write,
 * the lore's overlays among them (`storyMark`). A turn joined to another is refused first, with the
 * typed error naming the turn it joined (`refuseJoined`).
 */
export function writeStory(db: Database, writer: StoryWriter, writes: readonly StoryWrite[]): StoryRow[] {
  refuseJoined(db, writer.user, writer.turn);
  let ord = storyMark(db, writer.user, writer.turn) + 1;
  const put = db.query<unknown, [string, string, number, string, string, string, string | null, string | null, string | null, number]>(
    "INSERT INTO story_entry (user, turn, ord, part, item, value, by, agent, job, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const name = db.query<unknown, [string, number]>("UPDATE story_entry SET item = ? WHERE id = ?");
  return writes.map((w) => {
    const id = Number(put.run(writer.user, writer.turn, ord, w.part, w.item ?? "", JSON.stringify(w.value), writer.by, writer.agent, writer.job, writer.now).lastInsertRowid);
    const item = w.item ?? newItemId(w.part, id);
    if (w.item === null) name.run(item, id);
    return { id, turn: writer.turn, ord: ord++, part: w.part, item, value: w.value, by: writer.by, agent: writer.agent, job: writer.job, created: writer.now };
  });
}

/**
 * Takes back one agent's story rows on an open turn (every agent's when none is named), by the
 * agent's handle, inside the caller's queued write, beside the store's `dropStaged`: the lead
 * dropping a sub-agent's writes. The overlays it wrote through the story's write go with them. How
 * many went. A turn that is not open has nothing staged, and is refused as the store refuses it: one
 * joined to another turn with the typed error naming the turn it joined.
 */
export function dropStoryStaged(store: Store, user: string, turn: string, agent?: string): number {
  refuseJoined(store.db, user, turn);
  const row = store.user(user).turn(turn);
  if (row === null) throw new StoreInputError(`turn ${turn} is not there`);
  if (row.status !== "open") throw new StoreInputError(`turn ${turn} is ${row.status}: only an open turn's staged story rows can be taken back`);
  let gone = 0;
  for (const table of ["story_entry", "lore_overlay"]) gone += (agent === undefined ? store.db.run(`DELETE FROM ${table} WHERE user = ? AND turn = ?`, [user, turn]) : store.db.run(`DELETE FROM ${table} WHERE user = ? AND turn = ? AND agent = ?`, [user, turn, agent])).changes;
  return gone;
}

/**
 * The story's mark on a turn now: the place of its last write, -1 when it has none. A continue takes
 * it as it begins, beside the store's mark. The lore's overlays are written through the story's own
 * write and take their places among its rows, so the mark covers them too.
 */
export function storyMark(db: Database, user: string, turn: string): number {
  return db.query<{ n: number | null }, [string, string]>("SELECT max(n) AS n FROM (SELECT max(ord) AS n FROM story_entry WHERE user = ?1 AND turn = ?2 UNION ALL SELECT max(ord) FROM lore_overlay WHERE user = ?1 AND turn = ?2)").get(user, turn)?.n ?? -1;
}

/**
 * Takes back a turn's story rows and overlays written after `after` (a `storyMark`), tied or not,
 * inside the caller's queued write, beside the store's `takeBack`: what a continue recorded when it
 * saved nothing. A job's are the job's and stay, as the store keeps a job's changes. How many went. A
 * turn joined to another is refused first, naming the turn it joined.
 */
export function takeBackStory(db: Database, user: string, turn: string, after: number): number {
  refuseJoined(db, user, turn);
  let gone = 0;
  for (const table of ["story_entry", "lore_overlay"]) gone += db.run(`DELETE FROM ${table} WHERE user = ? AND turn = ? AND ord > ? AND job IS NULL`, [user, turn, after]).changes;
  return gone;
}

/**
 * A continue's held turn's story rows and the lore's overlays become the rows of the turn it extended (plan §10.10, "Continue:
 * the same turn, extended"; R-192 (e), (f)), inside the caller's queued write, before the store's `joinTurn` there, which marks
 * the held turn joined: every row of the held turn, a job's included, takes `into`, after that turn's own writes, in the order
 * they were made (their places, `storyMark`, the overlays among the story's rows), each as it was written (its id, value, writer,
 * agent, job and time), nothing worked out again. A job's rows keep their job: a job is recorded with the turn that started it
 * (§10.9), and after the end that is the turn the continue extended. What may be joined is the store's one check (`joinable`),
 * refused as the store refuses the join. How many moved.
 */
export function joinStory(store: Store, user: string, held: string, into: string): number {
  joinable(store.db, user, held, into);
  const next = storyMark(store.db, user, into) + 1;
  // The overlays share the story rows' places on a turn, so both tables are taken in one order.
  const rows = store.db
    .query<{ overlay: 0 | 1; id: number }, [string, string]>(
      "SELECT 0 AS overlay, id, ord, created FROM story_entry WHERE user = ?1 AND turn = ?2 UNION ALL SELECT 1, id, ord, created FROM lore_overlay WHERE user = ?1 AND turn = ?2 ORDER BY ord, created, overlay, id",
    )
    .all(user, held);
  const put = [store.db.query<unknown, [string, number, number]>("UPDATE story_entry SET turn = ?, ord = ? WHERE id = ?"), store.db.query<unknown, [string, number, number]>("UPDATE lore_overlay SET turn = ?, ord = ? WHERE id = ?")] as const;
  rows.forEach((r, i) => put[r.overlay].run(into, next + i, r.id));
  return rows.length;
}

/**
 * Removes the story rows of turns the store no longer holds, inside the caller's queued write, right
 * after the store removed them: a chat deleted (`UserStore.deleteChat` when it is not kept for a
 * branch), or an import forgotten (`UserStore.forgetImport`). Rows of a turn a branch still shares
 * stay with the turn. How many went.
 */
export function dropLeftoverStory(store: Store, user: string): number {
  const u = store.user(user);
  const turns = store.db.query<{ turn: string }, [string]>("SELECT DISTINCT turn FROM story_entry WHERE user = ?").all(user);
  const gone = turns.flatMap((r) => (u.turn(r.turn) === null ? [r.turn] : []));
  if (gone.length === 0) return 0;
  return store.db.run("DELETE FROM story_entry WHERE user = ? AND turn IN (SELECT value FROM json_each(?))", [user, JSON.stringify(gone)]).changes;
}
