// Paydays and paychecks (DESIGN §26.1), folded through Riverton: when a job pays, for which work,
// and what each paycheck takes off before it lands.

import { describe, expect, test } from "bun:test";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { act, entity, lapse, packEvents, paid, payslips, setup } from "./work-world";

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
