// The Turn page's review card: the turn's changes by lane in words (what changed, who made it, what it reported, what an Undo does and what it leaves),
// the record as written in a disclosed line under each, a question held for his word answered on the card, and an old engine's record.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { leftLines, playAnswers } from "../../src/play/service";
import type { CardChange, CarriedTurnReply, ReportShown, ReviewCardReply } from "../../src/shared/api";
import { RPE_GUIDANCE } from "../../src/tree";
import { CarriedRecord } from "../../src/ui/pages/turns/sections/carried";
import { questionWords, ReviewCard } from "../../src/ui/pages/turns/sections/review";
import { elements, expand, press, textOf } from "./vnodes";

const change = (id: string, over: Partial<CardChange> = {}): CardChange => ({
  id,
  op: "set",
  words: "Wren's gold is now 4.",
  applied: true,
  by: "gm",
  source: "prose",
  standing: "established",
  value: { gold: 4 },
  reports: [],
  reportWords: [],
  undo: { ops: ["set"], left: [], leftWords: [], words: "Undo takes this change back." },
  undoneBy: [],
  ...over,
});
const card: ReviewCardReply = {
  turn: "t5",
  dropped: false,
  lanes: [
    { lane: "story", changes: [] },
    { lane: "engine", changes: [change("c1"), change("c2", { applied: false })] },
  ],
  questions: [{ id: "q1", agent: "keeper", tool: "world_apply", lane: "engine", args: { gold: 9 }, asked: 1_000, state: "waiting", answer: null }],
  imported: [],
};
const idle = { busy: null, said: null, onUndo: () => undefined, onAnswer: () => undefined };

/** What an expanded tree shows outside its disclosures: the card as read at a glance, the record as written being closed. */
function outside(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(outside).join("");
  if (node !== null && typeof node === "object" && "props" in node) {
    const vnode: { type?: unknown; props: { children?: unknown } } = node as { props: { children?: unknown } };
    return vnode.type === "details" ? "" : outside(vnode.props.children);
  }
  return "";
}

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

  test("a change is told in words, who made it as a sentence, what it reported and what an Undo does, and its operation and value as written are in a disclosed line, closed", () => {
    const reported = change("c1", { reportWords: ["Operation 2 (set) was recorded, and the engine advises on it (plan_full)."], reports: [{ code: "advised", values: { n: 2, op: "set", code: "plan_full" } }] });
    const tree = expand(h(ReviewCard, { card: { ...card, lanes: [{ lane: "engine", changes: [reported] }], questions: [] }, review: idle }));
    const glance = outside(tree);
    for (const said of ["Wren's gold is now 4.", "Made by the GM: established, from the prose.", "Operation 2 (set) was recorded, and the engine advises on it (plan_full).", "Undo takes this change back."]) expect(glance).toContain(said);
    // Neither its operation, nor its value as written, nor a report's code is on the card at a glance.
    for (const raw of ["set ", '{"gold":4}', "advised", "applied set"]) expect(glance).not.toContain(raw);
    const disclosures = elements(tree).filter((e) => e.type === "details");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.props.open).toBeUndefined();
    const record = textOf(disclosures[0]?.props.children);
    expect(record).toContain("set");
    expect(record).toContain('{"gold":4}');
    expect(record).toContain("advised");
    expect(record).toContain("Undo records: set.");
  });

  test("an undone change offers no second undo; what an undo would leave is said in the play answers' words; a carried reply shows the engine, why no turn was played and each text word for word", async () => {
    const undone = expand(h(ReviewCard, { card: { ...card, lanes: [{ lane: "engine", changes: [change("c1", { undoneBy: ["c9"] })] }], questions: [] }, review: idle }));
    expect(elements(undone).some((e) => e.type === "button")).toBe(false);
    expect(outside(undone)).toContain("It has been undone since.");
    expect(outside(undone)).not.toContain("c9");
    expect(textOf(undone)).toContain("Reversed by c9.");
    // What an undo would leave is said in the play answers' words, as the card's route gives them, never as its report codes.
    const reports: ReportShown[] = [
      { code: "not_reversible", values: { op: "engine.check", why: "roll" } },
      { code: "changed_since", values: { op: "set", on: "Wren" } },
      { code: "staged", values: { change: 3, op: "set" } },
    ];
    const leftWords = leftLines(await playAnswers(RPE_GUIDANCE), reports);
    expect(leftWords).toEqual([
      "A roll stays as it is, because you have seen how the roll fell.",
      "A value of Wren stays as it is, because something has changed it since.",
      "The turn has not finished, so none of its changes can be taken back yet.",
    ]);
    const leaving = expand(h(ReviewCard, { card: { ...card, lanes: [{ lane: "engine", changes: [change("c1", { undo: { ops: ["set"], left: reports, leftWords, words: "Undo takes this change back." } })] }], questions: [] }, review: idle }));
    for (const said of leftWords) expect(outside(leaving)).toContain(said);
    for (const code of ["not_reversible", "changed_since", "staged"]) expect(outside(leaving)).not.toContain(code);
    const carried: CarriedTurnReply = { turn: "t5", chat: "c", message: "m1", swipe: 0, engine: "agents", fields: [{ name: "session", value: { id: "s1" } }], texts: [{ part: "prompts", path: "a.md", text: "Old words." }, { part: "prompts", path: "b.md", text: null }], unplayed: "it was stopped", departures: ["The reply names a door the turn kept shut."] };
    const shown = textOf(expand(h(CarriedRecord, { carried })));
    expect(shown).toContain("the agents engine");
    expect(shown).toContain("it was stopped");
    expect(shown).toContain("Old words.");
    expect(shown).toContain("The previous build's clean-up had removed this text.");
  });
});
