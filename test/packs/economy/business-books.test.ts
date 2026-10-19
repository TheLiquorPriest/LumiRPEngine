// Businesses' books and payouts (DESIGN §26.2), folded through Riverton: what a business counts as
// revenue and expenses, and what it pays its owners.

import { describe, expect, test } from "bun:test";
import { act, line, packEvents, posts, setup } from "./work-world";

describe("business books: payouts", () => {
  test("paying out profit twice pays each sale's profit once", () => {
    // The player buys lattes at the Daybreak Café (a 60% margin); Maya owns it all.
    const { w } = setup((wd) => void (wd.entities.you!.fields.place = "cafe"));
    const profitOf = (i: number): number => {
      const sale = packEvents(w, "economy.sale")[i]?.data ?? {};
      return (sale.cents as number) - (sale.cogs as number);
    };
    const payouts = (): number[] => posts(w, /^Profit distribution/).map((p) => line(p, "maya_checking"));
    expect(act(w, "economy.buy", { payer: "you", item: "latte_16oz", method: "debit" }, "b1").rejected).toEqual([]);
    expect(act(w, "economy.distribute", { business: "daybreak", by: "maya" }, "d1").rejected).toEqual([]);
    expect(act(w, "economy.buy", { payer: "you", item: "latte_16oz", method: "debit" }, "b2").rejected).toEqual([]);
    expect(act(w, "economy.distribute", { business: "daybreak", by: "maya" }, "d2").rejected).toEqual([]);
    expect(payouts()).toEqual([profitOf(0), profitOf(1)]);
    // Nothing is left to pay out.
    expect(act(w, "economy.distribute", { business: "daybreak", by: "maya" }, "d3").rejected).toHaveLength(1);
  });
});
