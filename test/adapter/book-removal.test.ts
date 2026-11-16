// A book removed and detached from every chat that has it, as the user, through Lumiverse's own routes (`src/adapter/lumiverse/book-removal.ts`), on the stand-in. Every name and line is invented.

import { afterEach, expect, test } from "bun:test";
import { createWrites } from "../../src/adapter/lumiverse/writes";
import { createChatReadsStub } from "./stores-bed";

const USER = "user-tamsin";
const json = (value: unknown): string => JSON.stringify(value);

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

async function bed() {
  const b = await createChatReadsStub(closing);
  const { db, host } = b;
  for (const book of ["book-old", "book-keep"]) db.run("INSERT INTO world_books (id, name, user_id, metadata, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)", book, book, USER);
  db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment, revision) VALUES ('e1', 'book-old', 'u1', ?, 'The old engine wrote this.', 'Old', 1)", json(["old"]));
  const chats: Record<string, Record<string, unknown>> = {
    "chat-1": { note: "keep me", chat_world_book_ids: ["book-old", "book-keep"] },
    "chat-2": { chat_world_book_ids: ["book-keep"] },
    "chat-3": { theme: "dark", chat_world_book_ids: ["book-old"] },
  };
  for (const [id, metadata] of Object.entries(chats)) {
    if (id === "chat-1") db.run("UPDATE chats SET metadata = ? WHERE id = 'chat-1'", json(metadata));
    else {
      db.insert("chats", { id, user_id: USER, character_id: "char-a", name: id, metadata: json(metadata) });
      host.chats.set(id, { id, user: USER, character: { id: "char-a", name: "Mara" }, name: id, metadata: {}, messages: [] });
    }
  }
  return { ...b, writes: createWrites({ session: b.session, reads: b.reads, user: USER }) };
}

const metadataOf = (db: Awaited<ReturnType<typeof bed>>["db"], chat: string): unknown => JSON.parse(String(db.rows("SELECT metadata FROM chats WHERE id = ?", chat)[0]?.metadata));

test("the book is detached from every chat that had it, and nothing else of their metadata changes", async () => {
  const { db, writes } = await bed();
  const report = await writes.removeBook(USER, "book-old");
  expect([...report.detached].sort()).toEqual(["chat-1", "chat-3"]);
  expect(metadataOf(db, "chat-1")).toEqual({ note: "keep me", chat_world_book_ids: ["book-keep"] });
  expect(metadataOf(db, "chat-2")).toEqual({ chat_world_book_ids: ["book-keep"] });
  expect(metadataOf(db, "chat-3")).toEqual({ theme: "dark", chat_world_book_ids: [] });
});

test("after the press the book is gone in the stand-in, no chat names it, and the report lists each change", async () => {
  const { db, reads, writes } = await bed();
  const report = await writes.removeBook(USER, "book-old");
  expect(report).toMatchObject({ book: "book-old", removed: true });
  expect(await reads.book("book-old")).toBeNull();
  expect(db.rows("SELECT id FROM world_book_entries WHERE world_book_id = 'book-old'")).toEqual([]);
  for (const chat of await reads.chats()) expect(chat.metadata.chat_world_book_ids).not.toContain("book-old");
  expect(await reads.book("book-keep")).not.toBeNull();
  // A second press finds nothing to change: the book is already gone.
  expect(await writes.removeBook(USER, "book-old")).toEqual({ book: "book-old", detached: [], removed: false });
  await expect(writes.removeBook("someone-else", "book-keep")).rejects.toThrow("the user it belongs to alone");
});
