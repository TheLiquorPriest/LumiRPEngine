// The timeline (plan §8.1, §14 Story): the chat's chapters, scenes and beats as one list in the chat's order, a page at a time, each beat beside
// the prose it stands for (the chat's own messages, read for the page's beats), so the Author's understanding is checked against the chat
// itself. Each item can be struck, or corrected, as his own change. This sits behind the spoiler gate: the Author's summaries can give away
// what it means to do next, and nothing of it is read while the gate is shut.

import { useEffect, useState } from "preact/hooks";
import type { ChatMessageShown, StoryItemRow, StoryTimelineRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Banner, Button, Section } from "../../atoms";
import { usePaged } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords } from "../../words";
import type { CorrectAsk, StrikeAsk } from "../../records";
import { correctItem, StoryItemCard, strikeItem } from "./item";

/** Every message id the page's beats stand for that has not been read. */
export function missingIds(rows: readonly StoryTimelineRow[], held: ReadonlyMap<string, ChatMessageShown>): string[] {
  const ids = new Set<string>();
  for (const row of rows) for (const m of row.messages) if (!held.has(m.id)) ids.add(m.id);
  return [...ids];
}

/** A beat's prose: each message it stands for, by its number, who said it, and its text. */
export function Prose(props: { row: StoryTimelineRow; messages: ReadonlyMap<string, ChatMessageShown> }) {
  const { row } = props;
  if (row.messages.length === 0) return <p class="lre-muted rpe-line" data-prose-none>It stands for no message of the chat.</p>;
  return (
    <ol class="rpe-plain lre-stack" data-prose>
      {row.messages.map((m) => {
        const message = props.messages.get(m.id);
        return (
          <li key={m.id} class="lre-stack" data-message={m.number}>
            <span class="rpe-caption">{message === undefined ? `Message ${m.number}` : `Message ${m.number} · ${message.name}${message.hidden === true ? " · hidden" : ""}`}</span>
            {message === undefined ? <span class="lre-muted rpe-meta">Reading it…</span> : <p class="rpe-pre prose">{message.text}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function TimelineSection(props: { chat: string; current: { chapter: string | null; scene: string | null }; stamp: number }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const [changed, setChanged] = useState<ReadonlyMap<string, StoryItemRow>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [messages, setMessages] = useState<ReadonlyMap<string, ChatMessageShown>>(new Map());
  const list = usePaged((cursor) => app.client.call("GET /api/v1/chats/:chat/story/timeline", { chat }, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }), [chat, props.stamp]);
  useEffect(() => {
    setChanged(new Map());
  }, [chat, props.stamp]);
  // The prose of the beats the page holds, read in groups as the list grows.
  const missing = missingIds(list.items, messages);
  const key = missing.join(",");
  useEffect(() => {
    if (missing.length === 0) return;
    let alive = true;
    app.client.call("GET /api/v1/chats/:chat/messages", { chat }, { query: { ids: missing.slice(0, 100).join(",") } }).then(
      (answer) => {
        if (alive) setMessages((held) => new Map([...held, ...answer.messages.map((m) => [m.id, m] as const)]));
      },
      (error: unknown) => {
        if (alive) setProblem(errorWords(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [chat, key]);
  const hold = (item: StoryItemRow): void => setChanged((held) => new Map(held).set(item.id, item));
  const actions = {
    busy,
    onStrike: (ask: StrikeAsk) => {
      if (busy !== null) return;
      setBusy(ask.id);
      setProblem(null);
      strikeItem(app.client, chat, ask).then(
        (answer) => {
          setBusy(null);
          hold(answer.item);
        },
        (error: unknown) => {
          setBusy(null);
          setProblem(errorWords(error));
        },
      );
    },
    onCorrect: async (ask: CorrectAsk): Promise<string[]> => {
      const answer = await correctItem(app.client, chat, ask);
      hold(answer.item);
      return answer.said;
    },
  };
  const rows = list.items.map((row) => ({ ...row, item: changed.get(row.item.id) ?? row.item }));
  return (
    <Section id="timeline" title="Timeline">
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-timeline-problem>{problem}</span>
        </Banner>
      )}
      {list.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The timeline could not be read">
          <span>{list.problem}</span>
        </Banner>
      )}
      {rows.length === 0 && !list.loading && list.problem === null ? (
        <p class="lre-muted rpe-line">No chapter, scene or beat is recorded yet.</p>
      ) : (
        <ol class="lre-stack rpe-plain" data-timeline>
          {rows.map((row) => (
            <li key={row.item.id} class={row.kind === "beat" ? "rpe-beat" : undefined} data-row={row.kind}>
              <ul class="rpe-plain">
                <StoryItemCard item={row.item} current={row.item.id === props.current.chapter || row.item.id === props.current.scene} {...actions} />
              </ul>
              {row.kind === "beat" ? <Prose row={row} messages={messages} /> : null}
            </li>
          ))}
        </ol>
      )}
      {list.more ? (
        <Button busy={list.loading} onClick={list.older}>
          Later in the chat
        </Button>
      ) : null}
      <p class="rpe-meta">{counted(rows.length, "item")} read, in the chat's order.</p>
    </Section>
  );
}
