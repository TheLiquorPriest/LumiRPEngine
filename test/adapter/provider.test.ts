// The provider endpoint's answers that the end-to-end tests do not reach: a reply asked for whole, a
// request with no tag passed through RPH's model layer, the model list, a tag RPE cannot read, another
// user's chat, a turn that fails while it streams, and a long silent turn kept alive inside Lumiverse's
// ten minutes. Each response is read the way Lumiverse reads it (`test/standin/steps.ts`).

import { describe, expect, test } from "bun:test";
import type { PassRequest, PassSink } from "rp-harness/contract";
import { modelsEndpoint, providerEndpoint, type ProviderDeps, type TurnPlayer } from "../../src/adapter/lumiverse/provider";
import { TAG_FIELD, textHash, type Tag } from "../../src/adapter/lumiverse/wire";
import { FakeClock } from "../standin/clock";
import { readStream, watchGeneration } from "../standin/steps";

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

const usage = { calls: 1, input: 7, cacheRead: 0, cacheWrite: 0, output: 2 };

function endpoint(play: TurnPlayer["play"], options: { passed?: PassRequest[]; clock?: FakeClock; keepAliveMs?: number } = {}): (r: Request) => Promise<Response> {
  const clock = options.clock ?? new FakeClock();
  const deps: ProviderDeps = {
    user: "user-a",
    allowed: (r) => r.headers.get("authorization") === "Bearer rpe_key",
    window: async () => null,
    blocks: async () => null,
    models: {
      pass: async (request: PassRequest, sink: PassSink) => {
        options.passed?.push(request);
        sink.reasoning("Weighing it.");
        sink.content("Passed on.");
        sink.finish({ content: "Passed on.", reasoning: "Weighing it.", finishReason: "stop", usage });
      },
    },
    passConnection: () => "conn-author",
    unpassable: () => null,
    modelNames: () => ["rpe"],
    turns: { play, standbyLine: () => "Working on the scene." },
    clock,
    ...(options.keepAliveMs !== undefined ? { keepAliveMs: options.keepAliveMs } : {}),
  };
  return providerEndpoint(deps);
}

const request = (body: Record<string, unknown>): Request => new Request("http://rpe/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer rpe_key" }, body: JSON.stringify(body) });
const messages = [
  { role: "system", content: "Rules." },
  { role: "user", content: "Hello." },
];

describe("the provider endpoint", () => {
  test("a reply asked for whole comes as one completion, its thinking beside it", async () => {
    const res = await endpoint(async (_turn, out) => {
      out.reasoning("Hm.");
      out.progress("reading the scene");
      out.content("Hi.");
    })(request({ model: "rpe", messages, stream: false, [TAG_FIELD]: tag }));
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as { choices: { message: Record<string, unknown>; finish_reason: string }[] };
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0]).toEqual({ index: 0, message: { role: "assistant", content: "Hi.", reasoning_content: "Hm.\nreading the scene\n" }, finish_reason: "stop" } as never);
  });

  test("a request with no tag is passed through to the connection set for such requests, streamed or whole as it asked, and no turn is played", async () => {
    const passed: PassRequest[] = [];
    let played = false;
    const play = async (): Promise<void> => {
      played = true;
    };
    const streamed = await endpoint(play, { passed })(request({ model: "rpe", messages, stream: true, temperature: 0.4 }));
    expect(await readStream(streamed)).toMatchObject({ content: "Passed on.", reasoning: "Weighing it.", finishReason: "stop", usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } });
    expect(passed).toEqual([{ connection: "conn-author", body: { model: "rpe", messages, stream: true, temperature: 0.4 } }]);
    const whole = (await (await endpoint(play, { passed })(request({ model: "rpe", messages, stream: false }))).json()) as { choices: { message: { content: string } }[] };
    expect(whole.choices[0]?.message.content).toBe("Passed on.");
    expect(played).toBe(false);
  });

  test("the model list names the models RPE's connection may name, behind the provider key", async () => {
    const list = modelsEndpoint({ allowed: (r) => r.headers.get("authorization") === "Bearer rpe_key", modelNames: () => ["rpe", "rpe-two"] });
    const res = await list(new Request("http://rpe/v1/models", { headers: { authorization: "Bearer rpe_key" } }));
    expect(((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(["rpe", "rpe-two"]);
    expect((await list(new Request("http://rpe/v1/models", { headers: { authorization: "Bearer other" } }))).status).toBe(401);
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

describe("a long silent turn", () => {
  /** A turn that says nothing for twelve minutes and then replies, read as Lumiverse reads and watches it. */
  async function silentTurn(keepAliveMs?: number): Promise<Awaited<ReturnType<typeof watchGeneration>>> {
    const clock = new FakeClock();
    const play: TurnPlayer["play"] = async (_turn, out) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      clock.setTimeout(resolve, 12 * 60_000);
      await promise;
      out.content("At last the ferry docks.");
    };
    const res = await endpoint(play, { clock, ...(keepAliveMs !== undefined ? { keepAliveMs } : {}) })(request({ model: "rpe", messages, stream: true, [TAG_FIELD]: tag }));
    const watched = watchGeneration(res, clock);
    for (let minute = 0; minute < 13; minute++) await clock.advance(60_000);
    return await watched;
  }

  test("a progress line goes into the thinking block inside every ten minutes, so Lumiverse never ends it", async () => {
    const run = await silentTurn();
    expect(run.aborted).toBe(false);
    expect(run.content).toBe("At last the ferry docks.");
    const lines = run.texts.filter((t) => t.kind === "reasoning");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.text.trim() === "Working on the scene.")).toBe(true);
    // From the start to the reply, no stretch without text is ten minutes long.
    const moments = [run.started, ...run.texts.map((t) => t.at)];
    for (let i = 1; i < moments.length; i++) expect(moments[i]! - moments[i - 1]!).toBeLessThan(10 * 60_000);
  });

  test("with the line held back past ten minutes, Lumiverse's watchdog ends the generation: why the line comes inside", async () => {
    const run = await silentTurn(11 * 60_000);
    expect(run.aborted).toBe(true);
  });
});
