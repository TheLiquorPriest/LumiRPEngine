// The marks of a reply under it (src/ui/chat/surfaces/reply-line.tsx): each kind once, as the short word the
// Turns page badges it with, meaning in the Turns page's own words; a kind the page has no words for by its name.

import { describe, expect, test } from "bun:test";
import { marksShown } from "../../../src/ui/chat/surfaces/reply-line";
import { MARK_BADGES, markWords } from "../../../src/ui/pages/turns/sections/marks";

describe("the marks under a reply", () => {
  test("each kind once, as its short word with its meaning, and an unknown kind by its name", () => {
    const shown = marksShown([{ kind: "edited-reply" }, { kind: "interrupted" }, { kind: "edited-reply" }, { kind: "a-new-kind" }]);
    expect(shown.map((m) => m.word)).toEqual([MARK_BADGES["edited-reply"], MARK_BADGES.interrupted, "a-new-kind"]);
    expect(shown[0]?.meaning).toBe(markWords({ kind: "edited-reply", message: null }));
    expect(shown[2]?.meaning).toContain("a-new-kind");
    expect(marksShown([])).toEqual([]);
  });
});
