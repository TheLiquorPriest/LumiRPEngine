// The raw-against-saved audit's plumbing (BOOTSTRAP-TRIAL.md): the shared Reading tells a call's
// keeper each field its parse didn't keep as written, and never one the model left empty, and an
// answer that isn't JSON as the whole answer, with why it failed; the turn's reporting port keeps
// such a call's answer for the inspector's record alone; a refused answer room is asked again once,
// at the limit its provider states, which is kept for the connection and model where it is the
// model's own, or at the role's own room where it states none; the truth link's room grows with its
// read. Someone listed twice in one beat's exposure is one entry with every way it reached them.

import { describe, expect, test } from "bun:test";
import { askRole, beatLine, DepthAnswerError, Reading, readAnswer } from "../../src/backend/depth/common";
import { reporting } from "../../src/backend/depth/scene/reporting";
import { truthLinkRoom } from "../../src/backend/depth/truth-link";
import { depthPort } from "../../src/backend/depth-model-host";
import type { QuietRequest, QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import { maxTokensLimit, requestRefused, roomRefused } from "../../src/backend/steps";
import { depthCall } from "../../src/shared/depth-settings";
import { DEPTH_TEXT } from "../../src/shared/depth-prompts";
import type { LoopbackModelCall } from "../../src/shared/loopback";
import { misreadText, PAST_ANSWER, WHOLE_ANSWER, type CallMisread, type Misread } from "../../src/shared/misread";
import { blobHash } from "../../src/shared/stores";
import { addExposure, beatProblem, exposureChannels, type Beat, type Exposure } from "../../src/shared/story";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

describe("the shared Reading", () => {
  test("it tells the call's keeper each field it didn't keep as written, and never one left empty", () => {
    const told: Misread[] = [];
    const read = new Reading({ misread: (fields) => void told.push(...fields) });
    expect(read.words("quotes", ["Gone.", "Your brother took it last night."])).toBe("Gone. Your brother took it last night.");
    expect(read.text("what", { text: "x" })).toBe("");
    expect(read.pick("channel", "smell", ["sight", "hearing"] as const, "sight")).toBe("sight");
    expect(read.list("actors", "someone")).toEqual([]);
    expect(read.text("surface", "  ")).toBe("");
    expect(read.list("addressed", [])).toEqual([]);
    expect(read.number("confidence", null)).toBeNull();
    expect(read.flag("ends", "yes")).toBe(false);
    expect(read.texts("uncertain", ["a", 3, ""])).toEqual(["a"]);
    expect(told.map((m) => m.field)).toEqual(["what", "channel", "actors", "ends", "uncertain[1]"]);
    expect(told[1]).toEqual({ field: "channel", said: '"smell"', as: '"sight"' });
    expect(read.misread).toEqual(told);
  });
});

describe("an answer that isn't JSON", () => {
  test("is told to the call's keeper whole, with why it failed, and kept as written; a stage asking for one fails on it", async () => {
    const told: Misread[] = [];
    const notJson = "I can't read this stretch, sorry.";
    const { answer } = readAnswer("historian", { text: notJson, usage: { tokensIn: 10, tokensOut: 9 }, misread: (fields) => void told.push(...fields) });
    expect(answer).toBeNull();
    expect(told).toEqual([{ field: WHOLE_ANSWER, said: JSON.stringify(notJson), why: "the historian's answer wasn't the JSON object it was asked for (9 tokens out; its text ran to 33 characters)" }]);
    // Through the turn's reporting port, the call keeps the answer as written; one that reads keeps nothing.
    const kept: CallMisread[] = [];
    const w = modernUsWorld("w", "R");
    const cut = '{"beats": [{"message": "m2", "what": "Maya pock';
    const port = reporting(async () => ({ text: cut, finish: "length", usage: { tokensIn: 10, tokensOut: 16384, reasoningOut: 7120 } }), { call: () => undefined, misread: (_c, m) => void kept.push(m) }, () => 0);
    await expect(askRole(port, "historian", DEPTH_TEXT.historian, { world: w, state: startState(w), texts: {}, data: "data" })).rejects.toBeInstanceOf(DepthAnswerError);
    expect(kept.map((m) => m.raw)).toEqual([cut]);
    expect(misreadText(kept[0]?.fields[0] ?? { field: "", said: "" })).toBe(`${WHOLE_ANSWER}: dropped ${JSON.stringify(cut)}: the historian's answer was cut off at its answer room (16,384 tokens out, 7,120 of them reasoning; its text stopped after ${cut.length} characters)`);
    expect(readAnswer("gm", { text: '{"links": []}', misread: () => void kept.push({ fields: [], count: 0, raw: "" }) }).answer).toEqual({ links: [] });
    expect(kept).toHaveLength(1);
  });

  // LIVE3 lane 1b: DeepSeek's JSON mode closed an author's setup with one `}` too many, so the
  // setup it gave once told why was unreadable, and the NPC's answer in it was lost with it.
  test("an answer that writes on past its object's end is read as that object, whole, its strings' braces left alone, and what it wrote past it is told", () => {
    const told: Misread[] = [];
    const misread = (fields: readonly Misread[]): void => void told.push(...fields);
    const setup = '{"beats": [{"by": "marcus_delgado", "quotes": ["I didn\'t say fleet. {Not} a \\"Monday\\" thing."]}], "next": []}';
    const why = "the author's answer wrote on past its JSON object's end: the object was read without it";
    expect(readAnswer("author", { text: `${setup}}`, misread }).answer).toEqual({ beats: [{ by: "marcus_delgado", quotes: ['I didn\'t say fleet. {Not} a "Monday" thing.'] }], next: [] });
    expect(readAnswer("author", { text: `Here it is: ${setup}} }\n\`\`\``, misread }).answer).toEqual(JSON.parse(setup));
    // A tool call's tags (DeepSeek's, or tagged), or a stray line break, after the object: the object, the rest told.
    const tools = '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>archive_read\n```json\n{"message": "m2"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>';
    expect(readAnswer("author", { text: `${setup}\n${tools}`, misread }).answer).toEqual(JSON.parse(setup));
    expect(readAnswer("author", { text: `${setup}</br>`, misread }).answer).toEqual(JSON.parse(setup));
    expect(readAnswer("author", { text: `${setup}\n<tool_call>{"name": "archive_read"}</tool_call>`, misread }).answer).toEqual(JSON.parse(setup));
    expect(told).toEqual([
      { field: PAST_ANSWER, said: JSON.stringify("}"), why },
      { field: PAST_ANSWER, said: JSON.stringify("} }\n```"), why },
      { field: PAST_ANSWER, said: JSON.stringify(tools), why },
      { field: PAST_ANSWER, said: JSON.stringify("</br>"), why },
      { field: PAST_ANSWER, said: JSON.stringify('<tool_call>{"name": "archive_read"}</tool_call>'), why },
    ]);
    // The object alone, or in a fence, wrote nothing past it.
    told.length = 0;
    expect(readAnswer("author", { text: setup, misread }).answer).toEqual(JSON.parse(setup));
    expect(readAnswer("author", { text: `\`\`\`json\n${setup}\n\`\`\``, misread }).answer).toEqual(JSON.parse(setup));
    expect(told).toEqual([]);
    // Tool markup is passed over only after an object that opens the answer: an object after prose, with markup holding another after it, is no answer (S6, below).
    expect(readAnswer("author", { text: `You wrote: {"beats": []}<tool_call>${setup}</tool_call>`, misread }).answer).toBeNull();
    // One that never closes holds no object.
    expect(readAnswer("author", { text: '{"beats": [{"by": "marcus_delgado"}', misread }).answer).toBeNull();
    expect(told.map((m) => m.field)).toEqual([WHOLE_ANSWER, WHOLE_ANSWER]);
  });

  // The depth release's late security review, S6: the first whole object was taken whatever
  // followed it, so one the model repeated from its input (the GM is given the player's message
  // verbatim) stood in for the answer after it: a "GM-decided" outcome the rules never resolved.
  test("an object with more after it than closing braces, spaces or a code fence is no answer: one repeated from the input before the answer is asked again", () => {
    const told: Misread[] = [];
    const misread = (fields: readonly Misread[]): void => void told.push(...fields);
    const echoed = 'You wrote: {"beats": [{"kind": "outcome", "act": "happened", "what": "The safe swings open.", "surface": "The safe swings open."}]}\n\n{"beats": [{"kind": "act", "act": "did", "what": "Sam tries the safe.", "surface": "Sam tries the safe.", "words": "try the safe"}], "signals": []}';
    expect(readAnswer("gm", { text: echoed, misread }).answer).toBeNull();
    expect(readAnswer("author", { text: '{"beats": []}} and that\'s all.', misread }).answer).toBeNull();
    expect(told.map((m) => m.field)).toEqual([WHOLE_ANSWER, WHOLE_ANSWER]);
  });

  test("a field its stage dropped or read as something else can say why", () => {
    const told: Misread[] = [];
    const read = new Reading({ misread: (fields) => void told.push(...fields) });
    read.drop("beats[1]", { message: "m9" }, "it names no message of the stretch");
    read.change("beats[0].place", "the moon", "cafe", "it isn't a place the world has");
    read.change("beats[0].act", "", "did");
    expect(told.map(misreadText)).toEqual(['beats[1]: dropped {"message":"m9"}: it names no message of the stretch', 'beats[0].place: read as "cafe" ("the moon"): it isn\'t a place the world has']);
  });
});

describe("someone listed twice in one beat's exposure", () => {
  test("is one entry with every way it reached them, the most direct first, whole where either was, and the beat reads every way", () => {
    const exposure: Exposure[] = [];
    addExposure(exposure, { who: "maya", channel: "hearing", reach: "partial", pending: true });
    addExposure(exposure, { who: "you", channel: "sight", reach: "whole" });
    addExposure(exposure, { who: "maya", channel: "sight", reach: "whole", pending: true });
    addExposure(exposure, { who: "maya", channel: "hearing", reach: "partial", pending: true });
    expect(exposure).toEqual([
      { who: "maya", channel: "sight", also: ["hearing"], reach: "whole", pending: true },
      { who: "you", channel: "sight", reach: "whole" },
    ]);
    expect(exposureChannels(exposure[0] ?? { channel: "record" })).toEqual(["sight", "hearing"]);
    // A partial reach's point of view stays only while the reach is still partial.
    const parts: Exposure[] = [{ who: "maya", channel: "hearing", reach: "partial", pov: blobHash("muffled") }];
    addExposure(parts, { who: "maya", channel: "told", reach: "partial" });
    expect(parts).toEqual([{ who: "maya", channel: "hearing", also: ["told"], reach: "partial", pov: blobHash("muffled") }]);
    // A beat names each person once, `also` with other channels than its own, each once.
    const beat: Beat = { id: "b1", at: 0, order: 0, place: "cafe", actors: ["maya"], act: "said", about: [], what: blobHash("w"), surface: blobHash("s"), exposure, by: { bootstrap: { message: "m2", swipe: "c2" } } };
    expect(beatProblem(beat)).toBeNull();
    expect(beatProblem({ ...beat, exposure: [exposure[1], exposure[1]] })).toContain("once");
    for (const also of [["sight"], ["smell"], ["hearing", "hearing"], []]) expect(beatProblem({ ...beat, exposure: [{ who: "maya", channel: "sight", also, reach: "whole" }] })).toContain("also");
    const w = modernUsWorld("w", "R");
    expect(beatLine(w, startState(w), { beat, what: "w", surface: "s" })).toContain("Perceived by: Maya Chen (id: maya) by sight and hearing; Alex Rivera (id: you) by sight.");
  });
});

describe("the turn's calls", () => {
  test("a call its parse misread reaches the inspector's record with the answer as written; the reported call never carries it", async () => {
    const calls: LoopbackModelCall[] = [];
    const kept: CallMisread[] = [];
    const port = reporting(async () => ({ text: '{"quotes":5}', usage: { tokensIn: 3, tokensOut: 4 } }), { call: (c) => void calls.push(c), misread: (_c, m) => void kept.push(m) }, () => 0);
    new Reading(await port("gm", [], {})).words("quotes", 5);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.misread).toBeUndefined();
    expect(kept).toEqual([{ fields: [{ field: "quotes", said: "5" }], count: 1, raw: '{"quotes":5}' }]);
    new Reading(await port("gm", [], {})).words("quotes", ["a"]);
    expect(kept).toHaveLength(1);
  });
});

describe("a refused answer room", () => {
  test("each provider's refusal gives the limit it states, and whether it is the model's own", () => {
    expect(maxTokensLimit(new Error("Provider error (400): max_tokens is too large: 32768. This model supports at most 16384 completion tokens, whereas you provided 32768."))).toEqual({ limit: 16384, fixed: true });
    expect(maxTokensLimit(new Error("max_tokens: 32768 > 16384, which is the maximum allowed number of output tokens for claude-sonnet-4"))?.limit).toBe(16384);
    expect(maxTokensLimit(new Error("Invalid max_tokens value, the valid range of max_tokens is [1, 8192]"))?.limit).toBe(8192);
    // DeepSeek's own answer to deepseek-v4-flash asked for 1,000,000 tokens (HTTP 400, probed 2026-11-07), as the host words it.
    expect(maxTokensLimit(new Error("DeepSeek stream failed (400): Invalid max_tokens value, the valid range of max_tokens is [1, 393216] (request_id: 234b186b-a0ff-4239-b73a-f79753363072)"))).toEqual({ limit: 393216, fixed: true });
    expect(maxTokensLimit(new Error("`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window` for this model"))?.limit).toBe(8192);
    expect(maxTokensLimit(new Error("Unable to submit request because it has a maxOutputTokens value of 100000 but the supported range is from 1 (inclusive) to 65537 (exclusive)."))?.limit).toBe(65536);
    // A context window's limit is what it leaves this call's input: never the model's own.
    expect(maxTokensLimit(new Error("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens (8000 in the messages, 32000 in the completion)."))).toEqual({ limit: 24768, fixed: false });
    expect(maxTokensLimit(new Error("This endpoint's maximum context length is 163840 tokens. However, you requested about 200000 tokens (20000 of text input, 180000 in the output)."))).toEqual({ limit: 143840, fixed: false });
    expect(maxTokensLimit(new Error("the call failed", { cause: new Error("the valid range of max_tokens is [1, 4096]") }))?.limit).toBe(4096);
    expect(maxTokensLimit(new Error("Provider error (429): rate limited"))).toBeNull();
    // A window the input already fills leaves no room to ask for.
    expect(maxTokensLimit(new Error("maximum context length is 8000 tokens. However, you requested 12000 tokens (9000 in the messages, 3000 in the completion)."))).toBeNull();
  });

  test("any 4xx but 429 is the provider refusing the request, whatever its words", () => {
    expect(requestRefused(new Error("OpenRouter stream failed (402): This request requires more credits, or fewer max_tokens. You requested up to 1000000 tokens, but can only afford 9671. To increase, visit https://openrouter.ai/settings/credits and add more credits"))).toBe(true);
    expect(requestRefused(new Error("Custom stream failed (400): max_tokens exceeds the model's limit"))).toBe(true);
    expect(requestRefused(new Error("the call failed", { cause: new Error("HTTP 400: requested length is over what this endpoint serves") }))).toBe(true);
    // Statuses and words no rule reads a limit from: a 413, a 422.
    expect(requestRefused(new Error("Custom stream failed (413): Payload Too Large"))).toBe(true);
    expect(requestRefused(new Error("Proxy error, status: 422: the request can't be processed as sent"))).toBe(true);
    // Busy, a server's failure, or no status at all is no refusal of the request.
    expect(requestRefused(new Error("OpenRouter stream failed (429): rate limited"))).toBe(false);
    expect(requestRefused(new Error("OpenRouter stream failed (500): max_tokens upstream error"))).toBe(false);
    expect(requestRefused(new Error("fetch failed"))).toBe(false);
  });

  test("a refusal speaks of the answer room in a 413, a 422 or words of tokens, credits, a length or a context; never in a 401, 403 or 404 (the final correctness review, finding 2)", () => {
    expect(roomRefused(new Error("OpenRouter stream failed (402): This request requires more credits, or fewer max_tokens. You requested up to 1000000 tokens, but can only afford 9671"))).toBe(true);
    expect(roomRefused(new Error("Custom stream failed (400): max_tokens exceeds the model's limit"))).toBe(true);
    expect(roomRefused(new Error("the call failed", { cause: new Error("HTTP 400: requested length is over what this endpoint serves") }))).toBe(true);
    expect(roomRefused(new Error("Custom stream failed (400): this model's context is full"))).toBe(true);
    expect(roomRefused(new Error("Custom stream failed (413): Payload Too Large"))).toBe(true);
    expect(roomRefused(new Error("Proxy error, status: 422: the request can't be processed as sent"))).toBe(true);
    // A key, an account's access, a model the provider hasn't: refused, so the port's fallback still asks once at the role's room, but no room is the fix.
    for (const e of [new Error("Custom stream failed (401): Invalid API key"), new Error("Custom stream failed (403): this key can't use tokens on this model"), new Error("Custom stream failed (404): model not found")]) {
      expect(requestRefused(e)).toBe(true);
      expect(roomRefused(e)).toBe(false);
    }
    // A 400 that says nothing of the room, a busy provider, or no status at all.
    expect(roomRefused(new Error("Custom stream failed (400): messages must alternate"))).toBe(false);
    expect(roomRefused(new Error("OpenRouter stream failed (429): too many tokens per minute"))).toBe(false);
    expect(roomRefused(new Error("fetch failed: context deadline"))).toBe(false);
  });

  test("the port asks again once at that limit, logs it, and its answer says so; a second refusal isn't asked again", async () => {
    const asked: number[] = [];
    const logs: string[] = [];
    let cap = 16384;
    const host = {
      models: {
        quiet: async (r: QuietRequest): Promise<QuietResult> => {
          asked.push(r.maxTokens);
          if (r.maxTokens > cap) throw new Error(`Provider error (400): max_tokens is too large: ${r.maxTokens}. This model supports at most 16384 completion tokens, whereas you provided ${r.maxTokens}.`);
          return { content: "{}", finishReason: "stop", tokens: 10, tokensIn: 5, tokensOut: 5 };
        },
      },
      log: (_level: string, line: string) => void logs.push(line),
    };
    const answer = await depthPort(host as never, async () => defaultSettings(), "u1", { day: null, rooms: new Map() })("gm", [{ role: "user", content: "hi" }], { maxTokens: 32768 });
    expect(asked).toEqual([32768, 16384]);
    expect(answer.capped).toEqual({ asked: 32768, limit: 16384 });
    expect(logs.some((l) => l.includes("asking again at 16384"))).toBe(true);
    // The model takes less than its provider said: the second refusal is the call's own.
    asked.length = 0;
    cap = 8192;
    await expect(depthPort(host as never, async () => defaultSettings(), "u1", { day: null, rooms: new Map() })("gm", [{ role: "user", content: "hi" }], { maxTokens: 32768 })).rejects.toThrow("max_tokens is too large");
    expect(asked).toEqual([32768, 16384]);
  });

  test("a refusal that states no limit, of the room or in other words, is asked again once at the role's own room, OpenRouter's 402 among them", async () => {
    const own = depthCall(defaultSettings(), "historian").maxTokens;
    const asked: number[] = [];
    const logs: string[] = [];
    let afford = own;
    const host = {
      models: {
        quiet: async (r: QuietRequest): Promise<QuietResult> => {
          asked.push(r.maxTokens);
          if (r.maxTokens > afford) throw new Error(`OpenRouter stream failed (402): This request requires more credits, or fewer max_tokens. You requested up to ${r.maxTokens} tokens, but can only afford ${afford + 1000}. To increase, visit https://openrouter.ai/settings/credits and add more credits`);
          return { content: "{}", finishReason: "stop", tokens: 10, tokensIn: 5, tokensOut: 5 };
        },
      },
      log: (_level: string, line: string) => void logs.push(line),
    };
    const rooms = new Map<string, number>();
    const port = depthPort(host as never, async () => defaultSettings(), "u1", { day: null, rooms });
    const answer = await port("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 });
    expect(asked).toEqual([1_000_000, own]);
    expect(answer.capped).toEqual({ asked: 1_000_000, limit: own });
    expect(logs.some((l) => l.includes(`no limit stated; asking again at the role's own room of ${own}`))).toBe(true);
    // Credits are no limit of the model's: nothing is kept, so the next call asks its room again.
    expect(rooms.size).toBe(0);
    // Refused at its own room too, the refusal is the call's own: asked once more, never again.
    asked.length = 0;
    afford = own - 1;
    await expect(port("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 })).rejects.toThrow("(402)");
    expect(asked).toEqual([1_000_000, own]);
    // A refusal in other words (a 413, a 422, a 400 naming no room), which may still be of the room asked, is asked again once at the role's own room too.
    asked.length = 0;
    let words = "Custom stream failed (422): the request can't be processed as sent";
    const other = depthPort({ ...host, models: { quiet: async (r: QuietRequest): Promise<QuietResult> => (asked.push(r.maxTokens), r.maxTokens > own ? Promise.reject(new Error(words)) : { content: "{}", finishReason: "stop", tokens: 10, tokensIn: 5, tokensOut: 5 }) } } as never, async () => defaultSettings(), "u1", { day: null, rooms });
    expect((await other("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 })).capped).toEqual({ asked: 1_000_000, limit: own });
    expect(asked).toEqual([1_000_000, own]);
    // One that refuses the request whatever its room fails as it did, after that one call more.
    asked.length = 0;
    words = "Custom stream failed (400): unknown field 'logit_bias'";
    const always = depthPort({ ...host, models: { quiet: async (r: QuietRequest): Promise<QuietResult> => (asked.push(r.maxTokens), Promise.reject(new Error(words))) } } as never, async () => defaultSettings(), "u1", { day: null, rooms });
    await expect(always("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 })).rejects.toThrow("logit_bias");
    expect(asked).toEqual([1_000_000, own]);
    // A call asked at its role's own room has no room to fall back to.
    asked.length = 0;
    await expect(always("historian", [{ role: "user", content: "hi" }])).rejects.toThrow("logit_bias");
    expect(asked).toEqual([own]);
  });

  test("a limit the model's own is kept for its connection and model, so later calls ask within it; a window's isn't", async () => {
    const asked: { model: string | null | undefined; room: number }[] = [];
    const host = {
      models: {
        quiet: async (r: QuietRequest): Promise<QuietResult> => {
          asked.push({ model: r.model, room: r.maxTokens });
          if (r.maxTokens > 393216) throw new Error(`DeepSeek stream failed (400): Invalid max_tokens value, the valid range of max_tokens is [1, 393216] (request_id: 234b186b-a0ff-4239-b73a-f79753363072)`);
          return { content: "{}", finishReason: "stop", tokens: 10, tokensIn: 5, tokensOut: 5 };
        },
      },
      log: () => undefined,
    };
    const settingsOn = (model: string) => {
      const s = defaultSettings();
      return { ...s, depth: { ...s.depth, roles: { ...s.depth.roles, historian: { ...s.depth.roles.historian, uses: "own" as const, own: { ...s.depth.roles.historian.own, connectionId: "c1", model } } } } };
    };
    const rooms = new Map<string, number>();
    const flash = depthPort(host as never, async () => settingsOn("deepseek-v4-flash"), "u1", { day: null, rooms });
    expect((await flash("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 })).capped).toEqual({ asked: 1_000_000, limit: 393216 });
    expect(asked.map((a) => a.room)).toEqual([1_000_000, 393216]);
    // The next call on that connection and model asks within it from the first attempt, and its answer says the room was held.
    asked.length = 0;
    const next = await depthPort(host as never, async () => settingsOn("deepseek-v4-flash"), "u2", { day: null, rooms })("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 });
    expect(asked).toEqual([{ model: "deepseek-v4-flash", room: 393216 }]);
    expect(next.capped).toEqual({ asked: 1_000_000, limit: 393216 });
    // A room under the limit is asked as it is.
    asked.length = 0;
    expect((await flash("historian", [{ role: "user", content: "hi" }], { maxTokens: 4096 })).capped).toBeUndefined();
    expect(asked.map((a) => a.room)).toEqual([4096]);
    // Another model on the connection learns its own.
    asked.length = 0;
    await depthPort(host as never, async () => settingsOn("deepseek-v4-pro"), "u1", { day: null, rooms })("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 });
    expect(asked.map((a) => a.room)).toEqual([1_000_000, 393216]);
    // What a context window leaves one call's input is that call's alone.
    const windowed = new Map<string, number>();
    const window = {
      models: {
        quiet: async (r: QuietRequest): Promise<QuietResult> => {
          if (r.maxTokens > 24768) throw new Error(`OpenRouter stream failed (400): This endpoint's maximum context length is 32768 tokens. However, you requested about ${r.maxTokens + 8000} tokens (8000 of text input, ${r.maxTokens} in the output).`);
          return { content: "{}", finishReason: "stop", tokens: 10, tokensIn: 5, tokensOut: 5 };
        },
      },
      log: () => undefined,
    };
    expect((await depthPort(window as never, async () => settingsOn("deepseek-v4-flash"), "u1", { day: null, rooms: windowed })("historian", [{ role: "user", content: "hi" }], { maxTokens: 1_000_000 })).capped).toEqual({ asked: 1_000_000, limit: 24768 });
    expect(windowed.size).toBe(0);
  });

  test("the truth link's room grows with what it reads, never below the GM's own", () => {
    expect(truthLinkRoom(16384, 2000)).toBe(16384);
    expect(truthLinkRoom(16384, 11279)).toBe(45116);
  });
});
