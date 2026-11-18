// Build's jobs on RPE's own typed routes (plan §4.4, §14; PlanChatUI-B2): start one, list a world's, cancel a running one, dismiss an ended one.
// Every job is the user's own; another user's id is not found. A page hears each change of a job on its live channel (`area.ts`), not by asking.

import { route, RouteError, shape } from "../../app";
import type { JobKind, JobSummary } from "../../shared/jobs";
import type { JsonObject } from "../../shared/json";
import { JobError, type JobHome } from "./home";

const T = shape.text();
const field = shape.field;
const opt = shape.optional;

export const JOBS_PATH = "/api/v1/build/jobs";

/** The kinds of job Build knows: the runners of the ones it has now are the home's. */
export const JOB_KIND_NAMES = ["import_lore", "refine", "describe_map", "propose_routines", "playtest", "check_world", "index_text"] as const satisfies readonly JobKind[];

const STATUS = { not_found: 404, bad_request: 400, unavailable: 503 } as const;

async function guarded<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof JobError) throw new RouteError(STATUS[error.code], error.message);
    throw error;
  }
}

const jobKind = shape.oneOf(...JOB_KIND_NAMES);
const jobStatus = shape.oneOf("running", "done", "failed", "cancelled", "interrupted");

export const buildJob = shape.named(
  "BuildJob",
  "A job Build ran or runs: its id, its kind, its world, where it stands, how far it is, the words it ended with, its result so far or at the end, the input it was given and when it last changed.",
  shape.object({
    jobId: field(T, "The job's id."),
    kind: field(jobKind, "What the job does."),
    worldId: field(T, "The world it works on."),
    status: field(jobStatus, "Where it stands; interrupted is a job that was running when RPE stopped."),
    progress: field(shape.number({ least: 0, most: 1 }), "How far it is, 0 to 1."),
    message: opt(T, "What it says: why it failed, or what it left out."),
    result: opt(shape.json(), "What it found: proposals to review, or a Playtest's turns with the lint."),
    input: field(shape.json(), "The input it was given, as kept."),
    at: field(shape.whole(), "Epoch ms of its last change."),
  }),
);

export function jobsRoutes(home: JobHome) {
  return [
    route({
      method: "GET",
      path: JOBS_PATH,
      access: "page",
      group: "worlds",
      does: "The user's jobs for a world, oldest first, each with its status, progress and result.",
      query: { world: field(T, "The world whose jobs are listed.") },
      reply: shape.object({ jobs: shape.list(buildJob) }),
      handle: ({ query, user }) => ({ jobs: home.list(user, query.world) as never }),
    }),
    route({
      method: "POST",
      path: JOBS_PATH,
      access: "page",
      group: "worlds",
      does: "Starts a job on a world: its progress and result are told on the user's live channel as it goes, and kept. Refused where as many jobs run as `build.jobs.atOnce` allows.",
      body: shape.object({ world: field(T, "The world to work on."), kind: field(jobKind, "What the job does."), input: field(shape.json(), "The input the kind reads: a Playtest's typed turns, a Check world's days, a model job's request.") }),
      reply: shape.object({ job: field(T, "The id of the job started.") }),
      handle: ({ body, user }) => guarded(async () => ({ job: await home.start(user, body.kind as JobKind, body.world, (body.input !== null && typeof body.input === "object" && !Array.isArray(body.input) ? body.input : {}) as JsonObject) })),
    }),
    route({
      method: "POST",
      path: `${JOBS_PATH}/:job/cancel`,
      access: "page",
      group: "worlds",
      does: "Cancels the user's own running job.",
      reply: shape.object({ cancelled: field(shape.yesNo(), "The job is cancelled.") }),
      handle: ({ params, user }) => guarded(async () => (await home.cancel(user, params.job), { cancelled: true })),
    }),
    route({
      method: "DELETE",
      path: `${JOBS_PATH}/:job`,
      access: "page",
      group: "worlds",
      does: "Removes the user's own job that has ended, with its result.",
      reply: shape.nothing(),
      handle: ({ params, user }) => guarded(async () => void (await home.dismiss(user, params.job))),
    }),
  ];
}

export type { JobSummary };
