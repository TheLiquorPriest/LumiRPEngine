// One job open (plan §13.5, §10.9, §14 Jobs): what it is, its report and what it wrote, its work step by step as Live draws a run (the trace view),
// behind the chat's spoiler gate, with its calls against its limit and each agent's window; and what he may do with it by where it stands: Cancel
// while it waits or runs, Start again, Carry on at a limit with more, Hold and Let go, Pause and Resume, a word to its lead, and his answer when it asks.
// Every refusal is shown in RPE's words. It is read again when RPE says a job changed.

import { useState } from "preact/hooks";
import type { JobLimitsAsk, JobView } from "../../../shared/api";
import { useApp, useNow } from "../../app";
import { Badge, Banner, Button, Gated, Section } from "../../../frontend/components";
import { applyRecord, EMPTY_LIVE, type LiveModel } from "../../live-model";
import { useNoticeLines } from "../../notice-words";
import { useRead } from "../../reading";
import { useSelect } from "../../store";
import { Written } from "../../markdown";
import { AgentTree } from "../../trace-view";
import { counted, errorWords, limitCount, limitName, num, tokenWords, when } from "../../words";
import { type AgentWindow, CallsLine, WindowGauge } from "../usage";
import { BootstrapAsk } from "./bootstrap";
import { BootstrapBrief, isBootstrapJob } from "./bootstrap-mark";
import { cancellable, JOB_STATE_WORDS, stoppedByWords } from "./words";
import { LIMIT_FIELDS, limitsOf } from "./start";

/** What he may do with a job at the state it stands in. */
export function controlsOf(job: JobView): { cancel: boolean; restart: boolean; carryOn: boolean; hold: boolean; release: boolean; pause: boolean; resume: boolean; word: boolean; answer: boolean } {
  return {
    cancel: cancellable(job),
    restart: job.state === "failed" || job.state === "cancelled" || job.state === "interrupted",
    carryOn: job.limit !== undefined && (job.state === "failed" || job.state === "done"),
    hold: job.state === "queued",
    release: job.state === "held",
    pause: job.state === "running",
    resume: job.state === "interrupted",
    word: job.state === "running" || job.state === "asking",
    answer: job.state === "asking",
  };
}

export interface JobOpenProps {
  chat: string | null;
  job: JobView;
  /** The jobs changed (his press, or RPE's word): the list is read again. */
  stamp: number;
  onChanged(job: JobView): void;
  onAgent(definition: string): void;
  onTurn(turn: string): void;
}

export function JobOpen(props: JobOpenProps) {
  const app = useApp();
  const { job } = props;
  // A job of a chat is watched behind that chat's gate; one of no chat behind the one gate the jobs have.
  const chat = typeof job.scope.chat === "string" ? job.scope.chat : "~jobs";
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const notices = useNoticeLines(chat);
  const run = useRead(gate ? () => app.client.call("GET /api/v1/jobs/:job", { job: job.id }) : null, [job.id, gate, props.stamp, job.state]);
  const model: LiveModel | null = run.value === null ? null : run.value.trace.reduce<LiveModel>((held, record) => applyRecord(held, record), EMPTY_LIVE);
  const running = job.state === "running" || job.state === "asking";
  const now = useNow(running);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [word, setWord] = useState("");
  const can = controlsOf(job);
  const bootstrap = isBootstrapJob(job);
  const press = (what: string, go: () => Promise<JobView | null>, done: string): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      (next) => {
        setBusy(null);
        setSaid(done);
        if (next !== null) props.onChanged(next);
      },
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const post = (key: "restart" | "hold" | "release" | "resume" | "pause"): Promise<JobView> => app.client.call(`POST /api/v1/jobs/:job/${key}`, { job: job.id }).then((a) => a.job);
  const state = JOB_STATE_WORDS[job.state];
  const stopped = stoppedByWords(job);
  const windows: AgentWindow[] = (run.value?.windows ?? []).map((w) => ({ agent: w.agent.id, definition: w.agent.definition, connection: "", model: "", held: w.gauge.used, window: w.gauge.window, reserve: w.gauge.reserve, calls: 0, running }));
  const callLimit = job.limits?.calls ?? null;
  return (
    <div class="lre-stack" data-job-open={job.id}>
      <p class="rpe-line">
        <Badge tone={state.tone}>{state.words}</Badge>{" "}
        <Button size="sm" variant="ghost" onClick={() => props.onAgent(job.agent)}>
          {job.agent}
        </Button>{" "}
        <span class="rpe-meta">{chat === "~jobs" ? "no chat" : `chat ${chat}`}</span>
      </p>
      {bootstrap ? <BootstrapBrief job={job} /> : <p class="rpe-line" data-brief>{job.brief}</p>}
      <p class="rpe-meta">
        {`${job.id} · started by ${job.startedBy === "user" ? "you" : `the ${job.startedBy.definition}`} ${when(job.started)}${job.ended === undefined ? "" : `, ended ${when(job.ended)}`} · ${tokenWords(job.usage)}`}
        {job.repeats === undefined ? "" : ` · it starts again job ${job.repeats}`}
      </p>
      <p class="rpe-line">
        <CallsLine calls={job.usage.calls} limit={callLimit} running={running} />
      </p>
      {job.limit === undefined ? null : (
        <p class="rpe-line" data-limit>
          {`Ended at its limit on ${limitName(job.limit)}: ${limitCount(job.limit)}.`}
        </p>
      )}
      {stopped === null ? null : (
        <p class="rpe-line" data-stopped-by>
          {stopped}
        </p>
      )}
      {job.missing === undefined || job.missing.length === 0 ? null : <p class="rpe-meta">Names it was given that nothing provides: {job.missing.join(", ")}.</p>}
      {job.asks === undefined ? null : (
        <p class="rpe-line" data-asks>
          It asked whether to go on at {num(job.asks.tokens)} tokens.
        </p>
      )}
      {job.report === undefined ? null : <Written text={job.report} />}
      {job.wrote === undefined || job.wrote.length === 0 ? null : (
        <Section id="wrote" title={`What it wrote (${job.wrote.length})`}>
          <ul class="rpe-reports">
            {job.wrote.map((w, i) => (
              <li key={i}>
                {w.tool}
                {w.lane === undefined ? "" : ` (${w.lane})`}: {w.line}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{said}</span>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
      {can.answer && bootstrap && typeof job.scope.chat === "string" ? <BootstrapAsk chat={job.scope.chat} job={job} stamp={props.stamp} onChanged={props.onChanged} /> : null}
      <div class="lre-inline rpe-wrap" data-controls>
        {can.cancel ? (
          <Button size="sm" variant="danger" busy={busy === "cancel"} onClick={() => press("cancel", () => app.client.call("POST /api/v1/jobs/:job/cancel", { job: job.id }).then((a) => a.job), "Cancelled.")}>
            Cancel
          </Button>
        ) : null}
        {can.restart ? (
          <Button size="sm" busy={busy === "restart"} onClick={() => press("restart", () => post("restart"), "Started again with the same task.")}>
            Start again
          </Button>
        ) : null}
        {can.resume ? (
          <Button size="sm" busy={busy === "resume"} onClick={() => press("resume", () => post("resume"), "Resumed from its own session.")}>
            Resume
          </Button>
        ) : null}
        {can.hold ? (
          <Button size="sm" variant="ghost" busy={busy === "hold"} onClick={() => press("hold", () => post("hold"), "Held: it waits until you let it go.")}>
            Hold
          </Button>
        ) : null}
        {can.release ? (
          <Button size="sm" busy={busy === "release"} onClick={() => press("release", () => post("release"), "Let go.")}>
            Let it go
          </Button>
        ) : null}
        {can.pause ? (
          <Button size="sm" variant="ghost" busy={busy === "pause"} onClick={() => press("pause", () => post("pause"), "Paused at its next call.")}>
            Pause
          </Button>
        ) : null}
        {can.answer && !bootstrap ? (
          <>
            <Button size="sm" busy={busy === "on"} onClick={() => press("on", () => app.client.call("POST /api/v1/jobs/:job/answer", { job: job.id }, { body: { go: "on" } }).then((a) => a.job), "It goes on.")}>
              Go on
            </Button>
            <Button size="sm" variant="ghost" busy={busy === "end"} onClick={() => press("end", () => app.client.call("POST /api/v1/jobs/:job/answer", { job: job.id }, { body: { go: "end" } }).then((a) => a.job), "It ends with what it has.")}>
              End it
            </Button>
          </>
        ) : null}
      </div>
      {!can.carryOn ? null : (
        <div class="lre-stack" data-carry-on>
          <span class="rpe-caption">Carry it on with more</span>
          <div class="rpe-log-filters">
            {LIMIT_FIELDS.map(([key, label]) => (
              <label key={key} class="lre-field">
                <span class="label">{label}</span>
                <input class="lre-input" inputMode="numeric" value={typed[key] ?? ""} onInput={(e) => setTyped((held) => ({ ...held, [key]: (e.currentTarget as HTMLInputElement).value }))} />
              </label>
            ))}
          </div>
          <div class="lre-inline">
            <Button
              size="sm"
              busy={busy === "continue"}
              onClick={() => {
                const { limits, bad } = limitsOf(typed);
                if (bad.length > 0) return setProblem(`A limit takes a whole number of at least one: ${bad.join(", ")}.`);
                press("continue", () => app.client.call("POST /api/v1/jobs/:job/continue", { job: job.id }, { body: { limits: limits as JobLimitsAsk } }).then((a) => a.job), "It carries on with the limits you gave.");
              }}
            >
              Carry it on
            </Button>
          </div>
        </div>
      )}
      {!can.word ? null : (
        <div class="lre-stack" data-word>
          <label class="lre-field">
            <span class="label">A word to its lead, which it gets at its next call as yours</span>
            <textarea class="lre-input" rows={2} value={word} onInput={(e) => setWord((e.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          <div class="lre-inline">
            <Button
              size="sm"
              busy={busy === "word"}
              disabled={word.trim() === ""}
              onClick={() =>
                press("word", () => app.client.call("POST /api/v1/jobs/:job/word", { job: job.id }, { body: { text: word } }).then((a) => { setWord(""); return a.job; }), "Said; it gets it at its next call.")
              }
            >
              Say it
            </Button>
          </div>
        </div>
      )}
      <Section id="work" title="Its work">
        <Gated open={gate} onOpen={() => app.gate.open(chat)} onClose={() => app.gate.close(chat)} why="What the agents planned and did can give away what comes next.">
          {run.problem === null ? null : <p class="rpe-line">{run.problem}</p>}
          {model === null ? (
            run.problem === null ? <p class="lre-muted rpe-line">Reading its work…</p> : null
          ) : (
            <div class="lre-stack">
              {windows.map((w) => (
                <WindowGauge key={w.agent} w={w} />
              ))}
              {run.value?.usage == null ? null : <p class="rpe-meta">{counted(run.value.usage.total.calls, "call")} in all, {tokenWords(run.value.usage.total)}.</p>}
              {model.runs.map((r) => (
                <AgentTree key={r.run} run={r} now={now} notices={notices} />
              ))}
            </div>
          )}
        </Gated>
      </Section>
    </div>
  );
}
