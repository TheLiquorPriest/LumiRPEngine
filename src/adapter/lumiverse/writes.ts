// What RPE writes to Lumiverse, and nothing else (STANDALONE-PLAN §4.2, the write table l.260-273): a lore entry written, made or removed with a
// revision check (an approved proposal, Build's own actions); the projection book, made for one chat, attached to that chat alone by the one key
// `chat_world_book_ids` of its metadata with every other key as it was, rewritten, detached and removed; a line of his appended to a chat as his
// message, text only; and a generation started. Each is Lumiverse's own HTTP route asked as the signed-in user, so Lumiverse's own checks and its
// events (`MESSAGE_SENT`, the generation's) go with it. Nothing is written into a message's or a chat's metadata but that one key.
//
// The shapes the lore matches (`LoreBookWrites`, `ProjectionBooks`, `src/lore/`) are matched here: the adapter does not import lore.

import { isRecord, type JsonObject } from "../../shared/json";
import { ENGINE_BOOK_MARK } from "./books";
import { chatBooksNow, removeBook, setChatBooks, type BookRemoved } from "./book-removal";
import type { LumiverseReads } from "./reads";
import { entryFrom, messageFrom, type LvEntry, type LvMessage } from "./rows";
import { LumiverseError, type LumiverseSession } from "./session";

/**
 * The fields of an entry RPE writes: its text, its title (Lumiverse's `comment`) and its keys; and, where given, whether it is
 * off and its `extensions` (Lumiverse's `UpdateWorldBookEntryInput`: `extensions` replaces the entry's, and Lumiverse puts its
 * own managed keys back).
 */
export interface EntryFields {
  content: string;
  comment: string;
  keys: string[];
  disabled?: boolean;
  extensions?: JsonObject;
}

/** An entry write: what was written, or why not (the entry as it now stands; null where it is gone). */
export type EntryWritten = { written: LvEntry } | { refused: LvEntry | null };

export interface WriteDeps {
  session: LumiverseSession;
  reads: LumiverseReads;
  /** The user RPE belongs to: the only one it writes for. */
  user: string;
}

/** How a generation RPE starts is asked for: Lumiverse's own types. */
export type StartType = "normal" | "regenerate" | "continue";

export interface Writes {
  /** The entry's fields set, refused where the entry is no longer at `revision`. */
  update(user: string, entry: string, fields: EntryFields, revision: number): Promise<EntryWritten>;
  /** An entry added to one of the user's books. */
  create(user: string, book: string, fields: EntryFields): Promise<LvEntry>;
  /** An entry removed, refused where it is no longer at `revision`. */
  remove(user: string, entry: string, revision: number): Promise<{ removed: true } | { refused: LvEntry | null }>;
  /** A book made for the chat and attached to that chat alone; its id. */
  createProjection(user: string, chat: string, name: string): Promise<string>;
  /** The projection book's entries set to exactly these, in this order. */
  replaceProjection(user: string, book: string, entries: readonly EntryFields[]): Promise<void>;
  /** The projection book detached from every chat that has it, and deleted. */
  removeProjection(user: string, book: string): Promise<void>;
  /** A book of his removed and taken out of every chat that has it, through Lumiverse's own routes as him, with nothing else of any chat changed; what it changed. */
  removeBook(user: string, book: string): Promise<BookRemoved>;
  /** A line of his appended to the chat as his message, text only; the message as Lumiverse stored it. */
  appendMessage(user: string, chat: string, text: string): Promise<LvMessage>;
  /** A generation started in the chat; Lumiverse's id of it. Its reply comes on the connection the chat uses, tagged as any other. */
  startGeneration(user: string, chat: string, how: { type?: StartType; message?: string | null; speaker?: string | null; connection?: string | null }): Promise<string>;
}

const enc = encodeURIComponent;

interface Answer {
  status: number;
  body: unknown;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function said(body: unknown): string {
  return isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : "";
}

export function createWrites(deps: WriteDeps): Writes {
  const { session } = deps;

  async function send(method: string, path: string, body?: unknown): Promise<Answer> {
    const res = await session.request(method, path, body);
    return { status: res.status, body: parse(await res.text()) };
  }

  const refuse = (method: string, path: string, a: Answer): LumiverseError => new LumiverseError("protocol", `Lumiverse answered ${a.status} to ${method} ${path}${said(a.body)}.`, a.status);

  /** Lumiverse's answer, which must be one of `ok`. */
  async function expect(method: string, path: string, body: unknown, ok: readonly number[]): Promise<Answer> {
    const a = await send(method, path, body);
    if (!ok.includes(a.status)) throw refuse(method, path, a);
    return a;
  }

  const own = (user: string): void => {
    if (user !== deps.user) throw new Error("RPE writes to Lumiverse for the user it belongs to alone.");
  };

  /** Every entry of a book as Lumiverse holds it now, read through the session: a write is checked against this, never against what was held. */
  async function entriesNow(book: string): Promise<LvEntry[]> {
    const out: LvEntry[] = [];
    for (let offset = 0; ; offset += 1000) {
      const a = await send("GET", `/api/v1/world-books/${enc(book)}/entries?limit=1000&offset=${offset}`);
      if (a.status === 404) return out;
      if (a.status !== 200 || !isRecord(a.body) || !Array.isArray(a.body.data) || typeof a.body.total !== "number") throw refuse("GET", `/api/v1/world-books/${book}/entries`, a);
      out.push(...a.body.data.filter(isRecord).map((r) => entryFrom(r)));
      if (a.body.data.length === 0 || offset + 1000 >= a.body.total) return out;
    }
  }

  /** The entry's fields as the routes take them (`key` is Lumiverse's name for the keys). */
  const fieldsOf = (f: EntryFields): Record<string, unknown> => ({
    content: f.content,
    comment: f.comment,
    key: f.keys,
    ...(f.disabled === undefined ? {} : { disabled: f.disabled }),
    ...(f.extensions === undefined ? {} : { extensions: f.extensions }),
  });

  async function bookOf(entry: string): Promise<string | null> {
    return (await deps.reads.entry(entry))?.book ?? null;
  }

  /** The chat's one key set, by Lumiverse's atomic merge (`PATCH /chats/:id/metadata`): every other key of the metadata is left as it is. */
  const attach = (chat: string, ids: readonly string[]): Promise<void> => setChatBooks(session, chat, ids);

  return {
    async update(user, entry, fields, revision) {
      own(user);
      const book = await bookOf(entry);
      if (book === null) return { refused: null };
      const path = `/api/v1/world-books/${enc(book)}/entries/${enc(entry)}`;
      const a = await send("PUT", path, { ...fieldsOf(fields), expected_revision: revision });
      if (a.status === 200 && isRecord(a.body)) return { written: entryFrom(a.body) };
      if (a.status === 404) return { refused: null };
      // The entry changed since the revision: Lumiverse says how it stands (`conflicts[0].current`, null where it is gone).
      if (a.status === 409 && isRecord(a.body) && Array.isArray(a.body.conflicts)) {
        const current = a.body.conflicts.find(isRecord)?.current;
        return { refused: isRecord(current) ? entryFrom(current) : null };
      }
      throw refuse("PUT", path, a);
    },
    async create(user, book, fields) {
      own(user);
      const a = await expect("POST", `/api/v1/world-books/${enc(book)}/entries`, fieldsOf(fields), [201]);
      if (!isRecord(a.body)) throw new LumiverseError("protocol", "Lumiverse answered an entry's creation with something RPE does not read.");
      return entryFrom(a.body);
    },
    async remove(user, entry, revision) {
      own(user);
      const book = await bookOf(entry);
      if (book === null) return { refused: null };
      const now = (await entriesNow(book)).find((e) => e.id === entry) ?? null;
      if (now === null) return { refused: null };
      if (now.revision !== revision) return { refused: now };
      const path = `/api/v1/world-books/${enc(book)}/entries/${enc(entry)}`;
      const a = await send("DELETE", path);
      if (a.status === 404) return { refused: null };
      if (a.status !== 200) throw refuse("DELETE", path, a);
      return { removed: true };
    },
    async createProjection(user, chat, name) {
      own(user);
      const made = await expect("POST", "/api/v1/world-books", { name, description: "", metadata: { [ENGINE_BOOK_MARK]: true } }, [201]);
      const id = isRecord(made.body) && typeof made.body.id === "string" ? made.body.id : null;
      if (id === null) throw new LumiverseError("protocol", "Lumiverse answered a book's creation with no id.");
      const had = await chatBooksNow(session, chat);
      if (had === null) throw new LumiverseError("protocol", `The chat ${chat} is not one of yours: the book made for it was not attached.`, 404);
      await attach(chat, [...had.filter((b) => b !== id), id]);
      return id;
    },
    async replaceProjection(user, book, entries) {
      own(user);
      const had = await entriesNow(book);
      for (const [i, fields] of entries.entries()) {
        const held = had[i];
        // `order_value` keeps the order the entries were given in.
        if (held === undefined) await expect("POST", `/api/v1/world-books/${enc(book)}/entries`, { ...fieldsOf(fields), order_value: i }, [201]);
        else if (held.content !== fields.content || held.comment !== fields.comment || held.keys.join("\u0000") !== fields.keys.join("\u0000") || held.order !== i) await expect("PUT", `/api/v1/world-books/${enc(book)}/entries/${enc(held.id)}`, { ...fieldsOf(fields), order_value: i }, [200]);
      }
      for (const extra of had.slice(entries.length)) await expect("DELETE", `/api/v1/world-books/${enc(book)}/entries/${enc(extra.id)}`, undefined, [200, 404]);
    },
    async removeProjection(user, book) {
      own(user);
      await removeBook(deps, book);
    },
    async removeBook(user, book) {
      own(user);
      return await removeBook(deps, book);
    },
    async appendMessage(user, chat, text) {
      own(user);
      const persona = await deps.reads.defaultPersona();
      const a = await expect("POST", `/api/v1/chats/${enc(chat)}/messages`, { name: persona?.name ?? "You", content: text, is_user: true }, [201]);
      if (!isRecord(a.body)) throw new LumiverseError("protocol", "Lumiverse answered a message's creation with something RPE does not read.");
      return messageFrom(a.body);
    },
    async startGeneration(user, chat, how) {
      own(user);
      const body = { chat_id: chat, generation_type: how.type ?? "normal", ...(how.message ? { message_id: how.message } : {}), ...(how.speaker ? { target_character_id: how.speaker } : {}), ...(how.connection ? { connection_id: how.connection } : {}) };
      const a = await expect("POST", "/api/v1/generate", body, [200]);
      const id = isRecord(a.body) && typeof a.body.generationId === "string" ? a.body.generationId : null;
      if (id === null) throw new LumiverseError("protocol", "Lumiverse answered a generation's start with no id.");
      return id;
    },
  };
}
