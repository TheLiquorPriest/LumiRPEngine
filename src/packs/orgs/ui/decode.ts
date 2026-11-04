// Readers for the orgs pack's views as `StateView.panels` carries them: the Orgs home (`orgs.list`),
// the organizations' pages (`orgs.org`) and their life's sections (alerts, Coming up and the Plan).
// Each answers null when the shape isn't the one drawn, and the shell shows the generic view instead.

import { isOwnerRole } from "../../../shared/finance";
import { isRecord, type JsonValue } from "../../../shared/json";
import { DUES_EVERY, limitsIn, MEMBER_HOWS, ORG_BASES, ORG_TYPES, POSITION_SCOPES, powersIn, type MemberHow } from "../../../shared/org";
import type { OrgDelegationView, OrgDuesView, OrgHistoryLineView, OrgListView, OrgPersonView, OrgPositionView, OrgPowerView, OrgRef, OrgRowView, OrgStartView, OrgView, PartyMemberView } from "../../../shared/org-view";
import { ALERT_KINDS, ALERT_TABS, COMING_KINDS, PLAN_STATUSES, type OrgAlertView, type OrgComingView, type OrgPlanView, type PlanClosedView, type PlanGoalView, type PlanOrderView } from "../../../shared/org-feed";
import { isPartyTier } from "../../../shared/party";
import { list, num, oneOf, optNum, str, strings, type Obj } from "../../../frontend/decode";

function ref(v: unknown): OrgRef | null {
  return isRecord(v) && typeof v.id === "string" ? { id: v.id, name: str(v.name, v.id) } : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function idTitle(v: unknown): { id: string; title: string } | null {
  return isRecord(v) && typeof v.id === "string" ? { id: v.id, title: str(v.title, v.id) } : null;
}

function delegation(d: Obj): OrgDelegationView | null {
  const who = ref(d.who);
  return who ? { who, powers: powersIn(d.powers), limits: limitsIn(d.limits) ?? null, until: text(d.until), by: ref(d.by) } : null;
}

function dues(v: unknown): OrgDuesView | null {
  if (!isRecord(v) || typeof v.cents !== "number") return null;
  const every = DUES_EVERY.find((e) => e === v.every);
  return every ? { cents: v.cents, every, day: optNum(v.day) ?? null } : null;
}

function person(p: Obj): OrgPersonView | null {
  if (typeof p.id !== "string") return null;
  return {
    id: p.id,
    name: str(p.name, p.id),
    title: str(p.title),
    hows: Array.isArray(p.hows) ? p.hows.filter((h): h is MemberHow => (MEMBER_HOWS as readonly unknown[]).includes(h)) : [],
    position: idTitle(p.position),
    rank: optNum(p.rank) ?? null,
    since: text(p.since),
    here: p.here === true,
    job: text(p.job),
    status: p.status === "leave" || p.status === "active" ? p.status : null,
    role: isOwnerRole(p.role) ? p.role : null,
    share: optNum(p.share) ?? null,
    via: ref(p.via),
    powers: list(p.powers, power),
    you: p.you === true,
  };
}

function position(p: Obj): OrgPositionView | null {
  if (typeof p.id !== "string") return null;
  return {
    id: p.id,
    title: str(p.title, p.id),
    powers: powersIn(p.powers),
    seats: num(p.seats),
    filled: num(p.filled),
    reportsTo: idTitle(p.reportsTo),
    scope: oneOf(p.scope, POSITION_SCOPES, "org"),
    limits: limitsIn(p.limits) ?? null,
    successor: str(p.successor, "vacant"),
    successorId: text(p.successorId),
    joinsIn: p.joinsIn === true,
    implied: p.implied === true,
    holders: strings(p.holders),
    hidden: num(p.hidden),
  };
}

function power(p: Obj): OrgPowerView | null {
  const [held] = powersIn([p.power]);
  return held ? { power: held, basis: oneOf(p.basis, ORG_BASES, "member"), id: text(p.id), words: str(p.words) } : null;
}

function historyLine(l: Obj): OrgHistoryLineView | null {
  return typeof l.text === "string" && l.text !== "" ? { at: str(l.at), text: l.text, by: ref(l.by) } : null;
}

/** One organization's page; null for a shape it isn't. */
export function decodeOrgView(value: unknown): OrgView | null {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.people) || !isRecord(value.you)) return null;
  const you = value.you;
  const hidden = isRecord(value.hidden) ? value.hidden : {};
  return {
    id: value.id,
    name: str(value.name, value.id),
    type: oneOf(value.type, ORG_TYPES, "group"),
    kind: str(value.kind),
    structure: text(value.structure),
    badge: str(value.badge),
    level: num(value.level),
    exists: value.exists !== false,
    you: {
      belongs: you.belongs === true,
      title: text(you.title),
      position: idTitle(you.position),
      since: text(you.since),
      reportsTo: list(you.reportsTo, ref),
      powers: list(you.powers, power),
      delegations: list(you.delegations, delegation),
    },
    runBy: list(value.runBy, ref),
    people: list(value.people, person),
    hidden: { count: num(hidden.count), ids: strings(hidden.ids) },
    positions: list(value.positions, position),
    delegations: list(value.delegations, delegation),
    defaultPosition: text(value.defaultPosition),
    dues: dues(value.dues),
    history: list(value.history, historyLine),
    candidates: list(value.candidates, ref),
    // The packs' own shapes, each read by the tab that draws it (`r.orgTab`).
    sections: isRecord(value.sections) ? (value.sections as Record<string, JsonValue>) : {},
  };
}

/** The page of `id` among the pages the home opens (`orgs.org`); null when there is none. */
export function decodeOrgPage(pages: unknown, id: string): OrgView | null {
  const page = isRecord(pages) ? decodeOrgView(pages[id]) : null;
  return page?.id === id ? page : null;
}

function row(r: Obj): OrgRowView | null {
  return typeof r.id === "string" ? { id: r.id, name: str(r.name, r.id), type: oneOf(r.type, ORG_TYPES, "group"), kind: str(r.kind), title: text(r.title), figure: text(r.figure) } : null;
}

/** Start something…; a company off without a reason it can say, and no group, for a shape it isn't. */
function start(v: unknown): OrgStartView {
  const s = isRecord(v) ? v : {};
  const company = isRecord(s.company) ? s.company : {};
  const kinds = isRecord(s.group) ? list(s.group.kinds, (k) => (typeof k.id === "string" ? { id: k.id, label: str(k.label, k.id) } : null)) : [];
  return {
    company: { why: isRecord(s.company) ? text(company.why) : "Starting a company isn't open here", sources: list(company.sources, (a) => (typeof a.id === "string" ? { id: a.id, name: str(a.name, a.id), balance: str(a.balance) } : null)) },
    group: kinds.length > 0 ? { kinds } : null,
  };
}

/** The Orgs home; null for a shape it isn't. */
export function decodeOrgList(value: unknown): OrgListView | null {
  if (!isRecord(value)) return null;
  const party = value.party;
  if (!isRecord(party) || typeof party.id !== "string") return null;
  const members = list(party.members, (m): PartyMemberView | null => (typeof m.id === "string" && isPartyTier(m.tier) ? { id: m.id, name: str(m.name, m.id), tier: m.tier, here: m.here === true } : null));
  return {
    party: { id: party.id, name: str(party.name, "Your party"), exists: party.exists === true, members, hidden: num(party.hidden), purse: text(party.purse) },
    belong: list(value.belong, row),
    known: list(value.known, (k) => {
      const r = row(k);
      return r ? { ...r, whom: list(k.whom, ref) } : null;
    }),
    start: start(value.start),
  };
}

/** An organization's alerts (`orgs.alerts`); none for a shape it isn't. */
export function decodeAlerts(value: unknown): OrgAlertView[] {
  return list(value, (a) => (typeof a.id === "string" && typeof a.text === "string" ? { id: a.id, kind: oneOf(a.kind, ALERT_KINDS, "vacancy"), tone: oneOf(a.tone, ["info", "warn", "neg"] as const, "info"), text: a.text, short: str(a.short, a.text), tab: oneOf(a.tab, ALERT_TABS, "overview"), needsYou: a.needsYou === true } : null));
}

/** What an organization has coming up (`orgs.coming`); nothing for a shape it isn't. */
export function decodeComing(value: unknown): OrgComingView[] {
  return list(value, (c) => (typeof c.text === "string" ? { kind: oneOf(c.kind, COMING_KINDS, "payday"), at: str(c.at), clock: num(c.clock), text: c.text, cents: optNum(c.cents) ?? null } : null));
}

function lastWord(v: unknown): { note: string; at: string } | null {
  return isRecord(v) && typeof v.note === "string" ? { note: v.note, at: str(v.at) } : null;
}

function planOrder(o: Obj): PlanOrderView | null {
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const edit = isRecord(o.edit) ? o.edit : null;
  return {
    id: o.id,
    goal: text(o.goal),
    to: list(o.to, ref),
    lead: ref(o.lead),
    text: o.text,
    where: text(o.where),
    when: text(o.when),
    status: oneOf(o.status, PLAN_STATUSES, "open"),
    set: str(o.set),
    late: o.late === true,
    lived: o.lived === true,
    last: lastWord(o.last),
    mine: o.mine === true,
    mayStatus: o.mayStatus === true,
    mayEdit: o.mayEdit === true,
    edit: edit ? { to: strings(edit.to), hidden: num(edit.hidden), lead: str(edit.lead), where: str(edit.where), when: str(edit.when), goal: str(edit.goal) } : null,
  };
}

function planGoal(g: Obj): PlanGoalView | null {
  if (typeof g.id !== "string" || typeof g.text !== "string") return null;
  const edit = isRecord(g.edit) ? g.edit : null;
  return {
    id: g.id,
    text: g.text,
    window: text(g.window),
    where: text(g.where),
    status: oneOf(g.status, PLAN_STATUSES, "open"),
    set: str(g.set),
    late: g.late === true,
    last: lastWord(g.last),
    orders: list(g.orders, planOrder),
    ordersDone: g.ordersDone === true,
    mayEdit: g.mayEdit === true,
    edit: edit ? { window: str(edit.window), where: str(edit.where) } : null,
  };
}

/** An organization's Plan (`orgs.plan`); null for a shape it isn't. */
export function decodePlan(value: unknown): OrgPlanView | null {
  if (!isRecord(value) || !Array.isArray(value.goals) || !Array.isArray(value.orders)) return null;
  return {
    goals: list(value.goals, planGoal),
    orders: list(value.orders, planOrder),
    closed: num(value.closed),
    recent: list(value.recent, (c): PlanClosedView | null => (typeof c.id === "string" && typeof c.text === "string" ? { id: c.id, kind: c.kind === "goal" ? "goal" : "order", text: c.text, status: oneOf(c.status, PLAN_STATUSES, "done"), when: text(c.when) } : null)),
    mayGive: value.mayGive === true,
    people: list(value.people, ref),
  };
}
