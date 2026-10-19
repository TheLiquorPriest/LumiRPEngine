// Paydays and paychecks (DESIGN §26.1), folded through Riverton: when a job pays, for which work,
// and what each paycheck takes off before it lands.

import { describe, expect, test } from "bun:test";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { packEvents, paid, payslips, entity, lapse, setup } from "./work-world";

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
    const { w } = setup((wd) => void (wd.entities.job_saver = entity("job_saver", "job", "Saver", { worker: "maya", employer: "Riverton books", title: "Saver", basis: "hourly", rate: 250, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06", deductions: [{ label: "401(k)", cents: 9900, pretax: true, kind: "retirement" }] })));
    lapse(w, 8 * DAY);
    expect(paid(w, "job_saver").map((d) => [d.gross, d.deductions, d.taxes, d.net])).toEqual([
      [10_000, 9900, 100, 0],
      [10_000, 9900, 100, 0],
    ]);
  });
});
