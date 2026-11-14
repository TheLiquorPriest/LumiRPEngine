// A stand-in RPE for the preview of the new pages: the routes they call, answered from the invented
// recorded turn (test/ui/recorded.ts), and the live socket, which plays that turn as it was recorded,
// in real time, each time a page follows a chat that has no turn playing. Any chat id is served the same
// turn. Any bearer is taken: the preview proves the pages, not RPE's auth. Nothing is kept.

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import type { JsonValue } from "../../../src/shared/json";
import type { LiveEvent, ReplyPiece } from "../../../src/ui/api";
import { CHATS, earlierTurn, EARLIER, RECORDED, RUN, summaryOf, T0, turnOf } from "../../../test/ui/recorded";

/** How long before the run began the request reached RPE, as the recorded turn has it. */
const INTAKE_MS = 240;

interface Playing {
  chat: string;
  run: string;
  /** The recording's T0 is moved to this moment. */
  started: number;
  /** The events played so far, as the hub sent them. */
  events: LiveEvent[];
  timers: ReturnType<typeof setTimeout>[];
  done: boolean;
}

export interface PreviewSocket {
  follows: Set<string>;
}

const sockets = new Set<ServerWebSocket<PreviewSocket>>();
const seqs = new Map<string, number>();
const playing = new Map<string, Playing>();
let runs = 30;

function publish(event: LiveEvent): void {
  const text = JSON.stringify({ type: "events", chat: event.chat, events: [event] });
  for (const ws of sockets) if (ws.data.follows.has(event.chat)) ws.send(text);
}

/** An event of the recording, as it is played for `chat` now: its chat, its run and its times moved. */
function retarget(event: LiveEvent, play: Playing): LiveEvent {
  const shift = play.started - T0;
  const seq = (seqs.get(play.chat) ?? 0) + 1;
  seqs.set(play.chat, seq);
  let data: unknown = event.data;
  if (event.kind === "trace") {
    const r = event.data as unknown as TraceRecord;
    data = { ...r, run: play.run, at: r.at + shift, scope: { ...r.scope, chat: play.chat, turn: play.run }, ...(r.parent === undefined ? {} : { parent: { ...r.parent, run: play.run } }) };
  } else if (event.kind === "delta") {
    // The recording's own delta, as test/ui/recorded.ts made it.
    const delta = event.data as unknown as TraceDelta;
    data = { ...delta, run: play.run, at: delta.at + shift };
  } else if (event.kind === "reply") data = { ...(event.data as unknown as ReplyPiece), run: play.run };
  return { chat: play.chat, seq, kind: event.kind, at: event.at + shift, data: data as JsonValue };
}

function play(chat: string): void {
  const current = playing.get(chat);
  if (current !== undefined && !current.done) return;
  const now = Date.now();
  const p: Playing = { chat, run: `turn-${++runs}`, started: now + 1000, events: [], timers: [], done: false };
  playing.set(chat, p);
  for (const event of RECORDED) {
    p.timers.push(
      setTimeout(() => {
        const out = retarget(event, p);
        p.events.push(out);
        publish(out);
        if (event === RECORDED.at(-1)) p.done = true;
      }, p.started - now + (event.at - T0)),
    );
  }
}

/** Stops the turn playing for `chat`: what is left is not played, and the run ends stopped. */
function stop(chat: string, run: string): boolean {
  const p = playing.get(chat);
  if (p === undefined || p.done || p.run !== run) return false;
  for (const timer of p.timers) clearTimeout(timer);
  p.done = true;
  const records = p.events.filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);
  const last = records.at(-1);
  const detail = turnOf(p.events, { run: p.run, chat, received: p.started - INTAKE_MS });
  const record: TraceRecord = { seq: (last?.seq ?? 0) + 1, run: p.run, scope: { user: "user-1", chat, session: "session-4", turn: p.run }, at: Date.now(), agent: { id: "a1", definition: "author" }, event: { kind: "run_ended", outcome: { status: "stopped", released: false, usage: detail.usage, error: { code: "stopped" } } } };
  const seq = (seqs.get(chat) ?? 0) + 1;
  seqs.set(chat, seq);
  const event: LiveEvent = { chat, seq, kind: "trace", at: record.at, data: record as unknown as JsonValue };
  p.events.push(event);
  publish(event);
  return true;
}

function detailOf(chat: string, turn: string, from: number) {
  const p = playing.get(chat);
  if (p !== undefined && p.run === turn) return turnOf(p.events, { run: p.run, chat, received: p.started - INTAKE_MS, from });
  if (p === undefined && turn === RUN) return turnOf(RECORDED, { run: RUN, chat, received: T0 - INTAKE_MS, from });
  return earlierTurn(turn, chat);
}

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The stand-in's answer to a request under `/api/v1/`, or undefined when it became the live socket. */
export function rpeAnswer(request: Request, server: Server<PreviewSocket>): Response | undefined {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/v1/status") return answer(200, { name: "rpe", version: "preview", started: T0, belongsToUser: true });
  if (path === "/api/v1/live") {
    if (server.upgrade(request, { data: { follows: new Set<string>() }, headers: { "Sec-WebSocket-Protocol": "rpe.live" } })) return undefined;
    return answer(426, { error: "This is the live socket: open it as a WebSocket." });
  }
  const credential = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
  if (!credential) return answer(401, { error: "This needs a page token or the web UI's token." });
  if (path === "/api/v1/chats") return answer(200, { chats: CHATS.chats.map((c) => ({ ...c, running: playing.get(c.id)?.done === false })) });
  const turns = /^\/api\/v1\/chats\/([^/]+)\/turns$/.exec(path);
  if (turns !== null && request.method === "GET") {
    const chat = decodeURIComponent(turns[1] as string);
    const p = playing.get(chat);
    const latest = p === undefined ? turnOf(RECORDED, { run: RUN, chat, received: T0 - INTAKE_MS }) : turnOf(p.events, { run: p.run, chat, received: p.started - INTAKE_MS });
    const all = [...(p === undefined || p.events.length > 0 ? [summaryOf(latest)] : []), ...EARLIER];
    const limit = Number(url.searchParams.get("limit") ?? all.length);
    return answer(200, { turns: all.slice(0, limit), more: limit < all.length });
  }
  const one = /^\/api\/v1\/chats\/([^/]+)\/turns\/([^/]+)(\/stop)?$/.exec(path);
  if (one !== null) {
    const chat = decodeURIComponent(one[1] as string);
    const turn = decodeURIComponent(one[2] as string);
    if (one[3] !== undefined) return request.method === "POST" ? answer(200, { stopped: stop(chat, turn) }) : answer(405, { error: "Stop takes POST." });
    const detail = detailOf(chat, turn, Number(url.searchParams.get("from") ?? 1));
    return detail === null ? answer(404, { error: `RPE has no turn ${turn} in this chat.` }) : answer(200, detail);
  }
  return answer(404, { error: `RPE has no ${request.method} ${path}.` });
}

/** The live socket's handlers: follow and unfollow a chat; following one with no turn playing plays the recorded turn for it. */
export const rpeSockets: WebSocketHandler<PreviewSocket> = {
  open(ws) {
    sockets.add(ws);
  },
  message(ws, message) {
    let asked: { op?: string; chat?: string };
    try {
      asked = JSON.parse(String(message));
    } catch {
      ws.send(JSON.stringify({ type: "refused", message: "Messages on the live socket are JSON." }));
      return;
    }
    const chat = asked.chat;
    if (typeof chat !== "string" || chat === "") return;
    if (asked.op === "unfollow") {
      ws.data.follows.delete(chat);
      return;
    }
    if (asked.op !== "follow" || ws.data.follows.has(chat)) return;
    ws.data.follows.add(chat);
    ws.send(JSON.stringify({ type: "following", chat, seq: seqs.get(chat) ?? 0 }));
    play(chat);
  },
  close(ws) {
    sockets.delete(ws);
  },
};
