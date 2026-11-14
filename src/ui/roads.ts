// The two roads a page has to RPE (plan §4.3). Direct: HTTP and a socket straight to RPE, which streams
// and is fastest. Relay: through the light extension, one request and one whole answer at a time (Spindle's
// proxy), and the live updates RPE sends this page on a socket into Lumiverse kept for nothing else,
// coalesced on the way. Both have one shape, so no page knows which carries it; the client picks one
// (client.ts) and the page says which.

import type { Clock } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { type LiveBatch, type LiveEvent, LIVE_PATH, LIVE_PROTOCOL, type MissingPermission, STATUS_PATH, TOKEN_PROTOCOL_PREFIX } from "./api";
import { errorWords } from "./words";

/** What a road hands on from RPE's live hub: a chat's events, a loss the page must read past, or RPE's refusal (or why the live updates stopped). */
export type LiveUpdate =
  | ({ type: "events" } & LiveBatch)
  /** Updates were lost that no batch names: for one chat after its socket came back, or for every chat followed. */
  | { type: "reset"; chat?: string }
  | { type: "refused"; message: string };

/** One answer, its body as text. */
export interface RoadAnswer {
  status: number;
  text: string;
}

export interface Road {
  readonly kind: "direct" | "relay";
  /** A request under RPE's API, with the page's credential. Rejects when RPE was not reached at all. */
  request(method: string, path: string, body: string | undefined, token: string): Promise<RoadAnswer>;
  /** Follows a chat's live events; resolves once RPE follows it for this page, rejects with RPE's words. */
  follow(chat: string): Promise<void>;
  unfollow(chat: string): Promise<void>;
  onLive(listener: (update: LiveUpdate) => void): () => void;
  close(): void;
}

// ---------------------------------------------------------------- what the roads are made of

/** A request as a road sends it; the browser's `fetch` takes it as it is. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type Fetcher = (url: string, init: FetchInit) => Promise<{ status: number; text(): Promise<string> }>;

export interface SocketHandlers {
  open(): void;
  message(text: string): void;
  /** The socket closed, or never opened. */
  close(): void;
}
export interface SocketHandle {
  send(text: string): void;
  close(): void;
}
/** Opens a socket that offers `protocols`; may throw when the browser refuses it outright. */
export type SocketOpener = (url: string, protocols: string[], handlers: SocketHandlers) => SocketHandle;

export type Timers = Pick<Clock, "now" | "setTimeout" | "clearTimeout">;

export interface RoadDeps {
  fetch: Fetcher;
  openSocket: SocketOpener;
  timers: Timers;
}

/** What proves the page to RPE, and how to get another after RPE refused it. */
export interface Credential {
  token(): string;
  /** A fresh credential; false when there is none to get. Rejects, in the words of whoever gives it, when one could not be had. */
  renew(): Promise<boolean>;
}

export interface SocketSettings {
  /** How long the page waits before it tries again: the live socket after it closed, a page token that could not be had. The wait doubles each time, up to `reconnectMaxMs`. */
  reconnectMs: number;
  reconnectMaxMs: number;
}

/** The browser's own fetch, socket and timers. */
export function browserDeps(): RoadDeps {
  return {
    fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
    openSocket(url, protocols, handlers) {
      const socket = new WebSocket(url, protocols);
      socket.onopen = () => handlers.open();
      socket.onmessage = (event) => {
        if (typeof event.data === "string") handlers.message(event.data);
      };
      socket.onclose = () => handlers.close();
      return { send: (text) => socket.send(text), close: () => socket.close() };
    },
    timers: { now: () => Date.now(), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  };
}

function headersFor(token: string, body: string | undefined): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) };
}

/** The live socket's address on RPE at `base`. */
export function socketUrl(base: string): string {
  const url = new URL(LIVE_PATH, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function readEvent(value: unknown): LiveEvent | null {
  if (!isRecord(value) || typeof value.chat !== "string" || typeof value.seq !== "number" || typeof value.kind !== "string" || typeof value.at !== "number" || !("data" in value)) return null;
  return value as unknown as LiveEvent;
}

/** A batch of the live hub's (`{chat, events, missed?}`), as the socket sends it and the relay carries it; null for anything else. */
export function readBatch(value: unknown): LiveBatch | null {
  if (!isRecord(value) || typeof value.chat !== "string" || !Array.isArray(value.events)) return null;
  const events: LiveEvent[] = [];
  for (const item of value.events) {
    const event = readEvent(item);
    if (event === null) return null;
    events.push(event);
  }
  const missed = value.missed;
  if (missed !== undefined && !(isRecord(missed) && typeof missed.from === "number" && typeof missed.to === "number")) return null;
  return { chat: value.chat, events, ...(missed === undefined ? {} : { missed: { from: missed.from as number, to: missed.to as number } }) };
}

// ---------------------------------------------------------------- direct

/** Whether a page reached RPE at an address itself, and if not, why not, in words the page shows. */
export type Probe = { ok: true } | { ok: false; why: string };

/**
 * Whether this page can reach RPE at `base` itself: the status route with the page's credential (which
 * asks the browser's preflight, as every real call does), then the live socket. Browsers differ on a
 * page served over HTTPS calling a loopback address, and some let the HTTP call through and not the
 * socket, so both are tried.
 */
export async function probeDirect(base: string, token: string, deps: RoadDeps, timeoutMs: number): Promise<Probe> {
  const seconds = `${Math.round(timeoutMs / 100) / 10} s`;
  const controller = new AbortController();
  const timer = deps.timers.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const answer = await deps.fetch(new URL(STATUS_PATH, base).toString(), { method: "GET", headers: headersFor(token, undefined), signal: controller.signal });
    if (answer.status !== 200) return { ok: false, why: `it answered ${answer.status}` };
    let body: unknown = null;
    try {
      body = JSON.parse(await answer.text());
    } catch {
      // Not JSON: not RPE.
    }
    if (!isRecord(body) || body.name !== "rpe") return { ok: false, why: "something other than RPE answered there" };
  } catch (error) {
    return { ok: false, why: controller.signal.aborted ? `no answer within ${seconds}` : `the browser did not let this page call it (${errorWords(error)})` };
  } finally {
    deps.timers.clearTimeout(timer);
  }
  const { promise, resolve } = Promise.withResolvers<Probe>();
  let handle: SocketHandle | null = null;
  let done = false;
  const finish = (result: Probe): void => {
    if (done) return;
    done = true;
    deps.timers.clearTimeout(wait);
    handle?.close();
    resolve(result);
  };
  const wait = deps.timers.setTimeout(() => finish({ ok: false, why: `its live socket did not open within ${seconds}` }), timeoutMs);
  try {
    handle = deps.openSocket(socketUrl(base), [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`], {
      open: () => finish({ ok: true }),
      message: () => undefined,
      close: () => finish({ ok: false, why: "the browser did not let this page open its live socket" }),
    });
    if (done) handle.close();
  } catch (error) {
    finish({ ok: false, why: `the browser did not let this page open its live socket (${errorWords(error)})` });
  }
  return await promise;
}

/**
 * The direct road to RPE at `base`. Requests go by HTTP; the live socket opens with the first chat
 * followed, follows every chat again when it comes back after closing, and tells the page that each of
 * those chats lost what came while it was away. A socket that closed without ever opening may have
 * offered a token that ran out, so a fresh one is asked for before the next try; when none can be had,
 * the page is told why, so its live view does not stop unsaid.
 */
export function directRoad(base: string, credential: Credential, deps: RoadDeps, settings: SocketSettings): Road {
  const url = socketUrl(base);
  const listeners = new Set<(update: LiveUpdate) => void>();
  const followed = new Set<string>();
  /** Chats RPE follows on the socket now open. */
  const confirmed = new Set<string>();
  /** Chats that were followed when the socket closed: each is told of its loss once followed again. */
  const lost = new Set<string>();
  const waiting = new Map<string, { resolve(): void; reject(error: Error): void }[]>();
  let socket: SocketHandle | null = null;
  let isOpen = false;
  let retry: unknown = null;
  /** A fresh credential is being asked for: the socket is tried again once it is in. */
  let renewing = false;
  let delay = settings.reconnectMs;
  let closed = false;

  const emit = (update: LiveUpdate): void => {
    for (const listener of [...listeners]) listener(update);
  };
  const settle = (chat: string, error?: Error): void => {
    const list = waiting.get(chat) ?? [];
    waiting.delete(chat);
    for (const w of list) {
      if (error === undefined) w.resolve();
      else w.reject(error);
    }
  };
  const send = (message: { op: "follow" | "unfollow"; chat: string }): void => {
    if (socket !== null && isOpen) socket.send(JSON.stringify(message));
  };

  function receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (message.type === "following" && typeof message.chat === "string") {
      const chat = message.chat;
      if (!followed.has(chat)) return;
      confirmed.add(chat);
      settle(chat);
      if (lost.delete(chat)) emit({ type: "reset", chat });
      return;
    }
    if (message.type === "events") {
      const batch = readBatch(message);
      if (batch !== null && followed.has(batch.chat)) emit({ type: "events", ...batch });
      return;
    }
    if (message.type === "refused") {
      const said = typeof message.message === "string" ? message.message : "RPE refused the live socket's message.";
      for (const chat of [...waiting.keys()]) settle(chat, new Error(said));
      emit({ type: "refused", message: said });
    }
  }

  /** The next try at the socket, after a wait that doubles each time, up to `reconnectMaxMs`. */
  function later(): void {
    if (closed || followed.size === 0 || retry !== null || renewing) return;
    retry = deps.timers.setTimeout(() => {
      retry = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, settings.reconnectMaxMs);
  }

  function closedUnder(): void {
    const opened = isOpen;
    socket = null;
    isOpen = false;
    for (const chat of confirmed) lost.add(chat);
    confirmed.clear();
    if (closed || followed.size === 0) return;
    if (opened) {
      later();
      return;
    }
    renewing = true;
    void credential
      .renew()
      .then(
        () => undefined,
        (error: unknown) => {
          if (!closed) emit({ type: "refused", message: `RPE's live updates stopped, and no new page token could be had: ${errorWords(error)}` });
        },
      )
      .finally(() => {
        renewing = false;
        later();
      });
  }

  function connect(): void {
    if (closed || socket !== null || retry !== null || renewing) return;
    try {
      socket = deps.openSocket(url, [LIVE_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${credential.token()}`], {
        open: () => {
          isOpen = true;
          delay = settings.reconnectMs;
          for (const chat of followed) send({ op: "follow", chat });
        },
        message: receive,
        close: closedUnder,
      });
    } catch {
      closedUnder();
    }
  }

  return {
    kind: "direct",
    async request(method, path, body, token) {
      const answer = await deps.fetch(new URL(path, base).toString(), { method, headers: headersFor(token, body), ...(body === undefined ? {} : { body }) });
      return { status: answer.status, text: await answer.text() };
    },
    follow(chat) {
      if (closed) return Promise.reject(new Error("The page closed."));
      if (confirmed.has(chat)) return Promise.resolve();
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      waiting.set(chat, [...(waiting.get(chat) ?? []), { resolve, reject }]);
      if (!followed.has(chat)) {
        followed.add(chat);
        if (socket === null) connect();
        else send({ op: "follow", chat });
      }
      return promise;
    },
    async unfollow(chat) {
      followed.delete(chat);
      confirmed.delete(chat);
      lost.delete(chat);
      settle(chat, new Error("The page stopped following this chat."));
      send({ op: "unfollow", chat });
    },
    onLive(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      deps.timers.clearTimeout(retry);
      retry = null;
      for (const chat of [...waiting.keys()]) settle(chat, new Error("The page closed."));
      socket?.close();
      socket = null;
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------- relay

/** What the extension hands a page when it starts: a short-lived page token, how long it still works, RPE's addresses best first, RPE's build. */
export interface StartFacts {
  token: string;
  /**
   * How long the token still works, in milliseconds, as RPE answered. The page counts it from when the
   * facts reach it, on its own clock: the browser's clock and RPE's need not agree.
   */
  expiresInMs: number;
  addresses: string[];
  build: string;
}

export interface StartAnswer {
  facts: StartFacts | null;
  /** Why there are no facts, in words the page shows. */
  error?: string;
  missing: MissingPermission[];
}

/**
 * The page's end of the extension's pipe, as the extension's loader hands it over (`src/ext/page.ts`):
 * start-up facts, one request and one whole answer, follows, and the lists of live updates RPE sends this
 * page, in order (`reset`: some were lost on the way).
 */
export interface RelayChannel {
  start(): Promise<StartAnswer>;
  request(request: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  follow(chat: string): Promise<void>;
  unfollow(chat: string): Promise<void>;
  onUpdates(handler: (updates: unknown[], reset: boolean) => void): () => void;
  onPermissions(handler: (missing: MissingPermission[]) => void): () => void;
}

/** The relay road over the extension's pipe. The pipe itself is the loader's: closing the road leaves it running. */
export function relayRoad(channel: RelayChannel): Road {
  const listeners = new Set<(update: LiveUpdate) => void>();
  const followed = new Set<string>();
  const emit = (update: LiveUpdate): void => {
    for (const listener of [...listeners]) listener(update);
  };
  const off = channel.onUpdates((updates, reset) => {
    if (reset) emit({ type: "reset" });
    for (const update of updates) {
      const batch = readBatch(update);
      if (batch !== null && followed.has(batch.chat)) emit({ type: "events", ...batch });
    }
  });
  return {
    kind: "relay",
    async request(method, path, body, token) {
      const answer = await channel.request({ method, path, headers: headersFor(token, body), ...(body === undefined ? {} : { body }) });
      return { status: answer.status, text: answer.body };
    },
    async follow(chat) {
      followed.add(chat);
      await channel.follow(chat);
    },
    async unfollow(chat) {
      followed.delete(chat);
      await channel.unfollow(chat);
    },
    onLive(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      off();
      for (const chat of followed) void channel.unfollow(chat).catch(() => undefined);
      followed.clear();
      listeners.clear();
    },
  };
}
