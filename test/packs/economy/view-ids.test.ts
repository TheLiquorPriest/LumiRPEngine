// One id for each flow across a player's money view (DESIGN §25.11): its row, its coming-up lines
// and alerts, and the modules' references to it all send the id the row has, a stand-in included,
// and the view reads a flow's run by its own id. The work module's Riverton.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import { entity, lapse, setup } from "./work-world";

const DAY = 1440;

describe("every reference to a flow in the player's view meets its row", () => {
  test("a repayment from Rosa, whom the player can't see, still says it was missed, linked by the stand-in its row goes by", () => {
    const { w } = setup((wd) => {
      wd.entities.rosa!.visibility = "secret";
      wd.entities.rosa_checking!.fields.opening = 0;
      wd.entities.rosa_payback = entity("rosa_payback", "flow", "Repayment", { flow_kind: "transfer", from: "rosa_checking", to: "checking", amount_cents: 5_000, every: "day", shortfall: "skip", status: "active" });
    });
    lapse(w, 2 * DAY);
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const row = view.flows.find((f) => f.label === "Repayment");
    expect(row?.id.startsWith("hidden:")).toBe(true);
    expect(view.overview?.alerts.filter((a) => a.text === "Repayment was missed.").map((a) => a.flow)).toEqual([row?.id]);
  });

  test("a late invoice from a business the player can't see links its alert to the payment's row, by the row's stand-in", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.visibility = "secret";
      wd.entities.inv_freight = entity("inv_freight", "invoice", "Freight", { business: "brightline", customer: "you", cents: 40_000, memo: "Freight", issued: "2026-09-01", due: "2026-10-01", state: "late" });
    });
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const row = view.flows.find((f) => f.source === "invoice");
    expect(row?.id.startsWith("hidden:")).toBe(true);
    expect(view.overview?.alerts.filter((a) => /Freight/.test(a.text)).map((a) => a.flow)).toEqual([row?.id]);
  });
});
