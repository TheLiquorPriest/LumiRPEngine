// The live hub: a page follows a chat's events over the socket and gets them in order, and only that
// chat's; a page that falls behind gets fewer, newer updates when it reads again, and the publisher
// never waits for it. The socket tests start the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, LiveBatch, LiveEvent, RunningServer } from "../../src/app";
import { LIVE_PATH, LIVE_PROTOCOL, LiveHub, TOKEN_PROTOCOL_PREFIX } from "../../src/app";
import { type Bed, makeBed, makeKey, rawSocket } from "./helpers";

/** A reader that takes what it is given until told it is full. */
function reader(): { batches: LiveBatch[]; full: boolean; take(batch: LiveBatch): boolean } {
  const out = {
    batches: [] as LiveBatch[],
    full: false,
    take(batch: LiveBatch): boolean {
      out.batches.push(batch);
      return !out.full;
    },
  };
  return out;
}

describe("the live hub", () => {
  const hub = () => new LiveHub({ queueEvents: 5, now: () => 0 });

  test("a reader that keeps up gets every event as it is published, in order, and only its chat's", () => {
    const live = hub();
    const r = reader();
    live.follow("chat-a", r);
    for (let i = 0; i < 20; i++) {
      live.publish("chat-a", { kind: "step", data: i });
      live.publish("chat-b", { kind: "step", data: i });
    }
    expect(r.batches).toHaveLength(20);
    expect(r.batches.flatMap((b) => b.events.map((e) => [e.chat, e.seq, e.data]))).toEqual(Array.from({ length: 20 }, (_, i) => ["chat-a", i + 1, i]));
  });

  test("a reader that falls behind is given, when it is ready, only the newest of each state push", () => {
    const live = hub();
    const r = reader();
    const following = live.follow("chat-a", r);
    r.full = true;
    live.publish("chat-a", { kind: "status", key: "turn", data: "starting" });
    for (let i = 0; i < 100; i++) live.publish("chat-a", { kind: "status", key: "turn", data: `step ${i}` });
    live.publish("chat-a", { kind: "status", key: "agent", data: "author" });
    expect(r.batches).toHaveLength(1);
    r.full = false;
    following.ready();
    expect(r.batches).toHaveLength(2);
    expect(r.batches[1]?.events.map((e) => [e.seq, e.key, e.data])).toEqual([
      [101, "turn", "step 99"],
      [102, "agent", "author"],
    ]);
  });

  test("past its limit, a slow reader's oldest other events are dropped and named, and the newest kept in order", () => {
    const live = hub();
    const r = reader();
    const following = live.follow("chat-a", r);
    r.full = true;
    for (let i = 0; i < 20; i++) live.publish("chat-a", { kind: "delta", data: i });
    following.ready();
    const last = r.batches.at(-1);
    expect(last?.missed).toEqual({ from: 2, to: 15 });
    expect(last?.events.map((e) => e.seq)).toEqual([16, 17, 18, 19, 20]);
  });

  test("publishing to a chat nobody follows, or after a reader stopped, reaches no one and still counts", () => {
    const live = hub();
    const r = reader();
    const following = live.follow("chat-a", r);
    following.stop();
    expect(live.readers("chat-a")).toBe(0);
    expect(live.publish("chat-a", { kind: "step", data: null }).seq).toBe(1);
    expect(r.batches).toEqual([]);
  });
});

describe("the live socket", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let token: string;

  beforeEach(async () => {
    bed = await makeBed();
    app = await bed.open();
    server = await app.start();
    token = await makeKey(app, "web");
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("a page follows a chat's events in order, and only that chat's", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}${LIVE_PATH}`, [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
    const got: LiveEvent[] = [];
    const following = Promise.withResolvers<number>();
    const all = Promise.withResolvers<void>();
    socket.addEventListener("message", (message) => {
      const body = JSON.parse(String(message.data)) as { type: string; seq?: number; events?: LiveEvent[] };
      if (body.type === "following") following.resolve(body.seq ?? -1);
      for (const event of body.events ?? []) got.push(event);
      if (got.length >= 200) all.resolve();
    });
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    expect(socket.protocol).toBe(LIVE_PROTOCOL);
    app.live.publish("chat-a", { kind: "before", data: null });
    socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    expect(await following.promise).toBe(1);
    for (let i = 0; i < 200; i++) {
      app.live.publish("chat-a", { kind: "step", data: i });
      app.live.publish("chat-b", { kind: "step", data: i });
    }
    await all.promise;
    socket.close();
    expect(got.map((e) => e.chat)).toEqual(Array.from({ length: 200 }, () => "chat-a"));
    expect(got.map((e) => e.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 2));
    expect(got.map((e) => e.data)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  test("a page that falls behind gets fewer, newer updates when it reads again, and the publisher never waits for it", async () => {
    const page = await rawSocket(server, LIVE_PATH, [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
    expect(page.status).toBe(101);
    page.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    await page.waitFor((messages) => messages.some((m) => m.includes('"type":"following"')));
    page.pause();
    const published = 3000;
    const filler = "x".repeat(8 * 1024);
    const started = performance.now();
    for (let i = 1; i <= published; i++) app.live.publish("chat-a", { kind: "state", key: "turn", data: { step: i, filler } });
    const publishing = performance.now() - started;
    page.resume();
    await page.waitFor((messages) => messages.some((m) => m.includes(`"seq":${published},`)));
    page.close();
    const seqs = page.messages
      .map((m) => JSON.parse(m) as { type: string; events?: LiveEvent[] })
      .flatMap((m) => (m.type === "events" ? (m.events ?? []).map((e) => e.seq) : []));
    expect(seqs.length).toBeLessThan(published / 2);
    expect(seqs.at(-1)).toBe(published);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    // Publishing took no longer than the work of publishing: nothing waited on the page that stopped reading.
    expect(publishing).toBeLessThan(2000);
  });
});
