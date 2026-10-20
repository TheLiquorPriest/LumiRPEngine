// Money → Jobs and Businesses (DESIGN §26): the party's jobs with their pay, schedule and last
// paycheck; the businesses it owns or runs with their books, sales, invoices, payroll and taxes.
// Each job and business opens its own page, and each control there its own page with Back and one
// button. The player quits a job, and for a business they manage hires, gives raises, lets people
// go, issues, pays and voids invoices, draws money, pays out profit, sells a stake and says where
// their profit goes, each an in-world action; the GM ends and edits jobs, adds one, sets an
// invoice's state, edits every business's declared fields and routes an owner's profit.

import { useState } from "preact/hooks";
import { INVOICE_STATES, PAY_BASES, PAY_EVERY, ROLE_RIGHTS, type BusinessView, type FinanceView, type InvoiceState, type JobView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, IdText, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { RoutePage, RouteRow } from "./assets";
import { ActionPage, AmountField, AmountPage, ChoiceField, NumberField, SelectField, TextField, type Choice } from "./forms";
import type { PlayerControls, SectionProps } from "./hub";
import { businessControls, invoiceControls, jobControls, knownPeople, workBlocks, type BusinessControl, type InvoiceControl } from "./layout";
import { FieldsPage, TxnRows } from "./lines";
import { actionPage, Controls, detailPage, Hero, MoneyPage, Note, type HubPages } from "./nav";
import { amountOf, distributeAction, drawAction, hireAction, invoiceAction, invoiceIssueAction, jobEndAction, jobSpawnOps, newIdFor, raiseAction, stakeSellAction, type HireForm } from "./requests";

type Invoice = BusinessView["invoices"][number];

/** A choice that stands for someone outside the world, whose name is typed instead. */
const OUTSIDE = "__outside";

/** The people a player's control may name (a hire, a customer, a buyer): those the POV knows. */
function people(controls: PlayerControls): Choice[] {
  return knownPeople(controls.palette).map((p) => ({ value: p.id, label: p.label }));
}

/** A job by its title, or how it pays when it has none. */
function jobTitle(j: JobView): string {
  return j.title || humanize(j.basis);
}

// ---------------------------------------------------------------- jobs

/**
 * A job by id: one of the party's own, or one on the payroll of a business it owns or runs, with
 * that business (whose manager gives raises and lets people go, as its payroll offered).
 */
function findJob(view: FinanceView, id: string): { job: JobView; employer: BusinessView | null } | null {
  for (const b of view.businesses) {
    const job = b.employees.find((j) => j.id === id);
    if (job) return { job, employer: b };
  }
  const job = view.jobs.find((j) => j.id === id);
  return job ? { job, employer: null } : null;
}

/** A job as a row: its title, the employer (or, on a payroll, the worker) and the next payday, its pay; it opens the job's page. */
function JobListRow(props: { job: JobView; payroll: boolean; onOpen(): void }) {
  const j = props.job;
  return (
    <ListRow
      title={jobTitle(j)}
      subtitle={[props.payroll ? j.worker : j.employer, j.nextPay ? `next payday ${j.nextPay}` : null].filter((s) => s !== null).join(" · ")}
      id={j.id}
      value={j.pay}
      badge={j.status === "active" ? undefined : <Badge>{humanize(j.status)}</Badge>}
      chevron
      onClick={props.onOpen}
    />
  );
}

function JobsSection(props: SectionProps) {
  const { view, controls, nav } = props;
  return (
    <MoneyPage nav={nav} name="jobs" title="Jobs">
      {controls.mode === "gm" ? (
        <Button variant="primary" icon="plus" block onClick={() => nav.open(actionPage("jobs", "new"))}>
          Add a job
        </Button>
      ) : null}
      {view.jobs.length === 0 ? (
        <Empty icon="briefcase">No jobs.</Empty>
      ) : (
        <Section flush>
          <List>
            {view.jobs.map((j) => (
              <JobListRow key={j.id} job={j} payroll={false} onOpen={() => nav.open(detailPage("job", j.id))} />
            ))}
          </List>
        </Section>
      )}
    </MoneyPage>
  );
}

/**
 * One job: its pay, schedule, next payday, hours and last paycheck (taxes and deductions where the
 * books show them), where the pay goes, and the controls its mode allows: the worker quits; whoever
 * runs the employer gives a raise or lets them go; the GM ends it and edits its fields.
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
      {j.nextPay || j.grossPerPeriod !== null || j.hours || j.lastPay ? (
        <Section flush>
          <List>
            {j.nextPay ? <ListRow icon="calendar" title="Next payday" value={j.nextPay} /> : null}
            {j.grossPerPeriod !== null ? <ListRow icon="coins" title="Each payday, before taxes" value={fmt(j.grossPerPeriod)} /> : null}
            {j.hours ? <ListRow icon="clock" title="Hours this period" subtitle={`${j.hours.scheduled} scheduled`} value={String(j.hours.attended)} /> : null}
            {j.lastPay ? <ListRow icon="receipt" title={`Last paid ${j.lastPay.at}`} subtitle={blocks.withholding ? `${fmt(j.lastPay.gross)} gross · ${fmt(-j.lastPay.taxes)} taxes · ${fmt(-j.lastPay.deductions)} deductions` : undefined} value={fmt(j.lastPay.net)} valueTone="pos" /> : null}
          </List>
        </Section>
      ) : null}
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
  const submit = (): Promise<boolean> => (controls.mode === "player" ? controls.act(jobEndAction(j.id)) : controls.edit([{ op: "set", entity: j.id, field: "status", value: "ended" }]));
  return (
    <ActionPage nav={nav} controls={controls} name={`job-${control}`} title={words} subtitle={control === "quit" ? jobTitle(j) : `${j.worker} · ${jobTitle(j)}`} go={words} danger submit={submit}>
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
  const businesses = controls.gm.entities.filter((e) => e.kind === "business" && !e.gone).map((e) => ({ value: e.id, label: e.name }));
  // The job's `employer`: the business's id, or the outside employer's name as typed.
  const named = employer === OUTSIDE ? outside.trim() : employer;
  const submit = (): Promise<boolean> => {
    if (named === "" || cents === null) return Promise.resolve(false);
    const name = `${title.trim() || humanize(basis)} at ${businesses.find((b) => b.value === named)?.label ?? named}`;
    const id = newIdFor("job", `${view.name} ${title || basis}`, new Set(controls.gm.entities.map((e) => e.id)));
    return controls.edit(jobSpawnOps(id, name, { worker: view.party, employer: named, ...(title.trim() !== "" ? { title: title.trim() } : {}), basis, rate: cents, pay_every: every }));
  };
  return (
    <ActionPage nav={nav} controls={controls} name="job-new" title="Add a job" subtitle={view.name} go="Add the job" disabled={named === "" || cents === null} submit={submit}>
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
      return can.includes("raise") && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="job-raise" title="Raise" subtitle={`${job.worker} · ${jobTitle(job)}`} label={`New rate (now ${job.pay})`} go="Give the raise" submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(raiseAction(job.id, cents)))} /> : null;
    case "fields":
      return <FieldsPage nav={nav} controls={controls} name="job-fields" title="Job fields" subtitle={jobTitle(job)} entity={job.id} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- businesses

const BUSINESS_ICON: IconName = "bag";

function BusinessesSection(props: SectionProps) {
  const { view, controls, nav } = props;
  return (
    <MoneyPage nav={nav} name="businesses" title="Businesses">
      {view.businesses.length === 0 ? (
        <Empty icon={BUSINESS_ICON}>No businesses.</Empty>
      ) : (
        <Section flush>
          <List>
            {view.businesses.map((b) => (
              <ListRow
                key={b.id}
                title={b.name}
                subtitle={[b.role ? humanize(b.role) : null, `${b.books.period} profit`].filter((s) => s !== null).join(" · ")}
                id={b.id}
                value={formatMoney(b.books.profit, controls.currency)}
                valueTone={b.books.profit < 0 ? "neg" : "pos"}
                badge={b.invoices.some((i) => i.state === "late") ? <Badge tone="warn">Late invoice</Badge> : undefined}
                chevron
                onClick={() => nav.open(detailPage("business", b.id))}
              />
            ))}
          </List>
        </Section>
      )}
    </MoneyPage>
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

const BUSINESS_CONTROL: Readonly<Record<BusinessControl, { label: string; icon: IconName }>> = {
  hire: { label: "Hire", icon: "user-plus" },
  invoice: { label: "Issue an invoice", icon: "receipt" },
  draw: { label: "Owner's draw", icon: "wallet" },
  distribute: { label: "Pay out profit", icon: "coins" },
  stake: { label: "Sell a stake", icon: "users" },
};

const INVOICE_CONTROL: Readonly<Record<InvoiceControl, { title: string; go: string }>> = { void: { title: "Void the invoice", go: "Void" }, pay: { title: "Pay the invoice", go: "Pay" } };

/** One business: its owners, where it trades, its books, invoices, payroll and taxes, where the viewer's profit goes, and the controls its role allows. */
function BusinessPage(props: SectionProps & { business: BusinessView }) {
  const { view, controls, nav, business: b } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = workBlocks(view);
  const can = controls.mode === "player" ? businessControls(view, b) : [];
  // An account the view doesn't name (one only the business holds) is never shown by its id (ids show only with Show ids).
  const accountName = (id: string): string => view.accounts.find((a) => a.id === id)?.name ?? (controls.mode === "gm" ? controls.gm.entities.find((e) => e.id === id)?.name : undefined) ?? "another account";
  // The player's own control on an invoice is its page; with both (a business billing its own manager) a page offers each; the GM sets its state.
  const invoicePage = (i: Invoice) => {
    if (controls.mode === "gm") return actionPage("business", b.id, "state", i.id);
    const mine = invoiceControls(view, b, i);
    if (mine.length === 0) return null;
    return actionPage("business", b.id, mine.length === 1 ? (mine[0] ?? "invoice") : "invoice", i.id);
  };
  return (
    <MoneyPage nav={nav} name="business" title={b.name} subtitle={b.role ? humanize(b.role) : undefined}>
      <IdText id={b.id} />
      <Hero label={`Profit · ${b.books.period}`} value={fmt(b.books.profit)} tone={b.books.profit < 0 ? "neg" : "pos"} />
      {can.length > 0 ? (
        <Controls name={b.id}>
          {can.map((c) => (
            <Button key={c} icon={BUSINESS_CONTROL[c].icon} onClick={() => nav.open(actionPage("business", b.id, c))}>
              {BUSINESS_CONTROL[c].label}
            </Button>
          ))}
        </Controls>
      ) : null}
      {controls.mode === "gm" ? (
        <Controls name={b.id}>
          <Button icon="list" onClick={() => nav.open(actionPage("business", b.id, "fields"))}>
            Business fields
          </Button>
        </Controls>
      ) : null}
      {b.places.length > 0 || b.accounts.length > 0 ? (
        <Section flush>
          <List>
            {b.places.length > 0 ? <ListRow icon="pin" title="Trades at" value={b.places.map((p) => p.name).join(", ")} /> : null}
            {b.accounts.length > 0 ? <ListRow icon="bank" title="Accounts" value={b.accounts.map(accountName).join(", ")} /> : null}
          </List>
        </Section>
      ) : null}
      {b.owners.length > 0 ? (
        <Section title="Owners" flush>
          <List>
            {b.owners.map((o) => (
              <ListRow key={o.party} title={o.name} subtitle={humanize(o.role)} value={o.share > 0 ? `${Math.round(o.share * 10) / 10}%` : undefined} />
            ))}
          </List>
        </Section>
      ) : null}
      {b.role !== null && ROLE_RIGHTS[b.role].worth ? <RouteRow view={view} controls={controls} nav={nav} route={b.route} reinvest label={controls.mode === "player" ? "Your share of its profit goes to" : `${view.name}'s share of its profit goes to`} page={actionPage("business", b.id, "route")} /> : null}
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
      <Section title="Invoices" flush>
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
      <Section title="Payroll" flush>
        {b.employees.length === 0 ? (
          <Empty icon="users">No one on the payroll.</Empty>
        ) : (
          <List>
            {b.employees.map((j) => (
              <JobListRow key={j.id} job={j} payroll onOpen={() => nav.open(detailPage("job", j.id))} />
            ))}
          </List>
        )}
      </Section>
      {blocks.taxes && b.taxes.length > 0 ? (
        <Section title="Taxes" flush>
          <List>
            {b.taxes.map((t) => (
              <ListRow key={t.label} title={t.label} subtitle={t.due ? `due ${t.due}` : undefined} value={fmt(t.cents)} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

function HirePage(props: SectionProps & { business: BusinessView }) {
  const { controls, nav, business: b } = props;
  const [form, setForm] = useState<HireForm>({ business: b.id, worker: "", title: "", basis: "hourly", rate: "", hoursPerWeek: null, payEvery: "biweekly" });
  if (controls.mode !== "player") return null;
  const body = hireAction(form, controls.currency);
  return (
    <ActionPage nav={nav} controls={controls} name="business-hire" title="Hire" subtitle={b.name} go="Hire" disabled={body === null} submit={() => (body === null ? Promise.resolve(false) : controls.act(body))}>
      <SelectField label="Who" value={form.worker} empty="Choose someone" options={people(controls)} onChange={(worker) => setForm({ ...form, worker })} />
      <TextField label="Title" value={form.title} onInput={(title) => setForm({ ...form, title })} />
      <SelectField label="Paid by" value={form.basis} options={PAY_BASES.map((p) => ({ value: p, label: humanize(p) }))} onChange={(basis) => setForm({ ...form, basis })} />
      <AmountField label="Rate (a year, an hour or a shift)" value={form.rate} currency={controls.currency} onInput={(rate) => setForm({ ...form, rate })} invalid={form.rate.trim() !== "" && amountOf(form.rate, controls.currency) === null} />
      <NumberField label="Hours a week" value={form.hoursPerWeek} min={0} onChange={(hoursPerWeek) => setForm({ ...form, hoursPerWeek })} />
      <SelectField label="Paid" value={form.payEvery} options={PAY_EVERY.map((p) => ({ value: p, label: humanize(p) }))} onChange={(payEvery) => setForm({ ...form, payEvery })} />
    </ActionPage>
  );
}

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
  return (
    <ActionPage nav={nav} controls={controls} name="business-invoice" title="Issue an invoice" subtitle={b.name} go="Issue the invoice" disabled={who === null || cents === null} submit={() => (who === null || cents === null ? Promise.resolve(false) : controls.act(invoiceIssueAction(b.id, who, cents, memo, days)))}>
      <SelectField label="To" value={customer} empty="Choose a customer" options={[...people(controls), { value: OUTSIDE, label: "Someone else (type the name)" }]} onChange={setCustomer} />
      {customer === OUTSIDE ? <TextField label="Customer's name" value={outside} onInput={setOutside} /> : null}
      <AmountField label="Amount" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} />
      <TextField label="For" value={memo} onInput={setMemo} placeholder="Brake job" />
      <NumberField label="Due in (days; empty: the business's terms)" value={days} min={0} onChange={setDays} />
    </ActionPage>
  );
}

function StakePage(props: SectionProps & { business: BusinessView }) {
  const { controls, nav, business: b } = props;
  const [share, setShare] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [buyer, setBuyer] = useState("");
  if (controls.mode !== "player") return null;
  const cents = amountOf(price, controls.currency);
  const ok = share !== null && share > 0 && share <= 100 && cents !== null;
  return (
    <ActionPage nav={nav} controls={controls} name="business-stake" title="Sell a stake" subtitle={b.name} go="Sell the stake" disabled={!ok} submit={() => (share === null || cents === null || !ok ? Promise.resolve(false) : controls.act(stakeSellAction(b.id, share, cents, buyer || undefined)))}>
      <NumberField label="Share to sell (%)" value={share} min={0} max={100} onChange={setShare} />
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
    <ActionPage nav={nav} controls={controls} name={`invoice-${control}`} title={INVOICE_CONTROL[control].title} subtitle={b.name} go={INVOICE_CONTROL[control].go} danger={control === "void"} submit={() => controls.act(invoiceAction(i.id, control))}>
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
    <ActionPage nav={nav} controls={controls} name="invoice-state" title="State" subtitle={`${b.name} · invoice to ${i.customerName}`} go="Save" disabled={state === i.state} submit={() => controls.edit([{ op: "set", entity: i.id, field: "state", value: state }])}>
      <InvoiceLine invoice={i} currency={controls.currency} />
      <ChoiceField label="State" value={state} options={INVOICE_STATES.map((s) => ({ value: s, label: humanize(s), detail: INVOICE_STATE_DETAIL[s] }))} onChange={(v) => setState(INVOICE_STATES.find((s) => s === v) ?? i.state)} />
    </ActionPage>
  );
}

/** A business's pages: the business, each control's page and an invoice's, each only where the mode and the view allow it. */
function businessPage(control: string | undefined, inner: string | undefined, props: SectionProps, b: BusinessView) {
  const { view, controls, nav } = props;
  const invoice = inner === undefined ? undefined : b.invoices.find((i) => i.id === inner);
  if (control === undefined) return <BusinessPage {...props} business={b} />;
  if (control === "fields") return <FieldsPage nav={nav} controls={controls} name="business-fields" title="Business fields" subtitle={b.name} entity={b.id} />;
  if (control === "route") return b.role !== null && ROLE_RIGHTS[b.role].worth ? <RoutePage view={view} controls={controls} nav={nav} target={{ business: b.id }} route={b.route} reinvest label={controls.mode === "player" ? "Your share of its profit goes to" : `${view.name}'s share of its profit goes to`} subtitle={b.name} /> : null;
  if (inner !== undefined) {
    if (!invoice) return null;
    if (control === "state") return <InvoiceStatePage {...props} business={b} invoice={invoice} />;
    const can = controls.mode === "player" ? invoiceControls(view, b, invoice) : [];
    if (control === "invoice") return can.length > 0 ? <InvoiceChoicesPage {...props} business={b} invoice={invoice} can={can} /> : null;
    return (control === "pay" || control === "void") && can.includes(control) ? <InvoiceControlPage {...props} business={b} invoice={invoice} control={control} /> : null;
  }
  const can = controls.mode === "player" ? businessControls(view, b) : [];
  switch (control) {
    case "hire":
      return can.includes(control) ? <HirePage {...props} business={b} /> : null;
    case "invoice":
      return can.includes(control) ? <IssueInvoicePage {...props} business={b} /> : null;
    case "stake":
      return can.includes(control) ? <StakePage {...props} business={b} /> : null;
    case "draw":
      return can.includes(control) && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="business-draw" title="Owner's draw" subtitle={b.name} label="Amount" go="Draw it" submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(drawAction(b.id, cents)))} /> : null;
    case "distribute":
      return can.includes(control) && controls.mode === "player" ? <AmountPage nav={nav} controls={controls} name="business-distribute" title="Pay out profit" subtitle={b.name} label="Amount" go="Pay it out by share" optional="Its share of the profit since the last" submit={(cents) => controls.act(distributeAction(b.id, cents))} /> : null;
    default:
      return null;
  }
}

/** Jobs' and businesses' pages: each section, a job, a business, and each control's page. What the view no longer holds, or the mode may not do, draws nothing (gone). */
export const workPages: HubPages = {
  heads: ["jobs", "job", "businesses", "business"],
  render(page, props) {
    const [head, id, control, inner] = page.path;
    if (head === "jobs") return id === undefined ? <JobsSection {...props} /> : id === "new" && props.controls.mode === "gm" ? <NewJobPage {...props} /> : null;
    if (head === "businesses") return id === undefined ? <BusinessesSection {...props} /> : null;
    if (id === undefined) return null;
    if (head === "job") {
      const found = findJob(props.view, id);
      return found ? jobPage(control, props, found.job, found.employer) : null;
    }
    const business = head === "business" ? props.view.businesses.find((b) => b.id === id) : undefined;
    return business ? businessPage(control, inner, props, business) : null;
  },
};
