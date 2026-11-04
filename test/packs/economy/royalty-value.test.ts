// Mineral interests valued from income (DESIGN §27.9): a property whose streams pay it is worth what
// they are projected to pay, recorded on the 1st of each month: PV10 of a known decline, a cap rate
// and a multiple; a mineral interest has no insurance or upkeep.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { presentValue, revenueOf, royaltyMonth, type RevenueModel } from "../../../src/shared/revenue";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import type { Working } from "../../../src/engine/working";
import { entity, lapse, posts, setup } from "./work-world";

const DECLINE: JsonObject = { type: "royalty", unit: "bbl", production: { qi: 2000, di_pct: 30, b: 0 }, price: 6500, share_pct: 20, severance_pct: 4.6 };

/** Maya's royalty interest in a lease, paid each month into her checking from January. */
function interest(valuation?: JsonObject) {
  return (wd: WorldDoc): void => {
    wd.entities.mineral = entity("mineral", "property", "Mineral interest", { owners: [{ party: "maya", role: "owner", share: 100 }], value: 1, property_type: "mineral", ...(valuation ? { valuation: [valuation] } : {}) });
    wd.entities.royalty = entity("royalty", "flow", "Mineral royalty", { flow_kind: "income", from: "Purchaser", to: "maya_checking", every: "month", days: [25], start: "2026-01-01", link: "mineral", revenue: [DECLINE] });
  };
}

function toNovember(w: Working): number {
  lapse(w, clockOfLocal(calendarOf(w.world), "2026-11-01T06:00") - w.state.clock);
  return w.state.entities.mineral?.fields.value as number;
}

/** What the decline pays a month, net, from November 2026 (its eleventh production month) for `months` months. */
function nets(months: number): number[] {
  const model = revenueOf([DECLINE]) as RevenueModel;
  return Array.from({ length: months }, (_, i) => royaltyMonth(model, 10 + i, 1, 6500).net);
}

describe("royalty interests: valued from income", () => {
  test("at PV10 by default: thirty years of the decline, each month discounted at 10% a year", () => {
    const { w } = setup(interest());
    expect(toNovember(w)).toBe(presentValue(nets(360), 10));
  });

  test("a horizon and a discount of its own", () => {
    const { w } = setup(interest({ method: "pv", discount_pct: 15, horizon_months: 60 }));
    expect(toNovember(w)).toBe(presentValue(nets(60), 15));
  });

  test("a cap rate, or a multiple, of the next twelve months", () => {
    const year = nets(12).reduce((a, c) => a + c, 0);
    const { w: capped } = setup(interest({ method: "cap", cap_rate_pct: 12 }));
    expect(toNovember(capped)).toBe(Math.round(year / 0.12));
    const { w: multiple } = setup(interest({ method: "multiple", multiple: 4 }));
    expect(toNovember(multiple)).toBe(Math.round(year * 4));
  });

  test("a mineral interest pays no insurance or upkeep, where a building beside it does", () => {
    const { w } = setup((wd) => {
      interest()(wd);
      wd.entities.shop = entity("shop", "property", "Corner shop", { owners: [{ party: "maya", role: "owner", share: 100 }], value: 30_000_000, property_type: "building" });
    });
    lapse(w, clockOfLocal(calendarOf(w.world), "2026-11-17T00:00") - w.state.clock);
    expect(posts(w, /^(Insurance|Upkeep), Mineral interest/)).toEqual([]);
    expect(posts(w, /^Insurance, Corner shop/).length).toBeGreaterThan(0);
    expect(posts(w, /^Upkeep, Corner shop/).length).toBeGreaterThan(0);
  });
});
