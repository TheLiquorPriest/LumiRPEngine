// The statement cycle (DESIGN §25.4): one engine for every credit product. A revolving account
// (a credit card, a charge card, a line of credit) closes a statement each month: interest only on
// a balance carried past the last statement (the opening balance is a first statement, not a
// carried one), fees, a minimum payment and a due date. Where statements don't run, its statement
// day still ends an interest period: interest on what's left of the balance the last one ended
// with. An installment loan or mortgage bills its payment each month and counts its term down
// until it is paid off. A missed due date brings the late fee, then delinquency stages (the penalty
// rate from 60 days, a freeze at 90, collections from 120, a charge-off after), each reported to
// the holders' credit histories. Deposit accounts earn their APY, and a checking account below its
// waiver pays its monthly fee. Each account's interest, what it comes to next and how it's worked
// out, is read here for its view too (`interestOutlook`), so the view says what the cycle does.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { FINANCE_EVENTS, featureOn, type CycleState, type DelinquencyStage, type ResolvedProduct } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, type Calendar } from "../../../engine/calendar";
import { labelOf, numOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { depreciateMonth, depreciationDue } from "./depreciation";
import { accrualOf, averageBalance, cycleOf, journalOf } from "./journal";
import { balance, bankSide, holdersOf, productOf, statusOf, traitsOf } from "./model";
import { noteOf, sweepNote } from "./notes";
import { accountLevel, asUnit, isParty, posting, signal, toggles } from "./pay";
import type { Run } from "./run";

/** Statements close and deposit interest posts in the bank's morning batch; payments are due by the end of the due day. */
const STATEMENT_MINUTE = 9 * 60 - 30;
const DUE_MINUTE = 23 * 60 + 59;
const INTEREST_MINUTE = 30;
/** An installment loan bills just after midnight on its due day, so the day's autopay finds the bill. */
const LOAN_BILL_MINUTE = 1;
/** What a project built and a mineral interest lose for the month just ended posts early on the 1st. */
const DEPRECIATION_MINUTE = 15;
/** A loan made's sweep lands the day's payments with the lender at the end of the day, after the day's autopay. */
const SWEEP_MINUTE = 23 * 60 + 58;

/** One thing the cycle engine does at an instant. */
export interface CycleTask {
  at: number;
  /** Order among tasks at the same instant. */
  rank: number;
  key: string;
  run(run: Run): void;
}

function feature(ctx: ReadContext, account: EntityId, f: Parameters<typeof featureOn>[1]): boolean {
  return featureOn(accountLevel(ctx, account), f, toggles(ctx.world));
}

/** Holders who carry an account's credit history: its owners and joint holders who are people. */
function creditHolders(ctx: ReadContext, account: EntityId): EntityId[] {
  return holdersOf(ctx.state, account).filter((h) => own(ctx.state.entities, h) && isParty(ctx, h) && ownerRoleCarriesCredit(ctx, account, h));
}

function ownerRoleCarriesCredit(ctx: ReadContext, account: EntityId, party: EntityId): boolean {
  const e = own(ctx.state.entities, account);
  const list = Array.isArray(e?.fields.owners) ? e.fields.owners : null;
  if (!list) return true;
  return list.some((o) => typeof o === "object" && o !== null && !Array.isArray(o) && o.party === party && (o.role === "owner" || o.role === "joint" || o.role === undefined));
}

/** The day a monthly date falls on after `day`: the first day of a later month whose day of month is `dom` (a short month's last day). */
function nextMonthDay(cal: Calendar, day: number, dom: number): number {
  for (let d = day + 1; d <= day + 62; d++) {
    const date = dateAt(cal, clockAt(cal, d, 0));
    const len = cal.system.monthLength(date.year, date.month);
    if (date.day === Math.min(dom, len)) return d;
  }
  return day + 25;
}

function inSlot(at: number, from: number, to: number): boolean {
  return at > from && at <= to;
}

/** The days of a month a monthly date names, clamped to short months. */
function monthlyAt(cal: Calendar, from: number, to: number, dom: number, minute: number): number[] {
  const out: number[] = [];
  for (let d = dateAt(cal, from).dayIndex; d <= dateAt(cal, to).dayIndex; d++) {
    const date = dateAt(cal, clockAt(cal, d, 0));
    if (date.day !== Math.min(dom, cal.system.monthLength(date.year, date.month))) continue;
    const at = clockAt(cal, d, minute);
    if (inSlot(at, from, to)) out.push(at);
  }
  return out;
}

/** Each day's `minute` in `(from, to]`. */
function dailyAt(cal: Calendar, from: number, to: number, minute: number): number[] {
  const out: number[] = [];
  for (let d = dateAt(cal, from).dayIndex; d <= dateAt(cal, to).dayIndex; d++) {
    const at = clockAt(cal, d, minute);
    if (inSlot(at, from, to)) out.push(at);
  }
  return out;
}

const NEXT_STAGE: Record<DelinquencyStage, DelinquencyStage> = { current: "late", late: "30", "30": "60", "60": "90", "90": "120", "120": "collections", collections: "charged_off", charged_off: "charged_off" };

/** The tasks the cycle engine has in `(from, to]`, read from the state before the slot. */
export function cycleTasks(ctx: ReadContext, from: number, to: number): CycleTask[] {
  const cal = calendarOf(ctx.world);
  const tasks: CycleTask[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (e?.kind !== "account") continue;
    const t = traitsOf(ctx, id);
    if (!t || holdersOf(ctx.state, id).every((h) => !own(ctx.state.entities, h))) continue;
    const level = accountLevel(ctx, id);
    if (level < 3) continue;
    const status = statusOf(ctx.state, id);
    if (status === "closed" || status === "charged_off" || status === "paid_off" || status === "matured") continue;
    const p = productOf(ctx, id);
    if (!p) continue;
    if (t.revolving && feature(ctx, id, "statements")) {
      for (const at of monthlyAt(cal, from, to, p.statement_day, STATEMENT_MINUTE)) tasks.push({ at, rank: 1, key: `statement:${id}`, run: (run) => closeRevolving(run, id, at) });
    } else if (t.revolving && feature(ctx, id, "interest") && (p.apr_pct > 0 || p.cash_advance_apr_pct > 0)) {
      for (const at of monthlyAt(cal, from, to, p.statement_day, STATEMENT_MINUTE)) tasks.push({ at, rank: 1, key: `period:${id}`, run: (run) => closePeriod(run, id, at) });
    }
    if (t.installment) {
      const dom = typeof e.fields.due_day === "number" ? e.fields.due_day : p.statement_day;
      for (const at of monthlyAt(cal, from, to, dom, LOAN_BILL_MINUTE)) tasks.push({ at, rank: 1, key: `bill:${id}`, run: (run) => billInstallment(run, id, at) });
    }
    const cycle = cycleOf(ctx.state, id);
    if (cycle && (t.revolving || t.installment)) {
      const dueDay = dateAt(cal, cycle.due).dayIndex;
      const morning = clockAt(cal, dueDay, 9 * 60 + 30);
      if (inSlot(morning, from, to) && strOf(e.fields.autopay, "none") === "none") tasks.push({ at: morning, rank: 4, key: `remind:${id}`, run: (run) => remind(run, id) });
      // A loan between parties takes no late fee and no delinquency: what it hasn't been paid it still owes.
      if (inSlot(cycle.due, from, to) && feature(ctx, id, "delinquency") && noteOf(ctx, id) === null) tasks.push({ at: cycle.due, rank: 5, key: `due:${id}`, run: (run) => dueCheck(run, id, cycle.due) });
    }
    if (t.receivable) for (const at of dailyAt(cal, from, to, SWEEP_MINUTE)) tasks.push({ at, rank: 6, key: `sweep:${id}`, run: (run) => sweepNote(run, id, at) });
    if (t.earns && feature(ctx, id, "interest") && (p.apy_pct > 0 || p.fees.maintenance > 0)) {
      for (const at of monthlyAt(cal, from, to, 1, INTEREST_MINUTE)) tasks.push({ at, rank: 2, key: `interest:${id}`, run: (run) => monthEnd(run, id, at) });
    } else if (t.transactional && feature(ctx, id, "fees") && p.fees.maintenance > 0) {
      for (const at of monthlyAt(cal, from, to, 1, INTEREST_MINUTE)) tasks.push({ at, rank: 2, key: `interest:${id}`, run: (run) => monthEnd(run, id, at) });
    }
    const pending = journalOf(ctx.state, id).filter((j) => j.status === "pending" && typeof j.settles === "number" && j.settles <= to);
    if (pending.length > 0) {
      const upto = Math.max(...pending.map((j) => numOf(j.settles)));
      tasks.push({ at: Math.max(from + 1, Math.min(to, upto)), rank: 0, key: `settle:${id}`, run: (run) => void run.emit([{ type: FINANCE_EVENTS.settle, data: { account: id, upto } }]) });
    }
  }
  if (depreciationDue(ctx)) for (const at of monthlyAt(cal, from, to, 1, DEPRECIATION_MINUTE)) tasks.push({ at, rank: 3, key: "depreciation", run: (run) => depreciateMonth(run, at) });
  return tasks;
}

function money(ctx: ReadContext, cents: number): string {
  return formatMoney(cents, ctx.world.currency);
}

/** Tells each holder who is a party: a signal for the POV, a private note for anyone else. */
function tell(run: Run, account: EntityId, cls: "bill" | "decline", text: string, at: number): void {
  const holders = holdersOf(run.ctx.state, account).filter((h) => own(run.ctx.state.entities, h) && isParty(run.ctx, h));
  run.emit(holders.map((h) => signal(cls, text, h, at)));
}

function bankLines(account: EntityId, institution: string, cents: number): PostingLine[] {
  return [
    { account, amount: -cents },
    { account: bankSide(institution), amount: cents },
  ];
}

/** The annual fee falls due in the month the account was opened (January when it doesn't say). */
function annualFeeDue(ctx: ReadContext, account: EntityId, at: number): boolean {
  const opened = strOf(own(ctx.state.entities, account)?.fields.opened);
  const month = /^\d{4}-(\d{2})/.exec(opened)?.[1];
  return dateAt(calendarOf(ctx.world), at).month === (month ? Number(month) : 1);
}

/** What a revolving account's interest period reads: whether it is in grace, what was carried into it, at what rate, and whether it runs on the average daily balance from `since`. */
interface Period {
  grace: boolean;
  carried: number;
  apr: number;
  daily: boolean;
  since: number;
}

/** A period that ends at a statement: grace on a first statement and after one paid in full, the penalty rate while it applies. */
function statementPeriod(ctx: ReadContext, account: EntityId, p: ResolvedProduct): Period {
  const prev = cycleOf(ctx.state, account);
  return {
    grace: !prev || prev.closing <= 0 || prev.paid >= prev.closing,
    carried: Math.max(0, (prev?.closing ?? 0) - (prev?.paid ?? 0)),
    apr: prev?.penalty && p.penalty_apr_pct > 0 ? p.penalty_apr_pct : p.apr_pct,
    daily: feature(ctx, account, "average_daily") && p.interest === "average_daily" && prev !== null,
    since: accrualOf(ctx.state, account)?.from ?? prev?.at ?? 0,
  };
}

/** A period where statements don't run: from the last statement day, owing what it owed then (none recorded: a first period, in grace), less what was paid since. */
function openPeriod(ctx: ReadContext, account: EntityId, p: ResolvedProduct): Period {
  const acc = accrualOf(ctx.state, account);
  const owed = acc?.owed;
  const paid = acc?.paid ?? 0;
  return {
    grace: owed === undefined || owed <= 0 || paid >= owed,
    carried: owed === undefined ? 0 : Math.max(0, owed - paid),
    apr: p.apr_pct,
    daily: feature(ctx, account, "average_daily") && p.interest === "average_daily" && owed !== undefined,
    since: acc?.from ?? 0,
  };
}

/**
 * What a revolving account's period ending at `at` charges, read from the state as it stands:
 * interest on what was carried into it (none in grace), on the average daily balance where that
 * runs; and a cash advance's own rate from the day it was drawn, grace or not (less the purchase
 * rate the average daily balance already charged on it). Null without a product.
 */
export function revolvingCharges(ctx: ReadContext, account: EntityId, at: number): { interest: number; advance: number; apr: number; grace: boolean } | null {
  const p = productOf(ctx, account);
  if (!p) return null;
  const period = feature(ctx, account, "statements") ? statementPeriod(ctx, account, p) : openPeriod(ctx, account, p);
  const runs = feature(ctx, account, "interest");
  let interest = 0;
  if (!period.grace && runs && period.apr > 0) {
    if (period.daily) {
      const owedOnAverage = Math.max(0, -averageBalance(ctx.state, account, at));
      const days = Math.max(1, (at - period.since) / 1440);
      interest = Math.round((owedOnAverage * period.apr * days) / 100 / 365);
    } else interest = Math.round((period.carried * period.apr) / 100 / 12);
  }
  const acc = accrualOf(ctx.state, account);
  const held = acc ? acc.advanced * (at - acc.from) - acc.advancedAt : 0;
  const advanceApr = p.cash_advance_apr_pct - (!period.grace && period.daily && period.apr > 0 ? period.apr : 0);
  const advance = runs && advanceApr > 0 && held > 0 ? Math.round((held * advanceApr) / 100 / (365 * 1440)) : 0;
  return { interest, advance, apr: period.apr, grace: period.grace };
}

/** Posts a period's interest and its cash advance interest; returns the interest it counts (the advance's only where it posted). */
function postCharges(run: Run, account: EntityId, institution: string, charges: { interest: number; advance: number }, at: number): number {
  const name = labelOf(run.ctx, account);
  if (charges.interest > 0) run.emit(asUnit(posting(bankLines(account, institution, charges.interest), { memo: `${name} interest`, kind: "interest", category: "interest", at })));
  const advance = charges.advance > 0 && run.emit(asUnit(posting(bankLines(account, institution, charges.advance), { memo: `${name} cash advance interest`, kind: "interest", category: "interest", at }))).length > 0 ? charges.advance : 0;
  return charges.interest + advance;
}

/** A revolving account's statement closes. */
function closeRevolving(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  const charges = revolvingCharges(ctx, account, at);
  if (!p || !charges) return;
  const prev = cycleOf(ctx.state, account);
  const name = labelOf(ctx, account);
  const { grace, apr } = charges;
  const interest = postCharges(run, account, p.institution, charges, at);
  let fees = 0;
  if (feature(ctx, account, "fees") && p.fees.annual > 0 && annualFeeDue(ctx, account, at)) {
    if (run.emit(asUnit(posting(bankLines(account, p.institution, p.fees.annual), { memo: `${name} annual fee`, kind: "fee", category: "annual_fee", at }))).length > 0) fees += p.fees.annual;
  }
  const spent = accrualOf(ctx.state, account)?.spent ?? 0;
  if (p.rewards_pct > 0 && spent > 0) {
    const rewards = Math.round((spent * p.rewards_pct) / 100);
    if (rewards > 0) run.emit(asUnit(posting([{ account: bankSide(p.institution), amount: -rewards }, { account, amount: rewards }], { memo: `${name} rewards`, kind: "rewards", category: "rewards", at })));
  }
  const owed = Math.max(0, -balance(ctx.state, account));
  const principal = Math.max(0, owed - interest - fees);
  const pastDue = carriedPastDue(prev);
  const regular = owed <= 0 ? 0 : Math.min(owed, Math.max(p.minimum.floor, Math.ceil((principal * p.minimum.pct) / 100 + (p.minimum.plus_interest ? interest + fees : 0))));
  const minimum = Math.min(owed, regular + pastDue);
  const cal = calendarOf(ctx.world);
  const day = dateAt(cal, at).dayIndex;
  const dueDom = numOf(own(ctx.state.entities, account)?.fields.due_day, NaN);
  const due = clockAt(cal, Number.isFinite(dueDom) ? nextMonthDay(cal, day, dueDom) : day + p.due_days, DUE_MINUTE);
  run.emit([{ type: FINANCE_EVENTS.statement, data: { account, closing: owed, interest, fees, minimum, due, apr, stage: prev?.stage ?? "current", grace, past_due: pastDue, lates: prev?.lates ?? 0, penalty: prev?.penalty === true, at, streak: prev?.streak ?? 0, ontime: prev?.ontime ?? 0, late30: prev?.late30 ?? 0, late60: prev?.late60 ?? 0, late90: prev?.late90 ?? 0 } }]);
  if (owed > 0) tell(run, account, "bill", `${name} statement: ${money(ctx, owed)}${interest > 0 ? ` incl. ${money(ctx, interest)} interest` : ""}; minimum ${money(ctx, minimum)} due ${dateLabel(ctx, due)}.`, at);
}

/** A revolving account's statement day where statements don't run: the period's interest, and what it owes now kept for the next period. */
function closePeriod(run: Run, account: EntityId, at: number): void {
  const p = productOf(run.ctx, account);
  const charges = revolvingCharges(run.ctx, account, at);
  if (!p || !charges) return;
  postCharges(run, account, p.institution, charges, at);
  run.emit([{ type: FINANCE_EVENTS.accrue, data: { account, at, owed: Math.max(0, -balance(run.ctx.state, account)) } }]);
}

function dateLabel(ctx: ReadContext, at: number): string {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, at);
  return `${d.day} ${cal.system.monthNames[d.month - 1] ?? d.month}`;
}

/** What a statement carries as past due: what the last one left unpaid of its minimum (a late payment counts), never more than was past due. */
function carriedPastDue(prev: CycleState | null): number {
  return prev ? Math.max(0, Math.min(prev.past_due ?? 0, prev.minimum - prev.paid)) : 0;
}

/** The level payment that pays `owed` off over `months` at a monthly rate. */
export function amortized(owed: number, rate: number, months: number): number {
  if (months <= 0) return owed;
  return rate > 0 ? (owed * rate) / (1 - Math.pow(1 + rate, -months)) : owed / months;
}

/** A loan's yearly rate now: its penalty rate while that applies, else its APR. */
function loanApr(ctx: ReadContext, account: EntityId, p: ResolvedProduct): number {
  return cycleOf(ctx.state, account)?.penalty && p.penalty_apr_pct > 0 ? p.penalty_apr_pct : p.apr_pct;
}

/** An installment loan's month: interest on what it owes, its payment due today, its term one month shorter. */
function billInstallment(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  const e = own(ctx.state.entities, account);
  if (!p || !e) return;
  const prev = cycleOf(ctx.state, account);
  const owed = Math.max(0, -balance(ctx.state, account));
  // A loan between parties owes its lender's note, not a bank: no credit report hears of it.
  const note = noteOf(ctx, account);
  if (owed <= 0) {
    run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "paid_off" } }, ...(note === null ? creditEntries(ctx, account, "paid_off", at) : [])]);
    return;
  }
  const authoredMonths = numOf(e.fields.months_left, numOf(e.fields.remaining_months, p.term_months ?? 0));
  const months = Math.max(1, Math.round(prev?.months_left !== undefined ? prev.months_left : authoredMonths > 0 ? authoredMonths : 1));
  const apr = loanApr(ctx, account, p);
  const rate = feature(ctx, account, "interest") ? apr / 100 / 12 : 0;
  const interest = Math.round(owed * rate);
  const name = labelOf(ctx, account);
  if (interest > 0) {
    // Its interest is the lender's as much as the borrower's: equal and opposite on the note.
    const lines = note === null ? bankLines(account, p.institution, interest) : [{ account, amount: -interest }, { account: note, amount: interest }];
    const sides = note === null ? {} : { counterparty: holdersOf(ctx.state, note)[0] ?? note, payer: holdersOf(ctx.state, account)[0] ?? account };
    run.emit(asUnit(posting(lines, { memo: `${name} interest`, kind: "interest", category: "interest", ...sides, at })));
  }
  const total = owed + interest;
  const payment = typeof e.fields.payment === "number" && e.fields.payment > 0 ? e.fields.payment : Math.round(amortized(owed, rate, months));
  // The last month takes what's left, so a loan finishes at its term.
  const due = months <= 1 ? total : Math.min(total, Math.round(payment));
  const pastDue = carriedPastDue(prev);
  const minimum = Math.min(total, due + pastDue);
  const cal = calendarOf(ctx.world);
  run.emit([{ type: FINANCE_EVENTS.statement, data: { account, closing: total, interest, fees: 0, minimum, due: clockAt(cal, dateAt(cal, at).dayIndex, DUE_MINUTE), apr, stage: prev?.stage ?? "current", grace: true, past_due: pastDue, lates: prev?.lates ?? 0, penalty: prev?.penalty === true, months_left: Math.max(0, months - 1), at, streak: prev?.streak ?? 0, ontime: prev?.ontime ?? 0, late30: prev?.late30 ?? 0, late60: prev?.late60 ?? 0, late90: prev?.late90 ?? 0 } }]);
}

/** On the due day of an account without autopay: the payment is due today. */
function remind(run: Run, account: EntityId): void {
  const ctx = run.ctx;
  const cycle = cycleOf(ctx.state, account);
  if (!cycle) return;
  const left = cycle.minimum - cycle.paid;
  if (left > 0) tell(run, account, "bill", `${labelOf(ctx, account)} payment of ${money(ctx, left)} is due today.`, cycle.due - (DUE_MINUTE - (9 * 60 + 30)));
}

function creditEntries(ctx: ReadContext, account: EntityId, kind: "late" | "collections" | "charged_off" | "paid_off" | "on_time", at: number, days?: number): LedgerEvent[] {
  return creditHolders(ctx, account).map((person) => ({ type: FINANCE_EVENTS.credit, data: { person, kind, account, at, ...(days !== undefined ? { days } : {}) } }));
}

/** The end of a due day: paid on time, or late (a fee, a later stage, its report and its consequences). */
function dueCheck(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const cycle = cycleOf(ctx.state, account);
  const p = productOf(ctx, account);
  if (!cycle || !p || cycle.minimum <= 0) return;
  const name = labelOf(ctx, account);
  if (cycle.paid >= cycle.minimum) {
    const streak = (cycle.streak ?? 0) + 1;
    const lifted = cycle.penalty && streak >= 6;
    run.emit([{ type: FINANCE_EVENTS.delinquency, data: { account, stage: "current", past_due: 0, lates: streak >= 6 ? 0 : cycle.lates, penalty: cycle.penalty && !lifted, streak, ontime: (cycle.ontime ?? 0) + 1 } }]);
    if (statusOf(ctx.state, account) === "frozen" && cycle.stage !== "current") run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "open" } }]);
    if (lifted) tell(run, account, "bill", `${name}: six payments on time; the penalty rate is lifted.`, at);
    return;
  }
  const short = cycle.minimum - cycle.paid;
  const stage = NEXT_STAGE[cycle.stage];
  let fee = 0;
  if (feature(ctx, account, "fees") && stage !== "charged_off") {
    const base = cycle.lates > 0 ? p.fees.late_repeat : p.fees.late_first;
    // A late fee never exceeds the minimum payment it is charged for (Regulation Z).
    fee = Math.min(base, cycle.minimum);
    if (fee > 0) run.emit(asUnit(posting(bankLines(account, p.institution, fee), { memo: `${name} late fee`, kind: "fee", category: "late_fee", at })));
  }
  const penalty = cycle.penalty || ((stage === "60" || stage === "90" || stage === "120" || stage === "collections") && p.penalty_apr_pct > 0);
  const counters = { late30: (cycle.late30 ?? 0) + (stage === "30" ? 1 : 0), late60: (cycle.late60 ?? 0) + (stage === "60" ? 1 : 0), late90: (cycle.late90 ?? 0) + (stage === "90" ? 1 : 0) };
  run.emit([{ type: FINANCE_EVENTS.delinquency, data: { account, stage, past_due: short, lates: cycle.lates + 1, penalty, streak: 0, ontime: cycle.ontime ?? 0, ...counters } }]);
  const days: Partial<Record<DelinquencyStage, number>> = { "30": 30, "60": 60, "90": 90 };
  const reported = own(days, stage);
  if (reported !== undefined) run.emit(creditEntries(ctx, account, "late", at, reported));
  if (stage === "90") run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "frozen" } }]);
  if (stage === "120") run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "collections" } }, ...creditEntries(ctx, account, "collections", at)]);
  if (stage === "charged_off") run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "charged_off" } }, ...creditEntries(ctx, account, "charged_off", at)]);
  const what = stage === "late" ? "missed" : stage === "120" ? "sent to collections" : stage === "charged_off" ? "charged off" : stage === "collections" ? "still in collections" : `${stage} days late`;
  tell(run, account, "decline", `${name} payment of ${money(ctx, short)} ${what}${fee > 0 ? `; a ${money(ctx, fee)} late fee was charged` : ""}${penalty && !cycle.penalty ? `; the penalty rate of ${p.penalty_apr_pct}% applies` : ""}.`, at);
}

/** What a deposit account's interest comes to at `at`, read from the state as it stands: its APY on the average daily balance where that runs, else a month's on the balance. */
function depositInterest(ctx: ReadContext, account: EntityId, at: number): number {
  const p = productOf(ctx, account);
  if (!p || !feature(ctx, account, "interest") || !(p.apy_pct > 0)) return 0;
  const a = accrualOf(ctx.state, account);
  const average = feature(ctx, account, "average_daily") && p.interest === "average_daily" ? averageBalance(ctx.state, account, at) : balance(ctx.state, account);
  if (!(average > 0)) return 0;
  const days = a && feature(ctx, account, "average_daily") ? Math.max(1, (at - a.from) / 1440) : 365 / 12;
  return Math.round((average * p.apy_pct * days) / 100 / 365);
}

/** A deposit account's month: interest at its APY (on the average daily balance where that runs), and a checking account's fee below its waiver. */
function monthEnd(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  if (!p) return;
  const name = labelOf(ctx, account);
  const average = feature(ctx, account, "average_daily") && p.interest === "average_daily" ? averageBalance(ctx.state, account, at) : balance(ctx.state, account);
  const interest = depositInterest(ctx, account, at);
  if (interest > 0) run.emit(asUnit(posting([{ account: bankSide(p.institution), amount: -interest }, { account, amount: interest }], { memo: `${name} interest`, kind: "interest", category: "interest", at })));
  if (feature(ctx, account, "fees") && p.fees.maintenance > 0 && Math.min(balance(ctx.state, account), average) < p.fees.maintenance_waive) {
    run.emit(asUnit(posting(bankLines(account, p.institution, p.fees.maintenance), { memo: `${name} monthly fee`, kind: "fee", category: "maintenance", at })));
  }
  run.emit([{ type: FINANCE_EVENTS.accrue, data: { account, at } }]);
}

/** A statement's state for views: paid in full, the minimum met, still open, or late. */
export function statementState(cycle: CycleState, now: number): "paid" | "minimum" | "open" | "late" {
  if (cycle.paid >= cycle.closing) return "paid";
  if (cycle.paid >= cycle.minimum) return "minimum";
  return now > cycle.due || cycle.stage !== "current" ? "late" : "open";
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** An account's interest as the cycle runs it: earned or charged, the rate now, how it's worked out in words, and its next posting with what it comes to if nothing changes before then. */
export interface InterestOutlook {
  way: "earns" | "charges";
  ratePct: number;
  basis: string;
  next: { at: number; cents: number } | null;
}

/**
 * An account's interest where it runs for the account (the `interest` feature, from Money 3) and
 * the account has a rate: a deposit account's APY, posted on the 1st; a revolving account's APR,
 * charged on its statement day (at a statement where statements run); a loan's, billed with its
 * payment. Its next posting is worked out as the cycle will, from the state now, so it is what
 * posts if nothing changes before then; an account that no longer runs (closed, charged off, paid
 * off, matured) has none. Null where no interest runs.
 */
export function interestOutlook(ctx: ReadContext, account: EntityId, now: number): InterestOutlook | null {
  const t = traitsOf(ctx, account);
  const p = productOf(ctx, account);
  const e = own(ctx.state.entities, account);
  if (!t || !p || !e || !feature(ctx, account, "interest")) return null;
  const cal = calendarOf(ctx.world);
  const horizon = now + 62 * 1440;
  const status = statusOf(ctx.state, account);
  const runs = status !== "closed" && status !== "charged_off" && status !== "paid_off" && status !== "matured";
  const daily = feature(ctx, account, "average_daily") && p.interest === "average_daily";
  const at = (dom: number, minute: number): number | null => (runs ? (monthlyAt(cal, now, horizon, dom, minute)[0] ?? null) : null);
  if (t.earns && p.apy_pct > 0) {
    const next = at(1, INTEREST_MINUTE);
    return { way: "earns", ratePct: p.apy_pct, basis: `${daily ? "On the average daily balance" : "On the balance"}, paid on the 1st of each month`, next: next === null ? null : { at: next, cents: depositInterest(ctx, account, next) } };
  }
  if (t.revolving && (p.apr_pct > 0 || p.cash_advance_apr_pct > 0)) {
    const next = at(p.statement_day, STATEMENT_MINUTE);
    const charges = revolvingCharges(ctx, account, next ?? now);
    const statements = feature(ctx, account, "statements");
    const how = statements ? `${daily ? "On the average daily balance" : "On what's left of a statement's balance"} when a statement isn't paid in full, charged as the next statement closes on the ${ordinal(p.statement_day)}` : `${daily ? "On the average daily balance" : "On what's left of the balance owed"} when the last ${ordinal(p.statement_day)} of the month's balance isn't paid in full, charged on the ${ordinal(p.statement_day)}`;
    const advance = p.cash_advance_apr_pct > 0 ? `; cash advances ${p.cash_advance_apr_pct}% from the day they're drawn` : "";
    return { way: "charges", ratePct: charges?.apr ?? p.apr_pct, basis: `${how}${advance}`, next: next === null || !charges ? null : { at: next, cents: charges.interest + charges.advance } };
  }
  if (t.installment && p.apr_pct > 0) {
    const dom = typeof e.fields.due_day === "number" ? e.fields.due_day : p.statement_day;
    const next = at(dom, LOAN_BILL_MINUTE);
    const owed = Math.max(0, -balance(ctx.state, account));
    const apr = loanApr(ctx, account, p);
    // Interest runs here (checked above), so the bill charges the monthly rate on what's owed, worked out as the bill does.
    return { way: "charges", ratePct: apr, basis: `On what's owed, billed with each payment on the ${ordinal(dom)}`, next: next === null || owed <= 0 ? null : { at: next, cents: Math.round(owed * (apr / 100 / 12)) } };
  }
  return null;
}
