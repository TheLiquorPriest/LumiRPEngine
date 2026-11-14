// The jobs (plan §13.5) as the pages list them: a chat's on its Turns page, and the user's of every chat
// on Chats. Each job as RPH last kept it: its agent and what it was asked, how it stands, who started it,
// when, what it spent, the limit it ended at and its report; and Cancel while it is queued or running.
// What RPE refuses (no such job, or an RPE that runs no jobs) is shown in its words. A chat's list reads
// when the page opens, when the live view says a run of the chat began or ended, and after a Cancel;
// nothing polls.

import type { JobState, JobView } from "rp-harness/contract";
import type { JobList } from "../api";
import { Badge, Banner, Button, Pre, Section, type Tone } from "../atoms";
import type { RpeClient } from "../client";
import { errorWords, num, tokenWords, when } from "../words";

/** How a job stands, as a badge says it. */
export const JOB_STATE_WORDS: Readonly<Record<JobState, { words: string; tone?: Tone }>> = {
  queued: { words: "queued", tone: "accent" },
  running: { words: "running", tone: "accent" },
  done: { words: "done", tone: "pos" },
  failed: { words: "failed", tone: "neg" },
  cancelled: { words: "cancelled", tone: "warn" },
  "off-path": { words: "off the path", tone: "warn" },
  interrupted: { words: "interrupted", tone: "warn" },
};

/** Whether a Cancel can do anything: the job has not ended. */
export function cancellable(job: JobView): boolean {
  return job.state === "queued" || job.state === "running";
}

/** The jobs as a page holds them: the list read last, what could not be read, the Cancel out, and what RPE answered to the last one. */
export interface JobsShown {
  jobs: JobView[] | null;
  loading: boolean;
  problem: string | null;
  cancelling: string | null;
  /** The job a Cancel was for, and RPE's refusal in its words (null: it was taken). */
  cancelled: { job: string; refused: string | null } | null;
}

export const NO_JOBS: JobsShown = { jobs: null, loading: true, problem: null, cancelling: null, cancelled: null };

export interface JobsReader {
  refresh(): void;
  cancel(job: string): void;
  stop(): void;
}

/** Reads the jobs of `chat` (null: the user's of every chat); a Cancel posts, shows the job as RPE answers it, and reads again. What comes back once `stop()` is called is let go. */
export function readJobs(client: Pick<RpeClient, "call">, chat: string | null, onChange: (shown: JobsShown) => void): JobsReader {
  let shown = NO_JOBS;
  let alive = true;
  const show = (next: Partial<JobsShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const read = (): void => {
    const asked: Promise<JobList> = chat === null ? client.call("GET /api/v1/jobs", {}) : client.call("GET /api/v1/chats/:chat/jobs", { chat });
    asked.then(
      (list) => show({ jobs: list.jobs, loading: false, problem: null }),
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  read();
  return {
    refresh: read,
    cancel(job) {
      if (shown.cancelling !== null) return;
      show({ cancelling: job, cancelled: null });
      client.call("POST /api/v1/jobs/:job/cancel", { job }).then(
        (answer) => {
          show({ cancelling: null, cancelled: { job, refused: null }, jobs: shown.jobs?.map((j) => (j.id === answer.job.id ? answer.job : j)) ?? null });
          read();
        },
        (error: unknown) => show({ cancelling: null, cancelled: { job, refused: errorWords(error) } }),
      );
    },
    stop() {
      alive = false;
    },
  };
}

function JobItem(props: { job: JobView; shown: JobsShown; withChat: boolean; onCancel(job: string): void }) {
  const { job, shown } = props;
  const state = JOB_STATE_WORDS[job.state];
  const answered = shown.cancelled?.job === job.id ? shown.cancelled : null;
  return (
    <li class="rpe-entry lre-stack" data-job={job.id}>
      <div class="lre-inline rpe-wrap">
        <span class="rpe-strong">{job.agent}</span>
        <Badge tone={state.tone}>{state.words}</Badge>
        {props.withChat ? <span class="rpe-meta">chat {job.scope.chat}</span> : null}
        {cancellable(job) ? (
          <Button small kind="ghost" busy={shown.cancelling === job.id} onClick={() => props.onCancel(job.id)}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p class="rpe-line">{job.brief}</p>
      <span class="rpe-meta">
        {`${job.id} · started by ${job.startedBy === "user" ? "you" : `the ${job.startedBy.definition}`} ${when(job.started)}${job.ended === undefined ? "" : `, ended ${when(job.ended)}`} · ${tokenWords(job.usage)}`}
      </span>
      {job.limit === undefined ? null : (
        <span class="rpe-meta">
          Ended at its {job.limit.limit} limit per {job.limit.per}: {num(job.limit.value)} of {num(job.limit.max)}.
        </span>
      )}
      {job.report === undefined ? null : <Pre text={job.report} mono={false} />}
      {answered === null || answered.refused === null ? null : (
        <Banner tone="neg" icon="alert" title="Not cancelled">
          <span>{answered.refused}</span>
        </Banner>
      )}
    </li>
  );
}

/** The jobs listed, newest started first, each with Cancel while it has not ended; the user's of every chat each say their chat. */
export function JobsView(props: { shown: JobsShown; everyChat: boolean; onCancel(job: string): void }) {
  const { shown } = props;
  return (
    <Section id="jobs" title={props.everyChat ? "Your jobs" : "This chat's jobs"}>
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The jobs could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.jobs === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the jobs…</p>
        ) : null
      ) : shown.jobs.length === 0 ? (
        <p class="lre-muted rpe-line">{props.everyChat ? "No job of yours." : "No job of this chat."}</p>
      ) : (
        <ul class="rpe-plain lre-stack">
          {shown.jobs.map((job) => (
            <JobItem key={job.id} job={job} shown={shown} withChat={props.everyChat} onCancel={props.onCancel} />
          ))}
        </ul>
      )}
    </Section>
  );
}
