// A socket into Lumiverse as RPE's user (STANDALONE-PLAN §4.2, §4.3). RPE holds two: the event socket,
// which hears Lumiverse's events about the user's chats, and the relay socket, kept for nothing but the
// pages' live updates (`relay.ts`), so a busy live view can never get the event socket closed.
//
// Opening one: a single-use ticket from `POST /api/v1/ws-ticket`, good for 30 seconds (`app.ts:494-498`,
// `ws/tickets.ts:22`, `:62-67`), then `/api/ws?ticket=…` (`app.ts:500`). Lumiverse answers `CONNECTED`
// first (`ws/handler.ts:243-247`), or `AUTH_ERROR` and a close with 1008 (`:128-135`). Every frame it
// sends is `{event, payload, timestamp}` (`ws/bus.ts:512-518`), but `pong`. A socket opened with a
// frontend session of its own (32 hex digits) can be addressed alone by the extension's
// `sendToFrontend` (`spindle/frontend-session.ts:14-34`), and `frontend_runtime=widget` keeps it from
// taking the browser's place as the session that runs extension frontends (`ws/handler.ts:200`).
//
// Kept open: Lumiverse closes a socket that has sent nothing for 120 seconds (`ws/bus.ts:17-18`,
// `:457-466`), so it pings every 30 seconds as Lumiverse's own page does (`frontend/src/ws/client.ts:27`),
// and takes a missing pong for a dead connection (`:37`). When it closes it is opened again after a
// wait that grows, until RPE's session is lost: then it waits for a new sign-in.

import type { Clock } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { LumiverseError, type LumiverseSession } from "./session";

export interface SocketEvents {
  message(text: string): void;
  close(code: number, reason: string): void;
}

export interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** Opens a WebSocket; events arrive later, never during the call. RPE's server gives Bun's WebSocket. */
export type OpenSocket = (url: string, events: SocketEvents) => Socket;

/** Bun's WebSocket as an `OpenSocket`. */
export const bunSocket: OpenSocket = (url, events) => {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (e) => events.message(typeof e.data === "string" ? e.data : ""));
  ws.addEventListener("close", (e) => events.close(e.code, e.reason));
  return { send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) };
};

export interface SocketSettings {
  /** How often it pings while open. */
  pingMs: number;
  /** How long a ping waits for its pong before the connection is taken for dead. */
  pongMs: number;
  /** How long an opening socket waits for Lumiverse's `CONNECTED`. */
  openMs: number;
  /** The first wait before opening again, doubled after each failure up to `retryMaxMs`. */
  retryMs: number;
  retryMaxMs: number;
}

/**
 * Fixed defaults: Lumiverse's own page pings every 30 s and gives a pong 15 s (`frontend/src/ws/
 * client.ts:27`, `:37`); Lumiverse itself closes a socket it has not let in within 10 s
 * (`ws/receive-queue.ts:124`), so 20 s covers a connection that never answers at all.
 */
export const SOCKET_DEFAULTS: SocketSettings = { pingMs: 30_000, pongMs: 15_000, openMs: 20_000, retryMs: 1_000, retryMaxMs: 30_000 };

export interface LumiverseSocketDeps {
  session: LumiverseSession;
  open: OpenSocket;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  log(message: string): void;
  /** A frontend session of its own (32 lowercase hex digits), so the extension can address this socket alone. */
  frontendSession?: string;
  settings?: Partial<SocketSettings>;
}

export type SocketState =
  | { state: "stopped" }
  | { state: "opening"; since: number }
  | { state: "open"; since: number }
  /** Closed, and opened again at `retryAt`. */
  | { state: "waiting"; since: number; retryAt: number; why: string }
  /** RPE's session is lost: it opens again after a new sign-in. */
  | { state: "lost"; since: number; why: string };

/** A frontend session id as Lumiverse takes one (`spindle/frontend-session.ts:1-5`). */
export function newFrontendSession(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type EventHandler = (event: string, payload: unknown) => void;

export class LumiverseSocket {
  private socket: Socket | null = null;
  private current: SocketState = { state: "stopped" };
  private readonly settings: SocketSettings;
  private readonly handlers = new Set<EventHandler>();
  private readonly opened = new Set<() => void>();
  private readonly changed = new Set<(state: SocketState) => void>();
  private timers: unknown[] = [];
  private failures = 0;
  private running = false;
  private offSession: (() => void) | null = null;

  constructor(private readonly deps: LumiverseSocketDeps) {
    this.settings = { ...SOCKET_DEFAULTS, ...deps.settings };
  }

  state(): SocketState {
    return this.current;
  }

  get open(): boolean {
    return this.current.state === "open";
  }

  /** Every event Lumiverse sends on it, by name. */
  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Each time it opens (again): what was missed while it was closed is the caller's to find. */
  onOpen(handler: () => void): () => void {
    this.opened.add(handler);
    return () => this.opened.delete(handler);
  }

  onState(handler: (state: SocketState) => void): () => void {
    this.changed.add(handler);
    return () => this.changed.delete(handler);
  }

  private set(next: SocketState): void {
    this.current = next;
    for (const handler of this.changed) handler(next);
  }

  private later(ms: number, run: () => void): void {
    const handle = this.deps.clock.setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== handle);
      run();
    }, ms);
    this.timers.push(handle);
  }

  private clearTimers(): void {
    for (const t of this.timers) this.deps.clock.clearTimeout(t);
    this.timers = [];
  }

  /** Opens it and keeps it open until `stop`. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.offSession = this.deps.session.onChange((s) => {
      // A new sign-in after a loss: open again at once.
      if (s.state === "signed-in" && this.current.state === "lost") void this.connect();
    });
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.offSession?.();
    this.offSession = null;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "RPE closed it");
    this.set({ state: "stopped" });
  }

  /** Sends one frame if it is open; false when it is not, and nothing was sent. */
  send(frame: Record<string, unknown>): boolean {
    if (this.socket === null || this.current.state !== "open") return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private async ticket(): Promise<string> {
    const res = await this.deps.session.request("POST", "/api/v1/ws-ticket", {});
    const body: unknown = res.status === 200 ? await res.json().catch(() => null) : null;
    if (!isRecord(body) || typeof body.ticket !== "string") throw new LumiverseError("protocol", `Lumiverse at ${this.deps.session.base} gave no socket ticket (${res.status}).`, res.status);
    return body.ticket;
  }

  private url(ticket: string): string {
    const url = new URL(this.deps.session.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/ws`;
    const query: Record<string, string> = { ticket };
    if (this.deps.frontendSession !== undefined) {
      query.frontend_session = this.deps.frontendSession;
      query.frontend_runtime = "widget";
    }
    url.search = new URLSearchParams(query).toString();
    return url.toString();
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.clearTimers();
    this.set({ state: "opening", since: this.deps.clock.now() });
    let ticket: string;
    try {
      ticket = await this.ticket();
    } catch (error) {
      if (!this.running) return;
      if (error instanceof LumiverseError && (error.problem === "lost" || error.problem === "signed-out")) {
        this.set({ state: "lost", since: this.deps.clock.now(), why: error.message });
        return;
      }
      this.retry(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!this.running) return;
    const socket = this.deps.open(this.url(ticket), {
      message: (text) => this.received(socket, text),
      close: (code, reason) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.closed(code === 1008 ? `Lumiverse refused the socket's ticket (${reason || code})` : `Lumiverse closed the socket (${code}${reason ? ` ${reason}` : ""})`);
      },
    });
    this.socket = socket;
    this.later(this.settings.openMs, () => {
      if (this.socket !== socket || this.current.state !== "opening") return;
      this.socket = null;
      socket.close(4000, "no answer");
      this.closed("Lumiverse did not let the socket in");
    });
  }

  private received(socket: Socket, text: string): void {
    if (socket !== this.socket) return;
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(frame)) return;
    if (frame.type === "pong") {
      this.pongDue = null;
      return;
    }
    if (typeof frame.event !== "string") return;
    if (frame.event === "CONNECTED") {
      this.failures = 0;
      this.set({ state: "open", since: this.deps.clock.now() });
      this.ping();
      for (const handler of this.opened) handler();
      return;
    }
    if (frame.event === "AUTH_ERROR") return;
    for (const handler of this.handlers) handler(frame.event, frame.payload);
  }

  /** When the last ping's pong is due; null when none is awaited. */
  private pongDue: number | null = null;

  private ping(): void {
    this.later(this.settings.pingMs, () => {
      if (this.socket === null || this.current.state !== "open") return;
      if (this.pongDue !== null && this.deps.clock.now() >= this.pongDue) {
        // The last ping went unanswered: the connection is dead though no close came.
        const socket = this.socket;
        this.socket = null;
        socket.close(4000, "no pong");
        this.closed("Lumiverse stopped answering the socket's pings");
        return;
      }
      this.socket.send(JSON.stringify({ type: "ping" }));
      this.pongDue = this.deps.clock.now() + this.settings.pongMs;
      this.ping();
    });
  }

  private closed(why: string): void {
    this.pongDue = null;
    if (!this.running) return;
    this.retry(why);
  }

  private retry(why: string): void {
    this.clearTimers();
    const wait = Math.min(this.settings.retryMaxMs, this.settings.retryMs * 2 ** this.failures);
    this.failures++;
    const now = this.deps.clock.now();
    this.deps.log(`${why}; RPE opens it again in ${Math.round(wait / 1000)} s.`);
    this.set({ state: "waiting", since: now, retryAt: now + wait, why });
    this.later(wait, () => void this.connect());
  }
}
