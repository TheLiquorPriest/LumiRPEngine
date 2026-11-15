// What the pages read from RPE (plan §4.4, §14) that the generated types (`src/shared/api`, written by
// `bun run api` from the route table) do not hold yet: the shapes of the routes not yet declared in the
// route form, with what each answers, kept here by hand until their areas declare them, each held to its
// route by `test/ui/direct.test.ts`. A route in the form, the live socket and every type the generated
// file holds are taken from there and from nowhere else: the app's own routes, the settings', the
// connections', the live socket's messages and constants, and the types RPH's trace is made of.

import type { FileKind, JsonObject, ReplyError, RunStatus, StackPart } from "rp-harness/contract";
import type { AgentRef, ApiRoutes, JobView, LayerLevel, TraceRecord, TurnKind, Usage } from "../shared/api";
import type { ChipRequest, DraftChanged, ErrorMessage, FrontendToBackend, ResultMessage } from "../shared/protocol";
import type { StateView } from "../shared/state-view";

// ---------------------------------------------------------------- the app's own

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

export const STATUS_PATH = "/api/v1/status";
export const SESSION_PATH = "/api/v1/status/session";

// ---------------------------------------------------------------- chats and turns (the turn lane's)

/** A chat RPE plays, as the web shell lists them. */
export interface ChatSummary {
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

/** `GET /api/v1/chats`: the chats of the user RPE belongs to, the most recently played first. */
export interface ChatList {
  chats: ChatSummary[];
}

/** Where a turn stands: running, or how its run ended. */
export type TurnStatus = RunStatus | "running";

/** A run's kind (the turn lane's `RunKind`): the kind of turn Lumiverse asked for, or a settle run, where the player asked the Author to settle an edit now and nothing is written to the chat. */
export type RunKind = TurnKind | "settle";

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
  kind: RunKind;
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
  kind: RunKind;
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
 * takes it; the nearer file taken in its place; whether its name is switched off, and the levels whose
 * `off:` list names it (only switching it on at one of those changes anything); whether the user may
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
  offIn: LayerLevel[];
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
  | { kind: "filing"; chat: string; characters: number; notes: boolean }
  | { kind: "world"; world: string; name: string | null };

/**
 * What a run did with each world it carried into Build's own copy, by the world's id: copied in, replaced
 * (Build's copy was still a run's), unchanged, or kept as RPE has it (changed or made there); of those
 * kept, which are newer on today's side too; and each world's name as today's index gives it. The last
 * two are absent from a report kept before runs told them.
 */
export interface WorldsInBuild {
  copied: string[];
  replaced: string[];
  unchanged: string[];
  kept: string[];
  newer?: string[];
  names?: Record<string, string>;
}

/**
 * `GET /api/v1/migration`, as far as the page reads it: the last run's report as the run printed it
 * (null before any run), and of the report whole, what became of each world in Build; each chat, the
 * backup (where, its size and checksum, whether a file of that size is still there), what is waiting on
 * the user, and the steps of going back with the permissions the previous build asks for. The route
 * also sends the rest of the report and what was carried of each chat; the page shows the report as its
 * printed text.
 */
export interface MigrationShown {
  report: { worldsInBuild?: WorldsInBuild } | null;
  text: string | null;
  chats: MigrationChat[];
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  waiting: MigrationWaiting[];
  goingBack: { steps: string[]; permissions: string[] };
}

// ---------------------------------------------------------------- the cast (the cast's, plan §7, §14 Cast)

/** How large a part a character plays. */
export type Casting = "principal" | "supporting" | "extra";
/** A memory's tier: top of mind, short term, long term. */
export type MemoryTier = "top" | "short" | "long";
/** The base's four documents. */
export type BasePart = "seed" | "soul" | "inner_voice" | "background";
/** What a source bound to a character points at. */
export type CastSourceKind = "card" | "persona" | "entry" | "memory";
/** The parts of a character's record kept as rows tied to turns, the casting aside. */
export type CastEntryPart = "growth" | "mind" | "relationship" | "knowledge" | "history" | "perception" | "memory";
/** The parts of a character's record that hold entries, as the cast counts them. */
export type CastKind = "growth" | "mind" | "memories" | "relationships" | "knowledge" | "history" | "perceptions" | "files";

/** How many entries of a kind a character holds on the path read: standing, and struck. */
export interface CastHeld {
  held: number;
  struck: number;
}

/** Each kind's counts; the carried mind files with how many of those standing are marked filed. */
export type CastCounts = Record<Exclude<CastKind, "files">, CastHeld> & { files: CastHeld & { filed: number } };

/** A casting in force: the player's pin, else the Author's; with the Author's line for the character, where it wrote one. */
export interface CastingShown {
  as: Casting;
  pinned: boolean;
  line: string | null;
}

/** A character as the cast lists it: its casting (null: none yet), where its record came from (carried by a migration, played on RPE), and its counts. */
export interface CastMemberShown {
  id: string;
  name: string;
  chat: string;
  casting: CastingShown | null;
  from: { carried: boolean; played: boolean };
  counts: CastCounts;
}

/** `GET /api/v1/chats/:chat/cast?turn=`: every character the chat knows; `turn` null: at the chat's newest. */
export interface CastList {
  chat: string;
  turn: string | null;
  characters: CastMemberShown[];
}

/** One write of an entry: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said. */
export interface CastWriteShown {
  turn: string;
  message: number | null;
  imported: boolean;
  by: string | null;
  wrote: JsonObject;
}

/** An entry of a character's record as it stands on the path read: its fields, story time of its first write, its first write, whether it is struck, and every write of it. */
export interface CastEntryShown {
  id: string;
  part: CastEntryPart;
  fields: JsonObject;
  date: string | null;
  turn: string;
  message: number | null;
  imported: boolean;
  by: string | null;
  struck: boolean;
  writes: CastWriteShown[];
}

/** A memory, with its tier, strength (0 to 1) and whether it has faded to its gist; none while struck. */
export interface CastMemoryShown extends CastEntryShown {
  tier: MemoryTier | null;
  strength: number | null;
  faint: boolean;
}

/** A perception, with the turn it is of and that turn's reply. */
export interface CastPerceptionShown extends CastEntryShown {
  of: { turn: string; message: number | null };
}

/** A mind file a migration carried, word for word (null: its row holds no text), with its filed mark. */
export interface CastFileShown extends CastEntryShown {
  file: string;
  text: string | null;
  filed: boolean;
}

/** A version of a part of the base; `standing` marks the one in force. */
export interface CastBaseShown {
  part: BasePart;
  version: number;
  text: string;
  standing: boolean;
  turn: string | null;
  by: string | null;
  created: number;
}

/** A source bound to the character, as recorded. */
export interface CastSourceShown {
  kind: CastSourceKind;
  ref: string;
  defines: string | null;
  created: number;
}

/** `GET /api/v1/chats/:chat/cast/:character?turn=`: everything on one character's record, by kind. */
export interface CastCharacter {
  chat: string;
  turn: string | null;
  character: CastMemberShown;
  sources: CastSourceShown[];
  base: CastBaseShown[];
  castings: CastWriteShown[];
  growth: CastEntryShown[];
  mind: CastEntryShown[];
  memories: CastMemoryShown[];
  relationships: CastEntryShown[];
  knowledge: CastEntryShown[];
  history: CastEntryShown[];
  perceptions: CastPerceptionShown[];
  files: CastFileShown[];
}

/** `POST /api/v1/chats/:chat/cast/:character/strike`: an entry struck (true) or its strike taken back (false), with why where the player says. */
export interface CastStrike {
  id: string;
  struck: boolean;
  why?: string;
}

/**
 * What a strike, or taking one back, did: whether anything was recorded, the entry now, the knowledge struck with it, the secrets let
 * go (by their fact's id); for a strike taken back, the knowledge standing again with it and the secrets held again; and what it
 * could not do, in the cast's words.
 */
export interface CastStruck {
  changed: boolean;
  entry: CastEntryShown;
  alsoStruck: string[];
  letGo: string[];
  alsoStood: string[];
  heldAgain: string[];
  notes: string[];
}

// ---------------------------------------------------------------- the story record (the story's, plan §8.1, §14 Story)

/** The parts of the story record. */
export type StoryPart = "premise" | "chapter" | "scene" | "beat" | "thread" | "arc" | "player" | "future" | "canon" | "retcon" | "record";
/** The parts the story route gives as bounded lists: every part but the one premise. */
export type StoryListPart = Exclude<StoryPart, "premise">;

/** One write of an item: as a cast entry's write. */
export interface StoryWriteShown {
  turn: string;
  message: number | null;
  imported: boolean;
  by: string | null;
  wrote: JsonObject;
}

/** An item of the story record on the path read: its fields, where it lies in the chat by message number (null: nowhere, or an end the record cannot place), its first write, whether it is closed or struck, and every write. */
export interface StoryItemShown {
  id: string;
  part: StoryPart;
  fields: JsonObject;
  from: number | null;
  to: number | null;
  turn: string;
  message: number | null;
  imported: boolean;
  by: string | null;
  closed: boolean;
  struck: boolean;
  writes: StoryWriteShown[];
}

/** A bounded list: what it gives, how many it holds in all, and how many it left out before and after what it gives. */
export interface StoryList {
  items: StoryItemShown[];
  total: number;
  before: number;
  after: number;
}

/** An entry of the Author's horizon: as written, with the level of the world it names now (null: none). */
export interface StoryHorizonEntry {
  at: string;
  ref: string | null;
  name: string | null;
}

/** `GET /api/v1/chats/:chat/story?turn=&part=&skip=`: the story record of a chat; `listed` is the most one list gives at once, `skip` counts back from each list's newest end. */
export interface StoryAnswer {
  chat: string;
  turn: string | null;
  now: string | null;
  listed: number;
  timeline: { chapter: StoryList; scene: StoryList; beat: StoryList };
  current: { chapter: string | null; scene: string | null };
  model: { premise: StoryItemShown | null; thread: StoryList; arc: StoryList; player: StoryList; canon: StoryList; retcon: StoryList; record: StoryList };
  horizon: StoryHorizonEntry[];
  futures: StoryList;
}

/** `POST /api/v1/chats/:chat/story/strike`: an item struck (true) or its strike taken back (false). */
export interface StoryStrike {
  id: string;
  struck: boolean;
  why?: string;
}

export interface StoryStruck {
  changed: boolean;
  item: StoryItemShown;
}

// ---------------------------------------------------------------- Settle now and the bootstrap (the turn lane's, plan §10, §12)

/** `POST /api/v1/chats/:chat/settle` (no body): the newest turn, and the settle run begun on it; a refusal comes in the turn's own words. */
export interface SettleAnswer {
  turn: string;
  run: string;
}

/** `GET /api/v1/jobs` and `GET /api/v1/chats/:chat/jobs`: the user's jobs (of every chat, or of one) as RPH last kept each, the newest started first; a refusal ("This RPE runs no jobs.") comes in RPE's words. */
export interface JobList {
  jobs: JobView[];
}

/** `POST /api/v1/jobs/:job/cancel` (no body): the job as it stands after; one that had already ended comes back as it ended. */
export interface JobCancelled {
  job: JobView;
}

/** A fact of "done enough" that could not be read, and why, as a code: `unreadable`, its records could not be read (RPE's log has what failed). */
export interface NotKnown {
  known: false;
  why: "unreadable";
}

/** A fact read from its records: its counts and names. Whether it holds is the bootstrap skill's to say, never the route's. */
export type BootstrapFact<T> = ({ known: true } & T) | NotKnown;

/** Messages from `from` to `to`, both kept, numbered from 0. */
export interface Stretch {
  from: number;
  to: number;
}

/** The six facts of "done enough", in the order the bootstrap skill names them. */
export interface DoneEnough {
  lore: BootstrapFact<{ entries: number; indexed: number; stale: number }>;
  history: BootstrapFact<{ messages: number; leftOut: number; covered: number; stretches: number; summarized: number; nearestUncovered: Stretch | null; nearestUnsummarized: Stretch | null }>;
  cast: BootstrapFact<{ listed: number; cast: number; uncast: string[] }>;
  story: BootstrapFact<{ premise: number; chapters: number; scenes: number; beats: number; threads: number; openThreads: number; arcs: number; principals: number; principalsWithArc: number; player: number }>;
  horizon: BootstrapFact<{ entries: number; named: number; clock: boolean }>;
  principals: BootstrapFact<{ principals: { id: string; name: string; base: string[]; memories: number }[] }>;
}

/** A bootstrap job of a chat: what it was given (the player's relive word, the token limit), and its view as RPH gives it (null: RPH no longer holds it). */
export interface BootstrapJob {
  id: string;
  relive: string | null;
  tokenLimit: number;
  view: JobView | null;
}

/** `GET /api/v1/chats/:chat/bootstrap`: the six facts, and the chat's bootstrap jobs, oldest first. */
export interface BootstrapChat {
  chat: string;
  facts: DoneEnough;
  jobs: BootstrapJob[];
}

/** `POST /api/v1/bootstrap`: each chat started, with its job's view, and each refused, with why. */
export interface BootstrapBatch {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}

// ---------------------------------------------------------------- the route map the client is typed by, for the routes not yet in the form

/** A route's reply, its query and its body. */
export interface RouteShape<Reply, Query extends Record<string, string | number | undefined> = Record<string, never>, Body = undefined> {
  reply: Reply;
  query: Query;
  body: Body;
}

/** Every route the pages call that is not yet declared in the route form, by method and path pattern, as the route table writes them; `*` stands for the rest of the path. */
export interface Routes {
  "GET /api/v1/status/extension": RouteShape<ExtensionStatus>;
  "GET /api/v1/chats": RouteShape<ChatList>;
  "GET /api/v1/chats/:chat/turns": RouteShape<TurnList, { limit?: number; before?: string }>;
  "GET /api/v1/chats/:chat/turns/:turn": RouteShape<TurnDetail, { from?: number }>;
  "POST /api/v1/chats/:chat/turns/:turn/stop": RouteShape<StopAnswer>;
  "GET /api/v1/chats/:chat/turns/:turn/files": RouteShape<TurnFiles>;
  "GET /api/v1/chats/:chat/turns/:turn/files/*": RouteShape<TurnFile>;
  "GET /api/v1/chats/:chat/world": RouteShape<WorldAnswer, { at?: string; depth?: number; values?: ValuesShown; turn?: string }>;
  "POST /api/v1/build": RouteShape<{ result: ResultMessage | ErrorMessage; pushes: DraftChanged[] }, Record<string, never>, FrontendToBackend>;
  "GET /api/v1/chats/:chat/state": RouteShape<StateView, { turn?: string }>;
  "POST /api/v1/chats/:chat/actions": RouteShape<ResultMessage | ErrorMessage, Record<string, never>, FrontendToBackend>;
  "POST /api/v1/chats/:chat/actions/undo": RouteShape<ResultMessage | ErrorMessage, Record<string, never>, ChipRequest>;
  "GET /api/v1/files": RouteShape<TreeListing, { chat?: string }>;
  "GET /api/v1/files/*": RouteShape<TreeFileText, { chat?: string }>;
  "PUT /api/v1/files/*": RouteShape<FileWritten, Record<string, never>, FileWrite>;
  "DELETE /api/v1/files/*": RouteShape<{ removed: string }, { chat?: string }>;
  "PUT /api/v1/files-off/*": RouteShape<FileWritten, Record<string, never>, FileSwitch>;
  "GET /api/v1/files-diff/*": RouteShape<TreeFileDiff, { chat?: string }>;
  "GET /api/v1/suggestions": RouteShape<SuggestionList, { chat?: string; state?: SuggestionState }>;
  "POST /api/v1/suggestions/:id/accept": RouteShape<SuggestionAccepted, Record<string, never>, SuggestionAccept>;
  "POST /api/v1/suggestions/:id/dismiss": RouteShape<SuggestionDismissed>;
  "GET /api/v1/migration": RouteShape<MigrationShown>;
  "GET /api/v1/storage": RouteShape<TreeStorage>;
  "GET /api/v1/storage/notes": RouteShape<NoteFiles, { chat: string; limit?: number }>;
  "POST /api/v1/files-prune": RouteShape<{ pruned: Pruned }, Record<string, never>, { chat: string }>;
  "GET /api/v1/files-stack": RouteShape<AgentStack, { chat: string; agent: string }>;
  "GET /api/v1/chats/:chat/cast": RouteShape<CastList, { turn?: string }>;
  "GET /api/v1/chats/:chat/cast/:character": RouteShape<CastCharacter, { turn?: string }>;
  "POST /api/v1/chats/:chat/cast/:character/strike": RouteShape<CastStruck, Record<string, never>, CastStrike>;
  "GET /api/v1/chats/:chat/story": RouteShape<StoryAnswer, { turn?: string; part?: StoryListPart; skip?: number }>;
  "POST /api/v1/chats/:chat/story/strike": RouteShape<StoryStruck, Record<string, never>, StoryStrike>;
  "POST /api/v1/chats/:chat/settle": RouteShape<SettleAnswer>;
  "GET /api/v1/chats/:chat/bootstrap": RouteShape<BootstrapChat>;
  "POST /api/v1/chats/:chat/bootstrap": RouteShape<JobView, Record<string, never>, { relive?: string }>;
  "POST /api/v1/bootstrap": RouteShape<BootstrapBatch, Record<string, never>, { chats: string[] | "migrated"; relive?: string }>;
  "GET /api/v1/jobs": RouteShape<JobList>;
  "GET /api/v1/chats/:chat/jobs": RouteShape<JobList>;
  "POST /api/v1/jobs/:job/cancel": RouteShape<JobCancelled>;
}

/** Every route the pages call: those in the form, as the generated types write them, and those above. */
export type RouteKey = (keyof ApiRoutes | keyof Routes) & string;
