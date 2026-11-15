// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/link/contract.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// The link (DESIGN §6): what the runtime (src/runtime) and the extension backend
// (src/extension/backend) say to each other. The runtime is a client of Lumiverse like any other: it
// signs in as the user, finds the extension, opens the event socket as a widget session and sends
// the requests below as SPINDLE_BACKEND_MSG frames. Each is answered by its `id` with exactly one
// `result` or `error` frame, sent to the runtime's own session (`sendToFrontend(…, { frontendSessionId })`).
// The extension pushes to that session too: a stream's chunks, a turn to stop, settings that changed,
// a relay secret rotated, a loopback connection to make.
//
// Rules both ends keep:
// - Every frame carries `link: LINK`, so neither end mistakes it for the frontend's messages
//   (src/shared/ui.ts), which travel the same channel.
// - Every request but `register` carries the relay's secret. The extension refuses one without a
//   valid secret (`forbidden`), and takes the frame's session as where that runtime's pushes go
//   from then on, so a runtime that reconnected is found on its new session. A `register` may show
//   the secret its runtime already holds: it then keeps the registration and binds no session.
// - `hello` says the link version both ways; a mismatch is refused in words that name which side
//   to update (`versionWords`).
// - A stream (a tool's run in the extension, a tool call held for the user's word) is named by the
//   runtime before it asks, so no chunk can arrive for a stream it doesn't know. It carries one
//   chunk, its outcome (`value` or `error`), numbered 1; the extension keeps it until the runtime
//   acknowledges it, and sends it again to a runtime that reconnected (stream.ts).
// - A runtime carries only its own account's turns: a loopback key or a turn's tag of another user
//   is refused.
// - A frame too large for Lumiverse's socket crosses in parts (parts.ts), either way.
// - The reads and writes of the core's ports (`blob.*`, `doc.*`, `chat.*`, `lore.*`, `preset.*`,
//   `trace.push`, `recall.*`, `book.read`) carry the ports' own shapes (src/core/ports.ts,
//   src/core/recall/ports.ts), so the two can't drift apart. The core's model calls and connections
//   are the runtime's own (runtime/models): none of them crosses the link.
// - A notice is what the runtime tells the extension without waiting for an answer: a model's
//   answer as it arrives, for the live view. It has no id and no secret. The extension takes one
//   only from a session a hello bound to a runtime, in the order they were sent; one that is lost
//   is not sent again.

import type { ActivatedLore, ApprovalAsk, BlobInfo, ChatBook, ChatInfo, ChatMessage, JobView, LoreBook, LoreEntry, PathMessage, PresetBlock, RemoteTool, RemoteToolCall, RequestSource, StoredAnchor, TraceDelta, TraceRecord, TurnKind, TurnRecord } from "../core/ports";
import type { ActivatedEntry, Databank, DatabankDocument, EmbedderInfo, LoreBookRead, MemoryArc, MemoryEntity, MemoryEntityBrief, MemoryHit, TimedMessage, WebResult } from "../core/recall/ports";
import type { JsonObject, JsonValue } from "./json";
import type { ActivatedInfo } from "../host/rows";

export type { TurnKind } from "../core/ports";

/** The level of this contract: `hello` says it both ways, and each end refuses another. 2: the model calls, the passthrough and the connections left the link for the runtime's own model layer. */
export const LINK_VERSION = 2;

/** The key every frame of the link carries, with this value. */
export const LINK = "lumiah-link";

/** LumiAH's identifier in Lumiverse (`spindle.json`): how the runtime finds the extension, and the key of the records it writes in a message's extension metadata. */
export const EXTENSION_IDENTIFIER = "lumi_ah";

/** The model LumiAH's own runtime lists at `GET /v1/models`, and its loopback connection names. */
export const MODEL_ID = "lumiah";

/**
 * The model the loopback connection of an extension names, and its runtime lists: LumiAH's own, or
 * one that says which extension LumiAH is built into (DESIGN §21). Both ends derive it from the
 * extension's identifier, so a user with LumiAH and such an extension has two loopback connections
 * that neither backend and neither runtime takes for the other's.
 */
export function loopbackModel(identifier: string): string {
  return identifier === EXTENSION_IDENTIFIER ? MODEL_ID : `${MODEL_ID}-${identifier}`;
}

/** Whether two base addresses are one, as a person would write either: without regard to a trailing slash or to case. */
export function sameBase(a: string, b: string): boolean {
  const at = (url: string): string => url.trim().replace(/\/+$/, "").toLowerCase();
  return at(a) === at(b);
}

/**
 * Whether a Custom connection's calls come back to the runtime at one of `bases`, for the extension
 * whose loopback model is `model`: it names that model, or it sits at one of those addresses and
 * names no other extension's. One that names another extension's loopback model is that extension's
 * even at a matching address (a port its runtime took over from one set up here before). The
 * backend (which chats it answers) and the runtime (where it puts the key) ask the same.
 */
export function loopsBack(connection: { model: string; url: string }, model: string, bases: readonly string[]): boolean {
  if (connection.model === model) return true;
  // Every extension's loopback model is LumiAH's own or starts with it (`loopbackModel`).
  if (connection.model === MODEL_ID || connection.model.startsWith(`${MODEL_ID}-`)) return false;
  return bases.some((base) => sameBase(base, connection.url));
}

/** The body parameter the prompt interceptor sets on a generation it tags; the runtime takes it out before the body goes on. */
export const TAG_PARAM = "lumiah_turn";

/** What a loopback key starts with, so one pasted in the wrong place is recognised. */
export const KEY_PREFIX = "lah_";

/**
 * A loopback key as the extension mints one: the prefix, then 256 random bits as hex. The runtime
 * refuses a request whose key isn't of this form before it reads the request's body; whether a key
 * of this form is the user's own stays the extension's to say.
 */
export const KEY_FORM = new RegExp(`^${KEY_PREFIX}[0-9a-f]{64}$`);

/** A runtime's name: one per (user, name); `up` defaults it to the Lumiverse username. */
export const RUNTIME_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A stream's id and a request's own: 128 random bits as hex, named by the runtime. */
export const STREAM_ID = /^[0-9a-f]{32}$/;

/** A blob's key: the core's hash of its text (SHA-256, lower-case hex). */
export const BLOB_HASH = /^[0-9a-f]{64}$/;

/** A document's path in the extension's storage: names of letters, digits, `.`, `_` and `-`, joined by `/`, none of them `.` or `..`. A format, not a limit: a path is a name the code gives, and no name it gives grows with use. The extension refuses any other, and so does the runtime's working copy, which never keeps what the extension would refuse. */
export const DOC_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]{1,128}(?:\/[A-Za-z0-9._-]{1,128}){0,7}$/;

/** A prefix of documents' paths: as a path's names, and it may end with `/` or inside a name; empty for every document. */
export const DOC_PREFIX = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?:[A-Za-z0-9._-]{1,128}\/){0,7}[A-Za-z0-9._-]{0,128}$/;

/** Where the mirror's mark is kept in the extension's storage: a document of the runtime's working store beside the core's, at a path none of the core's can be (`docs/mirror.json`). It names the working copy the mirror mirrors and how many changes it took from it; the extension takes no runtime's own write there. */
export const MARK_PATH = "mirror.json";

/** A working copy's id, and a process's own as it holds the mirror: 128 random bits as hex. */
export const MIRROR_ID = /^[0-9a-f]{32}$/;

/**
 * What a runtime says of its working copy on `hello`: the copy's id (its folder for this user and
 * extension), this process's own id as it would hold the mirror (what its writes to the mirror
 * carry), whether it asks to hold the mirror (a process that lost it never asks again), and the
 * last of the extension's counts of what a holder may have missed (`MirrorWord.gen`) its copy took.
 */
export interface MirrorAsk {
  copy: string;
  process: string;
  asks: boolean;
  seen: number;
}

/**
 * The extension's word on who holds the mirror, to one runtime: on each hello's answer, and pushed
 * (`mirror`) whenever it changes for that runtime or another runtime changed the storage under the
 * holder. Only the runtime that holds the mirror keeps a working copy; any other reads and writes the
 * storage directly. `gen`: how many times the holder may have missed being told of another runtime's
 * change (its link was down); a holder whose copy took fewer drops what the storage holds of it.
 */
export interface MirrorWord {
  /** Whether this runtime holds the mirror now. */
  held: boolean;
  /** The runtime that does, as a person knows it (its name and machine), when another does; null when none does, or this one does. */
  holder: string | null;
  gen: number;
  /** To the holder: what of its copy to drop, so its next read is the storage's: the documents and blobs another runtime wrote or removed, or `all` (every one the storage holds; what it hasn't had yet stays). */
  dropped?: { docs: string[]; blobs: string[]; all: boolean };
}

/**
 * The largest frame either end sends whole. Lumiverse's socket closes on a larger one from a client
 * and may close a slow one it sends more to; this is its limit, not one of LumiAH's, so it can't be
 * a setting. A larger frame crosses in parts (parts.ts).
 */
export const FRAME_LIMIT = 4 * 1024 * 1024;

/**
 * Whether the runtime's origin is in its account's local-inference scheduler exclusions: `excluded`;
 * `missing` (it isn't, and adding it failed); `unavailable` (this Lumiverse has no scheduler); or
 * `unknown` (not asked yet).
 */
export type SchedulerState = "excluded" | "missing" | "unavailable" | "unknown";

/** The runtime's Lumiverse session as it last asked about it (`GET /api/auth/get-session`, daily). */
export interface SessionReport {
  /** Null: Lumiverse couldn't be asked. */
  valid: boolean | null;
  expiresAt: string | null;
  /** When it asked, in ms since the epoch; null before it has. */
  checkedAt: number | null;
}

/** What a runtime says of itself on `hello` and every `ping`, for the Runtime page. */
export interface RuntimeReport {
  name: string;
  build: string;
  /**
   * How it runs, for the Runtime page's update and sign-in lines: the Bun binary (absolute), its own
   * script (its stable copy under a unit), and the systemd user unit running it (null when none does).
   */
  runtime: { bun: string | null; script: string; unit: string | null };
  /** The machine it runs on. */
  host: string;
  /** Where Lumiverse reaches it: `http://<listen>:<port>/v1`. */
  listen: string;
  port: number;
  scheduler: SchedulerState;
  session: SessionReport;
  /** Turns it is answering now. */
  turns: number;
}

/** A stream the runtime is still reading, with the last chunk it holds in order (0 before any). */
export interface OpenStream {
  stream: string;
  seq: number;
}

/**
 * A history message of the assembled prompt as the interceptor saw it: a mark of its text
 * (`contentMark`) and the chat message it came from. Lumiverse sends the provider no word of where a
 * message came from, so the runtime finds each in the request's body by its mark.
 */
export interface SourceMark {
  mark: string;
  source: RequestSource;
}

/** The turn a tagged request belongs to, as the extension knows it (DESIGN §2 step 4). */
export interface TurnFacts {
  /** The turn's id: its generation's. */
  turn: string;
  user: string;
  chat: string;
  generation: string;
  kind: TurnKind;
  /**
   * The message and swipe the reply writes: a new reply's staged message, a regenerate's or a
   * swipe's new swipe, a continue's continued swipe. `message` is null for a new reply Lumiverse
   * makes its message for only when it saves it (edit and send): the record is anchored then.
   */
  target: { message: string | null; swipe: number };
  /** The preset the prompt was assembled with; null when none. */
  preset: string | null;
  /** The prompt's messages whose source the interceptor could tell, in the prompt's order. */
  sources: SourceMark[];
  /** The settings' revision now: the runtime reads them again (`settings.get`) when it holds another. */
  settings: number;
}

/**
 * The user's settings and texts: the settings whole with defaults filled in, the texts the user
 * replaced, by id, and their own definitions as stored (their agents and skills, and what they
 * switched off: DESIGN §13), which the core reads and checks itself.
 */
export interface SettingsSnapshot {
  revision: number;
  values: JsonObject;
  texts: Record<string, string>;
  definitions?: JsonValue;
}

/** How a turn's record was taken: written on the reply's message now, written once Lumiverse saves the reply, or not written (the reply's message is gone). */
export type Anchoring = "now" | "on_save" | "never";

// ---------------------------------------------------------------- stream chunks

/**
 * A stream's one chunk: `value` with the outcome of something that takes its time (a tool that ran
 * in the extension, the user's answer to an approval), which rides a stream so it survives a
 * reconnect and can be given up like a call; or `error` with the tool's or Lumiverse's own words.
 */
export type StreamChunk = { kind: "value"; value: JsonValue } | { kind: "error"; message: string; code: string };

// ---------------------------------------------------------------- requests and their results

/** Each request's fields (beside the envelope: `link`, `type`, `id`) and its result. */
export interface LinkRequests {
  /**
   * `up` registers its runtime with the user's own session: the extension mints its secret (kept
   * only as a hash), and a later register of the same name replaces it. Unless that one shows the
   * secret the registration has (`secret`: what `up` holds of a runtime it set up before): then the
   * registration stands, its secret is answered back, and where its pushes go is left alone, so a
   * runtime still answering with that secret isn't cut off before `up` restarts it. `model`: the
   * model its loopback connection names; `backend`: who it registered with (absent from a backend
   * from before it could say: LumiAH's own).
   */
  register: { fields: { name: string; build: string; host: string; listen: string; port: number; secret?: string }; result: { relay: string; secret: string; model: string; user: string; backend?: LinkedBackend } };
  /** On every socket the runtime opens: binds its pushes to this session and resumes its open streams from the chunk after `seq`. `lost`: the streams the extension no longer holds (it restarted). `settings`: the user's settings' revision now. `backend`: who it is linked to. */
  hello: { fields: { secret: string; version: number; build: string; report: RuntimeReport; open: OpenStream[]; mirror?: MirrorAsk | null }; result: { relay: string; version: number; build: string; lost: string[]; settings: number; extension?: ExtensionOffer | null; backend?: LinkedBackend; copy?: CopyOffer; mirror?: MirrorWord } };
  /** The heartbeat, naming the streams the runtime reads and the turns it answers: the streams the extension no longer holds end at once, and a turn its runtime no longer names is over. */
  ping: { fields: { secret: string; report: RuntimeReport; streams: string[]; turns: string[] }; result: { lost: string[]; told?: number } };
  /** `GET /v1/models` (the connection's model list and its Test): whether the key is the user's loopback key. */
  models: { fields: { secret: string; key: string }; result: { models: { id: string }[] } };
  /** A tagged request: the tag checked and spent, answered with the turn. `request` is the runtime's own id for it: asked again (after a reconnect), it answers as before; another request with the same tag is refused. */
  "turn.begin": { fields: { secret: string; key: string; tag: string; request: string }; result: TurnFacts };
  /**
   * The turn's record, to write on the reply's message: at once when Lumiverse has saved the reply,
   * else when it does. The chat and the target are the turn's own (`TurnFacts`), said again so the
   * record finds its message even when the extension started again while the turn ran.
   */
  "turn.commit": { fields: { secret: string; turn: string; chat: string; target: { message: string | null; swipe: number }; record: TurnRecord }; result: { anchoring: Anchoring } };
  /** The runtime holds the chunk of `stream` (`seq`, 1). `done`: the stream is over and forgotten. */
  "stream.ack": { fields: { secret: string; stream: string; seq: number }; result: { done: boolean } };
  /** The runtime gave a stream up before its chunk came (its caller cancelled it). */
  "stream.cancel": { fields: { secret: string; stream: string; reason: string }; result: { cancelled: boolean } };
  /** The user's settings and texts now. */
  "settings.get": { fields: { secret: string }; result: SettingsSnapshot };
  /** Trace records, in the order the trace port delivered them, for the live buffer. One a turn's buffer holds already (sent again after a reconnect) counts once. */
  "trace.push": { fields: { secret: string; records: TraceRecord[] }; result: { taken: number } };
  /** What became of a `connection` push: the loopback connection the runtime made or put the key in, or why it couldn't. */
  "setup.connection": { fields: { secret: string; ref: string; connection: { id: string; name: string } | null; problem: string | null }; result: { taken: true } };
  // The extension's storage, the core's documents and blobs (`docs/`, `blobs/`). A write that names
  // `mirror` comes from a runtime's working copy as the process that holds the mirror (the hello's
  // `MirrorAsk.process`): the extension takes it only from the runtime it lets hold the mirror, and
  // refuses any other with `conflict`, for good. One without is a runtime's own (it keeps no copy):
  // taken from any runtime of the user's, and the holder is told of the path (a `mirror` push). A
  // working copy's write of a document says how long before the request its change was made (`ago`,
  // ms): one older than a later write of the path by another runtime, as the extension knows it while
  // it runs, is refused with `superseded`, for good. Without `ago`, a write is made now.
  "blob.get": { fields: { secret: string; hash: string }; result: { text: string | null } };
  "blob.put": { fields: { secret: string; hash: string; text: string; mirror?: string }; result: { stored: true } };
  "doc.get": { fields: { secret: string; path: string }; result: { doc: JsonValue | null } };
  "doc.put": { fields: { secret: string; path: string; doc: JsonValue; mirror?: string; ago?: number }; result: { written: true } };
  "doc.remove": { fields: { secret: string; path: string; mirror?: string; ago?: number }; result: { removed: true } };
  /** The chat's active path, oldest first, each message with its anchor for the swipe it shows. */
  "chat.path": { fields: { secret: string; chat: string }; result: { messages: PathMessage[] } };
  /** The active path's messages whose index is `from` or more and less than `to`, with their text. */
  "chat.messages": { fields: { secret: string; chat: string; from: number; to: number }; result: { messages: ChatMessage[] } };
  /** A record written over the one a message holds for a swipe (a rollback's mark); false when the message or the swipe is gone. */
  "chat.anchor": { fields: { secret: string; chat: string; message: string; swipe: number; record: JsonValue }; result: { written: boolean } };
  /** The world books that apply to the chat. */
  "lore.books": { fields: { secret: string; chat: string }; result: { books: LoreBook[] } };
  "lore.entries": { fields: { secret: string; book: string }; result: { entries: LoreEntry[] } };
  /** The entries Lumiverse activated for a generation. */
  "lore.activated": { fields: { secret: string; chat: string; generation: string }; result: { entries: ActivatedLore[] } };
  /** A preset's blocks, in order, each switched on or off as it is for `chat` (a chat's preset binding may set its own over the preset's); null: as the preset has them. */
  "preset.blocks": { fields: { secret: string; preset: string; chat: string | null }; result: { blocks: PresetBlock[] } };
  /** The tools that run in the extension, as they stand for a chat (`""`: none): the extension's own, and those of the MCP servers the user left on (DESIGN §13, §16). */
  "tools.list": { fields: { secret: string; chat: string }; result: { tools: RemoteTool[] } };
  /** Runs one of them, answered on `stream` with one `value` chunk: `{ text, error? }`. `turn` is the run it serves, so the run's stop ends it. */
  "tool.call": { fields: { secret: string; stream: string; call: RemoteToolCall }; result: { accepted: true } };
  /** Holds a tool call for the user's word (§17), answered on `stream` with one `value` chunk: the `ApprovalAnswer`. The runtime cancels the stream when the wait runs out or the run stops, which takes the ask down. */
  "approval.ask": { fields: { secret: string; stream: string; ask: ApprovalAsk }; result: { accepted: true } };
  /** One member of what the extension supplies to the core (§21), run in its backend: what it answered (null where it answers nothing); `supplied` false when it has no such member. */
  "extension.call": { fields: { secret: string; member: ExtensionMember; arg: JsonValue }; result: { supplied: boolean; value: JsonValue } };
  /** Every blob stored, a page at a time, for upkeep (§20). `cursor`: the `next` of the page before; null for the first. */
  "blob.list": { fields: { secret: string; cursor: string | null }; result: { blobs: BlobInfo[]; next: string | null } };
  "blob.remove": { fields: { secret: string; hashes: string[]; mirror?: string }; result: { removed: true } };
  /** The process that holds the mirror lets it go (its runtime is stopping, and the mirror holds everything it saved): the next runtime to say hello may hold it at once. `released` false when that process doesn't hold it. */
  "mirror.release": { fields: { secret: string; mirror: string }; result: { released: boolean } };
  /** The path of every document under a prefix, at any depth. */
  "doc.list": { fields: { secret: string; prefix: string }; result: { paths: string[] } };
  /** The chat itself; null when the user has no such chat. */
  "chat.info": { fields: { secret: string; chat: string }; result: { chat: ChatInfo | null } };
  /** Every record LumiAH holds on a swipe of a message, in every chat of the user's, a page at a time, for upkeep. */
  "chat.anchors": { fields: { secret: string; cursor: string | null }; result: { anchors: StoredAnchor[]; next: string | null } };
  /** A job was queued, or changed (it began, was paused or resumed, or ended): for the pages' lists, and to tell the user when one finishes or needs them (§15). */
  "job.changed": { fields: { secret: string; job: JobView }; result: { taken: true } };
  /** What the runtime answered to an `ask` push: its value (null where the op gives none), or what refused it: one of the pages' error codes (`internal` for a failure of the runtime's own), words the page shows, and what was wrong with a value where the core says. `took`: how long the runtime worked on it, in ms, for the timing log (absent from a runtime from before it). */
  "ask.answer": { fields: { secret: string; ask: string; value: JsonValue; refusal: { code: string; message: string; problems?: JsonValue } | null; took?: number }; result: { taken: true } };
  // What the lore and history tools read beyond `lore.*` and `chat.*` (DESIGN §24): each member of
  // the core's `RecallPorts`, and a chat's book (§23), for the runtime's own user. A backend from
  // before them knows none of these requests and says so; the runtime then reads what the older
  // requests give, and takes what has no older request as not set up.
  /** Every world book that applies to the chat, each with every entry and its state. `known`: the stamp the runtime holds for each book it read before, by book; a book that still has that stamp comes with `entries` null. */
  "recall.lore.read": { fields: { secret: string; chat: string; known: Record<string, number> }; result: { books: LoreBookRead[] } };
  /** How Lumiverse activated each entry it put in a generation's prompt. */
  "recall.lore.activated": { fields: { secret: string; chat: string; generation: string }; result: { entries: ActivatedEntry[] } };
  /** As `chat.messages`, each message with when it was sent. */
  "recall.chat.messages": { fields: { secret: string; chat: string; from: number; to: number }; result: { messages: TimedMessage[] } };
  /** The user's main embedding connection; null when they have none to embed on. */
  "recall.embedder": { fields: { secret: string }; result: { connection: EmbedderInfo | null } };
  /** One vector per text, in order, on that connection: `EMBED_BATCH_MAX` texts at most, none blank, each of `EMBED_TEXT_MAX` characters at most. */
  "recall.embed": { fields: { secret: string; texts: string[]; kind: "query" | "stored" }; result: { vectors: number[][]; model: string; dimensions: number } };
  /** Whether Lumiverse's Memory Cortex is on for the chat. */
  "recall.memory.enabled": { fields: { secret: string; chat: string }; result: { enabled: boolean } };
  /** The Cortex's own ranked answer to a query over the chat's memory, `limit` at most; `entities`: only what names one of them (none: everything). */
  "recall.memory.search": { fields: { secret: string; chat: string; query: string; limit: number; entities: string[] }; result: { hits: MemoryHit[] } };
  /** What the Cortex has of an entity of the chat's, by its name or an alias; null when it has none so named. */
  "recall.memory.entity": { fields: { secret: string; chat: string; name: string }; result: { entity: MemoryEntity | null } };
  "recall.memory.entities": { fields: { secret: string; chat: string; limit: number }; result: { entities: MemoryEntityBrief[] } };
  "recall.memory.arcs": { fields: { secret: string; chat: string }; result: { arcs: MemoryArc[] } };
  /** The databanks that apply to the chat and are switched on. */
  "recall.databanks.list": { fields: { secret: string; chat: string }; result: { databanks: Databank[] } };
  "recall.databanks.documents": { fields: { secret: string; databank: string }; result: { documents: DatabankDocument[] } };
  /** A document's text; null when it has none to read. */
  "recall.databanks.content": { fields: { secret: string; document: string }; result: { text: string | null } };
  /** Whether the user has a web search provider switched on. */
  "recall.web.enabled": { fields: { secret: string }; result: { enabled: boolean } };
  /** The provider's results for a query, `count` at most; `pages`: with each page's text where Lumiverse read it. */
  "recall.web.search": { fields: { secret: string; query: string; count: number; pages: boolean }; result: { results: WebResult[] } };
  /** The chat's LumiBooks book; null when it has none. */
  "book.read": { fields: { secret: string; chat: string }; result: { book: ChatBook | null } };
  // What the runtime's copy of chat and lore asks of the extension (PI-BUILD-PLAN §4.5): the reads it
  // can't vouch for or doesn't keep, a mounting extension's records kept elsewhere, and what only the
  // extension heard of a chat's latest generation.
  /**
   * One read of the extension's own host (`chats` or `lore`, host/rows.ts), answered as the host
   * answers it for the runtime's own user: `args` are the member's arguments without the user, whom
   * the extension puts in. A read by a chat's id alone is answered only for a chat of that user's.
   */
  "host.read": { fields: { secret: string; port: "chats" | "lore"; method: string; args: JsonValue[] }; result: { value: JsonValue } };
  /** What the extension LumiAH is built into keeps of LumiAH's records on a chat's messages, elsewhere than on the messages (`CopyOffer.ownElsewhere`): each message's entry, by its id; a message it doesn't name has none. */
  "own.read": { fields: { secret: string; chat: string }; result: { entries: Record<string, JsonValue> } };
  /**
   * The persona the chat's latest generation that LumiAH heard was assembled for (absent: none heard
   * since the extension started; null: it had none), the World Info entries Lumiverse activated for
   * it, and the lists of world books the chat's lore is read with (`books`), so that none of them
   * crosses on its own: `character` names the chat's character, whose books are one of them. A backend
   * from before `books` gives none, and the runtime asks each list as it needs it (`host.read`).
   */
  "turn.lore": { fields: { secret: string; chat: string; character?: string }; result: { persona?: string | null; activated: ActivatedInfo[]; books?: TurnBooks } };
}

export type LinkRequestType = keyof LinkRequests;

/** A request as it crosses: its envelope and its fields. */
export type LinkRequest = { [K in LinkRequestType]: { link: typeof LINK; type: K; id: string } & LinkRequests[K]["fields"] }[LinkRequestType];

export type LinkRequestOf<K extends LinkRequestType> = Extract<LinkRequest, { type: K }>;

/** Why the extension refused a request. `version`: the two ends speak different link versions. `superseded`: a working copy's change of a document is older than another runtime's later write of it, which stands. */
export type LinkErrorCode = "bad_request" | "forbidden" | "not_found" | "conflict" | "unavailable" | "version" | "too_large" | "superseded" | "internal";

export interface LinkResultFrame {
  link: typeof LINK;
  type: "result";
  id: string;
  body: unknown;
  /** How long the extension worked on the request, in ms, for the runtime's timing log (absent from an extension from before it). */
  took?: number;
}

export interface LinkErrorFrame {
  link: typeof LINK;
  type: "error";
  id: string;
  code: LinkErrorCode;
  message: string;
  took?: number;
}

// ---------------------------------------------------------------- pushes

/** A chunk of a stream, to the runtime's session. */
export interface ChunkPush {
  link: typeof LINK;
  type: "chunk";
  stream: string;
  seq: number;
  chunk: StreamChunk;
}

/** Where the user pressed Stop: in LumiAH's live view, or in Lumiverse (its own Stop, which the extension hears). */
export type StopBy = "live" | "lumiverse";

/**
 * Stop a turn: the user pressed Stop. `why` is what the turn's end then says. `by` says where: a
 * reply stopped from the live view is one Lumiverse still generates, so the runtime asks Lumiverse
 * to stop it as its own Stop does. Optional so builds from before it still read each other's stop:
 * an older runtime ignores it, and an older extension's push without it only ends the turn.
 */
export interface StopPush {
  link: typeof LINK;
  type: "stop";
  turn: string;
  why: string;
  by?: StopBy;
}

/** The user's settings or texts changed: the runtime reads them again before it next needs them. */
export interface SettingsPush {
  link: typeof LINK;
  type: "settings";
  revision: number;
}

/** The user rotated this runtime's relay secret on the Runtime page: the runtime keeps the new one, and the old one no longer works. */
export interface SecretPush {
  link: typeof LINK;
  type: "secret";
  relay: string;
  secret: string;
}

/**
 * First-time setup, and every new loopback key: the runtime puts the key in the user's loopback
 * connection with its own Lumiverse session, making the connection when there is none (Spindle gives
 * an extension no way to), and says what it did by `ref` (`setup.connection`). It never keeps the key.
 * `name`: what to call a connection it makes (absent: as the last hello said, else LumiAH's own).
 */
export interface ConnectionPush {
  link: typeof LINK;
  type: "connection";
  ref: string;
  key: string;
  name?: string;
}

/**
 * Something a page asked for that the core does where it runs: the runtime holds the harness, and
 * is the one writer of what the core keeps (DESIGN §4), so a file the user edits, a job they start
 * or a list they read is asked of it (`op` and `args`: ops.ts). The runtime answers with
 * `ask.answer`, naming `ask`.
 */
export interface AskPush {
  link: typeof LINK;
  type: "ask";
  ask: string;
  op: string;
  args: JsonObject;
}

/**
 * The extension's own copy of the runtime, offered to a runtime that said hello on another build:
 * the build, where the file is, and its sha256 (hex). The extension sends only its own (the file
 * beside its backend, and the hash its build wrote in), and the runtime takes it only from the file
 * it was set up from, when the bytes there hash as offered (runtime/update).
 */
export interface UpdatePush {
  link: typeof LINK;
  type: "update";
  build: string;
  path: string;
  sha256: string;
}

/** The extension started anew and knows no runtime's session: a runtime linked to it says hello again now, rather than at its next ping. */
export interface GreetPush {
  link: typeof LINK;
  type: "greet";
}

/** The extension's word on who holds the mirror changed for this runtime, or another runtime changed the storage under it (it holds the mirror): `MirrorWord`. */
export interface MirrorPush extends MirrorWord {
  link: typeof LINK;
  type: "mirror";
}

/**
 * One of Lumiverse's events about the user's chats and world books (`COPY_EVENTS`), as the extension
 * heard it, for the runtime's copy of chat and lore: its name, its payload untouched, and whose it is
 * (only that user's runtimes are sent it). `seq` numbers it with the `own` and `copy` pushes this
 * runtime is sent: a gap says one was lost, and the copy reads again what it holds.
 */
export interface EventPush {
  link: typeof LINK;
  type: "event";
  seq: number;
  name: string;
  payload: JsonValue;
  userId: string;
}

/** The extension LumiAH is built into changed what it keeps of LumiAH's records on a chat's messages (`own.read`). Numbered as `EventPush` is. */
export interface OwnPush {
  link: typeof LINK;
  type: "own";
  seq: number;
  chat: string;
}

/** What the runtime's copy may read changed (a permission granted or revoked, the database reader switched): the offer as it stands now. Numbered as `EventPush` is. */
export interface CopyPush {
  link: typeof LINK;
  type: "copy";
  seq: number;
  offer: Omit<CopyOffer, "told">;
}

export type LinkPush = ChunkPush | StopPush | SettingsPush | SecretPush | ConnectionPush | AskPush | UpdatePush | GreetPush | EventPush | OwnPush | CopyPush | MirrorPush;

// ---------------------------------------------------------------- the extension LumiAH is built into

/**
 * The members of what an extension supplies to the core (`HarnessExtension`), each a request over
 * the link (`extension.call`). What reads is asked again after a socket that closed under it; a hook,
 * `releasing` (a check before the turn's reply goes out) and `unreleased` (what the agents had ready,
 * where the lead released nothing), each of which may do work in the extension, are sent once, and a
 * lost answer is the core's to take as none. The runtime offers the core only the members the
 * extension's offer names: one it doesn't have is one the core goes on without.
 */
export type ExtensionMember = "definitions" | "claim" | "writerRequest" | "runBegan" | "agentModel" | "releasing" | "released" | "unreleased" | "replyWritten" | "runEnded";

export const EXTENSION_MEMBERS: readonly ExtensionMember[] = ["definitions", "claim", "writerRequest", "runBegan", "agentModel", "releasing", "released", "unreleased", "replyWritten", "runEnded"];

/** What the backend's extension supplies to the core, as the runtime is told on hello: its name, and which members it has. Null for LumiAH on its own. */
export interface ExtensionOffer {
  name: string;
  members: ExtensionMember[];
}

/**
 * Who a runtime is linked to (DESIGN §21): LumiAH's own backend, or that of an extension LumiAH is
 * built into. A runtime's command line names only the extension's identifier, so the backend says
 * the rest: on `register`, for `up`, and on every `hello`.
 */
export interface LinkedBackend {
  /** The name its pages show: where the runtime's words send the user (`<name>'s Runtime page`). */
  name: string;
  /** The name the runtime gives the loopback connection it makes. */
  connection: string;
  /** Where its Settings are shown, where that isn't "<name>'s Settings" (`BackendIdentity.settingsAt`): what a timeout's words name. */
  settingsAt?: string;
}

/** LumiAH's own, which a runtime takes where a backend doesn't say who it is (one from before it could). */
export const OWN_BACKEND: LinkedBackend = { name: "LumiAH", connection: "LumiAH" };

// ---------------------------------------------------------------- the runtime's copy of chat and lore

/** Lumiverse's events the extension forwards to the user's runtimes (`EventPush`): every change to a chat, its messages or a world book that Lumiverse tells of. */
export const COPY_EVENTS = ["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED", "CHAT_CHANGED", "CHAT_DELETED", "CHAT_FORKED", "WORLD_BOOK_CHANGED", "WORLD_BOOK_DELETED", "WORLD_BOOK_ENTRY_CHANGED", "WORLD_BOOK_ENTRY_DELETED", "WORLD_BOOK_LIBRARY_CHANGED"] as const;

/** The permissions the copy's reads rest on, as the extension's host has them (`CopyOffer.granted`): a read the extension couldn't make, the copy doesn't either. */
export const COPY_PERMISSIONS = ["chats", "chat_mutation", "world_books"] as const;

/** What the runtime's copy of chat and lore is told of the extension on every hello, and again (`CopyPush`) when it changes. */
export interface CopyOffer {
  /** The extension whose entry in a message's extension metadata is its own: LumiAH's, or that of the extension LumiAH is built into. */
  identifier: string;
  /** Which of `COPY_PERMISSIONS` the extension holds now. */
  granted: string[];
  /** The extension LumiAH is built into keeps LumiAH's records elsewhere than on the messages: they are read with `own.read`, and an `own` push says when a chat's changed. */
  ownElsewhere: boolean;
  /** The extension LumiAH is built into gives LumiAH no lore: the copy keeps none either. */
  declinesLore: boolean;
  /** Where LumiAH's record for a swipe is in the extension's entry on a message, where it is one of LumiAH's own forms (`AnchorCodec.reads`): the entry itself (`under` null) or its member `under`. Null: a form only the extension's backend reads, so a chat's path is read over the link. */
  records: { under: string | null } | null;
  /** Lumiverse's database file, for the runtime to read itself where it can: given only to a runtime of the instance's operator, while the operator has the reader switched on; null otherwise. */
  database: string | null;
  /** How many numbered pushes (`event`, `own`, `copy`) the extension has sent this runtime: the next is numbered one more. */
  told: number;
}

/**
 * The lists of world books that attach books to a chat, as the extension's host answered them with
 * `turn.lore` (`LoreReads`, host/rows.ts): a list it couldn't read is none, as the shared lore logic
 * takes a failed one.
 */
export interface TurnBooks {
  /** The books switched on for every chat. */
  global: string[];
  /** The book of the user's active persona. */
  active: string | null;
  /** The book of the persona the chat's latest generation was assembled for (`persona`), where that names one. */
  persona?: string | null;
  /** The books of the character the request named; none where it named none. */
  character: string[];
}

// ---------------------------------------------------------------- notices

/**
 * What arrived of model calls under way since the last notice, in the order it arrived: each delta
 * is the text and reasoning one agent's call gained (`TraceDelta`, as the core's trace port takes
 * it). Deltas of one call that follow each other may come joined into one.
 */
export interface DeltasNotice {
  link: typeof LINK;
  type: "trace.deltas";
  deltas: TraceDelta[];
}

export type LinkNotice = DeltasNotice;

/** A piece of a frame too large to cross whole (parts.ts): the frame's text, cut into `count` pieces under one `id`. */
export interface PartFrame {
  link: typeof LINK;
  type: "part";
  id: string;
  index: number;
  count: number;
  data: string;
}

export type LinkFrame = LinkRequest | LinkResultFrame | LinkErrorFrame | LinkPush | LinkNotice | PartFrame;

/**
 * The words for a version mismatch, naming which side to update: the runtime with its start line
 * again (from the extension's build), or the extension in Lumiverse's Extensions tab. `name`: the
 * extension as its pages show it.
 */
export function versionWords(runtime: number, extension: number, name = "LumiAH"): string {
  if (runtime < extension) return `This runtime speaks link version ${runtime} and ${name} ${extension}: update the runtime by running its start line on ${name}'s Runtime page again.`;
  return `This runtime speaks link version ${runtime} and ${name} ${extension}: update ${name} in Lumiverse (Extensions → ${name} → Update), then restart the runtime.`;
}

/**
 * A mark of a prompt message that both ends compute alike: its role, its text's length and a 32-bit
 * FNV-1a hash of the text's UTF-16 units. It tells one message of a prompt from another, nothing
 * more: no secret hangs on it.
 */
export function contentMark(role: string, text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${role.charAt(0)}${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/** Where Lumiverse reaches a runtime (the loopback connection's base URL); `[::1]`-style hosts keep their brackets. */
export function runtimeBase(listen: string, port: number): string {
  const host = listen.includes(":") && !listen.startsWith("[") ? `[${listen}]` : listen;
  return `http://${host}:${port}/v1`;
}

/** A word of a shell line LumiAH prints, quoted when it needs to be. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** A runtime's systemd user unit, by its name. */
export function unitName(name: string): string {
  return `lumiah-${name}.service`;
}
