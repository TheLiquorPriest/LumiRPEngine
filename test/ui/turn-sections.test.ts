// The Turn page's sections: each a module of its own under `pages/turns/sections/`, listed by the order
// each declares, and what each shows of a turn's read: its prompt by slice, what he asked for, its changes
// by lane and what is unsettled, what it was told, its timings and where a continue went on from.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { sectionListSource, sectionModules } from "../../scripts/ui/pages";
import type { TurnReply } from "../../src/shared/api";
import { applyRead, EMPTY_LIVE, runsOf } from "../../src/ui/live-model";
import { parseNoticeLines } from "../../src/ui/notice-words";
import { NO_FOLDER, TURN_SECTIONS, TurnView, type TurnViewProps } from "../../src/ui/pages/turns";
import { spansOf } from "../../src/ui/turn-model";
import { AUTHOR, T0, turnAt } from "./recorded";
import { expand, textOf } from "./vnodes";

function view(turn: TurnReply, over: Partial<TurnViewProps> = {}): string {
  const props: TurnViewProps = { turn, runs: runsOf(applyRead(EMPTY_LIVE, turn), turn.id), problem: null, now: turn.timings.ended ?? 0, gateOpen: true, folder: NO_FOLDER, onOpenGate: () => undefined, onCloseGate: () => undefined, onBack: () => undefined, onLive: () => undefined, onRead: () => undefined, onOpenFile: () => undefined, onOpenRequest: () => undefined, onCloseFile: () => undefined, ...over };
  return textOf(expand(h(TurnView, props)));
}

const change = (id: number, op: string, over: Partial<TurnReply["changes"][number]["changes"][number]> = {}) => ({ id, ord: id, op, value: { coin: 2 }, by: "gm", applied: true, reports: [], source: "gm" as const, standing: "established" as const, precision: "exact" as const, job: null, ...over });

describe("the Turn page's sections", () => {
  test("a section file added appears in the list, and the list stands in the order the sections declare", () => {
    const source = sectionListSource([...sectionModules(), "lanes-extra"]);
    expect(source).toContain('import { section as lanesExtraSection } from "./lanes-extra";');
    expect(TURN_SECTIONS.map((s) => s.order)).toEqual([...TURN_SECTIONS.map((s) => s.order)].sort((a, b) => a - b));
    expect(new Set(TURN_SECTIONS.map((s) => s.id)).size).toBe(TURN_SECTIONS.length);
  });

  test("a turn's prompt shows under its markers and kinds, and a slice opens its text from the request as it was sent", () => {
    const turn: TurnReply = { ...turnAt(), prompt: { preset: { id: "p1" }, slices: [{ marker: "persona", kind: "persona", at: [{ message: 0, start: 4, end: 20 }], length: 16, hash: "h" }, { marker: "preset.style", kind: "style", at: [], length: 0, hash: "h2" }], unclaimed: [{ message: 0, start: 20, end: 30 }], notices: [{ kind: "changed", marker: "preset.style" }], front: { length: 120, brokenBy: "preset.style" } } };
    const lead = { same: true, tools: [], messages: [{ role: "system", block: "prompt", text: "xxxxAsh, the player's character." + "0123456789" }] };
    const text = view(turn, { lead, notices: parseNoticeLines("---\nformat: lines\n---\nnotice_changed: {{marker}} changed.\n") });
    expect(text).toContain("The prompt, by slice");
    expect(text).toContain("persona");
    expect(text).toContain("Ash, the player's characte".slice(0, 12));
    expect(text).toContain("not found in this prompt");
    expect(text).toContain("Text no slice owns");
    expect(text).toContain("The prompt's front held for 120 characters; the part marked preset.style broke it.");
    expect(text).toContain("preset.style changed.");
  });

  test("an activated entry whose tag gives no way shows 'not said'", () => {
    const text = view(turnAt(), { loreRows: [{ id: "e-12", entry: "ent", book: "", title: "The lamp", how: null, receipt: "kept-out" }, { id: "e-13", entry: "ent2", book: "bk", title: "The tide", how: "keyword", receipt: null }] });
    expect(text).toContain("e-12");
    expect(text).toContain("book not said; not said how it activated");
    expect(text).toContain("book bk; by a key");
    expect(text).toContain("kept out: RPE's check on the prompt's arrival took it out");
    expect(text.match(/kept out:/g)).toHaveLength(1);
  });

  test("a turn shows what he asked for, the Author's record with its decision line, and the tools it found", () => {
    const turn: TurnReply = { ...turnAt(), asked: [{ id: "r1", chat: "c", kind: "depth", asked: { choice: "direct", words: "Play it direct" }, played: false, message: null, turn: "t", at: T0 }], record: { decision: "Play the exchange direct.", next: "Moira gives way." }, found: ["pay", "map_lay"] };
    const text = view(turn);
    expect(text).toContain("depth: direct (Play it direct)");
    expect(text).toContain("Play the exchange direct.");
    expect(text).toContain("pay");
    expect(text).toContain("map_lay");
  });

  test("the changes stand lane by lane, an ignored engine says so, and a report, an unsourced write and an unapplied one are listed unsettled", () => {
    const unsourced = change(1, "beat", { source: null });
    const unapplied = change(2, "pay", { applied: false, reports: [{ code: "unbalanced" }] });
    const turn: TurnReply = {
      ...turnAt(),
      changes: [{ lane: "story", changes: [unsourced] }, { lane: "engine", changes: [unapplied] }],
      unsettled: [
        { change: unsourced, lane: "story", turn: turnAt().id, about: [], why: ["unsourced"] },
        { change: unapplied, lane: "engine", turn: turnAt().id, about: ["entity:wren"], why: ["reported", "not_applied"] },
      ],
      todos: [{ agent: "gm", open: ["settle the purse"] }],
    };
    const text = view(turn);
    expect(text).toContain("The story lane");
    expect(text).toContain("The engine lane");
    expect(text).toContain("Listed because it carries a report, and was not applied");
    expect(text).toContain("Listed because it has no source");
    expect(text).toContain("unbalanced");
    expect(text).toContain("settle the purse");
    expect(view(turnAt())).toContain("nothing changed in the engine");
    expect(view(turnAt())).toContain("This turn changed nothing in the engine.");
  });

  test("an empty gap check shows with its terms, a consent with its bounds, and a rule that fired shows what the agent did next", () => {
    const check = { id: "g1", by: AUTHOR, topic: "the harbourmaster", terms: ["harbourmaster", "quay"], searched: [{ where: "lore", hits: [] }] };
    const turn: TurnReply = { ...turnAt(), told: { gapChecks: [{ check, at: T0 }], consents: [{ grant: { id: "c1", by: AUTHOR, via: { kind: "answer", callId: "x" }, topic: "a new harbourmaster", bounds: "one scene", gapCheck: "g1" }, at: T0 }], rules: [{ firing: { rule: "rolls-say-why", path: "rules/x.md", level: "shipped", moment: "tool-result", agent: AUTHOR, action: "remind", matched: "roll", then: { did: "called", tools: ["pay"] } }, at: T0 }], attachments: [], dropped: [{ agent: AUTHOR, at: T0 }] } };
    const text = view(turn);
    expect(text).toContain("found nothing");
    expect(text).toContain("Searched for: harbourmaster, quay");
    expect(text).toContain("An invention rests on it: a new harbourmaster");
    expect(text).toContain("Bounds: one scene");
    expect(text).toContain("It rests on the gap check on the harbourmaster.");
    expect(text).toContain("rolls-say-why");
    expect(text).toContain("then called pay");
    expect(text).toContain("what it was given was dropped");
  });

  test("a turn whose Author ran a gap check before its record shows the check's time apart from the record's, and the wait for the turn before on its own", () => {
    const base = turnAt().timings;
    const timings = { ...base, received: 0, started: 1_000, firstWord: 9_000, released: 12_000, ended: 15_000, finished: 12_500, intent: { from: 2_000, to: 5_000 }, intake: [{ step: "the prompt read", from: 200, to: 600 }], wait: [{ from: 0, to: 200 }] };
    const spans = spansOf(timings);
    const ms = (label: string) => spans.find((s) => s.label.startsWith(label))?.ms;
    expect(ms("Waiting for the turn before")).toBe(200);
    expect(ms("Intake: the prompt read")).toBe(400);
    expect(ms("The intent record's own time")).toBe(3_000);
    expect(ms("Before the first words, apart from the intent record")).toBe(5_000);
    expect(ms("After the reply")).toBe(2_500);
  });

  test("a continue tied at its end says its target was learned at the end, and one whose tag named another message shows both", () => {
    const turn = turnAt();
    const run = turn.runs[0];
    if (run === undefined) throw new Error("no run");
    const learned: TurnReply = { ...turn, kind: "continue", message: "msg-9", runs: [{ ...run, kind: "continue", target: null }] };
    expect(view(learned)).toContain("the target was learned at the end: message msg-9");
    const named: TurnReply = { ...turn, kind: "continue", message: "msg-9", runs: [{ ...run, kind: "continue", target: "msg-7" }] };
    expect(view(named)).toContain("Its tag named message msg-7, and the end named message msg-9");
  });

  test("a turn marked interrupted by a restart says so with what it had staged, and one with no marks shows none", () => {
    const turn = turnAt();
    expect(view(turn)).not.toContain("Marks on this turn");
    const marked: TurnReply = { ...turn, marks: [{ kind: "interrupted", message: null, at: T0 }, { kind: "edited-message", message: "msg-4", at: T0 }] };
    expect(view(marked)).toContain("RPE restarted while a run of this turn went on; what it had staged was dropped.");
    expect(view(marked)).toContain("A message this turn stands on was edited after it was played (message msg-4).");
  });
});

describe("who perceived the turn", () => {
  test("a person on stage with no perception shows under none, and how the stage was read is said", () => {
    const stage = { turn: "t1", message: 3, read: "owner" as const, people: [{ name: "Ash", character: "c1", casting: "principal" as const, perceptions: ["p-1"] }, { name: "Wren", character: "c2", casting: "supporting" as const, perceptions: [] }] };
    const text = view(turnAt(), { stage });
    expect(text).toContain("Who perceived the turn");
    expect(text).toContain("No scene was recorded, so the stage was read from where your character stands.");
    expect(text).toContain("Wren");
    expect(text).toContain("1 person on stage with no perception of this turn: Wren.");
    expect(view(turnAt())).not.toContain("Who perceived the turn");
  });
});
