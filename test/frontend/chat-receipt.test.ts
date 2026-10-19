// The receipt under a reply (contract §4.8): at most three segments, then "n more"; what went wrong
// leads, so it never hides behind "n more", then time, money, the roll and the changes.
import { describe, expect, test } from "bun:test";
import { receiptLine } from "../../src/frontend/chips";
import type { Chip, ChipKind } from "../../src/shared/state-view";

const chip = (kind: ChipKind, label: string): Chip => ({ id: `${kind}:${label}`, kind, messageId: "m2", label, actions: [], expires: "never" });

describe("the receipt line", () => {
  test("shows three segments in receipt order, and counts the rest of the full list", () => {
    const line = receiptLine([chip("change", "3 changes"), chip("roll", "Persuade Rosie: success"), chip("elapsed", "+12 min"), chip("price", "Coffee $3.25"), chip("mode_change", "Purchases now apply automatically")]);
    expect(line.shown.map((c) => c.kind)).toEqual(["elapsed", "price", "roll"]);
    expect(line.more).toBe(2);
    expect(line.sorted.map((c) => c.kind)).toEqual(["elapsed", "price", "roll", "change", "mode_change"]);
  });

  test("a decline or a degraded turn leads the line, however many chips there are", () => {
    const line = receiptLine([chip("elapsed", "+5 min"), chip("price", "Coffee $3.25"), chip("roll", "Persuade Rosie: success"), chip("change", "Paid Dev $20"), chip("degraded", "Not fully simulated"), chip("decline", "Card declined")]);
    expect(line.shown.map((c) => c.kind)).toEqual(["decline", "degraded", "elapsed"]);
    expect(line.more).toBe(3);
  });

  test("three chips or fewer show whole, with nothing more", () => {
    expect(receiptLine([chip("elapsed", "+5 min"), chip("undo", "Paid Dev $20")])).toMatchObject({ more: 0 });
    expect(receiptLine([chip("elapsed", "+5 min"), chip("undo", "Paid Dev $20")]).shown).toHaveLength(2);
  });
});
