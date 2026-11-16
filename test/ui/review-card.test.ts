// The Turn page's review card: the turn's changes by lane with undo on one, a question held for his word answered on the card, and an old engine's record.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { CardChange, CarriedTurnReply, ReviewCardReply } from "../../src/shared/api";
import { CarriedRecord } from "../../src/ui/pages/turns/sections/carried";
import { questionWords, ReviewCard } from "../../src/ui/pages/turns/sections/review";
import { elements, expand, press, textOf } from "./vnodes";

const change = (id: string, over: Partial<CardChange> = {}): CardChange => ({ id, op: "set", applied: true, by: "author", source: "stated", standing: "exact", value: { gold: 4 }, reports: [], undo: { ops: ["set"], left: [] }, undoneBy: [], ...over });
const card: ReviewCardReply = {
  turn: "t5",
  lanes: [
    { lane: "story", changes: [] },
    { lane: "engine", changes: [change("c1"), change("c2", { applied: false })] },
  ],
  questions: [{ id: "q1", agent: "keeper", tool: "world_apply", lane: "engine", args: { gold: 9 }, asked: 1_000, state: "waiting", answer: null }],
  imported: [],
};

describe("the review card", () => {
  test("with the engine lane on Confirm the card lists its changes held or applied, his yes goes ahead on a question, and undo reverts one applied change", () => {
    const calls: string[] = [];
    const review = { busy: null, said: null, onUndo: (c: string) => calls.push(`undo ${c}`), onAnswer: (q: string, go: boolean) => calls.push(`${go ? "yes" : "no"} ${q}`) };
    const tree = expand(h(ReviewCard, { card, review }));
    const shown = textOf(tree);
    expect(shown).toContain("The engine's changes");
    expect(elements(tree).filter((e) => e.props["data-card-change"] !== undefined)).toHaveLength(2);
    expect(shown).toContain("held");
    press(tree, "Undo it");
    press(tree, "Let it go ahead");
    expect(calls).toEqual(["undo c1", "yes q1"]);
    expect(questionWords({ ...(card.questions[0] as ReviewCardReply["questions"][number]), state: "answered", answer: { go: false, reason: "not yet" } })).toBe("did not go ahead: not yet");
  });

  test("an undone change offers no second undo; a carried reply shows the engine, why no turn was played and each text word for word", () => {
    const undone = expand(h(ReviewCard, { card: { ...card, lanes: [{ lane: "engine", changes: [change("c1", { undoneBy: ["c9"] })] }], questions: [] }, review: { busy: null, said: null, onUndo: () => undefined, onAnswer: () => undefined } }));
    expect(elements(undone).some((e) => e.type === "button")).toBe(false);
    expect(textOf(undone)).toContain("reversed by c9");
    const carried: CarriedTurnReply = { turn: "t5", chat: "c", message: "m1", swipe: 0, engine: "agents", fields: [{ name: "session", value: { id: "s1" } }], texts: [{ part: "prompts", path: "a.md", text: "Old words." }, { part: "prompts", path: "b.md", text: null }], unplayed: "it was stopped", departures: ["The reply names a door the turn kept shut."] };
    const shown = textOf(expand(h(CarriedRecord, { carried })));
    expect(shown).toContain("the agents engine");
    expect(shown).toContain("it was stopped");
    expect(shown).toContain("Old words.");
    expect(shown).toContain("Today's clean-up had removed this text.");
  });
});
