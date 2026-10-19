// Money → Flows (DESIGN §25): every standing transfer, bill, income and one-off that moves the
// party's money, with its schedule, what it does when the money isn't there and how it has run.
// The player creates, edits, pauses, resumes and deletes the ones they may (in-world actions),
// pays an invoice billed to them and gives notice on a lease they rent under; a flow a job, a
// lease or a loan derives is changed at its source. The GM edits any flow's fields.

import { useState } from "preact/hooks";
import { CLASS_TRAITS, FLOW_KINDS, FLOW_SHORTFALLS, type FinanceView, type Flow, type FlowView } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Card, Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AmountField, MONTH_CHOICES, NumberField, Reveal, SelectField, TextField, WEEKDAY_CHOICES, type Choice } from "./forms";
import type { HubControls, SectionProps } from "./hub";
import { flowControls, flowSources, flowTargets } from "./layout";
import { EntityFields } from "./lines";
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

/** Where a flow's money can come from and go, for the controls' mode: the player's own and the people they may pay; for the GM, the party's accounts and anyone in the world. */
function endpoints(view: FinanceView, controls: HubControls): { from: Choice[]; to: Choice[] } {
  if (controls.mode === "player") return { from: flowSources(view).map((s) => ({ value: s.id, label: s.label })), to: flowTargets(view, controls.palette).map((t) => ({ value: t.id, label: t.label })) };
  const accounts = view.accounts.filter((a) => !CLASS_TRAITS[a.class].cash).map((a) => ({ value: a.id, label: a.name }));
  const parties = controls.gm.entities.filter((e) => !e.gone && (e.kind === "person" || e.kind === "business" || e.kind === "trust" || e.kind === "household")).map((e) => ({ value: e.id, label: `${e.name} (${e.kind})` }));
  return { from: [...accounts, { value: view.party, label: `${view.name} (as their preferences choose)` }], to: [...accounts, ...parties] };
}

/** A new flow, or the change to one: the player's action, or the GM's edit. */
export function FlowFormView(props: { view: FinanceView; controls: HubControls; flow?: FlowView & { spec: Flow }; onDone(): void }) {
  const { view, controls, flow } = props;
  const ends = endpoints(view, controls);
  const [form, setForm] = useState<FlowForm>(() => (flow ? flowFormOf(flow.spec, controls.currency) : { ...blankFlowForm(ends.from[0]?.value ?? "") }));
  const [more, setMore] = useState(false);
  const typedTo = form.to !== "" && !ends.to.some((t) => t.value === form.to);
  const [otherTo, setOtherTo] = useState(typedTo);
  const set = (patch: Partial<FlowForm>) => setForm((f) => ({ ...f, ...patch }));
  const problem = flowFormProblem(form, controls.currency, flow === undefined || "fixed" in flow.spec.amount);
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
    <form
      class="lre-stack"
      data-lre-flow-form={flow?.id ?? "new"}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null) void submit().then((ok) => ok && props.onDone());
      }}
    >
      {controls.mode === "player" || !flow ? <TextField label="Name" value={form.label} onInput={(label) => set({ label })} placeholder="Rent, Savings, Allowance…" /> : null}
      <SelectField label="Kind" value={form.kind} options={FLOW_KINDS.map((k) => ({ value: k, label: humanize(k) }))} onChange={(v) => set({ kind: FLOW_KINDS.find((k) => k === v) ?? "transfer" })} />
      <SelectField label="From" value={form.from} empty="Choose" options={ends.from.some((f) => f.value === form.from) || form.from === "" ? ends.from : [...ends.from, { value: form.from, label: form.from }]} onChange={(from) => set({ from })} />
      <SelectField
        label="To"
        value={otherTo ? OTHER : form.to}
        empty="Choose"
        options={[...ends.to, { value: OTHER, label: "Someone else (type the name)" }]}
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
      <button type="button" class="lre-btn small ghost" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? "Fewer options" : "More options"}
      </button>
      {more ? (
        <div class="lre-stack">
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
        </div>
      ) : null}
      {problem ? <span class="lre-small lre-muted">{problem}</span> : null}
      <button type="submit" class="lre-btn primary" disabled={controls.busy || problem !== null}>
        {flow ? "Save" : form.every === "once" ? "Schedule it" : "Set it up"}
      </button>
    </form>
  );
}

const SHORTFALL_LABEL: Readonly<Record<(typeof FLOW_SHORTFALLS)[number], string>> = {
  skip: "Skip that time",
  partial: "Pay what there is",
  retry: "Try again later",
  fallback: "Pay from another account",
  overdraft: "Go into overdraft as the account allows",
  defer: "Carry it to the next time",
};

/** Whether a flow carries its stored form (a player's view leaves it out when a side is someone they can't see). */
function withSpec(f: FlowView): f is FlowView & { spec: Flow } {
  return f.spec !== null;
}

/** One flow: what it moves, when, how it has run, and the controls its mode allows. */
export function FlowRow(props: { view: FinanceView; flow: FlowView; controls: HubControls }) {
  const app = useApp();
  const { view, flow: f, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const sub = [`${f.from} → ${f.to}`, f.schedule, f.next ? `next ${f.next}` : null, view.detail ? SHORTFALL_LABEL[f.shortfall].toLowerCase() : null, view.detail && f.done + f.missed > 0 ? `${f.done} paid, ${f.missed} missed${f.deferred > 0 ? `, ${fmt(f.deferred)} carried` : ""}` : null, f.link ? `for ${f.link.name}` : null].filter((s) => s !== null);
  const remove = async () => {
    if (!(await app.host.confirm("Delete", `Delete ${f.label}? It won't run again.`, "danger", "Delete"))) return;
    if (controls.mode === "player") await controls.act(flowStatusAction(f.id, "delete"));
    else await controls.edit([{ op: "despawn", entity: f.id }]);
  };
  const can = flowControls(view, f);
  // An invoice flow links the invoice it pays.
  const link = f.link?.id ?? null;
  return (
    <div class="lre-stack" data-lre-flow={f.id}>
      <Row k={f.label} sub={sub.join(" · ")} v={<span class="lre-inline">{f.amount}<span class={f.status === "active" ? (f.missed > 0 ? "lre-badge warn" : "lre-badge pos") : "lre-badge"}>{humanize(f.status)}</span></span>} />
      {controls.mode === "player" ? (
        can.length > 0 ? (
          <div class="lre-inline">
            {can.includes("edit") && withSpec(f) ? <Reveal label="Edit">{(close) => <FlowFormView view={view} controls={controls} flow={f} onDone={close} />}</Reveal> : null}
            {can.includes("pause") ? <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void controls.act(flowStatusAction(f.id, "pause"))}>Pause</button> : null}
            {can.includes("resume") ? <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void controls.act(flowStatusAction(f.id, "resume"))}>Resume</button> : null}
            {can.includes("end_lease") ? (
              <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void (async () => (await app.host.confirm("End the lease", `Give notice on ${f.label}? It ends today.`, "warning", "End it")) && controls.act(leaseEndAction(f.id)))()}>
                End the lease
              </button>
            ) : null}
            {can.includes("delete") ? (
              <button type="button" class="lre-btn small danger" disabled={controls.busy} onClick={() => void remove()}>
                Delete
              </button>
            ) : null}
            {can.includes("pay_now") && link !== null ? (
              <>
                <button type="button" class="lre-btn small primary" disabled={controls.busy} onClick={() => void controls.act(invoiceAction(link, "pay"))}>
                  Pay now
                </button>
                <span class="lre-small lre-muted">Otherwise it's paid when it falls due, if the money's there.</span>
              </>
            ) : null}
          </div>
        ) : (
          <span class="lre-small lre-muted">Set by its {humanize(f.source).toLowerCase()}; change it there.</span>
        )
      ) : (
        <div class="lre-inline">
          {f.source === "entity" && withSpec(f) ? <Reveal label="Edit">{(close) => <FlowFormView view={view} controls={controls} flow={f} onDone={close} />}</Reveal> : null}
          {f.source === "entity" ? (
            <select class="lre-input" style={{ width: "auto" }} aria-label={`${f.label}: status`} value={f.status} disabled={controls.busy} onChange={(event) => void controls.edit(flowStatusOps(f.id, event.currentTarget.value === "paused" ? "paused" : event.currentTarget.value === "ended" ? "ended" : "active"))}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </select>
          ) : (
            <span class="lre-small lre-muted">Derived from its {humanize(f.source).toLowerCase()}: edit that.</span>
          )}
          {f.source === "entity" ? (
            <button type="button" class="lre-btn small danger" disabled={controls.busy} onClick={() => void remove()}>
              Delete
            </button>
          ) : null}
          {f.source === "entity" ? <Reveal label="Flow fields">{() => <EntityFields controls={controls} entity={f.id} />}</Reveal> : null}
        </div>
      )}
    </div>
  );
}

export function FlowsSection(props: SectionProps) {
  const { view, controls } = props;
  const groups = (["active", "paused", "ended"] as const).map((status) => ({ status, flows: view.flows.filter((f) => f.status === status) })).filter((g) => g.flows.length > 0);
  const canCreate = controls.mode === "gm" || (view.features.includes("flows") && flowSources(view).length > 0);
  return (
    <>
      {canCreate ? (
        <Reveal label="New standing payment or one-off" primary>
          {(close) => <FlowFormView view={view} controls={controls} onDone={close} />}
        </Reveal>
      ) : null}
      {groups.length === 0 ? <Empty>No standing payments, income or one-offs.</Empty> : null}
      {groups.map((g) => (
        <Card key={g.status} title={humanize(g.status)}>
          {g.flows.map((f) => (
            <FlowRow key={f.id} view={view} flow={f} controls={controls} />
          ))}
        </Card>
      ))}
    </>
  );
}
