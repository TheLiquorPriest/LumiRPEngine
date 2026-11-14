// What the pages read from RPE (plan §4.4, §14): the routes they call, with what each answers, and the
// live events a turn publishes on its chat. The route table is where these come from: the plan has the
// UI client's types generated from it. Until a generator exists they are kept here by hand, because the
// zone rules keep the pages from importing the server's code, its types included; `test/ui/direct.test.ts`
// holds each one to the route itself. The app's own routes (its status, the live socket) are mirrored
// from `src/app/`; the turn routes and the live kinds are what the turn lane implements; a connection's
// shapes are RPH's contract's own.

import type { ConnectionInput, ConnectionList, ConnectionView, ReplyError, RunStatus, TraceDelta, TraceRecord, TurnKind, Usage } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";

// ---------------------------------------------------------------- the app's own

/** `GET /api/v1/status` (public): which RPE answers, and whether it belongs to a Lumiverse user yet. */
export interface Status {
  name: "rpe";
  version: string;
  started: number;
  belongsToUser: boolean;
}

/** A permission RPE's extension in Lumiverse lacks, and why it needs it. */
export interface MissingPermission {
  permission: string;
  why: string;
}

/** `GET /api/v1/status/extension` (page): how RPE's extension in Lumiverse last said it stands with RPE. */
export interface ExtensionStatus {
  /** Whether the extension holds RPE's registration, and so marks the replies RPE plays. */
  registered: boolean;
  /** Why it does not, in words a user is shown; null when it does. */
  why: string | null;
  /** The permissions it says it lacks, and why it needs each; null until it has said. */
  missing: MissingPermission[] | null;
}

/** The live socket (`src/app/live.ts`): its path, its protocol, and how a page gives its token as a protocol. */
export const LIVE_PATH = "/api/v1/live";
export const LIVE_PROTOCOL = "rpe.live";
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";
export const STATUS_PATH = "/api/v1/status";

/** One event of a chat as the live hub sends it: numbered from 1 per chat, with what happened in the publishing area's words. */
export interface LiveEvent {
  chat: string;
  seq: number;
  kind: string;
  /** Present on a state push, which a newer push with the same key may replace for a page that fell behind. */
  key?: string;
  at: number;
  data: JsonValue;
}

/** A chat's events in order; `missed` names the hub's numbers it dropped for a page that fell behind. */
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: { from: number; to: number };
}

// ---------------------------------------------------------------- chats and turns (the turn lane's)

/** A chat RPE plays, as the web shell lists them. */
export interface ChatSummary {
  id: string;
  /** The chat's name in Lumiverse. */
  name: string;
  /** When its newest turn began: RPE lists a chat once it has played a turn of it. */
  lastTurnAt: number;
  /** Whether a turn of it runs now. */
  running: boolean;
}

/** `GET /api/v1/chats`: the chats of the user RPE belongs to, the most recently played first. */
export interface ChatList {
  chats: ChatSummary[];
}

/** Where a turn stands: running, or how its run ended. */
export type TurnStatus = RunStatus | "running";

/** When a turn's moments happened, in milliseconds since 1970; null for one that has not happened. */
export interface TurnTimings {
  /** The request reached RPE. */
  received: number;
  /** The lead's run began, after intake and any wait for the turn before it. */
  started: number | null;
  /** The reply's first words went to the chat. */
  firstWord: number | null;
  /** The reply was released (plan §10.7). */
  released: number | null;
  /** The lead's run ended; it can go on after the release (plan §10.9). */
  ended: number | null;
}

/** A turn as a chat's list shows it. */
export interface TurnSummary {
  id: string;
  kind: TurnKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnStatus;
  timings: TurnTimings;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
}

/** `GET /api/v1/chats/:chat/turns?limit=&before=`: a chat's turns, newest first; `before` is a turn's id, and older ones follow it. */
export interface TurnList {
  turns: TurnSummary[];
  /** Older turns remain. */
  more: boolean;
}

/** One run of a turn: its first, or a continue of it, which runs the turn again under a run id of its own. */
export interface TurnRun {
  id: string;
  /** Its place among the turn's runs, from 1. */
  nth: number;
  kind: TurnKind;
  status: TurnStatus;
  timings: TurnTimings;
  usage: Usage;
  /** What this run sent to the chat: the reply's text, and the progress lines of its thinking block. */
  reply: { text: string; progress: string[] };
  error: ReplyError | null;
  /** Its own trace records, numbered from 1 within the run, from the record numbered `from`. */
  trace: TraceRecord[];
  /** The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call, each named by its path below the folder. */
  requests: { agent: string; definition: string; call: number; file: string }[];
}

/** `GET /api/v1/chats/:chat/turns/:turn?from=`: one turn, with its trace from the record numbered `from` (1 when absent). */
export interface TurnDetail extends TurnSummary {
  chat: string;
  /** The lead's intent record as it was written (plan §10.3); null when it wrote none. Shown behind the spoiler gate. */
  intent: string | null;
  /** What its latest run sent to the chat so far: the reply's text, and the progress lines of its thinking block. */
  reply: { text: string; progress: string[] };
  /** Why the reply failed, when it did. */
  error: ReplyError | null;
  /** The events of all its runs, each run's numbered from `from`, in order. */
  trace: TraceRecord[];
  /** The lore of the turn's prompt, by id, as its intake kept it: the entries Lumiverse activated for it (Lumiverse's ids), and the entries its lore map showed the Author (RPE's ids, as the map writes them). */
  lore: { activated: string[]; map: string[] };
  /** Each of its runs, the first first. */
  runs: TurnRun[];
}

/** `POST /api/v1/chats/:chat/turns/:turn/stop` (no body): true when the turn was running and is being stopped, false when it had already ended. */
export interface StopAnswer {
  stopped: boolean;
}

/** One entry of a turn's folder: its path below the folder, its size (a folder's is what its files hold), and whether it is a folder. */
export interface TurnFileEntry {
  name: string;
  bytes: number;
  folder: boolean;
}

/** `GET /api/v1/chats/:chat/turns/:turn/files`: the whole of a turn's folder, every level down; none for a turn that has no folder. */
export interface TurnFiles {
  files: TurnFileEntry[];
}

/** `GET /api/v1/chats/:chat/turns/:turn/files/*`: one file of a turn's folder, by its path below the folder, as text. */
export interface TurnFile {
  name: string;
  text: string;
}

// ---------------------------------------------------------------- the world (the store's tree, plan §6.4, §6.6)

/** What a level of the world's tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere). */
export type WorldNodeKind = "world" | "place" | "entity" | "groups" | "elsewhere";
export type Precision = "exact" | "approximate" | "vague" | "unknown";
export type Standing = "established" | "proposed" | "assumed";
export type ValueSource = "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented";

/** The change that last wrote a value: its turn, by id and by its number on the chat's path, and how exact, how sure and from where. */
export interface ValueMark {
  turn: string;
  n: number;
  precision: Precision | null;
  standing: Standing | null;
  source: ValueSource | null;
}

/** One value of a level: its key, its value as text (null: none), where it comes from when it is not the level's own (a game system that keeps it, or the level above that sets it), and the change that last wrote it. */
export interface ValueLine {
  key: string;
  value: string | null;
  from?: { system?: string; ref?: string; name?: string };
  mark?: ValueMark;
}

/** What is beneath a level, made from recorded values. */
export interface Reflection {
  people: number;
  things: number;
  places: number;
  groups: number;
  records: number;
  notable: string[];
  open: number;
  /** The number of the last turn that changed something there. */
  changed: number | null;
  /** An agent's own line on the level. */
  note: string | null;
}

/** A plain statement recorded about a level, with how exact and how sure it is and where it came from; never merged into the level's values. */
export interface WorldFact {
  id: string;
  about: string;
  key: string;
  value: string;
  precision: Precision | null;
  standing: Standing | null;
  source: ValueSource | null;
  by: string | null;
  turn: string;
  n: number;
  replacedBy?: string;
  replacedAt?: number;
}

/** A level of the world's tree as the world route shows it. */
export interface WorldNode {
  ref: string;
  kind: WorldNodeKind;
  /** Its name in the data; null for the groups and for what is elsewhere. */
  name: string | null;
  /** An entity's kind, by its label; null for any other level. */
  what: string | null;
  reflection: Reflection;
  values: ValueLine[];
  facts: WorldFact[];
  children: string[];
  parent: string | null;
}

/** Which values each level carries: none, its own (with what game systems keep), or all (with what it inherits). */
export type ValuesShown = "none" | "own" | "all";

/** `GET /api/v1/chats/:chat/world?at=&depth=&values=&turn=`: the level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn. */
export interface WorldAnswer {
  at: string;
  nodes: WorldNode[];
}

// ---------------------------------------------------------------- the route map the client is typed by

/** A route's reply, its query and its body. */
export interface RouteShape<Reply, Query extends Record<string, string | number | undefined> = Record<string, never>, Body = undefined> {
  reply: Reply;
  query: Query;
  body: Body;
}

/** What saving a connection sends (`POST /api/v1/connections`, `PUT /api/v1/connections/:id`): the connection whole, and its key: absent keeps the one there is, null takes it away. */
export interface SaveConnection {
  connection: ConnectionInput;
  key?: string | null;
}

/** Every route the pages call, by method and path pattern, as the route table writes them; `*` stands for the rest of the path. */
export interface Routes {
  "GET /api/v1/status": RouteShape<Status>;
  "GET /api/v1/status/extension": RouteShape<ExtensionStatus>;
  "GET /api/v1/chats": RouteShape<ChatList>;
  "GET /api/v1/chats/:chat/turns": RouteShape<TurnList, { limit?: number; before?: string }>;
  "GET /api/v1/chats/:chat/turns/:turn": RouteShape<TurnDetail, { from?: number }>;
  "POST /api/v1/chats/:chat/turns/:turn/stop": RouteShape<StopAnswer>;
  "GET /api/v1/chats/:chat/turns/:turn/files": RouteShape<TurnFiles>;
  "GET /api/v1/chats/:chat/turns/:turn/files/*": RouteShape<TurnFile>;
  "GET /api/v1/chats/:chat/world": RouteShape<WorldAnswer, { at?: string; depth?: number; values?: ValuesShown; turn?: string }>;
  "GET /api/v1/connections": RouteShape<ConnectionList>;
  "POST /api/v1/connections": RouteShape<ConnectionView, Record<string, never>, SaveConnection>;
  "PUT /api/v1/connections/:id": RouteShape<ConnectionView, Record<string, never>, SaveConnection>;
  "DELETE /api/v1/connections/:id": RouteShape<void>;
  "PUT /api/v1/connections/:id/default": RouteShape<void>;
}

export type RouteKey = keyof Routes & string;

// ---------------------------------------------------------------- what a turn publishes on its chat

/**
 * What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or
 * one progress line of the chat's thinking block, counted from 0.
 */
export type ReplyPiece = { run: string; from: number; text: string } | { run: string; line: number; progress: string };

/**
 * The live kinds a turn publishes (`app.live.publish(chat, { kind, data })`), each without a key, so
 * none replaces another: every event of a run as RPH traced it, the text of a model call as it streams,
 * and what went to the chat.
 */
export interface LiveKinds {
  trace: TraceRecord;
  delta: TraceDelta;
  reply: ReplyPiece;
}
