// What the stand-in Lumiverse keeps of a reply's thinking and of a reply that did not end well, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): the thinking
// kept with the message, by swipe (`services/generate.service.ts:4150-4166`, `:4256-4284`; `services/chats.service.ts:2888-2920`), sent back in later prompts as `reasoning_content`
// by the user's `keepInHistory` (`services/prompt-assembly.service.ts:282-329`, `:3370-3394`, `:6851-6900`), and what a failed or a stopped reply keeps (`:4539-4579`, `:4502-4537`,
// `:3565-3680`, `:630-647`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { FakeClock } from "../../standin/clock";
import { boat, closeBoats, generate, ORIGIN, rowOf, USER, type Boat } from "./boat";

afterEach(closeBoats);

const ended = (b: Boat): Record<string, unknown> => b.lv.events.filter((e) => e.event === "GENERATION_ENDED").at(-1)!.payload as Record<string, unknown>;
const assistants = (b: Boat): string[] => b.lv.chats.get("chat-boat")!.messages.filter((m) => m.role === "assistant").map((m) => m.content);

describe("thinking kept with the message", () => {
  test("the reply's thinking is kept with it, by swipe, and writes no event and raises no revision", async () => {
    const b = boat([
      { thinking: ["Weighing ", "it."], words: ["Done."], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
      { thinking: ["Another way."], words: ["Done otherwise."] },
    ]);
    const first = await generate(b);
    const row = rowOf(b, first.messageId!);
    expect(row.extra.reasoningBySwipe).toEqual(["Weighing it."]);
    expect(row.extra.reasoningCarrierBySwipe).toEqual([{ type: "reasoning_content", content: "Weighing it." }]);
    expect(row.extra.generationOutcomeBySwipe).toEqual([{ finish_reason: "stop" }]);
    expect(row.extra.usageBySwipe).toEqual([{ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }]);
    // Only the staged message's filling in was told; the thinking beside it was written without a word (`setSwipeScopedExtra` tells nothing).
    expect(b.lv.events.filter((e) => e.event === "MESSAGE_EDITED")).toHaveLength(1);
    // A swipe of the reply keeps its own thinking in its own place, the first one's left as it was.
    const swipe = await generate(b, { type: "swipe" });
    expect(swipe.messageId).toBe(first.messageId);
    const both = rowOf(b, first.messageId!);
    expect(both.swipes).toEqual(["Done.", "Done otherwise."]);
    expect(both.extra.reasoningBySwipe).toEqual(["Weighing it.", "Another way."]);
    expect(both.extra.reasoningCarrierBySwipe).toEqual([{ type: "reasoning_content", content: "Weighing it." }, { type: "reasoning_content", content: "Another way." }]);
  });

  test("earlier thinking comes back as reasoning_content, as many replies' as the user's keepInHistory keeps", async () => {
    const replies = [
      { thinking: ["First thoughts."], words: ["One."] },
      { thinking: ["Second thoughts."], words: ["Two."] },
      { words: ["Three."] },
    ];
    const b = boat(replies);
    await generate(b);
    b.lv.send("chat-boat", "USER-2 I row on.");
    await generate(b);
    b.lv.send("chat-boat", "USER-3 I row further.");
    await generate(b);
    // The default keeps every earlier reply's: the third request carries both.
    const carried = (call: number): (string | undefined)[] => (b.provider.calls[call]!.body.messages as { role: string; reasoning_content?: string }[]).filter((m) => m.role === "assistant").map((m) => m.reasoning_content);
    expect(carried(0)).toEqual([]);
    expect(carried(1)).toEqual(["First thoughts."]);
    expect(carried(2)).toEqual(["First thoughts.", "Second thoughts."]);
    // keepInHistory 1: only the newest of them; 0: none.
    b.lv.library.setSetting(USER, "reasoningSettings", { keepInHistory: 1 });
    b.lv.send("chat-boat", "USER-4 I row on.");
    await generate(b);
    expect(carried(3)).toEqual([undefined, "Second thoughts.", undefined]);
    b.lv.library.setSetting(USER, "reasoningSettings", { keepInHistory: 0 });
    b.lv.send("chat-boat", "USER-5 I stop.");
    await generate(b);
    expect(carried(4).every((c) => c === undefined)).toBe(true);
  });
});

describe("what a failed or a stopped reply keeps", () => {
  test("a reply that fails part way, or whose connection drops, is kept with what it had; a stopped one with only its prefill is kept", async () => {
    // It fails part way: what it had is kept, its thinking too, the error beside it, and the end event says what came and why it ended.
    const failing = boat([{ thinking: ["Hmm."], words: ["Half a "], ending: { error: "The model fell over." } }], { connection: { name: "Mere Model" } });
    const out = await generate(failing);
    expect(out.error).toBe("The model fell over.");
    expect(out.messageId).toBeDefined();
    const row = rowOf(failing, out.messageId!);
    expect(row.content).toBe("Half a ");
    expect(row.extra.reasoningBySwipe).toEqual(["Hmm."]);
    expect(row.extra.generationOutcomeBySwipe).toEqual([{ error: "The model fell over." }]);
    expect(assistants(failing)).toEqual(["Half a "]);
    expect(ended(failing)).toMatchObject({ messageId: out.messageId, content: "Half a ", error: "The model fell over.", errorCode: "generation_failed", errorMessage: "The model fell over.", connectionName: "Mere Model", generationType: "normal" });

    // Its connection drops before the end: the same, with Lumiverse's words for it.
    const dropped = boat([{ words: ["Half a "], ending: "drop" }]);
    const gone = await generate(dropped);
    expect(gone.error).toBe("The provider connection closed before a terminal response was received.");
    expect(assistants(dropped)).toEqual(["Half a "]);

    // The provider says no: with nothing come, the staged message is removed and the end event names none; an HTTP status is the code.
    const refused = boat([{ words: [] }]);
    refused.lv.servers.set(ORIGIN, async () => new Response("down", { status: 500 }));
    const none = await generate(refused);
    expect(none.error).toBe("Provider error 500: down");
    expect(none.messageId).toBeUndefined();
    expect(assistants(refused)).toEqual([]);
    expect(ended(refused)).toMatchObject({ error: "Provider error 500: down", errorCode: "http_500" });
    expect(ended(refused).messageId).toBeUndefined();

    // A prefill alone fills the staged message: stopped, or failed, it is kept.
    const clock = new FakeClock();
    const stopped = boat([{ words: ["after"], toWord: 5_000 }], { clock, preset: { assistantPrefill: "PREFILL she begins" } });
    const run = await stopped.lv.start({ chat: "chat-boat", connection: "conn-model", preset: "preset-boat" });
    for (let i = 0; i < 2_000 && stopped.provider.calls.length === 0; i++) await Bun.sleep(1);
    expect(stopped.lv.stop(USER, { generation: run.generationId! })).toBe(true);
    const out2 = await run.done;
    expect(out2.stopped).toBe(true);
    expect(assistants(stopped)).toEqual(["PREFILL she begins"]);
    expect(stopped.lv.events.find((e) => e.event === "GENERATION_STOPPED")!.payload).toMatchObject({ content: "PREFILL she begins" });
    const prefilled = boat([{ words: [], ending: { error: "no" } }], { preset: { assistantPrefill: "PREFILL she begins" } });
    const kept = await generate(prefilled);
    expect(kept.error).toBe("no");
    expect(assistants(prefilled)).toEqual(["PREFILL she begins"]);
  });
});
