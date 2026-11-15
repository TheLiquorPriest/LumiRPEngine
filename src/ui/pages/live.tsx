// Live (plan §14): watch a turn as it runs. The turn's head (what it is, how it stands, what it has
// spent so far) and Stop; what went to the chat, as it streams; and behind the spoiler gate, the intent
// record and the tree of agents, each with its model calls, tool calls and results, its `todo` list and
// the rules that fired. Nothing an agent did is left out of the tree. With no turn running, it shows the
// last one, as it ended.

import { useEffect, useState } from "preact/hooks";
import { useSelect } from "../store";
import { useApp, useNow } from "../app";
import { replyOf } from "../client";
import { Banner, Button, Empty, Gated, PageHeader, Pre, Section } from "../atoms";
import { latestRun, type RunNode } from "../live-model";
import { NOTHING_WATCHED, watchChat, type Watched } from "../live-watch";
import { AgentTree, ReplyBox, RunHead } from "../trace-view";
import { errorWords } from "../words";

/**
 * A Stop pressed on the Live page: the chat and the run it was pressed for (by RPH's own id for it), and
 * why it did not go through, in RPE's words, once that is known. What is stopped is the run's turn.
 */
export interface StopPress {
  chat: string;
  run: string;
  nth: number;
  problem: string | null;
}

export interface LiveViewProps {
  chat: string;
  run: RunNode | null;
  loading: boolean;
  problem: string | null;
  now: number;
  gateOpen: boolean;
  /** The last Stop pressed on the page: it counts only for the run it was pressed for, in its chat, while that run goes on. */
  stop: StopPress | null;
  onStop(): void;
  onOpenGate(): void;
  onCloseGate(): void;
  onOpenTurn(): void;
}

export function LiveView(props: LiveViewProps) {
  const { run } = props;
  const running = run !== null && run.outcome === null;
  const pressed = props.stop;
  const stop = running && pressed !== null && pressed.chat === props.chat && pressed.run === run.run && pressed.nth === run.nth ? pressed : null;
  const stopping = stop !== null && stop.problem === null;
  return (
    <div class="lre-stack rpe-page" data-page="live">
      <PageHeader title="Live" sub="Watch a turn as it runs." />
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Part of this chat could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {run === null ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading this chat's turns…</p>
        ) : props.problem === null ? (
          <Empty icon="pulse" title="No turn has run on RPE in this chat yet">
            <span>When one starts, it shows here as it runs.</span>
          </Empty>
        ) : null
      ) : (
        <>
          <Section
            id="run"
            title={running ? "Running now" : "The last turn"}
            actions={
              running ? (
                <Button kind="danger" small busy={stopping} onClick={props.onStop}>
                  {stopping ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button small kind="ghost" onClick={props.onOpenTurn}>
                  Its page
                </Button>
              )
            }
          >
            {stop?.problem == null ? null : (
              <Banner tone="neg" icon="alert" title="Stop did not go through">
                <span>{stop.problem}</span>
              </Banner>
            )}
            <RunHead run={run} now={props.now} />
          </Section>
          <Section id="reply" title="What went to the chat">
            <ReplyBox run={run} />
          </Section>
          <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
            {run.intent === null ? null : (
              <Section id="intent" title="Intent record">
                <Pre text={run.intent} mono={false} />
              </Section>
            )}
            <Section id="agents" title="The agents">
              <AgentTree run={run} now={props.now} />
            </Section>
          </Gated>
        </>
      )}
    </div>
  );
}

export function LivePage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [watched, setWatched] = useState<Watched>(NOTHING_WATCHED);
  const [stop, setStop] = useState<StopPress | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setWatched(NOTHING_WATCHED);
    setStop(null);
    return watchChat(app.client, chat, app.timers, setWatched);
  }, [chat]);
  const run = latestRun(watched.model);
  const now = useNow(run !== null && run.outcome === null);

  const pressStop = (): void => {
    if (run === null || run.turn === null) return;
    const press: StopPress = { chat, run: run.run, nth: run.nth, problem: null };
    setStop(press);
    // RPE's answer counts only while this press is the page's own: not once it has left the chat, or Stop was pressed again.
    const answered = (next: StopPress | null): void => setStop((held) => (held === press ? next : held));
    app.client.call("POST /api/v1/chats/:chat/turns/:turn/stop", { chat, turn: run.turn }).then(replyOf).then(
      (answer) => {
        if (!answer.stopped) answered(null);
      },
      (error: unknown) => answered({ ...press, problem: errorWords(error) }),
    );
  };

  return (
    <LiveView
      chat={chat}
      run={run}
      loading={watched.loading}
      problem={watched.problem}
      now={Math.max(now, run?.lastAt ?? 0)}
      gateOpen={gateOpen}
      stop={stop}
      onStop={pressStop}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onOpenTurn={() => {
        if (run?.turn != null) app.go({ page: "turn", chat, turn: run.turn });
      }}
    />
  );
}
