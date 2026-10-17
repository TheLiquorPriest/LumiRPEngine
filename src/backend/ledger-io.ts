// Ledger I/O (DESIGN §4.3 durability, §5.1; ARCHITECTURE §2): wires host events and the context
// handler to the per-chat LedgerCore, persists the shadow journal in user storage and keeps
// message metadata in sync with it (flush after each turn, re-assert after clobbering).
//
// Per chat, every operation runs through one queue, so the core sees host events in order.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { ChatId, MessageId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import type { ChatRun, GenerationKind, HeldWrite, Journal, Marker, MessageLedger, PostKind, Rec, RecStatus } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { validMarkerBody } from "../engine/events";
import type { ChainMessage, FoldSnapshot, SnapshotStore } from "../engine/ledger/chain";
import { emptyJournal, LedgerCore, type LedgerEnv } from "../engine/ledger/journal";
import type { LedgerFold } from "../engine/ledger/fold";
import type { HostGenerationType, HostMessage, HostPort } from "./host";
import { setAside } from "./stored-json";

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
 * missing. Stored ledgers come from outside (any metadata writer, an imported chat), so markers
 * are re-checked like requests, swipe keys must be swipe indexes, and a record that fails `isRec`
 * is skipped and reported to `damaged` with its swipe key.
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
    const body = validMarkerBody(m);
    if (body) markers.push({ ...body, seq: m.seq, at: m.at, ...(m.start === true ? { start: true as const } : {}) });
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
  return (rec.accepted === undefined || isContent(rec.accepted)) && (rec.diag === undefined || typeof rec.diag === "string");
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
  if (typeof p.planned !== "boolean" || typeof p.saved !== "boolean" || typeof p.slotHeld !== "boolean" || typeof p.seed !== "string" || !isInt(p.markersApplied) || typeof p.parentPath !== "string") return false;
  if (!Array.isArray(p.chain) || !p.chain.every(isChainEntry) || !Array.isArray(p.events) || !Array.isArray(p.startMarkers) || !p.startMarkers.every(isRecord)) return false;
  if (![p.userMessages, p.rerendered].every((m) => isRecord(m) && Object.values(m).every(isContent))) return false;
  if (p.continueHead !== undefined && typeof p.continueHead !== "string") return false;
  if (p.captured !== undefined && !isContent(p.captured)) return false;
  if (p.renarrateOf !== undefined && !(isRecord(p.renarrateOf) && typeof p.renarrateOf.messageId === "string" && isInt(p.renarrateOf.swipeId))) return false;
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
 * Async work around the core's synchronous steps (DESIGN §5.1): `interpret` before planning and
 * `extract` before the commit run here, inside the chat's queue, so the core then folds their
 * results as plain data. `afterCommit` collects chips; `changed` fires after every operation.
 */
export interface TurnHooks {
  beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string | null; dryRun: boolean; connectionId: string | null; signal: AbortSignal }): Promise<void>;
  /** After the plan, before the reply: the plan-phase prose steps (DESIGN §5.2 brief, prose outline). */
  afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; signal: AbortSignal }): Promise<void>;
  beforeCommit(input: TurnContext): Promise<void>;
  afterCommit(input: TurnContext): Promise<void>;
  changed(chatId: ChatId, userId: UserId): void;
  /** A swipe or regenerate is a Re-run or a Re-narrate (P3; `settings.swipeDefault` or a one-shot choice). */
  kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind }): Promise<GenerationKind>;
}

export class LedgerService {
  private readonly chats = new Map<ChatId, ChatSlot>();
  private readonly unsubscribe: (() => void)[] = [];
  private outstanding = 0;
  /** Every operation failure, also logged to the host. */
  readonly errors: string[] = [];
  hooks: TurnHooks | null = null;
  /** Per `user \0 chat`: why the chat's journal was replaced on opening (kept for the process's life). */
  private readonly resets = new Map<string, string>();
  /** Per `user \0 chat`: notices about records on its messages skipped as malformed (kept for the process's life). */
  private readonly damaged = new Map<string, Set<string>>();

  constructor(
    private readonly host: HostPort,
    private readonly resolveEnv: EnvResolver,
    private readonly folder: LedgerFold,
  ) {}

  /** Subscribes to host events and registers the context handler. */
  attach(): void {
    const h = this.host;
    this.unsubscribe.push(
      h.on("MESSAGE_SENT", (e, userId) => this.onMessage(e.chatId, userId, e.message.id, "sent")),
      h.on("MESSAGE_EDITED", (e, userId) => this.onMessage(e.chatId, userId, e.message.id, "edited")),
      h.on("MESSAGE_SWIPED", (e, userId) => this.onSwiped(e.chatId, userId, e.message.id, e.action, e.swipeId)),
      h.on("MESSAGE_DELETED", (e, userId) => this.onMessage(e.chatId, userId, e.messageId, "deleted")),
      h.on("GENERATION_STARTED", (e, userId) =>
        this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          const kind = this.hooks && userId ? await this.hooks.kindOf({ chatId: e.chatId, userId, kind: KIND[e.generationType] }) : KIND[e.generationType];
          core.started({ generationId: e.generationId, kind, targetMessageId: e.targetMessageId, targetSwipeId: e.targetSwipeId }, observed);
        }),
      ),
      h.on("GENERATION_ENDED", (e, userId) =>
        this.run(e.chatId, userId, async (core, observed) => {
          core.sync(observed);
          // A generation that ended in error commits as stopped: no auto-read, no
          // extraction; the reply's Retry read chip covers whatever text was saved.
          if (e.error) {
            this.host.log("warn", `[LumiRPEngine] generation ${e.generationId.slice(0, 8)} ended with an error: ${e.error.slice(0, 200)}`, userId ?? undefined);
            core.stopped({ generationId: e.generationId, content: e.content }, observed);
            return;
          }
          const p = core.journal.pending[e.generationId];
          const swipeId = p?.swipeId ?? observed.find((m) => m.id === e.messageId)?.swipeId ?? 0;
          const turn = p && e.messageId && userId ? { chatId: e.chatId, userId, core, observed, generationId: e.generationId, messageId: e.messageId, swipeId, kind: p.kind } : null;
          if (this.hooks && turn && p && p.kind !== "impersonate") {
            // A Continue reads only its suffix (L13): prepare that text.
            const text = p.kind === "continue" ? (p.captured && e.content.length >= p.captured.len ? e.content.slice(p.captured.len) : "") : e.content;
            if (text !== "") await this.hooks.beforeCommit({ ...turn, content: text });
          }
          core.ended({ generationId: e.generationId, ...(e.messageId ? { messageId: e.messageId } : {}), content: e.content }, observed);
          if (this.hooks && turn) await this.hooks.afterCommit({ ...turn, content: e.content });
        }),
      ),
      h.on("GENERATION_STOPPED", (e, userId) =>
        this.run(e.chatId, userId, (core, observed) => {
          core.sync(observed);
          core.stopped({ generationId: e.generationId, content: e.content }, observed);
        }),
      ),
    );
    h.registerContextHandler(async (input, signal) => {
      await this.run(input.chatId, input.userId, async (core, observed) => {
        core.sync(observed);
        const pending = Object.values(core.journal.pending)
          .filter((p) => !p.planned && (p.kind === KIND[input.generationType] || (p.kind === "renarrate" && (input.generationType === "swipe" || input.generationType === "regenerate"))))
          .at(-1);
        if (!pending && !input.dryRun) return;
        if (this.hooks) await this.hooks.beforePlan({ chatId: input.chatId, userId: input.userId, core, observed, generationId: pending?.generationId ?? null, dryRun: input.dryRun, connectionId: input.connectionId, signal });
        // The host gave up on the handler: no plan, so the turn commits degraded.
        if (signal.aborted) return;
        core.plan(pending?.generationId ?? "", observed, input.dryRun);
        // Prose steps about the plan (brief, outline) run once it exists, inside the same handler.
        if (this.hooks && pending && !input.dryRun) await this.hooks.afterPlan({ chatId: input.chatId, userId: input.userId, core, observed, generationId: pending.generationId, signal });
      });
    }, 60_000);
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** A user write from the frontend (chip confirm, ✎ fix, materialization, marker, Keep/Discard, Re-read). */
  async write(chatId: ChatId, userId: UserId, w: HeldWrite): Promise<{ applied: boolean; pending: boolean; reason?: string }> {
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

  /** Drops a chat's cached slot (after attaching a world, or detaching one). */
  forget(chatId: ChatId): void {
    this.chats.delete(chatId);
    for (const key of [...this.notWorld]) if (key.endsWith(`\u0000${chatId}`)) this.notWorld.delete(key);
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
