// How a job stands, in words, who ended it, and what Cancel can do about it.

import type { JobRefusal, JobState, JobStopper, JobView } from "../../../shared/api";
import type { Tone } from "../../../frontend/components";

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
export function cancellable(job: Pick<JobView, "state">): boolean {
  return job.state === "queued" || job.state === "held" || job.state === "running" || job.state === "asking";
}

/** Who ended a job before its agent was done, in words: an agent of yours, you, or RPE and why; null where nobody did, or where its limit's own line says it. */
export function stoppedByWords(job: Pick<JobView, "stoppedBy" | "state">): string | null {
  const by = job.stoppedBy;
  if (by === undefined) return null;
  switch (by.by) {
    case "agent":
      return `The ${by.agent.definition} (${by.agent.id}) cancelled it, in run ${by.run}.`;
    case "user":
      return job.state === "cancelled" ? "You cancelled it." : "You ended it.";
    case "engine":
      return ENGINE_STOP_WORDS[by.reason];
  }
}

/** Why RPE ended a job; at a limit the limit's own line says which, so nothing more is said. */
const ENGINE_STOP_WORDS: Readonly<Record<Extract<JobStopper, { by: "engine" }>["reason"], string | null>> = {
  limit: null,
  "off-path": "RPE ended it: the turn that started it left the chat's path.",
  stopping: "RPE ended it as RPE stopped. You can resume it.",
  restart: "RPE found it cut off by a restart. You can resume it.",
};

const LIMIT_WORDS: Readonly<Record<Extract<JobRefusal, { refused: "limit" }>["limit"], string>> = { calls: "calls", tokensIn: "tokens in", tokensOut: "tokens out", tokens: "tokens in all", time: "seconds", askAt: "the calls it asks at" };

/** Why RPH did not start a job or did not apply a control to it, in words. */
export function refusalWords(refusal: JobRefusal): string {
  switch (refusal.refused) {
    case "off":
      return "Jobs are switched off.";
    case "day-count":
      return `The day's count of calls is reached${refusal.connection === undefined ? "" : ` on ${refusal.connection}`}: ${refusal.value} of ${refusal.max}.`;
    case "day-tokens":
      return `The day's tokens are reached: ${refusal.value} of ${refusal.max}.`;
    case "limit":
      return `A limit takes a whole number above 0: ${LIMIT_WORDS[refusal.limit]} was ${refusal.value}.`;
    case "agent":
      return `No agent named ${refusal.agent} is in force, or no model resolves for it.`;
    case "no-job":
      return `There is no job ${refusal.id}.`;
    case "state":
      return `Job ${refusal.id} is ${JOB_STATE_WORDS[refusal.state].words}; that applies to a job that is ${refusal.applies.map((s) => JOB_STATE_WORDS[s].words).join(" or ")}.`;
    case "not-at-limit":
      return `Job ${refusal.id} did not stop at one of its own limits.`;
    case "hook":
      return `Your job-start hook ${refusal.hook} refused it: ${refusal.reason}`;
    case "connection":
      return `The connection ${refusal.connection} cannot be used for it.`;
    case "part":
      return `The ${refusal.part === "tag-check" ? "tag check's" : "reply contract's"} part is missing or not as the check needs.`;
  }
}
