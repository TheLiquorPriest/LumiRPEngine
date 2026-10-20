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
import { PROTOCOL_VERSION, type GenerateAs } from "../shared/protocol";
import type { Limit } from "../shared/minds";
import { HOST_LIMITS, hostBound } from "../shared/timeouts";
import { validMarkerBody } from "../engine/events";
import type { ChainMessage, FoldSnapshot, SnapshotStore } from "../engine/ledger/chain";
import { emptyJournal, LedgerCore, type LedgerEnv } from "../engine/ledger/journal";
import type { LedgerFold } from "../engine/ledger/fold";
import { activeText, contentId } from "../engine/ledger/path";
import { giveWay } from "./give-way";
import type { ContextHandlerInput, ContextVerdict, GenerationStartedEvent, HostGenerationType, HostMessage, HostPort } from "./host";
import { setAside } from "./stored-json";
import type { Diagnostics } from "./diagnostics";
import { messageOf } from "./diagnostics";
import { CANNOT_STOP, STEP_LABEL } from "../shared/diagnostics";

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
}

/**
 * Async work around the core's synchronous steps (DESIGN §5.1): the engine run's pre phase, plan
 * phase and sections, and `extract` before the commit, run here inside the chat's queue, so the
 * core then folds their results as plain data. `afterCommit` collects chips; `changed` fires after
 * every operation.
 */
export interface TurnHooks {
  beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; connectionId: string | null; signal: AbortSignal }): Promise<void>;
  /** After the plan, before the reply: the plan-phase prose steps (DESIGN §5.2 brief, prose outline). */
  afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; signal: AbortSignal }): Promise<void>;
  /** The engine run's last step (DESIGN §6.4): the prepared turn's sections written into the world's book, switched on. */
  deliver(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string }): Promise<Delivered>;
  /** Empties and switches off what `deliver` filled. */
  clear(chatId: ChatId, userId: UserId, delivered: Delivered): Promise<void>;
  /** A generation took the prepared turn: what the engine run kept under its id is the generation's now, and an earlier failure's flag goes. */
  adopted(chatId: ChatId, userId: UserId, from: string, to: string): Promise<void>;
  /** The engine run failed and nothing was generated: the chat says which step and why, with a Retry. */
  failed(input: { chatId: ChatId; userId: UserId; turn: string; step: string; reason: string }): Promise<void>;
  /** The chat's world, read from its metadata alone (the guard's check); null when it isn't a world chat. */
  worldOf(chatId: ChatId, userId: UserId): Promise<WorldId | null>;
  beforeCommit(input: TurnContext): Promise<void>;
  afterCommit(input: TurnContext): Promise<void>;
  changed(chatId: ChatId, userId: UserId): void;
  /** A swipe or regenerate is a Re-run or a Re-narrate (P3; `settings.swipeDefault` or a one-shot choice). */
  kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind }): Promise<GenerationKind>;
}

/** What the engine run wrote into the world's book for a turn: the entries it switched on. */
export interface Delivered {
  bookId: string;
  entries: string[];
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

/** A turn the engine prepared for the chat's next generation of its type (DESIGN §5.1). */
interface Prepared {
  id: string;
  type: HostGenerationType;
  target: MessageId | null;
  /** The planned turn, out of the journal; null when it got no plan (a Continue, a turn under a pause). */
  turn: PendingTurn | null;
  /** The chain it was planned on (`chainStamp`) and the journal's epoch then. */
  stamp: string;
  epoch: number;
  worldId: WorldId;
  delivered: Delivered;
  /** The generation the guard let through with it; null until one came. */
  generationId: string | null;
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

/** How the frontend starts the generation again for a halted one of `type`; `send` when only the player can (a new reply after a reply). */
function restartAs(type: HostGenerationType, observed: readonly ChainMessage[]): GenerateAs {
  if (type === "normal") return observed.at(-1)?.isUser ? "regenerate" : "send";
  return type === "continue" ? "continue" : "regenerate";
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
  /** The latest generation the host started in each chat, as its event arrived: the guard's generation. */
  private readonly started = new Map<ChatId, GenerationStartedEvent>();
  /** The chat whose sections each world's book holds now, and how to wait for it to let go (DESIGN §6.8). */
  private readonly leases = new Map<WorldId, { chatId: ChatId; released: PromiseWithResolvers<void> }>();
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
      h.on("MESSAGE_SENT", (e, userId) => {
        this.mirror(e.chatId, e.message);
        this.onMessage(e.chatId, userId, e.message.id, "sent");
      }),
      h.on("MESSAGE_EDITED", (e, userId) => {
        this.mirror(e.chatId, e.message);
        this.onMessage(e.chatId, userId, e.message.id, "edited");
      }),
      h.on("MESSAGE_SWIPED", (e, userId) => {
        this.mirror(e.chatId, e.message);
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
      h.on("GENERATION_IN_PROGRESS", (e, userId) => this.unguarded(e.chatId, userId, e.generationId)),
      h.on("GENERATION_ENDED", (e, userId) => {
        this.generationOver(e.chatId, e.generationId);
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
          const p = core.journal.pending[e.generationId];
          const swipeId = p?.swipeId ?? observed.find((m) => m.id === e.messageId)?.swipeId ?? 0;
          const turn = p && e.messageId && userId ? { chatId: e.chatId, userId, core, observed, generationId: e.generationId, messageId: e.messageId, swipeId, kind: p.kind } : null;
          const diag = at && turn ? this.diag : null;
          if (at && diag) diag.begin(at, STEP_LABEL.read);
          if (this.hooks && turn && p && p.kind !== "impersonate") {
            const hooks = this.hooks;
            // A Continue reads only its suffix (L13): prepare that text.
            const text = p.kind === "continue" ? (p.captured && e.content.length >= p.captured.len ? e.content.slice(p.captured.len) : "") : e.content;
            if (text !== "") await (at && diag ? diag.step(at, "read", "read", () => hooks.beforeCommit({ ...turn, content: text })) : hooks.beforeCommit({ ...turn, content: text }));
            else if (at && diag) diag.skipped(at, "read", "read", "the reply had no new text to read");
          }
          core.ended({ generationId: e.generationId, ...(e.messageId ? { messageId: e.messageId } : {}), content: e.content }, observed);
          if (this.hooks && turn) {
            const hooks = this.hooks;
            await (at && diag ? diag.step(at, "memory", "memory", () => hooks.afterCommit({ ...turn, content: e.content })) : hooks.afterCommit({ ...turn, content: e.content }));
          }
          if (at && diag) diag.end(at);
        });
      }),
      h.on("GENERATION_STOPPED", (e, userId) => {
        this.generationOver(e.chatId, e.generationId);
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
    this.host.registerContextHandler(async (input) => {
      this.guarding++;
      try {
        return await this.guard(input);
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
   * The guard, the one context handler: it only looks, in memory, whether the engine prepared this
   * generation. A dry run, a type the engine doesn't play and a chat without a world go on as they
   * are; Impersonate goes on with no engine section in the book. Any other generation goes on only
   * when the engine prepared it, for its type, on the chain it stands on and the journal as it is;
   * else the guard stops it, and its stop starts the engine run, which starts it again when done.
   */
  private async guard(input: ContextHandlerInput): Promise<ContextVerdict> {
    if (input.dryRun || input.generationType === "other") return "go";
    const gate = await this.gateFor(input.chatId, input.userId);
    if (!gate) return "go";
    const type = input.generationType;
    const started = this.started.get(input.chatId) ?? null;
    if (started) {
      this.answered.add(started.generationId);
      if (this.answered.size > 1024) this.answered.delete(this.answered.values().next().value ?? "");
    }
    if (type === "impersonate") return this.impersonate(input.chatId, gate);
    if (!this.host.capabilities.cancel) {
      this.diag?.failed({ chatId: input.chatId, userId: input.userId, turn: started?.generationId ?? null }, "pre", "guard", CANNOT_STOP);
      return "go";
    }
    const p = gate.prepared;
    if (p && started && this.fresh(gate, p, type, started)) {
      p.generationId = started.generationId;
      void this.adopt(input.chatId, input.userId, p, started.generationId);
      return "go";
    }
    const id = `engine-${crypto.randomUUID()}`;
    gate.halt = { id, generationId: started?.generationId ?? null, type, target: isSwipe(type) ? (started?.targetMessageId ?? null) : null, connectionId: input.connectionId, ...(input.frontendSessionId ? { session: input.frontendSessionId } : {}) };
    this.diag?.begin({ chatId: input.chatId, userId: input.userId, turn: id }, STEP_LABEL.engine);
    return "cancel";
  }

  /** Whether the engine prepared this generation: one of its type (a swipe's is a regenerate's), on the same target, chain and journal, that no generation took yet. */
  private fresh(gate: Gate, p: Prepared, type: HostGenerationType, started: GenerationStartedEvent): boolean {
    if (p.generationId !== null || p.epoch !== gate.epoch || !gate.mirror) return false;
    if (!(p.type === type || (isSwipe(p.type) && isSwipe(type)))) return false;
    if (isSwipe(type) && started.targetMessageId !== p.target) return false;
    return chainStamp(gate.mirror, type, p.target) === p.stamp;
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
    const gate: Gate = { userId, worldId, mirror: null, epoch: 0, halt: null, prepared: null };
    this.gates.set(chatId, gate);
    for (const [id, g] of this.gates) {
      if (this.gates.size <= OPEN_CHATS_CAP * 8) break;
      if (id !== chatId && !g.prepared && !g.halt) this.gates.delete(id);
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
   * Impersonate writes the player's next message: it runs without the engine, and with no engine
   * section in the book, so no mind or secret reaches it. A turn the engine prepared here that no
   * generation took gives way (the next reply runs the engine again); while another chat of the
   * world is generating with the book, it waits for that reply.
   */
  private async impersonate(chatId: ChatId, gate: Gate): Promise<ContextVerdict> {
    const p = gate.prepared;
    if (p && p.generationId === null) {
      gate.prepared = null;
      this.diag?.end({ chatId, userId: gate.userId, turn: p.id }, { status: "skipped", reason: "Impersonate ran before the reply; the engine runs again for the next reply" });
      await this.unfill(chatId, gate.userId, p);
    }
    const lease = this.leases.get(gate.worldId);
    if (lease && lease.chatId !== chatId) await lease.released.promise;
    return "go";
  }

  /** The generation the guard let through takes the prepared plan; what the engine run recorded follows it. */
  private adopt(chatId: ChatId, userId: UserId, p: Prepared, generationId: string): Promise<void> {
    return this.run(chatId, userId, async (core) => {
      if (p.turn && !core.adopt(generationId, p.turn)) this.diag?.failed({ chatId, userId, turn: p.id }, "plan", "plan", "the reply's generation couldn't take the prepared plan, so this turn commits without it");
      await this.hooks?.adopted(chatId, userId, p.id, generationId);
      this.diag?.rename(chatId, p.id, generationId);
      this.diag?.rest({ chatId, userId }, STEP_LABEL.reply ?? "Waiting for the reply…");
    });
  }

  /** A generation reached its prompt in a world chat without the guard's answer: it runs without the engine, and the chat is told. */
  private unguarded(chatId: ChatId, userId: UserId | null, generationId: string): void {
    if (!userId || this.answered.has(generationId) || !(this.gates.has(chatId) || this.chats.has(chatId))) return;
    this.diag?.failed({ chatId, userId, turn: generationId }, "pre", "guard", "the guard didn't answer for this generation, so it runs without the engine's sections");
  }

  /** A generation ended or stopped: the turn it took gives the book back, its entries emptied. */
  private release(chatId: ChatId, generationId: string): void {
    this.answered.delete(generationId);
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    if (!gate || !p || p.generationId !== generationId) return;
    gate.prepared = null;
    void this.serial(chatId, () => this.unfill(chatId, gate.userId, p));
  }

  /** Empties and switches off a prepared turn's entries, then lets the world's book go. */
  private async unfill(chatId: ChatId, userId: UserId, p: Prepared): Promise<void> {
    try {
      await this.hooks?.clear(chatId, userId, p.delivered);
    } catch (error) {
      this.diag?.error({ chatId, userId, turn: p.generationId ?? p.id }, "sections", error, "the engine's entries weren't switched off; the next turn rewrites them");
    } finally {
      this.letGo(p.worldId, chatId);
    }
  }

  /**
   * The world's book holds one chat's sections at a time (DESIGN §6.8). A turn another chat
   * prepared that no generation took yet gives way (its next generation runs the engine again); a
   * generation under way there is waited for.
   */
  private async claim(chatId: ChatId, worldId: WorldId, at: { chatId: ChatId; userId: UserId }): Promise<void> {
    for (;;) {
      const lease = this.leases.get(worldId);
      if (!lease || lease.chatId === chatId) break;
      const holder = this.gates.get(lease.chatId);
      const p = holder?.prepared;
      if (!holder || !p) {
        this.letGo(worldId, lease.chatId);
        break;
      }
      if (p.generationId === null) {
        holder.prepared = null;
        this.diag?.end({ chatId: lease.chatId, userId: holder.userId, turn: p.id }, { status: "skipped", reason: "another chat of this world ran a turn first; the engine runs again here when you generate" });
        this.letGo(worldId, lease.chatId);
        break;
      }
      this.diag?.rest(at, STEP_LABEL.book ?? "Waiting for another chat of this world…");
      await lease.released.promise;
    }
    this.leases.set(worldId, { chatId, released: Promise.withResolvers<void>() });
  }

  private letGo(worldId: WorldId, chatId: ChatId): void {
    const lease = this.leases.get(worldId);
    if (lease?.chatId !== chatId) return;
    this.leases.delete(worldId);
    lease.released.resolve();
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
      const signal = new AbortController().signal;
      const step = <T>(phase: "pre" | "plan" | "prose" | "sections", fn: () => Promise<T>): Promise<T> => (this.diag ? this.diag.step(at, phase, phase, fn) : fn());
      let delivered: Delivered | null = null;
      let claimed = false;
      try {
        await step("pre", () => hooks.beforePlan({ chatId, userId, core, observed, generationId: halt.id, connectionId: halt.connectionId, signal }));
        await step("plan", async () => core.plan(halt.id, observed, false));
        await step("prose", () => hooks.afterPlan({ chatId, userId, core, observed, generationId: halt.id, signal }));
        this.failedStep(at);
        await this.claim(chatId, gate.worldId, at);
        claimed = true;
        delivered = await step("sections", () => hooks.deliver({ chatId, userId, core, observed, generationId: halt.id }));
        this.failedStep(at);
      } catch (error) {
        core.take(halt.id);
        if (delivered) await this.unfill(chatId, userId, { id: halt.id, type: halt.type, target: halt.target, turn: null, stamp, epoch, worldId: gate.worldId, delivered, generationId: null });
        else if (claimed) this.letGo(gate.worldId, chatId);
        const failure = error instanceof EngineFailure ? error : new EngineFailure("engine", messageOf(error));
        this.diag?.end(at, { status: "failed", reason: `${failure.step}: ${failure.message}` });
        await hooks.failed({ chatId, userId, turn: halt.id, step: failure.step, reason: failure.message }).catch((e: unknown) => this.diag?.error(at, "engine", e, "the failure flag wasn't shown"));
        return;
      }
      const turn = core.take(halt.id);
      gate.prepared = { id: halt.id, type: halt.type, target: target?.id ?? null, turn: turn?.planned ? turn : null, stamp, epoch, worldId: gate.worldId, delivered, generationId: null };
      const as = restartAs(halt.type, observed);
      this.diag?.rest(at, as === "send" ? (STEP_LABEL.ready ?? "Ready: press Send for the reply") : (STEP_LABEL.restart ?? "Starting the reply…"));
      this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.generate", chatId, as }, userId, halt.session);
    });
  }

  /** Stops the engine run at its first failed step, with that step's reason. */
  private failedStep(at: { chatId: ChatId; userId: UserId; turn: string }): void {
    const failure = this.diag?.failure(at);
    if (failure) throw new EngineFailure(failure.step, failure.reason);
  }

  /** Runs `fn` on the chat's queue without reading the chat (no fold, no persist): ordering only. */
  private async serial(chatId: ChatId, fn: () => Promise<void>): Promise<void> {
    const slot = this.chats.get(chatId);
    if (!slot) return fn();
    this.outstanding++;
    try {
      slot.queue = slot.queue.then(fn).catch((error: unknown) => this.diag?.error({ chatId, userId: slot.userId, turn: null }, "ledger", error));
      await slot.queue;
    } finally {
      this.outstanding--;
    }
  }

  /** A message event's message, into the chat's mirror: the guard's chain (DESIGN §5.1). */
  private mirror(chatId: ChatId, message: HostMessage): void {
    const list = this.gates.get(chatId)?.mirror;
    if (!list) return;
    const entry: Mirrored = { id: message.id, isUser: message.isUser, swipeId: message.swipeId, content: contentId(message.swipes[message.swipeId] ?? message.content).hash };
    const at = list.findIndex((e) => e.id === message.id);
    if (at >= 0) list[at] = entry;
    else list.splice(Math.max(0, Math.min(message.index, list.length)), 0, entry);
  }

  private unmirror(chatId: ChatId, messageId: MessageId): void {
    const list = this.gates.get(chatId)?.mirror;
    const at = list ? list.findIndex((e) => e.id === messageId) : -1;
    if (list && at >= 0) list.splice(at, 1);
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** A user write from the frontend (chip confirm, ✎ fix, materialization, marker, Keep/Discard, Re-read); a turn the engine prepared before it is stale. */
  async write(chatId: ChatId, userId: UserId, w: HeldWrite): Promise<{ applied: boolean; pending: boolean; reason?: string }> {
    const gate = this.gates.get(chatId);
    if (gate) gate.epoch++;
    let result: { applied: boolean; pending: boolean; reason?: string } = { applied: false, pending: false, reason: "not a world chat" };
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

  /** Restart recovery and chat open: classify against the snapshot and close any window left open. */
  async open(chatId: ChatId, userId: UserId): Promise<void> {
    await this.run(chatId, userId, (core, observed) => {
      core.sync(observed);
      if (core.journal.windows.length > 0) core.restart(observed);
    });
  }

  /** The current core of a chat, for reads (state push, tests). */
  async core(chatId: ChatId, userId: UserId): Promise<LedgerCore | null> {
    return (await this.slot(chatId, userId))?.core ?? null;
  }

  /** Drops a chat's cached slot, guard state and copy of its messages (after attaching a world, or detaching one); a turn it prepared gives its entries back. */
  forget(chatId: ChatId): void {
    this.chats.delete(chatId);
    for (const key of [...this.notWorld]) if (key.endsWith(`\u0000${chatId}`)) this.notWorld.delete(key);
    this.forgetMessages(chatId);
    const gate = this.gates.get(chatId);
    this.gates.delete(chatId);
    const p = gate?.prepared;
    if (gate && p) void this.unfill(chatId, gate.userId, p);
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
      const slot: ChatSlot = { core: new LedgerCore(journal, { ...env, snapshots }, this.folder), userId, queue: Promise.resolve(), written: reset ? null : raw, ops: 0, snapshots, reasserts: new Map() };
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
