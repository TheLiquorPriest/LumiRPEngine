// Businesses' books and payouts (DESIGN §26.2), folded through Riverton: what a business counts as
// revenue and expenses, what it pays its owners, and how its dashboard names the people in it.

import { describe, expect, test } from "bun:test";
import type { BusinessView } from "../../../src/shared/finance";
import type { Working } from "../../../src/engine/working";
import { account, act, entity, line, packEvents, posts, setup } from "./work-world";

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

describe("business books: revenue and expenses", () => {
  test("borrowing money and buying investments move the balance sheet, not the books", () => {
    const { w } = setup((wd) => {
      wd.packs.economy!.config = { ...wd.packs.economy!.config, assets: { acme: { label: "Acme Corp", symbol: "ACME", class: "security", price: 10_000 } } };
    });
    expect(act(w, "economy.apply_credit", { who: "daybreak", product: "loan", cents: 500_000, term: 24 }).rejected).toEqual([]);
    expect(posts(w, /loan paid out/).some((p) => line(p, "db_operating") === 500_000)).toBe(true);
    expect(act(w, "economy.trade", { party: "daybreak", side: "buy", asset: "acme", amount: 300_000, from: "db_operating" }).rejected).toEqual([]);
    expect(posts(w, /^Bought/).some((p) => line(p, "db_operating") === -300_000)).toBe(true);
    const books = w.ctx.query("economy.business_books")(w.ctx, "daybreak", w.state.clock - 1440, w.state.clock + 1);
    expect(books).toMatchObject({ revenue: 0, expenses: 0, profit: 0 });
  });
});

describe("business books: invoices", () => {
  test("customers outside the world are billed at most the world's cap on unlisted prices in a month", () => {
    const { w } = setup();
    // Riverton's own price data tops out at $6,000.
    const bill = (customer: Record<string, string>, cents: number, seed: string) => act(w, "economy.invoice_issue", { business: "brightline", ...customer, cents, memo: "Freight", by: "jordan" }, seed).rejected;
    expect(bill({ customer_name: "Acme Freight" }, 700_000, "i1")).toHaveLength(1);
    expect(bill({ customer_name: "Acme Freight" }, 500_000, "i2")).toEqual([]);
    expect(bill({ customer_name: "Lakeview Shipping" }, 200_000, "i3")).toHaveLength(1);
    expect(bill({ customer_name: "Lakeview Shipping" }, 100_000, "i4")).toEqual([]);
    // Someone in the world pays from their own money, so their invoices aren't bounded this way.
    expect(bill({ customer: "rosa" }, 700_000, "i5")).toEqual([]);
    expect(Object.values(w.state.entities).filter((e) => e.kind === "invoice").map((e) => e.fields.cents)).toEqual([500_000, 100_000, 700_000]);
  });
});

/**
 * The player owns most of the Daybreak Café; Dana Vale, whom the player has never seen, owns the
 * rest, works there and owes it for an order.
 */
function hiddenPartner(): Working {
  const { w } = setup((wd) => {
    wd.entities.dana = { ...entity("dana", "person", "Dana Vale", { place: "cafe", region: "oh" }), visibility: "secret" };
    wd.entities.dana_checking = account("dana_checking", "dana", "checking", 50_000);
    wd.entities.daybreak!.fields.owners = [
      { party: "you", role: "owner", share: 60 },
      { party: "dana", role: "owner", share: 40 },
    ];
    wd.entities.job_dana = entity("job_dana", "job", "Barista", { worker: "dana", employer: "daybreak", title: "Barista", occupation: "barista", splits: [{ to: "dana_checking", pct: 100 }] });
    wd.entities.inv_dana = entity("inv_dana", "invoice", "Catering", { business: "daybreak", customer: "dana", cents: 40_000, memo: "Catering", issued: "2026-10-01", due: "2026-11-01" });
  });
  return w;
}

/** The Daybreak Café on the player's own money view, as the player sees it or as the GM does. */
function cafe(w: Working, player: boolean): BusinessView | undefined {
  const view = player ? w.ctx.query("economy.finance")(w.ctx, "you", true) : w.ctx.query("economy.people_money")(w.ctx).find((m) => m.party === "you");
  return view?.businesses.find((b) => b.id === "daybreak");
}

describe("business books: dashboards", () => {
  test("the GM's view of the player's business names everyone in it", () => {
    const b = cafe(hiddenPartner(), false);
    expect(b?.owners.map((o) => o.name)).toEqual(["Alex Rivera", "Dana Vale"]);
    expect(b?.employees.map((j) => j.worker)).toEqual(["Dana Vale"]);
    expect(b?.invoices.map((i) => i.customerName)).toEqual(["Dana Vale"]);
  });
});
