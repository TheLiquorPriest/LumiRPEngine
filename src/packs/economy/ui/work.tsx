// Money → Jobs and Businesses (DESIGN §26): the party's jobs with their pay, schedule and last
// paycheck; the businesses it owns or runs with their books, sales, invoices, payroll and taxes.
// The player quits a job, and for a business they manage hires, gives raises, lets people go,
// issues and voids invoices, draws money, pays out profit and sells a stake, each an in-world
// action; the GM edits every job's, business's and invoice's declared fields.

import { useState } from "preact/hooks";
import { INVOICE_STATES, PAY_BASES, PAY_EVERY, ROLE_RIGHTS, type BusinessView, type FinanceView, type JobView } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Card, Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AmountField, NumberField, Reveal, SelectField, TextField, type Choice } from "./forms";
import type { GmControls, HubControls, PlayerControls, SectionProps } from "./hub";
import { knownPeople, workBlocks } from "./layout";
import { AmountAction, EntityFields, TxnRows } from "./lines";
import { amountOf, distributeAction, drawAction, hireAction, invoiceAction, invoiceIssueAction, jobEndAction, jobSpawnOps, newIdFor, raiseAction, routeAction, stakeSellAction, type HireForm } from "./requests";

/** People a control may name: those the POV knows for the player, anyone for the GM. */
function people(controls: HubControls): Choice[] {
  if (controls.mode === "player") return knownPeople(controls.palette).map((p) => ({ value: p.id, label: p.label }));
  return controls.gm.entities.filter((e) => !e.gone && (e.kind === "person" || e.kind === "business")).map((e) => ({ value: e.id, label: e.name }));
}

function JobCard(props: { view: FinanceView; job: JobView; controls: HubControls; employer?: BusinessView }) {
  const app = useApp();
  const { view, job: j, controls, employer } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = workBlocks(view);
  const manages = employer?.role !== null && employer?.role !== undefined && ROLE_RIGHTS[employer.role].manage;
  const end = async (words: string) => {
    if (controls.mode !== "player") return;
    if (await app.host.confirm(words, `${words}: ${j.title || "the job"} at ${j.employer}?`, "warning", words)) await controls.act(jobEndAction(j.id));
  };
  return (
    <Card title={`${j.title || humanize(j.basis)} · ${employer ? j.worker : j.employer}`} aside={<span class={j.status === "active" ? "lre-badge pos" : "lre-badge"}>{humanize(j.status)}</span>}>
      <Row k="Pay" sub={j.schedule} v={j.pay} />
      {j.nextPay ? <Row k="Next payday" v={j.nextPay} /> : null}
      {j.grossPerPeriod !== null ? <Row k="Each payday, before taxes" v={fmt(j.grossPerPeriod)} /> : null}
      {j.hours ? <Row k="Hours this period" sub={`${j.hours.scheduled} scheduled`} v={String(j.hours.attended)} /> : null}
      {j.lastPay ? <Row k={`Last paid ${j.lastPay.at}`} sub={blocks.withholding ? `${fmt(j.lastPay.gross)} gross · ${fmt(-j.lastPay.taxes)} taxes · ${fmt(-j.lastPay.deductions)} deductions` : undefined} v={fmt(j.lastPay.net)} tone="pos" /> : null}
      {blocks.deductions && j.deductions.length > 0 ? (
        <>
          <div class="lre-h">Deductions</div>
          {j.deductions.map((d) => (
            <Row key={d.label} k={d.label} v={d.value} />
          ))}
        </>
      ) : null}
      {j.splits.length > 0 ? (
        <>
          <div class="lre-h">Pay goes to</div>
          {j.splits.map((s) => (
            <Row key={s.to} k={s.to} v={s.value} />
          ))}
        </>
      ) : null}
      {controls.mode === "player" && j.status !== "ended" ? (
        <div class="lre-inline">
          {j.workerId === view.party ? (
            <button type="button" class="lre-btn small danger" disabled={controls.busy} onClick={() => void end("Quit")}>
              Quit
            </button>
          ) : null}
          {manages ? <Reveal label="Raise">{(close) => <AmountAction label={`New rate (now ${j.pay})`} go="Give the raise" currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(raiseAction(j.id, cents)))} onDone={close} />}</Reveal> : null}
          {manages ? (
            <button type="button" class="lre-btn small danger" disabled={controls.busy} onClick={() => void end("Let go")}>
              Let go
            </button>
          ) : null}
        </div>
      ) : null}
      {controls.mode === "gm" ? (
        <div class="lre-inline">
          {j.status !== "ended" ? (
            <button type="button" class="lre-btn small danger" disabled={controls.busy} onClick={() => void controls.edit([{ op: "set", entity: j.id, field: "status", value: "ended" }])}>
              End the job
            </button>
          ) : null}
          <Reveal label="Job fields">{() => <EntityFields controls={controls} entity={j.id} />}</Reveal>
        </div>
      ) : null}
    </Card>
  );
}

/** The GM's new job for the party: an employer (a business or a name), the title and the pay. */
function NewJob(props: { view: FinanceView; controls: GmControls; onDone(): void }) {
  const { view, controls } = props;
  const [employer, setEmployer] = useState("");
  const [title, setTitle] = useState("");
  const [basis, setBasis] = useState<string>("hourly");
  const [rate, setRate] = useState("");
  const [every, setEvery] = useState<string>("biweekly");
  const cents = amountOf(rate, controls.currency);
  const ok = employer.trim() !== "" && cents !== null;
  const businesses = controls.gm.entities.filter((e) => e.kind === "business" && !e.gone).map((e) => ({ value: e.id, label: e.name }));
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ok || cents === null) return;
        const name = `${title.trim() || humanize(basis)} at ${businesses.find((b) => b.value === employer)?.label ?? employer.trim()}`;
        const id = newIdFor("job", `${view.name} ${title || basis}`, new Set(controls.gm.entities.map((e) => e.id)));
        void controls.edit(jobSpawnOps(id, name, { worker: view.party, employer: employer.trim(), ...(title.trim() !== "" ? { title: title.trim() } : {}), basis, rate: cents, pay_every: every })).then((done) => done && props.onDone());
      }}
    >
      <TextField label="Employer (a business's id, or an outside employer's name)" value={employer} onInput={setEmployer} list="lre-job-employers" />
      <datalist id="lre-job-employers">
        {businesses.map((b) => (
          <option key={b.value} value={b.value} label={b.label} />
        ))}
      </datalist>
      <TextField label="Title" value={title} onInput={setTitle} />
      <SelectField label="Paid by" value={basis} options={PAY_BASES.map((b) => ({ value: b, label: humanize(b) }))} onChange={setBasis} />
      <AmountField label="Rate (a year, an hour or a shift)" value={rate} currency={controls.currency} onInput={setRate} invalid={rate.trim() !== "" && cents === null} />
      <SelectField label="Paid" value={every} options={PAY_EVERY.map((p) => ({ value: p, label: humanize(p) }))} onChange={setEvery} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || !ok}>
        Add the job
      </button>
    </form>
  );
}

export function JobsSection(props: SectionProps) {
  const { view, controls } = props;
  return (
    <>
      {controls.mode === "gm" ? <Reveal label="Add a job" primary>{(close) => <NewJob view={view} controls={controls} onDone={close} />}</Reveal> : null}
      {view.jobs.length === 0 ? <Empty>No jobs.</Empty> : view.jobs.map((j) => <JobCard key={j.id} view={view} job={j} controls={controls} />)}
    </>
  );
}

function HireFormView(props: { business: BusinessView; controls: PlayerControls; onDone(): void }) {
  const { controls } = props;
  const [form, setForm] = useState<HireForm>({ business: props.business.id, worker: "", title: "", basis: "hourly", rate: "", hoursPerWeek: null, payEvery: "biweekly" });
  const body = hireAction(form, controls.currency);
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (body) void controls.act(body).then((ok) => ok && props.onDone());
      }}
    >
      <SelectField label="Who" value={form.worker} empty="Choose someone" options={people(controls)} onChange={(worker) => setForm({ ...form, worker })} />
      <TextField label="Title" value={form.title} onInput={(title) => setForm({ ...form, title })} />
      <SelectField label="Paid by" value={form.basis} options={PAY_BASES.map((b) => ({ value: b, label: humanize(b) }))} onChange={(basis) => setForm({ ...form, basis })} />
      <AmountField label="Rate (a year, an hour or a shift)" value={form.rate} currency={controls.currency} onInput={(rate) => setForm({ ...form, rate })} invalid={form.rate.trim() !== "" && amountOf(form.rate, controls.currency) === null} />
      <NumberField label="Hours a week" value={form.hoursPerWeek} min={0} onChange={(hoursPerWeek) => setForm({ ...form, hoursPerWeek })} />
      <SelectField label="Paid" value={form.payEvery} options={PAY_EVERY.map((p) => ({ value: p, label: humanize(p) }))} onChange={(payEvery) => setForm({ ...form, payEvery })} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || body === null}>
        Hire
      </button>
    </form>
  );
}

function InvoiceForm(props: { business: BusinessView; controls: PlayerControls; onDone(): void }) {
  const { controls } = props;
  const [customer, setCustomer] = useState("");
  const [outside, setOutside] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const cents = amountOf(amount, controls.currency);
  const OUTSIDE = "__outside";
  const who = customer === OUTSIDE ? (outside.trim() !== "" ? { name: outside } : null) : customer !== "" ? { id: customer } : null;
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (who && cents !== null) void controls.act(invoiceIssueAction(props.business.id, who, cents, memo, days)).then((ok) => ok && props.onDone());
      }}
    >
      <SelectField label="To" value={customer} empty="Choose a customer" options={[...people(controls), { value: OUTSIDE, label: "Someone else (type the name)" }]} onChange={setCustomer} />
      {customer === OUTSIDE ? <TextField label="Customer's name" value={outside} onInput={setOutside} /> : null}
      <AmountField label="Amount" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} />
      <TextField label="For" value={memo} onInput={setMemo} placeholder="Brake job" />
      <NumberField label="Due in (days; empty: the business's terms)" value={days} min={0} onChange={setDays} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || who === null || cents === null}>
        Issue the invoice
      </button>
    </form>
  );
}

function StakeForm(props: { business: BusinessView; controls: PlayerControls; onDone(): void }) {
  const { controls } = props;
  const [share, setShare] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [buyer, setBuyer] = useState("");
  const cents = amountOf(price, controls.currency);
  const ok = share !== null && share > 0 && share <= 100 && cents !== null;
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && share !== null && cents !== null) void controls.act(stakeSellAction(props.business.id, share, cents, buyer || undefined)).then((done) => done && props.onDone());
      }}
    >
      <NumberField label="Share to sell (%)" value={share} min={0} max={100} onChange={setShare} />
      <AmountField label="Price" value={price} currency={controls.currency} onInput={setPrice} invalid={price.trim() !== "" && cents === null} />
      <SelectField label="Buyer" value={buyer} empty="Whoever buys" options={people(controls)} onChange={setBuyer} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || !ok}>
        Sell the stake
      </button>
    </form>
  );
}

function BusinessCard(props: { view: FinanceView; business: BusinessView; controls: HubControls }) {
  const app = useApp();
  const { view, business: b, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = workBlocks(view);
  const rights = b.role ? ROLE_RIGHTS[b.role] : null;
  const manages = rights?.manage === true;
  const accountName = (id: string): string => view.accounts.find((a) => a.id === id)?.name ?? (controls.mode === "gm" ? (controls.gm.entities.find((e) => e.id === id)?.name ?? id) : id);
  return (
    <Card title={`🏪 ${b.name}`} aside={b.role ? <span class="lre-badge">{humanize(b.role)}</span> : null}>
      {b.owners.map((o) => (
        <Row key={o.party} k={o.name} sub={humanize(o.role)} v={o.share > 0 ? `${Math.round(o.share * 10) / 10}%` : undefined} />
      ))}
      {b.places.length > 0 ? <Row k="Trades at" v={b.places.map((p) => p.name).join(", ")} /> : null}
      {b.accounts.length > 0 ? <Row k="Accounts" v={b.accounts.map(accountName).join(", ")} /> : null}
      <div class="lre-h">Books · {b.books.period}</div>
      <Row k="Revenue" v={fmt(b.books.revenue)} tone="pos" />
      <Row k="Expenses" v={fmt(-Math.abs(b.books.expenses))} tone="neg" />
      <Row k="Payroll" v={fmt(-Math.abs(b.books.payroll))} tone="neg" />
      {blocks.taxes ? <Row k="Taxes" v={fmt(-Math.abs(b.books.taxes))} tone="neg" /> : null}
      <Row k="Profit" v={fmt(b.books.profit)} tone={b.books.profit < 0 ? "neg" : "pos"} />
      {blocks.books
        ? b.books.lines.map((l) => (
            <Row key={l.category} k={humanize(l.category)} v={fmt(l.cents)} tone={l.cents < 0 ? "neg" : "pos"} />
          ))
        : null}
      {blocks.sales && b.sales.length > 0 ? (
        <>
          <div class="lre-h">Sales</div>
          <TxnRows lines={b.sales} max={10} currency={controls.currency} />
        </>
      ) : null}
      <div class="lre-h">Invoices</div>
      {b.invoices.length === 0 ? <Empty>No invoices.</Empty> : null}
      {b.invoices.map((i) => (
        <Row
          key={i.id}
          k={`${i.customerName}: ${i.memo || "invoice"}`}
          sub={[`issued ${i.issuedAt}`, `due ${i.dueAt}`, i.days_late ? `${i.days_late} days late` : null, i.late_fee ? `late fee ${fmt(i.late_fee)}` : null].filter((s) => s !== null).join(" · ")}
          v={
            <span class="lre-inline">
              {fmt(i.cents)}
              {controls.mode === "gm" ? (
                <select class="lre-input" style={{ width: "auto" }} aria-label={`Invoice to ${i.customerName}: state`} value={i.state} disabled={controls.busy} onChange={(event) => void controls.edit([{ op: "set", entity: i.id, field: "state", value: event.currentTarget.value }])}>
                  {INVOICE_STATES.map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </select>
              ) : (
                <span class={i.state === "late" ? "lre-badge neg" : i.state === "paid" ? "lre-badge pos" : "lre-badge"}>{i.state}</span>
              )}
              {controls.mode === "player" && manages && (i.state === "open" || i.state === "late") ? (
                <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void (async () => (await app.host.confirm("Void", `Void the invoice to ${i.customerName}?`, "warning", "Void")) && controls.act(invoiceAction(i.id, "void")))()}>
                  Void
                </button>
              ) : null}
              {controls.mode === "player" && i.customer === view.party && (i.state === "open" || i.state === "late") ? (
                <button type="button" class="lre-btn small primary" disabled={controls.busy} onClick={() => void controls.act(invoiceAction(i.id, "pay"))}>
                  Pay
                </button>
              ) : null}
            </span>
          }
        />
      ))}
      <div class="lre-h">Payroll</div>
      {b.employees.length === 0 ? <Empty>No one on the payroll.</Empty> : null}
      {b.employees.map((j) => (
        <JobCard key={j.id} view={view} job={j} controls={controls} employer={b} />
      ))}
      {blocks.taxes && b.taxes.length > 0 ? (
        <>
          <div class="lre-h">Taxes</div>
          {b.taxes.map((t) => (
            <Row key={t.label} k={t.label} sub={t.due ? `due ${t.due}` : undefined} v={fmt(t.cents)} />
          ))}
        </>
      ) : null}
      {controls.mode === "player" ? (
        <div class="lre-inline" data-lre-business-controls={b.id}>
          {manages ? <Reveal label="Hire">{(close) => <HireFormView business={b} controls={controls} onDone={close} />}</Reveal> : null}
          {manages ? <Reveal label="Issue an invoice">{(close) => <InvoiceForm business={b} controls={controls} onDone={close} />}</Reveal> : null}
          {manages ? <Reveal label="Owner's draw">{(close) => <AmountAction label="Amount" go="Draw it" currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(drawAction(b.id, cents)))} onDone={close} />}</Reveal> : null}
          {manages ? <Reveal label="Pay out profit">{(close) => <AmountAction label="Amount" go="Pay it out by share" optional="Its share of the profit since the last" currency={controls.currency} busy={controls.busy} submit={(cents) => controls.act(distributeAction(b.id, cents))} onDone={close} />}</Reveal> : null}
          {rights?.worth ? <Reveal label="Sell a stake">{(close) => <StakeForm business={b} controls={controls} onDone={close} />}</Reveal> : null}
          {rights?.worth ? (
            <Reveal label="Where your profit goes">
              {(close) => (
                <SelectField
                  label="Your share of its profit goes to"
                  value=""
                  empty="Choose"
                  options={[{ value: " ", label: "Your usual deposit account" }, ...view.accounts.filter((a) => a.role !== null && ROLE_RIGHTS[a.role].sees).map((a) => ({ value: a.id, label: a.name }))]}
                  onChange={(to) => to !== "" && void controls.act(routeAction({ business: b.id }, to.trim())).then((ok) => ok && close())}
                />
              )}
            </Reveal>
          ) : null}
        </div>
      ) : (
        <Reveal label="Business fields">{() => <EntityFields controls={controls} entity={b.id} />}</Reveal>
      )}
    </Card>
  );
}

export function BusinessesSection(props: SectionProps) {
  const { view, controls } = props;
  return view.businesses.length === 0 ? <Empty>No businesses.</Empty> : <>{view.businesses.map((b) => <BusinessCard key={b.id} view={view} business={b} controls={controls} />)}</>;
}
