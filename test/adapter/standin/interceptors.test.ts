// The prompt interceptors as Lumiverse calls them (staging at a70f4ed2; paths are Lumiverse's `src/`): its limit, a setting read at each run
// (`services/spindle-settings.service.ts:6-8`, `:22-28`, `:54-62`; `spindle/worker-host.ts:3159-3163`), the filters and the user a registration
// is for (`spindle/interceptor-pipeline.ts:56-82`, `:115-121`), and what a stop of the extension or of the generation does to a call under way
// (`spindle/worker-host.ts:1563-1576`; `spindle/interceptor-pipeline.ts:97-101`, `:187-212`). The extensions are installed, granted and enabled as an
// admin does, and the clock is the test's. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { Block } from "../../standin/assembly";
import { FakeClock } from "../../standin/clock";
import { StandInDb } from "../../standin/db";
import type { InterceptorOptions } from "../../standin/host";
import { StandIn, type Outcome } from "../../standin/lumiverse";
import type { Extension, Manifest, Viewer } from "../../standin/spindle";

const QUAY = "user-quay";
const PIER = "user-pier";
const CHAT = "chat-quay";
const DOCK = "chat-dock";
const PIER_CHAT = "chat-pier";
const MODEL = "http://127.0.0.1:7886";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };
const ADMIN: Viewer = { userId: QUAY, role: "admin" };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const MAIN: Block = { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay at dusk." };
const HISTORY: Block = { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" };

/** A stand-in Lumiverse on the test's clock: Quay's two chats and Pier's one, the oldest account Quay's, a model that says one line. */
function quay(): { lv: StandIn; clock: FakeClock; db: StandInDb } {
  const lv = new StandIn();
  const clock = new FakeClock();
  lv.clock = clock;
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({
    user: [QUAY, PIER].map((id) => ({ id, name: id, email: `${id}@example.invalid`, username: id })),
    characters: [],
    chats: [],
    messages: [],
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  lv.db = db;
  lv.firstUser = QUAY;
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [MAIN, HISTORY], metadata: { ext_mode_on: { mode: "on" }, ext_mode_off: { mode: "on" }, ext_mode_has: { mode: "on" } } });
  // A card is one user's: Pier's chat has an Edda of its own.
  for (const [id, user] of [[CHAT, QUAY], [DOCK, QUAY], [PIER_CHAT, PIER]] as const) lv.addChat({ id, user, character: { id: `char-edda-${user}`, name: "Edda" }, messages: [{ id: `${id}-m0`, role: "user", content: "USER-1 I walk the quay." }] });
  return { lv, clock, db };
}

/** Installed, granted `interceptor` by an admin and enabled, as Lumiverse's install does: the id the manager gave it. */
async function add(lv: StandIn, identifier: string, code: Extension, manifest: Partial<Manifest> = {}, scope?: { user: string }): Promise<string> {
  const url = `https://example.invalid/${identifier}`;
  lv.spindle.remote(url, { branches: { main: { identifier, permissions: ["interceptor"], ...manifest } } });
  lv.spindle.provide(identifier, code);
  const info = lv.spindle.install(ADMIN, { github_url: url, branch: "main", ...(scope === undefined ? {} : { scope: "user", user_id: scope.user }) });
  lv.spindle.setPermissions(ADMIN, info.id, { grant: ["interceptor"] });
  await lv.spindle.enable(ADMIN, info.id);
  return info.id;
}

/** Waits, in the process's own time, for a state the stand-in reaches by its own real-time ticks (a generation's first two tasks run on the process's timers, as in `generations.test.ts`). */
async function until(what: string, check: () => boolean): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (check()) return;
    await Bun.sleep(1);
  }
  throw new Error(`gave up waiting for ${what}`);
}

/** The clock moved on a second at a time until the promise has settled (at most `limit` seconds): its value, and how many seconds that took. */
async function runOn<T>(clock: FakeClock, promise: Promise<T>, limit = 400): Promise<{ value: T; seconds: number }> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  const began = clock.now();
  for (let i = 0; i < limit && !settled; i++) {
    await clock.advance(1_000);
    await Bun.sleep(1);
  }
  return { value: await promise, seconds: Math.round((clock.now() - began) / 1_000) };
}

const generate = (lv: StandIn, chat = CHAT, extra: { type?: "swipe" | "normal"; dryRun?: boolean } = {}): Promise<Outcome> => lv.generate({ chat, connection: "conn-model", preset: "preset-quay", ...extra });

/** An extension whose required interceptor is asked and never answers. */
function silent(asked: { count: number }): Extension {
  return (api) => {
    api.registerInterceptor(() => {
      asked.count++;
      return new Promise(() => undefined);
    }, { required: true });
  };
}

describe("the interceptor's limit", () => {
  /** A generation held in an interceptor that never answers, run until it ends. */
  async function held(options: { manifest?: number; setting?: number; installedFor?: string; chat?: string }): Promise<{ seconds: number; error: string | null }> {
    const { lv, clock } = quay();
    if (options.setting !== undefined) lv.library.setSetting(options.installedFor ?? QUAY, "spindleSettings", { interceptorTimeoutMs: options.setting });
    const asked = { count: 0 };
    await add(lv, "ext_held", silent(asked), options.manifest === undefined ? {} : { interceptorTimeoutMs: options.manifest }, options.installedFor === undefined ? undefined : { user: options.installedFor });
    const run = generate(lv, options.chat ?? CHAT);
    await until("the interceptor to be asked", () => asked.count === 1);
    const { value, seconds } = await runOn(clock, run);
    return { seconds, error: value.error };
  }

  test("is ten seconds with neither the manifest nor the user's setting saying otherwise", async () => {
    expect(await held({})).toEqual({ seconds: 10, error: "Interceptor from ext-1 timed out (10s)" });
  });

  test("is the manifest's, over the user's Spindle setting, and held between one and three hundred seconds", async () => {
    expect((await held({ manifest: 30_000, setting: 45_000 })).seconds).toBe(30);
    expect((await held({ manifest: 100 })).seconds).toBe(1);
    expect((await held({ manifest: 900_000 })).seconds).toBe(300);
    // A manifest that is no number says nothing, and the user's setting is read.
    expect((await held({ manifest: Number.NaN, setting: 45_000 })).seconds).toBe(45);
  });

  test("is the user's Spindle setting where the manifest has none: an operator's extension is held to the oldest account's, and a user's to its installer's", async () => {
    expect((await held({ setting: 45_000 })).seconds).toBe(45);
    expect((await held({ setting: 500 })).seconds).toBe(1);
    expect((await held({ setting: 5_000_000 })).seconds).toBe(300);
    // Installed for Pier, the extension is held to what Pier set, though the oldest account's setting says another.
    const { lv, clock } = quay();
    lv.library.setSetting(QUAY, "spindleSettings", { interceptorTimeoutMs: 20_000 });
    lv.library.setSetting(PIER, "spindleSettings", { interceptorTimeoutMs: 60_000 });
    const asked = { count: 0 };
    await add(lv, "ext_held", silent(asked), {}, { user: PIER });
    const run = generate(lv, PIER_CHAT);
    await until("the interceptor to be asked", () => asked.count === 1);
    expect((await runOn(clock, run)).seconds).toBe(60);
  });

  test("is worked out at each run: a setting changed between two generations holds the second, with no registration made anew", async () => {
    const { lv, clock } = quay();
    const asked = { count: 0 };
    await add(lv, "ext_held", silent(asked));
    lv.library.setSetting(QUAY, "spindleSettings", { interceptorTimeoutMs: 20_000 });
    const first = generate(lv);
    await until("the first call", () => asked.count === 1);
    expect((await runOn(clock, first)).seconds).toBe(20);
    lv.library.setSetting(QUAY, "spindleSettings", { interceptorTimeoutMs: 50_000 });
    const second = generate(lv);
    await until("the second call", () => asked.count === 2);
    expect((await runOn(clock, second)).seconds).toBe(50);
  });

  test("is cut short by the generation's own stop, which ends it as a stop", async () => {
    const { lv, clock } = quay();
    const asked = { count: 0 };
    await add(lv, "ext_held", silent(asked));
    const run = generate(lv);
    await until("the interceptor to be asked", () => asked.count === 1);
    await clock.advance(2_000);
    expect(lv.stop(QUAY, { chat: CHAT })).toBe(true);
    const out = await run;
    expect(out.stopped).toBe(true);
    expect(out.error).toBeNull();
    expect(lv.events.filter((e) => e.event === "GENERATION_STOPPED")).toHaveLength(1);
  });
});

describe("a filter Lumiverse never passes", () => {
  /** Which of these extensions' interceptors were called, for a generation of each kind. */
  async function called(run: (lv: StandIn) => Promise<unknown>): Promise<string[]> {
    const { lv } = quay();
    const calls: string[] = [];
    const filters: Record<string, InterceptorOptions> = {
      ext_dry_true: { match: { isDryRun: true } },
      ext_dry_false: { match: { isDryRun: false } },
      ext_swipe: { match: { generationTypes: ["swipe"] } },
      ext_normal: { match: { generationTypes: ["normal"] } },
      ext_mode_on: { match: { presetField: { path: ["mode"], oneOf: ["on"] } } },
      ext_mode_off: { match: { presetField: { path: ["mode"], oneOf: ["off"] } } },
      ext_mode_has: { match: { presetField: { path: ["mode"], exists: true } } },
      ext_none: {},
    };
    for (const [identifier, options] of Object.entries(filters)) await add(lv, identifier, (api) => void api.registerInterceptor(async (messages) => (calls.push(identifier), messages), options));
    await run(lv);
    return calls.sort();
  }

  test("is never called: a filter on `isDryRun`, either way, never matches (the host sets `dryRun`), and the others match as Lumiverse reads them, for a generation and a dry run alike", async () => {
    const reached = ["ext_mode_has", "ext_mode_on", "ext_none", "ext_normal"];
    expect(await called((lv) => generate(lv))).toEqual(reached);
    expect(await called((lv) => generate(lv, CHAT, { dryRun: true }))).toEqual(reached);
  });

  test("is passed by a swipe where its filter names that type alone", async () => {
    expect(await called((lv) => generate(lv, CHAT, { type: "swipe" }))).toEqual(["ext_mode_has", "ext_mode_on", "ext_none", "ext_swipe"]);
  });

  test("an extension installed for one user is skipped for another user's generation, and one installed for the operator is called for both", async () => {
    const { lv } = quay();
    const calls: string[] = [];
    const answers = (name: string): Extension => (api) => void api.registerInterceptor(async (messages) => (calls.push(name), messages), {});
    await add(lv, "ext_quay", answers("ext_quay"), {}, { user: QUAY });
    await add(lv, "ext_pier", answers("ext_pier"), {}, { user: PIER });
    await add(lv, "ext_every", answers("ext_every"));
    await generate(lv, CHAT);
    expect(calls.sort()).toEqual(["ext_every", "ext_quay"]);
    calls.length = 0;
    await generate(lv, PIER_CHAT);
    expect(calls.sort()).toEqual(["ext_every", "ext_pier"]);
  });
});

describe("a stop mid-generation", () => {
  test("fails the generation of a required interceptor in every chat, and an answer that comes after it is ignored", async () => {
    const { lv, clock } = quay();
    let hold = true;
    const gate = Promise.withResolvers<void>();
    const asked = { count: 0 };
    const id = await add(lv, "ext_held", (api) => {
      api.registerInterceptor(
        async (messages) => {
          asked.count++;
          if (hold) await gate.promise;
          return messages;
        },
        { required: true },
      );
    });
    const here = generate(lv, CHAT);
    const there = generate(lv, DOCK);
    await until("both calls", () => asked.count === 2);
    await lv.spindle.restart(ADMIN, id);
    const [one, two] = await Promise.all([here, there]);
    expect(one.error).toBe("Extension worker stopped");
    expect(two.error).toBe("Extension worker stopped");
    expect(lv.events.filter((e) => e.event === "GENERATION_ENDED" && (e.payload as { error?: string }).error === "Extension worker stopped")).toHaveLength(2);
    expect(lv.log).toContain(`[Spindle] Interceptor error from ${id}: Extension worker stopped`);
    // The old worker's answer, given late, changes nothing; the restarted extension's registration is called by the next generation.
    hold = false;
    gate.resolve();
    await clock.advance(0);
    const next = await runOn(clock, generate(lv, CHAT));
    expect(next.value.error).toBeNull();
    expect(next.value.reply?.content).toBe("NEW-TEXT she says.");
    expect(asked.count).toBe(3);
  });

  test("lets a generation of an interceptor that is not required go on with the prompt it had", async () => {
    const { lv, clock } = quay();
    const asked = { count: 0 };
    const id = await add(lv, "ext_held", (api) => {
      api.registerInterceptor(() => {
        asked.count++;
        return new Promise(() => undefined);
      }, {});
    });
    const run = generate(lv, CHAT);
    await until("the call", () => asked.count === 1);
    await lv.spindle.disable(ADMIN, id);
    const out = await runOn(clock, run);
    expect(out.value.error).toBeNull();
    expect(out.value.reply?.content).toBe("NEW-TEXT she says.");
    expect(lv.log).toContain(`[Spindle] Interceptor error from ${id}: Extension worker stopped`);
  });

  test("leaves a stopped extension's registration to the run that holds the list it began with, which waits for it and gets no answer", async () => {
    const { lv, clock } = quay();
    const gate = Promise.withResolvers<void>();
    const asked = { first: 0, second: 0 };
    await add(lv, "ext_first", (api) => {
      api.registerInterceptor(
        async (messages) => {
          asked.first++;
          await gate.promise;
          return messages;
        },
        { priority: 1, required: true },
      );
    });
    const second = await add(lv, "ext_second", (api) => {
      api.registerInterceptor(async (messages) => (asked.second++, messages), { priority: 2, required: true });
    });
    const run = generate(lv, CHAT);
    await until("the first call", () => asked.first === 1);
    await lv.spindle.disable(ADMIN, second);
    gate.resolve();
    const out = await runOn(clock, run);
    // The second extension's handler is never called, the run waits for the limit of a worker that is gone, and a required one fails it.
    expect(asked.second).toBe(0);
    expect(out.value.error).toBe(`Interceptor from ${second} timed out (10s)`);
    expect(out.seconds).toBe(10);
    // The next generation holds the list as it now stands, and the stopped extension is not in it.
    const next = await runOn(clock, generate(lv, CHAT));
    expect(next.value.error).toBeNull();
    expect(asked.second).toBe(0);
  });
});
