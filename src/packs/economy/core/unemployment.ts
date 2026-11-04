// Unemployment taxes on payroll (ORG-SPEC §3.11, Phase 5; DESIGN §26.3): FUTA and SUTA, the employer's
// own cost on its staff's wages, never withheld from them.
//
// Each paycheck from an employer in the world adds to the employer's year, per worker: FUTA on the
// worker's wages up to the FUTA wage base, at the gross rate less the credit for state tax paid (the
// credit a credit-reduction state cuts kept apart, due with the annual return), and SUTA up to the
// state's wage base at the employer's rate (its own `suta_pct`, else the economy config's, else its
// state's new-employer rate, else the national row's). Rates and bases are the world's tables (the
// finance table's `taxes_unemployment` row, the regions' SUTA columns) unless the economy config sets
// its own (`taxes.futaPct`, `futaWageBase`, `futaCreditPct`, `sutaPct`, `sutaWageBase`), so a world
// made before the tables carried them accrues nothing until its author takes the Data update. An
// exempt status spares what its row says (`exempt.ts`). It runs at the employer's Money level, by the
// `unemployment_tax` feature.
//
// Paid on the last day of January, April, July and October (rolled to the next business day), from
// the account the employer's payroll is paid from: FUTA deposits the year's undeposited liability once
// it passes the deposit threshold (else it carries to the next quarter), and January's annual return
// settles the year before (with the credit reduction); SUTA pays each quarter ended and any unpaid
// one before it. A company books both as payroll.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { Flow, FlowSchedule, UnemploymentView } from "../../../shared/finance";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { dissolvedOn } from "../../../engine/org";
import { labelOf, numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { addToBooks, monthOf, operatingAccount } from "./books";
import { exemptStatusOf } from "./exempt";
import { regionRow } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Every unemployment tax (FUTA, SUTA) an employer has accrued and not yet paid, as one posting's lines from the account its payroll is paid from to the tax authorities, with the bookkeeping that records it paid; null when it owes none. */
    "economy.unemployment_due": (ctx: ReadContext, employer: EntityId) => { cents: number; lines: { account: string; amount: number }[]; events: LedgerEvent[] } | null;
  }
}

type Ctx = Pick<ReadContext, "tables" | "world" | "state">;

/** `economy.unemployment_accrued`: what a paycheck adds to its employer's unemployment taxes. */
export const UNEMPLOYMENT_ACCRUED = "economy.unemployment_accrued";
/** `economy.unemployment_paid`: a FUTA deposit or return, or a SUTA payment, by period. */
export const UNEMPLOYMENT_PAID = "economy.unemployment_paid";

/** Years of an employer's unemployment taxes kept: this one and the last, whose return is filed in January. */
const YEARS_KEPT = 2;

/** When they are paid: the last day of the month after each quarter, rolled to the next business day. */
const DUE_SCHEDULE: FlowSchedule = { every: "year", months: [1, 4, 7, 10], days: [-1], roll: "after" };

export type UnemploymentKind = "futa" | "suta";

const KIND_WORDS: Readonly<Record<UnemploymentKind, string>> = { futa: "Federal unemployment tax (FUTA)", suta: "State unemployment tax (SUTA)" };
const AUTHORITY: Readonly<Record<UnemploymentKind, string>> = { futa: "tax:federal", suta: "tax:state" };

const numOrNull = (v: JsonValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** The quarter (1 to 4) a month falls in. */
export function quarterOf(month: number): number {
  return Math.min(4, Math.max(1, Math.ceil(month / 3)));
}

// ---------------------------------------------------------------- rates

/** The finance table's FUTA parameters (`taxes_unemployment.futa`). */
function futaTable(ctx: Pick<ReadContext, "tables">): JsonObject {
  return objOf(objOf(ctx.tables.get("economy.finance")?.rows.taxes_unemployment?.values).futa);
}

/** What an employer pays on its staff's wages, each null where it owes none: FUTA's gross rate, credit, credit reduction (percent) and wage base; SUTA's rate and wage base. */
export interface UnemploymentRates {
  futa: { grossPct: number; creditPct: number; reductionPct: number; base: number } | null;
  suta: { pct: number; base: number } | null;
}

/**
 * An employer's unemployment tax rates: SUTA's from its own `suta_pct`, the config, its state's
 * new-employer rate or the national row, on the config's wage base or its state's; FUTA's from the
 * config or the finance table, its credit earned by paying SUTA, and its state's credit reduction.
 * An exempt status spares what its row says.
 */
export function unemploymentRates(ctx: Ctx, employer: EntityId): UnemploymentRates {
  const status = exemptStatusOf(ctx, employer);
  const taxes = objOf(objOf(ctx.world.packs.economy?.config).taxes);
  const region = regionRow(ctx, employer);
  const national = objOf(ctx.tables.get("economy.regions")?.rows.us);
  const sutaPct = numOrNull(own(ctx.state.entities, employer)?.fields.suta_pct) ?? numOrNull(taxes.sutaPct) ?? numOrNull(region.suta_new_employer_pct) ?? numOrNull(national.suta_new_employer_pct);
  const sutaBase = numOrNull(taxes.sutaWageBase) ?? numOrNull(region.suta_wage_base_cents) ?? numOrNull(national.suta_wage_base_cents);
  const suta = (status?.suta ?? true) && sutaPct !== null && sutaBase !== null && sutaPct >= 0 && sutaBase > 0 ? { pct: sutaPct, base: Math.round(sutaBase) } : null;
  const table = futaTable(ctx);
  const grossPct = numOrNull(taxes.futaPct) ?? numOrNull(table.gross_pct);
  const futaBase = numOrNull(taxes.futaWageBase) ?? numOrNull(table.wage_base_cents);
  if (!(status?.futa ?? true) || grossPct === null || futaBase === null || grossPct <= 0 || futaBase <= 0) return { futa: null, suta };
  // The credit for state tax is earned by paying it: none for an employer that owes no SUTA.
  const creditPct = suta ? Math.min(grossPct, Math.max(0, numOrNull(taxes.futaCreditPct) ?? numOrNull(table.max_credit_pct) ?? 0)) : 0;
  const reductionPct = Math.min(creditPct, Math.max(0, numOf(region.futa_credit_reduction_pct)));
  return { futa: { grossPct, creditPct, reductionPct, base: Math.round(futaBase) }, suta };
}

/** An employer's unemployment taxes as its Taxes and Payroll show them; null where the feature is off for it or it owes neither. */
export function unemploymentView(api: FinanceApi, ctx: ReadContext, employer: EntityId): UnemploymentView | null {
  if (!api.feature(ctx, employer, "unemployment_tax")) return null;
  const rates = unemploymentRates(ctx, employer);
  if (!rates.futa && !rates.suta) return null;
  const f = rates.futa;
  return {
    futa: f ? { pct: Math.round((f.grossPct - f.creditPct + f.reductionPct) * 1000) / 1000, grossPct: f.grossPct, creditPct: f.creditPct, reductionPct: f.reductionPct, base: f.base } : null,
    suta: rates.suta,
  };
}

// ---------------------------------------------------------------- records

/** An employer's year of unemployment taxes: the wages counted toward each base, per worker; FUTA and SUTA by quarter, the credit reduction, and what each has paid. */
export interface UnemploymentYear {
  wages: Record<EntityId, number>;
  sutaWages: Record<EntityId, number>;
  futa: number[];
  reduction: number;
  suta: number[];
  futaPaid: number;
  sutaPaid: number[];
}

function quarters(v: JsonValue | undefined): number[] {
  const a = Array.isArray(v) ? v : [];
  return [0, 1, 2, 3].map((i) => numOf(a[i]));
}

function amounts(v: JsonValue | undefined): Record<EntityId, number> {
  const out: Record<EntityId, number> = {};
  for (const [k, c] of Object.entries(objOf(v))) if (typeof c === "number") out[k] = c;
  return out;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0);

function employerRecord(state: Readonly<WorldState>, employer: EntityId): JsonObject {
  return objOf(own(objOf(sliceOf(state, "economy").unemployment), employer));
}

/** An employer's unemployment taxes in a year, as its records keep them. */
export function unemploymentYear(state: Readonly<WorldState>, employer: EntityId, year: number): UnemploymentYear {
  const y = objOf(own(employerRecord(state, employer), String(year)));
  return { wages: amounts(y.wages), sutaWages: amounts(y.suta_wages), futa: quarters(y.futa), reduction: numOf(y.reduction), suta: quarters(y.suta), futaPaid: numOf(y.futa_paid), sutaPaid: quarters(y.suta_paid) };
}

/** The years an employer's records keep, oldest first. */
function keptYears(state: Readonly<WorldState>, employer: EntityId): number[] {
  return Object.keys(employerRecord(state, employer))
    .map(Number)
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => a - b);
}

/** Writes a year back (inside an event's apply), keeping the newest years. */
function writeYear(state: WorldState, employer: EntityId, year: number, rec: UnemploymentYear): void {
  const all = sliceRecord(state, "economy", "unemployment");
  const mine: JsonObject = { ...objOf(own(all, employer)) };
  mine[String(year)] = { wages: rec.wages, suta_wages: rec.sutaWages, futa: rec.futa, reduction: rec.reduction, suta: rec.suta, futa_paid: rec.futaPaid, suta_paid: rec.sutaPaid };
  for (const old of Object.keys(mine).sort().slice(0, Math.max(0, Object.keys(mine).length - YEARS_KEPT))) delete mine[old];
  all[employer] = mine;
}

/** A year's totals, as Taxes shows them: FUTA accrued (the credit reduction with it) and deposited, SUTA accrued and paid. */
export function unemploymentTotals(state: Readonly<WorldState>, employer: EntityId, year: number): { futa: number; futaPaid: number; suta: number; sutaPaid: number } {
  const rec = unemploymentYear(state, employer, year);
  return { futa: sum(rec.futa) + rec.reduction, futaPaid: rec.futaPaid, suta: sum(rec.suta), sutaPaid: sum(rec.sutaPaid) };
}

// ---------------------------------------------------------------- accrual

/**
 * The unemployment taxes a paycheck of `wages` (gross less pre-tax deductions other than retirement)
 * from `employer` to `worker` paid at `at` adds to the employer's year (`economy.unemployment_accrued`);
 * null for an outside employer, at a level the feature doesn't run at, or when it owes nothing (an
 * exempt status, no rate, or the worker past both wage bases this year). A worker the year doesn't
 * count yet starts from what the employer paid them earlier this year that nothing counted (`earlier`:
 * a chat that took the Data update, or reached the feature's level, partway through the year), which
 * the event records as counted (`before`), so no one is taxed again on wages past the bases.
 */
export function unemploymentAccrual(api: FinanceApi, ctx: ReadContext, employer: EntityId | null, worker: EntityId, wages: number, at: number, earlier: () => number = () => 0): LedgerEvent | null {
  if (employer === null || wages <= 0 || !own(ctx.state.entities, employer) || !api.feature(ctx, employer, "unemployment_tax")) return null;
  const rates = unemploymentRates(ctx, employer);
  if (!rates.futa && !rates.suta) return null;
  const d = dateAt(calendarOf(ctx.world), at);
  const rec = unemploymentYear(ctx.state, employer, d.year);
  const before = rec.wages[worker] === undefined && rec.sutaWages[worker] === undefined ? Math.max(0, Math.round(earlier())) : 0;
  const futaWages = rates.futa ? Math.max(0, Math.min(wages, rates.futa.base - (rec.wages[worker] ?? before))) : 0;
  const sutaWages = rates.suta ? Math.max(0, Math.min(wages, rates.suta.base - (rec.sutaWages[worker] ?? before))) : 0;
  if (futaWages === 0 && sutaWages === 0) return null;
  const futa = rates.futa ? Math.round((futaWages * (rates.futa.grossPct - rates.futa.creditPct)) / 100) : 0;
  const reduction = rates.futa ? Math.round((futaWages * rates.futa.reductionPct) / 100) : 0;
  const suta = rates.suta ? Math.round((sutaWages * rates.suta.pct) / 100) : 0;
  return { type: UNEMPLOYMENT_ACCRUED, data: { employer, worker, year: d.year, quarter: quarterOf(d.month), futa_wages: futaWages, suta_wages: sutaWages, ...(before > 0 ? { before } : {}), futa, reduction, suta } };
}

function quarterOk(v: JsonValue | undefined): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;
}

/** `economy.unemployment_accrued`: a paycheck's wages counted toward the worker's bases at its employer (with what they were paid there before the year counted them, `before`), and its FUTA, credit reduction and SUTA added to the quarter. */
export const ACCRUED_EVENT: EventTypeDef<PackEvent> = {
  type: UNEMPLOYMENT_ACCRUED,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "employer")) && typeof e.data.year === "number" && quarterOk(e.data.quarter) ? null : ({ code: "bad_event", reason: "an unemployment tax accrual needs its employer, its year and its quarter" } satisfies Rejection)),
  apply: (e, state) => {
    const employer = str(e, "employer");
    const worker = str(e, "worker");
    const year = numOf(e.data.year);
    const q = numOf(e.data.quarter) - 1;
    const rec = unemploymentYear(state, employer, year);
    if (worker !== "") {
      const before = Math.max(0, numOf(e.data.before));
      rec.wages[worker] = (rec.wages[worker] ?? 0) + before + numOf(e.data.futa_wages);
      rec.sutaWages[worker] = (rec.sutaWages[worker] ?? 0) + before + numOf(e.data.suta_wages);
    }
    rec.futa[q] = (rec.futa[q] ?? 0) + numOf(e.data.futa);
    rec.suta[q] = (rec.suta[q] ?? 0) + numOf(e.data.suta);
    rec.reduction += numOf(e.data.reduction);
    writeYear(state, employer, year, rec);
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `Unemployment tax accrued: ${labelOf(ctx, str(e, "employer"))}`),
};

/** `economy.unemployment_paid`: what a FUTA deposit or return, or a SUTA payment, paid toward each period; a company's goes in its books as payroll. */
export const PAID_EVENT: EventTypeDef<PackEvent> = {
  type: UNEMPLOYMENT_PAID,
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "employer")) && (e.data.kind === "futa" || e.data.kind === "suta") && Array.isArray(e.data.periods) ? null : ({ code: "bad_event", reason: "an unemployment tax payment needs its employer, its kind (futa or suta) and the periods it pays" } satisfies Rejection)),
  apply: (e, state, ctx) => {
    const employer = str(e, "employer");
    let total = 0;
    for (const raw of Array.isArray(e.data.periods) ? e.data.periods : []) {
      const p = objOf(raw);
      const year = numOf(p.year);
      const cents = numOf(p.cents);
      const rec = unemploymentYear(state, employer, year);
      if (e.data.kind === "futa") rec.futaPaid += cents;
      else if (quarterOk(p.quarter)) {
        const q = numOf(p.quarter) - 1;
        rec.sutaPaid[q] = (rec.sutaPaid[q] ?? 0) + cents;
      }
      writeYear(state, employer, year, rec);
      total += cents;
    }
    if (e.data.business === true && total !== 0) addToBooks(state, employer, monthOf(ctx.world, state.clock), { payroll: total });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${e.data.kind === "suta" ? "SUTA" : "FUTA"} paid: ${labelOf(ctx, str(e, "employer"))}`),
};

// ---------------------------------------------------------------- payments

function isCompany(ctx: ReadContext, id: EntityId): boolean {
  return kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "business");
}

/** The account an employer's unemployment taxes are paid from, as its payroll is (§3.7): its `payroll_account` when it may spend from it, else a company's operating account, else its best deposit account; null with none. */
function employerAccount(api: FinanceApi, ctx: ReadContext, employer: EntityId): EntityId | null {
  const named = strOf(own(ctx.state.entities, employer)?.fields.payroll_account);
  if (named !== "" && api.accountsOf(ctx, employer, "spend").includes(named)) return named;
  return isCompany(ctx, employer) ? operatingAccount(api, ctx, employer) : api.depositAccount(ctx, employer);
}

/** One period a payment pays: a year (FUTA), or a year's quarter (SUTA), and what it pays toward it. */
interface DuePeriod {
  year: number;
  quarter?: number;
  cents: number;
}

/**
 * What a payment of `kind` on `at` pays, period by period. FUTA: the rest of every year before (the
 * annual return, with the credit reduction), and this year's quarters ended, once what is undeposited
 * passes the threshold. SUTA: every quarter ended that isn't paid in full. `all` takes everything
 * accrued, this quarter's too, as a business wound up pays it.
 */
function duePeriods(ctx: ReadContext, employer: EntityId, kind: UnemploymentKind, at: number, all = false): DuePeriod[] {
  const d = dateAt(calendarOf(ctx.world), at);
  const ended = all ? 4 : Math.floor((d.month - 1) / 3);
  // FUTA undeposited at or below the threshold carries to the next quarter.
  const threshold = all ? -1 : Math.max(0, numOf(futaTable(ctx).deposit_threshold_cents));
  const out: DuePeriod[] = [];
  for (const year of keptYears(ctx.state, employer)) {
    if (year > d.year) continue;
    const rec = unemploymentYear(ctx.state, employer, year);
    if (kind === "futa") {
      const owed = year < d.year ? sum(rec.futa) + rec.reduction - rec.futaPaid : sum(rec.futa.slice(0, ended)) + (all ? rec.reduction : 0) - rec.futaPaid;
      if (owed > 0 && (year < d.year || owed > threshold)) out.push({ year, cents: owed });
      continue;
    }
    for (let q = 1; q <= 4; q++) {
      if (year === d.year && q > ended) break;
      const owed = (rec.suta[q - 1] ?? 0) - (rec.sutaPaid[q - 1] ?? 0);
      if (owed > 0) out.push({ year, quarter: q, cents: owed });
    }
  }
  return out;
}

/** What a payment of `kind` on `at` would pay in all, as Taxes' Due next gives it. */
export function unemploymentDueAt(ctx: ReadContext, employer: EntityId, kind: UnemploymentKind, at: number): number {
  return sum(duePeriods(ctx, employer, kind, at).map((p) => p.cents));
}

/** What an employer has accrued and not paid, of each kind, over the years kept. */
function unpaid(state: Readonly<WorldState>, employer: EntityId): Record<UnemploymentKind, number> {
  const out = { futa: 0, suta: 0 };
  for (const year of keptYears(state, employer)) {
    const rec = unemploymentYear(state, employer, year);
    out.futa += Math.max(0, sum(rec.futa) + rec.reduction - rec.futaPaid);
    out.suta += Math.max(0, sum(rec.suta) - sum(rec.sutaPaid));
  }
  return out;
}

function paidEvent(ctx: ReadContext, employer: EntityId, kind: UnemploymentKind, periods: readonly DuePeriod[]): LedgerEvent {
  return { type: UNEMPLOYMENT_PAID, data: { employer, kind, periods: periods.map((p) => ({ year: p.year, ...(p.quarter !== undefined ? { quarter: p.quarter } : {}), cents: p.cents })), ...(isCompany(ctx, employer) ? { business: true } : {}) } };
}

/** A payment of `kind` on `at`, as its flow posts it: from the employer's payroll account to the authority, with what it paid toward each period; null with nothing due or nothing to pay from. */
function unemploymentPosting(api: FinanceApi, ctx: ReadContext, employer: EntityId, kind: UnemploymentKind, at: number): FlowPosting | null {
  if (!own(ctx.state.entities, employer)) return null;
  const periods = duePeriods(ctx, employer, kind, at);
  const cents = sum(periods.map((p) => p.cents));
  const payer = employerAccount(api, ctx, employer);
  if (cents <= 0 || !payer) return null;
  const year = dateAt(calendarOf(ctx.world), at).year;
  const returns = kind === "futa" && periods.length > 0 && periods.every((p) => p.year < year);
  const memo = returns ? `FUTA return (Form 940) for ${periods.map((p) => p.year).join(", ")}` : kind === "futa" ? "FUTA deposit" : "State unemployment tax (SUTA)";
  return { cents, lines: [{ account: payer, amount: -cents }, { account: api.outside(AUTHORITY[kind]), amount: cents }], memo, kind: "payment", category: "payroll", extra: [paidEvent(ctx, employer, kind, periods)] };
}

/** Everything an employer owes now, FUTA and SUTA, this quarter's and the credit reduction too, as one posting's lines and its bookkeeping (`economy.unemployment_due`). */
function dueNow(api: FinanceApi, ctx: ReadContext, employer: EntityId): { cents: number; lines: { account: string; amount: number }[]; events: LedgerEvent[] } | null {
  if (!own(ctx.state.entities, employer)) return null;
  const payer = employerAccount(api, ctx, employer) ?? api.outside(employer);
  const lines: { account: string; amount: number }[] = [];
  const events: LedgerEvent[] = [];
  let cents = 0;
  for (const kind of ["futa", "suta"] as const) {
    const periods = duePeriods(ctx, employer, kind, ctx.state.clock, true);
    const owed = sum(periods.map((p) => p.cents));
    if (owed <= 0) continue;
    cents += owed;
    lines.push({ account: api.outside(AUTHORITY[kind]), amount: owed });
    events.push(paidEvent(ctx, employer, kind, periods));
  }
  if (cents <= 0) return null;
  return { cents, lines: [{ account: payer, amount: -cents }, ...lines], events };
}

/** The flow paying one kind for an employer: from the account its payroll is paid from, to the authority, on the quarterly due dates. */
function unemploymentFlow(api: FinanceApi, ctx: ReadContext, employer: EntityId, kind: UnemploymentKind): Flow {
  return { id: `${kind}:${employer}`, label: KIND_WORDS[kind], kind: "tax", from: employerAccount(api, ctx, employer) ?? employer, to: AUTHORITY[kind], amount: { provider: kind, args: { employer } }, schedule: DUE_SCHEDULE, shortfall: "skip", category: "payroll", link: employer, status: "active", source: "unemployment_tax" };
}

/** Unemployment taxes: their events, the flows that pay them while anything is owed, their providers, and what a business wound up pays (`economy.unemployment_due`). */
export function registerUnemployment(r: FinanceRegistry): void {
  const { api, core } = r;
  core.event(ACCRUED_EVENT);
  core.event(PAID_EVENT);
  r.flows({
    id: "unemployment_tax",
    flows: (ctx) => {
      const out: Flow[] = [];
      for (const employer of Object.keys(objOf(sliceOf(ctx.state, "economy").unemployment)).sort()) {
        const e = own(ctx.state.entities, employer);
        // A company wound up pays what it owes as it winds up, never by these flows.
        if (!e || isGone(ctx.state, employer) || dissolvedOn(ctx.state, employer) !== null) continue;
        const owed = unpaid(ctx.state, employer);
        for (const kind of ["futa", "suta"] as const) if (owed[kind] > 0) out.push(unemploymentFlow(api, ctx, employer, kind));
      }
      return out;
    },
  });
  for (const kind of ["futa", "suta"] as const) {
    r.amount(kind, (ctx, flow, at): FlowPosting | null => {
      const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
      return unemploymentPosting(api, ctx, strOf(args.employer, flow.link ?? ""), kind, at);
    });
  }
  core.service("economy.unemployment_due", (ctx, employer) => dueNow(api, ctx, employer));
}
