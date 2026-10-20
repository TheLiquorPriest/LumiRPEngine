// What every money control sends (DESIGN §25–§27): the player's in-world actions (`lre.action`,
// the ids in `FINANCE_ACTIONS`) and the GM's edits (`lre.edit` operations on the declared fields of
// money entities, `spawn` and `despawn` for flows and jobs, and the GM effects). Kept pure, so the
// mapping from a tap to its message is tested directly; amounts arrive typed and are read in the
// world's currency.

import type { ChatId, EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EditOp } from "../../../shared/protocol";
import { parseMoneyInput } from "../../../shared/money";
import type { WorldCurrency } from "../../../shared/world";
import { FINANCE_ACTIONS, type AutopayMode, type CardState, type Flow, type FlowKind, type FlowShortfall, type PayTier } from "../../../shared/finance";
import type { Req } from "../../../frontend/requests";

/** An action without its chat: the id and the params it plays with. */
export interface ActionBody {
  action: string;
  params: JsonObject;
}

/** A dashboard action as the protocol carries it; no typed words go with it, so nothing judges a described approach. */
export function actionRequest(chatId: ChatId, body: ActionBody): Req<"lre.action"> {
  return { type: "lre.action", chatId, action: body.action, params: body.params, source: "palette" };
}

/** A typed amount above zero, in minor units; null when it isn't one. */
export function amountOf(text: string, currency: WorldCurrency): number | null {
  const cents = parseMoneyInput(text, currency);
  return cents !== null && cents > 0 ? cents : null;
}

// ---------------------------------------------------------------- moving money

export function transferAction(from: EntityId, to: EntityId, cents: number): ActionBody {
  return { action: FINANCE_ACTIONS.transfer, params: { from, to, amount: cents } };
}

/** A payment toward a card, a line or a loan, from the account named (else the holder's checking); with no amount, the whole balance. */
export function payCardAction(account: EntityId, from: EntityId | null, cents: number | null): ActionBody {
  const params: JsonObject = { card: account };
  if (from) params.from = from;
  if (cents !== null) params.amount = cents;
  return { action: FINANCE_ACTIONS.payCard, params };
}

export function cashAction(kind: "withdraw" | "deposit", account: EntityId, cents: number): ActionBody {
  return { action: kind === "withdraw" ? FINANCE_ACTIONS.withdraw : FINANCE_ACTIONS.deposit, params: { account, amount: cents } };
}

/** Autopay on a credit account: a mode, the account it pays from, and a fixed amount for `fixed`. */
export function autopayAction(account: EntityId, mode: AutopayMode, from: EntityId | null, cents: number | null): ActionBody {
  const params: JsonObject = { account, mode };
  if (mode !== "none" && from) params.from = from;
  if (mode === "fixed" && cents !== null) params.amount = cents;
  return { action: FINANCE_ACTIONS.autopay, params };
}

/** The GM's autopay: the account's own fields, only those that change. */
export function autopayOps(account: EntityId, was: { mode: AutopayMode; from: EntityId | null; cents: number | null } | null, mode: AutopayMode, from: EntityId | null, cents: number | null): EditOp[] {
  const ops: EditOp[] = [];
  if (was?.mode !== mode) ops.push({ op: "set", entity: account, field: "autopay", value: mode });
  if (mode !== "none" && from && was?.from !== from) ops.push({ op: "set", entity: account, field: "autopay_from", value: from });
  if (mode === "fixed" && cents !== null && was?.cents !== cents) ops.push({ op: "set", entity: account, field: "autopay_cents", value: cents });
  return ops;
}

// ---------------------------------------------------------------- cards

export type CardChange = "freeze" | "unfreeze" | "lost" | "replace";

/** What a card's state allows: freeze an active card, unfreeze a frozen one, report either lost, replace a lost or frozen one. */
export function cardChanges(state: CardState): CardChange[] {
  switch (state) {
    case "active":
      return ["freeze", "lost", "replace"];
    case "frozen":
      return ["unfreeze", "lost", "replace"];
    case "lost":
      return ["replace"];
    case "cancelled":
      return [];
  }
}

export function cardAction(card: EntityId, change: CardChange): ActionBody {
  const action = { freeze: FINANCE_ACTIONS.cardFreeze, unfreeze: FINANCE_ACTIONS.cardUnfreeze, lost: FINANCE_ACTIONS.cardLost, replace: FINANCE_ACTIONS.cardReplace }[change];
  return { action, params: { card } };
}

// ---------------------------------------------------------------- flows

/** The schedule a flow form offers: once, or every Nth day, week, month or year. */
export type FlowEvery = "once" | "day" | "week" | "month" | "year";

/** A standing payment, income or one-off as the flow form holds it (amounts as typed). */
export interface FlowForm {
  label: string;
  kind: FlowKind;
  from: string;
  to: string;
  amount: string;
  every: FlowEvery;
  /** Every Nth period (2 with week is biweekly). */
  interval: number;
  /** Day of the month for monthly and yearly; -1 is the last day. */
  day: number | null;
  /** 0 = Sunday, for weekly. */
  weekday: number | null;
  /** Month (1–12) for yearly. */
  month: number | null;
  /** `HH:MM`; empty for the engine's 09:00. */
  at: string;
  /** `YYYY-MM-DD`: the first day it runs, or a one-off's day. */
  start: string;
  end: string;
  count: number | null;
  /** A due day off a business day moves before or after it; empty leaves it to the engine. */
  roll: "" | "none" | "before" | "after";
  shortfall: FlowShortfall;
  /** `retry`: days between tries and how many. */
  retryDays: number | null;
  retries: number | null;
  /** `fallback`: the account that pays instead. */
  fallback: string;
  category: string;
}

export function blankFlowForm(from: string): FlowForm {
  return { label: "", kind: "transfer", from, to: "", amount: "", every: "month", interval: 1, day: 1, weekday: null, month: null, at: "", start: "", end: "", count: null, roll: "", shortfall: "skip", retryDays: null, retries: null, fallback: "", category: "" };
}

/** A stored flow as the form edits it. An amount that isn't fixed (a formula, a percentage) leaves the amount empty: it stays as it is unless one is typed. */
export function flowFormOf(flow: Flow, currency: WorldCurrency): FlowForm {
  const s = flow.schedule;
  const once = typeof s.once === "string" && s.once !== "" ? s.once : null;
  const fixed = "fixed" in flow.amount ? flow.amount.fixed : null;
  const decimals = Math.max(0, Math.min(6, Math.trunc(currency.decimals)));
  return {
    label: flow.label,
    kind: flow.kind,
    from: flow.from,
    to: flow.to,
    amount: fixed === null ? "" : (fixed / 10 ** decimals).toFixed(decimals),
    every: once ? "once" : (s.every ?? "month"),
    interval: s.interval ?? 1,
    day: s.days?.[0] ?? null,
    weekday: s.weekdays?.[0] ?? null,
    month: s.months?.[0] ?? null,
    at: once ? once.slice(11, 16) : (s.at ?? ""),
    start: once ? once.slice(0, 10) : (flow.start ?? ""),
    end: flow.end ?? "",
    count: flow.count ?? null,
    roll: s.roll ?? "",
    shortfall: flow.shortfall,
    retryDays: flow.retry_days ?? null,
    retries: flow.retries ?? null,
    fallback: flow.fallback ?? "",
    category: flow.category ?? "",
  };
}

/** Why a flow form can't be sent, in words; null when it can. */
export function flowFormProblem(form: FlowForm, currency: WorldCurrency, requireAmount: boolean): string | null {
  if (form.label.trim() === "") return "Give it a name.";
  if (form.from.trim() === "" || form.to.trim() === "") return "Say where the money comes from and where it goes.";
  if (form.from === form.to) return "It can't pay itself.";
  if ((requireAmount || form.amount.trim() !== "") && amountOf(form.amount, currency) === null) return "Type an amount above zero.";
  if (form.every === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(form.start)) return "Pick the day it happens.";
  if (!Number.isInteger(form.interval) || form.interval < 1) return "Repeat every 1 or more.";
  if ((form.every === "month" || form.every === "year") && form.day !== null && !(form.day === -1 || (Number.isInteger(form.day) && form.day >= 1 && form.day <= 31))) return "A day of the month is 1–31, or the last day.";
  if (form.every === "week" && form.weekday === null) return "Pick a weekday.";
  if (form.every === "year" && form.month === null) return "Pick a month.";
  if (form.at !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.at)) return "A time is HH:MM.";
  if (form.every !== "once" && form.start !== "" && form.end !== "" && form.end < form.start) return "It ends before it starts.";
  if (form.count !== null && !(Number.isInteger(form.count) && form.count >= 1)) return "A count is a whole number from 1.";
  if (form.shortfall === "fallback" && form.fallback === "") return "Pick the account that pays when this one can't.";
  if (form.shortfall === "retry" && ((form.retryDays !== null && !(Number.isInteger(form.retryDays) && form.retryDays >= 1)) || (form.retries !== null && !(Number.isInteger(form.retries) && form.retries >= 1)))) return "Retries are whole numbers from 1.";
  return null;
}

/**
 * A flow form as `flow_create` and `flow_update` take it: the amount in minor units; a one-off as
 * `once` (`YYYY-MM-DDTHH:MM`), a repeat as `every` with its interval (1 too, so an edit back to
 * every time goes), weekday, day or month, time, start, end and count; the shortfall with what it
 * needs.
 */
export function flowParams(form: FlowForm, currency: WorldCurrency): JsonObject {
  const params: JsonObject = { label: form.label.trim(), kind: form.kind, from: form.from, to: form.to.trim(), every: form.every, shortfall: form.shortfall };
  const cents = amountOf(form.amount, currency);
  if (cents !== null) params.amount = cents;
  if (form.every === "once") params.once = `${form.start}T${form.at || "09:00"}`;
  else {
    params.interval = form.interval;
    if ((form.every === "month" || form.every === "year") && form.day !== null) params.day = form.day;
    if (form.every === "week" && form.weekday !== null) params.weekday = form.weekday;
    if (form.every === "year" && form.month !== null) params.month = form.month;
    if (form.at !== "") params.at = form.at;
    if (form.start !== "") params.start = form.start;
    if (form.end !== "") params.end = form.end;
    if (form.count !== null) params.count = form.count;
    if (form.roll !== "") params.roll = form.roll;
  }
  if (form.shortfall === "retry") {
    if (form.retryDays !== null) params.retry_days = form.retryDays;
    if (form.retries !== null) params.retries = form.retries;
  }
  if (form.shortfall === "fallback" && form.fallback !== "") params.fallback = form.fallback;
  if (form.category.trim() !== "") params.category = form.category.trim();
  return params;
}

export function flowCreateAction(form: FlowForm, currency: WorldCurrency): ActionBody {
  return { action: FINANCE_ACTIONS.flowCreate, params: flowParams(form, currency) };
}

/** The schedule's params: sent whole when any of them changes, so a new monthly schedule never keeps an old weekday. */
const SCHEDULE_PARAMS = ["every", "interval", "day", "weekday", "month", "at", "once", "roll"];

/** The changes a flow form makes to a stored flow (an omitted param leaves its part as it is); null when nothing changes. */
export function flowUpdateAction(flow: Flow, form: FlowForm, currency: WorldCurrency): ActionBody | null {
  const was = flowParams(flowFormOf(flow, currency), currency);
  const now = flowParams(form, currency);
  const changed: JsonObject = {};
  for (const [key, value] of Object.entries(now)) if (JSON.stringify(was[key] ?? null) !== JSON.stringify(value)) changed[key] = value;
  if (SCHEDULE_PARAMS.some((key) => key in changed)) for (const key of SCHEDULE_PARAMS) if (now[key] !== undefined) changed[key] = now[key] as JsonValue;
  return Object.keys(changed).length === 0 ? null : { action: FINANCE_ACTIONS.flowUpdate, params: { flow: flow.id, ...changed } };
}

export function flowStatusAction(flow: string, change: "pause" | "resume" | "delete"): ActionBody {
  return { action: change === "pause" ? FINANCE_ACTIONS.flowPause : change === "resume" ? FINANCE_ACTIONS.flowResume : FINANCE_ACTIONS.flowDelete, params: { flow } };
}

/** A flow form as a `flow` entity's declared fields (`FlowFields`); the label is the entity's name. */
export function flowFieldsOf(form: FlowForm, currency: WorldCurrency): JsonObject {
  const fields: JsonObject = { flow_kind: form.kind, from: form.from, to: form.to.trim(), shortfall: form.shortfall };
  const cents = amountOf(form.amount, currency);
  if (cents !== null) fields.amount_cents = cents;
  if (form.every === "once") fields.once = `${form.start}T${form.at || "09:00"}`;
  else {
    fields.every = form.every;
    fields.interval = form.interval;
    if ((form.every === "month" || form.every === "year") && form.day !== null) fields.days = [form.day];
    if (form.every === "week" && form.weekday !== null) fields.weekdays = [form.weekday];
    if (form.every === "year" && form.month !== null) fields.months = [form.month];
    if (form.at !== "") fields.at = form.at;
    if (form.start !== "") fields.start = form.start;
    if (form.end !== "") fields.end = form.end;
    if (form.count !== null) fields.count = form.count;
    if (form.roll !== "") fields.roll = form.roll;
  }
  if (form.shortfall === "retry") {
    if (form.retryDays !== null) fields.retry_days = form.retryDays;
    if (form.retries !== null) fields.retries = form.retries;
  }
  if (form.shortfall === "fallback" && form.fallback !== "") fields.fallback = form.fallback;
  if (form.category.trim() !== "") fields.category = form.category.trim();
  return fields;
}

/** An id for a new entity: the label's words, unique among `taken`. */
export function newIdFor(prefix: string, label: string, taken: ReadonlySet<string>): string {
  const base = `${prefix}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "new"}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The GM's new flow: spawned under its label, its fields set, active, all in one edit. */
export function flowSpawnOps(id: EntityId, form: FlowForm, currency: WorldCurrency): EditOp[] {
  const fields = { ...flowFieldsOf(form, currency), status: "active" };
  return [{ op: "spawn", kind: "flow", name: form.label.trim(), id }, ...Object.entries(fields).map(([field, value]): EditOp => ({ op: "set", entity: id, field, value }))];
}

/**
 * The GM's change to a flow: a `set` for each declared field the form changes (its name is the
 * entity's and stays). A set can't unset, so a schedule that changes shape empties what the old
 * shape held: the weekday list goes empty when a flow turns monthly, and `once` when a one-off
 * becomes a repeat.
 */
export function flowEditOps(flow: Flow, form: FlowForm, currency: WorldCurrency): EditOp[] {
  const was = flowFieldsOf(flowFormOf(flow, currency), currency);
  const now = flowFieldsOf(form, currency);
  const ops: EditOp[] = [];
  for (const [field, value] of Object.entries(now)) if (JSON.stringify(was[field] ?? null) !== JSON.stringify(value)) ops.push({ op: "set", entity: flow.id, field, value });
  for (const field of ["weekdays", "days", "months"]) if (was[field] !== undefined && now[field] === undefined) ops.push({ op: "set", entity: flow.id, field, value: [] });
  if (was.once !== undefined && now.once === undefined) ops.push({ op: "set", entity: flow.id, field: "once", value: "" });
  return ops;
}

export function flowStatusOps(flow: EntityId, status: "active" | "paused" | "ended"): EditOp[] {
  return [{ op: "set", entity: flow, field: "status", value: status }];
}

// ---------------------------------------------------------------- credit and payment preferences

export function applyCreditAction(product: string, cents: number | null): ActionBody {
  return { action: FINANCE_ACTIONS.applyCredit, params: cents === null ? { product } : { product, amount: cents } };
}

/** Payment tiers as stored: only the parts each tier sets. */
export function payTiersValue(tiers: readonly PayTier[]): JsonValue {
  return tiers.map((t) => ({ use: t.use, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), ...(t.categories && t.categories.length > 0 ? { categories: [...t.categories] } : {}), ...(t.except && t.except.length > 0 ? { except: [...t.except] } : {}) }));
}

/** How the player pays from now on. An action's params are scalars, so the tiers travel as their JSON text. */
export function payPrefsAction(tiers: readonly PayTier[]): ActionBody {
  return { action: FINANCE_ACTIONS.payPrefs, params: { tiers: JSON.stringify(payTiersValue(tiers)) } };
}

export function payPrefsOps(person: EntityId, tiers: readonly PayTier[]): EditOp[] {
  return [{ op: "set", entity: person, field: "pay_prefs", value: payTiersValue(tiers) }];
}

// ---------------------------------------------------------------- work and business

export interface HireForm {
  business: EntityId;
  worker: EntityId;
  title: string;
  basis: string;
  rate: string;
  hoursPerWeek: number | null;
  payEvery: string;
}

export function hireAction(form: HireForm, currency: WorldCurrency): ActionBody | null {
  const rate = form.rate.trim() === "" ? null : amountOf(form.rate, currency);
  if (form.business === "" || form.worker === "" || (form.rate.trim() !== "" && rate === null)) return null;
  const params: JsonObject = { business: form.business, worker: form.worker };
  if (form.title.trim() !== "") params.title = form.title.trim();
  if (form.basis !== "") params.basis = form.basis;
  if (rate !== null) params.rate = rate;
  if (form.hoursPerWeek !== null) params.hours_per_week = form.hoursPerWeek;
  if (form.payEvery !== "") params.pay_every = form.payEvery;
  return { action: FINANCE_ACTIONS.hire, params };
}

export function jobEndAction(job: EntityId): ActionBody {
  return { action: FINANCE_ACTIONS.fire, params: { job } };
}

export function raiseAction(job: EntityId, rate: number): ActionBody {
  return { action: FINANCE_ACTIONS.raise, params: { job, rate } };
}

/** An invoice to a customer in the world (`customer`) or an outside one by name (`customer_name`). */
export function invoiceIssueAction(business: EntityId, customer: { id: EntityId } | { name: string }, cents: number, memo: string, days: number | null): ActionBody {
  const params: JsonObject = { business, ...("id" in customer ? { customer: customer.id } : { customer_name: customer.name.trim() }), amount: cents };
  if (memo.trim() !== "") params.memo = memo.trim();
  if (days !== null) params.days = days;
  return { action: FINANCE_ACTIONS.invoiceIssue, params };
}

export function invoiceAction(invoice: string, change: "pay" | "void"): ActionBody {
  return { action: change === "pay" ? FINANCE_ACTIONS.invoicePay : FINANCE_ACTIONS.invoiceVoid, params: { invoice } };
}

export function drawAction(business: EntityId, cents: number): ActionBody {
  return { action: FINANCE_ACTIONS.draw, params: { business, amount: cents } };
}

/** Profit paid out by share; with no amount, the business's distribution percentage of what it made since the last. */
export function distributeAction(business: EntityId, cents: number | null): ActionBody {
  return { action: FINANCE_ACTIONS.distribute, params: cents === null ? { business } : { business, amount: cents } };
}

// ---------------------------------------------------------------- investing and property

export interface TradeForm {
  side: "buy" | "sell";
  /** The position sold or added to; empty for a new one. */
  holding: string;
  asset: string;
  account: string;
  qty: number | null;
  amount: string;
  /** A buy's source and a sale's proceeds: an account of the party's, or empty for the holding's own account (else their deposit account). */
  from: string;
  to: string;
  /** An option on `asset`. */
  option: { right: "call" | "put"; strike: string; expiry: string } | null;
}

/** A trade, or why it can't go: a buy names a holding or an asset; a sell names a holding; a quantity or an amount, or neither to sell it all. */
export function tradeAction(form: TradeForm, currency: WorldCurrency): ActionBody | string {
  const params: JsonObject = { side: form.side };
  if (form.holding !== "") params.holding = form.holding;
  else if (form.side === "sell") return "Pick what to sell.";
  else if (form.asset === "") return "Pick what to buy.";
  else {
    params.asset = form.asset;
    if (form.account !== "") params.account = form.account;
  }
  if (form.qty !== null) {
    if (!(form.qty > 0)) return "A quantity is above zero.";
    params.qty = form.qty;
  } else if (form.amount.trim() !== "") {
    const cents = amountOf(form.amount, currency);
    if (cents === null) return "Type an amount above zero.";
    params.amount = cents;
  } else if (form.side === "buy") return "Say how many, or how much to spend.";
  if (form.side === "buy" && form.from !== "") params.from = form.from;
  if (form.side === "sell" && form.to !== "") params.to = form.to;
  if (form.option && form.holding === "") {
    const strike = amountOf(form.option.strike, currency);
    if (strike === null || !/^\d{4}-\d{2}-\d{2}$/.test(form.option.expiry)) return "An option needs a strike and an expiry date.";
    params.right = form.option.right;
    params.strike = strike;
    params.expiry = form.option.expiry;
  }
  return { action: FINANCE_ACTIONS.trade, params };
}

/** Exercising contracts: all of them unless `qty` says how many; a call's strike paid `from`, a put's paid `to` (else the holding's account, else the deposit account). */
export function exerciseAction(holding: EntityId, qty: number | null, opts: { from?: EntityId; to?: EntityId } = {}): ActionBody {
  return { action: FINANCE_ACTIONS.exercise, params: { holding, ...(qty !== null ? { qty } : {}), ...(opts.from ? { from: opts.from } : {}), ...(opts.to ? { to: opts.to } : {}) } };
}

/** What distributions are routed for: a holding's dividends, a property's rent, or a business's profit share. */
export type RouteTarget = { holding: EntityId } | { property: EntityId } | { business: EntityId };

/** Where distributions go: an account, `reinvest` (a holding only), or "" for the default (the holding's account cash, else the deposit account). */
export function routeAction(target: RouteTarget, to: string): ActionBody {
  return { action: FINANCE_ACTIONS.route, params: { ...target, to } };
}

/** The GM's routing for one party (`economy.route`, a GM effect): its holding's dividends, its property's rent or its share of a business's profit. */
export function routeOps(target: RouteTarget, party: EntityId, to: string): EditOp[] {
  return [{ op: "effect", effect: "economy.route", args: { ...target, party, to } }];
}

export function propertyBuyAction(property: EntityId, price: number, opts: { from?: EntityId; down?: number; termMonths?: number; aprPct?: number } = {}): ActionBody {
  return { action: FINANCE_ACTIONS.propertyBuy, params: { property, price, ...(opts.from ? { from: opts.from } : {}), ...(opts.down !== undefined ? { down: opts.down } : {}), ...(opts.termMonths !== undefined ? { term_months: opts.termMonths } : {}), ...(opts.aprPct !== undefined ? { apr_pct: opts.aprPct } : {}) } };
}

export function propertySellAction(property: EntityId, price: number, opts: { buyer?: EntityId; to?: EntityId } = {}): ActionBody {
  return { action: FINANCE_ACTIONS.propertySell, params: { property, price, ...(opts.buyer ? { buyer: opts.buyer } : {}), ...(opts.to ? { to: opts.to } : {}) } };
}

export function leaseStartAction(property: EntityId, tenant: EntityId, rent: number, opts: { months?: number; day?: number; unit?: string } = {}): ActionBody {
  return { action: FINANCE_ACTIONS.leaseStart, params: { property, tenant, rent, ...(opts.months !== undefined ? { months: opts.months } : {}), ...(opts.day !== undefined ? { day: opts.day } : {}), ...(opts.unit ? { unit: opts.unit } : {}) } };
}

export function leaseEndAction(lease: string, on?: string): ActionBody {
  return { action: FINANCE_ACTIONS.leaseEnd, params: on ? { lease, on } : { lease } };
}

export function stakeSellAction(business: EntityId, share: number, price: number, buyer?: EntityId): ActionBody {
  return { action: FINANCE_ACTIONS.stakeSell, params: { business, share, price, ...(buyer ? { buyer } : {}) } };
}

/** The GM's price for an asset (`economy.set_price`, a GM effect): a price per unit in minor units. */
export function setPriceOps(asset: string, price: number): EditOp[] {
  return [{ op: "effect", effect: "economy.set_price", args: { asset, price } }];
}

/** The GM closes an account that holds and owes nothing (`economy.close_account`); its cards are cancelled. */
export function closeAccountOps(account: EntityId): EditOp[] {
  return [{ op: "effect", effect: "economy.close_account", args: { account } }];
}

/** The GM lets a hold go before it lapses (`economy.release_hold`). */
export function releaseHoldOps(account: EntityId, hold: string): EditOp[] {
  return [{ op: "effect", effect: "economy.release_hold", args: { account, hold } }];
}

/** The GM moves an account to a status (`economy.set_status`): frozen, in collections, charged off, open again. */
export function accountStatusOps(account: EntityId, status: string): EditOp[] {
  return [{ op: "effect", effect: "economy.set_status", args: { account, status } }];
}

// ---------------------------------------------------------------- GM field edits

/**
 * A `set` for each field whose value changes: what a GM form sends for the declared fields of an
 * account, a card, a job, a business, a holding or a property. A field left empty isn't sent (a
 * set can't unset one) unless it's a reference, which a null clears.
 */
export function fieldOps(entity: EntityId, was: Readonly<JsonObject>, now: Readonly<Record<string, JsonValue | undefined>>, refs: ReadonlySet<string> = new Set()): EditOp[] {
  const ops: EditOp[] = [];
  for (const [field, value] of Object.entries(now)) {
    if (value === undefined) {
      if (refs.has(field) && was[field] !== undefined && was[field] !== null) ops.push({ op: "set", entity, field, value: null });
      continue;
    }
    if (JSON.stringify(was[field] ?? null) !== JSON.stringify(value)) ops.push({ op: "set", entity, field, value });
  }
  return ops;
}

/** The GM's new job: spawned with its declared fields, active, in one edit. */
export function jobSpawnOps(id: EntityId, name: string, fields: JsonObject): EditOp[] {
  return [{ op: "spawn", kind: "job", name, id }, ...Object.entries({ ...fields, status: "active" }).map(([field, value]): EditOp => ({ op: "set", entity: id, field, value }))];
}

/** The GM's new property for a party: spawned under its name, the party its whole owner, at its value, in one edit. */
export function propertySpawnOps(id: EntityId, name: string, owner: EntityId, value: number): EditOp[] {
  return [
    { op: "spawn", kind: "property", name, id },
    { op: "set", entity: id, field: "owners", value: [{ party: owner, role: "owner", share: 100 }] },
    { op: "set", entity: id, field: "value", value },
  ];
}
