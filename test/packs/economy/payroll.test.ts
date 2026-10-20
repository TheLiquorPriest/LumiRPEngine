// Paydays and paychecks (DESIGN §26.1), folded through Riverton: when a job pays, for which work,
// and what each paycheck takes off before it lands.

import { describe, expect, test } from "bun:test";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { account, act, entity, ext, lapse, line, packEvents, paid, payslips, posts, setup } from "./work-world";

const DAY = 1440;

describe("payroll: paydays", () => {
  test("a job whose last payday rolls back off a weekend is still paid its last paycheck", () => {
    // Semimonthly: the 31st of October is a Saturday, so that payday rolls back to Friday the 30th.
    const { world, w } = setup((wd) => void (wd.entities.job_temp = entity("job_temp", "job", "Temp", { worker: "rosa", employer: "Riverton temps", title: "Temp", basis: "salary", rate: 4_800_000, pay_every: "semimonthly", start: "2026-01-05", end: "2026-10-20" })));
    lapse(w, 20 * DAY);
    const runs = packEvents(w, "economy.flow_run").filter((e) => e.data.flow === "pay:job_temp");
    expect(runs.map((e) => e.data.at)).toEqual([clockOfLocal(calendarOf(world), "2026-10-30T09:00")]);
    // The period from the 16th to the 31st, of which the job counted the 16th to the 20th.
    expect(paid(w, "job_temp").map((d) => d.gross)).toEqual([Math.round(((4_800_000 / 24) * 5) / 16)]);
    expect(payslips(w, "job_temp")).toHaveLength(1);
  });

  test("a first paycheck the employer can't cover is paid with the next", () => {
    // Brightline opens with nothing; its first walk-in takings come at Friday's close, after the 09:00 payday.
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline!.fields, { daily_sales: 300_000, margin_pct: 100, collects_sales_tax: false });
      wd.entities.bl_operating!.fields.opening = 0;
      wd.entities.job_driver = entity("job_driver", "job", "Driver", { worker: "rosa", employer: "brightline", title: "Driver", basis: "hourly", rate: 2000, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
    });
    lapse(w, 8 * DAY);
    const runs = packEvents(w, "economy.flow_run").filter((e) => e.data.flow === "pay:job_driver");
    expect(runs.map((e) => e.data.outcome)).toEqual(["skipped", "paid"]);
    // Friday the 23rd pays both weeks: the one the 16th couldn't, and its own.
    expect(paid(w, "job_driver").map((d) => [d.minutes, d.gross])).toEqual([[2 * 40 * 60, 2 * 40 * 2000]]);
  });

  test("semimonthly and monthly salaries pay each period on its own days", () => {
    const { world, w } = setup((wd) => {
      wd.entities.job_semi = entity("job_semi", "job", "Semi", { worker: "rosa", employer: "Riverton temps", title: "Semi", occupation: "office_clerk", basis: "salary", rate: 4_800_000, pay_every: "semimonthly", pay_roll: "none", start: "2025-01-06" });
      wd.entities.job_month = entity("job_month", "job", "Month", { worker: "maya", employer: "Riverton books", title: "Month", occupation: "office_clerk", basis: "salary", rate: 4_800_000, pay_every: "monthly", pay_roll: "none", start: "2025-01-06" });
    });
    lapse(w, 31 * DAY);
    const cal = calendarOf(world);
    const days = (job: string): number[] => packEvents(w, "economy.flow_run").filter((e) => e.data.flow === `pay:${job}`).map((e) => e.data.at as number);
    // The 15th and the last day; and the last day of the month, Saturday 31 October unrolled.
    expect(days("job_semi")).toEqual([clockOfLocal(cal, "2026-10-31T09:00"), clockOfLocal(cal, "2026-11-15T09:00")]);
    expect(paid(w, "job_semi").map((d) => d.gross)).toEqual([200_000, 200_000]);
    expect(days("job_month")).toEqual([clockOfLocal(cal, "2026-10-31T09:00")]);
    expect(paid(w, "job_month").map((d) => d.gross)).toEqual([400_000]);
  });

  test("a custom cycle, every fourth Wednesday from its anchor, pays four weeks of hours each time", () => {
    const { world, w } = setup((wd) => void (wd.entities.job_four = entity("job_four", "job", "Yard", { worker: "rosa", employer: "Riverton yard", title: "Yard", occupation: "office_clerk", basis: "hourly", rate: 2000, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "custom", pay_unit: "week", pay_interval: 4, pay_weekdays: [3], pay_anchor: "2026-10-21", start: "2025-01-06" })));
    lapse(w, 36 * DAY);
    const cal = calendarOf(world);
    expect(packEvents(w, "economy.flow_run").filter((e) => e.data.flow === "pay:job_four").map((e) => e.data.at)).toEqual([clockOfLocal(cal, "2026-10-21T09:00"), clockOfLocal(cal, "2026-11-18T09:00")]);
    expect(paid(w, "job_four").map((d) => [d.minutes, d.gross])).toEqual([
      [160 * 60, 160 * 2000],
      [160 * 60, 160 * 2000],
    ]);
  });
});

describe("payroll: commission, deductions and the match", () => {
  test("a commission job is paid its share of the sales made while its worker is at work", () => {
    // Maya works the café's counter on commission; the player buys a latte there on Friday morning.
    const { w } = setup((wd) => {
      wd.entities.you!.fields.place = "cafe";
      wd.entities.job_counter = entity("job_counter", "job", "Counter", { worker: "maya", employer: "daybreak", title: "Counter", basis: "commission", commission_pct: 10, hours: "contract", pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
    });
    expect(act(w, "economy.buy", { payer: "you", item: "latte_16oz", method: "debit" }).rejected).toEqual([]);
    const sale = packEvents(w, "economy.sale")[0]?.data.cents as number;
    expect(packEvents(w, "economy.commission").map((e) => e.data)).toEqual([{ job: "job_counter", cents: sale, since: 0 }]);
    lapse(w, 8 * DAY);
    expect(paid(w, "job_counter").map((d) => d.gross)).toEqual([Math.round(sale / 10)]);
  });

  test("pre-tax deductions come off taxable pay, and the employer matches the retirement one into the worker's own account", () => {
    const { w } = setup((wd) => {
      wd.entities.rosa_401k = account("rosa_401k", "rosa", "retirement", 0);
      wd.entities.job_dock = entity("job_dock", "job", "Dock", { worker: "rosa", employer: "brightline", title: "Dock", occupation: "office_clerk", basis: "hourly", rate: 2000, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06", deductions: [{ label: "401(k)", pct: 5, pretax: true, kind: "retirement", match_pct: 3, to: "rosa_401k" }, { label: "Health", cents: 2500, pretax: true, kind: "health" }] });
    });
    lapse(w, DAY);
    const [check] = posts(w, /^Payroll/).filter((p) => line(p, "rosa_checking") > 0);
    // $800 gross: $40 to the 401(k) and $24 matched; $25 health; the office clerk's flat 14% and Ohio's 1.4% on the $735 left taxable.
    const taxable = 80_000 - 4000 - 2500;
    const federal = Math.round((taxable * 14) / 100);
    const state = Math.round((taxable * 1.4) / 100);
    expect(check?.lines).toEqual([
      { account: "bl_operating", amount: -(80_000 + 2400) },
      { account: "rosa_checking", amount: 80_000 - 4000 - 2500 - federal - state },
      { account: "rosa_401k", amount: 4000 + 2400 },
      { account: ext("payee:health"), amount: 2500 },
      { account: ext("tax:federal"), amount: federal },
      { account: ext("tax:state"), amount: state },
    ]);
  });
});

describe("payroll: paychecks", () => {
  test("taxes take no more than the deductions leave: a paycheck nearly all saved is paid, not refused", () => {
    // $100 a week at the top level with $99 of it to a 401(k): FICA alone is $7.65 of the $1 left.
    const { w } = setup((wd) => void (wd.entities.job_saver = entity("job_saver", "job", "Saver", { worker: "maya", employer: "Riverton books", title: "Saver", occupation: "office_clerk", basis: "hourly", rate: 250, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06", deductions: [{ label: "401(k)", cents: 9900, pretax: true, kind: "retirement" }] })));
    lapse(w, 8 * DAY);
    expect(paid(w, "job_saver").map((d) => [d.gross, d.deductions, d.taxes, d.net])).toEqual([
      [10_000, 9900, 100, 0],
      [10_000, 9900, 100, 0],
    ]);
  });

  test("a tipped job keeps its tips after a raise, and a hire at a set rate is tipped too", () => {
    // A bartender's default: the federal tipped cash wage of $2.13, and $14.87 an hour in tips (a $17 median).
    const tipsOn = (minutes: number, rate: number): number => Math.round((rate * minutes) / 60) + Math.round((1487 * minutes) / 60);
    const raised = setup((wd) => void (wd.entities.job_bar = entity("job_bar", "job", "Bartender", { worker: "maya", employer: "The Anchor", occupation: "bartender", hours: "contract", start: "2025-01-06" })));
    expect(act(raised.w, "economy.job_raise", { job: "job_bar", pct: 10 }).rejected).toEqual([]);
    lapse(raised.w, 8 * DAY);
    const [after] = paid(raised.w, "job_bar");
    expect(after?.gross).toBe(tipsOn(after?.minutes as number, Math.round(213 * 1.1)));
    const hired = setup();
    expect(act(hired.w, "economy.hire", { business: "brightline", worker: "rosa", occupation: "bartender", rate: 300, hours: "contract", by: "jordan" }).rejected).toEqual([]);
    lapse(hired.w, 8 * DAY);
    const job = Object.keys(hired.w.state.entities).find((id) => hired.w.state.entities[id]?.kind === "job" && hired.w.state.entities[id]?.fields.worker === "rosa") ?? "";
    const [first] = paid(hired.w, job);
    expect(first?.gross).toBe(tipsOn(first?.minutes as number, 300));
  });

  test("a worker away on a four-week trip isn't paid the hours a week their job counts", () => {
    const { w } = setup((wd) => {
      const cal = calendarOf(wd);
      wd.entities.rosa!.fields.trips = [{ from: clockOfLocal(cal, "2026-10-16T07:30"), until: clockOfLocal(cal, "2026-11-13T18:00"), label: "Visiting family" }];
      wd.entities.job_yard = entity("job_yard", "job", "Yard", { worker: "rosa", employer: "Riverton yard", title: "Yard", occupation: "office_clerk", basis: "hourly", rate: 2000, hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
    });
    lapse(w, 15 * DAY);
    // The week before she left is paid on the 16th; the two Fridays after pay nothing.
    expect(payslips(w, "job_yard").map((d) => [d.minutes, d.gross])).toEqual([
      [40 * 60, 40 * 2000],
      [0, 0],
      [0, 0],
    ]);
  });
});
