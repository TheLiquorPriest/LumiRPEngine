// A chat's turns, and one turn (plan §14, Turn): its timings and token counts, each of its runs by its
// own id (a continue runs a turn again) and what each sent to the chat, and behind the spoiler gate its
// intent record, the trace of each run, what each agent's first call was sent, and the turn's folder,
// each file opened on demand; kept up to date while it runs. The Turn page is a list of sections
// (`TURN_SECTIONS`): what later lanes add (the prompt by slice, the changes in each lane, perceptions)
// are sections of their own in that list, behind the gate or not as each says. Both pages offer Settle
// now, the Turn page on the newest turn of the chat's path, which is the turn the settle route takes:
// the Author settles an edit then, and nothing is written to the chat.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import { isRecord } from "../../shared/json";
import type { SettleAnswer, TurnDetail, TurnFileEntry, TurnRun, TurnSummary } from "../api";
import { useApp, useNow } from "../app";
import { replyOf, type RpeClient } from "../client";
import { Badge, Banner, Button, Empty, Gated, PageHeader, Pre, Row, Section } from "../atoms";
import { agentUsage, type RunNode, runsOf } from "../live-model";
import { NOTHING_WATCHED, onChatChange, watchTurn, type Watched } from "../live-watch";
import { AgentTree, ReplyBox, replyErrorWords, RunHead, runTitle, statusWords, TURN_KIND_WORDS } from "../trace-view";
import { liveTurn, momentsOf, spansOf } from "../turn-model";
import { bytesWords, clock, counted, duration, errorWords, tokenWords, when } from "../words";
import { type JobsReader, type JobsShown, JobsView, NO_JOBS, readJobs } from "./jobs";

/** Fixed: how many turns the list reads at a time. */
export const TURNS_PAGE = 30;

function TurnLine(props: { turn: TurnSummary; onOpen: () => void }) {
  const { turn } = props;
  const status = statusWords(turn.kind, turn.status);
  const end = turn.timings.ended ?? turn.timings.released;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-turn={turn.id}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">
              {TURN_KIND_WORDS[turn.kind]} · {when(turn.timings.received)}
            </span>
            <span class="lre-listrow-sub lre-num">
              {end === null ? "" : `${duration(end - turn.timings.received)} · `}
              {counted(turn.usage.calls, "call")} · {tokenWords(turn.usage)}
            </span>
          </span>
          <span class="lre-inline">
            {turn.onPath ? null : <Badge>off the path</Badge>}
            <Badge tone={status.tone}>{status.words}</Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

/** Settle now as a page holds it: a request out, the run it began, or RPE's refusal in its own words. */
export interface SettleShown {
  busy: boolean;
  started: SettleAnswer | null;
  problem: string | null;
}

export const NO_SETTLE: SettleShown = { busy: false, started: null, problem: null };

/** Asks RPE to settle the newest turn of the chat's path now; `onChange` hears the request go out and what came of it. */
export function settleNow(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: SettleShown) => void): void {
  onChange({ busy: true, started: null, problem: null });
  client.call("POST /api/v1/chats/:chat/settle", { chat }).then(
    (started) => onChange({ busy: false, started, problem: null }),
    (error: unknown) => onChange({ busy: false, started: null, problem: errorWords(error) }),
  );
}

/**
 * The newest turn on the chat's path, the one Settle now settles; null where the list holds none. The list is newest run first, and
 * after a swipe back to an earlier swipe its first turns are off the path: it is read a page at a time past them.
 */
export async function newestOnPath(client: Pick<RpeClient, "call">, chat: string): Promise<TurnSummary | null> {
  let before: string | undefined;
  for (;;) {
    const list = replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: TURNS_PAGE, ...(before === undefined ? {} : { before }) } }));
    const found = list.turns.find((t) => t.onPath);
    if (found !== undefined) return found;
    before = list.turns.at(-1)?.id;
    if (!list.more || before === undefined) return null;
  }
}

/** Settle now: the button, disabled while a run of the chat goes on, and what came of the last press. */
export function SettleControl(props: { shown: SettleShown; running: boolean; onSettle(): void }) {
  return (
    <Button small busy={props.shown.busy} disabled={props.running} title={props.running ? "A run of this chat is going on." : "The Author settles the newest turn's edit now; nothing is written to the chat."} onClick={props.onSettle}>
      Settle now
    </Button>
  );
}

/** What came of the last Settle now: the run it began, or RPE's refusal in its own words. */
export function SettleNotice(props: { shown: SettleShown; onOpen?(turn: string): void }) {
  const { started, problem } = props.shown;
  if (problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="Not settled">
        <span>{problem}</span>
      </Banner>
    );
  }
  if (started === null) return null;
  const open = props.onOpen;
  return (
    <Banner tone="info" icon="check" title="A settle run began" actions={open === undefined ? undefined : <Button onClick={() => open(started.turn)}>Watch it</Button>}>
      <span>
        Run {started.run} on turn {started.turn}. It writes nothing to the chat.
      </span>
    </Banner>
  );
}

export interface TurnsViewProps {
  turns: readonly TurnSummary[];
  more: boolean;
  loading: boolean;
  problem: string | null;
  /** How many turns of this chat the last migration carried from today's build; null where it carried none, or that is not known. */
  carried?: number | null;
  settle?: { shown: SettleShown; onSettle(): void };
  /** The chat's jobs, with Cancel. */
  jobs?: { shown: JobsShown; onCancel(job: string): void };
  onOpen(turn: string): void;
  onMore(): void;
}

export function TurnsView(props: TurnsViewProps) {
  const { settle } = props;
  const running = props.turns.some((turn) => turn.status === "running");
  const carried = props.carried ?? null;
  return (
    <div class="lre-stack rpe-page" data-page="turns">
      <PageHeader title="Turns" sub="Every turn RPE has played in this chat, newest first." actions={settle === undefined || (props.turns.length === 0 && carried === null) ? undefined : <SettleControl shown={settle.shown} running={running} onSettle={settle.onSettle} />} />
      {settle === undefined ? null : <SettleNotice shown={settle.shown} onOpen={props.onOpen} />}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The turns could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.turns.length === 0 ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading this chat's turns…</p>
        ) : props.problem === null ? (
          <Empty icon="list" title="No turn played on RPE yet">
            <span>A turn shows here once RPE plays a reply in this chat.</span>
            {carried === null ? null : <span>The migration carried {counted(carried, "turn")} of it from today's build: they made its world, cast and story as they stand, and are not runs of RPE's, so none is listed here.</span>}
          </Empty>
        ) : null
      ) : (
        <div class="lre-section flush">
          <ul class="lre-section-body lre-rowlist rpe-turns">
            {props.turns.map((turn) => (
              <TurnLine key={turn.id} turn={turn} onOpen={() => props.onOpen(turn.id)} />
            ))}
          </ul>
        </div>
      )}
      {props.more ? (
        <Button busy={props.loading} onClick={props.onMore}>
          Older turns
        </Button>
      ) : null}
      {props.jobs === undefined ? null : <JobsView shown={props.jobs.shown} everyChat={false} onCancel={props.jobs.onCancel} />}
    </div>
  );
}

/** A chat's turns as read so far, newest first. */
export interface TurnsRead {
  turns: TurnSummary[];
  /** Older turns remain to be read. */
  more: boolean;
  loading: boolean;
  problem: string | null;
}

/**
 * The newest page of a chat's turns put in front of those held: a turn run again since moves up, and what was read further back
 * stays. A page that does not reach back to the turns held (more turns came meanwhile than a page holds) leaves a gap between
 * them, so it stands alone, and older turns are read from it.
 */
export function withNewest(held: TurnsRead, page: { turns: readonly TurnSummary[]; more: boolean }): Pick<TurnsRead, "turns" | "more"> {
  const oldest = page.turns.at(-1);
  const reached = oldest === undefined ? -1 : held.turns.findIndex((t) => t.id === oldest.id);
  if (!page.more || reached < 0) return { turns: [...page.turns], more: page.more };
  const fresh = new Set(page.turns.map((t) => t.id));
  const tail = held.turns.slice(reached + 1).filter((t) => !fresh.has(t.id));
  return { turns: [...page.turns, ...tail], more: tail.length === 0 ? page.more : held.more };
}

/**
 * Reads a chat's turns, newest first, older ones on `more()`, and the newest again on `refresh()`, merged in front of those held
 * (`withNewest`) so the list never empties while it reads. Every answer is for this chat alone: once `stop()` is called (the page
 * has left the chat), what comes back is let go.
 */
export function readTurns(client: Pick<RpeClient, "call">, chat: string, onChange: (read: TurnsRead) => void): { more(): void; refresh(): void; stop(): void } {
  let read: TurnsRead = { turns: [], more: false, loading: true, problem: null };
  let alive = true;
  const show = (next: Partial<TurnsRead>): void => {
    if (!alive) return;
    read = { ...read, ...next };
    onChange(read);
  };
  const page = async (before: string | undefined) => replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: TURNS_PAGE, ...(before === undefined ? {} : { before }) } }));
  /** `first`: the first read, the one `loading` waits for before any turn is held. */
  const newest = (first: boolean): void => {
    page(undefined).then(
      (list) => show({ ...withNewest(read, list), problem: null, ...(first ? { loading: false } : {}) }),
      (error: unknown) => show({ problem: errorWords(error), ...(first ? { loading: false } : {}) }),
    );
  };
  // A page moving to this chat shows it as unread at once, not the last chat's turns.
  onChange(read);
  newest(true);
  return {
    more() {
      const last = read.turns.at(-1);
      if (read.loading || last === undefined) return;
      show({ loading: true, problem: null });
      page(last.id).then(
        (list) => {
          // A refresh may have come back meanwhile: the older turns go after whatever is held now.
          const held = new Set(read.turns.map((t) => t.id));
          show({ turns: [...read.turns, ...list.turns.filter((t) => !held.has(t.id))], more: list.more, loading: false, problem: null });
        },
        (error: unknown) => show({ loading: false, problem: errorWords(error) }),
      );
    },
    refresh() {
      newest(false);
    },
    stop() {
      alive = false;
    },
  };
}

export function TurnsPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [read, setRead] = useState<TurnsRead>({ turns: [], more: false, loading: true, problem: null });
  const [settle, setSettle] = useState<SettleShown>(NO_SETTLE);
  const [carried, setCarried] = useState<number | null>(null);
  const reader = useRef<{ more(): void } | null>(null);
  const [jobs, setJobs] = useState<JobsShown>(NO_JOBS);
  const jobsReader = useRef<JobsReader | null>(null);
  useEffect(() => {
    setSettle(NO_SETTLE);
    setJobs(NO_JOBS);
    const reading = readTurns(app.client, chat, setRead);
    reader.current = reading;
    const jobsReading = readJobs(app.client, chat, setJobs);
    jobsReader.current = jobsReading;
    // A run that begins or ends changes the list, whether Settle now can be pressed, and how the chat's jobs stand: they are read again then.
    const off = onChatChange(app.client, chat, () => {
      reading.refresh();
      jobsReading.refresh();
    });
    return () => {
      off();
      reading.stop();
      jobsReading.stop();
    };
  }, [chat]);
  const none = !read.loading && read.problem === null && read.turns.length === 0;
  useEffect(() => {
    setCarried(null);
    if (!none) return;
    // A chat with no run of RPE's yet may have come with a migration: what it carried of it is said, not "no turns".
    let alive = true;
    app.client.call("GET /api/v1/migration", {}).then(
      (shown) => {
        const turns = shown.chats.find((c) => c.chat === chat && (c.outcome === "imported" || c.outcome === "replaced"))?.turns ?? 0;
        if (alive) setCarried(turns > 0 ? turns : null);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [chat, none]);
  return (
    <TurnsView
      {...read}
      carried={carried}
      settle={{ shown: settle, onSettle: () => settleNow(app.client, chat, setSettle) }}
      jobs={{ shown: jobs, onCancel: (job) => jobsReader.current?.cancel(job) }}
      onOpen={(turn) => app.go({ page: "turn", chat, turn })}
      onMore={() => reader.current?.more()}
    />
  );
}

// ---------------------------------------------------------------- one turn's folder

/**
 * A turn's folder as the page has read it: its entries as RPE lists them (null until read), why the
 * list could not be read, and the file open, with its text once read or RPE's reason it gave none.
 */
export interface FolderShown {
  files: TurnFileEntry[] | null;
  problem: string | null;
  open: { name: string; text: string | null; problem: string | null } | null;
}

export const NO_FOLDER: FolderShown = { files: null, problem: null, open: null };

/**
 * Reads a turn's folder: its list at once, and a file each time one is opened, by its path below the
 * folder. Only the file open now is shown: the answer for one opened before it is let go, and so is all
 * that comes back once `stop()` is called (the page has left the turn, or shut the spoiler gate).
 */
export function readFolder(client: Pick<RpeClient, "call">, chat: string, turn: string, onChange: (folder: FolderShown) => void): { open(name: string): void; close(): void; stop(): void } {
  let shown = NO_FOLDER;
  let alive = true;
  const show = (next: FolderShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  client.call("GET /api/v1/chats/:chat/turns/:turn/files", { chat, turn }).then(replyOf).then(
    (list) => show({ ...shown, files: list.files, problem: null }),
    (error: unknown) => show({ ...shown, problem: errorWords(error) }),
  );
  return {
    open(name) {
      const opening = { name, text: null, problem: null };
      show({ ...shown, open: opening });
      const answered = (open: FolderShown["open"]): void => {
        if (shown.open === opening) show({ ...shown, open });
      };
      client.call("GET /api/v1/chats/:chat/turns/:turn/files/*", { chat, turn, "*": name }).then(replyOf).then(
        (file) => answered({ name, text: file.text, problem: null }),
        (error: unknown) => answered({ name, text: null, problem: errorWords(error) }),
      );
    },
    close() {
      show({ ...shown, open: null });
    },
    stop() {
      alive = false;
    },
  };
}

/** The messages of a model call's request as the harness keeps it (`{"messages":[{"role","text"}]}`), in order; null for a file that is not one. */
export function requestMessages(text: string): { role: string; text: string }[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.messages)) return null;
  const messages: { role: string; text: string }[] = [];
  for (const m of data.messages) {
    if (!isRecord(m) || typeof m.role !== "string" || typeof m.text !== "string") return null;
    messages.push({ role: m.role, text: m.text });
  }
  return messages;
}

// ---------------------------------------------------------------- one turn

/** What a part of the Turn page is drawn from: the turn as last read, its runs as the page holds them (the first first), now, and its folder. */
export interface TurnParts {
  turn: TurnDetail;
  runs: readonly RunNode[];
  now: number;
  folder: FolderShown;
  onOpenFile(name: string): void;
  onCloseFile(): void;
}

/** One part of the Turn page: its title, whether it sits behind the spoiler gate, and its body (null when the turn has nothing for it). */
export interface TurnSection {
  id: string;
  title: string;
  spoiler: boolean;
  body(parts: TurnParts): ComponentChildren | null;
}

/** A turn's runs that began, in order. The page's runs are made of the records each run wrote, so the one it numbers n is the nth of these. */
function begun(views: readonly TurnRun[]): TurnRun[] {
  return views.filter((view) => view.timings.started !== null);
}

/** Which run a part is of, where the turn has run more than once (a continue runs it again under an id of its own). */
function RunCaption(props: { nth: number; of: number; id: string | null; title: string }) {
  if (props.of < 2) return null;
  return (
    <p class="rpe-caption">
      Run {props.nth} of {props.of}
      {props.id === null ? "" : `, ${props.id}`}: {props.title}
    </p>
  );
}

/** Each run's own part, under its caption where there are several. */
function EachRun(props: { runs: readonly RunNode[]; views: readonly TurnRun[]; part: (run: RunNode, view: TurnRun | undefined) => ComponentChildren }) {
  const started = begun(props.views);
  const of = Math.max(props.views.length, props.runs.length);
  return (
    <div class="lre-stack">
      {props.runs.map((run) => {
        const view = started[run.nth - 1];
        return (
          <div key={run.nth} class="lre-stack" data-run-nth={run.nth}>
            <RunCaption nth={view?.nth ?? run.nth} of={of} id={view?.id ?? null} title={view?.kind === "settle" ? TURN_KIND_WORDS.settle : runTitle(run)} />
            {props.part(run, view)}
          </div>
        );
      })}
    </div>
  );
}

function Timings(props: { turn: TurnDetail }) {
  const moments = momentsOf(props.turn.timings);
  const spans = spansOf(props.turn.timings);
  return (
    <div class="lre-stack">
      {props.turn.runs.length > 1 ? <p class="rpe-meta">Of its latest run.</p> : null}
      <div>
        {moments.map((m) => (
          <Row key={m.label} label={m.label} value={<span class="lre-num">{clock(m.at)}</span>} sub={m.since === null ? undefined : `${duration(m.since)} after the moment before`} />
        ))}
      </div>
      {spans.length === 0 ? null : (
        <div class="rpe-stats" aria-label="Where the time went">
          {spans.map((s) => (
            <span key={s.label}>
              {s.label}: <strong class="lre-num">{duration(s.ms)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the turn spent, all its runs together, and each run's own where there are several. */
function Tokens(props: { turn: TurnDetail }) {
  const { usage, runs } = props.turn;
  return (
    <div>
      {runs.length > 1 ? <p class="rpe-meta">All its runs together; each run's own is below.</p> : null}
      <Row label="Model calls" value={<span class="lre-num">{usage.calls}</span>} />
      <Row label="Tokens sent" value={<span class="lre-num">{usage.input.toLocaleString("en")}</span>} sub={`${usage.cacheRead.toLocaleString("en")} read from the provider's cache, ${usage.cacheWrite.toLocaleString("en")} written to it`} />
      <Row label="Tokens written" value={<span class="lre-num">{usage.output.toLocaleString("en")}</span>} sub={usage.reasoning === undefined ? undefined : `${usage.reasoning.toLocaleString("en")} of them reasoning`} />
      {runs.length > 1 ? runs.map((run) => <Row key={run.id} label={`Run ${run.nth}, ${run.id}`} value={<span class="lre-num">{counted(run.usage.calls, "call")}</span>} sub={tokenWords(run.usage)} />) : null}
    </div>
  );
}

/** Each run of a turn run more than once, by its own id: how it went, and what it sent to the chat (the latest's is below, as it streams). */
function Runs(props: { views: readonly TurnRun[]; runs: readonly RunNode[]; now: number }) {
  const started = begun(props.views);
  const latest = props.views.at(-1);
  return (
    <div class="lre-stack">
      {props.views.map((view) => {
        const at = started.indexOf(view);
        const run = at < 0 ? undefined : props.runs.find((r) => r.nth === at + 1);
        const status = statusWords(view.kind, view.status);
        return (
          <div key={view.id} class="lre-stack" data-run={view.id}>
            <RunCaption nth={view.nth} of={props.views.length} id={view.id} title={run === undefined || view.kind === "settle" ? TURN_KIND_WORDS[view.kind] : runTitle(run)} />
            {run === undefined ? (
              <span class="lre-inline">
                <Badge tone={status.tone}>{status.words}</Badge>
              </span>
            ) : (
              <RunHead run={run} now={props.now} kind={view.kind} />
            )}
            {view === latest ? null : view.reply.text === "" ? <p class="rpe-meta">It sent nothing to the chat.</p> : <Pre text={view.reply.text} mono={false} />}
          </div>
        );
      })}
    </div>
  );
}

function TokensByAgent(props: { run: RunNode }) {
  const agents = [...props.run.agents.values()];
  if (agents.length === 0) return <p class="lre-muted rpe-line">No agent has begun work.</p>;
  return (
    <div>
      {agents.map((agent) => {
        const usage = agentUsage(agent);
        return <Row key={agent.ref.id} label={agent.ref.plays === undefined ? agent.ref.definition : `${agent.ref.definition}, playing ${agent.ref.plays}`} value={<span class="lre-num">{counted(usage.calls, "call")}</span>} sub={tokenWords(usage)} />;
      })}
    </div>
  );
}

/** What a run's lead was given, by the names it began work with. */
function Given(props: { run: RunNode }) {
  const lead = props.run.roots[0];
  const info = lead === undefined ? null : (props.run.agents.get(lead)?.info ?? null);
  if (info === null) return <p class="lre-muted rpe-line">Its lead has not begun work.</p>;
  return <p class="rpe-line">{info.given.length === 0 ? `${info.definition} was given nothing by name.` : `${info.definition} was given: ${info.given.join(", ")}.`}</p>;
}

/** What each agent of a run was sent on its first model call, where the harness kept it: a file of the turn's folder each, opened on demand. */
function FirstCalls(props: { view: TurnRun | undefined; onOpenFile(name: string): void }) {
  const first = new Map<string, TurnRun["requests"][number]>();
  for (const request of props.view?.requests ?? []) {
    const held = first.get(request.agent);
    if (held === undefined || request.call < held.call) first.set(request.agent, request);
  }
  if (first.size === 0) return null;
  return (
    <div class="lre-stack" data-first-calls>
      <span class="rpe-caption">What each agent was sent first</span>
      <div class="rpe-files">
        {[...first.values()].map((r) => (
          <Button key={r.agent} small kind="ghost" onClick={() => props.onOpenFile(r.file)}>
            {`${r.definition} (${r.agent}), call ${r.call}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The lore of the turn's prompt, by id, as its intake kept it: what Lumiverse activated for it, and what its lore map showed the Author. */
function TurnLore(props: { lore: TurnDetail["lore"] }) {
  const { activated, map } = props.lore;
  return (
    <div class="lre-stack" data-lore>
      <span class="rpe-caption">Its lore, by id</span>
      <p class="rpe-line">
        Lumiverse activated for its prompt: {activated.length === 0 ? "no entry." : <span class="lre-id">{activated.join(", ")}</span>}
      </p>
      <p class="rpe-line">
        Its lore map showed the Author: {map.length === 0 ? "no entry." : <span class="lre-id">{map.join(", ")}</span>}
      </p>
    </div>
  );
}

/** The file open: a kept request laid out as its messages, any other file as its text. */
function OpenFile(props: { open: FolderShown["open"]; onClose(): void }) {
  const { open } = props;
  if (open === null) return null;
  const messages = open.text === null ? null : requestMessages(open.text);
  return (
    <div class="lre-stack" data-file={open.name}>
      <div class="lre-spread">
        <code class="lre-id">{open.name}</code>
        <Button small kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {open.problem !== null ? (
        <Banner tone="neg" icon="alert" title="The file could not be read">
          <span>{open.problem}</span>
        </Banner>
      ) : open.text === null ? (
        <p class="lre-muted rpe-line">Reading the file…</p>
      ) : messages === null ? (
        <Pre text={open.text} />
      ) : (
        messages.map((m, i) => (
          <div key={i} class="lre-stack">
            <span class="rpe-caption">{m.role}</span>
            <Pre text={m.text} mono={false} />
          </div>
        ))
      )}
    </div>
  );
}

/** The turn's folder as RPE lists it, each file opened here on demand: its world state, its briefing with the lore map, the prompt and the rest. */
function Folder(props: { folder: FolderShown; onOpenFile(name: string): void; onCloseFile(): void }) {
  const { files, problem, open } = props.folder;
  const shown = (files ?? []).filter((f) => !f.folder);
  return (
    <div class="lre-stack" data-folder>
      <span class="rpe-caption">The turn's folder</span>
      {problem !== null ? (
        <Banner tone="neg" icon="alert" title="The turn's folder could not be read">
          <span>{problem}</span>
        </Banner>
      ) : files === null ? (
        <p class="lre-muted rpe-line">Reading the turn's folder…</p>
      ) : shown.length === 0 ? (
        <p class="rpe-meta">RPE lists no file in it.</p>
      ) : (
        <ul class="rpe-files">
          {shown.map((f) => (
            <li key={f.name}>
              <Button small kind="ghost" current={open?.name === f.name} onClick={() => props.onOpenFile(f.name)}>
                {f.name}
              </Button>
              <span class="rpe-meta lre-num">{bytesWords(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      <OpenFile open={open} onClose={props.onCloseFile} />
    </div>
  );
}

/** The Turn page's sections, in order. */
export const TURN_SECTIONS: readonly TurnSection[] = [
  { id: "timings", title: "Timings", spoiler: false, body: ({ turn }) => <Timings turn={turn} /> },
  { id: "tokens", title: "Tokens", spoiler: false, body: ({ turn }) => <Tokens turn={turn} /> },
  { id: "runs", title: "Its runs", spoiler: false, body: ({ turn, runs, now }) => (turn.runs.length < 2 ? null : <Runs views={turn.runs} runs={runs} now={now} />) },
  { id: "reply", title: "What went to the chat", spoiler: false, body: ({ runs }) => runs.slice(-1).map((latest) => <ReplyBox key={latest.nth} run={latest} />) },
  {
    id: "given",
    title: "What the Author was given",
    spoiler: true,
    body: ({ turn, runs, folder, onOpenFile, onCloseFile }) => (
      <div class="lre-stack">
        <EachRun
          runs={runs}
          views={turn.runs}
          part={(run, view) => (
            <>
              <Given run={run} />
              <FirstCalls view={view} onOpenFile={onOpenFile} />
            </>
          )}
        />
        <TurnLore lore={turn.lore} />
        <Folder folder={folder} onOpenFile={onOpenFile} onCloseFile={onCloseFile} />
      </div>
    ),
  },
  { id: "intent", title: "Intent record", spoiler: true, body: ({ turn }) => (turn.intent === null ? null : <Pre text={turn.intent} mono={false} />) },
  { id: "agent-tokens", title: "Tokens by agent", spoiler: true, body: ({ turn, runs }) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} views={turn.runs} part={(run) => <TokensByAgent run={run} />} /> : null) },
  { id: "trace", title: "The run, step by step", spoiler: true, body: ({ turn, runs, now }) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} views={turn.runs} part={(run) => <AgentTree run={run} now={now} />} /> : null) },
];

function SectionsOf(props: { parts: TurnParts; sections: readonly TurnSection[] }) {
  return (
    <>
      {props.sections.map((section) => {
        const body = section.body(props.parts);
        return body === null ? null : (
          <Section key={section.id} id={section.id} title={section.title}>
            {body}
          </Section>
        );
      })}
    </>
  );
}

export interface TurnViewProps {
  turn: TurnDetail;
  /** Its runs, the first first: more than one when it was continued. */
  runs: readonly RunNode[];
  now: number;
  /** What a later read could not read, in RPE's words; null when all was. */
  problem: string | null;
  gateOpen: boolean;
  /** The turn's folder, read once the spoiler gate is open. */
  folder: FolderShown;
  onOpenGate(): void;
  onCloseGate(): void;
  onBack(): void;
  onLive(): void;
  onRead(): void;
  onOpenFile(name: string): void;
  onCloseFile(): void;
  sections?: readonly TurnSection[];
  /** Settle now, where this turn is the newest on the chat's path: what came of the last press, and whether a run of the chat goes on. */
  settle?: { shown: SettleShown; running: boolean; onSettle(): void };
}

export function TurnView(props: TurnViewProps) {
  const { turn, settle } = props;
  const sections = props.sections ?? TURN_SECTIONS;
  // How it stands is its latest run's: a settle run's ending with no reply is how it is meant to end.
  const kind = turn.runs.at(-1)?.kind ?? turn.kind;
  const status = statusWords(kind, turn.status);
  const failure = turn.error === null || (kind === "settle" && turn.status === "no-reply") ? null : replyErrorWords(turn.error, turn.status);
  const parts: TurnParts = { turn, runs: props.runs, now: props.now, folder: props.folder, onOpenFile: props.onOpenFile, onCloseFile: props.onCloseFile };
  return (
    <div class="lre-stack rpe-page" data-page="turn" data-turn={turn.id}>
      <PageHeader
        title={`${TURN_KIND_WORDS[turn.kind]}, ${when(turn.timings.received)}`}
        sub={
          <span class="lre-inline">
            <span class={`lre-badge ${status.tone}`}>{status.words}</span>
            {turn.onPath ? null : <span class="lre-badge">off the path</span>}
            {turn.message !== null ? <span class="lre-id">message {turn.message}</span> : turn.status === "running" || turn.timings.released !== null ? <span>not tied to a message yet</span> : <span>no message</span>}
          </span>
        }
        back={{ label: "Back to the turns", go: props.onBack }}
        actions={
          <>
            {settle === undefined ? null : <SettleControl shown={settle.shown} running={settle.running} onSettle={settle.onSettle} />}
            {turn.status === "running" ? (
              <Button small onClick={props.onLive}>
                Watch it live
              </Button>
            ) : (
              <Button small kind="ghost" onClick={props.onRead}>
                Read again
              </Button>
            )}
          </>
        }
      />
      {settle === undefined ? null : <SettleNotice shown={settle.shown} />}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Part of this turn could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {failure === null ? null : (
        <Banner tone="neg" icon="alert" title="Why it ended">
          <span>{failure}</span>
        </Banner>
      )}
      <SectionsOf parts={parts} sections={sections.filter((s) => !s.spoiler)} />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
        <SectionsOf parts={parts} sections={sections.filter((s) => s.spoiler)} />
      </Gated>
    </div>
  );
}

/** One turn, kept up to date while it runs, and while a continue runs it again; its folder is read once the spoiler gate is open. */
export function TurnPage(props: { chat: string; turn: string }) {
  const app = useApp();
  const { chat, turn } = props;
  const [watched, setWatched] = useState<Watched>(NOTHING_WATCHED);
  const [reads, setReads] = useState(0);
  const [folder, setFolder] = useState<FolderShown>(NO_FOLDER);
  const reader = useRef<{ open(name: string): void; close(): void } | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const [newest, setNewest] = useState<TurnSummary | null>(null);
  const [settle, setSettle] = useState<SettleShown>(NO_SETTLE);
  useEffect(() => {
    setWatched(NOTHING_WATCHED);
    return watchTurn(app.client, chat, turn, app.timers, setWatched);
  }, [chat, turn, reads]);
  useEffect(() => {
    setSettle(NO_SETTLE);
    setNewest(null);
    // Which turn is the newest on the chat's path, and whether a run of it goes on: Settle now is offered on that turn alone. Read again when a run begins or ends.
    let alive = true;
    const read = (): void => {
      newestOnPath(app.client, chat).then(
        (found) => {
          if (alive) setNewest(found);
        },
        () => undefined,
      );
    };
    read();
    const off = onChatChange(app.client, chat, read);
    return () => {
      alive = false;
      off();
    };
  }, [chat, turn]);
  useEffect(() => {
    setFolder(NO_FOLDER);
    if (!gateOpen) return;
    const reading = readFolder(app.client, chat, turn, setFolder);
    reader.current = reading;
    return () => {
      reading.stop();
      reader.current = null;
    };
  }, [chat, turn, reads, gateOpen]);
  const runs = runsOf(watched.model, turn);
  const latest = runs.at(-1);
  const detail = watched.detail === null ? null : liveTurn(watched.detail, latest);
  const now = useNow(detail?.status === "running");
  const back = (): void => app.go({ page: "turns", chat });
  if (detail === null) {
    return (
      <div class="lre-stack rpe-page" data-page="turn">
        <PageHeader title="Turn" back={{ label: "Back to the turns", go: back }} />
        {watched.problem === null ? (
          <p class="lre-muted rpe-line">Reading the turn…</p>
        ) : (
          <Banner tone="neg" icon="alert" title="The turn could not be read" actions={<Button onClick={() => setReads((n) => n + 1)}>Try again</Button>}>
            <span>{watched.problem}</span>
          </Banner>
        )}
      </div>
    );
  }
  return (
    <TurnView
      turn={detail}
      runs={runs}
      now={Math.max(now, latest?.lastAt ?? 0)}
      problem={watched.problem}
      gateOpen={gateOpen}
      folder={folder}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onBack={back}
      onLive={() => app.go({ page: "live", chat })}
      onRead={() => setReads((n) => n + 1)}
      onOpenFile={(name) => reader.current?.open(name)}
      onCloseFile={() => reader.current?.close()}
      settle={
        newest?.id !== turn
          ? undefined
          : {
              shown: settle,
              running: newest.status === "running",
              onSettle: () =>
                settleNow(app.client, chat, (shown) => {
                  setSettle(shown);
                  // The settle run is the turn's latest run: the page reads the turn again to follow it.
                  if (shown.started !== null) setReads((n) => n + 1);
                }),
            }
      }
    />
  );
}
