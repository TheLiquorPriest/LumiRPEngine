// A chat's and a book's search from the index file (`src/adapter/lumiverse/index-feed.ts`), on the stand-in's database file: the index holds
// no text, a message sent or edited is found by its new words and not its old, a delete leaves the index, a search reads the text of its hits
// alone, one chat's entries can be dropped and are fed again, and a message's place on the path is as Lumiverse's rows have it. Every chat is invented.

import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { createChatReads, type ChatReads } from "../../src/adapter/lumiverse/chat";
import { createDbReader } from "../../src/adapter/lumiverse/db";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import { StandInDb } from "../standin/db";
import { openIndexBed, type IndexBed } from "./index-bed";

const USER = "user-tamsin";
const json = (value: unknown): string => JSON.stringify(value);

const closing: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

async function bed(): Promise<{ db: StandInDb; reads: LumiverseReads; texts: string[][]; index: IndexBed; chat: ChatReads }> {
  const db = new StandInDb();
  const message = (id: string, i: number, text: string) => ({ id, chat_id: "chat-1", index_in_chat: i, is_user: i % 2 === 0 ? 1 : 0, name: "Someone", content: text, send_date: 1_767_600_000 + i, swipes: json([text]) });
  db.write({
    user: [{ id: USER, name: USER, email: "tamsin@example.invalid", username: "tamsin" }],
    characters: [],
    chats: [{ id: "chat-1", user_id: USER, name: "One", metadata: "{}" }],
    messages: [
      message("m0", 0, "We row out past the lighthouse rocks."),
      message("m1", 1, "The drowned bell lies under the harbor."),
      // A gap in `index_in_chat`, as a delete leaves it.
      message("m2", 3, "Nothing about the sea here."),
    ],
    world_books: [{ id: "book-1", name: "Book", user_id: USER, metadata: "{}" }],
    world_book_entries: [{ id: "e1", world_book_id: "book-1", uid: "u1", key: json(["bell"]), content: "A bell of bronze hangs in the tower.", comment: "The tower bell", revision: 1 }],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  const reader = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
  // The texts asked of Lumiverse by id, each ask a list.
  const texts: string[][] = [];
  const reads: LumiverseReads = { ...reader, messagesById: async (chat, ids) => (texts.push([...ids]), reader.messagesById(chat, ids)), path: (chat, signal) => reader.path(chat, signal), dropChat: (chat) => reader.dropChat(chat) };
  const index = await openIndexBed(reads, USER);
  closing.push(async () => {
    await index.close();
    reader.close();
    db.close();
  });
  const chat = createChatReads({ reads, user: USER, hiddenReadable: async () => false, storyFrom: async () => "everyone", ranges: async () => ({}), summarized: async () => new Set(), feed: index.feed });
  return { db, reads, texts, index, chat };
}

const scope = { user: USER, chat: "chat-1", session: "s-1" };

test("after indexing, neither the index file nor RPE's reads hold a message's or an entry's text; a search reads the text of its hits alone", async () => {
  const { index, texts, chat } = await bed();
  expect((await chat.search(scope, { text: "bell" })).map((h) => h.id)).toEqual(["m1"]);
  await index.feed.searchEntries(["book-1"], "bell", 5);
  const file = readFileSync(index.path).toString("latin1");
  expect(file).not.toContain("lighthouse rocks");
  expect(file).not.toContain("bronze hangs");
  // Everything was read once to be indexed; the search then asked for the one hit it answers.
  expect(texts.at(-1)).toEqual(["m1"]);
  const asked = texts.length;
  await chat.search(scope, { text: "lighthouse" });
  expect(texts.slice(asked)).toEqual([["m0"]]);
});

test("a message sent while RPE runs is found by its words, an edited message by its new words and not its old, and a deleted one not at all", async () => {
  const { db, chat } = await bed();
  expect((await chat.search(scope, { text: "tower" })).length).toBe(0);
  db.run("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipes, revision) VALUES ('m9', 'chat-1', 4, 1, 'Someone', 'We climb the tower.', ?, 1)", json(["We climb the tower."]));
  expect((await chat.search(scope, { text: "tower" })).map((h) => h.id)).toEqual(["m9"]);
  db.run("UPDATE messages SET content = ?, swipes = ?, revision = revision + 1 WHERE id = 'm0'", "We row out past the weir.", json(["We row out past the weir."]));
  expect((await chat.search(scope, { text: "weir" })).map((h) => h.id)).toEqual(["m0"]);
  expect(await chat.search(scope, { text: "lighthouse" })).toEqual([]);
  db.run("DELETE FROM messages WHERE id = 'm9'");
  expect(await chat.search(scope, { text: "tower" })).toEqual([]);
});

test("a chat's search entries dropped are rebuilt on its next search; a message's place on the path is the same after a delete left a gap in Lumiverse's numbering", async () => {
  const { index, chat } = await bed();
  expect((await chat.search(scope, { text: "harbor" })).map((h) => h.id)).toEqual(["m1"]);
  await index.feed.dropChat("chat-1");
  expect((await index.index.search("messages", USER, "harbor", { scope: "chat-1", limit: 5 })).length).toBe(0);
  expect((await chat.search(scope, { text: "harbor" })).map((h) => h.id)).toEqual(["m1"]);
  expect([await chat.position(scope, "m0"), await chat.position(scope, "m2"), await chat.position(scope, "none")]).toEqual([0, 2, undefined]);
});
