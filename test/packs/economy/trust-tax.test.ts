// How a trust's income is taxed (DESIGN §26.3; IRC sections 641-679), on Port Alder: the Harbor
// Family Trust, Jordan its beneficiary and Marcus its trustee, earns $20,000 of interest in Florida.
// Kept, it pays the trust brackets and the NIIT over the top bracket's start on all of it; what it
// distributes carries its income out to Jordan, up to its distributable net income, so it pays only on
// what it keeps and he on the rest. A grantor trust (revocable, Jordan its settlor) pays none: its
// income is his, and only his yearly flow carries it. Holding 40% of Alder Automotive, an LLC, the
// trust pays its brackets on the share of the shop's profit it keeps, through a yearly flow of its
// own; exempt, it pays none on it, and the shop's Taxes list it among the exempt holders.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import type { Working } from "../../../src/engine/working";
import { investmentTax, trustDistributions } from "../../../src/packs/economy/core/gains";
import { at, bank, bill, gm, income, JORDAN, lapseTo, MARCUS, portAlder, posts, SHOP, taxesOf } from "./tax-world";

const TRUST = "harbor_family_trust";

function trusted(fields: Record<string, string | boolean> = {}): (world: WorldDoc) => void {
  return (world) => {
    world.entities[TRUST] = { id: TRUST, kind: "trust", name: "Harbor Family Trust", tier: "background", fields: { region: "fl", owners: [{ party: JORDAN, role: "beneficiary", share: 100 }, { party: MARCUS, role: "trustee" }], ...fields }, relations: [] };
    world.entities.acct_trust = bank("acct_trust", TRUST, 5_000_000);
  };
}

/** The trust's year with $20,000 of interest recorded. */
function earning(fields: Record<string, string | boolean> = {}) {
  const w = portAlder(trusted(fields));
  expect(w.apply({ type: "economy.income", data: { source: "acct_trust", party: TRUST, cents: 2_000_000, kind: "interest" } })).toBeNull();
  // The money it holds to pay out: its corpus.
  income(w, "acct_trust", 5_000_000, "transfer");
  return w;
}

const flows = (w: ReturnType<typeof portAlder>): string[] => w.ctx.query("economy.finance")(w.ctx, JORDAN, false).flows.map((f) => f.id);

describe("trust tax", () => {
  test("kept, a trust pays its own brackets and the NIIT over $15,650", () => {
    const w = earning();
    // 10% to $3,150, 24% to $11,450, 35% to $15,650, 37% above; 3.8% on the $4,350 over $15,650.
    const brackets = 315_00 + (1_145_000 - 315_000) * 0.24 + (1_565_000 - 1_145_000) * 0.35 + (2_000_000 - 1_565_000) * 0.37;
    expect(investmentTax(w.ctx, TRUST, 2026).cents).toBe(Math.round(brackets + (2_000_000 - 1_565_000) * 0.038));
  });

  test("its distribution carries its income out to Jordan, up to its DNI; it pays on what it keeps", () => {
    const w = earning();
    const jordan = investmentTax(w.ctx, JORDAN, 2026).cents;
    expect(gm(w, "economy.distribute", { business: TRUST, cents: 1_200_000 })).toBe("");
    expect(trustDistributions(w.state, TRUST, 2026).get(JORDAN)).toBe(1_200_000);
    // It keeps $8,000: 10% to $3,150 and 24% on the rest, under the NIIT's threshold.
    expect(investmentTax(w.ctx, TRUST, 2026).cents).toBe(Math.round(315_00 + (800_000 - 315_000) * 0.24));
    expect(investmentTax(w.ctx, JORDAN, 2026).cents).toBeGreaterThan(jordan);
    expect(flows(w)).toContain(`investment_tax:${JORDAN}`);
    // Paying out more than its income carries no more than its income: as much as paying out exactly it.
    const all = earning();
    const exact = earning();
    expect(gm(all, "economy.distribute", { business: TRUST, cents: 3_000_000 })).toBe("");
    expect(gm(exact, "economy.distribute", { business: TRUST, cents: 2_000_000 })).toBe("");
    expect([investmentTax(all.ctx, TRUST, 2026).cents, investmentTax(exact.ctx, TRUST, 2026).cents]).toEqual([0, 0]);
    expect(investmentTax(all.ctx, JORDAN, 2026).cents).toBe(investmentTax(exact.ctx, JORDAN, 2026).cents);
  });

  test("a grantor trust pays none: its income is its settlor's, and only his flow carries it", () => {
    const own = portAlder(trusted());
    const before = investmentTax(own.ctx, JORDAN, 2026).cents;
    const w = earning({ revocable: true, settlor: JORDAN });
    expect(investmentTax(w.ctx, TRUST, 2026).cents).toBe(0);
    expect(investmentTax(w.ctx, JORDAN, 2026).cents).toBeGreaterThan(before);
    const ids = w.ctx.query("economy.finance")(w.ctx, TRUST, false).flows.map((f) => f.id);
    expect(ids).not.toContain(`investment_tax:${TRUST}`);
    expect(flows(w)).toContain(`investment_tax:${JORDAN}`);
  });

  test("regression: its kept share of an LLC's profit pays its brackets, by its own flow on 15 April, though it records no income; an exempt trust's stays untaxed", () => {
    // A principal, so its yearly tax runs; Marcus holds the rest of the shop, which makes $3,000 of profit.
    const holding = (fields: Record<string, string | boolean> = {}): Working => {
      const w = portAlder((world) => {
        trusted(fields)(world);
        world.entities[TRUST]!.tier = "principal";
        Object.assign(world.entities[SHOP]?.fields ?? {}, { structure: "llc", owners: [{ party: MARCUS, role: "owner", share: 60 }, { party: TRUST, role: "owner", share: 40 }] });
      });
      bill(w, SHOP, 300_000);
      return w;
    };
    const taxFlow = (w: Working): boolean => w.ctx.query("economy.finance")(w.ctx, TRUST, false).flows.some((f) => f.id === `investment_tax:${TRUST}`);
    // $1,200 of the profit is the trust's: 10% in its first bracket, no one else paying on it.
    const w = holding();
    expect(w.ctx.query("economy.ordinary_income")(w.ctx, TRUST, 2026).gross).toBe(120_000);
    expect(investmentTax(w.ctx, TRUST, 2026).cents).toBe(12_000);
    expect(taxFlow(w)).toBe(true);
    expect(taxesOf(w, SHOP)).toMatchObject({ taxedTo: [{ name: "Marcus Delgado", share: 60 }, { name: "Harbor Family Trust", share: 40 }], exemptHolders: [] });
    const april = at(w, "2027-04-14T20:00");
    lapseTo(april, "2027-04-16T08:00");
    expect(posts(april, /^Tax on 2026 investment income$/).map((p) => p.lines.find((l) => l.account === "acct_trust")?.amount)).toEqual([-12_000]);
    // An exempt trust pays none on it, has no flow for it, and the shop's Taxes say so.
    const exempt = holding({ tax_exempt: "charity" });
    expect([investmentTax(exempt.ctx, TRUST, 2026).cents, taxFlow(exempt)]).toEqual([0, false]);
    expect(taxesOf(exempt, SHOP)).toMatchObject({ taxedTo: [{ name: "Marcus Delgado", share: 60 }], exemptHolders: [{ name: "Harbor Family Trust", share: 40 }] });
  });
});
