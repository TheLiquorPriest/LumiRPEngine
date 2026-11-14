// The provider endpoint's answers that the end-to-end tests do not reach: a reply asked for whole, a
// tag RPE cannot read, another user's chat, and a turn that fails while it streams. Each response is
// read the way Lumiverse reads it (`test/standin/steps.ts`).

import { describe, expect, test } from "bun:test";
import { providerEndpoint, type ProviderDeps } from "../../src/adapter/lumiverse/provider";
import { streamedReply } from "../../src/adapter/lumiverse/stream";
import { TAG_FIELD, textHash, type Tag } from "../../src/adapter/lumiverse/wire";
import { readStream } from "../standin/steps";

const tag: Tag = {
  v: 1,
  user: "user-a",
  chat: "chat-a",
  generation: "gen-a",
  kind: "new",
  target: { message: "m2", swipe: 0 },
  speaker: { id: null, name: null },
  connection: "conn-rpe",
  preset: null,
  persona: null,
  cut: { answered: true, keep: null, removed: 0 },
  messages: [
    { role: "system", length: 6, hash: textHash("Rules.") },
    { role: "user", length: 6, hash: textHash("Hello."), history: true, source: { id: "m1", index: 1 } },
  ],
  lore: [],
};

function endpoint(play: ProviderDeps["play"], passed: unknown[] = []): (r: Request) => Promise<Response> {
  return providerEndpoint({
    user: "user-a",
    allowed: () => true,
    window: async () => null,
    blocks: async () => null,
    passThrough: async (body, signal) => {
      passed.push(body);
      return streamedReply(async (out) => out.content("passed"), { id: "p", model: "m", created: 0 }, signal);
    },
    play,
    now: () => 0,
  });
}

const request = (body: Record<string, unknown>): Request => new Request("http://rpe/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });
const messages = [
  { role: "system", content: "Rules." },
  { role: "user", content: "Hello." },
];

describe("the provider endpoint", () => {
  test("a reply asked for whole comes as one completion, its thinking beside it", async () => {
    const res = await endpoint(async (_turn, out) => {
      out.reasoning("Hm.");
      out.content("Hi.");
    })(request({ model: "rpe", messages, stream: false, [TAG_FIELD]: tag }));
    const body = (await res.json()) as { choices: { message: { content: string; reasoning_content: string }; finish_reason: string }[] };
    expect(body.choices[0]).toEqual({ index: 0, message: { role: "assistant", content: "Hi.", reasoning_content: "Hm." }, finish_reason: "stop" } as never);
  });

  test("a request with no tag is passed on as it came, and the turn is not played", async () => {
    const passed: unknown[] = [];
    let played = false;
    const res = await endpoint(async () => {
      played = true;
    }, passed)(request({ model: "rpe", messages, stream: true, temperature: 0.4 }));
    expect((await readStream(res)).content).toBe("passed");
    expect(passed).toEqual([{ model: "rpe", messages, stream: true, temperature: 0.4 }]);
    expect(played).toBe(false);
  });

  test("a tag RPE cannot read, and a chat of another user, are refused with words Lumiverse shows", async () => {
    const play = async (): Promise<void> => undefined;
    const old = await endpoint(play)(request({ model: "rpe", messages, stream: true, [TAG_FIELD]: { ...tag, v: 2 } }));
    expect(old.status).toBe(400);
    await expect(readStream(old)).rejects.toThrow("version 2");
    const foreign = await endpoint(play)(request({ model: "rpe", messages, stream: true, [TAG_FIELD]: { ...tag, user: "user-b" } }));
    expect(foreign.status).toBe(403);
  });

  test("a turn that fails while it streams ends the reply with its error, and one that ends without saying so ends it cleanly", async () => {
    const failed = await endpoint(async (_turn, out) => {
      out.content("Half a ");
      throw new Error("the model went away");
    })(request({ model: "rpe", messages, stream: true, [TAG_FIELD]: tag }));
    await expect(readStream(failed)).rejects.toThrow("the model went away");
    const quiet = await endpoint(async (_turn, out) => out.content("Done."))(request({ model: "rpe", messages, stream: true, [TAG_FIELD]: tag }));
    expect(await readStream(quiet)).toMatchObject({ content: "Done.", finishReason: "stop" });
  });
});
