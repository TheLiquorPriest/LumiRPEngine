// A chat's turns, and one turn (plan §14, Turn): its timings and token counts, what went to the chat,
// and behind the spoiler gate its intent record and the trace of its run. The Turn page is a list of
// sections (`TURN_SECTIONS`): what later lanes add (the prompt by slice, the changes in each lane,
// perceptions) are sections of their own in that list, behind the gate or not as each says.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import type { TurnDetail, TurnSummary } from "../api";
import { useApp, useNow } from "../app";
import { Badge, Banner, Button, Empty, Gated, PageHeader, Pre, Row, Section } from "../atoms";
import { agentUsage, type RunNode, runOf } from "../live-model";
import { AgentTree, ReplyBox, replyErrorWords, STATUS_WORDS, TURN_KIND_WORDS } from "../trace-view";
import { momentsOf, spansOf } from "../turn-model";
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

/** One part of the Turn page: its title, whether it sits behind the spoiler gate, and its body for a turn (null when the turn has nothing for it). */
export interface TurnSection {
  id: string;
  title: string;
  spoiler: boolean;
  body(turn: TurnDetail, run: RunNode, now: number): ComponentChildren | null;
}

function Timings(props: { turn: TurnDetail }) {
  const moments = momentsOf(props.turn.timings);
  const spans = spansOf(props.turn.timings);
  return (
    <div class="lre-stack">
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

function Tokens(props: { turn: TurnDetail }) {
  const { usage } = props.turn;
  return (
    <div>
      <Row label="Model calls" value={<span class="lre-num">{usage.calls}</span>} />
      <Row label="Tokens sent" value={<span class="lre-num">{usage.input.toLocaleString("en")}</span>} sub={`${usage.cacheRead.toLocaleString("en")} read from the provider's cache, ${usage.cacheWrite.toLocaleString("en")} written to it`} />
      <Row label="Tokens written" value={<span class="lre-num">{usage.output.toLocaleString("en")}</span>} sub={usage.reasoning === undefined ? undefined : `${usage.reasoning.toLocaleString("en")} of them reasoning`} />
    </div>
  );
}

function TokensByAgent(props: { run: RunNode }) {
  const agents = [...props.run.agents.values()];
  if (agents.length === 0) return null;
  return (
    <div>
      {agents.map((agent) => {
        const usage = agentUsage(agent);
        return <Row key={agent.ref.id} label={agent.ref.plays === undefined ? agent.ref.definition : `${agent.ref.definition}, playing ${agent.ref.plays}`} value={<span class="lre-num">{counted(usage.calls, "call")}</span>} sub={tokenWords(usage)} />;
      })}
    </div>
  );
}

/** The Turn page's sections, in order. */
export const TURN_SECTIONS: readonly TurnSection[] = [
  { id: "timings", title: "Timings", spoiler: false, body: (turn) => <Timings turn={turn} /> },
  { id: "tokens", title: "Tokens", spoiler: false, body: (turn) => <Tokens turn={turn} /> },
  { id: "reply", title: "What went to the chat", spoiler: false, body: (_turn, run) => <ReplyBox run={run} /> },
  { id: "intent", title: "Intent record", spoiler: true, body: (turn) => (turn.intent === null ? null : <Pre text={turn.intent} mono={false} />) },
  { id: "agent-tokens", title: "Tokens by agent", spoiler: true, body: (_turn, run) => (run.agents.size === 0 ? null : <TokensByAgent run={run} />) },
  { id: "trace", title: "The run, step by step", spoiler: true, body: (_turn, run, now) => (run.agents.size === 0 ? null : <AgentTree run={run} now={now} />) },
];

function SectionsOf(props: { turn: TurnDetail; run: RunNode; now: number; sections: readonly TurnSection[] }) {
  return (
    <>
      {props.sections.map((section) => {
        const body = section.body(props.turn, props.run, props.now);
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
  run: RunNode;
  now: number;
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
      {failure === null ? null : (
        <Banner tone="neg" icon="alert" title="Why it ended">
          <span>{failure}</span>
        </Banner>
      )}
      <SectionsOf turn={turn} run={props.run} now={props.now} sections={sections.filter((s) => !s.spoiler)} />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
        <SectionsOf turn={turn} run={props.run} now={props.now} sections={sections.filter((s) => s.spoiler)} />
      </Gated>
    </div>
  );
}

export function TurnPage(props: { chat: string; turn: string }) {
  const app = useApp();
  const { chat, turn } = props;
  const [state, setState] = useState<{ detail: TurnDetail | null; problem: string | null; reads: number }>({ detail: null, problem: null, reads: 0 });
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const now = useNow(state.detail?.status === "running");
  useEffect(() => {
    let alive = true;
    app.client.call("GET /api/v1/chats/:chat/turns/:turn", { chat, turn }).then(
      (detail) => {
        if (alive) setState((s) => ({ ...s, detail, problem: null }));
      },
      (error: unknown) => {
        if (alive) setState((s) => ({ ...s, problem: errorWords(error) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [chat, turn, state.reads]);
  const back = (): void => app.go({ page: "turns", chat });
  if (state.detail === null) {
    return (
      <div class="lre-stack rpe-page" data-page="turn">
        <PageHeader title="Turn" back={{ label: "Back to the turns", go: back }} />
        {state.problem === null ? (
          <p class="lre-muted rpe-line">Reading the turn…</p>
        ) : (
          <Banner tone="neg" icon="alert" title="The turn could not be read" actions={<Button onClick={() => setState((s) => ({ ...s, reads: s.reads + 1 }))}>Try again</Button>}>
            <span>{state.problem}</span>
          </Banner>
        )}
      </div>
    );
  }
  return (
    <TurnView
      turn={state.detail}
      run={runOf(state.detail)}
      now={now}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onBack={back}
      onLive={() => app.go({ page: "live", chat })}
      onRead={() => setState((s) => ({ ...s, reads: s.reads + 1 }))}
    />
  );
}
