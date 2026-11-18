// The relay under load (STANDALONE-PLAN §4.3 "Relay", §18.1 row 0.6): a Lumiverse page that reaches RPE
// only through the extension follows a chat while a turn with eight agents publishes on it for sixty
// seconds of the test's clock. The page's follow and its renewals go page → extension → Spindle's proxy
// → RPE's app over the real network (`door.ts`); RPE's live updates come back on its relay socket into
// the stand-in's model of Lumiverse's receive queue (`test/standin/sockets.ts`: reading pauses at 16
// frames waiting, a socket paused for 10 s or past 64 frames is closed), through the extension's pipe,
// to the page's socket, read at a phone's pace. The stream stays open and in order, nothing dropped;
// and the same turn sent a frame at a time closes Lumiverse's socket, which is why the relay gathers.

import { afterEach, describe, expect, test } from "bun:test";
import type { LiveBatch } from "../../src/app";
import { pageRoad } from "../../src/ext/page";
import { FakeClock } from "../standin/clock";
import type { ServerSocket } from "../standin/sockets";
import { openDoor, USER, type DoorBed } from "./door";

const CHAT = "chat-harbor";
const PAGE = "1111222233334444aaaabbbbccccdddd";
const AGENTS = 8;
const TURN_MS = 60_000;
/** Each agent writes a piece of text forty times a second, at its own moments, and says how it stands four times a second. */
const DELTA_MS = 25;
const STATE_EVERY = 10;
/** How fast the page reads what Lumiverse sends it: a phone on a middling connection. */
const PAGE_BYTES_PER_SECOND = 256 * 1024;
/** How long Lumiverse's handler of an extension's message takes, on a slow server. */
const HANDLER_MS = 5;

const beds: DoorBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

interface Run {
  published: { seq: number; key?: string; at: number }[];
  delivered: { seq: number; key?: string; at: number; got: number }[];
  missed: { from: number; to: number }[];
  resets: number;
  relayStates: string[];
  relaySocket: ServerSocket;
  pageSocket: ServerSocket;
  wallMs: number;
}

async function busyTurn(flush?: number): Promise<Run> {
  const clock = new FakeClock();
  const b = await openDoor({ clock, handlerMs: HANDLER_MS, ...(flush !== undefined ? { lumiverse: { relay: { flushSeconds: flush } } } : {}) });
  beds.push(b);
  const page = b.server.page(USER, PAGE, b.extension, PAGE_BYTES_PER_SECOND);
  const road = pageRoad(page.channel, { timers: clock });
  const run: Run = { published: [], delivered: [], missed: [], resets: 0, relayStates: [], relaySocket: b.server.socketsOf(USER).find((s) => s.session === b.registration.relay)!, pageSocket: page.socket, wallMs: 0 };
  road.onUpdates((list, reset) => {
    if (reset) run.resets++;
    for (const batch of list as LiveBatch[]) {
      if (batch.missed) run.missed.push(batch.missed);
      for (const e of batch.events) run.delivered.push({ seq: e.seq, ...(e.key !== undefined ? { key: e.key } : {}), at: e.at, got: clock.now() });
    }
  });
  let following = false;
  void road.follow(CHAT).then(() => {
    following = true;
  });
  await b.until("the page's follow through the extension", () => following);
  b.door.lumiverse()?.relaySocket.onState((s) => run.relayStates.push(s.state));

  // The turn: each agent on its own timer, a few milliseconds apart from the next.
  const end = clock.now() + TURN_MS;
  for (let agent = 1; agent <= AGENTS; agent++) {
    let tick = 0;
    const write = (): void => {
      if (clock.now() >= end) return;
      tick++;
      run.published.push(b.app.live.publish(CHAT, { kind: "delta", data: { run: "turn-harbor", agent: `agent-${agent}`, call: 1, text: `Agent ${agent}, piece ${tick}: the tide comes in over the harbor wall.`, at: clock.now() } }));
      if (tick % STATE_EVERY === 0) run.published.push(b.app.live.publish(CHAT, { kind: "state", data: {} }));
      clock.setTimeout(write, DELTA_MS);
    };
    clock.setTimeout(write, agent * 3);
  }
  const wall = performance.now();
  await b.run(TURN_MS + 5_000, 50);
  run.wallMs = performance.now() - wall;
  road.stop();
  return run;
}

const percentile = (values: readonly number[], p: number): number => {
  const sorted = values.toSorted((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
};

describe("the relay under the load of a busy turn", () => {
  test("a page reached only through the extension gets every event, in order, and nothing on the way closes", async () => {
    const run = await busyTurn();
    expect(run.relayStates).toEqual([]);
    expect(run.relaySocket.closed).toBeNull();
    expect(run.pageSocket.closed).toBeNull();
    expect(run.resets).toBe(0);
    expect(run.missed).toEqual([]);
    const seqs = run.delivered.map((d) => d.seq);
    expect(seqs).toEqual(run.published.map((p) => p.seq));
    // Lumiverse's queue for RPE's relay socket never filled far enough to stop reading it.
    expect(run.relaySocket.stats.pauses).toBe(0);
    const latency = run.delivered.map((d) => d.got - d.at);
    expect(Math.max(...latency)).toBeLessThan(1_000);

    const frames = run.relaySocket.stats.framesIn;
    console.log(
      [
        `relay under load: ${run.published.length} events published in ${TURN_MS / 1000} s by ${AGENTS} agents (${run.published.filter((p) => p.key !== undefined).length} state pushes)`,
        `${run.delivered.length} delivered to the page in order, none missed, ${run.resets} resets`,
        `${frames} frames on RPE's relay socket (pings and the registration among them), ${(run.delivered.length / frames).toFixed(1)} events a frame`,
        `Lumiverse's receive queue for it: at most ${run.relaySocket.stats.mostPending} waiting, ${run.relaySocket.stats.pauses} pauses`,
        `the page's socket: at most ${Math.round(run.pageSocket.stats.mostBuffered / 1024)} KiB waiting for it, read at ${PAGE_BYTES_PER_SECOND / 1024} KiB/s`,
        `from publish to the page: median ${percentile(latency, 50)} ms, 99th ${percentile(latency, 99)} ms, most ${Math.max(...latency)} ms`,
        `wall time ${Math.round(run.wallMs)} ms`,
      ].join("\n  "),
    );
  });

  test("the same turn sent a frame at a time, its flush set to 1 ms, closes Lumiverse's socket: why the relay gathers what it sends", async () => {
    const run = await busyTurn(0.001);
    expect(run.relaySocket.closed?.code).toBe(1013);
    expect(run.relayStates[0]).toBe("waiting");
    console.log(`a frame at a time: Lumiverse closed RPE's relay socket (${run.relaySocket.closed?.reason}) after ${run.relaySocket.stats.framesIn} frames, ${run.relaySocket.stats.pauses} pauses`);
  });
});

describe("the relay's limits as settings", () => {
  test("a relay flush set to 100 ms flushes at 100 ms", async () => {
    const clock = new FakeClock();
    const b = await openDoor({ clock, lumiverse: { relay: { flushSeconds: 0.1 } } });
    beds.push(b);
    const page = b.server.page(USER, PAGE, b.extension, PAGE_BYTES_PER_SECOND);
    const road = pageRoad(page.channel, { timers: clock });
    const got: number[] = [];
    road.onUpdates((list) => {
      for (const batch of list as LiveBatch[]) for (const _ of batch.events) got.push(clock.now());
    });
    let following = false;
    void road.follow(CHAT).then(() => {
      following = true;
    });
    await b.until("the page's follow through the extension", () => following);
    const relaySocket = b.server.socketsOf(USER).find((s) => s.session === b.registration.relay)!;
    const before = relaySocket.stats.framesIn;
    b.app.live.publish(CHAT, { kind: "state", data: {} });
    await b.run(99, 1);
    expect(relaySocket.stats.framesIn).toBe(before);
    await b.run(1, 1);
    expect(relaySocket.stats.framesIn).toBe(before + 1);
    await b.until("the event at the page", () => got.length > 0);
    road.stop();
  });
});
