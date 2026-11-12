// The preview's chat on the harness (dev/preview/harness-fixture.ts): its review chip is stored as the
// engine stores one (`Review.save`), so the pages are judged on what a player would see. The chip's
// label counts the changes still open, and once none is, it offers nothing to press. Its stand-in
// for LumiAH's backend reads a page's request as LumiAH's pages send one, its fields beside its type.

import { describe, expect, test } from "bun:test";
import { UI_VERSION } from "lumi-ah/shared";
import { answerReview, HarnessPreview, harnessChips, harnessReview, reviewChip } from "../../dev/preview/harness-fixture";

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

describe("the preview's stand-in for LumiAH's backend", () => {
  /** One request as LumiAH's pages send it (`{ lah, type, reqId, ...body }`), and the body it is answered with. */
  const ask = (preview: HarnessPreview, type: string, body: Record<string, unknown> = {}): unknown => {
    const answer = preview.answer(structuredClone({ lah: UI_VERSION, type, reqId: `r-${type}`, ...body })) as { type: string; body?: unknown; message?: string };
    if (answer.type !== "lah.result") throw new Error(`${type} was refused: ${answer.message ?? ""}`);
    return answer.body;
  };

  test("answers each request by its own fields: a sign-in by its provider, a Timeouts row set and read back, a connection saved and made the default", () => {
    const preview = new HarnessPreview("chat-1");
    expect(ask(preview, "lah.signin.state", { relay: "rt-home", provider: "anthropic" })).toMatchObject({ provider: "anthropic", signedIn: true });
    expect(ask(preview, "lah.signin.state", { relay: "rt-home", provider: "openai" })).toMatchObject({ provider: "openai", signedIn: false });
    const set = ask(preview, "lah.settings.set", { set: [{ path: ["transport", "pages", "askMs"], value: 40_000 }], reset: [] }) as { settings: { values: { transport: { pages: { askMs: number } } } } };
    expect(set.settings.values.transport.pages.askMs).toBe(40_000);
    const saved = ask(preview, "lah.connections.save", { relay: "rt-home", connection: { name: "Mine", provider: "openai", auth: "key", model: "gpt-5" }, key: "sk-made-up-0123456789" }) as { saved: { id: string; key: { set: boolean; last4: string | null } } };
    expect(saved.saved.key).toEqual({ set: true, last4: "6789" });
    expect(ask(preview, "lah.connections.default", { relay: "rt-home", id: saved.saved.id })).toMatchObject({ default: saved.saved.id });
  });
});
