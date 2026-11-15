// RPE's API as its route table declares it: every route's params, query, body and reply, every kind the
// live socket carries, and the live socket's own messages and constants. Written by `bun run api`
// (scripts/api/) from the table the server runs, for every road to RPE: both shells, the command line,
// the MCP server. Do not edit it: a route's declaration is where a type changes, and `bun run api`
// writes this again. The reference for people is docs/api.md, written beside it.

import type { DraftChanged, ErrorMessage, FrontendToBackend, ResultMessage } from "../protocol";
import type { StateView } from "../state-view";

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

/** The base's four documents. */
export type BaseDocument = "seed" | "soul" | "inner_voice" | "background";

/** A version of a part of the base; `standing` marks the one in force (it stands outside turns: a swipe changes none of it). */
export interface BaseVersionRow {
  part: BaseDocument;
  version: number;
  text: string;
  /** The newest version of its part: the one in force. */
  standing: boolean;
  /** The turn it was written in; null when written outside one. */
  turn: TurnId | null;
  by: string | null;
  created: number;
}

/** The chats to start the bootstrap job for, one after another: a list of chat ids, or "migrated" for every chat the last migration carried; and the player's choice of what to relive. */
export interface BootstrapBatchAsk {
  chats: "migrated" | string[];
  /** The player's choice of what to relive: one of the words the bootstrap skill offers for reliving the past; left out or null, none was made. */
  relive?: string | null;
}

/** What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why. */
export interface BootstrapBatchReply {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}

/** A chat's bootstrap: the six facts, and the chat's bootstrap jobs, oldest first. */
export interface BootstrapChatReply {
  chat: string;
  facts: DoneEnoughShown;
  jobs: BootstrapJobShown[];
}

/** A bootstrap job of a chat: what it was given (the player's relive word, the token limit), and its view as RPH gives it (null: RPH no longer holds it). */
export interface BootstrapJobShown {
  id: string;
  relive: string | null;
  tokenLimit: number;
  view: JobView | null;
}

/** What starts a chat's bootstrap job: the player's choice of what to relive, where one was made. */
export interface BootstrapStartAsk {
  /** The player's choice of what to relive: one of the words the bootstrap skill offers for reliving the past; left out or null, none was made. */
  relive?: string | null;
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

/** Today's answer to the message, and the pushes the request caused. */
export interface BuildTunnelReply {
  result: ResultMessage | ErrorMessage;
  pushes: DraftChanged[];
}

/** The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call. */
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}

/** A casting in force: the player's pin, else the Author's; with the Author's line for the character, where it wrote one. */
export interface CastingRow {
  as: CastRole;
  /** The player pinned it; it stands over the Author's. */
  pinned: boolean;
  line: string | null;
}

/** A character as the cast lists it: its casting (null: none yet), where its record came from (carried by a migration, played on RPE), and its counts. */
export interface CastMemberRow {
  id: string;
  name: string;
  /** The chat it was first cast in: this chat, or one this chat was branched from. */
  chat: string;
  /** Its casting at the reading; null when it has none there (in the cast, not yet cast). */
  casting: CastingRow | null;
  /** Where its record on the path came from: writes on turns a migration's import wrote (carried), and writes on turns RPE played. */
  from: { carried: boolean; played: boolean };
  counts: EntryCounts;
}

/** Every character the chat knows, with what each holds on the path read; `turn` null: at the chat's newest. */
export interface CastReply {
  chat: string;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  /** In the order they were made: this chat's, and those of the chats it was branched from. */
  characters: CastMemberRow[];
}

/** How large a part a character plays. */
export type CastRole = "principal" | "supporting" | "extra";

/** An entry of the character's record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says. */
export interface CastStrikeAsk {
  id: string;
  struck: boolean;
  why?: string | null;
}

/** What a strike, or taking one back, did: whether anything was recorded, the entry now, the knowledge struck with it, the secrets let go; for a strike taken back, the knowledge standing again with it and the secrets held again; and what it could not do, in the cast's words. */
export interface CastStrikeReply {
  /** Whether anything was recorded: false when the entry already stood so. */
  changed: boolean;
  /** The entry as it stands now, at the chat's newest turn. */
  entry: EntryRow;
  /** The knowledge a struck perception gave, struck with it, by id. */
  alsoStruck: string[];
  /** The secrets whose holding the strike took back, by their fact's id. */
  letGo: string[];
  /** A perception's strike taken back: the knowledge its strike struck with it, standing again with it, by id. */
  alsoStood: string[];
  /** A strike taken back: the secrets the knowledge standing again gives, held again, by their fact's id. */
  heldAgain: string[];
  /** What it could not do, and what it left as it was (knowledge struck apart, and the secret it gave), in the cast's words. */
  notes: string[];
}

/** Everything on one character's record, by kind; `turn` null: at the chat's newest. */
export interface CharacterReply {
  chat: string;
  turn: TurnId | null;
  character: CastMemberRow;
  sources: SourceBindingRow[];
  /** Every version of every part of the base, oldest first. */
  base: BaseVersionRow[];
  /** The Author's castings of it on the path, oldest first. */
  castings: EntryWriteRow[];
  growth: EntryRow[];
  /** What is on its mind; the carried mind files are under `files`. */
  mind: EntryRow[];
  memories: MemoryRow[];
  relationships: EntryRow[];
  knowledge: EntryRow[];
  history: EntryRow[];
  perceptions: PerceptionRow[];
  files: MindFileRow[];
}

/** What came of a chat the last run looked at, in the run's own words. */
export type ChatImportOutcome = "imported" | "replaced" | "played on RPE: left alone" | "a chat made from it was played on RPE: left alone" | "gone from Lumiverse: removed" | "gone from Lumiverse, played on RPE: left alone" | "gone from Lumiverse, a chat made from it was played on RPE: left alone" | "not imported";

/** A chat RPE plays, as the web shell lists them. */
export interface ChatRow {
  id: string;
  /** The chat's name in Lumiverse. */
  name: string;
  /** When its newest turn on RPE began; null for a chat RPE holds and has not played yet (one a migration imported). */
  lastTurnAt: number | null;
  /** Whether a turn of it runs now. */
  running: boolean;
  /** Whether RPE has played a turn of it. */
  played: boolean;
  /** Whether RPE's store has a world for it. */
  world: boolean;
}

/** The chats of the user RPE belongs to, the most recently played first, then those its store holds that it has not played. */
export interface ChatsReply {
  chats: ChatRow[];
}

/** What a chat's folder takes in all, and by area: its notes, its turn folders, its sessions' own files, and the rest of its files. */
export interface ChatStorageRow {
  chat: string;
  /** Its folder below the tree's `chats/`. */
  folder: string;
  bytes: number;
  areas: { notes: number; turns: number; sessions: number; files: number };
}

/** How RPE stands as its own command line is told: the keys in force, the switches and the builds in words. */
export interface CommandStatus {
  /** Each key in force: the provider key by its last four characters (null for one taken from today's connection, whose were never known), when it was made and, for the web token, when it ends; never a key's text. */
  keys: ({ kind: "provider" | "extension" | "web"; last4: string | null; made: number; ends: number | null; taken: boolean })[];
  /** Every switch, each name's newest definition. */
  switches: SwitchEntry[];
  /** The builds that meet at RPE in a sentence or two; null where the server does not say. */
  builds: string | null;
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

/** A connection as the routes show it: whether a key is set and nothing of the key; its model's limits as RPH uses them, null where nobody knows them; and why they could not be read, where they could not. */
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
  /** Why its model's limits could not be read; null where they were read, each of them known or not. */
  limitsProblem?: string | null;
}

/** The connections as shown, the default, and the providers offered. */
export interface ConnectionsShown {
  connections: ConnectionShown[];
  default: string | null;
  providers: ProviderOffer[];
}

/** A connection's test: how long it took, and the model that answered or the provider's words; and that model's limits where RPH knows them, or why they could not be read. */
export type ConnectionTested = { ok: true; ms: number; model: string; limits: ModelLimits | null; limitsProblem?: string | null } | { ok: false; ms: number; error: string; limits: ModelLimits | null };

/** One line of a difference between two texts: in both, only in the second, or only in the first. */
export interface DiffRow {
  op: "same" | "added" | "removed";
  text: string;
}

/** The six facts of "done enough", in the order the bootstrap skill names them: the lore index, the history the window leaves out, the cast, the story model, the horizon, and each principal's base and memories. */
export interface DoneEnoughShown {
  lore: { known: true; entries: number; indexed: number; stale: number } | FactNotKnown;
  history: { known: true; messages: number; leftOut: number; covered: number; stretches: number; summarized: number; nearestUncovered: MessageStretch | null; nearestUnsummarized: MessageStretch | null } | FactNotKnown;
  cast: { known: true; listed: number; cast: number; uncast: string[] } | FactNotKnown;
  story: { known: true; premise: number; chapters: number; scenes: number; beats: number; threads: number; openThreads: number; arcs: number; principals: number; principalsWithArc: number; player: number } | FactNotKnown;
  horizon: { known: true; entries: number; named: number; clock: boolean } | FactNotKnown;
  principals: { known: true; principals: { id: string; name: string; base: string[]; memories: number }[] } | FactNotKnown;
}

/** When a change to a setting is in force: at its next use, from the next turn, or from RPE's next start. */
export type Effect = "use" | "turn" | "start";

/** How hard a model reasons on a call. */
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** How many entries of a kind a character holds on the path read: standing, and struck. */
export interface EntryCount {
  held: number;
  struck: number;
}

/** Each kind's counts; the carried mind files with how many of those standing are marked filed. */
export interface EntryCounts {
  growth: EntryCount;
  mind: EntryCount;
  memories: EntryCount;
  relationships: EntryCount;
  knowledge: EntryCount;
  history: EntryCount;
  perceptions: EntryCount;
  files: { held: number; struck: number; filed: number };
}

/** The parts of a character's record kept as rows tied to turns, the casting aside. */
export type EntryPart = "growth" | "mind" | "relationship" | "knowledge" | "history" | "perception" | "memory";

/** An entry of a character's record as it stands on the path read: its fields, story time of its first write, its first write, whether it is struck, and every write of it. */
export interface EntryRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
}

/** One write of an entry, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said. */
export interface EntryWriteRow {
  turn: TurnId;
  /** The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind). */
  message: number | null;
  /** That turn was written by a migration's import, not played on RPE. */
  imported: boolean;
  /** Who wrote it: an agent's definition (`author`, a character's own), `player`, or the migration. */
  by: string | null;
  /** What it said: the fields it set, `drop` among them. */
  wrote: { [key: string]: JsonValue };
}

/** How RPE's extension in Lumiverse last said it stands with RPE: whether it holds RPE's registration, why it does not, and the permissions it says it lacks. */
export interface ExtensionStatusReply {
  /** Whether the extension holds RPE's registration, and so marks the replies RPE plays. */
  registered: boolean;
  /** Why it does not, in words a user is shown; null when it does. */
  why: string | null;
  /** The permissions it says it lacks, and why it needs each; null until it has said. */
  missing: MissingPermissionShown[] | null;
}

/** A fact of "done enough" that could not be read, and why, as a code: `unreadable`, its records could not be read (RPE's log has what failed). */
export interface FactNotKnown {
  known: false;
  why: "unreadable";
}

/** How exact a value or a fact is. */
export type FactPrecision = "exact" | "approximate" | "vague" | "unknown";

/** Where a value or a fact came from. */
export type FactSource = "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented";

/** How sure a value or a fact is. */
export type FactStanding = "established" | "proposed" | "assumed";

/** One file of a turn's folder, by its path below the folder, as text. */
export interface FileReply {
  name: string;
  text: string;
}

/** A file's name switched off or on again in the `off:` list of a level's config: the global level's, or a chat's, which names the chat. */
export interface FileSwitchAsk {
  level: "global" | "chat";
  chat?: string | null;
  off: boolean;
}

/** The whole text of a file, written as the user at a level (for a file of another level, the user's own file of its name there); a chat's level names the chat. */
export interface FileWriteAsk {
  level: LayerLevel;
  chat?: string | null;
  text: string;
}

/** What writing a file or switching its name answers: the file as the listing now shows it. */
export interface FileWrittenReply {
  file: TreeFileRow | null;
}

/** Why the file host stopped before it had looked everywhere, each way it did with its counts: at the cap on hits with more there, past files too large to search, at lines cut to a length, or out of time. */
export interface FindStopped {
  /** The hits reached `max`, the host's own cap, and more were there. */
  limit?: { max: number };
  /** A search passed over `files` files larger than `bytes` bytes. */
  large?: { files: number; bytes: number };
  /** A search cut `lines` of the lines it gave to `chars` characters each. */
  cut?: { lines: number; chars: number };
  /** It ran out of the `ms` milliseconds it was given. */
  time?: { ms: number };
}

/** Where RPE's fold of a chat differs from today's: at a swipe (its message and number) or at the chat's head; the values that differ, by path; and whether today's state there is kept as the turn's start. */
export interface FoldDifference {
  at: { message: string; swipe: number } | "head";
  turn: TurnId;
  values: string[];
  kept: boolean;
}

/** One entry of a turn's folder: its path below the folder, its size (a folder's is what its files hold), and whether it is a folder. */
export interface FolderEntry {
  name: string;
  bytes: number;
  folder: boolean;
}

/** The whole of a turn's folder, every level down; none for a turn that has no folder. Where the file host stopped short of the whole folder, what it found, and how it stopped. */
export interface FolderReply {
  files: FolderEntry[];
  /** How the file host stopped short of the whole folder; absent when it listed it all. */
  stopped?: FindStopped;
}

/** An entry of the Author's horizon, as the store keeps it: as the Author wrote it, with the level of the world it names now (none: words that name nothing). */
export interface HorizonEntryRow {
  at: string;
  ref: string | null;
  name: string | null;
}

/** One of the install's facts, which the command line sets and no page writes: its key in config.json, what it is, its value, and where it was given (config.json, the environment, or where the install put the data folder). */
export interface InstallFact {
  key: string;
  name: string;
  value: JsonValue;
  from: "config.json" | "environment" | "install";
}

/** The job as it stands after the cancel; one that had already ended comes back as it ended. */
export interface JobCancelReply {
  job: JobView;
}

/** Limits of one job's own run, each holding only where it is tighter than the setting's: model calls, tokens sent, tokens written, tokens together as the day's job tokens are counted, seconds, and the tokens at which the job is held and the owner asked whether to go on. */
export interface JobLimits {
  calls?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
  time?: number;
  askAt?: number;
}

/** The user's jobs (of every chat, or of one) as RPH last kept each, the newest started first. */
export interface JobsReply {
  jobs: JobView[];
}

/** Where a job stands. */
export type JobState = "queued" | "held" | "running" | "asking" | "done" | "failed" | "cancelled" | "off-path" | "interrupted";

/** A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, the limit it ended at, what its start named and gave, what it was not given, what it wrote, the job it repeats, and where it asks. */
export interface JobView {
  id: string;
  agent: string;
  brief: string;
  state: JobState;
  scope: Scope;
  startedBy: AgentRef | "user";
  started: number;
  ended?: number;
  usage: Usage;
  report?: string;
  limit?: LimitHit;
  /** The attachments its start named, by name. */
  attach?: string[];
  /** The limits of its own its start gave. */
  limits?: JobLimits;
  /** The names in attach nobody could find. */
  missing?: string[];
  /** Each write it made, its sub-agents' included, in order. */
  wrote?: JobWrite[];
  /** For a job the owner started again: the job it repeats. */
  repeats?: string;
  /** For a job that asks: the ask point it reached, and the tokens it had spent when it did. */
  asks?: { at: number; tokens: number };
}

/** A write a job made: the tool, the lane it writes to where it names one, and the first line of the tool's own answer. */
export interface JobWrite {
  tool: string;
  lane?: string;
  line: string;
}

/** What a route that takes a turn's id answers, with status 409, for a turn that was joined to another: the turn asked for and the turn it joined, which is the one to ask for. */
export interface JoinedAnswer {
  joined: { turn: TurnId; joined: TurnId };
}

/** A new key of a kind, shown once; with `key`, the text of a key the caller made, which Lumiverse had to hold before RPE did. */
export interface KeyAsk {
  /** Which key. */
  kind: "provider" | "web";
  /** The key's own text, in the form its kind's keys have. */
  key?: string;
}

/** A key as it was made: shown this once, and kept only as its hash. */
export interface KeyMade {
  /** Which key. */
  kind: "provider" | "web";
  /** The key itself. */
  key: string;
  /** When it was made, epoch milliseconds. */
  made: number;
  /** When it runs out, epoch milliseconds; null: it has no end. */
  ends: number | null;
}

/** A level of the agents' tree: what ships, the user's own, a character's, a chat's. */
export type LayerLevel = "shipped" | "global" | "character" | "chat";

/** A plain statement recorded about a level, with how exact and how sure it is and where it came from; never merged into the level's values. */
export interface LevelFact {
  id: string;
  about: string;
  key: string;
  value: string;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  source: FactSource | null;
  by: string | null;
  turn: TurnId;
  n: number;
  replacedBy?: string;
  replacedAt?: number;
}

/** What a level of the world's tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere). */
export type LevelKind = "world" | "place" | "entity" | "groups" | "elsewhere";

/** The change that last wrote a value: its turn, by id and by its number on the chat's path, and how exact, how sure and from where. */
export interface LevelMark {
  turn: TurnId;
  n: number;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  source: FactSource | null;
}

/** A level of the world's tree as the world route shows it. */
export interface LevelNode {
  ref: string;
  kind: LevelKind;
  /** Its name in the data; null for the groups and for what is elsewhere. */
  name: string | null;
  /** An entity's kind, by its label; null for any other level. */
  what: string | null;
  reflection: LevelReflection;
  values: LevelValue[];
  facts: LevelFact[];
  children: string[];
  parent: string | null;
}

/** What is beneath a level, made from recorded values. */
export interface LevelReflection {
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

/** One value of a level: its key, its value as text (null: none), where it comes from when it is not the level's own (a game system that keeps it, or the level above that sets it), and the change that last wrote it. */
export interface LevelValue {
  key: string;
  value: string | null;
  from?: { system?: string; ref?: string; name?: string };
  mark?: LevelMark;
}

/** A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs or its throttle. */
export interface LimitHit {
  limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "depth" | "agents" | "jobs" | "callTokensIn" | "callTokensOut" | "callTime" | "toolRounds" | "repeats" | "tokensPerMinute";
  per: "turn" | "agent" | "job" | "day" | "connection";
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
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "released"; at: number; data: ReplyReleased } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string } };

/** What the live socket sends a page: that following a chat began, with the number of the chat's last event then; a chat's events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent. */
export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };

/** The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than liveSocket.queueEvents holds for it. */
export interface LiveMissed {
  from: number;
  to: number;
}

/** How Lumiverse activated an entry: always on, by one of its keys, by meaning, or still in force from an earlier turn. */
export type LoreActivation = "constant" | "keyword" | "vector" | "sticky";

/** What the command line keeps of RPE's Lumiverse: its sign-in in the secrets file (null forgets it), and values of the config's `lumiverse` block. */
export interface LumiverseSave {
  /** The sign-in to keep; null forgets the one kept; left out, it is not touched. */
  signIn?: { username: string; user: string; token: string; savedAt: number } | null;
  /** Values of the config's `lumiverse` block (url, user, database, connection, models); null takes one out. */
  set?: { [key: string]: string | string[] | null };
  /** Where RPE listens, as the swap takes it from today's runtime. */
  listens?: { address: string; port: number };
}

/** A memory's tier: top of mind, short term, long term. */
export type MemoryBand = "top" | "short" | "long";

/** A memory, with its tier, strength (0 to 1) and whether it has faded to its gist, at story time at the reading (none while struck). */
export interface MemoryRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  tier: MemoryBand | null;
  strength: number | null;
  faint: boolean;
}

/** Messages from `from` to `to`, both kept, as the chat numbers them from 0. */
export interface MessageStretch {
  from: number;
  to: number;
}

/** One chat as the last run left it: what came of it and why it was not imported; the turns imported of its own; the messages it shares with the chat it was made from; its check against today's fold (matched at the head and at how many swipes, where it differed, and where its swipes were placed); and what the run carried of it. */
export interface MigrationChatRow {
  chat: string;
  outcome: ChatImportOutcome;
  why: string | null;
  turns: number;
  shares: { chat: string; messages: number } | null;
  check: { matched: { head: boolean; swipes: number; of: number }; differences: FoldDifference[]; placed: { own: number; shown: number; lost: number; head: number } };
  /** What the run that imported it carried of it, over its whole path (a document the migration kept as JSON); null for a chat no run of this build imported. */
  carried: JsonValue | null;
}

/** The Migration page's data, in one read: the last real run's report and its text as the run printed it; each chat's check, what came of it and what was carried of it; the backup with its checksum, and whether it is still there; what is waiting on the user; the steps of going back with the permissions the previous build asks for; and what today's build put in Lumiverse. */
export interface MigrationReply {
  /** Null before any run. */
  report: MigrationReportShown | null;
  text: string | null;
  chats: MigrationChatRow[];
  /** The backup the last run took before it wrote anything. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  /** In the order the plan lists it: GUIDANCE.md first. */
  waiting: WaitingOnUser[];
  goingBack: { steps: string[]; permissions: string[] };
  /** What today's build put in Lumiverse, left as it is until the user says they will not go back. */
  lumiverse: JsonValue | null;
}

/** The last real run's report as the run printed it, whole (counts and checksums, never content): the page reads of it what became of each world in Build; every other field is the migration's own document, carried as JSON. */
export interface MigrationReportShown {
  format: JsonValue;
  at: JsonValue;
  mode: JsonValue;
  layout: JsonValue;
  database: JsonValue;
  rows: JsonValue;
  items: JsonValue;
  notClassified: JsonValue;
  chats: JsonValue;
  unreadable: JsonValue;
  unsent: JsonValue;
  runtime?: JsonValue;
  standIn: JsonValue;
  lumiverse: JsonValue;
  disk: JsonValue;
  underWay: JsonValue;
  imports: JsonValue;
  backup: JsonValue;
  landed: JsonValue;
  carried: JsonValue;
  worldsInStore: JsonValue;
  worldsInBuild?: WorldsInBuildShown;
  changes: JsonValue;
  refusals: JsonValue;
}

/** A mind file a migration carried, word for word (null: its row holds no text), with its filed mark. */
export interface MindFileRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  file: string;
  /** The file's text as carried, every byte; null where its row holds none. */
  text: string | null;
  filed: boolean;
}

/** A permission RPE's extension in Lumiverse lacks, and why it needs it. */
export interface MissingPermissionShown {
  permission: string;
  why: string;
}

/** A figure of a model the Connections page asks for where nobody has given it. */
export type ModelFigure = "contextWindow" | "maxTokens" | "pictures";

/** One limit of a model, in tokens, and where it came from. */
export interface ModelLimit {
  tokens: number;
  from: "user" | "pi" | "connection";
}

/** A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it; and the figures nobody has given, in the order the page asks for them. */
export interface ModelLimits {
  contextWindow: ModelLimit | null;
  maxTokens: ModelLimit | null;
  pictures: ModelPictures | null;
  asked: ModelFigure[];
}

/** A model's figures as entered or reported: its context window and its longest answer, in tokens, and whether it takes pictures. */
export interface ModelLimitsEntry {
  contextWindow?: number;
  maxTokens?: number;
  pictures?: boolean;
}

/** Whether a model takes pictures, and where that came from. */
export interface ModelPictures {
  takes: boolean;
  from: "user" | "pi" | "connection";
}

/** A note file of a chat: its path in the chat's view, its size now (0 for one no longer there), and how many times agents wrote it in turns. */
export interface NoteRow {
  path: string;
  bytes: number;
  writes: number;
}

/** A chat's largest notes, and those agents rewrote most. */
export interface NotesReply {
  largest: NoteRow[];
  rewritten: NoteRow[];
}

/** A panel's request: what was pressed, and what it was pressed on, where it was pressed on something. */
export interface PanelRequestAsk {
  what: string;
  /** What it was pressed on; left out, null or blank, nothing. */
  on?: string | null;
}

/** A request a panel made, held as part of the player's next message: what was pressed, and what it was pressed on. */
export interface PanelRequestHeld {
  id: string;
  what: string;
  on: string | null;
  at: number;
}

/** A perception, with the turn it is of and that turn's reply. */
export interface PerceptionRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: EntryWriteRow[];
  of: { turn: TurnId; message: number | null };
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

/** The chat whose old turn folders are pruned. */
export interface PruneAsk {
  chat: string;
}

/** What pruning a chat's old turn folders took away: of how many folders, how many files, how many bytes. */
export interface PrunedShown {
  folders: number;
  files: number;
  bytes: number;
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

/** A run's reply began to go out to the chat: the run, by RPH's own id for it, and when, epoch ms. */
export interface ReplyReleased {
  run: string;
  at: number;
}

/** What a run sent to the chat: the reply's text, and the progress lines of its thinking block. */
export interface ReplySoFar {
  text: string;
  progress: string[];
}

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
  error?: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string };
  usage: Usage;
}

/** One run of a turn: its first, or a continue of it, which runs the turn again under a run id of its own; or a Settle now run on it. */
export interface RunShown {
  /** RPE's own id for it. */
  id: string;
  /** RPH's own id for it, which its trace records carry as their `run`; null before its first record. */
  run: string | null;
  /** Its place among the turn's runs, from 1. */
  nth: number;
  kind: TurnRunKind;
  status: TurnState;
  timings: TurnMoments;
  usage: Usage;
  /** What this run sent to the chat. */
  reply: ReplySoFar;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string } | null;
  /** What stopped it where it stood; null for neither a limit nor the hold. */
  stoppedBy: StoppedBy | null;
  /** What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line. */
  lastText: boolean;
  /** Its own trace records, numbered from 1 within the run, as far as the read reaches (the turn's `trace`). */
  trace: TraceRecord[];
  /** The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call, each named by its path below the folder. */
  requests: { agent: string; definition: string; call: number; file: string }[];
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

/** Each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); every setting; and the install's facts. */
export interface SettingsReply {
  chat: string | null;
  files: ({ level: LayerLevel; file: string; problem: string | null })[];
  settings: SettingView[];
  facts: InstallFact[];
}

/** A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`. */
export interface SettingsWrite {
  level: LayerLevel;
  chat?: string | null;
  key: string;
  value?: JsonValue;
  none?: boolean;
}

/** One of RPH's shapes of a value: a whole number or a number, at least `least` and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names. */
export type SettingTakes = { type: "whole"; least: number; most?: number } | { type: "number"; least: number; most?: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };

/** A setting as the Settings page shows it. */
export interface SettingView {
  /** As a config file writes it; a per-connection setting's names the connection. */
  key: string;
  /** What the page calls it. */
  name: string;
  /** One line on what it does. */
  about: string;
  /** When a change to it is in force. */
  effect: Effect;
  /** The same, in words: at its next use, from the next turn, from RPE's next start. */
  effectWords: string;
  /** Its row of Appendix D.1; null for a value beyond D.1, listed for the owner's approval. */
  row: string | null;
  /** The value in force; for a setting every level of which applies, all of theirs together. */
  value: JsonValue;
  default: JsonValue;
  /** The level whose file decides the value in force; null where no file does, and the default holds. */
  from: LayerLevel | null;
  /** That level's file, as the Files page names it. */
  file: string | null;
  /** What each level's file sets, farthest first; a level that sets nothing is left out. */
  set: { level: LayerLevel; file: string; value: JsonValue }[];
  /** Every level's value applies, not the nearest alone. */
  joined: boolean;
  takes: Takes;
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

/** The newest turn, and the Settle now run begun on it. */
export interface SettleReply {
  turn: TurnId;
  run: string;
}

/** What a source bound to a character points at. */
export type SourceBindingKind = "card" | "persona" | "entry" | "memory";

/** A source bound to the character, as recorded (the text stays in Lumiverse). */
export interface SourceBindingRow {
  kind: SourceBindingKind;
  ref: string;
  /** Which side of the character it defines, in the binder's words. */
  defines: string | null;
  created: number;
}

/** A stretch of a model's own writing, in milliseconds since 1970: from its first token to its last; `to` null while it began and has not ended (a run stopped inside it). */
export interface Span {
  from: number;
  to: number | null;
}

/** One part of an agent's stack: its kind, which part, the file it came from, its level, whether it sits in the opening block or comes with the briefing, its text, and the situations that hand it to the briefing; a part left out is listed with why. */
export interface StackPartRow {
  /** What the part is. */
  kind: "definition" | "instruction" | "rule" | "contract" | "guide" | "description" | "skills" | "given";
  /** Its name as `off:` lists name it; for `given`, the item as `opening:` writes it. */
  part: string;
  /** The file it came from; for a part left out as `missing`, where it would be; for `given`, the definition that names it. */
  path: string;
  level: LayerLevel;
  /** SHA-256 of the file (for `given`, of its text), lower-case hex; absent for a part left out as `missing`. */
  hash?: string;
  /** Where it sits, or for a part left out, where it would. */
  where: "opening" | "briefing";
  /** Why it is left out; absent for a part in the stack. */
  left?: "missing" | "off" | "empty" | "broken" | "needs";
  /** Its text as the agent gets it; absent when left out, and for `given` outside a session. */
  text?: string;
  /** For a part the briefing is handed: the situations that add it. */
  situations?: string[];
}

/** The exact stack an agent gets in the chat, part by part in order, each with the file it comes from, its level, and whether it sits in the opening block or comes with the briefing; a part left out is listed with why. */
export interface StackReply {
  agent: string;
  parts: StackPartRow[];
}

/** That RPE answers here, and its build: nothing more. */
export interface Status {
  name: "rpe";
  version: string;
}

/** What stopped a run where it stood, its reply going out with what it had: one of RPH's limits (calls, tokens, time), or the hold of a reply asked for whole, in milliseconds from the request's arrival. */
export type StoppedBy = { limit: LimitHit } | { hold: number };

/** True when the turn was running and is being stopped, false when it had already ended. */
export interface StopReply {
  stopped: boolean;
}

/** Each chat's folder; the user's own level and the shipped level; and RPE's database file, with its write-ahead log. */
export interface StorageReply {
  chats: ChatStorageRow[];
  /** The user's own level, the chats' folders and the shipped level apart. */
  global: number;
  shipped: number;
  /** RPE's database file, with its write-ahead log. */
  database: number;
}

/** An item of the story record as it stands on the path read: its fields, where it lies in the chat by message number (null: nowhere, or an end the record cannot place), its first write, whether it is closed or struck, and every write. */
export interface StoryItemRow {
  id: string;
  part: StoryPartName;
  /** Every field its writes set, the latest of each: messages by their number on the chat's path (`first` and `last` as `from` and `to`), a due time as the engine shows a time. */
  fields: { [key: string]: JsonValue };
  /** Where it lies in the chat, by message number: a beat's messages, a scene's or a chapter's span. Null for a part that lies nowhere, or an end the record cannot place. */
  from: number | null;
  to: number | null;
  /** Its first write: the turn. */
  turn: TurnId;
  /** That turn's reply on the path. */
  message: number | null;
  /** Whether a migration's import wrote that turn. */
  imported: boolean;
  /** Who wrote it. */
  by: string | null;
  closed: boolean;
  struck: boolean;
  /** Every write of it on the path, oldest first. */
  writes: StoryWriteRow[];
}

/** A list of the record, bounded: what it gives, how many it holds in all, and how many it left out before and after what it gives. */
export interface StoryItems {
  items: StoryItemRow[];
  total: number;
  before: number;
  after: number;
}

/** The parts the story route gives as bounded lists: every part but the one premise. */
export type StoryListName = "chapter" | "scene" | "beat" | "thread" | "arc" | "player" | "future" | "canon" | "retcon" | "record";

/** The parts of the story record. */
export type StoryPartName = "premise" | "chapter" | "scene" | "beat" | "thread" | "arc" | "player" | "future" | "canon" | "retcon" | "record";

/** The story record of a chat: the timeline, the story model's parts as recorded, the Author's horizon and the futures. */
export interface StoryReply {
  chat: string;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  /** Story time at the reading, as the engine shows a time; null where the chat keeps none. */
  now: string | null;
  /** The most items one list gives at once: the setting `story.queryItems` for the chat. */
  listed: number;
  /** Chapters and scenes by where they start, beats by where they lie; what the record cannot place last. */
  timeline: { chapter: StoryItems; scene: StoryItems; beat: StoryItems };
  /** The chapter and the scene the chat is in now; null when it is in none (none yet, or the last one is closed). */
  current: { chapter: string | null; scene: string | null };
  /** The story model's parts as recorded, in the order first written: the premise, then each list. */
  model: { premise: StoryItemRow | null; thread: StoryItems; arc: StoryItems; player: StoryItems; canon: StoryItems; retcon: StoryItems; record: StoryItems };
  horizon: HorizonEntryRow[];
  /** The futures, today's drafts among them, in the order first written. */
  futures: StoryItems;
}

/** An item of the record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says. */
export interface StoryStrikeAsk {
  id: string;
  struck: boolean;
  why?: string | null;
}

/** What a strike, or taking one back, did: whether anything was recorded, and the item as it stands now, at the chat's newest turn. */
export interface StoryStrikeReply {
  /** Whether anything was recorded: false when the item already stood so. */
  changed: boolean;
  item: StoryItemRow;
}

/** One write of an item, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said. */
export interface StoryWriteRow {
  turn: TurnId;
  /** The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind). */
  message: number | null;
  /** That turn was written by a migration's import, not played on RPE. */
  imported: boolean;
  /** Who wrote it: an agent's definition (`author`), `player`, or the migration. */
  by: string | null;
  /** What it said, as the item's fields are shown: `close` and `drop` among them. */
  wrote: { [key: string]: JsonValue };
}

/** The text as accepted, when it was edited, and the level it is written at (absent: the file's own). */
export interface SuggestionAcceptAsk {
  text?: string | null;
  level?: LayerLevel;
}

/** A suggestion accepted: it as it now stands, and the file as the listing now shows it. */
export interface SuggestionAcceptedReply {
  suggestion: SuggestionRow | null;
  file: TreeFileRow | null;
}

/** A suggestion dismissed: it as it now stands. */
export interface SuggestionDismissedReply {
  suggestion: SuggestionRow | null;
}

/** An agent's suggestion for a file: the file as the agent named it in the chat's view, the text proposed whole, and why. */
export interface SuggestionRow {
  id: number;
  chat: string;
  /** The turn it was filed in; null for one filed outside a turn. */
  turn: TurnId | null;
  agent: AgentRef;
  /** The file it would change, as the agent named it in the chat's view. */
  path: string;
  /** The proposed text, whole. */
  text: string;
  reason: string;
  at: number;
  state: SuggestionStatus;
  /** When the user accepted or dismissed it; null while open. */
  decided: number | null;
}

/** A suggestion with what it would change: from the file as it is now to the text proposed. */
export interface SuggestionShown {
  id: number;
  chat: string;
  /** The turn it was filed in; null for one filed outside a turn. */
  turn: TurnId | null;
  agent: AgentRef;
  /** The file it would change, as the agent named it in the chat's view. */
  path: string;
  /** The proposed text, whole. */
  text: string;
  reason: string;
  at: number;
  state: SuggestionStatus;
  /** When the user accepted or dismissed it; null while open. */
  decided: number | null;
  lines: DiffRow[];
}

/** A chat's suggestions (every chat's when none is named), newest first. */
export interface SuggestionsReply {
  suggestions: SuggestionShown[];
}

/** Where an agent's suggestion stands: waiting on the user, accepted, or dismissed. */
export type SuggestionStatus = "open" | "accepted" | "dismissed";

/** Switch the named thing on or off. */
export interface SwitchAsk {
  /** Which. */
  state: "on" | "off";
}

/** The switched entry, or null with what is listed when nothing of that name is. */
export interface Switched {
  /** The entry as it stands now; null where nothing of that name is listed. */
  entry: SwitchEntry | null;
  /** Every name listed, with its state. */
  listed: ({ name: string; state: "waiting" | "on" | "off" })[];
}

/** A thing that runs a command or calls out, and where it stands. */
export interface SwitchEntry {
  /** Its name. */
  name: string;
  /** What sort of thing it is. */
  kind: string;
  /** Exactly what it runs or calls. */
  what: string;
  /** Whether it may run. */
  state: "waiting" | "on" | "off";
  /** When this definition was first listed. */
  listed: number;
  /** When the command line last switched it; null if never. */
  changed: number | null;
}

/** The hash of the provider key today's connection holds, which RPE takes over at the swap. */
export interface TakenKeyAsk {
  /** The key's SHA-256, in hex. */
  hash: string;
}

/** What a level may set a setting to: one of RPH's shapes; a table of names, each to a value of `of` (with `whole`, such a value alone for every name); or a list of records, each holding every field. */
export type Takes = SettingTakes | { type: "table"; of: SettingTakes; whole?: true } | { type: "records"; fields: readonly { name: string; takes: SettingTakes; about: string }[] };

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
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; session: string; given: string[] } | { kind: "intent_began" } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "connection_wait"; connection: string; for: "minute" | "place"; ms?: number } | { kind: "connection_stand_in"; named: string; used: string } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; closing: boolean; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "hook"; hook: string; on: "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end"; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "paused"; call: number } | { kind: "resumed"; call: number; ms: number } | { kind: "said"; call: number; text: string } | { kind: "released"; release: Release } | { kind: "progress_missing"; time: number } | { kind: "compacted"; session: string; before: number; after: number; keptTurns: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened"; from?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };

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

/** A file's differences: from the shipped file of its name to this one; and what the update that changed the shipped file since this one was written changed of it. */
export interface TreeDiffReply {
  path: string;
  /** The shipped file of the same name; null when there is none, or the file is the shipped one. */
  shipped: string | null;
  /** From the shipped file to this one, line by line; none without a shipped file. */
  lines: DiffRow[];
  /** The update that changed the shipped file since this one was last written: when, and from the shipped file before it to the shipped file now. */
  update: { at: number; lines: DiffRow[] } | null;
}

/** What a file of the tree is: one the user writes, a note an agent keeps, or one RPE makes again. */
export type TreeFileKind = "yours" | "notes" | "generated";

/** One file of the tree, as text. */
export interface TreeFileReply {
  path: string;
  level: LayerLevel;
  kind: TreeFileKind;
  bytes: number;
  editable: boolean;
  text: string;
}

/** One file of the agents' tree as the Files page lists it: its path in the chat's view, its level and kind, its size, whether RPH takes it, and what stands beside it at other levels. */
export interface TreeFileRow {
  /** Its path in the chat's view, as the file routes take it: `@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder. */
  path: string;
  level: LayerLevel;
  kind: TreeFileKind;
  bytes: number;
  /** The name RPH loads it by, and an `off:` list names it by; null for a file RPH does not load by its name. */
  item: string | null;
  /** Whether RPH takes it: a named file when it is the nearest of its name, not switched off and not an example; any other file as it is. */
  applies: boolean;
  /** The nearer file of the same name taken in its place; null when none is. */
  replacedBy: string | null;
  /** Its name is in a config's `off:` list, which switches it off at every level. */
  off: boolean;
  /** The levels whose config's `off:` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing. */
  offIn: LayerLevel[];
  /** Whether the user may write it where it is: never a shipped file or a generated one. */
  editable: boolean;
  /** The shipped file of the same name, for a file of another level that has one; null otherwise. */
  shipped: string | null;
  /** For a file of the user's in place of a shipped one: when an update changed that shipped file, if it did since this file was last written; null otherwise. */
  defaultChanged: number | null;
}

/** Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own. */
export interface TreeListingReply {
  files: TreeFileRow[];
}

/** A turn's id: the id RPE gives a turn when it begins it. */
export type TurnId = string;

/** What a generation asks for. */
export type TurnKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";

/** The lore Lumiverse activated for a turn's prompt, in the order the turn's tag lists it; none for a turn RPE holds no tag for. */
export interface TurnLoreReply {
  entries: TurnLoreRow[];
}

/** An entry Lumiverse activated for a turn's prompt: its lore map id, its id and its book's id in Lumiverse, its title, and how it activated where the turn's tag says. */
export interface TurnLoreRow {
  /** The id the Author's lore map gives the entry: `e-` and its number. */
  id: string;
  /** Lumiverse's id of the entry. */
  entry: string;
  /** Lumiverse's id of its book; empty where the tag does not say. */
  book: string;
  /** Its title as Lumiverse gave it. */
  title: string;
  /** How it activated; null where the tag does not say. */
  how: LoreActivation | null;
}

/** When a turn's moments happened, in milliseconds since 1970; null for one that has not happened. */
export interface TurnMoments {
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
  /** The intent record's own time, its first token to its last; null when none began; to null when it began and did not end. */
  intent: Span | null;
  /** Each span of thinking before a model call's first output on the reply's path, in call order; none when no call thought. */
  thinking: Span[];
}

/** One turn, read on from where a page has read to, and each of its runs. */
export interface TurnReply {
  id: TurnId;
  kind: TurnRunKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnState;
  timings: TurnMoments;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
  chat: string;
  /** The lead's intent record as it was written (plan §10.3); null when it wrote none. Shown behind the spoiler gate. */
  intent: string | null;
  /** What its latest run sent to the chat so far. */
  reply: ReplySoFar;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string } | null;
  /** Its runs' events as far as the read reaches, in order: of the run asked for (the turn's first when none), those numbered `from` on; and every record of each run that began after it. */
  trace: TraceRecord[];
  /** The lore of the turn's prompt, by id, as its intake kept it: the entries Lumiverse activated for it (Lumiverse's ids), and the entries its lore map showed the Author (RPE's ids, as the map writes them). */
  lore: { activated: string[]; map: string[] };
  /** Each of its runs, the first first. */
  runs: RunShown[];
}

/** A turn as a chat's list shows it. */
export interface TurnRow {
  id: TurnId;
  kind: TurnRunKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnState;
  timings: TurnMoments;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
}

/** A run's kind: the kind of turn Lumiverse asked for, or a Settle now run, where the player asked the Author to settle an edit now and nothing is written to the chat. */
export type TurnRunKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate" | "settle";

/** A chat's turns, newest first. */
export interface TurnsReply {
  turns: TurnRow[];
  /** Older turns remain. */
  more: boolean;
}

/** Where a turn or a run stands: running, or how it ended. */
export type TurnState = "running" | "released" | "no-reply" | "stopped" | "limit" | "failed";

/** Today's Undo of a tap, as the previous build's Undo chip sends it: `{ lre: 1, type: "lre.chip", reqId, chatId, chip, choice: "undo" }`, the chip being the tap's id. */
export interface UndoAsk {
  lre: 1;
  type: "lre.chip";
  reqId: string;
  chatId: string;
  /** The tap's id: `tap:<turn>:<tap>`, the turn it was recorded on and its own id there. */
  chip: string;
  choice: "undo";
  payload?: { [key: string]: JsonValue };
}

/** Model calls and their tokens: sent (cached ones included), read from and written to the cache, written, and of those the reasoning. */
export interface Usage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
}

/** One thing the last run left waiting on the user, by what it is. */
export type WaitingOnUser = { kind: "guidance"; path: string } | { kind: "connection"; setting: string; connection: string } | { kind: "chat"; chat: string; questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean } | { kind: "own"; agents: number; skills: number; texts: number } | { kind: "filing"; chat: string; characters: number; notes: boolean } | { kind: "world"; world: string; name: string | null };

/** The level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn. */
export interface WorldReply {
  at: string;
  nodes: LevelNode[];
}

/** What a run did with each world it carried into Build's own copy, by the world's id: copied in, replaced (Build's copy was still a run's), unchanged, or kept as RPE has it (changed or made there); of those kept, which are newer on today's side too; and each world's name as today's index gives it. The last two are absent from a report kept before runs told them. */
export interface WorldsInBuildShown {
  copied: string[];
  replaced: string[];
  unchanged: string[];
  kept: string[];
  newer?: string[];
  names?: { [key: string]: string };
}

/** Every route in the form that answers in JSON, by its method and path pattern: its params, its query, its body, its reply, and whether it pages. */
export interface ApiRoutes {
  /** Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another; says which started and which were refused, and why. */
  "POST /api/v1/bootstrap": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: BootstrapBatchAsk;
    reply: BootstrapBatchReply;
    paged: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: Build's page sends one of today's messages as it sends it to the extension's backend, and is answered with today's answer and the pushes the request caused. */
  "POST /api/v1/build": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: FrontendToBackend;
    reply: BuildTunnelReply;
    paged: false;
    joined: false;
  };
  /** The chats RPE played, the most recently played first, then the chats its store holds that it has not played (a migration's), by name. */
  "GET /api/v1/chats": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ChatsReply;
    paged: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: a panel's action as a page sends it, answered with today's `lre.result` or `lre.error`. */
  "POST /api/v1/chats/:chat/actions": {
    params: { chat: string };
    query: Record<string, never>;
    body: FrontendToBackend;
    reply: ResultMessage | ErrorMessage;
    paged: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: the Undo of a tap, sent as the previous build's Undo chip is, answered with today's `lre.result` or `lre.error`; a tap of a turn joined to another is answered with the turn it joined. */
  "POST /api/v1/chats/:chat/actions/undo": {
    params: { chat: string };
    query: Record<string, never>;
    body: UndoAsk;
    reply: ResultMessage | ErrorMessage;
    paged: false;
    joined: true;
  };
  /** A chat's bootstrap: the six facts of "done enough", and the chat's bootstrap jobs, oldest first, each with how it stands or ended. */
  "GET /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: BootstrapChatReply;
    paged: false;
    joined: false;
  };
  /** Starts a chat's bootstrap job (taking on a story with a past), with the player's choice of what to relive; a start that is refused is answered in words, with nothing started. */
  "POST /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: BootstrapStartAsk;
    reply: JobView;
    paged: false;
    joined: false;
  };
  /** Every character a chat knows, with what each holds on the path read: at the chat's newest turn, or as it stood at one of its turns. */
  "GET /api/v1/chats/:chat/cast": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: CastReply;
    paged: false;
    joined: true;
  };
  /** Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns. */
  "GET /api/v1/chats/:chat/cast/:character": {
    params: { chat: string; character: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: CharacterReply;
    paged: false;
    joined: true;
  };
  /** Strikes an entry of a character's record, or takes its strike back, as the player's own change on the chat's newest turn; says what it did, in the cast's words. */
  "POST /api/v1/chats/:chat/cast/:character/strike": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: CastStrikeAsk;
    reply: CastStrikeReply;
    paged: false;
    joined: false;
  };
  /** The user's jobs of one chat, as RPH last kept each, the newest started first. */
  "GET /api/v1/chats/:chat/jobs": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobsReply;
    paged: false;
    joined: false;
  };
  /** Holds a panel's request as part of the player's next message, for the turn that answers it. */
  "POST /api/v1/chats/:chat/requests": {
    params: { chat: string };
    query: Record<string, never>;
    body: PanelRequestAsk;
    reply: { request: PanelRequestHeld };
    paged: false;
    joined: false;
  };
  /** Settle now: a run on the chat's newest turn that writes nothing into the chat; answers the turn and the run begun, or a refusal in the turn-errors part's words. */
  "POST /api/v1/chats/:chat/settle": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: SettleReply;
    paged: false;
    joined: false;
  };
  /** A chat's state view, at its head or as it stood at one of its turns, in the shape the previous build's pages take. */
  "GET /api/v1/chats/:chat/state": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: StateView;
    paged: false;
    joined: true;
  };
  /** A chat's story record, at its newest turn or as it stood at one of its turns: the timeline, the story model's parts, the Author's horizon and the futures; each list bounded by the story's own setting, read further back with `part` and `skip`. */
  "GET /api/v1/chats/:chat/story": {
    params: { chat: string };
    query: { turn?: TurnId; part?: StoryListName; skip?: number };
    body: undefined;
    reply: StoryReply;
    paged: false;
    joined: true;
  };
  /** Strikes an item of the story record, or takes its strike back, as the player's own change on the chat's newest turn; says whether anything was recorded and the item as it stands. */
  "POST /api/v1/chats/:chat/story/strike": {
    params: { chat: string };
    query: Record<string, never>;
    body: StoryStrikeAsk;
    reply: StoryStrikeReply;
    paged: false;
    joined: false;
  };
  /** A chat's turns, newest first, each with what its runs spent together; `before` is a turn's id, and older ones follow it. */
  "GET /api/v1/chats/:chat/turns": {
    params: { chat: string };
    query: { limit?: number; before?: TurnId };
    body: undefined;
    reply: TurnsReply;
    paged: false;
    joined: true;
  };
  /** One turn, read on from where a page has read to: its intent record, what went to the chat, the lore of its prompt, its runs' records from the record numbered `from` of the run named, and each of its runs. */
  "GET /api/v1/chats/:chat/turns/:turn": {
    params: { chat: string; turn: string };
    query: { run?: string; from?: number };
    body: undefined;
    reply: TurnReply;
    paged: false;
    joined: true;
  };
  /** The whole of a turn's folder, every level down, each entry with its size; none for a turn that has no folder. */
  "GET /api/v1/chats/:chat/turns/:turn/files": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: FolderReply;
    paged: false;
    joined: true;
  };
  /** One file of a turn's folder, by its path below the folder, as text; no path leaves the folder. */
  "GET /api/v1/chats/:chat/turns/:turn/files/*": {
    params: { chat: string; turn: string; "*": string };
    query: Record<string, never>;
    body: undefined;
    reply: FileReply;
    paged: false;
    joined: true;
  };
  /** The lore Lumiverse activated for a turn's prompt, in the tag's order: each entry's lore map id, its id and book in Lumiverse, its title and how it activated where the tag says; none for a turn RPE holds no tag for, or one of another chat. */
  "GET /api/v1/chats/:chat/turns/:turn/lore": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: TurnLoreReply;
    paged: false;
    joined: true;
  };
  /** Stops a turn going on now; says whether it was running. */
  "POST /api/v1/chats/:chat/turns/:turn/stop": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: StopReply;
    paged: false;
    joined: true;
  };
  /** The world's tree for a chat: the level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn. */
  "GET /api/v1/chats/:chat/world": {
    params: { chat: string };
    query: { at?: string; depth?: number; values?: "none" | "own" | "all"; turn?: TurnId };
    body: undefined;
    reply: WorldReply;
    paged: false;
    joined: true;
  };
  /** The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered. */
  "GET /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionsShown;
    paged: false;
    joined: false;
  };
  /** Adds a connection, with its key when it has one. */
  "POST /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
    joined: false;
  };
  /** Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null. */
  "PUT /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
    joined: false;
  };
  /** Removes a connection, and its key. */
  "DELETE /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    joined: false;
  };
  /** Makes a connection the default. */
  "PUT /api/v1/connections/:id/default": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    joined: false;
  };
  /** Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits. */
  "POST /api/v1/connections/:id/test": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionTested;
    paged: false;
    joined: false;
  };
  /** Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own. */
  "GET /api/v1/files": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: TreeListingReply;
    paged: false;
    joined: false;
  };
  /** A file's difference from the shipped file of its name, and what the update that changed the shipped file since it was written changed of it. */
  "GET /api/v1/files-diff/*": {
    params: { "*": string };
    query: { chat?: string };
    body: undefined;
    reply: TreeDiffReply;
    paged: false;
    joined: false;
  };
  /** Switches a file's name off or on again in the `off:` list of a level's config, which is what "Delete" on a shipped file does; says the file as the listing now shows it. */
  "PUT /api/v1/files-off/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FileSwitchAsk;
    reply: FileWrittenReply;
    paged: false;
    joined: false;
  };
  /** Prunes a chat's old turn folders as the chat's retention setting says, never while a turn of it is going on; says what it took away. */
  "POST /api/v1/files-prune": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: PruneAsk;
    reply: { pruned: PrunedShown };
    paged: false;
    joined: false;
  };
  /** The exact stack an agent gets in a chat, part by part, with the file each comes from. */
  "GET /api/v1/files-stack": {
    params: Record<string, never>;
    query: { chat: string; agent: string };
    body: undefined;
    reply: StackReply;
    paged: false;
    joined: false;
  };
  /** One file of the tree, as text. */
  "GET /api/v1/files/*": {
    params: { "*": string };
    query: { chat?: string };
    body: undefined;
    reply: TreeFileReply;
    paged: false;
    joined: false;
  };
  /** Writes a file's whole text as the user at a level (for a file of another level, the user's own file of its name there); says the file as the listing now shows it. */
  "PUT /api/v1/files/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FileWriteAsk;
    reply: FileWrittenReply;
    paged: false;
    joined: false;
  };
  /** Removes a file of the user's; for one in place of a default, that is resetting to the default. */
  "DELETE /api/v1/files/*": {
    params: { "*": string };
    query: { chat?: string };
    body: undefined;
    reply: { removed: string };
    paged: false;
    joined: false;
  };
  /** The user's jobs, of every chat, as RPH last kept each, the newest started first. */
  "GET /api/v1/jobs": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: JobsReply;
    paged: false;
    joined: false;
  };
  /** Cancels a job; one that has ended already is given as it ended. */
  "POST /api/v1/jobs/:job/cancel": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobCancelReply;
    paged: false;
    joined: false;
  };
  /** The Migration page's data: the last run's report and its printed text, each chat's check, the backup, what waits on the user, and the steps of going back. */
  "GET /api/v1/migration": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: MigrationReply;
    paged: false;
    joined: false;
  };
  /** Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, the level and file it comes from, when a change takes effect and what it does. */
  "GET /api/v1/settings": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: SettingsReply;
    paged: false;
    joined: false;
  };
  /** Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands. */
  "PUT /api/v1/settings": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SettingsWrite;
    reply: SettingsReply;
    paged: false;
    joined: false;
  };
  /** Says that RPE answers here, and its build; nothing more, and no work to say it. */
  "GET /api/v1/status": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: Status;
    paged: false;
    joined: false;
  };
  /** When RPE started, and the builds that meet at it, its app file read again. */
  "GET /api/v1/status/builds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsReply;
    paged: false;
    joined: false;
  };
  /** How RPE's extension in Lumiverse last said it stands with RPE. */
  "GET /api/v1/status/extension": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ExtensionStatusReply;
    paged: false;
    joined: false;
  };
  /** Whose the page's credential is, and when it ends. */
  "GET /api/v1/status/session": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: SessionReply;
    paged: false;
    joined: false;
  };
  /** What the tree takes: each chat's folder by area, the user's own level, the shipped level, and RPE's database file. */
  "GET /api/v1/storage": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: StorageReply;
    paged: false;
    joined: false;
  };
  /** A chat's largest notes, and those agents rewrote most. */
  "GET /api/v1/storage/notes": {
    params: Record<string, never>;
    query: { chat: string; limit?: number };
    body: undefined;
    reply: NotesReply;
    paged: false;
    joined: false;
  };
  /** A chat's suggestions from the agents (every chat's when none is named), newest first, each with what it would change. */
  "GET /api/v1/suggestions": {
    params: Record<string, never>;
    query: { chat?: string; state?: SuggestionStatus };
    body: undefined;
    reply: SuggestionsReply;
    paged: false;
    joined: false;
  };
  /** Accepts a suggestion as it is or edited, writing it as the user at a level; says the suggestion as it now stands and the file. */
  "POST /api/v1/suggestions/:id/accept": {
    params: { id: string };
    query: Record<string, never>;
    body: SuggestionAcceptAsk;
    reply: SuggestionAcceptedReply;
    paged: false;
    joined: false;
  };
  /** Dismisses a suggestion; says the suggestion as it now stands. */
  "POST /api/v1/suggestions/:id/dismiss": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: SuggestionDismissedReply;
    paged: false;
    joined: false;
  };
  /** "Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands. */
  "POST /api/v1/update": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsStatus;
    paged: false;
    joined: false;
  };
}

/** The server's own command line's routes, which answer on its socket in the data folder alone (`command` access), in the same form; on that socket the routes of `ApiRoutes` that a page calls answer too, as the owner's. */
export interface CommandRoutes {
  /** Makes a new key of a kind, which retires the one before it; shown this once. */
  "POST /api/v1/command/keys": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: KeyAsk;
    reply: KeyMade;
    paged: false;
    joined: false;
  };
  /** Takes over the provider key today's connection holds, by its hash alone. */
  "POST /api/v1/command/keys/taken": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: TakenKeyAsk;
    reply: void;
    paged: false;
    joined: false;
  };
  /** Keeps RPE's sign-in to Lumiverse and the config's Lumiverse block. */
  "PUT /api/v1/command/lumiverse": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: LumiverseSave;
    reply: void;
    paged: false;
    joined: false;
  };
  /** The keys in force, the switches and the builds, for `rpe status`. */
  "GET /api/v1/command/status": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: CommandStatus;
    paged: false;
    joined: false;
  };
  /** Switches a thing that runs a command or calls out on or off: the one road to it. */
  "PUT /api/v1/command/switches/:name": {
    params: { name: string };
    query: Record<string, never>;
    body: SwitchAsk;
    reply: Switched;
    paged: false;
    joined: false;
  };
}

/** Every route in the form that answers in its own way (a stream, a socket, a file), and what it answers. */
export interface RawRoutes {
  /** The extension asks whether the registration it holds is the one this RPE made. */
  "POST /api/v1/ext/confirm": {
    params: Record<string, never>;
    answers: "JSON: `{ rpe: \"confirmed\", user, relay }`, or 409 for a registration this RPE did not make";
    joined: false;
  };
  /** A page's follow of a chat's live events, carried by the extension to RPE's relay. */
  "POST /api/v1/ext/live": {
    params: Record<string, never>;
    answers: "JSON: an empty object, or 400 for a follow RPE does not read";
    joined: false;
  };
  /** The extension's question for a prompt it is about to send: which of its lore entries and messages RPE keeps, by its window and its secrecy rules. */
  "POST /api/v1/ext/question": {
    params: Record<string, never>;
    answers: "JSON, the extension's own message (`src/adapter/lumiverse/wire.ts`)";
    joined: false;
  };
  /** A page's start-up facts, asked for by the extension: a page token for the user this RPE belongs to, its end, RPE's addresses a browser may try, and its build. */
  "POST /api/v1/ext/start": {
    params: Record<string, never>;
    answers: "JSON: the page's start-up facts (`StartFacts`, `src/adapter/lumiverse/pipe-wire.ts`)";
    joined: false;
  };
  /** The live socket: a page follows chats on it, and is sent each one's events in order (the live kinds), held to the token it opened with. */
  "GET /api/v1/live": {
    params: Record<string, never>;
    answers: "a WebSocket on the protocol rpe.live; 426 when the request is not a socket's, 400 when it offers protocols and not rpe.live";
    joined: false;
  };
  /** The web app's files, to anyone who reaches RPE; what a page then does is held to its own token by the API. */
  "GET /ui/*": {
    params: { "*": string };
    answers: "a file of the built web app (its page, scripts and styles), or 404 with words saying why there is none";
    joined: false;
  };
  /** The provider endpoint: Lumiverse's chat completions, answered as the Lumiverse provider API's own (OpenAI's chat completions, streamed or whole); a reply tagged for a turn of RPE is played through the turn lane, any other is passed on. */
  "POST /v1/chat/completions": {
    params: Record<string, never>;
    answers: "an OpenAI chat completion, streamed or whole, as OpenAI answers";
    joined: false;
  };
  /** The models the provider endpoint offers, as the connection in Lumiverse lists them. */
  "GET /v1/models": {
    params: Record<string, never>;
    answers: "an OpenAI model list";
    joined: false;
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
  /** A run's reply began to go out to the chat (its first text, or the harness's release, whichever came first), told at that moment while the run may go on. */
  released: ReplyReleased;
  /** The chat's state changed, and a page reads it again. A newer one replaces one a page has not taken yet (key "state"). */
  state: Record<string, never>;
  /** An engine handler failed on a change, which is recorded as not applied: the operation, and the handler's error. */
  handler_failed: { op: string; error: string };
}

// The live socket's own constants (what a page sends on it is a LiveAsk, and what it is sent a LiveMessage, above), and the status of a joined turn's answer.
/** Where a page opens the live socket, as a WebSocket. */
export const LIVE_PATH = "/api/v1/live";
/** The protocol a page offers to open the live socket. */
export const LIVE_PROTOCOL = "rpe.live";
/** A page that cannot set the Authorization header offers its token as a second protocol: this, then the token. */
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";
/** The code RPE closes a page's live socket with once the token it opened with has run out or been replaced, with the reason "The page's token has run out or was replaced: open the live socket again with a new one." */
export const LIVE_TOKEN_ENDED = 4401;
/** The status a route that takes a turn's id answers a turn joined to another with: its answer is a `JoinedAnswer`. */
export const JOINED_STATUS = 409;
