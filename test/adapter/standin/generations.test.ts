// What the stand-in Lumiverse gives the host that drives it, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): a message
// made by the one `createMessage`, a chat's metadata merged with a key given as undefined removed, and a generation that answers with its id as soon as it
// has begun. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { Block } from "../../standin/assembly";
import { StandInDb } from "../../standin/db";
import { StandIn } from "../../standin/lumiverse";

const USER = "user-quay";
const CHAT = "chat-quay";
const MODEL = "http://127.0.0.1:7883";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const MAIN: Block = { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay at dusk." };
const HISTORY: Block = { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" };

/** A stand-in Lumiverse with a chat on a quay: Edda's, with one line of the player's in it. */
function quay(): { lv: StandIn; db: StandInDb } {
  const lv = new StandIn();
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({ user: [{ id: USER, name: "Oona", email: "oona@example.invalid", username: "oona" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
  lv.db = db;
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [MAIN, HISTORY] });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "m0", role: "user", content: "USER-1 I walk the quay." }], metadata: { tide: "low", gulls: 3 } });
  return { lv, db };
}

describe("a message made through the one `createMessage` (`services/chats.service.ts:2638-2683`)", () => {
  test("is saved under the name given, with what its caller's body carried beside the text, then told", () => {
    const { lv, db } = quay();
    const id = lv.createMessage(CHAT, { role: "assistant", content: "A line of Edda's.", name: "Edda the Elder", characterId: "char-edda", extra: { mood: "wry" } });
    const row = db.rows("SELECT name, is_user, content, extra FROM messages WHERE id = ?", id)[0]!;
    expect(row.name).toBe("Edda the Elder");
    expect(row.is_user).toBe(0);
    expect(row.content).toBe("A line of Edda's.");
    expect(JSON.parse(String(row.extra))).toEqual({ mood: "wry", character_id: "char-edda" });
    const sent = lv.events.filter((e) => e.event === "MESSAGE_SENT");
    expect(sent.length).toBe(1);
    // The user's own line, and a reply with no name, are named as they were before.
    const mine = lv.send(CHAT, "USER-2 I wave.");
    expect(db.rows("SELECT name FROM messages WHERE id = ?", mine)[0]!.name).toBe("User");
    expect(db.rows("SELECT name FROM messages WHERE id = ?", lv.reply(CHAT, "Edda waves back."))[0]!.name).toBe("Edda");
  });
});

describe("a chat's metadata merged (`services/chats.service.ts:5241-5244`; `db/chat-operations.ts:57-80`)", () => {
  test("replaces each key given, removes one given as undefined, and tells the keys that changed", () => {
    const { lv, db } = quay();
    lv.mergeChatMetadata(lv.chats.get(CHAT)!, { tide: "high", gulls: undefined, lamps: "lit" });
    expect(JSON.parse(String(db.rows("SELECT metadata FROM chats WHERE id = ?", CHAT)[0]!.metadata))).toEqual({ tide: "high", lamps: "lit" });
    const changed = lv.events.filter((e) => e.event === "CHAT_CHANGED").map((e) => (e.payload as { changedFields: string[] }).changedFields);
    expect(changed).toEqual([["metadata.tide", "metadata.gulls", "metadata.lamps"]]);
    // A key already as given is not a change.
    lv.mergeChatMetadata(lv.chats.get(CHAT)!, { tide: "high", gulls: undefined });
    expect(lv.events.filter((e) => e.event === "CHAT_CHANGED").map((e) => (e.payload as { changedFields: string[] }).changedFields)[1]).toEqual([]);
  });
});

describe("a generation started (`routes/generate.routes.ts`)", () => {
  test("answers with its id once it has begun, and `done` is its end; a dry run has no id; a chat the stand-in does not hold fails at once", async () => {
    const { lv } = quay();
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "normal" });
    expect(typeof run.generationId).toBe("string");
    const started = lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { generationId: string };
    expect(started.generationId).toBe(run.generationId!);
    const out = await run.done;
    expect(out.error).toBeNull();
    const dry = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "normal", dryRun: true });
    expect(dry.generationId).toBeNull();
    await dry.done;
    await expect(lv.start({ chat: "chat-nowhere", connection: "conn-model", preset: "preset-quay", type: "normal" })).rejects.toThrow("no such chat");
  });
});
