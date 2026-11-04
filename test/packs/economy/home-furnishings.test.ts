// Home furnishings and appliances (ITEMS-SPEC §3.5's `home_furnishings` category: furniture,
// appliances and the TVs, some once household goods or electronics) are sold wherever household
// goods and electronics were, and a purchase of one becomes a thing, as theirs did: Alder Market, a
// grocery, lists a TV and a refrigerator, and buying the refrigerator there makes one, Jordan's.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { materializeAll } from "../../../src/engine/materialize";
import { isThing } from "../../../src/engine/things";
import { Working } from "../../../src/engine/working";
import { placeTrade } from "../../../src/packs/economy/core/index";
import { STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";
import { act, reg } from "./work-world";

/** Port Alder with Jordan at Alder Market, every account open, and the world changes a test makes. */
function atAlderMarket(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const pov = world.entities[world.pov];
  if (pov) pov.fields.place = "alder_market";
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

describe("home furnishings are sold and bought as things", () => {
  test("Alder Market lists a TV, the refrigerator and the sofa among what it sells", () => {
    const w = atAlderMarket();
    const trade = placeTrade(w.ctx, "alder_market");
    expect(trade.categories).toContain("home_furnishings");
    const rows = w.ctx.tables.get("economy.catalog")?.rows ?? {};
    const sold = Object.keys(rows).filter((id) => trade.categories.includes(String(rows[id]?.category)) || trade.sells.includes(id));
    expect(sold).toEqual(expect.arrayContaining(["tv_55_4k", "tv_65_4k", "refrigerator", "sofa", "mattress_queen"]));
    // Named in words, a television there is the 55-inch one.
    const choices = w.ctx.query("economy.item_choices")(w.ctx, "television", w.world.pov).map((o) => o.item);
    expect(choices).toContain("tv_55_4k");
  });

  test("every place that sells household goods or electronics by its tags sells home furnishings, and none other does", () => {
    const tags = ["grocery", "hardware", "shop", "store", "cafe", "bar", "restaurant", "fuel", "marina", "clinic", "pharmacy", "market", "inn", "workplace"];
    for (const tag of tags) {
      const w = atAlderMarket((world) => {
        const market = world.places.alder_market;
        if (market) market.fields.tags = [tag];
      });
      const categories = placeTrade(w.ctx, "alder_market").categories;
      const before = categories.includes("household_goods") || categories.includes("electronics");
      expect([tag, categories.includes("home_furnishings")]).toEqual([tag, before]);
    }
  });

  test("buying a refrigerator at Alder Market makes a refrigerator, Jordan's", () => {
    const w = atAlderMarket();
    const pov = w.world.pov;
    const from = w.events.length;
    expect(act(w, "economy.buy", { payer: pov, item: "refrigerator" }).rejected).toEqual([]);
    const spawned = w.events.slice(from).flatMap((e) => (e.type === "spawn" ? [e.entity.id] : []));
    expect(spawned).toHaveLength(1);
    const id = spawned[0] ?? "";
    expect(isThing(w.ctx, id)).toBe(true);
    expect(w.state.entities[id]?.fields).toMatchObject({ owner: pov, catalog: "refrigerator", category: "home_furnishings" });
    // It was paid for.
    expect(w.events.slice(from).some((e) => e.type === "post" && e.memo.startsWith("Bought Refrigerator"))).toBe(true);
  });
});
