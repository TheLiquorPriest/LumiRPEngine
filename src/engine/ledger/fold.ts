// The optimized fold (DESIGN §4.3 Fold): the same semantics as the reference fold, plus
//  - a prefix cache keyed by fold key (path, record path, pause state), so a re-fold after a
//    change at the head reuses everything before it; only every SNAPSHOT_EVERY-th step (and each
//    fold's last) keeps a state copy, the rest keep their outputs;
//  - stored snapshots (cold folds): a fold with no cached prefix finds the furthest stored
//    state on its chain by path hash, rebuilds the outputs before it without state, and folds on
//    from there; it stores a snapshot every SNAPSHOT_EVERY messages;
//  - re-convergence: a rebased record whose running state equals the state its own path had
//    on the original chain applies without re-validation (validation is a function of state).
// L1 holds when this equals referenceFold for every input; L42 checks snapshot-started folds.

import { hashJson, hashParts } from "../../shared/hash";
import type { EventRef, JournalNote, KeepLine, LedgerEvent, Marker, MarkerBody, PathHash, PostEntry, Rec } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import { applyEvent, applyMarker, validateEvent } from "../events";
import type { WorldState } from "../state";
import { initialState } from "../world-state";
import { FoldError, type ChainMessage, type FoldInput, type FoldOutput, type FoldSnapshot, type MessageResult } from "./chain";
import { activeRecord, activeText, contentId, isLive, isTombstoned, markersHash, recordHash, stepPath, turnPath } from "./path";
import type { FoldTypes } from "./reference";

interface Step {
  /** The state after this step; kept on checkpoints and each fold's last step only. */
  state: WorldState | null;
  result: MessageResult;
  notes: JournalNote[];
  keep: KeepLine[];
  violations: string[];
  paused: boolean;
}

interface Frame {
  result: MessageResult;
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

/** State-dependent outputs (the rest are rebuilt from the chain without state). */
const dependentNote = (n: JournalNote): boolean => n.kind === "dropped";
const dependentKeep = (k: KeepLine): boolean => k.status === "dropped" || k.status === "converted";

export interface LedgerFoldOptions {
  /** Steps between state copies in the cache and between stored snapshots. */
  snapshotEvery?: number;
  /** Identifies the code that folded (a build id): snapshots from other code never apply. */
  fingerprint?: string;
  /** Cached steps (most hold outputs only). */
  capacity?: number;
}

export class LedgerFold {
  private readonly cache = new Map<string, Step>();
  /** Hash of the state before each record, on the path it was folded on, for re-convergence. */
  private readonly pathStates = new Map<PathHash, string>();
  private readonly every: number;
  private readonly fingerprint: string;
  private readonly capacity: number;
  /** Cache keys whose state copy exists only because they ended a fold (demoted when they age out). */
  private readonly tails: string[] = [];
  /**
   * Digests of message texts, stored records and markers, keyed by their exact text (a warm
   * fold's prefix walk then hashes only what changed; the lookup is the host's string hashing).
   * Records and markers come from parsed JSON, so their JSON text determines their canonical digest.
   */
  private readonly digests = { content: new Map<string, string>(), record: new Map<string, string>(), markers: new Map<string, string>(), key: new Map<string, string>() };

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
    const text = activeText(m);
    const content = this.digest(this.digests.content, text, () => contentId(text).hash);
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
    // A kept state (a cached step's, a snapshot's) is shared: it is copied once, only if a step runs
    // on it or the output takes it. The working state is local to this fold, so the output takes it as is.
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
        if (found) {
          best = i;
          snapshot = found;
        }
      }
      if (snapshot && best > base) {
        const notes = new Map<number, JournalNote[]>();
        const keep = new Map<number, KeepLine[]>();
        const violations = new Map<number, string[]>();
        for (const [i, x] of snapshot.notes) notes.set(i, [...(notes.get(i) ?? []), x]);
        for (const [i, x] of snapshot.keep) keep.set(i, [...(keep.get(i) ?? []), x]);
        for (const [i, x] of snapshot.violations) violations.set(i, [...(violations.get(i) ?? []), x]);
        // Steps already cached keep their outputs; the rest come from their frames and the snapshot.
        for (let i = base + 1; i <= best; i++) {
          const f = frames[i - base - 1] as Frame;
          steps.push({ state: null, result: f.result, notes: [...f.notes, ...(notes.get(i) ?? [])], keep: [...f.keep, ...(keep.get(i) ?? [])], violations: violations.get(i) ?? [], paused: false });
          keys.push(frameKeys[i - base - 1] as string);
        }
        shared = snapshot.state;
        state = shared;
        base = best;
        parent = steps[best]?.result.path ?? ROOT_PATH;
        key = keys[best] ?? key;
        paused = false;
      }
    }

    // 3. Fold on from there.
    if (shared && base < n - 1) {
      state = structuredClone(shared);
      shared = null;
    }
    for (let i = base + 1; i < n; i++) {
      const m = input.chain[i] as ChainMessage;
      key = this.keyOf(key, m, input, paused, pausedAfter.has(m.id));
      const f = this.frame(input, m, parent, paused, pausedAfter.has(m.id));
      const step = this.step(input, m, f, state);
      const checkpoint = (i + 1) % this.every === 0;
      this.remember(key, step, checkpoint || i === n - 1, !checkpoint && i === n - 1);
      steps.push(step);
      keys.push(key);
      parent = step.result.path;
      paused = step.paused;
      if (checkpoint && input.snapshots && input.pauses.length === 0) input.snapshots.put(this.snapshotOf(hashParts(context, parent), steps, state));
    }

    const out: FoldOutput = { state: shared ? structuredClone(shared) : state, notes: [], keepReport: [], messages: [], violations: [] };
    for (const s of steps) {
      out.messages.push(s.result);
      out.notes.push(...s.notes);
      out.keepReport.push(...s.keep);
      out.violations.push(...s.violations);
    }
    return out;
  }

  private snapshotOf(key: string, steps: readonly Step[], state: WorldState): FoldSnapshot {
    const snap: FoldSnapshot = { key, state: structuredClone(state), notes: [], keep: [], violations: [] };
    steps.forEach((s, i) => {
      for (const x of s.notes) if (dependentNote(x)) snap.notes.push([i, x]);
      for (const x of s.keep) if (dependentKeep(x)) snap.keep.push([i, x]);
      for (const x of s.violations) snap.violations.push([i, x]);
    });
    return snap;
  }

  private remember(key: string, step: Step, withState: boolean, tail: boolean): void {
    // Steps share the live working state while a fold runs; copy it only where it is kept.
    const entry: Step = { ...step, state: withState && step.state ? structuredClone(step.state) : null };
    this.cache.set(key, entry);
    if (tail) {
      this.tails.push(key);
      // Only the newest fold ends keep their state; older ones fall back to the checkpoints.
      while (this.tails.length > 64) {
        const old = this.tails.shift();
        const e = old === undefined ? undefined : this.cache.get(old);
        if (e && old !== key) e.state = null;
      }
    }
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private step(input: FoldInput, m: ChainMessage, f: Frame, state: WorldState): Step {
    const notes: JournalNote[] = [...f.notes];
    const keep: KeepLine[] = [...f.keep];
    const violations: string[] = [];
    const types = this.types;
    const ctx = () => {
      const world = input.worlds(state.revision);
      if (!world) throw new FoldError(`unknown revision ${state.revision}`);
      return types.context(world, state);
    };
    const marker = (mk: Marker): void => {
      if (mk.kind === "migrate" && !input.worlds(mk.to)) throw new FoldError(`unknown revision ${mk.to}`);
      applyMarker(state, mk);
    };
    const { rec, recPath, liveMarkers, livePost } = f;
    const parent = f.result.parentPath;
    if (m.isUser || f.result.fold === "paused") {
      // A user message changes no state; a paused one waits for Keep or Discard.
    } else if (!rec) {
      for (const mk of liveMarkers) marker(mk);
    } else {
      const view = recPath !== null && recPath !== parent;
      let converged = false;
      if (view) {
        const original = this.pathStates.get(recPath);
        converged = original !== undefined && original === hashJson(state);
      } else if (recPath !== null && !this.pathStates.has(recPath)) {
        this.pathStates.set(recPath, hashJson(state));
      }
      const converted = rec.keep?.[parent]?.convert ?? [];
      const record = rec;
      const event = (ev: LedgerEvent, ref: EventRef): void => {
        if (record.undone.some((u) => refEq(u, ref))) return;
        if (converged) {
          applyEvent(types, ev, state, ctx());
          return;
        }
        const failure = validateEvent(types, ev, ctx());
        if (failure && !view) {
          violations.push(`${m.id}: on-path ${ev.type} failed re-validation (${failure.reason})`);
          return;
        }
        if (failure) {
          if (converted.some((c) => refEq(c, ref))) {
            keep.push({ messageId: m.id, parentPath: parent, ref, status: "converted", text: failure.reason });
          } else {
            notes.push({ kind: "dropped", messageId: m.id, ref, text: failure.reason });
            keep.push({ messageId: m.id, parentPath: parent, ref, status: "dropped", text: failure.reason });
            return;
          }
        }
        applyEvent(types, ev, state, ctx());
      };
      // Groups on a rebased view land whole or not at all (the reference fold's rule, written apart).
      const run = (list: readonly LedgerEvent[], refOf: (index: number) => EventRef): void => {
        for (let i = 0; i < list.length; ) {
          const group = list[i]?.group;
          let end = i + 1;
          if (group !== undefined) while (end < list.length && list[end]?.group === group) end++;
          const unit: { ev: LedgerEvent; ref: EventRef }[] = [];
          for (let k = i; k < end; k++) {
            const ev = list[k];
            const ref = refOf(k);
            if (ev && !record.undone.some((u) => refEq(u, ref))) unit.push({ ev, ref });
          }
          i = end;
          if (unit.length < 2 || !view || converged) {
            for (const u of unit) event(u.ev, u.ref);
            continue;
          }
          const world = input.worlds(state.revision);
          if (!world) throw new FoldError(`unknown revision ${state.revision}`);
          const scratch = structuredClone(state);
          const failure =
            unit
              .map((u) => u.ev)
              .reduce<{ reason: string } | null>((found, ev) => {
                if (found) return found;
                const c = types.context(world, scratch);
                const rejection = validateEvent(types, ev, c);
                if (!rejection) applyEvent(types, ev, scratch, c);
                return rejection;
              }, null);
          if (failure === null) {
            for (const u of unit) applyEvent(types, u.ev, state, ctx());
          } else if (unit.some((u) => converted.some((c) => refEq(c, u.ref)))) {
            for (const u of unit) {
              const own = validateEvent(types, u.ev, ctx());
              if (own) keep.push({ messageId: m.id, parentPath: parent, ref: u.ref, status: "converted", text: own.reason });
              applyEvent(types, u.ev, state, ctx());
            }
          } else {
            for (const u of unit) {
              notes.push({ kind: "dropped", messageId: m.id, ref: u.ref, text: failure.reason });
              keep.push({ messageId: m.id, parentPath: parent, ref: u.ref, status: "dropped", text: failure.reason });
            }
          }
        }
      };
      for (const mk of liveMarkers) if (mk.seq <= record.markersApplied) marker(mk);
      run(record.events, (index) => ({ in: "events", index }));
      const later: ({ seq: number; marker: Marker } | { seq: number; post: PostEntry })[] = [
        ...liveMarkers.filter((mk) => mk.seq > record.markersApplied).map((mk) => ({ seq: mk.seq, marker: mk })),
        ...livePost.map((p) => ({ seq: p.seq, post: p })),
      ].sort((a, b) => a.seq - b.seq);
      for (const item of later) {
        if ("marker" in item) marker(item.marker);
        else run(item.post.events, (index) => ({ in: "post", seq: item.post.seq, index }));
      }
    }
    return { state, result: f.result, notes, keep, violations, paused: f.paused };
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
      for (const d of rec.dropped ?? []) notes.push({ kind: "renarrate_drop", messageId: m.id, ref: { in: "post", seq: d.seq, index: 0 }, text: d.reason });
    }
    const view = recPath !== null && recPath !== parent;
    const fold: MessageResult["fold"] = paused ? "paused" : !rec ? (tombstoned ? "tombstoned" : "plain") : recPath === null ? "plain" : view ? "view" : "on_path";
    const content = rec ? rec.swipeHash.hash : contentId(activeText(m)).hash;
    const path = stepPath(parent, false, content, recordHash(rec, livePost, parent), markersHash(liveMarkers));
    return { result: { id: m.id, fold, parentPath: parent, path }, notes, keep, rec, recPath, liveMarkers, livePost, paused };
  }
}
