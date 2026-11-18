// RPE's API as its route table declares it: every route's params, query, body and reply, every kind the
// live socket carries, and the live socket's own messages and constants. Written by `bun run api`
// (scripts/api/) from the table the server runs, for every road to RPE: both shells, the command line,
// the MCP server. Do not edit it: a route's declaration is where a type changes, and `bun run api`
// writes this again. The reference for people is docs/api.md, written beside it.

import type { StateView } from "../state-view";

/** Any JSON value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A line the Settings page shows beside a setting's control while its value is below `below` or above `above`, saying what such a value does; the value is taken all the same. */
export interface Advice {
  below?: number;
  above?: number;
  says: string;
}

/** One agent of a run: its handle, its definition, the agent that started it, its job, and the character it plays. */
export interface AgentRef {
  id: string;
  definition: string;
  parent?: string;
  job?: string;
  plays?: string;
}

/** A definition in force for a chat, as RPH lists it: its file and level, the farther files it replaces, whether it is switched off, its profile, effort and limits as its header says them, how its tools are offered, its fixed tools, the instruction files it reads and what it is given at a run's start, the definition its reply goes to a writer through, and what it runs on. */
export interface AgentShown {
  name: string;
  description: string;
  path: string;
  level: LayerLevel;
  replaces: { level: LayerLevel; path: string }[];
  off: boolean;
  model?: string;
  effort?: Effort;
  limits?: DefinitionLimitsView;
  toolsAs?: ToolsAs;
  tools: string[];
  reads: string[];
  given: string[];
  writer?: string;
  runsOn: DefinitionRun;
}

/** Every definition in force for a chat, or for none: the shipped and global levels as a new chat takes them. */
export interface AgentsReply {
  chat: string | null;
  agents: AgentShown[];
}

/** What an agent's requests carry as its fixed list for a chat, as declared (each tool's name and description), the whole's size in tokens against the most the user allows (`tools.fixedTokens`; a list over it is marked, nothing is refused), and every tool the registry holds. */
export interface AgentToolsReply {
  agent: string;
  declared: { name: string; description: string }[];
  tokens: number;
  most: number;
  registered: RegisteredTool[];
}

/** The chat whose open session starts its opening block afresh. */
export interface ApplyNowAsk {
  chat: string;
}

/** What "Apply now" did: the session whose opening block was made afresh at the press, which the next run of each agent takes, or none when no session is open, and what that means in words. */
export interface ApplyNowReply {
  session: string | null;
  note: string;
}

/** His word on a question: go ahead, or not, with a reason the agent is given. */
export interface ApprovalAnswerBody {
  go: boolean;
  reason?: string;
}

/** Whether his word reached a question that was waiting. */
export interface ApprovalAnswerReply {
  answered: boolean;
  state: "answered" | "settled" | "unknown";
}

/** Whether RPE took the build, and where it stands, in words. */
export interface Arrived {
  /** Whether RPE took the build: every file matched, and it starts. */
  taken: boolean;
  /** Where it stands. */
  words: string;
}

/** A backup made: its name in the backups folder, its size, how many files of the tree it holds beside the database, its sha256 and the links in the tree it left out. */
export interface BackupMadeReply {
  name: string;
  bytes: number;
  files: number;
  sha256: string;
  skipped: string[];
}

/** What a backup made now would hold, said before it is made: the name it would have, the database's size as its file stands now, how many files of the tree and how many bytes they take, and the links in the tree it leaves out (a backup holds what is in the folder, not what a link points to). */
export interface BackupPlan {
  name: string;
  database: number;
  files: number;
  bytes: number;
  skipped: string[];
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

/** The owner redraws documents of a character's base: each document given is written as the next version of its part, outside any turn; the others stand as they are. */
export interface BaseAsk {
  seed?: string;
  soul?: string;
  inner_voice?: string;
  background?: string;
}

/** The base's four documents. */
export type BaseDocument = "seed" | "soul" | "inner_voice" | "background";

/** The base as it stands, each document in its newest version, with the accepted growth laid over it (growth is layered over the base wherever the base is shown). */
export interface BaseNow {
  parts: { part: BaseDocument; version: number; text: string }[];
  growth: GrowthOverBase[];
}

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

/** A book's entries in its order: each with its title, whether it is switched off, its length, the revision a write must name, LRE's fields, its secret marks and what starts like one that can't be read. */
export type BookEntries = JsonValue;

/** His word to a bootstrap job that waits for it: go on, asking again after `more` tokens (its token limit again when left out), or end with what it has. */
export type BootstrapAnswerAsk = { go: "on"; more?: number } | { go: "end" };

/** The chats to start the bootstrap job for, one after another: a list of chat ids, or "migrated" for every chat the last migration carried; his choice of what to relive, and his token limit for each job. */
export interface BootstrapBatchAsk {
  chats: "migrated" | string[];
  /** His choice of what to relive: one of the words the bootstrap skill's header offers (`relive:`); left out or null, the skill decides. Another word is refused with the words it takes. */
  relive?: string | null;
  /** His own token limit for this job, a whole number above 0, at which it asks him whether to go on; left out, the setting `bootstrap.askAtTokens` in force for the chat. */
  tokenLimit?: number;
}

/** What came of starting the job for several chats, one after another: each chat started, with its job's view, and each refused, with why. */
export interface BootstrapBatchReply {
  started: { chat: string; job: JobView }[];
  refused: { chat: string; why: string }[];
}

/** A chat's bootstrap: the six facts, the start as it stands, the chat's bootstrap jobs under way (newest first), and the question of each that waits for his word. */
export interface BootstrapChatReply {
  chat: string;
  facts: DoneEnoughShown;
  start: BootstrapStartShown;
  underWay: BootstrapJobShown[];
  questions: BootstrapQuestion[];
}

/** A bootstrap job of a chat: what it was given (his relive word, the token limit at which it asks), and its view as RPH gives it (null: RPH no longer holds it). */
export interface BootstrapJobShown {
  id: string;
  relive: string | null;
  tokenLimit: number;
  view: JobView | null;
}

/** A bootstrap job held at its token limit, waiting for his word: the point it reached and the tokens counted when it did, what it spent and how a cached token counts, what its agent last wrote, the six facts as they stand now, and how many more tokens a go-on gives by default. */
export interface BootstrapQuestion {
  job: string;
  at: number;
  tokens: number;
  usage: Usage;
  cachedWeight: number;
  wrote: string | null;
  facts: DoneEnoughShown;
  more: number;
}

/** What starts a chat's bootstrap job: his choice of what to relive, and his own token limit for it, where he made them. */
export interface BootstrapStartAsk {
  /** His choice of what to relive: one of the words the bootstrap skill's header offers (`relive:`); left out or null, the skill decides. Another word is refused with the words it takes. */
  relive?: string | null;
  /** His own token limit for this job, a whole number above 0, at which it asks him whether to go on; left out, the setting `bootstrap.askAtTokens` in force for the chat. */
  tokenLimit?: number;
}

/** The start as it stands for the chat, before any press: whether the bootstrap skill is in force; the relive words its header offers (none while it is off); the token limit at which a job asks him whether to go on, counted as tokens sent and written by every agent of the job with a cached token at `cachedWeight`; and each cap that ends a bootstrap job's run, as in force for the chat (null: none). */
export interface BootstrapStartShown {
  skill: boolean;
  relive: string[];
  tokenLimit: number;
  cachedWeight: number;
  caps: ({ key: string; value: number | null })[];
}

/** A job Build ran or runs: its id, its kind, its world, where it stands, how far it is, the words it ended with, its result so far or at the end, the input it was given and when it last changed. */
export interface BuildJob {
  /** The job's id. */
  jobId: string;
  /** What the job does. */
  kind: "import_lore" | "refine" | "describe_map" | "propose_routines" | "playtest" | "check_world" | "index_text";
  /** The world it works on. */
  worldId: string;
  /** Where it stands; interrupted is a job that was running when RPE stopped. */
  status: "running" | "done" | "failed" | "cancelled" | "interrupted";
  /** How far it is, 0 to 1. */
  progress: number;
  /** What it says: why it failed, or what it left out. */
  message?: string;
  /** What it found: proposals to review, or a Playtest's turns with the lint. */
  result?: JsonValue;
  /** The input it was given, as kept. */
  input: JsonValue;
  /** Epoch ms of its last change. */
  at: number;
}

/** A job of Build changed once it is kept: its id, kind, world, status, how far it is, the words it carries, and its result (what it found so far, or at the end). */
export interface BuildJobChanged {
  /** The job's id. */
  jobId: string;
  /** What the job does. */
  kind: string;
  /** The world it works on. */
  worldId: string;
  /** Where it stands. */
  status: "running" | "done" | "failed" | "cancelled" | "interrupted";
  /** How far it is, 0 to 1. */
  progress: number;
  /** What it says. */
  message?: string;
  /** What it found. */
  result?: JsonValue;
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
  /** The newest update this process heard of; null before any. */
  update: UpdateProgress | null;
  /** All of it in a sentence or two, as `rpe status` prints it. */
  words: string;
}

/** The turns and jobs running now. */
export interface Busy {
  /** How many turns and jobs run now. */
  busy: number;
}

/** Where in a model call it broke: before any answer came, while it thought, while it wrote a tool call, while it wrote text none of which was shown, or after some of the reply was shown. */
export type CallBreakPoint = "before" | "thinking" | "tool-call" | "text" | "shown";

/** What broke a model call that failed. Made again as the settings say: connection (refused, reset, cut, or the stream ended early), timeout (timed out, or went silent too long), overloaded (the provider is busy or asks to slow down), server (a fault of the provider's server), other. Never made again: credit, key, invalid, too-long, unmade (never sent). */
export type CallFailureKind = "connection" | "timeout" | "overloaded" | "server" | "other" | "credit" | "key" | "invalid" | "too-long" | "unmade";

/** The permission a write or external tool's call ran under: the lane its tier puts it under (external for a tool of the external tier), the user's setting for that lane, and under Confirm the user's word on the call. */
export interface CallPermission {
  lane: string;
  setting: "auto" | "confirm" | "never";
  answer?: { go: true } | { go: false; reason?: string };
}

/** Why a tool call never ran: a limit spent before it started, past the most tool calls one answer of its agent may make, the thing it calls out to not switched on for the user, its lane set to Never, the user's no with his reason, a rule that held it, a permission or rule that could not be asked, or a hook of his that blocked it with its reason. */
export type CallRefusal = { by: "limit"; hit: LimitHit } | { by: "answer"; max: number } | { by: "switch"; thing: { kind: "hook" | "rule-command" | "command-tool" | "mcp-server" | "http-tool" | "connection"; name: string; target: string }; state: "on" | "waiting" | "off" } | { by: "never"; lane: string } | { by: "declined"; lane: string; reason?: string } | { by: "hold"; rule: string } | { by: "unasked"; error: string } | { by: "hook"; hook: string; reason: string };

/** One change of a turn on its card: its id, its operation, the change in words (as the GM view words it), whether it applied, who decided it, where it came from, how sure it is, its value as written, its reports as codes and each in the engine's answers' words, its undo (the operations undoing it would record, what would be left as report codes and, each part one sentence, in the play answers' words: its kind, what it was done to and why it stays; and one sentence of what the undo does) and the changes that already undid it. */
export interface CardChange {
  id: string;
  op: string;
  words: string;
  applied: boolean;
  by: string | null;
  source: string | null;
  standing: string | null;
  value: JsonValue;
  reports: ReportShown[];
  reportWords: string[];
  undo: { ops: string[]; left: ReportShown[]; leftWords: string[]; words: string };
  undoneBy: string[];
}

/** A call held for his word under a lane set to Confirm: its id, the agent, the tool, the lane and the arguments, when it was asked, where it stands (waiting, answered, or taken down when the turn stopped), and his answer once given. */
export interface CardQuestion {
  id: string;
  agent: string;
  tool: string;
  lane: string;
  args: JsonValue;
  asked: number;
  state: "waiting" | "answered" | "taken_down";
  answer: { go: boolean; reason?: string } | null;
}

/** A chat the last migration carried, with how its bootstrap stands (none: no job yet; queued, held, running, asking: its newest job; ended: its newest job ended, how and with what on the job), its newest bootstrap job, that job's question when it waits for his word, and the start as it stands for the chat. */
export interface CarriedBootstrap {
  chat: string;
  state: "none" | "queued" | "held" | "running" | "asking" | "ended";
  job: BootstrapJobShown | null;
  question: BootstrapQuestion | null;
  start: BootstrapStartShown;
}

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

/** What the owner's edit of a character did: whether anything changed, the character as the cast lists it now, and what it could not do or left as it was, in the cast's words. The edit is his own change, which the Author is told of in the next briefing. */
export interface CastEditedReply {
  /** False when the character already stood so. */
  changed: boolean;
  character: CastMemberRow;
  notes: string[];
}

/** The owner sets how large a part a character plays. `as` names the casting; `pin` true pins it, so it stands over the Author's (a casting of his own from then on, until he takes the pin away); false sets it as his casting alone, which the Author may change next turn, and takes any pin away. `as` null with `pin` false takes the pin away and leaves the casting as it is. `line` is the line of the character's part, where he gives one. */
export interface CastingAsk {
  as: CastRole | null;
  pin: boolean;
  line?: string | null;
}

/** A casting in force: the player's pin, else the Author's; with the Author's line for the character, where it wrote one. */
export interface CastingRow {
  as: CastRole;
  /** The player pinned it; it stands over the Author's. */
  pinned: boolean;
  line: string | null;
}

/** A character as the cast lists it: its casting (null: none yet), where its record came from (carried by a migration, played on RPE), its counts, and what waits for its own agent. */
export interface CastMemberRow {
  id: string;
  name: string;
  /** The chat it was first cast in: this chat, or one this chat was branched from. */
  chat: string;
  /** Its casting at the reading; null when it has none there (in the cast, not yet cast). */
  casting: CastingRow | null;
  /** Where its record on the path came from: writes on turns a migration's import wrote (carried), and writes on turns RPE played. */
  from: { carried: boolean; played: boolean };
  /** The world's person it is, by the entity's id; null where none is known. */
  person: string | null;
  counts: EntryCounts;
  waits: CastWaits;
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

/** What waits for a character's own agent at the reading: how many of its perceptions of turns RPE played it has not taken in, the reply of the oldest one's turn (null: none waits, or that turn's reply is not on the path), the turns RPE played since that turn (the one read included), and its last dream (null: it never dreamt), with that turn's reply and its date in story time where the chat's clock shows one. */
export interface CastWaits {
  perceptions: number;
  since: number | null;
  turns: number;
  dreamt: { message: number | null; date: string | null } | null;
}

/** The lists of a character's record the answer bounds. */
export type CharacterListName = "growth" | "mind" | "memories" | "relationships" | "knowledge" | "history" | "perceptions" | "files";

/** Everything on one character's record, by kind; `turn` null: at the chat's newest. Each list is bounded by cast.queryItems and read further back with `part` and `skip`. */
export interface CharacterReply {
  chat: string;
  turn: TurnId | null;
  /** The most items of one list this answer gives (the setting cast.queryItems). */
  listed: number;
  character: CastMemberRow;
  /** Each source bound to it, read live: its title now and how it stands against the base. */
  sources: SourceBindingRow[];
  /** Every version of every part of the base, oldest first. */
  base: BaseVersionRow[];
  now: BaseNow;
  /** The Author's castings of it on the path, oldest first. */
  castings: EntryWriteRow[];
  /** While a principal is away: its whereabouts and intention as the Author recorded them (the entry's fields); null otherwise. */
  away: EntryRow | null;
  /** Its game side by reference to the world's person it is: where it is, what it holds, what it owns elsewhere, its values; null where the store holds no such person. */
  game: { [key: string]: JsonValue } | null;
  growth: EntryItems;
  /** What is on its mind; the carried mind files are under `files`. */
  mind: EntryItems;
  memories: MemoryItems;
  relationships: EntryItems;
  knowledge: EntryItems;
  history: EntryItems;
  perceptions: PerceptionItems;
  files: MindFileItems;
}

/** A chat's head as one document: the chat and the world it plays (null where it plays none), the revision in force, the engine that folded it, the run's seed, the clock in minutes since the world's epoch, the world as played (its document) and the engine's state as plain JSON. */
export interface ChatExportReply {
  chat: string;
  world: string | null;
  revision: string;
  engine: string;
  seed: string;
  clock: number;
  worldDoc: JsonValue;
  state: JsonValue;
}

/** What came of a chat the last run looked at, in the run's own words. */
export type ChatImportOutcome = "imported" | "replaced" | "played on RPE: left alone" | "a chat made from it was played on RPE: left alone" | "gone from Lumiverse: removed" | "gone from Lumiverse, played on RPE: left alone" | "gone from Lumiverse, a chat made from it was played on RPE: left alone" | "not imported" | "not asked for";

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
  /** When its newest turn on RPE began; null for a chat RPE holds and has not played yet (one a migration imported, one a world was attached to, one a page named before its first turn). */
  lastTurnAt: number | null;
  /** Whether a turn of it runs now. */
  running: boolean;
  /** Whether RPE has played a turn of it. */
  played: boolean;
  /** Whether it plays a world in RPE's store, attached from its start or taken from its next turn, as the chat's state reads it. */
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

/** What the move came to: the revision the chat plays from its next turn, the id its Undo takes (null where it already plays that revision), whether it took effect, and whether a turn runs now. */
export interface ChatUpgraded {
  /** The revision from the next turn. */
  revision: string;
  /** The id its Undo takes. */
  edit: string | null;
  /** It took effect where it was recorded. */
  applied: boolean;
  /** A turn runs now. */
  waiting: boolean;
}

/** Whether the Upgrade was taken back, and why not where it was not. */
export interface ChatUpgradeUndone {
  /** Something was recorded. */
  undone: boolean;
  /** Why not, in words; empty where it was. */
  words: string;
}

/** What the chat's history window is now, for its marker: whether it is on, the first history message it keeps on the chat's current path, the message just above that, how many messages lie above it, and how many of those the story does not cover yet. */
export interface ChatWindowReply {
  /** The window is on for this chat. */
  on: boolean;
  /** Lumiverse's id of the first history message the window keeps, with the step and the hold as the chat's settings set them; null where it keeps all, or is off. */
  first: string | null;
  /** Lumiverse's id of the history message just above `first`, the one the marker stands under; null where nothing is above it. */
  before: string | null;
  /** History messages above the window. */
  above: number;
  /** Of those, how many the story record does not cover yet; a hidden message counts, among those above, only where the chat's setting lets agents read hidden messages. */
  uncovered: number;
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

/** One of RPE's connections, by its id, picked for the work one of his own agents does, where today's choice named a connection that lives in Lumiverse. */
export interface ConnectionPick {
  agent: string;
  connection: string;
}

/** Each of the agent's files whose `model:` now names the connection picked: the attached one, and the one in force where it is switched on. */
export interface ConnectionPicked {
  written: string[];
}

/** A connection as the routes show it: whether a key is set and nothing of the key; its model's limits as RPH uses them, null where nobody knows them; why they could not be read, where they could not; and its newest tag check, whether it keeps the reply's tags and the reply form it got. */
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
  /** How many times a failed call on it is made again, whenever in the call it failed (a request passed through with no turn: only before any answer came); calls.retries when absent. */
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
  /** Its newest tag check; null where none was run on it. */
  tagCheck?: TagCheck | null;
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

/** An agent's limits as a definition's header and the settings write them: `time` and `callTime` in seconds. Each absent is no limit of its own. */
export interface DefinitionLimitsView {
  calls?: number;
  tokensIn?: number;
  tokensOut?: number;
  time?: number;
  callTokensIn?: number;
  callTokensOut?: number;
  callTime?: number;
  toolRounds?: number;
  toolsPerAnswer?: number;
  toolsAtOnce?: number;
  messages?: number;
}

/** What a definition runs on, resolved among the user's connections for the chat it is listed for, with what the settings there set for it standing over its header: the connection its header names (his default where it names none), that connection's model, the effort it thinks at (the settings' for its definition, else the settings' for its connection, else its definition's, else its connection's own), the level its model is really sent for that effort (the nearest it has where it has none so high; null where its provider's own default stands or no connection resolves), and the limits it is held to (its header's, each one the settings set standing over it; absent where none holds). */
export interface DefinitionRun {
  connection: { id: string; name: string } | null;
  model: string | null;
  effort: Effort | null;
  sent: Effort | null;
  limits?: DefinitionLimitsView;
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
  horizon: { known: true; entries: number; named: number; clock: boolean; time: HorizonPartShown; place: HorizonPartShown; onStage: HorizonPartShown; holdings: HorizonPartShown } | FactNotKnown;
  principals: { known: true; principals: { id: string; name: string; base: string[]; memories: number; own: number; ownFromPerceptions: number }[] } | FactNotKnown;
}

/** What a turn's time brought due, soonest first, as many as the chat's engine.maxDueItems lists, and how many more fell due (null: more did, uncounted). */
export interface DueReply {
  turn: TurnId;
  /** The turn's span as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
  more: number | null;
}

/** One thing a turn's time brought due: what kind it is in a person's words, what it is (whose it is by name, what, and where), when it fell due as the world prints it, the level it concerns (null where none), and each change of the turn that concerns it, one to a line in the words the GM view uses for a change (none while there were none). */
export interface DueShown {
  label: string;
  words: string;
  when: string;
  at: string | null;
  changes: string[];
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

/** What the press removed: the book, the chats it was taken out of, whether the book itself was deleted, and what could not be done. */
export interface EngineBookRemoved {
  book: string;
  /** The chats the book was taken out of. */
  detached: string[];
  /** The book was deleted; false where Lumiverse had it no longer, or the removal stopped. */
  removed: boolean;
  /** Why the removal stopped part way, in Lumiverse's words; null where it went through. */
  failed: string | null;
}

/** A book today's build made for its worlds, as the press beside it would remove it: its entries, and every chat it is attached to, by name. */
export interface EngineBookShown {
  book: string;
  name: string;
  /** How many entries the book holds, all removed with it. */
  entries: number;
  /** The chats it is attached to: the press takes it out of each, and changes nothing else of them. */
  chats: { chat: string; name: string }[];
}

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

/** A list of entries, bounded: the newest the setting cast.queryItems allows after passing over `skip`, with what was left out on either side. */
export interface EntryItems {
  items: EntryRow[];
  /** How many the record holds in all. */
  total: number;
  /** How many older ones are left out before what is given. */
  before: number;
  /** How many newer ones are left out after it. */
  after: number;
}

/** The parts of a character's record kept as rows tied to turns, the casting aside. */
export type EntryPart = "growth" | "mind" | "relationship" | "knowledge" | "history" | "perception" | "memory" | "away" | "edit" | "dream";

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

/** A fact a rule's trigger can name, RPH's or RPE's: what it counts, its groups and fields, its value in the open chat where RPE counts it (null with no chat, or for one of RPH's), and the rules whose text names it. */
export interface FactShown {
  name: string;
  counts: string;
  by?: string[];
  fields?: string[];
  from: "rph" | "host";
  clash?: true;
  value: { count: number; names?: string[]; by?: { [key: string]: number }; namesBy?: { [key: string]: string[] }; fields?: { [key: string]: JsonValue } } | null;
  rules: string[];
}

/** Where a value or a fact came from. */
export type FactSource = "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented";

/** The facts a trigger can name. */
export interface FactsReply {
  facts: FactShown[];
}

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

/** A file pinned for an agent, or the pin taken away, in the `stack.pins` list of a level's config: the global level's, or a chat's, which names the chat. */
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

/** A file's name switched off or on again in the `stack.off` list of a level's config: the global level's, or a chat's, which names the chat. */
export interface FileSwitchAsk {
  level: "global" | "chat";
  chat?: string | null;
  off: boolean;
  /** For a hooks file: the hook of it switched, by its name. */
  hook?: string;
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

/** A rule that fired in the chat, as kept: the firing whole, with its id, when, and the turn or the job of his it was told in (run and talk: not kept, so null). */
export interface FiringShown {
  firing: RuleFiring;
  id: string;
  at: number;
  turn: string | null;
  run: string | null;
  job: string | null;
  talk: string | null;
}

/** A page of a chat's firings, newest first, and the cursor of the next page (null: none). */
export interface FiringsReply {
  items: FiringShown[];
  next: string | null;
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

/** A name a definition's `given:` lists: what kind of thing it is, who finds it (RPH its own kinds, RPE its views), and whether RPE gives it at the chat's newest turn (null for RPH's, found at the run). */
export interface GivenName {
  name: string;
  kind: "file" | "chat" | "lore" | "prompt" | "world" | "story" | "cast" | "turn" | "index" | "ruleset" | "map" | "view";
  by: "rph" | "rpe";
  found: boolean | null;
}

/** What each agent definition in force for a chat is given by name, read at the chat's newest turn (null: it has none yet), and the names of RPE's that nothing provides. */
export interface GivenReply {
  chat: string;
  turn: string | null;
  definitions: { name: string; off: boolean; given: GivenName[]; missing: string[] }[];
}

/** Going back as it stands, and his word: the steps with the configured branch and what the swap recorded, the permissions by name, what today's build put in Lumiverse, and, only once he has said he will not go back, each engine book with a press. */
export interface GoingBackShown {
  /** The branch the previous build is kept on (`migration.previousBranch`). */
  branch: string;
  /** The steps of going back, as rpe down prints them. */
  steps: string[];
  /** The permissions the previous build asks for, by name. */
  permissions: string[];
  /** When he said he will not go back; null where he has not. */
  said: string | null;
  /** What today's build put in Lumiverse, counted, as the last real run found it; null before any run. */
  lumiverse: JsonValue | null;
  /** The engine books in Lumiverse now, each with a press: null until he has said he will not go back. */
  books: EngineBookShown[] | null;
  /** Why no engine book is listed where he has said it: RPE is not set up for a Lumiverse, or Lumiverse could not be read. */
  booksWhy: string | null;
}

/** A change a reflection proposed and the Author accepted, laid over the base: its words, what caused it, and its date in story time. */
export interface GrowthOverBase {
  id: string;
  text: string;
  cause: string | null;
  date: string | null;
}

/** A kind of guidance a folder of the tree holds: the agents' definitions, skills, rules, hooks, prompt parts or tools. */
export type GuidanceKind = "agents" | "skills" | "rules" | "hooks" | "prompts" | "tools";

/** A moment a hook of his runs at, as his hooks file writes it. */
export type HookEvent = "turn-start" | "before-tool" | "after-tool" | "before-release" | "after-release" | "run-end" | "session-close" | "before-compaction" | "job-start" | "job-end";

/** An entry of the Author's horizon, as the store keeps it: as the Author wrote it, with the level of the world it names now (none: words that name nothing). */
export interface HorizonEntryRow {
  at: string;
  ref: string | null;
  name: string | null;
  /** How deep the world state shows it: a whole number of levels, or `full`. */
  depth: number | "full";
}

/** One part of the horizon's seed: whether it is recorded, and how many of its values stand established, assumed or proposed by the change that set each, and how many carry no standing. */
export interface HorizonPartShown {
  recorded: boolean;
  established: number;
  assumed: number;
  proposed: number;
  none: number;
}

/** One of the install's facts, which the command line sets and no page writes: its key in config.json, what it is, its value, and where it was given (config.json, the environment, or where the install put the data folder). */
export interface InstallFact {
  key: string;
  name: string;
  value: JsonValue;
  from: "config.json" | "environment" | "install";
}

/** One change a job recorded: its id, its lane and operation, its value, who decided it, where it came from, how sure it is, what it cites, whether it applied, its reports, and the changes of his that undid it. */
export interface JobChange {
  id: string;
  lane: string;
  op: string;
  value: JsonValue;
  by: string | null;
  source: string | null;
  standing: string | null;
  precision: string | null;
  cite: JsonValue;
  applied: boolean;
  reports: ReportShown[];
  undoneBy: string[];
}

/** What a job recorded, change by change in the order recorded, and the evidence it was told as it went (its gap checks, consents and rules fired). */
export interface JobChangesReply {
  job: string;
  changes: JobChange[];
  told: TurnTold;
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

/** Limits a start or a carry-on gives one job, each a whole number above 0: model calls, tokens sent, tokens written, tokens together as the day's job tokens are counted, seconds, and the tokens at which it is held and he is asked whether to go on. */
export interface JobLimitsAsk {
  calls?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
  time?: number;
  askAt?: number;
}

/** A limit in force for jobs: its setting's key, its value (null: none), and the use it is held against: the jobs running now for the jobs at once, the jobs started over the window for the jobs in a day (with the window and the limit as the harness counts them), else the tokens used over the last 24 hours; null where it counts no use. */
export interface JobLimitShown {
  key: string;
  value: JsonValue;
  used: number | null;
  /** For the jobs in a day: the window the count is over, in milliseconds back from now. */
  window?: number;
}

/** Why a job was not started or a control did not apply: jobs switched off; the day's count or tokens reached; a limit that is no whole number above 0; no such agent or no model for it; no such job; a job not in a state the control applies to, or not stopped at one of its own limits; his job-start hook, with its reason; a tag check of none of his connections, or whose part is missing or not as it needs. */
export type JobRefusal = { refused: "off" } | { refused: "day-count"; max: number; value: number; connection?: string } | { refused: "day-tokens"; max: number; value: number } | { refused: "limit"; limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "askAt"; value: number } | { refused: "agent"; agent: string } | { refused: "no-job"; id: string } | { refused: "state"; id: string; state: JobState; applies: JobState[] } | { refused: "not-at-limit"; id: string } | { refused: "hook"; hook: string; reason: string } | { refused: "connection"; connection: string } | { refused: "part"; part: "tag-check" | "reply-contract" };

/** A job as it stands after the call. */
export interface JobReply {
  job: JobView;
}

/** One job: its record, its run's trace as the live view shows a turn's, what its run spent by agent (null before it spent anything or after the record was let go), and how full each of its agents' windows is while it runs. */
export interface JobShownReply {
  job: JobView;
  trace: TraceRecord[];
  usage: RunUsage | null;
  windows: { agent: AgentRef; gauge: WindowGauge }[];
}

/** A job he starts: the agent definition it runs as, what it is to do, what it is given by name, and limits of its own. */
export interface JobStartAsk {
  definition: string;
  brief: string;
  /** What it is given by name, as an agent's attachments are named. */
  given?: string[];
  /** Limits of its own: each holds in place of the setting's for this job. */
  limits?: JobLimitsAsk;
}

/** Where a job stands. */
export type JobState = "queued" | "held" | "running" | "asking" | "done" | "failed" | "cancelled" | "off-path" | "interrupted";

/** Who ended a job before its agent was done: an agent, by its job_cancel, with the run it worked in; the owner, by his own press; or RPH itself, and why: a limit reached, the turn that started it left the path, RPE stopping, or a restart that found it cut off. */
export type JobStopper = { by: "agent"; agent: AgentRef; run: string } | { by: "user" } | { by: "engine"; reason: "limit" | "off-path" | "stopping" | "restart" };

/** His two switches over all his jobs (switched off: none starts; held: those running wait at their next call and none starts), and the limits in force for jobs with the day's use. */
export interface JobSwitchesReply {
  off: boolean;
  held: boolean;
  limits: JobLimitShown[];
}

/** What a job he started was told as it went. */
export interface JobToldReply {
  job: string;
  told: TurnTold;
}

/** A job: its agent, what it was asked, where it stands, its scope, who started it, when, what it spent, its report, the limit it ended at, who ended it, what its start named and gave, the character its agent plays, what it was not given, what it wrote, the job it repeats, where it asks, and what the owner gave it beyond its limits. */
export interface JobView {
  id: string;
  agent: string;
  brief: string;
  state: JobState;
  scope: RunScope;
  startedBy: AgentRef | "user";
  started: number;
  ended?: number;
  usage: Usage;
  report?: string;
  limit?: LimitHit;
  /** For a job ended before its agent was done (cancelled, at a limit, off the path, interrupted): who ended it. */
  stoppedBy?: JobStopper;
  /** The attachments its start named, by name. */
  attach?: string[];
  /** The character its agent plays, as its start named it. */
  plays?: string;
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
  /** What the owner gave it beyond its limits by carrying it on, added up over every time he did. */
  more?: JobLimits;
  /** For a tag check: the connection it measures, by id. */
  check?: { connection: string };
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

/** The player's journal: each quest he may see, at the chat's newest turn or as it stood at one of its turns. A quest set to show him nothing is absent: no row, no count. */
export interface Journal {
  chat: string;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  /** How many of the quests he may see are open. */
  open: number;
  quests: JournalQuestRow[];
}

/** A quest the player may see, as his journal shows it: whole, with what it is and its stakes, or only its name and the stages the Author showed him. */
export interface JournalQuestRow {
  id: string;
  kind: "quest" | "secret" | "puzzle" | "agenda";
  name: string;
  /** The world defines the quest: its labels and conditions are as the world wrote them. */
  world: boolean;
  /** What it is. */
  objective: string | null;
  /** Why it matters. */
  why: string | null;
  stakes: string | null;
  rewards: string | null;
  stages: QuestStageRow[];
  /** Who it involves, as tree refs. */
  who: string[];
  /** Where it takes place, as tree refs. */
  where: string[];
  /** What it involves, as tree refs. */
  things: string[];
  /** How it closed; null while it is open. A quest of the world's standing on an end stage the story never closed is closed as that stage ended it. */
  closed: QuestClosedRow | null;
  /** The player sees the whole quest; false: only its name and the stages named. */
  whole: boolean;
  /** The thread of the story it belongs to, for a quest seen whole; never given for one seen by stages. */
  thread: string | null;
}

/** A thing RPE or its harness keeps in memory: its name, how many, and the characters of text they hold where that is counted. */
export interface KeptCount {
  name: string;
  count: number;
  chars: number | null;
}

/** How long a kind is kept: for good, until the chat is deleted or he prunes it, or by a setting, which gives its key and what it is now (null: none, all kept). */
export type KeptFor = { by: "never" } | { by: "chat" } | { by: "setting"; setting: string; value: number | null };

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

/** What a lane of a turn did: how many of its changes took effect, and the lines a person reads of them (the engine's worded as his character knows them; the story's, each beat the turn wrote). */
export interface LaneShown {
  lane: "story" | "engine";
  count: number;
  lines: string[];
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

/** A limit reached: which, over what, the limit and the count; whose, for a limit per agent; which connection, for a day's count of its jobs or its throttle; and, where the limit was not passed but too little was left under it for an answer, the least room an answer is given. */
export interface LimitHit {
  limit: "calls" | "tokensIn" | "tokensOut" | "tokens" | "time" | "depth" | "agents" | "jobs" | "callTokensIn" | "callTokensOut" | "callTime" | "toolRounds" | "repeats" | "tokensPerMinute";
  per: "turn" | "agent" | "job" | "day" | "connection";
  max: number;
  value: number;
  agent?: AgentRef;
  connection?: string;
  /** Set where what was left under the limit, max less value (value counting the next call's prompt, for tokens), was under the least room an answer is given (limits.minAnswerTokens), so the next call was not made: that least room, in tokens. */
  floor?: number;
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
export type LiveEvent = { chat: string; seq: number; kind: "trace"; at: number; data: TraceRecord } | { chat: string; seq: number; kind: "delta"; at: number; data: TraceDelta } | { chat: string; seq: number; kind: "reply"; at: number; data: ReplyPiece } | { chat: string; seq: number; kind: "released"; at: number; data: ReplyReleased } | { chat: string; seq: number; kind: "state"; key: "state"; at: number; data: Record<string, never> } | { chat: string; seq: number; kind: "handler_failed"; at: number; data: { op: string; error: string; turn: string; change: number | null } } | { chat: string; seq: number; kind: "requests"; at: number; data: { waiting: number } } | { chat: string; seq: number; kind: "folder"; at: number; data: { turn: string; path: string } } | { chat: string; seq: number; kind: "job"; at: number; data: { job: JobView } } | { chat: string; seq: number; kind: "empty_reply"; at: number; data: { turn: string; message: string; off: boolean } } | { chat: string; seq: number; kind: "world"; at: number; data: WorldChanged } | { chat: string; seq: number; kind: "build_job"; at: number; data: BuildJobChanged } | { chat: string; seq: number; kind: "extension"; at: number; data: ExtensionStatusReply };

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
  /** Entries no run has written lines for as they stand now: those never indexed, and those indexed at an earlier revision. */
  unindexed: number;
  /** Of those, the entries a run indexed at an earlier revision and that have changed since: their lines still show, marked as out of date, until a run redoes them. */
  stale: number;
  /** The kinds the chat's entries are given now, each once: the page offers them as choices beside the shipped indexer's own. */
  kinds: string[];
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

/** One grid in full, as the chat plays it: both layers as data. What is drawn (its rows of symbols with the squares the chat changed laid over, its legend, where it comes from), what moves (everyone and everything on a square, those at the place with none and where they are kept, each door's state), the squares and symbols the chat changed, and the scale and time step. */
export interface MapGridReply {
  place: string;
  name: string;
  grid: string;
  map: string | null;
  from: "world" | "laid" | "changed";
  width: number;
  height: number;
  scale: JsonValue;
  rows: string[];
  legend: { [key: string]: JsonValue };
  doors: ({ square: number[]; state: "open" | "closed" | "locked" })[];
  pieces: MapPieceShown[];
  unplaced: { id: string; name: string; kind: string; zone?: string; words?: string }[];
  edits: { squares: number; legend: string[] };
}

/** What keeping a chat's map in the world came to: what was copied into the world's draft, what was left (the id and why), and the draft's version after it, with whether anything was written. */
export interface MapKept {
  kept: { maps: string[]; places: string[]; paths: string[]; settings: boolean };
  skipped: ({ id: string; code: "not_changed" | "in_draft_already" | "no_map" })[];
  draft: { version: number; written: boolean };
}

/** A grid of a chat as the Places page lists it: the place it is the grid of and its name, the grid's id, the map that draws it (none for a grid authored without one), where it comes from (the world's own, laid in play, or the world's own changed in play), its size in squares and how wide a square is. */
export interface MapListed {
  place: string;
  name: string;
  grid: string;
  map: string | null;
  from: "world" | "laid" | "changed";
  width: number;
  height: number;
  feet: number;
  unit: "feet" | "metres";
}

/** Someone or something on a grid: its id, name and kind, its square (the top left of its footprint), its footprint when it covers more than one square, what it blocks, what it lies on or in, and its life state when it is not alive. */
export interface MapPieceShown {
  id: string;
  name: string;
  kind: string;
  square: number[];
  size?: number[];
  blocks?: { way?: boolean; view?: boolean };
  on?: string;
  within?: boolean;
  state?: string;
}

/** The grids of a chat, by place. */
export interface MapsReply {
  maps: MapListed[];
}

/** What an edit of his on a map came to: the id its Undo takes (null when it changed nothing), and what the grid found that does not add up, which was done all the same. */
export interface MapWrote {
  undo: string | null;
  advised: JsonValue[];
}

/** One decision the script plants in the scene, with the check of whether the scene honoured it: what was planted and in which turn, the question put to the judging connection and the turn it tested, the excerpt of the reply and of the Author's records it judged, whether it found the decision honoured, and the judge's own answer. */
export interface MeasureDecision {
  name: string;
  planted: number;
  check: string;
  tested: number;
  evidence: string;
  honoured: boolean;
  answer: string;
}

/** What a stretch of turns cost, as the measurement counts it from RPE's own record of each turn: tokens in, out and cached, the time to the reply's end and to the run's end (ms), and the model calls made. */
export interface MeasureFigures {
  tokensIn: number;
  tokensOut: number;
  cached: number;
  replyMs: number;
  runMs: number;
  calls: number;
}

/** A report kept: the id RPE gave it and when it received it (ms). */
export interface MeasurementKept {
  id: string;
  at: number;
}

/** A kept report whole, as it was sent, with its id and when RPE received it. */
export interface MeasurementRead {
  id: string;
  at: number;
  report: MeasurementReport;
}

/** A run of the session measurement: when it ran, the Author's connection and model, the judging connection and model, the script's hash, the three carry modes as played, and the recommendation of whoever ran it (blank until they write it; a report with none is kept and the page marks it as waiting for one). */
export interface MeasurementReport {
  ran: number;
  connection: string;
  model: string;
  judge: { connection: string; model: string };
  script: string;
  modes: MeasureMode[];
  recommendation: string;
}

/** A kept report in the list: its id, when RPE received it, when it ran, the connection and model it ran on, the judging connection, and whether its recommendation is written. */
export interface MeasurementRow {
  id: string;
  at: number;
  ran: number;
  connection: string;
  model: string;
  judge: string;
  recommended: boolean;
}

/** The script played in one carry mode: each turn's figures, their totals and medians, each planted decision with its check, and the look-ups made (calls of read tools) and the ones that repeated an earlier turn's, each named. */
export interface MeasureMode {
  mode: CarryMode;
  turns: MeasureTurn[];
  totals: MeasureFigures;
  medians: MeasureFigures;
  decisions: MeasureDecision[];
  lookups: { total: number; repeated: MeasureRepeat[] };
}

/** A look-up an agent made again: the tool and its arguments as they were made, the turn that repeated it and the turn that made it first. */
export interface MeasureRepeat {
  tool: string;
  args: string;
  turn: number;
  first: number;
}

/** One turn of the measurement's script as played in a mode: its number in the script, and what it cost. */
export interface MeasureTurn {
  n: number;
  figures: MeasureFigures;
}

/** A memory's tier: top of mind, short term, long term. */
export type MemoryBand = "top" | "short" | "long";

/** The process's own memory figures, in bytes: its resident size, the engine's heap, what the heap's objects own outside it, and what the allocator holds. */
export interface MemoryFigures {
  /** The process's resident size now: what it holds in the machine's memory. */
  holds: number;
  /** The engine's heap: what its objects take, and the heap's whole size with its free room. */
  heap: { used: number; total: number };
  /** What the heap's objects own outside it: the text of long strings and the bytes of buffers. */
  outside: number;
  /** Of what is outside the heap, the bytes of buffers. */
  buffers: number;
  /** What the allocator outside the heap holds from the system, freed memory it has not given back yet among it. */
  allocator: number;
}

/** The process's figures before and after a full collection, and how long it took in milliseconds. */
export interface MemoryFreed {
  before: MemoryFigures;
  after: MemoryFigures;
  ms: number;
}

/** A list of memories, bounded as the entries are. */
export interface MemoryItems {
  items: MemoryRow[];
  /** How many the record holds in all. */
  total: number;
  /** How many older ones are left out before what is given. */
  before: number;
  /** How many newer ones are left out after it. */
  after: number;
}

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

/** One chat of a report in full: as listed, what today's readers found of it (a document the migration kept as JSON), and what the last real run that imported it carried of it. */
export interface MigrationChatReply {
  chat: MigrationChatShown;
  read: JsonValue | null;
  carried: JsonValue | null;
}

/** One chat of a report: its name in Lumiverse (null where Lumiverse's database can't be read), what today's readers found of it, what the real run did with it and why, its own turns imported, the messages it shares with the chat it was made from, its check (matched at the head and at how many swipes, where its swipes were placed, how many differences), and, where the report found it off RPE, where it stands now (the same read as the list at the head of the page; null where the report did not find it off RPE). */
export interface MigrationChatShown {
  chat: string;
  name: string | null;
  engine: "classic" | "agents" | "harness" | null;
  turns: number;
  replies: number;
  journal: "read" | "none" | "unreadable" | "malformed" | "from another run of this chat" | "not opened" | null;
  waiting: { questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean } | null;
  outcome: ChatImportOutcome | null;
  why: string | null;
  imported: number;
  shares: { chat: string; messages: number } | null;
  check: { matched: { head: boolean; swipes: number; of: number }; placed: { own: number; shown: number; lost: number }; differences: number } | null;
  offRpe: OffRpeShown | null;
}

/** A page of a report's chats, in the order the report holds them. */
export interface MigrationChatsReply {
  items: MigrationChatShown[];
  next: string | null;
}

/** A page of where a chat's state differed from today's fold, in the order the run checked it. */
export interface MigrationDifferencesReply {
  items: FoldDifference[];
  next: string | null;
}

/** One chat's record of why a run could not carry it, as RPE's data folder keeps it, and the file it is in: when that run read the previous build's data, the stage, the error's own name, message and stack, the world and revision, the message it stood at (its id, its place in the chat, the swipe), the record of the ledger that broke by its place, its kind and its shape alone (never its content), and where that record is in the previous build's files. */
export interface MigrationFailureReply {
  path: string;
  failure: { chat: string; at: string; stage: "read" | "fold" | "store" | "check"; error: { name: string; message: string; stack: string | null }; world: { id: string; revision: string } | null; message: { id: string; number: number; swipe: number } | null; record: { place: string; kind: string; shape: JsonValue } | null; file: { store: "lumiverse-database" | "user-storage" | "runtime-copy"; path: string; row: string | null; at: string; inside: string | null } | null };
}

/** A report whole, to be saved as a file: the name to save it under, the report (a document the migration made, as JSON: counts, paths and checksums, never content) and its printed text. */
export interface MigrationFileReply {
  name: string;
  report: JsonValue;
  text: string;
}

/** One thing a report found: where it is, its path, its size and SHA-256, its row and fate (null: found, not classified), and the report's note on it. */
export interface MigrationItemShown {
  where: "user storage" | "extension storage" | "runtime" | "Lumiverse database";
  path: string;
  bytes: number;
  sha256: string;
  row: string | null;
  fate: "carried" | "attached" | "archived" | null;
  note?: string;
}

/** A page of the things a report found, in the order it found them. */
export interface MigrationItemsReply {
  items: MigrationItemShown[];
  next: string | null;
}

/** The Migration page's summary: the last real run and the page's rehearsal in brief; the folders a rehearsal reads; the backup with its checksum and whether it is still there; what is waiting on the user; the swap's steps; going back's steps with the permissions the previous build asks for; and what today's build put in Lumiverse. Before any run as after. */
export interface MigrationReply {
  /** Null before any real run. */
  run: MigrationSummaryShown | null;
  rehearsal: RehearsalShown;
  /** The folders a rehearsal from the page reads: the last run's, else Lumiverse's database's folder as RPE's config names it and today's runtime's own. */
  sources: { lumiverse: string | null; runtime: { configDir: string; dataDir: string } | null };
  /** The backup the last run took before it wrote anything. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  /** The chats a real run did not carry that hold records of the previous build, at the top of the page while each one's record of why is kept, and the chats the last real run carried that an earlier one could not; null where there is neither. */
  notCarried: NotCarriedShown | null;
  /** The chats still off RPE: a group of its own at the head of the page. */
  offRpe: OffRpeShown[];
  /** In the order the plan lists it: GUIDANCE.md first. */
  waiting: WaitingOnUser[];
  /** The rows he has given (`migration.rows`). */
  given: ({ path: string; fate: "archived" | "attached"; line: string })[];
  swap: string[];
  goingBack: { steps: string[]; permissions: string[] };
  /** What today's build put in Lumiverse, left as it is until the user says they will not go back. */
  lumiverse: JsonValue | null;
}

/** A row of the plan's table as a report counts it: what it holds, how it is found, its things' ends (found, carried, attached, archived, kept in the backup only), those with no place and why, their bytes and digest, what it counts inside other rows' things (a document the migration kept as JSON), and after a real run where its things now are. */
export interface MigrationRowShown {
  row: string;
  what: string;
  found: "own" | "inside" | "not read";
  why?: string;
  count: { found: number; carried: number; attached: number; archived: number; backup: number };
  stranded: { count: number; why: string[] } | null;
  bytes: number;
  digest: string;
  inside: JsonValue | null;
  landed: string | null;
}

/** A page of a report's rows, in the plan's order. */
export interface MigrationRowsReply {
  items: MigrationRowShown[];
  next: string | null;
}

/** A migration report in brief: a rehearsal or the real run, when it read today's data, what you said there is no runtime of the previous build for and this user's found all the same (what was found, and what is therefore not carried), why the real run would not start on it (after a real run: what of it did not balance), how much of each part there is to page through, the disk it takes and the backup a real run took. */
export interface MigrationSummaryShown {
  mode: "rehearsal" | "real run";
  at: string;
  disowned: string[];
  refusals: string[];
  counts: { rows: number; chats: number; items: number; notClassified: number; unreadable: number; differences: number; offRpe: number };
  disk: { backup: number; import: number; total: number; free: number | null };
  backup: { path: string; bytes: number; sha256: string } | null;
}

/** A report's printed text, as the rehearsal or the run printed it. */
export interface MigrationTextReply {
  text: string;
}

/** A list of carried mind files, bounded as the entries are. */
export interface MindFileItems {
  items: MindFileRow[];
  /** How many the record holds in all. */
  total: number;
  /** How many older ones are left out before what is given. */
  before: number;
  /** How many newer ones are left out after it. */
  after: number;
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

/** A model's limits as RPH uses them, each found on its own: the user's entry, else pi's catalog, else what the connection's server reported; null where nobody knows it; whether it takes audio and video, the user's entry else the server's report, never asked for (a request passed through that carries one the model is said to take none of is refused); and the figures nobody has given, in the order the page asks for them. */
export interface ModelLimits {
  contextWindow: ModelLimit | null;
  maxTokens: ModelLimit | null;
  pictures: ModelPictures | null;
  audio: ModelMedia | null;
  video: ModelMedia | null;
  asked: ModelFigure[];
}

/** A model's figures as entered or reported: its context window and its longest answer, in tokens, and whether it takes pictures, audio and video. */
export interface ModelLimitsEntry {
  contextWindow?: number;
  maxTokens?: number;
  pictures?: boolean;
  audio?: boolean;
  video?: boolean;
}

/** Whether a model takes audio, or video, and where that came from: pi's catalogue says neither, so the user's entry or the connection's server. */
export interface ModelMedia {
  takes: boolean;
  from: "user" | "connection";
}

/** Whether a model takes pictures, and where that came from. */
export interface ModelPictures {
  takes: boolean;
  from: "user" | "pi" | "connection";
}

/** His word that he will not go back, confirmed. */
export interface NoGoingBackAsk {
  /** true: he confirmed he will not go back; kept once, and the first time stands. */
  sure: boolean;
}

/** When he said he will not go back. */
export interface NoGoingBackSaid {
  said: string;
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

/** The chats a real run did not carry that hold records of the previous build, while each one's record of why is kept, in the migration's own words (`.prompts/history-migration.md`): the head, with where the records are kept, and each chat by its id, with its line (its name and its character's as Lumiverse's database holds them, its id, and the cause: the stage, the message it stood at, the error's own words) and what of it RPE holds and what it does not, and what to do, and the file of its record (null where he removed it); and the chats the last real run carried that an earlier run could not, each with its line. */
export interface NotCarriedShown {
  head: string;
  chats: ({ chat: string; line: string; lines: string[]; record: string | null })[];
  carried: { chat: string; line: string }[];
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

/** A chat that was on today and was on none of RPE's connections when the run read it, as it stands now: the connection it is pinned to in Lumiverse (null: none, so it follows the one active for you) and its name; where none, the connection active for you now with its name and whether it is one of RPE's; whether RPE has played it; and whether it is on RPE now (pinned to one of RPE's connections, or pinned to none while the one active for you is one of RPE's). Your step, in Lumiverse: choose one of RPE's connections for it. */
export interface OffRpeShown {
  chat: string;
  pinned: string | null;
  pinnedName: string | null;
  active: { id: string; name: string | null; rpe: boolean } | null;
  played: boolean;
  /** Whether it is done: its line is struck. */
  done: boolean;
}

/** What a change to a chat's own values came to: whether it was recorded, the id its Undo takes (null where nothing was recorded), and the answer in words. */
export interface OwnAnswer {
  applied: boolean;
  undo: string | null;
  words: string;
}

/** One change to what a chat plays by on its own: a realism level for everyone, one band's cap for a part of life, what something you add that the world doesn't have becomes, or when checks roll and when a failed try may be tried again (each as far as it is given); or the claims or the check rules given back to what the chat's world says. */
export type OwnAsk = { kind: "level"; domain: "money" | "gear" | "vehicles" | "castlife" | "relationships" | "space" | "calendar" | "weather" | "sheets"; to: number } | { kind: "cap"; band: "principal" | "supporting" | "background"; domain: "money" | "gear" | "vehicles" | "castlife" | "relationships" | "space" | "calendar" | "weather" | "sheets"; to: number } | { kind: "claims"; mode?: "real" | "ask" | "hold"; capped?: boolean } | { kind: "claims-world" } | { kind: "checks"; when?: "every" | "risky" | "marked" | "never"; riskyAt?: number; trivialAt?: number | null; impossibleAt?: number | null; retry?: "free" | "changed" | "once"; retryAfter?: number } | { kind: "checks-world" };

/** What a chat plays by on its own now: its realism (the preset its levels match, each part of life's level, each band's cap, the floors the world's ruleset sets, and the world's tiers in each band), what something you add that the world doesn't have becomes (and whether the chat set it), and when checks roll and when a failed try may be tried again (and whether the chat set it). A chat that plays no world answers `world: false` and nothing else: it has no values of its own and no world to follow. */
export type OwnValues = { world: true; realism: { preset: "story" | "grounded" | "simulation" | "custom"; levels: { [key: string]: number }; caps: { [key: string]: { [key: string]: number } }; floors: { [key: string]: number }; tiers: { [key: string]: string[] } }; claims: { mode: "real" | "ask" | "hold"; capped: boolean; own: boolean }; checks: { when: "every" | "risky" | "marked" | "never"; riskyAt: number; trivialAt: number | null; impossibleAt: number | null; retry: "free" | "changed" | "once"; retryAfter: number; own: boolean } } | { world: false };

/** The proof of a page's nonce, keyed by the hash of its page token. */
export interface PageProof {
  /** HMAC-SHA-256 of the nonce, keyed by the token's hash, as lowercase hex. */
  proof: string;
}

/** The tap held: it waits for his next message, in place of a panel's tap that waited; null where the same tap again took the one that waited back. */
export interface PanelHeldReply {
  request: RequestShown | null;
}

/** A panel's tap for his next message: one of the world's actions (Walk here among them, or a Timelapse with its label and its "follow my routine" choice among its values), its values, and where it was made. */
export interface PanelTapAsk {
  action: string;
  values: { [key: string]: JsonValue };
  from: "palette" | "map" | "panel";
}

/** A prompt part or a tool's description rendered as RPH renders it for the chat: which it is, every field it names, the values of its last use in the chat (null before it was ever used there), its text with them filled in (none where it does not read), the fields it put in that had no value, and why it does not read or what of it is shown as written, each with its line. */
export interface PartPreviewReply {
  kind: "prompt" | "tool";
  name: string;
  values: JsonValue | null;
  fields: string[];
  text?: string;
  missing: string[];
  problems: { line?: number; message: string }[];
}

/** His answer to the question today's build left the chat paused on: keep or discard; `message`, the edited message it names (the first where left out). */
export interface PausedAnswerAsk {
  choice: "keep" | "discard";
  message?: string;
}

/** What his answer did: the answer kept; whether today's build holds it for a reply still under way in the chat (it lands at the run after that reply's window closes, as today's build lands it); each imported turn that took the held changes today's fold now applies there, with how many; and, per chat through them, what of the later turns no longer applies and the stretch its next briefing names. */
export interface PausedAnswered {
  answer: { chat: string; message: string; choice: "keep" | "discard"; at: number };
  held: boolean;
  turns: { turn: TurnId; changes: number }[];
  landed: JsonValue;
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

/** A list of perceptions, bounded as the entries are. */
export interface PerceptionItems {
  items: PerceptionRow[];
  /** How many the record holds in all. */
  total: number;
  /** How many older ones are left out before what is given. */
  before: number;
  /** How many newer ones are left out after it. */
  after: number;
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

/** The owner says which of the world's people a character is, by the person's id or name; null takes the reference away. */
export interface PersonAsk {
  person: string | null;
}

/** What the place is and looks like, in the words that stand: the Author's or the player's own, or, until one is written, the world's. `world` says whose; `older`: an entry bound to the place changed, went or was bound since the base was drawn. */
export interface PlaceBase {
  text: string | null;
  /** These are the world's own words for the place, at its revision; no base was written. */
  world: boolean;
  /** The revision of the world the words are the world's at; null for a written base. */
  revision: string | null;
  by: string | null;
  turn: TurnId | null;
  older: boolean;
}

/** A base the owner wrote: the change that holds it (a player's own change, which he can undo from the review card), the base as it now reads and the entries it was drawn against. */
export interface PlaceBaseWritten {
  change: string;
  base: PlaceBase;
  sources: PlaceSourceRow[];
}

/** The beat of the story that caused something: its id, its words and the number of the message it lies at (null while that is not on the chat's path). */
export interface PlaceBeatRef {
  id: string;
  text: string | null;
  message: number | null;
}

/** Who may enter: the audience the world or play set, and the place that sets it (the place itself, or one above it). */
export interface PlaceEntry {
  audience: string;
  at: string;
  name: string;
  inherited: boolean;
}

/** A fact of the place as the record keeps it: its key and words, the turn that wrote it and that turn's number, the story time then (null where the chat shows no date), the beat that caused it, and how exact, how sure and from where. */
export interface PlaceFactRow {
  id: string;
  key: string;
  value: string;
  turn: TurnId;
  n: number;
  /** Story time after that turn; null while the chat's clock shows no date. */
  time: string | null;
  beat: PlaceBeatRef | null;
  precision: "exact" | "approximate" | "vague" | "unknown" | null;
  standing: "established" | "proposed" | "assumed" | null;
  source: "prose" | "lore" | "author" | "gm" | "character" | "player" | "import" | "default" | "invented" | null;
  by: string | null;
}

/** Someone or something at the place as the tree places it: its id and name, whether it is a person or a thing, what it is on or in, and where it stands (a square, a zone or words). */
export interface PlaceHereRow {
  ref: string;
  name: string;
  kind: "person" | "thing";
  /** What it is in or on, where it is carried or lies on something. */
  holder: { ref: string; name: string; how: "in" | "on" } | null;
  square: number[] | null;
  zone: string | null;
  words: string | null;
}

/** Someone who knows of the place: who, whether the world's own record says so or a character's knowledge names it, how it was learned and how well it is known. */
export interface PlaceKnownRow {
  who: string;
  name: string;
  by: "world" | "knowledge";
  how: string | null;
  reach: string | null;
  precision: "exact" | "approximate" | "vague" | "unknown" | null;
  standing: "established" | "proposed" | "assumed" | null;
}

/** A place's record, at the chat's newest turn or as it stood at one of its turns, in its nine parts: its sources, its base, what the story changed there since, its features, who and what is here, its ways, its access and state, its history and who knows of it. */
export interface PlaceRecord {
  place: string;
  ref: string;
  name: string;
  parent: { id: string; name: string } | null;
  kind: "place" | "room" | "spot" | "venue";
  /** The place draws a grid of its own. */
  grid: boolean;
  /** Play made it; the world does not have it. */
  made: boolean;
  /** The turn read at; null: the chat's newest. */
  turn: TurnId | null;
  sources: PlaceSourceRow[];
  base: PlaceBase;
  since: { items: PlaceFactRow[]; more: number };
  features: { facts: { items: PlaceFactRow[]; more: number }; fixtures: { name: string; at: number[]; size: number[] }[]; zones: { name: string; squares: number }[] };
  here: PlaceHereRow[];
  ways: { ways: PlaceWayRow[]; adjoining: ({ id: string; name: string; how: "beside" | "way" })[] };
  access: { entry: PlaceEntry | null; light: "lit" | "dark" | null; facts: { items: PlaceFactRow[]; more: number }; doors: ({ at: number[]; state: "open" | "closed" | "locked" })[] };
  history: { items: ({ beat: string; text: string | null; message: number | null; turn: TurnId })[]; more: number };
  known: PlaceKnownRow[];
}

/** A place of the chat as it is played: its id and name, the place it is in, what kind it is, and whether it draws a grid. */
export interface PlaceRow {
  place: string;
  name: string;
  parent: { id: string; name: string } | null;
  kind: "place" | "room" | "spot" | "venue";
  grid: boolean;
  made: boolean;
}

/** A page of the chat's places as it plays them, the world's own and those made in play, the places inside a place after it, in the order the world lists them. */
export interface Places {
  items: PlaceRow[];
  next: string | null;
}

/** A lore entry bound to the place, read live: its id, the aspect it defines, who bound it, its title and revision now (null where Lumiverse no longer holds it), the revision the base was drawn against, and whether the base is older than it. */
export interface PlaceSourceRow {
  entry: string;
  aspect: string;
  by: string;
  title: string | null;
  revision: string | null;
  drawn: string | null;
  newer: boolean;
}

/** A way that joins the place to another: the place it leads to, each way of travel with its minutes and distance, whether it goes both ways, and for a way the chat laid or changed the turn that did it. */
export interface PlaceWayRow {
  route: string;
  to: { id: string; name: string };
  modes: ({ mode: string; minutes: number; km: number | null })[];
  /** Both ways, only out of this place, or only into it. */
  dir: "both" | "out" | "in";
  turn: TurnId | null;
}

/** A tap that plays now: one of the world's actions with its values, where it was made, and any words typed with it (its line in the chat; with none, what was pressed); or the id of a request that waits (Send now). */
export type PlayAsk = { action: string; values: { [key: string]: JsonValue }; from: "palette" | "map" | "panel" | "chip" | "send-now" | "command"; words?: string } | { request: string };

/** The tap played: the message its line went into the chat as, the generation Lumiverse started to answer it, and the request kept with it as played now. */
export interface PlayedReply {
  message: string;
  generation: string;
  request: string;
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

/** The prompt map of the chat's preset as found in one turn's prompt: its slices, the text no slice claims, the turn's notices and front, whether the prompt's text could be told apart, Lumiverse's clipping, the old engines' blocks the preset still holds, and how many earlier replies Lumiverse sent their thinking back with. */
export interface PromptShown {
  turn: TurnId;
  preset: { id: string; name?: string; revision?: string } | null;
  /** How the map as it stands now cuts this prompt: the slices are the learned map's; false: the raw layout's, named by the chat application's blocks and by place. */
  mapped: boolean;
  /** How the prompt was known when the turn was played, as recorded then: false for a turn played before the preset had a map, whose notices say it was not mapped yet. It does not change when a map is learned later. */
  playedMapped: boolean;
  /** The prompt's text could be told apart; false: slices cannot be found in some of it. */
  complete: boolean;
  slices: PromptSliceShown[];
  unclaimed: { message: number; start: number; end: number; text: string }[];
  notices: PromptNotice[];
  /** The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held. */
  front: { length: number; brokenBy?: string };
  /** Null where the window's messages are all in the prompt. */
  clipped: PromptClipped | null;
  /** How many messages of the turn's prompt Lumiverse sent with an earlier reply's thinking beside them (`reasoning_content`), as its Reasoning settings' Keep in history, or the connection's own, keep it. RPE gives none of it to its agents; another connection the chat is switched to is sent it. */
  thinkingBack: number;
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

/** How a quest closed: its outcome and the reason given. */
export interface QuestClosedRow {
  outcome: string;
  why: string | null;
}

/** One quest in full: its record, and every write made to it in the order made (the writes of a quest opened in play, and each move of the world's own quest from one stage to another, with how it went and the reason it came with). */
export interface QuestRecord {
  quest: QuestRecordRow;
  history: ({ turn: TurnId | null; by: string | null; op: string; value: { [key: string]: JsonValue } })[];
}

/** A quest of the chat as the record holds it, whatever the player may see (the Quests page keeps it behind its spoiler gate): what it is, its stages with their calls, who and where, its stakes, how it was shown to the player and where it came from. */
export interface QuestRecordRow {
  id: string;
  kind: "quest" | "secret" | "puzzle" | "agenda";
  name: string;
  /** The world defines the quest: its labels and conditions are as the world wrote them. */
  world: boolean;
  /** What it is. */
  objective: string | null;
  /** Why it matters. */
  why: string | null;
  stakes: string | null;
  rewards: string | null;
  stages: QuestStageRow[];
  /** Who it involves, as tree refs. */
  who: string[];
  /** Where it takes place, as tree refs. */
  where: string[];
  /** What it involves, as tree refs. */
  things: string[];
  /** How it closed; null while it is open. A quest of the world's standing on an end stage the story never closed is closed as that stage ended it. */
  closed: QuestClosedRow | null;
  thread: string | null;
  /** The quest's own visibility; null where it was not said. */
  visibility: "public" | "known_by" | "secret" | null;
  /** What the Author set the player to be shown: all, none, the stages named; null: as the quest's own visibility says. */
  shown: "all" | "none" | string[] | null;
  open: boolean;
}

/** A page of the chat's quests, the world's and those opened in play, in the order they are kept. */
export interface QuestRecords {
  items: QuestRecordRow[];
  next: string | null;
}

/** A stage of a quest: its label, the condition that moves the quest past it in words, what the story called on it (null: nothing yet) and why, and whether the quest stands on it now. */
export interface QuestStageRow {
  id: string;
  label: string;
  condition: string;
  /** What the Author or the GM called on the stage; for a stage the world's quest was moved past and nothing was called on, how the move went (its outcome, or failed where it took the stage's failing way, else met); null where nothing was called and the quest has not moved on. */
  state: "met" | "failed" | "open" | null;
  /** The reason given with that call, or with the move. */
  why: string | null;
  /** Whether the quest stands on this stage now; null for a quest the story opened, which has no single place to stand. */
  current: boolean | null;
}

/** One message of a rebuilt request as it was sent, with the file of the turn's folder its text points into, as a path in the agents' view (`<turn folder>/briefing.md`); none for text kept inline (the opening, the frame, the run's own conversation). */
export interface RebuiltMessage {
  role: string;
  text: string;
  /** The block it was placed as; absent for the run's own conversation. */
  block?: string;
  /** The file of the turn's folder its text points into; absent for text kept inline. */
  file?: string;
}

/** A tool the registry holds for a chat: its name, its family, and whose it is: RPH's own, the host's, or his own from a manifest. */
export interface RegisteredTool {
  name: string;
  family: string;
  from: "rph" | "host" | "owner";
}

/** Where a rehearsal from the page reads today's data: Lumiverse's data folder (the one holding lumiverse.db), and today's runtime's two folders, or none where the server runs no runtime of today's build. Left out: the folders the page's summary gives. */
export interface RehearsalAsk {
  lumiverse?: string;
  runtime?: { configDir: string; dataDir: string } | null;
}

/** The rehearsal started from the page, once read: its report in brief, which the page then reads a page at a time. */
export interface RehearsalReply {
  summary: MigrationSummaryShown;
}

/** The rehearsal started from the page, held in memory by the running RPE: none since it started, under way since a time (ms), read (in brief), or failed with why. */
export type RehearsalShown = { state: "none" } | { state: "running"; since: number } | { state: "ready"; summary: MigrationSummaryShown } | { state: "failed"; why: string };

/** The reply's release: whose text, in which form, the file for a file released, and its length. */
export interface Release {
  by: AgentRef;
  form: "tags" | "message" | "narrator" | "narrator-live" | "file";
  path?: string;
  length: number;
}

/** The line under each reply asked for that the chat's path holds; his own messages are left out. */
export interface RepliesReply {
  replies: ReplyLine[];
}

/** The line under one reply, by the swipe shown: whether RPE played it (false: made without RPE, no turn tied to it), whether it is an empty reply (nothing written in it, as Lumiverse keeps one when a generation fails or is stopped before its first word with thinking already shown; never played), the old engine that played a carried one, its turn, the joined form where that turn was a continue's held turn joined to another (the line is then the joined turn's), the world's date and time at the turn's end and the place his character was in (null where the clock was never set, or no place holds him), each lane's changes, the turn's marks, and, where the turn's record of the reply was not finished (its newest run failed, reached a limit or was stopped once the reply had begun to go out), why in the reply-errors part's words and whether Settle now settles it (the turn is the newest of the chat's own on its path and no run of the chat goes on). */
export interface ReplyLine {
  message: string;
  played: boolean;
  empty: boolean;
  engine: string | null;
  turn: string | null;
  joined: { turn: string; joined: string } | null;
  time: string | null;
  place: string | null;
  lanes: LaneShown[];
  marks: { kind: string }[];
  unfinished: { why: string; settle: boolean } | null;
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

/** What a change did not add up to, or why it did not apply: a code and its values, never words. */
export interface ReportShown {
  code: string;
  values?: { [key: string]: JsonValue };
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
  /** Every message as it was sent, in order, each with the file its text points into; none where `same` is false. */
  messages: RebuiltMessage[];
  /** Each tool declared, in order; none where `same` is false. */
  tools: { name: string; file?: string }[];
}

/** Something he asked for beside his words: a panel's tap, or a composer control (depth, swipe), with what was asked as data, whether it was played now as a message of its own, the turn it is kept with (null while it waits) and when it was made. A turn's asked lines also give the feedback typed in Lumiverse's regenerate dialog, as kind `feedback`. */
export interface RequestShown {
  id: string;
  chat: string;
  kind: "panel" | "depth" | "swipe" | "feedback";
  asked: { action: string | null; values: { [key: string]: JsonValue }; from: "palette" | "map" | "panel" | "chip" | "send-now" | "command"; what: string; on: string | null } | { choice: string; words: string | null } | { feedback: { text: string; at: number; settled: "start" | "confirmed" | "corrected" | "completed" } };
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

/** A turn's one card: whether the turn was dropped with nothing saved (none of its changes stands then: each reads not applied, with no undo), its changes by lane, the questions asked on it (those waiting first), and, for a turn carried in, the cards the earlier engine kept for it. */
export interface ReviewCardReply {
  turn: string;
  dropped: boolean;
  lanes: ({ lane: "story" | "engine"; changes: CardChange[] })[];
  questions: CardQuestion[];
  imported: { id: string; kind: string; at: number; data: JsonValue }[];
}

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

/** The rules of a chat's stack, or of the levels every chat shares. */
export interface RulesReply {
  chat: string | null;
  rules: RuleView[];
}

/** On or off, at which level, and the chat for the chat's level. */
export interface RuleSwitch {
  on: boolean;
  level: "chat" | "global";
  chat?: string;
}

/** The rule as it stands after the switch. */
export interface RuleSwitched {
  rule: RuleView;
}

/** A rule run against a past turn: whether it would have fired, and each firing with what matched. */
export interface RuleTest {
  rule: string;
  turn: string;
  fired: boolean;
  firings: RuleFiring[];
}

/** The past turn to run the rule against. */
export interface RuleTestAsk {
  turn: string;
}

/** A rule as the Rules page lists it: where it is, whom it is for, how it is triggered, a command rule's command and where its switch stands, whether it is in force and why not, and the farther files it replaces. */
export interface RuleView {
  name: string;
  path: string;
  level: LayerLevel;
  description: string;
  agents: "all" | string[];
  trigger?: "always" | "pattern" | "question" | "moment" | "command" | "interval";
  command?: { runs: string; state: "on" | "waiting" | "off" };
  inForce: boolean;
  why?: "off" | "needs" | "example" | "broken" | "judge";
  judge?: "part" | "yes" | "connection";
  replaces: { level: LayerLevel; path: string }[];
}

/** How a run ended, whether a reply was released, the limit or the failure, and what every agent of it spent. */
export interface RunOutcome {
  status: "released" | "no-reply" | "stopped" | "limit" | "failed";
  released: boolean;
  limit?: LimitHit;
  error?: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags" | "hook"; hook?: string; limit?: LimitHit; detail?: string; agent?: string; text?: string; broke?: { failure: CallFailureKind; tries: number } };
  usage: Usage;
}

/** Where a run's work happens: a chat's, or that of a job of no chat. */
export type RunScope = Scope | UserSessionScope;

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
  /** A continue's own intent record, kept with its run, never over the intent record of the turn it extended (the turn's `intent`). Null for any other run, whose intent record is its turn's. */
  intentRecord: string | null;
  timings: TurnMoments;
  usage: Usage;
  /** What this run sent to the chat. */
  reply: ReplySoFar;
  /** What Lumiverse saved for it where that is not what was released (beyond the prefill in front and a continue's join): the saved text whole, beside `reply`; null where it is the same, or nothing is saved yet. */
  saved: string | null;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags" | "hook"; hook?: string; limit?: LimitHit; detail?: string; agent?: string; text?: string; broke?: { failure: CallFailureKind; tries: number } } | null;
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

/** What a run spent, in all and by agent. */
export interface RunUsage {
  run: string;
  total: Usage;
  agents: { agent: AgentRef; usage: Usage }[];
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

/** How RPE runs now: under its service (the unit's name) or started by hand, since when, the addresses it listens on, the build it runs, whether its service put the known-good copy back, where a restart stands, and the memory it holds. */
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
  memory: ServiceMemory;
}

/** RPE's own newest log lines. */
export interface ServiceLog {
  lines: ({ at: number; level: "debug" | "info" | "warn" | "error"; message: string; area: string | null; chat: string | null; turn: string | null; job: string | null; fields: JsonValue })[];
  /** How many lines RPE keeps at most (`service.logLines`). */
  kept: number;
}

/** What RPE holds now, in bytes: the process's own figures, its highest resident size, its worker threads, what RPE and its harness keep that can grow with play, by name, and what the kernel counts against its service's limit with that limit. */
export interface ServiceMemory {
  /** The process's resident size now: what it holds in the machine's memory. */
  holds: number;
  /** The engine's heap: what its objects take, and the heap's whole size with its free room. */
  heap: { used: number; total: number };
  /** What the heap's objects own outside it: the text of long strings and the bytes of buffers. */
  outside: number;
  /** Of what is outside the heap, the bytes of buffers. */
  buffers: number;
  /** What the allocator outside the heap holds from the system, freed memory it has not given back yet among it. */
  allocator: number;
  /** The most it has held since it started. */
  peak: number;
  /** Worker threads running now, each a runtime of its own (about 40 MB in the built app); one with nothing to do ends after workers.idleSeconds. */
  threads: number;
  /** What RPE and its harness keep in memory that can grow with play, each by its name: how many, and the characters of text they hold where that is counted (null where it is not). */
  kept: KeptCount[];
  /** What the kernel counts against the service's limit now and at its highest (it takes in the pages of the files RPE wrote that the system keeps in memory, which it gives back before the limit is reached), and the limit, the unit's MemoryMax (null: none); null where RPE does not run as a service, or the count cannot be read. */
  service: { holds: number; peak: number | null; limit: number | null } | null;
}

/** Each part of a turn and how long it took across the latest turns. */
export interface ServiceTimings {
  /** How many turns were taken in. */
  turns: number;
  parts: { part: string; turns: number; median: number; slowest: number; latest: number }[];
}

/** A session of RPE's web app: its token, which a browser keeps in place of the printed token, when it ends, and whose it is. After a sign-in by password, the Lumiverse session token too: a client that keeps one (the command line) keeps it as its own; RPE ends it through the door when this session signs out. */
export interface Session {
  /** The session's token: given as the bearer of every call, and traded again for a new one before it ends. */
  session: string;
  /** When it ends, epoch milliseconds. */
  ends: number;
  /** The Lumiverse user it is of. */
  user: string;
  /** Lumiverse's own session, made by a sign-in by password, handed back; a page need not keep it, since its sign-out ends it. */
  lumiverse?: { token: string; username: string };
}

/** A session he closed: the session as it now stands, the scene of the story record closed with it, and the id of his change that closed the scene, which his Undo takes (both null where the record held no scene open). */
export interface SessionClosed {
  session: SessionShown;
  scene: string | null;
  change: number | null;
}

/** What asking for a compaction came to: the session as it now stands, whether a compaction is now waiting for its next turn (no when the session holds too few turns without a summary), the session's turns, how many of its newest turns a summary never stands for, and the answer in words, which says what is so: that it is asked for, was asked for already, or that there is nothing to compact yet and why. */
export interface SessionCompactAnswer {
  session: SessionShown;
  asked: boolean;
  turns: number;
  kept: number;
  words: string;
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

/** Whose the page's credential is; what it is, a session (renewed while a page is open) or the web key; when it runs out (epoch milliseconds; null: it has no end); and the web key in force, made when and ending when (null: no end), none where none is made. */
export interface SessionReply {
  user: string;
  holds: "session" | "web key";
  ends: number | null;
  webKey: { made: number; ends: number | null } | null;
}

/** A session as the Sessions page shows it: a scene's, a sub-agent's run, a job's run or a talk thread; open or closed, the turn that closed it (for his own close, the chat's newest turn when he closed it), when it was closed and what closed it (you, a turn's scene change, RPE's own close, the end of its run or of its job), a compaction asked for that waits for its next turn, and, for a scene's, the id of the story record's scene it was opened for. */
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
  closedAt?: number;
  closedHow?: "user" | "turn" | "host" | "run" | "job";
  from?: { chat: string; session: string; turn: string };
  turns: number;
  compactAsked?: true;
  held?: { hook: string; reason: string };
  hooked?: string;
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

/** What a setting set for one connection or one agent at a time is set for here: a connection or an agent definition, the name or id its key writes, the name the page shows, and whether one is in force now by that name. */
export interface SetFor {
  kind: "connection" | "definition";
  key: string;
  name: string;
  known: boolean;
}

/** Each section of the page in order with one line on it; each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); every setting; and the install's facts. */
export interface SettingsReply {
  chat: string | null;
  sections: { title: string; about: string }[];
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

/** One of RPH's shapes of a value: a whole number, at least `least` and at most `most` where it has one; a number, at least `least` where it has one and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names. */
export type SettingTakes = { type: "whole"; least: number; most?: number } | { type: "number"; least?: number; most?: number } | { type: "oneOf"; values: readonly string[] } | { type: "yesNo" } | { type: "text" } | { type: "texts" };

/** A setting as the Settings page shows it. */
export interface SettingView {
  /** As a config file writes it; one set for a connection or an agent names it. */
  key: string;
  /** The key as declared, with `<connection>` or `<definition>` where it names one: the same for every connection's or agent's. */
  pattern: string;
  /** What the page calls it. */
  name: string;
  /** One line on what it does. */
  about: string;
  /** The section of the page it is shown in. */
  section: string;
  /** The group within its section, in plain words. */
  group: string;
  /** The unit a number is in (ms, seconds, bytes, tokens…), from the end of its key; null for a count and for anything not a number. */
  unit: string | null;
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
  /** What holds where no level sets it, where that is not what `~` means: a definition's own value for one set per agent. */
  unset: string | null;
  /** `~` may be set (`none: true` in a write). */
  orNone: boolean;
  /** The levels it may be set at here. */
  levels: LayerLevel[];
  /** For one set per connection or per agent, the connection or definition this one is for. */
  setFor?: SetFor;
  /** The lines the page shows while a value passes what is usual. */
  advice: Advice[];
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

/** The owner binds a source to a character, says again which side of it a bound source defines (`defines`; null: none), or takes the binding away (`drop`). A card, a persona, a memory entity or a lore entry Lumiverse does not hold is refused. */
export interface SourceAsk {
  kind: SourceBindingKind;
  ref: string;
  defines?: string | null;
  drop?: boolean;
}

/** What a source bound to a character points at. */
export type SourceBindingKind = "card" | "persona" | "entry" | "memory";

/** A source bound to the character, as recorded (the text stays in Lumiverse), with its title as Lumiverse holds it now and how it stands against the base. */
export interface SourceBindingRow {
  kind: SourceBindingKind;
  ref: string;
  /** Which side of the character it defines, in the binder's words. */
  defines: string | null;
  created: number;
  /** Its name or title in Lumiverse now; null when gone or unread. */
  title: string | null;
  state: SourceFreshness;
}

/** A bound source read now in Lumiverse against the base: current; changed since the base was last drawn from it; unseen (bound after, or never drawn from); gone from Lumiverse; or unread (Lumiverse could not be asked). */
export type SourceFreshness = "current" | "changed" | "unseen" | "gone" | "unread";

/** A stretch of a model's own writing, in milliseconds since 1970: from its first token to its last; `to` null while it began and has not ended (a run stopped inside it). */
export interface Span {
  from: number;
  to: number | null;
}

/** One thing an agent is handed whole at the start of each of its runs, after its stack: a name its definition lists in `given:`, or a file pinned for it; for a pin, the file as the view holds it now, or why nothing is handed. */
export interface StackHandedRow {
  /** Why it is handed: its definition names it in `given:`, or a file is pinned for the agent in a level's config. */
  from: "definition" | "pin";
  /** What is handed: the name its definition lists, or the file as the pin writes its path. */
  ref: string;
  /** For a pin: the level whose config holds it. */
  pinnedAt?: LayerLevel;
  /** For a pin whose file is in the view: its path there. */
  path?: string;
  /** For a pin whose file is in the view: the level the file is at. */
  level?: LayerLevel;
  /** For a pin whose file is in the view: its whole text, as the agent is handed it. */
  text?: string;
  /** For a pin whose file is not a file in the view: why the agent is handed nothing for it. */
  problem?: string;
}

/** One part of an agent's stack: its kind, which part, the file it came from, its level, whether it sits in the opening block or comes with the briefing, its text, and the situations that hand it to the briefing; a part left out is listed with why. */
export interface StackPartRow {
  /** What the part is. */
  kind: "definition" | "instruction" | "rule" | "contract" | "guide" | "description" | "skills" | "given";
  /** Its name as `stack.off` lists name it; for `given`, the item as `opening:` writes it. */
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

/** The exact stack an agent gets in the chat, part by part in order, each with the file it comes from, its level, and whether it sits in the opening block or comes with the briefing; a part left out is listed with why. After it, what the agent is handed whole at the start of each run, in the order it is handed: what its definition lists in `given:`, then each file pinned for it, each with why it is there. */
export interface StackReply {
  agent: string;
  parts: StackPartRow[];
  handed: StackHandedRow[];
}

/** Someone on stage at a turn, by the name the stage gives; the character the cast holds by that name (null: it holds none) with its casting; the perceptions of that turn it has, by id, struck ones left out: none listed is a gap on a turn RPE played; of those, the ones its own agent has not taken in; and, on a turn a migration carried, the old mind files carried with that character. */
export interface StagePerson {
  name: string;
  /** The cast's character of that name; null where the cast holds none. */
  character: string | null;
  /** Its casting in force at the turn; null: none. */
  casting: CastRole | null;
  perceptions: string[];
  /** Of its perceptions of that turn, those its own agent has not taken in as the chat stands now (no memory, mind entry or relationship of its own names them, and it has not said they leave nothing to remember), by id. */
  untaken: string[];
  /** On a turn a migration carried: the old mind files carried with the character, by name (`minds` for the older minds pack's notes), each with whether it is marked filed; none on a turn RPE played. */
  files: { name: string; filed: boolean }[];
}

/** How a turn's stage was read: from the open scene and who the state places in its place (scene), from where the owner's character stands when no scene was recorded (owner), or not recorded at all (none). */
export type StageReading = "scene" | "owner" | "none";

/** One turn of the perception record: who was on stage, how the stage was read, and each one's perceptions of that turn or none; for a turn a migration carried, that the previous build played it, which owes no perception of RPE's, and the mind files carried with each. */
export interface StageTurn {
  turn: TurnId;
  /** That turn's reply on the chat's path, from 0; null where it is on none. */
  message: number | null;
  /** True for a turn a migration carried, which the previous build played: it owes no perception, and what its characters took from it is in the mind files carried with them. */
  carried: boolean;
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

/** One kind RPE keeps: its id, the name the page calls it, how many, how big, the oldest of it, and how long it is kept. */
export interface StorageKindRow {
  /** Its id: notes, note-versions, suggestions, turn-folders, turn-folders-pruned, sessions, yours, shipped, database, migration-backups, database-copies or archives. */
  kind: string;
  /** What the page calls it. */
  name: string;
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

/** What the press did: switched the file on where its kind is read (`to`, the path written), or left it off because a file of that name is in force there (`inForce`: its level and text, beside the attached file's text), for him to choose. */
export type SwitchedOnShown = { switched: true; from: string; to: string } | { switched: false; from: string; to: string; inForce: { level: "global" | "shipped"; text: string }; attached: string };

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

/** One of his attached files to switch on: GUIDANCE.md, an agent or a skill under `imported/`, by its path below the user's level. */
export interface SwitchOnAsk {
  path: string;
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
  /** The system that keeps it: economy, gear, orgs, calendar, weather, vehicles, combat or sheets. */
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

/** A tag check's record for a connection: the simple turns it played on it, how many came back with the reply and the intent record each in its tags, against the count the tag form needs, the model that answered, the reply form that set for the connection (his global config's, his to change after; not set where the file could not be written), when it ended and the job that ran it. */
export interface TagCheck {
  connection: string;
  name: string;
  model: string;
  tried: number;
  kept: number;
  needed: number;
  form: "tags" | "two-step";
  set: boolean;
  at: number;
  job: string;
}

/** A tag check asked for: the job it runs as, at once; or why none was started (jobs off, the day's count or tokens reached, no such connection, the check's part missing or not as it needs, his job-start hook). */
export type TagCheckStarted = { job: JobView } | { refusal: JobRefusal };

/** The character whose own agent is to take in what it has perceived and not yet taken in, by its name as the cast holds it. */
export interface TakeInAsk {
  character: string;
}

/** The hash of the provider key today's connections hold, which RPE takes over at the swap, with the model names those connections name, which the key opens. */
export interface TakenKeyAsk {
  /** The key's SHA-256, in hex. */
  hash: string;
  /** The model names of the connections that hold the key. */
  models: string[];
}

/** What a level may set a setting to: one of RPH's shapes; a table of names, each to a value of `of` (with `whole`, such a value alone for every name); or a list of records, each holding every field. */
export type Takes = SettingTakes | { type: "table"; of: SettingTakes; whole?: true } | { type: "records"; fields: readonly { name: string; takes: SettingTakes; about: string }[] };

/** A tap that manages, recorded at once as his own edit: one of the world's actions done at once (money, a group, gear, a vehicle); one ✎ form (a hint, the time, a thing, things with a label, or a field); the World page's edit of values and facts; or an edit of operations ("Make this a property"). */
export type TapAsk = { kind: "action"; action: string; params: { [key: string]: JsonValue }; source: string; text?: string; now?: boolean; tell?: boolean } | { kind: "fix"; fix: { hint: string } | { time: string } | { thing: JsonValue } | { things: JsonValue[]; label: string } | { entity: string; field: string; value: JsonValue }; tell?: boolean } | { kind: "edit"; ops: EditOpAsk[]; tell?: boolean } | { kind: "ops"; ops: JsonValue[]; tell?: boolean };

/** What became of a tap that is no tap that manages: held for his next message (the request that waits; null where the same tap again took the one that waited back), or played now. */
export type TapAsked = { held: RequestShown | null } | PlayedReply;

/** What a tap or its Undo came to: whether it was applied, what the world's rules reported of it (kept with it, listed under unsettled), the id its Undo takes (null where nothing was recorded), the answer in words, and, for a tap that is no tap that manages, what became of it. */
export interface TapReply {
  applied: boolean;
  reports: string[];
  undo: string | null;
  words: string;
  /** Held for his next message or played now; left out for a tap that manages, an Undo and a time control. */
  asked?: TapAsked;
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

/** How a definition's tools are offered to its model: as the connection does best (`auto`), as native tool calls, or as text. */
export type ToolsAs = "auto" | "native" | "text";

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
export type TraceEvent = { kind: "run_started"; run: "turn" | "job" | "talk"; turn?: TurnKind; lead: string } | { kind: "agent_started"; definition: string; connection: string; model: string; effort?: Effort; set?: Effort; session: string; given: string[]; tools?: { tokens: number; most: number }; judges?: { rule: string; agent: string } } | { kind: "tool_unheld"; tool: string; definition: string; reason: "unregistered" | "shadowed" | "withdrawn" } | { kind: "intent_began" } | { kind: "intent"; text: string } | { kind: "call_started"; call: number; connection: string; model: string; sampling?: Sampling; maxTokens?: number; messages: number; tools: number; request?: string; toolTokens?: number; openingTokens?: number } | { kind: "call_ended"; call: number; model: string; text: string; thinking?: string; toolCalls: ToolCallView[]; stop: string; usage: Usage; ms: number; error?: string } | { kind: "call_failed"; call: number; failure: CallFailureKind; words: string; at: CallBreakPoint; status?: number; tries: number; retries: number; retried: boolean; wait?: number; asked?: number } | { kind: "connection_wait"; connection: string; for: "minute" | "place"; ms?: number } | { kind: "waiting"; for: "tool" | "agent"; callId: string; tool: string; ms?: number } | { kind: "connection_stand_in"; named: string; used: string } | { kind: "effort_lowered"; connection: string; model: string; asked: Effort; sent: Effort } | { kind: "tool_started"; callId: string; tool: string; args: JsonValue; via?: "tool_use" } | { kind: "tool_update"; callId: string; tool: string; partial: ToolResult } | { kind: "tool_ended"; callId: string; tool: string; result: ToolResult; clean: boolean; endedRun: boolean; ms: number; permission?: CallPermission; refused?: CallRefusal } | { kind: "rule_fired"; firing: RuleFiring } | { kind: "rule_failed"; rule: string; path: string; why: "time"; length: number } | { kind: "rule_failed"; rule: string; path: string; why: "command"; detail: string } | { kind: "rule_failed"; rule: string; path: string; why: "judge"; detail: string } | { kind: "rule_waiting"; rule: string; path: string; thing: { kind: "hook" | "rule-command" | "command-tool" | "mcp-server" | "http-tool" | "connection"; name: string; target: string }; state: "waiting" | "off" } | { kind: "hook"; hook: string; on: HookEvent; outcome: "ok" | "added" | "changed" | "blocked" | "failed" | "timed-out"; ms: number; callId?: string; text?: string } | { kind: "approval_asked"; callId: string; tool: string; lane: string } | { kind: "approval_answered"; callId: string; tool: string; lane: string; answer: { go: true } | { go: false; reason?: string } } | { kind: "prompt_notices"; notices: PromptNotice[]; pictures?: { message: number; count: number }[] } | { kind: "todo"; items: { text: string; done: boolean }[] } | { kind: "limit"; hit: LimitHit } | { kind: "paused"; call: number } | { kind: "resumed"; call: number; ms: number } | { kind: "said"; call: number; text: string } | { kind: "released"; release: Release } | { kind: "progress_missing"; time: number } | { kind: "compacted"; session: string; reason: "would-not-fit" | "refused" | "asked" | "fold"; of: "turns" | "run"; before: number; after: number; keptTurns?: number } | { kind: "session"; session: string; change: "opened" | "closed" | "forked" | "reopened" | "unreadable"; from?: string; turn?: string; by?: "user"; reason?: string } | { kind: "job"; job: JobView } | { kind: "agent_ended"; status: "done" | "asked" | "limit" | "stopped" | "failed"; limit?: LimitHit; usage: Usage } | { kind: "run_ended"; outcome: RunOutcome };

/** An event of RPH's, numbered within its run, with who did it and where; for a sub-agent or a job, the agent, run and tool call that started it. No agent for a record of the host's word outside any agent's work (a session opened, closed, forked or opened again by a call of the sessions API). */
export interface TraceRecord {
  seq: number;
  run: string;
  scope: RunScope;
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
  /** The name RPH loads it by, and a `stack.off` list names it by; null for a file RPH does not load by its name. */
  item: string | null;
  /** Whether RPH takes it: a named file when it is the nearest of its name, not switched off and not an example; any other file as it is. */
  applies: boolean;
  /** The nearer file of the same name taken in its place; null when none is. */
  replacedBy: string | null;
  /** Its name is in a config's `stack.off` list, which switches it off at every level. */
  off: boolean;
  /** The levels whose config's `stack.off` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing. */
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
  /** The agents whose stacks it joins: a file `stack.instructions` names or an agent reads. */
  joins?: string[];
  /** For a level's hooks file (`hooks.yml` in its hooks folder): each hook it names, as RPH's hook reader takes it. */
  hooks?: TreeHook[];
}

/** A hook as a hooks file names it: its name (a `stack.off` list names it `hooks/<name>`), the moment it runs at and its command line as written; switched off, and by which levels; the nearer level's hooks file that names it in its place; whether RPH runs it; and, where RPH lists it, whether its command is switched on. */
export interface TreeHook {
  name: string;
  on: HookEvent;
  runs: string;
  off: boolean;
  offIn: LayerLevel[];
  replacedBy: string | null;
  applies: boolean;
  state?: "on" | "waiting" | "off";
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

/** Whether the control took: false when the turn's run is not going on (or, for resume, was not held by his pause; for say, the words were empty). */
export interface TurnControlled {
  done: boolean;
}

/** A turn's id: the id RPE gives a turn when it begins it. */
export type TurnId = string;

/** What a generation asks for. */
export type TurnKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";

/** Whether a turn runs now, and whether his pause holds its run. */
export interface TurnLiveState {
  running: boolean;
  paused: boolean;
}

/** The lore Lumiverse activated for a turn's prompt, in the order the turn's tag lists it; none for a turn RPE holds no tag for. */
export interface TurnLoreReply {
  entries: TurnLoreRow[];
}

/** An entry Lumiverse activated for a turn's prompt: its lore map id, its id and its book's id in Lumiverse, its title, how it activated where the turn's tag says, and what RPE's check of the lore on receipt did to it. */
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
  /** Where the extension applied its own verdict on the secrets and RPE checked the lore on receipt: kept out of the prompt, worded otherwise, or its text not found in the prompt (so RPE's verdict was not applied to it); null where the check left it as it was, or nothing was checked. */
  receipt: "kept-out" | "reworded" | "not-found" | null;
}

/** A mark a turn carries apart from its run's status: interrupted (RPE restarted while a run of it went on), saved otherwise (what Lumiverse saved is not what was released, beyond the prefill in front and a continue's join), edited (its own reply was edited in the chat after it was saved, the Author told the text before and after at the next turn), or standing on a message of the player's he edited, or inserted before it, since it was played; with that message, and when the mark was set. */
export interface TurnMark {
  kind: "interrupted" | "saved-otherwise" | "edited-reply" | "edited-message" | "inserted-message";
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
  /** The message of the empty reply this turn left in the chat, where it ended before a word of its reply went out and that reply still stands there empty (read from Lumiverse now); null for any other turn. It stays unless the setting lumiverse.reply.removeEmpty takes it away. */
  emptyReply: string | null;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags" | "hook"; hook?: string; limit?: LimitHit; detail?: string; agent?: string; text?: string; broke?: { failure: CallFailureKind; tries: number } } | null;
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
  /** The Unsettled list: each change of the turn, and each placed after it before the next turn, that carries a report, did not apply, has no source, or is an invention with no gap check or consent. */
  unsettled: ({ change: TurnChange; lane: string; turn: string | null; about: string[]; why: ("reported" | "not_applied" | "unsourced" | "unchecked")[] })[];
  told: TurnTold;
  /** For a turn a migration carried: its message and swipe, and the old engine's record of it as kept; null for any other. */
  carried: { message: string; swipe: number; record: JsonValue } | null;
  /** The route of the turn's review card, where each of its changes is reviewed and undone. */
  card: string;
  /** The open quests the turn touched: opened, called a stage of, or wrote anything of. */
  quests: { id: string; name: string; kind: string }[];
  /** The threads the turn opened or wrote anything of that stay open, each with its words, its state and its stakes as the story record holds them at the turn. */
  threads: ({ id: string; text: string | null; state: string | null; stakes: string | null })[];
}

/** A turn as a chat's list shows it: what it is (the kind of the run that made it, which a continue that joined its reply does not change), its newest run's status, its reply's times, what all its runs spent, and each of its runs in its own words. */
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
  /** Each of its runs, the first first: the run that answered is the latest that is not a Settle now run. */
  runs: TurnRunRow[];
}

/** A run's kind: the kind of turn Lumiverse asked for, or a Settle now run, where the player asked the Author to settle an edit now and nothing is written to the chat. */
export type TurnRunKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate" | "settle";

/** One run of a turn as the list gives it: its place among the turn's runs, its kind, where it stands, why its reply failed when it did, when its moments happened (its reply released among them) and what it spent. */
export interface TurnRunRow {
  /** Its place among the turn's runs, from 1. */
  nth: number;
  kind: TurnRunKind;
  status: TurnState;
  /** Why the reply failed, when it did. */
  error: { code: "no-reply" | "limit" | "provider" | "stopped" | "failed" | "no-definition" | "no-tags" | "hook"; hook?: string; limit?: LimitHit; detail?: string; agent?: string; text?: string; broke?: { failure: CallFailureKind; tries: number } } | null;
  timings: TurnMoments;
  /** What this run alone spent: model calls and tokens. */
  usage: Usage;
}

/** What he says to the Author while the turn runs: it reaches the lead at its next model call, as his words. */
export interface TurnSay {
  text: string;
}

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

/** What undoing a change of a turn recorded (the ids of the changes that reverse it, his own, citing it) and what is left, as report codes (a part a later change has written since, or one with no reversal) and, each part one sentence, in the play answers' words: its kind, what it was done to and why it stays. */
export interface UndoReply {
  recorded: string[];
  left: ReportShown[];
  leftWords: string[];
}

/** The newest update this process heard of, stage by stage from its arrival to the restart onto it. */
export interface UpdateProgress {
  /** The build it brings, once its check said it. */
  build: string | null;
  stages: UpdateStage[];
}

/** One stage an update reached: its arrival (the extension's word with the hash stated, or the app file on disk found changed), its check (every file against that hash, or the file asked its build), its start (for real on a scratch copy of RPE's data), or the restart onto it; under way, passed, or where the update stopped, and why. */
export interface UpdateStage {
  stage: "arrived" | "checked" | "started" | "restart";
  /** Under way, passed, or where the update stopped. */
  state: "going" | "done" | "refused";
  /** When it began, in milliseconds since 1970. */
  at: number;
  /** Why the update stopped here; null where it did not. */
  why: string | null;
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
  chat?: undefined;
  turn?: undefined;
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

/** One thing waiting on the user, by what it is, each with its press and whether it is done: his GUIDANCE.md, his own agents (with the pins carried for each and the tools it names that no longer exist) and skills, a model choice with no match, a paused chat's question, a staged change, a chat's chips and rollback, the filing, a file no row names, a pin carried for the Author, a text set apart. */
export type WaitingOnUser = { kind: "guidance"; path: string; done: boolean } | { kind: "agent"; id: string; path: string; done: boolean; pins: string[]; deadTools: string[] } | { kind: "skill"; id: string; path: string; done: boolean } | { kind: "connection"; where: string; connection: string; agent: string | null; path: string | null; done: boolean } | { kind: "paused"; chat: string; questions: number; answered: "keep" | "discard" | null; done: boolean } | { kind: "staged"; chat: string; staged: number; done: boolean } | { kind: "chat"; chat: string; chips: number; reviewCards: number; rollback: boolean; done: boolean } | { kind: "filing"; chat: string; characters: number; notes: boolean; done: boolean } | { kind: "row"; path: string; done: boolean } | { kind: "pin"; file: string; role: string; done: boolean } | { kind: "text"; id: string; reason: string; missing: string[]; path: string; done: boolean };

/** The web search provider he sets: its address (null takes it away and web_search is off), and a key for it (left out: the kept key stays only if the address is the same; null: no key). */
export interface WebProviderSet {
  address: string | null;
  key?: string | null;
}

/** The web search provider he set, as the Connections page shows it: its address (null: none, so web_search is off) and whether a key is kept for it; never the key. */
export interface WebProviderShown {
  address: string | null;
  key: boolean;
}

/** How full an agent's context is: the tokens it holds, its model's window, and the room kept for its answer. */
export interface WindowGauge {
  used: number;
  window: number;
  reserve: number;
}

/** What attaching came to: whether the chat plays the world's head from its next turn, the revision it plays, where it stood if it played a world already, and whether a turn runs now. */
export interface WorldAttached {
  /** The chat takes the world's head revision from its next turn. */
  attached: boolean;
  /** The revision it plays, or will. */
  revision: string;
  /** For a chat that plays a world already. */
  plays?: { world: string; name: string; revision: string; behind: boolean };
  /** A turn runs now, so the next turn is the first to play it. */
  waiting: boolean;
}

/** A change to one of his worlds, once it is kept: the world, what was written (a revision, the index, the draft, a history note, or the whole world removed), and for the draft its version and whether one is stored now. */
export interface WorldChanged {
  /** The world's id. */
  world: string;
  /** What was written. */
  part: "revision" | "index" | "draft" | "history" | "removed";
  /** For a revision: the revision kept. */
  revision?: string;
  /** For the draft: its version after the write. */
  version?: number;
  /** For the draft: whether one is stored now (false once it is discarded or committed). */
  stored?: boolean;
}

/** What changed from one version of a world to another, part by part. */
export interface WorldChanges {
  /** The revision it is compared against. */
  from: string;
  /** The revision it is compared to; null for the draft. */
  to: string | null;
  /** How many things changed in all. */
  total: number;
  /** Each part that changed, in the order of the document. */
  parts: ({ part: string; added: number; changed: number; removed: number; things: ({ id: string; name: string | null; kind: "added" | "changed" | "removed" })[]; more: number })[];
}

/** A chat that plays one of his worlds: its name, the world and the revision it plays now (a move that waits for its next turn counted), the world's head, and whether it is behind. */
export interface WorldChat {
  /** The chat's id. */
  chat: string;
  /** Its name in Lumiverse; its id where Lumiverse gives none. */
  name: string;
  /** The world it plays. */
  world: string;
  /** The world's name. */
  worldName: string;
  /** The revision it plays now. */
  revision: string;
  /** The world's head revision; null where the world is gone from his worlds. */
  head: string | null;
  /** The world has a newer revision than the chat plays. */
  behind: boolean;
  /** Why the chat cannot be moved on. */
  reason?: string;
}

/** The draft as the world's next revision. Where the world's errors block it, `revision` is null and `message` and `lint` say what blocks. */
export interface WorldCommitted {
  /** The new revision; null where it was not made. */
  revision: string | null;
  /** The lint of the committed world, or what blocks. */
  lint: WorldLintIssue[];
  /** Why it was not made; null where it was. */
  message: string | null;
}

/** A new world as made, and its first revision. */
export interface WorldCreated {
  /** The world document. */
  world: JsonValue;
  /** Its first revision. */
  revision: string;
}

/** A world's draft as it stands after the call, with its lint, the revision it began from, whether one is stored and its version. `moved` is true where the write named a version the draft was no longer at: nothing was written, and this is the draft as it now stands. */
export interface WorldDraft {
  /** The draft document. */
  draft: JsonValue;
  /** Its lint. */
  lint: WorldLintIssue[];
  /** The revision the draft began from. */
  base: string | null;
  /** Whether a draft is stored (else it is the head). */
  stored: boolean;
  /** The draft's version. */
  version: number;
  /** The draft had moved on: this is what is there now and nothing of the write was kept. */
  moved: boolean;
}

/** A world file brought in as a new world, its first revision, and the macros in it to review before playing it. */
export interface WorldImported {
  /** The world document. */
  world: JsonValue;
  /** Its first revision. */
  revision: string;
  /** The macros to review, as warnings. */
  lint: WorldLintIssue[];
}

/** One of his worlds: its id and name, its head revision and every revision, and where its working copy's count stands. */
export interface WorldIndexRow {
  /** The world's id. */
  id: string;
  /** Its name. */
  name: string;
  /** Its head revision. */
  head: string;
  /** The World Info book an earlier build kept for it; null for none. */
  loreBookId: string | null;
  /** Every revision, oldest first. */
  revisions: string[];
  /** The count of its working copy while no draft is stored. */
  draftVersion?: number;
}

/** One thing the lint found in a world: its severity, where in the document, a code, the words, and a fix Problems offers in one press (its label and the draft patch that does it). */
export interface WorldLintIssue {
  /** How serious it is. */
  severity: "error" | "warning" | "info";
  /** Where in the document, e.g. `entities.npc_dev.fields.cash`. */
  path: string;
  /** What kind of finding it is. */
  code: string;
  /** The words. */
  message: string;
  /** A fix Problems offers in one press. */
  fix?: { label: string; ops: JsonValue };
}

/** A world at a revision: its document, which revision that is, how each revision became head, and what the packs give the editors (the kinds and relations they bring and the formula functions). */
export interface WorldRead {
  /** The world document. */
  world: JsonValue;
  /** The revision it is. */
  revision: string;
  /** How each revision became head, oldest first. */
  history: WorldRevisionNote[];
  /** The kinds the packs bring, by id. */
  packKinds: JsonValue;
  /** The relation types the packs bring, by id. */
  packRelations: JsonValue;
  /** The formula functions. */
  functions: string[];
}

/** The level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn. */
export interface WorldReply {
  at: string;
  nodes: LevelNode[];
}

/** How a revision became the head: when, what made it (a new world, a commit from Build or from an outside agent, an import) and the note given with the commit. */
export interface WorldRevisionNote {
  /** The revision. */
  revision: string;
  /** When, in ms since 1970. */
  at: number;
  /** What made it head. */
  source: "create" | "build" | "agent" | "import";
  /** The commit's note. */
  note?: string;
}

/** One revision of a world as its history lists it: when it became head and what made it, its note, how many things it changed against the revision before it, whether it is the head now, and the chats that play it. */
export interface WorldRevisionRow {
  /** The revision. */
  revision: string;
  /** When it became head, in ms since 1970; left out for a revision that became head before the world kept a history. */
  at?: number;
  /** What made it head. */
  source?: "create" | "build" | "agent" | "import";
  /** The note given with the commit. */
  note?: string;
  /** It is the world's head now. */
  head: boolean;
  /** The revision that was the head before it; null for the world's first revision. */
  before: string | null;
  /** How many things it changed against the revision before it; null for the world's first revision, and for one whose file is gone. */
  changed: number | null;
  /** The chats that play it now. */
  chats: { chat: string; name: string }[];
}

/** Every route in the form that answers in JSON, by its method and path pattern: its params, its query, its body, its reply, whether it pages, and whether it is long (answered at once with an id, its answer read from `ANSWERS_PATH`). */
export interface ApiRoutes {
  /** Every definition in force for a chat, or for none: its file, level, what it replaces, whether it is off, its effort and limits as its header says them, its tools, what it reads and is given, and what it runs on (its connection, its model, its effort and its limits, the settings for it standing over its header) as RPH resolves them. */
  "GET /api/v1/agents": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: AgentsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The fixed list of tools an agent's requests carry in a chat, as declared and counted in tokens, and every tool the registry holds there, so one a definition lists and nobody registers can be told. */
  "GET /api/v1/agents/:agent/tools": {
    params: { agent: string };
    query: { chat?: string };
    body: undefined;
    reply: AgentToolsReply;
    paged: false;
    long: false;
    joined: false;
  };
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
  /** Makes a backup now: the archive `rpe backup` makes, of the database (copied whole by SQLite while RPE runs) and the file tree, in the backups folder, readable by you alone and never written over another. Refused where the database is not there yet, or an archive of that second exists. */
  "POST /api/v1/backups": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BackupMadeReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What a backup made now would hold, said first: its name, the database's size, how many files of the tree and how many bytes, and the links it leaves out. */
  "GET /api/v1/backups/next": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: BackupPlan;
    paged: false;
    long: false;
    joined: false;
  };
  /** The chats the last migration carried, a page at a time, each with how its bootstrap stands (no job yet, queued, held, running, waiting for his word, or ended), its newest bootstrap job, and that job's question when it waits. */
  "GET /api/v1/bootstrap": {
    params: Record<string, never>;
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: CarriedBootstrap[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** Starts the bootstrap job for the chats named, or for every chat the last migration carried, one after another, each with his choice of what to relive and his token limit if he sets one; says which started and which were refused, and why. */
  "POST /api/v1/bootstrap": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: BootstrapBatchAsk;
    reply: BootstrapBatchReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The user's jobs for a world, oldest first, each with its status, progress and result. */
  "GET /api/v1/build/jobs": {
    params: Record<string, never>;
    query: { world: string };
    body: undefined;
    reply: { jobs: BuildJob[] };
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts a job on a world: its progress and result are told on the user's live channel as it goes, and kept. Refused where as many jobs run as `build.jobs.atOnce` allows. */
  "POST /api/v1/build/jobs": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { world: string; kind: "import_lore" | "refine" | "describe_map" | "propose_routines" | "playtest" | "check_world" | "index_text"; input: JsonValue };
    reply: { job: string };
    paged: false;
    long: false;
    joined: false;
  };
  /** Removes the user's own job that has ended, with its result. */
  "DELETE /api/v1/build/jobs/:job": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: void;
    paged: false;
    long: false;
    joined: false;
  };
  /** Cancels the user's own running job. */
  "POST /api/v1/build/jobs/:job/cancel": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: { cancelled: boolean };
    paged: false;
    long: false;
    joined: false;
  };
  /** His World Info books a pin may name an entry of, the engine's own left out: those the chat has first, then by name, each with whether a character brought it and when it was made, which tells books of one name apart. */
  "GET /api/v1/build/lore/books": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: { books: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** One of his books' entries, for the pin picker and the lore editor: in the book's order, each with its LRE fields, its secret marks and the revision a write must name. */
  "GET /api/v1/build/lore/books/:book/entries": {
    params: { book: string };
    query: Record<string, never>;
    body: undefined;
    reply: { entries: BookEntries };
    paged: false;
    long: false;
    joined: false;
  };
  /** Sets one entry's own LRE fields (its visibility, links and aliases; null takes them off) on his press, checked against the revision the page read: the rest of its extension data and an earlier build's secrecy fields stay as they are, and nothing else of the entry is written. A write on an entry that changed since is refused as a conflict. Kept with the entry before and after, so it can be put back. */
  "POST /api/v1/build/lore/books/:book/entries/:entry/fields": {
    params: { book: string; entry: string };
    query: Record<string, never>;
    body: { fields: JsonValue; revision: number };
    reply: { entries: BookEntries };
    paged: false;
    long: false;
    joined: false;
  };
  /** Make secret and Make public on one entry, on his press, checked against the revision the page read: the change is written as secret marks into the entry's text and nothing else of it. A write on an entry that changed since is refused as a conflict. Kept with the entry before and after, so it can be put back. */
  "POST /api/v1/build/lore/books/:book/entries/:entry/mark": {
    params: { book: string; entry: string };
    query: Record<string, never>;
    body: { change: JsonValue; revision: number };
    reply: { entries: BookEntries };
    paged: false;
    long: false;
    joined: false;
  };
  /** The lore index of the books a world reads, as its draft names them: the text an index entry holds, each book with how many entries it lists, and the entry written of it, if one is, with whether the index has changed since. */
  "GET /api/v1/build/lore/index": {
    params: Record<string, never>;
    query: { world: string };
    body: undefined;
    reply: { index: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Writes the world's lore index as an entry, on his press: the entry written before, where it is still at the revision Build left it at (one changed in Lumiverse since is refused as a conflict), else a new entry of the book named. */
  "POST /api/v1/build/lore/index": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { world: string; book?: string };
    reply: { index: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Every pin of a world's draft (with `world`) or of the revision a chat plays (with `chat`), read now: by character, by place and by step, each with its entry's or book's title, where it comes from and whether it reads. */
  "GET /api/v1/build/lore/pins": {
    params: Record<string, never>;
    query: { world?: string; chat?: string };
    body: undefined;
    reply: { pins: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** His books (the engine's own left out) and where each one's move from LRE's old secrecy fields to secret marks stands: never moved or put back, moved and waiting for his check, confirmed, or put back in part. */
  "GET /api/v1/build/secrecy/books": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: { books: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** One book read now, with what moving it to secret marks would do, entry by entry, or what its move did; writes nothing. */
  "GET /api/v1/build/secrecy/books/:book": {
    params: { book: string };
    query: Record<string, never>;
    body: undefined;
    reply: { book: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Apply: the undo copy of every entry the move lists is kept first, then each secret and each twin of one is written as its mark, with the old fields left on; each write is checked against the revision read. Refused as a conflict once the book or its move changed since the page read it, and while a move is under way. */
  "POST /api/v1/build/secrecy/books/:book/apply": {
    params: { book: string };
    query: Record<string, never>;
    body: { version: string };
    reply: { book: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Confirm: once the book reads right, LRE's old secrecy fields come off every moved entry; the undo copy stays. */
  "POST /api/v1/build/secrecy/books/:book/confirm": {
    params: { book: string };
    query: Record<string, never>;
    body: { version: string };
    reply: { book: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Restore secrecy as it was: every entry in the undo copy goes back as it stood before the move, byte for byte, after what he changed since is kept in the copy. */
  "POST /api/v1/build/secrecy/books/:book/restore": {
    params: { book: string };
    query: Record<string, never>;
    body: { version: string };
    reply: { book: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** The chats RPE played, the most recently played first, then the chats its store holds that it has not played (one a migration carried, one a world was attached to, one where something of it was kept before its first turn: a change, a setting, a job), by name. A chat a page only read is not among them. */
  "GET /api/v1/chats": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: ChatsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** His word on a question a lane set to Confirm is waiting on: go ahead, or not with a reason the agent is given. Says whether it reached a question that was waiting. */
  "POST /api/v1/chats/:chat/approvals/:approval/answer": {
    params: { chat: string; approval: string };
    query: Record<string, never>;
    body: ApprovalAnswerBody;
    reply: ApprovalAnswerReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's bootstrap: the six facts of "done enough"; the start as it stands (whether the skill is in force, the relive words it offers, the token limit at which a job asks, how a cached token counts, and each cap on a bootstrap job's run); the chat's bootstrap jobs under way; and the question of each that waits for his word. */
  "GET /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: BootstrapChatReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts a chat's bootstrap job (taking on a story with a past), with his choice of what to relive (a word the skill offers, or none) and his own token limit for this job if he sets one; a second start while one is under way begins a second job. A start that is refused is answered in words, with nothing started. */
  "POST /api/v1/chats/:chat/bootstrap": {
    params: { chat: string };
    query: Record<string, never>;
    body: BootstrapStartAsk;
    reply: JobView;
    paged: false;
    long: false;
    joined: false;
  };
  /** His word to a bootstrap job of the chat that waits for it at its token limit: go on in its own session, asking again after `more` tokens (its token limit again when left out), or end with what it has. */
  "POST /api/v1/chats/:chat/bootstrap/:job/answer": {
    params: { chat: string; job: string };
    query: Record<string, never>;
    body: BootstrapAnswerAsk;
    reply: JobView;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's bootstrap jobs a page at a time, the newest started first, each with what it was given and how it stands or ended. */
  "GET /api/v1/chats/:chat/bootstrap/jobs": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: BootstrapJobShown[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** A migrated chat's carried turns, in the order the run imported them, each tied to its message and swipe, with the engine that played it, why it stood with no turn played, and how many departures and texts of the old engine it holds. `from` is how many to pass over; `limit` how many to give (the setting `migration.page` when left out, at most `migration.maxPage`). */
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
  /** Everything on one character's record, by kind: at the chat's newest turn, or as it stood at one of its turns. The base as it stands with the accepted growth laid over it, each bound source read live and marked against the base, a principal's whereabouts and intention while it is away, and its game side; each list bounded by cast.queryItems, read further back with `part` and `skip`. */
  "GET /api/v1/chats/:chat/cast/:character": {
    params: { chat: string; character: string };
    query: { turn?: TurnId; part?: CharacterListName; skip?: number };
    body: undefined;
    reply: CharacterReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Redraws documents of a character's base as the owner's own change: each document given that differs from the one in force is written as the next version of its part, drawn against the sources as they stand in Lumiverse now. Told to the Author in the next briefing. */
  "POST /api/v1/chats/:chat/cast/:character/base": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: BaseAsk;
    reply: CastEditedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Sets how large a part a character plays, as the owner's own change: pinned, it stands over the Author's castings; not pinned, it is his casting alone and the Author may change it; or takes the pin away. Told to the Author in the next briefing. */
  "POST /api/v1/chats/:chat/cast/:character/casting": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: CastingAsk;
    reply: CastEditedReply;
    paged: false;
    long: false;
    joined: false;
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
  /** Says which of the world's people a character is, by the person's id or name (null takes the reference away), as the owner's own change; the character's game side and its holdings are found by it. Told to the Author in the next briefing. */
  "POST /api/v1/chats/:chat/cast/:character/person": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: PersonAsk;
    reply: CastEditedReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Binds a source to a character (a card, a persona, a lore entry or a memory entity Lumiverse holds), says again which side of it a bound source defines, or takes the binding away, as the owner's own change. Told to the Author in the next briefing. */
  "POST /api/v1/chats/:chat/cast/:character/sources": {
    params: { chat: string; character: string };
    query: Record<string, never>;
    body: SourceAsk;
    reply: CastEditedReply;
    paged: false;
    long: false;
    joined: false;
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
  /** What each agent definition in force for a chat is given by name, each name's kind and whether it resolves at the chat's newest turn as the turn would give it, and the names nothing provides. */
  "GET /api/v1/chats/:chat/given": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: GivenReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** One part of the GM view of the chat at its head (everything, secrets included): one of the view's parts, the roster, or the outline of them all; with `id`, of the entities, money or organizations that one (by id or name), with `ids` those, with `kind` those of the kind. With `since` the key of an answer held: `same` while the head is still there. */
  "GET /api/v1/chats/:chat/gm/parts/:part": {
    params: { chat: string; part: string };
    query: { id?: string; ids?: string; kind?: string; since?: string; bytes?: string };
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** A person's things as the GM reads them, with the pickers. */
  "GET /api/v1/chats/:chat/gm/people/:entity/things": {
    params: { chat: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** GM → Things' list of the chat at its head: each thing with who has it and where, where the player character is, and why each thing someone has is theirs. */
  "GET /api/v1/chats/:chat/gm/things": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** A thing's page as the GM reads it: the page, the pickers, and what the GM's adds (its rest, why it is had, its history in this chat over the path's events, its findings). */
  "GET /api/v1/chats/:chat/gm/things/:entity": {
    params: { chat: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** He starts a job of the chat, as his own and tied to no turn, with any agent definition, its brief, what it is given and limits of its own. */
  "POST /api/v1/chats/:chat/jobs": {
    params: { chat: string };
    query: Record<string, never>;
    body: JobStartAsk;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** He starts a job of the chat, as his own and tied to no turn, in which a character's own agent (the character definition, playing the character he names) takes in what it has perceived and not yet taken in, briefed by the line take_in of `.prompts/cast-jobs.md`. */
  "POST /api/v1/chats/:chat/jobs/take-in": {
    params: { chat: string };
    query: Record<string, never>;
    body: TakeInAsk;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The player's journal: each quest he may see, at the chat's newest turn or as it stood at one of its turns, with the stages he may see, each with what the Author called on it and why. A quest the Author set to show him nothing is absent, with no count. */
  "GET /api/v1/chats/:chat/journal": {
    params: { chat: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: Journal;
    paged: false;
    long: false;
    joined: true;
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
  /** Your own lines for one entry of a chat's lore: its kind (any one line of text, not empty), its line (not empty), what it defines (each to a record by its id, a name given resolving to the one record of that name, else kept as written and shown unlinked) and its related entries (each an entry of the chat's lore, else refused). What you set stands over an indexing run's and outlives a run that redoes the entry; null takes yours off, and the run's shows again. Answers the entry as it now stands. */
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
  /** Saves the chat's latest reply, or an excerpt of its messages (found whatever its spacing and case; text it does not hold word for word is saved at its latest reply), as a draft lore entry of the world the chat plays, with the message it came from. The title is its first words; nothing is committed; the same title twice gets a fresh id. A chat that plays no world is refused. */
  "POST /api/v1/chats/:chat/lore/save": {
    params: { chat: string };
    query: Record<string, never>;
    body: { text?: string };
    reply: { world: string; id: string };
    paged: false;
    long: false;
    joined: false;
  };
  /** What the chat made in play (things, places, the grids laid or changed) that the world's draft sent does not have, or has already. */
  "POST /api/v1/chats/:chat/made": {
    params: { chat: string };
    query: Record<string, never>;
    body: { draft: JsonValue };
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** Keep in the world: the draft patch that copies the picked places, then things, into the world's draft sent, each under its own id, with what would be kept, what skipped and why. The page sends the patch to Build's draft route. */
  "POST /api/v1/chats/:chat/made/keep": {
    params: { chat: string };
    query: Record<string, never>;
    body: { draft: JsonValue; things: string[]; places: string[] };
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The grids of a chat: each place that has one, the grid's id and the map that draws it, whether it is the world's own, laid in play or the world's own changed in play, its size and how wide a square is. */
  "GET /api/v1/chats/:chat/maps": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: MapsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Lays a grid for a place, by the same code as the `map_lay` tool: rows of symbols, or a walled room of a width and a height; over one square of a coarser map with `over` and `square`. His own change, applied at once, with an Undo, told to the Author at the next turn unless he says not to. */
  "POST /api/v1/chats/:chat/maps": {
    params: { chat: string };
    query: Record<string, never>;
    body: { place: string; rows?: string[]; width?: number; height?: number; doors?: number[][]; legend?: { [key: string]: JsonValue }; feet?: number; title?: string; over?: string; square?: number[]; tell?: boolean };
    reply: MapWrote;
    paged: false;
    long: false;
    joined: false;
  };
  /** One grid in full, both layers as data: what is drawn with the squares the chat changed laid over, everyone and everything on it, the doors as they stand, what the chat changed, the scale and the time step; at the chat's head, or at a turn. */
  "GET /api/v1/chats/:chat/maps/:place": {
    params: { chat: string; place: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: MapGridReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** Keeps the chat's map of a place in the world: its map as the chat plays it, with the squares drawn on it, copied into the world's draft, the working copy Build edits, with the places, paths and settings named; the chat keeps its own changes until the world takes them in. */
  "POST /api/v1/chats/:chat/maps/:place/keep": {
    params: { chat: string; place: string };
    query: Record<string, never>;
    body: { places?: string[]; paths?: string[]; settings?: boolean };
    reply: MapKept;
    paged: false;
    long: false;
    joined: false;
  };
  /** Drags someone or something to a square of the grid of a place: his own change, applied at once on the chat's line, with an Undo, told to the Author at the next turn unless he says not to. Dropped on the area of another room of the place, it is in that room (at the room's entrance when the room has a grid of its own); one that lies on or in something is taken off it and stands on the square. */
  "POST /api/v1/chats/:chat/maps/:place/moves": {
    params: { chat: string; place: string };
    query: Record<string, never>;
    body: { who: string; square: number[]; tell?: boolean };
    reply: MapWrote;
    paged: false;
    long: false;
    joined: false;
  };
  /** Edits squares of the grid of a place, by the same code as the `map_edit` tool: strokes of one symbol over squares, a rectangle or a line, and what a symbol stands for. His own change, applied at once, with an Undo, told to the Author at the next turn unless he says not to. */
  "POST /api/v1/chats/:chat/maps/:place/squares": {
    params: { chat: string; place: string };
    query: Record<string, never>;
    body: { strokes: { symbol: string; squares?: number[][]; rect?: number[][]; line?: number[][] }[]; legend?: { [key: string]: JsonValue }; tell?: boolean };
    reply: MapWrote;
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
    joined: false;
  };
  /** What a chat plays by on its own now: how closely each part of life is worked out, what something you add that the world doesn't have becomes, and when checks roll; a chat that plays no world answers that it has none. */
  "GET /api/v1/chats/:chat/own-values": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: OwnValues;
    paged: false;
    long: false;
    joined: false;
  };
  /** One change to what a chat plays by on its own, recorded at once as his own edit from now on, over nothing already recorded, and taken back by the Undo its answer names; a change refused (a chat that plays no world, a level under its world's floor, one that cannot be read) is answered as not applied, in words, with nothing changed. */
  "POST /api/v1/chats/:chat/own-values": {
    params: { chat: string };
    query: Record<string, never>;
    body: OwnAsk;
    reply: OwnAnswer;
    paged: false;
    long: false;
    joined: false;
  };
  /** A person's usual day at the chat's head: as far as the player character may know them (`view=player`; one he does not know reads as no one), or the GM's, with why each block is there (`view=gm`, at `day` where given). */
  "GET /api/v1/chats/:chat/people/:entity/day": {
    params: { chat: string; entity: string };
    query: { view: "player" | "gm"; day?: string };
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** A person's things: what they carry, wear and keep, and where each is; none for an id that is no person. */
  "GET /api/v1/chats/:chat/people/:entity/things": {
    params: { chat: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The perception record of a turn, or of the stretch of turns ending at it: who was on stage, how the stage was read (the open scene, where the owner's character stands, or not recorded), and for each the perceptions of that turn they have, or none; a turn a migration carried says so, owes none, and gives each one's old mind files carried with them. */
  "GET /api/v1/chats/:chat/perceptions": {
    params: { chat: string };
    query: { turn?: TurnId; count?: number };
    body: undefined;
    reply: PerceptionRecordReply;
    paged: false;
    long: false;
    joined: true;
  };
  /** The chat's places as it plays them, the world's own and those made in play, a page at a time, at the chat's newest turn or as it stood at one of its turns: each with the place it is in, what kind of place it is and whether it draws a grid of its own. */
  "GET /api/v1/chats/:chat/places": {
    params: { chat: string };
    query: { turn?: TurnId; limit?: number; cursor?: string };
    body: undefined;
    reply: Places;
    paged: true;
    long: false;
    joined: true;
  };
  /** One place of the chat in full, by its id or its name, at the chat's newest turn or as it stood at one of its turns, in its nine parts: its sources read live and its base, what the story changed there, its features, who and what is here, its ways, its access and state, its history and who knows of it. */
  "GET /api/v1/chats/:chat/places/:place": {
    params: { chat: string; place: string };
    query: { turn?: TurnId };
    body: undefined;
    reply: PlaceRecord;
    paged: false;
    long: false;
    joined: true;
  };
  /** Writes the owner's own words as a place's base, a change of his own with source player, placed after the chat's newest reply on its own line: swiping that reply keeps it and a turn that is running goes on from the state it started with. It is drawn against the entries bound to the place as they stand, so the base is no longer marked older than its sources; he undoes it from the review card. */
  "PUT /api/v1/chats/:chat/places/:place/base": {
    params: { chat: string; place: string };
    query: Record<string, never>;
    body: { text: string };
    reply: PlaceBaseWritten;
    paged: false;
    long: false;
    joined: false;
  };
  /** A tap that plays now (a chip, Send now, Timelapse or a tap with words): its line put in the chat as his message and a reply started, through Lumiverse's own routes as him, with nothing written into message or chat metadata; the turn that answers it is told what was pressed. */
  "POST /api/v1/chats/:chat/plays": {
    params: { chat: string };
    query: Record<string, never>;
    body: PlayAsk;
    reply: PlayedReply;
    paged: false;
    long: false;
    joined: false;
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
  /** Each turn's prompt notices and front, newest first, with its number on the chat's path and Lumiverse's clipping, for the turns whose prompt RPE still keeps. The settings `turns.page` and `turns.maxPage` give a page's length. */
  "GET /api/v1/chats/:chat/prompt/history": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: PromptTurnShown[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** The chat's quests, the world's and those opened in play, in brief, a page at a time: each with what it is, its stages and what was called on them, who and where, its stakes, how it was shown to the player and whether it is open. */
  "GET /api/v1/chats/:chat/quests": {
    params: { chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: QuestRecords;
    paged: true;
    long: false;
    joined: false;
  };
  /** One quest of the chat in full, by its id or its name: its record, and every write made to it in the order made. */
  "GET /api/v1/chats/:chat/quests/:quest": {
    params: { chat: string; quest: string };
    query: Record<string, never>;
    body: undefined;
    reply: QuestRecord;
    paged: false;
    long: false;
    joined: false;
  };
  /** The line under each reply asked for, by the swipe Lumiverse shows: its turn, the world's date and time at the turn's end and his character's place, each lane's changes (a count and the lines a person reads), the turn's marks, and why the turn's record of the reply was not finished where it was not, with whether Settle now settles it; a reply made without RPE says so, a carried one names the engine that played it, and a continue's held turn joined to another is answered in the joined form with the line of the turn it joined. */
  "GET /api/v1/chats/:chat/replies": {
    params: { chat: string };
    query: { ids: string };
    body: undefined;
    reply: RepliesReply;
    paged: false;
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
  /** Holds a composer control's ask (depth or swipe) for the next message, in place of one of its kind that waited; one longer than turn.maxRequestChars is not kept, and the answer says so. */
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
  /** A panel's tap for his next message (the palette, Walk here, any tap with no words): held as a request in place of the panel's tap that waited, and the same tap again takes it back; the turn that answers his next message is told what was pressed and on what. */
  "POST /api/v1/chats/:chat/requests/panel": {
    params: { chat: string };
    query: Record<string, never>;
    body: PanelTapAsk;
    reply: PanelHeldReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Whose routines or schedules this chat changed, by him or by the story. */
  "GET /api/v1/chats/:chat/routines/changed": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** Runs a rule, as it reads now, against a past turn of the chat, with that turn's facts; writes nothing. A turn joined to another is answered as such. */
  "POST /api/v1/chats/:chat/rules/:name/test": {
    params: { chat: string; name: string };
    query: Record<string, never>;
    body: RuleTestAsk;
    reply: RuleTest;
    paged: false;
    long: true;
    joined: false;
  };
  /** The rules that fired in a chat, newest first, a page at a time (a job's of his among them), each with what the agent did next; `cursor` is the last id read. The setting `turns.page` gives a page's length. */
  "GET /api/v1/chats/:chat/rules/firings": {
    params: { chat: string };
    query: { rule?: string; limit?: number; cursor?: string };
    body: undefined;
    reply: FiringsReply;
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
    reply: SessionCompactAnswer;
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
  /** A chat's head as one document, for the command line's sandbox to open a scratch copy of the chat from: the world as played, the engine's state as plain JSON, the revision in force, the engine that folded it, the run's seed and the clock. Read from the store alone, nothing is written. It holds everything the engine knows of the chat, secrets included, so it answers the owner's page alone. */
  "GET /api/v1/chats/:chat/state/export": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: ChatExportReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The history of one value by turn: every change along the chat's path, at its head or up to a turn, that wrote the part asked for of the level asked for (a field, a relation, a balance as `posted`, a quest's stage as `stage` of `track:<id>`, a fact's key, a world value, an area item's part), newest first, a page at a time; each with its turn, lane, who made it, its marks and reports, and for a fact the later exact record that settled it. */
  "GET /api/v1/chats/:chat/state/history": {
    params: { chat: string };
    query: { at: string; part: string; turn?: TurnId; limit?: number; cursor?: string };
    body: undefined;
    reply: ValueHistoryReply;
    paged: false;
    long: false;
    joined: true;
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
  /** A tap that manages, or a correction from any page, recorded at once as his own edit; what the world's rules turn down is applied with its report; a refusal is answered in words with nothing changed. A tap of one of the world's actions that does not manage is held for his next message, taken back, or played now, as the panel's own routes do it, and the answer says which. */
  "POST /api/v1/chats/:chat/taps": {
    params: { chat: string };
    query: Record<string, never>;
    body: TapAsk;
    reply: TapReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** The chat's things at its head: each thing in play with who has it, where it stands and why it is theirs, as the things browser lists them. */
  "GET /api/v1/chats/:chat/things": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** A thing's page: what it is, where it stands, who has it and why, what it holds, its rest and its history; none for an id that is no thing. */
  "GET /api/v1/chats/:chat/things/:entity": {
    params: { chat: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The ids of the chat's things that the words name. */
  "GET /api/v1/chats/:chat/things/find": {
    params: { chat: string };
    query: { words: string };
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The catalog the player's + Add offers: the types of things and the vehicle classes the chat's world has, and the pickers that go with them. */
  "GET /api/v1/chats/:chat/things/types": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** Tidy up: what does not add up among the chat's things at its head, every kind, each with its fix or fixes, less those he left as they are, at most `things.maxTidyFindings`; with the switch on or off. Nothing is changed. */
  "GET /api/v1/chats/:chat/tidy": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** Leave it, or bring it back: the finding's key put in the chat's `things.tidyLeft` (newest last, the oldest gone past `things.maxTidyLeft`), or taken out; then Tidy up's run as it stands. */
  "POST /api/v1/chats/:chat/tidy/left": {
    params: { chat: string };
    query: Record<string, never>;
    body: { key: string; left: boolean };
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** One of the HUD's time controls (Pause clock, Resume clock, and the others the clock's controls carry), at its scope and with its value, recorded at once as his own edit; a refusal is answered in words with nothing changed. */
  "POST /api/v1/chats/:chat/time": {
    params: { chat: string };
    query: Record<string, never>;
    body: { control: string; scope: JsonValue; to: JsonValue };
    reply: TapReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A chat's turns, newest first, each with what its runs spent together and each of its runs by itself (its kind, where it stands, its error, its moments and its own spend); `before` is a turn's id, and older ones follow it. The settings `turns.page` and `turns.maxPage` give a page's length. */
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
  /** A turn's one review card: whether the turn was dropped with nothing saved, so that none of its changes stands; its changes by lane (the story's and the engine's, every area's), each applied or not with its reports and who decided it, its undo and the changes that undid it; the questions asked on it, those waiting for his word first; and the cards the earlier engine kept for a turn carried in. */
  "GET /api/v1/chats/:chat/turns/:turn/card": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: ReviewCardReply;
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
  /** Undoes one change of a turn as his own (source player): records the changes that reverse it, citing it, at the chat's head; nothing recorded is taken away. Says what was recorded and what is left, as report codes (a part a later change wrote since, a change with no reversal) and in the play answers' words. */
  "POST /api/v1/chats/:chat/turns/:turn/changes/:change/undo": {
    params: { chat: string; turn: string; change: string };
    query: Record<string, never>;
    body: undefined;
    reply: UndoReply;
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
  /** Whether a turn runs now and whether his pause holds it, read at once, for a page opened while it runs. */
  "GET /api/v1/chats/:chat/turns/:turn/live": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: TurnLiveState;
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
  /** Holds a turn's run before its next model call (the call in flight finishes; Stop still stops it). */
  "POST /api/v1/chats/:chat/turns/:turn/pause": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: TurnControlled;
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
  /** Lets a turn's run go on where his pause held it. */
  "POST /api/v1/chats/:chat/turns/:turn/resume": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: undefined;
    reply: TurnControlled;
    paged: false;
    long: false;
    joined: true;
  };
  /** Says something to the Author while the turn runs: the lead hears it at its next model call as his words, and the trace shows it. */
  "POST /api/v1/chats/:chat/turns/:turn/say": {
    params: { chat: string; turn: string };
    query: Record<string, never>;
    body: TurnSay;
    reply: TurnControlled;
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
  /** What moving the chat to a revision of its world would bring in, entity by entity and part by part, each with the pick it defaults to and why; a secret row is marked behind the spoiler gate. */
  "GET /api/v1/chats/:chat/upgrade": {
    params: { chat: string };
    query: { to: string };
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** Moves the chat to a revision of its world from its next turn, with his picks (a change not named takes its default): his own change, placed after the newest reply while a run goes on. The turn that runs now keeps the revision it started with; the next plays the new one and tells the Author. */
  "POST /api/v1/chats/:chat/upgrade": {
    params: { chat: string };
    query: Record<string, never>;
    body: { to: string; merge?: JsonValue };
    reply: ChatUpgraded;
    paged: false;
    long: false;
    joined: false;
  };
  /** Takes an Upgrade of the chat back, whole: the chat goes to the revision it came from, from its next turn; what play changed since stays as played. */
  "POST /api/v1/chats/:chat/upgrade/undo": {
    params: { chat: string };
    query: Record<string, never>;
    body: { edit: string };
    reply: ChatUpgradeUndone;
    paged: false;
    long: false;
    joined: false;
  };
  /** What a step to a square of the grid the player's character stands on would take: its minutes, or the reason there is no way there. */
  "GET /api/v1/chats/:chat/walk": {
    params: { chat: string };
    query: { x: number; y: number };
    body: undefined;
    reply: { minutes: number; disabled?: string };
    paged: false;
    long: false;
    joined: false;
  };
  /** What the chat's history window is now, for its marker: whether it is on, the first history message it keeps on the chat's current path (with the step and the hold as the chat's settings set them), the message just above it, how many messages lie above, and how many of those the story does not cover yet; only the signed-in user's own chats. */
  "GET /api/v1/chats/:chat/window": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: ChatWindowReply;
    paged: false;
    long: false;
    joined: false;
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
  /** The connections, each with whether a key is set (nothing of the key), its model's limits as RPH uses them and its newest tag check; the default; the providers offered. */
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
  /** Checks whether a connection keeps the reply's tags: simple turns played on it as a job, whose id is answered at once; the connection's view then shows the result, when it was checked and the reply form it got. */
  "POST /api/v1/connections/:id/tag-check": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: TagCheckStarted;
    paged: false;
    long: false;
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
  /** The web search provider web_search asks: its address, and whether a key is kept for it. */
  "GET /api/v1/connections/web": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: WebProviderShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** Sets the web search provider web_search asks, or takes it away; a key follows the address it was given for. */
  "PUT /api/v1/connections/web": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: WebProviderSet;
    reply: WebProviderShown;
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
  /** "Apply now": makes each lead's opening block of the chat's open session afresh from the files as they stand, there and then, and the next run of each takes it; says which session, or that none is open and the next one opens with the files as they stand. Nothing else carries it. */
  "POST /api/v1/files-apply": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: ApplyNowAsk;
    reply: ApplyNowReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Copies a file or folder to a path nothing stands at (the copy of a folder leaves its links out); a shipped file or folder is only read, and its copy is the user's own file; a file copied into a folder of guidance is a file of that kind, which the answer says. Never into the shipped level or a place RPE makes again. */
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
  /** The file a chat's agents are given by the name of the file at a path (a shipped file's, say), whether or not that file is there: the nearest level's file of that name, not switched off; read as one file of the tree is read. With no chat, of the shipped and global levels. */
  "GET /api/v1/files-in-force/*": {
    params: { "*": string };
    query: { chat?: string; line?: number; lines?: number; offset?: number; length?: number };
    body: undefined;
    reply: TreeFileReply;
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
  /** Switches a file's name off or on again in the `stack.off` list of a level's config, which is what "Delete" on a shipped file does; for a hooks file, one hook of it by its name; says the file as the listing now shows it. */
  "PUT /api/v1/files-off/*": {
    params: { "*": string };
    query: Record<string, never>;
    body: FileSwitchAsk;
    reply: FileWrittenReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Pins a file for an agent, or takes the pin away, in the `stack.pins` list of a level's config (the global level's, or a chat's): the agent is handed the file whole at the start of each of its runs. A path the view does not hold is refused; says the file as the listing now shows it. */
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
  /** A prompt part or a tool's description rendered as RPH renders it for a chat, as saved or as he drafts it, its fields filled from its last use there, with any problem in it; nothing is written. */
  "POST /api/v1/files-preview": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { path: string; chat?: string; text?: string };
    reply: PartPreviewReply;
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
  /** The exact stack an agent gets in a chat, part by part, each with the file it comes from and its text, and the briefing's parts with the situations that add them; then what the agent is handed whole at the start of each run, in the order it is handed (what its definition lists in `given:`, then each file pinned for it), each with why it is there. With no chat, the stack the shipped and global levels give. */
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
  /** Removes a file of the user's; for one in place of a default, that is resetting to the default. "Delete" on a shipped file writes its name in the `stack.off` list of the level named (the chat's when a chat is named, else the global level's), so the shipped file stays and is not in force. A folder of the user's goes when it is empty; one that holds anything is refused in words that say what it holds, until `contents` asks for it to go with all it holds. */
  "DELETE /api/v1/files/*": {
    params: { "*": string };
    query: { chat?: string; level?: "global" | "chat"; contents?: boolean };
    body: undefined;
    reply: { removed: string; switchedOff?: LayerLevel };
    paged: false;
    long: false;
    joined: false;
  };
  /** His jobs a page at a time, of every chat or of one, in one state or in any, the newest started first, each as RPH keeps it: where it stands, its agent, who started it and the turn that did. */
  "GET /api/v1/jobs": {
    params: Record<string, never>;
    query: { chat?: string; state?: "queued" | "held" | "running" | "asking" | "done" | "failed" | "cancelled" | "off-path" | "interrupted"; limit?: number; cursor?: string };
    body: undefined;
    reply: { items: JobView[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** He starts a job of no chat, as his own and tied to no turn, with any agent definition, its brief, what it is given and limits of its own. */
  "POST /api/v1/jobs": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: JobStartAsk;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** One job: its record, its run's trace, what its run spent by agent, and how full each of its agents' windows is while it runs. */
  "GET /api/v1/jobs/:job": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobShownReply;
    paged: false;
    long: true;
    joined: false;
  };
  /** Answers a job that asks whether to go on: it goes on in its own session, to the point it asks at next (none: it asks no more), or ends with what it has. */
  "POST /api/v1/jobs/:job/answer": {
    params: { job: string };
    query: Record<string, never>;
    body: { go: "on"; askAt?: number } | { go: "end" };
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Cancels a job; one that has ended already is given as it ended. */
  "POST /api/v1/jobs/:job/cancel": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** What a job recorded, change by change, with its source, what it cites, whether it applied and what undid it, beside the gap checks, consents and rules the job was told. */
  "GET /api/v1/jobs/:job/changes": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobChangesReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Undoes one change a job recorded, as his own: the changes reversing it are recorded at the chat's head, citing it. Says what was recorded and what is left, as report codes and in the play answers' words. */
  "POST /api/v1/jobs/:job/changes/:change/undo": {
    params: { job: string; change: string };
    query: Record<string, never>;
    body: undefined;
    reply: UndoReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Carries on a job that stopped at one of its own limits, from its own session where it stood, with more of each limit named. */
  "POST /api/v1/jobs/:job/continue": {
    params: { job: string };
    query: Record<string, never>;
    body: { limits?: JobLimitsAsk };
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Holds a job that waits for a place: it keeps its place and does not start until let go. */
  "POST /api/v1/jobs/:job/hold": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Pauses a running job: every agent of its run waits at its next call until he lets it go. */
  "POST /api/v1/jobs/:job/pause": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Lets go a job he held while it waited, or one he paused while it ran. */
  "POST /api/v1/jobs/:job/release": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts again a job that was interrupted by a restart, failed or was cancelled: a new job of his with the same agent, brief, attachments and limits, tied to no turn. */
  "POST /api/v1/jobs/:job/restart": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Resumes an interrupted job from the last call its own session holds, with what it had done and spent. */
  "POST /api/v1/jobs/:job/resume": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: JobReply;
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
  /** Undoes all a job recorded that no change of his undid yet, the newest first, as his own. Says what was recorded and what is left, as report codes and in the play answers' words. */
  "POST /api/v1/jobs/:job/undo": {
    params: { job: string };
    query: Record<string, never>;
    body: undefined;
    reply: UndoReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Says a word to a running job's lead, which hears it at its next call as his. */
  "POST /api/v1/jobs/:job/word": {
    params: { job: string };
    query: Record<string, never>;
    body: { text: string };
    reply: JobReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** His switches over all his jobs, and the limits in force for jobs (for the chat's levels, or the shared ones) with the use each is held against over the last 24 hours. */
  "GET /api/v1/jobs/switches": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: JobSwitchesReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Switches all his jobs off or on, holds them or lets them go, and answers the switches with the limits in force. */
  "POST /api/v1/jobs/switches": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { off?: boolean; held?: boolean };
    reply: JobSwitchesReply;
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
  /** The Migration page's summary: the last real run and the page's rehearsal in brief, the folders a rehearsal reads, the backup, what waits on the user, the swap's steps and going back's with the permissions by name; before any run as after. */
  "GET /api/v1/migration": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: MigrationReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A page of a report's chats, each by its name in Lumiverse: what today's readers found, what the real run did with it and its check, and, for a chat the report found off RPE, where it stands now (the same read as the list at the head of the Migration page). `q` keeps those whose name or id holds it. */
  "GET /api/v1/migration/:of/chats": {
    params: { of: string };
    query: { q?: string; limit?: number; cursor?: string };
    body: undefined;
    reply: MigrationChatsReply;
    paged: true;
    long: false;
    joined: false;
  };
  /** One chat of a report in full: as the chats' list gives it, what today's readers found of it, and what the last real run that imported it carried of it. */
  "GET /api/v1/migration/:of/chats/:chat": {
    params: { of: string; chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: MigrationChatReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A page of where a chat's state differed from today's fold, in the order the run checked it: at a swipe or at the head, the values that differ by path, and whether today's state there is kept as the turn's start. */
  "GET /api/v1/migration/:of/chats/:chat/differences": {
    params: { of: string; chat: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: MigrationDifferencesReply;
    paged: true;
    long: false;
    joined: false;
  };
  /** A report whole, with its printed text and the name to save it under, for the page to save as a file: counts, paths and checksums, never content. */
  "GET /api/v1/migration/:of/file": {
    params: { of: string };
    query: Record<string, never>;
    body: undefined;
    reply: MigrationFileReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** A page of the things a report found, in the order it found them: where each is, its path, size and SHA-256, its row and fate. `q` keeps those whose place, path, row or note holds it; `row` those of one row (`none`: found, not classified). */
  "GET /api/v1/migration/:of/items": {
    params: { of: string };
    query: { q?: string; row?: string; limit?: number; cursor?: string };
    body: undefined;
    reply: MigrationItemsReply;
    paged: true;
    long: false;
    joined: false;
  };
  /** A page of a report's rows (`run`: the last real run's; `rehearsal`: the page's), in the plan's order: each row's things counted to their ends, those with no place and why, and after a real run where they now are. */
  "GET /api/v1/migration/:of/rows": {
    params: { of: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: MigrationRowsReply;
    paged: true;
    long: false;
    joined: false;
  };
  /** A report's printed text, as the rehearsal or the run printed it. */
  "GET /api/v1/migration/:of/text": {
    params: { of: string };
    query: Record<string, never>;
    body: undefined;
    reply: MigrationTextReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Answers the keep-or-discard question today's build left the chat paused on (R-54): kept in RPE's database, written at every later run as today's pause chip writes it, and at once the held turns' changes land on their own turns, the later turns applied again on top, what no longer applies reported and the stretch named in the chat's next briefing. Today's data is never written. */
  "POST /api/v1/migration/chats/:chat/answer": {
    params: { chat: string };
    query: Record<string, never>;
    body: PausedAnswerAsk;
    reply: PausedAnswered;
    paged: false;
    long: true;
    joined: false;
  };
  /** One chat's record of why a run could not carry it, as RPE's data folder keeps it until a run carries the chat: the stage, the error's own words and its stack, the message it stood at, the broken record's place, kind and shape (never its content), and where that record is in the previous build's files; and the record's file. */
  "GET /api/v1/migration/chats/:chat/failure": {
    params: { chat: string };
    query: Record<string, never>;
    body: undefined;
    reply: MigrationFailureReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Picks one of RPE's connections for the work one of his own agents does, where today's choice named a connection that lives in Lumiverse: written as the `model:` of the agent's attached file, and of the one in force where it is switched on, so that work uses it from then on. */
  "POST /api/v1/migration/connection": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: ConnectionPick;
    reply: ConnectionPicked;
    paged: false;
    long: false;
    joined: false;
  };
  /** Removes one engine book of today's build and takes it out of every chat it is attached to, through Lumiverse's own routes as him, changing nothing else of any chat; only after he has said he will not go back. What it removed, and what it could not. */
  "POST /api/v1/migration/engine-books/:book/removal": {
    params: { book: string };
    query: Record<string, never>;
    body: undefined;
    reply: EngineBookRemoved;
    paged: false;
    long: true;
    joined: false;
  };
  /** Going back as it stands: its steps with the configured branch, the chats moved onto RPE's connections since the swap, RPE's own earlier connection and a key to put back; the permissions by name; what today's build put in Lumiverse; his word that he will not go back; and, only once he has said it, each engine book with the chats it is attached to. */
  "GET /api/v1/migration/going-back": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: GoingBackShown;
    paged: false;
    long: true;
    joined: false;
  };
  /** Keeps his word that he will not go back, once confirmed, with its time; said again, the first time stands. Only after it does the page offer to remove what today's build put in Lumiverse. */
  "POST /api/v1/migration/going-back": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: NoGoingBackAsk;
    reply: NoGoingBackSaid;
    paged: false;
    long: false;
    joined: false;
  };
  /** Starts a rehearsal over today's data, read-only as `rpe migrate --rehearse` reads it, and answers its report in brief once read; the running RPE holds the report in memory beside the last real run's, and nothing of it is written, RPE's database included. One under way is refused. */
  "POST /api/v1/migration/rehearsals": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: RehearsalAsk;
    reply: RehearsalReply;
    paged: false;
    long: true;
    joined: false;
  };
  /** One press switches one of his attached files on (R-81): GUIDANCE.md as AGENTS.md at the user's level, an agent where agents are read, a skill where skills are read; the attached file and its original stay under imported/ word for word. A file of that name already in force there is never written over: it is answered beside the attached one. */
  "POST /api/v1/migration/switch-on": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: SwitchOnAsk;
    reply: SwitchedOnShown;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every rule of a chat's stack, in force or not and why; with no chat, those of the shipped and global levels, as a new chat takes them. */
  "GET /api/v1/rules": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: RulesReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** Switches a rule on or off at a chat's level or the global one: its name goes into, or out of, the `stack.off` list of that level's config, the one list the Files page's switch writes; one switched off at a farther level stays off. An example is never in force and is not switched. */
  "POST /api/v1/rules/:name/switch": {
    params: { name: string };
    query: Record<string, never>;
    body: RuleSwitch;
    reply: RuleSwitched;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every fact a rule's trigger can name, RPH's and RPE's, with its value in the chat where RPE counts it and the rules whose text names it. */
  "GET /api/v1/rules/facts": {
    params: Record<string, never>;
    query: { chat?: string };
    body: undefined;
    reply: FactsReply;
    paged: false;
    long: false;
    joined: false;
  };
  /** How RPE runs: under its service or by hand, since when, where it listens, its build, whether its service put the known-good copy back, and the memory it holds now against its service's limit. */
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
  /** "Free what can be freed now": a full collection of the engine's heap, with the memory outside it freed too, and the process's figures before and after. Where they fall far, the engine was slow to collect; where they do not, something holds the memory. */
  "POST /api/v1/service/memory/free": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: MemoryFreed;
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
  /** The kept reports of the session measurement, newest received first, a page at a time: each with when it ran, the connection and model it ran on, the judging connection and whether its recommendation is written. One report whole is read by its id. */
  "GET /api/v1/sessions/measurements": {
    params: Record<string, never>;
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: MeasurementRow[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** Keeps a report of the session measurement, whole as it was sent: the three carry modes as played (each turn's tokens, time and calls, totals and medians, each planted decision with its check and the judge's answer, the look-ups and the repeated ones), when and on what it ran, and the recommendation of whoever ran it (blank until they write it). Every report is kept; one that does not fit its type is refused. Nothing here changes a setting: the default carry mode changes only when he presses it on the Sessions page. */
  "POST /api/v1/sessions/measurements": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: MeasurementReport;
    reply: MeasurementKept;
    paged: false;
    long: false;
    joined: false;
  };
  /** One kept report of the session measurement, whole as it was sent, with when RPE received it. */
  "GET /api/v1/sessions/measurements/:id": {
    params: { id: string };
    query: Record<string, never>;
    body: undefined;
    reply: MeasurementRead;
    paged: false;
    long: false;
    joined: false;
  };
  /** Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, the level and file it comes from, when a change takes effect, what it does and where the page shows it; one set per connection or per agent once for each. */
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
  /** Signs out: ends the session the call came with, so it opens nothing more, and the Lumiverse session its sign-in by password made, or the one the caller names, through the door to Lumiverse. */
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
  /** Whose the page's credential is, what it is (a session, which is renewed while a page is open, or the web key itself) and when it ends, and the web key in force with when it was made and when it ends. */
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
  /** Every thing that runs a command or calls out that the page's own user has listed and a file of theirs names now, and whether it waits, is on or is off, with what it runs or calls, or the address its connection's key would go to. A thing whose file is gone is not listed, and is there again, as it was switched, when a file names it again. Only rpe allow and rpe deny on the server switch one; no page can. */
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
  /** His worlds, by name. */
  "GET /api/v1/worlds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: { worlds: WorldIndexRow[] };
    paged: false;
    long: false;
    joined: false;
  };
  /** A new world, from a starter or blank. */
  "POST /api/v1/worlds": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { name: string; template: string | null };
    reply: WorldCreated;
    paged: false;
    long: false;
    joined: false;
  };
  /** A world at a revision (its head by default), with how each revision became head and what the packs give the editors. */
  "GET /api/v1/worlds/:world": {
    params: { world: string };
    query: { revision?: string };
    body: undefined;
    reply: WorldRead;
    paged: false;
    long: false;
    joined: false;
  };
  /** A world gone, with its draft, its history and every revision no chat plays; his worlds as they stand after. A chat that plays it keeps its record and the revisions it played, and plays no world from then on: a world can be attached to it again (`POST /worlds/:world/attach`). The chats that play a world are listed by `GET /worlds/chats?world=`, which is what to read before deleting it. */
  "DELETE /api/v1/worlds/:world": {
    params: { world: string };
    query: Record<string, never>;
    body: undefined;
    reply: { worlds: WorldIndexRow[] };
    paged: false;
    long: false;
    joined: false;
  };
  /** Attaches the world to a chat. A chat that plays no world takes the world's head revision from its next turn (a turn that runs now keeps the state it started with); so does one whose world was deleted, from the revision it played, which the deletion kept; one that plays an older revision of it is answered with where it stands, so the Upgrade is offered, and one that plays another world, with which. A chat that is not one of the user's chats in Lumiverse is refused (404). RPE writes nothing to Lumiverse for it. */
  "POST /api/v1/worlds/:world/attach": {
    params: { world: string };
    query: Record<string, never>;
    body: { chat: string };
    reply: WorldAttached;
    paged: false;
    long: false;
    joined: false;
  };
  /** What changed from one version of a world to another, part by part: for each part how many things were added, changed and removed, and the first of them named (the setting `worlds.maxChangesListed` says how many). From the world's head to its draft by default. */
  "GET /api/v1/worlds/:world/changes": {
    params: { world: string };
    query: { from?: string; to?: string };
    body: undefined;
    reply: WorldChanges;
    paged: false;
    long: false;
    joined: false;
  };
  /** A character as its own model, from the world's draft. */
  "GET /api/v1/worlds/:world/characters/:entity": {
    params: { world: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The draft as the world's next revision, with its note; one made on a draft that has moved on, or on a head that has, is refused. The source is the agent's where the command line or the MCP server made it, Build's where a page did. */
  "POST /api/v1/worlds/:world/commit": {
    params: { world: string };
    query: Record<string, never>;
    body: { base: string | null; note?: string; version?: number };
    reply: WorldCommitted;
    paged: false;
    long: true;
    joined: false;
  };
  /** A world's draft as it stands (the head while none is stored), with its lint, base and version. */
  "GET /api/v1/worlds/:world/draft": {
    params: { world: string };
    query: Record<string, never>;
    body: undefined;
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Discards the stored draft: the world goes back to its head. */
  "POST /api/v1/worlds/:world/draft/discard": {
    params: { world: string };
    query: Record<string, never>;
    body: { version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Puts one item of a collection into the draft (a new one without its id takes its key); what a map draws is edited in its map. */
  "PUT /api/v1/worlds/:world/draft/items/:collection/:id": {
    params: { world: string; collection: string; id: string };
    query: Record<string, never>;
    body: { value: JsonValue; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Takes one item of a collection out of the draft. */
  "DELETE /api/v1/worlds/:world/draft/items/:collection/:id": {
    params: { world: string; collection: string; id: string };
    query: { base?: string; version?: number };
    body: undefined;
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Sets one part of the draft (the world's name and start, its calendar, its ruleset, its tiers, its minds, its lookup table…) whole, as its editor sends it. */
  "PUT /api/v1/worlds/:world/draft/parts/:part": {
    params: { world: string; part: string };
    query: Record<string, never>;
    body: { value: JsonValue; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Applies an RFC 6902 patch to the draft, all of it or none; at most `worlds.maxPatchOps` operations bringing in at most `worlds.maxPatchChars`. */
  "POST /api/v1/worlds/:world/draft/patch": {
    params: { world: string };
    query: Record<string, never>;
    body: { ops: JsonValue; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Brings a ruleset profile into the draft in one write, each choice taking the author's own or the profile's. */
  "POST /api/v1/worlds/:world/draft/profile": {
    params: { world: string };
    query: Record<string, never>;
    body: { profile: string; choices: { [key: string]: "mine" | "profile" }; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Puts a copy of one of the world's revisions into the draft; committing it makes that content the head again. */
  "POST /api/v1/worlds/:world/draft/restore": {
    params: { world: string };
    query: Record<string, never>;
    body: { revision: string; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** Takes the version this build ships of each named data table into the draft. */
  "POST /api/v1/worlds/:world/draft/shipped": {
    params: { world: string };
    query: Record<string, never>;
    body: { tables: string[]; base: string | null; version?: number };
    reply: WorldDraft;
    paged: false;
    long: false;
    joined: false;
  };
  /** A world at a revision as an export file. */
  "GET /api/v1/worlds/:world/export": {
    params: { world: string };
    query: { revision?: string };
    body: undefined;
    reply: { file: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** The lint of a world at a revision (its head by default). */
  "GET /api/v1/worlds/:world/lint": {
    params: { world: string };
    query: { revision?: string };
    body: undefined;
    reply: { lint: WorldLintIssue[] };
    paged: false;
    long: false;
    joined: false;
  };
  /** A person's things, in the Character page's groups. */
  "GET /api/v1/worlds/:world/people/:entity/things": {
    params: { world: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** A page of the world's revisions, newest first: when each became head and what made it, the note given with it, how many things it changed against the revision before it, and the chats that play it now. The settings `worlds.revisionsPage` and `worlds.maxRevisionsPage` give a page's length. */
  "GET /api/v1/worlds/:world/revisions": {
    params: { world: string };
    query: { limit?: number; cursor?: string };
    body: undefined;
    reply: { items: WorldRevisionRow[]; next: string | null };
    paged: true;
    long: false;
    joined: false;
  };
  /** The Sheet Designer's live preview: the draft with an unsaved ruleset in place of its own, read on an entity (the point of view by default) as a new chat would start; nothing is saved. */
  "POST /api/v1/worlds/:world/sheet": {
    params: { world: string };
    query: Record<string, never>;
    body: { ruleset: JsonValue; entity?: string };
    reply: { sheet: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** Every thing of the draft as a chat would start from it, with its size, where it is and whose it is, and the same by owner. A draft whose calendar or start does not read is refused naming which. */
  "GET /api/v1/worlds/:world/things": {
    params: { world: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** One thing's page: where it is kept, who may use it and what it holds. */
  "GET /api/v1/worlds/:world/things/:entity": {
    params: { world: string; entity: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The things and people whose names words name, or start with. */
  "GET /api/v1/worlds/:world/things/find": {
    params: { world: string };
    query: { words: string };
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The catalog's types of thing with the sizes they give. */
  "GET /api/v1/worlds/:world/things/types": {
    params: { world: string };
    query: Record<string, never>;
    body: undefined;
    reply: JsonValue;
    paged: false;
    long: false;
    joined: false;
  };
  /** The data tables this build ships newer than the world's copies, for its draft or one of its revisions. */
  "GET /api/v1/worlds/:world/updates": {
    params: { world: string };
    query: { revision?: string };
    body: undefined;
    reply: { updates: JsonValue };
    paged: false;
    long: false;
    joined: false;
  };
  /** The chats that play one of his worlds (one world's, or one chat), each with its name, the revision it plays and whether that is behind the world's head. */
  "GET /api/v1/worlds/chats": {
    params: Record<string, never>;
    query: { world?: string; chat?: string };
    body: undefined;
    reply: { chats: WorldChat[] };
    paged: false;
    long: false;
    joined: false;
  };
  /** A world file brought in as a new world; the macros in its lore and templates come back as warnings to review before playing it. */
  "POST /api/v1/worlds/import": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: { file: JsonValue };
    reply: WorldImported;
    paged: false;
    long: true;
    joined: false;
  };
  /** The starter worlds a new world can be made from. */
  "GET /api/v1/worlds/templates": {
    params: Record<string, never>;
    query: Record<string, never>;
    body: undefined;
    reply: { templates: { id: string; name: string; summary: string }[] };
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
  /** Takes over the provider key today's connections hold, by its hash alone, paired with their model names. */
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
  /** The models the provider endpoint offers to the request's key: those of the connections in Lumiverse that hold it. */
  "GET /v1/models": {
    params: Record<string, never>;
    answers: "an OpenAI model list";
    joined: false;
  };
}

/** Every kind the live socket carries, the app's and the areas' own, and what each carries. */
export interface LiveKinds {
  /** A record of RPH's trace, for a run played in the chat (on ~jobs, for a job of no chat): every event of the run, as RPH gave it. */
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
  /** A turn's folder gained or changed a file: the turn and the file's path; a page reads the folder again. */
  folder: { turn: string; path: string };
  /** One of his jobs changed: the job as RPH keeps it now. */
  job: { job: JobView };
  /** A turn ended before a word of its reply went out, and the empty reply Lumiverse kept for it stays in the chat, by its turn and message; `off` says the setting lumiverse.reply.removeEmpty is off (false: it is on, and taking the reply away failed). The page says what to do with it. */
  empty_reply: { turn: string; message: string; off: boolean };
  /** A world of his changed: the page reads what it shows of that world again. */
  world: WorldChanged;
  /** A job of his changed: the page shows its progress or its result. */
  build_job: BuildJobChanged;
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
