// Taxes (DESIGN §26.3): withholding on pay, sales tax by region, and income tax on what nobody
// withholds from: a contractor's pay, a pass-through business's profit, and a corporation's profit.
//
// Withholding is flat below the top Money level: the occupation's federal-plus-FICA rate and the
// region's state rate. At the top level it is worked out from the tables: the pay period
// annualized, less pre-tax deductions and the standard deduction for the filing status, through the
// federal brackets; Social Security up to the year's wage base, Medicare with its additional rate
// past the threshold; then the state's and the locality's rates.
//
// Income tax nobody withholds is paid as estimated tax, quarterly on the federal due dates, by a
// flow per person (contract pay, their share of pass-through profit) and per C corporation (its
// profit). The flat rate below the top level is the occupation's set-aside.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { FILING_STATUSES, type FilingStatus, type Flow, type FlowSchedule, type TaxesView, type TaxYearView } from "../../../shared/finance";
import type { FieldDef } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf, dayIndexOfText, MINUTES_PER_DAY, monthName } from "../../../engine/calendar";
import { jobsAt, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { passMemo } from "../../../engine/read-pass";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { addToBooks, businessBooks, monthBook, monthOf, operatingAccount, payablesOf, totalsOf } from "./books";
import { hiddenFrom, holdersOf, regionRow } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** A change of a company's structure as the bookkeeping writes it, taxed from the next estimated-tax period (ORG-SPEC §3.13); nothing when it is so already. */
    "economy.restructure": (ctx: ReadContext, business: EntityId, structure: string) => LedgerEvent[] | Rejection;
  }
}

type Tables = Pick<ReadContext, "tables">;
type Ctx = Pick<ReadContext, "tables" | "world" | "state">;

export interface TaxBracket {
  /** Annual taxable income where the bracket starts, in minor units. */
  from: number;
  /** Where it ends; null for the top bracket. */
  to: number | null;
  pct: number;
}

export interface FederalTables {
  brackets: Record<FilingStatus, TaxBracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  socialSecurityPct: number;
  /** The year's Social Security wage base, in minor units. */
  wageBase: number;
  medicarePct: number;
  additionalMedicarePct: number;
  /** Wages in a year past which the additional Medicare rate applies. */
  additionalMedicareFrom: number;
  selfEmploymentPct: number;
}

/** The Social Security wage base and the additional Medicare threshold for a single filer, when the tables leave them out. */
const WAGE_BASE = 17610000;
const ADDITIONAL_MEDICARE_FROM = 20000000;

/** The share of self-employment earnings the self-employment tax applies to (the employer-equivalent half comes off first). */
const SE_EARNINGS_SHARE = 0.9235;

/** The federal corporate rate on a C corporation's profit, unless the economy config sets its own (`taxes.corporatePct`). */
export const CORPORATE_PCT = 21;

function bracketsOf(v: JsonValue | undefined): TaxBracket[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => objOf(raw))
    .filter((b) => typeof b.from_cents === "number" && typeof b.rate_pct === "number")
    .map((b) => ({ from: numOf(b.from_cents), to: typeof b.to_cents === "number" ? b.to_cents : null, pct: numOf(b.rate_pct) }))
    .sort((a, b) => a.from - b.from);
}

/**
 * The federal tables (`economy.finance` → `taxes_federal`). Head of household has no bracket list of
 * its own in the data, so it uses the single brackets with its own standard deduction.
 */
export function federalTables(ctx: Tables): FederalTables {
  const v = objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values);
  const fica = objOf(v.fica);
  const sd = objOf(v.standard_deduction_cents);
  const single = bracketsOf(v.brackets_single);
  const joint = bracketsOf(v.brackets_married_filing_jointly);
  const base = own(fica, `social_security_wage_base_cents_${numOf(v.tax_year)}`);
  return {
    brackets: { single, married_filing_jointly: joint.length > 0 ? joint : single, head_of_household: single },
    standardDeduction: { single: numOf(sd.single), married_filing_jointly: numOf(sd.married_filing_jointly), head_of_household: numOf(sd.head_of_household) },
    socialSecurityPct: numOf(fica.social_security_employee_pct, 6.2),
    wageBase: typeof base === "number" ? base : WAGE_BASE,
    medicarePct: numOf(fica.medicare_employee_pct, 1.45),
    additionalMedicarePct: numOf(fica.additional_medicare_pct_over_200k_single, 0.9),
    additionalMedicareFrom: ADDITIONAL_MEDICARE_FROM,
    selfEmploymentPct: numOf(fica.self_employment_pct, 15.3),
  };
}

/** Tax on an annual taxable income through the brackets, rounded to the minor unit. */
export function bracketTax(brackets: readonly TaxBracket[], taxable: number): number {
  let tax = 0;
  for (const b of brackets) {
    if (taxable <= b.from) break;
    tax += (((b.to === null ? taxable : Math.min(taxable, b.to)) - b.from) * b.pct) / 100;
  }
  return Math.round(tax);
}

export function filingStatusOf(ctx: Pick<ReadContext, "state">, person: EntityId): FilingStatus {
  const raw = strOf(own(ctx.state.entities, person)?.fields.filing_status);
  return (FILING_STATUSES as readonly string[]).includes(raw) ? (raw as FilingStatus) : "single";
}

/** The state income tax rate where a person lives, and the local rate for someone who pays it, in percent. */
export function stateTaxPct(ctx: Ctx, person: EntityId): { state: number; local: number } {
  const region = regionRow(ctx, person);
  return { state: numOf(region.state_income_tax_effective_pct), local: own(ctx.state.entities, person)?.fields.local_tax === true ? numOf(region.local_income_tax_pct_typical) : 0 };
}

// ---------------------------------------------------------------- the year's pay

/** One year of a person's pay, as their payslips add it up. */
export interface YearPay {
  gross: number;
  /** Social Security and Medicare wages. */
  fica: number;
  withheld: number;
  pretax: number;
  /** Contract pay by month (`"1"`…`"12"`), which estimated tax covers. */
  contract: Record<string, number>;
}

/** Years of pay kept per person: this one and the last. */
const YEARS_KEPT = 2;

export function yearPay(state: Readonly<WorldState>, person: EntityId, year: number): YearPay {
  const y = objOf(own(objOf(own(objOf(sliceOf(state, "economy").ytd), person)), String(year)));
  const contract: Record<string, number> = {};
  for (const [m, c] of Object.entries(objOf(y.contract))) if (typeof c === "number") contract[m] = c;
  return { gross: numOf(y.gross), fica: numOf(y.fica), withheld: numOf(y.withheld), pretax: numOf(y.pretax), contract };
}

/** Adds a paycheck to its year (inside an event's apply), keeping the newest years. */
export function addPay(state: WorldState, person: EntityId, year: number, month: number, pay: { gross: number; fica: number; withheld: number; pretax: number; contract: boolean }): void {
  const ytd = sliceRecord(state, "economy", "ytd");
  const mine: JsonObject = { ...objOf(own(ytd, person)) };
  const cur = yearPay(state, person, year);
  const contract: JsonObject = { ...cur.contract };
  if (pay.contract) contract[String(month)] = numOf(contract[String(month)]) + pay.gross;
  mine[String(year)] = { gross: cur.gross + pay.gross, fica: cur.fica + pay.fica, withheld: cur.withheld + pay.withheld, pretax: cur.pretax + pay.pretax, contract };
  for (const old of Object.keys(mine).sort().slice(0, Math.max(0, Object.keys(mine).length - YEARS_KEPT))) delete mine[old];
  ytd[person] = mine;
}

/** Adds a paycheck's payroll taxes to its employer's year (inside an event's apply): what it withheld and its own share, the newest years kept. */
export function addPayrollTaxes(state: WorldState, employer: EntityId, year: number, withheld: number, employerShare: number): void {
  const all = sliceRecord(state, "economy", "payroll_taxes");
  const mine: JsonObject = { ...objOf(own(all, employer)) };
  const cur = objOf(own(mine, String(year)));
  mine[String(year)] = { withheld: numOf(cur.withheld) + withheld, employer: numOf(cur.employer) + employerShare };
  for (const old of Object.keys(mine).sort().slice(0, Math.max(0, Object.keys(mine).length - YEARS_KEPT))) delete mine[old];
  all[employer] = mine;
}

// ---------------------------------------------------------------- withholding

/** One paycheck's taxes, each in minor units; with flat withholding `federal` holds FICA too. */
export interface PayTaxes {
  federal: number;
  socialSecurity: number;
  medicare: number;
  state: number;
  local: number;
}

export function taxTotal(t: PayTaxes): number {
  return t.federal + t.socialSecurity + t.medicare + t.state + t.local;
}

export interface PayTaxInput {
  gross: number;
  /** The job's occupation, whose flat rate applies below the top level. */
  occupation: string;
  /** Pre-tax deductions this paycheck: `income` comes off income-tax wages, `fica` off FICA wages too. */
  pretax: { income: number; fica: number };
  /** Pay periods a year: how a paycheck annualizes. */
  periods: number;
  /** FICA wages already paid this calendar year, before this paycheck. */
  ytdFica: number;
  /** Bracket withholding (the top level) rather than flat. */
  brackets: boolean;
  /** Contract work: nothing withheld (estimated tax covers it). */
  selfEmployed: boolean;
  /** Student employees at their own school: no FICA. */
  ficaExempt: boolean;
}

/**
 * Withholding on one paycheck. Flat: the job's occupation's federal-plus-FICA rate and the state rate on
 * gross pay less pre-tax deductions. Brackets: the period's taxable pay annualized, less the
 * standard deduction, through the brackets and back to one period; FICA on this paycheck's FICA
 * wages within the year's wage base; state and local on taxable pay.
 */
export function payTaxes(ctx: Ctx, person: EntityId, input: PayTaxInput): PayTaxes {
  if (input.selfEmployed || input.gross <= 0) return { federal: 0, socialSecurity: 0, medicare: 0, state: 0, local: 0 };
  const taxable = Math.max(0, input.gross - input.pretax.income);
  const { state, local } = stateTaxPct(ctx, person);
  const stateTax = Math.round((taxable * state) / 100);
  const localTax = Math.round((taxable * local) / 100);
  if (!input.brackets) {
    const occ = rowOf(ctx, "economy.occupations", input.occupation);
    return { federal: Math.round((taxable * numOf(occ?.withholding_rate_pct)) / 100), socialSecurity: 0, medicare: 0, state: stateTax, local: localTax };
  }
  const t = federalTables(ctx);
  const filing = filingStatusOf(ctx, person);
  const periods = Math.max(1, input.periods);
  const federal = Math.round(bracketTax(t.brackets[filing], Math.max(0, taxable * periods - t.standardDeduction[filing])) / periods);
  if (input.ficaExempt) return { federal, socialSecurity: 0, medicare: 0, state: stateTax, local: localTax };
  const wages = Math.max(0, input.gross - input.pretax.fica);
  const socialSecurity = Math.round((Math.min(wages, Math.max(0, t.wageBase - input.ytdFica)) * t.socialSecurityPct) / 100);
  const over = Math.min(wages, Math.max(0, input.ytdFica + wages - Math.max(input.ytdFica, t.additionalMedicareFrom)));
  const medicare = Math.round((wages * t.medicarePct + over * t.additionalMedicarePct) / 100);
  return { federal, socialSecurity, medicare, state: stateTax, local: localTax };
}

// ---------------------------------------------------------------- business and estimated tax

export const STRUCTURES = ["sole_proprietorship", "partnership", "llc", "s_corp", "c_corp"] as const;
export type Structure = (typeof STRUCTURES)[number];

/** A business's legal structure; an LLC by default. */
export function structureOf(state: Readonly<WorldState>, business: EntityId): Structure {
  const s = strOf(own(state.entities, business)?.fields.structure);
  return (STRUCTURES as readonly string[]).includes(s) ? (s as Structure) : "llc";
}

/** Owners of a sole proprietorship, a partnership or an LLC pay self-employment tax on its profit; an S corporation's don't. */
function selfEmployedProfit(structure: Structure): boolean {
  return structure !== "s_corp" && structure !== "c_corp";
}

/** A C corporation's income tax on a period's profit: the federal corporate rate plus the state rate where it operates. */
export function corporateTax(ctx: Ctx, business: EntityId, profit: number): number {
  if (profit <= 0) return 0;
  const federal = numOf(objOf(objOf(ctx.world.packs.economy?.config).taxes).corporatePct, CORPORATE_PCT);
  return Math.round((profit * (federal + numOf(regionRow(ctx, business).state_income_tax_effective_pct))) / 100);
}

/**
 * The federal estimated-tax periods: each due date (month, day) pays for the months before it since
 * the last one: Apr 15 for January to March, Jun 15 for April and May, Sep 15 for June to August,
 * and Jan 15 for September to December of the year before.
 */
const ESTIMATE_DUE: readonly { month: number; months: readonly number[]; lastYear: boolean }[] = [
  { month: 1, months: [9, 10, 11, 12], lastYear: true },
  { month: 4, months: [1, 2, 3], lastYear: false },
  { month: 6, months: [4, 5], lastYear: false },
  { month: 9, months: [6, 7, 8], lastYear: false },
];

/** When estimated tax is paid: on those dates, rolled to the next business day. */
const ESTIMATE_SCHEDULE: FlowSchedule = { every: "year", months: ESTIMATE_DUE.map((d) => d.month), days: [15], roll: "after" };

export interface EstimatePeriod {
  year: number;
  months: readonly number[];
  /** `YYYY:m,m,…`, how the payments record it. */
  key: string;
}

function period(year: number, months: readonly number[]): EstimatePeriod {
  return { year, months, key: `${year}:${months.join(",")}` };
}

/** The months an estimated-tax payment made in `month` of `year` covers, or null when that isn't a due month. */
export function estimatePeriod(year: number, month: number): EstimatePeriod | null {
  const due = ESTIMATE_DUE.find((d) => d.month === month);
  return due ? period(due.lastYear ? year - 1 : year, due.months) : null;
}

/** The period due in `month` of `year`, then the three due before it: a year of payments, newest first. */
export function periodsBack(year: number, month: number): EstimatePeriod[] {
  const out: EstimatePeriod[] = [];
  let i = ESTIMATE_DUE.findIndex((d) => d.month === month);
  if (i < 0) return out;
  let y = year;
  for (let n = 0; n < ESTIMATE_DUE.length; n++) {
    const due = ESTIMATE_DUE[i];
    if (due) out.push(period(due.lastYear ? y - 1 : y, due.months));
    i--;
    if (i < 0) {
      i = ESTIMATE_DUE.length - 1;
      y--;
    }
  }
  return out;
}

/** The clock span of some months of a year: from the first's first day to the day after the last's last. */
function monthsSpan(ctx: Pick<ReadContext, "world">, year: number, months: readonly number[]): { from: number; to: number } {
  const cal = calendarOf(ctx.world);
  const first = months[0] ?? 1;
  const last = months[months.length - 1] ?? 12;
  const next = last === 12 ? dayIndexOf(cal, year + 1, 1, 1) : dayIndexOf(cal, year, last + 1, 1);
  return { from: clockAt(cal, dayIndexOf(cal, year, first, 1), 0), to: clockAt(cal, next, 0) };
}

/** When a business's change of structure is taxed from (`structure_from`, ORG-SPEC §3.13), as a clock reading; null without one waiting or applied, or when its date doesn't read. */
function structureFrom(ctx: Pick<ReadContext, "world" | "state">, business: EntityId): number | null {
  const f = own(ctx.state.entities, business)?.fields;
  const from = strOf(f?.structure_from);
  if (!(STRUCTURES as readonly string[]).includes(strOf(f?.structure_before)) || from === "") return null;
  try {
    const cal = calendarOf(ctx.world);
    return clockAt(cal, dayIndexOfText(cal, from.slice(0, 10)), 0);
  } catch {
    // A date that doesn't read leaves its own structure in force.
    return null;
  }
}

/**
 * The structure a business is taxed as at `clock` (ORG-SPEC §3.13): after a change, the one it
 * changed from (`structure_before`) until the estimated-tax period after the change begins
 * (`structure_from`), then its own. Draws and payouts follow its own structure at once.
 */
export function taxStructureAt(ctx: Pick<ReadContext, "world" | "state">, business: EntityId, clock: number): Structure {
  const from = structureFrom(ctx, business);
  return from !== null && clock < from ? (strOf(own(ctx.state.entities, business)?.fields.structure_before) as Structure) : structureOf(ctx.state, business);
}

/** Whether a business's profit passed or passes through to its owners within the last change of structure: its own structure, or the one it changed from, isn't a C corporation's. */
function passesThrough(state: Readonly<WorldState>, business: EntityId): boolean {
  const before = strOf(own(state.entities, business)?.fields.structure_before);
  return structureOf(state, business) !== "c_corp" || ((STRUCTURES as readonly string[]).includes(before) && before !== "c_corp");
}

/** How many holders up its owners a business's profit is followed (§3.11), as worth is (four). */
const LOOK_THROUGH_DEPTH = 4;

/**
 * One way a business's profit reaches a holder up its owners (§3.11, look-through): `source`'s profit,
 * the holder's share of it in percent (each owner's share along the way multiplied in), and `via`, the
 * businesses it passes through above `source`, nearest first, the last the one the holder owns.
 */
interface ProfitPath {
  source: EntityId;
  share: number;
  via: EntityId[];
}

/**
 * Every holder's paths to the businesses whose profit may reach them: one walk of the businesses and
 * their owners, four holders up, a business met twice on one way counted once, kept for a read pass
 * (DESIGN §9.6), where views ask it per party. Whether a path carries tax is the structures' along
 * it, read for each period (`passedThrough`).
 */
function pathsByHolder(ctx: ReadContext, api: FinanceApi): Map<EntityId, ProfitPath[]> {
  return passMemo([ctx.state, ctx.world, api], "economy.pass_through", () => {
    const out = new Map<EntityId, ProfitPath[]>();
    const company = (id: EntityId): boolean => !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "business");
    for (const id of Object.keys(ctx.state.entities).sort()) {
      if (!company(id)) continue;
      let frontier: ProfitPath[] = [{ source: id, share: 100, via: [] }];
      for (let depth = 0; depth < LOOK_THROUGH_DEPTH && frontier.length > 0; depth++) {
        const next: ProfitPath[] = [];
        for (const path of frontier) {
          const at = path.via[path.via.length - 1] ?? path.source;
          // Only a party on its owners list has a share of it.
          for (const holder of holdersOf(ctx.state, at)) {
            const share = api.shareOf(ctx.state, at, holder);
            if (share <= 0 || holder === id || path.via.includes(holder)) continue;
            // A direct owner's share as it stands, so their estimate is what it was before look-through.
            const reached: ProfitPath = { source: id, share: depth === 0 ? share : (path.share * share) / 100, via: path.via };
            const held = out.get(holder);
            if (held) held.push(reached);
            else out.set(holder, [reached]);
            if (company(holder)) next.push({ ...reached, via: [...path.via, holder] });
          }
        }
        frontier = next;
      }
    }
    return out;
  });
}

/**
 * The pass-through profit of a span that reaches `holder` (§3.11): each path's share of its source's
 * profit, where the source and every business on the way pass it through at the span's start (a C
 * corporation on the way keeps it, as its own taxable profit); self-employment income where the
 * business the holder owns is a sole proprietorship, a partnership or an LLC. `counts` leaves out the
 * sources it refuses (those not yet paying business taxes, for an estimate).
 */
function passedThrough(ctx: ReadContext, api: FinanceApi, holder: EntityId, span: { from: number; to: number }, counts: (source: EntityId) => boolean = () => true): { selfEmployed: number; other: number; parts: { source: EntityId; cents: number }[] } {
  let selfEmployed = 0;
  let other = 0;
  const parts: { source: EntityId; cents: number }[] = [];
  for (const p of pathsByHolder(ctx, api).get(holder) ?? []) {
    const chain = [p.source, ...p.via];
    if (chain.some((b) => taxStructureAt(ctx, b, span.from) === "c_corp") || !counts(p.source)) continue;
    const cents = Math.round((Math.max(0, businessBooks(api, ctx, p.source, span.from, span.to).profit) * p.share) / 100);
    if (selfEmployedProfit(taxStructureAt(ctx, chain[chain.length - 1] ?? p.source, span.from))) selfEmployed += cents;
    else other += cents;
    parts.push({ source: p.source, cents });
  }
  return { selfEmployed, other, parts };
}

/**
 * A person's ordinary income for a calendar year: wages and contract pay paid in it, and their share
 * of pass-through business profit over its months, up the companies between too; taxable after
 * pre-tax deductions and the standard deduction. The holdings module stacks capital gains on it.
 */
export function ordinaryIncome(api: FinanceApi, ctx: ReadContext, person: EntityId, year: number): { gross: number; taxable: number; filing: FilingStatus } {
  const pay = yearPay(ctx.state, person, year);
  const through = passedThrough(ctx, api, person, monthsSpan(ctx, year, [1, 12]));
  const gross = pay.gross + through.selfEmployed + through.other;
  const filing = filingStatusOf(ctx, person);
  return { gross, taxable: Math.max(0, gross - pay.pretax - federalTables(ctx).standardDeduction[filing]), filing };
}

/**
 * A person's estimated tax for one period: income tax on the contract pay and pass-through profit
 * share of its months (through the companies between too), stacked on the year's wages, plus
 * self-employment tax and the state rate. Below the top level it is the occupation's set-aside rate
 * and the state rate.
 */
export function estimatedTax(api: FinanceApi, ctx: ReadContext, person: EntityId, p: EstimatePeriod): { cents: number; income: number } {
  const pay = yearPay(ctx.state, person, p.year);
  const contract = api.feature(ctx, person, "withholding") ? p.months.reduce((a, m) => a + numOf(own(pay.contract, String(m))), 0) : 0;
  const through = passedThrough(ctx, api, person, monthsSpan(ctx, p.year, p.months), (source) => api.feature(ctx, source, "business_tax"));
  const seIncome = contract + through.selfEmployed;
  const income = seIncome + through.other;
  if (income <= 0) return { cents: 0, income: 0 };
  const state = (income * stateTaxPct(ctx, person).state) / 100;
  if (!api.feature(ctx, person, "tax_brackets")) {
    const occ = rowOf(ctx, "economy.occupations", setAsideOccupation(ctx, person));
    return { cents: Math.round((income * numOf(occ?.estimated_tax_set_aside_pct, 15)) / 100 + state), income };
  }
  const t = federalTables(ctx);
  const filing = filingStatusOf(ctx, person);
  const scale = 12 / p.months.length;
  const se = (seIncome * SE_EARNINGS_SHARE * t.selfEmploymentPct) / 100;
  // Stacked on the year's wages (annualized from the months so far): the tax this income adds to theirs.
  const contractYear = Object.values(pay.contract).reduce((a, c) => a + c, 0);
  const wagesYear = (Math.max(0, pay.gross - contractYear - pay.pretax) * 12) / Math.max(1, ...p.months);
  const base = Math.max(0, wagesYear - t.standardDeduction[filing]);
  const stacked = Math.max(0, wagesYear + (income - se / 2) * scale - t.standardDeduction[filing]);
  const federal = (bracketTax(t.brackets[filing], stacked) - bracketTax(t.brackets[filing], base)) / scale;
  return { cents: Math.round(federal + se + state), income };
}

/** A C corporation's taxable profit for a span: its own, and what pass-through businesses it owns (through others too) pass up to it (§3.11). */
function corporateProfit(ctx: ReadContext, api: FinanceApi, business: EntityId, span: { from: number; to: number }): number {
  const through = passedThrough(ctx, api, business, span);
  return businessBooks(api, ctx, business, span.from, span.to).profit + through.selfEmployed + through.other;
}

/** The first day of the estimated-tax period after the one `clock` falls in (`YYYY-MM-DD`): a change of structure is taxed from then (§3.13). */
export function nextTaxPeriod(ctx: Pick<ReadContext, "world">, clock: number): string {
  const d = dateAt(calendarOf(ctx.world), clock);
  const months = ESTIMATE_DUE.find((due) => due.months.includes(d.month))?.months ?? [d.month];
  const last = months[months.length - 1] ?? d.month;
  const [y, m] = last === 12 ? [d.year + 1, 1] : [d.year, last + 1];
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/**
 * A change of a company's structure (§3.13), as the bookkeeping writes it: its `structure`, at once
 * for draws and payouts, and the structure it is taxed as until the next estimated-tax period begins
 * (`structure_before`, `structure_from`); changed back before then, nothing is left waiting. A sole
 * proprietorship has exactly one owner. Nothing when it is so already.
 */
function restructureEvents(api: FinanceApi, ctx: ReadContext, business: EntityId, structure: string): LedgerEvent[] | Rejection {
  if (!(STRUCTURES as readonly string[]).includes(structure)) return { code: "bad_structure", reason: `a company's structure is one of ${STRUCTURES.join(", ")}` };
  if (structure === structureOf(ctx.state, business)) return [];
  const holders = api.ownersOf(ctx.state, business).filter((o) => api.shareOf(ctx.state, business, o.party) > 0);
  if (structure === "sole_proprietorship" && new Set(holders.map((o) => o.party)).size !== 1) return { code: "owners", reason: `A sole proprietorship has exactly one owner; ${labelOf(ctx, business)} has ${new Set(holders.map((o) => o.party)).size}` };
  const taxed = taxStructureAt(ctx, business, ctx.state.clock);
  const set = (field: string, value: string): LedgerEvent => ({ type: "set", entity: business, field, value });
  return [set("structure", structure), ...(taxed === structure ? [set("structure_before", ""), set("structure_from", "")] : [set("structure_before", taxed), set("structure_from", nextTaxPeriod(ctx, ctx.state.clock))])];
}

// ---------------------------------------------------------------- sales tax

/** The tax region a place is in: its own `tax_region` or an enclosing place's, else the world's economy region, else `us`. */
export function taxRegionOf(ctx: Pick<ReadContext, "world">, place: PlaceId | null): string {
  for (let id = place ?? undefined, guard = 0; id && guard < 32; guard++) {
    const p = own(ctx.world.places, id);
    if (!p) break;
    const region = p.fields.tax_region;
    if (typeof region === "string" && region !== "") return region;
    id = p.parent;
  }
  const configured = objOf(ctx.world.packs.economy?.config).region;
  return typeof configured === "string" && configured !== "" ? configured : "us";
}

/** The sales tax rate at a place, in percent: a `sales_tax_pct` the place (or an enclosing one) sets, else its tax region's combined rate. */
export function salesTaxPct(ctx: Pick<ReadContext, "world" | "tables">, place: PlaceId | null): number {
  for (let id = place ?? undefined, guard = 0; id && guard < 32; guard++) {
    const p = own(ctx.world.places, id);
    if (!p) break;
    const pct = p.fields.sales_tax_pct;
    if (typeof pct === "number" && Number.isFinite(pct) && pct >= 0) return pct;
    id = p.parent;
  }
  return numOf(rowOf(ctx, "economy.regions", taxRegionOf(ctx, place))?.sales_tax_combined_avg_pct);
}

/** Whether a category is exempt from sales tax at a place: the economy config's `taxes.exempt`, or the place's (or an enclosing place's) `tax_exempt`. */
export function taxExempt(ctx: Pick<ReadContext, "world">, place: PlaceId | null, category: string): boolean {
  const named = (v: JsonValue | undefined): boolean => Array.isArray(v) && v.includes(category);
  if (named(objOf(objOf(ctx.world.packs.economy?.config).taxes).exempt)) return true;
  for (let id = place ?? undefined, guard = 0; id && guard < 32; guard++) {
    const p = own(ctx.world.places, id);
    if (!p) break;
    if (named(p.fields.tax_exempt)) return true;
    id = p.parent;
  }
  return false;
}

/** Sales tax on a pre-tax price at a rate, rounded to the minor unit. */
export function salesTaxOn(cents: number, pct: number): number {
  return cents > 0 && pct > 0 ? Math.round((cents * pct) / 100) : 0;
}

/** The outside account a region's sales tax goes to. */
export function salesTaxAccount(api: FinanceApi, region: string): string {
  return api.outside(`tax:sales:${region}`);
}

// ---------------------------------------------------------------- estimated-tax flows

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** Estimated-tax payments kept per payer: two years of periods. */
const PERIODS_KEPT = 8;

/**
 * `economy.estimated_tax`: an estimated-tax payment made, by a person or a C corporation, with what
 * it paid toward each period it covered. A corporation's goes in its books as business tax.
 */
export const ESTIMATED_TAX: EventTypeDef<PackEvent> = {
  type: "economy.estimated_tax",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "party")) && Array.isArray(e.data.periods) ? null : ({ code: "bad_event", reason: "estimated tax needs its payer and the periods it pays" } satisfies Rejection)),
  apply: (e, state, ctx) => {
    const party = str(e, "party");
    const all = sliceRecord(state, "economy", "estimated");
    const paid: JsonObject = { ...objOf(own(all, party)) };
    let total = 0;
    for (const raw of Array.isArray(e.data.periods) ? e.data.periods : []) {
      const p = objOf(raw);
      const key = strOf(p.key);
      paid[key] = numOf(paid[key]) + numOf(p.cents);
      total += numOf(p.cents);
    }
    for (const old of Object.keys(paid).sort().slice(0, Math.max(0, Object.keys(paid).length - PERIODS_KEPT))) delete paid[old];
    all[party] = paid;
    if (e.data.business === true) addToBooks(state, party, monthOf(ctx.world, state.clock), { business_tax: total });
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `Estimated tax: ${labelOf(ctx, str(e, "party"))}`),
};

/** The estimated-tax flow: on the four due dates, rolled to the next business day, from the payer to the tax authority. */
function estimateFlow(id: string, label: string, from: string, to: string, party: EntityId, business: boolean): Flow {
  // A payment that can't be made is made with the next: each one settles every period of the last year left unpaid.
  return { id, label, kind: "tax", from, to, amount: { provider: "estimated_tax", args: { party, business } }, schedule: ESTIMATE_SCHEDULE, shortfall: "skip", category: business ? "business_tax" : "tax", link: party, status: "active", source: "estimated_tax" };
}

/**
 * Each person's contract jobs' occupations, ended ones too, since their pay still owes estimated tax
 * (a job's own, else the person's), by job id (`contractOccupations`): one walk of the jobs, kept for
 * a read pass (DESIGN §9.6).
 */
function contractWork(ctx: ReadContext): Map<EntityId, string[]> {
  return passMemo([ctx.state, ctx.world], "economy.contract_work", () => {
    const out = new Map<EntityId, string[]>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = own(ctx.state.entities, id);
      const worker = e?.kind === "job" ? e.fields.worker : undefined;
      if (!e || typeof worker !== "string") continue;
      const occupation = strOf(e.fields.occupation, strOf(own(ctx.state.entities, worker)?.fields.occupation));
      if (e.fields.contractor !== true && (e.fields.contractor !== undefined || rowOf(ctx, "economy.occupations", occupation)?.self_employed !== true)) continue;
      const held = out.get(worker);
      if (held) held.push(occupation);
      else out.set(worker, [occupation]);
    }
    return out;
  });
}

/** The occupations of a person's contract jobs (`contractWork`). */
function contractOccupations(ctx: ReadContext, person: EntityId): string[] {
  return [...(contractWork(ctx).get(person) ?? [])];
}

/** The occupation a person's estimated tax sets aside by: their contract job's, else their own. */
function setAsideOccupation(ctx: ReadContext, person: EntityId): string {
  return contractOccupations(ctx, person)[0] ?? strOf(own(ctx.state.entities, person)?.fields.occupation);
}

/**
 * Whether a person may have income nobody withholds from (§3.11, §3.13): a contract job; a share of
 * a business that passes its profit through to them now, directly or through others; or of one that
 * did until it became a C corporation, while the payment for the last period it was taxed through is
 * still to make: until its due date, and after it while that period is unpaid with tax on it, which
 * the next payment would settle. After that the flow ends, so a corporation's owner keeps none paying nothing.
 */
function owesEstimates(api: FinanceApi, ctx: ReadContext, person: EntityId, paths: ReadonlyMap<EntityId, readonly ProfitPath[]>, work: ReadonlyMap<EntityId, readonly string[]>): boolean {
  if ((work.get(person)?.length ?? 0) > 0) return true;
  const now = ctx.state.clock;
  // The latest day a way to them stopped passing profit through: the earliest change on it to a corporation.
  let until: number | null = null;
  for (const p of paths.get(person) ?? []) {
    const chain = [p.source, ...p.via];
    if (chain.every((b) => taxStructureAt(ctx, b, now) !== "c_corp")) return true;
    if (!chain.every((b) => passesThrough(ctx.state, b))) continue;
    const stopped = Math.min(...chain.map((b) => (structureOf(ctx.state, b) === "c_corp" ? (structureFrom(ctx, b) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY)));
    if (Number.isFinite(stopped) && (until === null || stopped > until)) until = stopped;
  }
  if (until === null) return false;
  const due = api.occurrences(ctx, ESTIMATE_SCHEDULE, until - 1, until + 40 * MINUTES_PER_DAY)[0];
  if (due === undefined || now <= due) return true;
  const d = dateAt(calendarOf(ctx.world), due);
  const last = estimatePeriod(d.year, d.month);
  const next = api.occurrences(ctx, ESTIMATE_SCHEDULE, now, now + 400 * MINUTES_PER_DAY)[0];
  if (last === null || next === undefined) return false;
  const n = dateAt(calendarOf(ctx.world), next);
  const settles = periodsBack(n.year, n.month).some((p) => p.key === last.key);
  return settles && own(objOf(own(objOf(sliceOf(ctx.state, "economy").estimated), person)), last.key) === undefined && estimatedTax(api, ctx, person, last).cents > 0;
}

/** What an estimated-tax payment on `at` comes to: the period due then, and any of the year before it no payment settled, each with what is left of its tax. */
function estimatedDue(api: FinanceApi, ctx: ReadContext, party: EntityId, business: boolean, at: number): { key: string; cents: number }[] {
  const d = dateAt(calendarOf(ctx.world), at);
  const paid = objOf(own(objOf(sliceOf(ctx.state, "economy").estimated), party));
  const periods: { key: string; cents: number }[] = [];
  for (const [i, p] of periodsBack(d.year, d.month).entries()) {
    if (i > 0 && own(paid, p.key) !== undefined) continue;
    const span = monthsSpan(ctx, p.year, p.months);
    // A corporation pays for the periods it is taxed as one (§3.13), on its own profit and what passes up to it (§3.11).
    const tax = business ? (taxStructureAt(ctx, party, span.from) === "c_corp" ? corporateTax(ctx, party, corporateProfit(ctx, api, party, span)) : 0) : estimatedTax(api, ctx, party, p).cents;
    const due = tax - numOf(own(paid, p.key));
    if (due > 0) periods.push({ key: p.key, cents: due });
  }
  return periods;
}

/** A date in words, as Taxes gives what falls due ("15 Apr 2027"). */
function dayWords(ctx: Pick<ReadContext, "world">, clock: number): string {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, clock);
  return `${d.day} ${monthName(cal, d.month)} ${d.year}`;
}

/** An employer's payroll taxes in a year (`economy.payroll_taxes`): what it withheld from its staff's pay and its own share. */
export function payrollTaxesIn(state: Readonly<WorldState>, employer: EntityId, year: number): { withheld: number; employer: number } {
  const y = objOf(own(objOf(own(objOf(sliceOf(state, "economy").payroll_taxes), employer)), String(year)));
  return { withheld: numOf(y.withheld), employer: numOf(y.employer) };
}

/**
 * An organization's Taxes (§3.11, §4.4) as `viewer` (the player character; null for the GM) may read
 * it: this year and last, from its books, its payroll's records and its accounts' journal (sales tax
 * collected and remitted; withholding and its own share of payroll tax; income tax paid; property
 * tax); the sales tax it holds; how its income is taxed, a pass-through's to the people at the top
 * with their shares (anyone the viewer can't see as "someone", and the organizations that pay none);
 * a corporation's income tax so far; what falls due next; and a change of structure waiting.
 */
export function taxesView(api: FinanceApi, ctx: ReadContext, org: EntityId, viewer: EntityId | null): TaxesView {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const year = dateAt(cal, now).year;
  const company = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", "business");
  const accounts = api.accountsOf(ctx, org, "worth");
  const years: TaxYearView[] = [year, year - 1].map((y) => {
    const out: TaxYearView = { year: y, salesCollected: 0, salesRemitted: 0, withheld: 0, employerShare: 0, income: 0, property: 0 };
    for (let m = 1; m <= 12; m++) {
      const month = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
      if (company) {
        const b = monthBook(ctx.state, org, month);
        out.salesCollected += b.tax_collected;
        out.salesRemitted += b.tax_remitted;
        out.income += b.business_tax;
      }
      for (const a of accounts) out.property += totalsOf(ctx.state, a, month).property_tax?.out ?? 0;
    }
    const payroll = payrollTaxesIn(ctx.state, org, y);
    return { ...out, withheld: payroll.withheld, employerShare: payroll.employer };
  });
  const corporate = company && taxStructureAt(ctx, org, now) === "c_corp";
  const yearSpan = { from: clockAt(cal, dayIndexOf(cal, year, 1, 1), 0), to: now + 1 };
  const taxedTo: TaxesView["taxedTo"] = [];
  const untaxed: TaxesView["untaxed"] = [];
  if (company && !corporate) {
    for (const [holder, paths] of pathsByHolder(ctx, api)) {
      const share = paths.filter((p) => p.source === org && p.via.every((b) => taxStructureAt(ctx, b, now) !== "c_corp")).reduce((a, p) => a + p.share, 0);
      if (share <= 0) continue;
      const kind = own(ctx.state.entities, holder)?.kind ?? "";
      const name = hiddenFrom(ctx, viewer, holder) ? "someone" : labelOf(ctx, holder);
      if (kindIs(ctx.registry, ctx.world, kind, "person")) taxedTo.push({ name, share });
      else if (!kindIs(ctx.registry, ctx.world, kind, "business")) untaxed.push({ name, share });
    }
    taxedTo.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  }
  const due: TaxesView["due"] = [];
  for (const flow of api.flows(ctx)) {
    const mine = flow.id === `salestax:${org}` || flow.id === `esttax:${org}` || (flow.id.startsWith("property_tax:") && flow.link !== undefined && api.shareOf(ctx.state, flow.link, org) > 0);
    if (!mine || flow.status !== "active") continue;
    const at = api.occurrences(ctx, flow.schedule, now, now + 400 * MINUTES_PER_DAY, flow.start)[0];
    if (at === undefined) continue;
    const cents = flow.id === `salestax:${org}` ? Math.max(0, payablesOf(ctx.state, org).sales_tax) : flow.id === `esttax:${org}` ? estimatedDue(api, ctx, org, true, at).reduce((a, p) => a + p.cents, 0) : null;
    due.push({ label: flow.label, cents, at: dayWords(ctx, at) });
  }
  const f = own(ctx.state.entities, org)?.fields;
  const before = strOf(f?.structure_before);
  const from = strOf(f?.structure_from);
  return {
    income: company ? (corporate ? "corporate" : "owners") : null,
    years,
    salesHeld: company ? Math.max(0, payablesOf(ctx.state, org).sales_tax) : 0,
    incomeSoFar: corporate && api.feature(ctx, org, "business_tax") ? corporateTax(ctx, org, corporateProfit(ctx, api, org, yearSpan)) : null,
    taxedTo,
    untaxed,
    due,
    pending: company && before !== "" && from !== "" && taxStructureAt(ctx, org, now) !== structureOf(ctx.state, org) ? { structure: structureOf(ctx.state, org), from: dayWords(ctx, clockAt(cal, dayIndexOfText(cal, from.slice(0, 10)), 0)) } : null,
  };
}

/** What the taxes module adds to a business: what a change of structure leaves waiting for the next estimated-tax period (§3.13). */
const TAX_FIELDS: Record<string, FieldDef> = {
  structure_before: { type: "text", label: "Taxed as, until the change of structure (sole_proprietorship, partnership, llc, s_corp or c_corp)", domain: "money", level: 4 },
  structure_from: { type: "text", label: "Its structure is taxed from (YYYY-MM-DD)", domain: "money", level: 4 },
};

/** Estimated tax: a flow per person with contract pay or pass-through profit and per C corporation, its provider, and the tax queries the holdings module shares; changes of structure; an organization's Taxes. */
export function registerTaxes(r: FinanceRegistry): void {
  const { api, core } = r;
  r.fields("business", TAX_FIELDS);
  core.event(ESTIMATED_TAX);
  r.flows({
    id: "estimated_tax",
    flows: (ctx) => {
      const out: Flow[] = [];
      const paths = pathsByHolder(ctx, api);
      const work = contractWork(ctx);
      for (const id of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, id);
        if (!e || isGone(ctx.state, id)) continue;
        // The payee is named as a flow names someone outside (`tax:federal`), not as their outside account.
        if (kindIs(ctx.registry, ctx.world, e.kind, "person") && owesEstimates(api, ctx, id, paths, work)) out.push(estimateFlow(`esttax:${id}`, "Estimated tax", id, "tax:federal", id, false));
        // A corporation, and one that was until its change of structure is taxed (§3.13).
        else if (kindIs(ctx.registry, ctx.world, e.kind, "business") && (structureOf(ctx.state, id) === "c_corp" || strOf(e.fields.structure_before) === "c_corp")) out.push(estimateFlow(`esttax:${id}`, "Corporate income tax", operatingAccount(api, ctx, id) ?? id, "tax:federal", id, true));
      }
      return out;
    },
  });
  r.amount("estimated_tax", (ctx, flow, at): FlowPosting | null => {
    const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    const party = strOf(args.party);
    const business = args.business === true;
    if (!own(ctx.state.entities, party) || (business && !api.feature(ctx, party, "business_tax"))) return null;
    const periods = estimatedDue(api, ctx, party, business, at);
    const cents = periods.reduce((a, p) => a + p.cents, 0);
    if (cents <= 0) return null;
    // A corporation pays from its operating account, which the flow would pay to an outside account of
    // its own naming; its posting names the federal tax account itself, as withholding does.
    const payer = business ? operatingAccount(api, ctx, party) : null;
    const lines = payer ? [{ account: payer, amount: -cents }, { account: api.outside("tax:federal"), amount: cents }] : undefined;
    return { cents, ...(lines ? { lines } : {}), memo: business ? "Corporate income tax" : "Estimated tax", kind: "payment", category: business ? "business_tax" : "tax", extra: [{ type: "economy.estimated_tax", data: { party, periods, ...(business ? { business: true } : {}) } }] };
  });
  core.query("economy.ordinary_income", (ctx, person, year) => ordinaryIncome(api, ctx, person, year));
  core.query("economy.income_tax", (ctx, filing, taxable) => bracketTax(federalTables(ctx).brackets[filing], taxable));
  core.service("economy.restructure", (ctx, business, structure) => restructureEvents(api, ctx, business, structure));
  // Taxes on an organization's page (§4.4, §4.7), behind `money.view`: a company's from Money 3; a household that employs, at Money 4.
  core.orgSection({
    id: "taxes",
    label: "Taxes",
    power: "money.view",
    build: (ctx, org, viewer) => {
      const level = ctx.levelOf(org, "money");
      const company = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", "business");
      const employs = orgTypeOf(ctx, org) === "household" && level >= 4 && (jobsAt(ctx, org).length > 0 || Object.keys(objOf(own(objOf(sliceOf(ctx.state, "economy").payroll_taxes), org))).length > 0);
      return (company && level >= 3) || employs ? (taxesView(api, ctx, org, viewer) as unknown as JsonValue) : null;
    },
  });
}
