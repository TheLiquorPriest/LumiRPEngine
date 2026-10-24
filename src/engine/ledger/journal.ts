// The ledger core (DESIGN §4.3, §5.1): one chat's journal and every transition on it.
//
// Pure: the caller supplies the observed chain (host messages with their metadata ledgers) and
// persists `journal` after each call; `dirty()` lists the messages whose metadata mirror must be
// written. Classification is a function of the chain-snapshot diff, never of event names (L4).

import { hashJson, hashParts } from "../../shared/hash";
import type { GenerationId, MessageId, RevisionId } from "../../shared/ids";
import type {
  ChainEntry,
  ChatRun,
  ContentId,
  EventRef,
  GenerationKind,
  HeldWrite,
  Journal,
  LedgerEvent,
  Marker,
  MarkerBody,
  MessageLedger,
  PathHash,
  PendingTurn,
  PostEntry,
  Rec,
  RecStatus,
  CarryDrop,
} from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import type { WorldDoc } from "../../shared/world";
import { applyEvent, applyMarker, applyValidUnits, validateEvent, validMarkerBody } from "../events";
import type { ReadContext } from "../registry";
import type { WorldState } from "../state";
import type { ChainMessage, FoldOutput, SnapshotStore } from "./chain";
import type { LedgerFold } from "./fold";
import { activeRecord, activeText, contentId, isLive, isTombstoned, nextPath, sameContent, stepPath, storedRecordHash, turnPath } from "./path";
import type { FoldTypes } from "./reference";

/** What the core needs to plan a turn and read a reply. Supplied by the engine (and by test packs). */
export interface TurnModel {
  /** `parentPath` is the path the turn is planned at: the chain before its reply, its user messages included. */
  plan(input: { state: WorldState; ctx: ReadContext; seed: string; kind: GenerationKind; userTexts: string[]; parentPath: PathHash }): LedgerEvent[];
  read(input: { state: WorldState; ctx: ReadContext; seed: string; text: string }): LedgerEvent[];
}

export interface LedgerEnv {
  types: FoldTypes;
  worlds(revision: RevisionId): WorldDoc | undefined;
  run: ChatRun;
  model: TurnModel;
  /** Starting markers: the world's realism and time defaults, the user's settings filling in (written once per chat, L20). */
  startMarkers(): MarkerBody[];
  /** A fresh seed for a Re-run (random in production, deterministic in tests). */
  newSeed(): string;
  /** The chat's stored fold snapshots (cold folds); absent folds without them. */
  snapshots?: SnapshotStore;
  /**
   * Loads these revisions so `worlds` returns them (a chat keeps only the revisions its ledger
   * references); the core calls it before folds that may need a newly referenced one.
   */
  pin?(revisions: ReadonlySet<RevisionId>): Promise<void>;
}

export interface StartedInput {
  generationId: GenerationId;
  kind: GenerationKind;
  targetMessageId: MessageId | null;
  targetSwipeId: number | null;
}

export interface WriteResult {
  applied: boolean;
  pending: boolean;
  reason?: string;
}

export function emptyJournal(chatId: string): Journal {
  return { v: 1, chatId, seq: 0, chain: [], messages: {}, pauses: [], tombstones: [], held: [], windows: [], pending: {}, started: false };
}

const EMPTY_LEDGER = (): MessageLedger => ({ v: 1, swipes: {}, markers: [] });

/** Refused held writes whose notices are kept; older ones are let go. */
const REFUSED_KEPT = 8;

/** A swipe an in-flight turn names by index (its plan's, or its target), deleted while the reply streamed. */
const GONE_SWIPE = -1;

/** Why a Re-run committed under a pause didn't carry a fix of the swipe it was made from (P3, L43). */
const PAUSED_DROP = "the chat was paused";

/** Why a read-elsewhere record refuses Undo and reads. Only the latest reply can be Re-run, so only it is offered one. */
function readElsewhereRefusal(latest: boolean): string {
  const cause = "This reply was written while an earlier message or swipe it depended on changed, so switching back can't restore it.";
  return latest ? `${cause} Re-run it to play the turn again.` : `${cause} It can't be undone or read again.`;
}
export class LedgerCore {
  /** Whether this open has checked the starting markers against the chain's stored paths (`restoreStartMarkers`). */
  private startsChecked = false;

  constructor(
    public journal: Journal,
    private readonly env: LedgerEnv,
    private readonly folder: LedgerFold,
  ) {}

  /** A world revision as this chat's env resolves it (its pinned revisions). */
  worldAt(revision: RevisionId): WorldDoc | undefined {
    return this.env.worlds(revision);
  }

  /**
   * Every world revision this chat's folds can ask for: the run's, each migrate marker's target (on
   * the chain, in held writes and in `extra`, a write about to land) and the revisions its records
   * were planned under.
   */
  revisionsIn(observed: readonly ChainMessage[], extra?: HeldWrite): Set<RevisionId> {
    const out = new Set<RevisionId>([this.env.run.revision]);
    const marker = (body: MarkerBody): void => {
      if (body.kind === "migrate") out.add(body.to);
    };
    for (const m of this.chain(observed)) {
      for (const mk of m.ledger?.markers ?? []) marker(mk);
      for (const rec of Object.values(m.ledger?.swipes ?? {})) if (rec.defHash !== "") out.add(rec.defHash);
    }
    for (const h of this.journal.held) if (h.write.kind === "marker") marker(h.write.body);
    if (extra?.kind === "marker") marker(extra.body);
    return out;
  }

  /** Makes the revisions the next folds need available to the env's synchronous lookup (`env.pin`). */
  async prepareWorlds(observed: readonly ChainMessage[], extra?: HeldWrite): Promise<void> {
    await this.env.pin?.(this.revisionsIn(observed, extra));
  }

  // ------------------------------------------------------------------ views

  /** The observed chain with the journal's ledgers overlaid (the journal is authoritative). */
  chain(observed: readonly ChainMessage[]): ChainMessage[] {
    return observed.map((m) => ({ ...m, ledger: this.journal.messages[m.id]?.ledger ?? m.ledger }));
  }

  fold(observed: readonly ChainMessage[]): FoldOutput {
    return this.folder.fold({
      worlds: (r) => this.env.worlds(r),
      revision: this.env.run.revision,
      chain: this.chain(observed),
      pauses: this.journal.pauses,
      tombstones: this.journal.tombstones,
      ...(this.env.snapshots ? { snapshots: this.env.snapshots } : {}),
    });
  }

  /** Messages whose metadata mirror differs from the journal (unflushed, or clobbered by another writer). */
  dirty(observed: readonly ChainMessage[]): MessageId[] {
    const out: MessageId[] = [];
    for (const m of observed) {
      const jm = this.journal.messages[m.id];
      if (!jm) continue;
      if (!jm.flushed || JSON.stringify(m.ledger) !== JSON.stringify(jm.ledger)) out.push(m.id);
    }
    return out;
  }

  markFlushed(messageId: MessageId): void {
    const jm = this.journal.messages[messageId];
    if (jm) jm.flushed = true;
  }

  get inFlight(): boolean {
    return this.journal.windows.length > 0;
  }

  // ------------------------------------------------------------------ chain sync

  /**
   * Diff the observed chain against the snapshot and classify every change (DESIGN §4.3).
   * `deletedSwipe` comes from `MESSAGE_SWIPED deleted`: the host shifts swipes but not metadata.
   */
  sync(observed: readonly ChainMessage[], deletedSwipe?: { messageId: MessageId; swipeId: number }): void {
    const j = this.journal;
    if (j.chain.length === 0 && Object.keys(j.messages).length === 0) this.bootstrap(observed);
    if (deletedSwipe) this.shiftSwipes(deletedSwipe.messageId, deletedSwipe.swipeId);
    if (!this.startsChecked) {
      this.startsChecked = true;
      this.restoreStartMarkers(observed);
    }
    // Removals: live markers move to the nearest surviving earlier assistant message (DESIGN §4.3, L19).
    const now = new Set(observed.map((m) => m.id));
    for (const [index, old] of j.chain.entries()) if (!now.has(old.id)) this.moveMarkersOnDelete(old, index, observed);
    this.classify(observed);
  }

  /**
   * Content changes against the snapshot. A user edit pauses (L39); an assistant edit is accepted (L38).
   * In-flight targets and, during a Continue, every assistant message with a record keep their
   * snapshot entry, so they are classified when the turn closes (the Continue's own save is settled
   * then); their paths chain the record's swipeHash, so the fold doesn't move meanwhile. A message
   * without a record chains its text, so its edit is accepted at once (a bare record).
   */
  private classify(observed: readonly ChainMessage[]): void {
    const before = new Map(this.journal.chain.map((e) => [e.id, e]));
    const owned = this.ownedByTurns();
    const continuing = Object.values(this.journal.pending).some((p) => p.kind === "continue");
    const chain = continuing ? this.chain(observed) : [];
    const deferred = new Set<MessageId>();
    for (const [index, m] of observed.entries()) {
      const prev = before.get(m.id);
      if (!prev) continue;
      const content = contentId(activeText(m));
      if (m.isUser) {
        if (prev.swipeId === m.swipeId && !sameContent(prev.content, content)) this.userEdit(m, content, observed, index);
        continue;
      }
      const overlaid = chain[index];
      if (owned.has(m.id) || (overlaid && activeRecord(overlaid, this.journal.tombstones) !== null)) {
        deferred.add(m.id);
        continue;
      }
      this.verifyAssistant(m, prev, content);
    }
    this.snapshot(observed, deferred);
  }

  /**
   * A journal rebuilt from message metadata (a branch, an import, a lost journal). The chat counts as
   * started only once a message carries its starting markers, as when they are planned: a first
   * reply read without a plan holds events but no markers, and the next planned turn writes them.
   */
  private bootstrap(observed: readonly ChainMessage[]): void {
    const j = this.journal;
    for (const m of observed) {
      if (!m.ledger) continue;
      j.messages[m.id] = { ledger: structuredClone(m.ledger), flushed: true };
      for (const mk of m.ledger.markers) j.seq = Math.max(j.seq, mk.seq);
      for (const rec of Object.values(m.ledger.swipes)) {
        for (const p of rec.post) j.seq = Math.max(j.seq, p.seq);
        j.seq = Math.max(j.seq, rec.markersApplied, rec.seq);
      }
      if (m.ledger.markers.some((mk) => mk.start)) j.started = true;
    }
  }

  /**
   * An earlier build journaled the starting markers as the world writes them (the starters'
   * half-minute action tick as 0.5) and hashed the chain with them, but flushed them to message
   * metadata as the marker check clamps them (1). Where the journal came from that metadata (a
   * branch, an import or a rebuilt journal, made by either build), every stored path after them
   * missed and the records folded as rebased views. So, once per open, a starting marker stored
   * clamped, where the chat's own marker as the world writes it differs from it and clamps to it,
   * is put back as written if the first later stored path that either reading matches is matched
   * with it put back: the chain then hashes what its paths were hashed with, and the flush writes
   * it back to metadata. A chat this build started journaled them clamped, so that path matches
   * them as they stand.
   */
  private restoreStartMarkers(observed: readonly ChainMessage[]): void {
    const raws = this.env.startMarkers().flatMap((raw) => {
      const clamped = hashJson(validMarkerBody(raw));
      const written = hashJson(raw);
      return written === clamped ? [] : [{ raw, clamped }];
    });
    if (raws.length === 0) return;
    const chain = this.chain(observed);
    const restored = new Map<number, Marker[]>();
    for (const [index, m] of chain.entries()) {
      let changed = false;
      const markers = (m.ledger?.markers ?? []).map((mk) => {
        if (!mk.start) return mk;
        const { seq, at, start: _start, ...body } = mk;
        const stored = hashJson(body);
        const raw = raws.find((r) => r.clamped === stored)?.raw;
        if (!raw) return mk;
        changed = true;
        return { ...raw, seq, at, start: true as const };
      });
      if (changed) restored.set(index, markers);
    }
    if (restored.size === 0) return;
    const first = Math.min(...restored.keys());
    const alt = chain.map((m, index) => {
      const markers = restored.get(index);
      return markers && m.ledger ? { ...m, ledger: { ...m.ledger, markers } } : m;
    });
    // Both readings share every path up to the first starting marker; after it, the first stored
    // path either one gives decides (one made on another branch matches neither).
    let asStored = ROOT_PATH;
    let asRestored = ROOT_PATH;
    for (const [index, m] of chain.entries()) {
      const ledger = m.ledger;
      if (index > first && ledger) {
        const paths = storedPaths(ledger);
        if (paths.has(asStored)) return;
        if (paths.has(asRestored)) {
          for (const [at, markers] of restored) {
            const message = observed[at];
            if (message) this.ledgerFor(message.id, message).markers = markers;
          }
          return;
        }
      }
      const a = alt[index];
      if (!a) return;
      asStored = nextPath(m, asStored, this.journal.tombstones);
      asRestored = nextPath(a, asRestored, this.journal.tombstones);
    }
  }

  private snapshot(observed: readonly ChainMessage[], deferred: ReadonlySet<MessageId> = new Set()): void {
    const prev = new Map(this.journal.chain.map((e) => [e.id, e]));
    const paths = this.fold(observed).messages;
    this.journal.chain = observed.map((m, i) => {
      const kept = deferred.has(m.id) ? prev.get(m.id) : undefined;
      return (
        kept ?? {
          id: m.id,
          isUser: m.isUser,
          swipeId: m.swipeId,
          swipeCount: m.swipes.length,
          content: contentId(activeText(m)),
          parentPath: paths[i]?.parentPath ?? ROOT_PATH,
        }
      );
    });
  }

  private ledgerFor(messageId: MessageId, observed?: ChainMessage): MessageLedger {
    const j = this.journal;
    let jm = j.messages[messageId];
    if (!jm) {
      jm = { ledger: observed?.ledger ? structuredClone(observed.ledger) : EMPTY_LEDGER(), flushed: false };
      j.messages[messageId] = jm;
    }
    jm.flushed = false;
    return jm.ledger;
  }

  private shiftSwipes(messageId: MessageId, deleted: number): void {
    // A turn in flight names swipes by index too: the plan's and its target's move down with the
    // host's, and a deleted one is gone.
    const shift = (swipeId: number): number => (swipeId > deleted ? swipeId - 1 : swipeId === deleted ? GONE_SWIPE : swipeId);
    for (const p of Object.values(this.journal.pending)) {
      for (const e of p.chain) if (e.id === messageId) e.swipeId = shift(e.swipeId);
      if (p.messageId === messageId && p.swipeId !== null) p.swipeId = shift(p.swipeId);
      if (p.renarrateOf?.messageId === messageId) {
        const source = shift(p.renarrateOf.swipeId);
        if (source === GONE_SWIPE) delete p.renarrateOf;
        else p.renarrateOf.swipeId = source;
      }
    }
    const jm = this.journal.messages[messageId];
    if (!jm) return;
    const next: Record<string, Rec> = {};
    for (const [key, rec] of Object.entries(jm.ledger.swipes)) {
      const i = Number(key);
      if (i < deleted) next[key] = rec;
      else if (i > deleted) next[String(i - 1)] = rec;
    }
    jm.ledger.swipes = next;
    jm.flushed = false;
  }

  private moveMarkersOnDelete(old: ChainEntry, index: number, observed: readonly ChainMessage[]): void {
    const j = this.journal;
    const jm = j.messages[old.id];
    delete j.messages[old.id];
    j.pauses = j.pauses.filter((p) => p.messageId !== old.id);
    if (!jm || old.isUser) return;
    const rec = jm.ledger.swipes[String(old.swipeId)];
    const live = jm.ledger.markers.filter((mk) => isLive(mk.at, old.parentPath, turnPath(rec ?? null)));
    if (live.length === 0) return;
    const survivors = new Set(observed.filter((m) => !m.isUser).map((m) => m.id));
    let target: MessageId | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const e = j.chain[i];
      if (e && !e.isUser && survivors.has(e.id)) {
        target = e.id;
        break;
      }
    }
    target ??= observed.find((m) => !m.isUser)?.id;
    if (!target) return;
    const targetIndex = observed.findIndex((m) => m.id === target);
    const parent = this.fold(observed).messages[targetIndex]?.parentPath ?? ROOT_PATH;
    const ledger = this.ledgerFor(target, observed[targetIndex]);
    for (const mk of live) ledger.markers.push({ ...mk, at: mk.at === null ? null : parent });
  }

  /** Messages that in-flight turns own: their targets (staged replies and regenerated messages). */
  private ownedByTurns(): Set<MessageId> {
    const owned = new Set<MessageId>();
    for (const p of Object.values(this.journal.pending)) if (p.messageId) owned.add(p.messageId);
    return owned;
  }

  private userEdit(m: ChainMessage, content: ContentId, observed: readonly ChainMessage[], index: number): void {
    // P4: the host's re-render of a turn's own user messages (the run just before its reply), after
    // the reply was saved and before it ends. An unplanned turn (under a pause) has them too.
    for (const p of Object.values(this.journal.pending)) {
      if (!p.saved || p.kind !== "normal") continue;
      const target = p.messageId ? observed.findIndex((o) => o.id === p.messageId) : -1;
      const own = p.userMessages[m.id] !== undefined || (target > index && observed.slice(index, target).every((o) => o.isUser));
      if (own) {
        p.rerendered[m.id] = content;
        return;
      }
    }
    const later = this.chain(observed.slice(index + 1)).some((o) => !o.isUser && activeRecord(o, this.journal.tombstones) !== null);
    // An edit before an in-flight turn's target puts that turn under the pause too, planned or not.
    // (A Continue reads only when its head has a record, which `later` already covers.)
    const affectsTurn = Object.values(this.journal.pending).some((p) => {
      if (p.kind === "impersonate" || p.kind === "continue") return false;
      const target = p.messageId ? observed.findIndex((o) => o.id === p.messageId) : observed.length;
      return target < 0 || target > index;
    });
    if (!later && !affectsTurn) return;
    this.journal.pauses = this.journal.pauses.filter((p) => p.messageId !== m.id);
    this.journal.pauses.push({ messageId: m.id, content });
  }

  /** Assistant edits keep the world: the new content becomes the record's `accepted` identity (L38). */
  private verifyAssistant(m: ChainMessage, prev: ChainEntry, content: ContentId): void {
    const swipeChanged = prev.swipeId !== m.swipeId || prev.swipeCount !== m.swipes.length;
    const jm = this.journal.messages[m.id];
    const rec = (jm?.ledger ?? m.ledger)?.swipes[String(m.swipeId)];
    if (rec) {
      if (sameContent(rec.swipeHash, content)) {
        if (rec.accepted) {
          const ledger = this.ledgerFor(m.id, m);
          delete ledger.swipes[String(m.swipeId)]?.accepted;
        }
        return;
      }
      if (sameContent(rec.accepted, content)) return;
      const ledger = this.ledgerFor(m.id, m);
      const own = ledger.swipes[String(m.swipeId)];
      if (own) own.accepted = content;
      return;
    }
    // No record: a content change at the same swipe gets a bare record holding the old identity.
    if (swipeChanged || sameContent(prev.content, content)) return;
    const ledger = this.ledgerFor(m.id, m);
    ledger.swipes[String(m.swipeId)] = this.bareRecord(prev.content, content);
  }

  /** A record with no turn (path ""): it carries an accepted identity or player entries. */
  private bareRecord(swipeHash: ContentId, accepted: ContentId | undefined): Rec {
    const rec: Rec = { v: 1, defHash: this.env.run.revision, seq: ++this.journal.seq, swipeHash, path: "", seed: "", pre: 0, events: [], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
    if (accepted && !sameContent(accepted, swipeHash)) rec.accepted = accepted;
    return rec;
  }

  // ------------------------------------------------------------------ generations

  started(input: StartedInput, observed: readonly ChainMessage[]): void {
    const j = this.journal;
    j.windows.push(input.generationId);
    const pending: PendingTurn = {
      generationId: input.generationId,
      kind: input.kind,
      messageId: input.kind === "continue" ? null : input.targetMessageId,
      swipeId: input.targetSwipeId,
      planned: false,
      chain: [],
      userMessages: {},
      rerendered: {},
      saved: false,
      seed: "",
      markersApplied: 0,
      parentPath: ROOT_PATH,
      events: [],
      startMarkers: [],
    };
    if (input.kind === "continue") {
      const head = [...observed].reverse().find((m) => !m.isUser);
      if (head) {
        pending.continueHead = head.id;
        pending.captured = contentId(activeText(head));
      }
    }
    // P3 source: the nearest earlier swipe of the target holding a live record (the swipe the user
    // swiped away from; a new swipe is appended after it).
    if (input.kind === "renarrate" && input.targetMessageId && input.targetSwipeId !== null) {
      const target = this.chain(observed).find((m) => m.id === input.targetMessageId);
      for (let s = input.targetSwipeId - 1; s >= 0; s--) {
        const rec = target?.ledger?.swipes[String(s)];
        if (rec && target && !isTombstoned(j.tombstones, target.id, rec)) {
          pending.renarrateOf = { messageId: target.id, swipeId: s };
          break;
        }
      }
    }
    // A swipe's source fixes are those live where it was made (P3, L43). Its plan takes that parent
    // again; one that gets no plan (under a pause) keeps it, so the fixes it leaves are still named.
    const swiped = input.targetMessageId && (input.kind === "swipe" || input.kind === "regenerate" || input.kind === "renarrate") ? observed.findIndex((m) => m.id === input.targetMessageId) : -1;
    if (swiped >= 0) pending.parentPath = this.fold(observed.slice(0, swiped)).messages.at(-1)?.path ?? ROOT_PATH;
    j.pending[input.generationId] = pending;
  }

  /**
   * Engine first (DESIGN §5.1): a turn the engine plans before its generation exists, under the
   * engine's own id. It is pending without a window, and only while the engine run plans it: `take`
   * then hands it out, so no other operation meets it and it is never persisted.
   */
  prepare(input: StartedInput, observed: readonly ChainMessage[]): void {
    this.started(input, observed);
    this.journal.windows = this.journal.windows.filter((w) => w !== input.generationId);
  }

  /** The prepared turn `prepare` began, taken out of the journal; null when there is none. */
  take(id: GenerationId): PendingTurn | null {
    const p = this.journal.pending[id];
    if (!p) return null;
    delete this.journal.pending[id];
    return p;
  }

  /**
   * The generation the guard let through takes the prepared turn's plan (DESIGN §5.1): its kind,
   * seed, planned events and start markers, the chain they were folded on, and a Re-narrate's copies.
   * Its own target, window and save tracking stay. False when the generation has no pending turn or
   * the prepared one has no plan (a Continue's).
   */
  adopt(generationId: GenerationId, prepared: PendingTurn): boolean {
    const p = this.journal.pending[generationId];
    if (!p || !prepared.planned) return false;
    const from = structuredClone(prepared);
    Object.assign(p, { kind: from.kind, planned: true, chain: from.chain, userMessages: from.userMessages, seed: from.seed, markersApplied: from.markersApplied, parentPath: from.parentPath, events: from.events, startMarkers: from.startMarkers } satisfies Partial<PendingTurn>);
    if (from.renarrateOf) p.renarrateOf = from.renarrateOf;
    else delete p.renarrateOf;
    if (from.copies) p.copies = from.copies;
    if (from.undone) p.undone = from.undone;
    if (from.dropped) p.dropped = from.dropped;
    return true;
  }

  /**
   * The state a turn is planned from (DESIGN §5.1 step 2): the fold before its target, the target's
   * live markers, and before the chat's first record its starting markers. A time skip's pre phase
   * reads it, so it reaches its beats in the state the plan will (DESIGN §24.7). Pure; null when the
   * turn gets no plan.
   */
  planState(generationId: GenerationId, observed: readonly ChainMessage[]): { state: WorldState; world: WorldDoc; parentPath: PathHash } | null {
    const p = this.journal.pending[generationId];
    const base = p && p.kind !== "continue" && p.kind !== "impersonate" ? this.planBase(p, observed) : null;
    return base ? { state: base.state, world: base.world, parentPath: base.parentPath } : null;
  }

  /** What `plan` folds before it plans; null under a pause or without the world. */
  private planBase(p: PendingTurn, observed: readonly ChainMessage[]) {
    const targetIndex = p.messageId ? observed.findIndex((m) => m.id === p.messageId) : -1;
    const prefix = targetIndex >= 0 ? observed.slice(0, targetIndex) : [...observed];
    // Under a pause nothing after it folds, so a turn there gets no plan and commits degraded.
    if (this.pausedWithin(prefix)) return null;
    const out = this.fold(prefix);
    const state = structuredClone(out.state);
    const parentPath = out.messages.length > 0 ? (out.messages[out.messages.length - 1]?.path ?? ROOT_PATH) : ROOT_PATH;
    // The target's own live markers fold before the plan (DESIGN §5.1 step 2).
    const target = targetIndex >= 0 ? this.chain(observed)[targetIndex] : undefined;
    const targetRec = target ? activeRecord(target, this.journal.tombstones) : null;
    const liveTarget = (target?.ledger?.markers ?? []).filter((mk) => isLive(mk.at, parentPath, turnPath(targetRec))).sort((a, b) => a.seq - b.seq);
    for (const mk of liveTarget) applyMarker(state, mk, this.env);

    const users: string[] = [];
    const userMessages: Record<MessageId, ContentId> = {};
    for (let i = prefix.length - 1; i >= 0; i--) {
      const m = prefix[i];
      if (!m || !m.isUser) break;
      users.unshift(activeText(m));
      userMessages[m.id] = contentId(activeText(m));
    }
    const world = this.env.worlds(state.revision);
    if (!world) return null;
    let startMarkers: Marker[] = [];
    let seq = this.journal.seq;
    if (!this.journal.started) {
      // Journaled checked and clamped, as every marker is (`apply`), so the chain hashes the values
      // that fold: the starters' half-minute action tick is journaled as the whole minute it plays.
      startMarkers = this.env.startMarkers().flatMap((raw) => {
        const body = validMarkerBody(raw);
        return body ? [{ ...body, seq: ++seq, at: null, start: true as const }] : [];
      });
      for (const mk of startMarkers) applyMarker(state, mk, this.env);
    }
    return { prefix, out, state, parentPath, target, users, userMessages, world, startMarkers, seq };
  }

  /** The engine run (DESIGN §5.1 step 2): plan the turn and store it. Continue, Impersonate and a turn under a pause get no plan; a dry run's is returned, never stored. */
  plan(generationId: GenerationId, observed: readonly ChainMessage[], dryRun: boolean): LedgerEvent[] {
    const p = this.journal.pending[generationId];
    if (!p || p.kind === "continue" || p.kind === "impersonate") return [];
    const base = this.planBase(p, observed);
    if (!base) return [];
    const { prefix, out, state, parentPath, target, users, userMessages, world, startMarkers, seq } = base;
    if (p.kind === "renarrate" && target && !dryRun && this.planRenarrate(p, target, out.state, parentPath, world)) {
      Object.assign(p, {
        planned: true,
        chain: prefix.map((m, i) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, swipeCount: m.swipes.length, content: contentId(activeText(m)), parentPath: out.messages[i]?.parentPath ?? ROOT_PATH })),
        userMessages,
        parentPath,
      } satisfies Partial<PendingTurn>);
      return [...p.events];
    }
    const seed = world.seedMode === "same_roll" ? hashParts("lre.seed", this.env.run.runSeed, parentPath) : this.env.newSeed();
    const ctx = this.env.types.context(world, state);
    const planned = this.env.model.plan({ state, ctx, seed, kind: p.kind === "renarrate" ? "swipe" : p.kind, userTexts: users, parentPath });
    const events = applyValidUnits(this.env.types, planned, state, (s) => this.env.types.context(world, s));
    // A Re-narrate that can't copy its source (none, or the chain changed under it) is a Re-run.
    if (p.kind === "renarrate") p.kind = "swipe";
    if (dryRun) return events;
    this.journal.seq = seq;
    Object.assign(p, {
      planned: true,
      chain: prefix.map((m, i) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, swipeCount: m.swipes.length, content: contentId(activeText(m)), parentPath: out.messages[i]?.parentPath ?? ROOT_PATH })),
      userMessages,
      seed,
      markersApplied: seq,
      parentPath,
      events,
      startMarkers,
    } satisfies Partial<PendingTurn>);
    return events;
  }

  /**
   * P3: a Re-narrate copies its source's seed, `pre` and `markersApplied`, and its live fixes and
   * materializations (keeping their `seq`s and their undos, with the new parent path as `at`), each
   * re-validated in fold order; a copy that fails is dropped and reported. False when it can't
   * reproduce the source (no source record, or a `pre` event no longer validates): the turn is then a Re-run.
   */
  private planRenarrate(p: PendingTurn, target: ChainMessage, base: WorldState, parentPath: PathHash, world: WorldDoc): boolean {
    if (!p.renarrateOf) return false;
    const source = target.ledger?.swipes[String(p.renarrateOf.swipeId)];
    // Bare records (no turn) and unplanned degraded records (no seed) have nothing to re-narrate.
    if (!source || isTombstoned(this.journal.tombstones, target.id, source) || source.path === "" || source.seed === "") return false;
    const state = structuredClone(base);
    const markers = [...(target.ledger?.markers ?? [])].filter((mk) => isLive(mk.at, parentPath, parentPath)).sort((a, b) => a.seq - b.seq);
    for (const mk of markers) if (mk.seq <= source.markersApplied) applyMarker(state, mk, this.env);
    const pre = source.events.slice(0, source.pre);
    for (const ev of pre) {
      const ctx = this.env.types.context(world, state);
      if (validateEvent(this.env.types, ev, ctx)) return false;
      applyEvent(this.env.types, ev, state, ctx);
    }
    const sourceTurn = turnPath(source);
    const candidates = source.post.filter((e) => (e.kind === "fix" || e.kind === "materialize") && isLive(e.at, parentPath, sourceTurn));
    const carried = this.carry(state, world, candidates, source.undone, markers.filter((mk) => mk.seq > source.markersApplied));
    const copies = carried.kept.map((e) => ({ ...e, at: parentPath }));
    Object.assign(p, { seed: source.seed, markersApplied: source.markersApplied, events: structuredClone(pre), copies, undone: carried.undone, dropped: carried.dropped, startMarkers: [] } satisfies Partial<PendingTurn>);
    return true;
  }

  /**
   * Carries post entries onto a record's prefix (a Re-narrate's copies, a Re-run's fixes, what a
   * Re-read keeps): each, in fold order with the message's later live markers, is re-validated event
   * by event against `state` (the prefix after the record's events, advanced in place) and kept or
   * dropped whole. Events `undone` names stay undone: they neither validate nor apply, an entry left
   * with none is not carried, and the refs of those that travel come back with them. A
   * materialization of detail the prefix already records leaves the entry (DESIGN §9.2).
   */
  private carry(state: WorldState, world: WorldDoc, entries: readonly PostEntry[], undone: readonly EventRef[], markers: readonly Marker[]): { kept: PostEntry[]; undone: EventRef[]; dropped: CarryDrop[] } {
    const off = (seq: number, index: number): boolean => undone.some((u) => u.in === "post" && u.seq === seq && u.index === index);
    const later: ({ seq: number; marker: Marker } | { seq: number; entry: PostEntry })[] = [...markers.map((mk) => ({ seq: mk.seq, marker: mk })), ...entries.map((e) => ({ seq: e.seq, entry: e }))].sort((a, b) => a.seq - b.seq);
    const out: { kept: PostEntry[]; undone: EventRef[]; dropped: CarryDrop[] } = { kept: [], undone: [], dropped: [] };
    for (const item of later) {
      if ("marker" in item) {
        applyMarker(state, item.marker, this.env);
        continue;
      }
      const { entry } = item;
      if (entry.events.every((_, i) => off(entry.seq, i))) continue;
      const scratch = structuredClone(state);
      const doc = this.env.worlds(scratch.revision) ?? world;
      let failure: string | null = null;
      // Detail the prefix already records (a ✎ cash fix's opening, when the new swipe's reply opened
      // the same accounts) isn't recorded twice: that materialization leaves the entry, the rest is
      // re-validated without it, so the correction still lands, and later undos move up with their events.
      const stripped: number[] = [];
      let recorded = "";
      for (const [i, ev] of entry.events.entries()) {
        if (off(entry.seq, i)) continue;
        const ctx = this.env.types.context(doc, scratch);
        const rejection = validateEvent(this.env.types, ev, ctx);
        if (rejection?.code === "materialized") {
          stripped.push(i);
          recorded = rejection.reason;
          continue;
        }
        if (rejection) {
          failure = rejection.reason;
          break;
        }
        applyEvent(this.env.types, ev, scratch, ctx);
      }
      // Left with nothing to apply, it isn't carried.
      if (failure === null && entry.events.every((_, i) => off(entry.seq, i) || stripped.includes(i))) failure = recorded;
      if (failure !== null) {
        out.dropped.push({ seq: entry.seq, kind: entry.kind, reason: failure });
        continue;
      }
      Object.assign(state, scratch);
      out.kept.push({ ...structuredClone(entry), events: entry.events.filter((_, i) => !stripped.includes(i)) });
      out.undone.push(...undone.filter((u) => u.in === "post" && u.seq === entry.seq).map((u) => ({ ...u, index: u.index - stripped.filter((s) => s < u.index).length })));
    }
    return out;
  }

  /**
   * The swipe a Re-run was made from (the nearest earlier swipe of `target` holding a record) and
   * its ✎ fixes and GM edits live on any of `parents`; null when it has none.
   */
  private rerunFixes(target: ChainMessage, swipeId: number, parents: readonly PathHash[]): { source: Rec; fixes: PostEntry[] } | null {
    for (let s = swipeId - 1; s >= 0; s--) {
      const source = target.ledger?.swipes[String(s)];
      if (!source || isTombstoned(this.journal.tombstones, target.id, source)) continue;
      const fixes = source.post.filter((e) => e.kind === "fix" && parents.some((parent) => isLive(e.at, parent, turnPath(source))));
      return fixes.length > 0 ? { source, fixes } : null;
    }
    return null;
  }

  /**
   * A Re-run carries the live ✎ fixes and GM edits of the swipe it was made from (the nearest
   * earlier swipe holding a record) as P3 carries a Re-narrate's: same `seq`s and undos, anchored at
   * the new record's path, each re-validated after the new turn's events. One that no longer applies
   * is dropped with a Journal note.
   */
  private carryFixes(rec: Rec, target: ChainMessage | undefined, swipeId: number, prefix: { state: WorldState; world: WorldDoc; parent: PathHash }): void {
    // The fixes in force on the chain the Re-run was read on (the one it was planned on, when it could be rebuilt).
    const found = target ? this.rerunFixes(target, swipeId, [prefix.parent]) : null;
    if (!target || !found) return;
    const markers = (target.ledger?.markers ?? []).filter((mk) => mk.seq > rec.markersApplied && isLive(mk.at, prefix.parent, rec.path));
    const carried = this.carry(prefix.state, prefix.world, found.fixes, found.source.undone, markers);
    rec.post = carried.kept.map((e) => ({ ...e, at: rec.path }));
    rec.undone = carried.undone;
    if (carried.dropped.length > 0) rec.dropped = carried.dropped;
  }

  /**
   * A Re-run committed under a pause carries none of its source's fixes (P3): nothing after the
   * pause folds, so none can be re-validated after the new turn's events. None goes unsaid either:
   * each it would have carried (live on one of `parents`, and not wholly undone) is dropped with a
   * Journal note (L43), so a GM's correction never just disappears from the new swipe.
   */
  private leaveFixes(rec: Rec, target: ChainMessage | undefined, swipeId: number, parents: readonly PathHash[]): void {
    const found = target ? this.rerunFixes(target, swipeId, parents) : null;
    if (!found) return;
    const off = (seq: number, index: number): boolean => found.source.undone.some((u) => u.in === "post" && u.seq === seq && u.index === index);
    const left = found.fixes.filter((e) => !e.events.every((_, i) => off(e.seq, i)));
    if (left.length > 0) rec.dropped = left.map((e) => ({ seq: e.seq, kind: e.kind, reason: PAUSED_DROP }));
  }

  /**
   * The reply was saved (its MESSAGE_EDITED / MESSAGE_SWIPED updated / MESSAGE_SENT): P4 re-renders
   * count from here. A reply created at the end names its message only now.
   */
  saved(generationId: GenerationId, createdId?: MessageId): void {
    const p = this.journal.pending[generationId];
    if (!p) return;
    p.saved = true;
    if (createdId) p.messageId = createdId;
  }

  ended(input: { generationId: GenerationId; messageId?: MessageId; content: string }, observed: readonly ChainMessage[]): void {
    const p = this.journal.pending[input.generationId];
    if (!p) return;
    try {
      if (p.kind === "impersonate" || !input.messageId) return;
      if (p.kind === "continue") {
        this.endContinue(p, input.messageId, input.content, observed);
        return;
      }
      this.commit(p, input.messageId, input.content, input.content === "" ? "degraded" : p.planned ? "ok" : "degraded", observed, true);
    } finally {
      this.close(input.generationId, observed);
    }
  }

  stopped(input: { generationId: GenerationId; content: string }, observed: readonly ChainMessage[]): void {
    const p = this.journal.pending[input.generationId];
    if (!p) return;
    try {
      if (p.kind === "continue") {
        this.stopContinue(input.content, observed);
        return;
      }
      if (p.kind === "impersonate" || input.content === "" || !p.messageId) return;
      this.commit(p, p.messageId, input.content, "stopped", observed, false);
    } finally {
      this.close(input.generationId, observed);
    }
  }

  /** The commit path: the plan's chain, with the turn's user messages hashed per P4. */
  private commitPath(p: PendingTurn): PathHash {
    const firstUser = p.chain.findIndex((e) => e.isUser && p.userMessages[e.id] !== undefined);
    if (firstUser < 0 || Object.keys(p.rerendered).length === 0) return p.parentPath;
    let path = p.chain[firstUser]?.parentPath ?? ROOT_PATH;
    for (const e of p.chain.slice(firstUser)) path = stepPath(path, true, (p.rerendered[e.id] ?? p.userMessages[e.id] ?? e.content).hash, "", "");
    return path;
  }

  /**
   * The fold a turn's post steps read on (P2, L7), up to its target, and where its record is
   * anchored: the chain it was planned on. Its record folds as stored only there, so what it reads,
   * and what a Re-run carries, must validate there; on any other chain it is a rebased view, which
   * re-validates them anyway. When an earlier swipe changed while the reply streamed, that chain is
   * rebuilt from the messages as they stand with the swipes the plan saw, and taken once it folds to
   * the turn's path again. One that can't be rebuilt (a message or swipe the plan saw is gone, or a
   * swipe's text changed) is read on the chain in force, and the record is read elsewhere: it keeps
   * the planned path, so what was made there still travels with it, but never folds as stored, since
   * what was read was never validated there and that path can come back (the deleted swipe's text
   * added again). An unplanned turn commits where it lands.
   */
  private plannedPrefix(p: PendingTurn, observed: readonly ChainMessage[], index: number): { out: FoldOutput; path: PathHash; elsewhere: boolean } {
    const inForce = (path?: PathHash, elsewhere = false): { out: FoldOutput; path: PathHash; elsewhere: boolean } => {
      const out = this.fold(observed.slice(0, index));
      return { out, path: path ?? out.messages.at(-1)?.path ?? ROOT_PATH, elsewhere };
    };
    if (!p.planned) return inForce();
    const path = this.commitPath(p);
    if (p.chain.length === index && p.chain.every((e, i) => observed[i]?.id === e.id && observed[i]?.swipeId === e.swipeId)) return inForce(path);
    if (p.chain.length !== index) return inForce(path, true);
    const rebuilt: ChainMessage[] = [];
    for (const [i, e] of p.chain.entries()) {
      const m = observed[i];
      if (!m || m.id !== e.id || e.swipeId === GONE_SWIPE || e.swipeId >= m.swipes.length) return inForce(path, true);
      rebuilt.push({ ...m, swipeId: e.swipeId });
    }
    const out = this.fold(rebuilt);
    return (out.messages.at(-1)?.path ?? ROOT_PATH) === path ? { out, path, elsewhere: false } : inForce(path, true);
  }

  /** What a Re-read edit or Retry read of an existing record reads against (its fold prefix plus `pre`), and the state before `pre`. */
  readContext(messageId: MessageId, observed: readonly ChainMessage[]): { state: WorldState; world: WorldDoc; seed: string; pre: LedgerEvent[]; start: WorldState } | null {
    const index = observed.findIndex((m) => m.id === messageId);
    const m = this.chain(observed)[index];
    if (!m) return null;
    const rec = activeRecord(m, this.journal.tombstones);
    if (!rec) return null;
    const prefix = this.prefixState(this.fold(observed.slice(0, index)), m, rec, [], true);
    return prefix?.start ? { ...prefix, start: prefix.start, seed: rec.seed, pre: rec.events.slice(0, rec.pre) } : null;
  }

  /**
   * The state the narrator sees now (DESIGN §6): the latest planned in-flight turn's fold prefix plus
   * its planned events, else the head fold. Before the chat's first record it includes the starting
   * markers the first turn applies (the world's realism and time defaults, with the user's settings
   * filling in, DESIGN §9.1), so the palette judges actions at the levels the turn will use. Pure:
   * nothing is written.
   */
  renderState(observed: readonly ChainMessage[]): { state: WorldState; world: WorldDoc } | null {
    const planned = Object.values(this.journal.pending).filter((p) => p.planned).at(-1);
    if (planned) return this.renderPlanned(observed, planned);
    const out = this.fold(observed);
    const world = this.env.worlds(out.state.revision);
    if (!world) return null;
    const state = structuredClone(out.state);
    if (!this.journal.started) for (const body of this.env.startMarkers()) applyMarker(state, body, this.env);
    return { state, world };
  }

  /**
   * The state the narrator sees while `planned` is in flight: its fold prefix plus its planned events.
   * `renderState` reads the journal's; a turn the engine run took out (`take`) and a generation has
   * yet to adopt is read through this too, so its own prompt sees it (DESIGN §6.1). Pure.
   */
  renderPlanned(observed: readonly ChainMessage[], planned: PendingTurn): { state: WorldState; world: WorldDoc } | null {
    const index = planned.messageId ? observed.findIndex((m) => m.id === planned.messageId) : observed.length;
    const at = index < 0 ? observed.length : index;
    return this.prefixState(this.fold(observed.slice(0, at)), this.chain(observed.slice(at, at + 1))[0], { markersApplied: planned.markersApplied, events: planned.events, pre: planned.events.length, path: this.commitPath(planned), undone: [] }, planned.startMarkers);
  }

  /**
   * What a turn's post steps will read against when it commits on `messageId` (its fold prefix
   * plus `pre`), so the backend can run `extract` first, and the state before `pre`: where the
   * player's message was said. Null when the reply won't be read (no pending turn, a pause before
   * it, or its own swipe deleted while it streamed, which leaves the commit nothing to record it on).
   */
  commitContext(generationId: GenerationId, messageId: MessageId, observed: readonly ChainMessage[]): { state: WorldState; world: WorldDoc; seed: string; pre: LedgerEvent[]; start: WorldState } | null {
    const p = this.journal.pending[generationId];
    const index = observed.findIndex((m) => m.id === messageId);
    if (!p || index < 0 || p.swipeId === GONE_SWIPE || this.pausedWithin(observed.slice(0, index))) return null;
    const at = this.plannedPrefix(p, observed, index);
    const prefix = this.prefixState(at.out, this.chain(observed.slice(index, index + 1))[0], { markersApplied: p.markersApplied, events: p.events, pre: p.events.length, path: at.path, undone: [] }, this.journal.started ? [] : p.startMarkers, true);
    return prefix?.start ? { ...prefix, start: prefix.start, seed: p.seed, pre: [...p.events] } : null;
  }

  /**
   * State the turn's post steps validate against: its fold prefix (P2) from `out`, the fold before its
   * target, plus a planned first turn's starting markers when given; and the target's parent path.
   * With `keepStart`, also the state before the planned events, which a read's minds need (DESIGN §24.4).
   */
  private prefixState(out: FoldOutput, target: ChainMessage | undefined, rec: Pick<Rec, "markersApplied" | "events" | "pre" | "path" | "undone">, start: readonly Marker[] = [], keepStart = false): { state: WorldState; world: WorldDoc; parent: PathHash; start?: WorldState } | null {
    const state = structuredClone(out.state);
    const parent = out.messages.at(-1)?.path ?? ROOT_PATH;
    for (const mk of [...(target?.ledger?.markers ?? [])].sort((a, b) => a.seq - b.seq)) {
      if (mk.seq <= rec.markersApplied && isLive(mk.at, parent, turnPath(rec))) applyMarker(state, mk, this.env);
    }
    for (const mk of start) applyMarker(state, mk, this.env);
    const world = this.env.worlds(state.revision);
    if (!world) return null;
    // The state the turn started from: who was there to hear the player's message.
    const before = keepStart ? structuredClone(state) : undefined;
    // The planned events as the fold applies them: an undone one doesn't count (a read after an undo
    // must not lean on what was undone; property seed rc-0d464a0-8843, L7).
    const planned = rec.events.slice(0, rec.pre).filter((_, i) => !rec.undone.some((u) => u.in === "events" && u.index === i));
    applyValidUnits(this.env.types, planned, state, (s) => this.env.types.context(world, s));
    return { state, world, parent, ...(before ? { start: before } : {}) };
  }

  /** Reads `text` against `state`, keeping each unit (an event, or a group) that validates in sequence. */
  private read(state: WorldState, world: WorldDoc, seed: string, text: string): LedgerEvent[] {
    const proposals = this.env.model.read({ state, ctx: this.env.types.context(world, state), seed, text });
    return applyValidUnits(this.env.types, proposals, state, (s) => this.env.types.context(world, s));
  }

  /** Whether an unresolved pause sits on one of these messages (everything after it is paused). */
  private pausedWithin(messages: readonly ChainMessage[]): boolean {
    return this.journal.pauses.some((pa) => messages.some((m) => m.id === pa.messageId));
  }

  private commit(p: PendingTurn, messageId: MessageId, content: string, status: RecStatus, observed: readonly ChainMessage[], readReply: boolean): void {
    const index = observed.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const swipeId = p.swipeId ?? observed[index]?.swipeId ?? 0;
    // The swipe the reply streamed into was deleted meanwhile: there is no swipe to record it on.
    if (swipeId === GONE_SWIPE) return;
    // A pause that arrived while the reply streamed: the plan stands (it was made on its path), the
    // reply goes unread (there is no state to read it against) and the record is degraded.
    const paused = this.pausedWithin(observed.slice(0, index));
    const read = readReply && content !== "" && !paused;
    // A Re-run (a Re-narrate that couldn't copy its source is one, P3) reads its reply on its fold
    // prefix, then carries its source's fixes after it; under a pause it carries none of them.
    const rerun = !p.copies && (p.kind === "swipe" || p.kind === "regenerate" || p.kind === "renarrate");
    const carries = rerun && !paused;
    // Read against the chain the turn was planned on, which places its record; one that reads and
    // carries nothing holds only what was validated where it was planned, and stays there.
    const at = read || carries || !p.planned ? this.plannedPrefix(p, observed, index) : null;
    const [target] = this.chain(observed.slice(index, index + 1));
    // The chat's first record folds its starting markers ahead of its events, so it is read with them.
    const start = this.journal.started ? [] : p.startMarkers;
    const rec: Rec = {
      v: 1,
      defHash: this.env.run.revision,
      seq: ++this.journal.seq,
      swipeHash: contentId(content),
      path: at?.path ?? this.commitPath(p),
      seed: p.seed,
      pre: p.events.length,
      events: [...p.events],
      post: [],
      markersApplied: p.markersApplied,
      status: paused && status === "ok" ? "degraded" : status,
      undone: [],
      intents: {},
    };
    if (at?.elsewhere) rec.readElsewhere = true;
    if (p.copies) {
      // P3: the copies keep their seqs and undos and travel with the record; the new narration's
      // post-step events are one `narr` entry, read against the same prefix the narration rendered
      // from, taking its seq at commit.
      rec.post = structuredClone(p.copies).map((e) => ({ ...e, at: rec.path }));
      rec.undone = structuredClone(p.undone ?? []);
      if (p.dropped && p.dropped.length > 0) rec.dropped = structuredClone(p.dropped);
      const prefix = at && read ? this.prefixState(at.out, target, rec, start) : null;
      if (prefix) {
        const later: ({ seq: number; marker: Marker } | { seq: number; entry: PostEntry })[] = [
          ...(target?.ledger?.markers ?? []).filter((mk) => mk.seq > rec.markersApplied && isLive(mk.at, prefix.parent, rec.path)).map((mk) => ({ seq: mk.seq, marker: mk })),
          ...rec.post.map((e) => ({ seq: e.seq, entry: e })),
        ].sort((a, b) => a.seq - b.seq);
        for (const item of later) {
          if ("marker" in item) applyMarker(prefix.state, item.marker, this.env);
          else {
            const live = item.entry.events.filter((_, i) => !rec.undone.some((u) => u.in === "post" && u.seq === item.entry.seq && u.index === i));
            applyValidUnits(this.env.types, live, prefix.state, (s) => this.env.types.context(prefix.world, s));
          }
        }
        const events = this.read(prefix.state, prefix.world, `${p.seed}:narr`, content);
        if (events.length > 0) rec.post.push({ seq: ++this.journal.seq, at: rec.path, kind: "narr", events });
      }
    } else if (at && (read || carries)) {
      const prefix = this.prefixState(at.out, target, rec, start);
      if (prefix && read) rec.events.push(...this.read(prefix.state, prefix.world, `${p.seed}:read`, content));
      // Starting markers land only on a record that holds events: one left with none folds its carried fixes without them.
      if (prefix && carries) this.carryFixes(rec, target, swipeId, start.length > 0 && rec.events.length === 0 ? (this.prefixState(at.out, target, rec) ?? prefix) : prefix);
    } else if (rerun && paused) {
      // What it leaves is what was live where it was made or on the chain in force, where it would
      // be read: the edit that paused it changed a user message of the chain it was planned on, or
      // it had no plan and commits where it lands.
      const inForce = (at?.out ?? this.fold(observed.slice(0, index))).messages.at(-1)?.path ?? ROOT_PATH;
      this.leaveFixes(rec, target, swipeId, [p.parentPath, inForce]);
    }
    const ledger = this.ledgerFor(messageId, observed[index]);
    ledger.swipes[String(swipeId)] = rec;
    if (!this.journal.started && rec.events.length > 0 && p.startMarkers.length > 0) {
      ledger.markers.push(...p.startMarkers);
      this.journal.started = true;
    }
  }

  private endContinue(p: PendingTurn, messageId: MessageId, content: string, observed: readonly ChainMessage[]): void {
    const index = observed.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const m = observed[index];
    if (!m) return;
    const ledger = this.ledgerFor(messageId, m);
    const rec = ledger.swipes[String(m.swipeId)];
    const isHead = p.continueHead === messageId;
    const captured = p.captured;
    const prefixIntact = captured !== undefined && content.length >= captured.len && contentId(content.slice(0, captured.len)).hash === captured.hash;
    if (isHead && rec && rec.events.length > 0 && prefixIntact && captured && sameContent(rec.swipeHash, captured)) {
      // A head Continue reads only its suffix into a `cont` entry (DESIGN §5.1 step 5, L13).
      const suffix = content.slice(captured.len);
      const parent = this.fold(observed).messages[index]?.parentPath ?? ROOT_PATH;
      const head = this.fold(observed.slice(0, index + 1));
      const world = this.env.worlds(head.state.revision);
      const events = world && suffix !== "" ? this.read(structuredClone(head.state), world, `${rec.seed}:cont:${this.journal.seq + 1}`, suffix) : [];
      if (events.length > 0) rec.post.push({ seq: ++this.journal.seq, at: parent, kind: "cont", events });
      rec.swipeHash = contentId(content);
      delete rec.accepted;
      return;
    }
    this.accept(messageId, m, content);
  }

  private stopContinue(partial: string, observed: readonly ChainMessage[]): void {
    // The target is found by content: the swipe that now ends with the partial suffix (DESIGN §5.1 step 6, L15).
    const candidates = observed.filter((m) => !m.isUser && partial !== "" && activeText(m).endsWith(partial));
    let target = candidates[0];
    if (candidates.length > 1) {
      target =
        candidates.find((m) => {
          const before = this.journal.chain.find((e) => e.id === m.id)?.content;
          const text = activeText(m);
          return before !== undefined && contentId(text.slice(0, before.len)).hash === before.hash;
        }) ?? target;
    }
    if (!target) return;
    this.accept(target.id, target, activeText(target));
  }

  /** An assistant message's new content accepted without reading it (an assistant edit; L14, L38). */
  private accept(messageId: MessageId, m: ChainMessage, content: string): void {
    const ledger = this.ledgerFor(messageId, m);
    const key = String(m.swipeId);
    const rec = ledger.swipes[key];
    const id = contentId(content);
    if (rec) {
      if (sameContent(rec.swipeHash, id)) delete rec.accepted;
      else rec.accepted = id;
      return;
    }
    const prev = this.journal.chain.find((e) => e.id === messageId);
    ledger.swipes[key] = this.bareRecord(prev?.content ?? id, id);
  }

  private close(generationId: GenerationId, observed: readonly ChainMessage[]): void {
    const j = this.journal;
    delete j.pending[generationId];
    j.windows = j.windows.filter((w) => w !== generationId);
    // Changes deferred while the turn was in flight are classified now, then held writes land (P2).
    this.classify(observed);
    for (const h of j.held) h.waitFor = h.waitFor.filter((w) => w !== generationId);
    const ready = j.held.filter((h) => h.waitFor.length === 0);
    j.held = j.held.filter((h) => h.waitFor.length > 0);
    // A held write that no longer applies is kept with its reason, so the player is told rather than
    // it vanishing (the view's notice; the GM view has the reason).
    for (const h of ready) {
      const reason = this.apply(h.write, observed);
      if (reason) this.refuse(h.write, reason, observed);
    }
    this.snapshot(observed);
  }

  private refuse(write: HeldWrite, reason: string, observed: readonly ChainMessage[]): void {
    const head = this.chain(observed).findLast((m) => !m.isUser)?.id ?? null;
    this.journal.refused = [...(this.journal.refused ?? []), { write, reason, messageId: head }].slice(-REFUSED_KEPT);
  }

  /** The player dismissed a refused write's notice; false when there was none. */
  dismissRefused(id: string): boolean {
    const before = this.journal.refused ?? [];
    const kept = before.filter((r) => r.write.id !== id);
    if (kept.length === before.length) return false;
    if (kept.length > 0) this.journal.refused = kept;
    else delete this.journal.refused;
    return true;
  }

  /**
   * Restart recovery (DESIGN §5.1 step 7): the windows of `gone`, generations a stopped backend left
   * open, close. A turn under way keeps its pending entry, so its reply is still read and recorded.
   */
  restart(observed: readonly ChainMessage[], gone: ReadonlySet<GenerationId>): void {
    for (const p of Object.values(this.journal.pending)) {
      if (!gone.has(p.generationId)) continue;
      const index = p.messageId ? observed.findIndex((m) => m.id === p.messageId) : -1;
      const m = index >= 0 ? observed[index] : undefined;
      const saved = m ? (m.swipes[p.swipeId ?? m.swipeId] ?? "") : "";
      const hasRecord = m?.ledger?.swipes[String(p.swipeId ?? m.swipeId)] !== undefined || (m && this.journal.messages[m.id]?.ledger.swipes[String(p.swipeId ?? m.swipeId)] !== undefined);
      if (m && p.messageId && saved !== "" && !hasRecord && p.kind !== "continue" && p.kind !== "impersonate") this.commit(p, p.messageId, saved, "degraded", observed, false);
      this.close(p.generationId, observed);
    }
  }

  // ------------------------------------------------------------------ user writes

  write(w: HeldWrite, observed: readonly ChainMessage[]): WriteResult {
    if (this.journal.pauses.length > 0 && w.kind !== "keep" && w.kind !== "discard") return { applied: false, pending: false, reason: "paused" };
    if (this.journal.windows.length > 0) {
      this.journal.held.push({ write: w, waitFor: [...this.journal.windows] });
      return { applied: false, pending: true };
    }
    const reason = this.apply(w, observed);
    this.snapshot(observed);
    return reason ? { applied: false, pending: false, reason } : { applied: true, pending: false };
  }

  /** Journals one write now; returns a rejection reason or undefined. */
  private apply(w: HeldWrite, observed: readonly ChainMessage[]): string | undefined {
    const j = this.journal;
    const chain = this.chain(observed);
    const headIndex = chain.map((m) => !m.isUser).lastIndexOf(true);
    const out = this.fold(observed);
    switch (w.kind) {
      case "post":
      case "marker": {
        if (headIndex < 0) return "no assistant message";
        const head = chain[headIndex];
        if (!head) return "no assistant message";
        const parent = out.messages[headIndex]?.parentPath ?? ROOT_PATH;
        const ledger = this.ledgerFor(head.id, observed[headIndex]);
        if (w.kind === "marker") {
          // Only a checked, clamped body is journaled (the request path checks too).
          const body = validMarkerBody(w.body);
          if (!body) return "invalid marker";
          ledger.markers.push({ ...body, seq: ++j.seq, at: parent });
          return undefined;
        }
        // A post entry validates against the head's fold; one that no longer applies is not journaled.
        // A materialization of detail the head already records (a held ✎ cash fix whose accounts the
        // reply opened) leaves it, and the rest is checked and journaled without it.
        const state = structuredClone(out.state);
        const world = this.env.worlds(state.revision);
        if (!world) return "unknown revision";
        const events: LedgerEvent[] = [];
        let recorded: string | null = null;
        for (const ev of w.entry.events) {
          const ctx = this.env.types.context(world, state);
          const failure = validateEvent(this.env.types, ev, ctx);
          if (failure?.code === "materialized") {
            recorded = failure.reason;
            continue;
          }
          if (failure) return failure.reason;
          applyEvent(this.env.types, ev, state, ctx);
          events.push(ev);
        }
        if (events.length === 0 && recorded !== null) return recorded;
        const key = String(head.swipeId);
        let rec = ledger.swipes[key];
        if (!rec) {
          rec = this.bareRecord(contentId(activeText(head)), undefined);
          ledger.swipes[key] = rec;
        }
        const entry: PostEntry = { ...w.entry, events, seq: ++j.seq, at: parent };
        rec.post.push(entry);
        return undefined;
      }
      case "keep": {
        j.pauses = j.pauses.filter((p) => p.messageId !== w.messageId);
        if (w.convert.length > 0) {
          const index = chain.findIndex((m) => m.id === w.messageId);
          const m = chain[index];
          if (!m) return "no message";
          const ledger = this.ledgerFor(m.id, observed[index]);
          const rec = ledger.swipes[String(m.swipeId)];
          if (!rec) return "no record";
          rec.keep ??= {};
          const overlay = (rec.keep[w.parentPath] ??= { convert: [] });
          overlay.convert.push(...w.convert);
        }
        return undefined;
      }
      case "discard": {
        const from = chain.findIndex((m) => m.id === w.after);
        if (from < 0) return "no message";
        for (const [offset, m] of chain.slice(from + 1).entries()) {
          const rec = activeRecord(m, j.tombstones);
          if (m.isUser || !rec) continue;
          // Tombstoned (so stale copies never return) and removed: the message becomes plain.
          j.tombstones.push({ messageId: m.id, swipeHash: rec.swipeHash, recHash: storedRecordHash(rec) });
          delete this.ledgerFor(m.id, observed[from + 1 + offset]).swipes[String(m.swipeId)];
        }
        j.pauses = j.pauses.filter((p) => p.messageId !== w.after);
        return undefined;
      }
      case "undo": {
        const index = chain.findIndex((m) => m.id === w.messageId);
        const m = chain[index];
        if (!m || m.swipeId !== w.swipeId) return "not the active swipe";
        const rec = this.ledgerFor(m.id, observed[index]).swipes[String(w.swipeId)];
        if (!rec) return "nothing to undo";
        // Undo changes the record, so like a read it runs only where the record folds as stored (L2),
        // which one read elsewhere never does.
        if (rec.readElsewhere) return readElsewhereRefusal(index === headIndex);
        if (rec.path !== "" && rec.path !== (out.messages[index]?.parentPath ?? ROOT_PATH)) return "You've swiped away from the timeline this reply was made on. Switch back to undo it.";
        const before = [...rec.undone];
        for (const ref of w.refs) if (!rec.undone.some((u) => JSON.stringify(u) === JSON.stringify(ref))) rec.undone.push(ref);
        // Later on-path events that need the undone one (using an item it bought) would stop
        // validating, so such an undo is refused rather than silently cascading (L7).
        if (this.fold(observed).violations.length > out.violations.length) {
          rec.undone = before;
          return "later events depend on it";
        }
        return undefined;
      }
      case "reread":
      case "retry_read": {
        const refused = this.readRefusal(w, observed);
        if (refused) return refused;
        const index = chain.findIndex((m) => m.id === w.messageId);
        const m = chain[index];
        const rec = m ? this.ledgerFor(m.id, observed[index]).swipes[String(w.swipeId)] : undefined;
        if (!m || !rec) return "nothing to read";
        const parent = out.messages[index]?.parentPath ?? ROOT_PATH;
        const text = activeText(m);
        if (rec.path === "" && (w.kind === "reread" ? rec.accepted !== undefined : rec.status === "stopped")) rec.path = parent;
        if (w.kind === "retry_read" && rec.status === "stopped") {
          // A stopped reply was saved unread, so its Retry read reads everything saved now, a Continue
          // after it included, and replaces what was read meanwhile: the Continue's suffix read and the
          // proposals confirmed from that read's chips (like a Re-read).
          const prefix = this.prefixState(this.fold(observed.slice(0, index)), this.chain(observed.slice(index, index + 1))[0], rec);
          if (!prefix) return "unknown revision";
          rec.events = [...rec.events.slice(0, rec.pre), ...this.read(prefix.state, prefix.world, `${rec.seed}:read`, text)];
          rec.post = rec.post.filter((p) => p.kind !== "confirm" && p.kind !== "cont");
          this.keepAfterRead(rec, m, prefix);
          rec.undone = plannedUndos(rec);
          rec.status = "ok";
          rec.swipeHash = contentId(text);
          delete rec.accepted;
          return undefined;
        }
        if (w.kind === "retry_read") {
          const head = this.fold(observed.slice(0, index + 1));
          const world = this.env.worlds(head.state.revision);
          if (!world) return "unknown revision";
          const events = this.read(structuredClone(head.state), world, `${rec.seed}:cont:${j.seq + 1}`, text.slice(rec.swipeHash.len));
          if (events.length > 0) rec.post.push({ seq: ++j.seq, at: out.messages[index]?.parentPath ?? ROOT_PATH, kind: "cont", events });
        } else {
          const prefix = this.prefixState(this.fold(observed.slice(0, index)), this.chain(observed.slice(index, index + 1))[0], rec);
          if (!prefix) return "unknown revision";
          rec.events = [...rec.events.slice(0, rec.pre), ...this.read(prefix.state, prefix.world, `${rec.seed}:reread:${j.seq + 1}`, text)];
          // A Re-read replaces the whole read: its read events, the Continue suffix reads (the text it
          // reads now holds them) and the proposals confirmed from its chips. Fixes and materialized
          // detail are not the read's, so they stay. Its new chips offer anything still narrated. A
          // stopped reply is now read, so it no longer offers a Retry read.
          rec.post = rec.post.filter((p) => p.kind !== "confirm" && p.kind !== "cont");
          this.keepAfterRead(rec, m, prefix);
          rec.undone = plannedUndos(rec);
          if (rec.status === "stopped") rec.status = "ok";
        }
        rec.swipeHash = contentId(text);
        delete rec.accepted;
        return undefined;
      }
    }
  }

  /**
   * After a read replaced a record's events, its remaining live entries (fixes, materialized detail,
   * a Re-narrate's narration) are re-validated after them: one that no longer applies is dropped
   * with a Journal note rather than failing on its own path (L7), and one the read already made
   * detail for stays without that materialization, its undos moved with its events.
   */
  private keepAfterRead(rec: Rec, target: ChainMessage, prefix: { state: WorldState; world: WorldDoc; parent: PathHash }): void {
    const live = rec.post.filter((p) => isLive(p.at, prefix.parent, turnPath(rec)));
    const markers = (target.ledger?.markers ?? []).filter((mk) => mk.seq > rec.markersApplied && isLive(mk.at, prefix.parent, turnPath(rec)));
    const carried = this.carry(prefix.state, prefix.world, live, rec.undone, markers);
    const kept = new Map(carried.kept.map((p) => [p.seq, p]));
    rec.post = rec.post.flatMap((p) => (carried.dropped.some((d) => d.seq === p.seq) ? [] : [kept.get(p.seq) ?? p]));
    // A kept entry's undos come back from `carry`, moved past what it left out; every other undo stays.
    rec.undone = [...rec.undone.filter((u) => u.in !== "post" || !kept.has(u.seq)), ...carried.undone];
    if (carried.dropped.length > 0) rec.dropped = [...(rec.dropped ?? []), ...carried.dropped];
  }

  /**
   * Why a Re-read or Retry read would be refused now, or null: checked before the read's model call
   * and its chips, so a refused read changes nothing. `apply` runs the same checks.
   */
  readRefusal(w: { kind: "reread" | "retry_read"; messageId: MessageId; swipeId: number }, observed: readonly ChainMessage[]): string | null {
    if (this.journal.pauses.length > 0) return "paused";
    const chain = this.chain(observed);
    const headIndex = chain.map((m) => !m.isUser).lastIndexOf(true);
    const index = chain.findIndex((m) => m.id === w.messageId);
    const m = chain[index];
    if (!m || m.swipeId !== w.swipeId) return "not the active swipe";
    const rec = this.journal.messages[m.id]?.ledger.swipes[String(w.swipeId)] ?? m.ledger?.swipes[String(w.swipeId)];
    if (!rec) return "nothing to read";
    // A read writes path-bound events, so it runs only where the record folds as stored: on its
    // path (never, for one read elsewhere), or on a bare record, which the read anchors here (it
    // becomes this turn's record).
    if (rec.readElsewhere) return readElsewhereRefusal(index === headIndex);
    const parent = this.fold(observed).messages[index]?.parentPath ?? ROOT_PATH;
    if (rec.path !== "" && rec.path !== parent) return "You've swiped away from the timeline this reply was made on. Switch back to read it.";
    if (w.kind === "retry_read" && rec.status === "stopped") return index === headIndex ? null : "not the head";
    if (!rec.accepted) return "nothing to read";
    if (w.kind === "retry_read") {
      const text = activeText(m);
      if (index !== headIndex || text.length < rec.swipeHash.len || contentId(text.slice(0, rec.swipeHash.len)).hash !== rec.swipeHash.hash) return "not a stopped head Continue";
    }
    return null;
  }
}

/** A record's undos that still point at something it holds: its planned events and its remaining post entries (a read just replaced the rest). */
function plannedUndos(rec: Pick<Rec, "undone" | "pre" | "post">): EventRef[] {
  return rec.undone.filter((u) => (u.in === "events" ? u.index < rec.pre : rec.post.some((p) => p.seq === u.seq)));
}

/**
 * The parent paths a message's ledger was written at: each record's turn path and `keep` entries,
 * and the `at` of its post entries and markers. On a chain hashed as it was then, those made on
 * this path equal the message's parent path.
 */
function storedPaths(ledger: MessageLedger): Set<PathHash> {
  const out = new Set<PathHash>();
  for (const rec of Object.values(ledger.swipes)) {
    if (rec.path !== "") out.add(rec.path);
    for (const key of Object.keys(rec.keep ?? {})) out.add(key);
    for (const p of rec.post) out.add(p.at);
  }
  for (const mk of ledger.markers) if (mk.at !== null) out.add(mk.at);
  return out;
}
