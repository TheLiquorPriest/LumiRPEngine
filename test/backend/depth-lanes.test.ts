// Depth's lanes on a connection (DEPTH-PLAN §5.3, §6.2; conformance finding 8): a turn's calls go
// first; depth's background calls keep to Settings → Depth → Background calls at once on each
// connection; where the connection's own Calls at once is full, a background or idle call gives its
// place to a turn's call, is asked again after, and its prompt counts as spent.

import { describe, expect, test } from "bun:test";
import { ConnectionGate } from "../../src/backend/agents/provider";
import { depthPort } from "../../src/backend/depth-model-host";
import type { QuietRequest, QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import type { UserSettings } from "../../src/shared/settings";

/** Yields the event loop `turns` times: what a release wakes has run by then. */
async function flush(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
}

const signal = new AbortController().signal;

describe("the connection's line", () => {
  test("a foreground call goes ahead of the background calls waiting, and one that has to wait asks the newest idle call under way, else the newest background one, to give way", async () => {
    const gate = new ConnectionGate();
    const asked: string[] = [];
    const idle = await gate.take(2, signal, { lane: "idle", giveWay: () => asked.push("idle") });
    const back = await gate.take(2, signal, { lane: "background", background: 2, giveWay: () => asked.push("background") });
    const order: string[] = [];
    const queuedBack = gate.take(2, signal, { lane: "background", background: 2, giveWay: () => undefined }).then((release) => (order.push("background"), release));
    await flush();
    const fore = gate.take(2, signal).then((release) => (order.push("foreground"), release));
    await flush();
    // The foreground call asked the idle call first; the queued background call asked no one.
    expect(asked).toEqual(["idle"]);
    idle();
    (await fore)();
    const next = await queuedBack;
    expect(order).toEqual(["foreground", "background"]);
    next();
    back();
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  test("background calls keep to their own at once; foreground calls don't count against it", async () => {
    const gate = new ConnectionGate();
    const most = Number.POSITIVE_INFINITY;
    const a = await gate.take(most, signal, { lane: "background", background: 2 });
    const b = await gate.take(most, signal, { lane: "background", background: 2 });
    let third = false;
    const c = gate.take(most, signal, { lane: "background", background: 2 }).then((release) => ((third = true), release));
    const fore = await gate.take(most, signal);
    await flush();
    expect(third).toBe(false);
    a();
    (await c)();
    expect(third).toBe(true);
    b();
    fore();
  });

  test("a call whose signal aborts while it waits leaves the line, and one with room goes ahead whatever its signal", async () => {
    const gate = new ConnectionGate();
    const held = await gate.take(1, signal);
    const stop = new AbortController();
    const waiting = gate.take(1, stop.signal);
    stop.abort(new Error("stopped"));
    await expect(waiting).rejects.toThrow("stopped");
    expect(gate.waiting).toBe(0);
    held();
    const gone = new AbortController();
    gone.abort(new Error("gone"));
    (await gate.take(1, gone.signal))();
  });
});

/** A host whose answers wait until the test lets each go, by the prompt's text. */
function heldHost() {
  const open = new Map<string, () => void>();
  const asked: string[] = [];
  const aborted: string[] = [];
  const host = {
    models: {
      quiet: async (r: QuietRequest, _user: string, s: AbortSignal): Promise<QuietResult> => {
        const said = r.messages[0]?.content ?? "";
        asked.push(said);
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        open.set(said, resolve);
        s.addEventListener(
          "abort",
          () => {
            aborted.push(said);
            reject(s.reason);
          },
          { once: true },
        );
        await promise;
        return { content: `answer to ${said}`, finishReason: "stop", tokens: 20, tokensIn: 10, tokensOut: 10 };
      },
    },
    log: () => undefined,
    storage: undefined,
  };
  return { host, asked, aborted, answer: (said: string) => open.get(said)?.() };
}

function settingsWith(edit: (s: UserSettings) => void): () => Promise<UserSettings> {
  const s = defaultSettings();
  edit(s);
  return async () => s;
}

describe("depth's calls on their connection", () => {
  test("at most Background calls at once of them are under way on a connection; a turn's calls never wait for them", async () => {
    const { host, asked, answer } = heldHost();
    const settings = settingsWith((s) => {
      s.depth.background.atOnce = 2;
    });
    const background = depthPort(host as never, settings, "u1", { day: null });
    const turn = depthPort(host as never, settings, "u1", { day: null, lane: "foreground" });
    const calls = ["b1", "b2", "b3"].map((said) => background("character", [{ role: "user", content: said }]));
    await flush();
    expect(asked).toEqual(["b1", "b2"]);
    const scene = turn("author", [{ role: "user", content: "scene" }]);
    await flush();
    expect(asked).toEqual(["b1", "b2", "scene"]);
    answer("scene");
    expect((await scene).text).toBe("answer to scene");
    answer("b1");
    await flush();
    expect(asked).toEqual(["b1", "b2", "scene", "b3"]);
    answer("b2");
    answer("b3");
    expect((await Promise.all(calls)).map((a) => a.text)).toEqual(["answer to b1", "answer to b2", "answer to b3"]);
  });

  test("where the connection's Calls at once is full, a background call gives its place to a turn's, is asked again after, and its prompt counts", async () => {
    const { host, asked, aborted, answer } = heldHost();
    const settings = settingsWith((s) => {
      s.agents.callsAtOnce = 1;
    });
    const background = depthPort(host as never, settings, "u1", { day: null });
    const turn = depthPort(host as never, settings, "u1", { day: null, lane: "foreground" });
    const remember = background("character", [{ role: "user", content: "remember" }]);
    await flush();
    const scene = turn("author", [{ role: "user", content: "scene" }]);
    await flush();
    // The background call was stopped for the turn's, which runs at once.
    expect(aborted).toEqual(["remember"]);
    expect(asked).toEqual(["remember", "scene"]);
    answer("scene");
    await scene;
    await flush();
    // Then the background call is asked again, and its answer counts the prompt it gave up.
    expect(asked).toEqual(["remember", "scene", "remember"]);
    answer("remember");
    const kept = await remember;
    expect(kept.text).toBe("answer to remember");
    expect(kept.usage?.tokensIn).toBe(10 + Math.ceil("remember".length / 3.2));
  });

  test("the bootstrap's calls give way too, and keep to no background at once", async () => {
    const { host, asked, aborted, answer } = heldHost();
    const settings = settingsWith((s) => {
      s.depth.background.atOnce = 1;
      s.agents.callsAtOnce = 3;
    });
    const boot = depthPort(host as never, settings, "u1", { day: null, lane: "idle" });
    const turn = depthPort(host as never, settings, "u1", { day: null, lane: "foreground" });
    const chunks = ["c1", "c2", "c3"].map((said) => boot("historian", [{ role: "user", content: said }]));
    await flush();
    expect(asked).toEqual(["c1", "c2", "c3"]);
    const scene = turn("author", [{ role: "user", content: "scene" }]);
    await flush();
    // The newest chunk gives way.
    expect(aborted).toEqual(["c3"]);
    answer("scene");
    await scene;
    await flush();
    expect(asked).toEqual(["c1", "c2", "c3", "scene", "c3"]);
    for (const said of ["c1", "c2", "c3"]) answer(said);
    expect((await Promise.all(chunks)).map((a) => a.text)).toEqual(["answer to c1", "answer to c2", "answer to c3"]);
  });

  test("the connection's per-minute throttle holds depth's calls too, and a turn's call waiting for room goes before the background calls waiting", async () => {
    const { host, asked, answer } = heldHost();
    let now = 0;
    const sleepers: { at: number; wake: () => void }[] = [];
    const clock = {
      now: () => now,
      sleep: (ms: number) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        sleepers.push({ at: now + ms, wake: resolve });
        return promise;
      },
    };
    const advance = async (ms: number): Promise<void> => {
      now += ms;
      // What a wake puts to sleep again, already due, wakes in the same turn of the clock.
      for (let due = sleepers.filter((x) => x.at <= now); due.length > 0; due = sleepers.filter((x) => x.at <= now)) {
        for (const s of due) {
          sleepers.splice(sleepers.indexOf(s), 1);
          s.wake();
        }
        await flush();
      }
      await flush();
    };
    const settings = settingsWith((s) => {
      s.agents.throttles = [{ id: "", requestsPerMinute: 1, tokensPerMinute: "none", atOnce: "none" }];
      s.depth.background.atOnce = 5;
    });
    const background = depthPort(host as never, settings, "u1", { day: null, clock });
    const turn = depthPort(host as never, settings, "u1", { day: null, lane: "foreground", clock });
    const calls = ["b1", "b2"].map((said) => background("character", [{ role: "user", content: said }]));
    await flush();
    // The minute's one request went to b1; b2 waits for room.
    expect(asked).toEqual(["b1"]);
    const scene = turn("author", [{ role: "user", content: "scene" }]);
    await flush();
    expect(asked).toEqual(["b1"]);
    // The minute turns over: the turn's call takes the room though b2 waited longer.
    await advance(60_000);
    expect(asked).toEqual(["b1", "scene"]);
    answer("scene");
    expect((await scene).text).toBe("answer to scene");
    await advance(60_001);
    expect(asked).toEqual(["b1", "scene", "b2"]);
    answer("b1");
    answer("b2");
    expect((await Promise.all(calls)).map((a) => a.text)).toEqual(["answer to b1", "answer to b2"]);
  });
});
