// A depth call's provenance (DEPTH-PLAN §9.0; conformance finding 13): the provider's own request id,
// where the usage the host passed holds one, rides on the port's answer and the turn's report of it.

import { describe, expect, test } from "bun:test";
import { depthPort, requestIdOf } from "../../src/backend/depth-model-host";
import { chatLinesOf, reporting } from "../../src/backend/depth/scene/reporting";
import type { PromptMessage } from "../../src/backend/host";
import { hiddenByCut } from "../../src/shared/depth-history";
import type { QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import type { LoopbackModelCall } from "../../src/shared/loopback";

describe("the upstream request id", () => {
  test("it is read from the provider's own usage, else the usage's top, and is null where the provider gave none", () => {
    expect(requestIdOf({ provider_raw: { id: "gen-123" } })).toBe("gen-123");
    expect(requestIdOf({ id: "chatcmpl-9" })).toBe("chatcmpl-9");
    expect(requestIdOf({ provider_raw: { id: "" } })).toBeNull();
    expect(requestIdOf(undefined)).toBeNull();
  });

  test("a depth call's answer carries it, and the turn reports it", async () => {
    let id: string | null = "gen-abc";
    const host = {
      models: {
        quiet: async (): Promise<QuietResult> => ({ content: "{}", finishReason: "stop", tokens: 10, tokensIn: 6, tokensOut: 4, model: "deepseek-v4-flash", ...(id ? { usage: { prompt_tokens: 6, provider_raw: { id } } } : {}) }),
      },
      log: () => undefined,
    };
    const calls: LoopbackModelCall[] = [];
    const port = reporting(depthPort(host as never, async () => defaultSettings(), "u1", { day: null }), { call: (c) => void calls.push(c) });
    const answer = await port("gm", [{ role: "user", content: "hi" }]);
    expect(answer.call?.requestId).toBe("gen-abc");
    id = null;
    await port("gm", [{ role: "user", content: "hi" }]);
    expect(calls.map((c) => c.requestId)).toEqual(["gen-abc", null]);
  });

  test("a refused call reports the request id the provider gave with its refusal (X17)", async () => {
    const host = {
      models: { quiet: async (): Promise<QuietResult> => ({ content: "", finishReason: "refusal", stopDetails: { category: "cyber" }, tokens: 9, tokensIn: 9, tokensOut: 0, usage: { prompt_tokens: 9, provider_raw: { id: "msg_refused" } } }) },
      log: () => undefined,
    };
    const calls: LoopbackModelCall[] = [];
    const port = reporting(depthPort(host as never, async () => defaultSettings(), "u1", { day: null }), { call: (c) => void calls.push(c) });
    await expect(port("author", [{ role: "user", content: "hi" }])).rejects.toThrow("category cyber");
    expect(calls.map((c) => c.requestId)).toEqual(["msg_refused"]);
  });
});

describe("reasoning as it is written (S17)", () => {
  test("a call that asks for its reasoning's pieces streams through the host and hands each reasoning piece on, not the content; one that doesn't stays a quiet call", async () => {
    const used: string[] = [];
    const host = {
      models: {
        quiet: async (): Promise<QuietResult> => {
          used.push("quiet");
          return { content: "{}", reasoning: "whole", finishReason: "stop", tokens: 2 };
        },
        stream: async (_r: unknown, _u: unknown, _s: unknown, onPiece: (p: { kind: "content" | "reasoning"; text: string }) => void): Promise<QuietResult> => {
          used.push("stream");
          for (const p of [{ kind: "reasoning" as const, text: "first " }, { kind: "content" as const, text: "{" }, { kind: "reasoning" as const, text: "then" }, { kind: "content" as const, text: "}" }]) onPiece(p);
          return { content: "{}", reasoning: "first then", finishReason: "stop", tokens: 2 };
        },
      },
      log: () => undefined,
    };
    const port = reporting(depthPort(host as never, async () => defaultSettings(), "u1", { day: null }), { call: () => undefined });
    const pieces: string[] = [];
    const answer = await port("author", [{ role: "user", content: "hi" }], { onReasoning: (t) => void pieces.push(t) });
    expect(pieces).toEqual(["first ", "then"]);
    expect(answer.reasoning).toBe("first then");
    await port("author", [{ role: "user", content: "hi" }]);
    expect(used).toEqual(["stream", "quiet"]);
  });
});

describe("each call's chat messages", () => {
  test("under the chat's cutoff, each reported call carries the range of the kept messages its request held, and one that held none says 0", async () => {
    // #0–#5 in the chat; "Keep the latest 3" leaves #3–#5 in the prompt.
    const prompt: PromptMessage[] = [{ role: "system", content: "The preset.", history: false, worldInfo: false }, ...[0, 1, 2, 3, 4, 5].map((i) => ({ role: i % 2 ? "assistant" : "user", content: `Line ${i} of the chat.`, history: true, worldInfo: false, sourceIndex: i }))];
    const gone = new Set(hiddenByCut(prompt, { keep: "last", count: 3 }));
    const chat = chatLinesOf(prompt.filter((_, i) => !gone.has(i)));
    const calls: LoopbackModelCall[] = [];
    const port = reporting(async () => ({ text: "{}", usage: { tokensIn: 1, tokensOut: 1 } }), { call: (c) => void calls.push(c) }, () => 0, chat);
    // The narrator's frame holds the recent window; the author holds the player's message verbatim; the GM's check holds none; a line before the cutoff never counts.
    await port("narrator", [{ role: "system", content: "Voice." }, { role: "user", content: "Line 3 of the chat." }, { role: "assistant", content: "Line 4 of the chat." }, { role: "user", content: "Line 5 of the chat." }]);
    await port("author", [{ role: "user", content: "The player said: Line 5 of the chat. And earlier: Line 1 of the chat." }]);
    await port("check", [{ role: "user", content: "Is this passage faithful?" }]);
    expect(calls.map((c) => [c.role, c.history])).toEqual([
      ["narrator", { first: 3, last: 5, count: 3 }],
      ["author", { first: 5, last: 5, count: 1 }],
      ["check", { first: 0, last: 0, count: 0 }],
    ]);
  });
});
