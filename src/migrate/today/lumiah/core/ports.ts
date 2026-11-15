// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/core/ports.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// Core's ports (DESIGN §4.2): the one object, the host, through which the core reaches the world, and
// the shapes that cross it. The runtime implements the host over the link; tests implement it in
// memory. A host serves one user, the one the runtime signed in as, so no port takes a user id.
//
// Also here, because the caller and the live session view read them: a turn as the runtime hands it
// to the core (`TurnRequest`), where the reply goes (`ReplySink`), the record a turn leaves for the
// caller to anchor on the reply's message (`TurnRecord`), the trace every agent's work goes to
// (`TraceEvent`, with the transcript entries, agent starts and usage it carries), and the words the
// workspace, the definitions and the jobs are told in wherever they are shown (`WorkspaceArea`,
// `ToolTier`, `DefinitionSource`, `JobView`).
//
// Nothing in this file is behaviour: types, and core's one guard for outside data (core imports
// nothing from outside `src/core`).

import type { RecallPorts } from "./recall/ports";
import type { LoreChange, PromptHeld } from "./recall/shapes";
import type { StorySetting } from "./story";

// ---------------------------------------------------------------- JSON

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A plain object (not null, not an array): its fields are still to be checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------- model calls

/**
 * A part of a model message: text, a tool call the model made, a tool's result going back, or media
 * the request carried (an image, audio or video, passed on as it came).
 */
export type ModelPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: JsonObject; thoughtSignature?: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: true }
  | { type: "media"; media: "image" | "audio" | "video"; data: string; mimeType: string };

/** A provider's thinking block (Anthropic's signed `thinking`, or `redacted_thinking`), sent back verbatim after a tool call. */
export interface ModelThinkingBlock {
  type: "thinking" | "redacted_thinking";
  thinking?: string;
  signature?: string;
  data?: string;
}

/**
 * A message of a model call. `content` is its text; a tool turn or a message with media goes as
 * `parts` instead, and then `content` renders them as text, for logs and estimates. An assistant turn
 * carries what its model gave of its reasoning, sent back as given on the next call: the reasoning
 * text (DeepSeek's `reasoning_content`, which a thinking model must be sent again after a tool call),
 * Anthropic's thinking blocks and OpenRouter's `reasoning_details`.
 */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
  parts?: ModelPart[];
  reasoning?: string;
  thinkingBlocks?: ModelThinkingBlock[];
  reasoningDetails?: JsonObject[];
}

function isModelPart(part: unknown): boolean {
  if (!isRecord(part)) return false;
  switch (part.type) {
    case "text":
      return typeof part.text === "string";
    case "tool_use":
      return typeof part.id === "string" && typeof part.name === "string" && isRecord(part.input);
    case "tool_result":
      return typeof part.toolUseId === "string" && typeof part.content === "string";
    case "media":
      return (part.media === "image" || part.media === "audio" || part.media === "video") && typeof part.data === "string" && typeof part.mimeType === "string";
    default:
      return false;
  }
}

function isModelMessage(message: unknown): boolean {
  if (!isRecord(message)) return false;
  const { role, content, parts, reasoning, thinkingBlocks, reasoningDetails } = message;
  if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string") return false;
  if (parts !== undefined && !(Array.isArray(parts) && parts.every(isModelPart))) return false;
  if (reasoning !== undefined && typeof reasoning !== "string") return false;
  if (thinkingBlocks !== undefined && !(Array.isArray(thinkingBlocks) && thinkingBlocks.every(isRecord))) return false;
  return reasoningDetails === undefined || (Array.isArray(reasoningDetails) && reasoningDetails.every(isRecord));
}

/**
 * Model messages that came from outside the core (an extension's answer, a stored session), read:
 * the value itself when it is a list whose every member is a message with fields of the right
 * kinds, else null. An agent's loop sends what it is given, so nothing unchecked may reach it.
 */
export function modelMessages(value: unknown): ModelMessage[] | null {
  return Array.isArray(value) && value.every(isModelMessage) ? (value as ModelMessage[]) : null;
}

/**
 * How hard a model reasons on a call: `inherit` and `auto` leave it to the connection's own effort
 * (where it sets none, the provider's default); `off` turns reasoning off; the rest ask for that
 * effort, which the host fits to what the model offers.
 */
export type ModelEffort = "inherit" | "off" | "auto" | "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

/** How long a provider keeps a call's prompt cache: not at all, a few minutes (its default), or about an hour where it offers that. */
export type CacheRetention = "none" | "short" | "long";

/** The cache retention a call has where nobody chose one: the provider's own default. */
export const DEFAULT_CACHE_RETENTION: CacheRetention = "short";

/** Sampling parameters by their usual names; each one left out is the connection's own. */
export interface SamplingParams {
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

/** A tool a call offers: its parameters as a JSON Schema. */
export interface ModelTool {
  name: string;
  description: string;
  parameters: JsonObject;
}

/** A tool call the model made, its arguments parsed; `thoughtSignature`, Google's, goes back with it. */
export interface ModelToolCall {
  callId: string;
  name: string;
  args: JsonObject;
  thoughtSignature?: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  /** What the call may write, its reasoning included. */
  maxTokens: number;
  /** The connection the call goes on; null: the default connection. */
  connectionId: string | null;
  /** Overrides the connection's model for this call; null: the connection's own. */
  model: string | null;
  /** Tools the model may call instead of answering; absent: none. */
  tools?: ModelTool[];
  /** The model may call one tool per answer at most (the connection takes no parallel tool calls). */
  parallelToolCalls?: false;
  /** Absent: `inherit`. */
  effort?: ModelEffort;
  /** Absent: every one is the connection's own. */
  params?: SamplingParams;
  /** Takes the answer as the provider streams it, each delta handed to the call's `onDelta`; the result is the same whole answer. */
  stream?: true;
  /** The agent session the call belongs to: the calls of one session share the provider's prompt cache, and the host lets go of what it keeps for it when the session ends (`ModelsPort.ended`). */
  session?: string;
  /** How long the provider keeps the call's prompt cache; absent: `DEFAULT_CACHE_RETENTION`. */
  cacheRetention?: CacheRetention;
}

/** A piece of a streaming call's answer as it arrives: its text, or its reasoning. */
export interface ModelDelta {
  content?: string;
  reasoning?: string;
}

export interface ModelResult {
  /** The answer's text; for a streamed call, every delta's text together. */
  content: string;
  /** How the call ended, as the provider said: `stop`, `tool_calls`, `length`, `max_tokens`, … */
  finishReason: string;
  /** The model that answered, when the host says. */
  model?: string;
  /** Present when the model called tools natively. */
  toolCalls?: ModelToolCall[];
  /** The model's reasoning text, when the provider gave it. */
  reasoning?: string;
  /** Reasoning carriers to send back on the next call after a tool call, when the host passes them. */
  thinkingBlocks?: ModelThinkingBlock[];
  reasoningDetails?: JsonObject[];
  /** The provider's usage: `prompt_tokens`, `completion_tokens`, `total_tokens`, and in `provider_raw` the provider's own counts (its cache reads and writes, its reasoning tokens). `cost` is what the provider billed, where it said; `list_cost`, what its published price makes of the counts, where the host knows one. */
  usage?: JsonObject;
}

export interface ModelsPort {
  /**
   * One model call. A call with `stream` hands each delta to `onDelta` as it arrives. The signal ends
   * the call: it rejects with the signal's reason. A failed call rejects with an `Error` whose message
   * is the provider's own words, status included where there was one ("503: …"). The loop reads two
   * things from them: a refusal of native tools, which it asks again with the tools as text; and a
   * failure that passes (a timeout, a rate limit, a 5xx, a stream that dropped), which it makes
   * again as Settings allow.
   */
  call(request: ModelRequest, signal: AbortSignal, onDelta?: (delta: ModelDelta) => void): Promise<ModelResult>;
  /** An agent session ended (`ModelRequest.session`): what the host keeps for its prompt cache is let go. */
  ended?(session: string): void;
}

// ---------------------------------------------------------------- connections

/** A connection as the user's list has it. */
export interface ConnectionInfo {
  id: string;
  name: string;
  provider: string;
  /** Its own model; null when it names none. */
  model: string | null;
}

/** A connection as the loop needs it: whether it takes several tool calls in one answer. */
export interface ConnectionProfile extends ConnectionInfo {
  parallelTools: boolean;
}

export interface ConnectionsPort {
  list(): Promise<ConnectionInfo[]>;
  /** One connection (null: the user's default); null when there is no such connection. */
  get(connectionId: string | null): Promise<ConnectionProfile | null>;
}

// ---------------------------------------------------------------- blobs and documents

/** A stored blob as a listing gives it: its hash, its size in bytes as stored, and when it was first stored. */
export interface BlobInfo {
  hash: string;
  bytes: number;
  at: number;
}

/**
 * Text stored once by its hash, never changed. The core computes every hash (`textHash`: SHA-256 of
 * the text's UTF-8, in lower-case hex) and checks what it reads against it, so the store only keeps
 * and returns text by key. A put of a hash already stored writes the same text again.
 */
export interface BlobsPort {
  put(hash: string, text: string): Promise<void>;
  /** The text under `hash`; null when none is stored. */
  get(hash: string): Promise<string | null>;
  /**
   * Every blob stored, a page at a time, in an order that holds still while it is read. `cursor`:
   * the `next` of the page before; absent for the first. Upkeep reads it (DESIGN §20): a host
   * without it, or without `remove`, has no sweep.
   */
  list?(cursor?: string): Promise<{ blobs: BlobInfo[]; next: string | null }>;
  /** Removes blobs; a hash that isn't stored is passed over. */
  remove?(hashes: readonly string[]): Promise<void>;
}

/** Small JSON documents by path (`a/b.json`), each read and written whole. */
export interface StorePort {
  /** The document at `path`; null when there is none. */
  read(path: string): Promise<JsonValue | null>;
  write(path: string, value: JsonValue): Promise<void>;
  remove(path: string): Promise<void>;
  /** The path of every document under `prefix` (`chats/abc/`), at any depth, in any order. Upkeep reads it. */
  list?(prefix: string): Promise<string[]>;
}

// ---------------------------------------------------------------- the chat

export type ChatRole = "user" | "assistant" | "system";

/**
 * A message of the chat's active path, without its text: its id, its place in the chat
 * (`index_in_chat`, from 0), whose it is, the swipe it shows, and that swipe's length and hash
 * (`textHash` of its text, so a changed text changes it), and LumiAH's anchor for that swipe: the
 * record stored under LumiAH's key in the message's extension metadata for the swipe shown, as
 * stored (the core checks it), or null when it has none.
 */
export interface PathMessage {
  id: string;
  index: number;
  role: ChatRole;
  name: string;
  swipeId: number;
  chars: number;
  hash: string;
  anchor: JsonValue | null;
  /** The user hid it from the prompt, so Lumiverse leaves it out of what it sends: what counts as the story leaves it out too, unless the user says such messages are read (§24.4). Absent: it is shown. */
  hidden?: boolean;
}

/** A message of the active path with the text of the swipe it shows. */
export interface ChatMessage {
  id: string;
  index: number;
  role: ChatRole;
  name: string;
  swipeId: number;
  content: string;
  /** As `PathMessage.hidden`. */
  hidden?: boolean;
}

/**
 * What the core reads of a chat besides its messages: its name, the character it is with (null for a
 * chat with none, or with several), and the chat it was branched from, if it was.
 *
 * What decides the chat's story beside the user's setting (§24.4): the user's own choice for this
 * chat (`story`, each member given stands over their setting; absent: none), and whether Lumiverse's
 * Sovereign Hand is on for the user in this chat (`sovereignHand`; null or absent where Lumiverse
 * doesn't tell extensions).
 */
export interface ChatInfo {
  id: string;
  name: string;
  characterId: string | null;
  characterName: string | null;
  branchedFrom: string | null;
  story?: Partial<StorySetting>;
  sovereignHand?: boolean | null;
}

/** A record LumiAH holds on one swipe of a message, wherever it is: the swipe shown or another, on the active path or off it. */
export interface StoredAnchor {
  chatId: string;
  messageId: string;
  swipeId: number;
  anchor: JsonValue;
}

export interface ChatPort {
  /** The chat's active path, oldest first. */
  path(chatId: string): Promise<PathMessage[]>;
  /** The active path's messages whose `index` is `from` or more and less than `to`, oldest first. */
  messages(chatId: string, from: number, to: number): Promise<ChatMessage[]>;
  /**
   * Writes LumiAH's record for one swipe of a message that is there, in place of the one it holds;
   * false when the message or the swipe is gone. A turn's own record doesn't come this way: `answer`
   * returns it, and its caller anchors it once Lumiverse has saved the reply. This is for a record
   * that changes afterwards (a rollback marks the record of the turn whose compaction it undoes; a
   * job that ends is listed on the record of the turn it belongs to).
   */
  anchor(chatId: string, messageId: string, swipeId: number, record: JsonValue): Promise<boolean>;
  /**
   * The chat itself; null when there is no such chat. Without it a plain chat has no character's
   * guidance (DESIGN §12), and a branch starts with an empty `learned/` (§11).
   */
  info?(chatId: string): Promise<ChatInfo | null>;
  /**
   * Every record LumiAH holds, on every swipe of every message of every chat of the user, a page at
   * a time. `cursor`: the `next` of the page before. Upkeep reads it, to know which blobs something
   * still refers to (§20): a host without it has no sweep.
   */
  anchors?(cursor?: string): Promise<{ anchors: StoredAnchor[]; next: string | null }>;
}

// ---------------------------------------------------------------- the workspace

/**
 * The workspace's three areas (DESIGN §11): the chat's (`/`), which follows the story path as the
 * session does; `learned/`, kept with the chat itself; and `~/`, the user's own, shared by all their
 * chats.
 */
export type WorkspaceArea = "chat" | "learned" | "user";

/**
 * Who wrote a version of a workspace file: the user on the page, an agent of a turn (its id in that
 * turn's transcript, and the definition it ran as), or a job (its id, and its agent's definition).
 */
export type FileAuthor = { who: "user" } | { who: "agent"; id: string; role: string } | { who: "job"; id: string; role: string };

/**
 * A workspace file a tool call changed: its area, its path within the area, and its version before
 * and after (the hash of its body; null: it wasn't there before, or is gone now). A move is two: the
 * old path gone, the new one there.
 */
export interface FileChange {
  area: WorkspaceArea;
  path: string;
  before: string | null;
  after: string | null;
}

// ---------------------------------------------------------------- definitions, and tools that run in the extension

/**
 * What a tool may touch (DESIGN §13), which is what approval is decided by (§17): `read` changes
 * nothing; `write` changes what LumiAH keeps (workspace files, jobs); `external` acts outside LumiAH
 * (an extension's own tools, the tools of MCP servers).
 */
export type ToolTier = "read" | "write" | "external";

/** Where a definition comes from (§13): shipped with LumiAH, supplied by the extension that builds LumiAH into itself, or the user's own. */
export type DefinitionSource = "builtin" | "extension" | "user";

/**
 * A tool that runs in the extension (§13): one of the extension's own, or a tool of an MCP server the
 * user switched on for agents (`mcp:<server>:<tool>`, §16). `family` groups it with its kin, so an
 * agent definition can be given the whole family (`@<family>`).
 */
export interface RemoteTool {
  name: string;
  family: string;
  tier: ToolTier;
  description: string;
  /** Its arguments' JSON Schema. */
  parameters: JsonObject;
  /** How much of its answer, in characters, reaches the model whole, for a tool that bounds its own answer by a setting (`AgentTool.wholeChars`); absent: Tool results clipped past, as for any tool. */
  wholeChars?: number;
  source: "extension" | "user";
}

/** An agent of a run, as another is told of it: its id in the run, the definition it runs as, and which instance of that definition it is, where whoever started it said (`as`, §14). */
export interface AgentRef {
  agentId: string;
  role: string;
  as?: string;
}

/**
 * A call of a tool that runs in the extension: the tool and its arguments; which call of which
 * agent of which run it is; and where that agent stands in the run, so an extension can tell the
 * run's main agent from an agent it handed a task, whatever definitions the two run as.
 */
export interface RemoteToolCall {
  name: string;
  args: JsonObject;
  turn: string;
  chatId: string;
  agentId: string;
  role: string;
  callId: string;
  /** The run the call is part of: a turn that answers a generation (by its kind), a job's run, or a side session's turn. */
  kind: RunKind;
  /** The caller is the run's main agent: the one the run started with (a turn's main agent, a job's agent, a side session's). Never an agent another started, though it run as the same definition. */
  main: boolean;
  /** The agents over the caller, from the run's main agent down to the one that started it; none for the main agent. */
  above: AgentRef[];
  /** Which instance of its definition the caller is, where whoever started it said (`delegate`'s and `job_start`'s `as`): an extension that runs one definition for many people tells them apart by it. */
  as?: string;
}

export interface ToolsPort {
  /** The tools that run in the extension, as they stand now: read at the start of every turn (`chatId` `""` for a side session about no chat). */
  list(chatId: string): Promise<RemoteTool[]>;
  /**
   * Runs one (`tool.call` on the link). Its answer is text for the model; `error` says it failed, in
   * words that tell the model what to do next. A rejection is taken as a failure too, with the
   * error's message. The signal ends the call.
   */
  call(call: RemoteToolCall, signal: AbortSignal): Promise<{ text: string; error?: boolean }>;
}

// ---------------------------------------------------------------- approval

/**
 * A tool call held for the user's word (DESIGN §17): which call of which agent of which turn, the
 * tool with its tier and arguments, and when the wait runs out (null: Settings give it no bound).
 */
export interface ApprovalAsk {
  turn: string;
  chatId: string;
  agentId: string;
  role: string;
  callId: string;
  tool: string;
  tier: ToolTier;
  args: JsonObject;
  at: number;
  until: number | null;
}

/** The user's word on a held call: this once, for this tool in this chat from now on, or no (with a reason the agent is given). */
export type ApprovalAnswer = { decision: "once" } | { decision: "chat" } | { decision: "refused"; reason?: string };

export interface ApprovalsPort {
  /**
   * Asks, and resolves with the user's answer. The signal ends the wait (its bound ran out, or the
   * turn stopped): the host then takes the ask down, and the promise rejects with the signal's
   * reason. The asking agent's transcript holds the ask and how it ended, so the live view needs
   * nothing else to show the card.
   */
  ask(ask: ApprovalAsk, signal: AbortSignal): Promise<ApprovalAnswer>;
}

// ---------------------------------------------------------------- jobs

/** When a job runs (DESIGN §15): beside the turn that started it, or once that turn's reply is written. */
export type JobWhen = "now" | "after_reply";

/** Which jobs go first among those waiting for a place (§15): every `soon` before any `later`, first come first through within each. A job that names none is `later`. */
export type JobLane = "soon" | "later";

/** A job the next turn waits for (§15): at that turn's start it is waited for up to Wait for jobs due, and the main agent is told if it still runs. */
export type JobDue = "next_turn";

/**
 * Where a job stands: waiting for the host to run it, running, ended with its report (`done`), ended
 * without one (`failed`, `cancelled`), cut off by a runtime restart (`interrupted`), stopped because
 * the turn it belongs to is no longer on the chat's active path (`off_path`), stopped because its
 * allowance ran out (`spent`: granted more, it carries on from its own session), or held by the
 * user with no run under way (`paused`: a runtime restart came while it was paused; resumed, it
 * carries on from its own session).
 */
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted" | "off_path" | "spent" | "paused";

/**
 * What one job may spend (DESIGN §22), over Settings' limits for each job: each member given stands
 * in place of the setting's (null: no limit). Everything the job's agents spend counts against it,
 * across every run of the job and with the jobs it starts.
 */
export interface JobAllowance {
  tokensIn?: number | null;
  tokensOut?: number | null;
  toolTurns?: number | null;
  wallMs?: number | null;
}

/** A job as a list shows it. */
export interface JobView {
  id: string;
  chatId: string;
  /** The agent definition it runs as. */
  agent: string;
  /** How its task opens: the whole task is the job's own (`jobs.read`). */
  task: string;
  when: JobWhen;
  state: JobState;
  /** Held by the user: its agents wait at their next round until it is resumed. Kept across a restart. */
  paused?: true;
  /** Who started it: an agent's `job_start` call, or the user on the page. */
  by: { who: "agent"; id: string; role: string } | { who: "user" };
  /** Which instance of its definition its agent is, where the call that started it said (`job_start`'s `as`). */
  as?: string;
  /** Its lane among waiting jobs; absent: `later`. */
  lane?: JobLane;
  /** The next turn waits for it; absent: no turn does. */
  due?: JobDue;
  /**
   * The turn it belongs to, by its generation's id: the turn whose agent started it (for a job that
   * another job started, that job's). Null for a job the user started: it belongs to the chat, not
   * to a turn, so it writes `learned/` and `~/` and never the chat's own area (§22), unless it was
   * started to (`area`).
   */
  basis: string | null;
  /** A job the user started that may write the chat's own area too, as it stands at the latest reply on the chat's path, as the page writes it (an extension's prepared start). */
  area?: "chat";
  /** The plan file a job the user started is asked to keep, where it isn't `learned/plans/<id>.md`. */
  plan?: string;
  /** The job it was started again from. */
  again?: string;
  /** The job whose agent started it: what it spends counts against that job's allowance too. */
  parent?: string;
  /** What it may spend, where that isn't Settings' limits for each job. */
  allowance?: JobAllowance;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  /** What it has spent, over every run of it and with the jobs it started. */
  usage: AgentUsage;
  /** How long it has worked, in milliseconds, over every run of it, less the time it was held. */
  workedMs?: number;
  /** Its report's blob, the report's length in characters, and how it opens. */
  report?: string;
  reportChars?: number;
  opening?: string;
  /** Why it failed, was cancelled or interrupted, left the path or stopped at a limit, in plain words. */
  reason?: string;
  /**
   * For a job that failed: what it failed on lies outside it, in what it runs on (no connection to
   * run on, a key or a model its provider refused, an account out of quota or credit, an agent that
   * is gone), so running it again fails the same way until the user changes that.
   */
  lasting?: true;
  /**
   * For a job in state `spent`: the limit that stopped it. `allowance`: its own (Settings' limits
   * for each job, or the allowance it was given); granted more, it carries on. `day`: a limit on a
   * day's spend (Job tokens per day, Tokens per day, Cost per day); it carries on, with a grant of
   * nothing more, once the last 24 hours count less or the user has raised that limit.
   */
  stoppedAt?: "allowance" | "day";
  /** Its latest run's transcript, once that ended; absent while Settings keep none. */
  transcript?: string;
}

export interface JobsPort {
  /**
   * A job waits to run: it was started, or the user resumed one a restart had left paused, or
   * granted one more after its allowance ran out. The host runs it with the harness's `jobs.run`
   * when it will: at once for `now`, once the turn that started it has ended for `after_reply`.
   * Nothing else runs a job, and nothing starts one but an agent's `job_start` call and the user
   * (§15).
   */
  queued(job: JobView): void;
  /** A job changed: it began, was paused or resumed, or ended. For the page's list, and to tell the user when one finishes or needs them. */
  changed?(job: JobView): void;
}

// ---------------------------------------------------------------- lore and the preset

/** A world book that applies to the chat (the chat's, its character's, its persona's, or a global one). */
export interface LoreBook {
  id: string;
  name: string;
  description: string;
}

/** An entry of a world book, as stored. `title` is its comment; `enabled` false: switched off. */
export interface LoreEntry {
  id: string;
  bookId: string;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
}

/** An entry Lumiverse activated for this generation, with the text it put in the prompt. */
export interface ActivatedLore {
  entryId: string;
  bookId: string;
  title: string;
  content: string;
}

export interface LorePort {
  /** The world books that apply to the chat. */
  books(chatId: string): Promise<LoreBook[]>;
  /** A book's entries, in the book's order. */
  entries(bookId: string): Promise<LoreEntry[]>;
  /** The entries Lumiverse activated for the generation. */
  activated(chatId: string, generationId: string): Promise<ActivatedLore[]>;
}

/**
 * A block of the active preset: an instruction (text the preset author wrote, which the reply must
 * achieve) or a marker (where Lumiverse puts something of its own: the chat history, World Info, the
 * character's description; `marker` names which). `content` is the block's text as stored, its
 * macros unfilled; `enabled` false: switched off, so it isn't in the prompt.
 */
export interface PresetBlock {
  id: string;
  name: string;
  role: ChatRole;
  kind: "instruction" | "marker";
  marker: string | null;
  content: string;
  enabled: boolean;
}

export interface PresetPort {
  /** The preset's blocks, in order; none for a preset that isn't there. */
  blocks(presetId: string): Promise<PresetBlock[]>;
}

// ---------------------------------------------------------------- a story's book

/**
 * An entry of a chat's LumiBooks book (DESIGN §23) as LumiBooks keeps it in a world book: the
 * entry's id, its comment, its content, and of its extension data the members the core reads (a
 * host need send no others).
 */
export interface BookEntry {
  id: string;
  /**
   * LumiBooks' label: what the entry is, its number, its title and often the messages it was made
   * from, counted from 1 ("#4 - The Long Road (msgs 31-40)", "Arc #2 - …", "Vol #1 - …"); "[Root] …"
   * on an entry carried over from another chat.
   */
  comment: string;
  /** The summary, under a heading line LumiBooks writes. */
  content: string;
  extensions: {
    /** What LumiBooks keeps on an entry of the book it writes a chat's summaries into. */
    lumibooks?: {
      /** The chat it was written for. LumiBooks passes over an entry written for another chat, and so does the core. */
      chatId?: string;
      /** 1: a chapter, of messages. 2: an arc, of chapters. 3: a volume, of arcs. Up to 7, each of the tier below. */
      tier?: number;
      /** The ids of the chat messages it summarizes. */
      msgIds?: string[];
      /**
       * The first and last of them by `index_in_chat`, as they stood when it was written. On an
       * entry carried over from another chat both hold one number below 0: its place among those.
       */
      firstMsgIdx?: number;
      lastMsgIdx?: number;
      /** Its title alone. */
      title?: string;
      /** It was carried over from another chat (one this chat goes on from, or a lorebook the user imported): it summarizes none of this chat's messages. */
      isRoot?: boolean;
    };
    /** What LumiBooks writes on an entry of a summaries lorebook it exports, which a user may keep as a world book. */
    lumibooks_summary?: {
      tier?: number;
      /** The messages it summarizes, by their places in the chat, from 0. */
      messageIndices?: number[];
    };
  };
}

/**
 * A message LumiBooks kept a hash of when it summarized it, beside the message that stands at the
 * same place now, hashed the same way, so the core only compares the two. LumiBooks' hash (its
 * `sha256-role-content-v1`) is the SHA-256, in lower-case hex, of `JSON.stringify([role, content])`:
 * the message's role and its text, as Lumiverse gives them. It is not `PathMessage.hash`, which is
 * of the text alone.
 */
export interface BookMessageHash {
  /** The message's place in the chat (`PathMessage.index`). */
  index: number;
  /** LumiBooks' hash of it when it was summarized. */
  kept: string;
  /** The same hash of the message at that place now; null when the chat has no message there. */
  now: string | null;
}

/**
 * A chat's LumiBooks book: the entries of the world book LumiBooks made for the chat, in the book's
 * order. LumiBooks marks that book with the chat (`lumibooks_chat_id` in the book's metadata) and
 * the chat names it (`lumibooks_book_id`); its codex, marked `lumibooks_codex_chat_id`, is lore and
 * never the book. `hashes` holds what a summaries lorebook of this chat's messages keeps
 * (`lumibooks_summary.messages`), and is empty where the user keeps none: LumiBooks' own book names
 * the messages it summarized by id and keeps no hash of them. Where the chat has such a lorebook
 * and no book of LumiBooks' own, the lorebook's entries are the book.
 */
export interface ChatBook {
  entries: BookEntry[];
  hashes: BookMessageHash[];
}

export interface BookPort {
  /** The chat's book; null when it has none. */
  read(chatId: string): Promise<ChatBook | null>;
}

// ---------------------------------------------------------------- the turn

/** What kind of generation a turn answers. */
export type TurnKind = "new" | "regenerate" | "swipe" | "continue";

/** What a trace is the work of: a turn that answers a generation, a job's run (§15), or a turn of a side session (§19). */
export type RunKind = TurnKind | "job" | "side";

/**
 * Where a message of the assembled prompt came from, where the extension could tell: a message of
 * the chat's history (its id and `index_in_chat`), a block of the preset (its id), or a World Info
 * entry Lumiverse put there as a message of its own (§24.1: `entryId` where the host knows which
 * entry it is; the core works it out from the entry's text where it doesn't. World Info that a
 * preset's macro puts inside a block has no message of its own, and is the block's).
 */
export type RequestSource = { kind: "history"; messageId: string; index: number } | { kind: "block"; blockId: string } | { kind: "lore"; entryId?: string };

export interface RequestMessage extends ModelMessage {
  source?: RequestSource;
}

/**
 * A turn, as the runtime hands it to the core: whose it is, the chat, the generation's id and kind,
 * the message and swipe it writes (for a new reply, the empty message Lumiverse made for it, or null
 * where Lumiverse makes the reply's message only as it saves it, so the reply comes after every
 * message of the path; for a regenerate or a swipe, the new swipe; for a continue, the swipe it
 * continues), the preset the prompt was assembled from, the assembled messages as Lumiverse sent
 * them, and the request's own sampling parameters and answer room. It names no connection: an
 * agent runs on its own connection, else on the default one.
 */
export interface TurnRequest {
  userId: string;
  chatId: string;
  generationId: string;
  kind: TurnKind;
  target: { messageId: string | null; swipeId: number };
  presetId: string | null;
  messages: RequestMessage[];
  params: SamplingParams;
  /** The answer room the request asks for; null when it names none. */
  maxTokens: number | null;
}

/**
 * Where a turn's reply goes. `progress` lines and `reasoning` go to the reply's thinking block,
 * `content` is the reply's text. A turn ends with exactly one `done` (with the finish reason and the
 * turn's usage) or one `error`; nothing follows it.
 */
export interface ReplySink {
  progress(text: string): void;
  reasoning(text: string): void;
  content(text: string): void;
  done(finish: string, usage: AgentUsage): void;
  error(message: string, code?: string): void;
}

/** A job a turn's agents started, as the turn's record lists it: the job, the definition it runs as, where it stands, and its report's blob once it has one. */
export interface RecordJob {
  id: string;
  agent: string;
  state: JobState;
  report?: string;
}

/**
 * The record a turn leaves (DESIGN §5), which the caller anchors on the turn's target swipe once
 * Lumiverse has saved it: the turn (its generation's id and kind, when it began and when it ended),
 * the path hash chained over the messages before the reply, what the turn spent, and the hashes of
 * its bodies, each a blob (`BlobsPort`): the turn's session segment, its transcript (absent while
 * Settings keep none), the compaction summary it made, if it made one, and the chat area's index as
 * it stood when the turn ended (§11; absent while the area has never held a file).
 *
 * With a summary: `kept` names the segments of the turns before this one that stay whole after it,
 * oldest first, and `folded` says how many turns it took in. The turns a summary replaced stay on
 * their own records, which nothing removes, so a rollback writes only `rolledBack` (when it was
 * made): the session then reads past this summary as if it had never been made. A regenerate, a
 * swipe or a continue of that reply carries the summary on its own record with the same mark (it
 * made none itself), so the rollback holds whichever swipe the chat shows afterwards.
 *
 * `jobs` lists the jobs its agents started (§15). A job that ends later is written into it then
 * (`ChatPort.anchor`), so its report is listed with the record it belongs to. `changed` counts the
 * files of the chat's area its change set names (what its agents wrote, and its jobs after them):
 * a list of turns says how much a turn changed without reading two indexes for each. `heard` is
 * when the turn looked which of the chat's jobs had stopped: the turn after it tells its main agent
 * of those that stopped since, so none is told twice.
 */
export interface TurnRecord {
  v: 1;
  generationId: string;
  kind: TurnKind;
  began?: number;
  heard?: number;
  at: number;
  path: string;
  segment: string;
  transcript?: string;
  summary?: string;
  kept?: string[];
  folded?: number;
  rolledBack?: number;
  workspace?: string;
  changed?: number;
  jobs?: RecordJob[];
  usage: AgentUsage;
}

/** How a turn ended: its reply written, failed, or stopped by its signal. */
export type TurnStatus = "done" | "failed" | "stopped";

/**
 * What `answer` gives back: how the turn ended (and why, where it didn't finish), its record to
 * anchor (null when no reply was written, so there is no message to anchor it on, or its bodies
 * couldn't be stored), the reply's text as sent, and the turn's usage.
 */
export interface TurnResult {
  status: TurnStatus;
  reason?: string;
  record: TurnRecord | null;
  reply: string;
  usage: AgentUsage;
}

// ---------------------------------------------------------------- usage

/** A count a call's provider didn't report, which holds the runtime's estimate instead. */
export type UsageField = "in" | "cachedIn" | "out" | "reasoningOut" | "cost";

/** One call's tokens: `in` (of which `cachedIn` read from the cache, `cacheWrite` written to it) and `out` (of which `reasoningOut` reasoning), and its cost in US dollars where the provider said or a price setting gives it. */
export interface CallUsage {
  in: number;
  cachedIn: number;
  cacheWrite?: number;
  out: number;
  reasoningOut: number;
  /** The counts the provider didn't report, which hold the runtime's estimate. */
  estimated: UsageField[];
  cost?: number;
  /** The name in the user's Prices whose price gave `cost`: the call's model as its provider reported it or as the call asked for it, or the longest priced name one of those starts with. Absent where the provider reported the cost itself, and where no price matched. */
  pricedAs?: string;
}

/** An agent's usage so far, a turn's, or one send's: its calls and rounds of tool calls, its tokens, how long its calls took, and its cost where every call's was known. */
export interface AgentUsage {
  calls: number;
  toolTurns: number;
  in: number;
  cachedIn: number;
  cacheWrite?: number;
  out: number;
  reasoningOut: number;
  /** Some of the counts are the runtime's estimate. */
  estimated: boolean;
  ms: number;
  cost?: number;
}

// ---------------------------------------------------------------- the trace

/** How a send ended: an answer, a limit refusing, the loop detector, a cancel, or a failed call. */
export type AgentStatus = "answered" | "refused" | "stopped" | "cancelled" | "failed";

/**
 * Why an agent stopped short of an answer: a budget of its own, its turn's (or its job's), a
 * throttle, a connection that can't be used, the loop detector, a cancel, a failed call, a spend cap
 * (DESIGN §20), or, for a job, that the turn it belongs to left the chat's active path (§15).
 */
export type AgentStopCode =
  | "revisions"
  | "busy"
  | "call_tokens_in"
  | "tokens_in"
  | "tokens_out"
  | "tool_turns"
  | "turn_tokens_in"
  | "turn_tokens_out"
  | "turn_tool_turns"
  | "call_time"
  | "wall_time"
  | "turn_time"
  | "throttle"
  | "connection"
  | "loop"
  | "spend"
  | "off_path"
  | "cancelled"
  | "failed";

/** The tools a call was offered (natively or as text, `scratch_read` among them): how many, and their definitions' tokens as estimated. */
export interface OfferedTools {
  tools: number;
  tokens: number;
}

/** A tool call a model made: its id (the provider's, or one the runtime gave a call written as text), its tool and its arguments. */
export interface ToolCallView {
  id: string;
  name: string;
  args: JsonObject;
}

/**
 * One step of an agent's work: a message it was sent, a model's answer (its reasoning where the model
 * gave it, its tool calls), a call its connection refused for its native tools (asked again with them
 * as text), a call that failed in passing and is made again (`retry`: which try this is of how many
 * Settings allow, the failure's own words, and how long it waits first), a tool's result (`files`:
 * the workspace files the call changed), or its stop. `prompt` names the blob of that call's exact
 * request (`readCallPrompt`): on an answer, on a refusal, on a retry, and on a stop that ended a call
 * under way (one that failed, timed out or was cancelled); absent while Settings keep no prompts.
 *
 * And what the user does while it works: `note` is something the user said to it, as it received it
 * at the start of a round (DESIGN §18); `approval_asked` is a tool call of its held for the user's
 * word (§17: `until` is when the wait runs out, null for no bound), and `approval` is how that ended
 * (this once, for this tool in this chat from now on, refused with the user's reason, or the wait
 * ran out). A held call whose turn is stopped ends with its agent's stop and no `approval`.
 *
 * `notice` is something the runtime told it beside a round's results: how few rounds of tool calls
 * it has left.
 */
export type TranscriptEntry =
  | { kind: "message"; text: string; at: number }
  | { kind: "note"; text: string; at: number }
  | { kind: "notice"; text: string; at: number }
  | { kind: "answer"; text: string; reasoning?: string; calls: ToolCallView[]; written: boolean; tools: "native" | "text" | "none"; offered?: OfferedTools; usage: CallUsage; model: string; finishReason: string; ms: number; at: number; prompt?: string }
  | { kind: "tools_refused"; reason: string; ms: number; at: number; prompt?: string }
  | { kind: "retry"; reason: string; attempt: number; of: number; waitMs: number; ms: number; at: number; prompt?: string }
  | { kind: "approval_asked"; callId: string; tool: string; tier: ToolTier; args: JsonObject; until: number | null; at: number }
  | { kind: "approval"; callId: string; decision: "once" | "chat" | "refused" | "timed_out"; reason?: string; ms: number; at: number }
  // `lore`: what a `write_reply` call did to the lore the writer sees (§24.3).
  | { kind: "result"; callId: string; name: string; text: string; error: boolean; scratch?: string; files?: FileChange[]; lore?: LoreChange; ms: number; at: number }
  | { kind: "stop"; status: AgentStatus; code: AgentStopCode; reason: string; at: number; prompt?: string };

/**
 * An agent starting work: its id (the handle a delegating agent continues it by, §14) and its role
 * (the id of the definition it runs as), the connection its calls go on, its model and effort, what
 * it is told first (`prefix`: the guidance files that apply, §12), how many messages of a
 * conversation it takes up, and who started it.
 */
export interface AgentStarted {
  id: string;
  role: string;
  /**
   * The connection its calls go on: the one its settings name, else the default (where they name
   * none, or one that is none of the host's connections). Where no connection could be read, the
   * one its settings name (null: the default), and its stop says why. In a trace kept before the
   * connection was read for the start, always the one its settings name.
   */
  connectionId: string | null;
  /** That connection's name as the host had it then; absent where none could be read, and in a trace kept before names were. */
  connectionName?: string;
  /** The connection its settings name where that is none of the host's connections (taken away, or one of Lumiverse's own from before the runtime kept its connections), so the default stood in for it. */
  gone?: string;
  model: string | null;
  effort: ModelEffort;
  system: string;
  prefix: string[];
  history: number;
  /** The agent that started it: the one that delegated to it, or briefed it; none for the agent a turn, a job or a side session starts with. */
  parent?: string;
  /** What it was started for, in a few words. */
  task?: string;
  /** Which instance of its definition it is, where whoever started it said (`as`, §14). */
  as?: string;
  at: number;
}

/**
 * What the main agent carries into a turn (DESIGN §5): the session segments it read, their tokens as
 * estimated, whether a summary stands for the turns before them, the replies whose notes were dropped
 * because an earlier message changed (by their chat index), the blobs it names that the store couldn't
 * give, the compaction the turn made of it, a compaction a rollback undid that it is the first turn
 * to read past (the summary's hash: said once, as the main agent is told it once), and the jobs it
 * was told have ended since its last turn (§15).
 */
export interface SessionTrace {
  turns: number;
  tokens: number;
  summary: boolean;
  dropped: number[];
  missing: number;
  compacted?: { folded: number; kept: number; summary: string };
  rolledBack?: { summary: string };
  jobs?: JobView[];
}

/**
 * Everything a run's agents do, as the live session view renders it. A run is a turn that answers a
 * generation, a job's run (`job`: the job's id, which is also the trace's `turn`), or a turn of a
 * side session (`side`: the side session's id). `turn_paused` and `turn_resumed` are the user holding
 * every agent of the run at its next round and letting them go on (§18). `job` is a job started from
 * this run, as it stood when it was queued. A `usage` event names the connection and the model the
 * call ran on (absent only in a transcript stored before they were kept). `notice` is something the
 * user should know about the run that is no agent's step: its notes couldn't be stored.
 */
export type TraceEvent =
  | { kind: "turn_started"; turn: string; chatId: string; generation: RunKind; messageId: string | null; job?: string; side?: string; at: number }
  | { kind: "session"; session: SessionTrace; at: number }
  // What the prompt of the generation held of the lore and of the chat, as the main agent was told (§24.1).
  | ({ kind: "prompt_held"; at: number } & PromptHeld)
  | { kind: "agent_started"; agent: AgentStarted }
  | { kind: "agent_entry"; agentId: string; entry: TranscriptEntry }
  | { kind: "usage"; agentId: string; call: CallUsage; agent: AgentUsage; turn: AgentUsage; connection?: string; model?: string; at: number }
  | { kind: "agent_idle"; agentId: string; spent: AgentUsage; at: number }
  | { kind: "turn_paused"; at: number }
  | { kind: "turn_resumed"; at: number }
  | { kind: "job"; job: JobView; at: number }
  // `info`: the notice says what happened and nothing went wrong (how a turn's reply is being written); without it a notice is a warning.
  | { kind: "notice"; text: string; info?: true; at: number }
  | { kind: "turn_ended"; status: TurnStatus; reason?: string; usage: AgentUsage; at: number };

/**
 * A trace event with its run (`turn`) and chat, numbered from 1 within its run with no gap. `chatId`
 * is `""` for a side session about no chat.
 */
export interface TraceRecord {
  turn: string;
  chatId: string;
  seq: number;
  event: TraceEvent;
}

/** A piece of a streaming call's answer for the live view only: what arrived since the last one. Never stored, never numbered; the call's `answer` entry replaces it. */
export interface TraceDelta { turn: string; chatId: string; agentId: string; call: number; text?: string; reasoning?: string; at: number }

export interface TracePort {
  /** One event: delivered in order, never answered. */
  event(record: TraceRecord): void;
  /**
   * A piece of a streaming call's answer, in order, every piece before its call's closing entry.
   * `call` is the agent's model call counted from 1, the same count its `answer` entries follow: a
   * call that failed and is made again keeps its number. Optional, so a host without it still fits.
   */
  delta?(delta: TraceDelta): void;
}

// ---------------------------------------------------------------- time and diagnostics

export interface ClockPort {
  now(): number;
  /** Waits `ms`; rejects with the signal's reason when it ends first. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPort {
  (level: LogLevel, message: string): void;
}

// ---------------------------------------------------------------- the host

/**
 * The host. The ports a later slice added are optional members, and so are the later methods of the
 * first ones, so a host written before them still fits: without `tools` no tool runs in the
 * extension (DESIGN §13), without `approvals` a call that Settings hold for the user's word is
 * refused (§17), and without `jobs` no job can be started (§15).
 */
export interface HarnessHost {
  models: ModelsPort;
  connections: ConnectionsPort;
  blobs: BlobsPort;
  store: StorePort;
  chat: ChatPort;
  lore: LorePort;
  preset: PresetPort;
  trace: TracePort;
  clock: ClockPort;
  log: LogPort;
  tools?: ToolsPort;
  approvals?: ApprovalsPort;
  jobs?: JobsPort;
  /** Without it no chat has a book to read (§23). */
  book?: BookPort;
  /** What the lore and history tools read beyond `lore` and `chat` (§24): without it they work from those two alone, and the tools that rest on Lumiverse's memory, the databanks or web search are not offered. */
  recall?: RecallPorts;
}
