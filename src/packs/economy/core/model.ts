// Economy model (DESIGN §9.2 Money, §25): accounts and their classes, ownership, products,
// balances, availability, wealth bands, the level-1 notional representation, regions and pricing.
// Pure reads over the state.
//
// Sign convention: an account's posting total is its balance from its holders' side. Asset
// accounts are positive when they hold money; credit accounts are negative when money is owed.
// Every posting balances, so the trial balance is always 0.

import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { Band } from "../../../shared/tables";
import type { WorldDoc } from "../../../shared/world";
import {
  ACCOUNT_CLASSES,
  CLASS_TRAITS,
  LEGACY_TYPE_CLASS,
  ROLE_RIGHTS,
  isAccountClass,
  isOwnerRole,
  ownersIn,
  worthShares,
  type AccountClass,
  type AccountStatus,
  type ClassTraits,
  type Hold,
  type InterestMethod,
  type MinimumRule,
  type Owner,
  type OverdraftPolicy,
  type ProductDef,
  type ProductFees,
  type ResolvedProduct,
  type RoleRights,
} from "../../../shared/finance";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { bandOfJson, labelOf, numOf, objOf, sliceOf, strOf, own, rowOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import type { WorldState } from "../../../engine/state";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import { MEMBER_OF } from "../../../engine/selector";

/** The outside account corrections post against (a ✎ cash fix, a GM money edit): money they add or remove comes from or goes to it, so the books still balance. Shown as "Correction". */
export const CORRECTION_ACCOUNT = `${EXTERNAL_ACCOUNT_PREFIX}correction`;
/** Outside accounts of banks and lenders: what they charge (interest, fees) is theirs to post, so no funds check refuses it. */
export const BANK_PREFIX = `${EXTERNAL_ACCOUNT_PREFIX}bank:`;

export function external(id: string): string {
  return `${EXTERNAL_ACCOUNT_PREFIX}${id}`;
}

/**
 * The outside account an outside payee's name stands for, the same whoever pays it: the name as an
 * id (lower case, `:` kept between its parts, any other run of characters as `_`), an outside
 * account id read as its name. So "Harbor Gym" is `economy.external:harbor_gym`, and `tax:federal`
 * and `economy.external:tax:federal` are both `economy.external:tax:federal`, as `api.outside`
 * names it.
 */
export function outsideAccount(name: string): string {
  const bare = name.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? name.slice(EXTERNAL_ACCOUNT_PREFIX.length) : name;
  return external(bare.toLowerCase().replace(/[^a-z0-9:]+/g, "_").replace(/^_+|_+$/g, "") || "outside");
}

/** The foundation's and the modules' own outside payees by key, as a person reads them. */
const OUTSIDE_NAMES: Readonly<Record<string, string>> = {
  market: "Shops",
  insurer: "Insurer",
  "tax:federal": "Federal tax",
  "tax:state": "State tax",
  "tax:local": "Local tax",
  "insurance:property": "Property insurance",
  "upkeep:property": "Property upkeep",
};

/** The taxes a region's authority collects (`tax:<kind>:<region>`), by kind. */
const REGIONAL_TAXES: Readonly<Record<string, string>> = { sales: "Sales tax", property: "Property tax" };

/** Outside keys that name who they are after the kind (`bank:<institution>`), and what each reads as when nothing follows. */
const NAMED_OUTSIDE: Readonly<Record<string, string>> = { bank: "Bank", atm: "Cash machine", employer: "Employer" };

/** Outside keys that say what kind of party they are and what they're about (`seller:<property>`), by the kind. */
const OUTSIDE_KINDS: Readonly<Record<string, string>> = { buyer: "Buyer", seller: "Seller", market: "Market", tenant: "Outside tenant" };

/**
 * An outside side of a payment as a person reads it (DESIGN §25.11): the foundation's and the
 * modules' own payees in words, a regional tax with its region ("Sales tax (Michigan)"), a bank, a
 * cash machine's bank and an outside employer by the name or place they were given, a property's
 * outside buyer, seller or tenant and a holding's market by what they are, and any other name, an
 * author's or a player's, as written. A journal line keeps an outside name with its `_` read as
 * spaces, so a region or a place is found either way.
 */
export function outsideName(books: TableBooks, raw: string): string {
  const bare = raw.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? raw.slice(EXTERNAL_ACCOUNT_PREFIX.length) : raw;
  const known = own(OUTSIDE_NAMES, bare);
  if (known !== undefined) return known;
  const [head = "", ...rest] = bare.split(":");
  const tail = rest.join(":").trim();
  const tax = head === "tax" ? own(REGIONAL_TAXES, rest[0] ?? "") : undefined;
  if (tax !== undefined) {
    const region = rest.slice(1).join(":").trim();
    if (region === "") return tax;
    const name = rowOf(books, "economy.regions", region.replace(/ +/g, "_"))?.name;
    return `${tax} (${typeof name === "string" && name !== "" ? name : region.replace(/_/g, " ")})`;
  }
  const named = own(NAMED_OUTSIDE, head);
  // A bank with no name of its own is `bank:bank` (`bankSide`).
  if (named !== undefined) return tail === "" || tail === head ? named : labelOf(books, tail.replace(/ +/g, "_"));
  const kind = tail === "" ? undefined : own(OUTSIDE_KINDS, head);
  return kind ?? bare.replace(/_/g, " ");
}

export function bankSide(institution: string): string {
  return `${BANK_PREFIX}${institution || "bank"}`;
}

/** What a read of the books needs. */
export type Books = Pick<ReadContext, "world" | "state">;
export type TableBooks = Pick<ReadContext, "world" | "state" | "tables">;

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

// ---------------------------------------------------------------- classes and products

/** A world's own products (`packs.economy.config.products`), id → def, the well-formed ones. */
export function worldProducts(world: Pick<WorldDoc, "packs">): Record<string, ProductDef> {
  const raw = objOf(objOf(world.packs.economy?.config).products);
  const out: Record<string, ProductDef> = {};
  for (const [id, p] of Object.entries(raw)) {
    const def = objOf(p);
    if (isAccountClass(def.class)) out[id] = def as unknown as ProductDef;
  }
  return out;
}

/**
 * The class of an account: its product's (a world product, or a class id named as the product),
 * else, for an account an older build wrote, its `type`. Null for anything that isn't an account.
 */
export function classOf(books: Books, id: EntityId): AccountClass | null {
  const e = own(books.state.entities, id);
  if (!e || e.kind !== "account") return null;
  const product = strOf(e.fields.product);
  if (product !== "") {
    const def = own(worldProducts(books.world), product);
    if (def) return def.class;
    if (isAccountClass(product)) return product;
  }
  return own(LEGACY_TYPE_CLASS, strOf(e.fields.type)) ?? null;
}

export function traitsOf(books: Books, id: EntityId): ClassTraits | null {
  const c = classOf(books, id);
  return c ? CLASS_TRAITS[c] : null;
}

/** Built-in parameters that the Modern US tables don't carry: common US bank practice. */
const DEBIT_PURCHASE_LIMIT = 300_000;
const DEBIT_ATM_LIMIT = 50_000;
const DEPOSIT_HOLD_DAYS = 2;
const OVERDRAFT_LIMIT = 50_000;

function typical(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const o = objOf(v as JsonObject);
  return typeof o.typical === "number" ? o.typical : fallback;
}

/** A class's defaults from the pinned finance table (or the same figures when a world has none). */
function classDefaults(books: TableBooks, cls: AccountClass): Omit<ResolvedProduct, "id" | "label" | "institution"> {
  const rows = books.tables.get("economy.finance")?.rows ?? {};
  const card = objOf(rows.credit_card?.values);
  const deposits = objOf(rows.deposit_accounts?.values);
  const fees = objOf(deposits.checking_fees_cents);
  const loans = objOf(rows.loans?.values);
  const personal = objOf(loans.personal);
  const mortgage = objOf(loans.mortgage);
  const minimum = objOf(objOf(card.minimum_payment).default);
  const lateFees = objOf(card.late_fee_cents);
  const advance = objOf(card.cash_advance_fee);
  const cardMinimum: MinimumRule = { pct: numOf(minimum.principal_pct, 1), floor: numOf(minimum.floor_cents, 3500), plus_interest: minimum.includes_interest_and_fees !== false };
  const noFees: Required<ProductFees> = { annual: 0, late_first: 0, late_repeat: 0, overdraft: 0, nsf: 0, atm: 0, cash_advance_pct: 0, cash_advance_min: 0, maintenance: 0, maintenance_waive: 0, card_replacement: 0 };
  const creditFees: Required<ProductFees> = { ...noFees, late_first: numOf(lateFees.first, 3200), late_repeat: numOf(lateFees.repeat, 4300), nsf: typical(card.returned_payment_fee_cents, 3200), cash_advance_pct: numOf(advance.pct, 5), cash_advance_min: numOf(advance.minimum_cents, 1000) };
  const bankFees: Required<ProductFees> = {
    ...noFees,
    overdraft: typical(fees.overdraft, 2700),
    nsf: typical(fees.nsf_returned_item, 1700),
    atm: typical(fees.atm_out_of_network_total, 473),
    maintenance: typical(fees.monthly_maintenance, 500),
    maintenance_waive: typical(fees.minimum_balance_to_waive_cents, 150_000),
    card_replacement: typical(fees.debit_card_replacement, 0),
  };
  const base: Omit<ResolvedProduct, "id" | "label" | "institution"> = {
    class: cls,
    limit: null,
    apr_pct: 0,
    apy_pct: 0,
    interest: "average_daily",
    penalty_apr_pct: 0,
    cash_advance_apr_pct: 0,
    due_days: typical(card.grace_period_days, 25),
    statement_day: 1,
    minimum: cardMinimum,
    fees: noFees,
    rewards_pct: 0,
    daily_purchase_limit: null,
    daily_atm_limit: null,
    hold_days: DEPOSIT_HOLD_DAYS,
    overdraft: "decline",
    overdraft_limit: OVERDRAFT_LIMIT,
    term_months: null,
    secured: false,
  };
  const savings = objOf(deposits.savings_apy_pct);
  switch (cls) {
    case "checking":
    case "business_checking":
      return { ...base, apy_pct: typical(deposits.checking_apy_pct, 0.07), fees: bankFees, daily_purchase_limit: DEBIT_PURCHASE_LIMIT, daily_atm_limit: DEBIT_ATM_LIMIT };
    case "savings":
    case "trust":
      return { ...base, apy_pct: typical(savings.regular_national_average, 0.4), fees: { ...bankFees, maintenance: 0 } };
    case "money_market":
      return { ...base, apy_pct: typical(deposits.money_market_apy_pct, 3.5), fees: { ...bankFees, maintenance: 0 } };
    case "cd":
      return { ...base, apy_pct: typical(deposits.cd_12_month_apy_pct, 4), term_months: 12 };
    case "credit_card":
      return { ...base, limit: typical(objOf(card.credit_limit_cents), 1_000_000), apr_pct: typical(card.apr_pct, 22), penalty_apr_pct: numOf(card.penalty_apr_pct, 29.99), cash_advance_apr_pct: numOf(advance.apr_pct_typical, 27), fees: creditFees };
    case "charge_card":
      return { ...base, minimum: { pct: 100, floor: 0, plus_interest: false }, fees: { ...creditFees, annual: numOf(objOf(card.annual_fee_cents).rewards_typical, 9500) } };
    case "line_of_credit":
      return { ...base, limit: typical(personal.amount_cents, 800_000), apr_pct: typical(personal.apr_pct, 12.3), penalty_apr_pct: numOf(card.penalty_apr_pct, 29.99), fees: creditFees };
    case "loan":
      return { ...base, apr_pct: typical(personal.apr_pct, 12.3), term_months: typical(personal.term_months, 36), fees: { ...creditFees, nsf: 0 } };
    case "mortgage":
      return { ...base, apr_pct: typical(mortgage.apr_pct_30yr_fixed, 6.4), term_months: typical(mortgage.term_months, 360), secured: true, fees: { ...creditFees, nsf: 0 } };
    default:
      return base;
  }
}

/**
 * Everything an account's product settles: its class's defaults, the world product it names, then
 * the account's own fields. Null for anything that isn't an account.
 */
export function productOf(books: TableBooks, id: EntityId): ResolvedProduct | null {
  const cls = classOf(books, id);
  const e = own(books.state.entities, id);
  if (!cls || !e) return null;
  const productId = strOf(e.fields.product) || cls;
  const def: Partial<ProductDef> = own(worldProducts(books.world), productId) ?? {};
  const base = classDefaults(books, cls);
  const f = e.fields;
  const num = (field: string, fallback: number): number => numOf(f[field], fallback);
  const fees: Required<ProductFees> = { ...base.fees, ...objOf(def.fees as JsonObject | undefined) } as Required<ProductFees>;
  const minimum: MinimumRule = { ...base.minimum, ...(def.minimum ?? {}) };
  if (typeof f.min_pct === "number") minimum.pct = f.min_pct;
  if (typeof f.min_floor === "number") minimum.floor = f.min_floor;
  const limit = typeof f.limit === "number" ? f.limit : def.limit === null ? null : typeof def.limit === "number" ? def.limit : base.limit;
  const policy = strOf(f.overdraft, def.overdraft ?? base.overdraft);
  return {
    id: productId,
    label: def.label ?? CLASS_TRAITS[cls].label,
    class: cls,
    institution: strOf(f.institution, def.institution ?? ""),
    limit,
    // A deposit account an older world gave an `apr_pct` earns it (the old starter's savings did).
    apr_pct: CLASS_TRAITS[cls].asset ? 0 : num("apr_pct", def.apr_pct ?? base.apr_pct),
    apy_pct: CLASS_TRAITS[cls].asset ? num("apy_pct", typeof f.apr_pct === "number" ? f.apr_pct : (def.apy_pct ?? base.apy_pct)) : 0,
    interest: (def.interest ?? base.interest) as InterestMethod,
    penalty_apr_pct: def.penalty_apr_pct ?? base.penalty_apr_pct,
    cash_advance_apr_pct: def.cash_advance_apr_pct ?? base.cash_advance_apr_pct,
    // An older build wrote `due_days` on the cards it sampled.
    due_days: num("due_days", def.due_days ?? base.due_days),
    statement_day: num("statement_day", def.statement_day ?? base.statement_day),
    minimum,
    fees,
    rewards_pct: def.rewards_pct ?? base.rewards_pct,
    daily_purchase_limit: def.daily_purchase_limit ?? base.daily_purchase_limit,
    daily_atm_limit: def.daily_atm_limit ?? base.daily_atm_limit,
    hold_days: def.hold_days ?? base.hold_days,
    overdraft: policy === "fee" || policy === "linked" ? (policy as OverdraftPolicy) : "decline",
    overdraft_limit: num("overdraft_limit", def.overdraft_limit ?? base.overdraft_limit),
    term_months: typeof f.term_months === "number" ? f.term_months : (def.term_months ?? base.term_months),
    secured: def.secured ?? base.secured,
  };
}

// ---------------------------------------------------------------- ownership

export function ownersOf(state: Readonly<WorldState>, id: EntityId): Owner[] {
  const e = own(state.entities, id);
  return e ? ownersIn(e.fields) : [];
}

/** The parties an entity names on its owners list, in order, once each. */
export function holdersOf(state: Readonly<WorldState>, id: EntityId): EntityId[] {
  return [...new Set(ownersOf(state, id).map((o) => o.party))];
}

/** What a party may do with an entity: the rights of every role it holds there, together; null when it holds none. */
export function rightsOf(state: Readonly<WorldState>, id: EntityId, party: EntityId): RoleRights | null {
  const roles = ownersOf(state, id).filter((o) => o.party === party && isOwnerRole(o.role));
  if (roles.length === 0) return null;
  return roles.reduce<RoleRights>((acc, o) => {
    const r = ROLE_RIGHTS[o.role];
    return { spend: acc.spend || r.spend, worth: acc.worth || r.worth, sees: acc.sees || r.sees, manage: acc.manage || r.manage };
  }, { spend: false, worth: false, sees: false, manage: false });
}

export function canSpend(state: Readonly<WorldState>, account: EntityId, party: EntityId): boolean {
  return rightsOf(state, account, party)?.spend === true;
}

/**
 * Whether `who` manages a party by a role on it (DESIGN §25.1): a managing role (`owner`, `joint`,
 * `custodian`, `trustee`) on a business or a trust. A person or a household lists no owners, so no
 * one else manages it.
 */
export function managesParty(state: Readonly<WorldState>, party: EntityId, who: EntityId): boolean {
  return ownersOf(state, party).some((o) => o.party === who && ROLE_RIGHTS[o.role].manage);
}

/**
 * Whether `who` manages an account (DESIGN §25.1): by a managing role on it, or by managing a
 * business or a trust that holds one, so a business's owners manage its accounts by their role on
 * the business. Managing is setting up and changing what the account pays (its standing payments,
 * its autopay) and its cards; it isn't spending, which only a role on the account gives, and an
 * employee, holding no role on the business, manages none of it.
 */
export function managesAccount(books: Books, account: EntityId, who: EntityId): boolean {
  if (!classOf(books, account)) return false;
  return ownersOf(books.state, account).some((o) => ROLE_RIGHTS[o.role].manage && (o.party === who || managesParty(books.state, o.party, who)));
}

/**
 * Who owes a credit account (DESIGN §25.1): the holders it counts against (an owner, a joint
 * owner), not one who only spends on it or manages it; whoever holds it, when no role counts it.
 */
export function debtorsOf(state: Readonly<WorldState>, account: EntityId): EntityId[] {
  const owners = ownersOf(state, account);
  const owing = owners.filter((o) => ROLE_RIGHTS[o.role].worth);
  return [...new Set((owing.length > 0 ? owing : owners).map((o) => o.party))];
}

/** The household a party is, or belongs to (a `member_of` relation to one); null for none. */
export function householdOf(ctx: Pick<ReadContext, "registry" | "world" | "state">, party: EntityId): EntityId | null {
  const isHousehold = (id: string): boolean => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "household");
  if (isHousehold(party)) return party;
  return own(ctx.state.entities, party)?.relations.find((r) => r.type === MEMBER_OF && isHousehold(r.to))?.to ?? null;
}

/** A party's share of an entity's worth, in percent. */
export function shareOf(state: Readonly<WorldState>, id: EntityId, party: EntityId): number {
  return own(worthShares(ownersOf(state, id)), party) ?? 0;
}

/** The party whose money opening posts an account's opening balance: the first on its owners list. */
export function openerOf(state: Readonly<WorldState>, account: EntityId): EntityId | null {
  return ownersOf(state, account)[0]?.party ?? null;
}

/** Accounts a party holds with a right (`sees` by default: any role), in class order, then id. */
export function accountsOf(books: Books, party: EntityId, right: keyof RoleRights = "sees"): EntityId[] {
  const out: EntityId[] = [];
  for (const [id, e] of Object.entries(books.state.entities)) {
    if (e.kind !== "account" || !classOf(books, id)) continue;
    if (rightsOf(books.state, id, party)?.[right] === true) out.push(id);
  }
  const order = (id: EntityId): number => ACCOUNT_CLASSES.indexOf(classOf(books, id) ?? "cash");
  return out.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

export function hasLedger(books: Books, party: EntityId): boolean {
  return accountsOf(books, party).length > 0;
}

// ---------------------------------------------------------------- balances

export function balance(state: Readonly<WorldState>, account: EntityId): number {
  return own(state.accounts, account) ?? 0;
}

/** An account's status: the one play set (frozen, collections, paid off…), else its own field, else open. */
export function statusOf(state: Readonly<WorldState>, account: EntityId): AccountStatus {
  const set = strOf(own(objOf(sliceOf(state, "economy").status), account));
  const field = strOf(own(state.entities, account)?.fields.status);
  const v = set || field;
  return v === "frozen" || v === "collections" || v === "charged_off" || v === "closed" || v === "paid_off" || v === "matured" ? v : "open";
}

/** Holds on an account that haven't lapsed. */
export function holdsOn(state: Readonly<WorldState>, account: EntityId): Hold[] {
  const raw = objOf(own(objOf(sliceOf(state, "economy").holds), account));
  const out: Hold[] = [];
  for (const [id, h] of Object.entries(raw)) {
    const o = objOf(h);
    const until = numOf(o.until);
    if (until > state.clock) out.push({ id, account, cents: Math.round(numOf(o.cents)), until, kind: o.kind === "authorization" ? "authorization" : "deposit", memo: strOf(o.memo) });
  }
  return out.sort((a, b) => a.until - b.until || a.id.localeCompare(b.id));
}

/**
 * What an account can pay out now, before any overdraft: an asset account's balance less its holds;
 * a credit account's limit less what it owes (a charge card, with no preset limit, any amount).
 */
export function availableOf(books: TableBooks, account: EntityId): number {
  const t = traitsOf(books, account);
  if (!t) return 0;
  const b = balance(books.state, account);
  if (t.liability) {
    const p = productOf(books, account);
    if (p?.class === "charge_card" && p.limit === null) return Number.MAX_SAFE_INTEGER;
    return (p?.limit ?? 0) + b;
  }
  return b - holdsOn(books.state, account).reduce((a, h) => a + h.cents, 0);
}

/** The money a person holds in cash they can reach: cash in nothing (abstract cash), or inside something they carry. */
export function containersOf(state: Readonly<WorldState>, id: EntityId): EntityId[] {
  const out: EntityId[] = [];
  let cur = id;
  for (let guard = 0; guard < 16; guard++) {
    const to = own(state.entities, cur)?.relations.find((r) => r.type === "in")?.to;
    if (!to || out.includes(to)) break;
    out.push(to);
    cur = to;
  }
  return out;
}

/** Cash is spendable only on its holder: in nothing, or inside something a holder of it carries. */
export function cashOnHolder(state: Readonly<WorldState>, account: EntityId, holder: EntityId): boolean {
  const chain = containersOf(state, account);
  return chain.length === 0 || chain.includes(holder);
}

/** Whether a thing is lost: it, or something it's inside, is marked lost. */
export function isLost(state: Readonly<WorldState>, id: EntityId): boolean {
  return [id, ...containersOf(state, id)].some((x) => own(state.entities, x)?.fields.lost === true);
}

// ---------------------------------------------------------------- worth

/** A party's share of its accounts' balances (and their openings while unopened, when `openings` says how). */
export function accountsWorth(books: Books, party: EntityId, shown?: (account: EntityId) => number): number {
  let total = 0;
  for (const id of accountsOf(books, party, "worth")) total += ((shown ? shown(id) : balance(books.state, id)) * shareOf(books.state, id, party)) / 100;
  return Math.round(total);
}

export interface Anchor {
  band: string;
  typical: number;
  base: number;
}

/**
 * The level-1 representation of a party without ledger accounts: a notional net worth that
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
