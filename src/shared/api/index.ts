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

/** The chat whose open session starts its opening block afresh. */
export interface ApplyNowAsk {
  chat: string;
}

/** What "Apply now" did: the session whose opening block starts afresh with the next run of each agent, or none when no session is open, and what that means in words. */
export interface ApplyNowReply {
  session: string | null;
  note: string;
}

/** Whether RPE took the build, and where it stands, in words. */
export interface Arrived {
  /** Whether RPE took the build: every file matched, and it starts. */
  taken: boolean;
  /** Where it stands. */
  words: string;
}

/** A file of the backups folder: its name, its kind (a copy of the database taken before a new version's migrations, an archive `rpe backup` made, or the migration's backup of today's data), its size and when it was made. */
export interface BackupShown {
  name: string;
  kind: "copy" | "migration" | "archive";
  bytes: number;
  at: number;
}

/** The backups folder's files, newest first, and where the folder is. */
export interface BackupsReply {
  folder: string;
  items: BackupShown[];
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

/** The turns and jobs running now. */
export interface Busy {
  /** How many turns and jobs run now. */
  busy: number;
}

/** The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call. */
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}

/** Why a tool call never ran: a limit spent before it started, past the most tool calls one answer of its agent may make, the thing it calls out to not switched on for the user, its lane set to Never, the user's no with his reason, a rule that held it, or a permission or rule that could not be asked. */
export type CallRefusal = { by: "limit"; hit: LimitHit } | { by: "answer"; max: number } | { by: "switch"; thing: { kind: "hook" | "rule-command" | "command-tool" | "mcp-server" | "http-tool" | "connection"; name: string; target: string }; state: "on" | "waiting" | "off" } | { by: "never"; lane: string } | { by: "declined"; lane: string; reason?: string } | { by: "hold"; rule: string } | { by: "unasked"; error: string };

/** One text an old engine's record of a reply names, kept word for word beside its turn: the part of the record that names it, where it was in today's user storage, and its words (null where today's clean-up had removed it). */
export interface CarriedText {
  part: string;
  path: string;
  text: string | null;
}

/** What an old engine recorded on a reply the migration carried, for the reply's Turn page: the engine that played the chat, each part of the record by name, every text it names, why the reply stood with no turn played, and each line where it says something against its turn. */
export interface CarriedTurnReply {
  turn: TurnId;
  chat: string;
  message: string;
  swipe: number;
  /** The engine that played the chat as today's build had it; null where it was not read. */
  engine: "classic" | "agents" | "harness" | null;
  /** The record's parts that hold what an old engine recorded (session, agents, memoryNext, finalEdits, finalParts, prompts, diag, harness), by name, as they were. */
  fields: { name: string; value: JsonValue }[];
  texts: CarriedText[];
  /** Why the reply stood with no turn played (stopped, failed, restarted); null where a turn was played. */
  unplayed: string | null;
  /** Each line where the reply says something against what its turn decided. */
  departures: string[];
}

/** A page of a migrated chat's carried turns, in the order the run imported them: each tied to its message and swipe, with the engine that played it, why it stood unplayed, how many departures and texts it holds. `more` says whether turns follow. */
export interface CarriedTurnsReply {
  turns: ({ turn: TurnId; message: string; swipe: number; engine: "classic" | "agents" | "harness" | null; unplayed: string | null; departures: number; texts: number })[];
  total: number;
  more: boolean;
}

/** How much of a scene's earlier turns its next turn carries: what the Author did in them (continuing), its record of each (records), or only the summary the scene opened with (nothing). */
export type CarryMode = "continuing" | "records" | "nothing";

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

/** A message of a chat as Lumiverse holds it: its place (`index_in_chat`, with a gap where one was deleted), who said it, the text the prompt is built from, the swipe it shows, whether it is hidden, and Lumiverse's revision of it. */
export interface ChatMessageShown {
  /** Lumiverse's id of the message. */
  id: string;
  /** Its chat's id. */
  chat: string;
  /** Lumiverse's `index_in_chat`: a gap where a message was deleted. */
  index: number;
  /** Who said it. */
  role: "user" | "assistant" | "system";
  /** The name it was said under. */
  name: string;
  /** The text the prompt is built from. */
  text: string;
  /** The swipe it shows. */
  swipe: number;
  /** How many swipes it has. */
  swipes: number;
  /** Hidden from the prompt. */
  hidden: boolean;
  /** When it was sent, epoch milliseconds. */
  sentAt: number;
  /** Lumiverse's revision of it: an edit raises it. */
  revision: number;
}

/** The messages of a chat asked for, in the chat's order. */
export interface ChatMessagesReply {
  messages: ChatMessageShown[];
}

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
  /** When RPE heard that Lumiverse deleted the chat, epoch milliseconds; its session files are gone and its other files stay until he prunes them. */
  deleted?: number | null;
  /** What the chat's rows take of the database, by the length of its rows in every table that carries the chat. */
  rows?: number;
  /** When the sizes were last checked against the disk, epoch milliseconds; null for a chat not measured yet, whose sizes are then none and come at the next read. */
  measured?: number | null;
}

/** A generation RPE's extension stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read. */
export interface CheckStoppedShown {
  /** When, epoch milliseconds by the extension's clock. */
  at: number;
  chat: string;
  /** The generation; null where Lumiverse had not announced it. */
  generation: string | null;
  connection: string;
  /** How the read of RPE's registration from the extension's storage failed. */
  registration: string;
  /** How the read of the connection's own record in Lumiverse failed. */
  mark: string;
}

/** How RPE stands as its own command line is told: the keys in force, the switches and the builds in words. */
export interface CommandStatus {
  /** Each key in force: the provider key by its last four characters (null for one taken from today's connection, whose were never known), when it was made and, for the web token, when it ends; never a key's text. */
  keys: ({ kind: "provider" | "extension" | "web"; last4: string | null; made: number; ends: number | null; taken: boolean })[];
  /** Every user's own switches, each name's newest definition. */
  switches: SwitchEntry[];
  /** The builds that meet at RPE in a sentence or two; null where the server does not say. */
  builds: string | null;
}

/** A compaction of a session: its summary, the turn whose work it was, what it stands for, why it was made, its size before and after in tokens, and whether it still stands; one he undid is marked. */
export interface CompactionShown {
  id: string;
  turn: string;
  summary: string;
  at: number;
  of: "turns" | "run";
  turns: string[];
  reason?: "would-not-fit" | "refused" | "asked" | "fold";
  before?: number;
  after?: number;
  stands: boolean;
  undone?: true;
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
  key: { set: boolean; waiting?: boolean } | null;
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

/** Something the lead allowed to be invented (plan §10.5): who allowed it, for whom, how (its own write, or its answer to a sub-agent), what, within what bounds, and the gap check it rests on. */
export interface ConsentGrant {
  id: string;
  by: AgentRef;
  to?: AgentRef;
  via: { kind: "write"; tool: string; callId: string } | { kind: "answer"; callId: string };
  topic: string;
  bounds?: string;
  /** The gap check it rests on; absent when none was cited. */
  gapCheck?: string;
}

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

/** What a turn's time brought due, soonest first, as many as the chat's engine.dueItems lists, and how many more fell due (null: more did, uncounted). */
export interface DueReply {
  turn: TurnId;
  /** The turn's span as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
  more: number | null;
}

/** One thing a turn's time brought due: its kind, what it is, when it fell due as the world prints it, the level it concerns (null where none), and the turn's changes recorded for it (null while none were). */
export interface DueShown {
  kind: string;
  words: string;
  when: string;
  at: string | null;
  outcome: string | null;
}

/** One field of the World page's edit: a value or a fact at a level (world, place:<id>, entity:<id>), set or removed, with how exact and how sure he says a fact is. */
export interface EditOpAsk {
  op: "set" | "remove";
  at: string;
  key: string;
  as: "value" | "fact";
  value?: string;
  precision?: "exact" | "approximate" | "vague" | "unknown";
  standing?: "established" | "proposed" | "assumed";
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
  /** Its first write: the turn; null where the player wrote it, his own change of no turn, placed after the newest reply. */
  turn: TurnId | null;
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
  /** The turn that wrote it; null for the player's own change, of no turn, placed after the newest reply. */
  turn: TurnId | null;
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
  /** The generations it stopped because it could not tell whose chat they were: the latest, and how many since RPE started; null when none. */
  stopped: { last: CheckStoppedShown; count: number } | null;
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

/** A file or folder of the user's to rename, move or copy: its path in the chat's view, and the path it goes to, which nothing stands at; a chat's level names the chat. */
export interface FileMoveAsk {
  chat?: string | null;
  from: string;
  to: string;
}

/** Where a file or folder went: its path, the file as the listing now shows it (none for a folder), and the kind of guidance it now is when it went into a folder of one. */
export interface FileMovedReply {
  path: string;
  file: TreeFileRow | null;
  /** The kind of guidance the place is a folder of: a file moved into `rules/` is a rule; null for any other. */
  guidance: GuidanceKind | null;
}

/** A file pinned for an agent, or the pin taken away, in the `pins:` list of a level's config: the global level's, or a chat's, which names the chat. */
export interface FilePinAsk {
  level: "global" | "chat";
  chat?: string | null;
  /** The agent, by its definition's name. */
  agent: string;
  pinned: boolean;
}

/** Every pin the levels' configs hold for a chat, the file and the agent each names, with whether the file is in the chat's view now and whether a definition names the agent: a pin of a file that is gone or of an agent no definition names is listed as such, never dropped. */
export interface FilePins {
  pins: ({ file: string; agent: string; level: LayerLevel; fileFound: boolean; agentNamed: boolean | null })[];
}

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

/** A folder of the user's to make, by its path in the chat's view; a chat's level names the chat. */
export interface FolderAsk {
  chat?: string | null;
  path: string;
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

/** A gap check run (plan §10.5): who ran it, on what, by which names and words, each place it searched with what came back there, and where its evidence was saved. */
export interface GapCheck {
  id: string;
  by: AgentRef;
  topic: string;
  terms: string[];
  searched: ({ where: string; hits: ({ ref: string; title: string; snippet: string; how: "words" | "meaning" })[] })[];
  saved?: string;
}

/** A kind of guidance a folder of the tree holds: the agents' definitions, skills, rules, hooks, prompt parts or tools. */
export type GuidanceKind = "agents" | "skills" | "rules" | "hooks" | "prompts" | "tools";

/** An entry of the Author's horizon, as the store keeps it: as the Author wrote it, with the level of the world it names now (none: words that name nothing). */
export interface HorizonEntryRow {
  at: string;
  ref: string | null;
  name: string | null;
  /** How deep the world state shows it: a whole number of levels, or `full`. */
  depth: number | "full";
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

/** What a job he started was told as it went. */
export interface JobToldReply {
  job: string;
  told: TurnTold;
}

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

/** How long a kind is kept: for good, until the chat is deleted or he prunes it, or by a setting, which gives its key and what it is now (null: none, all kept). */
export type KeptFor = { by: "never" } | { by: "chat" } | { by: "setting"; setting: string; value: number | null };

/** One message of a model call's request as it was sent: its role, its text, and the block the harness placed it as (`opening`, `frame`, `prompt`, `session:carry`, `briefing`, a given name, `brief`); none for the run's own conversation. */
export interface KeptMessage {
  role: string;
  text: string;
  /** The block it was placed as; absent for the run's own conversation. */
  block?: string;
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
  /** What falls due beneath it in the time ahead: how many (null: more than one, uncounted), the minutes until the soonest, and its kind; null when nothing does, or the reading passed no due source. */
  due: { n: number | null; after: number; kind: string } | null;
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

/** What a page sends on the live socket: to follow a chat's events from its next one, or to stop; in `chat`, a chat's id, or ~jobs for the user's jobs, ~user for his own events, or ~to: and an address RPE gave the caller. */
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

/** One event as the live socket sends it: of a chat (or of ~jobs, ~user, or an address), numbered from 1 for each, of one of the kinds the socket carries, with that kind's data; an event of a kind declared with a key carries it. */
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "released"; at: number; data: ReplyReleased } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string; turn: string; change: number | null } } | { chat: string; seq: number; kind: "requests"; at: number; data: { waiting: number } } | { chat: string; seq: number; kind: "extension"; at: number; data: ExtensionStatusReply };

/** What the live socket sends a page: that following a chat (or a name) began, with the number of its last event then; its events in order, with the numbers of those the hub dropped before them for a page that fell behind; or why it did not take what the page sent. */
export type LiveMessage = { type: "following"; chat: string; seq: number } | { type: "events"; chat: string; events: LiveEvent[]; missed?: LiveMissed } | { type: "refused"; message: string };

/** The first and the last number of the events the hub dropped before a batch, for a page that fell behind further than liveSocket.queueEvents holds for it. */
export interface LiveMissed {
  from: number;
  to: number;
}

/** Where RPH found each slice of the preset's map in a turn's prompt: each slice's marker, kind, places and length; the text that belongs to no slice; the notices of what changed since the turn before; and how much of the prompt's front stayed the same. */
export interface LocatedSlices {
  preset: { id: string; name?: string; revision?: string } | null;
  slices: { marker: string; kind: SliceKind; at: { message: number; start: number; end: number }[]; length: number; hash: string }[];
  unclaimed: { message: number; start: number; end: number }[];
  notices: PromptNotice[];
  /** The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held. */
  front: { length: number; brokenBy?: string };
}

/** How Lumiverse activated an entry: always on, by one of its keys, by meaning, or still in force from an earlier turn. */
export type LoreActivation = "constant" | "keyword" | "vector" | "sticky";

/** A proposal as it now stands, and the write its approval made. */
export interface LoreApproved {
  /** The proposal, approved. */
  proposal: LoreProposal;
  /** The one write the approval made. */
  write: LoreWrite;
}

/** The user's books as his choice of the books the lore reads lists them. */
export interface LoreBooks {
  /** Every book of his, the engine's own left out. */
  books: ({ id: string; name: string; attached: boolean; character: boolean; added: number | null })[];
}

/** An entry's fields RPE writes: its text, its title and its keys. */
export interface LoreEntryFields {
  /** The entry's text. */
  content: string;
  /** Its title. */
  comment: string;
  /** Its keys. */
  keys: string[];
}

/** The indexing job the owner started. */
export interface LoreIndexJob {
  /** Its id in the jobs. */
  job: string;
  /** Its state as RPH keeps it. */
  state: string;
}

/** An entry of a chat's lore with what the database holds of it and what the index says of it: the user's own lines where he wrote them, else the latest indexing run's, an earlier revision's marked stale. */
export interface LoreIndexRow {
  /** The id the lore map gives the entry: `e-` or `w-` and its number. */
  id: string;
  /** Its title. */
  title: string;
  /** Its book's name, or its world's. */
  source: string;
  /** Its book's id in Lumiverse; null for a world entry. */
  book: string | null;
  /** The keys that activate it. */
  keys: string[];
  /** Characters in its text. */
  size: number;
  /** How it comes into the prompt by itself; none for one that never does. */
  activation: ("constant" | "keyword" | "vector")[];
  /** Its revision: Lumiverse's for a book entry, a hash of its words for a world entry. */
  revision: string;
  /** What kind of thing it is, where a run or the user has said. */
  kind: string | null;
  /** One line saying what it is, where a run or the user has said. */
  line: string | null;
  /** What it defines. */
  defines: { what: string; aspect: string }[];
  /** Related entries, by id. */
  related: string[];
  /** The fields beside those that the indexer's file asks an index line to hold, by name. */
  fields: { [key: string]: string | string[] };
  /** Whether a run has written lines for the entry as it stands now. */
  indexed: boolean;
  /** Whether the lines shown were written for an earlier revision of it. */
  stale: boolean;
  /** Which of the lines are the user's own. */
  edited: ("kind" | "line" | "defines" | "related")[];
  /** What the entry is bound to: each binding in force, the owner's over an indexing run's, and the world's own pins of it, each to a record by its id. */
  links: ({ record: string; linked: boolean; aspect: string; by: "run" | "casting" | "bootstrap" | "owner" | "pin" })[];
}

/** Where a chat's lore indexing stands, and what it runs on: how many entries the chat's lore holds, how many no run has indexed as they stand now, and the model the indexer's definition runs on. */
export interface LoreIndexStatus {
  /** Entries in the chat's lore. */
  entries: number;
  /** Entries no run has written lines for as they stand now. */
  unindexed: number;
  /** The definition indexing runs as. */
  agent: string;
  /** The connection the definition runs on: the one it names, else his default; null where none is there. */
  connection: { id: string; name: string } | null;
  /** That connection's model; null where none resolves. */
  model: string | null;
}

/** The overlays on a chat's path: the Author's notes that the story has moved past part of an entry, each tied to the turn that wrote it. */
export interface LoreOverlays {
  /** In the path's order, and within a turn in the order they were written. */
  overlays: ({ id: number; entry: string; title: string | null; note: string; turn: number; turnId: string; by: string | null; agent: string | null })[];
}

/** What applying the setting did: the book as it now stands and whether it was rewritten, or, with the setting off, the book that was taken away. */
export interface LoreProjectionRefreshed {
  /** Whether the chat's setting has it on. */
  on: boolean;
  /** Lumiverse's id of the chat's book after the press; null where there is none. */
  book: string | null;
  /** Whether the book was rewritten (false where it already held what the path says). */
  written: boolean;
  /** The book taken away because the setting is off; null where none was. */
  removed: string | null;
}

/** Whether a chat has the projection book on, and the book RPE made for it where it has. */
export interface LoreProjectionState {
  /** Whether the chat's setting `lore.projection` has it on. */
  on: boolean;
  /** Lumiverse's id of the chat's book; null where none is made. */
  book: string | null;
}

/** What an agent drafted for his lore: a new entry (the book, title and keys it drafted) or an edit to an entry of his books or his world (the passage as it stands and what would replace it), the turn it came from, and where it stands. */
export interface LoreProposal {
  /** Its number. */
  id: number;
  /** The chat it was drafted in. */
  chat: string;
  /** The turn it was drafted in; null for one of no turn. */
  turn: string | null;
  /** The definition of the agent that drafted it. */
  agent: string;
  /** The entry it edits, by the id the agent named it; null for a new entry. */
  target: string | null;
  /** The text proposed: a new entry's, or what replaces the passage (the whole entry's text where no passage is named). */
  text: string;
  /** For an edit: the passage as it stands, which `text` replaces. */
  was: string | null;
  /** For a new entry: the book the agent drafted it for. */
  book: string | null;
  /** For a new entry: the title the agent drafted. */
  title: string | null;
  /** For a new entry: the keys the agent drafted. */
  keys: string[] | null;
  /** For an entry of his world: the world's id. */
  world: string | null;
  /** Why the agent drafted it. */
  reason: string;
  /** Where it stands: open, approved, rejected, or refused because the entry changed meanwhile. */
  status: "open" | "approved" | "rejected" | "refused";
  /** For a refused one: why. The entry changed after the draft, is gone, or a draft of his own of the world stands uncommitted. */
  refused: "changed" | "missing" | "draft" | null;
  /** When it was drafted, in milliseconds since 1970. */
  created: number;
  /** When it was decided; null while open. */
  decided: number | null;
  /** The write an approval made. */
  write: number | null;
}

/** The write that put an entry back, and the write it undid as it now stands. */
export interface LorePutBack {
  /** The put-back. */
  write: LoreWrite;
  /** The write it undid, now marked put back. */
  of: LoreWrite;
}

/** A proposal as it now stands. */
export interface LoreRejected {
  /** The proposal. */
  proposal: LoreProposal;
}

/** A write RPE made to his lore, with the entry before and after, so it can be put back. */
export interface LoreWrite {
  /** Its number. */
  id: number;
  /** The proposal it settled; null for a write of his own through Build. */
  proposal: number | null;
  /** An edit of an entry, a new entry, or a put-back of an earlier write. */
  kind: "edit" | "create" | "put_back";
  /** Lumiverse's id of the entry, or for an entry of his world its key there. */
  entry: string;
  /** Its book's id in Lumiverse; empty for an entry of his world. */
  book: string;
  /** For an entry of his world: the world's id. */
  world: string | null;
  /** The entry's fields before the write; null where there was no entry. */
  before: LoreEntryFields | null;
  /** The entry's fields after the write; null where it left none. */
  after: LoreEntryFields | null;
  /** For a put-back: the write it undid. */
  of: number | null;
  /** The write that put this one back, once one has. */
  putBack: number | null;
  /** When it was made, in milliseconds since 1970. */
  at: number;
}

/** What the command line keeps of RPE's Lumiverse: its sign-in in the secrets file (null forgets it), and values of the config's `lumiverse` block. */
export interface LumiverseSave {
  /** The sign-in to keep; null forgets the one kept; left out, it is not touched. */
  signIn?: { username: string; user: string; token: string; savedAt: number } | null;
  /** Values of the config's `lumiverse` block (url, user, database, connections, models); null takes one out. */
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
  /** Its first write: the turn; null where the player wrote it, his own change of no turn, placed after the newest reply. */
  turn: TurnId | null;
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
  given?: JsonValue;
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
  /** Its first write: the turn; null where the player wrote it, his own change of no turn, placed after the newest reply. */
  turn: TurnId | null;
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

/** What no longer applies at the chat's head: the earlier reply that shows another swipe than its later turns were made on (null where none does), and each change that stopped applying. */
export interface NotAppliedReply {
  reply: { turn: string; n: number } | null;
  items: NotAppliedShown[];
}

/** A change that no longer applies on the swipes now showing: its id, its turn and that turn's number, its operation, and the codes of why. */
export interface NotAppliedShown {
  change: string;
  turn: string;
  n: number;
  op: string;
  words: string;
  reason: string;
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

/** Something a run's lead was not given, as a fact its briefing told: pictures its model does not take, or parts that are neither text nor a picture, with the messages of the prompt that held them; or a part of the briefing that could not be made, with why. */
export type NotGiven = { what: "pictures" | "parts"; messages: number[]; count: number } | { what: "world-state" | "on-stage"; error: string };

/** The proof of a page's nonce, keyed by the hash of its page token. */
export interface PageProof {
  /** HMAC-SHA-256 of the nonce, keyed by the token's hash, as lowercase hex. */
  proof: string;
}

/** A perception the player writes, corrects or strikes for a character: with `id` it corrects (or, with `drop`, strikes) that one; without, it writes a new one of the turn named (`turn`), else of the chat's newest. `knows` as an empty list says the character now knows nothing from it. His own change, placed after the newest reply. */
export interface PerceptionAsk {
  id?: string;
  /** The turn the perception is of; left out, the chat's newest. */
  turn?: TurnId;
  reach?: "whole" | "part" | "told" | "none";
  moment?: string;
  content?: string;
  missed?: string;
  knows?: string[];
  told_by?: string;
  reliability?: string;
  drop?: boolean;
  why?: string;
}

/** The perception record of a turn or a stretch of turns ending at it, oldest first: for each, who was on stage with how that was read, and which of them have a perception of it. */
export interface PerceptionRecordReply {
  chat: string;
  turns: StageTurn[];
}

/** A perception, with the turn it is of and that turn's reply. */
export interface PerceptionRow {
  id: string;
  part: EntryPart;
  /** Every field its writes set, the latest of each: its words among them, as they were written. */
  fields: { [key: string]: JsonValue };
  /** Story time of its first write, as the engine shows a time; null where the chat keeps none. */
  date: string | null;
  /** Its first write: the turn; null where the player wrote it, his own change of no turn, placed after the newest reply. */
  turn: TurnId | null;
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

/** What writing, correcting or striking a perception did: its id, the knowledge it gave, written now, the knowledge struck with it, the secrets let go, and what could not be done, in the cast's words. */
export interface PerceptionWrittenReply {
  /** The perception's id; null where nothing was written. */
  id: string | null;
  /** The perception as it stands now at the chat's newest. */
  entry: PerceptionRow | null;
  /** The knowledge written with it, by id. */
  knowledge: string[];
  /** The knowledge struck with it, by id. */
  struck: string[];
  /** The secrets whose holding it let go. */
  letGo: string[];
  /** What it left out or could not do, in the cast's words. */
  notes: string[];
}

/** Lumiverse's own clipping inside RPE's window: how many of the window's messages the prompt does not hold, and why (its memory's summary stands for them, its message limit, or the preset's context size; null where it could not be told). */
export interface PromptClipped {
  count: number;
  by: "memory" | "message-limit" | "context-size" | null;
}

/** One of his edits to the prompt map: rename a marker, merge slices under one, split one where given words begin, correct a line, change a kind. */
export type PromptEditAsk = { edit: "rename"; marker: string; to: string } | { edit: "merge"; markers: string[]; as: string } | { edit: "split"; marker: string; at: string; second: string } | { edit: "line"; marker: string; line: string } | { edit: "kind"; marker: string; to: SliceKind };

/** What changed in the prompt's shape since the turn before, or that it is not mapped or could not be told apart. */
export type PromptNotice = { kind: "changed"; marker: string } | { kind: "gone"; marker: string } | { kind: "unclaimed"; message: number; start: number; end: number } | { kind: "order"; markers: string[] } | { kind: "preset"; was: { id: string; name?: string; revision?: string } | null; now: { id: string; name?: string; revision?: string } | null } | { kind: "unmapped" } | { kind: "incomplete" };

/** The prompt map of the chat's preset as found in one turn's prompt: its slices, the text no slice claims, the turn's notices and front, whether the prompt's text could be told apart, Lumiverse's clipping, and the old engines' blocks the preset still holds. */
export interface PromptShown {
  turn: TurnId;
  preset: { id: string; name?: string; revision?: string } | null;
  /** The slices are the learned map's; false: the raw layout's, named by the chat application's blocks and by place. */
  mapped: boolean;
  /** The prompt's text could be told apart; false: slices cannot be found in some of it. */
  complete: boolean;
  slices: PromptSliceShown[];
  unclaimed: { message: number; start: number; end: number; text: string }[];
  notices: PromptNotice[];
  /** The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held. */
  front: { length: number; brokenBy?: string };
  /** Null where the window's messages are all in the prompt. */
  clipped: PromptClipped | null;
  /** The old engines' blocks the preset still holds: a block named `RPEngine · <step>` (its step), or an `{{outlet::lre_…}}` reference left in a block's text (the outlet), each with the block it stands in. */
  old: ({ kind: "block" | "outlet"; name: string; in: string })[];
}

/** A slice of the preset's map as found in a turn's prompt: its marker, kind, line and behaviour as the map has them, whether he edited it, its text and places there, how it was found, and what the chat application's breakdown said of it. */
export interface PromptSliceShown {
  marker: string;
  kind: SliceKind;
  /** One line on what it is; absent where the map has none (a slice of the raw layout). */
  line?: string;
  /** How its text goes from turn to turn; absent as for `line`. */
  behaviour?: "fixed" | "scene" | "turn";
  /** He changed it on the Prompt page; a new mapping keeps it. */
  edited?: true;
  text: string;
  length: number;
  at: { message: number; start: number; end: number }[];
  /** How it was found: by a signature of its text, by the chat application's block name, or by its place among its neighbours. */
  found?: "signature" | "block" | "place";
  /** What the chat application's own breakdown said there: it agreed with the map's finder, or the finder was corrected to it. */
  breakdown?: "confirmed" | "corrected";
  /** The breakdown's block the slice was found by. */
  hint?: string;
}

/** One turn's notices and front, as the Prompt page lists them turn by turn: its number on the chat's path (null where it is not on it now), when its request came, and Lumiverse's clipping. */
export interface PromptTurnShown {
  turn: TurnId;
  n: number | null;
  at: number;
  notices: PromptNotice[];
  /** The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held. */
  front: { length: number; brokenBy?: string };
  clipped: PromptClipped | null;
}

/** A provider the Connections page offers, how its connections may sign their calls, the APIs it speaks, whether a connection of it must give its address, and whether it makes embeddings (for a connection that signs with a key or with nothing; one signed in makes none). */
export interface ProviderOffer {
  id: string;
  name: string;
  auth: ConnectionAuth[];
  apis: string[];
  needsBaseUrl: boolean;
  embeds: boolean;
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

/** One place a prune takes from: a turn folder's snapshots, a closed session, a deleted chat's folder, a chat's decided suggestions, old note versions, a deleted chat's rows or a living chat's derived rows, or a backup; its path below the tree's folder (a backup's, its name), and the files (or rows) and bytes that go. */
export interface PruneItem {
  kind: "turn-folder" | "session" | "chat" | "suggestions" | "note-versions" | "chat-rows" | "derived-rows" | "backup";
  path: string;
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

/** A composer control's ask, for the next message: its kind, the choice made, and any words typed with it. */
export interface RequestAsk {
  kind: "depth" | "swipe";
  choice: string;
  /** Words typed with it; left out, null or blank, none. */
  words?: string | null;
}

/** The request held: it waits for the next message, in place of one of its kind that waited. */
export interface RequestHeldReply {
  request: RequestShown;
}

/** One model call's request, by its file below the turn's folder, rebuilt from the pointers the harness kept into the turn's files: every message as it was sent, in order, and each tool declared with the file its words came from. Where what is rebuilt is not what was sent, it says so and shows nothing. */
export interface RequestReply {
  name: string;
  /** What was rebuilt is what was sent, by the hash the file keeps; false where it is not, and nothing is shown. */
  same: boolean;
  /** Every message as it was sent, in order; none where `same` is false. */
  messages: KeptMessage[];
  /** Each tool declared, in order; none where `same` is false. */
  tools: { name: string; file?: string }[];
}

/** Something he asked for beside his words: a panel's tap, or a composer control (depth, swipe), with what was asked as data, whether it was played now as a message of its own, the turn it is kept with (null while it waits) and when it was made. */
export interface RequestShown {
  id: string;
  chat: string;
  kind: "panel" | "depth" | "swipe";
  asked: { action: string | null; values: { [key: string]: JsonValue }; from: "palette" | "map" | "panel" | "chip" | "send-now"; what: string; on: string | null } | { choice: string; words: string | null };
  /** Played now, as a message of its own, rather than with the next message. */
  played: boolean;
  /** The message it was sent as, where it was played now. */
  message: string | null;
  /** The turn it is kept with; null while it waits. */
  turn: TurnId | null;
  at: number;
}

/** Requests, oldest first. */
export interface RequestsReply {
  requests: RequestShown[];
}

/** The request was withdrawn. */
export interface RequestWithdrawnReply {
  withdrawn: true;
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
  reminded?: "connection";
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
  /** The message its request named: the one a new reply is written into, the reply a swipe or a regenerate writes again, or the one a continue's tag named for it to go on, a first word only. A continue is tied where Lumiverse's end names the message, the turn's `message`: where the two differ, the tag had named another; where this is null, the message was learned at the end. */
  target: string | null;
  /** A continue's own turn, which held what it changed until Lumiverse's end decided its turn, and whose folder holds its files (its requests among them): the turn id its files are read under. Null for any other run. */
  held: string | null;
  timings: TurnMoments;
  usage: Usage;
  /** What this run sent to the chat. */
  reply: ReplySoFar;
  /** What Lumiverse saved for it where that is not what was released (beyond the prefill in front and a continue's join): the saved text whole, beside `reply`; null where it is the same, or nothing is saved yet. */
  saved: string | null;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags"; limit?: LimitHit; detail?: string; agent?: string; text?: string } | null;
  /** What stopped it where it stood; null for neither a limit nor the hold. */
  stoppedBy: StoppedBy | null;
  /** What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line. */
  lastText: boolean;
  /** What its lead was not given of its prompt and its briefing, each told in its briefing; none when it was given all. */
  notGiven: NotGiven[];
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

/** How RPE runs now: under its service (the unit's name) or started by hand, since when, the addresses it listens on, the build it runs, whether its service put the known-good copy back, and where a restart stands. */
export interface ServiceHow {
  /** Under RPE's own service unit, which starts it again when it exits, or started by hand, which nothing starts again. */
  runs: "service" | "by hand";
  /** The service unit's name, where it runs as one. */
  unit: string | null;
  /** When this process started, in milliseconds since 1970. */
  since: number;
  /** The addresses it answers on: the one set for it, and this machine's loopback, which its extension reaches it by. */
  listens: string[];
  /** The build this process runs. */
  build: string;
  /** What the service's pre-start step did when a build swapped in did not come up, in words; null where it did nothing. */
  fellBack: string | null;
  restart: RestartState;
}

/** RPE's own newest log lines. */
export interface ServiceLog {
  lines: ({ at: number; level: "debug" | "info" | "warn" | "error"; message: string; area: string | null; chat: string | null; turn: string | null; job: string | null; fields: JsonValue })[];
  /** How many lines RPE keeps at most (`service.logLines`). */
  kept: number;
}

/** Each part of a turn and how long it took across the latest turns. */
export interface ServiceTimings {
  /** How many turns were taken in. */
  turns: number;
  parts: { part: string; turns: number; median: number; slowest: number; latest: number }[];
}

/** A session of RPE's web app: its token, which a browser keeps in place of the printed token, when it ends, and whose it is. After a sign-in by password for the command line or the MCP server, the Lumiverse session token too, for the client to keep as it keeps its own. */
export interface Session {
  /** The session's token: given as the bearer of every call, and traded again for a new one before it ends. */
  session: string;
  /** When it ends, epoch milliseconds. */
  ends: number;
  /** The Lumiverse user it is of. */
  user: string;
  /** Lumiverse's own session, handed back for a client that keeps one (the command line); never for the web shell. */
  lumiverse?: { token: string; username: string };
}

/** A session he closed: the session as it now stands, the scene of the story record closed with it, and the id of his change that closed the scene, which his Undo takes (both null where the record held no scene open). */
export interface SessionClosed {
  session: SessionShown;
  scene: string | null;
  change: number | null;
}

/** A session's compactions after one was undone, in the order written. */
export interface SessionCompactions {
  compactions: CompactionShown[];
}

/** A session as it now stands. */
export interface SessionOne {
  session: SessionShown;
}

/** One session with what its next turn would carry in the mode asked for (block 3 as it would go; empty where it would carry nothing) and each of its compactions in the order written. */
export interface SessionRead {
  session: SessionShown;
  carry: CarryMode;
  carried: string;
  compactions: CompactionShown[];
}

/** His Undo of a close: the change the close answered with, taken back, so the scene stands open again with its session. */
export interface SessionReopenAsk {
  change?: number;
}

/** Whose the page's credential is, and when it runs out (epoch milliseconds; null: it has no end). */
export interface SessionReply {
  user: string;
  ends: number | null;
}

/** A session as the Sessions page shows it: a scene's, a sub-agent's run, a job's run or a talk thread; open or closed, the turn that closed it (for his own close, the chat's newest turn when he closed it), a compaction asked for that waits for its next turn, and, for a scene's, the id of the story record's scene it was opened for. */
export interface SessionShown {
  id: string;
  user: string;
  chat: string;
  kind: "scene" | "agent" | "job" | "talk";
  parent?: { session?: string; turn?: string; agent: string; call: string } | { owner: true };
  agent?: string;
  offPath?: true;
  state: "open" | "closed";
  opened: number;
  closedBy?: string;
  by?: "user";
  from?: { chat: string; session: string; turn: string };
  turns: number;
  compactAsked?: true;
  scene?: string;
}

/** A turn played in a session: its number on the chat's path (none where it left the path), when RPE received it, and the runs of RPE's that ran in this session on it, oldest first. */
export interface SessionTurnRow {
  turn: TurnId;
  n: number | null;
  at: number;
  runs: string[];
}

/** A compaction to undo, by its id. */
export interface SessionUncompactAsk {
  id: string;
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

/** A sign-in started: its flow, to finish with what the user pastes back or to cancel; the address the user opens to sign in; and what to know first. */
export interface SignInStart {
  flow: string;
  url: string;
  note: string;
}

/** Where a provider's sign-in stands: signed in or not, until when its token holds (RPH renews it when a call needs it), the flow open for it, and why its last flow ended without signing in. */
export interface SignInState {
  provider: "anthropic" | "openai";
  signedIn: boolean;
  until: number | null;
  flow: string | null;
  ended: string | null;
}

/** A slice's kind, from the prompt map's fixed list. */
export type SliceKind = "instructions" | "style" | "character" | "persona" | "world" | "note" | "lore" | "history" | "other";

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
  kind: "definition" | "instruction" | "rule" | "contract" | "guide" | "closing" | "description" | "skills" | "given";
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

/** Someone on stage at a turn, by the name the stage gives; the character the cast holds by that name (null: it holds none) with its casting; and the perceptions of that turn it has, by id, struck ones left out: none listed is a gap. */
export interface StagePerson {
  name: string;
  /** The cast's character of that name; null where the cast holds none. */
  character: string | null;
  /** Its casting in force at the turn; null: none. */
  casting: CastRole | null;
  perceptions: string[];
}

/** How a turn's stage was read: from the open scene and who the state places in its place (scene), from where the owner's character stands when no scene was recorded (owner), or not recorded at all (none). */
export type StageReading = "scene" | "owner" | "none";

/** One turn of the perception record: who was on stage, how the stage was read, and each one's perceptions of that turn or none. */
export interface StageTurn {
  turn: TurnId;
  /** That turn's reply on the chat's path, from 0; null where it is on none. */
  message: number | null;
  read: StageReading;
  people: StagePerson[];
}

/** That RPE answers here, its build, and the address of the Lumiverse it belongs to (null where it is set to none): nothing more, so a client sends a saved sign-in only to its own RPE. */
export interface Status {
  name: "rpe";
  version: string;
  /** The address of the Lumiverse this RPE belongs to; null where none is set. */
  lumiverse: string | null;
}

/** What stopped a run where it stood, its reply going out with what it had: one of RPH's limits (calls, tokens, time), or the hold of a reply asked for whole, in milliseconds from the request's arrival. */
export type StoppedBy = { limit: LimitHit } | { hold: number };

/** True when the turn was running and is being stopped, false when it had already ended. */
export interface StopReply {
  stopped: boolean;
}

/** One kind RPE keeps: how many, how big, the oldest of it, and how long it is kept. */
export interface StorageKindRow {
  kind: string;
  /** How many: files, rows, folders or backups, by what the kind is. */
  count: number;
  bytes: number;
  /** When the oldest of it was made, epoch milliseconds; null where there is none. */
  oldest: number | null;
  kept: KeptFor;
}

/** Each kind RPE keeps, with its count, size, oldest and how long it is kept, and when the user last pruned. */
export interface StorageKindsReply {
  kinds: StorageKindRow[];
  /** When the user last pruned anything the page offers, epoch milliseconds; null when never. */
  lastPrune: number | null;
}

/** What to prune: a chat's old turn folders, its closed sessions' files, a deleted chat's other files, the decided suggestions past what it keeps, the note versions past how far back they are kept, a deleted chat's database rows (not while a chat made from it reads its turns), a living chat's derived rows (its snapshots, vectors and caches, made again when next needed), or the backup or copy of the database named. Without `plan` it only says what would go; with the `plan` that answer gave, it takes exactly that. */
export interface StoragePruneAsk {
  what: "turns" | "sessions" | "chat" | "backup" | "suggestions" | "versions" | "rows" | "derived";
  chat?: string | null;
  name?: string | null;
  plan?: string;
}

/** What a prune would take (its places, files and bytes, and the `plan` that stands for exactly that), or, when asked with the plan, took. */
export interface StoragePruneReply {
  plan: string;
  /** False: this is what would go. True: this went. */
  removed: boolean;
  files: number;
  bytes: number;
  items: PruneItem[];
}

/** A page of chats, each with what its folder takes by area and what its rows take of the database; the user's own level, its notes and the shipped level; and RPE's database file, with its write-ahead log and what no chat's rows take of it. */
export interface StorageReply {
  chats: ChatStorageRow[];
  /** The chat after which the next page starts: send it as `after`; null at the end. */
  next?: string | null;
  /** The user's own level, the chats' folders, the shipped level and its notes apart. */
  global: number;
  /** The global level's notes, which every chat's agents read. */
  globalNotes: number;
  shipped: number;
  /** RPE's database file, with its write-ahead log. */
  database: number;
  /** What the database takes beyond the chats' rows: the installation's own tables, and what no chat owns. The chats' rows and this add up to the database. */
  rest?: number;
}

/** An item of the record, by id, and the fields of it to correct, each as the item shows it (a message by its number, a time as the page shows it, names as a list): the player's own words, written as his own change after the chat's newest reply. */
export interface StoryCorrectAsk {
  id: string;
  /** The fields to set: the item's own, as `story_record` reads them for its part, `close` and `drop` among them. */
  fields: { [key: string]: JsonValue };
}

/** What a correction did: whether anything was recorded, what could not be read of it, and the item as it stands now, at the chat's newest turn. */
export interface StoryCorrectReply {
  changed: boolean;
  /** Each thing sent that could not be read, was left out, or did not add up, in words. */
  said: string[];
  item: StoryItemRow;
}

/** What the record covers of the whole chat: every stretch of messages with the same marks, in and out of the prompt's window, and how many messages above the window's edge it does not cover. */
export interface StoryCoverage {
  chat: string;
  /** How many messages the chat's path holds. */
  messages: number;
  /** The number of the first message the prompt's window keeps; null where it keeps them all, or none is known. */
  edge: number | null;
  /** The chat's setting: agents may read the messages the player hid, so an uncovered hidden message above the edge counts. */
  hiddenReadable: boolean;
  /** The numbers of the messages the player hid. */
  hidden: number[];
  /** How many messages above the window's edge the record does not cover: the window marker's count. */
  above: number;
  stretches: { from: number; to: number; covered: boolean; beats: boolean; summarized: boolean; window: boolean }[];
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
  /** Its first write: the turn; null when that write was the player's own change, which belongs to no turn. */
  turn: TurnId | null;
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

/** The story so far as the next briefing gives it to the Author, worked out at the chat's head: its text, its size against its budget, and what it left out. */
export interface StorySoFarReply {
  /** The block as laid out; empty when the window leaves nothing out or the record holds nothing for it. */
  text: string;
  /** Its size in tokens. */
  tokens: number;
  /** The most tokens it may fill. */
  budget: number;
  /** Each stretch it had no room for, with what of the record it holds. */
  leftOut: { from: number; to: number; chapters: number; scenes: number; beats: number }[];
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

/** A page of the timeline: chapters, scenes and beats as one list in the chat's order, oldest first. */
export interface StoryTimeline {
  items: StoryTimelineRow[];
  next: string | null;
}

/** One entry of the timeline: a chapter, a scene or a beat, with the chapter and the scene it lies in and, for a beat, the messages it stands for. */
export interface StoryTimelineRow {
  kind: "chapter" | "scene" | "beat";
  item: StoryItemRow;
  /** The id of the chapter it lies in; null for a chapter, or where none does. */
  chapter: string | null;
  /** The id of the scene it lies in; null for a chapter or a scene, or where none does. */
  scene: string | null;
  /** A beat's messages, each by its number on the chat's path and its id; empty for a chapter or a scene (their span is in `item`). */
  messages: { number: number; id: string }[];
}

/** One write of an item, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said. */
export interface StoryWriteRow {
  /** The turn it was written on; null for the player's own change, which belongs to no turn. */
  turn: TurnId | null;
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
  /** The level accepting it writes at when no level is named: its file's own, or for a shipped file the chat's. */
  level?: LayerLevel;
  /** The levels that have a place for its file, any of which accepting it may name. */
  levels?: LayerLevel[];
}

/** A chat's suggestions (every chat's when none is named), newest first. */
export interface SuggestionsReply {
  suggestions: SuggestionShown[];
}

/** Where an agent's suggestion stands: waiting on the user, accepted, or dismissed. */
export type SuggestionStatus = "open" | "accepted" | "dismissed";

/** Switch the named thing on or off, for the user it names. */
export interface SwitchAsk {
  /** Which. */
  state: "on" | "off";
  /** The user whose own it is; the user this RPE belongs to where left out. */
  user?: string;
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
  /** The user whose own it is: what is on for one user is not on for another. */
  user: string;
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

/** The page user's own switches, each name's newest definition. */
export interface SwitchesShown {
  /** Each of the user's things and where it stands. */
  switches: SwitchEntry[];
}

/** One row of a typed system's view at a level: its label, its value, a note, how exact and how sure it is where a change recorded it, and whether it is out of the player's sight. */
export interface SystemRowShown {
  label: string;
  value: string;
  note: string | null;
  precision: FactPrecision | null;
  standing: FactStanding | null;
  /** Whether the player could not see it: the level, or the thing it is about, is hidden from them. */
  secret: boolean;
}

/** One typed system's view at a level, as the system keeps it, named as the source: its sections of rows. */
export interface SystemShown {
  /** The system that keeps it: economy, gear, orgs, calendar, weather, vehicles or sheets. */
  system: string;
  title: string;
  sections: { title: string; rows: SystemRowShown[] }[];
}

/** A level's typed systems, at the chat's head or at a turn: the level as the tree names it, and each system that keeps something there. */
export interface SystemsReply {
  /** The level, as the tree names it. */
  at: string;
  systems: SystemShown[];
}

/** The hash of the provider key today's connection holds, which RPE takes over at the swap. */
export interface TakenKeyAsk {
  /** The key's SHA-256, in hex. */
  hash: string;
}

/** What a level may set a setting to: one of RPH's shapes; a table of names, each to a value of `of` (with `whole`, such a value alone for every name); or a list of records, each holding every field. */
export type Takes = SettingTakes | { type: "table"; of: SettingTakes; whole?: true } | { type: "records"; fields: readonly { name: string; takes: SettingTakes; about: string }[] };

/** A tap that manages, recorded at once as his own edit: one of the world's actions done at once (money, a group, gear, a vehicle); one ✎ form (a hint, the time, a thing, things with a label, or a field); the World page's edit of values and facts; or an edit of operations ("Make this a property"). */
export type TapAsk = { kind: "action"; action: string; params: { [key: string]: JsonValue }; source: string; text?: string; now?: boolean; tell?: boolean } | { kind: "fix"; fix: { hint: string } | { time: string } | { thing: JsonValue } | { things: JsonValue[]; label: string } | { entity: string; field: string; value: JsonValue }; tell?: boolean } | { kind: "edit"; ops: EditOpAsk[]; tell?: boolean } | { kind: "ops"; ops: JsonValue[]; tell?: boolean };

/** What a tap or its Undo came to: whether it was applied, what the world's rules reported of it (kept with it, listed under unsettled), the id its Undo takes (null where nothing was recorded), and the answer in words. */
export interface TapReply {
  applied: boolean;
  reports: string[];
  undo: string | null;
  words: string;
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
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; session: string; given: string[]; tools?: { tokens: number; most: number } } | { kind: "tool_unheld"; tool: string; definition: string; reason: "unregistered" | "shadowed" | "withdrawn" } | { kind: "intent_began" } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "connection_wait"; connection: string; for: "minute" | "place"; ms?: number } | { kind: "waiting"; for: "tool" | "agent"; callId: string; tool: string; ms?: number } | { kind: "connection_stand_in"; named: string; used: string } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; closing: boolean; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission; refused?: CallRefusal } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "rule_failed"; rule: string; path: string; why: "time"; length: number } | { kind: "rule_failed"; rule: string; path: string; why: "command"; detail: string } | { kind: "hook"; hook: string; on: "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end"; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "paused"; call: number } | { kind: "resumed"; call: number; ms: number } | { kind: "said"; call: number; text: string } | { kind: "released"; release: Release } | { kind: "progress_missing"; time: number } | { kind: "compacted"; session: string; reason: "would-not-fit" | "refused" | "asked" | "fold"; of: "turns" | "run"; before: number; after: number; keptTurns?: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened" | "unreadable"; from?: string; turn?: string; by?: "user"; reason?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };

/** An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it. No agent for a record of the host's word outside any agent's work (a session opened, closed, forked or opened again by a call of the sessions API). */
export interface TraceRecord {
  seq: number;
  run: string;
  scope: Scope;
  at: number;
  agent?: AgentRef;
  parent?: { agent: string; run: string; call: string };
  event: TraceEvent;
}

/** A file's differences: from the shipped file of its name to this one; and what the updates that changed the shipped file since this one was written changed of it, together and one by one. */
export interface TreeDiffReply {
  path: string;
  /** The shipped file of the same name; null when there is none, or the file is the shipped one. */
  shipped: string | null;
  /** From the shipped file to this one, line by line; none without a shipped file. */
  lines: DiffRow[];
  /** Every change to the shipped file since this one was last written, as one difference: when the latest update ran, and from the shipped file as it stood when this one was written to the shipped file now. */
  update: { at: number; lines: DiffRow[] } | null;
  /** The same changes one update at a time, oldest first: when each ran, and from the shipped file before it to the shipped file after it. */
  updates?: { at: number; lines: DiffRow[] }[];
}

/** What a file of the tree is: one the user writes, a note an agent keeps, or one RPE makes again. */
export type TreeFileKind = "yours" | "notes" | "generated";

/** One file of the tree, as text: the whole of a short one, and of a long one the lines or bytes asked for (the page's setting `files.readLines` of its lines when none is asked), with its size and its count of lines. */
export interface TreeFileReply {
  path: string;
  level: LayerLevel;
  kind: TreeFileKind;
  /** The file's size in bytes. */
  bytes: number;
  editable: boolean;
  /** The part read, whole lines or the bytes asked for. */
  text: string;
  /** The file's lines in all. */
  lines?: number;
  /** The first line the text holds; with `offset`, the first byte. */
  from?: number;
  /** The last line the text holds; with `offset`, the byte after the last. */
  to?: number;
  /** Whether the file goes on past what was read. */
  more?: boolean;
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
  /** For a file of the user's in place of a shipped one: when the latest update that changed that shipped file did so, if it did since this file was last written; null otherwise. */
  defaultChanged: number | null;
  /** For a file of the user's in place of a default an update has since taken away: when the update that removed it ran, if it did since this file was last written. */
  defaultRemoved?: number | null;
  /** The agents it is pinned for: each is handed the file whole at the start of its runs. Empty for a file pinned for none. */
  pinnedFor?: { agent: string; level: LayerLevel }[];
  /** Whether it is a level's config file, which the Settings page edits too. */
  isConfig?: boolean;
  /** The levels where a file of its kind and name has a place that the user may write: "save as" offers only those. */
  placeable?: LayerLevel[];
  /** For a generated file, the page where what it shows is edited, if one is; null otherwise. */
  editedOn?: string | null;
  /** Why RPH leaves it out though it is the nearest of its name and not switched off: what its `needs:` names is not in force, or its header does not parse; null when nothing does. */
  held?: "needs" | "broken" | null;
  /** What RPH found wrong with it, in its own words, line by line. */
  problems?: string[];
  /** The agents whose stacks it joins: a file `instructions:` names or an agent reads. */
  joins?: string[];
}

/** One entry of a folder, or of a search: a folder, or a file with its entry. */
export interface TreeListed {
  name: string;
  /** Its path in the chat's view, as the file routes take it. */
  path: string;
  folder: boolean;
  level: LayerLevel;
  /** The file as the listing shows it; null for a folder. */
  entry: TreeFileRow | null;
}

/** A page of a folder of the chat's view, folders first and each by name, or of a search across every level: its entries, where the next page starts, the levels the view has, and whether a search stopped before it had looked everywhere. */
export interface TreeListedReply {
  /** The folder listed, "" for the chat's own top (which holds the other levels' folders beside its files); empty for a search. */
  folder: string;
  items: TreeListed[];
  /** Where the next page starts: send it as `after`; null at the end. */
  next: string | null;
  /** The levels the view has now: a chat's and its character's once the chat has its folders. */
  levels: LayerLevel[];
  /** A search that ran out of its time with the entries it had found, and did not look everywhere. */
  stopped: "time" | null;
}

/** Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own. */
export interface TreeListingReply {
  files: TreeFileRow[];
}

/** One change a turn recorded, in its order: the operation and its values, who made it, whether it applied, what it reported, and how exact, how sure and from where it is. */
export interface TurnChange {
  id: number;
  ord: number;
  op: string;
  value: JsonValue;
  by: string | null;
  applied: boolean;
  reports: { code: string; values?: { [key: string]: JsonValue } }[];
  source: FactSource | null;
  standing: FactStanding | null;
  precision: FactPrecision | null;
  /** The job that recorded it, when a job did. */
  job: string | null;
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

/** A mark a turn carries apart from its run's status: interrupted (RPE restarted while a run of it went on), saved otherwise (what Lumiverse saved is not what was released, beyond the prefill in front and a continue's join), or standing on a message of the player's he edited, or inserted before it, since it was played; with that message, and when the mark was set. */
export interface TurnMark {
  kind: "interrupted" | "saved-otherwise" | "edited-message" | "inserted-message";
  message: string | null;
  at: number;
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
  /** The reply went out whole; the run after the reply is from here to `ended`. */
  finished: number | null;
  /** The intent record's own time, its first token to its last; null when none began; to null when it began and did not end. */
  intent: Span | null;
  /** Each span of thinking before a model call's first output on the reply's path, in call order; none when no call thought. */
  thinking: Span[];
  /** Intake's own steps in order, from `received` to `started`, none of them holding a wait for the turn before; null for a run with no intake of its own (a Settle now) or one kept before they were. */
  intake: { step: string; from: number; to: number }[] | null;
  /** Each wait for the turn before, on its own, in order; none when nothing was waited for; null as for `intake`. */
  wait: { from: number; to: number }[] | null;
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
  /** Its marks, in the order they were set; none for a turn that carries none. */
  marks: TurnMark[];
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
  /** Where each slice of the preset's map was in this turn's prompt, with its notices; null where RPH kept none, or no longer keeps it (its folder was pruned). */
  prompt: LocatedSlices | null;
  /** What he asked for beside his words that this turn was told and keeps, and what was played as its message. */
  asked: RequestShown[];
  /** The Author's record of the turn as `story_query` shows it, every field; null when it wrote none. */
  record: { [key: string]: JsonValue } | null;
  /** The tools its agents reached through `tool_search` and `tool_use`, by name. */
  found: string[];
  /** Each agent's `todo` items still open as its list last stood. */
  todos: { agent: string; open: string[] }[];
  /** Its changes by lane, each lane's in order. */
  changes: { lane: string; changes: TurnChange[] }[];
  told: TurnTold;
  /** For a turn a migration carried: its message and swipe, and the old engine's record of it as kept; null for any other. */
  carried: { message: string; swipe: number; record: JsonValue } | null;
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
  /** Its marks, in the order they were set; none for a turn that carries none. */
  marks: TurnMark[];
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

/** What a turn, or a job he started, was told as it went: each gap check, each consent, each rule that fired with what the agent did next, the attachments each agent was given by name, and each sub-agent's writes the lead dropped, in the order told. */
export interface TurnTold {
  gapChecks: { check: GapCheck; at: number }[];
  consents: { grant: ConsentGrant; at: number }[];
  rules: { firing: RuleFiring; at: number }[];
  attachments: { agent: AgentRef; refs: JsonValue; at: number }[];
  dropped: { agent: AgentRef; at: number }[];
}

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

/** Where a job the owner started for no chat runs: the user and the job's own session, at the user's level; no chat and no turn. */
export interface UserSessionScope {
  user: string;
  session: string;
  chat?: void;
  turn?: void;
}

/** One change that wrote a value, as the World page lists a value's history: its id, the turn it is of or stands just before and that turn's number, when it was recorded, its lane and the area holding what it wrote, its operation and values, who made it, how exact, how sure and from where, its report codes, what it left there, whether it wrote the typed value or a fact beside it, and for a fact the turn of the later exact record that settled it. */
export interface ValueChangeShown {
  id: string;
  turn: string;
  n: number;
  at: number;
  lane: "story" | "engine";
  area: string;
  op: string;
  words: string;
  values: { [key: string]: JsonValue };
  by: string | null;
  precision: "exact" | "approximate" | "vague" | "unknown" | null;
  standing: "established" | "proposed" | "assumed" | null;
  source: "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented" | null;
  reports: string[];
  value: string | null;
  kind: "value" | "fact";
  settledBy: string | null;
}

/** The history of one value: the level and part asked for, a page of the changes that wrote it, newest first, and where the next page starts (null at the end). */
export interface ValueHistoryReply {
  at: string;
  part: string;
  items: ValueChangeShown[];
  next: string | null;
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

/** Every route in the form that answers in JSON, by its method and path pattern: its params, its query, its body, its reply, whether it pages, and whether it is long (answered at once with an id, its answer read from `ANSWERS_PATH`). */
export interface ApiRoutes {
  /** Every copy of the database taken before a migration, every archive rpe backup made in the data folder, and every backup the migration took, with its kind, size and date; RPE removes none but the copies past database.copiesKept. */
  "GET /api/v1/backups": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BackupsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another; says which started and which were refused, and why. */
  "POST /api/v1/bootstrap": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: BootstrapBatchAsk;
    reply: BootstrapBatchReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: Build's page sends one of today's messages as it sends it to the extension's backend, and is answered with today's answer and the pushes the request caused. */
  "POST /api/v1/build": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: FrontendToBackend;
    reply: BuildTunnelReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The chats RPE played, the most recently played first, then the chats its store holds that it has not played (a migration's), by name. */
  "GET /api/v1/chats": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ChatsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: a panel's action as a page sends it, answered with today's `lre.result` or `lre.error`. */
  "POST /api/v1/chats/:chat/actions": {
    params: { chat: string };
    query: Record<string, never>;
    body: FrontendToBackend;
    reply: ResultMessage | ErrorMessage;
    paged: false;
    long: false;
    joined: false;
  };
  /** Tunnel for the previous build's messages: the Undo of a tap, sent as the previous build's Undo chip is, answered with today's `lre.result` or `lre.error`; a tap of a turn joined to another is answered with the turn it joined. */
  "POST /api/v1/chats/:chat/actions/undo": {
    params: { chat: string };
    query: Record<string, never>;
    body: UndoAsk;
    reply: ResultMessage | ErrorMessage;
    paged: false;
    long: false;
    joined: true;
  };
  /** A chat's bootstrap: the six facts of "done enough", and the chat's bootstrap jobs, oldest first, each with how it stands or ended. */
  "GET /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: BootstrapChatReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts a chat's bootstrap job (taking on a story with a past), with the player's choice of what to relive; a start that is refused is answered in words, with nothing started. */
  "POST /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: BootstrapStartAsk;
    reply: JobView;
    paged: false;
    long: false;
    joined: false;
  };
  /** A migrated chat's carried turns, in the order the run imported them, each tied to its message and swipe, with the engine that played it, why it stood with no turn played, and how many departures and texts of the old engine it holds. `from` is how many to pass over; `limit` how many to give (the setting `migration.page` when left out, at most `migration.pageMost`). */
  "GET /api/v1/chats/:chat/carried": {
    params: { chat: string };
    query: { from?: number; limit?: number };
    body: undefined;
    reply: CarriedTurnsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every character a chat knows, with what each holds on the path read: at the chat's newest turn, or as it stood at one of its turns. */
  "GET /api/v1/chats/:chat/cast": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: CastReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns. */
  "GET /api/v1/chats/:chat/cast/:character": {
    params: { chat: string; character: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: CharacterReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Writes a perception for a character, corrects one or strikes one, as the player's own change placed after the newest reply: it lands while a run goes on and in a branch with no turn of its own, and the Author is told of it at the next turn. `knows` as an empty list says the character now knows nothing from it. */
  "POST /api/v1/chats/:chat/cast/:character/perceptions": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: PerceptionAsk;
    reply: PerceptionWrittenReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Strikes an entry of a character's record, or takes its strike back, as the player's own change on the chat's newest turn; says what it did, in the cast's words. */
  "POST /api/v1/chats/:chat/cast/:character/strike": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: CastStrikeAsk;
    reply: CastStrikeReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The Undo of an edit of his, by the edit's own id (the `undo` its answer gave): all of it, the world's defaults given with it included, or none and the answer says why; at once, whatever runs. */
  "POST /api/v1/chats/:chat/edits/:edit/undo": {
    params: { chat: string; edit: string };
    query: Record<string, never>;
    body: undefined;
    reply: TapReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The user's jobs of one chat, as RPH last kept each, the newest started first. */
  "GET /api/v1/chats/:chat/jobs": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every book of the user's by its id and name, for the Settings page's choice of the books the lore reads (`lore.books`): whether the chat has it attached, whether a character brought it, and when Lumiverse made it. */
  "GET /api/v1/chats/:chat/lore/books": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreBooks;
    paged: false;
    long: false;
    joined: false;
  };
  /** The lore index of a chat, a page at a time in the order of the lore map's catalog: each entry of its books and its world with its id, keys, size, how it activates and revision, and the lines the index holds of it (the user's own, else the latest run's, an earlier revision's marked stale) with whether they are current. */
  "GET /api/v1/chats/:chat/lore/index": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: LoreIndexRow[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** The owner's own lines for one entry of a chat's lore: its kind, its line, what it defines (each to a record by its id, a name given resolving to the one record of that name, else kept as written and shown unlinked) and its related entries. What he sets stands over an indexing run's and outlives a run that redoes the entry; null takes his own off, and the run's shows again. Answers the entry as it now stands. */
  "PUT /api/v1/chats/:chat/lore/index/:entry": {
    params: { chat: string; entry: string };
    query: Record<string, never>;
    body: { kind?: string | null; line?: string | null; defines?: { what: string; aspect: string }[] | null; related?: string[] | null };
    reply: LoreIndexRow;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts a lore indexing job for a chat: the indexer's definition as a job of the owner's own, tied to no turn, handed the entries no run has indexed as they stand now a batch at a time. Refused, with the fact, where jobs are off or a limit of the day is reached. */
  "POST /api/v1/chats/:chat/lore/index/jobs": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreIndexJob;
    paged: false;
    long: false;
    joined: false;
  };
  /** Where a chat's lore indexing stands: its entries and how many no run has indexed as they stand now, and the connection and model the indexer's definition runs on (its own, else his default). */
  "GET /api/v1/chats/:chat/lore/index/status": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreIndexStatus;
    paged: false;
    long: false;
    joined: false;
  };
  /** The overlays on a chat's path, in the path's order: each with its entry and the entry's title, the note, the turn that wrote it (its place on the path, from 1, and its id) and who wrote it. A turn that was swiped away or deleted has none on the path. */
  "GET /api/v1/chats/:chat/lore/overlays": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreOverlays;
    paged: false;
    long: false;
    joined: false;
  };
  /** Whether the chat has the projection book on (the setting `lore.projection`, off unless he turns it on) and the book RPE made for it, which only that chat has attached. */
  "GET /api/v1/chats/:chat/lore/projection": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreProjectionState;
    paged: false;
    long: false;
    joined: false;
  };
  /** Applies the chat's `lore.projection` setting now: on, the chat's own book of what the story changed and made is made or rewritten from the path as it stands; off, a book made while it was on is taken away. His own books are never touched. */
  "POST /api/v1/chats/:chat/lore/projection/refresh": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreProjectionRefreshed;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's messages as Lumiverse holds them, by a list of ids or by a stretch of its places (`index_in_chat`, a gap where a message was deleted); only the signed-in user's own chats. */
  "GET /api/v1/chats/:chat/messages": {
    params: { chat: string };
    query: { ids?: string; from?: number; to?: number };
    body: undefined;
    reply: ChatMessagesReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The newest turn on the chat's path in one read, as the turn's own route gives it: a turn going on now, else the newest of the chat's own on its path, however far back it was swiped. */
  "GET /api/v1/chats/:chat/newest": {
    params: { chat: string };
    query: { run?: string; from?: number };
    body: undefined;
    reply: TurnReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The perception record of a turn, or of the stretch of turns ending at it: who was on stage, how the stage was read (the open scene, where the owner's character stands, or not recorded), and for each the perceptions of that turn they have, or none. */
  "GET /api/v1/chats/:chat/perceptions": {
    params: { chat: string };
    query: { turn?: TurnId; count?: number };
    body: undefined;
    reply: PerceptionRecordReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The prompt map of the chat's preset as found in a turn's prompt: each slice's marker, kind, line, behaviour, text, where and how it was found and what the breakdown said; the text no slice claims; the turn's notices and front; Lumiverse's clipping; and the old engines' blocks still in the preset. */
  "GET /api/v1/chats/:chat/prompt": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: PromptShown;
    paged: false;
    long: false;
    joined: true;
  };
  /** Makes one of his edits to the prompt map as found in a turn's prompt (rename a marker, merge slices, split one, correct a line, change a kind), kept as his for every chat on the preset, and answers the map as found again; a refusal is said in the prompt map's words. */
  "POST /api/v1/chats/:chat/prompt/edit": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: PromptEditAsk;
    reply: PromptShown;
    paged: false;
    long: false;
    joined: true;
  };
  /** Each turn's prompt notices and front, newest first, with its number on the chat's path and Lumiverse's clipping, for the turns whose prompt RPE still keeps. The settings `turns.page` and `turns.pageMost` give a page's length. */
  "GET /api/v1/chats/:chat/prompt/history": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: PromptTurnShown[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** What waits in a chat for the next message, asked for beside his words: each request with its kind, what was asked and when. */
  "GET /api/v1/chats/:chat/requests": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: RequestsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Holds a composer control's ask (depth or swipe) for the next message, in place of one of its kind that waited; one longer than requests.textMost is not kept, and the answer says so. */
  "POST /api/v1/chats/:chat/requests": {
    params: { chat: string };
    query: Record<string, never>;
    body: RequestAsk;
    reply: RequestHeldReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Withdraws a request that waits; one kept with a turn already stays, and the answer names the turn. */
  "DELETE /api/v1/chats/:chat/requests/:request": {
    params: { chat: string; request: string };
    query: Record<string, never>;
    body: undefined;
    reply: RequestWithdrawnReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's sessions in the order they were opened, a page at a time: scenes, and the sessions of its sub-agents, jobs and talks, each with where it stands. Listed from the chat's index; no session file is read. */
  "GET /api/v1/chats/:chat/sessions": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: SessionShown[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** One session with what its next turn would carry in the mode asked for (continuing when none is) and each of its compactions, whether it still stands or was undone. */
  "GET /api/v1/chats/:chat/sessions/:session": {
    params: { chat: string; session: string };
    query: { carry?: CarryMode };
    body: undefined;
    reply: SessionRead;
    paged: false;
    long: false;
    joined: false;
  };
  /** Closes the Author's open scene as his own change, placed after the chat's newest turn: the close is written in the story record, and the scene's session closes with it, hung after that turn so that its Undo, a swipe or a delete of that turn takes the closing back. Refused while a turn of the chat runs, for a session that is not a scene's, or one closed already. */
  "POST /api/v1/chats/:chat/sessions/:session/close": {
    params: { chat: string; session: string };
    query: Record<string, never>;
    body: undefined;
    reply: SessionClosed;
    paged: false;
    long: false;
    joined: false;
  };
  /** Asks for the open session to be compacted: it runs at the session's next turn, the Author first given its chance to save what it wants kept. */
  "POST /api/v1/chats/:chat/sessions/:session/compact": {
    params: { chat: string; session: string };
    query: Record<string, never>;
    body: undefined;
    reply: SessionOne;
    paged: false;
    long: false;
    joined: false;
  };
  /** His Undo of a close: takes back the change the close answered with, so the scene stands open in the story record, and opens the session again. */
  "POST /api/v1/chats/:chat/sessions/:session/reopen": {
    params: { chat: string; session: string };
    query: Record<string, never>;
    body: SessionReopenAsk;
    reply: SessionOne;
    paged: false;
    long: false;
    joined: false;
  };
  /** The turns played in a session, newest first, a page at a time: each with its number on the chat's path (none where it left the path), when RPE received it and the runs of RPE's that ran in this session on it. */
  "GET /api/v1/chats/:chat/sessions/:session/turns": {
    params: { chat: string; session: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: SessionTurnRow[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** Undoes one compaction of a session by its id: from its next turn the turns the summary stood for are carried whole again, until a later compaction; the file keeps both. Answers the session's compactions. */
  "POST /api/v1/chats/:chat/sessions/:session/uncompact": {
    params: { chat: string; session: string };
    query: Record<string, never>;
    body: SessionUncompactAsk;
    reply: SessionCompactions;
    paged: false;
    long: false;
    joined: false;
  };
  /** Settle now: a run on the chat's newest turn that writes nothing into the chat; answers the turn and the run begun, or a refusal in the turn-errors part's words. */
  "POST /api/v1/chats/:chat/settle": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: SettleReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's state view, at its head or as it stood at one of its turns, in the shape the previous build's pages take. */
  "GET /api/v1/chats/:chat/state": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: StateView;
    paged: false;
    long: false;
    joined: true;
  };
  /** What a turn's time brought due, each thing with what the turn recorded for it. */
  "GET /api/v1/chats/:chat/state/due": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: DueReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The history of one value by turn: every change along the chat's path, at its head or up to a turn, that wrote the part asked for of the level asked for (a field, a relation, a balance as `posted`, a quest's stage as `stage` of `track:<id>`, a fact's key, a world value, an area item's part), newest first, a page at a time; each with its turn, lane, who made it, its marks and reports, and for a fact the later exact record that settled it. */
  "GET /api/v1/chats/:chat/state/history": {
    params: { chat: string };
    query: { at: string; part: string; turn?: TurnId; limit?: number; cursor?: string };
    body: undefined;
    reply: ValueHistoryReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What no longer applies at the chat's head on the swipes now showing: each change that stopped applying, with its turn and the codes of why, and the earlier reply whose swipe the later turns were not made on. */
  "GET /api/v1/chats/:chat/state/not-applied": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: NotAppliedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A level's typed systems, at the chat's head or as it stood at a turn: each game system that keeps something there as that system keeps it (accounts with their postings and balance, a thing's four facts, a group's positions and ranks, the day, the sky, a vehicle's driver, a sheet), named as the source; what the player could not see is marked secret. */
  "GET /api/v1/chats/:chat/state/systems": {
    params: { chat: string };
    query: { at: string; turn?: TurnId };
    body: undefined;
    reply: SystemsReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** A chat's story record, at its newest turn or as it stood at one of its turns: the timeline, the story model's parts, the Author's horizon and the futures; each list bounded by the story's own setting, read further back with `part` and `skip`. */
  "GET /api/v1/chats/:chat/story": {
    params: { chat: string };
    query: { turn?: TurnId; part?: StoryListName; skip?: number };
    body: undefined;
    reply: StoryReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Corrects any field of any item of the story record (a beat's text, a thread's state, a summary, the premise, a reading of the player), read as `story_record` reads the same fields of its part, as the player's own change placed after the chat's newest reply on its own line: swiping that reply keeps it, a turn that is running goes on from the state it started with, and a fresh branch takes it on its own line. Says what of it could not be read and the item as it stands. */
  "POST /api/v1/chats/:chat/story/correct": {
    params: { chat: string };
    query: Record<string, never>;
    body: StoryCorrectAsk;
    reply: StoryCorrectReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What the record covers of the whole chat: every stretch of messages with the same marks, in and out of the prompt's window, each hidden message, the window's edge, and how many messages above that edge the record does not cover. */
  "GET /api/v1/chats/:chat/story/coverage": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: StoryCoverage;
    paged: false;
    long: false;
    joined: false;
  };
  /** The story so far as the next briefing gives it to the Author, worked out at the chat's head: its text, its size against its budget, and each stretch it had no room for. */
  "GET /api/v1/chats/:chat/story/so-far": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: StorySoFarReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Strikes an item of the story record, or takes its strike back, as the player's own change on the chat's newest turn; says whether anything was recorded and the item as it stands. */
  "POST /api/v1/chats/:chat/story/strike": {
    params: { chat: string };
    query: Record<string, never>;
    body: StoryStrikeAsk;
    reply: StoryStrikeReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The chat's chapters, scenes and beats as one list in the chat's order, oldest first, a page at a time: each with the chapter and the scene it lies in, and a beat with the messages it stands for, by number and id. */
  "GET /api/v1/chats/:chat/story/timeline": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: StoryTimeline;
    paged: true;
    long: false;
    joined: false;
  };
  /** A tap that manages, or a correction from any page, recorded at once as his own edit; what the world's rules turn down is applied with its report; a refusal is answered in words with nothing changed. */
  "POST /api/v1/chats/:chat/taps": {
    params: { chat: string };
    query: Record<string, never>;
    body: TapAsk;
    reply: TapReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's turns, newest first, each with what its runs spent together; `before` is a turn's id, and older ones follow it. The settings `turns.page` and `turns.pageMost` give a page's length. */
  "GET /api/v1/chats/:chat/turns": {
    params: { chat: string };
    query: { limit?: number; before?: TurnId };
    body: undefined;
    reply: TurnsReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** One turn, read on from where a page has read to: its intent record, what went to the chat, the lore of its prompt, its runs' records from the record numbered `from` of the run named, each of its runs, and all it holds besides (its prompt by slice, what he asked for, the Author's record, the tools it found, its changes by lane, open todo items, what it was told, and the old engine's record of a carried turn). */
  "GET /api/v1/chats/:chat/turns/:turn": {
    params: { chat: string; turn: string };
    query: { run?: string; from?: number };
    body: undefined;
    reply: TurnReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** What an old engine recorded on a reply the migration carried, for the reply's Turn page: the engine that played the chat, each part of the record by name, every text it names word for word, why the reply stood with no turn played, and each line where it says something against its turn. */
  "GET /api/v1/chats/:chat/turns/:turn/carried": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: CarriedTurnReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The whole of a turn's folder, every level down, each entry with its size; none for a turn that has no folder. */
  "GET /api/v1/chats/:chat/turns/:turn/files": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: FolderReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** One file of a turn's folder, by its path below the folder, as text; no path leaves the folder. */
  "GET /api/v1/chats/:chat/turns/:turn/files/*": {
    params: { chat: string; turn: string; "*": string };
    query: Record<string, never>;
    body: undefined;
    reply: FileReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The lore Lumiverse activated for a turn's prompt, in the tag's order: each entry's lore map id, its id and book in Lumiverse, its title and how it activated where the tag says; none for a turn RPE holds no tag for, or one of another chat. */
  "GET /api/v1/chats/:chat/turns/:turn/lore": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: TurnLoreReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** What a turn was told beside his words and keeps, and what was played as its message. */
  "GET /api/v1/chats/:chat/turns/:turn/requests": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: RequestsReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** One model call's request, by its file below the turn's folder (a run's `requests`), rebuilt exactly as it was sent; where it cannot be, it says so and shows nothing. */
  "GET /api/v1/chats/:chat/turns/:turn/requests/*": {
    params: { chat: string; turn: string; "*": string };
    query: Record<string, never>;
    body: undefined;
    reply: RequestReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Stops a turn going on now; says whether it was running. */
  "POST /api/v1/chats/:chat/turns/:turn/stop": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: StopReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The world's tree for a chat: the level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn. */
  "GET /api/v1/chats/:chat/world": {
    params: { chat: string };
    query: { at?: string; depth?: number; values?: "none" | "own" | "all"; turn?: TurnId };
    body: undefined;
    reply: WorldReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The connections, each with whether a key is set (nothing of the key) and its model's limits as RPH uses them; the default; the providers offered. */
  "GET /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionsShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** Adds a connection, with its key when it has one. */
  "POST /api/v1/connections": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** Changes a connection, whole: a field left out is cleared; its key stays when the body leaves it out, and goes when it is null. */
  "PUT /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: SaveConnection;
    reply: ConnectionShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** Removes a connection, and its key. */
  "DELETE /api/v1/connections/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Makes a connection the default. */
  "PUT /api/v1/connections/:id/default": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Where the sign-in of a connection that signs in to its provider stands: signed in or not, until when, its open flow. */
  "GET /api/v1/connections/:id/signin": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: SignInState;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts signing a connection in to its provider: the flow, and the address the user opens to sign in. */
  "POST /api/v1/connections/:id/signin": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: SignInStart;
    paged: false;
    long: false;
    joined: false;
  };
  /** Signs a connection's provider out: its tokens are forgotten. */
  "DELETE /api/v1/connections/:id/signin": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Cancels a sign-in's open flow; nothing of it is kept. */
  "POST /api/v1/connections/:id/signin/cancel": {
    params: { id: string };
    query: Record<string, never>;
    body: { flow: string };
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Finishes a sign-in with what the user pasted back, and says how it stands; the token is kept by the model layer and never answered. */
  "POST /api/v1/connections/:id/signin/finish": {
    params: { id: string };
    query: Record<string, never>;
    body: { flow: string; code: string };
    reply: SignInState;
    paged: false;
    long: true;
    joined: false;
  };
  /** Tests a connection with one small call: how long it took, and the model that answered or the provider's words with its key taken out; and that model's limits. */
  "POST /api/v1/connections/:id/test": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: ConnectionTested;
    paged: false;
    long: false;
    joined: false;
  };
  /** The extension's word that a new app file has arrived, with the hash stated for it: RPE reads the source it was set up from, takes the build only when every file matches, starts it for real on a scratch copy of its data, and swaps onto it once no turn or job runs. */
  "POST /api/v1/ext/arrived": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { hash?: string };
    reply: Arrived;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own. */
  "GET /api/v1/files": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: TreeListingReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** "Apply now": starts the opening block of the chat's open session afresh from the files as they stand, there and then (the next run of each agent makes it); says which session, or that none is open and the next one opens with the files as they stand. Nothing else carries it. */
  "POST /api/v1/files-apply": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: ApplyNowAsk;
    reply: ApplyNowReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Copies a file or folder of the user's to a path nothing stands at (the copy of a folder leaves its links out); a file copied into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again. */
  "POST /api/v1/files-copy": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: FileMoveAsk;
    reply: FileMovedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A file's difference from the shipped file of its name, and what the updates that changed the shipped file since it was written changed of it, together and one by one. */
  "GET /api/v1/files-diff/*": {
    params: { "*": string };
    query: { chat?: string };
    body: undefined;
    reply: TreeDiffReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Makes a folder of the user's, and the folders above it, at a path of a chat's view (a never-played chat is placed first); never a shipped one, or one RPE makes again. */
  "POST /api/v1/files-folder": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: FolderAsk;
    reply: { path: string };
    paged: false;
    long: false;
    joined: false;
  };
  /** The chat's view of the tree read like a filesystem: one folder's files and folders a page at a time (the chat's own top, with the other levels' folders, when none is named), or a search by name and by text across every level, each file with whether RPH takes it and why not; with no chat, the shipped and global levels. */
  "GET /api/v1/files-list": {
    params: Record<string, never>;
    query: { chat?: string; folder?: string; search?: string; limit?: number; after?: string };
    body: undefined;
    reply: TreeListedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Renames or moves a file or folder of the user's to a path nothing stands at; a file moved into a folder of guidance is a file of that kind, which the answer says. Never a shipped file or one RPE makes again. */
  "POST /api/v1/files-move": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: FileMoveAsk;
    reply: FileMovedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Switches a file's name off or on again in the `off:` list of a level's config, which is what "Delete" on a shipped file does; says the file as the listing now shows it. */
  "PUT /api/v1/files-off/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FileSwitchAsk;
    reply: FileWrittenReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Pins a file for an agent, or takes the pin away, in the `pins:` list of a level's config (the global level's, or a chat's): the agent is handed the file whole at the start of each of its runs. A path the view does not hold is refused; says the file as the listing now shows it. */
  "PUT /api/v1/files-pin/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FilePinAsk;
    reply: FileWrittenReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every pin the levels' configs hold for a chat (with no chat, the global level's), with whether its file is in the view and whether a definition names its agent: a pin of a file that is gone or of an agent no definition names is listed as such, never dropped. */
  "GET /api/v1/files-pins": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: FilePins;
    paged: false;
    long: false;
    joined: false;
  };
  /** Prunes a chat's old turn folders as the chat's retention setting says, never while a turn of it is going on; says what it took away. */
  "POST /api/v1/files-prune": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: PruneAsk;
    reply: { pruned: PrunedShown };
    paged: false;
    long: false;
    joined: false;
  };
  /** The exact stack an agent gets in a chat, part by part, each with the file it comes from and its text, and the briefing's parts with the situations that add them; with no chat, the stack the shipped and global levels give. */
  "GET /api/v1/files-stack": {
    params: Record<string, never>;
    query: { chat?: string; agent: string };
    body: undefined;
    reply: StackReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** One file of the tree, as text: a short file whole, a long one the lines (`line`, `lines`) or the bytes (`offset`, `length`) asked for, `files.readLines` lines when it asks for none; with the file's size and its count of lines, and whether it goes on. */
  "GET /api/v1/files/*": {
    params: { "*": string };
    query: { chat?: string; line?: number; lines?: number; offset?: number; length?: number };
    body: undefined;
    reply: TreeFileReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Writes a file's whole text as the user at a level (for a file of another level, the user's own file of its name there); says the file as the listing now shows it. */
  "PUT /api/v1/files/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FileWriteAsk;
    reply: FileWrittenReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Removes a file of the user's; for one in place of a default, that is resetting to the default. "Delete" on a shipped file writes its name in the `off:` list of the level named (the chat's when a chat is named, else the global level's), so the shipped file stays and is not in force. */
  "DELETE /api/v1/files/*": {
    params: { "*": string };
    query: { chat?: string; level?: "global" | "chat" };
    body: undefined;
    reply: { removed: string; switchedOff?: LayerLevel };
    paged: false;
    long: false;
    joined: false;
  };
  /** The user's jobs, of every chat, as RPH last kept each, the newest started first. */
  "GET /api/v1/jobs": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: JobsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Cancels a job; one that has ended already is given as it ended. */
  "POST /api/v1/jobs/:job/cancel": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobCancelReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What a job he started (which belongs to no turn) was told as it went: its gap checks, consents and rules fired. */
  "GET /api/v1/jobs/:job/told": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobToldReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The proposals his agents drafted for his lore, newest first, a page at a time (every chat's when none is named, only those in a state when one is): each with the draft, the turn it came from and where it stands. */
  "GET /api/v1/lore/proposals": {
    params: Record<string, never>;
    query: { chat?: string; status?: "open" | "approved" | "rejected" | "refused"; limit?: number; cursor?: string };
    body: undefined;
    reply: { items: LoreProposal[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** Approves an open proposal, with his edits if he sends any: one write, to his Lumiverse book over HTTP as him, or to his world as its next revision, checked against the entry's revision when the draft was made. An edit changes only the passage it names. Refused (409) where the entry changed meanwhile, is gone, or a draft of his own of the world stands uncommitted; the proposal then says why. */
  "POST /api/v1/lore/proposals/:id/approve": {
    params: { id: string };
    query: Record<string, never>;
    body: { text?: string; title?: string; keys?: string[]; book?: string };
    reply: LoreApproved;
    paged: false;
    long: false;
    joined: false;
  };
  /** Rejects an open proposal: nothing is written. Answers the proposal as it now stands. */
  "POST /api/v1/lore/proposals/:id/reject": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: LoreRejected;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every write RPE made to his lore, newest first, a page at a time: each with the entry before and after, so he can put it back. */
  "GET /api/v1/lore/writes": {
    params: Record<string, never>;
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: LoreWrite[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** Puts an entry back as it was before one of RPE's writes (an entry RPE made is taken away; one of his world goes back as the world's next revision), under the same check as a write: refused (409) where the entry changed since. */
  "POST /api/v1/lore/writes/:id/put-back": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: LorePutBack;
    paged: false;
    long: false;
    joined: false;
  };
  /** The Migration page's data: the last run's report and its printed text, each chat's check, the backup, what waits on the user, and the steps of going back. */
  "GET /api/v1/migration": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: MigrationReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** How RPE runs: under its service or by hand, since when, where it listens, its build, and whether its service put the known-good copy back. */
  "GET /api/v1/service": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ServiceHow;
    paged: false;
    long: false;
    joined: false;
  };
  /** RPE's own newest log lines, newest first, each with its level, time, area and the chat, turn or job it names, no secret in any; those of one area, chat, turn or job, or of one level and worse, when asked. */
  "GET /api/v1/service/log": {
    params: Record<string, never>;
    query: { area?: string; chat?: string; turn?: string; job?: string; level?: "debug" | "info" | "warn" | "error"; limit?: number };
    body: undefined;
    reply: ServiceLog;
    paged: false;
    long: false;
    joined: false;
  };
  /** Restarts RPE for the values that hold only at a restart, once no turn and no job runs, as "Update now" restarts; says it waits while they run, and, run by hand, that it cannot. */
  "POST /api/v1/service/restart": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsStatus;
    paged: false;
    long: false;
    joined: false;
  };
  /** How long the parts of a turn took across the latest turns of a chat, or of all chats: for each part, how many turns it was seen in, the middle time, the slowest and the latest. */
  "GET /api/v1/service/timings": {
    params: Record<string, never>;
    query: { chat?: string; limit?: number };
    body: undefined;
    reply: ServiceTimings;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, the level and file it comes from, when a change takes effect and what it does. */
  "GET /api/v1/settings": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: SettingsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands. */
  "PUT /api/v1/settings": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SettingsWrite;
    reply: SettingsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Signs out: ends the session the call came with, so it opens nothing more, and the Lumiverse session the caller names, through the door to Lumiverse. */
  "POST /api/v1/signin/end": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { lumiverse?: string };
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Signs in with a Lumiverse account: a username and password, or a Lumiverse session the caller holds. RPE checks it against Lumiverse and accepts it only for the user it belongs to; it keeps no password. The answer is a session. */
  "POST /api/v1/signin/lumiverse": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { client?: "web shell" | "command line" | "mcp server"; username?: string; password?: string; session?: string };
    reply: Session;
    paged: false;
    long: false;
    joined: false;
  };
  /** Trades the web app's printed token for a session, or a session that is still in time for a new one before it ends; the session says which client asked for it (the web shell where none is named). */
  "POST /api/v1/signin/session": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { client?: "web shell" | "command line" | "mcp server" };
    reply: Session;
    paged: false;
    long: false;
    joined: false;
  };
  /** Says that RPE answers here, its build, and the address of the Lumiverse it belongs to; nothing more, and no work to say it. */
  "GET /api/v1/status": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: Status;
    paged: false;
    long: false;
    joined: false;
  };
  /** When RPE started, and the builds that meet at it, its app file read again. */
  "GET /api/v1/status/builds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** How RPE's extension in Lumiverse last said it stands with RPE. */
  "GET /api/v1/status/extension": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ExtensionStatusReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Proves to a page that this is the RPE that holds its page token, before the page sends it the token: a keyed hash of the page's nonce. */
  "GET /api/v1/status/proof": {
    params: Record<string, never>;
    query: { id: string; nonce: string };
    body: undefined;
    reply: PageProof;
    paged: false;
    long: false;
    joined: false;
  };
  /** Whose the page's credential is, and when it ends. */
  "GET /api/v1/status/session": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: SessionReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What the tree takes, a page of chats at a time from the sizes RPE keeps (a chat not measured yet is measured meanwhile and shows its sizes at the next read): each chat's folder by area and its rows of the database, the user's own level, the shipped level, and RPE's database file with what no chat's rows take of it. */
  "GET /api/v1/storage": {
    params: Record<string, never>;
    query: { limit?: number; after?: string };
    body: undefined;
    reply: StorageReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Prunes on request, asked first: without `plan` it answers which places would go (a chat's old turn folders, its closed sessions' files, a deleted chat's other files, or the backup or copy of the database named), how many files and bytes, and a plan standing for exactly that; with the plan it takes exactly that, or nothing if the tree has changed since. Never a turn going on, never an open session's files. */
  "POST /api/v1/storage-prune": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: StoragePruneAsk;
    reply: StoragePruneReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Each kind RPE keeps (notes, versions of notes, suggestions, turn folders kept whole and pruned, session files, the user's files, the shipped level, the database, the migration's backups, copies of the database, archives) with how many, how big, the oldest, how long it is kept and by which setting, and when the user last pruned. */
  "GET /api/v1/storage/kinds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: StorageKindsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's largest notes, and those agents rewrote most. */
  "GET /api/v1/storage/notes": {
    params: Record<string, never>;
    query: { chat: string; limit?: number };
    body: undefined;
    reply: NotesReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's suggestions from the agents (every chat's when none is named), newest first, each with what it would change and the level accepting it writes at. */
  "GET /api/v1/suggestions": {
    params: Record<string, never>;
    query: { chat?: string; state?: SuggestionStatus };
    body: undefined;
    reply: SuggestionsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Accepts a suggestion as it is or edited, writing it as the user at the level named, or where the suggestion says it writes; says the suggestion as it now stands and the file. */
  "POST /api/v1/suggestions/:id/accept": {
    params: { id: string };
    query: Record<string, never>;
    body: SuggestionAcceptAsk;
    reply: SuggestionAcceptedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Dismisses a suggestion; says the suggestion as it now stands. */
  "POST /api/v1/suggestions/:id/dismiss": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: SuggestionDismissedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every thing that runs a command or calls out that the page's own user has listed, and whether it waits, is on or is off, with what it runs or calls, or the address its connection's key would go to. Only rpe allow and rpe deny on the server switch one; no page can. */
  "GET /api/v1/switches": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: SwitchesShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** "Update now": RPE restarts onto its new app file once no turn or job runs, whatever update.restart says, and answers where that stands. */
  "POST /api/v1/update": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BuildsStatus;
    paged: false;
    long: false;
    joined: false;
  };
}

/** The server's own command line's routes, which answer on its socket in the data folder alone (`command` access), in the same form; on that socket the routes of `ApiRoutes` that a page calls answer too, as the owner's. */
export interface CommandRoutes {
  /** How many turns and jobs run now: what a later `rpe up` waits to be none before it restarts RPE's service. */
  "GET /api/v1/command/busy": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: Busy;
    paged: false;
    long: false;
    joined: false;
  };
  /** Makes a new key of a kind, which retires the one before it; shown this once. */
  "POST /api/v1/command/keys": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: KeyAsk;
    reply: KeyMade;
    paged: false;
    long: false;
    joined: false;
  };
  /** Takes over the provider key today's connection holds, by its hash alone. */
  "POST /api/v1/command/keys/taken": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: TakenKeyAsk;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Keeps RPE's sign-in to Lumiverse and the config's Lumiverse block. */
  "PUT /api/v1/command/lumiverse": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: LumiverseSave;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** The keys in force, the switches and the builds, for `rpe status`. */
  "GET /api/v1/command/status": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: CommandStatus;
    paged: false;
    long: false;
    joined: false;
  };
  /** Switches a thing that runs a command or calls out on or off: the one road to it. */
  "PUT /api/v1/command/switches/:name": {
    params: { name: string };
    query: Record<string, never>;
    body: SwitchAsk;
    reply: Switched;
    paged: false;
    long: false;
    joined: false;
  };
}

/** Every route in the form that answers in its own way (a stream, a socket, a file), and what it answers. */
export interface RawRoutes {
  /** The answer of a request to a long route, by the id it was answered with: the same 202 and id while its work runs, then the route's own answer, once. */
  "GET /api/v1/answers/:id": {
    params: { id: string };
    answers: "202 with `{ answer: <id> }` while the work runs; then the route's own status and body, once; 404 for an id RPE does not hold";
    joined: false;
  };
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
  /** The extension's record of a generation it stopped because it could not tell whose chat it was: neither RPE's registration nor the connection's own record could be read. */
  "POST /api/v1/ext/stopped": {
    params: Record<string, never>;
    answers: "JSON: `{ kept: true }`, or 400 for a record the extension does not send";
    joined: false;
  };
  /** The live socket: a page follows chats on it (and ~jobs, ~user, or an address RPE gave it), and is sent each one's events in order (the live kinds), held to the token it opened with. */
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

/** Every kind the live socket carries, the app's and the areas' own, and what each carries. */
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
  /** An engine handler failed on a change of this chat, which is recorded as not applied: the operation, the handler's error, the turn and the change (null for one never kept). */
  handler_failed: { op: string; error: string; turn: string; change: number | null };
  /** What waits in the chat, asked for beside the player's words, changed: how many requests wait now; a page reads them again. */
  requests: { waiting: number };
  /** The extension's status changed: as GET /api/v1/status/extension answers it. */
  extension: ExtensionStatusReply;
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
/** Followed in place of a chat id: the user's jobs, in every chat and in none. */
export const LIVE_JOBS = "~jobs";
/** Followed in place of a chat id: what concerns the user and no one chat (the extension's status). */
export const LIVE_USER = "~user";
/** Followed in place of a chat id, before an address RPE gave the caller: an outside client's check-in. */
export const LIVE_ADDRESS_PREFIX = "~to:";
/** The status a route that takes a turn's id answers a turn joined to another with: its answer is a `JoinedAnswer`. */
export const JOINED_STATUS = 409;
/** The status a long route answers at once with `{ answer: <id> }`, and its answer's route while the work runs. */
export const ANSWER_STATUS = 202;
/** Where a long route's answer is read, by the id it was answered with: `GET <this>/<id>`. */
export const ANSWERS_PATH = "/api/v1/answers";
