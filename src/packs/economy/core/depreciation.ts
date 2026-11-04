// Depreciation and depletion (DESIGN §26.5): how what an organization's projects build, and the
// mineral interests it holds, lose value in its books. Each world says how (`packs.economy.config.
// depreciation`, `none` when unset) and each organization may say otherwise (its `depreciation`
// field): `none` expenses a project's costs as they are paid, so EBITDA is operating income; with
// `straight_line` a cost its projects capitalize (category `capex`, adding to the asset's
// `capital_cost`) is spread over the asset's `life_months` from the month after it went into
// service, less its `salvage`, and a mineral interest's cost (`capital_cost`, else its purchase
// price) is depleted by what it produced each month over its `reserves`; a property bought, with no
// capital cost, depreciates on its `purchase_price` the same way. One `economy.depreciate` per asset
// a month, on the 1st for the month just ended, its parts to the owners who depreciate by their
// shares of its worth, never past what is left to recover; what a project capitalized that nothing
// it made took is written off among the depreciation as the project ends (`bookRecovery`). People's
// own things never depreciate. Nothing posts in a world that never turns it on, so recorded chats
// fold as they did.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import { DEPRECIATION_METHODS, FINANCE_EVENTS, ownersIn, worthShares, type DepreciationMethod } from "../../../shared/finance";
import type { FieldDef } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { MembershipContext } from "../../../engine/selector";
import { isGone } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { monthOf } from "./books";
import { str } from "./journal";
import type { FinanceRegistry } from "./module";
import type { Run } from "./run";

/** Months of each party's depreciation kept: as many as its books. */
const MONTHS_KEPT = 25;

/**
 * The fields an asset that depreciates or depletes carries (on `property`): what it cost to build or
 * buy (a project adds what it capitalizes), its useful life and the day it went into service, its
 * salvage value (never depreciated), and a mineral interest's recoverable units, in the units its
 * production counts.
 */
export const DEPRECIATION_FIELDS: Record<string, FieldDef> = {
  capital_cost: { type: "money", label: "Capital cost", min: 0, domain: "money", level: 3 },
  life_months: { type: "number", label: "Useful life (months)", min: 1, domain: "money", level: 3 },
  in_service: { type: "date", label: "In service from", domain: "money", level: 3 },
  salvage: { type: "money", label: "Salvage value", min: 0, domain: "money", level: 3 },
  reserves: { type: "number", label: "Reserves (units)", min: 0, domain: "money", level: 3 },
};

/** An organization's own choice (`depreciation`): its world's (`world`), none (costs are expensed; EBITDA equals operating income), or straight-line with cost depletion. */
export const ORG_DEPRECIATION_FIELD: Record<string, FieldDef> = {
  depreciation: { type: "enum", label: "Depreciation", values: ["world", ...DEPRECIATION_METHODS], default: "world", domain: "money", level: 3 },
};

function methodOf(v: unknown): DepreciationMethod | null {
  return typeof v === "string" && (DEPRECIATION_METHODS as readonly string[]).includes(v) ? (v as DepreciationMethod) : null;
}

/** The world's method (`packs.economy.config.depreciation`), `none` when it sets none. */
export function worldDepreciation(world: ReadContext["world"]): DepreciationMethod {
  return methodOf(world.packs.economy?.config.depreciation) ?? "none";
}

/** How `party`'s books depreciate: an organization's own choice, else its world's; a person's never. */
export function depreciationOf(ctx: MembershipContext, party: EntityId): DepreciationMethod {
  if (orgTypeOf(ctx, party) === null) return "none";
  return methodOf(own(ctx.state.entities, party)?.fields.depreciation) ?? worldDepreciation(ctx.world);
}

/** Whether `party`'s books depreciate: a project's capitalized cost then posts as `capex`, never as an expense. */
export function depreciates(ctx: MembershipContext, party: EntityId): boolean {
  return depreciationOf(ctx, party) === "straight_line";
}

/** What has been recovered of an asset so far (the economy slice's `depreciated`). */
export function recoveredOf(state: Readonly<WorldState>, asset: EntityId): number {
  return numOf(objOf(own(objOf(sliceOf(state, "economy").depreciated), asset)).cents);
}

/** An asset's cost basis: its `capital_cost`, else its purchase price. */
function basisOf(fields: Readonly<JsonObject>): number {
  const cost = Math.round(numOf(fields.capital_cost));
  return cost > 0 ? cost : Math.max(0, Math.round(numOf(fields.purchase_price)));
}

/** `YYYY-MM` of a date's text, or null. */
function monthOfDate(text: string): string | null {
  return /^(\d{4}-\d{2})-\d{2}/.exec(text)?.[1] ?? null;
}

/**
 * What an asset recovers for `month`, or null: depletion where it has reserves (its basis times what
 * it produced over its reserves), else straight-line where it has a life and went into service before
 * that month; never more than is left of its basis less its salvage.
 */
export function recoveryFor(state: Readonly<WorldState>, asset: EntityId, month: string): { kind: "depreciation" | "depletion"; cents: number } | null {
  const f = own(state.entities, asset)?.fields;
  if (!f) return null;
  const basis = basisOf(f);
  const left = basis - Math.max(0, Math.round(numOf(f.salvage))) - recoveredOf(state, asset);
  if (basis <= 0 || left <= 0) return null;
  const reserves = numOf(f.reserves);
  if (reserves > 0) {
    // What it produced that month, as the revenue module's royalties record it (`produced[asset][YYYY-MM]`); read here rather than imported, so the cycle engine needn't load the revenue module.
    const units = numOf(own(objOf(own(objOf(sliceOf(state, "economy").produced), asset)), month));
    const cents = Math.min(left, Math.round((basis * units) / reserves));
    return cents > 0 ? { kind: "depletion", cents } : null;
  }
  const life = Math.round(numOf(f.life_months));
  const from = monthOfDate(strOf(f.in_service));
  if (life < 1 || from === null || month <= from) return null;
  const cents = Math.min(left, Math.round((basis - Math.max(0, Math.round(numOf(f.salvage)))) / life));
  return cents > 0 ? { kind: "depreciation", cents } : null;
}

/**
 * Whether any organization in the world depreciates and any property has a cost to recover as
 * `recoveryFor` reads it (its basis, with reserves or a useful life): else the month's run is skipped.
 */
export function depreciationDue(ctx: ReadContext): boolean {
  let orgs = worldDepreciation(ctx.world) === "straight_line";
  let assets = false;
  for (const e of Object.values(ctx.state.entities)) {
    if (!orgs && e.fields.depreciation === "straight_line") orgs = true;
    if (!assets && e.kind === "property" && basisOf(e.fields) > 0 && (numOf(e.fields.reserves) > 0 || numOf(e.fields.life_months) >= 1)) assets = true;
    if (orgs && assets) return true;
  }
  return false;
}

/**
 * The 1st of a month: each asset's recovery for the month just ended, its parts to the owners at
 * Money 3 or more whose books depreciate, by their shares of its worth.
 */
export function depreciateMonth(run: Run, at: number): void {
  const ctx = run.ctx;
  // The month just ended: the one holding the last minute before this day began.
  const month = monthOf(ctx.world, at - dateAt(calendarOf(ctx.world), at).minuteOfDay - 1);
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (e?.kind !== "property" || isGone(ctx.state, id)) continue;
    const due = recoveryFor(ctx.state, id, month);
    if (!due) continue;
    const shares = worthShares(ownersIn(e.fields));
    const parts = Object.entries(shares)
      .filter(([party, share]) => share > 0 && own(ctx.state.entities, party) && ctx.levelOf(party, "money") >= 3 && depreciates(ctx, party))
      .map(([party, share]) => ({ party, cents: Math.round((due.cents * share) / 100) }))
      .filter((p) => p.cents > 0);
    if (parts.length === 0) continue;
    run.emit([{ type: FINANCE_EVENTS.depreciate, data: { asset: id, month, kind: due.kind, cents: due.cents, parts, at } }]);
  }
}

/** A party's books take `cents` of depreciation or depletion in `month` (the economy slice's `depreciation`, its last 25 months kept): an asset's part of a month's recovery, or a cost written off. */
export function bookRecovery(state: WorldState, party: EntityId, month: string, kind: "depreciation" | "depletion", cents: number): void {
  const books = sliceRecord(state, "economy", "depreciation");
  const months = objOf(own(books, party));
  const cell = objOf(own(months, month));
  months[month] = { ...cell, [kind]: numOf(cell[kind]) + Math.round(cents) };
  for (const old of Object.keys(months).sort().slice(0, -MONTHS_KEPT)) delete months[old];
  books[party] = months;
}

/** `economy.depreciate`: an asset's recovery for a month, what it has recovered grown by it, and each owner's part in their books. */
const DEPRECIATE_EVENT: EventTypeDef<PackEvent> = {
  type: FINANCE_EVENTS.depreciate,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "asset")) && /^\d{4}-\d{2}$/.test(str(e, "month")) && typeof e.data.cents === "number" && Array.isArray(e.data.parts) ? null : ({ code: "bad_event", reason: "a depreciation needs its asset, its month, its amount and its parts" } satisfies Rejection)),
  apply: (e, state) => {
    const asset = str(e, "asset");
    const month = str(e, "month");
    const kind = e.data.kind === "depletion" ? "depletion" : "depreciation";
    const recovered = sliceRecord(state, "economy", "depreciated");
    recovered[asset] = { cents: recoveredOf(state, asset) + Math.round(numOf(e.data.cents)), through: month };
    for (const raw of Array.isArray(e.data.parts) ? e.data.parts : []) {
      const part = objOf(raw);
      const party = strOf(part.party);
      if (party !== "") bookRecovery(state, party, month, kind, numOf(part.cents));
    }
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${e.data.kind === "depletion" ? "Depletion" : "Depreciation"} of ${labelOf(ctx, str(e, "asset"))} for ${str(e, "month")}`),
};

/** Depreciation's fields on property and organizations, its event and its lint. */
export function registerDepreciation(r: FinanceRegistry): void {
  r.fields("property", DEPRECIATION_FIELDS);
  r.fields("business", ORG_DEPRECIATION_FIELD);
  r.fields("trust", ORG_DEPRECIATION_FIELD);
  r.core.event(DEPRECIATE_EVENT);
  r.core.lint({
    code: "economy.depreciation",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "property") continue;
        const f = e.fields;
        if (numOf(f.capital_cost) > 0 && numOf(f.reserves) <= 0 && f.life_months !== undefined && !(numOf(f.life_months) >= 1)) issues.push({ severity: "warning" as const, code: "economy.depreciation", message: `Property ${e.name}'s useful life must be a month or more.`, path: `entities.${e.id}.fields.life_months` });
        if (numOf(f.capital_cost) > 0 && numOf(f.life_months) >= 1 && numOf(f.reserves) <= 0 && monthOfDate(strOf(f.in_service)) === null) issues.push({ severity: "info" as const, code: "economy.depreciation", message: `Property ${e.name} has a cost and a life but no in-service date, so it never depreciates.`, path: `entities.${e.id}.fields.in_service` });
        if (numOf(f.salvage) > 0 && numOf(f.salvage) >= basisOf(f)) issues.push({ severity: "warning" as const, code: "economy.depreciation", message: `Property ${e.name}'s salvage value is no less than its cost, so it never depreciates.`, path: `entities.${e.id}.fields.salvage` });
      }
      return issues;
    },
  });
}
