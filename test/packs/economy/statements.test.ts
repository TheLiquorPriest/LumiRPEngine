// Statements (DESIGN §26.5) on Riverton's Daybreak Café after a few weeks' trading: operating income
// is revenue less its cost and the operating expenses; net income is the books' profit; the cash
// flow's sections, with corrections and openings apart, add up to the change in cash; assets less
// liabilities are the net worth; a correction or a transfer between its own accounts moves no line.
// Where nothing depreciates EBITDA is operating income and says so; with straight-line depreciation a
// built asset's month posts once, and EBITDA is operating income before it; a bought one depreciates
// on its purchase price though nothing in the world carries a capital cost. Cost depletion follows
// what a mineral interest produced, never past its cost.

import { describe, expect, test } from "bun:test";
import { CLASS_TRAITS, type FinanceView, type StatementPeriod, type StatementsView } from "../../../src/shared/finance";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal, dateAt } from "../../../src/engine/calendar";
import { optionalService } from "../../../src/engine/pack-kit";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import type { Working } from "../../../src/engine/working";
import { recoveryFor } from "../../../src/packs/economy/core/depreciation";
import { act, entity, packEvents, reg, setup } from "./work-world";

const DAY = 1440;

/** Lets `days` pass, past each stop at the unit cap. */
function lapse(w: Working, days: number): void {
  const to = w.state.clock + days * DAY;
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "duration", minutes: to - w.state.clock }, { runSeed: "statements", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** Daybreak Café taking walk-in sales for `days` days, its world patched. */
function trading(days: number, patch: (w: WorldDoc) => void = () => undefined): Working {
  const { w } = setup((wd) => {
    Object.assign(wd.entities.daybreak!.fields, { daily_sales: 50_000, sales_spread_pct: 30 });
    patch(wd);
  });
  lapse(w, days);
  return w;
}

function view(w: Working, party: string): FinanceView {
  return w.ctx.query("economy.finance")(w.ctx, party, false);
}

function statements(w: Working, party: string): StatementsView {
  const s = view(w, party).statements;
  if (!s) throw new Error(`no statements for ${party}`);
  return s;
}

function period(s: StatementsView, id: StatementPeriod["id"]): StatementPeriod {
  const p = s.periods.find((x) => x.id === id);
  if (!p) throw new Error(`no period ${id}`);
  return p;
}

describe("statements", () => {
  test("operating income is revenue less its cost and the operating expenses, and net income is the books' profit", () => {
    const w = trading(26);
    const s = statements(w, "daybreak");
    expect(s.kind).toBe("books");
    const cal = calendarOf(w.world);
    const year = dateAt(cal, w.state.clock).year;
    for (const id of ["month", "ytd", "twelve_months"] as const) {
      const i = period(s, id).income;
      expect(i.operatingIncome).toBe(i.revenue - i.cogs - i.opex - i.depreciation - i.depletion);
      expect(i.netIncome).toBe(i.operatingIncome - i.interest + i.investmentIncome - i.tax);
    }
    const ytd = period(s, "ytd").income;
    expect(ytd.revenue).toBeGreaterThan(0);
    expect(ytd.cogs).toBeGreaterThan(0);
    const books = w.ctx.query("economy.business_books")(w.ctx, "daybreak", clockOfLocal(cal, `${year}-01-01`), w.state.clock + 1);
    expect(ytd.netIncome).toBe(books.profit);
    expect(ytd.revenue + ytd.investmentIncome).toBe(books.revenue);
  });

  test("the cash flow's sections, with corrections and openings apart, add up to the change in cash, which ends at the cash held", () => {
    const w = trading(26);
    const s = statements(w, "daybreak");
    const held = view(w, "daybreak")
      .accounts.filter((a) => CLASS_TRAITS[a.class].asset && !CLASS_TRAITS[a.class].receivable)
      .reduce((sum, a) => sum + a.cents, 0);
    for (const p of s.periods) {
      const c = p.cash;
      expect(c.operating + c.investing + c.financing + c.owners + c.corrections + c.openings).toBe(c.change);
      expect(c.end - c.start).toBe(c.change);
      expect(c.lines.reduce((sum, l) => sum + l.cents, 0)).toBe(c.change);
    }
    expect(period(s, "month").cash.end).toBe(held);
    expect(period(s, "ytd").cash.end).toBe(held);
  });

  test("assets less liabilities are the net worth", () => {
    const w = trading(10);
    for (const party of ["daybreak", "maya", "brightline"]) {
      const b = statements(w, party).balance;
      expect(b.assets - b.liabilities).toBe(b.equity);
      expect(b.equity).toBe(view(w, party).overview?.netWorth ?? NaN);
    }
  });

  test("a correction or a transfer between its own accounts moves no line", () => {
    const w = trading(12);
    const before = period(statements(w, "daybreak"), "month");
    const events = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "db_operating", 100_000);
    if (!Array.isArray(events)) throw new Error("the correction was refused");
    w.applyAll(events);
    expect(act(w, "economy.open_account", { party: "daybreak", product: "savings", name: "Café savings" }).rejected).toEqual([]);
    const savings = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === "Café savings") ?? "";
    expect(act(w, "economy.move", { from: "db_operating", to: savings, cents: 50_000 }).rejected).toEqual([]);
    const after = period(statements(w, "daybreak"), "month");
    expect(after.income).toEqual(before.income);
    const sections = (p: StatementPeriod) => ({ operating: p.cash.operating, investing: p.cash.investing, financing: p.cash.financing, owners: p.cash.owners, lines: p.cash.lines.filter((l) => l.section !== "correction") });
    expect(sections(after)).toEqual(sections(before));
    expect(after.cash.corrections).toBe(before.cash.corrections + 100_000);
    expect(after.cash.change).toBe(before.cash.change + 100_000);
  });

  test("where nothing depreciates, EBITDA is operating income, and the statements say why", () => {
    const s = statements(trading(5), "daybreak");
    expect(s.depreciation).toBe("none");
    expect(s.ebitdaNote).toContain("Nothing depreciates");
    for (const p of s.periods) expect(p.income.ebitda).toBe(p.income.operatingIncome);
  });

  test("a person's statements are their income and spending", () => {
    const s = statements(trading(12), "maya");
    expect(s.kind).toBe("personal");
    expect(s.ebitdaNote).toBeNull();
    for (const p of s.periods) expect(p.income.netIncome).toBe(p.income.revenue - p.income.opex - p.income.cogs - p.income.interest + p.income.investmentIncome - p.income.tax);
  });
});

describe("depreciation and depletion", () => {
  /** Riverton depreciating straight-line, Daybreak's $1,200 oven in service since 20 September over a year. */
  function oven(): Working {
    return trading(17, (wd) => {
      const economy = wd.packs.economy;
      if (economy) economy.config = { ...economy.config, depreciation: "straight_line" };
      const year = wd.start.at.slice(0, 4);
      wd.entities.oven = entity("oven", "property", "Bakery oven", { owners: [{ party: "daybreak", role: "owner" }], value: 120_000, capital_cost: 120_000, life_months: 12, in_service: `${year}-09-20` });
    });
  }

  test("straight-line: a month's depreciation posts once on the 1st, and EBITDA is operating income before it", () => {
    const w = oven();
    const posted = packEvents(w, "economy.depreciate");
    expect(posted.map((e) => e.data)).toEqual([expect.objectContaining({ asset: "oven", kind: "depreciation", cents: 10_000, parts: [{ party: "daybreak", cents: 10_000 }] })]);
    const s = statements(w, "daybreak");
    expect(s.depreciation).toBe("straight_line");
    expect(s.ebitdaNote).toBeNull();
    const last = period(s, "last_month").income;
    expect(last.depreciation).toBe(10_000);
    expect(last.ebitda - last.operatingIncome).toBe(10_000);
    const cal = calendarOf(w.world);
    const month = clockOfLocal(cal, `${posted[0]?.data.month as string}-01`);
    expect(last.netIncome).toBe(w.ctx.query("economy.business_books")(w.ctx, "daybreak", month, clockOfLocal(cal, `${dateAt(cal, w.state.clock).year}-${String(dateAt(cal, w.state.clock).month).padStart(2, "0")}-01`)).profit);
  });

  test("an organization that says none doesn't depreciate in a world that does", () => {
    const w = trading(17, (wd) => {
      const economy = wd.packs.economy;
      if (economy) economy.config = { ...economy.config, depreciation: "straight_line" };
      wd.entities.daybreak!.fields.depreciation = "none";
      wd.entities.oven = entity("oven", "property", "Bakery oven", { owners: [{ party: "daybreak", role: "owner" }], value: 120_000, capital_cost: 120_000, life_months: 12, in_service: `${wd.start.at.slice(0, 4)}-09-20` });
    });
    expect(packEvents(w, "economy.depreciate")).toEqual([]);
    expect(statements(w, "daybreak").depreciation).toBe("none");
  });

  test("regression: a bought oven, its purchase price and life alone, depreciates with no capital cost anywhere in the world", () => {
    const w = trading(17, (wd) => {
      const economy = wd.packs.economy;
      if (economy) economy.config = { ...economy.config, depreciation: "straight_line" };
      wd.entities.oven = entity("oven", "property", "Bakery oven", { owners: [{ party: "daybreak", role: "owner" }], value: 120_000, purchase_price: 120_000, life_months: 12, in_service: `${wd.start.at.slice(0, 4)}-09-20` });
    });
    expect(packEvents(w, "economy.depreciate").map((e) => e.data)).toEqual([expect.objectContaining({ asset: "oven", kind: "depreciation", cents: 10_000, parts: [{ party: "daybreak", cents: 10_000 }] })]);
  });

  test("cost depletion is the cost over the reserves times what was produced, never past the cost", () => {
    const state = (recovered: number): WorldState => ({ clock: 0, entities: { mine: { id: "mine", kind: "property", name: "Mineral interest", tier: "background", fields: { capital_cost: 50_000, reserves: 1000 }, relations: [] } }, packs: { economy: { produced: { mine: { "2026-10": 100 } }, depreciated: { mine: { cents: recovered } } } } }) as unknown as WorldState;
    expect(recoveryFor(state(0), "mine", "2026-10")).toEqual({ kind: "depletion", cents: 5000 });
    expect(recoveryFor(state(48_000), "mine", "2026-10")).toEqual({ kind: "depletion", cents: 2000 });
    expect(recoveryFor(state(0), "mine", "2026-11")).toBeNull();
  });
});
