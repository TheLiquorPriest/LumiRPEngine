// The engine's own pages speak to its backend over Lumiverse's event socket: `lre.*` requests for
// the engine and `lah.*` for the harness pages it mounts (LumiAH's), each a SPINDLE_BACKEND_MSG frame
// answered by reqId (DESIGN §23; LumiAH's `src/shared/ui.ts`). This is that client, opened either as
// a widget session (it never takes the browser's frontend slot, as the engine's CLI opens it) or as a
// page, which a generation started over REST then belongs to (Lumiverse names the newest page as the
// generation's frontend session), so the engine asks it to start the replies it prepares.

import type { Lumiverse } from "./lumiverse";

export interface Frame {
  [key: string]: unknown;
}

/** One Lumiverse event the socket heard (GENERATION_ENDED, MESSAGE_SWIPED, …) with its payload. */
export interface HostEvent {
  event: string;
  payload: Frame;
  at: number;
}

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly request: string,
  ) {
    super(`${request}: ${code}: ${message}`);
  }
}

interface Waiting {
  resolve(body: Frame): void;
  reject(error: Error): void;
  timer: Timer;
}

/** A request's wait; a turn's own requests answer in seconds, and a job's start returns before it runs. */
const ANSWER_MS = 300_000;
/** Lumiverse closes a socket idle for 120 s. */
const PING_MS = 45_000;

function sessionId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class EngineSocket {
  private socket: WebSocket | null = null;
  private readonly waiting = new Map<string, Waiting>();
  private seq = 0;
  private readonly prefix = sessionId().slice(0, 8);
  private ping: Timer | null = null;
  private readonly pushListeners = new Set<(push: Frame) => void>();
  private readonly eventListeners = new Set<(event: HostEvent) => void>();
  /** Every Lumiverse event heard, newest last, for a turn to look back over. */
  readonly events: HostEvent[] = [];

  private constructor(
    readonly host: Lumiverse,
    readonly extensionId: string,
    readonly page: boolean,
  ) {}

  /** Opens the socket and waits for Lumiverse's CONNECTED. */
  static async open(host: Lumiverse, extensionId: string, options: { page: boolean }): Promise<EngineSocket> {
    const out = new EngineSocket(host, extensionId, options.page);
    await out.connect();
    return out;
  }

  private async connect(): Promise<void> {
    const ticket = await this.host.ticket();
    const url = new URL(this.host.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/ws";
    const query: { [key: string]: string } = { ticket, frontend_session: sessionId() };
    if (!this.page) query.frontend_runtime = "widget";
    url.search = new URLSearchParams(query).toString();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => reject(new Error("the event socket gave no CONNECTED within 30 s")), 30_000);
    const socket = new WebSocket(url.toString());
    socket.addEventListener("message", (message) => {
      const frame = this.parse(String(message.data));
      if (frame === null) return;
      if (frame.event === "CONNECTED") {
        clearTimeout(timer);
        resolve();
        return;
      }
      if (frame.event === "AUTH_ERROR") {
        clearTimeout(timer);
        reject(new Error("Lumiverse refused the socket's ticket"));
        return;
      }
      this.receive(frame);
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      reject(new Error(`the event socket closed (${event.code} ${event.reason})`));
      this.closed(`the event socket closed (${event.code} ${event.reason})`);
    });
    this.socket = socket;
    await promise;
    this.ping = setInterval(() => this.socket?.send(JSON.stringify({ type: "ping" })), PING_MS);
  }

  private parse(text: string): Frame | null {
    try {
      const value = JSON.parse(text) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Frame) : null;
    } catch {
      return null;
    }
  }

  private receive(frame: Frame): void {
    const payload = frame.payload as Frame | undefined;
    if (frame.event === "SPINDLE_FRONTEND_MSG") {
      if (payload?.extensionId !== this.extensionId) return;
      const data = payload.data as Frame | undefined;
      if (data === undefined) return;
      const reqId = data.reqId;
      const answered = typeof reqId === "string" ? this.waiting.get(reqId) : undefined;
      if (answered !== undefined && typeof reqId === "string" && (data.type === "lre.result" || data.type === "lah.result" || data.type === "lre.error" || data.type === "lah.error")) {
        this.waiting.delete(reqId);
        clearTimeout(answered.timer);
        if (data.type === "lre.result" || data.type === "lah.result") answered.resolve((data.body ?? {}) as Frame);
        else answered.reject(new EngineError(String(data.code), String(data.message), String(data.request ?? "")));
        return;
      }
      for (const listener of this.pushListeners) listener(data);
      return;
    }
    if (typeof frame.event === "string") {
      const heard: HostEvent = { event: frame.event, payload: (payload ?? {}) as Frame, at: Date.now() };
      this.events.push(heard);
      if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
      for (const listener of this.eventListeners) listener(heard);
    }
  }

  private send(envelope: "lre" | "lah", type: string, fields: Frame, waitMs = ANSWER_MS): Promise<Frame> {
    const socket = this.socket;
    if (socket === null) return Promise.reject(new Error("the event socket is closed"));
    const reqId = `${this.prefix}-${++this.seq}`;
    const payload = envelope === "lre" ? { lre: 1, type, reqId, ...fields } : { lah: 1, type, reqId, ...fields };
    const { promise, resolve, reject } = Promise.withResolvers<Frame>();
    const timer = setTimeout(() => {
      this.waiting.delete(reqId);
      reject(new Error(`${type} got no answer within ${waitMs / 1000} s`));
    }, waitMs);
    this.waiting.set(reqId, { resolve, reject, timer });
    socket.send(JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId: this.extensionId, payload }));
    return promise;
  }

  /** One engine request (`lre.*`); its `lre.error` rejects with an EngineError. */
  lre<T = Frame>(type: string, fields: Frame = {}, waitMs?: number): Promise<T> {
    return this.send("lre", type, fields, waitMs) as Promise<T>;
  }

  /** One request of the harness pages (`lah.*`). */
  lah<T = Frame>(type: string, fields: Frame = {}, waitMs?: number): Promise<T> {
    return this.send("lah", type, fields, waitMs) as Promise<T>;
  }

  onPush(listener: (push: Frame) => void): () => void {
    this.pushListeners.add(listener);
    return () => this.pushListeners.delete(listener);
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private closed(why: string): void {
    clearInterval(this.ping ?? undefined);
    this.ping = null;
    this.socket = null;
    for (const [reqId, waiting] of this.waiting) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`${why} before ${reqId} was answered`));
    }
    this.waiting.clear();
  }

  close(): void {
    const socket = this.socket;
    this.closed("closed by the script");
    socket?.close();
  }
}
