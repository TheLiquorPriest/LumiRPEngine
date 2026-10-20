// Flows (DESIGN §25.5): one primitive for every scheduled or one-off movement of money. A flow
// is a `flow` entity, or derived from records each time it is read: autopay from a credit
// account's settings, living costs from a party's wealth, insurance from a vehicle, and whatever
// the modules derive (paychecks, rent, dividends, taxes). Each occurrence falls at its own
// instant (the calendar's recurrence, with holidays skipped and weekends rolled), pays at the
// payer's Money level, and when the money isn't there follows the flow's shortfall policy.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { FINANCE_EVENTS, FLOW_KINDS, FLOW_SHORTFALLS, featureOn, type Flow, type FlowAmount, type FlowKind, type FlowOutcome, type FlowRunState, type FlowSchedule, type FlowShortfall, type FlowSplit } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, clockOfLocal, dateAt, dayIndexOfText, holidaysOn, parseHHMM, type Calendar } from "../../../engine/calendar";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { evalNumber } from "../../../engine/expr";
import { labelOf, numOf, objOf, optionalQuery, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs, scopeEnv } from "../../../engine/scope";
import type { FinanceHooks, FlowPosting } from "./module";
import { cycleOf, flowRunOf, reject } from "./journal";
import { accountsOf, availableOf, balance, canSpend, classOf, hasLedger, holdersOf, outsideAccount, priceOf, productOf, statusOf, traitsOf } from "./model";
import { accountLevel, asUnit, charge, chooseSource, depositAccount, isParty, isRejection, overdraftEvents, overdraftRoom, payeeSide, posting, signal, toggles, type PayMethod } from "./pay";
import { Run } from "./run";

export const DEFAULT_FLOW_MINUTE = 9 * 60;

// ---------------------------------------------------------------- the calendar

/** Whether a day is a business day: not a weekend (on the gregorian calendar) and not a holiday off. */
export function isBusinessDay(cal: Calendar, day: number): boolean {
  const weekday = dateAt(cal, clockAt(cal, day, 0)).weekday;
  if (cal.def.system === "gregorian" && (weekday === 0 || weekday === 6)) return false;
  return !holidaysOn(cal, day).some((h) => h.dayOff);
}

/** The business day a day rolls to, `before` or `after` it (itself when it is one). */
export function businessDay(cal: Calendar, day: number, roll: "before" | "after"): number {
  let d = day;
  for (let guard = 0; guard < 14 && !isBusinessDay(cal, d); guard++) d += roll === "before" ? -1 : 1;
  return d;
}

function safeDay(cal: Calendar, text: string | undefined): number | null {
  if (!text) return null;
  try {
    return dayIndexOfText(cal, text.slice(0, 10));
  } catch {
    return null;
  }
}

function dayMatches(cal: Calendar, days: readonly number[], d: number): boolean {
  const date = dateAt(cal, clockAt(cal, d, 0));
  const len = cal.system.monthLength(date.year, date.month);
  return days.some((n) => (n > 0 ? Math.min(n, len) === date.day : n < 0 && len + n + 1 === date.day));
}

/** Whether a nominal day is one a schedule falls on, counting its intervals from `anchor`. */
function falls(cal: Calendar, s: FlowSchedule, d: number, anchor: number): boolean {
  const interval = Math.max(1, Math.round(s.interval ?? 1));
  const date = dateAt(cal, clockAt(cal, d, 0));
  const start = dateAt(cal, clockAt(cal, anchor, 0));
  switch (s.every) {
    case "day":
      return d >= anchor && (d - anchor) % interval === 0;
    case "week": {
      const weekdays = s.weekdays && s.weekdays.length > 0 ? s.weekdays : [start.weekday];
      if (!weekdays.includes(date.weekday)) return false;
      const weekStart = anchor - start.weekday;
      return d >= weekStart && Math.floor((d - weekStart) / 7) % interval === 0;
    }
    case "month": {
      if (!dayMatches(cal, s.days && s.days.length > 0 ? s.days : [start.day], d)) return false;
      const months = date.year * 12 + date.month - (start.year * 12 + start.month);
      return months >= 0 && months % interval === 0;
    }
    case "year": {
      const months = s.months && s.months.length > 0 ? s.months : [start.month];
      if (!months.includes(date.month) || !dayMatches(cal, s.days && s.days.length > 0 ? s.days : [start.day], d)) return false;
      const years = date.year - start.year;
      return years >= 0 && years % interval === 0;
    }
    default:
      return false;
  }
}

/** One occurrence: its instant, and the nominal day it stands for (its key). */
export interface Occurrence {
  at: number;
  day: number;
}

/**
 * The instants a schedule falls due in `(from, to]`: the nominal days it falls on between `start`
 * and `end`, holidays it skips left out, each rolled off a weekend or holiday when it says so, at its
 * time of day. Intervals count from `start` (the calendar's epoch without one).
 */
export function occurrences(ctx: Pick<ReadContext, "world">, s: FlowSchedule, from: number, to: number, start?: string, end?: string): Occurrence[] {
  if (to <= from) return [];
  const cal = calendarOf(ctx.world);
  if (s.once !== undefined && s.once !== "") {
    let at: number | null = null;
    if (typeof s.once === "number") at = s.once;
    else {
      try {
        at = clockOfLocal(cal, s.once);
      } catch {
        at = null;
      }
    }
    return at !== null && at > from && at <= to ? [{ at, day: dateAt(cal, at).dayIndex }] : [];
  }
  if (!s.every) return [];
  let minute = DEFAULT_FLOW_MINUTE;
  if (s.at) {
    try {
      minute = parseHHMM(s.at);
    } catch {
      minute = DEFAULT_FLOW_MINUTE;
    }
  }
  const startDay = safeDay(cal, start);
  const endDay = safeDay(cal, end);
  const anchor = startDay ?? 0;
  const roll = s.roll === "before" || s.roll === "after" ? s.roll : null;
  const margin = roll ? 10 : 1;
  const out: Occurrence[] = [];
  for (let d = dateAt(cal, from).dayIndex - margin; d <= dateAt(cal, to).dayIndex + margin; d++) {
    if ((startDay !== null && d < startDay) || (endDay !== null && d > endDay)) continue;
    if (!falls(cal, s, d, anchor)) continue;
    if (s.except && s.except.length > 0 && holidaysOn(cal, d).some((h) => s.except?.includes(h.id))) continue;
    const at = clockAt(cal, roll ? businessDay(cal, d, roll) : d, minute);
    if (at > from && at <= to) out.push({ at, day: d });
  }
  return out.sort((a, b) => a.at - b.at || a.day - b.day);
}

// ---------------------------------------------------------------- reading flows

function present(v: JsonValue | undefined): boolean {
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
}

function nums(v: JsonValue | undefined): number[] | undefined {
  return Array.isArray(v) && v.length > 0 ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : undefined;
}

function strs(v: JsonValue | undefined): string[] | undefined {
  return Array.isArray(v) && v.length > 0 ? v.filter((x): x is string => typeof x === "string" && x !== "") : undefined;
}

/** A flow entity's amount: the first of its amount fields that's set (empty ones read as unset). */
function amountOfFields(f: JsonObject): FlowAmount | null {
  if (present(f.amount_cents)) return { fixed: Math.round(numOf(f.amount_cents)) };
  if (present(f.amount_formula)) return { formula: strOf(f.amount_formula) };
  if (present(f.amount_table)) {
    const [table, row, column] = splitTableRef(strOf(f.amount_table));
    return table ? { table, row, ...(column ? { column } : {}) } : null;
  }
  if (present(f.amount_min) || present(f.amount_max)) return { range: { min: Math.round(numOf(f.amount_min)), max: Math.round(numOf(f.amount_max, numOf(f.amount_min))) } };
  if (present(f.amount_pct)) return { percent: numOf(f.amount_pct), ...(present(f.amount_of) ? { of: strOf(f.amount_of) } : {}) };
  if (f.amount_due === "minimum" || f.amount_due === "statement" || f.amount_due === "balance") return { due: f.amount_due };
  return null;
}

/** `table.row[.column]`, where a table's own id holds dots (`economy.catalog.natural_gas.price_cents`). */
function splitTableRef(ref: string): [string, string, string | undefined] {
  const parts = ref.split(".");
  // Table ids are `<pack>.<name>`: the first two parts, then the row, then the column.
  return parts.length >= 3 ? [`${parts[0]}.${parts[1]}`, parts[2] ?? "", parts.length > 3 ? parts.slice(3).join(".") : undefined] : ["", "", undefined];
}

function isFlowKind(v: unknown): v is FlowKind {
  return typeof v === "string" && (FLOW_KINDS as readonly string[]).includes(v);
}

function isShortfall(v: unknown): v is FlowShortfall {
  return typeof v === "string" && (FLOW_SHORTFALLS as readonly string[]).includes(v);
}

/** A flow entity as a flow; null when it names no amount or no sides. */
export function flowOfEntity(ctx: Pick<ReadContext, "state">, id: EntityId): Flow | null {
  const e = own(ctx.state.entities, id);
  if (!e || e.kind !== "flow" || isGone(ctx.state, id)) return null;
  const f = e.fields;
  const amount = amountOfFields(f);
  const from = strOf(f.from);
  const to = strOf(f.to);
  if (!amount || from === "" || to === "") return null;
  const every = f.every === "day" || f.every === "week" || f.every === "month" || f.every === "year" ? f.every : undefined;
  const schedule: FlowSchedule = {
    ...(every ? { every } : {}),
    ...(present(f.interval) ? { interval: numOf(f.interval, 1) } : {}),
    ...(nums(f.weekdays) ? { weekdays: nums(f.weekdays) } : {}),
    ...(nums(f.days) ? { days: nums(f.days) } : {}),
    ...(nums(f.months) ? { months: nums(f.months) } : {}),
    ...(strs(f.except) ? { except: strs(f.except) } : {}),
    ...(f.roll === "before" || f.roll === "after" ? { roll: f.roll } : {}),
    ...(present(f.at) ? { at: strOf(f.at) } : {}),
    ...(present(f.once) ? { once: typeof f.once === "number" ? f.once : strOf(f.once) } : {}),
  };
  const splits = Array.isArray(f.splits) ? f.splits.map((x) => objOf(x)).filter((x) => strOf(x.to) !== "").map((x): FlowSplit => ({ to: strOf(x.to), ...(typeof x.cents === "number" ? { cents: x.cents } : {}), ...(typeof x.pct === "number" ? { pct: x.pct } : {}) })) : [];
  const shares = Array.isArray(f.shares) ? f.shares.map((x) => objOf(x)).filter((x) => strOf(x.party) !== "").map((x) => ({ party: strOf(x.party), pct: numOf(x.pct), ...(present(x.from) ? { from: strOf(x.from) } : {}) })) : [];
  const status = f.status === "paused" || f.status === "ended" ? f.status : "active";
  return {
    id,
    label: e.name,
    kind: isFlowKind(f.flow_kind) ? f.flow_kind : "bill",
    from,
    to,
    ...(splits.length > 0 ? { splits } : {}),
    ...(shares.length > 0 ? { shares } : {}),
    amount,
    schedule,
    ...(present(f.start) ? { start: strOf(f.start) } : {}),
    ...(present(f.end) ? { end: strOf(f.end) } : {}),
    ...(present(f.count) ? { count: numOf(f.count) } : {}),
    shortfall: isShortfall(f.shortfall) ? f.shortfall : "skip",
    ...(present(f.retry_days) ? { retry_days: numOf(f.retry_days) } : {}),
    ...(present(f.retries) ? { retries: numOf(f.retries) } : {}),
    ...(present(f.fallback) ? { fallback: strOf(f.fallback) } : {}),
    ...(present(f.category) ? { category: strOf(f.category) } : {}),
    ...(present(f.link) ? { link: strOf(f.link) } : {}),
    status,
    ...(present(f.method) ? { method: strOf(f.method) } : {}),
    source: "entity",
  };
}

/** Everyday spending a week by wealth band (Modern US): one adult's grocery basket times the share of a week's spending it stands for. */
const LIVING_COSTS: Record<string, { basket: string; times: number }> = {
  broke: { basket: "basket_person_thrifty", times: 1 },
  poor: { basket: "basket_person_thrifty", times: 1.5 },
  modest: { basket: "basket_person_moderate", times: 2 },
  comfortable: { basket: "basket_person_moderate", times: 3 },
  rich: { basket: "basket_person_liberal", times: 4 },
  wealthy: { basket: "basket_person_liberal", times: 8 },
};

/**
 * A week of living costs for a wealth band: the world's own `livingCosts` (a weekly amount per band,
 * in its minor units) when it sets them, else the Modern US default, priced from the catalog's
 * grocery baskets at the region's cost of living. Null when neither prices the band.
 */
export function livingCost(ctx: ReadContext, band: string): number | null {
  const authored = objOf(objOf(ctx.world.packs.economy?.config).livingCosts);
  if (Object.keys(authored).length > 0) {
    const weekly = numOf(own(authored, band));
    return weekly > 0 ? Math.round(weekly) : null;
  }
  const def = own(LIVING_COSTS, band);
  const basket = def ? priceOf(ctx, { catalog: def.basket, place: null }) : null;
  return def && basket ? Math.round(basket.cents * def.times) : null;
}

/** The day of the month a credit account's payment falls due, when it names one. */
function dueDayOf(ctx: ReadContext, account: EntityId): number | null {
  const f = own(ctx.state.entities, account)?.fields;
  return typeof f?.due_day === "number" ? f.due_day : null;
}

/** The flows derived from accounts, people and vehicles (DESIGN §25.5): autopay, living costs, insurance. */
function foundationFlows(ctx: ReadContext): Flow[] {
  const out: Flow[] = [];
  const s = ctx.state;
  for (const [id, e] of Object.entries(s.entities)) {
    if (e.kind !== "account") continue;
    const t = traitsOf(ctx, id);
    if (!t || !(t.revolving || t.installment) || ["closed", "charged_off", "paid_off", "collections"].includes(statusOf(s, id))) continue;
    const mode = strOf(e.fields.autopay, "none");
    if (mode === "none" || mode === "") continue;
    const holder = holdersOf(s, id)[0];
    if (!holder || !own(s.entities, holder)) continue;
    const named = strOf(e.fields.autopay_from);
    const from = named !== "" && own(s.entities, named) ? named : (depositAccount(ctx, holder, id) ?? "");
    if (from === "") continue;
    const level = accountLevel(ctx, id);
    const statements = featureOn(level, "statements", toggles(ctx.world));
    const amount: FlowAmount = mode === "fixed" ? { fixed: Math.round(numOf(e.fields.autopay_cents)) } : t.installment ? { due: "minimum" } : statements ? { due: mode === "minimum" ? "minimum" : mode === "statement" ? "statement" : "balance" } : { due: "balance" };
    let schedule: FlowSchedule;
    // A loan's autopay falls on the day its bill does: its due day, else its product's statement day.
    if (t.installment) schedule = { every: "month", days: [dueDayOf(ctx, id) ?? productOf(ctx, id)?.statement_day ?? 1] };
    else if (statements) {
      const cycle = cycleOf(s, id);
      if (!cycle) continue;
      const cal = calendarOf(ctx.world);
      schedule = { once: clockAt(cal, dateAt(cal, cycle.due).dayIndex, DEFAULT_FLOW_MINUTE) };
    } else schedule = { every: "month", days: [productOf(ctx, id)?.statement_day ?? 1] };
    out.push({ id: `autopay:${id}`, label: `${e.name} autopay`, kind: t.installment ? "loan_payment" : "card_payment", from, to: id, amount, schedule, shortfall: "skip", category: "transfer", link: id, status: "active", source: "autopay" });
  }
  const pov = ctx.world.pov;
  for (const id of Object.keys(s.entities).sort()) {
    const e = own(s.entities, id);
    if (!e || id === pov || isGone(s, id) || !hasLedger(ctx, id) || !isParty(ctx, id) || e.kind === "household") continue;
    // Living costs are a person's everyday spending; businesses and trusts have none.
    if (!featureOn(ctx.levelOf(id, "money"), "living_costs", toggles(ctx.world)) || !kindIs(ctx.registry, ctx.world, e.kind, "person")) continue;
    out.push({ id: `living:${id}`, label: "Living costs", kind: "living", from: id, to: "market", amount: { provider: "economy.living" }, schedule: { every: "week", weekdays: [1] }, shortfall: "partial", category: "living", status: "active", method: "auto", source: "living" });
  }
  const insured = new Set(Object.values(s.entities).filter((e) => e.kind === "flow" && !isGone(s, strOf(e.fields.link)) && e.fields.status !== "ended").map((e) => strOf(e.fields.link)));
  for (const p of optionalQuery(ctx, "vehicles.insurance")?.(ctx) ?? []) {
    if (insured.has(p.vehicle) || p.cents <= 0) continue;
    out.push({ id: `insurance:${p.vehicle}`, label: p.label, kind: "premium", from: p.owner, to: "insurer", amount: { fixed: p.cents }, schedule: { every: "month", days: [1] }, shortfall: "skip", category: "insurance", link: p.vehicle, status: "active", method: "account", source: "vehicle" });
  }
  return out;
}


/** Every flow in force: flow entities, the foundation's derived flows, and every module's. */
export function allFlows(hooks: FinanceHooks, ctx: ReadContext): Flow[] {
  const out: Flow[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const f = flowOfEntity(ctx, id);
    if (f) out.push(f);
  }
  out.push(...foundationFlows(ctx));
  for (const source of hooks.flows) out.push(...source.flows(ctx));
  return out;
}

// ---------------------------------------------------------------- sides and levels

/** Who pays and what pays: an account, a party (paying as their preferences choose), or someone outside. */
type Side = { account: EntityId; party: EntityId | null } | { party: EntityId } | { outside: string };

function sideOf(ctx: ReadContext, id: string): Side {
  const e = own(ctx.state.entities, id);
  if (e?.kind === "account" && classOf(ctx, id)) return { account: id, party: holdersOf(ctx.state, id).find((h) => own(ctx.state.entities, h)) ?? null };
  if (e && isParty(ctx, id)) return { party: id };
  return { outside: id };
}

/** A flow's Money level: its payer's when the payer is in the world, else its payee's. */
export function flowLevel(ctx: ReadContext, flow: Flow): number {
  const level = (side: Side): number | null => ("account" in side ? accountLevel(ctx, side.account) : "party" in side ? ctx.levelOf(side.party, "money") : null);
  return level(sideOf(ctx, flow.from)) ?? level(sideOf(ctx, flow.to)) ?? 0;
}

/** Where a payment to a side lands: an account, a party's deposit account, or outside; and who the payer's journal line names (an id, or the outside name). */
function landing(ctx: ReadContext, to: string, cents: number): { account: string; extra: LedgerEvent[]; counterparty: string } {
  const side = sideOf(ctx, to);
  if ("account" in side) return { account: side.account, extra: [], counterparty: side.party ?? side.account };
  if ("party" in side) {
    const dest = payeeSide(ctx, { payee: side.party }, cents);
    return { ...dest, counterparty: side.party };
  }
  // The outside payee by its name, never its account id: a person's payment names it, and an account's, so both land in one account.
  return { account: outsideAccount(side.outside), extra: [], counterparty: (side.outside.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? side.outside.slice(EXTERNAL_ACCOUNT_PREFIX.length) : side.outside).replace(/_/g, " ") };
}

// ---------------------------------------------------------------- amounts

/** A table cell in minor units: a number, or a band's typical. */
function tableAmount(ctx: ReadContext, table: string, row: string, column: string | undefined): number | null {
  const r = own(ctx.tables.get(table)?.rows ?? {}, row);
  if (!r) return null;
  const v = column ? own(r, column) : (own(r, "price_cents") ?? own(r, "cents"));
  if (typeof v === "number") return v;
  const band = objOf(v);
  return typeof band.typical === "number" ? band.typical : null;
}

/**
 * One occurrence's amount: computed (fixed, formula, table, range, percent, what's due), with
 * anything deferred added; or a module's own posting. Null when there's nothing to pay.
 */
export function occurrenceAmount(hooks: FinanceHooks, ctx: ReadContext, flow: Flow, at: number, rng: Rng, deferred: number): { cents: number; posting?: FlowPosting } | Rejection | null {
  const a = flow.amount;
  // Nothing is due on a loan before its first bill: a loan just taken owes no payment yet.
  if (traitsOf(ctx, flow.to)?.installment && !cycleOf(ctx.state, flow.to)) return null;
  let cents: number | null = null;
  if ("fixed" in a) cents = a.fixed;
  else if ("formula" in a) {
    const self = sideOf(ctx, flow.from);
    const who = "party" in self && self.party ? self.party : ctx.world.pov;
    cents = Math.round(evalNumber(a.formula, scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who } }), 0));
  } else if ("table" in a) {
    const v = tableAmount(ctx, a.table, a.row, a.column);
    cents = v === null ? null : Math.round(v * (a.scale ?? 1));
  } else if ("range" in a) cents = a.range.max > a.range.min ? rng.int(a.range.min, a.range.max) : a.range.min;
  else if ("percent" in a) {
    const side = sideOf(ctx, flow.from);
    const of = a.of ?? ("account" in side ? side.account : "");
    cents = of !== "" ? Math.round((Math.max(0, balance(ctx.state, of)) * a.percent) / 100) : null;
  } else if ("due" in a) {
    const account = flow.to;
    const owed = -balance(ctx.state, account);
    const cycle = cycleOf(ctx.state, account);
    if (owed <= 0) return null;
    if (a.due === "balance") cents = owed;
    else if (!cycle) return null;
    else cents = Math.min(owed, Math.max(0, (a.due === "minimum" ? cycle.minimum : cycle.closing) - cycle.paid));
  } else {
    const provider = own(hooks.amounts, a.provider);
    if (!provider) return reject("no_provider", `nothing works out ${flow.label}`);
    const made = provider(ctx, flow, at, rng);
    // Nothing this time: only what an earlier occurrence deferred falls due.
    if (made === null) return deferred > 0 ? { cents: deferred } : null;
    if ("code" in made) return made;
    // What a module gave only the amount of pays like any flow, so what an earlier one deferred is added; its own posting goes as it gave it.
    if (made.lines?.some((l) => l.amount !== 0)) return { cents: Math.round(made.cents), posting: made };
    return { cents: Math.round(made.cents) + Math.max(0, deferred), posting: made };
  }
  if (cents === null || !Number.isFinite(cents)) return null;
  const total = Math.round(cents) + Math.max(0, deferred);
  // Into credit a payment pays at most what it owes, as a transfer does; a card that owes nothing isn't paid.
  const owes = (flow.splits ?? []).length === 0 && traitsOf(ctx, flow.to)?.liability ? Math.max(0, -balance(ctx.state, flow.to)) : total;
  const due = Math.min(total, owes);
  return due > 0 ? { cents: due } : null;
}

// ---------------------------------------------------------------- paying an occurrence

interface Attempt {
  events: LedgerEvent[];
  paid: number;
}

/** Splits an amount: fixed amounts first, then percentages of the rest; what's left goes to `rest`. */
export function splitAmount(cents: number, splits: readonly FlowSplit[], rest: string): { to: string; cents: number }[] {
  const out: { to: string; cents: number }[] = [];
  let left = cents;
  for (const s of splits) {
    if (typeof s.cents !== "number") continue;
    const c = Math.min(left, Math.max(0, Math.round(s.cents)));
    if (c > 0) out.push({ to: s.to, cents: c });
    left -= c;
  }
  const base = left;
  for (const s of splits) {
    if (typeof s.cents === "number" || typeof s.pct !== "number") continue;
    const c = Math.min(left, Math.max(0, Math.round((base * s.pct) / 100)));
    if (c > 0) out.push({ to: s.to, cents: c });
    left -= c;
  }
  if (left > 0) out.push({ to: rest, cents: left });
  return out;
}

/** Pays one share of an occurrence from a side: an account (within what it has and its overdraft policy), a party as their preferences choose, or from outside. */
function payFrom(hooks: FinanceHooks, ctx: ReadContext, flow: Flow, fromId: string, cents: number, at: number, overdraft: boolean, made?: FlowPosting): Attempt | Rejection {
  const from = sideOf(ctx, fromId);
  const memo = made?.memo ?? flow.label;
  const meta = { kind: made?.kind ?? (flow.kind === "income" || flow.kind === "payroll" || flow.kind === "distribution" || flow.kind === "allowance" ? ("income" as const) : flow.to === flow.from ? ("transfer" as const) : ("payment" as const)), category: made?.category ?? flow.category ?? flow.kind, flow: flow.id, at };
  const targets = splitAmount(cents, flow.splits ?? [], flow.to);
  // A party with no account named: as their preferences choose (a bill pays from an account, never wallet cash).
  if ("party" in from && !("account" in from)) {
    if (targets.length !== 1 || !targets[0]) return reject("bad_flow", `${flow.label} splits a payment that has no account to pay from`);
    const land = landing(ctx, targets[0].to, cents);
    const side = sideOf(ctx, targets[0].to);
    const payee = "party" in side && !("account" in side) ? side.party : undefined;
    const paid = charge(hooks, ctx, from.party, cents, memo, { ...(payee ? { payee } : { counterparty: land.counterparty }), ...("account" in side ? { deposit: side.account, payee: side.party ?? undefined } : {}), method: (flow.method as PayMethod | undefined) ?? "account", kind: meta.kind, category: meta.category, flow: flow.id, at, overdraft });
    return isRejection(paid) ? paid : { events: paid, paid: cents };
  }
  const source = "account" in from ? from.account : outsideAccount(from.outside);
  if ("account" in from) {
    if (statusOf(ctx.state, from.account) !== "open") return reject("declined", `${labelOf(ctx, from.account)} is ${statusOf(ctx.state, from.account).replace(/_/g, " ")}`);
    if (traitsOf(ctx, from.account)?.locked) return reject("locked", `${labelOf(ctx, from.account)} can't be drawn on`);
    const room = availableOf(ctx, from.account) + (overdraft ? overdraftRoom(ctx, from.account) : 0);
    if (accountLevel(ctx, from.account) >= 2 && room < cents) return reject("declined", `${labelOf(ctx, from.account)} can't cover ${formatMoney(cents, ctx.world.currency)}`);
  }
  const lines: PostingLine[] = [{ account: source, amount: -cents }];
  const extra: LedgerEvent[] = [];
  let counterparty = "";
  for (const t of targets) {
    const land = landing(ctx, t.to, t.cents);
    lines.push({ account: land.account, amount: t.cents });
    extra.push(...land.extra);
    counterparty ||= land.counterparty;
    if (traitsOf(ctx, land.account)?.liability) extra.push({ type: FINANCE_EVENTS.cardPaid, data: { account: land.account, cents: t.cents } });
  }
  const merged: PostingLine[] = [];
  for (const l of lines) {
    const same = merged.find((x) => x.account === l.account);
    if (same) same.amount += l.amount;
    else merged.push({ ...l });
  }
  const finalLines = merged.filter((l) => l.amount !== 0);
  if (finalLines.length < 2) return reject("bad_flow", `${flow.label} pays itself`);
  // Into overdraft, the account's own policy applies: the gap from its linked account first, or its overdraft fee after.
  const od = "account" in from && overdraft ? overdraftEvents(ctx, from.account, cents, at) : { before: [], after: [] };
  return { events: asUnit([...od.before, ...posting(finalLines, { memo, ...meta, counterparty }), ...extra, ...od.after]), paid: cents };
}

/** A module's own posting for an occurrence, checked as the fold will check it. */
function providedAttempt(ctx: ReadContext, flow: Flow, made: FlowPosting, at: number): Attempt | Rejection {
  const lines = (made.lines ?? []).filter((l) => l.amount !== 0);
  if (lines.length === 0) return { events: made.extra ?? [], paid: 0 };
  if (lines.reduce((a, l) => a + l.amount, 0) !== 0) return reject("unbalanced", `${flow.label} doesn't balance`);
  for (const l of lines) {
    if (l.amount >= 0 || !own(ctx.state.entities, l.account)) continue;
    if (statusOf(ctx.state, l.account) !== "open") return reject("declined", `${labelOf(ctx, l.account)} is ${statusOf(ctx.state, l.account)}`);
    if (accountLevel(ctx, l.account) >= 2 && availableOf(ctx, l.account) + overdraftRoom(ctx, l.account) + l.amount < 0) return reject("declined", `${labelOf(ctx, l.account)} can't cover ${formatMoney(-l.amount, ctx.world.currency)}`);
  }
  const memo = made.memo ?? flow.label;
  const card: LedgerEvent[] = lines.filter((l) => l.amount > 0 && traitsOf(ctx, l.account)?.liability).map((l) => ({ type: FINANCE_EVENTS.cardPaid, data: { account: l.account, cents: l.amount } }));
  return { events: asUnit([...posting(lines, { memo, kind: made.kind ?? "payment", category: made.category ?? flow.category ?? flow.kind, flow: flow.id, at }), ...card, ...(made.extra ?? [])]), paid: made.cents };
}

/** The party a flow's notes are about: its payer's holder, else its payee. */
function noteParty(ctx: ReadContext, flow: Flow): EntityId | null {
  for (const id of [flow.from, flow.to]) {
    const side = sideOf(ctx, id);
    if ("account" in side && side.party) return side.party;
    if ("party" in side && !("account" in side)) return side.party;
  }
  return null;
}

function runEvent(flow: Flow, at: number, outcome: FlowOutcome, cents: number, next: FlowRunState, short = 0): LedgerEvent {
  const state: JsonObject = { done: next.done, missed: next.missed, last: at };
  if (next.retry) state.retry = { at: next.retry.at, left: next.retry.left, cents: next.retry.cents };
  if (next.deferred && next.deferred > 0) state.deferred = next.deferred;
  if (next.ended) state.ended = true;
  return { type: FINANCE_EVENTS.flowRun, data: { flow: flow.id, label: flow.label, at, outcome, cents, ...(short > 0 ? { short } : {}), state } };
}

/**
 * One occurrence of a flow (or a retry of one): what it pays, and what its shortfall policy does
 * when the money isn't there. Every outcome records the flow's run; the payer hears of a decline.
 */
export function runOccurrence(hooks: FinanceHooks, run: Run, flow: Flow, at: number, rng: Rng, retry: boolean): void {
  const ctx = run.ctx;
  const before = flowRunOf(ctx.state, flow.id);
  if (before.ended) return;
  const amount = retry && before.retry ? { cents: before.retry.cents } : occurrenceAmount(hooks, ctx, flow, at, rng, before.deferred ?? 0);
  const ended = (done: number, missed: number): boolean => (flow.count !== undefined && done + missed >= flow.count) || false;
  const who = noteParty(ctx, flow);
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  if (amount === null) return;
  if ("code" in amount) {
    // The module couldn't work the amount out: nothing moves, it counts as missed, and what was carried still waits.
    const next: FlowRunState = { done: before.done, missed: before.missed + 1, ...(before.deferred ? { deferred: before.deferred } : {}), ended: ended(before.done, before.missed + 1) };
    run.emit([runEvent(flow, at, "declined", 0, next)]);
    return;
  }
  const cents = amount.cents;
  const overdraft = flow.shortfall === "overdraft" || flow.shortfall === "skip" || flow.shortfall === "retry" || flow.shortfall === "defer" || flow.shortfall === "fallback" || flow.shortfall === "partial";
  // A module's own posting goes as it gave it; a module that gave only the amount pays like any flow, with its bookkeeping in the same unit.
  const own_lines = amount.posting?.lines?.some((l) => l.amount !== 0) === true;
  const extra = amount.posting && !own_lines ? (amount.posting.extra ?? []) : [];
  // Shares split a flow where household shares run; elsewhere its payer pays it whole.
  const shared = (flow.shares ?? []).length > 0 && featureOn(flowLevel(ctx, flow), "households", toggles(ctx.world));
  const computed = (c: number): Attempt | Rejection => {
    if (c <= 0) return { events: extra, paid: 0 };
    const made = shared ? sharedAttempt(hooks, ctx, flow, c, at) : payFrom(hooks, ctx, flow, flow.from, c, at, overdraft, amount.posting);
    return "code" in made || extra.length === 0 ? made : { events: asUnit([...made.events.map(({ group: _g, ...e }) => e as LedgerEvent), ...extra]), paid: made.paid };
  };
  const attempt = amount.posting && own_lines ? providedAttempt(ctx, flow, amount.posting, at) : computed(cents);
  if (!("code" in attempt)) {
    const applied = run.emit(attempt.events);
    if (applied.length > 0 || attempt.events.length === 0) {
      // A module's own posting can't take what was carried; it waits for an occurrence that can.
      const next: FlowRunState = { done: before.done + 1, missed: before.missed, ...(own_lines && before.deferred ? { deferred: before.deferred } : {}), ended: ended(before.done + 1, before.missed) };
      run.emit([runEvent(flow, at, "paid", attempt.paid, next)]);
      if (who && flow.kind !== "living" && amount.posting?.quiet !== true && attempt.paid > 0) run.emit([signal("bill", `${flow.label}: ${money(attempt.paid)} ${flowIsIncome(ctx, flow, who) ? "received" : "paid"}.`, who, at)]);
      return;
    }
  }
  const reason = "code" in attempt ? attempt.reason : "the payment didn't go through";
  const nsf = bounceFee(ctx, flow, at);
  switch (flow.shortfall) {
    case "partial": {
      const side = sideOf(ctx, flow.from);
      const have = "account" in side ? Math.max(0, availableOf(ctx, side.account)) : "party" in side ? partyHas(ctx, side.party) : 0;
      const part = Math.min(have, cents - 1);
      const paid = part > 0 && !own_lines ? computed(part) : null;
      if (paid && !("code" in paid) && run.emit(paid.events).length > 0) {
        const next: FlowRunState = { done: before.done + 1, missed: before.missed, ended: ended(before.done + 1, before.missed) };
        run.emit([runEvent(flow, at, "partial", part, next, cents - part)]);
        if (who) run.emit([signal("decline", `${flow.label}: only ${money(part)} of ${money(cents)} paid.`, who, at)]);
        return;
      }
      break;
    }
    case "retry": {
      const left = retry && before.retry ? before.retry.left : Math.max(0, Math.round(flow.retries ?? 2));
      if (left > 0) {
        const next: FlowRunState = { done: before.done, missed: before.missed, retry: { at: at + Math.max(1, Math.round(flow.retry_days ?? 3)) * 1440, left: left - 1, cents }, ...(before.deferred ? { deferred: 0 } : {}) };
        run.emit([...nsf, runEvent(flow, at, "retry", 0, next, cents)]);
        if (who) run.emit([signal("decline", `${flow.label} (${money(cents)}) didn't go through; it will be tried again.`, who, at)]);
        return;
      }
      break;
    }
    case "fallback": {
      const fallback = fallbackOf(ctx, flow);
      if (fallback && !own_lines) {
        const paid = payFrom(hooks, ctx, flow, fallback, cents, at, true, amount.posting);
        if (!("code" in paid) && run.emit(paid.events).length > 0) {
          const next: FlowRunState = { done: before.done + 1, missed: before.missed, ended: ended(before.done + 1, before.missed) };
          run.emit([runEvent(flow, at, "fallback", cents, next)]);
          if (who) run.emit([signal("bill", `${flow.label}: ${money(cents)} paid from ${labelOf(ctx, fallback)}.`, who, at)]);
          return;
        }
      }
      break;
    }
    case "defer": {
      const next: FlowRunState = { done: before.done, missed: before.missed + 1, deferred: cents + (own_lines ? (before.deferred ?? 0) : 0), ended: ended(before.done, before.missed + 1) };
      run.emit([runEvent(flow, at, "deferred", 0, next, cents)]);
      if (who) run.emit([signal("decline", `${flow.label} (${money(cents)}) couldn't be paid; it carries to next time.`, who, at)]);
      return;
    }
    default:
      break;
  }
  const next: FlowRunState = { done: before.done, missed: before.missed + 1, ended: ended(before.done, before.missed + 1) };
  run.emit([...nsf, runEvent(flow, at, flow.shortfall === "skip" ? "skipped" : "declined", 0, next, cents)]);
  if (who) run.emit([signal("decline", `${flow.label} (${money(cents)}) was declined: ${reason}.`, who, at)]);
}

/** Whether a flow brings money to `who` rather than taking it. */
function flowIsIncome(ctx: ReadContext, flow: Flow, who: EntityId): boolean {
  const from = sideOf(ctx, flow.from);
  return !(("account" in from && from.party === who) || ("party" in from && !("account" in from) && from.party === who));
}

/**
 * The account (or party) a flow falls back on, when it's the payer's own: the payer itself, or an
 * account one of the payer's holders may spend from. An outside name or someone else's account is
 * never drawn on, so a fallback can't pay with money nobody has.
 */
function fallbackOf(ctx: ReadContext, flow: Flow): string | null {
  const fallback = flow.fallback;
  if (!fallback) return null;
  const from = sideOf(ctx, flow.from);
  const payers = "account" in from ? holdersOf(ctx.state, from.account).filter((h) => canSpend(ctx.state, from.account, h)) : "party" in from ? [from.party] : [];
  if (payers.includes(fallback)) return fallback;
  return own(ctx.state.entities, fallback)?.kind === "account" && payers.some((p) => canSpend(ctx.state, fallback, p)) ? fallback : null;
}

/** What a party has to pay with now: their spendable accounts' availability. */
function partyHas(ctx: ReadContext, party: EntityId): number {
  return accountsOf(ctx, party, "spend").reduce((a, id) => a + (traitsOf(ctx, id)?.asset && !traitsOf(ctx, id)?.locked ? Math.max(0, availableOf(ctx, id)) : 0), 0);
}

/** A bounced payment's returned-item fee, where fees run, from a transactional account whose policy declined it. */
function bounceFee(ctx: ReadContext, flow: Flow, at: number): LedgerEvent[] {
  const side = sideOf(ctx, flow.from);
  if (!("account" in side) || !traitsOf(ctx, side.account)?.transactional || !featureOn(accountLevel(ctx, side.account), "fees", toggles(ctx.world))) return [];
  const p = productOf(ctx, side.account);
  if (!p || p.fees.nsf <= 0) return [];
  const lines: PostingLine[] = [
    { account: side.account, amount: -p.fees.nsf },
    { account: `economy.external:bank:${p.institution || "bank"}`, amount: p.fees.nsf },
  ];
  return asUnit(posting(lines, { memo: "Returned payment fee", kind: "fee", category: "nsf", flow: flow.id, at }));
}

/**
 * A shared flow (a household's rent): each party pays its share, from its own means; all or none.
 * Each share is checked against the books the shares before it leave, so two shares from one
 * account can't both spend what covers one, and they go as one unit.
 */
function sharedAttempt(hooks: FinanceHooks, ctx: ReadContext, flow: Flow, cents: number, at: number): Attempt | Rejection {
  const shares = flow.shares ?? [];
  const total = shares.reduce((a, s) => a + Math.max(0, s.pct), 0);
  if (total <= 0) return reject("bad_flow", `${flow.label} has no shares`);
  const trial = new Run(ctx);
  const events: LedgerEvent[] = [];
  let left = cents;
  for (const [i, s] of shares.entries()) {
    const part = i === shares.length - 1 ? left : Math.round((cents * s.pct) / total);
    left -= part;
    if (part <= 0) continue;
    const share: Flow = { ...flow, from: s.from ?? s.party, label: flow.label };
    const paid = payFrom(hooks, trial.ctx, share, s.from ?? s.party, part, at, true);
    if ("code" in paid) return reject("declined", `${labelOf(ctx, s.party)}'s share: ${paid.reason}`);
    if (trial.emit(asUnit(paid.events)).length === 0) return reject("declined", `${labelOf(ctx, s.party)}'s share can't be covered`);
    events.push(...paid.events);
  }
  return { events: asUnit(events), paid: cents };
}

/** What a payer side would choose to pay a flow from, for views (null when it can't say). */
export function payingAccount(ctx: ReadContext, flow: Flow, cents: number): EntityId | null {
  const side = sideOf(ctx, flow.from);
  if ("account" in side) return side.account;
  if ("party" in side) {
    const picked = chooseSource(ctx, side.party, Math.max(1, cents), { method: (flow.method as PayMethod | undefined) ?? "account", till: false, overdraft: true });
    return "code" in picked ? null : picked.account;
  }
  return null;
}
