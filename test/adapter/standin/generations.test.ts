// What the stand-in Lumiverse gives the host that drives it, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): a message
// made by the one `createMessage`, a chat's metadata merged with a key given as undefined removed, a generation that answers with its id as soon as it
// has begun, one generation of a chat at a time, the ten minutes of silence, Lumiverse's limits on the test's clock, and a scripted plain model answering at
// the delays the test sets. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { Block } from "../../standin/assembly";
import { FakeClock } from "../../standin/clock";
import { StandInDb } from "../../standin/db";
import { PROCESS_CLOCK, type HostClock } from "../../standin/host";
import { StandIn, type Outcome } from "../../standin/lumiverse";
import { ScriptedProvider, type PlainReply } from "../../standin/provider";

const USER = "user-quay";
const CHAT = "chat-quay";
const MODEL = "http://127.0.0.1:7883";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const MAIN: Block = { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay at dusk." };
const HISTORY: Block = { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" };

/** A stand-in Lumiverse with a chat on a quay: Edda's, with one line of the player's in it. */
function quay(): { lv: StandIn; db: StandInDb } {
  const lv = new StandIn();
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({ user: [{ id: USER, name: "Oona", email: "oona@example.invalid", username: "oona" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
  lv.db = db;
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [MAIN, HISTORY] });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "m0", role: "user", content: "USER-1 I walk the quay." }], metadata: { tide: "low", gulls: 3 } });
  return { lv, db };
}

describe("a message made through the one `createMessage` (`services/chats.service.ts:2638-2683`)", () => {
  test("is saved under the name given, with what its caller's body carried beside the text, then told", () => {
    const { lv, db } = quay();
    const id = lv.createMessage(CHAT, { role: "assistant", content: "A line of Edda's.", name: "Edda the Elder", characterId: "char-edda", extra: { mood: "wry" } });
    const row = db.rows("SELECT name, is_user, content, extra FROM messages WHERE id = ?", id)[0]!;
    expect(row.name).toBe("Edda the Elder");
    expect(row.is_user).toBe(0);
    expect(row.content).toBe("A line of Edda's.");
    expect(JSON.parse(String(row.extra))).toEqual({ mood: "wry", character_id: "char-edda" });
    const sent = lv.events.filter((e) => e.event === "MESSAGE_SENT");
    expect(sent.length).toBe(1);
    // The user's own line, and a reply with no name, are named as they were before.
    const mine = lv.send(CHAT, "USER-2 I wave.");
    expect(db.rows("SELECT name FROM messages WHERE id = ?", mine)[0]!.name).toBe("User");
    expect(db.rows("SELECT name FROM messages WHERE id = ?", lv.reply(CHAT, "Edda waves back."))[0]!.name).toBe("Edda");
  });
});

describe("a chat's metadata merged (`services/chats.service.ts:5241-5244`; `db/chat-operations.ts:57-80`)", () => {
  test("replaces each key given, removes one given as undefined, and tells the keys that changed", () => {
    const { lv, db } = quay();
    lv.mergeChatMetadata(lv.chats.get(CHAT)!, { tide: "high", gulls: undefined, lamps: "lit" });
    expect(JSON.parse(String(db.rows("SELECT metadata FROM chats WHERE id = ?", CHAT)[0]!.metadata))).toEqual({ tide: "high", lamps: "lit" });
    const changed = lv.events.filter((e) => e.event === "CHAT_CHANGED").map((e) => (e.payload as { changedFields: string[] }).changedFields);
    expect(changed).toEqual([["metadata.tide", "metadata.gulls", "metadata.lamps"]]);
    // A key already as given is not a change.
    lv.mergeChatMetadata(lv.chats.get(CHAT)!, { tide: "high", gulls: undefined });
    expect(lv.events.filter((e) => e.event === "CHAT_CHANGED").map((e) => (e.payload as { changedFields: string[] }).changedFields)[1]).toEqual([]);
  });
});

describe("a generation started (`routes/generate.routes.ts`)", () => {
  test("answers with its id once it has begun, and `done` is its end; a dry run has no id; a chat the stand-in does not hold fails at once", async () => {
    const { lv } = quay();
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "normal" });
    expect(typeof run.generationId).toBe("string");
    const started = lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { generationId: string };
    expect(started.generationId).toBe(run.generationId!);
    const out = await run.done;
    expect(out.error).toBeNull();
    const dry = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "normal", dryRun: true });
    expect(dry.generationId).toBeNull();
    await dry.done;
    await expect(lv.start({ chat: "chat-nowhere", connection: "conn-model", preset: "preset-quay", type: "normal" })).rejects.toThrow("no such chat");
  });
});

// ---------------------------------------------------------------- one generation per chat, the ten minutes, the limits, the scripted model

const HANG = "http://127.0.0.1:7885";
const DOCK = "chat-dock";

/** A stand-in on the test's clock, its model a scripted provider answering each request with the next of `replies`. */
function scripted(clock: HostClock, ...replies: PlainReply[]): { lv: StandIn; db: StandInDb; provider: ScriptedProvider } {
  const { lv, db } = quay();
  lv.clock = clock;
  const provider = new ScriptedProvider(clock, ...replies);
  lv.servers.set(MODEL, provider.server);
  lv.addChat({ id: DOCK, user: USER, character: { id: "char-edda", name: "Edda" }, messages: [{ id: "d0", role: "user", content: "USER-D I walk the dock." }] });
  return { lv, db, provider };
}

/** Waits, in the process's own time, for a state the stand-in reaches by its own real-time ticks. */
async function until(what: string, check: () => boolean): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error(`gave up waiting for ${what}`);
}

/** The clock moved on a second at a time until the promise has settled (at most `limit` seconds), the generation's own ticks given room between. */
async function runOn<T>(clock: FakeClock, promise: Promise<T>, limit = 60): Promise<T> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < limit && !settled; i++) {
    await clock.advance(1_000);
    await Bun.sleep(1);
  }
  return await promise;
}

const stopped = (lv: StandIn): { generationId: string; chatId: string; content: string }[] => lv.events.filter((e) => e.event === "GENERATION_STOPPED").map((e) => e.payload as { generationId: string; chatId: string; content: string });

describe("Lumiverse's limits (`spindle/worker-host.ts:771`, `:3159-3163`, `:4937-4943`; `services/generate.service.ts:1617-1626`)", () => {
  test("Lumiverse's limits run on the test's clock at their real figures", async () => {
    // The proxy's thirty seconds.
    {
      const clock = new FakeClock();
      const { lv } = scripted(clock, { words: ["Fine."] });
      const ext = lv.install(["cors_proxy"]);
      lv.servers.set(HANG, () => new Promise<Response>(() => undefined));
      const asked = ext.cors(`${HANG}/slow`, { method: "GET", headers: {} }).then(
        () => "answered",
        (error: Error) => error.message,
      );
      let result = "waiting";
      void asked.then((r) => (result = r));
      await clock.advance(29_999);
      expect(result).toBe("waiting");
      await clock.advance(1);
      expect(await asked).toBe("The operation timed out.");
    }
    // The World Info interceptor's ten seconds, then the prompt interceptor's, each answered by nothing; the generation goes on with what it had.
    {
      const clock = new FakeClock();
      const { lv } = scripted(clock, { words: ["Fine."] });
      const ext = lv.install(["generation", "interceptor"]);
      ext.registerWorldInfoInterceptor(() => new Promise(() => undefined));
      ext.registerInterceptor(() => new Promise(() => undefined), {});
      const run = lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
      // The generation's own sweep, and the interceptor's limit.
      await until("the World Info interceptor to be asked", () => clock.pending >= 2);
      await clock.advance(9_999);
      expect(lv.log).not.toContain("World-info interceptor timed out after 10s; skipping");
      await clock.advance(1);
      expect(lv.log).toContain("World-info interceptor timed out after 10s; skipping");
      await until("the prompt interceptor to be asked", () => clock.pending >= 2);
      await clock.advance(9_999);
      expect(lv.log.some((line) => line.includes("timed out (10s)"))).toBe(false);
      await clock.advance(1);
      expect(lv.log).toContain(`[Spindle] Interceptor error from ${ext.id}: Interceptor from ${ext.id} timed out (10s)`);
      const out = await runOn(clock, run);
      expect(out.error).toBeNull();
      expect(out.reply?.content).toBe("Fine.");
    }
    // The new generation's two seconds for the one it stopped to tear down: here the first is held in its World Info interceptor, which does not heed a stop.
    {
      const clock = new FakeClock();
      const { lv } = scripted(clock, { words: ["Fine."] });
      lv.install(["generation"]).registerWorldInfoInterceptor(() => new Promise(() => undefined));
      const first = lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
      await until("the first generation to be held", () => clock.pending >= 2);
      const second = lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
      await until("the second generation to wait for the first", () => lv.registry.get(lv.registry.chatGeneration(USER, CHAT)!)?.stop.signal.aborted === true);
      await clock.advance(1_999);
      expect(lv.events.filter((e) => e.event === "GENERATION_STARTED")).toHaveLength(1);
      await clock.advance(1);
      await until("the second generation to begin", () => lv.events.filter((e) => e.event === "GENERATION_STARTED").length === 2);
      // The first ends as a stop once its own interceptor's ten seconds are over; the second goes on to its reply.
      const [one, two] = await runOn(clock, Promise.all([first, second]));
      expect(one.stopped).toBe(true);
      expect(two.error).toBeNull();
      expect(two.reply?.content).toBe("Fine.");
    }
  });
});

describe("one generation per chat (`services/generate.service.ts:1585-1660`)", () => {
  test("a second reply in a chat stops the first, a dry run takes no lock, and a background swipe is refused while one runs", async () => {
    const clock = new FakeClock();
    const slow: PlainReply = { words: ["First ", "words ", "here."], toWord: 1_000, between: 1_000, toEnd: 1_000 };
    const { lv, provider } = scripted(clock, slow, { words: ["Second."], toWord: 5_000 }, { words: ["Third."], toWord: 5_000 }, { words: ["Dock."] });
    const first = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    await until("the first request", () => provider.calls.length === 1);
    await clock.advance(2_000);
    expect(lv.streams.get(first.generationId!)!.content).toBe("First words ");

    // The second reply of the chat stops the first, which keeps what it had; no clock time passes in the stop.
    const second = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    const one = await first.done;
    expect(one.stopped).toBe(true);
    expect(stopped(lv)).toEqual([{ generationId: first.generationId!, chatId: CHAT, content: "First words " }]);
    expect(lv.chats.get(CHAT)!.messages.map((m) => m.content)).toEqual(["USER-1 I walk the quay.", "First words ", ""]);
    expect(lv.registry.chatGeneration(USER, CHAT)).toBe(second.generationId!);
    expect(lv.registry.count).toBe(1);

    // A dry run takes no lock and stops nothing; another chat's generation is its own.
    const dry = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", dryRun: true });
    expect(dry.error).toBeNull();
    expect(lv.registry.get(second.generationId!)!.stop.signal.aborted).toBe(false);
    const dock = await lv.start({ chat: DOCK, connection: "conn-model", preset: "preset-quay" });
    await until("the dock's request", () => provider.calls.length === 3);
    expect(lv.registry.count).toBe(2);
    expect(lv.registry.get(second.generationId!)!.stop.signal.aborted).toBe(false);

    // A background swipe is refused for what is not a swipe, for a target that is not an assistant's, and while the chat has a generation.
    await expect(lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "normal", backgroundSwipe: true })).rejects.toThrow("background_swipe requires an assistant swipe target");
    await expect(lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "swipe", backgroundSwipe: true, message: "m0" })).rejects.toThrow("Invalid background swipe target");
    await expect(lv.generate({ chat: DOCK, connection: "conn-model", preset: "preset-quay", type: "swipe", backgroundSwipe: true, message: "d0" })).rejects.toThrow("Invalid background swipe target");
    await expect(lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "swipe", backgroundSwipe: true })).rejects.toThrow("A generation is already running for this chat");
    expect(lv.registry.get(second.generationId!)!.stop.signal.aborted).toBe(false);

    // The Stop route: a stale id names nothing, and falls back to the chat when it is given.
    expect(lv.stop(USER, { generation: "gen-gone" })).toBe(false);
    expect(lv.stop(USER, { generation: "gen-gone", chat: CHAT })).toBe(true);
    expect((await second.done).stopped).toBe(true);
    expect(lv.stop(USER, { chat: CHAT })).toBe(false);
    expect(lv.stop("user-other", { generation: dock.generationId! })).toBe(false);
    await clock.advance(5_000);
    expect((await dock.done).error).toBeNull();
    expect(lv.registry.count).toBe(0);
  });

  test("a background swipe, where none runs, makes its swipe and leaves the one the reader has selected", async () => {
    const clock = new FakeClock();
    const { lv, db, provider } = scripted(clock, { words: ["Another line."] });
    const message = lv.reply(CHAT, "Edda waves back.");
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type: "swipe", backgroundSwipe: true });
    await until("the request", () => provider.calls.length === 1);
    const staged = db.rows("SELECT swipes, swipe_id, content FROM messages WHERE id = ?", message)[0]!;
    expect(JSON.parse(String(staged.swipes))).toEqual(["Edda waves back.", ""]);
    expect([staged.swipe_id, staged.content]).toEqual([0, "Edda waves back."]);
    await clock.advance(0);
    const out = await run.done;
    expect(out.error).toBeNull();
    const saved = db.rows("SELECT swipes, swipe_id, content FROM messages WHERE id = ?", message)[0]!;
    expect(JSON.parse(String(saved.swipes))).toEqual(["Edda waves back.", "Another line."]);
    expect([saved.swipe_id, saved.content]).toEqual([0, "Edda waves back."]);
    expect(lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload).toMatchObject({ backgroundSwipe: true, targetMessageId: message, targetSwipeId: 1 });
  });
});

describe("the ten-minute cut (`services/generation/active-generation-registry.ts:140-158`; `services/generate.service.ts:3793-3815`, `:3867-3873`)", () => {
  const MINUTE = 60_000;

  /** One generation played on a clock the test moves, ten seconds at a time, until it ends: its outcome, and the minutes it took. */
  async function played(reply: PlainReply, parameters?: Record<string, unknown>): Promise<{ out: Outcome; minutes: number; lv: StandIn }> {
    const clock = new FakeClock();
    const { lv, provider } = scripted(clock, reply);
    const begun = clock.now();
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", ...(parameters !== undefined ? { parameters } : {}) });
    await until("the request", () => provider.calls.length === 1);
    // The generation ends when its terminal event is told; its breakdown follows on a later task of the process's own.
    const ended = (): boolean => lv.events.some((e) => e.event === "GENERATION_ENDED" || e.event === "GENERATION_STOPPED");
    for (let t = 0; t < 30 * MINUTE && !ended(); t += 10_000) await clock.advance(10_000);
    const minutes = (clock.now() - begun) / MINUTE;
    return { out: await run.done, minutes, lv };
  }

  test("silence is cut between ten and eleven minutes; a progress line keeps it alive; a whole reply cannot be kept alive", async () => {
    // Nothing for twelve minutes: ended by the sweep that follows the tenth minute, as a stop, with nothing kept.
    const silent = await played({ words: ["Late."], toWord: 12 * MINUTE });
    expect(silent.out.stopped).toBe(true);
    expect(silent.minutes).toBeGreaterThan(10);
    expect(silent.minutes).toBeLessThanOrEqual(11);
    expect(stopped(silent.lv)).toHaveLength(1);
    expect(silent.lv.chats.get(CHAT)!.messages.map((m) => m.content)).toEqual(["USER-1 I walk the quay."]);

    // One line of thinking at nine minutes keeps it alive for nine more: the reply at eighteen comes inside every ten, and is saved.
    const alive = await played({ thinking: ["Working on the scene."], toThinking: 9 * MINUTE, words: ["At last."], toWord: 18 * MINUTE });
    expect(alive.out.error).toBeNull();
    expect(alive.out.stopped).toBe(false);
    expect(alive.out.reply?.content).toBe("At last.");
    expect(alive.out.reply?.reasoning).toBe("Working on the scene.");
    expect(alive.minutes).toBe(18);
    // The same line a minute late (eleven) is too late.
    const late = await played({ thinking: ["Working on the scene."], toThinking: 11 * MINUTE, words: ["At last."], toWord: 18 * MINUTE });
    expect(late.out.stopped).toBe(true);
    expect(late.minutes).toBeLessThanOrEqual(11);

    // A stream that sends comment lines and chunks with no text all the while is as silent as one that sends nothing.
    const chatty = await played({ words: ["Late."], toWord: 12 * MINUTE, keepAlive: 30_000 });
    expect(chatty.out.stopped).toBe(true);
    expect(chatty.minutes).toBeGreaterThan(10);
    expect(chatty.minutes).toBeLessThanOrEqual(11);

    // A reply asked for whole is one call: nothing in it arrives before its end, so it is cut all the same, thinking or none, and answered if it comes within ten minutes.
    const whole = await played({ thinking: ["Working on the scene."], toThinking: 9 * MINUTE, words: ["Late."], toEnd: 12 * MINUTE }, { _streaming: false });
    expect(whole.out.stopped).toBe(true);
    expect(whole.minutes).toBeGreaterThan(10);
    expect(whole.minutes).toBeLessThanOrEqual(11);
    const quick = await played({ words: ["Just in time."], toEnd: 9 * MINUTE }, { _streaming: false });
    expect(quick.out.error).toBeNull();
    expect(quick.out.reply?.content).toBe("Just in time.");
    expect(quick.minutes).toBe(9);
  });

  test("the wait for the scheduler's admission is not silence: a generation queued behind another for longer than ten minutes is not cut, and its ten minutes begin when it is admitted", async () => {
    const clock = new FakeClock();
    // The first answers a word every five minutes for thirty; the second, once admitted, in one.
    const { lv, provider } = scripted(clock, { words: ["a", "b", "c", "d", "e", "f"], toWord: 5 * MINUTE, between: 5 * MINUTE }, { words: ["Dock."], toWord: MINUTE });
    lv.inference.concurrency = 1;
    const first = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    await until("the first request", () => provider.calls.length === 1);
    const second = await lv.start({ chat: DOCK, connection: "conn-model", preset: "preset-quay" });
    await until("the second generation to wait", () => lv.registry.get(second.generationId!)?.waitingForInference === true);
    for (let i = 0; i < 5; i++) await clock.advance(5 * MINUTE);
    // Twenty-five minutes in, the second has waited far past ten and is still waiting; the first is still alive.
    expect(lv.registry.get(second.generationId!)).toMatchObject({ waitingForInference: true });
    expect(lv.registry.get(second.generationId!)!.stop.signal.aborted).toBe(false);
    expect(provider.calls).toHaveLength(1);
    await clock.advance(5 * MINUTE);
    expect((await first.done).error).toBeNull();
    await until("the second request", () => provider.calls.length === 2);
    const admitted = clock.now();
    expect(lv.registry.get(second.generationId!)).toMatchObject({ waitingForInference: false, lastTokenAt: admitted });
    await clock.advance(MINUTE);
    const out = await second.done;
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe("Dock.");
  });
});

describe("a scripted plain model (`test/standin/provider.ts`)", () => {
  /** What the stand-in's stream has shown of a generation, as the player's streaming bubble holds it. */
  const shown = (lv: StandIn, id: string): { reasoning: string; content: string } => ({ reasoning: lv.streams.get(id)!.reasoning, content: lv.streams.get(id)!.content });

  test("a scripted plain reply streams its first thinking, its first word, each next word and its end at the delays the test set, on the test's clock", async () => {
    const clock = new FakeClock();
    const { lv, provider } = scripted(clock, { thinking: ["Weighing it."], toThinking: 1_000, words: ["One ", "two ", "three."], toWord: 3_000, between: 500, toEnd: 700, usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    await until("the request", () => provider.calls.length === 1);
    expect(provider.calls[0]!.body.stream).toBe(true);
    const at = async (ms: number): Promise<{ reasoning: string; content: string }> => {
      await clock.advance(ms);
      return shown(lv, run.generationId!);
    };
    // Each moment, one tick before it and on it.
    expect(await at(999)).toEqual({ reasoning: "", content: "" });
    expect(await at(1)).toEqual({ reasoning: "Weighing it.", content: "" });
    expect(await at(1_999)).toEqual({ reasoning: "Weighing it.", content: "" });
    expect(await at(1)).toEqual({ reasoning: "Weighing it.", content: "One " });
    expect(await at(499)).toEqual({ reasoning: "Weighing it.", content: "One " });
    expect(await at(1)).toEqual({ reasoning: "Weighing it.", content: "One two " });
    expect(await at(500)).toEqual({ reasoning: "Weighing it.", content: "One two three." });
    // The end comes seven hundred after the last word, not before.
    await clock.advance(699);
    expect(lv.registry.count).toBe(1);
    await clock.advance(1);
    const out = await run.done;
    expect(out.error).toBeNull();
    expect(out.reply).toMatchObject({ content: "One two three.", reasoning: "Weighing it.", finishReason: "stop", usage: { total_tokens: 8 } });
  });

  test("asked for whole, it answers once, at its end, and the request is the stand-in's own body", async () => {
    const clock = new FakeClock();
    const { lv, provider } = scripted(clock, { thinking: ["Weighing it."], toThinking: 1_000, words: ["One ", "two."], toWord: 2_000, between: 500, toEnd: 500 });
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay", parameters: { _streaming: false } });
    await until("the request", () => provider.calls.length === 1);
    expect(provider.calls[0]!.body.stream).toBe(false);
    expect(provider.calls[0]!.body.model).toBe("model");
    expect(provider.calls[0]!.headers.authorization).toBe("Bearer model-key");
    await clock.advance(2_999);
    expect(lv.registry.count).toBe(1);
    await clock.advance(1);
    const out = await run.done;
    expect(out.reply).toMatchObject({ content: "One two.", reasoning: "Weighing it." });
  });

  test("on the real clock the same delays pass in real time", async () => {
    const { lv, provider } = scripted(PROCESS_CLOCK, { thinking: ["Weighing it."], toThinking: 60, words: ["One ", "two."], toWord: 120, between: 60, toEnd: 60 });
    lv.clock = PROCESS_CLOCK;
    const run = await lv.start({ chat: CHAT, connection: "conn-model", preset: "preset-quay" });
    await until("the request", () => provider.calls.length === 1);
    const requested = performance.now();
    const seen: { what: string; ms: number }[] = [];
    while (lv.registry.count > 0 && performance.now() - requested < 2_000) {
      const now = shown(lv, run.generationId!);
      for (const [what, text] of [["thinking", now.reasoning], ["first word", now.content.slice(0, 1)], ["second word", now.content.length > 4 ? "x" : ""]] as const) {
        if (text !== "" && !seen.some((s) => s.what === what)) seen.push({ what, ms: performance.now() - requested });
      }
      await Bun.sleep(2);
    }
    const out = await run.done;
    expect(out.reply?.content).toBe("One two.");
    expect(seen.map((s) => s.what)).toEqual(["thinking", "first word", "second word"]);
    // Each no sooner than its delay (a little early is the polling's own, within the clock's tick), and not far past it.
    const expected = [60, 120, 180];
    seen.forEach((s, i) => {
      expect(s.ms).toBeGreaterThanOrEqual(expected[i]! - 15);
      expect(s.ms).toBeLessThan(expected[i]! + 300);
    });
  });
});
