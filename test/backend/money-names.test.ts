// The player's money view names everyone outside the world in words (DESIGN §25.11): the
// foundation's and the modules' own payees ("Federal tax", "Property upkeep", "Sales tax
// (Michigan)"), an outside employer by its place, a managed property's tenants, and an author's
// own payees as written. Port Alder chats on the fake host, as Play → Money decodes them.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../src/shared/finance";
import { MoneyChat } from "../support/money-chat";

/** Every name a view gives a side of money: its flows' two ends and its transactions' other parties. */
function namesIn(view: FinanceView): string[] {
  return [...view.flows.flatMap((f) => [f.from, f.to]), ...view.accounts.flatMap((a) => a.transactions.flatMap((t) => (t.counterparty === null ? [] : [t.counterparty])))];
}

function flow(view: FinanceView, id: string): { from: string; to: string } {
  const f = view.flows.find((x) => x.id === id);
  if (!f) throw new Error(`no flow ${id} in ${view.name}'s money`);
  return { from: f.from, to: f.to };
}

describe("the player's money view names outside payees in words", () => {
  test("a homeowner's property costs and a business's sales tax name who they pay, an author's payees read as written, and no side is a key", async () => {
    const chat = await MoneyChat.start({ pov: "marcus_delgado" });
    // Past Tuesday the 15th, when the house's upkeep is paid.
    await chat.timelapse(2 * 1440);
    const view = await chat.hub();
    expect(flow(view, "property_tax:prop_birch_lane_12").to).toBe("Property tax (Michigan)");
    expect(flow(view, "property_insurance:prop_birch_lane_12").to).toBe("Property insurance");
    expect(flow(view, "property_upkeep:prop_birch_lane_12").to).toBe("Property upkeep");
    expect(flow(view, "esttax:marcus_delgado").to).toBe("Federal tax");
    expect(flow(view, "salestax:alder_automotive_co").to).toBe("Sales tax (Michigan)");
    expect(flow(view, "insurance:shop_tow_truck").to).toBe("Insurer");
    expect(flow(view, "flow_shop_lease").to).toBe("Harbor Realty");
    expect(flow(view, "bill_marcus_shop_electric").to).toBe("Alder Light & Power");
    const upkeep = view.accounts.flatMap((a) => a.transactions).find((t) => t.memo === "Upkeep, Marcus's house");
    expect(upkeep?.counterparty).toBe("Property upkeep");
    expect(namesIn(view).filter((n) => n.includes(":"))).toEqual([]);
  });

  test("an outside employer reads as the place the job names, and a managed property's tenants as outside tenants", async () => {
    const jess = await (await MoneyChat.start({ pov: "jess_kowalczyk" })).hub();
    expect(jess.jobs.map((j) => j.employer)).toEqual(["The Rusty Anchor"]);
    expect(flow(jess, "pay:job_jess_kowalczyk").from).toBe("The Rusty Anchor");
    expect(namesIn(jess).filter((n) => n.includes(":"))).toEqual([]);
    const helen = await (await MoneyChat.start({ pov: "helen_kowalczyk" })).hub();
    const leases = helen.flows.filter((f) => f.id.startsWith("lease:prop_harbor_114:"));
    expect(leases.length).toBeGreaterThan(0);
    expect(leases.map((f) => f.from)).toEqual(leases.map(() => "Outside tenant"));
    expect(namesIn(helen).filter((n) => n.includes(":"))).toEqual([]);
  });

  test("the player's vehicles are insured by an insurer, not a key", async () => {
    const view = await (await MoneyChat.start()).hub();
    expect(flow(view, "insurance:pov_truck").to).toBe("Insurer");
    expect(namesIn(view).filter((n) => n.includes(":"))).toEqual([]);
  });
});
