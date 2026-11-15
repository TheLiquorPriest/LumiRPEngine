// The stand-in Lumiverse's library: the books, characters, personas and settings a generation takes its lore from, and which
// books a chat has attached. Held in memory and, given a database, written there as Lumiverse writes the rows
// (`services/world-books.service.ts`, `services/characters.service.ts`, `services/personas.service.ts`); a generation then reads
// the rows themselves, so a change made to them under the stand-in is read at the next generation, as Lumiverse reads its own. With
// no database the generation reads what was added. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and
// lines; paths are Lumiverse's `src/`.

import { entryOfRow, entryRow, type StandInDb } from "./db";
import type { BookSource, Entry } from "./lore";

/** A world book and its entries (`world_books` and `world_book_entries`); every entry's `book` is the book's id. */
export interface Book {
  id: string;
  name: string;
  /** The user whose book it is: Lumiverse reads only a user's own (`listEntriesForBooks`, `services/world-books.service.ts:1722-1730`). */
  user: string;
  description?: string;
  folder?: string;
  metadata?: Record<string, unknown>;
  entries: Entry[];
}

/** A character's row, as far as lore reads it (`characters`): `extensions.world_book_ids`, else `extensions.world_book_id`, are its books. */
export interface Character {
  id: string;
  name: string;
  extensions?: Record<string, unknown>;
}

/** A persona's row, as far as lore reads it (`personas`). */
export interface Persona {
  id: string;
  user: string;
  name: string;
  description?: string;
  /** The book attached to it (`attached_world_book_id`). */
  attached_world_book_id?: string | null;
  /** The one a user falls back on when none is named (`getDefaultPersona`, `services/personas.service.ts:183-187`). */
  is_default?: boolean;
}

/** What lore is read from for one generation (`WorldInfoSources`, `services/world-info-sources.service.ts:19-24`). */
export interface WorldInfoSources {
  entries: Entry[];
  worldBookIds: string[];
  bookSourceMap: Map<string, BookSource>;
  bookNameMap: Map<string, string>;
}

/** `getCharacterWorldBookIds` (`utils/character-world-books.ts:6-13`): `world_book_ids` where it is a list, else the one `world_book_id`. */
export function characterBookIds(extensions: Record<string, unknown> | undefined): string[] {
  if (!extensions) return [];
  const ids = extensions.world_book_ids;
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string" && id !== "");
  const single = extensions.world_book_id;
  return typeof single === "string" && single !== "" ? [single] : [];
}

/** What a generation reads of the library, whichever way it is kept. */
export class Library {
  private readonly books = new Map<string, Book>();
  private readonly characters = new Map<string, Character & { user: string }>();
  private readonly personas = new Map<string, Persona>();
  private readonly settings = new Map<string, unknown>();

  /** `db` is the stand-in's database as it stands now, when it has one. */
  constructor(
    private readonly db: () => StandInDb | null,
    private readonly now: () => number,
  ) {}

  /**
   * `createWorldBook` and `createEntry` (`services/world-books.service.ts`): the book's row and each entry's, a uid of its own to each entry, and each
   * entry as its row holds it (its managed keys read out of `extensions`, its columns' defaults), which is what is read back with no database too.
   */
  addBook(book: Book): void {
    for (const e of book.entries) if (e.book !== book.id) throw new Error(`the stand-in's entry ${e.id} says it is in ${e.book}, not in ${book.id}`);
    const now = Math.floor(this.now() / 1000);
    const rows = book.entries.map((e) => entryRow(e, e.uid ?? crypto.randomUUID(), now));
    this.books.set(book.id, { ...book, entries: rows.map(entryOfRow) });
    const db = this.db();
    if (db === null) return;
    db.insert("world_books", { id: book.id, name: book.name, description: book.description ?? "", metadata: JSON.stringify(book.metadata ?? {}), created_at: now, updated_at: now, user_id: book.user, folder: book.folder ?? "" });
    for (const row of rows) db.insert("world_book_entries", row);
  }

  /** A character as `createCharacter` stores it; one there already keeps its card's `extensions` unless the card given has them. */
  addCharacter(user: string, character: Character): void {
    const extensions = character.extensions ?? this.characters.get(character.id)?.extensions;
    this.characters.set(character.id, { id: character.id, name: character.name, ...(extensions !== undefined ? { extensions: structuredClone(extensions) } : {}), user });
    const db = this.db();
    if (db === null) return;
    const given = character.extensions !== undefined;
    if (db.rows("SELECT 1 AS found FROM characters WHERE id = ?", character.id).length === 0) db.insert("characters", { id: character.id, name: character.name, user_id: user, extensions: JSON.stringify(character.extensions ?? {}) });
    else if (given) db.run("UPDATE characters SET name = ?, extensions = ? WHERE id = ?", character.name, JSON.stringify(character.extensions), character.id);
  }

  addPersona(persona: Persona): void {
    this.personas.set(persona.id, structuredClone(persona));
    const db = this.db();
    if (db === null) return;
    db.insert("personas", { id: persona.id, name: persona.name, description: persona.description ?? "", is_default: persona.is_default === true ? 1 : 0, attached_world_book_id: persona.attached_world_book_id ?? null, user_id: persona.user });
  }

  /** A user's setting as `setSetting` stores it: its value as JSON (`settings`). */
  setSetting(user: string, key: string, value: unknown): void {
    this.settings.set(`${user}\u0000${key}`, structuredClone(value));
    const db = this.db();
    if (db === null) return;
    const row = { key, value: JSON.stringify(value), user_id: user, updated_at: Math.floor(this.now() / 1000) };
    if (db.rows('SELECT 1 AS found FROM "settings" WHERE key = ? AND user_id = ?', key, user).length === 0) db.insert("settings", row);
    else db.run('UPDATE "settings" SET value = ?, updated_at = ? WHERE key = ? AND user_id = ?', row.value, row.updated_at, key, user);
  }

  /** The user's setting (`getSettingAsync`): the row's value, else what was set; undefined where neither. */
  setting(user: string, key: string): unknown {
    const db = this.db();
    if (db === null) return this.settings.get(`${user}\u0000${key}`);
    const row = db.rows('SELECT value FROM "settings" WHERE key = ? AND user_id = ?', key, user)[0];
    if (row === undefined) return undefined;
    try {
      return JSON.parse(String(row.value));
    } catch {
      return undefined;
    }
  }

  /** `getCharactersByIds` (`services/characters.service.ts:862-871`): the user's own characters among these. */
  charactersByIds(user: string, ids: readonly string[]): Map<string, Character> {
    const found = new Map<string, Character>();
    const db = this.db();
    for (const id of ids) {
      if (db === null) {
        const c = this.characters.get(id);
        if (c !== undefined && c.user === user) found.set(id, { id: c.id, name: c.name, extensions: c.extensions ?? {} });
        continue;
      }
      const row = db.rows("SELECT id, name, extensions FROM characters WHERE id = ? AND user_id = ?", id, user)[0];
      if (row !== undefined) found.set(id, { id: String(row.id), name: String(row.name), extensions: JSON.parse(String(row.extensions)) as Record<string, unknown> });
    }
    return found;
  }

  /** `resolvePersonaOrDefaultAsync` (`services/personas.service.ts:253-258`): the one named, else the user's `activePersonaId`, else their default; none when none. */
  persona(user: string, id?: string): Persona | null {
    const named = (personaId: string): Persona | null => {
      const db = this.db();
      if (db === null) {
        const p = this.personas.get(personaId);
        return p !== undefined && p.user === user ? p : null;
      }
      const row = db.rows("SELECT id, name, description, is_default, attached_world_book_id FROM personas WHERE id = ? AND user_id = ?", personaId, user)[0];
      return row === undefined ? null : { id: String(row.id), user, name: String(row.name), description: String(row.description), is_default: row.is_default === 1, attached_world_book_id: typeof row.attached_world_book_id === "string" ? row.attached_world_book_id : null };
    };
    if (id !== undefined && id !== "") {
      const requested = named(id);
      if (requested !== null) return requested;
    }
    const active = this.setting(user, "activePersonaId");
    if (typeof active === "string" && active !== "") {
      const fromSetting = named(active);
      if (fromSetting !== null) return fromSetting;
    }
    const db = this.db();
    if (db === null) return [...this.personas.values()].find((p) => p.user === user && p.is_default === true) ?? null;
    const row = db.rows("SELECT id FROM personas WHERE is_default = 1 AND user_id = ? LIMIT 1", user)[0];
    return row === undefined ? null : named(String(row.id));
  }

  /**
   * `listEntriesForBooks` (`services/world-books.service.ts:1713-1743`): the books of this user among these, named, each with its entries by
   * `order_value`, equal ones as they were added. A book that is not the user's is not there. `user` null reads a book of any
   * user's: what a multiplayer peer's relayed books are.
   */
  entriesForBooks(user: string | null, ids: readonly string[], names: Map<string, string>): Map<string, Entry[]> {
    const result = new Map<string, Entry[]>();
    const db = this.db();
    for (const id of ids) {
      let entries: Entry[];
      if (db === null) {
        const book = this.books.get(id);
        if (book === undefined || (user !== null && book.user !== user)) continue;
        names.set(id, book.name);
        entries = structuredClone(book.entries).sort((a, b) => (a.order_value ?? 100) - (b.order_value ?? 100));
      } else {
        const book = db.rows(user === null ? "SELECT id, name FROM world_books WHERE id = ?" : "SELECT id, name FROM world_books WHERE id = ? AND user_id = ?", ...(user === null ? [id] : [id, user]))[0];
        if (book === undefined) continue;
        names.set(id, String(book.name));
        entries = db.rows("SELECT * FROM world_book_entries WHERE world_book_id = ? ORDER BY order_value ASC, rowid ASC", id).map(entryOfRow);
      }
      result.set(id, entries);
    }
    return result;
  }
}

/** `getGroupLorebookMode` and `getGroupCardMode` (`services/world-info-sources.service.ts:36-46`), then the mode they come to (`:48-61`). */
function effectiveGroupMode(metadata: Record<string, unknown>): "active_character" | "all_unmuted" | "all" {
  const lore = metadata.group_lorebook_mode;
  if (lore === "active_character" || lore === "all_unmuted" || lore === "all") return lore;
  const card = metadata.group_card_mode;
  if (card === "merge") return "all";
  if (card === "merge_ignore_muted") return "all_unmuted";
  return "active_character";
}

/**
 * `resolveWorldInfoCharacters` (`services/world-info-sources.service.ts:76-97`): in a group chat, the members whose books are read, by
 * the group's lorebook mode (else its card mode): the speaker alone, or the members in the order of `character_ids`, the muted ones
 * left out unless the mode is "all", the speaker where none is found; any other chat, the speaker.
 */
export function worldInfoCharacters(library: Library, user: string, speaker: Character, metadata: Record<string, unknown>): Character[] {
  if (metadata.group !== true && metadata.group !== 1) return [speaker];
  const mode = effectiveGroupMode(metadata);
  if (mode === "active_character") return [speaker];
  // `getGroupMutedIds` (`services/chats.service.ts:1650-1655`).
  const muted = mode === "all_unmuted" ? new Set(Array.isArray(metadata.muted_character_ids) ? (metadata.muted_character_ids as unknown[]) : []) : undefined;
  const seen = new Set<string>();
  const memberIds: string[] = [];
  for (const id of Array.isArray(metadata.character_ids) ? (metadata.character_ids as unknown[]) : []) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    if (!muted?.has(id)) memberIds.push(id);
  }
  if (memberIds.length === 0) return [speaker];
  const fetched = library.charactersByIds(user, memberIds);
  const members = memberIds.flatMap((id) => {
    const member = fetched.get(id);
    return member === undefined ? [] : [member];
  });
  return members.length > 0 ? members : [speaker];
}

/**
 * `collectWorldInfoSources` (`services/world-info-sources.service.ts:99-164`): the books of the speaker (or of a group's members), then the
 * persona's, the chat's, the user's global ones, each book taken once, by the nearest place that names it, and read: its entries
 * in the order of the books, each book's by `order_value`. A book that has no entries, or is not the user's, gives none (the
 * stand-in does not read a character card's embedded book, `:130-150`).
 */
export function collectWorldInfoSources(library: Library, user: string, speaker: Character, persona: Persona | null, globalWorldBookIds: readonly string[], chatWorldBookIds: readonly string[], metadata: Record<string, unknown>): WorldInfoSources {
  const worldBookIds: string[] = [];
  const bookSourceMap = new Map<string, BookSource>();
  const seen = new Set<string>();
  const pushBook = (id: string | null | undefined, source: BookSource): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    worldBookIds.push(id);
    bookSourceMap.set(id, source);
  };
  for (const member of worldInfoCharacters(library, user, speaker, metadata)) for (const id of characterBookIds(member.extensions)) pushBook(id, "character");
  pushBook(persona?.attached_world_book_id, "persona");
  for (const id of chatWorldBookIds) pushBook(id, "chat");
  for (const id of globalWorldBookIds) pushBook(id, "global");
  const bookNameMap = new Map<string, string>();
  const entries: Entry[] = [];
  if (worldBookIds.length > 0) {
    const byBook = library.entriesForBooks(user, worldBookIds, bookNameMap);
    for (const id of worldBookIds) entries.push(...(byBook.get(id) ?? []));
  }
  return { entries, worldBookIds, bookSourceMap, bookNameMap };
}
