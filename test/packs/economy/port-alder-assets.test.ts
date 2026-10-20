// Port Alder's holdings and property (DESIGN §27) as the starter carries them: Marcus's house with
// the mortgage it secures, Helen's building let to its tenants, and the POV's and Priya's holdings,
// as their dashboards draw them and as the first weeks play.
import { describe, expect, test } from "bun:test";
import type { PostEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { isOpened } from "../../../src/packs/economy/core/journal";
import { openerOf } from "../../../src/packs/economy/core/model";
import { openingEvent } from "../../../src/packs/economy/core/process";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";

const reg = createRegistry(ALL_PACKS);

/** The starter in play with every account open; `without` takes entities out, to compare a party's worth against. */
function portAlder(without: readonly string[] = [], patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const id of without) delete world.entities[id];
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

const worth = (w: Working, who: string): number => w.ctx.query("economy.net_worth")(w.ctx, who) ?? 0;

describe("Port Alder's holdings and property", () => {
  test("Marcus's mortgage is tied to his house, and his net worth counts the house", () => {
    const w = portAlder();
    const house = w.ctx.query("economy.finance")(w.ctx, "marcus_delgado", false).properties.find((p) => p.id === "prop_birch_lane_12");
    expect(house?.name).toBe("Marcus's house");
    expect(house?.mortgage?.id).toBe("acct_marcus_mortgage");
    expect(house?.mortgage?.owed).toBe(18778000);
    expect(house?.value).toBe(34000000);
    expect(house?.equity).toBe(34000000 - 18778000);
    expect(worth(w, "marcus_delgado") - worth(portAlder(["prop_birch_lane_12"]), "marcus_delgado")).toBe(34000000);
  });

  test("the POV's holdings count in its net worth, its view never names Marcus's secret address, and Priya's note counts near its face", () => {
    const w = portAlder();
    const pov = w.world.pov;
    const view = w.ctx.query("economy.finance")(w.ctx, pov, true);
    expect((view.investments?.holdings ?? []).map((h) => h.id).sort()).toEqual(["hold_pov_index", "hold_pov_lkfr"]);
    // 31.25 units of the index fund at 100, and 12 Lakefront Freight shares at 42.
    expect(worth(w, pov) - worth(portAlder(["hold_pov_index", "hold_pov_lkfr"]), pov)).toBe(312500 + 12 * 4200);
    expect(JSON.stringify(view)).not.toContain("Birch Lane");
    expect(JSON.stringify(view)).not.toContain("birch_lane_12");
    // The Treasury note is priced from its yield, coupon and time left.
    const note = worth(w, "priya_nair") - worth(portAlder(["hold_priya_tnote"]), "priya_nair");
    expect(note).toBeGreaterThan(5 * 95000);
    expect(note).toBeLessThan(5 * 105000);
  });

  test("by 2 October Helen's outside tenants' rent is in her account, her building's insurance is paid, Marcus's mortgage is paid down, and values move", () => {
    const w = portAlder();
    const to = clockOfLocal(calendarOf(w.world), "2026-10-02T12:00");
    for (let guard = 0; w.state.clock < to && guard < 32; guard++) {
      const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "run", overrides: ALL_NOTE });
      if ("code" in out) throw new Error(out.reason);
    }
    expect(w.state.clock).toBeGreaterThanOrEqual(to);
    const posts = w.events.filter((e): e is PostEvent => e.type === "post");
    const rent = posts.filter((p) => p.lines.some((l) => l.account.startsWith("economy.external:tenant")) && p.lines.some((l) => l.account === "acct_helen_checking" && l.amount > 0));
    expect(rent.length).toBeGreaterThan(0);
    expect(posts.some((p) => p.memo === "Insurance, 114 Harbor Street" && p.lines.some((l) => l.account === "acct_helen_checking" && l.amount === -18500))).toBe(true);
    const house = w.ctx.query("economy.finance")(w.ctx, "marcus_delgado", false).properties.find((p) => p.id === "prop_birch_lane_12");
    expect(house?.mortgage?.owed ?? 0).toBeLessThan(18778000);
    expect(w.state.entities.prop_harbor_114?.fields.value).not.toBe(52000000);
    expect(w.state.entities.prop_birch_lane_12?.fields.value).not.toBe(34000000);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("Marcus's net worth at the chat's start counts his house, his mortgage and his accounts before they open, and is the same once they do", () => {
    const w = portAlder();
    const opened = (account: string): boolean => isOpened(w.state, account, openerOf(w.state, account));
    expect(opened("acct_marcus_mortgage")).toBe(false);
    const before = worth(w, "marcus_delgado");
    const open = openingEvent(w.ctx, "marcus_delgado");
    if (!open) throw new Error("Marcus has no accounts to open");
    w.apply(open);
    expect(opened("acct_marcus_mortgage")).toBe(true);
    expect(w.state.accounts.acct_marcus_mortgage).toBe(-18778000);
    expect(worth(w, "marcus_delgado")).toBe(before);
  });

  test("listed for sale, Marcus's house shows the POV only what a listing would: never its secret address, its owner's mortgage or its leases", () => {
    const w = portAlder();
    w.apply({ type: "set", entity: "prop_birch_lane_12", field: "asking_price", value: 35_000_000 });
    const view = w.ctx.query("economy.finance")(w.ctx, w.world.pov, true);
    expect(view.properties.find((p) => p.id === "prop_birch_lane_12")).toEqual({ id: "prop_birch_lane_12", name: "Marcus's house", place: null, owners: [], share: 0, value: 34_000_000, equity: 0, forSale: 35_000_000, mortgage: null, leases: [], costs: [], route: null });
    const text = JSON.stringify(view);
    for (const hidden of ["Birch Lane", "Marcus's mortgage", "acct_marcus_mortgage"]) expect(text).not.toContain(hidden);
    // Marcus's own view, as the GM sees it, still shows all of it.
    const his = w.ctx.query("economy.finance")(w.ctx, "marcus_delgado", false).properties.find((p) => p.id === "prop_birch_lane_12");
    expect([his?.place, his?.mortgage?.id, his?.owners.map((o) => o.name)]).toEqual(["12 Birch Lane", "acct_marcus_mortgage", ["Marcus Delgado"]]);
  });

  test("Marcus lives in his house, so it stands vacant for nobody; the POV, who lives on Harbor Street, would have it vacant until let; Helen's building is her home too, and its three units are the ones to let", () => {
    const w = portAlder();
    const pov = w.world.pov;
    const leases = (who: string, property: string): { state: string }[] => w.ctx.query("economy.finance")(w.ctx, who, who === pov).properties.find((p) => p.id === property)?.leases ?? [];
    const vacant = (who: string, property: string): number => leases(who, property).filter((l) => l.state === "vacant").length;
    // His home names no units to let: no line for it, so nothing about it needs him.
    expect(leases("marcus_delgado", "prop_birch_lane_12")).toEqual([]);
    // 114 Harbor Street's three units are to let besides the Kowalczyks' own flat: all let, and with the outside letting stopped, the one no lease covers stands vacant.
    expect(vacant("helen_kowalczyk", "prop_harbor_114")).toBe(0);
    w.apply({ type: "set", entity: "prop_harbor_114", field: "managed", value: false });
    expect(vacant("helen_kowalczyk", "prop_harbor_114")).toBe(1);
    // Owned by the POV, the house is nobody's home: one unit to let, vacant.
    w.apply({ type: "set", entity: "prop_birch_lane_12", field: "owners", value: [{ party: pov, role: "owner", share: 100 }] });
    expect(vacant(pov, "prop_birch_lane_12")).toBe(1);
    // And Marcus's again once he has moved out.
    w.apply({ type: "set", entity: "prop_birch_lane_12", field: "owners", value: [{ party: "marcus_delgado", role: "owner", share: 100 }] });
    w.apply({ type: "set", entity: "marcus_delgado", field: "home", value: "harbor_street_114" });
    expect(vacant("marcus_delgado", "prop_birch_lane_12")).toBe(1);
  });

  test("on a property the POV owns with someone it can't see, that owner shows as someone, with no id", () => {
    const w = portAlder([], (world) => {
      // Priya is someone the POV knows only once it meets her.
      const priya = world.entities.priya_nair;
      if (priya) priya.visibility = "known_by";
      for (const e of Object.values(world.entities)) e.relations = e.relations.filter((r) => !(r.type === "knows" && r.to === "priya_nair"));
    });
    const pov = w.world.pov;
    w.apply({ type: "set", entity: "prop_birch_lane_12", field: "owners", value: [{ party: pov, role: "owner", share: 50 }, { party: "priya_nair", role: "owner", share: 50 }] });
    const house = w.ctx.query("economy.finance")(w.ctx, pov, true).properties.find((p) => p.id === "prop_birch_lane_12");
    expect(house?.owners.map((o) => [o.party, o.name, o.share])).toEqual([
      [pov, w.state.entities[pov]?.name, 50],
      [null, "someone", 50],
    ]);
    expect(JSON.stringify(house)).not.toContain("riya");
  });

  test("the POV's pickup, ATV and boat count in its net worth at their used prices, so it reads comfortable, not broke", () => {
    const w = portAlder();
    const view = w.ctx.query("economy.finance")(w.ctx, w.world.pov, true);
    const vehicles = (view.overview?.breakdown ?? []).filter((l) => ["Your pickup", "Your ATV", "Your fishing boat"].includes(l.label));
    expect(vehicles).toEqual([
      { label: "Your ATV", cents: 500_000 },
      { label: "Your fishing boat", cents: 3_200_000 },
      { label: "Your pickup", cents: 3_000_000 },
    ]);
    expect(view.band).toBe("comfortable");
    // A vehicle's own value is what counts when it has one; and Dale's pontoon is Dale's.
    w.apply({ type: "set", entity: "pov_truck", field: "value", value: 1_800_000 });
    const after = w.ctx.query("economy.finance")(w.ctx, w.world.pov, true);
    expect((after.overview?.netWorth ?? 0) - (view.overview?.netWorth ?? 0)).toBe(1_800_000 - 3_000_000);
    expect(after.overview?.breakdown.some((l) => l.label === "Dale's pontoon")).toBe(false);
  });

  test("Alder Automotive is worth its books and a multiple of its last year's profit, never below nothing; Marcus's stake counts it, and a value the GM sets stands instead", () => {
    const w = portAlder();
    const to = clockOfLocal(calendarOf(w.world), "2026-09-17T12:00");
    for (let guard = 0; w.state.clock < to && guard < 32; guard++) {
      const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "run", overrides: ALL_NOTE });
      if ("code" in out) throw new Error(out.reason);
    }
    const shop = "alder_automotive_co";
    const books = w.ctx.query("economy.business_books")(w.ctx, shop, w.state.clock - 525_600, w.state.clock);
    // Three days of walk-in takings and no payday yet: a profit so far.
    expect(books.profit).toBeGreaterThan(0);
    // Its lift loan outweighs its account: on its books alone it is worth less than nothing.
    const book = worth(w, shop) + books.receivables - books.payables;
    expect(book).toBeLessThan(0);
    const stake = (): number => (w.ctx.query("economy.finance")(w.ctx, "marcus_delgado", false).overview?.breakdown ?? []).find((l) => l.label.startsWith("Alder Automotive"))?.cents ?? 0;
    const at = (multiple: number): number => {
      w.apply({ type: "set", entity: shop, field: "valuation_multiple", value: multiple });
      return stake();
    };
    const valued = stake();
    expect(valued).toBe(Math.max(0, Math.round(book + 3 * books.profit)));
    expect(at(0)).toBe(0);
    expect(at(10)).toBe(Math.round(book + 10 * books.profit));
    expect(at(10)).toBeGreaterThan(0);
    w.apply({ type: "set", entity: shop, field: "value", value: 25_000_000 });
    expect(stake()).toBe(25_000_000);
  });
});
