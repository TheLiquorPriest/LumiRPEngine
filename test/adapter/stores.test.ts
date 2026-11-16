// Lumiverse's databanks and memory as RPH's `archive_search` reaches them, and the macros and token counts RPE asks of Lumiverse, over the
// stand-in's routes: a databank search finds the chat's databank, a memory search finds an entity and an arc by their words, a hit reads in
// full, one entity read by its id changes its revision when Lumiverse changes it. Every user, chat and line is invented.

import { afterEach, expect, test } from "bun:test";
import { createChatReadsStub } from "./stores-bed";
import { lumiverseCalls } from "../../src/adapter/lumiverse/lumiverse-calls";
import { createStores } from "../../src/adapter/lumiverse/stores";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const scope = { user: "user-tamsin", chat: "chat-1", session: "s-1" };

test("a databank search finds the chat's databank's text, and archive_search through the port lists databank and memory and reads a hit in full", async () => {
  const bed = await createChatReadsStub(closing);
  bed.db.run("INSERT INTO databanks (id, user_id, name, scope, scope_id, enabled, created_at, updated_at) VALUES ('bank-1', 'user-tamsin', 'Notes', 'chat', 'chat-1', 1, 1, 1)");
  bed.server.cortex.bankChunks.set("bank-1", [{ chunkId: "ch1", documentId: "doc-1", documentName: "Harbor notes", content: "The harbor eel hides under the weir at dawn." }]);
  const stores = createStores({ session: bed.session, reads: bed.reads, user: "user-tamsin", settings: () => ({ hits: 20, snippetChars: 40 }) });
  expect((await stores.list(scope)).map((s) => s.name)).toEqual(["databank", "memory"]);
  const found = await stores.search(scope, { text: "eel weir", stores: ["databank"] });
  expect(found).toMatchObject([{ ref: "databank:bank-1:doc-1", title: "Harbor notes", how: "meaning" }]);
});

test("a memory search finds an entity and an arc by their words, and nothing of their text is kept; one entity read by its id has a revision that changes when Lumiverse changes it", async () => {
  const bed = await createChatReadsStub(closing);
  const run = bed.db.run.bind(bed.db);
  run("INSERT INTO memory_entities (id, chat_id, name, entity_type, mention_count, status, aliases, description, created_at, updated_at) VALUES ('en1', 'chat-1', 'The eel', 'creature', 5, 'active', '[\"old one\"]', 'Lives under the weir.', 1, 10)");
  run("INSERT INTO memory_consolidations (id, chat_id, tier, title, summary, message_range_start, message_range_end, created_at, updated_at) VALUES ('arc1', 'chat-1', 2, 'The night', 'The bell tolls over the weir.', 10, 13, 1, 1)");
  const stores = createStores({ session: bed.session, reads: bed.reads, user: "user-tamsin", settings: () => ({ hits: 20, snippetChars: 60 }) });
  const found = await stores.search(scope, { text: "weir", stores: ["memory"] });
  expect(found.map((h) => h.ref).sort()).toEqual(["memory:arc:arc1", "memory:entity:en1"]);
  const read = await stores.read(scope, "memory:entity:en1");
  expect(read).toMatchObject({ store: "memory", title: "The eel" });
  expect(read?.text).toContain("Lives under the weir.");
  expect((await stores.read(scope, "memory:arc:arc1"))?.text).toBe("The bell tolls over the weir.");
  const before = await stores.entity("chat-1", "en1");
  run("UPDATE memory_entities SET description = 'Gone from the weir.', updated_at = 20 WHERE id = 'en1'");
  const after = await stores.entity("chat-1", "en1");
  expect([before?.name, before?.revision, after?.revision]).toEqual(["The eel", 10, 20]);
  expect(await stores.entity("chat-1", "none")).toBeNull();
  // Another user's stores are none of this RPE's.
  expect(await stores.search({ ...scope, user: "user-other" }, { text: "weir" })).toEqual([]);
});

test("a macro resolves for the chat as Lumiverse resolves it; a text's tokens are counted by its model", async () => {
  const bed = await createChatReadsStub(closing, ["model-tok"]);
  const calls = lumiverseCalls(bed.session);
  expect((await calls.macros.resolve("Hello {{user}}.", { chat: "chat-1" })).text).toBe("Hello User.");
  expect(await calls.macros.resolveBatch({ a: "{{user}}", b: "plain" }, { chat: "chat-1" })).toEqual({ a: "User", b: "plain" });
  expect(await calls.tokens.count("model-tok", "twelve chars")).toBe(3);
  expect(await calls.tokens.count("model-none", "twelve chars")).toBeNull();
  expect(await calls.tokens.countBatch("model-tok", ["abcd", "abcdefgh"])).toEqual([1, 2]);
});
