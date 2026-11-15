// The provider endpoint's answers that the end-to-end tests do not reach: a reply asked for whole, a
// request with no tag passed through RPH's model layer, the model list, a tag RPE cannot read, another
// user's chat, a turn that fails while it streams, and a long silent turn kept alive inside Lumiverse's
// ten minutes, which the stand-in Lumiverse watches as it watches any generation (`test/standin/registry.ts`). Each response is read the way
// Lumiverse reads it (`test/standin/steps.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import type { PassRequest, PassSink } from "rp-harness/contract";
import { modelsEndpoint, providerEndpoint, type ProviderDeps, type TurnPlayer } from "../../src/adapter/lumiverse/provider";
import { TAG_FIELD, textHash, type Tag } from "../../src/adapter/lumiverse/wire";
import { FakeClock } from "../standin/clock";
import { StandInDb } from "../standin/db";
import { StandIn, type Outcome } from "../standin/lumiverse";
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

const usage = { calls: 1, input: 7, cacheRead: 0, cacheWrite: 0, output: 2 };

function endpoint(play: TurnPlayer["play"], options: { passed?: PassRequest[]; clock?: FakeClock } = {}): (r: Request) => Promise<Response> {
  const clock = options.clock ?? new FakeClock();
  const deps: ProviderDeps = {
    user: "user-a",
    allowed: (r) => r.headers.get("authorization") === "Bearer rpe_key",
    window: async () => null,
    // Every tag here carries the extension's cut; the chat's rows are not there, so Lumiverse's own clipping is not known.
    reads: { rows: async () => null, joining: async () => ({ post: "none", collapse: false }), messageLimit: async () => null },
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
    turns: { play },
    clock,
  };
  return providerEndpoint(deps);
}

const request = (body: Record<string, unknown>): Request => new Request("http://rpe/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer rpe_key" }, body: JSON.stringify(body) });
const messages = [
  { role: "system", content: "Rules." },
  { role: "user", content: "Hello." },
];

/**
 * The stand-in Lumiverse with RPE's endpoint on a turn the test plays as the connection's server, a chat of one line in a database, and the tag the extension would add given by the
 * test as a parameter of each generation; every open database is closed after each test.
 */
const databases: StandInDb[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function standIn(play: TurnPlayer["play"], clock = new FakeClock()): StandIn {
  const lv = new StandIn();
  lv.clock = clock;
  const db = new StandInDb();
  databases.push(db);
  db.write({ user: [{ id: "user-a", name: "Ada", email: "ada@example.invalid", username: "ada" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
  lv.db = db;
  lv.servers.set("http://rpe", endpoint(play, { clock }));
  lv.connections.set("conn-rpe", { id: "conn-rpe", base: "http://rpe/v1", key: "rpe_key", model: "rpe" });
  lv.presets.set("preset-a", { id: "preset-a", name: "A", blocks: [{ id: "b-rules", name: "Rules", role: "system", content: "Rules." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
  lv.addChat({ id: "chat-a", user: "user-a", character: { id: "char-a", name: "Ilsa" }, messages: [{ id: "m1", role: "user", content: "Hello.", index: 1 }] });
  return lv;
}

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

  test("a turn that fails while it streams ends the reply with its error and Lumiverse keeps what it had, and one that ends without saying so ends it cleanly", async () => {
    const failed = standIn(async (_turn, out) => {
      out.content("Half a ");
      throw new Error("the model went away");
    });
    const out = await failed.generate({ chat: "chat-a", connection: "conn-rpe", preset: "preset-a", parameters: { [TAG_FIELD]: tag } });
    expect(out.error).toBe("the model went away");
    // The message Lumiverse made for the reply keeps the words that came, with the error beside them.
    expect(failed.chats.get("chat-a")!.messages.map((m) => m.content)).toEqual(["Hello.", "Half a "]);
    expect(failed.db!.rows("SELECT extra FROM messages WHERE id = ?", out.messageId!).map((r) => JSON.parse(String(r.extra)).generationOutcomeBySwipe)).toEqual([[{ error: "the model went away" }]]);
    const quiet = standIn(async (_turn, out2) => out2.content("Done."));
    const done = await quiet.generate({ chat: "chat-a", connection: "conn-rpe", preset: "preset-a", parameters: { [TAG_FIELD]: tag } });
    expect(done.error).toBeNull();
    expect(done.reply).toMatchObject({ content: "Done.", finishReason: "stop" });
    expect(quiet.chats.get("chat-a")!.messages.map((m) => m.content)).toEqual(["Hello.", "Done."]);
  });

  // Lumiverse keeps a failed generation's message when it streamed any text or thinking and drops it
  // when it streamed none (`services/generate.service.ts`, `persistPartialContent`).
  test("a turn that ends with no reply after its progress line puts its line for the kept message in the thinking too, so the empty message Lumiverse keeps says why; the detail goes in the error alone", async () => {
    const line = "The model's provider failed before a reply was written: the gateway answered 502.";
    const kept = "The model's provider failed before a reply was written.";
    const lv = standIn(async (_turn, out) => {
      out.progress("Reading the scene.");
      out.error(line, kept);
    });
    const out = await lv.generate({ chat: "chat-a", connection: "conn-rpe", preset: "preset-a", parameters: { [TAG_FIELD]: tag } });
    expect(out.error).toBe(line);
    // The empty message Lumiverse keeps holds the thinking: the progress line and the kept line, and not the detail.
    expect(lv.chats.get("chat-a")!.messages.map((m) => m.content)).toEqual(["Hello.", ""]);
    expect(lv.db!.rows("SELECT extra FROM messages WHERE id = ?", out.messageId!).map((r) => JSON.parse(String(r.extra)).reasoningBySwipe)).toEqual([[`Reading the scene.\n${kept}\n`]]);
    expect(JSON.stringify(lv.events.find((e) => e.event === "GENERATION_ENDED")!.payload)).toContain(line);
  });

  test("a turn that ends with no reply before anything was streamed ends with the error alone, and Lumiverse keeps no message", async () => {
    const line = "The turn could not be played: no connection.";
    const lv = standIn(async (_turn, out) => out.error(line));
    const out = await lv.generate({ chat: "chat-a", connection: "conn-rpe", preset: "preset-a", parameters: { [TAG_FIELD]: tag } });
    expect(out.error).toBe(line);
    expect(out.messageId).toBeUndefined();
    expect(lv.chats.get("chat-a")!.messages.map((m) => m.content)).toEqual(["Hello."]);
  });
});

describe("a long silent turn", () => {
  /**
   * A turn that works twelve minutes and then replies, played as Lumiverse plays any generation: through the stand-in's `generate()` on a clock the test moves,
   * RPE's endpoint the connection's server, the tag the extension would add given as a parameter; with `progressEvery`, it writes a progress line after each such
   * stretch of silence, as RPH does after `progress.silence` seconds. Each moment the stand-in counted text as it came (`touchActiveGeneration`) is kept.
   */
  async function silentTurn(progressEvery?: number): Promise<{ out: Outcome; touches: number[]; started: number; ended: number }> {
    const clock = new FakeClock();
    const play: TurnPlayer["play"] = async (_turn, out) => {
      const said = progressEvery === undefined ? [] : [1, 2].map((n) => clock.setTimeout(() => out.progress("Working on the scene."), n * progressEvery));
      const { promise, resolve } = Promise.withResolvers<void>();
      clock.setTimeout(resolve, 12 * 60_000);
      await promise;
      for (const handle of said) clock.clearTimeout(handle);
      out.content("At last the ferry docks.");
    };
    const lv = standIn(play, clock);
    const touches: number[] = [];
    const touch = lv.registry.touch.bind(lv.registry);
    lv.registry.touch = (id) => {
      touches.push(clock.now());
      touch(id);
    };
    const started = clock.now();
    const run = await lv.start({ chat: "chat-a", connection: "conn-rpe", preset: "preset-a", parameters: { [TAG_FIELD]: tag } });
    // The generation reaches the provider on its own later tasks, in real time; the clock moves only once the request is made.
    for (let i = 0; i < 2_000 && !lv.streams.has(run.generationId!); i++) await Bun.sleep(1);
    let out: Outcome | null = null;
    let ended = started;
    void run.done.then((o) => {
      out = o;
      ended = clock.now();
    });
    for (let minute = 0; minute < 13 && out === null; minute++) {
      await clock.advance(60_000);
      await Bun.sleep(1);
    }
    return { out: await run.done, touches, started, ended };
  }

  test("with progress lines at their least, one after 540 seconds of silence, a line reaches Lumiverse inside every ten minutes, and Lumiverse does not cut the turn", async () => {
    const run = await silentTurn(540_000);
    expect(run.out.error).toBeNull();
    expect(run.out.stopped).toBe(false);
    expect(run.out.reply?.content).toBe("At last the ferry docks.");
    expect(run.out.reply?.reasoning.trim()).toBe("Working on the scene.");
    // From the start to the reply, no stretch without text is ten minutes long.
    const moments = [run.started, ...run.touches, run.ended];
    expect(run.touches).toHaveLength(2);
    for (let i = 1; i < moments.length; i++) expect(moments[i]! - moments[i - 1]!).toBeLessThan(10 * 60_000);
  });

  test("the stream adds no line of its own: a turn that gives none for ten minutes is ended by Lumiverse's watchdog", async () => {
    const run = await silentTurn();
    expect(run.out.stopped).toBe(true);
    expect(run.out.reply?.reasoning).toBe("");
    expect(run.touches).toEqual([]);
    expect((run.ended - run.started) / 60_000).toBeGreaterThan(10);
    expect((run.ended - run.started) / 60_000).toBeLessThanOrEqual(11);
  });
});
