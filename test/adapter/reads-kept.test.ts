// What the door's reads hold for a few seconds (`src/adapter/lumiverse/memo.ts`) on the stand-in's database file and routes: a chat
// or a book read twice while unchanged is read once; what Lumiverse changed is read again at the next read; one chat's reads can be
// dropped and another's stay; over HTTP every swipe is read as saved. Then the books a generation reads and every book of the user's
// listed. Every user, chat and book is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { attachedBooks, listBooks } from "../../src/adapter/lumiverse/books";
import { createDbReader } from "../../src/adapter/lumiverse/db";
import { createHttpReads } from "../../src/adapter/lumiverse/http-reads";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { FakeClock } from "../standin/clock";
import { StandInDb, type Rows } from "../standin/db";
import { LumiverseServer } from "../standin/http";

const json = (value: unknown): string => JSON.stringify(value);
const USER = "user-tamsin";

function rows(): Rows {
  const book = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Book ${id}`, user_id: USER, metadata: json({}), ...extra });
  return {
    user: [{ id: USER, name: USER, email: "tamsin@example.invalid", username: "tamsin" }],
    characters: [
      { id: "char-a", name: "Mara", user_id: USER, extensions: json({ world_book_ids: ["book-char"] }) },
      { id: "char-c", name: "Odo", user_id: USER, extensions: json({ world_book_ids: ["book-odo"] }) },
    ],
    chats: [
      { id: "chat-1", user_id: USER, character_id: "char-a", name: "One", metadata: json({ chat_world_book_ids: ["book-chat"] }) },
      { id: "chat-2", user_id: USER, character_id: "char-a", name: "Two", metadata: "{}" },
      { id: "chat-g", user_id: USER, character_id: "char-a", name: "Group", metadata: json({ group: true, group_lorebook_mode: "active_character", character_ids: ["char-a", "char-c"] }) },
      { id: "chat-t", user_id: USER, name: "Temporary", metadata: json({ temporary: true }) },
    ],
    messages: [
      { id: "m1", chat_id: "chat-1", index_in_chat: 0, is_user: 1, name: "Tamsin", content: "Hello.", swipes: json(["Hello."]) },
      { id: "m2", chat_id: "chat-1", index_in_chat: 1, is_user: 0, name: "Mara", content: "Hi.", swipe_id: 0, swipes: json(["Hi.", "A second telling."]) },
      { id: "m3", chat_id: "chat-2", index_in_chat: 0, is_user: 1, name: "Tamsin", content: "Elsewhere.", swipes: json(["Elsewhere."]) },
    ],
    world_books: [book("book-char", { created_at: 1_700_000_100, metadata: json({ source_character_id: "char-a" }) }), book("book-chat", { created_at: 1_700_000_200 }), book("book-odo"), book("book-persona"), book("book-own", { metadata: json({ lumi_rp_engine: true }) })],
    world_book_entries: [
      { id: "e1", world_book_id: "book-chat", uid: "u1", key: json(["harbor"]), content: "The harbor is old.", comment: "Harbor", revision: 1 },
      { id: "e2", world_book_id: "book-chat", uid: "u2", key: json(["bell"]), content: "The bell lies under it.", comment: "Bell", revision: 1 },
    ],
    personas: [{ id: "p-a", name: "Me", user_id: USER, is_default: 1, attached_world_book_id: "book-persona" }],
    presets: [],
    settings: [],
    message_breakdowns: [],
  };
}

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

function database(): { db: StandInDb; reads: LumiverseReads } {
  const db = new StandInDb();
  db.write(rows());
  const reader = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
  closing.push(() => {
    reader.close();
    db.close();
  });
  return { db, reads: reader };
}

async function http(): Promise<{ db: StandInDb; server: LumiverseServer; reads: LumiverseReads }> {
  const db = new StandInDb();
  db.write(rows());
  const clock = new FakeClock();
  const server = new LumiverseServer({ clock, db, accounts: [{ id: USER, username: "reader", password: "lamp oil lamp" }] });
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock, log: () => undefined });
  await session.signIn("reader", "lamp oil lamp");
  closing.push(() => {
    server.stop();
    db.close();
  });
  return { db, server, reads: createHttpReads(session, undefined, { now: () => clock.now() }) };
}

describe("what the reads hold, on the database file", () => {
  test("an unchanged chat is read once in two reads; an edited message is read again at the next", async () => {
    const { db, reads } = database();
    const first = await reads.path("chat-1");
    expect((await reads.path("chat-1"))?.[0]).toBe(first?.[0]);
    db.run("UPDATE messages SET content = ?, swipes = ?, revision = revision + 1 WHERE id = 'm1'", "Edited.", json(["Edited."]));
    const again = await reads.path("chat-1");
    expect(again?.[0]).not.toBe(first?.[0]);
    expect(again?.[0]?.shown.hash).toBe(textHash("Edited."));
  });

  test("a book read for three catalogs is read from Lumiverse once while unchanged, and again once an entry changed", async () => {
    const { db, reads } = database();
    const [a, b, c] = [await reads.entries("book-chat"), await reads.entries("book-chat"), await reads.entries("book-chat")];
    expect([b[0], c[1]]).toEqual([a[0], a[1]]);
    expect(b[0]).toBe(a[0]);
    db.run("UPDATE world_book_entries SET content = ?, revision = revision + 1 WHERE id = 'e2'", "The bell rang.");
    const changed = await reads.entries("book-chat");
    expect(changed[1]?.content).toBe("The bell rang.");
    expect(changed[0]).not.toBe(a[0]);
  });

  test("a chat's cached reads dropped are read again on next need, and another chat's stay cached", async () => {
    const { reads } = database();
    const [one, two] = [await reads.path("chat-1"), await reads.path("chat-2")];
    reads.dropChat("chat-1");
    expect((await reads.path("chat-1"))?.[0]).not.toBe(one?.[0]);
    expect((await reads.path("chat-2"))?.[0]).toBe(two?.[0]);
  });
});

describe("what the reads hold, over HTTP", () => {
  test("a chat read twice is read once; an event Lumiverse sent lets it go, and a chat dropped is read again; every swipe is read as saved", async () => {
    const { server, reads } = await http();
    const asked = (): number => server.requests.filter((r) => r.path === "/api/v1/chats/chat-1/messages").length;
    await reads.path("chat-1");
    const once = asked();
    await reads.path("chat-1");
    expect(asked()).toBe(once);
    reads.heard("MESSAGE_EDITED", { chatId: "chat-2" });
    await reads.path("chat-1");
    expect(asked()).toBe(once);
    reads.heard("MESSAGE_EDITED", { chatId: "chat-1" });
    await reads.path("chat-1");
    expect(asked()).toBeGreaterThan(once);
    const [reply] = await reads.messagesById("chat-1", ["m2"]);
    expect(reply?.saves.map((s) => s.text)).toEqual(["Hi.", "A second telling."]);
    const before = asked();
    reads.dropChat("chat-1");
    await reads.path("chat-1");
    expect(asked()).toBeGreaterThan(before);
  });

  test("one entry over HTTP reads only its own book", async () => {
    const { server, reads } = await http();
    expect((await reads.entry("e2", "book-chat"))?.comment).toBe("Bell");
    expect(server.requests.filter((r) => r.path.endsWith("/entries")).map((r) => r.path)).toEqual(["/api/v1/world-books/book-chat/entries"]);
  });
});

for (const source of ["database", "http"] as const) {
  describe(`the books a generation reads, on the ${source === "database" ? "database file" : "HTTP routes"}`, () => {
    const reading = async (): Promise<LumiverseReads> => (source === "database" ? database().reads : (await http()).reads);

    test("a group chat in active-character mode lists the speaker's books; a temporary chat lists no persona's book", async () => {
      const reads = await reading();
      expect(await attachedBooks(reads, "chat-g", { speaker: "char-c" })).toEqual(["book-odo", "book-persona"]);
      expect(await attachedBooks(reads, "chat-g")).toEqual(["book-char", "book-persona"]);
      expect(await attachedBooks(reads, "chat-t")).toEqual([]);
    });

    test("every book of his is listed with its id, name, character, time added and whether the chat has it, the engine's own left out", async () => {
      const reads = await reading();
      const listed = await listBooks(reads, "chat-1");
      expect(listed.map((b) => [b.id, b.attached, b.character, b.added])).toEqual([
        ["book-chat", true, false, 1_700_000_200],
        ["book-char", false, true, 1_700_000_100],
        ["book-odo", false, true, expect.any(Number)],
        ["book-persona", false, false, expect.any(Number)],
      ]);
    });
  });
}
