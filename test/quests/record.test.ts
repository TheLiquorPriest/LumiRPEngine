import { describe, expect, test } from "bun:test";
import { findQuest, QUEST_STORE_AREA, questSliceOf, questViews, recordQuests, trackAsQuest } from "../../src/quests";
import type { TrackDef } from "../../src/shared/world";
import type { TurnRow } from "../../src/store";
import { CHAT, openTable, USER } from "../story/rig";

const writer = (turn: TurnRow) => ({ user: USER, chat: CHAT, turn: turn.id, by: "gm", agent: "gm-1", job: null });

const ERRAND: TrackDef = {
  id: "errand",
  kind: "quest",
  label: "The warden's errand",
  owner: "wren",
  start: "go",
  visibility: "public",
  stages: {
    go: { label: "Set out", objectives: [{ label: "Reach the keep", when: "at(wren, keep)" }, "has(wren, letter)"], next: [{ to: "done", when: "met(warden, wren)" }] },
    done: { label: "Handed over", next: [] },
  },
};

describe("a quest's parts", () => {
  test("fold from its changes, survive a snapshot and rewind with a swipe", async () => {
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const turn = await t.begin();
    const recorded = await t.writes.run(() =>
      recordQuests(t.store, writer(turn), [
        { op: "open", stand: "q", quest: "q", value: { kind: "quest", name: "The missing ferryman", thread: "th-1" } },
        { op: "what", quest: "q", value: { objective: "Find the ferryman.", why: "The crossing is shut without him." } },
        { op: "stage", quest: "q", value: { stage: "ask", label: "Ask at the landing", condition: "Wren has spoken to the ferrywoman" } },
        { op: "stage", quest: "q", value: { stage: "search", label: "Search the reeds", condition: "the boat is found" } },
        { op: "stage", quest: "q", value: { stage: "rumour", label: "Hear the rumour", condition: "someone says it", after: null } },
        { op: "bind", quest: "q", value: { who: ["ferrywoman"], where: ["landing"] } },
        { op: "stakes", quest: "q", value: { stakes: "The crossing stays shut.", rewards: "A toll-free year." } },
      ]),
    );
    const id = recorded[0]?.quest ?? "";
    expect(id).toMatch(/^q-\d+$/);
    expect(new Set(recorded.map((r) => r.quest))).toEqual(new Set([id]));
    await t.tie(turn);
    const head = () => questSliceOf(t.s.headState(CHAT).state);
    expect(head().quests[id]).toMatchObject({
      kind: "quest",
      name: "The missing ferryman",
      objective: "Find the ferryman.",
      why: "The crossing is shut without him.",
      stakes: "The crossing stays shut.",
      rewards: "A toll-free year.",
      thread: "th-1",
      who: ["ferrywoman"],
      where: ["landing"],
      stages: [{ id: "rumour" }, { id: "ask" }, { id: "search" }],
    });
    const standing = head();
    // From the snapshot, not the folding: the same slice.
    t.store.dropCaches();
    expect(head()).toEqual(standing);
    expect(findQuest(head(), "  the MISSING  ferryman ")?.id).toBe(id);
    // A swipe of the reply starts from before the turn: the quest is not there.
    const swipe = await t.swipe();
    expect(questSliceOf(t.s.stateAt(swipe.id).state).quests).toEqual({});
  });

  test("an undo puts back only what its write set; undoing the opening takes the quest away", async () => {
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const turn = await t.begin();
    const [open, what, stakes] = await t.writes.run(() =>
      recordQuests(t.store, writer(turn), [
        { op: "open", stand: "q", quest: "q", value: { kind: "secret", name: "Who sealed the letter" } },
        { op: "what", quest: "q", value: { objective: "Learn whose seal it is." } },
        { op: "stakes", quest: "q", value: { stakes: "Wren's licence." } },
      ]),
    );
    const id = open?.quest ?? "";
    await t.tie(turn);
    const quest = () => questSliceOf(t.s.headState(CHAT).state).quests[id];
    await t.writes.run(() => t.s.undo(stakes?.change ?? 0));
    expect(quest()).toMatchObject({ objective: "Learn whose seal it is.", stakes: null });
    await t.writes.run(() => t.s.undo(what?.change ?? 0));
    expect(quest()).toMatchObject({ objective: null });
    await t.writes.run(() => t.s.undo(open?.change ?? 0));
    expect(quest()).toBeUndefined();
  });
});

describe("the world's tracks as quests", () => {
  test("a carried track reads as a quest record with its stages, owner and conditions as written, beside those opened in play", async () => {
    const view = trackAsQuest(ERRAND);
    expect(view).toMatchObject({ id: "errand", kind: "quest", name: "The warden's errand", world: true, who: ["wren"], where: [], visibility: "public" });
    expect(view.stages).toEqual([
      { id: "go", label: "Set out", condition: "Reach the keep; has(wren, letter)", world: true, call: null, objectives: [], way: null },
      { id: "done", label: "Handed over", condition: "", world: true, call: null, objectives: [], way: null },
    ]);
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const turn = await t.begin();
    await t.writes.run(() => recordQuests(t.store, writer(turn), [{ op: "open", stand: "q", quest: "q", value: { kind: "agenda", name: "The reeve's plan" } }]));
    const all = questViews({ errand: ERRAND }, questSliceOf(t.s.stateAt(turn.id).state));
    expect(all.map((q) => [q.name, q.world])).toEqual([
      ["The warden's errand", true],
      ["The reeve's plan", false],
    ]);
  });
});
