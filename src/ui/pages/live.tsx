// Live (plan §14): watch a turn as it runs. The turn's head (what it is, how it stands, what it has
// spent so far) and Stop; what went to the chat, as it streams; and behind the spoiler gate, the intent
// record and the tree of agents, each with its model calls, tool calls and results, its `todo` list and
// the rules that fired. Nothing an agent did is left out of the tree. With no turn running, it shows the
// last one, as it ended.

import { useEffect, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import { useApp, useNow } from "../app";
import { Banner, Button, Empty, Gated, PageHeader, Pre, Section } from "../atoms";
import { EMPTY_LIVE, latestRun, type RunNode } from "../live-model";
import { watchChat, type Watched } from "../live-watch";
import { AgentTree, ReplyBox, RunHead } from "../trace-view";
import { errorWords } from "../words";

export interface LiveViewProps {
  run: RunNode | null;
  loading: boolean;
  problem: string | null;
  now: number;
  gateOpen: boolean;
  /** Stop was pressed for this run and it has not ended yet. */
  stopping: boolean;
  onStop(): void;
  onOpenGate(): void;
  onCloseGate(): void;
  onOpenTurn(): void;
}

export function LiveView(props: LiveViewProps) {
  const { run } = props;
  const running = run !== null && run.outcome === null;
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
        ) : (
          <Empty icon="pulse" title="No turn has run in this chat yet">
            <span>When one starts, it shows here as it runs.</span>
          </Empty>
        )
      ) : (
        <>
          <Section
            id="run"
            title={running ? "Running now" : "The last turn"}
            actions={
              running ? (
                <Button kind="danger" small busy={props.stopping} onClick={props.onStop}>
                  {props.stopping ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button small kind="ghost" onClick={props.onOpenTurn}>
                  Its page
                </Button>
              )
            }
          >
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
  const [watched, setWatched] = useState<Watched>({ model: EMPTY_LIVE, loading: true, problem: null });
  const [stop, setStop] = useState<{ run: string; problem: string | null } | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setWatched({ model: EMPTY_LIVE, loading: true, problem: null });
    setStop(null);
    return watchChat(app.client, chat, app.timers, setWatched);
  }, [chat]);
  const run = latestRun(watched.model);
  const now = useNow(run !== null && run.outcome === null);

  const pressStop = (): void => {
    if (run === null) return;
    const turn = run.run;
    setStop({ run: turn, problem: null });
    app.client.call("POST /api/v1/chats/:chat/turns/:turn/stop", { chat, turn }).then(
      (answer) => {
        if (!answer.stopped) setStop(null);
      },
      (error: unknown) => setStop({ run: turn, problem: errorWords(error) }),
    );
  };

  return (
    <LiveView
      run={run}
      loading={watched.loading}
      problem={stop?.problem ?? watched.problem}
      now={Math.max(now, run?.lastAt ?? 0)}
      gateOpen={gateOpen}
      stopping={stop !== null && stop.problem === null && run !== null && stop.run === run.run && run.outcome === null}
      onStop={pressStop}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onOpenTurn={() => {
        if (run !== null) app.go({ page: "turn", chat, turn: run.run });
      }}
    />
  );
}
