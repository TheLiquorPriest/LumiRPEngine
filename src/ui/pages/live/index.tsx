// Live (plan §14): watch what runs in a chat as it runs. Every run of the chat that is going on is on the
// page at once, each by its own id (a turn, and a job that began beside it): its head (what it is, how it
// stands, what it has spent) and Stop, what went to the chat as it streams, and behind the spoiler gate
// its intent record and the tree of its agents, each with its model calls, tool calls and results, its
// `todo` list and the rules that fired. Nothing an agent did is left out of the tree. With nothing
// running it shows the last runs, as they ended; the runs it keeps are a setting, and one let go is named
// with a link to its Turn page. A turn whose limit on wall time was held for want of a keep-alive line
// says so in the notices file's words.

import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { useSelect } from "../../store";
import { useApp, useNow } from "../../app";
import { replyOf } from "../../client";
import { Banner, Button, Empty, Gated, PageHeader, Pre, Section } from "../../atoms";
import { type Follow, useFollowNewest } from "../../live-follow";
import { type RunNode, shownRuns, stopOf } from "../../live-model";
import { type FailureShown, type LetGo, NOTHING_WATCHED, watchChat, type Watched } from "../../live-watch";
import { FailureLines } from "./failures";
import { type NoticeLines, useNoticeLines } from "../../notice-words";
import { AgentTree, ReplyBox, RunHead, runTitle, STATUS_WORDS } from "../../trace-view";
import type { PageEntry } from "../../page-entry";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords } from "../../words";

/** A Stop pressed on the Live page: the chat and the run (by RPH's own id for it) it was pressed for, and why it did not go through, in RPE's words, once that is known. */
export interface StopPress {
  chat: string;
  run: string;
  problem: string | null;
}

export interface LiveViewProps {
  chat: string;
  /** The runs to show, in order: those going on first (`shownRuns`). */
  runs: readonly RunNode[];
  /** The runs the page let go, the one let go first first. */
  letGo: readonly LetGo[];
  /** The handler failures told to this chat that have not been dismissed, oldest first. */
  failures?: readonly FailureShown[];
  /** How many events the hub dropped for this page because it fell behind; 0 when it did not. */
  behind: number;
  loading: boolean;
  problem: string | null;
  now: number;
  gateOpen: boolean;
  /** The Stops pressed on the page: each counts only for its run, in its chat, while that run goes on. */
  stops: readonly StopPress[];
  onStop(run: RunNode): void;
  onOpenGate(): void;
  onCloseGate(): void;
  onDismiss?(seq: number): void;
  onOpenTurn(turn: string): void;
  /** The notices file's words, for the records of the tree that are notices (a turn held to under ten minutes for want of a keep-alive line). */
  notices?: NoticeLines;
  /** Keeping a long tree in reach (`useFollowNewest`), and the view's root it moves the page by; a plain draw has neither. */
  follow?: Follow;
  root?: RefObject<HTMLDivElement | null>;
}

/** One run: its head and Stop, and what it sent to the chat. */
function RunBlock(props: { chat: string; run: RunNode; now: number; stops: readonly StopPress[]; onStop(run: RunNode): void; onOpenTurn(turn: string): void }) {
  const { run } = props;
  const running = run.outcome === null;
  const pressed = props.stops.find((s) => s.chat === props.chat && s.run === run.run);
  const stop = running && pressed !== undefined ? pressed : null;
  const stopping = stop !== null && stop.problem === null;
  const turn = run.turn;
  return (
    <div class="lre-stack" data-run-block={run.run}>
      <Section
        id={`run-${run.run}`}
        title={running ? "Running now" : "Ended"}
        actions={
          <span class="lre-inline">
            {running && stopOf(run) !== null ? (
              <Button kind="danger" small busy={stopping} onClick={() => props.onStop(run)}>
                {stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : null}
            {turn === null ? null : (
              <Button small kind="ghost" onClick={() => props.onOpenTurn(turn)}>
                Its page
              </Button>
            )}
          </span>
        }
      >
        {stop?.problem == null ? null : (
          <Banner tone="neg" icon="alert" title="Stop did not go through">
            <span>{stop.problem}</span>
          </Banner>
        )}
        <RunHead run={run} now={props.now} />
      </Section>
      <Section id={`reply-${run.run}`} title="What went to the chat">
        <ReplyBox run={run} />
      </Section>
    </div>
  );
}

/** The runs the page let go, each named, with the link to its Turn page where it has one. */
function LetGoList(props: { letGo: readonly LetGo[]; onOpenTurn(turn: string): void }) {
  return (
    <Banner tone="info" icon="info" title="Earlier runs let go from this page">
      <ul class="rpe-reports">
        {[...props.letGo].reverse().map((gone) => {
          const turn = gone.turn;
          return (
            <li key={gone.run} data-let-go={gone.run}>
              {runTitle(gone)}
              {gone.status === null ? "" : `: ${STATUS_WORDS[gone.status].words.toLowerCase()}`}{" "}
              {turn === null ? null : (
                <Button small kind="ghost" onClick={() => props.onOpenTurn(turn)}>
                  Its page
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Banner>
  );
}

export function LiveView(props: LiveViewProps) {
  const { runs } = props;
  const going = runs.some((run) => run.outcome === null);
  const turns = [...new Set(runs.flatMap((run) => (run.turn === null ? [] : [run.turn])))];
  const follow = props.follow;
  return (
    <div class="lre-stack rpe-page" data-page="live" ref={props.root} tabIndex={-1}>
      <PageHeader title="Live" sub="Watch what runs in this chat as it runs." />
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Part of this chat could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      <FailureLines failures={props.failures ?? []} onOpenTurn={props.onOpenTurn} onDismiss={(seq) => props.onDismiss?.(seq)} />
      {props.behind === 0 ? null : (
        <Banner
          tone="warn"
          icon="alert"
          title="This view fell behind and was cut off"
          actions={turns.map((turn) => (
            <Button key={turn} onClick={() => props.onOpenTurn(turn)}>
              {turns.length === 1 ? "Open its Turn page" : `Turn page of ${turn}`}
            </Button>
          ))}
        >
          <span>{counted(props.behind, "event")} were not sent to it because it could not keep up. It read what it needed again; the Turn page holds all of it.</span>
        </Banner>
      )}
      {runs.length === 0 ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading this chat's turns…</p>
        ) : props.problem === null ? (
          <Empty icon="pulse" title="No turn has run on RPE in this chat yet">
            <span>When one starts, it shows here as it runs.</span>
          </Empty>
        ) : null
      ) : (
        <>
          {runs.map((run) => (
            <RunBlock key={run.run} chat={props.chat} run={run} now={props.now} stops={props.stops} onStop={props.onStop} onOpenTurn={props.onOpenTurn} />
          ))}
          {props.letGo.length === 0 ? null : <LetGoList letGo={props.letGo} onOpenTurn={props.onOpenTurn} />}
          <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
            {follow === undefined || !going || !follow.scrollable || follow.atBottom ? null : (
              <div class="lre-spread">
                <span class="rpe-meta">New records are below.</span>
                <Button small onClick={follow.toNewest}>
                  Follow the newest
                </Button>
              </div>
            )}
            {runs.map((run) => (
              <div key={run.run} class="lre-stack" data-run-tree={run.run}>
                {runs.length < 2 ? null : <p class="rpe-caption">{runTitle(run)}</p>}
                {run.intent === null ? null : (
                  <Section id={`intent-${run.run}`} title="Intent record">
                    <Pre text={run.intent} mono={false} />
                  </Section>
                )}
                <Section id={`agents-${run.run}`} title="The agents">
                  <AgentTree run={run} now={props.now} notices={props.notices} />
                </Section>
              </div>
            ))}
            {follow === undefined || !follow.scrollable ? null : (
              <div>
                <Button small kind="ghost" onClick={() => follow.toFirst("details.rpe-agent")}>
                  Back to top
                </Button>
              </div>
            )}
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
  const [stops, setStops] = useState<readonly StopPress[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const notices = useNoticeLines(chat);
  // What the watch is held to is read when it is used, so a setting changed meanwhile holds at once.
  const limits = useRef({ renderMs: 0, keepRuns: 0, keepFailures: 0 });
  limits.current = { renderMs: useUiSetting("redrawMs"), keepRuns: useUiSetting("keepRuns"), keepFailures: useUiSetting("keepFailures") };
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setWatched(NOTHING_WATCHED);
    setStops([]);
    setDismissed(new Set());
    return watchChat(app.client, chat, app.timers, setWatched, () => limits.current);
  }, [chat]);
  const runs = shownRuns(watched.model);
  const now = useNow(runs.some((run) => run.outcome === null));
  const follow = useFollowNewest(root, watched);

  const pressStop = (run: RunNode): void => {
    const target = stopOf(run);
    if (target === null) return;
    const press: StopPress = { chat, run: run.run, problem: null };
    setStops((held) => [...held.filter((s) => s.run !== run.run), press]);
    // RPE's answer counts only while this press is the page's own: not once the page has left the chat, or Stop was pressed again.
    const answered = (next: StopPress | null): void => setStops((held) => held.flatMap((s) => (s !== press ? [s] : next === null ? [] : [next])));
    const failed = (error: unknown): void => answered({ ...press, problem: errorWords(error) });
    if ("turn" in target) {
      app.client.call("POST /api/v1/chats/:chat/turns/:turn/stop", { chat, turn: target.turn }).then(replyOf).then((answer) => {
        if (!answer.stopped) answered(null);
      }, failed);
    } else app.client.call("POST /api/v1/jobs/:job/cancel", { job: target.job }).then(undefined, failed);
  };

  return (
    <LiveView
      chat={chat}
      runs={runs}
      letGo={watched.letGo}
      failures={watched.failures.filter((failure) => !dismissed.has(failure.seq))}
      onDismiss={(seq) => setDismissed((held) => new Set([...held, seq]))}
      behind={watched.behind}
      loading={watched.loading}
      problem={watched.problem}
      now={Math.max(now, ...runs.map((run) => run.lastAt ?? 0))}
      gateOpen={gateOpen}
      stops={stops}
      notices={notices}
      onStop={pressStop}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onOpenTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })}
      follow={follow}
      root={root}
    />
  );
}

export const entry: PageEntry = { id: "live", title: "Live", icon: "pulse", shells: ["web", "drawer"], needsChat: true, often: true, order: 20, render: (route) => <LivePage chat={route.chat} /> };
