import { describe, expect, test } from "bun:test";
import { QUEST_STORE_AREA, questSliceOf, recordQuests } from "../../src/quests";
import { pairMarks, questEvents, threadTouched } from "../../src/quests/thread";
import { itemView, allSpans } from "../../src/story/kit";
import { storySliceOf } from "../../src/story/fold";
import type { TurnRow } from "../../src/store";
import { CHAT, openTable, USER } from "../story/rig";

const writer = (turn: TurnRow) => ({ user: USER, chat: CHAT, turn: turn.id, by: "gm", agent: "gm-1", job: null });

async function linked() {
  const t = await openTable({ areas: [QUEST_STORE_AREA] });
  const first = await t.begin();
  const [thread] = await t.write(first, [{ part: "thread", item: null, value: { text: "Who sealed the letter?", kind: "question" } }]);
  const [open] = await t.writes.run(() => recordQuests(t.store, writer(first), [{ op: "open", stand: "q", quest: "q", value: { kind: "quest", name: "The sealed letter", thread: thread?.item ?? "" } }]));
  await t.tie(first);
  const state = () => t.s.headState(CHAT).state;
  return { t, threadId: thread?.item ?? "", questId: open?.quest ?? "", state, threadItem: () => storySliceOf(state()).items[thread?.item ?? ""] as NonNullable<ReturnType<typeof storySliceOf>["items"][string]> };
}

describe("a quest and its thread", () => {
  test("closing a thread marks its open quest on both views, and the quest's history holds the turn it closed", async () => {
    const l = await linked();
    expect(pairMarks([l.threadItem()], questSliceOf(l.state()))).toEqual([]);
    const second = await l.t.begin();
    await l.t.write(second, [{ part: "thread", item: l.threadId, value: { close: true } }]);
    await l.t.tie(second);
    const marks = pairMarks([l.threadItem()], questSliceOf(l.state()));
    expect(marks).toEqual([{ thread: l.threadId, quest: l.questId, closed: "thread" }]);
    // The thread's view shows the quest with its state and the mark; the quest stays open.
    const record = l.t.record();
    const view = itemView(record, record.items.get(l.threadId) as NonNullable<ReturnType<typeof record.items.get>>, null, allSpans(record));
    expect(view).toMatchObject({ quests: [{ id: l.questId, closed: false }], marked: [{ quest: l.questId, closed: "thread" }] });
    const quest = questSliceOf(l.state()).quests[l.questId];
    expect(questEvents(quest as NonNullable<typeof quest>, questSliceOf(l.state()), l.threadItem()).map((e) => e.what)).toEqual(["open", "thread_closed"]);
    // A swipe of the closing turn takes the mark away.
    const swipe = await l.t.swipe();
    expect(pairMarks([storySliceOf(l.t.s.stateAt(swipe.id).state).items[l.threadId] as ReturnType<typeof l.threadItem>], questSliceOf(l.t.s.stateAt(swipe.id).state))).toEqual([]);
  });

  test("a quest closed in a turn sets its thread's last touched to that turn, and the thread stays open", async () => {
    const l = await linked();
    const second = await l.t.begin();
    await l.t.writes.run(() => recordQuests(l.t.store, writer(second), [{ op: "close", quest: l.questId, value: { outcome: "met", why: "The seal was read." } }]));
    await l.t.tie(second);
    const at = threadTouched(l.threadItem(), questSliceOf(l.state()));
    expect(at.turn).toBe(second.id);
    expect(l.threadItem().closedBy).toBeNull();
    expect(pairMarks([l.threadItem()], questSliceOf(l.state()))).toEqual([{ thread: l.threadId, quest: l.questId, closed: "quest" }]);
  });
});
