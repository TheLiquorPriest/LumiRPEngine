// Ledger I/O (DESIGN §4.3 durability, §5.1; ARCHITECTURE §2): wires host events and the guard to
// the per-chat LedgerCore, runs the engine before a generation, persists the shadow journal in user
// storage and keeps message metadata in sync with it (flush after each turn, re-assert after
// clobbering).
//
// Per chat, every operation runs through one queue, so the core sees host events in order.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import { deepFreeze, isRecord } from "../shared/json";
import type { ChatId, MessageId, UserId, WorldId } from "../shared/ids";
import { runDir } from "../shared/ids";
import type { SecretMarkWording } from "../shared/secret-marks";
import type { NarratorView } from "../shared/settings";
import type { ChatRun, ContentId, GenerationKind, HeldWrite, Journal, LedgerEvent, Marker, MarkerBody, MessageLedger, PendingTurn, PostKind, Rec, RecSession, RecStatus, RefusedWrite } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { PROTOCOL_VERSION, type GenerateAs, type GeneratePush } from "../shared/protocol";
import type { Limit } from "../shared/minds";
import { HOST_LIMITS, hostBound } from "../shared/timeouts";
import { validMarkerBody } from "../engine/events";
import type { ChainMessage, FoldSnapshot, SnapshotStore } from "../engine/ledger/chain";
import { emptyJournal, LedgerCore, type LedgerEnv, type WriteResult } from "../engine/ledger/journal";
import { basisIndex, chainBases } from "../engine/ledger/layer";
import { liveEventsOn, storyAndEventsOn, storyOn, type LiveEvent } from "../engine/ledger/story";
import { foldEntryOf, layerDraftProblem, type Basis, type FoldLayerEntry, type LandResult, type LayerDraft, type LayerEntry, type LayerSummary } from "../shared/layer";
import type { StoryRead } from "../shared/story";
import type { QueuedOn } from "../shared/gm-parts";
import type { WorldState } from "../engine/state";
import type { WorldDoc } from "../shared/world";
import type { LedgerFold } from "../engine/ledger/fold";
import { activeRecord, activeText, contentId, sameContent } from "../engine/ledger/path";
import { giveWay } from "./give-way";
import type { ContextHandlerInput, ContextVerdict, GenerationEndedEvent, GenerationStartedEvent, HostGenerationType, HostMessage, HostPort } from "./host";
import { setAside } from "./stored-json";
import { ancestorOf, LayerStore, type HeldDraft } from "./layer-store";
import type { Diagnostics } from "./diagnostics";
import { messageOf } from "./diagnostics";
import { inTurn, outsideTurns, type TurnFrame } from "./turn-frame";
import { CANNOT_STOP, FRAME_UNREAD, NOT_LAST_REPLY, STEP_LABEL, type TurnPhaseName } from "../shared/diagnostics";

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
  /** The chat's basis-anchored layer (DEPTH-PLAN §4.9), its ancestor's inherited entries included. */
  layer: LayerStore;
  /** Drafts accepted in the landing under way, not yet stored: later drafts of the same landing are checked after them. */
  landing: FoldLayerEntry[];
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
  return (rec.accepted === undefined || isContent(rec.accepted)) && (rec.unread === undefined || rec.unread === "reply" || rec.unread === "continue") && (rec.shown === undefined || typeof rec.shown === "string") && (rec.diag === undefined || typeof rec.diag === "string") && (rec.prompts === undefined || typeof rec.prompts === "string") && (rec.readElsewhere === undefined || rec.readElsewhere === true);
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
  if (p.sceneRead !== undefined && !(Array.isArray(p.sceneRead) && p.sceneRead.every(isRecord))) return false;
  if (p.depth !== undefined && p.depth !== true) return false;
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

/** One message as the archive index reads it (`LedgerService.archiveView`). */
export interface ArchiveMessage {
  id: MessageId;
  index: number;
  isUser: boolean;
  swipeId: number;
  swipe: string;
  text: string;
  /** The clock after its turn, for a reply holding a turn record; else null. */
  clock: number | null;
}

/** What a job reads at its basis (`foldAtBasisOf`). */
export interface BasisRead {
  state: WorldState;
  world: WorldDoc;
  story: StoryRead;
  /** The live events of the types the reader asked for, through the basis, in fold order (none asked: empty). */
  events: LiveEvent[];
  index: number;
}

/** What the archive index reads of a chat (`archiveViewOf`). */
export interface ArchiveView {
  messages: ArchiveMessage[];
  story: StoryRead;
}

// The depth reads from a core and its observed chain, for code that already holds them (a turn, which
// holds the chat's queue); the `LedgerService` methods of the same names run them on the queue.

function storyInput(core: LedgerCore, observed: readonly ChainMessage[], without?: ReadonlySet<string>): { chain: ChainMessage[]; tombstones: Journal["tombstones"]; pauses: Journal["pauses"]; layer: readonly FoldLayerEntry[] } {
  return { chain: core.chain(observed), tombstones: core.journal.tombstones, pauses: core.journal.pauses, layer: core.layerEntries(without && without.size > 0 ? { observed, without } : undefined) };
}

/** The narrative record on the chain (through `upTo` when given). */
export function storyOf(core: LedgerCore, observed: readonly ChainMessage[], upTo?: MessageId): StoryRead {
  return storyOn({ ...storyInput(core, observed), ...(upTo !== undefined ? { upTo } : {}) });
}

/** The live events of `types` on the chain (through `upTo` when given), in fold order (`liveEventsOn`). */
export function eventsOf(core: LedgerCore, observed: readonly ChainMessage[], types: readonly string[], upTo?: MessageId): LiveEvent[] {
  return liveEventsOn({ ...storyInput(core, observed), ...(upTo !== undefined ? { upTo } : {}) }, new Set(types));
}

/**
 * The fold, world and narrative record through `basis` (DEPTH-PLAN §4.9), with the live events of
 * `types` read in the same walk (real-time dialogue's `story.talk`): a Re-run reads them at its basis,
 * never on the swipe it replaces. `without`: layer entries read as superseded, the ones a redo is
 * replacing (§8.4), so its jobs read the world as it will be once what replaces them lands. Null
 * when the basis isn't on the chain or is past a pause.
 */
export function foldAtBasisOf(core: LedgerCore, observed: readonly ChainMessage[], basis: Pick<Basis, "message" | "swipe">, types: readonly string[] = [], without?: ReadonlySet<string>): BasisRead | null {
  const chain = core.chain(observed);
  const index = basisIndex(chain, core.journal.tombstones, basis);
  if (index < 0) return null;
  const through = observed.slice(0, index + 1);
  const folded = core.fold(through, without ? { without } : {});
  if (folded.messages[index]?.fold === "paused") return null;
  const world = core.playedAt(folded.state);
  if (!world) return null;
  const { story, events } = storyAndEventsOn(storyInput(core, through, without), new Set(types));
  return { state: folded.state, world, story, events, index };
}

/**
 * What the archive index reads of the chat in one pass (DEPTH-PLAN §4.3): each message on the active
 * chain with its shown text, swipe identity and, for a turn, the clock after it, and the narrative
 * record on the chain.
 */
export function archiveViewOf(core: LedgerCore, observed: readonly ChainMessage[]): ArchiveView {
  const chain = core.chain(observed);
  const bases = chainBases(chain, core.journal.tombstones);
  const folded = core.fold(observed);
  const messages = chain.map((m, index): ArchiveMessage => {
    const turn = !m.isUser && (bases[index]?.swipe.startsWith("r") ?? false);
    return { id: m.id, index, isUser: m.isUser, swipeId: m.swipeId, swipe: bases[index]?.swipe ?? "", text: activeText(m), clock: turn ? (folded.messages[index]?.clock ?? null) : null };
  });
  return { messages, story: storyOf(core, observed) };
}

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
  /** A loopback turn A2's scene played (`LedgerService.sceneCommit`): its record's pre and read part, which commit in place of reading the reply. */
  scene?: SceneCommit;
}

/** What A2's depth turn hands the commit (DEPTH-PLAN §1.3): the record's planned events, its read part (the narrator's prose) and every text they name, by hash; and when a stage failed once a passage streamed, why (the scene is cut there, as a Stop cuts it). */
export interface SceneCommit {
  pre: LedgerEvent[];
  read: LedgerEvent[];
  blobs: Record<string, string>;
  error?: string;
}

/** What the pre phase leaves the engine run: nothing to say, or a question the chat now asks, on which the run waits (a claim under Ask first, DESIGN §9.4). */
export type PreOutcome = { waiting: string };

/**
 * Async work around the core's synchronous steps (DESIGN §5.1): the engine run's pre phase, plan
 * phase and sections, and `extract` before the commit, run here inside the chat's queue, so the
 * core then folds their results as plain data. `afterCommit` collects chips; `changed` fires after
 * an operation that changed what a view reads of the ledger (`viewStamp`).
 */
export interface TurnHooks {
  /**
   * The engine run's pre phase. `runKey` stands for the chain and the journal the run reads: a run of
   * the same turn after a failed one may keep what that one got right while they, and whatever else
   * that part depends on, are unchanged.
   */
  beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; connectionId: string | null; runKey: string; signal: AbortSignal }): Promise<PreOutcome | undefined>;
  /**
   * After the plan, before the reply: the plan-phase prose steps (DESIGN §5.2 brief, prose outline); a
   * `waiting` outcome holds the reply on the player (the outline gate, §5.1), whose answer starts the
   * reply as the stopped generation started (`as`).
   */
  afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; as: GenerateAs; signal: AbortSignal }): Promise<PreOutcome | undefined>;
  /**
   * The engine run's sections step (DESIGN §6.4): the prepared turn's sections made, and the book's
   * entries placed for them; nothing is written into the book yet. `stopped`: the generation the
   * guard stopped for the run, which a swipe's one-shot choice was taken by (`kindOf`).
   */
  deliver(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; stopped?: string | null }): Promise<Delivered>;
  /**
   * The engine run's last step, the final review (DESIGN §4.6): the sections as the main agent's
   * review leaves them (a Re-narrate's as its source's review left them), recorded on the prepared
   * turn. Its failure is the turn's only when the review's settings say to stop. Absent: the
   * sections go as made.
   */
  finalReview?(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; delivered: Delivered; signal: AbortSignal }): Promise<Delivered>;
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
  /**
   * The engine run failed and nothing was generated: the chat says which step and why, with a Retry
   * that starts the stopped generation's reply again as it started (`as`, DESIGN §5.1): Lumiverse's
   * Regenerate or Continue, or for a new reply after a reply the player's Send. Absent: nothing can
   * start it again here (an Impersonate or a preview the book's clear stopped).
   */
  failed(input: { chatId: ChatId; userId: UserId; turn: string; step: string; reason: string; as?: GenerateAs }): Promise<void>;
  /** The chat's world, read from its metadata alone (the guard's check); null when it isn't a world chat. */
  worldOf(chatId: ChatId, userId: UserId): Promise<WorldId | null>;
  /**
   * What a turn runs on from its engine run's start to its reply's commit (DESIGN §5.1): the user's
   * settings and the chat's own choices as they stand now. The run, the guard's write of its
   * sections and its reply's read each run in it (`inTurn`), so a change made meanwhile applies
   * from the chat's next turn and never keeps this one's reply from starting. `at` is the chain the
   * run starts on: a chat with no engine of its own and no LRE turn on it records New chats start
   * on as its engine first (INC3 3a, `ChatKnowledge.forTurn`).
   */
  frame(chatId: ChatId, userId: UserId, at?: { core: LedgerCore; observed: readonly ChainMessage[] }): Promise<TurnFrame>;
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
  /**
   * The engine run `turn` is over: it prepared its turn, waits on the player (a claim, a gate), was
   * cancelled, or failed. What the run kept for itself alone goes; what a wait keeps for its resume stays.
   */
  ran?(input: { chatId: ChatId; userId: UserId; turn: string; outcome: RunOutcome }): void;
  /**
   * The ledger let a turn go without a commit (DESIGN §5.1): a prepared turn gone stale or replaced,
   * a kept one discarded, a reply that was stopped or failed with nothing kept for its retry. What
   * the runtime kept for it alone goes, under the id it was prepared as (`turn`) and the generation
   * that took it, if one did; `how` says how it ended.
   */
  turnGone?(input: { chatId: ChatId; userId: UserId; turn: string; generationId: string | null; how: TurnGone }): void;
  /**
   * Whether a generation on this connection goes through the loopback (DEPTH-PLAN §3.4, §3.12): the
   * guard lets a world chat's generation straight on, and its turn runs inside its provider call
   * (`loopbackRun`). Absent: none does.
   */
  isLoopback?(connectionId: string | null, userId: UserId): Promise<boolean>;
  /** Resolves once the loopback's work for the generation is over (its turn streamed, stopped or failed), so its end commits what that work left; null when none is under way. */
  loopSettled?(generationId: string): Promise<void> | null;
  /**
   * Whether the chat is on depth (DEPTH-PLAN §1.3), asked as each of its generations starts: nothing
   * reads that generation's text into canon, however it ends (`PendingTurn.depth`), and off the
   * loopback the guard lets it on with no engine run. Absent: none is.
   */
  depthOn?(chatId: ChatId, userId: UserId): Promise<boolean>;
  /**
   * A generation of a chat on depth goes on off the loopback with no engine run (DEPTH-PLAN §3.4):
   * the chat says depth needs the loopback, under the message the reply answers (`target` is the
   * reply as the generation's start named it: a swipe's, or a new reply's own), and on an agents chat
   * GM → Live says why no role ran.
   */
  offLoopback?(input: { chatId: ChatId; userId: UserId; generationId: string | null; target: MessageId | null }): Promise<void>;
  /**
   * The player edited message `messageId`'s text (on its swipe `swipeId`), and the ledger keeps what
   * was made of it as it was: a reply's after its turn committed (an assistant edit, L38), or his own
   * message's (`isUser`) where layer entries were made from it (`LedgerCore.keepIdentity`). Never a
   * generation's save of its own reply, nor a write that leaves its text as it was. Told once the
   * edit's operation is done, outside the chat's queue.
   */
  assistantEdited?(input: { chatId: ChatId; userId: UserId; messageId: MessageId } & PlayerEdit): void;
}

/** How an engine run ended (`TurnHooks.ran`). */
export type RunOutcome = "prepared" | "waiting" | "cancelled" | "failed";

/** How a turn the ledger let go without a commit ended (`TurnHooks.turnGone`). */
export type TurnGone = "cancelled" | "failed" | "dropped";

/**
 * A loopback turn's engine run (`LedgerService.loopbackRun`): the turn its generation took, with the
 * sections made for its prompt and the kind it plays as (a swipe's, as the swipe setting says;
 * DEPTH-PLAN §3.9), whether or not it planned anything; a generation the engine plays no part in (an
 * Impersonate's); a run that failed, was cancelled, or now waits on the player, each with what the
 * thinking block says. What the run recorded, its inspector record included, goes by the
 * generation's id once it is delivered (`TurnHooks.adopted`), a kept turn's retry's too.
 */
export type LoopRun =
  | { kind: "delivered"; turn: PendingTurn | null; delivered: Delivered; as: GenerationKind }
  | { kind: "plain" }
  | { kind: "failed"; step: string; reason: string }
  | { kind: "cancelled" }
  | { kind: "waiting"; reason: string };

/** A world chat's generation the guard let straight on because it goes through the loopback (DEPTH-PLAN §3.12). */
interface LoopGen {
  generationId: string;
  type: HostGenerationType;
  /** The message its reply goes on and the swipe, as its `GENERATION_STARTED` named them. */
  target: MessageId | null;
  swipe: number | null;
  connectionId: string | null;
  session?: string;
  at: number;
}

/** A loopback engine run's ending (`LedgerService.engine`): how it ended, and the turn its generation takes when it prepared one. */
interface LoopTake {
  generationId: string;
  done(run: LoopRun, taken: Prepared | null): void;
}

/**
 * What the engine run made for a turn's prompt (DESIGN §6.4): each entry of the world's book and the
 * text it takes, written only by the guard of the generation that takes the turn, and `placed`, what
 * the placement was decided from (the preset the host generates the chat with and the book's
 * Positions), which the write checks first. `parts` names each entry filled, in the order written:
 * its section's slot (or the narrator rules') and its name, which the final review reads it by.
 * `wording` is the turn's wording of a secret's mark (§6.12), which the World Info entries in the
 * same prompt are marked in too.
 */
export interface Delivered {
  bookId: string;
  fills: ReadonlyMap<string, string>;
  parts: readonly { id: string; label: string; entry: string }[];
  placed: string;
  wording: SecretMarkWording;
  /** What the narrator knew as the sections were made (DESIGN §6.11): the World Info entries in the same prompt are marked by it. */
  view: NarratorView;
  /**
   * A swipe's (Build C item 1): the turn's text for what the player asks of this telling
   * (`narrator.swipe_direction`), what they asked when they did (the chip's What should change?, or
   * the page's ask, `claimRestart`), and `ask` when the page is to ask first (Settings → Swipes).
   * The guard ends the narrator rules with it (`fill`): it is in memory only, and no record, hash,
   * output or prompt set holds it.
   */
  swipe?: { text: string; direction?: string; ask?: true };
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

/** The player's edit of a message, as `acceptedEdit` answers it: the text and swipe it shows, and whether it is his own message. */
export interface PlayerEdit {
  text: string;
  swipeId: number;
  isUser: boolean;
}

/**
 * Runs `sync` and answers the text message `messageId` shows, on the swipe it shows, when the sync
 * took it as the player's edit that the ledger keeps what was made of it through: a reply's (an
 * assistant edit, L38) or his own message's that layer entries were made from (a bare record keeps
 * its identity, `LedgerCore.keepIdentity`). Its active record's accepted identity changed, to a new
 * text or back to the one it was made with. Null for anything else: a generation's save of its own
 * reply (its turn's target waits for the commit), a write that leaves the text as it was, or the
 * edit of a player's message nothing was made from.
 */
function acceptedEdit(core: LedgerCore, observed: readonly ChainMessage[], messageId: MessageId, sync: () => void): PlayerEdit | null {
  const accepted = (): ContentId | undefined => {
    const m = core.chain(observed).find((x) => x.id === messageId);
    return m ? activeRecord(m, core.journal.tombstones)?.accepted : undefined;
  };
  const before = accepted();
  sync();
  const after = accepted();
  if ((before === undefined && after === undefined) || sameContent(before, after)) return null;
  const m = observed.find((x) => x.id === messageId);
  return m ? { text: activeText(m), swipeId: m.swipeId, isUser: m.isUser } : null;
}

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
  /** When the guard stopped it: the run's wait for the chat is from here to its first step (`wait`). */
  stoppedAt: number;
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
  /** The chain it was planned on (`chainStamp`) and the journal's epoch then. */
  stamp: string;
  epoch: number;
  /** What the turn runs on (`TurnHooks.frame`), taken as its engine run started: its sections' write and its reply's read run in it too. */
  frame: TurnFrame;
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
  /**
   * For a turn kept from a reply that failed: the swipe of `target` that reply was saved on (its
   * generation's `targetSwipeId`), the one swipe whose late text is its reply (`lateReply`). Null for
   * a turn an engine run prepared, or when Lumiverse named no swipe.
   */
  failedSwipe: number | null;
  /**
   * Where its reply's time starts (`reply`): as the engine run prepared it, for a reply the page
   * starts; as a generation took it, for one only the player starts (Send, or a kept turn's retry).
   */
  readyAt: number;
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
  /**
   * The stopped generation's engine run while it is under way: its turn id, from the stop that hands
   * it out (`haltOf`) to the run's end (`ran`). The gate stays meanwhile, and the run checks the gate
   * that stopped the generation is still the chat's before it prepares anything on it.
   */
  running: string | null;
  /**
   * Text for a kept empty reply came late (`lateReply`): its read's id, from the moment it takes the
   * kept turn until that read ran. The gate stays meanwhile, so a turn the player leaves for another
   * swipe before the read runs is kept again on it.
   */
  reading: string | null;
  /** The generation the guard let straight on because it goes through the loopback (DEPTH-PLAN §3.12), with its engine run's id while that runs. */
  loop: (LoopGen & { run: string | null }) | null;
}

/**
 * Who a world's book belongs to now (DESIGN §6.4), in memory only. A `turn`: an engine run writing
 * its sections, the turn it prepared and the generation that took it, until they are emptied (`owner`
 * is the run's id, which its turn keeps). A `plain`: the prompt of a generation without the engine
 * (`plain`), held empty (`owner` is its generation's id). A `look`: a dry run emptying what an
 * earlier turn left. `moved` settles when the owner lets go or its turn's state changes, so a claim
 * waiting on it looks again.
 */
interface Lease {
  chatId: ChatId;
  owner: string;
  kind: "turn" | "plain" | "look";
  moved: PromiseWithResolvers<void>;
}

/** Why the engine run stopped: the step that failed, and what went wrong. The engine-failed card says both; an agent turn's role under `stop` throws one to end the run where it stopped. */
export class EngineFailure extends Error {
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
  return { lre: PROTOCOL_VERSION, type: "lre.generate", chatId, as: p.as, turn: p.id, ...(p.delivered.swipe?.ask && p.delivered.swipe.direction === undefined ? { ask: true as const } : {}) };
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
  /** The last epoch given: every new gate and every write takes the next, so no two are the same (`Gate.epoch`). */
  private epochs = 0;
  /** The guard's registered wait; 0 until attached. */
  private guardTimeout = 0;
  /**
   * Generations started and not yet ended or stopped, and calls of the guard in flight: while either
   * holds, the host may be walking its handler list, so a new registration waits.
   */
  private readonly generating = new Set<string>();
  /**
   * The ids of writes a pre-reply window holds (`early`): made during an engine run, they made no turn
   * stale then, so their landing does (DESIGN §5.1). Every other held write did as it was made.
   */
  private readonly unbumped = new Set<string>();
  /** Each held layer draft a landing waits on (`landLayers`'s `wait`), by chat and id: settled by the drain that lands or refuses it. */
  private readonly heldWaits = new Map<string, PromiseWithResolvers<LandResult>>();
  private guarding = 0;
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
  /** What A2's depth turns made, by generation, until their commit takes it (`sceneCommit`). */
  private readonly scenes = new Map<string, SceneCommit>();
  /** The blank replies LumiRPEngine deleted itself (a loopback send stopped before any text): no deletion of the player's. */
  private readonly ownDeletes = new Set<MessageId>();

  constructor(
    private readonly host: HostPort,
    private readonly resolveEnv: EnvResolver,
    /** The fold the user's chats fold on (each user's own, its caches within their settings). */
    private readonly folder: (userId: UserId) => LedgerFold,
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
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_EDITED", (e, userId) => {
        this.mirror(e.chatId, e.message);
        if (!this.lateReply(e.chatId, userId, e.message)) this.onMessage(e.chatId, userId, e.message.id, "edited");
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_SWIPED", (e, userId) => {
        const from = e.action === "added" ? this.shown.get(e.chatId)?.get(e.message.id) : undefined;
        this.mirror(e.chatId, e.message);
        if (!(e.action === "updated" && e.swipeId === e.message.swipeId && this.lateReply(e.chatId, userId, e.message))) this.onSwiped(e.chatId, userId, e.message.id, e.action, e.swipeId, from);
        // After its operation started: a chat whose ledger was let go is opening again by now.
        this.show(e.chatId, e.message);
      }),
      h.on("MESSAGE_DELETED", (e, userId) => {
        this.shown.get(e.chatId)?.delete(e.messageId);
        this.unmirror(e.chatId, e.messageId);
        this.onMessage(e.chatId, userId, e.messageId, "deleted");
      }),
      h.on("CHAT_DELETED", (e) => {
        this.shown.delete(e.chatId);
      }),
      h.on("GENERATION_STARTED", (e, userId) => {
        this.generating.add(e.generationId);
        this.started.delete(e.chatId);
        this.started.set(e.chatId, e);
        if (this.started.size > 1024) this.started.delete(this.started.keys().next().value ?? "");
        return this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          const kind = this.hooks && userId ? await this.hooks.kindOf({ chatId: e.chatId, userId, kind: KIND[e.generationType], generationId: e.generationId, target: e.targetMessageId }) : KIND[e.generationType];
          const depth = userId ? (await this.hooks?.depthOn?.(e.chatId, userId)) === true : false;
          core.started({ generationId: e.generationId, kind, targetMessageId: e.targetMessageId, targetSwipeId: e.targetSwipeId, depth }, observed);
        });
      }),
      h.on("GENERATION_IN_PROGRESS", (e, userId) => {
        this.unguarded(e.chatId, userId, e.generationId);
        // Its prompt is assembled: the sections it held go, and so does a generation's hold without the engine.
        this.release(e.chatId, e.generationId);
      }),
      h.on("GENERATION_ENDED", (e, userId) => {
        this.generationOver(e.chatId, e.generationId);
        // The reply of a turn the engine prepared is read on what that turn runs on (`Prepared.frame`).
        const taken = this.gates.get(e.chatId)?.taken;
        const ours = taken?.generationId === e.generationId ? taken : null;
        const frame = ours ? ours.frame : null;
        // A depth scene a stage failed in once a passage streamed was handed over cut where the last
        // one streamed, as a Stop's is (DEPTH-PLAN §3.10, §3.14): its reply commits that, so its
        // turn isn't kept for a retry.
        const cut = e.error !== undefined && e.content !== "" && this.scenes.has(e.generationId);
        // Kept at once, so a retry pressed the moment the reply failed finds its turn.
        const failed = this.afterReply(e.chatId, e.generationId, cut ? { generationId: e.generationId, chatId: e.chatId, content: e.content, generationType: e.generationType } : e);
        const at = userId ? { chatId: e.chatId, userId, turn: e.generationId } : null;
        // The reply's part of the turn's time: from the turn being ready (or taken, when only the player starts it) to its end.
        if (at && ours) this.diag?.phase(at, { name: "reply", ms: Date.now() - ours.readyAt, ...(failed ? { cause: failed === "empty" ? "it came back empty" : "it failed" } : {}) });
        const halt = this.haltOf(e.chatId, e.generationId, false);
        // The host ended a generation the guard stopped instead of stopping it: no engine run follows.
        if (halt && userId) this.diag?.end({ chatId: e.chatId, userId, turn: halt.id }, { status: "failed", reason: `Lumiverse ended the stopped generation instead of stopping it${e.error ? ` (${e.error.slice(0, 200)})` : ""}, so the engine didn't run; generate again` });
        const commit = (): Promise<void> =>
          this.run(e.chatId, userId, async (core, observed) => {
            core.sync(observed);
            if (e.error) this.host.log("warn", `[LumiRPEngine] generation ${e.generationId.slice(0, 8)} ended with an error${cut ? ", its scene cut where its last passage streamed" : ""}: ${e.error.slice(0, 200)}`, userId ?? undefined, e.generationId);
            // A generation that ended in error commits as stopped: no auto-read, no extraction; the
            // reply's Retry read chip covers whatever text was saved. A cut scene commits as below.
            if (e.error && !cut) {
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
            // Lumiverse may name no message for a reply that failed: the turn's own is the one it saved.
            const messageId = e.messageId ?? core.journal.pending[e.generationId]?.messageId ?? undefined;
            const read = (): Promise<void> => this.commitReply(core, observed, e.chatId, userId, e.generationId, messageId, e.content);
            await (frame ? inTurn(frame, read) : read());
          });
        // A loopback turn's end commits what its work left, once that work is over (never from inside the chat's queue).
        const settled = this.hooks?.loopSettled?.(e.generationId);
        return settled ? settled.then(commit) : commit();
      }),
      h.on("GENERATION_STOPPED", (e, userId) => {
        const gate = this.gates.get(e.chatId);
        const loop = gate?.loop?.generationId === e.generationId ? gate.loop : null;
        // A loopback turn's engine run stops with its generation, whether or not the relay's word of it comes (DEPTH-PLAN §3.10).
        if (loop?.run && gate?.running === loop.run) this.inFlight.get(e.chatId)?.abort(new TurnCancelled());
        this.generationOver(e.chatId, e.generationId);
        // What follows waits for a loopback turn's work to settle: a depth turn's scene, cut where its last passage streamed, is handed over by then.
        const after = (): Promise<void> => {
          // A depth turn stopped once a passage streamed ends as its scene was cut: it commits as an ended
          // reply does, its pre and read part the scene's (A2, DEPTH-PLAN §3.10). With nothing streamed, nothing commits.
          const scened = this.scenes.has(e.generationId) && e.content !== "";
          const taken = gate?.taken?.generationId === e.generationId ? gate.taken : null;
          // A stop is the player's: the turn it took goes, as it always has; a cut scene's ends as an ended reply's does.
          this.afterReply(e.chatId, e.generationId, scened ? { generationId: e.generationId, chatId: e.chatId, content: e.content, generationType: loop?.type ?? "normal" } : null);
          const halt = this.haltOf(e.chatId, e.generationId, userId !== null);
          if (userId && !halt && !scened) this.diag?.end({ chatId: e.chatId, userId, turn: e.generationId }, { status: "skipped", reason: "the reply was stopped" });
          let started = false;
          return this.run(e.chatId, userId, async (core, observed) => {
            core.sync(observed);
            // The kind the stopped generation started as (a one-shot Re-narrate's) is the engine run's.
            const pending = core.journal.pending[e.generationId];
            const kind = pending?.kind ?? (halt ? KIND[halt.type] : "normal");
            const messageId = pending?.messageId ?? pending?.continueHead ?? undefined;
            if (scened && userId && messageId) {
              const read = (): Promise<void> => this.commitReply(core, observed, e.chatId, userId, e.generationId, messageId, e.content);
              await (taken ? inTurn(taken.frame, read) : read());
            } else core.stopped({ generationId: e.generationId, content: e.content }, observed);
            if (halt && userId) {
              started = true;
              void this.engine(e.chatId, userId, halt, kind);
            }
            // A loopback swipe stopped before any text leaves the blank swipe it added: LumiRPEngine
            // removes it, by the target its GENERATION_STARTED named (DEPTH-PLAN §3.10).
            if (loop && userId && e.content === "" && isSwipe(loop.type) && loop.target !== null) {
              const target = observed.find((m) => m.id === loop.target);
              if (target && target.swipes.length > 1 && target.swipes.at(-1) === "" && loop.swipe === target.swipes.length - 1) {
                const shown = core.addedSwipeFrom(target.id, target.swipes.length - 1) ?? Math.min(target.swipeId, target.swipes.length - 2);
                await this.host.chats.setSwipes(e.chatId, target.id, target.swipes.slice(0, -1), shown, userId).catch((error: unknown) => this.diag?.error({ chatId: e.chatId, userId, turn: e.generationId }, "stop", error, "the stopped swipe's empty swipe stays"));
              }
            }
            // A loopback send stopped before any text leaves the blank reply core staged for it (D0a
            // check 3): LumiRPEngine deletes it, by the target its GENERATION_STARTED named.
            if (loop && userId && e.content === "" && loop.type === "normal" && loop.target !== null) {
              const blank = observed.find((m) => m.id === loop.target);
              if (blank && !blank.isUser && blank.swipes.length === 1 && blank.swipes[0] === "") {
                this.ownDeletes.add(blank.id);
                if (this.ownDeletes.size > 64) this.ownDeletes.delete(this.ownDeletes.values().next().value ?? "");
                await this.host.chats.deleteMessage(e.chatId, blank.id, userId).catch((error: unknown) => this.diag?.error({ chatId: e.chatId, userId, turn: e.generationId }, "stop", error, "the stopped reply's empty message stays"));
              }
            }
          }).finally(() => {
            // A stop whose run never started (the chat is no longer open as a world chat) leaves its gate free.
            if (halt && !started) this.ran(e.chatId, halt.id);
          });
        };
        const settled = this.hooks?.loopSettled?.(e.generationId);
        return settled ? settled.then(after) : after();
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
   * go on as they are, with nothing an earlier turn left in the book; Impersonate, and any generation
   * of a chat on depth off the loopback, go on with no engine run, from a book that holds no engine
   * section. Any other generation goes on only when the engine prepared it, for its type, on the
   * chain it stands on and the journal as it is; else the guard stops it, and its stop starts the
   * engine run, which starts it again when done.
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
    // A world chat on the loopback goes straight on: its turn runs inside its provider call.
    if (this.hooks?.isLoopback && (await this.hooks.isLoopback(input.connectionId, input.userId))) return this.loopGuard(input, gate, started);
    if (type === "impersonate") return this.plain(input.chatId, gate, started, signal);
    // A chat on depth plays its turns through the loopback (DEPTH-PLAN §3.4): on another connection no
    // scene plays its reply and nothing reads it into the story, so it goes on with no engine run and
    // no model call, and the player is told (`offLoopback`).
    if (this.hooks?.depthOn && (await this.hooks.depthOn(input.chatId, input.userId))) {
      const turn = started?.generationId ?? null;
      await this.hooks.offLoopback?.({ chatId: input.chatId, userId: input.userId, generationId: turn, target: started?.targetMessageId ?? null }).catch((error: unknown) => this.diag?.error({ chatId: input.chatId, userId: input.userId, turn }, "guard", error, "the chat wasn't told depth needs the loopback"));
      return this.plain(input.chatId, gate, started, signal);
    }
    if (!this.host.capabilities.cancel) {
      this.diag?.failed({ chatId: input.chatId, userId: input.userId, turn: started?.generationId ?? null }, "pre", "guard", CANNOT_STOP);
      return "go";
    }
    const p = gate.prepared;
    if (p && started && this.fresh(gate, p, type, started)) {
      const filled = await this.fill(input.chatId, gate, p, started.generationId, signal);
      if (filled !== "moved") return filled;
    }
    const id = `engine-${crypto.randomUUID()}`;
    gate.halt = { id, generationId: started?.generationId ?? null, type, target: isSwipe(type) ? (started?.targetMessageId ?? null) : null, connectionId: input.connectionId, ...(input.frontendSessionId ? { session: input.frontendSessionId } : {}), stoppedAt: Date.now() };
    this.diag?.begin({ chatId: input.chatId, userId: input.userId, turn: id }, STEP_LABEL.engine);
    return "cancel";
  }

  /** Whether the engine prepared this generation: one of its type (a swipe's is a regenerate's), on the same target, chain and journal, that no generation took yet. */
  private fresh(gate: Gate, p: Prepared, type: HostGenerationType, started: GenerationStartedEvent): boolean {
    if (p.generationId !== null || !(p.type === type || (isSwipe(p.type) && isSwipe(type)))) return false;
    if (isSwipe(type) && started.targetMessageId !== p.target) return false;
    return this.changedSince(gate, p) === null;
  }

  /**
   * What changed since a prepared turn was made (DESIGN §5.1), in the chat's words; null when nothing
   * did. A turn runs on the settings and the chat's choices it started with (`Prepared.frame`), so
   * only the chat itself counts: its chain, and the journal. No write lands on the journal while a turn
   * the engine prepared waits (every write made then waits for the turn), so only a turn kept from a
   * failed reply meets one.
   */
  private changedSince(gate: Gate, p: Prepared): string | null {
    if (gate.mirror === null || chainStamp(gate.mirror, p.type, p.target) !== p.stamp) return "a message of the chat was sent, edited, swiped or deleted";
    if (p.epoch !== gate.epoch) return "a change was made to the chat's world (a fix, a confirmed change, detail opened)";
    return null;
  }

  /**
   * A turn the engine prepared that no generation took goes the moment anything it was made from
   * changes (DESIGN §5.1): its entries are emptied, and the next generation runs the engine again.
   * Age alone never makes it stale. One kept from a failed reply goes quietly: nothing asked for its
   * reply again, so nothing says that reply didn't start, and the chat just loses its retry card.
   * Either way its run ends without a reply, so what its pre-reply window held lands (P2). `why`
   * says what changed when the caller knows (the engine switched), else the chat is checked.
   */
  private dropIfStale(chatId: ChatId, why?: string): void {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    const changed = gate && p && p.generationId === null ? (why ?? this.changedSince(gate, p)) : null;
    if (!gate || !p || changed === null) return;
    gate.prepared = null;
    if (p.kept === null) this.notStarted(chatId, gate.userId, p, `${changed} after the engine ran and before the reply started`);
    else this.hooks?.changed(chatId, gate.userId);
    this.drop(chatId, gate.userId, p);
    this.gone(chatId, gate.userId, p, "dropped");
    this.endRun(chatId, gate.userId, p);
  }

  /**
   * The chat's engine was switched (GM → This chat → Engine, the offer's buttons; INC3 3a): a turn
   * the engine prepared for the next reply that no generation took is dropped, and the next
   * generation works it out on the engine switched to. A turn under way finishes on the one it
   * started on (`TurnFrame`).
   */
  engineSwitched(chatId: ChatId): void {
    this.dropIfStale(chatId, "the chat's engine was switched");
  }

  /**
   * A turn the engine prepared will get no reply (P2): its run's pre-reply window closes on the
   * chat's queue, and what it held lands there, on the chat as it then stands, or waits on for a reply
   * under way. A turn kept from a failed reply has none: that reply's window took it over.
   */
  private endRun(chatId: ChatId, userId: UserId, p: Pick<Prepared, "id" | "kept">): void {
    if (p.kept !== null) return;
    void this.run(chatId, userId, (core, observed) => {
      core.sync(observed);
      core.endRun(p.id, observed);
    });
  }

  /**
   * The journal took writes from outside a turn: a turn the engine prepared before them is stale
   * (DESIGN §5.1), and a later run plans with them.
   */
  private wrote(chatId: ChatId): void {
    const gate = this.gates.get(chatId);
    if (!gate) return;
    gate.epoch = ++this.epochs;
    this.dropIfStale(chatId);
  }

  /**
   * A generation is over (DESIGN §5.1): `ended` is how it ended, null for a stop. When it took a
   * prepared turn and its reply failed (it ended in error, or a reply other than a Continue came back
   * empty), the turn is kept for the retry as it was prepared: the player's own retry takes it,
   * writing the same sections and adopting the same plan, with no engine run. The retry starts as
   * the turn's reply did (`as`): Lumiverse's Regenerate, its Continue, or, for a new reply after a
   * reply, the player's Send. It is kept under the failed generation's id, which is what the
   * runtime's state for the turn goes by now. A new reply that left its message (empty, or what
   * streamed before the error) is retried as a Regenerate of that message, which is what Lumiverse
   * makes of a retry once the chat ends with it, on the same chain. Anything else lets the turn go.
   * Returns how the reply failed, kept or not.
   */
  private afterReply(chatId: ChatId, generationId: string, ended: GenerationEndedEvent | null): ReplyFailure | null {
    const gate = this.gates.get(chatId);
    const p = gate?.taken;
    if (!gate || !p || p.generationId !== generationId) return null;
    gate.taken = null;
    const failed: ReplyFailure | null = !ended ? null : ended.error ? "error" : p.type !== "continue" && ended.content.trim() === "" ? "empty" : null;
    // A turn the engine prepared since, or a run it was asked for, comes first.
    if (failed === null || gate.prepared !== null || gate.halt !== null) {
      // A stop, or a failure nothing keeps: the turn goes. A reply that came back commits it.
      if (!ended || failed !== null) this.gone(chatId, gate.userId, p, ended ? "failed" : "cancelled");
      return failed;
    }
    const started = this.started.get(chatId);
    const ours = started?.generationId === generationId ? started : null;
    const message = ours?.targetMessageId ?? null;
    const left = p.type === "normal" && message !== null && gate.mirror?.some((m) => m.id === message) === true;
    gate.prepared = { ...p, id: generationId, generationId: null, writing: null, holder: null, kept: failed, failedSwipe: ours?.targetSwipeId ?? null, ...(left ? { type: "regenerate" as const, target: message, as: "regenerate" as const } : {}) };
    // What the reply's end itself changed, such as an edit it saved, drops it at once.
    this.dropIfStale(chatId);
    return failed;
  }

  /**
   * Text for a reply that came back empty, arriving after it (DESIGN §5.1): Lumiverse saving it late,
   * or the player writing it in. Its turn is still kept for a retry, so that text is the reply the
   * turn waits for: the turn is taken for it as a retry takes it, with no engine call and no prompt,
   * and the text is read and committed with the turn's plan, so the turn plays once. Only text on the
   * swipe the empty reply was saved on, while that swipe is shown, the kept turn is fresh and its
   * message is the chat's last. True when it was taken; false, with nothing done, when no kept turn
   * waits for this text, so the edit is an assistant edit as ever (L38): another swipe of the message
   * (a reply played before it) keeps its record and gets Re-read edit.
   */
  private lateReply(chatId: ChatId, userId: UserId | null, message: HostMessage): boolean {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    const swipe = p?.failedSwipe ?? null;
    if (!gate || !p || !userId || gate.userId !== userId || p.kept !== "empty" || p.generationId !== null || p.target !== message.id || message.isUser || swipe === null || message.swipeId !== swipe || (message.swipes[swipe] ?? "").trim() === "") return false;
    if (gate.mirror?.at(-1)?.id !== message.id || this.changedSince(gate, p) !== null) return false;
    const generationId = `late-${crypto.randomUUID()}`;
    p.generationId = generationId;
    gate.prepared = null;
    gate.reading = generationId;
    const at = { chatId, userId, turn: generationId };
    void this.run(chatId, userId, async (core, observed) => {
      const saved = observed.find((m) => m.id === message.id);
      const content = saved?.swipeId === swipe ? (saved.swipes[swipe] ?? "") : "";
      // The player went to another swipe (or emptied this one) before this ran: the edit is an
      // assistant edit as ever, and the turn stays kept for its retry while nothing else came first.
      if (content.trim() === "") {
        this.markSaved(core, observed, message.id, "edited");
        core.sync(observed);
        if (this.gates.get(chatId) === gate && gate.prepared === null && gate.halt === null && gate.taken === null) {
          gate.prepared = { ...p, generationId: null };
          this.dropIfStale(chatId);
        } else {
          this.gone(chatId, userId, p, "dropped");
          this.hooks?.changed(chatId, userId);
        }
        return;
      }
      this.diag?.begin(at, STEP_LABEL.read);
      const depth = (await this.hooks?.depthOn?.(chatId, userId)) === true;
      // Begun before the chat is synced, so the text is this turn's save, not an edit of the message.
      core.started({ generationId, kind: p.turn?.kind ?? KIND[p.type], targetMessageId: message.id, targetSwipeId: swipe, depth }, observed);
      if (p.turn && !core.adopt(generationId, p.turn)) this.diag?.failed(at, "plan", "plan", "the reply's text couldn't take the prepared plan, so this turn commits without it");
      core.saved(generationId);
      core.sync(observed);
      // The read is the kept turn's, on what it runs on (`Prepared.frame`).
      await inTurn(p.frame, async () => {
        await this.hooks?.adopted(chatId, userId, p.id, generationId);
        await this.commitReply(core, observed, chatId, userId, generationId, message.id, content);
      });
    }).finally(() => {
      if (gate.reading === generationId) gate.reading = null;
    });
    return true;
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
    const scene = this.scenes.get(generationId);
    this.scenes.delete(generationId);
    const turn = p && messageId && userId ? { chatId, userId, core, observed, generationId, messageId, swipeId, kind: p.kind, signal: flight.signal, ...(scene ? { scene } : {}) } : null;
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

  /**
   * The turn kept from a reply that failed, while a retry can still take it (DESIGN §5.1): its id,
   * how that reply failed, and how its retry starts: Lumiverse's Regenerate, its Continue, or the
   * player's own Send for a new reply after a reply, which no page can start.
   */
  keptOf(chatId: ChatId): { turn: string; failed: ReplyFailure; as: GenerateAs } | null {
    const p = this.gates.get(chatId)?.prepared;
    return p && p.kept !== null && p.generationId === null ? { turn: p.id, failed: p.kept, as: p.as } : null;
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
    this.gone(chatId, gate.userId, p, "dropped");
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
    void this.hooks?.failed({ chatId, userId, turn: p.id, step: "stale", reason: why, as: p.as }).catch((error: unknown) => this.diag?.error(at, "restart", error, "the chat wasn't told its reply didn't start"));
  }

  /** A turn let go without a commit: what the runtime kept for it alone goes (`TurnHooks.turnGone`). */
  private gone(chatId: ChatId, userId: UserId, p: Pick<Prepared, "id" | "generationId">, how: TurnGone): void {
    this.hooks?.turnGone?.({ chatId, userId, turn: p.id, generationId: p.generationId, how });
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
   * claim has since passed on from is told no, so the reply starts once. A swipe's claim may carry
   * what the player asked of it (`direction`, the page's ask, Settings → Swipes): its telling's
   * narrator rules end with it (`Delivered.swipe`).
   */
  claimRestart(chatId: ChatId, userId: UserId, session: string | undefined, turn: string, direction?: string): boolean {
    const gate = this.gates.get(chatId);
    const p = gate?.prepared;
    if (!gate || gate.userId !== userId || !p || p.id !== turn || p.generationId !== null || p.kept !== null) return false;
    const yes = !this.host.capabilities.sessions || session === undefined || p.holder === session;
    const swipe = p.delivered.swipe;
    if (yes && swipe && direction !== undefined && direction !== "") p.delivered = { ...p.delivered, swipe: { ...swipe, direction } };
    return yes;
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
    if (known) {
      if (known.userId !== userId) return null;
      // Used now: the gates used longest ago go first.
      this.gates.delete(chatId);
      this.gates.set(chatId, known);
      return known;
    }
    if (this.notWorld.has(`${userId}\u0000${chatId}`) || !this.hooks) return null;
    const worldId = await this.hooks.worldOf(chatId, userId);
    if (!worldId) return null;
    const raced = this.gates.get(chatId);
    if (raced) return raced.userId === userId ? raced : null;
    const gate: Gate = { userId, worldId, mirror: null, epoch: ++this.epochs, halt: null, prepared: null, taken: null, running: null, reading: null, loop: null };
    this.gates.set(chatId, gate);
    for (const [id, g] of this.gates) {
      if (this.gates.size <= OPEN_CHATS_CAP * 8) break;
      // A gate holding a stopped generation, its engine run, a prepared turn, a taken one, a late reply's read or a loopback generation under way stays: those live only here.
      if (id !== chatId && !g.prepared && !g.halt && !g.taken && g.running === null && g.reading === null && !(g.loop && this.generating.has(g.loop.generationId))) this.gates.delete(id);
    }
    return gate;
  }

  /** The generation the guard stopped, if this is it; it is handed out once. With `runs`, its engine run follows, and the gate is busy until that run ends (`ran`). */
  private haltOf(chatId: ChatId, generationId: string, runs: boolean): Halt | null {
    const gate = this.gates.get(chatId);
    const halt = gate?.halt;
    if (!gate || !halt || (halt.generationId !== null && halt.generationId !== generationId)) return null;
    gate.halt = null;
    if (runs) gate.running = halt.id;
    return halt;
  }

  /** The engine run of `turn` ended: its gate may go again. */
  private ran(chatId: ChatId, turn: string): void {
    const gate = this.gates.get(chatId);
    if (gate?.running === turn) gate.running = null;
  }

  // ------------------------------------------------------------------ the loopback (DEPTH-PLAN §3.12)

  /**
   * A world chat's generation that goes through the loopback: it goes straight on, and its turn runs
   * inside its provider call (`loopbackRun`), named by the target its GENERATION_STARTED gave. The
   * book holds none of the engine's sections then, so what an earlier turn left there is emptied
   * first, as for a dry run.
   */
  private loopGuard(input: ContextHandlerInput, gate: Gate, started: GenerationStartedEvent | null): Promise<ContextVerdict> {
    // Its start unheard, or an earlier generation's: no turn can be tied to it, and nothing of a world chat goes out untracked (DEPTH-PLAN §3.14). A host that can't cancel lets it on, and the tagger stops it (`required`).
    if ((started === null || !this.generating.has(started.generationId)) && this.host.capabilities.cancel) {
      const reason = "LumiRPEngine didn't hear this reply start, so it stopped it rather than let your world chat's reply out untracked: generate again";
      gate.loop = null;
      this.diag?.failed({ chatId: input.chatId, userId: input.userId, turn: null }, "pre", "guard", reason);
      void this.hooks?.failed({ chatId: input.chatId, userId: input.userId, turn: `unheard-${crypto.randomUUID()}`, step: "stale", reason }).catch((e: unknown) => this.diag?.error({ chatId: input.chatId, userId: input.userId, turn: null }, "guard", e, "the flag wasn't shown"));
      return Promise.resolve("cancel");
    }
    gate.loop = started ? { generationId: started.generationId, type: started.generationType, target: started.targetMessageId, swipe: started.targetSwipeId, connectionId: input.connectionId, ...(input.frontendSessionId !== undefined ? { session: input.frontendSessionId } : {}), at: Date.now(), run: null } : null;
    return this.look(input);
  }

  /** The loopback generation under way in the chat, while it is `userId`'s and the chat's latest: what the turn tagger tags (DEPTH-PLAN §3.5). */
  loopOf(chatId: ChatId, userId: UserId): Readonly<LoopGen> | null {
    const gate = this.gates.get(chatId);
    const loop = gate?.loop;
    if (!gate || gate.userId !== userId || !loop || !this.generating.has(loop.generationId) || this.started.get(chatId)?.generationId !== loop.generationId) return null;
    return loop;
  }

  /** Whether `userId` has a world chat's generation under way on the loopback: on a host without required interceptors, an untagged request then can't be told from it (DEPTH-PLAN §3.14). */
  loopBusy(userId: UserId): boolean {
    for (const gate of this.gates.values()) if (gate.userId === userId && gate.loop && this.generating.has(gate.loop.generationId)) return true;
    return false;
  }

  /** Stops a loopback generation's engine run while it runs (the relay gave its call up, DEPTH-PLAN §3.10): never another turn's run or a reply's read. */
  cancelLoop(chatId: ChatId, userId: UserId, generationId: string): boolean {
    const gate = this.gates.get(chatId);
    const loop = gate?.loop;
    if (!gate || gate.userId !== userId || loop?.generationId !== generationId || loop.run === null || gate.running !== loop.run) return false;
    return this.cancel(chatId, userId);
  }

  /**
   * A loopback turn's engine run (DEPTH-PLAN §3.12, B1 until A2): today's run for the generation the
   * guard let on, inside its provider call. Nothing stops or restarts: the turn it prepares is the
   * generation's at once, and its sections come back for the narrator's prompt instead of going into
   * the book. A turn kept from a failed reply is taken again with no run, as a retry takes it; an
   * Impersonate has no run at all. Never called from inside the chat's queue.
   */
  async loopbackRun(chatId: ChatId, userId: UserId, generationId: string): Promise<LoopRun> {
    const gate = this.gates.get(chatId);
    const loop = gate?.loop;
    if (!gate || gate.userId !== userId || !loop || loop.generationId !== generationId) return { kind: "failed", step: "loopback", reason: "LumiRPEngine has no record of this reply's generation (it may have restarted since the reply began); generate again" };
    if (loop.type === "impersonate") return { kind: "plain" };
    const started = this.started.get(chatId);
    const kept = gate.prepared;
    if (kept && kept.kept !== null && started?.generationId === generationId && this.fresh(gate, kept, loop.type, started)) {
      gate.prepared = null;
      kept.generationId = generationId;
      kept.readyAt = Date.now();
      gate.taken = kept;
      await this.adopt(chatId, userId, kept, generationId);
      return { kind: "delivered", turn: kept.turn, delivered: kept.delivered, as: kept.turn?.kind ?? KIND[loop.type] };
    }
    if (gate.running !== null) return { kind: "failed", step: "loopback", reason: "another engine run of this chat is still under way; generate again in a moment" };
    const halt: Halt = { id: `engine-${crypto.randomUUID()}`, generationId, type: loop.type, target: isSwipe(loop.type) ? loop.target : null, connectionId: loop.connectionId, ...(loop.session !== undefined ? { session: loop.session } : {}), stoppedAt: loop.at };
    gate.running = halt.id;
    loop.run = halt.id;
    this.diag?.begin({ chatId, userId, turn: halt.id }, STEP_LABEL.engine);
    const out: { run: LoopRun; taken: Prepared | null } = { run: { kind: "failed", step: "engine", reason: "the engine run ended without a turn; generate again" }, taken: null };
    try {
      await this.engine(chatId, userId, halt, null, {
        generationId,
        done: (run, taken) => {
          out.run = run;
          out.taken = taken;
        },
      });
    } finally {
      loop.run = null;
    }
    // What the run recorded follows the generation, and so does its pre-reply window (P2).
    if (out.run.kind === "delivered" && out.taken) await this.adopt(chatId, userId, out.taken, generationId);
    return out.run;
  }

  /** What A2's depth turn made for a loopback generation (DEPTH-PLAN §1.3): its commit records `pre` and the read part `read` in place of reading the reply. */
  sceneCommit(generationId: string, scene: SceneCommit): void {
    this.scenes.set(generationId, scene);
    if (this.scenes.size > 64) this.scenes.delete(this.scenes.keys().next().value ?? "");
  }

  /** Whether LumiRPEngine deleted this message itself: a loopback send's blank reply, stopped before any text. */
  deletedByEngine(messageId: MessageId): boolean {
    return this.ownDeletes.has(messageId);
  }

  /**
   * A generation that runs without the engine (DESIGN §5.1): Impersonate, which writes the player's
   * next message, and any generation of a chat on depth off the loopback (DEPTH-PLAN §3.4). It goes
   * on from a book that holds no engine section, so no mind or secret and nothing of another turn
   * reaches it: it takes the world's book for its prompt (`claim`), then empties whatever an earlier
   * turn left there (a restart, a clear the host refused), and gives the book back once its prompt is
   * assembled. Sections that can't be emptied stop it, and the chat says why.
   */
  private async plain(chatId: ChatId, gate: Gate, started: GenerationStartedEvent | null, signal: AbortSignal): Promise<ContextVerdict> {
    const owner = started?.generationId ?? `plain-${crypto.randomUUID()}`;
    if (!(await this.claim(gate.worldId, chatId, owner, "plain", { chatId, userId: gate.userId }, signal))) return "cancel";
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

  /**
   * The generation the guard let through takes the prepared plan; what the engine run recorded
   * follows it, and so does what the run's pre-reply window holds, which lands as this turn closes
   * (P2).
   */
  private adopt(chatId: ChatId, userId: UserId, p: Prepared, generationId: string): Promise<void> {
    return this.run(chatId, userId, async (core, observed) => {
      // A kept turn's failed reply closed its turn in diagnostics: its retry is one of its own there.
      if (p.kept !== null) this.diag?.begin({ chatId, userId, turn: generationId }, STEP_LABEL.reply ?? "Waiting for the reply…");
      if (p.turn && !core.adopt(generationId, p.turn)) this.diag?.failed({ chatId, userId, turn: p.kept === null ? p.id : generationId }, "plan", "plan", "the reply's generation couldn't take the prepared plan, so this turn commits without it");
      if (p.kept === null) core.handOver(p.id, generationId, observed);
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
   * A generation's prompt is assembled, or it ended or stopped: one without the engine gives the
   * book back, and the turn a reply took gives it back with its entries emptied (DESIGN §6.4). That
   * turn is held as taken until its reply's end says whether it is kept for a retry (`afterReply`).
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

  /** The book a generation without the engine held for its prompt goes back, found by its generation (its chat's guard state may be gone). */
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
   * engine runs again, whose turn takes over what the run's pre-reply window holds (`prepare`). A
   * write the host refuses stops the generation, and the chat says why; like a host that stopped
   * waiting, that ends the run without a reply (P2).
   */
  private async fill(chatId: ChatId, gate: Gate, p: Prepared, generationId: string, signal: AbortSignal): Promise<ContextVerdict | "moved"> {
    p.generationId = generationId;
    // A reply only the player starts (Send, a kept turn's retry) takes its time from here, not from the wait for them.
    if (p.as === "send" || p.kept !== null) p.readyAt = Date.now();
    const userId = gate.userId;
    if (!(await this.claim(gate.worldId, chatId, p.id, "turn", { chatId, userId }, signal))) {
      // The host stopped waiting: no prompt is assembled for it.
      gate.prepared = null;
      this.letGo(gate.worldId, p.id);
      this.endRun(chatId, userId, p);
      this.gone(chatId, userId, p, "dropped");
      return "cancel";
    }
    const hooks = this.hooks;
    // Written on what the turn runs on, as its sections were made.
    const writing = hooks ? inTurn(p.frame, () => hooks.fill(chatId, userId, p.delivered)) : Promise.resolve<"filled" | "moved">("filled");
    p.writing = writing.then(
      () => undefined,
      () => undefined,
    );
    try {
      if ((await writing) === "moved") {
        gate.prepared = null;
        this.letGo(gate.worldId, p.id);
        this.gone(chatId, userId, p, "dropped");
        this.diag?.end({ chatId, userId, turn: p.id }, { status: "skipped", reason: "the preset this chat generates with changed after the engine ran; the engine runs again" });
        return "moved";
      }
    } catch (error) {
      gate.prepared = null;
      this.drop(chatId, userId, p);
      this.endRun(chatId, userId, p);
      this.gone(chatId, userId, p, "failed");
      const reason = messageOf(error);
      this.diag?.end({ chatId, userId, turn: p.id }, { status: "failed", reason: `sections: ${reason}` });
      void this.hooks?.failed({ chatId, userId, turn: p.id, step: "sections", reason, as: p.as }).catch((e: unknown) => this.diag?.error({ chatId, userId, turn: p.id }, "guard", e, "the failure flag wasn't shown"));
      return "cancel";
    }
    void this.adopt(chatId, userId, p, generationId);
    return "go";
  }

  /**
   * The world's book for `owner` (DESIGN §6.4): it holds one owner's sections at a time, and only
   * while a prompt is assembled from it, so every hold is short. This chat's own earlier generation,
   * a reply or one without the engine (`plain`), gives way: Lumiverse runs one generation per chat at
   * a time, so a newer one here means it is over, though its end was never heard. Anything else
   * holding the book (a reply's guard writing it, another chat's prompt being assembled, an engine
   * run placing its entries, entries being emptied) is waited for, never taken over. False when the
   * host stopped waiting for the guard meanwhile.
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
        this.gone(lease.chatId, holder.userId, p, "dropped");
        continue;
      }
      if (lease.kind === "plain" && lease.chatId === chatId) {
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
   * with a Retry. The run is the turn's work, on what the turn runs on (`TurnHooks.frame`), taken as
   * it starts; when that can't be taken, the run fails at its start as a failed step does.
   */
  private engine(chatId: ChatId, userId: UserId, halt: Halt, kind: GenerationKind | null, loop?: LoopTake): Promise<void> {
    const at = { chatId, userId, turn: halt.id };
    // How the run ends, for what the runtime kept for it alone (`TurnHooks.ran`).
    let ending: RunOutcome = "failed";
    const plan = async (core: LedgerCore, observed: ChainMessage[], frame: TurnFrame | EngineFailure | null): Promise<void> => {
      const gate = this.gates.get(chatId);
      const hooks = this.hooks;
      // Only the gate that stopped the generation, still the chat's: a run never prepares a turn on another.
      if (!gate || gate.running !== halt.id || !hooks || frame === null) {
        this.diag?.end(at, { status: "failed", reason: "the engine lost track of the stopped reply, so nothing was generated; generate again" });
        loop?.done({ kind: "failed", step: "engine", reason: "the engine lost track of this reply; generate again" }, null);
        return;
      }
      core.sync(observed);
      // The kind the generation started as (a swipe's is the user's swipe setting's, DEPTH-PLAN §3.9), as its GENERATION_STARTED journaled it.
      const turnKind = kind ?? core.journal.pending[loop?.generationId ?? ""]?.kind ?? KIND[halt.type];
      // The chain and journal the plan reads; a change to either before the restart makes it stale.
      gate.mirror = mirrorOf(observed);
      const epoch = gate.epoch;
      const stamp = chainStamp(gate.mirror, halt.type, halt.target);
      const earlier = gate.prepared;
      if (earlier) {
        gate.prepared = null;
        this.diag?.end({ chatId, userId, turn: earlier.id }, { status: "skipped", reason: "the chat changed before its reply; the engine ran again" });
        await this.unfill(chatId, userId, earlier);
        this.gone(chatId, userId, earlier, "dropped");
      }
      const target = halt.target ? observed.find((m) => m.id === halt.target) : undefined;
      // A stopped Regenerate or swipe leaves its blank swipe (the frontend that started a swipe
      // removes it too, the same last swipe); the restart adds the new one in its place. The swipe
      // that showed as it was added shows again: the turn is made from it (P3, L43), and the
      // restart adds its swipe from it as the Regenerate did.
      const blank = target !== undefined && target.swipes.length > 1 && target.swipes.at(-1) === "";
      // A loopback generation goes on, so its blank swipe is the one its reply goes into (DEPTH-PLAN §3.12).
      if (target && blank && !loop) {
        const shown = core.addedSwipeFrom(target.id, target.swipes.length - 1) ?? Math.min(target.swipeId, target.swipes.length - 2);
        await this.host.chats.setSwipes(chatId, target.id, target.swipes.slice(0, -1), shown, userId).catch((error: unknown) => this.diag?.error(at, "restart", error, "the stopped Regenerate's empty swipe stays"));
      }
      const head = observed.findLast((m) => !m.isUser);
      const swipeId = target ? target.swipes.length - (blank ? 1 : 0) : halt.type === "continue" ? (head?.swipeId ?? null) : 0;
      core.prepare({ generationId: halt.id, kind: turnKind, targetMessageId: target?.id ?? null, targetSwipeId: swipeId }, observed);
      // Wherever the run stops short of a turn that waits for its reply, it ends without one (P2),
      // and its pre-reply window closes. Nothing made during the run has reached the journal (writes
      // wait on this queue), so it closes here at once and they land after it in the order they were
      // made. What it took over from a turn it replaced lands on the queue instead, on the chain as it
      // stands then, never on the blank swipe a stopped Regenerate left in `observed`.
      const ended = (): void => {
        if (core.journal.held.some((h) => h.waitFor.includes(halt.id))) this.endRun(chatId, userId, { id: halt.id, kept: null });
        else core.endRun(halt.id, observed);
      };
      // How the reply starts again, once the run has prepared it or its failure card's Retry asks.
      const as = restartAs(halt.type, observed);
      const flight = this.flight(chatId);
      const signal = flight.signal;
      // A cancel between steps ends the run there; one inside a step aborts its calls through `signal`.
      const going = (): void => {
        if (signal.aborted) throw new TurnCancelled();
      };
      const step = <T>(phase: "pre" | "plan" | "prose" | "sections", fn: () => Promise<T>): Promise<T> => (this.diag ? this.diag.step(at, phase, phase, fn) : fn());
      // A step that is one part of the turn's time as well ("Where the last turn's time went").
      const timed = <T>(name: TurnPhaseName, fn: () => Promise<T>): Promise<T> => (this.diag ? this.diag.phased(at, name, fn) : fn());
      let delivered: Delivered | null = null;
      let claimed = false;
      try {
        // What the turn runs on couldn't be taken as the run started: it fails here, before any step.
        if (frame instanceof EngineFailure) throw frame;
        // Lumiverse starts only the last reply again, so a reply for an earlier message (Edit and Send
        // in place, a swipe of an earlier reply) is refused before any model call, never sent to the last one.
        if (halt.target !== null && observed.at(-1)?.id !== target?.id) throw new EngineFailure("target", NOT_LAST_REPLY);
        const pre = await step("pre", () => hooks.beforePlan({ chatId, userId, core, observed, generationId: halt.id, connectionId: halt.connectionId, runKey: `${stamp}\u0000${epoch}`, signal }));
        going();
        // The chat now asks the player something (a claim under Ask first, DESIGN §9.4, or a preview
        // gate, §5.1): the run waits on the answer, with nothing generated and no restart; the answer's
        // Regenerate runs it again.
        const waiting = (outcome: PreOutcome): void => {
          ending = "waiting";
          core.take(halt.id);
          ended();
          this.diag?.end(at, { status: "skipped", reason: outcome.waiting });
          loop?.done({ kind: "waiting", reason: outcome.waiting }, null);
        };
        // An agent turn its roles stopped goes no further: it plans nothing, no gate hides the stop,
        // and nothing it staged lands. A classic turn has no such stop (`stoppedRun`).
        this.stoppedRun(at);
        if (pre) return waiting(pre);
        await timed("plan", () => step("plan", async () => core.plan(halt.id, observed, false)));
        const held = await timed("brief", () => step("prose", () => hooks.afterPlan({ chatId, userId, core, observed, generationId: halt.id, as, signal })));
        going();
        this.stoppedRun(at);
        if (held) return waiting(held);
        this.failedStep(at);
        // The book is taken only while the run makes and places its entries: it writes no section.
        // A cancel while it waits for another chat's book ends the run there.
        if (!(await this.claim(gate.worldId, chatId, halt.id, "turn", at, signal))) throw new TurnCancelled();
        claimed = true;
        try {
          delivered = await step("sections", () => hooks.deliver({ chatId, userId, core, observed, generationId: halt.id, stopped: halt.generationId }));
        } finally {
          this.letGo(gate.worldId, halt.id);
        }
        // A cancel while the sections were made ends the run before it prepares the turn.
        going();
        this.failedStep(at);
        // The final review (DESIGN §4.6), with the book let go: the guard writes what it leaves. A
        // review its settings stop the turn on fails the run here, as a role under `stop` does.
        if (hooks.finalReview) {
          delivered = await hooks.finalReview({ chatId, userId, core, observed, generationId: halt.id, delivered, signal });
          going();
          this.stoppedRun(at);
        }
      } catch (error) {
        core.take(halt.id);
        ended();
        if (claimed) this.letGo(gate.worldId, halt.id);
        // Cancelled: its own end, not a failure. No flag and no Retry chip; the player's message
        // stays, so Regenerate (or sending again) runs the turn anew.
        if (signal.aborted) {
          ending = "cancelled";
          this.diag?.end(at, { status: "skipped", reason: "you cancelled the turn; nothing was generated" });
          loop?.done({ kind: "cancelled" }, null);
          return;
        }
        const failure = error instanceof EngineFailure ? error : new EngineFailure("engine", messageOf(error));
        this.diag?.end(at, { status: "failed", reason: `${failure.step}: ${failure.message}` });
        await hooks.failed({ chatId, userId, turn: halt.id, step: failure.step, reason: failure.message, as }).catch((e: unknown) => this.diag?.error(at, "engine", e, "the failure flag wasn't shown"));
        loop?.done({ kind: "failed", step: failure.step, reason: failure.message }, null);
        return;
      } finally {
        this.landed(chatId, flight);
      }
      const turn = core.take(halt.id);
      if (loop) {
        // A loopback generation takes its turn at once (DEPTH-PLAN §3.12): no page restarts it, and the
        // sections go into the narrator's prompt instead of the book. A change to the chat while the
        // engine ran makes the turn stale, as it does a prepared one: nothing is written for it.
        const taken: Prepared = { id: halt.id, type: halt.type, target: target?.id ?? null, turn: turn?.planned ? turn : null, stamp, epoch, frame, worldId: gate.worldId, delivered, writing: null, as, holder: null, generationId: loop.generationId, kept: null, failedSwipe: null, readyAt: Date.now() };
        const changed = this.changedSince(gate, taken);
        if (changed !== null) {
          ended();
          const reason = `${changed} while the engine ran, so this reply wasn't written; generate again`;
          this.diag?.end(at, { status: "failed", reason });
          loop.done({ kind: "failed", step: "stale", reason }, null);
          return;
        }
        gate.taken = taken;
        ending = "prepared";
        // The kind the plan settled on, as a kept turn's retry has it: a Re-narrate with nothing to tell again plays as a Re-run.
        loop.done({ kind: "delivered", turn: taken.turn, delivered, as: taken.turn?.kind ?? turnKind }, taken);
        return;
      }
      // The page to start it: the one the stopped generation ran for when it shows the chat, unless it
      // never said so and another page did; else the page that last said it shows the chat; with none,
      // the first page to show the chat claims it (`askAgain`).
      const viewer = this.viewerOf(chatId, userId);
      const holder = halt.session !== undefined && (this.reports(halt.session, chatId) || (viewer === null && this.shows(halt.session, chatId))) ? halt.session : viewer;
      const prepared: Prepared = { id: halt.id, type: halt.type, target: target?.id ?? null, turn: turn?.planned ? turn : null, stamp, epoch, frame, worldId: gate.worldId, delivered, writing: null, as, holder, generationId: null, kept: null, failedSwipe: null, readyAt: Date.now() };
      gate.prepared = prepared;
      ending = "prepared";
      // A change to the chat while the engine ran makes the turn stale at once: nothing is generated.
      this.dropIfStale(chatId);
      if (this.gates.get(chatId)?.prepared !== prepared) {
        ended();
        return;
      }
      // A page asked to start it starts it at once; "reopen the chat" is for when no page shows the chat.
      this.diag?.rest(at, as === "send" ? (STEP_LABEL.ready ?? "Ready: press Send for the reply") : holder !== null || !this.host.capabilities.sessions ? (STEP_LABEL.reply ?? "Waiting for the reply…") : (STEP_LABEL.restart ?? "Ready; reopen the chat to continue"));
      // A host that names no page asks every page.
      if (prepared.holder !== null) this.host.frontend.send(restartPush(chatId, prepared), userId, prepared.holder);
      else if (!this.host.capabilities.sessions) this.host.frontend.send(restartPush(chatId, prepared), userId);
    };
    return this.run(chatId, userId, async (core, observed) => {
      // The run's wait for the chat, from the guard's stop: the writes and turns ahead of it on its queue, or the chat's opening.
      this.diag?.phase(at, { name: "wait", ms: Date.now() - halt.stoppedAt });
      // What the turn runs on, as its run starts: the settings and the chat's own choices as they
      // stand. A read of them that fails fails the run as a failed step does (its Diagnostics record,
      // the engine-failed card and its Retry), never silently; that run has no frame to run in.
      const frame = this.hooks ? await this.hooks.frame(chatId, userId, { core, observed }).catch((error: unknown) => new EngineFailure("engine", `${FRAME_UNREAD} (${messageOf(error)})`)) : null;
      await (frame === null || frame instanceof EngineFailure ? plan(core, observed, frame) : inTurn(frame, () => plan(core, observed, frame)));
    }).finally(() => {
      this.ran(chatId, halt.id);
      this.hooks?.ran?.({ chatId, userId, turn: halt.id, outcome: ending });
    });
  }

  /** Stops the engine run at its first failed step, with that step's reason. */
  private failedStep(at: { chatId: ChatId; userId: UserId; turn: string }): void {
    const failure = this.diag?.failure(at);
    if (failure) throw new EngineFailure(failure.step, failure.reason);
  }

  /** Stops an agent turn's engine run on what stopped it (a role under `stop`, its main agent's failure): the turn's fatal record. A classic turn has none. */
  private stoppedRun(at: { chatId: ChatId; userId: UserId; turn: string }): void {
    const stop = this.diag?.stopped(at);
    if (stop) throw new EngineFailure(stop.step, stop.reason);
  }

  /**
   * Stops the chat's engine run or reply read under way (DESIGN §5.1), when the chat is `userId`'s:
   * false when nothing of theirs runs. `why` says what stopped it when the player didn't (an agent
   * role failing under `stop`).
   */
  cancel(chatId: ChatId, userId: UserId, why?: string): boolean {
    const flight = this.inFlight.get(chatId);
    if (!flight || flight.signal.aborted || this.gates.get(chatId)?.userId !== userId) return false;
    flight.abort(why === undefined ? new TurnCancelled() : new Error(why));
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

  /** A reply event's message: the swipe it shows now, in the events' order (`shown`), for a chat whose ledger is in memory or opening. */
  private show(chatId: ChatId, message: HostMessage): void {
    if (message.isUser || !(this.chats.has(chatId) || this.opening.has(chatId))) return;
    const replies = this.shown.get(chatId) ?? new Map<MessageId, number>();
    replies.set(message.id, message.swipeId);
    this.shown.set(chatId, replies);
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

  /**
   * A user write from the frontend (a chip's Apply or Undo, a ✎ fix, a GM edit, a mechanical action,
   * materialization, a marker, Keep/Discard, Re-read), or an agent's. One made while a turn is under
   * way (from the guard's stop until that turn's reply ends) waits for the turn (P2): the run's
   * pre-reply window holds it, so it never makes the turn stale and the reply starts as planned; its
   * reply's window closing lands it, over what the turn did, or the run ending without a reply
   * (`endRun`). Any other lands at once, and a turn kept from a failed reply goes with it.
   *
   * `answerQueued`: a write made from the page (Build C item 6). While the engine run itself holds
   * the chat's queue, the write waits behind it to be held, so it answers at once that it is queued
   * and what it waits on, and lands as every held write does, its Undo with it: the page never waits
   * on the run. One its op then refuses outright (the run ended without a reply, and the write no
   * longer applies) is kept with its reason as a held write that can't land is (`LedgerCore.refuse`),
   * so the player's notice tells them, and is told as its refusal is (`writesLanded`); Diagnostics says why.
   * Without it (an agent's write: the assistant's, the minds run's), the answer waits for the op, so
   * it says what the op made of the write: held, landed or refused.
   */
  async write(chatId: ChatId, userId: UserId, w: HeldWrite, opts: { answerQueued?: boolean } = {}): Promise<WriteResult & { queued?: QueuedOn }> {
    const gate = this.gates.get(chatId);
    const early = gate !== undefined && (gate.running !== null || (gate.prepared !== null && gate.prepared.kept === null) || gate.taken !== null);
    // What a write held now waits on, as it is made: a window that opened since is a reply's.
    const on = this.queuedOn(chatId);
    const answerNow = opts.answerQueued === true && Boolean(gate?.running);
    // Answered now and paused (an earlier message edited, Keep or Discard first): refused now, as its op would refuse it.
    if (answerNow && (this.chats.get(chatId)?.core.journal.pauses.length ?? 0) > 0 && w.kind !== "keep" && w.kind !== "discard") return { applied: false, pending: false, reason: "paused" };
    if (!early) this.wrote(chatId);
    let result: WriteResult = { applied: false, pending: false, reason: "not a world chat" };
    const landing = this.run(
      chatId,
      userId,
      async (core, observed) => {
        core.sync(observed);
        result = core.write(w, observed, early);
        if (early && result.pending) this.unbumped.add(w.id);
        if (!result.applied) {
          if (!answerNow || result.pending) return;
          // Answered queued, then refused as it reached the chat: kept for the player's notice and told as a held write's refusal is.
          const reason = result.reason ?? "the write was refused";
          core.refuse(w, reason, observed);
          this.diag?.failed({ chatId, userId, turn: null }, "request", "write", `a write made while the engine ran didn't land: ${reason}`);
          await this.hooks?.writesLanded({ chatId, userId, core, observed, writes: [], refused: [{ write: w, reason, messageId: core.chain(observed).findLast((m) => !m.isUser)?.id ?? null }] });
          return;
        }
        // One the window would have held finds its run already ended without a reply: it lands now,
        // as the run's other writes did, so what was planned before it is stale.
        if (early) this.wrote(chatId);
        await this.hooks?.writesLanded({ chatId, userId, core, observed, writes: [w], refused: [] });
      },
      w,
    );
    if (answerNow) {
      landing.catch((error: unknown) => this.diag?.error({ chatId, userId, turn: null }, "ledger", error, "a write made while the engine ran didn't land"));
      return { applied: false, pending: true, queued: on ?? "engine" };
    }
    await landing;
    return result.pending ? { ...result, queued: on ?? "reply" } : result;
  }

  /**
   * Writes that land together, at once, in one operation on the chat's queue (Tell or Don't tell,
   * DESIGN §11: an entry taken back, then made again): `make` reads the chat as that operation finds
   * it and answers the writes, none (nothing to do), or its own refusal. Each is made only once the
   * one before it applied, and nothing lands between them. None is ever held, which would land one
   * and not the next: `make` refuses while a turn is queued or under way (`queuedOn`), and a reply's
   * window found open refuses them all the same.
   */
  async writeTogether<E>(chatId: ChatId, userId: UserId, make: (core: LedgerCore, observed: ChainMessage[]) => readonly HeldWrite[] | { refused: E }): Promise<WriteResult | { refused: E }> {
    let result: WriteResult | { refused: E } = { applied: false, pending: false, reason: "not a world chat" };
    await this.run(chatId, userId, async (core, observed) => {
      core.sync(observed);
      const made = make(core, observed);
      if ("refused" in made) {
        result = made;
        return;
      }
      if (made.length === 0) {
        result = { applied: false, pending: false };
        return;
      }
      if (core.journal.windows.length > 0) {
        result = { applied: false, pending: false, reason: "a reply is under way" };
        return;
      }
      this.wrote(chatId);
      const landed: HeldWrite[] = [];
      for (const w of made) {
        result = core.write(w, observed);
        if (!result.applied) break;
        landed.push(w);
      }
      if (landed.length > 0) await this.hooks?.writesLanded({ chatId, userId, core, observed, writes: landed, refused: [] });
    });
    return result;
  }

  /**
   * What a write made now would wait on (DESIGN §5.1, P2), or null when it would land at once: the
   * engine run planning the chat's turn; the page that starts the reply of a turn the engine
   * prepared (none may be open: the turn then waits until the chat is opened in Lumiverse); or a
   * reply under way, this backend's or one whose window the journal holds.
   */
  queuedOn(chatId: ChatId): QueuedOn | null {
    const gate = this.gates.get(chatId);
    if (gate?.running) return "engine";
    if (gate?.prepared && gate.prepared.kept === null) return gate.prepared.generationId === null ? "page" : "reply";
    if (gate?.taken) return "reply";
    return (this.chats.get(chatId)?.core.journal.windows.length ?? 0) > 0 ? "reply" : null;
  }

  /** Restart recovery and chat open: classify against the snapshot, and close the windows a stopped backend left open (never a turn under way here). */
  async open(chatId: ChatId, userId: UserId): Promise<void> {
    await this.run(chatId, userId, (core, observed) => {
      core.sync(observed);
      const slot = this.chats.get(chatId);
      // A turn this backend's engine run plans, or that waits here for its reply, keeps its pre-reply window.
      const gate = this.gates.get(chatId);
      const live = [gate?.running, gate?.prepared && gate.prepared.kept === null ? gate.prepared.id : null];
      const gone = new Set([...(slot?.leftOpen ?? [])].filter((id) => !this.generating.has(id) && !live.includes(id)));
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

  /** Lets a chat's ledger go from memory, with what the events told of its replies' shown swipes (`shown`); it opens again from its journal and snapshots. */
  private unload(chatId: ChatId): void {
    this.chats.delete(chatId);
    this.shown.delete(chatId);
  }

  /** Drops a chat's cached slot, guard state and copy of its messages (after attaching a world, or detaching one); a turn it prepared gives its entries back. */
  forget(chatId: ChatId): void {
    this.unload(chatId);
    for (const key of [...this.notWorld]) if (key.endsWith(`\u0000${chatId}`)) this.notWorld.delete(key);
    this.forgetMessages(chatId);
    const gate = this.gates.get(chatId);
    this.gates.delete(chatId);
    const p = gate?.prepared;
    if (gate && p) {
      this.drop(chatId, gate.userId, p);
      this.gone(chatId, gate.userId, p, "dropped");
    }
  }

  /**
   * Whether the chat holds what only memory keeps: an operation queued or running, a turn in flight,
   * or a turn its gate holds from the guard's stop to the end of its engine run, while a prepared turn
   * waits, while a reply holds it and until a late reply's read runs.
   */
  busy(chatId: ChatId): boolean {
    const slot = this.chats.get(chatId);
    const gate = this.gates.get(chatId);
    if (slot && (slot.ops > 0 || slot.core.inFlight)) return true;
    return gate !== undefined && this.holdsTurn(gate);
  }

  /** Whether the chat's gate holds a turn: from the guard's stop through its engine run, a prepared turn waiting, the reply that took it, a late reply's read. */
  private holdsTurn(gate: Gate): boolean {
    return gate.prepared !== null || gate.halt !== null || gate.taken !== null || gate.running !== null || gate.reading !== null;
  }

  /**
   * Whether a turn of the user's is under way in any of their chats (DESIGN §4.4: no sweep runs
   * meanwhile): a generation in flight or a turn pending in an open chat's journal, a turn its gate
   * holds, or an engine run or reply read still working.
   */
  turning(userId: UserId): boolean {
    for (const [chatId, slot] of this.chats) if (slot.userId === userId && (slot.core.inFlight || Object.keys(slot.core.journal.pending).length > 0 || this.inFlight.has(chatId))) return true;
    for (const [chatId, gate] of this.gates) if (gate.userId === userId && (this.holdsTurn(gate) || this.inFlight.has(chatId))) return true;
    return false;
  }

  /**
   * The journals of the user's open chats as they stand (DESIGN §4.4): the sweep reads what they hold
   * that message metadata may not yet, a record not yet flushed, a held write or a pending turn.
   */
  journals(userId: UserId): Journal[] {
    const out: Journal[] = [];
    for (const slot of this.chats.values()) if (slot.userId === userId) out.push(slot.core.journal);
    return out;
  }

  /**
   * A turn's agent session blobs written into its record (`LedgerCore.recordSession`) from outside
   * the turn's own operation, on the chat's queue; a turn's hooks run inside its operation and call
   * the core they are given. Refused as well while the chat's gate holds a turn, since a prepared
   * turn waits outside the journal (DESIGN §5.1). Null once written, else why it wasn't.
   */
  async recordSession(chatId: ChatId, userId: UserId, messageId: MessageId, swipeId: number, session: RecSession): Promise<string | null> {
    let refused: string | null = "the chat plays no world";
    await this.run(chatId, userId, (core, observed) => {
      const gate = this.gates.get(chatId);
      refused = gate && this.holdsTurn(gate) ? "the next turn is already under way" : core.recordSession(messageId, swipeId, session, observed);
    });
    return refused;
  }

  /** The chats a page shows on screen, as the pages last said (hello, resync, `lre.page`). */
  viewed(): Set<ChatId> {
    const out = new Set<ChatId>();
    for (const page of this.pages.values()) if (page.chatId !== null && page.viewing) out.add(page.chatId);
    return out;
  }

  /**
   * Lets go of the open chats `keep` doesn't name that hold nothing only memory keeps (the memory
   * budget, DESIGN §9.6): each opens again from its journal and snapshots, as one evicted past
   * `OPEN_CHATS_CAP` does. The chats let go.
   */
  trim(keep: (chatId: ChatId) => boolean): ChatId[] {
    const gone: ChatId[] = [];
    for (const id of [...this.chats.keys()]) {
      if (keep(id) || this.busy(id)) continue;
      this.unload(id);
      gone.push(id);
    }
    return gone;
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

  /**
   * What a chat's view reads of its ledger, as one string: the journal as last written, the chain's
   * key (its messages, their records and markers, as a fold reads them), the turn kept from a failed
   * reply and the notices. Equal stamps build equal views of the ledger.
   */
  private viewStamp(chatId: ChatId, slot: ChatSlot, messages: readonly HostMessage[]): string {
    const keys = slot.core.foldKeys(this.observe(chatId, slot.userId, messages));
    return JSON.stringify([slot.written, keys.steps.at(-1) ?? keys.root, this.keptOf(chatId), this.notices(chatId, slot.userId)]);
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
    let edited: PlayerEdit | null = null;
    void this.run(chatId, userId, (core, observed) => {
      if (kind !== "deleted") this.markSaved(core, observed, messageId, kind);
      if (kind === "edited") edited = acceptedEdit(core, observed, messageId, () => core.sync(observed));
      else core.sync(observed);
    }).then(() => this.edited(chatId, userId, messageId, edited));
  }

  /** `from`: on `added`, the swipe that showed as it was added, as the events told it (`shown`); undefined when none had told it since the backend started. */
  private onSwiped(chatId: ChatId, userId: UserId | null, messageId: MessageId, action: string, swipeId: number, from?: number): void {
    let edited: PlayerEdit | null = null;
    void this.run(chatId, userId, (core, observed) => {
      if (action !== "updated") {
        core.sync(observed, action === "deleted" ? { messageId, swipeId } : undefined);
        if (action === "added" && from !== undefined) core.swipeAdded(messageId, swipeId, from);
        return;
      }
      this.markSaved(core, observed, messageId, "edited");
      edited = acceptedEdit(core, observed, messageId, () => core.sync(observed));
    }).then(() => this.edited(chatId, userId, messageId, edited));
  }

  /** Tells the hooks the player's edit of a message (`TurnHooks.assistantEdited`), once its operation is done. */
  private edited(chatId: ChatId, userId: UserId | null, messageId: MessageId, edit: PlayerEdit | null): void {
    if (edit !== null && userId !== null) this.hooks?.assistantEdited?.({ chatId, userId, messageId, ...edit });
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
      // The chat's layer; a branch copies in what it inherits of its ancestor's at its first open (DEPTH-PLAN §4.9).
      const opened = (id: ChatId): LayerStore | undefined => {
        const open = this.chats.get(id);
        return open?.userId === userId ? open.layer : undefined;
      };
      const layer = await LayerStore.open(this.host, chatId, userId, () => ancestorOf(this.host, chatId, userId, env.run.runSeed, opened, toChain));
      const landing: FoldLayerEntry[] = [];
      const folds = (): readonly FoldLayerEntry[] => (landing.length > 0 ? [...layer.fold, ...landing] : layer.fold);
      // A stamped journal differs from the stored text, so the next persist writes it.
      const slot: ChatSlot = { core: new LedgerCore(journal, { ...env, snapshots, layer: folds }, this.folder(userId)), userId, queue: Promise.resolve(), written: reset || raw === null ? null : journalHash(raw), ops: 0, snapshots, layer, landing, reasserts: new Map(), leftOpen: new Set([...journal.windows, ...(journal.prereply ?? []), ...Object.keys(journal.pending)]), chars: { journal: raw?.length ?? 0, snapshots: stored?.length ?? 0 }, viewed: null };
      // The revisions its folds will ask for are loaded before anyone folds it.
      await slot.core.prepareWorlds(this.observe(chatId, userId, await this.host.chats.messages(chatId, userId)));
      this.chats.set(chatId, slot);
      let chars = 0;
      for (const s of this.chats.values()) chars += s.chars.journal + s.chars.snapshots + s.layer.chars;
      for (const [id, s] of this.chats) {
        if (this.chats.size <= OPEN_CHATS_CAP && chars <= OPEN_CHATS_CHARS) break;
        if (id === chatId || this.busy(id)) continue;
        this.unload(id);
        chars -= s.chars.journal + s.chars.snapshots + s.layer.chars;
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
   * is a write the operation lands (its revision is loaded first). The operation runs outside every
   * turn's frame, whoever queued it: a turn's own work enters its frame itself (`inTurn`).
   */
  private async run(chatId: ChatId, userId: UserId | null, op: Op, write?: HeldWrite): Promise<void> {
    this.outstanding++;
    try {
      const slot = await outsideTurns(() => this.slot(chatId, userId));
      if (!slot) return;
      slot.ops++;
      slot.queue = slot.queue
        .then(() => outsideTurns(async () => {
          // A kept read answers at once: the op gives way first, so a message waiting runs before its folds.
          await giveWay();
          const observed = this.observe(chatId, slot.userId, await this.host.chats.messages(chatId, slot.userId));
          await slot.core.prepareWorlds(observed, write);
          // Writes held behind a reply, or through an engine run, land as its window closes, whichever op closes it (P2).
          const held = slot.core.journal.held.map((h) => h.write);
          await op(slot.core, observed);
          const landed = held.length > 0 ? heldLanded(held, slot.core.journal) : [];
          const refused = held.length > 0 ? heldRefused(held, slot.core.journal) : [];
          if (landed.length > 0 || refused.length > 0) {
            // Those held through an engine run change the journal only now: a turn prepared before them is stale, as if each had landed at once.
            if (landed.filter((w) => this.unbumped.delete(w.id)).length > 0) this.wrote(chatId);
            await this.hooks?.writesLanded({ chatId, userId: slot.userId, core: slot.core, observed, writes: landed, refused });
          }
          // Layer results held through a turn land, checked again, once every window they wait for has closed (DEPTH-PLAN §4.9).
          if (slot.layer.held.length > 0) await this.drainLayer(chatId, slot, observed);
          await this.persist(chatId, slot);
          // What the flush marked as written is persisted with it, so the journal stands as this op left it.
          if (await this.flush(chatId, slot)) await this.persist(chatId, slot);
          // Only an operation that changed what a view reads of the ledger pushes: what else a view
          // reads (chips, the inspector, the meter) tells its own changes, or changes with the journal.
          const viewed = this.viewStamp(chatId, slot, await this.host.chats.messages(chatId, slot.userId));
          if (viewed === slot.viewed) return;
          slot.viewed = viewed;
          this.hooks?.changed(chatId, slot.userId);
        }))
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

  // ------------------------------------------------------------------ the basis-anchored layer (DEPTH-PLAN §4.9)

  /**
   * Lands a job's result in the chat's layer: on the chat's queue, its basis checked inside the
   * landing. An id already landed returns that entry and changes nothing (a job rerun after a crash
   * never lands twice); a turn in flight holds it until its window closes, when it is checked again
   * (with `wait`, it answers only then: landed or refused, as `landLayers`'s).
   * It runs on the chat's queue, so it is never awaited from inside an operation on that queue (a
   * hook the commit runs): there it would wait on itself. Land from the job's own task instead.
   */
  async landLayer(chatId: ChatId, userId: UserId, draft: LayerDraft, o: { wait?: boolean } = {}): Promise<LandResult> {
    const [out] = await this.landLayers(chatId, userId, [draft], o);
    return out ?? { status: "refused", reason: "nothing to land" };
  }

  /**
   * Lands several results in order, written together; each is checked after the ones before it. With
   * `wait`, one held while a turn is in flight answers once it has landed or been refused as its
   * windows close (`drainLayer`): a job whose next job reads what it landed waits for it (§8.2).
   * `without`: entries every check folds as superseded on both sides (`LedgerCore.layerVerdict`), the
   * old run's that a redo has yet to replace; a held result keeps them for its check as it lands.
   */
  async landLayers(chatId: ChatId, userId: UserId, drafts: readonly LayerDraft[], o: { wait?: boolean; without?: ReadonlySet<string> } = {}): Promise<LandResult[]> {
    let out: LandResult[] = drafts.map(() => ({ status: "refused", reason: "this chat has no world ledger" }));
    const waits: { i: number; outcome: Promise<LandResult> }[] = [];
    const without = o.without && o.without.size > 0 ? { without: [...o.without] } : {};
    await this.run(chatId, userId, async (core, observed) => {
      const slot = this.chats.get(chatId);
      if (!slot) return;
      out = await this.landNow(slot, core, observed, drafts.map((draft) => ({ draft, ...without })), true);
      // Asked for on the queue, as it holds them: no drain can come before.
      if (o.wait) for (const [i, r] of out.entries()) if (r.status === "held") waits.push({ i, outcome: this.heldOutcome(chatId, drafts[i]?.id ?? "") });
    });
    for (const w of waits) out[w.i] = await w.outcome;
    return out;
  }

  /** How held draft `id` went, once the drain that lands or refuses it has run. */
  private heldOutcome(chatId: ChatId, id: string): Promise<LandResult> {
    const key = `${chatId}\u0000${id}`;
    let wait = this.heldWaits.get(key);
    if (!wait) {
      wait = Promise.withResolvers<LandResult>();
      this.heldWaits.set(key, wait);
    }
    return wait.promise;
  }

  private async landNow(slot: ChatSlot, core: LedgerCore, observed: readonly ChainMessage[], items: readonly Pick<HeldDraft, "draft" | "without">[], hold: boolean): Promise<LandResult[]> {
    const open = [...core.journal.windows, ...(core.journal.prereply ?? [])];
    // Each draft's outcome, or `null` for one accepted here, which the store's write lands.
    const results: (LandResult | null)[] = [];
    const accepted: LayerDraft[] = [];
    try {
      for (const { draft: d, without } of items) {
        const landed = slot.layer.get(d.id);
        const problem = landed ? null : layerDraftProblem(d);
        if (landed) results.push({ status: "landed", entry: landed, existing: true });
        else if (problem) results.push({ status: "refused", reason: problem });
        else if (accepted.some((a) => a.id === d.id)) results.push({ status: "refused", reason: `the id ${d.id} comes twice in one landing` });
        else if (hold && open.length > 0) {
          await slot.layer.hold(d, open, without);
          results.push({ status: "held", waitFor: open });
        } else {
          const verdict = core.layerVerdict(d, observed, without ? new Set(without) : undefined);
          if ("reason" in verdict) results.push({ status: "refused", reason: verdict.reason });
          else {
            accepted.push(d);
            slot.landing.push(foldEntryOf(d));
            results.push(null);
          }
        }
      }
      const made = new Map((await slot.layer.append(accepted)).map((e) => [e.id, e]));
      return results.map((r, i): LandResult => {
        if (r) return r;
        const entry = made.get(items[i]?.draft.id ?? "");
        return entry ? { status: "landed", entry } : { status: "refused", reason: "it could not be stored" };
      });
    } finally {
      slot.landing.length = 0;
    }
  }

  /**
   * Lands the held results whose windows have closed, each checked again (DEPTH-PLAN §4.9). One
   * refused then is logged, and the player reads why (a toast): his own (an edit, a switch, a drop,
   * an answer, a tap), which he was told lands once the reply is kept, and any other whose message
   * still stands, which the reply left no room for. Work whose message the turn swiped or deleted
   * away went with it, unsaid.
   */
  private async drainLayer(chatId: ChatId, slot: ChatSlot, observed: readonly ChainMessage[]): Promise<void> {
    const open = new Set([...slot.core.journal.windows, ...(slot.core.journal.prereply ?? [])]);
    const ready = await slot.layer.release(open);
    if (ready.length === 0) return;
    const results = await this.landNow(slot, slot.core, observed, ready, false);
    const chain = slot.core.chain(observed);
    results.forEach((r, i) => {
      const d = ready[i]?.draft;
      if (!d) return;
      const key = `${chatId}\u0000${d.id}`;
      this.heldWaits.get(key)?.resolve(r);
      this.heldWaits.delete(key);
      if (r.status !== "refused") return;
      this.host.log("info", `[LumiRPEngine] chat ${chatId}: a held ${d.kind} result (${d.id}) didn't land: ${r.reason}`, slot.userId);
      const own = d.by?.role === "user" || d.by?.role === "player";
      if (own || basisIndex(chain, slot.core.journal.tombstones, d.basis) >= 0) this.host.toast(`${own ? "Your change" : "Work"} made while the reply was written wasn't kept: ${r.reason}`, slot.userId);
    });
  }

  /** The chat's own landed entries, without their events: for resuming and listing; with `inherited`, also the entries it inherits as a branch, in its own message ids. */
  async layerSummaries(chatId: ChatId, userId: UserId, o: { inherited?: boolean } = {}): Promise<LayerSummary[]> {
    let out: LayerSummary[] = [];
    await this.run(chatId, userId, () => {
      out = this.chats.get(chatId)?.layer.summaries(o) ?? [];
    });
    return out;
  }

  /** One landed entry by id, the chat's own or one it inherited as a branch; null when there is none. */
  async readLayerEntry(chatId: ChatId, userId: UserId, id: string): Promise<LayerEntry | null> {
    let out: LayerEntry | null = null;
    await this.run(chatId, userId, () => {
      out = this.chats.get(chatId)?.layer.get(id) ?? null;
    });
    return out;
  }

  /** The basis a job reading through `messageId` records (the chain's last message by default); null when it isn't on the chain. */
  async basisFor(chatId: ChatId, userId: UserId, messageId?: MessageId): Promise<Basis | null> {
    const bases = await this.chainBases(chatId, userId);
    return (messageId === undefined ? bases.at(-1) : bases.find((b) => b.message === messageId)) ?? null;
  }

  /** Every message's basis on the active chain, in order. */
  async chainBases(chatId: ChatId, userId: UserId): Promise<Basis[]> {
    let out: Basis[] = [];
    await this.run(chatId, userId, (core, observed) => {
      out = chainBases(core.chain(observed), core.journal.tombstones);
    });
    return out;
  }

  /**
   * What a job reads at its basis (DEPTH-PLAN §4.9): the fold through the basis message, the layer
   * entries landed there included (those `without` names read as superseded: a redo's), the world as
   * that state plays it, and the narrative record up to it. Null when the basis isn't on the active
   * chain, or it is past a pause. In a turn, which holds the chat's queue, `foldAtBasisOf` reads the
   * same from the turn's own core.
   */
  async foldAtBasis(chatId: ChatId, userId: UserId, basis: Pick<Basis, "message" | "swipe">, types: readonly string[] = [], without?: ReadonlySet<string>): Promise<BasisRead | null> {
    let out: BasisRead | null = null;
    await this.run(chatId, userId, (core, observed) => {
      out = foldAtBasisOf(core, observed, basis, types, without);
    });
    return out;
  }

  /** The narrative record on the active chain (through `upTo` when given): live beats and staging, in fold order (`storyOf` in a turn). */
  async readStory(chatId: ChatId, userId: UserId, upTo?: MessageId): Promise<StoryRead> {
    let out: StoryRead = { beats: [], staging: [], replaced: [], duplicates: [] };
    await this.run(chatId, userId, (core, observed) => {
      out = storyOf(core, observed, upTo);
    });
    return out;
  }

  /**
   * The live events of `types` on the active chain (through `upTo` when given), in fold order, each
   * with its container and, from the layer, its entry's reasoning: mind writes, notebook revisions,
   * truth links (`liveEventsOn`).
   */
  async readEvents(chatId: ChatId, userId: UserId, types: readonly string[], upTo?: MessageId): Promise<LiveEvent[]> {
    let out: LiveEvent[] = [];
    await this.run(chatId, userId, (core, observed) => {
      out = eventsOf(core, observed, types, upTo);
    });
    return out;
  }

  /** What the archive index reads of the chat in one pass (`archiveViewOf`); null for a chat with no world ledger. */
  async archiveView(chatId: ChatId, userId: UserId): Promise<ArchiveView | null> {
    let out: ArchiveView | null = null;
    await this.run(chatId, userId, (core, observed) => {
      out = archiveViewOf(core, observed);
    });
    return out;
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
