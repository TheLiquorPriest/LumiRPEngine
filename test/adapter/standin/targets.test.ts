// The message a generation goes on, as the stand-in Lumiverse picks it, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): a swipe and a regenerate go on the
// message named, else the chat's last message that is not the user's, never a user's (`services/generate.service.ts:1806-1814`, `:1698-1720`); a message is found by its id among the user's own,
// whichever chat holds it (`getMessage`, `services/chats.service.ts:2356-2360`); a continue on a user's message saves a new one, on a hidden reply goes on it unmoved, and on a message of
// another chat goes on it there (`:1809-1814`, `:4172-4194`; `services/prompt-assembly.service.ts:742-756`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../standin/lumiverse";
import { textOf } from "../../standin/steps";
import { boat, closeBoats, CHAT, generate, rowOf, USER, type Boat } from "./boat";
import { createDbReader } from "../../../src/adapter/lumiverse/db";
import { createHttpReads } from "../../../src/adapter/lumiverse/http-reads";
import { CHAT as WEIR, LINES, OTHER, USER as MARA, weirChat as weirOf, type Weir } from "./weir";

afterEach(closeBoats);

/** The boat's chat: Edda's greeting, the player's line, Edda's reply. */
const lines = (): ChatMessage[] => [
  { id: "m0", role: "assistant", content: "GREET The river is wide here." },
  { id: "m1", role: "user", content: "USER-1 I steer the boat." },
  { id: "m2", role: "assistant", content: "REPLY-1 Edda bails water." },
];

/** A second chat of the user's, with a reply of Edda's of its own. */
function otherChat(b: Boat): void {
  b.lv.addChat({ id: "chat-other", user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "o0", role: "user", content: "OTHER-1 I wade in." }, { id: "o1", role: "assistant", content: "OTHER-2 Rain began." }] });
}

const started = (b: Boat): { targetMessageId?: string; targetSwipeId?: number; chatId: string } => b.lv.events.filter((e) => e.event === "GENERATION_STARTED").at(-1)!.payload as { targetMessageId?: string; targetSwipeId?: number; chatId: string };
const ended = (b: Boat): { messageId?: string; chatId: string } => b.lv.events.filter((e) => e.event === "GENERATION_ENDED").at(-1)!.payload as { messageId?: string; chatId: string };

describe("the message a swipe or a regenerate goes on", () => {
  test.each(["swipe", "regenerate"] as const)("a %s of a named earlier reply goes on that reply, and with none named on the chat's last, never a user's", async (type) => {
    const b = boat([{ words: ["Another greeting."] }, { words: ["Another reply."] }, { words: ["A reply of its own."] }], { messages: lines() });
    // The greeting is named: it gets the new swipe, shown, and it is left out of the prompt while the later reply stays in.
    const named = await generate(b, { type, message: "m0" });
    expect(named.messageId).toBe("m0");
    expect(rowOf(b, "m0").swipes).toEqual(["GREET The river is wide here.", "Another greeting."]);
    expect(rowOf(b, "m2").swipes).toEqual(["REPLY-1 Edda bails water."]);
    expect(started(b)).toMatchObject({ targetMessageId: "m0", targetSwipeId: 1 });
    expect(named.prompt.some((m) => textOf(m).includes("GREET"))).toBe(false);
    expect(named.prompt.some((m) => textOf(m).includes("REPLY-1"))).toBe(true);
    // None named: the last that is not the user's.
    await generate(b, { type });
    expect(rowOf(b, "m2").swipes).toEqual(["REPLY-1 Edda bails water.", "Another reply."]);
    expect(started(b)).toMatchObject({ targetMessageId: "m2", targetSwipeId: 1 });
    // The player's own line named: no swipe is made on it; the reply is saved as a message of its own at the end.
    const refused = await generate(b, { type, message: "m1" });
    expect(rowOf(b, "m1").swipes).toEqual(["USER-1 I steer the boat."]);
    expect(b.lv.chats.get(CHAT)!.messages.map((m) => m.id).slice(0, 3)).toEqual(["m0", "m1", "m2"]);
    expect(b.lv.chats.get(CHAT)!.messages.at(-1)).toMatchObject({ id: refused.messageId, role: "assistant", content: "A reply of its own." });
    expect(started(b).targetMessageId).toBeUndefined();
  });

  test("a message named from another chat is found as Lumiverse finds it: by its id among the user's own, and the swipe is made on it in the chat that holds it", async () => {
    const b = boat([{ words: ["Sun came out."] }], { messages: lines() });
    otherChat(b);
    const out = await generate(b, { type: "swipe", message: "o1" });
    expect(out.messageId).toBe("o1");
    expect(rowOf(b, "o1").swipes).toEqual(["OTHER-2 Rain began.", "Sun came out."]);
    // This chat's own messages are as they were; the generation is this chat's, the swipe's events the other's.
    expect(b.lv.chats.get(CHAT)!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(started(b)).toMatchObject({ chatId: CHAT, targetMessageId: "o1", targetSwipeId: 1 });
    expect(b.lv.events.filter((e) => e.event === "MESSAGE_SWIPED").map((e) => (e.payload as { chatId: string }).chatId)).toEqual(["chat-other", "chat-other"]);
    // A name that no chat of his holds is no message at all.
    const none = await generate(b, { type: "swipe", message: "nowhere" });
    expect(none.messageId).toBeDefined();
    expect(none.messageId).not.toBe("o1");
  });
});

describe("a continue on the messages Lumiverse treats differently (`:1809-1814`, `:4172-4194`; `prompt-assembly.service.ts:742-756`)", () => {
  test("a continue naming a player's message saves a new message while the prompt moves the newest reply, and the end names the new message", async () => {
    const b = boat([{ words: ["A new line."] }], { messages: lines(), preset: { continuePostfix: " " } });
    const out = await generate(b, { type: "continue", message: "m1" });
    // Nothing is continued: the player's line and the reply are as they were, and the reply is a message of its own at the end.
    expect(rowOf(b, "m1").swipes).toEqual(["USER-1 I steer the boat."]);
    expect(rowOf(b, "m2").swipes).toEqual(["REPLY-1 Edda bails water."]);
    const made = b.lv.chats.get(CHAT)!.messages.at(-1)!;
    expect(made).toMatchObject({ role: "assistant", content: "A new line." });
    expect(out.messageId).toBe(made.id);
    expect(ended(b).messageId).toBe(made.id);
    // The prompt still moved the newest reply: it stands last but the nudge, with no postfix, since no message is continued (`:1814`).
    expect(out.prompt.slice(-2).map((m) => [m.role, textOf(m)])).toEqual([["assistant", "REPLY-1 Edda bails water."], ["system", "[Continue your last message without repeating its original content.]"]]);
  });

  test("a hidden reply is continued but not moved, since it is not in the assembled history", async () => {
    const b = boat([{ words: ["Went on."] }], { messages: [lines()[0]!, lines()[1]!, { id: "m2", role: "assistant", content: "ASIDE Edda mutters.", hidden: true }, { id: "m3", role: "user", content: "USER-2 I ask what she said." }] });
    const out = await generate(b, { type: "continue" });
    expect(rowOf(b, "m2").swipes).toEqual(["ASIDE Edda mutters.Went on."]);
    expect(ended(b).messageId).toBe("m2");
    expect(out.prompt.some((m) => textOf(m).includes("ASIDE"))).toBe(false);
    expect(out.prompt.at(-1)!.role).toBe("system");
    expect(textOf(out.prompt.at(-2)!)).toContain("USER-2");
  });

  test("a message named from another chat is continued in that chat, with nothing moved here, and the end names it", async () => {
    const b = boat([{ words: [" and then the sun."] }], { messages: lines() });
    otherChat(b);
    const out = await generate(b, { type: "continue", message: "o1" });
    expect(rowOf(b, "o1").swipes).toEqual(["OTHER-2 Rain began. and then the sun."]);
    expect(b.lv.chats.get(CHAT)!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(ended(b)).toMatchObject({ chatId: CHAT, messageId: "o1" });
    expect(out.messageId).toBe("o1");
    // This chat's newest reply stays in its history where it was: nothing was moved, and only the nudge follows it.
    expect(out.prompt.slice(-2).map((m) => [m.role, textOf(m)])).toEqual([["assistant", "REPLY-1 Edda bails water."], ["system", "[Continue your last message without repeating its original content.]"]]);
    expect(out.prompt.filter((m) => m.__chatHistorySource === true).length).toBe(3);
  });
});

const weirClosing: (() => void)[] = [];
afterEach(() => {
  for (const close of weirClosing.splice(0)) close();
});

const weirRow = (bed: Weir, id: string): Record<string, unknown> => bed.db.rows("SELECT * FROM messages WHERE id = ?", id)[0]!;

describe("a message written through the extension (`spindle/worker-host.ts:4123-4206`, `spindle/runtime-state.ts:50`)", () => {
  test("a system message written through the extension is stored with extra.spindle_role system and read back as a system message", async () => {
    const bed = await weirOf(weirClosing, LINES);
    const ext = bed.host.install(["chat_mutation"]);
    const { id } = await ext.chat.appendMessage(WEIR, { role: "system", content: "SYS-1 The tide turns." });
    expect(weirRow(bed, id)).toMatchObject({ is_user: 0, name: "System", content: "SYS-1 The tide turns.", index_in_chat: 4 });
    expect(JSON.parse(String(weirRow(bed, id).extra))).toEqual({ spindle_role: "system" });
    // Read back as the role: by RPE's database reader, by its reads through Lumiverse's routes, and by the rows the stand-in lists.
    const database = createDbReader({ path: bed.db.path, user: MARA, sleep: async () => undefined, log: () => undefined });
    weirClosing.push(() => database.close());
    const http = createHttpReads(bed.as(MARA).session);
    expect((await database.messagesById(WEIR, [id])).map((m) => m.role)).toEqual(["system"]);
    expect((await http.messagesById(WEIR, [id])).map((m) => m.role)).toEqual(["system"]);
    expect(bed.host.rowsOf(WEIR)?.at(-1)).toMatchObject({ id, role: "system" });
    // The others of the chat keep the roles they had.
    expect((await http.messagesById(WEIR, ["m0", "m1"])).map((m) => m.role)).toEqual(["assistant", "user"]);
  });

  test("a user's and an assistant's message are written with their role marked too, under the name Lumiverse gives them, and an assistant's may name only a character the user has", async () => {
    const bed = await weirOf(weirClosing, LINES);
    const ext = bed.host.install(["chat_mutation"]);
    const said = await ext.chat.appendMessage(WEIR, { role: "user", content: "USER-3 I wait." });
    const replied = await ext.chat.appendMessage(WEIR, { role: "assistant", content: "REPLY-2 Ilsa waits too.", name: "Ilsa" });
    expect(weirRow(bed, said.id)).toMatchObject({ is_user: 1, name: "User" });
    expect(JSON.parse(String(weirRow(bed, said.id).extra))).toEqual({ spindle_role: "user" });
    expect(weirRow(bed, replied.id)).toMatchObject({ is_user: 0, name: "Ilsa" });
    expect(JSON.parse(String(weirRow(bed, replied.id).extra))).toEqual({ spindle_role: "assistant" });
    await expect(ext.chat.appendMessage(WEIR, { role: "system", content: "SYS-2", characterId: "char-ilsa" })).rejects.toThrow("Invalid message character");
    await expect(ext.chat.appendMessage(WEIR, { role: "assistant", content: "REPLY-3", characterId: "char-none" })).rejects.toThrow("Invalid message character");
  });

  test("an extension without `chat_mutation` writes nothing, and one installed for another user reaches no chat of this user's", async () => {
    const bed = await weirOf(weirClosing, LINES);
    await expect(bed.host.install([]).chat.appendMessage(WEIR, { role: "system", content: "SYS-3" })).rejects.toThrow("Permission denied: chat_mutation");
    await expect(bed.host.install(["chat_mutation"], "pell-reeds", { scope: "user", installedBy: OTHER }).chat.appendMessage(WEIR, { role: "system", content: "SYS-4" })).rejects.toThrow("Extension is user-scoped and cannot access this user context");
    await expect(bed.host.install(["chat_mutation"]).chat.appendMessage("no-chat", { role: "system", content: "SYS-5" })).rejects.toThrow("Chat not found");
    expect(bed.db.rows("SELECT id FROM messages WHERE chat_id = ?", WEIR)).toHaveLength(4);
  });
});
