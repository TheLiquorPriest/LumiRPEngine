// A depth call's stable instructions carry a cache breakpoint where the connection takes one (§6.6).
import { describe, expect, test } from "bun:test";
import { cachedMessages } from "../../src/backend/depth-model-host";

const messages = [
  { role: "system" as const, content: "the author's instructions" },
  { role: "user" as const, content: "this turn's data" },
];
const anthropic = { limit: 4, system: false, lastMessage: false, tools: false, automatic: false };

describe("depth calls' cache breakpoints", () => {
  test("the leading system message is marked on a connection that takes breakpoints", () => {
    const out = cachedMessages(messages, anthropic);
    expect(out[0]?.parts).toEqual([{ type: "text", text: "the author's instructions", cache: true }]);
    expect(out[1]?.parts).toBeUndefined();
  });

  test("nothing is marked where the provider takes none or the connection spends them all", () => {
    expect(cachedMessages(messages, null).every((m) => m.parts === undefined)).toBe(true);
    expect(cachedMessages(messages, undefined).every((m) => m.parts === undefined)).toBe(true);
    expect(cachedMessages(messages, { limit: 2, system: true, lastMessage: true, tools: false, automatic: false }).every((m) => m.parts === undefined)).toBe(true);
  });
});
