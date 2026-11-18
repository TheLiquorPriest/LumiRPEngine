// Ledger I/O (DESIGN §4.3 durability, §5.1; ARCHITECTURE §2): wires host events to the per-chat
// LedgerCore, persists the shadow journal in user storage and keeps message metadata in sync with it
// (flush after each turn, re-assert after clobbering).
//
// Per chat, every operation runs through one queue, so the core sees host events in order.
//
// Today's ledger, carried for the migration (PlanSwap-5), which reads chats through it. Not carried:
// the guard and the engine run before a generation (they stayed with the old backend's ledger,
// src/backend/ledger-io.ts, which §15.4 removes). The migration never attaches a ledger, and one
// attached here mirrors the chat's events and commits replies, and plans no turn.

import { hashParts } from "../../shared/hash";
import type { JsonObject } from "../../shared/json";
import { deepFreeze, isRecord } from "../../shared/json";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import { runDir } from "../../shared/ids";
import type { ChatRun, GenerationKind, HeldWrite, Journal, Marker, MarkerBody, MessageLedger, PostKind, Rec, RecStatus, RefusedWrite } from "../../shared/ledger";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import { validMarkerBody } from "../../engine/events";
import type { ChainMessage, FoldSnapshot, SnapshotStore } from "../../engine/ledger/chain";
import { emptyJournal, LedgerCore, type LedgerEnv, type WriteResult } from "../../engine/ledger/journal";
import type { QueuedOn } from "../../shared/gm-parts";
import type { LedgerFold } from "../../engine/ledger/fold";
import { giveWay } from "./give-way";
import type { HostGenerationType, HostMessage, HostPort } from "../../shared/host";
import { setAside } from "../../worlds/stored-json";
import type { LedgerDiagnostics } from "./diagnostics";
import { STEP_LABEL } from "./diagnostics";

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

/** A journal text's digest, which an open chat keeps instead of the text (a long chat's journal is megabytes). */
function journalHash(text: string): string {
  return hashParts("lre.journal", text);
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

/** A bag's ledger as decoded, with what it was decoded from: the namespace's value and, for a chunked one, its chunks. */
interface Decoded {
  raw: unknown;
  chunks: readonly unknown[];
  ledger: MessageLedger | null;
  /** The swipe keys of the records skipped as malformed. */
  damaged: readonly string[];
}

/**
 * Each metadata bag's ledger, decoded once (DESIGN §9.6): a chat's copy of its messages keeps each
 * message's bag until the message changes, and every fold, view and read of the chat decodes the
 * chain again. The ledger is frozen, so all of them share it. A message the host or the engine
 * changes comes with a new bag; one whose namespace's value or chunks were replaced in place is
 * decoded again.
 */
const DECODED = new WeakMap<JsonObject, Decoded>();

/** A chunked ledger's chunks as the bag holds them; none for an inline one. */
function chunksOf(bag: JsonObject, raw: unknown): unknown[] {
  if (!isRecord(raw) || typeof raw.chunks !== "number" || !Number.isInteger(raw.chunks) || raw.chunks < 1 || raw.chunks > 1000) return [];
  return Array.from({ length: raw.chunks }, (_, i) => bag[`${CHUNK_PREFIX}${i}`]);
}

/**
 * The ledger a metadata bag holds, inline or chunked; null when absent, malformed or a chunk is
 * missing. Stored ledgers come from outside (any metadata writer, an imported chat), so a marker is
 * kept only when its body passes the check requests pass, swipe keys must be swipe indexes, and a
 * record that fails `isRec` is skipped and reported to `damaged` with its swipe key, on every read.
 * It is frozen and shared: a reader that changes it takes its own copy.
 */
export function decodeLedger(bag: JsonObject, damaged?: (swipe: string) => void): MessageLedger | null {
  const raw = bag[LEDGER_NAMESPACE];
  const chunks = chunksOf(bag, raw);
  let decoded = DECODED.get(bag);
  if (!decoded || decoded.raw !== raw || decoded.chunks.length !== chunks.length || decoded.chunks.some((c, i) => c !== chunks[i])) {
    const skipped: string[] = [];
    decoded = { raw, chunks, ledger: deepFreeze(decodeBag(raw, chunks, (swipe) => skipped.push(swipe))), damaged: skipped };
    DECODED.set(bag, decoded);
  }
  if (damaged) for (const swipe of decoded.damaged) damaged(swipe);
  return decoded.ledger;
}

function decodeBag(value: unknown, chunks: readonly unknown[], damaged: (swipe: string) => void): MessageLedger | null {
  let raw = value;
  if (isRecord(raw) && typeof raw.chunks === "number" && typeof raw.hash === "string") {
    if (chunks.length === 0) return null;
    let text = "";
    for (const part of chunks) {
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
    else damaged(key);
  }
  const markers: Marker[] = [];
  for (const m of raw.markers) {
    if (!isRecord(m) || typeof m.seq !== "number" || !(m.at === null || typeof m.at === "string")) continue;
    // A body that passes is kept as written, not as the check clamps it: the chain hashed it so when
    // the marker was made (an earlier build journaled a start marker's half-minute tick unclamped),
    // and `applyMarker` checks and clamps it again wherever it applies. Its own copy, as a record's
    // is: the ledger is frozen, and what it was decoded from (a journal's own ledger, at a flush) isn't.
    const { seq: _seq, at: _at, start: _start, ...body } = m;
    if (validMarkerBody(body)) markers.push({ ...(structuredClone(body) as MarkerBody), seq: m.seq, at: m.at, ...(m.start === true ? { start: true as const } : {}) });
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
  /** The hash of the journal text last read or written (`journalHash`): an unchanged journal isn't written again, and its text isn't kept to tell. */
  written: string | null;
  /** Operations queued or running on this chat; a slot with none (and no turn in flight) may be evicted. */
  ops: number;
  snapshots: ChatSnapshots;
  /** Per message, the ledger last re-asserted after a clobber (as written) and how many times in a row. */
  reasserts: Map<MessageId, { text: string; count: number }>;
  /**
   * The windows the journal held when it was read: turns of a backend that stopped, whose
   * generations are gone (DESIGN §5.1 step 7), and the pre-reply windows of its engine runs, whose
   * turns lived in its memory (P2). Only these are closed when the chat is opened again; a
   * generation under way in this backend keeps its window, and so does a turn its engine run plans
   * or that waits here for its reply, however often a page resyncs.
   */
  leftOpen: Set<string>;
  /** The JSON characters of its journal and its snapshots as last read or written: about half of what it holds of them once parsed (`OPEN_CHATS_CHARS`). */
  chars: { journal: number; snapshots: number };
  /** What a view reads of the chat's ledger as the last operation left it (`viewStamp`): an operation that leaves it the same pushes nothing. Null until one ran. */
  viewed: string | null;
}

/**
 * Open chats kept in memory; idle ones are let go past this, the least recently used first. A chat's
 * slot holds its journal and fold snapshots (several MB for a long chat in a large world) and pins
 * its world revisions, and opens again from its journal and snapshots, so few are kept: a player
 * plays a handful of chats at a time.
 */
export const OPEN_CHATS_CAP = 16;

/**
 * The JSON characters the open chats' journals and snapshots may come to (about 50 MB once parsed):
 * past it, idle chats are let go too, the least recently used first, so a few long chats in a large
 * world hold no more than many short ones.
 */
export const OPEN_CHATS_CHARS = 24_000_000;

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

/** A stored event as the folds read it: its type, and its group and the groups it is tied to, when it has them. */
const isStoredEvent = (e: unknown): boolean => isRecord(e) && typeof e.type === "string" && (e.group === undefined || typeof e.group === "string") && (e.tiedTo === undefined || (Array.isArray(e.tiedTo) && e.tiedTo.every((g) => typeof g === "string")));

/** An agent turn's attribution (`RecAgent`): its role, its operation's key and its events' range, in `events` or in the `post` entry its `seq` names. */
const isRecAgent = (a: unknown): boolean => isRecord(a) && typeof a.role === "string" && typeof a.key === "string" && isInt(a.from) && isInt(a.to) && a.from >= 0 && a.to >= a.from && (a.seq === undefined || isInt(a.seq));

/**
 * A stored turn record (DESIGN §4.3 `Rec`), checked through every field the folds, hashes and
 * ledger operations read. Records reach the engine from the journal file and from message
 * metadata, which any writer can change (an imported or forked chat, another extension).
 */
function isRec(rec: unknown): rec is Rec {
  if (!isRecord(rec) || rec.v !== 1 || typeof rec.defHash !== "string" || !isInt(rec.seq) || !isContent(rec.swipeHash) || typeof rec.path !== "string" || typeof rec.seed !== "string") return false;
  if (!isInt(rec.pre) || rec.pre < 0 || !isInt(rec.markersApplied) || !REC_STATUSES.includes(rec.status) || !isRefs(rec.undone) || !isRecord(rec.intents)) return false;
  if (!Array.isArray(rec.events) || !rec.events.every(isStoredEvent)) return false;
  // A fix's request (`edit`) is checked for its shape here; its operations are parsed when it is resolved again.
  if (!Array.isArray(rec.post) || !rec.post.every((p) => isRecord(p) && isInt(p.seq) && typeof p.at === "string" && POST_KINDS.includes(p.kind) && Array.isArray(p.events) && p.events.every(isStoredEvent) && (p.edit === undefined || (isRecord(p.edit) && (typeof p.edit.clock === "string" ? p.edit.ops === undefined : Array.isArray(p.edit.ops) && p.edit.clock === undefined))))) return false;
  if (rec.keep !== undefined && !(isRecord(rec.keep) && Object.values(rec.keep).every((k) => isRecord(k) && isRefs(k.convert)))) return false;
  if (rec.dropped !== undefined && !(Array.isArray(rec.dropped) && rec.dropped.every((d) => isRecord(d) && isInt(d.seq) && POST_KINDS.includes(d.kind) && typeof d.reason === "string"))) return false;
  if (rec.agents !== undefined && !(Array.isArray(rec.agents) && rec.agents.every(isRecAgent))) return false;
  return (rec.accepted === undefined || isContent(rec.accepted)) && (rec.diag === undefined || typeof rec.diag === "string") && (rec.prompts === undefined || typeof rec.prompts === "string") && (rec.readElsewhere === undefined || rec.readElsewhere === true);
}

const isChainEntry = (v: unknown): boolean => isRecord(v) && typeof v.id === "string" && typeof v.isUser === "boolean" && isInt(v.swipeId) && isInt(v.swipeCount) && isContent(v.content) && typeof v.parentPath === "string";

function isHeldWrite(w: unknown): boolean {
  if (!isRecord(w) || typeof w.id !== "string") return false;
  switch (w.kind) {
    case "post":
      return w.target === "head" && isRecord(w.entry) && typeof w.entry.kind === "string" && Array.isArray(w.entry.events) && (w.entry.edit === undefined || (isRecord(w.entry.edit) && (typeof w.entry.edit.clock === "string" ? w.entry.edit.ops === undefined : Array.isArray(w.entry.edit.ops) && w.entry.edit.clock === undefined)));
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
      return typeof w.messageId === "string" && isInt(w.swipeId) && isRefs(w.refs) && (w.entry === undefined || isInt(w.entry));
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
  for (const source of [p.renarrateOf, p.rerunOf]) if (source !== undefined && !(isRecord(source) && typeof source.messageId === "string" && isInt(source.swipeId))) return false;
  if (p.undone !== undefined && !isRefs(p.undone)) return false;
  if (p.prompts !== undefined && typeof p.prompts !== "string") return false;
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
  if (![raw.chain, raw.pauses, raw.tombstones, raw.held].every(Array.isArray) || !isStrings(raw.windows) || (raw.prereply !== undefined && !isStrings(raw.prereply)) || !isRecord(raw.messages) || !isRecord(raw.pending)) return false;
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

/** Of the writes held before an operation, those it landed: no longer held, and not refused (P2). */
function heldLanded(before: readonly HeldWrite[], journal: Journal): HeldWrite[] {
  const still = new Set(journal.held.map((h) => h.write.id));
  const refused = new Set((journal.refused ?? []).map((r) => r.write.id));
  return before.filter((w) => !still.has(w.id) && !refused.has(w.id));
}

/** Of the writes held before an operation, those it refused as their window closed (P2), with why. */
function heldRefused(before: readonly HeldWrite[], journal: Journal): RefusedWrite[] {
  const ids = new Set(before.map((w) => w.id));
  const still = new Set(journal.held.map((h) => h.write.id));
  return (journal.refused ?? []).filter((r) => ids.has(r.write.id) && !still.has(r.write.id));
}

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
  /** The text the reply's read reads: the whole reply, or a Continue's suffix (L13). */
  content: string;
  /** The reply read's signal: Cancel on the activity line aborts it, and the reads still waiting are skipped. */
  signal: AbortSignal;
}

/**
 * Async work around the core's synchronous steps (DESIGN §5.1): `beforeCommit` and `afterCommit` run
 * here inside the chat's queue, so the core then folds their results as plain data. `changed` fires
 * after an operation that changed what a view reads of the ledger (`viewStamp`).
 */
export interface TurnHooks {
  beforeCommit(input: TurnContext): Promise<void>;
  afterCommit(input: TurnContext): Promise<void>;
  /**
   * The reply's read was cancelled, so its turn commits stopped and unread, with Retry read
   * (DESIGN §5.1 step 6): nothing the read prepared stands for it.
   */
  readStopped(input: TurnContext): Promise<void>;
  /**
   * Writes that landed, in order (P2): one made at once, or those held behind a reply that landed
   * as its window closed, however it closed. One the core refused is not among them: `refused` holds
   * those held that it refused as their window closed, with why.
   */
  writesLanded(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; writes: HeldWrite[]; refused: RefusedWrite[] }): Promise<void>;
  changed(chatId: ChatId, userId: UserId): void;
  /**
   * A swipe or regenerate is a Re-run or a Re-narrate (P3; `settings.swipeDefault` or a one-shot
   * choice, which the swipe takes: `generationId` is its generation's, `target` the reply it swipes).
   */
  kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind; generationId?: string; target?: MessageId | null }): Promise<GenerationKind>;
}

export class LedgerService {
  private readonly chats = new Map<ChatId, ChatSlot>();
  private readonly unsubscribe: (() => void)[] = [];
  private outstanding = 0;
  /** Every operation failure, also logged to the host. */
  readonly errors: string[] = [];
  hooks: TurnHooks | null = null;
  /** Where each turn's phases, failures and activity go (DESIGN §6.9); the runtime sets it. */
  diag: LedgerDiagnostics | null = null;
  /** Per `user \0 chat`: why the chat's journal was replaced on opening (kept for the process's life). */
  private readonly resets = new Map<string, string>();
  /** Per `user \0 chat`: notices about records on its messages skipped as malformed (kept for the process's life). */
  private readonly damaged = new Map<string, Set<string>>();
  /** Each chat's engine run or reply read under way, by the controller its steps' signals hang from: what Cancel aborts (DESIGN §5.1). */
  private readonly inFlight = new Map<ChatId, AbortController>();
  /** Generations started and not yet ended or stopped: a chat's `open` leaves a turn of one alone. */
  private readonly generating = new Set<string>();
  /**
   * Each reply's shown swipe as the chat's events told it, in their order, by chat and then message.
   * When a swipe is added, the one that showed is the one it is made from (P3, L43), handed to the
   * core with the event's operation: by the time the chat's queue reaches it (a reply's read can hold
   * the queue for seconds), the chat may already show the new swipe. Kept only for the chats whose
   * ledger is in memory or opening (an event's operation opens it before its swipe is noted, so one
   * that comes while it is let go counts too), let go with it (`unload`), when an open ends without it,
   * or when the chat is deleted: a reply no event has told of since falls back to the swipe the
   * chat's syncs last saw (`LedgerCore.noteAdded`).
   */
  private readonly shown = new Map<ChatId, Map<MessageId, number>>();

  constructor(
    protected readonly host: HostPort,
    private readonly resolveEnv: EnvResolver,
    /** The fold the user's chats fold on (each user's own, its caches within their settings). */
    private readonly folder: (userId: UserId) => LedgerFold,
  ) {}

  /** Subscribes to host events: messages, swipes and generations mirror into the chat's ledger. */
  attach(): void {
    const h = this.host;
    this.unsubscribe.push(
      h.on("MESSAGE_SENT", (e, userId) => {
        this.onMessage(e.chatId, userId, e.message.id, "sent");
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_EDITED", (e, userId) => {
        this.onMessage(e.chatId, userId, e.message.id, "edited");
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_SWIPED", (e, userId) => {
        const from = e.action === "added" ? this.shown.get(e.chatId)?.get(e.message.id) : undefined;
        this.onSwiped(e.chatId, userId, e.message.id, e.action, e.swipeId, from);
        // After its operation started: a chat whose ledger was let go is opening again by now.
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_DELETED", (e, userId) => {
        this.shown.get(e.chatId)?.delete(e.messageId);
        this.onMessage(e.chatId, userId, e.messageId, "deleted");
      }),
      h.on("CHAT_DELETED", (e) => {
        this.shown.delete(e.chatId);
      }),
      h.on("GENERATION_STARTED", (e, userId) => {
        this.generating.add(e.generationId);
        return this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          const kind = this.hooks && userId ? await this.hooks.kindOf({ chatId: e.chatId, userId, kind: KIND[e.generationType], generationId: e.generationId, target: e.targetMessageId }) : KIND[e.generationType];
          core.started({ generationId: e.generationId, kind, targetMessageId: e.targetMessageId, targetSwipeId: e.targetSwipeId }, observed);
        });
      }),
      h.on("GENERATION_ENDED", (e, userId) => {
        this.generating.delete(e.generationId);
        const at = userId ? { chatId: e.chatId, userId, turn: e.generationId } : null;
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
          await this.commitReply(core, observed, e.chatId, userId, e.generationId, e.messageId, e.content);
        });
      }),
      h.on("GENERATION_STOPPED", (e, userId) => {
        this.generating.delete(e.generationId);
        // A stop is the player's: the turn it took goes, as it always has.
        if (userId) this.diag?.end({ chatId: e.chatId, userId, turn: e.generationId }, { status: "skipped", reason: "the reply was stopped" });
        return this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          core.stopped({ generationId: e.generationId, content: e.content }, observed);
        });
      }),
    );
  }

  /**
   * A saved reply's read and commit (DESIGN §5.1 step 5): the post phase reads its text (a Continue
   * only what it added, L13), the turn commits with what the read prepared, then what follows a
   * commit runs. A read stopped part-way (its Cancel, or an agent role failing under `stop`) commits
   * as stopped, as a failed generation does: the reply stands unread, nothing its calls answered
   * applies, and the reply's Retry read reads it again.
   */
  private async commitReply(core: LedgerCore, observed: ChainMessage[], chatId: ChatId, userId: UserId | null, generationId: string, messageId: MessageId | undefined, content: string): Promise<void> {
    const at = userId ? { chatId, userId, turn: generationId } : null;
    const p = core.journal.pending[generationId];
    const swipeId = p?.swipeId ?? observed.find((m) => m.id === messageId)?.swipeId ?? 0;
    const flight = this.flight(chatId);
    const turn = p && messageId && userId ? { chatId, userId, core, observed, generationId, messageId, swipeId, kind: p.kind, signal: flight.signal } : null;
    const diag = at && turn ? this.diag : null;
    if (at && diag) diag.begin(at, STEP_LABEL.read);
    // What the reply's read reads: a Continue only what it added (L13), else the whole reply.
    const text = p?.kind === "continue" ? (p.captured && content.length >= p.captured.len ? content.slice(p.captured.len) : "") : content;
    try {
      if (this.hooks && turn && p && p.kind !== "impersonate") {
        const hooks = this.hooks;
        try {
          if (text !== "") await (at && diag ? diag.phased(at, "read", () => diag.step(at, "read", "read", () => hooks.beforeCommit({ ...turn, content: text }))) : hooks.beforeCommit({ ...turn, content: text }));
          else if (at && diag) diag.skipped(at, "read", "read", "the reply had no new text to read");
        } catch (error) {
          // A call the stop cut short may throw (an agent role's does): the read commits stopped, below.
          if (!flight.signal.aborted) throw error;
        }
      }
      if (flight.signal.aborted) {
        core.stopped({ generationId, content }, observed);
        if (this.hooks && turn) await this.hooks.readStopped({ ...turn, content: text });
      } else {
        core.ended({ generationId, ...(messageId ? { messageId } : {}), content }, observed);
        if (this.hooks && turn) {
          const hooks = this.hooks;
          await (at && diag ? diag.phased(at, "memory", () => diag.step(at, "memory", "memory", () => hooks.afterCommit({ ...turn, content: text }))) : hooks.afterCommit({ ...turn, content: text }));
        }
      }
    } finally {
      this.landed(chatId, flight);
    }
    if (at && diag) diag.end(at, flight.signal.aborted ? { status: "skipped", reason: "you cancelled reading the reply; Retry read reads it again" } : undefined);
  }

  private flight(chatId: ChatId): AbortController {
    const flight = new AbortController();
    this.inFlight.set(chatId, flight);
    return flight;
  }

  private landed(chatId: ChatId, flight: AbortController): void {
    if (this.inFlight.get(chatId) === flight) this.inFlight.delete(chatId);
  }

  /** A reply event's message: the swipe it shows now, in the events' order (`shown`), for a chat whose ledger is in memory or opening. */
  private show(chatId: ChatId, message: HostMessage): void {
    if (message.isUser || !(this.chats.has(chatId) || this.opening.has(chatId))) return;
    const replies = this.shown.get(chatId) ?? new Map<MessageId, number>();
    replies.set(message.id, message.swipeId);
    this.shown.set(chatId, replies);
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /**
   * A user write from the frontend (a chip's Apply or Undo, a ✎ fix, a GM edit, a mechanical action,
   * materialization, a marker, Keep/Discard, Re-read), or an agent's. One made while a reply is under
   * way waits for it (P2): the reply's window holds it, and its closing lands it, over what the turn
   * did. Any other lands at once.
   */
  async write(chatId: ChatId, userId: UserId, w: HeldWrite): Promise<WriteResult & { queued?: QueuedOn }> {
    // What a write held now waits on, as it is made: a window that opened since is a reply's.
    const on = this.queuedOn(chatId);
    let result: WriteResult = { applied: false, pending: false, reason: "not a world chat" };
    await this.run(
      chatId,
      userId,
      async (core, observed) => {
        core.sync(observed);
        result = core.write(w, observed);
        if (!result.applied) return;
        await this.hooks?.writesLanded({ chatId, userId, core, observed, writes: [w], refused: [] });
      },
      w,
    );
    return result.pending ? { ...result, queued: on ?? "reply" } : result;
  }

  /** What a write made now would wait on (DESIGN §5.1, P2), or null when it would land at once: a reply under way, this backend's or one whose window the journal holds. */
  queuedOn(chatId: ChatId): QueuedOn | null {
    return (this.chats.get(chatId)?.core.journal.windows.length ?? 0) > 0 ? "reply" : null;
  }

  /** Restart recovery and chat open: classify against the snapshot, and close the windows a stopped backend left open (never a turn under way here). */
  async open(chatId: ChatId, userId: UserId): Promise<void> {
    await this.run(chatId, userId, async (core, observed) => {
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

  /** Lets a chat's ledger go from memory, with what the events told of its replies' shown swipes (`shown`); it opens again from its journal and snapshots. */
  private unload(chatId: ChatId): void {
    this.chats.delete(chatId);
    this.shown.delete(chatId);
  }

  /** Drops a chat's cached slot (after attaching a world, or detaching one). */
  forget(chatId: ChatId): void {
    this.unload(chatId);
    for (const key of [...this.notWorld]) if (key.endsWith(`\u0000${chatId}`)) this.notWorld.delete(key);
  }

  /** Whether the chat holds what only memory keeps: an operation queued or running, or a turn in flight. */
  busy(chatId: ChatId): boolean {
    const slot = this.chats.get(chatId);
    return slot !== undefined && (slot.ops > 0 || slot.core.inFlight);
  }

  /** Standing notices for the player about a chat (its journal was replaced, a record on a message was damaged), for the inspector's warnings. */
  notices(chatId: ChatId, userId: UserId): string[] {
    const key = `${userId}\u0000${chatId}`;
    const reset = this.resets.get(key);
    return [...(reset ? [reset] : []), ...(this.damaged.get(key) ?? [])];
  }

  /**
   * What a chat's view reads of its ledger, as one string: the journal as last written, the chain's
   * key (its messages, their records and markers, as a fold reads them) and the notices. Equal stamps
   * build equal views of the ledger.
   */
  private viewStamp(chatId: ChatId, slot: ChatSlot, messages: readonly HostMessage[]): string {
    const keys = slot.core.foldKeys(this.observe(chatId, slot.userId, messages));
    return JSON.stringify([slot.written, keys.steps.at(-1) ?? keys.root, this.notices(chatId, slot.userId)]);
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

  /** `from`: on `added`, the swipe that showed as it was added, as the events told it (`shown`); undefined when none had told it since the backend started. */
  private onSwiped(chatId: ChatId, userId: UserId | null, messageId: MessageId, action: string, swipeId: number, from?: number): void {
    void this.run(chatId, userId, (core, observed) => {
      if (action === "updated") this.markSaved(core, observed, messageId, "edited");
      core.sync(observed, action === "deleted" ? { messageId, swipeId } : undefined);
      if (action === "added" && from !== undefined) core.swipeAdded(messageId, swipeId, from);
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
    if (known) {
      if (userId !== null && known.userId !== userId) return null;
      // The most recently used last: the idle chats let go first are those used longest ago.
      this.chats.delete(chatId);
      this.chats.set(chatId, known);
      return known;
    }
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
      const stored = await this.host.storage.read(snapshotsPath(chatId), userId).catch(() => null);
      const snapshots = ChatSnapshots.parse(stored);
      // A stamped journal differs from the stored text, so the next persist writes it.
      const slot: ChatSlot = { core: new LedgerCore(journal, { ...env, snapshots }, this.folder(userId)), userId, queue: Promise.resolve(), written: reset || raw === null ? null : journalHash(raw), ops: 0, snapshots, reasserts: new Map(), leftOpen: new Set([...journal.windows, ...(journal.prereply ?? []), ...Object.keys(journal.pending)]), chars: { journal: raw?.length ?? 0, snapshots: stored?.length ?? 0 }, viewed: null };
      // The revisions its folds will ask for are loaded before anyone folds it.
      await slot.core.prepareWorlds(this.observe(chatId, userId, await this.host.chats.messages(chatId, userId)));
      this.chats.set(chatId, slot);
      let chars = 0;
      for (const s of this.chats.values()) chars += s.chars.journal + s.chars.snapshots;
      for (const [id, s] of this.chats) {
        if (this.chats.size <= OPEN_CHATS_CAP && chars <= OPEN_CHATS_CHARS) break;
        if (id === chatId || this.busy(id)) continue;
        this.unload(id);
        chars -= s.chars.journal + s.chars.snapshots;
      }
      return slot;
    })();
    this.opening.set(chatId, open);
    try {
      return await open;
    } finally {
      this.opening.delete(chatId);
      // An open that ends without the chat's ledger (not a world chat, or it failed) lets go of what its events noted meanwhile.
      if (!this.chats.has(chatId)) this.shown.delete(chatId);
    }
  }

  /**
   * Runs one operation on the chat's queue, then persists the journal and flushes metadata. `write`
   * is a write the operation lands (its revision is loaded first).
   */
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
          // Writes held behind a reply land as its window closes, whichever op closes it (P2).
          const held = slot.core.journal.held.map((h) => h.write);
          await op(slot.core, observed);
          const landed = held.length > 0 ? heldLanded(held, slot.core.journal) : [];
          const refused = held.length > 0 ? heldRefused(held, slot.core.journal) : [];
          if (landed.length > 0 || refused.length > 0) {
            await this.hooks?.writesLanded({ chatId, userId: slot.userId, core: slot.core, observed, writes: landed, refused });
          }
          await this.persist(chatId, slot);
          // What the flush marked as written is persisted with it, so the journal stands as this op left it.
          if (await this.flush(chatId, slot)) await this.persist(chatId, slot);
          // Only an operation that changed what a view reads of the ledger pushes: what else a view
          // reads (chips, the inspector, the meter) tells its own changes, or changes with the journal.
          const viewed = this.viewStamp(chatId, slot, await this.host.chats.messages(chatId, slot.userId));
          if (viewed === slot.viewed) return;
          slot.viewed = viewed;
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
      const stored = JSON.stringify(slot.snapshots);
      await this.host.storage.write(`${at}.tmp`, stored, slot.userId);
      await this.host.storage.move(`${at}.tmp`, at, slot.userId);
      slot.chars.snapshots = stored.length;
    }
    const text = JSON.stringify(slot.core.journal);
    const hash = journalHash(text);
    if (hash === slot.written) return;
    const path = journalPath(chatId);
    await this.host.storage.write(`${path}.tmp`, text, slot.userId);
    await this.host.storage.move(`${path}.tmp`, path, slot.userId);
    slot.written = hash;
    slot.chars.journal = text.length;
  }

  /**
   * Writes the journal's ledgers into message metadata once no turn is in flight (DESIGN §5.1 step
   * 10). A ledger is compared and written as the metadata reads it back (`decodeLedger`), so a part
   * the reader drops never looks clobbered; a re-assert after another write that doesn't stick is
   * tried at most `REASSERTS_PER_LEDGER` times in a row for the same ledger. Whether it wrote any.
   */
  private async flush(chatId: ChatId, slot: ChatSlot): Promise<boolean> {
    if (slot.core.inFlight) return false;
    let wrote = false;
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
      wrote = true;
    }
    return wrote;
  }
}
