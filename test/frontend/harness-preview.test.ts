// The preview's chat on the harness (dev/preview/harness-fixture.ts): its review chip is stored as the
// engine stores one (`Review.save`), so the pages are judged on what a player would see. The chip's
// label counts the changes still open, and once none is, it offers nothing to press.

import { describe, expect, test } from "bun:test";
import { answerReview, harnessChips, harnessReview, reviewChip } from "../../dev/preview/harness-fixture";

describe("the preview's review chip on the harness", () => {
  test("its label counts what is still open, as the engine's does, and it asks nothing once all is answered", () => {
    const cards = harnessReview();
    const [card] = cards;
    if (!card) throw new Error("the preview has no review card");
    const open = card.items.length;
    expect(reviewChip(cards).label).toBe(`${String(open)} changes to review`);
    expect(reviewChip(cards).actions.map((a) => a.id)).toEqual(["apply", "reject"]);
    // One applied: one fewer to review.
    const first = card.items[0]?.key ?? "";
    expect(reviewChip(answerReview(cards, card.turn, { apply: [first] })).label).toBe(`${String(open - 1)} changes to review`);
    // All turned down: nothing left to answer.
    const done = reviewChip(answerReview(cards, card.turn, "reject"));
    expect([done.label, done.actions]).toEqual(["0 changes to review", []]);
  });

  test("the chat's chips hold that one review chip, under the reply its card belongs to", () => {
    const cards = harnessReview();
    const reviews = harnessChips([], "the reply was stopped", cards).filter((chip) => chip.kind === "review");
    expect(reviews.map((chip) => [chip.messageId, chip.label])).toEqual([[cards[0]?.messageId, reviewChip(cards).label]]);
  });
});
