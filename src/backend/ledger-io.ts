// Ledger I/O (DESIGN §4.3 durability, §5.1; ARCHITECTURE §2): wires host events and the guard to
// the per-chat LedgerCore, runs the engine before a generation, persists the shadow journal in user
// storage and keeps message metadata in sync with it (flush after each turn, re-assert after
// clobbering).
//
// Per chat, every operation runs through one queue, so the core sees host events in order.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { ChatId, MessageId, UserId, WorldId } from "../shared/ids";
import { runDir } from "../shared/ids";
import type { ChatRun, GenerationKind, HeldWrite, Journal, Marker, MarkerBody, MessageLedger, PendingTurn, PostKind, Rec, RecStatus } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { PROTOCOL_VERSION, type GenerateAs, type GeneratePush } from "../shared/protocol";
import type { Limit } from "../shared/minds";
import { HOST_LIMITS, hostBound } from "../shared/timeouts";
import { validMarkerBody } from "../engine/events";
import type { ChainMessage, FoldSnapshot, SnapshotStore } from "../engine/ledger/chain";
import { emptyJournal, LedgerCore, type LedgerEnv, type WriteResult } from "../engine/ledger/journal";
import type { WorldState } from "../engine/state";
import type { WorldDoc } from "../shared/world";
import type { LedgerFold } from "../engine/ledger/fold";
import { activeText, contentId } from "../engine/ledger/path";
import { giveWay } from "./give-way";
import type { ContextHandlerInput, ContextVerdict, GenerationEndedEvent, GenerationStartedEvent, HostGenerationType, HostMessage, HostPort } from "./host";
import { setAside } from "./stored-json";
import type { Diagnostics } from "./diagnostics";
import { messageOf } from "./diagnostics";
import { CANNOT_STOP, NOT_LAST_REPLY, STEP_LABEL } from "../shared/diagnostics";

/** Resolves a chat's ledger environment; null when the chat is not a world chat. */
export type EnvResolver = (chatId: ChatId, userId: UserId) => Promise<LedgerEnv | null>;

const KIND: Record<HostGenerationType, GenerationKind> = {
  normal: "normal",
  regenerate: "regenerate",
  swipe: "swipe",
  continue: "continue",
  impersonate: "impersonate",
};

export function journalPath(chatId: ChatId): string {
  return `${runDir(chatId)}journal.json`;
}

/** DESIGN §4.3 overflow: a metadata value never exceeds 32 KB; a larger ledger goes in continuation chunks. */
export const METADATA_CAP_BYTES = 32 * 1024;
/** Characters per chunk: at most 3 UTF-8 bytes per UTF-16 unit keeps a chunk under the cap. */
export const METADATA_CHUNK_CHARS = 10_000;
const CHUNK_PREFIX = `${LEDGER_NAMESPACE}:`;

/**
 * The bag with `ledger` written under the namespace: inline when it fits, else a header
 * `{v: 1, chunks, hash}` plus `lumi_rp_engine:<i>` string chunks. Stale chunks are removed; other
 * writers' keys are kept. Never truncates (L33).
 */
export function encodeLedger(bag: JsonObject, ledger: MessageLedger): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(bag)) if (!k.startsWith(CHUNK_PREFIX)) out[k] = v;
  const text = JSON.stringify(ledger);
  if (new TextEncoder().encode(text).length <= METADATA_CAP_BYTES) {
    out[LEDGER_NAMESPACE] = JSON.parse(text) as JsonObject;
    return out;
  }
  const chunks = Math.ceil(text.length / METADATA_CHUNK_CHARS);
  out[LEDGER_NAMESPACE] = { v: 1, chunks, hash: hashParts("lre.chunks", text) };
  for (let i = 0; i < chunks; i++) out[`${CHUNK_PREFIX}${i}`] = text.slice(i * METADATA_CHUNK_CHARS, (i + 1) * METADATA_CHUNK_CHARS);
  return out;
}

/**
 * The ledger a metadata bag holds, inline or chunked; null when absent, malformed or a chunk is
 * missing. Stored ledgers come from outside (any metadata writer, an imported chat), so a marker is
 * kept only when its body passes the check requests pass, swipe keys must be swipe indexes, and a
 * record that fails `isRec` is skipped and reported to `damaged` with its swipe key.
 */
export function decodeLedger(bag: JsonObject, damaged?: (swipe: string) => void): MessageLedger | null {
  let raw: unknown = bag[LEDGER_NAMESPACE];
  if (isRecord(raw) && typeof raw.chunks === "number" && typeof raw.hash === "string") {
    if (!Number.isInteger(raw.chunks) || raw.chunks < 1 || raw.chunks > 1000) return null;
    let text = "";
    for (let i = 0; i < raw.chunks; i++) {
      const part = bag[`${CHUNK_PREFIX}${i}`];
      if (typeof part !== "string") return null;
      text += part;
    }
    if (hashParts("lre.chunks", text) !== raw.hash) return null;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.swipes) || !Array.isArray(raw.markers)) return null;
  const swipes: Record<string, Rec> = {};
  for (const [key, rec] of Object.entries(raw.swipes)) {
    if (!SWIPE_KEY.test(key)) continue;
    if (isRec(rec)) swipes[key] = structuredClone(rec);
    else damaged?.(key);
  }
  const markers: Marker[] = [];
  for (const m of raw.markers) {
    if (!isRecord(m) || typeof m.seq !== "number" || !(m.at === null || typeof m.at === "string")) continue;
    // A body that passes is kept as written, not as the check clamps it: the chain hashed it so when
    // the marker was made (an earlier build journaled a start marker's half-minute tick unclamped),
    // and `applyMarker` checks and clamps it again wherever it applies.
    const { seq: _seq, at: _at, start: _start, ...body } = m;
    if (validMarkerBody(body)) markers.push({ ...(body as MarkerBody), seq: m.seq, at: m.at, ...(m.start === true ? { start: true as const } : {}) });
  }
  return { v: 1, swipes, markers };
}

/** The metadata ledger of a host message, if it holds a well-formed one. */
export function metadataLedger(message: HostMessage): MessageLedger | null {
  return decodeLedger(message.metadata);
}

/** The chain as the core sees it; `damaged` hears of each stored record skipped as malformed. */
export function toChain(messages: readonly HostMessage[], damaged?: (messageId: MessageId, swipe: string) => void): ChainMessage[] {
  return messages.map((m) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, swipes: [...m.swipes], ledger: decodeLedger(m.metadata, damaged && ((swipe) => damaged(m.id, swipe))) }));
}

/**
 * Re-asserts of one unchanged ledger in a row that don't stick (the metadata still differs on the
 * next read): past this, flush stops rewriting it, so no stored ledger and no other writer can
 * keep the write and its `MESSAGE_EDITED` going round.
 */
export const REASSERTS_PER_LEDGER = 3;

interface ChatSlot {
  core: LedgerCore;
  userId: UserId;
  queue: Promise<void>;
  /** The journal text last read or written; an unchanged journal isn't written again. */
  written: string | null;
  /** Operations queued or running on this chat; a slot with none (and no turn in flight) may be evicted. */
  ops: number;
  snapshots: ChatSnapshots;
  /** Per message, the ledger last re-asserted after a clobber (as written) and how many times in a row. */
  reasserts: Map<MessageId, { text: string; count: number }>;
  /**
   * The windows the journal held when it was read: turns of a backend that stopped, whose
   * generations are gone (DESIGN §5.1 step 7). Only these are closed when the chat is opened again;
   * a generation under way in this backend keeps its window, however often a page resyncs.
   */
  leftOpen: Set<string>;
}

/** Open chats kept in memory; the least recently opened idle ones are evicted past this. */
export const OPEN_CHATS_CAP = 128;

/** Fold snapshots kept per chat (the newest; older chain positions fold from the nearest kept one). */
export const SNAPSHOTS_PER_CHAT = 6;

export function snapshotsPath(chatId: ChatId): string {
  return `${runDir(chatId)}snapshots.json`;
}

/** A chat's fold snapshots (DESIGN §4.3 fold snapshots), persisted beside its journal. */
export class ChatSnapshots implements SnapshotStore {
  private readonly map = new Map<string, FoldSnapshot>();
  dirty = false;

  constructor(list: readonly FoldSnapshot[] = []) {
    for (const s of list) this.map.set(s.key, s);
  }

  /** Parses a stored file; anything malformed is skipped, and an unreadable file is none (snapshots are only a shortcut). */
  static parse(text: string | null): ChatSnapshots {
    let raw: unknown = [];
    try {
      raw = text === null ? [] : JSON.parse(text);
    } catch {
      raw = [];
    }
    const list = Array.isArray(raw) ? raw.filter((s): s is FoldSnapshot => isRecord(s) && typeof s.key === "string" && isRecord(s.state) && Array.isArray(s.notes) && Array.isArray(s.keep) && Array.isArray(s.violations)) : [];
    return new ChatSnapshots(list);
  }

  get(key: string): FoldSnapshot | undefined {
    return this.map.get(key);
  }

  put(snapshot: FoldSnapshot): void {
    if (this.map.has(snapshot.key)) return;
    this.map.set(snapshot.key, snapshot);
    while (this.map.size > SNAPSHOTS_PER_CHAT) this.map.delete(this.map.keys().next().value ?? "");
    this.dirty = true;
  }

  toJSON(): FoldSnapshot[] {
    return [...this.map.values()];
  }
}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === "string");
const isContent = (v: unknown): boolean => isRecord(v) && typeof v.len === "number" && typeof v.hash === "string";
/** Event refs (`EventRef`): into the record's events, or into one of its `post` entries by `seq`. */
const isRefs = (v: unknown): boolean => Array.isArray(v) && v.every((r) => isRecord(r) && isInt(r.index) && (r.in === "events" || (r.in === "post" && isInt(r.seq))));
const SWIPE_KEY = /^\d{1,6}$/;
const POST_KINDS: readonly unknown[] = ["materialize", "fix", "confirm", "cont", "narr"] satisfies PostKind[];
const REC_STATUSES: readonly unknown[] = ["ok", "degraded", "stopped"] satisfies RecStatus[];

/**
 * A stored turn record (DESIGN §4.3 `Rec`), checked through every field the folds, hashes and
 * ledger operations read. Records reach the engine from the journal file and from message
 * metadata, which any writer can change (an imported or forked chat, another extension).
 */
function isRec(rec: unknown): rec is Rec {
  if (!isRecord(rec) || rec.v !== 1 || typeof rec.defHash !== "string" || !isInt(rec.seq) || !isContent(rec.swipeHash) || typeof rec.path !== "string" || typeof rec.seed !== "string") return false;
  if (!isInt(rec.pre) || rec.pre < 0 || !isInt(rec.markersApplied) || !REC_STATUSES.includes(rec.status) || !isRefs(rec.undone) || !isRecord(rec.intents)) return false;
  if (!Array.isArray(rec.events) || !rec.events.every((e) => isRecord(e) && typeof e.type === "string" && (e.group === undefined || typeof e.group === "string"))) return false;
  if (!Array.isArray(rec.post) || !rec.post.every((p) => isRecord(p) && isInt(p.seq) && typeof p.at === "string" && POST_KINDS.includes(p.kind) && Array.isArray(p.events) && p.events.every((e) => isRecord(e) && typeof e.type === "string" && (e.group === undefined || typeof e.group === "string")))) return false;
  if (rec.keep !== undefined && !(isRecord(rec.keep) && Object.values(rec.keep).every((k) => isRecord(k) && isRefs(k.convert)))) return false;
  if (rec.dropped !== undefined && !(Array.isArray(rec.dropped) && rec.dropped.every((d) => isRecord(d) && isInt(d.seq) && POST_KINDS.includes(d.kind) && typeof d.reason === "string"))) return false;
  return (rec.accepted === undefined || isContent(rec.accepted)) && (rec.diag === undefined || typeof rec.diag === "string") && (rec.readElsewhere === undefined || rec.readElsewhere === true);
}

const isChainEntry = (v: unknown): boolean => isRecord(v) && typeof v.id === "string" && typeof v.isUser === "boolean" && isInt(v.swipeId) && isInt(v.swipeCount) && isContent(v.content) && typeof v.parentPath === "string";

function isHeldWrite(w: unknown): boolean {
  if (!isRecord(w) || typeof w.id !== "string") return false;
  switch (w.kind) {
    case "post":
      return w.target === "head" && isRecord(w.entry) && typeof w.entry.kind === "string" && Array.isArray(w.entry.events);
    case "marker":
      return w.target === "head" && validMarkerBody(w.body) !== null;
    case "keep":
      return typeof w.messageId === "string" && typeof w.parentPath === "string" && isRefs(w.convert);
    case "discard":
      return typeof w.after === "string";
    case "reread":
    case "retry_read":
      return typeof w.messageId === "string" && isInt(w.swipeId);
    case "undo":
      return typeof w.messageId === "string" && isInt(w.swipeId) && isRefs(w.refs);
    default:
      return false;
  }
}

function isPendingTurn(p: unknown): boolean {
  if (!isRecord(p) || typeof p.generationId !== "string" || !(p.kind === "renarrate" || Object.values<unknown>(KIND).includes(p.kind)) || !(p.messageId === null || typeof p.messageId === "string") || !(p.swipeId === null || isInt(p.swipeId))) return false;
  if (typeof p.planned !== "boolean" || typeof p.saved !== "boolean" || typeof p.seed !== "string" || !isInt(p.markersApplied) || typeof p.parentPath !== "string") return false;
  if (!Array.isArray(p.chain) || !p.chain.every(isChainEntry) || !Array.isArray(p.events) || !Array.isArray(p.startMarkers) || !p.startMarkers.every(isRecord)) return false;
  if (![p.userMessages, p.rerendered].every((m) => isRecord(m) && Object.values(m).every(isContent))) return false;
  if (p.continueHead !== undefined && typeof p.continueHead !== "string") return false;
  if (p.captured !== undefined && !isContent(p.captured)) return false;
  if (p.renarrateOf !== undefined && !(isRecord(p.renarrateOf) && typeof p.renarrateOf.messageId === "string" && isInt(p.renarrateOf.swipeId))) return false;
  if (p.undone !== undefined && !isRefs(p.undone)) return false;
  return [p.copies, p.dropped].every((list) => list === undefined || (Array.isArray(list) && list.every(isRecord)));
}

/** A journal message's ledger: swipe-index keys, records that pass `isRec` and markers `decodeLedger` keeps. */
function isJournalMessage(m: unknown): boolean {
  if (!isRecord(m) || typeof m.flushed !== "boolean" || !isRecord(m.ledger) || m.ledger.v !== 1 || !isRecord(m.ledger.swipes) || !Array.isArray(m.ledger.markers)) return false;
  if (!Object.entries(m.ledger.swipes).every(([key, rec]) => SWIPE_KEY.test(key) && isRec(rec))) return false;
  // Markers as `decodeLedger` keeps them: `seq`, `at` and a body that passes `validMarkerBody`.
  return m.ledger.markers.every((mk) => isRecord(mk) && typeof mk.seq === "number" && (mk.at === null || typeof mk.at === "string") && (mk.start === undefined || mk.start === true) && validMarkerBody(mk) !== null);
}

/** A stored journal, checked entry by entry: one junk entry makes every ledger operation throw, so the whole file is damaged. */
function isJournal(raw: unknown, chatId: ChatId): raw is Journal {
  if (!isRecord(raw) || raw.v !== 1 || raw.chatId !== chatId || typeof raw.seq !== "number" || !Number.isFinite(raw.seq) || typeof raw.started !== "boolean") return false;
  if (![raw.chain, raw.pauses, raw.tombstones, raw.held].every(Array.isArray) || !isStrings(raw.windows) || !isRecord(raw.messages) || !isRecord(raw.pending)) return false;
  if (!(raw.chain as unknown[]).every(isChainEntry) || !Object.values(raw.messages).every(isJournalMessage) || !Object.values(raw.pending).every(isPendingTurn)) return false;
  if (!(raw.pauses as unknown[]).every((p) => isRecord(p) && typeof p.messageId === "string" && isContent(p.content))) return false;
  if (!(raw.tombstones as unknown[]).every((t) => isRecord(t) && typeof t.messageId === "string" && isContent(t.swipeHash) && typeof t.recHash === "string")) return false;
  if (!(raw.held as unknown[]).every((h) => isRecord(h) && isStrings(h.waitFor) && isHeldWrite(h.write))) return false;
  if (raw.refused !== undefined && !(Array.isArray(raw.refused) && raw.refused.every((r) => isRecord(r) && typeof r.reason === "string" && (r.messageId === null || typeof r.messageId === "string") && isHeldWrite(r.write)))) return false;
  return raw.run === undefined || (isRecord(raw.run) && typeof raw.run.worldId === "string" && typeof raw.run.runSeed === "string");
}

/**
 * The chat's stored journal when it is well formed and belongs to the chat's current run, stamped
 * with it; otherwise a fresh one and why (a journal from a re-attached world is reset; a malformed
 * file must not make the chat unopenable).
 */
export function decodeJournal(text: string | null, chatId: ChatId, run: Pick<ChatRun, "worldId" | "runSeed">): { journal: Journal; reset: string | null } {
  const stamp = { worldId: run.worldId, runSeed: run.runSeed };
  const fresh = (): Journal => ({ ...emptyJournal(chatId), run: stamp });
  if (text === null) return { journal: fresh(), reset: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { journal: fresh(), reset: "unreadable" };
  }
  if (!isJournal(raw, chatId)) return { journal: fresh(), reset: "malformed" };
  if (raw.run && (raw.run.worldId !== run.worldId || raw.run.runSeed !== run.runSeed)) return { journal: fresh(), reset: "from another run of this chat" };
  // An earlier build stored each pending turn with `slotHeld`, a flag nothing ever set: it is
  // dropped, so a journal this build writes never carries it.
  for (const p of Object.values(raw.pending)) Reflect.deleteProperty(p, "slotHeld");
  return { journal: { ...raw, run: stamp }, reset: null };
}

type Op = (core: LedgerCore, observed: ChainMessage[]) => void | Promise<void>;

export interface TurnContext {
  chatId: ChatId;
  userId: UserId;
  core: LedgerCore;
  observed: ChainMessage[];
  generationId: string;
  messageId: MessageId;
  /** The swipe the turn wrote (a Continue: the head's displayed swipe). */
  swipeId: number;
  kind: GenerationKind;
  /** For `beforeCommit`, the text the core will read (a Continue's suffix); for `afterCommit`, the saved content. */
  content: string;
  /** The reply read's signal: Cancel on the activity line aborts it, and the reads still waiting are skipped. */
  signal: AbortSignal;
}

/** What the pre phase leaves the engine run: nothing to say, or a question the chat now asks, on which the run waits (a claim under Ask first, DESIGN §9.4). */
export type PreOutcome = { waiting: string };

/**
 * What a prepared turn is made from besides its chain and the journal (`TurnHooks.inputs`), and what
 * the chat says when one changes before its reply starts (DESIGN §5.1).
 */
const TURN_INPUTS = {
  revision: "the chat's world revision changed",
  settings: "your RPEngine settings changed",
  notes: "a note for the next reply was reworded or dismissed",
} as const satisfies Record<string, string>;

/** Each of a turn's other inputs (`TURN_INPUTS`), as one comparable value. */
export type TurnInputs = Record<keyof typeof TURN_INPUTS, string>;

const TURN_INPUT_NAMES = Object.keys(TURN_INPUTS) as (keyof typeof TURN_INPUTS)[];

/**
 * Async work around the core's synchronous steps (DESIGN §5.1): the engine run's pre phase, plan
 * phase and sections, and `extract` before the commit, run here inside the chat's queue, so the
 * core then folds their results as plain data. `afterCommit` collects chips; `changed` fires after
 * every operation.
 */
export interface TurnHooks {
  /**
   * The engine run's pre phase. `runKey` stands for the chain and the journal the run reads: a run of
   * the same turn after a failed one may keep what that one got right while they, and whatever else
   * that part depends on, are unchanged.
   */
  beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; connectionId: string | null; runKey: string; signal: AbortSignal }): Promise<PreOutcome | undefined>;
  /** After the plan, before the reply: the plan-phase prose steps (DESIGN §5.2 brief, prose outline); a `waiting` outcome holds the reply on the player (the outline gate, §5.1). */
  afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; signal: AbortSignal }): Promise<PreOutcome | undefined>;
  /** The engine run's last step (DESIGN §6.4): the prepared turn's sections made, and the book's entries placed for them; nothing is written into the book yet. */
  deliver(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string }): Promise<Delivered>;
  /**
   * The guard's write of a turn's sections, for the generation that takes it (DESIGN §6.4): `moved`,
   * writing nothing, when what the placement was decided from changed since the engine run. Throws
   * when the host can't say which preset the chat generates with, or refuses the write.
   */
  fill(chatId: ChatId, userId: UserId, delivered: Delivered): Promise<"filled" | "moved">;
  /** Empties and switches off what `fill` wrote. */
  clear(chatId: ChatId, userId: UserId, delivered: Delivered): Promise<void>;
  /**
   * The chat's world book holds none of the engine's sections (DESIGN §6.4): everything of the
   * engine's that is on there, a turn a restart cut short or a clear the host refused included, is
   * emptied and switched off. Throws when the host refuses.
   */
  vacate(chatId: ChatId, userId: UserId): Promise<void>;
  /** A generation took the prepared turn: what the engine run kept under its id is the generation's now, and an earlier failure's flag goes. */
  adopted(chatId: ChatId, userId: UserId, from: string, to: string): Promise<void>;
  /** The engine run failed and nothing was generated: the chat says which step and why, with a Retry. */
  failed(input: { chatId: ChatId; userId: UserId; turn: string; step: string; reason: string }): Promise<void>;
  /** The chat's world, read from its metadata alone (the guard's check); null when it isn't a world chat. */
  worldOf(chatId: ChatId, userId: UserId): Promise<WorldId | null>;
  /**
   * What else the chat's sections are made from, each read from memory (DESIGN §5.1): the chat's
   * world revision, the settings the turn reads (not every setting: one it doesn't read keeps it),
   * the active preset and the presets written, and the chat's Outcome notes. Each is named, so a turn
   * dropped for it says which changed.
   */
  inputs(chatId: ChatId, userId: UserId): TurnInputs;
  beforeCommit(input: TurnContext): Promise<void>;
  afterCommit(input: TurnContext): Promise<void>;
  changed(chatId: ChatId, userId: UserId): void;
  /** A swipe or regenerate is a Re-run or a Re-narrate (P3; `settings.swipeDefault` or a one-shot choice). */
  kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind }): Promise<GenerationKind>;
}

/**
 * What the engine run made for a turn's prompt (DESIGN §6.4): each entry of the world's book and the
 * text it takes, written only by the guard of the generation that takes the turn, and `placed`, what
 * the placement was decided from (the preset the host generates the chat with and the book's
 * Positions), which the write checks first.
 */
export interface Delivered {
  bookId: string;
  fills: ReadonlyMap<string, string>;
  placed: string;
  /**
   * The World Info entries the turn's sections carried (DESIGN §6.11): a section line that tells an
   * entry's text names it, so that entry can stay out of the same prompt. Empty when none did.
   */
  sources: readonly { bookId: string; entryId: string }[];
}

/** One message as the chat's events last showed it: what the guard checks a prepared turn's chain against. */
export interface Mirrored {
  id: MessageId;
  isUser: boolean;
  swipeId: number;
  /** The shown swipe's content hash. */
  content: string;
}

const EMPTY_CONTENT = contentId("").hash;

export function mirrorOf(observed: readonly ChainMessage[]): Mirrored[] {
  return observed.map((m) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, content: contentId(activeText(m)).hash }));
}

const isSwipe = (type: HostGenerationType): boolean => type === "regenerate" || type === "swipe";

/**
 * The chain a turn of `type` is planned on, as one hash: what comes before a regenerate's or a
 * swipe's target; all of it for a Continue; for a new reply, all but the empty replies at its end
 * (the one the host stages for the reply before the guard sees it).
 */
export function chainStamp(entries: readonly Mirrored[], type: HostGenerationType, target: MessageId | null): string {
  let upTo = entries.length;
  if (isSwipe(type)) {
    const at = target ? entries.findIndex((e) => e.id === target) : -1;
    upTo = at < 0 ? entries.length : at;
  } else if (type === "normal") {
    while (upTo > 0 && entries[upTo - 1]?.isUser === false && entries[upTo - 1]?.content === EMPTY_CONTENT) upTo--;
  }
  return hashParts("lre.chain", ...entries.slice(0, upTo).map((e) => `${e.id}:${e.isUser ? 1 : 0}:${e.swipeId}:${e.content}`));
}

/** A generation the guard stopped (DESIGN §5.1): its stop starts the engine run under `id`. */
interface Halt {
  id: string;
  generationId: string | null;
  type: HostGenerationType;
  /** Regenerate and swipe: the message the new swipe goes on. */
  target: MessageId | null;
  connectionId: string | null;
  session?: string;
}

/** How a reply that took a prepared turn failed (DESIGN §5.1): its generation ended in error, or it came back empty. */
export type ReplyFailure = "error" | "empty";

/** A turn the engine prepared for the chat's next generation of its type (DESIGN §5.1). */
interface Prepared {
  id: string;
  type: HostGenerationType;
  target: MessageId | null;
  /** The planned turn, out of the journal; null when it got no plan (a Continue, a turn under a pause). */
  turn: PendingTurn | null;
  /** The chain it was planned on (`chainStamp`), the journal's epoch then, and the other inputs (`TurnHooks.inputs`). */
  stamp: string;
  epoch: number;
  inputs: TurnInputs;
  worldId: WorldId;
  delivered: Delivered;
  /** The guard's write of its sections, once a generation took it: what emptying them waits for. */
  writing: Promise<void> | null;
  /** How the frontend starts the generation again (asked again when a frontend comes back to the chat). */
  as: GenerateAs;
  /**
   * The one page asked to start it (DESIGN §5.1): a page showing the chat on screen, the one the
   * stopped generation ran for first. A page showing the chat takes it from a holder that doesn't,
   * and it passes on when its page closes. Null: no page shows the chat yet.
   */
  holder: string | null;
  /** The generation the guard let through with it; null until one came: then it is consumed. */
  generationId: string | null;
  /**
   * Set when the turn is kept from a reply that failed (DESIGN §5.1): no page is asked to start it,
   * only the player's own retry takes it, and a change to what it was made from drops it quietly,
   * since its reply was never asked for again. Null for a turn an engine run prepared.
   */
  kept: ReplyFailure | null;
}

/** The guard's view of one world chat, in memory only: after a restart the next generation runs the engine again. */
interface Gate {
  userId: UserId;
  worldId: WorldId;
  /** The chat's messages as their events showed them, from an engine run's read on. */
  mirror: Mirrored[] | null;
  /** Bumped by each write to the journal from outside a turn: a plan folded before it is stale. */
  epoch: number;
  halt: Halt | null;
  prepared: Prepared | null;
  /**
   * The turn the generation under way took, from its prompt on, with its sections emptied: kept for
   * a retry when that reply fails, let go when it ends otherwise or stops.
   */
  taken: Prepared | null;
}

/**
 * Who a world's book belongs to now (DESIGN §6.4), in memory only. A `turn`: an engine run writing
 * its sections, the turn it prepared and the generation that took it, until they are emptied (`owner`
 * is the run's id, which its turn keeps). An `impersonate`: an Impersonate's prompt, held empty
 * (`owner` is its generation's id). A `look`: a dry run emptying what an earlier turn left. `moved`
 * settles when the owner lets go or its turn's state changes, so a claim waiting on it looks again.
 */
interface Lease {
  chatId: ChatId;
  owner: string;
  kind: "turn" | "impersonate" | "look";
  moved: PromiseWithResolvers<void>;
}

/** Why the engine run stopped: the step that failed, and what went wrong. */
class EngineFailure extends Error {
  constructor(
    readonly step: string,
    reason: string,
  ) {
    super(reason);
  }
}

/** Why a turn's signal aborted when the player cancelled it (`LedgerService.cancel`): its own end, never a failure. */
export class TurnCancelled extends Error {
  constructor() {
    super("you cancelled the turn");
  }
}

/** How the frontend starts the generation again for a halted one of `type`; `send` when only the player can (a new reply after a reply). */
function restartAs(type: HostGenerationType, observed: readonly ChainMessage[]): GenerateAs {
  if (type === "normal") return observed.at(-1)?.isUser ? "regenerate" : "send";
  return type === "continue" ? "continue" : "regenerate";
}

/** The ask to start a prepared turn's generation; the frontend starts each `turn` once. */
function restartPush(chatId: ChatId, p: Prepared): GeneratePush {
  return { lre: PROTOCOL_VERSION, type: "lre.generate", chatId, as: p.as, turn: p.id };
}

export class LedgerService {
  private readonly chats = new Map<ChatId, ChatSlot>();
  private readonly unsubscribe: (() => void)[] = [];
  private outstanding = 0;
  /** Every operation failure, also logged to the host. */
  readonly errors: string[] = [];
  hooks: TurnHooks | null = null;
  /** Where each turn's phases, failures and activity go (DESIGN §6.9); the runtime sets it. */
  diag: Diagnostics | null = null;
  /** Per `user \0 chat`: why the chat's journal was replaced on opening (kept for the process's life). */
  private readonly resets = new Map<string, string>();
  /** Per `user \0 chat`: notices about records on its messages skipped as malformed (kept for the process's life). */
  private readonly damaged = new Map<string, Set<string>>();
  /** Each world chat's guard state (DESIGN §5.1). */
  private readonly gates = new Map<ChatId, Gate>();
  /** Each chat's engine run or reply read under way, by the controller its steps' signals hang from: what Cancel aborts (DESIGN §5.1). */
  private readonly inFlight = new Map<ChatId, AbortController>();
  /** Each of the users' pages: the chat it shows and whether on screen, newest report last (`page`). */
  private readonly pages = new Map<string, { userId: UserId; chatId: ChatId | null; viewing: boolean }>();
  /** The latest generation the host started in each chat, as its event arrived: the guard's generation. */
  private readonly started = new Map<ChatId, GenerationStartedEvent>();
  /** Who each world's book belongs to now (`Lease`). */
  private readonly leases = new Map<WorldId, Lease>();
  /** The generations the guard answered, so one that went ahead without it is told of. */
  private readonly answered = new Set<string>();
  /** Each user's guard wait (Settings → Timeouts), within Lumiverse's range, as their settings last read. */
  private readonly guardWait = new Map<UserId, number>();
  /** The guard's registered wait; 0 until attached. */
  private guardTimeout = 0;
  /**
   * Generations started and not yet ended or stopped, and calls of the guard in flight: while either
   * holds, the host may be walking its handler list, so a new registration waits.
   */
  private readonly generating = new Set<string>();
  private guarding = 0;

  constructor(
    private readonly host: HostPort,
    private readonly resolveEnv: EnvResolver,
    private readonly folder: LedgerFold,
    /** Drops the runtime's copy of a chat's messages (`MessageCache`), so a chat forgotten is read afresh. */
    private readonly forgetMessages: (chatId: ChatId) => void = () => undefined,
  ) {}

  /** Subscribes to host events and registers the guard. */
  attach(): void {
    const h = this.host;
    this.unsubscribe.push(
      // A page that held a waiting reply's claim closed: the next page to open the chat takes it.
      h.on("FRONTEND_SESSION_CLOSED", (e, userId) => this.sessionClosed(e.frontendSessionId, userId)),
      h.on("MESSAGE_SENT", (e, userId) => {
        this.mirror(e.chatId, e.message);
        this.onMessage(e.chatId, userId, e.message.id, "sent");
      }),
      h.on("MESSAGE_EDITED", (e, userId) => {
        this.mirror(e.chatId, e.message);
        if (this.lateReply(e.chatId, userId, e.message)) return;
        this.onMessage(e.chatId, userId, e.message.id, "edited");
      }),
      h.on("MESSAGE_SWIPED", (e, userId) => {
        this.mirror(e.chatId, e.message);
        if (e.action === "updated" && e.swipeId === e.message.swipeId && this.lateReply(e.chatId, userId, e.message)) return;
        this.onSwiped(e.chatId, userId, e.message.id, e.action, e.swipeId);
      }),
      h.on("MESSAGE_DELETED", (e, userId) => {
        this.unmirror(e.chatId, e.messageId);
        this.onMessage(e.chatId, userId, e.messageId, "deleted");
      }),
      h.on("GENERATION_STARTED", (e, userId) => {
        this.generating.add(e.generationId);
        this.started.delete(e.chatId);
        this.started.set(e.chatId, e);
        if (this.started.size > 1024) this.started.delete(this.started.keys().next().value ?? "");
        return this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          const kind = this.hooks && userId ? await this.hooks.kindOf({ chatId: e.chatId, userId, kind: KIND[e.generationType] }) : KIND[e.generationType];
          core.started({ generationId: e.generationId, kind, targetMessageId: e.targetMessageId, targetSwipeId: e.targetSwipeId }, observed);
        });
      }),
      h.on("GENERATION_IN_PROGRESS", (e, userId) => {
        this.unguarded(e.chatId, userId, e.generationId);
        // Its prompt is assembled: the sections it held go, and so does an Impersonate's hold.
        this.release(e.chatId, e.generationId);
      }),
      h.on("GENERATION_ENDED", (e, userId) => {
        this.generationOver(e.chatId, e.generationId);
        // Kept at once, so a retry pressed the moment the reply failed finds its turn.
        const failed = this.afterReply(e.chatId, e.generationId, e);
        const at = userId ? { chatId: e.chatId, userId, turn: e.generationId } : null;
        const halt = this.haltOf(e.chatId, e.generationId);
        // The host ended a generation the guard stopped instead of stopping it: no engine run follows.
        if (halt && userId) this.diag?.end({ chatId: e.chatId, userId, turn: halt.id }, { status: "failed", reason: `Lumiverse ended the stopped generation instead of stopping it${e.error ? ` (${e.error.slice(0, 200)})` : ""}, so the engine didn't run; generate again` });
        return this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          // A generation that ended in error commits as stopped: no auto-read, no
          // extraction; the reply's Retry read chip covers whatever text was saved.
          if (e.error) {
            this.host.log("warn", `[LumiRPEngine] generation ${e.generationId.slice(0, 8)} ended with an error: ${e.error.slice(0, 200)}`, userId ?? undefined, e.generationId);
            core.stopped({ generationId: e.generationId, content: e.content }, observed);
            if (at) this.diag?.end(at, { status: "failed", reason: `the reply's generation failed: ${e.error.slice(0, 300)}` });
            return;
          }
          // An empty reply to a prepared turn failed as well: none of the turn is committed, so the
          // retry that takes it plays it once.
          if (failed === "empty") {
            core.stopped({ generationId: e.generationId, content: "" }, observed);
            if (at) this.diag?.end(at, { status: "failed", reason: "the narrator returned an empty reply" });
            return;
          }
          await this.commitReply(core, observed, e.chatId, userId, e.generationId, e.messageId, e.content);
        });
      }),
      h.on("GENERATION_STOPPED", (e, userId) => {
        this.generationOver(e.chatId, e.generationId);
        // A stop is the player's: the turn it took goes, as it always has.
        this.afterReply(e.chatId, e.generationId, null);
        const halt = this.haltOf(e.chatId, e.generationId);
        if (userId && !halt) this.diag?.end({ chatId: e.chatId, userId, turn: e.generationId }, { status: "skipped", reason: "the reply was stopped" });
        return this.run(e.chatId, userId, (core, observed) => {
          core.sync(observed);
          // The kind the stopped generation started as (a one-shot Re-narrate's) is the engine run's.
          const kind = core.journal.pending[e.generationId]?.kind ?? (halt ? KIND[halt.type] : "normal");
          core.stopped({ generationId: e.generationId, content: e.content }, observed);
          if (halt && userId) void this.engine(e.chatId, userId, halt, kind);
        });
      }),
    );
    this.registerGuard();
  }

  /**
   * A user's guard wait, as their settings read (Settings → Timeouts), within Lumiverse's range. The
   * guard is one registration for every user, so it asks for the longest any of them set.
   */
  guardBudget(userId: UserId, limit: Limit): void {
    this.guardWait.set(userId, hostBound(HOST_LIMITS.contextHandler, limit));
    if (this.guardTimeout > 0) this.registerGuard();
  }

  /**
   * Registers the guard again when its wait changes (the host replaces a registration); before any
   * user's settings are read, it asks for Lumiverse's longest. The host replaces it inside the handler
   * list its chain walks, which would skip the next extension's handler or run this one twice, so
   * while a generation or a call of the guard is under way the change waits for them.
   */
  private registerGuard(): void {
    const timeout = this.guardWait.size === 0 ? HOST_LIMITS.contextHandler.maxMs : Math.max(...this.guardWait.values());
    if (timeout === this.guardTimeout || (this.guardTimeout > 0 && (this.generating.size > 0 || this.guarding > 0))) return;
    this.guardTimeout = timeout;
    this.host.registerContextHandler(async (input, signal) => {
      this.guarding++;
      try {
        return await this.guard(input, signal);
      } finally {
        this.guarding--;
      }
    }, { timeoutMs: timeout, required: this.host.capabilities.required });
  }

  /** A generation ended or stopped: the turn it took gives the book back, and a registration that waited for the host's chain goes ahead once none is under way. */
  private generationOver(chatId: ChatId, generationId: string): void {
    this.generating.delete(generationId);
    this.release(chatId, generationId);
    if (this.guardTimeout > 0) this.registerGuard();
  }

  // ------------------------------------------------------------------ engine first (DESIGN §5.1)

  /**
   * The guard, the one context handler: it looks, in memory, whether the engine prepared this
   * generation. A chat without a world goes on as it is. A dry run and a type the engine doesn't play
   * go on as they are, with nothing an earlier turn left in the book; Impersonate goes on from a book
   * that holds no engine section. Any other generation goes on only when the engine prepared it, for
   * its type, on the chain it stands on and the journal as it is; else the guard stops it, and its
   * stop starts the engine run, which starts it again when done.
   */
  private async guard(input: ContextHandlerInput, signal: AbortSignal): Promise<ContextVerdict> {
    if (input.dryRun || input.generationType === "other") return this.look(input);
    const gate = await this.gateFor(input.chatId, input.userId);
    if (!gate) return "go";
    const type = input.generationType;
    const started = this.started.get(input.chatId) ?? null;
    if (started) {
      this.answered.add(started.generationId);
      if (this.answered.size > 1024) this.answered.delete(this.answered.values().next().value ?? "");
    }
    if (type === "impersonate") return this.impersonate(input.chatId, gate, started, signal);
    if (!this.host.capabilities.cancel) {
      this.diag?.failed({ chatId: input.chatId, userId: input.userId, turn: started?.generationId ?? null }, "pre", "guard", CANNOT_STOP);
      return "go";
    }
    const p = gate.prepared;
    if (p && started && this.fresh(input.chatId, gate, p, type, started)) {
      const filled = await this.fill(input.chatId, gate, p, started.generationId, signal);
      if (filled !== "moved") return filled;
    }
    const id = `engine-${crypto.randomUUID()}`;
    gate.halt = { id, generationId: started?.generationId ?? null, type, target: isSwipe(type) ? (started?.targetMessageId ?? null) : null, connectionId: input.connectionId, ...(input.frontendSessionId ? { session: input.frontendSessionId } : {}) };
    this.diag?.begin({ chatId: input.chatId, userId: input.userId, turn: id }, STEP_LABEL.engine);
    return "cancel";
  }

  /** Whether the engine prepared this generation: one of its type (a swipe's is a regenerate's), on the same target, chain and journal, that no generation took yet. */
  private fresh(chatId: ChatId, gate: Gate, p: Prepared, type: HostGenerationType, started: GenerationStartedEvent): boolean {
    if (p.generationId !== null || !(p.type === type || (isSwipe(p.type) && isSwipe(type)))) return false;
    if (isSwipe(type) && started.targetMessageId !== p.target) return false;
    return this.changedSince(chatId, gate, p) === null;
  }

  /**
   * What changed since a prepared turn was made (DESIGN §5.1), in the chat's words: its chain, the
   * journal, or one of the other inputs; null when nothing did.
   */
  private changedSince(chatId: ChatId, gate: Gate, p: Prepared): string | null {
    if (gate.mirror === null || chainStamp(gate.mirror, p.type, p.target) !== p.stamp) return "a message of the chat was sent, edited, swiped or deleted";
    if (p.epoch !== gate.epoch) return "a change was made to the chat's world (a fix, a confirmed change, detail opened)";
    const now = this.hooks?.inputs(chatId, gate.userId) ?? p.inputs;
    const input = TURN_INPUT_NAMES.find((name) => now[name] !== p.inputs[name]);
    return input ? TURN_INPUTS[input] : null;
  }

  /**
   * A turn the engine prepared that no generation took goes the moment anything it was made from
   * changes (DESIGN §5.1): its entries are emptied, and the next generation runs the engine again.
   * Age alone never makes it stale. One kept from a failed reply goes quietly: nothing asked for its
   * reply again, so nothing says that reply didn't start, and the chat just loses its retry card.
   */
  private dropIfStale(chatId: ChatId): void {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    const changed = gate && p && p.generationId === null ? this.changedSince(chatId, gate, p) : null;
    if (!gate || !p || changed === null) return;
    gate.prepared = null;
    if (p.kept === null) this.notStarted(chatId, gate.userId, p, `${changed} after the engine ran and before the reply started`);
    else this.hooks?.changed(chatId, gate.userId);
    this.drop(chatId, gate.userId, p);
  }

  /**
   * A generation is over (DESIGN §5.1): `ended` is how it ended, null for a stop. When it took a
   * prepared turn and its reply failed (it ended in error, or a reply other than a Continue came back
   * empty), the turn is kept for the retry as it was prepared: the player's own Regenerate or swipe
   * takes it, writing the same sections and adopting the same plan, with no engine run. It is kept
   * under the failed generation's id, which is what the runtime's state for the turn goes by now. A
   * new reply that left its message (empty, or what streamed before the error) is retried as a
   * Regenerate of that message, which is what Lumiverse makes of a retry once the chat ends with it,
   * on the same chain. Anything else lets the turn go. Returns how the reply failed, kept or not.
   */
  private afterReply(chatId: ChatId, generationId: string, ended: GenerationEndedEvent | null): ReplyFailure | null {
    const gate = this.gates.get(chatId);
    const p = gate?.taken;
    if (!gate || !p || p.generationId !== generationId) return null;
    gate.taken = null;
    const failed: ReplyFailure | null = !ended ? null : ended.error ? "error" : p.type !== "continue" && ended.content.trim() === "" ? "empty" : null;
    // A turn the engine prepared since, or a run it was asked for, comes first.
    if (failed === null || gate.prepared !== null || gate.halt !== null) return failed;
    const started = this.started.get(chatId);
    const message = started?.generationId === generationId ? started.targetMessageId : null;
    const left = p.type === "normal" && message !== null && gate.mirror?.some((m) => m.id === message) === true;
    gate.prepared = { ...p, id: generationId, generationId: null, writing: null, holder: null, kept: failed, ...(left ? { type: "regenerate" as const, target: message } : {}) };
    // What the reply's end itself changed, such as an edit it saved, drops it at once.
    this.dropIfStale(chatId);
    return failed;
  }

  /**
   * Text for a reply that came back empty, arriving after it (DESIGN §5.1): Lumiverse saving it late,
   * or the player writing it in. Its turn is still kept for a retry, so that text is the reply the
   * turn waits for: the turn is taken for it as a retry takes it, with no engine call and no prompt,
   * and the text is read and committed with the turn's plan, so the turn plays once. Only while the
   * kept turn is fresh and its message the chat's last. True when it was taken; false, with nothing
   * done, when no kept turn waits for this message, so the edit is an assistant edit as ever (L38).
   */
  private lateReply(chatId: ChatId, userId: UserId | null, message: HostMessage): boolean {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    const text = message.swipes[message.swipeId] ?? message.content;
    if (!gate || !p || !userId || gate.userId !== userId || p.kept !== "empty" || p.generationId !== null || p.target !== message.id || message.isUser || text.trim() === "") return false;
    if (gate.mirror?.at(-1)?.id !== message.id || this.changedSince(chatId, gate, p) !== null) return false;
    const generationId = `late-${crypto.randomUUID()}`;
    p.generationId = generationId;
    gate.prepared = null;
    const at = { chatId, userId, turn: generationId };
    void this.run(chatId, userId, async (core, observed) => {
      const saved = observed.find((m) => m.id === message.id);
      this.diag?.begin(at, STEP_LABEL.read);
      // Begun before the chat is synced, so the text is this turn's save, not an edit of the message.
      core.started({ generationId, kind: p.turn?.kind ?? KIND[p.type], targetMessageId: message.id, targetSwipeId: saved?.swipeId ?? message.swipeId }, observed);
      if (p.turn && !core.adopt(generationId, p.turn)) this.diag?.failed(at, "plan", "plan", "the reply's text couldn't take the prepared plan, so this turn commits without it");
      core.saved(generationId);
      core.sync(observed);
      await this.hooks?.adopted(chatId, userId, p.id, generationId);
      await this.commitReply(core, observed, chatId, userId, generationId, message.id, saved ? (saved.swipes[saved.swipeId] ?? text) : text);
    });
    return true;
  }

  /**
   * A saved reply's read and commit (DESIGN §5.1 step 5): the post phase reads its text (a Continue
   * only what it added, L13), the turn commits with what the read prepared, then what follows a
   * commit runs. A read Cancel stopped commits as stopped, as a failed generation does: the reply
   * stands unread, nothing its calls answered applies, and the reply's Retry read reads it again.
   */
  private async commitReply(core: LedgerCore, observed: ChainMessage[], chatId: ChatId, userId: UserId | null, generationId: string, messageId: MessageId | undefined, content: string): Promise<void> {
    const at = userId ? { chatId, userId, turn: generationId } : null;
    const p = core.journal.pending[generationId];
    const swipeId = p?.swipeId ?? observed.find((m) => m.id === messageId)?.swipeId ?? 0;
    const flight = this.flight(chatId);
    const turn = p && messageId && userId ? { chatId, userId, core, observed, generationId, messageId, swipeId, kind: p.kind, signal: flight.signal } : null;
    const diag = at && turn ? this.diag : null;
    if (at && diag) diag.begin(at, STEP_LABEL.read);
    try {
      if (this.hooks && turn && p && p.kind !== "impersonate") {
        const hooks = this.hooks;
        const text = p.kind === "continue" ? (p.captured && content.length >= p.captured.len ? content.slice(p.captured.len) : "") : content;
        if (text !== "") await (at && diag ? diag.step(at, "read", "read", () => hooks.beforeCommit({ ...turn, content: text })) : hooks.beforeCommit({ ...turn, content: text }));
        else if (at && diag) diag.skipped(at, "read", "read", "the reply had no new text to read");
      }
      if (flight.signal.aborted) core.stopped({ generationId, content }, observed);
      else {
        core.ended({ generationId, ...(messageId ? { messageId } : {}), content }, observed);
        if (this.hooks && turn) {
          const hooks = this.hooks;
          await (at && diag ? diag.step(at, "memory", "memory", () => hooks.afterCommit({ ...turn, content })) : hooks.afterCommit({ ...turn, content }));
        }
      }
    } finally {
      this.landed(chatId, flight);
    }
    if (at && diag) diag.end(at, flight.signal.aborted ? { status: "skipped", reason: "you cancelled reading the reply; Retry read reads it again" } : undefined);
  }

  /** The turn kept from a reply that failed, while a retry can still take it (DESIGN §5.1): its id, and how that reply failed. */
  keptOf(chatId: ChatId): { turn: string; failed: ReplyFailure } | null {
    const p = this.gates.get(chatId)?.prepared;
    return p && p.kept !== null && p.generationId === null ? { turn: p.id, failed: p.kept } : null;
  }

  /**
   * Re-run the engine (DESIGN §5.1): the turn kept from a failed reply goes, so the next generation
   * runs the engine again. False when the chat keeps none, or `turn` names another. Callers have
   * checked the chat is the user's, as for every chip.
   */
  discardKept(chatId: ChatId, turn?: string): boolean {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    if (!gate || !p || p.kept === null || p.generationId !== null || (turn !== undefined && p.id !== turn)) return false;
    gate.prepared = null;
    this.drop(chatId, gate.userId, p);
    return true;
  }

  /**
   * A turn the engine prepared whose reply will never start (DESIGN §5.1): a finished run that
   * generates nothing is never silent. Its turn ends failed with why, and the chat's last message
   * gets the flag with a Retry, which runs the engine again and then the reply.
   */
  private notStarted(chatId: ChatId, userId: UserId, p: Prepared, why: string): void {
    const at = { chatId, userId, turn: p.id };
    this.diag?.end(at, { status: "failed", reason: `${why}, so nothing was generated` });
    void this.hooks?.failed({ chatId, userId, turn: p.id, step: "stale", reason: why }).catch((error: unknown) => this.diag?.error(at, "restart", error, "the chat wasn't told its reply didn't start"));
  }

  /** The user's settings or preset changed (`TurnHooks.inputs`): each of their chats' waiting turns is checked. */
  inputsChanged(userId: UserId): void {
    for (const [chatId, gate] of [...this.gates]) if (gate.userId === userId) this.dropIfStale(chatId);
  }

  /**
   * A page said which chat it shows and whether that is on screen (hello, resync, `lre.page`; DESIGN
   * §5.1). A waiting reply whose page stops showing its chat goes to a page that shows it.
   */
  page(session: string, userId: UserId, chatId: ChatId | null, viewing: boolean): void {
    this.pages.delete(session);
    this.pages.set(session, { userId, chatId, viewing });
    if (this.pages.size > 1024) this.pages.delete(this.pages.keys().next().value ?? "");
    for (const [id, gate] of this.gates) {
      const p = gate.prepared;
      if (p && p.generationId === null && p.holder === session && !this.shows(session, id)) this.handOver(id, gate.userId, p);
    }
  }

  /** Whether a page shows the chat on screen, as it last said; a page that said nothing yet is taken at the host's word. */
  private shows(session: string, chatId: ChatId): boolean {
    const page = this.pages.get(session);
    return page === undefined || (page.chatId === chatId && page.viewing);
  }

  /**
   * Whether a page has said it shows the chat on screen (hello, resync, `lre.page`). A page that
   * never said anything may have no engine frontend to start a reply (DESIGN §5.1), so one that has
   * said it shows the chat is asked instead.
   */
  private reports(session: string, chatId: ChatId): boolean {
    const page = this.pages.get(session);
    return page !== undefined && page.chatId === chatId && page.viewing;
  }

  /** The page that last said it shows the chat on screen, or null. */
  private viewerOf(chatId: ChatId, userId: UserId): string | null {
    let last: string | null = null;
    for (const [session, page] of this.pages) if (page.userId === userId && page.chatId === chatId && page.viewing) last = session;
    return last;
  }

  /** A waiting reply's page no longer shows its chat or closed: the claim goes to a page that shows it, else to the next one that opens it. */
  private handOver(chatId: ChatId, userId: UserId, p: Prepared): void {
    p.holder = this.viewerOf(chatId, userId);
    if (p.holder !== null) this.host.frontend.send(restartPush(chatId, p), userId, p.holder);
    else if (this.diag) this.diag.rest({ chatId, userId }, STEP_LABEL.restart ?? "Ready; reopen the chat to continue");
  }

  /**
   * A frontend said hello to the chat, or resynced: a turn the engine prepared that no generation
   * took yet is asked for again (DESIGN §5.1), so a page that slept through the first ask starts it.
   * Only the page holding the turn's claim is asked. A page showing the chat takes the claim when
   * none holds it, or its holder hasn't said it shows the chat (it went elsewhere, or never said
   * anything, as a page without the engine's frontend doesn't); any other page's activity line says
   * the reply already started elsewhere.
   */
  askAgain(chatId: ChatId, userId: UserId, session?: string): void {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    // A turn kept from a failed reply waits for the player's retry: the engine never regenerates on its own.
    if (!gate || gate.userId !== userId || !p || p.generationId !== null || p.kept !== null) return;
    // A host that names no page can't hold a claim: every page of the user's is asked.
    if (session === undefined || !this.host.capabilities.sessions) {
      this.host.frontend.send(restartPush(chatId, p), userId);
      return;
    }
    const here = this.shows(session, chatId);
    if (here && p.holder !== session && (p.holder === null || !this.reports(p.holder, chatId))) p.holder = session;
    if (p.holder === session) this.host.frontend.send(restartPush(chatId, p), userId, session);
    else if (here) this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.activity", chatId, activity: { chatId, turn: p.id, state: "running", label: STEP_LABEL.elsewhere ?? "Already started in another window", since: Date.now() } }, userId, session);
  }

  /**
   * A page asked to start a prepared reply claims it before it starts it (`lre.restart`): yes only to
   * the page holding the turn, while no generation has taken it. A page that wakes with an ask the
   * claim has since passed on from is told no, so the reply starts once.
   */
  claimRestart(chatId: ChatId, userId: UserId, session: string | undefined, turn: string): boolean {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    if (!gate || gate.userId !== userId || !p || p.id !== turn || p.generationId !== null || p.kept !== null) return false;
    return !this.host.capabilities.sessions || session === undefined || p.holder === session;
  }

  /**
   * A page disconnected: it shows nothing now, and a waiting reply whose claim it held goes to a
   * page that shows its chat, else to the next page that opens it (`askAgain`).
   */
  private sessionClosed(session: string, userId: UserId | null): void {
    this.pages.delete(session);
    for (const [chatId, gate] of this.gates) {
      const p = gate.prepared;
      if (!p || p.generationId !== null || p.holder !== session || (userId !== null && gate.userId !== userId)) continue;
      this.handOver(chatId, gate.userId, p);
    }
  }

  /** The chat's guard state, for a world chat; its world is read from the chat's metadata the first time. */
  private async gateFor(chatId: ChatId, userId: UserId): Promise<Gate | null> {
    const known = this.gates.get(chatId);
    if (known) return known.userId === userId ? known : null;
    if (this.notWorld.has(`${userId}\u0000${chatId}`) || !this.hooks) return null;
    const worldId = await this.hooks.worldOf(chatId, userId);
    if (!worldId) return null;
    const raced = this.gates.get(chatId);
    if (raced) return raced.userId === userId ? raced : null;
    const gate: Gate = { userId, worldId, mirror: null, epoch: 0, halt: null, prepared: null, taken: null };
    this.gates.set(chatId, gate);
    for (const [id, g] of this.gates) {
      if (this.gates.size <= OPEN_CHATS_CAP * 8) break;
      if (id !== chatId && !g.prepared && !g.halt && !g.taken) this.gates.delete(id);
    }
    return gate;
  }

  /** The generation the guard stopped, if this is it; it is handed out once. */
  private haltOf(chatId: ChatId, generationId: string): Halt | null {
    const gate = this.gates.get(chatId);
    const halt = gate?.halt;
    if (!gate || !halt || (halt.generationId !== null && halt.generationId !== generationId)) return null;
    gate.halt = null;
    return halt;
  }

  /**
   * Impersonate writes the player's next message: it runs without the engine, from a book that holds
   * no engine section, so no mind or secret and nothing of another turn reaches it (DESIGN §5.1). It
   * takes the world's book for its prompt (`claim`), then empties whatever an earlier turn left there
   * (a restart, a clear the host refused), and gives the book back once its prompt is assembled.
   * Sections that can't be emptied stop it, and the chat says why.
   */
  private async impersonate(chatId: ChatId, gate: Gate, started: GenerationStartedEvent | null, signal: AbortSignal): Promise<ContextVerdict> {
    const owner = started?.generationId ?? `impersonate-${crypto.randomUUID()}`;
    if (!(await this.claim(gate.worldId, chatId, owner, "impersonate", { chatId, userId: gate.userId }, signal))) return "cancel";
    try {
      await this.hooks?.vacate(chatId, gate.userId);
    } catch (error) {
      this.letGo(gate.worldId, owner);
      return this.stale(chatId, gate.userId, started?.generationId ?? null, error);
    }
    // Held until its prompt is assembled or it ends; one no event named, or that ended while the
    // guard waited, holds nothing.
    if (!started || !this.generating.has(owner)) this.letGo(gate.worldId, owner);
    return "go";
  }

  /**
   * A dry run (a prompt preview, a token count) and a type the engine doesn't play go on as they are
   * and change no turn (DESIGN §5.1): while no turn holds the world's book, what an earlier one left
   * there (a restart, a clear the host refused) is emptied first, so they hold none of it. Sections
   * that can't be emptied stop them, and the chat says why.
   */
  private async look(input: ContextHandlerInput): Promise<ContextVerdict> {
    const gate = await this.gateFor(input.chatId, input.userId);
    if (!gate || !this.hooks || this.leases.has(gate.worldId)) return "go";
    const owner = `look-${crypto.randomUUID()}`;
    this.leases.set(gate.worldId, { chatId: input.chatId, owner, kind: "look", moved: Promise.withResolvers<void>() });
    try {
      await this.hooks.vacate(input.chatId, input.userId);
      return "go";
    } catch (error) {
      return this.stale(input.chatId, input.userId, null, error);
    } finally {
      this.letGo(gate.worldId, owner);
    }
  }

  /**
   * The book still holds an earlier turn's sections and the host won't empty them: the generation
   * stops rather than go out with them (DESIGN §6.4), and the chat says why and what to do.
   */
  private stale(chatId: ChatId, userId: UserId, generationId: string | null, error: unknown): ContextVerdict {
    const reason = messageOf(error);
    this.diag?.failed({ chatId, userId, turn: generationId }, "pre", "guard", `an earlier turn's sections couldn't be emptied, so nothing was generated: ${reason}`);
    void this.hooks?.failed({ chatId, userId, turn: "clear", step: "clear", reason }).catch((e: unknown) => this.diag?.error({ chatId, userId, turn: generationId }, "guard", e, "the flag wasn't shown"));
    return "cancel";
  }

  /** The generation the guard let through takes the prepared plan; what the engine run recorded follows it. */
  private adopt(chatId: ChatId, userId: UserId, p: Prepared, generationId: string): Promise<void> {
    return this.run(chatId, userId, async (core) => {
      // A kept turn's failed reply closed its turn in diagnostics: its retry is one of its own there.
      if (p.kept !== null) this.diag?.begin({ chatId, userId, turn: generationId }, STEP_LABEL.reply ?? "Waiting for the reply…");
      if (p.turn && !core.adopt(generationId, p.turn)) this.diag?.failed({ chatId, userId, turn: p.kept === null ? p.id : generationId }, "plan", "plan", "the reply's generation couldn't take the prepared plan, so this turn commits without it");
      await this.hooks?.adopted(chatId, userId, p.id, generationId);
      if (p.kept === null) this.diag?.rename(chatId, p.id, generationId);
      this.diag?.rest({ chatId, userId }, STEP_LABEL.reply ?? "Waiting for the reply…");
    });
  }

  /** A generation reached its prompt in a world chat without the guard's answer: it runs without the engine, and the chat is told. */
  private unguarded(chatId: ChatId, userId: UserId | null, generationId: string): void {
    if (!userId || this.answered.has(generationId) || !(this.gates.has(chatId) || this.chats.has(chatId))) return;
    this.diag?.failed({ chatId, userId, turn: generationId }, "pre", "guard", "the guard didn't answer for this generation, so it runs without the engine's sections");
  }

  /**
   * A generation's prompt is assembled, or it ended or stopped: an Impersonate gives the book back,
   * and the turn a reply took gives it back with its entries emptied (DESIGN §6.4). That turn is
   * held as taken until its reply's end says whether it is kept for a retry (`afterReply`).
   */
  private release(chatId: ChatId, generationId: string): void {
    this.answered.delete(generationId);
    this.giveBack(generationId);
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    if (!gate || !p || p.generationId !== generationId) return;
    gate.prepared = null;
    gate.taken = p;
    this.drop(chatId, gate.userId, p);
  }

  /** The book an Impersonate held for its prompt goes back, found by its generation (its chat's guard state may be gone). */
  private giveBack(generationId: string): void {
    for (const [worldId, lease] of this.leases) if (lease.owner === generationId) this.letGo(worldId, generationId);
  }

  /**
   * A turn no generation will take any more: its entries are emptied now, off the chat's queue, so
   * a run of the chat waiting for the book behind it can't wait on work queued after that run.
   */
  private drop(chatId: ChatId, userId: UserId, p: Prepared): void {
    this.outstanding++;
    void this.unfill(chatId, userId, p).finally(() => this.outstanding--);
  }

  /** Empties and switches off what a turn's guard wrote, once that write is done, then lets the world's book go. A turn no generation took wrote nothing. */
  private async unfill(chatId: ChatId, userId: UserId, p: Pick<Prepared, "id" | "generationId" | "worldId" | "delivered" | "writing">): Promise<void> {
    try {
      if (p.writing) {
        await p.writing;
        await this.hooks?.clear(chatId, userId, p.delivered);
      }
    } catch (error) {
      this.diag?.error({ chatId, userId, turn: p.generationId ?? p.id }, "sections", error, "the engine's entries weren't switched off; no prompt goes out with them until they are");
    } finally {
      this.letGo(p.worldId, p.id);
    }
  }

  /**
   * The guard of the generation that takes a prepared turn writes its sections (DESIGN §6.4), so the
   * book holds them only from here until that prompt is assembled. It takes the book first, then the
   * write checks that what the placement was decided from still holds: `moved` when the preset the
   * host generates the chat with, or the book's Positions, changed since the engine run, and the
   * engine runs again. A write the host refuses stops the generation, and the chat says why.
   */
  private async fill(chatId: ChatId, gate: Gate, p: Prepared, generationId: string, signal: AbortSignal): Promise<ContextVerdict | "moved"> {
    p.generationId = generationId;
    const userId = gate.userId;
    if (!(await this.claim(gate.worldId, chatId, p.id, "turn", { chatId, userId }, signal))) {
      // The host stopped waiting: no prompt is assembled for it.
      gate.prepared = null;
      this.letGo(gate.worldId, p.id);
      return "cancel";
    }
    const writing = this.hooks ? this.hooks.fill(chatId, userId, p.delivered) : Promise.resolve<"filled" | "moved">("filled");
    p.writing = writing.then(
      () => undefined,
      () => undefined,
    );
    try {
      if ((await writing) === "moved") {
        gate.prepared = null;
        this.letGo(gate.worldId, p.id);
        this.diag?.end({ chatId, userId, turn: p.id }, { status: "skipped", reason: "the preset this chat generates with changed after the engine ran; the engine runs again" });
        return "moved";
      }
    } catch (error) {
      gate.prepared = null;
      this.drop(chatId, userId, p);
      const reason = messageOf(error);
      this.diag?.end({ chatId, userId, turn: p.id }, { status: "failed", reason: `sections: ${reason}` });
      void this.hooks?.failed({ chatId, userId, turn: p.id, step: "sections", reason }).catch((e: unknown) => this.diag?.error({ chatId, userId, turn: p.id }, "guard", e, "the failure flag wasn't shown"));
      return "cancel";
    }
    void this.adopt(chatId, userId, p, generationId);
    return "go";
  }

  /**
   * The world's book for `owner` (DESIGN §6.4): it holds one owner's sections at a time, and only
   * while a prompt is assembled from it, so every hold is short. This chat's own earlier generation,
   * a reply or an Impersonate, gives way: Lumiverse runs one generation per chat at a time, so a newer
   * one here means it is over, though its end was never heard. Anything else holding the book (a
   * reply's guard writing it, another chat's prompt being assembled, an engine run placing its
   * entries, entries being emptied) is waited for, never taken over. False when the host stopped
   * waiting for the guard meanwhile.
   */
  private async claim(worldId: WorldId, chatId: ChatId, owner: string, kind: Lease["kind"], at: { chatId: ChatId; userId: UserId }, signal?: AbortSignal): Promise<boolean> {
    const gaveUp = signal ? new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })) : null;
    for (;;) {
      if (signal?.aborted) return false;
      const lease = this.leases.get(worldId);
      if (!lease) break;
      if (lease.owner === owner) return true;
      const holder = this.gates.get(lease.chatId);
      const p = holder?.prepared?.id === lease.owner ? holder.prepared : null;
      if (holder && p && p.generationId !== null && lease.chatId === chatId) {
        holder.prepared = null;
        await this.unfill(lease.chatId, holder.userId, p);
        continue;
      }
      if (lease.kind === "impersonate" && lease.chatId === chatId) {
        this.letGo(worldId, lease.owner);
        continue;
      }
      if (lease.chatId !== chatId) this.diag?.rest(at, STEP_LABEL.book ?? "Waiting for another chat of this world…");
      await (gaveUp ? Promise.race([lease.moved.promise, gaveUp]) : lease.moved.promise);
    }
    this.leases.set(worldId, { chatId, owner, kind, moved: Promise.withResolvers<void>() });
    return true;
  }

  /** `owner` gives the world's book back; anyone waiting for it looks again. */
  private letGo(worldId: WorldId, owner: string): void {
    const lease = this.leases.get(worldId);
    if (lease?.owner !== owner) return;
    this.leases.delete(worldId);
    lease.moved.resolve();
  }

  /**
   * The engine run (DESIGN §5.1), for a generation the guard stopped. On the chat's queue: the turn
   * is prepared, its pre phase, plan and plan phase run, and its sections go into the world's book;
   * then the frontend starts the generation again and the guard lets it through. A failed step stops
   * the run: nothing is generated, the book is emptied, and the chat says which step failed and why,
   * with a Retry.
   */
  private engine(chatId: ChatId, userId: UserId, halt: Halt, kind: GenerationKind): Promise<void> {
    const at = { chatId, userId, turn: halt.id };
    return this.run(chatId, userId, async (core, observed) => {
      const gate = this.gates.get(chatId);
      const hooks = this.hooks;
      if (!gate || !hooks) return;
      core.sync(observed);
      // The chain and journal the plan reads; anything that changes them before the restart makes it stale.
      gate.mirror = mirrorOf(observed);
      const epoch = gate.epoch;
      const inputs = hooks.inputs(chatId, userId);
      const stamp = chainStamp(gate.mirror, halt.type, halt.target);
      const earlier = gate.prepared;
      if (earlier) {
        gate.prepared = null;
        this.diag?.end({ chatId, userId, turn: earlier.id }, { status: "skipped", reason: "the chat changed before its reply; the engine ran again" });
        await this.unfill(chatId, userId, earlier);
      }
      const target = halt.target ? observed.find((m) => m.id === halt.target) : undefined;
      // A stopped Regenerate or swipe leaves its blank swipe (the frontend that started a swipe
      // removes it too, the same last swipe); the restart adds the new one in its place.
      const blank = target !== undefined && target.swipes.length > 1 && target.swipes.at(-1) === "";
      if (target && blank) {
        await this.host.chats.setSwipes(chatId, target.id, target.swipes.slice(0, -1), Math.min(target.swipeId, target.swipes.length - 2), userId).catch((error: unknown) => this.diag?.error(at, "restart", error, "the stopped Regenerate's empty swipe stays"));
      }
      const head = observed.findLast((m) => !m.isUser);
      const swipeId = target ? target.swipes.length - (blank ? 1 : 0) : halt.type === "continue" ? (head?.swipeId ?? null) : 0;
      core.prepare({ generationId: halt.id, kind, targetMessageId: target?.id ?? null, targetSwipeId: swipeId }, observed);
      const flight = this.flight(chatId);
      const signal = flight.signal;
      // A cancel between steps ends the run there; one inside a step aborts its calls through `signal`.
      const going = (): void => {
        if (signal.aborted) throw new TurnCancelled();
      };
      const step = <T>(phase: "pre" | "plan" | "prose" | "sections", fn: () => Promise<T>): Promise<T> => (this.diag ? this.diag.step(at, phase, phase, fn) : fn());
      let delivered: Delivered | null = null;
      let claimed = false;
      try {
        // Lumiverse starts only the last reply again, so a reply for an earlier message (Edit and Send
        // in place, a swipe of an earlier reply) is refused before any model call, never sent to the last one.
        if (halt.target !== null && observed.at(-1)?.id !== target?.id) throw new EngineFailure("target", NOT_LAST_REPLY);
        const pre = await step("pre", () => hooks.beforePlan({ chatId, userId, core, observed, generationId: halt.id, connectionId: halt.connectionId, runKey: `${stamp}\u0000${epoch}`, signal }));
        going();
        // The chat now asks the player something (a claim under Ask first, DESIGN §9.4, or a preview
        // gate, §5.1): the run waits on the answer, with nothing generated and no restart; the answer's
        // Regenerate runs it again.
        const waiting = (outcome: PreOutcome): void => {
          core.take(halt.id);
          this.diag?.end(at, { status: "skipped", reason: outcome.waiting });
        };
        if (pre) return waiting(pre);
        await step("plan", async () => core.plan(halt.id, observed, false));
        const held = await step("prose", () => hooks.afterPlan({ chatId, userId, core, observed, generationId: halt.id, signal }));
        going();
        if (held) return waiting(held);
        this.failedStep(at);
        // The book is taken only while the run makes and places its entries: it writes no section.
        // A cancel while it waits for another chat's book ends the run there.
        if (!(await this.claim(gate.worldId, chatId, halt.id, "turn", at, signal))) throw new TurnCancelled();
        claimed = true;
        try {
          delivered = await step("sections", () => hooks.deliver({ chatId, userId, core, observed, generationId: halt.id }));
        } finally {
          this.letGo(gate.worldId, halt.id);
        }
        // A cancel while the sections were made ends the run before it prepares the turn.
        going();
        this.failedStep(at);
      } catch (error) {
        core.take(halt.id);
        if (claimed) this.letGo(gate.worldId, halt.id);
        // Cancelled: its own end, not a failure. No flag and no Retry chip; the player's message
        // stays, so Regenerate (or sending again) runs the turn anew.
        if (signal.aborted) {
          this.diag?.end(at, { status: "skipped", reason: "you cancelled the turn; nothing was generated" });
          return;
        }
        const failure = error instanceof EngineFailure ? error : new EngineFailure("engine", messageOf(error));
        this.diag?.end(at, { status: "failed", reason: `${failure.step}: ${failure.message}` });
        await hooks.failed({ chatId, userId, turn: halt.id, step: failure.step, reason: failure.message }).catch((e: unknown) => this.diag?.error(at, "engine", e, "the failure flag wasn't shown"));
        return;
      } finally {
        this.landed(chatId, flight);
      }
      const turn = core.take(halt.id);
      const as = restartAs(halt.type, observed);
      // The page to start it: the one the stopped generation ran for when it shows the chat, unless it
      // never said so and another page did; else the page that last said it shows the chat; with none,
      // the first page to show the chat claims it (`askAgain`).
      const viewer = this.viewerOf(chatId, userId);
      const holder = halt.session !== undefined && (this.reports(halt.session, chatId) || (viewer === null && this.shows(halt.session, chatId))) ? halt.session : viewer;
      const prepared: Prepared = { id: halt.id, type: halt.type, target: target?.id ?? null, turn: turn?.planned ? turn : null, stamp, epoch, inputs, worldId: gate.worldId, delivered, writing: null, as, holder, generationId: null, kept: null };
      gate.prepared = prepared;
      // Anything that changed while the engine ran makes the turn stale at once: nothing is generated.
      this.dropIfStale(chatId);
      if (this.gates.get(chatId)?.prepared !== prepared) return;
      // A page asked to start it starts it at once; "reopen the chat" is for when no page shows the chat.
      this.diag?.rest(at, as === "send" ? (STEP_LABEL.ready ?? "Ready: press Send for the reply") : holder !== null || !this.host.capabilities.sessions ? (STEP_LABEL.reply ?? "Waiting for the reply…") : (STEP_LABEL.restart ?? "Ready; reopen the chat to continue"));
      // A host that names no page asks every page.
      if (prepared.holder !== null) this.host.frontend.send(restartPush(chatId, prepared), userId, prepared.holder);
      else if (!this.host.capabilities.sessions) this.host.frontend.send(restartPush(chatId, prepared), userId);
    });
  }

  /** Stops the engine run at its first failed step, with that step's reason. */
  private failedStep(at: { chatId: ChatId; userId: UserId; turn: string }): void {
    const failure = this.diag?.failure(at);
    if (failure) throw new EngineFailure(failure.step, failure.reason);
  }

  /** Stops the chat's engine run or reply read under way (DESIGN §5.1), when the chat is `userId`'s: false when nothing of theirs runs. */
  cancel(chatId: ChatId, userId: UserId): boolean {
    const flight = this.inFlight.get(chatId);
    if (!flight || flight.signal.aborted || this.gates.get(chatId)?.userId !== userId) return false;
    flight.abort(new TurnCancelled());
    return true;
  }

  /** Whether Cancel can stop something in the chat now: an engine run or reply read under way, not yet cancelled (the activity line's Cancel shows by it). */
  cancellable(chatId: ChatId): boolean {
    const flight = this.inFlight.get(chatId);
    return flight !== undefined && !flight.signal.aborted;
  }

  private flight(chatId: ChatId): AbortController {
    const flight = new AbortController();
    this.inFlight.set(chatId, flight);
    return flight;
  }

  private landed(chatId: ChatId, flight: AbortController): void {
    if (this.inFlight.get(chatId) === flight) this.inFlight.delete(chatId);
  }

  /** A message event's message, into the chat's mirror: the guard's chain (DESIGN §5.1). */
  private mirror(chatId: ChatId, message: HostMessage): void {
    const list = this.gates.get(chatId)?.mirror;
    if (!list) return;
    const entry: Mirrored = { id: message.id, isUser: message.isUser, swipeId: message.swipeId, content: contentId(message.swipes[message.swipeId] ?? message.content).hash };
    const at = list.findIndex((e) => e.id === message.id);
    if (at >= 0) list[at] = entry;
    else list.splice(Math.max(0, Math.min(message.index, list.length)), 0, entry);
    this.dropIfStale(chatId);
  }

  private unmirror(chatId: ChatId, messageId: MessageId): void {
    const list = this.gates.get(chatId)?.mirror;
    const at = list ? list.findIndex((e) => e.id === messageId) : -1;
    if (!list || at < 0) return;
    list.splice(at, 1);
    this.dropIfStale(chatId);
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** A user write from the frontend (chip confirm, ✎ fix, materialization, marker, Keep/Discard, Re-read); a turn the engine prepared before it is stale. */
  async write(chatId: ChatId, userId: UserId, w: HeldWrite): Promise<WriteResult> {
    const gate = this.gates.get(chatId);
    if (gate) {
      gate.epoch++;
      this.dropIfStale(chatId);
    }
    let result: WriteResult = { applied: false, pending: false, reason: "not a world chat" };
    await this.run(
      chatId,
      userId,
      (core, observed) => {
        core.sync(observed);
        result = core.write(w, observed);
      },
      w,
    );
    return result;
  }

  /** Restart recovery and chat open: classify against the snapshot, and close the windows a stopped backend left open (never a turn under way here). */
  async open(chatId: ChatId, userId: UserId): Promise<void> {
    await this.run(chatId, userId, (core, observed) => {
      core.sync(observed);
      const slot = this.chats.get(chatId);
      const gone = new Set([...(slot?.leftOpen ?? [])].filter((id) => !this.generating.has(id)));
      if (gone.size === 0) return;
      core.restart(observed, gone);
      for (const id of gone) slot?.leftOpen.delete(id);
    });
  }

  /** The current core of a chat, for reads (state push, tests). */
  async core(chatId: ChatId, userId: UserId): Promise<LedgerCore | null> {
    return (await this.slot(chatId, userId))?.core ?? null;
  }

  /**
   * The chat's state as the narrator sees it now (`renderState`), for the World Info interceptor
   * (DESIGN §6.1). Between the guard letting a generation take the prepared turn and that turn's
   * `adopt`, the journal holds no planned turn, so the prepared one is folded in: the prompt being
   * assembled is that generation's, and a secret its own events reveal reaches it. Null for a chat
   * that isn't open as a world chat.
   */
  async narratorState(chatId: ChatId, userId: UserId): Promise<{ state: WorldState; world: WorldDoc } | null> {
    const core = await this.core(chatId, userId);
    if (!core) return null;
    const observed = toChain(await this.host.chats.messages(chatId, userId));
    const prepared = this.gates.get(chatId)?.prepared;
    const adopted = Object.values(core.journal.pending).some((p) => p.planned);
    return prepared?.turn && prepared.generationId !== null && !adopted ? core.renderPlanned(observed, prepared.turn) : core.renderState(observed);
  }

  /** Drops a chat's cached slot, guard state and copy of its messages (after attaching a world, or detaching one); a turn it prepared gives its entries back. */
  forget(chatId: ChatId): void {
    this.chats.delete(chatId);
    for (const key of [...this.notWorld]) if (key.endsWith(`\u0000${chatId}`)) this.notWorld.delete(key);
    this.forgetMessages(chatId);
    const gate = this.gates.get(chatId);
    this.gates.delete(chatId);
    const p = gate?.prepared;
    if (gate && p) this.drop(chatId, gate.userId, p);
  }

  /** The turn the engine prepared for the chat, if any: its id, and the generation that took it (DESIGN §5.1). */
  preparedOf(chatId: ChatId): { id: string; generationId: string | null } | null {
    const p = this.gates.get(chatId)?.prepared;
    return p ? { id: p.id, generationId: p.generationId } : null;
  }

  /** Standing notices for the player about a chat (its journal was replaced, a record on a message was damaged), for the inspector's warnings. */
  notices(chatId: ChatId, userId: UserId): string[] {
    const key = `${userId}\u0000${chatId}`;
    const reset = this.resets.get(key);
    return [...(reset ? [reset] : []), ...(this.damaged.get(key) ?? [])];
  }

  /** The chain as the core sees it; a stored record skipped as malformed is logged and the player told (the inspector's warnings). */
  private observe(chatId: ChatId, userId: UserId, messages: readonly HostMessage[]): ChainMessage[] {
    return toChain(messages, (messageId, swipe) => {
      const key = `${userId}\u0000${chatId}`;
      const notices = this.damaged.get(key) ?? new Set<string>();
      const notice = `The engine record saved on message ${messageId} (swipe ${swipe}) is damaged, so it is ignored. If this chat's journal still holds that record, it is written back; otherwise that turn's world changes no longer apply.`;
      if (notices.has(notice) || notices.size >= 16) return;
      notices.add(notice);
      this.damaged.set(key, notices);
      if (this.damaged.size > 256) this.damaged.delete(this.damaged.keys().next().value ?? "");
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: ${notice}`, userId);
    });
  }

  /** Runs `op` on the chat's queue (reads that must see a settled core). */
  async with(chatId: ChatId, userId: UserId, op: Op): Promise<void> {
    await this.run(chatId, userId, op);
  }

  private onMessage(chatId: ChatId, userId: UserId | null, messageId: MessageId, kind: "sent" | "edited" | "deleted"): void {
    void this.run(chatId, userId, (core, observed) => {
      if (kind !== "deleted") this.markSaved(core, observed, messageId, kind);
      core.sync(observed);
    });
  }

  private onSwiped(chatId: ChatId, userId: UserId | null, messageId: MessageId, action: string, swipeId: number): void {
    void this.run(chatId, userId, (core, observed) => {
      if (action === "updated") this.markSaved(core, observed, messageId, "edited");
      core.sync(observed, action === "deleted" ? { messageId, swipeId } : undefined);
    });
  }

  /** A turn's reply save opens its P4 window: the target's edit, or a reply created at the end. */
  private markSaved(core: LedgerCore, observed: readonly ChainMessage[], messageId: MessageId, kind: "sent" | "edited"): void {
    const message = observed.find((m) => m.id === messageId);
    if (!message || message.isUser) return;
    for (const p of Object.values(core.journal.pending)) {
      if (p.messageId === messageId && kind === "edited") core.saved(p.generationId);
      else if (p.messageId === null && p.kind === "normal" && kind === "sent") core.saved(p.generationId, messageId);
    }
  }

  /** Slots being opened: concurrent first operations share one open (one core, one journal per chat). */
  private readonly opening = new Map<ChatId, Promise<ChatSlot | null>>();

  /** Chats known not to be world chats, per `user \0 chat` (a null for one user never answers another). */
  private readonly notWorld = new Set<string>();

  /**
   * The chat's slot for `userId`: a slot belongs to the user who opened it, and any other user
   * gets nothing. Host events without a user reach only an already-open slot.
   */
  private async slot(chatId: ChatId, userId: UserId | null): Promise<ChatSlot | null> {
    const known = this.chats.get(chatId);
    if (known) return userId === null || known.userId === userId ? known : null;
    if (!userId || this.notWorld.has(`${userId}\u0000${chatId}`)) return null;
    const pending = this.opening.get(chatId);
    if (pending) {
      const slot = await pending;
      return slot && slot.userId === userId ? slot : null;
    }
    const open = (async (): Promise<ChatSlot | null> => {
      const env = await this.resolveEnv(chatId, userId);
      if (!env) {
        this.notWorld.add(`${userId}\u0000${chatId}`);
        if (this.notWorld.size > 2048) this.notWorld.delete(this.notWorld.values().next().value ?? "");
        return null;
      }
      const raw = await this.host.storage.read(journalPath(chatId), userId);
      const { journal, reset } = decodeJournal(raw, chatId, env.run);
      // A damaged journal is set aside before the fresh one overwrites it, and the player is told (the inspector's warnings); one from another run is simply replaced.
      if (reset === "unreadable" || reset === "malformed") {
        const kept = await setAside(this.host, journalPath(chatId), userId, `chat ${chatId} journal`, reset);
        const where = kept ? `the damaged file is kept as ${kept}` : "the damaged file could not be kept";
        this.resets.set(`${userId}\u0000${chatId}`, `This chat's engine journal was ${reset}, so a fresh one was started (${where}). The records saved on messages still apply; edits, pauses and discards only the journal held may be gone.`);
        if (this.resets.size > 256) this.resets.delete(this.resets.keys().next().value ?? "");
      } else if (reset) this.host.log("warn", `[LumiRPEngine] chat ${chatId}: its journal was ${reset}; starting a fresh one (the chat's records still fold)`, userId);
      // Snapshots are a shortcut: a missing or unreadable file only means a full fold.
      const snapshots = ChatSnapshots.parse(await this.host.storage.read(snapshotsPath(chatId), userId).catch(() => null));
      // A stamped journal differs from the stored text, so the next persist writes it.
      const slot: ChatSlot = { core: new LedgerCore(journal, { ...env, snapshots }, this.folder), userId, queue: Promise.resolve(), written: reset ? null : raw, ops: 0, snapshots, reasserts: new Map(), leftOpen: new Set([...journal.windows, ...Object.keys(journal.pending)]) };
      // The revisions its folds will ask for are loaded before anyone folds it.
      await slot.core.prepareWorlds(this.observe(chatId, userId, await this.host.chats.messages(chatId, userId)));
      this.chats.set(chatId, slot);
      for (const [id, s] of this.chats) {
        if (this.chats.size <= OPEN_CHATS_CAP) break;
        if (id !== chatId && s.ops === 0 && !s.core.inFlight) this.chats.delete(id);
      }
      return slot;
    })();
    this.opening.set(chatId, open);
    try {
      return await open;
    } finally {
      this.opening.delete(chatId);
    }
  }

  /** Runs one operation on the chat's queue, then persists the journal and flushes metadata. `write` is a write the operation lands (its revision is loaded first). */
  private async run(chatId: ChatId, userId: UserId | null, op: Op, write?: HeldWrite): Promise<void> {
    this.outstanding++;
    try {
      const slot = await this.slot(chatId, userId);
      if (!slot) return;
      slot.ops++;
      slot.queue = slot.queue
        .then(async () => {
          // A kept read answers at once: the op gives way first, so a message waiting runs before its folds.
          await giveWay();
          const observed = this.observe(chatId, slot.userId, await this.host.chats.messages(chatId, slot.userId));
          await slot.core.prepareWorlds(observed, write);
          await op(slot.core, observed);
          await this.persist(chatId, slot);
          await this.flush(chatId, slot);
          this.hooks?.changed(chatId, slot.userId);
        })
        .catch((error: unknown) => {
          const text = `[LumiRPEngine] ledger ${chatId}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
          this.errors.push(text);
          this.host.log("error", text, slot.userId);
          this.diag?.error({ chatId, userId: slot.userId, turn: null }, "ledger", error);
        });
      await slot.queue;
      slot.ops--;
    } finally {
      this.outstanding--;
    }
  }

  /** Resolves once every queued ledger operation has finished. */
  async idle(): Promise<void> {
    while (this.outstanding > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /** The chat's fold snapshots, if it is open (tests compare snapshot-started folds). */
  snapshotsOf(chatId: ChatId): ChatSnapshots | undefined {
    return this.chats.get(chatId)?.snapshots;
  }

  private async persist(chatId: ChatId, slot: ChatSlot): Promise<void> {
    if (slot.snapshots.dirty) {
      slot.snapshots.dirty = false;
      const at = snapshotsPath(chatId);
      await this.host.storage.write(`${at}.tmp`, JSON.stringify(slot.snapshots), slot.userId);
      await this.host.storage.move(`${at}.tmp`, at, slot.userId);
    }
    const text = JSON.stringify(slot.core.journal);
    if (text === slot.written) return;
    const path = journalPath(chatId);
    await this.host.storage.write(`${path}.tmp`, text, slot.userId);
    await this.host.storage.move(`${path}.tmp`, path, slot.userId);
    slot.written = text;
  }

  /**
   * Writes the journal's ledgers into message metadata once no turn is in flight (DESIGN §5.1 step
   * 10). A ledger is compared and written as the metadata reads it back (`decodeLedger`), so a part
   * the reader drops never looks clobbered; a re-assert after another write that doesn't stick is
   * tried at most `REASSERTS_PER_LEDGER` times in a row for the same ledger.
   */
  private async flush(chatId: ChatId, slot: ChatSlot): Promise<void> {
    if (slot.core.inFlight) return;
    const messages = await this.host.chats.messages(chatId, slot.userId);
    const observed = this.observe(chatId, slot.userId, messages);
    const stored = new Map(observed.map((m) => [m.id, JSON.stringify(m.ledger)]));
    // A re-assert that stuck ends its run.
    for (const [id, r] of slot.reasserts) if (stored.get(id) === r.text) slot.reasserts.delete(id);
    for (const id of slot.core.dirty(observed)) {
      const message = messages.find((m) => m.id === id);
      const jm = slot.core.journal.messages[id];
      const ledger = jm && decodeLedger({ [LEDGER_NAMESPACE]: jm.ledger as unknown as JsonObject });
      if (!message || !jm || !ledger) continue;
      const text = JSON.stringify(ledger);
      if (jm.flushed) {
        // Flushed before and changed since (another writer, or a part the reader drops): re-assert unless it already reads back the same.
        if (stored.get(id) === text) continue;
        const prior = slot.reasserts.get(id);
        const count = prior?.text === text ? prior.count + 1 : 1;
        slot.reasserts.set(id, { text, count });
        if (count > REASSERTS_PER_LEDGER) {
          if (count === REASSERTS_PER_LEDGER + 1) this.host.log("warn", `[LumiRPEngine] chat ${chatId}: message ${id}'s engine data keeps being replaced; it is no longer rewritten until it changes (the journal keeps it)`, slot.userId);
          continue;
        }
      } else slot.reasserts.delete(id);
      // The host replaces the whole bag (G2): read-merge-write, keeping other writers' keys.
      await this.host.chats.writeMetadata(chatId, id, encodeLedger(message.metadata, ledger), slot.userId);
      slot.core.markFlushed(id);
    }
  }
}
