// Watching a chat for its pages. For the Live page: it reads the chat's latest turn at once and again
// once following begins; what came live while a read was out and what the read gave become one turn;
// what the hub dropped is read again; and the page is redrawn at most once each `renderMs` while events
// stream. For the Turn page: one turn, kept up to date live, read again when a run of it begins or ends.

import { describe, expect, test } from "bun:test";
import { createStore } from "../../src/ui/store";
import type { LiveEvent, MissingPermissionShown, TraceRecord, TurnReply, TurnsReply } from "../../src/shared/api";
import type { ClientState, LiveListener, RouteKey, RpeClient } from "../../src/ui/client";
import { applyLive, EMPTY_LIVE, type RunNode } from "../../src/ui/live-model";
import { watchChat, watchTurn, type Watched } from "../../src/ui/live-watch";
import type { Timers } from "../../src/ui/roads";
import { CHAT, CONTINUED, CONTINUED_REPLY, continuedTurn, RECORDED, RECORDS, REPLY, RUN, RUN_FIRST, RUN_SECOND, T0, turnAt, turnListAt, turnOf, underRun } from "./recorded";

/** What a watch is held to in these tests: redrawn at most each `renderMs`, the Live page keeping four runs. */
const held = (renderMs: number) => () => ({ renderMs, keepRuns: 4, keepFailures: 20 });

/** A clock the test moves by hand. */
function manualTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let ids = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      due.set(++ids, { at: now + ms, run });
      return ids;
    },
    clearTimeout(handle) {
      due.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        due.delete(id);
        t.run();
      }
    },
  };
}

interface Asked {
  key: RouteKey;
  params: Record<string, string>;
  query: Record<string, unknown>;
  answer(value: unknown): void;
}

/** A client whose calls wait until the test answers them, and whose follower the test speaks to. */
function heldClient(): RpeClient & { asked: Asked[]; listener(): LiveListener; call_(n: number): Promise<Asked> } {
  const asked: Asked[] = [];
  const waiting: { n: number; resolve: (a: Asked) => void }[] = [];
  let listener: LiveListener | null = null;
  return {
    state: createStore<ClientState>({ phase: "relay", why: "the test" }),
    missing: createStore<readonly MissingPermissionShown[] | null>(null),
    preparing: createStore(new Map()),
    call(key, params, options) {
      // The jobs the Live page reads beside the turns are none here: answered at once, so the calls the test counts are the chat's.
      if (key === "GET /api/v1/jobs") return Promise.resolve({ items: [], next: null } as never);
      const { promise, resolve } = Promise.withResolvers<never>();
      asked.push({ key, params: params as Record<string, string>, query: (options?.query ?? {}) as Record<string, unknown>, answer: (value) => resolve(value as never) });
      for (const w of waiting.filter((x) => x.n < asked.length)) w.resolve(asked[w.n] as Asked);
      return promise;
    },
    follow(_chat, l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    onReset: () => () => undefined,
    connect: () => undefined,
    reconnect: () => undefined,
    close: () => undefined,
    asked,
    listener() {
      if (listener === null) throw new Error("nobody follows");
      return listener;
    },
    /** The nth call made (from 0), once it is made. */
    call_(n) {
      if (asked[n] !== undefined) return Promise.resolve(asked[n] as Asked);
      const { promise, resolve } = Promise.withResolvers<Asked>();
      waiting.push({ n, resolve });
      return promise;
    },
  };
}

/** Lets every answer given so far reach the watcher. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function shape(run: RunNode | undefined): unknown {
  if (run === undefined) return null;
  return { seq: run.seq, waiting: run.waiting.length, reply: run.reply.text, agents: [...run.agents.values()].map((a) => ({ id: a.ref.id, steps: a.steps.map((s) => s.seqs) })) };
}

const wholeAt = (count: number): unknown => shape(RECORDED.slice(0, count).reduce(applyLive, EMPTY_LIVE).runs[0]);
const recordsIn = (count: number): number => RECORDED.slice(0, count).filter((e) => e.kind === "trace").length;

describe("watching a chat", () => {
  test("joining mid-turn: the latest turn is read at once, what came live meanwhile joins it, and following adds only what is new", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const stop = watchChat(client, CHAT, timers, (w) => seen.push(w), held(50));
    const list = await client.call_(0);
    expect(list.key).toBe("GET /api/v1/chats/:chat/turns");
    expect(list.query).toEqual({ limit: 1 });
    list.answer(turnListAt(40) satisfies TurnsReply);
    const detail = await client.call_(1);
    expect(detail.key).toBe("GET /api/v1/chats/:chat/turns/:turn");
    expect(detail.params).toEqual({ chat: CHAT, turn: RUN });
    expect(detail.query).toEqual({ from: 1 });
    // Following begins, and events after the 40th come while the read is out.
    client.listener().reset();
    client.listener().events(RECORDED.slice(40, 55), null);
    detail.answer(turnAt(40) satisfies TurnReply);
    await flush();
    expect(shape(seen.at(-1)?.model.runs[0])).toEqual(wholeAt(55));
    expect(seen.at(-1)?.loading).toBe(false);
    // The read following asked for: the list again, then only the records after those the page has.
    (await client.call_(2)).answer(turnListAt(55));
    const after = await client.call_(3);
    expect(after.query).toEqual({ run: RUN_FIRST, from: recordsIn(55) + 1 });
    after.answer(turnAt(55, recordsIn(55) + 1));
    await flush();
    client.listener().events(RECORDED.slice(55), null);
    timers.advance(50);
    expect(shape(seen.at(-1)?.model.runs[0])).toEqual(wholeAt(RECORDED.length));
    expect(seen.at(-1)?.model.runs[0]?.seq).toBe(RECORDS.length);
    expect(client.asked.length).toBe(4);
    stop();
  });

  test("events the hub dropped for a page that fell behind are read again", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const stop = watchChat(client, CHAT, timers, (w) => seen.push(w), held(50));
    (await client.call_(0)).answer({ turns: [], more: false } satisfies TurnsReply);
    await flush();
    client.listener().events(RECORDED.slice(0, 30), null);
    // The hub dropped the 31st to 40th of the chat's events, and says so with the next batch.
    client.listener().events(RECORDED.slice(40, 50), { from: 31, to: 40 });
    const asked = await Promise.all([client.call_(1), client.call_(2)]);
    const turnRead = asked.find((a) => a.key === "GET /api/v1/chats/:chat/turns/:turn");
    expect(turnRead?.query).toEqual({ run: RUN_FIRST, from: recordsIn(30) + 1 });
    turnRead?.answer(turnAt(50, recordsIn(30) + 1));
    for (const a of asked) if (a.key === "GET /api/v1/chats/:chat/turns") a.answer(turnListAt(50));
    await flush();
    timers.advance(50);
    const run = seen.at(-1)?.model.runs[0];
    expect(run?.waiting).toEqual([]);
    expect(run?.seq).toBe(recordsIn(50));
    expect(shape(run)).toEqual(wholeAt(50));
    stop();
  });

  test("while events stream it redraws at most once each renderMs", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const stop = watchChat(client, CHAT, timers, (w) => seen.push(w), held(100));
    (await client.call_(0)).answer({ turns: [], more: false } satisfies TurnsReply);
    await flush();
    const before = seen.length;
    for (const event of RECORDED.slice(0, 20)) client.listener().events([event], null);
    expect(seen.length).toBe(before);
    timers.advance(99);
    expect(seen.length).toBe(before);
    timers.advance(1);
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)?.model.runs[0]?.seq).toBe(recordsIn(20));
    stop();
  });
});

describe("watching one turn, for its page", () => {
  test("it is read whole at once, its live events keep it up to date, other turns' are let be, and it is read again when its run ends", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const stop = watchTurn(client, CHAT, RUN, timers, (w) => seen.push(w), held(50));
    const first = await client.call_(0);
    expect(first.key).toBe("GET /api/v1/chats/:chat/turns/:turn");
    expect(first.query).toEqual({ from: 1 });
    first.answer(turnAt(30) satisfies TurnReply);
    await flush();
    expect(seen.at(-1)?.detail?.status).toBe("running");
    // Following begins: the turn is read on from what the page has.
    client.listener().reset();
    const caught = await client.call_(1);
    expect(caught.query).toEqual({ run: RUN_FIRST, from: recordsIn(30) + 1 });
    caught.answer(turnAt(30, recordsIn(30) + 1));
    await flush();
    // Its events, and one of another turn of the chat.
    const other = RECORDS[0] as TraceRecord;
    const elsewhere: LiveEvent = { ...(RECORDED[0] as LiveEvent), seq: 9_999, kind: "trace", data: { ...other, run: "turn-99", scope: { user: other.scope.user, session: other.scope.session, chat: typeof other.scope.chat === "string" ? other.scope.chat : "", turn: "turn-99" } } };
    client.listener().events([...RECORDED.slice(30, 60), elsewhere], null);
    timers.advance(50);
    expect(seen.at(-1)?.model.runs.map((r) => r.run)).toEqual([RUN_FIRST]);
    expect(seen.at(-1)?.model.runs[0]?.seq).toBe(recordsIn(60));
    // Its run ends live: the turn is read again, for how it ended.
    client.listener().events(RECORDED.slice(60), null);
    const after = await client.call_(2);
    expect(after.query).toEqual({ run: RUN_FIRST, from: RECORDS.length + 1 });
    after.answer(turnAt(RECORDED.length, RECORDS.length + 1));
    await flush();
    expect(seen.at(-1)?.detail?.status).toBe("released");
    expect(seen.at(-1)?.model.runs[0]?.outcome?.status).toBe("released");
    expect(client.asked.length).toBe(3);
    stop();
  });

  test("a continue that begins while its page is open shows as a run of its own, and the turn is read again", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const stop = watchTurn(client, CHAT, RUN, timers, (w) => seen.push(w), held(50));
    (await client.call_(0)).answer(turnAt());
    await flush();
    client.listener().events(CONTINUED.slice(0, 3), null);
    const again = await client.call_(1);
    expect(again.query).toEqual({ run: RUN_SECOND, from: 4 });
    again.answer({ ...continuedTurn(), status: "running", trace: [] });
    timers.advance(50);
    await flush();
    expect(seen.at(-1)?.model.runs.map((r) => [r.run, r.seq])).toEqual([
      [RUN_FIRST, RECORDS.length],
      [RUN_SECOND, 3],
    ]);
    expect(seen.at(-1)?.detail?.kind).toBe("continue");
    stop();
  });

  test("each run of the turn, under RPH's own id for it, is heard by the turn in its records' scope; what a run sent to the chat goes on that run, and a hole in a run is read by that run", async () => {
    const client = heldClient();
    const timers = manualTimers();
    const seen: Watched[] = [];
    const first = underRun(RECORDED, "run-31a");
    const again = underRun(CONTINUED, "run-31b");
    const stop = watchTurn(client, CHAT, RUN, timers, (w) => seen.push(w), held(50));
    const opened = await client.call_(0);
    expect([opened.params, opened.query]).toEqual([{ chat: CHAT, turn: RUN }, { from: 1 }]);
    opened.answer(turnOf(first.slice(0, 30), { run: RUN, chat: CHAT, received: T0 }));
    await flush();
    // The first run's events go on, beside a record of another turn's run.
    const other = RECORDS[0] as TraceRecord;
    const elsewhere: LiveEvent = { ...(RECORDED[0] as LiveEvent), seq: 9_999, kind: "trace", data: { ...other, run: "run-99", scope: { user: other.scope.user, session: other.scope.session, chat: typeof other.scope.chat === "string" ? other.scope.chat : "", turn: "turn-99" } } };
    client.listener().events([...first.slice(30), elsewhere], null);
    timers.advance(50);
    expect(seen.at(-1)?.model.runs.map((r) => [r.run, r.turn, r.seq])).toEqual([["run-31a", RUN, RECORDS.length]]);
    // Its end reads the turn again, on from that run's last record.
    const ended = await client.call_(1);
    expect([ended.params, ended.query]).toEqual([{ chat: CHAT, turn: RUN }, { run: "run-31a", from: RECORDS.length + 1 }]);
    ended.answer({ ...turnOf(first, { run: RUN, chat: CHAT, received: T0 }), trace: [] });
    await flush();

    // A continue: a run of its own, heard by its turn; what it sent to the chat goes on it.
    client.listener().events(again.slice(0, 4), null);
    const begun = await client.call_(2);
    expect(begun.query).toEqual({ run: "run-31b", from: 4 });
    begun.answer({ ...turnOf(again.slice(0, 4), { run: RUN, chat: CHAT, received: T0 }), trace: [] });
    await flush();
    timers.advance(50);
    expect(seen.at(-1)?.model.runs.map((r) => [r.run, r.turn, r.seq, r.reply.text])).toEqual([
      ["run-31a", RUN, RECORDS.length, REPLY],
      ["run-31b", RUN, 3, CONTINUED_REPLY],
    ]);
    // A record of it past a hole: the hole is read by that run.
    client.listener().events(again.slice(5, 6), null);
    const hole = await client.call_(3);
    expect(hole.query).toEqual({ run: "run-31b", from: 4 });
    hole.answer(turnOf(again.slice(0, 6), { run: RUN, chat: CHAT, received: T0, from: 4 }));
    await flush();
    expect(seen.at(-1)?.model.runs.map((r) => [r.run, r.seq, r.waiting.length])).toEqual([
      ["run-31a", RECORDS.length, 0],
      ["run-31b", 5, 0],
    ]);
    stop();
  });
});
