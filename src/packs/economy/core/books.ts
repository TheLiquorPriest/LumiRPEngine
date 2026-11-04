// A business's books (DESIGN §26.2): revenue and expenses by calendar month, and what it owes and is
// owed. What the work module posts itself (sales, paid invoices, payroll, sales tax, supplier bills,
// business income tax, owner draws and distributions) it books with its own events, with the detail
// a posting's journal line doesn't carry. Everything else that moves on the business's accounts
// (expense flows the owner sets up, fees, interest, other income) comes from the journal's monthly
// totals by category.
//
// Revenue is counted when the money comes in (a sale is paid on the spot, an invoice when it is
// paid), and the cost of goods with each sale, though the suppliers are paid monthly.

import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import { isCorrection } from "../../../shared/finance";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { numOf, objOf, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import type { Books, FinanceApi } from "./module";

/** What a month's books hold, each in minor units. */
export const BOOK_KEYS = [
  /** Sales: their price, without the tax on top. */
  "sales",
  /** What sales through the purchase path brought into its accounts, tax included, which the journal files under the goods' own categories. */
  "takings",
  "cogs",
  "tax_collected",
  "tax_remitted",
  /** Invoices it was paid, and invoices it paid. */
  "invoices",
  "bills",
  /** Payroll with the employer's own costs (a retirement match, its share of FICA). */
  "payroll",
  "business_tax",
  "draws",
  "distributions",
] as const;
export type BookKey = (typeof BOOK_KEYS)[number];
export type MonthBook = Record<BookKey, number>;

/**
 * Journal categories the books leave out of the other income and expenses: what the work module
 * books itself; transfers between its own accounts; and balance-sheet moves (money borrowed, and
 * investments and property bought and sold), which change what it holds, not what it makes.
 */
export const BOOKED_CATEGORIES: readonly string[] = ["sales", "cogs", "sales_tax", "invoice", "payroll", "business_tax", "draw", "distribution", "transfer", "loan", "investment", "property", "lending", "capex"];

/**
 * Journal categories of income from what a business holds rather than from its trade: its
 * holdings' dividends and interest, and a deposit's interest. They are profit, but not operating
 * profit, which values a business beside what it holds at market (§27.10), so nothing counts twice.
 */
export const INVESTMENT_INCOME: readonly string[] = ["dividends", "interest"];

/** Journal categories of revenue the books list on their own lines: a stream's royalties and fees, never what a sale at a till brings in. */
const OWN_REVENUE: readonly string[] = ["royalties", "fee_income", "other_income"];

/** Months of books kept per business: two years and the month under way. */
const MONTHS_KEPT = 25;

/** `YYYY-MM` of a clock reading: the key of the books and of the journal's monthly totals. */
export function monthOf(world: Books["world"], clock: number): string {
  const d = dateAt(calendarOf(world), clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}`;
}

/** Adds to a business's books for a month (inside an event's apply), keeping the newest months. */
export function addToBooks(state: WorldState, business: EntityId, month: string, entries: Partial<MonthBook>): void {
  const books = sliceRecord(state, "economy", "books");
  const cur = objOf(own(objOf(own(books, business)), month));
  const next: JsonObject = { ...cur };
  for (const k of BOOK_KEYS) {
    const v = entries[k];
    if (typeof v === "number" && v !== 0) next[k] = numOf(cur[k]) + v;
  }
  const months: JsonObject = { ...objOf(own(books, business)), [month]: next };
  const keys = Object.keys(months).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - MONTHS_KEPT))) delete months[old];
  books[business] = months;
}

/** A business's book for one month, zeros where nothing was booked. */
export function monthBook(state: Readonly<WorldState>, business: EntityId, month: string): MonthBook {
  const row = objOf(own(objOf(own(objOf(sliceOf(state, "economy").books), business)), month));
  const out = {} as MonthBook;
  for (const k of BOOK_KEYS) out[k] = numOf(row[k]);
  return out;
}

/** What a business owes for sales tax it collected and for goods it sold, until its monthly payments settle them. */
export interface Payables {
  sales_tax: number;
  suppliers: number;
}

export function payablesOf(state: Readonly<WorldState>, business: EntityId): Payables {
  const p = objOf(own(objOf(sliceOf(state, "economy").payables), business));
  return { sales_tax: numOf(p.sales_tax), suppliers: numOf(p.suppliers) };
}

/** Moves a business's payables (inside an event's apply). */
export function addToPayables(state: WorldState, business: EntityId, delta: Partial<Payables>): void {
  const all = sliceRecord(state, "economy", "payables");
  const cur = payablesOf(state, business);
  all[business] = { sales_tax: cur.sales_tax + (delta.sales_tax ?? 0), suppliers: cur.suppliers + (delta.suppliers ?? 0) };
}

/** The months from the one holding `from` to the one holding `to - 1`, oldest first. */
export function monthsBetween(world: Books["world"], from: number, to: number): string[] {
  const out: string[] = [];
  const cal = calendarOf(world);
  const first = dateAt(cal, from);
  const last = dateAt(cal, Math.max(from, to - 1));
  for (let y = first.year, m = first.month, guard = 0; guard < 1200 && (y < last.year || (y === last.year && m <= last.month)); guard++) {
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return out;
}

/** The journal's money in and out of an account in a month, by category (the foundation's monthly totals). */
export function totalsOf(state: Readonly<WorldState>, account: EntityId, month: string): Record<string, { in: number; out: number }> {
  const raw = objOf(own(objOf(own(objOf(sliceOf(state, "economy").totals), account)), month));
  const out: Record<string, { in: number; out: number }> = {};
  for (const [category, v] of Object.entries(raw)) out[category] = { in: numOf(objOf(v).in), out: numOf(objOf(v).out) };
  return out;
}

/** What `party`'s books took in a month for depreciation and depletion (the economy slice's `depreciation`, DESIGN §26.5). */
export function depreciationIn(state: Readonly<WorldState>, party: EntityId, month: string): { depreciation: number; depletion: number } {
  const m = objOf(own(objOf(own(objOf(sliceOf(state, "economy").depreciation), party)), month));
  return { depreciation: numOf(m.depreciation), depletion: numOf(m.depletion) };
}

/**
 * The first month a business's books, or the journal of any account counting toward it, recorded
 * anything (its accounts' openings among it): the chat's first month for a business it starts
 * with, a later one for a business that starts trading later; null when nothing has been recorded.
 */
export function firstBookedMonth(api: FinanceApi, books: Books, business: EntityId): string | null {
  const economy = sliceOf(books.state, "economy");
  const months = [...Object.keys(objOf(own(objOf(economy.books), business))), ...api.accountsOf(books, business, "worth").flatMap((a) => Object.keys(objOf(own(objOf(economy.totals), a))))];
  return months.length === 0 ? null : months.reduce((a, b) => (b < a ? b : a));
}

/**
 * The account a business's takings land in and its payroll and payouts come from: its
 * `operating_account` when that is one of its own, else the first of its accounts that takes
 * deposits, by the class's deposit rank.
 */
export function operatingAccount(api: FinanceApi, books: Books, business: EntityId): EntityId | null {
  const accounts = api.accountsOf(books, business, "spend");
  const named = strOf(own(books.state.entities, business)?.fields.operating_account);
  if (named !== "" && accounts.includes(named)) return named;
  const rank = (a: EntityId): number => api.traitsOf(books, a)?.depositRank ?? Infinity;
  return accounts.filter((a) => rank(a) !== Infinity).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? null;
}

export interface BooksDetail {
  revenue: number;
  expenses: number;
  profit: number;
  /** Income from what it holds (`INVESTMENT_INCOME`), among the revenue. */
  investment: number;
  /** The profit from its trade: the profit less its investment income. */
  operating: number;
  /** What its open and late invoices are owed it. */
  receivables: number;
  /** What it owes: invoices it hasn't paid, sales tax it collected, its suppliers. */
  payables: number;
  payroll: number;
  taxes: number;
  /** What its assets lost in its books (§26.5), among the expenses: straight-line depreciation and cost depletion; 0 where nothing depreciates. */
  depreciation: number;
  depletion: number;
  /** Revenue (positive) and expenses (negative) by line. */
  lines: { category: string; cents: number }[];
  draws: number;
  distributions: number;
}

/**
 * A business's books over the months from the one holding `from` to the one holding `to - 1`
 * (DESIGN §26.2): revenue and expenses, the profit, and what it is owed and owes now. Owner draws,
 * distributions, transfers between its own accounts, sales tax (passed through) and corrections
 * (a balance put right, `isCorrection`) are in neither.
 */
export function businessBooks(api: FinanceApi, books: Books, business: EntityId, from: number, to: number): BooksDetail {
  const accounts = api.accountsOf(books, business, "worth");
  const sum = {} as MonthBook;
  for (const k of BOOK_KEYS) sum[k] = 0;
  let otherIn = 0;
  let investment = 0;
  let depreciation = 0;
  let depletion = 0;
  const ownIn: Record<string, number> = {};
  const otherOut: Record<string, number> = {};
  for (const month of monthsBetween(books.world, from, to)) {
    const b = monthBook(books.state, business, month);
    for (const k of BOOK_KEYS) sum[k] += b[k];
    const lost = depreciationIn(books.state, business, month);
    depreciation += lost.depreciation;
    depletion += lost.depletion;
    for (const account of accounts) {
      for (const [category, t] of Object.entries(totalsOf(books.state, account, month))) {
        // An account's opening balance is what the business started with, not money it made or spent; a correction puts a balance right.
        if (BOOKED_CATEGORIES.includes(category) || category === "opening" || isCorrection({ category })) continue;
        if (INVESTMENT_INCOME.includes(category)) investment += t.in;
        else if (OWN_REVENUE.includes(category)) ownIn[category] = (ownIn[category] ?? 0) + t.in;
        else otherIn += t.in;
        if (t.out > 0) otherOut[category] = (otherOut[category] ?? 0) + t.out;
      }
    }
  }
  // Sales through the purchase path land under the goods' own categories; their takings are booked already.
  const otherIncome = Math.max(0, otherIn - sum.takings);
  const ownLines = OWN_REVENUE.filter((c) => (ownIn[c] ?? 0) !== 0).map((c) => ({ category: c, cents: ownIn[c] ?? 0 }));
  const expenseLines = Object.entries(otherOut).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const revenue = sum.sales + sum.invoices + otherIncome + ownLines.reduce((a, l) => a + l.cents, 0) + investment;
  const expenses = sum.cogs + sum.payroll + sum.business_tax + sum.bills + expenseLines.reduce((a, [, c]) => a + c, 0) + depreciation + depletion;
  const owed = owedOf(books.state, business);
  const lines = [
    { category: "sales", cents: sum.sales },
    { category: "invoices", cents: sum.invoices },
    ...ownLines,
    { category: "other income", cents: otherIncome },
    { category: "investment income", cents: investment },
    { category: "cost of goods", cents: -sum.cogs },
    { category: "payroll", cents: -sum.payroll },
    { category: "bills", cents: -sum.bills },
    { category: "income tax", cents: -sum.business_tax },
    ...expenseLines.map(([category, c]) => ({ category, cents: -c })),
    { category: "depreciation", cents: -depreciation },
    { category: "depletion", cents: -depletion },
  ].filter((l) => l.cents !== 0);
  const profit = revenue - expenses;
  return { revenue, expenses, profit, investment, operating: profit - investment, receivables: owed.receivables, payables: owed.payables, payroll: sum.payroll, taxes: sum.business_tax, depreciation, depletion, lines, draws: sum.draws, distributions: sum.distributions };
}

/** What a business is owed now (its open and late invoices) and what it owes (invoices billed to it, sales tax it collected, its suppliers): its net worth counts both (§27.10). */
export function owedOf(state: Readonly<WorldState>, business: EntityId): { receivables: number; payables: number } {
  const owed = invoicesOwed(state, business);
  const payables = payablesOf(state, business);
  return { receivables: owed.receivable, payables: owed.payable + Math.max(0, payables.sales_tax) + Math.max(0, payables.suppliers) };
}

/** What a business's open and late invoices come to: those it issued (owed to it) and those billed to it (owed by it). */
function invoicesOwed(state: Readonly<WorldState>, business: EntityId): { receivable: number; payable: number } {
  let receivable = 0;
  let payable = 0;
  for (const e of Object.values(state.entities)) {
    if (e.kind !== "invoice" || (e.fields.state !== "open" && e.fields.state !== "late")) continue;
    const left = Math.max(0, numOf(e.fields.cents) + numOf(e.fields.late_fee) - numOf(e.fields.paid));
    if (e.fields.business === business) receivable += left;
    if (e.fields.customer === business) payable += left;
  }
  return { receivable, payable };
}
