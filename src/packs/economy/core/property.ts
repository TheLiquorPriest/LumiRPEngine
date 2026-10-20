// Real estate (DESIGN §27.9). A `property` is tied to a place, has owners with shares, and a value
// that moves once a month on the finance table's home-price model (its own appreciation and swings
// override it), sharing one housing shock with every other property. A mortgage is a foundation
// loan account `secured_by` the property. What owning it costs is flows, each worked out from the
// value when it falls due: property tax at its region's effective rate (the regions table), split
// into installments; insurance (the table's typical premium, scaled to the value); and upkeep (a
// share of the value a year). A lease is a rent flow from tenant to owner, with a term: one the
// author or the landlord starts is a `flow` entity linked to the property; a property let to
// outside tenants (`managed`) lets each unit no lease covers, one lease after another at the market
// rent of its day, with a vacancy between tenants drawn from the property's and unit's ids, so it is
// the same on every fold. A unit to let without a lease is vacant; a house its owner lives in has
// none to let. Buying and selling settle the mortgages the property secures, move its leases to the
// new owner and realise the seller's gain.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { ownersIn, worthShares, type Flow, type FlowShare, type FlowSplit, type FlowView, type LeaseView, type Owner, type OwnerLine, type PropertyView } from "../../../shared/finance";
import { hash32 } from "../../../shared/hash";
import type { FieldDef } from "../../../shared/world";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf } from "../../../engine/calendar";
import { labelOf, numOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import type { AmountProvider, FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { addMonths, clockOfDate, dateText, instantIn, investingRows, reject } from "./assets";
import { acquisition, disposal, isHome } from "./gains";
import { shownRoute, unit } from "./holdings";
import { paymentMonths } from "./income";
import { isOpened } from "./journal";
import { openerOf } from "./model";
import { byShare } from "./records";
import { correlated, gbmStep, normal } from "./pricing";

export const PROPERTY_COST_PROVIDER = "property_cost";
const COSTS = ["tax", "insurance", "upkeep"] as const;
type Cost = (typeof COSTS)[number];

/** Fields this module reads on a property besides the foundation's (place, owners, value and the rest). */
const PROPERTY_FIELDS: Record<string, FieldDef> = {
  region: { type: "text", label: "Region (for its property tax)", table: "economy.regions", domain: "money", level: 3 },
  units: { type: "number", label: "Units to let", min: 1, default: 1, domain: "money", level: 3 },
  market_rent: { type: "money", label: "Market rent, a unit a month", min: 0, domain: "money", level: 3 },
  managed: { type: "bool", label: "Let to outside tenants", default: false, domain: "money", level: 3 },
  lease_months: { type: "number", label: "Lease term, months", min: 1, default: 12, domain: "money", level: 3 },
  vacancy_months: { type: "number", label: "Months empty between tenants, on average", min: 0, default: 1, domain: "money", level: 3 },
  let_from: { type: "date", label: "Let since", domain: "money", level: 3 },
  rent_to: { type: "ref", ref: "account", label: "Rent paid into", domain: "money", level: 3 },
  asking_price: { type: "money", label: "Asking price (for sale)", min: 0, domain: "money", level: 3 },
  volatility_pct: { type: "number", label: "Value swings, % a year", min: 0, domain: "money", level: 4 },
  tax_installments: { type: "number", label: "Property tax bills a year", min: 1, max: 12, default: 2, domain: "money", level: 3 },
};

/** The upkeep a year when a property names none: about 1 % of its value. */
const UPKEEP_PCT = 1;

function num(v: JsonValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function fieldsOf(state: Readonly<WorldState>, id: EntityId): JsonObject {
  return own(state.entities, id)?.fields ?? {};
}

/** Every property entity, by id. */
export function propertyIds(state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.kind === "property")
    .sort();
}

/** A property's value now, minor units. */
export function propertyValue(state: Readonly<WorldState>, id: EntityId): number {
  return Math.max(0, Math.round(numOf(fieldsOf(state, id).value)));
}

/** Who pays a property's costs and takes its rent: the owners whose role carries worth, with their percent. */
function payers(api: FinanceApi, state: Readonly<WorldState>, id: EntityId): { owners: Owner[]; shares: Record<EntityId, number> } {
  const owners = api.ownersOf(state, id);
  const shares = worthShares(owners);
  return { owners: owners.filter((o) => (shares[o.party] ?? 0) > 0), shares };
}

/** A flow's paying side for a property's owners: the first pays it all, or each pays their share. */
function payingSide(owners: readonly Owner[], shares: Readonly<Record<EntityId, number>>): { from: string; shares?: FlowShare[] } {
  const first = owners[0]?.party ?? "";
  if (owners.length < 2) return { from: first };
  return { from: first, shares: owners.map((o) => ({ party: o.party, pct: shares[o.party] ?? 0 })) };
}

/** Where rent for owners lands: the first one's deposit account, with the other owners' parts (by share of its worth) split off to theirs. */
function ownersSide(api: FinanceApi, ctx: ReadContext, owners: readonly Owner[]): { to: string; splits?: FlowSplit[] } | null {
  const shares = worthShares(owners);
  const deposits = owners
    .filter((o) => (shares[o.party] ?? 0) > 0)
    .map((o) => ({ party: o.party, account: api.depositAccount(ctx, o.party) }))
    .filter((d): d is { party: EntityId; account: EntityId } => d.account !== null);
  const [first, ...rest] = deposits;
  if (!first) return null;
  return rest.length === 0 ? { to: first.account } : { to: first.account, splits: rest.map((d) => ({ to: d.account, pct: shares[d.party] ?? 0 })) };
}

/** Where a property's rent lands: its `rent_to`, else its owners' deposit accounts by share. */
function rentSide(api: FinanceApi, ctx: ReadContext, id: EntityId, rentTo: string = strOf(fieldsOf(ctx.state, id).rent_to)): { to: string; splits?: FlowSplit[] } | null {
  if (rentTo !== "" && own(ctx.state.entities, rentTo)?.kind === "account") return { to: rentTo };
  return ownersSide(api, ctx, api.ownersOf(ctx.state, id));
}

/**
 * The account a tenant pays rent from: the one the lease names, else their deposit account. A rent
 * split between owners is paid from an account (the flow engine splits only what an account pays),
 * so a lease never leaves the tenant to pay as a person.
 */
function rentPayer(api: FinanceApi, ctx: ReadContext, payer: EntityId): EntityId {
  return own(ctx.state.entities, payer)?.kind === "account" ? payer : (api.depositAccount(ctx, payer) ?? payer);
}

/** The region a property is taxed in: its own, else its first owner's, else the economy's. */
function regionOf(ctx: ReadContext, id: EntityId): string {
  const region = strOf(fieldsOf(ctx.state, id).region);
  if (region !== "") return region;
  const owner = ownersIn(fieldsOf(ctx.state, id))[0]?.party;
  const configured = ctx.world.packs.economy?.config.region;
  return strOf(owner ? fieldsOf(ctx.state, owner).region : undefined, typeof configured === "string" ? configured : "us");
}

function mortgageRow(ctx: Pick<ReadContext, "tables">): JsonObject {
  return objOf(objOf(ctx.tables.get("economy.finance")?.rows.loans?.values).mortgage);
}

/** The terms a lender offers a mortgage on, months, the usual first (the finance table's typical and alternatives; 30 years without a table). */
function mortgageTerms(ctx: Pick<ReadContext, "tables">): number[] {
  const t = objOf(mortgageRow(ctx).term_months);
  const terms = [t.typical, ...(Array.isArray(t.alternatives) ? t.alternatives : [])].filter((v): v is number => typeof v === "number" && v > 0);
  return terms.length > 0 ? [...new Set(terms)] : [360];
}

/** The terms as a purchase form offers them: longest first, the one a purchase gets when none is chosen marked usual. */
function offeredTerms(ctx: Pick<ReadContext, "tables">): { months: number; usual: boolean }[] {
  const terms = mortgageTerms(ctx);
  return [...terms].sort((a, b) => b - a).map((months) => ({ months, usual: months === terms[0] }));
}

/** Property tax a year, percent of value: the property's own rate, else its region's effective rate, else the table's typical. */
export function propertyTaxPct(ctx: ReadContext, id: EntityId): number {
  const region = objOf(own(objOf(ctx.tables.get("economy.regions")?.rows), regionOf(ctx, id)));
  return num(fieldsOf(ctx.state, id).tax_pct) ?? num(region.property_tax_effective_pct) ?? num(objOf(mortgageRow(ctx).property_tax_pct_of_value_per_year).typical) ?? 1;
}

/** Insurance a month: the property's own premium, else the table's typical scaled to its value, within the table's range. */
function insurancePerMonth(ctx: ReadContext, id: EntityId): number {
  const authored = num(fieldsOf(ctx.state, id).insurance);
  if (authored !== undefined) return Math.max(0, Math.round(authored));
  const row = mortgageRow(ctx);
  const band = objOf(row.homeowners_insurance_cents_per_month);
  const typical = numOf(band.typical, 20000);
  const median = numOf(row.median_existing_home_price_cents, 41000000);
  const scaled = (typical * propertyValue(ctx.state, id)) / Math.max(1, median);
  return Math.round(Math.min(numOf(band.max, Infinity), Math.max(numOf(band.min, 0), scaled)));
}

/** What one occurrence of a property's cost comes to now. */
export function costOf(ctx: ReadContext, id: EntityId, cost: Cost): number {
  const value = propertyValue(ctx.state, id);
  const f = fieldsOf(ctx.state, id);
  switch (cost) {
    case "tax":
      return Math.round((value * propertyTaxPct(ctx, id)) / 100 / Math.max(1, Math.round(numOf(f.tax_installments, 2))));
    case "insurance":
      return insurancePerMonth(ctx, id);
    case "upkeep":
      return Math.round((value * numOf(f.upkeep_pct, UPKEEP_PCT)) / 100 / 12);
  }
}

/** The home-price model a property's value follows: its own appreciation and swings, else the table's. */
function housingModel(ctx: ReadContext, id: EntityId): { drift: number; vol: number; rho: number } {
  const rows = investingRows(ctx);
  const row = objOf(own(rows, "real_estate_home_price_appreciation_pct"));
  const cls = objOf(own(objOf(rows.asset_classes), "property"));
  const f = fieldsOf(ctx.state, id);
  return {
    drift: num(f.appreciation_pct) ?? num(cls.annual_return_pct) ?? num(row.typical) ?? 4,
    vol: num(f.volatility_pct) ?? num(cls.annual_volatility_pct) ?? num(row.volatility_pct) ?? 5,
    rho: Math.min(1, Math.max(0, num(cls.correlation) ?? 0.7)),
  };
}

/** Whether a property's money is followed: for one of its owners, or (unowned, on the market) for the POV. */
function followed(api: FinanceApi, ctx: ReadContext, id: EntityId): boolean {
  const owners = api.ownersOf(ctx.state, id);
  return owners.length > 0 ? owners.some((o) => own(ctx.state.entities, o.party) && api.feature(ctx, o.party, "property")) : api.feature(ctx, ctx.world.pov, "property");
}

/** The month's values (midnight on the 1st): one housing shock, each property its own. */
function valueStep(api: FinanceApi, ctx: ReadContext, slot: SlotInfo, rng: (label: string) => Rng): LedgerEvent[] {
  const at = instantIn(ctx, slot, 0);
  if (!at || at.date.day !== 1) return [];
  const out: LedgerEvent[] = [];
  let factor: number | null = null;
  for (const id of propertyIds(ctx.state)) {
    const value = propertyValue(ctx.state, id);
    if (value <= 0 || !followed(api, ctx, id)) continue;
    factor ??= normal(rng("market:housing"));
    const m = housingModel(ctx, id);
    const next = Math.round(gbmStep(value, m.drift, m.vol, 1 / 12, correlated(factor, normal(rng(`property:${id}`)), m.rho)));
    if (next !== value) out.push({ type: "add", entity: id, field: "value", delta: next - value });
  }
  return out;
}

/** A property's cost flows: property tax in installments, insurance and upkeep a month. */
function costFlows(api: FinanceApi, ctx: ReadContext, id: EntityId): Flow[] {
  if (propertyValue(ctx.state, id) <= 0 || !followed(api, ctx, id)) return [];
  const { owners, shares } = payers(api, ctx.state, id);
  if (owners.length === 0) return [];
  const side = payingSide(owners, shares);
  const name = labelOf(ctx, id);
  const f = fieldsOf(ctx.state, id);
  const cal = calendarOf(ctx.world);
  const common = { ...side, link: id, status: "active" as const, method: "account", source: "property" };
  const amount = (cost: Cost): Flow["amount"] => ({ provider: PROPERTY_COST_PROVIDER, args: { property: id, cost } });
  return [
    { ...common, id: `property_tax:${id}`, label: `Property tax, ${name}`, kind: "tax", to: `tax:property:${regionOf(ctx, id)}`, amount: amount("tax"), schedule: { every: "year", months: paymentMonths(numOf(f.tax_installments, 2), cal.system.months, cal.system.months), days: [1], roll: "after" }, shortfall: "defer", category: "property_tax" },
    { ...common, id: `property_insurance:${id}`, label: `Insurance, ${name}`, kind: "premium", to: "insurance:property", amount: amount("insurance"), schedule: { every: "month", days: [1], roll: "after" }, shortfall: "retry", retry_days: 7, retries: 2, category: "insurance" },
    { ...common, id: `property_upkeep:${id}`, label: `Upkeep, ${name}`, kind: "bill", to: "upkeep:property", amount: amount("upkeep"), schedule: { every: "month", days: [15], roll: "after" }, shortfall: "skip", category: "home_maintenance" },
  ];
}

// ---------------------------------------------------------------- leases

/** A lease flow entity's fields, read for the views and the vacancy count. */
interface AuthoredLease {
  id: EntityId;
  tenant: string;
  rent: number;
  start: number | null;
  end: number | null;
  status: string;
}

/** The leases authored or started in play on a property: `flow` entities of kind rent linked to it. */
function authoredLeases(ctx: Pick<ReadContext, "world" | "state">, id: EntityId): AuthoredLease[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((fid) => {
      const e = own(ctx.state.entities, fid);
      if (!e || e.kind !== "flow" || e.fields.flow_kind !== "rent" || e.fields.link !== id) return [];
      const start = clockOfDate(ctx.world, e.fields.start as JsonValue);
      const end = clockOfDate(ctx.world, e.fields.end as JsonValue);
      return [{ id: fid, tenant: strOf(e.fields.from), rent: Math.round(numOf(e.fields.amount_cents)), start, end: end === null ? null : end + 1440, status: strOf(e.fields.status, "active") }];
    });
}

/** Whether a lease is in force at a clock reading: active, started and not past its last day. */
function inForce(l: { start: number | null; end: number | null; status: string }, at: number): boolean {
  return l.status === "active" && (l.start === null || l.start <= at) && (l.end === null || at < l.end);
}

function monthIndex(world: ReadContext["world"], clock: number): number {
  const cal = calendarOf(world);
  const d = dateAt(cal, clock);
  return d.year * cal.system.months + d.month - 1;
}

/** Midnight on the 1st of a month index. */
function monthStart(world: ReadContext["world"], index: number): number {
  const cal = calendarOf(world);
  const year = Math.floor(index / cal.system.months);
  return clockAt(cal, dayIndexOf(cal, year, index - year * cal.system.months + 1, 1), 0);
}

export interface ManagedLease {
  unit: number;
  n: number;
  /** Month indexes: the first month it runs, and the month after its last. */
  from: number;
  to: number;
  rent: number;
}

/**
 * The outside leases of a managed property's units that no lease entity covers: per unit, the lease
 * in force at `at` (if any) and the one after it. A unit's leases run back to back, the first begun
 * a few months before the letting did (each unit's own offset), with a vacancy after each drawn
 * from the ids, about `vacancy_months` on average. Each lease's rent is the market rent grown at the
 * property's appreciation to the month it starts.
 */
export function managedLeases(ctx: ReadContext, id: EntityId, at: number = ctx.state.clock): ManagedLease[] {
  const f = fieldsOf(ctx.state, id);
  const marketRent = numOf(f.market_rent);
  if (f.managed !== true || marketRent <= 0) return [];
  const units = Math.max(1, Math.round(numOf(f.units, 1)));
  const covered = authoredLeases(ctx, id).filter((l) => inForce(l, at)).length;
  const term = Math.max(1, Math.round(numOf(f.lease_months, 12)));
  const vacancy = Math.max(0, Math.round(numOf(f.vacancy_months, 1)));
  const since = clockOfDate(ctx.world, f.let_from as JsonValue) ?? clockOfDate(ctx.world, ctx.world.start.at) ?? 0;
  const first = monthIndex(ctx.world, since);
  const now = monthIndex(ctx.world, at);
  const growth = housingModel(ctx, id).drift;
  const rentFrom = (month: number): number => Math.round(marketRent * Math.pow(1 + growth / 100, (month - first) / 12));
  const out: ManagedLease[] = [];
  for (let k = covered + 1; k <= units; k++) {
    let from = first - (hash32("lease", id, k) % term);
    for (let n = 0; n < 100000; n++) {
      const to = from + term;
      const gap = vacancy > 0 ? hash32("vacancy", id, k, n) % (2 * vacancy + 1) : 0;
      if (to > now) {
        out.push({ unit: k, n, from, to, rent: rentFrom(from) });
        const next = to + gap;
        out.push({ unit: k, n: n + 1, from: next, to: next + term, rent: rentFrom(next) });
        break;
      }
      from = to + gap;
    }
  }
  return out;
}

/** A managed lease as the flow the foundation runs. */
function managedFlow(api: FinanceApi, ctx: ReadContext, id: EntityId, l: ManagedLease, side: { to: string; splits?: FlowSplit[] }): Flow {
  const units = Math.max(1, Math.round(numOf(fieldsOf(ctx.state, id).units, 1)));
  const name = labelOf(ctx, id);
  return {
    id: `lease:${id}:${l.unit}:${l.n}`,
    label: units > 1 ? `Rent, ${name}, unit ${l.unit}` : `Rent, ${name}`,
    kind: "rent",
    from: `tenant:${id}:${l.unit}`,
    ...side,
    amount: { fixed: l.rent },
    schedule: { every: "month", days: [1] },
    start: dateText(ctx.world, monthStart(ctx.world, l.from)),
    end: dateText(ctx.world, monthStart(ctx.world, l.to) - 1440),
    shortfall: "skip",
    category: "rent",
    link: id,
    status: "active",
    source: "leases",
  };
}

/**
 * How many of a property's units are to let, and so stand vacant when no lease covers them: its
 * `units` when its author gives them (units to let: an owner's own flat in the building isn't one);
 * else one, or none when one of its owners lives in it, since a house its owner lives in is their
 * home, not a unit to let (a lease they start on it anyway still shows as let).
 */
function unitsToLet(api: FinanceApi, state: Readonly<WorldState>, id: EntityId): number {
  const units = num(fieldsOf(state, id).units);
  if (units !== undefined) return Math.max(1, Math.round(units));
  return api.ownersOf(state, id).some((o) => isHome(state, id, o.party)) ? 0 : 1;
}

/** A property's leases as its view lists them: each lease, then a vacant line for each unit to let that none covers. */
function leaseViews(api: FinanceApi, ctx: ReadContext, id: EntityId, viewer: EntityId): LeaseView[] {
  const now = ctx.state.clock;
  const units = unitsToLet(api, ctx.state, id);
  const out: LeaseView[] = [];
  let let_ = 0;
  for (const l of authoredLeases(ctx, id)) {
    const live = inForce(l, now);
    if (live) let_++;
    // The tenant is whoever holds the account the rent is paid from.
    const tenant = own(ctx.state.entities, l.tenant)?.kind === "account" ? (api.ownersOf(ctx.state, l.tenant)[0]?.party ?? l.tenant) : l.tenant;
    out.push({ flow: l.id, tenant: shownName(ctx, viewer, tenant, "a tenant"), rent: l.rent, start: l.start === null ? null : dateText(ctx.world, l.start), end: l.end === null ? null : dateText(ctx.world, l.end - 1440), state: live ? "let" : l.end !== null && l.end <= now ? "ended" : "vacant" });
  }
  for (const l of managedLeases(ctx, id)) {
    const from = monthStart(ctx.world, l.from);
    if (from > now) continue;
    let_++;
    out.push({ flow: `lease:${id}:${l.unit}:${l.n}`, tenant: "Outside tenant", rent: l.rent, start: dateText(ctx.world, from), end: dateText(ctx.world, monthStart(ctx.world, l.to) - 1440), state: "let" });
  }
  const marketRent = Math.round(numOf(fieldsOf(ctx.state, id).market_rent));
  for (let k = let_; k < units; k++) out.push({ flow: "", tenant: "", rent: marketRent, start: null, end: null, state: "vacant" });
  return out;
}

// ---------------------------------------------------------------- buying, selling and letting

function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

/**
 * What the loans a property secures still owe, each: a loan that hasn't opened yet owes the authored
 * opening it will post, as the foundation's views show it, so equity and a sale's payoff are right
 * before the borrower's accounts open.
 */
export function securedLoans(api: FinanceApi, state: Readonly<WorldState>, id: EntityId): { loan: EntityId; owed: number }[] {
  const ids = new Set(api.securedBy(state, id));
  const named = strOf(fieldsOf(state, id).mortgage);
  if (named !== "" && own(state.entities, named)?.kind === "account") ids.add(named);
  const owed = (loan: EntityId): number => api.balance(state, loan) + (isOpened(state, loan, openerOf(state, loan)) ? 0 : Math.round(numOf(own(state.entities, loan)?.fields.opening)));
  return [...ids].sort().map((loan) => ({ loan, owed: Math.max(0, -owed(loan)) }));
}

export interface PropertyBuy {
  party: EntityId;
  property: EntityId;
  price?: number;
  from?: EntityId;
  /** Paid in cash at once; the rest is a mortgage. Absent: the whole price in cash. */
  down?: number;
  /** One of the terms lenders offer (`mortgageTerms`); absent, the usual one. The rate is the lender's. */
  term_months?: number;
}

/**
 * Buying a property for sale (an asking price), or one nobody owns: the down payment from the
 * buyer, the rest a new mortgage the property secures; the sellers paid by share once the loans
 * it secured are paid off; the buyer its owner from today, its leases' rent theirs.
 */
export function buyProperty(api: FinanceApi, ctx: EffectContext | ReadContext, x: PropertyBuy): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, x.property);
  if (!e || e.kind !== "property") return reject("missing_property", `no property ${labelOf(ctx, x.property)}`);
  if (!api.feature(ctx, x.party, "property")) return reject("level", "property isn't followed at this money level");
  const { owners, shares } = payers(api, ctx.state, x.property);
  if (owners.some((o) => o.party === x.party)) return reject("already_yours", `${e.name} is already ${labelOf(ctx, x.party)}'s`);
  const asking = num(e.fields.asking_price);
  if (owners.length > 0 && asking === undefined) return reject("not_for_sale", `${e.name} isn't for sale`);
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  // The least it sells for: its asking price, else (nobody owns it) what it's worth.
  const floor = Math.round(asking ?? propertyValue(ctx.state, x.property));
  const price = Math.round(x.price ?? floor);
  if (!(price > 0)) return reject("bad_amount", "a price is above nothing");
  if (price < floor) return reject("declined", asking !== undefined ? `the sellers want ${money(floor)} for ${e.name}` : `${e.name} is worth ${money(floor)}`);
  const down = Math.round(x.down ?? price);
  if (down < 0 || down > price) return reject("bad_amount", "a down payment is between nothing and the price");
  const financed = price - down;
  // A lender wants its share down, and lends for the terms it offers.
  const leastDown = Math.ceil((price * numOf(objOf(mortgageRow(ctx).down_payment_pct).minimum_conventional, 3)) / 100);
  if (financed > 0 && down < leastDown) return reject("declined", `a lender wants at least ${money(leastDown)} down on ${e.name}`);
  const terms = mortgageTerms(ctx);
  const term = x.term_months ?? terms[0] ?? 360;
  if (financed > 0 && !terms.includes(term)) {
    const years = [...terms].sort((a, b) => a - b).map((m) => String(Math.round((m / 12) * 10) / 10));
    return reject("bad_term", `lenders offer mortgages over ${years.length > 1 ? `${years.slice(0, -1).join(", ")} or ${years[years.length - 1]}` : years[0]} years`);
  }
  const from = x.from ?? api.depositAccount(ctx, x.party);
  if (!from) return reject("no_account", `${labelOf(ctx, x.party)} has no account to pay from`);
  const unusableFrom = api.mayUse(ctx, x.party, from, "from");
  if (unusableFrom) return unusableFrom;
  const events: LedgerEvent[] = [];
  let mortgage: EntityId | null = null;
  if (financed > 0) {
    mortgage = `${x.property}:mortgage`;
    for (let i = 2; own(ctx.state.entities, mortgage); i++) mortgage = `${x.property}:mortgage:${i}`;
    // The lender decides, at the buyer's credit (`applyCredit`): the rate, and whether it lends this much against the property at all.
    const opened = api.applyCredit(ctx, x.party, { product: "mortgage", cents: financed, term_months: term, secured_by: x.property, into: api.outside(`closing:${x.property}`), id: mortgage, name: `Mortgage, ${e.name}` });
    if (isRejection(opened)) return opened;
    events.push(...opened);
  }
  // The price, from the buyer and the lender, to whatever the sellers owe on it and then to them.
  const lines: PostingLine[] = [{ account: from, amount: -down }];
  if (financed > 0) lines.push({ account: api.outside(`closing:${x.property}`), amount: -financed });
  const loans = securedLoans(api, ctx.state, x.property);
  const owed = loans.reduce((a, l) => a + l.owed, 0);
  if (owed > price) return reject("declined", `the price doesn't cover what ${e.name}'s sellers owe on it`);
  for (const l of loans) if (l.owed > 0) lines.push({ account: l.loan, amount: l.owed });
  const net = price - owed;
  const sellers = owners.length > 0 ? byShare(shares, net) : [];
  const disposals: LedgerEvent[] = [];
  let left = net;
  sellers.forEach((s, i) => {
    const part = i === sellers.length - 1 ? left : s.cents;
    left -= part;
    const deposit = api.depositAccount(ctx, s.party);
    lines.push({ account: deposit ?? api.outside(s.party), amount: part });
    disposals.push(disposal(x.property, s.party, 100, Math.round((price * (shares[s.party] ?? 0)) / 100), `Sold ${e.name}`));
  });
  if (sellers.length === 0 && net > 0) lines.push({ account: api.outside(`seller:${x.property}`), amount: net });
  const posted = api.post(ctx, lines.filter((l) => l.amount !== 0), { memo: `Bought ${e.name} for ${money(price)}`, kind: "purchase", category: "property" });
  if (isRejection(posted)) return posted;
  const today = dateText(ctx.world, ctx.state.clock);
  return unit([
    ...events,
    ...posted,
    ...disposals,
    { type: "set", entity: x.property, field: "owners", value: [{ party: x.party, role: "owner", share: 100 }] },
    { type: "set", entity: x.property, field: "purchase_price", value: price },
    { type: "set", entity: x.property, field: "purchased", value: today },
    { type: "set", entity: x.property, field: "mortgage", value: mortgage },
    ...(asking !== undefined ? [{ type: "set" as const, entity: x.property, field: "asking_price", value: null }] : []),
    ...(strOf(e.fields.rent_to) !== "" ? [{ type: "set" as const, entity: x.property, field: "rent_to", value: null }] : []),
    acquisition(x.property, x.party, price),
    ...moveLeases(api, ctx, x.property, api.ownersOf(ctx.state, x.property).map((o) => o.party), [{ party: x.party, role: "owner", share: 100 }]),
  ]);
}

/** Whether a lease is still to run: active and not past its last day (it may not have started). */
function notOver(l: { end: number | null; status: string }, at: number): boolean {
  return l.status === "active" && (l.end === null || at < l.end);
}

/** Whether a lease pays the given owners: its payee is one of them, or an account one of them holds. */
function paysOwners(api: FinanceApi, ctx: ReadContext, lease: EntityId, owners: readonly EntityId[]): boolean {
  const to = strOf(fieldsOf(ctx.state, lease).to);
  return owners.includes(to) || api.ownersOf(ctx.state, to).some((o) => owners.includes(o.party));
}

/** What points a lease at a side of the owners: its payee, the owners' split, and (when split) an account for the tenant to pay it from. */
function repoint(api: FinanceApi, ctx: ReadContext, lease: EntityId, side: { to: string; splits?: FlowSplit[] }): LedgerEvent[] {
  const f = fieldsOf(ctx.state, lease);
  const out: LedgerEvent[] = [];
  const splits: JsonValue = side.splits ? (side.splits as unknown as JsonValue) : null;
  if (strOf(f.to) !== side.to) out.push({ type: "set", entity: lease, field: "to", value: side.to });
  if (JSON.stringify(f.splits ?? null) !== JSON.stringify(splits)) out.push({ type: "set", entity: lease, field: "splits", value: splits });
  // A lease a tenant pays as a person (authored so) pays the owners' split from their account.
  const payer = strOf(f.from);
  if (side.splits && rentPayer(api, ctx, payer) !== payer) out.push({ type: "set", entity: lease, field: "from", value: rentPayer(api, ctx, payer) });
  return out;
}

/**
 * Leases follow their property to its new owners: each that paid the old ones now pays the new ones'
 * deposit accounts, split by their shares (sold to nobody in the world, they end today).
 */
function moveLeases(api: FinanceApi, ctx: ReadContext, property: EntityId, owners: readonly EntityId[], next: readonly Owner[]): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const side = ownersSide(api, ctx, next);
  for (const l of authoredLeases(ctx, property)) {
    if (!notOver(l, ctx.state.clock) || !paysOwners(api, ctx, l.id, owners)) continue;
    out.push(...(side ? repoint(api, ctx, l.id, side) : [{ type: "set" as const, entity: l.id, field: "end", value: dateText(ctx.world, ctx.state.clock) }]));
  }
  return out;
}

/**
 * Routing a property's rent (`route_distributions`): its `rent_to` ("" back to the owners' deposit
 * accounts), and every lease not yet over that pays its owners re-pointed there with it, so the
 * tenants already paying follow the route as later ones do (§27.9).
 */
export function routeRent(api: FinanceApi, ctx: ReadContext, property: EntityId, route: string): LedgerEvent[] {
  const out: LedgerEvent[] = strOf(fieldsOf(ctx.state, property).rent_to) === route ? [] : [{ type: "set", entity: property, field: "rent_to", value: route === "" ? null : route }];
  const side = rentSide(api, ctx, property, route);
  if (!side) return out;
  const owners = api.ownersOf(ctx.state, property).map((o) => o.party);
  for (const l of authoredLeases(ctx, property)) if (notOver(l, ctx.state.clock) && paysOwners(api, ctx, l.id, owners)) out.push(...repoint(api, ctx, l.id, side));
  return unit(out);
}

export interface PropertySale {
  party: EntityId;
  property: EntityId;
  price: number;
  /** A party in the world, who pays; absent: an outside buyer. */
  buyer?: EntityId;
  to?: EntityId;
}

/** Selling one's share of a property: the buyer pays, the loans it secures are paid off from the proceeds, the rest lands where the seller says. */
export function sellProperty(api: FinanceApi, ctx: EffectContext | ReadContext, x: PropertySale): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, x.property);
  if (!e || e.kind !== "property") return reject("missing_property", `no property ${labelOf(ctx, x.property)}`);
  if (!api.feature(ctx, x.party, "property")) return reject("level", "property isn't followed at this money level");
  const owners = api.ownersOf(ctx.state, x.property);
  const mine = owners.find((o) => o.party === x.party);
  const share = api.shareOf(ctx.state, x.property, x.party);
  if (!mine || share <= 0) return reject("not_yours", `${e.name} isn't ${labelOf(ctx, x.party)}'s to sell`);
  const price = Math.round(x.price);
  if (!(price > 0)) return reject("bad_amount", "a price is above nothing");
  if (x.buyer !== undefined && (!own(ctx.state.entities, x.buyer) || x.buyer === x.party)) return reject("missing_entity", `no buyer ${labelOf(ctx, x.buyer)}`);
  // Someone outside the world can't hold a share beside the other owners: they buy a whole property from its only owner (§27.9).
  if (x.buyer === undefined && owners.some((o) => o.party !== x.party && api.shareOf(ctx.state, x.property, o.party) > 0)) return reject("needs_buyer", `selling a share of ${e.name} needs a buyer in the world`);
  const to = x.to ?? api.depositAccount(ctx, x.party);
  if (!to) return reject("no_account", `${labelOf(ctx, x.party)} has no account the money could go to`);
  const unusableTo = api.mayUse(ctx, x.party, to, "into");
  if (unusableTo) return unusableTo;
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  // A buyer outside the world pays what the market does: no more than the property is worth.
  const value = propertyValue(ctx.state, x.property);
  if (x.buyer === undefined && price > value) return reject("declined", `no buyer outside the world pays more than ${money(value)} for ${e.name}`);
  const memo = `Sold ${share < 100 ? `a ${Math.round(share)}% share of ` : ""}${e.name} for ${money(price)}`;
  // The seller's own loans against it are settled from the proceeds.
  const loans = securedLoans(api, ctx.state, x.property).filter((l) => api.ownersOf(ctx.state, l.loan).some((o) => o.party === x.party) && l.owed > 0);
  const owed = loans.reduce((a, l) => a + l.owed, 0);
  const events: LedgerEvent[] = [];
  if (x.buyer) {
    const paid = api.pay(ctx, { from: x.buyer, to: x.party, cents: price, memo, deposit: to, kind: "purchase", category: "property" });
    if (isRejection(paid)) return paid;
    events.push(...paid);
    if (owed > 0) {
      const payoff = api.post(ctx, [{ account: to, amount: -owed }, ...loans.map((l) => ({ account: l.loan, amount: l.owed }))], { memo: `${e.name}: mortgage paid off`, kind: "payment", category: "property", unchecked: true });
      if (isRejection(payoff)) return payoff;
      events.push(...payoff);
    }
  } else {
    const lines: PostingLine[] = [{ account: api.outside(`buyer:${x.property}`), amount: -price }, ...loans.map((l) => ({ account: l.loan, amount: l.owed }))];
    if (price !== owed) lines.push({ account: to, amount: price - owed });
    const posted = api.post(ctx, lines, { memo, kind: "sale", category: "property" });
    if (isRejection(posted)) return posted;
    events.push(...posted);
  }
  // Everyone's share written out, the seller's added to the buyer's (on top of any they held) and the
  // rest's unchanged, as a stake sale writes them.
  const shares = worthShares(owners);
  const written: Owner[] = [];
  for (const o of owners) {
    if (o.party === x.party) continue;
    written.push({ party: o.party, role: o.role, share: Math.round(((shares[o.party] ?? 0) + (o.party === x.buyer ? share : 0)) * 10000) / 10000 });
  }
  if (x.buyer && !written.some((o) => o.party === x.buyer)) written.push({ party: x.buyer, role: mine.role === "owner" || mine.role === "joint" ? mine.role : "owner", share: Math.round(share * 10000) / 10000 });
  const others = owners.filter((o) => o.party !== x.party);
  const sold = written.length === 0 || (others.length === 0 && x.buyer !== undefined);
  return unit([
    ...events,
    disposal(x.property, x.party, 100, price, memo),
    { type: "set", entity: x.property, field: "owners", value: written as unknown as JsonValue },
    ...(x.buyer ? [acquisition(x.property, x.buyer, price)] : []),
    ...(sold && loans.length > 0 ? [{ type: "set" as const, entity: x.property, field: "mortgage", value: null }] : []),
    ...(num(e.fields.asking_price) !== undefined ? [{ type: "set" as const, entity: x.property, field: "asking_price", value: null }] : []),
    // The owners changed: their rent goes to them by share until one of them routes it again.
    ...(strOf(e.fields.rent_to) !== "" ? [{ type: "set" as const, entity: x.property, field: "rent_to", value: null }] : []),
    ...moveLeases(api, ctx, x.property, owners.map((o) => o.party), written),
  ]);
}

export interface LeaseStart {
  party: EntityId;
  property: EntityId;
  tenant: EntityId;
  rent: number;
  months?: number;
  day?: number;
  unit?: string;
  from?: EntityId;
}

/** A landlord lets a unit (`lease_start`): a rent flow from the tenant to the landlord's account, for a term from today. */
export function startLease(api: FinanceApi, ctx: ReadContext, x: LeaseStart): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, x.property);
  if (!e || e.kind !== "property") return reject("missing_property", `no property ${labelOf(ctx, x.property)}`);
  if (!api.feature(ctx, x.party, "property")) return reject("level", "property isn't followed at this money level");
  if (api.shareOf(ctx.state, x.property, x.party) <= 0) return reject("not_yours", `${e.name} isn't ${labelOf(ctx, x.party)}'s to let`);
  if (!own(ctx.state.entities, x.tenant) || x.tenant === x.party) return reject("missing_entity", `no tenant ${labelOf(ctx, x.tenant)}`);
  const rent = Math.round(x.rent);
  if (!(rent > 0)) return reject("bad_amount", "rent is above nothing");
  const units = Math.max(1, Math.round(numOf(e.fields.units, 1)));
  if (authoredLeases(ctx, x.property).filter((l) => inForce(l, ctx.state.clock)).length >= units) return reject("full", `every unit of ${e.name} is let`);
  if (x.from) {
    const unusable = api.mayUse(ctx, x.tenant, x.from, "from");
    if (unusable) return unusable;
  }
  const side = rentSide(api, ctx, x.property);
  if (!side) return reject("no_account", `${labelOf(ctx, x.party)} has no account the rent could go to`);
  const months = Math.max(1, Math.round(x.months ?? 12));
  const day = Math.min(28, Math.max(1, Math.round(x.day ?? 1)));
  const last = clockOfDate(ctx.world, addMonths(ctx.world, ctx.state.clock, months));
  let id = `lease:${x.property}:${x.tenant}`;
  for (let i = 2; own(ctx.state.entities, id); i++) id = `lease:${x.property}:${x.tenant}:${i}`;
  const fields: JsonObject = {
    flow_kind: "rent",
    from: x.from ?? rentPayer(api, ctx, x.tenant),
    to: side.to,
    ...(side.splits ? { splits: side.splits as unknown as JsonValue } : {}),
    amount_cents: rent,
    every: "month",
    days: [day],
    start: dateText(ctx.world, ctx.state.clock),
    end: dateText(ctx.world, (last ?? ctx.state.clock) - 1440),
    shortfall: "retry",
    retry_days: 5,
    retries: 2,
    category: "rent",
    link: x.property,
    status: "active",
  };
  return [{ type: "spawn", entity: { id, kind: "flow", name: `Lease: ${labelOf(ctx, x.tenant)}, ${x.unit ? `${x.unit}, ` : ""}${e.name}`, tier: "background", fields, relations: [] } }];
}

/** Ending a lease (`lease_end`), by its landlord or its tenant: its last day is the one given, today at the earliest. */
export function endLease(api: FinanceApi, ctx: ReadContext, party: EntityId, lease: EntityId, on?: string): LedgerEvent[] | Rejection {
  const f = own(ctx.state.entities, lease);
  if (!f || f.kind !== "flow" || f.fields.flow_kind !== "rent") return reject("missing_lease", `no lease ${labelOf(ctx, lease)}`);
  const property = strOf(f.fields.link);
  const from = strOf(f.fields.from);
  const tenant = from === party || api.ownersOf(ctx.state, from).some((o) => o.party === party);
  if (!tenant && api.shareOf(ctx.state, property, party) <= 0) return reject("not_yours", `${f.name} isn't ${labelOf(ctx, party)}'s to end`);
  const at = on ? clockOfDate(ctx.world, on) : ctx.state.clock;
  if (at === null) return reject("bad_date", "a lease ends on a date (YYYY-MM-DD)");
  const date = dateText(ctx.world, Math.max(at, ctx.state.clock));
  return strOf(f.fields.end) === date ? [] : [{ type: "set", entity: lease, field: "end", value: date }];
}

// ---------------------------------------------------------------- views and worth

/** A name as `viewer` may read it: anyone the POV can't see reads as `fallback` (DESIGN §7); the GM's views of others name everyone. */
function shownName(ctx: ReadContext, viewer: EntityId, id: string, fallback: string): string {
  if (!own(ctx.state.entities, id)) return id;
  return viewer === ctx.world.pov && !canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id) ? fallback : labelOf(ctx, id);
}

function ownerLines(api: FinanceApi, ctx: ReadContext, id: EntityId, viewer: EntityId): OwnerLine[] {
  const owners = api.ownersOf(ctx.state, id);
  const shares = worthShares(owners);
  return owners.map((o) => {
    const hidden = viewer === ctx.world.pov && own(ctx.state.entities, o.party) !== undefined && !canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, o.party);
    // An owner the viewer can't see goes as the foundation's views send one: "someone", with no id.
    return { party: hidden ? null : o.party, name: hidden ? "someone" : labelOf(ctx, o.party), role: o.role, share: Math.round((shares[o.party] ?? 0) * 100) / 100 };
  });
}

/**
 * A property as a party's dashboard draws it; its costs are the party's flows linked to it. One they
 * don't own (listed for sale) shows what its listing would: its name, where it is, its value and its
 * price, and nothing of its owners, mortgage or leases. A place the POV can't see goes unnamed.
 */
export function propertyView(api: FinanceApi, ctx: ReadContext, id: EntityId, party: EntityId, flows: readonly FlowView[]): PropertyView {
  const e = own(ctx.state.entities, id);
  const value = propertyValue(ctx.state, id);
  const place = strOf(e?.fields.place);
  const asking = num(e?.fields.asking_price);
  const shownPlace = place === "" || (party === ctx.world.pov && !canSeePlace(ctx.registry, ctx.world, ctx.state, party, place)) ? null : (own(ctx.world.places, place)?.name ?? labelOf(ctx, place));
  if (!api.ownersOf(ctx.state, id).some((o) => o.party === party)) {
    // One they may buy, as a purchase allows, carries the terms a lender offers, so a form offers those and no others.
    const mayBuy = api.feature(ctx, party, "property") && (asking !== undefined || payers(api, ctx.state, id).owners.length === 0);
    return { id, name: e?.name ?? id, place: shownPlace, owners: [], share: 0, value, equity: 0, forSale: asking ?? null, mortgage: null, leases: [], costs: [], route: null, ...(mayBuy ? { mortgageTerms: offeredTerms(ctx) } : {}) };
  }
  const loans = securedLoans(api, ctx.state, id);
  const loan = loans.find((l) => l.owed > 0);
  const owed = loans.reduce((a, l) => a + l.owed, 0);
  const rentTo = strOf(e?.fields.rent_to);
  return {
    id,
    name: e?.name ?? id,
    place: shownPlace,
    owners: ownerLines(api, ctx, id, party),
    share: api.shareOf(ctx.state, id, party),
    value,
    equity: value - owed,
    mortgage: loan ? { id: loan.loan, name: labelOf(ctx, loan.loan), owed, payment: num(fieldsOf(ctx.state, loan.loan).payment) ?? null, monthsLeft: num(fieldsOf(ctx.state, loan.loan).months_left) ?? null } : null,
    leases: leaseViews(api, ctx, id, party),
    costs: flows.filter((f) => f.link?.id === id && f.kind !== "rent"),
    forSale: asking ?? null,
    // Where its rent goes: `rent_to` when it names an account, else the usual place.
    route: shownRoute(api, ctx, party, own(ctx.state.entities, rentTo)?.kind === "account" ? rentTo : null, false),
  };
}

/** The properties a party sees: those it has a role on, and those for sale it doesn't own (for the POV, those it may see). */
export function visibleProperties(api: FinanceApi, ctx: ReadContext, party: EntityId): EntityId[] {
  return propertyIds(ctx.state).filter((id) => api.ownersOf(ctx.state, id).some((o) => o.party === party) || (num(fieldsOf(ctx.state, id).asking_price) !== undefined && (party !== ctx.world.pov || canSeeEntity(ctx.registry, ctx.world, ctx.state, party, id))));
}

/** A party's share of every property's value, a line each. */
export function propertyWorth(api: FinanceApi, ctx: ReadContext, party: EntityId): { assets: number; lines: { label: string; cents: number }[] } {
  const lines: { label: string; cents: number }[] = [];
  let assets = 0;
  for (const id of propertyIds(ctx.state)) {
    const share = api.shareOf(ctx.state, id, party);
    if (share <= 0) continue;
    const cents = Math.round((propertyValue(ctx.state, id) * share) / 100);
    if (cents === 0) continue;
    assets += cents;
    lines.push({ label: labelOf(ctx, id), cents });
  }
  return { assets, lines };
}

/** What a party collects in rent a month now, across the leases on their properties, by share. */
export function monthlyRent(api: FinanceApi, ctx: ReadContext, party: EntityId): number {
  let total = 0;
  for (const id of propertyIds(ctx.state)) {
    const share = api.shareOf(ctx.state, id, party);
    if (share <= 0) continue;
    const authored = authoredLeases(ctx, id).filter((l) => inForce(l, ctx.state.clock)).reduce((a, l) => a + l.rent, 0);
    const managed = managedLeases(ctx, id)
      .filter((l) => monthStart(ctx.world, l.from) <= ctx.state.clock && ctx.state.clock < monthStart(ctx.world, l.to))
      .reduce((a, l) => a + l.rent, 0);
    total += Math.round(((authored + managed) * share) / 100);
  }
  return total;
}

/** Real estate (DESIGN §27.9): values, costs, leases, buying and selling. */
export function registerProperty(r: FinanceRegistry): void {
  r.fields("property", PROPERTY_FIELDS);
  r.core.process({ id: "economy.property_values", domain: "money", minLevel: 3, step: (slot, ctx, rng) => valueStep(r.api, ctx, slot, rng) });
  r.flows({ id: "property", flows: (ctx) => propertyIds(ctx.state).flatMap((id) => costFlows(r.api, ctx, id)) });
  r.flows({
    id: "leases",
    flows: (ctx) =>
      propertyIds(ctx.state).flatMap((id) => {
        if (!followed(r.api, ctx, id)) return [];
        const leases = managedLeases(ctx, id);
        const side = leases.length > 0 ? rentSide(r.api, ctx, id) : null;
        return side ? leases.map((l) => managedFlow(r.api, ctx, id, l, side)) : [];
      }),
  });
  const provider: AmountProvider = (ctx, flow): FlowPosting | null => {
    const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    const cost = strOf(args.cost) as Cost;
    if (!(COSTS as readonly string[]).includes(cost)) return null;
    const cents = costOf(ctx, strOf(args.property), cost);
    // Upkeep is what repairs cost on average, not a bill anyone sends: like living costs, its posting is its one line.
    return cents > 0 ? { cents, memo: flow.label, kind: "payment", category: flow.category ?? "property", ...(cost === "upkeep" ? { quiet: true } : {}) } : null;
  };
  r.amount(PROPERTY_COST_PROVIDER, provider);

  const n = (a: Record<string, JsonValue>, k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
  const s = (a: Record<string, JsonValue>, k: string): string | undefined => (typeof a[k] === "string" && a[k] !== "" ? (a[k] as string) : undefined);
  const party = (a: Record<string, JsonValue>, ctx: ReadContext): EntityId => s(a, "party") ?? ctx.world.pov;
  r.core.effect({
    type: "economy.property_buy",
    args: ["property", "price?", "from?", "down?", "term_months?", "party?"],
    resolve: (a, ctx) => {
      const price = n(a, "price");
      const from = s(a, "from");
      const down = n(a, "down");
      const term = n(a, "term_months");
      return buyProperty(r.api, ctx, { party: party(a, ctx), property: strOf(a.property), ...(price !== undefined ? { price } : {}), ...(from ? { from } : {}), ...(down !== undefined ? { down } : {}), ...(term !== undefined ? { term_months: term } : {}) });
    },
  });
  r.core.effect({
    type: "economy.property_sell",
    args: ["property", "price", "buyer?", "to?", "party?"],
    resolve: (a, ctx) => {
      const buyer = s(a, "buyer");
      const to = s(a, "to");
      return sellProperty(r.api, ctx, { party: party(a, ctx), property: strOf(a.property), price: n(a, "price") ?? NaN, ...(buyer ? { buyer } : {}), ...(to ? { to } : {}) });
    },
  });
  r.core.effect({
    type: "economy.lease_start",
    args: ["property", "tenant", "rent", "months?", "day?", "unit?", "from?", "party?"],
    resolve: (a, ctx) => {
      const months = n(a, "months");
      const day = n(a, "day");
      const unitName = s(a, "unit");
      const from = s(a, "from");
      return startLease(r.api, ctx, { party: party(a, ctx), property: strOf(a.property), tenant: strOf(a.tenant), rent: n(a, "rent") ?? NaN, ...(months !== undefined ? { months } : {}), ...(day !== undefined ? { day } : {}), ...(unitName ? { unit: unitName } : {}), ...(from ? { from } : {}) });
    },
  });
  r.core.effect({ type: "economy.lease_end", args: ["lease", "on?", "party?"], resolve: (a, ctx) => endLease(r.api, ctx, party(a, ctx), strOf(a.lease), s(a, "on")) });

  const requires = ["money_feature('property', self)"];
  r.core.action({
    id: "property_buy",
    label: "Buy a property",
    pack: "economy",
    params: { property: { type: "ref", ref: "property" }, price: { type: "money", label: "Offer", optional: true }, from: { type: "ref", ref: "account", label: "Pay from", optional: true }, down: { type: "money", label: "Down payment (the rest on a mortgage)", optional: true }, term_months: { type: "number", label: "Mortgage term, months (one a lender offers)", optional: true } },
    requires,
    outcomes: { default: [{ type: "economy.property_buy", args: { party: "self", property: "property", price: "=params.price", from: "=params.from", down: "=params.down", term_months: "=params.term_months" } }] },
    duration: "60",
    lexicon: ["buy the house", "buy the property", "make an offer on"],
    observable: "signs a stack of papers",
  });
  r.core.action({
    id: "property_sell",
    label: "Sell a property",
    pack: "economy",
    params: { property: { type: "ref", ref: "property" }, price: { type: "money", label: "Price" }, buyer: { type: "ref", ref: "person", label: "Buyer", optional: true }, to: { type: "ref", ref: "account", label: "Proceeds to", optional: true } },
    requires,
    outcomes: { default: [{ type: "economy.property_sell", args: { party: "self", property: "property", price: "=params.price", buyer: "=params.buyer", to: "=params.to" } }] },
    duration: "60",
    lexicon: ["sell the house", "sell the property"],
    observable: "signs a stack of papers",
  });
  r.core.action({
    id: "lease_start",
    label: "Let a unit",
    pack: "economy",
    params: { property: { type: "ref", ref: "property" }, tenant: { type: "ref", ref: "person", label: "Tenant" }, rent: { type: "money", label: "Rent a month" }, months: { type: "number", label: "Term, months", optional: true }, day: { type: "number", label: "Rent day", optional: true }, unit: { type: "text", label: "Unit", optional: true } },
    requires,
    outcomes: { default: [{ type: "economy.lease_start", args: { party: "self", property: "property", tenant: "tenant", rent: "=params.rent", months: "=params.months", day: "=params.day", unit: "=params.unit" } }] },
    duration: "20",
    lexicon: ["rent out", "sign a lease", "let the apartment"],
    observable: "signs a lease",
  });
  r.core.action({
    id: "lease_end",
    label: "End a lease",
    pack: "economy",
    params: { lease: { type: "ref", ref: "flow" }, on: { type: "text", label: "Last day (YYYY-MM-DD)", optional: true } },
    requires,
    outcomes: { default: [{ type: "economy.lease_end", args: { party: "self", lease: "lease", on: "=params.on" } }] },
    duration: "10",
    lexicon: ["end the lease", "give notice", "move out"],
    observable: "writes a letter",
  });
  r.core.formula("property_value", (ctx, id) => propertyValue(ctx.state, String(id ?? "")));
  r.core.lint({
    code: "economy.property",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "property") continue;
        const path = `entities.${e.id}.fields`;
        const place = strOf(e.fields.place);
        if (place !== "" && !own(world.places, place)) issues.push({ severity: "error" as const, code: "economy.property", message: `Property ${e.name} is at "${place}", which isn't a place.`, path: `${path}.place` });
        if (!(numOf(e.fields.value) > 0)) issues.push({ severity: "warning" as const, code: "economy.property", message: `Property ${e.name} has no value, so it adds nothing to anyone's worth and costs nothing to keep.`, path: `${path}.value` });
        for (const o of ownersIn(e.fields)) if (!own(world.entities, o.party)) issues.push({ severity: "error" as const, code: "economy.property", message: `Property ${e.name} names owner "${o.party}", who isn't in the world.`, path: `${path}.owners` });
        const mortgage = strOf(e.fields.mortgage);
        if (mortgage !== "") {
          const loan = own(world.entities, mortgage);
          if (loan?.kind !== "account") issues.push({ severity: "error" as const, code: "economy.property", message: `Property ${e.name}'s mortgage "${mortgage}" isn't an account.`, path: `${path}.mortgage` });
          else if (strOf(loan.fields.secured_by) !== e.id) issues.push({ severity: "warning" as const, code: "economy.property", message: `Property ${e.name}'s mortgage ${loan.name} isn't secured by it (its secured_by names ${strOf(loan.fields.secured_by) || "nothing"}).`, path: `entities.${mortgage}.fields.secured_by` });
        }
        if (e.fields.managed === true && !(numOf(e.fields.market_rent) > 0)) issues.push({ severity: "warning" as const, code: "economy.property", message: `Property ${e.name} is let to outside tenants but has no market rent, so it lets nothing.`, path: `${path}.market_rent` });
        const rentTo = strOf(e.fields.rent_to);
        if (rentTo !== "" && own(world.entities, rentTo)?.kind !== "account") issues.push({ severity: "warning" as const, code: "economy.property", message: `Property ${e.name}'s rent goes to "${rentTo}", which isn't an account; it goes to the owners' accounts instead.`, path: `${path}.rent_to` });
      }
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "flow" || e.fields.flow_kind !== "rent" || typeof e.fields.link !== "string" || e.fields.link === "") continue;
        if (own(world.entities, e.fields.link)?.kind !== "property") continue;
        const property = own(world.entities, e.fields.link);
        if (property && clockOfDate(world, e.fields.end as JsonValue) === null && e.fields.end !== undefined) issues.push({ severity: "warning" as const, code: "economy.property", message: `Lease ${e.name} on ${property.name} has an end that isn't a date (YYYY-MM-DD).`, path: `entities.${e.id}.fields.end` });
      }
      return issues;
    },
  });
}
