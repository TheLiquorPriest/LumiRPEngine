// Consolidated filing (ORG-SPEC §3.11, Phase 5; DESIGN §26.3, §27.10) on Port Alder: Jordan founds
// Harbor Holdings, a C corporation, which starts Harbor Towing, a C corporation it owns outright.
// Holdings makes $5,000 and Towing loses $500 this year. Filing apart, Holdings pays corporate tax on
// its $5,000 and Towing nothing; once Holdings elects a consolidated return, it pays the federal rate
// on the group's $4,500 and each state rate on its own profit, which is less, and Towing pays nothing,
// its period marked filed by its parent. A company held 79 %, a pass-through one and an exempt one
// aren't included. The `tax_consolidate` action asks for `org.govern`; the op elects and ends it.
// Where Towing bills $2,000 instead, its income tax goes with it: wound up or merged into Holdings,
// it pays its own tax on its own profit, and January's return is Holdings' alone; Holdings wound up
// pays the group's tax so far, crediting Towing with its own, so Towing then owes nothing more of it.

import { describe, expect, test } from "bun:test";
import type { TaxesView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { PostEvent } from "../../../src/shared/ledger";
import type { OrgView } from "../../../src/shared/org-view";
import { parseOrgOp } from "../../../src/shared/org-ops";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { numOf, objOf, sliceOf } from "../../../src/engine/pack-kit";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { monthBook } from "../../../src/packs/economy/core/books";
import { regionRow } from "../../../src/packs/economy/core/model";
import { corporateTax } from "../../../src/packs/economy/core/taxes";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const SAVINGS = "acct_pov_savings";
const SHOP = "alder_automotive_co";
const MARCUS = "marcus_delgado";

function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "consolidated");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "consolidated" });
}

function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

const named = (w: Working, name: string): EntityId => Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === name) ?? "";
const operating = (w: Working, business: EntityId): EntityId => String(w.state.entities[business]?.fields.operating_account ?? "");
const gmTaxes = (w: Working, id: EntityId): TaxesView => readPass(() => buildOrgView(w.ctx, id, null))?.sections.taxes as unknown as TaxesView;
const posts = (w: Working, memo: RegExp): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
const at = (w: Working, local: string): Working => new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(calendarOf(w.world), local) });

/** Jordan's own read of a company's Taxes, through the Orgs panel. */
function jordanTaxes(w: Working, id: EntityId): TaxesView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  return pages[id]?.sections.taxes as unknown as TaxesView;
}

function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "consolidated", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** Harbor Holdings (Jordan's) and Harbor Towing (Holdings'), both C corporations: Holdings bills $5,000; Towing pays Alder Automotive $500, or (`earns`) bills $2,000 itself. */
function group(earns = false): { w: Working; holdings: EntityId; towing: EntityId } {
  const w = portAlder();
  expect(gm(w, "orgs.found", { type: "company", name: "Harbor Holdings", structure: "c_corp", cents: 200_000, from: SAVINGS, by: JORDAN })).toBe("");
  const holdings = named(w, "Harbor Holdings");
  expect(gm(w, "orgs.found", { type: "company", name: "Harbor Towing", structure: "c_corp", cents: 100_000, from: operating(w, holdings), founder: holdings })).toBe("");
  const towing = named(w, "Harbor Towing");
  const invoice = (business: EntityId, args: Record<string, JsonValue>): void => {
    const before = new Set(Object.keys(w.state.entities));
    expect(gm(w, "economy.invoice_issue", { business, cents: 0, ...args })).toBe("");
    // The invoice just issued: the shop has open invoices of its own.
    const id = Object.keys(w.state.entities).find((e) => !before.has(e) && w.state.entities[e]?.kind === "invoice") ?? "";
    expect(gm(w, "economy.invoice_pay", { invoice: id })).toBe("");
  };
  invoice(holdings, { customer_name: "Harbor Marina", cents: 500_000, memo: "Towing contract" });
  if (earns) invoice(towing, { customer_name: "Harbor Marina", cents: 200_000, memo: "Tows" });
  else invoice(SHOP, { customer: towing, cents: 50_000, memo: "Truck repairs" });
  return { w, holdings, towing };
}

describe("consolidated filing", () => {
  test("elected, the parent pays the federal rate on the group's combined profit and each state rate on its own; the member pays nothing", () => {
    const { w, holdings, towing } = group();
    const state = numOf(regionRow(w.ctx, holdings).state_income_tax_effective_pct);
    const apart = corporateTax(w.ctx, holdings, 500_000);
    const together = Math.round((450_000 * 21) / 100 + (500_000 * state) / 100);
    expect(together).toBeLessThan(apart);
    // Not elected: each files its own; Holdings could include Towing.
    expect(gmTaxes(w, holdings)).toMatchObject({ income: "corporate", incomeSoFar: apart, consolidation: { elected: false, members: [{ name: "Harbor Towing", votes: 100, share: 100 }], profit: null, tax: null }, filedBy: null });
    expect(gmTaxes(w, towing)).toMatchObject({ incomeSoFar: 0, filedBy: null });
    // Elected (the GM's effect): the group's figures, and Towing's tax is Holdings' return's.
    expect(gm(w, "economy.consolidate", { org: holdings, elect: true })).toBe("");
    expect(gmTaxes(w, holdings)).toMatchObject({ incomeSoFar: together, consolidation: { elected: true, members: [{ name: "Harbor Towing", votes: 100, share: 100 }], profit: 450_000, tax: together } });
    const member = gmTaxes(w, towing);
    expect(member).toMatchObject({ income: "corporate", incomeSoFar: null, consolidation: null, filedBy: "Harbor Holdings" });
    expect(member.due.map((d) => d.label)).not.toContain("Corporate income tax");

    // On 15 January Holdings pays for September to December, as the group, and Towing's period reads filed.
    const january = at(w, "2027-01-13T08:00");
    lapseTo(january, "2027-01-16T12:00");
    const [paid] = posts(january, /^Corporate income tax, consolidated return/);
    expect(paid?.lines.find((l) => l.account === operating(january, holdings))?.amount).toBe(-together);
    const estimated = objOf(sliceOf(january.state, "economy").estimated);
    expect(objOf(estimated[towing])).toEqual({ "2026:9,10,11,12": 0 });
    expect(objOf(estimated[holdings])).toEqual({ "2026:9,10,11,12": together });
    expect(posts(january, /^Corporate income tax$/).filter((p) => p.lines.some((l) => l.account === operating(january, towing)))).toEqual([]);
  });

  test("a company held 79 %, a pass-through one and an exempt one aren't in the group", () => {
    const { w, holdings } = group();
    const found = (name: string, structure: string): EntityId => {
      expect(gm(w, "orgs.found", { type: "company", name, structure, cents: 10_000, from: operating(w, holdings), founder: holdings })).toBe("");
      return named(w, name);
    };
    const minority = found("Harbor Marine", "c_corp");
    expect(w.apply({ type: "set", entity: minority, field: "owners", value: [{ party: holdings, role: "owner", share: 79 }, { party: JORDAN, role: "owner", share: 21 }] })).toBeNull();
    found("Harbor Parking", "llc");
    const exempt = found("Harbor Fund", "c_corp");
    expect(gm(w, "economy.tax_status", { org: exempt, status: "charity" })).toBe("");
    expect(gmTaxes(w, holdings).consolidation?.members.map((m) => m.name)).toEqual(["Harbor Towing"]);
  });

  test("the action asks for org.govern and writes History; the op elects and ends it; a non-corporation is refused", () => {
    const { w, holdings } = group();
    expect(why(act(w, MARCUS, "tax_consolidate", { org: holdings }))).not.toBe("");
    expect(jordanTaxes(w, holdings).acts).toEqual({ consolidate: null });
    expect(why(act(w, JORDAN, "tax_consolidate", { org: holdings }))).toBe("");
    expect(w.state.entities[holdings]?.fields.consolidated_return).toBe(true);
    expect(orgHistory(w.state, holdings)[0]?.text).toBe("Elected to file one consolidated return with Harbor Towing");
    const op = parseOrgOp({ do: "consolidate", org: holdings, elect: false });
    if (!op) throw new Error("the op didn't parse");
    const effects = w.ctx.service("orgs.op")(w.ctx, op);
    if (!Array.isArray(effects)) throw new Error(effects.reason);
    expect(applyEffects(reg, w, effects, { bindings: {}, rng: createRng("op") }).rejected).toEqual([]);
    expect(w.state.entities[holdings]?.fields.consolidated_return).toBe(false);
    expect(orgHistory(w.state, holdings)[0]?.text).toBe("Stopped filing a consolidated return");
    expect(gm(w, "economy.consolidate", { org: SHOP, elect: true })).toContain("Only a C corporation");
  });
});

describe("consolidated filing as a company goes", () => {
  const estimated = (w: Working, id: EntityId): JsonObject => objOf(objOf(sliceOf(w.state, "economy").estimated)[id]);
  const taxFrom = (w: Working, account: EntityId): number[] => posts(w, /^Corporate income tax/).flatMap((p) => p.lines.filter((l) => l.account === account).map((l) => -l.amount));

  test("a member wound up pays its own tax on its own profit, its period marked paid; January's return is its parent's alone", () => {
    const { w, holdings, towing } = group(true);
    expect(gm(w, "economy.consolidate", { org: holdings, elect: true })).toBe("");
    const own = corporateTax(w.ctx, towing, 200_000);
    expect(own).toBeGreaterThan(0);
    const account = operating(w, towing);
    expect(gm(w, "orgs.wind_up", { org: towing })).toBe("");
    expect(posts(w, /^Corporate income tax$/).map((p) => p.lines)).toEqual([[{ account, amount: -own }, { account: "economy.external:tax:federal", amount: own }]]);
    expect(estimated(w, towing)).toEqual({ "2026:9,10,11,12": own });
    // On 15 January Holdings pays on its own $5,000: Towing's profit was taxed as it went.
    const january = at(w, "2027-01-13T08:00");
    lapseTo(january, "2027-01-16T12:00");
    expect(taxFrom(january, operating(january, holdings))).toEqual([corporateTax(january.ctx, holdings, 500_000)]);
    expect(posts(january, /^Corporate income tax, consolidated return/)).toEqual([]);
  });

  test("a parent wound up pays the group's tax so far and credits each member with its own, unbooked; the member then owes none of it", () => {
    const { w, holdings, towing } = group(true);
    expect(gm(w, "economy.consolidate", { org: holdings, elect: true })).toBe("");
    const together = gmTaxes(w, holdings).incomeSoFar ?? 0;
    const own = corporateTax(w.ctx, towing, 200_000);
    expect(together).toBeGreaterThan(own);
    const account = operating(w, holdings);
    expect(gm(w, "orgs.wind_up", { org: holdings })).toBe("");
    expect(taxFrom(w, account)).toEqual([together]);
    expect(estimated(w, holdings)).toEqual({ "2026:9,10,11,12": together });
    expect(estimated(w, towing)).toEqual({ "2026:9,10,11,12": own });
    // Holdings' books carry the tax it paid; Towing's carry none of it.
    expect(monthBook(w.state, holdings, "2026-09").business_tax).toBe(together);
    expect(monthBook(w.state, towing, "2026-09").business_tax ?? 0).toBe(0);
    // Towing, Jordan's now, files alone: its period is paid, and January asks nothing more of it.
    expect(gmTaxes(w, towing).filedBy).toBeNull();
    const january = at(w, "2027-01-13T08:00");
    lapseTo(january, "2027-01-16T12:00");
    expect(taxFrom(january, operating(january, towing))).toEqual([]);
  });

  test("a member merged into its parent pays its own tax on its own profit first: no return files it once it is gone", () => {
    const { w, holdings, towing } = group(true);
    expect(gm(w, "economy.consolidate", { org: holdings, elect: true })).toBe("");
    const own = corporateTax(w.ctx, towing, 200_000);
    const account = operating(w, towing);
    expect(gm(w, "orgs.merge", { org: towing, into: holdings })).toBe("");
    expect(posts(w, /^Corporate income tax$/).map((p) => p.lines)).toEqual([[{ account, amount: -own }, { account: "economy.external:tax:federal", amount: own }]]);
    expect(estimated(w, towing)).toEqual({ "2026:9,10,11,12": own });
    expect(w.state.entities[towing]?.fields.merged_into).toBe(holdings);
  });
});
