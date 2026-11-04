// The story's changes to organizations (ORG-SPEC §7.3, O7): the reply's `membership` and `employment`
// channels, and the agents' organization op (`orgs.op`, `ops.ts`). A reply fact quotes the reply
// (`said`), which the read holds to the reply's own words and which never hedges (a plan, an offer, a
// thought); it names people the player character may know, organizations by id or name (an
// employer may be the place someone works at), and only positions the organization has. It lands as
// the packs' own effects with no actor (the story's change, which asks for no power), with its
// History line quoting the reply; when it names who did it and they don't hold the power, it lands
// flagged with a GM note, as a grant from someone who may not make it does (ITEMS-SPEC §3.4).
// Membership: someone joins or leaves, is appointed to a position (a member by their membership,
// staff by their job) or takes a title. Employment: someone is hired, let go, quits, gets a raise,
// or goes on or comes back from leave. One the state holds already (a member joining, someone not
// in it leaving, a position held, a hire where they work, a leave or a return already so) is
// refused as `already`, which the read keeps silent: the story changed nothing. Pure.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { OrgPower } from "../../../shared/org";
import { formatMoney, type EffectSpec } from "../../../shared/world";
import { isStaff, orgTypeOf, positionsOf } from "../../../engine/org";
import { labelOf, objOf, own, strOf } from "../../../engine/pack-kit";
import { placeKey } from "../../../engine/place-names";
import { povMayKnow } from "../../../engine/player-events";
import type { CoreRegistry, ProposalChannelDef, ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { isMemberOf, MEMBER_OF, type MembershipContext } from "../../../engine/selector";
import { canSeeEntity } from "../../../engine/visibility";
import { compileOrgOp, flagged, historyLine, jobOf, plainWords, positionNamed, withWhy } from "./ops";

/** What a membership fact says changed: someone joined or left, was appointed to a position, or took a title. */
export const MEMBERSHIP_CHANGES = ["join", "leave", "appoint", "title"] as const;
/** What an employment fact says changed. */
export const EMPLOYMENT_CHANGES = ["hired", "let_go", "quit", "raise", "leave", "back"] as const;

type Proposal = JsonObject;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

/**
 * Words that state a change as done, not one only considered: a plan, an offer, a wish, a threat,
 * someone thinking about it, or a question (`"thinking about quitting"` states no quitting). A
 * reply's fact is the story's only when it stands as said.
 */
const HEDGED = /\b(?:thinking (?:about|of)|might|maybe|perhaps|possibly|consider(?:s|ing|ed)?|plan(?:s|ning|ned)? to|want(?:s|ed)? to|wish(?:es|ed)? to|hope(?:s|d)? to|going to|gonna|threaten(?:s|ed|ing)?|offer(?:s|ed)? (?:to|him|her|them|you)|if|unless|would|could|should|soon)\b/i;

/** Whether the words a fact quotes state its change as done (`HEDGED`): none that hedge it, and no question. */
export function statesChange(said: string): boolean {
  const t = said.trim();
  return t !== "" && !t.endsWith("?") && !HEDGED.test(t);
}

/** Words as a quote is matched against the reply: curly quotes straight, case and spacing aside. */
function quoteKey(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether a fact's `said` is the reply's own words (its quote marks and closing stop aside): a reply fact quotes the reply (§7.3). */
export function quotesReply(said: string, reply: string): boolean {
  const key = quoteKey(said).replace(/^["']+|["']+$/g, "").replace(/[.!,;:]+$/, "").trim();
  return key !== "" && quoteKey(reply).includes(key);
}

/**
 * The entity words name among those `fits` lets through: its id (in any case), else the one whose
 * name the words are (`placeKey`: case, spacing, punctuation and a leading article aside), else the
 * one whose name has the words as one of its own (a first name), when exactly one does.
 */
function entityNamed(ctx: ReadContext, said: string, fits: (id: EntityId) => boolean): EntityId | null {
  const t = said.trim();
  if (t === "") return null;
  for (const id of [t, t.toLowerCase()]) if (own(ctx.state.entities, id) && !isGone(ctx.state, id) && fits(id)) return id;
  const key = placeKey(t);
  if (key === "") return null;
  const ids = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => !isGone(ctx.state, id) && fits(id));
  const whole = ids.filter((id) => placeKey(own(ctx.state.entities, id)?.name ?? "") === key);
  if (whole.length === 1) return whole[0] ?? null;
  if (whole.length > 1 || key.includes(" ")) return null;
  const part = ids.filter((id) => placeKey(own(ctx.state.entities, id)?.name ?? "").split(" ").includes(key));
  return part.length === 1 ? (part[0] ?? null) : null;
}

/** A person the player character may know, by id or name. */
function personNamed(ctx: ReadContext, said: string): EntityId | null {
  return entityNamed(ctx, said, (id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && povMayKnow(ctx.registry, ctx.world, ctx.state, id));
}

/**
 * Whether the player character may know of an organization (ORG-SPEC §3.16), wherever they stand:
 * one they belong to, secret ones included, or one they can see, as their Orgs home lists them; or
 * one they may know as anyone else (`povMayKnow`). The reply's org facts resolve organizations so.
 */
export function orgKnown(ctx: MembershipContext, id: EntityId): boolean {
  const pov = ctx.world.pov;
  return orgTypeOf(ctx, id) !== null && !isGone(ctx.state, id) && (isMemberOf(ctx, pov, id) || canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id) || povMayKnow(ctx.registry, ctx.world, ctx.state, id));
}

/** An organization the player character may know of (`orgKnown`), by id or name. */
function orgNamed(ctx: ReadContext, said: string): EntityId | null {
  return entityNamed(ctx, said, (id) => orgKnown(ctx, id));
}

/** Who a fact says did it (`by`), a person or an organization the player character may know; undefined when it names none, null when it names no one. */
function actorOf(ctx: ReadContext, p: Proposal): EntityId | null | undefined {
  const said = strOf(p.by);
  if (said.trim() === "") return undefined;
  return personNamed(ctx, said) ?? orgNamed(ctx, said);
}

/** The words a fact quotes, as its History line gives them. */
function quoted(p: Proposal): string {
  const said = plainWords(strOf(p.said)).replace(/^["“”'‘’]+|["“”'‘’]+$/g, "");
  return said === "" ? "" : `“${said}”`;
}

/** What every fact shares: who it is about, and words that state the change. */
function common(ctx: ReadContext, p: Proposal): { who: EntityId } | Rejection {
  if (!statesChange(strOf(p.said))) return refuse("not_stated", "the reply doesn't state it as done");
  const who = personNamed(ctx, strOf(p.who));
  if (who === null) return refuse("missing_entity", `no one ${strOf(p.who) || "named"} the player character knows`);
  return { who };
}

// ---------------------------------------------------------------- membership

interface MembershipPlan {
  effects: EffectSpec[];
}

function membership(ctx: ReadContext, p: Proposal): MembershipPlan | Rejection {
  const base = common(ctx, p);
  if ("code" in base) return base;
  const { who } = base;
  const org = orgNamed(ctx, strOf(p.org));
  if (org === null) return refuse("missing_entity", `no organization ${strOf(p.org) || "named"} the player character knows`);
  const by = actorOf(ctx, p);
  if (by === null) return refuse("missing_entity", `no one ${strOf(p.by)} the player character knows`);
  const change = strOf(p.change);
  const why = quoted(p);
  const name = (id: EntityId): string => labelOf(ctx, id);
  const member = own(ctx.state.entities, who)?.relations.some((r) => r.type === MEMBER_OF && r.to === org) === true;
  const flag = (power: OrgPower, did: string): EffectSpec[] => (by === undefined || by === who ? [] : flagged(ctx, by, org, power, did));
  switch (change) {
    case "join": {
      if (member) return refuse("already", `${name(who)} is already a member of ${name(org)}`);
      const said = strOf(p.position);
      const position = said === "" ? null : positionNamed(ctx, org, said);
      if (said !== "" && position === null) return refuse("bad_position", `${name(org)} has no position ${said}`);
      const title = plainWords(strOf(p.title));
      const ops = compileOrgOp(ctx, { do: "admit", org, who, ...(title !== "" ? { title } : {}), ...(position !== null ? { position } : {}), why });
      return Array.isArray(ops) ? { effects: [...ops, ...flag("members.admit", `admitted ${name(who)} to ${name(org)}`)] } : ops;
    }
    case "leave": {
      if (!member) return refuse("already", `${name(who)} isn't a member of ${name(org)}`);
      // Anyone may leave; someone else putting them out is a removal.
      if (by === undefined || by === who) return { effects: [{ type: "orgs.leave", args: { org, who, why } }] };
      const ops = compileOrgOp(ctx, { do: "remove", org, who, why });
      return Array.isArray(ops) ? { effects: [...ops, ...flag("members.remove", `removed ${name(who)} from ${name(org)}`)] } : ops;
    }
    case "appoint": {
      const said = strOf(p.position);
      const position = positionNamed(ctx, org, said);
      if (position === null) return refuse("bad_position", said === "" ? "an appointment names one of the organization's positions" : `${name(org)} has no position ${said}`);
      const staff = member ? null : isStaff(ctx, who, org);
      if (!member && !staff) return refuse("not_member", `${name(who)} isn't in ${name(org)}`);
      const held = member ? strOf(objOf(own(ctx.state.entities, who)?.relations.find((r) => r.type === MEMBER_OF && r.to === org)?.fields).position) : strOf(own(ctx.state.entities, staff?.id ?? "")?.fields.position);
      const title = positionsOf(ctx, org).find((x) => x.id === position)?.title ?? position;
      if (held === position) return refuse("already", `${name(who)} already holds ${title}`);
      const ops = compileOrgOp(ctx, { do: "appoint", org, who, position, why });
      return Array.isArray(ops) ? { effects: [...ops, ...flag("members.appoint", `appointed ${name(who)} ${title}`)] } : ops;
    }
    case "title": {
      const title = plainWords(strOf(p.title));
      if (title === "") return refuse("bad_title", "a title is the words they go by");
      if (!member) return refuse("not_member", `${name(who)} isn't a member of ${name(org)}`);
      const ops = compileOrgOp(ctx, { do: "title", org, who, title });
      return Array.isArray(ops) ? { effects: [...ops, ...flag("members.appoint", `gave ${name(who)} the title ${title}`)] } : ops;
    }
    default:
      return refuse("bad_proposal", `a membership change is one of ${MEMBERSHIP_CHANGES.join(", ")}`);
  }
}

// ---------------------------------------------------------------- employment

/** The jobs in force `who` holds, by id. */
function jobsOf(ctx: ReadContext, who: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, e.kind, "job") && strOf(e.fields.worker) === who && strOf(e.fields.status) !== "ended";
    });
}

/** The job in force of `who` that a fact names: by its id, else for the employer it names (an organization, a person, or the place they work at), else their only one. */
function jobNamed(ctx: ReadContext, who: EntityId, p: Proposal): EntityId | Rejection {
  const jobs = jobsOf(ctx, who);
  const id = strOf(p.job).trim();
  if (id !== "") return jobs.includes(id) ? id : refuse("missing_entity", `${labelOf(ctx, who)} has no job ${id}`);
  const said = strOf(p.org).trim();
  if (said === "") return jobs.length === 1 && jobs[0] !== undefined ? jobs[0] : refuse("missing_entity", jobs.length === 0 ? `${labelOf(ctx, who)} has no job` : `which of ${labelOf(ctx, who)}'s jobs the reply means isn't said`);
  const key = placeKey(said);
  const employs = (job: EntityId): boolean => {
    const employer = strOf(own(ctx.state.entities, job)?.fields.employer);
    if (employer === said) return true;
    const place = own(ctx.world.places, employer);
    const entity = own(ctx.state.entities, employer);
    if ((place && placeKey(place.name) === key) || (entity && placeKey(entity.name) === key)) return true;
    // A job at a place a business trades at is the business's (`isStaff`).
    const org = orgNamed(ctx, said);
    return org !== null && isStaff(ctx, who, org)?.id === job;
  };
  const found = jobs.filter(employs);
  return found.length === 1 && found[0] !== undefined ? found[0] : refuse("missing_entity", `${labelOf(ctx, who)} has no job at ${said}`);
}

/** A party a hire's employer may be: an organization, or a person, the player character may know. */
function employerNamed(ctx: ReadContext, said: string): EntityId | null {
  return orgNamed(ctx, said) ?? personNamed(ctx, said);
}

function employment(ctx: ReadContext, p: Proposal): { effects: EffectSpec[] } | Rejection {
  const base = common(ctx, p);
  if ("code" in base) return base;
  const { who } = base;
  const by = actorOf(ctx, p);
  if (by === null) return refuse("missing_entity", `no one ${strOf(p.by)} the player character knows`);
  const change = strOf(p.change);
  const why = quoted(p);
  const name = (id: EntityId): string => labelOf(ctx, id);
  const flag = (org: EntityId | null, power: OrgPower, did: string): EffectSpec[] => (by === undefined || org === null || by === who ? [] : flagged(ctx, by, org, power, did));
  const line = (org: EntityId | null, text: string): EffectSpec[] => (org === null ? [] : [historyLine(org, withWhy(text, why), { names: [who] })]);
  if (change === "hired") {
    const org = employerNamed(ctx, strOf(p.org));
    if (org === null) return refuse("missing_entity", `no employer ${strOf(p.org) || "named"} the player character knows`);
    if (org === who) return refuse("bad_employer", "nobody hires themselves");
    if (jobsOf(ctx, who).some((job) => strOf(own(ctx.state.entities, job)?.fields.employer) === org)) return refuse("already", `${name(who)} already works for ${name(org)}`);
    const said = strOf(p.position);
    const position = said === "" ? null : positionNamed(ctx, org, said);
    if (said !== "" && position === null) return refuse("bad_position", `${name(org)} has no position ${said}`);
    const title = plainWords(strOf(p.title));
    const rate = typeof p.rate === "number" && Number.isFinite(p.rate) && p.rate > 0 ? Math.round(p.rate) : undefined;
    const hours = typeof p.hours === "number" && Number.isFinite(p.hours) && p.hours > 0 && p.hours <= 168 ? p.hours : undefined;
    const basis = strOf(p.basis);
    const hire: EffectSpec = { type: "economy.hire", args: { business: org, worker: who, ...(title !== "" ? { title } : {}), ...(position !== null ? { position } : {}), ...(basis !== "" ? { basis } : {}), ...(rate !== undefined ? { rate } : {}), ...(hours !== undefined ? { hours_per_week: hours } : {}) } };
    const as = title !== "" ? title : position !== null ? (positionsOf(ctx, org).find((x) => x.id === position)?.title ?? "") : "";
    const text = `Hired ${name(who)}${as !== "" ? ` as ${as}` : ""}`;
    return { effects: [hire, ...line(orgTypeOf(ctx, org) !== null ? org : null, text), ...flag(org, "staff.hire", `hired ${name(who)}`)] };
  }
  const job = jobNamed(ctx, who, p);
  if (typeof job !== "string") return job;
  const held = jobOf(ctx, job);
  const org = held?.org ?? null;
  const fields = held?.fields ?? {};
  switch (change) {
    case "let_go":
      return { effects: [{ type: "economy.job_end", args: { job } }, ...line(org, `Let ${name(who)} go`), ...flag(org, "staff.fire", `let ${name(who)} go`)] };
    case "quit":
      return { effects: [{ type: "economy.job_end", args: { job } }, ...line(org, `${name(who)} quit`)] };
    case "raise": {
      const rate = typeof p.rate === "number" && Number.isFinite(p.rate) && p.rate > 0 ? Math.round(p.rate) : undefined;
      const pct = typeof p.pct === "number" && Number.isFinite(p.pct) && p.pct > -100 && p.pct !== 0 ? p.pct : undefined;
      if (rate === undefined && pct === undefined) return refuse("bad_amount", "a raise gives the new rate or a percentage");
      const was = typeof fields.rate === "number" ? fields.rate : 0;
      const now = rate ?? Math.round(was * (1 + (pct ?? 0) / 100));
      const pay = now > 0 ? `Set ${name(who)}'s pay to ${formatMoney(now, ctx.world.currency)}` : `Changed ${name(who)}'s pay`;
      return { effects: [{ type: "economy.job_raise", args: { job, ...(rate !== undefined ? { rate } : { pct: pct ?? 0 }) } }, ...line(org, pay), ...flag(org, "staff.pay", `changed ${name(who)}'s pay`)] };
    }
    case "leave":
    case "back": {
      const leave = change === "leave";
      if (leave !== (strOf(fields.status) !== "leave")) return refuse("already", leave ? `${name(who)} is already on leave` : `${name(who)} isn't on leave`);
      return { effects: [{ type: "economy.job_leave", args: { job, leave } }, ...line(org, leave ? `Put ${name(who)} on leave` : `${name(who)} came back from leave`), ...flag(org, "staff.pay", leave ? `put ${name(who)} on leave` : `brought ${name(who)} back from leave`)] };
    }
    default:
      return refuse("bad_proposal", `an employment change is one of ${EMPLOYMENT_CHANGES.join(", ")}`);
  }
}

/** A channel over a fact's plan: validated by working it out, applied as its effects. */
function channel(type: string, plan: (ctx: ReadContext, p: Proposal) => { effects: EffectSpec[] } | Rejection): ProposalChannelDef {
  return {
    type,
    boundField: "routine",
    validate: (p, ctx) => {
      const out = plan(ctx, p);
      return "code" in out ? out : null;
    },
    toEffects: (p, ctx) => {
      const out = plan(ctx, p);
      return "code" in out ? [] : out.effects;
    },
  };
}

/** The agents' organization op and the reply's membership and employment channels. */
export function registerStory(r: CoreRegistry): void {
  r.service("orgs.op", compileOrgOp);
  r.proposal(channel("membership", membership));
  r.proposal(channel("employment", employment));
}
