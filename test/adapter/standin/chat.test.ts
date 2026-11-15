// A chat's changes as the stand-in Lumiverse makes them, held to Lumiverse's own chat service (staging at a70f4ed2; paths are Lumiverse's
// `src/`): a swipe deleted (`chats.service.ts:3386-3453`), a message hidden and shown again, by the player and by an extension (`:3087-3132`;
// `spindle/worker-host.ts:4364-4448`), a message inserted before another (`:2638-2683`), an update that replaces `extra` (`:2922-3033`) and
// a branch (`:3506-3635`), each in the rows it writes and the events it tells. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { CHAT, json, LINES, OTHER, USER, weirChat as weirChatOf, type Weir } from "./weir";
import type { Chat } from "../../standin/rows";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const weirChat = (): Promise<Weir & { asked(): number }> => weirChatOf(closing, LINES);

/** The payloads of the events of one name told since the count `from`. */
function told(bed: Weir, name: string, from = 0): Record<string, unknown>[] {
  return bed.host.events.slice(from).filter((e) => e.event === name).map((e) => e.payload as Record<string, unknown>);
}

const row = (bed: Weir, id: string): Record<string, unknown> => bed.db.rows("SELECT * FROM messages WHERE id = ?", id)[0]!;
const extraOf = (bed: Weir, id: string): Record<string, unknown> => JSON.parse(String(row(bed, id).extra)) as Record<string, unknown>;
const chatOf = (bed: Weir, id = CHAT): Chat => bed.host.chats.get(id)!;
const swipesOf = (bed: Weir, id: string): string[] => JSON.parse(String(row(bed, id).swipes)) as string[];

/** The message "m2" with four swipes, the third shown, each with a thinking of its own. */
function swiped(bed: Weir): void {
  bed.host.updateMessage(CHAT, "m2", { swipes: ["s0", "s1", "s2", "s3"], swipe_id: 2, extra: { reasoningBySwipe: ["r0", "r1", "r2", "r3"], note: "kept" } });
}

describe("a swipe deleted (`services/chats.service.ts:3386-3453`)", () => {
  test("deleting a swipe shifts the later ones down", async () => {
    const bed = await weirChat();
    swiped(bed);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 2, content: "s2" });
    const from = bed.host.events.length;
    // A swipe before the one shown: the one shown keeps its text, one place lower, and the later ones are shifted down with it.
    expect(bed.host.deleteSwipe(CHAT, "m2", 0)).toBe(true);
    expect(swipesOf(bed, "m2")).toEqual(["s1", "s2", "s3"]);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 1, content: "s2" });
    expect(JSON.parse(String(row(bed, "m2").swipe_dates)) as number[]).toHaveLength(3);
    expect(extraOf(bed, "m2")).toEqual({ reasoningBySwipe: ["r1", "r2", "r3"], note: "kept" });
    const [event] = told(bed, "MESSAGE_SWIPED", from) as { chatId: string; action: string; swipeId: number; previousSwipeId: number; message: { swipe_id: number; content: string; swipes: string[]; extra: { reasoning: string } } }[];
    expect(told(bed, "MESSAGE_SWIPED", from)).toHaveLength(1);
    expect(event).toMatchObject({ chatId: CHAT, action: "deleted", swipeId: 0, previousSwipeId: 2, message: { swipe_id: 1, content: "s2", swipes: ["s1", "s2", "s3"], extra: { reasoning: "r2" } } });
    expect(chatOf(bed).messages.find((m) => m.id === "m2")).toMatchObject({ swipeId: 1, content: "s2" });
  });

  test("a swipe after the one shown leaves it; the one shown deleted goes to the swipe named, else the nearest, the last where there is no next", async () => {
    const bed = await weirChat();
    swiped(bed);
    expect(bed.host.deleteSwipe(CHAT, "m2", 3)).toBe(true);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 2, content: "s2" });
    expect(swipesOf(bed, "m2")).toEqual(["s0", "s1", "s2"]);
    expect(extraOf(bed, "m2").reasoningBySwipe).toEqual(["r0", "r1", "r2"]);
    // The shown swipe is the last: the nearest is the one before it, now the last.
    expect(bed.host.deleteSwipe(CHAT, "m2", 2)).toBe(true);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 1, content: "s1" });
    // Shown swipe 1 of [s0, s1]: the swipe named is shown, one that is not there is passed over for the nearest.
    bed.host.updateMessage(CHAT, "m2", { swipes: ["s0", "s1", "s2"], swipe_id: 1 });
    expect(bed.host.deleteSwipe(CHAT, "m2", 1, { restoreSwipeId: 0 })).toBe(true);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 0, content: "s0" });
    bed.host.updateMessage(CHAT, "m2", { swipes: ["s0", "s1", "s2"], swipe_id: 0 });
    expect(bed.host.deleteSwipe(CHAT, "m2", 0, { restoreSwipeId: 7 })).toBe(true);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 0, content: "s1" });
  });

  test("the last swipe is kept, and a swipe that is not there is not deleted; neither is told", async () => {
    const bed = await weirChat();
    const from = bed.host.events.length;
    expect(bed.host.deleteSwipe(CHAT, "m2", 0)).toBe(false);
    swiped(bed);
    const edited = bed.host.events.length;
    expect(bed.host.deleteSwipe(CHAT, "m2", 4)).toBe(false);
    expect(bed.host.deleteSwipe(CHAT, "m2", -1)).toBe(false);
    expect(told(bed, "MESSAGE_SWIPED", edited)).toEqual([]);
    expect(told(bed, "MESSAGE_SWIPED", from)).toEqual([]);
    expect(swipesOf(bed, "m2")).toEqual(["s0", "s1", "s2", "s3"]);
    expect(() => bed.host.deleteSwipe(CHAT, "no-such", 0)).toThrow("the stand-in has no such message");
  });

  test("a user's message whose shown text changed has its revision raised, an assistant's has not", async () => {
    const bed = await weirChat();
    bed.host.updateMessage(CHAT, "m3", { swipes: ["u0", "u1"], swipe_id: 0 });
    const user = Number(row(bed, "m3").revision);
    expect(bed.host.deleteSwipe(CHAT, "m3", 0)).toBe(true);
    expect(Number(row(bed, "m3").revision)).toBe(user + 1);
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a0", "a1"], swipe_id: 0 });
    const assistant = Number(row(bed, "m2").revision);
    expect(bed.host.deleteSwipe(CHAT, "m2", 0)).toBe(true);
    expect(Number(row(bed, "m2").revision)).toBe(assistant);
  });
});

describe("a message hidden and shown again after it was made (`services/chats.service.ts:3087-3132`)", () => {
  test("a message hidden and shown again after it was made", async () => {
    const bed = await weirChat();
    const ext = bed.host.install(["chat_mutation"]);
    const from = bed.host.events.length;
    await ext.chat.setMessageHidden(CHAT, "m1", true);
    expect(extraOf(bed, "m1").hidden).toBe(true);
    expect(chatOf(bed).messages.find((m) => m.id === "m1")?.hidden).toBe(true);
    expect(await ext.chat.isMessageHidden(CHAT, "m1")).toBe(true);
    expect(await ext.chat.isMessageHidden(CHAT, "m0")).toBe(false);
    expect(told(bed, "MESSAGE_EDITED", from)).toHaveLength(1);
    expect(told(bed, "MESSAGE_EDITED", from)[0]).toMatchObject({ chatId: CHAT, message: { id: "m1", extra: { hidden: true } } });
    // Nothing else of the row changes: not its text, its swipes or its revision.
    expect(row(bed, "m1")).toMatchObject({ content: "USER-1 I lower the lantern.", revision: 1, swipe_id: 0 });
    const second = bed.host.events.length;
    await ext.chat.setMessagesHidden(CHAT, ["m1", "m2", "no-such"], true);
    expect(told(bed, "MESSAGE_EDITED", second).map((e) => (e.message as { id: string }).id)).toEqual(["m1", "m2"]);
    await ext.chat.setMessagesHidden(CHAT, ["m1", "m2"], false);
    expect(extraOf(bed, "m1")).toEqual({});
    expect(extraOf(bed, "m2")).toEqual({});
    expect(await ext.chat.isMessageHidden(CHAT, "m1")).toBe(false);
    expect(chatOf(bed).messages.some((m) => m.hidden === true)).toBe(false);
  });

  test("the extension's `chat` calls are refused without `chat_mutation`, past 500 messages, for a chat or a message that is not there, and for another user's chat by a user-scoped extension", async () => {
    const bed = await weirChat();
    const none = bed.host.install([]);
    await expect(none.chat.setMessageHidden(CHAT, "m1", true)).rejects.toThrow("Permission denied: chat_mutation");
    await expect(none.chat.setMessagesHidden(CHAT, ["m1"], true)).rejects.toThrow("Permission denied: chat_mutation");
    await expect(none.chat.isMessageHidden(CHAT, "m1")).rejects.toThrow("Permission denied: chat_mutation");
    const ext = bed.host.install(["chat_mutation"]);
    await expect(ext.chat.setMessageHidden("no-chat", "m1", true)).rejects.toThrow("Chat not found");
    await expect(ext.chat.setMessageHidden(CHAT, "no-message", true)).rejects.toThrow("Message not found");
    await expect(ext.chat.isMessageHidden(CHAT, "no-message")).rejects.toThrow("Message not found");
    await expect(ext.chat.setMessagesHidden(CHAT, Array.from({ length: 501 }, (_, i) => `m${i}`), true)).rejects.toThrow("Maximum 500 messages per batch");
    const theirs = bed.host.install(["chat_mutation"], "pell-reeds", { scope: "user", installedBy: OTHER });
    await expect(theirs.chat.setMessageHidden(CHAT, "m1", true)).rejects.toThrow("Extension is user-scoped and cannot access this user context");
    const mine = bed.host.install(["chat_mutation"], "mara-reeds", { scope: "user", installedBy: USER });
    await mine.chat.setMessageHidden(CHAT, "m1", true);
    expect(extraOf(bed, "m1").hidden).toBe(true);
    expect(extraOf(bed, "m0")).toEqual({});
  });

  test("hiding the message the history is cut at takes the cut out of the chat's metadata, told before the edits", async () => {
    const bed = await weirChat();
    const ext = bed.host.install(["chat_mutation"]);
    bed.host.mergeChatMetadata(chatOf(bed), { context_history_anchor_message_id: "m2", pinned: "kept" });
    const from = bed.host.events.length;
    await ext.chat.setMessageHidden(CHAT, "m1", true);
    expect(told(bed, "CHAT_CHANGED", from)).toEqual([]);
    await ext.chat.setMessageHidden(CHAT, "m2", true);
    const metadata = JSON.parse(String(bed.db.rows("SELECT metadata FROM chats WHERE id = ?", CHAT)[0]!.metadata)) as Record<string, unknown>;
    expect(metadata).toEqual({ pinned: "kept" });
    expect(told(bed, "CHAT_CHANGED", from)).toMatchObject([{ changedFields: ["metadata.context_history_anchor_message_id"] }]);
    const order = bed.host.events.slice(from).map((e) => e.event);
    expect(order.indexOf("CHAT_CHANGED")).toBeLessThan(order.lastIndexOf("MESSAGE_EDITED"));
  });
});

describe("a message inserted before another (`services/chats.service.ts:2638-2683`)", () => {
  test("an insertion moves the later places and numbers", async () => {
    const bed = await weirChat();
    const from = bed.host.events.length;
    const id = bed.host.createMessage(CHAT, { role: "assistant", content: "INSERT-1 The lantern gutters.", before: "m2" });
    const rows = bed.db.rows("SELECT id, index_in_chat, revision FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT);
    expect(rows.map((r) => [r.id, r.index_in_chat, r.revision])).toEqual([["m0", 0, 1], ["m1", 1, 1], [id, 2, 1], ["m2", 3, 2], ["m3", 4, 2]]);
    expect(chatOf(bed).messages.map((m) => m.id)).toEqual(["m0", "m1", id, "m2", "m3"]);
    expect(told(bed, "MESSAGE_SENT", from)).toMatchObject([{ chatId: CHAT, inserted: true, message: { id, index_in_chat: 2, content: "INSERT-1 The lantern gutters." } }]);
    expect(bed.host.rowsOf(CHAT)?.map((r) => [r.id, r.index])).toEqual([["m0", 0], ["m1", 1], [id, 2], ["m2", 3], ["m3", 4]]);
    // A message made after goes one past the highest and is not told as inserted.
    const last = bed.host.reply(CHAT, "REPLY-2 The water settles.");
    expect(row(bed, last).index_in_chat).toBe(5);
    expect(told(bed, "MESSAGE_SENT", from).at(-1)).not.toHaveProperty("inserted");
  });

  test("a target that is not in the chat refuses the insertion and changes nothing", async () => {
    const bed = await weirChat();
    expect(() => bed.host.createMessage(CHAT, { role: "user", content: "LOST", before: "no-such" })).toThrow("Insertion target is not in this chat");
    expect(bed.db.rows("SELECT id FROM messages WHERE chat_id = ?", CHAT)).toHaveLength(4);
    expect(chatOf(bed).messages).toHaveLength(4);
  });

  test("a message added mid-list takes the number an insertion would", async () => {
    const bed = await weirChat();
    chatOf(bed).messages.splice(2, 0, { id: "mid", role: "user", content: "MID-1 I tie the boat." });
    // Never one past the highest: the list's order and the numbers' order agree, and the rows of the later messages moved up with them.
    expect(bed.host.rowsOf(CHAT)?.map((r) => [r.id, r.index])).toEqual([["m0", 0], ["m1", 1], ["mid", 2], ["m2", 3], ["m3", 4]]);
    expect(bed.db.rows("SELECT id, index_in_chat FROM messages ORDER BY index_in_chat").map((r) => [r.id, r.index_in_chat])).toEqual([["m0", 0], ["m1", 1], ["m2", 3], ["m3", 4]]);
  });
});

describe("an update (`services/chats.service.ts:2922-3033`, `:638-652`, `:2985-2994`)", () => {
  test("an update replaces extra, keeping only variableStateBySwipe and the per-swipe lists", async () => {
    const bed = await weirChat();
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b"], swipe_id: 1 });
    bed.db.run("UPDATE messages SET extra = ? WHERE id = ?", json({ flavour: "salt", other: 1, reasoningBySwipe: [null, "think-b"], variableStateBySwipe: [{ v: 1 }, { v: 2 }] }), "m2");
    const revision = Number(row(bed, "m2").revision);
    const from = bed.host.events.length;
    // The variable records are the host's: an `extra` sent back cannot replace them.
    bed.host.updateMessage(CHAT, "m2", { extra: { flavour: "pepper", variableStateBySwipe: [{ evil: true }] } });
    expect(extraOf(bed, "m2")).toEqual({ flavour: "pepper", reasoningBySwipe: [null, "think-b"], variableStateBySwipe: [{ v: 1 }, { v: 2 }] });
    expect(Number(row(bed, "m2").revision)).toBe(revision + 1);
    expect(told(bed, "MESSAGE_EDITED", from)).toMatchObject([{ message: { id: "m2", extra: { flavour: "pepper", reasoning: "think-b" } } }]);
    expect(told(bed, "SWIPE_EDITED", from)).toEqual([]);
  });

  test("a swipe list written tells `SWIPE_EDITED` with the swipe that was shown, the dates made to fit and the lists cut or padded to the swipes", async () => {
    const bed = await weirChat();
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b"], swipe_id: 1 });
    bed.db.run("UPDATE messages SET extra = ? WHERE id = ?", json({ reasoningBySwipe: [null, "think-b"], variableStateBySwipe: [{ v: 1 }, { v: 2 }, { v: 3 }] }), "m2");
    const from = bed.host.events.length;
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b", "c"] });
    expect(JSON.parse(String(row(bed, "m2").swipe_dates)) as number[]).toHaveLength(3);
    expect(extraOf(bed, "m2")).toEqual({ reasoningBySwipe: [null, "think-b", null], variableStateBySwipe: [{ v: 1 }, { v: 2 }, { v: 3 }] });
    expect(told(bed, "MESSAGE_EDITED", from)).toHaveLength(1);
    expect(told(bed, "SWIPE_EDITED", from)).toMatchObject([{ chatId: CHAT, previousSwipeId: 1, message: { id: "m2", swipe_id: 1, swipes: ["a", "b", "c"] } }]);
    // Cut to two: the lists follow.
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b"] });
    expect(extraOf(bed, "m2")).toEqual({ reasoningBySwipe: [null, "think-b"], variableStateBySwipe: [{ v: 1 }, { v: 2 }] });
    expect(JSON.parse(String(row(bed, "m2").swipe_dates)) as number[]).toHaveLength(2);
  });

  test("the text goes to the swipe named or the one shown; a swipe out of range, a swipe list that is empty and an input naming nothing are refused or tell nothing", async () => {
    const bed = await weirChat();
    bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b"], swipe_id: 1 });
    bed.host.updateMessage(CHAT, "m2", { content: "named", contentSwipeId: 0 });
    expect(swipesOf(bed, "m2")).toEqual(["named", "b"]);
    expect(row(bed, "m2")).toMatchObject({ swipe_id: 1, content: "b" });
    bed.host.updateMessage(CHAT, "m2", { content: "shown" });
    expect(swipesOf(bed, "m2")).toEqual(["named", "shown"]);
    expect(row(bed, "m2").content).toBe("shown");
    expect(() => bed.host.updateMessage(CHAT, "m2", { swipe_id: 9 })).toThrow("updateMessage: swipe_id out of range");
    expect(() => bed.host.updateMessage(CHAT, "m2", { swipes: [] })).toThrow("updateMessage: swipes must be non-empty");
    expect(() => bed.host.updateMessage(CHAT, "m2", { swipes: ["a", "b"], swipe_dates: [1] })).toThrow("updateMessage: swipes and swipe_dates length mismatch");
    const from = bed.host.events.length;
    const revision = Number(row(bed, "m2").revision);
    bed.host.updateMessage(CHAT, "m2", {});
    expect(bed.host.events.length).toBe(from);
    expect(Number(row(bed, "m2").revision)).toBe(revision);
  });

  test("the player's edit through the message route puts a fresh tokenCount in the extra for a model with a tokenizer, and leaves the stored one where there is none", async () => {
    const bed = await weirChat();
    bed.host.tokenizedModels.add("model");
    bed.host.editMessage(CHAT, "m1", "twelve chars", { connection: "conn-model" });
    expect(extraOf(bed, "m1")).toEqual({ tokenCountBySwipe: [3] });
    expect(told(bed, "MESSAGE_EDITED").at(-1)).toMatchObject({ message: { id: "m1", content: "twelve chars", extra: { tokenCount: 3 } } });
    // No connection, so no tokenizer: the count stored before stays as it was.
    bed.host.editMessage(CHAT, "m1", "twelve chars and some more");
    expect(extraOf(bed, "m1")).toEqual({ tokenCountBySwipe: [3] });
    expect(row(bed, "m1")).toMatchObject({ content: "twelve chars and some more", revision: 3 });
    bed.host.editMessage(CHAT, "m1", "a longer line of words here", { connection: "conn-model" });
    expect(extraOf(bed, "m1")).toEqual({ tokenCountBySwipe: [7] });
  });
});

describe("a branch (`services/chats.service.ts:3506-3635`)", () => {
  test("a branch as Lumiverse copies it", async () => {
    const bed = await weirChat();
    bed.host.mergeChatMetadata(chatOf(bed), { context_history_anchor_message_id: "m1", pinned: "kept" });
    bed.host.updateMessage(CHAT, "m2", { extra: { flavour: "salt" } });
    bed.db.run("UPDATE messages SET parent_message_id = 'm0' WHERE id = 'm1'");
    const from = bed.host.events.length;
    const forked = bed.host.branch(CHAT, "m2");
    expect(forked).not.toBeNull();
    const chat = bed.db.rows("SELECT * FROM chats WHERE id = ?", forked!)[0]!;
    expect(chat).toMatchObject({ user_id: USER, character_id: "char-ilsa", name: "Ilsa — Branch at #2" });
    const copies = bed.db.rows("SELECT * FROM messages WHERE chat_id = ? ORDER BY index_in_chat", forked!);
    const originals = bed.db.rows("SELECT * FROM messages WHERE chat_id = ? AND index_in_chat <= 2 ORDER BY index_in_chat", CHAT);
    expect(copies).toHaveLength(3);
    expect(copies.map((c) => c.index_in_chat)).toEqual([0, 1, 2]);
    expect(copies.map((c) => [c.is_user, c.name, c.content, c.swipes, c.swipe_dates, c.swipe_id])).toEqual(originals.map((o) => [o.is_user, o.name, o.content, o.swipes, o.swipe_dates, o.swipe_id]));
    expect(copies.map((c) => c.extra)).toEqual(originals.map((o) => o.extra));
    const ids = copies.map((c) => String(c.id));
    expect(new Set([...ids, "m0", "m1", "m2"]).size).toBe(6);
    const branch = String(copies[0]!.branch_id);
    expect(branch).not.toBe("");
    expect(copies.map((c) => c.branch_id)).toEqual([branch, branch, branch]);
    expect(copies[1]!.parent_message_id).toBe(ids[0]!);
    expect(copies[0]!.parent_message_id).toBeNull();
    // The cut of the history is where its message was copied; the branch is told where it came from.
    expect(JSON.parse(String(chat.metadata))).toEqual({ context_history_anchor_message_id: ids[1]!, pinned: "kept", branched_from: CHAT, branch_at_message: "m2" });
    expect(told(bed, "CHAT_FORKED", from)).toMatchObject([
      { sourceChatId: CHAT, forkedChatId: forked, branchId: branch, forkedAtMessageId: "m2", forkedAtMessageIndex: 2, messageIdMap: { m0: ids[0]!, m1: ids[1]!, m2: ids[2]! }, chat: { id: forked, name: "Ilsa — Branch at #2" } },
    ]);
    // Held as a chat of its own, the source untouched.
    expect(chatOf(bed, forked!).messages.map((m) => [m.id, m.content])).toEqual(copies.map((c) => [String(c.id), String(c.content)]));
    expect(chatOf(bed).messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(bed.db.rows("SELECT id FROM messages WHERE chat_id = ?", CHAT)).toHaveLength(4);
  });

  test("a branch named by the player keeps its name; one not named is numbered where the name is taken; a cut of the history after the branch point is dropped", async () => {
    const bed = await weirChat();
    bed.host.mergeChatMetadata(chatOf(bed), { context_history_anchor_message_id: "m3" });
    const first = bed.host.branch(CHAT, "m1");
    const second = bed.host.branch(CHAT, "m1");
    const own = bed.host.branch(CHAT, "m1", "  The weir, a night later ");
    const name = (id: string | null): unknown => bed.db.rows("SELECT name FROM chats WHERE id = ?", id!)[0]!.name;
    expect([name(first), name(second), name(own)]).toEqual(["Ilsa — Branch at #1", "Ilsa — Branch at #1 (2)", "The weir, a night later"]);
    expect(JSON.parse(String(bed.db.rows("SELECT metadata FROM chats WHERE id = ?", first!)[0]!.metadata))).toEqual({ branched_from: CHAT, branch_at_message: "m1" });
    // A branch of a branch is named for the chat it was made from, without the "Branch" it carries.
    const again = bed.host.branch(first!, bed.db.rows("SELECT id FROM messages WHERE chat_id = ? AND index_in_chat = 0", first!)[0]!.id as string);
    expect(name(again)).toBe("Ilsa — Branch at #0");
    expect(bed.host.branch(CHAT, "no-such")).toBeNull();
    expect(bed.host.branch("no-chat", "m1")).toBeNull();
  });
});
