// The listing ops (ORG-SPEC §7.2; DESIGN §27.10 Listing) as the GM edit `{op: "org", change}` runs
// them for GM → Orgs, `gm_org` and `lre_gm_edit`, on Port Alder with Alder Automotive made a C
// corporation valued at $20,000: `list` counts Marcus's stake in units and puts 500 new ones on the
// market at its books a unit ($20, the most the public pays), `trade` buys Jordan some and sells
// Marcus's cap-table units into the float, and `delist` buys every public unit back; an LLC is
// refused, and the shapes parse.

import { describe, expect, test } from "bun:test";
import { listingIn } from "../../../src/shared/finance";
import { parseOrgOp, type OrgOp } from "../../../src/shared/org-ops";
import type { WorldDoc } from "../../../src/shared/world";
import { resolveEdit } from "../../../src/engine/edits";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { Working } from "../../../src/engine/working";
import { holdingIds } from "../../../src/packs/economy/core/holdings";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const MARCUS = "marcus_delgado";
const STOCK = `stock:${SHOP}`;

function portAlder(corporation = true): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world: WorldDoc = make("pa", "Port Alder");
  const shop = world.entities[SHOP];
  if (corporation && shop) shop.fields = { ...shop.fields, structure: "c_corp", value: 2_000_000 };
  const w = new Working(reg, world, startState(world, reg));
  for (const id of ["pov", MARCUS, SHOP]) materializeAll(reg, w, id, "listing-ops");
  return w;
}

/** The op as a GM edit: "" when it applied, else why not. */
function org(w: Working, change: OrgOp): string {
  const out = resolveEdit(reg, w.world, w.state, [{ op: "org", change }], { gm: true, runSeed: "listing-ops" });
  if ("rejection" in out && out.rejection) return out.rejection.reason;
  for (const e of "events" in out ? out.events : []) {
    const refused = w.apply(e);
    if (refused) return `dropped: ${refused.reason}`;
  }
  return "";
}

describe("the listing ops", () => {
  test("list, trade and delist, as the GM makes them", () => {
    const w = portAlder();
    expect(org(w, { do: "list", org: SHOP, units: 500, price: 2000 })).toBe("");
    expect(w.state.entities[SHOP]?.fields.owners).toEqual([{ party: MARCUS, role: "owner", share: 100, units: 1000 }]);
    expect(listingIn(w.state.entities[SHOP]?.fields ?? {})).toMatchObject({ asset: STOCK, symbol: "AA", float: 500, price: 2000 });
    expect(orgHistory(w.state, SHOP)[0]?.text).toBe("Listed 500 units on the market as AA at $20.00 a unit ($10,000.00)");
    // Jordan buys 10 on the market; Marcus sells 100 of his cap-table units into the float.
    expect(org(w, { do: "trade", org: SHOP, who: "pov", side: "buy", units: 10 })).toBe("");
    expect(holdingIds(w.state).filter((h) => w.state.entities[h]?.fields.asset === STOCK)).toHaveLength(1);
    expect(org(w, { do: "trade", org: SHOP, who: MARCUS, side: "sell", units: 100 })).toBe("");
    expect(w.state.entities[SHOP]?.fields.owners).toEqual([{ party: MARCUS, role: "owner", share: 100, units: 900 }]);
    expect(listingIn(w.state.entities[SHOP]?.fields ?? {})?.float).toBe(600);
    // Off the market: every public unit bought back, Jordan's among them.
    expect(org(w, { do: "delist", org: SHOP })).toBe("");
    expect(w.state.entities[SHOP]?.fields.listing).toBeNull();
    expect(orgHistory(w.state, SHOP)[0]?.text).toBe("Went off the market: bought back 600 public units at $20.00 a unit ($12,000.00)");
  });

  test("an LLC is refused", () => {
    const w = portAlder(false);
    expect(org(w, { do: "list", org: SHOP, units: 500, price: 2000 })).toContain("Only a C corporation lists on a market");
  });

  test("their shapes", () => {
    expect(parseOrgOp({ do: "list", org: SHOP, units: 500, price: 2000, symbol: " AA " })).toEqual({ do: "list", org: SHOP, units: 500, price: 2000, symbol: "AA" });
    expect(parseOrgOp({ do: "list", org: SHOP })).toBeNull();
    expect(parseOrgOp({ do: "delist", org: SHOP })).toEqual({ do: "delist", org: SHOP });
    expect(parseOrgOp({ do: "trade", org: SHOP, who: "pov", side: "buy", units: 10 })).toEqual({ do: "trade", org: SHOP, who: "pov", side: "buy", units: 10 });
    expect(parseOrgOp({ do: "trade", org: SHOP, who: "pov", side: "hold", units: 10 })).toBeNull();
  });
});
