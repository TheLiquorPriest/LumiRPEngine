// The statement cycle (DESIGN §25.6): one engine for every credit product. A revolving account
// (a credit card, a charge card, a line of credit) closes a statement each month: interest only on
// a balance carried past the last statement (the opening balance is a first statement, not a
// carried one), fees, a minimum payment and a due date. An installment loan or mortgage bills its
// payment each month and counts its term down until it is paid off. A missed due date brings the
// late fee, then delinquency stages (the penalty rate from 60 days, a freeze at 90, collections
// from 120, a charge-off after), each reported to the holders' credit histories. Deposit accounts
// earn their APY, and a checking account below its waiver pays its monthly fee.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { FINANCE_EVENTS, featureOn, type CycleState, type DelinquencyStage } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, type Calendar } from "../../../engine/calendar";
import { labelOf, numOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { accrualOf, averageBalance, cycleOf, journalOf } from "./journal";
import { balance, bankSide, holdersOf, productOf, statusOf, traitsOf } from "./model";
import { accountLevel, asUnit, isParty, posting, signal, toggles } from "./pay";
import type { Run } from "./run";

/** Statements close and deposit interest posts in the bank's morning batch; payments are due by the end of the due day. */
const STATEMENT_MINUTE = 9 * 60 - 30;
const DUE_MINUTE = 23 * 60 + 59;
const INTEREST_MINUTE = 30;
/** An installment loan bills just after midnight on its due day, so the day's autopay finds the bill. */
const LOAN_BILL_MINUTE = 1;

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
      if (inSlot(cycle.due, from, to) && feature(ctx, id, "delinquency")) tasks.push({ at: cycle.due, rank: 5, key: `due:${id}`, run: (run) => dueCheck(run, id, cycle.due) });
    }
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

/** A revolving account's statement closes. */
function closeRevolving(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  if (!p) return;
  const prev = cycleOf(ctx.state, account);
  const name = labelOf(ctx, account);
  // Grace (and so no interest) holds on a first statement and after one paid in full.
  const grace = !prev || prev.closing <= 0 || prev.paid >= prev.closing;
  const apr = prev?.penalty && p.penalty_apr_pct > 0 ? p.penalty_apr_pct : p.apr_pct;
  let interest = 0;
  if (!grace && feature(ctx, account, "interest") && apr > 0) {
    if (feature(ctx, account, "average_daily") && p.interest === "average_daily" && prev) {
      const owedOnAverage = Math.max(0, -averageBalance(ctx.state, account, at));
      const days = Math.max(1, (at - (accrualOf(ctx.state, account)?.from ?? prev.at)) / 1440);
      interest = Math.round((owedOnAverage * apr * days) / 100 / 365);
    } else {
      const carried = Math.max(0, (prev?.closing ?? 0) - (prev?.paid ?? 0));
      interest = Math.round((carried * apr) / 100 / 12);
    }
  }
  if (interest > 0) run.emit(asUnit(posting(bankLines(account, p.institution, interest), { memo: `${name} interest`, kind: "interest", category: "interest", at })));
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

/** An installment loan's month: interest on what it owes, its payment due today, its term one month shorter. */
function billInstallment(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  const e = own(ctx.state.entities, account);
  if (!p || !e) return;
  const prev = cycleOf(ctx.state, account);
  const owed = Math.max(0, -balance(ctx.state, account));
  if (owed <= 0) {
    run.emit([{ type: FINANCE_EVENTS.status, data: { account, status: "paid_off" } }, ...creditEntries(ctx, account, "paid_off", at)]);
    return;
  }
  const authoredMonths = numOf(e.fields.months_left, numOf(e.fields.remaining_months, p.term_months ?? 0));
  const months = Math.max(1, Math.round(prev?.months_left !== undefined ? prev.months_left : authoredMonths > 0 ? authoredMonths : 1));
  const apr = prev?.penalty && p.penalty_apr_pct > 0 ? p.penalty_apr_pct : p.apr_pct;
  const rate = feature(ctx, account, "interest") ? apr / 100 / 12 : 0;
  const interest = Math.round(owed * rate);
  const name = labelOf(ctx, account);
  if (interest > 0) run.emit(asUnit(posting(bankLines(account, p.institution, interest), { memo: `${name} interest`, kind: "interest", category: "interest", at })));
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

/** A deposit account's month: interest at its APY (on the average daily balance where that runs), and a checking account's fee below its waiver. */
function monthEnd(run: Run, account: EntityId, at: number): void {
  const ctx = run.ctx;
  const p = productOf(ctx, account);
  if (!p) return;
  const name = labelOf(ctx, account);
  const a = accrualOf(ctx.state, account);
  const average = feature(ctx, account, "average_daily") && p.interest === "average_daily" ? averageBalance(ctx.state, account, at) : balance(ctx.state, account);
  if (feature(ctx, account, "interest") && p.apy_pct > 0 && average > 0) {
    const days = a && feature(ctx, account, "average_daily") ? Math.max(1, (at - a.from) / 1440) : 365 / 12;
    const interest = Math.round((average * p.apy_pct * days) / 100 / 365);
    if (interest > 0) run.emit(asUnit(posting([{ account: bankSide(p.institution), amount: -interest }, { account, amount: interest }], { memo: `${name} interest`, kind: "interest", category: "interest", at })));
  }
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
