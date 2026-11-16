import { describe, expect, test } from "bun:test";
import { openQuests, QUEST_STORE_AREA, questSliceOf, questViews, recordQuests, seenOf } from "../../src/quests";
import type { TrackDef } from "../../src/shared/world";
import type { TurnRow } from "../../src/store";
import { CHAT, openTable, USER } from "../story/rig";

const writer = (turn: TurnRow) => ({ user: USER, chat: CHAT, turn: turn.id, by: "gm", agent: "gm-1", job: null });

const ERRAND: TrackDef = {
  id: "errand",
  kind: "secret",
  label: "The warden's errand",
  owner: "gm",
  start: "go",
  visibility: "secret",
  stages: { go: { label: "Set out", next: [{ to: "done", when: "met(warden, wren)" }] }, done: { label: "Handed over", next: [] } },
};

describe("a stage's call, a close and what the player is shown", () => {
  test("a stage called failed with its reason reads failed with that reason after a fold and a snapshot, and a swipe takes it back", async () => {
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const first = await t.begin();
    const [open] = await t.writes.run(() => recordQuests(t.store, writer(first), [{ op: "open", stand: "q", quest: "q", value: { kind: "quest", name: "The letter", visibility: "public" } }, { op: "stage", quest: "q", value: { stage: "carry", label: "Carry it", condition: "it reaches the warden" } }]));
    const id = open?.quest ?? "";
    await t.tie(first);
    const second = await t.begin();
    await t.writes.run(() =>
      recordQuests(t.store, writer(second), [
        { op: "call", quest: id, value: { stage: "carry", state: "failed", why: "The letter burned before it was delivered." } },
        { op: "call", quest: "errand", value: { stage: "go", state: "met", why: "She kept her word." } },
      ]),
    );
    await t.tie(second);
    const views = () => questViews({ errand: ERRAND }, questSliceOf(t.s.headState(CHAT).state));
    const call = () => views().find((q) => q.id === id)?.stages[0]?.call;
    expect(call()).toMatchObject({ state: "failed", why: "The letter burned before it was delivered.", by: "gm" });
    expect(views().find((q) => q.id === "errand")?.stages[0]?.call).toMatchObject({ state: "met", why: "She kept her word." });
    t.store.dropCaches();
    expect(call()?.state).toBe("failed");
    // The turn's reply swiped: from before the turn, nothing was called.
    const swipe = await t.swipe();
    expect(questViews({ errand: ERRAND }, questSliceOf(t.s.stateAt(swipe.id).state)).find((q) => q.id === id)?.stages[0]?.call).toBeNull();
  });

  test("a quest closes with its outcome and opens again, the world's end stage closes one it defines, and the open quests read leaves them out", async () => {
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const turn = await t.begin();
    const [open] = await t.writes.run(() => recordQuests(t.store, writer(turn), [{ op: "open", stand: "q", quest: "q", value: { kind: "agenda", name: "The reeve's plan" } }]));
    const id = open?.quest ?? "";
    await t.tie(turn);
    const tracks = { errand: { ...ERRAND, visibility: "public" as const } };
    const names = (standing: Record<string, string> = {}) => openQuests(tracks, questSliceOf(t.s.headState(CHAT).state), standing).map((q) => q.name);
    expect(names()).toEqual(["The warden's errand", "The reeve's plan"]);
    expect(names({ errand: "done" })).toEqual(["The reeve's plan"]);
    const next = await t.begin();
    await t.writes.run(() => recordQuests(t.store, writer(next), [{ op: "close", quest: id, value: { outcome: "failed", why: "The reeve was found out." } }]));
    await t.tie(next);
    expect(names()).toEqual(["The warden's errand"]);
    expect(questViews(tracks, questSliceOf(t.s.headState(CHAT).state)).find((q) => q.id === id)?.closed).toMatchObject({ outcome: "failed", why: "The reeve was found out." });
    const again = await t.begin();
    await t.writes.run(() => recordQuests(t.store, writer(again), [{ op: "close", quest: id, value: { outcome: null } }]));
    await t.tie(again);
    expect(names()).toEqual(["The warden's errand", "The reeve's plan"]);
  });

  test("visibility goes from nothing to one stage to the whole quest and back", async () => {
    const t = await openTable({ areas: [QUEST_STORE_AREA] });
    const shown = async (value: string | string[] | null) => {
      const turn = await t.begin();
      await t.writes.run(() => recordQuests(t.store, writer(turn), [{ op: "show", quest: "errand", value: { shown: value } }]));
      await t.tie(turn);
      const view = questViews({ errand: ERRAND }, questSliceOf(t.s.headState(CHAT).state))[0];
      return seenOf(view as NonNullable<typeof view>, false);
    };
    // The world's own visibility: a secret shows the player nothing.
    expect(await shown(null)).toEqual({ whole: false, stages: [] });
    expect(await shown(["go"])).toEqual({ whole: false, stages: ["go"] });
    expect(await shown("all")).toEqual({ whole: true, stages: [] });
    expect(await shown("none")).toEqual({ whole: false, stages: [] });
    expect(await shown(null)).toEqual({ whole: false, stages: [] });
  });
});
