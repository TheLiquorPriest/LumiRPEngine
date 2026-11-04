// Port Alder for the year close's tests (DESIGN §26.3): Jordan's companies, trusts and foundations,
// their money posted as the foundation journals it, and time jumped to the dates the taxes fall due.

import { expect } from "bun:test";
import type { TaxesView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { PostEvent } from "../../../src/shared/ledger";
import type { TaxesExtra } from "../../../src/shared/tax-year";
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
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import exemptTable from "../../../src/packs/economy/core/tables/modern-us/exempt.json";
import financeTable from "../../../src/packs/economy/core/tables/modern-us/finance.json";
import type { DataTable } from "../../../src/shared/tables";
import { startState } from "../support";

export const reg = createRegistry(ALL_PACKS);
export const JORDAN = "pov";
export const SAVINGS = "acct_pov_savings";
export const SHOP = "alder_automotive_co";
export const MARCUS = "marcus_delgado";
export const CHURCH = "st_brendans_church";

export function bank(id: EntityId, owner: EntityId, opening = 0): EntityDef {
  return { id, kind: "account", name: "Checking", tier: "background", fields: { product: "checking", owners: [{ party: owner, role: "owner", share: 100 }], opening }, relations: [] };
}

/** Port Alder on this build's tax tables (its starter keeps the tables it shipped with until its Data update), with the church (an account of its own) and Jordan a member of it; `patch` before it starts. */
export function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.tables["economy.exempt"] = exemptTable as unknown as DataTable;
  world.tables["economy.finance"] = financeTable as unknown as DataTable;
  world.entities[CHURCH] = { id: CHURCH, kind: "group", name: "St Brendan's Church", tier: "background", fields: { tax_exempt: "church" }, relations: [] };
  world.entities.acct_church = bank("acct_church", CHURCH);
  const pov = world.entities[JORDAN]!;
  world.entities[JORDAN] = { ...pov, relations: [...pov.relations, { type: "member_of", to: CHURCH, fields: {} }] };
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "tax-world");
  return w;
}

/** The economy config's tax settings with some set. */
export function taxSettings(settings: JsonObject): (world: WorldDoc) => void {
  return (world) => {
    const config = structuredClone(world.packs.economy!.config) as JsonObject;
    const taxes = typeof config.taxes === "object" && config.taxes !== null && !Array.isArray(config.taxes) ? config.taxes : {};
    world.packs.economy = { ...world.packs.economy!, config: { ...config, taxes: { ...taxes, ...settings } } };
  };
}

export function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "tax-world" });
}

export function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

export function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

export const named = (w: Working, name: string): EntityId => Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === name) ?? "";
export const operating = (w: Working, business: EntityId): EntityId => String(w.state.entities[business]?.fields.operating_account ?? "");
export const posts = (w: Working, memo: RegExp): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
export const taxesOf = (w: Working, id: EntityId): TaxesView & TaxesExtra => readPass(() => buildOrgView(w.ctx, id, null))?.sections.taxes as unknown as TaxesView & TaxesExtra;
/** A copy of the chat with its clock set to `local`, nothing between run. */
export const at = (w: Working, local: string): Working => new Working(reg, w.world, { ...(structuredClone(w.state) as WorldState), clock: clockOfLocal(calendarOf(w.world), local) });

export function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "tax-world", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** Money from outside into an account, journaled under `category` (interest, dividends, royalties). */
export function income(w: Working, account: EntityId, cents: number, category: string): void {
  const lines = [
    { account, amount: cents },
    { account: "economy.external:market", amount: -cents },
  ];
  expect(w.apply({ type: "post", lines, memo: `Paid ${category}` })).toBeNull();
  expect(w.apply({ type: "economy.txn", data: { lines, memo: `Paid ${category}`, kind: "income", category } })).toBeNull();
}

/** A paid invoice of `business` to an outside customer: revenue from its trade. */
export function bill(w: Working, business: EntityId, cents: number): void {
  const before = new Set(Object.keys(w.state.entities));
  expect(gm(w, "economy.invoice_issue", { business, customer_name: "Harbor Marina", cents, memo: "Contract work" })).toBe("");
  const id = Object.keys(w.state.entities).find((e) => !before.has(e) && w.state.entities[e]?.kind === "invoice") ?? "";
  expect(gm(w, "economy.invoice_pay", { invoice: id })).toBe("");
}

/** Jordan's C corporation, founded with $2,000 from his savings. */
export function corporation(w: Working, name: string, structure = "c_corp"): EntityId {
  expect(gm(w, "orgs.found", { type: "company", name, structure, cents: 200_000, from: SAVINGS, by: JORDAN })).toBe("");
  return named(w, name);
}

/** The chat jumped to the last evening of `year` and run past midnight, so its year closes. */
export function closeYear(w: Working, year: number): Working {
  const late = at(w, `${year}-12-31T20:00`);
  lapseTo(late, `${year + 1}-01-01T08:00`);
  return late;
}
