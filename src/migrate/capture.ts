// Today's fold, run over a chat's chains with what it applied kept (STANDALONE-PLAN §15.3 item 7:
// "what the fold applied at that step becomes that turn's changes"). The importer carries today's
// fold rather than imitating it: `LedgerFold` folds every chain, and the event types it applies
// through are the registry's own, each wrapped only to note the event and the state it was applied
// to. An event tried on a scratch copy (a unit tried whole, an Upgrade's postings) is noted against
// that copy, so only what landed on the fold's working state counts. Each noted event is told apart
// by what it is: one of the record's own events, one of a post entry's, or one a GM edit or ✎ fix
// was worked out again into on a rebased view. Markers are applied by today's marker code, not by an
// event type, so they are taken in the order today's step applies them: those the record had taken
// before its events, its events, then later markers and post entries by their chat-wide number.

import type { ChainMessage, FoldInput } from "../engine/ledger/chain";
import { LedgerFold } from "../engine/ledger/fold";
import { activeRecord, isLive, turnPath } from "../engine/ledger/path";
import { validMarkerBody } from "../engine/events";
import type { EventTypeDef, ReadContext, Rejection } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import type { JsonObject } from "../shared/json";
import type { LedgerEvent, Marker, MessageFold, PathHash, PostEntry } from "../shared/ledger";
import type { FoldHandling } from "./failures";
import type { ChangeInput } from "../store/types";

/** The fold's own snapshot key: today's stored snapshots, made under another, never apply. */
const FINGERPRINT = "rpe-migration-import";

/** One step of today's fold: the last message of a chain, as today's fold folded it there. */
export interface FoldedStep {
  /** How it folded: on its own path, as a rebased view, paused, and so on. */
  fold: MessageFold;
  /** The chain's path before it, and after it. */
  parentPath: PathHash;
  path: PathHash;
  /** The world clock once it folded; null where today's fold gives none. */
  clock: number | null;
  /** What it applied, in the order it applied it, as RPE's changes. */
  changes: ChangeInput[];
  /** Today's state after it: the fold's own copy. */
  state: WorldState;
  /** Events a rebased view dropped there, and on-path events that failed to apply again. */
  dropped: number;
  violations: number;
}

/** A marker's body as a change: what today's marker code applies, without its number and path tag. */
function markerChange(mk: Marker): ChangeInput | null {
  const { seq: _seq, at: _at, start: _start, ...body } = mk;
  // A marker today's code reads as no marker applies nothing; the store would refuse it.
  if (validMarkerBody(body) === null) return null;
  return { lane: "engine", op: "store.marker", value: body as unknown as JsonObject, by: "import", source: "import" };
}

function eventChange(event: LedgerEvent): ChangeInput {
  return { lane: "engine", op: event.type, value: event as unknown as JsonObject, by: "import", source: "import" };
}

/**
 * Folds chains with today's fold and keeps what each chain's last step applied. One instance folds
 * one chat's chains, so that a chain's prefix folded before is not folded again.
 */
export class CapturingFold {
  private readonly fold: LedgerFold;
  /** Every event a reducer applied during the current fold, with the state it was applied to. */
  private noted: { event: LedgerEvent; state: WorldState }[] = [];
  /** What the fold was handling last: the event its type's check or reducer was given, else the type it asked for (`handling`). */
  private handled: FoldHandling = null;

  constructor(registry: Registry) {
    const wrapped = new Map<string, EventTypeDef | undefined>();
    const noted = (event: LedgerEvent, state: WorldState): void => {
      this.noted.push({ event, state });
    };
    const handles = (event: LedgerEvent): void => {
      this.handled = { event };
    };
    const get = (type: string): EventTypeDef | undefined => {
      // Asked for a type, the fold is about to handle an event of it: until its check or reducer is given that event, the type is all it knows.
      this.handled = { type };
      if (wrapped.has(type)) return wrapped.get(type);
      const def = registry.get(type);
      // The type as the registry has it, its check and its reducer each noting the event it is given, the reducer then noting what it applied; everything else read through to it (defined, not assigned: the registry's types are frozen).
      const own =
        def &&
        (Object.create(def, {
          validate: {
            value(event: LedgerEvent, ctx: ReadContext): Rejection | null {
              handles(event);
              return def.validate(event, ctx);
            },
          },
          apply: {
            value(event: LedgerEvent, state: WorldState, ctx: ReadContext): void {
              handles(event);
              def.apply(event, state, ctx);
              noted(event, state);
            },
          },
        }) as EventTypeDef);
      wrapped.set(type, own);
      return own;
    };
    // The registry is frozen: the fold is given one built on it, with its own `get` and the rest read through.
    const types = Object.create(registry, { get: { value: get } }) as Registry;
    this.fold = new LedgerFold(types, { fingerprint: FINGERPRINT });
  }

  /**
   * What the fold was handling when the last `last` failed: the event its type's check or reducer was given, or the type it asked for
   * where that was all it knew of the event (a type it has none of); null where it was handling none.
   */
  handling(): FoldHandling {
    return this.handled;
  }

  /**
   * Today's fold of `input`, and what its last message applied. The chain without its last message
   * is folded first: the fold keeps the state it ended on, so the second fold's own work is that last
   * message alone. Callers fold a chat's chains shortest first, so no chain is folded whole before.
   */
  last(input: FoldInput): FoldedStep {
    this.handled = null;
    const chain = input.chain;
    const m = chain.at(-1);
    if (m === undefined) throw new Error("A chain with no message has no last step.");
    if (chain.length > 1) this.fold.fold({ ...input, chain: chain.slice(0, -1) });
    this.noted = [];
    const out = this.fold.fold(input);
    const landed = this.noted.filter((n) => n.state === out.state).map((n) => n.event);
    this.noted = [];
    const result = out.messages.at(-1);
    if (result === undefined) throw new Error("The previous build's fold gave no step for the chain's last message.");
    const dropped = out.notes.filter((n) => n.kind === "dropped" && n.messageId === m.id).length;
    const violations = out.violations.filter((v) => v.startsWith(`${m.id}:`)).length;
    const changes = result.fold === "user" || result.fold === "paused" ? [] : appliedAt(m, input, result.parentPath, landed, out.resolved);
    return { fold: result.fold, parentPath: result.parentPath, path: result.path, clock: result.clock, changes, state: out.state, dropped, violations };
  }
}

/**
 * What today's step applied to message `m` (a reply, folded with `parent` before it), in its order:
 * the live markers the record took before its events, the record's events that landed, then the
 * later live markers and post entries by number, each entry's events that landed (as stored, or as
 * a GM edit or ✎ fix was worked out again). A reply with no live record applies its live markers.
 */
function appliedAt(m: ChainMessage, input: FoldInput, parent: PathHash, landed: readonly LedgerEvent[], resolved: readonly { messageId: string; seq: number; events: LedgerEvent[] }[]): ChangeInput[] {
  const rec = activeRecord(m, input.tombstones);
  const recPath = turnPath(rec);
  const markers = [...(m.ledger?.markers ?? [])].sort((a, b) => a.seq - b.seq).filter((mk) => isLive(mk.at, parent, recPath));
  const marker = (mk: Marker): ChangeInput[] => {
    const c = markerChange(mk);
    return c ? [c] : [];
  };
  if (!rec) return markers.flatMap(marker);
  const own = new Set<LedgerEvent>(rec.events);
  const entryOf = new Map<LedgerEvent, number>();
  const livePost: PostEntry[] = rec.post.filter((p) => isLive(p.at, parent, recPath)).sort((a, b) => a.seq - b.seq);
  for (const p of livePost) for (const ev of p.events) entryOf.set(ev, p.seq);
  for (const r of resolved) if (r.messageId === m.id) for (const ev of r.events) entryOf.set(ev, r.seq);
  const events = landed.filter((ev) => own.has(ev)).map(eventChange);
  const byEntry = new Map<number, ChangeInput[]>();
  for (const ev of landed) {
    const seq = entryOf.get(ev);
    if (seq !== undefined) byEntry.set(seq, [...(byEntry.get(seq) ?? []), eventChange(ev)]);
  }
  // Today's step: markers the record took first, its events, then markers and entries made later, by number (markers first on a tie).
  const later: ({ seq: number; marker: Marker } | { seq: number; post: PostEntry })[] = [
    ...markers.filter((mk) => mk.seq > rec.markersApplied).map((mk) => ({ seq: mk.seq, marker: mk })),
    ...livePost.map((p) => ({ seq: p.seq, post: p })),
  ].sort((a, b) => a.seq - b.seq);
  return [...markers.filter((mk) => mk.seq <= rec.markersApplied).flatMap(marker), ...events, ...later.flatMap((item) => ("marker" in item ? marker(item.marker) : (byEntry.get(item.seq) ?? [])))];
}

/** Today's fold of a chain as it stands, with nothing kept: what a chat's head is today. */
export function foldToday(registry: Registry, input: FoldInput): { state: WorldState; clock: number | null } {
  const out = new LedgerFold(registry, { fingerprint: FINGERPRINT }).fold(input);
  return { state: out.state, clock: out.messages.at(-1)?.clock ?? null };
}
