// A chat's path read again by the reader of Lumiverse's database, which reads again only the messages whose marks moved since its last
// read: after each change Lumiverse makes to a message without moving its revision (a reply's swipe edited to a text of the same length,
// another swipe shown, a message hidden, also where the hide's rewrite of an `extra` another tool wrote keeps its length), a message deleted
// and the rest moved up, and two messages put in each other's place, the path is the one a reader that never read the chat reads whole.
// Every user, chat and message is invented.

import { afterEach, expect, test } from "bun:test";
import { createDbReader } from "../../src/adapter/lumiverse/db";
import type { LvStep } from "../../src/adapter/lumiverse/reads";
import { StandInDb, type Rows } from "../standin/db";

const json = (value: unknown): string => JSON.stringify(value);
const USER = "user-a";

function rows(): Rows {
  return {
    user: [{ id: USER, name: USER, email: "a@example.invalid", username: USER }],
    characters: [{ id: "char-a", name: "Mara", user_id: USER, extensions: "{}" }],
    world_books: [],
    chats: [{ id: "chat-a", character_id: "char-a", user_id: USER, metadata: "{}" }],
    messages: [
      { id: "m1", chat_id: "chat-a", index_in_chat: 0, is_user: 1, name: "Me", content: "Hello.", swipes: json(["Hello."]) },
      { id: "m2", chat_id: "chat-a", index_in_chat: 1, is_user: 0, name: "Mara", content: "Hi there.", swipes: json(["Hi there."]), swipe_dates: json([1700000000]) },
      { id: "m3", chat_id: "chat-a", index_in_chat: 2, is_user: 1, name: "Me", content: "Go on.", swipes: json(["Go on."]) },
      { id: "m4", chat_id: "chat-a", index_in_chat: 3, is_user: 0, name: "Mara", content: "First.", swipe_id: 0, swipes: json(["First.", "Second, longer."]), swipe_dates: json([1700000100, 1700000160]) },
      { id: "m5", chat_id: "chat-a", index_in_chat: 4, is_user: 1, name: "Me", content: "And then?", swipes: json(["And then?"]) },
    ],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  };
}

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

test("a path read again after an edit, a swipe, a hide, a delete and a reorder is the path read whole", async () => {
  const db = new StandInDb();
  db.write(rows());
  const reader = () => {
    const r = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
    closing.push(() => r.close());
    return r;
  };
  const kept = reader();
  closing.push(() => db.close());
  const whole = async (): Promise<LvStep[] | null> => await reader().path("chat-a");
  const same = async (): Promise<LvStep[] | null> => {
    const again = await kept.path("chat-a");
    expect(again).toEqual(await whole());
    return again;
  };
  const first = await same();
  // A reply's shown swipe edited to a text of the same length, as Lumiverse edits a reply's swipe: its revision stays.
  db.run("UPDATE messages SET swipes = ?, content = ? WHERE id = 'm2'", json(["Hi THERE."]), "Hi THERE.");
  const edited = await same();
  expect(edited?.[1]?.shown.hash).not.toBe(first?.[1]?.shown.hash);
  // Another swipe of a reply shown, as Lumiverse shows one: its revision stays.
  db.run("UPDATE messages SET swipe_id = 1, content = ? WHERE id = 'm4'", "Second, longer.");
  expect((await same())?.[3]?.swipe).toBe(1);
  // A message hidden: only its `extra` moves.
  db.run("UPDATE messages SET extra = ? WHERE id = 'm3'", json({ hidden: true }));
  expect((await same())?.[2]?.hidden).toBe(true);
  // A message deleted, and those after it moved up.
  db.run("DELETE FROM messages WHERE id = 'm2'");
  db.run("UPDATE messages SET index_in_chat = index_in_chat - 1 WHERE chat_id = 'chat-a' AND index_in_chat > 1");
  expect((await same())?.map((s) => s.id)).toEqual(["m1", "m3", "m4", "m5"]);
  // Two messages put in each other's place.
  db.run("UPDATE messages SET index_in_chat = CASE id WHEN 'm3' THEN 3 ELSE 1 END WHERE id IN ('m3', 'm5')");
  expect((await same())?.map((s) => s.id)).toEqual(["m1", "m5", "m4", "m3"]);
});

test("a hide that writes an extra another tool wrote with spaces again at the same length is seen", async () => {
  // As Lumiverse hides a message (`bulkSetHidden`): `extra` parsed, `hidden` set, written again as JSON.stringify writes it, revision kept.
  // The `extra` before it is as a tool that writes spaces between tokens left it, padded so that the hide keeps its bytes exactly.
  const hiddenExtra = json({ note: "imported", hidden: true });
  const head = '{"note": "imported"';
  const spaced = `${head}${" ".repeat(hiddenExtra.length - head.length - 1)}}`;
  expect({ bytes: Buffer.byteLength(spaced), parsed: JSON.parse(spaced) }).toEqual({ bytes: Buffer.byteLength(hiddenExtra), parsed: { note: "imported" } });
  const db = new StandInDb();
  const start = rows();
  start.messages = start.messages.map((m) => (m.id === "m5" ? { ...m, extra: spaced } : m));
  db.write(start);
  closing.push(() => db.close());
  const reader = () => {
    const r = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
    closing.push(() => r.close());
    return r;
  };
  const kept = reader();
  expect((await kept.path("chat-a"))?.[4]?.hidden).toBe(false);
  db.run("UPDATE messages SET extra = ? WHERE id = 'm5'", hiddenExtra);
  const again = await kept.path("chat-a");
  expect(again).toEqual(await reader().path("chat-a"));
  expect(again?.[4]?.hidden).toBe(true);
});
