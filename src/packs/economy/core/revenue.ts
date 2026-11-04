// Revenue streams (DESIGN §26.2, Revenue streams; §27.9, Valued from income). A stream is a `flow`
// entity whose `revenue` model works out each occurrence (shared/revenue.ts): a product or a
// catalog sells, booked as a business's walk-in takings are, with sales tax by each line's tax
// category and the cost of goods by its margin; a royalty pays a share of a production month at its
// price, its severance tax and deductions going out of the same account in the same unit; fees and
// custom streams post their own categories. Each occurrence is worked out at its own instant, with
// `self` the earner, and recorded by stream and month (`economy.revenue`, the last 25 months), with
// a royalty's production by the property it comes from (`produced`, for cost depletion).
//
// The agents may adjust a stream whose author opened it to them (`ai: bounded`), within bounds
// (`economy.revenue_adjust`): a GM op, or what the story says, which asks first. A property with a
// `valuation` (a mineral interest by default) is worth what its streams are projected to pay.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import type { Flow } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import {
  REVENUE_ADJUST,
  REVENUE_CATEGORIES,
  REVENUE_MONTHS_KEPT,
  REVENUE_PROVIDER,
  VALUATION_DEFAULTS,
  driversAmount,
  growthAt,
  revenueOf,
  revenueProblems,
  royaltyMonth,
  royaltyPriceAt,
  seasonAt,
  valuationOf,
  valueFromIncome,
  weekdayAt,
  type Driver,
  type RevenueAdjustmentView,
  type RevenueModel,
  type RevenueMonth,
  type RevenueStreamView,
  type RoyaltyMonth,
} from "../../../shared/revenue";
import { formatMoney, type FieldDef, type WorldDoc } from "../../../shared/world";
import { calendarOf, clockAt, clockOfLocal, dateAt, dayIndexOf, type Calendar } from "../../../engine/calendar";
import { createEnv, evalNumber, type EnvVars } from "../../../engine/expr";
import { placesOf } from "../../../engine/org";
import { labelOf, numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs, scopeEnv } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { dateText, quoteOf } from "./assets";
import { monthOf, operatingAccount } from "./books";
import { isBusiness } from "./business";
import { flowOfEntity, occurrences } from "./flows";
import { incomeFor } from "./income";
import { holdersOf, outsideAccount, unpricedCap } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { posting } from "./pay";
import { salesTaxOn, salesTaxPct, taxExempt } from "./taxes";

export const REVENUE_EVENT = "economy.revenue";
export const ADJUST_EFFECT = "economy.revenue_adjust";
const ADJUSTED_EVENT = "economy.revenue_adjusted";
/** The proposal type the story's adjustment is noted as (`revenue_note`), which asks first. */
export const REVENUE_FACT = "revenue";

/** Who a royalty's severance tax and deductions are paid to, outside the world. */
const SEVERANCE_PAYEE = "Severance tax";
const DEDUCTIONS_PAYEE = "Post-production costs";

const MINUTES_A_YEAR = 365 * 1440;

const FLOW_FIELDS: Record<string, FieldDef> = {
  revenue: { type: "list", label: "Revenue model ({type, …}, one record: units × price × buyers, a catalog, a royalty, fees or a formula)", domain: "money", level: 3 },
};

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

// ---------------------------------------------------------------- reading streams

/** Every flow entity whose `revenue` holds a model, by id. */
export function streamIds(state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.kind === "flow" && !isGone(state, id) && revenueOf(own(state.entities, id)?.fields.revenue) !== null)
    .sort();
}

/** A stream: its flow and its model. */
export interface Stream {
  flow: Flow;
  model: RevenueModel;
}

export function streamOf(ctx: Pick<ReadContext, "state">, id: EntityId): Stream | null {
  const model = revenueOf(own(ctx.state.entities, id)?.fields.revenue);
  const flow = model ? flowOfEntity(ctx, id) : null;
  return flow && model ? { flow, model } : null;
}

/** Where money paid to `to` lands, and whose it is there: an account and its holder, a party's operating or deposit account, or outside. Null: a party with no account to take it. */
function landAt(api: FinanceApi, ctx: ReadContext, to: string): { account: string; party: EntityId | null } | null {
  const e = own(ctx.state.entities, to);
  if (e && api.classOf(ctx, to)) return { account: to, party: holdersOf(ctx.state, to).find((h) => own(ctx.state.entities, h)) ?? null };
  if (e && !isGone(ctx.state, to)) {
    const account = isBusiness(ctx, to) ? operatingAccount(api, ctx, to) : api.depositAccount(ctx, to);
    return account ? { account, party: to } : null;
  }
  return { account: outsideAccount(to), party: null };
}

/** The party a stream earns for: the holder of the account its `to` lands in. */
export function earnerOf(api: FinanceApi, ctx: ReadContext, flow: Pick<Flow, "to">): EntityId | null {
  return landAt(api, ctx, flow.to)?.party ?? null;
}

// ---------------------------------------------------------------- working an occurrence out

/** What a stream's model reads besides itself: its formulas, an asset's price and a season table, in play or in a preview of the world alone. */
export interface StreamReader {
  world: WorldDoc;
  formula(src: string, at: number, vars: EnvVars): number;
  assetPrice(asset: string, at: number): number | null;
  rows(table: string): JsonObject | undefined;
}

/** The engine's reading: formulas in the full scope at the occurrence's instant, with `self` the earner; assets at their market price then. */
export function engineReader(ctx: ReadContext, earner: EntityId): StreamReader {
  return {
    world: ctx.world,
    formula: (src, at, vars) => evalNumber(src.replace(/^=/, ""), scopeEnv({ reg: ctx.registry, ctx, bindings: { self: earner }, vars, at }), 0),
    assetPrice: (asset, at) => quoteOf(ctx, asset, at),
    rows: (table) => (ctx.tables.get(table)?.rows as JsonObject | undefined) ?? objOf(own(ctx.world.tables, table)?.rows),
  };
}

/** The clock names a formula reads at an instant, as the engine's scope gives them. */
function clockVars(cal: Calendar, at: number): EnvVars {
  const d = dateAt(cal, at);
  return { clock: at, minute: d.minuteOfDay, hour: Math.floor(d.minuteOfDay / 60), day: d.dayIndex, weekday: d.weekday, date: d.day, month: d.month, year: d.year };
}

/**
 * A preview's reading of the world alone (Build's editor): formulas see the clock names and the
 * stream's own (`season`, `growth`, `weekday_factor`, `t`) but nothing in play, and an asset reads its
 * authored price.
 */
export function previewReader(world: WorldDoc): StreamReader {
  const cal = calendarOf(world);
  return {
    world,
    formula: (src, at, vars) => evalNumber(src.replace(/^=/, ""), createEnv({ ...clockVars(cal, at), ...vars }), 0),
    assetPrice: (asset) => {
      const price = objOf(own(objOf(world.packs.economy?.config.assets), asset)).price;
      return typeof price === "number" && Number.isFinite(price) ? price : null;
    },
    rows: (table) => objOf(own(world.tables, table)?.rows),
  };
}

/** A month counted from the calendar's year zero, so two instants' months subtract. */
function monthNumber(cal: Calendar, clock: number): number {
  const d = dateAt(cal, clock);
  return d.year * cal.system.months + d.month - 1;
}

/** Midnight on the 1st of the month after the one holding `clock`. */
function nextMonthStart(cal: Calendar, clock: number): number {
  const d = dateAt(cal, clock);
  const last = d.month >= cal.system.months;
  return clockAt(cal, dayIndexOf(cal, last ? d.year + 1 : d.year, last ? 1 : d.month + 1, 1), 0);
}

/** When a stream started: its `start` (midnight that day, `dated`), else the world's start. */
function startOf(world: WorldDoc, flow: Pick<Flow, "start">): { at: number; dated: boolean } {
  const cal = calendarOf(world);
  for (const [text, dated] of [[flow.start ? `${flow.start.slice(0, 10)}T00:00` : "", true], [world.start.at, false]] as const) {
    if (text === "") continue;
    try {
      return { at: clockOfLocal(cal, text), dated };
    } catch {
      // an unreadable date: try the next
    }
  }
  return { at: 0, dated: false };
}

/** A model's twelve season factors: its own, or its table's rows `1`…`12`. */
function seasonOf(rd: StreamReader, model: Pick<RevenueModel, "season">): number[] | undefined {
  if (typeof model.season !== "string") return model.season;
  const rows = rd.rows(model.season);
  return rows ? Array.from({ length: 12 }, (_, i) => numOf(objOf(own(rows, String(i + 1))).factor, 1)) : undefined;
}

/** One line a product or catalog occurrence sells, before sales tax. */
interface SoldLine {
  cents: number;
  margin: number | null;
  category: string | null;
}

/** What an occurrence earns, before sales tax: its amount, the units sold or produced, the lines sold, and a royalty's month. */
export interface Earned {
  cents: number;
  units: number;
  lines: SoldLine[];
  royalty: RoyaltyMonth | null;
}

/**
 * What a stream's model earns at one occurrence `at`, times `factor` (its spread and adjustments)
 * and with `add` minor units on its first line (or a royalty's gross). Null when there is nothing to
 * earn yet: a royalty whose production month falls before the stream started.
 */
export function earnedAt(rd: StreamReader, flow: Pick<Flow, "start">, model: RevenueModel, at: number, factor = 1, add = 0): Earned | null {
  const cal = calendarOf(rd.world);
  const d = dateAt(cal, at);
  const start = startOf(rd.world, flow);
  const t = monthNumber(cal, at) - monthNumber(cal, start.at);
  const vars = { season: seasonAt(seasonOf(rd, model), d.month), weekday_factor: weekdayAt(model.weekdays, d.weekday), growth: growthAt(model.growth_pct, (at - start.at) / MINUTES_A_YEAR), t };
  // A formula that doesn't come to a number (a division by nothing, a name it lacks) counts as its fallback.
  const formula = (src: string, fallback: number): number => {
    const n = rd.formula(src, at, vars);
    return Number.isFinite(n) ? n : fallback;
  };
  const driver = (v: Driver | number[] | { asset: string } | undefined, fallback: number): number => (typeof v === "number" ? v : typeof v === "string" ? formula(v, fallback) : fallback);
  const shaped = vars.weekday_factor * vars.growth * factor;
  switch (model.type) {
    case "royalty": {
      const month = t - (model.lag_months ?? 0);
      if (month < 0) return null;
      // The month a dated stream started in counts only the days from its start.
      const first = dateAt(cal, start.at);
      const length = cal.system.monthLength(first.year, first.month);
      const fraction = month === 0 && start.dated ? (length - first.day + 1) / length : 1;
      const asset = typeof model.price === "object" && !Array.isArray(model.price) ? model.price.asset : null;
      const price = royaltyPriceAt(model.price, month) ?? (asset ? rd.assetPrice(asset, at) : null) ?? 0;
      const base = royaltyMonth(model, month, fraction * factor, price);
      const gross = Math.max(0, base.gross + add);
      const deductions = Math.round((gross * (model.deductions_pct ?? 0)) / 100);
      const severance = Math.round((gross * (model.severance_pct ?? 0)) / 100);
      return { cents: gross, units: base.units, lines: [], royalty: { units: base.units, gross, deductions, severance, net: gross - deductions - severance } };
    }
    case "catalog": {
      const buyers = driver(model.buyers, 1);
      let units = 0;
      const lines = (model.items ?? []).map((item, i): SoldLine => {
        const each = driver(item.units, 1);
        const factorOf = (item.season ? seasonAt(item.season, d.month) : vars.season) * shaped;
        units += each * buyers * factorOf;
        return { cents: Math.max(0, driversAmount(each, driver(item.price, 0), buyers, factorOf) + (i === 0 ? add : 0)), margin: item.margin_pct ?? model.margin_pct ?? null, category: item.category ?? null };
      });
      return { cents: lines.reduce((a, l) => a + l.cents, 0), units, lines, royalty: null };
    }
    case "custom": {
      const cents = Math.max(0, Math.round(formula(model.formula ?? "0", 0) * factor) + add);
      return { cents, units: 0, lines: [], royalty: null };
    }
    case "product":
    case "fees": {
      const units = driver(model.units, 1);
      const buyers = driver(model.buyers, 1);
      const cents = Math.max(0, driversAmount(units, driver(model.price, 0), buyers, vars.season * shaped) + add);
      return { cents, units: units * buyers * vars.season * shaped, lines: model.type === "product" ? [{ cents, margin: model.margin_pct ?? null, category: model.category ?? null }] : [], royalty: null };
    }
  }
}

/** A stream's month, worked out ahead: what it earns, what reaches the earner, and the units. */
export interface ProjectedMonth {
  month: string;
  cents: number;
  net: number;
  units: number;
}

/**
 * A stream's next `count` months as its model works them out, the first the rest of the month
 * holding `from` (its occurrences after `from`): the deterministic preview Build's editor and a
 * party's view show, and the income a property is valued from. No spread and no adjustment: the
 * model alone. A royalty pays once a month, so a month `paid` already counts nothing more.
 */
export function streamMonths(rd: StreamReader, stream: Stream, from: number, count: number, paid: (month: string) => boolean = () => false): ProjectedMonth[] {
  const cal = calendarOf(rd.world);
  const { flow, model } = stream;
  const out: ProjectedMonth[] = [];
  let lo = from;
  for (let i = 0; i < count; i++) {
    // Each window is (lo, hi − 1]: `lo` a minute before the month it opens (or `from` itself), so an occurrence at midnight on the 1st falls in its own month.
    const hi = nextMonthStart(cal, lo + 1);
    const month = monthOf(rd.world, lo + 1);
    const row: ProjectedMonth = { month, cents: 0, net: 0, units: 0 };
    if (flow.status === "active") {
      let royaltyPaid = model.type === "royalty" && paid(month);
      for (const o of occurrences({ world: rd.world }, flow.schedule, lo, hi - 1, flow.start, flow.end)) {
        if (royaltyPaid) break;
        const e = earnedAt(rd, flow, model, o.at);
        if (!e) continue;
        row.cents += e.cents;
        row.net += e.royalty ? e.royalty.net : e.cents;
        row.units += e.units;
        if (model.type === "royalty") royaltyPaid = true;
      }
    }
    out.push(row);
    lo = hi - 1;
  }
  return out;
}

/**
 * A stream's first twelve months as Build's editor previews them, from the world's start, before
 * it is in any chat: the stream's id, name and fields as the draft holds them, read as a flow entity.
 */
export function draftPreview(world: WorldDoc, draft: { id: string; name: string; fields: JsonObject }): { month: string; cents: number }[] {
  const model = revenueOf(draft.fields.revenue);
  const state = { entities: { [draft.id]: { id: draft.id, kind: "flow", name: draft.name, tier: "background", fields: draft.fields, relations: [] } } } as unknown as WorldState;
  const flow = model ? flowOfEntity({ state }, draft.id) : null;
  if (!flow || !model) return [];
  try {
    const from = clockOfLocal(calendarOf(world), world.start.at);
    return streamMonths(previewReader(world), { flow, model }, from, 12).map((m) => ({ month: m.month, cents: m.cents }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- the record

/** A stream's recorded months, oldest first (at most 25). */
export function streamRecord(state: Readonly<WorldState>, stream: EntityId): RevenueMonth[] {
  const months = objOf(own(objOf(sliceOf(state, "economy").revenue), stream));
  return Object.keys(months)
    .sort()
    .map((month) => {
      const m = objOf(own(months, month));
      return { month, cents: numOf(m.cents), net: numOf(m.net), units: numOf(m.units), occurrences: numOf(m.occurrences) };
    });
}

function monthRecord(state: Readonly<WorldState>, stream: EntityId, month: string): { occurrences: number; extra: number } {
  const m = objOf(own(objOf(own(objOf(sliceOf(state, "economy").revenue), stream)), month));
  return { occurrences: numOf(m.occurrences), extra: numOf(m.extra) };
}

/** Units a property's royalty streams produced in a month (`YYYY-MM`): what cost depletion counts. */
export function producedIn(state: Readonly<WorldState>, property: EntityId, month: string): number {
  return numOf(own(objOf(own(objOf(sliceOf(state, "economy").produced), property)), month));
}

/** The newest `REVENUE_MONTHS_KEPT` months of a record keyed by month. */
function kept(months: JsonObject): JsonObject {
  const keys = Object.keys(months).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - REVENUE_MONTHS_KEPT))) delete months[old];
  return months;
}

/** Units kept to the thousandth, so a record's sums stay readable. */
function unitsOf(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** `economy.revenue`: one occurrence of a stream, recorded by month; a royalty's production also by the property it comes from. */
const RECORD: EventTypeDef<PackEvent> = {
  type: REVENUE_EVENT,
  validate: (e) => (typeof e.data.stream === "string" && e.data.stream !== "" && typeof e.data.month === "string" && /^\d{4}-\d{2}$/.test(e.data.month) ? null : reject("bad_event", "a stream's record needs its stream and month")),
  apply: (e, state) => {
    const stream = strOf(e.data.stream);
    const month = strOf(e.data.month);
    const all = sliceRecord(state, "economy", "revenue");
    const months: JsonObject = { ...objOf(own(all, stream)) };
    const cur = objOf(own(months, month));
    const extra = numOf(cur.extra) + numOf(e.data.extra);
    months[month] = { cents: numOf(cur.cents) + numOf(e.data.cents), net: numOf(cur.net) + numOf(e.data.net), units: unitsOf(numOf(cur.units) + numOf(e.data.units)), occurrences: numOf(cur.occurrences) + 1, ...(extra > 0 ? { extra } : {}) };
    all[stream] = kept(months);
    const property = strOf(e.data.property);
    if (property === "" || !(numOf(e.data.units) > 0)) return;
    const produced = sliceRecord(state, "economy", "produced");
    const byMonth: JsonObject = { ...objOf(own(produced, property)) };
    byMonth[month] = unitsOf(numOf(own(byMonth, month)) + numOf(e.data.units));
    produced[property] = kept(byMonth);
  },
  // The record is the GM's line; the player reads the posting.
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, strOf(e.data.stream))}: ${formatMoney(Math.round(numOf(e.data.cents)), ctx.world.currency)} earned`),
};

// ---------------------------------------------------------------- adjustments

/** An adjustment as the record keeps it. */
interface Adjustment extends RevenueAdjustmentView {
  by?: string;
  story?: boolean;
}

function adjustmentsOf(state: Readonly<WorldState>, stream: EntityId): Adjustment[] {
  const list = own(objOf(sliceOf(state, "economy").revenue_adj), stream);
  if (!Array.isArray(list)) return [];
  return list.flatMap((v): Adjustment[] => {
    const o = objOf(v);
    const from = numOf(o.from, NaN);
    const until = numOf(o.until, NaN);
    if (!Number.isFinite(from) || !Number.isFinite(until)) return [];
    return [{ id: strOf(o.id), from, until, reason: strOf(o.reason), ...(typeof o.factor === "number" ? { factor: o.factor } : {}), ...(typeof o.cents === "number" ? { cents: o.cents } : {}), ...(o.by ? { by: strOf(o.by) } : {}), ...(o.story === true ? { story: true } : {}) }];
  });
}

/** The adjustments in force on a stream at an instant. */
function inForce(state: Readonly<WorldState>, stream: EntityId, at: number): Adjustment[] {
  return adjustmentsOf(state, stream).filter((a) => a.from <= at && at < a.until);
}

/** What one occurrence of a stream earns before any adjustment: its next, within two months. */
function periodAmount(api: FinanceApi, ctx: ReadContext, stream: Stream): number {
  const earner = earnerOf(api, ctx, stream.flow);
  if (!earner) return 0;
  const next = occurrences(ctx, stream.flow.schedule, ctx.state.clock, ctx.state.clock + 62 * 1440, stream.flow.start, stream.flow.end)[0];
  return next ? (earnedAt(engineReader(ctx, earner), stream.flow, stream.model, next.at)?.cents ?? 0) : 0;
}

/** An adjustment's arguments as an effect, a GM op or the story gives them. */
export interface AdjustArgs {
  stream: EntityId;
  factor?: number;
  cents?: number;
  days?: number;
  reason: string;
}

/** Why an adjustment can't be made now (null: it can), in the bounds' words. */
export function adjustRefusal(api: FinanceApi, ctx: ReadContext, a: AdjustArgs): Rejection | null {
  const stream = streamOf(ctx, a.stream);
  if (!stream) return reject("no_stream", `${a.stream || "That"} isn't a revenue stream`);
  const name = labelOf(ctx, a.stream);
  if (stream.model.ai !== "bounded") return reject("not_open", `${name} isn't open to adjustment in play: its author left the agents off it`);
  if ((a.factor === undefined) === (a.cents === undefined)) return reject("bad_amount", "an adjustment is either a factor or an amount, one of them");
  if (a.factor !== undefined && !(a.factor >= REVENUE_ADJUST.factorMin && a.factor <= REVENUE_ADJUST.factorMax)) return reject("out_of_bounds", `a factor is between ${REVENUE_ADJUST.factorMin} and ${REVENUE_ADJUST.factorMax}`);
  if (a.cents !== undefined) {
    const period = periodAmount(api, ctx, stream);
    if (!Number.isInteger(a.cents) || a.cents === 0 || Math.abs(a.cents) > period) return reject("out_of_bounds", `an amount is at most one period's, ${formatMoney(period, ctx.world.currency)}, in or out`);
  }
  const days = a.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > REVENUE_ADJUST.days) return reject("out_of_bounds", `an adjustment lasts 1 to ${REVENUE_ADJUST.days} days`);
  if (inForce(ctx.state, a.stream, ctx.state.clock).length >= REVENUE_ADJUST.inForce) return reject("too_many", `${name} has ${REVENUE_ADJUST.inForce} adjustments in force already`);
  if (a.reason.trim() === "") return reject("no_reason", "an adjustment says why: the GM's reason, or what the story said");
  return null;
}

function adjustArgs(a: Record<string, JsonValue>): AdjustArgs {
  const n = (k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
  const factor = n("factor");
  const cents = n("cents");
  const days = n("days");
  return { stream: strOf(a.stream), reason: strOf(a.reason, strOf(a.said)).slice(0, 300), ...(factor !== undefined ? { factor } : {}), ...(cents !== undefined ? { cents } : {}), ...(days !== undefined ? { days } : {}) };
}

/** `economy.revenue_adjusted`: an adjustment in force from `from` to `until`, kept beside those still to end. */
const ADJUSTED: EventTypeDef<PackEvent> = {
  type: ADJUSTED_EVENT,
  validate: (e, ctx) => {
    const stream = strOf(e.data.stream);
    if (revenueOf(own(ctx.state.entities, stream)?.fields.revenue)?.ai !== "bounded") return reject("not_open", "that stream isn't open to adjustment in play");
    const from = numOf(e.data.from, NaN);
    const until = numOf(e.data.until, NaN);
    if (!(until > from) || until - from > REVENUE_ADJUST.days * 1440) return reject("out_of_bounds", `an adjustment lasts 1 to ${REVENUE_ADJUST.days} days`);
    if (inForce(ctx.state, stream, from).length >= REVENUE_ADJUST.inForce) return reject("too_many", `a stream has at most ${REVENUE_ADJUST.inForce} adjustments in force`);
    return null;
  },
  apply: (e, state) => {
    const stream = strOf(e.data.stream);
    const all = sliceRecord(state, "economy", "revenue_adj");
    const live = adjustmentsOf(state, stream).filter((a) => a.until > state.clock);
    all[stream] = [...live, { ...e.data }] as unknown as JsonValue;
  },
  describe: (e, ctx) => `${labelOf(ctx, strOf(e.data.stream))}: ${typeof e.data.factor === "number" ? `×${e.data.factor} a payment` : `${formatMoney(numOf(e.data.cents), ctx.world.currency)} on each payment`} until ${dateText(ctx.world, numOf(e.data.until))}${e.data.reason ? ` (${strOf(e.data.reason)})` : ""}`,
};

// ---------------------------------------------------------------- posting an occurrence

/** The account a stream's money comes from: an account in the world, a party's, or the outside payer it names. */
function payerAccount(api: FinanceApi, ctx: ReadContext, from: string): string {
  const e = own(ctx.state.entities, from);
  if (e && api.classOf(ctx, from)) return from;
  if (e && !isGone(ctx.state, from)) return (isBusiness(ctx, from) ? operatingAccount(api, ctx, from) : api.depositAccount(ctx, from)) ?? outsideAccount(from);
  return outsideAccount(from);
}

/** The property a stream's production is counted against: its `link`, when that is a property. */
function linkedProperty(ctx: ReadContext, flow: Flow): EntityId | null {
  const e = flow.link ? own(ctx.state.entities, flow.link) : undefined;
  return e && flow.link && kindIs(ctx.registry, ctx.world, e.kind, "property") ? flow.link : null;
}

/**
 * One occurrence of a stream as its posting (the `revenue` amount provider): worked out at its
 * instant, with its spread and the adjustments in force (what they bring from outside at most the
 * world's cap on unlisted prices in a stream's month), and booked by its kind.
 */
function streamPosting(api: FinanceApi, ctx: ReadContext, flow: Flow, at: number, rng: Rng): FlowPosting | Rejection | null {
  const id = strOf(objOf("provider" in flow.amount ? flow.amount.args : undefined).stream, flow.id);
  const stream = streamOf(ctx, id);
  const main = landAt(api, ctx, flow.to);
  if (!stream || !main?.party) return null;
  const model = stream.model;
  const month = monthOf(ctx.world, at);
  const record = monthRecord(ctx.state, id, month);
  // A royalty pays a production month once: the month's first occurrence.
  if (model.type === "royalty" && record.occurrences > 0) return null;
  const rd = engineReader(ctx, main.party);
  const spread = (model.spread_pct ?? 0) / 100;
  // Nothing is drawn unless the stream sets a spread, so a stream without one is the same under any seed.
  const drawn = spread > 0 ? 1 + spread * (rng.next() + rng.next() - 1) : 1;
  const base = earnedAt(rd, flow, model, at, drawn);
  if (!base) return null;
  let earned = base;
  let extra = 0;
  const adjustments = inForce(ctx.state, id, at);
  if (adjustments.length > 0) {
    const adjusted = earnedAt(rd, flow, model, at, adjustments.reduce((f, a) => f * (a.factor ?? 1), drawn), adjustments.reduce((c, a) => c + (a.cents ?? 0), 0)) ?? base;
    const room = Math.max(0, unpricedCap(ctx.world) - record.extra);
    earned = adjusted.cents - base.cents > room ? (earnedAt(rd, flow, model, at, drawn, room) ?? base) : adjusted;
    extra = Math.max(0, earned.cents - base.cents);
  }
  if (earned.cents <= 0) return null;
  const property = linkedProperty(ctx, flow);
  const recorded = (net: number): LedgerEvent => ({ type: REVENUE_EVENT, data: { stream: id, month, cents: earned.cents, net, units: unitsOf(earned.units), ...(extra > 0 ? { extra } : {}), ...(property && earned.royalty ? { property } : {}) } });
  const payer = payerAccount(api, ctx, flow.from);
  switch (model.type) {
    case "product":
    case "catalog":
      return salesPosting(api, ctx, flow, main.account, main.party, payer, earned, model, recorded);
    case "royalty":
      return royaltyPosting(api, ctx, flow, id, model, payer, earned, at, recorded);
    case "fees":
    case "custom": {
      const targets = api.split(earned.cents, flow.splits ?? [], flow.to);
      const lines: PostingLine[] = [{ account: payer, amount: -earned.cents }];
      for (const t of targets) {
        const land = t.to === flow.to ? main : landAt(api, ctx, t.to);
        lines.push({ account: land?.account ?? outsideAccount(t.to), amount: t.cents });
      }
      const category = model.category ?? (model.type === "fees" ? REVENUE_CATEGORIES.fees : REVENUE_CATEGORIES.other);
      return { cents: earned.cents, lines: mergedLines(lines), memo: flow.label, kind: "income", category, extra: [recorded(earned.cents)] };
    }
  }
}

/** Lines on one account folded into one, the empty ones dropped. */
function mergedLines(lines: readonly PostingLine[]): PostingLine[] {
  const out: PostingLine[] = [];
  for (const l of lines) {
    const same = out.find((x) => x.account === l.account);
    if (same) same.amount += l.amount;
    else out.push({ ...l });
  }
  return out.filter((l) => l.amount !== 0);
}

/**
 * A product's or a catalog's occurrence, booked as a business's walk-in takings are (DESIGN §26.2):
 * the price with the sales tax its customers pay on top (none on a line its region exempts by tax
 * category), the cost of the goods by each line's margin (else the business's), owed to its suppliers.
 */
function salesPosting(api: FinanceApi, ctx: ReadContext, flow: Flow, deposit: string, earner: EntityId, payer: string, earned: Earned, model: RevenueModel, recorded: (net: number) => LedgerEvent): FlowPosting {
  const business = isBusiness(ctx, earner) ? earner : null;
  const fields = own(ctx.state.entities, earner)?.fields ?? {};
  const place = business ? (placesOf(ctx, business)[0] ?? null) : null;
  const collects = business !== null && fields.collects_sales_tax !== false && api.feature(ctx, business, "sales_tax");
  const pct = collects ? salesTaxPct(ctx, place) : 0;
  const margin = numOf(fields.margin_pct, 100);
  let tax = 0;
  let cogs = 0;
  for (const l of earned.lines) {
    if (collects && !taxExempt(ctx, place, l.category ?? "")) tax += salesTaxOn(l.cents, pct);
    cogs += Math.round((l.cents * (100 - Math.min(100, Math.max(0, l.margin ?? model.margin_pct ?? margin)))) / 100);
  }
  const lines: PostingLine[] = [
    { account: payer, amount: -(earned.cents + tax) },
    { account: deposit, amount: earned.cents + tax },
  ];
  const sale: LedgerEvent[] = business ? [{ type: "economy.sale", data: { business, cents: earned.cents, tax, cogs, takings: 0, payer: "", memo: flow.label, category: REVENUE_CATEGORIES.sales, walkin: true } }] : [];
  // Daily takings are many: like a holding's payouts, the posting is all a turn's lines get of them.
  return { cents: earned.cents + tax, lines, memo: flow.label, kind: "sale", category: REVENUE_CATEGORIES.sales, extra: [...sale, recorded(earned.cents)], quiet: true };
}

/**
 * A royalty's occurrence: the gross from its payer to the earners (split by the flow's splits), then
 * from each earner's account its severance tax and deductions, each its own posting in the unit, and
 * an income record of what each received (`royalty`, for their taxes).
 */
function royaltyPosting(api: FinanceApi, ctx: ReadContext, flow: Flow, id: EntityId, model: RevenueModel, payer: string, earned: Earned, at: number, recorded: (net: number) => LedgerEvent): FlowPosting {
  const r = earned.royalty;
  const lines: PostingLine[] = [{ account: payer, amount: -earned.cents }];
  const extra: LedgerEvent[] = [];
  let net = 0;
  for (const t of api.split(earned.cents, flow.splits ?? [], flow.to)) {
    const land = landAt(api, ctx, t.to);
    const account = land?.account ?? outsideAccount(t.to);
    lines.push({ account, amount: t.cents });
    const deductions = Math.round((t.cents * (model.deductions_pct ?? 0)) / 100);
    const severance = Math.round((t.cents * (model.severance_pct ?? 0)) / 100);
    net += t.cents - deductions - severance;
    if (!land?.party) continue;
    const party = land.party;
    const out = (cents: number, payee: string, category: string): LedgerEvent[] =>
      cents > 0 ? posting([{ account, amount: -cents }, { account: outsideAccount(payee), amount: cents }], { memo: `${flow.label}: ${payee.toLowerCase()}`, kind: "payment", category, flow: flow.id, at, counterparty: payee, payer: party }) : [];
    extra.push(...out(severance, SEVERANCE_PAYEE, REVENUE_CATEGORIES.severance), ...out(deductions, DEDUCTIONS_PAYEE, REVENUE_CATEGORIES.deductions), ...incomeFor(id, party, t.cents - deductions - severance, "royalty"));
  }
  return { cents: earned.cents, lines: mergedLines(lines), memo: flow.label, kind: "income", category: REVENUE_CATEGORIES.royalties, extra: [...extra, recorded(r ? net : earned.cents)] };
}

// ---------------------------------------------------------------- valuation

/** The streams linked to a property, in force. */
export function linkedStreams(ctx: ReadContext, property: EntityId): Stream[] {
  return streamIds(ctx.state).flatMap((id) => {
    const s = streamOf(ctx, id);
    return s && s.flow.link === property && s.flow.status === "active" ? [s] : [];
  });
}

/** What a property's streams are projected to pay its owners a month, net, for `months` months from `at`'s. */
export function projectedIncome(api: FinanceApi, ctx: ReadContext, property: EntityId, at: number, months: number): number[] {
  const out = Array.from({ length: months }, () => 0);
  for (const s of linkedStreams(ctx, property)) {
    const earner = earnerOf(api, ctx, s.flow);
    if (!earner) continue;
    const paid = (month: string): boolean => monthRecord(ctx.state, s.flow.id, month).occurrences > 0;
    for (const [i, m] of streamMonths(engineReader(ctx, earner), s, at, months, paid).entries()) out[i] = (out[i] ?? 0) + m.net;
  }
  return out;
}

/**
 * A property's value from its streams (§27.9): its `valuation`'s method over the income they are
 * projected to pay (a mineral interest is valued at PV10 over 30 years when it names none). Null
 * when it isn't valued from income, or no stream is linked to it.
 */
export function incomeValue(api: FinanceApi, ctx: ReadContext, property: EntityId, at: number = ctx.state.clock): number | null {
  const e = own(ctx.state.entities, property);
  if (!e) return null;
  const v = valuationOf(e.fields.valuation) ?? (e.fields.property_type === "mineral" ? VALUATION_DEFAULTS : null);
  if (!v || linkedStreams(ctx, property).length === 0) return null;
  return valueFromIncome(v, projectedIncome(api, ctx, property, at, v.method === "pv" ? v.horizon_months : 12));
}

// ---------------------------------------------------------------- views

/** The streams a party earns, as its money view lists them: each with its record, its next twelve months and the adjustments in force. */
export function streamRows(api: FinanceApi, ctx: ReadContext, party: EntityId): RevenueStreamView[] {
  const out: RevenueStreamView[] = [];
  for (const id of streamIds(ctx.state)) {
    const s = streamOf(ctx, id);
    if (!s || earnerOf(api, ctx, s.flow) !== party) continue;
    const paid = (month: string): boolean => monthRecord(ctx.state, id, month).occurrences > 0;
    out.push({
      id,
      label: s.flow.label,
      type: s.model.type,
      earner: party,
      link: s.flow.link ?? null,
      status: s.flow.status,
      months: streamRecord(ctx.state, id),
      preview: streamMonths(engineReader(ctx, party), s, ctx.state.clock, 12, paid).map((m) => m.cents),
      ai: s.model.ai ?? "off",
      adjustments: inForce(ctx.state, id, ctx.state.clock).map(({ id: adj, factor, cents, from, until, reason }) => ({ id: adj, from, until, reason, ...(factor !== undefined ? { factor } : {}), ...(cents !== undefined ? { cents } : {}) })),
      ...(s.model.unit ? { unit: s.model.unit } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------- registration

/** Revenue streams: their field on flows, their amount provider, record, adjustments, view rows and lint. */
export function registerRevenue(r: FinanceRegistry): void {
  r.fields("flow", FLOW_FIELDS);
  r.amount(REVENUE_PROVIDER, (ctx, flow, at, rng) => streamPosting(r.api, ctx, flow, at, rng));
  r.core.event(RECORD);
  r.core.event(ADJUSTED);
  r.core.effect({
    type: ADJUST_EFFECT,
    args: ["stream", "factor?", "cents?", "days?", "reason", "by?", "story?"],
    gm: true,
    resolve: (a, ctx) => {
      const args = adjustArgs(a);
      const refused = adjustRefusal(r.api, ctx, args);
      if (refused) return refused;
      const from = ctx.state.clock;
      const until = from + (args.days ?? 7) * 1440;
      const id = `adj:${hashParts(args.stream, from, args.factor ?? "", args.cents ?? "", args.reason).slice(0, 10)}`;
      return [{ type: ADJUSTED_EVENT, data: { stream: args.stream, id, from, until, reason: args.reason, ...(args.factor !== undefined ? { factor: args.factor } : {}), ...(args.cents !== undefined ? { cents: args.cents } : {}), ...(typeof a.by === "string" && a.by !== "" ? { by: a.by } : {}), ...(a.story === true ? { story: true } : {}) } }];
    },
  });
  // What the story says of a stream ("the fair doubled our takings this week"), quoted, asks first.
  r.core.proposal({
    type: REVENUE_FACT,
    boundField: "money",
    validate: (p, ctx) => {
      if (strOf(p.said).trim() === "") return reject("no_quote", "a revenue change quotes what the story said");
      return adjustRefusal(r.api, ctx, adjustArgs(p));
    },
    toEffects: (p) => {
      const a = adjustArgs(p);
      return [{ type: ADJUST_EFFECT, args: { stream: a.stream, reason: a.reason, story: true, ...(a.factor !== undefined ? { factor: a.factor } : {}), ...(a.cents !== undefined ? { cents: a.cents } : {}), ...(a.days !== undefined ? { days: a.days } : {}) } }];
    },
  });
  r.view((ctx, party) => {
    const streams = streamRows(r.api, ctx, party);
    return streams.length > 0 ? { streams } : {};
  });
  r.core.lint({
    code: "economy.revenue",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "flow" || e.fields.revenue === undefined || e.fields.revenue === null) continue;
        const path = `entities.${e.id}.fields.revenue`;
        for (const problem of revenueProblems(e.fields.revenue)) issues.push({ severity: "error" as const, code: "economy.revenue", message: `Stream ${e.name} ${problem}.`, path });
        const model = revenueOf(e.fields.revenue);
        if (model?.type === "royalty" && e.fields.every !== "month") issues.push({ severity: "warning" as const, code: "economy.revenue", message: `Stream ${e.name} is a royalty, which pays once a month (each month's first payment pays the production of ${model.lag_months ?? 0} months before); set it to every month.`, path: `entities.${e.id}.fields.every` });
      }
      return issues;
    },
  });
}
