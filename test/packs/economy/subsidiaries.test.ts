// Subsidiaries and corporate tax (ORG-SPEC §11 Phase 3 Corporate, §3.10, §3.11, §3.13) on Port
// Alder. Ellis Mobile Repair, Jordan's LLC, acting as itself, starts Ellis Towing with $500: its
// Structure shows it at 100 %, its capital is no one's profit, and neither the consolidated cash nor
// Jordan's net worth moves. Ellis Towing's profit reaches Jordan's estimated tax through Ellis Mobile
// Repair, as much as if he held it himself, where before it reached no one: he holds none of it, and
// neither company pays estimated tax. A household's share of a pass-through company's profit is
// taxed to no one, as lint and the Taxes tab say. Restructured to a C corporation, Ellis Mobile
// Repair takes no owner's draw, is taxed as one from the next estimated-tax period, and pays dividends.

import { describe, expect, test } from "bun:test";
import { ownersIn, worthShares, type OwnershipView, type TaxesView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { OrgView } from "../../../src/shared/org-view";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { basisRecord, incomeIn } from "../../../src/packs/economy/core/records";
import { corporateTax, taxStructureAt } from "../../../src/packs/economy/core/taxes";
import { ORG_LINTS } from "../../../src/packs/orgs/core/lint";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";
const MARCUS = "marcus_delgado";
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "subsidiaries");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "subsidiaries" });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function account(w: Working, business: EntityId): EntityId {
  return String(w.state.entities[business]?.fields.operating_account ?? "");
}

/** Ellis Mobile Repair, founded by Jordan with $2,000 from his savings in 1,000 units (as in shares.test.ts). */
function founded(w: Working): void {
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
}

/** A section of an organization's page as Jordan reads it. */
function section<T>(w: Working, org: EntityId, id: string): T {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  const built = pages[org]?.sections[id];
  if (!built) throw new Error(`no ${id} on ${org}'s page`);
  return built as unknown as T;
}

function netWorth(w: Working): number | null {
  return w.ctx.query("economy.finance")(w.ctx, JORDAN, false).overview?.netWorth ?? null;
}

/** A customer outside the world pays `business` an invoice of `cents`: its profit. */
function paidInvoice(w: Working, business: EntityId, cents: number): void {
  expect(gm(w, "economy.invoice_issue", { business, customer_name: "Harbor Marina", cents, memo: "Towing" })).toBe("");
  const invoice = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "invoice" && w.state.entities[id]?.fields.business === business && w.state.entities[id]?.fields.state === "open") ?? "";
  expect(gm(w, "economy.invoice_pay", { invoice })).toBe("");
}

/** Lets time pass to `local` as a Timelapse would, past each stop. */
function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "subsidiaries", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

describe("a subsidiary", () => {
  test("Ellis Mobile Repair, as itself, starts Ellis Towing with $500: Structure shows it at 100 %, and neither the consolidated cash nor Jordan's net worth moves", () => {
    const w = portAlder();
    const worth = netWorth(w);
    founded(w);
    // His $2,000 is Ellis Mobile Repair's capital, no one's profit: his net worth is what it was.
    expect(netWorth(w)).toBe(worth);
    const cash = w.state.accounts[account(w, EMR)] ?? 0;
    const started = act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, as: EMR });
    expect(why(started)).toBe("");
    expect(w.state.entities[TOW]?.fields.owners).toEqual([{ party: EMR, role: "owner", share: 100 }]);
    expect([w.state.accounts[account(w, EMR)], w.state.accounts[account(w, TOW)]]).toEqual([cash - 50_000, 50_000]);
    // Moved by Jordan for Ellis Mobile Repair as its capital, its basis in Ellis Towing as his $2,000 is his in it, and told in both companies' History.
    expect(started.events.find((e) => e.type === "economy.txn")).toMatchObject({ data: { by: JORDAN, as: EMR, category: "investment" } });
    expect([basisRecord(w.state, EMR, JORDAN)?.basis, basisRecord(w.state, TOW, EMR)?.basis]).toEqual([200_000, 50_000]);
    expect(orgHistory(w.state, EMR)[0]).toMatchObject({ text: "Started Ellis Towing, its subsidiary, with $500.00.", by: JORDAN });

    const ownership = section<OwnershipView>(w, EMR, "ownership");
    expect(ownership.children).toEqual([{ id: TOW, name: "Ellis Towing", share: 100, votes: 100, controlled: true, value: 50_000, netWorth: 50_000, cash: 50_000, profit: 0, children: [] }]);
    expect(ownership.consolidated).toEqual({ cash, profit: 0, netWorth: cash, companies: 1 });
    expect(netWorth(w)).toBe(worth);
    // Its capital comes from its own money: Ellis Towing's account, where it is an authorized user, isn't Ellis Mobile Repair's to start another with.
    expect(ownership.acts?.sources.map((s) => s.id)).toEqual([account(w, EMR)]);
  });

  test("its controller issues units in its own subsidiary, deciding as that one's parent at any depth (DESIGN §29.3 Control)", () => {
    const w = portAlder();
    founded(w);
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, as: EMR }))).toBe("");
    // Jordan governs Ellis Towing through Ellis Mobile Repair, so Ellis Towing starts one of its own.
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Parts", amount: 20_000, as: TOW }))).toBe("");
    const PARTS = "ellis_parts_co";
    expect(w.state.entities[PARTS]?.fields.owners).toEqual([{ party: TOW, role: "owner", share: 100 }]);
    // His own votes in it are none, nor Ellis Mobile Repair's: its holder, Ellis Towing, decides.
    expect(why(act(w, JORDAN, "shares_issue", { business: PARTS, to: TOW, units: 100, price: 100 }))).toContain("Jordan Ellis holds 0%");
    expect(why(act(w, JORDAN, "shares_issue", { business: PARTS, to: TOW, units: 100, price: 100, as: EMR }))).toContain("Ellis Mobile Repair holds 0%");
    const issued = act(w, JORDAN, "shares_issue", { business: PARTS, to: TOW, units: 100, price: 100, as: TOW });
    expect(why(issued)).toBe("");
    expect(ownersIn(w.state.entities[PARTS]?.fields ?? {})).toEqual([{ party: TOW, role: "owner", share: 100, units: 1100 }]);
    expect(orgHistory(w.state, PARTS)[0]).toMatchObject({ by: JORDAN });
  });
});

describe("look-through", () => {
  /** From Monday 31 August, Ellis Mobile Repair founded and Ellis Towing paid $1,200 (held by `holder`); then to the estimated tax paid on 15 September for June to August. */
  function estimate(holder: "jordan" | "emr"): { w: Working; cents: number } {
    const w = portAlder((world) => void (world.start.at = "2026-08-31T09:00"));
    founded(w);
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, ...(holder === "emr" ? { as: EMR } : { from: SAVINGS }) }))).toBe("");
    paidInvoice(w, TOW, 120_000);
    lapseTo(w, "2026-09-15T23:00");
    const paid = w.events.filter((e) => e.type === "economy.estimated_tax" && "data" in e && e.data.party === JORDAN);
    expect(paid).toHaveLength(1);
    const periods = paid[0] && "data" in paid[0] ? (paid[0].data.periods as JsonObject[]) : [];
    expect(periods.map((p) => p.key)).toEqual(["2026:6,7,8"]);
    return { w, cents: Number(periods[0]?.cents) };
  }

  test("Ellis Towing's profit reaches Jordan's estimated tax through Ellis Mobile Repair, as if he held it himself", () => {
    const through = estimate("emr");
    expect(through.cents).toBeGreaterThan(0);
    expect(through.cents).toBe(estimate("jordan").cents);
    // Two Port Alders, each run half a month to its estimated tax, take a while.
  }, 30_000);

  test("regression: without look-through no one is taxed on it, since Jordan holds none of Ellis Towing and neither company pays estimated tax", () => {
    const { w } = estimate("emr");
    expect(worthShares(ownersIn(w.state.entities[TOW]?.fields ?? {}))).toEqual({ [EMR]: 100 });
    const payers = w.events.flatMap((e) => (e.type === "economy.estimated_tax" && "data" in e ? [String(e.data.party)] : []));
    expect(payers).not.toContain(EMR);
    expect(payers).not.toContain(TOW);
    for (const party of [EMR, TOW]) expect(w.ctx.query("economy.finance")(w.ctx, party, false).flows.map((f) => f.id)).not.toContain(`esttax:${party}`);
  });

  test("a household at the top pays none: lint says no one pays tax on its share, and the Taxes tab lists it as untaxed", () => {
    // The Kowalczyks hold 40 % of Alder Automotive, an LLC; Marcus reads its Taxes.
    const held = (structure: string) => (world: WorldDoc) => {
      world.pov = MARCUS;
      Object.assign(world.entities[SHOP]?.fields ?? {}, { structure, owners: [{ party: MARCUS, role: "owner", share: 60 }, { party: HOUSEHOLD, role: "owner", share: 40 }] });
    };
    const untaxed = (w: Working) => ORG_LINTS.flatMap((rule) => rule.check(w.world, reg)).filter((i) => i.code === "orgs.profit_untaxed");
    const llc = portAlder(held("llc"));
    expect(untaxed(llc)).toEqual([{ severity: "warning", code: "orgs.profit_untaxed", path: `entities.${SHOP}.fields.owners`, message: "Alder Automotive passes its profit through to its owners, and The Kowalczyks (40%) pays no income tax on its share, so no one does: only people, trusts and C corporations pay it." }]);
    expect(section<TaxesView>(llc, SHOP, "taxes")).toMatchObject({ income: "owners", taxedTo: [{ name: "Marcus Delgado", share: 60 }], untaxed: [{ name: "The Kowalczyks", share: 40 }] });
    // A C corporation pays its own.
    expect(untaxed(portAlder(held("c_corp")))).toEqual([]);
    // A trust holding the share pays tax on it (its brackets, or its settlor's), so lint says nothing.
    const trusted = portAlder((world) => {
      world.entities.kowalczyk_trust = { id: "kowalczyk_trust", kind: "trust", name: "Kowalczyk Trust", tier: "background", fields: { owners: [{ party: "helen_kowalczyk", role: "trustee" }, { party: HOUSEHOLD, role: "beneficiary", share: 100 }] }, relations: [] };
      held("llc")(world);
      Object.assign(world.entities[SHOP]?.fields ?? {}, { owners: [{ party: MARCUS, role: "owner", share: 60 }, { party: "kowalczyk_trust", role: "owner", share: 40 }] });
    });
    expect(untaxed(trusted)).toEqual([]);
  });
});

describe("restructured to a C corporation", () => {
  test("owner's draw is gone, the corporate tax flow starts from the next period, and payouts record as dividends", () => {
    const w = portAlder();
    founded(w);
    paidInvoice(w, EMR, 100_000);
    // Jordan governs it with all its votes: Change structure is his to use.
    expect(section<OwnershipView>(w, EMR, "ownership")).toMatchObject({ mayDraw: true, acts: { restructure: null } });
    const changed = act(w, JORDAN, "org_restructure", { org: EMR, structure: "c_corp" });
    expect(why(changed)).toBe("");
    expect(w.state.entities[EMR]?.fields).toMatchObject({ structure: "c_corp", structure_before: "llc", structure_from: "2027-01-01" });
    expect(orgHistory(w.state, EMR)[0]?.text).toBe("Became a C corporation, taxed as one from 1 Jan 2027");

    // Owner's draw is gone.
    expect(section<OwnershipView>(w, EMR, "ownership").mayDraw).toBe(false);
    const till = w.state.accounts[account(w, EMR)];
    expect(why(act(w, JORDAN, "owner_draw", { business: EMR, amount: 10_000 }))).not.toBe("");
    expect(w.state.accounts[account(w, EMR)]).toBe(till);

    // Taxed as an LLC to the end of this estimated-tax period, September to December: its profit is still Jordan's.
    const cal = calendarOf(w.world);
    expect([taxStructureAt(w.ctx, EMR, w.state.clock), taxStructureAt(w.ctx, EMR, clockOfLocal(cal, "2027-01-01T00:00"))]).toEqual(["llc", "c_corp"]);
    expect(section<TaxesView>(w, EMR, "taxes")).toMatchObject({ income: "owners", taxedTo: [{ name: "Jordan Ellis", share: 100 }], pending: { structure: "c_corp", from: "1 Jan 2027" } });
    // From January a corporation's: its corporate tax flow pays nothing on 15 January for those months, though it made $1,000 in September, and what it makes from January is its own taxable profit.
    const january = new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(cal, "2027-01-11T09:00") });
    const then = section<TaxesView>(january, EMR, "taxes");
    expect(then).toMatchObject({ income: "corporate", incomeSoFar: 0, taxedTo: [], pending: null });
    expect(then.due).toContainEqual({ label: "Corporate income tax", cents: 0, at: "15 Jan 2027" });
    paidInvoice(january, EMR, 100_000);
    expect(section<TaxesView>(january, EMR, "taxes").incomeSoFar).toBe(corporateTax(january.ctx, EMR, 100_000));
    expect(corporateTax(january.ctx, EMR, 100_000)).toBeGreaterThan(0);

    // Jordan's estimated tax pays for its September to December on 15 January; once that's paid, his flow ends, as a corporation's owner has nothing for it to pay.
    const flows = (x: Working): string[] => x.ctx.query("economy.finance")(x.ctx, JORDAN, false).flows.map((f) => f.id);
    expect([flows(w), flows(january)].map((ids) => ids.includes(`esttax:${JORDAN}`))).toEqual([true, true]);
    const after = new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(cal, "2027-01-20T09:00") });
    expect(flows(after)).toContain(`esttax:${JORDAN}`);
    expect(after.apply({ type: "economy.estimated_tax", data: { party: JORDAN, periods: [{ key: "2026:9,10,11,12", cents: 25_000 }] } })).toBeNull();
    expect(flows(after)).not.toContain(`esttax:${JORDAN}`);

    // A payout is a dividend.
    expect(why(act(w, JORDAN, "distribute_profit", { business: EMR, amount: 30_000 }))).toBe("");
    expect(incomeIn(w.state, JORDAN, dateAt(cal, w.state.clock).year)).toMatchObject({ dividend: 30_000, profit: 0 });
  });
});
