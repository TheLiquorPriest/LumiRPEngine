// Penalty taxes on kept earnings (DESIGN §26.3; IRC sections 531-547, 565), on Port Alder with the
// economy config's `taxes.penaltyTaxes` on: Harbor Holdings, Jordan's C corporation, takes $100,000
// of dividends and pays none out, so at the year close its income is all passive and one person holds
// it: on 15 April it pays personal holding company tax, 20% of what it kept, unless its holders
// consent to a dividend of it first, which moves no money but is Jordan's income and basis. An
// operating company keeping more than its $250,000 credit pays the accumulated earnings tax instead,
// and its opening earnings and profits use the credit up. Off (the default), nothing changes.

import { describe, expect, test } from "bun:test";
import type { Working } from "../../../src/engine/working";
import { basisRecord, incomeIn } from "../../../src/packs/economy/core/records";
import { closedYear, consentDividends, penaltyTaxFor } from "../../../src/packs/economy/core/year-close";
import { act, at, closeYear, corporation, income, JORDAN, lapseTo, operating, portAlder, posts, taxesOf, taxSettings, why } from "./tax-world";

const ON = taxSettings({ penaltyTaxes: true });

function holdingCompany(on = true): { w: Working; id: string } {
  const w = portAlder(on ? ON : () => undefined);
  const id = corporation(w, "Harbor Holdings");
  income(w, operating(w, id), 10_000_000, "dividends");
  return { w, id };
}

/** The chat on 15 April 2027, run through the day. */
function april(w: Working): Working {
  const x = at(w, "2027-04-13T08:00");
  lapseTo(x, "2027-04-16T12:00");
  return x;
}

// Each test closes the year of all of Port Alder, every household and company at once, and most run
// its 15 April too: a second or two alone, more with every core busy, so each is given 30 s.
describe("penalty taxes", () => {
  test("a personal holding company pays 20% on what it kept, booked on 15 April", () => {
    const { w, id } = holdingCompany();
    const jan = closeYear(w, 2026);
    const rec = closedYear(jan.state, id, 2026);
    expect(rec).toMatchObject({ passive: 10_000_000, top5: 100, dividends: 0 });
    // Half of a portfolio's dividends is deducted (the dividends-received deduction's smallest band).
    expect(Math.abs(Number(rec?.taxable) - 5_000_000)).toBeLessThan(100_000);
    const tax = penaltyTaxFor(jan.ctx, id, 2026);
    expect(tax).toMatchObject({ kind: "phc", credit: 0, passivePct: 100, top5: 100 });
    expect(tax?.cents).toBe(Math.round(((tax?.kept ?? 0) * 20) / 100));
    expect(taxesOf(jan, id).penalty).toMatchObject({ on: true, last: { kind: "phc", cents: tax?.cents, paid: false } });
    const paid = april(jan);
    const [post] = posts(paid, /^Personal holding company tax, 2026$/);
    expect(post?.lines).toEqual([
      { account: operating(paid, id), amount: -(tax?.cents ?? 0) },
      { account: "economy.external:tax:federal", amount: tax?.cents ?? 0 },
    ]);
    expect(taxesOf(paid, id).penalty?.last?.paid).toBe(true);
  }, 30_000);

  test("a consent dividend before the return clears it: no money moves, and it is Jordan's income and basis for 2026", () => {
    const { w, id } = holdingCompany();
    const jan = closeYear(w, 2026);
    const kept = penaltyTaxFor(jan.ctx, id, 2026)?.kept ?? 0;
    expect(kept).toBeGreaterThan(0);
    const feb = at(jan, "2027-02-01T09:00");
    const cash = feb.state.entities[operating(feb, id)];
    const before = { income: incomeIn(feb.state, JORDAN, 2026).dividend, basis: basisRecord(feb.state, id, JORDAN)?.basis ?? 0, posts: posts(feb, /./).length };
    expect(why(act(feb, JORDAN, "consent_dividend", { org: id, amount: kept }))).toBe("");
    expect(consentDividends(feb.state, id, 2026)).toBe(kept);
    expect(incomeIn(feb.state, JORDAN, 2026).dividend).toBe(before.income + kept);
    expect(basisRecord(feb.state, id, JORDAN)?.basis).toBe(before.basis + kept);
    expect(posts(feb, /./).length).toBe(before.posts);
    expect(feb.state.entities[operating(feb, id)]).toEqual(cash);
    expect(penaltyTaxFor(feb.ctx, id, 2026)?.cents).toBe(0);
    expect(posts(april(feb), /^Personal holding company tax/)).toEqual([]);
    // After its return is due, last year's is closed to it.
    expect(why(act(at(jan, "2027-05-01T09:00"), JORDAN, "consent_dividend", { org: id, amount: 1_000, year: 2026 }))).toContain("until its return is filed on 15 April");
  }, 30_000);

  test("an operating company keeping more than its credit pays the accumulated earnings tax; opening E&P uses the credit up", () => {
    const w = portAlder(ON);
    const id = corporation(w, "Harbor Towing");
    // Its trade's takings: not passive income.
    income(w, operating(w, id), 40_000_000, "services");
    const jan = closeYear(w, 2026);
    const tax = penaltyTaxFor(jan.ctx, id, 2026);
    expect(tax).toMatchObject({ kind: "aet", credit: 25_000_000 });
    expect(tax?.cents).toBe(Math.round((Math.max(0, (tax?.kept ?? 0) - 25_000_000) * 20) / 100));
    expect(tax?.cents).toBeGreaterThan(0);
    const [post] = posts(april(jan), /^Accumulated earnings tax, 2026$/);
    expect(post?.lines[1]).toEqual({ account: "economy.external:tax:federal", amount: tax?.cents ?? 0 });

    const kept = portAlder(ON);
    const other = corporation(kept, "Harbor Towing");
    expect(kept.apply({ type: "set", entity: other, field: "opening_ep", value: 25_000_000 })).toBeNull();
    income(kept, operating(kept, other), 40_000_000, "services");
    const closed = closeYear(kept, 2026);
    expect(penaltyTaxFor(closed.ctx, other, 2026)).toMatchObject({ kind: "aet", credit: 0 });
    expect(closedYear(closed.state, other, 2026)?.epStart).toBe(25_000_000);
  }, 30_000);

  test("off, the default: no close for a profitable corporation, nothing booked, Taxes says it's off", () => {
    const { w, id } = holdingCompany(false);
    const jan = closeYear(w, 2026);
    expect(closedYear(jan.state, id, 2026)).toBeNull();
    expect(jan.events.some((e) => e.type === "economy.year_close")).toBe(false);
    expect(taxesOf(jan, id).penalty).toMatchObject({ on: false, last: null });
    expect(posts(april(jan), /^(Personal holding company|Accumulated earnings) tax/)).toEqual([]);
  }, 30_000);
});
