// Economy pack (DESIGN §9.2 Money, §9.3, §25): the money foundation. One double-entry ledger with
// an external-economy counterparty; parties (people, businesses, trusts, households) holding
// accounts through owners and roles; accounts whose products (data, not code) set their behaviour;
// payment cards; flows for every scheduled movement of money; one statement cycle for every
// credit product; a transaction journal with holds; credit reports and scores; payment
// preferences; cash machines and branches; catalog and category-band pricing. The work and
// holdings modules (`modules.ts`) register through the `FinanceRegistry` this pack hands them.
//
// Level contract (domain `money`; every party posts at its own effective level):
//   0  off: charges are no-ops
//   1  a wealth band. Parties without accounts post against their external account
//      (`economy.external:<id>`) and their band follows a continuous notional net worth.
//   2  cash plus one account (the ledger is live; declines on insufficient funds)
//   3  every account, cards, flows, payment preferences, households, living costs
//   4  statements, interest, fees, delinquency, credit, cash machines, holds and limits, overdrafts
// What each feature needs and where a world's Custom toggles may move it is `FEATURE_DEFS`.
// Demotion stops processes and narrows rendering; balances stay live, so promotion restores
// nothing stale. The trial balance is 0 at every level mix.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { FEATURE_DEFS, FINANCE_FEATURES, isAccountClass, isOwnerRole, ownersIn, heldBy, type FinanceFeature, type FinanceView, type MoneySummary, type PartyKind } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { minorUnitPlural } from "../../../shared/money";
import { calendarOf } from "../../../engine/calendar";
import { isMaterialized } from "../../../engine/materialize";
import { labelOf, numOf, objOf, optionalService, own, rowOf, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, FeedLine, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { together } from "../../../engine/presence";
import { canSeeEntity } from "../../../engine/visibility";
import type { FeedScope } from "../../../shared/world";
import { propertyLines } from "./feed";
import { FINANCE_MODULES } from "./modules";
import type { FinanceApi, FinanceHooks, FinanceKind, FinanceRegistry, Payment, PostMeta } from "./module";
import { applyForCredit, closeAccount, createFlow, creditApplication, deposit, editFlow, interestsOf, landsInReach, openAccount, paysFor, releaseHold, replaceCard, setAutopay, setCardState, setFlowStatus, setPayPrefs, setStatus, updateFlow, withdraw } from "./actions";
import { currentScore } from "./credit";
import { allFlows, businessDay, livingCost, occurrences, splitAmount } from "./flows";
import { EVENTS, isOpened, reject } from "./journal";
import { financeKinds } from "./kinds";
import { type CatalogName, catalogName, itemName, stem } from "./items";
import {
  CORRECTION_ACCOUNT,
  accountsOf,
  availableOf,
  balance,
  canSpend,
  classOf,
  derivedClaimCap,
  derivedUnpricedCap,
  external,
  hasLedger,
  holdersOf,
  managesAccount,
  managesParty,
  openerOf,
  ownersOf,
  priceOf,
  productOf,
  rightsOf,
  shareOf,
  traitsOf,
  unpricedCap,
  type Price,
  type PriceRef,
} from "./model";
import { accountLevel, asUnit, charge, featureFor, isParty, isRejection, l1Move, loseWith, mayUse, move, overdraftRoom, payMethodOf, postGuard, posting, reprice, setCash, signal, transfer, transferParty, depositAccount, type ChargeOptions, type ChargeService, type PayMethod } from "./pay";
import { materializeMoney, MONEY_STEP_LEVEL, moneyStep, openAccounts, openingEvent, planStep } from "./process";
import { moneySummary } from "./summary";
import { buildFinanceView, buildMoneyView, buildPeopleMoney } from "./view";
import { canAfford, netWorth, wealthOf } from "./worth";
import catalog from "./tables/modern-us/catalog.json";
import categories from "./tables/modern-us/categories.json";
import finance from "./tables/modern-us/finance.json";
import occupations from "./tables/modern-us/occupations.json";
import regions from "./tables/modern-us/regions.json";
import type { DataTable } from "../../../shared/tables";

const TABLES: DataTable[] = [catalog, categories, occupations, regions, finance] as unknown as DataTable[];

export type { ChargeOptions, ChargeService, PayMethod };
export { payMethodOf };

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

function offersAtPlace(ctx: ReadContext, place: string | null): Offer[] {
  if (!place || !own(ctx.world.places, place)) return [];
  const { categories, sells } = placeTrade(ctx, place);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const out: Offer[] = [];
  for (const category of categories) {
    for (const id of Object.keys(rows).sort()) {
      if (out.length >= OFFER_CAP) return out;
      const row = rows[id];
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
 * A qualifier no row of the noun names ("large" in "large coffee") tells none of them apart, so
 * the place may: where it sells the category of a row kept out by that qualifier alone and of no
 * row that fits outright, that row fits too (a large coffee at a cafe is a drip coffee, at a
 * grocery ground coffee). Of the rows that fit, the one holding the most of the item's words wins
 * ("pint of beer" is "Beer at a bar", by its id); then one whose own noun is that noun, one in the
 * category the purchase gives, one the place sells, one that mentions a place tag (a pint at a
 * bar), then the first id.
 */
export function matchCatalog(ctx: ReadContext, text: string, place: string | null, category = ""): string | null {
  const item = itemName(text);
  if (!item) return null;
  const said = new Set([...item.words, ...(item.trailing?.words ?? [])]);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const trade = placeTrade(ctx, place);
  const tags = trade.tags.map((t) => stem(t.toLowerCase()));
  const nouns = Object.keys(rows)
    .sort()
    .map((id) => ({ id, name: catalogName(id, strOf(rows[id]?.name, id)) }))
    .filter((r) => r.name.heads.has(item.head));
  const unnamed = (name: CatalogName): string[] => [...item.words].filter((w) => w !== item.head && !name.words.has(w));
  const otherKind = (name: CatalogName): boolean => unnamed(name).length > 0 && [...name.qualifiers].some((q) => !said.has(q));
  const sold = (id: string): boolean => trade.categories.includes(strOf(rows[id]?.category));
  const outright = nouns.filter((r) => !otherKind(r.name));
  // Only the place lets a row back in, and only over rows it doesn't sell: with none fitting outright the item is another kind than every one ("lantern oil").
  const placeChooses = outright.length > 0 && !outright.some((r) => sold(r.id));
  const known = (w: string): boolean => nouns.some((r) => r.name.words.has(w));
  let best: { id: string; score: number[] } | null = null;
  for (const { id, name } of nouns) {
    if (otherKind(name) && !(placeChooses && sold(id) && unnamed(name).every((w) => !known(w)))) continue;
    const rowCategory = strOf(rows[id]?.category);
    const score = [[...said].filter((w) => name.words.has(w)).length, name.main === item.head ? 1 : 0, rowCategory === category ? 1 : 0, trade.categories.includes(rowCategory) ? 1 : 0, tags.some((t) => name.words.has(t)) ? 1 : 0];
    const first = best ? score.findIndex((s, i) => s !== best?.score[i]) : 0;
    if (!best || (first >= 0 && (score[first] ?? 0) > (best.score[first] ?? 0))) best = { id, score };
  }
  return best?.id ?? null;
}

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Pay `cents`: a no-op at level 0, a band check plus adjustment at 1, a posting (with declines) from 2. */
    "economy.charge": ChargeService;
    /** Move money between two parties, each at its own level; each a party, or an account a party holds. */
    "economy.transfer": (ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string, method?: PayMethod) => LedgerEvent[] | Rejection;
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
    /** A GM money edit: `cents` into (positive) or out of an account, posted against the outside correction account, with its journal line. */
    "economy.adjust": (ctx: ReadContext, account: EntityId, cents: number) => LedgerEvent[] | Rejection;
    /**
     * An Upgrade's new opening balance for an account (DESIGN §4.3 `migrate`): once the account is
     * open, `cents` (the new opening less the old) moves into or out of it against its opener's
     * outside account, with its journal line. Empty before, when the opening posts the new amount itself.
     */
    "economy.reopen": (ctx: ReadContext, account: EntityId, cents: number) => LedgerEvent[];
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
    /** Every party's money for the GM view (`core.gm`), the POV first, each at their own Money level. */
    "economy.people_money": (ctx: ReadContext) => FinanceView[];
    /** One party's money at their own Money level; `player` hides who the POV can't see behind "someone". */
    "economy.finance": (ctx: ReadContext, party: EntityId, player: boolean) => FinanceView;
  }
}

/** The catalog row, else the category, whose name a "Bought …" memo carries (the name `priceOf` gives it). */
function boughtRef(ctx: ReadContext, name: string): PriceRef | null {
  const named = (table: string): string | undefined => Object.entries(ctx.tables.get(table)?.rows ?? {}).find(([id, row]) => strOf(row?.name, id) === name)?.[0];
  const row = named("economy.catalog");
  if (row) return { catalog: row };
  const category = named("economy.categories");
  return category ? { category } : null;
}

function amountOf(v: JsonValue | undefined): number {
  return typeof v === "number" ? Math.round(v) : NaN;
}

/** Purchases in these categories become gear items. */
const PHYSICAL = new Set(["groceries_staples", "clothing", "electronics", "tools_hardware", "household_goods", "personal_care", "gifts", "alcohol", "medical"]);

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

function emptyHooks(): FinanceHooks {
  return { fields: {}, flows: [], amounts: {}, worth: [], sales: [], views: [], summaries: [] };
}

function partyKindOf(ctx: ReadContext, id: EntityId): PartyKind | null {
  const kind = own(ctx.state.entities, id)?.kind ?? "";
  if (!kind || !isParty(ctx, id)) return null;
  for (const k of ["business", "trust", "household"] as const) if (kindIs(ctx.registry, ctx.world, kind, k)) return k;
  return "person";
}

/** The foundation's money surface for modules (`FinanceRegistry.api`). */
function makeApi(hooks: FinanceHooks): FinanceApi {
  return {
    classOf: (books, account) => classOf(books, account),
    traitsOf: (books, account) => traitsOf(books, account),
    ownersOf: (state, entity) => ownersOf(state, entity),
    shareOf: (state, entity, party) => shareOf(state, entity, party),
    interestsOf: (ctx, who) => interestsOf(ctx, who),
    paysFor: (ctx, who, to, from, deposit) => paysFor(ctx, who, to, from, { deposit }),
    landsInReach: (ctx, who, account, from) => landsInReach(ctx, who, account, from),
    accountsOf: (books, party, right) => accountsOf(books, party, right ?? "sees"),
    balance: (state, account) => balance(state, account),
    available: (ctx, account) => availableOf(ctx, account) + overdraftRoom(ctx, account),
    product: (ctx, account) => productOf(ctx, account),
    depositAccount: (ctx, party, except) => depositAccount(ctx, party, except),
    partyKind: (ctx, id) => partyKindOf(ctx, id),
    feature: (ctx, party, feature) => featureFor(ctx, party, feature),
    outside: (id) => external(id),
    mayUse: (ctx, party, account, side) => mayUse(ctx, party, account, side),
    pay: (ctx, p) => payWith(hooks, ctx, p),
    post: (ctx, lines, meta) => postWith(ctx, lines, meta),
    note: (ctx, who, cls, text) => [signal(cls, text, who, ctx.state.clock)],
    money: (ctx, cents) => formatMoney(cents, ctx.world.currency),
    split: (cents, splits, rest) => splitAmount(cents, splits, rest),
    occurrences: (ctx, schedule, from, to, start) => occurrences(ctx, schedule, from, to, start).map((o) => o.at),
    businessDay: (ctx, day, roll) => businessDay(calendarOf(ctx.world), day, roll),
    flows: (ctx) => allFlows(hooks, ctx),
    openAccount: (ctx, spec) => openAccount(ctx, spec),
    applyCredit: (ctx, who, app) => {
      const made = creditApplication(ctx, who, app);
      if ("code" in made) return made;
      return made.decision.approved ? made.events : reject("declined", made.decision.reason);
    },
    securedBy: (state, asset) =>
      Object.keys(state.entities)
        .filter((id) => own(state.entities, id)?.kind === "account" && own(state.entities, id)?.fields.secured_by === asset)
        .sort(),
    netWorth: (ctx, party) => netWorth(hooks, ctx, party),
  };
}

/** A module's payment, paid the way the foundation pays everything. */
function payWith(hooks: FinanceHooks, ctx: ReadContext, p: Payment): LedgerEvent[] | Rejection {
  const from = own(ctx.state.entities, p.from);
  if (!from) return reject("missing_entity", `no ${labelOf(ctx, p.from)}`);
  const account = from.kind === "account" ? p.from : undefined;
  const payer = account ? holdersOf(ctx.state, account).find((h) => canSpend(ctx.state, account, h)) : p.from;
  if (!payer) return reject("not_owner", `no one can pay from ${labelOf(ctx, p.from)}`);
  const to = own(ctx.state.entities, p.to);
  const opts: ChargeOptions = { method: (p.method as PayMethod | undefined) ?? (account ? "auto" : "account"), ...(account ? { source: account } : {}), ...(p.kind ? { kind: p.kind } : {}), ...(p.category ? { category: p.category } : {}), ...(p.flow ? { flow: p.flow } : {}) };
  if (to?.kind === "account") {
    const holder = holdersOf(ctx.state, p.to)[0];
    if (holder === payer) return move(ctx, account ?? depositAccount(ctx, payer) ?? "", p.to, p.cents, p.memo, { cap: true });
    return charge(hooks, ctx, payer, p.cents, p.memo, { ...opts, ...(holder ? { payee: holder } : {}), deposit: p.to });
  }
  if (to && isParty(ctx, p.to)) return charge(hooks, ctx, payer, p.cents, p.memo, { ...opts, payee: p.to, ...(p.deposit ? { deposit: p.deposit } : {}) });
  return charge(hooks, ctx, payer, p.cents, p.memo, { ...opts, counterparty: p.counterparty ?? p.to });
}

/**
 * A module's posting of any lines: checked as the fold checks it (unless unchecked), with its journal
 * lines, and the bands of band-only parties whose outside accounts it moves.
 */
function postWith(ctx: ReadContext, lines: PostingLine[], meta: PostMeta): LedgerEvent[] | Rejection {
  const clean = lines.filter((l) => l.amount !== 0);
  if (clean.length < 2 || clean.reduce((a, l) => a + l.amount, 0) !== 0) return reject("unbalanced", `${meta.memo} doesn't balance`);
  if (!meta.unchecked) {
    const refused = postGuard(ctx, clean);
    if (refused) return refused;
  }
  const bands: LedgerEvent[] = [];
  for (const l of clean) {
    const party = l.account.startsWith("economy.external:") ? l.account.slice("economy.external:".length) : "";
    if (party !== "" && own(ctx.state.entities, party) && !hasLedger(ctx, party) && ctx.levelOf(party, "money") >= 1) bands.push(...l1Move(ctx.state, party, l.amount));
  }
  return asUnit([...posting(clean, { memo: meta.memo, ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.category ? { category: meta.category } : {}), ...(meta.counterparty ? { counterparty: meta.counterparty } : {}), ...(meta.payer ? { payer: meta.payer } : {}), ...(meta.flow ? { flow: meta.flow } : {}) }), ...bands]);
}

/** A party's money that's spendable now: what they can spend from (cash carried, accounts, credit left). */
function spendableNow(ctx: ReadContext, who: EntityId): number {
  let total = 0;
  for (const id of accountsOf(ctx, who, "spend")) {
    const t = traitsOf(ctx, id);
    if (!t?.pays || t.locked) continue;
    total += Math.max(0, availableOf(ctx, id) + overdraftRoom(ctx, id));
  }
  return Math.min(total, Number.MAX_SAFE_INTEGER);
}

/** The payer of a narrated purchase, and the account or card it names (DESIGN §9.5). */
function purchaser(p: JsonObject, ctx: ReadContext): { payer: EntityId; from?: EntityId; method?: string } {
  const named = strOf(p.payer);
  const said = { ...(typeof p.method === "string" ? { method: p.method } : {}), ...(typeof p.from === "string" ? { from: p.from } : {}) };
  if (named === "") return { payer: ctx.world.pov, ...said };
  const e = own(ctx.state.entities, named);
  if (e?.kind === "account" || e?.kind === "card") {
    const holder = e.kind === "card" ? strOf(e.fields.holder) : (holdersOf(ctx.state, named).find((h) => canSpend(ctx.state, named, h)) ?? "");
    if (holder !== "" && own(ctx.state.entities, holder)) return { payer: holder, method: said.method ?? "auto", from: said.from ?? named };
  }
  if (!e) return payMethodOf(named) !== "auto" ? { payer: ctx.world.pov, method: said.method ?? named, ...(said.from ? { from: said.from } : {}) } : { payer: named, ...said };
  const owner = strOf(e.fields.owner);
  if (!isParty(ctx, named) && owner !== "" && own(ctx.state.entities, owner)) {
    return { payer: owner, method: said.method ?? payMethodOf(`${e.name} ${named.replace(/_/g, " ")}`), ...(said.from ? { from: said.from } : {}) };
  }
  return { payer: named, ...said };
}

/** An id as authors write one (lower snake_case, no spaces): what a misspelt reference looks like, unlike an outside party's name in words. */
const ID_SHAPED = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function registerRest(r: CoreRegistry, hooks: FinanceHooks): void {
  const chargeService: ChargeService = (ctx, payer, cents, memo, opts) => charge(hooks, ctx, payer, cents, memo, opts);
  r.service("economy.charge", chargeService);
  r.service("economy.transfer", (ctx, from, to, cents, memo, method) => transfer(hooks, ctx, from, to, cents, memo, method));
  r.service("economy.lose", loseWith);
  r.service("economy.set_cash", setCash);
  r.service("economy.reprice", reprice);
  r.service("economy.adjust", (ctx, account, cents) => {
    if (own(ctx.state.entities, account)?.kind !== "account") return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
    if (!Number.isSafeInteger(cents) || cents === 0) return reject("bad_amount", "an adjustment is a whole amount other than nothing");
    const lines: PostingLine[] = [
      { account, amount: cents },
      { account: CORRECTION_ACCOUNT, amount: -cents },
    ];
    // An account not yet open opens first, as showing it would: the correction moves the balance the GM sees on it.
    const opener = openerOf(ctx.state, account);
    const opening = opener !== null && !isOpened(ctx.state, account, opener) ? openingEvent(ctx, opener) : null;
    return asUnit([...(opening ? [opening] : []), ...posting(lines, { memo: "Correction", kind: "adjustment", category: "correction" })]);
  });
  r.service("economy.reopen", (ctx, account, cents) => {
    const opener = ownersOf(ctx.state, account)[0]?.party ?? "";
    if (own(ctx.state.entities, account)?.kind !== "account" || !own(ctx.state.entities, opener) || !isMaterialized(ctx.state, opener, "money") || !Number.isSafeInteger(cents) || cents === 0) return [];
    const lines: PostingLine[] = [
      { account, amount: cents },
      { account: external(opener), amount: -cents },
    ];
    return posting(lines, { memo: "Opening balance changed", kind: "adjustment", category: "opening" });
  });

  r.query("wealth", (ctx, who) => wealthOf(hooks, ctx, who));
  r.query("can_afford", (ctx, who, cents) => canAfford(hooks, ctx, who, cents, spendableNow(ctx, who)));
  r.query("economy.net_worth", (ctx, who) => (hasLedger(ctx, who) ? netWorth(hooks, ctx, who) : null));
  r.query("economy.price", (ctx, ref, rng) => priceOf(ctx, ref, rng));
  r.query("economy.bought_band", (ctx, name, qty, who) => {
    const ref = boughtRef(ctx, name);
    const price = ref ? priceOf(ctx, { ...ref, place: placeOfEntity(ctx.state, who) }) : null;
    return price ? { min: price.band.min * qty, max: price.band.max * qty } : null;
  });
  r.query("economy.offers", (ctx, who) => offersAtPlace(ctx, placeOfEntity(ctx.state, who)));
  r.query("economy.item_choices", (ctx, text, who) => {
    const place = placeOfEntity(ctx.state, who);
    const item = itemName(text);
    const said = new Set(item ? [...item.words, ...(item.trailing?.words ?? [])] : []);
    const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
    const near = Object.keys(rows)
      .sort()
      .map((id) => ({ id, shared: [...catalogName(id, strOf(rows[id]?.name, id)).words].filter((w) => said.has(w)).length }))
      .filter((x) => x.shared > 0)
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
  r.query("economy.people_money", (ctx) => buildPeopleMoney(hooks, ctx));
  r.query("economy.finance", (ctx, party, player) => buildFinanceView(hooks, ctx, party, player));
  r.query("economy.summary", (ctx, who): MoneySummary => moneySummary(hooks, ctx, who));
  r.query("economy.holders", (ctx, entity) => holdersOf(ctx.state, entity));

  // Ledger 1.10: a posting folds only if the accounts it draws on can pay it.
  r.guard({ type: "post", validate: (e, ctx) => (e.type === "post" ? postGuard(ctx, e.lines) : null) });
  r.formula("wealth", (ctx, who) => wealthOf(hooks, ctx, String(who ?? ctx.world.pov)));
  r.formula("can_afford", (ctx, who, cents) => ctx.query("can_afford")(ctx, String(who ?? ctx.world.pov), Number(cents ?? 0)));
  r.formula("net_worth", (ctx, who) => netWorth(hooks, ctx, String(who ?? ctx.world.pov)));
  r.formula("balance", (ctx, account) => balance(ctx.state, String(account ?? "")));
  r.formula("price", (ctx, item) => priceOf(ctx, { catalog: String(item ?? "") })?.cents ?? priceOf(ctx, { category: String(item ?? "") })?.cents ?? 0);
  // Whether `who` holds a thing (any role on an owners list, its owner, a card's holder) or can spend from an account.
  r.formula("holds", (ctx, who, thing) => heldBy(ctx.state.entities, String(thing ?? ""), String(who ?? ctx.world.pov)));
  r.formula("spends", (ctx, who, account) => canSpend(ctx.state, String(account ?? ""), String(who ?? ctx.world.pov)));
  // Whether `who` manages an account (by a managing role on it, or on the business or trust that holds it) or a business or a trust (DESIGN §25.1).
  r.formula("manages", (ctx, who, thing) => {
    const id = String(thing ?? "");
    const by = String(who ?? ctx.world.pov);
    return own(ctx.state.entities, id)?.kind === "account" ? managesAccount(ctx, id, by) : managesParty(ctx.state, id, by);
  });
  r.formula("is_credit", (ctx, account) => traitsOf(ctx, String(account ?? ""))?.liability === true);
  r.formula("money_feature", (ctx, feature, who) => (FINANCE_FEATURES as readonly string[]).includes(String(feature)) && featureFor(ctx, String(who ?? ctx.world.pov), String(feature) as FinanceFeature));
  r.formula("credit_score", (ctx, who) => currentScore(ctx, String(who ?? ctx.world.pov)) ?? 0);

  registerEffects(r, hooks);
  registerActions(r);

  // Openings first, so the money engine sees every authored balance.
  r.process({ id: "economy.accounts", domain: "money", minLevel: 3, step: (_slot, ctx) => openAccounts(ctx) });
  r.process({ id: "economy.money", domain: "money", minLevel: MONEY_STEP_LEVEL, step: (slot, ctx, rng) => moneyStep(hooks, slot, ctx, rng) });
  // Below the money step, a character's plan to pay or lend is still carried out and settled.
  r.process({ id: "economy.plans", domain: "money", minLevel: 0, step: (slot, ctx, rng) => planStep(hooks, slot, ctx, rng) });
  r.materializer({ domain: "money", version: 2, versions: [1, 2], materialize: (entity, ctx, rng, version) => materializeMoney(entity, ctx, rng, version) });

  /**
   * The Money section (DESIGN §6, §6.11): the POV's money at its Money level. In `scene` scope, the
   * money of each person with it, as theirs to know (their wealth band); in `gm`, that of anyone there.
   */
  const moneyLines = (ctx: ReadContext, scope: FeedScope): FeedLine[] => {
    const pov = ctx.world.pov;
    const level = ctx.levelOf(pov, "money");
    if (level === 0) return [];
    const lines: FeedLine[] = [];
    if (level === 1 || !hasLedger(ctx, pov)) lines.push({ text: `Money: ${wealthOf(hooks, ctx, pov)}.`, known: "pov" });
    else {
      const mine = accountsOf(ctx, pov);
      const firstTransactional = mine.find((id) => traitsOf(ctx, id)?.transactional);
      const shown = mine.filter((id) => level >= 3 || classOf(ctx, id) === "cash" || id === firstTransactional);
      const parts = shown.map((id) => {
        const b = balance(ctx.state, id);
        const name = own(ctx.state.entities, id)?.name ?? id;
        return traitsOf(ctx, id)?.liability ? `${name} owes ${formatMoney(-b, ctx.world.currency)}` : `${name} ${formatMoney(b, ctx.world.currency)}`;
      });
      if (parts.length > 0) lines.push({ text: `Money: ${parts.join("; ")}.`, known: "pov" });
    }
    if (scope === "player") return lines;
    const here = placeOfEntity(ctx.state, pov);
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = own(ctx.state.entities, id);
      if (!e || id === pov || !kindIs(ctx.registry, ctx.world, e.kind, "person") || isGone(ctx.state, id) || !together(ctx.world, here, placeOfEntity(ctx.state, id))) continue;
      const text = `${e.name}'s money: ${wealthOf(hooks, ctx, id)}.`;
      if (canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id)) lines.push({ text, known: "scene", who: e.name });
      else if (scope === "gm") lines.push({ text, known: "gm" });
    }
    return lines;
  };
  r.renderer({ slot: "money", render: (ctx) => moneyLines(ctx, "player").map((l) => l.text), feed: moneyLines });
  r.renderer({ slot: "property", render: (ctx) => propertyLines(ctx, "player").map((l) => l.text), feed: propertyLines });
  r.view({ panel: "economy.money", build: (ctx) => buildMoneyView(hooks, ctx) as unknown as JsonValue });

  r.proposal({
    type: "purchase",
    boundField: "money",
    validate(p, ctx) {
      const { payer } = purchaser(p, ctx);
      if (!own(ctx.state.entities, payer)) return reject("missing_entity", `no payer ${labelOf(ctx, payer)}`);
      if (!isParty(ctx, payer)) return reject("bad_payer", "a payer must be an account holder");
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
      const payer = transferParty(ctx, strOf(p.from), "from");
      if ("code" in payer) return payer;
      const payee = transferParty(ctx, strOf(p.to), "to");
      if ("code" in payee) return payee;
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
      const isPartyDef = (id: string): boolean => {
        const e = own(world.entities, id);
        return !!e && e.kind !== "account" && e.kind !== "card" && e.kind !== "flow";
      };
      const products = objOf(objOf(world.packs.economy?.config).products);
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "account") continue;
        const owners = ownersIn(e.fields);
        if (owners.length === 0) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name} has no owners.`, path: `entities.${e.id}.fields.owners` });
        for (const [i, o] of owners.entries()) if (!isPartyDef(o.party)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name}'s owner "${o.party}" isn't someone in the world.`, path: `entities.${e.id}.fields.owners.${i}` });
        if (Array.isArray(e.fields.owners)) for (const [i, o] of e.fields.owners.entries()) if (!isOwnerRole(objOf(o).role)) issues.push({ severity: "warning" as const, code: "economy.accounts", message: `Account ${e.name}'s owner ${i + 1} has no role the engine knows; it reads as owner.`, path: `entities.${e.id}.fields.owners.${i}.role` });
        const product = strOf(e.fields.product);
        if (product !== "" && !own(products, product) && !isAccountClass(product)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name} names a product "${product}" that's neither the world's nor a class.`, path: `entities.${e.id}.fields.product` });
        if (product === "" && strOf(e.fields.type) === "") issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name} has no product.`, path: `entities.${e.id}.fields.product` });
        for (const field of ["autopay_from", "overdraft_link", "secured_by"]) {
          const v = strOf(e.fields[field]);
          if (v !== "" && !own(world.entities, v)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Account ${e.name}'s ${field.replace(/_/g, " ")} names "${v}", which isn't in the world.`, path: `entities.${e.id}.fields.${field}` });
        }
      }
      for (const [id, p] of Object.entries(products)) if (!isAccountClass(objOf(p).class)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Product ${id} has no class the engine knows.`, path: `packs.economy.config.products.${id}.class` });
      for (const key of Object.keys(objOf(objOf(world.packs.economy?.config).features))) if (!(key in FEATURE_DEFS)) issues.push({ severity: "warning" as const, code: "economy.accounts", message: `There's no money feature "${key}"; the toggle does nothing.`, path: `packs.economy.config.features.${key}` });
      for (const e of Object.values(world.entities)) {
        if (e.kind === "card") {
          const account = own(world.entities, strOf(e.fields.account));
          if (!account || account.kind !== "account") issues.push({ severity: "error" as const, code: "economy.accounts", message: `Card ${e.name} isn't on an account.`, path: `entities.${e.id}.fields.account` });
          else if (!ownersIn(account.fields).some((o) => o.party === strOf(e.fields.holder))) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Card ${e.name}'s holder doesn't hold ${account.name}.`, path: `entities.${e.id}.fields.holder` });
          const item = strOf(e.fields.item);
          if (item !== "" && !own(world.entities, item)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Card ${e.name}'s gear card "${item}" isn't in the world.`, path: `entities.${e.id}.fields.item` });
        }
        if (e.kind === "flow") {
          for (const side of ["from", "to"]) if (strOf(e.fields[side]) === "") issues.push({ severity: "error" as const, code: "economy.accounts", message: `Flow ${e.name} has no "${side}".`, path: `entities.${e.id}.fields.${side}` });
          // A payer or payee that names no entity is an outside party by that name: money from or to nowhere when it was meant as an id.
          for (const side of ["from", "to"]) {
            const v = strOf(e.fields[side]);
            if (ID_SHAPED.test(v) && !own(world.entities, v)) issues.push({ severity: "warning" as const, code: "economy.accounts", message: `Flow ${e.name}'s ${side} "${v}" names no entity; it's read as an outside party by that name.`, path: `entities.${e.id}.fields.${side}` });
          }
          const amount = ["amount_cents", "amount_formula", "amount_table", "amount_min", "amount_pct", "amount_due"].some((k) => e.fields[k] !== undefined && e.fields[k] !== "");
          if (!amount) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Flow ${e.name} has no amount.`, path: `entities.${e.id}.fields.amount_cents` });
          if ((e.fields.every === undefined || e.fields.every === "") && (e.fields.once === undefined || e.fields.once === "")) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Flow ${e.name} has no schedule: give it "every" or "once".`, path: `entities.${e.id}.fields.every` });
          const link = strOf(e.fields.link);
          if (link !== "" && !own(world.entities, link)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Flow ${e.name} belongs to "${link}", which isn't in the world.`, path: `entities.${e.id}.fields.link` });
          // A fallback is drawn on when the payer can't pay: it must be in the world, never an outside name.
          const fallback = strOf(e.fields.fallback);
          if (fallback !== "" && !own(world.entities, fallback)) issues.push({ severity: "error" as const, code: "economy.accounts", message: `Flow ${e.name}'s fallback "${fallback}" isn't in the world; a fallback is an account of the payer's.`, path: `entities.${e.id}.fields.fallback` });
        }
        if (e.kind === "job") {
          // An employer is a business, a place (the business there), or an outside employer named in words.
          const employer = strOf(e.fields.employer);
          if (ID_SHAPED.test(employer) && !own(world.entities, employer) && !own(world.places, employer)) issues.push({ severity: "warning" as const, code: "economy.accounts", message: `Job ${e.name}'s employer "${employer}" names no one and no place; it's read as an outside employer by that name.`, path: `entities.${e.id}.fields.employer` });
        }
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
  r.lint({
    code: "economy.claim_cap",
    check(world) {
      const cap = world.packs.economy?.config.claimCap;
      if (cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0)) return [];
      // As with the narrated-price cap, the engine reads a fraction rounded and anything else not above zero as unset (`claimCap`).
      const fallback = typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? `${formatMoney(Math.round(cap), world.currency)}, rounded` : `the default, ${formatMoney(derivedClaimCap(world), world.currency)}`;
      return [{ severity: "warning" as const, code: "economy.claim_cap", message: `The claim cap should be a whole number of ${minorUnitPlural(world.currency)} above zero; a capped Make it real asks first above ${fallback}.`, path: "packs.economy.config.claimCap" }];
    },
  });
}

function actor(ctx: EffectContext, args: Record<string, JsonValue>, key = "who"): EntityId {
  return strOf(args[key]) || ctx.world.pov;
}

function registerEffects(r: CoreRegistry, hooks: FinanceHooks): void {
  r.effect({
    type: "economy.buy",
    args: ["item?", "category?", "qty?", "price?", "exact?", "stated?", "name?", "payer?", "method?", "from?", "payee?", "keep?", "cashback?"],
    resolve(args, ctx) {
      const payer = strOf(args.payer) || ctx.world.pov;
      const qty = typeof args.qty === "number" && args.qty > 0 ? args.qty : 1;
      const priced = quote(ctx, args, payer, qty);
      if (!priced) return reject("unpriced", `no price for ${labelOf(ctx, strOf(args.item) || strOf(args.category))}`);
      const { price, row } = priced;
      const name = strOf(args.name) || price.name;
      // "Pay another way" retries name a method (savings, card, checking, cash) or a specific account
      // or card (`from`); the Buy action passes the player's words ("with my card").
      const said = payMethodOf(strOf(args.method));
      const paid = charge(hooks, ctx, payer, price.cents, `Bought ${name}${qty > 1 ? ` ×${qty}` : ""}`, { method: said, category: price.category, kind: "purchase", sale: { place: placeOfEntity(ctx.state, payer), item: row ?? name }, ...(priced.narrated ? { narrated: priced.narrated } : {}), ...(typeof args.payee === "string" ? { payee: args.payee } : {}), ...(strOf(args.from) !== "" ? { source: strOf(args.from) } : {}), ...(typeof args.cashback === "number" && args.cashback > 0 ? { cashback: args.cashback } : {}) });
      if (isRejection(paid)) return paid;
      const out = [...paid];
      const spawn = PHYSICAL.has(price.category) && args.keep !== false ? optionalService(ctx, "gear.spawn") : null;
      if (spawn && ctx.levelOf(payer, "gear") >= 1) {
        // A second of the same thing joins the stack the payer has (gear's stacking, DESIGN §9.4).
        const made = spawn(ctx, { name, owner: payer, holder: payer, ...(row ? { catalog: row } : {}), category: price.category, qty, salt: `buy:${ctx.rng.seed}`, stack: true });
        if (Array.isArray(made)) out.push(...made);
      }
      return out;
    },
  });
  r.effect({ type: "economy.transfer", args: ["to", "cents", "from?", "memo?", "method?"], resolve: (a, ctx) => transfer(hooks, ctx, strOf(a.from) || ctx.world.pov, strOf(a.to), amountOf(a.cents), strOf(a.memo, "Payment"), typeof a.method === "string" ? payMethodOf(a.method) : "auto") });
  r.effect({ type: "economy.move", args: ["from", "to", "cents", "memo?"], resolve: (a, ctx) => move(ctx, strOf(a.from), strOf(a.to), amountOf(a.cents), strOf(a.memo, "Transfer")) });
  // Template `price_modifier`: `percent` (+25 = 25 % dearer) for a `scope` (a category, or all) at a `place`, for `minutes` or until cleared (`percent: 0` or `clear`).
  r.effect({
    type: "economy.price_modifier",
    args: ["percent", "scope?", "place?", "minutes?", "id?", "clear?"],
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
  r.effect({ type: "economy.lose", args: ["item", "thief?"], resolve: (a, ctx) => loseWith(ctx, strOf(a.item), strOf(a.thief) || undefined) });
  r.effect({
    // A card or loan paid by `who` (its first holder when no one is named), from an account of theirs: the one named, else their own deposit account.
    type: "economy.pay_card",
    args: ["card", "from?", "cents?", "who?"],
    resolve(a, ctx) {
      const card = strOf(a.card);
      if (!traitsOf(ctx, card)?.liability) return reject("not_a_liability", `${labelOf(ctx, card)} isn't a card or a loan`);
      const who = strOf(a.who) || holdersOf(ctx.state, card).find((h) => own(ctx.state.entities, h)) || "";
      if (rightsOf(ctx.state, card, who) === null) return reject("not_owner", `${labelOf(ctx, card)} isn't ${labelOf(ctx, who)}'s to pay`);
      const from = strOf(a.from) || depositAccount(ctx, who, card) || "";
      if (from === "") return reject("missing_account", `${labelOf(ctx, who)} has no account to pay ${labelOf(ctx, card)} from`);
      const unusable = mayUse(ctx, who, from, "from");
      if (unusable) return unusable;
      const owed = Math.max(0, -balance(ctx.state, card));
      const cents = typeof a.cents === "number" && a.cents > 0 ? Math.round(a.cents) : owed;
      return move(ctx, from, card, cents, `${own(ctx.state.entities, card)?.name ?? "Card"} payment`);
    },
  });
  r.effect({ type: "economy.withdraw", args: ["account", "cents", "who?"], resolve: (a, ctx) => withdraw(ctx, actor(ctx, a), strOf(a.account), amountOf(a.cents)) });
  r.effect({ type: "economy.deposit", args: ["account", "cents", "who?"], resolve: (a, ctx) => deposit(ctx, actor(ctx, a), strOf(a.account), amountOf(a.cents)) });
  r.effect({ type: "economy.card_state", args: ["card", "state", "who?"], resolve: (a, ctx) => setCardState(ctx, actor(ctx, a), strOf(a.card), strOf(a.state)) });
  r.effect({ type: "economy.card_replace", args: ["card", "who?"], resolve: (a, ctx) => replaceCard(ctx, actor(ctx, a), strOf(a.card)) });
  r.effect({ type: "economy.set_autopay", args: ["account", "mode", "from?", "cents?", "who?"], resolve: (a, ctx) => setAutopay(ctx, actor(ctx, a), strOf(a.account), strOf(a.mode), strOf(a.from), numOf(a.cents)) });
  const FLOW_ARGS = ["label?", "kind?", "from?", "to?", "amount?", "every?", "interval?", "weekday?", "day?", "month?", "at?", "once?", "start?", "end?", "count?", "shortfall?", "retry_days?", "retries?", "fallback?", "roll?", "category?", "who?"];
  r.effect({ type: "economy.flow_create", args: FLOW_ARGS, resolve: (a, ctx) => createFlow(ctx, actor(ctx, a), a) });
  r.effect({ type: "economy.flow_update", args: ["flow", ...FLOW_ARGS, "clear?"], resolve: (a, ctx) => updateFlow(ctx, actor(ctx, a), strOf(a.flow), a) });
  r.effect({ type: "economy.flow_status", args: ["flow", "status", "who?"], resolve: (a, ctx) => setFlowStatus(ctx, actor(ctx, a), strOf(a.flow), a.status === "paused" ? "paused" : a.status === "ended" ? "ended" : "active") });
  r.effect({ type: "economy.apply_credit", args: ["product", "cents?", "term?", "secured_by?", "who?"], resolve: (a, ctx) => applyForCredit(ctx, actor(ctx, a), strOf(a.product), typeof a.cents === "number" && a.cents > 0 ? Math.round(a.cents) : undefined, typeof a.term === "number" && a.term > 0 ? Math.round(a.term) : undefined, strOf(a.secured_by) || undefined) });
  r.effect({ type: "economy.set_pay_prefs", args: ["tiers", "who?"], resolve: (a, ctx) => setPayPrefs(ctx, actor(ctx, a), a.tiers) });
  // The GM's controls that aren't fields (DESIGN §7): close an account, set its status, release a hold.
  r.effect({ type: "economy.close_account", args: ["account"], gm: true, resolve: (a, ctx) => closeAccount(ctx, strOf(a.account)) });
  r.effect({ type: "economy.flow_edit", args: ["flow", "name?", "clear?"], gm: true, resolve: (a, ctx) => editFlow(ctx, strOf(a.flow), typeof a.name === "string" ? a.name : undefined, a.clear) });
  r.effect({ type: "economy.set_status", args: ["account", "status"], gm: true, resolve: (a, ctx) => setStatus(ctx, strOf(a.account), strOf(a.status)) });
  r.effect({ type: "economy.release_hold", args: ["account", "hold"], gm: true, resolve: (a, ctx) => releaseHold(ctx, strOf(a.account), strOf(a.hold)) });
}

function registerActions(r: CoreRegistry): void {
  // The phone's actions are the player's own bookkeeping, done alone: a panel tap records them at once (`mechanical`).
  const phone = { duration: "2", observable: "checks their phone", mechanical: true } as const;
  r.action({ id: "buy", label: "Buy", description: "Buy something: food, drinks, goods or a service, here or delivered.", pack: "economy", params: { item: { type: "text", label: "Item or category" }, qty: { type: "number", optional: true }, price: { type: "money", optional: true, label: "Stated price" }, method: { type: "text", optional: true, label: "Paid with (cash, card, debit or savings)" }, cashback: { type: "money", optional: true, label: "Cash back" } }, requires: ["level.money >= 1"], outcomes: { default: [{ type: "economy.buy", args: { payer: "self", item: "=item", qty: "=qty", price: "=price", method: "=params.method", cashback: "=params.cashback", stated: true } }] }, duration: "5", lexicon: ["buy", "purchase", "order", "pick up a"], observable: "pays for something" });
  r.action({ id: "pay", label: "Pay", description: "Give someone money: settle up, pay them back, tip them.", pack: "economy", params: { to: { type: "ref", ref: "person" }, amount: { type: "money" } }, requires: ["amount > 0", "can_afford(self, amount)"], outcomes: { default: [{ type: "economy.transfer", args: { from: "self", to: "to", cents: "=amount", memo: "Payment" } }] }, duration: "1", lexicon: ["pay", "give money", "send money", "venmo"], observable: "pays someone" });
  r.action({ id: "move_money", label: "Transfer between accounts", description: "Move money between your own accounts: checking, savings, cash.", pack: "economy", params: { from: { type: "ref", ref: "account" }, to: { type: "ref", ref: "account" }, amount: { type: "money" } }, requires: ["spends(self, from)", "holds(self, to)", "amount > 0"], outcomes: { default: [{ type: "economy.move", args: { from: "from", to: "to", cents: "=amount", memo: "Transfer" } }] }, lexicon: ["transfer", "move money", "put into savings"], ...phone });
  r.action({ id: "pay_card", label: "Pay card or loan", description: "Pay off some or all of a card or loan balance.", pack: "economy", params: { card: { type: "ref", ref: "account" }, from: { type: "ref", ref: "account", optional: true }, amount: { type: "money", optional: true } }, requires: ["holds(self, card)", "is_credit(card)", "level.money >= 3"], outcomes: { default: [{ type: "economy.pay_card", args: { card: "card", from: "=params.from", cents: "=amount > 0 ? amount : 0 - balance(card)", who: "self" } }] }, lexicon: ["pay off the card", "pay the card", "pay my credit card", "make a loan payment"], ...phone });
  r.action({ id: "withdraw_cash", label: "Withdraw cash", description: "Take cash out of a bank account.", pack: "economy", params: { account: { type: "ref", ref: "account" }, amount: { type: "money" } }, requires: ["spends(self, account)", "amount > 0", "level.money >= 2"], outcomes: { default: [{ type: "economy.withdraw", args: { account: "account", cents: "=amount", who: "self" } }] }, duration: "3", lexicon: ["withdraw", "take out cash", "hit the atm", "get cash"], observable: "takes out cash" });
  r.action({ id: "deposit_cash", label: "Deposit cash", description: "Put cash into a bank account.", pack: "economy", params: { account: { type: "ref", ref: "account" }, amount: { type: "money" } }, requires: ["holds(self, account)", "amount > 0", "level.money >= 2"], outcomes: { default: [{ type: "economy.deposit", args: { account: "account", cents: "=amount", who: "self" } }] }, duration: "3", lexicon: ["deposit", "pay in cash", "bank the cash"], observable: "pays cash into the bank" });
  const card = { card: { type: "ref" as const, ref: "card" } };
  // A card is changed by its holder, or by whoever manages its account (a business's card by the business's owner), where cards run.
  const cardBy = ["holds(self, card) or manages(self, card.account)", "money_feature('cards', self)"];
  r.action({ id: "card_freeze", label: "Freeze card", description: "Freeze a card so it can't be used.", pack: "economy", params: card, requires: cardBy, outcomes: { default: [{ type: "economy.card_state", args: { card: "card", state: "frozen", who: "self" } }] }, lexicon: ["freeze my card", "lock my card"], ...phone });
  r.action({ id: "card_unfreeze", label: "Unfreeze card", description: "Unfreeze a frozen card.", pack: "economy", params: card, requires: cardBy, outcomes: { default: [{ type: "economy.card_state", args: { card: "card", state: "active", who: "self" } }] }, lexicon: ["unfreeze my card", "unlock my card"], ...phone });
  r.action({ id: "card_report_lost", label: "Report card lost", description: "Report a card lost or stolen.", pack: "economy", params: card, requires: cardBy, outcomes: { default: [{ type: "economy.card_state", args: { card: "card", state: "lost", who: "self" } }] }, lexicon: ["report my card lost", "my card was stolen", "cancel my card"], ...phone });
  r.action({ id: "card_replace", label: "Replace card", description: "Order a replacement card.", pack: "economy", params: card, requires: cardBy, outcomes: { default: [{ type: "economy.card_replace", args: { card: "card", who: "self" } }] }, lexicon: ["replace my card", "order a new card"], ...phone });
  r.action({ id: "set_autopay", label: "Set autopay", description: "Set how a card or loan pays itself each month.", pack: "economy", params: { account: { type: "ref", ref: "account" }, mode: { type: "text", label: "none, minimum, statement, full or fixed" }, from: { type: "ref", ref: "account", optional: true }, amount: { type: "money", optional: true } }, requires: ["manages(self, account)", "is_credit(account)", "level.money >= 3"], outcomes: { default: [{ type: "economy.set_autopay", args: { account: "account", mode: "=params.mode", from: "=params.from", cents: "=params.amount", who: "self" } }] }, lexicon: ["set up autopay", "turn on autopay", "turn off autopay"], ...phone });
  const flowParams = {
    label: { type: "text" as const, optional: true },
    kind: { type: "text" as const, optional: true },
    from: { type: "ref" as const, ref: "account", optional: true },
    to: { type: "text" as const, optional: true, label: "To (an account, someone, or a payee's name)" },
    amount: { type: "money" as const, optional: true },
    every: { type: "text" as const, optional: true, label: "Every (day, week, month, year or once)" },
    interval: { type: "number" as const, optional: true },
    weekday: { type: "number" as const, optional: true },
    day: { type: "number" as const, optional: true },
    month: { type: "number" as const, optional: true },
    at: { type: "text" as const, optional: true },
    once: { type: "text" as const, optional: true },
    start: { type: "text" as const, optional: true },
    end: { type: "text" as const, optional: true },
    count: { type: "number" as const, optional: true },
    shortfall: { type: "text" as const, optional: true },
    retry_days: { type: "number" as const, optional: true },
    retries: { type: "number" as const, optional: true },
    fallback: { type: "text" as const, optional: true },
    roll: { type: "text" as const, optional: true },
    category: { type: "text" as const, optional: true },
  };
  const flowArgs = Object.fromEntries(Object.keys(flowParams).map((k) => [k, `=params.${k}`]));
  // Standing payments are actions wherever they run: from Money 3, or lower where a world's Custom switches run them (DESIGN §25.12).
  const flowsRun = ["money_feature('flows', self)"];
  r.action({ id: "flow_create", label: "Set up a standing payment", description: "Set up a standing payment: a bill, a regular transfer, an allowance.", pack: "economy", params: flowParams, requires: flowsRun, outcomes: { default: [{ type: "economy.flow_create", args: { ...flowArgs, who: "self" } }] }, lexicon: ["set up a standing order", "schedule a payment", "set up a recurring transfer"], ...phone });
  r.action({ id: "flow_update", label: "Change a standing payment", description: "Change a standing payment: its amount, its schedule or its accounts.", pack: "economy", params: { flow: { type: "ref", ref: "flow" }, ...flowParams, clear: { type: "text", optional: true } }, requires: flowsRun, outcomes: { default: [{ type: "economy.flow_update", args: { flow: "flow", ...flowArgs, clear: "=params.clear", who: "self" } }] }, lexicon: ["change the standing order", "change the recurring payment"], ...phone });
  const flowOnly = { flow: { type: "ref" as const, ref: "flow" } };
  r.action({ id: "flow_pause", label: "Pause a standing payment", description: "Pause a standing payment.", pack: "economy", params: flowOnly, requires: flowsRun, outcomes: { default: [{ type: "economy.flow_status", args: { flow: "flow", status: "paused", who: "self" } }] }, lexicon: ["pause the standing order"], ...phone });
  r.action({ id: "flow_resume", label: "Resume a standing payment", description: "Resume a paused standing payment.", pack: "economy", params: flowOnly, requires: flowsRun, outcomes: { default: [{ type: "economy.flow_status", args: { flow: "flow", status: "active", who: "self" } }] }, lexicon: ["resume the standing order"], ...phone });
  r.action({ id: "flow_delete", label: "Cancel a standing payment", description: "Cancel a standing payment.", pack: "economy", params: flowOnly, requires: flowsRun, outcomes: { default: [{ type: "economy.flow_status", args: { flow: "flow", status: "ended", who: "self" } }] }, lexicon: ["cancel the standing order", "stop the recurring payment"], ...phone });
  r.action({ id: "apply_credit", label: "Apply for credit", description: "Apply for a credit card, a credit line or a loan.", pack: "economy", params: { product: { type: "text", label: "Product (credit_card, line_of_credit, loan, or one of the world's)" }, amount: { type: "money", optional: true }, term: { type: "number", optional: true } }, requires: ["level.money >= 3"], outcomes: { default: [{ type: "economy.apply_credit", args: { product: "=params.product", cents: "=params.amount", term: "=params.term", who: "self" } }] }, duration: "15", lexicon: ["apply for a credit card", "apply for a loan", "take out a loan"], observable: "fills in an application" });
  r.action({ id: "set_pay_prefs", label: "Set how I pay", description: "Set the order in which you prefer to pay: cash, debit, credit.", pack: "economy", params: { tiers: { type: "text", label: "Ways to pay, in order: a JSON list of {use, min?, max?, categories?, except?}" } }, requires: ["money_feature('payment_prefs', self)"], outcomes: { default: [{ type: "economy.set_pay_prefs", args: { tiers: "=params.tiers", who: "self" } }] }, lexicon: ["i'd rather pay with"], ...phone });
}

export const economyPack: PackDef = {
  id: "economy",
  label: "Economy",
  version: 1,
  domain: "money",
  requires: ["space"],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });
    for (const def of EVENTS) r.event(def);
    const hooks = emptyHooks();
    const api = makeApi(hooks);
    const registry: FinanceRegistry = {
      core: r,
      api,
      fields: (kind: FinanceKind, fields) => {
        hooks.fields[kind] = { ...(hooks.fields[kind] ?? {}), ...fields };
      },
      flows: (source) => void hooks.flows.push(source),
      amount: (id, provider) => {
        if (own(hooks.amounts, id)) throw new Error(`amount provider ${id} is registered twice`);
        hooks.amounts[id] = provider;
      },
      worth: (source) => void hooks.worth.push(source),
      sale: (hook) => void hooks.sales.push(hook),
      view: (section) => void hooks.views.push(section),
      summary: (source) => void hooks.summaries.push(source),
    };
    // Living costs: a week of everyday spending for the payer's wealth band, as it stands that day.
    registry.amount("economy.living", (ctx, flow) => {
      const cents = livingCost(ctx, wealthOf(hooks, ctx, flow.from));
      return cents === null ? null : { cents, memo: "Living costs", kind: "purchase", category: "living" };
    });
    for (const m of FINANCE_MODULES) m.register(registry);
    for (const k of financeKinds(hooks.fields)) r.kind(k);
    registerRest(r, hooks);
  },
};

export default economyPack;
