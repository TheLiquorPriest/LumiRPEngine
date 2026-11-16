// What the Jobs page and the Prompt page's "Map again" read of RPE that the route table does not hold yet (see ./index.ts); asked of O7TurnJobs
// (TurnKinds-5, the start of a job, and TurnKinds-31, the job routes, `src/turn/job-routes.ts`). The list route `GET /api/v1/jobs` is in the table,
// unpaged; it is to become paged (`{chat?, state?, limit?, cursor?}` -> `{items, next}`), and the chat's own list route goes (`?chat=`): the page
// moves to that when it lands. A job's own route is long: over TCP it answers 202 `{answer}`, which the client follows.

import type { RunUsage, WindowGauge } from "rp-harness/contract";
import type { AgentRef, JobLimits, JobView, JsonValue, TraceRecord } from "../../shared/api";
import type { WantedRoute } from "./index";

export interface JobStartAsk {
  /** The agent definition the job runs. */
  definition: string;
  brief: string;
  /** Attachments by name. */
  given?: string[];
  /** Limits of its own; each holds only where tighter than `jobs.run.*`. */
  limits?: JobLimits;
}

export interface JobOne {
  job: JobView;
}

/** A job with the records of its run, what the run spent, and each agent's window gauge, for the trace view. */
export interface JobWithTrace {
  job: JobView;
  trace: TraceRecord[];
  usage: RunUsage | null;
  windows: { agent: AgentRef; gauge: WindowGauge }[];
}

/** The switches over all jobs and the limits in force, with today's use of those that count one. */
export interface JobSwitches {
  /** Jobs are switched off: none starts, by an agent's call or from the page; those waiting keep waiting. */
  off: boolean;
  /** Jobs are held: those running are held at their agents' next call and none starts, until he lets them go. */
  held: boolean;
  limits: { key: string; value: JsonValue; used: number | null }[];
}

/** His answer to a job that asks whether to go on: go on (from a new ask point where he gives one), or end it with what it has. */
export type JobAnswerAsk = { go: "on"; askAt?: number } | { go: "end" };

type NoQuery = Record<string, never>;
type JobParams = { job: string };

/** The Jobs page's routes. */
export interface JobRoutes {
  /** Starts a job as his own, tied to no turn; it starts or waits by `jobs.atOnce`. */
  "POST /api/v1/chats/:chat/jobs": WantedRoute<{ chat: string }, NoQuery, JobStartAsk, JobOne>;
  "GET /api/v1/jobs/:job": WantedRoute<JobParams, NoQuery, undefined, JobWithTrace>;
  /** Starts again a job that was interrupted, failed or cancelled, with the same task. */
  "POST /api/v1/jobs/:job/restart": WantedRoute<JobParams, NoQuery, undefined, JobOne>;
  /** Carries on a job that stopped at one of its limits, with more. */
  "POST /api/v1/jobs/:job/continue": WantedRoute<JobParams, NoQuery, { limits?: JobLimits }, JobOne>;
  "POST /api/v1/jobs/:job/hold": WantedRoute<JobParams, NoQuery, undefined, JobOne>;
  /** Lets go a held waiting job or a paused running one. */
  "POST /api/v1/jobs/:job/release": WantedRoute<JobParams, NoQuery, undefined, JobOne>;
  "POST /api/v1/jobs/:job/resume": WantedRoute<JobParams, NoQuery, undefined, JobOne>;
  "POST /api/v1/jobs/:job/pause": WantedRoute<JobParams, NoQuery, undefined, JobOne>;
  /** A word to a running job's lead, received at its next call and marked as his. */
  "POST /api/v1/jobs/:job/word": WantedRoute<JobParams, NoQuery, { text: string }, JobOne>;
  /** His answer to a job that asks. */
  "POST /api/v1/jobs/:job/answer": WantedRoute<JobParams, NoQuery, JobAnswerAsk, JobOne>;
  "GET /api/v1/jobs/switches": WantedRoute<Record<string, never>, NoQuery, undefined, JobSwitches>;
  "POST /api/v1/jobs/switches": WantedRoute<Record<string, never>, NoQuery, { off?: boolean; held?: boolean }, JobSwitches>;
}
