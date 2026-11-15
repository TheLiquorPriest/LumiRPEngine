// The stand-in Lumiverse's sockets: each user's sockets as Lumiverse's server keeps them, with the
// limits a sender meets. Copied from Lumiverse's source (staging at a70f4ed2; paths are its `src/`):
// - the receive queue (`ws/receive-queue.ts:21-25`, `:81-95`, `:111-156`): frames read are counted
//   until their handler finishes; reading pauses at 16 (or 2 MiB) and resumes at 4 (512 KiB); a socket
//   paused for 10 s is closed (1013 "WebSocket receive queue stalled"), and one past 64 frames (8 MiB)
//   at once is closed (1013 "WebSocket receive queue full"); `ping` and the dialog results skip it;
// - a sender's backlog past 8 MiB closes the socket (`ws/transport.ts:5`, `:12-13`; `ws/bus.ts:84-97`);
// - a socket that has sent nothing for 120 s is closed by the sweep every 60 s, 1001 "Timeout"
//   (`ws/bus.ts:17-18`, `:457-466`);
// - frames over 1 MiB, or 4 MiB for an extension's message, are dropped (`ws/handler.ts:262-281`);
// - the receive queue runs nothing until the socket is let in, and takes a frame as a control frame (run at once) only once it is, and only at 64 KiB
//   or less (`ws/receive-queue.ts:124`, `:140`, `:150-152`); a binary frame closes it, 1003 "Expected a text message" (`:131-133`); one not let in within
//   10 s is closed, 1013 "WebSocket authentication timed out" (`:111-112`);
// - a socket whose page says it is hidden is let be 30 minutes, not 120 s (`ws/bus.ts:23`, `:461-463`, `:558`).
// Its own: frames a client sends in one instant arrive in one read; a handler of an extension's message
// takes `handlerMs`; a page reads what it is sent at `readBytesPerSecond`.

import type { Clock } from "rp-harness/contract";

export const RECEIVE_LIMITS = { highMessages: 16, lowMessages: 4, maxMessages: 64, highBytes: 2 * 1024 * 1024, lowBytes: 512 * 1024, maxBytes: 8 * 1024 * 1024, maxPauseMs: 10_000 };
const CONTROL_TYPES: Record<string, true> = { ping: true, visibility: true, stream_focus: true, SPINDLE_TEXT_EDITOR_RESULT: true, SPINDLE_CONFIRM_RESULT: true, SPINDLE_MODAL_RESULT: true, SPINDLE_INPUT_PROMPT_RESULT: true };
export const BACKPRESSURE_LIMIT = 8 * 1024 * 1024;
export const CLIENT_TIMEOUT_MS = 120_000;
export const SWEEP_MS = 60_000;
/** `HIDDEN_CLIENT_TIMEOUT_MS` (`ws/bus.ts:23`). */
export const HIDDEN_CLIENT_TIMEOUT_MS = 30 * 60_000;
/** The largest frame taken as a control frame (`ws/receive-queue.ts:140`). */
const CONTROL_SIZE_MAX = 64 * 1024;
const SIZE_LIMIT = 1024 * 1024;
const SIZE_LIMIT_BACKEND_MSG = 4 * 1024 * 1024;

/** What the client end of a socket is told. */
export interface ClientEvents {
  message(text: string): void;
  close(code: number, reason: string): void;
}

export interface SocketOptions {
  user: string;
  /** Its frontend session, when it was opened with one. */
  session?: string;
  /** How fast its client reads what it is sent; unbounded when not said. */
  readBytesPerSecond?: number;
  /** How long a handler of an extension's message takes. */
  handlerMs: number;
}

export interface SocketStats {
  /** The most frames counted in its receive queue at once. */
  mostPending: number;
  /** The most bytes waiting for its client at once. */
  mostBuffered: number;
  /** How many times reading paused. */
  pauses: number;
  framesIn: number;
  framesOut: number;
  dropped: number;
}

export class ServerSocket {
  readonly stats: SocketStats = { mostPending: 0, mostBuffered: 0, pauses: 0, framesIn: 0, framesOut: 0, dropped: 0 };
  closed: { code: number; reason: string } | null = null;
  /** Let in (`ws/receive-queue.ts:104-109`): until it is, its frames are counted and kept, and none is run. A socket made for a page is let in at once. */
  admitted = true;
  /** Its page's own word (`visibility`, `ws/handler.ts:299-304`): hidden pages are let be 30 minutes (`ws/bus.ts:461-463`). */
  visible = true;
  /** The chat its page says it is viewing (`stream_focus`, `ws/handler.ts:306-312`; `setClientStreamFocus`, `ws/bus.ts:296-318`): the stream tokens of that chat reach this socket and no other of the user's. */
  focus: string | null = null;
  /** Whether its frontend session may be the generating one (`executionOwner`, `ws/handler.ts:201`): a socket opened with `frontend_runtime=widget` never is (`spindle/frontend-session.ts:36-42`). */
  executionOwner = true;
  /** When the client last sent anything (`ws/handler.ts:257`). */
  lastInbound: number;
  private pending = 0;
  private bytes = 0;
  private paused = false;
  private pauseTimer: unknown = null;
  private running = false;
  private readonly queue: { text: string; size: number; frame: Record<string, unknown> | null }[] = [];
  /** Frames sent but not read: the network's, while reading is paused. */
  private readonly wire: string[] = [];
  private arriving: string[] = [];
  private arrival: unknown = null;
  private readonly outbox: string[] = [];
  private buffered = 0;
  private reader: unknown = null;

  constructor(
    readonly options: SocketOptions,
    private readonly clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">,
    private readonly client: ClientEvents,
    /** What the server does with a frame its queue lets through. */
    private readonly handle: (socket: ServerSocket, frame: Record<string, unknown>) => Promise<void> | void,
    private readonly onClosed: (socket: ServerSocket) => void,
  ) {
    this.lastInbound = clock.now();
  }

  get user(): string {
    return this.options.user;
  }

  get session(): string | undefined {
    return this.options.session;
  }

  /** How long it may be silent before the sweep closes it (`ws/bus.ts:461-463`): 120 s, or 30 minutes where its page said it is hidden. */
  get timeoutMs(): number {
    return this.visible ? CLIENT_TIMEOUT_MS : HIDDEN_CLIENT_TIMEOUT_MS;
  }

  /** Let in once its ticket is taken (`ws/receive-queue.ts:104-109`): it is whose it is, and what its queue kept is run. */
  admit(user: string, session?: string, widget = false): void {
    this.options.user = user;
    if (session !== undefined) this.options.session = session;
    this.executionOwner = !widget;
    this.admitted = true;
    void this.pump();
  }

  /** The client sends a binary frame: the application's protocol is JSON text, and Lumiverse closes the socket at once (`ws/receive-queue.ts:131-133`). */
  fromClientBinary(): void {
    this.close(1003, "Expected a text message");
  }

  /** The client sends a frame: it arrives with the others it sent in the same instant. */
  fromClient(text: string): void {
    if (this.closed !== null) return;
    this.arriving.push(text);
    this.arrival ??= this.clock.setTimeout(() => {
      this.arrival = null;
      const batch = this.arriving;
      this.arriving = [];
      this.wire.push(...batch);
      this.read();
    }, 0);
  }

  /** Reads what the network holds unless paused: one read takes every frame that came in it. */
  private read(): void {
    if (this.paused) return;
    const batch = this.wire.splice(0);
    for (const text of batch) {
      if (this.closed !== null) return;
      this.received(text);
    }
  }

  private received(text: string): void {
    this.lastInbound = this.clock.now();
    this.stats.framesIn++;
    const size = new TextEncoder().encode(text).length;
    if (this.pending + 1 > RECEIVE_LIMITS.maxMessages || this.bytes + size > RECEIVE_LIMITS.maxBytes) {
      this.close(1013, "WebSocket receive queue full");
      return;
    }
    this.pending++;
    this.bytes += size;
    this.stats.mostPending = Math.max(this.stats.mostPending, this.pending);
    let frame: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      frame = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      frame = null;
    }
    // Oversized frames are dropped unread (`ws/handler.ts:262-281`).
    const limit = frame?.type === "SPINDLE_BACKEND_MSG" && /^\s*\{\s*"type"\s*:\s*"SPINDLE_BACKEND_MSG"/.test(text.slice(0, 256)) ? SIZE_LIMIT_BACKEND_MSG : SIZE_LIMIT;
    if (size > limit) {
      this.stats.dropped++;
      frame = null;
    }
    this.pressure();
    const item = { text, size, frame };
    if (frame !== null && this.admitted && size <= CONTROL_SIZE_MAX && Object.hasOwn(CONTROL_TYPES, String(frame.type))) void this.run(item);
    else {
      this.queue.push(item);
      void this.pump();
    }
  }

  private pressure(): void {
    if (this.closed !== null) return;
    if (!this.paused && (this.pending >= RECEIVE_LIMITS.highMessages || this.bytes >= RECEIVE_LIMITS.highBytes)) {
      this.paused = true;
      this.stats.pauses++;
      this.pauseTimer = this.clock.setTimeout(() => this.close(1013, "WebSocket receive queue stalled"), RECEIVE_LIMITS.maxPauseMs);
    } else if (this.paused && this.pending <= RECEIVE_LIMITS.lowMessages && this.bytes <= RECEIVE_LIMITS.lowBytes) {
      this.paused = false;
      if (this.pauseTimer !== null) this.clock.clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
      this.read();
    }
  }

  private async run(item: { text: string; size: number; frame: Record<string, unknown> | null }): Promise<void> {
    try {
      if (item.frame !== null && this.closed === null) await this.handle(this, item.frame);
    } finally {
      if (this.closed === null) {
        this.pending--;
        this.bytes -= item.size;
        this.pressure();
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.running || !this.admitted) return;
    this.running = true;
    try {
      while (this.closed === null && this.queue.length > 0) await this.run(this.queue.shift()!);
    } finally {
      this.running = false;
    }
  }

  /** The server sends a frame: it waits until the client reads it, and a backlog past the limit closes the socket. */
  send(text: string): void {
    if (this.closed !== null) return;
    const size = new TextEncoder().encode(text).length;
    this.outbox.push(text);
    this.buffered += size;
    this.stats.framesOut++;
    this.stats.mostBuffered = Math.max(this.stats.mostBuffered, this.buffered);
    if (this.buffered > BACKPRESSURE_LIMIT) {
      this.close(1013, "WebSocket subscriber too slow");
      return;
    }
    this.reader ??= this.clock.setTimeout(() => this.drain(), this.options.readBytesPerSecond === undefined ? 0 : 50);
  }

  /** The client reads: all it was sent, or as much as its rate has allowed since it last waited. */
  private credit = 0;
  private drain(): void {
    this.reader = null;
    if (this.closed !== null) return;
    const rate = this.options.readBytesPerSecond;
    this.credit = rate === undefined ? Infinity : this.credit + rate / 20;
    while (this.outbox.length > 0) {
      const next = this.outbox[0]!;
      const size = new TextEncoder().encode(next).length;
      if (size > this.credit) break;
      this.outbox.shift();
      this.buffered -= size;
      this.credit -= size;
      this.client.message(next);
      if (this.closed !== null) return;
    }
    if (this.outbox.length > 0) this.reader = this.clock.setTimeout(() => this.drain(), 50);
    else this.credit = 0;
  }

  /** The server closes it. */
  close(code: number, reason: string): void {
    if (this.closed !== null) return;
    this.closed = { code, reason };
    for (const t of [this.pauseTimer, this.arrival, this.reader]) if (t !== null) this.clock.clearTimeout(t);
    this.onClosed(this);
    this.clock.setTimeout(() => this.client.close(code, reason), 0);
  }

  /** The client closes it. */
  clientClosed(code = 1000, reason = ""): void {
    if (this.closed !== null) return;
    this.closed = { code, reason };
    for (const t of [this.pauseTimer, this.arrival, this.reader]) if (t !== null) this.clock.clearTimeout(t);
    this.onClosed(this);
  }
}
