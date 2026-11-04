// An organization's editors as plain data (ORG-SPEC §4.4, §4.6, §6.1): where each opens (the
// `org_edit` sheet: a member's sheet, Hire someone, Admit a member, a position, a delegation, its
// dues), which of them the reader may use, by the powers they hold there (GM → Orgs, whose page
// holds the GM's part, every one), and what each sends: the reader's action, which the engine
// judges again in its own words (a scope, a limit, the self-dealing guard), or the GM's edit. The
// forms' drafts, their problems and the requests they make are here, so the forms only lay them out.
// Pure.

import type { SheetRoute } from "../../../frontend/app";
import { FINANCE_ACTIONS, UNPAID } from "../../../shared/finance";
import type { JsonObject } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../../../shared/money";
import { DUES_EVERY, ORG_ACTIONS, ORG_POWERS, positionIdOf, powerCovers, type OrgPower, type Position, type PositionScope } from "../../../shared/org";
import type { OrgDelegationView, OrgDuesView, OrgPersonView, OrgPositionView, OrgRef, OrgView } from "../../../shared/org-view";
import type { EditOp } from "../../../shared/protocol";
import { formatMoney, type WorldCurrency } from "../../../shared/world";

/** The section only GM → Orgs' pages hold: its parts and tabs draw from it, and the editors give the GM every control. */
export const GM_PART = "orgs.gm";

/** Whether a page is GM → Orgs' (`gmPage`). */
export function isGmPage(org: OrgView): boolean {
  return org.sections[GM_PART] !== undefined;
}

/** The economy's actions the editors send (lane E's), beside the organization's own (`ORG_ACTIONS`). */
export const STAFF_ACTIONS = { hire: FINANCE_ACTIONS.hire, end: FINANCE_ACTIONS.fire, raise: FINANCE_ACTIONS.raise, hours: "job_hours", leave: "job_leave", back: "job_return", position: "job_position", title: "job_title", dues: "org_dues" } as const;

/** The organization's effects the GM runs as edits (`EffectDef.gm`): positions and delegations, with their checks and History lines. */
export const GM_EFFECTS = { position: "orgs.position", delegate: "orgs.delegate", revoke: "orgs.revoke" } as const;

// ---------------------------------------------------------------- routes

/** What an `org_edit` sheet shows: a member's sheet (by who), Hire someone, Admit a member, a position (by id; none adds one), a delegation (by who; none grants one), the dues, a trust's payout. */
export const ORG_EDIT_FORMS = ["member", "hire", "admit", "position", "delegate", "dues", "payout"] as const;
export type OrgEditForm = (typeof ORG_EDIT_FORMS)[number];

export interface OrgEditTarget {
  org: string;
  form: OrgEditForm;
  id: string | null;
}

/** The sheet of one of an organization's editors, over its page. */
export function orgEditRoute(org: string, form: OrgEditForm, id: string | null = null): SheetRoute {
  return { kind: "org_edit", id: [org, form, ...(id === null ? [] : [id])].map(encodeURIComponent).join("/") };
}

/** What an `org_edit` sheet's id names (`orgEditRoute`); null for one that doesn't read. */
export function orgEditOf(id: string): OrgEditTarget | null {
  const parts = id.split("/");
  if (parts.length < 2 || parts.length > 3) return null;
  try {
    const [org = "", form, target] = parts.map(decodeURIComponent);
    const known = ORG_EDIT_FORMS.find((f) => f === form);
    return org !== "" && known ? { org, form: known, id: target === undefined || target === "" ? null : target } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- who may use what

/** Whether the reader holds `power` there, or one that implies it. */
export function holds(org: OrgView, power: OrgPower): boolean {
  return org.you.powers.some((p) => powerCovers(p.power, power));
}

/** The reader's own id on the page, when they're on it. */
function readerOf(org: OrgView): string | null {
  return org.people.find((p) => p.you)?.id ?? null;
}

/**
 * People's controls at its top (§4.4), by power: Hire someone (`staff.hire`, from Money 3, where work
 * is actions), Admit a member (`members.admit`; a trust's members are its owners) and a trust's Pay
 * out (`money.payout`, from Money 3). The party has its own (Hire a hand, Add someone you know);
 * GM → Orgs, its GM parts.
 */
export function peopleControls(org: OrgView): { hire: boolean; admit: boolean; payout: boolean } {
  if (!org.exists || isGmPage(org) || org.type === "party") return { hire: false, admit: false, payout: false };
  return { hire: org.level >= 3 && holds(org, "staff.hire"), admit: org.type !== "trust" && holds(org, "members.admit"), payout: org.type === "trust" && org.level >= 3 && holds(org, "money.payout") };
}

export type MemberControl = "appoint" | "title" | "delegate" | "revoke" | "raise" | "hours" | "leave" | "back" | "let_go" | "remove";

/** Each control as the member's sheet names it. */
export const MEMBER_CONTROL_LABELS: Readonly<Record<MemberControl, string>> = {
  appoint: "Appoint…",
  title: "Change title…",
  delegate: "Delegate…",
  revoke: "Revoke…",
  raise: "Raise",
  hours: "Change hours",
  leave: "Put on leave",
  back: "Back from leave",
  let_go: "Let go",
  remove: "Remove",
};

/** The positions one may be appointed to there: those it defines, not a type's own (a household's Head, the party's Leader). */
export function appointable(org: OrgView): OrgPositionView[] {
  return org.positions.filter((p) => !p.implied);
}

/**
 * The controls a member's sheet shows (§4.4), in its order, each where the reader may use it:
 * Appoint… and Change title… (`members.appoint`; one's own title too), Delegate… (`delegate`, to
 * anyone but oneself) and Revoke… (its granter, or a holder of `delegate`); for staff, from Money 3,
 * Raise, Change hours and Put on leave or Back from leave (`staff.pay`) and Let go (`staff.fire`),
 * never on oneself; and Remove (`members.remove`) for a member by a link of their own. The party's
 * roster is its own page's (tiers); only delegation shows there.
 */
export function memberControls(org: OrgView, person: OrgPersonView): MemberControl[] {
  if (!org.exists || isGmPage(org)) return [];
  const out: MemberControl[] = [];
  const party = org.type === "party";
  if (!party && holds(org, "members.appoint") && (appointable(org).length > 0 || person.position !== null)) out.push("appoint");
  if (!party && (holds(org, "members.appoint") || person.you)) out.push("title");
  if (!person.you && holds(org, "delegate")) out.push("delegate");
  const theirs = org.delegations.find((d) => d.who.id === person.id);
  if (theirs && mayRevoke(org, theirs)) out.push("revoke");
  if (person.job !== null && !person.you && org.level >= 3) {
    if (holds(org, "staff.pay")) out.push("raise", "hours", person.status === "leave" ? "back" : "leave");
    if (holds(org, "staff.fire")) out.push("let_go");
  }
  if (!party && !person.you && person.hows.includes("member") && holds(org, "members.remove")) out.push("remove");
  return out;
}

/** Whether the reader may end a delegation (§3.5): its granter, or a holder of `delegate`; the GM, any. */
export function mayRevoke(org: OrgView, d: OrgDelegationView): boolean {
  if (!org.exists) return false;
  if (isGmPage(org)) return true;
  const me = readerOf(org);
  return holds(org, "delegate") || (me !== null && d.by?.id === me);
}

/** Rules' controls (§4.4): positions (`org.govern`, at once), delegating (`delegate`, as a turn) and, for a household or a group from Money 3, its dues (`org.govern`); the GM, all of them. */
export function rulesControls(org: OrgView): { positions: boolean; delegate: boolean; dues: boolean } {
  if (!org.exists) return { positions: false, delegate: false, dues: false };
  const gm = isGmPage(org);
  const treasury = org.type === "household" || org.type === "group";
  return { positions: gm || holds(org, "org.govern"), delegate: gm || holds(org, "delegate"), dues: treasury && (gm || (org.level >= 3 && holds(org, "org.govern"))) };
}

// ---------------------------------------------------------------- what the forms send

/** An action the reader plays: its id and params, as `lre.action` takes them. */
export interface OrgAction {
  action: string;
  params: JsonObject;
}

/** Typed money as minor units; null for text that isn't an amount, undefined for none typed. */
function amount(text: string, currency: WorldCurrency): number | null | undefined {
  return text.trim() === "" ? undefined : parseMoneyInput(text, currency);
}

/** Into a position, or out of theirs with none (`position` ""): staff by their job (`job_position`), anyone else by their membership (`org_appoint`). */
export function appointAction(org: OrgView, person: OrgPersonView, position: string): OrgAction {
  const staff = person.job !== null;
  const params: JsonObject = person.job !== null ? { job: person.job } : { org: org.id, who: person.id };
  if (position !== "") params.position = position;
  return { action: staff ? STAFF_ACTIONS.position : ORG_ACTIONS.appoint, params };
}

/** A title of their own, or none (`title` ""): a member's on their membership (`org_title`), staff's on their job (`job_title`). */
export function titleAction(org: OrgView, person: OrgPersonView, title: string): OrgAction {
  const onJob = person.job !== null && !person.hows.includes("member");
  const params: JsonObject = onJob && person.job !== null ? { job: person.job } : { org: org.id, who: person.id };
  if (title.trim() !== "") params.title = title.trim();
  return { action: onJob ? STAFF_ACTIONS.title : ORG_ACTIONS.title, params };
}

export function revokeAction(org: OrgView, who: string): OrgAction {
  return { action: ORG_ACTIONS.revoke, params: { org: org.id, to: who } };
}

export function removeAction(org: OrgView, who: string): OrgAction {
  return { action: ORG_ACTIONS.remove, params: { org: org.id, who } };
}

/** A staff control that takes nothing but the job: Put on leave, Back from leave, Let go. */
export function jobAction(control: "leave" | "back" | "let_go", job: string): OrgAction {
  return { action: control === "leave" ? STAFF_ACTIONS.leave : control === "back" ? STAFF_ACTIONS.back : STAFF_ACTIONS.end, params: { job } };
}

/** A raise: the new rate, typed; null while it isn't one above nothing. */
export function raiseAction(job: string, rate: string, currency: WorldCurrency): OrgAction | null {
  const cents = amount(rate, currency);
  return typeof cents === "number" && cents > 0 ? { action: STAFF_ACTIONS.raise, params: { job, rate: cents } } : null;
}

/** New hours a week; null while they aren't more than none and at most a week's. */
export function hoursAction(job: string, hours: string): OrgAction | null {
  const n = Number(hours);
  return hours.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 168 ? { action: STAFF_ACTIONS.hours, params: { job, hours_per_week: n } } : null;
}

export interface HireForm {
  worker: string;
  title: string;
  position: string;
  basis: string;
  rate: string;
  hours: string;
  /** How often they're paid; "" joins the employer's pay schedule, else its staff's. */
  every: string;
}

/** Why Hire someone can't be sent yet; null when it can. */
export function hireProblem(form: HireForm, currency: WorldCurrency): string | null {
  if (form.worker === "") return "Choose whom to hire.";
  if (form.every !== UNPAID && amount(form.rate, currency) === null) return "Type the rate as an amount.";
  if (form.hours.trim() !== "" && hoursAction("", form.hours) === null) return "Hours a week are more than none and at most 168.";
  return null;
}

/** Hire someone (`job_hire`, as a turn): the organization employs them, with what the form says; what it leaves out comes from their occupation and the employer's pay schedule. */
export function hireAction(org: OrgView, form: HireForm, currency: WorldCurrency): OrgAction | null {
  if (hireProblem(form, currency) !== null) return null;
  const rate = amount(form.rate, currency);
  const params: JsonObject = { business: org.id, worker: form.worker };
  if (form.title.trim() !== "") params.title = form.title.trim();
  if (form.position !== "") params.position = form.position;
  if (form.basis !== "") params.basis = form.basis;
  // Unpaid (a title with no pay): no rate, no payroll and no payslip.
  if (typeof rate === "number" && rate > 0 && form.every !== UNPAID) params.rate = rate;
  if (form.hours.trim() !== "") params.hours_per_week = Number(form.hours);
  if (form.every !== "") params.pay_every = form.every;
  return { action: STAFF_ACTIONS.hire, params };
}

export interface AdmitForm {
  who: string;
  title: string;
  position: string;
}

/** Admit a member (`org_admit`, as a turn): with a title of their own, into the position named or the organization's default one. */
export function admitAction(org: OrgView, form: AdmitForm): OrgAction | null {
  if (form.who === "") return null;
  return { action: ORG_ACTIONS.admit, params: { org: org.id, who: form.who, ...(form.title.trim() !== "" ? { title: form.title.trim() } : {}), ...(form.position !== "" ? { position: form.position } : {}) } };
}

/** Whom Hire someone and Admit a member offer: the people the reader may name, but those already on its staff or among its members. */
export function newcomers(org: OrgView, form: "hire" | "admit"): OrgRef[] {
  const how = form === "hire" ? "staff" : "member";
  const already = new Set(org.people.filter((p) => p.hows.includes(how)).map((p) => p.id));
  return org.candidates.filter((c) => !already.has(c.id));
}

// ---------------------------------------------------------------- positions

/** A position as its form edits it: every part as typed. */
export interface PositionDraft {
  /** The position's id while editing one; null for a new one, whose id comes from its title. */
  id: string | null;
  title: string;
  powers: OrgPower[];
  seats: string;
  /** "" reports to no one. */
  reportsTo: string;
  scope: PositionScope;
  payment: string;
  month: string;
  /** "vacant", "next", or a person's id. */
  successor: string;
  joinsIn: boolean;
  /** Kept as it was: the editors don't change it (Build's All fields does). */
  noDues: boolean;
  /** The accounts its limits confine it to, kept as they were (null: any); no editor changes them. */
  accounts: string[] | null;
}

/** A position's draft: the one given, or a new one (one seat, every power left off). */
export function positionDraft(p: Position | null, currency: WorldCurrency): PositionDraft {
  return {
    id: p?.id ?? null,
    title: p?.title ?? "",
    powers: [...(p?.powers ?? [])],
    seats: String(p?.seats ?? 1),
    reportsTo: p?.reports_to ?? "",
    scope: p?.scope ?? "org",
    payment: p?.limits?.payment !== undefined ? formatMoneyInput(p.limits.payment, currency) : "",
    month: p?.limits?.month !== undefined ? formatMoneyInput(p.limits.month, currency) : "",
    successor: p?.successor ?? "vacant",
    joinsIn: p?.default === true,
    noDues: p?.no_dues === true,
    accounts: p?.limits?.accounts !== undefined ? [...p.limits.accounts] : null,
  };
}

/** A position as Play's page shows it, as the record it was read from (the view names a successor by name, and keeps their id apart). */
export function positionOfView(p: OrgPositionView): Position {
  return {
    id: p.id,
    title: p.title,
    powers: [...p.powers],
    seats: p.seats,
    ...(p.reportsTo ? { reports_to: p.reportsTo.id } : {}),
    scope: p.scope,
    ...(p.limits ? { limits: p.limits } : {}),
    successor: p.successorId ?? (p.successor === "next" ? "next" : "vacant"),
    ...(p.joinsIn ? { default: true as const } : {}),
  };
}

/** Why a position's draft can't be saved among `positions` (the organization's, before the change); null when it can. */
export function positionProblem(draft: PositionDraft, positions: readonly Position[], currency: WorldCurrency): string | null {
  const title = draft.title.trim();
  if (title === "") return "Give it a title.";
  const id = draft.id ?? positionIdOf(title);
  if (id === "") return "Give it a title with a letter or a number in it.";
  if (draft.id === null && positions.some((p) => p.id === id)) return `It has a position ${title} already.`;
  const seats = Number(draft.seats);
  if (draft.seats.trim() === "" || !Number.isInteger(seats) || seats < 0) return "Seats is a whole number: 0 for any number.";
  if (amount(draft.payment, currency) === null) return "Type the limit on each payment as an amount.";
  if (amount(draft.month, currency) === null) return "Type the limit on each month as an amount.";
  if (draft.reportsTo !== "") {
    if (draft.reportsTo === id) return "A position can't report to itself.";
    const seen = new Set<string>();
    for (let at: string | undefined = draft.reportsTo; at !== undefined && !seen.has(at); at = positions.find((p) => p.id === at)?.reports_to) {
      if (at === id) return "It can't report to a position that reports to it.";
      seen.add(at);
    }
  }
  return null;
}

/**
 * What saving a position sends (`org_position`, at once; in GM → Orgs the same effect, with no
 * granter): every part of it, so what was cleared is cleared too: no one to report to as
 * `no_report`, a limit taken off as 0, and no powers as a lone comma, which names none (an empty
 * param reads as not given). A new one takes its id from its title.
 */
export function positionArgs(org: string, draft: PositionDraft, before: Position | null, currency: WorldCurrency): JsonObject {
  const cents = (text: string): number => {
    const v = amount(text, currency);
    return typeof v === "number" ? v : 0;
  };
  const payment = cents(draft.payment);
  const month = cents(draft.month);
  return {
    org,
    ...(draft.id !== null ? { id: draft.id } : {}),
    title: draft.title.trim(),
    powers: draft.powers.length > 0 ? draft.powers.join(",") : ",",
    seats: Number(draft.seats),
    ...(draft.reportsTo !== "" ? { reports_to: draft.reportsTo } : before?.reports_to !== undefined ? { no_report: true } : {}),
    scope: draft.scope,
    ...(payment > 0 || before?.limits?.payment !== undefined ? { payment } : {}),
    ...(month > 0 || before?.limits?.month !== undefined ? { month } : {}),
    successor: draft.successor === "" ? "vacant" : draft.successor,
    default: draft.joinsIn,
  };
}

/** Saving a position in Play: the reader's `org_position`. */
export function positionAction(org: string, draft: PositionDraft, before: Position | null, currency: WorldCurrency): OrgAction {
  return { action: ORG_ACTIONS.position, params: positionArgs(org, draft, before, currency) };
}

/** Removing a position: in Play the reader's `org_position`; its holders keep their membership, and those reporting to it report to no one. */
export function positionRemoveAction(org: string, id: string): OrgAction {
  return { action: ORG_ACTIONS.position, params: { org, id, remove: true } };
}

/** The GM's save of a position, or its removal: the organization's own effect, as one edit, with its History line. */
export function positionEditOps(org: string, draft: PositionDraft, before: Position | null, currency: WorldCurrency): EditOp[] {
  return [{ op: "effect", effect: GM_EFFECTS.position, args: positionArgs(org, draft, before, currency) }];
}

export function positionRemoveOps(org: string, id: string): EditOp[] {
  return [{ op: "effect", effect: GM_EFFECTS.position, args: { org, id, remove: true } }];
}

/** A position's draft as its record, for Build, which writes the `positions` field whole: only what differs from the defaults (one seat, the whole organization, vacant). */
export function positionRecord(draft: PositionDraft, currency: WorldCurrency): JsonObject {
  const title = draft.title.trim();
  const payment = amount(draft.payment, currency);
  const month = amount(draft.month, currency);
  const limits = { ...(typeof payment === "number" && payment > 0 ? { payment } : {}), ...(typeof month === "number" && month > 0 ? { month } : {}), ...(draft.accounts !== null ? { accounts: [...draft.accounts] } : {}) };
  return {
    id: draft.id ?? positionIdOf(title),
    title,
    powers: ORG_POWERS.filter((p) => draft.powers.includes(p)),
    seats: Number(draft.seats),
    ...(draft.reportsTo !== "" ? { reports_to: draft.reportsTo } : {}),
    ...(draft.scope === "below" ? { scope: "below" } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(draft.successor !== "" && draft.successor !== "vacant" ? { successor: draft.successor } : {}),
    ...(draft.joinsIn ? { default: true } : {}),
    ...(draft.noDues ? { no_dues: true } : {}),
  };
}

// ---------------------------------------------------------------- delegations

/** A delegation as its form edits it. */
export interface DelegationDraft {
  to: string;
  powers: OrgPower[];
  payment: string;
  month: string;
  /** A new end, `YYYY-MM-DD`; "" keeps `kept`. */
  until: string;
  /** Its end as it stands (a clock reading), kept while no new one is typed; null: until revoked. */
  kept: number | null;
  /** Who granted it (the GM's choice; Play's is the reader). */
  by: string;
  /** The accounts it confines them to, kept as they were (null: any); no editor changes them. */
  accounts: string[] | null;
}

export function delegationDraft(to: string, d: { powers: readonly OrgPower[]; payment?: number; month?: number; accounts?: readonly string[]; until?: number | null; by?: string | null } | null, currency: WorldCurrency): DelegationDraft {
  return {
    to,
    powers: [...(d?.powers ?? [])],
    payment: d?.payment !== undefined ? formatMoneyInput(d.payment, currency) : "",
    month: d?.month !== undefined ? formatMoneyInput(d.month, currency) : "",
    until: "",
    kept: d?.until ?? null,
    by: d?.by ?? "",
    accounts: d?.accounts !== undefined ? [...d.accounts] : null,
  };
}

/** Why a delegation's draft can't be sent; null when it can. */
export function delegationProblem(draft: DelegationDraft, currency: WorldCurrency): string | null {
  if (draft.to === "") return "Choose who acts for it.";
  if (draft.powers.length === 0) return "Give at least one power.";
  if (amount(draft.payment, currency) === null) return "Type the limit on each payment as an amount.";
  if (amount(draft.month, currency) === null) return "Type the limit on each month as an amount.";
  if (draft.until !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(draft.until)) return "Until is a date.";
  return null;
}

/** What a delegation sends: its powers, limits and end (the end of the day named, or the one it had); by `org_delegate` in Play, by its effect in GM → Orgs, with the granter the GM names. */
export function delegationArgs(org: string, draft: DelegationDraft, currency: WorldCurrency, gm: boolean): JsonObject {
  const payment = amount(draft.payment, currency);
  const month = amount(draft.month, currency);
  const until = draft.until !== "" ? draft.until : draft.kept;
  return {
    org,
    to: draft.to,
    powers: draft.powers.join(","),
    ...(typeof payment === "number" && payment > 0 ? { payment } : {}),
    ...(typeof month === "number" && month > 0 ? { month } : {}),
    ...(until !== null ? { until } : {}),
    ...(gm && draft.by !== "" ? { by: draft.by } : {}),
  };
}

export function delegateAction(org: string, draft: DelegationDraft, currency: WorldCurrency): OrgAction {
  return { action: ORG_ACTIONS.delegate, params: delegationArgs(org, draft, currency, false) };
}

/** The GM's delegation, granted or changed in one edit (a changed one is written whole), or ended. */
export function delegationEditOps(org: string, draft: DelegationDraft, currency: WorldCurrency): EditOp[] {
  return [{ op: "effect", effect: GM_EFFECTS.delegate, args: delegationArgs(org, draft, currency, true) }];
}

export function delegationRevokeOps(org: string, to: string): EditOp[] {
  return [{ op: "effect", effect: GM_EFFECTS.revoke, args: { org, to } }];
}

/** The powers the reader may give (§3.5): those they hold there; the GM, every one. */
export function givable(org: OrgView): OrgPower[] {
  return isGmPage(org) ? [...ORG_POWERS] : ORG_POWERS.filter((p) => org.you.powers.some((h) => h.power === p));
}

// ---------------------------------------------------------------- dues

export interface DuesDraft {
  amount: string;
  every: (typeof DUES_EVERY)[number];
  day: string;
}

export function duesDraft(dues: OrgDuesView | null, currency: WorldCurrency): DuesDraft {
  return { amount: dues ? formatMoneyInput(dues.cents, currency) : "", every: dues?.every ?? "month", day: dues?.day !== null && dues?.day !== undefined ? String(dues.day) : "" };
}

/** Why the dues can't be set as typed; null when they can (no amount sets none). */
export function duesProblem(draft: DuesDraft, currency: WorldCurrency): string | null {
  if (amount(draft.amount, currency) === null) return "Type what each member pays as an amount.";
  if (draft.day.trim() === "") return null;
  const day = Number(draft.day);
  if (!Number.isInteger(day)) return "The day is a whole number.";
  if (draft.every === "week" ? day < 0 || day > 6 : day < -1 || day > 31 || day === 0) return draft.every === "week" ? "A weekday is 0 (Sunday) to 6." : "A day of the month is 1 to 31, or -1 for its last.";
  return null;
}

/** Setting the dues (`org_dues`, at once); nothing to pay ends them. */
export function duesAction(org: string, draft: DuesDraft, currency: WorldCurrency): OrgAction {
  const cents = amount(draft.amount, currency);
  return { action: STAFF_ACTIONS.dues, params: { org, amount: typeof cents === "number" ? cents : 0, every: draft.every, ...(draft.day.trim() !== "" ? { day: Number(draft.day) } : {}) } };
}

/** The GM's dues: the `dues` field, a one-record list as it is declared; none clears it. */
export function duesEditOps(org: string, draft: DuesDraft, currency: WorldCurrency): EditOp[] {
  const cents = amount(draft.amount, currency);
  const record = typeof cents === "number" && cents > 0 ? [{ cents, every: draft.every, ...(draft.day.trim() !== "" ? { day: Number(draft.day) } : {}) }] : [];
  return [{ op: "set", entity: org, field: "dues", value: record }];
}

// ---------------------------------------------------------------- a trust's payout

/** A trust's payout (DESIGN §29.7) needs an amount above nothing: it pays out what it holds, not a profit. */
export function payoutProblem(text: string, currency: WorldCurrency): string | null {
  const cents = amount(text, currency);
  return typeof cents === "number" && cents > 0 ? null : "Type how much it pays out.";
}

/** Paying a trust's money out to its beneficiaries by their shares (`distribute_profit` with the amount, as a turn). */
export function payoutAction(org: string, text: string, currency: WorldCurrency): OrgAction | null {
  const cents = amount(text, currency);
  return typeof cents === "number" && cents > 0 ? { action: FINANCE_ACTIONS.distribute, params: { business: org, amount: cents } } : null;
}

/** The GM's payout of a trust's money to its beneficiaries by their shares (`economy.distribute`, an effect). */
export function payoutOps(org: string, text: string, currency: WorldCurrency): EditOp[] {
  const cents = amount(text, currency);
  return typeof cents === "number" && cents > 0 ? [{ op: "effect", effect: "economy.distribute", args: { business: org, cents } }] : [];
}

const ORDINAL_DAYS: Readonly<Record<number, string>> = { 1: "1st", 2: "2nd", 3: "3rd", 21: "21st", 22: "22nd", 23: "23rd", 31: "31st" };
const WEEKDAYS: readonly string[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Dues in words: "$5.00 each a month, on the 1st", "$2.00 each a week, on Friday", "$20.00 each a year". */
export function duesWords(dues: OrgDuesView, currency: WorldCurrency): string {
  const each = `${formatMoney(dues.cents, currency)} each a ${dues.every}`;
  if (dues.every === "year" || dues.day === null) return each;
  if (dues.every === "week") return `${each}, on ${WEEKDAYS[dues.day] ?? "its day"}`;
  return `${each}, on the ${dues.day === -1 ? "last day" : (ORDINAL_DAYS[dues.day] ?? `${dues.day}th`)}`;
}

// ---------------------------------------------------------------- a member's job

/** A member's job as the organization's Payroll shows it to a reader who may see its money: pay in words, rate, how often, the next payday, status and hours. */
export interface StaffJobInfo {
  id: string;
  pay: string;
  rate: number;
  schedule: string;
  nextPay: string | null;
  status: string;
  hoursPerWeek: number | null;
}

/** `job`'s row on the page's Payroll (`sections.payroll`, behind `money.view`); null when the reader may not see it. */
export function staffJobOf(org: OrgView, job: string | null): StaffJobInfo | null {
  const payroll = org.sections.payroll;
  if (job === null || !isRecord(payroll) || !Array.isArray(payroll.employees)) return null;
  const row = payroll.employees.find((e) => isRecord(e) && e.id === job);
  if (!isRecord(row)) return null;
  const spec = isRecord(row.spec) ? row.spec : {};
  return {
    id: job,
    pay: typeof row.pay === "string" ? row.pay : "",
    rate: typeof row.rate === "number" ? row.rate : 0,
    schedule: typeof row.schedule === "string" ? row.schedule : "",
    nextPay: typeof row.nextPay === "string" ? row.nextPay : null,
    status: typeof row.status === "string" ? row.status : "active",
    hoursPerWeek: typeof spec.hours_per_week === "number" ? spec.hours_per_week : null,
  };
}
