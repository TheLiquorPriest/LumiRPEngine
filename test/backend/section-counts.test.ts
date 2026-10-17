// Host token counts of section texts (DESIGN §6.3) are kept per user, since the host counts with
// each user's own tokenizer, and a count that can't be right is ignored instead of pricing a section.

import { describe, expect, test } from "bun:test";
import { sectionTokens } from "../../src/backend/book";
import { Rig } from "../support/rig";

/** The latest interceptor run's sections, with the text each sent and the cost the inspector gave it. */
function sections(rig: Rig, chatId: string): { slot: string; text: string; tokens: number; clipped: boolean }[] {
  const record = rig.rt.inspectorRecords(chatId)?.at(-1);
  const texts = rig.host.lastInterceptor?.mutated.map((m) => m.content ?? "") ?? [];
  return (record?.sections ?? []).map((s) => ({ slot: s.slot, text: texts.find((t) => t.startsWith(`[${s.label}]\n`)) ?? "", tokens: s.tokens, clipped: s.clipped }));
}

describe("host token counts of sections", () => {
  for (const [name, bogus] of [
    ["a billion", 1e9],
    ["negative", -5],
    ["not a number", Number.NaN],
  ] as const) {
    test(`a host count that is ${name} is ignored: the estimate stands in and nothing is clipped for it`, async () => {
      const rig = new Rig();
      rig.host.tokenCount = () => bogus;
      const chatId = await rig.worldChat();
      await rig.turn(chatId, "I look around.", "Quiet.");
      await rig.turn(chatId, "I look around again.", "Still quiet.");
      const shown = sections(rig, chatId);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.filter((s) => s.clipped)).toEqual([]);
      for (const s of shown) expect(s.tokens).toBe(sectionTokens(s.text));
      expect(rig.rt.ledger.errors).toEqual([]);
    });
  }

  test("one user's host count never prices another user's section", async () => {
    const rig = new Rig();
    const first = await rig.worldChat();
    await rig.turn(first, "I look around.", "Quiet.");
    await rig.turn(first, "I look around again.", "Still quiet.");
    const count = rig.host.tokenCount;
    if (!count) throw new Error("no count");
    const counted = sections(rig, first).filter((s) => s.text !== "" && s.tokens === count(s.text) && s.tokens !== sectionTokens(s.text));
    expect(counted.length).toBeGreaterThan(0);
    // A second user of the same backend plays the same world (the fake host serves one user at a time).
    Object.assign(rig.host, { userId: "user-2" });
    const second = await rig.worldChat();
    await rig.turn(second, "I look around.", "Quiet.");
    const theirs = sections(rig, second).filter((s) => s.text !== "");
    expect(theirs.some((s) => counted.some((c) => c.text === s.text))).toBe(true);
    for (const s of theirs) expect(s.tokens).toBe(sectionTokens(s.text));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
