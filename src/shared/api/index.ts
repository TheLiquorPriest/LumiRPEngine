// RPE's API as its route table declares it: every route's params, query, body and reply, every kind the
// live socket carries, and the live socket's own messages and constants. Written by `bun run api`
// (scripts/api/) from the table the server runs, for every road to RPE: both shells, the command line,
// the MCP server. Do not edit it: a route's declaration is where a type changes, and `bun run api`
// writes this again. The reference for people is docs/api.md, written beside it.

/** Any JSON value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** One agent of a run: its handle, its definition, the agent that started it, its job, and the character it plays. */
export interface AgentRef {
  id: string;
  definition: string;
  parent?: string;
  job?: string;
  plays?: string;
}

/** When RPE started (epoch milliseconds), and the builds that meet at it. */
export interface BuildsReply {
  name: "rpe";
  version: string;
  started: number;
  builds: BuildsStatus;
}

/** The builds that meet at RPE, as its builds route and "Update now" give them. */
export interface BuildsStatus {
  /** The build this process runs. */
  running: string;
  /** The build of the app file on disk; null where there is no file, or it gives none. */
  disk: string | null;
  /** Why the file on disk gave no build: it is not there, does not start, or says something else. */
  broken: string | null;
  /** The extension's build as it said at its last registration; null before it has. */
  extension: string | null;
  /** Every build known is the running one, and the file on disk starts. */
  agree: boolean;
  restart: RestartState;
  /** All of it in a sentence or two, as `rpe status` prints it. */
  words: string;
}

/** The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call. */
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}

/** How a connection signs its calls: with its own key, with the sign-in to its provider, or with nothing. */
export type ConnectionAuth = "key" | "signin" | "none";

/** A connection to save, whole: with the id of one that exists it replaces that one, and a field left out (or null) is cleared; headers left out keep the stored ones. */
export interface ConnectionInput {
  id?: string;
  name: string;
  provider: string;
  auth: ConnectionAuth;
  baseUrl?: string | null;
  api?: string | null;
  model?: string | null;
  effort?: Effort | null;
  /** Exactly these headers, a text setting a value and null keeping the stored one; null takes them all away. */
  headers?: { [key: string]: string | null } | null;
  serialTools?: boolean | null;
  messageThreads?: boolean | null;
  retries?: number | null;
  /** The user's limits for its models, by model id; null clears them. */
  limits?: { [key: string]: ModelLimitsEntry } | null;
}

/** A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them. */
export interface ConnectionShown {
  id: string;
  name: string;
  /** The provider kind the layer offers (anthropic, deepseek, openai-compatible, …). */
  provider: string;
  auth: ConnectionAuth;
  /** Where its calls go instead of the provider's own address. */
  baseUrl?: string;
  /** The API a compatible server speaks, where it may speak more than one. */
  api?: string;
  /** Its model, for an agent whose definition names none. */
  model?: string;
  /** Its own effort, for an agent that names none. */
  effort?: Effort;
  /** It takes one tool call per answer. */
  serialTools?: true;
  /** Message threads are on. */
  messageThreads?: true;
  /** How many times a call that failed before any answer arrived is tried again; 2 when absent. */
  retries?: number;
  /** What the user entered as each model's limits, by model id. */
  limits?: { [key: string]: ModelLimitsEntry };
  /** What the connection's server reported as each model's limits, by model id. */
  reported?: { [key: string]: ModelLimitsEntry };
  /** Its headers by name, and whether each has a value; never a value. */
  headers?: { name: string; set: boolean }[];
  default: boolean;
  /** For a connection that signs in: whether the sign-in holds. */
  signedIn?: boolean;
  key: { set: boolean } | null;
  limitsInForce: ModelLimits | null;
}

/** The connections as shown, the default, and the providers offered. */
export interface ConnectionsShown {
  connections: ConnectionShown[];
  default: string | null;
  providers: ProviderOffer[];
}

/** A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them. */
export type ConnectionTested = { ok: true; ms: number; model: string; limits: ModelLimits | null } | { ok: false; ms: number; error: string; limits: ModelLimits | null };

/** How hard a model reasons on a call. */
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, and the limit it ended at. */
export interface JobView {
  id: string;
  agent: string;
  brief: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled" | "off-path" | "interrupted";
  scope: Scope;
  startedBy: AgentRef | "user";
  started: number;
  ended?: number;
  usage: Usage;
  report?: string;
  limit?: LimitHit;
}

/** A level of the agents' tree: what ships, the user's own, a character's, a chat's. */
export type LayerLevel = "shipped" | "global" | "character" | "chat";

/** A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs. */
export interface LimitHit {
  limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "depth" | "agents" | "jobs";
  per: "turn" | "agent" | "job" | "day";
  max: number;
  value: number;
  agent?: AgentRef;
  connection?: string;
}

/** What a page sends on the live socket: to follow a chat's events from its next one, or to stop. */
export interface LiveAsk {
  op: "follow" | "unfollow";
  chat: string;
}

/** A chat's events in order, and the numbers of those the hub dropped before them for a page that fell behind: an events message without its type, as the relay hands it on. */
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: LiveMissed;
}

/** One event of a chat as the live socket sends it: numbered from 1 per chat, of one of the kinds the socket carries, with that kind's data; an event of a kind declared with a key carries it. */
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string } };

/** What the live socket sends a page: that following a chat began, with the number of the chat's last event then; a chat's events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent. */
export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };

/** The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than live.queueEvents holds for it. */
export interface LiveMissed {
  from: number;
  to: number;
}

/** One limit of a model, in tokens, and where it came from. */
export interface ModelLimit {
  tokens: number;
  from: "user" | "pi" | "connection";
}

/** A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it. */
export interface ModelLimits {
  contextWindow: ModelLimit | null;
  maxTokens: ModelLimit | null;
}

/** A model's limits as entered or reported: its context window and its longest answer, in tokens. */
export interface ModelLimitsEntry {
  contextWindow?: number;
  maxTokens?: number;
}

/** What changed in the prompt's shape since the turn before, or that it is not mapped or could not be told apart. */
export type PromptNotice = { kind: "changed"; marker: string } | { kind: "gone"; marker: string } | { kind: "unclaimed"; message: number; start: number; end: number } | { kind: "order"; markers: string[] } | { kind: "preset"; was: { id: string; name?: string; revision?: string } | null; now: { id: string; name?: string; revision?: string } | null } | { kind: "unmapped" } | { kind: "incomplete" };

/** A provider the Connections page offers, how its connections may sign their calls, the APIs it speaks, and whether a connection of it must give its address. */
export interface ProviderOffer {
  id: string;
  name: string;
  auth: ConnectionAuth[];
  apis: string[];
  needsBaseUrl: boolean;
}

/** The reply's release: whose text, in which form, the file for a file released, and its length. */
export interface Release {
  by: AgentRef;
  form: "tags" | "message" | "narrator" | "narrator-live" | "file";
  path?: string;
  length: number;
}

/** What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or one progress line of the chat's thinking block, counted from 0. */
export type ReplyPiece = { run: string; from: number; text: string } | { run: string; line: number; progress: string };

/** Where a restart onto RPE's app file on disk stands: nothing to restart onto, waiting for the turns and jobs running, restarting, needed and not made while `update.restart` is off, or needed and not possible, RPE having been started by hand. */
export type RestartState = "none" | "waiting" | "restarting" | "off" | "by hand";

/** A rule that fired: which, from where, at what moment, on what, what it did, and what the agent did next. */
export interface RuleFiring {
  rule: string;
  path: string;
  level: LayerLevel;
  moment: "stream" | "tool-call" | "tool-result" | "after-message" | "run-end" | "turn-start" | "before-compaction" | "interval";
  watched?: "text" | "thinking" | "reply" | "arguments" | "result";
  agent: AgentRef;
  callId?: string;
  tool?: string;
  matched?: string;
  fact?: { name: string; value: { count: number; names?: string[]; by?: { [key: string]: number }; namesBy?: { [key: string]: string[] }; fields?: { [key: string]: JsonValue } } };
  action: "cut" | "remind" | "hold" | "follow-up" | "briefing" | "call";
  dropped?: string;
  then?: { did: "called"; tools: string[] } | { did: "wrote" } | { did: "released" } | { did: "ended" };
}

/** How a run ended, whether a reply was released, the limit or the failure, and what every agent of it spent. */
export interface RunOutcome {
  status: "released" | "no-reply" | "stopped" | "limit" | "failed";
  released: boolean;
  limit?: LimitHit;
  error?: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed"; limit?: LimitHit; detail?: string };
  usage: Usage;
}

/** Sampling by its usual names, as a preset sets it; each one absent is the connection's own. */
export interface Sampling {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  seed?: number;
  stop?: string[];
}

/** A connection to save, and its key: left out keeps the key there is, null takes it away. */
export interface SaveConnection {
  connection: ConnectionInput;
  key?: string | null;
}

/** Where work is: the user, the chat, the session, and the turn where it belongs to one. */
export interface Scope {
  user: string;
  chat: string;
  session: string;
  turn?: string;
}

/** Whose the page's credential is, and when it runs out (epoch milliseconds; null: it has no end). */
export interface SessionReply {
  user: string;
  ends: number | null;
}

/** Each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); and every setting. */
export interface SettingsReply {
  chat: string | null;
  files: ({ level: LayerLevel; file: string; problem: string | null })[];
  settings: SettingView[];
}

/** A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`. */
export interface SettingsWrite {
  level: LayerLevel;
  chat?: string | null;
  key: string;
  value?: JsonValue;
  none?: boolean;
}

/** What a level may set a setting to: a whole number or a number, at least `least` and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names. */
export type SettingTakes = { type: "whole"; least: number; most?: number } | { type: "number"; least: number; most?: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };

/** A setting as the Settings page shows it. */
export interface SettingView {
  /** As a config file writes it; a per-connection setting's names the connection. */
  key: string;
  /** The value in force. */
  value: JsonValue;
  default: JsonValue;
  /** The level whose file decides the value in force; null where no file does, and the default holds. */
  from: LayerLevel | null;
  /** That level's file, as the Files page names it. */
  file: string | null;
  takes: SettingTakes;
  /** What it takes, in words. */
  takesWords: string;
  /** What no value means, where the default is none or `~` may be set. */
  none: string | null;
  /** `~` may be set (`none: true` in a write). */
  orNone: boolean;
  /** The levels it may be set at here. */
  levels: LayerLevel[];
  /** For a per-connection setting, the connection it names; null for a name or id no connection has now. */
  connection?: { id: string; name: string } | null;
  /** A value a file sets that the setting does not take, and why: the default holds in its place. */
  passed: { value: JsonValue; why: string } | null;
}

/** That RPE answers here, and its build: nothing more. */
export interface Status {
  name: "rpe";
  version: string;
}

/** A tool call a model made: the model's id for it, the tool, its arguments, and when the model began writing it, where the provider gave it in pieces. */
export interface ToolCallView {
  id: string;
  name: string;
  args: JsonValue;
  began?: number;
}

/** A tool's answer: what the model is shown, whether it failed, what it reports beyond it, its marks, and data for the live view. */
export interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  error?: true;
  reports?: string[];
  marks?: string[];
  details?: JsonValue;
}

/** Text of a model call as it streams: what arrived since the last piece, never numbered. */
export interface TraceDelta {
  run: string;
  agent: string;
  call: number;
  text?: string;
  thinking?: string;
  at: number;
}

/** What RPH did; each kind's fields are the facts of it. */
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; session: string; given: string[] } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; closing: boolean; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "hook"; hook: string; on: "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end"; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "released"; release: Release } | { kind: "compacted"; session: string; before: number; after: number; keptTurns: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened"; from?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };

/** An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it. */
export interface TraceRecord {
  seq: number;
  run: string;
  scope: Scope;
  at: number;
  agent: AgentRef;
  parent?: { agent: string; run: string; call: string };
  event: TraceEvent;
}

/** What a generation asks for. */
export type TurnKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";

/** Model calls and their tokens: sent (cached ones included), read from and written to the cache, written, and of those the reasoning. */
export interface Usage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
}

/** Every route in the form that answers in JSON, by its method and path pattern: its params, its query, its body, its reply, and whether it pages. */
export interface ApiRoutes {
  /** The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered. */
  "GET /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionsShown;
    paged: false;
  };
  /** Adds a connection, with its key when it has one. */
  "POST /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
  };
  /** Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null. */
  "PUT /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
  };
  /** Removes a connection, and its key. */
  "DELETE /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
  };
  /** Makes a connection the default. */
  "PUT /api/v1/connections/:id/default": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
  };
  /** Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits. */
  "POST /api/v1/connections/:id/test": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionTested;
    paged: false;
  };
  /** Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, and the level and file it comes from. */
  "GET /api/v1/settings": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: SettingsReply;
    paged: false;
  };
  /** Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands. */
  "PUT /api/v1/settings": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SettingsWrite;
    reply: SettingsReply;
    paged: false;
  };
  /** Says that RPE answers here, and its build; nothing more, and no work to say it. */
  "GET /api/v1/status": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: Status;
    paged: false;
  };
  /** When RPE started, and the builds that meet at it, its app file read again. */
  "GET /api/v1/status/builds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsReply;
    paged: false;
  };
  /** Whose the page's credential is, and when it ends. */
  "GET /api/v1/status/session": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: SessionReply;
    paged: false;
  };
  /** "Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands. */
  "POST /api/v1/update": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsStatus;
    paged: false;
  };
}

/** Every route in the form that answers in its own way (a stream, a socket, a file), and what it answers. */
export interface RawRoutes {
  /** The live socket: a page follows chats on it, and is sent each one's events in order (the live kinds), held to the token it opened with. */
  "GET /api/v1/live": {
    params: Record<string, never>;
    answers: "a WebSocket on the protocol rpe.live; 426 when the request is not a socket's, 400 when it offers protocols and not rpe.live";
  };
  /** The web app's files, to anyone who reaches RPE; what a page then does is held to its own token by the API. */
  "GET /ui/*": {
    params: { "*": string };
    answers: "a file of the built web app (its page, scripts and styles), or 404 with words saying why there is none";
  };
}

/** Every kind a chat's live socket carries, and what each carries. */
export interface LiveKinds {
  /** A record of RPH's trace, for a run played in the chat: every event of the run, as RPH gave it. */
  trace: TraceRecord;
  /** A piece of a model call's text as it streams, for the live view; the call's call_ended record holds it whole. */
  delta: TraceDelta;
  /** What went to the chat as the reply was written: its text, and the progress lines of its thinking block. */
  reply: ReplyPiece;
  /** The chat's state changed, and a page reads it again. A newer one replaces one a page has not taken yet (key "state"). */
  state: Record<string, never>;
  /** An engine handler failed on a change, which is recorded as not applied: the operation, and the handler's error. */
  handler_failed: { op: string; error: string };
}

// The live socket's own constants. What a page sends on it is a LiveAsk, and what it is sent a LiveMessage (above).
/** Where a page opens the live socket, as a WebSocket. */
export const LIVE_PATH = "/api/v1/live";
/** The protocol a page offers to open the live socket. */
export const LIVE_PROTOCOL = "rpe.live";
/** A page that cannot set the Authorization header offers its token as a second protocol: this, then the token. */
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";
/** The code RPE closes a page's live socket with once the token it opened with has run out or been replaced, with the reason "The page's token has run out or was replaced: open the live socket again with a new one." */
export const LIVE_TOKEN_ENDED = 4401;
