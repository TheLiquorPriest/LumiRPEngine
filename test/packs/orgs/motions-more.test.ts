// Motions carrying the economy's other ownership decisions (ORG-SPEC Phase 5): winding up, merging,
// listing and delisting a company go to its vote when the decider's votes fall short, as issuing
// does, and are carried out when the motion passes. Port Alder: Ellis Mobile Repair with Jordan
// 40 %, Danny 35 % and Priya 25 % of the votes, as in motions.test.ts. A merger short of the votes
// on one company is that company's motion, the other deciding as it is carried out.

import { describe, expect, test } from "bun:test";
import { FINANCE_ACTIONS, listingIn, ownersIn } from "../../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import { ORG_ACTIONS } from "../../../src/shared/org";
import { formatMoney } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { dissolvedOn } from "../../../src/engine/org";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { motionsOf } from "../../../src/packs/orgs/core/motions";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "motions-more" });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

/** Ellis Mobile Repair, Jordan's $2,000 in 1,000 units, with Danny's 875 units and Priya's 625 given by the GM. */
function threeHolders(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, PRIYA, MARCUS]) materializeAll(reg, w, id, "motions-more");
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
  expect(gm(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 875, price: 0 })).toBe("");
  expect(gm(w, "economy.shares_issue", { business: EMR, to: PRIYA, units: 625, price: 0 })).toBe("");
  return w;
}

/** The one open motion at Ellis Mobile Repair, carried by Priya's vote for it (her 25 % with Jordan's). */
function carried(w: Working, text: string): void {
  const open = motionsOf(w.state, EMR).filter((m) => m.status === "open");
  expect(open.map((m) => m.text)).toEqual([text]);
  expect(why(act(w, PRIYA, "org_vote", { org: EMR, motion: open[0]?.id ?? "", vote: "for" }))).toBe("");
  expect(motionsOf(w.state, EMR).find((m) => m.id === open[0]?.id)?.status).toBe("passed");
}

describe("the economy's other ownership decisions, put to a vote", () => {
  test("winding up: refused alone, a motion with `vote` that dissolves nothing yet, and wound up when it passes", () => {
    const w = threeHolders();
    expect(why(act(w, JORDAN, ORG_ACTIONS.windUp, { org: EMR }))).toContain("Winding up Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
    expect(why(act(w, JORDAN, ORG_ACTIONS.windUp, { org: EMR, vote: true }))).toBe("");
    expect(motionsOf(w.state, EMR)[0]?.what.type).toBe("orgs.wind_up");
    expect(dissolvedOn(w.state, EMR)).toBeNull();
    carried(w, "Wind up Ellis Mobile Repair");
    expect(dissolvedOn(w.state, EMR)).not.toBeNull();
    expect(ownersIn(w.state.entities[EMR]?.fields ?? {})).toEqual([]);
  });

  test("merging: the company short of the votes puts it to its vote; the survivor, which Jordan holds whole, decides as it is carried out", () => {
    const w = threeHolders();
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, from: SAVINGS, units: 1000 }))).toBe("");
    expect(why(act(w, JORDAN, ORG_ACTIONS.merge, { org: EMR, into: TOW }))).toContain("Merging Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
    expect(why(act(w, JORDAN, ORG_ACTIONS.merge, { org: EMR, into: TOW, vote: true }))).toBe("");
    expect(motionsOf(w.state, TOW)).toEqual([]);
    expect(dissolvedOn(w.state, EMR)).toBeNull();
    carried(w, "Merge Ellis Mobile Repair into Ellis Towing");
    expect(dissolvedOn(w.state, EMR)).not.toBeNull();
    expect(w.state.entities[EMR]?.fields.merged_into).toBe(TOW);
    expect(ownersIn(w.state.entities[TOW]?.fields ?? {}).map((o) => o.party).sort()).toEqual([DANNY, JORDAN, PRIYA].sort());
  });

  test("listing and delisting: each refused alone, put to a vote with `vote`, and carried out when it passes", () => {
    const w = threeHolders();
    expect(gm(w, "orgs.restructure", { org: EMR, structure: "c_corp" })).toBe("");
    // Its books give its 2,500 units $0.80 each, the most the public pays.
    const list = { business: EMR, units: 500, price: 80 };
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesList, list))).toContain("Listing Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesList, { ...list, vote: true }))).toBe("");
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})).toBeNull();
    carried(w, `List 500 units of Ellis Mobile Repair on the market at ${formatMoney(80, w.world.currency)} a unit`);
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})?.float).toBe(500);

    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesDelist, { business: EMR }))).toContain("Delisting Ellis Mobile Repair needs more than half the votes");
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesDelist, { business: EMR, vote: true }))).toBe("");
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})).not.toBeNull();
    carried(w, "Take Ellis Mobile Repair off the market");
    expect(listingIn(w.state.entities[EMR]?.fields ?? {})).toBeNull();
  });
});
