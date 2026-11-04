// Revenue streams (DESIGN §26.2, Revenue streams): a stream is a `flow` whose `revenue` field models
// what each occurrence earns, in place of a fixed amount. A product sells units × price × buyers,
// shaped by a monthly season, weekday factors and growth; a catalog sells up to 50 items so, each
// with its own price, units, season, margin and tax category; a royalty pays a share of a month's
// production at its price, less deductions and severance, some months after it was produced; fees
// charge as a product sells; a custom stream earns its own formula. Nothing is random unless the
// stream sets a spread.
//
// Shared by the engine (`packs/economy/core/revenue.ts`), which posts each occurrence, and the
// editor (`packs/economy/ui/revenue.tsx`), which previews twelve months: the shapes, the reader, the
// templates and the arithmetic both use, so a preview and the postings agree to the cent.

import { isRecord, type JsonObject, type JsonValue } from "./json";
import type { EntityId } from "./ids";

export const REVENUE_TYPES = ["product", "catalog", "royalty", "fees", "custom"] as const;
export type RevenueType = (typeof REVENUE_TYPES)[number];

/** Whether the agents may adjust a stream in play (`economy.revenue_adjust`): never (the default), or within the bounds. */
export const REVENUE_AI = ["off", "bounded"] as const;
export type RevenueAi = (typeof REVENUE_AI)[number];

/** The most items a catalog lists. */
export const CATALOG_MAX = 50;

/**
 * The journal categories streams post under: a product's and a catalog's sales are booked as a
 * business's walk-in takings are (`sales`); a royalty comes in whole (`royalties`), its severance tax
 * and deductions going out of the same account in the same unit; fees are `fee_income`; a custom
 * stream posts its own category, else `other_income`.
 */
export const REVENUE_CATEGORIES = {
  sales: "sales",
  royalties: "royalties",
  severance: "severance_tax",
  deductions: "royalty_deductions",
  fees: "fee_income",
  other: "other_income",
} as const;

/** The months of a stream's record kept (`economy.revenue`): two years and the month under way. */
export const REVENUE_MONTHS_KEPT = 25;

/** The amount provider a stream's occurrences are worked out by (`packs/economy/core/revenue.ts`). */
export const REVENUE_PROVIDER = "revenue";

/** A driver: a number, or a formula in the engine's grammar (a leading `=` is allowed), read at the occurrence's instant with `self` the earner. */
export type Driver = number | string;

/** One line a catalog sells. */
export interface CatalogItem {
  id: string;
  name: string;
  /** A unit's price, minor units. */
  price: Driver;
  /** Units each buyer takes an occurrence. */
  units: Driver;
  /** Twelve monthly factors, January first; else the catalog's season. */
  season?: number[];
  /** The share of its price the seller keeps; the rest is the cost of the goods. All of it when unset. */
  margin_pct?: number;
  /** Its tax category (`groceries`): no sales tax where its region exempts it. */
  category?: string;
}

/**
 * An Arps decline: `qi` units produced in the first month, falling by `di_pct` a year (nominal), with
 * the exponent `b`: 0 exponential, 1 harmonic, anything between hyperbolic.
 */
export interface ArpsDecline {
  qi: number;
  di_pct: number;
  b?: number;
}

/** A royalty's production a month: a steady number, a series (month by month from the start), or a decline. */
export type Production = number | number[] | ArpsDecline;

/** A royalty's price a unit: minor units, a series (month by month from the start), or an asset's market price. */
export type RoyaltyPrice = number | number[] | { asset: string };

/** A stream's model (a `flow` entity's `revenue`, read as one record). */
export interface RevenueModel {
  type: RevenueType;
  /** product and fees: units each buyer takes an occurrence (1 when unset). */
  units?: Driver;
  /** product and fees: a unit's price, minor units; royalty: see `RoyaltyPrice`. */
  price?: Driver | number[] | { asset: string };
  /** product, catalog and fees: buyers an occurrence (1 when unset). */
  buyers?: Driver;
  /** Twelve monthly factors, January first, or a world table whose rows `1`…`12` hold a `factor`. */
  season?: number[] | string;
  /** Seven weekday factors, Sunday first. */
  weekdays?: number[];
  /** Growth a year, compounding from the stream's start. */
  growth_pct?: number;
  /** Each occurrence varies by up to ± this %, around the modelled amount; 0 by default. */
  spread_pct?: number;
  /** product: the share of its price kept (the rest is the cost of goods). */
  margin_pct?: number;
  /** product: its tax category; fees and custom: the journal category they post under. */
  category?: string;
  /** catalog: what it sells. */
  items?: CatalogItem[];
  /** royalty: what the land produces a month. */
  production?: Production;
  /** royalty: the share of production's value it pays, % (100 when unset). */
  share_pct?: number;
  /** royalty: post-production costs taken off, % of the gross. */
  deductions_pct?: number;
  /** royalty: the severance (production) tax withheld, % of the gross. */
  severance_pct?: number;
  /** royalty: months between production and payment. */
  lag_months?: number;
  /** royalty: what production is counted in (`bbl`, `mcf`). */
  unit?: string;
  /** custom: the occurrence's amount, minor units. */
  formula?: string;
  ai?: RevenueAi;
}

/** A stream's month as `economy.revenue` records it, minor units. */
export interface RevenueMonth {
  /** `YYYY-MM`. */
  month: string;
  /** What it earned: sales before tax, a royalty's gross, fees, a custom amount. */
  cents: number;
  /** What reached the earner after a royalty's deductions and severance (`cents` otherwise). */
  net: number;
  /** Production counted (royalties), or units sold. */
  units: number;
  occurrences: number;
}

/** An adjustment in force on a stream (`economy.revenue_adjust`). */
export interface RevenueAdjustmentView {
  id: string;
  /** A factor on each occurrence's amount, 0.25 to 4. */
  factor?: number;
  /** Minor units added to (or, negative, taken from) each occurrence, at most one period's amount. */
  cents?: number;
  from: number;
  until: number;
  /** What was said that made it: the GM's reason or the story's quote. */
  reason: string;
}

/** One stream as a party's money view lists it. */
export interface RevenueStreamView {
  /** The flow's id (a stand-in where the viewer can't see it). */
  id: string;
  label: string;
  type: RevenueType;
  /** The party whose income it is: the holder of the account it lands in. */
  earner: EntityId;
  /** What it belongs to (a property, a business), when it names one. */
  link: EntityId | null;
  status: "active" | "paused" | "ended";
  /** This month and the months before it, newest last, at most 25. */
  months: RevenueMonth[];
  /** The next twelve months as modelled now, minor units each (before sales tax). */
  preview: number[];
  ai: RevenueAi;
  adjustments: RevenueAdjustmentView[];
  /** royalty: the production unit. */
  unit?: string;
}

// ---------------------------------------------------------------- reading

function finite(v: JsonValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function driverOf(v: JsonValue | undefined): Driver | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return undefined;
}

function numbers(v: JsonValue | undefined, length?: number): number[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out = v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 1));
  return length === undefined ? out : out.length >= length ? out.slice(0, length) : [...out, ...Array.from({ length: length - out.length }, () => 1)];
}

function textOf(v: JsonValue | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** A field read as one record: the record itself, or the first record of a one-record list (as `dues` are). */
export function oneRecord(v: JsonValue | undefined): JsonObject | null {
  if (isRecord(v)) return v as JsonObject;
  if (Array.isArray(v)) {
    const first = v.find((x) => isRecord(x));
    return first ? (first as JsonObject) : null;
  }
  return null;
}

function productionOf(v: JsonValue | undefined): Production | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (Array.isArray(v)) return numbers(v)?.map((x) => Math.max(0, x));
  if (isRecord(v)) {
    const o = v as JsonObject;
    const qi = finite(o.qi);
    if (qi === undefined) return undefined;
    const b = finite(o.b);
    return { qi: Math.max(0, qi), di_pct: Math.max(0, finite(o.di_pct) ?? 0), ...(b !== undefined ? { b: Math.min(2, Math.max(0, b)) } : {}) };
  }
  return undefined;
}

function priceOf(v: JsonValue | undefined, type: RevenueType): RevenueModel["price"] | undefined {
  if (type === "royalty") {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return numbers(v);
    if (isRecord(v) && typeof (v as JsonObject).asset === "string" && (v as JsonObject).asset !== "") return { asset: (v as JsonObject).asset as string };
    return undefined;
  }
  return driverOf(v);
}

function itemOf(v: JsonValue, i: number): CatalogItem | null {
  if (!isRecord(v)) return null;
  const o = v as JsonObject;
  const name = textOf(o.name) ?? textOf(o.id) ?? `Item ${i + 1}`;
  const price = driverOf(o.price);
  if (price === undefined) return null;
  const season = numbers(o.season, 12);
  const margin = finite(o.margin_pct);
  const category = textOf(o.category);
  return { id: textOf(o.id) ?? `item_${i + 1}`, name, price, units: driverOf(o.units) ?? 1, ...(season ? { season } : {}), ...(margin !== undefined ? { margin_pct: Math.min(100, Math.max(0, margin)) } : {}), ...(category ? { category } : {}) };
}

/** A `revenue` field as a model, or null when it isn't one (no known `type`). */
export function revenueOf(v: JsonValue | undefined): RevenueModel | null {
  const o = oneRecord(v);
  if (!o || typeof o.type !== "string" || !(REVENUE_TYPES as readonly string[]).includes(o.type)) return null;
  const type = o.type as RevenueType;
  const out: RevenueModel = { type };
  const set = <K extends keyof RevenueModel>(k: K, value: RevenueModel[K] | undefined): void => {
    if (value !== undefined) out[k] = value;
  };
  set("units", driverOf(o.units));
  set("price", priceOf(o.price, type));
  set("buyers", driverOf(o.buyers));
  set("season", typeof o.season === "string" && o.season.trim() !== "" ? o.season.trim() : numbers(o.season, 12));
  set("weekdays", numbers(o.weekdays, 7));
  set("growth_pct", finite(o.growth_pct));
  const spread = finite(o.spread_pct);
  set("spread_pct", spread === undefined ? undefined : Math.min(100, Math.max(0, spread)));
  const margin = finite(o.margin_pct);
  set("margin_pct", margin === undefined ? undefined : Math.min(100, Math.max(0, margin)));
  set("category", textOf(o.category));
  if (Array.isArray(o.items)) set("items", o.items.flatMap((x, i) => itemOf(x, i) ?? []).slice(0, CATALOG_MAX));
  set("production", productionOf(o.production));
  for (const k of ["share_pct", "deductions_pct", "severance_pct"] as const) {
    const n = finite(o[k]);
    set(k, n === undefined ? undefined : Math.min(100, Math.max(0, n)));
  }
  const lag = finite(o.lag_months);
  set("lag_months", lag === undefined ? undefined : Math.min(24, Math.max(0, Math.round(lag))));
  set("unit", textOf(o.unit));
  set("formula", textOf(o.formula));
  set("ai", o.ai === "bounded" ? "bounded" : undefined);
  return out;
}

/** What's wrong with a model as authored, in words (none when it can run). */
export function revenueProblems(v: JsonValue | undefined): string[] {
  const o = oneRecord(v);
  if (!o) return ["is not a stream's model (a record with a type)"];
  if (typeof o.type !== "string" || !(REVENUE_TYPES as readonly string[]).includes(o.type)) return [`has no type (one of ${REVENUE_TYPES.join(", ")})`];
  const m = revenueOf(v);
  if (!m) return [];
  const out: string[] = [];
  if (Array.isArray(o.items) && o.items.length > CATALOG_MAX) out.push(`lists ${o.items.length} items; a catalog sells at most ${CATALOG_MAX}`);
  if (Array.isArray(o.season) && o.season.length !== 12) out.push("has a season that isn't twelve monthly factors");
  if (Array.isArray(o.weekdays) && o.weekdays.length !== 7) out.push("has weekday factors that aren't seven, Sunday first");
  if ((m.type === "product" || m.type === "fees") && m.price === undefined) out.push("has no price");
  if (m.type === "catalog" && (m.items ?? []).length === 0) out.push("sells no items");
  if (m.type === "royalty") {
    if (m.production === undefined) out.push("has no production (a number a month, a series, or a decline {qi, di_pct, b})");
    if (m.price === undefined) out.push("has no price (minor units a unit, a series, or {asset})");
  }
  if (m.type === "custom" && m.formula === undefined) out.push("has no formula");
  return out;
}

// ---------------------------------------------------------------- arithmetic

/** A month's season factor (1-based month), 1 when none is set. */
export function seasonAt(season: readonly number[] | undefined, month: number): number {
  const f = season?.[month - 1];
  return typeof f === "number" && Number.isFinite(f) ? Math.max(0, f) : 1;
}

/** A weekday's factor (0 is Sunday), 1 when none is set. */
export function weekdayAt(weekdays: readonly number[] | undefined, weekday: number): number {
  const f = weekdays?.[weekday];
  return typeof f === "number" && Number.isFinite(f) ? Math.max(0, f) : 1;
}

/** Growth compounded over `years` at `pct` a year. */
export function growthAt(pct: number | undefined, years: number): number {
  return pct === undefined || pct === 0 || years <= 0 ? 1 : Math.max(0, 1 + pct / 100) ** years;
}

/** Units an Arps decline produces in production month `t` (0 the first). */
export function declineAt(d: ArpsDecline, t: number): number {
  const rate = d.di_pct / 100 / 12;
  const b = d.b ?? 0;
  if (t <= 0 || rate === 0) return d.qi;
  return b === 0 ? d.qi * Math.exp(-rate * t) : d.qi / (1 + b * rate * t) ** (1 / b);
}

/** Units produced in production month `t` (0 the first): a steady number, the series' month (none past its end), or the decline's. */
export function productionAt(p: Production | undefined, t: number): number {
  if (p === undefined || t < 0) return 0;
  if (typeof p === "number") return p;
  if (Array.isArray(p)) return p[t] ?? 0;
  return declineAt(p, t);
}

/** A series' value in month `t`, its last value held past its end. */
export function seriesAt(series: readonly number[], t: number): number {
  if (series.length === 0) return 0;
  return series[Math.min(series.length - 1, Math.max(0, t))] ?? 0;
}

/** One production month of a royalty, minor units. */
export interface RoyaltyMonth {
  /** Production counted, in the stream's unit, for the whole interest. */
  units: number;
  /** The share's value: units × price × share. */
  gross: number;
  deductions: number;
  severance: number;
  /** What the earner receives. */
  net: number;
}

/**
 * Production month `t` of a royalty (0 the first; `fraction` of it counted: the part of a first month in production, times any adjustment) at `price` a unit:
 * the gross is units × price × share, rounded to the cent; deductions and severance each a share of
 * the gross, rounded; the net what's left.
 */
export function royaltyMonth(model: Pick<RevenueModel, "production" | "share_pct" | "deductions_pct" | "severance_pct">, t: number, fraction: number, price: number): RoyaltyMonth {
  const units = productionAt(model.production, t) * Math.max(0, fraction);
  const gross = Math.max(0, Math.round((units * price * (model.share_pct ?? 100)) / 100));
  const deductions = Math.round((gross * (model.deductions_pct ?? 0)) / 100);
  const severance = Math.round((gross * (model.severance_pct ?? 0)) / 100);
  return { units, gross, deductions, severance, net: gross - deductions - severance };
}

/** The price a royalty's month `t` is paid at, when it isn't an asset's (null: it is one). */
export function royaltyPriceAt(price: RevenueModel["price"], t: number): number | null {
  if (typeof price === "number") return price;
  if (Array.isArray(price)) return seriesAt(price, t);
  return null;
}

/** Units × price × buyers × factor, rounded to the cent. */
export function driversAmount(units: number, price: number, buyers: number, factor: number): number {
  return Math.max(0, Math.round(units * price * buyers * factor));
}

/** The present value of monthly amounts (the first a month from now) at `discount_pct` a year. */
export function presentValue(months: readonly number[], discountPct: number): number {
  const r = discountPct / 100;
  let pv = 0;
  for (const [i, c] of months.entries()) pv += c / (1 + r) ** ((i + 1) / 12);
  return Math.round(pv);
}

// ---------------------------------------------------------------- valuation

export const VALUATION_METHODS = ["pv", "cap", "multiple"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** How a property is valued from the streams linked to it (its `valuation`, read as one record). */
export interface Valuation {
  /** `pv`: the discounted income over the horizon; `cap`: a year's income ÷ the cap rate; `multiple`: a year's income × the multiple. */
  method: ValuationMethod;
  discount_pct: number;
  cap_rate_pct: number;
  multiple: number;
  /** Months of income `pv` counts. */
  horizon_months: number;
}

export const VALUATION_DEFAULTS: Valuation = { method: "pv", discount_pct: 10, cap_rate_pct: 8, multiple: 5, horizon_months: 360 };

/** A `valuation` field, its defaults filled; null when it names no method. */
export function valuationOf(v: JsonValue | undefined): Valuation | null {
  const o = oneRecord(v);
  if (!o || typeof o.method !== "string" || !(VALUATION_METHODS as readonly string[]).includes(o.method)) return null;
  const pos = (x: JsonValue | undefined, d: number): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : d);
  return {
    method: o.method as ValuationMethod,
    discount_pct: typeof o.discount_pct === "number" && Number.isFinite(o.discount_pct) && o.discount_pct >= 0 ? o.discount_pct : VALUATION_DEFAULTS.discount_pct,
    cap_rate_pct: pos(o.cap_rate_pct, VALUATION_DEFAULTS.cap_rate_pct),
    multiple: pos(o.multiple, VALUATION_DEFAULTS.multiple),
    horizon_months: Math.min(600, Math.round(pos(o.horizon_months, VALUATION_DEFAULTS.horizon_months))),
  };
}

/** A property's value from its streams' monthly income (the first a month from now). */
export function valueFromIncome(v: Valuation, months: readonly number[]): number {
  const year = months.slice(0, 12).reduce((a, c) => a + c, 0);
  switch (v.method) {
    case "pv":
      return presentValue(months.slice(0, v.horizon_months), v.discount_pct);
    case "cap":
      return Math.round(year / (v.cap_rate_pct / 100));
    case "multiple":
      return Math.round(year * v.multiple);
  }
}

// ---------------------------------------------------------------- templates

export const REVENUE_TEMPLATE_IDS = ["walk_in", "product", "catalog", "oil_royalty", "gas_royalty", "water_royalty", "fees", "custom"] as const;
export type RevenueTemplateId = (typeof REVENUE_TEMPLATE_IDS)[number];

export interface RevenueTemplate {
  label: string;
  /** What it models, in a line. */
  hint: string;
  /** The flow fields a new stream starts with (its `revenue` among them); `to` and `start` are the editor's. */
  fields: JsonObject;
}

const DAILY = { every: "day", at: "17:00" };
const MONTHLY = { every: "month", days: [25], roll: "after" };

/** The editor's starting points. Every figure is the author's to change; no template draws anything at random. */
export const REVENUE_TEMPLATES: Readonly<Record<RevenueTemplateId, RevenueTemplate>> = {
  walk_in: {
    label: "Walk-in customers",
    hint: "Customers who come in each day, busier at weekends, each spending about the same.",
    fields: { flow_kind: "income", from: "Walk-in customers", ...DAILY, category: REVENUE_CATEGORIES.sales, revenue: [{ type: "product", units: 1, price: 1200, buyers: 40, weekdays: [0.6, 0.9, 0.9, 1, 1, 1.3, 1.4], margin_pct: 60 }] },
  },
  product: {
    label: "One product",
    hint: "One thing sold every day: units × price × buyers.",
    fields: { flow_kind: "income", from: "Customers", ...DAILY, category: REVENUE_CATEGORIES.sales, revenue: [{ type: "product", units: 1, price: 2500, buyers: 10, margin_pct: 50 }] },
  },
  catalog: {
    label: "A catalog",
    hint: "Several items, each with its own price, units, margin and tax category.",
    fields: {
      flow_kind: "income",
      from: "Customers",
      ...DAILY,
      category: REVENUE_CATEGORIES.sales,
      revenue: [
        {
          type: "catalog",
          buyers: 20,
          items: [
            { id: "bread", name: "Bread", price: 450, units: 1, margin_pct: 40, category: "groceries" },
            { id: "coffee", name: "Coffee", price: 350, units: 1, margin_pct: 70, category: "prepared_food" },
            { id: "mug", name: "Mug", price: 1500, units: 0.1, margin_pct: 55, category: "general" },
          ],
        },
      ],
    },
  },
  oil_royalty: {
    label: "Oil royalty",
    hint: "A share of a well's oil, declining as wells do, paid two months after it is produced.",
    fields: { flow_kind: "income", from: "Purchaser", ...MONTHLY, category: REVENUE_CATEGORIES.royalties, revenue: [{ type: "royalty", unit: "bbl", production: { qi: 3000, di_pct: 60, b: 1.1 }, price: 7000, share_pct: 12.5, severance_pct: 4.6, lag_months: 2 }] },
  },
  gas_royalty: {
    label: "Gas royalty",
    hint: "A share of a well's gas, with post-production deductions, paid three months after.",
    fields: { flow_kind: "income", from: "Purchaser", ...MONTHLY, category: REVENUE_CATEGORIES.royalties, revenue: [{ type: "royalty", unit: "mcf", production: { qi: 30000, di_pct: 70, b: 1 }, price: 300, share_pct: 12.5, deductions_pct: 10, severance_pct: 7.5, lag_months: 3 }] },
  },
  water_royalty: {
    label: "Water royalty",
    hint: "A steady price a barrel for water taken from the land, paid the month after.",
    fields: { flow_kind: "income", from: "Water buyer", ...MONTHLY, category: REVENUE_CATEGORIES.royalties, revenue: [{ type: "royalty", unit: "bbl", production: 20000, price: 50, share_pct: 100, lag_months: 1 }] },
  },
  fees: {
    label: "Fees",
    hint: "A fee charged to clients each month: units × price × clients.",
    fields: { flow_kind: "income", from: "Clients", every: "month", days: [1], roll: "after", category: REVENUE_CATEGORIES.fees, revenue: [{ type: "fees", units: 1, price: 5000, buyers: 20 }] },
  },
  custom: {
    label: "Custom",
    hint: "Your own formula for each payment, in minor units; `season`, `growth` and the clock names are there to use.",
    fields: { flow_kind: "income", from: "Customers", every: "month", days: [1], roll: "after", category: REVENUE_CATEGORIES.other, revenue: [{ type: "custom", formula: "100000 * season" }] },
  },
};

/** The bounds on an adjustment the agents make in play. */
export const REVENUE_ADJUST = {
  factorMin: 0.25,
  factorMax: 4,
  days: 31,
  inForce: 4,
} as const;
