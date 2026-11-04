// GM → Live (DESIGN §4.6; `shared/live.ts`): the chat's agent turn as its agents work it, behind the
// GM gate, like a terminal session. The tab asks for the chat's live view (`lre.live get`), which
// catches it up on the run so far, then follows the pushes (`lre.live.update`) until it closes
// (`leave`). Each role run and each agent outside one is a group you can fold, in the order it
// started: its role, its phase or stage, its model, its status, its tokens and time; each message
// the agent was sent, its reasoning, its answers (long texts folded), each tool call as a card that
// folds over its arguments and its result, its caret's colour and words saying how the call stands,
// its stop, and the writes its run staged with what came of them. The turn's
// phases, a wait at a gate and what stopped it sit between the groups. The feed follows the newest
// unless you've scrolled up; a filter shows one role's work; Cancel stops the turn while it can be
// stopped. Once the turn ends, the view stays as that turn's record until the next one starts.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { agentLabel } from "../../shared/agent-settings";
import type { ChatId } from "../../shared/ids";
import { agentModel, DROP_WORDS, END_WORDS, followLive, groupSpent, type LiveAgentView, type LiveGroup, type LiveItem, liveItems, type LiveStatus, type LiveView, PHASE_WORDS, REVIEW_OUTCOME_WORDS, reviewEditWords, usageWords, WRITE_OUTCOME_WORDS } from "../../shared/live";
import { useApp } from "../app";
import { Badge, Button, Empty, Seg, useBusy } from "../components";
import { cancelTurn, elapsedText } from "../diagnostics";
import type { GmSectionProps, RequestBody } from "../registry";
import { scrollParent } from "../scroll";
import { useSelect } from "../store";

/** A live request as the tab sends it (`lre.live`). */
export type LiveBody = Extract<RequestBody, { type: "lre.live" }>;

/** The tab's requests for chat `chatId`: the view now (null: no run since the engine started; undefined: the request failed), and leaving it. */
export function liveControls(chatId: ChatId, request: (body: LiveBody) => Promise<{ live: LiveView | null } | null>): { get(): Promise<LiveView | null | undefined>; leave(): Promise<void> } {
  return {
    get: async () => {
      const result = await request({ type: "lre.live", op: "get", chatId });
      return result === null ? undefined : result.live;
    },
    leave: async () => {
      await request({ type: "lre.live", op: "leave", chatId });
    },
  };
}

const STATUS_WORDS: Readonly<Record<LiveStatus, string>> = { working: "working", done: "done", failed: "failed", stopped: "stopped", cancelled: "cancelled" };
const STATUS_TONE: Readonly<Record<LiveStatus, "accent" | "pos" | "neg" | "warn" | "neutral">> = { working: "accent", done: "pos", failed: "neg", stopped: "warn", cancelled: "neutral" };
const KIND_WORDS: Readonly<Record<LiveView["kind"], string>> = { turn: "Agent turn", read: "The reply read again", reply: "A reply's read" };

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** A text block, folded: its summary with the text's first line, and its text as written. */
function block(kind: string, summary: string, text: string) {
  return (
    <details class={`lre-live-block lre-live-${kind}`}>
      <summary>
        <span class="lre-live-block-head">{summary}</span>
        <span class="lre-live-preview">{text.trimStart().split("\n", 1)[0] ?? ""}</span>
      </summary>
      <pre class="lre-live-text">{text}</pre>
    </details>
  );
}

type LiveResult = Extract<LiveAgentView["steps"][number], { kind: "result" }>;
type LiveCall = Extract<LiveAgentView["steps"][number], { kind: "answer" }>["calls"][number];

/** How a tool call stands: waiting for its result, answered, failed, or left with none (its agent stopped or finished first). */
export type ToolCardState = "running" | "done" | "error" | "none";

export function toolCardState(result: LiveResult | undefined, finished: boolean): ToolCardState {
  if (result) return result.error ? "error" : "done";
  return finished ? "none" : "running";
}

const TOOL_STATE_WORDS: Readonly<Record<ToolCardState, string>> = { running: "running…", done: "done", error: "failed", none: "no result" };

/**
 * One tool call as a card that folds: its head a caret whose colour carries how it stands (with the
 * state in words too), the tool's name and its arguments in one line; opened, its arguments laid out
 * and its result as its model was sent it.
 */
function toolCard(c: LiveCall, result: LiveResult | undefined, finished: boolean) {
  const state = toolCardState(result, finished);
  return (
    <details key={c.id} class={`lre-live-tool is-${state}`} data-lre-live-call={c.name} data-state={state}>
      <summary class="lre-live-tool-head">
        <span class="lre-live-tool-caret" aria-hidden="true">
          ▸
        </span>
        <code class="lre-live-tool-name">{c.name}</code>
        <code class="lre-live-tool-preview">{JSON.stringify(c.args)}</code>
        <span class="lre-live-tool-state">{result ? `${TOOL_STATE_WORDS[state]} · ${seconds(result.ms)}` : TOOL_STATE_WORDS[state]}</span>
      </summary>
      <div class="lre-live-tool-body">
        <p class="lre-live-tool-label">Arguments</p>
        <pre class="lre-live-text">{JSON.stringify(c.args, null, 2)}</pre>
        <p class="lre-live-tool-label">{result?.error ? "Its failure" : "Its result"}</p>
        {result ? <pre class="lre-live-text">{result.text}</pre> : <p class="lre-live-line lre-live-dim">{state === "running" ? "Waiting for it…" : "None came: its agent stopped first."}</p>}
      </div>
    </details>
  );
}

/** One agent's work: where it works and on what, what it was told first, then each step in order (each tool call a card holding its result), and how it finished. */
function agentBody(a: LiveAgentView, startedAt: number, nested: boolean, groupEnded: boolean) {
  const results = new Map(a.steps.flatMap((s) => (s.kind === "result" ? [[s.call, s] as const] : [])));
  const called = new Set(a.steps.flatMap((s) => (s.kind === "answer" ? s.calls.map((c) => c.id) : [])));
  const finished = groupEnded || a.idle !== null || a.steps.some((s) => s.kind === "stop");
  const where = [a.start.stage ?? a.start.phase, a.start.task].filter((w) => w !== undefined && w !== "").join(" · ");
  return (
    <div class="lre-live-agent" data-lre-live-agent={a.start.agent}>
      <div class="lre-live-agent-head">
        {nested ? <strong>{agentLabel(a.start.role)}</strong> : null}
        {where !== "" ? <span>{where}</span> : null}
        <span class="lre-live-model">{agentModel(a) ?? "the connection's model"}</span>
        {a.start.connection ? <span class="lre-live-dim">on {a.start.connection}</span> : null}
        <span class="lre-live-dim">effort {a.start.effort}</span>
        <span class="lre-live-dim">+{seconds(a.start.at - startedAt)}</span>
      </div>
      {block("system", "Instructions", [...a.start.prefix, a.start.system].join("\n\n"))}
      {a.start.history > 0 ? <p class="lre-live-line lre-live-dim">{`Takes up ${a.start.history} message${a.start.history === 1 ? "" : "s"} of its session (Workspace shows the session).`}</p> : null}
      {a.steps.map((s) => {
        if (s.kind === "message") return <div key={s.seq}>{block("message", "→ Sent", s.text)}</div>;
        // A result shows in its call's card; one for no call shown is its own block.
        if (s.kind === "result") return called.has(s.call) ? null : <div key={s.seq}>{block(s.error ? "result failed" : "result", `${s.error ? "✗" : "←"} ${s.name} · ${seconds(s.ms)}`, s.text)}</div>;
        if (s.kind === "tools_refused") return <p key={s.seq} class="lre-live-line lre-live-warn">{`Its connection refused native tools, so the round went again with them as text: ${s.reason}`}</p>;
        if (s.kind === "stop")
          return (
            <p key={s.seq} class="lre-live-line lre-live-warn" data-lre-live-stop={s.code}>
              {`Stopped (${s.status}): ${s.reason}`}
            </p>
          );
        return (
          <div key={s.seq} class="lre-live-answer">
            <p class="lre-live-line">
              <span class="lre-live-arrow">←</span> {`Answered · ${s.model || "model"} · ${usageWords(s.usage)} · ${seconds(s.ms)} · ${s.finish || "stop"}`}
            </p>
            {s.reasoning ? block("reasoning", "Reasoning", s.reasoning) : null}
            {s.text.trim() !== "" ? <pre class="lre-live-text lre-live-said">{s.text}</pre> : null}
            {s.calls.length > 0 ? <div class="lre-live-tools">{s.calls.map((c) => toolCard(c, results.get(c.id), finished))}</div> : null}
          </div>
        );
      })}
      {a.idle ? <p class="lre-live-line lre-live-dim">{`Finished its message · ${usageWords(a.idle.usage)}`}</p> : null}
    </div>
  );
}

/** A group's writes: each with the standings it went through, its change in words, and why it was refused or dropped. */
function writesOf(g: LiveGroup) {
  if (g.writes.length === 0) return null;
  return (
    <ul class="lre-live-writes" aria-label="Writes">
      {g.writes.map((w) => (
        <li key={w.key} class="lre-live-write" data-lre-live-write={w.outcome}>
          <span>{w.history.map((o) => WRITE_OUTCOME_WORDS[o]).join(" → ")}</span>
          {w.changeType ? <span class="lre-live-dim"> · {w.changeType}</span> : null}
          {w.lines.length > 0 ? <span> · {w.lines.join("; ")}</span> : null}
          {w.outcome === "refused" ? <span class="lre-live-warn"> · {w.reason ?? w.code ?? ""}</span> : null}
          {w.outcome === "dropped" && w.why ? <span class="lre-live-dim"> · {DROP_WORDS[w.why]}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A group: its summary line (status, role, how it runs, tokens, time), then each agent's work and the run's writes. */
function groupOf(g: LiveGroup, view: LiveView, open: boolean, onToggle: (open: boolean) => void) {
  const spent = groupSpent(g);
  const via = g.run ? (g.run.via === "prompt_only" ? "prompt-only" : "agent") : null;
  const stage = g.run === null ? g.agents[0]?.start.stage : undefined;
  return (
    <li key={g.key} class="lre-live-item">
      <details class="lre-live-group" data-lre-live-group={g.role} data-status={g.status} open={open} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}>
        <summary class="lre-live-group-head">
          <Badge tone={STATUS_TONE[g.status]}>{STATUS_WORDS[g.status]}</Badge>
          <strong>{g.label}</strong>
          {stage ? <span>{stage}</span> : null}
          {via ? <span class="lre-live-dim">{via}</span> : null}
          {spent.in + spent.out > 0 ? <span class="lre-live-dim">{usageWords(spent)}</span> : null}
          <span class="lre-live-dim">+{seconds(g.at - view.startedAt)}</span>
        </summary>
        <div class="lre-live-group-body">
          {g.ran && !g.ran.ok ? <p class="lre-live-line lre-live-warn">{`Failed (${g.ran.code ?? "error"}): ${g.ran.reason ?? ""}`}</p> : null}
          {g.run && g.agents.length === 0 ? <p class="lre-live-line lre-live-dim">{g.run.via === "prompt_only" ? "Its classic step's one call, with no tools." : "Starting its agent…"}</p> : null}
          {g.agents.map((a) => agentBody(a, view.startedAt, a.start.role !== g.role, g.status !== "working"))}
          {writesOf(g)}
          {g.ran ? <p class="lre-live-line lre-live-dim">{`Ran ${g.ran.ok ? "and answered" : "and failed"} · ${usageWords(g.ran.usage)} · ${seconds(g.ran.ms)}`}</p> : null}
        </div>
      </details>
    </li>
  );
}

/** A mark between groups; the final review's says how it ended, with each edit it made to the narrator's prompt. */
function markOf(item: Extract<LiveItem, { type: "mark" }>) {
  const e = item.entry;
  if (e.kind === "review") {
    const failed = e.outcome === "unrevised" || e.outcome === "stopped";
    return (
      <li key={`mark-${e.seq}`} class={`lre-live-mark review${failed ? " failed" : ""}`} data-lre-live-mark="review" data-outcome={e.outcome}>
        <span>{`${REVIEW_OUTCOME_WORDS[e.outcome]}${e.reason ? `: ${e.reason}` : ""}`}</span>
        {e.edits.length > 0 ? (
          <ul class="lre-live-review" aria-label="The final review's edits">
            {e.edits.map((edit, i) => (
              <li key={i} data-lre-live-edit={edit.op}>
                {reviewEditWords(edit)}
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  const words = e.kind === "phase" ? PHASE_WORDS[e.phase] : e.kind === "failed" ? `The turn stopped at ${e.step}: ${e.reason}` : e.kind === "wait" ? "Waiting on you at a gate" : "Resumed";
  return (
    <li key={`mark-${e.seq}`} class={`lre-live-mark${e.kind === "failed" ? " failed" : ""}`} data-lre-live-mark={e.kind}>
      {words}
    </li>
  );
}

export interface LiveFeedProps {
  /** The chat's live view; null when it has had no agent run since the engine started. */
  view: LiveView | null;
  /** The view couldn't be read. */
  failed: boolean;
  /** The role whose work shows; null for every agent's. */
  role: string | null;
  /** The turn can be stopped now (the activity line's Cancel). */
  cancellable: boolean;
  busy: boolean;
  /** The time now (epoch ms), for a running turn's elapsed time. */
  now: number;
  /** Whether a group shows open: its own choice, else `open`, the default. */
  open(key: string, open: boolean): boolean;
  onToggle(key: string, open: boolean): void;
  onRole(role: string | null): void;
  onCancel(): void;
  onRetry(): void;
}

/** The feed: the run's header (what it answers, how it stands, Cancel), the role filter, then its groups and marks in order. */
export function LiveFeed(props: LiveFeedProps) {
  const { view } = props;
  if (props.failed)
    return (
      <Empty
        icon="alert"
        title="The live view didn't load"
        action={
          <Button size="sm" icon="refresh" onClick={props.onRetry}>
            Try again
          </Button>
        }
      >
        The engine didn't answer with this chat's live view.
      </Empty>
    );
  if (view === null)
    return (
      <Empty icon="pulse" title="No agent turn yet">
        Live shows an agent turn as its agents work it: every agent's messages, reasoning, tool calls and results, and the writes they stage. Nothing has run in this chat since the engine started. Each turn's transcript stays in Workspace, under transcripts/, for as long as Settings → Agents → Retention keeps it (every one, by default).
      </Empty>
    );
  const items = liveItems(view);
  const roles = [...new Set(items.flatMap((i) => (i.type === "group" ? [i.role] : [])))];
  const shown = items.filter((i) => i.type === "mark" || props.role === null || i.role === props.role);
  const spent = items.reduce((sum, i) => (i.type === "group" ? { in: sum.in + groupSpent(i).in, out: sum.out + groupSpent(i).out } : sum), { in: 0, out: 0 });
  const running = view.ended === null;
  const state = running ? `Running · ${elapsedText(props.now - view.startedAt)}` : `${END_WORDS[view.ended?.state ?? "done"].replace(/^./, (c) => c.toUpperCase())} after ${seconds((view.ended?.at ?? view.startedAt) - view.startedAt)}`;
  const lastGroup = [...shown].reverse().find((i) => i.type === "group");
  return (
    <div class="lre-live" data-lre-live={running ? "running" : (view.ended?.state ?? "done")}>
      <div class="lre-live-head">
        <p class="lre-live-title">
          <strong>{KIND_WORDS[view.kind]}</strong> <span class="lre-live-dim">{view.pipeline === "main" ? "worked by a main agent" : "on the fixed pipeline"}</span>
        </p>
        {view.text.trim() !== "" ? <p class="lre-live-said">“{view.text}”</p> : null}
        <p class="lre-live-state" role="status" aria-live="polite">
          {running ? <span class="lre-chat-pulse" aria-hidden="true" /> : null}
          <span>{state}</span>
          {view.ended?.reason ? <span class="lre-live-warn"> · {view.ended.reason}</span> : null}
          {spent.in + spent.out > 0 ? <span class="lre-live-dim"> · {usageWords(spent)}</span> : null}
        </p>
        {running && props.cancellable ? (
          <Button size="sm" variant="danger" icon="close" disabled={props.busy} onClick={props.onCancel}>
            Cancel the turn
          </Button>
        ) : null}
      </div>
      <Seg<string> label="Show the work of" value={props.role ?? "all"} options={[{ value: "all", label: "Every agent" }, ...roles.map((r) => ({ value: r, label: agentLabel(r) }))]} onChange={(v) => props.onRole(v === "all" ? null : v)} />
      <ol class="lre-live-feed" aria-label="What the agents did">
        {shown.map((item) => (item.type === "mark" ? markOf(item) : groupOf(item, view, props.open(item.key, item.status === "working" || item.status === "failed" || item === lastGroup), (open) => props.onToggle(item.key, open))))}
      </ol>
    </div>
  );
}

/** GM → Live: the chat's live view, asked for when the tab shows, kept current by its pushes, following the newest unless you've scrolled up. */
export function LiveSection(props: GmSectionProps) {
  const app = useApp();
  const [view, setView] = useState<LiveView | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [role, setRole] = useState<string | null>(null);
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const [following, setFollowing] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busy, run] = useBusy();
  const held = useRef<LiveView | null | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const activity = useSelect(app.sync, (state) => state.activity);
  const cancellable = activity?.state === "running" && activity.cancellable === true && activity.chatId === props.chatId;
  const controls = liveControls(props.chatId, (body) => app.request<"lre.live">(body));
  const keep = (next: LiveView | null | undefined): void => {
    held.current = next;
    setView(next);
  };
  useEffect(() => {
    let live = true;
    setFailed(false);
    const ask = (): void => {
      void controls.get().then((answer) => {
        if (!live) return;
        if (answer === undefined) {
          setFailed(held.current === undefined);
          return;
        }
        const now = held.current;
        // A push may have brought the run further meanwhile: the answer stands unless it holds less of the same run.
        if (!now || !answer || now.turn !== answer.turn || answer.entries.length >= now.entries.length) keep(answer);
      });
    };
    const off = app.client.onLive((update) => {
      if (update.chatId !== props.chatId) return;
      const next = followLive(held.current ?? null, update);
      if (next === "resync") ask();
      else {
        if (held.current?.turn !== next.turn) setToggled({});
        keep(next);
      }
    });
    ask();
    return () => {
      live = false;
      off();
      void controls.leave();
    };
  }, [props.chatId, tries]);
  // Another chat is another run: nothing filtered or folded carries over.
  useEffect(() => {
    keep(undefined);
    setRole(null);
    setToggled({});
  }, [props.chatId]);
  // A running turn's time, each second.
  const running = view !== undefined && view !== null && view.ended === null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // Following the newest: at the foot of the page while you haven't scrolled up from it.
  useEffect(() => {
    const scroller = root.current ? scrollParent(root.current) : null;
    if (!scroller) return;
    const heard = (): void => setFollowing(Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight);
    scroller.addEventListener("scroll", heard, { passive: true });
    return () => scroller.removeEventListener("scroll", heard);
  }, [view === undefined]);
  const count = view?.entries.length ?? 0;
  useLayoutEffect(() => {
    const scroller = following && root.current ? scrollParent(root.current) : null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [count, following]);
  return (
    <div ref={root} class="lre-live-tab" data-lre-gm-section="live">
      {view === undefined && !failed ? (
        <Empty icon="hourglass">Loading the live view…</Empty>
      ) : (
        <LiveFeed
          view={view ?? null}
          failed={failed}
          role={role}
          cancellable={cancellable}
          busy={busy || props.busy}
          now={now}
          open={(key, open) => toggled[key] ?? open}
          onToggle={(key, open) => setToggled((t) => (t[key] === open ? t : { ...t, [key]: open }))}
          onRole={setRole}
          onCancel={() => run(() => cancelTurn(props.chatId, (body) => app.request<"lre.cancel">(body)))}
          onRetry={() => setTries((t) => t + 1)}
        />
      )}
      {!following && running ? (
        <div class="lre-live-follow">
          <Button size="sm" icon="chevron-down" onClick={() => setFollowing(true)}>
            Follow the newest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
