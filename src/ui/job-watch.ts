// Following one job a page started (plan §13.5): how it stands, what its run has spent so far, and how it ended, as the pages already hear of
// jobs. A job's own words come on `~jobs`, each with the job's row (as the Jobs page reads them); its run's records come on the chat's stream,
// or on `~jobs` for a job of no chat (as the Live page reads them), folded by the live model; and the job is read once from its route (as the
// Jobs page reads it) at the start, after a hole or a lost word, and when it ends failed, so that what a failed job's last call said is
// known. Nothing polls.

import { type JobRow, type JobState, type JobView, LIVE_JOBS, type LiveEvent, type Usage } from "../shared/api";
import type { RpeClient } from "./client";
import { applyRecord, EMPTY_LIVE, holeIn, type LiveModel, readTrace, type RunNode, runOf, runTotals } from "./live-model";
import { errorWords } from "./words";

/** The job a page started: its id, the chat it was started in (null: none), and the job as RPE answered the start where the page has it. */
export interface JobRef {
  id: string;
  chat: string | null;
  view?: JobView;
}

/** What a page knows of a job it started, as it goes. */
export interface JobWatched {
  /** The job as the page last heard of it, by its row (or whole, as read or as the start answered); null until RPE's word of it is in. */
  job: JobRow | null;
  /** What its run has spent so far, and in all once it ended; null before anything says. */
  spent: Usage | null;
  /** For a job that failed: what its last model call said went wrong, where its records say. */
  error: string | null;
  /** Why the job could not be read, in RPE's words. */
  problem: string | null;
}

const ENDED: readonly JobState[] = ["done", "failed", "cancelled", "interrupted", "off-path"];

/** Whether a job in this state has ended: it will not run again unless he starts it again. */
export function jobEnded(state: JobState): boolean {
  return ENDED.includes(state);
}

/** What the last model call that failed in a run said, if any did. */
function lastCallError(run: RunNode): string | null {
  let said: string | null = null;
  for (const agent of run.agents.values()) for (const step of agent.steps) if (step.kind === "call" && step.answer?.error !== undefined) said = step.answer.error;
  return said;
}

/** Follows `ref` until the returned function is called; `onChange` is told at once and at every word of the job. */
export function watchJob(client: RpeClient, ref: JobRef, onChange: (watched: JobWatched) => void): () => void {
  let model: LiveModel = EMPTY_LIVE;
  let job: JobRow | null = ref.view ?? null;
  let problem: string | null = null;
  let alive = true;
  let reading = false;
  let readAgain = false;

  const tell = (): void => {
    if (!alive) return;
    const run = runOf(model, ref.id);
    const ended = job !== null && jobEnded(job.state);
    const spent = job !== null && ended ? job.usage : run === undefined ? null : runTotals(run).usage;
    onChange({ job, spent, error: job?.state === "failed" && run !== undefined ? lastCallError(run) : null, problem });
  };

  async function read(): Promise<void> {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      const got = await client.call("GET /api/v1/jobs/:job", { job: ref.id });
      if (alive) {
        job = got.job;
        for (const record of got.trace) model = applyRecord(model, record);
        problem = null;
      }
    } catch (error) {
      problem = errorWords(error);
    } finally {
      reading = false;
    }
    if (!alive) return;
    tell();
    if (readAgain) {
      readAgain = false;
      void read();
    }
  }

  const events = (batch: readonly LiveEvent[], missed: unknown): void => {
    let wordOfJob = false;
    for (const event of batch) {
      if (event.kind === "job") {
        if (event.data.job.id !== ref.id) continue;
        job = event.data.job;
        wordOfJob = true;
      } else if (event.kind === "trace") {
        const record = readTrace(event.data);
        if (record !== null && record.run === ref.id) model = applyRecord(model, record);
      }
    }
    tell();
    const run = runOf(model, ref.id);
    // A word lost on the way, a hole in its records, or a job that failed (its last call's words are in its records): read it.
    if (missed !== null || (run !== undefined && holeIn(run) !== null) || (wordOfJob && job?.state === "failed")) void read();
  };
  const listener = { events, reset: () => void read(), refused: () => undefined };
  const to = ref.chat ?? LIVE_JOBS;
  const stops = [client.follow(to, listener), ...(to === LIVE_JOBS ? [] : [client.follow(LIVE_JOBS, listener)])];

  tell();
  void read();
  return () => {
    alive = false;
    for (const stop of stops) stop();
  };
}
