// His books for the tests of Build's lore tools: an in-memory set of books that reads as the door reads them and takes writes as the lore's one
// recorded writer does (an entry written at the revision it was read at, refused once it has moved on), and the lore service over a bed.

import { BuildLore, type ChatMessage } from "../../src/build/lore/service";
import type { BookEntry, BookWrite, BuildBooks, BuildWrites } from "../../src/build/lore/books";
import type { JsonObject } from "../../src/shared/json";
import { WorldService } from "../../src/worlds/service";
import { type Bed, USER } from "./bed";

export interface Written {
  entry: string;
  before: BookWrite;
  after: BookWrite;
}

/** Books by id, each with its name and its entries in order; every write is kept with the entry before and after. */
export class FakeBooks implements BuildBooks, BuildWrites {
  readonly books = new Map<string, { name: string; entries: BookEntry[] }>();
  readonly written: Written[] = [];
  private n = 0;

  add(name: string): string {
    const id = `book${++this.n}`;
    this.books.set(id, { name, entries: [] });
    return id;
  }

  put(book: string, over: Partial<BookEntry> & { comment: string; content: string }): string {
    const entries = this.books.get(book)?.entries;
    if (!entries) throw new Error(`no book ${book}`);
    const id = `e${++this.n}`;
    entries.push({ id, book, keys: ["shop"], disabled: false, extensions: {}, revision: 1, ...over });
    return id;
  }

  /** The entry as it stands, for a test to read or to change as Lumiverse would (a revision raised). */
  at(id: string): BookEntry {
    for (const b of this.books.values()) for (const e of b.entries) if (e.id === id) return e;
    throw new Error(`no entry ${id}`);
  }

  /** A change made in Lumiverse itself, outside RPE: raises the entry's revision. */
  elsewhere(id: string, over: Partial<BookEntry>): void {
    Object.assign(this.at(id), over, { revision: this.at(id).revision + 1 });
  }

  /** Every entry of a book as it stands, as bytes: what Restore puts back. */
  stored(book: string): string {
    return JSON.stringify(this.books.get(book)?.entries.map((e) => ({ ...e, revision: 0 })));
  }

  async list(_user: string, chat: string | null) {
    return [...this.books].map(([id, b]) => ({ id, name: b.name, attached: chat !== null && id === "book1", character: false, added: null })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async entries(_user: string, book: string): Promise<BookEntry[]> {
    return structuredClone(this.books.get(book)?.entries ?? []);
  }

  async entry(_user: string, id: string): Promise<BookEntry | null> {
    for (const b of this.books.values()) for (const e of b.entries) if (e.id === id) return structuredClone(e);
    return null;
  }

  async edit(_user: string, entry: string, fields: BookWrite, revision: number) {
    const e = this.at(entry);
    if (e.revision !== revision) return { refused: "changed" as const };
    this.written.push({ entry, before: { content: e.content, comment: e.comment, keys: e.keys, disabled: e.disabled, extensions: structuredClone(e.extensions) }, after: fields });
    Object.assign(e, { content: fields.content, comment: fields.comment, keys: fields.keys, ...(fields.disabled === undefined ? {} : { disabled: fields.disabled }), ...(fields.extensions === undefined ? {} : { extensions: structuredClone(fields.extensions) as JsonObject }) }, { revision: e.revision + 1 });
    return { written: { id: this.written.length } };
  }

  async create(_user: string, book: string, fields: BookWrite) {
    return { entry: this.put(book, { content: fields.content, comment: fields.comment, keys: fields.keys, disabled: fields.disabled ?? false, extensions: structuredClone(fields.extensions ?? {}) as JsonObject }), book };
  }
}

/** The lore service over a bed and a set of books; `messages` is what Save to lore reads of a chat. */
export function loreOn(bed: Bed, books: FakeBooks, messages: ChatMessage[] = []): { lore: BuildLore; worlds: WorldService } {
  const worlds = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
  const lore = new BuildLore({ books, writes: books, worlds, store: bed.store, messages: async () => messages, db: bed.db, queue: bed.writes, log: bed.log });
  return { lore, worlds };
}

export { USER };
