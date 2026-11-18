// What Lumiverse tells RPE about the user's chats, end to end through the stand-in (`test/standin/
// http.ts`): each change is written to the stand-in's database as Lumiverse's own service writes it
// (`services/chats.service.ts`, `services/generate.service.ts`, lines beside each), and its event goes
// out on the user's sockets with Lumiverse's payload. Each reaches the turn lane's `ChatChanges` in its
// shape; and with any one event missed, the reconcile against the database at a turn's start finds
// the same change. Every chat and line is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { changeOf, followChanges, forkOf, knownOf, reconcile, type ChatChange, type KnownChat } from "../../src/adapter/lumiverse/events";
import { HeardGenerations } from "../../src/adapter/lumiverse/heard";
import { messageFrom } from "../../src/adapter/lumiverse/rows";
import { createDbReader, type DbReader } from "../../src/adapter/lumiverse/db";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { LumiverseSocket } from "../../src/adapter/lumiverse/socket";
import { FakeClock } from "../standin/clock";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import { StandIn } from "../standin/lumiverse";

const USER = "user-tamsin";
const CHAT = "chat-coast";
const json = (value: unknown): string => JSON.stringify(value);

const open: (() => void)[] = [];
afterEach(() => {
  for (const close of open.splice(0)) close();
});

function lines(): { id: string; text: string; user: boolean }[] {
  return [
    { id: "m0", text: "I climb to the lamp room.", user: true },
    { id: "m1", text: "Wren lifts the lantern.", user: false },
    { id: "m2", text: "Is the bell still under the harbor?", user: true },
    { id: "m3", text: "Forty years it has lain there.", user: false },
    { id: "m4", text: "Then we row out at dawn.", user: true },
    { id: "m5", text: "", user: false },
  ];
}

async function bed() {
  const clock = new FakeClock();
  const db = new StandInDb();
  db.write({
    user: [{ id: USER, name: "Tamsin", email: "tamsin@example.invalid", username: "tamsin" }],
    characters: [{ id: "char-wren", name: "Wren", user_id: USER }],
    chats: [{ id: CHAT, character_id: "char-wren", user_id: USER, name: "The coast", metadata: "{}" }],
    messages: lines().map((m, i) => ({ id: m.id, chat_id: CHAT, index_in_chat: i, is_user: m.user ? 1 : 0, name: m.user ? "Tamsin" : "Wren", content: m.text, swipes: json([m.text]), swipe_dates: json([1_767_600_000 + i]) })),
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  // The stand-in Lumiverse holds the chat beside its rows, and a branch is made by it, as the player makes one; its events go out on this server's sockets.
  const host = new StandIn();
  host.db = db;
  host.chats.set(CHAT, { id: CHAT, user: USER, character: { id: "char-wren", name: "Wren" }, name: "The coast", metadata: {}, messages: lines().map((m, i) => ({ id: m.id, role: m.user ? ("user" as const) : ("assistant" as const), content: m.text, index: i })) });
  const server = new LumiverseServer({ clock, db, host, accounts: [{ id: USER, username: "tamsin", password: "salt and lantern" }] });
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock, log: () => undefined });
  await session.signIn("tamsin", "salt and lantern");
  const socket = new LumiverseSocket({ session, open: server.open, clock, log: () => undefined });
  const reads: DbReader = createDbReader({ path: db.path, user: USER, sleep: async () => undefined, log: () => undefined });
  open.push(() => {
    socket.stop();
    server.stop();
    reads.close();
    db.close();
  });
  const heard: ChatChange[] = [];
  let reopened = 0;
  followChanges(socket, { changed: (c) => heard.push(c), reopened: () => reopened++ });
  socket.start();
  await clock.advance(0);

  /** A message as `getMessage` gives it to an event (`rowToMessage`, `services/chats.service.ts:587-605`). */
  const message = (id: string): Record<string, unknown> => {
    const row = db.rows("SELECT * FROM messages WHERE id = ?", id)[0]!;
    return { ...row, is_user: row.is_user === 1, swipes: JSON.parse(String(row.swipes)) as unknown, swipe_dates: JSON.parse(String(row.swipe_dates)) as unknown, extra: JSON.parse(String(row.extra)) as unknown };
  };

  /**
   * Lumiverse's writes, each with the event it emits; `send: false` writes and drops the event, as
   * when RPE's socket was closed or RPE was down. The generation's id and message are the tag's.
   */
  const lumiverse = {
    // `updateMessage` (`chats.service.ts:2962-2967`, `:2980-3015`), then `MESSAGE_EDITED` (`:3021-3023`).
    edit(id: string, text: string, send = true): void {
      db.run("UPDATE messages SET content = ?, swipes = json_set(swipes, '$[' || swipe_id || ']', ?), revision = revision + 1 WHERE id = ?", text, text, id);
      if (send) server.emit("MESSAGE_EDITED", { chatId: CHAT, message: message(id) }, USER);
    },
    // The hidden mark (`chats.service.ts:3105-3131`): `extra.hidden`, no revision, `MESSAGE_EDITED`.
    hide(id: string, send = true): void {
      db.run("UPDATE messages SET extra = json_set(extra, '$.hidden', json('true')) WHERE id = ?", id);
      if (send) server.emit("MESSAGE_EDITED", { chatId: CHAT, message: message(id) }, USER);
    },
    // `deleteMessage` (`chats.service.ts:3229-3255`): the row goes and the others keep their places.
    remove(id: string, send = true): void {
      db.run("DELETE FROM messages WHERE id = ?", id);
      if (send) server.emit("MESSAGE_DELETED", { chatId: CHAT, messageId: id }, USER);
    },
    // `addSwipe`, selected (`chats.service.ts:3300-3340`): a new swipe and its date, shown.
    swipe(id: string, text: string, send = true): void {
      db.run("UPDATE messages SET swipes = json_insert(swipes, '$[#]', ?), swipe_dates = json_insert(swipe_dates, '$[#]', ?), swipe_id = json_array_length(swipes), content = ? WHERE id = ?", text, Math.floor(clock.now() / 1000), text, id);
      const updated = message(id);
      if (send) server.emit("MESSAGE_SWIPED", { chatId: CHAT, message: updated, action: "added", swipeId: updated.swipe_id }, USER);
    },
    // A new reply is written into the message staged for it (`generate.service.ts:1988-2005`) by
    // `updateMessage` (`:4150-4167`), which emits `MESSAGE_EDITED` (`chats.service.ts:3021-3023`); then the
    // generation ends (`generate.service.ts:4287-4306`). Each event can be dropped alone.
    reply(generation: string, id: string, text: string, send: { saved: boolean; ended: boolean } = { saved: true, ended: true }): void {
      db.run("UPDATE messages SET content = ?, swipes = json_set(swipes, '$[' || swipe_id || ']', ?), revision = revision + 1 WHERE id = ?", text, text, id);
      if (send.saved) server.emit("MESSAGE_EDITED", { chatId: CHAT, message: message(id) }, USER);
      if (send.ended) server.emit("GENERATION_ENDED", { generationId: generation, chatId: CHAT, messageId: id, content: text, usage: null, generationType: "normal" }, USER);
    },
    // `branchChat` (`chats.service.ts:3506-3635`), made by the stand-in as the player makes it: a new chat, every message up to the one forked at copied with its place and a new id, then
    // `CHAT_FORKED` with the map; `send: false` drops the event, as when RPE's socket was closed or RPE was down.
    fork(at: string, send = true): { chat: string; ids: Record<string, string> } {
      const sockets = host.sockets;
      if (!send) host.sockets = null;
      const chat = host.branch(CHAT, at);
      host.sockets = sockets;
      const told = host.events.findLast((e) => e.event === "CHAT_FORKED")!.payload as { messageIdMap: Record<string, string> };
      return { chat: chat!, ids: told.messageIdMap };
    },
  };

  /** What the turn lane knows of the chat when its turn starts: every message, and the generation it played whose end it has not heard. */
  const known = async (): Promise<KnownChat> => ({ chat: CHAT, messages: ((await reads.path(CHAT)) ?? []).map(knownOf), awaiting: [{ generation: "gen-7", message: "m5" }] });
  return { clock, db, server, socket, reads, lumiverse, heard, known, message, reopened: () => reopened };
}

/** Every change of one turn's span, as the events tell it: each message's hidden mark and showing swipe as `messageFrom` reads the row now. */
function all(b: Awaited<ReturnType<typeof bed>>): ChatChange[] {
  const now = (id: string) => messageFrom(b.message(id));
  return [
    { kind: "message-edited", chat: CHAT, message: "m1", hidden: false, shown: now("m1").shown },
    { kind: "message-edited", chat: CHAT, message: "m2", hidden: true, shown: now("m2").shown },
    { kind: "message-deleted", chat: CHAT, message: "m3" },
    { kind: "message-swiped", chat: CHAT, message: "m4", swipe: 1, shown: now("m4").shown },
    { kind: "message-edited", chat: CHAT, message: "m5", hidden: false, shown: now("m5").shown },
    { kind: "generation-ended", chat: CHAT, generation: "gen-7", message: "m5" },
  ];
}

/** Each event of the span, by what it tells. */
type Dropped = "edit" | "hidden" | "delete" | "swipe" | "reply saved" | "generation ended";

/** Plays every change; the one named is written and its event dropped. */
async function play(b: Awaited<ReturnType<typeof bed>>, dropped: Dropped | null): Promise<void> {
  b.lumiverse.edit("m1", "Wren lifts the brass lantern.", dropped !== "edit");
  b.lumiverse.hide("m2", dropped !== "hidden");
  b.lumiverse.remove("m3", dropped !== "delete");
  b.lumiverse.swipe("m4", "Then we row out before dawn.", dropped !== "swipe");
  b.lumiverse.reply("gen-7", "m5", "The tide decides that, not you.", { saved: dropped !== "reply saved", ended: dropped !== "generation ended" });
  await b.clock.advance(0);
}

describe("Lumiverse's changes to a chat", () => {
  test("each reaches the turn lane in its shape: a generation's end with its message, an edit, a hidden mark, a delete, a swipe, a fork with its id map", async () => {
    const b = await bed();
    await play(b, null);
    const { chat, ids } = b.lumiverse.fork("m2");
    await b.clock.advance(0);
    expect(b.heard).toEqual([...all(b), { kind: "chat-forked", from: CHAT, chat, ids }]);
    expect(Object.keys(ids)).toEqual(["m0", "m1", "m2"]);
    expect(new Set(Object.values(ids)).size).toBe(3);
  });

  test("a hide heard on the event socket hands the lane the hidden flag, an unhide hands false, his edit of the showing swipe is marked updated, and a generation's start is told", async () => {
    const b = await bed();
    b.lumiverse.hide("m2");
    // The hidden mark taken off again (`bulkSetHidden`, `chats.service.ts:3105-3131`).
    b.server.emit("MESSAGE_EDITED", { chatId: CHAT, message: { ...b.message("m2"), extra: {} } }, USER);
    // `updateSwipe` of the swipe it shows (`:3369`), then of one it does not.
    const m4 = b.message("m4");
    b.server.emit("MESSAGE_SWIPED", { chatId: CHAT, message: m4, action: "updated", swipeId: 0 }, USER);
    b.server.emit("MESSAGE_SWIPED", { chatId: CHAT, message: m4, action: "updated", swipeId: 1 }, USER);
    b.server.emit("GENERATION_STARTED", { generationId: "gen-8", chatId: CHAT, model: "m", targetMessageId: null, targetSwipeId: null }, USER);
    await b.clock.advance(0);
    const shown = messageFrom(b.message("m2")).shown;
    expect(b.heard).toEqual([
      { kind: "message-edited", chat: CHAT, message: "m2", hidden: true, shown },
      { kind: "message-edited", chat: CHAT, message: "m2", hidden: false, shown },
      { kind: "message-swiped", chat: CHAT, message: "m4", swipe: 0, shown: messageFrom(m4).shown, updated: true },
      { kind: "message-swiped", chat: CHAT, message: "m4", swipe: 0, shown: messageFrom(m4).shown },
      { kind: "generation-started", chat: CHAT, generation: "gen-8", model: "m" },
    ]);
    expect(shown).toEqual({ date: 1_767_600_002, hash: expect.any(String) });
  });

  for (const dropped of ["edit", "hidden", "delete", "swipe", "reply saved", "generation ended"] as const) {
    test(`with the ${dropped} event missed, the reconcile at a turn's start finds the same change`, async () => {
      const b = await bed();
      const before = await b.known();
      await play(b, dropped);
      const found = await reconcile(b.reads, before);
      const ALL = all(b);
      const missed = ALL.filter((c) => !b.heard.some((h) => JSON.stringify(h) === JSON.stringify(c)));
      expect(missed).toHaveLength(1);
      // Whatever the events did not say, the database does, with the same marks, dates and hashes; and it says nothing they did not.
      expect(found).toEqual(expect.arrayContaining(missed));
      expect(found.toSorted((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))).toEqual(ALL.toSorted((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
    });
  }

  test("with the fork's event missed, the forked chat is found from its rows with the same id map", async () => {
    const b = await bed();
    const { chat, ids } = b.lumiverse.fork("m3", false);
    await b.clock.advance(0);
    expect(b.heard).toEqual([]);
    expect(await forkOf(b.reads, chat)).toEqual({ kind: "chat-forked", from: CHAT, chat, ids });
    expect(await forkOf(b.reads, CHAT)).toBeNull();
  });

  test("a turn that starts with nothing changed finds nothing; one whose generation failed before writing finds its end with no message", async () => {
    const b = await bed();
    const before = await b.known();
    expect(await reconcile(b.reads, { ...before, awaiting: [] })).toEqual([]);
    // The staged reply was removed when its generation failed (`generate.service.ts:2987-3048`).
    b.lumiverse.remove("m5", false);
    expect(await reconcile(b.reads, before)).toEqual([
      { kind: "generation-ended", chat: CHAT, generation: "gen-7", message: null },
      { kind: "message-deleted", chat: CHAT, message: "m5" },
    ]);
  });

  test("events missed while the socket was closed: it opens again, the turn lane hears so, and the reconcile catches up", async () => {
    const b = await bed();
    const before = await b.known();
    b.server.drop(USER);
    await b.clock.advance(0);
    // Lumiverse emits to the sockets it has: none, while RPE's is closed.
    await play(b, null);
    expect(b.heard).toEqual([]);
    await b.clock.advance(1_000);
    expect(b.socket.state().state).toBe("open");
    expect(b.reopened()).toBe(1);
    const found = await reconcile(b.reads, before);
    expect(found).toHaveLength(all(b).length);
    expect(found).toEqual(expect.arrayContaining(all(b)));
  });
});

describe("what only the events of the end and of the chat's own rows tell", () => {
  /** `addMessage` with a place (`chats.service.ts:2650-2675`): the rows from the place on move up one, the new one takes it, and `MESSAGE_SENT` carries `inserted`. */
  function insertBefore(b: Awaited<ReturnType<typeof bed>>, id: string, place: number, send: boolean): void {
    db(b).run("UPDATE messages SET index_in_chat = index_in_chat + 1 WHERE chat_id = ? AND index_in_chat >= ?", CHAT, place);
    db(b).run("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipes, swipe_dates, revision) VALUES (?, ?, ?, 1, 'Tamsin', 'A line put in between.', ?, ?, 1)", id, CHAT, place, json(["A line put in between."]), json([1_767_700_000]));
    if (send) b.server.emit("MESSAGE_SENT", { chatId: CHAT, message: b.message(id), inserted: true }, USER);
  }
  const db = (b: Awaited<ReturnType<typeof bed>>): StandInDb => b.db;

  test("a message inserted before a played turn is reported by the event and, with the event missed, by the reconcile; one added at the end is no change", async () => {
    const b = await bed();
    const before = await b.known();
    insertBefore(b, "m-in", 2, true);
    await b.clock.advance(0);
    expect(b.heard).toEqual([{ kind: "message-inserted", chat: CHAT, message: "m-in", hidden: false, shown: messageFrom(b.message("m-in")).shown }]);
    const found = await reconcile(b.reads, { ...before, awaiting: [] });
    expect(found).toEqual([{ kind: "message-inserted", chat: CHAT, message: "m-in", hidden: false, shown: messageFrom(b.message("m-in")).shown }]);
    // A new message at the end of the path is the chat's newest, not an insertion.
    db(b).run("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipes, swipe_dates, revision) VALUES ('m-end', ?, 20, 1, 'Tamsin', 'Newest.', ?, ?, 1)", CHAT, json(["Newest."]), json([1]));
    expect((await reconcile(b.reads, { ...before, awaiting: [] })).map((c) => c.kind)).toEqual(["message-inserted"]);
  });

  test("a deleted chat is reported by the event and, with the event missed, by the reconcile", async () => {
    const b = await bed();
    const before = await b.known();
    b.server.emit("CHAT_DELETED", { id: CHAT }, USER);
    await b.clock.advance(0);
    expect(b.heard).toEqual([{ kind: "chat-deleted", chat: CHAT }]);
    db(b).run("DELETE FROM messages WHERE chat_id = ?", CHAT);
    db(b).run("DELETE FROM chats WHERE id = ?", CHAT);
    expect(await reconcile(b.reads, before)).toEqual([{ kind: "chat-deleted", chat: CHAT }]);
  });

  test("every way a generation ends reaches the lane as what it is, and a stopped reply's change names the message the tag said it was written to", () => {
    const ended = (event: string, payload: Record<string, unknown>) => changeOf(event, { generationId: "g1", chatId: CHAT, ...payload });
    expect(ended("GENERATION_ENDED", { messageId: "m5" })).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: "m5" });
    // An impersonation draft saves no message; a provider error may have saved part of one or none; a failure in assembly saves none.
    expect(ended("GENERATION_ENDED", { impersonateDraft: true })).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: null });
    expect(ended("GENERATION_ENDED", { messageId: "m5", error: "the provider said no" })).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: "m5", error: "the provider said no" });
    expect(ended("GENERATION_ENDED", { error: "assembly failed" })).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: null, error: "assembly failed" });
    const stopped = ended("GENERATION_STOPPED", { content: "partial" });
    expect(stopped).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: null, stopped: true });
    const heard = new HeardGenerations({ untaggedEnd: () => undefined, tell: async (_chat, lore) => [...lore] });
    void heard.tagged(CHAT, "g1", "m5");
    expect(heard.named(stopped!)).toEqual({ kind: "generation-ended", chat: CHAT, generation: "g1", message: "m5", stopped: true });
  });

  test("a generation's end is told only where a request with no tag came on RPE's connection for its model; a reply of another connection, even on the same model, sends RPE nothing and is not told", () => {
    const told: string[] = [];
    const heard = new HeardGenerations({ untaggedEnd: (what) => told.push(`${what.chat}:${what.untagged}`), tell: async (_chat, lore) => [...lore] });
    const run = (chat: string, generation: string): void => {
      heard.heard({ kind: "generation-started", chat, generation, model: "rpe" });
    };
    const end = (chat: string, generation: string): void => {
      heard.heard({ kind: "generation-ended", chat, generation, message: null });
    };
    // Another connection, the same model: no request reaches RPE.
    run("chat-other", "g1");
    end("chat-other", "g1");
    // On RPE's connection with the extension gone: a request with no tag arrives, and the generation ends without its tagged request.
    run(CHAT, "g2");
    expect(heard.untagged("rpe")).toBe(true);
    expect(heard.untagged("another-model")).toBe(false);
    end(CHAT, "g2");
    // On RPE's connection and tagged: not told, whatever else came.
    run(CHAT, "g3");
    expect(heard.untagged("rpe")).toBe(true);
    void heard.tagged(CHAT, "g3");
    end(CHAT, "g3");
    expect(told).toEqual([`${CHAT}:1`]);
  });
});
