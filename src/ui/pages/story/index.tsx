// The Story page (plan §14 Story, §8.1): a chat's story record as stored. What the Author keeps of the story is behind the spoiler gate, for one
// chat, and nothing of it is read while the gate is shut: the timeline (chapters, scenes and beats in the chat's order, each beat beside the
// prose it stands for), what the record covers of the whole chat, the story so far as the Author is given it, and the story model's parts, the
// horizon and the futures. Each list gives the newest of it, as many as the story's own bound allows, and reads further back by the route's own
// paging; what the record no longer holds leaves the page at the next read. Every item can be struck, or corrected, as his own change. Above the
// record, the chat's bootstrap (bootstrap.tsx): the six facts, its jobs, and the way to start one. The page reads when it opens and when the
// chat's live view says a run began or ended, or the state changed.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { StoryItemRow, StoryItems, StoryPartName, StoryReply, StoryStrikeReply } from "../../../shared/api";
import { useApp } from "../../app";
import { Banner, Gated, PageHeader, Row, Section } from "../../atoms";
import { replyOf, type RpeClient } from "../../client";
import { onChatChange } from "../../live-watch";
import type { PageEntry } from "../../page-entry";
import type { CorrectAsk, StrikeAsk } from "../../records";
import { useSelect } from "../../store";
import { errorWords } from "../../words";
import { type BootstrapReader, type BootstrapShown, BootstrapView, type BootstrapViewProps, NO_BOOTSTRAP, readBootstrap } from "../bootstrap";
import { CoverageSection, SoFarSection } from "./coverage";
import { correctItem, StoryItemCard, strikeItem } from "./item";
import { TimelineSection } from "./timeline";

export { PART_WORDS, spanWords } from "./item";

/** The parts the story route gives as bounded lists: every part but the one premise. */
export type StoryListPart = Exclude<StoryPartName, "premise">;
export type StoryLists = Record<StoryListPart, StoryItems>;

/** What the page shows: the last read, each list with what was read further back of it, and the last strike with what came of it. */
export interface StoryShown {
  answer: StoryReply | null;
  lists: StoryLists | null;
  loading: boolean;
  problem: string | null;
  /** The list being read further back now. */
  further: StoryListPart | null;
  striking: string | null;
  struck: { ask: StrikeAsk; answer: StoryStrikeReply } | null;
  strikeProblem: string | null;
}

export const NO_STORY: StoryShown = { answer: null, lists: null, loading: true, problem: null, further: null, striking: null, struck: null, strikeProblem: null };

/** Every list of an answer, by its part. */
export function listsOf(answer: StoryReply): StoryLists {
  const { timeline: t, model: m } = answer;
  return { chapter: t.chapter, scene: t.scene, beat: t.beat, thread: m.thread, arc: m.arc, player: m.player, canon: m.canon, retcon: m.retcon, record: m.record, future: answer.futures };
}

export interface StoryReader {
  /** Reads the list of `part` further back than what the page holds of it. */
  further(part: StoryListPart): void;
  strike(ask: StrikeAsk): void;
  /** Corrects an item as his own change; answers what the record said of it. */
  correct(ask: CorrectAsk): Promise<string[]>;
  refresh(): void;
  stop(): void;
}

/**
 * Reads a chat's story record, and again on `refresh()`: each list is read again from its newest page, and one the page had read further
 * back is read back to the depth it held, so what the record dropped is gone and what it still holds stays. Reads a list further back and
 * adds what it gives before what the page holds; strikes and corrects an item and shows it as it stands now.
 */
export function readStory(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: StoryShown) => void): StoryReader {
  let shown: StoryShown = NO_STORY;
  let alive = true;
  let reading = 0;
  const show = (next: Partial<StoryShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  /** One page further back of a list; false where there was none or it could not be read. */
  const older = async (part: StoryListPart): Promise<boolean> => {
    const held = shown.lists?.[part];
    if (held === undefined || held.before === 0) return false;
    try {
      // `skip` counts back from the newest end: past what the page holds, and past what was left out after it.
      const answer = replyOf(await client.call("GET /api/v1/chats/:chat/story", { chat }, { query: { part, skip: held.items.length + held.after } }));
      const page = listsOf(answer)[part];
      const now = shown.lists;
      if (now === null || !alive) return false;
      const kept = now[part];
      show({ problem: null, lists: { ...now, [part]: { items: [...page.items, ...kept.items], total: page.total, before: page.before, after: kept.after } } });
      return page.items.length > 0;
    } catch (error) {
      show({ problem: errorWords(error) });
      return false;
    }
  };
  const read = (): void => {
    const mine = ++reading;
    client.call("GET /api/v1/chats/:chat/story", { chat }).then(replyOf).then(
      async (answer) => {
        if (mine !== reading) return;
        const deep = shown.lists;
        const fresh = listsOf(answer);
        show({ answer, lists: fresh, loading: false, problem: null });
        if (deep === null) return;
        // What the page had read further back is read back to the depth it held.
        for (const part of Object.keys(fresh) as StoryListPart[]) {
          const want = deep[part].items.length;
          while (mine === reading && alive && (shown.lists?.[part].items.length ?? want) < want && (await older(part))) continue;
        }
      },
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  /** An item as it stands now, in place, so what was read further back stays. */
  const swapIn = (item: StoryItemRow): void => {
    const lists = shown.lists;
    const premise = shown.answer?.model.premise;
    const swap = (list: StoryItems): StoryItems => ({ ...list, items: list.items.map((held) => (held.id === item.id ? item : held)) });
    show({
      lists: lists === null ? null : (Object.fromEntries(Object.entries(lists).map(([part, list]) => [part, swap(list)])) as StoryLists),
      answer: shown.answer === null || premise?.id !== item.id ? shown.answer : { ...shown.answer, model: { ...shown.answer.model, premise: item } },
    });
  };
  read();
  return {
    further(part) {
      const held = shown.lists?.[part];
      if (held === undefined || held.before === 0 || shown.further !== null) return;
      show({ further: part });
      older(part).then(() => show({ further: null }));
    },
    strike(ask) {
      if (shown.striking !== null) return;
      show({ striking: ask.id, strikeProblem: null });
      strikeItem(client, chat, ask).then(
        (answer) => {
          swapIn(answer.item);
          show({ striking: null, struck: { ask, answer } });
        },
        (error: unknown) => show({ striking: null, strikeProblem: errorWords(error) }),
      );
    },
    async correct(ask) {
      show({ striking: ask.id, strikeProblem: null });
      try {
        const answer = await correctItem(client, chat, ask);
        swapIn(answer.item);
        show({ striking: null });
        return answer.changed ? answer.said : ["Nothing changed: it already stood so.", ...answer.said];
      } catch (error) {
        show({ striking: null, strikeProblem: errorWords(error) });
        throw error;
      }
    },
    refresh: read,
    stop() {
      alive = false;
    },
  };
}

export interface StoryViewProps {
  shown: StoryShown;
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  onFurther(part: StoryListPart): void;
  onStrike(ask: StrikeAsk): void;
  onCorrect?(ask: CorrectAsk): Promise<string[]>;
  /** The chat's bootstrap, drawn above the record it builds. */
  bootstrap?: BootstrapViewProps;
  /** What the gate holds before the story model's parts: the timeline, what the record covers, the story so far. */
  gated?: ComponentChildren;
}

function Item(props: StoryViewProps & { item: StoryItemRow }) {
  return <StoryItemCard item={props.item} busy={props.shown.striking} onStrike={props.onStrike} onCorrect={props.onCorrect} />;
}

/** The button that reads a list further back, while it has older items. */
function Further(props: StoryViewProps & { part: StoryListPart; title: string }) {
  const list = props.shown.lists?.[props.part];
  if (list === undefined || list.before === 0) return null;
  return (
    <button type="button" class="lre-btn small" disabled={props.shown.further === props.part} onClick={() => props.onFurther(props.part)}>
      {`Older ${props.title} (${list.before} more)`}
    </button>
  );
}

/** A list of the record, under its title, with its count and the way further back. */
function ListSection(props: StoryViewProps & { part: StoryListPart; id: string; title: string; none: string }) {
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
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate} why="The Author's timeline and summaries, the story model, the horizon and the futures are what it plans and has understood, and can give away what comes next.">
        {props.gated}
        {answer === null || lists === null ? (
          shown.loading ? (
            <p class="lre-muted rpe-line">Reading the story record…</p>
          ) : null
        ) : (
          <>
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
                answer.horizon.map((h, i) => <Row key={i} label={h.at} value={h.name ?? "names no place or thing in the world now"} sub={h.depth === "full" ? "shown in full" : `shown ${h.depth} ${h.depth === 1 ? "level" : "levels"} deep`} />)
              )}
            </Section>
            <ListSection {...props} part="future" id="futures" title="Futures" none="None drafted." />
          </>
        )}
      </Gated>
    </div>
  );
}

export function StoryPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<StoryShown>(NO_STORY);
  const [bootstrap, setBootstrap] = useState<BootstrapShown>(NO_BOOTSTRAP);
  const [stamp, setStamp] = useState(0);
  const reader = useRef<StoryReader | null>(null);
  const starter = useRef<BootstrapReader | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setShown(NO_STORY);
    setBootstrap(NO_BOOTSTRAP);
    const reading = readStory(app.client, chat, setShown);
    const facts = readBootstrap(app.client, chat, setBootstrap);
    reader.current = reading;
    starter.current = facts;
    // A run of the chat that begins or ends, or a change of its state (a correction of his, here or on another open page), may have written the record and moved the facts: all are read again.
    const off = onChatChange(app.client, chat, () => {
      reading.refresh();
      facts.refresh();
      setStamp((n) => n + 1);
    });
    return () => {
      off();
      reading.stop();
      facts.stop();
      reader.current = null;
      starter.current = null;
    };
  }, [chat]);
  const current = shown.answer?.current ?? { chapter: null, scene: null };
  return (
    <StoryView
      shown={shown}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onFurther={(part) => reader.current?.further(part)}
      onStrike={(ask) => reader.current?.strike(ask)}
      onCorrect={(ask) => reader.current?.correct(ask) ?? Promise.resolve([])}
      bootstrap={{ shown: bootstrap, onStart: (relive) => starter.current?.start(relive) }}
      gated={
        <>
          <TimelineSection chat={chat} current={current} stamp={stamp} />
          <CoverageSection chat={chat} stamp={stamp} />
          <SoFarSection chat={chat} stamp={stamp} />
        </>
      }
    />
  );
}

export const entry: PageEntry = { id: "story", title: "Story", icon: "book", shells: ["web", "drawer"], needsChat: true, often: false, order: 60, render: (route) => <StoryPage chat={route.chat} /> };
