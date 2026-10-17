// Economy pack (DESIGN §9.2 Money, §9.3): one double-entry ledger with an external-economy
// counterparty; cash, checking, savings, cards, loans and brokerage accounts; payroll with flat
// withholding (occupation + state rate); bills; card statements, interest, minimum payments and
// autopay; savings interest and loans; investments on seeded price paths; catalog and
// category-band pricing with seeded variance, lenient clamping and declines.
//
// Level contract (domain `money`; every party posts at its own effective level):
//   0  off: charges are no-ops
//   1  a wealth band. Parties without accounts post against their external account
//      (`economy.external:<id>`) and their band follows a continuous notional net worth.
//   2  cash plus one account (the ledger is live; declines on insufficient funds)
//   3  accounts, cards with autopay, recurring income (payroll) and bills
//   4  interest/APR, statements, minimum payments, loans, investments, withholding detail
// Demotion stops processes and narrows rendering; balances stay live, so promotion restores
// nothing stale. The trial balance is 0 at every level mix.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent, PostEvent, PostingLine } from "../../../shared/ledger";
import type { GmMoney } from "../../../shared/state-view";
import type { DataTable } from "../../../shared/tables";
import type { EntityDef, KindDef } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, weekdayName, type CalDate } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { isMaterialized, pinnedVersion, tablesRevision } from "../../../engine/materialize";
import { hashParts } from "../../../shared/hash";
import { formatMoney } from "../../../shared/world";
import { minorUnitPlural } from "../../../shared/money";
import { labelOf, mutableSlice, numOf, objOf, optionalService, sliceOf, sliceRecord, strOf, own, rowOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, PackDef, ReadContext, Rejection, ServiceMap, SlotInfo } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import {
  accountsOf,
  accountType,
  anchorOf,
  balance,
  bandByLabel,
  CORRECTION_ACCOUNT,
  DEFAULT_SYMBOL,
  derivedUnpricedCap,
  external,
  MARKET,
  netWorth,
  notional,
  priceOf,
  priceOfSymbol,
  spendable,
  unpricedCap,
  wealthBand,
  wealthOf,
  withholding,
  type AccountType,
  type Price,
  type PriceRef,
} from "./model";
import { catalogName, itemName, stem } from "./items";
import { buildMoneyView, buildPeopleMoney } from "./view";
import catalog from "./tables/modern-us/catalog.json";
import categories from "./tables/modern-us/categories.json";
import finance from "./tables/modern-us/finance.json";
import occupations from "./tables/modern-us/occupations.json";
import regions from "./tables/modern-us/regions.json";

const TABLES: DataTable[] = [catalog, categories, occupations, regions, finance] as unknown as DataTable[];

export interface ChargeOptions {
  /** Who receives the money; omitted: the external market (or `counterparty`). */
  payee?: EntityId;
  /** `account`: a recurring payment (a bill, a premium) from checking, the card or savings, never wallet cash. */
  method?: "auto" | "cash" | "card" | "checking" | "savings" | "account";
  /** A specific account of the payer's to pay from (a bill's `from`); it declines when it can't cover the amount (level 2+). */
  source?: EntityId;
  /** An account of the payee's the money lands in (a transfer that names it, or cash handed over landing in carried cash). */
  deposit?: EntityId;
  /** External counterparty id when there is no payee entity (`employer`, `landlord`, …). */
  counterparty?: string;
  category?: string;
  /** A narrated price the charge doesn't match, for the history line: capped at the world's `unpricedCap`, or clamped into the item's band. */
  narrated?: { cents: number; limited: "cap" | "band" };
}

const PAY_METHODS: readonly NonNullable<ChargeOptions["method"]>[] = ["auto", "cash", "card", "checking", "savings"];

/**
 * A payment method said in words ("pay with my card"): an exact method ("card", the
 * Pay another way retries), else "debit"/"checking" → checking, "savings", "credit"/"card" →
 * card, "cash"/"wallet" → cash; anything else is auto.
 */
export function payMethodOf(text: string): NonNullable<ChargeOptions["method"]> {
  const t = text.trim().toLowerCase();
  const exact = PAY_METHODS.find((m) => m === t);
  if (exact) return exact;
  if (/\b(debit|checking|check|bank)\b/.test(t)) return "checking";
  if (/\bsavings?\b/.test(t)) return "savings";
  if (/\b(credit|card|visa|mastercard|amex)\b/.test(t)) return "card";
  if (/\b(cash|wallet|coins?)\b/.test(t)) return "cash";
  return "auto";
}

/**
 * A narrated transfer's sum in minor units, rounded: `cents` when given (already minor units),
 * else `amount` as the extract step sends it (scaled to minor units there); NaN when neither is a
 * number. The transfer moves this sum and its chip states it.
 */
export function transferCents(p: JsonObject): number {
  return Math.round(typeof p.cents === "number" ? p.cents : typeof p.amount === "number" ? p.amount : NaN);
}

export interface Offer {
  item: string;
  name: string;
  cents: number;
  category: string;
}

/** Categories a place sells by its tags (template place tags); a place's own `sells` list overrides them. */
const TAG_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  grocery: ["groceries_staples", "groceries_baskets", "household_goods", "personal_care", "alcohol"],
  cafe: ["coffee", "meals_out"],
  bar: ["alcohol", "meals_out"],
  restaurant: ["meals_out", "alcohol"],
  fuel: ["fuel", "groceries_staples"],
  hardware: ["tools_hardware", "household_goods"],
  marina: ["fuel", "transport"],
  clinic: ["medical"],
  pharmacy: ["medical", "personal_care"],
  shop: ["clothing", "gifts", "household_goods"],
  store: ["clothing", "electronics", "household_goods"],
  market: ["groceries_staples", "groceries_baskets", "gifts"],
  inn: ["lodging", "meals_out", "alcohol"],
  workplace: ["vehicle_services", "tools_hardware"],
};
const OFFER_CAP = 24;

/** What a place sells: its own `sells` list (categories or catalog ids), else the categories its tags sell, and its tags. */
function placeTrade(ctx: ReadContext, place: string | null): { categories: string[]; sells: string[]; tags: string[] } {
  const p = place ? own(ctx.world.places, place) : undefined;
  const sells = Array.isArray(p?.fields.sells) ? p.fields.sells.filter((x): x is string => typeof x === "string") : [];
  const tags = Array.isArray(p?.fields.tags) ? p.fields.tags.filter((x): x is string => typeof x === "string") : [];
  return { categories: [...new Set(sells.length > 0 ? sells : tags.flatMap((t) => own(TAG_CATEGORIES, t) ?? []))], sells, tags };
}

function offersAt(ctx: ReadContext, who: EntityId): Offer[] {
  return offersAtPlace(ctx, placeOfEntity(ctx.state, who));
}

function offersAtPlace(ctx: ReadContext, place: string | null): Offer[] {
  if (!place || !own(ctx.world.places, place)) return [];
  const { categories, sells } = placeTrade(ctx, place);
  const catalog = ctx.tables.get("economy.catalog")?.rows ?? {};
  const out: Offer[] = [];
  for (const category of categories) {
    for (const id of Object.keys(catalog).sort()) {
      if (out.length >= OFFER_CAP) return out;
      const row = catalog[id];
      if (!row || (strOf(row.category) !== category && !sells.includes(id))) continue;
      const price = priceOf(ctx, { catalog: id, place });
      if (price) out.push({ item: id, name: price.name, cents: price.unitCents, category });
    }
  }
  return out;
}

/**
 * The catalog row a free-text item names (DESIGN §9.5), or null. A row fits only when the item's
 * main noun is one the row names, word for word with simple plurals ("bran muffin" fits "Pastry or
 * muffin"; "desk lamp" doesn't fit "Desk", nor "chocolate bar" "Bar or club cover charge"), and
 * isn't another kind of it: an item with a qualifier the row lacks doesn't fit a row with
 * qualifiers of its own ("lantern oil" isn't "Vegetable or canola oil"; "coffee" is "Drip coffee").
 * Of the rows that fit, the one holding the most of the item's words wins ("pint of beer" is "Beer
 * at a bar", by its id); then one whose own noun is that noun, one in the category the purchase
 * gives, one the place sells, one that mentions a place tag (a pint at a bar), then the first id.
 */
export function matchCatalog(ctx: ReadContext, text: string, place: string | null, category = ""): string | null {
  const item = itemName(text);
  if (!item) return null;
  const said = new Set([...item.words, ...(item.trailing?.words ?? [])]);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const trade = placeTrade(ctx, place);
  const tags = trade.tags.map((t) => stem(t.toLowerCase()));
  let best: { id: string; score: number[] } | null = null;
  for (const id of Object.keys(rows).sort()) {
    const row = rows[id];
    const name = catalogName(id, strOf(row?.name, id));
    if (!name.heads.has(item.head)) continue;
    const unnamed = [...item.words].some((w) => w !== item.head && !name.words.has(w));
    if (unnamed && [...name.qualifiers].some((q) => !said.has(q))) continue;
    const rowCategory = strOf(row?.category);
    const score = [[...said].filter((w) => name.words.has(w)).length, name.main === item.head ? 1 : 0, rowCategory === category ? 1 : 0, trade.categories.includes(rowCategory) ? 1 : 0, tags.some((t) => name.words.has(t)) ? 1 : 0];
    const first = best ? score.findIndex((s, i) => s !== best?.score[i]) : 0;
    if (!best || (first >= 0 && (score[first] ?? 0) > (best.score[first] ?? 0))) best = { id, score };
  }
  return best?.id ?? null;
}

export type ChargeService = (ctx: ReadContext, payer: EntityId, cents: number, memo: string, opts?: ChargeOptions) => LedgerEvent[] | Rejection;

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Pay `cents`: a no-op at level 0, a band check plus adjustment at 1, a posting (with declines) from 2. */
    "economy.charge": ChargeService;
    /** Move money between two parties, each at its own level; each a person, or a person's own cash, checking, savings or card account. */
    "economy.transfer": (ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string, method?: ChargeOptions["method"]) => LedgerEvent[] | Rejection;
    /** The cash inside `item` goes with it: lost to the outside world, or stolen by `thief`. */
    "economy.lose": (ctx: ReadContext, item: EntityId, thief?: EntityId) => LedgerEvent[] | Rejection;
    /**
     * A correction that makes `holder`'s cash (the sum of their cash accounts, as the Money panel and
     * the HUD show it) come to `cents`: a balanced posting between their cash and the outside
     * correction account. Empty when it already does; null when the holder has no cash account.
     */
    "economy.set_cash": (ctx: ReadContext, holder: EntityId, cents: number) => LedgerEvent[] | Rejection | null;
    /** A purchase that applied (its events) repriced to `cents` in all: the difference moves between the two accounts its payment used. */
    "economy.reprice": (ctx: ReadContext, events: readonly LedgerEvent[], cents: number) => LedgerEvent[] | Rejection;
  }
  interface QueryMap {
    wealth: (ctx: ReadContext, who: EntityId) => string;
    can_afford: (ctx: ReadContext, who: EntityId, cents: number) => boolean;
    "economy.net_worth": (ctx: ReadContext, who: EntityId) => number | null;
    "economy.price": (ctx: ReadContext, ref: PriceRef, rng?: Rng) => Price | null;
    /** What `who` can buy where they are (the palette's Buy options): catalog items the place sells, quoted at the place, stable order, at most 24. */
    "economy.offers": (ctx: ReadContext, who: EntityId) => Offer[];
    /** The range a Buy recorded as "Bought `name`" can be charged for `qty` where `who` is: its catalog row's (else its category's) regional band. Null for an item neither prices. */
    "economy.bought_band": (ctx: ReadContext, name: string, qty: number, who: EntityId) => { min: number; max: number } | null;
    /** Catalog items to pick for a purchase nothing priced: rows sharing a word with `item` first, then what `who` can buy where they are; at most 12, quoted where `who` is. */
    "economy.item_choices": (ctx: ReadContext, item: string, who: EntityId) => Offer[];
  }
}

/** The catalog row, else the category, whose name a "Bought …" memo carries (the name `priceOf` gives it). */
function boughtRef(ctx: ReadContext, name: string): PriceRef | null {
  const named = (table: string): string | undefined => Object.entries(ctx.tables.get(table)?.rows ?? {}).find(([id, row]) => strOf(row?.name, id) === name)?.[0];
  const catalog = named("economy.catalog");
  if (catalog) return { catalog };
  const category = named("economy.categories");
  return category ? { category } : null;
}

function loseWith(ctx: ReadContext, item: EntityId, thief?: EntityId): LedgerEvent[] | Rejection {
  const s = ctx.state;
  if (!own(s.entities, item)) return reject("missing_entity", `no ${labelOf(ctx, item)}`);
  if (thief && !own(s.entities, thief)) return reject("missing_entity", `no ${labelOf(ctx, thief)}`);
  const out: LedgerEvent[] = [];
  for (const id of Object.keys(s.entities).sort()) {
    const cents = balance(s, id);
    if (accountType(s, id) !== "cash" || cents <= 0 || !containersOf(s, id).includes(item)) continue;
    const memo = thief ? `Stolen with ${own(s.entities, item)?.name ?? item}` : `Lost with ${own(s.entities, item)?.name ?? item}`;
    const dest = thief ? payeeSide(ctx, { payee: thief }, cents) : { account: external("lost"), extra: [] };
    const lines: PostingLine[] = [
      { account: id, amount: -cents },
      { account: dest.account, amount: cents },
    ];
    out.push(...asUnit([{ type: "post", lines, memo }, ...dest.extra, txn(memo, lines)]));
  }
  return out;
}

export const ACCOUNT: KindDef = {
  id: "account",
  label: "Account",
  pack: "economy",
  fields: {
    owner: { type: "ref", label: "Owner", domain: "money", level: 2 },
    type: { type: "enum", label: "Type", values: ["cash", "checking", "savings", "card", "loan", "brokerage"], domain: "money", level: 2 },
    institution: { type: "text", label: "Institution", domain: "money", level: 3 },
    opening: { type: "money", label: "Opening balance", locked: true },
    limit: { type: "money", label: "Credit limit", min: 0, domain: "money", level: 3 },
    autopay: { type: "text", label: "Autopay", default: "none", domain: "money", level: 3 },
    statement_day: { type: "number", label: "Statement day", min: 1, max: 28, default: 1, domain: "money", level: 4 },
    due_day: { type: "number", label: "Due day of month", min: 1, max: 31, domain: "money", level: 4 },
    remaining_months: { type: "number", label: "Months left (loans)", min: 0, domain: "money", level: 4 },
    apr_pct: { type: "number", label: "APR %", min: 0, domain: "money", level: 4 },
    apy_pct: { type: "number", label: "APY %", min: 0, domain: "money", level: 4 },
    min_pct: { type: "number", label: "Minimum payment % of balance", default: 1, domain: "money", level: 4 },
    min_floor: { type: "money", label: "Minimum payment floor", default: 3500, domain: "money", level: 4 },
    payment: { type: "money", label: "Loan payment", domain: "money", level: 4 },
    symbol: { type: "text", label: "Holding", default: DEFAULT_SYMBOL, domain: "money", level: 4 },
    units: { type: "number", label: "Units held", min: 0, domain: "money", level: 4, locked: true },
  },
};

export const BUSINESS: KindDef = {
  id: "business",
  label: "Business",
  extends: "thing",
  pack: "economy",
  fields: {},
};

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

function hasLedger(state: Readonly<WorldState>, who: EntityId): boolean {
  return accountsOf(state, who).length > 0;
}

function ofType(state: Readonly<WorldState>, who: EntityId, t: AccountType): EntityId[] {
  return accountsOf(state, who).filter((id) => accountType(state, id) === t);
}

function available(state: Readonly<WorldState>, account: EntityId): number {
  const b = balance(state, account);
  return accountType(state, account) === "card" ? numOf(own(state.entities, account)?.fields.limit) + b : b;
}

const BANK_SIDE = `${EXTERNAL_ACCOUNT_PREFIX}bank:`;

function postGuard(ctx: ReadContext, lines: readonly PostingLine[]): Rejection | null {
  const s = ctx.state;
  if (lines.some((l) => l.amount > 0 && l.account.startsWith(BANK_SIDE))) return null;
  for (const l of lines) {
    if (l.amount >= 0) continue;
    const t = accountType(s, l.account);
    const owner = strOf(own(s.entities, l.account)?.fields.owner);
    if (!t || t === "loan" || t === "brokerage" || !own(s.entities, owner) || ctx.levelOf(owner, "money") < 2) continue;
    // Against the owner's own outside-world account: opening balances (an authored overdraft too).
    if (lines.some((x) => x.account === external(owner))) continue;
    if (available(s, l.account) + l.amount < 0) {
      const name = labelOf(ctx, l.account);
      return reject("declined", t === "card" ? `${name} has no room for ${formatMoney(-l.amount, ctx.world.currency)}` : `${name} can't cover ${formatMoney(-l.amount, ctx.world.currency)}`);
    }
  }
  return null;
}

/** The containers an entity sits in, innermost first (`in` relations). */
function containersOf(state: Readonly<WorldState>, id: EntityId): EntityId[] {
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

/** Cash is spendable only on its owner: in nothing (abstract cash), or inside something the owner carries. */
function onOwner(state: Readonly<WorldState>, account: EntityId): boolean {
  const chain = containersOf(state, account);
  return chain.length === 0 || chain.includes(strOf(own(state.entities, account)?.fields.owner));
}

/** Where money lands for `who` by default: checking, then cash, then any account but a card or a loan; never `except`. */
function depositOf(state: Readonly<WorldState>, who: EntityId, except?: EntityId): EntityId | undefined {
  const ok = (id: EntityId): boolean => id !== except;
  return ofType(state, who, "checking").find(ok) ?? ofType(state, who, "cash").find(ok) ?? accountsOf(state, who).find((id) => ok(id) && accountType(state, id) !== "card" && accountType(state, id) !== "loan");
}

/** Account types a payment can be drawn from; a named loan or brokerage account never pays. */
const PAYING_TYPES: readonly (AccountType | null)[] = ["cash", "checking", "savings", "card"];

/**
 * The account a payment comes from, or a decline (from level 2; level 1 overdraws instead). A named
 * source pays at every level only when it is the payer's own cash, checking, savings or card
 * account; any other falls back to the usual choice, which is never `except`.
 */
function pickSource(ctx: ReadContext, payer: EntityId, cents: number, method: ChargeOptions["method"], level: number, source?: EntityId, except?: EntityId): EntityId | Rejection {
  const s = ctx.state;
  if (source && own(s.entities, source)?.fields.owner === payer && PAYING_TYPES.includes(accountType(s, source))) {
    if (level < 2 || available(s, source) >= cents) return source;
    return reject("declined", `${labelOf(ctx, source)} can't cover ${formatMoney(cents, ctx.world.currency)}`);
  }
  const order: AccountType[] = method === "cash" ? ["cash"] : method === "card" ? ["card"] : method === "checking" ? ["checking"] : method === "savings" ? ["savings"] : method === "account" ? ["checking", "card", "savings"] : level >= 2 ? ["cash", "checking", "card"] : ["cash", "checking", "card", "savings"];
  const candidates = order.flatMap((t) => ofType(s, payer, t)).filter((id) => id !== except && (accountType(s, id) !== "cash" || onOwner(s, id)));
  for (const id of candidates) if (available(s, id) >= cents) return id;
  if (level < 2) {
    const fallback = ofType(s, payer, "checking").find((id) => id !== except) ?? candidates[0] ?? accountsOf(s, payer).find((id) => id !== except);
    if (fallback) return fallback;
  }
  const name = own(s.entities, payer)?.name ?? payer;
  return reject("declined", method === "card" ? `${name}'s card was declined` : `${name} doesn't have ${formatMoney(cents, ctx.world.currency)} available`);
}

/** Level-1 band bookkeeping for a party without accounts whose external account moves by `delta`. */
function l1Move(state: Readonly<WorldState>, who: EntityId, delta: number): LedgerEvent[] {
  const a = anchorOf(state, who);
  const after = notional(state, who) + delta;
  const band = wealthBand(after);
  const explicit = objOf(own(objOf(sliceOf(state, "economy").anchors), who)).band === a.band;
  const out: LedgerEvent[] = [];
  if (!explicit || band !== a.band) out.push({ type: "economy.anchor", data: { entity: who, band, typical: a.typical, base: a.base } });
  if (band !== strOf(own(state.entities, who)?.fields.wealth, "modest")) out.push({ type: "set", entity: who, field: "wealth", value: band });
  return out;
}

/** Where money lands for a payee: the named deposit account it holds, else its default deposit account, else its external account (level-1 band moves). */
function payeeSide(ctx: ReadContext, opts: ChargeOptions, cents: number): { account: string; extra: LedgerEvent[] } {
  const payee = opts.payee;
  if (payee && own(ctx.state.entities, payee)) {
    if (hasLedger(ctx.state, payee) && ctx.levelOf(payee, "money") >= 1) {
      const named = opts.deposit && own(ctx.state.entities, opts.deposit)?.fields.owner === payee ? opts.deposit : undefined;
      const deposit = named ?? depositOf(ctx.state, payee);
      if (deposit) return { account: deposit, extra: [] };
    }
    const extra = ctx.levelOf(payee, "money") >= 1 && !hasLedger(ctx.state, payee) ? l1Move(ctx.state, payee, cents) : [];
    return { account: external(payee), extra };
  }
  return { account: external(opts.counterparty ?? "market"), extra: [] };
}

/** A posting's history line: the lines on accounts in the world, and the narrated price a purchase's charge doesn't match (chips say so). */
function txn(memo: string, lines: readonly PostingLine[], narrated?: ChargeOptions["narrated"]): LedgerEvent {
  const mine = lines.filter((l) => !l.account.startsWith(EXTERNAL_ACCOUNT_PREFIX));
  return { type: "economy.txn", data: { memo, lines: mine.map((l) => ({ account: l.account, amount: l.amount })), ...(narrated ? { narrated: narrated.cents, limited: narrated.limited } : {}) } };
}

/**
 * One payment as an atomic unit (ledger 1.10): its posting, its history line and any bookkeeping
 * beside it share a group, so a rebased view that can't afford the posting drops all of them.
 */
function asUnit(events: LedgerEvent[]): LedgerEvent[] {
  if (events.length < 2) return events;
  const group = `pay:${hashParts(JSON.stringify(events)).slice(0, 10)}`;
  return events.map((e) => ({ ...e, group }));
}

const charge: ChargeService = (ctx, payer, rawCents, memo, opts = {}) => {
  if (!own(ctx.state.entities, payer)) return reject("missing_entity", `no payer ${labelOf(ctx, payer)}`);
  const cents = Math.round(rawCents);
  if (!(cents > 0)) return [];
  const level = ctx.levelOf(payer, "money");
  if (level === 0) return [];
  const out: LedgerEvent[] = [];
  let source: string;
  if (hasLedger(ctx.state, payer)) {
    const picked = pickSource(ctx, payer, cents, opts.method, level, opts.source);
    if (typeof picked !== "string") return picked;
    source = picked;
  } else {
    if (notional(ctx.state, payer) < cents) return reject("declined", `${labelOf(ctx, payer)} can't afford ${formatMoney(cents, ctx.world.currency)}`);
    source = external(payer);
    out.push(...l1Move(ctx.state, payer, -cents));
  }
  const dest = payeeSide(ctx, opts, cents);
  const lines: PostingLine[] = [
    { account: source, amount: -cents },
    { account: dest.account, amount: cents },
  ];
  return asUnit([{ type: "post", lines, memo }, ...out, ...dest.extra, txn(memo, lines, opts.narrated)]);
};

const setCash: ServiceMap["economy.set_cash"] = (ctx, holder, cents) => {
  const s = ctx.state;
  const cash = ofType(s, holder, "cash");
  // Carried cash first (the wallet), then any other cash: what's added lands in the first, and what's
  // taken empties them in turn, so no account goes below zero.
  const [first, ...rest] = [...cash.filter((id) => onOwner(s, id)), ...cash.filter((id) => !onOwner(s, id))];
  if (!first) return null;
  const target = Math.round(cents);
  if (!Number.isSafeInteger(target) || target < 0) return reject("bad_amount", "cash can't be less than nothing");
  let left = target - cash.reduce((a, id) => a + balance(s, id), 0);
  if (left === 0) return [];
  const lines: PostingLine[] = left > 0 ? [{ account: first, amount: left }] : [];
  for (const id of [first, ...rest]) {
    if (left >= 0) break;
    const take = Math.min(-left, Math.max(0, balance(s, id)));
    if (take > 0) lines.push({ account: id, amount: -take });
    left += take;
  }
  lines.push({ account: CORRECTION_ACCOUNT, amount: -lines.reduce((a, l) => a + l.amount, 0) });
  return asUnit([{ type: "post", lines, memo: "Correction" }, txn("Correction", lines)]);
};

const reprice: ServiceMap["economy.reprice"] = (ctx, events, cents) => {
  const post = events.find((e): e is PostEvent => e.type === "post" && e.memo.startsWith("Bought "));
  const paid = post?.lines.find((l) => l.amount < 0);
  const got = post?.lines.find((l) => l.amount > 0);
  if (!post || !paid || !got || post.lines.length !== 2) return reject("not_a_purchase", "there's no purchase to reprice");
  const total = Math.round(cents);
  if (!Number.isSafeInteger(total) || total <= 0) return reject("bad_amount", "the amount must be positive");
  const diff = total - got.amount;
  if (diff === 0) return [];
  const memo = `${post.memo}: price corrected`;
  const lines: PostingLine[] = [
    { account: paid.account, amount: -diff },
    { account: got.account, amount: diff },
  ];
  return asUnit([{ type: "post", lines, memo }, txn(memo, lines)]);
};

/**
 * A side of a transfer: a person, or a person's own cash, checking, savings or card account, which
 * stands for its holder paying from it (`from`) or depositing into it (`to`). Anything else (a
 * thing, a loan or brokerage account, an account no person holds) is refused.
 */
function transferParty(ctx: ReadContext, id: EntityId): { holder: EntityId; account?: EntityId } | Rejection {
  const s = ctx.state;
  const e = own(s.entities, id);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, id)}`);
  if (kindIs(ctx.registry, ctx.world, e.kind, "person")) return { holder: id };
  const holder = strOf(e.fields.owner);
  if (PAYING_TYPES.includes(accountType(s, id)) && kindIs(ctx.registry, ctx.world, own(s.entities, holder)?.kind ?? "", "person")) return { holder, account: id };
  return reject("bad_party", `${labelOf(ctx, id)} isn't a person or a person's own cash, checking, savings or card account`);
}

/**
 * Money from one party to another, each at its own level (`transferParty` reads each side). Two
 * sides of one holder move money between two of their accounts. Cash handed over (`method`
 * "cash") comes from the payer's carried cash when it covers, else the usual source, and lands in
 * the payee's carried cash, else the usual deposit account.
 */
function transfer(ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string, method: ChargeOptions["method"] = "auto"): LedgerEvent[] | Rejection {
  const payer = transferParty(ctx, from);
  if ("code" in payer) return payer;
  const payee = transferParty(ctx, to);
  if ("code" in payee) return payee;
  const s = ctx.state;
  const paying = method === "cash" ? "auto" : method;
  const cash = method === "cash" ? ofType(s, payee.holder, "cash").find((id) => onOwner(s, id)) : undefined;
  if (payer.holder !== payee.holder) {
    const deposit = payee.account ?? cash;
    return charge(ctx, payer.holder, cents, memo, { payee: payee.holder, method: paying, ...(payer.account ? { source: payer.account } : {}), ...(deposit ? { deposit } : {}) });
  }
  if (!payer.account && !payee.account) return reject("bad_party", `${labelOf(ctx, from)} can't pay themselves`);
  const level = ctx.levelOf(payer.holder, "money");
  if (level === 0) return [];
  const c = Math.round(cents);
  const source = payer.account ?? pickSource(ctx, payer.holder, c, paying, level, undefined, payee.account);
  if (typeof source !== "string") return source;
  const target = payee.account ?? (cash !== undefined && cash !== source ? cash : depositOf(s, payee.holder, source));
  if (!target || target === source) return reject("bad_party", `${labelOf(ctx, source)} can't pay itself`);
  return move(ctx, source, target, c, memo);
}

/** A posting between two accounts of one owner (savings transfers, card payments). */
function move(ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string): LedgerEvent[] | Rejection {
  const s = ctx.state;
  if (!own(s.entities, from) || !own(s.entities, to)) return reject("missing_account", "both accounts must exist");
  const owner = strOf(own(s.entities, from)?.fields.owner);
  if (owner === "" || owner !== own(s.entities, to)?.fields.owner) return reject("not_owner", "both accounts must belong to the same owner");
  const c = Math.round(cents);
  if (!(c > 0)) return reject("bad_amount", "the amount must be positive");
  if (ctx.levelOf(owner, "money") >= 2 && available(s, from) < c) return reject("declined", `${labelOf(ctx, from)} doesn't have ${formatMoney(c, ctx.world.currency)}`);
  const lines: PostingLine[] = [
    { account: from, amount: -c },
    { account: to, amount: c },
  ];
  const out: LedgerEvent[] = [{ type: "post", lines, memo }];
  if (accountType(s, to) === "card") out.push({ type: "economy.card_paid", data: { account: to, cents: c } });
  out.push(txn(memo, lines));
  return asUnit(out);
}

// ---------------------------------------------------------------- events

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

const HISTORY = 40;
/** History lines and notes kept in each other person's money record (their money in the GM view). */
const PERSON_HISTORY = 12;
const PERSON_NOTES = 6;

/** A person's money record, created on first use: their latest history lines and private notes. */
function personRecord(state: WorldState, who: EntityId): { history: JsonValue[]; notes: JsonValue[] } {
  const people = sliceRecord(state, "economy", "people");
  const cur = objOf(own(people, who));
  const rec = { history: Array.isArray(cur.history) ? cur.history : [], notes: Array.isArray(cur.notes) ? cur.notes : [] };
  people[who] = rec;
  return rec;
}

const EVENTS: EventTypeDef<PackEvent>[] = [
  {
    type: "economy.anchor",
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "entity")) && typeof e.data.typical === "number" && typeof e.data.base === "number" ? null : reject("bad_event", "anchor needs entity, typical and base")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "anchors")[str(e, "entity")] = { band: str(e, "band"), typical: numOf(e.data.typical), base: numOf(e.data.base) };
    },
    describe: (e) => `${str(e, "entity")} is ${str(e, "band")}`,
    // An anchor is an assignment: in a record only the last per entity matters.
    coarsen: { key: (e) => str(e, "entity"), merge: (_a, b) => b },
  },
  {
    // A history line goes to everyone it touches: the POV's history (the Money panel) and each other
    // holder's own record (their money in the GM view), so another person's paydays and bills never
    // push the POV's lines out. A line that touches nobody's account stays in the POV's.
    type: "economy.txn",
    validate: () => null,
    apply: (e, state, ctx) => {
      const lines = Array.isArray(e.data.lines) ? e.data.lines : [];
      const entry = { at: state.clock, memo: str(e, "memo"), lines };
      const holders = [...new Set(lines.map((l) => strOf(own(state.entities, strOf(objOf(l).account))?.fields.owner)))].filter((who) => who !== "" && own(state.entities, who));
      const pov = ctx.world.pov;
      if (holders.length === 0 || holders.includes(pov)) {
        const s = mutableSlice(state, "economy");
        s.history = [...(Array.isArray(s.history) ? s.history.slice(-(HISTORY - 1)) : []), entry];
      }
      for (const who of holders) {
        if (who === pov) continue;
        const rec = personRecord(state, who);
        rec.history = [...rec.history.slice(-(PERSON_HISTORY - 1)), entry];
      }
    },
    describe: (e) => str(e, "memo"),
  },
  {
    // Someone else's payday, bill or decline note: kept in their own record for the GM view. It is
    // secret, so it never becomes a player line, and it isn't a signal, so it never stops or joins
    // the POV's timelapse.
    type: "economy.note",
    validate: (e, ctx) => (own(ctx.state.entities, str(e, "entity")) && str(e, "text") !== "" ? null : reject("bad_event", "a money note needs a person and its text")),
    apply: (e, state) => {
      const rec = personRecord(state, str(e, "entity"));
      rec.notes = [...rec.notes.slice(-(PERSON_NOTES - 1)), { at: state.clock, class: str(e, "class"), text: str(e, "text") }];
    },
    describe: (e) => str(e, "text"),
  },
  {
    // A price multiplier (festival, storm, scarcity) by category and place, until a time or until replaced.
    type: "economy.modifier",
    validate: (e) => (str(e, "id") !== "" && (e.data.mult === undefined || (typeof e.data.mult === "number" && e.data.mult > 0)) ? null : reject("bad_event", "a price modifier needs an id and a positive multiplier")),
    apply: (e, state) => {
      const mods = sliceRecord(state, "economy", "modifiers");
      if (typeof e.data.mult !== "number") delete mods[str(e, "id")];
      else mods[str(e, "id")] = { scope: strOf(e.data.scope, "all"), place: strOf(e.data.place), mult: e.data.mult, ...(typeof e.data.until === "number" ? { until: e.data.until } : {}) };
    },
    describe: (e) => (typeof e.data.mult === "number" ? `Prices ×${e.data.mult}` : "Prices back to normal"),
  },
  {
    type: "economy.statement",
    validate: (e, ctx) => (accountType(ctx.state, str(e, "account")) === "card" ? null : reject("bad_event", "statements are for cards")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "cards")[str(e, "account")] = { closing: numOf(e.data.closing), interest: numOf(e.data.interest), minimum: numOf(e.data.minimum), due: numOf(e.data.due), paid: 0, at: state.clock };
    },
    describe: (e, ctx) => `Statement: ${formatMoney(numOf(e.data.closing), ctx.world.currency)}, minimum ${formatMoney(numOf(e.data.minimum), ctx.world.currency)}`,
  },
  {
    type: "economy.card_paid",
    validate: (e, ctx) => (accountType(ctx.state, str(e, "account")) === "card" ? null : reject("bad_event", "card payments are for cards")),
    apply: (e, state) => {
      const cards = sliceRecord(state, "economy", "cards");
      const cur = objOf(cards[str(e, "account")]);
      if (Object.keys(cur).length > 0) cards[str(e, "account")] = { ...cur, paid: numOf(cur.paid) + numOf(e.data.cents) };
    },
    describe: (e, ctx) => `Card payment ${formatMoney(numOf(e.data.cents), ctx.world.currency)}`,
  },
  {
    type: "economy.price",
    validate: (e) => (typeof e.data.price === "number" && e.data.price > 0 && str(e, "symbol") !== "" ? null : reject("bad_event", "price needs a symbol and a positive price")),
    apply: (e, state) => {
      sliceRecord(state, "economy", "prices")[str(e, "symbol")] = numOf(e.data.price);
    },
    describe: (e) => `${str(e, "symbol")} at ${numOf(e.data.price).toFixed(2)}`,
  },
  { type: "economy.decline", validate: () => null, apply: () => undefined, describe: (e) => `Declined: ${str(e, "memo")}` },
];

// ---------------------------------------------------------------- processes

/** The day whose 09:00 falls inside the slot, or null: recurring money moves happen then. */
function nineOclock(ctx: ReadContext, slot: SlotInfo): { day: number; date: CalDate } | null {
  const cal = calendarOf(ctx.world);
  for (const day of [dateAt(cal, slot.start).dayIndex, dateAt(cal, slot.start).dayIndex + 1]) {
    const at = clockAt(cal, day, 540);
    if (at >= slot.start && at < slot.end) return { day, date: dateAt(cal, at) };
  }
  return null;
}

function lastDayOfMonth(ctx: ReadContext, day: number): boolean {
  const cal = calendarOf(ctx.world);
  return dateAt(cal, clockAt(cal, day + 1, 0)).day === 1;
}

const PERIODS: Record<string, number> = { weekly: 52, weekly_gig: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

/** A weekday given as a calendar weekday name ("Friday") or index; `fallback` otherwise. */
function weekdayIndex(ctx: ReadContext, v: JsonValue | undefined, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return fallback;
  const cal = calendarOf(ctx.world);
  const lower = v.toLowerCase();
  // Calendar names may be abbreviated ("Fri"): a full name ("Friday") matches by prefix.
  for (let i = 0; i < 14; i++) {
    const name = weekdayName(cal, i).toLowerCase();
    if (name === lower || (name.length >= 2 && lower.startsWith(name))) return i;
  }
  return fallback;
}

/** Weekly pay falls on `weekday` (the person's `payday`, default Friday); monthly pay on the month's last day. */
function isPayday(ctx: ReadContext, frequency: string, day: number, date: CalDate, weekday: number): boolean {
  const cal = calendarOf(ctx.world);
  switch (frequency) {
    case "weekly":
    case "weekly_gig":
      return date.weekday === weekday;
    case "biweekly":
      return date.weekday === weekday && Math.floor((cal.epochAbs + day) / 7) % 2 === 0;
    case "semimonthly":
      return date.day === 15 || lastDayOfMonth(ctx, day);
    case "monthly":
      return lastDayOfMonth(ctx, day);
    default:
      return false;
  }
}

/** The next day (day index after `from`) whose day of month is `dom`, clamped to short months. */
function nextMonthDay(ctx: ReadContext, from: number, dom: number): number {
  const cal = calendarOf(ctx.world);
  for (let d = from + 1; d <= from + 62; d++) {
    const date = dateAt(cal, clockAt(cal, d, 0));
    if (date.day === dom || (date.day < dom && lastDayOfMonth(ctx, d))) return d;
  }
  return from + 25;
}

/** `autopay` on a card or loan: "none", "minimum", "full", or "[minimum|full] from <account>" (a loan's "from <account>" pays the payment). */
function autopayOf(s: Readonly<WorldState>, raw: JsonValue | undefined, owner: EntityId, fallback: "none" | "full"): { mode: "none" | "minimum" | "full"; from: EntityId | null } {
  const m = /^\s*(minimum|full|none)?\s*(?:from\s+(\S+))?\s*$/i.exec(typeof raw === "string" ? raw : "");
  const named = m?.[2];
  const word = m?.[1]?.toLowerCase();
  const mode = word === "minimum" || word === "full" || word === "none" ? word : named ? "full" : fallback;
  const from = named && own(s.entities, named) ? named : (ofType(s, owner, "checking")[0] ?? null);
  return { mode, from };
}

function signal(cls: "bill" | "decline", text: string, who: EntityId): LedgerEvent {
  return { type: ENGINE_EVENTS.signal, data: { class: cls, text, entity: who, visibility: "known_by" } };
}

/**
 * What the recurring money processes record. Every posting stays, and so does every history line
 * that touches an account in the world: lines are filed by holder (`economy.txn`), the POV's for the
 * Money panel and everyone else's for the GM view. Payday, bill and decline notes stay signals only
 * for the POV, where they can interrupt a timelapse and reach the Montage; for anyone else who holds
 * accounts they become a secret `economy.note` in their own record, which is also all a declined
 * bill of theirs leaves. Someone whose money is a band alone (no accounts) keeps no lines or notes.
 */
function noted(ctx: ReadContext, events: LedgerEvent[]): LedgerEvent[] {
  const pov = ctx.world.pov;
  return events.flatMap((e): LedgerEvent[] => {
    if (!("data" in e)) return [e];
    if (e.type === "economy.txn") return Array.isArray(e.data.lines) && e.data.lines.some((l) => own(ctx.state.entities, strOf(objOf(l).account))) ? [e] : [];
    if (e.type === ENGINE_EVENTS.signal && typeof e.data.entity === "string" && e.data.entity !== pov) return hasLedger(ctx.state, e.data.entity) ? [{ type: "economy.note", data: { entity: e.data.entity, class: strOf(e.data.class), text: strOf(e.data.text), visibility: "secret" } }] : [];
    if (e.type === "economy.decline" && e.data.payer !== pov) return [];
    return [e];
  });
}

/**
 * A process step's own view of the books: each payment it makes is posted to a copy of the
 * balances, so the next one in the same step sees it. Two bills due the same morning can't both
 * spend what covers only one (the fold's funds guard would drop the second).
 */
function runningBooks(base: ReadContext): { ctx(): ReadContext; post(events: readonly LedgerEvent[]): void } {
  const state: WorldState = { ...base.state, accounts: { ...base.state.accounts } };
  let current = base;
  return {
    ctx: () => current,
    post(events) {
      const posts = events.filter((e): e is PostEvent => e.type === "post");
      if (posts.length === 0) return;
      for (const e of posts) for (const l of e.lines) state.accounts[l.account] = (own(state.accounts, l.account) ?? 0) + l.amount;
      current = base.registry.context(base.world, state);
    },
  };
}

function people(ctx: ReadContext): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person"));
}

/**
 * Opens the authored accounts of everyone the recurring money processes act for (Money 3+): in the
 * first slot holding 09:00 that steps them at that level, their opening balances post as the same
 * `materialize` event a view would record. Their bills and living costs then draw on the money the
 * author gave them, not only on what payroll has paid in since the chat began.
 */
function openAccounts(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  if (!nineOclock(ctx, slot)) return [];
  const version = pinnedVersion(ctx.world, ctx.registry, "money");
  if (typeof version !== "number") return [];
  const out: LedgerEvent[] = [];
  for (const who of people(ctx)) {
    if (ctx.levelOf(who, "money") < 3 || isMaterialized(ctx.state, who, "money")) continue;
    const events = openingBalances(who, ctx);
    if (events.length > 0) out.push({ type: "materialize", entity: who, domain: "money", generatorVersion: version, tablesRevision: tablesRevision(ctx.world), events });
  }
  return out;
}

function payroll(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at) return [];
  const out: LedgerEvent[] = [];
  for (const who of people(ctx)) {
    const level = ctx.levelOf(who, "money");
    if (level < 3) continue;
    const e = own(ctx.state.entities, who);
    if (!e) continue;
    const occ = rowOf(ctx, "economy.occupations", strOf(e.fields.occupation));
    const hourly = numOf(e.fields.hourly_cents);
    const annual = numOf(e.fields.salary_cents, numOf(e.fields.annual_income_cents, numOf(occ?.typical_earnings_cents_per_year)));
    if (hourly <= 0 && annual <= 0) continue;
    const frequency = strOf(e.fields.pay_frequency, strOf(occ?.pay_frequency, "monthly"));
    const periods = own(PERIODS, frequency);
    if (!periods || !isPayday(ctx, frequency, at.day, at.date, weekdayIndex(ctx, e.fields.payday, 5))) continue;
    // Hourly pay: rate × weekly hours × the period's weeks; otherwise the annual figure over the year's pay periods.
    const gross = Math.round(hourly > 0 ? hourly * numOf(e.fields.hours_per_week, 40) * (52 / periods) : annual / periods);
    if (gross <= 0) continue;
    const w = withholding(ctx, who);
    const federal = Math.round((gross * w.federalPct) / 100);
    const state = Math.round((gross * w.statePct) / 100);
    const net = gross - federal - state;
    const employer = external(typeof e.fields.employer === "string" ? `employer:${e.fields.employer}` : `employer:${strOf(e.fields.occupation)}`);
    const target = strOf(e.fields.deposit_to);
    const deposit = (target && own(ctx.state.entities, target)?.fields.owner === who && accountType(ctx.state, target) ? target : undefined) ?? ofType(ctx.state, who, "checking")[0] ?? ofType(ctx.state, who, "cash")[0];
    const into = deposit ?? external(who);
    const lines: PostingLine[] =
      level >= 4
        ? [
            { account: employer, amount: -gross },
            { account: into, amount: net },
            { account: external("tax:federal"), amount: federal },
            { account: external("tax:state"), amount: state },
          ].filter((l) => l.amount !== 0)
        : [
            { account: employer, amount: -net },
            { account: into, amount: net },
          ];
    const money = (c: number): string => formatMoney(c, ctx.world.currency);
    const memo = level >= 4 ? `Payroll: ${money(gross)} gross, ${money(federal + state)} withheld` : "Payroll";
    out.push(...asUnit([{ type: "post", lines, memo }, ...(deposit ? [] : l1Move(ctx.state, who, net)), txn(memo, lines)]));
    out.push(signal("bill", `Payday: ${money(net)} net${level >= 4 ? ` (${money(gross)} gross)` : ""}.`, who));
  }
  return out;
}

/**
 * Whether a bill is a loan payment the loan's own autopay already makes: it names the loan (`to`),
 * or its payee is the lender and its amount the loan's payment. Templates list both.
 */
function paysAutopayLoan(state: Readonly<WorldState>, who: EntityId, b: JsonObject): boolean {
  return ofType(state, who, "loan").some((loan) => {
    const f = own(state.entities, loan)?.fields;
    if (!f || strOf(f.autopay) === "") return false;
    if (strOf(b.to) === loan) return true;
    return strOf(b.payee) !== "" && strOf(b.payee) === strOf(f.institution) && Math.round(numOf(b.amountCents)) === Math.round(numOf(f.payment));
  });
}

/**
 * Bills fall due at 09:00 on their day (Money 3+). A bill paid to someone in the world (a person,
 * or anything holding accounts) lands in their deposit account; any other payee is an outside
 * counterparty. Each payment sees the ones before it the same morning.
 */
function bills(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at) return [];
  const out: LedgerEvent[] = [];
  const books = runningBooks(ctx);
  for (const who of people(ctx)) {
    if (ctx.levelOf(who, "money") < 3) continue;
    const list = own(ctx.state.entities, who)?.fields.bills;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const b = objOf(raw);
      const every = strOf(b.every, "month");
      let due: boolean;
      if (every === "week") due = at.date.weekday === weekdayIndex(ctx, b.day, 1);
      else {
        const day = numOf(b.day, 1);
        const onDay = at.date.day === day || (day > 28 && lastDayOfMonth(ctx, at.day) && at.date.day < day);
        due = every === "year" ? onDay && at.date.month === numOf(b.month, 1) : onDay;
      }
      if (!due || paysAutopayLoan(ctx.state, who, b)) continue;
      const label = strOf(b.label, "Bill");
      const cents = Math.round(numOf(b.amountCents));
      const from = strOf(b.from);
      const payee = strOf(b.payee);
      const held = own(ctx.state.entities, payee);
      const to: ChargeOptions = held && (kindIs(ctx.registry, ctx.world, held.kind, "person") || hasLedger(ctx.state, payee)) ? { payee } : { counterparty: payee || label.toLowerCase().replace(/\W+/g, "_") };
      const paid = charge(books.ctx(), who, cents, label, { ...to, ...(from ? { source: from } : { method: "account" }) });
      if (isRejection(paid)) out.push({ type: "economy.decline", data: { payer: who, cents, memo: label, reason: paid.reason } }, signal("decline", `${label} (${formatMoney(cents, ctx.world.currency)}) was declined.`, who));
      else {
        books.post(paid);
        out.push(...paid, signal("bill", `${label}: ${formatMoney(cents, ctx.world.currency)} paid.`, who));
      }
    }
  }
  return out;
}

/**
 * Everyday living costs by wealth band, a week at a time, for the Modern US data: one adult's weekly
 * grocery basket (the thrifty, moderate or liberal plan) times the share of a week's everyday
 * spending it stands for at that band, which grows with the band (eating out, getting about,
 * household and personal things). Housing, utilities and the like are the person's bills.
 */
const LIVING_COSTS: Record<string, { basket: string; times: number }> = {
  broke: { basket: "basket_person_thrifty", times: 1 },
  poor: { basket: "basket_person_thrifty", times: 1.5 },
  modest: { basket: "basket_person_moderate", times: 2 },
  comfortable: { basket: "basket_person_moderate", times: 3 },
  rich: { basket: "basket_person_liberal", times: 4 },
  wealthy: { basket: "basket_person_liberal", times: 8 },
};

/**
 * A week of living costs for a wealth band: the world's own `livingCosts` (economy config: a weekly
 * amount per band, in its minor units) when it sets them, else the Modern US default, priced from
 * the catalog's grocery baskets at the region's cost of living. Null when neither prices the band:
 * a world whose catalog has no baskets and that sets none charges no living costs.
 */
function livingCost(ctx: ReadContext, band: string): number | null {
  const authored = objOf(objOf(ctx.world.packs.economy?.config).livingCosts);
  if (Object.keys(authored).length > 0) {
    const weekly = numOf(own(authored, band));
    return weekly > 0 ? Math.round(weekly) : null;
  }
  const def = own(LIVING_COSTS, band);
  const basket = def ? priceOf(ctx, { catalog: def.basket, place: null }) : null;
  return def && basket ? Math.round(basket.cents * def.times) : null;
}

/**
 * Living costs (Money 3+): every Monday (the calendar's weekday 1) at 09:00, each person other than
 * the POV who holds accounts pays a week of everyday spending for their current wealth band to the
 * outside economy. Balances that payroll fills also drain, and spending follows what they have.
 * The POV's spending is the player's own: purchases and bills.
 */
function living(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at || at.date.weekday !== 1) return [];
  const out: LedgerEvent[] = [];
  for (const who of people(ctx)) {
    if (who === ctx.world.pov || ctx.levelOf(who, "money") < 3 || !hasLedger(ctx.state, who)) continue;
    const cents = livingCost(ctx, wealthOf(ctx.state, who));
    if (cents === null) continue;
    const paid = charge(ctx, who, cents, "Living costs", {});
    if (isRejection(paid)) out.push(signal("decline", `Living costs (${formatMoney(cents, ctx.world.currency)}) were declined.`, who));
    else out.push(...paid);
  }
  return out;
}

function cards(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at) return [];
  const out: LedgerEvent[] = [];
  const s = ctx.state;
  const statements = objOf(sliceOf(s, "economy").cards);
  for (const card of Object.keys(s.entities).sort()) {
    if (accountType(s, card) !== "card") continue;
    const e = own(s.entities, card);
    const owner = strOf(e?.fields.owner);
    if (!e || !own(s.entities, owner)) continue;
    const level = ctx.levelOf(owner, "money");
    if (level < 3) continue;
    const owed = -balance(s, card);
    const prev = objOf(statements[card]);
    const ap = autopayOf(s, e.fields.autopay, owner, "none");
    const autopay = ap.mode;
    const checking = ap.from ?? undefined;
    if (at.date.day === numOf(e.fields.statement_day, 1)) {
      if (level >= 4) {
        // Grace period: no interest when the previous statement was paid in full; an opening balance counts as carried.
        const carried = Object.keys(prev).length === 0 ? owed > 0 : numOf(prev.paid) < numOf(prev.closing);
        const interest = carried && owed > 0 ? Math.round((owed * numOf(e.fields.apr_pct)) / 100 / 12) : 0;
        if (interest > 0) {
          const lines: PostingLine[] = [
            { account: card, amount: -interest },
            { account: external(`bank:${strOf(e.fields.institution, "card")}`), amount: interest },
          ];
          out.push(...asUnit([{ type: "post", lines, memo: `${e.name} interest` }, txn(`${e.name} interest`, lines)]));
        }
        const closing = owed + interest;
        if (closing > 0) {
          const minimum = Math.min(closing, Math.max(numOf(e.fields.min_floor, 3500), Math.ceil((owed * numOf(e.fields.min_pct, 1)) / 100 + interest)));
          const due = clockAt(calendarOf(ctx.world), typeof e.fields.due_day === "number" ? nextMonthDay(ctx, at.day, e.fields.due_day) : at.day + 25, 540);
          out.push({ type: "economy.statement", data: { account: card, closing, interest, minimum, due } });
          const money = (c: number): string => formatMoney(c, ctx.world.currency);
          out.push(signal("bill", `${e.name} statement: ${money(closing)}${interest > 0 ? ` incl. ${money(interest)} interest` : ""}; minimum ${money(minimum)}.`, owner));
        }
      } else if (autopay !== "none" && owed > 0 && checking) {
        // Level 3: autopay settles the balance on the statement day.
        const paid = move(ctx, checking, card, owed, `${e.name} autopay`);
        if (isRejection(paid)) out.push(signal("decline", `${e.name} autopay was declined.`, owner));
        else out.push(...paid);
      }
    }
    if (level >= 4 && Object.keys(prev).length > 0) {
      const dueDay = dateAt(calendarOf(ctx.world), numOf(prev.due)).dayIndex;
      if (dueDay === at.day) {
        const left = numOf(prev.closing) - numOf(prev.paid);
        const minimumLeft = numOf(prev.minimum) - numOf(prev.paid);
        const amount = autopay === "full" ? left : autopay === "minimum" ? minimumLeft : 0;
        if (amount > 0 && checking) {
          const paid = move(ctx, checking, card, amount, `${e.name} autopay`);
          if (isRejection(paid)) out.push(signal("decline", `${e.name} autopay of ${formatMoney(amount, ctx.world.currency)} was declined.`, owner));
          else out.push(...paid);
        } else if (minimumLeft > 0) out.push(signal("bill", `${e.name} minimum payment of ${formatMoney(minimumLeft, ctx.world.currency)} is due today.`, owner));
      }
    }
  }
  return out;
}

function banking(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at) return [];
  const out: LedgerEvent[] = [];
  const s = ctx.state;
  for (const id of Object.keys(s.entities).sort()) {
    const t = accountType(s, id);
    const e = own(s.entities, id);
    const owner = strOf(e?.fields.owner);
    if (!e || !t || !own(s.entities, owner) || ctx.levelOf(owner, "money") < 4) continue;
    if (t === "savings" && at.date.day === 1) {
      const interest = Math.round((balance(s, id) * numOf(e.fields.apy_pct)) / 100 / 12);
      if (interest > 0) {
        const lines: PostingLine[] = [
          { account: external(`bank:${strOf(e.fields.institution, "bank")}`), amount: -interest },
          { account: id, amount: interest },
        ];
        out.push(...asUnit([{ type: "post", lines, memo: `${e.name} interest` }, txn(`${e.name} interest`, lines)]));
      }
    }
    if (t === "loan" && at.date.day === numOf(e.fields.due_day, numOf(e.fields.statement_day, 1))) {
      const owed = -balance(s, id);
      if (owed <= 0) continue;
      const bank = external(`bank:${strOf(e.fields.institution, "lender")}`);
      const rate = numOf(e.fields.apr_pct) / 100 / 12;
      const interest = Math.round(owed * rate);
      // The authored payment, else the amortized payment over the remaining months.
      const months = numOf(e.fields.remaining_months);
      const amortized = months > 0 ? (rate > 0 ? (owed * rate) / (1 - Math.pow(1 + rate, -months)) : owed / months) : 0;
      const payment = Math.min(owed + interest, Math.round(numOf(e.fields.payment, amortized)));
      if (interest > 0) {
        const lines: PostingLine[] = [
          { account: id, amount: -interest },
          { account: bank, amount: interest },
        ];
        out.push(...asUnit([{ type: "post", lines, memo: `${e.name} interest` }, txn(`${e.name} interest`, lines)]));
      }
      const ap = autopayOf(s, e.fields.autopay, owner, "full");
      const checking = ap.mode === "none" ? undefined : (ap.from ?? undefined);
      if (payment > 0 && ap.mode === "none") out.push(signal("bill", `${e.name} payment of ${formatMoney(payment, ctx.world.currency)} is due today.`, owner));
      if (payment > 0 && checking) {
        if (available(s, checking) < payment) out.push(signal("decline", `${e.name} payment of ${formatMoney(payment, ctx.world.currency)} bounced.`, owner));
        else {
          const lines: PostingLine[] = [
            { account: checking, amount: -payment },
            { account: id, amount: payment },
          ];
          out.push(...asUnit([{ type: "post", lines, memo: `${e.name} payment` }, txn(`${e.name} payment`, lines)]), signal("bill", `${e.name} payment: ${formatMoney(payment, ctx.world.currency)}.`, owner));
        }
      }
    }
  }
  return out;
}

/** Geometric Brownian motion per trading day, with a standard normal from the process seed. */
function markets(slot: SlotInfo, ctx: ReadContext, rng: (entity: EntityId) => Rng): LedgerEvent[] {
  const at = nineOclock(ctx, slot);
  if (!at || at.date.weekday === 0 || at.date.weekday === 6) return [];
  const symbols = new Set<string>();
  for (const id of Object.keys(ctx.state.entities)) if (accountType(ctx.state, id) === "brokerage") symbols.add(strOf(own(ctx.state.entities, id)?.fields.symbol, DEFAULT_SYMBOL));
  const recipe = objOf(own(objOf(ctx.tables.get("economy.finance")?.rows.investing?.values), DEFAULT_SYMBOL));
  const mu = numOf(recipe.annual_return_arithmetic_pct, 11) / 100;
  const sigma = numOf(recipe.annual_volatility_pct, 16) / 100;
  const dt = 1 / 252;
  const out: LedgerEvent[] = [];
  for (const symbol of [...symbols].sort()) {
    const g = rng(`symbol:${symbol}`);
    const u1 = Math.max(Number.MIN_VALUE, g.next());
    const u2 = g.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const price = priceOfSymbol(ctx.state, symbol) * Math.exp((mu - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * z);
    out.push({ type: "economy.price", data: { symbol, price: Math.round(price * 10000) / 10000 } });
  }
  return out;
}

// ---------------------------------------------------------------- materialization

/** Purchases in these categories become gear items. */
const PHYSICAL = new Set(["groceries_staples", "clothing", "electronics", "tools_hardware", "household_goods", "personal_care", "gifts", "alcohol", "medical"]);

function logUniform(rng: Rng, lo: number, hi: number): number {
  const a = Math.log(Math.max(1, lo));
  const b = Math.log(Math.max(2, hi));
  return Math.exp(a + (b - a) * rng.next());
}

/**
 * The posting of an entity's authored opening balances, from its own external account; none when it
 * holds no account with an opening amount. Materialization records it once (from Money 1, so the
 * band a level-1 view shows reflects it), and the money processes open the accounts of the people
 * they act for (`openAccounts`). It draws no randomness, so both record the same event.
 */
function openingBalances(entity: EntityId, ctx: ReadContext): LedgerEvent[] {
  const s = ctx.state;
  const lines: PostingLine[] = accountsOf(s, entity)
    .filter((id) => typeof own(s.entities, id)?.fields.opening === "number" && numOf(own(s.entities, id)?.fields.opening) !== 0)
    .map((id) => ({ account: id, amount: Math.round(numOf(own(s.entities, id)?.fields.opening)) }));
  if (lines.length === 0) return [];
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const all = total === 0 ? lines : [...lines, { account: external(entity), amount: -total }];
  return all.length < 2 ? [] : [{ type: "post", lines: all, memo: "Opening balances" }];
}

function materializeMoney(entity: EntityId, ctx: ReadContext, rng: Rng): LedgerEvent[] {
  const s = ctx.state;
  const e = own(s.entities, entity);
  const level = e ? ctx.levelOf(entity, "money") : 0;
  if (!e || level < 1) return [];
  if (accountsOf(s, entity).length > 0) return openingBalances(entity, ctx);
  if (level < 2 || !kindIs(ctx.registry, ctx.world, e.kind, "person")) return [];
  const ext = external(entity);
  // Sample a net worth inside the current band (its level-1 representation), then split it.
  const band = bandByLabel(wealthOf(s, entity));
  const lo = Number.isFinite(band.min) ? Math.max(band.min, 0) : 0;
  const hi = Number.isFinite(band.max) ? band.max - 1 : band.typical * 4;
  const worth = Math.round(logUniform(rng, Math.max(lo, 500), Math.max(hi, 1000)));
  const cash = Math.min(worth, Math.round(Math.min(50_000, Math.max(2_000, worth * (0.01 + rng.next() * 0.02)))));
  const rest = worth - cash;
  const checkingShare = worth < 2_000_000 ? 0.4 + rng.next() * 0.4 : 0.15 + rng.next() * 0.2;
  const checking = Math.round(rest * checkingShare);
  const savings = rest - checking;
  const limit = Math.round(Math.min(2_500_000, Math.max(50_000, band.typical * 0.3)) / 10_000) * 10_000;
  const owed = Math.round(limit * rng.next() * 0.25);
  const wallet = Object.keys(s.entities)
    .sort()
    .find((id) => own(s.entities, id)?.fields.owner === entity && (own(s.entities, id)?.fields.catalog === "wallet" || /wallet|purse/i.test(own(s.entities, id)?.name ?? "")));
  const mk = (suffix: string, name: string, fields: JsonObject, inWallet = false): EntityDef => ({ id: `${entity}:${suffix}`, kind: "account", name, tier: "background", fields: { owner: entity, ...fields }, relations: inWallet && wallet ? [{ type: "in", to: wallet }] : [] });
  const accounts = [
    mk("cash", "Cash", { type: "cash" }, true),
    mk("checking", "Checking", { type: "checking", institution: "Local bank" }),
    mk("savings", "Savings", { type: "savings", institution: "Local bank", apy_pct: 0.4 }),
    mk("card", "Credit card", { type: "card", limit, apr_pct: 22, statement_day: 1 + rng.int(0, 27), due_days: 25, autopay: "minimum" }),
  ];
  const out: LedgerEvent[] = accounts.map((entityDef) => ({ type: "spawn", entity: entityDef }));
  const lines: PostingLine[] = [
    { account: `${entity}:cash`, amount: cash },
    { account: `${entity}:checking`, amount: checking },
    { account: `${entity}:savings`, amount: savings },
    { account: `${entity}:card`, amount: -owed },
  ].filter((l) => l.amount !== 0);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  if (lines.length > 0) out.push({ type: "post", lines: [...lines, { account: ext, amount: -total }], memo: "Opening balances" });
  return out;
}

// ---------------------------------------------------------------- pack

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Every other person's money at their own Money level, for the GM view (`core.gm`). */
    "economy.people_money": (ctx: ReadContext) => GmMoney[];
  }
}

function amountOf(v: JsonValue | undefined): number {
  return typeof v === "number" ? Math.round(v) : NaN;
}

/** An `economy.buy`'s price, the catalog row it is priced as, and a narrated price the charge doesn't match. */
interface Quote {
  price: Price;
  row: string | null;
  narrated?: ChargeOptions["narrated"];
}

/**
 * What an `economy.buy` of `qty` costs (DESIGN §9.5). A price the player set on a chip (`exact`) is
 * charged as set. Otherwise the item's catalog row prices it: the row it names by id, or the row
 * that names it (`matchCatalog`); in lenient worlds a narrated price inside the row's band is
 * taken and one outside it clamped. Without a row, the stated price: the player's own (`stated`)
 * in full, the narration's alone capped at the world's `unpricedCap`. Then the band of the category
 * the purchase gives, or that the item names. Null when nothing prices it.
 */
function quote(ctx: EffectContext, args: JsonObject, payer: EntityId, qty: number): Quote | null {
  const place = placeOfEntity(ctx.state, payer);
  const named = strOf(args.item);
  const given = strOf(args.category);
  const row = named === "" ? null : rowOf(ctx, "economy.catalog", named) ? named : matchCatalog(ctx, named, place, given);
  const category = given !== "" ? given : !row && rowOf(ctx, "economy.categories", named) ? named : "";
  const said = typeof args.price === "number" && args.price > 0 ? Math.round(args.price) : undefined;
  const rowDef = row ? rowOf(ctx, "economy.catalog", row) : undefined;
  // A price taken as it is: the item keeps its row's name and category, else its own words and the category it gives.
  const asIs = (cents: number): Price => ({ cents, unitCents: Math.round(cents / qty), band: { min: cents, typical: cents, max: cents }, source: row ? "catalog" : "category", clamped: false, name: strOf(rowDef?.name, named || "something"), category: rowDef ? strOf(rowDef.category) : rowOf(ctx, "economy.categories", category) ? category : "misc" });
  if (said !== undefined && args.exact === true) return { price: asIs(said), row };
  if (row) {
    const price = priceOf(ctx, { catalog: row, qty, place, ...(said !== undefined ? { narrated: said } : {}) }, ctx.rng);
    if (price) return { price, row, ...(price.clamped && said !== undefined ? { narrated: { cents: said, limited: "band" as const } } : {}) };
  }
  if (said !== undefined) {
    const cents = Math.min(said, args.stated === true ? Infinity : unpricedCap(ctx.world));
    return { price: { ...asIs(cents), clamped: cents !== said }, row: null, ...(cents !== said ? { narrated: { cents: said, limited: "cap" as const } } : {}) };
  }
  const banded = category !== "" ? priceOf(ctx, { category, qty, place }, ctx.rng) : null;
  return banded ? { price: banded, row: null } : null;
}

export const economyPack: PackDef = {
  id: "economy",
  label: "Economy",
  version: 1,
  domain: "money",
  requires: ["space"],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });
    r.kind(ACCOUNT);
    r.kind(BUSINESS);
    for (const def of EVENTS) r.event(def);

    r.service("economy.charge", charge);
    r.service("economy.transfer", transfer);
    r.service("economy.lose", loseWith);
    r.service("economy.set_cash", setCash);
    r.service("economy.reprice", reprice);
    r.query("wealth", (ctx, who) => wealthOf(ctx.state, who));
    r.query("can_afford", (ctx, who, cents) => {
      const level = ctx.levelOf(who, "money");
      if (level === 0) return true;
      return hasLedger(ctx.state, who) ? (level >= 2 ? spendable(ctx.state, who) >= cents : netWorth(ctx.state, who) >= cents) : notional(ctx.state, who) >= cents;
    });
    r.query("economy.net_worth", (ctx, who) => (hasLedger(ctx.state, who) ? netWorth(ctx.state, who) : null));
    r.query("economy.price", (ctx, ref, rng) => priceOf(ctx, ref, rng));
    r.query("economy.bought_band", (ctx, name, qty, who) => {
      const ref = boughtRef(ctx, name);
      const price = ref ? priceOf(ctx, { ...ref, place: placeOfEntity(ctx.state, who) }) : null;
      return price ? { min: price.band.min * qty, max: price.band.max * qty } : null;
    });

    r.query("economy.offers", offersAt);
    r.query("economy.item_choices", (ctx, text, who) => {
      const place = placeOfEntity(ctx.state, who);
      const item = itemName(text);
      const said = new Set(item ? [...item.words, ...(item.trailing?.words ?? [])] : []);
      const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
      const near = Object.keys(rows)
        .sort()
        .map((id) => ({ id, shared: [...catalogName(id, strOf(rows[id]?.name, id)).words].filter((w) => said.has(w)).length }))
        .filter((r) => r.shared > 0)
        .sort((a, b) => b.shared - a.shared)
        .slice(0, 6);
      const out: Offer[] = [];
      for (const { id } of near) {
        const price = priceOf(ctx, { catalog: id, place });
        if (price) out.push({ item: id, name: price.name, cents: price.unitCents, category: price.category });
      }
      for (const offer of offersAtPlace(ctx, place)) if (!out.some((o) => o.item === offer.item)) out.push(offer);
      return out.slice(0, 12);
    });
    // Ledger 1.10: a posting folds only if its owner can afford it (the fold-time twin of pickSource's declines).
    r.guard({ type: "post", validate: (e, ctx) => (e.type === "post" ? postGuard(ctx, e.lines) : null) });
    r.formula("wealth", (ctx, who) => wealthOf(ctx.state, String(who ?? ctx.world.pov)));
    r.formula("can_afford", (ctx, who, cents) => ctx.query("can_afford")(ctx, String(who ?? ctx.world.pov), Number(cents ?? 0)));
    r.formula("net_worth", (ctx, who) => netWorth(ctx.state, String(who ?? ctx.world.pov)));
    r.formula("balance", (ctx, account) => balance(ctx.state, String(account ?? "")));
    r.formula("price", (ctx, item) => priceOf(ctx, { catalog: String(item ?? "") })?.cents ?? priceOf(ctx, { category: String(item ?? "") })?.cents ?? 0);

    r.effect({
      type: "economy.buy",
      resolve(args, ctx) {
        const payer = strOf(args.payer) || ctx.world.pov;
        const qty = typeof args.qty === "number" && args.qty > 0 ? args.qty : 1;
        const priced = quote(ctx, args, payer, qty);
        if (!priced) return reject("unpriced", `no price for ${labelOf(ctx, strOf(args.item) || strOf(args.category))}`);
        const { price, row } = priced;
        const name = strOf(args.name) || price.name;
        // "Pay another way" retries name a method (savings, card, checking, cash) or a specific account
        // (`from`); the Buy action passes the player's words ("with my card"). A said kind of account the
        // payer doesn't have falls back: a card to checking (a debit card), anything else to auto.
        const said = payMethodOf(strOf(args.method));
        const has = (t: AccountType): boolean => ofType(ctx.state, payer, t).length > 0;
        const method = said === "auto" || said === "account" || has(said) ? said : said === "card" && has("checking") ? "checking" : "auto";
        const paid = charge(ctx, payer, price.cents, `Bought ${name}${qty > 1 ? ` ×${qty}` : ""}`, { method, category: price.category, ...(priced.narrated ? { narrated: priced.narrated } : {}), ...(typeof args.payee === "string" ? { payee: args.payee } : {}), ...(strOf(args.from) !== "" ? { source: strOf(args.from) } : {}) });
        if (isRejection(paid)) return paid;
        const out = [...paid];
        const spawn = PHYSICAL.has(price.category) && args.keep !== false ? optionalService(ctx, "gear.spawn") : null;
        if (spawn && ctx.levelOf(payer, "gear") >= 1) {
          const made = spawn(ctx, { name, owner: payer, holder: payer, ...(row ? { catalog: row } : {}), category: price.category, qty, salt: `buy:${ctx.rng.seed}` });
          if (Array.isArray(made)) out.push(...made);
        }
        return out;
      },
    });
    r.effect({ type: "economy.transfer", resolve: (a, ctx) => transfer(ctx, strOf(a.from) || ctx.world.pov, strOf(a.to), amountOf(a.cents), strOf(a.memo, "Payment"), typeof a.method === "string" ? payMethodOf(a.method) : "auto") });
    r.effect({ type: "economy.move", resolve: (a, ctx) => move(ctx, strOf(a.from), strOf(a.to), amountOf(a.cents), strOf(a.memo, "Transfer")) });
    // Template `price_modifier`: `percent` (+25 = 25 % dearer) for a `scope` (a category, or all) at a `place`, for `minutes` or until cleared (`percent: 0` or `clear`).
    r.effect({
      type: "economy.price_modifier",
      resolve(a, ctx) {
        const scope = strOf(a.scope, "all");
        const place = strOf(a.place);
        if (place !== "" && !own(ctx.world.places, place)) return reject("missing_place", `no place ${labelOf(ctx, place)}`);
        const id = strOf(a.id) || `${place || "*"}:${scope}`;
        const percent = numOf(a.percent);
        if (a.clear === true || percent === 0) return [{ type: "economy.modifier", data: { id } }];
        if (percent <= -100) return reject("bad_amount", "a price modifier can't make things free");
        const minutes = numOf(a.minutes);
        return [{ type: "economy.modifier", data: { id, scope, place, mult: Math.round((1 + percent / 100) * 10000) / 10000, ...(minutes > 0 ? { until: ctx.state.clock + Math.round(minutes) } : {}) } }];
      },
    });
    // Cash lost or stolen with what holds it (a wallet, a purse): lost cash goes to the outside world, stolen cash to the thief.
    r.effect({ type: "economy.lose", resolve: (a, ctx) => loseWith(ctx, strOf(a.item), strOf(a.thief) || undefined) });
    r.effect({
      type: "economy.pay_card",
      resolve(a, ctx) {
        const card = strOf(a.card);
        const kind = accountType(ctx.state, card);
        if (kind !== "card" && kind !== "loan") return reject("not_a_liability", `${labelOf(ctx, card)} isn't a card or a loan`);
        const owner = strOf(own(ctx.state.entities, card)?.fields.owner);
        const from = strOf(a.from) || ofType(ctx.state, owner, "checking")[0] || "";
        const cents = typeof a.cents === "number" ? Math.round(a.cents) : -balance(ctx.state, card);
        return move(ctx, from, card, cents, `${own(ctx.state.entities, card)?.name ?? "Card"} payment`);
      },
    });
    r.effect({
      type: "economy.invest",
      resolve(a, ctx) {
        const owner = strOf(a.owner) || ctx.world.pov;
        const account = ofType(ctx.state, owner, "brokerage")[0];
        const checking = ofType(ctx.state, owner, "checking")[0];
        if (!account || !checking) return reject("no_account", "investing needs a brokerage and a checking account");
        if (ctx.levelOf(owner, "money") < 4) return reject("level", "investments are tracked at Money level 4");
        const cents = amountOf(a.cents);
        if (!(cents > 0)) return reject("bad_amount", "the amount must be positive");
        const symbol = strOf(own(ctx.state.entities, account)?.fields.symbol, DEFAULT_SYMBOL);
        const price = priceOfSymbol(ctx.state, symbol);
        const units = numOf(own(ctx.state.entities, account)?.fields.units);
        const sell = a.sell === true;
        const delta = Math.round(((sell ? -cents : cents) / 100 / price) * 1e6) / 1e6;
        if (sell && units + delta < -1e-9) return reject("declined", "not enough holdings to sell");
        if (!sell && available(ctx.state, checking) < cents) return reject("declined", "not enough in checking");
        const lines: PostingLine[] = sell
          ? [
              { account: `${MARKET}:${symbol}`, amount: -cents },
              { account: checking, amount: cents },
            ]
          : [
              { account: checking, amount: -cents },
              { account: `${MARKET}:${symbol}`, amount: cents },
            ];
        return asUnit([{ type: "post", lines, memo: sell ? `Sold ${symbol}` : `Bought ${symbol}` }, { type: "add", entity: account, field: "units", delta }, txn(sell ? "Sold investments" : "Invested", lines)]);
      },
    });

    r.action({ id: "buy", label: "Buy", pack: "economy", params: { item: { type: "text", label: "Item or category" }, qty: { type: "number", optional: true }, price: { type: "money", optional: true, label: "Stated price" }, method: { type: "text", optional: true, label: "Paid with (cash, card, checking or savings)" } }, requires: ["level.money >= 1"], outcomes: { default: [{ type: "economy.buy", args: { payer: "self", item: "=item", qty: "=qty", price: "=price", method: "=params.method", stated: true } }] }, duration: "5", lexicon: ["buy", "purchase", "order", "pick up a"], observable: "pays for something" });
    r.action({ id: "pay", label: "Pay", pack: "economy", params: { to: { type: "ref", ref: "person" }, amount: { type: "money" } }, requires: ["amount > 0", "can_afford(self, amount)"], outcomes: { default: [{ type: "economy.transfer", args: { from: "self", to: "to", cents: "=amount", memo: "Payment" } }] }, duration: "1", lexicon: ["pay", "give money", "send money", "venmo"], observable: "pays someone" });
    r.action({ id: "move_money", label: "Transfer between accounts", pack: "economy", params: { from: { type: "ref", ref: "account" }, to: { type: "ref", ref: "account" }, amount: { type: "money" } }, requires: ["from.owner == self", "to.owner == self", "amount > 0"], outcomes: { default: [{ type: "economy.move", args: { from: "from", to: "to", cents: "=amount", memo: "Transfer" } }] }, duration: "2", lexicon: ["transfer", "move money", "put into savings"], observable: "checks their phone" });
    r.action({ id: "pay_card", label: "Pay card", pack: "economy", params: { card: { type: "ref", ref: "account" }, amount: { type: "money", optional: true } }, requires: ["card.owner == self", "card.type == 'card' or card.type == 'loan'", "level.money >= 3"], outcomes: { default: [{ type: "economy.pay_card", args: { card: "card", cents: "=amount > 0 ? amount : 0 - balance(card)" } }] }, duration: "2", lexicon: ["pay off the card", "pay the card", "pay my credit card"], observable: "checks their phone" });
    r.action({ id: "invest", label: "Invest", pack: "economy", params: { amount: { type: "money" } }, requires: ["level.money >= 4", "amount > 0"], outcomes: { default: [{ type: "economy.invest", args: { owner: "self", cents: "=amount" } }] }, duration: "2", lexicon: ["invest", "buy stocks", "buy shares"], observable: "checks their phone" });
    r.action({ id: "sell_investments", label: "Sell investments", pack: "economy", params: { amount: { type: "money" } }, requires: ["level.money >= 4", "amount > 0"], outcomes: { default: [{ type: "economy.invest", args: { owner: "self", cents: "=amount", sell: true } }] }, duration: "2", lexicon: ["sell stocks", "sell shares", "cash out"], observable: "checks their phone" });

    // Openings first, so every later process this slot sees the accounts' authored balances.
    r.process({ id: "economy.accounts", domain: "money", minLevel: 3, step: (slot, ctx) => openAccounts(slot, ctx) });
    r.process({ id: "economy.payroll", domain: "money", minLevel: 3, step: (slot, ctx) => noted(ctx, payroll(slot, ctx)) });
    r.process({ id: "economy.bills", domain: "money", minLevel: 3, step: (slot, ctx) => noted(ctx, bills(slot, ctx)) });
    r.process({ id: "economy.cards", domain: "money", minLevel: 3, step: (slot, ctx) => noted(ctx, cards(slot, ctx)) });
    r.process({ id: "economy.banking", domain: "money", minLevel: 4, step: (slot, ctx) => noted(ctx, banking(slot, ctx)) });
    r.process({ id: "economy.living", domain: "money", minLevel: 3, step: (slot, ctx) => noted(ctx, living(slot, ctx)) });
    r.process({ id: "economy.markets", domain: "money", minLevel: 4, step: (slot, ctx, rng) => markets(slot, ctx, rng) });

    r.materializer({ domain: "money", version: 1, materialize: materializeMoney });

    r.renderer({
      slot: "money",
      render(ctx) {
        const pov = ctx.world.pov;
        const level = ctx.levelOf(pov, "money");
        if (level === 0) return [];
        if (level === 1 || !hasLedger(ctx.state, pov)) return [`Money: ${wealthOf(ctx.state, pov)}.`];
        const shown = accountsOf(ctx.state, pov).filter((id, i, all) => level >= 3 || accountType(ctx.state, id) === "cash" || id === all.find((x) => accountType(ctx.state, x) === "checking"));
        const parts = shown.map((id) => {
          const t = accountType(ctx.state, id);
          const b = balance(ctx.state, id);
          return t === "card" || t === "loan" ? `${own(ctx.state.entities, id)?.name ?? id} owes ${formatMoney(-b, ctx.world.currency)}` : `${own(ctx.state.entities, id)?.name ?? id} ${formatMoney(b, ctx.world.currency)}`;
        });
        return parts.length > 0 ? [`Money: ${parts.join("; ")}.`] : [];
      },
    });
    r.view({ panel: "economy.money", build: (ctx) => buildMoneyView(ctx) as unknown as JsonValue });
    r.query("economy.people_money", buildPeopleMoney);

    /**
     * Who pays a narrated purchase, and with what. The extractor may name as the payer the account
     * it was paid from (`pov_checking`), a thing the payer paid with (`pov_debit_card`, an item in
     * the wallet), or the way it was paid ("debit card"). The account's or the thing's owner pays:
     * from that account, or the way the thing's name says (a debit card from checking, a credit card
     * on the card, a wallet in cash); a said way of paying is the POV's method. A method the
     * proposal states wins over all of these.
     */
    const purchaser = (p: JsonObject, ctx: ReadContext): { payer: EntityId; from?: EntityId; method?: string } => {
      const named = strOf(p.payer);
      const said = { ...(typeof p.method === "string" ? { method: p.method } : {}), ...(typeof p.from === "string" ? { from: p.from } : {}) };
      if (named === "") return { payer: ctx.world.pov, ...said };
      const e = own(ctx.state.entities, named);
      const holder = accountType(ctx.state, named) ? strOf(e?.fields.owner) : "";
      if (holder !== "" && own(ctx.state.entities, holder)) return { payer: holder, method: said.method ?? "auto", from: said.from ?? named };
      if (!e) return payMethodOf(named) !== "auto" ? { payer: ctx.world.pov, method: said.method ?? named, ...(said.from ? { from: said.from } : {}) } : { payer: named, ...said };
      const owner = strOf(e.fields.owner);
      if (!kindIs(ctx.registry, ctx.world, e.kind, "person") && owner !== "" && own(ctx.state.entities, owner)) {
        return { payer: owner, method: said.method ?? payMethodOf(`${e.name} ${named.replace(/_/g, " ")}`), ...(said.from ? { from: said.from } : {}) };
      }
      return { payer: named, ...said };
    };
    r.proposal({
      type: "purchase",
      boundField: "money",
      validate(p, ctx) {
        const { payer } = purchaser(p, ctx);
        if (!own(ctx.state.entities, payer)) return reject("missing_entity", `no payer ${labelOf(ctx, payer)}`);
        if (!kindIs(ctx.registry, ctx.world, own(ctx.state.entities, payer)?.kind ?? "", "person")) return reject("bad_payer", "a payer must be an account holder");
        const item = strOf(p.item);
        const category = strOf(p.category);
        if (item === "" && category === "") return reject("bad_proposal", "a purchase needs an item or a category");
        // Priced as `economy.buy` prices it: a catalog row that names the item, a price, or a category's band.
        const priced = (typeof p.price === "number" && p.price > 0) || (typeof p.playerPrice === "number" && p.playerPrice > 0) || !!rowOf(ctx, "economy.categories", category) || (item !== "" && (!!rowOf(ctx, "economy.catalog", item) || !!rowOf(ctx, "economy.categories", item) || matchCatalog(ctx, item, placeOfEntity(ctx.state, payer), category) !== null));
        return priced ? null : reject("unpriced", `no catalog item or category ${item || category}, and no price`);
      },
      // `playerPrice` (minor units) is the price the player set on a chip, charged as set; the engine
      // adds it, never a model (`inMinorUnits` drops it from model output).
      toEffects: (p, ctx) => {
        const { payer, from, method } = purchaser(p, ctx);
        const set = typeof p.playerPrice === "number" && p.playerPrice > 0 ? p.playerPrice : undefined;
        const price = set ?? (typeof p.price === "number" ? p.price : undefined);
        return [{ type: "economy.buy", args: { payer, item: strOf(p.item), category: strOf(p.category), name: strOf(p.name), qty: typeof p.qty === "number" ? p.qty : 1, ...(price !== undefined ? { price } : {}), ...(set !== undefined ? { exact: true } : {}), ...(method !== undefined ? { method } : {}), ...(from !== undefined ? { from } : {}) } }];
      },
    });
    r.proposal({
      type: "transfer",
      boundField: "money",
      validate(p, ctx) {
        if (!own(ctx.state.entities, strOf(p.from)) || !own(ctx.state.entities, strOf(p.to))) return reject("missing_entity", "a transfer needs a payer and a payee");
        for (const id of [strOf(p.from), strOf(p.to)]) {
          const party = transferParty(ctx, id);
          if ("code" in party) return party;
        }
        const cents = transferCents(p);
        return Number.isFinite(cents) && cents > 0 ? null : reject("bad_amount", "a transfer needs a positive amount");
      },
      // `method`: how the money changed hands ("cash" for bills handed over).
      toEffects: (p) => [{ type: "economy.transfer", args: { from: strOf(p.from), to: strOf(p.to), cents: transferCents(p), memo: strOf(p.memo, "Payment"), ...(typeof p.method === "string" ? { method: p.method } : {}) } }],
    });

    r.lint({
      code: "economy.accounts",
      check(world) {
        const issues = [];
        for (const e of Object.values(world.entities)) {
          if (e.kind !== "account") continue;
          if (typeof e.fields.owner !== "string" || !own(world.entities, e.fields.owner)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name} has no owner.`, path: `entities.${e.id}.fields.owner` });
          if (e.fields.type === "card" && typeof e.fields.limit !== "number") issues.push({ severity: "warning" as const, code: "economy.accounts", message: `Card ${e.name} has no credit limit; every charge on it will decline.`, path: `entities.${e.id}.fields.limit` });
        }
        return issues;
      },
    });

    r.lint({
      code: "economy.unpriced_cap",
      check(world) {
        const cap = world.packs.economy?.config.unpricedCap;
        if (cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0)) return [];
        // The engine reads a fraction rounded and anything else not above zero as unset (`unpricedCap`).
        const fallback = typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? `${formatMoney(Math.round(cap), world.currency)}, rounded` : `the default, ${formatMoney(derivedUnpricedCap(world), world.currency)}`;
        return [{ severity: "warning" as const, code: "economy.unpriced_cap", message: `The narrated-price cap should be a whole number of ${minorUnitPlural(world.currency)} above zero; narrated prices are capped at ${fallback}.`, path: "packs.economy.config.unpricedCap" }];
      },
    });
  },
};

export default economyPack;
