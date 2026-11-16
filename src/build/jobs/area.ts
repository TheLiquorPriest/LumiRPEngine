// Build's jobs mounted in the application (plan §4.1, §14; PlanChatUI-B2): the jobs' settings, the live kind that tells every open page of a change to
// a job, and the job home with its routes. Build's area (`../area.ts`) lists the settings and calls `mountJobs` once the turn lane has made the store.

import type { App } from "../../app";
import { LIVE_USER, liveKind, shape } from "../../app";
import { diskTexts, readConfig } from "../../app/config-read";
import type { Store } from "../../store";
import type { JobKind } from "../../shared/protocol";
import type { WorldService } from "../../worlds/service";
import { JobHome, type JobRunner } from "./home";
import { labRunners } from "./lab";
import { JOB_SETTING_DEFS, JOB_SETTINGS, type JobLimits } from "./limits";
import { jobsRoutes } from "./routes";

const T = shape.text();

/** A change to one of the user's jobs, told to every page: the job as it stands. */
export const JOB_KIND = liveKind("build_job", {
  data: shape.named(
    "BuildJobChanged",
    "A job of Build changed once it is kept: its id, kind, world, status, how far it is, the words it carries, and its result (what it found so far, or at the end).",
    shape.object({
      jobId: shape.field(T, "The job's id."),
      kind: shape.field(T, "What the job does."),
      worldId: shape.field(T, "The world it works on."),
      status: shape.field(shape.oneOf("running", "done", "failed", "cancelled", "interrupted"), "Where it stands."),
      progress: shape.field(shape.number({ least: 0, most: 1 }), "How far it is, 0 to 1."),
      message: shape.optional(T, "What it says."),
      result: shape.optional(shape.json(), "What it found."),
    }),
  ),
  does: "A job of his changed: the page shows its progress or its result.",
});

/** The limits `build.*` give now, read from the global level's file at each use. */
export async function jobLimitsOf(app: Pick<App, "paths" | "log">): Promise<JobLimits> {
  const file = app.paths.globalConfig;
  return readConfig(await diskTexts([{ level: "global", file, disk: file }]), app.log, JOB_SETTINGS).numbers(JOB_SETTING_DEFS);
}

/** What the jobs take from the composition. */
export interface JobTakes {
  store: Store;
  worlds: WorldService;
  /** The runners of the model kinds (B5), by kind. */
  more?: Partial<Record<JobKind, JobRunner>>;
}

/** Mounts the job home: the stored jobs a stop cut off are read as interrupted, and its routes are added. */
export async function mountJobs(at: App, takes: JobTakes): Promise<JobHome> {
  const home = new JobHome({
    db: at.db,
    writes: at.writes,
    log: at.log,
    limits: () => jobLimitsOf(at),
    runners: { ...labRunners({ worlds: takes.worlds, store: takes.store, workers: at.workers }), ...takes.more },
    told: (_user, job) => {
      const { jobId, kind, worldId, status, progress, message, result } = job;
      JOB_KIND.publish(at.live, LIVE_USER, { jobId, kind, worldId, status, progress, ...(message === undefined ? {} : { message }), ...(result === undefined ? {} : { result: result as never }) });
    },
  });
  await home.interruptStale();
  at.routes.add("worlds", jobsRoutes(home));
  return home;
}
