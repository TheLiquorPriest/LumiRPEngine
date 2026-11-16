// What the door puts into the index file's messages and entries indexes, and the search over them (STANDALONE-PLAN §4.2 "No copy", §4.1 l.199,
// Appendix B). The index holds the tokens of each text and its id, revision and scope (the chat or the book), never the text: a search answers
// ids from the index, and the text of the hits alone is read from Lumiverse's rows. The door feeds it from Lumiverse's rows as they stand: a chat is
// brought up to date at the search that needs it (and again in the background when Lumiverse says one of its messages changed), a book the same, so
// what a search finds is what is in Lumiverse, edits and deletes included, whether or not an event was heard.
//
// What the feed knows of what it has put is each chat's and book's id to revision, kept for the process's life. A process that starts again feeds a
// chat whole once (the index leaves a text of the revision it holds as it is), and a message deleted while RPE was down is left in the index under
// its old words, where every search leaves it out: its id is not on the chat's path.

import type { IndexDoc, IndexHit, IndexName } from "../../app/index-file/index-file";
import type { LumiverseReads, LvStep } from "./reads";
import type { LvEntry } from "./rows";

/** The index file as the feed uses it; the app's `IndexFile` is one. */
export interface IndexPort {
  put(index: IndexName, user: string, docs: readonly IndexDoc[]): Promise<unknown>;
  drop(index: IndexName, user: string, ids: readonly string[]): Promise<unknown>;
  search(index: IndexName, user: string, query: string, options: { scope?: string | null; limit: number; prefix?: boolean }): Promise<IndexHit[]>;
}

export interface FeedDeps {
  index: IndexPort;
  reads: LumiverseReads;
  /** The user RPE belongs to: the only one whose texts are fed. */
  user: string;
  log(message: string): void;
}

/** How many messages are read from Lumiverse, and put into the index, at once. */
const STRETCH = 500;

/** What marks a message's indexed text as the one now: Lumiverse's revision, the swipe shown and the hash of its text, so an edit and a swipe flip both change it. */
const keyOf = (s: LvStep): string => `${s.revision}.${s.swipe}.${s.shown.hash}`;

/** What of an entry is searched: its title, its keys and its text. */
const entryText = (e: LvEntry): string => [e.comment, ...e.keys, ...e.secondaryKeys, e.content].join("\n");

/** One place the index and Lumiverse's rows are compared, one at a time per chat or book. */
class Serial {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const tail = (this.#tails.get(key) ?? Promise.resolve()).catch(() => undefined);
    const mine = tail.then(work);
    this.#tails.set(key, mine);
    void mine.catch(() => undefined).then(() => {
      if (this.#tails.get(key) === mine) this.#tails.delete(key);
    });
    return mine;
  }
}

export class IndexFeed {
  readonly #chats = new Map<string, Map<string, string>>();
  readonly #books = new Map<string, Map<string, string>>();
  /** The book each entry fed is in. */
  readonly #bookOf = new Map<string, string>();
  readonly #serial = new Serial();

  constructor(private readonly deps: FeedDeps) {}

  /** The chat's messages brought up to date in the index: what was added or changed is put, what is gone is dropped. Null where the user has no such chat. */
  ensureChat(chat: string): Promise<LvStep[] | null> {
    return this.#serial.run(`chat\u0000${chat}`, async () => {
      const { reads, index, user } = this.deps;
      const path = await reads.path(chat);
      if (path === null) {
        this.#chats.delete(chat);
        return null;
      }
      const had = this.#chats.get(chat) ?? new Map<string, string>();
      const now = new Map(path.map((s) => [s.id, keyOf(s)] as const));
      const changed = path.filter((s) => had.get(s.id) !== now.get(s.id)).map((s) => s.id);
      const gone = [...had.keys()].filter((id) => !now.has(id));
      for (let at = 0; at < changed.length; at += STRETCH) {
        const texts = await reads.messagesById(chat, changed.slice(at, at + STRETCH));
        await index.put(
          "messages",
          user,
          texts.map((m): IndexDoc => ({ id: m.id, revision: now.get(m.id) ?? "", scope: chat, text: m.text })),
        );
      }
      if (gone.length > 0) await index.drop("messages", user, gone);
      this.#chats.set(chat, now);
      return path;
    });
  }

  /**
   * The messages of the chat that hold every word of `text`, best first, by id, with the chat's path they were found against. The words are asked as prefixes,
   * as a chat search reads them. Null where the user has no such chat. A hit the chat's path no longer holds is left out.
   */
  async searchChat(chat: string, text: string): Promise<{ path: LvStep[]; ids: string[] } | null> {
    const path = await this.ensureChat(chat);
    if (path === null) return null;
    const hits = await this.deps.index.search("messages", this.deps.user, text, { scope: chat, limit: Math.max(1, path.length), prefix: true });
    const here = new Set(path.map((s) => s.id));
    return { path, ids: hits.filter((h) => here.has(h.id)).map((h) => h.id) };
  }

  /** What Lumiverse says changed in a chat the feed holds: the chat is brought up to date in the background. */
  changed(chat: string): void {
    if (!this.#chats.has(chat)) return;
    this.ensureChat(chat).catch((error: unknown) => this.deps.log(`RPE could not bring its search of chat ${chat} up to date: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** The chat's search entries let go of, for the Storage page's prune of a living chat's derived rows; the chat is fed again at its next search. */
  dropChat(chat: string): Promise<void> {
    return this.#serial.run(`chat\u0000${chat}`, async () => {
      const { reads, index, user } = this.deps;
      const ids = new Set([...(this.#chats.get(chat)?.keys() ?? []), ...((await reads.path(chat))?.map((s) => s.id) ?? [])]);
      this.#chats.delete(chat);
      if (ids.size > 0) await index.drop("messages", user, [...ids]);
    });
  }

  /** The book's entries brought up to date in the index, and what they are: Lumiverse's own, in its order. */
  ensureBook(book: string): Promise<LvEntry[]> {
    return this.#serial.run(`book\u0000${book}`, async () => {
      const { reads, index, user } = this.deps;
      const entries = await reads.entries(book);
      const had = this.#books.get(book) ?? new Map<string, string>();
      const now = new Map(entries.map((e) => [e.id, String(e.revision)] as const));
      const changed = entries.filter((e) => had.get(e.id) !== now.get(e.id));
      for (let at = 0; at < changed.length; at += STRETCH) {
        await index.put(
          "entries",
          user,
          changed.slice(at, at + STRETCH).map((e): IndexDoc => ({ id: e.id, revision: now.get(e.id) ?? "", scope: book, text: entryText(e) })),
        );
      }
      const gone = [...had.keys()].filter((id) => !now.has(id));
      if (gone.length > 0) await index.drop("entries", user, gone);
      for (const id of gone) this.#bookOf.delete(id);
      for (const e of entries) this.#bookOf.set(e.id, book);
      this.#books.set(book, now);
      return entries;
    });
  }

  /** The entries of these books that hold every word of `text`, best first, as `{ id, book }`. The words are asked whole, as the lore's own search reads them. */
  async searchEntries(books: readonly string[], text: string, limit: number): Promise<{ id: string; book: string }[]> {
    await Promise.all(books.map((b) => this.ensureBook(b)));
    const found = await Promise.all(books.map((book) => this.deps.index.search("entries", this.deps.user, text, { scope: book, limit })));
    const here = new Map(found.flatMap((hits, i) => hits.map((h) => ({ id: h.id, book: books[i] ?? "", rank: h.rank }))).map((h) => [h.id, h] as const));
    return [...here.values()]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map(({ id, book }) => ({ id, book }));
  }

  /** The book an entry fed is in; null where the feed has not fed it. */
  bookOf(entry: string): string | null {
    return this.#bookOf.get(entry) ?? null;
  }
}
