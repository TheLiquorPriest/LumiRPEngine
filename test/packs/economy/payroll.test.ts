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
});
