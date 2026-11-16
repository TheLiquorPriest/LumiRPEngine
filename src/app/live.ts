// The live hub (plan §4.4): pages follow a chat's live events and state pushes over one socket,
// `/api/v1/live`. Whatever runs a chat publishes to it by chat; a chat's events are numbered from 1,
// and every reader gets them in that order. Publishing never waits. A reader that keeps up gets each
// event as it is published; one that falls behind gets what it missed in one batch when it is ready
// again, with state pushes coalesced (a push with a key replaces an older one with the same key that
// the reader has not taken yet), and, past a limit, the oldest of the other events dropped and named,
// so the page can read again what it needs. A slow reader never holds up a turn.
//
// Each kind the socket carries is declared once, with what its data is and the key it is coalesced by: the
// app's below (`LIVE_KINDS`), and an area's own in its area file (`liveKind`, `Area.liveKinds`); a kind
// declared twice stops the app at composition. The hub takes no other kind, and the pages' types and the API
// reference are written from the same declarations (`bun run api`).
//
// A page follows chats, and besides them three names no chat id has (no chat id begins with `~`): the user's
// jobs in every chat and in none (`LIVE_JOBS`), what concerns the user and no one chat (`LIVE_USER`: the
// extension's status), and an address an area gave a caller (`LIVE_ADDRESS_PREFIX` and the address: an
// outside client's check-in), which a socket follows only when the area that gave it says its caller holds it.
// Each counts toward `liveSocket.follows`; an event published to one reaches the sockets that follow it alone.
//
// The socket itself is declared once too (`liveSocketDeclaration`): where it is, the protocol a page offers,
// how a page that cannot set a header gives its token (as a second protocol, `rpe.token.<token>`), what a
// page sends (follow or unfollow), what it is sent (that following began, events with what was missed, or a
// refusal), and the code and reason RPE closes it with once the token it opened with has run out or been
// replaced. The server reads what a page sends by that declaration, and the generated types and the
// reference are written from it. A socket keeps what auth answered for it, its credential's hash and end,
// never the credential's text; RPE keeps at most `liveSocket.sockets` open, and a chat id longer than
// `liveSocket.chatIdChars` is refused.

import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";
import { type AnyShape, type CallAuth, type Exactly, type Holds, type Infer, problemsOf, rawRoute, shape } from "./routes";

export const LIVE_PATH = "/api/v1/live";
export const LIVE_PROTOCOL = "rpe.live";
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";
/** The close code a page is given when the credential its socket opened with no longer holds (a code of an application's own: 4000-4999). */
export const LIVE_TOKEN_ENDED = 4401;
const TOKEN_ENDED_WORDS = "The page's token has run out or was replaced: open the live socket again with a new one.";

// ---------------------------------------------------------------- the kinds the socket carries

// RPH's trace, as the turn lane hands it on whole: its record of every event of a run, and the text of
// a model call as it streams. Declared here field by field so that the pages' types and the reference say
// what a page is sent; each is held to RPH's own type below, so a change to it in RPH stops this
// compiling until the declaration says the same.
const T = shape.text();
const N = shape.number();
const opt = shape.optional;
export const scope = shape.named("Scope", "Where work is: the user, the chat, the session, and the turn where it belongs to one.", shape.object({ user: T, chat: T, session: T, turn: opt(T) }));
const userSessionScope = shape.named(
  "UserSessionScope",
  "Where a job the owner started for no chat runs: the user and the job's own session, at the user's level; no chat and no turn.",
  shape.object({ user: T, session: T, chat: opt(shape.nothing()), turn: opt(shape.nothing()) }),
);
export const runScope = shape.named("RunScope", "Where a run's work happens: a chat's, or that of a job of no chat.", shape.union(scope, userSessionScope));
export const agentRef = shape.named("AgentRef", "One agent of a run: its handle, its definition, the agent that started it, its job, and the character it plays.", shape.object({ id: T, definition: T, parent: opt(T), job: opt(T), plays: opt(T) }));
export const usage = shape.named("Usage", "Model calls and their tokens: sent (cached ones included), read from and written to the cache, written, and of those the reasoning.", shape.object({ calls: N, input: N, cacheRead: N, cacheWrite: N, output: N, reasoning: opt(N) }));
export const effort = shape.named("Effort", "How hard a model reasons on a call.", shape.oneOf("off", "minimal", "low", "medium", "high", "xhigh", "max"));
const sampling = shape.named("Sampling", "Sampling by its usual names, as a preset sets it; each one absent is the connection's own.", shape.object({ temperature: opt(N), top_p: opt(N), top_k: opt(N), min_p: opt(N), frequency_penalty: opt(N), presence_penalty: opt(N), repetition_penalty: opt(N), seed: opt(N), stop: opt(shape.list(T)) }));
const toolCall = shape.named("ToolCallView", "A tool call a model made: the model's id for it, the tool, its arguments, and when the model began writing it, where the provider gave it in pieces.", shape.object({ id: T, name: T, args: shape.json(), began: opt(N) }));
const toolContent = shape.union(shape.object({ type: shape.literal("text"), text: T }), shape.object({ type: shape.literal("image"), data: T, mimeType: T }));
const toolResult = shape.named("ToolResult", "A tool's answer: what the model is shown, whether it failed, what it reports beyond it, its marks, and data for the live view.", shape.object({ content: shape.list(toolContent), error: opt(shape.literal(true)), reports: opt(shape.list(T)), marks: opt(shape.list(T)), details: opt(shape.json()) }));
export const layerLevel = shape.named("LayerLevel", "A level of the agents' tree: what ships, the user's own, a character's, a chat's.", shape.oneOf("shipped", "global", "character", "chat"));
const factValue = shape.object({ count: N, names: opt(shape.list(T)), by: opt(shape.record(N)), namesBy: opt(shape.record(shape.list(T))), fields: opt(shape.record(shape.json())) });
const ruleThen = shape.union(shape.object({ did: shape.literal("called"), tools: shape.list(T) }), shape.object({ did: shape.literal("wrote") }), shape.object({ did: shape.literal("released") }), shape.object({ did: shape.literal("ended") }));
export const ruleFiring = shape.named(
  "RuleFiring",
  "A rule that fired: which, from where, at what moment, on what, what it did, and what the agent did next.",
  shape.object({
    rule: T,
    path: T,
    level: layerLevel,
    moment: shape.oneOf("stream", "tool-call", "tool-result", "after-message", "run-end", "turn-start", "before-compaction", "interval"),
    watched: opt(shape.oneOf("text", "thinking", "reply", "arguments", "result")),
    agent: agentRef,
    callId: opt(T),
    tool: opt(T),
    matched: opt(T),
    fact: opt(shape.object({ name: T, value: factValue })),
    reminded: opt(shape.literal("connection")),
    action: shape.oneOf("cut", "remind", "hold", "follow-up", "briefing", "call"),
    dropped: opt(T),
    then: opt(ruleThen),
  }),
);
export const presetRef = shape.object({ id: T, name: opt(T), revision: opt(T) });
export const promptNotice = shape.named(
  "PromptNotice",
  "What changed in the prompt's shape since the turn before, or that it is not mapped or could not be told apart.",
  shape.union(
    shape.object({ kind: shape.literal("changed"), marker: T }),
    shape.object({ kind: shape.literal("gone"), marker: T }),
    shape.object({ kind: shape.literal("unclaimed"), message: N, start: N, end: N }),
    shape.object({ kind: shape.literal("order"), markers: shape.list(T) }),
    shape.object({ kind: shape.literal("preset"), was: shape.nullable(presetRef), now: shape.nullable(presetRef) }),
    shape.object({ kind: shape.literal("unmapped") }),
    shape.object({ kind: shape.literal("incomplete") }),
  ),
);
export const limitHit = shape.named(
  "LimitHit",
  "A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs or its throttle.",
  shape.object({
    limit: shape.oneOf("calls", "tokensIn", "tokensOut", "tokens", "time", "depth", "agents", "jobs", "callTokensIn", "callTokensOut", "callTime", "toolRounds", "repeats", "tokensPerMinute"),
    per: shape.oneOf("turn", "agent", "job", "day", "connection"),
    max: N,
    value: N,
    agent: opt(agentRef),
    connection: opt(T),
  }),
);
const release = shape.named(
  "Release",
  "The reply's release: whose text, in which form, the file for a file released, and its length.",
  shape.object({ by: agentRef, form: shape.oneOf("tags", "message", "narrator", "narrator-live", "file"), path: opt(T), length: N }),
);
const approvalAnswer = shape.union(shape.object({ go: shape.literal(true) }), shape.object({ go: shape.literal(false), reason: opt(T) }));
const callPermission = shape.named(
  "CallPermission",
  "The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call.",
  shape.object({ lane: T, setting: shape.oneOf("auto", "confirm", "never"), answer: opt(approvalAnswer) }),
);
const callRefusal = shape.named(
  "CallRefusal",
  "Why a tool call never ran: a limit spent before it started, past the most tool calls one answer of its agent may make, the thing it calls out to not switched on for the user, its lane set to Never, the user's no with his reason, a rule that held it, a permission or rule that could not be asked, or a hook of his that blocked it with its reason.",
  shape.union(
    shape.object({ by: shape.literal("limit"), hit: limitHit }),
    shape.object({ by: shape.literal("answer"), max: N }),
    shape.object({ by: shape.literal("switch"), thing: shape.object({ kind: shape.oneOf("hook", "rule-command", "command-tool", "mcp-server", "http-tool", "connection"), name: T, target: T }), state: shape.oneOf("on", "waiting", "off") }),
    shape.object({ by: shape.literal("never"), lane: T }),
    shape.object({ by: shape.literal("declined"), lane: T, reason: opt(T) }),
    shape.object({ by: shape.literal("hold"), rule: T }),
    shape.object({ by: shape.literal("unasked"), error: T }),
    shape.object({ by: shape.literal("hook"), hook: T, reason: T }),
  ),
);
const jobLimits = shape.named(
  "JobLimits",
  "Limits of one job's own run, each holding only where it is tighter than the setting's: model calls, tokens sent, tokens written, tokens together as the day's job tokens are counted, seconds, and the tokens at which the job is held and the owner asked whether to go on.",
  shape.object({ calls: opt(N), tokensIn: opt(N), tokensOut: opt(N), tokens: opt(N), time: opt(N), askAt: opt(N) }),
);
export const jobView = shape.named(
  "JobView",
  "A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, the limit it ended at, what its start named and gave, what it was not given, what it wrote, the job it repeats, where it asks, and what the owner gave it beyond its limits.",
  shape.object({
    id: T,
    agent: T,
    brief: T,
    state: shape.named("JobState", "Where a job stands.", shape.oneOf("queued", "held", "running", "asking", "done", "failed", "cancelled", "off-path", "interrupted")),
    scope: runScope,
    startedBy: shape.union(agentRef, shape.literal("user")),
    started: N,
    ended: opt(N),
    usage,
    report: opt(T),
    limit: opt(limitHit),
    attach: opt(shape.list(T), "The attachments its start named, by name."),
    limits: opt(jobLimits, "The limits of its own its start gave."),
    missing: opt(shape.list(T), "The names in attach nobody could find."),
    wrote: opt(shape.list(shape.named("JobWrite", "A write a job made: the tool, the lane it writes to where it names one, and the first line of the tool's own answer.", shape.object({ tool: T, lane: opt(T), line: T }))), "Each write it made, its sub-agents' included, in order."),
    repeats: opt(T, "For a job the owner started again: the job it repeats."),
    asks: opt(shape.object({ at: N, tokens: N }), "For a job that asks: the ask point it reached, and the tokens it had spent when it did."),
    more: opt(jobLimits, "What the owner gave it beyond its limits by carrying it on, added up over every time he did."),
  }),
);
export const replyError = shape.object({
  code: shape.oneOf("no-reply", "limit", "provider", "stopped", "failed", "no-definition", "no-tags", "hook"),
  hook: opt(T, "For hook: the turn-start hook that blocked the turn; detail is its reason."),
  limit: opt(limitHit),
  detail: opt(T),
  agent: opt(T, "For no-definition and no-tags: the agent definition the turn named as its lead."),
  text: opt(T),
});
const runOutcome = shape.named(
  "RunOutcome",
  "How a run ended, whether a reply was released, the limit or the failure, and what every agent of it spent.",
  shape.object({ status: shape.oneOf("released", "no-reply", "stopped", "limit", "failed"), released: shape.yesNo(), limit: opt(limitHit), error: opt(replyError), usage }),
);
const traceEvent = shape.named(
  "TraceEvent",
  "What RPH did; each kind's fields are the facts of it.",
  shape.union(
    shape.object({ kind: shape.literal("run_started"), run: shape.oneOf("turn", "job", "talk"), turn: opt(shape.named("TurnKind", "What a generation asks for.", shape.oneOf("new", "swipe", "regenerate", "continue", "impersonate"))), lead: T }),
    shape.object({ kind: shape.literal("agent_started"), definition: T, connection: T, model: T, effort: opt(effort), session: T, given: shape.list(T), tools: opt(shape.object({ tokens: N, most: N })), judges: opt(shape.object({ rule: T, agent: T })) }),
    shape.object({ kind: shape.literal("tool_unheld"), tool: T, definition: T, reason: shape.oneOf("unregistered", "shadowed", "withdrawn") }),
    shape.object({ kind: shape.literal("intent_began") }),
    shape.object({ kind: shape.literal("intent"), text: T }),
    shape.object({ kind: shape.literal("call_started"), call: N, connection: T, model: T, sampling: opt(sampling), maxTokens: opt(N), messages: N, tools: N, request: opt(T), toolTokens: opt(N), openingTokens: opt(N) }),
    shape.object({ kind: shape.literal("call_ended"), call: N, model: T, text: T, thinking: opt(T), toolCalls: shape.list(toolCall), stop: T, usage, ms: N, error: opt(T) }),
    shape.object({ kind: shape.literal("connection_wait"), connection: T, for: shape.oneOf("minute", "place"), ms: opt(N) }),
    shape.object({ kind: shape.literal("waiting"), for: shape.oneOf("tool", "agent"), callId: T, tool: T, ms: opt(N) }),
    shape.object({ kind: shape.literal("connection_stand_in"), named: T, used: T }),
    shape.object({ kind: shape.literal("tool_started"), callId: T, tool: T, args: shape.json(), closing: shape.yesNo(), via: opt(shape.literal("tool_use")) }),
    shape.object({ kind: shape.literal("tool_update"), callId: T, tool: T, partial: toolResult }),
    shape.object({ kind: shape.literal("tool_ended"), callId: T, tool: T, result: toolResult, clean: shape.yesNo(), endedRun: shape.yesNo(), ms: N, permission: opt(callPermission), refused: opt(callRefusal) }),
    shape.object({ kind: shape.literal("rule_fired"), firing: ruleFiring }),
    shape.object({ kind: shape.literal("rule_failed"), rule: T, path: T, why: shape.literal("time"), length: N }),
    shape.object({ kind: shape.literal("rule_failed"), rule: T, path: T, why: shape.literal("command"), detail: T }),
    shape.object({ kind: shape.literal("rule_failed"), rule: T, path: T, why: shape.literal("judge"), detail: T }),
    shape.object({
      kind: shape.literal("hook"),
      hook: T,
      on: shape.oneOf("turn-start", "before-tool", "after-tool", "before-release", "after-release", "run-end", "session-close", "before-compaction", "job-start", "job-end"),
      outcome: shape.oneOf("ok", "added", "changed", "blocked", "failed", "timed-out"),
      ms: N,
      callId: opt(T),
      text: opt(T),
    }),
    shape.object({ kind: shape.literal("approval_asked"), callId: T, tool: T, lane: T }),
    shape.object({ kind: shape.literal("approval_answered"), callId: T, tool: T, lane: T, answer: approvalAnswer }),
    shape.object({ kind: shape.literal("prompt_notices"), notices: shape.list(promptNotice), pictures: opt(shape.list(shape.object({ message: N, count: N }))) }),
    shape.object({ kind: shape.literal("todo"), items: shape.list(shape.object({ text: T, done: shape.yesNo() })) }),
    shape.object({ kind: shape.literal("limit"), hit: limitHit }),
    shape.object({ kind: shape.literal("paused"), call: N }),
    shape.object({ kind: shape.literal("resumed"), call: N, ms: N }),
    shape.object({ kind: shape.literal("said"), call: N, text: T }),
    shape.object({ kind: shape.literal("released"), release }),
    shape.object({ kind: shape.literal("progress_missing"), time: N }),
    shape.object({
      kind: shape.literal("compacted"),
      session: T,
      reason: shape.oneOf("would-not-fit", "refused", "asked", "fold"),
      of: shape.oneOf("turns", "run"),
      before: N,
      after: N,
      keptTurns: opt(N),
    }),
    shape.object({
      kind: shape.literal("session"),
      session: T,
      change: shape.oneOf("opened", "closed", "forked", "reopened", "unreadable"),
      from: opt(T),
      turn: opt(T),
      by: opt(shape.literal("user")),
      reason: opt(T),
    }),
    shape.object({ kind: shape.literal("job"), job: jobView }),
    shape.object({ kind: shape.literal("agent_ended"), status: shape.oneOf("done", "asked", "limit", "stopped", "failed"), limit: opt(limitHit), usage }),
    shape.object({ kind: shape.literal("run_ended"), outcome: runOutcome }),
  ),
);
export const traceRecord = shape.named(
  "TraceRecord",
  "An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it. No agent for a record of the host's word outside any agent's work (a session opened, closed, forked or opened again by a call of the sessions API).",
  shape.object({ seq: N, run: T, scope: runScope, at: N, agent: opt(agentRef), parent: opt(shape.object({ agent: T, run: T, call: T })), event: traceEvent }),
);
const traceDelta = shape.named("TraceDelta", "Text of a model call as it streams: what arrived since the last piece, never numbered.", shape.object({ run: T, agent: T, call: N, text: opt(T), thinking: opt(T), at: N }));
type TraceMirrored = Holds<Exactly<Infer<typeof traceRecord>, TraceRecord>>;
type DeltaMirrored = Holds<Exactly<Infer<typeof traceDelta>, TraceDelta>>;

/** A kind the live socket carries: what its data is, what it says, and the key a newer event of it replaces an older one by, for a reader that fell behind. */
export interface LiveKindDeclaration {
  readonly data: AnyShape;
  readonly does: string;
  readonly key?: string;
}

/** Every kind a chat's live socket carries, each declared once. The hub publishes no other. */
export const LIVE_KINDS = {
  trace: { data: traceRecord, does: "A record of RPH's trace, for a run played in the chat: every event of the run, as RPH gave it." },
  delta: { data: traceDelta, does: "A piece of a model call's text as it streams, for the live view; the call's call_ended record holds it whole." },
  reply: {
    data: shape.named(
      "ReplyPiece",
      "What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or one progress line of the chat's thinking block, counted from 0.",
      shape.union(shape.object({ run: T, from: N, text: T }), shape.object({ run: T, line: N, progress: T })),
    ),
    does: "What went to the chat as the reply was written: its text, and the progress lines of its thinking block.",
  },
  released: {
    data: shape.named("ReplyReleased", "A run's reply began to go out to the chat: the run, by RPH's own id for it, and when, epoch ms.", shape.object({ run: T, at: N })),
    does: "A run's reply began to go out to the chat (its first text, or the harness's release, whichever came first), told at that moment while the run may go on.",
  },
  state: { data: shape.object({}), key: "state", does: "The chat's state changed, and a page reads it again." },
  handler_failed: {
    data: shape.object({ op: T, error: T, turn: T, change: shape.nullable(N) }),
    does: "An engine handler failed on a change of this chat, which is recorded as not applied: the operation, the handler's error, the turn and the change (null for one never kept).",
  },
} as const satisfies Readonly<Record<string, LiveKindDeclaration>>;

export type LiveKind = keyof typeof LIVE_KINDS;
/** What an event of a kind carries. */
export type LiveData<K extends LiveKind> = Infer<(typeof LIVE_KINDS)[K]["data"]>;

/** The user's jobs, in every chat and in none: followed and published to by this name, which no chat id has. */
export const LIVE_JOBS = "~jobs";
/** What concerns the user and no one chat or job (the extension's status): followed and published to by this name. */
export const LIVE_USER = "~user";
/** An address an area gave a caller is followed and published to as this, then the address. */
export const LIVE_ADDRESS_PREFIX = "~to:";

/** An area's own live kind, declared in its area file: its name, its declaration, and the typed handle it publishes through. */
export interface AreaLiveKind<D extends AnyShape = AnyShape> {
  readonly name: string;
  readonly declaration: LiveKindDeclaration & { readonly data: D };
  /** Publishes an event of this kind to `to`: a chat, `LIVE_JOBS`, `LIVE_USER`, or `LIVE_ADDRESS_PREFIX` and an address. */
  publish(hub: LiveHub, to: string, data: Infer<D>): LiveEvent;
}

/** Declares an area's own live kind, for its area file's `liveKinds`. */
export function liveKind<const D extends AnyShape>(name: string, declaration: { readonly data: D; readonly does: string; readonly key?: string }): AreaLiveKind<D> {
  return {
    name,
    declaration,
    // A kind's data is declared in shapes, which describe JSON values only.
    publish: (hub, to, data) => hub.publishKind(to, name, data as JsonValue),
  };
}

/** Every kind the hub carries: the app's, and each area's own, each declared once; a kind declared twice stops the app. */
export function gatherLiveKinds(areas: readonly { readonly name: string; readonly liveKinds?: readonly AreaLiveKind[] }[]): Readonly<Record<string, LiveKindDeclaration>> {
  const kinds: Record<string, LiveKindDeclaration> = { ...LIVE_KINDS };
  const by = new Map<string, string>(Object.keys(LIVE_KINDS).map((kind) => [kind, "the app"]));
  for (const area of areas) {
    for (const kind of area.liveKinds ?? []) {
      const before = by.get(kind.name);
      if (before !== undefined) throw new Error(`The live kind "${kind.name}" is declared by ${before} and by the ${area.name} area: a kind is declared once.`);
      by.set(kind.name, `the ${area.name} area`);
      kinds[kind.name] = kind.declaration;
    }
  }
  return kinds;
}

// ---------------------------------------------------------------- the socket's own messages

const missedRange = shape.named(
  "LiveMissed",
  "The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than liveSocket.queueEvents holds for it.",
  shape.object({ from: N, to: N }),
);

/** The live socket as a page meets it. */
export interface LiveSocketDeclaration {
  readonly path: string;
  /** The protocol a page offers to open it. */
  readonly protocol: string;
  /** A page that cannot set a header offers its token as a second protocol: this, then the token. */
  readonly tokenProtocolPrefix: string;
  /** How RPE closes a page's socket once the token it opened with has run out or been replaced. */
  readonly tokenEnded: { readonly code: number; readonly reason: string };
  /** The names a page follows besides chats: the user's jobs, the user's own events, an address's prefix. */
  readonly names: { readonly jobs: string; readonly user: string; readonly addressPrefix: string };
  /** What a page sends. */
  readonly asks: AnyShape;
  /** What a page is sent. */
  readonly answers: AnyShape;
  /** A chat's events in order, as an `events` message carries them and the relay hands them on. */
  readonly batch: AnyShape;
}

/** The live socket, declared once over the kinds it carries: the server reads what a page sends by it, and the generated types and the reference are written from it. */
export function liveSocketDeclaration(kinds: Readonly<Record<string, LiveKindDeclaration>>) {
  /** One event of each kind as the socket sends it: the kind's data, and the key only where its kind is declared with one. */
  const liveEvent = shape.named(
    "LiveEvent",
    `One event as the live socket sends it: of a chat (or of ${LIVE_JOBS}, ${LIVE_USER}, or an address), numbered from 1 for each, of one of the kinds the socket carries, with that kind's data; an event of a kind declared with a key carries it.`,
    shape.union(...Object.entries(kinds).map(([kind, declared]) => shape.object({ chat: T, seq: N, kind: shape.literal(kind), ...(declared.key === undefined ? {} : { key: shape.literal(declared.key) }), at: N, data: declared.data }))),
  );
  return {
    path: LIVE_PATH,
    protocol: LIVE_PROTOCOL,
    tokenProtocolPrefix: TOKEN_PROTOCOL_PREFIX,
    tokenEnded: { code: LIVE_TOKEN_ENDED, reason: TOKEN_ENDED_WORDS },
    names: { jobs: LIVE_JOBS, user: LIVE_USER, addressPrefix: LIVE_ADDRESS_PREFIX },
    asks: shape.named(
      "LiveAsk",
      `What a page sends on the live socket: to follow a chat's events from its next one, or to stop; in \`chat\`, a chat's id, or ${LIVE_JOBS} for the user's jobs, ${LIVE_USER} for his own events, or ${LIVE_ADDRESS_PREFIX} and an address RPE gave the caller.`,
      shape.object({ op: shape.oneOf("follow", "unfollow"), chat: shape.text({ blank: false }) }),
    ),
    answers: shape.named(
      "LiveMessage",
      "What the live socket sends a page: that following a chat (or a name) began, with the number of its last event then; its events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent.",
      shape.union(
        shape.object({ type: shape.literal("following"), chat: T, seq: N }),
        shape.object({ type: shape.literal("events"), chat: T, events: shape.list(liveEvent), missed: opt(missedRange) }),
        shape.object({ type: shape.literal("refused"), message: T }),
      ),
    ),
    batch: shape.named("LiveBatch", "A chat's events in order, and the numbers of those the hub dropped before them for a page that fell behind: an events message without its type, as the relay hands it on.", shape.object({ chat: T, events: shape.list(liveEvent), missed: opt(missedRange) })),
  } as const satisfies LiveSocketDeclaration;
}

/** The live socket over the app's own kinds. */
export const LIVE_SOCKET = liveSocketDeclaration(LIVE_KINDS);

/** What the live socket sends a page, typed by its declaration. */
type LiveMessage = Infer<typeof LIVE_SOCKET.answers>;

export interface LiveEvent {
  chat: string;
  /** Rises by one with each of the chat's events, from 1. */
  seq: number;
  /** What happened: one of the kinds declared above. */
  kind: string;
  /** Present on a kind declared with a key: a newer event with the same key replaces this one for a reader that has not taken it yet. */
  key?: string;
  at: number;
  data: JsonValue;
}

/** An event as an area publishes it: a declared kind, and the data that kind carries. */
export interface LivePublish<K extends LiveKind = LiveKind> {
  kind: K;
  data: LiveData<K>;
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

  /** Whether the reader fell behind: the chat's events are held for it until it is ready again. */
  get behind(): boolean {
    return this.full && !this.stopped;
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
  /** Every kind the hub carries (`gatherLiveKinds`); the app's alone where absent. */
  kinds?: Readonly<Record<string, LiveKindDeclaration>>;
}

/** Whether a caller holds an address an area gave: each area that gives addresses says so of its own. */
export type AddressHolder = (address: string, caller: CallAuth) => boolean;

export class LiveHub {
  private readonly seqs = new Map<string, number>();
  private readonly followers = new Map<string, Set<Following>>();
  private readonly holders: AddressHolder[] = [];
  /** Every kind the hub carries, the app's and the areas' own. */
  readonly kinds: Readonly<Record<string, LiveKindDeclaration>>;
  /** The live socket as a page meets it, over every kind the hub carries. */
  readonly socket: LiveSocketDeclaration;

  constructor(private readonly options: LiveHubOptions) {
    this.kinds = options.kinds ?? LIVE_KINDS;
    this.socket = liveSocketDeclaration(this.kinds);
  }

  /**
   * Publishes an event of a declared kind to everyone following `chat` (or `LIVE_JOBS`, `LIVE_USER`, an address), and returns it
   * with its number. Never waits. A kind the declarations do not hold is refused, so nothing reaches a page that its types and the
   * reference do not describe.
   */
  publish<K extends LiveKind>(chat: string, event: LivePublish<K>): LiveEvent {
    // A kind's data is declared in shapes, which describe JSON values only.
    return this.publishKind(chat, event.kind, event.data as JsonValue);
  }

  /** @internal `publish` for any declared kind: an area's own publishes through its kind's handle (`liveKind`). */
  publishKind(chat: string, kind: string, data: JsonValue): LiveEvent {
    const declared = Object.hasOwn(this.kinds, kind) ? this.kinds[kind] : undefined;
    if (declared === undefined) throw new Error(`The live socket carries no "${kind}" events: the kinds it carries are declared in src/app/live.ts and in the areas' files (${Object.keys(this.kinds).join(", ")}).`);
    const seq = (this.seqs.get(chat) ?? 0) + 1;
    this.seqs.set(chat, seq);
    const out: LiveEvent = { chat, seq, kind, ...(declared.key === undefined ? {} : { key: declared.key }), at: this.options.now(), data };
    const followers = this.followers.get(chat);
    if (followers === undefined) return out;
    const json = JSON.stringify(out);
    for (const following of followers) following.give(out, json);
    return out;
  }

  /** An area that gives callers addresses says here whether a caller holds one, when a socket asks to follow it. */
  addresses(holds: AddressHolder): void {
    this.holders.push(holds);
  }

  /** Whether `caller` holds `address`: an area that gave it says so. */
  holdsAddress(address: string, caller: CallAuth): boolean {
    return this.holders.some((holds) => holds(address, caller));
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

  /** How many of `chat`'s readers fell behind, so that the hub holds its events for them until each is ready again. */
  behind(chat: string): number {
    let count = 0;
    for (const following of this.followers.get(chat) ?? []) if (following.behind) count++;
    return count;
  }
}

/**
 * What a live socket keeps: the chats it follows, what auth answered for it (its credential's hash and end, never the
 * credential's text), the timer that closes it when that runs out, the catch-up it has coming on the event loop's next turn, and
 * whether it is counted among the sockets open.
 */
export interface LiveSocketData {
  follows: Map<string, Following>;
  auth: CallAuth;
  ends: Timer | undefined;
  catchUp: ReturnType<typeof setImmediate> | undefined;
  counted: boolean;
}

/** Fixed: the longest delay a timer takes; a later end is looked at again then. */
const LONGEST_TIMER_MS = 2_147_483_647;
/** The close code a socket past `liveSocket.sockets` is given: try again later (RFC 6455). */
const TOO_MANY_SOCKETS = 1013;

export interface LiveSocketOptions {
  /** The largest message a page may send, in bytes (`liveSocket.messageBytes`). */
  messageBytes: number;
  /** The most chats (and names) one socket may follow at once (`liveSocket.follows`). */
  follows: number;
  /** The most characters of a chat id a socket may follow (`liveSocket.chatIdChars`). */
  chatIdChars: number;
  /** The most sockets open at once (`liveSocket.sockets`). */
  sockets: number;
  /** Seconds a socket may send and be sent nothing (`server.idleSeconds`; 0: no bound): RPE pings it inside them, and a page that answers stays open. */
  idleSeconds: number;
  /** When a credential, by its hash, runs out (null: no end), or false when it holds no longer: retired, run out, or never one. */
  holds(hash: string): number | null | false;
  now(): number;
}

/** Sends a page one of the socket's own messages, as its declaration holds them. */
function sendTo(ws: ServerWebSocket<LiveSocketData>, message: LiveMessage): void {
  ws.send(JSON.stringify(message));
}

function refuse(ws: ServerWebSocket<LiveSocketData>, message: string): void {
  sendTo(ws, { type: "refused", message });
}

/**
 * The server's socket handlers for the live hub. A socket is held to the credential it opened with: once that no longer holds, it is
 * closed, and sent nothing more. Past `liveSocket.sockets` open, a new one is closed at once with the reason.
 */
export function liveSockets(hub: LiveHub, options: LiveSocketOptions): WebSocketHandler<LiveSocketData> {
  let open = 0;
  /** Whether the socket's credential still holds; else the socket is closed. A credential's end does not move, so one timer looks again then. */
  const holding = (ws: ServerWebSocket<LiveSocketData>): boolean => {
    const credential = ws.data.auth.credential;
    const until = credential === null ? false : options.holds(credential.hash);
    if (until === false) {
      clearTimeout(ws.data.ends);
      ws.data.ends = undefined;
      for (const following of ws.data.follows.values()) following.stop();
      ws.data.follows.clear();
      ws.close(LIVE_SOCKET.tokenEnded.code, LIVE_SOCKET.tokenEnded.reason);
      return false;
    }
    if (until !== null && ws.data.ends === undefined) {
      ws.data.ends = setTimeout(() => {
        ws.data.ends = undefined;
        holding(ws);
      }, Math.min(Math.max(until - options.now(), 1), LONGEST_TIMER_MS));
    }
    return true;
  };
  /** Why a socket may not follow `name`, or null when it may: a chat id within its bound, one of the user's own names, or an address its caller holds. */
  const refusalOf = (ws: ServerWebSocket<LiveSocketData>, name: string): string | null => {
    if (name.length > options.chatIdChars) return `A chat id is at most ${options.chatIdChars} characters (the setting liveSocket.chatIdChars), and this one is ${name.length}.`;
    if (!name.startsWith("~") || name === LIVE_JOBS || name === LIVE_USER) return null;
    if (name.startsWith(LIVE_ADDRESS_PREFIX) && hub.holdsAddress(name.slice(LIVE_ADDRESS_PREFIX.length), ws.data.auth)) return null;
    return `${name} is no chat id, and not ${LIVE_JOBS}, ${LIVE_USER} or an address RPE gave this socket's caller.`;
  };
  return {
    maxPayloadLength: options.messageBytes,
    // A page that falls behind is held to its batch by the hub, never cut off.
    closeOnBackpressureLimit: false,
    // Bun pings a socket that has been quiet, inside this bound; a page that answers stays open (0: no bound).
    idleTimeout: options.idleSeconds,
    sendPings: true,
    open(ws) {
      if (open >= options.sockets) {
        ws.close(TOO_MANY_SOCKETS, `RPE has ${open} live sockets open, the most it keeps (the setting liveSocket.sockets): close another page's first.`);
        return;
      }
      open++;
      ws.data.counted = true;
      holding(ws);
    },
    message(ws, message) {
      if (!holding(ws)) return;
      let asked: unknown;
      try {
        asked = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      } catch {
        refuse(ws, "Messages on the live socket are JSON.");
        return;
      }
      if (problemsOf(hub.socket.asks, asked).length > 0) {
        refuse(ws, `Send {"op":"follow","chat":"<chat id>"} or {"op":"unfollow","chat":"<chat id>"}; in place of a chat id, ${LIVE_JOBS} follows your jobs and ${LIVE_USER} your own events.`);
        return;
      }
      // Held to the declaration just above.
      const ask = asked as Infer<typeof LIVE_SOCKET.asks>;
      const chat = ask.chat;
      const follows = ws.data.follows;
      if (ask.op === "unfollow") {
        follows.get(chat)?.stop();
        follows.delete(chat);
        return;
      }
      if (follows.has(chat)) return;
      const refused = refusalOf(ws, chat);
      if (refused !== null) {
        refuse(ws, refused);
        return;
      }
      if (follows.size >= options.follows) {
        refuse(ws, `This socket follows ${follows.size} chats and names, the most one socket may (the setting liveSocket.follows): unfollow one first.`);
        return;
      }
      sendTo(ws, { type: "following", chat, seq: hub.seq(chat) });
      // Bun takes a message it cannot write at once and says so (-1); 0 means the socket is going.
      follows.set(chat, hub.follow(chat, { take: (_batch, text) => holding(ws) && ws.send(text) > 0 }));
    },
    drain(ws) {
      // A page that fell behind is caught up once its socket has sent everything it held, so the hub, not the
      // socket, holds what came meanwhile, to its own bound, with what it dropped named. And never from inside
      // this callback: Bun 1.4.0 does not send what is sent here once that backs up, when the socket's first
      // backlog came from a send outside any socket handler, as every publish of a turn's is; sent on the event
      // loop's next turn, it goes whatever made the backlog.
      if (ws.data.catchUp !== undefined || ws.getBufferedAmount() > 0) return;
      ws.data.catchUp = setImmediate(() => {
        ws.data.catchUp = undefined;
        for (const following of ws.data.follows.values()) following.ready();
      });
    },
    close(ws) {
      if (ws.data.counted) {
        ws.data.counted = false;
        open--;
      }
      clearTimeout(ws.data.ends);
      ws.data.ends = undefined;
      clearImmediate(ws.data.catchUp);
      ws.data.catchUp = undefined;
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
  group: "live",
  does: `The live socket: a page follows chats on it (and ${LIVE_JOBS}, ${LIVE_USER}, or an address RPE gave it), and is sent each one's events in order (the live kinds), held to the token it opened with.`,
  answers: "a WebSocket on the protocol rpe.live; 426 when the request is not a socket's, 400 when it offers protocols and not rpe.live",
  raw(request, { openLiveSocket }) {
    const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
    if (offered.length > 0 && !offered.includes(LIVE_PROTOCOL)) return Response.json({ error: `Offer the protocol ${LIVE_PROTOCOL} to open the live socket.` }, { status: 400 });
    // A page that offered protocols must be answered with one of them, never with its token's.
    const opened = openLiveSocket(offered.length > 0 ? { "Sec-WebSocket-Protocol": LIVE_PROTOCOL } : undefined);
    return opened ? undefined : Response.json({ error: "This is the live socket: open it as a WebSocket." }, { status: 426 });
  },
});
