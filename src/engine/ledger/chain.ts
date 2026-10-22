// Inputs and outputs shared by both folds (types only; each fold has its own logic).

import type { MessageId, RevisionId } from "../../shared/ids";
import type { JournalNote, KeepLine, MessageFold, MessageLedger, PathHash, Pause, Tombstone } from "../../shared/ledger";
import type { WorldDoc } from "../../shared/world";
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
  /** The chat's stored fold snapshots: a cold fold starts from the furthest one on its chain. The reference fold ignores them. */
  snapshots?: SnapshotStore;
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
}

export interface FoldOutput {
  state: WorldState;
  notes: JournalNote[];
  keepReport: KeepLine[];
  messages: MessageResult[];
  /** L7: an on-path event or entry that failed validation when re-folded. Always empty when the ledger is correct. */
  violations: string[];
}

export class FoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoldError";
  }
}
