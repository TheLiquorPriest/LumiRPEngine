// Economy model (DESIGN §9.2 Money, §9.3 Economy): accounts, balances, net worth, wealth bands,
// the level-1 notional representation, regions and pricing. Pure reads over the state.
//
// Sign convention: an account's posting total is its balance from its holder's side. Cash,
// checking, savings and brokerage are positive when they hold money; cards and loans are
// negative when money is owed. Every posting balances, so the trial balance is always 0.

import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { Band } from "../../../shared/tables";
import type { WorldDoc } from "../../../shared/world";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { bandOfJson, numOf, objOf, sliceOf, strOf, own, rowOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import type { WorldState } from "../../../engine/state";
import { placeOfEntity } from "../../../engine/scope";

export const ACCOUNT_TYPES = ["cash", "checking", "savings", "card", "loan", "brokerage"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const MARKET = `${EXTERNAL_ACCOUNT_PREFIX}market`;
export const DEFAULT_SYMBOL = "broad_us_equity_index";
/** The outside account corrections post against (a ✎ cash fix, a GM money edit): money they add or remove comes from or goes to it, so the books still balance. Shown as "Correction". */
export const CORRECTION_ACCOUNT = `${EXTERNAL_ACCOUNT_PREFIX}correction`;

export function external(id: string): string {
  return `${EXTERNAL_ACCOUNT_PREFIX}${id}`;
}

/** Wealth bands by net worth in cents (`min` inclusive, `max` exclusive). */
export const WEALTH_BANDS: readonly { label: string; min: number; max: number; typical: number }[] = [
  { label: "broke", min: -Infinity, max: 10_000, typical: 5_000 },
  { label: "poor", min: 10_000, max: 200_000, typical: 45_000 },
  { label: "modest", min: 200_000, max: 2_000_000, typical: 630_000 },
  { label: "comfortable", min: 2_000_000, max: 20_000_000, typical: 6_300_000 },
  { label: "rich", min: 20_000_000, max: 200_000_000, typical: 63_000_000 },
  { label: "wealthy", min: 200_000_000, max: Infinity, typical: 500_000_000 },
];

export function wealthBand(cents: number): string {
  return WEALTH_BANDS.find((b) => cents >= b.min && cents < b.max)?.label ?? "broke";
}

export function bandByLabel(label: string): (typeof WEALTH_BANDS)[number] {
  return WEALTH_BANDS.find((b) => b.label === label) ?? (WEALTH_BANDS[2] as (typeof WEALTH_BANDS)[number]);
}

export function accountType(state: Readonly<WorldState>, id: EntityId): AccountType | null {
  const t = own(state.entities, id)?.fields.type;
  return typeof t === "string" && (ACCOUNT_TYPES as readonly string[]).includes(t) ? (t as AccountType) : null;
}

/** Account entities an owner holds, by type order then id. */
export function accountsOf(state: Readonly<WorldState>, owner: EntityId): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.kind === "account" && own(state.entities, id)?.fields.owner === owner)
    .sort((a, b) => ACCOUNT_TYPES.indexOf(accountType(state, a) ?? "cash") - ACCOUNT_TYPES.indexOf(accountType(state, b) ?? "cash") || a.localeCompare(b));
}

export function balance(state: Readonly<WorldState>, account: EntityId): number {
  return own(state.accounts, account) ?? 0;
}

export function priceOfSymbol(state: Readonly<WorldState>, symbol: string): number {
  return numOf(own(objOf(sliceOf(state, "economy").prices), symbol), 100);
}

/** Market value of a brokerage account's holdings (units × the symbol's price), in cents. */
export function holdingsValue(state: Readonly<WorldState>, account: EntityId): number {
  const e = own(state.entities, account);
  if (!e || accountType(state, account) !== "brokerage") return 0;
  return Math.round(numOf(e.fields.units) * priceOfSymbol(state, strOf(e.fields.symbol, DEFAULT_SYMBOL)) * 100);
}

/** Net worth from the ledger: account balances plus holdings at market. */
export function netWorth(state: Readonly<WorldState>, owner: EntityId): number {
  return accountsOf(state, owner).reduce((a, id) => a + balance(state, id) + holdingsValue(state, id), 0);
}

export interface Anchor {
  band: string;
  typical: number;
  base: number;
}

/**
 * The level-1 representation of an entity without ledger accounts: a notional net worth that
 * starts at its band's typical value and moves with its external account, so a band changed by
 * level-1 spending stays continuous. A band set from outside (a fix, a story effect) re-anchors.
 */
export function anchorOf(state: Readonly<WorldState>, entity: EntityId): Anchor {
  const band = strOf(own(state.entities, entity)?.fields.wealth, "modest");
  const a = objOf(own(objOf(sliceOf(state, "economy").anchors), entity));
  if (a.band === band && typeof a.typical === "number" && typeof a.base === "number") return { band, typical: a.typical, base: a.base };
  return { band, typical: bandByLabel(band).typical, base: balance(state, external(entity)) };
}

export function notional(state: Readonly<WorldState>, entity: EntityId): number {
  const a = anchorOf(state, entity);
  return a.typical + (balance(state, external(entity)) - a.base);
}

/** The wealth band at any level: from the ledger when the entity has accounts, else its band field. */
export function wealthOf(state: Readonly<WorldState>, entity: EntityId): string {
  return accountsOf(state, entity).length > 0 ? wealthBand(netWorth(state, entity)) : strOf(own(state.entities, entity)?.fields.wealth, "modest");
}

/** Money available to spend now: cash and checking balances plus card credit left. */
export function spendable(state: Readonly<WorldState>, owner: EntityId): number {
  let total = 0;
  for (const id of accountsOf(state, owner)) {
    const t = accountType(state, id);
    const b = balance(state, id);
    if (t === "cash" || t === "checking") total += Math.max(0, b);
    if (t === "card") total += Math.max(0, numOf(own(state.entities, id)?.fields.limit) + b);
  }
  return total;
}

// ---------------------------------------------------------------- regions and pricing

export function regionRow(ctx: Pick<ReadContext, "tables" | "world" | "state">, who: EntityId = ctx.world.pov): JsonObject {
  const configured = ctx.world.packs.economy?.config.region;
  const id = strOf(own(ctx.state.entities, who)?.fields.region, typeof configured === "string" ? configured : "us");
  return rowOf(ctx, "economy.regions", id) ?? ctx.tables.get("economy.regions")?.rows.us ?? {};
}

export function costOfLiving(ctx: Pick<ReadContext, "tables" | "world" | "state">, who?: EntityId): number {
  return numOf(regionRow(ctx, who).cost_of_living_multiplier, 1);
}

export interface PriceRef {
  catalog?: string;
  category?: string;
  qty?: number;
  /** A narrated price (lenient worlds accept it inside the band). */
  narrated?: number;
  /** Where the purchase happens (price modifiers by place); default: the POV's place. */
  place?: string | null;
}

/**
 * Active price multipliers for a category at a place (festivals, storms, scarcity): the product of
 * the `economy.modifiers` entries whose scope is the category or every category, whose place is
 * the place or one of its ancestors (or anywhere), and whose `until` hasn't passed.
 */
export function priceModifier(ctx: Pick<ReadContext, "world" | "state">, category: string, place: string | null): number {
  let mult = 1;
  for (const raw of Object.values(objOf(sliceOf(ctx.state, "economy").modifiers))) {
    const m = objOf(raw);
    if (typeof m.until === "number" && m.until <= ctx.state.clock) continue;
    const scope = strOf(m.scope, "all");
    if (scope !== "all" && scope !== category) continue;
    const at = strOf(m.place);
    if (at !== "") {
      let cur: string | undefined = place ?? undefined;
      let inside = false;
      for (let guard = 0; cur && guard < 32 && !inside; guard++) {
        inside = cur === at;
        cur = own(ctx.world.places, cur)?.parent;
      }
      if (!inside) continue;
    }
    mult *= numOf(m.mult, 1);
  }
  return mult;
}

export interface Price {
  /** Total for `qty`. */
  cents: number;
  unitCents: number;
  /** The regional band for one unit. */
  band: Band;
  source: "catalog" | "category";
  /** True when a narrated price was clamped into the band. */
  clamped: boolean;
  name: string;
  category: string;
}

/**
 * Prices from the catalog, else the category band, scaled by the region's cost of living. With an
 * rng the unit price varies (catalog ±8 % around typical; category: triangular over the band); in
 * lenient worlds a narrated price inside the band is accepted and one outside it is clamped.
 */
export function priceOf(ctx: Pick<ReadContext, "tables" | "world" | "state">, ref: PriceRef, rng?: Rng): Price | null {
  const regional = costOfLiving(ctx);
  const qty = ref.qty !== undefined && ref.qty > 0 ? ref.qty : 1;
  const item = ref.catalog ? rowOf(ctx, "economy.catalog", ref.catalog) : undefined;
  const categoryId = item ? strOf(item.category) : (ref.category ?? "");
  const cat = rowOf(ctx, "economy.categories", categoryId);
  const raw = bandOfJson(item ? item.price_cents : cat?.price_cents);
  if (!raw) return null;
  // Regional scaling first, then any active price modifiers.
  const place = ref.place !== undefined ? ref.place : placeOfEntity(ctx.state, ctx.world.pov);
  const mult = regional * priceModifier(ctx, categoryId, place);
  const band: Band = { min: Math.round(raw.min * mult), typical: Math.round(raw.typical * mult), max: Math.round(raw.max * mult) };
  let unit = band.typical;
  if (rng) {
    if (item) unit = Math.min(band.max, Math.max(band.min, Math.round(band.typical * (1 + (rng.next() * 0.16 - 0.08)))));
    else {
      // Triangular(min, typical, max) by inverse CDF.
      const u = rng.next();
      const span = band.max - band.min;
      const c = span > 0 ? (band.typical - band.min) / span : 0;
      unit = Math.round(u < c ? band.min + Math.sqrt(u * span * (band.typical - band.min)) : band.max - Math.sqrt((1 - u) * span * (band.max - band.typical)));
    }
  }
  let clamped = false;
  if (ref.narrated !== undefined && ctx.world.lenientPricing) {
    const n = Math.round(ref.narrated / qty);
    unit = Math.min(band.max, Math.max(band.min, n));
    clamped = unit !== n;
  }
  return { cents: Math.round(unit * qty), unitCents: unit, band, source: item ? "catalog" : "category", clamped, name: strOf(item?.name ?? cat?.name, ref.catalog ?? categoryId), category: categoryId };
}

/**
 * The most a narrated price may charge for something no catalog row prices (DESIGN §9.5), in the
 * world's minor units: the economy pack's `unpricedCap` when set, else `derivedUnpricedCap`. A
 * price the player states is never capped.
 */
export function unpricedCap(world: WorldDoc): number {
  const set = world.packs.economy?.config.unpricedCap;
  return typeof set === "number" && Number.isFinite(set) && set > 0 ? Math.round(set) : derivedUnpricedCap(world);
}

/**
 * The cap a world gets without one set: the highest price its own price data lists (the largest
 * band maximum among its catalog rows and category bands, before regional scaling), or 500 major
 * units when it lists none.
 */
export function derivedUnpricedCap(world: WorldDoc): number {
  let top = 0;
  for (const table of ["economy.catalog", "economy.categories"]) for (const row of Object.values(world.tables[table]?.rows ?? {})) top = Math.max(top, bandOfJson(row.price_cents)?.max ?? 0);
  return top > 0 ? Math.round(top) : 500 * 10 ** Math.max(0, Math.min(6, Math.trunc(world.currency.decimals)));
}

/** Federal (+ FICA) and state withholding, in percent, for a person's occupation and region. */
export function withholding(ctx: Pick<ReadContext, "tables" | "world" | "state">, person: EntityId): { federalPct: number; statePct: number } {
  const occ = rowOf(ctx, "economy.occupations", strOf(own(ctx.state.entities, person)?.fields.occupation));
  const region = regionRow(ctx, person);
  return { federalPct: numOf(occ?.withholding_rate_pct), statePct: numOf(region.state_income_tax_effective_pct) + (own(ctx.state.entities, person)?.fields.local_tax === true ? numOf(region.local_income_tax_pct_typical) : 0) };
}
