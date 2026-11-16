// The link between a quest and its story thread (plan §8.3, READINGS R-169): the quest names its thread, so the thread's view shows
// each quest that names it with its state, and the quest's view shows the thread's. Where one is closed and the other open, both
// carry a mark saying so. Closing one touches the other: in the turn a quest closes, its thread's last touched is that turn; in the
// turn a thread closes, that turn is in the history of each quest that names it. Both are read off the records at the path they
// stand on, so a swipe of the closing turn takes both away. Code closes nothing and changes no other field and no state of either.

import type { StoryItemDoc } from "../story/fold";
import { marksOf, type QuestDoc, type QuestSlice } from "./record";

/** A quest that names a thread, with its state: open or closed, and where on the path it closed. */
export interface QuestOfThread {
  quest: string;
  name: string;
  closed: boolean;
  /** The closing turn and its number on the path; null while it is open. */
  closedAt: { turn: string; n: number } | null;
}

/** The quests that name `thread`, in the order they were opened. */
export function questsOfThread(quests: Readonly<QuestSlice>, thread: string): QuestOfThread[] {
  return Object.values(quests.quests)
    .filter((q) => q.thread === thread)
    .map((q): QuestOfThread => {
      const closed = marksOf(quests, q.id).closed;
      return { quest: q.id, name: q.name, closed: closed !== null, closedAt: closed === null ? null : { turn: closed.turn, n: closed.n } };
    });
}

/** Where on the path a thread was closed: the turn that closed it and its number there; null while it is open. */
export function threadClosedAt(thread: StoryItemDoc): { turn: string; n: number } | null {
  if (thread.closedBy === null) return null;
  const row = thread.rows.findLast((r) => r.value.close === true);
  return row === undefined ? null : { turn: row.turn, n: row.n };
}

/** The mark a linked pair carries where one side is closed and the other open: which side is the closed one. */
export interface PairMark {
  thread: string;
  quest: string;
  closed: "thread" | "quest";
}

/** The pairs of the story's threads and the quests naming them where one is closed and the other open. */
export function pairMarks(threads: readonly StoryItemDoc[], quests: Readonly<QuestSlice>): PairMark[] {
  return threads.flatMap((t) =>
    questsOfThread(quests, t.id).flatMap((q): PairMark[] => {
      const threadClosed = t.closedBy !== null;
      if (threadClosed === q.closed) return [];
      return [{ thread: t.id, quest: q.quest, closed: threadClosed ? "thread" : "quest" }];
    }),
  );
}

/** A thread's last touched: its own newest write, or the turn a quest naming it closed if that is later on the path. */
export function threadTouched(thread: StoryItemDoc, quests: Readonly<QuestSlice>): { turn: string; n: number } {
  let at = { turn: thread.touched, n: thread.rows.at(-1)?.n ?? 0 };
  for (const q of questsOfThread(quests, thread.id)) if (q.closedAt !== null && q.closedAt.n > at.n) at = q.closedAt;
  return at;
}

/** One entry of a quest's history: the turn, its number on the path, and what happened. */
export interface QuestEvent {
  turn: string;
  n: number;
  what: "open" | "what" | "stakes" | "thread" | "stage" | "bind" | "restore" | "closed" | "thread_closed";
}

/** A quest's history on the path: its own writes, how it closed, and the turn its thread closed, oldest first. */
export function questEvents(quest: QuestDoc, quests: Readonly<QuestSlice>, thread: StoryItemDoc | undefined): QuestEvent[] {
  const events: QuestEvent[] = quest.rows.map((r) => ({ turn: r.turn, n: r.n, what: r.op as QuestEvent["what"] }));
  const closed = marksOf(quests, quest.id).closed;
  if (closed !== null) events.push({ turn: closed.turn, n: closed.n, what: "closed" });
  const threadClosed = thread === undefined ? null : threadClosedAt(thread);
  if (threadClosed !== null) events.push({ ...threadClosed, what: "thread_closed" });
  return events.sort((a, b) => a.n - b.n);
}
