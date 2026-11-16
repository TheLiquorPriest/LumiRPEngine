// What RPE writes to Lumiverse (`src/adapter/lumiverse/writes.ts`), on the stand-in's routes: a lore entry written with a revision check, the projection
// book made, attached to one chat with nothing else of its metadata changed, rewritten and detached, a line of his appended as his message, a generation
// started; and across all of it only what STANDALONE-PLAN §4.2's table lists. Every user, chat and line is invented.

import { afterEach, expect, test } from "bun:test";
import { createWrites } from "../../src/adapter/lumiverse/writes";
import type { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { createChatReadsStub } from "./stores-bed";

const USER = "user-tamsin";
const json = (value: unknown): string => JSON.stringify(value);

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

async function bed() {
  const b = await createChatReadsStub(closing);
  b.db.run("INSERT INTO world_books (id, name, user_id, metadata, created_at, updated_at) VALUES ('book-1', 'Book', ?, '{}', 1, 1)", USER);
  b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment, revision) VALUES ('e1', 'book-1', 'u1', ?, 'The harbor is old.', 'Harbor', 1)", json(["harbor"]));
  b.db.run("UPDATE chats SET metadata = ? WHERE id = 'chat-1'", json({ note: "keep me", chat_world_book_ids: ["book-1"] }));
  const writes = createWrites({ session: b.session, reads: b.reads, user: USER });
  return { ...b, writes };
}

const FIELDS = { content: "The harbor is older than the town.", comment: "Harbor", keys: ["harbor", "quay"] };

test("an approved write lands; a second, after the entry changed in Lumiverse, is refused as stale with the entry as it now stands; a removal is checked the same way", async () => {
  const { db, writes } = await bed();
  const first = await writes.update(USER, "e1", FIELDS, 1);
  expect(first).toMatchObject({ written: { id: "e1", content: FIELDS.content, keys: ["harbor", "quay"], revision: 2 } });
  db.run("UPDATE world_book_entries SET content = 'Changed in Lumiverse.', revision = revision + 1 WHERE id = 'e1'");
  const second = await writes.update(USER, "e1", { ...FIELDS, content: "A stale draft." }, 2);
  expect(second).toMatchObject({ refused: { id: "e1", content: "Changed in Lumiverse.", revision: 3 } });
  expect(await writes.remove(USER, "e1", 2)).toMatchObject({ refused: { revision: 3 } });
  expect(await writes.remove(USER, "e1", 3)).toEqual({ removed: true });
  expect(await writes.update(USER, "e1", FIELDS, 3)).toEqual({ refused: null });
  const made = await writes.create(USER, "book-1", FIELDS);
  expect(made).toMatchObject({ book: "book-1", content: FIELDS.content });
});

test("the projection book is made, attached to one chat only with nothing else of its metadata changed, rewritten in order, and detached and removed", async () => {
  const { db, reads, server, writes } = await bed();
  const book = await writes.createProjection(USER, "chat-1", "Projection");
  expect(JSON.parse(String(db.rows("SELECT metadata FROM chats WHERE id = 'chat-1'")[0]?.metadata))).toEqual({ note: "keep me", chat_world_book_ids: ["book-1", book] });
  expect((await reads.book(book))?.metadata).toMatchObject({ lumi_rp_engine: true });
  await writes.replaceProjection(USER, book, [
    { content: "One.", comment: "A", keys: ["a"] },
    { content: "Two.", comment: "B", keys: ["b"] },
  ]);
  expect((await reads.entries(book)).map((e) => e.comment)).toEqual(["A", "B"]);
  await writes.replaceProjection(USER, book, [{ content: "Two.", comment: "B", keys: ["b"] }]);
  expect((await reads.entries(book)).map((e) => e.comment)).toEqual(["B"]);
  await writes.removeProjection(USER, book);
  expect(JSON.parse(String(db.rows("SELECT metadata FROM chats WHERE id = 'chat-1'")[0]?.metadata))).toEqual({ note: "keep me", chat_world_book_ids: ["book-1"] });
  // The stand-in has no route that deletes a book (the book-removal package adds it): what is checked is that RPE asked for it.
  expect(server.requests.some((r) => r.method === "DELETE" && r.path === `/api/v1/world-books/${book}`)).toBe(true);
});

test("a panel action's line is appended as his message, text only; and across every write RPE wrote to Lumiverse only what §4.2's table lists", async () => {
  const { server, writes } = await bed();
  const message = await writes.appendMessage(USER, "chat-1", "I wait by the bell.");
  expect(message).toMatchObject({ role: "user", text: "I wait by the bell." });
  await writes.update(USER, "e1", FIELDS, 1);
  const book = await writes.createProjection(USER, "chat-1", "Projection");
  await writes.removeProjection(USER, book);
  const written = server.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path.replace(/\/[0-9a-f-]{36}\b/g, "/:id")}`);
  const allowed = [/^POST \/api\/v1\/chats\/chat-1\/messages$/, /^PUT \/api\/v1\/world-books\/book-1\/entries\/e1$/, /^POST \/api\/v1\/world-books$/, /^PATCH \/api\/v1\/chats\/chat-1\/metadata$/, /^DELETE \/api\/v1\/world-books\/[^/]+$/, /^POST \/api\/auth\//];
  expect(written.filter((w) => !allowed.some((a) => a.test(w)))).toEqual([]);
});

test("a tap that plays now starts a generation by the chat, its type and its speaker, and takes Lumiverse's id of it", async () => {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const session = {
    request: async (method: string, path: string, body?: unknown) => {
      asked.push({ method, path, body });
      return new Response(json({ generationId: "gen-9", status: "streaming" }), { status: 200 });
    },
  } as unknown as LumiverseSession;
  const writes = createWrites({ session, reads: {} as never, user: USER });
  expect(await writes.startGeneration(USER, "chat-1", { speaker: "char-a" })).toBe("gen-9");
  expect(asked).toEqual([{ method: "POST", path: "/api/v1/generate", body: { chat_id: "chat-1", generation_type: "normal", target_character_id: "char-a" } }]);
  await expect(writes.startGeneration("someone-else", "chat-1", {})).rejects.toThrow("the user it belongs to alone");
});
