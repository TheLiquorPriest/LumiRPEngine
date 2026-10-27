// The optimized fold (DESIGN §4.3 Fold): the same semantics as the reference fold, plus
//  - a prefix cache keyed by fold key (path, record path, pause state), so a re-fold after a
//    change at the head reuses everything before it; only every SNAPSHOT_EVERY-th step (a
//    checkpoint) and each fold's last keep a state copy, the rest keep their outputs; of those,
//    the TAILS_KEPT fold ends and CHECKPOINTS_KEPT checkpoints used last keep it, and steps that
//    hold the same state (one that changed nothing, a stored snapshot) hold the same copy;
//  - stored snapshots (cold folds): a fold with no cached prefix finds the furthest stored
//    state on its chain by path hash, rebuilds the outputs before it without state (and caches
//    them, so the next fold walks the cache past it), and folds on from there; it stores a
//    snapshot every SNAPSHOT_EVERY messages;
//  - re-convergence: a rebased record whose running state equals the state a record folding the
//    same (events, post entries, undos, Keep overlays, path and markers) folded from on its own
//    path with nothing failing applies without re-validation (validation is a function of state).
// L1 holds when this equals referenceFold for every input; L42 checks snapshot-started folds.

import { hashJson, hashParts } from "../../shared/hash";
import type { EventRef, JournalNote, KeepLine, LedgerEvent, Marker, MarkerBody, PathHash, PostEntry, Rec } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import { apartHost, applyEvent, applyMarker, tiesOf, TIED_DROP, validateEvent } from "../events";
import type { WorldState } from "../state";
import { initialState } from "../world-state";
import { FoldError, type ChainMessage, type FoldInput, type FoldOutput, type FoldSnapshot, type MessageResult, type ResolvedFix } from "./chain";
import { activeRecord, activeText, contentId, isLive, isTombstoned, markersHash, recordHash, stepPath, turnPath } from "./path";
import type { FoldTypes } from "./reference";

interface Step {
  /** The state after this step: kept on few checkpoints and fold ends (`kept`), else null. */
  state: WorldState | null;
  result: MessageResult;
  notes: JournalNote[];
  keep: KeepLine[];
  violations: string[];
  /** The GM edits and ✎ fixes this step, a rebased view, worked out again: state-dependent, as its drops are. */
  resolved: ResolvedFix[];
  paused: boolean;
}

interface Frame {
  /** Everything of the step's result but its clock, which only folding the state gives. */
  result: Omit<MessageResult, "clock">;
  notes: JournalNote[];
  keep: KeepLine[];
  rec: Rec | null;
  recPath: PathHash | null;
  liveMarkers: (MarkerBody & { seq: number; at: PathHash | null })[];
  livePost: PostEntry[];
  /** Whether the chain is paused after this message. */
  paused: boolean;
}

function refEq(a: EventRef, b: EventRef): boolean {
  if (a.in !== b.in || a.index !== b.index) return false;
  return a.in === "events" || (b.in === "post" && a.seq === b.seq);
}

/** State-dependent outputs (the rest are rebuilt from the chain without state): drops, and an Upgrade's notes. */
const dependentNote = (n: JournalNote): boolean => n.kind === "dropped" || n.kind === "note";
const dependentKeep = (k: KeepLine): boolean => k.status === "dropped" || k.status === "converted";

/** Fold ends whose state the cache keeps, the most recently used: a turn folds its chat's head, and the messages just before it, over and over. */
export const TAILS_KEPT = 8;
/** Checkpoints whose state the cache keeps, the most recently used; the chat's stored snapshots hold its own too. */
export const CHECKPOINTS_KEPT = 16;

export interface LedgerFoldOptions {
  /** Steps between state copies in the cache and between stored snapshots. */
  snapshotEvery?: number;
  /** Identifies the code that folded (a build id): snapshots from other code never apply. */
  fingerprint?: string;
  /** Cached steps (most hold outputs only). */
  capacity?: number;
}

/** What a cached step keeps its state for: it is a checkpoint, or it ended a fold. */
type Kept = "checkpoint" | "tail";

const KEPT_LIMIT: Readonly<Record<Kept, number>> = { checkpoint: CHECKPOINTS_KEPT, tail: TAILS_KEPT };

export class LedgerFold {
  private readonly cache = new Map<string, Step>();
  /**
   * Per record fold (what a step folds besides the state: the record's events, `markersApplied`,
   * post entries, undos, Keep overlays and path, and its message's markers): the hash of the state
   * it folded from on the record's own path with nothing failing, for re-convergence. Keyed by
   * record, not by path: the swipes of a message share their parent path, and one may hold what
   * fails there. What the step never reads (an accepted edit, the status) leaves it as it was.
   */
  private readonly settled = new Map<string, string>();
  private readonly every: number;
  private readonly fingerprint: string;
  private readonly capacity: number;
  /** The cache keys whose step keeps its state, by what for, least recently used first (`keep`). */
  private readonly kept: Record<Kept, Map<string, true>> = { checkpoint: new Map(), tail: new Map() };
  /**
   * Digests of stored records, markers and record folds, keyed by their exact text (a warm fold's
   * prefix walk then hashes only what changed; the lookup is the host's string hashing). Records and
   * markers come from parsed JSON, so their JSON text determines their canonical digest. Message
   * texts are `contentId`'s, which keeps one copy of each, the one the chat's messages hold now.
   */
  private readonly digests = { record: new Map<string, string>(), markers: new Map<string, string>(), folds: new Map<string, string>(), key: new Map<string, string>() };

  constructor(
    private readonly types: FoldTypes,
    options: LedgerFoldOptions = {},
  ) {
    this.every = Math.max(1, options.snapshotEvery ?? 200);
    this.fingerprint = options.fingerprint ?? "dev";
    this.capacity = options.capacity ?? 1 << 16;
  }

  private keyOf(prev: string, m: ChainMessage, input: FoldInput, paused: boolean, pausesHere: boolean): string {
    const rec = activeRecord(m, input.tombstones);
    // A tombstoned record folds as none, but adds a note: key the stored record, and whether it is live.
    const stored = m.ledger?.swipes[String(m.swipeId)];
    const recKey = stored ? `${rec ? "r" : "t"}${this.digest(this.digests.record, JSON.stringify(stored), () => hashJson(stored))}` : "";
    const markers = m.ledger ? this.digest(this.digests.markers, JSON.stringify(m.ledger.markers), () => hashJson(m.ledger?.markers)) : "";
    const content = contentId(activeText(m)).hash;
    const flags = `${m.isUser ? "u" : "a"}${paused ? "p" : ""}${pausesHere ? "P" : ""}`;
    // The memo key: every part but the message id has a fixed form without NUL, and the id comes last.
    const memo = `${prev}\u0000${flags}\u0000${m.swipeId}\u0000${content}\u0000${recKey}\u0000${markers}\u0000${m.id}`;
    return this.digest(this.digests.key, memo, () => hashParts("lre.fold", prev, m.id, m.isUser ? "u" : "a", String(m.swipeId), content, recKey, markers, paused ? "p" : "", pausesHere ? "P" : ""));
  }

  private digest(memo: Map<string, string>, text: string, compute: () => string): string {
    const hit = memo.get(text);
    if (hit !== undefined) return hit;
    const d = compute();
    if (memo.size >= this.capacity) {
      const oldest = memo.keys().next();
      if (!oldest.done) memo.delete(oldest.value);
    }
    memo.set(text, d);
    return d;
  }

  fold(input: FoldInput): FoldOutput {
    const startWorld = input.worlds(input.revision);
    if (!startWorld) throw new FoldError(`unknown revision ${input.revision}`);
    const n = input.chain.length;
    const pausedAfter = new Set(input.pauses.map((p) => p.messageId));
    const steps: Step[] = [];
    const keys: string[] = [];
    let key = hashParts("lre.fold", input.revision);
    let paused = false;
    // 1. The cached prefix, and the last cached step that kept its state.
    let base = -1;
    for (let i = 0; i < n; i++) {
      const m = input.chain[i] as ChainMessage;
      const k = this.keyOf(key, m, input, paused, pausedAfter.has(m.id));
      const cached = this.cache.get(k);
      if (!cached) break;
      steps.push(cached);
      keys.push(k);
      key = k;
      paused = cached.paused;
      if (cached.state) base = i;
    }
    const from = base >= 0 ? steps[base] : undefined;
    if (base >= 0) this.used(keys[base] as string);
    // A kept state (a cached step's, a snapshot's) is shared: it is copied once, only when a step
    // changes it or the output takes it. The working state is local to this fold, so the output takes it as is.
    let shared: WorldState | null = from?.state ?? null;
    let state: WorldState = shared ?? initialState(startWorld, input.revision, this.types);
    steps.length = base + 1;
    keys.length = base + 1;
    let parent: PathHash = from?.result.path ?? ROOT_PATH;
    key = keys[base] ?? hashParts("lre.fold", input.revision);
    paused = from?.paused ?? false;

    // 2. A stored snapshot further along this chain (no pauses: a snapshot never spans one).
    const context = hashParts("lre.snap", this.fingerprint, input.revision);
    if (input.snapshots && input.pauses.length === 0 && base < n - 1) {
      const frames: Frame[] = [];
      const frameKeys: string[] = [];
      let p = parent;
      let k = key;
      let best = -1;
      let snapshot: FoldSnapshot | undefined;
      for (let i = base + 1; i < n; i++) {
        const m = input.chain[i] as ChainMessage;
        const f = this.frame(input, m, p, false, false);
        k = this.keyOf(k, m, input, false, false);
        frames.push(f);
        frameKeys.push(k);
        p = f.result.path;
        if ((i + 1) % this.every !== 0) continue;
        const found = input.snapshots.get(hashParts(context, p));
        // A snapshot that lacks the clock of a step it would restore (saved before steps kept their
        // clocks, or on top of one), or the fixes its views worked out again (saved before the folds
        // kept them), is passed over, so every reply keeps the time it ended at and its chips.
        if (found && found.resolved !== undefined && clocksCover(found, base, i)) {
          best = i;
          snapshot = found;
        }
      }
      if (snapshot && best > base) {
        const notes = new Map<number, JournalNote[]>();
        const keep = new Map<number, KeepLine[]>();
        const violations = new Map<number, string[]>();
        const resolved = new Map<number, ResolvedFix[]>();
        for (const [i, x] of snapshot.notes) notes.set(i, [...(notes.get(i) ?? []), x]);
        for (const [i, x] of snapshot.keep) keep.set(i, [...(keep.get(i) ?? []), x]);
        for (const [i, x] of snapshot.violations) violations.set(i, [...(violations.get(i) ?? []), x]);
        for (const [i, x] of snapshot.resolved ?? []) resolved.set(i, [...(resolved.get(i) ?? []), x]);
        const clocks = new Map(snapshot.clocks ?? []);
        // Steps already cached keep their outputs; the rest come from their frames and the snapshot.
        // They are remembered, the snapshot's step with its state, so the next fold of this chain
        // walks the cache past the snapshot instead of starting from it again.
        for (let i = base + 1; i <= best; i++) {
          const f = frames[i - base - 1] as Frame;
          const k = frameKeys[i - base - 1] as string;
          const step: Step = { state: null, result: { ...f.result, clock: clocks.get(i) ?? null }, notes: [...f.notes, ...(notes.get(i) ?? [])], keep: [...f.keep, ...(keep.get(i) ?? [])], violations: violations.get(i) ?? [], resolved: resolved.get(i) ?? [], paused: false };
          this.remember(k, i === best ? { ...step, state: snapshot.state } : step, i === best ? "checkpoint" : null, true);
          steps.push(step);
          keys.push(k);
        }
        shared = snapshot.state;
        state = shared;
        base = best;
        parent = steps[best]?.result.path ?? ROOT_PATH;
        key = keys[best] ?? key;
        paused = false;
      }
    }

    // 3. Fold on from there. A step that changes nothing (a user message, a paused one, one with no
    // record or marker to fold) ends on the state it started from: a kept state is copied only when
    // the first step that may change it runs, and the steps before that keep the same state.
    for (let i = base + 1; i < n; i++) {
      const m = input.chain[i] as ChainMessage;
      key = this.keyOf(key, m, input, paused, pausedAfter.has(m.id));
      const f = this.frame(input, m, parent, paused, pausedAfter.has(m.id));
      if (shared && !(m.isUser || f.result.fold === "paused" || (!f.rec && f.liveMarkers.length === 0))) {
        state = structuredClone(shared);
        shared = null;
      }
      const step = this.step(input, m, f, shared ?? state);
      const checkpoint = (i + 1) % this.every === 0;
      const kept = this.remember(key, step, checkpoint ? "checkpoint" : i === n - 1 ? "tail" : null, shared !== null);
      steps.push(step);
      keys.push(key);
      parent = step.result.path;
      paused = step.paused;
      if (kept && checkpoint && input.snapshots && input.pauses.length === 0) input.snapshots.put(this.snapshotOf(hashParts(context, parent), steps, kept));
    }

    const out: FoldOutput = { state: shared ? structuredClone(shared) : state, notes: [], keepReport: [], messages: [], resolved: [], violations: [] };
    for (const s of steps) {
      out.messages.push(s.result);
      out.notes.push(...s.notes);
      out.keepReport.push(...s.keep);
      out.resolved.push(...s.resolved);
      out.violations.push(...s.violations);
    }
    return out;
  }

  /** The stored snapshot of a checkpoint: `state` is the copy its cached step keeps, which no fold changes, so the snapshot holds that copy too. */
  private snapshotOf(key: string, steps: readonly Step[], state: WorldState): FoldSnapshot {
    const clocks: [number, number][] = [];
    const resolved: [number, ResolvedFix][] = [];
    const snap: FoldSnapshot = { key, state, notes: [], keep: [], violations: [], clocks, resolved };
    steps.forEach((s, i) => {
      for (const x of s.notes) if (dependentNote(x)) snap.notes.push([i, x]);
      for (const x of s.keep) if (dependentKeep(x)) snap.keep.push([i, x]);
      for (const x of s.violations) snap.violations.push([i, x]);
      for (const x of s.resolved) resolved.push([i, x]);
      if (s.result.clock !== null) clocks.push([i, s.result.clock]);
    });
    return snap;
  }

  /**
   * Caches a step's outputs and, for `kept`, its state, which it returns. The live working state is
   * copied; a `shared` one (a stored snapshot's, or a kept state that a step that changed nothing
   * ended on) is a copy no fold changes, kept as it is.
   */
  private remember(key: string, step: Step, kept: Kept | null, shared: boolean): WorldState | null {
    const state = kept && step.state ? (shared ? step.state : structuredClone(step.state)) : null;
    this.cache.set(key, { ...step, state });
    this.kept.checkpoint.delete(key);
    this.kept.tail.delete(key);
    if (kept && state) this.keep(kept, key);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
      this.kept.checkpoint.delete(oldest);
      this.kept.tail.delete(oldest);
    }
    return state;
  }

  /** `key`'s state is the newest of its kind kept; past the kind's limit the one used longest ago is let go (its step keeps its outputs). */
  private keep(kind: Kept, key: string): void {
    const kept = this.kept[kind];
    kept.delete(key);
    kept.set(key, true);
    while (kept.size > KEPT_LIMIT[kind]) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
      const entry = this.cache.get(oldest);
      if (entry) entry.state = null;
    }
  }

  /** A fold started from `key`'s kept state: it is the newest kept again. */
  private used(key: string): void {
    if (this.kept.tail.has(key)) this.keep("tail", key);
    else if (this.kept.checkpoint.has(key)) this.keep("checkpoint", key);
  }

  private step(input: FoldInput, m: ChainMessage, f: Frame, state: WorldState): Step {
    const notes: JournalNote[] = [...f.notes];
    const keep: KeepLine[] = [...f.keep];
    const violations: string[] = [];
    const resolved: ResolvedFix[] = [];
    const types = this.types;
    const ctx = () => {
      const world = input.worlds(state.revision);
      if (!world) throw new FoldError(`unknown revision ${state.revision}`);
      return types.context(world, state);
    };
    const env = { worlds: input.worlds, types };
    const marker = (mk: Marker): void => {
      if (mk.kind === "migrate" && !input.worlds(mk.to)) throw new FoldError(`unknown revision ${mk.to}`);
      for (const text of applyMarker(state, mk, env)) notes.push({ kind: "note", messageId: m.id, ref: { marker: mk.seq }, text });
    };
    const { rec, recPath, liveMarkers, livePost } = f;
    const parent = f.result.parentPath;
    if (m.isUser || f.result.fold === "paused") {
      // A user message changes no state; a paused one waits for Keep or Discard.
    } else if (!rec) {
      for (const mk of liveMarkers) marker(mk);
    } else {
      const view = f.result.fold === "view";
      // Re-convergence is keyed by what this step folds besides the state.
      const folds = recPath === null ? null : [rec.events, rec.markersApplied, rec.post, rec.undone, rec.keep ?? null, rec.path, m.ledger?.markers ?? []];
      const settledKey = folds === null ? "" : this.digest(this.digests.folds, JSON.stringify(folds), () => hashJson(folds));
      const before = recPath !== null && !view && !this.settled.has(settledKey) ? hashJson(state) : null;
      let converged = false;
      if (view) {
        // A view folds as its record did on its own path only from the same state and with the same
        // entries: a marker or post entry made on this branch (live here by its `at`, inert on the
        // record's path) can make a stored one fail, so then everything is re-validated. So it is
        // when it holds a GM edit or ✎ fix with its request, which folds worked out again (`post`)
        // and may leave a state its record never folded on its own path.
        const asOnPath = liveMarkers.every((mk) => mk.at === null || mk.at === recPath) && livePost.every((p) => p.at === recPath && !(p.kind === "fix" && p.edit !== undefined));
        const original = this.settled.get(settledKey);
        converged = asOnPath && original !== undefined && original === hashJson(state);
      }
      const converted = rec.keep?.[parent]?.convert ?? [];
      const record = rec;
      // The groups this view dropped in the record so far, so a unit tied to one drops with it.
      const fell = new Set<string>();
      /** Folds one event; whether a rebased view dropped it. */
      const event = (ev: LedgerEvent, ref: EventRef): boolean => {
        if (record.undone.some((u) => refEq(u, ref))) return false;
        if (converged) {
          applyEvent(types, ev, state, ctx());
          return false;
        }
        const failure = validateEvent(types, ev, ctx());
        if (failure && !view) {
          violations.push(`${m.id}: on-path ${ev.type} failed re-validation (${failure.reason})`);
          return false;
        }
        if (failure) {
          if (converted.some((c) => refEq(c, ref))) {
            keep.push({ messageId: m.id, parentPath: parent, ref, status: "converted", text: failure.reason });
          } else {
            notes.push({ kind: "dropped", messageId: m.id, ref, text: failure.reason });
            keep.push({ messageId: m.id, parentPath: parent, ref, status: "dropped", text: failure.reason });
            return true;
          }
        }
        applyEvent(types, ev, state, ctx());
        return false;
      };
      // Groups on a rebased view land whole or not at all (the reference fold's rule, written apart),
      // and a unit kept apart (`APART_GROUP`) lands only with the unit it stands with: both if both
      // fit, else that unit alone, else neither; where either has a Keep conversion each folds alone.
      // A unit tied to one the view dropped (`tiedTo`) drops with it, unless Keep converted it.
      const run = (list: readonly LedgerEvent[], refOf: (index: number) => EventRef): void => {
        const unitAt = (i: number): { end: number; unit: { ev: LedgerEvent; ref: EventRef }[] } => {
          const group = list[i]?.group;
          let end = i + 1;
          if (group !== undefined) while (end < list.length && list[end]?.group === group) end++;
          const unit: { ev: LedgerEvent; ref: EventRef }[] = [];
          for (let k = i; k < end; k++) {
            const ev = list[k];
            const ref = refOf(k);
            if (ev && !record.undone.some((u) => refEq(u, ref))) unit.push({ ev, ref });
          }
          return { end, unit };
        };
        const trial = (unit: readonly { ev: LedgerEvent }[]): { reason: string } | null => {
          const world = input.worlds(state.revision);
          if (!world) throw new FoldError(`unknown revision ${state.revision}`);
          const scratch = structuredClone(state);
          return unit
            .map((u) => u.ev)
            .reduce<{ reason: string } | null>((found, ev) => {
              if (found) return found;
              const c = types.context(world, scratch);
              const rejection = validateEvent(types, ev, c);
              if (!rejection) applyEvent(types, ev, scratch, c);
              return rejection;
            }, null);
        };
        const drop = (unit: readonly { ref: EventRef }[], reason: string, group: string | undefined): void => {
          for (const u of unit) {
            notes.push({ kind: "dropped", messageId: m.id, ref: u.ref, text: reason });
            keep.push({ messageId: m.id, parentPath: parent, ref: u.ref, status: "dropped", text: reason });
          }
          if (group !== undefined && unit.length > 0) fell.add(group);
        };
        const isConverted = (unit: readonly { ref: EventRef }[]): boolean => unit.some((u) => converted.some((c) => refEq(c, u.ref)));
        for (let i = 0; i < list.length; ) {
          const { end, unit } = unitAt(i);
          const group = list[i]?.group;
          const host = view && !converged ? apartHost(list, [i, end]) : null;
          const hosted = host ? unitAt(host[0]).unit : [];
          if (host && !isConverted(unit) && !isConverted(hosted)) {
            i = host[1];
            const together = trial([...unit, ...hosted]);
            if (together === null) {
              for (const u of [...unit, ...hosted]) applyEvent(types, u.ev, state, ctx());
              continue;
            }
            const alone = trial(hosted);
            drop(unit, together.reason, group);
            if (alone === null) for (const u of hosted) applyEvent(types, u.ev, state, ctx());
            else drop(hosted, alone.reason, list[host[0]]?.group);
            continue;
          }
          i = end;
          if (view && !converged && !isConverted(unit) && tiesOf(unit.map((u) => u.ev)).some((t) => fell.has(t))) {
            drop(unit, TIED_DROP, group);
            continue;
          }
          if (unit.length < 2 || !view || converged) {
            for (const u of unit) if (event(u.ev, u.ref) && group !== undefined) fell.add(group);
            continue;
          }
          const failure = trial(unit);
          if (failure === null) {
            for (const u of unit) applyEvent(types, u.ev, state, ctx());
          } else if (isConverted(unit)) {
            for (const u of unit) {
              const own = validateEvent(types, u.ev, ctx());
              if (own) keep.push({ messageId: m.id, parentPath: parent, ref: u.ref, status: "converted", text: own.reason });
              applyEvent(types, u.ev, state, ctx());
            }
          } else drop(unit, failure.reason, group);
        }
      };
      // On a view, a GM edit or ✎ fix that keeps what it asked for folds as that request worked out
      // again against the state here (DESIGN §7, P2): the story before it changed, and it still says
      // what it said. One the request can't be made from is dropped whole, as a group is, by its first
      // ref when it holds no events of its own (it was already so where it was made); one undone or
      // converted in any part, by those refs too, folds as stored.
      const post = (p: PostEntry): void => {
        const refOf = (index: number): EventRef => ({ in: "post", seq: p.seq, index });
        const own = (u: EventRef): boolean => u.in === "post" && u.seq === p.seq;
        const asked = view && p.kind === "fix" && p.edit !== undefined && !record.undone.some(own) && !converted.some(own);
        const world = asked ? input.worlds(state.revision) : undefined;
        if (asked && !world) throw new FoldError(`unknown revision ${state.revision}`);
        const again = world ? input.resolveFix(world, state, p) : null;
        if (!again) {
          run(p.events, refOf);
          return;
        }
        if ("rejection" in again) {
          for (const i of p.events.length > 0 ? p.events.keys() : [0]) {
            notes.push({ kind: "dropped", messageId: m.id, ref: refOf(i), text: again.rejection.reason });
            keep.push({ messageId: m.id, parentPath: parent, ref: refOf(i), status: "dropped", text: again.rejection.reason });
          }
          return;
        }
        resolved.push({ messageId: m.id, seq: p.seq, events: again.events });
        for (const ev of again.events) applyEvent(types, ev, state, ctx());
      };
      for (const mk of liveMarkers) if (mk.seq <= record.markersApplied) marker(mk);
      run(record.events, (index) => ({ in: "events", index }));
      const later: ({ seq: number; marker: Marker } | { seq: number; post: PostEntry })[] = [
        ...liveMarkers.filter((mk) => mk.seq > record.markersApplied).map((mk) => ({ seq: mk.seq, marker: mk })),
        ...livePost.map((p) => ({ seq: p.seq, post: p })),
      ].sort((a, b) => a.seq - b.seq);
      for (const item of later) {
        if ("marker" in item) marker(item.marker);
        else post(item.post);
      }
      if (before !== null && violations.length === 0) this.digest(this.settled, settledKey, () => before);
    }
    return { state, result: { ...f.result, clock: state.clock }, notes, keep, violations, resolved, paused: f.paused };
  }

  /** Everything about one message that doesn't need the state: its record, live entries, path, fold kind and inert notes. */
  private frame(input: FoldInput, m: ChainMessage, parent: PathHash, paused: boolean, pausesHere: boolean): Frame {
    const notes: JournalNote[] = [];
    const keep: KeepLine[] = [];
    if (m.isUser) {
      const path = stepPath(parent, true, contentId(activeText(m)).hash, "", "");
      return { result: { id: m.id, fold: "user", parentPath: parent, path }, notes, keep, rec: null, recPath: null, liveMarkers: [], livePost: [], paused: paused || pausesHere };
    }
    const rec = activeRecord(m, input.tombstones);
    const stored = m.ledger?.swipes[String(m.swipeId)];
    const tombstoned = stored !== undefined && isTombstoned(input.tombstones, m.id, stored);
    if (tombstoned) notes.push({ kind: "tombstoned", messageId: m.id, ref: null, text: "discarded" });
    const recPath = turnPath(rec);
    const markers = [...(m.ledger?.markers ?? [])].sort((a, b) => a.seq - b.seq);
    const liveMarkers = markers.filter((mk) => isLive(mk.at, parent, recPath));
    for (const mk of markers) {
      if (isLive(mk.at, parent, recPath)) continue;
      notes.push({ kind: "inert", messageId: m.id, ref: { marker: mk.seq }, text: "made on another branch" });
      keep.push({ messageId: m.id, parentPath: parent, ref: { marker: mk.seq }, status: "inert", text: "made on another branch" });
    }
    const livePost: PostEntry[] = rec ? rec.post.filter((p) => isLive(p.at, parent, recPath)).sort((a, b) => a.seq - b.seq) : [];
    if (rec) {
      for (const p of rec.post) {
        if (isLive(p.at, parent, recPath)) continue;
        notes.push({ kind: "inert", messageId: m.id, ref: { in: "post", seq: p.seq, index: 0 }, text: "made on another branch" });
        keep.push({ messageId: m.id, parentPath: parent, ref: { in: "post", seq: p.seq, index: 0 }, status: "inert", text: "made on another branch" });
      }
      for (const d of rec.dropped ?? []) notes.push({ kind: "not_carried", messageId: m.id, ref: { in: "post", seq: d.seq, index: 0 }, text: d.reason });
    }
    // A record read elsewhere is a view on its own path too.
    const view = recPath !== null && (recPath !== parent || rec?.readElsewhere === true);
    const fold: MessageResult["fold"] = paused ? "paused" : !rec ? (tombstoned ? "tombstoned" : "plain") : recPath === null ? "plain" : view ? "view" : "on_path";
    const content = rec ? rec.swipeHash.hash : contentId(activeText(m)).hash;
    const path = stepPath(parent, false, content, recordHash(rec, livePost, parent), markersHash(liveMarkers));
    return { result: { id: m.id, fold, parentPath: parent, path }, notes, keep, rec, recPath, liveMarkers, livePost, paused };
  }
}

/** Whether a snapshot holds the clock of every step after `base` up to its own, `at`. */
function clocksCover(snapshot: FoldSnapshot, base: number, at: number): boolean {
  const have = new Set((snapshot.clocks ?? []).map(([i]) => i));
  for (let i = base + 1; i <= at; i++) if (!have.has(i)) return false;
  return true;
}
