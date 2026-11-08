// A depth call's provenance (DEPTH-PLAN §9.0; conformance finding 13): the provider's own request id,
// where the usage the host passed holds one, rides on the port's answer and the turn's report of it.

import { describe, expect, test } from "bun:test";
import { depthPort, requestIdOf } from "../../src/backend/depth-model-host";
import { reporting } from "../../src/backend/depth/scene/reporting";
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
});
