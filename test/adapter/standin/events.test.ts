// The events of a generation as the stand-in Lumiverse tells them, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): the stream's frames batched and sent to
// the chat's own topic (`services/generate.service.ts:3320-3385`), the events of a save in order (`:1988-2002`, `:4121-4195`, `:4241-4247`), the end event's payload (`:4289-4303`, `:4565-4579`),
// the token count and the timings on a later task (`:4400-4426`), and the breakdown that comes after the end event or not at all (`:4305-4310`, `:4432-4497`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { FakeClock } from "../../standin/clock";
import { boat, closeBoats, generate, rowOf, USER, type Boat } from "./boat";

afterEach(closeBoats);

const WATCHED = new Set(["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_SWIPED", "GENERATION_STARTED", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED", "GENERATION_STOPPED", "GENERATION_METRICS_READY", "GENERATION_BREAKDOWN_READY"]);

/** The generation's events in the order they were told, a run of the stream's frames as one, `MESSAGE_SWIPED` with its action. */
function told(b: Boat): string[] {
  const names = b.lv.events.filter((e) => WATCHED.has(e.event)).map((e) => (e.event === "MESSAGE_SWIPED" ? `MESSAGE_SWIPED ${(e.payload as { action: string }).action}` : e.event));
  return names.filter((name, i) => name !== "STREAM_TOKEN_RECEIVED" || names[i - 1] !== name);
}

describe("the events of a save, in order", () => {
  test("a new reply: its staged message is told before the generation is, its edit after the stream and a second edit when the macros changed it; the breakdown comes last", async () => {
    const b = boat([{ words: ["Her {{user}} waves."] }]);
    const out = await generate(b);
    expect(told(b)).toEqual(["MESSAGE_SENT", "GENERATION_STARTED", "MESSAGE_EDITED", "MESSAGE_EDITED", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED", "GENERATION_METRICS_READY", "GENERATION_BREAKDOWN_READY"]);
    // The staged message told as sent was empty; the end event names the message it ended in.
    const sent = b.lv.events.find((e) => e.event === "MESSAGE_SENT")!.payload as { message: { id: string; content: string; is_user: boolean } };
    expect(sent.message).toMatchObject({ id: out.messageId, content: "", is_user: false });
    const started = b.lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { targetMessageId: string };
    expect(started.targetMessageId).toBe(out.messageId!);
    // Without a macro in the text the save is one edit.
    const plain = boat([{ words: ["Her friend waves."] }]);
    await generate(plain);
    expect(told(plain)).toEqual(["MESSAGE_SENT", "GENERATION_STARTED", "MESSAGE_EDITED", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED", "GENERATION_METRICS_READY", "GENERATION_BREAKDOWN_READY"]);
  });

  test("a swipe: its blank swipe told as added, then the filled one as updated; an impersonation: its message told after the generation, none for a draft", async () => {
    const b = boat([{ words: ["First."] }, { words: ["Second."] }]);
    await generate(b);
    b.lv.events.length = 0;
    await generate(b, { type: "swipe" });
    expect(told(b)).toEqual(["MESSAGE_SWIPED added", "GENERATION_STARTED", "MESSAGE_SWIPED updated", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED", "GENERATION_METRICS_READY", "GENERATION_BREAKDOWN_READY"]);

    const imp = boat([{ words: ["I wave back."] }]);
    await generate(imp, { type: "impersonate" });
    expect(told(imp)).toEqual(["GENERATION_STARTED", "MESSAGE_SENT", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED", "GENERATION_METRICS_READY", "GENERATION_BREAKDOWN_READY"]);

    // A draft is shown in the input box and saves no message: no breakdown, no metrics, and the end event says it was a draft.
    const draft = boat([{ words: ["I wave back."] }]);
    const out = await generate(draft, { type: "impersonate", impersonateDraft: true });
    expect(out.messageId).toBeUndefined();
    expect(told(draft)).toEqual(["GENERATION_STARTED", "STREAM_TOKEN_RECEIVED", "GENERATION_ENDED"]);
    expect(draft.lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload).toMatchObject({ impersonateDraft: true, generationType: "impersonate" });
  });
});

describe("the end event's payload", () => {
  test("it carries the finish reason, the usage, the type and the text saved; a stop says what was kept, a failure why it ended", async () => {
    const b = boat([{ words: ["Done."], finishReason: "length", usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }]);
    const out = await generate(b);
    expect(b.lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload).toMatchObject({ generationId: out.generationId, chatId: "chat-boat", messageId: out.messageId, content: "Done.", finish_reason: "length", usage: { total_tokens: 6 }, generationType: "normal" });
    expect(b.lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload).not.toHaveProperty("error");
    const stored = rowOf(b, out.messageId!);
    expect(stored.extra.generationOutcomeBySwipe).toEqual([{ finish_reason: "length" }]);
  });
});

describe("the stream's frames (`services/generate.service.ts:3320-3385`)", () => {
  test("each stretch of one kind is one frame, batched to forty milliseconds, numbered one after the other and placed in the text of its kind, and sent to the chat's stream topic", async () => {
    const clock = new FakeClock();
    const b = boat([{ thinking: ["Hm."], toThinking: 0, words: ["a", "b", "c", "d"], toWord: 5, between: 10, toEnd: 100 }], { clock });
    const topics: (string | undefined)[] = [];
    b.lv.sockets = (event, _payload, _user, options) => {
      if (event === "STREAM_TOKEN_RECEIVED") topics.push(options?.topic);
    };
    const run = await b.lv.start({ chat: "chat-boat", connection: "conn-model", preset: "preset-boat" });
    for (let i = 0; i < 2_000 && b.provider.calls.length === 0; i++) await Bun.sleep(1);
    await clock.advance(200);
    await run.done;
    const frames = b.lv.events.filter((e) => e.event === "STREAM_TOKEN_RECEIVED").map((e) => e.payload);
    // The thinking at 0 goes at once; "a" at 5 follows it by less than forty and waits for the interval's end (40); "b" 15, "c" 25, "d" 35 join it.
    expect(frames).toEqual([
      { generationId: run.generationId, chatId: "chat-boat", token: "Hm.", type: "reasoning", seq: 1, startSeq: 1, offset: 0 },
      { generationId: run.generationId, chatId: "chat-boat", token: "abcd", seq: 5, startSeq: 2, offset: 0 },
    ]);
    expect(topics).toEqual([`stream:${USER}:chat-boat`, `stream:${USER}:chat-boat`]);
  });

  test("a stretch of 768 characters goes at once, and what is left goes when the reply ends", async () => {
    const b = boat([{ words: ["x".repeat(800), "tail"] }]);
    await generate(b);
    const frames = b.lv.events.filter((e) => e.event === "STREAM_TOKEN_RECEIVED").map((e) => e.payload as { token: string; seq: number; startSeq: number; offset: number });
    expect(frames.map((f) => f.token.length)).toEqual([800, 4]);
    expect(frames[1]).toMatchObject({ seq: 2, startSeq: 2, offset: 800 });
  });
});

describe("the token count and the timings", () => {
  test("they come on a later task, after the end event, for the swipe the reply was made for: the provider's own count, or the tokenizer's where the model is one it knows", async () => {
    const clock = new FakeClock();
    const b = boat([{ words: ["Slow ", "reply."], toWord: 1_000, between: 500, toEnd: 100, usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } }], { clock });
    const run = await b.lv.start({ chat: "chat-boat", connection: "conn-model", preset: "preset-boat" });
    for (let i = 0; i < 2_000 && b.provider.calls.length === 0; i++) await Bun.sleep(1);
    await clock.advance(1_600);
    const out = await run.done;
    const ready = b.lv.events.find((e) => e.event === "GENERATION_METRICS_READY")!.payload as { generationId: string; messageId: string; swipeId: number; tokenCount: number; generationMetrics: Record<string, unknown> };
    expect(ready).toMatchObject({ generationId: out.generationId, messageId: out.messageId, swipeId: 0, tokenCount: 6 });
    // The first token at a second, over a stretch of 1.6 s; the speed over the reply's own stretch, 6 tokens in the half second between its first word and the stream's end.
    expect(ready.generationMetrics).toMatchObject({ ttft: 1_000, durationMs: 1_600, wasStreaming: true, model: "model", provider: "custom", presetId: "preset-boat", presetName: "Boat" });
    const row = rowOf(b, out.messageId!);
    expect(row.extra.tokenCountBySwipe).toEqual([6]);
    expect(row.extra.generationMetricsBySwipe).toEqual([ready.generationMetrics]);

    // With no count from the provider, a model the tokenizer knows is counted (a quarter of the characters, the stand-in's own), and one it does not is not.
    const known = boat([{ words: ["twelve chars"] }]);
    known.lv.tokenizedModels.add("model");
    await generate(known);
    expect(known.lv.events.find((e) => e.event === "GENERATION_METRICS_READY")!.payload).toMatchObject({ tokenCount: 3 });
    const unknown = boat([{ words: ["twelve chars"] }]);
    await generate(unknown);
    expect(unknown.lv.events.find((e) => e.event === "GENERATION_METRICS_READY")!.payload).not.toHaveProperty("tokenCount");
  });
});

describe("the breakdown", () => {
  test("the breakdown lands after the end event, or not at all", async () => {
    const b = boat([{ words: ["Done."] }]);
    const out = await generate(b);
    const names = b.lv.events.map((e) => e.event);
    expect(names.indexOf("GENERATION_BREAKDOWN_READY")).toBeGreaterThan(names.indexOf("GENERATION_ENDED"));
    expect(out.stored).not.toBeNull();
    const ready = b.lv.events.find((e) => e.event === "GENERATION_BREAKDOWN_READY")!.payload as { messageId: string; breakdown: Record<string, unknown> };
    expect(ready.messageId).toBe(out.messageId!);
    // Pushed without its messages, with the tokenizer's name and the model's context.
    expect(ready.breakdown).not.toHaveProperty("messages");
    expect(ready.breakdown).toMatchObject({ tokenizer_name: "approximate", maxContext: 0, model: "model", presetId: "preset-boat" });
    expect(b.lv.stored.get(out.messageId!)!.data.messages.length).toBeGreaterThan(0);

    // A tokenizer that throws: the reply is saved and ended and no breakdown is stored or told.
    const failing = boat([{ words: ["Done."] }]);
    failing.lv.tokenizerFails = true;
    const kept = await generate(failing);
    expect(kept.messageId).toBeDefined();
    expect(kept.stored).toBeNull();
    expect(failing.lv.events.some((e) => e.event === "GENERATION_BREAKDOWN_READY")).toBe(false);
    expect(failing.lv.stored.size).toBe(0);

    // A reply that failed or was stopped stores none either.
    const refused = boat([{ words: ["Half"], ending: { error: "no" } }]);
    await generate(refused);
    expect(refused.lv.events.some((e) => e.event === "GENERATION_BREAKDOWN_READY" || e.event === "GENERATION_METRICS_READY")).toBe(false);
  });

  test("an interceptor's breakdown entries are in a dry run's breakdown and in the stored one", async () => {
    const b = boat([{ words: ["Done."] }]);
    b.lv.install(["interceptor"], "lumi-tide").registerInterceptor(
      async (messages) => ({
        messages: [...messages, { role: "system", content: "TIDE the tide is out" }],
        // One entry names the message it marks by its place in the interceptor's own result, and one marks a place that is no message and is dropped.
        breakdown: [{ messageIndex: messages.length, name: "Tide note" }, { messageIndex: 99, name: "Nowhere" }],
      }),
      {},
    );
    const entry = { type: "extension", name: "Tide note", role: "system", content: "TIDE the tide is out", extensionId: "lumi-tide", extensionName: "lumi-tide" };
    // After the assembly's own entries, the chat history's left out of a dry run's.
    const dry = await generate(b, { dryRun: true });
    expect(dry.breakdown!.at(-1)).toEqual(entry);
    expect(dry.breakdown!.filter((e) => e.type === "extension")).toHaveLength(1);
    expect(dry.breakdown!.some((e) => e.type === "chat_history")).toBe(false);
    const out = await generate(b);
    expect(out.stored!.entries.at(-1)).toMatchObject({ ...entry, tokens: Math.ceil("TIDE the tide is out".length / 4) });
    expect(rowOf(b, out.messageId!)).toBeDefined();
  });
});
