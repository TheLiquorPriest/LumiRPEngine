// A chat's turns, and one turn (plan §14, Turn): its timings and token counts, what went to the chat,
// and behind the spoiler gate its intent record and the trace of each of its runs (a continue runs a
// turn again), kept up to date while it runs. The Turn page is a list of sections (`TURN_SECTIONS`):
// what later lanes add (the prompt by slice, the changes in each lane, perceptions) are sections of
// their own in that list, behind the gate or not as each says.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import { type TurnDetail, TURN_FOLDER, type TurnSummary } from "../api";
import { useApp, useNow } from "../app";
import { Badge, Banner, Button, Empty, Gated, PageHeader, Pre, Row, Section } from "../atoms";
import { addUsage, agentUsage, type RunNode, runsOf, runTotals } from "../live-model";
import { NOTHING_WATCHED, watchTurn, type Watched } from "../live-watch";
import { AgentTree, ReplyBox, replyErrorWords, RunHead, runTitle, STATUS_WORDS, TURN_KIND_WORDS } from "../trace-view";
import { liveTurn, momentsOf, spansOf } from "../turn-model";
import { clock, counted, duration, errorWords, tokenWords, when } from "../words";

/** Fixed: how many turns the list reads at a time. */
export const TURNS_PAGE = 30;

function TurnLine(props: { turn: TurnSummary; onOpen: () => void }) {
  const { turn } = props;
  const status = STATUS_WORDS[turn.status];
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

export interface TurnsViewProps {
  turns: readonly TurnSummary[];
  more: boolean;
  loading: boolean;
  problem: string | null;
  onOpen(turn: string): void;
  onMore(): void;
}

export function TurnsView(props: TurnsViewProps) {
  return (
    <div class="lre-stack rpe-page" data-page="turns">
      <PageHeader title="Turns" sub="Every turn of this chat, newest first." />
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The turns could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.turns.length === 0 ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading this chat's turns…</p>
        ) : (
          <Empty icon="list" title="No turns yet">
            <span>A turn shows here once RPE plays a reply in this chat.</span>
          </Empty>
        )
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
    </div>
  );
}

export function TurnsPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [state, setState] = useState<{ turns: TurnSummary[]; more: boolean; loading: boolean; problem: string | null }>({ turns: [], more: false, loading: true, problem: null });
  const load = (before: string | undefined, kept: TurnSummary[], alive: () => boolean = () => true): void => {
    setState({ turns: kept, more: false, loading: true, problem: null });
    app.client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: TURNS_PAGE, ...(before === undefined ? {} : { before }) } }).then(
      (list) => {
        if (alive()) setState({ turns: [...kept, ...list.turns], more: list.more, loading: false, problem: null });
      },
      (error: unknown) => {
        if (alive()) setState({ turns: kept, more: before !== undefined, loading: false, problem: errorWords(error) });
      },
    );
  };
  useEffect(() => {
    let alive = true;
    load(undefined, [], () => alive);
    return () => {
      alive = false;
    };
  }, [chat]);
  return <TurnsView {...state} onOpen={(turn) => app.go({ page: "turn", chat, turn })} onMore={() => load(state.turns.at(-1)?.id, state.turns)} />;
}

// ---------------------------------------------------------------- one turn

/**
 * One part of the Turn page: its title, whether it sits behind the spoiler gate, and its body for a turn
 * and its runs, the first first (null when the turn has nothing for it).
 */
export interface TurnSection {
  id: string;
  title: string;
  spoiler: boolean;
  body(turn: TurnDetail, runs: readonly RunNode[], now: number): ComponentChildren | null;
}

/** Which run a part is of, where the turn has run more than once (a continue runs it again). */
function RunCaption(props: { run: RunNode; of: number }) {
  if (props.of < 2) return null;
  return (
    <p class="rpe-caption">
      Run {props.run.nth} of {props.of}: {runTitle(props.run)}
    </p>
  );
}

/** Each run's own part, under its caption where there are several. */
function EachRun(props: { runs: readonly RunNode[]; part: (run: RunNode) => ComponentChildren }) {
  return (
    <div class="lre-stack">
      {props.runs.map((run) => (
        <div key={run.nth} class="lre-stack" data-run-nth={run.nth}>
          <RunCaption run={run} of={props.runs.length} />
          {props.part(run)}
        </div>
      ))}
    </div>
  );
}

function Timings(props: { turn: TurnDetail; runs: number }) {
  const moments = momentsOf(props.turn.timings);
  const spans = spansOf(props.turn.timings);
  return (
    <div class="lre-stack">
      {props.runs > 1 ? <p class="rpe-meta">Of its latest run.</p> : null}
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

function Tokens(props: { turn: TurnDetail; runs: readonly RunNode[] }) {
  const { usage } = props.turn;
  const all = props.runs.length > 1 ? props.runs.map((run) => runTotals(run).usage).reduce(addUsage) : null;
  return (
    <div>
      {all === null ? null : <p class="rpe-meta">Of its latest run; all its runs together are below.</p>}
      <Row label="Model calls" value={<span class="lre-num">{usage.calls}</span>} />
      <Row label="Tokens sent" value={<span class="lre-num">{usage.input.toLocaleString("en")}</span>} sub={`${usage.cacheRead.toLocaleString("en")} read from the provider's cache, ${usage.cacheWrite.toLocaleString("en")} written to it`} />
      <Row label="Tokens written" value={<span class="lre-num">{usage.output.toLocaleString("en")}</span>} sub={usage.reasoning === undefined ? undefined : `${usage.reasoning.toLocaleString("en")} of them reasoning`} />
      {all === null ? null : <Row label={`All ${props.runs.length} runs`} value={<span class="lre-num">{counted(all.calls, "call")}</span>} sub={tokenWords(all)} />}
    </div>
  );
}

/** Each run of a turn run more than once: how it went, and what it released. */
function Runs(props: { runs: readonly RunNode[]; now: number }) {
  const latest = props.runs.at(-1);
  return (
    <EachRun
      runs={props.runs}
      part={(run) => (
        <>
          <RunHead run={run} now={props.now} />
          {run === latest ? null : (
            <p class="rpe-meta">
              {run.released === null ? "It released no reply." : `It released ${counted(run.released.length, "character")}.`} What it sent to the chat is not shown: RPE's turn route gives the latest run's reply alone.
            </p>
          )}
        </>
      )}
    />
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

/** The turn's folder, by its files' names: none can be opened here, since no route serves them. */
function TurnFolder() {
  return (
    <div class="lre-stack" data-folder="unavailable">
      <span class="rpe-caption">The turn's folder</span>
      <p class="rpe-meta">Not available here yet: RPE has no route that lists a turn's folder or opens its files, so the words of its lore map, its world state and the rest cannot be read on this page.</p>
      <ul class="rpe-reports">
        {TURN_FOLDER.map((file) => (
          <li key={file.name}>
            <code class="lre-id">{file.name}</code>: {file.holds}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Turn page's sections, in order. */
export const TURN_SECTIONS: readonly TurnSection[] = [
  { id: "timings", title: "Timings", spoiler: false, body: (turn, runs) => <Timings turn={turn} runs={runs.length} /> },
  { id: "tokens", title: "Tokens", spoiler: false, body: (turn, runs) => <Tokens turn={turn} runs={runs} /> },
  { id: "runs", title: "Its runs", spoiler: false, body: (_turn, runs, now) => (runs.length < 2 ? null : <Runs runs={runs} now={now} />) },
  { id: "reply", title: "What went to the chat", spoiler: false, body: (_turn, runs) => runs.slice(-1).map((latest) => <ReplyBox key={latest.nth} run={latest} />) },
  {
    id: "given",
    title: "What the Author was given",
    spoiler: true,
    body: (turn, runs) => (
      <div class="lre-stack">
        <EachRun runs={runs} part={(run) => <Given run={run} />} />
        <TurnLore lore={turn.lore} />
        <TurnFolder />
      </div>
    ),
  },
  { id: "intent", title: "Intent record", spoiler: true, body: (turn) => (turn.intent === null ? null : <Pre text={turn.intent} mono={false} />) },
  { id: "agent-tokens", title: "Tokens by agent", spoiler: true, body: (_turn, runs) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} part={(run) => <TokensByAgent run={run} />} /> : null) },
  { id: "trace", title: "The run, step by step", spoiler: true, body: (_turn, runs, now) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} part={(run) => <AgentTree run={run} now={now} />} /> : null) },
];

function SectionsOf(props: { turn: TurnDetail; runs: readonly RunNode[]; now: number; sections: readonly TurnSection[] }) {
  return (
    <>
      {props.sections.map((section) => {
        const body = section.body(props.turn, props.runs, props.now);
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
  onOpenGate(): void;
  onCloseGate(): void;
  onBack(): void;
  onLive(): void;
  onRead(): void;
  sections?: readonly TurnSection[];
}

export function TurnView(props: TurnViewProps) {
  const { turn } = props;
  const sections = props.sections ?? TURN_SECTIONS;
  const status = STATUS_WORDS[turn.status];
  const failure = turn.error === null ? null : replyErrorWords(turn.error, turn.status);
  return (
    <div class="lre-stack rpe-page" data-page="turn" data-turn={turn.id}>
      <PageHeader
        title={`${TURN_KIND_WORDS[turn.kind]}, ${when(turn.timings.received)}`}
        sub={
          <span class="lre-inline">
            <span class={`lre-badge ${status.tone}`}>{status.words}</span>
            {turn.onPath ? null : <span class="lre-badge">off the path</span>}
            {turn.message === null ? <span>not tied to a message yet</span> : <span class="lre-id">message {turn.message}</span>}
          </span>
        }
        back={{ label: "Back to the turns", go: props.onBack }}
        actions={
          turn.status === "running" ? (
            <Button small onClick={props.onLive}>
              Watch it live
            </Button>
          ) : (
            <Button small kind="ghost" onClick={props.onRead}>
              Read again
            </Button>
          )
        }
      />
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
      <SectionsOf turn={turn} runs={props.runs} now={props.now} sections={sections.filter((s) => !s.spoiler)} />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
        <SectionsOf turn={turn} runs={props.runs} now={props.now} sections={sections.filter((s) => s.spoiler)} />
      </Gated>
    </div>
  );
}

/** One turn, kept up to date while it runs, and while a continue runs it again. */
export function TurnPage(props: { chat: string; turn: string }) {
  const app = useApp();
  const { chat, turn } = props;
  const [watched, setWatched] = useState<Watched>(NOTHING_WATCHED);
  const [reads, setReads] = useState(0);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setWatched(NOTHING_WATCHED);
    return watchTurn(app.client, chat, turn, app.timers, setWatched);
  }, [chat, turn, reads]);
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
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onBack={back}
      onLive={() => app.go({ page: "live", chat })}
      onRead={() => setReads((n) => n + 1)}
    />
  );
}
