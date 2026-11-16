// A character's record (plan §7.1), part by part.
//
// Outside turns: the character (its name, and the casting the player pinned), its sources as
// bindings (which card, persona, lore entry or Lumiverse memory entity defines which side of them;
// the text stays in Lumiverse and is read live by whoever asks), and its base as versioned documents
// (Seed, Soul, Inner Voice, Background), each version keeping the revision of every source it was
// drawn against, so that a source changed since shows. A swipe changes none of these. The text of a
// migrated character's old mind files is attached to it the same way, each version as it was, on the
// turn that held it.
//
// Tied to turns, as changes of the store like everything else in the story (`fold.ts`): casting,
// growth, mind, memories, relationships, knowledge, perceptions and history. Every write is a change
// of the item it touches, holding only what that write said; an item as it stands is its writes at
// the reading's point, merged in the order they take effect, and its history is those writes. A
// job's are recorded with the turn that started it and take effect where the store places a job's
// changes (plan §10.9). Code merges and keeps; it never judges what a write says, and keeps
// everything for every casting.

import type { Database } from "bun:sqlite";
import type { JsonObject } from "rp-harness/contract";
import type { ChangeInput, Source, Store, UserStore } from "../store";
import { CAST_WRITE, type CastSlice, fieldsOf, type RowPart, ROW_PARTS, type RowState, sliceOf, type WriteValue } from "./fold";
import type { CastAt } from "./path";

export { ROW_PARTS, type RowPart };

/** How large a part a character plays (§7.2). What each has is the casting skill's to say. */
export const CASTINGS = ["principal", "supporting", "extra"] as const;
export type Casting = (typeof CASTINGS)[number];

/** What a source binding points at: the Lumiverse character card, a persona, a lore entry (by its id in the lore map), the character's entity in Lumiverse's memory. */
export const SOURCE_KINDS = ["card", "persona", "entry", "memory"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** The base's four documents, as the casting skill names them. */
export const BASE_PARTS = ["seed", "soul", "inner_voice", "background"] as const;
export type BasePart = (typeof BASE_PARTS)[number];

/** What a mind row holds, by kind, as the plan names them (§7.1): attention, feeling, beliefs, wants, plans, what they hide. */
export const MIND_KINDS = ["attention", "feeling", "belief", "want", "plan", "hiding"] as const;

/** The few dimensions a relationship may carry (§7.1). */
export const RELATIONSHIP_DIMENSIONS = ["trust", "warmth", "respect", "fear"] as const;

/** What an item's id starts with, for the parts that hold many items per character. */
const PREFIX: Readonly<Record<"growth" | "mind" | "knowledge" | "history" | "perception" | "memory" | "edit", string>> = { growth: "g", mind: "m", knowledge: "k", history: "h", perception: "p", memory: "mem", edit: "ed" };

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
  /** The world's person it is, by the entity's id: set at casting, by the migration, or by the owner; the game side and the holdings find the person by it. Null where none is known. */
  person: string | null;
  created: number;
}

interface CharacterDb {
  id: string;
  chat: string;
  name: string;
  pinned: string | null;
  person: string | null;
  created: number;
}

/**
 * The chats whose rows the reading `?2` sees, each with the moment up to which it sees them (`cut`): its own chat to the end, a chat it
 * was branched from up to the moment the branch below it was made (a branch shares what came before it, plan §6.3 and §10.10; what is
 * written after, in either chat, is that chat's own). `?1` is the user. Used inside `WITH RECURSIVE`.
 */
const SEEN = `line(id, src, cut, depth) AS (
  SELECT ?2, (SELECT source_chat FROM chat WHERE user = ?1 AND id = ?2), ${Number.MAX_SAFE_INTEGER}, 0
  UNION ALL
  SELECT c.id, c.source_chat, min(l.cut, (SELECT created FROM chat WHERE user = ?1 AND id = l.id)), l.depth + 1
  FROM line l JOIN chat c ON c.user = ?1 AND c.id = l.src
  WHERE l.depth < 64
)`;

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

/**
 * Every character the chats know, in the order they were made, with the casting the player pinned as the first of `chats` (the chat
 * read) sees it: its own pin, or a source chat's up to the moment it was branched.
 */
export function charactersOf(db: Database, user: string, chats: readonly string[]): Character[] {
  return db
    .query<CharacterDb, [string, string, string]>(
      `WITH RECURSIVE ${SEEN}
SELECT c.id, c.chat, c.name, c.person, c.created,
  (SELECT p.casting FROM character_pin p WHERE p.user = c.user AND p.character = c.id AND EXISTS (SELECT 1 FROM line l WHERE l.id = p.chat AND p.created <= l.cut) ORDER BY p.n DESC LIMIT 1) AS pinned
FROM character c WHERE c.user = ?1 AND c.chat IN (SELECT value FROM json_each(?3)) ORDER BY c.n`,
    )
    .all(user, chats[0] ?? "", JSON.stringify(chats))
    .map((r) => ({ id: r.id, chat: r.chat, name: r.name, pinned: r.pinned as Casting | null, person: r.person, created: r.created }));
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

/** A new character of `chat`, inside the caller's write. Its id is given from its row. `person` is the world's person it is, where that is known. */
export function addCharacter(db: Database, user: string, chat: string, name: string, now: number, person: string | null = null): Character {
  const n = Number(
    db.query<unknown, [string, string, string, string, string, number, string | null]>("INSERT INTO character (user, id, chat, name, name_key, created, person) VALUES (?, ?, ?, ?, ?, ?, ?)").run(user, `new:${crypto.randomUUID()}`, chat, name.trim(), nameKey(name), now, person).lastInsertRowid,
  );
  const id = `c-${n}`;
  db.run("UPDATE character SET id = ? WHERE n = ?", [id, n]);
  return { id, chat, name: name.trim(), pinned: null, person, created: now };
}

/** The world's person a character is, by its entity's id (null takes the reference away), inside the caller's write. */
export function setPerson(db: Database, user: string, character: string, person: string | null): void {
  db.run("UPDATE character SET person = ? WHERE user = ? AND id = ?", [person, user, character]);
}

/**
 * The player pins a casting (null takes the pin away), inside the caller's write. It stands over whatever the Author casts, in the
 * chat he pinned it in, and in a chat branched from that one after, but not in the chat it was branched from, whose pin stays as it was.
 * `where` is that chat and the moment; none (the migration's pins, as each chat showed them) is the character's own chat, from the start.
 */
export function pinCasting(db: Database, user: string, character: string, casting: Casting | null, where: { chat: string; now: number } | null = null): void {
  const chat = where?.chat ?? db.query<{ chat: string }, [string, string]>("SELECT chat FROM character WHERE user = ? AND id = ?").get(user, character)?.chat;
  if (chat === undefined) return;
  // Taking away a pin there is none of is nothing to record.
  if (casting === null && !db.query<unknown, [string, string]>("SELECT 1 FROM character_pin WHERE user = ? AND character = ?").get(user, character)) return;
  db.run("INSERT INTO character_pin (user, character, chat, casting, created) VALUES (?, ?, ?, ?, ?)", [user, character, chat, casting, where?.now ?? 0]);
}

/** A character given another name, inside the caller's write: the migration names a person as the world now names it. The caller keeps the name free in the character's chat. */
export function renameCharacter(db: Database, user: string, character: string, name: string): void {
  db.run("UPDATE character SET name = ?, name_key = ? WHERE user = ? AND id = ?", [name.trim(), nameKey(name), user, character]);
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

/**
 * A cast character as a record the lore's binding store links entries to (`src/lore/bindings.ts`): the lore keeps the bindings of lore
 * entries, so the one store is read by the lore map, a character's known lore and the cast alike. A card, a persona or a memory
 * entity is no lore, and the cast keeps those bindings itself.
 */
const recordOf = (character: string): string => `cast:${character}`;

export function bindingsOf(db: Database, user: string, character: string): Binding[] {
  const own = db
    .query<{ kind: string; ref: string; defines: string | null; created: number }, [string, string]>("SELECT kind, ref, defines, created FROM cast_binding WHERE user = ? AND character = ? ORDER BY created, rowid")
    .all(user, character)
    .map((r): Binding => ({ kind: r.kind as SourceKind, ref: r.ref, defines: r.defines, created: r.created }));
  const entries = db
    .query<{ entry: string; aspect: string; created: number }, [string, string]>("SELECT entry, aspect, created FROM lore_binding WHERE user = ? AND record = ? AND by = 'casting' ORDER BY created, rowid")
    .all(user, recordOf(character))
    .map((r): Binding => ({ kind: "entry", ref: r.entry, defines: r.aspect === "" ? null : r.aspect, created: r.created }));
  return [...own, ...entries].sort((a, b) => a.created - b.created);
}

/** Binds a source, or says again which side it defines, inside the caller's write. A lore entry is bound in the lore's store. */
export function bindSource(db: Database, user: string, character: string, b: Omit<Binding, "created">, now: number): void {
  if (b.kind === "entry") {
    db.run("INSERT INTO lore_binding (user, entry, record, linked, aspect, by, revision, created) VALUES (?, ?, ?, 1, ?, 'casting', NULL, ?) ON CONFLICT (user, entry, record, by) DO UPDATE SET aspect = excluded.aspect", [user, b.ref, recordOf(character), b.defines ?? "", now]);
    return;
  }
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
  if (kind === "entry") return db.run("DELETE FROM lore_binding WHERE user = ? AND entry = ? AND record = ? AND by = 'casting'", [user, ref, recordOf(character)]).changes > 0;
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

/**
 * Every version of a character's base that the reading in `chat` sees, oldest first: those written in that chat, and those a chat it
 * was branched from had written when the branch was made. A version written there since, or here since, is that chat's own.
 */
export function baseHistory(db: Database, user: string, character: string, chat: string): BaseVersion[] {
  return db
    .query<DocDb, [string, string, string]>(
      `WITH RECURSIVE ${SEEN}
SELECT d.id, d.part, d.version, d.text, d.seen, d.turn, d.by, d.agent, d.created FROM character_doc d
WHERE d.user = ?1 AND d.character = ?3 AND d.kind = 'base' AND (d.chat IS NULL OR EXISTS (SELECT 1 FROM line l WHERE l.id = d.chat AND d.created <= l.cut)) ORDER BY d.id`,
    )
    .all(user, chat, character)
    .map((r) => ({ part: r.part as BasePart, version: r.version, text: r.text, seen: JSON.parse(r.seen) as Record<string, string>, turn: r.turn, by: r.by, agent: r.agent, created: r.created }));
}

/** A character's base as the reading in `chat` sees it: the newest version of each part written. */
export function baseOf(db: Database, user: string, character: string, chat: string): Map<BasePart, BaseVersion> {
  const out = new Map<BasePart, BaseVersion>();
  for (const v of baseHistory(db, user, character, chat)) out.set(v.part, v);
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

/** Adds a version of each part given in `chat`, inside the caller's write; `seen` is the sources' revisions as read just before. Version numbers run on across every chat the character is known in. */
export function writeBase(db: Database, writer: BaseWriter & { chat: string }, character: string, texts: Partial<Record<BasePart, string>>, seen: Record<string, string>): BaseVersion[] {
  const next = db.query<{ n: number | null }, [string, string, string]>("SELECT max(version) AS n FROM character_doc WHERE user = ? AND character = ? AND part = ? AND kind = 'base'");
  const put = db.query<unknown, [string, string, string, number, string, string, string | null, string | null, string | null, number, string]>(
    "INSERT INTO character_doc (user, character, kind, part, version, text, seen, turn, by, agent, created, chat) VALUES (?, ?, 'base', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const out: BaseVersion[] = [];
  for (const part of BASE_PARTS) {
    const text = texts[part];
    if (text === undefined) continue;
    const version = (next.get(writer.user, character, part)?.n ?? 0) + 1;
    put.run(writer.user, character, part, version, text, JSON.stringify(seen), writer.turn, writer.by, writer.agent, writer.now, writer.chat);
    out.push({ part, version, text, seen, turn: writer.turn, by: writer.by, agent: writer.agent, created: writer.now });
  }
  return out;
}

// ---------------------------------------------------------------- the carried files

/** A carried mind file's item id, as the migration names it: its character and its file. */
export const importedItemId = (character: string, file: string): string => `imported:${character}:${file}`;

/**
 * Attaches a version of a migrated character's mind file as it was, every word, on the turn that held it (`character_doc`, kind
 * `file`, the file's name its part), inside the caller's write; the version is its number among that file's. Which version a reading
 * sees is the item's write that names it, a change of the turn, so a swipe shows the version its turn held.
 */
export function attachFile(db: Database, writer: BaseWriter, character: string, file: string, text: string): number {
  const version = (db.query<{ n: number | null }, [string, string, string]>("SELECT max(version) AS n FROM character_doc WHERE user = ? AND character = ? AND part = ? AND kind = 'file'").get(writer.user, character, file)?.n ?? 0) + 1;
  db.run("INSERT INTO character_doc (user, character, kind, part, version, text, seen, turn, by, agent, created) VALUES (?, ?, 'file', ?, ?, ?, '{}', ?, ?, ?, ?)", [writer.user, character, file, version, text, writer.turn, writer.by, writer.agent, writer.now]);
  return version;
}

/** The text of one version of a carried file; null when no such version is attached. */
export function fileText(db: Database, user: string, character: string, file: string, version: number): string | null {
  return db.query<{ text: string }, [string, string, string, number]>("SELECT text FROM character_doc WHERE user = ? AND character = ? AND part = ? AND kind = 'file' AND version = ?").get(user, character, file, version)?.text ?? null;
}

// ---------------------------------------------------------------- writes tied to turns

/** One write of an item as a reading shows it: its fields and where it came from. */
export interface CastRow {
  /** Its place among every write of the reading, in the order they took effect. */
  s: number;
  turn: string;
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
  /** The moment its writer made the call, in milliseconds. */
  when: number | null;
}

/** An item as it stands at a reading's point. */
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
  /** Its writes, in the order they took effect. */
  rows: CastRow[];
}

/** The id of the one casting item a character has. */
export const castingItemId = (character: string): string => `casting:${character}`;

/** The id of the one item that keeps where a character is away and what it means to do there. */
export const awayItemId = (character: string): string => `away:${character}`;

/** The id of the one relationship item a character has toward a person: by the reference `towardOf` gives (a character's id, a world entity, or a name key). */
export const relationshipItemId = (character: string, toward: string): string => `rel:${character}:${nameKey(toward)}`;

/** The id a new item of `part` is given from the number of the change that writes it. */
export function newItemId(part: keyof typeof PREFIX, change: number): string {
  return `${PREFIX[part]}-${change}`;
}

/** An item of the slice as a reading shows it. */
function itemOf(character: string, id: string, part: RowPart, rows: readonly RowState[]): CastItem {
  const shown = rows.map((r): CastRow => ({ s: r.s, turn: r.turn, character, part, item: id, value: r.value, at: r.at, by: r.by, agent: r.agent, when: r.when }));
  const { fields, dropped } = fieldsOf(rows);
  // The turn that wrote it last is the one at the latest place; of writes at one place, the later.
  let last = rows[0] as RowState;
  for (const r of rows) if (r.n >= last.n) last = r;
  return { part, id, character, fields, opened: (rows[0] as RowState).turn, touched: last.turn, at: (rows[0] as RowState).at, dropped, rows: shown };
}

/** The writes of the cast as one reading sees them. */
export class CastRecord {
  readonly #slice: CastSlice;
  #items: Map<string, CastItem> | undefined;

  constructor(
    readonly at: CastAt,
    slice: CastSlice,
  ) {
    this.#slice = slice;
  }

  /**
   * The record at `at`, from the store's held state: at the chat's head, or at a turn with its own writes (and, for `job`, what that
   * job wrote so far, at once; another job's take effect where the store places them, §10.9). Never reads or parses a stored change.
   */
  static read(store: Store, user: string, at: CastAt, job: string | null = null): CastRecord {
    const u = store.user(user);
    const folded = at.turn === null ? u.headState(at.chat) : job === null ? u.stateAt(at.turn) : u.stateFor(at.turn, job);
    return new CastRecord(at, sliceOf(folded.state.areas));
  }

  /** Every item, in the order it was first written: those of one character together, the characters in the order they were first written. */
  get items(): ReadonlyMap<string, CastItem> {
    if (this.#items === undefined) {
      const all: CastItem[] = [];
      for (const [character, items] of Object.entries(this.#slice.items)) for (const [id, state] of Object.entries(items)) if (state.rows.length > 0) all.push(itemOf(character, id, state.part, state.rows));
      all.sort((a, b) => (a.rows[0] as CastRow).s - (b.rows[0] as CastRow).s);
      this.#items = new Map(all.map((i) => [i.id, i]));
    }
    return this.#items;
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
  /** The story time the write is of, where it is none of the writer's moment: a memory is of the moment it comes from. */
  at?: number | null;
}

/** Who writes, on which turn, at what story time, and when. */
export interface CastWriter {
  user: string;
  /** The turn the writes belong to; null: the player's own, of no turn (a job he started, his own edit), which names `chat`. */
  turn: string | null;
  chat?: string;
  by: string | null;
  agent: string | null;
  job: string | null;
  /** Story time at the turn, minutes since the world's epoch; null in a chat that keeps no clock. */
  at: number | null;
  now: number;
  /** Where what it writes came from, as the store keeps it; none given, the player's own writes are the player's. */
  source?: Source;
}

/** The number the next change the store records will have: the writes of one queued call are recorded one after another, so a new item's id is made from the number of the change that writes it. */
function nextChange(store: Store): number {
  return (store.db.query<{ seq: number }, []>("SELECT seq FROM sqlite_sequence WHERE name = 'change'").get()?.seq ?? 0) + 1;
}

/**
 * Records `writes` where the store puts a write (R-73: the writer's turn, or his own changes), in order, inside the caller's
 * queued write: each a change of the story lane, a new item's id made here. A turn joined to another is refused first by the
 * store, with the typed error naming the turn it joined.
 */
export function writeCast(store: Store, writer: CastWriter, writes: readonly CastWrite[]): CastRow[] {
  const first = nextChange(store);
  const made = writes.map((w, i) => {
    if (w.item === null && !(w.part in PREFIX)) throw new Error(`a ${w.part} item is named by its key, never made new`);
    return { ...w, item: w.item ?? newItemId(w.part as keyof typeof PREFIX, first + i) };
  });
  const inputs = made.map((w): ChangeInput => {
    const value: WriteValue = { character: w.character, part: w.part, item: w.item, value: w.value, at: w.at === undefined ? writer.at : w.at, agent: writer.agent, when: writer.now };
    const source = writer.source ?? (writer.by === "player" ? "player" : undefined);
    return { lane: "story", op: CAST_WRITE, value: value as unknown as JsonObject, by: writer.by, handle: writer.agent, job: writer.job, ...(source !== undefined ? { source } : {}) };
  });
  const u = store.user(writer.user);
  u.record(u.writeTarget({ chat: writer.chat ?? "", turn: writer.turn, job: writer.job }), inputs);
  return made.map((w) => ({ s: 0, turn: writer.turn ?? "", character: w.character, part: w.part, item: w.item, value: w.value, at: w.at === undefined ? writer.at : w.at, by: writer.by, agent: writer.agent, when: writer.now }));
}
