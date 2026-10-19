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
import type { PackEvent } from "../../../shared/ledger";
import { FILING_STATUSES, type FilingStatus, type Flow } from "../../../shared/finance";
import { calendarOf, clockAt, dateAt, dayIndexOf } from "../../../engine/calendar";
import { numOf, objOf, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { addToBooks, businessBooks, monthOf, operatingAccount } from "./books";
import { regionRow } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";

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
const CORPORATE_PCT = 21;

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

/** Pass-through businesses a person owns a share of, with the share. */
function passThroughShares(ctx: ReadContext, api: FinanceApi, person: EntityId): { business: EntityId; share: number; selfEmployed: boolean }[] {
  const out: { business: EntityId; share: number; selfEmployed: boolean }[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    if (isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "business")) continue;
    const structure = structureOf(ctx.state, id);
    if (structure === "c_corp") continue;
    const share = api.shareOf(ctx.state, id, person);
    if (share > 0) out.push({ business: id, share, selfEmployed: selfEmployedProfit(structure) });
  }
  return out;
}

/**
 * A person's ordinary income for a calendar year: wages and contract pay paid in it, and their share
 * of pass-through business profit over its months; taxable after pre-tax deductions and the
 * standard deduction. The holdings module stacks capital gains on it.
 */
export function ordinaryIncome(api: FinanceApi, ctx: ReadContext, person: EntityId, year: number): { gross: number; taxable: number; filing: FilingStatus } {
  const pay = yearPay(ctx.state, person, year);
  const span = monthsSpan(ctx, year, [1, 12]);
  let gross = pay.gross;
  for (const s of passThroughShares(ctx, api, person)) gross += Math.round((Math.max(0, businessBooks(api, ctx, s.business, span.from, span.to).profit) * s.share) / 100);
  const filing = filingStatusOf(ctx, person);
  return { gross, taxable: Math.max(0, gross - pay.pretax - federalTables(ctx).standardDeduction[filing]), filing };
}

/**
 * A person's estimated tax for one period: income tax on the contract pay and pass-through profit
 * share of its months, stacked on the year's wages, plus self-employment tax and the state rate.
 * Below the top level it is the occupation's set-aside rate and the state rate.
 */
export function estimatedTax(api: FinanceApi, ctx: ReadContext, person: EntityId, p: EstimatePeriod): { cents: number; income: number } {
  const pay = yearPay(ctx.state, person, p.year);
  const contract = api.feature(ctx, person, "withholding") ? p.months.reduce((a, m) => a + numOf(own(pay.contract, String(m))), 0) : 0;
  const span = monthsSpan(ctx, p.year, p.months);
  let seIncome = contract;
  let other = 0;
  for (const s of passThroughShares(ctx, api, person)) {
    if (!api.feature(ctx, s.business, "business_tax")) continue;
    const part = Math.round((Math.max(0, businessBooks(api, ctx, s.business, span.from, span.to).profit) * s.share) / 100);
    if (s.selfEmployed) seIncome += part;
    else other += part;
  }
  const income = seIncome + other;
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
  describe: (e) => `Estimated tax: ${str(e, "party")}`,
};

/** The estimated-tax flow: on the four due dates, rolled to the next business day, from the payer to the tax authority. */
function estimateFlow(id: string, label: string, from: string, to: string, party: EntityId, business: boolean): Flow {
  // A payment that can't be made is made with the next: each one settles every period of the last year left unpaid.
  return { id, label, kind: "tax", from, to, amount: { provider: "estimated_tax", args: { party, business } }, schedule: { every: "year", months: ESTIMATE_DUE.map((d) => d.month), days: [15], roll: "after" }, shortfall: "skip", category: business ? "business_tax" : "tax", link: party, status: "active", source: "estimated_tax" };
}

/** The occupations of a person's contract jobs, ended ones too, since their pay still owes estimated tax (a job's own, else the person's), by job id. */
function contractOccupations(ctx: ReadContext, person: EntityId): string[] {
  const mine = strOf(own(ctx.state.entities, person)?.fields.occupation);
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || e.kind !== "job" || e.fields.worker !== person) return [];
      const occupation = strOf(e.fields.occupation, mine);
      return e.fields.contractor === true || (e.fields.contractor === undefined && rowOf(ctx, "economy.occupations", occupation)?.self_employed === true) ? [occupation] : [];
    });
}

/** The occupation a person's estimated tax sets aside by: their contract job's, else their own. */
function setAsideOccupation(ctx: ReadContext, person: EntityId): string {
  return contractOccupations(ctx, person)[0] ?? strOf(own(ctx.state.entities, person)?.fields.occupation);
}

/** Whether a person may have income nobody withholds from: a contract job, or a share of a pass-through business. */
function owesEstimates(ctx: ReadContext, api: FinanceApi, person: EntityId): boolean {
  return passThroughShares(ctx, api, person).length > 0 || contractOccupations(ctx, person).length > 0;
}

/** Estimated tax: a flow per person with contract pay or pass-through profit and per C corporation, its provider, and the tax queries the holdings module shares. */
export function registerTaxes(r: FinanceRegistry): void {
  const { api, core } = r;
  core.event(ESTIMATED_TAX);
  r.flows({
    id: "estimated_tax",
    flows: (ctx) => {
      const out: Flow[] = [];
      for (const id of Object.keys(ctx.state.entities).sort()) {
        const e = own(ctx.state.entities, id);
        if (!e || isGone(ctx.state, id)) continue;
        if (kindIs(ctx.registry, ctx.world, e.kind, "person") && owesEstimates(ctx, api, id)) out.push(estimateFlow(`esttax:${id}`, "Estimated tax", id, api.outside("tax:federal"), id, false));
        else if (kindIs(ctx.registry, ctx.world, e.kind, "business") && structureOf(ctx.state, id) === "c_corp") out.push(estimateFlow(`esttax:${id}`, "Corporate income tax", operatingAccount(api, ctx, id) ?? api.outside(id), api.outside("tax:federal"), id, true));
      }
      return out;
    },
  });
  r.amount("estimated_tax", (ctx, flow, at): FlowPosting | null => {
    const args = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    const party = strOf(args.party);
    const business = args.business === true;
    if (!own(ctx.state.entities, party) || (business && !api.feature(ctx, party, "business_tax"))) return null;
    const d = dateAt(calendarOf(ctx.world), at);
    const paid = objOf(own(objOf(sliceOf(ctx.state, "economy").estimated), party));
    // The period due now, and any of the year before it that no payment settled.
    const periods: { key: string; cents: number }[] = [];
    for (const [i, p] of periodsBack(d.year, d.month).entries()) {
      if (i > 0 && own(paid, p.key) !== undefined) continue;
      const span = monthsSpan(ctx, p.year, p.months);
      const tax = business ? corporateTax(ctx, party, businessBooks(api, ctx, party, span.from, span.to).profit) : estimatedTax(api, ctx, party, p).cents;
      const due = tax - numOf(own(paid, p.key));
      if (due > 0) periods.push({ key: p.key, cents: due });
    }
    const cents = periods.reduce((a, p) => a + p.cents, 0);
    if (cents <= 0) return null;
    return { cents, memo: business ? "Corporate income tax" : "Estimated tax", kind: "payment", category: business ? "business_tax" : "tax", extra: [{ type: "economy.estimated_tax", data: { party, periods, ...(business ? { business: true } : {}) } }] };
  });
  core.query("economy.ordinary_income", (ctx, person, year) => ordinaryIncome(api, ctx, person, year));
  core.query("economy.income_tax", (ctx, filing, taxable) => bracketTax(federalTables(ctx).brackets[filing], taxable));
}
