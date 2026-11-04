// An organization's Plan tab (ORG-SPEC §4.4; assess-party §6.2, for any organization but a trust;
// `r.orgTab` over its `orgs.plan` section): its open goals, each with the orders that serve it nested
// under it, then the orders that serve none, each with its status, whom it is for and who leads, where
// and by when, who set it and when, whether its time has passed, whether by the day as the planner
// laid it it should be done though nobody has said so (Should be done), and the latest word on it; then the
// latest closed ones. A reader who may give orders there (`orders.give`; the party's leader) has Add a
// goal and Give an order (to any of its people they can see), Edit, Done, Drop and Reopen, and Mark
// plan done once every order of a goal is done; anyone an order is asked of moves their own along
// (Under way, Done, Blocked, Refuse). Each is the reader's own bookkeeping (`org_goal`, `org_order`,
// `org_plan_status`: at once, with its Undo); in GM → Orgs each is the GM's edit of the effect it plays.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { OverflowMenu } from "../../../frontend/build/chrome";
import { Chip, RefPicker } from "../../../frontend/build/form-kit";
import { Badge, Button, Card, Disclosure, Empty, Field, JsonView, List, ListRow, Section, Seg, useBusy } from "../../../frontend/components";
import type { OrgGmTabProps, OrgTabDef, OrgTabProps } from "../../../frontend/registry";
import type { JsonObject } from "../../../shared/json";
import { isPlanStatusLive, PLAN_ACTIONS, PLAN_EFFECTS, PLAN_SECTION, PLAN_STATUS_WORDS, PLAN_TAB, PLAN_TEXT_MAX, type OrgPlanView, type PlanGoalView, type PlanOrderView, type PlanStatus } from "../../../shared/org-feed";
import type { OrgRef } from "../../../shared/org-view";
import type { EditOp } from "../../../shared/protocol";
import { decodePlan } from "./decode";
import { andList } from "./words";

/** Each status's chip tone. */
const STATUS_TONE: Readonly<Record<PlanStatus, "neutral" | "accent" | "pos" | "neg" | "warn">> = { open: "neutral", under_way: "accent", done: "pos", dropped: "neutral", blocked: "warn", refused: "neg" };

// ---------------------------------------------------------------- the forms' drafts

/** A goal's form as typed: its words, by when (no date, today, or a date) and where. */
export interface GoalDraft {
  kind: "goal";
  /** The goal changed; null for a new one. */
  id: string | null;
  text: string;
  by: "none" | "today" | "date";
  date: string;
  where: string;
}

/** An order's form as typed: whom it is for (those the reader can see; `hidden` counts the rest, which it can't change), who leads, the task, where, when ("" for a standing order) and the goal it serves. */
export interface OrderDraft {
  kind: "order";
  id: string | null;
  to: string[];
  hidden: number;
  lead: string;
  text: string;
  where: string;
  when: string;
  goal: string;
}

export type PlanDraft = GoalDraft | OrderDraft;

/** A goal's form, from the goal Edit changes (none: Add a goal). */
export function goalDraft(g: PlanGoalView | null): GoalDraft {
  const window = g?.edit?.window ?? "";
  return { kind: "goal", id: g?.id ?? null, text: g?.text ?? "", by: window === "" ? "none" : window === "today" ? "today" : "date", date: window === "today" ? "" : window, where: g?.edit?.where ?? "" };
}

/** An order's form, from the order Edit changes (none: Give an order, for `goal` when given from one). */
export function orderDraft(o: PlanOrderView | null, goal = ""): OrderDraft {
  const e = o?.edit;
  return { kind: "order", id: o?.id ?? null, to: e?.to ?? [], hidden: e?.hidden ?? 0, lead: e?.lead ?? "", text: o?.text ?? "", where: e?.where ?? "", when: e?.when ?? "", goal: e?.goal ?? goal };
}

/** Why a form can't be saved yet, in words; null when it can. */
export function planProblem(d: PlanDraft): string | null {
  const text = d.text.trim();
  if (text === "") return d.kind === "goal" ? "Say what the goal is." : "Say what the task is.";
  if (text.length > PLAN_TEXT_MAX) return `At most ${PLAN_TEXT_MAX} characters.`;
  if (d.kind === "goal") return d.by === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(d.date.trim()) ? "By when: a date, as YYYY-MM-DD." : null;
  if (d.to.length + d.hidden === 0) return "Choose whom it is for.";
  if (d.lead !== "" && !d.to.includes(d.lead)) return "Whoever leads is one of those it is for.";
  return d.when.trim() === "" || /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(d.when.trim()) ? null : "When: a date and time, as YYYY-MM-DD HH:MM, or nothing for a standing order.";
}

/** A change to the plan as the reader's action plays it: its id and params. */
export interface PlanChange {
  action: string;
  params: JsonObject;
}

function windowOf(d: GoalDraft): string {
  return d.by === "none" ? "" : d.by === "today" ? "today" : d.date.trim();
}

/**
 * What a saved form sends (`org_goal`, `org_order`): a new item with what it was given; an edited
 * one with only what changed from the item as `view` holds it, so the rest stays as it was. Null
 * when it changes nothing.
 */
export function planChange(org: string, d: PlanDraft, view: OrgPlanView): PlanChange | null {
  const goals = view.goals;
  const orders = [...view.orders, ...goals.flatMap((g) => g.orders)];
  if (d.kind === "goal") {
    const found = d.id === null ? undefined : goals.find((g) => g.id === d.id);
    const was = found ? goalDraft(found) : null;
    const params: JsonObject = { org, ...(d.id !== null ? { id: d.id } : {}) };
    if (!was || was.text.trim() !== d.text.trim()) params.text = d.text.trim();
    if (was ? windowOf(was) !== windowOf(d) : windowOf(d) !== "") params.window = windowOf(d);
    if (was ? was.where.trim() !== d.where.trim() : d.where.trim() !== "") params.where = d.where.trim();
    return was && Object.keys(params).length === 2 ? null : { action: PLAN_ACTIONS.goal, params };
  }
  const found = d.id === null ? undefined : orders.find((o) => o.id === d.id);
  const was = found ? orderDraft(found) : null;
  const params: JsonObject = { org, ...(d.id !== null ? { id: d.id } : {}) };
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
  if (d.hidden === 0 && (!was || !same(was.to, d.to))) params.to = d.to.join(",");
  for (const key of ["lead", "where", "when", "goal"] as const) if (was ? was[key].trim() !== d[key].trim() : d[key].trim() !== "") params[key] = d[key].trim();
  if (!was || was.text.trim() !== d.text.trim()) params.text = d.text.trim();
  return was && Object.keys(params).length === 2 ? null : { action: PLAN_ACTIONS.order, params };
}

/** A goal or an order moved along (`org_plan_status`). */
export function statusChange(org: string, id: string, status: PlanStatus): PlanChange {
  return { action: PLAN_ACTIONS.status, params: { org, id, status } };
}

const EFFECT_OF: Readonly<Record<string, string>> = { [PLAN_ACTIONS.goal]: PLAN_EFFECTS.goal, [PLAN_ACTIONS.order]: PLAN_EFFECTS.order, [PLAN_ACTIONS.status]: PLAN_EFFECTS.status };

/** The same change as GM → Orgs makes it: one edit of the effect the action plays, with no one's `by`, so it is the GM's. */
export function planOps(change: PlanChange): EditOp[] {
  const effect = EFFECT_OF[change.action];
  return effect === undefined ? [] : [{ op: "effect", effect, args: change.params }];
}

// ---------------------------------------------------------------- what each item offers

/** One control of a goal or an order: a status it moves it to, its Edit, or Give an order for a goal. */
export interface PlanControl {
  label: string;
  status?: PlanStatus;
  edit?: true;
  give?: true;
  primary?: true;
  danger?: true;
}

/** An order's controls: its own people and its giver move it along (Done first), whoever it is asked of may refuse it, and whoever gives orders edits, drops or reopens it. */
export function orderControls(o: PlanOrderView): PlanControl[] {
  const live = isPlanStatusLive(o.status);
  const out: PlanControl[] = [];
  if (live && o.mayStatus) {
    out.push({ label: "Done", status: "done", primary: true });
    if (o.status !== "under_way") out.push({ label: "Under way", status: "under_way" });
    if (o.status !== "blocked") out.push({ label: "Blocked", status: "blocked" });
  }
  if (live && o.mine) out.push({ label: "Refuse", status: "refused", danger: true });
  if (live && o.mayEdit) out.push({ label: "Edit", edit: true }, { label: "Drop", status: "dropped", danger: true });
  if (!live && o.mayEdit) out.push({ label: "Reopen", status: "open" });
  return out;
}

/** A goal's controls, for whoever gives orders: Mark plan done once its orders are all done (else Done among the rest), Give an order for it, Edit and Drop. */
export function goalControls(g: PlanGoalView): PlanControl[] {
  if (!g.mayEdit) return [];
  return [...(g.ordersDone ? [{ label: "Mark plan done", status: "done" as const, primary: true as const }] : []), { label: "Give an order for it", give: true }, { label: "Edit", edit: true }, ...(g.ordersDone ? [] : [{ label: "Done", status: "done" as const }]), { label: "Drop", status: "dropped", danger: true }];
}

// ---------------------------------------------------------------- drawing it

/** An item's controls: the first one marked primary as a button, the rest under its ⋯. */
export function PlanControls(props: { name: string; controls: readonly PlanControl[]; busy: boolean; onControl(c: PlanControl): void }) {
  const primary = props.controls.find((c) => c.primary);
  const rest = props.controls.filter((c) => c !== primary);
  if (props.controls.length === 0) return null;
  return (
    <div class="lre-inline" data-lre-plan-controls>
      {primary ? (
        <Button size="sm" variant="secondary" icon="check" disabled={props.busy} onClick={() => props.onControl(primary)}>
          {primary.label}
        </Button>
      ) : null}
      {rest.length > 0 ? <OverflowMenu label={`${props.name}: more`} disabled={props.busy} items={rest.map((c) => ({ label: c.label, ...(c.danger ? { danger: true } : {}), onSelect: () => props.onControl(c) }))} /> : null}
    </div>
  );
}

/** Whom an order is for, the lead marked: "Danny Okafor (leads), Jess and Priya". */
export function teamLine(o: PlanOrderView): string {
  return andList(o.to.map((t) => (t.id === o.lead?.id ? `${t.name} (leads)` : t.name)));
}

/** An order: its task, status, whom it is for, where and when, who set it and the latest word, with its controls. */
export function PlanOrderItem(props: { order: PlanOrderView; busy: boolean; onControl(c: PlanControl): void }) {
  const o = props.order;
  return (
    <div class="lre-stack" data-lre-plan-order={o.id}>
      <div class="lre-inline">
        <strong>{o.text}</strong>
        <Badge tone={STATUS_TONE[o.status]}>{PLAN_STATUS_WORDS[o.status]}</Badge>
        {o.late ? <Badge tone="warn">Late</Badge> : null}
        {o.lived ? <Badge tone="neutral">Should be done</Badge> : null}
        {o.mine ? <Badge tone="accent">Yours</Badge> : null}
      </div>
      <span class="lre-small">{teamLine(o)}</span>
      <span class="lre-small lre-muted">{[o.where ? `At ${o.where}` : null, o.when ? `By ${o.when}` : "Standing order"].filter((p) => p !== null).join(" · ")}</span>
      <span class="lre-small lre-muted">{o.set}</span>
      {o.last ? <span class="lre-small">{`Latest: ${o.last.note} (${o.last.at})`}</span> : null}
      <PlanControls name={o.text} controls={orderControls(o)} busy={props.busy} onControl={props.onControl} />
    </div>
  );
}

/** What the board does with a control and a form: they're the tab's to play (Play's actions, or GM → Orgs' edits). */
export interface PlanBoardProps {
  view: OrgPlanView;
  /** The form open, if any: a new goal or order, or the one being edited. */
  draft: PlanDraft | null;
  busy: boolean;
  onDraft(draft: PlanDraft | null): void;
  onSave(draft: PlanDraft): void;
  onStatus(id: string, status: PlanStatus): void;
}

/**
 * The Plan as one board: Add a goal and Give an order (for a reader who may give orders), the form
 * of a new item; each goal's card with its orders nested and the form for one given from it, an item
 * being edited drawn as its form; the orders serving no goal; and the latest closed ones, each with
 * Reopen.
 */
export function PlanBoard(props: PlanBoardProps) {
  const { view, draft, busy } = props;
  const form = (d: PlanDraft): ComponentChildren =>
    d.kind === "goal" ? (
      <PlanGoalForm draft={d} busy={busy} problem={planProblem(d)} onDraft={props.onDraft} onSave={() => props.onSave(d)} onCancel={() => props.onDraft(null)} />
    ) : (
      <PlanOrderForm draft={d} people={view.people} goals={view.goals} busy={busy} problem={planProblem(d)} onDraft={props.onDraft} onSave={() => props.onSave(d)} onCancel={() => props.onDraft(null)} />
    );
  const control =
    (item: { id: string }, edit: () => PlanDraft, give?: () => PlanDraft) =>
    (c: PlanControl): void => {
      if (c.status) props.onStatus(item.id, c.status);
      else if (c.edit) props.onDraft(edit());
      else if (c.give && give) props.onDraft(give());
    };
  const order = (o: PlanOrderView): ComponentChildren => (draft?.kind === "order" && draft.id === o.id ? <div key={o.id}>{form(draft)}</div> : <PlanOrderItem key={o.id} order={o} busy={busy} onControl={control(o, () => orderDraft(o))} />);
  const fresh = draft !== null && draft.id === null && !(draft.kind === "order" && draft.goal !== "" && view.goals.some((g) => g.id === draft.goal));
  const empty = view.goals.length === 0 && view.orders.length === 0;
  return (
    <div class="lre-stack" data-lre-org-plan>
      {view.mayGive ? (
        <div class="lre-inline" data-lre-plan-add>
          <Button size="sm" icon="flag" disabled={busy} onClick={() => props.onDraft(goalDraft(null))}>
            Add a goal
          </Button>
          <Button size="sm" icon="user-plus" disabled={busy || view.people.length === 0} onClick={() => props.onDraft(orderDraft(null))}>
            Give an order
          </Button>
        </div>
      ) : null}
      {fresh && draft ? <Section title={draft.kind === "goal" ? "A new goal" : "A new order"}>{form(draft)}</Section> : null}
      {empty && !fresh ? <Empty icon="flag">{view.mayGive ? "Nothing on the plan yet. A goal or an order you add applies at once, with Undo." : "Nothing on the plan for you."}</Empty> : null}
      {view.goals.map((g) => (
        <div key={g.id} data-lre-plan-goal={g.id}>
          {draft?.kind === "goal" && draft.id === g.id ? (
            <Section title="Edit the goal">{form(draft)}</Section>
          ) : (
            <Card
              title={g.text}
              aside={
                <span class="lre-inline">
                  <Badge tone={STATUS_TONE[g.status]}>{PLAN_STATUS_WORDS[g.status]}</Badge>
                  {g.late ? <Badge tone="warn">Late</Badge> : null}
                </span>
              }
            >
              <div class="lre-stack">
                {g.window || g.where ? <span class="lre-small">{[g.window ? `By ${g.window}` : null, g.where ? `At ${g.where}` : null].filter((p) => p !== null).join(" · ")}</span> : null}
                <span class="lre-small lre-muted">{g.set}</span>
                {g.last ? <span class="lre-small">{`Latest: ${g.last.note} (${g.last.at})`}</span> : null}
                {g.orders.map(order)}
                {draft?.kind === "order" && draft.id === null && draft.goal === g.id ? form(draft) : null}
                <PlanControls name={g.text} controls={goalControls(g)} busy={busy} onControl={control(g, () => goalDraft(g), () => orderDraft(null, g.id))} />
              </div>
            </Card>
          )}
        </div>
      ))}
      {view.orders.length > 0 ? (
        <div data-lre-plan-orders>
          <Section title={view.goals.length > 0 ? "Other orders" : "Orders"}>
            <div class="lre-stack">{view.orders.map(order)}</div>
          </Section>
        </div>
      ) : null}
      {view.recent.length > 0 ? (
        <div data-lre-plan-closed>
          <Disclosure summary={`Closed (${view.closed})`}>
            <List>
              {view.recent.map((c) => (
                <ListRow key={c.id} icon={c.kind === "goal" ? "flag" : "checklist"} title={c.text} subtitle={[PLAN_STATUS_WORDS[c.status], c.when].filter((p) => p !== null).join(" · ")} badge={view.mayGive ? <Button size="sm" variant="ghost" icon="undo" label={`Reopen ${c.text}`} disabled={busy} onClick={() => props.onStatus(c.id, "open")}>Reopen</Button> : undefined} />
              ))}
            </List>
          </Disclosure>
        </div>
      ) : null}
    </div>
  );
}

/** The form's Save and Cancel, and why it can't be saved yet. */
function FormButtons(props: { save: string; busy: boolean; problem: string | null; onSave(): void; onCancel(): void }) {
  return (
    <>
      {props.problem !== null ? <span class="lre-small lre-muted">{props.problem}</span> : null}
      <div class="lre-inline">
        <Button variant="primary" size="sm" busy={props.busy} disabled={props.problem !== null} onClick={props.onSave}>
          {props.save}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

const WINDOWS = [
  { value: "none", label: "No date" },
  { value: "today", label: "Today" },
  { value: "date", label: "By a date" },
] as const;

/** A goal's form: its words, by when and where. */
export function PlanGoalForm(props: { draft: GoalDraft; busy: boolean; problem: string | null; onDraft(d: GoalDraft): void; onSave(): void; onCancel(): void }) {
  const ids = { text: useId(), date: useId(), where: useId() };
  const d = props.draft;
  return (
    <div class="lre-stack" data-lre-plan-form="goal">
      <Field label="The goal" for={ids.text}>
        <textarea id={ids.text} class="lre-input" rows={2} maxLength={PLAN_TEXT_MAX} value={d.text} onInput={(event) => props.onDraft({ ...d, text: event.currentTarget.value })} />
      </Field>
      <Field label="By when">
        <Seg label="By when" value={d.by} options={WINDOWS} onChange={(by) => props.onDraft({ ...d, by })} />
      </Field>
      {d.by === "date" ? (
        <Field label="Date" for={ids.date}>
          <input id={ids.date} class="lre-input" placeholder="YYYY-MM-DD" value={d.date} onInput={(event) => props.onDraft({ ...d, date: event.currentTarget.value })} />
        </Field>
      ) : null}
      <Field label="Where" for={ids.where}>
        <input id={ids.where} class="lre-input" value={d.where} onInput={(event) => props.onDraft({ ...d, where: event.currentTarget.value })} />
      </Field>
      <FormButtons save={d.id === null ? "Add the goal" : "Save"} busy={props.busy} problem={props.problem} onSave={props.onSave} onCancel={props.onCancel} />
    </div>
  );
}

/** An order's form: whom it is for (its people the reader can see) and who leads, the task, where, when and the goal it serves. */
export function PlanOrderForm(props: { draft: OrderDraft; people: readonly OrgRef[]; goals: readonly PlanGoalView[]; busy: boolean; problem: string | null; onDraft(d: OrderDraft): void; onSave(): void; onCancel(): void }) {
  const ids = { text: useId(), where: useId(), when: useId() };
  const d = props.draft;
  const toggle = (id: string): void => {
    const to = d.to.includes(id) ? d.to.filter((x) => x !== id) : [...d.to, id];
    props.onDraft({ ...d, to, lead: to.includes(d.lead) ? d.lead : "" });
  };
  return (
    <div class="lre-stack" data-lre-plan-form="order">
      <Field label="For" help={d.hidden > 0 ? "It is for someone you don't know too, so who it is for stays as it is." : undefined}>
        <div class="lre-form-chips" role="group" aria-label="For">
          {props.people.map((p) => (
            <Chip key={p.id} pressed={d.to.includes(p.id)} disabled={d.hidden > 0} onToggle={() => toggle(p.id)}>
              {p.name}
            </Chip>
          ))}
        </div>
      </Field>
      {d.to.length > 1 ? (
        <Field label="Who leads">
          <RefPicker label="Who leads" value={d.lead} none="No one leads" options={props.people.filter((p) => d.to.includes(p.id)).map((p) => ({ value: p.id, label: p.name }))} onChange={(lead) => props.onDraft({ ...d, lead })} />
        </Field>
      ) : null}
      <Field label="The task" for={ids.text}>
        <textarea id={ids.text} class="lre-input" rows={2} maxLength={PLAN_TEXT_MAX} value={d.text} onInput={(event) => props.onDraft({ ...d, text: event.currentTarget.value })} />
      </Field>
      <Field label="Where" for={ids.where}>
        <input id={ids.where} class="lre-input" value={d.where} onInput={(event) => props.onDraft({ ...d, where: event.currentTarget.value })} />
      </Field>
      <Field label="When" for={ids.when} help="A date and time (YYYY-MM-DD HH:MM). Leave it empty for a standing order.">
        <input id={ids.when} class="lre-input" placeholder="YYYY-MM-DD HH:MM" value={d.when} onInput={(event) => props.onDraft({ ...d, when: event.currentTarget.value })} />
      </Field>
      {props.goals.length > 0 ? (
        <Field label="The goal it serves">
          <RefPicker label="The goal it serves" value={d.goal} none="No goal" options={props.goals.map((g) => ({ value: g.id, label: g.text }))} onChange={(goal) => props.onDraft({ ...d, goal })} />
        </Field>
      ) : null}
      <FormButtons save={d.id === null ? "Give the order" : "Save"} busy={props.busy} problem={props.problem} onSave={props.onSave} onCancel={props.onCancel} />
    </div>
  );
}

// ---------------------------------------------------------------- the tab

/** Play's Plan: each control is the reader's own bookkeeping, played at once with its Undo. */
export function OrgPlanTab(props: OrgTabProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const view = decodePlan(props.section);
  if (!view) return <JsonView value={props.section} />;
  const play = (change: PlanChange | null, done?: () => void): void => {
    if (change === null) {
      done?.();
      return;
    }
    run(async () => {
      const result = await app.request({ type: "lre.action", chatId: props.chatId, action: change.action, params: change.params, source: "palette" });
      if (result && "pending" in result && result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result) done?.();
    });
  };
  return <PlanBoard view={view} draft={draft} busy={busy} onDraft={setDraft} onSave={(d) => play(planChange(props.org.id, d, view), () => setDraft(null))} onStatus={(id, status) => play(statusChange(props.org.id, id, status))} />;
}

/** GM → Orgs' Plan: the same board, each change one GM edit of the effect it plays. */
export function GmOrgPlanTab(props: OrgGmTabProps) {
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const view = decodePlan(props.section);
  if (!view) return <JsonView value={props.section} />;
  const play = (change: PlanChange | null, done?: () => void): void => {
    if (change === null) done?.();
    else void props.gm.edit(planOps(change)).then((ok) => ok && done?.());
  };
  return <PlanBoard view={view} draft={draft} busy={props.gm.busy} onDraft={setDraft} onSave={(d) => play(planChange(props.org.id, d, view), () => setDraft(null))} onStatus={(id, status) => play(statusChange(props.org.id, id, status))} />;
}

/** The Plan tab, after People (20) and before Money (40). */
export const PLAN_TAB_DEF: OrgTabDef = { id: PLAN_TAB, label: "Plan", order: 30, section: PLAN_SECTION, component: OrgPlanTab, gm: GmOrgPlanTab };
