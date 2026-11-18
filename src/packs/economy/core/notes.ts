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
import { asUnit, depositAccount, isParty, posting, notice } from "./pay";
import { openingEvent } from "./process";
import type { Run } from "./run";
import { say } from "../../../shared/lines";

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
  if (!own(ctx.state.entities, lender) || api.partyKind(ctx, lender) === null) return reject("missing_entity", say("why_theres_no_one_to_lend_it"));
  if (!own(ctx.state.entities, borrower) || api.partyKind(ctx, borrower) === null) return reject("missing_entity", say("why_theres_no_one_to_borrow_it"));
  if (borrower === lender) return reject("bad_party", say("why_lender_cant_lend_to_itself", { lender: labelOf(ctx, lender) }));
  if (!(cents > 0)) return reject("bad_amount", say("why_a_loan_needs_an_amount"));
  for (const party of [lender, borrower]) if (ctx.levelOf(party, "money") < 3) return reject("level", say("why_party_s_money_isnt_followed_closely_enough", { party: labelOf(ctx, party) }));
  const apr = typeof a.apr === "number" && a.apr >= 0 ? a.apr : 0;
  const months = typeof a.months === "number" && a.months >= 1 ? Math.round(a.months) : 12;
  const named = strOf(a.from);
  const sources = lendingSources(api, ctx, lender);
  if (named !== "" && !sources.includes(named)) return reject("bad_account", say("why_lender_cant_lend_from_named", { lender: labelOf(ctx, lender), named: labelOf(ctx, named) }));
  const source = named !== "" ? named : sources.find((s) => availableOf(ctx, s) >= cents);
  if (!source) return reject("insufficient_funds", say("why_lender_has_no_account_with_cents_to", { lender: labelOf(ctx, lender), cents: moneyWords(ctx, cents) }));
  if (availableOf(ctx, source) < cents) return reject("insufficient_funds", say("why_source_has_less_than_cents", { source: labelOf(ctx, source), cents: moneyWords(ctx, cents) }));
  const into = strOf(a.into) || api.depositAccount(ctx, borrower) || "";
  if (into === "" || api.mayUse(ctx, borrower, into, "into") !== null || api.traitsOf(ctx, into)?.pays !== true || api.traitsOf(ctx, into)?.liability) return reject("no_account", say("why_borrower_has_no_bank_account_to_take", { borrower: labelOf(ctx, borrower) }));
  const borrows = by !== "" && by !== borrower && own(ctx.state.entities, by) !== undefined;
  if (borrows && orgTypeOf(ctx, borrower) === null) return reject("not_allowed", say("why_borrower_has_to_agree_to_borrow_it", { borrower: labelOf(ctx, borrower) }));
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
    { type: "spawn", entity: { id: note, kind: "account", name: say("name_loan_to_borrowername", { borrowerName }), tier: "background", fields: noteFields, relations: [] } },
    { type: "spawn", entity: { id: loan, kind: "account", name: say("name_loan_from_lendername", { lenderName }), tier: "background", fields: loanFields, relations: [] } },
    { type: FINANCE_EVENTS.open, data: { accounts: [note, loan] } },
    ...posting([{ account: source, amount: -cents }, { account: note, amount: cents }], { memo: say("memo_lent_money_to_borrowername", { money, borrowerName }), kind: "transfer", category: "lending", counterparty: borrower, payer: lender }),
    ...posting([{ account: loan, amount: -cents }, { account: into, amount: cents }], { memo: say("memo_borrowed_money_from_lendername", { money, lenderName }), kind: "deposit", category: "loan", counterparty: borrower, payer: lender }),
  ];
  // Whoever acts for an organization borrowing must hold its `money.borrow`; its History tells it.
  const borrowed = borrows ? actAs(ctx, { by, party: borrower, power: "money.borrow", line: () => say("org_log_borrowed_money_from_lendername", { money: money, lenderName: lenderName }), names: [lender] }, () => []) : [];
  if (!Array.isArray(borrowed)) return borrowed;
  const lent = actAs(ctx, { by, party: lender, power: "money.spend", target: borrower, amount: cents, account: source, line: () => say("org_log_lent_money_to_borrowername", { money: money, borrowerName: borrowerName }), names: [borrower] }, () => asUnit(events));
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
    run.emit(asUnit(posting([{ account: note, amount: -paid }, { account: into, amount: paid }], { memo: say("memo_loan_payment_received", { loan: labelOf(ctx, loan) }), kind: "payment", category: "lending", counterparty: lender, payer: borrower, at })));
  }
  if (owed > 0 || balance(run.ctx.state, note) > 0) return;
  run.emit([
    { type: FINANCE_EVENTS.status, data: { account: note, status: "paid_off" } },
    ...(statusOf(ctx.state, loan) === "paid_off" ? [] : [{ type: FINANCE_EVENTS.status, data: { account: loan, status: "paid_off" } } satisfies LedgerEvent]),
    ...[...new Set([lender, borrower])].filter((p) => isParty(ctx, p)).flatMap((p) => notice("bill", "loan_paid_off", { borrower: labelOf(ctx, borrower), lender: labelOf(ctx, lender) }, p, at)),
  ]);
}

/** Loans between parties: `economy.lend`, the `lend` action, and their lint. */
export function registerNotes(r: FinanceRegistry): void {
  const { api, core } = r;
  core.effect({ type: "economy.lend", args: ["to", "cents", "from?", "into?", "apr?", "months?", "payment?", "due_day?", "who?", "by?"], resolve: (a, ctx) => lendEvents(api, ctx, a) });
  core.action({
    id: FINANCE_ACTIONS.lend,
    pack: "economy",
    params: {
      to: { type: "ref", of: { kind: [...PARTY_KINDS] } },
      amount: { type: "money" },
      apr: { type: "number", optional: true },
      months: { type: "number", optional: true },
      from: { type: "ref", ref: "account", optional: true },
      as: asParam("money.spend", "param_lending_as"),
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
        if (note !== "" && own(world.entities, note)?.fields.loan !== e.id) issues.push({ severity: "error" as const, code: "economy.notes", message: say("lint_account_name_s_note_note_isnt_a", { name: e.name, note: note }), path: `entities.${e.id}.fields.note` });
        if (strOf(e.fields.product) === "note" && own(world.entities, loan)?.fields.note !== e.id) issues.push({ severity: "error" as const, code: "economy.notes", message: say("lint_loan_made_name_names_no_loan_that", { name: e.name }), path: `entities.${e.id}.fields.loan` });
      }
      return issues;
    },
  });
}
