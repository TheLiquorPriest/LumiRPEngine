// The live hub (plan §4.4): pages follow a chat's live events and state pushes over one socket,
// `/api/v1/live`. Whatever runs a chat publishes to it by chat; a chat's events are numbered from 1,
// and every reader gets them in that order. Publishing never waits. A reader that keeps up gets each
// event as it is published; one that falls behind gets what it missed in one batch when it is ready
// again, with state pushes coalesced (a push with a key replaces an older one with the same key that
// the reader has not taken yet), and, past a limit, the oldest of the other events dropped and named,
// so the page can read again what it needs. A slow reader never holds up a turn.
//
// The socket's messages, as JSON:
// - from the page: `{"op":"follow","chat":…}`, `{"op":"unfollow","chat":…}`;
// - to the page: `{"type":"following","chat":…,"seq":…}` (the chat's last number when following
//   began), `{"type":"events","chat":…,"events":[…],"missed":{"from":…,"to":…}}` (`missed` only when
//   events between those numbers were dropped), `{"type":"refused","message":…}`.
// A page that cannot set a header gives its token as a protocol: `["rpe.live", "rpe.token.<token>"]`.

import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { rawRoute } from "./routes";

export const LIVE_PATH = "/api/v1/live";
export const LIVE_PROTOCOL = "rpe.live";
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";

export interface LiveEvent {
  chat: string;
  /** Rises by one with each of the chat's events, from 1. */
  seq: number;
  /** What happened, in the publishing area's words. */
  kind: string;
  /** Present on a state push: a newer push with the same key replaces this one for a reader that has not taken it yet. */
  key?: string;
  at: number;
  data: JsonValue;
}

/** An event as an area publishes it. */
export interface LivePublish {
  kind: string;
  key?: string;
  data: JsonValue;
}

/** What a reader is given: a chat's events in order, and the numbers of those dropped before them when it fell behind. */
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: { from: number; to: number };
}

export interface LiveReader {
  /**
   * Takes a batch (and the same as the socket's message). False: the batch was taken but the reader
   * is full now, and the hub holds what comes next until the following's `ready()`.
   */
  take(batch: LiveBatch, message: string): boolean;
}

interface Held {
  event: LiveEvent;
  json: string;
}

function messageOf(chat: string, held: readonly Held[], missed: { from: number; to: number } | null): string {
  return `{"type":"events","chat":${JSON.stringify(chat)},"events":[${held.map((h) => h.json).join(",")}]${missed === null ? "" : `,"missed":${JSON.stringify(missed)}`}}`;
}

/** One reader following one chat. */
export class Following {
  /** In number order; a hole where a newer push with the same key replaced the one held there. */
  private held: (Held | undefined)[] = [];
  private readonly heldByKey = new Map<string, number>();
  private plain = 0;
  private firstPlain = 0;
  private missed: { from: number; to: number } | null = null;
  private full = false;
  private stopped = false;

  constructor(
    readonly chat: string,
    private readonly reader: LiveReader,
    private readonly limit: number,
    private readonly onStop: (following: Following) => void,
  ) {}

  /** @internal The hub's: one event of the chat. */
  give(event: LiveEvent, json: string): void {
    if (this.stopped) return;
    if (!this.full && this.held.length === 0 && this.missed === null) {
      if (!this.reader.take({ chat: this.chat, events: [event] }, messageOf(this.chat, [{ event, json }], null))) this.full = true;
      return;
    }
    if (event.key !== undefined) {
      const older = this.heldByKey.get(event.key);
      if (older !== undefined) this.held[older] = undefined;
      this.heldByKey.set(event.key, this.held.length);
    } else this.plain++;
    this.held.push({ event, json });
    while (this.plain > this.limit) this.dropOldestPlain();
  }

  private dropOldestPlain(): void {
    for (; this.firstPlain < this.held.length; this.firstPlain++) {
      const held = this.held[this.firstPlain];
      if (held === undefined || held.event.key !== undefined) continue;
      this.held[this.firstPlain] = undefined;
      this.plain--;
      const seq = held.event.seq;
      this.missed = this.missed === null ? { from: seq, to: seq } : { from: Math.min(this.missed.from, seq), to: Math.max(this.missed.to, seq) };
      return;
    }
  }

  /** The reader has room again: it is given everything held, in one batch. */
  ready(): void {
    if (this.stopped) return;
    this.full = false;
    const held = this.held.filter((h): h is Held => h !== undefined);
    if (held.length === 0 && this.missed === null) return;
    const missed = this.missed;
    this.held = [];
    this.heldByKey.clear();
    this.plain = 0;
    this.firstPlain = 0;
    this.missed = null;
    const batch: LiveBatch = { chat: this.chat, events: held.map((h) => h.event), ...(missed === null ? {} : { missed }) };
    if (!this.reader.take(batch, messageOf(this.chat, held, missed))) this.full = true;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.held = [];
    this.heldByKey.clear();
    this.onStop(this);
  }
}

export interface LiveHubOptions {
  /** Events without a key held for one reader of one chat before the oldest are dropped. */
  queueEvents: number;
  now: () => number;
}

export class LiveHub {
  private readonly seqs = new Map<string, number>();
  private readonly followers = new Map<string, Set<Following>>();

  constructor(private readonly options: LiveHubOptions) {}

  /** Publishes an event to everyone following `chat`, and returns it with its number. Never waits. */
  publish(chat: string, event: LivePublish): LiveEvent {
    const seq = (this.seqs.get(chat) ?? 0) + 1;
    this.seqs.set(chat, seq);
    const out: LiveEvent = { chat, seq, kind: event.kind, ...(event.key === undefined ? {} : { key: event.key }), at: this.options.now(), data: event.data };
    const followers = this.followers.get(chat);
    if (followers === undefined) return out;
    const json = JSON.stringify(out);
    for (const following of followers) following.give(out, json);
    return out;
  }

  /** The number of `chat`'s last event; 0 before any. */
  seq(chat: string): number {
    return this.seqs.get(chat) ?? 0;
  }

  /** `reader` follows `chat` from its next event. */
  follow(chat: string, reader: LiveReader): Following {
    let followers = this.followers.get(chat);
    if (followers === undefined) this.followers.set(chat, (followers = new Set()));
    const following = new Following(chat, reader, this.options.queueEvents, (done) => {
      const set = this.followers.get(chat);
      set?.delete(done);
      if (set?.size === 0) this.followers.delete(chat);
    });
    followers.add(following);
    return following;
  }

  /** How many readers follow `chat`. */
  readers(chat: string): number {
    return this.followers.get(chat)?.size ?? 0;
  }
}

/** What a live socket keeps: the chats it follows. */
export interface LiveSocketData {
  follows: Map<string, Following>;
}

function refuse(ws: ServerWebSocket<LiveSocketData>, message: string): void {
  ws.send(JSON.stringify({ type: "refused", message }));
}

/** The server's socket handlers for the live hub. */
export function liveSockets(hub: LiveHub, messageBytes: number): WebSocketHandler<LiveSocketData> {
  return {
    maxPayloadLength: messageBytes,
    // A page that falls behind is held to its batch by the hub, never cut off.
    closeOnBackpressureLimit: false,
    message(ws, message) {
      let asked: unknown;
      try {
        asked = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      } catch {
        refuse(ws, "Messages on the live socket are JSON.");
        return;
      }
      if (!isRecord(asked) || (asked.op !== "follow" && asked.op !== "unfollow") || typeof asked.chat !== "string" || asked.chat === "") {
        refuse(ws, 'Send {"op":"follow","chat":"<chat id>"} or {"op":"unfollow","chat":"<chat id>"}.');
        return;
      }
      const chat = asked.chat;
      const follows = ws.data.follows;
      if (asked.op === "unfollow") {
        follows.get(chat)?.stop();
        follows.delete(chat);
        return;
      }
      if (follows.has(chat)) return;
      ws.send(JSON.stringify({ type: "following", chat, seq: hub.seq(chat) }));
      // Bun takes a message it cannot write at once and says so (-1); 0 means the socket is going.
      follows.set(chat, hub.follow(chat, { take: (_batch, text) => ws.send(text) > 0 }));
    },
    drain(ws) {
      for (const following of ws.data.follows.values()) following.ready();
    },
    close(ws) {
      for (const following of ws.data.follows.values()) following.stop();
      ws.data.follows.clear();
    },
  };
}

/** The live socket's route: a page's request made into a socket. */
export const liveRoute = rawRoute({
  method: "GET",
  path: LIVE_PATH,
  access: "page",
  raw(request, { openLiveSocket }) {
    const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
    if (offered.length > 0 && !offered.includes(LIVE_PROTOCOL)) return Response.json({ error: `Offer the protocol ${LIVE_PROTOCOL} to open the live socket.` }, { status: 400 });
    // A page that offered protocols must be answered with one of them, never with its token's.
    const opened = openLiveSocket(offered.length > 0 ? { "Sec-WebSocket-Protocol": LIVE_PROTOCOL } : undefined);
    return opened ? undefined : Response.json({ error: "This is the live socket: open it as a WebSocket." }, { status: 426 });
  },
});
