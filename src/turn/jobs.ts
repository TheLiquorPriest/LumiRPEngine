// The jobs RPH runs, as RPE keeps what it is told of them (plan §13.5, `TurnEvents.job`): each job's
// latest view, with its chat and the turn that started it. A job's end is recorded by the store
// (`endJob`) in the same write, so what the job recorded takes effect just before the first turn to
// begin after it (plan §10.9); that turn is told how the job ended, and the store's record of when it
// ended places both alike.

import type { Database } from "bun:sqlite";
import type { JobView } from "rp-harness/contract";

/** A job that has ended: its view as RPH last told it, and when the store recorded its end. */
export interface EndedJob {
  view: JobView;
  ended: number;
}

/** Keeps a job's view as RPH tells it, over the one kept before. */
export function keepJob(db: Database, view: JobView): void {
  db.run("INSERT INTO turn_job (user, job, chat, turn, view) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, job) DO UPDATE SET view = excluded.view", [view.scope.user, view.id, view.scope.chat, view.scope.turn ?? null, JSON.stringify(view)]);
}

/** The chat's jobs whose end the store recorded at or after `from` and before `to`, the earliest end first. */
export function jobsEndedBetween(db: Database, user: string, chat: string, from: number, to: number): EndedJob[] {
  return db
    .query<{ view: string; ended: number }, [string, string, number, number]>(
      "SELECT j.view, e.ended FROM turn_job j JOIN job_end e ON e.user = j.user AND e.job = j.job WHERE j.user = ? AND j.chat = ? AND e.ended >= ? AND e.ended < ? ORDER BY e.ended, j.job",
    )
    .all(user, chat, from, to)
    .map((r) => ({ view: JSON.parse(r.view) as JobView, ended: r.ended }));
}
