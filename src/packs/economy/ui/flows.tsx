// Money → Flows (DESIGN §25): every standing transfer, bill, income and one-off that moves the
// party's money, with its schedule, what it does when the money isn't there and how it has run.
// The section lists them by status, each opens its own page, and every control there opens a page
// of its own with one button that returns to the flow when it's done. The player creates,
// edits, pauses, resumes and deletes the ones they may (in-world actions), pays an invoice billed
// to them and gives notice on a lease they rent under; a flow a job, a lease or a loan derives is
// changed at its source. The GM edits any flow's fields and status.

import { useState } from "preact/hooks";
import { CLASS_TRAITS, FLOW_KINDS, FLOW_SHORTFALLS, FLOW_STATUSES, type FinanceView, type FlowStatus, type FlowView } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { Badge, Button, Disclosure, Empty, IdText, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { ActionPage, AmountField, ChoiceField, MONTH_CHOICES, NumberField, SelectField, TextField, WEEKDAY_CHOICES, type Choice } from "./forms";
import type { HubControls, SectionProps } from "./hub";
import { flowControls, flowSources, flowTargets, type FlowControl } from "./layout";
import { FieldsPage } from "./lines";
import { actionPage, Controls, detailPage, Hero, MoneyPage, Note, type HubNav, type HubPages } from "./nav";
import { amountOf, blankFlowForm, flowCreateAction, flowEditOps, flowFormOf, flowFormProblem, flowSpawnOps, flowStatusAction, flowStatusOps, flowUpdateAction, invoiceAction, leaseEndAction, newIdFor, type FlowEvery, type FlowForm } from "./requests";

const EVERY: readonly Choice[] = [
  { value: "once", label: "Once" },
  { value: "day", label: "Every day" },
  { value: "week", label: "Every week" },
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
];

const DAYS: readonly Choice[] = [...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })), { value: "-1", label: "The last day" }];

const OTHER = "__other";

const SHORTFALL_LABEL: Readonly<Record<(typeof FLOW_SHORTFALLS)[number], string>> = {
  skip: "Skip that time",
  partial: "Pay what there is",
  retry: "Try again later",
  fallback: "Pay from another account",
  overdraft: "Go into overdraft as the account allows",
  defer: "Carry it to the next time",
};

/** Every flow the view carries: the party's own, a property's running costs and a household's shared costs. */
function findFlow(view: FinanceView, id: string): FlowView | null {
  return view.flows.find((f) => f.id === id) ?? view.properties.flatMap((p) => p.costs).find((f) => f.id === id) ?? view.household?.flows.find((f) => f.id === id) ?? null;
}

/** Whether the controls' mode may set up a new flow: the GM always, the player where flows run and an account can pay one. */
function canCreate(view: FinanceView, controls: HubControls): boolean {
  return controls.mode === "gm" || (view.features.includes("flows") && flowSources(view).length > 0);
}

/** Where a flow's money can come from and go, for the controls' mode: the player's own and the people they may pay; for the GM, the party's accounts and anyone in the world. */
function endpoints(view: FinanceView, controls: HubControls): { from: Choice[]; to: Choice[] } {
  if (controls.mode === "player") return { from: flowSources(view).map((s) => ({ value: s.id, label: s.label })), to: flowTargets(view, controls.palette).map((t) => ({ value: t.id, label: t.label })) };
  const accounts = view.accounts.filter((a) => !CLASS_TRAITS[a.class].cash).map((a) => ({ value: a.id, label: a.name }));
  const parties = controls.gm.entities.filter((e) => !e.gone && (e.kind === "person" || e.kind === "business" || e.kind === "trust" || e.kind === "household")).map((e) => ({ value: e.id, label: `${e.name} (${e.kind})` }));
  return { from: [...accounts, { value: view.party, label: `${view.name} (as their preferences choose)` }], to: [...accounts, ...parties] };
}

/** A flow as a row: its name, from where to where and when, its amount and any trouble; it opens the flow's page. */
export function FlowListRow(props: { flow: FlowView; nav: HubNav }) {
  const f = props.flow;
  return (
    <ListRow
      title={f.label}
      subtitle={[`${f.from} → ${f.to}`, f.schedule, f.next ? `next ${f.next}` : null].filter((s) => s !== null).join(" · ")}
      id={f.id}
      value={f.amount}
      badge={f.status !== "active" ? <Badge>{humanize(f.status)}</Badge> : f.missed > 0 ? <Badge tone="warn">Missed</Badge> : undefined}
      chevron
      onClick={() => props.nav.open(detailPage("flow", f.id))}
    />
  );
}

function FlowsSection(props: SectionProps) {
  const { view, controls, nav } = props;
  const groups = FLOW_STATUSES.map((status) => ({ status, flows: view.flows.filter((f) => f.status === status) })).filter((g) => g.flows.length > 0);
  return (
    <MoneyPage nav={nav} name="flows" title="Flows">
      {canCreate(view, controls) ? (
        <Button variant="primary" icon="plus" block onClick={() => nav.open(actionPage("flows", "new"))}>
          New standing payment or one-off
        </Button>
      ) : null}
      {groups.length === 0 ? <Empty icon="refresh">No standing payments, income or one-offs.</Empty> : null}
      {groups.map((g) => (
        <Section key={g.status} title={humanize(g.status)} flush>
          <List>
            {g.flows.map((f) => (
              <FlowListRow key={f.id} flow={f} nav={nav} />
            ))}
          </List>
        </Section>
      ))}
    </MoneyPage>
  );
}

/** What each of the player's flow controls is called, on its button and its page, and its icon. */
const CONTROL: Readonly<Record<FlowControl, { label: string; icon: IconName }>> = {
  edit: { label: "Edit", icon: "edit" },
  pause: { label: "Pause", icon: "pause" },
  resume: { label: "Resume", icon: "play" },
  end_lease: { label: "End the lease", icon: "key" },
  delete: { label: "Delete", icon: "trash" },
  pay_now: { label: "Pay now", icon: "check" },
};

/** One flow: what it moves, when, how it has run, and the controls its mode allows. */
function FlowPage(props: SectionProps & { flow: FlowView }) {
  const { view, controls, nav, flow: f } = props;
  const runs = view.detail && f.done + f.missed > 0 ? `${f.done} paid, ${f.missed} missed${f.deferred > 0 ? `, ${formatMoney(f.deferred, controls.currency)} carried` : ""}` : null;
  const can = controls.mode === "player" ? flowControls(view, f) : [];
  return (
    <MoneyPage nav={nav} name="flow" title={f.label} subtitle={humanize(f.kind).toLowerCase() === f.label.toLowerCase() ? undefined : humanize(f.kind)}>
      <IdText id={f.id} />
      {/* A fixed amount leads as a figure; one worked out each time ("the minimum due") reads as words, at a size words read well at. */}
      <Hero label="Amount" value={"fixed" in f.spec.amount ? f.amount : <span class="lre-money-hero-words">{f.amount}</span>} sub={f.schedule} badges={<Badge tone={f.status !== "active" ? "neutral" : f.missed > 0 ? "warn" : "pos"}>{f.status === "active" && f.missed > 0 ? "Active · missed" : humanize(f.status)}</Badge>} />
      {controls.mode === "player" ? (
        can.length > 0 ? (
          <Controls name={f.id}>
            {can.map((c) => (
              <Button key={c} variant={c === "pay_now" ? "primary" : c === "delete" ? "danger" : "secondary"} icon={CONTROL[c].icon} onClick={() => nav.open(actionPage("flow", f.id, c))}>
                {CONTROL[c].label}
              </Button>
            ))}
          </Controls>
        ) : (
          <Note>Set by its {humanize(f.source).toLowerCase()}; change it there.</Note>
        )
      ) : f.source === "entity" ? (
        <Controls name={f.id}>
          <Button icon="edit" onClick={() => nav.open(actionPage("flow", f.id, "edit"))}>
            Edit
          </Button>
          <Button icon="sliders" onClick={() => nav.open(actionPage("flow", f.id, "status"))}>
            Status
          </Button>
          <Button icon="list" onClick={() => nav.open(actionPage("flow", f.id, "fields"))}>
            Flow fields
          </Button>
          <Button variant="danger" icon="trash" onClick={() => nav.open(actionPage("flow", f.id, "delete"))}>
            Delete
          </Button>
        </Controls>
      ) : (
        <Note>Derived from its {humanize(f.source).toLowerCase()}: edit that.</Note>
      )}
      <Section flush>
        <List>
          <ListRow icon="wallet" title="From" value={f.from} />
          <ListRow icon="send" title="To" value={f.to} />
          {f.next ? <ListRow icon="calendar" title="Next" value={f.next} /> : null}
          {view.detail ? <ListRow icon="alert" title="When the money isn't there" value={SHORTFALL_LABEL[f.shortfall]} /> : null}
          {runs !== null ? <ListRow icon="checklist" title="So far" value={runs} valueTone={f.missed > 0 ? "warn" : undefined} /> : null}
          {f.link ? <ListRow icon="link" title="For" value={f.link.name} /> : null}
        </List>
      </Section>
    </MoneyPage>
  );
}

/** A new flow, or the change to one: the player's action, or the GM's edit. */
function FlowFormPage(props: SectionProps & { flow?: FlowView }) {
  const { view, controls, nav, flow } = props;
  const ends = endpoints(view, controls);
  // A flow's own payer and payee stay choices when the lists don't hold them (an account the player
  // can't pay from, someone the POV's palette doesn't name, a party of a kind the GM's list leaves
  // out), under the names the view gives them, never their ids. A payee whose name is the stored
  // value itself is someone outside the world, typed.
  const fromChoices = flow && !ends.from.some((f) => f.value === flow.spec.from) ? [...ends.from, { value: flow.spec.from, label: flow.from }] : ends.from;
  const toChoices = flow && flow.to !== flow.spec.to && !ends.to.some((t) => t.value === flow.spec.to) ? [...ends.to, { value: flow.spec.to, label: flow.to }] : ends.to;
  const [form, setForm] = useState<FlowForm>(() => (flow ? flowFormOf(flow.spec, controls.currency) : { ...blankFlowForm(ends.from[0]?.value ?? "") }));
  const typedTo = form.to !== "" && !toChoices.some((t) => t.value === form.to);
  const [otherTo, setOtherTo] = useState(typedTo);
  const set = (patch: Partial<FlowForm>) => setForm((f) => ({ ...f, ...patch }));
  const submit = async (): Promise<boolean> => {
    if (controls.mode === "player") {
      if (!flow) return controls.act(flowCreateAction(form, controls.currency));
      const update = flowUpdateAction(flow.spec, form, controls.currency);
      return update === null || controls.act(update);
    }
    if (!flow) return controls.edit(flowSpawnOps(newIdFor("flow", form.label, new Set(controls.gm.entities.map((e) => e.id))), form, controls.currency));
    const ops = flowEditOps(flow.spec, form, controls.currency);
    return ops.length === 0 || controls.edit(ops);
  };
  return (
    <ActionPage
      nav={nav}
      controls={controls}
      name={flow ? "flow-edit" : "flow-new"}
      title={flow ? "Edit" : "New standing payment or one-off"}
      subtitle={flow?.label}
      go={flow ? "Save" : form.every === "once" ? "Schedule it" : "Set it up"}
      problem={flowFormProblem(form, controls.currency, flow === undefined || "fixed" in flow.spec.amount)}
      submit={submit}
    >
      {controls.mode === "player" || !flow ? <TextField label="Name" value={form.label} onInput={(label) => set({ label })} placeholder="Rent, Savings, Allowance…" /> : null}
      <SelectField label="Kind" value={form.kind} options={FLOW_KINDS.map((k) => ({ value: k, label: humanize(k) }))} onChange={(v) => set({ kind: FLOW_KINDS.find((k) => k === v) ?? "transfer" })} />
      <SelectField label="From" value={form.from} empty="Choose" options={fromChoices} onChange={(from) => set({ from })} />
      <SelectField
        label="To"
        value={otherTo ? OTHER : form.to}
        empty="Choose"
        options={[...toChoices, { value: OTHER, label: "Someone else (type the name)" }]}
        onChange={(v) => {
          setOtherTo(v === OTHER);
          set({ to: v === OTHER ? "" : v });
        }}
      />
      {otherTo ? <TextField label="Paid to (a name outside the world)" value={form.to} onInput={(to) => set({ to })} placeholder="Harbor Mutual" /> : null}
      <AmountField label={flow && !("fixed" in flow.spec.amount) ? `Amount (empty keeps ${flow.amount})` : "Amount"} value={form.amount} currency={controls.currency} onInput={(amount) => set({ amount })} invalid={form.amount.trim() !== "" && amountOf(form.amount, controls.currency) === null} />
      <SelectField label="When" value={form.every} options={EVERY} onChange={(v) => set({ every: (EVERY.find((e) => e.value === v)?.value ?? "month") as FlowEvery })} />
      {form.every === "week" ? <SelectField label="On" value={form.weekday === null ? "" : String(form.weekday)} empty="Choose a weekday" options={WEEKDAY_CHOICES} onChange={(v) => set({ weekday: v === "" ? null : Number(v) })} /> : null}
      {form.every === "year" ? <SelectField label="Month" value={form.month === null ? "" : String(form.month)} empty="Choose a month" options={MONTH_CHOICES} onChange={(v) => set({ month: v === "" ? null : Number(v) })} /> : null}
      {form.every === "month" || form.every === "year" ? <SelectField label="Day of the month" value={form.day === null ? "" : String(form.day)} empty="The day it starts" options={DAYS} onChange={(v) => set({ day: v === "" ? null : Number(v) })} /> : null}
      <TextField label={form.every === "once" ? "On" : "Starts"} type="date" value={form.start} onInput={(start) => set({ start })} />
      {form.every === "once" ? <TextField label="At (time of day)" type="time" value={form.at} onInput={(at) => set({ at })} /> : null}
      <Disclosure summary="More options">
        {form.every !== "once" ? (
          <>
            <NumberField label="Every Nth time (2 with weekly is every other week)" value={form.interval} min={1} onChange={(n) => set({ interval: n ?? 1 })} />
            <TextField label="At (time of day)" type="time" value={form.at} onInput={(at) => set({ at })} />
            <TextField label="Ends" type="date" value={form.end} onInput={(end) => set({ end })} />
            <NumberField label="At most this many times" value={form.count} min={1} onChange={(count) => set({ count })} />
            <SelectField label="A due day off a business day" value={form.roll} empty="As the engine does" options={[{ value: "none", label: "Stays" }, { value: "before", label: "Moves to the business day before" }, { value: "after", label: "Moves to the business day after" }]} onChange={(v) => set({ roll: v === "none" || v === "before" || v === "after" ? v : "" })} />
          </>
        ) : null}
        <SelectField label="When the money isn't there" value={form.shortfall} options={FLOW_SHORTFALLS.map((s) => ({ value: s, label: SHORTFALL_LABEL[s] }))} onChange={(v) => set({ shortfall: FLOW_SHORTFALLS.find((s) => s === v) ?? "skip" })} />
        {form.shortfall === "retry" ? (
          <>
            <NumberField label="Try again after (days)" value={form.retryDays} min={1} onChange={(retryDays) => set({ retryDays })} />
            <NumberField label="Tries at most" value={form.retries} min={1} onChange={(retries) => set({ retries })} />
          </>
        ) : null}
        {form.shortfall === "fallback" ? <SelectField label="Then pay from" value={form.fallback} empty="Choose an account" options={ends.from.filter((f) => f.value !== form.from)} onChange={(fallback) => set({ fallback })} /> : null}
        <TextField label="Category (for the books)" value={form.category} onInput={(category) => set({ category })} placeholder="housing, utilities, savings…" />
      </Disclosure>
    </ActionPage>
  );
}

/** A flow as the one line an action page acts on. */
function FlowLine(props: { flow: FlowView }) {
  const f = props.flow;
  return (
    <Section flush>
      <List>
        <ListRow title={f.label} subtitle={`${f.from} → ${f.to} · ${f.schedule}`} value={f.amount} />
      </List>
    </Section>
  );
}

/**
 * One of the player's one-tap controls on a flow (pause, resume, give notice, delete, pay an
 * invoice now) as its own page: what it acts on, what happens, and the button. The page stands in
 * for the confirmation the destructive ones asked for. The GM's delete is the same page as an edit.
 */
function FlowControlPage(props: SectionProps & { flow: FlowView; control: Exclude<FlowControl, "edit"> }) {
  const { controls, nav, flow: f, control } = props;
  const link = f.link?.id ?? null;
  let page: { text: string; go: string; danger: boolean; submit(): Promise<boolean> } | null = null;
  if (controls.mode === "gm") {
    if (control === "delete") page = { text: `Delete ${f.label}? It won't run again.`, go: "Delete", danger: true, submit: () => controls.edit([{ op: "despawn", entity: f.id }]) };
  } else if (control === "pause") page = { text: "It won't run until you resume it.", go: "Pause", danger: false, submit: () => controls.act(flowStatusAction(f.id, "pause")) };
  else if (control === "resume") page = { text: "It runs again on its schedule.", go: "Resume", danger: false, submit: () => controls.act(flowStatusAction(f.id, "resume")) };
  else if (control === "end_lease") page = { text: `Give notice on ${f.label}? It ends today.`, go: "End it", danger: true, submit: () => controls.act(leaseEndAction(f.id)) };
  else if (control === "delete") page = { text: `Delete ${f.label}? It won't run again.`, go: "Delete", danger: true, submit: () => controls.act(flowStatusAction(f.id, "delete")) };
  else if (link !== null) page = { text: "Otherwise it's paid when it falls due, if the money's there.", go: "Pay now", danger: false, submit: () => controls.act(invoiceAction(link, "pay")) };
  if (page === null) return null;
  return (
    <ActionPage nav={nav} controls={controls} name={`flow-${control}`} title={CONTROL[control].label} subtitle={f.label} go={page.go} danger={page.danger} submit={page.submit}>
      <FlowLine flow={f} />
      <Note>{page.text}</Note>
    </ActionPage>
  );
}

const STATUS_DETAIL: Readonly<Record<FlowStatus, string>> = { active: "It runs on its schedule.", paused: "It waits until it's set active again.", ended: "It won't run again." };

/** The GM's status for a flow stored as its own entity: active, paused or ended, one edit. */
function FlowStatusPage(props: SectionProps & { flow: FlowView }) {
  const { controls, nav, flow: f } = props;
  const [status, setStatus] = useState<FlowStatus>(f.status);
  if (controls.mode !== "gm") return null;
  return (
    <ActionPage nav={nav} controls={controls} name="flow-status" title="Status" subtitle={f.label} go="Save" disabled={status === f.status} submit={() => controls.edit(flowStatusOps(f.id, status))}>
      <FlowLine flow={f} />
      <ChoiceField label="Status" value={status} options={FLOW_STATUSES.map((s) => ({ value: s, label: humanize(s), detail: STATUS_DETAIL[s] }))} onChange={(v) => setStatus(FLOW_STATUSES.find((s) => s === v) ?? f.status)} />
    </ActionPage>
  );
}

/** Flows' pages: the section, a new flow, each flow, and each control's page. A control the view no longer allows draws nothing (gone). */
export const flowPages: HubPages = {
  heads: ["flows", "flow"],
  render(page, props) {
    const { view, controls } = props;
    const [head, id, control] = page.path;
    if (head === "flows") return id === undefined ? <FlowsSection {...props} /> : id === "new" && canCreate(view, controls) ? <FlowFormPage {...props} /> : null;
    const flow = id === undefined ? null : findFlow(view, id);
    if (head !== "flow" || flow === null) return null;
    // The GM changes only a flow stored as its own entity; a derived one changes at its source.
    const gm = controls.mode === "gm" && flow.source === "entity";
    switch (control) {
      case undefined:
        return <FlowPage {...props} flow={flow} />;
      case "fields":
        return gm ? <FieldsPage nav={props.nav} controls={controls} name="flow-fields" title="Flow fields" subtitle={flow.label} entity={flow.id} /> : null;
      case "status":
        return gm ? <FlowStatusPage {...props} flow={flow} /> : null;
      case "edit":
        return gm || (controls.mode === "player" && flowControls(view, flow).includes("edit")) ? <FlowFormPage {...props} flow={flow} /> : null;
      case "delete":
        return gm || (controls.mode === "player" && flowControls(view, flow).includes("delete")) ? <FlowControlPage {...props} flow={flow} control="delete" /> : null;
      case "pause":
      case "resume":
      case "end_lease":
      case "pay_now":
        return controls.mode === "player" && flowControls(view, flow).includes(control) ? <FlowControlPage {...props} flow={flow} control={control} /> : null;
      default:
        return null;
    }
  },
};
