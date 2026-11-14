// A stand-in RPE for the preview of the new pages: the routes they call, answered from the invented
// recorded turn (test/ui/recorded.ts), and the live socket, which plays that turn as it was recorded,
// in real time, each time a page follows a chat that has no turn playing. Any chat id is served the same
// turn. Any bearer is taken: the preview proves the pages, not RPE's auth. Nothing is kept.
//
// Preview controls, outside RPE's API (`previewControl`):
// - `/preview/extension?state=well|unregistered|missing`: how RPE says its extension in Lumiverse stands.
// - `/preview/continue?chat=<chat>`: continues the turn played last in the chat, as RPE runs a continue:
//   the same turn run again under the same run id, its records numbered from 1 again.
// - `/preview/build?backend=rpe|stand-in`: who answers Build's route (mock-build.ts).
// - `/preview/migration?run=yes|no`: whether a migration has run (mock-migration.ts).
//
// Connections are kept in memory while the preview runs, so the Connections page can add, change and
// remove them; a key sent is never kept, only that one was. So are the worlds Build makes and edits, the
// agents' files and settings the Files and Settings pages change (mock-tree.ts, mock-settings.ts), and
// what the Play page's taps change of a chat's state (mock-play.ts).

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { ConnectionView, ModelLimit, ProviderOffer, TraceDelta, TraceRecord } from "rp-harness/contract";
import type { JsonValue } from "../../../src/shared/json";
import type { ConnectionShown, ExtensionStatus, LiveEvent, ReplyPiece, SaveConnection, TurnDetail, TurnRun } from "../../../src/ui/api";
import { buildAnswer, buildControl } from "./mock-build";
import { CHATS, CONTINUED, earlierTurn, EARLIER, RECORDED, RUN, summaryOf, T0, turnOf, worldAt } from "../../../test/ui/recorded";
import { migrationAnswer, migrationControl } from "./mock-migration";
import { playAnswer } from "./mock-play";
import { settingsAnswer } from "./mock-settings";
import { treeAnswer } from "./mock-tree";

/** How long before the run began the request reached RPE, as the recorded turn has it. */
const INTAKE_MS = 240;

interface Playing {
  chat: string;
  run: string;
  /** Where each run of the turn begins in `events`: a continue plays it again. */
  starts: number[];
  /** When the request for the run playing last reached RPE. */
  received: number;
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
/** Every turn played while the preview runs, by its id: one played before stays readable once another plays. */
const played = new Map<string, Playing>();
let runs = 30;

const STANDINGS: Readonly<Record<string, ExtensionStatus>> = {
  well: { registered: true, why: null, missing: [] },
  unregistered: { registered: false, why: "RPE has not heard from its extension in Lumiverse since it started.", missing: null },
  missing: { registered: true, why: null, missing: [{ permission: "interceptor", why: "to tag each reply RPE plays with its chat and its turn" }] },
};
let standing: ExtensionStatus = STANDINGS.well as ExtensionStatus;

function publish(event: LiveEvent): void {
  const text = JSON.stringify({ type: "events", chat: event.chat, events: [event] });
  for (const ws of sockets) if (ws.data.follows.has(event.chat)) ws.send(text);
}

/** Tells a chat's followers that its state changed, as RPE's hub does after a change made from a panel (mock-play.ts). */
function stateChanged(chat: string): void {
  const seq = (seqs.get(chat) ?? 0) + 1;
  seqs.set(chat, seq);
  publish({ chat, seq, kind: "state", key: "state", at: Date.now(), data: {} });
}

/** An event of a recording, as it is played for `chat` now: its chat, its run and its times moved on by `shift`. */
function retarget(event: LiveEvent, play: Playing, shift: number): LiveEvent {
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

/** Plays `recording` for the play from `begins`, in real time. */
function schedule(p: Playing, recording: readonly LiveEvent[], begins: number): void {
  const now = Date.now();
  const first = recording[0]?.at ?? 0;
  for (const event of recording) {
    p.timers.push(
      setTimeout(() => {
        const out = retarget(event, p, begins - first);
        p.events.push(out);
        publish(out);
        if (event === recording.at(-1)) p.done = true;
      }, begins - now + (event.at - first)),
    );
  }
}

function play(chat: string): void {
  const current = playing.get(chat);
  if (current !== undefined && !current.done) return;
  const begins = Date.now() + 1000;
  const p: Playing = { chat, run: `turn-${++runs}`, starts: [0], received: begins - INTAKE_MS, events: [], timers: [], done: false };
  playing.set(chat, p);
  played.set(p.run, p);
  schedule(p, RECORDED, begins);
}

/** Continues the turn played last in `chat`, once it has ended: false when none has. */
function playContinue(chat: string): boolean {
  const p = playing.get(chat);
  if (p === undefined || !p.done) return false;
  const begins = Date.now() + 1000;
  p.starts.push(p.events.length);
  p.received = begins - INTAKE_MS;
  p.done = false;
  schedule(p, CONTINUED, begins);
  return true;
}

/** The turn played in a chat as RPE's route answers it: what its latest run says, the records of all its runs from `from`, each run by its own id, and what all its runs spent. */
function playedTurn(p: Playing, from = 1): TurnDetail {
  const runs = p.starts.map((start, i) => {
    const [run] = turnOf(p.events.slice(start, p.starts[i + 1]), { run: p.run, chat: p.chat, received: p.received, from }).runs;
    return { ...(run as TurnRun), id: `${p.run}.${i + 1}`, nth: i + 1, kind: i === 0 ? ("new" as const) : ("continue" as const) };
  });
  const latest = turnOf(p.events.slice(p.starts.at(-1) ?? 0), { run: p.run, chat: p.chat, received: p.received });
  const records = p.events.filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);
  const usage = runs.map((r) => r.usage).reduce((a, b) => ({ calls: a.calls + b.calls, input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output }));
  return { ...latest, kind: p.starts.length > 1 ? "continue" : latest.kind, usage, trace: records.filter((r) => r.seq >= from), runs };
}

/** An invented turn folder, as RPE writes one (plan §5.3): the file's path below the folder, and its text. */
function folderOf(detail: TurnDetail): Map<string, string> {
  const files = new Map<string, string>(Object.entries(FOLDER));
  for (const run of detail.runs) {
    for (const request of run.requests) {
      const asked = request.definition === "author" ? "Ash asks Moira why the lamp went dark last night." : `The Author asks the ${request.definition} for its part in the lamp room.`;
      files.set(request.file, JSON.stringify({ messages: [{ role: "system", text: `You are the ${request.definition} of a story set on a lighthouse at Calder Point.` }, { role: "user", text: asked }] }));
    }
  }
  return files;
}

const FOLDER: Readonly<Record<string, string>> = {
  "briefing.md": "## Turn facts\nA new reply. The player's character, Ash, speaks to Moira in the lamp room.\n\n## Lore map\n- [e-12] Calder Point lighthouse: place; defines the tower and its lamp.\n- [e-31] Moira Vell: character; defines her years as keeper.\n- [e-40] The wreck of the Saltmarsh: event; defines the night the lamp went dark.\n",
  "world-state.md": "## The horizon: the lamp room, Calder Point lighthouse\nDate and time: 12 Nov, late evening (from the region).\nWeather: north wind and sleet (from the coast).\n\nMap, 5 by 3 squares:\n. . L . .\n. A . M .\n. . s . .\nA: Ash, by the stairs. M: Moira, at the logbook. L: the lamp, dark. s: the stair head.\n\n## The chain above\n- Calder Point: a headland, the village below it.\n",
  "active-wi-content.md": "## Lore map\n- [e-12] Calder Point lighthouse\n- [e-31] Moira Vell\n- [e-40] The wreck of the Saltmarsh\n\n## [e-12] Calder Point lighthouse\nA white tower on the headland; its lamp has burned every night for forty years.\n",
  "turn.json": `${JSON.stringify({ kind: "new", lore: ["wbe-0071", "wbe-0102"], loreMap: ["e-12", "e-31", "e-40"] }, null, 2)}\n`,
};

/** A turn's folder as the files route lists it: each file, and each folder with what its files hold. */
function folderList(files: Map<string, string>): { name: string; bytes: number; folder: boolean }[] {
  const entries = [...files].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text).length, folder: false }));
  const folders = [...new Set(entries.flatMap((e) => (e.name.includes("/") ? [e.name.slice(0, e.name.lastIndexOf("/"))] : [])))];
  return [...folders.map((name) => ({ name, bytes: entries.filter((e) => e.name.startsWith(`${name}/`)).reduce((n, e) => n + e.bytes, 0), folder: true })), ...entries].sort((a, b) => a.name.localeCompare(b.name));
}

/** Stops the turn playing for `chat`: what is left is not played, and the run ends stopped. */
function stop(chat: string, run: string): boolean {
  const p = playing.get(chat);
  if (p === undefined || p.done || p.run !== run) return false;
  for (const timer of p.timers) clearTimeout(timer);
  p.done = true;
  const records = p.events.slice(p.starts.at(-1) ?? 0).filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);
  const last = records.at(-1);
  const record: TraceRecord = { seq: (last?.seq ?? 0) + 1, run: p.run, scope: { user: "user-1", chat, session: "session-4", turn: p.run }, at: Date.now(), agent: { id: "a1", definition: "author" }, event: { kind: "run_ended", outcome: { status: "stopped", released: false, usage: playedTurn(p).usage, error: { code: "stopped" } } } };
  const seq = (seqs.get(chat) ?? 0) + 1;
  seqs.set(chat, seq);
  const event: LiveEvent = { chat, seq, kind: "trace", at: record.at, data: record as unknown as JsonValue };
  p.events.push(event);
  publish(event);
  return true;
}

function detailOf(chat: string, turn: string, from: number): TurnDetail | null {
  const p = playing.get(chat);
  const was = played.get(turn);
  if (was !== undefined && was.chat === chat) return playedTurn(was, from);
  if (p === undefined && turn === RUN) return turnOf(RECORDED, { run: RUN, chat, received: T0 - INTAKE_MS, from });
  return earlierTurn(turn, chat);
}

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The preview's controls: how RPE says its extension stands, and a continue of a chat's last turn. */
export function previewControl(url: URL): Response {
  if (url.pathname === "/preview/extension") {
    const next = STANDINGS[url.searchParams.get("state") ?? ""];
    if (next === undefined) return answer(400, { error: `state is one of ${Object.keys(STANDINGS).join(", ")}.` });
    standing = next;
    return answer(200, standing);
  }
  if (url.pathname === "/preview/continue") {
    const chat = url.searchParams.get("chat") ?? "";
    return playContinue(chat) ? answer(200, { continued: playing.get(chat)?.run }) : answer(409, { error: `No turn of ${chat} has ended to continue.` });
  }
  if (url.pathname === "/preview/build") return buildControl(url);
  if (url.pathname === "/preview/migration") return migrationControl(url);
  return answer(404, { error: `The preview has no ${url.pathname}.` });
}

const PROVIDERS: ProviderOffer[] = [
  { id: "deepseek", name: "DeepSeek", auth: ["key"], apis: [], needsBaseUrl: false },
  { id: "openai-compatible", name: "A compatible server", auth: ["key", "none"], apis: ["openai-completions"], needsBaseUrl: true },
];
let connections: ConnectionView[] = [{ id: "c-flash", name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", default: true, key: { set: true, last4: null } }];
let madeConnections = 1;

/** What pi's catalog says of the preview's one known model: invented figures. */
const PI_LIMITS: Readonly<Record<string, { contextWindow: number; maxTokens: number }>> = { "deepseek-v4-flash": { contextWindow: 128_000, maxTokens: 8_192 } };

/** A connection as the routes show it: nothing of its key, and its model's limits in force, the user's own over pi's. */
function shown(c: ConnectionView): ConnectionShown {
  const { key, ...rest } = c;
  const own = c.model === undefined ? undefined : c.limits?.[c.model];
  const pi = c.model === undefined ? undefined : PI_LIMITS[c.model];
  const limit = (mine: number | undefined, theirs: number | undefined): ModelLimit | null => (mine !== undefined ? { tokens: mine, from: "user" } : theirs !== undefined ? { tokens: theirs, from: "pi" } : null);
  return { ...rest, key: key === null ? null : { set: key.set }, limitsInForce: c.model === undefined ? null : { contextWindow: limit(own?.contextWindow, pi?.contextWindow), maxTokens: limit(own?.maxTokens, pi?.maxTokens) } };
}

/** The connection routes, over the list in memory: what the pages send, answered in the shapes the routes answer in. A test answers at once: as the model when a key is set, else as a provider that refuses. */
async function connectionsAnswer(request: Request, path: string): Promise<Response> {
  if (path === "/api/v1/connections" && request.method === "GET") return answer(200, { connections: connections.map(shown), default: connections.find((c) => c.default)?.id ?? null, providers: PROVIDERS });
  const at = /^\/api\/v1\/connections(?:\/([^/]+))?(\/default|\/test)?$/.exec(path);
  const id = at?.[1] === undefined ? null : decodeURIComponent(at[1]);
  const was = connections.find((c) => c.id === id);
  if (at === null || (id !== null && was === undefined)) return answer(404, { error: `RPE has no ${request.method} ${path}.` });
  if (at[2] === "/test" && was !== undefined && request.method === "POST") {
    const limits = shown(was).limitsInForce;
    return answer(200, was.auth === "key" && was.key?.set !== true ? { ok: false, ms: 96, error: "401: no key was given for this connection.", limits } : { ok: true, ms: 640, model: was.model ?? "the provider's own", limits });
  }
  if (at[2] === "/default" && request.method === "PUT") {
    connections = connections.map((c) => ({ ...c, default: c.id === id }));
    return new Response(null, { status: 204 });
  }
  if (id !== null && request.method === "DELETE") {
    connections = connections.filter((c) => c.id !== id);
    return new Response(null, { status: 204 });
  }
  if ((id === null && request.method === "POST") || (id !== null && request.method === "PUT")) {
    const body = (await request.json().catch(() => null)) as SaveConnection | null;
    const input = body?.connection;
    if (body === null || input === undefined || typeof input.name !== "string" || input.name.trim() === "") return answer(400, { error: "A connection needs a name." });
    const keySet = body.key === undefined ? (was?.key?.set ?? false) : body.key !== null;
    const view: ConnectionView = {
      id: id ?? `c-${++madeConnections}`,
      name: input.name,
      provider: input.provider,
      auth: input.auth,
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.api ? { api: input.api } : {}),
      ...(input.limits ? { limits: input.limits } : {}),
      default: was?.default ?? connections.length === 0,
      key: input.auth === "key" ? { set: keySet, last4: null } : null,
      ...(input.auth === "signin" ? { signedIn: false } : {}),
    };
    connections = was === undefined ? [...connections, view] : connections.map((c) => (c.id === id ? view : c));
    return answer(200, shown(view));
  }
  return answer(405, { error: `RPE has no ${request.method} ${path}.` });
}

/** The stand-in's answer to a request under `/api/v1/`, or undefined when it became the live socket. */
export function rpeAnswer(request: Request, server: Server<PreviewSocket>): Response | undefined | Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/v1/status") return answer(200, { name: "rpe", version: "preview", started: T0, belongsToUser: true });
  if (path === "/api/v1/live") {
    if (server.upgrade(request, { data: { follows: new Set<string>() }, headers: { "Sec-WebSocket-Protocol": "rpe.live" } })) return undefined;
    return answer(426, { error: "This is the live socket: open it as a WebSocket." });
  }
  const credential = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
  if (!credential) return answer(401, { error: "This needs a page token or the web UI's token." });
  if (path === "/api/v1/status/extension") return answer(200, standing);
  if (path.startsWith("/api/v1/connections")) return connectionsAnswer(request, path);
  if (path.startsWith("/api/v1/files") || path.startsWith("/api/v1/suggestions") || path.startsWith("/api/v1/storage")) return treeAnswer(request, url).then((got) => got ?? answer(404, { error: `RPE has no ${request.method} ${path}.` }));
  if (path === "/api/v1/settings") return settingsAnswer(request, url);
  if (path === "/api/v1/migration") return migrationAnswer(request);
  if (path === "/api/v1/build") return buildAnswer(request);
  if (path === "/api/v1/chats") return answer(200, { chats: CHATS.chats.map((c) => ({ ...c, running: playing.get(c.id)?.done === false })) });
  const play = /^\/api\/v1\/chats\/([^/]+)\/(state|actions|actions\/undo)$/.exec(path);
  if (play !== null) {
    const chat = decodeURIComponent(play[1] as string);
    return playAnswer(request, chat, play[2] as string, () => stateChanged(chat));
  }
  const turns = /^\/api\/v1\/chats\/([^/]+)\/turns$/.exec(path);
  if (turns !== null && request.method === "GET") {
    const chat = decodeURIComponent(turns[1] as string);
    const p = playing.get(chat);
    const latest = p === undefined ? turnOf(RECORDED, { run: RUN, chat, received: T0 - INTAKE_MS }) : playedTurn(p);
    const all = [...(p === undefined || p.events.length > 0 ? [summaryOf(latest)] : []), ...EARLIER];
    const limit = Number(url.searchParams.get("limit") ?? all.length);
    return answer(200, { turns: all.slice(0, limit), more: limit < all.length });
  }
  const world = /^\/api\/v1\/chats\/([^/]+)\/world$/.exec(path);
  if (world !== null && request.method === "GET") {
    const chat = decodeURIComponent(world[1] as string);
    const at = url.searchParams.get("at") ?? "world";
    const values = url.searchParams.get("values") ?? "own";
    if (values !== "none" && values !== "own" && values !== "all") return answer(400, { error: "values is one of none, own, all." });
    const found = worldAt(at, Number(url.searchParams.get("depth") ?? 1), values);
    return found === null ? answer(404, { error: `Nothing in the world of chat ${chat} is called ${at}.` }) : answer(200, found);
  }
  const files = /^\/api\/v1\/chats\/([^/]+)\/turns\/([^/]+)\/files(?:\/(.+))?$/.exec(path);
  if (files !== null && request.method === "GET") {
    const chat = decodeURIComponent(files[1] as string);
    const turn = decodeURIComponent(files[2] as string);
    const detail = detailOf(chat, turn, 1);
    if (detail === null) return answer(404, { error: `Chat ${chat} has no turn ${turn}.` });
    const folder = folderOf(detail);
    if (files[3] === undefined) return answer(200, { files: folderList(folder) });
    const name = files[3].split("/").map(decodeURIComponent).join("/");
    const text = folder.get(name);
    return text === undefined ? answer(404, { error: `Turn ${turn}'s folder has no file ${name}.` }) : answer(200, { name, text });
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
