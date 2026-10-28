// Paying (DESIGN §25.3, §25.7, §25.8): who pays with what, and the postings it takes. A payer's
// payment preferences choose the way (cash, a debit card, a credit card, an account), the account
// pays within what it has (its credit, its holds, its overdraft policy), a card pays within its
// state and daily limits, and the payee's side lands in their deposit account, a business that
// sells there, or the outside economy. Every payment is one unit: its posting, its journal lines
// and whatever goes with it (an overdraft transfer or fee, sales tax, the card's daily spending).

import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import { apartOf, type LedgerEvent, type PostEvent, type PostingLine } from "../../../shared/ledger";
import { FINANCE_EVENTS, featureOn, type ClassTraits, type FinanceFeature, type PayTier, type TxnKind } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { hashParts } from "../../../shared/hash";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { labelOf, numOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import type { FinanceHooks, SaleTerms } from "./module";
import { isOpened, journalOf, reject, spendOf, UNSIDED_KINDS } from "./journal";
import {
  BANK_PREFIX,
  CORRECTION_ACCOUNT,
  accountsOf,
  accountsWorth,
  anchorOf,
  availableOf,
  balance,
  bankSide,
  canSpend,
  cashOnHolder,
  classOf,
  external,
  hasLedger,
  holdersOf,
  isLost,
  notional,
  openerOf,
  ownersOf,
  productOf,
  rightsOf,
  statusOf,
  traitsOf,
  outsideAccount,
  wealthBand,
  type TableBooks,
} from "./model";

/** How a payment is to be made: as the payer's preferences choose, or a way named in words. */
export type PayMethod = "auto" | "cash" | "card" | "credit" | "debit" | "charge" | "checking" | "savings" | "account";

const PAY_METHODS: readonly PayMethod[] = ["auto", "cash", "card", "credit", "debit", "charge", "checking", "savings", "account"];

/**
 * A payment method said in words ("pay with my card"): an exact method, else "debit"/"checking" →
 * debit, "savings", "charge card" → charge, "credit"/"card" → credit, "cash"/"wallet" → cash;
 * anything else is auto.
 */
export function payMethodOf(text: string): PayMethod {
  const t = text.trim().toLowerCase();
  const exact = PAY_METHODS.find((m) => m === t);
  if (exact) return exact === "card" ? "credit" : exact === "checking" ? "debit" : exact;
  if (/\b(debit|checking|check|bank)\b/.test(t)) return "debit";
  if (/\bsavings?\b/.test(t)) return "savings";
  if (/\bcharge card\b/.test(t)) return "charge";
  if (/\b(credit|card|visa|mastercard|amex)\b/.test(t)) return "credit";
  if (/\b(cash|wallet|coins?)\b/.test(t)) return "cash";
  return "auto";
}

export interface ChargeOptions {
  /** Who receives the money; omitted: the outside market (or `counterparty`). */
  payee?: EntityId;
  method?: PayMethod;
  /** A specific account or card of the payer's to pay from; it declines when it can't cover the amount (level 2+). */
  source?: EntityId;
  /** An account of the payee's the money lands in. */
  deposit?: EntityId;
  /** External counterparty id when there is no payee entity (`employer`, `landlord`, …). */
  counterparty?: string;
  category?: string;
  kind?: TxnKind;
  flow?: string;
  /** A narrated price the charge doesn't match, for the journal: capped at the world's `unpricedCap`, or clamped into the item's band. */
  narrated?: { cents: number; limited: "cap" | "band" };
  /** A purchase at a till: who sells there may be a business (the sale hooks), a card pays as a card, cash back is possible. */
  sale?: { place: string | null; item: string };
  /** Cash handed back on a debit purchase, into the payer's wallet. */
  cashback?: number;
  /** Let a transactional account go into overdraft as its policy allows (payments and flows do; transfers don't). */
  overdraft?: boolean;
  /** When it happens, when that isn't now (a flow at its own instant inside a slot). */
  at?: number;
  /**
   * A payment the story made (a narrated purchase or transfer, DESIGN §9.5): it never fails for
   * cover, and from level 2 it never takes cash or savings below zero (`chooseSource`). The way it
   * names takes it when that way covers it or can run a debt; else the payer's order, then the last
   * way that can run a debt, then a savings account that covers it. Its journal line says it was the
   * story's (`story`); its posting carries `overdraw`, which the funds guard lets through, only from
   * an account that can run a debt. A purchase nothing of the payer's can pay is theirs with nothing
   * charged: its journal line, on no account, says what it would have cost (`unpaid`). A payer whose
   * money is a band alone moves down their band, as level 1 does.
   */
  story?: boolean;
}

export type ChargeService = (ctx: ReadContext, payer: EntityId, cents: number, memo: string, opts?: ChargeOptions) => LedgerEvent[] | Rejection;

export function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

// ---------------------------------------------------------------- levels and features

export function toggles(world: ReadContext["world"]): JsonObject {
  return objOf(objOf(world.packs.economy?.config).features);
}

export function featureFor(ctx: ReadContext, party: EntityId, feature: FinanceFeature): boolean {
  return featureOn(ctx.levelOf(party, "money"), feature, toggles(ctx.world));
}

/** An account's Money level: the highest among the parties who can spend from it (else who hold it), 0 with none in the world. */
export function accountLevel(ctx: ReadContext, account: EntityId): number {
  const owners = ownersOf(ctx.state, account).filter((o) => own(ctx.state.entities, o.party));
  const spenders = owners.filter((o) => rightsOf(ctx.state, account, o.party)?.spend);
  return Math.max(0, ...(spenders.length > 0 ? spenders : owners).map((o) => ctx.levelOf(o.party, "money")));
}

export function accountFeature(ctx: ReadContext, account: EntityId, feature: FinanceFeature): boolean {
  return featureOn(accountLevel(ctx, account), feature, toggles(ctx.world));
}

export function isParty(ctx: ReadContext, id: EntityId): boolean {
  const kind = own(ctx.state.entities, id)?.kind ?? "";
  return kind !== "" && ["person", "business", "trust", "household"].some((k) => kindIs(ctx.registry, ctx.world, kind, k));
}

// ---------------------------------------------------------------- cards

/** The card entities on an account, by id. */
export function cardsOn(state: Readonly<WorldState>, account: EntityId): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.kind === "card" && own(state.entities, id)?.fields.account === account)
    .sort();
}

/** Why a card can't pay for its holder now, or null when it can: frozen, lost, cancelled, its physical card lost, its account not open. */
export function cardProblem(ctx: TableBooks, card: EntityId, holder: EntityId): string | null {
  const e = own(ctx.state.entities, card);
  if (!e || e.kind !== "card") return "isn't a card";
  const name = e.name;
  if (strOf(e.fields.holder) !== holder) return `${name} isn't theirs`;
  const state = strOf(e.fields.state, "active");
  if (state !== "active") return `${name} is ${state}`;
  const item = strOf(e.fields.item);
  if (item !== "" && own(ctx.state.entities, item) && isLost(ctx.state, item)) return `${name} is lost`;
  const account = strOf(e.fields.account);
  if (statusOf(ctx.state, account) !== "open") return `${own(ctx.state.entities, account)?.name ?? account} is ${statusOf(ctx.state, account).replace(/_/g, " ")}`;
  return null;
}

// ---------------------------------------------------------------- choosing what pays

interface Source {
  account: EntityId;
  card?: EntityId;
  via: "cash" | "debit" | "credit" | "charge" | "account" | "savings";
}

/** Accounts a party can spend from that pay at all: open, of a class that pays. */
function spendable(ctx: TableBooks, party: EntityId): EntityId[] {
  return accountsOf(ctx, party, "spend").filter((id) => statusOf(ctx.state, id) === "open" && traitsOf(ctx, id)?.pays === true);
}

/** Card-carried classes: transactional accounts carry debit cards, credit and charge cards their own. */
function cardSources(ctx: ReadContext, payer: EntityId, accounts: readonly EntityId[], via: Source["via"], till: boolean, problems: string[]): Source[] {
  const out: Source[] = [];
  const cards = featureFor(ctx, payer, "cards");
  for (const account of accounts) {
    const instruments = cardsOn(ctx.state, account);
    if (!till || !cards || instruments.length === 0) {
      // An account without cards (or a payment that isn't at a till) pays as the account.
      out.push({ account, via });
      continue;
    }
    for (const card of instruments) {
      if (strOf(own(ctx.state.entities, card)?.fields.holder) !== payer) continue;
      const problem = cardProblem(ctx, card, payer);
      if (problem) problems.push(problem);
      else out.push({ account, card, via });
    }
  }
  return out;
}

function sourcesFor(ctx: ReadContext, payer: EntityId, use: string, till: boolean, problems: string[]): Source[] {
  const mine = spendable(ctx, payer);
  const where = (pred: (t: ClassTraits, cls: string) => boolean): EntityId[] =>
    mine.filter((id) => {
      const t = traitsOf(ctx, id);
      return t !== null && pred(t, classOf(ctx, id) ?? "");
    });
  switch (use) {
    case "cash":
      return till ? where((t) => t.cash).filter((id) => cashOnHolder(ctx.state, id, payer)).map((account) => ({ account, via: "cash" })) : [];
    case "debit":
    case "checking":
      return cardSources(ctx, payer, where((t) => t.transactional), till ? "debit" : "account", till, problems);
    case "credit":
    case "card":
      return cardSources(ctx, payer, where((_t, c) => c === "credit_card" || (!till && c === "line_of_credit")), "credit", till, problems);
    case "charge":
      return cardSources(ctx, payer, where((_t, c) => c === "charge_card"), "charge", till, problems);
    case "savings":
      return where((_t, c) => c === "savings" || c === "money_market" || c === "trust").map((account) => ({ account, via: "savings" }));
    default: {
      const e = own(ctx.state.entities, use);
      if (e?.kind === "card") {
        const problem = cardProblem(ctx, use, payer);
        if (problem) {
          problems.push(problem);
          return [];
        }
        const account = strOf(e.fields.account);
        return mine.includes(account) ? [{ account, card: use, via: e.fields.network === "debit" ? "debit" : e.fields.network === "charge" ? "charge" : "credit" }] : [];
      }
      return mine.includes(use) ? [{ account: use, via: classOf(ctx, use) === "cash" ? "cash" : "account" }] : [];
    }
  }
}

/** The overdraft a transactional account allows on top of what it has: its policy's room, where overdrafts run. */
export function overdraftRoom(ctx: ReadContext, account: EntityId): number {
  const t = traitsOf(ctx, account);
  if (!t?.transactional || !accountFeature(ctx, account, "overdraft")) return 0;
  const p = productOf(ctx, account);
  if (!p) return 0;
  if (p.overdraft === "fee") return Math.max(0, p.overdraft_limit);
  if (p.overdraft === "linked") {
    const link = strOf(own(ctx.state.entities, account)?.fields.overdraft_link);
    const holders = holdersOf(ctx.state, account);
    return link !== "" && holders.some((h) => canSpend(ctx.state, link, h)) ? Math.max(0, availableOf(ctx, link)) : 0;
  }
  return 0;
}

/** What a card may still spend today on purchases, or at a machine; Infinity where daily limits don't run. */
export function cardRoom(ctx: ReadContext, card: EntityId, what: "purchase" | "atm"): number {
  const e = own(ctx.state.entities, card);
  if (!e) return Infinity;
  const account = strOf(e.fields.account);
  if (!accountFeature(ctx, account, "daily_limits")) return Infinity;
  const p = productOf(ctx, account);
  const field = what === "purchase" ? "daily_purchase_limit" : "daily_atm_limit";
  const limit = typeof e.fields[field] === "number" ? (e.fields[field] as number) : (p?.[field] ?? null);
  if (limit === null) return Infinity;
  const day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex;
  const spent = spendOf(ctx.state, card, day)[what];
  return Math.max(0, limit - spent);
}

function covers(ctx: ReadContext, s: Source, cents: number, overdraft: boolean): boolean {
  if (s.card && cardRoom(ctx, s.card, "purchase") < cents) return false;
  return availableOf(ctx, s.account) + (overdraft ? overdraftRoom(ctx, s.account) : 0) >= cents;
}

/**
 * Whether an account can run a debt past what it covers when the story pays from it (DESIGN §9.5,
 * §25.10): a checking account goes into overdraft, and a revolving credit account over its limit.
 * Cash, savings and the like have neither.
 */
export function runsDebt(ctx: ReadContext, account: EntityId): boolean {
  const t = traitsOf(ctx, account);
  return t !== null && (t.transactional || t.revolving);
}

/** The ways a party pays by default: by their wealth and their manner (DESIGN §25.7). */
export function defaultTiers(ctx: ReadContext, who: EntityId): PayTier[] {
  const e = own(ctx.state.entities, who);
  const band = hasLedger(ctx, who) ? wealthBand(shownWorth(ctx, who)) : strOf(e?.fields.wealth, "modest");
  const traits = (Array.isArray(e?.fields.traits) ? e.fields.traits : []).map((t) => String(t).toLowerCase()).join(" ");
  const careful = /\b(frugal|thrifty|careful|cautious|old-fashioned|old fashioned|prudent|stingy|saver)\b/.test(traits);
  const loose = /\b(impulsive|reckless|spendthrift|flashy|extravagant|generous|lavish)\b/.test(traits);
  if (kindIs(ctx.registry, ctx.world, e?.kind ?? "", "business")) return [{ use: "debit" }, { use: "credit" }];
  if (loose) return [{ use: "credit" }, { use: "charge" }, { use: "debit" }, { use: "cash" }];
  switch (band) {
    case "broke":
    case "poor":
      return [{ use: "cash", max: careful ? 5000 : 2000 }, { use: "debit" }, { use: "credit" }];
    case "modest":
      return careful ? [{ use: "cash", max: 5000 }, { use: "debit" }, { use: "credit", min: 50_000 }] : [{ use: "cash", max: 1000 }, { use: "debit", max: 20_000 }, { use: "credit" }, { use: "debit" }];
    case "comfortable":
      return careful ? [{ use: "cash", max: 1000 }, { use: "debit" }, { use: "credit" }] : [{ use: "cash", max: 500 }, { use: "credit" }, { use: "debit" }];
    default:
      return [{ use: "charge" }, { use: "credit" }, { use: "debit" }];
  }
}

/** A party's share of its accounts, an unopened account at the opening it will post. */
export function shownWorth(ctx: TableBooks, who: EntityId): number {
  return accountsWorth(ctx, who, (id) => balance(ctx.state, id) + (isOpened(ctx.state, id, openerOf(ctx.state, id)) ? 0 : Math.round(numOf(own(ctx.state.entities, id)?.fields.opening))));
}

/** A party's payment preferences: their own tiers when they set any, else the defaults. */
export function tiersOf(ctx: ReadContext, who: EntityId): PayTier[] {
  const raw = own(ctx.state.entities, who)?.fields.pay_prefs;
  const own_: PayTier[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const o = objOf(t);
    if (typeof o.use !== "string" || o.use === "") continue;
    const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
    own_.push({ use: o.use, ...(typeof o.min === "number" ? { min: o.min } : {}), ...(typeof o.max === "number" ? { max: o.max } : {}), ...(list(o.categories) ? { categories: list(o.categories) } : {}), ...(list(o.except) ? { except: list(o.except) } : {}) });
  }
  return own_.length > 0 ? own_ : defaultTiers(ctx, who);
}

function tierFits(t: PayTier, cents: number, category: string): boolean {
  if (t.min !== undefined && cents < t.min) return false;
  if (t.max !== undefined && cents > t.max) return false;
  if (t.categories && t.categories.length > 0 && !t.categories.includes(category)) return false;
  return !(t.except && t.except.includes(category));
}

export interface Picked {
  account: EntityId;
  card?: EntityId;
  via: Source["via"];
  /** A payment the story made that goes another way than the one its words named: the account they named (`TxnMeta.named`). */
  named?: EntityId;
}

/** What a payer's method tries, in order, once each: a way named in words, else the payer's preferences, then anything they can spend from in the usual order. */
function sourcesToTry(ctx: ReadContext, payer: EntityId, cents: number, opts: { method?: PayMethod; category?: string; except?: EntityId; till: boolean }, problems: string[]): Source[] {
  const level = ctx.levelOf(payer, "money");
  const method = opts.method ?? "auto";
  const category = opts.category ?? "";
  let uses: string[];
  if (method === "account") uses = ["checking", "credit", "charge", "savings"];
  else if (method === "auto") {
    const tiers = level >= 2 && featureFor(ctx, payer, "payment_prefs") ? tiersOf(ctx, payer).filter((t) => tierFits(t, cents, category)).map((t) => t.use) : [];
    uses = [...tiers, ...(level >= 2 ? ["cash", "debit", "credit", "charge"] : ["cash", "debit", "credit", "savings"])];
  } else uses = method === "card" ? ["credit", "charge"] : method === "checking" ? ["debit"] : [method];
  const tried = new Set<string>();
  const out: Source[] = [];
  for (const use of uses) {
    for (const s of sourcesFor(ctx, payer, use, opts.till, problems)) {
      const key = `${s.account}|${s.card ?? ""}`;
      if (s.account === opts.except || tried.has(key)) continue;
      tried.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * The most one payment could take now from any single source the payer's method would use (what
 * a partial payment can pay): never more than that source has, with what overdraft its policy allows.
 */
export function mostPayable(ctx: ReadContext, payer: EntityId, cents: number, opts: { method?: PayMethod; category?: string; till: boolean; overdraft: boolean }): number {
  const room = (s: Source): number => Math.min(s.card ? cardRoom(ctx, s.card, "purchase") : Infinity, availableOf(ctx, s.account) + (opts.overdraft ? overdraftRoom(ctx, s.account) : 0));
  return Math.max(0, ...sourcesToTry(ctx, payer, cents, opts, []).map(room));
}

/** Sources once each, in order: an account with the same card (or none) a second time adds nothing. */
function distinct(sources: readonly Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.account}|${s.card ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Why a payment the story made moves no money: nothing of the payer's covers it or can run a debt (`chooseSource`). */
export const NO_WAY_TO_PAY = "no_way_to_pay";

/**
 * What a payment comes from, or a decline (from level 2; level 1 overdraws instead). A named source
 * (an account or a card of the payer's) pays when it can; a named loan or brokerage account falls
 * back to the usual choice. A way named in words (a card, cash, savings) is tried first; otherwise
 * the payer's preferences, tier by tier, then anything they can spend from that covers it.
 *
 * A payment the story made (`story`, DESIGN §9.5) never declines for cover, and from level 2 it
 * never takes cash or savings below zero. The way it names (a source, then a way in words) takes it
 * when that way covers it or can run a debt (`runsDebt`: into overdraft, or over a credit limit):
 * the story wins. Otherwise it goes through the payer's own order, and when nothing there covers it,
 * the last way in that order that can run a debt takes it whole; with none, any account of theirs
 * that can, else a savings account that covers it. With none of those it is refused
 * (`NO_WAY_TO_PAY`): a purchase is then the payer's with nothing charged, and a transfer moves
 * nothing. A way other than the one its words named carries that account (`Picked.named`).
 */
export function chooseSource(ctx: ReadContext, payer: EntityId, cents: number, opts: { method?: PayMethod; source?: EntityId; category?: string; except?: EntityId; till: boolean; overdraft: boolean; story?: boolean }): Picked | Rejection {
  const level = ctx.levelOf(payer, "money");
  const story = opts.story === true && level >= 2;
  const problems: string[] = [];
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  const named = opts.source ? sourcesFor(ctx, payer, opts.source, opts.till, problems).filter((s) => s.account !== opts.except) : [];
  const first = named[0];
  if (first && (level < 2 || covers(ctx, first, cents, opts.overdraft) || (story && runsDebt(ctx, first.account)))) return first;
  if (opts.source && !opts.story) {
    if (first) return reject("declined", first.card ? `${labelOf(ctx, first.card)} was declined for ${money(cents)}` : `${labelOf(ctx, first.account)} can't cover ${money(cents)}`);
    if (problems.length > 0) return reject("declined", `${problems[0]}`);
  }
  const method = opts.method ?? "auto";
  const tried = sourcesToTry(ctx, payer, cents, opts, problems);
  const said = story ? (first?.account ?? (method !== "auto" ? tried[0]?.account : undefined)) : undefined;
  const elsewhere = (s: Source): Picked => (said !== undefined && s.account !== said ? { ...s, named: said } : s);
  if (story && method !== "auto") {
    const way = tried.find((s) => covers(ctx, s, cents, opts.overdraft)) ?? tried.find((s) => runsDebt(ctx, s.account));
    if (way) return elsewhere(way);
  }
  const candidates = opts.story && method !== "auto" ? distinct([...tried, ...sourcesToTry(ctx, payer, cents, { ...opts, method: "auto" }, [])]) : tried;
  const hit = candidates.find((s) => covers(ctx, s, cents, opts.overdraft));
  if (hit) return elsewhere(hit);
  const account = (id: EntityId): Source => ({ account: id, via: "account" });
  if (level < 2) {
    const fallback = tried[0] ?? spendable(ctx, payer).filter((id) => id !== opts.except).map(account)[0];
    if (fallback) return fallback;
  }
  const name = own(ctx.state.entities, payer)?.name ?? payer;
  if (story) {
    const debt = candidates.findLast((s) => runsDebt(ctx, s.account)) ?? spendable(ctx, payer).filter((id) => id !== opts.except && runsDebt(ctx, id)).map(account).at(-1);
    const saved = debt ?? sourcesFor(ctx, payer, "savings", opts.till, []).find((s) => s.account !== opts.except && covers(ctx, s, cents, false));
    return saved ? elsewhere(saved) : reject(NO_WAY_TO_PAY, `${name} has nothing that covers ${money(cents)} or can run a debt, so nothing was paid`);
  }
  if (problems.length > 0 && (method !== "auto" || candidates.length === 0)) return reject("declined", problems[0] ?? `${name}'s card was declined`);
  return reject("declined", method === "credit" || method === "card" || method === "charge" ? `${name}'s card was declined` : `${name} doesn't have ${money(cents)} available`);
}

// ---------------------------------------------------------------- deposits and the payee's side

/** Where money paid to a party lands by default: a business's operating account, else their best open deposit account (never `except`). */
export function depositAccount(ctx: TableBooks, party: EntityId, except?: EntityId): EntityId | null {
  const operating = strOf(own(ctx.state.entities, party)?.fields.operating_account);
  if (operating !== "" && operating !== except && rightsOf(ctx.state, operating, party)?.worth && statusOf(ctx.state, operating) === "open") return operating;
  const ranked = accountsOf(ctx, party, "worth")
    .filter((id) => id !== except && statusOf(ctx.state, id) === "open")
    .map((id) => ({ id, rank: traitsOf(ctx, id)?.depositRank ?? null }))
    .filter((x): x is { id: EntityId; rank: number } => x.rank !== null && !(traitsOf(ctx, x.id)?.cash === true && !cashOnHolder(ctx.state, x.id, party)));
  ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return ranked[0]?.id ?? null;
}

/** A party's carried cash account (the wallet), else any cash account of theirs. */
export function cashAccount(ctx: TableBooks, party: EntityId): EntityId | null {
  const cash = accountsOf(ctx, party, "spend").filter((id) => classOf(ctx, id) === "cash");
  return cash.find((id) => cashOnHolder(ctx.state, id, party)) ?? cash[0] ?? null;
}

/** Level-1 band bookkeeping for a party without accounts whose outside account moves by `delta`. */
export function l1Move(state: Readonly<WorldState>, who: EntityId, delta: number): LedgerEvent[] {
  const a = anchorOf(state, who);
  const after = notional(state, who) + delta;
  const band = wealthBand(after);
  const explicit = strOf(objOf(own(objOf(objOf(state.packs.economy).anchors), who)).band) === a.band;
  const out: LedgerEvent[] = [];
  if (!explicit || band !== a.band) out.push({ type: FINANCE_EVENTS.anchor, data: { entity: who, band, typical: a.typical, base: a.base } });
  if (band !== strOf(own(state.entities, who)?.fields.wealth, "modest")) out.push({ type: "set", entity: who, field: "wealth", value: band });
  return out;
}

/**
 * The account a payment to `payee`, someone in the world, lands in: the named deposit account it
 * holds, else its default deposit account; null where it lands outside (they keep no accounts, or
 * aren't followed). The fiduciary rule judges a payee named as a party by it (DESIGN §25.1).
 */
export function payeeAccount(ctx: ReadContext, payee: EntityId, deposit?: EntityId): EntityId | null {
  if (!own(ctx.state.entities, payee) || !hasLedger(ctx, payee) || ctx.levelOf(payee, "money") < 1) return null;
  const named = deposit && rightsOf(ctx.state, deposit, payee) && statusOf(ctx.state, deposit) === "open" ? deposit : undefined;
  return named ?? depositAccount(ctx, payee);
}

/** Where money lands for a payee: the named deposit account it holds, else its default deposit account, else its outside account (level-1 band moves). */
export function payeeSide(ctx: ReadContext, opts: Pick<ChargeOptions, "payee" | "deposit" | "counterparty">, cents: number): { account: string; extra: LedgerEvent[] } {
  const payee = opts.payee;
  if (payee && own(ctx.state.entities, payee)) {
    const deposit = payeeAccount(ctx, payee, opts.deposit);
    if (deposit) return { account: deposit, extra: [] };
    const extra = ctx.levelOf(payee, "money") >= 1 && !hasLedger(ctx, payee) ? l1Move(ctx.state, payee, cents) : [];
    return { account: external(payee), extra };
  }
  return { account: outsideAccount(opts.counterparty ?? "market"), extra: [] };
}

// ---------------------------------------------------------------- journal lines and units

export interface TxnMeta {
  memo: string;
  kind?: TxnKind;
  category?: string;
  /** Who the money goes to: someone in the world by id, else an outside payee by name or key. */
  counterparty?: string;
  /** Who it comes from, the same way. */
  payer?: string;
  card?: EntityId;
  flow?: string;
  pending?: number;
  narrated?: ChargeOptions["narrated"];
  /** A payment the story made that went another way than the one it named: the account it named, which Pay another way tries first. */
  named?: EntityId;
  /** A purchase the story made that nothing its payer has could pay, so nothing was charged: what it would have cost. Its journal line has no lines. */
  unpaid?: number;
  /** A payment the story made (DESIGN §9.5): Pay another way and its chip find it by this. */
  story?: boolean;
  at?: number;
}

/**
 * A posting's journal lines: the lines on accounts in the world, what the payment was, and its two
 * sides, so each line can name the one opposite it. A side the poster doesn't name is the account
 * of its biggest line, which the journal files as whoever holds it; an opening or an adjustment has
 * no sides.
 */
export function txn(lines: readonly PostingLine[], meta: TxnMeta): LedgerEvent {
  const mine = lines.filter((l) => !l.account.startsWith(EXTERNAL_ACCOUNT_PREFIX));
  const data: JsonObject = { memo: meta.memo, lines: mine.map((l) => ({ account: l.account, amount: l.amount })) };
  if (meta.kind) data.kind = meta.kind;
  if (meta.category) data.category = meta.category;
  if (!UNSIDED_KINDS.has(meta.kind ?? "")) {
    const biggest = (sign: number): string | undefined => lines.reduce<PostingLine | undefined>((top, l) => (Math.sign(l.amount) === sign && (top === undefined || Math.abs(l.amount) > Math.abs(top.amount)) ? l : top), undefined)?.account;
    const payee = meta.counterparty || biggest(1);
    const payer = meta.payer || biggest(-1);
    if (payee) data.counterparty = payee;
    if (payer) data.payer = payer;
  }
  if (meta.card) data.card = meta.card;
  if (meta.flow) data.flow = meta.flow;
  if (meta.pending !== undefined) {
    data.status = "pending";
    data.settles = meta.pending;
  }
  if (meta.narrated) {
    data.narrated = meta.narrated.cents;
    data.limited = meta.narrated.limited;
  }
  if (meta.named) data.named = meta.named;
  if (meta.unpaid !== undefined) data.unpaid = meta.unpaid;
  if (meta.story) data.story = true;
  if (meta.at !== undefined) data.at = meta.at;
  return { type: FINANCE_EVENTS.txn, data };
}

/** A posting and its journal lines. */
export function posting(lines: PostingLine[], meta: TxnMeta): LedgerEvent[] {
  return [{ type: "post", lines, memo: meta.memo }, txn(lines, meta)];
}

/**
 * One payment as an atomic unit (ledger 1.10): its posting, its journal lines and any bookkeeping
 * beside it share a group, so a rebased view that can't afford the posting drops all of them.
 */
export function asUnit(events: LedgerEvent[]): LedgerEvent[] {
  if (events.length < 2) return events;
  const group = `pay:${hashParts(JSON.stringify(events)).slice(0, 10)}`;
  return events.map((e) => ({ ...e, group }));
}

/**
 * What a payment brought, kept apart from the payment's own unit `unit` (`APART_GROUP`), before it:
 * a rebased view keeps it only with the payment, and may drop it alone.
 */
function apartFrom(events: LedgerEvent[], unit: readonly LedgerEvent[]): LedgerEvent[] {
  const group = unit[0]?.group;
  return group === undefined ? events : events.map((e) => ({ ...e, group: apartOf(group) }));
}

/**
 * A correction's unit tied to the units it puts right (`EventBase.tiedTo`), by their groups: a
 * rebased view that drops any of them drops it too. Groups that aren't there are left out.
 */
function tied(unit: LedgerEvent[], groups: readonly (string | undefined)[]): LedgerEvent[] {
  const to = [...new Set(groups.filter((g): g is string => g !== undefined))];
  return to.length === 0 ? unit : unit.map((e) => ({ ...e, tiedTo: to }));
}

/** Folds lines on the same account into one line each (a sale's tax landing with its price). */
function merged(lines: readonly PostingLine[]): PostingLine[] {
  const out: PostingLine[] = [];
  for (const l of lines) {
    if (l.amount === 0) continue;
    const same = out.find((x) => x.account === l.account);
    if (same) same.amount += l.amount;
    else out.push({ ...l });
  }
  return out.filter((l) => l.amount !== 0);
}

/** Overdraft fees an account was charged today (at most three a day). */
function overdraftFeesToday(ctx: ReadContext, account: EntityId): number {
  const cal = calendarOf(ctx.world);
  const today = dateAt(cal, ctx.state.clock).dayIndex;
  return journalOf(ctx.state, account).filter((j) => j.kind === "fee" && j.category === "overdraft" && dateAt(cal, j.at).dayIndex === today).length;
}

/**
 * What an account's overdraft policy adds to a payment that takes more than it has: a transfer from
 * the linked account first, of the gap or, for a payment the story made past it, of all the link
 * has; or the overdraft fee after.
 */
export function overdraftEvents(ctx: ReadContext, account: EntityId, total: number, at: number): { before: LedgerEvent[]; after: LedgerEvent[] } {
  const short = total - availableOf(ctx, account);
  const room = overdraftRoom(ctx, account);
  if (short <= 0 || room <= 0) return { before: [], after: [] };
  const p = productOf(ctx, account);
  if (!p) return { before: [], after: [] };
  if (p.overdraft === "linked") {
    const link = strOf(own(ctx.state.entities, account)?.fields.overdraft_link);
    const moved = Math.min(short, room);
    const lines: PostingLine[] = [
      { account: link, amount: -moved },
      { account, amount: moved },
    ];
    return { before: posting(lines, { memo: `Overdraft transfer from ${labelOf(ctx, link)}`, kind: "transfer", category: "transfer", at }), after: [] };
  }
  const fee = accountFeature(ctx, account, "fees") && overdraftFeesToday(ctx, account) < 3 ? p.fees.overdraft : 0;
  if (fee <= 0) return { before: [], after: [] };
  const lines: PostingLine[] = [
    { account, amount: -fee },
    { account: bankSide(p.institution), amount: fee },
  ];
  return { before: [], after: posting(lines, { memo: "Overdraft fee", kind: "fee", category: "overdraft", at }) };
}

/** What a sale at a till brings with it: the first sale hook that names a seller or tax there. */
function saleTermsOf(hooks: FinanceHooks, ctx: ReadContext, payer: EntityId, cents: number, category: string, sale: NonNullable<ChargeOptions["sale"]>): SaleTerms | null {
  for (const hook of hooks.sales) {
    const terms = hook(ctx, { payer, place: sale.place, category, cents, item: sale.item });
    if (terms) return terms;
  }
  return null;
}

/**
 * Pay `cents`: a no-op at level 0, a band check plus adjustment at 1, a posting (with declines) from
 * 2. A payment the story made (`story`) never declines for cover; a purchase nothing of the payer's
 * can pay (`NO_WAY_TO_PAY`) charges nothing, and its journal line, on no account, says what it would
 * have cost (`unpaid`), so it is still theirs (DESIGN §9.5). Its journal line says it was the story's
 * (`story`), and its posting carries `overdraw` only from an account that can run a debt, so one from
 * cash or savings drops whole on a rebased view that can't cover it.
 */
export function charge(hooks: FinanceHooks, ctx: ReadContext, payer: EntityId, rawCents: number, memo: string, opts: ChargeOptions = {}): LedgerEvent[] | Rejection {
  if (!own(ctx.state.entities, payer)) return reject("missing_entity", `no payer ${labelOf(ctx, payer)}`);
  const cents = Math.round(rawCents);
  if (!(cents > 0)) return [];
  const level = ctx.levelOf(payer, "money");
  if (level === 0) return [];
  const at = opts.at ?? ctx.state.clock;
  const terms = opts.sale ? saleTermsOf(hooks, ctx, payer, cents, opts.category ?? "", opts.sale) : null;
  const tax = Math.max(0, Math.round(terms?.tax ?? 0));
  const cashback = Math.max(0, Math.round(opts.cashback ?? 0));
  const total = cents + tax + cashback;
  const overdraft = opts.overdraft !== false;
  const out: LedgerEvent[] = [];
  let source: string;
  let picked: Picked | null = null;
  if (hasLedger(ctx, payer)) {
    const p = chooseSource(ctx, payer, total, { method: opts.method, source: opts.source, category: opts.category, till: opts.sale !== undefined, overdraft, story: opts.story === true });
    if ("code" in p) return opts.story === true && opts.kind === "purchase" && p.code === NO_WAY_TO_PAY ? [txn([], { memo, kind: "purchase", ...(opts.category ? { category: opts.category } : {}), payer, unpaid: total })] : p;
    picked = p;
    source = p.account;
    if (cashback > 0 && p.via !== "debit") return reject("no_cashback", "cash back comes only with a debit card");
  } else {
    if (cashback > 0) return reject("no_cashback", "cash back needs an account");
    if (level >= 1 && opts.story !== true && notional(ctx.state, payer) < total) return reject("declined", `${labelOf(ctx, payer)} can't afford ${formatMoney(total, ctx.world.currency)}`);
    source = external(payer);
    out.push(...l1Move(ctx.state, payer, -total));
  }
  const dest = terms?.seller ? payeeSide(ctx, { payee: terms.seller, ...(terms.deposit ? { deposit: terms.deposit } : {}) }, cents) : payeeSide(ctx, opts, cents);
  const wallet = cashback > 0 ? cashAccount(ctx, payer) : null;
  if (cashback > 0 && !wallet) return reject("no_cashback", `${labelOf(ctx, payer)} has nowhere to carry cash`);
  const lines = merged([
    { account: source, amount: -total },
    { account: dest.account, amount: cents },
    ...(tax > 0 ? [{ account: terms?.taxAccount ?? dest.account, amount: tax }] : []),
    ...(wallet ? [{ account: wallet, amount: cashback }] : []),
  ]);
  const od = picked && overdraft ? overdraftEvents(ctx, source, total, at) : { before: [], after: [] };
  const holds = picked?.card !== undefined && featureFor(ctx, payer, "holds");
  // The other side by id when it's someone in the world (a view names it, or masks it), else the outside party's name.
  const outside = opts.counterparty === undefined ? undefined : own(ctx.state.entities, opts.counterparty) ? opts.counterparty : opts.counterparty.replace(/_/g, " ");
  const counterparty = terms?.seller ?? opts.payee ?? outside;
  const meta: TxnMeta = { memo, kind: opts.kind ?? (opts.sale ? "purchase" : "payment"), ...(opts.category ? { category: opts.category } : {}), ...(counterparty ? { counterparty } : {}), payer, ...(picked?.card ? { card: picked.card } : {}), ...(opts.flow ? { flow: opts.flow } : {}), ...(holds ? { pending: at + 1440 } : {}), ...(opts.narrated ? { narrated: opts.narrated } : {}), ...(picked?.named ? { named: picked.named } : {}), ...(opts.story === true ? { story: true } : {}), ...(opts.at !== undefined ? { at: opts.at } : {}) };
  const spend: LedgerEvent[] = [];
  if (picked?.card && opts.sale && Number.isFinite(cardRoom(ctx, picked.card, "purchase"))) {
    const day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex;
    const s = spendOf(ctx.state, picked.card, day);
    spend.push({ type: FINANCE_EVENTS.spend, data: { card: picked.card, day, purchase: s.purchase + cents + tax, atm: s.atm } });
  }
  const overdraw = opts.story === true && picked !== null && runsDebt(ctx, source);
  const paid = asUnit([{ type: "post", lines, memo, ...(overdraw ? { overdraw: true as const } : {}) }, ...out, ...dest.extra, txn(lines, meta), ...(terms?.extra ?? []), ...od.after, ...spend]);
  // A payment the story made runs a debt on any path, and its overdraft link's transfer is kept apart
  // (DESIGN §25.10): a rebased view whose link can't spare it drops the transfer alone, and the
  // payment takes the account the further into overdraft, never the link below zero.
  return opts.story === true ? [...apartFrom(od.before, paid), ...paid] : asUnit([...od.before, ...paid]);
}

// ---------------------------------------------------------------- moving money

/** A party who can move money from one account to the other: spends from `from` and holds `to`. */
export function moverOf(ctx: TableBooks, from: EntityId, to: EntityId): EntityId | null {
  return holdersOf(ctx.state, from).find((p) => canSpend(ctx.state, from, p) && rightsOf(ctx.state, to, p) !== null) ?? null;
}

/**
 * Whether a party may use an account on one side of a payment, the one check the foundation and
 * every module make: to pay `from` it, the account is open, the party may spend from it, and it
 * isn't locked (a CD's or retirement account's money comes out only on its own terms); to pay
 * `into` it, the account isn't closed and the party holds it, and it isn't a CD (its deposit is
 * made when it opens). Null when it may.
 */
export function mayUse(ctx: ReadContext, party: EntityId, account: EntityId, side: "from" | "into"): Rejection | null {
  const t = traitsOf(ctx, account);
  if (own(ctx.state.entities, account)?.kind !== "account" || !t) return reject("missing_account", `there's no account ${labelOf(ctx, account)}`);
  const status = statusOf(ctx.state, account);
  if (side === "from") {
    if (status !== "open") return reject("declined", `${labelOf(ctx, account)} is ${status.replace(/_/g, " ")}`);
    if (!canSpend(ctx.state, account, party)) return reject("not_owner", `${labelOf(ctx, party)} can't spend from ${labelOf(ctx, account)}`);
    return t.locked ? reject("locked", `${labelOf(ctx, account)} can't be drawn on here`) : null;
  }
  if (status === "closed") return reject("declined", `${labelOf(ctx, account)} is closed`);
  if (rightsOf(ctx.state, account, party) === null) return reject("not_owner", `${labelOf(ctx, account)} isn't ${labelOf(ctx, party)}'s`);
  return classOf(ctx, account) === "cd" ? reject("locked", `${labelOf(ctx, account)} takes nothing in after it opens`) : null;
}

/** A cash advance's fee on a credit account, where fees run: the product's percentage of it, at least its minimum. */
export function cashAdvanceFee(ctx: ReadContext, account: EntityId, cents: number): number {
  const p = productOf(ctx, account);
  if (!p || !traitsOf(ctx, account)?.revolving || !accountFeature(ctx, account, "fees")) return 0;
  return p.fees.cash_advance_pct > 0 || p.fees.cash_advance_min > 0 ? Math.max(p.fees.cash_advance_min, Math.round((cents * p.fees.cash_advance_pct) / 100)) : 0;
}

/**
 * A posting between two accounts a party holds (a savings transfer, a card or loan payment). A
 * payment to credit pays at most what it owes (`cap`, or refused as an overpayment); money in a CD
 * or retirement account doesn't move out here, and nothing moves into a closed account or a CD.
 * Money moved from a credit card into an account is a cash advance, with its fee posted first. A move
 * the story made (`story`, DESIGN §9.5) from an account that can run a debt (`runsDebt`) isn't
 * refused for cover, and its posting carries `overdraw`; from any other account it is checked as
 * ever. Its journal line says it was the story's, and one that went another way than the account it
 * named records that account (`named`), for Pay another way.
 */
export function move(ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string, opts: { cap?: boolean; flow?: string; at?: number; unchecked?: boolean; story?: boolean; named?: EntityId } = {}): LedgerEvent[] | Rejection {
  const s = ctx.state;
  if (own(s.entities, from)?.kind !== "account" || own(s.entities, to)?.kind !== "account") return reject("missing_account", "both accounts must exist");
  if (from === to) return reject("bad_party", `${labelOf(ctx, from)} can't pay itself`);
  const party = moverOf(ctx, from, to);
  if (!party) return reject("not_owner", "both accounts must belong to the same holder");
  const fromTraits = traitsOf(ctx, from);
  const toTraits = traitsOf(ctx, to);
  if (!fromTraits || !toTraits) return reject("missing_account", "both accounts must exist");
  const unusable = mayUse(ctx, party, from, "from") ?? mayUse(ctx, party, to, "into");
  if (unusable) return unusable;
  let c = Math.round(cents);
  if (!(c > 0)) return reject("bad_amount", "the amount must be positive");
  if (toTraits.liability) {
    const owed = -balance(s, to);
    if (owed <= 0) return reject("nothing_owed", `${labelOf(ctx, to)} owes nothing`);
    if (c > owed) {
      if (!opts.cap) return reject("overpay", `${labelOf(ctx, to)} owes only ${formatMoney(owed, ctx.world.currency)}`);
      c = owed;
    }
  }
  const advance = fromTraits.revolving && !toTraits.liability;
  const fee = advance ? cashAdvanceFee(ctx, from, c) : 0;
  const debt = opts.story === true && runsDebt(ctx, from);
  if (!opts.unchecked && !debt && ctx.levelOf(party, "money") >= 2 && availableOf(ctx, from) < c + fee) return reject("declined", `${labelOf(ctx, from)} doesn't have ${formatMoney(c + fee, ctx.world.currency)}`);
  const lines: PostingLine[] = [
    { account: from, amount: -c },
    { account: to, amount: c },
  ];
  const p = productOf(ctx, from);
  const charged = fee > 0 ? posting([{ account: from, amount: -fee }, { account: bankSide(p?.institution ?? ""), amount: fee }], { memo: "Cash advance fee", kind: "fee", category: "cash_advance", ...(opts.at !== undefined ? { at: opts.at } : {}) }) : [];
  const out: LedgerEvent[] = [...charged, { type: "post", lines, memo, ...(debt ? { overdraw: true as const } : {}) }];
  if (toTraits.liability) out.push({ type: FINANCE_EVENTS.cardPaid, data: { account: to, cents: c } });
  out.push(txn(lines, { memo, kind: toTraits.liability ? "payment" : "transfer", category: advance ? "cash_advance" : "transfer", ...(opts.flow ? { flow: opts.flow } : {}), ...(opts.named ? { named: opts.named } : {}), ...(opts.story ? { story: true } : {}), ...(opts.at !== undefined ? { at: opts.at } : {}) }));
  return asUnit(out);
}

/**
 * A side of a transfer: a party, or an account a party holds, which stands for that holder paying
 * from it (`from`, spending from it) or depositing into it (`to`). Anything else is refused.
 */
export function transferParty(ctx: ReadContext, id: EntityId, side: "from" | "to"): { holder: EntityId; account?: EntityId } | Rejection {
  const e = own(ctx.state.entities, id);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, id)}`);
  if (isParty(ctx, id)) return { holder: id };
  const t = traitsOf(ctx, id);
  if (t && (side === "to" || t.pays)) {
    const holders = holdersOf(ctx.state, id).filter((h) => own(ctx.state.entities, h) && isParty(ctx, h) && (side === "to" || canSpend(ctx.state, id, h)));
    const holder = holders[0];
    if (holder) return { holder, account: id };
  }
  return reject("bad_party", `${labelOf(ctx, id)} isn't someone, or an account someone can ${side === "from" ? "pay from" : "pay into"}`);
}

/**
 * Money from one party to another, each at its own level, or to an outside account (`to` its id:
 * `world`, the catch-all a Pay to a receiver the story hasn't established pays, DESIGN §9.4 typed
 * money), paid as any payee outside the world is. Two sides of one holder move money between two of
 * their accounts. Cash handed over (`method` "cash") comes from the payer's carried cash when it
 * covers, else the usual source, and lands in the payee's carried cash, else the usual deposit
 * account. A transfer the story made (`story`, DESIGN §9.5) never declines for cover, and from level
 * 2 never takes cash or savings below zero: from an account that neither covers it nor can run a
 * debt it comes the payer's way instead (`chooseSource`), and with no way at all it moves nothing
 * (`NO_WAY_TO_PAY`).
 */
export function transfer(hooks: FinanceHooks, ctx: ReadContext, from: EntityId, to: EntityId, cents: number, memo: string, method: PayMethod = "auto", story = false): LedgerEvent[] | Rejection {
  const payer = transferParty(ctx, from, "from");
  if ("code" in payer) return payer;
  const outside = to.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? outsideAccount(to) : null;
  const payee = outside === null ? transferParty(ctx, to, "to") : null;
  if (payee !== null && "code" in payee) return payee;
  const paying: PayMethod = method === "cash" ? "auto" : method;
  const cash = method === "cash" && payee !== null ? (cashAccount(ctx, payee.holder) ?? undefined) : undefined;
  const sameSide = payee !== null && (payer.holder === payee.holder || (payee.account !== undefined && canSpend(ctx.state, payee.account, payer.holder) && rightsOf(ctx.state, payee.account, payer.holder)?.worth === true));
  if (payee === null || !sameSide) {
    const deposit = payee?.account ?? cash;
    const source = payer.account ?? (method === "cash" ? (cashAccount(ctx, payer.holder) ?? undefined) : undefined);
    // From level 2 the story's payment names its cash even when the cash doesn't cover it, so the way it goes instead remembers it (`chooseSource`).
    const storyNamed = story && ctx.levelOf(payer.holder, "money") >= 2;
    const fromCash = storyNamed || (method === "cash" && source !== undefined && availableOf(ctx, source) >= Math.round(cents)) ? source : payer.account;
    const side = payee !== null ? { payee: payee.holder } : outside !== null ? { counterparty: outside } : {};
    return charge(hooks, ctx, payer.holder, cents, memo, { ...side, method: paying, kind: "transfer", ...(fromCash ? { source: fromCash } : {}), ...(deposit ? { deposit } : {}), overdraft: false, story });
  }
  if (!payer.account && !payee.account) return reject("bad_party", `${labelOf(ctx, from)} can't pay themselves`);
  const level = ctx.levelOf(payer.holder, "money");
  if (level === 0) return [];
  const c = Math.round(cents);
  // What the move takes from its source: a payment to credit pays at most what it owes (`move`'s cap).
  const takes = payee.account !== undefined && traitsOf(ctx, payee.account)?.liability === true ? Math.min(c, Math.max(0, -balance(ctx.state, payee.account))) : c;
  let named = story && level >= 2 && payer.account !== undefined && !runsDebt(ctx, payer.account) && availableOf(ctx, payer.account) < takes ? payer.account : undefined;
  let source = named === undefined ? payer.account : undefined;
  if (!source) {
    const picked = chooseSource(ctx, payer.holder, c, { method: paying, ...(payee.account ? { except: payee.account } : {}), till: false, overdraft: false, story });
    if ("code" in picked) return picked;
    source = picked.account;
    named ??= picked.named;
  }
  const target = payee.account ?? (cash !== undefined && cash !== source ? cash : (depositAccount(ctx, payee.holder, source) ?? undefined));
  if (!target || target === source) return reject("bad_party", `${labelOf(ctx, source)} can't pay itself`);
  return move(ctx, source, target, c, memo, { cap: true, story, ...(named ? { named } : {}) });
}

// ---------------------------------------------------------------- the funds guard

/**
 * Ledger 1.10: a posting folds only if the accounts it draws on can pay it (the fold-time twin of the
 * choices above): an open account, within its balance less holds, its credit, or the overdraft its
 * policy allows. What a bank posts itself (interest, fees) and what posts against a holder's own
 * outside account (openings, level-1 moves) isn't checked. A payment the story made on an account
 * that can run a debt (`overdraw`, DESIGN §9.5) needs only open accounts: it stands past what they
 * cover, on any path. One it made from cash or savings carries none and is checked as any payment;
 * one an earlier build recorded from them with `overdraw` stands as that build wrote it, since some
 * of those went past cover on their own path (an Edit amount on a cash purchase), which a stricter
 * check would break.
 */
export function postGuard(ctx: ReadContext, lines: readonly PostingLine[], overdraw = false): Rejection | null {
  const s = ctx.state;
  if (lines.some((l) => l.amount > 0 && l.account.startsWith(BANK_PREFIX))) return null;
  for (const l of lines) {
    if (l.amount >= 0) continue;
    const t = traitsOf(ctx, l.account);
    if (!t || t.installment) continue;
    const holders = holdersOf(s, l.account).filter((h) => own(s.entities, h));
    if (holders.length === 0 || accountLevel(ctx, l.account) < 2) continue;
    if (lines.some((x) => holders.some((h) => x.account === external(h)))) continue;
    const name = labelOf(ctx, l.account);
    const status = statusOf(s, l.account);
    if (status !== "open") return reject("declined", `${name} is ${status.replace(/_/g, " ")}`);
    if (!overdraw && availableOf(ctx, l.account) + overdraftRoom(ctx, l.account) + l.amount < 0) {
      return reject("declined", t.liability ? `${name} has no room for ${formatMoney(-l.amount, ctx.world.currency)}` : `${name} can't cover ${formatMoney(-l.amount, ctx.world.currency)}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------- corrections

/** The cash inside `item` goes with it: lost to the outside world, or stolen by `thief`. */
export function loseWith(ctx: ReadContext, item: EntityId, thief?: EntityId): LedgerEvent[] | Rejection {
  const s = ctx.state;
  if (!own(s.entities, item)) return reject("missing_entity", `no ${labelOf(ctx, item)}`);
  if (thief && !own(s.entities, thief)) return reject("missing_entity", `no ${labelOf(ctx, thief)}`);
  const out: LedgerEvent[] = [];
  for (const id of Object.keys(s.entities).sort()) {
    const cents = balance(s, id);
    if (classOf(ctx, id) !== "cash" || cents <= 0) continue;
    let inside = false;
    for (let cur: string | undefined = own(s.entities, id)?.relations.find((r) => r.type === "in")?.to, guard = 0; cur && guard < 16 && !inside; cur = own(s.entities, cur)?.relations.find((r) => r.type === "in")?.to, guard++) inside = cur === item;
    if (!inside) continue;
    const memo = thief ? `Stolen with ${own(s.entities, item)?.name ?? item}` : `Lost with ${own(s.entities, item)?.name ?? item}`;
    const dest = thief ? payeeSide(ctx, { payee: thief }, cents) : { account: external("lost"), extra: [] };
    const lines: PostingLine[] = [
      { account: id, amount: -cents },
      { account: dest.account, amount: cents },
    ];
    out.push(...asUnit([{ type: "post", lines, memo }, ...dest.extra, txn(lines, { memo, kind: "adjustment", category: "lost" })]));
  }
  return out;
}

/** A correction that makes `holder`'s cash come to `cents`; null when the holder has no cash account. */
export function setCash(ctx: ReadContext, holder: EntityId, cents: number): LedgerEvent[] | Rejection | null {
  const s = ctx.state;
  const cash = accountsOf(ctx, holder, "spend").filter((id) => classOf(ctx, id) === "cash");
  // Carried cash first (the wallet), then any other cash: what's added lands in the first, and what's
  // taken empties them in turn, so no account goes below zero.
  const [first, ...rest] = [...cash.filter((id) => cashOnHolder(s, id, holder)), ...cash.filter((id) => !cashOnHolder(s, id, holder))];
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
  return asUnit(posting(lines, { memo: "Correction", kind: "adjustment", category: "correction" }));
}

/**
 * Money the player said they had (DESIGN §9.4 player claims): `cents` into `holder`'s carried cash
 * (else their first cash account, `cashAccount`), a balanced posting against the outside correction
 * account, so the books still balance. The account it went into, with its events.
 */
export function claimCash(ctx: ReadContext, holder: EntityId, cents: number): { entity: EntityId; events: LedgerEvent[] } | Rejection {
  const into = cashAccount(ctx, holder);
  if (!into) return reject("no_cash", `${labelOf(ctx, holder)} carries no cash`);
  const c = Math.round(cents);
  if (!Number.isSafeInteger(c) || c <= 0) return reject("bad_amount", "cash said to be had is a whole amount above zero");
  const lines: PostingLine[] = [
    { account: into, amount: c },
    { account: CORRECTION_ACCOUNT, amount: -c },
  ];
  return { entity: into, events: asUnit(posting(lines, { memo: "Cash you said you had", kind: "adjustment", category: "correction" })) };
}

/**
 * The cash `holder` has on them to hand over (DESIGN §9.4): what their carried cash account, the one
 * a payment in cash takes first and a cash claim goes into (`cashAccount`), has available, or, until
 * their money first opens (the turn's start opens it), the opening balance the world gives it. Null
 * when they keep no cash account.
 */
export function carriedCash(ctx: ReadContext, holder: EntityId): number | null {
  const from = cashAccount(ctx, holder);
  if (!from) return null;
  return isOpened(ctx.state, from, openerOf(ctx.state, from)) ? availableOf(ctx, from) : Math.round(numOf(own(ctx.state.entities, from)?.fields.opening));
}

/**
 * A purchase that applied, repriced to `cents` in all: the difference to what its posting charged in
 * all (its price and any tax on it) moves between the account that paid and the account that was
 * paid, as a correction tied to the purchase's unit, so a rebased view that drops the purchase drops
 * it too. The purchase is its unit's posting with a purchase journal line, or (a purchase an older
 * build recorded) its unit's one two-line posting. One the story put on an account that runs a debt
 * (`overdraw`) stands at the player's price as it stood at its own, whatever that account covers;
 * from any other account the difference is checked as any payment is.
 */
export function reprice(ctx: ReadContext, events: readonly LedgerEvent[], cents: number): LedgerEvent[] | Rejection {
  const posts = events.filter((e): e is PostEvent => e.type === "post");
  const purchase = events.find((e) => e.type === FINANCE_EVENTS.txn && "data" in e && e.data.kind === "purchase");
  const was = purchase && "data" in purchase ? purchase.data : undefined;
  const memo = was !== undefined ? strOf(was.memo) : undefined;
  const post = (memo !== undefined ? posts.find((p) => p.memo === memo) : undefined) ?? (posts.length === 1 && posts[0]?.lines.length === 2 ? posts[0] : undefined);
  const paid = post?.lines.find((l) => l.amount < 0);
  const got = post ? [...post.lines].filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount)[0] : undefined;
  if (!post || !paid || !got) return reject("not_a_purchase", "there's no purchase to reprice");
  const total = Math.round(cents);
  if (!Number.isSafeInteger(total) || total <= 0) return reject("bad_amount", "the amount must be positive");
  const diff = total - post.lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0);
  if (diff === 0) return [];
  const note = `${post.memo}: price corrected`;
  const lines: PostingLine[] = [
    { account: paid.account, amount: -diff },
    { account: got.account, amount: diff },
  ];
  // The purchase's own sides, the other way round for money given back.
  const seller = strOf(was?.counterparty);
  const buyer = strOf(was?.payer);
  const overdraw = post.overdraw === true && diff > 0 && runsDebt(ctx, paid.account);
  return tied(asUnit([{ type: "post", lines, memo: note, ...(overdraw ? { overdraw: true as const } : {}) }, txn(lines, { memo: note, kind: diff > 0 ? "purchase" : "refund", counterparty: diff > 0 ? seller : buyer, payer: diff > 0 ? buyer : seller })]), [post.group]);
}

// ---------------------------------------------------------------- what the story paid

/**
 * A payment the story made among a change's events (DESIGN §9.5), found by its journal line's
 * `story`, or (one an earlier build recorded, its line unmarked) by its posting's `overdraw`: its
 * posting, the account it drew on and how much, who paid, the account its words named when it went
 * elsewhere, and what it brought on that account (§25.10): the transfer the account's overdraft link
 * made into it, and the fees its bank charged for it (an overdraft fee, a cash advance's fee), `fees`
 * in all.
 */
interface StoryPayment {
  post: PostEvent;
  account: EntityId;
  total: number;
  payer: EntityId;
  named: EntityId | null;
  brought: PostEvent[];
  fees: number;
}

function storyPayment(ctx: ReadContext, events: readonly LedgerEvent[]): StoryPayment | null {
  const marked = events.find((e) => e.type === FINANCE_EVENTS.txn && "data" in e && e.data.story === true);
  const post = marked && "data" in marked ? events.find((e): e is PostEvent => e.type === "post" && e.memo === strOf(marked.data.memo)) : events.find((e): e is PostEvent => e.type === "post" && e.overdraw === true);
  const line = marked ?? events.find((e) => e.type === FINANCE_EVENTS.txn && "data" in e && post !== undefined && e.data.memo === post.memo);
  const data = line && "data" in line ? line.data : {};
  // The line it paid from: its biggest draw on an account in the world.
  const paid = post?.lines.filter((l) => l.amount < 0 && traitsOf(ctx, l.account) !== null).sort((a, b) => a.amount - b.amount)[0];
  if (!post || !paid) return null;
  const party = strOf(data.payer);
  const payer = isParty(ctx, party) ? party : (holdersOf(ctx.state, paid.account).find((h) => canSpend(ctx.state, paid.account, h)) ?? "");
  if (payer === "") return null;
  const link = strOf(own(ctx.state.entities, paid.account)?.fields.overdraft_link);
  const brought = events.filter((e): e is PostEvent => e.type === "post" && e !== post && e.lines.some((l) => l.account === paid.account) && e.lines.every((l) => l.account === paid.account || l.account === link || l.account.startsWith(BANK_PREFIX)));
  const fees = brought.filter((p) => p.lines.some((l) => l.account.startsWith(BANK_PREFIX))).reduce((sum, p) => sum - (p.lines.find((l) => l.account === paid.account)?.amount ?? 0), 0);
  return { post, account: paid.account, total: -paid.amount, payer, named: strOf(data.named) || null, brought, fees };
}

/** What a payment the story made did with the money, as `economy.paid_from` gives it: the account it took it from, or nothing charged. */
export type PaidFrom = PaidFromAccount | PaidNothing;

/** A payment the story made, from an account. */
export interface PaidFromAccount {
  /** The account it drew on, by name. */
  name: string;
  /** A credit account: `cents` is then what it owes. */
  credit: boolean;
  /** Its balance after the payment, or what a credit account owes after it. */
  cents: number;
  /** How far past what the account covers the payment itself took it: into overdraft, or over its limit (0 within). A fee its bank charged for it doesn't count. */
  over: number;
  /** What the payment drew from it. */
  total: number;
}

/** A purchase the story made that nothing of its payer's could pay (`NO_WAY_TO_PAY`): theirs, with nothing charged. */
export interface PaidNothing {
  /** What it would have cost. */
  unpaid: number;
}

/**
 * What a payment the story made did with the money, after it (`ctx` holds the payment), for a chip
 * that says so (DESIGN §9.5): the account it took it from and that account's balance, or, for a
 * purchase nothing of its payer's could pay, what it would have cost. Null for money that isn't
 * `viewer`'s, so no one else's money is told.
 */
export function paidFrom(ctx: ReadContext, events: readonly LedgerEvent[], viewer: EntityId): PaidFrom | null {
  const paid = storyPayment(ctx, events);
  if (!paid) {
    const line = events.find((e) => e.type === FINANCE_EVENTS.txn && "data" in e && typeof e.data.unpaid === "number");
    const data = line && "data" in line ? line.data : undefined;
    return data && strOf(data.payer) === viewer ? { unpaid: numOf(data.unpaid) } : null;
  }
  const t = traitsOf(ctx, paid.account);
  if (!t || rightsOf(ctx.state, paid.account, viewer) === null) return null;
  const b = balance(ctx.state, paid.account);
  const room = availableOf(ctx, paid.account) + (t.liability ? 0 : overdraftRoom(ctx, paid.account)) + paid.fees;
  return { name: labelOf(ctx, paid.account), credit: t.liability, cents: t.liability ? -b : b, over: Math.max(0, -room), total: paid.total };
}

/**
 * Pay another way (DESIGN §9.5): for a payment the story made, the first of its payer's ways that
 * covers it now: the account its words named, when the payment went elsewhere (the story's own
 * way), then savings, a card, checking, cash; never an account the payment already touched. With it
 * comes the correction that moves the payment there once it has applied: what it drew goes back to
 * the account it came from and leaves the other way, as one transfer between the payer's own
 * accounts that names the payment, tied to the payment's unit; and what it brought on that account
 * goes back too (§25.10), each its own unit tied to that transfer and to what it reverses: the
 * overdraft link's transfer returns to the link, and the bank's fee for it is refunded. So a rebased
 * view that drops the payment drops the whole correction, and one that drops only the link's
 * transfer gives the link nothing back.
 */
export function otherWay(ctx: ReadContext, events: readonly LedgerEvent[]): { from: EntityId; repay: LedgerEvent[] } | Rejection {
  const paid = storyPayment(ctx, events);
  if (!paid) return reject("not_a_payment", "there's no payment to pay another way");
  const touched = new Set(paid.post.lines.map((l) => l.account));
  const ways = [...(paid.named ? sourcesFor(ctx, paid.payer, paid.named, true, []) : []), ...(["savings", "card", "checking", "cash"] as const).flatMap((method) => sourcesToTry(ctx, paid.payer, paid.total, { method, till: true }, []))];
  const way = ways.find((s) => !touched.has(s.account) && covers(ctx, s, paid.total, false));
  if (!way) return reject("declined", "No other way to pay covers it.");
  const memo = `${paid.post.memo}: paid from ${labelOf(ctx, way.account)} instead`;
  const lines: PostingLine[] = [
    { account: way.account, amount: -paid.total },
    { account: paid.account, amount: paid.total },
  ];
  const moved = tied(asUnit(posting(lines, { memo, kind: "transfer", category: "transfer" })), [paid.post.group]);
  const back = paid.brought.flatMap((p): LedgerEvent[] => {
    const fee = p.lines.some((l) => l.account.startsWith(BANK_PREFIX));
    const reversed = p.lines.map((l) => ({ account: l.account, amount: -l.amount }));
    const note = `${p.memo} ${fee ? "refunded" : "reversed"}`;
    const was = events.find((e) => e.type === FINANCE_EVENTS.txn && "data" in e && e.data.memo === p.memo);
    const category = was && "data" in was ? strOf(was.data.category) : "";
    return tied(asUnit([{ type: "post", lines: reversed, memo: note }, txn(reversed, { memo: note, kind: fee ? "refund" : "transfer", ...(category ? { category } : {}) })]), [p.group, moved[0]?.group]);
  });
  return { from: way.account, repay: [...moved, ...back] };
}

// ---------------------------------------------------------------- signals and notes

export function signal(cls: "bill" | "decline", text: string, who: EntityId, at: number): LedgerEvent {
  return { type: ENGINE_EVENTS.signal, data: { class: cls, text, entity: who, visibility: "known_by", at } };
}

/**
 * What the money processes record. Every posting stays, and every journal line that touches an
 * account in the world. Payday, bill and decline notes stay signals for the POV, where they can
 * interrupt a timelapse and reach the Montage; for anyone else who holds accounts they become a
 * secret `economy.note` in their own record. Someone whose money is a band alone keeps no lines
 * or notes.
 */
export function noted(ctx: ReadContext, events: LedgerEvent[]): LedgerEvent[] {
  const pov = ctx.world.pov;
  return events.flatMap((e): LedgerEvent[] => {
    if (!("data" in e)) return [e];
    if (e.type === FINANCE_EVENTS.txn) return Array.isArray(e.data.lines) && e.data.lines.some((l) => own(ctx.state.entities, strOf(objOf(l).account))) ? [e] : [];
    if (e.type === ENGINE_EVENTS.signal && typeof e.data.entity === "string" && e.data.entity !== pov) return hasLedger(ctx, e.data.entity) ? [{ type: FINANCE_EVENTS.note, data: { entity: e.data.entity, class: strOf(e.data.class), text: strOf(e.data.text), visibility: "secret", ...(typeof e.data.at === "number" ? { at: e.data.at } : {}) } }] : [];
    return [e];
  });
}
