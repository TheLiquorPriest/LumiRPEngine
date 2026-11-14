// The read-only reader of Lumiverse's database file, on a stand-in file made with Lumiverse's own
// tables: it reads one user's rows and no other's, refuses a file whose tables it does not know (and
// the reads go over HTTP instead), and finds the books a chat reads as Lumiverse finds them.
// Every user, chat and book is invented.

import { afterEach, expect, test } from "bun:test";
import { attachedBooks, loreBooks } from "../../src/adapter/lumiverse/books";
import { createDbReader, type DbReader } from "../../src/adapter/lumiverse/db";
import { preferDatabase, SourceOff } from "../../src/adapter/lumiverse/reads";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { StandInDb, type Rows } from "../standin/db";

const json = (value: unknown): string => JSON.stringify(value);

function rows(): Rows {
  const user = (id: string) => ({ id, name: id, email: `${id}@example.invalid`, username: id });
  return {
    user: [user("user-a"), user("user-b")],
    characters: [
      { id: "char-a", name: "Mara", user_id: "user-a", extensions: json({ world_book_ids: ["book-char"] }) },
      { id: "char-c", name: "Odo", user_id: "user-a", extensions: json({ world_book_id: "book-c" }) },
      { id: "char-b", name: "Vell", user_id: "user-b", extensions: json({ world_book_ids: ["book-b"] }) },
    ],
    world_books: ["book-char", "book-c", "book-persona", "book-chat", "book-global"].map((id) => ({ id, name: id, user_id: "user-a" })).concat([{ id: "book-b", name: "book-b", user_id: "user-b" }]),
    chats: [
      { id: "chat-a", character_id: "char-a", user_id: "user-a", metadata: json({ chat_world_book_ids: ["book-chat", "book-char"] }) },
      { id: "chat-g", character_id: "char-a", user_id: "user-a", metadata: json({ group: true, group_lorebook_mode: "all_unmuted", character_ids: ["char-a", "char-c"], muted_character_ids: ["char-a"] }) },
      { id: "chat-b", character_id: "char-b", user_id: "user-b", metadata: "{}" },
    ],
    messages: [
      { id: "ma1", chat_id: "chat-a", index_in_chat: 0, is_user: 1, name: "Me", content: "Hello.", swipes: json(["Hello."]) },
      { id: "ma2", chat_id: "chat-a", index_in_chat: 1, is_user: 0, name: "Mara", content: "Hi.", swipes: json(["Hi."]) },
      { id: "ma3", chat_id: "chat-a", index_in_chat: 2, is_user: 0, name: "Mara", content: "The second reply.", swipe_id: 1, swipes: json(["First.", "Second."]), swipe_dates: json([1700000000, 1700000060]) },
      { id: "ma4", chat_id: "chat-a", index_in_chat: 3, is_user: 0, name: "Mara", content: "Broken.", swipes: "not a list", swipe_dates: "not a list" },
      { id: "mb1", chat_id: "chat-b", index_in_chat: 0, is_user: 1, name: "Them", content: "Not yours.", swipes: json(["Not yours."]) },
    ],
    world_book_entries: [
      { id: "e-a", world_book_id: "book-chat", uid: "1", key: json(["harbor"]), content: "The harbor is old.", comment: "Harbor" },
      { id: "e-b", world_book_id: "book-b", uid: "1", key: json(["vault"]), content: "Not yours either.", comment: "Vault" },
    ],
    personas: [
      { id: "p-a", name: "Me", user_id: "user-a", is_default: 1, attached_world_book_id: "book-persona" },
      { id: "p-b", name: "Them", user_id: "user-b", is_default: 1, attached_world_book_id: "book-b" },
    ],
    presets: [],
    settings: [
      { key: "globalWorldBooks", value: json(["book-global", "book-char"]), user_id: "user-a" },
      { key: "globalWorldBooks", value: json(["book-b"]), user_id: "user-b" },
    ],
    message_breakdowns: [],
  };
}

const open: { db: StandInDb; reader: DbReader }[] = [];
afterEach(() => {
  for (const { db, reader } of open.splice(0)) {
    reader.close();
    db.close();
  }
});

function readerFor(user: string): { db: StandInDb; reader: DbReader; logs: string[] } {
  const db = new StandInDb();
  db.write(rows());
  const logs: string[] = [];
  const reader = createDbReader({ path: db.path, user, sleep: async () => undefined, log: (m) => logs.push(m) });
  open.push({ db, reader });
  return { db, reader, logs };
}

test("reads its user's rows and never another user's, even by their ids", async () => {
  const { reader } = readerFor("user-a");
  expect((await reader.chat("chat-a"))?.id).toBe("chat-a");
  expect((await reader.messagesById("chat-a", ["ma1", "ma2"])).map((m) => m.id)).toEqual(["ma1", "ma2"]);
  expect(await reader.chat("chat-b")).toBeNull();
  expect(await reader.path("chat-b")).toBeNull();
  expect(await reader.messagesById("chat-b", ["mb1"])).toEqual([]);
  expect(await reader.book("book-b")).toBeNull();
  expect(await reader.entries("book-b")).toEqual([]);
  expect(await reader.entry("e-b")).toBeNull();
  expect(await reader.persona("p-b")).toBeNull();
  expect((await reader.defaultPersona())?.id).toBe("p-a");
  expect((await reader.setting("globalWorldBooks"))?.value).toEqual(["book-global", "book-char"]);
});

test("refuses a file whose tables it does not know, says why, and the reads go over HTTP instead", async () => {
  const { db, reader } = readerFor("user-a");
  expect((await reader.chat("chat-a"))?.id).toBe("chat-a");
  // Lumiverse changed: a column RPE reads is gone.
  db.run("ALTER TABLE messages DROP COLUMN revision");
  await expect(reader.messagesById("chat-a", ["ma1"])).rejects.toThrow(SourceOff);
  expect(reader.state().off).toContain("revision");
  const fallback = readerFor("user-a").reader;
  const reads = preferDatabase(reader, fallback);
  expect((await reads.messagesById("chat-a", ["ma1"])).map((m) => m.id)).toEqual(["ma1"]);
});

test("gives each message's showing swipe as the importer tied it: its saved text's hash and its stored date, alike from a step and a whole message", async () => {
  const { reader } = readerFor("user-a");
  const expected = [
    // No dates stored: none.
    { hash: textHash("Hi."), date: null },
    // The saved swipe's text is hashed, not `content`; its date is the stored number as it is.
    { hash: textHash("Second."), date: 1700000060 },
    // Lists Lumiverse's mapper cannot read: `content`, and no date.
    { hash: textHash("Broken."), date: null },
  ];
  expect((await reader.messagesById("chat-a", ["ma2", "ma3", "ma4"])).map((m) => m.shown)).toEqual(expected);
  expect(((await reader.path("chat-a")) ?? []).slice(1).map((s) => s.shown)).toEqual(expected);
});

test("gives every swipe of a message as saved, in order, with its stored date: a generation writes into its own swipe, not always the one shown", async () => {
  const { reader } = readerFor("user-a");
  expect((await reader.messagesById("chat-a", ["ma2", "ma3", "ma4"])).map((m) => m.saves)).toEqual([
    [{ text: "Hi.", date: null }],
    [
      { text: "First.", date: 1700000000 },
      { text: "Second.", date: 1700000060 },
    ],
    // A list Lumiverse's mapper cannot read: the one `content`, with no date.
    [{ text: "Broken.", date: null }],
  ]);
});

test("finds the books a chat reads in Lumiverse's order, each once; a group chat's unmuted members'", async () => {
  const { reader } = readerFor("user-a");
  expect(await attachedBooks(reader, "chat-a")).toEqual(["book-char", "book-persona", "book-chat", "book-global"]);
  expect(await attachedBooks(reader, "chat-g")).toEqual(["book-c", "book-persona", "book-global", "book-char"]);
  // A persona asked for by the generation wins over the default; one of another user's is not read.
  expect(await attachedBooks(reader, "chat-a", { persona: "p-b" })).toEqual(["book-char", "book-persona", "book-chat", "book-global"]);
  const books = loreBooks(reader, "user-a");
  expect(await books.attached("user-b", "chat-a")).toEqual([]);
  expect((await books.entry("user-a", "e-a"))?.content).toBe("The harbor is old.");
  expect(await books.entry("user-a", "e-b")).toBeNull();
});
