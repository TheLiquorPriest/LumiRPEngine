// The work module's test world: Riverton with Brightline and the Daybreak Café as businesses that
// keep their own books, and the helpers its tests read paychecks, postings and events with.

import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PackEvent, PostEvent } from "../../../src/shared/ledger";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

export const reg: Registry = createRegistry(ALL_PACKS);
export const ext = (id: string): string => `economy.external:${id}`;

export function entity(id: string, kind: string, name: string, fields: JsonObject, tier: EntityDef["tier"] = "background"): EntityDef {
  return { id, kind, name, tier, fields, relations: [] };
}

export function account(id: string, owner: string, product: string, opening: number): EntityDef {
  return entity(id, "account", id, { owners: [{ party: owner, role: "owner" }], product, opening });
}

/**
 * Riverton with Brightline as a business that keeps its own books (Jordan owns it) and the café
 * as Daybreak's, each with an operating account; the player, Maya and Rosa bank at checking accounts.
 */
export function setup(patch: (w: WorldDoc) => void = () => undefined): { world: WorldDoc; w: Working } {
  const world = modernUsWorld("w", "Riverton");
  const add = (e: EntityDef): void => void (world.entities[e.id] = e);
  const bl = world.entities.brightline!;
  bl.tier = "principal";
  bl.fields = { ...bl.fields, places: ["office"], owners: [{ party: "jordan", role: "owner", share: 100 }], operating_account: "bl_operating", late_fee_pct: 1.5, invoice_days: 30 };
  add(account("bl_operating", "brightline", "business_checking", 50_000_000));
  add(entity("daybreak", "business", "Daybreak Café", { place: "cafe", places: ["cafe"], owners: [{ party: "maya", role: "owner", share: 100 }], operating_account: "db_operating", collects_sales_tax: true, margin_pct: 60 }, "principal"));
  add(account("db_operating", "daybreak", "business_checking", 200_000));
  add(account("maya_checking", "maya", "checking", 40_000));
  add(account("rosa_checking", "rosa", "checking", 90_000));
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return { world, w };
}

export function lapse(w: Working, minutes: number) {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

export function act(w: Working, type: string, args: JsonObject, seed = type) {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(seed) });
}

export const packEvents = (w: Working, type: string): PackEvent[] => w.events.filter((e: LedgerEvent): e is PackEvent => e.type === type);
export const payslips = (w: Working, job: string): JsonObject[] => packEvents(w, "economy.payslip").map((e) => e.data).filter((d) => d.job === job);
export const paid = (w: Working, job: string): JsonObject[] => payslips(w, job).filter((d) => typeof d.gross === "number" && d.gross > 0);
export const posts = (w: Working, memo: RegExp): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
export const line = (p: PostEvent, account: string): number => p.lines.find((l) => l.account === account)?.amount ?? 0;
/** The payroll postings that pay into an account. */
export const paychecks = (w: Working, into: string): PostEvent[] => posts(w, /^Payroll/).filter((p) => line(p, into) > 0);

/** The player's salaried clerk job at Brightline, paid every other Friday. */
export const CLERK: JsonObject = { worker: "you", employer: "brightline", workplace: "office", title: "Office clerk", occupation: "office_clerk", basis: "salary", rate: 3_740_000, pay_every: "biweekly", pay_anchor: "2026-10-23", start: "2025-01-05" };
