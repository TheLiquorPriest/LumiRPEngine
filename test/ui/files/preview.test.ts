// A prompt part's preview: which files it is offered for, and what it says of a render and its problems.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { isPart, PreviewView } from "../../../src/ui/pages/files/preview";
import { expand, textOf } from "../vnodes";

describe("the Prompts preview", () => {
  test("a prompt part and a tool's description are previewed, no other file", () => {
    expect(isPart(".prompts/reply-contract.md")).toBe(true);
    expect(isPart("@global/.tools/world_apply.md")).toBe(true);
    expect(isPart("rules/consent.md")).toBe(false);
  });

  test("a render shows its text, the fields it names and the one never given; a draft that does not parse says why in RPH's words", () => {
    const ok = textOf(expand(h(PreviewView, { reply: { kind: "prompt", name: "briefing", values: { turn: 4 }, fields: ["turn", "mood"], text: "Turn 4.", missing: ["mood"], problems: [] }, problem: null, asking: false })));
    expect(ok).toContain("Turn 4.");
    expect(ok).toContain("Fields it names: turn, mood");
    expect(ok).toContain("mood: the part is never given this field");
    const bad = textOf(expand(h(PreviewView, { reply: { kind: "prompt", name: "briefing", values: null, fields: [], missing: [], problems: [{ line: 3, message: "A block is never closed." }] }, problem: null, asking: false })));
    expect(bad).toContain("Line 3: A block is never closed.");
    expect(bad).toContain("It does not read as it stands");
  });
});
