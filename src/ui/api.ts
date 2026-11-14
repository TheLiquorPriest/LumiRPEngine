// What the pages read from RPE (plan §4.4, §14): the routes they call, with what each answers, and the
// live events a turn publishes on its chat. The route table is where these come from: the plan has the
// UI client's types generated from it. Until a generator exists they are kept here by hand, because the
// zone rules keep the pages from importing the server's code, its types included; `test/ui/direct.test.ts`
// holds each one to the route itself. The app's own routes (its status, the live socket) are mirrored
// from `src/app/`; the turn routes and the live kinds are what the turn lane implements; a connection's
// shapes are RPH's contract's own.

import type { AgentRef, ConnectionInput, ConnectionList, ConnectionTest, ConnectionView, FileKind, LayerLevel, ModelLimits, ReplyError, RunStatus, StackPart, TraceDelta, TraceRecord, TurnKind, Usage } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";
import type { DraftChanged, ErrorMessage, FrontendToBackend, ResultMessage } from "../shared/protocol";

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

// ---------------------------------------------------------------- the agents' files (the tree lane's, plan §5)

/**
 * One file of the agents' tree as the Files page lists it: its path in the chat's view, as the file
 * routes take it (`@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder), its level and
 * kind, its size; the name RPH loads it by and an `off:` list names it by (null: none); whether RPH
 * takes it; the nearer file taken in its place; whether its name is switched off; whether the user may
 * write it where it is; the shipped file of its name, for a file of another level; and when an update
 * changed that shipped file since this one was last written.
 */
export interface TreeFileEntry {
  path: string;
  level: LayerLevel;
  kind: FileKind;
  bytes: number;
  item: string | null;
  applies: boolean;
  replacedBy: string | null;
  off: boolean;
  editable: boolean;
  shipped: string | null;
  defaultChanged: number | null;
}

/** `GET /api/v1/files?chat=`: every file of the chat's view of the tree; with no chat, of the shipped level and the user's own. */
export interface TreeListing {
  files: TreeFileEntry[];
}

/** `GET /api/v1/files/*?chat=`: one file, as text. */
export interface TreeFileText {
  path: string;
  level: LayerLevel;
  kind: FileKind;
  bytes: number;
  editable: boolean;
  text: string;
}

/** One line of a difference between two texts: in both, only in the second, or only in the first. */
export interface DiffLine {
  op: "same" | "added" | "removed";
  text: string;
}

/** `GET /api/v1/files-diff/*?chat=`: from the shipped file of its name to this one; and what the update that changed the shipped file since this one was written changed of it. */
export interface TreeFileDiff {
  path: string;
  shipped: string | null;
  lines: DiffLine[];
  update: { at: number; lines: DiffLine[] } | null;
}

/** `PUT /api/v1/files/*`: the whole text, written as the user's at a level (for a file of another level, the user's own file of its name there); a chat's level names the chat. */
export interface FileWrite {
  level: LayerLevel;
  chat?: string;
  text: string;
}

/** `PUT /api/v1/files-off/*`: a file's name switched off or on again in the `off:` list of a level's config. */
export interface FileSwitch {
  level: "global" | "chat";
  chat?: string;
  off: boolean;
}

/** What writing a file or switching its name answers: the file as the listing now shows it. */
export interface FileWritten {
  file: TreeFileEntry | null;
}

export type SuggestionState = "open" | "accepted" | "dismissed";

/** An agent's suggestion for a file: the file as the agent named it in the chat's view, the text proposed whole, and why. */
export interface TreeSuggestion {
  id: number;
  chat: string;
  turn: string | null;
  agent: AgentRef;
  path: string;
  text: string;
  reason: string;
  at: number;
  state: SuggestionState;
  decided: number | null;
}

/** A suggestion with what it would change: from the file as it is now to the text proposed. */
export interface TreeSuggestionView extends TreeSuggestion {
  lines: DiffLine[];
}

/** `GET /api/v1/suggestions?chat=&state=`: a chat's suggestions (every chat's when none is named), newest first. */
export interface SuggestionList {
  suggestions: TreeSuggestionView[];
}

/** `POST /api/v1/suggestions/:id/accept`: the text as accepted, when it was edited, and the level it is written at (absent: the file's own). */
export interface SuggestionAccept {
  text?: string;
  level?: LayerLevel;
}

export interface SuggestionAccepted {
  suggestion: TreeSuggestion | null;
  file: TreeFileEntry | null;
}

export interface SuggestionDismissed {
  suggestion: TreeSuggestion | null;
}

/** What a chat's folder takes in all, and by area: its notes, its turn folders, its sessions' own files, and the rest of its files. */
export interface ChatStorage {
  chat: string;
  /** Its folder below the tree's `chats/`. */
  folder: string;
  bytes: number;
  areas: { notes: number; turns: number; sessions: number; files: number };
}

/** `GET /api/v1/storage`: each chat's folder; the user's own level and the shipped level; and RPE's database file, with its write-ahead log. */
export interface TreeStorage {
  chats: ChatStorage[];
  global: number;
  shipped: number;
  database: number;
}

/** A note file of a chat: its path in the chat's view, its size now (0 for one no longer there), and how many times agents wrote it in turns. */
export interface NoteFile {
  path: string;
  bytes: number;
  writes: number;
}

/** `GET /api/v1/storage/notes?chat=&limit=`: a chat's largest notes, and those agents rewrote most. */
export interface NoteFiles {
  largest: NoteFile[];
  rewritten: NoteFile[];
}

/** What pruning a chat's old turn folders took away (`POST /api/v1/files-prune`): of how many folders, how many files, how many bytes. */
export interface Pruned {
  folders: number;
  files: number;
  bytes: number;
}

/** `GET /api/v1/files-stack?chat=&agent=`: the exact stack an agent gets in the chat, part by part in order, each with the file it comes from, its level, and whether it sits in the opening block or comes with the briefing; a part left out is listed with why. */
export interface AgentStack {
  agent: string;
  parts: StackPart[];
}

// ---------------------------------------------------------------- settings (the app's, plan §5.4 "Config", §14)

/** What a level may set a setting to: a whole number or a number at least `least`, one of `values`, yes or no, a line of text, or a list of names. */
export type SettingTakes = { type: "whole"; least: number } | { type: "number"; least: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };

/**
 * A setting as the Settings page shows it: its key as a config file writes it (a per-connection one
 * names its connection), the value in force, its default, the level whose file decides the value (null:
 * no file does, and the default holds) and that file, what it takes and that in words, what no value
 * means, whether `~` may be set, the levels it may be set at here, the connection it names (null: a name
 * no connection has now), and a value a file sets that it does not take, with why.
 */
export interface SettingView {
  key: string;
  value: JsonValue;
  default: JsonValue;
  from: LayerLevel | null;
  file: string | null;
  takes: SettingTakes;
  takesWords: string;
  none: string | null;
  orNone: boolean;
  levels: LayerLevel[];
  connection?: { id: string; name: string } | null;
  passed: { value: JsonValue; why: string } | null;
}

/** `GET /api/v1/settings?chat=`, and what `PUT` answers: each level's config file, farthest first, with what is wrong with one that cannot be read; and every setting. */
export interface SettingsReply {
  chat: string | null;
  files: { level: LayerLevel; file: string; problem: string | null }[];
  settings: SettingView[];
}

/** `PUT /api/v1/settings`: a key written at a level, a chat's naming the chat; `value` null takes the key away there, and `none` sets `~`. */
export interface SettingsWrite {
  level: LayerLevel;
  chat: string | null;
  key: string;
  value: JsonValue;
  none: boolean;
}

// ---------------------------------------------------------------- the migration (the migration's, plan §15.5, §15.6)

/** What came of a chat the last run looked at, in the run's own words. */
export type ChatOutcome =
  | "imported"
  | "replaced"
  | "played on RPE: left alone"
  | "a chat made from it was played on RPE: left alone"
  | "gone from Lumiverse: removed"
  | "gone from Lumiverse, played on RPE: left alone"
  | "gone from Lumiverse, a chat made from it was played on RPE: left alone"
  | "not imported";

/** Where RPE's fold of a chat differs from today's: at a swipe (its message and number) or at the chat's head; the values that differ, by path; and whether today's state there is kept as the turn's start. */
export interface MigrationDifference {
  at: { message: string; swipe: number } | "head";
  turn: string;
  values: string[];
  kept: boolean;
}

/**
 * One chat as the last run left it: what came of it and why it was not imported; the turns imported of
 * its own; the messages it shares with the chat it was made from; and its check against today's fold
 * (matched at the head and at how many swipes, where it differed, and where its swipes were placed).
 */
export interface MigrationChat {
  chat: string;
  outcome: ChatOutcome;
  why: string | null;
  turns: number;
  shares: { chat: string; messages: number } | null;
  check: { matched: { head: boolean; swipes: number; of: number }; differences: MigrationDifference[]; placed: { own: number; shown: number; lost: number; head: number } };
}

/** One thing the last run left waiting on the user, by what it is. */
export type MigrationWaiting =
  | { kind: "guidance"; path: string }
  | { kind: "connection"; setting: string; connection: string }
  | { kind: "chat"; chat: string; questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean }
  | { kind: "own"; agents: number; skills: number; texts: number }
  | { kind: "filing"; chat: string; characters: number; notes: boolean };

/**
 * `GET /api/v1/migration`, as far as the page reads it: the last run's report as the run printed it
 * (null before any run), each chat, the backup (where, its size and checksum, whether a file of that
 * size is still there), what is waiting on the user, and the steps of going back with the permissions
 * the previous build asks for. The route also sends the report whole and what was carried of each chat;
 * the page shows the report as its printed text.
 */
export interface MigrationShown {
  text: string | null;
  chats: MigrationChat[];
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  waiting: MigrationWaiting[];
  goingBack: { steps: string[]; permissions: string[] };
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

/** A connection as the routes show it: whether a key is set and nothing of the key; and its model's limits as RPH uses them, null where nobody knows them. */
export type ConnectionShown = Omit<ConnectionView, "key"> & { key: { set: boolean } | null; limitsInForce: ModelLimits | null };

/** `GET /api/v1/connections`: the connections as shown, the default and the providers offered. */
export interface ConnectionsShown extends Omit<ConnectionList, "connections"> {
  connections: ConnectionShown[];
}

/** `POST /api/v1/connections/:id/test`: whether the provider answered and the model it named, or its words; and that model's limits where RPH knows them. */
export type ConnectionTested = ConnectionTest & { limits: ModelLimits | null };

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
  "GET /api/v1/connections": RouteShape<ConnectionsShown>;
  "POST /api/v1/connections": RouteShape<ConnectionShown, Record<string, never>, SaveConnection>;
  "PUT /api/v1/connections/:id": RouteShape<ConnectionShown, Record<string, never>, SaveConnection>;
  "DELETE /api/v1/connections/:id": RouteShape<void>;
  "PUT /api/v1/connections/:id/default": RouteShape<void>;
  "POST /api/v1/connections/:id/test": RouteShape<ConnectionTested>;
  "POST /api/v1/build": RouteShape<{ result: ResultMessage | ErrorMessage; pushes: DraftChanged[] }, Record<string, never>, FrontendToBackend>;
  "GET /api/v1/files": RouteShape<TreeListing, { chat?: string }>;
  "GET /api/v1/files/*": RouteShape<TreeFileText, { chat?: string }>;
  "PUT /api/v1/files/*": RouteShape<FileWritten, Record<string, never>, FileWrite>;
  "DELETE /api/v1/files/*": RouteShape<{ removed: string }, { chat?: string }>;
  "PUT /api/v1/files-off/*": RouteShape<FileWritten, Record<string, never>, FileSwitch>;
  "GET /api/v1/files-diff/*": RouteShape<TreeFileDiff, { chat?: string }>;
  "GET /api/v1/suggestions": RouteShape<SuggestionList, { chat?: string; state?: SuggestionState }>;
  "POST /api/v1/suggestions/:id/accept": RouteShape<SuggestionAccepted, Record<string, never>, SuggestionAccept>;
  "POST /api/v1/suggestions/:id/dismiss": RouteShape<SuggestionDismissed>;
  "GET /api/v1/settings": RouteShape<SettingsReply, { chat?: string }>;
  "PUT /api/v1/settings": RouteShape<SettingsReply, Record<string, never>, SettingsWrite>;
  "GET /api/v1/migration": RouteShape<MigrationShown>;
  "GET /api/v1/storage": RouteShape<TreeStorage>;
  "GET /api/v1/storage/notes": RouteShape<NoteFiles, { chat: string; limit?: number }>;
  "POST /api/v1/files-prune": RouteShape<{ pruned: Pruned }, Record<string, never>, { chat: string }>;
  "GET /api/v1/files-stack": RouteShape<AgentStack, { chat: string; agent: string }>;
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
