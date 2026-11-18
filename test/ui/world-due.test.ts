// What the World page says of what a turn's time brought due: each item with what was recorded for it, and how many of them have
// nothing recorded, counted from the very items it lists.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { DueReply } from "../../src/shared/api";
import { DueSection } from "../../src/ui/pages/world";
import { expand, textOf } from "./vnodes";

const item = (words: string, changes: string[]): DueReply["items"][number] => ({ label: "Where", words, when: "Tue 14 Sep, 9:00 AM", at: null, changes });
const read = (items: DueReply["items"], more: number | null): DueReply => ({ turn: "turn-1", span: { from: "Mon 14 Sep, 8:00 AM", to: "Tue 15 Sep, 8:00 AM" }, items, more });

describe("what the time brought due, on the World page", () => {
  test("says how many of the listed items have nothing recorded, from the items themselves", () => {
    const text = textOf(expand(h(DueSection, { read: read([item("Tam is due at the market", ["Tam is now at the market"]), item("Wren is due at the inn", []), item("The weather turns", [])], 0) })));
    expect(text).toContain("2 of these 3 have no outcome recorded yet.");
    const one = textOf(expand(h(DueSection, { read: read([item("Tam is due at the market", ["Tam is now at the market"]), item("Wren is due at the inn", [])], 0) })));
    expect(one).toContain("1 of these 2 has no outcome recorded yet.");
  });

  test("says nothing of what is left when every item has an outcome, or when the list does not hold them all", () => {
    expect(textOf(expand(h(DueSection, { read: read([item("Tam is due at the market", ["Tam is now at the market"])], 0) })))).not.toContain("no outcome recorded yet.");
    const cut = textOf(expand(h(DueSection, { read: read([item("Wren is due at the inn", [])], 4) })));
    expect(cut).not.toContain("of these");
    expect(cut).toContain("4 more items fell due than this list holds.");
  });
});
