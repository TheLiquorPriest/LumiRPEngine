// Organizations (ORG-SPEC §3): what an organization is (`orgTypeOf`), who belongs to it and how
// (`membersOfOrg`, over each kind's membership provider), its positions and the titles its people go
// by, the powers someone holds in it and why (`orgPower`: their own bases, then control, the powers
// held at an organization holding it flowing down the chain, `controlPathOf`), whether they may use
// one now (`mayAct`: limits, scope and the fiduciary rule), who works for it (`isStaff`), the places
// that are its (`orgPlaces`), the business trading at a place (`businessAt`), whether a business
// trades at a time (`trading`) and whom a place's entry admits (`placeEntry`). Each is pure and read
// when asked, never in the fold; nothing here is written. With no positions authored, the defaults
// give today's rights (§3.4), the household Head their one addition.

import { classesIn, OWNER_ROLE_LABELS, ownersIn, ROLE_RIGHTS, votePcts, worthShares, type OwnerRole } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { ACTS_FOR, CONTROL_DEPTH, CONTROL_KEEPS, DISSOLVED_FIELD, isAudience, limitsIn, ORG_POWERS, overLimit, positionsIn, powerCovers, powersIn, POWER_WORDS, trusteesDecideIn, WINDING_FIELD, type Audience, type Delegation, type OrgGrant, type OrgLimits, type OrgMember, type OrgPower, type OrgType, type Position } from "../shared/org";
import { PARTY_KIND, PARTY_RELATION, partyTierOf } from "../shared/party";
import { calendarOf, dateAt, dayIndexOfText, holidaysOn, monthName, parseHHMM, placeOffset } from "./calendar";
import { acts } from "./life";
import { labelOf, numOf, objOf, optionalQuery, own, sliceOf } from "./pack-kit";
import { passMemo } from "./read-pass";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "./scope";
import { siteOf, together } from "./presence";
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
  // An organization wound up or merged away holds no seat any more: its seats fall vacant.
  if (orgTypeOf(ctx, who) !== null && dissolvedOn(ctx.state, who) !== null) return [];
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

/** Whether a seat's holder still fills it (§3.14): someone who acts and isn't gone; an organization seated there (an officer or director that is an entity) only while it stands, so a dissolved holder's seat falls vacant. */
export function seatFilled(ctx: OrgContext, who: EntityId): boolean {
  return !isGone(ctx.state, who) && acts(ctx.world, ctx.state, who) && (orgTypeOf(ctx, who) === null || dissolvedOn(ctx.state, who) === null);
}

/** The type's word for how someone belongs, when nothing else titles them (§3.3). */
export const HOW_WORDS: Readonly<Record<OrgMember["how"], string>> = { member: "Member", owner: "Owner", staff: "Staff", leader: "Leader", core: "Core", companion: "Companion", hired: "Hired", ally: "Ally" };

/**
 * The title `who` goes by in `org` (§3.3), the first that answers: their own (`member_of.role`),
 * their position's, their job's, then the type's word for how they belong (Member, Staff, Owner), an
 * owner by another role going by that role ("Trustee", "Beneficiary"); null for someone who doesn't
 * belong.
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
  const owners = rows.filter((r) => r.how === "owner");
  if (owners.length > 0 && !owners.some((r) => r.role === undefined || r.role === "owner")) return OWNER_ROLE_LABELS[owners[0]?.role ?? "owner"].one;
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
 * force, the type's default for how they belong, then control (§29.3): a power they hold at an
 * organization holding this one that flows down to it. A held power gives those it implies. A
 * member's default lends out or disposes of only what is consumed in use (`thing` consumable).
 */
export function orgPower(ctx: OrgContext, who: EntityId, org: EntityId, power: OrgPower, thing?: EntityId): OrgGrant | null {
  if (orgTypeOf(ctx, org) === null || isGone(ctx.state, who)) return null;
  const own = ownPower(ctx, who, org, power, thing);
  if (own) return own;
  const path = controlPathOf(ctx, who, org, power, thing);
  return path ? { basis: "control", id: path.top, through: path.steps.map((s) => s.holder) } : null;
}

/** The power `who` holds over `org` on a basis of their own there (an owner role, a position, a delegation, a member's default), never through another organization. */
function ownPower(ctx: OrgContext, who: EntityId, org: EntityId, power: OrgPower, thing?: EntityId): OrgGrant | null {
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

// ---------------------------------------------------------------- control (§29.3 Control)

/**
 * One way an organization holds another (§29.3 Control), and the powers it passes down to it: a
 * stake (its rows on the owners list: a controlling one, by more than the decision threshold of its
 * votes or a managing role on a trust, passes every power its own seated officers don't take, and
 * any other stake in its worth, seeing its money), a position it holds there (that position's
 * powers, within its limits and scope), or a delegation to it (its powers, within its limits).
 */
export interface OrgHold {
  holder: EntityId;
  org: EntityId;
  how: "stake" | "position" | "delegate";
  powers: readonly OrgPower[];
  /** A stake: its first row's role, its share of the worth and (a company's) votes in percent, and whether it controls. */
  role?: OwnerRole;
  share?: number;
  votes?: number;
  controlled?: boolean;
  /** A position it holds there. */
  position?: Position;
  /** A delegation's limits. */
  limits?: OrgLimits;
}

/** Whether an organization still holds what it holds: in the world, and neither gone nor wound up. */
function holds(ctx: OrgContext, id: EntityId): boolean {
  return orgTypeOf(ctx, id) !== null && !isGone(ctx.state, id) && dissolvedOn(ctx.state, id) === null;
}

/** Each holder's votes in a company as its decisions count them (the economy's `economy.votes`), else by its owners' units and classes. */
function votesAt(ctx: OrgContext, org: EntityId, fields: Readonly<Record<string, JsonValue>>): Record<EntityId, number> {
  const full = ctx as Partial<ReadContext>;
  const query = typeof full.query === "function" ? optionalQuery(full as ReadContext, "economy.votes") : null;
  return query ? query(full as ReadContext, org) : votePcts(ownersIn(fields), classesIn(fields));
}

/**
 * The organizations holding `org` (§29.3 Control), each way it holds it, by holder: stakes, then
 * the positions it holds, then delegations to it. Kept for the read pass. At an organization that
 * seats its own officers, a controlling stake passes only what those officers' positions don't hold,
 * besides seeing its money and its board, ownership and structure (`CONTROL_KEEPS`, fork 3).
 */
export function holdersOf(ctx: OrgContext, org: EntityId): readonly OrgHold[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.holders:${org}`, (): OrgHold[] => {
    const e = own(ctx.state.entities, org);
    const type = orgTypeOf(ctx, org);
    if (!e || type === null) return [];
    const owners = ownersIn(e.fields);
    const stakeHolders = [...new Set(owners.map((o) => o.party))].filter((id) => id !== org && holds(ctx, id)).sort();
    const rows = directMembers(ctx, org);
    const seatHolders = [...new Set(rows.filter((r) => r.position !== undefined && r.who !== org && holds(ctx, r.who)).map((r) => r.who))].sort();
    const delegates = delegationsIn(ctx, org).filter((d) => d.who !== org && holds(ctx, d.who));
    if (stakeHolders.length === 0 && seatHolders.length === 0 && delegates.length === 0) return [];
    const out: OrgHold[] = [];
    if (stakeHolders.length > 0) {
      const shares = worthShares(owners);
      const votes = type === "company" ? votesAt(ctx, org, e.fields) : {};
      const decide = Math.min(100, Math.max(0, numOf(e.fields.decide_pct, 50)));
      // The powers each holder of a position here takes as its own (a seat whose holder acts, or an organization still standing).
      const seated = new Map<EntityId, OrgPower[]>();
      for (const who of [...new Set(rows.filter((r) => !isGone(ctx.state, r.who)).map((r) => r.who))]) {
        const powers = heldPositions(ctx, who, org).flatMap((h) => h.position.powers);
        if (powers.length > 0) seated.set(who, powers);
      }
      for (const holder of stakeHolders) {
        const mine = owners.filter((o) => o.party === holder);
        const v = votes[holder] ?? 0;
        const controlled = type === "company" ? v > decide + 1e-9 : mine.some((o) => ROLE_RIGHTS[o.role].manage);
        if (!controlled && !mine.some((o) => ROLE_RIGHTS[o.role].worth)) continue;
        const taken = [...seated].filter(([who]) => who !== holder).flatMap(([, powers]) => powers);
        const powers = controlled ? ORG_POWERS.filter((p) => CONTROL_KEEPS.includes(p) || !taken.some((t) => powerCovers(t, p))) : (["money.view"] as const);
        out.push({ holder, org, how: "stake", powers, role: mine[0]?.role ?? "owner", share: shares[holder] ?? 0, ...(type === "company" ? { votes: v } : {}), controlled });
      }
    }
    for (const holder of seatHolders) for (const h of heldPositions(ctx, holder, org)) out.push({ holder, org, how: "position", powers: h.position.powers, position: h.position, ...(h.position.limits ? { limits: h.position.limits } : {}) });
    for (const d of delegates) out.push({ holder: d.who, org, how: "delegate", powers: d.powers, ...(d.limits ? { limits: d.limits } : {}) });
    return out;
  });
}

/** What `holder` holds (§29.3 Control): each of its holds on another organization, in that one's id order. Kept for the read pass. */
export function holdsOf(ctx: OrgContext, holder: EntityId): readonly OrgHold[] {
  const byHolder = passMemo([ctx.state, ctx.state.entities, ctx.world], "orgs.holds", () => {
    const out = new Map<EntityId, OrgHold[]>();
    for (const id of Object.keys(ctx.state.entities).sort()) {
      if (isGone(ctx.state, id) || orgTypeOf(ctx, id) === null) continue;
      for (const h of holdersOf(ctx, id)) out.set(h.holder, [...(out.get(h.holder) ?? []), h]);
    }
    return out;
  });
  return byHolder.get(holder) ?? [];
}

/** A power held through control: the organization where its holder holds it on a basis of their own (`top`, with that grant), and each hold it flows down through, the top's first (`steps[0].holder` is `top`), the hold on the organization it reaches last. */
export interface ControlPath {
  top: EntityId;
  root: OrgGrant;
  steps: OrgHold[];
}

/**
 * How `who` holds `power` over `org` through control (§29.3): the nearest chain of holds passing it
 * down (fewest organizations, at most `CONTROL_DEPTH` of them, the top and `org` included), each
 * organization's holders in id order; a holder met twice (cross-holdings) is passed by. Null when no
 * chain passes it down to them. Kept for the read pass.
 */
export function controlPathOf(ctx: OrgContext, who: EntityId, org: EntityId, power: OrgPower, thing?: EntityId): ControlPath | null {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `orgs.control:${who}:${org}:${power}:${thing ?? ""}`, (): ControlPath | null => {
    if (isGone(ctx.state, who)) return null;
    let frontier: { org: EntityId; steps: OrgHold[] }[] = [{ org, steps: [] }];
    const seen = new Set<EntityId>([org]);
    for (let depth = 1; frontier.length > 0 && depth < CONTROL_DEPTH; depth++) {
      const next: { org: EntityId; steps: OrgHold[] }[] = [];
      for (const node of frontier) {
        for (const hold of holdersOf(ctx, node.org)) {
          if (seen.has(hold.holder) || !hold.powers.some((p) => powerCovers(p, power))) continue;
          seen.add(hold.holder);
          const steps = [hold, ...node.steps];
          const root = hold.holder === who ? null : ownPower(ctx, who, hold.holder, power, thing);
          if (root) return { top: hold.holder, root, steps };
          if (hold.holder !== who) next.push({ org: hold.holder, steps });
        }
      }
      frontier = next;
    }
    return null;
  });
}

/** The organizations whose powers flow to `who` at `org` (§29.3 Control), nearest them first: those of every power they hold there through control, each once. */
export function controlThrough(ctx: OrgContext, who: EntityId, org: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (const power of ORG_POWERS) {
    const grant = orgPower(ctx, who, org, power);
    if (grant?.basis !== "control") continue;
    for (const id of grant.through ?? []) if (!out.includes(id)) out.push(id);
  }
  return out;
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

/** Whether someone may use a power now, or why not, in words; `limit` marks a refusal for a limit of the position or delegation the power rests on (each payment, the month, the accounts), which a request for approval may lift. */
export type MayAct = { ok: true; grant: OrgGrant } | { ok: false; reason: string; limit?: true };

/** What an act asks of a power: the amount it pays, the account it pays from, the person it is done to. */
export interface ActAsk {
  amount?: number;
  account?: EntityId;
  target?: EntityId;
  /** Asked of someone approving another's act (§29.20): a co-trustee's approval is the trustees acting together, so that rule asks nothing more of them. */
  approving?: true;
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

/** What a trust's trustee does only with a co-trustee's approval where its trustees decide together (§29.1 Trusts): pay, move or pay out its money, borrow, deal in property. */
export const TOGETHER_POWERS: readonly OrgPower[] = ["money.spend", "money.manage", "money.payout", "money.borrow", "property.trade"];

/** The trustees of a trust who act: its owners by the trustee role, neither gone nor wound up, in id order. */
export function trusteesOf(ctx: OrgContext, trust: EntityId): EntityId[] {
  const rows = ownersIn(own(ctx.state.entities, trust)?.fields ?? {}).filter((o) => o.role === "trustee");
  return [...new Set(rows.map((o) => o.party))].filter((id) => !isGone(ctx.state, id) && (orgTypeOf(ctx, id) === null || dissolvedOn(ctx.state, id) === null)).sort();
}

/** A limit one use of a power is held to (a position's or a delegation's), with the organizations whose spending this month counts toward it. */
interface LimitCheck {
  limits: OrgLimits;
  spentAt: EntityId[];
}

/**
 * Whether `who` may use `power` for `org` now (§3.4): they hold it, within the limits of the
 * position or delegation it rests on (each payment, the calendar month, the accounts), within the
 * position's scope over `target`, and never paying, out of money they only manage, themselves, their
 * household or what any of them owns (the fiduciary rule, `economy.interests`). Held through control
 * (§29.3), every limit and scope on the chain applies: the top's own position or delegation, and each
 * position or delegation an organization holds on the way down; the fiduciary rule always does. A
 * trustee of a trust whose trustees decide together pays, moves or pays out its money, borrows and
 * deals in its property only with a co-trustee's approval (a limit a request may lift). A refusal says why.
 */
export function mayAct(ctx: ReadContext, who: EntityId, org: EntityId, power: OrgPower, ask: ActAsk = {}): MayAct {
  const name = labelOf(ctx, org);
  const ended = endedRefusal(ctx, org, power);
  if (ended !== null) return { ok: false, reason: ended };
  const grant = orgPower(ctx, who, org, power);
  if (!grant) return { ok: false, reason: `${name}: you may not ${POWER_WORDS[power]}` };
  const checks: LimitCheck[] = [];
  const scopes: { position: Position; at: EntityId }[] = [];
  // The trustee acting for a trust: themselves by their own role, or the organization whose trustee role it flows down through.
  let trustee: EntityId | null = null;
  // The position or delegation a power rests on at `at`, its limits counting the spending at `spentAt`.
  const rests = (basis: OrgGrant, at: EntityId, spentAt: EntityId[]): void => {
    if (basis.basis === "position") {
      const held = heldPositions(ctx, who, at).find((h) => h.position.id === basis.id);
      if (held?.position.limits) checks.push({ limits: held.position.limits, spentAt });
      if (held?.position.scope === "below") scopes.push({ position: held.position, at });
    } else if (basis.basis === "delegate") {
      const limits = delegationsIn(ctx, at).find((d) => d.who === who && d.powers.some((p) => powerCovers(p, power)))?.limits;
      if (limits) checks.push({ limits, spentAt });
    }
  };
  if (grant.basis === "control") {
    const path = controlPathOf(ctx, who, org, power);
    if (!path) return { ok: false, reason: `${name}: you may not ${POWER_WORDS[power]}` };
    const chain = [path.top, ...path.steps.map((s) => s.org)];
    rests(path.root, path.top, chain);
    for (const step of path.steps) {
      if (step.limits) checks.push({ limits: step.limits, spentAt: chain });
      if (step.position?.scope === "below") scopes.push({ position: step.position, at: step.org });
    }
    const last = path.steps[path.steps.length - 1];
    if (last?.how === "stake" && last.role === "trustee") trustee = last.holder;
  } else rests(grant, org, [org]);
  const amount = ask.amount;
  for (const { limits, spentAt } of checks) {
    if (amount !== undefined) {
      const spent = limits.month !== undefined ? spentAt.reduce((sum, at) => sum + spentThisMonth(ctx, who, at), 0) : null;
      const over = overLimit(limits, amount, spent, name, ctx.world.currency);
      if (over !== null) return { ok: false, reason: over, limit: true };
    }
    if (limits.accounts && ask.account !== undefined && !limits.accounts.includes(ask.account)) return { ok: false, reason: `${labelOf(ctx, ask.account)} isn't one of the accounts you may use for ${name}`, limit: true };
  }
  const target = ask.target;
  if (target !== undefined && SCOPED.includes(power)) {
    for (const { position, at } of scopes) {
      const below = positionsBelow(positionsOf(ctx, at), position.id);
      if (!heldPositions(ctx, target, at).some((h) => below.includes(h.position.id))) return { ok: false, reason: `${labelOf(ctx, target)} isn't below ${position.title} at ${labelOf(ctx, at)}` };
    }
  }
  const rows = grant.basis === "owner" ? ownersIn(own(ctx.state.entities, org)?.fields ?? {}).filter((o) => o.party === who) : [];
  const worth = rows.some((o) => ROLE_RIGHTS[o.role].worth);
  if (target !== undefined && !worth && (power === "money.spend" || power === "money.payout")) {
    const interests = optionalQuery(ctx, "economy.interests")?.(ctx, who) ?? [who];
    if (interests.includes(target)) return { ok: false, reason: `${name}'s money pays for ${name}, not for ${labelOf(ctx, target)}` };
  }
  if (rows.some((o) => o.role === "trustee")) trustee = who;
  // A trustee acting alone where the trustees decide together (§29.1 Trusts): a co-trustee approves it.
  if (ask.approving !== true && trustee !== null && TOGETHER_POWERS.includes(power) && orgTypeOf(ctx, org) === "trust" && trusteesDecideIn(own(ctx.state.entities, org)?.fields ?? {}) === "together" && trusteesOf(ctx, org).some((t) => t !== trustee)) {
    return { ok: false, reason: `The trustees of ${name} decide together: another trustee approves this`, limit: true };
  }
  return { ok: true, grant };
}

// ---------------------------------------------------------------- winding up (§3.13, Phase 5)

/** A day (`YYYY-MM-DD`) in the world's calendar, in words: "3 Nov 2026"; anything else as it is. */
export function dayWords(world: ReadContext["world"], text: string): string {
  const m = /^(-?\d{1,6})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return text;
  const cal = calendarOf(world);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= cal.system.months && day >= 1 && day <= cal.system.monthLength(year, month) ? `${day} ${monthName(cal, month)} ${year}` : text;
}

/** The day a company was dissolved (`YYYY-MM-DD`), wound up or folded into another; null while it stands. */
export function dissolvedOn(state: Pick<ReadContext["state"], "entities">, org: EntityId): string | null {
  const v = own(state.entities, org)?.fields[DISSOLVED_FIELD];
  return typeof v === "string" && v !== "" ? v : null;
}

/** The day a company began winding up (`YYYY-MM-DD`); null while it trades, or once it is dissolved. */
export function windingUpSince(state: Pick<ReadContext["state"], "entities">, org: EntityId): string | null {
  const v = own(state.entities, org)?.fields[WINDING_FIELD];
  return typeof v === "string" && v !== "" && dissolvedOn(state, org) === null ? v : null;
}

/** What a company winding up no longer does: take people on, bill, borrow. */
const WINDING_STOPS: readonly OrgPower[] = ["staff.hire", "money.invoice", "money.borrow"];

/** Why no one may use `power` for `org` any more: it was dissolved, or it is winding up and the power is trading; null otherwise. */
function endedRefusal(ctx: ReadContext, org: EntityId, power: OrgPower): string | null {
  const dissolved = dissolvedOn(ctx.state, org);
  if (dissolved !== null) return `${labelOf(ctx, org)} was dissolved on ${dayWords(ctx.world, dissolved)}`;
  return windingUpSince(ctx.state, org) !== null && WINDING_STOPS.includes(power) ? `${labelOf(ctx, org)} is winding up` : null;
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

/** Every business still in the world and not dissolved, by id. Kept for the read pass: whose a place is asks it of every place. */
export function businessIds(ctx: OrgContext): EntityId[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], "orgs.businesses", () =>
    Object.keys(ctx.state.entities)
      .filter((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", COMPANY_KIND) && !isGone(ctx.state, id) && dissolvedOn(ctx.state, id) === null)
      .sort(),
  );
}

/**
 * The business that trades at a place: the one whose place holds it most closely, within the same
 * building or site (`siteOf`), so a business whose place is a whole town takes no sale made in a
 * shop of its own elsewhere in it.
 */
export function businessAt(ctx: OrgContext, place: PlaceId | null): EntityId | null {
  if (!place) return null;
  const site = siteOf(ctx.world, place);
  let best: { id: EntityId; depth: number } | null = null;
  for (const id of businessIds(ctx)) {
    for (const p of placesOf(ctx, id)) {
      if (!placeWithin(ctx.world, place, p) || siteOf(ctx.world, p) !== site) continue;
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
