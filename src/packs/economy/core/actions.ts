// What a player or a character does with their money (DESIGN §25.3, §25.5, §25.8–§25.10): cash at
// a machine or a branch, cards (freeze, report lost, replace), autopay, standing flows, applying
// for credit, payment preferences; and the GM's controls that aren't fields. Each is an effect the
// engine validates; the actions that offer them read only what the player could do in the world.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_STATES, CLASS_TRAITS, FINANCE_EVENTS, FLOW_KINDS, FLOW_SHORTFALLS, isAccountClass, isCredit, payeeKey, type AtmFeature, type CreditApplication, type Owner } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { formatMoney, type EntityDef } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { GONE_FIELD } from "../../../engine/scope";
import { labelOf, numOf, objOf, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import { membersOf } from "../../../engine/selector";
import { decide, type Decision } from "./credit";
import type { OpenAccount } from "./module";
import { fallsBackOn } from "./flows";
import { isOpened, reject, spendOf } from "./journal";
import { availableOf, balance, bankSide, canSpend, classOf, debtorsOf, external, holdersOf, householdOf, managesAccount, managesParty, openerOf, productOf, rightsOf, shownLabel, statusOf, traitsOf, worldProducts } from "./model";
import { accountFeature, asUnit, cardProblem, cardRoom, cardsOn, cashAccount, cashAdvanceFee, depositAccount, featureFor, isParty, mayUse, posting, signal } from "./pay";

function money(ctx: ReadContext, cents: number): string {
  return formatMoney(cents, ctx.world.currency);
}

/** The nearest place feature of a kind where someone is: their place, then the places it is inside. */
function featureAt<T>(ctx: ReadContext, who: EntityId, field: "atm" | "branch"): { place: string; feature: T } | null {
  let cur: string | undefined = placeOfEntity(ctx.state, who) ?? undefined;
  for (let guard = 0; cur && guard < 32; guard++) {
    const p = own(ctx.world.places, cur);
    const f = objOf(p?.fields[field]);
    if (typeof f.bank === "string" && f.bank !== "") return { place: cur, feature: f as unknown as T };
    cur = p?.parent;
  }
  return null;
}

/**
 * Whether cash needs a machine or branch for this person: the top level's rule, and only in a world
 * that places at least one. A world with none (an older one migrated, or one that leaves banking
 * offstage) would otherwise leave cash out of reach at the top level altogether.
 */
function cashNeedsAMachine(ctx: ReadContext, who: EntityId): boolean {
  if (!featureFor(ctx, who, "atm")) return false;
  return Object.values(ctx.world.places).some((p) => ["atm", "branch"].some((f) => { const bank = objOf(p.fields[f]).bank; return typeof bank === "string" && bank !== ""; }));
}

/** A person's active debit card on an account. */
function debitCard(ctx: ReadContext, who: EntityId, account: EntityId): EntityId | null {
  return cardsOn(ctx.state, account).find((c) => strOf(own(ctx.state.entities, c)?.fields.holder) === who && cardProblem(ctx, c, who) === null) ?? null;
}

/**
 * Cash from an account into the person's wallet (DESIGN §25.8). Where cash needs a machine (the
 * top level), they must be at a branch of the account's bank (no card needed, no limit, no fee) or
 * at a cash machine, which takes an active card on the account, its own limit and the card's daily
 * limit, and another bank's machine its surcharge plus the account's out-of-network fee; a credit
 * account's cash is a cash advance, with its fee. Below that, money moves freely.
 */
export function withdraw(ctx: ReadContext, who: EntityId, account: EntityId, raw: number): LedgerEvent[] | Rejection {
  const cents = Math.round(raw);
  if (!(cents > 0)) return reject("bad_amount", "the amount must be positive");
  if (!canSpend(ctx.state, account, who) || !traitsOf(ctx, account)?.pays || traitsOf(ctx, account)?.cash) return reject("not_owner", `${labelOf(ctx, who)} can't draw cash from ${labelOf(ctx, account)}`);
  if (statusOf(ctx.state, account) !== "open") return reject("declined", `${labelOf(ctx, account)} is ${statusOf(ctx.state, account).replace(/_/g, " ")}`);
  const wallet = cashAccount(ctx, who);
  if (!wallet) return reject("no_wallet", `${labelOf(ctx, who)} has nowhere to carry cash`);
  const p = productOf(ctx, account);
  if (!p) return reject("missing_account", "no such account");
  const t = traitsOf(ctx, account);
  const atTop = cashNeedsAMachine(ctx, who);
  // The fees post apart from the cash: a bank's own charges may overdraw, so they're exempt from the funds check, but the cash itself never is.
  const machine: PostingLine[] = [];
  const advanceLines: PostingLine[] = [];
  const extra: LedgerEvent[] = [];
  let fees = 0;
  let card: EntityId | null = null;
  let where = "";
  if (atTop) {
    const branch = featureAt<{ bank: string }>(ctx, who, "branch");
    const atm = featureAt<AtmFeature>(ctx, who, "atm");
    if (branch && branch.feature.bank === p.institution) where = `at ${own(ctx.world.places, branch.place)?.name ?? "the branch"}`;
    else if (atm) {
      card = debitCard(ctx, who, account);
      if (!card) return reject("no_card", cardsOn(ctx.state, account).length > 0 ? `none of ${labelOf(ctx, who)}'s cards on ${labelOf(ctx, account)} works` : `${labelOf(ctx, account)} has no card for a cash machine`);
      if (typeof atm.feature.limit === "number" && cents > atm.feature.limit) return reject("over_limit", `the machine gives at most ${money(ctx, atm.feature.limit)} at a time`);
      if (cardRoom(ctx, card, "atm") < cents) return reject("over_limit", `${labelOf(ctx, card)} has ${money(ctx, cardRoom(ctx, card, "atm"))} left of its daily cash limit`);
      where = `at ${own(ctx.world.places, atm.place)?.name ?? "a cash machine"}`;
      if (accountFeature(ctx, account, "fees") && atm.feature.bank !== p.institution) {
        const surcharge = Math.max(0, Math.round(numOf(atm.feature.fee)));
        if (surcharge > 0) machine.push({ account: external(`atm:${atm.feature.bank}`), amount: surcharge });
        if (p.fees.atm > 0) machine.push({ account: bankSide(p.institution), amount: p.fees.atm });
        fees += surcharge + p.fees.atm;
      }
      if (Number.isFinite(cardRoom(ctx, card, "atm"))) {
        const day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex;
        const s = spendOf(ctx.state, card, day);
        extra.push({ type: FINANCE_EVENTS.spend, data: { card, day, purchase: s.purchase, atm: s.atm + cents } });
      }
    } else return reject("no_atm", `there's no cash machine or ${p.institution || "bank"} branch here`);
  }
  const advance = cashAdvanceFee(ctx, account, cents);
  if (advance > 0) {
    advanceLines.push({ account: bankSide(p.institution), amount: advance });
    fees += advance;
  }
  const total = cents + fees;
  if (availableOf(ctx, account) < total) return reject("declined", `${labelOf(ctx, account)} can't cover ${money(ctx, total)}`);
  const charge = (lines: PostingLine[], memo: string, category: string): LedgerEvent[] => {
    const cents = lines.reduce((a, l) => a + l.amount, 0);
    return cents > 0 ? posting([{ account, amount: -cents }, ...lines], { memo, kind: "fee", category }) : [];
  };
  const memo = `Cash withdrawal${where ? ` ${where}` : ""}${fees > 0 ? ` (${money(ctx, fees)} in fees)` : ""}`;
  // Fees first, so the cash is checked against what they leave: a rebased view that can't cover it drops the unit, fees and all.
  // Cash from a credit account is a cash advance, which runs its own interest from the day it's drawn.
  return asUnit([...charge(machine, "Cash machine fees", "atm"), ...charge(advanceLines, "Cash advance fee", "cash_advance"), ...posting([{ account, amount: -cents }, { account: wallet, amount: cents }], { memo, kind: "withdrawal", category: t?.revolving ? "cash_advance" : "transfer", ...(card ? { card } : {}) }), ...extra]);
}

/**
 * Cash from the wallet into an account. Where cash needs a machine, at a branch of the account's
 * bank it is available at once; at one of its bank's machines that takes deposits it is held for
 * the account's hold days where holds run.
 */
export function deposit(ctx: ReadContext, who: EntityId, account: EntityId, raw: number): LedgerEvent[] | Rejection {
  const cents = Math.round(raw);
  if (!(cents > 0)) return reject("bad_amount", "the amount must be positive");
  const unusable = mayUse(ctx, who, account, "into");
  if (unusable) return unusable;
  // Cash goes into a bank account; a wallet or a locked account doesn't take it at a machine or a branch.
  if (traitsOf(ctx, account)?.cash || traitsOf(ctx, account)?.locked) return reject("not_owner", `${labelOf(ctx, who)} can't pay cash into ${labelOf(ctx, account)}`);
  const wallet = cashAccount(ctx, who);
  if (!wallet || availableOf(ctx, wallet) < cents) return reject("declined", `${labelOf(ctx, who)} doesn't have ${money(ctx, cents)} in cash`);
  const p = productOf(ctx, account);
  if (!p) return reject("missing_account", "no such account");
  if (traitsOf(ctx, account)?.liability && cents > -balance(ctx.state, account)) return reject("overpay", `${labelOf(ctx, account)} owes only ${money(ctx, Math.max(0, -balance(ctx.state, account)))}`);
  let held = false;
  let where = "";
  if (cashNeedsAMachine(ctx, who)) {
    const branch = featureAt<{ bank: string }>(ctx, who, "branch");
    const atm = featureAt<AtmFeature>(ctx, who, "atm");
    if (branch && branch.feature.bank === p.institution) where = ` at ${own(ctx.world.places, branch.place)?.name ?? "the branch"}`;
    else if (atm && atm.feature.deposits === true && atm.feature.bank === p.institution) {
      where = ` at ${own(ctx.world.places, atm.place)?.name ?? "a cash machine"}`;
      held = accountFeature(ctx, account, "holds") && p.hold_days > 0;
    } else return reject("no_atm", `there's no ${p.institution || "bank"} branch or deposit machine here`);
  }
  const lines: PostingLine[] = [
    { account: wallet, amount: -cents },
    { account, amount: cents },
  ];
  const events: LedgerEvent[] = posting(lines, { memo: `Cash deposit${where}`, kind: "deposit", category: "transfer" });
  if (traitsOf(ctx, account)?.liability) events.push({ type: FINANCE_EVENTS.cardPaid, data: { account, cents } });
  if (held) events.push({ type: FINANCE_EVENTS.hold, data: { id: `dep:${hashParts(account, ctx.state.clock, cents).slice(0, 10)}`, account, cents, until: ctx.state.clock + p.hold_days * 1440, kind: "deposit", memo: "Cash deposit" } });
  return asUnit(events);
}

/** A card's new state, by its holder (frozen and unfrozen; reported lost, for good). */
export function setCardState(ctx: ReadContext, who: EntityId, card: EntityId, state: string): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, card);
  if (e?.kind !== "card") return reject("not_card", `${labelOf(ctx, card)} isn't a payment card`);
  if (strOf(e.fields.holder) !== who && !managesAccount(ctx, strOf(e.fields.account), who)) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s`);
  if (!(CARD_STATES as readonly string[]).includes(state)) return reject("bad_state", `a card can't be ${state}`);
  const now = strOf(e.fields.state, "active");
  if (now === state) return [];
  if (now === "lost" || now === "cancelled") return reject("bad_state", `${e.name} is ${now}; replace it`);
  return [{ type: "set", entity: card, field: "state", value: state }];
}

/** A replacement for a card: a new card on the same account and in the same hands, its gear card in the holder's keeping, the old one cancelled. */
export function replaceCard(ctx: EffectContext, who: EntityId, card: EntityId): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, card);
  if (e?.kind !== "card") return reject("not_card", `${labelOf(ctx, card)} isn't a payment card`);
  const holder = strOf(e.fields.holder);
  if (holder !== who && !managesAccount(ctx, strOf(e.fields.account), who)) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s`);
  if (strOf(e.fields.state) === "cancelled" && strOf(e.fields.replaced_by) !== "") return reject("bad_state", `${e.name} was already replaced`);
  let n = 2;
  while (own(ctx.state.entities, `${card}_r${n}`)) n++;
  const id = `${card}_r${n}`;
  const last4 = String(1000 + (Number.parseInt(hashParts(card, n).slice(0, 6), 16) % 9000));
  const fields: JsonObject = { ...e.fields, state: "active", replaces: card, last4 };
  delete fields.replaced_by;
  delete fields.item;
  const out: LedgerEvent[] = [{ type: "spawn", entity: { id, kind: "card", name: e.name, tier: "background", fields, relations: [] } }, { type: "set", entity: card, field: "state", value: "cancelled" }, { type: "set", entity: card, field: "replaced_by", value: id }];
  const spawn = optionalService(ctx, "gear.spawn");
  const oldItem = strOf(e.fields.item);
  if (spawn && ctx.levelOf(holder, "gear") >= 1) {
    const place = oldItem !== "" ? own(ctx.state.entities, oldItem)?.relations.find((r) => r.type === "in")?.to : undefined;
    const made = spawn(ctx, { name: own(ctx.state.entities, oldItem)?.name ?? e.name, owner: holder, holder: place && own(ctx.state.entities, place) && !own(ctx.state.entities, oldItem)?.fields.lost ? place : holder, salt: `card:${id}` });
    if (Array.isArray(made)) {
      out.push(...made);
      const item = made.find((x) => x.type === "spawn");
      if (item?.type === "spawn") out.push({ type: "set", entity: id, field: "item", value: item.entity.id });
    }
  }
  const account = strOf(e.fields.account);
  const p = productOf(ctx, account);
  if (p && p.fees.card_replacement > 0 && accountFeature(ctx, account, "fees")) out.push(...posting([{ account, amount: -p.fees.card_replacement }, { account: bankSide(p.institution), amount: p.fees.card_replacement }], { memo: `${e.name} replacement`, kind: "fee", category: "card_replacement" }));
  return asUnit(out);
}

/** A name in why something was refused, as the player may read it (`shownLabel`): the refusal reaches the narrator and the decline chip. */
function said(ctx: ReadContext, id: string): string {
  return shownLabel(ctx, ctx.world.pov, id);
}

/**
 * What's wrong with a credit account's autopay drawing on `from` when `who` sets it (DESIGN
 * §25.1), or null: an account that pays and isn't credit, which `who` may spend from or manages,
 * and which is the account's debtor's own money: theirs to spend, or theirs by its worth, as a
 * child's savings is the child's though their custodian spends it. So a business's loan pays from
 * the business's money, a manager's own card or loan from their own, and a custodial card from the
 * custodial money.
 */
export function autopaySourceProblem(ctx: ReadContext, who: EntityId, account: EntityId, from: EntityId): Rejection | null {
  const t = traitsOf(ctx, from);
  if ((!canSpend(ctx.state, from, who) && !managesAccount(ctx, from, who)) || !t?.pays || t.liability) return reject("bad_account", `${said(ctx, who)} can't pay from ${said(ctx, from)}`);
  const debtors = debtorsOf(ctx.state, account);
  if (!debtors.some((d) => canSpend(ctx.state, from, d) || rightsOf(ctx.state, from, d)?.worth === true)) return reject("bad_account", `${said(ctx, account)} is paid from ${said(ctx, debtors[0] ?? who)}'s own money, not from ${said(ctx, from)}`);
  return null;
}

/** A credit account's autopay, by whoever manages it: how much, and from where (`autopaySourceProblem`). */
export function setAutopay(ctx: ReadContext, who: EntityId, account: EntityId, mode: string, from: string, cents: number): LedgerEvent[] | Rejection {
  const cls = classOf(ctx, account);
  if (!cls || !isCredit(cls)) return reject("not_credit", `${labelOf(ctx, account)} isn't a card or a loan`);
  if (!managesAccount(ctx, account, who)) return reject("not_owner", `${labelOf(ctx, account)} isn't ${labelOf(ctx, who)}'s to change`);
  if (!(AUTOPAY_MODES as readonly string[]).includes(mode)) return reject("bad_mode", `autopay can't be ${mode}`);
  const source = from === "" ? null : autopaySourceProblem(ctx, who, account, from);
  if (source) return source;
  if (mode === "fixed" && !(cents > 0)) return reject("bad_amount", "fixed autopay needs an amount");
  const out: LedgerEvent[] = [{ type: "set", entity: account, field: "autopay", value: mode }];
  if (from !== "") out.push({ type: "set", entity: account, field: "autopay_from", value: from });
  if (mode === "fixed") out.push({ type: "set", entity: account, field: "autopay_cents", value: Math.round(cents) });
  return out;
}

const FLOW_PARAM_FIELDS: Record<string, string> = { label: "", kind: "flow_kind", from: "from", to: "to", amount: "amount_cents", every: "every", interval: "interval", at: "at", start: "start", end: "end", count: "count", shortfall: "shortfall", retry_days: "retry_days", retries: "retries", fallback: "fallback", roll: "roll", category: "category" };

/** A flow's fields from an action's parameters; a parameter left out leaves the field as it is. */
function flowFields(args: Record<string, JsonValue>): { fields: JsonObject; label?: string } | Rejection {
  const fields: JsonObject = {};
  let label: string | undefined;
  for (const [param, field] of Object.entries(FLOW_PARAM_FIELDS)) {
    const v = args[param];
    if (v === undefined || v === null || v === "") continue;
    if (param === "label") label = String(v).slice(0, 80);
    else fields[field] = v;
  }
  if (typeof fields.flow_kind === "string" && !(FLOW_KINDS as readonly string[]).includes(fields.flow_kind)) return reject("bad_flow", `a flow can't be a ${fields.flow_kind}`);
  if (typeof fields.shortfall === "string" && !(FLOW_SHORTFALLS as readonly string[]).includes(fields.shortfall)) return reject("bad_flow", `there's no shortfall policy ${fields.shortfall}`);
  if (typeof fields.amount_cents === "number") fields.amount_cents = Math.round(fields.amount_cents);
  const every = args.every;
  if (every === "once") {
    delete fields.every;
    fields.once = strOf(args.once);
    if (fields.once === "") return reject("bad_flow", "a one-off flow needs its date and time");
  } else if (every !== undefined && every !== null && every !== "") {
    if (!["day", "week", "month", "year"].includes(String(every))) return reject("bad_flow", `a flow can't fall every ${String(every)}`);
    fields.once = "";
    if (typeof args.weekday === "number") fields.weekdays = [args.weekday];
    else if (every !== "week") fields.weekdays = [];
    if (typeof args.day === "number") fields.days = [args.day];
    else if (every === "week" || every === "day") fields.days = [];
    if (typeof args.month === "number") fields.months = [args.month];
    else if (every !== "year") fields.months = [];
  } else {
    if (typeof args.weekday === "number") fields.weekdays = [args.weekday];
    if (typeof args.day === "number") fields.days = [args.day];
    if (typeof args.month === "number") fields.months = [args.month];
  }
  return { fields, ...(label !== undefined ? { label } : {}) };
}

/**
 * Whether a party may run standing payments from `from` (DESIGN §25.1): themselves, a business or
 * a trust they manage, or an account they manage, by their role on it or on its owner. A role that
 * may only spend, an authorized user's, makes payments but sets up and changes no standing ones.
 */
export function mayPayFrom(ctx: ReadContext, who: EntityId, from: string): boolean {
  return from === who || (isParty(ctx, from) && managesParty(ctx.state, from, who)) || managesAccount(ctx, from, who);
}

/** The holders of an entity whose role counts its worth: an account's, a business's owners, a trust's beneficiaries. */
function worthHolders(ctx: ReadContext, id: string): EntityId[] {
  return holdersOf(ctx.state, id).filter((h) => rightsOf(ctx.state, id, h)?.worth === true);
}

/** How many holders deep money is followed, both to whom it is for (`whoseMoney`) and to what a party's own interests reach (`interestsOf`). */
const WORTH_DEPTH = 4;

/**
 * Whom `who`'s own interests are (DESIGN §25.1): them, their household and its members, each party
 * any of those counts the worth of (a business they own, and so may draw from; a trust they benefit
 * from), and in turn each party those count the worth of (a business their business owns), as deep
 * as `whoseMoney` follows money. Money a manager only manages reaches none of them.
 */
export function interestsOf(ctx: ReadContext, who: EntityId): Set<EntityId> {
  const household = householdOf(ctx, who);
  const kin = household === null ? [who] : [who, household, ...membersOf(ctx.registry, ctx.world, ctx.state, household)];
  const out = new Set<EntityId>(kin);
  const parties = Object.keys(ctx.state.entities).filter((id) => !out.has(id) && isParty(ctx, id));
  let reached: ReadonlySet<EntityId> = out;
  for (let depth = 0; depth < WORTH_DEPTH && reached.size > 0; depth++) {
    const next = new Set(parties.filter((id) => !out.has(id) && worthHolders(ctx, id).some((h) => reached.has(h))));
    for (const id of next) out.add(id);
    reached = next;
  }
  return out;
}

/**
 * Whom the money `side` is for (`all`): a party paying for itself, or the holders an account counts
 * the worth of, and in turn whom those are for (a business's owners, a trust's beneficiaries),
 * `WORTH_DEPTH` holders deep; and whom it ends with (`last`), who hold it for no one further.
 */
function whoseMoney(ctx: ReadContext, side: string): { all: Set<EntityId>; last: Set<EntityId> } {
  const all = new Set<EntityId>();
  const last = new Set<EntityId>();
  let next = isParty(ctx, side) ? [side] : worthHolders(ctx, side);
  for (let depth = 0; depth < WORTH_DEPTH && next.length > 0; depth++) {
    const deeper: EntityId[] = [];
    for (const p of next.filter((q) => !all.has(q))) {
      all.add(p);
      const holders = worthHolders(ctx, p);
      if (holders.length === 0 || depth === WORTH_DEPTH - 1) last.add(p);
      else deeper.push(...holders);
    }
    next = deeper;
  }
  return { all, last };
}

/** Whether a party is someone's own self or family, a person or a household, rather than something they own. */
function personal(ctx: ReadContext, id: string): boolean {
  const kind = own(ctx.state.entities, id)?.kind ?? "";
  return kind !== "" && (kindIs(ctx.registry, ctx.world, kind, "person") || kindIs(ctx.registry, ctx.world, kind, "household"));
}

/**
 * Whether money from `from`, which `who` only manages, paid to `to` would be for `who` (DESIGN
 * §25.1): to one of their interests (`interestsOf`) or an account whose worth one of those counts,
 * or to an outside payee typed as their own (its `payeeKey` is their id's or their name's, or their
 * household's: "Jordan Ellis", " POV "), which the hub refuses by the same keys. A payment among
 * whom the money itself is for (`whoseMoney`), the manager aside, is the money's own: the café's
 * savings topping up its operating account, a trust paying its beneficiary though she's the
 * trustee's daughter. An account the manager may spend by a role of their own (an authorized
 * user's card, a custodian's or a trustee's) is theirs too, whoever's worth it is, as they could
 * move the money on from it, unless they hold a share of the money themselves: then it's partly
 * theirs, and the account no way round anyone else's. Money wholly theirs (a business they own
 * outright) keeps no one else's interest, so it pays anything else they own; what goes to them,
 * their household or its members still goes by a draw or a salary, so the books and taxes see it.
 */
export function paysFor(ctx: ReadContext, who: EntityId, to: string, from: string, interests: ReadonlySet<EntityId> = interestsOf(ctx, who)): boolean {
  const { all: forHolder, last } = whoseMoney(ctx, from);
  const stake = forHolder.has(who);
  const wholly = last.size > 0 && [...last].every((p) => p === who);
  forHolder.delete(who);
  const mine = (party: string): boolean => interests.has(party) && !forHolder.has(party) && (!wholly || personal(ctx, party));
  const id = to.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? to.slice(EXTERNAL_ACCOUNT_PREFIX.length) : to;
  const e = own(ctx.state.entities, id);
  if (e?.kind === "account") return (!stake && canSpend(ctx.state, id, who)) || worthHolders(ctx, id).some(mine);
  if (e) return mine(id);
  const key = payeeKey(id);
  const household = householdOf(ctx, who);
  return key !== "" && [who, household].some((p) => p !== null && (key === payeeKey(p) || key === payeeKey(own(ctx.state.entities, p)?.name ?? "")));
}

/**
 * What's wrong with `who` running a standing payment from `from` to `to`, falling back on
 * `fallback`, or null (DESIGN §25.1, §25.5). Each is money they may pay from. A fallback is the
 * payer's own, as the money step draws on it (`fallsBackOn`): an outside name would pay with money
 * nobody has, and someone else's account isn't the payer's to draw on. Money they reach only by
 * managing it pays for whom it is, never for them (`paysFor`). That is a business's or a trust's
 * account they hold no spending role on, and the business or trust itself paying as a party,
 * whatever their role on it: a party's money is never a manager's own, though every managing role
 * on it carries the spending right.
 */
function flowProblem(ctx: ReadContext, who: EntityId, from: string, to: string, fallback: string): Rejection | null {
  if (!mayPayFrom(ctx, who, from)) return reject("not_owner", `${said(ctx, who)} can't pay from ${said(ctx, from)}`);
  if (fallback !== "" && (!mayPayFrom(ctx, who, fallback) || !fallsBackOn(ctx, from, fallback))) {
    return reject("not_owner", own(ctx.state.entities, fallback) ? `${said(ctx, who)} can't fall back on ${said(ctx, fallback)}` : `a fallback is an account of ${said(ctx, who)}'s, not "${fallback}"`);
  }
  const managed = [from, fallback].filter((side) => side !== "" && side !== who && (isParty(ctx, side) || !canSpend(ctx.state, side, who)));
  const paying = managed.find((side) => paysFor(ctx, who, to, side));
  if (paying === undefined) return null;
  if (isParty(ctx, paying)) return reject("not_owner", `${said(ctx, paying)} pays for itself, not for ${said(ctx, who)}`);
  const holder = holdersOf(ctx.state, paying).find((h) => managesParty(ctx.state, h, who)) ?? paying;
  return reject("not_owner", `${said(ctx, paying)} pays for ${said(ctx, holder)}, not for ${said(ctx, who)}`);
}

export function createFlow(ctx: ReadContext, who: EntityId, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const made = flowFields(args);
  if ("code" in made) return made;
  const f = made.fields;
  const from = strOf(f.from);
  const to = strOf(f.to);
  if (from === "" || to === "" || typeof f.amount_cents !== "number" || !(f.amount_cents > 0)) return reject("bad_flow", "a flow needs who pays, who is paid and an amount");
  const problem = flowProblem(ctx, who, from, to, strOf(f.fallback));
  if (problem) return problem;
  if (f.once === undefined && f.every === undefined) return reject("bad_flow", "a flow needs a schedule");
  const label = made.label ?? `Payment to ${labelOf(ctx, to)}`;
  const toMine = own(ctx.state.entities, to)?.kind === "account" && rightsOf(ctx.state, to, who) !== null;
  const fields: JsonObject = { flow_kind: toMine ? "transfer" : "bill", shortfall: "skip", status: "active", ...f };
  const id = `flow_${who}_${hashParts(who, label, ctx.state.clock).slice(0, 8)}`;
  const entity: EntityDef = { id, kind: "flow", name: label, tier: "background", fields, relations: [] };
  return [{ type: "spawn", entity }];
}

/** What a change may clear on a standing payment, by the parameter that names it (`flow_update`'s and `economy.flow_edit`'s `clear`). */
const CLEARABLE = ["at", "start", "end", "count", "roll", "retry_days", "retries", "fallback", "category"] as const;

/**
 * A standing payment's new name, when it has one, and the fields a comma list of parameters
 * clears (`end,count`), each set to nothing; a parameter that can't be cleared is refused.
 */
function renameAndClear(current: string, id: EntityId, name: string | undefined, clear: JsonValue | undefined): LedgerEvent[] | Rejection {
  const names = typeof clear === "string" ? clear.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
  const bad = names.find((n) => !(CLEARABLE as readonly string[]).includes(n));
  if (bad !== undefined) return reject("bad_flow", `a standing payment's ${bad.replace(/_/g, " ")} can't be cleared`);
  const out: LedgerEvent[] = [...new Set(names)].map((n): LedgerEvent => ({ type: "set", entity: id, field: FLOW_PARAM_FIELDS[n] ?? n, value: null }));
  const label = name?.trim().slice(0, 80) ?? "";
  if (label !== "" && label !== current) out.push({ type: FINANCE_EVENTS.flowRenamed, data: { flow: id, name: label } });
  return out;
}

export function updateFlow(ctx: ReadContext, who: EntityId, flow: EntityId, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, flow);
  if (e?.kind !== "flow") return reject("not_flow", `${labelOf(ctx, flow)} isn't a standing payment`);
  if (!mayPayFrom(ctx, who, strOf(e.fields.from))) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s to change`);
  const made = flowFields(args);
  if ("code" in made) return made;
  const more = renameAndClear(e.name, flow, made.label, args.clear);
  if ("code" in more) return more;
  const both = more.find((x) => x.type === "set" && x.field in made.fields);
  if (both && both.type === "set") return reject("bad_flow", `a standing payment's ${both.field.replace(/_/g, " ")} can't be both changed and cleared`);
  // The payment as it will be: what changes, what's cleared, and the rest as it was.
  const cleared = new Set(more.flatMap((x) => (x.type === "set" ? [x.field] : [])));
  const after = (field: string): string => (cleared.has(field) ? "" : strOf(made.fields[field] ?? e.fields[field]));
  const problem = flowProblem(ctx, who, after("from"), after("to"), after("fallback"));
  if (problem) return problem;
  return [...Object.entries(made.fields).map(([field, value]): LedgerEvent => ({ type: "set", entity: flow, field, value })), ...more];
}

/** GM: a standing payment's name, and the fields a comma list of parameters clears (`economy.flow_edit`). */
export function editFlow(ctx: ReadContext, flow: EntityId, name: string | undefined, clear: JsonValue | undefined): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, flow);
  if (e?.kind !== "flow") return reject("not_flow", `${labelOf(ctx, flow)} isn't a standing payment`);
  return renameAndClear(e.name, flow, name, clear);
}

export function setFlowStatus(ctx: ReadContext, who: EntityId, flow: EntityId, status: "active" | "paused" | "ended"): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, flow);
  if (e?.kind !== "flow") return reject("not_flow", `${labelOf(ctx, flow)} isn't a standing payment`);
  if (!mayPayFrom(ctx, who, strOf(e.fields.from))) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s to change`);
  const out: LedgerEvent[] = [{ type: "set", entity: flow, field: "status", value: status }];
  if (status === "ended") out.push({ type: "set", entity: flow, field: GONE_FIELD, value: true });
  return out;
}

/** The entity id an opened account gets: its first owner and product, with a disambiguating hash. */
function newAccountId(ctx: ReadContext, spec: OpenAccount): EntityId {
  const base = `${spec.owners[0]?.party ?? "acct"}_${spec.product}`;
  let id = spec.id ?? `${base}_${hashParts(base, spec.name, ctx.state.clock).slice(0, 6)}`;
  while (own(ctx.state.entities, id)) id = `${id}x`;
  return id;
}

/** Opens an account from a product: the account (opened now), a loan's disbursement, a card in its holder's hands. */
export function openAccount(ctx: ReadContext, spec: OpenAccount): LedgerEvent[] | Rejection {
  const products = worldProducts(ctx.world);
  const cls = own(products, spec.product)?.class ?? (isAccountClass(spec.product) ? spec.product : null);
  if (!cls) return reject("bad_product", `there's no product ${spec.product.replace(/_/g, " ")}`);
  const holder = spec.owners[0]?.party;
  if (!holder || !own(ctx.state.entities, holder)) return reject("missing_entity", "an account needs an owner");
  const id = newAccountId(ctx, spec);
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, ctx.state.clock);
  const opened = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const t = CLASS_TRAITS[cls];
  const fields: JsonObject = { owners: spec.owners.map((o) => ({ party: o.party, role: o.role, ...(o.share !== undefined ? { share: o.share } : {}) })), product: spec.product, opening: 0, opened, status: "open" };
  if (spec.apr_pct !== undefined) fields.apr_pct = spec.apr_pct;
  if (t.revolving && typeof spec.cents === "number") fields.limit = Math.round(spec.cents);
  if (t.installment) {
    if (spec.term_months !== undefined) {
      fields.term_months = spec.term_months;
      fields.months_left = spec.term_months;
    }
    fields.due_day = Math.min(28, d.day);
    const from = depositAccount(ctx, holder);
    if (from) {
      fields.autopay = "minimum";
      fields.autopay_from = from;
    }
  }
  if (spec.secured_by) fields.secured_by = spec.secured_by;
  if (t.revolving) fields.statement_day = Math.min(28, d.day);
  const out: LedgerEvent[] = [{ type: "spawn", entity: { id, kind: "account", name: spec.name, tier: "background", fields, relations: [] } }, { type: FINANCE_EVENTS.open, data: { accounts: [id] } }];
  if (t.installment && typeof spec.cents === "number" && spec.cents > 0) {
    const into = spec.into ?? depositAccount(ctx, holder) ?? external(holder);
    out.push(...posting([{ account: id, amount: -Math.round(spec.cents) }, { account: into, amount: Math.round(spec.cents) }], { memo: `${spec.name}: loan paid out`, kind: "deposit", category: "loan" }));
  }
  if (spec.card && (t.revolving || t.transactional)) {
    const cardId = `${id}_card`;
    out.push({ type: "spawn", entity: { id: cardId, kind: "card", name: /\bcard$/i.test(spec.name) ? spec.name : `${spec.name} card`, tier: "background", fields: { account: id, holder, network: cls === "charge_card" ? "charge" : t.revolving ? "credit" : "debit", state: "active" }, relations: [] } });
  }
  for (const o of spec.owners) if (o.role === "owner" || o.role === "joint") if (isParty(ctx, o.party) && t.liability) out.push({ type: FINANCE_EVENTS.credit, data: { person: o.party, kind: "opened", account: id } });
  return out;
}

/** What a credit application brings, for a module (`api.applyCredit`) or the player's action. */
export type CreditRequest = CreditApplication & { into?: string; id?: EntityId; name?: string };

/**
 * Applying for credit: where credit reports run, a hard inquiry and the lender's decision at the
 * applicant's score; anywhere, no more than a lender extends. Approved, the account opens at the
 * decided APR and limit, with a loan's principal paid to `into` (an account the applicant may pay
 * into, or the outside); declined, the decision says why and only the inquiry is made.
 */
export function creditApplication(ctx: ReadContext, who: EntityId, app: CreditRequest): { decision: Decision; events: LedgerEvent[] } | Rejection {
  if (!isParty(ctx, who)) return reject("missing_entity", `no ${labelOf(ctx, who)}`);
  const reports = featureFor(ctx, who, "credit");
  const decision = decide(ctx, who, app, reports);
  if ("code" in decision) return decision;
  const inquiry: LedgerEvent[] = reports ? [{ type: FINANCE_EVENTS.credit, data: { person: who, kind: "inquiry", note: app.product.replace(/_/g, " ") } }] : [];
  if (!decision.approved) return { decision, events: inquiry };
  if (app.into !== undefined && own(ctx.state.entities, app.into)) {
    const unusable = mayUse(ctx, who, app.into, "into");
    if (unusable) return unusable;
  }
  const amount = decision.limit ?? app.cents;
  const opened = openAccount(ctx, { ...(app.id ? { id: app.id } : {}), name: app.name ?? decision.label, product: app.product, owners: [{ party: who, role: "owner" }], ...(amount !== undefined ? { cents: amount } : {}), ...(app.into !== undefined ? { into: app.into } : {}), ...(app.term_months !== undefined ? { term_months: app.term_months } : {}), ...(decision.apr !== null ? { apr_pct: decision.apr } : {}), ...(app.secured_by ? { secured_by: app.secured_by } : {}), card: CLASS_TRAITS[decision.cls].revolving });
  if ("code" in opened) return opened;
  return { decision, events: [...inquiry, ...opened] };
}

/** The player's (or anyone's) application for credit, with the note that says how it went. */
export function applyForCredit(ctx: ReadContext, who: EntityId, product: string, cents: number | undefined, term: number | undefined, securedBy?: EntityId): LedgerEvent[] | Rejection {
  const made = creditApplication(ctx, who, { product, ...(cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term_months: term } : {}), ...(securedBy ? { secured_by: securedBy } : {}) });
  if ("code" in made) return made;
  const d = made.decision;
  const note = d.approved ? signal("bill", `Approved: a ${d.label.toLowerCase()}${d.apr !== null ? ` at ${d.apr}% APR` : ""}${d.limit ? ` with a ${money(ctx, d.limit)} limit` : ""}.`, who, ctx.state.clock) : signal("decline", `The application for a ${d.label.toLowerCase()} was declined: ${d.reason}.`, who, ctx.state.clock);
  return [...made.events, note];
}

/** A party's payment preferences, set by them: a list of tiers, or that list as JSON text (an action's parameters are scalars). */
export function setPayPrefs(ctx: ReadContext, who: EntityId, tiers: JsonValue | undefined): LedgerEvent[] | Rejection {
  if (!isParty(ctx, who)) return reject("missing_entity", `no ${labelOf(ctx, who)}`);
  let raw = tiers;
  if (typeof tiers === "string") {
    try {
      raw = JSON.parse(tiers) as JsonValue;
    } catch {
      return reject("bad_tiers", "payment preferences are a list of ways to pay");
    }
  }
  const list = Array.isArray(raw) ? raw.map((t) => objOf(t)).filter((t) => typeof t.use === "string" && t.use !== "") : null;
  if (!list) return reject("bad_tiers", "payment preferences are a list of ways to pay");
  return [{ type: "set", entity: who, field: "pay_prefs", value: list }];
}

/**
 * GM: closes an account that owes and holds nothing, and has nothing still to come in (an opening
 * that posts when its holder's money opens); its cards are cancelled.
 */
export function closeAccount(ctx: ReadContext, account: EntityId): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, account);
  if (e?.kind !== "account") return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
  if (balance(ctx.state, account) !== 0) return reject("not_empty", `${labelOf(ctx, account)} still has ${money(ctx, balance(ctx.state, account))} on it`);
  const opening = Math.round(numOf(e.fields.opening));
  if (opening !== 0 && !isOpened(ctx.state, account, openerOf(ctx.state, account))) return reject("not_empty", `${labelOf(ctx, account)} opens with ${money(ctx, opening)} still to post`);
  return [{ type: FINANCE_EVENTS.status, data: { account, status: "closed" } }, ...cardsOn(ctx.state, account).map((c): LedgerEvent => ({ type: "set", entity: c, field: "state", value: "cancelled" }))];
}

/** GM: an account's status; closing it is closing the account, with the same checks. */
export function setStatus(ctx: ReadContext, account: EntityId, status: string): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, account)?.kind !== "account") return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
  if (!(ACCOUNT_STATUSES as readonly string[]).includes(status)) return reject("bad_status", `an account can't be ${status}`);
  if (statusOf(ctx.state, account) === status) return [];
  return status === "closed" ? closeAccount(ctx, account) : [{ type: FINANCE_EVENTS.status, data: { account, status } }];
}

export function releaseHold(ctx: ReadContext, account: EntityId, hold: string): LedgerEvent[] | Rejection {
  if (!own(ctx.state.entities, account)) return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
  return [{ type: FINANCE_EVENTS.hold, data: { id: hold, account, release: true } }];
}

/** The holders of an account who may act for it (its POV first when the POV is one). */
export function actorOf(ctx: ReadContext, account: EntityId): EntityId | null {
  const holders = holdersOf(ctx.state, account);
  return holders.includes(ctx.world.pov) ? ctx.world.pov : (holders[0] ?? null);
}
