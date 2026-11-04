// Listing (ORG-SPEC §10 lane Z; DESIGN §27.10 Listing): a company's units traded on the world's
// market. A C corporation lists by offering new units to the public (`economy.list`, an ownership
// decision): the market pays for them into its account, its `listing` field records the asset its
// units trade as, its ticker and the units the public holds (its float), and the asset is priced from
// then on by the market's daily step around its books a unit (assets.ts). Its owners list keeps the
// registered holders, so every unit is a row's or the public's: a row's share is its units over all
// of them (`shareOf`), the company is valued at its price times all its units, and the public's units
// vote. Anyone in the world buys and sells its stock as any other (`economy.trade`, holdings with
// lots), within what the float has left; a registered holder sells units into the float as a stake
// sale with no buyer; a distribution pays the float's part to its holders in the world by their units
// and the rest to the market; and going off the market (`economy.delist`) buys every public unit back.
// The company's Ownership shows its market and its holders there (`economy.market_view`).

import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { allUnits, classesIn, FINANCE_ACTIONS, listingIn, listingJson, ownersIn, ownersJson, ROLE_RIGHTS, rowClass, unitsOf, withUnitShares, type Listing, type ListingView, type MarketActs, type OwnerLine } from "../../../shared/finance";
import { VOTE_PARAM } from "../../../shared/org-motions";
import { mayAct } from "../../../engine/org";
import { labelOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { asParam, mayAs, moneyWords } from "./acting";
import { assetOf, configAssets, dateText, holdingsSlice, listedAssets, performanceOf, quoteOf, readAssetDef, reject } from "./assets";
import { operatingAccount } from "./books";
import { isBusiness } from "./business";
import { disposal } from "./gains";
import { accountOfHolding, holdingIds, holdingOwners, listedFloat, lotsChange, lotsOf, marketOf, qtyOf, stockHolders, unit } from "./holdings";
import { payout } from "./income";
import { hiddenFrom } from "./model";
import type { FinanceApi, FinanceRegistry } from "./module";
import { QTY_EPSILON } from "./pricing";
import { counted, decided, decision, decisionRefusal, listedVotes, stamped } from "./shares";
import { bookValuationOf } from "./stakes";

/** A sale of a holder's registered units on its company's market: units, or a percent of all its units. */
export interface MarketSale {
  party: EntityId;
  business: EntityId;
  units?: number;
  share?: number;
  to?: EntityId;
}

/** The public's part of a distribution: the lines paying it (its holders in the world, the market the rest), what it comes to and its income records. */
export interface PublicPayout {
  cents: number;
  lines: PostingLine[];
  extra: LedgerEvent[];
}

/** A company's market as its Ownership shows it. */
export interface MarketView {
  listing: ListingView | null;
  holders: OwnerLine[];
  acts: MarketActs | null;
}

declare module "../../../engine/registry" {
  interface QueryMap {
    /** A listed company's books a unit: its book valuation over all its units, the anchor its price returns to (§27.10 Listing); null for a company not on a market. */
    "economy.fair_unit": (ctx: ReadContext, business: EntityId) => number | null;
    /** A company's market as its Ownership shows it to `viewer` (null: the GM's view): its listing, its holders on the market, and what the reader may do about it. */
    "economy.market_view": (ctx: ReadContext, business: EntityId, viewer: EntityId | null) => MarketView;
  }
  interface ServiceMap {
    /** The public's part of a listed company's distribution of `cents`; null for a company not on a market. */
    "economy.public_payout": (ctx: ReadContext, business: EntityId, cents: number) => PublicPayout | null;
    /** A holder's registered units of a listed company sold on its market (a stake sale with no buyer). */
    "economy.market_sale": (ctx: ReadContext, sale: MarketSale) => LedgerEvent[] | Rejection;
  }
}

/** The most the market pays a unit for a listing's new units, as a multiple of what they are worth (`listingOfferCap`, 1 by default): its books a unit, or its market price once it is listed. */
export const LISTING_OFFER_CAP = 1;

/** The economy config's cap on a listing's offer price, as a multiple of its books a unit (listed, its market price); never below 1. */
export function listingOfferCap(ctx: Pick<ReadContext, "world">): number {
  const v = objOf(ctx.world.packs.economy?.config).listingOfferCap;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(1, v) : LISTING_OFFER_CAP;
}

type Args = Record<string, JsonValue>;

/** Words a company's name leaves out of its ticker. */
const TICKER_SKIP: Readonly<Record<string, true>> = { the: true, and: true, of: true, co: true, company: true, inc: true, incorporated: true, llc: true, ltd: true, limited: true, corp: true, corporation: true, plc: true };

function isRejection<T>(v: T | Rejection): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/** Every ticker in use: the world's assets' and the listed companies', upper case. */
function tickersTaken(ctx: ReadContext, except: EntityId): Set<string> {
  const out = new Set<string>();
  for (const [id, raw] of Object.entries(configAssets(ctx.world))) {
    const symbol = readAssetDef(raw)?.symbol;
    out.add((symbol ?? id).toUpperCase());
  }
  for (const [, business] of listedAssets(ctx)) {
    if (business === except) continue;
    const listing = listingIn(own(ctx.state.entities, business)?.fields ?? {});
    if (listing) out.add(listing.symbol.toUpperCase());
  }
  return out;
}

/** The ticker a listing takes: the one asked for (a letter, then up to five letters, digits or dots), else the name's initials, made unique with a digit. */
function tickerFor(ctx: ReadContext, business: EntityId, asked: string): string | Rejection {
  const taken = tickersTaken(ctx, business);
  if (asked !== "") {
    const symbol = asked.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(symbol)) return reject("bad_symbol", "a ticker is a letter and up to five more letters, digits or dots");
    return taken.has(symbol) ? reject("bad_symbol", `${symbol} is already another asset's ticker`) : symbol;
  }
  const words = labelOf(ctx, business)
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== "" && !own(TICKER_SKIP, w.toLowerCase()));
  const initials = words.map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 5);
  const base = /^[A-Z]/.test(initials) && initials.length >= 2 ? initials : (words[0] ?? business).replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "CO";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return reject("bad_symbol", "say a ticker for it");
}

/** The asset a new listing trades as: `stock:<company>`, or a later number where an earlier listing left marks or holdings under it. */
function assetIdFor(ctx: ReadContext, business: EntityId): string {
  const slice = holdingsSlice(ctx.state);
  const used = (id: string): boolean => own(objOf(slice.quotes), id) !== undefined || own(objOf(slice.closes), id) !== undefined || holdingIds(ctx.state).some((h) => own(ctx.state.entities, h)?.fields.asset === id);
  const base = `stock:${business}`;
  if (!used(base)) return base;
  for (let i = 2; ; i++) if (!used(`${base}:${i}`)) return `${base}:${i}`;
}

/** Why `party` may not decide about `business`'s market (`doing` heading it): its money level, the power, its structure (listing only), then the votes. */
function marketRefusal(ctx: ReadContext, party: EntityId, business: EntityId, doing: string, listing: boolean): string | null {
  const name = labelOf(ctx, business);
  if (ctx.levelOf(business, "money") < 3) return `${name} goes on a market from Money 3`;
  const may = mayAct(ctx, party, business, "shares.manage");
  if (!may.ok) return may.reason;
  if (listing && strOf(own(ctx.state.entities, business)?.fields.structure, "llc") !== "c_corp") return `Only a C corporation lists on a market: change ${name}'s structure first`;
  return decisionRefusal(ctx, business, party, doing);
}

/** Whether `party` falls short of `business`'s market decision only for want of votes, so may put it to a vote (ORG-SPEC Phase 5). */
function shortOfVotes(ctx: ReadContext, party: EntityId, business: EntityId, doing: string, listing: boolean): boolean {
  const votes = decisionRefusal(ctx, business, party, doing);
  return votes !== null && marketRefusal(ctx, party, business, doing, listing) === votes;
}

// ---------------------------------------------------------------- listing

/**
 * Listing (`economy.list`): `units` new units offered to the public at `price` a unit (else, for a
 * first listing, its books a unit; for one already listed, its market price), the market paying for
 * them into its operating account as capital (`investment`) and no more than they are worth: that
 * price times the economy config's `listingOfferCap` (1 by default); its owners counted in units
 * first where it doesn't count them; its `listing` written (a first listing's ticker given or made
 * from its name, and the day's price marked at the offer price); its History line. A C corporation
 * only, by an ownership decision (`shares.manage`, more than its threshold of the votes); the GM (no
 * `by`) is asked neither.
 */
function listShares(api: FinanceApi, ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const business = strOf(a.business);
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business)) return reject("not_business", `${name} isn't a company`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const units = a.units;
  if (typeof units !== "number" || !Number.isSafeInteger(units) || units <= 0) return reject("bad_amount", "say a whole number of units");
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  if (strOf(fields.structure, "llc") !== "c_corp") return reject("structure", `Only a C corporation lists on a market: change ${name}'s structure first`);
  const listing = listingIn(fields);
  // Short of the votes, an action that asks (`vote`) puts it to a vote instead (ORG-SPEC Phase 5): the motion's events.
  const offered = `${listing ? `Offer ${units} more units of ${name}` : `List ${units} units of ${name}`} on the market${typeof a.price === "number" ? ` at ${moneyWords(ctx, a.price)} a unit` : ""}`;
  const denied = decision(ctx, by, party, business, "shares.manage", "Listing", offered);
  if (denied) return denied;
  const counting = ownersIn(fields).some((o) => ROLE_RIGHTS[o.role].worth && o.units !== undefined);
  const owners = counted(api, ctx, business);
  const registered = unitsOf(owners);
  if (registered <= 0) return reject("no_owners", `${name} has no owners to list it for`);
  const classes = classesIn(fields);
  const cls = strOf(a.class);
  if (cls !== "" && !classes.some((c) => c.id === cls)) return reject("bad_class", `${name} has no class ${cls}: its classes are ${classes.map((c) => c.label).join(", ")}`);
  // What a unit is worth to the market: its books a unit, listed already its market price; it pays up to the config's multiple of that.
  const worth = listing ? Math.round(quoteOf(ctx, listing.asset) ?? listing.price) : Math.round(bookValuationOf(api, ctx, business).value / registered);
  const each = typeof a.price === "number" && Number.isFinite(a.price) ? Math.round(a.price) : worth;
  if (!(each > 0)) return reject("bad_amount", listing || typeof a.price === "number" ? "a price a unit is above nothing" : `${name}'s books give its units no value yet, so the public pays nothing for them`);
  const multiple = listingOfferCap(ctx);
  const cap = Math.floor(worth * multiple);
  if (each > cap) return reject("declined", `the public pays no more than ${multiple === 1 ? "" : `${Math.round(multiple * 100) / 100} times `}its ${listing ? "market price" : "books a unit"} for new units of ${name}, ${moneyWords(ctx, Math.max(0, cap))} a unit`);
  const cents = each * units;
  if (!Number.isSafeInteger(cents)) return reject("bad_amount", "a price is a whole amount");
  const deposit = operatingAccount(api, ctx, business);
  if (!deposit) return reject("no_account", `${name} has no account to take the money`);
  let next: Listing;
  if (listing) next = { ...listing, float: listing.float + units };
  else {
    const symbol = tickerFor(ctx, business, strOf(a.symbol));
    if (isRejection(symbol)) return symbol;
    next = { asset: assetIdFor(ctx, business), symbol, float: units, since: ctx.state.clock, price: each, ...(cls !== "" && cls !== classes[0]?.id ? { class: cls } : {}) };
  }
  const memo = `${units} new units of ${name} sold on the market at ${moneyWords(ctx, each)} a unit`;
  const posted = api.post(ctx, [{ account: marketOf(api, next.asset), amount: -cents }, { account: deposit, amount: cents }], { memo, kind: "sale", category: "investment", payer: "The market" });
  if (isRejection(posted)) return posted;
  const words = listing ? `Offered ${units} more units on the market at ${moneyWords(ctx, each)} a unit (${moneyWords(ctx, cents)})` : `Listed ${units} units on the market as ${next.symbol} at ${moneyWords(ctx, each)} a unit (${moneyWords(ctx, cents)})`;
  return unit([
    ...(counting ? [] : [{ type: "set" as const, entity: business, field: "owners", value: ownersJson(owners) as unknown as JsonValue }]),
    { type: "set", entity: business, field: "listing", value: listingJson(next) },
    ...stamped(posted, by, business),
    ...(listing ? [] : [{ type: "economy.quote", data: { asset: next.asset, price: each } } satisfies LedgerEvent]),
    ...decided(ctx, business, by, party, words, []),
  ]);
}

/**
 * Going off the market (`economy.delist`): every public unit bought back at `price` a unit (else its
 * market price; never less), from its operating account as itself: each holding of its stock in the
 * world sold whole (its owners paid into its account, else their deposit accounts by share, their
 * gain realised), the market paid for the rest; its `listing` cleared, so its owners' rows hold all
 * of it again; its History line. One unit, so a company that can't pay buys back nothing.
 */
function delist(api: FinanceApi, ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const business = strOf(a.business);
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business)) return reject("not_business", `${name} isn't a company`);
  const listing = listingIn(own(ctx.state.entities, business)?.fields ?? {});
  if (!listing) return reject("not_listed", `${name} isn't on a market`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const denied = decision(ctx, by, party, business, "shares.manage", "Delisting", `Take ${name} off the market${typeof a.price === "number" ? `, buying back its public units at ${moneyWords(ctx, a.price)} a unit` : ""}`);
  if (denied) return denied;
  const market = Math.round(quoteOf(ctx, listing.asset) ?? listing.price);
  const given = typeof a.price === "number" && Number.isFinite(a.price) ? Math.round(a.price) : null;
  if (given !== null && given < market) return reject("declined", `the public sells at no less than its market price, ${moneyWords(ctx, market)} a unit`);
  const each = given ?? market;
  const float = listedFloat(ctx, listing.asset);
  const source = operatingAccount(api, ctx, business);
  if (!source) return reject("no_account", `${name} has no account to pay from`);
  const lines: PostingLine[] = [];
  const add = (account: string, amount: number): void => {
    const line = lines.find((l) => l.account === account);
    if (line) line.amount += amount;
    else lines.push({ account, amount });
  };
  const lots: LedgerEvent[] = [];
  const names: EntityId[] = [];
  let total = 0;
  let bought = 0;
  for (const holding of holdingIds(ctx.state)) {
    if (own(ctx.state.entities, holding)?.fields.asset !== listing.asset) continue;
    const qty = qtyOf(lotsOf(ctx, holding));
    if (qty <= QTY_EPSILON) continue;
    const proceeds = Math.round(qty * each);
    const owners = holdingOwners(api, ctx.state, holding);
    const paid = payout(api, ctx, owners, proceeds, source, null, accountOfHolding(ctx.state, holding));
    if (paid.paid < proceeds) return reject("no_account", `${labelOf(ctx, owners[0]?.party ?? holding)} has no account to be paid into`);
    for (const l of paid.lines) if (l.account !== source) add(l.account, l.amount);
    lots.push(lotsChange(ctx.state, holding, -qty, proceeds, "sell", `${listing.symbol} bought out at ${moneyWords(ctx, each)} a unit`));
    names.push(...owners.filter((o) => ROLE_RIGHTS[o.role].worth).map((o) => o.party));
    total += proceeds;
    bought += qty;
  }
  const outside = Math.max(0, listing.float - (float?.held ?? bought));
  const rest = Math.round(outside * each);
  if (rest > 0) add(marketOf(api, listing.asset), rest);
  total += rest;
  const memo = `${name} went off the market: bought back ${listing.float} public units at ${moneyWords(ctx, each)} a unit`;
  const posted = total > 0 ? api.post(ctx, [{ account: source, amount: -total }, ...lines], { memo, kind: "purchase", category: "investment" }) : [];
  if (isRejection(posted)) return posted;
  return unit([
    ...stamped(posted, by, business),
    ...lots,
    { type: "set", entity: business, field: "listing", value: null },
    ...decided(ctx, business, by, party, `Went off the market: bought back ${listing.float} public units at ${moneyWords(ctx, each)} a unit (${moneyWords(ctx, total)})`, names),
  ]);
}

/**
 * A holder's registered units sold on its company's market (a stake sale with no buyer, §27.10
 * Listing): at its market price, paid by the market into `to` (else their deposit account); their
 * rows' units go into the float, every row's share rewritten from what is left; their gain realised
 * on what they sold. A listed company keeps an owner on its cap table, so the last units can't go.
 */
function marketSale(api: FinanceApi, ctx: ReadContext, sale: MarketSale): LedgerEvent[] | Rejection {
  const { party, business } = sale;
  const name = labelOf(ctx, business);
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const listing = listingIn(fields);
  if (!listing) return reject("not_listed", `${name} isn't on a market`);
  const owners = ownersIn(fields);
  const held = unitsOf(owners, party);
  if (held <= 0) return reject("not_yours", `${labelOf(ctx, party)} holds no units of ${name} on its cap table`);
  const units = sale.units ?? Math.round((allUnits(fields) * (sale.share ?? 0)) / 100);
  if (!(Number.isSafeInteger(units) && units > 0)) return reject("bad_amount", "say how many units to sell");
  if (units > held) return reject("declined", `${labelOf(ctx, party)} holds ${held} units of ${name}, not ${units}`);
  if (units >= unitsOf(owners)) return reject("last_units", `${name} keeps an owner on its cap table: sell to someone in the world, or take it off the market`);
  const price = quoteOf(ctx, listing.asset) ?? listing.price;
  const cents = Math.round(price * units);
  const to = sale.to ?? api.depositAccount(ctx, party);
  if (!to) return reject("no_account", `${labelOf(ctx, party)} has no account the money could go to`);
  const unusable = api.mayUse(ctx, party, to, "into");
  if (unusable) return unusable;
  const memo = `Sold ${units} units of ${name} on the market at ${moneyWords(ctx, Math.round(price))} a unit`;
  const posted = cents > 0 ? api.post(ctx, [{ account: marketOf(api, listing.asset), amount: -cents }, { account: to, amount: cents }], { memo, kind: "sale", category: "investment", payer: "The market" }) : [];
  if (isRejection(posted)) return posted;
  let left = units;
  const next = owners.map((o) => {
    if (left <= 0 || o.party !== party || !ROLE_RIGHTS[o.role].worth) return o;
    const take = Math.min(left, o.units ?? 0);
    left -= take;
    return { ...o, units: (o.units ?? 0) - take };
  });
  return unit([
    ...posted,
    disposal(business, party, (units / held) * 100, cents, memo),
    { type: "set", entity: business, field: "owners", value: ownersJson(withUnitShares(next)) as unknown as JsonValue },
    { type: "set", entity: business, field: "listing", value: listingJson({ ...listing, float: listing.float + units }) },
  ]);
}

// ---------------------------------------------------------------- payouts and the price's anchor

/**
 * The public's part of a listed company's distribution of `cents`: the float's share of all its units.
 * Each holding of its stock in the world takes its units' part, paid where its payouts go (its
 * account, a named account, else its owners' deposit accounts by share; a reinvesting route is paid
 * to its account, its units bought whole only on the market), recorded as a dividend; the market takes
 * the rest. Null for a company not on a market.
 */
function publicPayout(api: FinanceApi, ctx: ReadContext, business: EntityId, cents: number): PublicPayout | null {
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const listing = listingIn(fields);
  const units = allUnits(fields);
  if (!listing || listing.float <= 0 || units <= 0) return null;
  const part = Math.round((cents * listing.float) / units);
  if (part <= 0) return null;
  const source = operatingAccount(api, ctx, business) ?? business;
  const lines: PostingLine[] = [];
  const extra: LedgerEvent[] = [];
  const add = (account: string, amount: number): void => {
    const line = lines.find((l) => l.account === account);
    if (line) line.amount += amount;
    else lines.push({ account, amount });
  };
  let given = 0;
  for (const holding of holdingIds(ctx.state)) {
    const f = own(ctx.state.entities, holding)?.fields;
    if (f?.asset !== listing.asset) continue;
    const qty = qtyOf(lotsOf(ctx, holding));
    if (qty <= QTY_EPSILON) continue;
    // Each holding's units' part, never more than the public's part has left, so the lines add up to it.
    const share = Math.min(part - given, Math.round((part * qty) / listing.float));
    if (share <= 0) continue;
    const account = accountOfHolding(ctx.state, holding);
    const route = strOf(f.route);
    const named = route !== "" && route !== "reinvest" && own(ctx.state.entities, route)?.kind === "account" ? route : null;
    const to = account && api.traitsOf(ctx, account)?.locked ? account : named;
    const paid = payout(api, ctx, holdingOwners(api, ctx.state, holding), share, source, to, account);
    if (paid.paid <= 0) continue;
    for (const l of paid.lines) if (l.account !== source) add(l.account, l.amount);
    extra.push({ type: "economy.income", data: { source: holding, cents: paid.paid, kind: "dividend" } });
    given += paid.paid;
  }
  if (part - given > 0) add(marketOf(api, listing.asset), part - given);
  return { cents: part, lines, extra };
}

/** A listed company's books a unit: its book valuation (set, else its books and a multiple of its profit) over all its units. */
function fairUnit(api: FinanceApi, ctx: ReadContext, business: EntityId): number | null {
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const units = allUnits(fields);
  return listingIn(fields) && units > 0 ? bookValuationOf(api, ctx, business).value / units : null;
}

// ---------------------------------------------------------------- the view

/**
 * A company's market as its Ownership shows it to `viewer` (null: the GM's view): while it is listed,
 * its listing (ticker, price, float, what the world holds and what the market sells, its market
 * capitalization, its books a unit at Money 4, how its price has done) and its holders on the market
 * after the cap table's rows (each holder in the world, as "an investor" where `viewer` can't see
 * them, then the public for the rest of the float); and what the reader may do: list it (or offer
 * more), take it off the market, or sell their own registered units there.
 */
function marketView(api: FinanceApi, ctx: ReadContext, business: EntityId, viewer: EntityId | null): MarketView {
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const listing = listingIn(fields);
  const values = ctx.levelOf(business, "money") >= 4;
  const owners = ownersIn(fields);
  const registered = unitsOf(owners);
  const name = labelOf(ctx, business);
  let view: ListingView | null = null;
  const holders: OwnerLine[] = [];
  if (listing) {
    const units = allUnits(fields);
    const classes = classesIn(fields);
    const each = listedVotes(classes, listing.class);
    const totalVotes = owners.reduce((a, o) => a + (ROLE_RIGHTS[o.role].worth ? (o.units ?? 0) * rowClass(o, classes).votes : 0), 0) + listing.float * each;
    const label = Array.isArray(fields.share_classes) && fields.share_classes.length > 0 ? (classes.find((c) => c.id === listing.class) ?? classes[0])?.label : undefined;
    const price = quoteOf(ctx, listing.asset) ?? listing.price;
    const line = (party: EntityId | null, who: string, n: number): OwnerLine => ({
      party,
      name: who,
      role: "owner",
      share: units > 0 ? (n * 100) / units : 0,
      units: n,
      ...(label !== undefined ? { class: label } : {}),
      votes: totalVotes > 0 ? (n * each * 100) / totalVotes : 0,
      ...(values ? { value: Math.round(n * price) } : {}),
      public: true,
    });
    const inWorld = stockHolders(ctx.state, listing.asset);
    let held = 0;
    for (const party of Object.keys(inWorld).sort()) {
      const n = inWorld[party] ?? 0;
      if (n <= QTY_EPSILON) continue;
      held += n;
      const hidden = hiddenFrom(ctx, viewer, party);
      holders.push(line(hidden ? null : party, hidden ? "an investor" : labelOf(ctx, party), n));
    }
    const outside = Math.max(0, listing.float - held);
    if (outside > QTY_EPSILON) holders.push(line(null, "The public", outside));
    const asset = assetOf(ctx, listing.asset);
    view = {
      asset: listing.asset,
      symbol: listing.symbol,
      since: dateText(ctx.world, listing.since),
      price,
      float: listing.float,
      held,
      available: outside,
      marketCap: Math.round(price * units),
      fair: values ? fairUnit(api, ctx, business) : null,
      performance: asset ? performanceOf(ctx, asset) : null,
    };
  }
  let acts: MarketActs | null = null;
  if (viewer !== null) {
    // What they may sell there: their units, short of the cap table's last.
    const mine = Math.min(unitsOf(owners, viewer), registered - 1);
    acts = {
      list: marketRefusal(ctx, viewer, business, "Listing", true),
      delist: listing ? marketRefusal(ctx, viewer, business, "Delisting", false) : `${name} isn't on a market`,
      offer: !listing ? `${name} isn't on a market` : unitsOf(owners, viewer) <= 0 ? `You hold no units of ${name} on its cap table` : mine <= 0 ? `${name} keeps an owner on its cap table: sell to someone in the world, or take it off the market` : api.feature(ctx, viewer, "investments") ? null : "Investments aren't followed at this money level",
      units: Math.max(0, mine),
      ...(shortOfVotes(ctx, viewer, business, "Listing", true) ? { voteList: true } : {}),
      ...(listing && shortOfVotes(ctx, viewer, business, "Delisting", false) ? { voteDelist: true } : {}),
    };
  }
  return { listing: view, holders, acts };
}

// ---------------------------------------------------------------- registration

/** Listing (§27.10 Listing): the effects the GM and agents may make too, the actions, the market sale and public payout services, the price's anchor, Ownership's market and its lint. */
export function registerListing(r: FinanceRegistry): void {
  const { api, core } = r;
  core.query("economy.fair_unit", (ctx, business) => fairUnit(api, ctx, business));
  core.query("economy.market_view", (ctx, business, viewer) => marketView(api, ctx, business, viewer));
  core.service("economy.public_payout", (ctx, business, cents) => publicPayout(api, ctx, business, cents));
  core.service("economy.market_sale", (ctx, sale) => marketSale(api, ctx, sale));
  core.effect({ type: "economy.list", args: ["business", "units", "price?", "symbol?", "class?", "party?", "by?"], gm: true, resolve: (a, ctx) => listShares(api, ctx, a) });
  core.effect({ type: "economy.delist", args: ["business", "price?", "party?", "by?"], gm: true, resolve: (a, ctx) => delist(api, ctx, a) });
  const as = asParam("shares.manage", "Deciding as: an organization whose shares you manage, only when the input decides for a company it holds shares in; left out, it's your own votes");
  core.action({
    id: FINANCE_ACTIONS.sharesList,
    label: "List on the market",
    description: "List a C corporation you control on the market, selling new units to the public, or offer more units once it is listed; the market pays for them into its account.",
    pack: "economy",
    params: { business: { type: "ref", ref: "business", label: "Company" }, units: { type: "number", label: "Units to offer" }, price: { type: "money", optional: true, label: "Price a unit (else its books a unit; listed, its market price)" }, symbol: { type: "text", optional: true, label: "Ticker (else its initials)" }, as, vote: VOTE_PARAM },
    requires: ["level.money >= 3", "params.units > 0", "may(self, business, 'shares.manage')", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.list", args: { business: "business", units: "=params.units", price: "=params.price", symbol: "=params.symbol", party: "self", by: "actor" } }] },
    duration: "60",
    lexicon: ["list the company on the market", "take the company public", "go public", "float the company", "sell shares to the public"],
    observable: "signs a stack of papers",
  });
  core.action({
    id: FINANCE_ACTIONS.sharesDelist,
    label: "Take it off the market",
    description: "Take a listed company you control off the market, buying back every unit the public holds at its market price or more from its account.",
    pack: "economy",
    params: { business: { type: "ref", ref: "business", label: "Company" }, price: { type: "money", optional: true, label: "Price a unit (else its market price)" }, as, vote: VOTE_PARAM },
    requires: ["level.money >= 3", "may(self, business, 'shares.manage')", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.delist", args: { business: "business", price: "=params.price", party: "self", by: "actor" } }] },
    duration: "60",
    lexicon: ["take the company private", "delist the company", "go private", "buy out the public"],
    observable: "signs a stack of papers",
  });
  core.lint({
    code: "economy.listing",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.fields.listing === undefined || e.fields.listing === null) continue;
        const path = `entities.${e.id}.fields.listing`;
        const listing = listingIn(e.fields);
        if (!listing) {
          issues.push({ severity: "error" as const, code: "economy.listing", message: `${e.name}'s listing needs its asset and its float, a whole number of units.`, path });
          continue;
        }
        if (!ownersIn(e.fields).some((o) => ROLE_RIGHTS[o.role].worth && (o.units ?? 0) > 0)) issues.push({ severity: "error" as const, code: "economy.listing", message: `${e.name} is listed, so its owners hold their shares in units.`, path: `entities.${e.id}.fields.owners` });
        if (strOf(e.fields.structure, "llc") !== "c_corp") issues.push({ severity: "warning" as const, code: "economy.listing", message: `${e.name} is listed but isn't a C corporation; only a C corporation lists in play.`, path: `entities.${e.id}.fields.structure` });
        if (own(configAssets(world), listing.asset)) issues.push({ severity: "error" as const, code: "economy.listing", message: `${e.name} trades as ${listing.asset}, which is one of the world's own assets.`, path });
      }
      return issues;
    },
  });
}
