// The Quests page: a stage met with the Author's reason, a quest's history with the turn that moved it, and a journal that holds only what he may see.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { Journal, JournalQuestRow, QuestRecord, QuestRecordRow, QuestStageRow } from "../../src/shared/api";
import { JournalView } from "../../src/ui/pages/quests/journal";
import { QuestRecordView, shownWords } from "../../src/ui/pages/quests/record";
import { elements, expand, textOf } from "./vnodes";

const stage = (id: string, over: Partial<QuestStageRow> = {}): QuestStageRow => ({ id, label: id, condition: `${id} is done`, state: null, why: null, current: null, ...over });
const record = (over: Partial<QuestRecordRow> = {}): QuestRecordRow => ({ id: "q1", kind: "quest", name: "The bell", world: false, objective: "Ring it.", why: null, stakes: null, rewards: null, stages: [], who: [], where: [], things: [], closed: null, thread: null, visibility: "secret", shown: null, open: true, ...over });
const seen = (id: string, over: Partial<JournalQuestRow> = {}): JournalQuestRow => ({ id, kind: "quest", name: id, world: false, objective: null, why: null, stakes: null, rewards: null, stages: [], who: [], where: [], things: [], closed: null, whole: true, thread: null, ...over });

describe("the Quests page", () => {
  test("a met stage shows with the Author's reason, and a quest's history with the turn that moved it", () => {
    const quest: QuestRecord = { quest: record({ stages: [stage("find", { state: "met", why: "She found the rope.", current: false }), stage("ring")] }), history: [{ turn: "t3", by: "author", op: "stage", value: { stage: "find" } }] };
    const shown = textOf(expand(h(QuestRecordView, { record: quest, onTurn: () => undefined })));
    expect(shown).toContain("met, where it stands now".replace(", where it stands now", ""));
    expect(shown).toContain("She found the rope.");
    expect(shown).toContain("ring is done");
    expect(shown).toContain("its turn");
    expect(shownWords(null, "secret")).toBe("as the quest's own visibility says: a secret");
  });

  test("a secret quest is absent from the journal; one seen by stages shows its name and stages only", () => {
    const journal: Journal = { chat: "c1", turn: null, open: 1, quests: [seen("The bell", { whole: false, objective: null, stages: [stage("find", { state: "met", why: "She found it." })] })] };
    const tree = expand(h(JournalView, { journal, loading: false, problem: null }));
    const shown = textOf(tree);
    expect(shown).toContain("The bell");
    expect(shown).toContain("Only its name and the stages named are shown to you.");
    expect(shown).not.toContain("Ring it.");
    expect(elements(tree).filter((e) => e.props["data-journal-quest"] !== undefined)).toHaveLength(1);
    const none = textOf(expand(h(JournalView, { journal: { ...journal, quests: [], open: 0 }, loading: false, problem: null })));
    expect(none).toContain("Your journal holds no quest yet.");
  });
});
