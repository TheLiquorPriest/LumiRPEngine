// Work and pay (DESIGN §26.1, ORG-SPEC §3.7): jobs, the work they count, paychecks, payroll as
// flows, and the people who decide them.
//
// A job is a `job` entity: one worker's employment by a party in the world (a business, a household
// or any other organization, the party, a person), which pays from its payroll account or its own,
// or by an outside employer, which pays from the outside economy. Pay follows the work. Salary and a
// stipend are paid by the pay period, prorated at the start and end of employment and outside the
// job's season. Hourly and per-shift pay count the hours and shifts in the worker's work commitments
// (castlife), the shifts the player turned up for, or the hours a week the job sets, thinned by its
// weeks a year. Commission is a share of their sales at the business, and tips come by the hour.
//
// Each job derives one payroll flow, so paydays run at their instants, roll off days that aren't
// business days and fall short like any flow. This module works out each paycheck: gross,
// withholding (`taxes.ts`), deductions, the net routed across the worker's accounts, and what the
// employer adds. A paycheck covers the work since the last one, so one that can't be paid is paid
// with the next, and one after a change of pay schedule pays no day twice.
//
// Whoever acts for an employer other than themselves needs its staff powers (hiring, letting go,
// pay, hours and leave) or the power to appoint, within the position's scope (`mayAct`), and never
// puts their own on a payroll they only run (`payrollProblem`).

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import type { EntityDef } from "../../../shared/world";
import { PARTY_KINDS, PAY_BASES, PAY_EVERY, type Deduction, type Flow, type FlowSchedule, type FlowSplit, type JobFields, type JobView, type PayBasis, type PayEvery } from "../../../shared/finance";
import { hashParts, opaqueId } from "../../../shared/hash";
import type { OrgMember, OrgPower } from "../../../shared/org";
import { calendarOf, clockAt, dateAt, dayIndexOf, dayIndexOfText, formatClock, MINUTES_PER_DAY, type Calendar } from "../../../engine/calendar";
import { labelOf, numOf, objOf, optionalQuery, optionalService, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "../../../engine/scope";
import { businessAt, jobsAt, mayAct, orgPlaces, orgTypeOf, placesOf, positionsBelow, positionsOf } from "../../../engine/org";
import { COMPANY_KIND, GROUP_KIND, type MembershipContext } from "../../../engine/selector";
import { placeVisit } from "../../../engine/seen";
import type { WorldState } from "../../../engine/state";
import { minutesBetween } from "../../../engine/world-state";
import { addToBooks, businessBooks, monthOf, monthsBetween, operatingAccount, totalsOf } from "./books";
import { hiddenFrom, moneyLevel, orgRecord, outsideHidden, outsideName, shownLabel } from "./model";
import type { FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { addPay, addPayrollTaxes, payTaxes, taxTotal, yearPay, type PayTaxes } from "./taxes";

export const JOB_KIND = "job";

export type HoursSource = NonNullable<JobFields["hours"]>;
const HOURS_SOURCES: readonly HoursSource[] = ["scheduled", "attended", "contract"];
type JobStatus = NonNullable<JobFields["status"]>;
type Roll = NonNullable<FlowSchedule["roll"]>;

/** A job as payroll reads it: every field settled from the entity, its occupation and the defaults. */
export interface Job {
  id: EntityId;
  worker: EntityId;
  /** The employer as written: a party's id, a place, or an outside employer's name. */
  employer: string;
  /** The employer when it is a party in the world (any kind; a place names the business trading there), which pays from its own accounts. */
  party: EntityId | null;
  /** The employer when it is a company: its books keep the payroll. */
  business: EntityId | null;
  title: string;
  occupation: string;
  basis: PayBasis;
  rate: number;
  /** Null: the worker's commitments when they have a routine at the job, else the hours a week. */
  hours: HoursSource | null;
  hoursPerWeek: number;
  shiftsPerWeek: number;
  weeksPerYear: number;
  commissionPct: number;
  tipsPerHour: number;
  /** Null: work that isn't paid. */
  every: PayEvery | null;
  /** The payday weekday of a weekly or biweekly cycle with no anchor (0 is Sunday). */
  weekday: number;
  /** When weekly and biweekly cycles count from (a day index). */
  anchor: number | null;
  /** The cycle of a custom schedule (`pay_unit`, …), and the roll every cycle takes. */
  custom: FlowSchedule;
  roll: Roll;
  /** First and last day employed (day indexes), inclusive. */
  start: number | null;
  end: number | null;
  /** The season as month×100+day, inclusive; it may wrap the new year. */
  season: { from: number; to: number } | null;
  deductions: Deduction[];
  splits: FlowSplit[];
  status: JobStatus;
  /** The places whose commitments count as this job's work. */
  workplaces: PlaceId[];
  contractor: boolean;
  ficaExempt: boolean;
}

function monthDay(text: string): number | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? month * 100 + day : null;
}

function dayOfField(cal: Calendar, v: JsonValue | undefined): number | null {
  if (typeof v !== "string" || v === "") return null;
  try {
    return dayIndexOfText(cal, v);
  } catch {
    return null;
  }
}

function numbers(v: JsonValue | undefined): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
}

function strings(v: JsonValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

function deductionsOf(v: JsonValue | undefined): Deduction[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): Deduction[] => {
    const d = objOf(raw);
    const cents = typeof d.cents === "number" && d.cents > 0 ? Math.round(d.cents) : undefined;
    const pct = typeof d.pct === "number" && d.pct > 0 ? Math.min(100, d.pct) : undefined;
    if (cents === undefined && pct === undefined) return [];
    const kind = d.kind === "retirement" || d.kind === "health" ? d.kind : "other";
    return [{ label: strOf(d.label, "Deduction"), kind, pretax: d.pretax === true, ...(cents !== undefined ? { cents } : {}), ...(pct !== undefined ? { pct } : {}), ...(typeof d.match_pct === "number" && d.match_pct > 0 ? { match_pct: d.match_pct } : {}), ...(typeof d.to === "string" && d.to !== "" ? { to: d.to } : {}) }];
  });
}

function splitsOf(v: JsonValue | undefined): FlowSplit[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): FlowSplit[] => {
    const s = objOf(raw);
    const to = strOf(s.to);
    const cents = typeof s.cents === "number" && s.cents > 0 ? Math.round(s.cents) : undefined;
    const pct = typeof s.pct === "number" && s.pct > 0 ? Math.min(100, s.pct) : undefined;
    return to === "" || (cents === undefined && pct === undefined) ? [] : [{ to, ...(cents !== undefined ? { cents } : {}), ...(pct !== undefined ? { pct } : {}) }];
  });
}

/** The occupation's typical pay frequency as a job's; null for work that isn't paid. */
function everyOfOccupation(freq: string): PayEvery | null {
  if (freq === "weekly_gig") return "weekly";
  if (freq === "none") return null;
  return (PAY_EVERY as readonly string[]).includes(freq) ? (freq as PayEvery) : "biweekly";
}

/** A job's title: its own, else its occupation's (the job's, else its worker's), else "Job". */
function titleOf(ctx: Pick<ReadContext, "state" | "tables">, f: Readonly<JsonObject>): string {
  const occupation = strOf(f.occupation, strOf(own(ctx.state.entities, strOf(f.worker))?.fields.occupation));
  return strOf(f.title, strOf(rowOf(ctx, "economy.occupations", occupation)?.title, "Job"));
}

/** A job entity read whole, or null when it isn't one, or it or its worker is gone. */
export function readJob(ctx: Pick<ReadContext, "registry" | "world" | "state" | "tables">, id: EntityId): Job | null {
  const e = own(ctx.state.entities, id);
  if (!e || !kindIs(ctx.registry, ctx.world, e.kind, JOB_KIND) || isGone(ctx.state, id)) return null;
  const f = e.fields;
  const worker = strOf(f.worker);
  if (!own(ctx.state.entities, worker) || isGone(ctx.state, worker)) return null;
  const cal = calendarOf(ctx.world);
  const occupation = strOf(f.occupation, strOf(own(ctx.state.entities, worker)?.fields.occupation));
  const occ = rowOf(ctx, "economy.occupations", occupation) ?? {};
  const employer = strOf(f.employer);
  // An employer named by its place (as worlds wrote it before businesses were parties) is the business trading there.
  const named = employer !== "" && !isGone(ctx.state, employer) ? own(ctx.state.entities, employer) : undefined;
  const party = named ? (PARTY_KINDS.some((k) => kindIs(ctx.registry, ctx.world, named.kind, k)) ? employer : null) : own(ctx.world.places, employer) ? businessAt(ctx, employer) : null;
  const business = party !== null && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, party)?.kind ?? "", COMPANY_KIND) ? party : null;
  const freq = strOf(occ.pay_frequency);
  const basis: PayBasis = (PAY_BASES as readonly string[]).includes(strOf(f.basis)) ? (strOf(f.basis) as PayBasis) : freq === "semimonthly" || freq === "monthly" ? "salary" : "hourly";
  // A tipped occupation's own pay is the tipped cash wage, and its tips the rest of the median,
  // whatever rate the job sets: a raise, or a hire at a stated wage, keeps the tips.
  const tipped = occ.tipped === true;
  const median = numOf(occ.median_cents_per_h);
  const cashWage = numOf(occ.tipped_cash_wage_cents_per_h, median);
  const defaults: Record<PayBasis, number> = { salary: numOf(occ.typical_earnings_cents_per_year), hourly: tipped ? cashWage : median, per_shift: Math.round(median * 8), commission: 0, tips: Math.max(0, median - cashWage), stipend: 0 };
  const hoursPerWeek = numOf(f.hours_per_week, numOf(occ.typical_hours_per_week, 40));
  const from = monthDay(strOf(f.season_from));
  const to = monthDay(strOf(f.season_to));
  const workplace = strOf(f.workplace);
  const workplaces = own(ctx.world.places, workplace) ? [workplace] : business ? placesOf(ctx, business) : party ? orgPlaces(ctx, party) : own(ctx.world.places, employer) ? [employer] : [];
  const status: JobStatus = f.status === "leave" || f.status === "ended" ? f.status : "active";
  const every = (PAY_EVERY as readonly string[]).includes(strOf(f.pay_every)) ? (strOf(f.pay_every) as PayEvery) : everyOfOccupation(freq);
  const roll: Roll = f.pay_roll === "after" || f.pay_roll === "none" ? f.pay_roll : "before";
  const unit = f.pay_unit === "day" || f.pay_unit === "week" || f.pay_unit === "month" || f.pay_unit === "year" ? f.pay_unit : "month";
  const start = dayOfField(cal, f.start);
  const weekday = Math.round(numOf(f.pay_weekday, 5));
  const custom: FlowSchedule = { every: unit, interval: Math.max(1, Math.round(numOf(f.pay_interval, 1))), ...(numbers(f.pay_weekdays).length > 0 ? { weekdays: numbers(f.pay_weekdays) } : unit === "week" ? { weekdays: [weekday] } : {}), ...(numbers(f.pay_days).length > 0 ? { days: numbers(f.pay_days) } : {}), ...(numbers(f.pay_months).length > 0 ? { months: numbers(f.pay_months) } : {}), ...(strings(f.pay_except).length > 0 ? { except: strings(f.pay_except) } : {}) };
  return {
    id,
    worker,
    employer,
    party,
    business,
    title: titleOf(ctx, f),
    occupation,
    basis,
    rate: Math.max(0, Math.round(numOf(f.rate, defaults[basis]))),
    hours: (HOURS_SOURCES as readonly string[]).includes(strOf(f.hours)) ? (strOf(f.hours) as HoursSource) : null,
    hoursPerWeek,
    shiftsPerWeek: numOf(f.shifts_per_week, hoursPerWeek / 8),
    weeksPerYear: Math.min(52, Math.max(0, numOf(f.weeks_per_year, numOf(occ.weeks_per_year, 52)))),
    commissionPct: numOf(f.commission_pct),
    tipsPerHour: numOf(f.tips_per_hour, tipped && basis === "hourly" ? Math.max(0, median - cashWage) : 0),
    every,
    weekday,
    anchor: dayOfField(cal, f.pay_anchor) ?? (start === null ? null : start + ((((weekday - dateAt(cal, clockAt(cal, start, 0)).weekday) % 7) + 7) % 7)),
    custom,
    roll,
    start,
    end: dayOfField(cal, f.end),
    season: from !== null && to !== null ? { from, to } : null,
    deductions: deductionsOf(f.deductions),
    splits: splitsOf(f.splits),
    status,
    workplaces,
    contractor: typeof f.contractor === "boolean" ? f.contractor : occ.self_employed === true,
    ficaExempt: occ.fica_exempt === true,
  };
}

/** Every job entity still in the world, by id. */
export function jobIds(ctx: Pick<ReadContext, "registry" | "world" | "state">): EntityId[] {
  return Object.keys(ctx.state.entities)
    .filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", JOB_KIND) && !isGone(ctx.state, id))
    .sort();
}

/** Every job read whole, by id. */
export function allJobs(ctx: Pick<ReadContext, "registry" | "world" | "state" | "tables">): Job[] {
  return jobIds(ctx).flatMap((id) => readJob(ctx, id) ?? []);
}

/**
 * Those working for an organization (ORG-SPEC §3.2, §3.7), a membership row each: every job in force
 * there, with its title, the position it holds and since when. The economy adds them to every
 * employer: a company's staff are its members, anyone else's work for it without belonging.
 */
export function staffRows(ctx: MembershipContext, org: EntityId): OrgMember[] {
  const tables: ReadContext["tables"] = { get: (table) => own(ctx.world.tables, table) };
  return jobsAt(ctx, org).flatMap((id): OrgMember[] => {
    const f = own(ctx.state.entities, id)?.fields ?? {};
    const worker = strOf(f.worker);
    return worker === "" ? [] : [{ who: worker, how: "staff", job: id, title: titleOf({ ...ctx, tables }, f), ...(strOf(f.position) !== "" ? { position: strOf(f.position) } : {}), ...(strOf(f.start) !== "" ? { since: strOf(f.start) } : {}) }];
  });
}

/** Whether the job counts a day: inside its employment and its season. */
export function workingDay(cal: Calendar, job: Pick<Job, "start" | "end" | "season">, day: number): boolean {
  if (job.start !== null && day < job.start) return false;
  if (job.end !== null && day > job.end) return false;
  if (!job.season) return true;
  const d = dateAt(cal, clockAt(cal, day, 0));
  const md = d.month * 100 + d.day;
  return job.season.from <= job.season.to ? md >= job.season.from && md <= job.season.to : md >= job.season.from || md <= job.season.to;
}

function workingDays(cal: Calendar, job: Job, fromDay: number, toDay: number): number {
  let n = 0;
  for (let d = fromDay; d < toDay; d++) if (workingDay(cal, job, d)) n++;
  return n;
}

function dateText(cal: Calendar, day: number): string {
  const d = dateAt(cal, clockAt(cal, day, 0));
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- the pay cycle

/** When a gig worker's day pays out: the shifts that ended that day. */
const PER_JOB_AT = "21:00";

/** The job's pay cycle as a flow schedule, without its roll: the paydays as scheduled. */
function cycleOf(cal: Calendar, job: Job): FlowSchedule {
  switch (job.every) {
    case "weekly":
    case "biweekly":
      return { every: "week", interval: job.every === "weekly" ? 1 : 2, weekdays: [job.anchor === null ? job.weekday : dateAt(cal, clockAt(cal, job.anchor, 0)).weekday] };
    case "semimonthly":
      return { every: "month", days: job.custom.days ?? [15, -1] };
    case "monthly":
      return { every: "month", days: [job.custom.days?.[0] ?? -1] };
    case "per_job":
      return { every: "day", at: PER_JOB_AT };
    default:
      return { ...job.custom };
  }
}

/** The payroll flow's schedule: the cycle with the job's roll (a gig's day pays as it is). */
export function payFlowSchedule(ctx: Pick<ReadContext, "world">, job: Job): FlowSchedule {
  const cycle = cycleOf(calendarOf(ctx.world), job);
  return { ...cycle, roll: job.every === "per_job" ? "none" : job.roll };
}

/** Scheduled paydays a year: how a paycheck annualizes for withholding. */
export function periodsPerYear(ctx: ReadContext, api: FinanceApi, job: Job): number {
  switch (job.every) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
    case "per_job":
      return 260;
    default: {
      const cal = calendarOf(ctx.world);
      const start = clockAt(cal, job.anchor ?? 0, 0);
      return Math.max(1, api.occurrences(ctx, cycleOf(cal, job), start, start + 365 * MINUTES_PER_DAY, job.anchor === null ? undefined : dateText(cal, job.anchor)).length);
    }
  }
}

/**
 * A cycle's anchor moved back by whole cycles to `fromDay` or before. Occurrences start at their
 * anchor, but the first payday closes a period that began a cycle earlier, and that payday must be seen.
 */
function anchorBefore(cal: Calendar, s: FlowSchedule, anchor: number, fromDay: number): number {
  if (anchor <= fromDay) return anchor;
  const interval = Math.max(1, Math.round(s.interval ?? 1));
  if (s.every === "day" || s.every === "week") {
    const period = interval * (s.every === "week" ? 7 : 1);
    return anchor - Math.ceil((anchor - fromDay) / period) * period;
  }
  // A month or year cycle repeats each `interval` years; 29 February steps back as the 28th.
  const d = dateAt(cal, clockAt(cal, anchor, 0));
  const day = d.month === 2 && d.day === 29 ? 28 : d.day;
  for (let years = interval; years <= 400 * interval; years += interval) {
    const back = dayIndexOfText(cal, `${String(d.year - years).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    if (back <= fromDay) return back;
  }
  return anchor;
}

/** A job's scheduled paydays (before any roll) whose day falls in [fromDay, toDay], as day indexes. */
function cycleDays(ctx: ReadContext, api: FinanceApi, job: Job, fromDay: number, toDay: number): number[] {
  const cal = calendarOf(ctx.world);
  const cycle = cycleOf(cal, job);
  const anchor = job.anchor === null ? undefined : dateText(cal, anchorBefore(cal, cycle, job.anchor, fromDay));
  return api.occurrences(ctx, cycle, clockAt(cal, fromDay, 0) - 1, clockAt(cal, toDay + 1, 0) - 1, anchor).map((at) => dateAt(cal, at).dayIndex);
}

/**
 * The pay periods a salary divides into a year: every scheduled period, or for a seasonal job only
 * those its season reaches, so a ten-month contract pays its whole salary over those ten months.
 */
function salaryPeriods(ctx: ReadContext, api: FinanceApi, job: Job, payDay: number): number {
  if (!job.season) return periodsPerYear(ctx, api, job);
  const cal = calendarOf(ctx.world);
  const days = cycleDays(ctx, api, job, payDay - 366 - 62, payDay);
  const inSeason = { start: null, end: null, season: job.season };
  let n = 0;
  for (let i = 1; i < days.length; i++) {
    const hi = days[i] ?? 0;
    if (hi <= payDay - 366) continue;
    for (let d = (days[i - 1] ?? 0) + 1; d <= hi; d++) {
      if (workingDay(cal, inSeason, d)) {
        n++;
        break;
      }
    }
  }
  return Math.max(1, n);
}

/**
 * The scheduled paydays (before any roll) from the one on or before `fromDay` through the one a
 * payment on `payDay` stands for: each consecutive pair bounds a pay period (the day after one to
 * the next, inclusive).
 */
function scheduledPaydays(ctx: ReadContext, api: FinanceApi, job: Job, fromDay: number, payDay: number): number[] {
  const days = cycleDays(ctx, api, job, Math.min(fromDay, payDay) - 70, payDay + 12);
  // The payday this payment stands for: the scheduled one it rolled from, else the latest by today.
  const roll = (day: number): number => (job.roll === "none" ? day : api.businessDay(ctx, day, job.roll));
  const target = days.find((d) => d >= payDay - 12 && roll(d) === payDay) ?? [...days].reverse().find((d) => d <= payDay);
  if (target === undefined) return [];
  const first = [...days].reverse().find((d) => d < target && d <= fromDay) ?? [...days].reverse().find((d) => d < target);
  return days.filter((d) => (first === undefined || d >= first) && d <= target);
}

/**
 * Where a payroll flow counts its intervals from: the job's anchor, for the cycles that count from
 * one (weekly, biweekly and custom), as its paydays do.
 */
function flowStart(cal: Calendar, job: Job): string | undefined {
  return job.anchor !== null && (job.every === "weekly" || job.every === "biweekly" || job.every === "custom") ? dateText(cal, job.anchor) : undefined;
}

/**
 * Where a job's pay starts before any paycheck is paid: the scheduled payday before the chat's
 * first (a gig's: the day of its first payout). Null when no payday falls in the chat's first year.
 */
function firstPeriodDay(ctx: ReadContext, api: FinanceApi, job: Job): number | null {
  const cal = calendarOf(ctx.world);
  const begun = chatStart(ctx.world);
  const at = api.occurrences(ctx, payFlowSchedule(ctx, job), begun, begun + 400 * MINUTES_PER_DAY, flowStart(cal, job))[0];
  if (at === undefined) return null;
  const day = dateAt(cal, at).dayIndex;
  return job.every === "per_job" ? day : (scheduledPaydays(ctx, api, job, day, day)[0] ?? null);
}

// ---------------------------------------------------------------- the work a job counts

type Block = { start: number; end: number };

/** The worker's commitments at the job's workplaces in [from, to), clipped to it and to the days the job counts. */
export function jobBlocks(ctx: ReadContext, job: Job, from: number, to: number): Block[] {
  const commitments = optionalQuery(ctx, "castlife.commitments");
  if (!commitments || job.workplaces.length === 0 || to <= from) return [];
  const cal = calendarOf(ctx.world);
  const out: Block[] = [];
  for (const b of commitments(ctx, job.worker, from, to)) {
    // Routine at the workplace counts, whatever the activity's name; trips, plans and appointments don't.
    if (b.kind !== "work" && b.kind !== "other") continue;
    const place = b.place;
    if (!place || !job.workplaces.some((w) => placeWithin(ctx.world, place, w))) continue;
    const start = Math.max(b.start, from);
    const end = Math.min(b.end, to);
    if (end > start && workingDay(cal, job, dateAt(cal, b.start).dayIndex)) out.push({ start, end });
  }
  return out;
}

/** How far around a pay period a routine at the job is looked for, before the job counts its hours a week instead. */
const ROUTINE_WINDOW = 14 * MINUTES_PER_DAY;

/**
 * Where the job's hours come from: its own setting; else, with a routine at the job, the shifts the
 * player turns up for (the player's own job) or the routine itself (anyone else's); else the hours
 * a week.
 */
export function hoursSource(ctx: ReadContext, job: Job, around: number): HoursSource {
  if (job.hours) return job.hours;
  if (jobBlocks(ctx, job, around - ROUTINE_WINDOW, around + ROUTINE_WINDOW).length === 0) return "contract";
  return job.worker === ctx.world.pov ? "attended" : "scheduled";
}

export interface Work {
  minutes: number;
  shifts: number;
  source: HoursSource;
}

/**
 * The days a job counts whose midnight falls in [from, to) (a pay period's days, and a gig's day by
 * its evening payout), but for those the worker spends away: a trip covers their noon.
 */
function daysIn(ctx: ReadContext, job: Job, from: number, to: number): number {
  const cal = calendarOf(ctx.world);
  const trips = (optionalQuery(ctx, "castlife.commitments")?.(ctx, job.worker, from, to) ?? []).filter((b) => b.kind === "trip");
  let n = 0;
  for (let d = dateAt(cal, from - 1).dayIndex + 1; clockAt(cal, d, 0) < to; d++) {
    const noon = clockAt(cal, d, 12 * 60);
    if (workingDay(cal, job, d) && !trips.some((t) => t.start <= noon && noon < t.end)) n++;
  }
  return n;
}

/** The clock a chat starts at: shifts before it count as attended, since the player had no way to attend them. */
function chatStart(world: ReadContext["world"]): number {
  return minutesBetween(world.calendar.epoch, world.start.at);
}

/**
 * The work a job counts in [from, to): the worker's commitments there (a shift is a day with any);
 * for the player at an attended-hours job, the shifts on their timesheet (and the routine before the
 * chat began); else the hours and shifts a week over the days the job counts, thinned to its weeks a
 * year unless a season already says which weeks.
 */
export function workIn(ctx: ReadContext, job: Job, from: number, to: number): Work {
  const source = hoursSource(ctx, job, to);
  const cal = calendarOf(ctx.world);
  if (source === "contract") {
    const days = daysIn(ctx, job, from, to);
    const share = job.season ? 1 : job.weeksPerYear / 52;
    return { minutes: Math.round(((job.hoursPerWeek * 60 * days) / 7) * share), shifts: Math.round(((job.shiftsPerWeek * days) / 7) * share * 100) / 100, source };
  }
  const count = (list: readonly Block[], extraDays: readonly number[] = []): Work => ({ minutes: list.reduce((a, b) => a + (b.end - b.start), 0), shifts: new Set([...list.map((b) => dateAt(cal, b.start).dayIndex), ...extraDays]).size, source });
  if (source !== "attended" || job.worker !== ctx.world.pov) return count(jobBlocks(ctx, job, from, to));
  const sheet = objOf(objOf(own(payrollSlice(ctx.state), job.id)).sheet);
  const sheetDays = Array.isArray(sheet.days) ? sheet.days.filter((d): d is number => typeof d === "number") : [];
  const early = count(jobBlocks(ctx, job, from, Math.min(to, chatStart(ctx.world))), sheetDays);
  return { minutes: early.minutes + numOf(sheet.minutes), shifts: early.shifts, source };
}

// ---------------------------------------------------------------- the payroll record

/** Payroll's slice: per job, what its last paycheck paid through and what has built up since. */
function payrollSlice(state: Readonly<WorldState>): JsonObject {
  return objOf(sliceOf(state, "economy").payroll);
}

function payRecord(state: Readonly<WorldState>, job: EntityId): JsonObject {
  return objOf(own(payrollSlice(state), job));
}

// ---------------------------------------------------------------- paychecks

export interface Paycheck {
  job: EntityId;
  worker: EntityId;
  /** The work it pays for, [from, to). */
  from: number;
  to: number;
  work: Work;
  gross: number;
  parts: { pay: number; tips: number; commission: number };
  taxes: PayTaxes;
  deductions: { label: string; cents: number; to: string }[];
  net: number;
  /** Where the net lands: each account and its part. */
  routed: { to: string; cents: number }[];
  /** What the employer adds to gross: a retirement match, and at the top level its share of FICA. */
  match: number;
  employerFica: number;
  /** The pay Social Security and Medicare counted (0 when none was withheld). */
  ficaWages: number;
  /** Pay taken before income tax (pre-tax deductions). */
  pretax: number;
  lines: PostingLine[];
}

function pct(cents: number, rate: number): number {
  return Math.round((cents * rate) / 100);
}

/** Whether an account is one of the party's own, where pay may land. */
function ownsAccount(api: FinanceApi, state: Readonly<WorldState>, party: EntityId, account: string): boolean {
  return api.ownersOf(state, account).some((o) => o.party === party);
}

/** A paycheck that pays nothing but moves the job's record on: a pay period on leave, or with no work in it. */
function emptyCheck(job: Job, from: number, to: number, work: Work): Paycheck {
  return { job: job.id, worker: job.worker, from, to, work, gross: 0, parts: { pay: 0, tips: 0, commission: 0 }, taxes: { federal: 0, socialSecurity: 0, medicare: 0, state: 0, local: 0 }, deductions: [], net: 0, routed: [], match: 0, employerFica: 0, ficaWages: 0, pretax: 0, lines: [] };
}

/**
 * One paycheck of a job paid at `at` (DESIGN §26.1), paid from the account `from`, or null when
 * there is nothing to cover yet. It pays for the work since the last paycheck (or since the start
 * of the first pay period it closes) up to the start of the day it is paid, and a gig's up to the
 * payout. Salary and a stipend pay each scheduled period they close, prorated by the days the job
 * counted. A period on leave is covered and pays nothing.
 */
export function paycheckFor(ctx: ReadContext, api: FinanceApi, job: Job, at: number, from: string): Paycheck | null {
  if (job.every === null || (job.status === "ended" && job.end === null)) return null;
  const cal = calendarOf(ctx.world);
  const payDay = dateAt(cal, at).dayIndex;
  const cutoff = job.every === "per_job" ? at : clockAt(cal, payDay, 0);
  const record = payRecord(ctx.state, job.id);
  const paidThrough = typeof record.through === "number" ? record.through : null;
  const periodic = job.basis === "salary" || job.basis === "stipend";
  // With nothing paid yet, pay runs from the period the chat's first payday closes, so a first
  // paycheck that couldn't be paid is paid with the next.
  const first = paidThrough === null ? firstPeriodDay(ctx, api, job) : null;
  const paydays = job.every === "per_job" ? [payDay - 1, payDay] : scheduledPaydays(ctx, api, job, paidThrough !== null ? dateAt(cal, paidThrough).dayIndex : (first ?? payDay), payDay);
  if (paydays.length < 2) return null;
  // Hours are cut at the start of each payday, so a period runs from the start of the one before;
  // a salary's periods are whole days after it. A gig's day pays that evening.
  const firstStart = clockAt(cal, job.every === "per_job" ? (first ?? payDay) : (paydays[0] ?? payDay) + (periodic ? 1 : 0), 0);
  const startClock = job.start === null ? -Infinity : clockAt(cal, job.start, 0);
  const since = paidThrough ?? Math.max(startClock, firstStart);
  const through = periodic ? clockAt(cal, (paydays[paydays.length - 1] ?? payDay) + 1, 0) : Math.max(since, cutoff);
  if (through <= since) return null;
  const work = workIn(ctx, job, since, Math.max(since, cutoff));
  if (job.status === "leave") return emptyCheck(job, since, through, work);
  let pay = 0;
  if (periodic) {
    // Each period it closes, (previous payday, payday], in whole when the job counted every day of
    // it; one begun before what the last paycheck paid through (the pay schedule changed since)
    // counts only its days after that, so no day is paid twice.
    const perPeriod = job.basis === "salary" ? job.rate / salaryPeriods(ctx, api, job, payDay) : job.rate;
    const unpaid = paidThrough === null ? -Infinity : dateAt(cal, paidThrough).dayIndex;
    for (let i = 1; i < paydays.length; i++) {
      const lo = (paydays[i - 1] ?? 0) + 1;
      const hi = (paydays[i] ?? 0) + 1;
      if (paidThrough !== null && clockAt(cal, hi, 0) <= paidThrough) continue;
      pay += (perPeriod * workingDays(cal, job, Math.max(lo, unpaid), hi)) / Math.max(1, hi - lo);
    }
    pay = Math.round(pay);
  } else if (job.basis === "hourly" || job.basis === "tips") pay = Math.round((job.rate * work.minutes) / 60);
  else if (job.basis === "per_shift") pay = Math.round(job.rate * work.shifts);
  const tips = job.basis === "tips" ? 0 : Math.round((job.tipsPerHour * work.minutes) / 60);
  const commission = pct(numOf(record.sales), job.basis === "commission" && job.commissionPct === 0 ? job.rate : job.commissionPct);
  const gross = pay + tips + commission;
  if (gross <= 0) return emptyCheck(job, since, through, work);

  // Deductions: fixed amounts and percentages of gross, never more than is left.
  const pretax = { income: 0, fica: 0 };
  const deductions: Paycheck["deductions"] = [];
  const matched: { to: string; cents: number }[] = [];
  let left = gross;
  for (const d of job.deductions) {
    const cents = Math.min(left, d.cents ?? pct(gross, d.pct ?? 0));
    if (cents <= 0) continue;
    left -= cents;
    const to = d.to && own(ctx.state.entities, d.to) ? d.to : api.outside(`payee:${(d.to ?? d.label).toLowerCase().replace(/\W+/g, "_")}`);
    deductions.push({ label: d.label, cents, to });
    if (d.pretax) {
      pretax.income += cents;
      // A retirement contribution is still FICA wages; health premiums aren't.
      if (d.kind !== "retirement") pretax.fica += cents;
    }
    if (d.match_pct && job.party && own(ctx.state.entities, to)) matched.push({ to, cents: Math.min(cents, pct(gross, d.match_pct)) });
  }
  const brackets = api.feature(ctx, job.worker, "tax_brackets");
  const year = dateAt(cal, at).year;
  const taxes = api.feature(ctx, job.worker, "withholding") ? payTaxes(ctx, job.worker, { gross, occupation: job.occupation, pretax, periods: periodsPerYear(ctx, api, job), ytdFica: yearPay(ctx.state, job.worker, year).fica, brackets, selfEmployed: job.contractor, ficaExempt: job.ficaExempt }) : { federal: 0, socialSecurity: 0, medicare: 0, state: 0, local: 0 };
  // Withholding never takes more than the deductions leave: what it can't take comes off income tax
  // first, then Medicare, then Social Security. The employer's share of FICA is its own, and whole.
  const fica = taxes.socialSecurity + taxes.medicare;
  let over = taxTotal(taxes) - left;
  for (const k of ["federal", "local", "state", "medicare", "socialSecurity"] as const) {
    const cut = Math.min(taxes[k], Math.max(0, over));
    taxes[k] -= cut;
    over -= cut;
  }
  const net = left - taxTotal(taxes);

  const deposit = api.depositAccount(ctx, job.worker) ?? api.outside(job.worker);
  const routed = api.split(net, job.splits.filter((s) => ownsAccount(api, ctx.state, job.worker, s.to)), deposit).filter((r) => r.cents > 0);
  const match = matched.reduce((a, m) => a + m.cents, 0);
  // Every employer in the world pays its share of FICA at the top level (ORG-SPEC §3.7); an outside one is the outside economy.
  const employerFica = brackets && job.party !== null && !job.contractor && !job.ficaExempt ? fica : 0;
  const lines: PostingLine[] = [];
  const add = (account: string, amount: number): void => {
    if (amount === 0) return;
    const line = lines.find((l) => l.account === account);
    if (line) line.amount += amount;
    else lines.push({ account, amount });
  };
  add(from, -(gross + match + employerFica));
  for (const r of routed) add(r.to, r.cents);
  for (const d of deductions) add(d.to, d.cents);
  for (const m of matched) add(m.to, m.cents);
  add(api.outside("tax:federal"), taxes.federal + taxes.socialSecurity + taxes.medicare + employerFica);
  add(api.outside("tax:state"), taxes.state);
  add(api.outside("tax:local"), taxes.local);
  const ficaWages = fica > 0 ? Math.max(0, gross - pretax.fica) : 0;
  return { job: job.id, worker: job.worker, from: since, to: through, work, gross, parts: { pay, tips, commission }, taxes, deductions, net, routed, match, employerFica, ficaWages, pretax: pretax.income, lines: lines.filter((l) => l.amount !== 0) };
}

// ---------------------------------------------------------------- events

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/**
 * `economy.payslip`: a paycheck paid. It moves the job's record on (what it paid through; the
 * commission sales and timesheet built up since start again), adds to the worker's year of pay
 * (and a contractor's month, for estimated tax), keeps the paycheck for the dashboards, and books
 * what it cost a business employer. Its posting travels beside it in one unit.
 */
export const PAYSLIP: EventTypeDef<PackEvent> = {
  type: "economy.payslip",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "job")) && own(ctx.state.entities, str(e, "worker")) && typeof e.data.through === "number" ? null : reject("bad_event", "a payslip needs its job, its worker and the time it pays through")),
  apply: (e, state, ctx) => {
    const job = str(e, "job");
    const gross = numOf(e.data.gross);
    sliceRecord(state, "economy", "payroll")[job] = { through: numOf(e.data.through), last: { at: state.clock, gross, taxes: numOf(e.data.taxes), deductions: numOf(e.data.deductions), net: numOf(e.data.net), minutes: numOf(e.data.minutes), shifts: numOf(e.data.shifts) } };
    if (gross === 0) return;
    addPay(state, str(e, "worker"), numOf(e.data.year), numOf(e.data.month), { gross, fica: numOf(e.data.fica), withheld: numOf(e.data.taxes), pretax: numOf(e.data.pretax), contract: e.data.contract === true });
    const business = str(e, "business");
    if (business !== "") addToBooks(state, business, monthOf(ctx.world, state.clock), { payroll: numOf(e.data.cost) });
    // An employer's payroll taxes by year (ORG-SPEC §3.11's Taxes): only payslips that name their employer, so older ones fold as they did.
    const employer = str(e, "employer");
    if (employer !== "") addPayrollTaxes(state, employer, numOf(e.data.year), numOf(e.data.taxes), numOf(e.data.employer_tax));
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `Payslip: ${labelOf(ctx, str(e, "worker"))}, ${labelOf(ctx, str(e, "job"))}`),
};

/** The days on a timesheet, as a sorted list of day indexes. */
function sheetDays(v: JsonValue | undefined): number[] {
  return Array.isArray(v) ? v.filter((d): d is number => typeof d === "number") : [];
}

/**
 * `economy.timesheet`: shifts the player turned up for at an attended-hours job, the minutes and the
 * days, added to its timesheet until payday. Several in one record merge (the same job and pay
 * period) exactly: minutes add, days join.
 */
export const TIMESHEET: EventTypeDef<PackEvent> = {
  type: "economy.timesheet",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "job")) && typeof e.data.minutes === "number" && e.data.minutes > 0 ? null : reject("bad_event", "a timesheet entry needs its job and minutes")),
  apply: (e, state) => {
    const job = str(e, "job");
    const payroll = sliceRecord(state, "economy", "payroll");
    const cur = objOf(own(payroll, job));
    const sheet = objOf(cur.sheet);
    const days = [...new Set([...sheetDays(sheet.days), ...sheetDays(e.data.days)])].sort((a, b) => a - b);
    payroll[job] = { ...cur, sheet: { minutes: numOf(sheet.minutes) + numOf(e.data.minutes), days } };
  },
  describe: (e) => `Worked ${Math.round((numOf(e.data.minutes) / 60) * 10) / 10} h`,
  coarsen: {
    key: (e) => `${str(e, "job")}:${numOf(e.data.since)}`,
    merge: (a, b) => ({ ...b, data: { ...b.data, minutes: numOf(a.data.minutes) + numOf(b.data.minutes), days: [...new Set([...sheetDays(a.data.days), ...sheetDays(b.data.days)])].sort((x, y) => x - y) } }),
  },
};

/** `economy.commission`: a sale credited to a job's commission until its next paycheck. Merges like the timesheet. */
export const COMMISSION: EventTypeDef<PackEvent> = {
  type: "economy.commission",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "job")) && typeof e.data.cents === "number" ? null : reject("bad_event", "a commission credit needs its job and amount")),
  apply: (e, state) => {
    const job = str(e, "job");
    const payroll = sliceRecord(state, "economy", "payroll");
    const cur = objOf(own(payroll, job));
    payroll[job] = { ...cur, sales: numOf(cur.sales) + numOf(e.data.cents) };
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `Commission on sales: ${labelOf(ctx, str(e, "job"))}`),
  coarsen: {
    key: (e) => `${str(e, "job")}:${numOf(e.data.since)}`,
    merge: (a, b) => ({ ...b, data: { ...b.data, cents: numOf(a.data.cents) + numOf(b.data.cents) } }),
  },
};

/** The bookkeeping that travels with a paycheck's posting. */
function payslipEvent(ctx: ReadContext, job: Job, check: Paycheck, at: number): LedgerEvent {
  return {
    type: "economy.payslip",
    data: {
      job: check.job,
      worker: check.worker,
      through: check.to,
      gross: check.gross,
      taxes: taxTotal(check.taxes),
      deductions: check.deductions.reduce((a, d) => a + d.cents, 0),
      net: check.net,
      minutes: check.work.minutes,
      shifts: check.work.shifts,
      year: dateAt(calendarOf(ctx.world), at).year,
      month: dateAt(calendarOf(ctx.world), at).month,
      fica: check.ficaWages,
      pretax: check.pretax,
      ...(job.contractor ? { contract: true } : {}),
      ...(job.business ? { business: job.business, cost: check.gross + check.match + check.employerFica } : {}),
      // The employer in the world, with its own share of payroll tax, for its Taxes (§3.11).
      ...(job.party !== null ? { employer: job.party, employer_tax: check.employerFica } : {}),
    },
  };
}

/**
 * Where a job's pay comes from (ORG-SPEC §3.7): its employer's `payroll_account` when that is one the
 * employer may spend; else a company's operating account, any other party's best deposit account (a
 * person's own); the employer's outside account while it holds none; an outside employer's account.
 */
export function payerOf(ctx: ReadContext, api: FinanceApi, job: Job): string {
  const party = job.party;
  if (party === null) return api.outside(`employer:${(job.employer || job.occupation || "work").toLowerCase().replace(/\W+/g, "_")}`);
  const named = strOf(own(ctx.state.entities, party)?.fields.payroll_account);
  if (named !== "" && api.accountsOf(ctx, party, "spend").includes(named)) return named;
  return (job.business ? operatingAccount(api, ctx, party) : api.depositAccount(ctx, party)) ?? api.outside(party);
}

/**
 * A job's employer by name, as `viewer` (the player's POV; null for the GM) may read it: the party's
 * ("someone" for one they can't see), else the place or name the job gives, naming only what the
 * viewer may see (`outsideName`); "" when it gives none.
 */
function employerName(ctx: ReadContext, job: Job, viewer: EntityId | null): string {
  if (job.party) return hiddenFrom(ctx, viewer, job.party) ? "someone" : labelOf(ctx, job.party);
  return job.employer === "" ? "" : outsideName(ctx, `employer:${job.employer}`, viewer);
}

/** The payroll flow a job derives: from the employer to the worker, on the job's cycle, from its start to the payday that settles its end. */
function payrollFlow(ctx: ReadContext, api: FinanceApi, job: Job): Flow | null {
  if (job.every === null) return null;
  const cal = calendarOf(ctx.world);
  const schedule = payFlowSchedule(ctx, job);
  const start = flowStart(cal, job);
  // The last paycheck comes on the first payday after the last day worked. The flow ends on that
  // payday's scheduled day, since its occurrences are counted by it: rolled back off a weekend, the
  // payday is paid before the day the flow would otherwise end on.
  const end = job.end;
  const roll = (d: number): number => (schedule.roll === "before" || schedule.roll === "after" ? api.businessDay(ctx, d, schedule.roll) : d);
  const settle = end === null ? undefined : cycleDays(ctx, api, job, end - 62, end + 400).find((d) => roll(d) > end);
  return {
    id: `pay:${job.id}`,
    label: `Pay: ${job.title}`,
    kind: "payroll",
    // An outside employer pays as an outside payer named as the job names it, so the flow reads as its name; its pay posts from `payerOf`'s account.
    from: job.party ? payerOf(ctx, api, job) : `employer:${job.employer}`,
    to: job.worker,
    ...(job.splits.length > 0 ? { splits: job.splits } : {}),
    amount: { provider: "payroll", args: { job: job.id } },
    schedule,
    ...(start ? { start } : {}),
    ...(settle !== undefined ? { end: dateText(cal, settle) } : {}),
    // A paycheck that can't be paid is paid with the next: each covers the work since the last one paid.
    shortfall: "skip",
    category: "payroll",
    link: job.id,
    status: job.status === "ended" && job.end === null ? "ended" : "active",
    source: "job",
  };
}

// ---------------------------------------------------------------- the player's timesheet

/**
 * The timesheet for the player's attended-hours jobs (Money 3+): when a slot completes, each work
 * block of theirs that ended in it counts if they turned up: they are at the workplace now, or
 * arrived there or left it after the block began (their own visits, which every move keeps). A
 * block from before the chat began isn't on it: the paycheck counts those as attended.
 */
function timesheet(slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "money") < 3) return [];
  const out: LedgerEvent[] = [];
  const cal = calendarOf(ctx.world);
  const here = placeOfEntity(ctx.state, pov);
  const begun = chatStart(ctx.world);
  for (const job of allJobs(ctx)) {
    if (job.worker !== pov || job.status !== "active" || hoursSource(ctx, job, slot.end) !== "attended") continue;
    let minutes = 0;
    const days = new Set<number>();
    // Looked for past the slot's end, so a block running on past it isn't cut there and counted twice.
    for (const b of jobBlocks(ctx, job, Math.max(begun, slot.start - MINUTES_PER_DAY), slot.end + MINUTES_PER_DAY)) {
      if (b.end <= slot.start || b.end > slot.end) continue;
      if (!job.workplaces.some((w) => placeWithin(ctx.world, here, w) || (placeVisit(ctx.state, w)?.last ?? -Infinity) >= b.start)) continue;
      minutes += b.end - b.start;
      days.add(dateAt(cal, b.start).dayIndex);
    }
    if (minutes > 0) out.push({ type: "economy.timesheet", data: { job: job.id, minutes, days: [...days].sort((a, b) => a - b), since: numOf(payRecord(ctx.state, job.id).through) } });
  }
  return out;
}

// ---------------------------------------------------------------- personnel: hiring, letting go, pay, hours, leave, positions, the pay schedule

function today(ctx: ReadContext): number {
  return dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex;
}

/**
 * Why `by`, running `business`, may not put `worker` on its payroll or set their pay there, or null
 * (DESIGN §25.1). Running it for others, without a share of its worth, a manager puts neither
 * themselves nor their own on its payroll: they'd pay themselves from its money. With a share, a
 * salary is theirs to take, as a draw is. Nor, unless the business is wholly theirs, may they pay
 * anyone else into an account they may spend by a role of their own (`landsInReach`): the worker's
 * deposit account, or one of the worker's that `splits` route the pay to, unless it's the money's
 * own people's. Any employer is run so (ORG-SPEC §3.7): a household's Head runs its money for its
 * members.
 */
export function payrollProblem(ctx: ReadContext, api: FinanceApi, by: EntityId, business: EntityId, worker: EntityId, splits: readonly FlowSplit[], doing: "hire" | "raise"): string | null {
  const shown = (id: EntityId): string => shownLabel(ctx, ctx.world.pov, id);
  if (api.interestsOf(ctx, by).has(worker)) {
    if (api.shareOf(ctx.state, business, by) > 0) return null;
    const what = doing === "hire" ? `put ${worker === by ? "themselves" : shown(worker)} on its payroll` : `set ${worker === by ? "their own" : `${shown(worker)}'s`} pay`;
    return `${shown(by)} runs ${shown(business)} for others, so can't ${what}`;
  }
  const deposit = api.depositAccount(ctx, worker);
  const lands = [...(deposit ? [deposit] : []), ...splits.filter((s) => ownsAccount(api, ctx.state, worker, s.to)).map((s) => s.to)];
  const reached = lands.find((a) => api.landsInReach(ctx, by, a, business));
  return reached === undefined ? null : `${shown(by)} runs ${shown(business)} for others, so can't pay ${shown(worker)} into ${shown(reached)}, which ${shown(by)} may spend`;
}

/** Whom an act on an employer's staff reaches: one of its people, and the position someone is hired or appointed into; or every job there. */
type Reach = { worker?: EntityId; position?: string } | "all";

/**
 * Why `by` may not use `power` on `employer`'s staff (ORG-SPEC §3.7), or null. An employer runs its
 * own payroll; anyone else needs the power, within the limits of what it rests on (`mayAct`). A
 * position whose powers reach only the positions below it reaches only someone holding one of them,
 * hires or appoints only into one, and never acts on every job at once.
 */
function staffRefusal(ctx: ReadContext, by: EntityId, employer: EntityId, power: OrgPower, reach: Reach): string | null {
  if (by === employer) return null;
  const may = mayAct(ctx, by, employer, power, reach !== "all" && reach.worker !== undefined ? { target: reach.worker } : {});
  if (!may.ok) return may.reason;
  const positions = positionsOf(ctx, employer);
  const mine = may.grant.basis === "position" ? positions.find((p) => p.id === may.grant.id) : undefined;
  if (mine?.scope !== "below") return null;
  const name = labelOf(ctx, employer);
  if (reach === "all") return `${mine.title} reaches only the positions below it at ${name}, not every job there`;
  if (reach.position === undefined || positionsBelow(positions, mine.id).includes(reach.position)) return null;
  const into = positions.find((p) => p.id === reach.position)?.title;
  return into ? `${into} isn't below ${mine.title} at ${name}` : `${mine.title} hires and appoints only into the positions below it at ${name}`;
}

/** What an act on an employer's staff records when someone acts for an organization other than themselves: its History line (`orgs.acted`); nothing otherwise. */
function acted(ctx: ReadContext, org: EntityId | null, by: EntityId, power: OrgPower, text: string, names: EntityId[]): LedgerEvent[] {
  if (org === null || by === "" || by === org || orgTypeOf(ctx, org) === null) return [];
  return optionalService(ctx, "orgs.acted")?.(ctx, { org, by, power, text, names }) ?? [];
}

/** The pay schedules an organization may set for its staff (ORG-SPEC §3.7). */
const SCHEDULE_EVERY: readonly PayEvery[] = ["weekly", "biweekly", "semimonthly", "monthly"];

/** A job's own pay cycle beyond how often: what a pay schedule replaces, every one of them, when it moves the job. */
const CADENCE_FIELDS = ["pay_anchor", "pay_weekday", "pay_days", "pay_unit", "pay_interval", "pay_weekdays", "pay_months", "pay_except"] as const;

/**
 * An organization's pay schedule (ORG-SPEC §3.7, its `payroll` field) as its staff's jobs take it: how
 * often, then for a weekly or biweekly one the first payday it counts from and its weekday, for a
 * semimonthly or monthly one its paydays of the month. Null when it sets none.
 */
export function payScheduleOf(ctx: Pick<ReadContext, "state">, org: EntityId): JsonObject | null {
  const s = orgRecord(ctx.state, org, "payroll");
  const every = strOf(s?.every);
  if (!s || !(SCHEDULE_EVERY as readonly string[]).includes(every)) return null;
  const weekly = every === "weekly" || every === "biweekly";
  const days = numbers(s.days);
  return { pay_every: every, ...(weekly && strOf(s.anchor) !== "" ? { pay_anchor: strOf(s.anchor) } : {}), ...(weekly && typeof s.weekday === "number" ? { pay_weekday: s.weekday } : {}), ...(!weekly && days.length > 0 ? { pay_days: days } : {}) };
}

/**
 * `economy.hire`: a party takes someone on (ORG-SPEC §3.7): a business, a household or any other
 * organization, the party, a person. The job is a new entity, starting today or on `start`, in
 * `position` when its employer defines one; what it doesn't say comes from the occupation, and a hire
 * joins the employer's pay schedule, else its staff's own cycle, so its payroll runs on one day.
 */
function hire(api: FinanceApi, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const employer = strOf(args.business);
  const worker = strOf(args.worker);
  if (!own(ctx.state.entities, employer) || isGone(ctx.state, employer) || api.partyKind(ctx, employer) === null) return reject("missing_entity", `no employer ${labelOf(ctx, employer)}`);
  if (!own(ctx.state.entities, worker) || isGone(ctx.state, worker) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, worker)?.kind ?? "", "person")) return reject("missing_entity", `no person ${labelOf(ctx, worker)}`);
  const position = strOf(args.position);
  const into = positionsOf(ctx, employer).find((p) => p.id === position);
  if (position !== "" && !into) return reject("bad_position", `${labelOf(ctx, employer)} has no position ${position}`);
  const by = strOf(args.by);
  const refusal = by === "" ? null : (staffRefusal(ctx, by, employer, "staff.hire", { position }) ?? (by === employer ? null : payrollProblem(ctx, api, by, employer, worker, [], "hire")));
  if (refusal !== null) return reject("not_owner", refusal);
  const jobs = allJobs(ctx);
  if (jobs.some((j) => j.worker === worker && j.party === employer && j.status !== "ended")) return reject("exists", `${labelOf(ctx, worker)} already works for ${labelOf(ctx, employer)}`);
  const cal = calendarOf(ctx.world);
  const fields: JsonObject = { worker, employer, status: "active", start: typeof args.start === "string" && args.start !== "" ? args.start : dateText(cal, today(ctx)), ...(into ? { position } : {}) };
  for (const k of ["title", "occupation", "basis", "hours", "pay_every"] as const) if (typeof args[k] === "string" && args[k] !== "") fields[k] = args[k];
  if (typeof args.rate === "number" && args.rate > 0) fields.rate = Math.round(args.rate);
  if (typeof args.hours_per_week === "number" && args.hours_per_week > 0) fields.hours_per_week = args.hours_per_week;
  const schedule = payScheduleOf(ctx, employer);
  const peer = jobs.find((j) => j.party === employer && j.status === "active" && j.every !== null);
  if (fields.pay_every === undefined && schedule) Object.assign(fields, schedule);
  else if (fields.pay_every === undefined && peer?.every) {
    fields.pay_every = peer.every;
    if (peer.anchor !== null && (peer.every === "weekly" || peer.every === "biweekly")) fields.pay_anchor = dateText(cal, peer.anchor);
    if (peer.custom.days) fields.pay_days = peer.custom.days;
  }
  const id = `job:${hashParts(ctx.rng.seed, "hire", employer, worker, String(ctx.state.clock)).slice(0, 10)}`;
  const entity: EntityDef = { id, kind: JOB_KIND, name: `${labelOf(ctx, worker)} at ${labelOf(ctx, employer)}`, tier: "background", fields, relations: [] };
  const as = strOf(fields.title) || into?.title || "";
  return [{ type: "spawn", entity }, ...acted(ctx, employer, by, "staff.hire", `Hired ${labelOf(ctx, worker)}${as ? ` as ${as}` : ""}`, [worker])];
}

/**
 * The job an act on someone's employment names, not ended; a rejection when there is none, or when
 * `by` may not use `power` on it (`staffRefusal`; a job with an outside employer has nobody in the
 * world to decide it but the GM).
 */
function staffJob(ctx: ReadContext, args: Record<string, JsonValue>, power: OrgPower, position?: string): Job | Rejection {
  const job = readJob(ctx, strOf(args.job));
  if (!job) return reject("missing_entity", `no job ${labelOf(ctx, strOf(args.job))}`);
  if (job.status === "ended") return reject("ended", "that job has already ended");
  const by = strOf(args.by);
  if (by === "") return job;
  const refusal = job.party === null ? `${labelOf(ctx, by)} doesn't decide ${labelOf(ctx, job.id)}` : staffRefusal(ctx, by, job.party, power, position === undefined ? { worker: job.worker } : { worker: job.worker, position });
  return refusal === null ? job : reject("not_owner", refusal);
}

/** Why `by` may not set `job`'s pay for the party it acts for (`payrollProblem`), or null: an employer sets its own staff's pay. */
function payProblem(ctx: ReadContext, api: FinanceApi, by: EntityId, job: Job): string | null {
  return by === "" || job.party === null || by === job.party ? null : payrollProblem(ctx, api, by, job.party, job.worker, job.splits, "raise");
}

/** `economy.job_end`: the job ends today (or on `end`): its worker quits, or someone lets them go. Its last paycheck pays through that day on the next payday. */
function endJob(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const job = readJob(ctx, strOf(args.job));
  if (!job) return reject("missing_entity", `no job ${labelOf(ctx, strOf(args.job))}`);
  const by = strOf(args.by);
  if (by !== "" && by !== job.worker) {
    const refusal = job.party === null ? `${labelOf(ctx, by)} can't end that job` : staffRefusal(ctx, by, job.party, "staff.fire", { worker: job.worker });
    if (refusal !== null) return reject("not_owner", refusal);
  }
  if (job.status === "ended") return reject("ended", "that job has already ended");
  const end = typeof args.end === "string" && args.end !== "" ? args.end : dateText(calendarOf(ctx.world), today(ctx));
  return [
    { type: "set", entity: job.id, field: "end", value: end },
    { type: "set", entity: job.id, field: "status", value: "ended" },
    ...(job.party !== null && by !== job.worker ? acted(ctx, job.party, by, "staff.fire", `Let ${labelOf(ctx, job.worker)} go`, [job.worker]) : []),
  ];
}

/** `economy.job_raise`: a new rate, or a percentage more, paid from the next paycheck on. */
function raise(api: FinanceApi, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const job = staffJob(ctx, args, "staff.pay");
  if ("code" in job) return job;
  const by = strOf(args.by);
  const problem = payProblem(ctx, api, by, job);
  if (problem !== null) return reject("not_owner", problem);
  const rate = typeof args.rate === "number" && args.rate > 0 ? Math.round(args.rate) : typeof args.pct === "number" && args.pct > -100 ? Math.round(job.rate * (1 + args.pct / 100)) : NaN;
  if (!(rate > 0)) return reject("bad_amount", "a raise needs a new rate above nothing, or a percentage");
  return [{ type: "set", entity: job.id, field: "rate", value: rate }, ...acted(ctx, job.party, by, "staff.pay", `Set ${labelOf(ctx, job.worker)}'s pay to ${api.money(ctx, rate)} ${BASIS_WORDS[job.basis]}`, [job.worker])];
}

/** `economy.job_hours`: the hours a week a job counts from now on (its pay, where hours pay it). Changing them sets the worker's pay, so the self-dealing guard holds. */
function setHours(api: FinanceApi, args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const hours = typeof args.hours_per_week === "number" && Number.isFinite(args.hours_per_week) ? args.hours_per_week : NaN;
  if (!(hours > 0 && hours <= 168)) return reject("bad_amount", "hours a week are more than none and at most 168");
  const job = staffJob(ctx, args, "staff.pay");
  if ("code" in job) return job;
  const by = strOf(args.by);
  const problem = payProblem(ctx, api, by, job);
  if (problem !== null) return reject("not_owner", problem);
  return [{ type: "set", entity: job.id, field: "hours_per_week", value: hours }, ...acted(ctx, job.party, by, "staff.pay", `Set ${labelOf(ctx, job.worker)}'s hours to ${hours} a week`, [job.worker])];
}

/** `economy.job_leave`: someone goes on leave (a pay period on leave is covered and pays nothing) or comes back from it. */
function setLeave(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const job = staffJob(ctx, args, "staff.pay");
  if ("code" in job) return job;
  const leave = args.leave !== false;
  const who = labelOf(ctx, job.worker);
  if (leave === (job.status === "leave")) return reject("unchanged", leave ? `${who} is already on leave` : `${who} isn't on leave`);
  return [{ type: "set", entity: job.id, field: "status", value: leave ? "leave" : "active" }, ...acted(ctx, job.party, strOf(args.by), "staff.pay", leave ? `Put ${who} on leave` : `${who} came back from leave`, [job.worker])];
}

/** `economy.job_position`: someone working there is appointed to one of its positions (promoted or moved), or to none. */
function setPosition(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const position = strOf(args.position);
  const held = readJob(ctx, strOf(args.job));
  const into = held?.party ? positionsOf(ctx, held.party).find((p) => p.id === position) : undefined;
  if (held && position !== "" && !into) return reject("bad_position", `${held.party ? labelOf(ctx, held.party) : held.employer} has no position ${position}`);
  const job = staffJob(ctx, args, "members.appoint", into ? position : undefined);
  if ("code" in job) return job;
  const who = labelOf(ctx, job.worker);
  if (position === strOf(own(ctx.state.entities, job.id)?.fields.position)) return reject("unchanged", into ? `${who} already holds ${into.title}` : `${who} holds no position`);
  return [{ type: "set", entity: job.id, field: "position", value: into ? position : null }, ...acted(ctx, job.party, strOf(args.by), "members.appoint", into ? `Appointed ${who} ${into.title}` : `${who} no longer holds a position`, [job.worker])];
}

/**
 * `economy.job_title`: the title a job goes by (ORG-SPEC §3.3, §3.7), given by its worker or by
 * someone who appoints for its employer; none clears it, and the job goes by its position's or its
 * occupation's words again.
 */
function setTitle(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const held = readJob(ctx, strOf(args.job));
  if (!held) return reject("missing_entity", `no job ${labelOf(ctx, strOf(args.job))}`);
  const by = strOf(args.by);
  const theirOwn = by !== "" && by === held.worker;
  const job = theirOwn ? (held.status === "ended" ? reject("ended", "that job has already ended") : held) : staffJob(ctx, args, "members.appoint");
  if ("code" in job) return job;
  const words = strOf(args.title).trim();
  const who = labelOf(ctx, job.worker);
  if (words === strOf(own(ctx.state.entities, job.id)?.fields.title)) return reject("unchanged", words !== "" ? `${who} already goes by ${words}` : `${who}'s job has no title of its own`);
  const line = words !== "" ? `${who} goes by ${words}` : `${who}'s job no longer has a title of its own`;
  return [{ type: "set", entity: job.id, field: "title", value: words === "" ? null : words }, ...(theirOwn ? [] : acted(ctx, job.party, by, "members.appoint", line, [job.worker]))];
}

/**
 * `economy.pay_schedule`: an employer's pay schedule changes (ORG-SPEC §3.7), and in one unit every
 * job of its not ended moves to it. A weekly or biweekly schedule given no first payday counts from
 * the next of its weekday (Friday unless it says), so every job pays on the same days. The next
 * paycheck of each pays the work since its last, through the change once.
 */
function paySchedule(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const org = strOf(args.org);
  if (!own(ctx.state.entities, org) || isGone(ctx.state, org) || orgTypeOf(ctx, org) === null) return reject("missing_entity", `no organization ${labelOf(ctx, org)}`);
  const every = strOf(args.every);
  if (!(SCHEDULE_EVERY as readonly string[]).includes(every)) return reject("bad_schedule", `a pay schedule is ${SCHEDULE_EVERY.join(", ")}`);
  const by = strOf(args.by);
  const refusal = by === "" ? null : staffRefusal(ctx, by, org, "staff.pay", "all");
  if (refusal !== null) return reject("not_owner", refusal);
  const cal = calendarOf(ctx.world);
  const weekly = every === "weekly" || every === "biweekly";
  const given = strOf(args.anchor);
  const anchor = given === "" ? null : dayOfField(cal, given);
  if (given !== "" && anchor === null) return reject("bad_date", `${given} isn't a date`);
  const weekday = anchor !== null ? dateAt(cal, clockAt(cal, anchor, 0)).weekday : typeof args.weekday === "number" && Number.isInteger(args.weekday) && args.weekday >= 0 && args.weekday <= 6 ? args.weekday : 5;
  const from = today(ctx);
  const first = anchor ?? from + ((((weekday - dateAt(cal, clockAt(cal, from, 0)).weekday) % 7) + 7) % 7);
  const listed = numbers(args.days).filter((d) => Number.isInteger(d) && d >= -1 && d <= 31 && d !== 0);
  const days = listed.length > 0 ? listed : every === "semimonthly" ? [15, -1] : [-1];
  const schedule: JsonObject = weekly ? { every, anchor: dateText(cal, first), weekday } : { every, days };
  const cadence: JsonObject = { pay_every: every, ...(weekly ? { pay_anchor: dateText(cal, first), pay_weekday: weekday } : { pay_days: days }) };
  // Stored as its field is declared, a list: the schedule its one record.
  const out: LedgerEvent[] = [{ type: "set", entity: org, field: "payroll", value: [schedule] }];
  for (const job of allJobs(ctx).filter((j) => j.party === org && j.status !== "ended")) {
    const f = own(ctx.state.entities, job.id)?.fields ?? {};
    for (const field of ["pay_every", ...CADENCE_FIELDS] as const) {
      const value = cadence[field] ?? null;
      if (JSON.stringify(f[field] ?? null) !== JSON.stringify(value)) out.push({ type: "set", entity: job.id, field, value });
    }
  }
  return [...out, ...acted(ctx, org, by, "staff.pay", `Changed the pay schedule to ${every}`, [])];
}

// ---------------------------------------------------------------- views

const BASIS_WORDS: Record<PayBasis, string> = { salary: "a year", hourly: "an hour", per_shift: "a shift", commission: "commission", tips: "an hour in tips", stipend: "a period" };

/** A job as the dashboards list it, with its next payday and what a period pays when that's known ahead; its employer as `viewer` may read it. */
export function jobView(ctx: ReadContext, api: FinanceApi, job: Job, viewer: EntityId | null): JobView {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const flow = api.flows(ctx).find((f) => f.source === "job" && f.link === job.id);
  const next = flow && job.status !== "ended" ? (api.occurrences(ctx, flow.schedule, now, now + 62 * MINUTES_PER_DAY, flow.start)[0] ?? null) : null;
  const record = payRecord(ctx.state, job.id);
  const last = objOf(record.last);
  const sheet = objOf(record.sheet);
  const since = typeof record.through === "number" ? record.through : now - 7 * MINUTES_PER_DAY;
  const scheduled = hoursSource(ctx, job, now) === "contract" ? null : jobBlocks(ctx, job, since, now).reduce((a, b) => a + (b.end - b.start), 0);
  const money = (c: number): string => api.money(ctx, c);
  const entity = own(ctx.state.entities, job.id);
  const fields = entity?.fields ?? {};
  // The job as stored names its employer and workplace by id: a place or someone the viewer can't see stays out of it.
  const unseen = Object.fromEntries(["employer", "workplace"].filter((k) => outsideHidden(ctx, strOf(fields[k]), viewer)).map((k) => [k, ""]));
  return {
    id: job.id,
    title: job.title,
    employer: employerName(ctx, job, viewer),
    employerId: job.party && !hiddenFrom(ctx, viewer, job.party) ? job.party : null,
    worker: shownLabel(ctx, viewer, job.worker),
    workerId: job.worker,
    basis: job.basis,
    pay: job.basis === "commission" ? `${job.commissionPct || job.rate}% commission` : `${money(job.rate)} ${BASIS_WORDS[job.basis]}${job.tipsPerHour > 0 ? ` plus about ${money(job.tipsPerHour)} an hour in tips` : ""}${job.commissionPct > 0 ? ` plus ${job.commissionPct}% commission` : ""}`,
    rate: job.rate,
    payEvery: job.every ?? "custom",
    schedule: job.every === null ? "unpaid" : job.every.replace("_", " "),
    nextPay: next === null ? null : formatClock(cal, next),
    grossPerPeriod: job.basis === "salary" ? Math.round(job.rate / periodsPerYear(ctx, api, job)) : job.basis === "stipend" ? job.rate : null,
    status: job.status,
    hours: scheduled === null && job.hours !== "attended" ? null : { scheduled: Math.round((scheduled ?? 0) / 6) / 10, attended: Math.round(numOf(sheet.minutes) / 6) / 10 },
    lastPay: Object.keys(last).length > 0 ? { at: formatClock(cal, numOf(last.at)), gross: numOf(last.gross), taxes: numOf(last.taxes), deductions: numOf(last.deductions), net: numOf(last.net) } : null,
    deductions: job.deductions.map((d) => ({ label: d.label, value: d.cents !== undefined ? money(d.cents) : `${d.pct ?? 0}%` })),
    // Where the pay goes, as the viewer may read it: an account of someone they can't see is someone's.
    splits: job.splits.map((s) => ({ to: shownLabel(ctx, viewer, s.to), value: s.cents !== undefined ? money(s.cents) : `${s.pct ?? 0}%` })),
    spec: { ...fields, ...unseen } as unknown as JobFields,
  };
}

/** An employer's jobs not ended, as `viewer` may read them: someone they can't see is "an employee", with nothing that names them (DESIGN §26.2). */
export function staffViews(ctx: ReadContext, api: FinanceApi, employer: EntityId, viewer: EntityId | null): JobView[] {
  return allJobs(ctx)
    .filter((j) => j.party === employer && j.status !== "ended")
    .map((j) => {
      const v = jobView(ctx, api, j, viewer);
      if (!hiddenFrom(ctx, viewer, j.worker)) return v;
      // Where their pay goes, and to whom, would name them too, and so can the job's id (`job_danny_mechanic`): its payroll's link sends the same stand-in.
      return { ...v, id: opaqueId(v.id), worker: "an employee", workerId: "", splits: [], spec: { ...v.spec, worker: "", splits: [], deductions: [] } };
    });
}

/** What an employer's payroll has cost this calendar year: a company's books; anyone else's payroll paid from its accounts, by the journal's monthly totals. */
function payrollThisYear(ctx: ReadContext, api: FinanceApi, employer: EntityId): number {
  const cal = calendarOf(ctx.world);
  const yearStart = clockAt(cal, dayIndexOf(cal, dateAt(cal, ctx.state.clock).year, 1, 1), 0);
  if (kindIs(ctx.registry, ctx.world, own(ctx.state.entities, employer)?.kind ?? "", COMPANY_KIND)) return businessBooks(api, ctx, employer, yearStart, ctx.state.clock + 1).payroll;
  const months = monthsBetween(ctx.world, yearStart, ctx.state.clock + 1);
  return api.accountsOf(ctx, employer, "spend").reduce((sum, account) => sum + months.reduce((a, m) => a + (totalsOf(ctx.state, account, m).payroll?.out ?? 0), 0), 0);
}

// ---------------------------------------------------------------- registration

/** Jobs: payroll flows and their paychecks, the timesheet, hiring, letting go, pay, hours, leave and positions, the pay schedule, the staff of every employer, and each worker's jobs on their dashboard. */
export function registerEmployment(r: FinanceRegistry): void {
  const { api, core } = r;
  for (const def of [PAYSLIP, TIMESHEET, COMMISSION]) core.event(def);
  r.flows({ id: "job", flows: (ctx) => allJobs(ctx).flatMap((job) => payrollFlow(ctx, api, job) ?? []) });
  r.amount("payroll", (ctx, flow, at): FlowPosting | Rejection | null => {
    const id = "provider" in flow.amount ? strOf(objOf(flow.amount.args).job, flow.link ?? "") : (flow.link ?? "");
    const job = readJob(ctx, id);
    if (!job) return null;
    const check = paycheckFor(ctx, api, job, at, payerOf(ctx, api, job));
    if (!check) return null;
    // Nothing earned (a period on leave, out of season, no shifts): the record moves on, nothing posts.
    if (check.gross === 0) return { cents: 0, lines: [], extra: [payslipEvent(ctx, job, check, at)] };
    const withheld = taxTotal(check.taxes) + check.deductions.reduce((a, d) => a + d.cents, 0);
    const memo = withheld > 0 ? `Payroll: ${api.money(ctx, check.gross)} gross, ${api.money(ctx, withheld)} withheld` : "Payroll";
    const note = api.note(ctx, job.worker, "bill", `Payday: ${api.money(ctx, check.net)} net${withheld > 0 ? ` (${api.money(ctx, check.gross)} gross)` : ""}.`);
    return { cents: check.gross, lines: check.lines, memo, kind: "income", category: "payroll", extra: [payslipEvent(ctx, job, check, at), ...note] };
  });
  core.process({ id: "economy.timesheet", domain: "money", minLevel: 3, step: (slot, ctx) => timesheet(slot, ctx) });
  // Whoever works for an organization is on its people's list (ORG-SPEC §3.2): every group kind's and a trust's.
  core.membership(GROUP_KIND, staffRows);
  core.membership("trust", staffRows);
  // Hiring, letting go and pay are GM effects too (ORG-SPEC §7.2): with no `by`, the GM's, which ask for no power.
  core.effect({ type: "economy.hire", args: ["business", "worker", "title?", "occupation?", "basis?", "rate?", "hours?", "hours_per_week?", "pay_every?", "start?", "position?", "by?"], gm: true, resolve: (args, ctx) => hire(api, args, ctx) });
  core.effect({ type: "economy.job_end", args: ["job", "end?", "by?"], gm: true, resolve: (args, ctx) => endJob(args, ctx) });
  core.effect({ type: "economy.job_raise", args: ["job", "rate?", "pct?", "by?"], gm: true, resolve: (args, ctx) => raise(api, args, ctx) });
  core.effect({ type: "economy.job_hours", args: ["job", "hours_per_week", "by?"], resolve: (args, ctx) => setHours(api, args, ctx) });
  core.effect({ type: "economy.job_leave", args: ["job", "leave", "by?"], resolve: (args, ctx) => setLeave(args, ctx) });
  core.effect({ type: "economy.job_position", args: ["job", "position?", "by?"], resolve: (args, ctx) => setPosition(args, ctx) });
  core.effect({ type: "economy.job_title", args: ["job", "title?", "by?"], resolve: (args, ctx) => setTitle(args, ctx) });
  core.effect({ type: "economy.pay_schedule", args: ["org", "every", "weekday?", "anchor?", "days?", "by?"], resolve: (args, ctx) => paySchedule(args, ctx) });
  core.formula("employs", (ctx, employer, who) => allJobs(ctx).some((j) => j.party === String(employer ?? "") && j.worker === String(who ?? "") && j.status !== "ended"));
  const talks = { observable: "talks business" } as const;
  // Who decides someone's job (ORG-SPEC §3.7): its employer, when that is the actor, or whoever holds the power for it, within its limits and scope.
  const decides = (power: OrgPower): string => `job.employer == self or may(self, job.employer, '${power}')`;
  core.action({ id: "job_hire", label: "Hire", description: "Hire someone, for yourself or for an organization you hire for (a business, a household, the party), with a title, pay and a position.", pack: "economy", params: { business: { type: "ref", of: { kind: [...PARTY_KINDS] }, label: "Employer" }, worker: { type: "ref", ref: "person" }, title: { type: "text", optional: true }, basis: { type: "text", optional: true, label: "Pay basis" }, rate: { type: "money", optional: true, label: "Pay rate" }, hours_per_week: { type: "number", optional: true }, pay_every: { type: "text", optional: true, label: "Paid every" }, position: { type: "text", optional: true, label: "Position (one the employer defines)" } }, requires: ["business == self or may(self, business, 'staff.hire')", "not employs(business, worker)", "level.money >= 3"], outcomes: { default: [{ type: "economy.hire", args: { business: "business", worker: "worker", title: "=params.title", basis: "=params.basis", rate: "=params.rate", hours_per_week: "=params.hours_per_week", pay_every: "=params.pay_every", position: "=params.position", by: "self" } }] }, duration: "15", lexicon: ["hire", "take on", "give a job to"], ...talks });
  core.action({ id: "job_end", label: "End a job", description: "End a job: quit your own, or let someone go who works for you or an organization you let staff go for.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND } }, requires: [`job.worker == self or ${decides("staff.fire")}`, "job.status != 'ended'", "level.money >= 3"], outcomes: { default: [{ type: "economy.job_end", args: { job: "job", by: "self" } }] }, duration: "10", lexicon: ["fire", "let go", "quit", "resign", "hand in my notice"], ...talks });
  core.action({ id: "job_raise", label: "Give a raise", description: "Change the pay of someone who works for you or an organization you set staff pay for.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND }, rate: { type: "money", label: "New rate" } }, requires: [decides("staff.pay"), "rate > 0", "level.money >= 3"], outcomes: { default: [{ type: "economy.job_raise", args: { job: "job", rate: "=rate", by: "self" } }] }, duration: "5", lexicon: ["give a raise", "raise the pay", "pay more"], ...talks });
  core.action({ id: "job_hours", label: "Change hours", description: "Change the hours a week someone works for you or an organization you set staff hours for.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND }, hours_per_week: { type: "number", label: "Hours a week" } }, requires: [decides("staff.pay"), "job.status != 'ended'", "hours_per_week > 0", "level.money >= 3"], outcomes: { default: [{ type: "economy.job_hours", args: { job: "job", hours_per_week: "=hours_per_week", by: "self" } }] }, duration: "5", lexicon: ["change their hours", "cut their hours", "more hours", "full time", "part time"], ...talks });
  core.action({ id: "job_leave", label: "Put on leave", description: "Put someone who works for you or an organization you set staff leave for on leave: they keep the job and are paid nothing while it lasts.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND } }, requires: [decides("staff.pay"), "job.status == 'active'", "level.money >= 3"], outcomes: { default: [{ type: "economy.job_leave", args: { job: "job", leave: true, by: "self" } }] }, duration: "5", lexicon: ["put on leave", "give time off", "send on leave"], ...talks });
  core.action({ id: "job_return", label: "Back from leave", description: "Bring someone on leave back to work, paid again from their next payday.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND } }, requires: [decides("staff.pay"), "job.status == 'leave'", "level.money >= 3"], outcomes: { default: [{ type: "economy.job_leave", args: { job: "job", leave: false, by: "self" } }] }, duration: "5", lexicon: ["back from leave", "back to work", "end their leave"], ...talks });
  core.action({ id: "job_position", label: "Appoint to a position", description: "Promote or move someone who works for you or an organization you appoint for into one of its positions, or take them out of theirs.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND }, position: { type: "text", optional: true, label: "Position (one the employer defines; none to take them out of theirs)" } }, requires: [decides("members.appoint"), "job.status != 'ended'"], outcomes: { default: [{ type: "economy.job_position", args: { job: "job", position: "=params.position", by: "self" } }] }, duration: "5", lexicon: ["promote", "appoint", "make them", "move them to"], ...talks });
  core.action({ id: "job_title", label: "Change title", description: "Change the title a job goes by: your own, or that of someone who works for you or an organization you appoint for.", pack: "economy", params: { job: { type: "ref", ref: JOB_KIND }, title: { type: "text", optional: true, label: "Title (none clears it)" } }, requires: [`job.worker == self or ${decides("members.appoint")}`, "job.status != 'ended'"], outcomes: { default: [{ type: "economy.job_title", args: { job: "job", title: "=params.title", by: "self" } }] }, duration: "5", lexicon: ["change the job title", "retitle"], ...talks });
  core.action({ id: "org_pay_schedule", label: "Change pay schedule", description: "Set how often an organization you set staff pay for pays its staff, moving every job there to it.", pack: "economy", params: { org: { type: "ref", of: { kind: [GROUP_KIND, "trust"] }, label: "Organization" }, every: { type: "text", label: "weekly, biweekly, semimonthly or monthly" }, weekday: { type: "number", optional: true, label: "Payday weekday, weekly or biweekly (0 = Sunday)" }, anchor: { type: "text", optional: true, label: "First payday, weekly or biweekly (YYYY-MM-DD)" } }, requires: ["may(self, org, 'staff.pay')", "level.money >= 3"], outcomes: { default: [{ type: "economy.pay_schedule", args: { org: "org", every: "=params.every", weekday: "=params.weekday", anchor: "=params.anchor", by: "self" } }] }, duration: "2", observable: "does the paperwork", mechanical: true, lexicon: ["pay schedule", "change payday", "pay every other week"] });
  // An employer's payroll on its organization's page (ORG-SPEC §4.4), behind `money.view`, from Money 3: a company's always; anyone else's once it employs someone or sets its pay schedule or account.
  core.orgSection({
    id: "payroll",
    label: "Payroll",
    power: "money.view",
    build: (ctx, org, viewer) => {
      if (moneyLevel(ctx, org) < 3) return null;
      const employees = staffViews(ctx, api, org, viewer);
      const fields = own(ctx.state.entities, org)?.fields ?? {};
      const company = kindIs(ctx.registry, ctx.world, own(ctx.state.entities, org)?.kind ?? "", COMPANY_KIND);
      if (!company && employees.length === 0 && payScheduleOf(ctx, org) === null && strOf(fields.payroll_account) === "") return null;
      return { headcount: employees.length, payroll: payrollThisYear(ctx, api, org), employees } as unknown as JsonValue;
    },
  });
  r.view((ctx, party, _view, viewer) => (api.partyKind(ctx, party) === "person" ? { jobs: allJobs(ctx).filter((j) => j.worker === party).map((j) => jobView(ctx, api, j, viewer)) } : {}));
  // A character's own mind knows who they work for.
  r.summary((ctx, who) =>
    allJobs(ctx)
      .filter((j) => j.worker === who && j.status === "active")
      .map((j) => `${j.title} for ${employerName(ctx, j, null) || "an outside employer"}, ${api.money(ctx, j.rate)} ${BASIS_WORDS[j.basis]}, paid ${j.every === null ? "nothing" : j.every.replace("_", " ")}.`),
  );
}
