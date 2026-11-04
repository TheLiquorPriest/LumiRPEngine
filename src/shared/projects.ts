// Production projects (DESIGN §26.5, Money 3): a party's plan of steps toward something that pays,
// such as a well drilled, a foundry built or a season farmed. A project is a `project` entity (its
// definition: whose it is, its steps, the account it pays from); what has happened to it is the
// economy slice's `projects` record, kept by the `economy.project_*` events. A step takes days or
// business days, costs an amount paid at its start, at its end or half at each, waits for the steps
// it comes `after`, and may list its inputs and crew; on its completion its unlocks start a stream (a
// flow), make a thing or set a field. The shared shapes, their reading, and the words for them. Pure.

import type { EntityId } from "./ids";
import { isRecord, type JsonObject, type JsonValue } from "./json";

export const PROJECT_KIND = "project";
/** The organization page's section the Projects tab draws (`r.orgSection`). */
export const PROJECTS_SECTION = "projects";
/** The economy's table of project templates. */
export const PROJECTS_TABLE = "economy.projects";
/** The reply's read's change type for a delay or an extra cost the story tells (`project_note`). */
export const PROJECT_NOTE = "project_note";

export const PROJECT_EVENTS = {
  begin: "economy.project_begin",
  step: "economy.project_step",
  pause: "economy.project_pause",
  resume: "economy.project_resume",
  drop: "economy.project_drop",
  note: "economy.project_note",
} as const;

export const PROJECT_EFFECTS = {
  start: "economy.project_start",
  pause: "economy.project_pause",
  resume: "economy.project_resume",
  drop: "economy.project_drop",
  note: "economy.project_note",
} as const;

/** The actions a party takes on its projects, each at once off screen (A1's route, group business). */
export const PROJECT_ACTIONS = { start: "project_start", pause: "project_pause", resume: "project_resume", drop: "project_drop" } as const;

/** What each project act is, as an organization's History line opens: "Started a project: Oil well". */
export const PROJECT_ACT_WORDS: Readonly<Record<"start" | "pause" | "resume" | "drop" | "note", string>> = { start: "Started a project", pause: "Paused a project", resume: "Resumed a project", drop: "Dropped a project", note: "Noted a project's setback" };

export const PROJECT_LIMITS = {
  /** Steps a project holds at most. */
  steps: 40,
  /** Unlocks a step holds at most. */
  unlocks: 8,
  /** Inputs a step lists at most. */
  inputs: 20,
  /** The longest a name runs. */
  name: 80,
  /** The longest one step lasts, in days. */
  days: 3650,
  /** The most a story note delays a step, in days. */
  noteDays: 30,
  /** Notes kept on a step. */
  notes: 12,
  /** The projects the page lists that are over (done or dropped), newest first. */
  recent: 10,
} as const;

export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "dropped"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const isProjectStatus = (v: unknown): v is ProjectStatus => typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);

export const PROJECT_STATUS_WORDS: Readonly<Record<ProjectStatus, string>> = { planned: "Not started", active: "Under way", paused: "Paused", done: "Done", dropped: "Dropped" };

/** When a step's cost is paid: as it starts, as it ends, or half at each (the odd cent at the end). */
export const COST_WHEN = ["start", "end", "split"] as const;
export type CostWhen = (typeof COST_WHEN)[number];
export const COST_WHEN_WORDS: Readonly<Record<CostWhen, string>> = { start: "paid as it starts", end: "paid when it's done", split: "half as it starts, half when it's done" };

/** One thing a step uses up: so many of it, at so much each (minor units), which adds to the step's cost. */
export interface StepInput {
  name: string;
  qty: number;
  unit?: string;
  cents?: number;
}

/** Who works a step: how many, as what, and the world's people among them. */
export interface StepCrew {
  size?: number;
  role?: string;
  who?: EntityId[];
}

/**
 * What a step's completion brings about:
 * - `stream`: a new standing income, a `flow` entity's fields (B3's `revenue` model among them),
 *   running from the completion date, paid to the project's party unless it says, and linked to the
 *   thing the project made when it made one;
 * - `flow`: one of the world's flows, set going from the completion date;
 * - `make`: a new thing, a `property` unless it says: its name and fields, its useful life in months
 *   and salvage value for depreciation, and its value (`cost`: what its building cost, the default);
 * - `set`: one field of an entity (`org` for the project's party, `made` for what it made) to a value.
 */
export type ProjectUnlock =
  | { stream: JsonObject; name?: string }
  | { flow: EntityId }
  | { make: { name: string; kind?: string; fields?: JsonObject; life_months?: number; salvage?: number; value?: number | "cost" } }
  | { set: { entity: string; field: string; value: JsonValue } };

export interface ProjectStep {
  id: string;
  name: string;
  /** Calendar days it lasts (0: a milestone, done as it starts); `business_days` counts only business days. */
  days?: number;
  business_days?: number;
  /** What it costs, minor units, its inputs' cost on top. */
  cost?: number;
  paid?: CostWhen;
  /** The steps it waits for, by id. */
  after?: string[];
  inputs?: StepInput[];
  crew?: StepCrew;
  /** Its cost builds the thing the project makes: booked as capital spending where its party depreciates (B5), and part of what that thing is worth. */
  capitalize?: boolean;
  unlocks?: ProjectUnlock[];
  /** Authored: done before the story began (nothing paid, nothing unlocked). */
  done?: boolean;
}

/** A project's definition, as its entity's fields hold it. */
export interface ProjectDef {
  id: EntityId;
  name: string;
  /** Whose it is: the organization (or person) that runs it and pays for it. */
  org: EntityId;
  template?: string;
  steps: ProjectStep[];
  /** The account its costs come from; absent, its party's operating or deposit account. */
  account?: EntityId;
  /** Who its costs are paid to (an outside payee's name); absent, "Contractors". */
  payee?: string;
  /** Authored: when it starts, `YYYY-MM-DD` (09:00) or `YYYY-MM-DDTHH:MM`; an `active` project with none starts as the story begins. */
  start?: string;
  /** Authored: `planned` (not started) or `active`. */
  status: ProjectStatus;
}

/** A story note on a step: days it is set back, and what it costs on top (minor units), in the story's words. */
export interface StepNote {
  text: string;
  days: number;
  cents: number;
  at: number;
  source: "story" | "gm";
}

/** What has happened to one step (the economy slice). */
export interface StepRun {
  /** The instant it started, and its end as scheduled now (pauses and delays move it). */
  start?: number;
  end?: number;
  /** The instant it was done. */
  done?: number;
  /** What it has paid so far, and what of that built the made thing (`capitalize`) and was booked as capital spending. */
  paid?: number;
  built?: number;
  capex?: number;
  /** It couldn't pay: since when, how much, and for which end of it. */
  wait?: { since: number; cents: number; side: "start" | "end" };
  /** While paused: the work minutes it had left. */
  left?: number;
  /** Story notes: the days added and the cost on top, in all. */
  delay?: number;
  extra?: number;
  notes?: StepNote[];
}

/** What has happened to one project (the economy slice), over its entity's definition. */
export interface ProjectRun {
  status?: ProjectStatus;
  started?: number;
  ended?: number;
  /** Paused since. */
  paused?: number;
  steps: Record<string, StepRun>;
  /** What its capitalized steps paid that no made thing has taken yet: in all, and as capital spending. */
  built?: number;
  capex?: number;
  /** What it made, by id. */
  made?: EntityId[];
}

// ---------------------------------------------------------------- reading

const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");

/** A step id: lower-snake letters, digits and underscores, up to 40. */
export const STEP_ID = /^[a-z0-9][a-z0-9_]{0,39}$/;

function inputIn(v: JsonValue): StepInput | null {
  if (!isRecord(v)) return null;
  const name = str(v.name);
  const qty = num(v.qty) ?? 1;
  if (name === "" || !(qty > 0)) return null;
  const cents = num(v.cents);
  return { name: name.slice(0, PROJECT_LIMITS.name), qty, ...(str(v.unit) !== "" ? { unit: str(v.unit) } : {}), ...(cents !== undefined && cents >= 0 ? { cents: Math.round(cents) } : {}) };
}

function crewIn(v: JsonValue | undefined): StepCrew | undefined {
  if (!isRecord(v)) return undefined;
  const size = num(v.size);
  const who = Array.isArray(v.who) ? [...new Set(v.who.filter((x): x is string => typeof x === "string" && x !== ""))] : [];
  const crew: StepCrew = { ...(size !== undefined && size >= 0 ? { size: Math.round(size) } : {}), ...(str(v.role) !== "" ? { role: str(v.role) } : {}), ...(who.length > 0 ? { who } : {}) };
  return Object.keys(crew).length > 0 ? crew : undefined;
}

/** One unlock as written, or null when it isn't one. */
export function unlockIn(v: JsonValue): ProjectUnlock | null {
  if (!isRecord(v)) return null;
  if (isRecord(v.stream)) return { stream: v.stream, ...(str(v.name) !== "" ? { name: str(v.name) } : {}) };
  if (str(v.flow) !== "") return { flow: str(v.flow) };
  if (isRecord(v.make)) {
    const m = v.make;
    const name = str(m.name);
    if (name === "") return null;
    const life = num(m.life_months);
    const salvage = num(m.salvage);
    const value = m.value === "cost" ? "cost" : num(m.value);
    return { make: { name: name.slice(0, PROJECT_LIMITS.name), ...(str(m.kind) !== "" ? { kind: str(m.kind) } : {}), ...(isRecord(m.fields) ? { fields: m.fields } : {}), ...(life !== undefined && life >= 1 ? { life_months: Math.round(life) } : {}), ...(salvage !== undefined && salvage >= 0 ? { salvage: Math.round(salvage) } : {}), ...(value !== undefined ? { value: value === "cost" ? "cost" : Math.max(0, Math.round(value)) } : {}) } };
  }
  if (isRecord(v.set)) {
    const s = v.set;
    if (str(s.entity) === "" || str(s.field) === "" || !("value" in s)) return null;
    return { set: { entity: str(s.entity), field: str(s.field), value: s.value ?? null } };
  }
  return null;
}

/** One step as written, or null when it isn't one (no id or name, or a length that isn't a whole number of days). */
export function stepIn(v: JsonValue): ProjectStep | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const name = str(v.name) || id;
  if (!STEP_ID.test(id) || name === "") return null;
  const days = num(v.days);
  const business = num(v.business_days);
  const whole = (n: number | undefined): boolean => n === undefined || (Number.isInteger(n) && n >= 0 && n <= PROJECT_LIMITS.days);
  if (!whole(days) || !whole(business) || (days !== undefined && business !== undefined)) return null;
  const cost = num(v.cost);
  const paid = typeof v.paid === "string" && (COST_WHEN as readonly string[]).includes(v.paid) ? (v.paid as CostWhen) : undefined;
  const after = Array.isArray(v.after) ? [...new Set(v.after.filter((x): x is string => typeof x === "string" && x !== "" && x !== id))] : [];
  const inputs = Array.isArray(v.inputs) ? v.inputs.flatMap((x) => inputIn(x) ?? []).slice(0, PROJECT_LIMITS.inputs) : [];
  const unlocks = Array.isArray(v.unlocks) ? v.unlocks.flatMap((x) => unlockIn(x) ?? []).slice(0, PROJECT_LIMITS.unlocks) : [];
  const crew = crewIn(v.crew);
  return {
    id,
    name: name.slice(0, PROJECT_LIMITS.name),
    ...(business !== undefined ? { business_days: business } : { days: days ?? 0 }),
    ...(cost !== undefined && cost > 0 ? { cost: Math.round(cost) } : {}),
    ...(paid !== undefined ? { paid } : {}),
    ...(after.length > 0 ? { after } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
    ...(crew ? { crew } : {}),
    ...(v.capitalize === true ? { capitalize: true } : {}),
    ...(unlocks.length > 0 ? { unlocks } : {}),
    ...(v.done === true ? { done: true } : {}),
  };
}

/** A project's steps as its `steps` field holds them, each one that reads, the first of each id. */
export function stepsIn(v: JsonValue | undefined): ProjectStep[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: ProjectStep[] = [];
  for (const raw of v) {
    const s = stepIn(raw);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= PROJECT_LIMITS.steps) break;
  }
  return out;
}

/** A step's cost in all: its own and its inputs', minor units. */
export function stepCost(step: ProjectStep): number {
  return (step.cost ?? 0) + (step.inputs ?? []).reduce((sum, i) => sum + Math.round(i.qty * (i.cents ?? 0)), 0);
}

/** What a step pays as it starts and as it ends, of a cost of `cents` (a note's extra cost is paid at the end). */
export function costParts(step: ProjectStep, cents = stepCost(step)): { start: number; end: number } {
  const when = step.paid ?? "start";
  if (when === "end") return { start: 0, end: cents };
  if (when === "split") return { start: Math.floor(cents / 2), end: cents - Math.floor(cents / 2) };
  return { start: cents, end: 0 };
}

/** How long a step lasts, in words: "30 days", "10 business days", "a milestone". */
export function lengthWords(step: Pick<ProjectStep, "days" | "business_days">): string {
  if (step.business_days !== undefined) return step.business_days === 1 ? "1 business day" : `${step.business_days} business days`;
  const d = step.days ?? 0;
  return d === 0 ? "a milestone" : d === 1 ? "1 day" : `${d} days`;
}

/** A step's length in days, either kind. */
export function stepDays(step: Pick<ProjectStep, "days" | "business_days">): number {
  return step.business_days ?? step.days ?? 0;
}

/**
 * The steps in an order their dependencies allow (each after the steps it waits for), the authored
 * order kept where they allow it; null when they wait on each other in a ring. A dependency on a
 * step the project doesn't have is left out (lint names it).
 */
export function stepOrder(steps: readonly ProjectStep[]): ProjectStep[] | null {
  const ids = new Set(steps.map((s) => s.id));
  const done = new Set<string>();
  const out: ProjectStep[] = [];
  while (out.length < steps.length) {
    const next = steps.find((s) => !done.has(s.id) && (s.after ?? []).every((a) => !ids.has(a) || done.has(a)));
    if (!next) return null;
    done.add(next.id);
    out.push(next);
  }
  return out;
}

// ---------------------------------------------------------------- the page (`OrgView.sections.projects`)

export type StepState = "pending" | "ready" | "waiting" | "running" | "paused" | "done";

export const STEP_STATE_WORDS: Readonly<Record<StepState, string>> = { pending: "Waiting on earlier steps", ready: "Starts next", waiting: "Waiting for money", running: "Under way", paused: "Paused", done: "Done" };

export interface StepView {
  id: string;
  name: string;
  state: StepState;
  /** "30 days", "10 business days", "a milestone". */
  length: string;
  /** While under way: the day it is on, of how many (business days counted as such). */
  day?: number;
  of?: number;
  /** Local stamps: when it started and when it ends (as scheduled), or when it was done. */
  start?: string;
  end?: string;
  done?: string;
  cost: number;
  paid: number;
  when: CostWhen;
  extra: number;
  delay: number;
  after: { id: string; name: string }[];
  inputs: string[];
  crew: string | null;
  unlocks: string[];
  wait: { cents: number; since: string; side: "start" | "end" } | null;
  notes: { text: string; days: number; cents: number; at: string; source: "story" | "gm" }[];
}

export interface ProjectView {
  id: EntityId;
  name: string;
  template: string | null;
  status: ProjectStatus;
  statusWords: string;
  start: string | null;
  ended: string | null;
  account: { id: EntityId; name: string } | null;
  /** Minor units: what it costs in all (story notes included), what it has paid, and what is left. */
  cost: number;
  paid: number;
  left: number;
  steps: StepView[];
  /** Steps done, of all. */
  progress: { done: number; total: number };
  /** The step under way (the first, when several are), in words: "Drilling: day 12 of 30". */
  now: string | null;
  /** When the last step is due to end as things stand, a local stamp; null when it can't be said (waiting, paused). */
  due: string | null;
  made: { id: EntityId; name: string }[];
  /** What the reader may do to it: pause, resume, drop (and start, when it is planned). */
  can: { start: boolean; pause: boolean; resume: boolean; drop: boolean };
}

export interface ProjectTemplateView {
  id: string;
  name: string;
  description: string;
  /** In days, and minor units, as the template's bands give them. */
  days: { min: number; typical: number; max: number };
  cost: { min: number; typical: number; max: number };
  steps: number;
  unlocks: string[];
}

export interface ProjectsView {
  org: EntityId;
  /** Whether projects run there: Money 3 or more. */
  runs: boolean;
  /** The reader may start a project there (spend its money). */
  canStart: boolean;
  projects: ProjectView[];
  /** Done and dropped, newest first, up to `PROJECT_LIMITS.recent`. */
  over: ProjectView[];
  templates: ProjectTemplateView[];
  /** The accounts a project there may pay from. */
  accounts: { id: EntityId; name: string }[];
}

/** The page's section as the orgs view hands it over, or null where it holds none. */
export function projectsViewIn(v: unknown): ProjectsView | null {
  return isRecord(v) && typeof v.org === "string" && Array.isArray(v.projects) && Array.isArray(v.templates) ? (v as unknown as ProjectsView) : null;
}
