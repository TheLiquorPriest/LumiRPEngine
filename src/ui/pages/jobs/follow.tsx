// A page that started a job follows it (plan §13.5): while it runs the page says so where it started it, with what it has spent so far; when
// it ends the page is told once, to read its own data again, and says how the job ended (done, failed with its reason, stopped, at a limit)
// with the way to the job's page kept. One piece for every place a page starts a job; what it hears is `job-watch.ts`'s.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JobState, JobView } from "../../../shared/api";
import { Button } from "../../../frontend/components";
import { useApp } from "../../app";
import { type JobRef, jobEnded, type JobWatched, watchJob } from "../../job-watch";
import { counted, limitCount, limitName, tokenWords } from "../../words";
import { logAt } from "../runtime/logs";

export type { JobRef } from "../../job-watch";

/** Follows `ref`, null while none is started; `onEnded` is told once, with the job as it ended (also for a job already ended when first heard of). */
export function useJobFollow(ref: JobRef | null, onEnded?: (job: JobView) => void): JobWatched | null {
  const app = useApp();
  const [watched, setWatched] = useState<JobWatched | null>(null);
  const told = useRef<string | null>(null);
  const latest = useRef(onEnded);
  latest.current = onEnded;
  useEffect(() => {
    setWatched(null);
    if (ref === null) return;
    told.current = null;
    return watchJob(app.client, ref, (next) => {
      setWatched(next);
      if (next.job !== null && jobEnded(next.job.state) && told.current !== ref.id) {
        told.current = ref.id;
        latest.current?.(next.job);
      }
    });
  }, [ref?.id, ref?.chat]);
  return watched;
}

/** How a job stands, after its name in a sentence. */
const STANDS: Readonly<Record<JobState, string>> = {
  queued: "is waiting for a place to run",
  held: "is held until you let it go",
  running: "is running",
  asking: "has stopped to ask whether to go on",
  done: "is done",
  failed: "failed",
  cancelled: "was stopped",
  "off-path": "ended off the path: its turn left the chat's path",
  interrupted: "was interrupted when RPE stopped",
};

/** The job's stand in a sentence: where it ended at a limit, that limit; a failed job, what its last call said where that is known. */
export function jobStands(watched: JobWatched | null): string {
  const job = watched?.job ?? null;
  if (job === null) return watched?.problem == null ? "is being read" : `could not be read: ${watched.problem}`;
  if (job.limit !== undefined && jobEnded(job.state)) return `${job.state === "done" ? "ended" : "stopped"} at its limit on ${limitName(job.limit)}: ${limitCount(job.limit)}`;
  if (job.state === "failed" && watched?.error != null) return `failed: ${watched.error}`;
  return STANDS[job.state];
}

export interface JobFollowProps {
  /** The job started, and where. */
  job: JobRef;
  /** What the job is, as a noun phrase that begins a sentence: "The indexing job". */
  what: string;
  /** Words added once the job is done: what the page now shows because of it. */
  afterDone?: string;
}

/** The line that says how a followed job stands, with what it has spent and the way to its page on Jobs; `watched` is `useJobFollow`'s. */
export function JobFollowLine(props: JobFollowProps & { watched: JobWatched | null }) {
  const app = useApp();
  const { chat, id } = props.job;
  const { watched } = props;
  const job = watched?.job ?? props.job.view ?? null;
  const ended = job !== null && jobEnded(job.state);
  const spent = watched?.spent ?? null;
  return (
    <p class="rpe-line" data-job-follow={id} data-state={job?.state ?? "unread"}>
      {`${props.what} ${jobStands(watched)}`}
      {spent === null || spent.calls === 0 ? "" : ` · ${counted(spent.calls, "call")}, ${tokenWords(spent)}${ended ? "" : " so far"}`}.
      {job?.state === "done" && props.afterDone !== undefined ? ` ${props.afterDone}` : ""}{" "}
      <Button size="sm" variant="ghost" onClick={() => app.go({ page: "jobs", chat, at: [id] })}>
        Its page on Jobs
      </Button>
      {job?.state !== "failed" ? null : (
        <Button size="sm" variant="ghost" onClick={() => app.go({ page: "runtime", chat, at: logAt({ ...(chat === null ? {} : { chat }), job: id }) })}>
          RPE's log of it
        </Button>
      )}
    </p>
  );
}

/** A started job followed where it was started: its line, and `onEnded` told once when it has ended, to read the page's own data again. */
export function JobFollow(props: JobFollowProps & { onEnded?(job: JobView): void }) {
  const watched = useJobFollow(props.job, props.onEnded);
  return <JobFollowLine {...props} watched={watched} />;
}
