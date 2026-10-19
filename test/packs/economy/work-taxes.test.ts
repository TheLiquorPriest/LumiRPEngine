// Taxes on work (DESIGN §26.3), folded through Riverton: withholding on paychecks, and the
// estimated tax on income nobody withholds from.

import { describe, expect, test } from "bun:test";
import { entity, ext, lapse, line, paid, paychecks, posts, setup } from "./work-world";

const DAY = 1440;

describe("work taxes: withholding and estimated tax", () => {
  test("withholding and the estimated-tax set-aside read the job's occupation, not the worker's", () => {
    // Rosa (Money 3, Ohio's 1.4%) has no occupation of her own; each job names one.
    const clerk = setup((wd) => {
      delete wd.entities.rosa!.fields.occupation;
      wd.entities.job_desk = entity("job_desk", "job", "Desk", { worker: "rosa", employer: "Riverton desk", title: "Desk", occupation: "office_clerk", basis: "hourly", rate: 2000, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
    });
    lapse(clerk.w, 8 * DAY);
    const [check] = paychecks(clerk.w, "rosa_checking");
    const [slip] = paid(clerk.w, "job_desk");
    // An office clerk's flat 14% federal.
    expect(line(check!, ext("tax:federal"))).toBe(Math.round(((slip?.gross as number) * 14) / 100));

    // A courier's contract pay in December is paid for on 15 January: the courier's 15.4% set-aside and the state's 1.4%.
    const courier = setup((wd) => {
      wd.start.at = "2026-12-28T07:30";
      delete wd.entities.rosa!.fields.occupation;
      wd.entities.job_gig = entity("job_gig", "job", "Courier", { worker: "rosa", employer: "Dashway", title: "Courier", occupation: "food_delivery_courier", basis: "per_shift", rate: 9000, hours: "contract", shifts_per_week: 7, weeks_per_year: 52, pay_every: "per_job", start: "2026-01-01" });
    });
    lapse(courier.w, 19 * DAY);
    const december = paid(courier.w, "job_gig").filter((d) => d.year === 2026).reduce((a, d) => a + (d.gross as number), 0);
    expect(december).toBe(4 * 9000);
    const [estimate] = posts(courier.w, /^Estimated tax/);
    expect(-line(estimate!, "rosa_checking")).toBe(Math.round((december * (15.4 + 1.4)) / 100));
  });
});
