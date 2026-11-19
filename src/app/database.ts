// RPE's database (plan §4.1, §4.5): one SQLite file in write-ahead-log mode, on bun:sqlite, and the
// single queue every write goes through. SQLite takes one writer at a time; agents and pages run at
// once, so their writes are queued in this process and each runs alone, in a short transaction of
// its own, in the order it was asked for. Reads never wait for the queue: they read the connection
// directly, and the log lets them see the last committed state while a write is under way.
//
// Outside a queued write the connection takes no writes at all (SQLite's `query_only`), so a write
// made around the queue fails where it is made rather than colliding with one made through it.

import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { barred, FoldAway, inPlace, unasked, writeQueued } from "../store/away";
import { OWNER_ONLY_FILE } from "./disk";

/** Opens the database file, making it when there is none, for one writer and many readers. */
export function openDatabase(file: string, busyMs: number): Database {
  const db = new Database(file, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`PRAGMA busy_timeout = ${Math.floor(busyMs)}`);
  // With the log, NORMAL loses at most the last commits to a power cut, never the file's integrity.
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") chmodSync(file, OWNER_ONLY_FILE);
  return db;
}

/** A write that returned a promise: it must finish inside its transaction, so it was undone. */
export class WriteWaited extends Error {
  override name = "WriteWaited";
}

/** The queue stopped taking writes because RPE is stopping. */
export class WritesClosed extends Error {
  override name = "WritesClosed";
}

/** How many times a write is run again after a fold too long for RPE's thread was made on a worker thread for it. */
const WRITE_TRIES = 3;

interface Job {
  write: (db: Database) => unknown;
  label: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  /** How many times it was run again after a fold of it was made on a worker thread. */
  tries: number;
  /** Whether it runs with its folds in place, the bar off (`inPlace`): the worker's fold did not serve it, or failed. */
  inPlace: boolean;
}

/**
 * The one way to write to the database. `run` queues a write: it runs after every write queued
 * before it, alone, inside its own transaction, and resolves with what it returned once committed.
 * A write must not wait for anything: one that returns a promise is rolled back and refused. A write
 * that throws is rolled back and rejects; the writes around it are not touched. Writes run back to
 * back for at most `sliceMs` before other work is let in. A write runs with the store's bar on
 * (`barred`): one refused a fold too long for RPE's thread (`FoldAway`) is rolled back whole, the
 * queue waits, every write after it waiting too, while a worker thread folds it, and then runs it
 * again; after `WRITE_TRIES`, or where the worker's fold failed, it runs once more with its folds in
 * place, as every write did before the bar. So a write that can be refused must change nothing outside
 * the database before it is, or put right what it changed.
 */
export class WriteQueue {
  private jobs: (Job | undefined)[] = [];
  private head = 0;
  private draining = false;
  private closed = false;
  private idle: PromiseWithResolvers<void> | null = null;
  /** Whether the queue waits for a worker thread's fold that the write at its head needs (`hold`). */
  private holding = false;

  constructor(
    private readonly db: Database,
    private readonly sliceMs: number,
  ) {
    db.run("PRAGMA query_only = ON");
  }

  /** Writes waiting to run. */
  get waiting(): number {
    return this.jobs.length - this.head;
  }

  run<T>(write: (db: Database) => T, label = "a write"): Promise<T> {
    if (this.closed) return Promise.reject(new WritesClosed(`RPE is stopping, so ${label} was not made.`));
    // The work that queues it is not made again after a worker's fold (`awayAgain`): it would queue it twice.
    writeQueued();
    const done = Promise.withResolvers<T>();
    this.jobs.push({ write, label, resolve: done.resolve as (value: unknown) => void, reject: done.reject, tries: 0, inPlace: false });
    if (!this.draining) {
      this.draining = true;
      // The queue's turns are its own, outside whatever work queued the first write (`unasked`).
      queueMicrotask(() => unasked(() => this.drain()));
    }
    return done.promise;
  }

  /** Resolves once every write queued so far has run. */
  settled(): Promise<void> {
    if (!this.draining) return Promise.resolve();
    this.idle ??= Promise.withResolvers<void>();
    return this.idle.promise;
  }

  /** Takes no more writes, and resolves once those queued have run. */
  close(): Promise<void> {
    this.closed = true;
    return this.settled();
  }

  private drain(): void {
    const started = performance.now();
    while (this.head < this.jobs.length) {
      const job = this.jobs[this.head];
      this.jobs[this.head] = undefined;
      this.head++;
      if (job !== undefined) this.one(job);
      // The write at the head waits for work off the thread (`hold`), and the queue drains again once it is done.
      if (this.holding) return;
      if (this.head < this.jobs.length && performance.now() - started >= this.sliceMs) {
        setImmediate(() => this.drain());
        return;
      }
    }
    this.jobs = [];
    this.head = 0;
    this.draining = false;
    const idle = this.idle;
    this.idle = null;
    idle?.resolve();
  }

  private one(job: Job): void {
    let result: unknown;
    this.db.run("PRAGMA query_only = OFF");
    try {
      this.db.run("BEGIN IMMEDIATE");
      try {
        // With the bar on, a fold too long for RPE's thread is refused; once that did not serve, the write folds in place.
        result = job.inPlace ? inPlace(() => job.write(this.db)) : barred(() => job.write(this.db));
        if (typeof (result as PromiseLike<unknown> | null)?.then === "function") {
          // What it does after its first wait would land outside the transaction, where nothing may write.
          Promise.resolve(result).catch(() => undefined);
          throw new WriteWaited(`${job.label} waited for something inside its transaction, so it was undone: a write must finish without waiting.`);
        }
        this.db.run("COMMIT");
      } catch (error) {
        if (this.db.inTransaction) this.db.run("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if (!(error instanceof FoldAway)) job.reject(error);
      else if (job.tries < WRITE_TRIES) this.hold(job, error.away());
      else this.again(job);
      return;
    } finally {
      this.db.run("PRAGMA query_only = ON");
    }
    job.resolve(result);
  }

  /** Puts `job` back at the head, to run next with its folds in place (`inPlace`): the worker's fold did not serve it, or failed. */
  private again(job: Job): void {
    job.inPlace = true;
    this.head--;
    this.jobs[this.head] = job;
  }

  /**
   * Runs `job` again, before every write queued after it, once a worker thread has folded what it was refused (`away`); until then no
   * write runs, so the database the worker reads is the one the write runs on again. Where the worker's fold failed, or none could be
   * asked for, it runs again with its folds in place.
   */
  private hold(job: Job, away: Promise<void> | null): void {
    job.tries++;
    if (away === null) {
      this.again(job);
      return;
    }
    this.head--;
    this.jobs[this.head] = job;
    this.holding = true;
    away
      .catch(() => {
        job.inPlace = true;
      })
      .finally(() => {
        this.holding = false;
        this.drain();
      });
  }
}
