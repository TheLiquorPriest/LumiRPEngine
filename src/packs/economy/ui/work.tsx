// Money's work and businesses (DESIGN §26; ORG-SPEC §5.2): the party's jobs, each with its pay,
// schedule, next payday, payslip, deductions and where the pay goes, from In & out's Income; a
// business's own books, months and sales (its Money's Books in Orgs) and the invoices it issued;
// and the controls on a business, which its pages in Orgs open: issuing an invoice (Money), paying
// out profit, an owner's draw and where an owner's share goes (Ownership's Payouts), and selling a
// stake (Ownership); hiring is People's Hire someone, the orgs pack's. Each control opens a page of
// its own with Back and one button, an in-world action as the player's own role on the business
// allows it. The player quits a job, and for a business they manage gives raises and lets people
// go from its payroll's jobs; the GM ends and edits jobs, adds one, sets an invoice's state and
// routes a person's share of a business's profit from their stake.

import { useState } from "preact/hooks";
import { INVOICE_STATES, PAY_BASES, PAY_EVERY, ROLE_RIGHTS, type BusinessView, type InvoiceState, type JobView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, IdText, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { RoutePage, RouteRow } from "./assets";
import { ActionPage, AmountField, AmountPage, amountProblem, ChoiceField, NumberField, SelectField, TextField, unchangedProblem, type Choice } from "./forms";
import type { PlayerControls, SectionProps, SegmentProps } from "./hub";
import { businessControls, findJob, gmParties, invoiceControls, jobControls, knownPeople, ownBusiness, possessive, workBlocks, type BusinessControl, type InvoiceControl } from "./layout";
import { FieldsPage, OwnerRows, TxnRows } from "./lines";
import { actionPage, Controls, Hero, MoneyPage, Note, type HubPage, type HubPages } from "./nav";
import { amountOf, distributeAction, drawAction, invoiceAction, invoiceIssueAction, jobEndAction, jobSpawnOps, newIdFor, raiseAction, stakeSellAction, stakeSellUnitsAction } from "./requests";
import { StatementsBlock } from "./statements";

type Invoice = BusinessView["invoices"][number];

/** A choice that stands for someone outside the world, whose name is typed instead. */
const OUTSIDE = "__outside";

/** The people a player's control may name (a customer, a buyer): those the POV knows. */
function people(controls: PlayerControls): Choice[] {
  return knownPeople(controls.palette).map((p) => ({ value: p.id, label: p.label }));
}

/** A job by its title, or how it pays when it has none. */
export function jobTitle(j: JobView): string {
  return j.title || humanize(j.basis);
}

// ---------------------------------------------------------------- jobs

/** A job as a row: its title, the employer (or, on a payroll, the worker) and the next payday, its pay; `onOpen` opens the job's page. */
export function JobListRow(props: { job: JobView; payroll: boolean; onOpen?(): void }) {
  const j = props.job;
  return (
    <ListRow
      title={jobTitle(j)}
      subtitle={[props.payroll ? j.worker : j.employer, j.nextPay ? `next payday ${j.nextPay}` : null].filter((s) => s !== null).join(" · ")}
      id={j.id}
      value={j.pay}
      badge={j.status === "active" ? undefined : <Badge>{humanize(j.status)}</Badge>}
      chevron={props.onOpen !== undefined}
      onClick={props.onOpen}
    />
  );
}

/** A paycheck as its payslip lists it: what it came to before and after, with the taxes and deductions between where the books show them. */
function Payslip(props: { job: JobView; withholding: boolean; currency: WorldCurrency }) {
  const { job: j } = props;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const last = j.lastPay;
  return (
    <Section title="Payslip" flush>
      <div data-lre-job-payslip={j.id}>
        <List>
          {last === null ? (
            <ListRow icon="receipt" title="No payslip yet" subtitle={j.nextPay ? `The first comes on payday, ${j.nextPay}` : undefined} />
          ) : props.withholding ? (
            <>
              <ListRow icon="receipt" title={`Paid ${last.at}`} subtitle="Before taxes" value={fmt(last.gross)} />
              <ListRow title="Taxes" value={fmt(-last.taxes)} valueTone="neg" />
              <ListRow title="Deductions" value={fmt(-last.deductions)} valueTone="neg" />
              <ListRow title="Net pay" value={fmt(last.net)} valueTone="pos" />
            </>
          ) : (
            <ListRow icon="receipt" title={`Paid ${last.at}`} subtitle="Net pay" value={fmt(last.net)} valueTone="pos" />
          )}
        </List>
      </div>
    </Section>
  );
}

/**
 * One job: its pay, schedule, next payday and hours, its payslip (taxes and deductions where the
 * books show them), where the pay goes, and the controls its mode allows: the worker quits;
 * whoever runs the employer gives a raise or lets them go; the GM ends it and edits its fields.
 */
function JobPage(props: SectionProps & { job: JobView; employer: BusinessView | null }) {
  const { view, controls, nav, job: j } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = workBlocks(view);
  const can = controls.mode === "player" ? jobControls(view, j, props.employer) : [];
  return (
    <MoneyPage nav={nav} name="job" title={jobTitle(j)} subtitle={j.workerId === view.party ? j.employer : `${j.worker} at ${j.employer}`}>
      <IdText id={j.id} />
      <Hero label="Pay" value={j.pay} sub={j.schedule} badges={<Badge tone={j.status === "active" ? "pos" : "neutral"}>{humanize(j.status)}</Badge>} />
      {can.length > 0 ? (
        <Controls name={j.id}>
          {can.includes("quit") ? (
            <Button variant="danger" icon="close" onClick={() => nav.open(actionPage("job", j.id, "quit"))}>
              Quit
            </Button>
          ) : null}
          {can.includes("raise") ? (
            <Button icon="plus" onClick={() => nav.open(actionPage("job", j.id, "raise"))}>
              Raise
            </Button>
          ) : null}
          {can.includes("let_go") ? (
            <Button variant="danger" icon="close" onClick={() => nav.open(actionPage("job", j.id, "let_go"))}>
              Let go
            </Button>
          ) : null}
        </Controls>
      ) : null}
      {controls.mode === "gm" ? (
        <Controls name={j.id}>
          <Button icon="list" onClick={() => nav.open(actionPage("job", j.id, "fields"))}>
            Job fields
          </Button>
          {j.status !== "ended" ? (
            <Button variant="danger" icon="close" onClick={() => nav.open(actionPage("job", j.id, "end"))}>
              End the job
            </Button>
          ) : null}
        </Controls>
      ) : null}
      {j.nextPay || j.grossPerPeriod !== null || j.hours ? (
        <Section flush>
          <List>
            {j.nextPay ? <ListRow icon="calendar" title="Next payday" value={j.nextPay} /> : null}
            {j.grossPerPeriod !== null ? <ListRow icon="coins" title="Each payday, before taxes" value={fmt(j.grossPerPeriod)} /> : null}
            {j.hours ? <ListRow icon="clock" title="Hours this period" subtitle={`${j.hours.scheduled} scheduled`} value={String(j.hours.attended)} /> : null}
          </List>
        </Section>
      ) : null}
      <Payslip job={j} withholding={blocks.withholding} currency={controls.currency} />
      {blocks.deductions && j.deductions.length > 0 ? (
        <Section title="Deductions" flush>
          <List>
            {j.deductions.map((d) => (
              <ListRow key={d.label} title={d.label} value={d.value} />
            ))}
          </List>
        </Section>
      ) : null}
      {j.splits.length > 0 ? (
        <Section title="Pay goes to" flush>
          <List>
            {j.splits.map((s) => (
              <ListRow key={s.to} title={s.to} value={s.value} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

/** The player quits their job or lets someone on a payroll they run go; the GM ends a job. Each is the page's one button. */
function JobEndPage(props: SectionProps & { job: JobView; control: "quit" | "let_go" | "end" }) {
  const { controls, nav, job: j, control } = props;
  const words = control === "quit" ? "Quit" : control === "let_go" ? "Let go" : "End the job";
  if (controls.mode === "read") return null;
  const submit = (tell?: boolean): Promise<boolean> => (controls.mode === "player" ? controls.act(jobEndAction(j.id), tell) : controls.edit([{ op: "set", entity: j.id, field: "status", value: "ended" }]));
  return (
    <ActionPage nav={nav} controls={controls} name={`job-${control}`} title={words} subtitle={control === "quit" ? jobTitle(j) : `${j.worker} · ${jobTitle(j)}`} go={words} danger action={jobEndAction(j.id)} submit={submit}>
      <Note>{`${words}: ${j.title || "the job"} at ${j.employer}?`}</Note>
    </ActionPage>
  );
}

/** The GM's new job for the party: an employer (a business in the world, or an outside employer by name), the title and the pay. */
function NewJobPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [employer, setEmployer] = useState("");
  const [outside, setOutside] = useState("");
  const [title, setTitle] = useState("");
  const [basis, setBasis] = useState<string>("hourly");
  const [rate, setRate] = useState("");
  const [every, setEvery] = useState<string>("biweekly");
  if (controls.mode !== "gm") return null;
  const cents = amountOf(rate, controls.currency);
  const businesses = gmParties(controls.gm, ["business"]).map((p) => ({ value: p.id, label: p.name }));
  // The job's `employer`: the business's id, or the outside employer's name as typed.
  const named = employer === OUTSIDE ? outside.trim() : employer;
  const submit = (): Promise<boolean> => {
    if (named === "" || cents === null) return Promise.resolve(false);
    const name = `${title.trim() || humanize(basis)} at ${businesses.find((b) => b.value === named)?.label ?? named}`;
    const id = newIdFor("job", `${view.name} ${title || basis}`, new Set(controls.gm.entities.map((e) => e.id)));
    return controls.edit(jobSpawnOps(id, name, { worker: view.party, employer: named, ...(title.trim() !== "" ? { title: title.trim() } : {}), basis, rate: cents, pay_every: every }));
  };
  return (
    <ActionPage nav={nav} controls={controls} name="job-new" title="Add a job" subtitle={view.name} go="Add the job" problem={named !== "" ? amountProblem(rate, controls.currency, "the rate") : employer === OUTSIDE ? "Type the employer's name." : "Choose the employer."} submit={submit}>
      <SelectField label="Employer" value={employer} empty="Choose" options={[...businesses, { value: OUTSIDE, label: "An outside employer (type the name)" }]} onChange={setEmployer} />
      {employer === OUTSIDE ? <TextField label="Employer's name" value={outside} onInput={setOutside} placeholder="Harbor Freight" /> : null}
      <TextField label="Title" value={title} onInput={setTitle} />
      <SelectField label="Paid by" value={basis} options={PAY_BASES.map((b) => ({ value: b, label: humanize(b) }))} onChange={setBasis} />
      <AmountField label="Rate (a year, an hour or a shift)" value={rate} currency={controls.currency} onInput={setRate} invalid={rate.trim() !== "" && cents === null} />
      <SelectField label="Paid" value={every} options={PAY_EVERY.map((p) => ({ value: p, label: humanize(p) }))} onChange={setEvery} />
    </ActionPage>
  );
}

/** A job's pages: the job and each control's page, each only where the mode and the view allow it. */
function jobPage(control: string | undefined, props: SectionProps, job: JobView, employer: BusinessView | null) {
  const { view, controls, nav } = props;
  const can = controls.mode === "player" ? jobControls(view, job, employer) : [];
  switch (control) {
    case undefined:
      return <JobPage {...props} job={job} employer={employer} />;
    case "quit":
    case "let_go":
      return can.includes(control) ? <JobEndPage {...props} job={job} control={control} /> : null;
    case "end":
      return controls.mode === "gm" && job.status !== "ended" ? <JobEndPage {...props} job={job} control="end" /> : null;
    case "raise":
      return can.includes("raise") && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="job-raise" title="Raise" subtitle={`${job.worker} · ${jobTitle(job)}`} label={`New rate (now ${job.pay})`} go="Give the raise" action={(cents) => (cents === null ? null : raiseAction(job.id, cents))} submit={(cents, tell) => (cents === null ? Promise.resolve(false) : controls.act(raiseAction(job.id, cents), tell))} /> : null;
    case "fields":
      return <FieldsPage nav={nav} controls={controls} name="job-fields" title="Job fields" subtitle={jobTitle(job)} entity={job.id} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- a business's books and invoices

/** A business's own money's Books (ORG-SPEC §5.1, in Orgs): the year's books by category in the full books, month by month, its sales where they show, and its statements from Money 3 (§26.5). */
export function BooksSegment(props: SegmentProps) {
  const { view, controls } = props;
  const b = ownBusiness(view);
  if (!b) return null;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = workBlocks(view);
  return (
    <>
      <Hero label={`Profit · ${b.books.period}`} value={fmt(b.books.profit)} tone={b.books.profit < 0 ? "neg" : "pos"} />
      <Section title={`Books · ${b.books.period}`} flush>
        <List>
          <ListRow title="Revenue" value={fmt(b.books.revenue)} valueTone="pos" />
          <ListRow title="Expenses" value={fmt(-Math.abs(b.books.expenses))} valueTone="neg" />
          <ListRow title="Payroll" value={fmt(-Math.abs(b.books.payroll))} valueTone="neg" />
          {blocks.taxes ? <ListRow title="Taxes" value={fmt(-Math.abs(b.books.taxes))} valueTone="neg" /> : null}
          <ListRow title="Profit" value={fmt(b.books.profit)} valueTone={b.books.profit < 0 ? "neg" : "pos"} />
          {blocks.books
            ? b.books.lines.map((l) => (
                <ListRow key={l.category} title={humanize(l.category)} value={fmt(l.cents)} valueTone={l.cents < 0 ? "neg" : "pos"} />
              ))
            : null}
        </List>
      </Section>
      {blocks.books && b.months.length > 0 ? (
        <Section title="Month by month" flush>
          <List>
            {b.months.map((m) => (
              <ListRow key={m.period} title={m.period} subtitle={`${fmt(m.revenue)} in · ${fmt(-Math.abs(m.expenses))} out`} value={fmt(m.profit)} valueTone={m.profit < 0 ? "neg" : "pos"} />
            ))}
          </List>
        </Section>
      ) : null}
      {blocks.sales && b.sales.length > 0 ? (
        <Section title="Sales" flush>
          <TxnRows lines={b.sales} max={10} currency={controls.currency} />
        </Section>
      ) : null}
      {b.statements ? <StatementsBlock statements={b.statements} currency={controls.currency} /> : null}
    </>
  );
}

/** An invoice as a row: who it bills and for what, when it was issued and falls due, how late it is, its amount and state; `onOpen` when there's something to do with it. */
function InvoiceRow(props: { invoice: Invoice; currency: WorldCurrency; onOpen?(): void }) {
  const i = props.invoice;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  return (
    <ListRow
      title={`${i.customerName}: ${i.memo || "invoice"}`}
      subtitle={[`issued ${i.issuedAt}`, `due ${i.dueAt}`, i.days_late ? `${i.days_late} days late` : null, i.late_fee ? `late fee ${fmt(i.late_fee)}` : null].filter((s) => s !== null).join(" · ")}
      id={i.id}
      value={fmt(i.cents)}
      badge={<Badge tone={i.state === "late" ? "neg" : i.state === "paid" ? "pos" : "neutral"}>{humanize(i.state)}</Badge>}
      chevron={props.onOpen !== undefined}
      onClick={props.onOpen}
    />
  );
}

/**
 * The invoices a business issued, on its own money's In & out, with Issue an invoice where the
 * reader runs it. Each opens what may be done with it: the reader's own Void or Pay (as their own
 * role on the business allows, or as its customer), or the GM's state.
 */
export function IssuedInvoices(props: SectionProps & { business: BusinessView }) {
  const { controls, nav, reader, business: b } = props;
  // The reader's own view of the business: their role on it decides their controls.
  const theirs = reader?.view.businesses.find((x) => x.id === b.id) ?? null;
  const issue = reader && theirs ? businessControls(reader.view, theirs).includes("invoice") : false;
  const invoicePage = (i: Invoice): HubPage | null => {
    if (controls.mode === "gm") return actionPage("business", b.id, "state", i.id);
    const own = theirs?.invoices.find((x) => x.id === i.id);
    const mine = reader && theirs && own ? invoiceControls(reader.view, theirs, own) : [];
    if (mine.length === 0) return null;
    return actionPage("business", b.id, mine.length === 1 ? (mine[0] ?? "invoice") : "invoice", i.id);
  };
  return (
    <div class="lre-stack" data-lre-money-invoices={b.id}>
      {issue ? (
        <Button variant="primary" icon="receipt" block onClick={() => nav.open(actionPage("business", b.id, "invoice"))}>
          Issue an invoice
        </Button>
      ) : null}
      <Section title="Invoices it issued" flush>
        {b.invoices.length === 0 ? (
          <Empty icon="receipt">No invoices.</Empty>
        ) : (
          <List>
            {b.invoices.map((i) => {
              const page = invoicePage(i);
              return <InvoiceRow key={i.id} invoice={i} currency={controls.currency} onOpen={page === null ? undefined : () => nav.open(page)} />;
            })}
          </List>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- a business's controls

const BUSINESS_CONTROL: Readonly<Record<BusinessControl, string>> = { invoice: "Issue an invoice", draw: "Owner's draw", distribute: "Pay out profit", stake: "Sell a stake" };

const INVOICE_CONTROL: Readonly<Record<InvoiceControl, { title: string; go: string }>> = { void: { title: "Void the invoice", go: "Void" }, pay: { title: "Pay the invoice", go: "Pay" } };

function IssueInvoicePage(props: SectionProps & { business: BusinessView }) {
  const { controls, nav, business: b } = props;
  const [customer, setCustomer] = useState("");
  const [outside, setOutside] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<number | null>(null);
  if (controls.mode !== "player") return null;
  const cents = amountOf(amount, controls.currency);
  const who = customer === OUTSIDE ? (outside.trim() !== "" ? { name: outside } : null) : customer !== "" ? { id: customer } : null;
  const body = who === null || cents === null ? null : invoiceIssueAction(b.id, who, cents, memo, days);
  return (
    <ActionPage nav={nav} controls={controls} name="business-invoice" title={BUSINESS_CONTROL.invoice} subtitle={b.name} go="Issue the invoice" problem={customer === "" ? "Choose a customer." : who === null ? "Type the customer's name." : amountProblem(amount, controls.currency, "the amount")} action={body} submit={(tell) => (body === null ? Promise.resolve(false) : controls.act(body, tell))}>
      <SelectField label="To" value={customer} empty="Choose a customer" options={[...people(controls), { value: OUTSIDE, label: "Someone else (type the name)" }]} onChange={setCustomer} />
      {customer === OUTSIDE ? <TextField label="Customer's name" value={outside} onInput={setOutside} /> : null}
      <AmountField label="Amount" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} />
      <TextField label="For" value={memo} onInput={setMemo} placeholder="Brake job" />
      <NumberField label="Due in (days; empty: the business's terms)" value={days} min={0} onChange={setDays} />
    </ActionPage>
  );
}

/** Selling the player's shares: in units where the company counts them (ORG-SPEC §3.10), else a percent of it. */
function StakeSalePage(props: SectionProps & { business: BusinessView }) {
  const { view, controls, nav, business: b } = props;
  const [share, setShare] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [buyer, setBuyer] = useState("");
  if (controls.mode !== "player") return null;
  const units = b.owners.some((o) => o.units !== undefined);
  const held = b.owners.filter((o) => o.party === view.party).reduce((a, o) => a + (o.units ?? 0), 0);
  const cents = amountOf(price, controls.currency);
  const problem = share === null ? (units ? "Type the units to sell." : "Type the share to sell.") : share <= 0 ? (units ? "Sell at least a unit." : "Sell a share above 0%.") : units && (!Number.isInteger(share) || share > held) ? `You hold ${held} units.` : amountProblem(price, controls.currency, "the price");
  const body = share === null || cents === null ? null : units ? stakeSellUnitsAction(b.id, share, cents, buyer || undefined) : stakeSellAction(b.id, share, cents, buyer || undefined);
  return (
    <ActionPage nav={nav} controls={controls} name="business-stake" title={BUSINESS_CONTROL.stake} subtitle={b.name} go="Sell the shares" problem={problem} action={body} submit={(tell) => (body === null || problem !== null ? Promise.resolve(false) : controls.act(body, tell))}>
      {units ? <NumberField label={`Units to sell (you hold ${held})`} value={share} min={1} max={held} onChange={setShare} /> : <NumberField label="Share to sell (%)" value={share} min={0} max={100} onChange={setShare} />}
      <AmountField label="Price" value={price} currency={controls.currency} onInput={setPrice} invalid={price.trim() !== "" && cents === null} />
      <SelectField label="Buyer" value={buyer} empty="Whoever buys" options={people(controls)} onChange={setBuyer} />
    </ActionPage>
  );
}

/** An invoice as the one line an action page acts on. */
function InvoiceLine(props: { invoice: Invoice; currency: WorldCurrency }) {
  return (
    <Section flush>
      <List>
        <InvoiceRow invoice={props.invoice} currency={props.currency} />
      </List>
    </Section>
  );
}

/** The player voids an invoice their business issued, or pays one billed to them. */
function InvoiceControlPage(props: SectionProps & { business: BusinessView; invoice: Invoice; control: InvoiceControl }) {
  const { controls, nav, business: b, invoice: i, control } = props;
  if (controls.mode !== "player") return null;
  return (
    <ActionPage nav={nav} controls={controls} name={`invoice-${control}`} title={INVOICE_CONTROL[control].title} subtitle={b.name} go={INVOICE_CONTROL[control].go} danger={control === "void"} action={invoiceAction(i.id, control)} submit={(tell) => controls.act(invoiceAction(i.id, control), tell)}>
      <InvoiceLine invoice={i} currency={controls.currency} />
      <Note>{control === "void" ? `Void the invoice to ${i.customerName}?` : "Otherwise it's paid when it falls due, if the money's there."}</Note>
    </ActionPage>
  );
}

/** An invoice with both the player's controls on it (a business billing its own manager): a page offering each. */
function InvoiceChoicesPage(props: SectionProps & { business: BusinessView; invoice: Invoice; can: readonly InvoiceControl[] }) {
  const { controls, nav, business: b, invoice: i } = props;
  return (
    <MoneyPage nav={nav} name="invoice" title={`Invoice to ${i.customerName}`} subtitle={b.name}>
      <InvoiceLine invoice={i} currency={controls.currency} />
      <Controls name={i.id}>
        {props.can.map((c) => (
          <Button key={c} variant={c === "pay" ? "primary" : "danger"} icon={c === "pay" ? "check" : "close"} onClick={() => nav.open(actionPage("business", b.id, c, i.id))}>
            {INVOICE_CONTROL[c].go}
          </Button>
        ))}
      </Controls>
    </MoneyPage>
  );
}

const INVOICE_STATE_DETAIL: Readonly<Record<InvoiceState, string>> = { open: "Waiting to be paid.", paid: "Settled.", late: "Past its due date and unpaid.", void: "Cancelled; nothing is owed." };

/** The GM's state for an invoice, one edit. */
function InvoiceStatePage(props: SectionProps & { business: BusinessView; invoice: Invoice }) {
  const { controls, nav, business: b, invoice: i } = props;
  const [state, setState] = useState<InvoiceState>(i.state);
  if (controls.mode !== "gm") return null;
  return (
    <ActionPage nav={nav} controls={controls} name="invoice-state" title="State" subtitle={`${b.name} · invoice to ${i.customerName}`} go="Save" problem={state === i.state ? unchangedProblem(i.state, "state") : null} submit={() => controls.edit([{ op: "set", entity: i.id, field: "state", value: state }])}>
      <InvoiceLine invoice={i} currency={controls.currency} />
      <ChoiceField label="State" value={state} options={INVOICE_STATES.map((s) => ({ value: s, label: humanize(s), detail: INVOICE_STATE_DETAIL[s] }))} onChange={(v) => setState(INVOICE_STATES.find((s) => s === v) ?? i.state)} />
    </ActionPage>
  );
}

/** Where the party's share of a business's profit goes, in its words: "Your share of its profit goes to", or the GM's "Marcus Delgado's share…". */
export function shareRouteLabel(props: SectionProps): string {
  return props.controls.mode === "player" ? "Your share of its profit goes to" : `${possessive(props.view.name, props.view.partyKind === "household")} share of its profit goes to`;
}

/** A business's control pages and an invoice's, each only where the mode and the view allow it; the business itself has its pages in Orgs. */
function businessPage(control: string | undefined, inner: string | undefined, props: SectionProps, b: BusinessView) {
  const { view, controls, nav } = props;
  if (control === "route") return b.role !== null && ROLE_RIGHTS[b.role].worth ? <RoutePage view={view} controls={controls} nav={nav} target={{ business: b.id }} route={b.route} reinvest label={shareRouteLabel(props)} subtitle={b.name} /> : null;
  if (inner !== undefined) {
    const invoice = b.invoices.find((i) => i.id === inner);
    if (!invoice) return null;
    if (control === "state") return <InvoiceStatePage {...props} business={b} invoice={invoice} />;
    const can = controls.mode === "player" ? invoiceControls(view, b, invoice) : [];
    if (control === "invoice") return can.length > 0 ? <InvoiceChoicesPage {...props} business={b} invoice={invoice} can={can} /> : null;
    return (control === "pay" || control === "void") && can.includes(control) ? <InvoiceControlPage {...props} business={b} invoice={invoice} control={control} /> : null;
  }
  const can = controls.mode === "player" ? businessControls(view, b) : [];
  switch (control) {
    case "invoice":
      return can.includes(control) ? <IssueInvoicePage {...props} business={b} /> : null;
    case "stake":
      return can.includes(control) ? <StakeSalePage {...props} business={b} /> : null;
    case "draw":
      return can.includes(control) && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="business-draw" title={BUSINESS_CONTROL.draw} subtitle={b.name} label="Amount" go="Draw it" action={(cents) => (cents === null ? null : drawAction(b.id, cents))} submit={(cents, tell) => (cents === null ? Promise.resolve(false) : controls.act(drawAction(b.id, cents), tell))} /> : null;
    case "distribute":
      return can.includes(control) && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="business-distribute" title={BUSINESS_CONTROL.distribute} subtitle={b.name} label="Amount" go="Pay it out by share" optional="Its share of the profit since the last" action={(cents) => distributeAction(b.id, cents)} submit={(cents, tell) => controls.act(distributeAction(b.id, cents), tell)} /> : null;
    default:
      return null;
  }
}

/**
 * A person's stake in a business, as the GM sees it from their money (Assets): their role and
 * share, where their share of its profit goes, and its owners; the business itself opens in GM →
 * Orgs. The player's stakes open the business's Ownership in Orgs instead.
 */
function StakePage(props: SectionProps & { business: BusinessView }) {
  const { view, controls, nav, business: b } = props;
  const share = b.owners.find((o) => o.party === view.party)?.share ?? null;
  return (
    <MoneyPage nav={nav} name="stake" title={b.name} subtitle={b.role ? humanize(b.role) : undefined}>
      <IdText id={b.id} />
      <Hero label={`${possessive(view.name, view.partyKind === "household")} share`} value={share !== null ? `${Math.round(share * 10) / 10}%` : "—"} sub={`Profit · ${b.books.period}: ${formatMoney(b.books.profit, controls.currency)}`} />
      <Controls name={b.id}>
        <Button icon="briefcase" iconAfter="chevron-right" onClick={() => nav.elsewhere({ org: b.id, tab: "economy.ownership" })}>
          Open in GM → Orgs
        </Button>
      </Controls>
      {b.role !== null && ROLE_RIGHTS[b.role].worth ? <RouteRow view={view} controls={controls} nav={nav} route={b.route} reinvest label={shareRouteLabel(props)} page={actionPage("business", b.id, "route")} /> : null}
      {b.owners.length > 0 ? (
        <Section title="Owners" flush>
          <List>
            <OwnerRows owners={b.owners} />
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

/** Jobs' pages (a job and its controls, the GM's new job), a business's control pages, and the GM's stake pages. What the view no longer holds, or the mode may not do, draws nothing (gone). */
export const workPages: HubPages = {
  heads: ["jobs", "job", "business", "stake"],
  render(page, props) {
    const { view, controls } = props;
    const [head, id, control, inner] = page.path;
    if (head === "jobs") return id === "new" && controls.mode === "gm" ? <NewJobPage {...props} /> : null;
    if (id === undefined) return null;
    if (head === "job") {
      const found = findJob(view, id);
      return found ? jobPage(control, props, found.job, found.employer) : null;
    }
    const business = view.businesses.find((b) => b.id === id);
    if (!business) return null;
    if (head === "stake") return controls.mode === "gm" && page.type === "detail" ? <StakePage {...props} business={business} /> : null;
    return page.type === "action" ? businessPage(control, inner, props, business) : null;
  },
};
