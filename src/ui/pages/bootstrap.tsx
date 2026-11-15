// The bootstrap (plan §12) as the pages offer it. On a chat's Story page: the six facts of "done
// enough" as the route gives them, each with its counts, or "not known" in the page's words for why;
// no verdict on any of them, since whether the record is done enough is the bootstrap skill's to say;
// the chat's bootstrap jobs with how each stands; and a button that starts one, with the player's choice
// of how much of the past to relive passed through as said. On the Migration page: the same start for
// every chat the migration carried, with which started and which were refused, and why. Nothing starts
// by itself.

import type { BootstrapBatchReply, BootstrapChatReply, DoneEnoughShown, FactNotKnown, JobView, MessageStretch } from "../../shared/api";
import { Badge, Banner, Button, Pre, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { counted, errorWords, num, tokenWords, when } from "../words";
import { JOB_STATE_WORDS } from "./jobs";

/** How much of the past the player may choose to relive, as plan §12 words them; the route passes the word through to the job. */
export const RELIVE_WORDS = ["outline", "key moments", "all"] as const;

/** The player's choice: one of the words, or none (the bootstrap skill decides). */
export type Relive = (typeof RELIVE_WORDS)[number] | null;

/** A chat's bootstrap as the page holds it: the route's answer, whether a start is out, and what could not be read or was refused. */
export interface BootstrapShown {
  chat: BootstrapChatReply | null;
  loading: boolean;
  problem: string | null;
  starting: boolean;
  started: JobView | null;
  refused: string | null;
}

export const NO_BOOTSTRAP: BootstrapShown = { chat: null, loading: true, problem: null, starting: false, started: null, refused: null };

export interface BootstrapReader {
  start(relive: Relive): void;
  refresh(): void;
  stop(): void;
}

/** Reads a chat's six facts and its bootstrap jobs; starts one and reads again. What comes back once `stop()` is called is let go. */
export function readBootstrap(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: BootstrapShown) => void): BootstrapReader {
  let shown = NO_BOOTSTRAP;
  let alive = true;
  const show = (next: Partial<BootstrapShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const read = (): void => {
    client.call("GET /api/v1/chats/:chat/bootstrap", { chat }).then(
      (answer) => show({ chat: answer, loading: false, problem: null }),
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  read();
  return {
    start(relive) {
      if (shown.starting) return;
      show({ starting: true, started: null, refused: null });
      client.call("POST /api/v1/chats/:chat/bootstrap", { chat }, { body: relive === null ? {} : { relive } }).then(
        (started) => {
          show({ starting: false, started });
          read();
        },
        (error: unknown) => show({ starting: false, refused: errorWords(error) }),
      );
    },
    refresh: read,
    stop() {
      alive = false;
    },
  };
}

const stretch = (s: MessageStretch | null): string => (s === null ? "none" : `messages ${s.from} to ${s.to}`);

/** Why a fact is not known, in the page's words for each code the route gives. */
const NOT_KNOWN_WORDS: Record<FactNotKnown["why"], string> = {
  unreadable: "Its records could not be read; RPE's log says what failed.",
};

/** Each fact's title and its numbers, in the skill's order. */
function factLines(facts: DoneEnoughShown): { id: keyof DoneEnoughShown; title: string; fact: DoneEnoughShown[keyof DoneEnoughShown]; lines: () => string[] }[] {
  const { lore, history, cast, story, horizon, principals } = facts;
  return [
    { id: "lore", title: "The lore index", fact: lore, lines: () => (lore.known ? [`${num(lore.entries)} entries, ${num(lore.indexed)} indexed as they stand, ${num(lore.stale)} indexed at an earlier revision`] : []) },
    {
      id: "history",
      title: "The history the window leaves out",
      fact: history,
      lines: () =>
        history.known
          ? [
              `${num(history.messages)} messages; the window leaves out ${num(history.leftOut)}, of which the record covers ${num(history.covered)}`,
              `${counted(history.stretches, "covered stretch", "covered stretches")}, ${num(history.summarized)} with their summary`,
              `Nearest not covered: ${stretch(history.nearestUncovered)}; nearest with beats and no summary: ${stretch(history.nearestUnsummarized)}`,
            ]
          : [],
    },
    { id: "cast", title: "The cast", fact: cast, lines: () => (cast.known ? [`${counted(cast.listed, "character")}, ${num(cast.cast)} cast`, ...(cast.uncast.length === 0 ? [] : [`Not cast: ${cast.uncast.join(", ")}`])] : []) },
    {
      id: "story",
      title: "The story model",
      fact: story,
      lines: () =>
        story.known
          ? [
              `${counted(story.premise, "premise")}, ${counted(story.chapters, "chapter")}, ${counted(story.scenes, "scene")}, ${counted(story.beats, "beat")}`,
              `${counted(story.threads, "thread")} (${num(story.openThreads)} open), ${counted(story.arcs, "arc")}, ${counted(story.player, "reading of the player", "readings of the player")}`,
              `${num(story.principalsWithArc)} of ${counted(story.principals, "principal")} with an arc`,
            ]
          : [],
    },
    { id: "horizon", title: "The horizon", fact: horizon, lines: () => (horizon.known ? [`${counted(horizon.entries, "entry", "entries")}, ${num(horizon.named)} naming a place or thing of the world; story time ${horizon.clock ? "kept" : "not kept"}`] : []) },
    {
      id: "principals",
      title: "Each principal's base and memories",
      fact: principals,
      lines: () => (principals.known ? (principals.principals.length === 0 ? ["No principal yet"] : principals.principals.map((p) => `${p.name}: base ${p.base.length === 0 ? "none written" : p.base.join(", ")}; ${counted(p.memories, "memory", "memories")}`)) : []),
    },
  ];
}

/** One job of the chat's bootstrap: how it stands, what it was given, what it spent, and its report once it ended. */
function JobLine(props: { job: BootstrapChatReply["jobs"][number] }) {
  const { job } = props;
  const view = job.view;
  const state = view === null ? null : JOB_STATE_WORDS[view.state];
  return (
    <li class="rpe-entry lre-stack" data-job={job.id}>
      <div class="lre-inline rpe-wrap">
        <span class="rpe-strong">{job.id}</span>
        {state === null ? <Badge>no longer held by the harness</Badge> : <Badge tone={state.tone}>{state.words}</Badge>}
      </div>
      <span class="rpe-meta">
        Relive: {job.relive ?? "as the skill decides"} · stops at {num(job.tokenLimit)} tokens sent and written
        {view === null ? "" : ` · started ${when(view.started)}${view.ended === undefined ? "" : `, ended ${when(view.ended)}`} · ${tokenWords(view.usage)}`}
      </span>
      {view?.limit === undefined ? null : (
        <span class="rpe-meta">
          Ended at its {view.limit.limit} limit per {view.limit.per}: {num(view.limit.value)} of {num(view.limit.max)}.
        </span>
      )}
      {view?.report === undefined ? null : <Pre text={view.report} mono={false} />}
    </li>
  );
}

/** The start, one button for each choice of how much to relive: the word goes to the route as said; the last leaves it to the skill. */
function StartWith(props: { busy: boolean; label: string; onStart(relive: Relive): void }) {
  return (
    <div class="lre-stack">
      <span class="rpe-caption">{props.label}, reliving</span>
      <div class="lre-inline rpe-wrap">
        {RELIVE_WORDS.map((word) => (
          <Button key={word} small busy={props.busy} onClick={() => props.onStart(word)}>
            {word}
          </Button>
        ))}
        <Button small kind="ghost" busy={props.busy} onClick={() => props.onStart(null)}>
          as the skill decides
        </Button>
      </div>
    </div>
  );
}

export interface BootstrapViewProps {
  shown: BootstrapShown;
  onStart(relive: Relive): void;
}

/** The chat's bootstrap: the six facts, its jobs, and the way to start one. */
export function BootstrapView(props: BootstrapViewProps) {
  const { shown } = props;
  const answer = shown.chat;
  return (
    <Section id="bootstrap" title="Bootstrap">
      <p class="rpe-meta">A job the Author leads, to build this chat's record from its past. The six facts say how far the record stands; nothing starts one but you.</p>
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The bootstrap could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.refused === null ? null : (
        <Banner tone="neg" icon="alert" title="Not started">
          <span>{shown.refused}</span>
        </Banner>
      )}
      {shown.started === null ? null : (
        <Banner tone="info" icon="check" title="A bootstrap job began">
          <span>
            Job {shown.started.id}, {JOB_STATE_WORDS[shown.started.state].words}.
          </span>
        </Banner>
      )}
      {answer === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the six facts…</p>
        ) : null
      ) : (
        <>
          <div class="lre-stack" data-facts="true">
            {factLines(answer.facts).map(({ id, title, fact, lines }) => (
              <div key={id} class="lre-stack" data-fact={id}>
                <Row label={title} value={fact.known ? null : <Badge>not known</Badge>} />
                {fact.known ? (
                  lines().map((line, i) => (
                    <p key={i} class="rpe-fact">
                      {line}
                    </p>
                  ))
                ) : (
                  <p class="rpe-fact">{NOT_KNOWN_WORDS[fact.why]}</p>
                )}
              </div>
            ))}
          </div>
          <span class="rpe-caption">Its jobs ({answer.jobs.length})</span>
          {answer.jobs.length === 0 ? (
            <p class="lre-muted rpe-line">No bootstrap job of this chat yet.</p>
          ) : (
            <ul class="lre-stack rpe-plain">
              {answer.jobs.map((job) => (
                <JobLine key={job.id} job={job} />
              ))}
            </ul>
          )}
        </>
      )}
      <StartWith busy={shown.starting} label="Start a bootstrap job" onStart={props.onStart} />
    </Section>
  );
}

/** The Migration page's offer: what the batch start answered, or why it could not be asked. */
export interface BatchShown {
  busy: boolean;
  answer: BootstrapBatchReply | null;
  problem: string | null;
}

export const NO_BATCH: BatchShown = { busy: false, answer: null, problem: null };

/** Starts the bootstrap for every chat the migration carried, one after another as the route does. */
export function startCarried(client: Pick<RpeClient, "call">, relive: Relive, onChange: (shown: BatchShown) => void): void {
  onChange({ busy: true, answer: null, problem: null });
  client.call("POST /api/v1/bootstrap", {}, { body: relive === null ? { chats: "migrated" } : { chats: "migrated", relive } }).then(
    (answer) => onChange({ busy: false, answer, problem: null }),
    (error: unknown) => onChange({ busy: false, answer: null, problem: errorWords(error) }),
  );
}

/** The offer on the Migration page, and which chats it started and which were refused, with why. */
export function BatchOffer(props: { shown: BatchShown; onStart(relive: Relive): void }) {
  const { answer, problem, busy } = props.shown;
  return (
    <Section id="bootstrap" title="Bootstrap the carried chats">
      <p class="rpe-meta">Starts a bootstrap job for every chat the migration carried, one after another; RPE runs as many at once as its jobs settings allow and queues the rest.</p>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not started">
          <span>{problem}</span>
        </Banner>
      )}
      {answer === null ? null : (
        <div class="lre-stack" data-batch="true">
          <span class="rpe-caption">Started ({answer.started.length})</span>
          {answer.started.map((s) => (
            <Row key={s.chat} label={s.chat} value={`job ${s.job.id}, ${JOB_STATE_WORDS[s.job.state].words}`} />
          ))}
          <span class="rpe-caption">Refused ({answer.refused.length})</span>
          {answer.refused.map((r) => (
            <Row key={r.chat} label={r.chat} value={r.why} />
          ))}
        </div>
      )}
      <StartWith busy={busy} label="Start for every carried chat" onStart={props.onStart} />
    </Section>
  );
}
