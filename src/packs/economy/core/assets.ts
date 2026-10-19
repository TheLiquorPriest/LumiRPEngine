// Assets and their prices (DESIGN §27.1, §27.2). An asset is a world's `packs.economy.config.assets`
// entry, an option contract minted in play, or (for an older chat) a finance-table recipe named as
// a symbol. Each asset class takes its price model from the finance tables' `investing` section:
// equities and funds follow the stock index, bonds the aggregate bond row (an individual bond is
// priced from a yield that wanders around it), crypto its own row, and an option is priced from
// its underlying (Black-Scholes). The asset's own drift, volatility and yield override the class.
//
// Prices move once a trading day, at the market's close, by a seeded geometric Brownian step that
// shares a daily shock with the rest of its market (equities fall together on a bad day). The
// marks are `economy.quote` events, so a fold never draws; options and bonds are priced from
// those marks and the clock, never stored.

import type { EntityId } from "../../../shared/ids";
import { isRecord, safeKey, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { ASSET_CLASSES, type AssetClass, type AssetDef } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, clockOfLocal, dateAt, type CalDate } from "../../../engine/calendar";
import { mutableSlice, numOf, objOf, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import type { WorldState } from "../../../engine/state";
import type { FinanceApi, FinanceRegistry } from "./module";
import { blackScholes, bondPrice, correlated, gbmStep, intrinsic, normal, YEAR_MINUTES } from "./pricing";

/** What an asset read needs: the world (its config and tables) and the state (marks, minted contracts). */
export type AssetBooks = Pick<ReadContext, "world" | "state" | "tables">;

export function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- the module's slice

/** The holdings module's part of the economy slice: marks, minted contracts, gains, income and basis. */
export function holdingsSlice(state: Readonly<WorldState>): JsonObject {
  return objOf(sliceOf(state, "economy").holdings);
}

/** A record inside the module's slice, for mutation in a reducer, created on first use. */
export function holdingsRecord(state: WorldState, key: string): JsonObject {
  const economy = mutableSlice(state, "economy");
  const current = economy.holdings;
  const mine: JsonObject = isRecord(current) ? (current as JsonObject) : {};
  economy.holdings = mine;
  const inner = mine[key];
  if (isRecord(inner)) return inner as JsonObject;
  const fresh: JsonObject = {};
  mine[key] = fresh;
  return fresh;
}

/** A clock reading from a date field: a number as it is, `YYYY-MM-DD[THH:MM]` in the home time zone; null otherwise. */
export function clockOfDate(world: ReadContext["world"], v: JsonValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v === "") return null;
  try {
    return clockOfLocal(calendarOf(world), v);
  } catch {
    return null;
  }
}

/** A clock reading as the date a view shows (`YYYY-MM-DD`). */
export function dateText(world: ReadContext["world"], clock: number): string {
  const d = dateAt(calendarOf(world), clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The market's close, local time: the day's marks are taken then, and contracts expire and bonds mature at it. */
export const MARKET_CLOSE = 16 * 60;

/** When something due on a date falls: a bare date at the market's close, a date with a time at that time. */
export function closeOf(world: ReadContext["world"], v: string | undefined): number | null {
  if (!v) return null;
  const at = clockOfDate(world, v);
  return at === null ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? at + MARKET_CLOSE : at;
}

/** The date `months` calendar months after a clock reading's, the day kept or clamped to a shorter month (`YYYY-MM-DD`). */
export function addMonths(world: ReadContext["world"], clock: number, months: number): string {
  const cal = calendarOf(world);
  const d = dateAt(cal, clock);
  const count = cal.system.months;
  const index = d.year * count + (d.month - 1) + Math.round(months);
  const year = Math.floor(index / count);
  const month = index - year * count + 1;
  const day = Math.min(d.day, cal.system.monthLength(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- assets

export interface BondTerms {
  face: number;
  couponPct: number;
  maturity: number;
  /** The market yield it reverts to, percent: the aggregate bond row's. */
  baseYield: number;
}

export interface OptionTerms {
  underlying: string;
  strike: number;
  expiry: number;
  right: "call" | "put";
  multiplier: number;
  settlement: "physical" | "cash";
}

/** An asset with its price model settled: the class defaults, the table recipe, then its own values. */
export interface Asset {
  id: string;
  label: string;
  class: AssetClass;
  symbol: string | null;
  /** Its price per unit before any mark, minor units (an option contract's is computed). */
  start: number;
  /** Yearly percent. */
  drift: number;
  vol: number;
  /** What it pays out a year as a percentage of its value (dividends; a bond fund's yield). */
  yieldPct: number;
  /** Payments a year; 0 pays nothing. */
  pays: number;
  /** How closely it follows its market's daily shock. */
  rho: number;
  market: string;
  /** Trades every day (crypto) rather than on business days. */
  daily: boolean;
  bond: BondTerms | null;
  option: OptionTerms | null;
  /** The entity it stands for (a property, a business), if any. */
  entity: EntityId | null;
}

interface ClassModel {
  recipe: string | null;
  market: string;
  rho: number;
  pays: number;
  daily: boolean;
  /** Last resorts, when neither the class row nor its recipe row gives one. */
  drift?: number;
  vol?: number;
  yieldPct?: number;
}

/**
 * Each class's model where the finance table's `investing.asset_classes` row doesn't say (an older
 * table has none): which recipe row it follows, its market, how closely it moves with that market,
 * how often it pays and whether it trades every day. Crypto keeps a model of its own for tables
 * without a crypto row.
 */
const CLASS_MODELS: Readonly<Record<AssetClass, ClassModel>> = {
  security: { recipe: "broad_us_equity_index", market: "equity", rho: 0.6, pays: 4, daily: false },
  fund: { recipe: "broad_us_equity_index", market: "equity", rho: 0.95, pays: 4, daily: false },
  bond: { recipe: "bonds_aggregate", market: "bond", rho: 0.9, pays: 12, daily: false },
  crypto: { recipe: "crypto", market: "crypto", rho: 0.8, pays: 0, daily: true, drift: 20, vol: 65, yieldPct: 0 },
  option: { recipe: null, market: "option", rho: 0, pays: 0, daily: false, drift: 0, vol: 0, yieldPct: 0 },
  property: { recipe: "real_estate_home_price_appreciation_pct", market: "housing", rho: 0.7, pays: 0, daily: false },
  business_stake: { recipe: null, market: "business", rho: 0, pays: 0, daily: false, drift: 0, vol: 0, yieldPct: 0 },
  other: { recipe: null, market: "other", rho: 0, pays: 0, daily: false, drift: 0, vol: 0, yieldPct: 0 },
};

/** A recipe's market: the stock index's shock is the equity market's, and so on; an unknown recipe trades on its own. */
const RECIPE_MARKETS: Readonly<Record<string, string>> = {
  broad_us_equity_index: "equity",
  bonds_aggregate: "bond",
  crypto: "crypto",
  cash: "cash",
  real_estate_home_price_appreciation_pct: "housing",
};

/** The finance table's `investing` section. */
export function investingRows(ctx: Pick<ReadContext, "tables">): JsonObject {
  return objOf(ctx.tables.get("economy.finance")?.rows.investing?.values);
}

function num(v: JsonValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** An `AssetDef` read from JSON (the world's config or a minted contract); null when it names no class. */
export function readAssetDef(v: JsonValue | undefined): AssetDef | null {
  if (!isRecord(v)) return null;
  const o = v as JsonObject;
  const cls = o.class;
  if (typeof cls !== "string" || !(ASSET_CLASSES as readonly string[]).includes(cls)) return null;
  const def: AssetDef = { label: strOf(o.label), class: cls as AssetClass };
  const text = (k: "symbol" | "model" | "underlying" | "expiry" | "maturity" | "entity"): void => {
    if (typeof o[k] === "string" && o[k] !== "") def[k] = o[k] as string;
  };
  const number = (k: "price" | "annual_return_pct" | "annual_volatility_pct" | "yield_pct" | "strike" | "multiplier" | "pays_per_year" | "correlation" | "face" | "coupon_pct"): void => {
    const n = num(o[k]);
    if (n !== undefined) def[k] = n;
  };
  for (const k of ["symbol", "model", "underlying", "expiry", "maturity", "entity"] as const) text(k);
  for (const k of ["price", "annual_return_pct", "annual_volatility_pct", "yield_pct", "strike", "multiplier", "pays_per_year", "correlation", "face", "coupon_pct"] as const) number(k);
  if (o.right === "call" || o.right === "put") def.right = o.right;
  if (o.settlement === "physical" || o.settlement === "cash") def.settlement = o.settlement;
  return def;
}

/** The world's authored assets, by id. */
export function configAssets(world: ReadContext["world"]): JsonObject {
  return objOf(objOf(world.packs.economy?.config).assets);
}

/** The definition behind an asset id: authored, minted in play, or an older chat's table symbol. */
export function assetDefOf(ctx: AssetBooks, id: string): AssetDef | null {
  if (!safeKey(id)) return null;
  const authored = readAssetDef(own(configAssets(ctx.world), id));
  if (authored) return authored;
  const minted = readAssetDef(own(objOf(holdingsSlice(ctx.state).minted), id));
  if (minted) return minted;
  // A symbol an older brokerage account held (the stock index), priced as the fund it stood for.
  if (isRecord(own(investingRows(ctx), id))) return { label: id.replace(/_/g, " "), class: "fund", model: id, price: 10000 };
  return null;
}

/** An asset with its price model settled; null when nothing defines the id. */
export function assetOf(ctx: AssetBooks, id: string): Asset | null {
  const def = assetDefOf(ctx, id);
  return def ? assetFromDef(ctx, id, def) : null;
}

/** An asset from its definition, which may not be in the books yet (a contract about to be minted). */
export function assetFromDef(ctx: AssetBooks, id: string, def: AssetDef): Asset {
  const rows = investingRows(ctx);
  const classRow = objOf(own(objOf(rows.asset_classes), def.class));
  const fallback = CLASS_MODELS[def.class];
  const recipe = def.model ?? (typeof classRow.model === "string" ? classRow.model : fallback.recipe);
  const row = recipe ? objOf(own(rows, recipe)) : {};
  // A cash fund holds its price and pays its return out.
  const cashLike = recipe === "cash";
  // The table's returns are total returns: what an asset pays out comes off its price's drift, so a
  // dividend is never counted twice (and options see the same yield).
  const yieldPct = def.yield_pct ?? num(classRow.dividend_yield_pct) ?? (cashLike ? num(row.annual_return_pct) : (num(row.dividend_yield_pct) ?? num(row.yield_to_maturity_pct))) ?? fallback.yieldPct ?? 0;
  const total = def.annual_return_pct ?? num(classRow.annual_return_pct) ?? num(row.annual_return_arithmetic_pct) ?? num(row.annual_return_pct) ?? num(row.typical) ?? fallback.drift ?? 0;
  const vol = def.annual_volatility_pct ?? num(classRow.annual_volatility_pct) ?? (cashLike ? 0 : (num(row.annual_volatility_pct) ?? num(row.volatility_pct))) ?? fallback.vol ?? 0;
  const maturity = closeOf(ctx.world, def.maturity);
  const bond: BondTerms | null =
    def.class === "bond" && typeof def.face === "number" && def.face > 0 && maturity !== null
      ? { face: def.face, couponPct: def.coupon_pct ?? 0, maturity, baseYield: num(objOf(own(rows, "bonds_aggregate")).yield_to_maturity_pct) ?? 4.4 }
      : null;
  const expiry = closeOf(ctx.world, def.expiry);
  const option: OptionTerms | null =
    def.class === "option" && def.underlying && typeof def.strike === "number" && def.strike > 0 && expiry !== null && (def.right === "call" || def.right === "put")
      ? { underlying: def.underlying, strike: def.strike, expiry, right: def.right, multiplier: def.multiplier ?? 100, settlement: def.settlement ?? "physical" }
      : null;
  const pays = def.pays_per_year ?? (bond ? 2 : (num(classRow.pays_per_year) ?? fallback.pays));
  return {
    id,
    label: def.label || id,
    class: def.class,
    symbol: def.symbol ?? null,
    start: def.price ?? 10000,
    drift: bond ? 0 : total - yieldPct,
    vol,
    yieldPct: bond ? 0 : yieldPct,
    pays: Math.max(0, Math.round(pays)),
    rho: Math.min(1, Math.max(0, def.correlation ?? num(classRow.correlation) ?? fallback.rho)),
    market: (recipe ? own(RECIPE_MARKETS, recipe) : undefined) ?? fallback.market,
    daily: classRow.trades_daily === true || fallback.daily,
    bond,
    option,
    entity: def.entity ?? null,
  };
}

// ---------------------------------------------------------------- prices

/** The risk-free rate options discount at: the three-month bill yield. */
function riskFreePct(ctx: Pick<ReadContext, "tables">): number {
  return num(objOf(ctx.tables.get("economy.finance")?.rows.macro?.values).treasury_bill_3m_yield_pct) ?? 3.8;
}

/**
 * A bond's market yield now: its last mark, else the yield its authored price implies when the
 * chat starts (the world's start), else the market's.
 */
export function bondYield(ctx: AssetBooks, a: Asset): number {
  const marked = num(own(objOf(holdingsSlice(ctx.state).yields), a.id));
  if (marked !== undefined) return marked;
  if (!a.bond) return 0;
  const def = assetDefOf(ctx, a.id);
  return typeof def?.price === "number" && def.price > 0 ? impliedYield(a.bond, def.price, clockOfDate(ctx.world, ctx.world.start.at) ?? 0, a.pays || 2) : a.bond.baseYield;
}

/** The yield at which a bond is worth `price` (bisection: the price falls as the yield rises). */
export function impliedYield(bond: BondTerms, price: number, at: number, frequency: number): number {
  const years = (bond.maturity - at) / YEAR_MINUTES;
  if (years <= 0) return bond.baseYield;
  let lo = -5;
  let hi = 60;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bondPrice({ face: bond.face, couponPct: bond.couponPct, yieldPct: mid, years, frequency }) > price) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

/**
 * An asset's price per unit now, in minor units (fractions kept): an option contract's from its
 * underlying (the per-unit value times the contract's units), a bond's from its yield and the time
 * left, anything else its last mark, then an older chat's symbol price, then its starting price.
 */
export function priceOf(ctx: AssetBooks, a: Asset, at: number = ctx.state.clock): number {
  if (a.option) {
    const under = assetOf(ctx, a.option.underlying);
    // An option on an option is never priced: the chain stops at the first contract.
    if (!under || under.option) return 0;
    const spot = priceOf(ctx, under, at);
    const years = (a.option.expiry - at) / YEAR_MINUTES;
    const perUnit = years <= 0 ? intrinsic(a.option.right, spot, a.option.strike) : blackScholes({ right: a.option.right, spot, strike: a.option.strike, years, ratePct: riskFreePct(ctx), volPct: under.vol, yieldPct: under.yieldPct });
    return mark(perUnit * a.option.multiplier);
  }
  if (a.bond) {
    const years = (a.bond.maturity - at) / YEAR_MINUTES;
    return mark(bondPrice({ face: a.bond.face, couponPct: a.bond.couponPct, yieldPct: bondYield(ctx, a), years, frequency: a.pays || 2 }));
  }
  const marked = num(own(objOf(holdingsSlice(ctx.state).quotes), a.id));
  if (marked !== undefined) return marked;
  // An older chat's market steps priced its symbols in major units.
  const legacy = num(own(objOf(sliceOf(ctx.state, "economy").prices), a.id));
  if (legacy !== undefined) return legacy * 100;
  return a.start;
}

/** The price per unit of the asset an id names; null when nothing defines it. */
export function quoteOf(ctx: AssetBooks, id: string, at: number = ctx.state.clock): number | null {
  const a = assetOf(ctx, id);
  return a ? priceOf(ctx, a, at) : null;
}

/** Every asset a market step moves: the authored ones and any table symbol a holding names, by id. */
export function marketAssets(ctx: AssetBooks): string[] {
  const ids = new Set(Object.keys(configAssets(ctx.world)));
  for (const e of Object.values(ctx.state.entities)) if (e.kind === "holding" && typeof e.fields.asset === "string") ids.add(e.fields.asset);
  return [...ids].filter((id) => assetDefOf(ctx, id) !== null).sort();
}

/** Prices are rounded to a ten-thousandth of a minor unit, so a mark is the same on every platform. */
function mark(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A local time of day inside the slot: the day, its clock reading and its date; null when it falls outside. */
export function instantIn(ctx: Pick<ReadContext, "world">, slot: SlotInfo, minuteOfDay: number): { day: number; at: number; date: CalDate } | null {
  const cal = calendarOf(ctx.world);
  const first = dateAt(cal, slot.start).dayIndex;
  for (const day of [first, first + 1]) {
    const at = clockAt(cal, day, minuteOfDay);
    if (at >= slot.start && at < slot.end) return { day, at, date: dateAt(cal, at) };
  }
  return null;
}

/** A bond yield's pull back toward the market's yield, a year, and its swing, percentage points a √year. */
const YIELD_REVERSION = 0.3;
const YIELD_SWING = 0.8;

/**
 * One trading day's marks (the market's close): each market draws one shock, each asset its own,
 * mixed by the asset's correlation; a priced asset takes a geometric Brownian step, a bond's yield
 * a mean-reverting one. Crypto trades every day, the rest on business days. Fixed-price assets and
 * options (priced from their underlying) are left alone.
 */
export function marketStep(ctx: ReadContext, api: Pick<FinanceApi, "businessDay">, slot: SlotInfo, rng: (label: string) => Rng): LedgerEvent[] {
  const at = instantIn(ctx, slot, MARKET_CLOSE);
  if (!at) return [];
  const business = api.businessDay(ctx, at.day, "after") === at.day;
  const factors = new Map<string, number>();
  const factor = (market: string): number => {
    let z = factors.get(market);
    if (z === undefined) {
      z = normal(rng(`market:${market}`));
      factors.set(market, z);
    }
    return z;
  };
  const out: LedgerEvent[] = [];
  for (const id of marketAssets(ctx)) {
    const a = assetOf(ctx, id);
    if (!a || a.option || a.class === "property" || a.class === "business_stake") continue;
    if (!a.daily && !business) continue;
    const dt = a.daily ? 1 / 365 : 1 / 252;
    if (a.bond) {
      if (at.at >= a.bond.maturity) continue;
      const z = correlated(factor(a.market), normal(rng(`asset:${id}`)), a.rho);
      const y = bondYield(ctx, a);
      // A good day for bonds (a positive shock) is a fall in yields.
      const next = Math.max(0, y + YIELD_REVERSION * (a.bond.baseYield - y) * dt - YIELD_SWING * Math.sqrt(dt) * z);
      out.push({ type: "economy.quote", data: { asset: id, yield: mark(next) } });
      continue;
    }
    if (a.vol <= 0 && a.drift === 0) continue;
    const price = priceOf(ctx, a);
    if (!(price > 0)) continue;
    const z = correlated(factor(a.market), normal(rng(`asset:${id}`)), a.rho);
    out.push({ type: "economy.quote", data: { asset: id, price: mark(gbmStep(price, a.drift, a.vol, dt, z)) } });
  }
  return out;
}

// ---------------------------------------------------------------- option contracts

/** The id a contract is minted under: one per underlying, right, strike and expiry date. */
export function optionId(underlying: string, right: "call" | "put", strike: number, expiry: string): string {
  return `opt:${underlying}:${right}:${Math.round(strike)}:${expiry}`;
}

/**
 * A contract on `underlying` as an asset: its definition, minted on first purchase. Null when the
 * underlying isn't a priced asset, the strike isn't positive or the expiry isn't a date after now.
 */
export function optionDef(ctx: AssetBooks, underlying: string, right: "call" | "put", strike: number, expiry: string): AssetDef | null {
  const under = assetOf(ctx, underlying);
  const at = closeOf(ctx.world, expiry);
  if (!under || under.option || under.class === "property" || under.class === "business_stake" || !(strike > 0) || at === null || at <= ctx.state.clock) return null;
  const money = formatMoney(Math.round(strike), ctx.world.currency);
  return { label: `${under.symbol ?? under.label} ${expiry} ${money} ${right}`, class: "option", underlying, strike: Math.round(strike), expiry, right, multiplier: 100, settlement: "physical" };
}

// ---------------------------------------------------------------- registration

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

const EVENTS: EventTypeDef<PackEvent>[] = [
  {
    // An older chat's market step (before holdings were rebuilt): a symbol's price in major units.
    type: "economy.price",
    validate: (e) => (typeof e.data.price === "number" && e.data.price > 0 && safeKey(str(e, "symbol")) ? null : reject("bad_event", "price needs a symbol and a positive price")),
    apply: (e, state) => {
      const economy = mutableSlice(state, "economy");
      const prices: JsonObject = isRecord(economy.prices) ? (economy.prices as JsonObject) : {};
      prices[str(e, "symbol")] = numOf(e.data.price);
      economy.prices = prices;
    },
    describe: (e, _ctx, viewer) => (viewer ? "" : `${str(e, "symbol")} at ${numOf(e.data.price).toFixed(2)}`),
  },
  {
    // A day's mark: an asset's price per unit (minor units), or a bond's market yield.
    type: "economy.quote",
    validate: (e) => {
      const price = e.data.price;
      const y = e.data.yield;
      if (!safeKey(str(e, "asset"))) return reject("bad_event", "a quote names its asset");
      if (price === undefined && y === undefined) return reject("bad_event", "a quote carries a price or a yield");
      if (price !== undefined && !(typeof price === "number" && Number.isFinite(price) && price > 0)) return reject("bad_event", "a price is above zero");
      return y === undefined || (typeof y === "number" && Number.isFinite(y) && y >= 0) ? null : reject("bad_event", "a yield is a percentage");
    },
    apply: (e, state) => {
      if (typeof e.data.price === "number") holdingsRecord(state, "quotes")[str(e, "asset")] = e.data.price;
      if (typeof e.data.yield === "number") holdingsRecord(state, "yields")[str(e, "asset")] = e.data.yield;
    },
    describe: (e, ctx, viewer) => {
      if (viewer) return "";
      const label = assetDefOf(ctx, str(e, "asset"))?.label || str(e, "asset");
      return typeof e.data.price === "number" ? `${label} at ${formatMoney(Math.round(e.data.price), ctx.world.currency)}` : `${label} yields ${numOf(e.data.yield)}%`;
    },
    // A mark is an assignment: in one timelapse record only an asset's last one matters.
    coarsen: { key: (e) => `${str(e, "asset")}:${typeof e.data.price === "number" ? "p" : "y"}`, merge: (_a, b) => b },
  },
  {
    // An option contract bought in play, which no world config lists: its definition from then on.
    type: "economy.mint",
    validate: (e, ctx) => {
      const id = str(e, "asset");
      const def = readAssetDef(e.data.def);
      if (!safeKey(id) || !def || def.class !== "option") return reject("bad_event", "a minted asset is an option contract");
      if (own(configAssets(ctx.world), id)) return reject("bad_event", `${id} is an authored asset`);
      return assetOf(ctx, def.underlying ?? "") ? null : reject("missing_asset", `no asset ${def.underlying ?? ""}`);
    },
    apply: (e, state) => {
      const def = readAssetDef(e.data.def);
      if (def) holdingsRecord(state, "minted")[str(e, "asset")] = def as unknown as JsonObject;
    },
    describe: (e, _ctx, viewer) => (viewer ? "" : `Contract listed: ${strOf(objOf(e.data.def).label, str(e, "asset"))}`),
  },
];

/** The marks a GM sets: a price per unit, or for a bond the yield that price implies. */
function setPrice(ctx: AssetBooks, asset: string, price: number): LedgerEvent[] | Rejection {
  const a = assetOf(ctx, asset);
  if (!a) return reject("missing_asset", `no asset ${asset}`);
  if (a.option) return reject("derived_price", `${a.label} is priced from ${a.option.underlying}; set its price instead`);
  if (a.class === "property" || a.class === "business_stake") return reject("derived_price", `${a.label} is valued from what it stands for`);
  if (!(Number.isFinite(price) && price > 0)) return reject("bad_amount", "a price is above zero");
  if (a.bond) return [{ type: "economy.quote", data: { asset, yield: impliedYield(a.bond, price, ctx.state.clock, a.pays || 2) } }];
  return [{ type: "economy.quote", data: { asset, price: mark(price) } }];
}

/** Assets, their prices and the market (DESIGN §27.1–27.2). */
export function registerMarkets(r: FinanceRegistry): void {
  for (const def of EVENTS) r.core.event(def);
  r.core.process({
    id: "economy.markets",
    domain: "money",
    minLevel: 3,
    // The market moves while the POV, whose level no one exceeds, follows investments.
    step: (slot, ctx, rng) => (r.api.feature(ctx, ctx.world.pov, "investments") ? marketStep(ctx, r.api, slot, rng) : []),
  });
  r.core.effect({
    type: "economy.set_price",
    args: ["asset", "price"],
    gm: true,
    resolve: (a, ctx) => setPrice(ctx, strOf(a.asset), typeof a.price === "number" ? a.price : NaN),
  });
  r.core.formula("asset_price", (ctx, id) => quoteOf(ctx, String(id ?? "")) ?? 0);
  r.core.lint({
    code: "economy.assets",
    check(world) {
      const issues = [];
      const books: AssetBooks = { world, state: { clock: 0, entities: {}, packs: {} } as unknown as WorldState, tables: { get: (id) => own(world.tables, id) } };
      for (const [id, raw] of Object.entries(configAssets(world))) {
        const path = `packs.economy.config.assets.${id}`;
        const def = readAssetDef(raw);
        if (!def) {
          issues.push({ severity: "error" as const, code: "economy.assets", message: `Asset ${id} needs a class (${ASSET_CLASSES.join(", ")}).`, path });
          continue;
        }
        if (def.class === "option") {
          if (!def.underlying || !own(configAssets(world), def.underlying)) issues.push({ severity: "error" as const, code: "economy.assets", message: `Option ${def.label || id} names no underlying asset the world lists.`, path: `${path}.underlying` });
          if (!(typeof def.strike === "number" && def.strike > 0)) issues.push({ severity: "error" as const, code: "economy.assets", message: `Option ${def.label || id} needs a strike above zero.`, path: `${path}.strike` });
          if (clockOfDate(world, def.expiry) === null) issues.push({ severity: "error" as const, code: "economy.assets", message: `Option ${def.label || id} needs an expiry date (YYYY-MM-DD).`, path: `${path}.expiry` });
          if (def.right !== "call" && def.right !== "put") issues.push({ severity: "error" as const, code: "economy.assets", message: `Option ${def.label || id} is a call or a put.`, path: `${path}.right` });
        }
        if (def.class === "bond" && def.face !== undefined && clockOfDate(world, def.maturity) === null) issues.push({ severity: "error" as const, code: "economy.assets", message: `Bond ${def.label || id} has a face value but no maturity date (YYYY-MM-DD).`, path: `${path}.maturity` });
        if (def.model !== undefined && !isRecord(own(investingRows(books), def.model))) issues.push({ severity: "warning" as const, code: "economy.assets", message: `Asset ${def.label || id} follows ${def.model}, which the finance table doesn't list; it takes its class's model.`, path: `${path}.model` });
        if (def.price !== undefined && !(def.price > 0)) issues.push({ severity: "error" as const, code: "economy.assets", message: `Asset ${def.label || id} needs a price above zero.`, path: `${path}.price` });
      }
      return issues;
    },
  });
}
