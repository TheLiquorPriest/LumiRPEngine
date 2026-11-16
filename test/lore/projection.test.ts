// The projection book (plan §9.5): off unless turned on, and then a book of the chat's own holding
// what its story changed of its lore, rewritten whenever the path changes, one per chat. Played on the
// story lane's invented chat, with a stand-in for Lumiverse's book writes.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EntryNumbers, Lore, type LoreEntryFields, LoreProjection, type ProjectionBooks, storePath, storeWorlds } from "../../src/lore/index";
import { madeOf } from "../../src/lore/made";
import { recordStory } from "../../src/story/record";
import { CHAT, openTable, USER } from "../story/rig";
import { Shelf, Tags } from "./fixtures";
import { shippedGuidance } from "./shipped";

/** Lumiverse's books as RPE writes its projection books: each made, rewritten and taken away, recorded. */
class StandInBooks implements ProjectionBooks {
  readonly made: { chat: string; name: string; book: string }[] = [];
  readonly held = new Map<string, readonly LoreEntryFields[]>();
  writes = 0;

  async create(_user: string, chat: string, name: string) {
    const book = `book-projection-${this.made.length + 1}`;
    this.made.push({ chat, name, book });
    this.held.set(book, []);
    return book;
  }

  async replace(_user: string, book: string, entries: readonly LoreEntryFields[]) {
    this.writes++;
    this.held.set(book, entries);
  }

  async remove(_user: string, book: string) {
    this.held.delete(book);
  }
}

describe("the projection book", () => {
  // Each test's folder is taken away whether or not its assertions hold.
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("with the setting off no book is made; on, the chat's book follows its path, and each chat has its own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rpe-lore-projection-"));
    dirs.push(dir);
    const files = await shippedGuidance(dir, [CHAT, "chat-b"]);
    const t = await openTable();
    // RPE has shown an agent the inn: it is e-1.
    await t.writes.run((d) => d.run("INSERT INTO lore_entry_number (user, n, entry) VALUES (?, 1, 'entry-inn')", [USER]));
    // The chat reads the book of inns: an entry is read only from a book the chat reads.
    const shelf = new Shelf(new Map([[USER, { books: [{ id: "book-inns", name: "Inns" }], entries: [{ id: "entry-inn", book: "book-inns", comment: "The Gilded Hart", content: "A thriving inn.", keys: ["hart", "inn"], secondaryKeys: [], disabled: false, constant: false, vectorized: false, extensions: {}, revision: 1 }], attached: new Map([[CHAT, ["book-inns"]]]) }]]));
    const lore = new Lore({ books: shelf, worlds: storeWorlds(t.store), turns: new Tags(), numbers: new EntryNumbers(t.db, t.writes) });
    const books = new StandInBooks();
    let on = false;
    const projection = new LoreProjection({ db: t.db, writes: t.writes, lore, path: storePath(t.store), books, enabled: async () => on, lines: async (at) => {
      const part = await files.guidance(at.chat).part("lore-answers");
      return part?.format === "lines" ? part : undefined;
    } });

    await t.play();
    const turn = await t.begin();
    await t.writes.run(() => recordStory(t.store, { user: USER, turn: turn.id, by: "author", agent: "author-1", job: null }, [{ entry: "e-1", note: "Its east wing burned tonight." }]));
    await t.tie(turn);

    expect(await projection.refresh(USER, CHAT)).toEqual({ off: true, removed: null });
    expect([books.made, projection.book(USER, CHAT)]).toEqual([[], null]);

    on = true;
    const made = await projection.refresh(USER, CHAT);
    expect(made).toEqual({ book: "book-projection-1", written: true });
    expect(books.made).toEqual([{ chat: CHAT, name: `RPE story notes for chat ${CHAT}`, book: "book-projection-1" }]);
    const burned = [{ comment: "The Gilded Hart", content: "The Gilded Hart, as this chat's story has it now: Its east wing burned tonight.", keys: ["hart", "inn"] }];
    expect(books.held.get("book-projection-1")).toEqual(burned);
    // Nothing changed on the path: nothing is written.
    expect(await projection.refresh(USER, CHAT)).toEqual({ book: "book-projection-1", written: false });
    expect(books.writes).toBe(1);

    // The turn is swiped: the book is rewritten without its overlay; showing it again brings it back.
    const swipe = await t.swipe();
    await t.tie(swipe);
    expect(await projection.refresh(USER, CHAT)).toEqual({ book: "book-projection-1", written: true });
    expect(books.held.get("book-projection-1")).toEqual([]);
    await t.showSwipe(turn);
    await projection.refresh(USER, CHAT);
    expect(books.held.get("book-projection-1")).toEqual(burned);

    // Another chat, a branch say, gets a book of its own.
    await t.writes.run(() => t.s.createChat({ id: "chat-b" }));
    expect(await projection.refresh(USER, "chat-b")).toEqual({ book: "book-projection-2", written: true });

    // Turned off again: the chat's book is taken away.
    on = false;
    expect(await projection.refresh(USER, CHAT)).toEqual({ off: true, removed: "book-projection-1" });
    expect([books.held.has("book-projection-1"), projection.book(USER, CHAT)]).toEqual([false, null]);
  });

  test("the book holds an entry for the canon the story made about someone, under the names it names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rpe-lore-projection-"));
    dirs.push(dir);
    const files = await shippedGuidance(dir, [CHAT]);
    const t = await openTable();
    const lore = new Lore({ books: new Shelf(), worlds: storeWorlds(t.store), turns: new Tags(), numbers: new EntryNumbers(t.db, t.writes) });
    const books = new StandInBooks();
    const projection = new LoreProjection({ db: t.db, writes: t.writes, lore, path: storePath(t.store), books, enabled: async () => true, made: madeOf({ store: t.store, lore }), lines: async (at) => {
      const part = await files.guidance(at.chat).part("lore-answers");
      return part?.format === "lines" ? part : undefined;
    } });
    await t.play();
    const turn = await t.begin();
    await t.writes.run(() => recordStory(t.store, { user: USER, turn: turn.id, by: "author", agent: "author-1", job: null }, [{ part: "canon", item: null, value: { text: "The inn has twelve rooms.", who: ["Bram"] } }]));
    await t.tie(turn);
    expect(await projection.refresh(USER, CHAT)).toMatchObject({ written: true });
    expect([...books.held.values()].flat()).toEqual([{ comment: "Bram", content: "The inn has twelve rooms.", keys: ["Bram"] }]);
  });
});
