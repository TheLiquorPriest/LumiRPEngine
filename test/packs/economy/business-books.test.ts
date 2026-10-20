// Businesses' books and payouts (DESIGN §26.2), folded through Riverton: what a business counts as
// revenue and expenses, what it pays its owners, and how its dashboard names the people in it.

import { describe, expect, test } from "bun:test";
import type { BusinessView } from "../../../src/shared/finance";
import { calendarOf, clockOfLocal, dateAt } from "../../../src/engine/calendar";
import type { Working } from "../../../src/engine/working";
import { account, act, entity, ext, lapse, line, packEvents, posts, setup } from "./work-world";

const DAY = 1440;

/**
 * The café taking $500 a trading day from walk-in customers, give or take 30%, and paying out half
 * of each month's profit, from Friday 16 October to Wednesday 11 November.
 */
function tradingCafe(): Working {
  const { w } = setup((wd) => void Object.assign(wd.entities.daybreak!.fields, { daily_sales: 50_000, sales_spread_pct: 30, distribution_pct: 50, distribution_every: "month" }));
  lapse(w, 26 * DAY);
  return w;
}

describe("business books: takings and payables", () => {
  test("walk-in customers pay at closing on trading days, about the day's takings, with the sales tax on top", () => {
    const w = tradingCafe();
    const cal = calendarOf(w.world);
    const sales = packEvents(w, "economy.sale").map((e) => e.data);
    const takings = posts(w, /^Walk-in takings/);
    expect(takings).toHaveLength(sales.length);
    // At 17:00 on weekdays only, from Friday the 16th to Tuesday 10 November: eighteen of them.
    const closes = packEvents(w, "economy.flow_run").filter((e) => e.data.flow === "walkin:daybreak").map((e) => dateAt(cal, e.data.at as number));
    expect(closes.every((d) => d.weekday >= 1 && d.weekday <= 5 && d.minuteOfDay === 17 * 60)).toBe(true);
    expect(sales).toHaveLength(18);
    for (const [i, s] of sales.entries()) {
      expect(s.cents as number).toBeGreaterThanOrEqual(35_000);
      expect(s.cents as number).toBeLessThanOrEqual(65_000);
      expect(s.tax).toBe(Math.round(((s.cents as number) * 7) / 100));
      expect(s.cogs).toBe(Math.round(((s.cents as number) * 40) / 100));
      expect(line(takings[i]!, "db_operating")).toBe((s.cents as number) + (s.tax as number));
    }
  });

  test("the café pays its suppliers on the 10th and remits the sales tax it collected on the 20th", () => {
    const w = tradingCafe();
    const sales = packEvents(w, "economy.sale").map((e) => e.data);
    const sum = (key: string, before: number): number => sales.filter((_, i) => i < before).reduce((a, s) => a + (s.cents === undefined ? 0 : (s[key] as number)), 0);
    // Tuesday 20 October's 09:00 remittance covers the sales of the 16th and the 19th.
    const [tax] = posts(w, /^Sales tax/);
    expect(tax?.lines).toEqual([{ account: "db_operating", amount: -sum("tax", 2) }, { account: ext("tax:sales:us"), amount: sum("tax", 2) }]);
    // Tuesday 10 November's 09:00 payment covers what every sale before it cost: all but that day's.
    const [suppliers] = posts(w, /^Suppliers/);
    expect(suppliers?.lines).toEqual([{ account: "db_operating", amount: -sum("cogs", 17) }, { account: ext("suppliers:daybreak"), amount: sum("cogs", 17) }]);
  });

  test("a monthly distribution policy pays out half of last month's profit on the 10th", () => {
    const w = tradingCafe();
    const cal = calendarOf(w.world);
    const october = w.ctx.query("economy.business_books")(w.ctx, "daybreak", clockOfLocal(cal, "2026-10-01T00:00"), clockOfLocal(cal, "2026-11-01T00:00"));
    expect(october.profit).toBeGreaterThan(0);
    const [payout] = posts(w, /^Profit distribution/);
    expect(payout?.lines).toEqual([{ account: "db_operating", amount: -Math.round(october.profit / 2) }, { account: "maya_checking", amount: Math.round(october.profit / 2) }]);
  });
});

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
    wd.entities.acct_dv = account("acct_dv", "dana", "checking", 50_000);
    wd.entities.daybreak!.fields.owners = [
      { party: "you", role: "owner", share: 60 },
      { party: "dana", role: "owner", share: 40 },
    ];
    wd.entities.job_barista = entity("job_barista", "job", "Barista", { worker: "dana", employer: "daybreak", title: "Barista", occupation: "barista", splits: [{ to: "acct_dv", pct: 100 }] });
    wd.entities.inv_catering = entity("inv_catering", "invoice", "Catering", { business: "daybreak", customer: "dana", cents: 40_000, memo: "Catering", issued: "2026-10-01", due: "2026-11-01" });
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

  test("the player's view of their business names nobody they can't see, by name or by id", () => {
    const b = cafe(hiddenPartner(), true);
    expect(b?.owners.map((o) => o.name)).toEqual(["Alex Rivera", "an owner"]);
    // A masked owner goes out with no id, as every masked party in the money view does.
    expect(b?.owners.map((o) => o.party)).toEqual(["you", null]);
    expect(b?.employees.map((j) => j.worker)).toEqual(["an employee"]);
    expect(b?.invoices.map((i) => i.customerName)).toEqual(["a customer"]);
    expect(JSON.stringify(b).toLowerCase()).not.toContain("dana");
  });
});
