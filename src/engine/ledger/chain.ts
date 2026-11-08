// Inputs and outputs shared by both folds (types only; each fold has its own logic).

import type { MessageId, RevisionId } from "../../shared/ids";
import type { FoldLayerEntry } from "../../shared/layer";
import type { JournalNote, KeepLine, LedgerEvent, MessageFold, MessageLedger, PathHash, Pause, PostEntry, Tombstone } from "../../shared/ledger";
import type { WorldDoc } from "../../shared/world";
import type { Rejection } from "../registry";
import type { WorldState } from "../state";

/** One message of the current chain, with its effective ledger (the journal's, else metadata's). */
export interface ChainMessage {
  id: MessageId;
  isUser: boolean;
  swipeId: number;
  swipes: string[];
  ledger: MessageLedger | null;
}

export interface FoldInput {
  /** World documents by revision; the chat starts on `revision`, `migrate` markers switch it. */
  worlds: (revision: RevisionId) => WorldDoc | undefined;
  revision: RevisionId;
  chain: ChainMessage[];
  pauses: Pause[];
  tombstones: Tombstone[];
  /**
   * The chat's basis-anchored layer (DEPTH-PLAN §4.9), in landing order, its ancestors' first
   * (`foldLayerOf`): each live entry folds right after its basis message. Absent: none.
   */
  layer?: readonly FoldLayerEntry[];
  /** The chat's stored fold snapshots: a cold fold starts from the furthest one on its chain. The reference fold ignores them. */
  snapshots?: SnapshotStore;
  /**
   * The output's state may be the cache's own (a kept step's, a snapshot's) rather than a copy of
   * it, for a reader that only reads it (the GM view's parts, `LedgerCore.readState`): nothing may
   * change it. Absent, the output's state is always the fold's own.
   */
  share?: boolean;
  /**
   * A GM edit or ✎ fix worked out again from what it asked for (`PostEntry.edit`) against the state
   * it folds after (the chat's `LedgerEnv.resolveFix`): on a rebased view it folds as that, not as
   * stored (DESIGN §7, P2). Null for an entry that keeps nothing to work out.
   */
  resolveFix(world: WorldDoc, state: Readonly<WorldState>, entry: Pick<PostEntry, "edit" | "gm">): { events: LedgerEvent[] } | { rejection: Rejection } | null;
}

/**
 * The folded state after one chain position (DESIGN §4.3 fold snapshots), keyed by the fold
 * context and that position's path hash, so any edit, swipe or rebase before it misses. It
 * carries the state-dependent outputs up to it (dropped notes, dropped or converted Keep lines,
 * violations) by message index; everything else is recomputed from the chain without state.
 */
export interface FoldSnapshot {
  key: string;
  state: WorldState;
  notes: [number, JournalNote][];
  keep: [number, KeepLine][];
  violations: [number, string][];
  /** Each step's clock at its end (`MessageResult.clock`); absent in a snapshot saved before clocks were kept. */
  clocks?: [number, number][];
  /** Each step's worked-out GM edits and ✎ fixes (`FoldOutput.resolved`); absent in a snapshot saved before the folds kept them. */
  resolved?: [number, ResolvedFix][];
  /** Each step's layer drops (`FoldOutput.layerDrops`); absent in a snapshot saved before the layer. */
  layer?: [number, LayerDrop][];
}

export interface SnapshotStore {
  get(key: string): FoldSnapshot | undefined;
  put(snapshot: FoldSnapshot): void;
}

export interface MessageResult {
  id: MessageId;
  fold: MessageFold;
  /** The parent path of this message (the path of everything before it). */
  parentPath: PathHash;
  /** The path after this message. */
  path: PathHash;
  /** The world clock once this message folded, the end of its turn (what a reply shows under it); null for a step restored from a snapshot saved before clocks were kept. */
  clock: number | null;
  /** The layer entries that folded right after this message, by id, in landing order; absent when none. */
  layer?: string[];
}

/**
 * A GM edit or ✎ fix a rebased view worked out again from its request (DESIGN §7, P2): what it
 * applied there, none when all it asked was already so there. One that couldn't be made is a drop
 * note instead.
 */
export interface ResolvedFix {
  messageId: MessageId;
  seq: number;
  events: LedgerEvent[];
}

/** A unit of a layer entry a rebased view dropped (DEPTH-PLAN §4.9): it no longer fits the state its basis folds to. */
export interface LayerDrop {
  messageId: MessageId;
  entry: string;
  /** The event's index in the entry. */
  index: number;
  text: string;
}

export interface FoldOutput {
  state: WorldState;
  notes: JournalNote[];
  keepReport: KeepLine[];
  messages: MessageResult[];
  /** What each GM edit or ✎ fix a rebased view worked out again applied there, so its chip and Journal line say that, not what it stored. */
  resolved: ResolvedFix[];
  /** L7: an on-path event or entry that failed validation when re-folded. Always empty when the ledger is correct. */
  violations: string[];
  /** Layer entry units dropped on a rebased view. */
  layerDrops: LayerDrop[];
}

export class FoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoldError";
  }
}
