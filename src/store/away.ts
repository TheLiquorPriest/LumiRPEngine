// A long fold, handed to a worker thread (plan §4.1 l.199: "so one turn never stalls another"). A fold over more changes than
// `store.workerFoldAt`, or one with no state held on its path (a stored snapshot read whole, or the chat's start made), is not run
// where the caller stands when the caller can wait for a thread (`Store.afar`): the store throws
// `FoldAway` naming the fold, a thread opens the database to read, folds as the store does with the same packs and areas, and gives
// back the states it held and the snapshots it found worth storing, which the store takes as its own and then answers the read from
// memory. The store knows nothing of threads: the application gives it a `StoreAway` that runs a job somewhere.

import type { SnapshotRows } from "./snapshot";
import type { Folded } from "./types";

/** What a thread needs to fold as the store that sent it does: the database file, and every number the fold reads. */
export interface StoreBrief {
  /** The database file, which the thread opens to read. */
  path: string;
  /** The fingerprint the store was given, before its walks joined it; undefined: the packs' own. */
  fingerprint: string | undefined;
  snapshotEvery: number;
  statesPerChat: number;
  snapshotsHeld: number;
  kindChain: number | undefined;
  holderDepth: number | undefined;
  visitDepth: number | undefined;
}

/** A fold to run: the state at one stored node, or at the end of a path no node of which past `deepest` is stored (a question's, a swipe flipped). */
export type FoldJob =
  | { user: string; node: string }
  | { user: string; end: string; turn: string; nodes: readonly (readonly [key: string, prev: string | null, turn: string, depth: number])[] };

/** A state a thread held, to be held by the store: its key, the chat and mark it was folded under, and the newest change folded in. */
export interface AwayFold {
  key: string;
  chat: string | null;
  mark: string | null;
  folded: Folded;
  upto: number;
}

/** A snapshot a thread found worth storing: node, upto, rows, and the chat and mark it was folded under. */
export type AwayHeld = [node: string, upto: number, rows: SnapshotRows, chat: string, mark: string];

/** A handler's failure, as it crosses between threads: its words only. */
export interface AwayFailure {
  op: string;
  message: string;
  user: string;
  chat?: string;
  turn: string;
  change: number | null;
}

/** What a thread answers for one job. */
export interface FoldDone {
  folds: AwayFold[];
  held: AwayHeld[];
  failures: AwayFailure[];
  /** What the fold said for people (a walk cut short), to be said again where the store's log is. */
  logs: { message: string; data: Record<string, unknown> }[];
}

/** Where a long fold runs: the database file it reads, and a way to run a job there. */
export interface StoreAway {
  path: string;
  run(brief: StoreBrief, job: FoldJob): Promise<FoldDone>;
}

/** Thrown inside `Store.afar` where a fold is longer than the store runs inline: `afar` runs it away and asks again. */
export class FoldAway extends Error {
  constructor(readonly job: FoldJob) {
    super("a fold longer than the store runs here");
    this.name = "FoldAway";
  }
}
