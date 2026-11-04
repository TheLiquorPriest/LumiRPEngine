// An organization's life as its page, Now, the narrator and minds read it (ORG-SPEC §3.14-3.15,
// §4.1, §4.4): its alerts, worked out when read (a vacancy; payroll short two paydays running; a
// delegation ending within 3 days; dues in arrears; negative equity two months running), each with
// whether it needs the reader; what is coming up (paydays, invoices due, dues, lease ends); the
// titles the People section gives a person where an organization relates to the player character
// ("Marcus Delgado (owner of Alder Automotive, where you work)"); and a mind's Your organizations
// (their title and position, whom they report to and who reports to them, what they may do and the
// delegations they hold, after the orders asked of them). Money's parts follow the organization's
// Money level, as Money's do. Pure.

import { ownersIn } from "../../../shared/finance";
import type { FinanceView, FlowView } from "../../../shared/finance";
import { opaqueId } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import { ORG_POWERS, POWER_WORDS, type OrgLimits, type OrgPower, type OrgType } from "../../../shared/org";
import { ALERTS_SECTION, COMING_SECTION, type OrgAlertView, type OrgComingView } from "../../../shared/org-feed";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf, dayIndexOfText, formatClock } from "../../../engine/calendar";
import { chatFeed, worldFeed } from "../../../engine/feed";
import { delegationsOf, directMembers, heldPositions, HOW_WORDS, jobsAt, membersOfOrg, orgPowers, orgTitle, orgTypeOf, partyRoster, positionsOf } from "../../../engine/org";
import { acts } from "../../../engine/life";
import { kindIs, isGone } from "../../../engine/scope";
import { numOf, objOf, optionalQuery, own, sliceOf, strOf } from "../../../engine/pack-kit";
import { passMemo } from "../../../engine/read-pass";
import type { CoreRegistry, ReadContext } from "../../../engine/registry";
import { builtInSectionsOf } from "../../../shared/sections";
import { canSeeEntity } from "../../../engine/visibility";
import { planMindLines } from "./agenda";
import { orgsSetting } from "./seats";
import { partyIdOf, powersAt, rowsAt } from "./view";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** The titles the People section gives someone where an organization relates to the player character, each a phrase ("owner of Alder Automotive, where you work"); none while the section's `titles` source is off. */
    "orgs.titles": (ctx: ReadContext, who: EntityId) => string[];
  }
}

const DAY = 24 * 60;
/** Alert before a delegation ends (§9: fixed). */
export const DELEGATION_ALERT_DAYS = 3;
/** How far ahead Coming up looks unless the world's orgs config says (`coming_days`). */
export const COMING_DAYS = 14;

const money = (ctx: ReadContext, cents: number): string => formatMoney(cents, ctx.world.currency);

/** An organization's Money level (§3.1): a business's and a trust's own; any other's its members' highest. */
function orgLevel(ctx: ReadContext, org: EntityId, type: OrgType): number {
  const own = ctx.levelOf(org, "money");
  if (type === "company" || type === "trust") return own;
  return Math.max(own, ...rowsAt(ctx, org).map((r) => ctx.levelOf(r.who, "money")));
}

/** Whether the reader may read an organization's inner life: the GM, anyone in it, anyone holding a power there. */
function insider(ctx: ReadContext, org: EntityId, viewer: EntityId | null): boolean {
  return viewer === null || rowsAt(ctx, org).some((r) => r.who === viewer) || powersAt(ctx, org, viewer).length > 0;
}

/** Whether the reader holds `power` there (the GM holds every one). */
function holds(ctx: ReadContext, org: EntityId, viewer: EntityId | null, power: OrgPower): boolean {
  return viewer === null || powersAt(ctx, org, viewer).some((p) => p.power === power);
}

/** A flow's run as the economy keeps it: what it paid and missed, and the last time it ran. */
function runOf(ctx: ReadContext, flow: string): { done: number; missed: number; last: number | null; deferred: number } {
  const raw = objOf(objOf(sliceOf(ctx.state, "economy").flows)[flow]);
  return { done: numOf(raw.done), missed: numOf(raw.missed), last: typeof raw.last === "number" ? raw.last : null, deferred: numOf(raw.deferred) };
}

/** When each flow last posted, from every account's journal: one pass per state. */
function lastPosted(ctx: ReadContext): ReadonlyMap<string, number> {
  return passMemo([ctx.state], "orgs.posted", () => {
    const out = new Map<string, number>();
    for (const lines of Object.values(objOf(sliceOf(ctx.state, "economy").journal))) {
      if (!Array.isArray(lines)) continue;
      for (const raw of lines) {
        const l = objOf(raw);
        const flow = strOf(l.flow);
        if (flow !== "" && typeof l.at === "number" && l.at > (out.get(flow) ?? -Infinity)) out.set(flow, l.at);
      }
    }
    return out;
  });
}

/** A pay cadence's length, in minutes. */
const PAY_PERIOD_DAYS: Readonly<Record<string, number>> = { weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30 };

/** How many paydays running a job's payroll has missed since it last paid: none while it pays. */
function paydaysMissed(ctx: ReadContext, job: EntityId): number {
  const flow = `pay:${job}`;
  const run = runOf(ctx, flow);
  if (run.missed === 0 || run.last === null) return 0;
  const paid = lastPosted(ctx).get(flow);
  if (paid === undefined) return run.done === 0 ? run.missed : 0;
  if (run.last <= paid) return 0;
  const period = (PAY_PERIOD_DAYS[strOf(own(ctx.state.entities, job)?.fields.pay_every)] ?? 14) * DAY;
  return Math.min(run.missed, Math.round((run.last - paid) / period));
}

/** The accounts an organization holds in its own name. */
function accountsOf(ctx: ReadContext, org: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "account") && ownersIn(own(ctx.state.entities, id)?.fields ?? {}).some((o) => o.party === org));
}

/** Its net worth at the end of last month: today's, less what its accounts' journals moved since. */
function worthAtMonthStart(ctx: ReadContext, org: EntityId, now: number): number {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, ctx.state.clock);
  const start = clockAt(cal, dayIndexOf(cal, d.year, d.month, 1), 0);
  let moved = 0;
  for (const acct of accountsOf(ctx, org)) {
    const lines = objOf(sliceOf(ctx.state, "economy").journal)[acct];
    if (!Array.isArray(lines)) continue;
    for (const raw of lines) {
      const l = objOf(raw);
      if (typeof l.at === "number" && l.at >= start) moved += numOf(l.cents);
    }
  }
  return now - moved;
}

/** An organization's alerts as `viewer` may read them (§3.14); null when there are none, or they may read none of its inner life. */
export function orgAlerts(ctx: ReadContext, org: EntityId, viewer: EntityId | null): OrgAlertView[] | null {
  const type = orgTypeOf(ctx, org);
  if (type === null || !insider(ctx, org, viewer)) return null;
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const level = orgLevel(ctx, org, type);
  const seesMoney = holds(ctx, org, viewer, "money.view");
  const out: OrgAlertView[] = [];

  // A vacancy: a position with fewer holders who act than its seats.
  const rows = directMembers(ctx, org).filter((r) => r.via === undefined);
  for (const p of positionsOf(ctx, org)) {
    if (p.seats === 0) continue;
    const acting = new Set(rows.filter((r) => r.position === p.id && !isGone(ctx.state, r.who) && acts(ctx.world, ctx.state, r.who)).map((r) => r.who)).size;
    if (acting >= p.seats) continue;
    out.push({ id: `vacancy:${p.id}`, kind: "vacancy", tone: "warn", text: p.seats === 1 ? `${p.title} is vacant.` : `${p.title}: ${acting} of ${p.seats} seats filled.`, short: `${p.title} vacant`, tab: "people", needsYou: viewer !== null && holds(ctx, org, viewer, "members.appoint") });
  }

  // Payroll short two paydays running (from Money 3).
  if (level >= 3) {
    const short = jobsAt(ctx, org).filter((job) => strOf(own(ctx.state.entities, job)?.fields.status, "active") === "active" && paydaysMissed(ctx, job) >= 2);
    const mine = viewer === null ? [] : short.filter((job) => own(ctx.state.entities, job)?.fields.worker === viewer);
    if (seesMoney && short.length > 0) {
      const needs = viewer !== null && (holds(ctx, org, viewer, "money.spend") || holds(ctx, org, viewer, "money.manage") || holds(ctx, org, viewer, "staff.pay"));
      out.push({ id: "payroll_short", kind: "payroll_short", tone: "neg", text: `Payroll short two paydays running: ${short.length === 1 ? "1 paycheck" : `${short.length} paychecks`} unpaid.`, short: "payroll short", tab: "people", needsYou: needs });
    } else if (mine.length > 0) {
      out.push({ id: "payroll_short", kind: "payroll_short", tone: "neg", text: "Your pay here is two paydays behind.", short: "your pay is behind", tab: "overview", needsYou: false });
    }
  }

  // A delegation ending within 3 days: its delegate's and its granter's to see, and whoever may delegate; a delegate the reader can't see is "someone", and its alert carries no id of theirs.
  for (const d of delegationsOf(ctx, org)) {
    if (d.until === undefined || d.until < now || d.until > now + DELEGATION_ALERT_DAYS * DAY) continue;
    const yours = viewer !== null && d.who === viewer;
    const granted = viewer !== null && d.by === viewer;
    if (!yours && !granted && !holds(ctx, org, viewer, "delegate")) continue;
    const when = formatClock(cal, d.until);
    const shown = viewer === null || d.who === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, d.who);
    out.push({ id: `delegation:${shown ? d.who : opaqueId(d.who)}`, kind: "delegation_ending", tone: "info", text: yours ? `Your delegation to act for it ends ${when}.` : `${shown ? (own(ctx.state.entities, d.who)?.name ?? d.who) : "Someone"}'s delegation ends ${when}.`, short: yours ? "your delegation ends soon" : "a delegation ends soon", tab: yours ? "overview" : "rules", needsYou: yours || granted });
  }

  // Dues in arrears (from Money 3): what members still owe, a deferred dues flow each.
  if (level >= 3) {
    const prefix = `dues:${org}:`;
    const owing = Object.keys(objOf(sliceOf(ctx.state, "economy").flows))
      .filter((id) => id.startsWith(prefix))
      .map((id) => ({ who: id.slice(prefix.length), cents: runOf(ctx, id).deferred }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => a.who.localeCompare(b.who));
    const yours = owing.find((x) => x.who === viewer);
    if (seesMoney && owing.length > 0) {
      const total = owing.reduce((a, x) => a + x.cents, 0);
      out.push({ id: "dues_arrears", kind: "dues_arrears", tone: "warn", text: `Dues in arrears: ${owing.length === 1 ? "1 member owes" : `${owing.length} members owe`} ${money(ctx, total)}.`, short: "dues in arrears", tab: "money", needsYou: viewer !== null && (yours !== undefined || holds(ctx, org, viewer, "money.manage")) });
    } else if (yours) {
      out.push({ id: "dues_arrears", kind: "dues_arrears", tone: "warn", text: `Your dues are ${money(ctx, yours.cents)} behind.`, short: "your dues are behind", tab: "overview", needsYou: true });
    }
  }

  // Negative equity two months running (from Money 2): it owes more than it owns now, and did at the end of last month.
  if (level >= 2 && seesMoney && accountsOf(ctx, org).length > 0) {
    const worth = optionalQuery(ctx, "economy.net_worth")?.(ctx, org) ?? null;
    if (worth !== null && worth < 0 && worthAtMonthStart(ctx, org, worth) < 0) {
      out.push({ id: "negative_equity", kind: "negative_equity", tone: "neg", text: `Negative equity two months running: it owes ${money(ctx, -worth)} more than it owns.`, short: "negative equity", tab: "money", needsYou: viewer !== null && (holds(ctx, org, viewer, "money.manage") || holds(ctx, org, viewer, "org.govern")) });
    }
  }
  return out.length > 0 ? out : null;
}

/** A date a lease or a field writes (`YYYY-MM-DD`) as a clock reading at its start; null for anything else. */
function dayClock(ctx: ReadContext, text: string | null): number | null {
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const cal = calendarOf(ctx.world);
  return clockAt(cal, dayIndexOfText(cal, text), 0);
}

/** What is coming up for an organization within the window (§4.4), as `viewer` may see it; null when nothing is, or they may read none of its inner life. */
export function orgComing(ctx: ReadContext, org: EntityId, viewer: EntityId | null): OrgComingView[] | null {
  const type = orgTypeOf(ctx, org);
  if (type === null || !insider(ctx, org, viewer)) return null;
  const finance = optionalQuery(ctx, "economy.finance");
  if (!finance) return null;
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  const days = numOf(orgsSetting(ctx, "coming_days") as JsonValue | undefined, COMING_DAYS);
  const until = now + Math.max(1, Math.min(62, Math.round(days))) * DAY;
  // Paydays and dues each read as one line a day, counted ("Payday: 2 paychecks").
  const out: (OrgComingView & { count: number })[] = [];
  const day = (clock: number): number => dateAt(cal, clock).dayIndex;
  const add = (item: OrgComingView): void => {
    const same = item.kind === "payday" || item.kind === "dues" ? out.find((x) => x.kind === item.kind && x.text === item.text && day(x.clock) === day(item.clock)) : undefined;
    if (!same) {
      out.push({ ...item, count: 1 });
      return;
    }
    same.count++;
    same.cents = same.cents === null || item.cents === null ? null : same.cents + item.cents;
  };
  const lines = (fv: FinanceView): { clock: number; cents: number; flow: FlowView }[] => {
    const flows = new Map(fv.flows.map((f) => [f.id, f]));
    return (fv.overview?.upcoming ?? []).flatMap((u) => {
      const flow = u.flow === null ? undefined : flows.get(u.flow);
      return flow && u.clock >= now && u.clock <= until ? [{ clock: u.clock, cents: u.cents, flow }] : [];
    });
  };
  const dues = (f: FlowView): boolean => f.source === "dues" || f.category === "dues";
  const counts: Readonly<Record<string, [string, string]>> = { Payday: ["paycheck", "paychecks"], Dues: ["member", "members"] };
  if (holds(ctx, org, viewer, "money.view")) {
    const fv = finance(ctx, org, viewer !== null);
    for (const { clock, cents, flow } of lines(fv)) {
      if (flow.kind === "payroll") add({ kind: "payday", at: formatClock(cal, clock), clock, text: "Payday", cents });
      else if (flow.kind === "invoice") add({ kind: "invoice", at: formatClock(cal, clock), clock, text: `${cents >= 0 ? "Invoice due in" : "Invoice to pay"}: ${flow.label.replace(/^Invoice: /, "")}`, cents });
      else if (dues(flow)) add({ kind: "dues", at: formatClock(cal, clock), clock, text: "Dues", cents });
    }
    for (const p of fv.properties) {
      for (const l of p.leases) {
        const end = l.state === "let" ? dayClock(ctx, l.end) : null;
        if (end !== null && end >= now && end <= until) add({ kind: "lease", at: formatClock(cal, end), clock: end, text: `Lease ends: ${l.tenant} at ${p.name}`, cents: null });
      }
    }
  } else if (viewer !== null) {
    // A member who can't see its money sees what is theirs: their payday there, and their own dues.
    const jobs = jobsAt(ctx, org);
    for (const { clock, cents, flow } of lines(finance(ctx, viewer, true))) {
      if (flow.kind === "payroll" && flow.link !== null && jobs.includes(flow.link.id)) add({ kind: "payday", at: formatClock(cal, clock), clock, text: "Your payday", cents });
      else if (dues(flow) && flow.link?.id === org) add({ kind: "dues", at: formatClock(cal, clock), clock, text: "Your dues", cents });
    }
  }
  const items = out
    .map(({ count, ...item }) => {
      const nouns = own(counts, item.text);
      return nouns ? { ...item, text: `${item.text}: ${count} ${count === 1 ? nouns[0] : nouns[1]}` } : item;
    })
    .sort((a, b) => a.clock - b.clock || a.text.localeCompare(b.text));
  return items.length > 0 ? items : null;
}

// ---------------------------------------------------------------- titles for the People section

/** Whether the People section in force takes titles: its `titles` source, as this chat's or the world's sources pick (all of them when none are picked). */
function titlesOn(ctx: ReadContext): boolean {
  const section = ctx.world.sections.people ?? builtInSectionsOf(ctx.world).find((s) => s.id === "people");
  const feed = chatFeed(ctx.state).people ?? (section ? worldFeed(section) : {});
  return feed.include === undefined || feed.include.includes(TITLES_SOURCE);
}

/** The People section's source that gives titles: it draws no line of its own, so picking it is the switch. */
export const TITLES_SOURCE = "titles";

/** How a phrase starts in running text: its first letter lowered, unless it is an initialism ("CEO"). */
function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** At most this many titles on one person's line. */
const TITLES_KEPT = 2;

/**
 * Someone's titles where an organization relates to the player character (§3.15): each one the
 * player character belongs to or can see (never the party, whose tier marks it), where the person
 * belongs; a title that already says what it is of stands alone ("master of Harrowmere"), else it
 * names the organization ("owner of Alder Automotive"), and one the player character belongs to says
 * so ("where you work", "your household").
 */
export function personTitles(ctx: ReadContext, who: EntityId): string[] {
  if (!titlesOn(ctx)) return [];
  const pov = ctx.world.pov;
  const out: string[] = [];
  for (const org of Object.keys(ctx.state.entities).sort()) {
    const type = orgTypeOf(ctx, org);
    if (type === null || type === "party" || isGone(ctx.state, org)) continue;
    const rows = membersOfOrg(ctx, org);
    const theirs = rows.filter((r) => r.who === who && r.via === undefined);
    if (theirs.length === 0) continue;
    const mine = rows.filter((r) => r.who === pov);
    if (mine.length === 0 && !canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, org)) continue;
    const given = orgTitle(ctx, who, org);
    if (given === null || given.trim() === "") continue;
    // A bare word for how they belong (Owner, Member, Staff) tells something only where the player character belongs too; an owner's is their role there.
    const bare = Object.values(HOW_WORDS).some((word) => word.toLowerCase() === given.trim().toLowerCase());
    if (bare && mine.length === 0) continue;
    const role = given === HOW_WORDS.owner ? theirs.find((r) => r.how === "owner")?.role : undefined;
    const title = role !== undefined && role !== "owner" ? role.replace(/_/g, " ") : given;
    const orgName = own(ctx.state.entities, org)?.name ?? org;
    const staffOnly = theirs.every((r) => r.how === "staff");
    const phrase = / of /i.test(title) ? lowerFirst(title) : `${lowerFirst(title)} ${staffOnly ? "at" : "of"} ${orgName}`;
    const yours = mine.length === 0 ? "" : type === "household" ? ", your household" : mine.some((r) => r.how === "staff") ? ", where you work" : mine.some((r) => r.how === "owner") ? ", which you own" : ", which you belong to";
    out.push(`${phrase}${yours}`);
    if (out.length >= TITLES_KEPT) break;
  }
  return out;
}

// ---------------------------------------------------------------- a mind's Your organizations

/** Limits in words: "up to $500.00 a payment", "$2,000.00 a month", "only from Shop checking". */
function limitWords(ctx: ReadContext, limits: OrgLimits | undefined): string[] {
  if (!limits) return [];
  return [
    ...(limits.payment !== undefined ? [`up to ${money(ctx, limits.payment)} a payment`] : []),
    ...(limits.month !== undefined ? [`up to ${money(ctx, limits.month)} a month`] : []),
    ...(limits.accounts && limits.accounts.length > 0 ? [`only from ${limits.accounts.map((a) => own(ctx.state.entities, a)?.name ?? a).join(", ")}`] : []),
  ];
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const TYPE_WORDS: Readonly<Record<OrgType, string>> = { company: "a company", household: "a household", group: "a group", trust: "a trust", party: "a party" };

/** One organization as a mind of `who` reads it. */
function orgMindLine(ctx: ReadContext, who: EntityId, org: EntityId): string | null {
  const type = orgTypeOf(ctx, org);
  if (type === null) return null;
  const name = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
  const parts: string[] = [];
  const title = orgTitle(ctx, who, org);
  const held = heldPositions(ctx, who, org)[0];
  if (title !== null) parts.push(`you are ${title}${held && held.position.title.toLowerCase() !== title.toLowerCase() ? `, holding ${held.position.title}` : ""}`);
  const people = [...new Set(membersOfOrg(ctx, org).map((r) => r.who))].filter((id) => id !== who && orgTypeOf(ctx, id) === null && !isGone(ctx.state, id));
  if (held) {
    const reports = held.position.reports_to;
    const above = reports === undefined ? [] : people.filter((id) => heldPositions(ctx, id, org).some((h) => h.position.id === reports));
    const below = people.filter((id) => heldPositions(ctx, id, org).some((h) => h.position.reports_to === held.position.id));
    if (above.length > 0) parts.push(`you report to ${andList(above.map(name))}`);
    if (below.length > 0) parts.push(`${andList(below.map(name))} ${below.length === 1 ? "reports" : "report"} to you`);
  }
  const powers = orgPowers(ctx, who, org).filter((p) => p.grant.basis !== "delegate");
  const limits = held ? limitWords(ctx, held.position.limits) : [];
  if (powers.length === ORG_POWERS.length) parts.push("you may do anything for it");
  else if (powers.length > 0) parts.push(`you may ${andList(powers.map((p) => POWER_WORDS[p.power]))}${limits.length > 0 ? `, ${andList(limits)}` : ""}`);
  const lines = [`${name(org)} (${TYPE_WORDS[type]}): ${parts.length > 0 ? parts.join("; ") : "you belong to it"}.`];
  for (const d of delegationsOf(ctx, org).filter((x) => x.who === who)) {
    const words = d.powers.map((p) => POWER_WORDS[p]);
    const extra = limitWords(ctx, d.limits);
    lines.push(`You act for ${name(org)}${d.by ? ` by ${name(d.by)}'s delegation` : ""}: you may ${andList(words)}${extra.length > 0 ? `, ${andList(extra)}` : ""}${d.until !== undefined ? `, until ${formatClock(calendarOf(ctx.world), d.until)}` : ""}.`);
  }
  return lines.join(" ");
}

/** A mind's Your organizations (§3.15): the orders asked of them first, then each organization they belong to or act for, the party they travel with among them. */
export function orgMindLines(ctx: ReadContext, who: EntityId): string[] {
  const orgs = Object.keys(ctx.state.entities)
    .sort()
    .filter((org) => orgTypeOf(ctx, org) !== null && !isGone(ctx.state, org) && (membersOfOrg(ctx, org).some((r) => r.who === who) || delegationsOf(ctx, org).some((d) => d.who === who)));
  const lines = orgs.flatMap((org) => orgMindLine(ctx, who, org) ?? []);
  const party = partyIdOf(ctx);
  if (!party.exists) {
    const row = partyRoster(ctx, ctx.world.pov).find((r) => r.who === who && r.how !== "leader");
    if (row) lines.push(`You travel with ${own(ctx.state.entities, ctx.world.pov)?.name ?? ctx.world.pov} (the player character) in their party, as ${row.how === "core" ? "a core member" : row.how === "companion" ? "a companion" : row.how === "hired" ? "a hired hand" : "an ally"}.`);
  }
  return [...planMindLines(ctx, who), ...lines.map((l) => `- ${l}`)];
}

/** The alerts and Coming up sections, and the People section's titles and their switch. */
export function registerFeed(r: CoreRegistry): void {
  r.orgSection({ id: ALERTS_SECTION, label: "Alerts", build: (ctx, org, viewer) => orgAlerts(ctx, org, viewer) as unknown as JsonValue | null });
  r.orgSection({ id: COMING_SECTION, label: "Coming up", build: (ctx, org, viewer) => orgComing(ctx, org, viewer) as unknown as JsonValue | null });
  r.renderer({ slot: "people", source: TITLES_SOURCE, label: "People's titles where an organization ties them to your character", render: () => [] });
  r.query("orgs.titles", personTitles);
}
