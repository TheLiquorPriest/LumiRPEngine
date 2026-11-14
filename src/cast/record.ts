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
// as it stands is its rows on the reading's path, merged in order, and its history is those rows.
// Code merges and keeps; it never judges what a row says, and keeps everything for every casting.

import type { Database } from "bun:sqlite";
import type { JsonObject } from "rp-harness/contract";
import { type Store, StoreInputError, type UserStore } from "../store";
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

  constructor(readonly at: CastAt) {}

  /** The record at `at`: the rows of the turns on its path, in the path's order. */
  static read(db: Database, user: string, at: CastAt): CastRecord {
    const rows = db
      .query<RowDb, [string, string]>("SELECT * FROM cast_entry WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2))")
      .all(user, JSON.stringify(at.turns))
      .sort((a, b) => (at.order.get(a.turn) ?? 0) - (at.order.get(b.turn) ?? 0) || a.ord - b.ord);
    const record = new CastRecord(at);
    for (const r of rows) record.apply({ ...r, part: r.part as RowPart, value: JSON.parse(r.value) as JsonObject });
    return record;
  }

  /** Merges one write in. */
  apply(row: CastRow): CastItem {
    let item = this.items.get(row.item);
    if (item === undefined) {
      item = { part: row.part, id: row.item, character: row.character, fields: {}, opened: row.turn, touched: row.turn, at: row.at, dropped: false, rows: [] };
      this.items.set(row.item, item);
    }
    for (const [key, value] of Object.entries(row.value)) {
      if (key === "drop") item.dropped = value === true;
      else item.fields[key] = value;
    }
    item.touched = row.turn;
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
 * many went. A turn that is not open has nothing staged, and is refused as the store refuses it.
 */
export function dropCastStaged(store: Store, user: string, turn: string, agent?: string): number {
  const row = store.user(user).turn(turn);
  if (row === null) throw new StoreInputError(`turn ${turn} is not there`);
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
