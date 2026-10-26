// GM → This chat → Sections' preview: each section says what it holds, or why it holds nothing.

import { describe, expect, test } from "bun:test";
import { previewNotes } from "../../src/frontend/gm/section-preview";
import type { SectionPreview } from "../../src/shared/protocol";
import { SCOPE_LABEL } from "../../src/shared/world";

const budget = { sections: 1200, used: 300, minds: 600 };
const section = (more: Partial<SectionPreview>): SectionPreview => ({ slot: "people", label: "People", status: "sent", scope: "player", content: "[People]\n- Ana is here.", tokens: 42, cut: 0, marked: 0, hints: 0, ...more });

describe("the section preview's notes", () => {
  test("a sent section gives its size, its scope and what rides in it; an off one none of that", () => {
    const sent = previewNotes(section({ scope: "gm", marked: 3, cut: 2 }), budget).join("\n");
    expect(sent).toContain("42");
    expect(sent.toLowerCase()).toContain(SCOPE_LABEL.gm.toLowerCase());
    expect(sent).toContain("3");
    expect(sent).toContain("2");
    const off = previewNotes(section({ status: "off", content: null, tokens: null, scope: "gm" }), budget).join("\n");
    expect(off).not.toContain("42");
    expect(off.toLowerCase()).not.toContain(SCOPE_LABEL.gm.toLowerCase());
    expect(off).not.toBe("");
  });

  test("an empty section the turn writes says so, beyond what any empty section says", () => {
    const empty = { status: "empty" as const, content: null, tokens: null };
    expect(previewNotes(section({ ...empty, slot: "outcome" }), budget).length).toBeGreaterThan(previewNotes(section(empty), budget).length);
  });

  test("an over-budget section names the budget it is over: the Minds section its own", () => {
    const clipped = { status: "clipped" as const, content: null };
    expect(previewNotes(section({ ...clipped, slot: "minds" }), budget).join(" ")).toContain(String(budget.minds));
    expect(previewNotes(section(clipped), budget).join(" ")).toContain(String(budget.sections));
  });
});
