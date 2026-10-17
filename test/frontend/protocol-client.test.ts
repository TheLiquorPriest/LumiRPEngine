import { describe, expect, test } from "bun:test";
import { ProtocolClient } from "../../src/frontend/protocol-client";
import type { SyncState, Timers, Transport } from "../../src/frontend/protocol-client";
import type { FrontendToBackend, StateDelta, StateSnapshot } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";

interface Harness {
  client: ProtocolClient;
  sent: FrontendToBackend[];
  push(payload: unknown): void;
  flush(): void;
  fireTimers(): void;
  notifications: SyncState[];
}

function harness(): Harness {
  const sent: FrontendToBackend[] = [];
  let handler: (payload: unknown) => void = () => {};
  const queue: (() => void)[] = [];
  const timers: { fn: () => void; live: boolean }[] = [];
  const transport: Transport = {
    send: (payload) => sent.push(structuredClone(payload)),
    subscribe(next) {
      handler = next;
      return () => {
        handler = () => {};
      };
    },
  };
  const fakeTimers: Timers = {
    set(fn) {
      const timer = { fn, live: true };
      timers.push(timer);
      return timer;
    },
    clear(handle) {
      for (const timer of timers) if (timer === handle) timer.live = false;
    },
  };
  let n = 0;
  const client = new ProtocolClient(transport, { newReqId: () => `q${(n += 1)}`, schedule: (fn) => queue.push(fn), timers: fakeTimers, timeoutMs: 1000 });
  const notifications: SyncState[] = [];
  client.subscribe((state) => notifications.push(state));
  return {
    client,
    sent,
    push: (payload) => handler(structuredClone(payload)),
    flush() {
      while (queue.length > 0) queue.shift()?.();
    },
    fireTimers() {
      for (const timer of timers.splice(0)) if (timer.live) timer.fn();
    },
    notifications,
  };
}

function view(chatId: string, minutes: number): StateView {
  return {
    v: 1,
    chatId,
    worldId: "w1",
    revision: "r1",
    status: "idle",
    hud: { clock: { minutes, label: "07:00", dayPart: "morning", paused: false, scale: 1 }, place: null, weather: null, cash: null, fixes: {} },
    scene: null,
    chips: [],
    journal: [],
    keepReport: [],
    pending: [],
    panels: {},
    palette: null,
    controls: null,
    meter: null,
    currency: null,
    packs: {},
    mapDisplay: null,
  };
}

const snapshot = (chatId: string, rev: number, minutes: number): StateSnapshot => ({ lre: 1, type: "lre.state.snapshot", chatId, rev, view: view(chatId, minutes) });
const delta = (chatId: string, base: number, rev: number, minutes: number): StateDelta => ({ lre: 1, type: "lre.state.delta", chatId, base, rev, ops: [{ op: "set", path: ["hud", "clock", "minutes"], value: minutes }] });

describe("request/result matching", () => {
  test("results resolve their own request even when answered out of order", async () => {
    const h = harness();
    const first = h.client.send({ type: "lre.settings.get" });
    const second = h.client.send({ type: "lre.fix", chatId: "c1", entity: "pov", field: "cash", value: 5 });
    expect(h.sent.map((m) => [m.type, m.reqId, m.lre])).toEqual([
      ["lre.settings.get", "q1", 1],
      ["lre.fix", "q2", 1],
    ]);
    h.push({ lre: 1, type: "lre.result", reqId: "q2", request: "lre.fix", body: { pending: true } });
    h.push({ lre: 1, type: "lre.error", reqId: "q1", code: "forbidden", message: "nope" });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ type: "lre.error", reqId: "q1", code: "forbidden" });
    expect(b).toMatchObject({ type: "lre.result", reqId: "q2", request: "lre.fix", body: { pending: true } });
  });

  test("a result naming another request type resolves as an internal error", async () => {
    const h = harness();
    const reply = h.client.send({ type: "lre.marker", chatId: "c1", kind: "migrate", to: "r2" });
    h.push({ lre: 1, type: "lre.result", reqId: "q1", request: "lre.keep", body: { pending: false } });
    expect(await reply).toMatchObject({ type: "lre.error", code: "internal", reqId: "q1" });
  });

  test("unknown reqIds, wrong protocol versions and duplicate results are ignored", async () => {
    const h = harness();
    const reply = h.client.send({ type: "lre.settings.get" });
    h.push({ lre: 1, type: "lre.result", reqId: "zzz", request: "lre.settings.get", body: {} });
    h.push({ lre: 2, type: "lre.result", reqId: "q1", request: "lre.settings.get", body: { wrong: true } });
    h.push({ lre: 1, type: "lre.result", reqId: "q1", request: "lre.settings.get", body: { first: true } });
    h.push({ lre: 1, type: "lre.result", reqId: "q1", request: "lre.settings.get", body: { second: true } });
    expect(await reply).toMatchObject({ body: { first: true } });
  });

  test("an unanswered request resolves unavailable at the timeout; a late result is dropped", async () => {
    const h = harness();
    const reply = h.client.send({ type: "lre.world", op: "list" });
    h.fireTimers();
    expect(await reply).toMatchObject({ type: "lre.error", code: "unavailable", reqId: "q1" });
    const errors: string[] = [];
    h.client.onError((error) => errors.push(error.code));
    h.push({ lre: 1, type: "lre.result", reqId: "q1", request: "lre.world", body: { worlds: [] } });
    expect(errors).toEqual([]);
  });

  test("errors without a pending request go to error listeners", () => {
    const h = harness();
    const errors: string[] = [];
    h.client.onError((error) => errors.push(`${error.code}:${error.message}`));
    h.push({ lre: 1, type: "lre.error", reqId: null, code: "paused", message: "Keep or Discard first" });
    expect(errors).toEqual(["paused:Keep or Discard first"]);
  });

  test("a transport that throws resolves the request unavailable", async () => {
    const client = new ProtocolClient({
      send: () => {
        throw new Error("socket closed");
      },
      subscribe: () => () => {},
    });
    expect(await client.send({ type: "lre.settings.get" })).toMatchObject({ type: "lre.error", code: "unavailable", message: "socket closed" });
    client.dispose();
  });

  test("dispose resolves every pending request", async () => {
    const h = harness();
    const reply = h.client.send({ type: "lre.settings.get" });
    h.client.dispose();
    expect(await reply).toMatchObject({ type: "lre.error", code: "unavailable" });
  });
});

describe("snapshot, delta and resync", () => {
  test("hello, then snapshot, then deltas in rev order", () => {
    const h = harness();
    void h.client.open("c1");
    expect(h.sent.at(-1)).toMatchObject({ type: "lre.hello", chatId: "c1" });
    h.push(snapshot("c1", 5, 100));
    h.push(delta("c1", 5, 6, 110));
    h.push(delta("c1", 6, 7, 120));
    const state = h.client.getState();
    expect(state).toMatchObject({ status: "live", rev: 7 });
    expect(state.view?.hud?.clock.minutes).toBe(120);
  });

  test("a delta whose base is not the held rev is discarded and one resync is sent", () => {
    const h = harness();
    void h.client.open("c1");
    h.push(snapshot("c1", 5, 100));
    h.push(delta("c1", 6, 7, 999));
    h.push(delta("c1", 7, 8, 999));
    const resyncs = h.sent.filter((m) => m.type === "lre.state.resync");
    expect(resyncs).toHaveLength(1);
    expect(resyncs[0]).toMatchObject({ chatId: "c1" });
    expect(h.client.getState()).toMatchObject({ rev: 5, status: "resyncing" });
    expect(h.client.getState().view?.hud?.clock.minutes).toBe(100);
    // Even a delta that happens to match the held rev is discarded until the snapshot lands.
    h.push(delta("c1", 5, 6, 555));
    expect(h.client.getState().view?.hud?.clock.minutes).toBe(100);
    h.push(snapshot("c1", 9, 300));
    expect(h.client.getState()).toMatchObject({ rev: 9, status: "live" });
    h.push(delta("c1", 9, 10, 310));
    expect(h.client.getState().view?.hud?.clock.minutes).toBe(310);
  });

  test("a delta whose path does not resolve keeps the old view and resyncs", () => {
    const h = harness();
    void h.client.open("c1");
    h.push(snapshot("c1", 1, 100));
    h.push({ lre: 1, type: "lre.state.delta", chatId: "c1", base: 1, rev: 2, ops: [{ op: "set", path: ["panels", "missing", "x"], value: 1 }] });
    expect(h.sent.filter((m) => m.type === "lre.state.resync")).toHaveLength(1);
    expect(h.client.getState()).toMatchObject({ rev: 1, status: "resyncing" });
  });

  test("deltas before the first snapshot are discarded without a resync", () => {
    const h = harness();
    void h.client.open("c1");
    h.push(delta("c1", 0, 1, 50));
    expect(h.sent.filter((m) => m.type === "lre.state.resync")).toHaveLength(0);
    expect(h.client.getState().view).toBeNull();
  });

  test("pushes for another chat are ignored after switching", () => {
    const h = harness();
    void h.client.open("c1");
    h.push(snapshot("c1", 1, 100));
    void h.client.open("c2");
    h.push(delta("c1", 1, 2, 200));
    h.push(snapshot("c1", 3, 300));
    expect(h.client.getState()).toMatchObject({ chatId: "c2", view: null, status: "syncing" });
    h.push(snapshot("c2", 1, 10));
    expect(h.client.getState().view?.chatId).toBe("c2");
  });

  test("a failed resync surfaces once and the next stale delta asks again", async () => {
    const h = harness();
    const errors: string[] = [];
    h.client.onError((error) => errors.push(error.code));
    void h.client.open("c1");
    h.push(snapshot("c1", 1, 100));
    h.push(delta("c1", 4, 5, 0));
    const resync = h.sent.at(-1);
    expect(resync?.type).toBe("lre.state.resync");
    h.push({ lre: 1, type: "lre.error", reqId: resync?.reqId, code: "unavailable", message: "busy" });
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(["unavailable"]);
    expect(h.client.getState().status).toBe("live");
    h.push(delta("c1", 4, 5, 0));
    expect(h.sent.filter((m) => m.type === "lre.state.resync")).toHaveLength(2);
  });

  test("a burst of deltas notifies listeners once with the final state", () => {
    const h = harness();
    void h.client.open("c1");
    h.push(snapshot("c1", 1, 100));
    h.flush();
    h.notifications.length = 0;
    for (let rev = 1; rev < 20; rev += 1) h.push(delta("c1", rev, rev + 1, 100 + rev));
    expect(h.notifications).toHaveLength(0);
    h.flush();
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]?.rev).toBe(20);
    expect(h.notifications[0]?.view?.hud?.clock.minutes).toBe(119);
  });

  test("a hello error closes the sync and reaches error listeners", async () => {
    const h = harness();
    const errors: string[] = [];
    h.client.onError((error) => errors.push(error.code));
    const reply = h.client.open("c1");
    h.push({ lre: 1, type: "lre.error", reqId: "q1", code: "not_world_chat", message: "Not a world chat" });
    await reply;
    await Promise.resolve();
    expect(errors).toEqual(["not_world_chat"]);
    expect(h.client.getState().status).toBe("closed");
  });

  test("job updates reach job listeners", () => {
    const h = harness();
    const seen: string[] = [];
    h.client.onJob((update) => seen.push(`${update.jobId}:${update.status}:${update.progress}`));
    h.push({ lre: 1, type: "lre.job.update", jobId: "j1", kind: "playtest", status: "running", progress: 0.5 });
    expect(seen).toEqual(["j1:running:0.5"]);
  });
});
