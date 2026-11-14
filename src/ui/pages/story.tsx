// The Story page (plan §14 Story, §8.1): a chat's story record as stored. The timeline (chapters,
// scenes and beats, in the chat's order, each with where it lies and the summaries the Author wrote)
// shows at once; the story model's parts, the horizon and the futures can give away what comes next, so
// they sit behind the spoiler gate. Each list gives the newest of it, as many as the story's own bound
// allows, and reads further back by the route's own paging. Every item can be struck, or its strike
// taken back. Above the record, the chat's bootstrap (bootstrap.tsx): the six facts, its jobs, and the
// way to start one. The page reads when it opens and when the chat's live view says a run began or ended.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import type { StoryAnswer, StoryItemShown, StoryList, StoryListPart, StoryStruck } from "../api";
import { useApp } from "../app";
import { Badge, Banner, Button, Gated, PageHeader, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { onChatChange } from "../live-watch";
import { EntryCard, type StrikeAsk } from "../records";
import { counted, errorWords } from "../words";
import { type BootstrapReader, type BootstrapShown, BootstrapView, type BootstrapViewProps, NO_BOOTSTRAP, readBootstrap } from "./bootstrap";

export type StoryLists = Record<StoryListPart, StoryList>;

/** What the page shows: the last read, each list with what was read further back of it, and the last strike with what came of it. */
export interface StoryShown {
  answer: StoryAnswer | null;
  lists: StoryLists | null;
  loading: boolean;
  problem: string | null;
  /** The list being read further back now. */
  further: StoryListPart | null;
  striking: string | null;
  struck: { ask: StrikeAsk; answer: StoryStruck } | null;
  strikeProblem: string | null;
}

export const NO_STORY: StoryShown = { answer: null, lists: null, loading: true, problem: null, further: null, striking: null, struck: null, strikeProblem: null };

/** Every list of an answer, by its part. */
export function listsOf(answer: StoryAnswer): StoryLists {
  const { timeline: t, model: m } = answer;
  return { chapter: t.chapter, scene: t.scene, beat: t.beat, thread: m.thread, arc: m.arc, player: m.player, canon: m.canon, retcon: m.retcon, record: m.record, future: answer.futures };
}

/**
 * A list read again: its newest page after what was read further back of it, so what "Older" read stays. The list runs oldest
 * first; a newest page that holds all of it, or that does not reach back to the items held (more came meanwhile than a page
 * holds), stands alone.
 */
export function withNewest(held: StoryList, fresh: StoryList): StoryList {
  const first = fresh.items[0];
  const reached = first === undefined ? -1 : held.items.findIndex((item) => item.id === first.id);
  if (fresh.before === 0 || reached <= 0) return fresh;
  const older = held.items.slice(0, reached);
  return { ...fresh, items: [...older, ...fresh.items], before: Math.max(0, fresh.before - older.length) };
}

export interface StoryReader {
  /** Reads the list of `part` further back than what the page holds of it. */
  further(part: StoryListPart): void;
  strike(ask: StrikeAsk): void;
  refresh(): void;
  stop(): void;
}

/** Reads a chat's story record, and again on `refresh()` keeping what was read further back; reads a list further back and adds what it gives before what the page holds; strikes an item and shows it as it stands now. */
export function readStory(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: StoryShown) => void): StoryReader {
  let shown: StoryShown = NO_STORY;
  let alive = true;
  const show = (next: Partial<StoryShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const read = (): void => {
    client.call("GET /api/v1/chats/:chat/story", { chat }).then(
      (answer) => {
        const fresh = listsOf(answer);
        const held = shown.lists;
        const lists = held === null ? fresh : (Object.fromEntries(Object.entries(fresh).map(([part, list]) => [part, withNewest(held[part as StoryListPart], list)])) as StoryLists);
        show({ answer, lists, loading: false, problem: null });
      },
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  read();
  return {
    further(part) {
      const held = shown.lists?.[part];
      if (held === undefined || held.before === 0 || shown.further !== null) return;
      show({ further: part });
      // `skip` counts back from the newest end: past what the page holds, and past what was left out after it.
      client.call("GET /api/v1/chats/:chat/story", { chat }, { query: { part, skip: held.items.length + held.after } }).then(
        (answer) => {
          const older = listsOf(answer)[part];
          const now = shown.lists;
          if (now === null) return show({ further: null });
          const kept = now[part];
          show({ further: null, problem: null, lists: { ...now, [part]: { items: [...older.items, ...kept.items], total: older.total, before: older.before, after: kept.after } } });
        },
        (error: unknown) => show({ further: null, problem: errorWords(error) }),
      );
    },
    strike(ask) {
      if (shown.striking !== null) return;
      show({ striking: ask.id, strikeProblem: null });
      client.call("POST /api/v1/chats/:chat/story/strike", { chat }, { body: ask }).then(
        (answer) => {
          const lists = shown.lists;
          const premise = shown.answer?.model.premise;
          // The item as it stands now, in place, so what was read further back stays.
          const swap = (list: StoryList): StoryList => ({ ...list, items: list.items.map((item) => (item.id === answer.item.id ? answer.item : item)) });
          show({
            striking: null,
            struck: { ask, answer },
            lists: lists === null ? null : (Object.fromEntries(Object.entries(lists).map(([part, list]) => [part, swap(list)])) as StoryLists),
            answer: shown.answer === null || premise?.id !== answer.item.id ? shown.answer : { ...shown.answer, model: { ...shown.answer.model, premise: answer.item } },
          });
        },
        (error: unknown) => show({ striking: null, strikeProblem: errorWords(error) }),
      );
    },
    refresh: read,
    stop() {
      alive = false;
    },
  };
}

const PART_WORDS: Readonly<Record<StoryListPart | "premise", string>> = {
  premise: "Premise",
  chapter: "Chapter",
  scene: "Scene",
  beat: "Beat",
  thread: "Thread",
  arc: "Arc",
  player: "Player",
  future: "Future",
  canon: "Canon",
  retcon: "Retcon",
  record: "Record",
};

/** Where an item lies in the chat. */
export function spanWords(item: Pick<StoryItemShown, "from" | "to">): string | null {
  if (item.from === null && item.to === null) return null;
  if (item.from === item.to) return `message ${item.from}`;
  return `messages ${item.from ?? "?"} to ${item.to ?? "open"}`;
}

/** The timeline in the chat's order: by where each starts, a chapter before the scene it opens and the scene before its first beat; what lies nowhere last. */
export function timelineOf(lists: StoryLists): StoryItemShown[] {
  const rank: Partial<Record<StoryListPart, number>> = { chapter: 0, scene: 1, beat: 2 };
  const items = [...lists.chapter.items, ...lists.scene.items, ...lists.beat.items];
  return items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => (a.item.from ?? Number.POSITIVE_INFINITY) - (b.item.from ?? Number.POSITIVE_INFINITY) || (rank[a.item.part as StoryListPart] ?? 0) - (rank[b.item.part as StoryListPart] ?? 0) || a.at - b.at)
    .map(({ item }) => item);
}

export interface StoryViewProps {
  shown: StoryShown;
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  onFurther(part: StoryListPart): void;
  onStrike(ask: StrikeAsk): void;
  /** The chat's bootstrap, drawn above the record it builds. */
  bootstrap?: BootstrapViewProps;
}

function Item(props: StoryViewProps & { item: StoryItemShown; current?: boolean }) {
  const { item, shown } = props;
  const span = spanWords(item);
  return (
    <EntryCard
      id={item.id}
      title={PART_WORDS[item.part]}
      marks={
        <>
          {span === null ? null : <span class="rpe-meta lre-num">{span}</span>}
          {props.current === true ? <Badge tone="accent">now</Badge> : null}
          {item.closed ? <Badge>closed</Badge> : null}
        </>
      }
      fields={item.fields}
      first={item}
      struck={item.struck}
      writes={item.writes}
      busy={shown.striking === item.id}
      onStrike={props.onStrike}
    />
  );
}

/** The button that reads a list further back, while it has older items. */
function Further(props: StoryViewProps & { part: StoryListPart; title: string }) {
  const list = props.shown.lists?.[props.part];
  if (list === undefined || list.before === 0) return null;
  return (
    <Button small busy={props.shown.further === props.part} onClick={() => props.onFurther(props.part)}>
      {`Older ${props.title} (${list.before} more)`}
    </Button>
  );
}

/** A list of the record, under its title, with its count and the way further back. */
function ListSection(props: StoryViewProps & { part: StoryListPart; id: string; title: string; none: string; children?: ComponentChildren }) {
  const list = props.shown.lists?.[props.part];
  if (list === undefined) return null;
  return (
    <Section id={props.id} title={`${props.title} (${list.total})`}>
      {list.items.length === 0 ? (
        <p class="lre-muted rpe-line">{props.none}</p>
      ) : (
        <ul class="lre-stack rpe-plain">
          {list.items.map((item) => (
            <Item key={item.id} {...props} item={item} />
          ))}
        </ul>
      )}
      <Further {...props} title={props.title.toLowerCase()} />
    </Section>
  );
}

export function StoryView(props: StoryViewProps) {
  const { shown } = props;
  const { answer, lists } = shown;
  return (
    <div class="lre-stack rpe-page" data-page="story">
      <PageHeader title="Story" sub={answer?.now == null ? "The story record of this chat, as the Author keeps it." : `Story time now: ${answer.now}`} />
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The story record could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.strikeProblem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span>{shown.strikeProblem}</span>
        </Banner>
      )}
      {shown.struck === null ? null : <Banner tone="info" icon="check" title={!shown.struck.answer.changed ? "Nothing changed: it already stood so" : shown.struck.ask.struck ? "Struck" : "Its strike was taken back"} />}
      {props.bootstrap === undefined ? null : <BootstrapView {...props.bootstrap} />}
      {answer === null || lists === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the story record…</p>
        ) : null
      ) : (
        <>
          <Section id="timeline" title="Timeline">
            {timelineOf(lists).length === 0 ? (
              <p class="lre-muted rpe-line">No chapter, scene or beat is recorded yet.</p>
            ) : (
              <ol class="lre-stack rpe-plain">
                {timelineOf(lists).map((item) => (
                  <Item key={item.id} {...props} item={item} current={item.id === answer.current.chapter || item.id === answer.current.scene} />
                ))}
              </ol>
            )}
            <div class="lre-inline rpe-wrap">
              <Further {...props} part="chapter" title="chapters" />
              <Further {...props} part="scene" title="scenes" />
              <Further {...props} part="beat" title="beats" />
            </div>
            <p class="rpe-meta">
              {`${counted(lists.chapter.total, "chapter")}, ${counted(lists.scene.total, "scene")} and ${counted(lists.beat.total, "beat")} in all; each list reads ${answer.listed} at a time.`}
            </p>
          </Section>
          <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate} why="The story model, the horizon and the futures are what the Author plans, and can give away what comes next.">
            <Section id="premise" title="Premise">
              {answer.model.premise === null ? (
                <p class="lre-muted rpe-line">None recorded.</p>
              ) : (
                <ul class="lre-stack rpe-plain">
                  <Item {...props} item={answer.model.premise} />
                </ul>
              )}
            </Section>
            <ListSection {...props} part="thread" id="threads" title="Threads" none="None recorded." />
            <ListSection {...props} part="arc" id="arcs" title="Arcs" none="None recorded." />
            <ListSection {...props} part="player" id="player" title="The player, as the Author reads them" none="None recorded." />
            <ListSection {...props} part="canon" id="canon" title="Canon" none="None recorded." />
            <ListSection {...props} part="retcon" id="retcons" title="Retcons" none="None recorded." />
            <ListSection {...props} part="record" id="records" title="The Author's records" none="None recorded." />
            <Section id="horizon" title={`Horizon (${answer.horizon.length})`}>
              {answer.horizon.length === 0 ? (
                <p class="lre-muted rpe-line">Nothing is on the horizon.</p>
              ) : (
                answer.horizon.map((h, i) => <Row key={i} label={h.at} value={h.name ?? "names no place or thing in the world now"} />)
              )}
            </Section>
            <ListSection {...props} part="future" id="futures" title="Futures" none="None drafted." />
          </Gated>
        </>
      )}
    </div>
  );
}

export function StoryPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<StoryShown>(NO_STORY);
  const reader = useRef<StoryReader | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapShown>(NO_BOOTSTRAP);
  const starter = useRef<BootstrapReader | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setShown(NO_STORY);
    setBootstrap(NO_BOOTSTRAP);
    const reading = readStory(app.client, chat, setShown);
    const facts = readBootstrap(app.client, chat, setBootstrap);
    reader.current = reading;
    starter.current = facts;
    // A run of the chat that begins or ends may have written the record and moved the facts: both are read again.
    const off = onChatChange(app.client, chat, () => {
      reading.refresh();
      facts.refresh();
    });
    return () => {
      off();
      reading.stop();
      facts.stop();
      reader.current = null;
      starter.current = null;
    };
  }, [chat]);
  return (
    <StoryView
      shown={shown}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onFurther={(part) => reader.current?.further(part)}
      onStrike={(ask) => reader.current?.strike(ask)}
      bootstrap={{ shown: bootstrap, onStart: (relive) => starter.current?.start(relive) }}
    />
  );
}
