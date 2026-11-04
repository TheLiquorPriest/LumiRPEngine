// A party's statements (DESIGN §26.5), worked out when read from the journal's monthly totals and
// the books, by one category-class table (`STATEMENT_CATEGORIES`): for this month, last month, the
// year to date and the last twelve months, an income statement and a cash flow; and a balance sheet
// now. An organization's income statement is its books (`businessBooks`) line by line, so its net
// income is its books' profit: revenue, cost of revenue, operating expenses, depreciation and
// depletion, operating income (EBIT), EBITDA, interest, income from what it holds, income tax. A
// person's is their Income and spending, from their accounts' journals: their income, their
// spending by category, interest, taxes. The cash flow reads the accounts whose balances are money
// (every asset account but a loan made): operating, investing, financing and with the owners, each
// category in its section; transfers between the party's own accounts cancel, a card's payment is
// operating and a loan's financing; corrections and opening balances stand apart, and everything
// adds up to the change in cash. The balance sheet is the net worth's parts: equity is net worth.

import type { EntityId } from "../../../shared/ids";
import { statementCategory, type CashFlowStatement, type CashLine, type IncomeLine, type IncomeStatement, type StatementPeriod, type StatementPeriodId, type StatementsView } from "../../../shared/finance";
import { calendarOf, clockAt, dateAt, dayIndexOf } from "../../../engine/calendar";
import { orgTypeOf } from "../../../engine/org";
import type { ReadContext } from "../../../engine/registry";
import { businessBooks, monthOf, monthsBetween, totalsOf } from "./books";
import { depreciationOf } from "./depreciation";
import { accountsOf, balance, shareOf, traitsOf } from "./model";
import type { FinanceHooks } from "./module";
import { netWorthParts } from "./worth";

/** What the books' own lines are, by their names in `BooksDetail.lines`. */
const BOOK_LINES: Readonly<Record<string, Pick<IncomeLine, "label" | "class">>> = {
  sales: { label: "Sales", class: "revenue" },
  invoices: { label: "Invoices", class: "revenue" },
  "other income": { label: "Other income", class: "revenue" },
  "investment income": { label: "Investment income", class: "investment" },
  "cost of goods": { label: "Cost of goods", class: "cogs" },
  payroll: { label: "Payroll", class: "opex" },
  bills: { label: "Bills", class: "opex" },
  "income tax": { label: "Income tax", class: "income_tax" },
  depreciation: { label: "Depreciation", class: "depreciation" },
  depletion: { label: "Depletion", class: "depletion" },
};

const PERIOD_LABELS: Readonly<Record<StatementPeriodId, string>> = { month: "This month", last_month: "Last month", ytd: "Year to date", twelve_months: "Last 12 months" };

/** An income statement's totals from its lines (revenue positive, costs negative). */
function incomeOf(lines: IncomeLine[]): IncomeStatement {
  const total = (c: IncomeLine["class"]): number => lines.filter((l) => l.class === c).reduce((a, l) => a + l.cents, 0);
  const revenue = total("revenue");
  // Costs are their lines' negation, from 0 so none reads -0 (which a JSON round trip turns to 0).
  const cogs = 0 - total("cogs");
  const opex = 0 - total("opex");
  const depreciation = 0 - total("depreciation");
  const depletion = 0 - total("depletion");
  const grossProfit = revenue - cogs;
  const operatingIncome = grossProfit - opex - depreciation - depletion;
  const ebitda = operatingIncome + depreciation + depletion;
  const interest = 0 - total("interest");
  const investmentIncome = total("investment");
  const preTax = operatingIncome - interest + investmentIncome;
  const tax = 0 - total("income_tax");
  const netIncome = preTax - tax;
  const pct = (x: number): number | null => (revenue > 0 ? (Math.round((x / revenue) * 1000) + 0) / 10 : null);
  return { revenue, cogs, grossProfit, opex, depreciation, depletion, operatingIncome, ebitda, interest, investmentIncome, preTax, tax, netIncome, margins: { gross: pct(grossProfit), operating: pct(operatingIncome), ebitda: pct(ebitda), net: pct(netIncome) }, lines };
}

/** An organization's income statement: its books' lines, each in its class, so net income is its books' profit. */
function booksIncome(ctx: ReadContext, party: EntityId, from: number, to: number): IncomeStatement {
  const books = businessBooks({ accountsOf, traitsOf } as Parameters<typeof businessBooks>[0], ctx, party, from, to);
  const lines = books.lines.map((l): IncomeLine => {
    const own = BOOK_LINES[l.category];
    if (own) return { category: l.category, ...own, cents: l.cents };
    const c = statementCategory(l.category);
    if (l.cents >= 0) return { category: l.category, label: c.inLabel ?? c.label, class: "revenue", cents: l.cents };
    const cls = c.out === "cogs" || c.out === "interest" || c.out === "income_tax" ? c.out : "opex";
    return { category: l.category, label: c.label, class: cls, cents: l.cents };
  });
  return incomeOf(lines);
}

/** The money each of a party's accounts moved by category over the months, at the party's share of it. */
function moved(ctx: ReadContext, party: EntityId, accounts: readonly EntityId[], months: readonly string[], each: (account: EntityId, category: string, inCents: number, outCents: number) => void): void {
  for (const account of accounts) {
    const share = shareOf(ctx.state, account, party);
    if (share <= 0) continue;
    for (const month of months) for (const [category, t] of Object.entries(totalsOf(ctx.state, account, month))) each(account, category, Math.round((t.in * share) / 100), Math.round((t.out * share) / 100));
  }
}

/** A person's Income and spending: what came in and went out of their accounts by category, the money moved between them, borrowed, invested or put right left out. */
function personalIncome(ctx: ReadContext, party: EntityId, months: readonly string[]): IncomeStatement {
  const sums = new Map<string, IncomeLine>();
  const add = (category: string, label: string, cls: IncomeLine["class"], cents: number): void => {
    if (cents === 0) return;
    const key = `${cls}\u0000${category}`;
    const line = sums.get(key);
    sums.set(key, { category, label, class: cls, cents: (line?.cents ?? 0) + cents });
  };
  moved(ctx, party, accountsOf(ctx, party, "worth"), months, (_account, category, inCents, outCents) => {
    const c = statementCategory(category);
    if (c.cash === "correction" || c.cash === "opening") return;
    if (c.in !== "none" && inCents > 0) {
      if (c.in === "revenue") add(category, c.inLabel ?? c.label, "revenue", inCents);
      else if (c.in === "income_tax") add(category, c.label, "income_tax", inCents);
      else if (c.in === "investment" || c.in === "interest") add(category, c.label, "investment", inCents);
      else add(category, c.label, "opex", inCents);
    }
    if (c.out !== "none" && outCents > 0) add(category, c.label, c.out === "interest" ? "interest" : c.out === "income_tax" ? "income_tax" : "opex", -outCents);
  });
  return incomeOf([...sums.values()].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.category.localeCompare(b.category)));
}

/** Whether an account's balance is money for the cash flow: every asset account but a loan made. */
function isCash(ctx: ReadContext, account: EntityId): boolean {
  const t = traitsOf(ctx, account);
  return t !== null && t.asset && !t.receivable;
}

/** The change in a party's cash over the months, by section (§26.5). */
function cashFlowOf(ctx: ReadContext, party: EntityId, months: readonly string[]): Omit<CashFlowStatement, "start" | "end"> {
  const worth = accountsOf(ctx, party, "worth");
  const lines = new Map<string, CashLine>();
  const add = (section: CashLine["section"], label: string, cents: number): void => {
    if (cents === 0) return;
    const key = `${section}\u0000${label}`;
    const line = lines.get(key);
    lines.set(key, { section, label, cents: (line?.cents ?? 0) + cents });
  };
  let transfers = 0;
  let cardPayments = 0;
  let loanPayments = 0;
  moved(ctx, party, worth.filter((a) => isCash(ctx, a)), months, (_account, category, inCents, outCents) => {
    const c = statementCategory(category);
    const net = inCents - outCents;
    if (c.cash === "transfer") transfers += net;
    else add(c.cash, c.cash === "correction" || c.cash === "opening" ? c.label : net >= 0 ? (c.inLabel ?? c.label) : c.label, net);
  });
  // A transfer into a card or a loan of the party's pays what it owes: a card's for what it bought, a loan's as financing.
  moved(ctx, party, worth.filter((a) => traitsOf(ctx, a)?.liability === true), months, (account, category, inCents) => {
    if (statementCategory(category).cash !== "transfer") return;
    if (traitsOf(ctx, account)?.installment) loanPayments += inCents;
    else cardPayments += inCents;
  });
  add("operating", "Card payments", -cardPayments);
  add("financing", "Loan payments", -loanPayments);
  add("operating", "Other transfers", transfers + cardPayments + loanPayments);
  const all = [...lines.values()];
  const total = (s: CashLine["section"]): number => all.filter((l) => l.section === s).reduce((a, l) => a + l.cents, 0);
  const out = { operating: total("operating"), investing: total("investing"), financing: total("financing"), owners: total("owners"), corrections: total("correction"), openings: total("opening") };
  return { ...out, change: out.operating + out.investing + out.financing + out.owners + out.corrections + out.openings, lines: all.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.label.localeCompare(b.label)) };
}

/** The cash the party holds now, at its share: what the cash flow's accounts hold. */
function cashNow(ctx: ReadContext, party: EntityId): number {
  return accountsOf(ctx, party, "worth")
    .filter((a) => isCash(ctx, a))
    .reduce((sum, a) => sum + Math.round((balance(ctx.state, a) * shareOf(ctx.state, a, party)) / 100), 0);
}

/**
 * A party's statements (§26.5): an organization's from its books, a person's as their Income and
 * spending, for this month, last month, the year to date and the last twelve months, and its balance
 * sheet now.
 */
export function statementsOf(hooks: FinanceHooks, ctx: ReadContext, party: EntityId): StatementsView {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const d = dateAt(cal, now);
  const months = cal.system.months;
  const start = (year: number, month: number): number => clockAt(cal, dayIndexOf(cal, year, month, 1), 0);
  const back = (n: number): number => {
    const index = d.year * months + (d.month - 1) - n;
    return start(Math.floor(index / months), (index % months) + 1);
  };
  const thisMonth = start(d.year, d.month);
  const spans: Record<StatementPeriodId, { from: number; to: number }> = {
    month: { from: thisMonth, to: now + 1 },
    last_month: { from: back(1), to: thisMonth },
    ytd: { from: start(d.year, 1), to: now + 1 },
    twelve_months: { from: back(11), to: now + 1 },
  };
  const books = orgTypeOf(ctx, party) !== null;
  const held = cashNow(ctx, party);
  const sinceLastMonth = cashFlowOf(ctx, party, monthsBetween(ctx.world, thisMonth, now + 1)).change;
  const periods = (Object.keys(spans) as StatementPeriodId[]).map((id): StatementPeriod => {
    const { from, to } = spans[id];
    const span = monthsBetween(ctx.world, from, to);
    const flow = cashFlowOf(ctx, party, span);
    const end = id === "last_month" ? held - sinceLastMonth : held;
    return { id, label: PERIOD_LABELS[id], from: monthOf(ctx.world, from), to: monthOf(ctx.world, to - 1), income: books ? booksIncome(ctx, party, from, to) : personalIncome(ctx, party, span), cash: { ...flow, start: end - flow.change, end } };
  });
  const worth = netWorthParts(hooks, ctx, party);
  const depreciation = depreciationOf(ctx, party);
  return {
    kind: books ? "books" : "personal",
    depreciation,
    ebitdaNote: books && depreciation === "none" ? "Nothing depreciates in these books, so EBITDA is operating income." : null,
    periods,
    balance: { assets: worth.assets, liabilities: worth.liabilities, equity: worth.net, lines: worth.lines },
  };
}
