// How a job stands, in words, and what Cancel can do about it.

import type { JobState, JobView } from "../../../shared/api";
import type { Tone } from "../../atoms";

/** How a job stands, as a badge says it. */
export const JOB_STATE_WORDS: Readonly<Record<JobState, { words: string; tone?: Tone }>> = {
  queued: { words: "queued", tone: "accent" },
  held: { words: "held", tone: "warn" },
  running: { words: "running", tone: "accent" },
  asking: { words: "asking whether to go on", tone: "accent" },
  done: { words: "done", tone: "pos" },
  failed: { words: "failed", tone: "neg" },
  cancelled: { words: "cancelled", tone: "warn" },
  "off-path": { words: "off the path", tone: "warn" },
  interrupted: { words: "interrupted", tone: "warn" },
};

/** Whether a Cancel can do anything: the job has not ended (waiting, held, running, or asking). */
export function cancellable(job: JobView): boolean {
  return job.state === "queued" || job.state === "held" || job.state === "running" || job.state === "asking";
}
