// Who may hold an S corporation (DESIGN §26.3; IRC section 1361): people, eligible trusts and
// 501(c)(3) organizations, at most 100 of them. Jordan's S corporation can't sell part of itself to a
// company, issue shares to one, or take in a company's holders by merging; an authored one with 100
// holders refuses a 101st, and lint says when the world authors one a company holds. A company with a
// company among its holders can't become an S corporation. Each refusal says why in words.

import { describe, expect, test } from "bun:test";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { bank, CHURCH, corporation, gm, JORDAN, MARCUS, named, operating, portAlder, reg, SHOP } from "./tax-world";

const person = (id: string): EntityDef => ({ id, kind: "person", name: `Baker ${id.slice(-3)}`, tier: "background", fields: {}, relations: [] });

/** Harbor Bakery, an S corporation its hundred bakers hold 1% each. */
function bakery(world: WorldDoc): void {
  const owners = [];
  for (let i = 1; i <= 101; i++) {
    const id = `baker_${String(i).padStart(3, "0")}`;
    world.entities[id] = person(id);
    world.entities[`acct_${id}`] = bank(`acct_${id}`, id);
    if (i <= 100) owners.push({ party: id, role: "owner", share: 1 });
  }
  world.entities.harbor_bakery = { id: "harbor_bakery", kind: "business", name: "Harbor Bakery", tier: "background", fields: { structure: "s_corp", owners }, relations: [] };
}

describe("S corporation holders", () => {
  test("Jordan's S corporation refuses a company as a buyer or a holder of new shares, and takes a charity", () => {
    const w = portAlder();
    const id = corporation(w, "Harbor Tours", "s_corp");
    expect(gm(w, "economy.stake_sell", { business: id, share: 10, price: 0, buyer: SHOP, party: JORDAN })).toBe("Harbor Tours is an S corporation: Alder Automotive is a company, and an S corporation's shareholders are people, eligible trusts and charities (501(c)(3) organizations)");
    expect(gm(w, "economy.shares_issue", { business: id, to: SHOP, units: 10, price: 100 })).toContain("an S corporation's shareholders are people");
    // A church, a 501(c)(3), may hold it; so may a person.
    expect(gm(w, "economy.stake_sell", { business: id, share: 10, price: 0, buyer: CHURCH, party: JORDAN })).toBe("");
    expect(gm(w, "economy.stake_sell", { business: id, share: 10, price: 0, buyer: MARCUS, party: JORDAN })).toBe("");
  });

  test("a hundred holders take no 101st; a sale between them stands", () => {
    const w = portAlder(bakery);
    expect(gm(w, "economy.stake_sell", { business: "harbor_bakery", share: 0.5, price: 0, buyer: "baker_101", party: "baker_001" })).toContain("it would have 101 shareholders, and an S corporation has at most 100");
    expect(gm(w, "economy.stake_sell", { business: "harbor_bakery", share: 0.5, price: 0, buyer: "baker_002", party: "baker_001" })).toBe("");
  });

  test("a company a company holds can't become an S corporation; lint says when the world authors one", () => {
    const w = portAlder();
    const holdings = corporation(w, "Harbor Holdings");
    expect(gm(w, "orgs.found", { type: "company", name: "Harbor Towing", structure: "c_corp", cents: 50_000, from: operating(w, holdings), founder: holdings })).toBe("");
    const towing = named(w, "Harbor Towing");
    const refused = w.ctx.service("economy.restructure")(w.ctx, towing, "s_corp");
    expect(Array.isArray(refused) ? "" : refused.reason).toBe("Harbor Towing can't become an S corporation: Harbor Holdings is a company, and an S corporation's shareholders are people, eligible trusts and charities (501(c)(3) organizations)");
    const world = structuredClone(w.world);
    world.entities.harbor_ferry = { id: "harbor_ferry", kind: "business", name: "Harbor Ferry", tier: "background", fields: { structure: "s_corp", owners: [{ party: SHOP, role: "owner", share: 100 }] }, relations: [] };
    const issues = lintWorld(world, reg).filter((i) => i.code === "economy.scorp_holders");
    expect(issues.map((i) => [i.severity, i.path])).toEqual([["warning", "entities.harbor_ferry.fields.owners"]]);
    expect(issues[0]?.message).toContain("Alder Automotive can't hold its shares");
  });
});
