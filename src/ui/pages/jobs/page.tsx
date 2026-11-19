// Jobs (plan §13.5, §14): every job of every chat, or the chat open's, newest started first, each by its row, a page at a time and by where it
// stands; one opened by address (`jobs/<id>`), read whole by its id, beside the list at desktop width and in its place, with Back, on a phone;
// one started by hand; the switches over all jobs. The list is read again when RPE says a job changed, in any chat: nothing polls.

import { useEffect, useState } from "preact/hooks";
import type { JobRow, JobState, JobView } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Empty, PageHeader } from "../../../frontend/components";
import { walk } from "../../client";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, tokenWords, when } from "../../words";
import { BootstrapPart } from "./bootstrap";
import { BootstrapMark, briefLine, isBootstrapJob } from "./bootstrap-mark";
import { JobOpen } from "./open";
import { StartSection } from "./start";
import { SwitchesSection } from "./switches";
import { JOB_STATE_WORDS } from "./words";

const STATES = Object.keys(JOB_STATE_WORDS) as JobState[];

/** The chat a job belongs to; null for one of no chat. */
export function chatOfJob(job: Pick<JobRow, "scope">): string | null {
  return typeof job.scope.chat === "string" ? job.scope.chat : null;
}

/** The jobs the page lists: those of the chat when it is asked for (`chat` not null), those in the state when one is chosen. */
export function listedJobs(jobs: readonly JobRow[], chat: string | null, state: JobState | null): JobRow[] {
  return jobs.filter((j) => (chat === null || chatOfJob(j) === chat) && (state === null || j.state === state));
}

function JobLine(props: { job: JobRow; open: boolean; withChat: boolean; onOpen(): void }) {
  const { job } = props;
  const briefChars = useUiSetting("briefChars");
  const state = JOB_STATE_WORDS[job.state];
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-job-line={job.id} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{job.agent}</span>
            <span class="lre-listrow-sub">
              {briefLine(job, briefChars)} · {when(job.started)} · {counted(job.usage.calls, "call")} · {tokenWords(job.usage)}
              {props.withChat && chatOfJob(job) !== null ? ` · chat ${chatOfJob(job)}` : ""}
            </span>
          </span>
          <span class="lre-inline">
            {isBootstrapJob(job) ? <BootstrapMark job={job} /> : null}
            <Badge tone={state.tone}>{state.words}</Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

export function JobsPage(props: { chat: string | null; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const [stamp, setStamp] = useState(0);
  const [everyChat, setEveryChat] = useState(chat === null);
  const [state, setState] = useState<JobState | null>(null);
  const [pages, setPages] = useState(1);
  const [changed, setChanged] = useState<ReadonlyMap<string, JobRow>>(new Map());
  const jobs = useRead(() => walk(app.client, "GET /api/v1/jobs", {}), [stamp]);
  // A job that changes, in any chat, is read again: nothing polls.
  useEffect(
    () =>
      app.client.follow("~jobs", {
        events(events) {
          if (events.some((event) => String(event.kind) === "job")) setStamp((n) => n + 1);
        },
        reset: () => setStamp((n) => n + 1),
        refused: () => undefined,
      }),
    [],
  );
  useEffect(() => {
    setChanged(new Map());
  }, [jobs.value]);
  useEffect(() => setPages(1), [everyChat, state, chat]);
  const all = (jobs.value ?? []).map((j) => changed.get(j.id) ?? j);
  const listed = listedJobs(all, everyChat ? null : chat, state);
  const shown = listed.slice(0, perPage * pages);
  const id = props.at?.[0] ?? null;
  const go = (to: string | null): void => app.go({ page: "jobs", chat, at: to === null ? [] : [to] });
  /** A job changed by his press on its page: the list shows it as RPE answered, until the list is read again. */
  const pressed = (job: JobView): void => setChanged((held) => new Map(held).set(job.id, job));
  return (
    <div class="lre-stack rpe-page" data-page="jobs">
      <PageHeader title="Jobs" subtitle="Every job, with its work and what it spent." {...(id === null ? {} : { onBack: () => go(null), backLabel: "all jobs" })} />
      <div class="rpe-files-split" data-open={id === null ? "no" : "yes"}>
        <div class="rpe-files-browser lre-stack">
          <StartSection chat={chat} onStarted={(job) => (pressed(job), setStamp((n) => n + 1), go(job.id))} />
          <SwitchesSection chat={chat} reload={stamp} onChanged={() => setStamp((n) => n + 1)} />
          <BootstrapPart chat={chat} />
          <div class="lre-inline rpe-wrap">
            {chat === null ? null : (
              <>
                <Button size="sm" variant="ghost" current={!everyChat} onClick={() => setEveryChat(false)}>
                  This chat's
                </Button>
                <Button size="sm" variant="ghost" current={everyChat} onClick={() => setEveryChat(true)}>
                  Every chat's
                </Button>
              </>
            )}
            <label class="lre-field">
              <span class="label">Where it stands</span>
              <select class="lre-input" value={state ?? ""} onChange={(e) => setState(((e.currentTarget as HTMLSelectElement).value || null) as JobState | null)}>
                <option value="">any</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {JOB_STATE_WORDS[s].words}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {jobs.problem === null ? null : (
            <Banner tone="neg" icon="alert" title="The jobs could not be read">
              <span>{jobs.problem}</span>
            </Banner>
          )}
          {listed.length === 0 && !jobs.loading && jobs.problem === null ? (
            <Empty icon="briefcase" title="No job">
              <span>No job of yours stands here.</span>
            </Empty>
          ) : (
            <ul class="lre-list" data-jobs>
              {shown.map((job) => (
                <JobLine key={job.id} job={job} open={id === job.id} withChat={everyChat} onOpen={() => go(job.id)} />
              ))}
            </ul>
          )}
          {shown.length < listed.length ? (
            <Button onClick={() => setPages((n) => n + 1)}>{`More jobs (${listed.length - shown.length} left)`}</Button>
          ) : null}
        </div>
        {id === null ? null : (
          <div class="lre-stack rpe-open-session">
            <JobOpen
              key={id}
              chat={chat}
              id={id}
              stamp={stamp}
              onChanged={pressed}
              onAgent={(definition) => app.go({ page: "agents", chat, at: [definition] })}
              onTurn={(turn) => (chat === null ? undefined : app.go({ page: "turns", chat, at: [turn] }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
