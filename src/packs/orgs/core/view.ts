// The Orgs tab's views (ORG-SPEC §4.2-4.4, §3.16): the home (`orgs.list`: the party, where the
// player character belongs, the organizations they know of) and each organization's page
// (`orgs.org`: their place there, who runs it, its people, positions and delegations, and the packs'
// sections behind their powers). The party is always there: before it has an entity of its own its
// page is read from the leader's roster, under the id it would take (`party_<leader>`). Members the
// reader can't see are counted and stand in under an opaque id; the GM (`viewer` null) sees all. Pure.

import { opaqueId } from "../../../shared/hash";
import { STRUCTURE_LABELS } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonValue } from "../../../shared/json";
import { DUES_EVERY, MERGED_INTO_FIELD, ORG_POWER_FAMILIES, ORG_POWERS, POWER_WORDS, type Delegation, type MemberHow, type OrgGrant, type OrgMember, type OrgPower, type OrgType, type Position } from "../../../shared/org";
import type { OrgDelegationView, OrgDuesView, OrgEndedView, OrgHistoryLineView, OrgListView, OrgPersonView, OrgPositionView, OrgPowerView, OrgRef, OrgRowView, OrgView, PartyMemberView } from "../../../shared/org-view";
import { isPartyTier, PARTY_KIND, PARTY_SECTION } from "../../../shared/party";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf, formatClock } from "../../../engine/calendar";
import { dayWords, defaultPowers, delegationsOf, dissolvedOn, heldPositions, HOW_WORDS, LEADER, membersOfOrg, orgPower, orgPowers, orgTitle, orgTypeOf, partyRoster, positionsOf, windingUpSince, type HeldPosition } from "../../../engine/org";
import { acts } from "../../../engine/life";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { povMayKnow } from "../../../engine/player-events";
import { together } from "../../../engine/presence";
import type { ReadContext } from "../../../engine/registry";
import { isGone, kindDef, kindIs, placeOfEntity } from "../../../engine/scope";
import { isMemberOf, membersOf } from "../../../engine/selector";
import { canSeeEntity } from "../../../engine/visibility";
import { startOptions } from "./found";
import { orgHistory } from "./log";

/** The order the home groups where one belongs, and the order its rows' ways of belonging read. */
const TYPE_ORDER: readonly OrgType[] = ["household", "company", "group", "trust", "party"];
const HOW_ORDER: readonly MemberHow[] = ["owner", "leader", "member", "staff", "core", "companion", "hired", "ally"];

/** A date as a link writes it (`YYYY-MM-DD`) in the world's calendar's words ("12 Jan 2026"), as the calendar's view writes today's; anything else as written. */
export function dateWords(ctx: ReadContext, text: string): string {
  return dayWords(ctx.world, text);
}

/** The party the player character leads: its entity when it has one, else the id it will take. */
export function partyIdOf(ctx: ReadContext): { id: EntityId; exists: boolean } {
  const pov = ctx.world.pov;
  const id = Object.keys(ctx.state.entities)
    .sort()
    .find((p) => !isGone(ctx.state, p) && orgTypeOf(ctx, p) === "party" && own(ctx.state.entities, p)?.fields.leader === pov);
  return id === undefined ? { id: `${PARTY_KIND}_${pov}`, exists: false } : { id, exists: true };
}

/** What a page is read from: an organization's entity, or the party before it has one. */
interface Subject {
  id: EntityId;
  type: OrgType;
  exists: boolean;
  rows: OrgMember[];
}

function subjectOf(ctx: ReadContext, id: EntityId): Subject | null {
  const type = orgTypeOf(ctx, id);
  if (type !== null && !isGone(ctx.state, id)) return { id, type, exists: true, rows: membersOfOrg(ctx, id) };
  const party = partyIdOf(ctx);
  return !party.exists && id === party.id ? { id, type: "party", exists: false, rows: partyRoster(ctx, ctx.world.pov) } : null;
}

/** The powers `who` holds in `id`, each with its basis, as its page reads them (the party's from its roster before it has an entity); none for an id that is no organization. */
export function powersAt(ctx: ReadContext, id: EntityId, who: EntityId): { power: OrgPower; grant: OrgGrant }[] {
  const subject = subjectOf(ctx, id);
  return subject ? new Page(ctx, subject, null).powersOf(who) : [];
}

/** An organization's rows as its page reads them: its members', or the party's roster before it has an entity; none for an id that is no organization. */
export function rowsAt(ctx: ReadContext, id: EntityId): OrgMember[] {
  return subjectOf(ctx, id)?.rows ?? [];
}

/** Everything one page reads about the reader and the people in it. */
class Page {
  readonly seen: (id: EntityId) => boolean;
  readonly name: (id: EntityId) => string;
  private readonly at: string | null;
  private readonly held = new Map<EntityId, HeldPosition[]>();

  constructor(
    readonly ctx: ReadContext,
    readonly subject: Subject,
    readonly viewer: EntityId | null,
  ) {
    this.seen = (id) => viewer === null || id === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, id);
    this.name = (id) => own(ctx.state.entities, id)?.name ?? id;
    this.at = placeOfEntity(ctx.state, ctx.world.pov);
  }

  /** The positions `who` holds here: those the organization defines and its type's defaults; the party's Leader before it has an entity. */
  positionsHeld(who: EntityId): HeldPosition[] {
    let out = this.held.get(who);
    if (!out) {
      const { subject } = this;
      const leader = subject.rows.find((r) => r.how === "leader" && r.who === who);
      out = subject.exists ? heldPositions(this.ctx, who, subject.id) : leader ? [{ position: { id: LEADER, title: "Leader", powers: [...ORG_POWERS], seats: 1, scope: "org", successor: "vacant" }, row: leader }] : [];
      this.held.set(who, out);
    }
    return out;
  }

  /** The powers `who` holds here, each with its basis. */
  powersOf(who: EntityId): { power: OrgPower; grant: OrgGrant }[] {
    const { subject } = this;
    if (subject.exists) return orgPowers(this.ctx, who, subject.id);
    const rows = subject.rows.filter((r) => r.who === who);
    if (rows.some((r) => r.how === "leader")) return ORG_POWERS.map((power) => ({ power, grant: { basis: "position", id: LEADER } }));
    return ORG_POWERS.filter((p) => p !== "assets.assign" && p !== "assets.dispose" && rows.some((r) => defaultPowers("party", r.how).includes(p))).map((power) => ({ power, grant: { basis: "member" } }));
  }

  /** The title `who` goes by here: as the organization gives it, or, through a member group, as that group does. */
  titleOf(who: EntityId, rows: readonly OrgMember[]): string {
    const { subject } = this;
    const via = rows.find((r) => r.via !== undefined)?.via;
    const given = subject.exists ? orgTitle(this.ctx, who, rows.every((r) => r.via !== undefined) && via !== undefined ? via : subject.id) : null;
    return given ?? HOW_WORDS[HOW_ORDER.find((h) => rows.some((r) => r.how === h)) ?? "member"];
  }

  here(who: EntityId): boolean {
    return together(this.ctx.world, this.at, placeOfEntity(this.ctx.state, who));
  }

  ref(id: EntityId): OrgRef {
    return this.seen(id) ? { id, name: this.name(id) } : { id: opaqueId(id), name: "someone" };
  }

  person(who: EntityId, rows: readonly OrgMember[]): OrgPersonView {
    const held = this.positionsHeld(who)[0];
    const by = (how: MemberHow): OrgMember | undefined => rows.find((r) => r.how === how);
    const owner = by("owner");
    const titled = rows.find((r) => r.title !== undefined) ?? rows[0];
    const via = rows.find((r) => r.via !== undefined)?.via;
    const since = held?.row.since ?? titled?.since ?? rows.find((r) => r.since !== undefined)?.since;
    const job = by("staff")?.job ?? null;
    const status = job === null ? undefined : own(this.ctx.state.entities, job)?.fields.status;
    return {
      id: who,
      name: this.name(who),
      title: this.titleOf(who, rows),
      hows: HOW_ORDER.filter((h) => rows.some((r) => r.how === h)),
      position: held ? { id: held.position.id, title: held.position.title } : null,
      rank: rows.find((r) => r.rank !== undefined)?.rank ?? null,
      since: since ? dateWords(this.ctx, since) : null,
      here: this.here(who),
      job,
      status: status === "leave" ? "leave" : job === null ? null : "active",
      role: owner?.role ?? null,
      share: owner ? rows.filter((r) => r.how === "owner").reduce((a, r) => a + (r.share ?? 0), 0) : null,
      via: via === undefined ? null : this.ref(via),
      // A delegation's granter stands under their opaque id for a reader who can't see them.
      powers: this.powersOf(who).map(({ power, grant }) => ({ power, basis: grant.basis, id: grant.id === undefined ? null : grant.basis === "delegate" ? this.ref(grant.id).id : grant.id, words: POWER_WORDS[power] })),
      you: who === this.viewer,
    };
  }

  delegation(d: Delegation): OrgDelegationView {
    return { who: this.ref(d.who), powers: d.powers, limits: d.limits ?? null, until: d.until === undefined ? null : formatClock(calendarOf(this.ctx.world), d.until), by: d.by === undefined ? null : this.ref(d.by) };
  }
}

/** The people on a page, each once with every way they belong; those the reader can't see, apart. */
function peopleOf(page: Page): { people: OrgPersonView[]; hidden: EntityId[] } {
  const byWho = new Map<EntityId, OrgMember[]>();
  for (const row of page.subject.rows) {
    if (orgTypeOf(page.ctx, row.who) !== null) continue;
    byWho.set(row.who, [...(byWho.get(row.who) ?? []), row]);
  }
  const people: OrgPersonView[] = [];
  const hidden: EntityId[] = [];
  for (const who of [...byWho.keys()].sort()) {
    if (page.seen(who)) people.push(page.person(who, byWho.get(who) ?? []));
    else hidden.push(who);
  }
  return { people, hidden };
}

/** A page's positions: those the organization defines, then a type's default one somebody holds (a household's Head, the party's Leader). */
function positionsView(page: Page, everyone: readonly EntityId[]): OrgPositionView[] {
  const { subject } = page;
  const authored = subject.exists ? positionsOf(page.ctx, subject.id) : [];
  const implied: Position[] = [];
  for (const who of everyone) for (const h of page.positionsHeld(who)) if (!authored.some((p) => p.id === h.position.id) && !implied.some((p) => p.id === h.position.id)) implied.push(h.position);
  return [...authored, ...implied].map((p) => {
    const holders = everyone.filter((who) => page.positionsHeld(who).some((h) => h.position.id === p.id));
    const reports = p.reports_to === undefined ? undefined : authored.find((q) => q.id === p.reports_to);
    return {
      id: p.id,
      title: p.title,
      powers: p.powers,
      seats: p.seats,
      filled: holders.length,
      reportsTo: reports ? { id: reports.id, title: reports.title } : null,
      scope: p.scope,
      limits: p.limits ?? null,
      successor: p.successor === "next" || p.successor === "vacant" ? p.successor : page.ref(p.successor).name,
      successorId: p.successor === "next" || p.successor === "vacant" ? null : page.ref(p.successor).id,
      joinsIn: p.default === true,
      implied: !authored.includes(p),
      holders: holders.filter((who) => page.seen(who)),
      hidden: holders.filter((who) => !page.seen(who)).length,
    };
  });
}

/** An organization's Money level (§3.1): a business's and a trust's own; any other's its members' highest. */
function levelOf(ctx: ReadContext, subject: Subject): number {
  const own = subject.exists ? ctx.levelOf(subject.id, "money") : 0;
  if (subject.exists && (subject.type === "company" || subject.type === "trust")) return own;
  const members = subject.exists ? membersOf(ctx.registry, ctx.world, ctx.state, subject.id) : subject.rows.map((r) => r.who);
  return Math.max(own, ...members.map((m) => ctx.levelOf(m, "money")));
}

/** The header's words for what it is: its type, a company's structure, a group's kind. */
function header(ctx: ReadContext, subject: Subject): { name: string; kind: string; structure: string | null; badge: string } {
  const e = own(ctx.state.entities, subject.id);
  const kind = e ? (kindDef(ctx.registry, ctx.world, e.kind)?.label ?? e.kind) : "Party";
  const raw = e?.fields.structure;
  const structure = subject.type === "company" && typeof raw === "string" ? (STRUCTURE_LABELS[raw] ?? null) : null;
  const badge = subject.type === "company" ? (structure ? `Company · ${structure}` : "Company") : subject.type === "group" ? (kind === "Group" ? "Group" : `Group · ${kind}`) : subject.type === "household" ? "Household" : subject.type === "trust" ? "Trust" : "Party";
  return { name: e?.name ?? "Your party", kind, structure, badge };
}

/**
 * Its History as the page's reader may read it (§4.4): newest first, anyone they can't see named
 * "someone", and a line done with a money power only where they may see its money.
 */
function historyOf(page: Page): OrgHistoryLineView[] {
  const { ctx, subject, viewer } = page;
  if (!subject.exists) return [];
  const money: readonly OrgPower[] = ORG_POWER_FAMILIES.money;
  const seesMoney = viewer === null || orgPower(ctx, viewer, subject.id, "money.view") !== null;
  const cal = calendarOf(ctx.world);
  return orgHistory(ctx.state, subject.id)
    .filter((line) => seesMoney || line.power === undefined || !money.includes(line.power))
    .map((line) => ({
      at: formatClock(cal, line.at),
      text: (line.names ?? []).reduce((text, n) => (page.seen(n.id) ? text : text.split(n.name).join("someone")), line.text),
      by: line.by === undefined ? null : page.ref(line.by),
    }));
}

/** Its dues as its `dues` field sets them (§3.8, a one-record list): so much each, every week, month or year, on a day of it; null when it sets none that pays anything. */
function duesOf(ctx: ReadContext, subject: Subject): OrgDuesView | null {
  const raw = subject.exists ? own(ctx.state.entities, subject.id)?.fields.dues : undefined;
  const d = Array.isArray(raw) ? raw.find(isRecord) : raw;
  if (!isRecord(d) || typeof d.cents !== "number" || d.cents <= 0) return null;
  const every = DUES_EVERY.find((e) => e === (d.every ?? "month"));
  return every ? { cents: Math.round(d.cents), every, day: typeof d.day === "number" && Number.isInteger(d.day) ? d.day : null } : null;
}

/** The powers whose editors name someone from outside it (§4.4: Hire someone, Admit a member, Delegate…). */
const NAMING: readonly OrgPower[] = ["staff.hire", "members.admit", "delegate"];

/** Whom the player character may name in those editors: each person they may know of who acts, by name; none for a reader without one of their powers, or for the GM, who names anyone. */
function candidatesOf(ctx: ReadContext, subject: Subject, viewer: EntityId | null, powers: readonly OrgPowerView[]): OrgRef[] {
  if (viewer === null || viewer !== ctx.world.pov || !subject.exists || !powers.some((p) => NAMING.includes(p.power))) return [];
  return Object.keys(ctx.state.entities)
    .filter((id) => id !== viewer && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && acts(ctx.world, ctx.state, id) && povMayKnow(ctx.registry, ctx.world, ctx.state, id))
    .map((id) => ({ id, name: own(ctx.state.entities, id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** One organization's page as `viewer` may see it; null for an id that is no organization. */
export function buildOrgView(ctx: ReadContext, id: EntityId, viewer: EntityId | null): OrgView | null {
  const subject = subjectOf(ctx, id);
  if (!subject) return null;
  const page = new Page(ctx, subject, viewer);
  const { people, hidden } = peopleOf(page);
  const everyone = [...people.map((p) => p.id), ...hidden];
  const governs = (who: EntityId): boolean => page.powersOf(who).some((p) => p.power === "org.govern" && (p.grant.basis === "owner" || p.grant.basis === "position"));
  const runBy = [...everyone].sort().filter(governs).map((who) => page.ref(who));
  const mine = viewer === null ? [] : subject.rows.filter((r) => r.who === viewer);
  const held = viewer === null ? undefined : page.positionsHeld(viewer)[0];
  const reports = held?.position.reports_to;
  const delegations = subject.exists ? delegationsOf(ctx, subject.id) : [];
  const powers: OrgPowerView[] = viewer === null ? [] : page.powersOf(viewer).map(({ power, grant }) => ({ power, basis: grant.basis, id: grant.id ?? null, words: POWER_WORDS[power] }));
  const sections: Record<string, JsonValue> = {};
  // The party's page is there before its entity is (§3.12): then only the sections no power guards
  // build for it (its own `party`), since every power over it needs its entity.
  for (const def of ctx.registry.orgSections) {
    if (def.power !== undefined && (!subject.exists || (viewer !== null && orgPower(ctx, viewer, subject.id, def.power) === null))) continue;
    const built = def.build(ctx, subject.id, viewer);
    if (built !== null) sections[def.id] = built;
  }
  const authored = subject.exists ? positionsOf(ctx, subject.id) : [];
  const ended = endedOf(page);
  // A company's History stays with those it names once it is wound up, though no one belongs to it any more.
  const named = ended?.dissolved != null && viewer !== null && orgHistory(ctx.state, subject.id).some((l) => l.by === viewer || (l.names ?? []).some((n) => n.id === viewer));
  return {
    id: subject.id,
    ...header(ctx, subject),
    type: subject.type,
    level: levelOf(ctx, subject),
    exists: subject.exists,
    ended,
    you: {
      belongs: mine.length > 0,
      title: mine.length > 0 && viewer !== null ? page.titleOf(viewer, mine) : null,
      position: held ? { id: held.position.id, title: held.position.title } : null,
      since: mine.length > 0 && viewer !== null ? page.person(viewer, mine).since : null,
      reportsTo: reports === undefined ? [] : everyone.filter((who) => page.positionsHeld(who).some((h) => h.position.id === reports)).map((who) => page.ref(who)),
      powers,
      delegations: delegations.filter((d) => d.who === viewer).map((d) => page.delegation(d)),
    },
    runBy,
    people,
    hidden: { count: hidden.length, ids: hidden.map(opaqueId) },
    positions: positionsView(page, everyone),
    delegations: delegations.filter((d) => page.seen(d.who)).map((d) => page.delegation(d)),
    defaultPosition: authored.find((p) => p.default === true)?.id ?? null,
    // Its dues are read by those in it, a holder of a power there and the GM.
    dues: viewer === null || mine.length > 0 || powers.length > 0 ? duesOf(ctx, subject) : null,
    // Its History is read by those in it, or holding a power there, and the GM.
    history: viewer === null || mine.length > 0 || powers.length > 0 || named ? historyOf(page) : [],
    candidates: candidatesOf(ctx, subject, viewer, powers),
    sections,
  };
}

/** A company's end (§3.13): since when it winds up, or when it was dissolved and what a merger folded it into; null while it stands. */
function endedOf(page: Page): OrgEndedView | null {
  const { ctx, subject } = page;
  if (!subject.exists || subject.type !== "company") return null;
  const dissolved = dissolvedOn(ctx.state, subject.id);
  const winding = windingUpSince(ctx.state, subject.id);
  if (dissolved === null && winding === null) return null;
  const into = own(ctx.state.entities, subject.id)?.fields[MERGED_INTO_FIELD];
  return { winding: winding === null ? null : dayWords(ctx.world, winding), dissolved: dissolved === null ? null : dayWords(ctx.world, dissolved), mergedInto: typeof into === "string" && into !== "" ? page.ref(into) : null };
}

/** The one figure a row shows that the reader may see (§4.2): a company's profit this month, a household's shared costs and their share, a group's members, a trust's net worth. */
function figureOf(ctx: ReadContext, org: EntityId, type: OrgType, viewer: EntityId): string | null {
  const money = (cents: number): string => formatMoney(cents, ctx.world.currency);
  const dissolved = dissolvedOn(ctx.state, org);
  if (dissolved !== null) return `Dissolved ${dayWords(ctx.world, dissolved)}`;
  const winding = windingUpSince(ctx.state, org);
  if (winding !== null) return `Winding up since ${dayWords(ctx.world, winding)}`;
  const sees = orgPower(ctx, viewer, org, "money.view") !== null;
  if (type === "group") {
    const n = membersOf(ctx.registry, ctx.world, ctx.state, org).length;
    return `${n} member${n === 1 ? "" : "s"}`;
  }
  if (!sees) return null;
  if (type === "company") {
    const cal = calendarOf(ctx.world);
    const d = dateAt(cal, ctx.state.clock);
    const books = optionalQuery(ctx, "economy.business_books")?.(ctx, org, clockAt(cal, dayIndexOf(cal, d.year, d.month, 1), 0), ctx.state.clock + 1);
    return books ? `${books.profit >= 0 ? "Profit" : "Loss"} this month: ${money(Math.abs(books.profit))}` : null;
  }
  if (type === "household") {
    const monthly = optionalQuery(ctx, "economy.finance")?.(ctx, org, true).household?.monthly;
    if (!monthly || monthly.total === 0) return null;
    const part = monthly.parts.find((p) => p.id === viewer)?.cents;
    return `Shared costs ${money(monthly.total)} a month${part === undefined ? "" : `; your share ${money(part)}`}`;
  }
  if (type === "trust") {
    const worth = optionalQuery(ctx, "economy.net_worth")?.(ctx, org);
    return worth === null || worth === undefined ? null : `Net worth ${money(worth)}`;
  }
  return null;
}

/** The organizations the player character may see, besides the party: every one they belong to (secret ones too), and those they can see, in id order. */
function shownOrgs(ctx: ReadContext): { id: EntityId; type: OrgType; belongs: boolean }[] {
  const pov = ctx.world.pov;
  return Object.keys(ctx.state.entities)
    .sort()
    .flatMap((id) => {
      const type = orgTypeOf(ctx, id);
      if (type === null || type === "party" || isGone(ctx.state, id)) return [];
      const belongs = isMemberOf(ctx, pov, id);
      return belongs || canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id) ? [{ id, type, belongs }] : [];
    });
}

/** The Orgs home (`orgs.list`). */
export function buildOrgList(ctx: ReadContext): OrgListView {
  const pov = ctx.world.pov;
  const party = partyIdOf(ctx);
  const page = new Page(ctx, subjectOf(ctx, party.id) ?? { id: party.id, type: "party", exists: false, rows: [] }, pov);
  const members: PartyMemberView[] = [];
  let hidden = 0;
  for (const r of page.subject.rows) {
    if (r.how === "leader" || !isPartyTier(r.how)) continue;
    if (page.seen(r.who)) members.push({ ...page.ref(r.who), tier: r.how, here: page.here(r.who) });
    else hidden++;
  }
  const row = (id: EntityId, type: OrgType, belongs: boolean): OrgRowView => ({ id, name: own(ctx.state.entities, id)?.name ?? id, type, kind: header(ctx, { id, type, exists: true, rows: [] }).kind, title: belongs ? orgTitle(ctx, pov, id) : null, figure: figureOf(ctx, id, type, pov) });
  const orgs = shownOrgs(ctx).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.id.localeCompare(b.id));
  // The card's purse line, as the party's own section reads it for the player character (§4.2).
  const section = ctx.registry.orgSections.find((d) => d.id === PARTY_SECTION)?.build(ctx, party.id, pov);
  const purse = isRecord(section) && isRecord(section.purse) && typeof section.purse.balance === "string" ? section.purse.balance : null;
  return {
    party: { id: party.id, name: header(ctx, page.subject).name, exists: party.exists, members, hidden, purse },
    belong: orgs.filter((o) => o.belongs).map((o) => row(o.id, o.type, true)),
    known: orgs
      .filter((o) => !o.belongs)
      .map((o) => ({
        ...row(o.id, o.type, false),
        whom: [...new Set(membersOfOrg(ctx, o.id).map((r) => r.who))].filter((who) => who !== pov && orgTypeOf(ctx, who) === null && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, who)).sort().map((who) => ({ id: who, name: own(ctx.state.entities, who)?.name ?? who })),
      })),
    start: startOptions(ctx, pov),
  };
}

/** Every page the home opens (`orgs.org`): the party's and each organization it lists, by id, as the player character may see them. */
export function buildOrgPages(ctx: ReadContext): Record<EntityId, OrgView> {
  const out: Record<EntityId, OrgView> = {};
  for (const id of [partyIdOf(ctx).id, ...shownOrgs(ctx).map((o) => o.id)]) {
    const view = buildOrgView(ctx, id, ctx.world.pov);
    if (view) out[id] = view;
  }
  return out;
}
