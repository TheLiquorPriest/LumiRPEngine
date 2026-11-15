// A character's record (plan §7.1), part by part.
//
// Outside turns: the character (its name, and the casting the player pinned), its sources as
// bindings (which card, persona, lore entry or Lumiverse memory entity defines which side of them;
// the text stays in Lumiverse and is read live by whoever asks), and its base as versioned documents
// (Seed, Soul, Inner Voice, Background), each version keeping the revision of every source it was
// drawn against, so that a source changed since shows. A swipe changes none of these.
//
// Tied to turns, the way the story record is: casting, growth, mind, relationships, knowledge and
// history. Every write is a row of the item it touches, holding only what that write said; an item
// as it stands is its rows on the reading's path, merged in order, and its history is those rows. A
// job's rows are recorded with the turn that started it and take effect where the store places the
// job's changes (plan §10.9): after its end, just before the next turn to begin, a field a turn has
// written since keeping that turn's value; the job reads its own at once. Code merges and keeps; it
// never judges what a row says, and keeps everything for every casting.

import type { Database } from "bun:sqlite";
import type { JsonObject } from "rp-harness/contract";
import { JoinedTurnError, type Store, StoreInputError, type UserStore } from "../store";
import type { CastAt } from "./path";

/** How large a part a character plays (§7.2). What each has is the casting skill's to say. */
export const CASTINGS = ["principal", "supporting", "extra"] as const;
export type Casting = (typeof CASTINGS)[number];

/** What a source binding points at: the Lumiverse character card, a persona, a lore entry (by its id in the lore map), the character's entity in Lumiverse's memory. */
export const SOURCE_KINDS = ["card", "persona", "entry", "memory"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** The base's four documents, as the casting skill names them. */
export const BASE_PARTS = ["seed", "soul", "inner_voice", "background"] as const;
export type BasePart = (typeof BASE_PARTS)[number];

/** The parts kept as rows tied to turns. */
export const ROW_PARTS = ["casting", "growth", "mind", "relationship", "knowledge", "history", "perception", "memory"] as const;
export type RowPart = (typeof ROW_PARTS)[number];

/** What a mind row holds, by kind, as the plan names them (§7.1): attention, feeling, beliefs, wants, plans, what they hide. */
export const MIND_KINDS = ["attention", "feeling", "belief", "want", "plan", "hiding"] as const;

/** The few dimensions a relationship may carry (§7.1). */
export const RELATIONSHIP_DIMENSIONS = ["trust", "warmth", "respect", "fear"] as const;

/** What an item's id starts with, for the parts that hold many items per character. */
const PREFIX: Readonly<Record<"growth" | "mind" | "knowledge" | "history" | "perception" | "memory", string>> = { growth: "g", mind: "m", knowledge: "k", history: "h", perception: "p", memory: "mem" };

/** A name as the cast compares names: trimmed, spaces folded, case ignored (the story record's rule). */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- characters

export interface Character {
  id: string;
  /** The chat it was first cast in. A branch of that chat knows it too. */
  chat: string;
  name: string;
  /** The casting the player pinned; it stands over the Author's. */
  pinned: Casting | null;
  created: number;
}

interface CharacterDb {
  id: string;
  chat: string;
  name: string;
  pinned: string | null;
  created: number;
}

/** The chats whose characters `chat` knows: itself, then each chat it was branched from, nearest first. */
export function chatLine(user: UserStore, chat: string): string[] {
  const out: string[] = [];
  let at: string | null = chat;
  while (at !== null && !out.includes(at)) {
    out.push(at);
    at = user.chat(at)?.sourceChat ?? null;
  }
  return out;
}

/** Every character the chats know, in the order they were made. */
export function charactersOf(db: Database, user: string, chats: readonly string[]): Character[] {
  return db
    .query<CharacterDb, [string, string]>("SELECT id, chat, name, pinned, created FROM cast_character WHERE user = ?1 AND chat IN (SELECT value FROM json_each(?2)) ORDER BY n")
    .all(user, JSON.stringify(chats))
    .map((r) => ({ id: r.id, chat: r.chat, name: r.name, pinned: r.pinned as Casting | null, created: r.created }));
}

/** The character `said` names, by id or by name, the nearest chat's first; null when none. */
export function findCharacter(db: Database, user: string, chats: readonly string[], said: string): Character | null {
  const key = nameKey(said);
  const all = charactersOf(db, user, chats);
  const byId = all.find((c) => c.id === said.trim());
  if (byId !== undefined) return byId;
  const named = all.filter((c) => nameKey(c.name) === key);
  named.sort((a, b) => chats.indexOf(a.chat) - chats.indexOf(b.chat));
  return named[0] ?? null;
}

/** A new character of `chat`, inside the caller's write. Its id is given from its row. */
export function addCharacter(db: Database, user: string, chat: string, name: string, now: number): Character {
  const n = Number(
    db.query<unknown, [string, string, string, string, string, number]>("INSERT INTO cast_character (user, id, chat, name, name_key, created) VALUES (?, ?, ?, ?, ?, ?)").run(user, `new:${crypto.randomUUID()}`, chat, name.trim(), nameKey(name), now).lastInsertRowid,
  );
  const id = `c-${n}`;
  db.run("UPDATE cast_character SET id = ? WHERE n = ?", [id, n]);
  return { id, chat, name: name.trim(), pinned: null, created: now };
}

/** The player pins a casting (null takes the pin away), inside the caller's write. It stands over whatever the Author casts. */
export function pinCasting(db: Database, user: string, character: string, casting: Casting | null): void {
  db.run("UPDATE cast_character SET pinned = ? WHERE user = ? AND id = ?", [casting, user, character]);
}

/** A character given another name, inside the caller's write: the migration names a person as the world now names it. The caller keeps the name free in the character's chat. */
export function renameCharacter(db: Database, user: string, character: string, name: string): void {
  db.run("UPDATE cast_character SET name = ?, name_key = ? WHERE user = ? AND id = ?", [name.trim(), nameKey(name), user, character]);
}

// ---------------------------------------------------------------- sources

export interface Binding {
  kind: SourceKind;
  /** Its id where it is kept: Lumiverse's for a card, a persona or a memory entity; the lore map's for an entry. */
  ref: string;
  /** Which side of the character it defines, in the binder's words (background, appearance, voice). */
  defines: string | null;
  created: number;
}

/** A source's key in a base version's `seen`. */
export const sourceKey = (kind: SourceKind, ref: string): string => `${kind}:${ref}`;

export function bindingsOf(db: Database, user: string, character: string): Binding[] {
  return db
    .query<{ kind: string; ref: string; defines: string | null; created: number }, [string, string]>("SELECT kind, ref, defines, created FROM cast_binding WHERE user = ? AND character = ? ORDER BY created, rowid")
    .all(user, character)
    .map((r) => ({ kind: r.kind as SourceKind, ref: r.ref, defines: r.defines, created: r.created }));
}

/** Binds a source, or says again which side it defines, inside the caller's write. */
export function bindSource(db: Database, user: string, character: string, b: Omit<Binding, "created">, now: number): void {
  db.run("INSERT INTO cast_binding (user, character, kind, ref, defines, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user, character, kind, ref) DO UPDATE SET defines = excluded.defines", [
    user,
    character,
    b.kind,
    b.ref,
    b.defines,
    now,
  ]);
}

/** Takes a binding away, inside the caller's write; whether there was one. */
export function unbindSource(db: Database, user: string, character: string, kind: SourceKind, ref: string): boolean {
  return db.run("DELETE FROM cast_binding WHERE user = ? AND character = ? AND kind = ? AND ref = ?", [user, character, kind, ref]).changes > 0;
}

// ---------------------------------------------------------------- the base

export interface BaseVersion {
  part: BasePart;
  version: number;
  text: string;
  /** Each bound source's revision when this version was written, by `sourceKey`. */
  seen: Record<string, string>;
  /** The turn it was written in; null when written outside one (the player's edit). */
  turn: string | null;
  by: string | null;
  agent: string | null;
  created: number;
}

interface DocDb {
  id: number;
  part: string;
  version: number;
  text: string;
  seen: string;
  turn: string | null;
  by: string | null;
  agent: string | null;
  created: number;
}

/** Every version of a character's base, oldest first. */
export function baseHistory(db: Database, user: string, character: string): BaseVersion[] {
  return db
    .query<DocDb, [string, string]>("SELECT * FROM cast_doc WHERE user = ? AND character = ? ORDER BY id")
    .all(user, character)
    .map((r) => ({ part: r.part as BasePart, version: r.version, text: r.text, seen: JSON.parse(r.seen) as Record<string, string>, turn: r.turn, by: r.by, agent: r.agent, created: r.created }));
}

/** A character's base as it stands: the newest version of each part written. */
export function baseOf(db: Database, user: string, character: string): Map<BasePart, BaseVersion> {
  const out = new Map<BasePart, BaseVersion>();
  for (const v of baseHistory(db, user, character)) out.set(v.part, v);
  return out;
}

/** For each source the base has been drawn against, the revision it was last drawn against: the one the newest version that saw it recorded. */
export function drawnAgainst(base: Iterable<BaseVersion>): Map<string, string> {
  const newestFirst = [...base].sort((a, b) => b.created - a.created || b.version - a.version);
  const out = new Map<string, string>();
  for (const v of newestFirst) for (const [key, revision] of Object.entries(v.seen)) if (!out.has(key)) out.set(key, revision);
  return out;
}

/** Who writes, on which turn (null: outside one), and when (milliseconds). */
export interface BaseWriter {
  user: string;
  turn: string | null;
  by: string | null;
  agent: string | null;
  now: number;
}

/** Adds a version of each part given, inside the caller's write; `seen` is the sources' revisions as read just before. */
export function writeBase(db: Database, writer: BaseWriter, character: string, texts: Partial<Record<BasePart, string>>, seen: Record<string, string>): BaseVersion[] {
  const next = db.query<{ n: number | null }, [string, string, string]>("SELECT max(version) AS n FROM cast_doc WHERE user = ? AND character = ? AND part = ?");
  const put = db.query<unknown, [string, string, string, number, string, string, string | null, string | null, string | null, number]>(
    "INSERT INTO cast_doc (user, character, part, version, text, seen, turn, by, agent, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const out: BaseVersion[] = [];
  for (const part of BASE_PARTS) {
    const text = texts[part];
    if (text === undefined) continue;
    const version = (next.get(writer.user, character, part)?.n ?? 0) + 1;
    put.run(writer.user, character, part, version, text, JSON.stringify(seen), writer.turn, writer.by, writer.agent, writer.now);
    out.push({ part, version, text, seen, turn: writer.turn, by: writer.by, agent: writer.agent, created: writer.now });
  }
  return out;
}

// ---------------------------------------------------------------- rows tied to turns

/** One write of an item, as stored. */
export interface CastRow {
  id: number;
  turn: string;
  ord: number;
  character: string;
  part: RowPart;
  item: string;
  /** What this write said: the fields it set, `drop` among them. */
  value: JsonObject;
  /** Story time when it was written, in minutes since the world's epoch; null in a chat that keeps no clock. */
  at: number | null;
  /** The agent's definition that wrote it, or the player. */
  by: string | null;
  agent: string | null;
  job: string | null;
  created: number;
}

/** An item as it stands on a path. */
export interface CastItem {
  part: RowPart;
  id: string;
  character: string;
  /** Every field its writes set, the latest of each. */
  fields: JsonObject;
  /** The turn that first wrote it, and the one that wrote it last. */
  opened: string;
  touched: string;
  /** Story time of its first write: its date. */
  at: number | null;
  dropped: boolean;
  /** Its writes on the path, oldest first. */
  rows: CastRow[];
}

interface RowDb {
  id: number;
  turn: string;
  ord: number;
  character: string;
  part: string;
  item: string;
  value: string;
  at: number | null;
  by: string | null;
  agent: string | null;
  job: string | null;
  created: number;
  /** When the store recorded the end of the job that wrote it (`job_end`); null for a turn's own row, or a job's not ended. */
  ended: number | null;
}

/** A row of a reading, where it takes effect. */
interface Placed {
  row: CastRow;
  /** The place on the path of the turn it takes effect at: its own turn's, or for a job's, the turn it is placed just before. */
  at: number;
  /** For a job's row placed after the turn that started the job: that turn's place; null for a row read where it was written. */
  from: number | null;
}

/**
 * The rows of a reading in the order they take effect. A turn's own rows, and those of the job the
 * reading is made in (`own`), are read where they were written. Any other job's are recorded with the
 * turn that started it and take effect where the store places its changes (plan §10.9,
 * `UserStore.jobsPlaced`): once the store has recorded the job's end, just before the first turn on
 * the path after that one to have begun after the end, in the order they were written; until then,
 * or on a path with no such turn, they are not read.
 */
function placedRows(db: Database, user: string, at: CastAt, rows: readonly RowDb[], own: string | null): Placed[] {
  let began: Map<string, number> | undefined;
  const places = new Map<string, number>();
  const out: Placed[] = [];
  for (const { ended, ...r } of rows) {
    const row: CastRow = { ...r, part: r.part as RowPart, value: JSON.parse(r.value) as JsonObject };
    const from = at.order.get(r.turn) ?? 0;
    if (r.job === null || r.job === own) {
      out.push({ row, at: from, from: null });
      continue;
    }
    if (ended === null) continue;
    const key = `${r.job}\u0000${r.turn}`;
    let place = places.get(key);
    if (place === undefined) {
      const times = (began ??= new Map(
        db
          .query<{ id: string; created: number }, [string, string]>("SELECT id, created FROM turn WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2))")
          .all(user, JSON.stringify(at.turns))
          .map((t) => [t.id, t.created]),
      ));
      place = at.turns.findIndex((t, i) => i > from && (times.get(t) ?? Number.NEGATIVE_INFINITY) > ended);
      places.set(key, place);
    }
    if (place >= 0) out.push({ row, at: place, from });
  }
  // At one place a job's rows come first, in the order they were written, then the turn's own, in its order.
  return out.sort((a, b) => a.at - b.at || (a.from === null ? 1 : 0) - (b.from === null ? 1 : 0) || (a.from === null ? a.row.ord - b.row.ord : a.row.id - b.row.id));
}

/** The id of the one casting item a character has. */
export const castingItemId = (character: string): string => `casting:${character}`;

/** The id of the one relationship item a character has toward a person. */
export const relationshipItemId = (character: string, toward: string): string => `rel:${character}:${nameKey(toward)}`;

/** The id a new item of `part` is given from its first row's id. */
export function newItemId(part: keyof typeof PREFIX, row: number): string {
  return `${PREFIX[part]}-${row}`;
}

/** The rows of the cast as one reading sees them. */
export class CastRecord {
  readonly items = new Map<string, CastItem>();
  /** For each item, the place on the path of the turn whose write each of its fields (`drop` among them) last took. */
  readonly #marks = new Map<string, Map<string, number>>();

  constructor(readonly at: CastAt) {}

  /** The record at `at`: the rows of the turns on its path, in the order they take effect there (`placedRows`); `job`, the job the reading is made in, reads its own at once. */
  static read(db: Database, user: string, at: CastAt, job: string | null = null): CastRecord {
    const rows = db
      .query<RowDb, [string, string]>("SELECT r.*, e.ended FROM cast_entry r LEFT JOIN job_end e ON e.user = r.user AND e.job = r.job WHERE r.user = ?1 AND r.turn IN (SELECT value FROM json_each(?2))")
      .all(user, JSON.stringify(at.turns));
    const record = new CastRecord(at);
    for (const p of placedRows(db, user, at, rows, job)) record.apply(p.row, p.from);
    return record;
  }

  /**
   * Merges one write in. `from` is set for a job's write placed after turns since the job's own (the
   * place of the turn that started it): a field one of those turns wrote keeps that turn's value, as
   * the store keeps a later turn's value over a job's, and the item stays touched by the later turn.
   */
  apply(row: CastRow, from: number | null = null): CastItem {
    let item = this.items.get(row.item);
    if (item === undefined) {
      item = { part: row.part, id: row.item, character: row.character, fields: {}, opened: row.turn, touched: row.turn, at: row.at, dropped: false, rows: [] };
      this.items.set(row.item, item);
    }
    let marks = this.#marks.get(row.item);
    if (marks === undefined) {
      marks = new Map();
      this.#marks.set(row.item, marks);
    }
    const place = from ?? this.at.order.get(row.turn) ?? 0;
    for (const [key, value] of Object.entries(row.value)) {
      if (from !== null && (marks.get(key) ?? Number.NEGATIVE_INFINITY) > from) continue;
      marks.set(key, place);
      if (key === "drop") item.dropped = value === true;
      else item.fields[key] = value;
    }
    if (place >= (this.at.order.get(item.touched) ?? Number.NEGATIVE_INFINITY)) item.touched = row.turn;
    item.rows.push(row);
    return item;
  }

  /** A character's items of a part, in the order they were first written; those dropped only when asked. */
  of(character: string, part: RowPart, dropped = false): CastItem[] {
    return [...this.items.values()].filter((i) => i.character === character && i.part === part && (dropped || !i.dropped));
  }

  /** The casting the turns on this path gave a character, with its line; null when none did. */
  castingOf(character: string): { as: Casting; line: string | null } | null {
    const item = this.items.get(castingItemId(character));
    const as = item?.fields.as;
    if (item === undefined || typeof as !== "string" || !(CASTINGS as readonly string[]).includes(as)) return null;
    return { as: as as Casting, line: typeof item.fields.line === "string" ? item.fields.line : null };
  }
}

/** The casting in force for a character on a reading: the player's pin, else the Author's on the path; null when it is in neither. */
export function castingInForce(record: CastRecord, character: Character): { as: Casting; pinned: boolean; line: string | null } | null {
  const cast = record.castingOf(character.id);
  if (character.pinned !== null) return { as: character.pinned, pinned: true, line: cast?.line ?? null };
  return cast === null ? null : { ...cast, pinned: false };
}

/** A member of the cast on a reading: a character with a casting in force there. */
export interface Member {
  character: Character;
  as: Casting;
  pinned: boolean;
  line: string | null;
}

/** The cast on a reading: each of `characters` that has a casting in force there, in the order given. */
export function castOn(record: CastRecord, characters: readonly Character[]): Member[] {
  return characters.flatMap((character) => {
    const casting = castingInForce(record, character);
    return casting === null ? [] : [{ character, ...casting }];
  });
}

/** One write a call asks for: of an item already there (`item`), or of a new one (`item` null). */
export interface CastWrite {
  character: string;
  part: RowPart;
  item: string | null;
  value: JsonObject;
}

/** Who writes, on which turn, at what story time, and when. */
export interface CastWriter {
  user: string;
  turn: string;
  by: string | null;
  agent: string | null;
  job: string | null;
  /** Story time at the turn, minutes since the world's epoch; null in a chat that keeps no clock. */
  at: number | null;
  now: number;
}

/**
 * Records `writes` on the writer's turn, in order, inside the caller's queued write: the rows as
 * stored, a new item's id given from its first row.
 */
export function writeCast(db: Database, writer: CastWriter, writes: readonly CastWrite[]): CastRow[] {
  let ord = (db.query<{ n: number | null }, [string, string]>("SELECT max(ord) AS n FROM cast_entry WHERE user = ? AND turn = ?").get(writer.user, writer.turn)?.n ?? -1) + 1;
  const put = db.query<unknown, [string, string, number, string, string, string, string, number | null, string | null, string | null, string | null, number]>(
    "INSERT INTO cast_entry (user, turn, ord, character, part, item, value, at, by, agent, job, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const name = db.query<unknown, [string, number]>("UPDATE cast_entry SET item = ? WHERE id = ?");
  return writes.map((w) => {
    const id = Number(put.run(writer.user, writer.turn, ord, w.character, w.part, w.item ?? "", JSON.stringify(w.value), writer.at, writer.by, writer.agent, writer.job, writer.now).lastInsertRowid);
    let item = w.item;
    if (item === null) {
      if (!(w.part in PREFIX)) throw new Error(`a ${w.part} item is named by its key, never made new`);
      item = newItemId(w.part as keyof typeof PREFIX, id);
      name.run(item, id);
    }
    return { id, turn: writer.turn, ord: ord++, character: w.character, part: w.part, item, value: w.value, at: writer.at, by: writer.by, agent: writer.agent, job: writer.job, created: writer.now };
  });
}

/**
 * Takes back one agent's cast rows on an open turn (every agent's when none is named), inside the
 * caller's queued write, beside the store's `dropStaged`: the lead dropping a sub-agent's writes. How
 * many went. A turn that is not open has nothing staged, and is refused as the store refuses it: one
 * joined to another turn with the typed error naming the turn it joined.
 */
export function dropCastStaged(store: Store, user: string, turn: string, agent?: string): number {
  const row = store.user(user).turn(turn);
  if (row === null) throw new StoreInputError(`turn ${turn} is not there`);
  if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
  if (row.status !== "open") throw new StoreInputError(`turn ${turn} is ${row.status}: only an open turn's staged cast rows can be taken back`);
  const gone = agent === undefined ? store.db.run("DELETE FROM cast_entry WHERE user = ? AND turn = ?", [user, turn]) : store.db.run("DELETE FROM cast_entry WHERE user = ? AND turn = ? AND agent = ?", [user, turn, agent]);
  return gone.changes;
}

/** The cast's mark on a turn now: the place of its last row, -1 when it has none. A continue takes it as it begins, beside the store's mark. */
export function castMark(db: Database, user: string, turn: string): number {
  return db.query<{ n: number | null }, [string, string]>("SELECT max(ord) AS n FROM cast_entry WHERE user = ? AND turn = ?").get(user, turn)?.n ?? -1;
}

/**
 * Takes back a turn's cast rows written after `after` (a `castMark`), tied or not, inside the
 * caller's queued write, beside the store's `takeBack`: what a continue wrote when it saved nothing.
 * A job's rows are the job's and stay, as the store keeps a job's changes. How many went.
 */
export function takeBackCast(db: Database, user: string, turn: string, after: number): number {
  return db.run("DELETE FROM cast_entry WHERE user = ? AND turn = ? AND ord > ? AND job IS NULL", [user, turn, after]).changes;
}

/**
 * A continue's held turn's cast rows become the rows of the turn it extended (plan §10.10, "Continue: the same turn, extended";
 * R-192 (e), (f)), inside the caller's queued write, before the store's `joinTurn` there, which marks the held turn joined: every
 * row of the held turn, a job's included, takes `into`, after that turn's own rows, in the order the rows were made, each as it was
 * written (its id, value, writer, agent, job and time), nothing worked out again. A job's rows keep their job: a job is recorded
 * with the turn that started it (§10.9), and after the end that is the turn the continue extended. Refused as the store refuses the
 * join: a held turn that is not open, a turn that is not tied, turns of different chats, a turn joined already. How many moved.
 */
export function joinCast(store: Store, user: string, held: string, into: string): number {
  const u = store.user(user);
  const from = u.turn(held);
  const to = u.turn(into);
  if (from === null) throw new StoreInputError(`turn ${held} is not there`);
  if (to === null) throw new StoreInputError(`turn ${into} is not there`);
  if (from.joined !== null) throw new JoinedTurnError(held, from.joined);
  if (to.joined !== null) throw new JoinedTurnError(into, to.joined);
  if (from.status !== "open") throw new StoreInputError(`turn ${held} is ${from.status}: only a continue's open turn's cast rows join another turn`);
  if (to.status !== "done" && to.status !== "cut") throw new StoreInputError(`turn ${into} is ${to.status}: a continue's cast rows join the turn tied to the message it extended`);
  if (from.chat !== to.chat) throw new StoreInputError(`turn ${held} is chat ${from.chat}'s and turn ${into} is chat ${to.chat}'s: a continue extends a turn of its own chat`);
  const next = castMark(store.db, user, into) + 1;
  const rows = store.db.query<{ id: number }, [string, string]>("SELECT id FROM cast_entry WHERE user = ? AND turn = ? ORDER BY ord, id").all(user, held);
  const put = store.db.query<unknown, [string, number, number]>("UPDATE cast_entry SET turn = ?, ord = ? WHERE id = ?");
  rows.forEach((r, i) => put.run(into, next + i, r.id));
  return rows.length;
}

/**
 * Removes the cast rows of turns the store no longer holds, inside the caller's queued write, right
 * after the store removed them: a chat deleted (`UserStore.deleteChat` when it is not kept for a
 * branch), or an import forgotten (`UserStore.forgetImport`). Rows of a turn a branch still shares
 * stay with the turn. The characters, their bindings and their base stand outside turns and stay.
 * How many went.
 */
export function dropLeftoverCast(store: Store, user: string): number {
  const u = store.user(user);
  const turns = store.db.query<{ turn: string }, [string]>("SELECT DISTINCT turn FROM cast_entry WHERE user = ?").all(user);
  const gone = turns.flatMap((r) => (u.turn(r.turn) === null ? [r.turn] : []));
  if (gone.length === 0) return 0;
  return store.db.run("DELETE FROM cast_entry WHERE user = ? AND turn IN (SELECT value FROM json_each(?))", [user, JSON.stringify(gone)]).changes;
}
