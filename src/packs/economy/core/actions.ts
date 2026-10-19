// What a player or a character does with their money (DESIGN §25.3, §25.5, §25.8–§25.10): cash at
// a machine or a branch, cards (freeze, report lost, replace), autopay, standing flows, applying
// for credit, payment preferences; and the GM's controls that aren't fields. Each is an effect the
// engine validates; the actions that offer them read only what the player could do in the world.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_STATES, CLASS_TRAITS, FINANCE_EVENTS, FLOW_KINDS, FLOW_SHORTFALLS, isAccountClass, isCredit, type AtmFeature, type Owner } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { formatMoney, type EntityDef } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { GONE_FIELD } from "../../../engine/scope";
import { labelOf, numOf, objOf, optionalService, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { placeOfEntity } from "../../../engine/scope";
import { decide } from "./credit";
import type { OpenAccount } from "./module";
import { reject, spendOf } from "./journal";
import { availableOf, balance, bankSide, canSpend, classOf, external, holdersOf, productOf, rightsOf, statusOf, traitsOf, worldProducts } from "./model";
import { accountFeature, asUnit, cardProblem, cardRoom, cardsOn, cashAccount, depositAccount, featureFor, isParty, posting, signal } from "./pay";

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
  const atTop = featureFor(ctx, who, "atm");
  const lines: PostingLine[] = [{ account: wallet, amount: cents }];
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
        if (surcharge > 0) lines.push({ account: external(`atm:${atm.feature.bank}`), amount: surcharge });
        if (p.fees.atm > 0) lines.push({ account: bankSide(p.institution), amount: p.fees.atm });
        fees += surcharge + p.fees.atm;
      }
      if (Number.isFinite(cardRoom(ctx, card, "atm"))) {
        const day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex;
        const s = spendOf(ctx.state, card, day);
        extra.push({ type: FINANCE_EVENTS.spend, data: { card, day, purchase: s.purchase, atm: s.atm + cents } });
      }
    } else return reject("no_atm", `there's no cash machine or ${p.institution || "bank"} branch here`);
  }
  if (t?.revolving && accountFeature(ctx, account, "fees")) {
    const advance = Math.max(p.fees.cash_advance_min, Math.round((cents * p.fees.cash_advance_pct) / 100));
    if (advance > 0) {
      lines.push({ account: bankSide(p.institution), amount: advance });
      fees += advance;
    }
  }
  const total = cents + fees;
  if (availableOf(ctx, account) < total) return reject("declined", `${labelOf(ctx, account)} can't cover ${money(ctx, total)}`);
  lines.unshift({ account, amount: -total });
  const merged: PostingLine[] = [];
  for (const l of lines) {
    const same = merged.find((x) => x.account === l.account);
    if (same) same.amount += l.amount;
    else merged.push({ ...l });
  }
  const memo = `Cash withdrawal${where ? ` ${where}` : ""}${fees > 0 ? ` (${money(ctx, fees)} in fees)` : ""}`;
  return asUnit([...posting(merged, { memo, kind: "withdrawal", category: "transfer", ...(card ? { card } : {}) }), ...extra]);
}

/**
 * Cash from the wallet into an account. Where cash needs a machine, at a branch of the account's
 * bank it is available at once; at one of its bank's machines that takes deposits it is held for
 * the account's hold days where holds run.
 */
export function deposit(ctx: ReadContext, who: EntityId, account: EntityId, raw: number): LedgerEvent[] | Rejection {
  const cents = Math.round(raw);
  if (!(cents > 0)) return reject("bad_amount", "the amount must be positive");
  if (!rightsOf(ctx.state, account, who) || traitsOf(ctx, account)?.cash || traitsOf(ctx, account)?.locked) return reject("not_owner", `${labelOf(ctx, who)} can't pay cash into ${labelOf(ctx, account)}`);
  const wallet = cashAccount(ctx, who);
  if (!wallet || availableOf(ctx, wallet) < cents) return reject("declined", `${labelOf(ctx, who)} doesn't have ${money(ctx, cents)} in cash`);
  const p = productOf(ctx, account);
  if (!p) return reject("missing_account", "no such account");
  if (traitsOf(ctx, account)?.liability && cents > -balance(ctx.state, account)) return reject("overpay", `${labelOf(ctx, account)} owes only ${money(ctx, Math.max(0, -balance(ctx.state, account)))}`);
  let held = false;
  let where = "";
  if (featureFor(ctx, who, "atm")) {
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
  if (strOf(e.fields.holder) !== who && !rightsOf(ctx.state, strOf(e.fields.account), who)?.manage) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s`);
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
  if (holder !== who && !rightsOf(ctx.state, strOf(e.fields.account), who)?.manage) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s`);
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

/** A credit account's autopay: how much, and from which account the holder can spend from. */
export function setAutopay(ctx: ReadContext, who: EntityId, account: EntityId, mode: string, from: string, cents: number): LedgerEvent[] | Rejection {
  const cls = classOf(ctx, account);
  if (!cls || !isCredit(cls)) return reject("not_credit", `${labelOf(ctx, account)} isn't a card or a loan`);
  if (!rightsOf(ctx.state, account, who)?.manage) return reject("not_owner", `${labelOf(ctx, account)} isn't ${labelOf(ctx, who)}'s to change`);
  if (!(AUTOPAY_MODES as readonly string[]).includes(mode)) return reject("bad_mode", `autopay can't be ${mode}`);
  if (from !== "" && (!canSpend(ctx.state, from, who) || !traitsOf(ctx, from)?.pays || traitsOf(ctx, from)?.liability)) return reject("bad_account", `${labelOf(ctx, who)} can't pay from ${labelOf(ctx, from)}`);
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

/** Whether a party may run a flow that pays from `from`: an account they can spend from, or themselves. */
function mayPayFrom(ctx: ReadContext, who: EntityId, from: string): boolean {
  return from === who || canSpend(ctx.state, from, who);
}

export function createFlow(ctx: ReadContext, who: EntityId, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const made = flowFields(args);
  if ("code" in made) return made;
  const f = made.fields;
  const from = strOf(f.from);
  const to = strOf(f.to);
  if (from === "" || to === "" || typeof f.amount_cents !== "number" || !(f.amount_cents > 0)) return reject("bad_flow", "a flow needs who pays, who is paid and an amount");
  if (!mayPayFrom(ctx, who, from)) return reject("not_owner", `${labelOf(ctx, who)} can't pay from ${labelOf(ctx, from)}`);
  if (f.once === undefined && f.every === undefined) return reject("bad_flow", "a flow needs a schedule");
  const label = made.label ?? `Payment to ${labelOf(ctx, to)}`;
  const toMine = own(ctx.state.entities, to)?.kind === "account" && rightsOf(ctx.state, to, who) !== null;
  const fields: JsonObject = { flow_kind: toMine ? "transfer" : "bill", shortfall: "skip", status: "active", ...f };
  const id = `flow_${who}_${hashParts(who, label, ctx.state.clock).slice(0, 8)}`;
  const entity: EntityDef = { id, kind: "flow", name: label, tier: "background", fields, relations: [] };
  return [{ type: "spawn", entity }];
}

export function updateFlow(ctx: ReadContext, who: EntityId, flow: EntityId, args: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const e = own(ctx.state.entities, flow);
  if (e?.kind !== "flow") return reject("not_flow", `${labelOf(ctx, flow)} isn't a standing payment`);
  if (!mayPayFrom(ctx, who, strOf(e.fields.from))) return reject("not_owner", `${e.name} isn't ${labelOf(ctx, who)}'s to change`);
  const made = flowFields(args);
  if ("code" in made) return made;
  if (typeof made.fields.from === "string" && !mayPayFrom(ctx, who, made.fields.from)) return reject("not_owner", `${labelOf(ctx, who)} can't pay from ${labelOf(ctx, made.fields.from)}`);
  const out: LedgerEvent[] = Object.entries(made.fields).map(([field, value]): LedgerEvent => ({ type: "set", entity: flow, field, value }));
  return out;
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
    out.push({ type: "spawn", entity: { id: cardId, kind: "card", name: `${spec.name} card`, tier: "background", fields: { account: id, holder, network: cls === "charge_card" ? "charge" : t.revolving ? "credit" : "debit", state: "active" }, relations: [] } });
  }
  for (const o of spec.owners) if (o.role === "owner" || o.role === "joint") if (isParty(ctx, o.party) && t.liability) out.push({ type: FINANCE_EVENTS.credit, data: { person: o.party, kind: "opened", account: id } });
  return out;
}

/**
 * Applying for credit: a hard inquiry on the report, then the account at the APR and limit the
 * score earns, or a decline that says why.
 */
export function applyForCredit(ctx: ReadContext, who: EntityId, product: string, cents: number | undefined, term: number | undefined, securedBy?: EntityId): LedgerEvent[] | Rejection {
  if (!isParty(ctx, who)) return reject("missing_entity", `no ${labelOf(ctx, who)}`);
  const inquiry: LedgerEvent = { type: FINANCE_EVENTS.credit, data: { person: who, kind: "inquiry", note: product.replace(/_/g, " ") } };
  if (!featureFor(ctx, who, "credit")) {
    const products = worldProducts(ctx.world);
    const label = own(products, product)?.label ?? product.replace(/_/g, " ");
    const opened = openAccount(ctx, { name: label, product, owners: [{ party: who, role: "owner" }], ...(cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term_months: term } : {}), card: true });
    return opened;
  }
  const d = decide(ctx, who, { product, ...(cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term_months: term } : {}), ...(securedBy ? { secured_by: securedBy } : {}) });
  if ("code" in d) return d;
  if (!d.approved) return [inquiry, signal("decline", `The application for a ${d.label.toLowerCase()} was declined: ${d.reason}.`, who, ctx.state.clock)];
  const owners: Owner[] = [{ party: who, role: "owner" }];
  const limit = CLASS_TRAITS[d.cls].revolving ? Math.min(cents ?? Number.MAX_SAFE_INTEGER, d.limit ?? cents ?? 0) : undefined;
  const opened = openAccount(ctx, { name: d.label, product, owners, ...(limit !== undefined ? { cents: limit } : cents !== undefined ? { cents } : {}), ...(term !== undefined ? { term_months: term } : {}), ...(d.apr !== null ? { apr_pct: d.apr } : {}), ...(securedBy ? { secured_by: securedBy } : {}), card: CLASS_TRAITS[d.cls].revolving });
  if ("code" in opened) return opened;
  return [inquiry, ...opened, signal("bill", `Approved: a ${d.label.toLowerCase()}${d.apr !== null ? ` at ${d.apr}% APR` : ""}${limit ? ` with a ${money(ctx, limit)} limit` : ""}.`, who, ctx.state.clock)];
}

/** A party's payment preferences, set by them. */
export function setPayPrefs(ctx: ReadContext, who: EntityId, tiers: JsonValue | undefined): LedgerEvent[] | Rejection {
  if (!isParty(ctx, who)) return reject("missing_entity", `no ${labelOf(ctx, who)}`);
  const list = Array.isArray(tiers) ? tiers.map((t) => objOf(t)).filter((t) => typeof t.use === "string" && t.use !== "") : null;
  if (!list) return reject("bad_tiers", "payment preferences are a list of ways to pay");
  return [{ type: "set", entity: who, field: "pay_prefs", value: list }];
}

/** GM: closes an account that owes and holds nothing; its cards are cancelled. */
export function closeAccount(ctx: ReadContext, account: EntityId): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, account)?.kind !== "account") return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
  if (balance(ctx.state, account) !== 0) return reject("not_empty", `${labelOf(ctx, account)} still has ${money(ctx, balance(ctx.state, account))} on it`);
  return [{ type: FINANCE_EVENTS.status, data: { account, status: "closed" } }, ...cardsOn(ctx.state, account).map((c): LedgerEvent => ({ type: "set", entity: c, field: "state", value: "cancelled" }))];
}

export function setStatus(ctx: ReadContext, account: EntityId, status: string): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, account)?.kind !== "account") return reject("not_account", `${labelOf(ctx, account)} isn't an account`);
  if (!(ACCOUNT_STATUSES as readonly string[]).includes(status)) return reject("bad_status", `an account can't be ${status}`);
  return statusOf(ctx.state, account) === status ? [] : [{ type: FINANCE_EVENTS.status, data: { account, status } }];
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
