// What the player reads of the work module's bookkeeping: its postings and notes carry the lines, so
// a business's sales, remittances and payouts, and anyone's payslips and estimated tax, are no
// player line; the GM's words for them name everyone.

import { describe, expect, test } from "bun:test";
import type { PackEvent } from "../../../src/shared/ledger";
import { playerLines } from "../../../src/engine/player-events";
import { packEvents, lapse, reg, setup } from "./work-world";

const DAY = 1440;

describe("work lines: what the player reads", () => {
  test("a known business's walk-in sales are no player line; the GM's words name them", () => {
    // The player knows Maya's café; it takes walk-in customers at closing.
    const { w } = setup((wd) => {
      wd.entities.you!.relations.push({ type: "knows", to: "daybreak" });
      Object.assign(wd.entities.daybreak!.fields, { daily_sales: 50_000 });
    });
    const start = w.events.length;
    lapse(w, DAY);
    const events = w.events.slice(start);
    const [sale] = packEvents(w, "economy.sale") as PackEvent[];
    expect(sale?.data).toMatchObject({ business: "daybreak", memo: "Walk-in customers" });
    expect(playerLines(reg, w.world, w.state, w.world.pov, events, 1000).filter((l) => /^(Sale|Payslip|Estimated tax|Profit distributed|Owner's draw|Invoice paid)\b/.test(l))).toEqual([]);
    const def = reg.get("economy.sale");
    expect(def?.describe(sale!, w.ctx, w.world.pov)).toBe("");
    expect(def?.describe(sale!, w.ctx)).toBe("Daybreak Café: sale to walk-in customers");
  });
});
