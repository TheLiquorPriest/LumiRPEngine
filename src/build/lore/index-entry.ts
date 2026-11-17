// The lore index of a world's books and its entry (plan §9.1, §14; PlanChatUI-B3 item 4): the index the lore keeps of the books a world reads
// (`LoreIndex.ofWorld`), shown in Build, and on his press alone written as an entry of one of his books through the lore's one recorded
// writer. Which entry was written, at which revision, and from what text, are kept (`build_lore_index`), so Build says when the index has
// changed since and offers to write it again; a write again names the revision it left the entry at, and an entry he changed in Lumiverse
// since is not written over. RPE never writes it by itself.

import type { Database } from "bun:sqlite";
import type { WriteQueue } from "../../app";
import { hashJson } from "../../shared/hash";
import type { UserId, WorldId } from "../../shared/ids";
import { builtIndexMark } from "../../shared/lore";
import type { WorldDoc } from "../../shared/world";
import type { WorldService } from "../../worlds/service";
import type { BuildBooks, BuildWrites } from "./books";
import { LoreError } from "./service";

/** The index of the books a world reads, as the lore gives it: its text, and each book with how many entries it lists. */
export interface WorldIndex {
  text: string;
  books: { id: string; name: string; entries: number }[];
}

/** The index as Build shows it, with the entry written of it, if any, and whether the index has changed since. */
export interface WorldIndexView extends WorldIndex {
  built: { bookId: string; entryId: string; worldId: string; book: string; current: boolean } | null;
}

export interface IndexEntryDeps {
  db: Database;
  queue: WriteQueue;
  worlds: WorldService;
  books: BuildBooks;
  writes: BuildWrites;
  /** The lore's index of the books a world reads. */
  index(user: UserId, world: WorldDoc): Promise<WorldIndex>;
}

interface Row {
  book: string;
  entry: string;
  revision: number;
  hash: string;
}

/** What the entry Build writes goes by in Lumiverse's editor (its comment, which no prompt holds). */
function commentOf(world: WorldDoc): string {
  return `Lore index of ${world.name}`;
}

export class IndexEntries {
  constructor(private readonly deps: IndexEntryDeps) {}

  private row(user: UserId, world: WorldId): Row | null {
    return this.deps.db.query("SELECT book, entry, revision, hash FROM build_lore_index WHERE user = ? AND world = ?").get(user, world) as Row | null;
  }

  /** The index of the world's books as its draft reads them, and the entry written of it, where it is still there. */
  async view(user: UserId, world: WorldId): Promise<WorldIndexView> {
    const draft = await this.deps.worlds.worlds.working(world, user);
    const index = await this.deps.index(user, draft);
    const row = this.row(user, world);
    const entry = row === null ? null : await this.deps.books.entry(user, row.entry, row.book);
    if (row === null || entry === null) return { ...index, built: null };
    const book = (await this.deps.books.list?.(user, null))?.find((b) => b.id === row.book)?.name ?? row.book;
    return { ...index, built: { bookId: row.book, entryId: row.entry, worldId: world, book, current: row.hash === hashJson(index.text) && entry.revision === row.revision } };
  }

  /**
   * Writes the index into an entry, on his press: the entry written before, at the revision Build left it at (one he changed since is
   * refused, and not written over), else a new entry of `book`, marked as the index of this world.
   */
  async write(user: UserId, world: WorldId, book: string): Promise<WorldIndexView> {
    const draft = await this.deps.worlds.worlds.working(world, user);
    const { text } = await this.deps.index(user, draft);
    const row = this.row(user, world);
    const before = row === null ? null : await this.deps.books.entry(user, row.entry, row.book);
    let written: { id: string; book: string };
    if (row !== null && before !== null) {
      const done = await this.deps.writes.edit(user, before.id, { content: text, comment: before.comment, keys: before.keys, disabled: before.disabled, extensions: before.extensions }, row.revision);
      if ("refused" in done) throw new LoreError("conflict", "The index entry was changed in Lumiverse since Build wrote it, so it was not written over: look at it there, or delete it and build a new one.");
      written = { id: before.id, book: before.book };
    } else {
      if (book === "") throw new LoreError("bad_request", "Pick the book to write the index entry into.");
      const made = await this.deps.writes.create(user, book, { content: text, comment: commentOf(draft), keys: [], disabled: false, extensions: builtIndexMark(world) });
      written = { id: made.entry, book: made.book };
    }
    const now = await this.deps.books.entry(user, written.id, written.book);
    if (now === null) throw new LoreError("conflict", "The index entry could not be read back from Lumiverse after it was written.");
    await this.deps.queue.run(
      (db) => db.query("INSERT OR REPLACE INTO build_lore_index (user, world, book, entry, revision, hash) VALUES (?, ?, ?, ?, ?, ?)").run(user, world, written.book, written.id, now.revision, hashJson(text)),
      "the lore index entry written",
    );
    return await this.view(user, world);
  }
}
