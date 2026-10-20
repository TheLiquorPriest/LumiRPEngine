// Section token costs (DESIGN §6.3): a section costs what the host's tokenizer counted for its exact
// rendered text (header and bullets included) once counted; until then, or when the host can't
// count, a margin-padded estimate that stays above the character estimate stands in.

import { describe, expect, test } from "bun:test";
import { sectionTokens } from "../../src/backend/book";
import { Rig } from "../support/rig";

/** The latest interceptor run's slot texts and the inspector's costs for them, by label. */
function slots(rig: Rig, chatId: string): { label: string; text: string; tokens: number }[] {
  const record = rig.rt.inspectorRecords(chatId)?.at(-1);
  const texts = rig.host.assembled.map((e) => e.content);
  return (record?.sections ?? []).filter((s) => !s.clipped).flatMap((s) => {
    const text = texts.find((t) => t.startsWith(`[${s.label}]\n`));
    return text ? [{ label: s.label, text, tokens: s.tokens }] : [];
  });
}

describe("section token costs", () => {
  test("a section costs the host's count of its exact rendered text once counted; the estimate stands in before", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const first = slots(rig, chatId);
    expect(first.length).toBeGreaterThan(0);
    // Not counted yet: the estimate, while the exact texts go to the host in the background.
    for (const s of first) expect(s.tokens).toBe(sectionTokens(s.text));
    const asked = rig.host.tokenCalls.flat();
    for (const s of first) expect(asked).toContain(s.text);
    expect(asked.every((t) => /^\[[^\]]+\]\n/.test(t) && t.includes("\n- "))).toBe(true);
    // A Re-narrate renders the same sections again: now each costs the host's count.
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const g = await rig.host.start(chatId, { type: "swipe", messageId: head.id });
    const again = slots(rig, chatId);
    const count = rig.host.tokenCount;
    if (!count) throw new Error("no count");
    const same = again.filter((s) => first.some((f) => f.text === s.text));
    expect(same.length).toBeGreaterThan(0);
    for (const s of same) expect(s.tokens).toBe(count(s.text));
    await rig.host.finish(g, "Still quiet.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("when the host can't count, the estimate covers the header, the bullets and the numbers", async () => {
    const rig = new Rig();
    rig.host.tokenCount = null;
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    const sections = slots(rig, chatId);
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(s.tokens).toBe(sectionTokens(s.text));
      const bullets = s.text.split("\n- ").length - 1;
      expect(s.tokens).toBeGreaterThanOrEqual(Math.ceil(s.text.length / 4) + 2 + bullets);
    }
  });
});
