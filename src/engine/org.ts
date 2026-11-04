// Organizations (ORG-SPEC §3): what an organization is (`orgTypeOf`), who belongs to it and how
// (`membersOfOrg`, over each kind's membership provider), its positions and the titles its people go
// by, the powers someone holds in it and why (`orgPower`), whether they may use one now (`mayAct`:
// limits, scope and the fiduciary rule), who works for it (`isStaff`), the places that are its
// (`orgPlaces`), the business trading at a place (`businessAt`), whether a business trades at a time
// (`trading`) and whom a place's entry admits (`placeEntry`). Each is pure and read when asked, never
// in the fold; nothing here is written. With no positions authored, the defaults give today's rights
// (§3.4), the household Head their one addition.

import { ownersIn, ROLE_RIGHTS, worthShares } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { ACTS_FOR, isAudience, limitsIn, ORG_POWERS, overLimit, positionsIn, powerCovers, powersIn, POWER_WORDS, type Audience, type Delegation, type OrgGrant, type OrgLimits, type OrgMember, type OrgPower, type OrgType, type Position } from "../shared/org";
import { PARTY_KIND, PARTY_RELATION, partyTierOf } from "../shared/party";
import { calendarOf, dateAt, dayIndexOfText, holidaysOn, parseHHMM, placeOffset } from "./calendar";
import { acts } from "./life";
import { labelOf, numOf, objOf, optionalQuery, own, sliceOf } from "./pack-kit";
import { passMemo } from "./read-pass";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "./scope";
import { together } from "./presence";
import { COMPANY_KIND, GROUP_KIND, isMemberOf, linkedMemberOf, providersOf, type MembershipContext } from "./selector";

type OrgContext = MembershipContext;

/**
 * What an organization is, by its kind: a business is a company; a household, a trust and the party
 * are themselves; any other group (a family, a faction, a company group with no owners) is a group.
 * Null for anything that isn't one.
 */
export function orgTypeOf(ctx: OrgContext, org: EntityId): OrgType | null {
  const e = own(ctx.state.entities, org);
  if (!e) return null;
  const is = (kind: string): boolean => kindIs(ctx.registry, ctx.world, e.kind, kind);
  if (is(COMPANY_KIND)) return "company";
  if (is("household")) return "household";
  if (is("trust")) return "trust";
  if (is(PARTY_KIND)) return "party";
  return is(GROUP_KIND) ? "group" : null;
}

// ---------------------------------------------------------------- membership

/**
 * An organization's own rows: those of every membership provider up its kind's chain, the most
 * general first, with its staff after those who belong to it (a company: its member links, its
 * owners, then its staff).
 */
export function directMembers(ctx: OrgContext, org: EntityId): OrgMember[] {
  const e = own(ctx.state.entities, org);
  if (!e) return [];
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.direct:${org}`, () => {
    const rows = providersOf(ctx.registry, ctx.world, e.kind).flatMap(({ provider }) => provider(ctx, org));
    return [...rows.filter((r) => r.how !== "staff"), ...rows.filter((r) => r.how === "staff")];
  });
}

/** How deep member groups nest (as `member_of` links are followed). */
const NESTING = 8;

/**
 * An organization's members (§3.2): its own rows, then, for each member group, its members' rows,
 * each marked with the member group it counts through (`via`). Removed members are left out.
 */
export function membersOfOrg(ctx: OrgContext, org: EntityId): OrgMember[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.members:${org}`, () => {
    const out: OrgMember[] = [];
    const seen = new Set<EntityId>([org]);
    let frontier: { id: EntityId; via?: EntityId }[] = [{ id: org }];
    for (let depth = 0; frontier.length > 0 && depth < NESTING; depth++) {
      const next: { id: EntityId; via?: EntityId }[] = [];
      for (const { id, via } of frontier) {
        for (const row of directMembers(ctx, id)) {
          if (isGone(ctx.state, row.who)) continue;
          out.push(via === undefined ? row : { ...row, via });
          if (row.how === "member" && !seen.has(row.who) && orgTypeOf(ctx, row.who) !== null) {
            seen.add(row.who);
            next.push({ id: row.who, via: via ?? row.who });
          }
        }
      }
      frontier = next;
    }
    return out;
  });
}

/** The party led by `leader`: the leader, then whoever travels with them, each in their tier and since when, in id order. */
export function partyRoster(ctx: OrgContext, leader: EntityId): OrgMember[] {
  const out: OrgMember[] = own(ctx.state.entities, leader) ? [{ who: leader, how: "leader" }] : [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const link = own(ctx.state.entities, id)?.relations.find((r) => r.type === PARTY_RELATION && r.to === leader);
    if (!link || id === leader) continue;
    const since = link.fields?.since;
    out.push({ who: id, how: partyTierOf(link.fields), ...(typeof since === "string" && since !== "" ? { since } : {}) });
  }
  return out;
}

/** The party's leader: a party entity's `leader`, else the player character. */
export function partyLeader(ctx: OrgContext, party: EntityId): EntityId {
  const leader = own(ctx.state.entities, party)?.fields.leader;
  return typeof leader === "string" && leader !== "" ? leader : ctx.world.pov;
}

/**
 * The members step of the audience ladder (ITEMS-SPEC §3.4): whether `who` belongs to `org` other
 * than by working for it, which is the staff step: a member, an owner, the party's leader or one of
 * its people, directly or through a member group.
 */
export function belongsTo(ctx: OrgContext, who: EntityId, org: EntityId): boolean {
  if (isGone(ctx.state, who) || !isMemberOf(ctx, who, org)) return false;
  return membersOfOrg(ctx, org).some((r) => r.who === who && (r.how !== "staff" || r.via !== undefined));
}

// ---------------------------------------------------------------- staff

/** Whether a job is in force on the day of `clock`: active or on leave, started, and its last day (`end`) not past. */
function jobInForce(ctx: OrgContext, fields: Readonly<Record<string, JsonValue>>): boolean {
  if (fields.status === "ended") return false;
  const cal = calendarOf(ctx.world);
  const today = dateAt(cal, ctx.state.clock).dayIndex;
  const day = (v: JsonValue | undefined): number | null => {
    if (typeof v !== "string" || v === "") return null;
    try {
      return dayIndexOfText(cal, v);
    } catch {
      return null;
    }
  };
  const start = day(fields.start);
  const end = day(fields.end);
  return (start === null || start <= today) && (end === null || today <= end);
}

/** Whom a job's `employer` names: a party by id; a place, the business trading there, else the place itself; null for an outside name. */
function employerOf(ctx: OrgContext, employer: JsonValue | undefined): EntityId | null {
  if (typeof employer !== "string" || employer === "") return null;
  if (own(ctx.state.entities, employer)) return employer;
  return own(ctx.world.places, employer) ? (businessAt(ctx, employer) ?? employer) : null;
}

/** The jobs in force whose employer is `org` (by id, or a place it trades at), in id order. */
export function jobsAt(ctx: OrgContext, org: EntityId): EntityId[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.jobs:${org}`, () =>
    Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => {
        const e = own(ctx.state.entities, id);
        return !!e && kindIs(ctx.registry, ctx.world, e.kind, "job") && !isGone(ctx.state, id) && jobInForce(ctx, e.fields) && employerOf(ctx, e.fields.employer) === org;
      }),
  );
}

/**
 * Whether `who` works for `org`, and by what: a job in force whose worker they are and whose
 * employer is `org`; an employer named by a place counts for the business trading there, else for
 * that place itself (`org` a place's id). Null when they don't.
 */
export function isStaff(ctx: OrgContext, who: EntityId, org: EntityId): { basis: "job" | "position"; id: EntityId } | null {
  const job = jobsAt(ctx, org).find((id) => own(ctx.state.entities, id)?.fields.worker === who);
  return job === undefined ? null : { basis: "job", id: job };
}

// ---------------------------------------------------------------- positions and titles

/** The positions an organization defines (its `positions` field). */
export function positionsOf(ctx: OrgContext, org: EntityId): Position[] {
  return positionsIn(own(ctx.state.entities, org)?.fields.positions);
}

/** The position id of the household's Head (§3.4). */
export const HEAD = "head";
/** The position id of the party's Leader. */
export const LEADER = "leader";

/**
 * A household's Head (§3.4): the member holding its `head` position, else the member titled
 * "head" (any case), the most senior by rank, then by id; null for none.
 */
export function headOf(ctx: OrgContext, household: EntityId): EntityId | null {
  if (orgTypeOf(ctx, household) !== "household") return null;
  const rows = directMembers(ctx, household).filter((r) => !isGone(ctx.state, r.who) && acts(ctx.world, ctx.state, r.who));
  const senior = (list: OrgMember[]): EntityId | null => [...list].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.who.localeCompare(b.who))[0]?.who ?? null;
  if (positionsOf(ctx, household).some((p) => p.id === HEAD)) return senior(rows.filter((r) => r.position === HEAD));
  return senior(rows.filter((r) => r.how === "member" && r.title?.trim().toLowerCase() === HEAD));
}

/** A position someone holds in an organization, with the row that holds it. */
export interface HeldPosition {
  position: Position;
  row: OrgMember;
}

/**
 * The positions `who` holds in `org`: those their `member_of` link or job there names that the
 * organization defines; and its default ones: a household's Head when it defines no `head` of its
 * own, the party's Leader.
 */
export function heldPositions(ctx: OrgContext, who: EntityId, org: EntityId): HeldPosition[] {
  const defined = positionsOf(ctx, org);
  const rows = directMembers(ctx, org).filter((r) => r.who === who);
  const out: HeldPosition[] = [];
  for (const row of rows) {
    const p = row.position === undefined ? undefined : defined.find((d) => d.id === row.position);
    if (p && !out.some((h) => h.position.id === p.id)) out.push({ position: p, row });
  }
  const type = orgTypeOf(ctx, org);
  const all = (id: string, title: string): Position => ({ id, title, powers: [...ORG_POWERS], seats: 1, scope: "org", successor: "vacant" });
  const member = rows.find((r) => r.how === "member");
  if (type === "household" && member && !defined.some((d) => d.id === HEAD) && headOf(ctx, org) === who) out.push({ position: all(HEAD, "Head"), row: member });
  const leader = rows.find((r) => r.how === "leader");
  if (type === "party" && leader && !defined.some((d) => d.id === LEADER)) out.push({ position: all(LEADER, "Leader"), row: leader });
  return out;
}

/** The type's word for how someone belongs, when nothing else titles them (§3.3). */
export const HOW_WORDS: Readonly<Record<OrgMember["how"], string>> = { member: "Member", owner: "Owner", staff: "Staff", leader: "Leader", core: "Core", companion: "Companion", hired: "Hired", ally: "Ally" };

/**
 * The title `who` goes by in `org` (§3.3), the first that answers: their own (`member_of.role`),
 * their position's, their job's, then the type's word for how they belong (Member, Staff, Owner); null
 * for someone who doesn't belong.
 */
export function orgTitle(ctx: OrgContext, who: EntityId, org: EntityId): string | null {
  const rows = directMembers(ctx, org).filter((r) => r.who === who);
  if (rows.length === 0) return null;
  const mine = rows.find((r) => r.how === "member" && r.title !== undefined)?.title;
  if (mine !== undefined) return mine;
  const held = heldPositions(ctx, who, org)[0];
  if (held) return held.position.title;
  const job = rows.find((r) => r.how === "staff" && r.title !== undefined)?.title;
  if (job !== undefined) return job;
  const order: OrgMember["how"][] = ["owner", "leader", "staff", "member", "core", "companion", "hired", "ally"];
  const how = order.find((h) => rows.some((r) => r.how === h)) ?? "member";
  return HOW_WORDS[how];
}

/** Every position that reports to `position`, directly or through others (the positions below it). */
export function positionsBelow(positions: readonly Position[], position: string): string[] {
  const out: string[] = [];
  let frontier = [position];
  for (let depth = 0; frontier.length > 0 && depth < positions.length; depth++) {
    frontier = positions.filter((p) => p.reports_to !== undefined && frontier.includes(p.reports_to) && !out.includes(p.id) && p.id !== position).map((p) => p.id);
    out.push(...frontier);
  }
  return out;
}

// ---------------------------------------------------------------- delegation and powers

/** The delegations in force for `org` (§3.5): each `acts_for` link to it whose `until` hasn't passed, by delegate. */
export function delegationsOf(ctx: OrgContext, org: EntityId): Delegation[] {
  return [...delegationsIn(ctx, org)];
}

/**
 * `delegationsOf`, shared: every organization's delegations in force are read in one walk of the
 * state, kept for the read pass, so a page or the GM view asking for each person's powers in each
 * organization reads the links once, not once a person, power and organization.
 */
function delegationsIn(ctx: OrgContext, org: EntityId): readonly Delegation[] {
  const byOrg = passMemo([ctx.state, ctx.state.entities], "orgs.delegations", () => {
    const out = new Map<EntityId, Delegation[]>();
    for (const who of Object.keys(ctx.state.entities).sort()) {
      if (isGone(ctx.state, who)) continue;
      for (const r of own(ctx.state.entities, who)?.relations ?? []) {
        if (r.type !== ACTS_FOR || (typeof r.until === "number" && r.until < ctx.state.clock)) continue;
        const f = objOf(r.fields);
        const limits = limitsIn(f);
        const list = out.get(r.to) ?? [];
        list.push({ who, org: r.to, powers: powersIn(f.powers), ...(limits ? { limits } : {}), ...(typeof f.by === "string" && f.by !== "" ? { by: f.by } : {}), ...(typeof r.until === "number" ? { until: r.until } : {}) });
        out.set(r.to, list);
      }
    }
    return out;
  });
  return byOrg.get(org) ?? [];
}

/** The powers a type's default gives how someone belongs (§3.4), without positions: none for staff, officers, the hired and allies; a member's assign and dispose reach only what is consumed in use. */
export function defaultPowers(type: OrgType, how: OrgMember["how"]): readonly OrgPower[] {
  if (how === "member" && (type === "household" || type === "group")) return ["money.view", "assets.use", "assets.assign", "assets.dispose"];
  if (how === "core") return ["money.view", "assets.use"];
  if (how === "companion") return ["assets.use"];
  return [];
}

/**
 * The power `who` holds over `org`, and why, or null (§3.4): an owner role (a managing role on a
 * company or a trust gives every power; any other, seeing its money), a position held, a delegation in
 * force, then the type's default for how they belong. A held power gives those it implies. A member's
 * default lends out or disposes of only what is consumed in use (`thing` consumable).
 */
export function orgPower(ctx: OrgContext, who: EntityId, org: EntityId, power: OrgPower, thing?: EntityId): OrgGrant | null {
  const type = orgTypeOf(ctx, org);
  if (type === null || isGone(ctx.state, who)) return null;
  const e = own(ctx.state.entities, org);
  if ((type === "company" || type === "trust") && e) {
    const roles = ownersIn(e.fields).filter((o) => o.party === who);
    if (roles.some((o) => ROLE_RIGHTS[o.role].manage) || (roles.length > 0 && power === "money.view")) return { basis: "owner" };
  }
  const held = heldPositions(ctx, who, org).find((h) => h.position.powers.some((p) => powerCovers(p, power)));
  if (held) return { basis: "position", id: held.position.id };
  const delegated = delegationsIn(ctx, org).find((d) => d.who === who && d.powers.some((p) => powerCovers(p, power)));
  if (delegated) return delegated.by === undefined ? { basis: "delegate" } : { basis: "delegate", id: delegated.by };
  if (!isMemberOf(ctx, who, org)) return null;
  const consumable = thing !== undefined && own(ctx.state.entities, thing)?.fields.consumable === true;
  const covered = membersOfOrg(ctx, org).some((r) => r.who === who && defaultPowers(type, r.how).includes(power));
  if (!covered) return null;
  return power === "assets.assign" || power === "assets.dispose" ? (consumable ? { basis: "member" } : null) : { basis: "member" };
}

/** Every power `who` holds over `org`, each with its basis, in the families' order. */
export function orgPowers(ctx: OrgContext, who: EntityId, org: EntityId): { power: OrgPower; grant: OrgGrant }[] {
  return ORG_POWERS.flatMap((power) => {
    const grant = orgPower(ctx, who, org, power);
    return grant ? [{ power, grant }] : [];
  });
}

/** The organizations `who` may act for with `power` (§3.6): each one in the world, not gone, where they hold it, in id order. Paying as and interpret's `as` offer these. */
export function actsFor(ctx: OrgContext, who: EntityId, power: OrgPower): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((org) => org !== who && !isGone(ctx.state, org) && orgTypeOf(ctx, org) !== null && orgPower(ctx, who, org, power) !== null);
}

/** Whether someone may use a power now, or why not, in words. */
export type MayAct = { ok: true; grant: OrgGrant } | { ok: false; reason: string };

/** What an act asks of a power: the amount it pays, the account it pays from, the person it is done to. */
export interface ActAsk {
  amount?: number;
  account?: EntityId;
  target?: EntityId;
}

/** The calendar month spending is counted in (`packs.orgs.spent`), as `YYYY-MM`: the world calendar's month of `clock`. */
export function spendMonth(world: OrgContext["world"], clock: number): string {
  const d = dateAt(calendarOf(world), clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}`;
}

/** A delegate's or position holder's spending in `org` in the calendar month of the clock, in minor units (`packs.orgs.spent`; nothing before anything is recorded). */
function spentThisMonth(ctx: OrgContext, who: EntityId, org: EntityId): number {
  return numOf(objOf(objOf(objOf(sliceOf(ctx.state, "orgs").spent)[org])[who])[spendMonth(ctx.world, ctx.state.clock)]);
}

/** The staff and member powers a position's `scope` can confine to the positions below it. */
const SCOPED: readonly OrgPower[] = ["members.admit", "members.remove", "members.appoint", "staff.hire", "staff.fire", "staff.pay"];

/**
 * Whether `who` may use `power` for `org` now (§3.4): they hold it, within the limits of the
 * position or delegation it rests on (each payment, the calendar month, the accounts), within the
 * position's scope over `target`, and never paying, out of money they only manage, themselves, their
 * household or what any of them owns (the fiduciary rule, `economy.interests`). A refusal says why.
 */
export function mayAct(ctx: ReadContext, who: EntityId, org: EntityId, power: OrgPower, ask: ActAsk = {}): MayAct {
  const name = labelOf(ctx, org);
  const grant = orgPower(ctx, who, org, power);
  if (!grant) return { ok: false, reason: `${name}: you may not ${POWER_WORDS[power]}` };
  let limits: OrgLimits | undefined;
  let scoped: Position | undefined;
  if (grant.basis === "position") {
    const held = heldPositions(ctx, who, org).find((h) => h.position.id === grant.id);
    limits = held?.position.limits;
    scoped = held?.position.scope === "below" ? held.position : undefined;
  } else if (grant.basis === "delegate") limits = delegationsIn(ctx, org).find((d) => d.who === who && d.powers.some((p) => powerCovers(p, power)))?.limits;
  const amount = ask.amount;
  if (limits && amount !== undefined) {
    const over = overLimit(limits, amount, limits.month !== undefined ? spentThisMonth(ctx, who, org) : null, name, ctx.world.currency);
    if (over !== null) return { ok: false, reason: over };
  }
  if (limits?.accounts && ask.account !== undefined && !limits.accounts.includes(ask.account)) return { ok: false, reason: `${labelOf(ctx, ask.account)} isn't one of the accounts you may use for ${name}` };
  if (scoped && ask.target !== undefined && SCOPED.includes(power)) {
    const below = positionsBelow(positionsOf(ctx, org), scoped.id);
    if (!heldPositions(ctx, ask.target, org).some((h) => below.includes(h.position.id))) return { ok: false, reason: `${labelOf(ctx, ask.target)} isn't below ${scoped.title} at ${name}` };
  }
  const worth = grant.basis === "owner" && ownersIn(own(ctx.state.entities, org)?.fields ?? {}).some((o) => o.party === who && ROLE_RIGHTS[o.role].worth);
  if (ask.target !== undefined && !worth && (power === "money.spend" || power === "money.payout")) {
    const interests = optionalQuery(ctx, "economy.interests")?.(ctx, who) ?? [who];
    if (interests.includes(ask.target)) return { ok: false, reason: `${name}'s money pays for ${name}, not for ${labelOf(ctx, ask.target)}` };
  }
  return { ok: true, grant };
}

// ---------------------------------------------------------------- places

/** The places a business trades at: its `places`, else where it stands. */
export function placesOf(ctx: Pick<ReadContext, "state" | "world">, business: EntityId): PlaceId[] {
  const e = own(ctx.state.entities, business);
  if (!e) return [];
  const listed = Array.isArray(e.fields.places) ? e.fields.places.filter((p): p is string => typeof p === "string" && own(ctx.world.places, p) !== undefined) : [];
  if (listed.length > 0) return listed;
  const here = placeOfEntity(ctx.state, business);
  return here ? [here] : [];
}

/** Every business still in the world, by id. Kept for the read pass: whose a place is asks it of every place. */
export function businessIds(ctx: OrgContext): EntityId[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], "orgs.businesses", () =>
    Object.keys(ctx.state.entities)
      .filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", COMPANY_KIND) && !isGone(ctx.state, id))
      .sort(),
  );
}

/** The business that trades at a place: the one whose place holds it most closely. */
export function businessAt(ctx: OrgContext, place: PlaceId | null): EntityId | null {
  if (!place) return null;
  let best: { id: EntityId; depth: number } | null = null;
  for (const id of businessIds(ctx)) {
    for (const p of placesOf(ctx, id)) {
      if (!placeWithin(ctx.world, place, p)) continue;
      let depth = 0;
      for (let cur = own(ctx.world.places, p)?.parent; cur && depth < 32; cur = own(ctx.world.places, cur)?.parent) depth++;
      if (!best || depth > best.depth) best = { id, depth };
    }
  }
  return best?.id ?? null;
}

/**
 * The places that are an organization's (§3.9): a business's trading places; a household's members'
 * homes; and, for any of them, its own `places` and the places of the properties it holds a share
 * of. A place named as an employer is its own. Sorted by id, each once. Kept for the read pass:
 * whose a place is asks it of every organization, for every place.
 */
export function orgPlaces(ctx: OrgContext, org: EntityId): PlaceId[] {
  if (own(ctx.world.places, org)) return [org];
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.places:${org}`, () => {
    const type = orgTypeOf(ctx, org);
    const fields = own(ctx.state.entities, org)?.fields;
    const listed = Array.isArray(fields?.places) ? fields.places.filter((p): p is string => typeof p === "string" && own(ctx.world.places, p) !== undefined) : [];
    const out = new Set<PlaceId>(type === "company" ? placesOf(ctx, org) : listed);
    for (const id of Object.keys(ctx.state.entities)) {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id)) continue;
      if (type === "household" && typeof e.fields.home === "string" && own(ctx.world.places, e.fields.home) && kindIs(ctx.registry, ctx.world, e.kind, "person") && isMemberOf(ctx, id, org)) out.add(e.fields.home);
      if (kindIs(ctx.registry, ctx.world, e.kind, "property") && typeof e.fields.place === "string" && own(ctx.world.places, e.fields.place) && (worthShares(ownersIn(e.fields))[org] ?? 0) > 0) out.add(e.fields.place);
    }
    return [...out].sort();
  });
}

/** A business's trading days (0 is Sunday): its own list, else Monday to Friday. */
export function tradingDays(state: Pick<ReadContext["state"], "entities">, business: EntityId): number[] {
  const v = own(state.entities, business)?.fields.trading_days;
  const days = Array.isArray(v) ? v.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6) : [];
  return days.length > 0 ? days : [1, 2, 3, 4, 5];
}

/** A business's opening hours as minutes after midnight: its `open_at` and `close_at` (HH:MM), else nine to five. A close at or before the opening runs past midnight. */
export function hoursOf(ctx: OrgContext, business: EntityId): { open: number; close: number } {
  const f = own(ctx.state.entities, business)?.fields;
  const at = (v: JsonValue | undefined, fallback: string): number => {
    try {
      return parseHHMM(typeof v === "string" ? v : fallback);
    } catch {
      return parseHHMM(fallback);
    }
  };
  return { open: at(f?.open_at, "09:00"), close: at(f?.close_at, "17:00") };
}

/**
 * Whether a business trades at `clock`, local to its first place: within its hours on a trading day
 * that isn't a day-off holiday. Hours that close after midnight belong to the day they opened.
 */
export function trading(ctx: OrgContext, business: EntityId, clock: number): boolean {
  const cal = calendarOf(ctx.world);
  const localClock = clock + placeOffset(ctx.world, clock, placesOf(ctx, business)[0] ?? null);
  const local = dateAt(cal, localClock);
  const days = tradingDays(ctx.state, business);
  const opens = (day: { weekday: number; dayIndex: number }): boolean => days.includes(day.weekday) && !holidaysOn(cal, day.dayIndex).some((h) => h.dayOff);
  const { open, close } = hoursOf(ctx, business);
  if (close > open) return opens(local) && local.minuteOfDay >= open && local.minuteOfDay < close;
  // Open overnight: from the opening today, or still open after midnight from yesterday's.
  return (local.minuteOfDay >= open && opens(local)) || (local.minuteOfDay < close && opens(dateAt(cal, localClock - 24 * 60)));
}

/** The `packs.orgs` slice key under which play keeps the entry and keys it set on places (ORG-SPEC §3.9, `orgs.entry`). */
export const ENTRY_KEY = "entry";

/** A place's entry and keys as play set them (`packs.orgs.entry[place]`), each absent while play leaves the world's. */
export function entryInPlay(state: ReadContext["state"], place: PlaceId): { entry?: Audience; keys?: string[] } {
  const rec = objOf(objOf(sliceOf(state, "orgs")[ENTRY_KEY])[place]);
  const keys = Array.isArray(rec.keys) ? rec.keys.filter((k): k is string => typeof k === "string" && k !== "") : undefined;
  return { ...(isAudience(rec.entry) ? { entry: rec.entry } : {}), ...(keys !== undefined ? { keys } : {}) };
}

/** A place and the places it lies in within the same building or site (`together`), nearest first: where its entry and keys are set. */
export function placesUp(ctx: Pick<ReadContext, "world">, place: PlaceId): PlaceId[] {
  const out: PlaceId[] = [];
  for (let at: PlaceId | undefined = place; at !== undefined && own(ctx.world.places, at) && together(ctx.world, place, at) && !out.includes(at) && out.length < 32; at = own(ctx.world.places, at)?.parent) out.push(at);
  return out;
}

/** The entry set on a place, in play or by the world, by the nearest place up that sets one (a room inherits its house's); null when none does. */
export function setEntryOf(ctx: Pick<ReadContext, "world" | "state">, place: PlaceId): { entry: Audience; at: PlaceId } | null {
  for (const at of placesUp(ctx, place)) {
    const entry = entryInPlay(ctx.state, at).entry ?? own(ctx.world.places, at)?.fields.entry;
    if (isAudience(entry)) return { entry, at };
  }
  return null;
}

/** Whom a place admits at `clock` (§3.9): the entry set on it or around it; else, where a business trades, customers while it trades and only staff outside its hours; else anyone. */
export function placeEntry(ctx: OrgContext, place: PlaceId, clock: number): Audience {
  const set = setEntryOf(ctx, place);
  if (set) return set.entry;
  const business = businessAt(ctx, place);
  if (business === null) return "public";
  return trading(ctx, business, clock) ? "customers" : "staff";
}

/** Whether `who` counts as owning what `party` owns (`owns`): `party` itself, or a member of it by `member_of` links that never pass through a company; a company's things are never its staff's or its officers' (§3.2). */
export function ownsThrough(ctx: OrgContext, who: EntityId, party: EntityId): boolean {
  if (who === party) return true;
  const company = (id: EntityId): boolean => orgTypeOf(ctx, id) === "company";
  return !company(party) && linkedMemberOf(ctx.state, who, party, company);
}
