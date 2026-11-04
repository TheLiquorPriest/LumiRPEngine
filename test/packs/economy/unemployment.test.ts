// FUTA and SUTA (ORG-SPEC §3.11, Phase 5; DESIGN §26.3) on Riverton: Brightline (Money 4) pays the
// player's clerk salary every other Friday. Each paycheck accrues the employer's FUTA (the gross rate
// less the credit for state tax, a credit-reduction state's reduction kept apart) and SUTA at its
// state's new-employer rate, each on wages up to its wage base, again from January; the economy
// config and the employer's own rate override the tables; an exempt status spares what its row
// says; the toggle off, or a world whose tables predate the rows, accrues nothing; turned on partway
// through the year, the bases count from what the employer paid the worker before. SUTA is paid each
// quarter, FUTA deposited once over the threshold and settled by January's return, from the payroll's
// account to the tax authorities, booked as payroll; Taxes, Payroll and the wind-up service read it.

import { describe, expect, test } from "bun:test";
import type { TaxesView, UnemploymentView } from "../../../src/shared/finance";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { readPass } from "../../../src/engine/read-pass";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { monthBook } from "../../../src/packs/economy/core/books";
import { yearPay } from "../../../src/packs/economy/core/taxes";
import { unemploymentRates, unemploymentTotals, unemploymentYear, UNEMPLOYMENT_ACCRUED } from "../../../src/packs/economy/core/unemployment";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { CLERK, entity, ext, lapse, line, packEvents, paid, posts, reg, setup } from "./work-world";

const DAY = 1440;
const BL = "brightline";
const ACCOUNT = "bl_operating";

/** Riverton from `start`, the player clerking for Brightline, Brightline in Ohio unless `patch` says otherwise. */
function clerk(start: string, patch: (wd: WorldDoc) => void = () => undefined): Working {
  return setup((wd) => {
    wd.start.at = start;
    wd.entities.brightline!.fields.region = "oh";
    wd.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK);
    patch(wd);
  }).w;
}

/** Riverton from `start` with no job: Brightline's unemployment taxes only as the test writes them. */
function books(start: string): Working {
  return setup((wd) => {
    wd.start.at = start;
    wd.entities.brightline!.fields.region = "oh";
  }).w;
}

/** The world's economy config, made its own first (the fixture's config and tables are shared, never written in place), and its tax settings. */
function config(wd: WorldDoc): { config: JsonObject; taxes: JsonObject } {
  const own = structuredClone(wd.packs.economy!.config);
  wd.packs.economy = { ...wd.packs.economy!, config: own };
  const taxes = (own.taxes as JsonObject | undefined) ?? {};
  own.taxes = taxes;
  return { config: own, taxes };
}

const accruals = (w: Working): JsonObject[] => packEvents(w, UNEMPLOYMENT_ACCRUED).map((e) => e.data);
const section = <T,>(w: Working, id: string): T => readPass(() => buildOrgView(w.ctx, BL, null))?.sections[id] as unknown as T;
const at = (w: Working, local: string): Working => new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(calendarOf(w.world), local) });
const accrued = (data: JsonObject): LedgerEvent => ({ type: UNEMPLOYMENT_ACCRUED, data: { employer: BL, worker: "you", ...data } });

/** What each paycheck should accrue: its wages up to what is left of each base that year, at each rate. */
function expected(w: Working, futa: { base: number; pct: number }, suta: { base: number; pct: number }): JsonObject[] {
  const used = new Map<string, number>();
  const out: JsonObject[] = [];
  for (const slip of paid(w, "job_clerk")) {
    const wages = slip.fica as number;
    const year = slip.year as number;
    const take = (kind: string, base: number): number => {
      const key = `${kind}:${year}`;
      const n = Math.max(0, Math.min(wages, base - (used.get(key) ?? 0)));
      used.set(key, (used.get(key) ?? 0) + n);
      return n;
    };
    const f = take("futa", futa.base);
    const s = take("suta", suta.base);
    if (f > 0 || s > 0) out.push({ year, futa_wages: f, suta_wages: s, futa: Math.round((f * futa.pct) / 100), reduction: 0, suta: Math.round((s * suta.pct) / 100) });
  }
  return out;
}

describe("unemployment taxes: what each paycheck accrues", () => {
  test("FUTA after the credit and SUTA at Ohio's rate, from the tables, on wages up to each base, again from January", () => {
    expect(unemploymentRates(clerk("2026-11-30T07:00").ctx, BL)).toEqual({ futa: { grossPct: 6, creditPct: 5.4, reductionPct: 0, base: 700_000 }, suta: { pct: 2.7, base: 900_000 } });
    // Bases made small in the economy config, so the second paycheck reaches them and January starts over.
    const w = clerk("2026-11-30T07:00", (wd) => Object.assign(config(wd).taxes, { futaWageBase: 200_000, sutaWageBase: 250_000 }));
    lapse(w, 50 * DAY);
    expect([...new Set(paid(w, "job_clerk").map((s) => s.year))]).toEqual([2026, 2027]);
    const want = expected(w, { base: 200_000, pct: 0.6 }, { base: 250_000, pct: 2.7 });
    expect(accruals(w).map(({ employer, worker, quarter, ...rest }) => (employer === BL && worker === "you" && (quarter === 4 || quarter === 1) ? rest : null))).toEqual(want);
    const of2026 = want.filter((a) => a.year === 2026);
    const total = (k: string): number => of2026.reduce((s, a) => s + (a[k] as number), 0);
    expect([total("futa_wages"), total("suta_wages")]).toEqual([200_000, 250_000]);
    // Its records add up the same, and nothing is paid yet.
    expect(unemploymentTotals(w.state, BL, 2026)).toEqual({ futa: total("futa"), futaPaid: 0, suta: total("suta"), sutaPaid: 0 });
  });

  test("a credit-reduction state's reduction accrues apart; settings and the employer's own rate override the tables", () => {
    const ca = clerk("2026-11-30T07:00", (wd) => (wd.entities.brightline!.fields.region = "ca"));
    expect(unemploymentRates(ca.ctx, BL)).toEqual({ futa: { grossPct: 6, creditPct: 5.4, reductionPct: 1.2, base: 700_000 }, suta: { pct: 3.4, base: 700_000 } });
    lapse(ca, 6 * DAY);
    const [first] = accruals(ca);
    const wages = first?.futa_wages as number;
    expect(wages).toBeGreaterThan(0);
    expect(first).toMatchObject({ futa: Math.round((wages * 0.6) / 100), reduction: Math.round((wages * 1.2) / 100), suta: Math.round((wages * 3.4) / 100) });

    const set = clerk("2026-11-30T07:00", (wd) => Object.assign(config(wd).taxes, { futaPct: 6.2, futaCreditPct: 5, sutaPct: 1.5 }));
    expect(unemploymentRates(set.ctx, BL)).toEqual({ futa: { grossPct: 6.2, creditPct: 5, reductionPct: 0, base: 700_000 }, suta: { pct: 1.5, base: 900_000 } });
    const own = clerk("2026-11-30T07:00", (wd) => {
      Object.assign(config(wd).taxes, { sutaPct: 1.5 });
      wd.entities.brightline!.fields.suta_pct = 0.8;
    });
    expect(unemploymentRates(own.ctx, BL).suta).toEqual({ pct: 0.8, base: 900_000 });
    // In no state, the national row's.
    const nowhere = clerk("2026-11-30T07:00", (wd) => void delete wd.entities.brightline!.fields.region);
    expect(unemploymentRates(nowhere.ctx, BL).suta).toEqual({ pct: 2.7, base: 700_000 });
  });

  test("an exempt status spares what its row says: a church both, a charity FUTA (and so the credit), a club neither", () => {
    const status = (s: string) => unemploymentRates(clerk("2026-11-30T07:00", (wd) => (wd.entities.brightline!.fields.tax_exempt = s)).ctx, BL);
    expect(status("church")).toEqual({ futa: null, suta: null });
    expect(status("charity")).toEqual({ futa: null, suta: { pct: 2.7, base: 900_000 } });
    expect(status("club")).toEqual({ futa: { grossPct: 6, creditPct: 5.4, reductionPct: 0, base: 700_000 }, suta: { pct: 2.7, base: 900_000 } });
    const church = clerk("2026-11-30T07:00", (wd) => (wd.entities.brightline!.fields.tax_exempt = "church"));
    lapse(church, 6 * DAY);
    expect(paid(church, "job_clerk").length).toBeGreaterThan(0);
    expect(accruals(church)).toEqual([]);
  });

  test("nothing accrues with the toggle off, or on a world whose tables predate the rows", () => {
    const off = clerk("2026-11-30T07:00", (wd) => void (config(wd).config.features = { unemployment_tax: false }));
    lapse(off, 6 * DAY);
    expect(paid(off, "job_clerk").length).toBeGreaterThan(0);
    expect(accruals(off)).toEqual([]);
    const old = clerk("2026-11-30T07:00", (wd) => {
      wd.tables = structuredClone(wd.tables);
      delete wd.tables["economy.finance"]!.rows.taxes_unemployment;
      for (const row of Object.values(wd.tables["economy.regions"]!.rows)) {
        delete row.suta_wage_base_cents;
        delete row.suta_new_employer_pct;
        delete row.futa_credit_reduction_pct;
      }
    });
    expect(unemploymentRates(old.ctx, BL)).toEqual({ futa: null, suta: null });
    lapse(old, 6 * DAY);
    expect(paid(old, "job_clerk").length).toBeGreaterThan(0);
    expect(accruals(old)).toEqual([]);
  });

  test("turned on partway through the year, the bases count from what the employer paid the worker before: no one is taxed again past them", () => {
    // January with the toggle off, paid every other Friday from the 16th: two paychecks nothing counted.
    const off = clerk("2026-01-05T07:00", (wd) => {
      config(wd).config.features = { unemployment_tax: false };
      wd.entities.job_clerk!.fields.pay_anchor = "2026-01-16";
    });
    lapse(off, 30 * DAY);
    expect(paid(off, "job_clerk")).toHaveLength(2);
    expect(accruals(off)).toEqual([]);
    const prior = yearPay(off.state, "you", 2026).fica;
    expect(prior).toBeGreaterThan(0);
    // Turned on (the Data update, or the feature's level reached), the bases set just past what was paid.
    const wd = structuredClone(off.world) as WorldDoc;
    const on = config(wd);
    on.config.features = {};
    Object.assign(on.taxes, { futaWageBase: prior + 50_000, sutaWageBase: prior + 100_000 });
    const w = new Working(reg, wd, structuredClone(off.state) as WorldState);
    lapse(w, 30 * DAY);
    expect(paid(w, "job_clerk")).toHaveLength(2);
    // The first paycheck counts on from what was paid, up to each base; the second, past both, accrues nothing.
    expect(accruals(w)).toEqual([expect.objectContaining({ before: prior, futa_wages: 50_000, suta_wages: 100_000 })]);
    const year = unemploymentYear(w.state, BL, 2026);
    expect([year.wages.you, year.sutaWages.you]).toEqual([prior + 50_000, prior + 100_000]);
  });
});

describe("unemployment taxes: paying them", () => {
  test("SUTA each quarter; FUTA carried under the threshold, deposited over it, the rest with January's return; booked as payroll", () => {
    const w = books("2026-04-27T07:00");
    expect(w.apply(accrued({ year: 2026, quarter: 1, futa_wages: 500_000, suta_wages: 500_000, futa: 30_000, reduction: 6_000, suta: 40_000 }))).toBeNull();
    // Due next: FUTA's next date and nothing yet (under $500), SUTA's quarter.
    expect(section<TaxesView>(w, "taxes").due).toEqual(expect.arrayContaining([{ label: "Federal unemployment tax (FUTA)", cents: 0, at: "30 Apr 2026" }, { label: "State unemployment tax (SUTA)", cents: 40_000, at: "30 Apr 2026" }]));
    lapse(w, 5 * DAY);
    const [suta] = posts(w, /^State unemployment tax/);
    expect([line(suta!, ACCOUNT), line(suta!, ext("tax:state"))]).toEqual([-40_000, 40_000]);
    expect(posts(w, /^FUTA/)).toEqual([]);
    expect(unemploymentTotals(w.state, BL, 2026)).toEqual({ futa: 36_000, futaPaid: 0, suta: 40_000, sutaPaid: 40_000 });
    expect(monthBook(w.state, BL, "2026-04").payroll).toBe(40_000);
    const view = section<TaxesView>(w, "taxes");
    expect(view.years[0]).toMatchObject({ year: 2026, futa: 36_000, futaPaid: 0, suta: 40_000, sutaPaid: 40_000 });
    expect(view.due).toContainEqual({ label: "Federal unemployment tax (FUTA)", cents: 0, at: "31 Jul 2026" });
    expect(view.due.map((d) => d.label)).not.toContain("State unemployment tax (SUTA)");

    // The second quarter takes it over $500: July's deposit pays both quarters, the credit reduction waiting for the return.
    const july = at(w, "2026-07-29T07:00");
    expect(july.apply(accrued({ year: 2026, quarter: 2, futa_wages: 0, suta_wages: 0, futa: 25_000, reduction: 0, suta: 0 }))).toBeNull();
    lapse(july, 5 * DAY);
    const [deposit] = posts(july, /^FUTA deposit/);
    expect([line(deposit!, ACCOUNT), line(deposit!, ext("tax:federal"))]).toEqual([-55_000, 55_000]);
    // January's return settles the year: the reduction left.
    const january = at(july, "2027-01-28T07:00");
    lapse(january, 7 * DAY);
    const [ret] = posts(january, /^FUTA return \(Form 940\) for 2026/);
    expect(line(ret!, ext("tax:federal"))).toBe(6_000);
    expect(unemploymentTotals(january.state, BL, 2026)).toEqual({ futa: 61_000, futaPaid: 61_000, suta: 40_000, sutaPaid: 40_000 });
    expect(section<TaxesView>(january, "taxes").due.map((d) => d.label)).not.toContain("Federal unemployment tax (FUTA)");
  });

  test("what a business wound up owes comes as balanced lines with the bookkeeping that settles it", () => {
    const w = books("2026-05-10T07:00");
    expect(w.apply(accrued({ year: 2026, quarter: 2, futa_wages: 100_000, suta_wages: 100_000, futa: 600, reduction: 0, suta: 2_700 }))).toBeNull();
    const due = w.ctx.service("economy.unemployment_due")(w.ctx, BL);
    expect(due?.cents).toBe(3_300);
    expect(due?.lines).toEqual([{ account: ACCOUNT, amount: -3_300 }, { account: ext("tax:federal"), amount: 600 }, { account: ext("tax:state"), amount: 2_700 }]);
    expect(w.applyAll(due?.events ?? [])).toHaveLength(2);
    expect(unemploymentTotals(w.state, BL, 2026)).toEqual({ futa: 600, futaPaid: 600, suta: 2_700, sutaPaid: 2_700 });
    expect(w.ctx.service("economy.unemployment_due")(w.ctx, BL)).toBeNull();
  });
});

describe("unemployment taxes: Taxes and Payroll", () => {
  test("Brightline's Taxes and Payroll show the rates, the bases and this year's FUTA and SUTA", () => {
    const w = clerk("2026-11-30T07:00");
    lapse(w, 20 * DAY);
    const year = unemploymentTotals(w.state, BL, 2026);
    expect(year.futa).toBeGreaterThan(0);
    const rates: UnemploymentView = { futa: { pct: 0.6, grossPct: 6, creditPct: 5.4, reductionPct: 0, base: 700_000 }, suta: { pct: 2.7, base: 900_000 } };
    const view = section<TaxesView>(w, "taxes");
    expect(view.unemployment).toEqual(rates);
    expect(view.years[0]).toMatchObject({ year: 2026, futa: year.futa, suta: year.suta });
    expect(section<{ unemployment: unknown }>(w, "payroll").unemployment).toEqual({ futa: year.futa, suta: year.suta, rates });
  });
});
