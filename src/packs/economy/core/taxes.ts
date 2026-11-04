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
import { FILING_STATUSES, FINANCE_ACTIONS, ownersIn, STRUCTURE_WORDS, type ConsolidationView, type FilingStatus, type Flow, type FlowSchedule, type TaxesView, type TaxYearView } from "../../../shared/finance";
import type { FieldDef, WorldDoc } from "../../../shared/world";
import type { LintIssue } from "../../../shared/protocol";
import type { Registry } from "../../../engine/registry-impl";
import { calendarOf, clockAt, dateAt, dayIndexOf, dayIndexOfText, MINUTES_PER_DAY, monthName } from "../../../engine/calendar";
import { dissolvedOn, jobsAt, mayAct, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, optionalService, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { passMemo } from "../../../engine/read-pass";
import { isGone, kindIs } from "../../../engine/scope";
import { COMPANY_KIND } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { NONPROFIT_STRUCTURE } from "../../../shared/org";
import { addToBooks, businessBooks, monthBook, monthOf, monthsBetween, operatingAccount, payablesOf, totalsOf } from "./books";
import { deductibleDonors, donationsGiven, donationsReceived, exemptStatuses, exemptStatusOf, foundationGifts, foundationTerms, holdsSCorpShares, isExempt } from "./exempt";
import { hiddenFrom, holdersOf, moneyLevel, regionRow } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { gainsIn, incomeIn } from "./records";
import { votesIn } from "./shares";
import { unemploymentDueAt, unemploymentTotals, unemploymentView } from "./unemployment";
import { carriedInto, closedYear, dividendsReceived, earningsAndProfits, foundationProgress, foundationTaxFor, penaltyTables, penaltyTaxesOn, penaltyTaxFor, registerYearClose, taxPaidFor, type CorporateYear } from "./year-close";
import { grantorOf } from "./gains";
import type { TaxesExtra } from "../../../shared/tax-year";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** A change of a company's structure as the bookkeeping writes it, taxed from the next estimated-tax period (ORG-SPEC §3.13); nothing when it is so already. */
    "economy.restructure": (ctx: ReadContext, business: EntityId, structure: string) => LedgerEvent[] | Rejection;
    /** Why an S corporation may not have `holders` (every worth holder after a change), in words; null when it may, or isn't an S corporation (§26.3). */
    "economy.scorp_holders": (ctx: ReadContext, business: EntityId, holders: readonly EntityId[]) => Rejection | null;
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
  /** Cash gifts to charities and churches (§3.11, Phase 5): deductible up to this percent of AGI by an itemizer; up to `nonItemizer` on top of the standard deduction for anyone else, from the year `nonItemizerFrom`. */
  charitable: { agiLimitPct: number; nonItemizer: Record<FilingStatus, number>; nonItemizerFrom: number };
}

/** The Social Security wage base and the additional Medicare threshold for a single filer, when the tables leave them out. */
const WAGE_BASE = 17610000;
const ADDITIONAL_MEDICARE_FROM = 20000000;

/** The share of self-employment earnings the self-employment tax applies to (the employer-equivalent half comes off first). */
const SE_EARNINGS_SHARE = 0.9235;

/** The federal corporate rate on a C corporation's profit, unless the economy config sets its own (`taxes.corporatePct`). */
export const CORPORATE_PCT = 21;

/** The share of a corporation's votes and of its worth a group must hold to file a consolidated return for it (IRC section 1504(a)(2)), unless the finance table says otherwise. */
const CONSOLIDATION_PCT = 80;

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
  const charity = objOf(v.charitable_contributions);
  const allowance = objOf(charity.non_itemizer_cents);
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
    charitable: { agiLimitPct: numOf(charity.agi_limit_pct, 60), nonItemizer: { single: numOf(allowance.single), married_filing_jointly: numOf(allowance.married_filing_jointly), head_of_household: numOf(allowance.head_of_household) }, nonItemizerFrom: numOf(charity.non_itemizer_from_year, Number.POSITIVE_INFINITY) },
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

/** A business's legal structure; an LLC by default. A nonprofit, with no owners, is taxed as a corporation unless its exempt status spares it. */
export function structureOf(state: Readonly<WorldState>, business: EntityId): Structure {
  const s = strOf(own(state.entities, business)?.fields.structure);
  if (s === NONPROFIT_STRUCTURE) return "c_corp";
  return (STRUCTURES as readonly string[]).includes(s) ? (s as Structure) : "llc";
}

/** Owners of a sole proprietorship, a partnership or an LLC pay self-employment tax on its profit; an S corporation's don't. */
function selfEmployedProfit(structure: Structure): boolean {
  return structure !== "s_corp" && structure !== "c_corp";
}

/** The federal rate on a C corporation's profit, in percent: the economy config's `taxes.corporatePct`, else 21. */
export function federalCorporatePct(ctx: Pick<ReadContext, "world">): number {
  return numOf(objOf(objOf(ctx.world.packs.economy?.config).taxes).corporatePct, CORPORATE_PCT);
}

/** A C corporation's income tax on a period's profit: the federal corporate rate plus the state rate where it operates. */
export function corporateTax(ctx: Ctx, business: EntityId, profit: number): number {
  if (profit <= 0) return 0;
  return Math.round((profit * (federalCorporatePct(ctx) + numOf(regionRow(ctx, business).state_income_tax_effective_pct))) / 100);
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
            // A grantor trust's share is its settlor's (§26.3): the profit reaches them as if they held it.
            const settlor = api.partyKind(ctx, holder) === "trust" ? grantorOf(ctx, holder) : null;
            if (settlor !== null && settlor !== id && !path.via.includes(settlor)) {
              const theirs = out.get(settlor);
              if (theirs) theirs.push({ ...reached });
              else out.set(settlor, [{ ...reached }]);
            }
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
    // A C corporation on the way keeps it as its own profit; an exempt organization keeps it untaxed (§3.11, Phase 5).
    if (chain.some((b) => taxStructureAt(ctx, b, span.from) === "c_corp" || isExempt(ctx, b)) || !counts(p.source)) continue;
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
 * pre-tax deductions and their deduction (`deductionFor`). The holdings module stacks capital gains on it.
 */
export function ordinaryIncome(api: FinanceApi, ctx: ReadContext, person: EntityId, year: number): { gross: number; taxable: number; filing: FilingStatus } {
  const pay = yearPay(ctx.state, person, year);
  const through = passedThrough(ctx, api, person, monthsSpan(ctx, year, [1, 12]));
  const gross = pay.gross + through.selfEmployed + through.other;
  const filing = filingStatusOf(ctx, person);
  return { gross, taxable: Math.max(0, gross - pay.pretax - deductionFor(ctx, person, year, filing, gross - pay.pretax)), filing };
}

/**
 * A person's deduction for a year (§3.11, Phase 5): the standard deduction for their filing status,
 * with the charitable allowance someone who doesn't itemize takes (from its year, up to their
 * deductible gifts to public charities), or, when more, their deductible gifts themselves up to the
 * AGI limit, as the only itemized deduction this engine keeps; gifts to a private foundation within
 * its row's lower limit (30%) and what the AGI limit leaves of it.
 */
function deductionFor(ctx: ReadContext, person: EntityId, year: number, filing: FilingStatus, agi: number): number {
  const t = federalTables(ctx);
  const given = donationsGiven(ctx.state, person, year).deductible;
  if (given <= 0) return t.standardDeduction[filing];
  const toFoundations = Math.min(given, foundationGifts(ctx.state, person, year));
  const toPublic = given - toFoundations;
  const allowance = year >= t.charitable.nonItemizerFrom ? Math.min(toPublic, t.charitable.nonItemizer[filing]) : 0;
  const limit = (Math.max(0, agi) * t.charitable.agiLimitPct) / 100;
  const fromPublic = Math.min(toPublic, limit);
  const foundationLimit = Math.min((Math.max(0, agi) * foundationDonorLimit(ctx)) / 100, Math.max(0, limit - fromPublic));
  return Math.max(t.standardDeduction[filing] + allowance, fromPublic + Math.min(toFoundations, foundationLimit));
}

/** The limit on a person's gifts to private foundations, percent of their income: the exempt table's private foundation row's, else 30. */
function foundationDonorLimit(ctx: Pick<ReadContext, "tables">): number {
  const rows = Object.values(ctx.tables.get("economy.exempt")?.rows ?? {});
  return numOf(rows.find((row) => typeof row.payout_pct === "number" && row.payout_pct > 0)?.donor_limit_pct, 30);
}

/**
 * The federal income tax a person's deductible gifts in a year save them (§3.11, Phase 5): the
 * brackets' tax on their ordinary taxable income with the standard deduction alone, less with their
 * deduction, as their return would refund what withholding and estimates paid without it.
 */
export function charitableSaving(api: FinanceApi, ctx: ReadContext, person: EntityId, year: number): number {
  const pay = yearPay(ctx.state, person, year);
  const income = ordinaryIncome(api, ctx, person, year);
  const t = federalTables(ctx);
  const without = Math.max(0, income.gross - pay.pretax - t.standardDeduction[income.filing]);
  return Math.max(0, bracketTax(t.brackets[income.filing], without) - bracketTax(t.brackets[income.filing], income.taxable));
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

/** The corporate parameters of the finance table's federal section (§26.3): the dividends-received deduction by stake (highest band first), the NOL's limit, and the cap on gifts and how long their excess carries. */
interface CorporateTables {
  drd: { from: number; pct: number }[];
  nolPct: number;
  giftPct: number;
  giftYears: number;
}

function corporateTables(ctx: Tables): CorporateTables {
  const v = objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values);
  const raw = objOf(v.dividends_received_deduction).bands;
  const bands = Array.isArray(raw) ? raw.map((b) => ({ from: numOf(objOf(b).from_pct), pct: numOf(objOf(b).deduction_pct) })) : [];
  return {
    drd: (bands.length > 0 ? bands : [{ from: 0, pct: 50 }, { from: 20, pct: 65 }, { from: 80, pct: 100 }]).sort((a, b) => b.from - a.from),
    nolPct: numOf(objOf(v.net_operating_loss).limit_pct, 80),
    giftPct: numOf(objOf(v.corporate_charitable).limit_pct, 10),
    giftYears: numOf(objOf(v.corporate_charitable).carryforward_years, 5),
  };
}

/** The months of a year each estimated-tax period covers, in the year's order. */
const PERIOD_MONTHS: readonly (readonly number[])[] = [...ESTIMATE_DUE].sort((a, b) => (a.months[0] ?? 0) - (b.months[0] ?? 0)).map((d) => d.months);

/** What a party's accounts took in (`in`) or paid out (`out`) under a journal category over some months. */
function journalTotal(api: FinanceApi, ctx: ReadContext, party: EntityId, months: readonly string[], category: string, side: "in" | "out"): number {
  let total = 0;
  for (const account of api.accountsOf(ctx, party, "worth")) for (const m of months) total += totalsOf(ctx.state, account, m)[category]?.[side] ?? 0;
  return total;
}

/** The share of a dividend a corporation deducts (§26.3, IRC section 243): all of it from a company in its own consolidated return, else by its stake in the payer. */
function drdPct(ctx: ReadContext, api: FinanceApi, t: CorporateTables, receiver: EntityId, payer: EntityId, clock: number): number {
  const filers = consolidatedFilers(ctx, api, clock);
  if ((filers.has(receiver) || filers.has(payer)) && (filers.get(receiver) ?? receiver) === (filers.get(payer) ?? payer)) return 100;
  const share = api.shareOf(ctx.state, payer, receiver);
  return t.drd.find((b) => share + 1e-9 >= b.from)?.pct ?? 0;
}

/** A C corporation's taxable income for a span and how it got there: the dividends it deducted, the gains it was charged, its gifts over the cap, and what it used of the loss and the gifts it carried in. */
interface CorporateSpan {
  taxable: number;
  dividends: number;
  drd: number;
  gains: number;
  giftsOver: number;
  carryUsed: number;
  nolUsed: number;
}

/**
 * A C corporation's taxable income for a span (§3.11, §26.3): its books' profit and what pass-through
 * businesses it owns pass up to it; the dividends from its stakes (its books keep payouts apart) less
 * the dividends-received deduction on them and on its holdings' dividends (50%, the smallest stake's);
 * its capital gains, netted over the year less the capital loss it carried in and charged with the
 * span that ends the year (or with the one under way, `final`, as it goes or as Taxes reads it so far);
 * its gifts only up to 10% of its income without them, then what it carried of earlier years' excess;
 * and, off what is left, its net operating loss up to 80%. What earlier periods of the year used of
 * what it carried in is spent. Kept for a read pass.
 */
function corporateSpan(ctx: ReadContext, api: FinanceApi, business: EntityId, span: { from: number; to: number }, final = false): CorporateSpan {
  const memo = passMemo([ctx.state, ctx.world, api], "economy.corporate_span", () => new Map<string, CorporateSpan>());
  const key = `${business}|${span.from}|${span.to}|${final}`;
  const known = memo.get(key);
  if (known) return known;
  const t = corporateTables(ctx);
  const cal = calendarOf(ctx.world);
  const year = dateAt(cal, span.from).year;
  const months = monthsBetween(ctx.world, span.from, span.to);
  const through = passedThrough(ctx, api, business, span);
  // Dividends from its stakes (its books keep payouts apart), with what was deducted of each as its stake stood when paid.
  const received = dividendsReceived(ctx.state, business, months);
  const dividends = received.cents;
  let drd = received.deducted;
  drd += (journalTotal(api, ctx, business, months, "dividends", "in") * (t.drd[t.drd.length - 1]?.pct ?? 0)) / 100;
  const carried = carriedInto(ctx.state, business, year, t.giftYears);
  const g = final || span.to >= clockAt(cal, dayIndexOf(cal, year + 1, 1, 1), 0) ? gainsIn(ctx.state, business, year) : null;
  const gains = g ? Math.max(0, g.short + g.long - carried.capLoss) : 0;
  const gifts = journalTotal(api, ctx, business, months, "donations", "out");
  const pre = businessBooks(api, ctx, business, span.from, span.to).profit + through.selfEmployed + through.other + dividends - Math.round(drd) + gains + gifts;
  let nolLeft = carried.nol;
  let carryLeft = carried.gifts.reduce((a, x) => a + x.cents, 0);
  for (const p of PERIOD_MONTHS) {
    const earlier = monthsSpan(ctx, year, p);
    if (earlier.to > span.from) break;
    const used = corporateSpan(ctx, api, business, earlier);
    nolLeft -= used.nolUsed;
    carryLeft -= used.carryUsed;
  }
  const cap = Math.floor((Math.max(0, pre) * t.giftPct) / 100);
  const allowed = Math.min(gifts, cap);
  const carryUsed = Math.max(0, Math.min(carryLeft, cap - allowed));
  const afterGifts = pre - allowed - carryUsed;
  const nolUsed = Math.max(0, Math.min(nolLeft, Math.floor((Math.max(0, afterGifts) * t.nolPct) / 100)));
  const out: CorporateSpan = { taxable: afterGifts - nolUsed, dividends, drd: Math.round(drd), gains, giftsOver: gifts - allowed, carryUsed, nolUsed };
  memo.set(key, out);
  return out;
}

/** A C corporation's taxable profit for a span (`corporateSpan`). */
function corporateProfit(ctx: ReadContext, api: FinanceApi, business: EntityId, span: { from: number; to: number }, final = false): number {
  return corporateSpan(ctx, api, business, span, final).taxable;
}

/**
 * A C corporation's year as its close records it (§26.3): its taxable income and federal tax, period by
 * period as its estimated payments work them out; the net operating loss the year made and what it
 * carries on; its capital loss; its gifts over the cap still within their years (what it used first,
 * oldest first); the dividends it paid; its passive income (dividends, interest, royalties) against its
 * gross income; what its five largest individual holders hold, directly or through other companies;
 * and its earnings and profits, its books' profit after the taxes it paid less what it paid out.
 */
export function corporateYear(api: FinanceApi, ctx: ReadContext, business: EntityId, year: number): CorporateYear | null {
  if (!own(ctx.state.entities, business)) return null;
  const t = corporateTables(ctx);
  const fed = federalCorporatePct(ctx);
  let taxable = 0;
  let tax = 0;
  let nolUsed = 0;
  let carryUsed = 0;
  let over = 0;
  let dividendsIn = 0;
  for (const p of PERIOD_MONTHS) {
    const s = corporateSpan(ctx, api, business, monthsSpan(ctx, year, p));
    taxable += s.taxable;
    tax += Math.round((Math.max(0, s.taxable) * fed) / 100);
    nolUsed += s.nolUsed;
    carryUsed += s.carryUsed;
    over += s.giftsOver;
    dividendsIn += s.dividends;
  }
  const span = monthsSpan(ctx, year, [1, 12]);
  const months = monthsBetween(ctx.world, span.from, span.to);
  const books = businessBooks(api, ctx, business, span.from, span.to);
  const through = passedThrough(ctx, api, business, span);
  const carried = carriedInto(ctx.state, business, year, t.giftYears);
  const g = gainsIn(ctx.state, business, year);
  const net = g.short + g.long;
  const gifts: { year: number; cents: number }[] = [];
  let use = carryUsed;
  for (const x of carried.gifts) {
    const take = Math.min(use, x.cents);
    use -= take;
    if (x.cents - take > 0) gifts.push({ year: x.year, cents: x.cents - take });
  }
  if (over > 0) gifts.push({ year, cents: over });
  const passive = journalTotal(api, ctx, business, months, "dividends", "in") + journalTotal(api, ctx, business, months, "interest", "in") + journalTotal(api, ctx, business, months, "royalties", "in") + dividendsIn;
  const people: number[] = [];
  for (const [holder, paths] of pathsByHolder(ctx, api)) {
    if (!kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "person")) continue;
    const share = paths.filter((p) => p.source === business).reduce((a, p) => a + p.share, 0);
    if (share > 0) people.push(share);
  }
  const top5 = people.sort((a, b) => b - a).slice(0, penaltyTables(ctx).phc.holders).reduce((a, s) => a + s, 0);
  const epStart = earningsAndProfits(ctx.state, business, year);
  const loss = Math.max(0, -taxable);
  return {
    taxable,
    tax,
    loss,
    nol: Math.max(0, carried.nol - nolUsed) + loss,
    capLoss: net >= 0 ? Math.max(0, carried.capLoss - net) : carried.capLoss - net,
    gifts,
    dividends: books.distributions,
    passive,
    gross: books.revenue + dividendsIn + Math.max(0, through.selfEmployed + through.other),
    top5: Math.round(top5 * 100) / 100,
    epStart,
    ep: epStart + books.profit + through.selfEmployed + through.other + dividendsIn + net - books.distributions,
  };
}

/** Whether a company may be in a consolidated return at `clock` (§3.11, Phase 5): taxed as a C corporation then, not exempt, and not yet wound up then (its periods before it was dissolved stay its return's). */
function includable(ctx: ReadContext, id: EntityId, clock: number): boolean {
  const e = own(ctx.state.entities, id);
  if (!e || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, e.kind, COMPANY_KIND) || taxStructureAt(ctx, id, clock) !== "c_corp" || isExempt(ctx, id)) return false;
  const dissolved = dissolvedOn(ctx.state, id);
  if (dissolved === null) return true;
  try {
    const cal = calendarOf(ctx.world);
    return clock < clockAt(cal, dayIndexOfText(cal, dissolved), 0);
  } catch {
    return false;
  }
}

/**
 * The corporations a consolidated return filed by `parent` would include at `clock` (§3.11, Phase 5;
 * IRC section 1504): each company that may be in one of which the parent and those already in hold
 * the finance table's share (80 %) or more of the votes and of the worth, four companies deep; none
 * when the parent may not file one. Each with the group's share of its votes and of its worth.
 */
export function affiliatedGroup(ctx: ReadContext, api: FinanceApi, parent: EntityId, clock: number): { id: EntityId; votes: number; share: number }[] {
  if (!includable(ctx, parent, clock)) return [];
  const need = numOf(objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values).consolidated_return_ownership_pct, CONSOLIDATION_PCT);
  const companies = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => id !== parent && includable(ctx, id, clock));
  const group = new Set<EntityId>([parent]);
  const out: { id: EntityId; votes: number; share: number }[] = [];
  for (let depth = 0; depth < LOOK_THROUGH_DEPTH; depth++) {
    const joined: { id: EntityId; votes: number; share: number }[] = [];
    for (const id of companies) {
      if (group.has(id)) continue;
      // Its votes as a decision counts them: a listed company's public units vote too (§27.10 Listing).
      const votes = votesIn(ctx.state, id);
      let held = 0;
      let share = 0;
      for (const m of group) {
        held += votes[m] ?? 0;
        share += api.shareOf(ctx.state, id, m);
      }
      if (held + 1e-9 >= need && share + 1e-9 >= need) joined.push({ id, votes: held, share });
    }
    if (joined.length === 0) break;
    for (const j of joined) {
      group.add(j.id);
      out.push(j);
    }
  }
  return out;
}

/**
 * Who files each corporation's income tax at `clock` when a parent's consolidated return includes it
 * (§3.11, Phase 5): member to parent, for every parent that elected one (`consolidated_return`) and
 * may file it. A parent another's return includes files through that one: the parents no other's
 * return includes go first (of parents including each other, the first by id), and a corporation
 * belongs to the first return that takes it. Kept for a read pass, by clock.
 */
function consolidatedFilers(ctx: ReadContext, api: FinanceApi, clock: number): ReadonlyMap<EntityId, EntityId> {
  const byClock = passMemo([ctx.state, ctx.world, api], "economy.consolidated", () => new Map<number, Map<EntityId, EntityId>>());
  const known = byClock.get(clock);
  if (known) return known;
  const elected = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => own(ctx.state.entities, id)?.fields.consolidated_return === true && includable(ctx, id, clock));
  const groups = new Map(elected.map((p) => [p, affiliatedGroup(ctx, api, p, clock).map((m) => m.id)]));
  const inside = new Set(elected.filter((p) => elected.some((q) => q !== p && (groups.get(q) ?? []).includes(p))));
  const tops = elected.filter((p) => !inside.has(p));
  const out = new Map<EntityId, EntityId>();
  const filed = new Set<EntityId>();
  for (const p of [...(tops.length > 0 ? tops : elected.slice(0, 1)), ...elected]) {
    if (filed.has(p) || out.has(p)) continue;
    filed.add(p);
    for (const m of groups.get(p) ?? []) if (m !== p && !out.has(m) && !filed.has(m)) out.set(m, p);
  }
  byClock.set(clock, out);
  return out;
}

/** The corporations a parent's consolidated return files for at `clock`, by id; none when it files none, or another's return includes it. */
function membersOf(ctx: ReadContext, api: FinanceApi, parent: EntityId, clock: number): EntityId[] {
  return [...consolidatedFilers(ctx, api, clock)].flatMap(([member, filer]) => (filer === parent ? [member] : [])).sort();
}

/**
 * A consolidated return's tax for a span (§3.11, Phase 5): the federal rate on the group's combined
 * taxable profit, one member's loss offsetting another's profit, and each member's state rate on its
 * own profit, as the states tax each apart.
 */
function consolidatedTax(ctx: ReadContext, api: FinanceApi, parent: EntityId, members: readonly EntityId[], span: { from: number; to: number }, final = false): { profit: number; tax: number } {
  let combined = 0;
  let state = 0;
  for (const b of [parent, ...members]) {
    const profit = corporateProfit(ctx, api, b, span, final);
    combined += profit;
    state += (Math.max(0, profit) * numOf(regionRow(ctx, b).state_income_tax_effective_pct)) / 100;
  }
  return { profit: combined, tax: Math.round((Math.max(0, combined) * federalCorporatePct(ctx)) / 100 + state) };
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
  const scorp = structure === "s_corp" ? sCorpProblem(api, ctx, business, holders.map((o) => o.party)) : null;
  if (scorp !== null) return { code: "scorp_holders", reason: `${labelOf(ctx, business)} can't become an S corporation: ${scorp}` };
  const taxed = taxStructureAt(ctx, business, ctx.state.clock);
  const set = (field: string, value: string): LedgerEvent => ({ type: "set", entity: business, field, value });
  return [set("structure", structure), ...(taxed === structure ? [set("structure_before", ""), set("structure_from", "")] : [set("structure_before", taxed), set("structure_from", nextTaxPeriod(ctx, ctx.state.clock))])];
}

/** The most shareholders an S corporation may have (the finance table's `s_corporation.max_holders`, 100 by default; IRC section 1361(b)(1)(A)). */
function sCorpMax(ctx: Tables): number {
  return numOf(objOf(objOf(ctx.tables.get("economy.finance")?.rows.taxes_federal?.values).s_corporation).max_holders, 100);
}

/** Whether a trust may hold an S corporation's shares: a grantor trust (revocable, its settlor a person), or one whose beneficiaries are all people (as an electing small business trust). */
function eligibleTrust(api: FinanceApi, ctx: ReadContext, trust: EntityId): boolean {
  const f = own(ctx.state.entities, trust)?.fields;
  const settlor = strOf(f?.settlor);
  if (f?.revocable === true && settlor !== "" && api.partyKind(ctx, settlor) === "person") return true;
  const beneficiaries = api.ownersOf(ctx.state, trust).filter((o) => api.shareOf(ctx.state, trust, o.party) > 0);
  return beneficiaries.length > 0 && beneficiaries.every((o) => api.partyKind(ctx, o.party) === "person");
}

/**
 * Why an S corporation can't have these worth holders (§26.3, IRC section 1361), in words: one that
 * isn't a person, an eligible trust or an organization whose exempt status may hold its shares (a
 * 501(c)(3)'s), or more of them than the table's limit; null when it may.
 */
export function sCorpProblem(api: FinanceApi, ctx: ReadContext, business: EntityId, holders: readonly EntityId[]): string | null {
  const all = [...new Set(holders)].filter((h) => h !== business).sort();
  for (const h of all) {
    const kind = api.partyKind(ctx, h);
    if (kind === "person" || (kind === "trust" && eligibleTrust(api, ctx, h)) || holdsSCorpShares(ctx, h)) continue;
    const what = kind === "business" ? "a company" : kind === "trust" ? "a trust that isn't a grantor trust and has beneficiaries other than people" : "an organization whose status can't hold one";
    return `${labelOf(ctx, h)} is ${what}, and an S corporation's shareholders are people, eligible trusts and charities (501(c)(3) organizations)`;
  }
  const max = sCorpMax(ctx);
  return all.length > max ? `it would have ${all.length} shareholders, and an S corporation has at most ${max}` : null;
}

/** An S corporation's check of its holders after a change, as a refusal (`economy.scorp_holders`); null when it may have them, or isn't an S corporation. */
export function sCorpRefusal(api: FinanceApi, ctx: ReadContext, business: EntityId, holders: readonly EntityId[]): Rejection | null {
  if (structureOf(ctx.state, business) !== "s_corp") return null;
  const problem = sCorpProblem(api, ctx, business, holders);
  return problem === null ? null : { code: "scorp_holders", reason: `${labelOf(ctx, business)} is an S corporation: ${problem}` };
}

/**
 * Lint (`economy.scorp_holders`, a warning on its owners): an S corporation the world authors with a
 * holder who can't hold its shares, or more holders than the table allows, each said in words. The
 * acts that change its holders refuse the same (`economy.scorp_holders`).
 */
function sCorpIssues(world: WorldDoc, registry: Registry | undefined): LintIssue[] {
  const is = (kind: string, base: string): boolean => (registry ? kindIs(registry, world, kind, base) : kind === base);
  const statuses = world.tables["economy.exempt"]?.rows ?? {};
  const max = numOf(objOf(objOf(world.tables["economy.finance"]?.rows.taxes_federal?.values).s_corporation).max_holders, 100);
  const holding = (fields: Readonly<JsonObject>): EntityId[] => [...new Set(ownersIn(fields).filter((o) => (o.share ?? 0) > 0 || o.role === "owner" || o.role === "joint").map((o) => o.party))];
  const person = (id: EntityId): boolean => is(own(world.entities, id)?.kind ?? "", "person");
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    if (!e || !is(e.kind, "business") || e.fields.structure !== "s_corp") continue;
    const holders = holding(e.fields).filter((h) => h !== id);
    const path = `entities.${id}.fields.owners`;
    for (const h of holders) {
      const he = own(world.entities, h);
      if (!he || person(h)) continue;
      const status = own(statuses, strOf(he.fields.tax_exempt));
      if (status?.s_corp_holder === true) continue;
      if (is(he.kind, "trust")) {
        const settlor = strOf(he.fields.settlor);
        const beneficiaries = holding(he.fields);
        if ((he.fields.revocable === true && person(settlor)) || (beneficiaries.length > 0 && beneficiaries.every(person))) continue;
      }
      out.push({ severity: "warning", code: "economy.scorp_holders", path, message: `${e.name} is an S corporation, but ${he.name} can't hold its shares: an S corporation's shareholders are people, eligible trusts (a grantor trust, or one whose beneficiaries are all people) and charities (501(c)(3) organizations). Make it a C corporation, or move ${he.name}'s share to someone who may hold it.` });
    }
    if (holders.length > max) out.push({ severity: "warning", code: "economy.scorp_holders", path, message: `${e.name} is an S corporation with ${holders.length} shareholders: it may have at most ${max}.` });
  }
  return out;
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
    if (chain.every((b) => taxStructureAt(ctx, b, now) !== "c_corp" && !isExempt(ctx, b))) return true;
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

/**
 * What an estimated-tax payment on `at` comes to: the period due then, and any of the year before it
 * no payment settled, each with what is left of its tax and its span. A corporation pays for the
 * periods it is taxed as one (§3.13), on its own profit and what passes up to it (§3.11); an exempt
 * one pays none; one a parent's consolidated return includes pays through the parent, unless it pays
 * `alone` (as it goes, §3.13: its own tax on its own profit); and a parent filing one pays the group's
 * tax less what its members paid toward each period, naming them (Phase 5).
 */
function estimatedDue(api: FinanceApi, ctx: ReadContext, party: EntityId, business: boolean, at: number, alone = false): { key: string; cents: number; members: EntityId[]; span: { from: number; to: number } }[] {
  const d = dateAt(calendarOf(ctx.world), at);
  const all = objOf(sliceOf(ctx.state, "economy").estimated);
  const paid = objOf(own(all, party));
  const periods: { key: string; cents: number; members: EntityId[]; span: { from: number; to: number } }[] = [];
  for (const [i, p] of periodsBack(d.year, d.month).entries()) {
    if (i > 0 && own(paid, p.key) !== undefined) continue;
    const span = monthsSpan(ctx, p.year, p.months);
    if (!business) {
      const due = estimatedTax(api, ctx, party, p).cents - numOf(own(paid, p.key));
      if (due > 0) periods.push({ key: p.key, cents: due, members: [], span });
      continue;
    }
    if (taxStructureAt(ctx, party, span.from) !== "c_corp" || isExempt(ctx, party)) continue;
    const filed = consolidatedFilers(ctx, api, span.from).has(party);
    if (filed && !alone) continue;
    const members = filed ? [] : membersOf(ctx, api, party, span.from);
    // As it goes (`alone`), the period under way is its last: its gains so far are charged with it.
    const final = alone && span.from <= ctx.state.clock && ctx.state.clock < span.to;
    const tax = members.length > 0 ? consolidatedTax(ctx, api, party, members, span, final).tax : corporateTax(ctx, party, corporateProfit(ctx, api, party, span, final));
    const due = tax - [party, ...members].reduce((a, m) => a + numOf(own(objOf(own(all, m)), p.key)), 0);
    if (due > 0) periods.push({ key: p.key, cents: due, members, span });
  }
  return periods;
}

/**
 * The income tax a C corporation still owes as it is wound up or merged away (§3.13): every
 * estimated-tax period through today no payment settled, the one under way so far among them, as
 * its next payment would pay it, with the records that payment writes. A corporation a parent's
 * return files pays its own tax on its own profit, since no return files it once it is gone; a parent
 * filing one pays the group's, and each member's periods are credited with the member's own tax on
 * its profit in them (unbooked: the parent paid it), so a member filing alone afterwards pays only
 * the rest. Null where it owes none or business taxes aren't followed for it.
 */
export function taxStillOwed(api: FinanceApi, ctx: ReadContext, business: EntityId): { cents: number; extra: LedgerEvent[] } | null {
  if (!own(ctx.state.entities, business) || !api.feature(ctx, business, "business_tax")) return null;
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, ctx.state.clock);
  // The due date of the period today falls in: its payment settles that period and every one before it left unpaid.
  const due = ESTIMATE_DUE.find((x) => x.months.includes(d.month));
  if (!due) return null;
  const periods = estimatedDue(api, ctx, business, true, clockAt(cal, dayIndexOf(cal, due.lastYear ? d.year + 1 : d.year, due.month, 1), 0), true);
  const cents = periods.reduce((a, p) => a + p.cents, 0);
  if (cents <= 0) return null;
  const members = [...new Set(periods.flatMap((p) => p.members))].sort();
  const credited: LedgerEvent[] = members.map((m) => ({ type: "economy.estimated_tax", data: { party: m, periods: periods.filter((p) => p.members.includes(m)).map((p) => ({ key: p.key, cents: corporateTax(ctx, m, corporateProfit(ctx, api, m, p.span, p.span.from <= ctx.state.clock && ctx.state.clock < p.span.to)) })) } }));
  return { cents, extra: [{ type: "economy.estimated_tax", data: { party: business, periods: periods.map((p) => ({ key: p.key, cents: p.cents })), business: true } }, ...credited] };
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
 * collected and remitted; withholding and its own share of payroll tax; its unemployment taxes,
 * accrued and paid; income tax paid; property tax; gifts received); the sales tax it holds; how its
 * income is taxed, a pass-through's to the people at the top with their shares (anyone the viewer
 * can't see as "someone", the organizations that pay none, and the exempt ones), an exempt
 * organization's not at all; a corporation's income tax so far, its consolidated return or the parent
 * whose return files it; its unemployment taxes' rates and its exempt status (for the GM, with the
 * statuses the world's table offers, unless it's a household or the party, which hold none); what
 * falls due next; a change of structure waiting; and what the viewer may do.
 */
export function taxesView(api: FinanceApi, ctx: ReadContext, org: EntityId, viewer: EntityId | null): TaxesView & TaxesExtra {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const year = dateAt(cal, now).year;
  const company = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", "business");
  const exempt = exemptStatusOf(ctx, org);
  const accounts = api.accountsOf(ctx, org, "worth");
  const years: TaxYearView[] = [year, year - 1].map((y) => {
    const out: TaxYearView = { year: y, salesCollected: 0, salesRemitted: 0, withheld: 0, employerShare: 0, futa: 0, futaPaid: 0, suta: 0, sutaPaid: 0, income: 0, property: 0, donations: 0 };
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
    return { ...out, withheld: payroll.withheld, employerShare: payroll.employer, ...unemploymentTotals(ctx.state, org, y), donations: donationsReceived(ctx.state, org, y) };
  });
  const corporate = company && exempt === null && taxStructureAt(ctx, org, now) === "c_corp";
  const yearSpan = { from: clockAt(cal, dayIndexOf(cal, year, 1, 1), 0), to: now + 1 };
  const named = (id: EntityId, unseen: string): string => (hiddenFrom(ctx, viewer, id) ? unseen : labelOf(ctx, id));
  const taxedTo: TaxesView["taxedTo"] = [];
  const untaxed: TaxesView["untaxed"] = [];
  const exemptHolders: TaxesView["exemptHolders"] = [];
  if (company && !corporate && exempt === null) {
    for (const [holder, paths] of pathsByHolder(ctx, api)) {
      const share = paths.filter((p) => p.source === org && p.via.every((b) => taxStructureAt(ctx, b, now) !== "c_corp" && !isExempt(ctx, b))).reduce((a, p) => a + p.share, 0);
      if (share <= 0) continue;
      const kind = own(ctx.state.entities, holder)?.kind ?? "";
      const name = named(holder, "someone");
      // A trust pays on its share as trusts are taxed (§26.3), unless it is exempt; a grantor trust's is its settlor's, listed under them.
      const trust = api.partyKind(ctx, holder) === "trust";
      if (trust && grantorOf(ctx, holder) !== null) continue;
      if (kindIs(ctx.registry, ctx.world, kind, "person") || (trust && !isExempt(ctx, holder))) taxedTo.push({ name, share });
      else if (isExempt(ctx, holder)) exemptHolders.push({ name, share });
      else if (!kindIs(ctx.registry, ctx.world, kind, "business")) untaxed.push({ name, share });
    }
    taxedTo.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  }
  // Its consolidated return, or the parent whose return files its tax (Phase 5).
  const values = api.feature(ctx, org, "business_tax");
  const filer = corporate ? consolidatedFilers(ctx, api, now).get(org) : undefined;
  const members = corporate && filer === undefined ? membersOf(ctx, api, org, now) : [];
  const elected = own(ctx.state.entities, org)?.fields.consolidated_return === true;
  const group = corporate && filer === undefined ? affiliatedGroup(ctx, api, org, now) : [];
  const listed = elected ? group.filter((g) => members.includes(g.id)) : group;
  const together = members.length > 0 && values ? consolidatedTax(ctx, api, org, members, yearSpan, true) : null;
  const pct = (n: number): number => Math.round(n * 100) / 100;
  const consolidation: ConsolidationView | null = corporate && filer === undefined && (elected || listed.length > 0) ? { elected, members: listed.map((g) => ({ name: named(g.id, "a company"), votes: pct(g.votes), share: pct(g.share) })), profit: together?.profit ?? null, tax: together?.tax ?? null } : null;
  const due: TaxesView["due"] = [];
  for (const flow of api.flows(ctx)) {
    const mine = [`salestax:${org}`, `esttax:${org}`, `futa:${org}`, `suta:${org}`].includes(flow.id) || (flow.id.startsWith("property_tax:") && flow.link !== undefined && api.shareOf(ctx.state, flow.link, org) > 0);
    if (!mine || flow.status !== "active") continue;
    const at = api.occurrences(ctx, flow.schedule, now, now + 400 * MINUTES_PER_DAY, flow.start)[0];
    if (at === undefined) continue;
    const cents = flow.id === `salestax:${org}` ? Math.max(0, payablesOf(ctx.state, org).sales_tax) : flow.id === `esttax:${org}` ? estimatedDue(api, ctx, org, true, at).reduce((a, p) => a + p.cents, 0) : flow.id === `futa:${org}` ? unemploymentDueAt(ctx, org, "futa", at) : flow.id === `suta:${org}` ? unemploymentDueAt(ctx, org, "suta", at) : null;
    // A member's own corporate tax is its parent's return's to pay.
    if (flow.id === `esttax:${org}` && filer !== undefined && cents === 0) continue;
    due.push({ label: flow.label, cents, at: dayWords(ctx, at) });
  }
  const f = own(ctx.state.entities, org)?.fields;
  const before = strOf(f?.structure_before);
  const from = strOf(f?.structure_from);
  const may = viewer === null ? null : mayAct(ctx, viewer, org, "org.govern");
  // The statuses the GM may give it: none for a household or the party, which hold none.
  const type = viewer === null ? orgTypeOf(ctx, org) : null;
  const statusable = type !== null && type !== "household" && type !== "party";
  const consolidate = !corporate || !values ? "Only a C corporation paying business taxes files a consolidated return" : filer !== undefined ? `${named(filer, "Its parent")}'s consolidated return files its income tax` : may !== null && !may.ok ? may.reason : null;
  return {
    income: exempt ? "exempt" : company ? (corporate ? "corporate" : "owners") : null,
    years,
    salesHeld: company ? Math.max(0, payablesOf(ctx.state, org).sales_tax) : 0,
    incomeSoFar: corporate && values && filer === undefined ? (together?.tax ?? corporateTax(ctx, org, corporateProfit(ctx, api, org, yearSpan, true))) : null,
    taxedTo,
    untaxed,
    exemptHolders,
    due,
    pending: company && before !== "" && from !== "" && taxStructureAt(ctx, org, now) !== structureOf(ctx.state, org) ? { structure: structureOf(ctx.state, org), from: dayWords(ctx, clockAt(cal, dayIndexOfText(cal, from.slice(0, 10)), 0)) } : null,
    unemployment: unemploymentView(api, ctx, org),
    exempt,
    statuses: statusable ? exemptStatuses(ctx) : null,
    consolidation,
    filedBy: filer !== undefined ? named(filer, "its parent") : null,
    acts: viewer === null ? null : { consolidate },
    ...taxesExtra(api, ctx, org, corporate && values, viewer),
  };
}

/**
 * What Taxes adds for the year close (§26.3): a C corporation's penalty taxes (last year's as its
 * close and consent dividends read them, and its earnings and profits now) and what it carries in; a
 * private foundation's payout, grants and taxes; and an S corporation's holders against its limit.
 */
function taxesExtra(api: FinanceApi, ctx: ReadContext, org: EntityId, corporate: boolean, viewer: EntityId | null): TaxesExtra {
  const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
  const last = corporate ? penaltyTaxFor(ctx, org, year - 1) : null;
  const carried = corporate ? carriedInto(ctx.state, org, year, corporateTables(ctx).giftYears) : null;
  const gifts = carried?.gifts.reduce((a, g) => a + g.cents, 0) ?? 0;
  const terms = foundationTerms(ctx, org);
  const progress = terms ? foundationProgress(api, ctx, org) : null;
  const close = terms ? closedYear(ctx.state, org, year - 1) : null;
  const holders = structureOf(ctx.state, org) === "s_corp" && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", "business") ? [...new Set(api.ownersOf(ctx.state, org).filter((o) => api.shareOf(ctx.state, org, o.party) > 0).map((o) => o.party))] : null;
  const problem = holders ? sCorpProblem(api, ctx, org, holders) : null;
  return {
    penalty: corporate ? { on: penaltyTaxesOn(ctx), last: last ? { ...last, paid: taxPaidFor(ctx.state, "penalty_taxes", org, year - 1) !== null } : null, ep: earningsAndProfits(ctx.state, org, year) } : null,
    carry: carried && (carried.nol > 0 || carried.capLoss > 0 || gifts > 0) ? { nol: carried.nol, capitalLoss: carried.capLoss, gifts } : null,
    foundation:
      terms && progress
        ? {
            ...terms,
            year: progress.year,
            assets: progress.assets,
            payoutSoFar: progress.payoutSoFar,
            granted: progress.granted,
            lastShortfall: progress.lastShortfall,
            leftOfLast: progress.leftOfLast,
            last: close ? { year: year - 1, assets: numOf(close.assets), payout: numOf(close.payout), grants: numOf(close.grants), shortfall: numOf(close.shortfall), nii: numOf(close.nii), excise: numOf(close.excise), undistributed: numOf(close.undistributed), tax: numOf(close.tax) } : null,
            due: foundationTaxFor(ctx, org, year - 1)?.cents ?? null,
          }
        : null,
    // A hidden holder's eligibility names them only to the GM.
    scorp: holders ? { holders: holders.length, max: sCorpMax(ctx), problem: problem !== null && viewer !== null && holders.some((h) => hiddenFrom(ctx, viewer, h)) ? "One of its holders can't hold an S corporation's shares" : problem } : null,
  };
}

/** Electing (or ending) a consolidated return (§3.11, Phase 5, `economy.consolidate`), by whoever governs the parent (`org.govern`); with no `by` (the GM), no power asked. Its History line names the corporations it includes. */
function consolidateEvents(api: FinanceApi, ctx: EffectContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const org = strOf(a.org);
  const by = strOf(a.by);
  const said = typeof a.elect === "string" ? a.elect.trim().toLowerCase() : a.elect;
  const elect = !(said === false || said === "no" || said === "off" || said === "false" || said === "stop");
  if (!own(ctx.state.entities, org) || isGone(ctx.state, org) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", COMPANY_KIND)) return { code: "not_company", reason: `${labelOf(ctx, org)} isn't a company` };
  if (by !== "" && by !== org) {
    const may = mayAct(ctx, by, org, "org.govern");
    if (!may.ok) return { code: "not_allowed", reason: may.reason };
  }
  if (elect && (structureOf(ctx.state, org) !== "c_corp" || isExempt(ctx, org))) return { code: "not_corporation", reason: `Only a C corporation that pays income tax files a consolidated return; ${labelOf(ctx, org)} is ${isExempt(ctx, org) ? "exempt" : (STRUCTURE_WORDS[structureOf(ctx.state, org)] ?? structureOf(ctx.state, org))}` };
  if ((own(ctx.state.entities, org)?.fields.consolidated_return === true) === elect) return { code: "no_change", reason: `${labelOf(ctx, org)} ${elect ? "already files" : "doesn't file"} a consolidated return` };
  const members = affiliatedGroup(ctx, api, org, ctx.state.clock).map((m) => m.id);
  const text = elect ? `Elected to file one consolidated return${members.length > 0 ? ` with ${members.map((m) => labelOf(ctx, m)).join(", ")}` : ""}` : "Stopped filing a consolidated return";
  const line = by !== "" && by !== org ? (optionalService(ctx, "orgs.acted")?.(ctx, { org, by, power: "org.govern", text, names: members }) ?? []) : [];
  return [{ type: "set", entity: org, field: "consolidated_return", value: elect }, ...line];
}

/** What the taxes module adds to a business: what a change of structure leaves waiting for the next estimated-tax period (§3.13), and its consolidated return election (§3.11, Phase 5). */
const TAX_FIELDS: Record<string, FieldDef> = {
  structure_before: { type: "text", label: "Taxed as, until the change of structure (sole_proprietorship, partnership, llc, s_corp or c_corp)", domain: "money", level: 4 },
  structure_from: { type: "text", label: "Its structure is taxed from (YYYY-MM-DD)", domain: "money", level: 4 },
  consolidated_return: { type: "bool", label: "Files one consolidated federal return with the corporations it holds 80% or more of (an election)", domain: "money", level: 3 },
  opening_ep: { type: "money", label: "Earnings and profits it had kept when the story begins (the accumulated earnings tax's credit reads it)", domain: "money", level: 4 },
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
        // A corporation, and one that was until its change of structure is taxed (§3.13); never an exempt one, nor one wound up, which pays what it owes as it winds up.
        else if (kindIs(ctx.registry, ctx.world, e.kind, "business") && dissolvedOn(ctx.state, id) === null && !isExempt(ctx, id) && (structureOf(ctx.state, id) === "c_corp" || strOf(e.fields.structure_before) === "c_corp")) out.push(estimateFlow(`esttax:${id}`, "Corporate income tax", operatingAccount(api, ctx, id) ?? id, "tax:federal", id, true));
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
    // A parent's consolidated return files its members' periods too: each marked paid at nothing, so their own payments leave them alone (Phase 5).
    const members = [...new Set(periods.flatMap((p) => p.members))].sort();
    const filed: LedgerEvent[] = members.map((m) => ({ type: "economy.estimated_tax", data: { party: m, periods: periods.filter((p) => p.members.includes(m)).map((p) => ({ key: p.key, cents: 0 })), business: true } }));
    const memo = business ? (members.length > 0 ? "Corporate income tax, consolidated return" : "Corporate income tax") : "Estimated tax";
    return { cents, ...(lines ? { lines } : {}), memo, kind: "payment", category: business ? "business_tax" : "tax", extra: [{ type: "economy.estimated_tax", data: { party, periods: periods.map((p) => ({ key: p.key, cents: p.cents })), ...(business ? { business: true } : {}) } }, ...filed] };
  });
  core.query("economy.ordinary_income", (ctx, person, year) => ordinaryIncome(api, ctx, person, year));
  core.query("economy.income_tax", (ctx, filing, taxable) => bracketTax(federalTables(ctx).brackets[filing], taxable));
  core.service("economy.restructure", (ctx, business, structure) => restructureEvents(api, ctx, business, structure));
  core.service("economy.scorp_holders", (ctx, business, holders) => sCorpRefusal(api, ctx, business, holders));
  core.lint({ code: "economy.scorp_holders", check: (world, registry) => sCorpIssues(world, registry) });
  // The year close, penalty taxes, consent dividends and a private foundation's money read a corporation's year from here.
  registerYearClose(r, { corporateYear: (ctx, business, year) => corporateYear(api, ctx, business, year), corporation: (ctx, business, clock) => taxStructureAt(ctx, business, clock) === "c_corp" && !isExempt(ctx, business), deductionPct: (ctx, receiver, payer) => dividendDeductionPct(api, ctx, receiver, payer) });
  // What a person's deductible gifts saved them, refunded each April at the top level (Phase 5).
  r.flows({
    id: "donation_refund",
    flows: (ctx) =>
      deductibleDonors(ctx.state).flatMap((p): Flow[] =>
        own(ctx.state.entities, p) && !isGone(ctx.state, p) && api.feature(ctx, p, "tax_brackets")
          ? [{ id: `donation_refund:${p}`, label: "Tax saved by donations", kind: "tax", from: "tax:federal", to: p, amount: { provider: "donation_refund", args: { person: p } }, schedule: { every: "year", months: [4], days: [15], roll: "after" }, shortfall: "skip", category: "taxes", link: p, status: "active", source: "donations" }]
          : [],
      ),
  });
  r.amount("donation_refund", (ctx, flow, at): FlowPosting | null => {
    const person = strOf(("provider" in flow.amount ? objOf(flow.amount.args) : {}).person, flow.link ?? "");
    if (!own(ctx.state.entities, person) || !api.feature(ctx, person, "tax_brackets")) return null;
    const year = dateAt(calendarOf(ctx.world), at).year - 1;
    const saved = charitableSaving(api, ctx, person, year);
    const deposit = api.depositAccount(ctx, person);
    if (saved <= 0 || !deposit) return null;
    return { cents: saved, lines: [{ account: api.outside("tax:federal"), amount: -saved }, { account: deposit, amount: saved }], memo: `Tax saved by ${year} donations`, kind: "refund", category: "taxes" };
  });
  // A consolidated return (Phase 5): elected or ended by whoever governs the parent, as a turn; a GM effect too.
  core.effect({ type: "economy.consolidate", args: ["org", "elect?", "by?"], gm: true, resolve: (a, ctx) => consolidateEvents(api, ctx, a) });
  core.action({
    id: FINANCE_ACTIONS.consolidate,
    label: "File a consolidated return",
    description: "Elect, or stop, for a C corporation you govern, to file one federal income tax return with the corporations it holds 80% or more of (by votes and by worth): their profits and losses offset, and it pays the group's tax.",
    pack: "economy",
    params: { org: { type: "ref", ref: COMPANY_KIND, label: "The parent company" }, elect: { type: "text", optional: true, label: "yes to file one (the default), no to stop" } },
    requires: ["level.money >= 3", "may(self, org, 'org.govern')"],
    outcomes: { default: [{ type: "economy.consolidate", args: { org: "org", elect: "=params.elect", by: "actor" } }] },
    duration: "15",
    lexicon: ["file a consolidated return", "file one return for the group", "consolidate our taxes", "stop filing a consolidated return"],
    observable: "signs a tax election",
  });
  // Taxes on an organization's page (§4.4, §4.7), behind `money.view`: a company's from Money 3; an exempt organization's from Money 3; any other employer's at Money 4; and for the GM, any organization that may hold an exempt status, from Money 3, so GM → Orgs can give it one.
  core.orgSection({
    id: "taxes",
    label: "Taxes",
    power: "money.view",
    build: (ctx, org, viewer) => {
      // A group's Money level is its members' highest, as its payroll's is (ORG-SPEC §3.1).
      const level = moneyLevel(ctx, org);
      const company = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", "business");
      const kept = (slice: string): boolean => Object.keys(objOf(own(objOf(sliceOf(ctx.state, "economy")[slice]), org))).length > 0;
      const employs = !company && level >= 4 && (jobsAt(ctx, org).length > 0 || kept("payroll_taxes") || kept("unemployment"));
      const type = viewer === null ? orgTypeOf(ctx, org) : null;
      const statusable = level >= 3 && (type === "group" || type === "trust");
      return (company && level >= 3) || (level >= 3 && exemptStatusOf(ctx, org) !== null) || employs || statusable ? (taxesView(api, ctx, org, viewer) as unknown as JsonValue) : null;
    },
  });
}

/** The share of a dividend a corporation deducts from a payer as things stand now (§26.3, IRC section 243): all of it within its consolidated return, else by its stake. */
export function dividendDeductionPct(api: FinanceApi, ctx: ReadContext, receiver: EntityId, payer: EntityId): number {
  return drdPct(ctx, api, corporateTables(ctx), receiver, payer, ctx.state.clock);
}
