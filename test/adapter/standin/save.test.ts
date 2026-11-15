// What the stand-in Lumiverse saves of a reply, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): the authored start of the reply in front of the
// model's text, never trimmed, and the text changed as Lumiverse changes it (`services/generate.service.ts:3702-3722`, `:4065-4116`, `:4207-4249`, `:3565-3680`): thinking its
// delimiters mark moved out, the half word at a stream's end trimmed, the response scripts, the macros of the saved reply, and a stopped reply's open thinking closed. The scripts and the
// macros are the stand-in's own small set (`test/standin/save.ts`). Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { FakeClock } from "../../standin/clock";
import { boat, closeBoats, generate, rowOf, USER, type Boat } from "./boat";

afterEach(closeBoats);

const edited = (b: Boat): string[] => b.lv.events.filter((e) => e.event === "MESSAGE_EDITED").map((e) => String((e.payload as { message: { content: string } }).message.content));

describe("the prefill (`services/generate.service.ts:3702-3722`, `:4161`, `:4189`, `:4295`)", () => {
  test("the prefill is saved in front of the reply, streamed to the page first, and told in the end event; the reply's own text is the model's alone", async () => {
    const b = boat([{ words: [" goes on, and", " ends."] }], { preset: { assistantPrefill: "PREFILL Edda begins and" } });
    const out = await generate(b);
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe(" goes on, and ends.");
    const saved = "PREFILL Edda begins and goes on, and ends.";
    expect(out.messageId).toBeDefined();
    expect(rowOf(b, out.messageId!).content).toBe(saved);
    expect(b.lv.chats.get("chat-boat")!.messages.at(-1)!.content).toBe(saved);
    const ended = b.lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload as { content: string; messageId: string };
    expect(ended).toMatchObject({ content: saved, messageId: out.messageId });
    // The page was shown the prefill before anything of the model's: the stream's first frame starts with it, at the first place of the reply's text.
    const frames = b.lv.events.filter((e) => e.event === "STREAM_TOKEN_RECEIVED").map((e) => e.payload as { token: string; offset: number; seq: number; startSeq: number });
    expect(frames[0]!.token.startsWith("PREFILL Edda begins and")).toBe(true);
    expect(frames[0]).toMatchObject({ offset: 0, startSeq: 1 });
    expect(frames.map((f) => f.token).join("")).toBe(saved);
    expect(b.lv.streams.get(out.generationId!)!.content).toBe(saved);
  });

  test("a prefill is never trimmed, and only the model's tail is: the half word the stream ended on goes, a prefill that ends in half a word stays", async () => {
    const b = boat([{ words: ["rd and a half wo"] }], { preset: { assistantPrefill: "PREFILL a half-wo", trimIncompleteWords: true } });
    const out = await generate(b);
    expect(rowOf(b, out.messageId!).content).toBe("PREFILL a half-word and a half");
    // A reply asked for whole is no stream, so nothing of it is trimmed (`:4092-4094`).
    const whole = boat([{ words: ["rd and a half wo"] }], { preset: { assistantPrefill: "PREFILL a half-wo", trimIncompleteWords: true } });
    const all = await generate(whole, { parameters: { _streaming: false } });
    expect(rowOf(whole, all.messageId!).content).toBe("PREFILL a half-word and a half wo");
  });

  test("a prefill that opens the user's thinking delimiters is thinking from its first word: the saved reply holds what the model wrote after the delimiters close", async () => {
    const b = boat([{ words: ["\n</think>The boat drifts."] }], { preset: { assistantPrefill: "<think>\nHmm" } });
    b.lv.library.setSetting(USER, "reasoningSettings", { autoParse: true });
    const out = await generate(b);
    const row = rowOf(b, out.messageId!);
    expect(row.content).toBe("The boat drifts.");
    expect(row.extra.reasoningBySwipe).toEqual(["\nHmm\n"]);
    const frames = b.lv.events.filter((e) => e.event === "STREAM_TOKEN_RECEIVED").map((e) => e.payload as { type?: string; token: string });
    expect(frames[0]).toMatchObject({ type: "reasoning", token: "\nHmm" });
  });
});

describe("the saved text changed as Lumiverse changes it (`services/generate.service.ts:4065-4116`, `:4207-4249`, `:3565-3600`)", () => {
  test("regex, trim, macros and reasoning tags change the saved text", async () => {
    const b = boat([{ thinking: ["I doubt the colour of it."], words: ["<think>\nplanning the", " route\n</think>", "Her {{user}} saw the colour of the SECRET {{char}} kept, and the shore beyond the bend of the riv"] }], { preset: { trimIncompleteWords: true } });
    b.lv.library.setSetting(USER, "reasoningSettings", { autoParse: true });
    b.lv.regexScripts = [
      { find: "colour", replace: "color" },
      { find: "\\bsecret\\b", flags: "gi", replace: "[removed]" },
      { find: "colour", on: "reasoning", replace: "hue" },
    ];
    const out = await generate(b);
    expect(out.error).toBeNull();
    const row = rowOf(b, out.messageId!);
    // The delimited thinking moved out and put after the model's own, the half word at the end trimmed, the scripts on the reply and on its thinking, the macros resolved.
    expect(row.content).toBe("Her User saw the color of the [removed] Edda kept, and the shore beyond the bend of the");
    expect(row.extra.reasoningBySwipe).toEqual(["I doubt the hue of it.\n\nplanning the route\n"]);
    // The first save is the staged message filled in; the macros rewrote it a second time (`:4227-4247`), told as a second edit.
    expect(edited(b)).toEqual(["Her {{user}} saw the color of the [removed] {{char}} kept, and the shore beyond the bend of the", "Her User saw the color of the [removed] Edda kept, and the shore beyond the bend of the"]);
    const ended = b.lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload as { content: string };
    expect(ended.content).toBe(row.content);
  });

  test("a stopped reply's open thinking is closed and moved to the thinking, its half word trimmed and its scripts run; what came is kept", async () => {
    const clock = new FakeClock();
    const b = boat([{ words: ["<think>\nplanning the route", " then the river bends, and the moo"], toWord: 100, between: 100, toEnd: 5_000 }], { clock, preset: { trimIncompleteWords: true } });
    b.lv.library.setSetting(USER, "reasoningSettings", { autoParse: true });
    const run = await b.lv.start({ chat: "chat-boat", connection: "conn-model", preset: "preset-boat" });
    for (let i = 0; i < 2_000 && b.provider.calls.length === 0; i++) await Bun.sleep(1);
    await clock.advance(250);
    expect(b.lv.stop(USER, { generation: run.generationId! })).toBe(true);
    const out = await run.done;
    expect(out.stopped).toBe(true);
    const row = rowOf(b, out.messageId!);
    // Unclosed thinking is closed (`:3570`) and read as thinking; nothing else was written.
    expect(row.content).toBe("");
    expect(row.extra.reasoningBySwipe).toEqual(["\nplanning the route then the river bends, and the moo"]);
    expect(b.lv.events.find((e) => e.event === "GENERATION_STOPPED")!.payload).toMatchObject({ content: "" });
  });
});
