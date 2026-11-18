// Build's jobs (DESIGN §9.6, §9.7; PlanChatUI-B2): where a job is started, kept, told, cancelled and dismissed, in the application's own table
// (`build_job`, `schema.ts`) instead of a file per user. A job is a kind's runner (`JobRunner`: Playtest and Check world in `lab.ts`, the model
// jobs of B5) given a world, its input and a signal; the home keeps what the runner reports (progress, a partial result) and what it ends
// with, tells every open page of each change, and reads a job it finds stored as running, that this process does not run, as interrupted
// (the extension stopped while it ran), with what it had proposed by then.

import type { Database } from "bun:sqlite";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../../app";
import type { UserId, WorldId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { JobKind, JobResult, JobSummary } from "../../shared/jobs";
import type { JobLimits } from "./limits";

/** A job request the home refuses: the code the route answers with and the words that name why. */
export class JobError extends Error {
  constructor(
    readonly code: "not_found" | "bad_request" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "JobError";
  }
}

/** What a running job is handed. */
export interface JobRun {
  id: string;
  user: UserId;
  world: WorldId;
  input: JsonObject;
  /** Aborted by a cancel: the runner stops where it is and answers nothing. */
  signal: AbortSignal;
  /** Tells how far it is (0..1), with the result so far where a restart should keep it, and a message. */
  report(progress: number, partial?: JobResult, message?: string): void;
}

/** One kind of job: what its input is kept as, and its work. */
export interface JobRunner {
  /** The input as it is kept and run: only what the kind reads, each value cut to its limit; a request the kind cannot take is refused with a `JobError`. */
  bound(input: JsonObject, limits: JobLimits): JsonObject;
  /** The work. Its answer is the job's result, and its message (a note on what was left out) is kept beside it; a throw fails the job with its words. */
  run(job: JobRun): Promise<{ result: JobResult; message?: string }>;
}

export interface JobHomeDeps {
  db: Database;
  writes: WriteQueue;
  log: Log;
  limits(): Promise<JobLimits>;
  runners: Partial<Record<JobKind, JobRunner>>;
  /** Told after each change of a job once it is kept. */
  told(user: UserId, job: JobSummary): void;
  now?: () => number;
}

interface Row {
  id: string;
  kind: string;
  world: string;
  status: string;
  progress: number;
  message: string | null;
  input: string;
  result: string | null;
  at: number;
}

const COLUMNS = "id, kind, world, status, progress, message, input, result, at";

function summaryOf(row: Row): JobSummary {
  return {
    jobId: row.id,
    kind: row.kind as JobKind,
    worldId: row.world,
    status: row.status as JobSummary["status"],
    progress: row.progress,
    ...(row.message === null ? {} : { message: row.message }),
    ...(row.result === null ? {} : { result: JSON.parse(row.result) as JobResult }),
    input: JSON.parse(row.input) as JsonObject,
    at: row.at,
  };
}

/** A job cut off by a stop or restart: what it says in Build. */
export function interruptedMessage(job: JobSummary): string {
  const proposals = job.result && "proposals" in job.result ? job.result.proposals.length : 0;
  return proposals > 0 ? `Interrupted by a restart. The ${proposals} proposal(s) it made before it stopped are below; run it again for the rest.` : "Interrupted by a restart. Run it again.";
}

export class JobHome {
  /** The jobs this process runs, by id. */
  private readonly running = new Map<string, AbortController>();
  /** The work of the jobs running; `idle()` waits for it. */
  private readonly work = new Set<Promise<void>>();
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: JobHomeDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Reads every job stored as running, which this process does not run, as interrupted (the extension stopped while it ran). */
  interruptStale(): Promise<void> {
    return this.deps.writes.run((db) => {
      const stale = (db.query(`SELECT user, ${COLUMNS} FROM build_job WHERE status = 'running'`).all() as (Row & { user: string })[]).filter((row) => !this.running.has(row.id));
      for (const row of stale) db.query("UPDATE build_job SET status = 'interrupted', message = ?, at = ? WHERE user = ? AND id = ?").run(interruptedMessage(summaryOf(row)), this.now(), row.user, row.id);
    }, "the jobs a stop cut off");
  }

  /** The user's kept jobs for a world, oldest first. */
  list(user: UserId, world: WorldId): JobSummary[] {
    return (this.deps.db.query(`SELECT ${COLUMNS} FROM build_job WHERE user = ? AND world = ? ORDER BY at, id`).all(user, world) as Row[]).map(summaryOf);
  }

  /** Starts a job of the user's: kept before it begins, run after. Returns its id. */
  async start(user: UserId, kind: JobKind, world: WorldId, input: JsonObject): Promise<string> {
    const runner = this.deps.runners[kind];
    if (!runner) throw new JobError("bad_request", "no such job");
    const limits = await this.deps.limits();
    if (world.length > limits.idChars) throw new JobError("bad_request", `an id is at most ${limits.idChars} characters`);
    const live = (this.deps.db.query("SELECT COUNT(*) AS n FROM build_job WHERE user = ? AND status = 'running'").get(user) as { n: number }).n;
    if (live >= limits.running) throw new JobError("unavailable", `at most ${limits.running} jobs run at once (Settings: build.jobs.atOnce); wait for one to finish or cancel it`);
    const bounded = runner.bound(input, limits);
    const id = `job${this.now().toString(36)}${(++this.seq).toString(36)}`;
    const controller = new AbortController();
    this.running.set(id, controller);
    await this.deps.writes.run((db) => db.query("INSERT INTO build_job (user, id, kind, world, status, progress, input, at) VALUES (?, ?, ?, ?, 'running', 0, ?, ?)").run(user, id, kind, world, JSON.stringify(bounded), this.now()), "a job started");
    await this.told(user, id);
    const job: JobRun = {
      id,
      user,
      world,
      input: bounded,
      signal: controller.signal,
      report: (progress, partial, message) => void this.change(user, id, { status: "running", progress: Math.max(0, Math.min(1, progress)), ...(partial === undefined ? {} : { result: partial }), ...(message === undefined ? {} : { message }) }),
    };
    const work = runner
      .run(job)
      .then(
        (done) => (controller.signal.aborted ? undefined : this.change(user, id, { status: "done", progress: 1, result: done.result, ...(done.message === undefined ? {} : { message: done.message }) })),
        (error: unknown) => {
          if (controller.signal.aborted) return undefined;
          const message = error instanceof Error ? error.message : String(error);
          // Told once, as it ends, as a turn's run or an RPH job that failed is: at warn, in the words Build shows.
          this.deps.log.warn(`A Build job ended failed: ${message}`, { job: id, kind, world });
          return this.change(user, id, { status: "failed", progress: 1, message });
        },
      )
      .then(() => undefined)
      .catch((error: unknown) => this.deps.log.warn(`[LumiRPEngine] a job's end was not kept (${error instanceof Error ? error.message : String(error)})`))
      .finally(() => {
        this.running.delete(id);
        this.work.delete(work);
      });
    this.work.add(work);
    return id;
  }

  /** Cancels the user's own running job; another user's job id is unknown to them. */
  async cancel(user: UserId, id: string): Promise<void> {
    const found = this.deps.db.query("SELECT status FROM build_job WHERE user = ? AND id = ?").get(user, id) as { status: string } | null;
    if (!found) throw new JobError("not_found", "no such job");
    if (found.status !== "running") throw new JobError("bad_request", "the job has ended already");
    this.running.get(id)?.abort();
    await this.change(user, id, { status: "cancelled", progress: 1 });
  }

  /** Removes the user's own job that has ended, with its result. */
  async dismiss(user: UserId, id: string): Promise<void> {
    const found = this.deps.db.query("SELECT status FROM build_job WHERE user = ? AND id = ?").get(user, id) as { status: string } | null;
    if (!found) throw new JobError("not_found", "no such job");
    if (found.status === "running") throw new JobError("bad_request", "the job is still running; cancel it first");
    await this.deps.writes.run((db) => db.query("DELETE FROM build_job WHERE user = ? AND id = ?").run(user, id), "a job dismissed");
  }

  /** Resolves once no job's work is pending (a job's own steps may still be waiting on a thread). */
  async idle(): Promise<void> {
    while (this.work.size > 0) await Promise.all([...this.work]);
  }

  /** Cancels what runs here, at close. */
  stop(): void {
    for (const controller of this.running.values()) controller.abort();
  }

  /**
   * Keeps a change of a job still running and tells it; an update after the job ended (a runner's last report behind a cancel) changes nothing.
   * An ended job's partial result stays only where it ended done or interrupted; the ended jobs past `build.jobs.kept` are dropped, the oldest first.
   */
  private async change(user: UserId, id: string, u: { status: JobSummary["status"]; progress: number; message?: string; result?: JobResult }): Promise<void> {
    const kept = (await this.deps.limits()).kept;
    const changed = await this.deps.writes.run((db) => {
      const row = db.query("SELECT status, result FROM build_job WHERE user = ? AND id = ?").get(user, id) as { status: string; result: string | null } | null;
      if (!row || row.status !== "running") return false;
      const result = u.result !== undefined ? JSON.stringify(u.result) : u.status === "running" ? row.result : null;
      db.query("UPDATE build_job SET status = ?, progress = ?, message = ?, result = ?, at = ? WHERE user = ? AND id = ?").run(u.status, u.progress, u.message ?? null, result, this.now(), user, id);
      if (u.status !== "running") db.query("DELETE FROM build_job WHERE user = ? AND status != 'running' AND id NOT IN (SELECT id FROM build_job WHERE user = ? AND status != 'running' ORDER BY at DESC, id DESC LIMIT ?)").run(user, user, kept);
      return true;
    }, "a job changed");
    if (changed) await this.told(user, id);
  }

  private async told(user: UserId, id: string): Promise<void> {
    const row = this.deps.db.query(`SELECT ${COLUMNS} FROM build_job WHERE user = ? AND id = ?`).get(user, id) as Row | null;
    if (row) this.deps.told(user, summaryOf(row));
  }
}
