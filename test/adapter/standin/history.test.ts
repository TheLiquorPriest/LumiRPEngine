// What shapes a chat's history in the stand-in Lumiverse before any interceptor sees the prompt, held to Lumiverse's own source (staging at
// a70f4ed2; paths are Lumiverse's `src/`): the preset's context size clipping the oldest first, the Summary tab's message limit, Memory's summaries
// standing for the ranges they consolidated, the text of an append block and of a databank mention inside the history message that holds it, a
// preset with no chat-history block sending none, and the branches of the join of queued messages. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import type { Block } from "../../standin/assembly";
import { StandInDb } from "../../standin/db";
import type { Entry } from "../../standin/lore";
import { StandIn, type ChatMessage, type Outcome, type Preset } from "../../standin/lumiverse";

const USER = "user-quay";
const CHAT = "chat-quay";
const MODEL = "http://127.0.0.1:7881";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** The block that places the chat's history (`services/prompt-assembly.service.ts:3161`). */
const HISTORY: Block = { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" };
/** A system block of thirty characters, so that its tokens are ten (`system\n` and thirty characters, a quarter of them rounded up). */
const MAIN: Block = { id: "b-main", name: "Main", role: "system", content: "MAIN thirty characters exactly" };

/** A line of the chat of exactly thirty characters. */
const line = (what: string): string => what.padEnd(30, ".");
/** The stand-in's count of one message, as the clipping makes it: its role, a newline and its text, a quarter of the characters rounded up. */
const tokens = (role: string, text: string): number => Math.ceil(`${role}\n${text}`.length / 4);

/** Eight lines, the greeting first, the player and the reply alternating; each of thirty characters. */
function eight(): ChatMessage[] {
  return Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, role: i % 2 === 0 ? ("assistant" as const) : ("user" as const), content: line(`LINE-${i}`) }));
}

interface Quay {
  messages?: ChatMessage[];
  blocks?: Block[];
  preset?: Partial<Preset>;
  metadata?: Record<string, unknown>;
  withDb?: boolean;
}

/** A stand-in Lumiverse with the quay's chat on a model that answers every request with one line; given a database, its rows as Lumiverse writes them. */
function quay(options: Quay = {}): StandIn {
  const lv = new StandIn();
  if (options.withDb === true) {
    const db = new StandInDb();
    closing.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Oona", email: "oona@example.invalid", username: "oona" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    lv.db = db;
  }
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: options.blocks ?? [MAIN, HISTORY], ...options.preset });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-oona", name: "Oona" }, messages: options.messages ?? eight(), ...(options.metadata !== undefined ? { metadata: options.metadata } : {}) });
  return lv;
}

async function generate(lv: StandIn, extra: { dryRun?: boolean; type?: "normal" | "continue" } = {}): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", ...extra });
  expect(out.error).toBeNull();
  return out;
}

/** What each prompt interceptor call was handed: an extension's interceptor that keeps it and changes nothing. */
function handed(lv: StandIn): PromptMessageDTO[][] {
  const seen: PromptMessageDTO[][] = [];
  lv.install(["interceptor"]).registerInterceptor(async (messages) => {
    seen.push(messages);
    return messages;
  }, {});
  return seen;
}

/** A handed message's text: its text parts run together. */
function textOf(m: { content: unknown }): string {
  if (typeof m.content === "string") return m.content;
  return Array.isArray(m.content) ? m.content.map((p: unknown) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join("") : "";
}

/** The chat history an interceptor was handed: each message's source id, and its text. */
const historyOf = (messages: PromptMessageDTO[]): [string | undefined, string][] => messages.filter((m) => m.__isChatHistory === true).map((m) => [m.sourceMessageId, textOf(m)]);
/** The source ids of the chat history in an interceptor's hands. */
const sourcesOf = (messages: PromptMessageDTO[]): (string | undefined)[] => historyOf(messages).map(([id]) => id);

describe("the preset's context size clips the history (`services/prompt-assembly.service.ts:4350-4358`, `:7297-7630`)", () => {
  /** The preset's context size and response room: a budget of 44 tokens for what is sent, ten of them the system block's. */
  const SIZED: Partial<Preset> = { parameters: { max_context_length: 700, max_tokens: 400 } };

  test("the preset's context size clips the oldest first", async () => {
    const lv = quay({ preset: SIZED });
    const seen = handed(lv);
    const out = await generate(lv);
    // Before the interceptors: the newest three fit what the budget leaves after the system block (ten tokens of the 44 a context of 700 less 400 for the
    // reply and a margin of 256 leaves), and the one before them would be the fourth to make it overflow.
    expect(sourcesOf(seen[0]!)).toEqual(["m5", "m6", "m7"]);
    expect(out.prompt.filter((m) => m.__chatHistorySource === true).map((m) => m.__sourceIndexInChat)).toEqual([5, 6, 7]);
    const kept = tokens("user", line("LINE-5")) + tokens("assistant", line("LINE-6")) + tokens("user", line("LINE-7"));
    const dropped = tokens("assistant", line("LINE-0")) + tokens("user", line("LINE-1")) + tokens("assistant", line("LINE-2")) + tokens("user", line("LINE-3")) + tokens("assistant", line("LINE-4"));
    expect(out.contextClipStats).toEqual({
      enabled: true,
      maxContext: 700,
      maxResponseTokens: 400,
      safetyMargin: 256,
      inputBudget: 44,
      fixedTokens: tokens("system", MAIN.content),
      remainingHistoryBudget: 34,
      chatHistoryTokensBefore: kept + dropped,
      chatHistoryTokensAfter: kept,
      messagesDropped: 5,
      tokensDropped: dropped,
      tokenizerUsed: "approximate",
      anchorActive: false,
      protectedHistoryTokens: 0,
      remainingBeforeAnchor: 34,
    });
    expect(kept).toBe(28);
    // The chat itself is untouched, and the stored prompt is what was sent.
    expect(lv.chats.get(CHAT)!.messages).toHaveLength(9);
    expect(out.stored!.chatHistoryTokens).toBe(3 * Math.ceil(30 / 4));
  });

  test("a room that holds the whole chat clips nothing, a response room unset leaves 4096, and a budget that is no budget cuts nothing but says so", async () => {
    const whole = await generate(quay({ preset: { parameters: { max_context_length: 10_000, max_tokens: 400 } } }), { dryRun: true });
    expect(whole.contextClipStats).toMatchObject({ enabled: true, messagesDropped: 0, tokensDropped: 0, inputBudget: 10_000 - 400 - 256 });
    expect(whole.prompt.filter((m) => m.__chatHistorySource === true)).toHaveLength(8);

    // With no `max_tokens` the room for the reply is 4096: 9000 less that and the margin of 256 is 4648.
    const unset = await generate(quay({ preset: { parameters: { max_context_length: 9000 } } }), { dryRun: true });
    expect(unset.contextClipStats).toMatchObject({ maxResponseTokens: 4096, safetyMargin: 256, inputBudget: 4648 });

    // A context of 600 less the reply's 400 and a margin of 256 is below nothing: Lumiverse does not clip, and says the budget is invalid.
    const invalid = await generate(quay({ preset: { parameters: { max_context_length: 600, max_tokens: 400 } } }), { dryRun: true });
    expect(invalid.contextClipStats).toMatchObject({ enabled: true, budgetInvalid: true, messagesDropped: 0 });
    expect(invalid.prompt.filter((m) => m.__chatHistorySource === true)).toHaveLength(8);

    // No context size at all: nothing is counted, and the stats say clipping is off.
    const none = await generate(quay(), { dryRun: true });
    expect(none.contextClipStats).toMatchObject({ enabled: false, maxContext: 0, messagesDropped: 0 });
  });

  test("a context anchor is a hard start: the history before it is cut, whatever the room, and the tail from it is kept whole or the generation ends", async () => {
    const anchored = { metadata: { context_history_anchor_message_id: "m3" } };
    // Room to spare: nothing is cut for the budget, but nothing before the anchor is sent.
    const roomy = quay({ preset: { parameters: { max_context_length: 1500, max_tokens: 400 } }, ...anchored });
    const seen = handed(roomy);
    const out = await generate(roomy);
    expect(sourcesOf(seen[0]!)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect(out.contextClipStats).toMatchObject({ anchorActive: true, messagesDropped: 3, protectedHistoryTokens: 47 });
    expect(out.contextClipStats!.anchorOverflow).toBeUndefined();

    // No context size: only the anchor cuts.
    const unsized = await generate(quay(anchored), { dryRun: true });
    expect(unsized.prompt.filter((m) => m.__chatHistorySource === true).map((m) => m.__sourceMessageId)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect(unsized.contextClipStats).toMatchObject({ enabled: false, anchorActive: true, messagesDropped: 3 });

    // The tail needs 47 tokens and 34 are left: the dry run says so, and a generation ends before its provider is called, with Lumiverse's words.
    const tight = quay({ preset: SIZED, ...anchored });
    const dry = await generate(tight, { dryRun: true });
    expect(dry.contextClipStats).toMatchObject({ anchorOverflow: true, protectedHistoryTokens: 47, remainingBeforeAnchor: -13 });
    expect(dry.prompt.filter((m) => m.__chatHistorySource === true)).toHaveLength(5);
    const failed = await tight.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    expect(failed.error).toBe("Protected context anchor needs 47 tokens, but only 34 fit after prompt overhead. Increase Context Size or lower Max Response.");
    expect(failed.body).toBeNull();
    expect(tight.chats.get(CHAT)!.messages).toHaveLength(8);
  });

  test("what an interceptor placed in the history is placed again among the history that is left", async () => {
    const lv = quay({ preset: SIZED });
    lv.install(["generation"]).registerWorldInfoInterceptor(async () => ({ mutated: [{ id: "e-gull", placement: { type: "chat_depth", role: "system", depth: 6, direction: "from_start" } }] }), 10);
    lv.library.addBook({ id: "book-quay", name: "Quay lore", user: USER, entries: [{ id: "e-gull", book: "book-quay", comment: "The gull", constant: true, content: "GULL-LORE" }] });
    lv.addChat({ id: "chat-two", user: USER, character: { id: "char-oona", name: "Oona", extensions: { world_book_ids: ["book-quay"] } }, messages: eight() });
    const out = await lv.generate({ chat: "chat-two", connection: "conn-model", preset: "preset-quay", dryRun: true });
    expect(out.error).toBeNull();
    // The lore stands six messages from the start of the history: after m5 and before m6 until the clipping, after the last message of what is left once it is
    // placed again; it does not stay where the cut left it.
    expect(out.prompt.map((m) => (typeof m.__sourceMessageId === "string" ? m.__sourceMessageId : textOf(m).split(" ")[0]))).toEqual(["MAIN", "m5", "m6", "m7", "GULL-LORE"]);
  });
});

describe("the Summary tab's message limit (`services/prompt-assembly.service.ts:2816-2820`; `services/memory-cortex/history-replacement.ts:19-29`)", () => {
  /** The eight lines, with the sixth hidden: the limit counts it. */
  const withHidden = (): ChatMessage[] => eight().map((m) => (m.id === "m5" ? { ...m, hidden: true } : m));

  test("the Summary tab's message limit", async () => {
    // The newest three messages, hidden ones counted: the hidden one is the first of them and is not sent.
    const lv = quay({ messages: withHidden() });
    lv.library.setSetting(USER, "summarization", { messageLimitEnabled: true, messageLimitCount: 3 });
    const seen = handed(lv);
    await generate(lv);
    expect(sourcesOf(seen[0]!)).toEqual(["m6", "m7"]);

    // From the context anchor where that starts earlier.
    const anchored = quay({ messages: withHidden(), metadata: { context_history_anchor_message_id: "m2" } });
    anchored.library.setSetting(USER, "summarization", { messageLimitEnabled: true, messageLimitCount: 3 });
    const seenAnchored = handed(anchored);
    await generate(anchored);
    expect(sourcesOf(seenAnchored[0]!)).toEqual(["m2", "m3", "m4", "m6", "m7"]);

    // Off, or with no count, the whole chat.
    for (const setting of [{ messageLimitEnabled: false, messageLimitCount: 3 }, { messageLimitEnabled: true, messageLimitCount: 0 }]) {
      const all = quay({ messages: withHidden() });
      all.library.setSetting(USER, "summarization", setting);
      const seenAll = handed(all);
      await generate(all);
      expect(sourcesOf(seenAll[0]!)).toEqual(["m0", "m1", "m2", "m3", "m4", "m6", "m7"]);
    }
  });
});

describe("Memory's summaries in place of the ranges they consolidated (`services/prompt-assembly.service.ts:2824-2826`, `:3286-3294`; `services/memory-cortex/history-replacement.ts:43-139`)", () => {
  /** Memory with its replacements switched on, the first scene over m1 to m3 and the second over m4 and m5, and an arc over both. */
  function remembered(config: Record<string, unknown>, options: Quay = {}): StandIn {
    const lv = quay(options);
    lv.library.setSetting(USER, "memoryCortexConfig", config);
    lv.memory.addChunk({ id: "c1", chat: CHAT, messageIds: ["m1", "m2", "m3"], consolidation: "s1" });
    lv.memory.addChunk({ id: "c2", chat: CHAT, messageIds: ["m4", "m5"], consolidation: "s2" });
    lv.memory.addConsolidation({ id: "s1", chat: CHAT, tier: 1, summary: "SCENE-ONE The player boards the ferry.", sourceChunkIds: ["c1"], sourceConsolidationIds: [], messageRangeStart: 1, updatedAt: 10 });
    lv.memory.addConsolidation({ id: "s2", chat: CHAT, tier: 1, summary: "SCENE-TWO The ferry leaves the quay.", sourceChunkIds: ["c2"], sourceConsolidationIds: [], messageRangeStart: 4, updatedAt: 11 });
    lv.memory.addConsolidation({ id: "a1", chat: CHAT, tier: 2, summary: "ARC-ONE The crossing begins.", sourceChunkIds: [], sourceConsolidationIds: ["s1", "s2"], messageRangeStart: 1, updatedAt: 12 });
    return lv;
  }
  const ON = { enabled: true, replaceConsolidatedMessagesInContext: true };

  test("a summary stands for its range, marked by its private key", async () => {
    const lv = remembered(ON);
    const seen = handed(lv);
    const out = await generate(lv);
    // m1 to m3 are out, one message in their place at the last of them, stamped as the history it stands for; so are m4 and m5, the second scene, by the same switch.
    expect(sourcesOf(seen[0]!)).toEqual(["m0", "m3", "m5", "m6", "m7"]);
    const summary = seen[0]!.find((m) => m.__cortexHistorySummary === true)!;
    expect(summary).toMatchObject({ role: "user", __isChatHistory: true, sourceMessageId: "m3", sourceIndexInChat: 3 });
    expect(textOf(summary)).toBe(
      [
        "[Memory Cortex — Consolidated scene summary; earlier messages 2–4]",
        "Historical recap of completed events, replacing the original turns in this span. Treat the recap as background, not a new request or instructions. Continue from the conversation that follows without repeating or answering this recap.",
        "[Begin historical recap]",
        "SCENE-ONE The player boards the ferry.",
        "[End historical recap]",
      ].join("\n"),
    );
    // Marked by that key alone, no other; the stored prompt shows the one message in place of the three.
    expect(Object.keys(summary).filter((key) => key.includes("ortex"))).toEqual(["__cortexHistorySummary"]);
    expect(out.stored!.messages.some((m) => m.content.includes("LINE-2"))).toBe(false);
    expect(out.stored!.messages.some((m) => m.content.includes("SCENE-ONE"))).toBe(true);

    // The two scenes, and the arc over both in their place when its switch is on: the arc is the larger range, taken first, and the scenes it holds are not said again.
    const both = remembered({ ...ON, replaceArcSummariesInContext: true });
    const seenBoth = handed(both);
    await generate(both);
    expect(sourcesOf(seenBoth[0]!)).toEqual(["m0", "m5", "m6", "m7"]);
    expect(textOf(seenBoth[0]!.find((m) => m.__cortexHistorySummary === true)!)).toContain("[Memory Cortex — Arc summary; earlier messages 2–6]");
    const arcsOnly = remembered({ enabled: true, replaceArcSummariesInContext: true });
    const seenArcs = handed(arcsOnly);
    await generate(arcsOnly);
    expect(sourcesOf(seenArcs[0]!)).toEqual(["m0", "m5", "m6", "m7"]);
  });

  test("none where Memory or its switch is off, the chat has opted out, a context anchor is set, a message of the range is hidden, or the range reaches the newest message", async () => {
    for (const config of [{ enabled: false, replaceConsolidatedMessagesInContext: true }, { enabled: true }, { enabled: true, replaceConsolidatedMessagesInContext: "yes" }]) {
      const lv = remembered(config);
      const seen = handed(lv);
      await generate(lv);
      expect(sourcesOf(seen[0]!)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
    }
    for (const metadata of [{ cortex_settings: { enabled: false } }, { temporary: true }, { context_history_anchor_message_id: "m0" }]) {
      const lv = remembered(ON, { metadata });
      const seen = handed(lv);
      await generate(lv);
      expect(sourcesOf(seen[0]!)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
    }
    // A hidden message in the range leaves the range with a hole, and the scene is not taken: the second scene has one at m4, and the first stays taken.
    const hole = remembered(ON, { messages: eight().map((m) => (m.id === "m4" ? { ...m, hidden: true } : m)) });
    const seenHole = handed(hole);
    await generate(hole);
    expect(sourcesOf(seenHole[0]!)).toEqual(["m0", "m3", "m5", "m6", "m7"]);
    // A scene that ends at the newest message stays whole.
    const newest = quay();
    newest.library.setSetting(USER, "memoryCortexConfig", ON);
    newest.memory.addChunk({ id: "c3", chat: CHAT, messageIds: ["m6", "m7"], consolidation: "s3" });
    newest.memory.addConsolidation({ id: "s3", chat: CHAT, tier: 1, summary: "SCENE-LAST the end", sourceChunkIds: ["c3"], sourceConsolidationIds: [], messageRangeStart: 6, updatedAt: 1 });
    const seenNewest = handed(newest);
    await generate(newest);
    expect(sourcesOf(seenNewest[0]!)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });

  test("the rows are Lumiverse's: memory kept in the stand-in's database is read at the next generation", async () => {
    const lv = remembered(ON, { withDb: true });
    expect(lv.db!.rows("SELECT id, tier, message_range_start FROM memory_consolidations ORDER BY tier, message_range_start")).toEqual([
      { id: "s1", tier: 1, message_range_start: 1 },
      { id: "s2", tier: 1, message_range_start: 4 },
      { id: "a1", tier: 2, message_range_start: 1 },
    ]);
    const seen = handed(lv);
    await generate(lv);
    expect(sourcesOf(seen[0]!)).toEqual(["m0", "m3", "m5", "m6", "m7"]);
    // The summary's text changed under the stand-in, and the chunk's messages moved on: the next generation reads them as they stand.
    lv.db!.run("UPDATE memory_consolidations SET summary = ? WHERE id = ?", "SCENE-ONE rewritten in the row.", "s1");
    lv.db!.run("UPDATE chat_chunks SET message_ids = ? WHERE id = ?", JSON.stringify(["m1", "m2"]), "c1");
    await generate(lv);
    // (The first generation's own reply follows them in the chat now.)
    expect(sourcesOf(seen[1]!).slice(0, 6)).toEqual(["m0", "m2", "m3", "m5", "m6", "m7"]);
    expect(textOf(seen[1]!.find((m) => m.__cortexHistorySummary === true)!)).toContain("SCENE-ONE rewritten in the row.");
  });

  test("a summary is never joined; a picture-only message joins as Lumiverse joins it; an empty image message is skipped and its neighbours join", async () => {
    // A summary standing as a user's message, between the player's lines: nothing is joined to it, and the lines around it are not joined to each other.
    const lines: ChatMessage[] = [
      { id: "m0", role: "assistant", content: line("GREET") },
      { id: "m1", role: "user", content: line("USER-1") },
      { id: "m2", role: "assistant", content: line("REPLY-1") },
      { id: "m3", role: "user", content: line("USER-2") },
      { id: "m4", role: "user", content: line("USER-3") },
      { id: "m5", role: "assistant", content: line("REPLY-2") },
      { id: "m6", role: "user", content: line("USER-4") },
    ];
    const lv = quay({ messages: lines });
    lv.library.setSetting(USER, "memoryCortexConfig", ON);
    lv.memory.addChunk({ id: "c1", chat: CHAT, messageIds: ["m2", "m3"], consolidation: "s1" });
    lv.memory.addConsolidation({ id: "s1", chat: CHAT, tier: 1, summary: "SCENE-ONE the first exchange", sourceChunkIds: ["c1"], sourceConsolidationIds: [], messageRangeStart: 2, updatedAt: 1 });
    const seen = handed(lv);
    await generate(lv);
    expect(historyOf(seen[0]!).map(([id, text]) => [id, text.startsWith("[Memory Cortex") ? "summary" : text])).toEqual([["m0", line("GREET")], ["m1", line("USER-1")], ["m3", "summary"], ["m4", line("USER-3")], ["m5", line("REPLY-2")], ["m6", line("USER-4")]]);

    // A picture and no text has no text part: joined to a line, the text reads "" and the blank line, whichever comes first; the pictures follow the text.
    const picture = { data: "cXVheQ==", mime_type: "image/png" };
    const pictured = quay({ messages: [{ id: "m0", role: "assistant", content: line("GREET") }, { id: "m1", role: "user", content: line("USER-1") }, { id: "m2", role: "user", content: "", images: [picture] }, { id: "m3", role: "assistant", content: line("REPLY-1") }, { id: "m4", role: "user", content: "", images: [picture] }, { id: "m5", role: "user", content: line("USER-2") }] });
    const seenPictured = handed(pictured);
    await generate(pictured);
    const history = seenPictured[0]!.filter((m) => m.__isChatHistory === true);
    expect(history.map((m) => m.content)).toEqual([
      line("GREET"),
      [{ type: "text", text: `${line("USER-1")}\n\n` }, { type: "image", ...picture }],
      line("REPLY-1"),
      [{ type: "text", text: `\n\n${line("USER-2")}` }, { type: "image", ...picture }],
    ]);

    // A message the image generator made, with no text and no picture the user lets through, is not sent, and the lines either side of it join; with the user's
    // images recycled, its picture reaches the model and the message stays.
    const generated: ChatMessage[] = [{ id: "m0", role: "assistant", content: line("GREET") }, { id: "m1", role: "user", content: line("USER-1") }, { id: "m2", role: "assistant", content: "", imageGen: true, images: [picture] }, { id: "m3", role: "user", content: line("USER-2") }];
    const skipped = quay({ messages: structuredClone(generated) });
    const seenSkipped = handed(skipped);
    await generate(skipped);
    expect(historyOf(seenSkipped[0]!)).toEqual([["m0", line("GREET")], ["m1", `${line("USER-1")}\n\n${line("USER-2")}`]]);
    const recycled = quay({ messages: structuredClone(generated) });
    recycled.library.setSetting(USER, "imageGeneration", { recycleGeneratedImages: true, recycledImageLimit: 1 });
    const seenRecycled = handed(recycled);
    await generate(recycled);
    expect(seenRecycled[0]!.filter((m) => m.__isChatHistory === true).map((m) => [m.sourceMessageId, m.role, Array.isArray(m.content) ? m.content.map((p) => p.type) : "text"])).toEqual([["m0", "assistant", "text"], ["m1", "user", "text"], ["m2", "assistant", ["image"]], ["m3", "user", "text"]]);

    // The first source of a joined pair keeps its extension metadata and its number; a line that stands alone keeps its own.
    const marked = quay({ messages: [{ id: "m0", role: "assistant", content: line("GREET"), metadata: { note: "greeting" } }, { id: "m1", role: "user", content: line("USER-1"), metadata: { note: "first" } }, { id: "m2", role: "user", content: line("USER-2"), metadata: { note: "second" } }] });
    const out = await generate(marked, { dryRun: true });
    expect(out.prompt.filter((m) => m.__chatHistorySource === true).map((m) => [m.__sourceMessageId, m.__sourceIndexInChat, m.__sourceMessageMetadata])).toEqual([["m0", 0, { note: "greeting" }], ["m1", 1, { note: "first" }]]);
  });
});

describe("append blocks and the databank mention are inside the history messages (`services/prompt-assembly.service.ts:3420-3452`, `:3620-3633`, `:4218-4234`, `:6684-6740`)", () => {
  test("an append block's text is inside the history message it names, which keeps its history mark and source; the databank mention is inside the last user message", async () => {
    const blocks: Block[] = [
      MAIN,
      HISTORY,
      { id: "b-user", name: "Reminder", role: "user_append", content: "REMIND keep it short", depth: 0 },
      // Two on the same message go together, nothing between them but what each carries; the second's whitespace is kept.
      { id: "b-user-2", name: "Reminder two", role: "user_append", content: "\nAND stay in the scene", depth: 0 },
      // The assistant message one reply from the end.
      { id: "b-assistant", name: "Echo", role: "assistant_append", content: "ECHO a mark on the older reply", depth: 1 },
      // No user message that deep: it is skipped, silently.
      { id: "b-deep", name: "Deep", role: "user_append", content: "DEEP never sent", depth: 9 },
    ];
    const lv = quay({ blocks });
    const seen = handed(lv);
    const out = await generate(lv);
    const history = seen[0]!.filter((m) => m.__isChatHistory === true);
    // m7 is the newest user message, and m6 the newest reply; m4 the one before it.
    expect(history.find((m) => m.sourceMessageId === "m7")!.content).toBe(`${line("LINE-7")}\nREMIND keep it short\nAND stay in the scene`);
    expect(history.find((m) => m.sourceMessageId === "m4")!.content).toBe(`${line("LINE-4")}\nECHO a mark on the older reply`);
    expect(history.find((m) => m.sourceMessageId === "m6")!.content).toBe(line("LINE-6"));
    // They are the history still: marked, numbered, and no message of their own in the prompt.
    expect(history.find((m) => m.sourceMessageId === "m7")).toMatchObject({ __isChatHistory: true, sourceIndexInChat: 7, role: "user" });
    expect(JSON.stringify(seen[0])).not.toContain("DEEP");
    expect(seen[0]!.map((m) => m.role)).toEqual(["system", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    // Named as Lumiverse names them in what it stores beside the reply.
    expect(out.stored!.entries.filter((e) => e.type === "append").map((e) => [e.name, e.role, e.content])).toEqual([
      ["Reminder → user@0", "user", "REMIND keep it short"],
      ["Reminder two → user@0", "user", "\nAND stay in the scene"],
      ["Echo → assistant@1", "assistant", "ECHO a mark on the older reply"],
    ]);
    // Their text is the sent prompt's, and in the request.
    expect(JSON.stringify(out.body)).toContain("REMIND keep it short");
  });

  test("the text of the documents the last user message names is put at its end, the mention gone from the lines of the chat", async () => {
    for (const withDb of [false, true]) {
      const messages = eight();
      messages[3] = { ...messages[3]!, content: "Earlier #harbor-notes I asked about the quay" };
      messages[7] = { ...messages[7]!, content: "What does #harbor-notes  say of the tide? #no-such-note" };
      const lv = quay({ messages, withDb });
      lv.databanks.addBank({ id: "bank-quay", user: USER, name: "Quay notes", scope: "chat", scopeId: CHAT });
      lv.databanks.addBank({ id: "bank-off", user: USER, name: "Off", scope: "global", enabled: false });
      lv.databanks.addDocument({ id: "doc-harbor", databank: "bank-quay", user: USER, name: "Harbor notes", slug: "harbor-notes", chunks: ["The tide turns at noon.", "The bell rings twice."] });
      lv.databanks.addDocument({ id: "doc-off", databank: "bank-off", user: USER, name: "Off note", slug: "no-such-note", chunks: ["never read"] });
      const seen = handed(lv);
      const out = await generate(lv);
      const history = seen[0]!.filter((m) => m.__isChatHistory === true);
      // A mention that names a document of a bank that is on is taken out of every player's line; one that names none (or a bank that is off) stays.
      expect(textOf(history.find((m) => m.sourceMessageId === "m3")!)).toBe("Earlier I asked about the quay");
      expect(textOf(history.find((m) => m.sourceMessageId === "m7")!)).toBe(
        "What does say of the tide? #no-such-note" + ["", "---", "", "# Additional Context", "The user has attached the following reference material for you to consider when responding.", "", "## Harbor notes\nThe tide turns at noon.\nThe bell rings twice."].join("\n"),
      );
      expect(JSON.stringify(seen[0])).not.toContain("never read");
      expect(out.stored!.entries.filter((e) => e.type === "databank_mention").map((e) => [e.name, e.role])).toEqual([["Databank Reference", "user"]]);
      // The chat's own messages are as they were.
      expect(lv.chats.get(CHAT)!.messages.find((m) => m.id === "m7")!.content).toBe("What does #harbor-notes  say of the tide? #no-such-note");
    }
  });
});

describe("a preset with no chat-history block (`services/prompt-assembly.service.ts:3161`, `:3732-3756`)", () => {
  test("a preset with no chat-history block sends no history, its lore at the start and the end", async () => {
    const lore: Entry[] = [
      { id: "e-before", book: "book-quay", comment: "Before", constant: true, content: "BEFORE-LORE the start of the prompt" },
      { id: "e-after", book: "book-quay", comment: "After", constant: true, position: 1, content: "AFTER-LORE the end of the prompt" },
      // Around the history's first message, or inside it: with no history there is nowhere, and they go nowhere.
      { id: "e-an", book: "book-quay", comment: "Note", constant: true, position: 2, content: "NOTE-LORE nowhere" },
      { id: "e-em", book: "book-quay", comment: "Example", constant: true, position: 5, content: "EXAMPLE-LORE nowhere" },
    ];
    const post: Block = { id: "b-post", name: "Post", role: "system", content: "POST stay in the scene" };
    const lv = quay({ blocks: [MAIN, post] });
    lv.library.addBook({ id: "book-quay", name: "Quay lore", user: USER, entries: lore });
    lv.addChat({ id: "chat-two", user: USER, character: { id: "char-oona", name: "Oona", extensions: { world_book_ids: ["book-quay"] } }, messages: eight() });
    const seen = handed(lv);
    const out = await lv.generate({ chat: "chat-two", connection: "conn-model", preset: "preset-quay" });
    expect(out.error).toBeNull();
    expect(seen[0]!.map((m) => textOf(m).split(" ")[0])).toEqual(["BEFORE-LORE", "MAIN", "POST", "AFTER-LORE"]);
    expect(seen[0]!.some((m) => m.__isChatHistory === true)).toBe(false);
    expect(JSON.stringify(out.body)).not.toContain("LINE-");
    // The reply is still made, and what Lumiverse stores holds no history.
    expect(out.stored!.chatHistoryTokens).toBe(0);
  });
});
