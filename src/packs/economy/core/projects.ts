// Production projects (DESIGN §26.5; Money 3): a party's steps toward something that pays, such as a
// well drilled, a foundry built or a season farmed (`shared/projects.ts` holds the shapes). A
// project is a `project` entity: whose it is, its steps, the account it pays from and to whom. What
// has happened to it is the economy slice's `projects` record, which only the `economy.project_*`
// events write, each carrying its own instant.
//
// A step starts when the steps it comes after are done (the first ones as the project starts) and
// ends its length of work later: calendar days, or business days, which count only business days.
// Its cost is paid as it starts, as it ends, or half at each. A step whose payment the account can't
// make waits, with an alert, and tries again at the end of every slot until it can; a pause stops
// its clock and keeps the work it has left. On its completion its unlocks start a stream, make a
// thing (an asset whose cost, life and in-service day are recorded for depreciation) or set a field,
// each its own unit in order, so one on the thing just made finds it. What its steps capitalized
// that nothing it made took is written off in its party's books as it ends, dropped or done.
// The projects process (`economy.projects`) steps every slot as the money step does, on a scratch
// state, taking each step's start and end at its exact instant and every step they let start in the
// same slot, so a stretch of days run at once and the same days run one by one agree.
//
// The party plays its projects at once, off screen (A1's route, told under "business"): Start,
// Pause, Resume and Drop; the GM's effects and the org op `project` do the same, and the story only
// sets a step back or adds to its cost (`project_note`, within bounds, with its receipt and Undo).
// No one marks a step done: only its time does.

import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { LintIssue } from "../../../shared/protocol";
import { COST_WHEN_WORDS, costParts, isProjectStatus, lengthWords, PROJECT_ACTIONS, PROJECT_EFFECTS, PROJECT_EVENTS, PROJECT_KIND, PROJECT_LIMITS, PROJECT_NOTE, PROJECT_STATUS_WORDS, PROJECTS_SECTION, PROJECTS_TABLE, stepCost, stepDays, stepOrder, stepsIn, type ProjectDef, type ProjectRun, type ProjectStatus, type ProjectStep, type ProjectTemplateView, type ProjectUnlock, type ProjectView, type ProjectsView, type StepNote, type StepRun, type StepState, type StepView } from "../../../shared/projects";
import type { DataTable, ShippedRevision } from "../../../shared/tables";
import type { ActionDef, EntityDef, FieldDef, ParamDef, WorldDoc } from "../../../shared/world";
import { calendarOf, clockAt, clockOfLocal, dateAt, formatStamp, MINUTES_PER_DAY, type Calendar } from "../../../engine/calendar";
import { mayAct, membersOfOrg, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, optionalService, own, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ProposalChannelDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { monthOf } from "./books";
import { bookRecovery, depreciates } from "./depreciation";
import { DEFAULT_FLOW_MINUTE, isBusinessDay } from "./flows";
import { hiddenFrom, unpricedCap } from "./model";
import type { FinanceApi, FinanceRegistry } from "./module";
import { Run } from "./run";
import projectsTable from "./tables/modern-us/projects.json";
import shipped from "./tables/modern-us/shipped.json";

/** Who a project's costs are paid to when it names no one. */
const DEFAULT_PAYEE = "Contractors";
/** The most projects a party runs at once (planned, under way or paused). */
const OPEN_MAX = 12;
/** The longest a story note's words run. */
const NOTE_TEXT_MAX = 300;
/** The most a GM's note sets a step back, in days. */
const GM_NOTE_DAYS = 365;

// ---------------------------------------------------------------- reading

/** A project as it stands: its definition, what has happened to it, its status and when it started (null: not started). */
export interface Project {
  def: ProjectDef;
  run: ProjectRun;
  status: ProjectStatus;
  started: number | null;
}

/** What has happened to a project, as the slice holds it. */
export function projectRunOf(state: ReadContext["state"], id: EntityId): ProjectRun {
  const raw = objOf(objOf(sliceOf(state, "economy").projects)[id]);
  return { ...(raw as unknown as ProjectRun), steps: objOf(raw.steps) as unknown as Record<string, StepRun> };
}

function writeRun(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], id: EntityId, run: ProjectRun): void {
  sliceRecord(state, "economy", "projects")[id] = run as unknown as JsonValue;
}

/**
 * A project as it ends (dropped, or done), with what its steps booked as capital spending that
 * nothing it made took written off: its party's books take it that month among their depreciation,
 * so the cost is expensed once rather than never, and the project holds none.
 */
function writtenOff(state: Parameters<EventTypeDef<PackEvent>["apply"]>[1], world: WorldDoc, id: EntityId, run: ProjectRun, at: number): ProjectRun {
  const left = Math.round(run.capex ?? 0);
  const org = strOf(own(state.entities, id)?.fields.org);
  if (left <= 0 || org === "") return run;
  bookRecovery(state, org, monthOf(world, at), "depreciation", left);
  return { ...run, capex: 0 };
}

/** When an authored project starts: its `start` (a date at 09:00, or a date and time), else as the story begins. */
function authoredStart(cal: Calendar, start: string | undefined): number {
  if (!start) return 0;
  try {
    return start.length > 10 ? clockOfLocal(cal, start) : clockOfLocal(cal, start) + DEFAULT_FLOW_MINUTE;
  } catch {
    return 0;
  }
}

/** A project entity as it stands, or null when there is none (or it is gone). */
export function projectOf(ctx: Pick<ReadContext, "world" | "state">, id: EntityId): Project | null {
  const e = own(ctx.state.entities, id);
  if (!e || e.kind !== PROJECT_KIND || isGone(ctx.state, id)) return null;
  const f = e.fields;
  const def: ProjectDef = {
    id,
    name: e.name,
    org: strOf(f.org),
    ...(strOf(f.template) !== "" ? { template: strOf(f.template) } : {}),
    steps: stepsIn(f.steps),
    ...(strOf(f.account) !== "" ? { account: strOf(f.account) } : {}),
    ...(strOf(f.payee) !== "" ? { payee: strOf(f.payee) } : {}),
    ...(strOf(f.start) !== "" ? { start: strOf(f.start) } : {}),
    status: f.status === "active" ? "active" : "planned",
  };
  const run = projectRunOf(ctx.state, id);
  const status = isProjectStatus(run.status) ? run.status : def.status;
  const started = typeof run.started === "number" ? run.started : def.status === "active" ? authoredStart(calendarOf(ctx.world), def.start) : null;
  return { def, run, status, started };
}

/** The project entities of a party (all of them, without `org`), by id. */
export function projectIds(state: ReadContext["state"], org?: EntityId): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => {
      const e = own(state.entities, id);
      return e?.kind === PROJECT_KIND && (org === undefined || e.fields.org === org) && !isGone(state, id);
    })
    .sort();
}

const isLive = (status: ProjectStatus): boolean => status === "planned" || status === "active" || status === "paused";

/** Why a project can't be acted on as it stands: "Well No. 3 is paused". */
function statusWords(p: Project): string {
  return `${p.def.name} is ${PROJECT_STATUS_WORDS[p.status].toLowerCase()}`;
}

/** The instant a step was done, or null; an authored done step was done as the project started. */
function doneAt(p: Project, s: ProjectStep): number | null {
  const r = p.run.steps[s.id];
  if (typeof r?.done === "number") return r.done;
  return s.done === true && p.started !== null ? p.started : null;
}

/** The instant a step may start: the project's start, or the last of the steps it comes after being done; null while one isn't. */
function readyAt(p: Project, s: ProjectStep): number | null {
  if (p.started === null) return null;
  let at = p.started;
  for (const a of s.after ?? []) {
    const dep = p.def.steps.find((x) => x.id === a);
    if (!dep) continue;
    const d = doneAt(p, dep);
    if (d === null) return null;
    at = Math.max(at, d);
  }
  return at;
}

function stateOf(p: Project, s: ProjectStep): StepState {
  const r = p.run.steps[s.id];
  if (doneAt(p, s) !== null) return "done";
  if (r?.wait) return "waiting";
  if (typeof r?.start === "number") return p.status === "paused" ? "paused" : "running";
  return readyAt(p, s) !== null ? "ready" : "pending";
}

/** Whether the project makes a thing: only then do its capitalized steps build one. */
function makes(def: ProjectDef): boolean {
  return def.steps.some((s) => (s.unlocks ?? []).some((u) => "make" in u));
}

/** What a step pays in all: its cost, its inputs' and what story notes added. */
function costOf(s: ProjectStep, r: StepRun | undefined): number {
  return stepCost(s) + (r?.extra ?? 0);
}

// ---------------------------------------------------------------- time

/** The instant `minutes` of work after `at`: every minute counts, or with `business` only those of a business day. */
export function addWork(cal: Calendar, at: number, minutes: number, business: boolean): number {
  if (minutes <= 0) return at;
  if (!business) return at + minutes;
  let t = at;
  let left = minutes;
  for (let guard = 0; guard < PROJECT_LIMITS.days * 2 + 31; guard++) {
    const d = dateAt(cal, t);
    const next = clockAt(cal, d.dayIndex + 1, 0);
    if (isBusinessDay(cal, d.dayIndex)) {
      if (left <= next - t) return t + left;
      left -= next - t;
    }
    t = next;
  }
  return t + left;
}

/** The minutes of work between two instants: every minute, or with `business` only those of a business day. */
export function workBetween(cal: Calendar, from: number, to: number, business: boolean): number {
  if (to <= from) return 0;
  if (!business) return to - from;
  let sum = 0;
  let t = from;
  for (let guard = 0; guard < PROJECT_LIMITS.days * 2 + 31 && t < to; guard++) {
    const d = dateAt(cal, t);
    const next = Math.min(to, clockAt(cal, d.dayIndex + 1, 0));
    if (isBusinessDay(cal, d.dayIndex)) sum += next - t;
    t = next;
  }
  return sum;
}

/** A step's work, in minutes: its days and the days notes set it back, each a whole day of work. */
function workOf(s: ProjectStep, r: StepRun | undefined): number {
  return (stepDays(s) + (r?.delay ?? 0)) * MINUTES_PER_DAY;
}

const dayText = (cal: Calendar, at: number): string => formatStamp(cal, at).slice(0, 10);

// ---------------------------------------------------------------- the events

function stepEventProblem(ctx: ReadContext, e: PackEvent): Rejection | null {
  const p = projectOf(ctx, strOf(e.data.project));
  if (!p) return { code: "missing_entity", reason: `there's no project ${strOf(e.data.project)}` };
  const s = p.def.steps.find((x) => x.id === strOf(e.data.step));
  if (!s) return { code: "not_found", reason: `${p.def.name} has no step ${strOf(e.data.step)}` };
  if (typeof e.data.at !== "number") return { code: "bad_event", reason: "a project step needs its instant" };
  if (p.status !== "active") return { code: "not_active", reason: statusWords(p) };
  const r = p.run.steps[s.id];
  if (doneAt(p, s) !== null) return { code: "done", reason: `${s.name} is done` };
  const phase = strOf(e.data.phase);
  if (phase === "start") {
    const ready = readyAt(p, s);
    return typeof r?.start === "number" ? { code: "started", reason: `${s.name} has started` } : ready === null || ready > e.data.at ? { code: "not_ready", reason: `${s.name} waits for the steps before it` } : null;
  }
  if (phase === "done") return typeof r?.start === "number" ? null : { code: "not_started", reason: `${s.name} hasn't started` };
  if (phase === "wait") return (e.data.side === "end") === (typeof r?.start === "number") ? null : { code: "bad_event", reason: `${s.name} can't wait to ${strOf(e.data.side)}` };
  return { code: "bad_event", reason: `a project step is started, waits or is done, not ${phase}` };
}

/** Every step of a project done, by its run and its authored flags. */
function allDone(def: ProjectDef, run: ProjectRun): boolean {
  return def.steps.every((s) => s.done === true || typeof run.steps[s.id]?.done === "number");
}

export const PROJECT_EVENT_DEFS: EventTypeDef<PackEvent>[] = [
  {
    // A planned project set going, at its instant.
    type: PROJECT_EVENTS.begin,
    validate: (e, ctx) => {
      const p = projectOf(ctx, strOf(e.data.project));
      if (!p || typeof e.data.at !== "number") return { code: "missing_entity", reason: `there's no project ${strOf(e.data.project)}` };
      return p.status === "planned" ? null : { code: "not_planned", reason: statusWords(p) };
    },
    apply: (e, state) => {
      const id = strOf(e.data.project);
      writeRun(state, id, { ...projectRunOf(state, id), status: "active", started: numOf(e.data.at) });
    },
    describe: (e, ctx) => `Started ${labelOf(ctx, strOf(e.data.project))}`,
  },
  {
    // A step started (its payment beside it), waiting for money, or done (its payment and what it made beside it); the last one done ends the project.
    type: PROJECT_EVENTS.step,
    validate: (e, ctx) => stepEventProblem(ctx, e),
    apply: (e, state, ctx) => {
      const id = strOf(e.data.project);
      const step = strOf(e.data.step);
      const at = numOf(e.data.at);
      const run = projectRunOf(state, id);
      const { wait: _wait, ...cur } = run.steps[step] ?? {};
      const paid = numOf(e.data.paid);
      const built = numOf(e.data.built);
      const capex = numOf(e.data.capex);
      const took = objOf(e.data.took);
      const money = { paid: (cur.paid ?? 0) + paid, built: (cur.built ?? 0) + built, capex: (cur.capex ?? 0) + capex };
      const phase = strOf(e.data.phase);
      const next: StepRun = phase === "wait" ? { ...cur, wait: { since: at, cents: numOf(e.data.cents), side: e.data.side === "end" ? "end" : "start" } } : phase === "start" ? { ...cur, ...money, start: at, end: numOf(e.data.end, at) } : { ...cur, ...money, done: at };
      const out: ProjectRun = { ...run, steps: { ...run.steps, [step]: next }, built: (run.built ?? 0) + built - numOf(took.built), capex: (run.capex ?? 0) + capex - numOf(took.capex) };
      const made = Array.isArray(e.data.made) ? e.data.made.filter((m): m is string => typeof m === "string") : [];
      if (made.length > 0) out.made = [...(run.made ?? []), ...made];
      const p = projectOf({ world: ctx.world, state }, id);
      const ends = phase === "done" && p !== null && allDone(p.def, out);
      writeRun(state, id, ends ? writtenOff(state, ctx.world, id, { ...out, status: "done", ended: at }, at) : out);
    },
    describe: (e, ctx) => {
      const p = projectOf(ctx, strOf(e.data.project));
      const name = p?.def.steps.find((s) => s.id === strOf(e.data.step))?.name ?? strOf(e.data.step);
      const what = labelOf(ctx, strOf(e.data.project));
      const phase = strOf(e.data.phase);
      if (phase === "wait") return `${what}: ${name} waits for ${formatMoneyIn(ctx.world, numOf(e.data.cents))} to ${e.data.side === "end" ? "finish" : "start"}`;
      return `${what}: ${name} ${phase === "start" ? "started" : "done"}`;
    },
  },
  {
    // A project paused: each step under way keeps the work it had left.
    type: PROJECT_EVENTS.pause,
    validate: (e, ctx) => statusProblem(ctx, e, ["active"]),
    apply: (e, state) => {
      const id = strOf(e.data.project);
      const run = projectRunOf(state, id);
      const left = objOf(e.data.left);
      const steps: Record<string, StepRun> = { ...run.steps };
      for (const [step, minutes] of Object.entries(left)) if (typeof minutes === "number") steps[step] = { ...steps[step], left: minutes };
      writeRun(state, id, { ...run, status: "paused", paused: numOf(e.data.at), steps });
    },
    describe: (e, ctx) => `Paused ${labelOf(ctx, strOf(e.data.project))}`,
  },
  {
    // A paused project going again: each step under way ends its work left after now.
    type: PROJECT_EVENTS.resume,
    validate: (e, ctx) => statusProblem(ctx, e, ["paused"]),
    apply: (e, state) => {
      const id = strOf(e.data.project);
      const { paused: _paused, ...run } = projectRunOf(state, id);
      const ends = objOf(e.data.ends);
      const steps: Record<string, StepRun> = { ...run.steps };
      for (const [step, end] of Object.entries(ends)) {
        if (typeof end !== "number") continue;
        const { left: _left, ...cur } = steps[step] ?? {};
        steps[step] = { ...cur, end };
      }
      writeRun(state, id, { ...run, status: "active", steps });
    },
    describe: (e, ctx) => `Resumed ${labelOf(ctx, strOf(e.data.project))}`,
  },
  {
    // A project dropped: what it paid stays paid, and what it made stays made; what nothing it made took is written off.
    type: PROJECT_EVENTS.drop,
    validate: (e, ctx) => statusProblem(ctx, e, ["planned", "active", "paused"]),
    apply: (e, state, ctx) => {
      const id = strOf(e.data.project);
      const at = numOf(e.data.at);
      const { paused: _paused, ...run } = projectRunOf(state, id);
      writeRun(state, id, writtenOff(state, ctx.world, id, { ...run, status: "dropped", ended: at }, at));
    },
    describe: (e, ctx) => `Dropped ${labelOf(ctx, strOf(e.data.project))}`,
  },
  {
    // A step set back or costing more, as the story or the GM tells it: its days and cost on top, and its end moved when it is under way.
    type: PROJECT_EVENTS.note,
    validate: (e, ctx) => {
      const bad = statusProblem(ctx, e, ["planned", "active", "paused"]);
      if (bad) return bad;
      const p = projectOf(ctx, strOf(e.data.project));
      const s = p?.def.steps.find((x) => x.id === strOf(e.data.step));
      if (!p || !s) return { code: "not_found", reason: `there's no such step` };
      if (doneAt(p, s) !== null) return { code: "done", reason: `${s.name} is done` };
      const days = e.data.days;
      const cents = e.data.cents;
      return typeof days === "number" && Number.isInteger(days) && days >= 0 && typeof cents === "number" && Number.isInteger(cents) && cents >= 0 && days + cents > 0 ? null : { code: "bad_event", reason: "a note sets a step back by whole days or adds to its cost" };
    },
    apply: (e, state) => {
      const id = strOf(e.data.project);
      const step = strOf(e.data.step);
      const run = projectRunOf(state, id);
      const cur = run.steps[step] ?? {};
      const days = numOf(e.data.days);
      const cents = numOf(e.data.cents);
      const note: StepNote = { text: strOf(e.data.text), days, cents, at: numOf(e.data.at), source: e.data.source === "gm" ? "gm" : "story" };
      const next: StepRun = { ...cur, delay: (cur.delay ?? 0) + days, extra: (cur.extra ?? 0) + cents, notes: [...(cur.notes ?? []), note].slice(-PROJECT_LIMITS.notes) };
      if (typeof e.data.end === "number" && typeof cur.end === "number") next.end = e.data.end;
      if (typeof cur.left === "number") next.left = cur.left + days * MINUTES_PER_DAY;
      writeRun(state, id, { ...run, steps: { ...run.steps, [step]: next } });
    },
    describe: (e, ctx) => {
      const p = projectOf(ctx, strOf(e.data.project));
      const name = p?.def.steps.find((s) => s.id === strOf(e.data.step))?.name ?? strOf(e.data.step);
      return `${labelOf(ctx, strOf(e.data.project))}: ${noteWords(ctx.world, name, numOf(e.data.days), numOf(e.data.cents))}${strOf(e.data.text) !== "" ? ` (${strOf(e.data.text)})` : ""}`;
    },
  },
];

function statusProblem(ctx: ReadContext, e: PackEvent, allowed: readonly ProjectStatus[]): Rejection | null {
  const p = projectOf(ctx, strOf(e.data.project));
  if (!p || typeof e.data.at !== "number") return { code: "missing_entity", reason: `there's no project ${strOf(e.data.project)}` };
  return allowed.includes(p.status) ? null : { code: "bad_status", reason: statusWords(p) };
}

function formatMoneyIn(world: WorldDoc, cents: number): string {
  const c = world.currency;
  const major = cents / 10 ** (c?.decimals ?? 2);
  return `${c?.symbol ?? "$"}${major.toLocaleString("en-US", { minimumFractionDigits: c?.decimals ?? 2, maximumFractionDigits: c?.decimals ?? 2 })}`;
}

/** "Drilling set back 5 days and costing $8,000.00 more". */
function noteWords(world: WorldDoc, step: string, days: number, cents: number): string {
  const back = days > 0 ? ` set back ${days === 1 ? "1 day" : `${days} days`}` : "";
  const more = cents > 0 ? `${back !== "" ? " and" : ""} costing ${formatMoneyIn(world, cents)} more` : "";
  return `${step}${back}${more}`;
}

// ---------------------------------------------------------------- paying and making

/** The account a project pays from: its own, while its party may still spend it, else the party's operating or deposit account. */
function payingAccount(api: FinanceApi, ctx: ReadContext, def: ProjectDef): EntityId | null {
  if (def.account && api.accountsOf(ctx, def.org, "spend").includes(def.account)) return def.account;
  return api.depositAccount(ctx, def.org);
}

interface Paid {
  events: LedgerEvent[];
  built: number;
  capex: number;
}

/** A step's payment, `side` of it: refused when the account can't make it. A capitalized step's builds what the project makes, booked as capital spending where its party depreciates. */
function payStep(api: FinanceApi, ctx: ReadContext, p: Project, s: ProjectStep, cents: number, side: "start" | "end"): Paid | Rejection {
  if (cents <= 0) return { events: [], built: 0, capex: 0 };
  const from = payingAccount(api, ctx, p.def);
  if (from === null) return { code: "no_account", reason: `${labelOf(ctx, p.def.org)} has no account to pay from` };
  if (api.available(ctx, from) < cents) return { code: "declined", reason: `${labelOf(ctx, from)} doesn't have ${api.money(ctx, cents)}` };
  const builds = s.capitalize === true && makes(p.def);
  const capital = builds && depreciates(ctx, p.def.org);
  const part = (s.paid ?? "start") === "split" ? (side === "start" ? " (first half)" : " (the rest)") : "";
  const paid = api.pay(ctx, { from, to: p.def.payee ?? DEFAULT_PAYEE, cents, memo: `${p.def.name}: ${s.name}${part}`, kind: "purchase", category: capital ? "capex" : "project" });
  if (!Array.isArray(paid)) return paid;
  return { events: paid, built: builds ? cents : 0, capex: capital ? cents : 0 };
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "x";

/** An entity id not yet taken, from `base`. */
function freeId(ctx: Pick<ReadContext, "state">, base: string, taken: ReadonlySet<string> = new Set()): EntityId {
  let id = base;
  for (let n = 2; own(ctx.state.entities, id) || taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

interface Unlocked {
  /** Each unlock's events, in its order: one unit each. */
  units: LedgerEvent[][];
  made: EntityId[];
  took: { built: number; capex: number } | null;
}

/**
 * What a step's completion at `at` brings about, each unlock its own events: a thing made (with what
 * its building cost, its life and in-service day), a stream spawned to run from that day (linked to
 * the thing made), one of the world's flows set going, or a field set (`made`: on the thing made).
 * The things one step makes share what was built and capitalized since the last thing made, evenly,
 * the first taking the odd cents, so together they take it once.
 */
function unlocksAt(ctx: ReadContext, p: Project, s: ProjectStep, at: number, paid: Paid): Unlocked {
  const cal = calendarOf(ctx.world);
  const day = dayText(cal, at);
  const out: Unlocked = { units: [], made: [], took: null };
  const taken = new Set<string>();
  let made: EntityId | null = p.run.made?.at(-1) ?? null;
  const making = (s.unlocks ?? []).filter((u) => "make" in u).length;
  const share = (pool: number): number => (out.made.length === 0 ? pool - Math.floor(pool / making) * (making - 1) : Math.floor(pool / making));
  for (const [i, u] of (s.unlocks ?? []).entries()) {
    const unit: LedgerEvent[] = [];
    if ("make" in u) {
      const m = u.make;
      const kind = m.kind ?? "property";
      const id = freeId(ctx, `${p.def.id}_${slug(m.name)}`, taken);
      taken.add(id);
      const built = share((p.run.built ?? 0) + paid.built);
      const capex = share((p.run.capex ?? 0) + paid.capex);
      const fields: JsonObject = { ...(m.fields ?? {}) };
      if (kind === "property") {
        fields.built_by = p.def.id;
        fields.owners = [{ party: p.def.org, role: "owner" }];
        fields.value = m.value === undefined || m.value === "cost" ? built : m.value;
        if (capex > 0) fields.capital_cost = capex;
        if (m.life_months !== undefined) fields.life_months = m.life_months;
        if (m.salvage !== undefined) fields.salvage = m.salvage;
        fields.in_service = day;
        if (fields.managed === true && fields.let_from === undefined) fields.let_from = day;
      }
      const entity: EntityDef = { id, kind, name: m.name, tier: "background", fields, relations: [] };
      unit.push({ type: "spawn", entity });
      out.took = { built: (out.took?.built ?? 0) + built, capex: (out.took?.capex ?? 0) + capex };
      out.made.push(id);
      made = id;
    } else if ("stream" in u) {
      const spec = u.stream;
      const id = freeId(ctx, `flow_${p.def.id}_${s.id}_${i + 1}`, taken);
      taken.add(id);
      const fields: JsonObject = { flow_kind: "income", from: "Purchaser", shortfall: "skip", ...spec, to: strOf(spec.to) || p.def.org, start: day, status: "active" };
      if (fields.link === undefined && made !== null) fields.link = made;
      unit.push({ type: "spawn", entity: { id, kind: "flow", name: u.name ?? `${p.def.name}: income`, tier: "background", fields, relations: [] } });
    } else if ("flow" in u) {
      unit.push({ type: "set", entity: u.flow, field: "start", value: day }, { type: "set", entity: u.flow, field: "status", value: "active" });
    } else {
      const entity = u.set.entity === "org" ? p.def.org : u.set.entity === "made" ? made : u.set.entity;
      if (entity !== null) unit.push({ type: "set", entity, field: u.set.field, value: u.set.value });
    }
    if (unit.length > 0) out.units.push(unit);
  }
  return out;
}

// ---------------------------------------------------------------- stepping

/** One thing due on a project: a step to start, to end, or (`retry`) waiting for money. */
interface Due {
  at: number;
  project: EntityId;
  index: number;
  step: ProjectStep;
  kind: "start" | "end" | "retry";
}

/** A project's next thing due by `until`; a waiting step tries again only at the end of a slot it waited through the start of (`slot`). */
function nextDue(p: Project, until: number, slot: SlotInfo | null, tried: ReadonlySet<string>): Due | null {
  if (p.status !== "active" || p.started === null) return null;
  let best: Due | null = null;
  for (const [index, s] of p.def.steps.entries()) {
    if (doneAt(p, s) !== null || tried.has(`${p.def.id}:${s.id}`)) continue;
    const r = p.run.steps[s.id];
    let due: Due | null = null;
    if (r?.wait) {
      if (slot && r.wait.since <= slot.start) due = { at: slot.end, project: p.def.id, index, step: s, kind: "retry" };
    } else if (typeof r?.start !== "number") {
      const ready = readyAt(p, s);
      if (ready !== null && ready <= until) due = { at: ready, project: p.def.id, index, step: s, kind: "start" };
    } else if (typeof r.end === "number" && r.end <= until) due = { at: r.end, project: p.def.id, index, step: s, kind: "end" };
    if (due && (!best || due.at < best.at)) best = due;
  }
  return best;
}

/** One unit: its events in one group, what a payment kept apart kept apart from it. */
function unitOf(events: readonly LedgerEvent[], key: string): LedgerEvent[] {
  const group = `project:${hashParts(key).slice(0, 12)}`;
  return events.map((e) => ({ ...e, group: e.group?.startsWith("apart:") ? `apart:${group}` : group }));
}

/** Where a step's money note goes: the player character, when they run its party's money; else the party's own record. */
function noteFor(ctx: ReadContext, org: EntityId): EntityId {
  const pov = ctx.world.pov;
  return pov === org || mayAct(ctx, pov, org, "money.view").ok ? pov : org;
}

/** Does one thing due, on the run: a step started or done with its payment (and its unlocks, tied to it), or a wait recorded. */
function doDue(api: FinanceApi, run: Run, due: Due): boolean {
  const ctx = run.ctx;
  const p = projectOf(ctx, due.project);
  if (!p) return false;
  const s = due.step;
  const r = p.run.steps[s.id];
  const cal = calendarOf(ctx.world);
  const ending = due.kind === "end" || (due.kind === "retry" && r?.wait?.side === "end");
  const parts = costParts(s, stepCost(s));
  const cents = ending ? parts.end + (r?.extra ?? 0) : parts.start;
  const paid = payStep(api, ctx, p, s, cents, ending ? "end" : "start");
  const key = `${p.def.id}:${s.id}:${due.kind}:${due.at}`;
  if ("code" in paid) {
    if (r?.wait) return false;
    const side = ending ? "end" : "start";
    const words = `${p.def.name}: ${s.name} can't ${side === "start" ? "start" : "finish"} until ${api.money(ctx, cents)} can be paid (${paid.reason}); it tries again as money comes in.`;
    return run.emit(unitOf([{ type: PROJECT_EVENTS.step, data: { project: p.def.id, step: s.id, phase: "wait", at: due.at, cents, side } }, ...api.note(ctx, noteFor(ctx, p.def.org), "decline", words)], key)).length > 0;
  }
  const money = { paid: cents, built: paid.built, capex: paid.capex };
  if (!ending) {
    const end = addWork(cal, due.at, workOf(s, r), s.business_days !== undefined);
    return run.emit(unitOf([...paid.events, { type: PROJECT_EVENTS.step, data: { project: p.def.id, step: s.id, phase: "start", at: due.at, end, ...money } }], key)).length > 0;
  }
  const unlocked = unlocksAt(ctx, p, s, due.at, paid);
  const host = unitOf([...paid.events, { type: PROJECT_EVENTS.step, data: { project: p.def.id, step: s.id, phase: "done", at: due.at, ...money, ...(unlocked.took ? { took: unlocked.took } : {}), ...(unlocked.made.length > 0 ? { made: unlocked.made } : {}) } }], key);
  const applied = run.emit(host);
  if (applied.length === 0) return false;
  // What the step brings about stands only with its completion (a view that drops that drops these),
  // each unlock its own unit in order, so one setting a field of the thing just made finds it made.
  const tie = host[0]?.group;
  if (tie) run.emit(unlocked.units.flatMap((unit, i) => unitOf(unit, `${key}:unlocks:${i}`).map((e) => ({ ...e, tiedTo: [tie] }))));
  return true;
}

/** Steps the projects through everything due by `until`, in time order across all of them (then by project and step), each on the run's state as the last left it. */
function advance(api: FinanceApi, run: Run, ids: readonly EntityId[], until: number, slot: SlotInfo | null): void {
  const tried = new Set<string>();
  for (let guard = 0; guard < ids.length * PROJECT_LIMITS.steps * 4 + 8; guard++) {
    let best: Due | null = null;
    for (const id of ids) {
      const p = projectOf(run.ctx, id);
      const due = p ? nextDue(p, until, slot, tried) : null;
      if (due && (!best || due.at < best.at || (due.at === best.at && (due.project < best.project || (due.project === best.project && due.index < best.index))))) best = due;
    }
    if (!best) return;
    // A retry that fails, or anything that doesn't apply, is tried once a pass.
    if (!doDue(api, run, best) || best.kind === "retry") tried.add(`${best.project}:${best.step.id}`);
  }
}

/** The projects process: every live project of a party at Money 3 or more, through the slot. */
function stepProjects(api: FinanceApi, slot: SlotInfo, ctx: ReadContext): LedgerEvent[] {
  const ids = projectIds(ctx.state).filter((id) => {
    const p = projectOf(ctx, id);
    return p !== null && p.status === "active" && ctx.levelOf(p.def.org, "money") >= 3;
  });
  if (ids.length === 0) return [];
  const run = new Run(ctx);
  advance(api, run, ids, slot.end, slot);
  return run.out;
}

// ---------------------------------------------------------------- the effects

type Args = Record<string, JsonValue>;

/** Why `by` may not run `org`'s projects (spend its money, a payment of `cents` at most), or null: the GM, the party itself, or one within the power's limits. */
function refusal(ctx: ReadContext, by: EntityId, org: EntityId, cents = 0): Rejection | null {
  if (by === "" || by === org) return null;
  const may = mayAct(ctx, by, org, "money.spend", cents > 0 ? { amount: cents } : {});
  return may.ok ? null : { code: "not_owner", reason: may.reason };
}

/** The History line of an act on an organization's project: the GM's (no `by`), or someone's who does it for one other than themselves. */
function acted(ctx: ReadContext, org: EntityId, by: EntityId, text: string): LedgerEvent[] {
  if (by === org || orgTypeOf(ctx, org) === null) return [];
  return optionalService(ctx, "orgs.acted")?.(ctx, { org, by, power: "money.spend", text }) ?? [];
}

function projectArg(ctx: ReadContext, args: Args): Project | Rejection {
  const p = projectOf(ctx, strOf(args.project));
  return p ?? { code: "missing_entity", reason: `there's no project ${strOf(args.project) || "named"}` };
}

const isRejection = (v: unknown): v is Rejection => isRecord(v) && typeof v.code === "string" && typeof v.reason === "string";

/**
 * The project templates a world starts from: its own table, else the shipped one, so a world made
 * before projects existed starts them too. A start copies its template's steps into the project, so
 * a recorded chat never reads a template again.
 */
export function projectTemplates(ctx: Pick<ReadContext, "tables">): Readonly<Record<string, JsonObject>> {
  return ctx.tables.get(PROJECTS_TABLE)?.rows ?? (projectsTable as unknown as DataTable).rows;
}

/** A template of the world's projects table, or null. */
function templateRow(ctx: Pick<ReadContext, "tables">, id: string): JsonObject | null {
  const row = id === "" ? undefined : own(projectTemplates(ctx), id);
  return row && isRecord(row) ? row : null;
}

/**
 * `economy.project_start`: a planned project set going (`project`), or a new one of `org`'s from the
 * template `template` of the world's projects table (or the GM's own `steps`), named `name`, paying
 * from `account`: everything due as it starts done at once (its first steps' payments, a milestone's
 * unlocks), the rest left to the projects process.
 */
function startEffect(api: FinanceApi, args: Args, ctx: EffectContext): LedgerEvent[] | Rejection {
  const by = strOf(args.by);
  const at = ctx.state.clock;
  let spawn: LedgerEvent | null = null;
  let id: EntityId;
  let def: Pick<ProjectDef, "org" | "name" | "steps">;
  if (strOf(args.project) !== "") {
    const p = projectArg(ctx, args);
    if (isRejection(p)) return p;
    if (p.status !== "planned") return { code: "not_planned", reason: statusWords(p) };
    id = p.def.id;
    def = p.def;
  } else {
    const org = strOf(args.org);
    if (!own(ctx.state.entities, org) || isGone(ctx.state, org)) return { code: "missing_entity", reason: `there's no ${org || "party"} to run it` };
    const template = strOf(args.template);
    const row = templateRow(ctx, template);
    if (!row && !Array.isArray(args.steps)) return { code: "no_template", reason: template === "" ? "a new project needs a template" : `there's no project template ${template}` };
    const steps = stepsIn(Array.isArray(args.steps) ? args.steps : row?.steps);
    if (steps.length === 0) return { code: "no_steps", reason: "a project needs at least one step" };
    if (!stepOrder(steps)) return { code: "bad_steps", reason: "its steps wait on each other in a ring" };
    const name = strOf(args.name).trim().slice(0, PROJECT_LIMITS.name) || strOf(row?.name, "Project");
    const account = strOf(args.account);
    if (account !== "" && !api.accountsOf(ctx, org, "spend").includes(account)) return { code: "bad_account", reason: `${labelOf(ctx, account)} isn't ${labelOf(ctx, org)}'s to spend` };
    id = freeId(ctx, `project_${slug(org)}_${slug(name)}`);
    const payee = strOf(args.payee) || strOf(row?.payee);
    const fields: JsonObject = { org, ...(template !== "" && row ? { template } : {}), steps: steps as unknown as JsonValue, ...(account !== "" ? { account } : {}), ...(payee !== "" ? { payee } : {}), status: "planned" };
    spawn = { type: "spawn", entity: { id, kind: PROJECT_KIND, name, tier: "background", fields, relations: [] } };
    def = { org, name, steps };
  }
  if (ctx.levelOf(def.org, "money") < 3) return { code: "level", reason: "projects run from Money 3" };
  const open = projectIds(ctx.state, def.org).filter((x) => x !== id && isLive(projectOf(ctx, x)?.status ?? "done")).length;
  if (open >= OPEN_MAX) return { code: "too_many", reason: `${labelOf(ctx, def.org)} runs ${OPEN_MAX} projects at most at once` };
  const biggest = Math.max(0, ...def.steps.map((s) => Math.max(costParts(s).start, costParts(s).end)));
  const no = refusal(ctx, by, def.org, biggest);
  if (no) return no;
  const run = new Run(ctx);
  if (spawn && run.emit([spawn]).length === 0) return { code: "bad_project", reason: `${def.name} can't be set up` };
  if (run.emit([{ type: PROJECT_EVENTS.begin, data: { project: id, at } }]).length === 0) return { code: "bad_project", reason: `${def.name} can't start` };
  advance(api, run, [id], at, null);
  return [...run.out, ...acted(ctx, def.org, by, `Started ${def.name}`)];
}

/**
 * A project's own act, on a run that first does everything due on it by now, so a step whose end
 * came before the act (in the slot still to be stepped) ends then, not at the act: the run and the
 * project as it then stands, or why not.
 */
function caughtUp(api: FinanceApi, ctx: EffectContext, args: Args): { run: Run; p: Project } | Rejection {
  const first = projectArg(ctx, args);
  if (isRejection(first)) return first;
  const run = new Run(ctx);
  if (first.status === "active") advance(api, run, [first.def.id], ctx.state.clock, null);
  const p = projectOf(run.ctx, first.def.id);
  return p ? { run, p } : { code: "missing_entity", reason: `there's no project ${first.def.id}` };
}

/** `economy.project_pause`: a project under way paused now, each step's clock stopped with the work it had left. */
function pauseEffect(api: FinanceApi, args: Args, ctx: EffectContext): LedgerEvent[] | Rejection {
  const by = strOf(args.by);
  const found = caughtUp(api, ctx, args);
  if (isRejection(found)) return found;
  const { run, p } = found;
  if (p.status !== "active") return { code: "bad_status", reason: statusWords(p) };
  const no = refusal(ctx, by, p.def.org);
  if (no) return no;
  const cal = calendarOf(ctx.world);
  const at = ctx.state.clock;
  const left: JsonObject = {};
  for (const s of p.def.steps) {
    const r = p.run.steps[s.id];
    if (typeof r?.start === "number" && typeof r.end === "number" && doneAt(p, s) === null && !r.wait) left[s.id] = workBetween(cal, at, r.end, s.business_days !== undefined);
  }
  if (run.emit([{ type: PROJECT_EVENTS.pause, data: { project: p.def.id, at, left } }]).length === 0) return { code: "bad_status", reason: `${p.def.name} can't be paused` };
  return [...run.out, ...acted(ctx, p.def.org, by, `Paused ${p.def.name}`)];
}

/** `economy.project_resume`: a paused project going again now, each step under way ending its work left after now. */
function resumeEffect(api: FinanceApi, args: Args, ctx: EffectContext): LedgerEvent[] | Rejection {
  const p = projectArg(ctx, args);
  if (isRejection(p)) return p;
  if (p.status !== "paused") return { code: "bad_status", reason: statusWords(p) };
  const by = strOf(args.by);
  const no = refusal(ctx, by, p.def.org);
  if (no) return no;
  const cal = calendarOf(ctx.world);
  const at = ctx.state.clock;
  const ends: JsonObject = {};
  for (const s of p.def.steps) {
    const r = p.run.steps[s.id];
    if (typeof r?.left === "number") ends[s.id] = addWork(cal, at, r.left, s.business_days !== undefined);
  }
  const run = new Run(ctx);
  if (run.emit([{ type: PROJECT_EVENTS.resume, data: { project: p.def.id, at, ends } }]).length === 0) return { code: "bad_status", reason: `${p.def.name} can't resume` };
  advance(api, run, [p.def.id], at, null);
  return [...run.out, ...acted(ctx, p.def.org, by, `Resumed ${p.def.name}`)];
}

/** `economy.project_drop`: a project ended now, unfinished; what it paid stays paid, and what it made stays made; what it capitalized that nothing it made took is written off. */
function dropEffect(api: FinanceApi, args: Args, ctx: EffectContext): LedgerEvent[] | Rejection {
  const by = strOf(args.by);
  const found = caughtUp(api, ctx, args);
  if (isRejection(found)) return found;
  const { run, p } = found;
  if (!isLive(p.status)) return { code: "bad_status", reason: statusWords(p) };
  const no = refusal(ctx, by, p.def.org);
  if (no) return no;
  const why = strOf(args.text).trim();
  if (run.emit([{ type: PROJECT_EVENTS.drop, data: { project: p.def.id, at: ctx.state.clock } }]).length === 0) return { code: "bad_status", reason: `${p.def.name} can't be dropped` };
  return [...run.out, ...acted(ctx, p.def.org, by, `Dropped ${p.def.name}${why !== "" ? `: ${why}` : ""}`)];
}

/**
 * Why a note can't be made, or the step it is on: a live project's step not yet done (the one under
 * way when none is named, else the first not done); the story's within 30 days and the world's
 * narrated-price cap, the GM's within a year.
 */
export function noteProblem(ctx: ReadContext, a: JsonObject, source: "story" | "gm"): { project: Project; step: ProjectStep } | Rejection {
  const p = projectOf(ctx, strOf(a.project));
  if (!p) return { code: "missing_entity", reason: `there's no project ${strOf(a.project) || "named"}` };
  if (!isLive(p.status)) return { code: "bad_status", reason: statusWords(p) };
  const named = strOf(a.step);
  const open = p.def.steps.filter((s) => doneAt(p, s) === null);
  const step = named !== "" ? p.def.steps.find((s) => s.id === named || s.name.toLowerCase() === named.toLowerCase()) : (open.find((s) => typeof p.run.steps[s.id]?.start === "number") ?? open[0]);
  if (!step) return { code: "not_found", reason: named !== "" ? `${p.def.name} has no step ${named}` : `every step of ${p.def.name} is done` };
  if (doneAt(p, step) !== null) return { code: "done", reason: `${step.name} is done: a note sets back or adds to a step still to finish` };
  const days = a.days === undefined || a.days === null ? 0 : a.days;
  const cents = a.cents === undefined || a.cents === null ? 0 : a.cents;
  const maxDays = source === "story" ? PROJECT_LIMITS.noteDays : GM_NOTE_DAYS;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > maxDays) return { code: "bad_days", reason: `a note sets a step back by whole days, ${maxDays} at most` };
  const cap = unpricedCap(ctx.world);
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0 || (source === "story" && cents > cap)) return { code: "bad_amount", reason: `a note adds to a step's cost up to ${formatMoneyIn(ctx.world, cap)}, the world's narrated-price cap` };
  if (days === 0 && cents === 0) return { code: "bad_note", reason: "a note sets a step back or adds to its cost" };
  if (strOf(a.text).trim() === "") return { code: "bad_note", reason: "a note says why, in the story's words" };
  return { project: p, step };
}

/** `economy.project_note`: a step set back `days` or costing `cents` more, for the reason `text` (the story's, or the GM's). */
function noteEffect(api: FinanceApi, args: Args, ctx: EffectContext): LedgerEvent[] | Rejection {
  const source = args.source === "gm" ? "gm" : "story";
  const caught = caughtUp(api, ctx, args);
  if (isRejection(caught)) return caught;
  const { run } = caught;
  const found = noteProblem(run.ctx, args, source);
  if (isRejection(found)) return found;
  const { project: p, step: s } = found;
  const days = numOf(args.days);
  const cents = numOf(args.cents);
  const r = p.run.steps[s.id];
  const end = typeof r?.end === "number" && p.status === "active" ? addWork(calendarOf(ctx.world), r.end, days * MINUTES_PER_DAY, s.business_days !== undefined) : undefined;
  const text = strOf(args.text).trim().slice(0, NOTE_TEXT_MAX);
  const by = strOf(args.by);
  if (run.emit([{ type: PROJECT_EVENTS.note, data: { project: p.def.id, step: s.id, at: ctx.state.clock, days, cents, text, source, ...(end !== undefined ? { end } : {}) } }]).length === 0) return { code: "bad_note", reason: `${p.def.name} can't take the note` };
  return [...run.out, ...acted(ctx, p.def.org, by, `${p.def.name}: ${noteWords(ctx.world, s.name, days, cents)}`)];
}

// ---------------------------------------------------------------- the story's note

/** The reply's read's `project_note` (story tier): a step set back up to 30 days, or costing more up to the narrated-price cap, with its receipt and Undo. */
export const PROJECT_NOTE_CHANNEL: ProposalChannelDef = {
  type: PROJECT_NOTE,
  boundField: "money",
  validate: (p, ctx) => {
    const found = noteProblem(ctx, p, "story");
    return isRejection(found) ? found : null;
  },
  toEffects: (p, ctx) => {
    const found = noteProblem(ctx, p, "story");
    if (isRejection(found)) return [];
    return [{ type: PROJECT_EFFECTS.note, args: { project: found.project.def.id, step: found.step.id, days: numOf(p.days), cents: numOf(p.cents), text: strOf(p.text), source: "story" } }];
  },
};

// ---------------------------------------------------------------- reading it out

/** The days of work a step has done of its whole, while under way, business days counted as such. */
function dayOf(cal: Calendar, p: Project, s: ProjectStep, now: number): { day: number; of: number } | null {
  const r = p.run.steps[s.id];
  if (typeof r?.start !== "number" || doneAt(p, s) !== null) return null;
  const of = Math.max(1, stepDays(s) + (r.delay ?? 0));
  const business = s.business_days !== undefined;
  const whole = workOf(s, r);
  const left = typeof r.left === "number" ? r.left : typeof r.end === "number" ? workBetween(cal, Math.min(now, r.end), r.end, business) : whole;
  const done = Math.max(0, whole - left);
  return { day: Math.min(of, Math.floor(done / MINUTES_PER_DAY) + 1), of };
}

/** When each step is due to be done as things stand (no money short, no pause), or null once one waits or the project is paused. */
function dueEnds(cal: Calendar, p: Project, now: number): Map<string, number> | null {
  if (p.status !== "active" || p.started === null) return null;
  const order = stepOrder(p.def.steps);
  if (!order) return null;
  const ends = new Map<string, number>();
  for (const s of order) {
    const r = p.run.steps[s.id];
    const done = doneAt(p, s);
    if (done !== null) {
      ends.set(s.id, done);
      continue;
    }
    if (r?.wait) return null;
    if (typeof r?.start === "number") {
      ends.set(s.id, Math.max(now, r.end ?? now));
      continue;
    }
    let start = Math.max(now, p.started);
    for (const a of s.after ?? []) start = Math.max(start, ends.get(a) ?? start);
    ends.set(s.id, addWork(cal, start, workOf(s, r), s.business_days !== undefined));
  }
  return ends;
}

/** A name as `viewer` (null: the GM) may read it: "someone" for a person they can't see, "something" for anything else they can't. */
function seenName(ctx: ReadContext, viewer: EntityId | null, id: EntityId): string {
  if (!hiddenFrom(ctx, viewer, id)) return labelOf(ctx, id);
  return kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") ? "someone" : "something";
}

function unlockWords(ctx: ReadContext, u: ProjectUnlock, viewer: EntityId | null): string {
  if ("make" in u) return `Makes ${u.make.name}${u.make.life_months ? `, its cost depreciated over ${u.make.life_months % 12 === 0 ? `${u.make.life_months / 12} years` : `${u.make.life_months} months`} where that's on` : ""}`;
  if ("stream" in u) return `Starts ${u.name ?? "an income"}`;
  if ("flow" in u) return `Starts ${seenName(ctx, viewer, u.flow)}`;
  return `Sets ${u.set.entity === "org" ? "its" : u.set.entity === "made" ? "what it made:" : `${seenName(ctx, viewer, u.set.entity)}'s`} ${u.set.field}`;
}

function stepView(api: FinanceApi, ctx: ReadContext, p: Project, s: ProjectStep, now: number, viewer: EntityId | null): StepView {
  const cal = calendarOf(ctx.world);
  const r = p.run.steps[s.id];
  const day = dayOf(cal, p, s, now);
  const done = doneAt(p, s);
  const money = (c: number): string => api.money(ctx, c);
  return {
    id: s.id,
    name: s.name,
    state: stateOf(p, s),
    length: lengthWords(s),
    ...(day ? { day: day.day, of: day.of } : {}),
    ...(typeof r?.start === "number" ? { start: formatStamp(cal, r.start) } : {}),
    ...(typeof r?.end === "number" && done === null ? { end: formatStamp(cal, r.end) } : {}),
    ...(done !== null ? { done: formatStamp(cal, done) } : {}),
    cost: costOf(s, r),
    paid: r?.paid ?? 0,
    when: s.paid ?? "start",
    extra: r?.extra ?? 0,
    delay: r?.delay ?? 0,
    after: (s.after ?? []).flatMap((a) => {
      const dep = p.def.steps.find((x) => x.id === a);
      return dep ? [{ id: dep.id, name: dep.name }] : [];
    }),
    inputs: (s.inputs ?? []).map((i) => `${i.name}: ${i.qty.toLocaleString("en-US")}${i.unit ? ` ${i.unit}` : ""}${i.cents ? ` at ${money(i.cents)}` : ""}`),
    crew: s.crew ? [s.crew.size ? `${s.crew.size}${s.crew.role ? ` ${s.crew.role}` : " people"}` : (s.crew.role ?? ""), ...(s.crew.who ?? []).map((w) => seenName(ctx, viewer, w))].filter((x) => x !== "").join(", ") || null : null,
    unlocks: (s.unlocks ?? []).map((u) => unlockWords(ctx, u, viewer)),
    wait: r?.wait ? { cents: r.wait.cents, since: formatStamp(cal, r.wait.since), side: r.wait.side } : null,
    notes: (r?.notes ?? []).map((n) => ({ text: n.text, days: n.days, cents: n.cents, at: formatStamp(cal, n.at), source: n.source })),
  };
}

/** What the step under way, or the one waiting, says in a line: "Drilling: day 12 of 30", "Drilling: waiting for $12,000.00 to start". */
function nowWords(api: FinanceApi, ctx: ReadContext, p: Project, now: number): string | null {
  if (p.status === "planned") return "Not started";
  if (p.status === "active" && p.started !== null && p.started > now) return `Starts ${formatStamp(calendarOf(ctx.world), p.started)}`;
  if (!isLive(p.status)) return null;
  const cal = calendarOf(ctx.world);
  const waiting = p.def.steps.find((s) => p.run.steps[s.id]?.wait && doneAt(p, s) === null);
  const w = waiting ? p.run.steps[waiting.id]?.wait : undefined;
  if (waiting && w) return `${waiting.name}: waiting for ${api.money(ctx, w.cents)} to ${w.side === "end" ? "finish" : "start"}`;
  const running = p.def.steps.filter((s) => stateOf(p, s) === "running" || stateOf(p, s) === "paused");
  const lines = running.map((s) => {
    const d = dayOf(cal, p, s, now);
    return d ? `${s.name}: day ${d.day} of ${d.of}${s.business_days !== undefined ? " (business days)" : ""}` : s.name;
  });
  if (lines.length > 0) return `${p.status === "paused" ? "Paused: " : ""}${lines.join("; ")}`;
  return p.status === "paused" ? "Paused" : null;
}

/** May `viewer` (null: the GM) run the party's projects? */
function mayRun(ctx: ReadContext, viewer: EntityId | null, org: EntityId): boolean {
  return viewer === null || viewer === org || mayAct(ctx, viewer, org, "money.spend").ok;
}

export function projectView(api: FinanceApi, ctx: ReadContext, p: Project, viewer: EntityId | null): ProjectView {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const steps = p.def.steps.map((s) => stepView(api, ctx, p, s, now, viewer));
  const cost = steps.reduce((n, s) => n + s.cost, 0);
  const paid = steps.reduce((n, s) => n + s.paid, 0);
  const ends = dueEnds(cal, p, now);
  const due = ends && ends.size > 0 ? Math.max(...ends.values()) : null;
  const can = mayRun(ctx, viewer, p.def.org);
  const account = p.def.account ?? api.depositAccount(ctx, p.def.org);
  return {
    id: p.def.id,
    name: p.def.name,
    template: p.def.template ?? null,
    status: p.status,
    statusWords: PROJECT_STATUS_WORDS[p.status],
    start: p.started !== null ? formatStamp(cal, p.started) : null,
    ended: typeof p.run.ended === "number" ? formatStamp(cal, p.run.ended) : null,
    account: account ? { id: account, name: labelOf(ctx, account) } : null,
    cost,
    paid,
    left: Math.max(0, cost - paid),
    steps,
    progress: { done: steps.filter((s) => s.state === "done").length, total: steps.length },
    now: nowWords(api, ctx, p, now),
    due: due !== null && p.status === "active" ? formatStamp(cal, due) : null,
    made: (p.run.made ?? []).filter((m) => own(ctx.state.entities, m)).map((m) => ({ id: m, name: labelOf(ctx, m) })),
    can: { start: can && p.status === "planned", pause: can && p.status === "active", resume: can && p.status === "paused", drop: can && isLive(p.status) },
  };
}

function band(v: JsonValue | undefined): { min: number; typical: number; max: number } {
  const b = objOf(v);
  return { min: numOf(b.min), typical: numOf(b.typical), max: numOf(b.max) };
}

/** The world's project templates, as a page offers them to `viewer` (null: the GM). */
export function templateViews(ctx: ReadContext, viewer: EntityId | null): ProjectTemplateView[] {
  const rows = projectTemplates(ctx);
  return Object.entries(rows)
    .map(([id, row]) => {
      const steps = stepsIn(row.steps);
      return { id, name: strOf(row.name, id), description: strOf(row.description), days: band(row.days), cost: band(row.cost_cents), steps: steps.length, unlocks: steps.flatMap((s) => (s.unlocks ?? []).map((u) => unlockWords(ctx, u, viewer))) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** An organization's Projects section (`r.orgSection`): its projects and what the reader may do; null where it has none to show. */
export function buildProjectsView(api: FinanceApi, ctx: ReadContext, org: EntityId, viewer: EntityId | null): ProjectsView | null {
  const type = orgTypeOf(ctx, org);
  if (type === null || type === "household" || type === "party" || isGone(ctx.state, org)) return null;
  const runs = ctx.levelOf(org, "money") >= 3;
  const all = projectIds(ctx.state, org).flatMap((id) => projectOf(ctx, id) ?? []);
  const canStart = runs && mayRun(ctx, viewer, org);
  if (all.length === 0 && !canStart) return null;
  const views = all.map((p) => projectView(api, ctx, p, viewer));
  const endedAt = (p: Project): number => (typeof p.run.ended === "number" ? p.run.ended : 0);
  const over = all
    .filter((p) => !isLive(p.status))
    .sort((a, b) => endedAt(b) - endedAt(a) || a.def.id.localeCompare(b.def.id))
    .slice(0, PROJECT_LIMITS.recent)
    .flatMap((p) => views.find((v) => v.id === p.def.id) ?? []);
  return {
    org,
    runs,
    canStart,
    projects: views.filter((v) => isLive(v.status)),
    over,
    templates: canStart ? templateViews(ctx, viewer) : [],
    accounts: canStart ? api.accountsOf(ctx, org, "spend").map((id) => ({ id, name: labelOf(ctx, id) })) : [],
  };
}

/** Who a project's progress is told to: the player character, where the party is theirs, they belong to it, or they see its money. */
function povFollows(ctx: ReadContext, org: EntityId): boolean {
  const pov = ctx.world.pov;
  if (pov === org) return true;
  if (orgTypeOf(ctx, org) === null) return false;
  return membersOfOrg(ctx, org).some((m) => m.who === pov) || mayAct(ctx, pov, org, "money.view").ok;
}

/**
 * The narrator's Quest section (source `projects`): each project under way or paused the player
 * character follows, where it stands ("Drilling: day 12 of 30"), and the latitude: progress only as
 * time covers it, and never a step done, started or dropped by the story.
 */
export function projectNarratorLines(api: FinanceApi, ctx: ReadContext): string[] {
  const out: string[] = [];
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  for (const id of projectIds(ctx.state)) {
    const p = projectOf(ctx, id);
    if (!p || (p.status !== "active" && p.status !== "paused") || !povFollows(ctx, p.def.org)) continue;
    const whose = p.def.org === ctx.world.pov ? "Your" : `${labelOf(ctx, p.def.org)}'s`;
    const done = p.def.steps.filter((s) => doneAt(p, s) !== null).length;
    const ends = dueEnds(cal, p, now);
    const last = ends && ends.size > 0 ? Math.max(...ends.values()) : null;
    const next = p.def.steps.find((s) => stateOf(p, s) === "ready" || stateOf(p, s) === "pending");
    out.push(`${whose} ${p.def.name}: ${nowWords(api, ctx, p, now) ?? PROJECT_STATUS_WORDS[p.status]}; ${done} of ${p.def.steps.length} steps done${next ? `; next: ${next.name}` : ""}${last !== null ? `; due to be done ${dayText(cal, last)}` : ""}.`);
  }
  if (out.length === 0) return [];
  out.push("The engine runs each project day by day: tell its progress only as the time that passes covers, never say a step is done before its day, and never start, finish or drop one yourself. A setback or an extra cost the story makes is noted with project_note.");
  return out;
}

// ---------------------------------------------------------------- lint

/** A project entity's problems in the world: its party, its steps (unreadable, unknown or circular `after`), its unlocks and template. */
export function lintProjects(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const tables = world.tables[PROJECTS_TABLE]?.rows ?? (projectsTable as unknown as DataTable).rows;
  for (const [id, e] of Object.entries(world.entities)) {
    if (e.kind !== PROJECT_KIND) continue;
    const path = `entities.${id}`;
    const f = e.fields;
    const org = strOf(f.org);
    if (org === "" || !own(world.entities, org)) issues.push({ severity: "error", code: "economy.project_org", message: `${e.name} names no party that runs it${org !== "" ? ` (there's no ${org})` : ""}.`, path: `${path}.fields.org` });
    const raw = Array.isArray(f.steps) ? f.steps : [];
    const steps = stepsIn(f.steps);
    if (steps.length === 0) issues.push({ severity: "error", code: "economy.project_steps", message: `${e.name} has no steps it can run.`, path: `${path}.fields.steps` });
    else if (steps.length < raw.length) issues.push({ severity: "warning", code: "economy.project_steps", message: `${raw.length - steps.length} of ${e.name}'s steps don't read (each needs an id, a name, whole days or business days, not both) or repeat an id; they're left out.`, path: `${path}.fields.steps` });
    const ids = new Set(steps.map((s) => s.id));
    for (const s of steps) for (const a of s.after ?? []) if (!ids.has(a)) issues.push({ severity: "warning", code: "economy.project_after", message: `${e.name}: ${s.name} comes after "${a}", which isn't one of its steps; it doesn't wait for it.`, path: `${path}.fields.steps` });
    if (steps.length > 0 && !stepOrder(steps)) issues.push({ severity: "error", code: "economy.project_ring", message: `${e.name}'s steps wait on each other in a ring, so none of them can start.`, path: `${path}.fields.steps` });
    const making = steps.some((s) => (s.unlocks ?? []).some((u) => "make" in u));
    if (!making && steps.some((s) => s.capitalize === true)) issues.push({ severity: "info", code: "economy.project_capitalize", message: `${e.name} capitalizes steps but makes nothing, so their costs are expensed.`, path: `${path}.fields.steps` });
    for (const s of steps)
      for (const u of s.unlocks ?? []) {
        if ("flow" in u && own(world.entities, u.flow)?.kind !== "flow") issues.push({ severity: "warning", code: "economy.project_unlock", message: `${e.name}: ${s.name} starts the flow ${u.flow}, which the world doesn't have.`, path: `${path}.fields.steps` });
        if ("set" in u && u.set.entity !== "org" && u.set.entity !== "made" && !own(world.entities, u.set.entity)) issues.push({ severity: "warning", code: "economy.project_unlock", message: `${e.name}: ${s.name} sets a field of ${u.set.entity}, which the world doesn't have.`, path: `${path}.fields.steps` });
      }
    const template = strOf(f.template);
    if (template !== "" && !own(tables, template)) issues.push({ severity: "info", code: "economy.project_template", message: `${e.name} names the template ${template}, which the world's project templates don't have; its own steps run.`, path: `${path}.fields.template` });
  }
  return issues;
}

// ---------------------------------------------------------------- registration

const PROJECT_FIELDS: Record<string, FieldDef> = {
  org: { type: "ref", label: "Whose project (the organization or person that runs and pays for it)", domain: "money", level: 3 },
  template: { type: "text", label: "Template", table: PROJECTS_TABLE, domain: "money", level: 3 },
  steps: { type: "list", label: "Steps ({id, name, days or business_days, cost, paid: start, end or split, after, inputs, crew, capitalize, unlocks, done})", domain: "money", level: 3 },
  account: { type: "ref", ref: "account", label: "Paid from (its party's operating account when left out)", domain: "money", level: 3 },
  payee: { type: "text", label: "Paid to (Contractors when left out)", domain: "money", level: 3 },
  start: { type: "date", label: "Starts (as the story begins when left out)", domain: "money", level: 3 },
  status: { type: "enum", label: "Status", values: ["planned", "active"], default: "planned", domain: "money", level: 3 },
};

/** The field a made asset names its project by; B5's depreciation fields (`capital_cost`, `life_months`, `in_service`, `salvage`) beside it. */
const BUILT_BY: Record<string, FieldDef> = { built_by: { type: "ref", ref: PROJECT_KIND, label: "Built by the project", domain: "money", level: 3 } };

const TABLE = projectsTable as unknown as DataTable;
const SHIPPED = shipped as unknown as Readonly<Record<string, readonly ShippedRevision[]>>;

const PROJECT_PARAM: ParamDef = { type: "ref", of: { kind: [PROJECT_KIND] }, label: "Project" };
const AT_ONCE = { duration: "2", observable: "does the paperwork", mechanical: true } as const;

const ACTIONS: readonly ActionDef[] = [
  {
    id: PROJECT_ACTIONS.start,
    label: "Start a project",
    description: "Start a production project for an organization: from one of the world's templates (a well, a foundry, a building, a farm season), or a planned one. Its steps run day by day and pay from its account; what it builds comes in as each is done.",
    pack: "economy",
    params: { org: { type: "ref", label: "Organization" }, template: { type: "text", optional: true, label: "Template" }, project: { ...PROJECT_PARAM, optional: true }, name: { type: "text", optional: true, label: "Name" }, account: { type: "ref", ref: "account", optional: true, label: "Pay from" } },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: PROJECT_EFFECTS.start, args: { org: "org", template: "=params.template", project: "=params.project", name: "=params.name", account: "=params.account", by: "self" } }] },
    ...AT_ONCE,
    lexicon: ["start a project", "drill a well", "build a foundry", "put up a building", "plant the crop"],
  },
  {
    id: PROJECT_ACTIONS.pause,
    label: "Pause a project",
    description: "Pause a project under way: its steps stop where they are and keep the work they have left.",
    pack: "economy",
    params: { project: PROJECT_PARAM },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: PROJECT_EFFECTS.pause, args: { project: "project", by: "self" } }] },
    ...AT_ONCE,
    lexicon: ["pause the project", "halt work", "stop drilling"],
  },
  {
    id: PROJECT_ACTIONS.resume,
    label: "Resume a project",
    description: "Set a paused project going again: each step under way finishes the work it had left.",
    pack: "economy",
    params: { project: PROJECT_PARAM },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: PROJECT_EFFECTS.resume, args: { project: "project", by: "self" } }] },
    ...AT_ONCE,
    lexicon: ["resume the project", "restart work"],
  },
  {
    id: PROJECT_ACTIONS.drop,
    label: "Drop a project",
    description: "Give up a project: nothing more is paid or done; what it paid stays paid and what it made stays.",
    pack: "economy",
    params: { project: PROJECT_PARAM },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: PROJECT_EFFECTS.drop, args: { project: "project", by: "self" } }] },
    ...AT_ONCE,
    lexicon: ["drop the project", "abandon the well", "cancel the build"],
  },
];

/** Projects: the `project` kind, its events, effects, actions, process, the Projects section, its alerts, the story's note and the templates table. */
export function registerProjects(r: FinanceRegistry): void {
  const { api, core } = r;
  core.kind({ id: PROJECT_KIND, label: "Project", pack: "economy", fields: PROJECT_FIELDS });
  r.fields("property", BUILT_BY);
  core.table({ id: PROJECTS_TABLE, schema: TABLE.schema, columns: TABLE.columns, defaults: TABLE, shipped: SHIPPED[PROJECTS_TABLE] ?? [] });
  for (const def of PROJECT_EVENT_DEFS) core.event(def);
  core.effect({ type: PROJECT_EFFECTS.start, args: ["org?", "template?", "project?", "name?", "account?", "payee?", "steps?", "by?"], gm: true, resolve: (a, ctx) => startEffect(api, a, ctx) });
  core.effect({ type: PROJECT_EFFECTS.pause, args: ["project", "org?", "by?"], gm: true, resolve: (a, ctx) => pauseEffect(api, a, ctx) });
  core.effect({ type: PROJECT_EFFECTS.resume, args: ["project", "org?", "by?"], gm: true, resolve: (a, ctx) => resumeEffect(api, a, ctx) });
  core.effect({ type: PROJECT_EFFECTS.drop, args: ["project", "org?", "text?", "by?"], gm: true, resolve: (a, ctx) => dropEffect(api, a, ctx) });
  core.effect({ type: PROJECT_EFFECTS.note, args: ["project", "org?", "step?", "days?", "cents?", "text", "source?", "by?"], gm: true, resolve: (a, ctx) => noteEffect(api, a, ctx) });
  for (const def of ACTIONS) core.action(def);
  core.process({ id: "economy.projects", domain: "money", minLevel: 3, step: (slot, ctx) => stepProjects(api, slot, ctx) });
  core.proposal(PROJECT_NOTE_CHANNEL);
  core.orgSection({ id: PROJECTS_SECTION, label: "Projects", power: "money.view", build: (ctx, org, viewer) => buildProjectsView(api, ctx, org, viewer) as unknown as JsonValue | null });
  core.renderer({ slot: "quest", source: "projects", label: "Projects under way", render: (ctx) => projectNarratorLines(api, ctx) });
  core.lint({ code: "economy.projects", check: (world) => lintProjects(world) });
  r.view((ctx, party) => {
    const alerts: { tone: "warn"; text: string; account?: EntityId }[] = [];
    const upcoming: { at: string; clock: number; label: string; cents: number; flow: null; account: EntityId | null }[] = [];
    const cal = calendarOf(ctx.world);
    for (const id of projectIds(ctx.state, party)) {
      const p = projectOf(ctx, id);
      if (!p || !isLive(p.status)) continue;
      const account = payingAccount(api, ctx, p.def);
      for (const s of p.def.steps) {
        const st = p.run.steps[s.id];
        if (doneAt(p, s) !== null) continue;
        if (st?.wait) alerts.push({ tone: "warn", text: `${p.def.name}: ${s.name} is waiting for ${api.money(ctx, st.wait.cents)} to ${st.wait.side === "end" ? "finish" : "start"}`, ...(account ? { account } : {}) });
        else if (p.status === "active" && typeof st?.start === "number" && typeof st.end === "number") {
          const cents = costParts(s).end + (st.extra ?? 0);
          if (cents > 0) upcoming.push({ at: dayText(cal, st.end), clock: st.end, label: `${p.def.name}: ${s.name} (${COST_WHEN_WORDS[s.paid ?? "start"]})`, cents: -cents, flow: null, account });
        }
      }
    }
    return { alerts, upcoming };
  });
}
