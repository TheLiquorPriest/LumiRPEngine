// Port Alder's money showcase (DESIGN §25), as the starter ships it: the Kowalczyks' household with
// its joint account, shared groceries and Maddie's savings in Helen's care; the POV's debit and
// credit cards in the wallet; a standing savings transfer; and the credit union's counter and ATM
// in Alder Market, with another bank's machine at the fuel station.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { withdraw } from "../../../src/packs/economy/core/actions";
import { canSpend, rightsOf } from "../../../src/packs/economy/core/model";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";

const reg = createRegistry(ALL_PACKS);
const make = STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc;

function portAlder(): Working {
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

describe("Port Alder's money", () => {
  test("the Kowalczyks share a household account and its groceries; Maddie's savings are hers, in Helen's care", () => {
    const w = portAlder();
    expect(canSpend(w.state, "acct_kowalczyk_household", "helen_kowalczyk")).toBe(true);
    expect(canSpend(w.state, "acct_kowalczyk_household", "jess_kowalczyk")).toBe(true);
    expect(rightsOf(w.state, "acct_maddie_savings", "maddie_kowalczyk")?.worth).toBe(true);
    expect(rightsOf(w.state, "acct_maddie_savings", "helen_kowalczyk")?.worth).toBe(false);
    const household = w.ctx.query("economy.finance")(w.ctx, "helen_kowalczyk", false).household;
    expect(household?.members.map((m) => m.id).sort()).toEqual(["helen_kowalczyk", "jess_kowalczyk", "maddie_kowalczyk"]);
    expect(household?.flows.map((f) => f.id)).toContain("flow_kowalczyk_groceries");
    expect(household?.monthly.parts.find((p) => p.id === "jess_kowalczyk")?.cents).toBeGreaterThan(0);
  });

  test("the POV carries a debit and a credit card, and the savings transfer moves on the 2nd", () => {
    const w = portAlder();
    const view = w.ctx.query("economy.finance")(w.ctx, "pov", true);
    expect(view.cards.map((c) => c.id).sort()).toEqual(["card_pov_credit", "card_pov_debit"]);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 20 * 1440 }, { runSeed: "pa", overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
    const runs = w.events.flatMap((e) => (e.type === "economy.flow_run" && "data" in e && e.data.flow === "flow_pov_savings" ? [e.data] : []));
    expect(runs.map((r) => r.cents)).toEqual([15000]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("cash at Alder Market's credit union ATM is free to its members; the fuel station's machine charges", () => {
    const at = (place: string): Working => {
      const w = portAlder();
      expect(w.apply({ type: "set", entity: "pov", field: "place", value: place })).toBeNull();
      return w;
    };
    const market = at("alder_market");
    const free = withdraw(market.ctx, "pov", "acct_pov_checking", 4000);
    if ("code" in free) throw new Error(free.reason);
    const before = market.state.accounts.acct_pov_checking ?? 0;
    market.applyAll(free);
    expect(before - (market.state.accounts.acct_pov_checking ?? 0)).toBe(4000);
    const fuel = at("shoreline_fuel");
    const charged = withdraw(fuel.ctx, "pov", "acct_pov_checking", 4000);
    if ("code" in charged) throw new Error(charged.reason);
    const was = fuel.state.accounts.acct_pov_checking ?? 0;
    fuel.applyAll(charged);
    expect(was - (fuel.state.accounts.acct_pov_checking ?? 0)).toBeGreaterThan(4000 + 350);
    expect(withdraw(at("lakefront_park").ctx, "pov", "acct_pov_checking", 4000)).toMatchObject({ code: "no_atm" });
  });
});
