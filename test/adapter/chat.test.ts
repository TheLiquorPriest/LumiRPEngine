// RPH's chat port over Lumiverse's chats (`src/adapter/lumiverse/chat.ts`), on the stand-in's database
// file and on its HTTP routes: a stretch by place, the path listed, a message found by id, a search by
// words; hidden messages marked, their text left out of a read and out of a search unless the chat's
// setting lets agents read them. Then the chat part of RPH's contract kit, its seed laid into the
// stand-in, over both sources. Every chat and line is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { ChatPort } from "rp-harness/contract";
import { runKitPart, type KitSeed } from "rp-harness/testing/kit";
import { createChatReads, NoSuchChat, type ChatReads } from "../../src/adapter/lumiverse/chat";
import { createDbReader } from "../../src/adapter/lumiverse/db";
import { createHttpReads } from "../../src/adapter/lumiverse/http-reads";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { FakeClock } from "../standin/clock";
import { StandInDb, type Rows } from "../standin/db";
import { LumiverseServer } from "../standin/http";

const json = (value: unknown): string => JSON.stringify(value);

interface Line {
  id: string;
  user: boolean;
  name: string;
  text: string;
  hidden?: true;
}

/** A chat's rows as Lumiverse keeps them; after the place `gap`, `index_in_chat` skips one, as a delete leaves it (`services/chats.service.ts:3229-3238`). */
function chatRows(user: string, chat: string, lines: readonly Line[], gap = -1): Rows {
  return {
    user: [
      { id: user, name: user, email: `${user}@example.invalid`, username: user },
      { id: "user-other", name: "other", email: "other@example.invalid", username: "other" },
    ],
    characters: [],
    chats: [
      { id: chat, user_id: user, name: "A chat", metadata: "{}" },
      { id: "chat-other", user_id: "user-other", name: "Not theirs", metadata: "{}" },
    ],
    messages: [
      ...lines.map((m, i) => ({ id: m.id, chat_id: chat, index_in_chat: gap >= 0 && i > gap ? i + 1 : i, is_user: m.user ? 1 : 0, name: m.name, content: m.text, send_date: 1_767_600_000 + i, swipes: json([m.text]), extra: json(m.hidden ? { hidden: true } : {}) })),
      { id: "x0", chat_id: "chat-other", index_in_chat: 0, is_user: 1, name: "Other", content: "The lighthouse is mine.", swipes: json(["The lighthouse is mine."]) },
    ],
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  };
}

/** The stand-in's rows, read from its file or over its routes as the signed-in user, and how to close what reads them. */
async function readsOf(db: StandInDb, user: string, source: "database" | "http"): Promise<{ reads: LumiverseReads; close(): void }> {
  if (source === "database") {
    const reader = createDbReader({ path: db.path, user, sleep: async () => undefined, log: () => undefined });
    return { reads: reader, close: () => reader.close() };
  }
  const clock = new FakeClock();
  const server = new LumiverseServer({ clock, db, accounts: [{ id: user, username: "reader", password: "lamp oil lamp" }] });
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => user, clock, log: () => undefined });
  await session.signIn("reader", "lamp oil lamp");
  return { reads: createHttpReads(session), close: () => server.stop() };
}

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const COAST: Line[] = [
  { id: "c0", user: true, name: "Tamsin", text: "I climb the spiral stairs of the old lighthouse." },
  { id: "c1", user: false, name: "Wren", text: "Wren lifts the lantern; the lamp room smells of brine." },
  { id: "c2", user: true, name: "Tamsin", text: "(Note to self: ask about the drowned bell.)", hidden: true },
  { id: "c3", user: false, name: "Wren", text: "Forty years the bell has lain under the harbor." },
  { id: "c4", user: true, name: "Tamsin", text: "Then we row out at dawn, past the Lighthouse rocks." },
];

for (const source of ["database", "http"] as const) {
  const where = source === "database" ? "database file" : "HTTP routes";

  describe(`the chat port over Lumiverse's ${where}`, () => {
    async function port(options: { hiddenReadable?: boolean; summarized?: string[] } = {}): Promise<ChatReads> {
      const db = new StandInDb();
      closing.push(() => db.close());
      db.write(chatRows("user-tamsin", "chat-coast", COAST, 1));
      const read = await readsOf(db, "user-tamsin", source);
      closing.push(() => read.close());
      return createChatReads({
        reads: read.reads,
        user: "user-tamsin",
        hiddenReadable: async () => options.hiddenReadable === true,
        ranges: async () => ({ scene: { from: 3, to: 5 } }),
        summarized: async () => new Set(options.summarized ?? []),
      });
    }
    const scope = { user: "user-tamsin", chat: "chat-coast", session: "s-1" };

    test("reads a stretch by place on the path (a deleted message leaves no hole); a hidden message is marked and its text left out", async () => {
      const chat = await port({ summarized: ["c1"] });
      expect(await chat.info(scope)).toEqual({ length: 5, hiddenReadable: false, ranges: { scene: { from: 3, to: 5 } } });
      const read = await chat.read(scope, { from: 1, to: 4 });
      expect(read.map((m) => [m.index, m.id, m.role, m.name])).toEqual([
        [1, "c1", "assistant", "Wren"],
        [2, "c2", "user", "Tamsin"],
        [3, "c3", "assistant", "Wren"],
      ]);
      expect(read[0]).toMatchObject({ text: COAST[1]!.text, summarized: true });
      expect(read[1]).toEqual({ id: "c2", index: 2, role: "user", name: "Tamsin", hidden: true, at: (1_767_600_000 + 2) * 1000 });
      expect(read[2]?.summarized).toBeUndefined();
      expect((await chat.read(scope, { from: 3, to: 99 })).map((m) => m.id)).toEqual(["c3", "c4"]);
      expect(await chat.read(scope, { from: 7, to: 9 })).toEqual([]);
    });

    test("lists the path with no text, and finds a message by its id; the hidden one marked, its text left out", async () => {
      const chat = await port();
      expect((await chat.list(scope)).map((s) => [s.index, s.id, s.hidden ?? false])).toEqual([
        [0, "c0", false],
        [1, "c1", false],
        [2, "c2", true],
        [3, "c3", false],
        [4, "c4", false],
      ]);
      expect(await chat.find(scope, "c3")).toMatchObject({ id: "c3", index: 3, text: COAST[3]!.text });
      const hidden = await chat.find(scope, "c2");
      expect(hidden).toMatchObject({ id: "c2", index: 2, hidden: true });
      expect(hidden?.text).toBeUndefined();
      expect(await chat.find(scope, "x0")).toBeNull();
    });

    test("a search finds messages with a word beginning with each word asked, oldest first, and leaves hidden ones out unless the setting lets agents read them", async () => {
      const chat = await port();
      const lighthouse = await chat.search(scope, { text: "LIGHTHOUSE" });
      expect(lighthouse.map((h) => h.id)).toEqual(["c0", "c4"]);
      expect(lighthouse[0]).toEqual({ id: "c0", index: 0, role: "user", name: "Tamsin", snippet: COAST[0]!.text, how: "words" });
      expect(await chat.search(scope, { text: "bell drown" })).toEqual([]);
      expect((await chat.search(scope, { text: "bell harbor" })).map((h) => h.id)).toEqual(["c3"]);
      expect((await chat.search(scope, { text: "lighthouse", within: { from: 1, to: 5 } })).map((h) => h.index)).toEqual([4]);
      expect((await chat.search(scope, { text: "lighthouse", limit: 1 })).map((h) => h.id)).toEqual(["c0"]);
      const readable = await port({ hiddenReadable: true });
      expect((await readable.search(scope, { text: "bell drown" })).map((h) => h.id)).toEqual(["c2"]);
      expect((await readable.read(scope, { from: 2, to: 3 }))[0]).toMatchObject({ hidden: true, text: COAST[2]!.text });
    });

    test("another user's chat is no chat of this RPE's, by any read", async () => {
      const chat = await port();
      const theirs = { user: "user-tamsin", chat: "chat-other", session: "s-1" };
      await expect(chat.info(theirs)).rejects.toThrow(NoSuchChat);
      expect(await chat.read(theirs, { from: 0, to: 9 })).toEqual([]);
      await expect(chat.search(theirs, { text: "lighthouse" })).rejects.toThrow(NoSuchChat);
      await expect(chat.info({ ...scope, user: "user-other" })).rejects.toThrow("There is no chat chat-coast for this RPE's Lumiverse user.");
    });

    test("the reads under the port answer alike from the file and over the routes: the chat, its path at stored numbers, a stretch by place, messages by id, the stored breakdown of its latest reply that has one", async () => {
      const db = new StandInDb();
      closing.push(() => db.close());
      const stored = { entries: [{ name: "Main", type: "block", tokens: 3, role: "system", content: "You narrate." }], chatHistoryTokens: 12, totalTokens: 15, model: "model" };
      db.write({ ...chatRows("user-tamsin", "chat-coast", COAST, 1), message_breakdowns: [{ message_id: "c1", chat_id: "chat-coast", user_id: "user-tamsin", data: json({ ...stored, totalTokens: 1 }) }, { message_id: "c3", chat_id: "chat-coast", user_id: "user-tamsin", data: json(stored) }] });
      const read = await readsOf(db, "user-tamsin", source);
      closing.push(() => read.close());
      expect(await read.reads.chat("chat-coast")).toMatchObject({ id: "chat-coast", user: "user-tamsin", name: "A chat" });
      expect(await read.reads.chat("chat-other")).toBeNull();
      // A delete left a gap: the path lists the numbers Lumiverse stored, not places.
      expect((await read.reads.path("chat-coast"))?.map((s) => [s.id, s.index, s.hidden])).toEqual([["c0", 0, false], ["c1", 1, false], ["c2", 3, true], ["c3", 4, false], ["c4", 5, false]]);
      expect(await read.reads.path("chat-other")).toBeNull();
      expect((await read.reads.messages("chat-coast", { from: 1, to: 3 })).map((m) => m.id)).toEqual(["c1", "c2"]);
      expect((await read.reads.messagesById("chat-coast", ["c4", "x0", "c0"])).map((m) => m.id)).toEqual(["c0", "c4"]);
      expect(await read.reads.breakdown("chat-coast")).toEqual(stored);
      expect(await read.reads.breakdown("chat-other")).toBeNull();
    });
  });

  // The kit's seed laid into the stand-in: its chat's messages in Lumiverse's rows; the stretches the
  // chat names and its summary marks given by the lanes that keep them.
  runKitPart(`RPE's chat over Lumiverse's ${where}`, "chat", async (seed: KitSeed) => {
    const db = new StandInDb();
    db.write(chatRows(seed.scope.user, seed.scope.chat, seed.messages.map((m) => ({ id: m.id, user: m.role === "user", name: m.name, text: m.text, ...(m.hidden ? { hidden: true as const } : {}) }))));
    const read = await readsOf(db, seed.scope.user, source);
    const chat: ChatPort = createChatReads({
      reads: read.reads,
      user: seed.scope.user,
      hiddenReadable: async () => seed.hiddenReadable,
      ranges: async () => seed.ranges,
      summarized: async () => new Set(seed.messages.filter((m) => m.summarized).map((m) => m.id)),
    });
    return {
      chat,
      close: async () => {
        read.close();
        db.close();
      },
    };
  });
}
