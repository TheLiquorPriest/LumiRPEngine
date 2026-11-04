// Statements (DESIGN §26.5) as an organization's Books and a person's Income and spending draw them:
// a period picked (this month, last month, the year to date, the last 12 months); the income
// statement, from revenue to net income with its margins, EBITDA beside operating income and, where
// nothing depreciates, why the two agree; a person's income, spending, interest and taxes instead;
// the cash flow by section, corrections and opening balances apart, to the change in cash; and the
// balance sheet now, whose equity is the net worth.

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { CashFlowStatement, IncomeLine, IncomeStatement, StatementPeriodId, StatementsView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { List, ListRow, Section, Seg } from "../../../frontend/components";
import { Note } from "./nav";

const PERIOD_SHORT: Readonly<Record<StatementPeriodId, string>> = { month: "Month", last_month: "Last month", ytd: "Year", twelve_months: "12 months" };

const CASH_LABELS: Readonly<Record<"operating" | "investing" | "financing" | "owners", string>> = { operating: "Operating", investing: "Investing", financing: "Financing", owners: "With the owners" };

type Fmt = (cents: number) => string;

function tone(cents: number): "pos" | "neg" | undefined {
  return cents > 0 ? "pos" : cents < 0 ? "neg" : undefined;
}

/** A margin in words, for a total's subtitle: "32.5% of revenue". */
function margin(pct: number | null): string | undefined {
  return pct === null ? undefined : `${pct}% of revenue`;
}

/** The lines of one class, each a row under its total. */
function LineRows(props: { lines: readonly IncomeLine[]; classes: readonly IncomeLine["class"][]; fmt: Fmt }) {
  return (
    <>
      {props.lines
        .filter((l) => props.classes.includes(l.class))
        .map((l) => (
          <ListRow key={`${l.class}:${l.category}`} title={l.label} value={props.fmt(l.cents)} valueTone="muted" />
        ))}
    </>
  );
}

/** An organization's income statement: revenue to net income, EBITDA beside operating income; depreciation and depletion lines where its books depreciate (`on`), else the note why EBITDA is operating income. */
function BooksIncome(props: { income: IncomeStatement; label: string; on: boolean; note: string | null; fmt: Fmt }) {
  const { income: i, fmt } = props;
  const writedowns = props.on || i.depreciation !== 0 || i.depletion !== 0;
  return (
    <Section title={`Income statement · ${props.label}`} flush>
      <List>
        <ListRow title="Revenue" value={fmt(i.revenue)} valueTone={tone(i.revenue)} />
        <LineRows lines={i.lines} classes={["revenue"]} fmt={fmt} />
        <ListRow title="Cost of revenue" value={fmt(-i.cogs)} valueTone={tone(-i.cogs)} />
        <ListRow title="Gross profit" subtitle={margin(i.margins.gross)} value={fmt(i.grossProfit)} valueTone={tone(i.grossProfit)} />
        <ListRow title="Operating expenses" value={fmt(-i.opex)} valueTone={tone(-i.opex)} />
        <LineRows lines={i.lines} classes={["opex"]} fmt={fmt} />
        {writedowns ? <ListRow title="Depreciation" value={fmt(-i.depreciation)} valueTone={tone(-i.depreciation)} /> : null}
        {writedowns ? <ListRow title="Depletion" value={fmt(-i.depletion)} valueTone={tone(-i.depletion)} /> : null}
        <ListRow title="Operating income (EBIT)" subtitle={margin(i.margins.operating)} value={fmt(i.operatingIncome)} valueTone={tone(i.operatingIncome)} />
        <ListRow title="EBITDA" subtitle={margin(i.margins.ebitda)} value={fmt(i.ebitda)} valueTone={tone(i.ebitda)} />
        <ListRow title="Interest" value={fmt(-i.interest)} valueTone={tone(-i.interest)} />
        <ListRow title="Investment income" value={fmt(i.investmentIncome)} valueTone={tone(i.investmentIncome)} />
        <ListRow title="Profit before tax" value={fmt(i.preTax)} valueTone={tone(i.preTax)} />
        <ListRow title="Income tax" value={fmt(-i.tax)} valueTone={tone(-i.tax)} />
        <ListRow title="Net income" subtitle={margin(i.margins.net)} value={fmt(i.netIncome)} valueTone={tone(i.netIncome)} />
      </List>
      {props.note !== null ? <Note>{props.note}</Note> : null}
    </Section>
  );
}

/** A person's income and spending: what came in, what went out by category, interest and taxes, and what's left. */
function PersonalIncome(props: { income: IncomeStatement; label: string; fmt: Fmt }) {
  const { income: i, fmt } = props;
  return (
    <Section title={`Income and spending · ${props.label}`} flush>
      <List>
        <ListRow title="Income" value={fmt(i.revenue)} valueTone={tone(i.revenue)} />
        <LineRows lines={i.lines} classes={["revenue"]} fmt={fmt} />
        <ListRow title="Spending" value={fmt(-i.opex)} valueTone={tone(-i.opex)} />
        <LineRows lines={i.lines} classes={["opex", "cogs"]} fmt={fmt} />
        {i.interest !== 0 ? <ListRow title="Interest paid" value={fmt(-i.interest)} valueTone={tone(-i.interest)} /> : null}
        {i.investmentIncome !== 0 ? <ListRow title="From investments and interest" value={fmt(i.investmentIncome)} valueTone={tone(i.investmentIncome)} /> : null}
        {i.tax !== 0 ? <ListRow title="Taxes" value={fmt(-i.tax)} valueTone={tone(-i.tax)} /> : null}
        <ListRow title="Left over" value={fmt(i.netIncome)} valueTone={tone(i.netIncome)} />
      </List>
    </Section>
  );
}

/** The cash flow: each section's total and its lines, corrections and opening balances apart, then the change in cash. */
function CashFlow(props: { cash: CashFlowStatement; fmt: Fmt }) {
  const { cash: c, fmt } = props;
  const sections = (["operating", "investing", "financing", "owners"] as const).filter((s) => c[s] !== 0 || c.lines.some((l) => l.section === s));
  return (
    <Section title="Cash flow" flush>
      <List>
        <ListRow title="Cash at the start" value={fmt(c.start)} valueTone="muted" />
        {sections.map((s) => (
          <Fragment key={s}>
            <ListRow title={CASH_LABELS[s]} value={fmt(c[s])} valueTone={tone(c[s])} />
            {c.lines
              .filter((l) => l.section === s)
              .map((l) => (
                <ListRow key={`${s}:${l.label}`} title={l.label} value={fmt(l.cents)} valueTone="muted" />
              ))}
          </Fragment>
        ))}
        {c.corrections !== 0 ? <ListRow title="Corrections" subtitle="Balances put right, not money made or spent" value={fmt(c.corrections)} valueTone="muted" /> : null}
        {c.openings !== 0 ? <ListRow title="Opening balances" value={fmt(c.openings)} valueTone="muted" /> : null}
        <ListRow title="Change in cash" value={fmt(c.change)} valueTone={tone(c.change)} />
        <ListRow title="Cash at the end" value={fmt(c.end)} valueTone="muted" />
      </List>
    </Section>
  );
}

/**
 * A party's statements (§26.5), its period picked; the balance sheet is always now. `books` is an
 * organization's, `personal` a person's Income and spending.
 */
export function StatementsBlock(props: { statements: StatementsView; currency: WorldCurrency }) {
  const { statements: s } = props;
  const [picked, setPicked] = useState<StatementPeriodId>("month");
  const period = s.periods.find((p) => p.id === picked) ?? s.periods[0];
  if (!period) return null;
  const fmt: Fmt = (cents) => formatMoney(cents, props.currency);
  return (
    <div data-lre-statements={s.kind}>
      <Section title={s.kind === "personal" ? "Income and spending" : "Statements"}>
        <Seg<StatementPeriodId> label="Period" value={period.id} options={s.periods.map((p) => ({ value: p.id, label: PERIOD_SHORT[p.id], title: p.label }))} onChange={setPicked} />
      </Section>
      {s.kind === "personal" ? <PersonalIncome income={period.income} label={period.label} fmt={fmt} /> : <BooksIncome income={period.income} label={period.label} on={s.depreciation === "straight_line"} note={s.ebitdaNote} fmt={fmt} />}
      <CashFlow cash={period.cash} fmt={fmt} />
      <Section title="Balance sheet · now" flush>
        <List>
          <ListRow title="Assets" value={fmt(s.balance.assets)} valueTone="pos" />
          <ListRow title="Liabilities" value={fmt(-s.balance.liabilities)} valueTone={s.balance.liabilities > 0 ? "neg" : undefined} />
          {s.balance.lines.map((l) => (
            <ListRow key={l.label} title={l.label} value={fmt(l.cents)} valueTone="muted" />
          ))}
          <ListRow title={s.kind === "personal" ? "Net worth" : "Equity (net worth)"} value={fmt(s.balance.equity)} valueTone={tone(s.balance.equity)} />
        </List>
      </Section>
    </div>
  );
}
