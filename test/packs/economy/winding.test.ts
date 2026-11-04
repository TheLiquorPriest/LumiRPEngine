// Winding up a company (ORG-SPEC §3.13, Phase 5, lane Z; acceptance W1-W6 in the lane's design) on
// Port Alder. All at once it is one unit: its staff's last pay posted, its debts paid, what is left
// paid out to its owners by share against their basis, its accounts closed, its owners gone and it
// dissolved. A holder without more than half the votes is refused in words. Staged, `begin` stops it
// trading and `finish` settles it; `resume` trades again. A company that can't pay its debts isn't
// wound up. What it holds goes to its owners by share, or is sold; things go to its largest holder.
// Once dissolved, nothing more is done for it. Its reckoning names nothing the reader can't see, and
// counts what its last paychecks add to its unemployment tax, which is booked once, as payroll; an
// account it shares keeps going without it, its money not paid out.

import { describe, expect, test } from "bun:test";
import { FINANCE_EVENTS, type OwnershipView } from "../../../src/shared/finance";
import { opaqueId } from "../../../src/shared/hash";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { OrgView } from "../../../src/shared/org-view";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { businessIds, mayAct } from "../../../src/engine/org";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { monthOf, totalsOf } from "../../../src/packs/economy/core/books";
import { basisRecord, gainsIn } from "../../../src/packs/economy/core/records";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const SHOP = "alder_automotive_co";
const SHOP_ACCOUNT = "acct_marcus_shop";
const LIFT_LOAN = "acct_alder_lift_loan";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, MARCUS, SHOP]) materializeAll(reg, w, id, "winding");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "winding" });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function field(w: Working, id: string, f: string): JsonValue | undefined {
  return w.state.entities[id]?.fields[f];
}

/** Ellis Mobile Repair: Jordan's, with $2,000 from his savings in 1,000 units; Danny buys 250 at $2. */
function emr(w: Working): void {
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
  expect(why(act(w, JORDAN, "shares_issue", { business: EMR, to: DANNY, units: 250, price: 200 }))).toBe("");
}

function till(w: Working, business: string): string {
  return String(field(w, business, "operating_account") ?? "");
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

/** Marcus puts $20,000 into the shop, so it can pay off its lift loan and its staff. */
function funded(w: Working): Working {
  expect(w.apply({ type: "post", lines: [{ account: "economy.external:marcus_savings", amount: -2_000_000 }, { account: SHOP_ACCOUNT, amount: 2_000_000 }], memo: "Marcus puts money in" })).toBeNull();
  return w;
}

describe("W1: winding up all at once", () => {
  test("Ellis Mobile Repair: one unit; Jordan 80 % and Danny 20 % of its cash, each against their basis; its account closed; dissolved", () => {
    const w = portAlder();
    emr(w);
    const account = till(w, EMR);
    expect(w.state.accounts[account]).toBe(250_000);
    const jordan = w.state.accounts.acct_pov_checking ?? 0;
    const danny = w.state.accounts.acct_danny_checking ?? 0;
    const r = act(w, JORDAN, "org_wind_up", { org: EMR });
    expect(why(r)).toBe("");
    // One unit: the payouts, the disposals, the account closed, the owners gone, dissolved, the History.
    const group = r.events.find((e) => e.type === "economy.dispose")?.group;
    expect(group).toBeDefined();
    expect(r.events.filter((e) => e.group === group)).toHaveLength(r.events.length);
    expect(w.state.accounts.acct_pov_checking).toBe(jordan + 200_000);
    expect(w.state.accounts.acct_danny_checking).toBe(danny + 50_000);
    expect(w.state.accounts[account]).toBe(0);
    expect(r.events.some((e) => e.type === FINANCE_EVENTS.status && "data" in e && e.data.account === account && e.data.status === "closed")).toBe(true);
    expect(field(w, EMR, "owners")).toEqual([]);
    expect(typeof field(w, EMR, "dissolved")).toBe("string");
    expect(field(w, EMR, "winding_up") ?? null).toBeNull();
    // Each realises nothing: they get back what they put in.
    expect(basisRecord(w.state, EMR, JORDAN)).toBeNull();
    expect(basisRecord(w.state, EMR, DANNY)).toBeNull();
    const year = Number(String(field(w, EMR, "dissolved")).slice(0, 4));
    const realised = gainsIn(w.state, JORDAN, year);
    expect(realised.short + realised.long).toBe(0);
    expect(realised.proceeds).toBe(200_000);
    const history = orgHistory(w.state, EMR).map((l) => l.text);
    expect(history).toEqual(expect.arrayContaining(["Began winding up", "Paid Jordan Ellis $2,000.00 (80%) of what was left", "Paid Danny Okafor $500.00 (20%) of what was left", "Dissolved"]));
  });

  test("Alder Automotive (Marcus's): short of paying its lift loan it isn't wound up; funded, its mechanics' jobs end with their last pay, the loan is paid off, the rest is his", () => {
    const w = portAlder();
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP }))).toMatch(/^Alder Automotive owes \$[\d,.]+ and holds \$23,400\.00: it is \$[\d,.]+ short\. Sell something first, or put money in\.$/);
    expect(field(w, "job_pov_mechanic", "status")).not.toBe("ended");
    funded(w);
    const shop = w.state.accounts[SHOP_ACCOUNT] ?? 0;
    const loan = w.state.accounts[LIFT_LOAN] ?? 0;
    expect(loan).toBeLessThan(0);
    const marcus = w.state.accounts.acct_marcus_checking ?? 0;
    const jordan = w.state.accounts.acct_pov_checking ?? 0;
    const r = act(w, MARCUS, "org_wind_up", { org: SHOP });
    expect(why(r)).toBe("");
    for (const job of ["job_pov_mechanic", "job_danny_mechanic"]) expect(field(w, job, "status")).toBe("ended");
    // Jordan's last pay landed now, from the shop.
    expect(w.state.accounts.acct_pov_checking ?? 0).toBeGreaterThan(jordan);
    expect(w.state.accounts[LIFT_LOAN]).toBe(0);
    expect(w.state.accounts[SHOP_ACCOUNT]).toBe(0);
    const wages = (w.state.accounts.acct_pov_checking ?? 0) - jordan;
    expect(w.state.accounts.acct_marcus_checking ?? 0).toBeLessThan(marcus + shop + loan);
    expect(w.state.accounts.acct_marcus_checking ?? 0).toBeGreaterThan(marcus);
    expect(wages).toBeGreaterThan(0);
    expect(typeof field(w, SHOP, "dissolved")).toBe("string");
    // The payroll flow pays nothing more on payday: the last paycheck is paid through.
    expect(r.events.some((e) => e.type === "economy.payslip")).toBe(true);
  });

  test("a rebased view where the shop's account can't pay the loan drops it whole", () => {
    const w = funded(portAlder());
    const before = structuredClone(w.state) as WorldState;
    const r = act(w, MARCUS, "org_wind_up", { org: SHOP });
    expect(why(r)).toBe("");
    const poor = new Working(reg, w.world, structuredClone(before));
    const left = poor.state.accounts[SHOP_ACCOUNT] ?? 0;
    expect(poor.apply({ type: "post", lines: [{ account: SHOP_ACCOUNT, amount: -left }, { account: "economy.external:elsewhere", amount: left }], memo: "Spent elsewhere" })).toBeNull();
    expect(applyValidUnits(reg, r.events, poor.state, (s) => reg.context(poor.world, s))).toEqual([]);
    expect(poor.state.entities[SHOP]?.fields.dissolved).toBeUndefined();
  });
});

describe("W2: votes", () => {
  test("Danny, with 20 %, may not wind it up", () => {
    const w = portAlder();
    emr(w);
    const r = act(w, DANNY, "org_wind_up", { org: EMR });
    expect(why(r)).toBe("Winding up Ellis Mobile Repair needs more than half the votes; Danny Okafor holds 20%");
    expect(field(w, EMR, "dissolved")).toBeUndefined();
  });

  test("Jordan's own votes: once Danny holds 60 %, Jordan's wind-up is refused in words", () => {
    const w = portAlder();
    emr(w);
    expect(why(act(w, JORDAN, "shares_issue", { business: EMR, to: DANNY, units: 1250, price: 10 }))).toBe("");
    expect(why(act(w, JORDAN, "org_wind_up", { org: EMR }))).toBe("Winding up Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
  });
});

describe("W3: staged", () => {
  test("begin stops it trading; the Ownership shows the reckoning; finish dissolves; resume trades again", () => {
    const w = funded(portAlder());
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP, stage: "begin" }))).toBe("");
    expect(typeof field(w, SHOP, "winding_up")).toBe("string");
    expect(field(w, "job_pov_mechanic", "status")).toBe("ended");
    expect(field(w, SHOP, "dissolved")).toBeUndefined();
    expect(w.ctx.query("economy.finance")(w.ctx, MARCUS, true).flows.some((f) => f.id === `walkin:${SHOP}`)).toBe(false);
    // Hiring while it winds up is refused in words.
    const hire = mayAct(reg.context(w.world, w.state), MARCUS, SHOP, "staff.hire");
    expect(hire).toEqual({ ok: false, reason: "Alder Automotive is winding up" });
    // Jordan's own company, begun: its Ownership reckons what finishing would pay out.
    const own = portAlder();
    emr(own);
    expect(why(act(own, JORDAN, "org_wind_up", { org: EMR, stage: "begin" }))).toBe("");
    const winding = section<OwnershipView>(own, EMR, "ownership").winding;
    expect(winding).toMatchObject({ dissolved: null, why: null, cash: 250_000, debts: [], short: 0 });
    expect(winding?.since).not.toBeNull();
    expect(winding?.payouts.map((p) => [p.party, p.cents])).toEqual([
      [JORDAN, 200_000],
      [DANNY, 50_000],
    ]);
    // A second begin is refused.
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP, stage: "begin" }))).toBe("Alder Automotive is winding up already");
    // Resume, then begin again and finish.
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP, stage: "resume" }))).toBe("");
    expect(field(w, SHOP, "winding_up") ?? null).toBeNull();
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP, stage: "begin" }))).toBe("");
    expect(why(act(w, MARCUS, "org_wind_up", { org: SHOP, stage: "finish" }))).toBe("");
    expect(typeof field(w, SHOP, "dissolved")).toBe("string");
    expect(orgHistory(w.state, SHOP).map((l) => l.text)).toEqual(expect.arrayContaining(["Stopped winding up: it trades again", "Dissolved"]));
  });
});

describe("W4: debts", () => {
  test("an invoice billed to it is paid; one it issued is written off; debts beyond its cash refuse it and write nothing", () => {
    const w = portAlder();
    emr(w);
    // Alder Automotive bills Ellis Mobile Repair $300; Ellis Mobile Repair bills Marcus $120.
    expect(why(act(w, MARCUS, "invoice_issue", { business: SHOP, customer: EMR, amount: 30_000 }))).toBe("");
    expect(why(act(w, JORDAN, "invoice_issue", { business: EMR, customer: MARCUS, amount: 12_000 }))).toBe("");
    const shop = w.state.accounts[SHOP_ACCOUNT] ?? 0;
    expect(why(act(w, JORDAN, "org_wind_up", { org: EMR }))).toBe("");
    expect(w.state.accounts[SHOP_ACCOUNT]).toBe(shop + 30_000);
    const invoices = Object.values(w.state.entities).filter((e) => e.kind === "invoice" && (e.fields.customer === EMR || e.fields.business === EMR));
    expect(invoices.map((e) => e.fields.state).sort()).toEqual(["paid", "void"]);

    const poor = portAlder();
    emr(poor);
    expect(why(act(poor, MARCUS, "invoice_issue", { business: SHOP, customer: EMR, amount: 400_000 }))).toBe("");
    const count = poor.events.length;
    expect(why(act(poor, JORDAN, "org_wind_up", { org: EMR }))).toBe("Ellis Mobile Repair owes $4,000.00 and holds $2,500.00: it is $1,500.00 short. Sell something first, or put money in.");
    expect(poor.events.length).toBe(count);
  });
});

describe("W5: property", () => {
  const withProperty = (w: Working): void => {
    w.apply({ type: "spawn", entity: { id: "prop_emr_garage", kind: "property", name: "The Ellis garage", tier: "background", fields: { owners: [{ party: EMR, role: "owner", share: 100 }], place: "alder_automotive", value: 10_000_000 }, relations: [] } } as LedgerEvent);
    w.apply({ type: "set", entity: "pov_atv", field: "owner", value: EMR });
  };

  test("handed out: the garage to Jordan 80 % and Danny 20 %, the ATV to Jordan", () => {
    const w = portAlder();
    emr(w);
    withProperty(w);
    expect(why(act(w, JORDAN, "org_wind_up", { org: EMR }))).toBe("");
    expect(field(w, "prop_emr_garage", "owners")).toEqual([
      { party: JORDAN, role: "owner", share: 80 },
      { party: DANNY, role: "owner", share: 20 },
    ]);
    expect(field(w, "pov_atv", "owner")).toBe(JORDAN);
    expect(basisRecord(w.state, "prop_emr_garage", JORDAN)?.basis).toBe(8_000_000);
  });

  test("sold: the garage to the market at its value, its price paid out by share", () => {
    const w = portAlder();
    emr(w);
    withProperty(w);
    const danny = w.state.accounts.acct_danny_checking ?? 0;
    expect(gm(w, "orgs.wind_up", { org: EMR, property: "sell" })).toBe("");
    expect(field(w, "prop_emr_garage", "owners")).toEqual([]);
    expect(w.state.accounts.acct_danny_checking).toBe(danny + Math.round((10_250_000 * 20) / 100));
  });
});

describe("W6: once dissolved", () => {
  test("it trades nowhere, no one acts for it, and it can't be wound up or merged again", () => {
    const w = funded(portAlder());
    expect(gm(w, "orgs.wind_up", { org: SHOP })).toBe("");
    const ctx = reg.context(w.world, w.state);
    expect(businessIds(ctx)).not.toContain(SHOP);
    const may = mayAct(ctx, MARCUS, SHOP, "money.spend");
    expect(may.ok).toBe(false);
    expect(may.ok ? "" : may.reason).toMatch(/^Alder Automotive was dissolved on /);
    expect(gm(w, "orgs.wind_up", { org: SHOP })).toMatch(/was dissolved on/);
    expect(gm(w, "orgs.merge", { org: SHOP, into: EMR })).not.toBe("");
  });

  test("a listed company waits until it is delisted", () => {
    const w = portAlder((world) => {
      const shop = world.entities[SHOP];
      if (shop) shop.fields.listing = { asset: "alder", float: 100 };
    });
    expect(gm(w, "orgs.wind_up", { org: SHOP })).toBe("Alder Automotive is listed on the market: delist it first");
  });
});

describe("W7: what the reckoning names, counts and gathers", () => {
  test("a thing it owns and a standing payment Jordan can't see read unnamed, under ids that name nothing", () => {
    const w = portAlder((world) => {
      world.entities.vic_sato = { id: "vic_sato", kind: "person", name: "Vic Sato", tier: "background", visibility: "secret", fields: {}, relations: [] } as EntityDef;
    });
    emr(w);
    expect(w.apply({ type: "spawn", entity: { id: "emr_second_ledger", kind: "item", name: "The second ledger", tier: "background", fields: { owner: EMR, visibility: "secret" }, relations: [] } } as LedgerEvent)).toBeNull();
    expect(w.apply({ type: "spawn", entity: { id: "flow_emr_vic", kind: "flow", name: "Retainer to Vic Sato", tier: "background", fields: { flow_kind: "bill", from: till(w, EMR), to: "vic_sato", amount_cents: 10_000, every: "month", days: [1], status: "active" }, relations: [] } } as LedgerEvent)).toBeNull();
    const winding = section<OwnershipView>(w, EMR, "ownership").winding;
    expect(winding?.assets).toContainEqual({ id: opaqueId("emr_second_ledger"), label: "Something it owns", value: null, goes: "to Jordan Ellis" });
    expect(winding?.payments).toEqual([{ id: opaqueId("flow_emr_vic"), label: "A standing payment" }]);
    const said = JSON.stringify(winding);
    for (const word of ["emr_second_ledger", "second ledger", "vic_sato", "Vic Sato", "flow_emr_vic"]) expect(said).not.toContain(word);
  });

  test("what its last paychecks add to its unemployment tax is reckoned before anything is paid, so the cash it says is enough is; the tax is booked once, as payroll", () => {
    const w = funded(portAlder());
    expect(gm(w, "orgs.wind_up", { org: SHOP, stage: "begin" })).toBe("");
    const debts = (readPass(() => buildOrgView(w.ctx, SHOP, null))?.sections.ownership as unknown as OwnershipView).winding?.debts ?? [];
    const unemployment = debts.find((d) => d.label === "Unemployment tax")?.cents ?? 0;
    expect(unemployment).toBeGreaterThan(0);
    // It holds exactly what the reckoning says it owes.
    const owing = debts.reduce((a, d) => a + d.cents, 0);
    const excess = (w.state.accounts[SHOP_ACCOUNT] ?? 0) - owing;
    expect(w.apply({ type: "post", lines: [{ account: SHOP_ACCOUNT, amount: -excess }, { account: "economy.external:elsewhere", amount: excess }], memo: "Spent elsewhere" })).toBeNull();
    expect(gm(w, "orgs.wind_up", { org: SHOP, stage: "finish" })).toBe("");
    expect(typeof field(w, SHOP, "dissolved")).toBe("string");
    const month = monthOf(w.world, w.state.clock);
    const totals = totalsOf(w.state, SHOP_ACCOUNT, month);
    expect(totals.taxes).toBeUndefined();
    const paid = w.events.filter((e): e is Extract<LedgerEvent, { type: "post" }> => e.type === "post" && e.memo === "Unemployment tax");
    expect(paid.map((p) => p.lines.find((l) => l.account === SHOP_ACCOUNT)?.amount)).toEqual([-unemployment]);
  });

  test("an operating account Jordan co-owns isn't gathered into or paid out: it keeps going without the company", () => {
    const w = portAlder();
    emr(w);
    const account = till(w, EMR);
    expect(w.apply({ type: "set", entity: account, field: "owners", value: [{ party: EMR, role: "joint", share: 50 }, { party: JORDAN, role: "joint", share: 50 }] })).toBeNull();
    const cash = w.state.accounts[account] ?? 0;
    const danny = w.state.accounts.acct_danny_checking ?? 0;
    expect(why(act(w, JORDAN, "org_wind_up", { org: EMR }))).toBe("");
    expect(typeof field(w, EMR, "dissolved")).toBe("string");
    expect(w.state.accounts[account]).toBe(cash);
    expect(w.state.accounts.acct_danny_checking).toBe(danny);
    expect(field(w, account, "owners")).toEqual([{ party: JORDAN, role: "joint", share: 50 }]);
  });
});
