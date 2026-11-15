// A run as the Live and Turn pages draw it: its head (what it is, how it stands, what it spent), what
// went to the chat, and the tree of its agents, each with every step it took. Built only from the model
// (live-model.ts); no part holds state, so the same parts draw a run as it happens and a run long done.
// Every kind of record has its own words here; a kind this build does not know is drawn as it came.

import type { ComponentChildren } from "preact";
import type { PromptNotice, ReleaseForm, ReplyError, RunStatus, ToolResult, TraceRecord } from "rp-harness/contract";
import { Icon, type IconName } from "./icons";
import { markdown } from "./markdown";
import type { TurnRunKind } from "../shared/api";
import { Badge, Fold, Pre, type Tone } from "./atoms";
import { type AgentNode, type AgentState, agentState, agentUsage, type CallStep, type NoteStep, type RunNode, runTotals, type Step, type ToolStep } from "./live-model";
import { type NoticeLines, NO_NOTICES, noticeLine } from "./notice-words";
import { counted, duration, json, num, tokenWords } from "./words";

export const TURN_KIND_WORDS: Readonly<Record<TurnRunKind, string>> = { new: "New reply", swipe: "Swipe", regenerate: "Regenerate", continue: "Continue", impersonate: "Impersonation", settle: "Settle an edit" };

const RUN_WORDS: Readonly<Record<"turn" | "job" | "talk", string>> = { turn: "Turn", job: "Job", talk: "Talk with an agent" };

export const STATUS_WORDS: Readonly<Record<RunStatus | "running", { words: string; tone: Tone }>> = {
  running: { words: "Running", tone: "accent" },
  released: { words: "Reply released", tone: "pos" },
  "no-reply": { words: "No reply", tone: "neg" },
  stopped: { words: "Stopped", tone: "warn" },
  limit: { words: "Stopped at a limit", tone: "warn" },
  failed: { words: "Failed", tone: "neg" },
};

/** How a run of `kind` stands, in words: a settle run writes nothing to the chat, so its ending with no reply is how it is meant to end. */
export function statusWords(kind: TurnRunKind | undefined, status: RunStatus | "running"): { words: string; tone: Tone } {
  return kind === "settle" && status === "no-reply" ? { words: "Settled, no reply: as a settle run ends", tone: "pos" } : STATUS_WORDS[status];
}

const AGENT_WORDS: Readonly<Record<AgentState, { words: string; tone?: Tone }>> = {
  working: { words: "working", tone: "accent" },
  done: { words: "done", tone: "pos" },
  asked: { words: "asked its lead", tone: "gm" },
  limit: { words: "at a limit", tone: "warn" },
  stopped: { words: "stopped", tone: "warn" },
  failed: { words: "failed", tone: "neg" },
  unfinished: { words: "did not finish", tone: "warn" },
};

const FORM_WORDS: Readonly<Record<ReleaseForm, string>> = { tags: "its own text, in the reply tags", message: "a message of its own", narrator: "the narrator's draft", "narrator-live": "the narrator, live", file: "a finished file" };

const REPLY_ERROR_WORDS: Readonly<Record<ReplyError["code"], string>> = {
  "no-reply": "The lead's run ended with no reply released.",
  limit: "A limit was reached.",
  provider: "The model's provider failed.",
  stopped: "The turn was stopped.",
  failed: "The harness failed.",
  "no-definition": "No agent definition in force for the chat defines the turn's lead.",
  "no-tags": "The connection's replies are marked by tags, and no reply contract in force names them.",
};

/** Why a reply failed, in words; null where the status beside it already says all of it. */
export function replyErrorWords(error: ReplyError, status: RunStatus | "running"): string | null {
  if (error.code === status && error.detail === undefined) return null;
  const limit = error.limit === undefined ? "" : ` (${error.limit.limit} per ${error.limit.per}: ${num(error.limit.value)} of ${num(error.limit.max)})`;
  const lead = error.agent === undefined ? "" : ` (the lead: ${error.agent})`;
  return `${REPLY_ERROR_WORDS[error.code]}${limit}${lead}${error.detail === undefined ? "" : ` ${error.detail}`}`;
}

/** What a run is, in a few words: "New reply, led by author". */
export function runTitle(run: Pick<RunNode, "started">): string {
  const started = run.started;
  if (started === null) return "A run";
  const what = started.run === "turn" ? (started.turn === undefined ? RUN_WORDS.turn : TURN_KIND_WORDS[started.turn]) : RUN_WORDS[started.run];
  return `${what}, led by ${started.lead}`;
}

/** How long a run has gone on, or took. */
export function runSpan(run: RunNode, now: number): number | null {
  const from = run.startedAt ?? run.firstAt;
  if (from === null) return null;
  return (run.endedAt ?? (run.outcome === null ? now : run.lastAt ?? from)) - from;
}

/** A run's head; `kind`, where the page knows it from RPE, names a settle run as one (the harness runs it as a continue) and its ending with no reply as normal. */
export function RunHead(props: { run: RunNode; now: number; kind?: TurnRunKind }) {
  const { run, kind } = props;
  const outcome = run.outcome?.status ?? "running";
  const status = statusWords(kind, outcome);
  const span = runSpan(run, props.now);
  const totals = runTotals(run);
  const failure = run.outcome?.error === undefined || (kind === "settle" && outcome === "no-reply") ? null : replyErrorWords(run.outcome.error, run.outcome.status);
  return (
    <div class="rpe-runhead" data-run={run.run}>
      <div class="lre-spread">
        <strong class="rpe-runhead-title">{kind === "settle" && run.started !== null ? `${TURN_KIND_WORDS.settle}, led by ${run.started.lead}` : runTitle(run)}</strong>
        <span class="lre-inline">
          <Badge tone={status.tone}>{status.words}</Badge>
          {span === null ? null : <span class="lre-muted lre-num">{run.outcome === null ? `for ${duration(span)}` : `in ${duration(span)}`}</span>}
        </span>
      </div>
      <div class="rpe-stats">
        <span>{counted(totals.agents, "agent")}</span>
        <span>{counted(totals.calls, "model call")}</span>
        <span>{counted(totals.tools, "tool call")}</span>
        <span>{counted(totals.rules, "rule fired", "rules fired")}</span>
        <span class="lre-num">{tokenWords(totals.usage)}</span>
      </div>
      {failure === null ? null : <p class="lre-neg rpe-line">{failure}</p>}
    </div>
  );
}

/** What went to the chat: the reply's text as it streams, and the progress lines its thinking block was given. */
export function ReplyBox(props: { run: RunNode }) {
  const { reply } = props.run;
  const streaming = props.run.released === null && props.run.outcome === null;
  const progress = reply.progress.filter((line) => line !== "");
  if (reply.text === "" && progress.length === 0) return <p class="lre-muted rpe-line">{streaming ? "Nothing has gone to the chat yet." : "Nothing went to the chat."}</p>;
  return (
    <div class="lre-stack">
      {progress.length === 0 ? null : (
        <ul class="rpe-progress" aria-label="Progress lines in the chat's thinking block">
          {progress.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {reply.text === "" ? null : <Pre text={reply.text} mono={false} live={streaming} />}
    </div>
  );
}

// ---------------------------------------------------------------- the tree

/** The run's agents as a tree: the lead first, each agent under the one that started it. `notices` are the words of the notices file, for the records that are notices. */
export function AgentTree(props: { run: RunNode; now: number; notices?: NoticeLines }) {
  return (
    <div class="rpe-tree">
      {props.run.roots.map((id) => (
        <AgentBox key={id} run={props.run} id={id} now={props.now} depth={0} notices={props.notices ?? NO_NOTICES} />
      ))}
    </div>
  );
}

function agentName(agent: AgentNode): string {
  return agent.ref.plays === undefined ? agent.ref.definition : `${agent.ref.definition}, playing ${agent.ref.plays}`;
}

export function AgentBox(props: { run: RunNode; id: string; now: number; depth: number; notices: NoticeLines }) {
  const agent = props.run.agents.get(props.id);
  if (agent === undefined) return null;
  const state = agentState(agent, props.run);
  const usage = agentUsage(agent);
  const calls = agent.steps.filter((s) => s.kind === "call").length;
  const rules = agent.steps.filter((s) => s.kind === "note" && s.record.event.kind === "rule_fired").length;
  const placed = new Set(agent.steps.flatMap((s) => (s.kind === "tool" ? s.agents : [])));
  const loose = agent.children.filter((id) => !placed.has(id));
  const last = agent.steps.findLast((s) => s.kind === "call")?.key;
  return (
    <details class="rpe-agent" open data-agent={agent.ref.id} data-depth={props.depth}>
      <summary class="rpe-agent-head">
        <Icon name={props.depth === 0 ? "wand" : agent.ref.plays === undefined ? "users" : "user"} size={18} />
        <span class="rpe-agent-name">{agentName(agent)}</span>
        <Badge tone={AGENT_WORDS[state].tone}>{AGENT_WORDS[state].words}</Badge>
        <span class="rpe-meta lre-num">
          {counted(calls, "call")}
          {rules > 0 ? ` · ${counted(rules, "rule fired", "rules fired")}` : ""} · {tokenWords(usage)}
        </span>
      </summary>
      <div class="rpe-agent-body">
        {agent.todo === null || agent.todo.length === 0 ? null : <TodoList items={agent.todo} />}
        <ol class="rpe-steps">
          {agent.steps.map((step) => (
            <li key={step.key} class={`rpe-step ${step.kind}`} data-seqs={step.seqs.join(",")}>
              <StepView step={step} run={props.run} now={props.now} depth={props.depth} last={step.key === last} notices={props.notices} />
            </li>
          ))}
        </ol>
        {loose.length === 0 ? null : (
          <div class="rpe-children">
            {loose.map((id) => (
              <AgentBox key={id} run={props.run} id={id} now={props.now} depth={props.depth + 1} notices={props.notices} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function TodoList(props: { items: readonly { text: string; done: boolean }[] }) {
  return (
    <ul class="rpe-todo" aria-label="Its todo list">
      {props.items.map((item, i) => (
        <li key={i} data-done={item.done ? "true" : "false"}>
          <Icon name={item.done ? "check" : "minus"} size={14} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function StepView(props: { step: Step; run: RunNode; now: number; depth: number; last: boolean; notices: NoticeLines }) {
  const { step } = props;
  if (step.kind === "call") return <CallView step={step} open={props.last} now={props.now} />;
  if (step.kind === "tool") return <ToolView step={step} run={props.run} now={props.now} depth={props.depth} notices={props.notices} />;
  return <NoteView step={step} notices={props.notices} />;
}

function CallView(props: { step: CallStep; open: boolean; now: number }) {
  const { step } = props;
  const answer = step.answer;
  const thinking = answer?.thinking ?? step.streamed.thinking;
  return (
    <div class="lre-stack">
      <div class="rpe-step-head">
        <Icon name="sparkle" size={16} />
        <span class="rpe-step-title">Model call {step.call}</span>
        <Badge>{answer?.model ?? step.sent.model}</Badge>
        <span class="rpe-meta lre-num">
          {counted(step.sent.messages, "message")} · {counted(step.sent.tools, "tool")}
          {answer === null ? ` · writing for ${duration(props.now - step.at)}` : ` · ${duration(answer.ms)} · ${tokenWords(answer.usage)} · ${answer.stop}`}
        </span>
      </div>
      {answer?.error === undefined ? null : <p class="lre-neg rpe-line">{answer.error}</p>}
      {thinking === "" ? null : (
        <Fold summary="Thinking">
          <Pre text={thinking} mono={false} live={answer === null} />
        </Fold>
      )}
      {answer === null ? (
        step.streamed.text === "" ? null : <Pre text={step.streamed.text} mono={false} live />
      ) : answer.text === "" ? null : (
        <Fold summary="What it wrote" open={props.open}>
          {markdown(answer.text, "lre-md rpe-written")}
        </Fold>
      )}
      {answer === null || answer.toolCalls.length === 0 ? null : <p class="rpe-meta">Asked for: {answer.toolCalls.map((c) => c.name).join(", ")}</p>}
    </div>
  );
}

/** A tool's answer as its model was shown it: text as written, a picture by its type. */
export function resultText(result: ToolResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : `[a picture, ${part.mimeType}]`)).join("\n");
}

function ToolView(props: { step: ToolStep; run: RunNode; now: number; depth: number; notices: NoticeLines }) {
  const { step } = props;
  const ended = step.ended;
  const result = ended?.result;
  return (
    <div class="lre-stack">
      <div class="rpe-step-head">
        <Icon name="wrench" size={16} />
        <span class="rpe-step-title">{step.started.tool}</span>
        {step.started.closing ? <Badge>closing</Badge> : null}
        {step.started.via === undefined ? null : <Badge>through {step.started.via}</Badge>}
        {ended === null ? <Badge tone="accent">running</Badge> : result?.error === true ? <Badge tone="neg">failed</Badge> : ended.clean ? <Badge tone="pos">clean</Badge> : <Badge tone="warn">with reports</Badge>}
        {ended?.endedRun === true ? <Badge>ended the run</Badge> : null}
        <span class="rpe-meta lre-num">{ended === null ? `for ${duration(props.now - step.at)}` : duration(ended.ms)}</span>
      </div>
      <Fold summary="Arguments">
        <Pre text={json(step.started.args)} />
      </Fold>
      {step.updates.map((update, i) => (
        <Fold key={i} summary={`While it ran (${i + 1})`}>
          <Pre text={resultText(update)} />
        </Fold>
      ))}
      {step.agents.length === 0 ? null : (
        <div class="rpe-children">
          {step.agents.map((id) => (
            <AgentBox key={id} run={props.run} id={id} now={props.now} depth={props.depth + 1} notices={props.notices} />
          ))}
        </div>
      )}
      {result === undefined ? null : (
        <div class="lre-stack" data-answer>
          <span class="rpe-caption">Its answer</span>
          <Pre text={resultText(result)} />
          {result.reports === undefined || result.reports.length === 0 ? null : (
            <ul class="rpe-reports" aria-label="What it reported">
              {result.reports.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {result.marks === undefined || result.marks.length === 0 ? null : (
            <span class="lre-inline">
              {result.marks.map((mark) => (
                <Badge key={mark} tone="gm">
                  {mark}
                </Badge>
              ))}
            </span>
          )}
          {result.details === undefined ? null : (
            <Fold summary="Details">
              <Pre text={json(result.details)} />
            </Fold>
          )}
        </div>
      )}
    </div>
  );
}

export function noticeWords(notice: PromptNotice): string {
  switch (notice.kind) {
    case "changed":
      return `The part marked ${notice.marker} changed.`;
    case "gone":
      return `The part marked ${notice.marker} is gone.`;
    case "unclaimed":
      return `Text no part claims: message ${notice.message}, characters ${notice.start} to ${notice.end}.`;
    case "order":
      return `The parts came in a new order: ${notice.markers.join(", ")}.`;
    case "preset":
      return `The preset changed${notice.now === null ? "" : ` to ${notice.now.name}`}.`;
    case "unmapped":
      return "This preset has no prompt map yet.";
    case "incomplete":
      return "The prompt map does not cover the whole prompt.";
  }
}

function NoteHead(props: { icon: IconName; title: string; children?: ComponentChildren }) {
  return (
    <div class="rpe-step-head">
      <Icon name={props.icon} size={16} />
      <span class="rpe-step-title">{props.title}</span>
      {props.children}
    </div>
  );
}

function NoteView(props: { step: NoteStep; notices: NoticeLines }) {
  const record: TraceRecord = props.step.record;
  const { notices } = props;
  const event = record.event;
  switch (event.kind) {
    case "run_started":
      return <NoteHead icon="route" title={`The run began: ${event.run === "turn" && event.turn !== undefined ? TURN_KIND_WORDS[event.turn].toLowerCase() : RUN_WORDS[event.run].toLowerCase()}, led by ${event.lead}`} />;
    case "agent_started":
      return (
        <div class="lre-stack">
          <NoteHead icon="user-plus" title="Began work">
            <span class="rpe-meta">
              {event.connection} · {event.model}
              {event.effort === undefined ? "" : ` · effort ${event.effort}`} · session {event.session}
            </span>
          </NoteHead>
          {event.given.length === 0 ? null : <p class="rpe-meta">Given: {event.given.join(", ")}</p>}
        </div>
      );
    case "intent":
      return (
        <div class="lre-stack">
          <NoteHead icon="flag" title="Wrote its intent record" />
          <Pre text={event.text} mono={false} />
        </div>
      );
    case "rule_fired": {
      const f = event.firing;
      return (
        <div class="lre-stack">
          <NoteHead icon="bolt" title={`Rule ${f.rule} fired`}>
            <Badge tone="gm">{f.action}</Badge>
            <span class="rpe-meta">at {f.moment}</span>
          </NoteHead>
          <p class="rpe-meta">
            {f.tool === undefined ? "" : `On ${f.watched === undefined ? "a call" : `the ${f.watched}`} of ${f.tool}${f.callId === undefined ? "" : ` (${f.callId})`}. `}
            From {f.path} ({f.level}).
          </p>
          {f.matched === undefined ? null : <p class="rpe-line">Matched: {f.matched}</p>}
          {f.fact === undefined ? null : (
            <p class="rpe-line">
              Fact {f.fact.name}: {num(f.fact.value.count)}
              {f.fact.value.names === undefined ? "" : ` (${f.fact.value.names.join(", ")})`}
            </p>
          )}
          {f.dropped === undefined ? null : (
            <Fold summary="What it cut before it was shown">
              <Pre text={f.dropped} mono={false} />
            </Fold>
          )}
        </div>
      );
    }
    case "hook":
      return <NoteHead icon="link" title={`Hook ${event.hook} at ${event.on}: ${event.outcome}, ${duration(event.ms)}`} />;
    case "approval_asked":
      return <NoteHead icon="lock" title={`Waited for your word before ${event.tool} (${event.lane})`} />;
    case "approval_answered":
      return <NoteHead icon="lock" title={`Your word on ${event.tool}: ${event.answer.go ? "go ahead" : `no${event.answer.reason === undefined ? "" : `: ${event.answer.reason}`}`}`} />;
    case "prompt_notices":
      return (
        <div class="lre-stack">
          <NoteHead icon="info" title="What changed in the prompt" />
          <ul class="rpe-reports">
            {event.notices.map((notice, i) => (
              <li key={i}>{noticeWords(notice)}</li>
            ))}
          </ul>
        </div>
      );
    case "todo":
      return (
        <div class="lre-stack">
          <NoteHead icon="checklist" title="Its todo list now" />
          <TodoList items={event.items} />
        </div>
      );
    case "limit":
      return <NoteHead icon="alert" title={`Reached a limit: ${event.hit.limit} per ${event.hit.per}, ${num(event.hit.value)} of ${num(event.hit.max)}`} />;
    case "progress_missing": {
      // Its words are the notices file's, whatever they are; a line the file no longer holds leaves the event drawn as it came.
      const words = noticeLine(notices, "progress_missing", { time: event.time });
      if (words === undefined) return <NoteHead icon="code" title={`${event.kind}: ${json(event)}`} />;
      return <NoteHead icon="alert" title={words} />;
    }
    case "released":
      return <NoteHead icon="send" title={`Released the reply: ${FORM_WORDS[event.release.form]}, ${counted(event.release.length, "character")}${event.release.path === undefined ? "" : ` (${event.release.path})`}`} />;
    case "compacted":
      return <NoteHead icon="shrink" title={`Compacted session ${event.session}: ${num(event.before)} to ${num(event.after)} tokens, ${counted(event.keptTurns, "turn")} kept as they were`} />;
    case "session":
      return <NoteHead icon="book" title={`Session ${event.session} ${event.change}${event.from === undefined ? "" : ` from ${event.from}`}`} />;
    case "job":
      return (
        <div class="lre-stack">
          <NoteHead icon="briefcase" title={`Job ${event.job.id} (${event.job.agent}): ${event.job.state}`} />
          <p class="rpe-line">{event.job.brief}</p>
          {event.job.report === undefined ? null : <Pre text={event.job.report} mono={false} />}
        </div>
      );
    case "agent_ended":
      return <NoteHead icon="check" title={`Ended: ${AGENT_WORDS[event.status].words}${event.limit === undefined ? "" : ` (${event.limit.limit} per ${event.limit.per})`}, ${counted(event.usage.calls, "call")}, ${tokenWords(event.usage)}`} />;
    case "run_ended":
      return <NoteHead icon="flag" title={`The run ended: ${STATUS_WORDS[event.outcome.status].words.toLowerCase()}, ${counted(event.outcome.usage.calls, "call")}, ${tokenWords(event.outcome.usage)}`} />;
    default:
      // A start whose step is missing here, or a kind this build does not know: drawn as it came.
      return (
        <div class="lre-stack">
          <NoteHead icon="code" title={event.kind} />
          <Pre text={json(event)} />
        </div>
      );
  }
}
