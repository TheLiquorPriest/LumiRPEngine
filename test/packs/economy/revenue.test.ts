// Revenue streams (DESIGN §26.2, Revenue streams), folded through the work module's test world: a
// catalog taxed by each line's category, a royalty's decline in exact cents, the bounds on the agents'
// adjustments, the preview against a year of postings, and a year at once against a day at a time.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import type { JsonObject } from "../../../src/shared/json";
import { EXTRACTION_DEFAULTS } from "../../../src/shared/settings";
import { REVENUE_TEMPLATES, revenueOf, royaltyMonth, type RevenueModel } from "../../../src/shared/revenue";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { objOf } from "../../../src/engine/pack-kit";
import type { Working } from "../../../src/engine/working";
import { engineReader, previewReader, streamMonths, streamOf, streamRecord } from "../../../src/packs/economy/core/revenue";
import { act, entity, ext, lapse, line, packEvents, posts, reg, setup } from "./work-world";

const DAY = 1440;

/** A stream entity: a flow with a revenue model. */
function stream(id: string, name: string, fields: JsonObject, model: JsonObject) {
  return entity(id, "flow", name, { flow_kind: "income", ...fields, revenue: [model] });
}

const ROYALTY: JsonObject = { type: "royalty", unit: "bbl", production: { qi: 1000, di_pct: 24, b: 0 }, price: 7000, share_pct: 12.5, deductions_pct: 2, severance_pct: 4.6, lag_months: 2 };

function until(w: Working, local: string): number {
  return clockOfLocal(calendarOf(w.world), local) - w.state.clock;
}

/** Moves the clock `minutes` on as far as the timelapse's unit cap lets each run, Continue after Continue, as the player would. */
function advance(w: Working, minutes: number): void {
  const target = w.state.clock + minutes;
  while (w.state.clock < target) {
    const before = w.state.clock;
    lapse(w, target - before);
    if (w.state.clock === before) throw new Error("the clock didn't move");
  }
}

describe("revenue streams: catalogs and royalties", () => {
  test("a catalog's lines are taxed by their own category, so groceries go untaxed where the region exempts them", () => {
    const { w } = setup((wd) => {
      const config = wd.packs.economy!.config;
      wd.packs.economy!.config = { ...config, taxes: { ...objOf(config.taxes), exempt: ["groceries"] } };
      wd.entities.counter = stream("counter", "Counter sales", { from: "Walk-in customers", to: "daybreak", every: "day", at: "17:00" }, { type: "catalog", buyers: 10, items: [{ id: "bread", name: "Bread", price: 400, units: 1, margin_pct: 40, category: "groceries" }, { id: "coffee", name: "Coffee", price: 300, units: 2, category: "prepared_food" }] });
    });
    lapse(w, DAY);
    const [sale] = packEvents(w, "economy.sale").filter((e) => e.data.memo === "Counter sales");
    // Ten buyers: $40 of bread, untaxed, and $60 of coffee at 7%; the bread keeps 40%, the coffee the café's 60%.
    expect(sale?.data).toMatchObject({ business: "daybreak", cents: 10_000, tax: 420, cogs: 2_400 + 2_400 });
    const [takings] = posts(w, /^Counter sales/);
    expect(line(takings!, "db_operating")).toBe(10_420);
    expect(streamRecord(w.state, "counter")).toEqual([{ month: "2026-10", cents: 10_000, net: 10_000, units: 30, occurrences: 1 }]);
  });

  test("a royalty pays a share of its decline two months on, in exact cents, its severance and deductions out of the same account", () => {
    const { w } = setup((wd) => {
      wd.entities.lease = stream("lease", "Mineral royalty", { from: "Purchaser", to: "maya_checking", every: "month", days: [25], start: "2026-08-01" }, ROYALTY);
    });
    lapse(w, until(w, "2026-11-26T00:00"));
    const model = revenueOf([ROYALTY]) as RevenueModel;
    // October pays August, the first month (1,000 bbl): 1,000 × $70 × 12.5%; November pays September's decline.
    const first = royaltyMonth(model, 0, 1, 7000);
    const second = royaltyMonth(model, 1, 1, 7000);
    expect(first).toEqual({ units: 1000, gross: 875_000, deductions: 17_500, severance: 40_250, net: 817_250 });
    expect(second.gross).toBe(Math.round(1000 * Math.exp(-0.02) * 7000 * 0.125));
    const paid = posts(w, /^Mineral royalty$/);
    expect(paid.map((p) => p.lines)).toEqual([
      [{ account: ext("purchaser"), amount: -875_000 }, { account: "maya_checking", amount: 875_000 }],
      [{ account: ext("purchaser"), amount: -second.gross }, { account: "maya_checking", amount: second.gross }],
    ]);
    expect(posts(w, /severance tax$/).map((p) => line(p, "maya_checking"))).toEqual([-40_250, -second.severance]);
    expect(posts(w, /post-production costs$/).map((p) => line(p, "maya_checking"))).toEqual([-17_500, -second.deductions]);
    expect(packEvents(w, "economy.income").filter((e) => e.data.kind === "royalty").map((e) => e.data.cents)).toEqual([817_250, second.net]);
  });

  test("a royalty that starts mid-month counts only the days it produced", () => {
    const { w } = setup((wd) => {
      wd.entities.lease = stream("lease", "Mineral royalty", { from: "Purchaser", to: "maya_checking", every: "month", days: [25], start: "2026-10-21" }, { ...ROYALTY, lag_months: 0 });
    });
    lapse(w, until(w, "2026-10-26T00:00"));
    const [paid] = posts(w, /^Mineral royalty$/);
    // Eleven of October's 31 days.
    expect(line(paid!, "maya_checking")).toBe(royaltyMonth(revenueOf([ROYALTY]) as RevenueModel, 0, 11 / 31, 7000).gross);
  });
});

describe("revenue streams: the agents' adjustments", () => {
  const retainer = (ai?: string) => (wd: WorldDoc) => {
    wd.entities.retainer = stream("retainer", "Retainers", { from: "Clients", to: "daybreak", every: "month", days: [1] }, { type: "fees", units: 1, price: 75_000, buyers: 4, ...(ai ? { ai } : {}) });
  };
  const adjust = (w: Working, args: JsonObject, seed = "adj") => act(w, "economy.revenue_adjust", { stream: "retainer", reason: "Word got round about the new menu", ...args }, seed).rejected.map((r) => r.rejection.code);

  test("a stream is closed to them unless its author opened it", () => {
    const { w } = setup(retainer());
    expect(adjust(w, { factor: 2 })).toEqual(["not_open"]);
  });

  test("an adjustment stays within its bounds: a factor of 0.25 to 4 or one period's amount, up to 31 days, four at once", () => {
    const { w } = setup(retainer("bounded"));
    expect(adjust(w, { factor: 5 })).toEqual(["out_of_bounds"]);
    expect(adjust(w, { factor: 0.2 })).toEqual(["out_of_bounds"]);
    expect(adjust(w, { cents: 300_001 })).toEqual(["out_of_bounds"]);
    expect(adjust(w, { factor: 2, days: 32 })).toEqual(["out_of_bounds"]);
    expect(adjust(w, { factor: 2, cents: 100 })).toEqual(["bad_amount"]);
    expect(adjust(w, { factor: 2, reason: " " })).toEqual(["no_reason"]);
    for (const [i, factor] of [1.5, 1.2, 1.1, 0.9].entries()) expect(adjust(w, { factor, days: 31 }, `a${i}`)).toEqual([]);
    expect(adjust(w, { factor: 1.3 }, "a5")).toEqual(["too_many"]);
  });

  test("what an adjustment brings from outside in a stream's month is at most the world's cap on unlisted prices", () => {
    const { w } = setup(retainer("bounded"));
    expect(adjust(w, { factor: 4, days: 31 })).toEqual([]);
    lapse(w, until(w, "2026-11-02T00:00"));
    const [paid] = posts(w, /^Retainers/);
    // $3,000 a month times four would bring $9,000 more; the cap lets $6,000 in.
    expect(line(paid!, "db_operating")).toBe(300_000 + 600_000);
  });

  test("what the story says of a stream is a revenue change that quotes it and asks first, held to the same bounds", () => {
    expect(EXTRACTION_DEFAULTS.revenue).toBe("confirm");
    const channel = reg.proposals.get("revenue");
    if (!channel) throw new Error("no revenue channel");
    const { w } = setup(retainer("bounded"));
    const said = { type: "revenue", stream: "retainer", factor: 1.5, days: 7, said: "Half the town booked in after the fair" };
    expect(channel.validate(said, w.ctx)).toBeNull();
    expect(channel.validate({ ...said, said: "" }, w.ctx)?.code).toBe("no_quote");
    expect(channel.validate({ ...said, factor: 9 }, w.ctx)?.code).toBe("out_of_bounds");
    expect(channel.toEffects(said, w.ctx)).toEqual([{ type: "economy.revenue_adjust", args: { stream: "retainer", reason: said.said, story: true, factor: 1.5, days: 7 } }]);
    const { w: closed } = setup(retainer());
    expect(channel.validate(said, closed.ctx)?.code).toBe("not_open");
  });

  test("a party's money view lists its streams, with their record, their next twelve months and the adjustments in force", () => {
    const { w } = setup(retainer("bounded"));
    expect(adjust(w, { factor: 1.5, days: 20 })).toEqual([]);
    lapse(w, until(w, "2026-11-02T00:00"));
    const view = w.ctx.query("economy.finance")(w.ctx, "daybreak", false) as FinanceView;
    const [row] = view.streams ?? [];
    expect(row).toMatchObject({ id: "retainer", label: "Retainers", type: "fees", earner: "daybreak", ai: "bounded", status: "active" });
    // Four clients' fees, half as much again while the adjustment holds.
    expect(row?.months).toEqual([{ month: "2026-11", cents: 450_000, net: 450_000, units: 6, occurrences: 1 }]);
    expect(row?.preview).toHaveLength(12);
    expect(row?.preview[1]).toBe(300_000);
    expect(row?.adjustments.map((a) => a.factor)).toEqual([1.5]);
  });
});

describe("revenue streams: previews and time", () => {
  const year = (wd: WorldDoc) => {
    wd.entities.counter = stream("counter", "Counter sales", { from: "Walk-in customers", to: "daybreak", every: "day", at: "17:00" }, { type: "product", units: 1, price: 1_250, buyers: 30, weekdays: [0, 1, 1, 1, 1, 1.25, 1.5], season: [0.8, 0.8, 0.9, 1, 1, 1.1, 1.2, 1.2, 1, 1, 0.9, 1.4], growth_pct: 6 });
    wd.entities.lease = stream("lease", "Mineral royalty", { from: "Purchaser", to: "maya_checking", every: "month", days: [25], start: "2026-08-01" }, ROYALTY);
    wd.entities.retainer = stream("retainer", "Retainers", { from: "Clients", to: "daybreak", every: "month", days: [1] }, { type: "fees", units: 1, price: 75_000, buyers: 4 });
  };

  test("the twelve-month preview equals the next twelve months of postings", () => {
    const { w } = setup(year);
    const previews = Object.fromEntries(["counter", "lease", "retainer"].map((id) => [id, streamMonths(engineReader(w.ctx, id === "lease" ? "maya" : "daybreak"), streamOf(w.ctx, id)!, w.state.clock, 12)]));
    // Build's preview of the world alone agrees.
    expect(streamMonths(previewReader(w.world), streamOf(w.ctx, "counter")!, w.state.clock, 12)).toEqual(previews.counter!);
    advance(w, until(w, "2027-10-01T00:00"));
    for (const id of ["counter", "lease", "retainer"]) {
      const recorded = new Map(streamRecord(w.state, id).map((m) => [m.month, m.cents]));
      expect(previews[id]!.map((m) => [m.month, recorded.get(m.month) ?? 0])).toEqual(previews[id]!.map((m) => [m.month, m.cents]));
      expect(previews[id]!.some((m) => m.cents > 0)).toBe(true);
    }
  }, 120_000);

  test("a year at once posts what a year of single days does", () => {
    const { w: once } = setup(year);
    const { w: daily } = setup(year);
    advance(once, 365 * DAY);
    for (let i = 0; i < 365; i++) lapse(daily, DAY);
    for (const id of ["counter", "lease", "retainer"]) expect(streamRecord(daily.state, id)).toEqual(streamRecord(once.state, id));
    const revenue = (w: Working) => w.events.filter((e) => e.type === "post" && /^(Counter sales|Mineral royalty|Retainers)/.test(e.memo)).map((e) => (e.type === "post" ? e.lines : []));
    expect(revenue(daily)).toEqual(revenue(once));
  }, 240_000);

  test("drivers may be formulas, read at each occurrence's own instant with self the earner", () => {
    const { w } = setup((wd) => {
      wd.entities.counter = stream("counter", "Counter sales", { from: "Walk-in customers", to: "daybreak", every: "day", at: "17:00" }, { type: "product", units: "=self.margin_pct / 60", price: 1_000, buyers: "=10 + month" });
    });
    const [october, november] = streamMonths(engineReader(w.ctx, "daybreak"), streamOf(w.ctx, "counter")!, w.state.clock, 2);
    // October's days sell to 20 buyers each and November's 30 to 21: the month is each occurrence's, not today's.
    expect((october?.cents ?? 0) % 20_000).toBe(0);
    expect(november?.cents).toBe(30 * 21_000);
    lapse(w, DAY);
    expect(posts(w, /^Counter sales/).map((p) => line(p, "db_operating"))).toEqual([20_000 + 1_400]);
  });

  test("every template reads as a model", () => {
    for (const t of Object.values(REVENUE_TEMPLATES)) expect(revenueOf(t.fields.revenue)).not.toBeNull();
  });
});
