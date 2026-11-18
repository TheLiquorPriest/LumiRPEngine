// The client in Lumiverse's drawer: it asks the extension for its start-up facts, tries RPE's address
// from the page, and takes the relay when the page cannot reach RPE itself, saying so; a refused page
// token is renewed; a chat's live updates reach whoever follows it, in order, through either road; and
// RPE's word on its extension is read again whenever the page is told to read afresh.

import { afterEach, describe, expect, test } from "bun:test";
import { h } from "preact";
import { pageRoad } from "../../src/ext/page";
import type { ExtensionStatusReply, LiveEvent } from "../../src/shared/api";
import { type ClientState, createClient, extensionConnector, isJoined, KEY_LET_GO, type LiveListener, pathOf, replyOf, type RpeClient, RpeError, webConnector } from "../../src/ui/client";
import { type ExtensionHeard, RoadLine, watchExtension } from "../../src/ui/frame";
import { proofOf, sha256Hex } from "../../src/shared/page-proof";
import { createUiSettings } from "../../src/ui/ui-settings";
import type { FetchInit, RelayChannel, RoadDeps, SocketHandlers, StartAnswer, Timers } from "../../src/ui/roads";
import { CHAT, RECORDED, turnListAt } from "./recorded";
import { expand, textOf } from "./vnodes";

const ADDRESS = "http://127.0.0.1:7871";

/** A clock the test moves by hand: nothing waits on the wall clock. */
class ManualTimers implements Timers {
  private readonly due = new Map<number, { at: number; run: () => void }>();
  private ids = 0;
  private time = Date.UTC(2026, 10, 12, 20, 0, 0);
  now = (): number => this.time;
  setTimeout = (run: () => void, ms: number): unknown => {
    const id = ++this.ids;
    this.due.set(id, { at: this.time + ms, run });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.due.delete(handle as number);
  };
  /** Moves the clock on by `ms`, running what falls due, in order. */
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const next = [...this.due].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined) break;
      this.due.delete(next[0]);
      this.time = next[1].at;
      next[1].run();
    }
    this.time = until;
  }
}

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** The extension's end of the pipe, standing in for it: RPE's answers come from `answer`. */
class Channel implements RelayChannel {
  readonly requests: Sent[] = [];
  readonly followed: string[] = [];
  starts = 0;
  private readonly handlers = new Set<(updates: unknown[], reset: boolean) => void>();

  constructor(
    private readonly answer: (sent: Sent) => { status: number; body: unknown },
    private readonly facts: (start: number) => StartAnswer = (n) => ({ facts: { token: `rpp_page${n}`, expiresInMs: 30 * 60_000, addresses: [ADDRESS], build: "b-1", pageSettings: {} }, missing: [] }),
  ) {}

  async start(): Promise<StartAnswer> {
    return this.facts(++this.starts);
  }
  async request(sent: { method: string; path: string; headers?: Record<string, string>; body?: string }) {
    const full = { ...sent, headers: sent.headers ?? {} };
    this.requests.push(full);
    const { status, body } = this.answer(full);
    return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  }
  async follow(chat: string): Promise<void> {
    this.followed.push(chat);
  }
  async unfollow(): Promise<void> {}
  onUpdates(handler: (updates: unknown[], reset: boolean) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  onPermissions(): () => void {
    return () => undefined;
  }
  send(updates: unknown[], reset = false): void {
    for (const handler of this.handlers) handler(updates, reset);
  }
}

interface FakeSocket {
  url: string;
  protocols: string[];
  handlers: SocketHandlers;
  sent: string[];
  /** Whether RPE let it open. */
  accepted: boolean;
  /** Whether the page closed it. */
  closedByPage: boolean;
}

/** Whether RPE lets a socket offering `protocols` open: always, never, or as the test decides. */
type Sockets = "open" | "refuse" | ((protocols: readonly string[]) => boolean);

/** The browser's fetch and socket, standing in: `fetch` answers as given; each socket opens, or is refused, as `sockets` says. */
function browser(fetch: (url: string, init: FetchInit) => Promise<{ status: number; text(): Promise<string> }>, sockets: Sockets = "open", timers: Timers = new ManualTimers()) {
  const fetched: { url: string; init: FetchInit }[] = [];
  const opened: FakeSocket[] = [];
  const waiting: ((socket: FakeSocket) => void)[] = [];
  const deps: RoadDeps = {
    fetch: (url, init) => {
      fetched.push({ url, init });
      return fetch(url, init);
    },
    openSocket(url, protocols, handlers) {
      const accepted = sockets === "open" || (sockets !== "refuse" && sockets(protocols));
      const socket: FakeSocket = { url, protocols, handlers, sent: [], accepted, closedByPage: false };
      opened.push(socket);
      queueMicrotask(() => {
        if (accepted) handlers.open();
        else handlers.close();
        for (const resolve of waiting.splice(0)) resolve(socket);
      });
      return {
        send: (text) => socket.sent.push(text),
        close: () => {
          socket.closedByPage = true;
        },
      };
    },
    timers,
  };
  /** The next socket opened, once its opening has been told. */
  const nextSocket = (): Promise<FakeSocket> => {
    const { promise, resolve } = Promise.withResolvers<FakeSocket>();
    waiting.push(resolve);
    return promise;
  };
  return { deps, fetched, opened, nextSocket };
}

/**
 * The extension's backend, standing in: it answers the page as `src/ext/pipe.ts` does, on the wire as
 * the extension sends it, with `facts()` for each start; `asked` keeps what the page sent it.
 */
function extensionBackend(timers: Timers, facts: () => Record<string, unknown>) {
  const handlers = new Set<(payload: unknown) => void>();
  const deliver = (payload: unknown): void => {
    for (const handler of handlers) handler(structuredClone(payload));
  };
  const asked: { rpe: string; id?: string; chat?: string }[] = [];
  const road = pageRoad(
    {
      sendToBackend(payload) {
        const message = payload as { rpe: string; id?: string; chat?: string };
        asked.push(message);
        if (message.rpe === "start") queueMicrotask(() => deliver({ rpe: "start", facts: facts(), missing: [] }));
        if (message.rpe === "request") queueMicrotask(() => deliver({ rpe: "response", id: message.id, status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(turnListAt()) }));
        if (message.rpe === "follow") queueMicrotask(() => deliver({ rpe: "following", chat: message.chat }));
      },
      onBackendMessage(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    { timers },
  );
  return { road, deliver, asked };
}

const refused = async (): Promise<never> => {
  throw new TypeError("Failed to fetch");
};
const json = (status: number, body: unknown) => async () => ({ status, text: async () => JSON.stringify(body) });
const rpeStatusBody = { name: "rpe", version: "1.0.0", started: 0, belongsToUser: true };
/** RPE as a page finds it: its status, and, for any of the page tokens the tests make, the proof of the nonce RPE answers by the hash it keeps of the token. */
const rpeStatus = async (url: string) => {
  if (!url.includes("/api/v1/status/proof")) return json(200, rpeStatusBody)();
  const asked = new URL(url).searchParams;
  for (const token of ["rpp_page1", "rpp_page2", "rpp_page3", "rpp_x"]) {
    const hash = await sha256Hex(token);
    if (hash.startsWith(asked.get("id") ?? "-")) return json(200, { proof: await proofOf(hash, asked.get("nonce") ?? "") })();
  }
  return json(404, { error: "RPE holds no such token." })();
};
/** Lets everything the page has waiting on a promise run: the test's own timers stay where they are. */
function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

const clients: RpeClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});
function track(client: RpeClient): RpeClient {
  clients.push(client);
  return client;
}

/** The client's state once it is past connecting. */
function settled(client: RpeClient): Promise<ClientState> {
  const { promise, resolve } = Promise.withResolvers<ClientState>();
  const check = (state: ClientState): void => {
    if (state.phase === "connecting" || state.phase === "idle") return;
    off();
    resolve(state);
  };
  const off = client.state.subscribe(check);
  check(client.state.get());
  return promise;
}

/** A follower that keeps what it is told; `resets(n)` waits for its nth reset. A refusal fails the test, unless the follower keeps them. */
function follower(keepRefusals = false): LiveListener & { got: LiveEvent[]; missed: ({ from: number; to: number } | null)[]; refusals: string[]; resetCount: number; resets(n: number): Promise<void> } {
  const waiting: { n: number; resolve: () => void }[] = [];
  const out = {
    got: [] as LiveEvent[],
    missed: [] as ({ from: number; to: number } | null)[],
    refusals: [] as string[],
    resetCount: 0,
    events(events: readonly LiveEvent[], missed: { from: number; to: number } | null) {
      out.got.push(...events);
      out.missed.push(missed);
    },
    reset() {
      out.resetCount++;
      for (const w of waiting.filter((x) => x.n <= out.resetCount)) w.resolve();
    },
    refused(words: string) {
      if (!keepRefusals) throw new Error(words);
      out.refusals.push(words);
    },
    resets(n: number): Promise<void> {
      if (out.resetCount >= n) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push({ n, resolve });
      return promise;
    },
  };
  return out;
}

describe("which road the drawer's client takes", () => {
  test("before anything is asked of RPE the page shows no connecting line, and the drawer's start reaches RPE with no page asking", async () => {
    const channel = new Channel(() => ({ status: 200, body: {} }));
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    expect(client.state.get()).toEqual({ phase: "idle" });
    expect(textOf(expand(h(RoadLine, { state: client.state.get(), onRetry: () => undefined })))).toBe("");
    // What the drawer does when it is mounted, with no chat open and so no page asking anything.
    client.connect();
    const state = await settled(client);
    expect(state.phase).toBe("relay");
    expect(channel.starts).toBe(1);
    expect(textOf(expand(h(RoadLine, { state, onRetry: () => undefined })))).toContain("Through Lumiverse");
  });

  test("when the page cannot reach RPE itself, it takes the relay, and says why", async () => {
    const channel = new Channel(() => ({ status: 200, body: turnListAt() }));
    const { deps, fetched } = browser(refused);
    const client = track(createClient(extensionConnector(channel, deps)));
    const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }, { query: { limit: 1 } }));
    expect(list).toEqual(turnListAt());
    expect(fetched.map((f) => f.url)).toEqual([`${ADDRESS}/api/v1/status`]);
    expect(channel.requests).toEqual([{ method: "GET", path: `/api/v1/chats/${CHAT}/turns?limit=1`, headers: { authorization: "Bearer rpp_page1", accept: "application/json" } }]);
    const state = client.state.get();
    expect(state.phase).toBe("relay");
    const why = state.phase === "relay" ? state.why : "";
    expect(why).toContain(ADDRESS);
    expect(why).toContain("Failed to fetch");
    // The page says which road it is on, and why.
    const line = textOf(expand(h(RoadLine, { state, onRetry: () => undefined })));
    expect(line).toContain("Through Lumiverse");
    expect(line).toContain(why);
  });

  test("when RPE answers the page and its live socket opens, it goes directly, and the relay carries nothing", async () => {
    const channel = new Channel(() => ({ status: 500, body: { error: "not this way" } }));
    const { deps, fetched, opened } = browser(async (url) => (url.includes("/api/v1/status") ? rpeStatus(url) : json(200, turnListAt())()));
    const client = track(createClient(extensionConnector(channel, deps)));
    const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }, { query: { limit: 1 } }));
    expect(list.turns.length).toBe(4);
    expect(client.state.get()).toEqual({ phase: "direct", address: ADDRESS });
    expect(channel.requests).toEqual([]);
    expect(fetched.at(-1)).toEqual({ url: `${ADDRESS}/api/v1/chats/${CHAT}/turns?limit=1`, init: { method: "GET", headers: { authorization: "Bearer rpp_page1", accept: "application/json" } } });
    expect(opened[0]?.url).toBe("ws://127.0.0.1:7871/api/v1/live");
    expect(opened[0]?.protocols).toEqual(["rpe.live", "rpe.token.rpp_page1"]);
    expect(textOf(expand(h(RoadLine, { state: client.state.get(), onRetry: () => undefined })))).toContain("Direct");
  });

  test("when RPE answers but the browser refuses the page its live socket, it takes the relay, and says so", async () => {
    const channel = new Channel(() => ({ status: 200, body: turnListAt() }));
    const client = track(createClient(extensionConnector(channel, browser(rpeStatus, "refuse").deps)));
    await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT });
    const state = client.state.get();
    expect(state.phase === "relay" ? state.why : "").toContain("did not let this page open its live socket");
  });

  test("when the extension cannot reach RPE, the page says so in the extension's words", async () => {
    const channel = new Channel(
      () => ({ status: 200, body: {} }),
      () => ({ facts: null, error: "RPE has not connected to Lumiverse yet.", missing: [{ permission: "interceptor", why: "to tag a chat's request" }] }),
    );
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    const error = await client.call("GET /api/v1/chats", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpeError);
    expect(client.state.get()).toEqual({ phase: "failed", error: "RPE has not connected to Lumiverse yet." });
    expect(client.missing.get()).toEqual([{ permission: "interceptor", why: "to tag a chat's request" }]);
  });

  test("a page token RPE refuses is renewed, and the call made once more with the new one", async () => {
    const channel = new Channel((sent) => (sent.headers.authorization === "Bearer rpp_page2" ? { status: 200, body: turnListAt() } : { status: 401, body: { error: "This needs a page token or the web UI's token." } }));
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT }));
    expect(list.turns[0]?.id).toBe("turn-31");
    expect(channel.starts).toBe(2);
    expect(channel.requests.map((r) => r.headers.authorization)).toEqual(["Bearer rpp_page1", "Bearer rpp_page2"]);
  });

  test("a page token is renewed before it runs out", async () => {
    const timers = new ManualTimers();
    const channel = new Channel(() => ({ status: 200, body: turnListAt() }), (n) => ({ facts: { token: `rpp_page${n}`, expiresInMs: 30 * 60_000, addresses: [], build: "b-1", pageSettings: {} }, missing: [] }));
    const client = track(createClient(extensionConnector(channel, browser(refused, "open", timers).deps)));
    await client.call("GET /api/v1/chats", {});
    timers.advance(28 * 60_000);
    expect(channel.starts).toBe(1);
    timers.advance(60_000);
    expect(channel.starts).toBe(2);
    await Promise.resolve();
    await client.call("GET /api/v1/chats", {});
    expect(channel.requests.at(-1)?.headers.authorization).toBe("Bearer rpp_page2");
  });

  test("a page token's life is counted on the page's own clock, so a browser clock far ahead of RPE's renews it no sooner", async () => {
    const timers = new ManualTimers();
    // RPE's clock is two hours behind the browser's: by the browser's clock, the time RPE names has long passed.
    const rpeNow = timers.now() - 2 * 3_600_000;
    const backend = extensionBackend(timers, () => ({ token: "rpp_x", expiresAt: rpeNow + 30 * 60_000, expiresInMs: 30 * 60_000, addresses: [], build: "b-1", pageSettings: {}, road: { requestMs: 35_000, renewMs: 20_000 } }));
    try {
      const client = track(createClient(extensionConnector(backend.road, browser(refused, "open", timers).deps)));
      await client.call("GET /api/v1/chats", {});
      const starts = (): number => backend.asked.filter((m) => m.rpe === "start").length;
      expect(starts()).toBe(1);
      timers.advance(60_000);
      await Promise.resolve();
      expect(starts()).toBe(1);
      timers.advance(28 * 60_000);
      expect(starts()).toBe(2);
    } finally {
      backend.road.stop();
    }
  });

  test("RPE's refusal reaches the page in RPE's own words", async () => {
    const channel = new Channel(() => ({ status: 404, body: { error: "RPE has no turn turn-99 in this chat." } }));
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    const error = await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat: CHAT, turn: "turn-99" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpeError);
    expect((error as RpeError).status).toBe(404);
    expect((error as RpeError).message).toBe("RPE has no turn turn-99 in this chat.");
  });
});

describe("a chat's live updates", () => {
  test("through the relay: in order, to the chat's follower alone, and a lost frame tells it to read afresh", async () => {
    const channel = new Channel(() => ({ status: 200, body: {} }));
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    const mine = follower();
    client.follow(CHAT, mine);
    await mine.resets(1);
    expect(channel.followed).toEqual([CHAT]);
    const first = RECORDED.slice(0, 5);
    const second = RECORDED.slice(5, 9);
    channel.send([{ type: "events", chat: CHAT, events: first }, { type: "events", chat: "chat-other", events: RECORDED.slice(0, 2) }, { type: "events", chat: CHAT, events: second, missed: { from: 3, to: 4 } }]);
    expect(mine.got).toEqual([...first, ...second]);
    expect(mine.missed).toEqual([null, { from: 3, to: 4 }]);
    channel.send([], true);
    expect(mine.resetCount).toBe(2);
  });

  test("through the extension's own page road: the start, a request, and a live list in two parts all reach the page", async () => {
    const timers = new ManualTimers();
    const { road, deliver, asked } = extensionBackend(timers, () => ({ token: "rpp_x", expiresAt: timers.now() + 1_800_000, expiresInMs: 1_800_000, addresses: [ADDRESS], build: "b-1", pageSettings: {}, road: { requestMs: 35_000, renewMs: 20_000 } }));
    try {
      const client = track(createClient(extensionConnector(road, browser(refused, "open", timers).deps)));
      const list = await client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT });
      expect(list).toEqual(turnListAt());
      expect(asked[1]).toMatchObject({ rpe: "request", method: "GET", path: `/api/v1/chats/${CHAT}/turns`, headers: { authorization: "Bearer rpp_x" } });
      const mine = follower();
      client.follow(CHAT, mine);
      await mine.resets(1);
      const data = JSON.stringify([{ type: "events", chat: CHAT, events: RECORDED.slice(0, 30) }]);
      const half = Math.ceil(data.length / 2);
      deliver({ rpe: "live", seq: 1, data: data.slice(0, half), part: { index: 0, count: 2 } });
      deliver({ rpe: "live", seq: 1, data: data.slice(half), part: { index: 1, count: 2 } });
      expect(mine.got).toEqual(RECORDED.slice(0, 30));
      // The list numbered 2 never came: the next one tells the page to read afresh, and is delivered too.
      deliver({ rpe: "live", seq: 3, data: JSON.stringify([{ type: "events", chat: CHAT, events: RECORDED.slice(30, 31) }]) });
      expect(mine.resetCount).toBe(2);
      expect(mine.got).toEqual(RECORDED.slice(0, 31));
    } finally {
      road.stop();
    }
  });

  test("directly: when the live socket closes, it opens again, follows again, and tells the follower to read afresh", async () => {
    const timers = new ManualTimers();
    const channel = new Channel(() => ({ status: 200, body: {} }));
    const { deps, nextSocket } = browser(rpeStatus, "open", timers);
    const client = track(createClient(extensionConnector(channel, deps)));
    const mine = follower();
    const probe = nextSocket();
    client.follow(CHAT, mine);
    await probe;
    const live = await nextSocket();
    expect(await settled(client)).toEqual({ phase: "direct", address: ADDRESS });
    expect(live.sent).toEqual([JSON.stringify({ op: "follow", chat: CHAT })]);
    live.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    await mine.resets(1);
    live.handlers.message(JSON.stringify({ type: "events", chat: CHAT, events: RECORDED.slice(0, 3) }));
    expect(mine.got).toEqual(RECORDED.slice(0, 3));
    live.handlers.close();
    const reopened = nextSocket();
    timers.advance(1000);
    const again = await reopened;
    expect(again.sent).toEqual([JSON.stringify({ op: "follow", chat: CHAT })]);
    expect(mine.resetCount).toBe(1);
    again.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 3 }));
    expect(mine.resetCount).toBe(2);
  });
});

describe("how RPE's extension stands, as the page hears it", () => {
  test("RPE's word on its extension is read again each time the page is told to read afresh, so a registration lost while the page is open shows", async () => {
    let said: ExtensionStatusReply = { registered: true, why: null, missing: [], stopped: null };
    const channel = new Channel((sent) => (sent.path === "/api/v1/status/extension" ? { status: 200, body: said } : { status: 200, body: turnListAt() }));
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));
    const heard: ExtensionHeard[] = [];
    const watcher = watchExtension(client, (word) => heard.push(word));
    try {
      client.connect();
      await settled(client);
      await settle();
      expect(heard.at(-1)).toEqual({ rpe: said, problem: null });
      said = { registered: false, why: "Another install of the extension took RPE's registration.", missing: null, stopped: null };
      // Updates were lost on the way: the page reads afresh, this word among the rest.
      channel.send([], true);
      await settle();
      expect(heard.at(-1)).toEqual({ rpe: said, problem: null });
      // A page that begins to follow a chat reads it afresh too.
      said = { registered: true, why: null, missing: [{ permission: "interceptor", why: "to tag each reply RPE plays" }], stopped: null };
      const mine = follower();
      client.follow(CHAT, mine);
      await mine.resets(1);
      await settle();
      expect(heard.at(-1)).toEqual({ rpe: said, problem: null });
    } finally {
      watcher.stop();
    }
  });
});

describe("the page token, renewed while the drawer stays open", () => {
  const LIFE = 30 * 60_000;
  const AWAY = "The extension's worker is restarting.";

  /**
   * The extension's start, standing in, and RPE's rule for the live socket: a token works for 30 minutes
   * from when it was minted. While `away`, the extension answers no start.
   */
  function mintingChannel(timers: ManualTimers) {
    const minted = new Map<string, number>();
    const ext = { away: false };
    const channel = new Channel(
      () => ({ status: 200, body: {} }),
      (n) => {
        if (ext.away) return { facts: null, error: AWAY, missing: [] };
        minted.set(`rpp_page${n}`, timers.now());
        return { facts: { token: `rpp_page${n}`, expiresInMs: LIFE, addresses: [ADDRESS], build: "b-1", pageSettings: {} }, missing: [] };
      },
    );
    const takes = (protocols: readonly string[]): boolean => {
      const at = minted.get(protocols[1]?.slice("rpe.token.".length) ?? "");
      return at !== undefined && timers.now() < at + LIFE;
    };
    return { channel, ext, takes };
  }

  /** A drawer on the direct road, following the chat. */
  async function following(timers: ManualTimers, channel: Channel, takes: Sockets) {
    const { deps, opened, nextSocket } = browser(rpeStatus, takes, timers);
    const client = track(createClient(extensionConnector(channel, deps)));
    const mine = follower(true);
    const probe = nextSocket();
    client.follow(CHAT, mine);
    await probe;
    const live = await nextSocket();
    live.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    await mine.resets(1);
    return { live, opened, nextSocket, mine };
  }

  test("a renewal that fails is asked for again, and the live socket opens again with the new token, not the one that ran out", async () => {
    const timers = new ManualTimers();
    const { channel, ext, takes } = mintingChannel(timers);
    const { live, nextSocket, mine } = await following(timers, channel, takes);
    // The renewal is due a minute before the token runs out, and the extension does not answer it.
    ext.away = true;
    timers.advance(29 * 60_000);
    await settle();
    expect(channel.starts).toBe(2);
    ext.away = false;
    const reopened = nextSocket();
    timers.advance(1000);
    await settle();
    expect(channel.starts).toBe(3);
    // The new token's socket opens beside the old one; the first token runs out, its socket closes, and the new one is used.
    const again = await reopened;
    expect(again.protocols).toEqual(["rpe.live", "rpe.token.rpp_page3"]);
    expect(again.accepted).toBe(true);
    timers.advance(2 * 60_000);
    live.handlers.close(4401);
    again.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    expect(mine.resetCount).toBe(2);
    expect(mine.refusals).toEqual([]);
  });

  test("when the live socket cannot open again and no new token can be had, its follower is told so in the extension's words; once one can, the socket opens with it", async () => {
    const timers = new ManualTimers();
    const { channel, ext, takes } = mintingChannel(timers);
    const { live, opened, mine } = await following(timers, channel, takes);
    ext.away = true;
    timers.advance(31 * 60_000);
    await settle();
    // The token has run out; the socket closes, and RPE refuses the one it would open again with.
    live.handlers.close();
    timers.advance(1000);
    await settle();
    await settle();
    expect(opened.at(-1)?.accepted).toBe(false);
    expect(mine.refusals.at(-1) ?? "").toContain(AWAY);
    // The extension answers again: within the longest wait, the socket opens with a token RPE takes, and the page reads afresh.
    ext.away = false;
    for (let waited = 0; waited < 35_000 && opened.at(-1)?.accepted !== true; waited += 1000) {
      timers.advance(1000);
      await settle();
    }
    const back = opened.at(-1);
    expect(back?.accepted).toBe(true);
    back?.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    expect(mine.resetCount).toBe(2);
  });

  test("a token renewed while the live socket is open: the next socket opens with it and takes over before the old one's end, so nothing published between is lost or given twice", async () => {
    const timers = new ManualTimers();
    const SHORT = 2 * 60_000;
    const channel = new Channel(
      () => ({ status: 200, body: {} }),
      (n) => ({ facts: { token: `rpp_page${n}`, expiresInMs: SHORT, addresses: [ADDRESS], build: "b-1", pageSettings: {} }, missing: [] }),
    );
    const { live, opened, nextSocket, mine } = await following(timers, channel, "open");
    const batch = (...seqs: number[]): string => JSON.stringify({ type: "events", chat: CHAT, events: seqs.map((seq) => ({ ...RECORDED[0], chat: CHAT, seq })) });
    const seqs = (): number[] => mine.got.map((e) => e.seq);
    live.handlers.message(batch(1));
    // The renewal is due a minute before the token runs out: the next socket opens with the new token and follows the chat.
    const coming = nextSocket();
    timers.advance(60_000);
    const fresh = await coming;
    expect(fresh.protocols).toEqual(["rpe.live", "rpe.token.rpp_page2"]);
    expect(fresh.sent.map((s) => JSON.parse(s))).toEqual([{ op: "follow", chat: CHAT }]);
    // Its following begins past event 3, which the old socket has not given yet: what it gives meanwhile waits for the old one.
    fresh.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 3 }));
    fresh.handlers.message(batch(4));
    expect(seqs()).toEqual([1]);
    live.handlers.message(batch(2, 3));
    expect(seqs()).toEqual([1, 2, 3, 4]);
    expect(live.closedByPage).toBe(true);
    // The old token's end closes the old socket with RPE's code: the page no longer hears it, and asks for nothing.
    const sockets = opened.length;
    const starts = channel.starts;
    live.handlers.close(4401);
    live.handlers.message(batch(5));
    fresh.handlers.message(batch(5, 6));
    await settle();
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mine.resetCount).toBe(1);
    expect(mine.refusals).toEqual([]);
    expect(opened.length).toBe(sockets);
    expect(channel.starts).toBe(starts);
    expect(fresh.closedByPage).toBe(false);
  });

  test("when the old socket ends before the next one caught up, the next one takes over at once and the chat is told it lost what came between", async () => {
    const timers = new ManualTimers();
    const channel = new Channel(
      () => ({ status: 200, body: {} }),
      (n) => ({ facts: { token: `rpp_page${n}`, expiresInMs: 2 * 60_000, addresses: [ADDRESS], build: "b-1", pageSettings: {} }, missing: [] }),
    );
    const { live, opened, nextSocket, mine } = await following(timers, channel, "open");
    const coming = nextSocket();
    timers.advance(60_000);
    const fresh = await coming;
    fresh.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 7 }));
    fresh.handlers.message(JSON.stringify({ type: "events", chat: CHAT, events: [{ ...RECORDED[0], chat: CHAT, seq: 8 }] }));
    const sockets = opened.length;
    live.handlers.close(4401);
    await settle();
    expect(mine.resetCount).toBe(2);
    expect(mine.got.map((e) => e.seq)).toEqual([8]);
    expect(opened.length).toBe(sockets);
    expect(mine.refusals).toEqual([]);
  });
});

describe("the web shell's live socket", () => {
  test("a restart of RPE is waited out with no word to the page and the key kept; a key RPE refuses on the session route signs the browser out", async () => {
    const timers = new ManualTimers();
    const rpe = { up: true, retired: false };
    const fetch = async (): Promise<{ status: number; text(): Promise<string> }> => {
      if (!rpe.up) throw new TypeError("Failed to fetch");
      return rpe.retired ? { status: 401, text: async () => JSON.stringify({ error: "unauthorized", message: "This needs a page token or the web UI's token." }) } : { status: 200, text: async () => "{}" };
    };
    const { deps, opened, nextSocket } = browser(fetch, () => rpe.up, timers);
    let key: string | null = "rpw_web-key";
    const client = track(createClient(webConnector(ADDRESS, { get: () => key, set: (next) => (key = next) }, deps)));
    const mine = follower(true);
    const first = nextSocket();
    client.follow(CHAT, mine);
    (await first).handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    await mine.resets(1);

    // RPE stops: the socket closes under the page, and neither the socket nor the session route answers while it is down.
    rpe.up = false;
    opened.at(-1)?.handlers.close();
    for (let waited = 0; waited < 8000; waited += 1000) {
      timers.advance(1000);
      await settle();
      await settle();
    }
    expect(opened.filter((s) => !s.accepted).length).toBeGreaterThan(1);
    expect(mine.refusals).toEqual([]);
    expect(key).toBe("rpw_web-key");

    // RPE is back: within the longest wait the socket opens again with the same key, and the page reads afresh.
    rpe.up = true;
    for (let waited = 0; waited < 35_000 && opened.at(-1)?.accepted !== true; waited += 1000) {
      timers.advance(1000);
      await settle();
    }
    const back = opened.at(-1);
    expect(back?.protocols).toEqual(["rpe.live", "rpe.token.rpw_web-key"]);
    back?.handlers.message(JSON.stringify({ type: "following", chat: CHAT, seq: 0 }));
    expect(mine.resetCount).toBe(2);
    expect(mine.refusals).toEqual([]);
    expect(client.state.get().phase).not.toBe("signed-out");

    // A new web key was made: RPE closes the socket with its code for an ended credential, and refuses the key on the session route.
    rpe.retired = true;
    back?.handlers.close(4401);
    await settle();
    await settle();
    expect(key).toBeNull();
    expect(client.state.get()).toEqual({ phase: "signed-out", error: KEY_LET_GO });
  });
});

describe("a turn joined to another", () => {
  const HELD = "turn-held";
  const FIRST = "turn-first";

  test("the client hands the page a joined turn's answer as its own kind, and asking again for the turn joined gives that turn's reply", async () => {
    // RPE answers the held turn with status 409 and the turn it joined, and the turn it joined with its reply; a chat's list that is no turn's answers 409 as a refusal.
    const channel = new Channel((sent) => {
      if (sent.path === `/api/v1/chats/${CHAT}/turns/${HELD}`) return { status: 409, body: { joined: { turn: HELD, joined: FIRST } } };
      if (sent.path === `/api/v1/chats/${CHAT}/turns/${FIRST}`) return { status: 200, body: { id: FIRST } };
      return { status: 409, body: { error: "Not now." } };
    });
    const client = track(createClient(extensionConnector(channel, browser(refused).deps)));

    // Neither a reply nor an error: the answer of its own kind, which names both turns.
    const asked = await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat: CHAT, turn: HELD });
    expect(isJoined(asked)).toBe(true);
    if (!isJoined(asked)) throw new Error("the held turn was not answered as joined");
    expect(asked).toEqual({ joined: { turn: HELD, joined: FIRST } });
    // A page that does not follow yet reads it as a refusal in words, naming the turn to ask for.
    expect(() => replyOf(asked)).toThrow(`Turn ${HELD} was joined to turn ${FIRST}`);
    expect(() => replyOf(asked)).toThrow(RpeError);

    // Asking again for the turn it names gives that turn's reply.
    const again = await client.call("GET /api/v1/chats/:chat/turns/:turn", { chat: CHAT, turn: asked.joined.joined });
    expect(isJoined(again)).toBe(false);
    expect(again as unknown).toEqual({ id: FIRST });
    expect(channel.requests.map((r) => r.path)).toEqual([`/api/v1/chats/${CHAT}/turns/${HELD}`, `/api/v1/chats/${CHAT}/turns/${FIRST}`]);

    // Any other 409 is RPE's refusal, thrown in its own words.
    await expect(client.call("GET /api/v1/chats/:chat/turns", { chat: CHAT })).rejects.toMatchObject({ status: 409, message: "Not now." });
  });
});

describe("a call's path", () => {
  test("its params go in their places, encoded, and its query after", () => {
    expect(pathOf("/api/v1/chats/:chat/turns/:turn", { chat: "chat a/b", turn: "t#1" }, { from: 4, before: undefined })).toBe("/api/v1/chats/chat%20a%2Fb/turns/t%231?from=4");
    expect(() => pathOf("/api/v1/chats/:chat/turns", {})).toThrow("needs its chat");
    // A yes-or-no value goes as the words the routes read.
    expect(pathOf("/api/v1/files/*", { "*": "skills/walk" }, { chat: "c1", contents: true })).toBe("/api/v1/files/skills/walk?chat=c1&contents=true");
  });

  test("the rest of a path goes in segment by segment, each encoded, its slashes kept", () => {
    expect(pathOf("/api/v1/chats/:chat/turns/:turn/files/*", { chat: "c1", turn: "t1", "*": "transcripts/author a1.call-1.json" })).toBe("/api/v1/chats/c1/turns/t1/files/transcripts/author%20a1.call-1.json");
    expect(() => pathOf("/api/v1/chats/:chat/turns/:turn/files/*", { chat: "c1", turn: "t1" })).toThrow("needs its *");
  });
});

describe("the page's settings in the drawer's client", () => {
  test("a probe wait set to 7 s waits 7 s for an address, and a start wait RPE gave is kept in the browser for the next start", async () => {
    const timers = new ManualTimers();
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
    const settings = createUiSettings(storage);
    const channel = new Channel(
      () => ({ status: 200, body: {} }),
      (n) => ({ facts: { token: `rpp_page${n}`, expiresInMs: 30 * 60_000, addresses: [ADDRESS], build: "b-1", pageSettings: { "pages.probeMs": 7000, "pages.startMs": 50_000 } }, missing: [] }),
    );
    // An address that never answers; the page's own request is let go when it gives up.
    const silent = browser((_url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))), "open", timers);
    const client = track(createClient(extensionConnector(channel, silent.deps, settings)));
    client.connect();
    await settle();
    timers.advance(6900);
    await settle();
    expect(client.state.get().phase).toBe("connecting");
    timers.advance(200);
    const state = await settled(client);
    expect(state.phase === "relay" ? state.why : "").toContain("no answer within 7 s");
    expect(createUiSettings(storage).values.get().startMs).toBe(50_000);
    expect(createUiSettings(null).values.get().startMs).toBe(35_000);
  });

  test("a server that answers name: rpe and fails the proof is never sent the token, and the page takes the relay", async () => {
    const channel = new Channel(() => ({ status: 200, body: {} }));
    const { deps, opened } = browser(async (url) => (url.includes("/api/v1/status/proof") ? json(200, { proof: "0".repeat(64) })() : rpeStatus(url)));
    const client = track(createClient(extensionConnector(channel, deps)));
    client.connect();
    const state = await settled(client);
    expect(state.phase === "relay" ? state.why : "").toContain("did not prove that it is RPE");
    expect(opened).toEqual([]);
  });

  test("a request RPE took in hand and answered with an id is asked for every second until its answer is ready", async () => {
    const timers = new ManualTimers();
    let polls = 0;
    const channel = new Channel((sent) => {
      if (sent.method === "POST") return { status: 202, body: { answer: "a1" } };
      polls++;
      return polls < 3 ? { status: 202, body: { answer: "a1" } } : { status: 200, body: { ok: true } };
    });
    const client = track(createClient(extensionConnector(channel, browser(refused, "open", timers).deps)));
    let result: unknown = null;
    void client.call("POST /api/v1/chats/:chat/settle", { chat: CHAT }).then((answer) => (result = answer));
    for (let i = 0; i < 4; i++) {
      await settle();
      timers.advance(1000);
    }
    await settle();
    expect(result).toEqual({ ok: true });
    expect(channel.requests.map((r) => `${r.method} ${r.path}`)).toEqual([`POST /api/v1/chats/${CHAT}/settle`, "GET /api/v1/answers/a1", "GET /api/v1/answers/a1", "GET /api/v1/answers/a1"]);
  });
});
