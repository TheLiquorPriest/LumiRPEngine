// The bootstrap (plan §12) as the pages offer it. On a chat's Story page: the six facts of "done
// enough" as the route gives them, each with its counts, or "not known" in the page's words for why;
// no verdict on any of them, since whether the record is done enough is the bootstrap skill's to say;
// the start as it stands before any press (whether the skill is in force, the token limit at which a
// job asks him whether to go on and how it is counted, each cap that ends a bootstrap job's run, a limit
// of his own for this job, the relive words the skill offers, and the job already under way, beside
// which a second start asks him first); the question of each job that waits for his word, with what it
// spent and what it has done, and his two answers; and the chat's bootstrap jobs a page at a time,
// newest first, with a way to older ones. On the Migration page: every chat the migration carried, a
// page at a time, with how its bootstrap stands, its own start and its question; and the start for all
// of them, with which started and which were refused, and why. Nothing starts by itself, and nothing
// polls: the pages read again when the live view says a job changed.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { BootstrapBatchReply, BootstrapChatReply, BootstrapJobShown, BootstrapQuestion, BootstrapStartShown, CarriedBootstrap, DoneEnoughShown, FactNotKnown, JobView, MessageStretch } from "../../shared/api";
import { type UiApp, useApp } from "../app";
import { Badge, Banner, Button, Pre, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { counted, errorWords, num, tokenWords, when } from "../words";
import { JOB_STATE_WORDS } from "./jobs";
import { logAt } from "./runtime/logs";

/** What he asks of a start: how much to relive (null: as the skill decides), and his own token limit for the job (null: the setting's). */
export interface StartChoice {
  relive: string | null;
  tokenLimit: number | null;
}

/** His word to a job that asks: go on, asking again after `more` tokens (null: its limit again), or end with what it has. */
export type AnswerWord = { go: "on"; more: number | null } | { go: "end" };

/** A chat's bootstrap as the page holds it: the route's answer, its jobs read so far and where the next page starts, a start or an answer out, and what could not be read or was refused. */
export interface BootstrapShown {
  chat: BootstrapChatReply | null;
  jobs: BootstrapJobShown[];
  next: string | null;
  loading: boolean;
  problem: string | null;
  starting: boolean;
  started: JobView | null;
  refused: string | null;
  answering: string | null;
}

export const NO_BOOTSTRAP: BootstrapShown = { chat: null, jobs: [], next: null, loading: true, problem: null, starting: false, started: null, refused: null, answering: null };

export interface BootstrapReader {
  start(choice: StartChoice): void;
  answer(job: string, word: AnswerWord): void;
  older(): void;
  refresh(): void;
  stop(): void;
}

/** The body a start sends: only what he chose. */
function startBody(choice: StartChoice): { relive?: string; tokenLimit?: number } {
  return { ...(choice.relive === null ? {} : { relive: choice.relive }), ...(choice.tokenLimit === null ? {} : { tokenLimit: choice.tokenLimit }) };
}

/** The body an answer sends. */
function answerBody(word: AnswerWord): { go: "on"; more?: number } | { go: "end" } {
  return word.go === "end" ? { go: "end" } : { go: "on", ...(word.more === null ? {} : { more: word.more }) };
}

/** Reads a chat's bootstrap and the first page of its jobs; starts one, answers one, walks to older jobs, and reads again. What comes back once `stop()` is called is let go. */
export function readBootstrap(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: BootstrapShown) => void): BootstrapReader {
  let shown = NO_BOOTSTRAP;
  let alive = true;
  const show = (next: Partial<BootstrapShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const read = (): void => {
    Promise.all([client.call("GET /api/v1/chats/:chat/bootstrap", { chat }), client.call("GET /api/v1/chats/:chat/bootstrap/jobs", { chat }, { query: {} })]).then(
      ([answer, page]) => show({ chat: answer, jobs: page.items, next: page.next, loading: false, problem: null }),
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  read();
  return {
    start(choice) {
      if (shown.starting) return;
      show({ starting: true, started: null, refused: null });
      client.call("POST /api/v1/chats/:chat/bootstrap", { chat }, { body: startBody(choice) }).then(
        (started) => {
          show({ starting: false, started });
          read();
        },
        (error: unknown) => show({ starting: false, refused: errorWords(error) }),
      );
    },
    answer(job, word) {
      if (shown.answering !== null) return;
      show({ answering: job, refused: null });
      client.call("POST /api/v1/chats/:chat/bootstrap/:job/answer", { chat, job }, { body: answerBody(word) }).then(
        () => {
          show({ answering: null });
          read();
        },
        (error: unknown) => show({ answering: null, refused: errorWords(error) }),
      );
    },
    older() {
      if (shown.next === null) return;
      client.call("GET /api/v1/chats/:chat/bootstrap/jobs", { chat }, { query: { cursor: shown.next } }).then(
        (page) => show({ jobs: [...shown.jobs, ...page.items], next: page.next }),
        (error: unknown) => show({ problem: errorWords(error) }),
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
    {
      id: "horizon",
      title: "The horizon",
      fact: horizon,
      lines: () =>
        horizon.known
          ? [
              `${counted(horizon.entries, "entry", "entries")}, ${num(horizon.named)} naming a place or thing of the world; story time ${horizon.clock ? "kept" : "not kept"}`,
              ...(
                [
                  ["The time", horizon.time],
                  ["The place", horizon.place],
                  ["Who is on stage", horizon.onStage],
                  ["What they have", horizon.holdings],
                ] as const
              ).map(([label, p]) => `${label}: ${p.recorded ? "recorded" : "not recorded"}; ${num(p.established)} established, ${num(p.assumed)} assumed, ${num(p.proposed)} proposed, ${num(p.none)} with no standing`),
            ]
          : [],
    },
    {
      id: "principals",
      title: "Each principal's base and memories",
      fact: principals,
      lines: () =>
        principals.known
          ? principals.principals.length === 0
            ? ["No principal yet"]
            : principals.principals.map(
                (p) =>
                  `${p.name}: base ${p.base.length === 0 ? "none written" : p.base.join(", ")}; ${counted(p.memories, "memory", "memories")}, ${num(p.own)} written by its own agent (${num(p.ownFromPerceptions)} from perceptions), ${num(p.memories - p.own)} otherwise`,
              )
          : [],
    },
  ];
}

/**
 * Opens RPE's log on Runtime where a fact whose records could not be read says what failed: the lines of the job whose question shows the facts
 * (`job`), else the chat's warnings, for facts read now and no job's.
 */
function openLog(app: UiApp, chat: string, job?: string): void {
  app.go({ page: "runtime", chat, at: logAt(job === undefined ? { chat, level: "warn" } : { chat, job }) });
}

/** The six facts, each with its counts or why it is not known; none says whether it holds. One whose records could not be read leads to RPE's log (`onLog`), where the failure is. */
export function FactsView(props: { facts: DoneEnoughShown; onLog?(): void }) {
  const { onLog } = props;
  return (
    <div class="lre-stack" data-facts="true">
      {factLines(props.facts).map(({ id, title, fact, lines }) => (
        <div key={id} class="lre-stack" data-fact={id}>
          <Row label={title} value={fact.known ? null : <Badge>not known</Badge>} />
          {fact.known ? (
            lines().map((line, i) => (
              <p key={i} class="rpe-fact">
                {line}
              </p>
            ))
          ) : (
            <p class="rpe-fact">
              {NOT_KNOWN_WORDS[fact.why]}
              {onLog === undefined ? null : (
                <Button small kind="ghost" onClick={onLog}>
                  Open the log
                </Button>
              )}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** One job of the chat's bootstrap: how it stands, what it was given, what it spent, and its report once it ended. */
function JobLine(props: { job: BootstrapJobShown }) {
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
        Relive: {job.relive ?? "as the skill decides"} · asks you at {num(job.tokenLimit)} tokens sent and written
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

/** A cap's setting, in the page's words. */
const CAP_WORDS: Readonly<Record<string, string>> = {
  "bootstrap.run.calls": "Calls in its run",
  "bootstrap.run.time": "Seconds of its run",
  "jobs.run.tokensIn": "Tokens sent in its run",
  "jobs.run.tokensOut": "Tokens written in its run",
};

/** A whole number above 0 he typed, null for none typed, or undefined for one that is not. */
function wholeOf(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/**
 * The start: the token limit and the caps in force, a limit of his own for this job, and one button for each relive word the skill
 * offers and one leaving it to the skill (just one while the skill is off). With a job under way it says so, and a press asks him to
 * confirm a second beside it. No button is live while a start is out.
 */
export function StartForm(props: { start: BootstrapStartShown; underWay: readonly BootstrapJobShown[]; busy: boolean; label: string; onStart(choice: StartChoice): void }) {
  const { start, underWay } = props;
  const [typed, setTyped] = useState("");
  const [asked, setAsked] = useState<string | null | undefined>(undefined);
  const limit = wholeOf(typed);
  const go = (relive: string | null): void => {
    if (limit === undefined) return;
    if (underWay.length > 0 && asked === undefined) {
      setAsked(relive);
      return;
    }
    setAsked(undefined);
    props.onStart({ relive, tokenLimit: limit });
  };
  const choices: (string | null)[] = [...start.relive, null];
  return (
    <div class="lre-stack" data-start="true">
      <span class="rpe-caption">{props.label}</span>
      {start.skill ? null : <p class="rpe-meta">The bootstrap skill is switched off: a job started now is given nothing of it, and has no stated end.</p>}
      <Row
        label="Asks you before going past"
        value={`${num(start.tokenLimit)} tokens`}
        sub={`Tokens sent and written by every agent of the job, a token read again from a cache counting as ${start.cachedWeight} of one; it then waits for your word to go on or end.`}
      />
      {start.caps.map((cap) => (
        <Row key={cap.key} label={CAP_WORDS[cap.key] ?? cap.key} value={cap.value === null ? "no cap" : num(cap.value)} sub="Ends its run when reached." />
      ))}
      <label class="lre-stack">
        <span class="rpe-caption">Its own token limit (left empty: the setting's)</span>
        <input class="lre-input" inputMode="numeric" value={typed} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {limit === undefined ? <p class="rpe-meta">A token limit is a whole number above 0.</p> : null}
      {underWay.length === 0 ? null : (
        <p class="rpe-meta">
          Under way already: {underWay.map((j) => `job ${j.id}, ${j.view === null ? "not held" : JOB_STATE_WORDS[j.view.state].words}`).join("; ")}. Another start begins a second job beside it.
        </p>
      )}
      {asked === undefined ? (
        <div class="lre-inline rpe-wrap">
          {choices.map((word) => (
            <Button key={word ?? ""} small kind={word === null ? "ghost" : undefined} busy={props.busy} disabled={props.busy || limit === undefined} onClick={() => go(word)}>
              {word === null ? (start.relive.length === 0 ? "Start" : "as the skill decides") : word}
            </Button>
          ))}
        </div>
      ) : (
        <div class="lre-inline rpe-wrap" data-confirm="true">
          <span class="rpe-meta">Start a second bootstrap job beside the one under way?</span>
          <Button small busy={props.busy} disabled={props.busy} onClick={() => go(asked)}>
            Start a second
          </Button>
          <Button small kind="ghost" onClick={() => setAsked(undefined)}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

/** A job held at its token limit: what it reached and spent and how that is counted, what its agent last wrote, the six facts now, and his two answers. Given for the Jobs page and the Migration page too. */
export function QuestionView(props: { question: BootstrapQuestion; chat: string; busy: boolean; onAnswer(word: AnswerWord): void }) {
  const { question: q } = props;
  const app = useApp();
  const [typed, setTyped] = useState(String(q.more));
  const more = wholeOf(typed);
  return (
    <div class="lre-stack" data-question={q.job}>
      <Banner tone="warn" icon="alert" title={`Job ${q.job} reached its limit and waits for your word`}>
        <span>
          It asked at {num(q.at)} tokens, having counted {num(q.tokens)} (tokens sent and written by all its agents, a cached token as {q.cachedWeight} of one). Spent: {tokenWords(q.usage)}.
        </span>
      </Banner>
      {q.wrote === null ? null : <Pre text={q.wrote} mono={false} />}
      <FactsView facts={q.facts} onLog={() => openLog(app, props.chat, q.job)} />
      <label class="lre-stack">
        <span class="rpe-caption">Tokens more before it asks again</span>
        <input class="lre-input" inputMode="numeric" value={typed} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="lre-inline rpe-wrap">
        <Button small busy={props.busy} disabled={props.busy || more === undefined} onClick={() => more !== undefined && props.onAnswer({ go: "on", more })}>
          Go on
        </Button>
        <Button small kind="ghost" busy={props.busy} disabled={props.busy} onClick={() => props.onAnswer({ go: "end" })}>
          End with what it has
        </Button>
      </div>
    </div>
  );
}

export interface BootstrapViewProps {
  shown: BootstrapShown;
  onStart(choice: StartChoice): void;
  onAnswer(job: string, word: AnswerWord): void;
  onOlder(): void;
}

/** The chat's bootstrap: the six facts, the start, the questions of jobs that wait, and its jobs a page at a time. */
export function BootstrapView(props: BootstrapViewProps) {
  const { shown } = props;
  const app = useApp();
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
        <Banner tone="neg" icon="alert" title="Not done">
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
          {answer.questions.map((q) => (
            <QuestionView key={q.job} question={q} chat={answer.chat} busy={shown.answering === q.job} onAnswer={(word) => props.onAnswer(q.job, word)} />
          ))}
          <FactsView facts={answer.facts} onLog={() => openLog(app, answer.chat)} />
          <StartForm start={answer.start} underWay={answer.underWay} busy={shown.starting} label="Start a bootstrap job" onStart={props.onStart} />
          <span class="rpe-caption">Its jobs, newest first</span>
          {shown.jobs.length === 0 ? (
            <p class="lre-muted rpe-line">No bootstrap job of this chat yet.</p>
          ) : (
            <ul class="lre-stack rpe-plain">
              {shown.jobs.map((job) => (
                <JobLine key={job.id} job={job} />
              ))}
            </ul>
          )}
          {shown.next === null ? null : (
            <Button small kind="ghost" onClick={props.onOlder}>
              Older jobs
            </Button>
          )}
        </>
      )}
    </Section>
  );
}

/** The words for how a carried chat's bootstrap stands. */
const CARRIED_WORDS: Readonly<Record<CarriedBootstrap["state"], string>> = {
  none: "no bootstrap job yet",
  queued: "its job waits for a place",
  held: "its job is held",
  running: "its job is running",
  asking: "its job waits for your word",
  ended: "its job ended",
};

/** One carried chat on the Migration page: how its bootstrap stands, its newest job, its question, and its own start. */
function CarriedChat(props: { item: CarriedBootstrap; busy: boolean; onStart(choice: StartChoice): void; onAnswer(job: string, word: AnswerWord): void }) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  const underWay = item.job !== null && item.state !== "none" && item.state !== "ended" ? [item.job] : [];
  return (
    <li class="rpe-entry lre-stack" data-carried={item.chat}>
      <div class="lre-inline rpe-wrap">
        <span class="rpe-strong">{item.chat}</span>
        <Badge>{CARRIED_WORDS[item.state]}</Badge>
        {item.job?.view?.limit === undefined ? null : <span class="rpe-meta">ended at its {item.job.view.limit.limit} limit</span>}
      </div>
      {item.job?.view?.report === undefined ? null : <Pre text={item.job.view.report} mono={false} />}
      {item.question === null ? null : <QuestionView question={item.question} chat={item.chat} busy={props.busy} onAnswer={(word) => props.onAnswer(item.question!.job, word)} />}
      {open ? (
        <StartForm start={item.start} underWay={underWay} busy={props.busy} label={`Start a bootstrap job for ${item.chat}`} onStart={props.onStart} />
      ) : (
        <Button small kind="ghost" onClick={() => setOpen(true)}>
          Start one for this chat
        </Button>
      )}
    </li>
  );
}

/** The Migration page's offer, read and steered: the carried chats a page at a time, each with its own start, and the start for all of them. */
export interface OfferShown {
  items: CarriedBootstrap[];
  next: string | null;
  loading: boolean;
  problem: string | null;
  busy: boolean;
  batch: BootstrapBatchReply | null;
  said: string | null;
}

const NO_OFFER: OfferShown = { items: [], next: null, loading: true, problem: null, busy: false, batch: null, said: null };

/** The offer on the Migration page, reading itself: the carried chats with how each bootstrap stands, read again when a job changes. */
export function CarriedOffer() {
  const app = useApp();
  const [shown, setShown] = useState<OfferShown>(NO_OFFER);
  const [stamp, setStamp] = useState(0);
  const set = (next: Partial<OfferShown>): void => setShown((s) => ({ ...s, ...next }));
  useEffect(() => {
    app.client.call("GET /api/v1/bootstrap", {}, { query: {} }).then(
      (page) => set({ items: page.items, next: page.next, loading: false, problem: null }),
      (error: unknown) => set({ loading: false, problem: errorWords(error) }),
    );
  }, [stamp]);
  // A job that changes (one held for his word among them) is read again: nothing polls.
  useEffect(
    () =>
      app.client.follow("~jobs", {
        events(events) {
          if (events.some((event) => String(event.kind) === "job")) setStamp((n) => n + 1);
        },
        reset: () => setStamp((n) => n + 1),
        refused: () => undefined,
      }),
    [],
  );
  const more = (): void => {
    if (shown.next === null) return;
    app.client.call("GET /api/v1/bootstrap", {}, { query: { cursor: shown.next } }).then(
      (page) => set({ items: [...shown.items, ...page.items], next: page.next }),
      (error: unknown) => set({ problem: errorWords(error) }),
    );
  };
  const startOne = (chat: string, choice: StartChoice): void => {
    set({ busy: true, said: null });
    app.client.call("POST /api/v1/chats/:chat/bootstrap", { chat }, { body: startBody(choice) }).then(
      (job) => {
        set({ busy: false, said: `Started job ${job.id} for ${chat}.` });
        setStamp((n) => n + 1);
      },
      (error: unknown) => set({ busy: false, said: errorWords(error) }),
    );
  };
  const startAll = (choice: StartChoice): void => {
    set({ busy: true, batch: null, said: null });
    app.client.call("POST /api/v1/bootstrap", {}, { body: { chats: "migrated", ...startBody(choice) } }).then(
      (batch) => {
        set({ busy: false, batch });
        setStamp((n) => n + 1);
      },
      (error: unknown) => set({ busy: false, said: errorWords(error) }),
    );
  };
  const answer = (chat: string, job: string, word: AnswerWord): void => {
    set({ busy: true, said: null });
    app.client.call("POST /api/v1/chats/:chat/bootstrap/:job/answer", { chat, job }, { body: answerBody(word) }).then(
      () => {
        set({ busy: false });
        setStamp((n) => n + 1);
      },
      (error: unknown) => set({ busy: false, said: errorWords(error) }),
    );
  };
  return <OfferView shown={shown} onMore={more} onStartOne={startOne} onStartAll={startAll} onAnswer={answer} />;
}

/** The offer as drawn: every carried chat with its state, its start and its question, and the start for all of them. */
export function OfferView(props: { shown: OfferShown; onMore(): void; onStartOne(chat: string, choice: StartChoice): void; onStartAll(choice: StartChoice): void; onAnswer(chat: string, job: string, word: AnswerWord): void }) {
  const { shown } = props;
  const first = shown.items[0];
  let body: ComponentChildren;
  if (shown.loading) body = <p class="lre-muted rpe-line">Reading the carried chats…</p>;
  else if (shown.items.length === 0) body = <p class="lre-muted rpe-line">The last migration carried no chat.</p>;
  else
    body = (
      <>
        <ul class="lre-stack rpe-plain">
          {shown.items.map((item) => (
            <CarriedChat key={item.chat} item={item} busy={shown.busy} onStart={(choice) => props.onStartOne(item.chat, choice)} onAnswer={(job, word) => props.onAnswer(item.chat, job, word)} />
          ))}
        </ul>
        {shown.next === null ? null : (
          <Button small kind="ghost" onClick={props.onMore}>
            More carried chats
          </Button>
        )}
        {first === undefined ? null : <StartForm start={first.start} underWay={[]} busy={shown.busy} label="Start for every carried chat, one after another" onStart={props.onStartAll} />}
      </>
    );
  return (
    <Section id="bootstrap" title="Bootstrap the carried chats">
      <p class="rpe-meta">Each chat the migration carried, with how its bootstrap stands. Start one for a chat, or one for every chat: RPE runs as many at once as its jobs settings allow and queues the rest.</p>
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The carried chats could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.said === null ? null : <p class="rpe-meta">{shown.said}</p>}
      {shown.batch === null ? null : (
        <div class="lre-stack" data-batch="true">
          <span class="rpe-caption">Started ({shown.batch.started.length})</span>
          {shown.batch.started.map((s) => (
            <Row key={s.chat} label={s.chat} value={`job ${s.job.id}, ${JOB_STATE_WORDS[s.job.state].words}`} />
          ))}
          <span class="rpe-caption">Refused ({shown.batch.refused.length})</span>
          {shown.batch.refused.map((r) => (
            <Row key={r.chat} label={r.chat} value={r.why} />
          ))}
        </div>
      )}
      {body}
    </Section>
  );
}
