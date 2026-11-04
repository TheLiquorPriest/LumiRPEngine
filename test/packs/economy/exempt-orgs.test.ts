// Exempt organizations (ORG-SPEC §3.11, Phase 5; DESIGN §26.3) on Port Alder: St Brendan's Church
// (a church) and the Harbor Yacht Club (a social club) take gifts; a nonprofit corporation pays no
// corporate tax and has no tax flow; a pass-through company's share held by an exempt organization is
// taxed to no one by its exemption, listed apart and not linted as untaxed; Jordan's gift to the
// church is deductible and the club's isn't; his ordinary income drops by the deduction, and the
// April refund pays what it saved at the top level, nothing below it; lint tells an unknown status,
// a household marked exempt and an exempt company with owners; the `tax_status` op sets and clears a
// status with its History line.

import { describe, expect, test } from "bun:test";
import type { TaxesView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { PostEvent } from "../../../src/shared/ledger";
import { parseOrgOp } from "../../../src/shared/org-ops";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { donationsGiven, donationsReceived } from "../../../src/packs/economy/core/exempt";
import { ORG_LINTS } from "../../../src/packs/orgs/core/lint";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const SAVINGS = "acct_pov_savings";
const SHOP = "alder_automotive_co";
const MARCUS = "marcus_delgado";
const HOUSEHOLD = "household_kowalczyk";
const CHURCH = "st_brendans_church";
const CLUB = "harbor_yacht_club";

function org(id: EntityId, name: string, fields: JsonObject): EntityDef {
  return { id, kind: "group", name, tier: "background", fields, relations: [] };
}

function bank(id: EntityId, owner: EntityId): EntityDef {
  return { id, kind: "account", name: "Checking", tier: "background", fields: { product: "checking", owners: [{ party: owner, role: "owner", share: 100 }], opening: 0 }, relations: [] };
}

/** Port Alder with the church and the club, each with an account of its own and Jordan a member of both (so they run at his Money level); `patch` before it starts. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.entities[CHURCH] = org(CHURCH, "St Brendan's Church", { tax_exempt: "church" });
  world.entities[CLUB] = org(CLUB, "Harbor Yacht Club", { tax_exempt: "club" });
  world.entities.acct_church = bank("acct_church", CHURCH);
  world.entities.acct_club = bank("acct_club", CLUB);
  const pov = world.entities[JORDAN]!;
  world.entities[JORDAN] = { ...pov, relations: [...pov.relations, { type: "member_of", to: CHURCH, fields: {} }, { type: "member_of", to: CLUB, fields: {} }] };
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "exempt");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "exempt" });
}

function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

const taxesOf = (w: Working, id: EntityId): TaxesView => readPass(() => buildOrgView(w.ctx, id, null))?.sections.taxes as unknown as TaxesView;
const named = (w: Working, name: string): EntityId => Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === name) ?? "";
const posts = (w: Working, memo: RegExp): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
const at = (w: Working, local: string): Working => new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(calendarOf(w.world), local) });

function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "exempt", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** Jordan's year of pay, $60,000 through his mechanic's job, as a payslip writes it. */
function yearOfPay(w: Working): void {
  expect(w.apply({ type: "economy.payslip", data: { job: "job_pov_mechanic", worker: JORDAN, through: w.state.clock, gross: 6_000_000, taxes: 0, deductions: 0, net: 6_000_000, minutes: 0, shifts: 0, year: 2026, month: 6, fica: 6_000_000, pretax: 0 } })).toBeNull();
}

const taxable = (w: Working): number => w.ctx.query("economy.ordinary_income")(w.ctx, JORDAN, 2026).taxable;

describe("exempt organizations: income tax", () => {
  test("a nonprofit corporation pays no corporate income tax and has no tax flow; its Taxes says why", () => {
    const w = portAlder();
    expect(gm(w, "orgs.found", { type: "company", name: "Harbor Food Bank", structure: "c_corp", cents: 50_000, from: SAVINGS, by: JORDAN })).toBe("");
    const bank = named(w, "Harbor Food Bank");
    expect(taxesOf(w, bank).due.map((d) => d.label)).toContain("Corporate income tax");
    expect(gm(w, "economy.tax_status", { org: bank, status: "charity" })).toBe("");
    const view = taxesOf(w, bank);
    expect(view).toMatchObject({ income: "exempt", incomeSoFar: null, exempt: { status: "charity", name: "Charity or nonprofit", code: "501(c)(3)", deductible: true, futa: false, suta: true }, consolidation: null });
    expect(view.due.map((d) => d.label)).not.toContain("Corporate income tax");
    // A status the world doesn't know is refused.
    expect(gm(w, "economy.tax_status", { org: bank, status: "temple" })).toContain("isn't a status in this world's exempt table");
  });

  test("a pass-through company's share held by an exempt organization is taxed to no one by its exemption, listed apart, and not linted", () => {
    const w = portAlder((world) => {
      world.entities[SHOP]!.fields = { ...world.entities[SHOP]!.fields, owners: [{ party: MARCUS, role: "owner", share: 60 }, { party: CHURCH, role: "owner", share: 40 }] };
    });
    expect(taxesOf(w, SHOP)).toMatchObject({ income: "owners", taxedTo: [{ name: "Marcus Delgado", share: 60 }], untaxed: [], exemptHolders: [{ name: "St Brendan's Church", share: 40 }] });
    const codes = ORG_LINTS.flatMap((rule) => rule.check(w.world, reg)).filter((i) => i.path.startsWith(`entities.${SHOP}`)).map((i) => i.code);
    expect(codes).not.toContain("orgs.profit_untaxed");
  });

  test("lint tells an unknown status, a household marked exempt and an exempt company with owners, with fixes where one mends it", () => {
    const w = portAlder((world) => {
      world.entities[CLUB]!.fields = { ...world.entities[CLUB]!.fields, tax_exempt: "temple" };
      world.entities[HOUSEHOLD]!.fields = { ...world.entities[HOUSEHOLD]!.fields, tax_exempt: "charity" };
      world.entities[SHOP]!.fields = { ...world.entities[SHOP]!.fields, tax_exempt: "charity" };
    });
    const issues = ORG_LINTS.flatMap((rule) => rule.check(w.world, reg)).filter((i) => i.code.startsWith("orgs.exempt"));
    expect(issues.map((i) => [i.code, i.severity, i.path, i.fix?.label ?? null])).toEqual([
      ["orgs.exempt_owners", "warning", `entities.${SHOP}.fields.owners`, null],
      ["orgs.exempt_unknown", "error", `entities.${CLUB}.fields.tax_exempt`, "Take the status off"],
      ["orgs.exempt_type", "warning", `entities.${HOUSEHOLD}.fields.tax_exempt`, "Take the status off"],
    ]);
    expect(issues.find((i) => i.code === "orgs.exempt_unknown")?.fix?.ops).toEqual([{ op: "remove", path: `/entities/${CLUB}/fields/tax_exempt` }]);
  });
});

describe("exempt organizations: gifts", () => {
  test("Jordan's gift to the church is deductible, the club's isn't, and each organization's Taxes counts what it received", () => {
    const w = portAlder();
    expect(why(act(w, JORDAN, "donate", { to: CHURCH, amount: 5_000 }))).toBe("");
    expect(why(act(w, JORDAN, "donate", { to: CLUB, amount: 2_000 }))).toBe("");
    expect(donationsGiven(w.state, JORDAN, 2026)).toEqual({ deductible: 5_000, other: 2_000 });
    expect([donationsReceived(w.state, CHURCH, 2026), donationsReceived(w.state, CLUB, 2026)]).toEqual([5_000, 2_000]);
    const [gift] = posts(w, /^Donation to St Brendan's Church/);
    expect(gift?.lines.find((l) => l.account === "acct_church")?.amount).toBe(5_000);
    expect(taxesOf(w, CHURCH)).toMatchObject({ income: "exempt", exempt: { status: "church", deductible: true, futa: false, suta: false } });
    expect(taxesOf(w, CHURCH).years[0]).toMatchObject({ year: 2026, donations: 5_000 });
    expect(taxesOf(w, CLUB).exempt).toMatchObject({ status: "club", deductible: false });
  });

  test("the deduction: the allowance on top of the standard deduction, or the gifts themselves when more; refunded each April at the top level", () => {
    const w = portAlder();
    yearOfPay(w);
    const before = taxable(w);
    expect(before).toBe(6_000_000 - 1_575_000);
    expect(why(act(w, JORDAN, "donate", { to: CHURCH, amount: 50_000 }))).toBe("");
    // From 2026 someone who doesn't itemize deducts up to $1,000 of gifts besides the standard deduction.
    expect(taxable(w)).toBe(before - 50_000);
    // The refund on 15 April: the brackets' tax on $500 less, at his 12%.
    const april = at(w, "2027-04-13T08:00");
    lapseTo(april, "2027-04-16T12:00");
    const [refund] = posts(april, /^Tax saved by 2026 donations/);
    expect(refund?.lines.find((l) => l.amount > 0)?.amount).toBe(6_000);
    // Gifts beyond the standard deduction and the allowance are itemized, up to 60% of income.
    expect(w.apply({ type: "economy.donation", data: { donor: JORDAN, org: CHURCH, cents: 2_000_000, year: 2026, deductible: true } })).toBeNull();
    expect(taxable(w)).toBe(6_000_000 - 2_050_000);
    // Below the top level there is no refund flow.
    const flat = portAlder((world) => {
      world.packs.economy = { ...world.packs.economy!, config: { ...structuredClone(world.packs.economy!.config), features: { tax_brackets: false } } };
    });
    expect(why(act(flat, JORDAN, "donate", { to: CHURCH, amount: 5_000 }))).toBe("");
    const flows = (x: Working): string[] => x.ctx.query("economy.finance")(x.ctx, JORDAN, false).flows.map((f) => f.id);
    expect(flows(w)).toContain(`donation_refund:${JORDAN}`);
    expect(flows(flat)).not.toContain(`donation_refund:${JORDAN}`);
  });
});

describe("exempt organizations: the tax_status op", () => {
  test("the op sets and clears a status with its History line; a household is refused; malformed ops don't parse", () => {
    const w = portAlder();
    const run = (change: JsonObject): string => {
      const op = parseOrgOp(change);
      if (!op) return "malformed";
      const effects = w.ctx.service("orgs.op")(w.ctx, op);
      if (!Array.isArray(effects)) return effects.reason;
      return applyEffects(reg, w, effects, { bindings: {}, rng: createRng(`op:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
    };
    expect(run({ do: "tax_status", org: CLUB, status: null })).toBe("");
    expect(w.state.entities[CLUB]?.fields.tax_exempt).toBe("");
    expect(orgHistory(w.state, CLUB)[0]?.text).toBe("No longer exempt from income tax");
    expect(run({ do: "tax_status", org: CLUB, status: "charity" })).toBe("");
    expect(orgHistory(w.state, CLUB)[0]?.text).toBe("Exempt from income tax as Charity or nonprofit");
    expect(run({ do: "tax_status", org: HOUSEHOLD, status: "charity" })).toContain("can't hold a tax exemption");
    expect(run({ do: "tax_status", org: CLUB })).toBe("malformed");
    expect(parseOrgOp({ do: "consolidate", org: SHOP, elect: "yes" })).toBeNull();
  });
});
