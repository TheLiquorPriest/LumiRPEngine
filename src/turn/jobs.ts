// The jobs RPH runs, as RPE keeps its one record of each (plan §13.5, Appendix B `job`): RPH's own record
// (its view, kept through the store port's typed part, `kv.ts`), with its chat, the turn that started it
// (none for his own) and when the store recorded its end (`endJob`, in the same write as RPH's word that
// it ended), so what the job recorded takes effect just before the first turn to begin after it (plan
// §10.9); that turn is told how the job ended, and the store's record of when it ended places both alike.

import type { Database } from "bun:sqlite";
import type { JobState, JobView } from "rp-harness/contract";
import { jobView, liveKind, shape } from "../app";
import { placeIn, placeOf } from "./kv";

/** A job's change of state (started, held, paused, carried on, ended, stopped at a limit), told to every page that follows his jobs (`LIVE_JOBS`), in every chat. */
export const JOB_KIND = liveKind("job", { data: shape.object({ job: jobView }), does: "One of his jobs changed: the job as RPH keeps it now." });

/** A job that has ended: its view as RPH last kept it, and when the store recorded its end. */
export interface EndedJob {
  view: JobView;
  ended: number;
}

/** A job the earlier build ran, as the migration carries it into RPE's job history: its chat, the turn of RPE it belonged to (null: none), its agent and whole task, how it ended, who started it, when, what it spent as that build counted it, and its report and transcript. */
export interface CarriedJob {
  id: string;
  chat: string;
  turn: string | null;
  agent: string;
  brief: string;
  state: "ended" | "failed" | "cancelled";
  startedBy: "user" | { agent: string; role: string };
  started: number;
  ended: number;
  usage: { tokensIn: number; tokensOut: number; calls?: number };
  report: string | null;
  transcript: string | null;
}

/** How a carried job ended, as RPH's states say it. */
const CARRIED_STATES: Readonly<Record<CarriedJob["state"], JobState>> = { ended: "done", failed: "failed", cancelled: "cancelled" };

/**
 * Writes one job the migration carried as a row of the job table: a record the Jobs page lists, marked `carried`, with its transcript
 * beside its report, its turn kept where it belonged to one. Its end is not recorded as the store's (`ended` stays empty): it recorded
 * nothing in RPE, so no turn is told of it and nothing of it is placed. A job already there is left as it is.
 */
export function carryJob(into: Database, user: string, job: CarriedJob): void {
  const view: JobView & { carried: true; transcript?: string } = {
    id: job.id,
    agent: job.agent,
    brief: job.brief,
    state: CARRIED_STATES[job.state],
    scope: { user, chat: job.chat, session: "carried", ...(job.turn !== null ? { turn: job.turn } : {}) },
    startedBy: job.startedBy === "user" ? "user" : { id: job.startedBy.agent, definition: job.startedBy.role },
    started: job.started,
    ended: job.ended,
    usage: { calls: job.usage.calls ?? 0, input: job.usage.tokensIn, cacheRead: 0, cacheWrite: 0, output: job.usage.tokensOut },
    ...(job.report !== null ? { report: job.report } : {}),
    carried: true,
    ...(job.transcript !== null ? { transcript: job.transcript } : {}),
  };
  into.run("INSERT INTO job (user, id, started, chat, turn, state, value) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, id) DO NOTHING", [user, view.id, view.started, job.chat, job.turn, view.state, JSON.stringify(view)]);
}

/** The chat's jobs whose end the store recorded at or after `from` and before `to`, the earliest end first. */
export function jobsEndedBetween(db: Database, user: string, chat: string, from: number, to: number): EndedJob[] {
  return db
    .query<{ value: string; ended: number }, [string, string, number, number]>(
      "SELECT value, ended FROM job WHERE user = ? AND chat = ? AND value IS NOT NULL AND ended >= ? AND ended < ? ORDER BY ended, id",
    )
    .all(user, chat, from, to)
    .map((r) => ({ view: JSON.parse(r.value) as JobView, ended: r.ended }));
}

/**
 * A page of the user's jobs among `ids` (one chat's bootstrap jobs), the newest started first, read from the one record in one query:
 * at most `limit` from after the place `after` names (a page's `next`, `<started>~<id>`), and the place of its last when more follow.
 */
export function jobsAmong(db: Database, user: string, ids: readonly string[], limit: number, after?: string): { jobs: JobView[]; next: string | null } {
  const from = after === undefined ? null : placeIn(after);
  const rows = db
    .query<{ value: string }, (string | number)[]>(
      `SELECT value FROM job WHERE user = ? AND value IS NOT NULL AND id IN (SELECT value FROM json_each(?))${from === null ? "" : " AND (started < ? OR (started = ? AND id < ?))"} ORDER BY started DESC, id DESC LIMIT ?`,
    )
    .all(user, JSON.stringify(ids), ...(from === null ? [] : [from.started, from.started, from.id]), limit + 1)
    .map((r) => JSON.parse(r.value) as JobView);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { jobs: page, next: rows.length > limit && last !== undefined ? placeOf(last) : null };
}
