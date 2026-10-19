// Port Alder's holdings and property (DESIGN §27): Marcus's house with the mortgage it secures,
// Helen's building let to its tenants, and Priya's Treasury note, as their dashboards draw them
// and as their first month plays. The starter carries them once the template does; until then the
// test adds the same data.
import { describe, expect, test } from "bun:test";
import type { PostEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";

const reg = createRegistry(ALL_PACKS);

/** The showcase data the template carries (added here while the starter doesn't have it yet). */
function showcase(world: WorldDoc): void {
  if (world.entities.prop_birch_lane_12) return;
  world.places.birch_lane_12 = { id: "birch_lane_12", name: "12 Birch Lane", parent: "port_alder", sceneType: "downtime", fields: { tags: ["residential"] } };
  const economy = world.packs.economy;
  if (economy) economy.config = { ...economy.config, assets: { tnote_2030: { label: "US Treasury note, 4.25%, August 2030", symbol: "T 4.25 08/30", class: "bond", face: 100000, coupon_pct: 4.25, maturity: "2030-08-15", price: 100400 } } };
  world.entities.prop_birch_lane_12 = { id: "prop_birch_lane_12", kind: "property", name: "12 Birch Lane", tier: "background", fields: { place: "birch_lane_12", owners: [{ party: "marcus_delgado", role: "owner", share: 100 }], value: 34000000, appreciation_pct: 3.5, purchase_price: 27850000, purchased: "2018-06-15", mortgage: "acct_marcus_mortgage", tax_pct: 1.1, upkeep_pct: 0.8 }, relations: [] };
  world.entities.acct_marcus_mortgage = { id: "acct_marcus_mortgage", kind: "account", name: "Mortgage, 12 Birch Lane", tier: "background", fields: { owners: [{ party: "marcus_delgado", role: "owner" }], product: "mortgage", institution: "Lakeshore Credit Union", opening: -18778000, apr_pct: 4.6, payment: 114200, months_left: 260, due_day: 1, secured_by: "prop_birch_lane_12" }, relations: [] };
  world.entities.prop_harbor_114 = { id: "prop_harbor_114", kind: "property", name: "114 Harbor Street", tier: "background", fields: { place: "harbor_street_114", owners: [{ party: "helen_kowalczyk", role: "owner", share: 100 }], value: 52000000, appreciation_pct: 3, purchase_price: 9500000, purchased: "1986-04-01", tax_pct: 0.88, insurance: 18500, upkeep_pct: 0.6, units: 3, managed: true, market_rent: 98000, lease_months: 12, vacancy_months: 1, rent_to: "acct_helen_checking" }, relations: [] };
  world.entities.hold_priya_tnote = { id: "hold_priya_tnote", kind: "holding", name: "Treasury note", tier: "background", fields: { owners: [{ party: "priya_nair", role: "owner" }], asset: "tnote_2030", lots: [{ qty: 5, cost: 497500, at: "2025-08-20" }], route: "acct_priya_checking" }, relations: [] };
}

function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  showcase(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

describe("Port Alder's holdings and property", () => {
  test("Marcus's mortgage is tied to his house, and his net worth counts the house", () => {
    const w = portAlder();
    const view = w.ctx.query("economy.finance")(w.ctx, "marcus_delgado", false);
    const house = view.properties.find((p) => p.id === "prop_birch_lane_12");
    expect(house?.mortgage?.id).toBe("acct_marcus_mortgage");
    expect(house?.value).toBe(34000000);
    expect(house?.equity).toBe(34000000 - (house?.mortgage?.owed ?? 0));
    expect(house?.place).toBe("12 Birch Lane");
    // His net worth counts the house, less the mortgage once his accounts are open.
    const plain = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("pa", "Port Alder");
    const without = new Working(reg, plain, startState(plain));
    const worth = (x: Working): number => x.ctx.query("economy.net_worth")(x.ctx, "marcus_delgado") ?? 0;
    expect([34000000, 34000000 - 18778000]).toContain(worth(w) - worth(without));
    // Priya's Treasury note counts at its price from its yield, coupon and time left: about its face.
    const priya = (x: Working): number => x.ctx.query("economy.net_worth")(x.ctx, "priya_nair") ?? 0;
    expect(priya(w) - priya(without)).toBeGreaterThan(5 * 95000);
    expect(priya(w) - priya(without)).toBeLessThan(5 * 105000);
  });

  test("on the 1st Helen's outside tenants' rent lands in her account, her building's insurance is paid, and its value moves", () => {
    const w = portAlder();
    const to = clockOfLocal(calendarOf(w.world), "2026-10-01T12:00");
    for (let guard = 0; w.state.clock < to && guard < 32; guard++) {
      const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "run", overrides: ALL_NOTE });
      if ("code" in out) throw new Error(out.reason);
    }
    const posts = w.events.filter((e): e is PostEvent => e.type === "post");
    const rent = posts.filter((p) => p.lines.some((l) => l.account.startsWith("economy.external:tenant")) && p.lines.some((l) => l.account === "acct_helen_checking" && l.amount > 0));
    expect(rent.length).toBeGreaterThan(0);
    expect(posts.some((p) => p.memo === "Insurance, 114 Harbor Street" && p.lines.some((l) => l.account === "acct_helen_checking" && l.amount === -18500))).toBe(true);
    expect(w.state.entities.prop_harbor_114?.fields.value).not.toBe(52000000);
    expect(w.state.entities.prop_birch_lane_12?.fields.value).not.toBe(34000000);
    expect(trialBalance(w.state)).toBe(0);
  });
});
