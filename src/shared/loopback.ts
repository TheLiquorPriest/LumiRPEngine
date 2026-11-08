// The loopback's contract (DEPTH-PLAN §3): what the standalone relay (`lumirpengine loopback`,
// src/cli/loopback*.ts) and LumiRPEngine's bridge say to each other. The relay is an outside client
// of Lumiverse's event socket, as the CLI and the MCP server are (DESIGN §23): it signs in as a
// user, opens the socket as a widget session, says the usual `lre.hello`, then sends the requests
// below as SPINDLE_BACKEND_MSG frames. Each is answered by one `lre.result` or `lre.error` with its
// reqId, as every request is. A call's answer comes back as `lre.loopback.chunk` pushes, sent to
// the session that last spoke for the relay (`sendToFrontend(payload, userId, {frontendSessionId})`).
//
// The relay holds no model key and no story state, and makes no model call. Core's Custom
// connection posts an OpenAI-compatible request to it; the relay names that request a `call`,
// forwards the body, and turns the call's chunks back into SSE (or one JSON answer). LumiRPEngine
// makes every model call on the user's own connections.
//
// Rules both sides keep:
// - Every request but `register` carries the relay's `secret`; LumiRPEngine refuses one without a
//   valid secret (`forbidden`), and takes the frame's session as where that relay's pushes go from
//   then on, so a relay that reconnected is found on its new session.
// - The relay names each call (128 random bits, hex) before it sends `begin` or `passthrough`, so no
//   chunk can arrive for a call it doesn't know. `begin` and `passthrough` are idempotent per call:
//   sent again (after a reconnect), they answer as before and start nothing new.
// - A call's chunks are numbered from 1 with no gap. LumiRPEngine keeps them until they are acked;
//   the relay reorders, drops duplicates, asks `resend` after a gap, and acks the terminal chunk.
// - A call ends with exactly one terminal chunk: `finish` (with the usage and the model calls made)
//   or `error`. Nothing follows it.
// - LumiRPEngine answers every request at once: `begin` and `passthrough` as soon as it has taken the
//   call, before any of its work. The relay counts a request unanswered for `silentMs` as LumiRPEngine
//   gone silent: it stops restating progress lines and, when the silence lasts, ends its calls with an
//   `error` chunk, so a hung worker never leaves a turn to core's 10-minute watchdog.
// - While it answers calls the relay pings every few seconds, naming them; LumiRPEngine answers which
//   it no longer holds (`lost`). A worker restart leaves the relay's socket up (D0a check 4), so this,
//   not a dropped socket, is how a turn whose worker restarted ends at once instead of hanging.
// - A relay registered in `user` mode carries only its own account's turns: LumiRPEngine refuses a
//   key or a turn token of another user (fail closed). `shared` mode, one relay for every user, is
//   the operator's explicit choice in Settings → Loopback (DEPTH-PLAN §3.11, D-8); without it
//   `register` refuses `shared`.

import type { JsonObject } from "./json";
import { isRecord } from "./json";
import type { PROTOCOL_VERSION } from "./protocol";
import type { CallMisread } from "./misread";

/** The level of this contract: `hello` says it both ways, and either side refuses another. */
export const LOOPBACK_API = 1;

/** The model the relay lists and the loopback connection names (DEPTH-PLAN §3.4). */
export const LOOPBACK_MODEL = "lre-narrator";

/** The body parameter the turn tagger sets (DEPTH-PLAN §3.5); the relay takes it out before forwarding. */
export const TURN_PARAM = "lre_turn";

/** How often the relay pings unless `hello` says otherwise. */
export const HEARTBEAT_MS = 60_000;

/** A relay's name: one per (user, name); `up` defaults it to the Lumiverse username. */
export const RELAY_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A relay's systemd unit, by the relay's name (`loopback up --systemd`). */
export function relayUnitName(name: string): string {
  return `lumirpengine-loopback-${name}.service`;
}

/**
 * Where a system service's relay keeps root-owned copies of Bun, the relay and its kit (`loopback up`
 * as root, which runs only from files only root can change): its unit runs those copies as its
 * account, and Settings → Loopback's sign-in line for a system relay runs them as that account too,
 * never a path the relay reports. Its Update line writes what that account read from its own install
 * over the relay and its kit here, so root never runs them: every line given root for a system relay
 * runs only `systemctl`, `install` and `rm`. `loopback` run as root from here refuses, but only a
 * genuine copy does (the refusal is its own code), so that protects nothing against a changed one.
 */
export const SYSTEM_RELAY_DIR = "/var/lib/lumirpengine";

/** Where a system relay's config lives (`loopback up` as root): root's directory, each config 0600 and its unit's account's. */
export const SYSTEM_CONFIG_DIR = "/etc/lumirpengine";

/** The largest request the loopback carries: Lumiverse drops a socket frame over 4 MiB without a word. */
export const LOOPBACK_MAX_BODY_BYTES = 4 * 1024 * 1024 - 64 * 1024;

/** Untagged requests through the shared relay per user per minute (DEPTH-PLAN §3.11, D-8): the relay's own default, and the most LumiRPEngine carries whatever the relay is set to. */
export const SHARED_PASSTHROUGH_PER_MINUTE = 20;

/** A word of a shell line the loopback prints (Settings → Loopback's lines, `up`'s guidance), quoted when it needs to be. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** Who a relay carries turns for (DEPTH-PLAN §3.11): its own account's (the default), or every user's, by the operator's choice. */
export type RelayMode = "user" | "shared";

/**
 * Whether the relay's origin is in its account's local-inference scheduler exclusions (core's
 * `excludedOrigins`, DEPTH-PLAN F28): `excluded`; `missing` (it isn't, and adding it failed);
 * `unavailable` (this Lumiverse has no scheduler setting); `unknown` (not asked yet).
 */
export type SchedulerState = "excluded" | "missing" | "unavailable" | "unknown";

/** The relay's Lumiverse session as it last asked (`GET /api/auth/get-session`, daily). */
export interface RelaySession {
  /** Null: the host couldn't be asked. */
  valid: boolean | null;
  expiresAt: string | null;
  /** When it asked, in ms since the epoch; null before it has. */
  checkedAt: number | null;
}

/** What a relay says of itself on `hello` and every `ping`, for Settings → Loopback. */
export interface RelayReport {
  /** Its name: one relay per (user, name). */
  name: string;
  /** The build of the relay's copy (`up` installs one; LumiRPEngine offers the update line when its own build moves). */
  build: string;
  /**
   * How it runs, for Settings → Loopback's update, restart and `loopback login` lines: the Bun
   * binary (absolute), the relay's own script (its stable copy under a unit), and the systemd unit
   * running it (`scope` system or user), null when none does.
   */
  runtime: { bun: string | null; script: string; unit: { name: string; scope: "system" | "user" } | null };
  /** The machine it runs on. */
  host: string;
  /** Where core reaches it: `http://<listen>:<port>/v1`. */
  listen: string;
  port: number;
  scheduler: SchedulerState;
  session: RelaySession;
  /** Calls it is carrying now. */
  calls: number;
}

/** A call the relay is still answering, with the last chunk it holds in order (0 before any). */
export interface OpenCall {
  call: string;
  seq: number;
}

/** Why the relay gave a call up: `closed`, core closed the request (Stop, DEPTH-PLAN §3.10); `stalled`, nothing came for too long; `lost`, the link stayed down too long; `shutdown`, the relay is stopping. */
export type AbortReason = "closed" | "stalled" | "lost" | "shutdown";

interface Envelope<T extends string> {
  lre: typeof PROTOCOL_VERSION;
  type: T;
  reqId: string;
}

/**
 * `loopback up` registers the relay under its account: LumiRPEngine mints its secret (kept only as
 * a hash), and a later register of the same (user, name) replaces it. `shared` is refused unless
 * the operator chose the shared relay in Settings.
 */
export interface LoopbackRegisterRequest extends Envelope<"lre.loopback.register"> {
  name: string;
  mode: RelayMode;
  build: string;
  host: string;
  listen: string;
  port: number;
}

/** On every socket the relay opens, after `lre.hello`: binds the relay's pushes to this session and resumes its open calls from the chunk after `seq`. */
export interface LoopbackHelloRequest extends Envelope<"lre.loopback.hello"> {
  secret: string;
  api: number;
  report: RelayReport;
  open: OpenCall[];
}

/** `GET /v1/models` (the connection's model list and its Test): whether the key is a user's loopback key, and what to list. */
export interface LoopbackModelsRequest extends Envelope<"lre.loopback.models"> {
  secret: string;
  key: string;
}

/** A tagged request (`lre_turn` in the body): the turn's provider call. `body` is the final body, `lre_turn` taken out; `body.stream` says whether the relay answers in SSE. */
export interface LoopbackBeginRequest extends Envelope<"lre.loopback.begin"> {
  secret: string;
  call: string;
  token: string;
  key: string;
  body: JsonObject;
}

/** An untagged request (DEPTH-PLAN §3.9): run as given on the key's user's narrator upstream, answered in kind (tools and non-stream included). */
export interface LoopbackPassthroughRequest extends Envelope<"lre.loopback.passthrough"> {
  secret: string;
  call: string;
  key: string;
  body: JsonObject;
}

/** The relay gave up a call before its terminal chunk. */
export interface LoopbackAbortRequest extends Envelope<"lre.loopback.abort"> {
  secret: string;
  call: string;
  reason: AbortReason;
}

/** A gap: push the call's chunks again from `from`. */
export interface LoopbackResendRequest extends Envelope<"lre.loopback.resend"> {
  secret: string;
  call: string;
  from: number;
}

/** The relay holds every chunk through `seq`: LumiRPEngine may drop them, and forgets the call once its terminal chunk is acked. */
export interface LoopbackAckRequest extends Envelope<"lre.loopback.ack"> {
  secret: string;
  call: string;
  seq: number;
}

/**
 * The heartbeat: every `heartbeatMs`, and every `probeMs` while the relay answers calls, naming them
 * (`calls`: those whose `begin` or `passthrough` was answered). Settings → Loopback shows a relay
 * silent past the heartbeat, and its session's expiry.
 */
export interface LoopbackPingRequest extends Envelope<"lre.loopback.ping"> {
  secret: string;
  report: RelayReport;
  calls: string[];
}

export type LoopbackRequest = LoopbackRegisterRequest | LoopbackHelloRequest | LoopbackModelsRequest | LoopbackBeginRequest | LoopbackPassthroughRequest | LoopbackAbortRequest | LoopbackResendRequest | LoopbackAckRequest | LoopbackPingRequest;

/** A model the relay lists at `GET /v1/models`. */
export interface LoopbackModel {
  id: string;
}

export interface LoopbackResultBodies {
  /** `user`: the id of the Lumiverse account that registered the relay (in `shared` mode, the operator's); `up` names it by the username it signed in with. */
  "lre.loopback.register": { relay: string; secret: string; mode: RelayMode; model: string; user: string };
  /** `build`: LumiRPEngine's; `lost`: the open calls it no longer holds (it restarted), which the relay ends with an error. */
  "lre.loopback.hello": { relay: string; api: number; build: string; mode: RelayMode; model: string; heartbeatMs: number; lost: string[] };
  "lre.loopback.models": { models: LoopbackModel[] };
  /** `turn`: LumiRPEngine's turn this call belongs to (a tool round's call joins its generation's turn). */
  "lre.loopback.begin": { turn: string };
  "lre.loopback.passthrough": { accepted: true };
  /** False when the call had ended already. */
  "lre.loopback.abort": { aborted: boolean };
  /** The last chunk LumiRPEngine holds for the call (it pushes `from`..`last` again); null when it holds none. */
  "lre.loopback.resend": { last: number | null };
  /** Whether the call is over and forgotten. */
  "lre.loopback.ack": { done: boolean };
  /** `lost`: those of the ping's `calls` LumiRPEngine no longer holds (it restarted): the relay ends them with an error. */
  "lre.loopback.ping": { ok: true; lost: string[] };
}

/** One tool call's fragment, as OpenAI streams them (`delta.tool_calls[]`): `name` and `arguments` are appended per `index`. */
export interface LoopbackToolCall {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

/** One model call a turn made (DEPTH-PLAN §3.8 provenance): behind the loopback the chat's connection is `lre-narrator`, so each answer names the real ones. */
export interface LoopbackModelCall {
  role: string;
  connection: string;
  model: string;
  requestId: string | null;
  promptTokens?: number;
  completionTokens?: number;
  /** How long the call took, in ms. */
  ms?: number;
  /** The room it asked for was over the model's own, as the provider's refusal said: it was made again at that limit. */
  capped?: { asked: number; limit: number };
  /** The fields its stage's parse didn't keep as written, with the answer as the model wrote it (`shared/misread.ts`): on the turn inspector's record only, never in the finish chunk's usage. */
  misread?: CallMisread;
  /** The model's own reasoning for this call, where its provider gave it (the turn inspector's "every call with its reasoning", PLAN:738): on the turn inspector's record only, never in the finish chunk's usage. */
  reasoning?: string;
  /** The chat's messages its request carried, by the numbers the chat shows them by (`#N`): the first, the last and how many; `count` 0 where it carried none. On the turn inspector's record only, never in the finish chunk's usage. */
  history?: { first: number; last: number; count: number };
}

/** The call's usage: the sums over its model calls, and each of them. */
export interface LoopbackUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: LoopbackModelCall[];
}

/**
 * A piece of a call's answer. `reasoning` streams into the reply's native thinking block, and so
 * does `progress`: a line saying what runs now ("The author is setting the scene"), which the relay
 * puts on a line of its own (a model's reasoning often doesn't end with a newline) and restates while
 * nothing else flows and LumiRPEngine still answers, so core's no-token watchdog sees the turn alive
 * (F18). A new source of `reasoning` (the narrator's after the author's) should start a new line.
 * `content` is the reply's text; `tool_calls` the request's tools being called. `finish` and
 * `error` end the call.
 */
export type LoopbackChunk =
  | { kind: "reasoning"; text: string }
  | { kind: "progress"; text: string }
  | { kind: "content"; text: string }
  | { kind: "tool_calls"; calls: LoopbackToolCall[] }
  | { kind: "finish"; finish: string; usage?: LoopbackUsage }
  | { kind: "error"; message: string; code?: string };

/** A chunk of a call, to the relay's session. */
export interface LoopbackChunkPush {
  lre: typeof PROTOCOL_VERSION;
  type: "lre.loopback.chunk";
  call: string;
  seq: number;
  chunk: LoopbackChunk;
}

/** Settings → Loopback's Fix: the relay adds its origin to its account's scheduler exclusions again and reports on its next ping. */
export interface LoopbackFixPush {
  lre: typeof PROTOCOL_VERSION;
  type: "lre.loopback.fix";
  what: "scheduler";
}

export type LoopbackPush = LoopbackChunkPush | LoopbackFixPush;

/** Whether a chunk ends its call. */
export function terminal(chunk: LoopbackChunk): boolean {
  return chunk.kind === "finish" || chunk.kind === "error";
}

const text = (v: unknown): v is string => typeof v === "string";
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function toolCallOf(raw: unknown): LoopbackToolCall | null {
  if (!isRecord(raw) || !count(raw.index)) return null;
  if ((raw.id !== undefined && !text(raw.id)) || (raw.name !== undefined && !text(raw.name)) || (raw.arguments !== undefined && !text(raw.arguments))) return null;
  return { index: raw.index, ...(raw.id !== undefined ? { id: raw.id } : {}), ...(raw.name !== undefined ? { name: raw.name } : {}), ...(raw.arguments !== undefined ? { arguments: raw.arguments } : {}) };
}

function modelCallOf(raw: unknown): LoopbackModelCall | null {
  if (!isRecord(raw) || !text(raw.role) || !text(raw.connection) || !text(raw.model) || !(raw.requestId === null || text(raw.requestId))) return null;
  return { role: raw.role, connection: raw.connection, model: raw.model, requestId: raw.requestId, ...(count(raw.promptTokens) ? { promptTokens: raw.promptTokens } : {}), ...(count(raw.completionTokens) ? { completionTokens: raw.completionTokens } : {}), ...(count(raw.ms) ? { ms: raw.ms } : {}) };
}

function usageOf(raw: unknown): LoopbackUsage | null {
  if (!isRecord(raw) || !count(raw.promptTokens) || !count(raw.completionTokens) || !count(raw.totalTokens) || !Array.isArray(raw.calls)) return null;
  const calls = raw.calls.map(modelCallOf);
  if (calls.some((c) => c === null)) return null;
  return { promptTokens: raw.promptTokens, completionTokens: raw.completionTokens, totalTokens: raw.totalTokens, calls: calls as LoopbackModelCall[] };
}

/** A chunk as it crossed the socket, checked; null when it isn't one. */
export function chunkOf(raw: unknown): LoopbackChunk | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "reasoning":
    case "progress":
    case "content":
      return text(raw.text) ? { kind: raw.kind, text: raw.text } : null;
    case "tool_calls": {
      if (!Array.isArray(raw.calls) || raw.calls.length === 0) return null;
      const calls = raw.calls.map(toolCallOf);
      return calls.some((c) => c === null) ? null : { kind: "tool_calls", calls: calls as LoopbackToolCall[] };
    }
    case "finish": {
      if (!text(raw.finish) || raw.finish === "") return null;
      if (raw.usage === undefined) return { kind: "finish", finish: raw.finish };
      const usage = usageOf(raw.usage);
      return usage === null ? null : { kind: "finish", finish: raw.finish, usage };
    }
    case "error":
      return text(raw.message) && (raw.code === undefined || text(raw.code)) ? { kind: "error", message: raw.message, ...(raw.code !== undefined ? { code: raw.code } : {}) } : null;
    default:
      return null;
  }
}

/** A push as it crossed the socket, checked; null when it isn't a loopback push. */
export function loopbackPushOf(raw: unknown): LoopbackPush | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "lre.loopback.chunk") {
    const chunk = chunkOf(raw.chunk);
    if (chunk === null || !text(raw.call) || !count(raw.seq) || raw.seq < 1) return null;
    return { lre: 1, type: "lre.loopback.chunk", call: raw.call, seq: raw.seq, chunk };
  }
  if (raw.type === "lre.loopback.fix" && raw.what === "scheduler") return { lre: 1, type: "lre.loopback.fix", what: "scheduler" };
  return null;
}

/** Where core reaches a relay (the connection's base URL, DEPTH-PLAN §3.4); `[::1]`-style hosts keep their brackets. */
export function relayBase(listen: string, port: number): string {
  const host = listen.includes(":") && !listen.startsWith("[") ? `[${listen}]` : listen;
  return `http://${host}:${port}/v1`;
}

// ---------------------------------------------------------------- Settings → Loopback

/** How new replies reach a world chat on the loopback (DEPTH-PLAN §3.15): the relay for everything, or message sessions for new replies with the relay for the rest. */
export type LoopbackTransport = "relay" | "sessions";

/** A relay of the user's (or the shared one) as Settings → Loopback shows it. */
export interface LoopbackRelayView {
  relay: string;
  name: string;
  mode: RelayMode;
  build: string;
  host: string;
  listen: string;
  port: number;
  registeredAt: number;
  /** When it last said hello or pinged since LumiRPEngine started; null when it hasn't. */
  seenAt: number | null;
  /** When it last carried a reply request to LumiRPEngine (a world chat's turn or a passthrough) since LumiRPEngine started; null when it hasn't. */
  requestAt: number | null;
  /** What it said of itself last (name, build, runtime, scheduler, session); null before its first hello. */
  report: RelayReport | null;
  /** Silent past twice its heartbeat, or its Lumiverse session is no longer valid: the page shows "sign-in needed" with `login`. */
  signIn: boolean;
  /** Its build differs from LumiRPEngine's: the page shows `update`. */
  update: boolean;
  /** The lines to copy for it: update and restart, and sign in again; null where its runtime isn't known yet. */
  lines: { update: string | null; login: string | null };
}

/** Settings → Loopback (DEPTH-PLAN §3.3, §3.7, §3.11, §3.15). */
export interface LoopbackPage {
  /** LumiRPEngine's build. */
  build: string;
  /** The user's loopback key: whether one is set, its fingerprint and when it was made; never the key. */
  key: { set: boolean; print: string | null; at: number | null };
  /** The key just minted or rotated: shown once, never again. */
  minted?: string;
  /** What Test found, as one line: whether a relay of yours is running, your key is set, a connection is the loopback and the narrator writes on a real model. */
  test?: { ok: boolean; text: string };
  relays: LoopbackRelayView[];
  /**
   * The one line that starts a relay for this server, absolute paths filled in where the server knows
   * them (`bun`, `script`; `url` from the page), run as `account` (`sudo -u`): the account Lumiverse
   * runs as, null where that is root or the server can't say.
   */
  line: { command: string | null; foreground: string | null; bun: string | null; script: string | null; url: string | null; account: string | null };
  transport: LoopbackTransport;
  /** Whether this Lumiverse can carry new replies through message sessions. */
  sessions: boolean;
  /** Whether this Lumiverse stops a world chat's reply the turn tagger couldn't tag (required interceptors). */
  enforced: boolean;
  /** The shared relay (D-8): whether you decide it (the operator) and whether it is allowed. */
  shared: { operator: boolean; enabled: boolean };
  /** The connections of yours LumiRPEngine treats as the loopback. */
  connections: { id: string; name: string }[];
  /** Your chats on depth that generate off the loopback, as each was last opened (L15): the chat and the name of the connection it generates on. */
  offChats: { chatId: string; connection: string }[];
}

/**
 * Why this user can't play a chat on depth now, from what Settings → Loopback shows them (the
 * opt-in's gate, DEPTH-PLAN §3.3, §3.4): no relay of theirs to carry a reply (or the shared one, while
 * the operator allows it), none Running (each needs signing in again or an update), no loopback key,
 * or no connection that is the loopback; in that order, with the fix on that page. Null when one
 * relay is Running and the key and a loopback connection are there. A relay on an older build counts
 * as Running once it has said hello to this LumiRPEngine since it started (`seenAt`) and stays heard
 * from: the hello refuses a relay that speaks another loopback API, so it is compatible, and an
 * update of LumiRPEngine doesn't stop depth until its relay is updated too (its update line stays).
 */
export function loopbackUnready(page: Pick<LoopbackPage, "relays" | "shared" | "key" | "connections">): string | null {
  const relays = page.relays.filter((r) => r.mode !== "shared" || page.shared.enabled);
  if (relays.length === 0) return "No relay carries your replies yet: start one with the line in Settings → Loopback.";
  if (!relays.some((r) => !r.signIn && (!r.update || r.seenAt !== null))) {
    const quiet = relays.filter((r) => r.signIn);
    return quiet.length > 0 ? `No relay of yours is running: ${quiet.map((r) => r.name).join(", ")} has gone quiet or its Lumiverse session ended; sign it in again with its line in Settings → Loopback.` : `No relay of yours is running this build: update ${relays.map((r) => r.name).join(", ")} with its line in Settings → Loopback.`;
  }
  if (!page.key.set) return "You have no loopback key: mint one in Settings → Loopback and set it as the loopback connection's API key.";
  if (page.connections.length === 0) return "None of your connections is the loopback: make one as Settings → Loopback shows.";
  return null;
}
