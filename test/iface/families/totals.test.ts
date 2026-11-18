// time_totals: thirty days on a person with a wage and rent give the sums by category and month, and change nothing.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { occurrences } from "../../../src/packs/economy/core/flows";
import { balance } from "../../../src/packs/economy/core/model";
import { hashJson } from "../../../src/shared/hash";
import { isRecord } from "../../../src/shared/json";
import type { WorldDoc } from "../../../src/shared/world";
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

/** Bram pays Wren two coins a week from a full till, at a quarter past ten: in the middle of the day's one slot (the rig's calendar has one part, six to six). */
function paid(w: WorldDoc): void {
  w.realism.levels.money = 3;
  w.entities.acct_bram = { id: "acct_bram", kind: "account", name: "Bram's coin", tier: "background", fields: { owners: [{ party: "bram", role: "owner" }], product: "cash", opening: 100000 }, relations: [] };
  w.entities.wage = { id: "wage", kind: "flow", name: "Wren's wage", tier: "background", fields: { from: "acct_bram", to: "acct_wren", amount_cents: 2000, every: "week", at: "10:15", flow_kind: "income", category: "wages" }, relations: [] };
}

async function rigged() {
  let doc: WorldDoc | undefined;
  const t = await familyRig((w) => {
    paid(w);
    doc = w;
  });
  if (doc === undefined) throw new Error("no world");
  return { t, doc, start: t.s.stateAt(t.turn.id).state.world.clock };
}

/** The wages Wren's account is told it takes in over the span, summed over the months. */
function wagesIn(r: ToolResult): number {
  const money = (dataOf(r).money as JsonObject[]).find((m) => m.account === "acct_wren");
  let total = 0;
  if (!isRecord(money?.months)) return total;
  for (const by of Object.values(money.months)) {
    const wages = isRecord(by) ? by.wages : undefined;
    if (isRecord(wages) && typeof wages.in === "number") total += wages.in;
  }
  return total;
}

const SRC = { from: "prose", message: "m-1" };
const DAY = 24 * 60;
const WEEKLY = { every: "week", at: "10:15" } as const;

describe("time_totals counts each slot once, as pass_time records it", () => {
  test("a span that starts in the middle of a slot leaves out the payday pass_time has already paid", async () => {
    const { t, doc, start } = await rigged();
    const first = occurrences(doc, WEEKLY, start, start + 30 * DAY)[0];
    if (first === undefined) throw new Error("no payday");
    await t.call("world_apply", { operations: [{ op: "pass_time", minutes: first.at - start + 30, source: SRC }] });
    expect(balance(t.s.stateAt(t.turn.id).state.world, "acct_wren")).toBe(1200 + 2000);
    // The next payday is a week on: three days ahead holds none, and the slot the clock stands in is not counted again.
    expect(wagesIn(await t.call("time_totals", { at: "wren", until: "3 days" }))).toBe(0);
  });

  test("a span that ends in the middle of a slot counts the payday that falls before its end", async () => {
    const { t, doc, start } = await rigged();
    const first = occurrences(doc, WEEKLY, start, start + 30 * DAY)[0];
    if (first === undefined) throw new Error("no payday");
    expect(wagesIn(await t.call("time_totals", { at: "wren", until: `${first.at - start + 30} minutes` }))).toBe(2000);
    expect(wagesIn(await t.call("time_totals", { at: "wren", until: `${first.at - start - 30} minutes` }))).toBe(0);
  });

  test("eight days give the paydays pass_time pays over the same eight days, and the balance it leaves", async () => {
    const { t, doc, start } = await rigged();
    const paydays = occurrences(doc, WEEKLY, start, start + 8 * DAY).length;
    expect(paydays).toBeGreaterThanOrEqual(1);
    const r = await t.call("time_totals", { at: "wren", until: "8 days" });
    expect(wagesIn(r)).toBe(2000 * paydays);
    const money = (dataOf(r).money as JsonObject[]).find((m) => m.account === "acct_wren");
    const passed = await rigged();
    await passed.t.call("world_apply", { operations: [{ op: "pass_time", for: "8 days", source: SRC }] });
    expect(money?.to).toBe(balance(passed.t.s.stateAt(passed.t.turn.id).state.world, "acct_wren"));
  });
});
