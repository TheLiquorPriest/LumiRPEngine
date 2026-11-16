// time_totals: thirty days on a person with a wage and rent give the sums by category and month, and change nothing.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { hashJson } from "../../../src/shared/hash";
import { dataOf } from "../rig";
import { familyRig } from "./kit";

describe("time_totals", () => {
  test("thirty days on a person with a wage and rent give the totals by category, and no value is changed", async () => {
    const t = await familyRig((w) => {
      w.realism.levels.money = 3;
      w.entities.acct_bram = { id: "acct_bram", kind: "account", name: "Bram's coin", tier: "background", fields: { owners: [{ party: "bram", role: "owner" }], product: "cash", opening: 5000 }, relations: [] };
      w.entities.wage = { id: "wage", kind: "flow", name: "Wren's wage", tier: "background", fields: { from: "acct_bram", to: "acct_wren", amount_cents: 2000, every: "week", flow_kind: "income", category: "wages" }, relations: [] };
      w.entities.rent = { id: "rent", kind: "flow", name: "Wren's rent", tier: "background", fields: { from: "acct_wren", to: "acct_bram", amount_cents: 4000, every: "month", days: [10], flow_kind: "bill", category: "rent" }, relations: [] };
    });
    const before = hashJson(t.s.stateAt(t.turn.id).state);
    const r = await t.call("time_totals", { at: "wren", until: "30 days" });
    const data = dataOf(r) as JsonObject;
    const money = (data.money as JsonObject[]).find((m) => m.account === "acct_wren");
    expect(JSON.stringify(money)).toContain("wages");
    expect(JSON.stringify(money)).toContain("rent");
    expect(hashJson(t.s.stateAt(t.turn.id).state)).toBe(before);
  });
});
