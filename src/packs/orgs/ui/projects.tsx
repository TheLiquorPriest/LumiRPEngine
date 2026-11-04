// An organization's Projects tab (DESIGN §26.5; `r.orgTab` over the economy's `projects` section,
// mounted by the orgs UI): its production projects, each with where it stands (the step under way
// and its day, or a step waiting for money), its progress, what it has paid and has left to pay, and
// its steps, each with its length, cost and when it's paid, what it waits on, its inputs and crew,
// what it unlocks and the setbacks the story noted; then the ones done or dropped; then Start a
// project from one of the world's templates. Play plays each control as the reader's own act, at
// once and off screen with its Undo (told under "business"); GM → Orgs makes each the GM's edit of
// the effect it plays, and can set a step back or add to its cost. Build lists the organization's
// authored projects, adds one from a template and removes one (its steps edit in the project's own
// page). Nothing here marks a step done: only its time does.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { OverflowMenu } from "../../../frontend/build/chrome";
import { RefPicker } from "../../../frontend/build/form-kit";
import { Badge, Button, Card, Disclosure, Empty, Field, JsonView, List, ListRow, Meter, Section, useBusy } from "../../../frontend/components";
import { MoneyInput } from "../../../frontend/money-input";
import { toastQueued } from "../../../frontend/queued";
import type { OrgGmTabProps, OrgTabDef, OrgTabProps } from "../../../frontend/registry";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { pointerOf } from "../../../shared/json-patch";
import { parseMoneyInput } from "../../../shared/money";
import { COST_WHEN_WORDS, PROJECT_ACTIONS, PROJECT_EFFECTS, PROJECT_KIND, PROJECT_LIMITS, PROJECT_STATUS_WORDS, PROJECTS_SECTION, projectsViewIn, stepCost, stepsIn, STEP_STATE_WORDS, type ProjectStatus, type ProjectTemplateView, type ProjectView, type ProjectsView, type StepState, type StepView } from "../../../shared/projects";
import type { EditOp, JsonPatchOp } from "../../../shared/protocol";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency, type WorldDoc } from "../../../shared/world";

export const PROJECTS_TAB = "economy.projects";

const STATUS_TONE: Readonly<Record<ProjectStatus, "neutral" | "accent" | "pos" | "warn">> = { planned: "neutral", active: "accent", paused: "warn", done: "pos", dropped: "neutral" };
const STATE_TONE: Readonly<Record<StepState, "neutral" | "accent" | "pos" | "warn">> = { pending: "neutral", ready: "neutral", waiting: "warn", running: "accent", paused: "warn", done: "pos" };

// ---------------------------------------------------------------- what the controls send

type Act = "start" | "pause" | "resume" | "drop";

/** One control on a project: what it does, and its words. */
export interface ProjectControl {
  act: Act;
  label: string;
  danger?: true;
}

/** A project's controls, as the reader may use them: Start a planned one, Pause, Resume, and Drop under its ⋯. */
export function projectControls(p: ProjectView): ProjectControl[] {
  const out: ProjectControl[] = [];
  if (p.can.start) out.push({ act: "start", label: "Start" });
  if (p.can.pause) out.push({ act: "pause", label: "Pause" });
  if (p.can.resume) out.push({ act: "resume", label: "Resume" });
  if (p.can.drop) out.push({ act: "drop", label: "Drop", danger: true });
  return out;
}

/** A change as the reader's action plays it: its id and params. */
export interface ProjectChange {
  action: string;
  params: JsonObject;
}

/** What a control sends: the project's own action, for the organization it is on. */
export function controlChange(org: string, p: ProjectView, act: Act): ProjectChange {
  return { action: PROJECT_ACTIONS[act], params: act === "start" ? { org, project: p.id } : { project: p.id } };
}

/** Start a project's form as typed: the template, a name (the template's when empty) and the account it pays from ("" for its operating account). */
export interface StartDraft {
  template: string;
  name: string;
  account: string;
}

/** What Start sends (`project_start`); null until a template is chosen. */
export function startChange(org: string, d: StartDraft): ProjectChange | null {
  if (d.template === "") return null;
  return { action: PROJECT_ACTIONS.start, params: { org, template: d.template, ...(d.name.trim() !== "" ? { name: d.name.trim().slice(0, PROJECT_LIMITS.name) } : {}), ...(d.account !== "" ? { account: d.account } : {}) } };
}

const EFFECT_OF: Readonly<Record<string, string>> = { [PROJECT_ACTIONS.start]: PROJECT_EFFECTS.start, [PROJECT_ACTIONS.pause]: PROJECT_EFFECTS.pause, [PROJECT_ACTIONS.resume]: PROJECT_EFFECTS.resume, [PROJECT_ACTIONS.drop]: PROJECT_EFFECTS.drop };

/** The same change as GM → Orgs makes it: one edit of the effect the action plays, with no one's `by`, so it is the GM's. */
export function projectOps(change: ProjectChange): EditOp[] {
  const effect = EFFECT_OF[change.action];
  return effect === undefined ? [] : [{ op: "effect", effect, args: change.params }];
}

/** The GM's setback on a step as typed: the step ("" for the one under way), whole days, an amount in the world's money, and why. */
export interface NoteDraft {
  step: string;
  days: string;
  amount: string;
  why: string;
}

/** Why a setback can't be sent yet, in words; null when it can. */
export function noteProblem(d: NoteDraft, currency: WorldCurrency): string | null {
  const days = d.days.trim() === "" ? 0 : Number(d.days);
  if (!Number.isInteger(days) || days < 0) return "Days: a whole number.";
  const cents = d.amount.trim() === "" ? 0 : parseMoneyInput(d.amount, currency);
  if (cents === null || cents < 0) return "What it costs on top: an amount.";
  if (days === 0 && cents === 0) return "Set it back some days, or add to what it costs.";
  return d.why.trim() === "" ? "Say why." : null;
}

/** The GM's setback as one edit of `economy.project_note`. */
export function noteOps(project: string, d: NoteDraft, currency: WorldCurrency): EditOp[] {
  const days = d.days.trim() === "" ? 0 : Number(d.days);
  const cents = d.amount.trim() === "" ? 0 : (parseMoneyInput(d.amount, currency) ?? 0);
  return [{ op: "effect", effect: PROJECT_EFFECTS.note, args: { project, ...(d.step !== "" ? { step: d.step } : {}), days, cents, text: d.why.trim(), source: "gm" } }];
}

// ---------------------------------------------------------------- drawing it

/** One step: its name and state, its length and money, where it stands in time, and what it waits on, uses and brings. */
export function StepItem(props: { step: StepView; money(cents: number): string }) {
  const s = props.step;
  const time = s.done ? `Done ${s.done}` : s.state === "running" || s.state === "paused" ? `${s.day !== undefined ? `Day ${s.day} of ${s.of}` : "Under way"}${s.end ? `, ends ${s.end}` : ""}` : null;
  const extra = s.extra > 0 || s.delay > 0 ? ` (${[s.delay > 0 ? `${s.delay} ${s.delay === 1 ? "day" : "days"} later` : "", s.extra > 0 ? `${props.money(s.extra)} more` : ""].filter((x) => x !== "").join(", ")})` : "";
  return (
    <div class="lre-stack" data-lre-project-step={s.id}>
      <div class="lre-inline">
        <strong>{s.name}</strong>
        <Badge tone={STATE_TONE[s.state]}>{STEP_STATE_WORDS[s.state]}</Badge>
      </div>
      <span class="lre-small">
        {s.length}
        {s.cost > 0 ? ` · ${props.money(s.cost)}, ${COST_WHEN_WORDS[s.when]}` : " · no cost"}
        {s.paid > 0 && s.paid < s.cost ? ` · ${props.money(s.paid)} paid` : ""}
        {extra}
      </span>
      {time ? <span class="lre-small">{time}</span> : null}
      {s.wait ? (
        <span class="lre-small" data-lre-project-wait>
          Waiting since {s.wait.since} for {props.money(s.wait.cents)} to {s.wait.side === "end" ? "finish" : "start"}; it tries again as money comes in.
        </span>
      ) : null}
      {s.after.length > 0 ? <span class="lre-small">After {s.after.map((a) => a.name).join(" and ")}</span> : null}
      {s.crew ? <span class="lre-small">Crew: {s.crew}</span> : null}
      {s.inputs.length > 0 ? <span class="lre-small">Uses: {s.inputs.join("; ")}</span> : null}
      {s.unlocks.map((u) => (
        <span key={u} class="lre-small">
          {u}
        </span>
      ))}
      {s.notes.map((n) => (
        <span key={`${n.at}:${n.text}`} class="lre-small">
          {[n.days > 0 ? `${n.days} ${n.days === 1 ? "day" : "days"} later` : "", n.cents > 0 ? `${props.money(n.cents)} more` : ""].filter((x) => x !== "").join(", ")}: {n.text} ({n.at}, {n.source === "gm" ? "by the GM" : "from the story"})
        </span>
      ))}
    </div>
  );
}

/** A project's card: its status and where it stands, its progress and money, its controls, and its steps under a disclosure. */
export function ProjectCard(props: { project: ProjectView; money(cents: number): string; busy: boolean; onControl(act: Act): void; extra?: ComponentChildren }) {
  const p = props.project;
  const controls = projectControls(p);
  const main = controls.find((c) => !c.danger);
  const rest = controls.filter((c) => c !== main);
  return (
    <Card
      title={
        <span class="lre-inline">
          {p.name}
          <Badge tone={STATUS_TONE[p.status]}>{p.statusWords}</Badge>
        </span>
      }
      aside={
        controls.length > 0 ? (
          <div class="lre-inline" data-lre-project-controls={p.id}>
            {main ? (
              <Button size="sm" variant="secondary" disabled={props.busy} onClick={() => props.onControl(main.act)}>
                {main.label}
              </Button>
            ) : null}
            {rest.length > 0 ? <OverflowMenu label={`${p.name}: more`} disabled={props.busy} items={rest.map((c) => ({ label: c.label, ...(c.danger ? { danger: true } : {}), onSelect: () => props.onControl(c.act) }))} /> : null}
          </div>
        ) : null
      }
    >
      <div class="lre-stack" data-lre-project={p.id}>
        {p.now ? <span>{p.now}</span> : null}
        <Meter label="Steps done" value={p.progress.done} max={Math.max(1, p.progress.total)} tone={p.status === "done" ? "pos" : "accent"} showValue />
        <span class="lre-small">
          {props.money(p.paid)} paid of {props.money(p.cost)}
          {p.left > 0 ? `, ${props.money(p.left)} to come` : ""}
          {p.account ? ` · from ${p.account.name}` : ""}
        </span>
        {p.start ? <span class="lre-small">Started {p.start}</span> : null}
        {p.due ? <span class="lre-small">Due to be done {p.due}, as things stand</span> : null}
        {p.ended ? <span class="lre-small">{p.status === "done" ? "Done" : "Dropped"} {p.ended}</span> : null}
        {p.made.length > 0 ? <span class="lre-small">Made: {p.made.map((m) => m.name).join(", ")}</span> : null}
        <Disclosure summary={`Steps (${p.progress.done} of ${p.progress.total} done)`}>
          <div class="lre-stack">
            {p.steps.map((s) => (
              <StepItem key={s.id} step={s} money={props.money} />
            ))}
          </div>
        </Disclosure>
        {props.extra}
      </div>
    </Card>
  );
}

/** A template as Start offers it: its length and cost bands, its steps and what it brings. */
function templateLine(t: ProjectTemplateView, money: (cents: number) => string): string {
  return `${t.days.min}–${t.days.max} days (about ${t.days.typical}) · ${money(t.cost.min)}–${money(t.cost.max)} (about ${money(t.cost.typical)}) · ${t.steps} steps`;
}

/** Start a project: a template, with what it is, takes and brings; a name; the account it pays from. */
export function StartForm(props: { view: ProjectsView; draft: StartDraft; money(cents: number): string; busy: boolean; onDraft(d: StartDraft): void; onStart(): void; onCancel(): void }) {
  const ids = { name: useId() };
  const d = props.draft;
  const chosen = props.view.templates.find((t) => t.id === d.template);
  return (
    <div class="lre-stack" data-lre-project-start>
      <Field label="What to build">
        <RefPicker label="What to build" value={d.template} placeholder="Choose a template" options={props.view.templates.map((t) => ({ value: t.id, label: t.name, sublabel: templateLine(t, props.money) }))} onChange={(template) => props.onDraft({ ...d, template })} />
      </Field>
      {chosen ? (
        <div class="lre-stack" data-lre-project-template={chosen.id}>
          <span class="lre-small">{chosen.description}</span>
          <span class="lre-small">{templateLine(chosen, props.money)}</span>
          {chosen.unlocks.map((u) => (
            <span key={u} class="lre-small">
              {u}
            </span>
          ))}
        </div>
      ) : null}
      <Field label="Name" for={ids.name} help="Leave it empty for the template's name.">
        <input id={ids.name} class="lre-input" maxLength={PROJECT_LIMITS.name} value={d.name} onInput={(event) => props.onDraft({ ...d, name: event.currentTarget.value })} />
      </Field>
      {props.view.accounts.length > 1 ? (
        <Field label="Pays from">
          <RefPicker label="Pays from" value={d.account} none="Its operating account" options={props.view.accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={(account) => props.onDraft({ ...d, account })} />
        </Field>
      ) : null}
      <span class="lre-small">Its steps start at once and run day by day; each pays as it says. A step the account can't pay waits until it can.</span>
      <div class="lre-inline">
        <Button variant="primary" disabled={props.busy || d.template === ""} onClick={props.onStart}>
          Start the project
        </Button>
        <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The GM's setback on a step: which step, days later, what it costs on top, and why. */
export function NoteForm(props: { project: ProjectView; draft: NoteDraft; currency: WorldCurrency; busy: boolean; onDraft(d: NoteDraft): void; onSave(): void; onCancel(): void }) {
  const ids = { days: useId(), why: useId() };
  const d = props.draft;
  const problem = noteProblem(d, props.currency);
  const open = props.project.steps.filter((s) => s.state !== "done");
  return (
    <div class="lre-stack" data-lre-project-note={props.project.id}>
      <Field label="Step">
        <RefPicker label="Step" value={d.step} none="The one under way" options={open.map((s) => ({ value: s.id, label: s.name }))} onChange={(step) => props.onDraft({ ...d, step })} />
      </Field>
      <Field label="Days later" for={ids.days}>
        <input id={ids.days} class="lre-input" inputMode="numeric" value={d.days} onInput={(event) => props.onDraft({ ...d, days: event.currentTarget.value })} />
      </Field>
      <Field label="Costs on top">
        <MoneyInput label="Costs on top" currency={props.currency} value={d.amount} onInput={(amount) => props.onDraft({ ...d, amount })} />
      </Field>
      <Field label="Why" for={ids.why} error={problem}>
        <input id={ids.why} class="lre-input" maxLength={300} value={d.why} onInput={(event) => props.onDraft({ ...d, why: event.currentTarget.value })} />
      </Field>
      <div class="lre-inline">
        <Button variant="primary" disabled={props.busy || problem !== null} onClick={props.onSave}>
          Set it back
        </Button>
        <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const NO_START: StartDraft = { template: "", name: "", account: "" };
const NO_NOTE: NoteDraft = { step: "", days: "", amount: "", why: "" };

/** The board both Play and GM → Orgs draw: the live projects, the ones over, and Start. `onNote` is the GM's alone. */
export function ProjectsBoard(props: { view: ProjectsView; currency: WorldCurrency; busy: boolean; onControl(p: ProjectView, act: Act): void; onStart(d: StartDraft, done: () => void): void; onNote?(p: ProjectView, d: NoteDraft, done: () => void): void }) {
  const [start, setStart] = useState<StartDraft | null>(null);
  const [note, setNote] = useState<{ project: string; draft: NoteDraft } | null>(null);
  const money = (cents: number): string => formatMoney(cents, props.currency);
  const v = props.view;
  if (!v.runs && v.projects.length === 0 && v.over.length === 0) return <Empty icon="briefcase" title="No projects">Projects run from Money 3.</Empty>;
  const startPart = v.canStart ? (
    start ? (
      <StartForm view={v} draft={start} money={money} busy={props.busy} onDraft={setStart} onStart={() => props.onStart(start, () => setStart(null))} onCancel={() => setStart(null)} />
    ) : (
      <Button variant="secondary" icon="plus" disabled={props.busy || v.templates.length === 0} onClick={() => setStart(NO_START)}>
        Start a project
      </Button>
    )
  ) : null;
  return (
    <div class="lre-stack" data-lre-projects={v.org}>
      {v.projects.length === 0 ? (
        <Empty icon="briefcase" title="No projects under way">
          {v.canStart ? "Start one from a template: a well, a foundry, a building, a season's crop." : "None it runs now."}
        </Empty>
      ) : (
        v.projects.map((p) => {
          const noting = note?.project === p.id ? note : null;
          const extra =
            props.onNote && p.status !== "planned" ? (
              noting ? (
                <NoteForm project={p} draft={noting.draft} currency={props.currency} busy={props.busy} onDraft={(draft) => setNote({ project: p.id, draft })} onSave={() => props.onNote?.(p, noting.draft, () => setNote(null))} onCancel={() => setNote(null)} />
              ) : (
                <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => setNote({ project: p.id, draft: NO_NOTE })}>
                  Set a step back
                </Button>
              )
            ) : null;
          return <ProjectCard key={p.id} project={p} money={money} busy={props.busy} onControl={(act) => props.onControl(p, act)} extra={extra} />;
        })
      )}
      {startPart}
      {v.over.length > 0 ? (
        <Section title="Done and dropped">
          <List>
            {v.over.map((p) => (
              <ListRow key={p.id} title={p.name} subtitle={`${p.statusWords}${p.ended ? ` ${p.ended}` : ""} · ${money(p.paid)} paid${p.made.length > 0 ? ` · made ${p.made.map((m) => m.name).join(", ")}` : ""}`} badge={<Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS_WORDS[p.status]}</Badge>} />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the tab

/** Play's Projects: each control is the reader's own act, played at once off screen with its Undo. */
export function OrgProjectsTab(props: OrgTabProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const view = projectsViewIn(props.section);
  if (!view) return <JsonView value={props.section} />;
  const play = (change: ProjectChange | null, done?: () => void): void => {
    if (change === null) return;
    run(async () => {
      const result = await app.request({ type: "lre.action", chatId: props.chatId, action: change.action, params: change.params, source: "palette" });
      if (result && "pending" in result) toastQueued(app, result);
      if (result) done?.();
    });
  };
  return <ProjectsBoard view={view} currency={props.state.currency ?? DEFAULT_CURRENCY} busy={busy} onControl={(p, act) => play(controlChange(props.org.id, p, act))} onStart={(d, done) => play(startChange(props.org.id, d), done)} />;
}

/** GM → Orgs' Projects: the same board, each change one GM edit of the effect it plays, and the GM's setback. */
export function GmOrgProjectsTab(props: OrgGmTabProps) {
  const view = projectsViewIn(props.section);
  if (!view) return <JsonView value={props.section} />;
  const edit = (ops: EditOp[], done?: () => void): void => {
    if (ops.length > 0) void props.gm.edit(ops).then((ok) => ok && done?.());
  };
  return (
    <ProjectsBoard
      view={view}
      currency={props.gm.currency}
      busy={props.gm.busy}
      onControl={(p, act) => edit(projectOps(controlChange(props.org.id, p, act)))}
      onStart={(d, done) => {
        const change = startChange(props.org.id, d);
        if (change) edit(projectOps(change), done);
      }}
      onNote={(p, d, done) => {
        if (noteProblem(d, props.gm.currency) === null) edit(noteOps(p.id, d, props.gm.currency), done);
      }}
    />
  );
}

/** The Projects tab, after Money (40) and before Ownership (60). */
export const PROJECTS_TAB_DEF: OrgTabDef = { id: PROJECTS_TAB, label: "Projects", order: 45, section: PROJECTS_SECTION, component: OrgProjectsTab, gm: GmOrgProjectsTab };

// ---------------------------------------------------------------- Build

/** An authored project of the organization, as Build lists it. */
export interface BuildProjectRow {
  id: string;
  name: string;
  status: "planned" | "active";
  start: string | null;
  steps: number;
  cost: number;
}

/** The organization's authored projects, by name. */
export function buildProjectRows(doc: WorldDoc, org: string): BuildProjectRow[] {
  return Object.values(doc.entities)
    .filter((e) => e.kind === PROJECT_KIND && e.fields.org === org)
    .map((e) => {
      const steps = stepsIn(e.fields.steps);
      return { id: e.id, name: e.name, status: e.fields.status === "active" ? ("active" as const) : ("planned" as const), start: typeof e.fields.start === "string" && e.fields.start !== "" ? e.fields.start : null, steps: steps.length, cost: steps.reduce((n, s) => n + stepCost(s), 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The templates Build offers (the economy's `projectTemplatesOf`, which its host hands this part), by id. */
export type BuildTemplates = Readonly<Record<string, JsonObject>>;

/** Add a project's form in Build: a template, its name, whether it is under way as the story begins or from a date, or planned. */
export interface BuildProjectDraft {
  template: string;
  name: string;
  status: "planned" | "active";
  start: string;
}

/** Why the form can't be saved yet, in words; null when it can. */
export function buildProjectProblem(d: BuildProjectDraft): string | null {
  if (d.template === "") return "Choose a template.";
  return d.start.trim() === "" || /^\d{4}-\d{2}-\d{2}$/.test(d.start.trim()) ? null : "Starts: a date, as YYYY-MM-DD.";
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "x";

/** The draft patch adding the project: an entity of its own, its steps copied from the template. */
export function buildProjectPatch(doc: WorldDoc, org: string, d: BuildProjectDraft, templates: BuildTemplates): JsonPatchOp[] {
  const row = templates[d.template];
  if (!row) return [];
  const name = d.name.trim().slice(0, PROJECT_LIMITS.name) || (typeof row.name === "string" ? row.name : "Project");
  const base = `project_${slug(org)}_${slug(name)}`;
  let id = base;
  for (let n = 2; doc.entities[id]; n++) id = `${base}_${n}`;
  const fields: JsonObject = { org, template: d.template, steps: (Array.isArray(row.steps) ? row.steps : []) as JsonValue, status: d.status, ...(d.start.trim() !== "" ? { start: d.start.trim() } : {}), ...(typeof row.payee === "string" && row.payee !== "" ? { payee: row.payee } : {}) };
  return [{ op: "add", path: pointerOf(["entities", id]), value: { id, kind: PROJECT_KIND, name, tier: "background", fields, relations: [] } }];
}

/** Build → Organizations' Projects part: the organization's authored projects (each opens its own page), Add from one of `templates`, and Remove. */
export function BuildOrgProjects(props: { doc: WorldDoc; org: string; templates: BuildTemplates; busy: boolean; onPatch(ops: JsonPatchOp[]): void; onOpen(id: string): void }) {
  const [draft, setDraft] = useState<BuildProjectDraft | null>(null);
  const ids = { name: useId(), start: useId() };
  const currency = props.doc.currency ?? DEFAULT_CURRENCY;
  const money = (cents: number): string => formatMoney(cents, currency);
  const rows = buildProjectRows(props.doc, props.org);
  const problem = draft ? buildProjectProblem(draft) : null;
  return (
    <div class="lre-stack" data-lre-build-projects={props.org}>
      {rows.length === 0 ? (
        <span class="lre-small">No projects. One added here is in the world from the start: planned, or under way as the story begins or from a date.</span>
      ) : (
        <List>
          {rows.map((r) => (
            <ListRow key={r.id} title={r.name} subtitle={`${r.status === "active" ? (r.start ? `Under way from ${r.start}` : "Under way as the story begins") : "Planned"} · ${r.steps} steps · ${money(r.cost)}`} chevron onClick={() => props.onOpen(r.id)} value={<OverflowMenu label={`${r.name}: more`} disabled={props.busy} items={[{ label: "Remove", danger: true, onSelect: () => props.onPatch([{ op: "remove", path: pointerOf(["entities", r.id]) }]) }]} />} />
          ))}
        </List>
      )}
      {draft ? (
        <div class="lre-stack" data-lre-build-project-form>
          <Field label="Template">
            <RefPicker label="Template" value={draft.template} placeholder="Choose a template" options={Object.entries(props.templates).map(([id, row]) => ({ value: id, label: typeof row.name === "string" ? row.name : id }))} onChange={(template) => setDraft({ ...draft, template })} />
          </Field>
          <Field label="Name" for={ids.name} help="Leave it empty for the template's name.">
            <input id={ids.name} class="lre-input" maxLength={PROJECT_LIMITS.name} value={draft.name} onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
          </Field>
          <Field label="When">
            <RefPicker label="When" value={draft.status} options={[{ value: "planned", label: "Planned: started in play" }, { value: "active", label: "Under way" }]} onChange={(status) => setDraft({ ...draft, status: status === "active" ? "active" : "planned" })} />
          </Field>
          {draft.status === "active" ? (
            <Field label="Starts" for={ids.start} help="A date (YYYY-MM-DD), at 09:00; empty: as the story begins." error={problem}>
              <input id={ids.start} class="lre-input" placeholder="YYYY-MM-DD" value={draft.start} onInput={(event) => setDraft({ ...draft, start: event.currentTarget.value })} />
            </Field>
          ) : null}
          <div class="lre-inline">
            <Button
              variant="primary"
              disabled={props.busy || problem !== null}
              onClick={() => {
                props.onPatch(buildProjectPatch(props.doc, props.org, draft, props.templates));
                setDraft(null);
              }}
            >
              Add the project
            </Button>
            <Button variant="ghost" disabled={props.busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" icon="plus" disabled={props.busy} onClick={() => setDraft({ template: "", name: "", status: "planned", start: "" })}>
          Add a project
        </Button>
      )}
    </div>
  );
}
