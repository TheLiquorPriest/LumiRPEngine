// The live hub: a page follows a chat's events over the socket and gets them in order, and only that
// chat's; a page that falls behind gets fewer, newer updates when it reads again, and the publisher
// never waits for it. Only the kinds the declaration holds are published, each with its data. The
// socket tests start the server in-process on a free loopback port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TraceRecord } from "rp-harness/contract";
import type { App, LiveBatch, LiveData, LiveEvent, LivePublish, RunningServer } from "../../src/app";
import { LIVE_KINDS, LIVE_PATH, LIVE_PROTOCOL, LIVE_TOKEN_ENDED, LiveHub, problemsOf, TOKEN_PROTOCOL_PREFIX } from "../../src/app";
import { LIVE_SOCKET } from "../../src/app/live";
import { isRecord } from "../../src/shared/json";
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

/** A piece of a model call's text as it streams, the `i`th. */
function delta(i: number, text = `The tide comes in over the harbor wall, piece ${i}.`): LivePublish<"delta"> {
  return { kind: "delta", data: { run: "turn-harbor", agent: "author-1", call: 1, text, at: i } };
}

/** A record of RPH's trace as the turn lane publishes it. */
const RECORD: LiveData<"trace"> = {
  seq: 1,
  run: "turn-harbor",
  scope: { user: "user-owner", chat: "chat-a", session: "session-1", turn: "turn-harbor" },
  at: 0,
  agent: { id: "author-1", definition: "author" },
  event: { kind: "intent", text: "The keeper answers the knock, and the stranger asks for the ferryman." },
};

describe("the live hub", () => {
  const hub = () => new LiveHub({ queueEvents: 5, now: () => 0 });

  test("a reader that keeps up gets every event as it is published, in order, and only its chat's", () => {
    const live = hub();
    const r = reader();
    live.follow("chat-a", r);
    for (let i = 0; i < 20; i++) {
      live.publish("chat-a", delta(i));
      live.publish("chat-b", delta(i));
    }
    expect(r.batches).toHaveLength(20);
    expect(r.batches.flatMap((b) => b.events.map((e) => [e.chat, e.seq, e.data]))).toEqual(Array.from({ length: 20 }, (_, i) => ["chat-a", i + 1, delta(i).data]));
  });

  test("a reader that falls behind is given, when it is ready, only the newest state push", () => {
    const live = hub();
    const r = reader();
    const following = live.follow("chat-a", r);
    r.full = true;
    for (let i = 0; i < 100; i++) live.publish("chat-a", { kind: "state", data: {} });
    live.publish("chat-a", delta(1));
    expect(r.batches).toHaveLength(1);
    r.full = false;
    following.ready();
    expect(r.batches).toHaveLength(2);
    expect(r.batches[1]?.events.map((e) => [e.seq, e.kind, e.key])).toEqual([
      [100, "state", "state"],
      [101, "delta", undefined],
    ]);
  });

  test("past its limit, a slow reader's oldest other events are dropped and named, and the newest kept in order", () => {
    const live = hub();
    const r = reader();
    const following = live.follow("chat-a", r);
    r.full = true;
    for (let i = 0; i < 20; i++) live.publish("chat-a", delta(i));
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
    expect(live.publish("chat-a", delta(0)).seq).toBe(1);
    expect(r.batches).toEqual([]);
  });

  test("publishing a kind the declaration does not hold throws, and each declared kind reaches a follower with its data", () => {
    const live = hub();
    const r = reader();
    live.follow("chat-a", r);
    // A caller the types would stop: a kind made up where it is published.
    const invented = { kind: "agent.text", data: { text: "a line no page was told of" } } as unknown as LivePublish;
    expect(() => live.publish("chat-a", invented)).toThrow('carries no "agent.text" events');
    expect(live.seq("chat-a")).toBe(0);
    expect(r.batches).toEqual([]);

    const each: LivePublish[] = [
      { kind: "trace", data: RECORD },
      delta(1),
      { kind: "reply", data: { run: "turn-harbor", from: 0, text: "The door opens on a wet night." } },
      { kind: "reply", data: { run: "turn-harbor", line: 0, progress: "Weighing what the stranger wants." } },
      { kind: "state", data: {} },
      { kind: "handler_failed", data: { op: "pay", error: "The purse named holds no coin." } },
    ];
    for (const event of each) live.publish("chat-a", event);
    expect(new Set<string>(each.map((e) => e.kind))).toEqual(new Set(Object.keys(LIVE_KINDS)));
    expect(r.batches.flatMap((b) => b.events.map((e) => ({ kind: e.kind, key: e.key, data: e.data })))).toEqual(each.map((e) => ({ kind: e.kind, key: e.kind === "state" ? "state" : undefined, data: e.data })));
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
    app.live.publish("chat-a", { kind: "trace", data: RECORD });
    socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    expect(await following.promise).toBe(1);
    for (let i = 0; i < 200; i++) {
      app.live.publish("chat-a", delta(i));
      app.live.publish("chat-b", delta(i));
    }
    await all.promise;
    socket.close();
    expect(got.map((e) => e.chat)).toEqual(Array.from({ length: 200 }, () => "chat-a"));
    expect(got.map((e) => e.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 2));
    expect(got.map((e) => e.data)).toEqual(Array.from({ length: 200 }, (_, i) => delta(i).data));
  });

  test("every message the hub sends a page is one its declaration holds", async () => {
    // A page on the socket: following begun, what it sent refused, and an event of every kind.
    const p = await page(server, token);
    const following = p.next("following");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    await following;
    const refused = p.next("refused");
    p.socket.send(JSON.stringify({ op: "wave", chat: "chat-a" }));
    await refused;
    const each: LivePublish[] = [
      { kind: "trace", data: RECORD },
      delta(1),
      { kind: "reply", data: { run: "turn-harbor", from: 0, text: "The door opens on a wet night." } },
      { kind: "reply", data: { run: "turn-harbor", line: 0, progress: "Weighing what the stranger wants." } },
      { kind: "state", data: {} },
      { kind: "handler_failed", data: { op: "pay", error: "The purse named holds no coin." } },
    ];
    for (const event of each) app.live.publish("chat-a", event);
    const eventsOf = (messages: readonly Record<string, unknown>[]): unknown[] => messages.flatMap((m) => (m.type === "events" && Array.isArray(m.events) ? m.events : []));
    while (eventsOf(p.messages).length < each.length) await p.next("events");
    p.socket.close();
    // A reader that fell behind, given its catch-up with what was dropped named: the message the socket sends, as the reader takes it.
    const hub = new LiveHub({ queueEvents: 2, now: () => 0 });
    const taken: string[] = [];
    let full = true;
    const slow = hub.follow("chat-a", { take: (_batch, message) => (taken.push(message), !full) });
    for (let i = 0; i < 6; i++) hub.publish("chat-a", delta(i));
    full = false;
    slow.ready();
    const sent = [...p.messages, ...taken.map((message): Record<string, unknown> => JSON.parse(message))];
    expect(sent.map((m) => ({ type: m.type, problems: problemsOf(LIVE_SOCKET.answers, m) }))).toEqual(sent.map((m) => ({ type: m.type, problems: [] })));
    expect(new Set(sent.map((m) => m.type))).toEqual(new Set(["following", "refused", "events"]));
    expect(sent.filter((m) => m.missed !== undefined).map((m) => m.missed)).toEqual([{ from: 2, to: 4 }]);
    expect(new Set(eventsOf(sent).map((e) => (isRecord(e) ? e.kind : null)))).toEqual(new Set(Object.keys(LIVE_KINDS)));
  });

  test("a trace record with RPH's new fields, a tool's permission and a call's start, reaches a page whole", async () => {
    // Records as RPH gives them, typed by RPH's own trace types: a call's start in its tool calls, the permission a write ran under, the pictures a request could not carry.
    const usage = { calls: 1, input: 40, cacheRead: 0, cacheWrite: 0, output: 12 };
    const records: TraceRecord[] = [
      { ...RECORD, seq: 2, event: { kind: "call_ended", call: 1, model: "model-harbor", text: "", toolCalls: [{ id: "call-1", name: "ledger_write", args: { entry: "Two casks short." }, began: 1_700 }, { id: "call-2", name: "ledger_read", args: {} }], stop: "toolUse", usage, ms: 900 } },
      { ...RECORD, seq: 3, event: { kind: "tool_ended", callId: "call-1", tool: "ledger_write", result: { content: [{ type: "text", text: "Written." }] }, clean: true, endedRun: false, ms: 4, permission: { lane: "ledger", setting: "confirm", answer: { go: false, reason: "Not tonight." } } } },
      { ...RECORD, seq: 4, event: { kind: "tool_ended", callId: "call-2", tool: "web_fetch", result: { content: [{ type: "text", text: "Fetched." }] }, clean: true, endedRun: false, ms: 9, permission: { lane: "external", setting: "auto" } } },
      { ...RECORD, seq: 5, event: { kind: "prompt_notices", notices: [], pictures: [{ message: 3, count: 2 }] } },
    ];
    const p = await page(server, token);
    const following = p.next("following");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    await following;
    for (const record of records) app.live.publish("chat-a", { kind: "trace", data: record });
    const eventsOf = (): Record<string, unknown>[] => p.messages.flatMap((m) => (m.type === "events" && Array.isArray(m.events) ? (m.events as Record<string, unknown>[]) : []));
    while (eventsOf().length < records.length) await p.next("events");
    p.socket.close();
    expect(eventsOf().map((e) => e.data)).toEqual(records);
    const sent = p.messages.filter((m) => m.type === "events");
    expect(sent.map((m) => problemsOf(LIVE_SOCKET.answers, m))).toEqual(sent.map(() => []));
  });
});

/** A page's live socket: what it was sent, and how it closed. */
async function page(server: RunningServer, token: string): Promise<{ socket: WebSocket; messages: Record<string, unknown>[]; closed: Promise<{ code: number; reason: string }>; next(type: string): Promise<Record<string, unknown>> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${LIVE_PATH}`, [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
  const messages: Record<string, unknown>[] = [];
  let waiting: { type: string; resolve: (m: Record<string, unknown>) => void }[] = [];
  socket.addEventListener("message", (message) => {
    const body = JSON.parse(String(message.data)) as Record<string, unknown>;
    messages.push(body);
    for (const w of waiting) if (w.type === body.type) w.resolve(body);
    waiting = waiting.filter((w) => w.type !== body.type);
  });
  const closed = Promise.withResolvers<{ code: number; reason: string }>();
  socket.addEventListener("close", (e) => closed.resolve({ code: e.code, reason: e.reason }));
  const opened = Promise.withResolvers<void>();
  socket.addEventListener("open", () => opened.resolve());
  await opened.promise;
  const next = (type: string): Promise<Record<string, unknown>> => {
    const got = Promise.withResolvers<Record<string, unknown>>();
    waiting.push({ type, resolve: got.resolve });
    return got.promise;
  };
  return { socket, messages, closed: closed.promise, next };
}

describe("the live socket's bounds", () => {
  let bed: Bed;

  beforeEach(async () => {
    bed = await makeBed();
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("at the default settings, a page that falls behind gets its catch-up, the missed notice and the newest event without sending anything", async () => {
    const app = await bed.open();
    const server = await app.start();
    const queued = app.config.live.queueEvents;
    const page = await rawSocket(server, LIVE_PATH, [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${await makeKey(app, "web")}`]);
    expect(page.status).toBe(101);
    page.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    await page.waitFor((messages) => messages.some((m) => m.includes('"type":"following"')));
    page.pause();
    const filler = "x".repeat(8 * 1024);
    // Published as a turn publishes, from outside any of the socket's handlers, until the hub itself says the page is behind,
    // however much this machine's socket buffers took first; then more than the hub holds for it, so the oldest are dropped.
    let seq = 0;
    while (app.live.behind("chat-a") === 0) {
      seq = app.live.publish("chat-a", delta(seq + 1, filler)).seq;
      if (seq > 20_000) throw new Error("The page never fell behind, though it read nothing.");
    }
    const sent = seq;
    for (let i = 0; i < 600; i++) seq = app.live.publish("chat-a", delta(seq + 1, filler)).seq;
    const newest = seq;
    // The publisher never waited for the page: every event was published while it read nothing.
    expect(app.live.behind("chat-a")).toBe(1);
    page.resume();
    // Waited for by the messages themselves, never by a clock, and the page sends nothing.
    await page.waitFor((messages) => messages.some((m) => m.includes(`"seq":${newest},`)));
    const batches = page.messages.map((m) => JSON.parse(m) as { type: string; events?: LiveEvent[]; missed?: { from: number; to: number } }).filter((m) => m.type === "events");
    const seqs = batches.flatMap((m) => (m.events ?? []).map((e) => e.seq));
    // Each event the socket took before the page was behind, then the newest the hub held, and the stretch between named as missed.
    const caughtUp = Array.from({ length: queued }, (_, i) => newest - queued + 1 + i);
    expect(seqs).toEqual([...Array.from({ length: sent }, (_, i) => i + 1), ...caughtUp]);
    expect(batches.filter((m) => m.missed !== undefined).map((m) => m.missed)).toEqual([{ from: sent + 1, to: newest - queued }]);
    // Then every later event, as it comes.
    for (let i = 0; i < 3; i++) seq = app.live.publish("chat-a", delta(seq + 1)).seq;
    await page.waitFor((messages) => messages.some((m) => m.includes(`"seq":${seq},`)));
    expect(app.live.behind("chat-a")).toBe(0);
    page.close();
    const later = page.messages.flatMap((m) => (JSON.parse(m) as { events?: LiveEvent[] }).events ?? []).map((e) => e.seq);
    expect(later.slice(-3)).toEqual([newest + 1, newest + 2, newest + 3]);
  });

  test("a page follows at most live.follows chats at once: one more is refused in words that name the setting, and after an unfollow it may follow another", async () => {
    const app = await bed.open({ config: { live: { follows: 2 } } });
    const server = await app.start();
    const p = await page(server, await makeKey(app, "web"));
    for (const chat of ["chat-a", "chat-b"]) {
      const following = p.next("following");
      p.socket.send(JSON.stringify({ op: "follow", chat }));
      expect(await following).toMatchObject({ chat });
    }
    const refused = p.next("refused");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-c" }));
    expect(String((await refused).message)).toContain("live.follows");
    p.socket.send(JSON.stringify({ op: "unfollow", chat: "chat-a" }));
    const following = p.next("following");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-c" }));
    expect(await following).toMatchObject({ chat: "chat-c" });
    p.socket.close();
  });

  test("a socket whose page token has run out is closed with a reason the page can show, and is sent nothing more", async () => {
    const app = await bed.open();
    const server = await app.start();
    const { token, expires } = await app.auth.mintPageToken("user-owner", "extension");
    const p = await page(server, token);
    const following = p.next("following");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    await following;
    bed.clock.now = expires;
    app.live.publish("chat-a", delta(1));
    const closed = await p.closed;
    expect(closed.code).toBe(LIVE_TOKEN_ENDED);
    expect(closed.reason).toContain("token");
    expect(p.messages.filter((m) => m.type === "events")).toEqual([]);
  });

  test("a socket opened with a web key closes once that key is replaced", async () => {
    const app = await bed.open();
    const server = await app.start();
    const p = await page(server, await makeKey(app, "web"));
    await makeKey(app, "web");
    p.socket.send(JSON.stringify({ op: "follow", chat: "chat-a" }));
    expect((await p.closed).code).toBe(LIVE_TOKEN_ENDED);
    expect(p.messages).toEqual([]);
  });
});
