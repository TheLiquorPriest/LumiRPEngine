// Loans between parties (DESIGN §25.4, "Loans between parties"): a company lending to its
// subsidiary, a person lending to a friend's business. `economy.lend` opens two accounts and moves
// the cash in one unit: the lender's note (class `note`: an asset and a receivable, never cash, so
// nothing pays from it) and the borrower's loan, an installment loan whose `note` names the note.
// The loan bills as any loan does (`cycle.ts`), but its interest posts against the note, equal and
// opposite, and it takes no late fee, delinquency or credit-report entry. Its autopay pays the loan,
// and a daily sweep lands what the loan was paid with the lender, so a payment reaches the lender
// the day it is made; paid off, both close. Between a parent and the companies it controls the note
// and the loan cancel: neither is cash, and the note counts in the parent's net worth as the loan
// counts against the subsidiary's.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { FINANCE_ACTIONS, FINANCE_EVENTS, PARTY_KINDS } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { Working } from "../../../engine/working";
import { actAs, asParam, mayAs, moneyWords } from "./acting";
import { reject } from "./journal";
import { availableOf, balance, holdersOf, statusOf, traitsOf } from "./model";
import type { FinanceApi, FinanceRegistry } from "./module";
import { asUnit, depositAccount, isParty, posting, signal } from "./pay";
import { openingEvent } from "./process";
import type { Run } from "./run";

/** The note a loan between parties is owed to (its `note` field, naming an account of class `note`), or null for a bank's loan. */
export function noteOf(ctx: ReadContext, loan: EntityId): EntityId | null {
  const note = strOf(own(ctx.state.entities, loan)?.fields.note);
  return note !== "" && traitsOf(ctx, note)?.receivable === true ? note : null;
}

/** Whoever holds an account: its first holder in the world. */
function holderOf(ctx: ReadContext, account: EntityId): EntityId {
  return holdersOf(ctx.state, account).find((h) => own(ctx.state.entities, h) !== undefined) ?? "";
}

/** A party's accounts a loan may be paid out of: open, theirs to spend, that pay and aren't credit, by their deposit rank; the one it names first. */
function lendingSources(api: FinanceApi, ctx: ReadContext, party: EntityId): EntityId[] {
  const rank = (a: EntityId): number => api.traitsOf(ctx, a)?.depositRank ?? 99;
  return api
    .accountsOf(ctx, party, "spend")
    .filter((a) => {
      const t = api.traitsOf(ctx, a);
      return t !== null && t.pays && !t.liability && !t.cash && api.mayUse(ctx, party, a, "from") === null;
    })
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** A new account id for a party's loan account: its holder's, the kind and a hash, never one in use. */
function newId(ctx: ReadContext, party: EntityId, kind: "note" | "loan", other: EntityId): EntityId {
  let id = `${party}_${kind}_${hashParts(party, kind, other, ctx.state.clock).slice(0, 6)}`;
  while (own(ctx.state.entities, id)) id = `${id}x`;
  return id;
}

/**
 * `economy.lend`: `who` (or the organization `by` lends as) lends `to` `cents` from `from` (else
 * its first account that pays and covers it) into `into` (else the borrower's deposit account), at
 * `apr` percent a year over `months` (12 by default), billed on `due_day` (today's, at most the
 * 28th), with `payment` when it is fixed. Whoever acts must also borrow for the borrower: themselves,
 * or an organization where they hold `money.borrow`. A note, a loan with autopay from where the money
 * landed, and the cash moved, as one unit; either side's authored accounts not yet open open first,
 * as showing them would, so a loan at a chat's start draws on the money its accounts show.
 */
export function lendEvents(api: FinanceApi, ctx: ReadContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const claimed = new Set<EntityId>();
  const opening = [strOf(a.who) || strOf(a.by) || ctx.world.pov, strOf(a.to)].flatMap((p) => (own(ctx.state.entities, p) ? (openingEvent(ctx, p, claimed) ?? []) : []));
  if (opening.length === 0) return lendNow(api, ctx, a);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  for (const e of opening) {
    const bad = w.apply(e);
    if (bad) return bad;
  }
  const lent = lendNow(api, w.ctx, a);
  return Array.isArray(lent) ? [...opening, ...lent] : lent;
}

function lendNow(api: FinanceApi, ctx: ReadContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const by = strOf(a.by);
  const lender = strOf(a.who) || by || ctx.world.pov;
  const borrower = strOf(a.to);
  const cents = Math.round(numOf(a.cents));
  if (!own(ctx.state.entities, lender) || api.partyKind(ctx, lender) === null) return reject("missing_entity", "there's no one to lend it");
  if (!own(ctx.state.entities, borrower) || api.partyKind(ctx, borrower) === null) return reject("missing_entity", "there's no one to borrow it");
  if (borrower === lender) return reject("bad_party", `${labelOf(ctx, lender)} can't lend to itself`);
  if (!(cents > 0)) return reject("bad_amount", "a loan needs an amount");
  for (const party of [lender, borrower]) if (ctx.levelOf(party, "money") < 3) return reject("level", `${labelOf(ctx, party)}'s money isn't followed closely enough for loans between parties (Money 3)`);
  const apr = typeof a.apr === "number" && a.apr >= 0 ? a.apr : 0;
  const months = typeof a.months === "number" && a.months >= 1 ? Math.round(a.months) : 12;
  const named = strOf(a.from);
  const sources = lendingSources(api, ctx, lender);
  if (named !== "" && !sources.includes(named)) return reject("bad_account", `${labelOf(ctx, lender)} can't lend from ${labelOf(ctx, named)}`);
  const source = named !== "" ? named : sources.find((s) => availableOf(ctx, s) >= cents);
  if (!source) return reject("insufficient_funds", `${labelOf(ctx, lender)} has no account with ${moneyWords(ctx, cents)} to lend`);
  if (availableOf(ctx, source) < cents) return reject("insufficient_funds", `${labelOf(ctx, source)} has less than ${moneyWords(ctx, cents)}`);
  const into = strOf(a.into) || api.depositAccount(ctx, borrower) || "";
  if (into === "" || api.mayUse(ctx, borrower, into, "into") !== null || api.traitsOf(ctx, into)?.pays !== true || api.traitsOf(ctx, into)?.liability) return reject("no_account", `${labelOf(ctx, borrower)} has no bank account to take the loan into`);
  const borrows = by !== "" && by !== borrower && own(ctx.state.entities, by) !== undefined;
  if (borrows && orgTypeOf(ctx, borrower) === null) return reject("not_allowed", `${labelOf(ctx, borrower)} has to agree to borrow it: ask them`);
  const d = dateAt(calendarOf(ctx.world), ctx.state.clock);
  const opened = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const dueDay = typeof a.due_day === "number" && a.due_day >= 1 ? Math.min(28, Math.round(a.due_day)) : Math.min(28, d.day);
  const note = newId(ctx, lender, "note", borrower);
  const loan = newId(ctx, borrower, "loan", lender);
  const lenderName = labelOf(ctx, lender);
  const borrowerName = labelOf(ctx, borrower);
  const money = moneyWords(ctx, cents);
  const noteFields: JsonObject = { owners: [{ party: lender, role: "owner" }], product: "note", opening: 0, opened, status: "open", loan, collect_into: source, apr_pct: apr, term_months: months };
  const loanFields: JsonObject = { owners: [{ party: borrower, role: "owner" }], product: "loan", opening: 0, opened, status: "open", note, apr_pct: apr, term_months: months, months_left: months, due_day: dueDay, autopay: "minimum", autopay_from: into, institution: lenderName, ...(typeof a.payment === "number" && a.payment > 0 ? { payment: Math.round(a.payment) } : {}) };
  const events: LedgerEvent[] = [
    { type: "spawn", entity: { id: note, kind: "account", name: `Loan to ${borrowerName}`, tier: "background", fields: noteFields, relations: [] } },
    { type: "spawn", entity: { id: loan, kind: "account", name: `Loan from ${lenderName}`, tier: "background", fields: loanFields, relations: [] } },
    { type: FINANCE_EVENTS.open, data: { accounts: [note, loan] } },
    ...posting([{ account: source, amount: -cents }, { account: note, amount: cents }], { memo: `Lent ${money} to ${borrowerName}`, kind: "transfer", category: "lending", counterparty: borrower, payer: lender }),
    ...posting([{ account: loan, amount: -cents }, { account: into, amount: cents }], { memo: `Borrowed ${money} from ${lenderName}`, kind: "deposit", category: "loan", counterparty: borrower, payer: lender }),
  ];
  // Whoever acts for an organization borrowing must hold its `money.borrow`; its History tells it.
  const borrowed = borrows ? actAs(ctx, { by, party: borrower, power: "money.borrow", line: () => `Borrowed ${money} from ${lenderName}`, names: [lender] }, () => []) : [];
  if (!Array.isArray(borrowed)) return borrowed;
  const lent = actAs(ctx, { by, party: lender, power: "money.spend", target: borrower, amount: cents, account: source, line: () => `Lent ${money} to ${borrowerName}`, names: [borrower] }, () => asUnit(events));
  return Array.isArray(lent) ? [...lent, ...borrowed] : lent;
}

/**
 * The daily sweep of a note: what its loan was paid since (the note holding more than the loan
 * owes) lands with the lender, in the account the loan was paid out of, else their deposit account;
 * once the loan owes nothing, both close as paid off and both sides are told.
 */
export function sweepNote(run: Run, note: EntityId, at: number): void {
  const ctx = run.ctx;
  const loan = strOf(own(ctx.state.entities, note)?.fields.loan);
  if (!own(ctx.state.entities, loan)) return;
  const lender = holderOf(ctx, note);
  const borrower = holderOf(ctx, loan);
  const owed = Math.max(0, -balance(ctx.state, loan));
  const paid = balance(ctx.state, note) - owed;
  if (paid > 0) {
    const named = strOf(own(ctx.state.entities, note)?.fields.collect_into);
    const into = named !== "" && statusOf(ctx.state, named) !== "closed" && holdersOf(ctx.state, named).includes(lender) ? named : depositAccount(ctx, lender);
    if (into === null) return;
    run.emit(asUnit(posting([{ account: note, amount: -paid }, { account: into, amount: paid }], { memo: `${labelOf(ctx, loan)}: payment received`, kind: "payment", category: "lending", counterparty: lender, payer: borrower, at })));
  }
  if (owed > 0 || balance(run.ctx.state, note) > 0) return;
  const text = `The loan of ${labelOf(ctx, borrower)} from ${labelOf(ctx, lender)} is paid off.`;
  run.emit([
    { type: FINANCE_EVENTS.status, data: { account: note, status: "paid_off" } },
    ...(statusOf(ctx.state, loan) === "paid_off" ? [] : [{ type: FINANCE_EVENTS.status, data: { account: loan, status: "paid_off" } } satisfies LedgerEvent]),
    ...[...new Set([lender, borrower])].filter((p) => isParty(ctx, p)).map((p) => signal("bill", text, p, at)),
  ]);
}

/** Loans between parties: `economy.lend`, the `lend` action, and their lint. */
export function registerNotes(r: FinanceRegistry): void {
  const { api, core } = r;
  core.effect({ type: "economy.lend", args: ["to", "cents", "from?", "into?", "apr?", "months?", "payment?", "due_day?", "who?", "by?"], resolve: (a, ctx) => lendEvents(api, ctx, a) });
  core.action({
    id: FINANCE_ACTIONS.lend,
    label: "Lend money",
    description: "Lend money to someone in the world (a company to its subsidiary, a person to a friend's business): a loan they repay with interest, monthly, by autopay.",
    pack: "economy",
    params: {
      to: { type: "ref", of: { kind: [...PARTY_KINDS] }, label: "Lend to" },
      amount: { type: "money" },
      apr: { type: "number", optional: true, label: "Interest a year, %" },
      months: { type: "number", optional: true, label: "Over how many months" },
      from: { type: "ref", ref: "account", optional: true, label: "From account" },
      as: asParam("money.spend", "Lending as: an organization you may spend for, only when the input lends its money; left out, you lend"),
    },
    requires: ["amount > 0", "level.money >= 3", mayAs("money.spend")],
    outcomes: { default: [{ type: "economy.lend", args: { to: "to", cents: "=amount", apr: "=params.apr", months: "=params.months", from: "=params.from", who: "self", by: "actor" } }] },
    duration: "10",
    observable: "arranges a loan",
    mechanical: true,
    lexicon: ["lend money to", "make a loan to", "loan the company"],
  });
  core.lint({
    code: "economy.notes",
    check(world) {
      const issues = [];
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "account") continue;
        const note = strOf(e.fields.note);
        const loan = strOf(e.fields.loan);
        if (note !== "" && own(world.entities, note)?.fields.loan !== e.id) issues.push({ severity: "error" as const, code: "economy.notes", message: `Account ${e.name}'s note "${note}" isn't a loan made to it.`, path: `entities.${e.id}.fields.note` });
        if (strOf(e.fields.product) === "note" && own(world.entities, loan)?.fields.note !== e.id) issues.push({ severity: "error" as const, code: "economy.notes", message: `Loan made ${e.name} names no loan that owes it.`, path: `entities.${e.id}.fields.loan` });
      }
      return issues;
    },
  });
}
