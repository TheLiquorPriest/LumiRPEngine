// A long fold, handed to a worker thread (plan §4.1 l.199: "so one turn never stalls another"). Wherever the application gives the store
// a thread (`StoreAway`: RPE's own store), a fold over more changes than `store.workerFoldAt` is never run on RPE's thread, whoever asks
// for it: the store throws `FoldAway` naming the fold before it changes anything, a thread opens the database to read, folds as the
// store does with the same packs and areas, and gives back the states it held and the snapshots it found worth storing, which the store
// takes as its own (`Store.awayFor`); what threw is then made again and finds the state held. Whoever may wait for it does so
// (`Store.afar`, `Store.offThread`, the write queue, the server's routes); `afar` also hands over a fold with no state held on its path.
// The store knows nothing of threads: the application gives it a `StoreAway` that runs a job somewhere.

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

/**
 * Thrown where a fold is longer than the store runs on RPE's thread (`Store.awayFor` runs it on a thread), before the fold changes
 * anything, so what threw may be made again once the thread has folded it. Its words, for the log of one nothing could wait for, say
 * how long it was and the calls that asked for it, innermost first.
 */
export class FoldAway extends Error {
  constructor(
    readonly job: FoldJob,
    /** The changes it would run over; null for a fold `afar` hands over for having no state held on its path. */
    changes: number | null,
  ) {
    super(changes === null ? "A fold with no state held on its path was asked for where it runs on a worker thread." : `A fold over ${changes} changes was asked for on RPE's thread, which runs none that long; it runs on a worker thread for whoever waits for it.`);
    this.name = "FoldAway";
    if (changes === null) return;
    // The calls by name, which a bundled build keeps where it keeps no file of its own for each.
    const calls = (this.stack ?? "").split("\n").flatMap((line) => /^\s*at (?:async )?([\w$.#<>]+) \(/.exec(line)?.[1] ?? []);
    this.message += ` Asked for by ${calls.slice(0, 10).join(" ← ")}.`;
  }
}
