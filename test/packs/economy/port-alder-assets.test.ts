// Port Alder's holdings and property (DESIGN §27) as the starter carries them: Marcus's house with
// the mortgage it secures, Helen's building let to its tenants, and the POV's and Priya's holdings,
// as their dashboards draw them and as the first weeks play.
import { describe, expect, test } from "bun:test";
import type { PostEvent } from "../../../src/shared/ledger";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";

const reg = createRegistry(ALL_PACKS);

/** The starter in play with every account open; `without` takes entities out, to compare a party's worth against. */
function portAlder(without: readonly string[] = []): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const id of without) delete world.entities[id];
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
});
