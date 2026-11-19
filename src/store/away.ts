// A long fold, handed to a worker thread (plan §4.1 l.199: "so one turn never stalls another"). Wherever the application gives the store
// a thread (`StoreAway`: RPE's own store), a fold over more changes than `store.workerFoldAt` is refused on RPE's thread inside work that
// can be made again exactly once a thread has folded it (`barred`): a read of the store's (`Store.afar`, `Store.offThread`), a walk's
// item (`inStretches`), the preparing pass's stretch, a queued write (rolled back whole), a page's GET until it commits a write
// (`awayAgain`). There the store throws `FoldAway` naming the fold before it changes anything, a thread opens the database to read,
// folds as the store does with the same packs and areas, and gives back the states it held and the snapshots it found worth storing,
// which the store takes as its own (`Store.awayFor`); what threw is then made again and finds the state held. Where that does not serve
// (the same fold refused again, the thread's fold failed), and in all other work, the fold runs in place as it always did, and the log
// names what asked for it and how long it was, for a later pass to find. The store knows nothing of threads: the application gives it
// a `StoreAway` that runs a job somewhere.

import { AsyncLocalStorage } from "node:async_hooks";
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

/** What can run a refused fold on a thread: the store that refused it (`Store.awayFor`). */
export interface FoldsAway {
  awayFor(error: unknown): Promise<void> | null;
}

/**
 * Thrown where a fold is longer than the store runs on RPE's thread, before the fold changes anything, so what threw may be made again
 * once the thread has folded it (`away`: the store that refused it runs it there). Its words, for the log of one nothing could wait for,
 * say how long it was and the calls that asked for it, innermost first.
 */
export class FoldAway extends Error {
  constructor(
    readonly job: FoldJob,
    /** The changes it would run over; null for a fold `afar` hands over for having no state held on its path. */
    changes: number | null,
    private readonly by: FoldsAway,
  ) {
    super(changes === null ? "A fold with no state held on its path was asked for where it runs on a worker thread." : `A fold over ${changes} changes was asked for on RPE's thread, which runs none that long; it runs on a worker thread for whoever waits for it.`);
    this.name = "FoldAway";
    if (changes === null) return;
    this.message += ` Asked for by ${askersOf(this.stack)}.`;
  }

  /** The fold run on a thread by the store that refused it, its states held there once it is done. */
  away(): Promise<void> | null {
    return this.by.awayFor(this);
  }
}

/** The calls a stack names, innermost first, by name: what asked for a fold, which a bundled build keeps where it keeps no file of its own for each. */
export function askersOf(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .flatMap((line) => /^\s*at (?:async )?([\w$.#<>]+) \(/.exec(line)?.[1] ?? [])
    .slice(0, 10)
    .join(" ← ");
}

/** How many times running one asker may be refused the same fold, its thread's fold not serving it, before it gives up (`AwayAsked`). */
const AWAY_REPEATS = 2;

/** How many folds one asker may have run on a thread before it gives up, whatever they were (`AwayAsked`). */
const AWAY_MOST = 64;

/**
 * One asker's refused folds (`Store.afar`, `Store.offThread`, a walk): it asks again while each refusal names another fold (a walk goes
 * on from where it was refused, the states before held), and gives up once the same fold is refused `AWAY_REPEATS` times running (what
 * the thread held did not serve it) or `AWAY_MOST` were run.
 */
export class AwayAsked {
  private last = "";
  private same = 0;
  private all = 0;

  /** Whether to have `job` run on a thread and ask again. */
  again(job: FoldJob): boolean {
    const key = "node" in job ? job.node : job.end;
    this.same = key === this.last ? this.same + 1 : 0;
    this.last = key;
    this.all++;
    return this.same < AWAY_REPEATS && this.all <= AWAY_MOST;
  }
}

/** Work that may be made again (`awayAgain`), followed through every wait of it: whether the bar is on, and the work it runs inside. */
interface Asking {
  bar: boolean;
  up: Asking | undefined;
}

const asking = new AsyncLocalStorage<Asking>();

/** Synchronous work running with the bar on (`barred`), however deep. */
let barredNow = 0;

/** Whether a fold over the bar is refused here: inside barred work, synchronous or awaited, that has queued no write yet. */
export function barOn(): boolean {
  return barredNow > 0 || asking.getStore()?.bar === true;
}

/** Runs synchronous `read`, which may be made again exactly, with the bar on. */
export function barred<T>(read: () => T): T {
  barredNow++;
  try {
    return read();
  } finally {
    barredNow--;
  }
}

/** Runs `work` with the bar off, as every fold ran before the bar: where it cannot be made again, or making it again did not serve. */
export function inPlace<T>(work: () => T): T {
  const was = barredNow;
  barredNow = 0;
  try {
    return asking.run({ bar: false, up: asking.getStore() }, work);
  } finally {
    barredNow = was;
  }
}

/**
 * The work running now queued a write: the bar is off for it and the work around it, which made again would write it twice. Off from
 * the queueing, not the commit, so a write queued before a refusal and committed after it is never made again.
 */
export function writeQueued(): void {
  for (let at = asking.getStore(); at !== undefined; at = at.up) at.bar = false;
}

/**
 * Runs `work` outside the work it was started from: what RPE does in the background on its own account (the write queue's turns, a
 * write storing what reads held), which neither turns that work's bar off by its writes nor is refused under it.
 */
export function unasked<T>(work: () => T): T {
  return asking.exit(work);
}

/**
 * Runs `work` (a page's GET) with the bar on until it queues a write or returns: a fold it is refused runs on a thread, and the work is
 * made again, for as long as each refusal names another fold (`AwayAsked`); then, or where the thread's fold failed, it is made once
 * more with the bar off, its folds in place.
 */
export async function awayAgain<T>(work: () => Promise<T>): Promise<T> {
  const asked = new AwayAsked();
  for (;;) {
    const at: Asking = { bar: true, up: asking.getStore() };
    try {
      return await asking.run(at, work);
    } catch (error) {
      const away = error instanceof FoldAway && asked.again(error.job) ? error.away() : null;
      if (away === null) {
        if (error instanceof FoldAway) return await inPlace(work);
        throw error;
      }
      try {
        await away;
      } catch {
        return await inPlace(work);
      }
    } finally {
      // What it started and did not wait for goes on with the bar off: a refusal there would reach no one to make it again.
      at.bar = false;
    }
  }
}
