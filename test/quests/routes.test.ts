// The quest routes on an invented chat: the journal draws only what the player may see (a quest set to show him nothing is absent, one
// shown by stages shows its name and those stages, a stage called failed shows failed with its reason); the records give all of it,
// a page at a time; one record gives its history. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { shippedTexts } from "../../src/iface/texts";
import { QUEST_STORE_AREA, recordQuests } from "../../src/quests";
import { questRoutes } from "../../src/quests/routes";
import type { JournalAnswer, QuestAnswer, QuestsPage } from "../../src/quests/shapes";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { TurnRow } from "../../src/store";
import { callRoute } from "../app/call";
import { CHAT, openTable, USER } from "../story/rig";
import { engine } from "../store/fixtures";

const writer = (turn: TurnRow) => ({ user: USER, chat: CHAT, turn: turn.id, by: "gm", agent: "gm-1", job: null });

async function open() {
  const t = await openTable({ areas: [QUEST_STORE_AREA] });
  const [journalRoute, listRoute, oneRoute] = questRoutes({ store: t.store, files: () => shippedTexts(), settings: async () => ({}) });
  const turn = await t.begin();
  const ids = await t.writes.run(() =>
    recordQuests(t.store, writer(turn), [
      { op: "open", stand: "a", quest: "a", value: { kind: "quest", name: "The missing ferryman" } },
      { op: "what", quest: "a", value: { objective: "Find the ferryman.", why: "The crossing is shut without him." } },
      { op: "stage", quest: "a", value: { stage: "ask", label: "Ask at the landing", condition: "Wren has spoken to the ferrywoman" } },
      { op: "call", quest: "a", value: { stage: "ask", state: "failed", why: "The ferrywoman will not talk." } },
      { op: "open", stand: "b", quest: "b", value: { kind: "secret", name: "Who sealed the letter", visibility: "secret" } },
      { op: "stage", quest: "b", value: { stage: "seal", label: "Read the seal", condition: "the seal is read" } },
      { op: "stage", quest: "b", value: { stage: "hand", label: "Find the hand", condition: "the hand is found" } },
    ]),
  );
  await t.tie(turn);
  const [a, , , , b] = ids;
  // The invented world has a track of its own, read beside these: the tests look at the quests opened here.
  const journal = async (): Promise<JournalAnswer> => {
    const all: JournalAnswer = await callRoute(journalRoute, { params: { chat: CHAT }, user: USER });
    return { ...all, quests: all.quests.filter((x) => !x.world) };
  };
  const listHandle = listRoute.handle as unknown as (call: { params: { chat: string }; query: Record<string, string | number>; user: string }) => Promise<QuestsPage>;
  const show = async (shown: string | string[] | null) => {
    const next = await t.begin();
    await t.writes.run(() => recordQuests(t.store, writer(next), [{ op: "show", quest: b?.quest ?? "", value: { shown } }]));
    await t.tie(next);
  };
  return { t, journal, journalRoute, listHandle, oneRoute, a: a?.quest ?? "", b: b?.quest ?? "", show };
}

describe("the journal", () => {
  test("draws what the player may see: a secret is absent, shown by stages it is its name and those stages, a failed stage shows failed with its reason", async () => {
    const q = await open();
    const first = await q.journal();
    expect(first.quests.map((x) => x.name)).toEqual(["The missing ferryman"]);
    expect(first.quests[0]).toMatchObject({ whole: true, objective: "Find the ferryman.", stages: [{ id: "ask", state: "failed", why: "The ferrywoman will not talk." }] });
    await q.show(["seal"]);
    const part = (await q.journal()).quests.find((x) => x.name === "Who sealed the letter");
    expect(part).toMatchObject({ whole: false, objective: null, stages: [{ id: "seal", label: "Read the seal" }] });
    expect(part?.stages.length).toBe(1);
    await q.show("none");
    expect((await q.journal()).quests.map((x) => x.name)).toEqual(["The missing ferryman"]);
    await q.show("all");
    expect((await q.journal()).quests.map((x) => x.name)).toEqual(["The missing ferryman", "Who sealed the letter"]);
  });
});

describe("the records", () => {
  test("give all of it a page at a time, and one in full with its history", async () => {
    const q = await open();
    const first = await q.listHandle({ params: { chat: CHAT }, query: { limit: 1 }, user: USER });
    expect(first.items.length).toBe(1);
    expect(first.next).not.toBeNull();
    const rest = await q.listHandle({ params: { chat: CHAT }, query: { limit: 50, after: first.next ?? "" }, user: USER });
    const mine = [...first.items, ...rest.items].filter((x) => !x.world);
    expect(mine.map((x) => [x.name, x.open])).toEqual([
      ["The missing ferryman", true],
      ["Who sealed the letter", true],
    ]);
    expect(mine[1]).toMatchObject({ visibility: "secret", stages: [{ id: "seal" }, { id: "hand" }] });
    expect(rest.next).toBeNull();
    const one: QuestAnswer = await callRoute(q.oneRoute, { params: { chat: CHAT, quest: "the missing ferryman" }, user: USER });
    expect(one.quest.id).toBe(q.a);
    expect(one.history.map((h) => h.op)).toEqual(["open", "what", "stage"]);
    await expect(callRoute(q.oneRoute, { params: { chat: CHAT, quest: "nobody" }, user: USER })).rejects.toMatchObject({ status: 404 });
  });
});

describe("a quest the world defines", () => {
  test("shows a stage it was moved past with how it ended and why, from the move's own change, and is closed as its end stage ended it", async () => {
    const q = await open();
    const asked = await q.listHandle({ params: { chat: CHAT }, query: { limit: 50 }, user: USER });
    // Not moved yet: no stage has a state, and the quest is open.
    expect(asked.items.find((x) => x.id === "errand")).toMatchObject({ open: true, closed: null, stages: [{ id: "asked", state: null, why: null, current: true }, { id: "done", state: null, current: false }] });
    const turn = await q.t.begin();
    await q.t.writes.run(() => q.t.s.addChanges(turn.id, engine({ type: "stage", track: "errand", from: "asked", to: "done", why: "The letter reached the warden's hand." } as LedgerEvent)));
    await q.t.tie(turn);
    const moved = (await q.listHandle({ params: { chat: CHAT }, query: { limit: 50 }, user: USER })).items.find((x) => x.id === "errand");
    expect(moved?.stages).toMatchObject([
      { id: "asked", state: "met", why: "The letter reached the warden's hand.", current: false },
      { id: "done", state: null, why: null, current: true },
    ]);
    expect(moved).toMatchObject({ open: false, closed: { outcome: "met", why: "The letter reached the warden's hand." } });
    // The journal draws it the same way, and the record's history lists the move.
    const journal: JournalAnswer = await callRoute(q.journalRoute, { params: { chat: CHAT }, user: USER });
    expect(journal.quests.find((x) => x.id === "errand")?.stages[0]).toMatchObject({ state: "met", why: "The letter reached the warden's hand." });
    const one: QuestAnswer = await callRoute(q.oneRoute, { params: { chat: CHAT, quest: "errand" }, user: USER });
    expect(one.history).toMatchObject([{ op: "stage", value: { from: "asked", to: "done", state: "met", why: "The letter reached the warden's hand." } }]);
  });
});
