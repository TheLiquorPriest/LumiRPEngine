// An organization's own actions (ORG-SPEC §3.3-3.5, §3.13, §3.17, §4.6): admitting, removing and
// leaving members; appointing them to positions and titling them; the positions themselves;
// delegating powers and revoking them; renaming. Each needs its power there, held as the
// organization's rules say (`mayAct`; a position scoped to those below it reaches only them), writes
// what it changes as the events the fold already has (`member_of` and `acts_for` links, the
// `positions` field, `engine.rename`) and its History line in the same unit, with who did it and the
// power they used, and, for a member's change, why when the act says (a GM's reason, the reply's own
// words). Positions and renaming are bookkeeping, applied at once; the rest play as turns. An effect
// with no `by` (the GM's) asks for no power.

import { ownersIn, ROLE_RIGHTS } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { ACTS_FOR, isOrgPower, ORG_ACTIONS, positionIdOf, positionIn, POWER_WORDS, type OrgLimits, type OrgPower, type Position } from "../../../shared/org";
import type { ActionDef, ParamDef } from "../../../shared/world";
import { formatMoney } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOfText } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { delegationsOf, directMembers, heldPositions, mayAct, orgPower, orgTypeOf, positionsBelow, positionsOf, seatFilled } from "../../../engine/org";
import { labelOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { linkEvents } from "../../../engine/relations";
import { MEMBER_OF } from "../../../engine/selector";
import { orgLog } from "./log";
import { dateWords } from "./view";

/** Every organization: a group of any kind (a company, a household, the party) or a trust. */
const ORG_PARAM: ParamDef = { type: "ref", of: { kind: ["business", "household", "group", "trust"] }, label: "Organization" };

type Args = Record<string, JsonValue>;

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Today in the world's calendar, as a membership's `since` writes it (`YYYY-MM-DD`). */
function today(ctx: ReadContext): string {
  const d = dateAt(calendarOf(ctx.world), ctx.state.clock);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function memberLink(ctx: ReadContext, who: EntityId, org: EntityId) {
  return own(ctx.state.entities, who)?.relations.find((r) => r.type === MEMBER_OF && r.to === org);
}

/** `who`'s `member_of` link to `org` with `change` written into its fields (null drops one), made when there is none. */
function relink(ctx: ReadContext, who: EntityId, org: EntityId, change: Readonly<Record<string, JsonValue | null>>): LedgerEvent[] | Rejection {
  const link = memberLink(ctx, who, org);
  const fields: JsonObject = link ? { ...objOf(link.fields) } : { since: today(ctx) };
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete fields[k];
    else fields[k] = v;
  }
  return linkEvents(ctx.registry, ctx.world, ctx.state, { rel: MEMBER_OF, from: who, to: org, ...(Object.keys(fields).length > 0 ? { fields } : {}), ...(link?.until !== undefined ? { until: link.until } : {}) });
}

/**
 * Whether `by` may use a members power on `org` for `who`, putting them in `position` (§3.3-3.4):
 * they hold it; and when it rests on a position scoped to those below it, everything `who` would be
 * reached through (the positions they hold, and `position`) is below that one. The refusal, or null.
 */
function mayReach(ctx: ReadContext, by: EntityId, org: EntityId, power: OrgPower, who: EntityId, position?: string): Rejection | null {
  const may = mayAct(ctx, by, org, power);
  if (!may.ok) return refuse("not_allowed", may.reason);
  if (may.grant.basis !== "position") return null;
  const mine = heldPositions(ctx, by, org).find((h) => h.position.id === may.grant.id)?.position;
  if (mine?.scope !== "below") return null;
  const below = positionsBelow(positionsOf(ctx, org), mine.id);
  const reached = [...heldPositions(ctx, who, org).map((h) => h.position.id), ...(position !== undefined ? [position] : [])];
  return reached.length > 0 && reached.every((p) => below.includes(p)) ? null : refuse("not_allowed", `${labelOf(ctx, who)} isn't below ${mine.title} at ${labelOf(ctx, org)}`);
}

/** A seat free in `position` for `who` (§3.3): fewer holders filling a seat than its seats (`seatFilled`: an organization seated there fills one while it stands), `who` aside; 0 seats is any number. */
function seatFree(ctx: ReadContext, org: EntityId, position: Position, who: EntityId): Rejection | null {
  if (position.seats === 0) return null;
  const holders = new Set(directMembers(ctx, org).filter((r) => r.position === position.id && r.who !== who && seatFilled(ctx, r.who)).map((r) => r.who));
  return holders.size < position.seats ? null : refuse("no_seat", `${position.title} at ${labelOf(ctx, org)} has no seat free`);
}

/** The organization an effect names, or why not. */
function orgOf(ctx: ReadContext, a: Args): EntityId | Rejection {
  const org = strOf(a.org);
  return orgTypeOf(ctx, org) === null ? refuse("missing_entity", `no organization ${labelOf(ctx, org)}`) : org;
}

/** The position `id` names at `org`, or why not. */
function positionAt(ctx: ReadContext, org: EntityId, id: string): Position | Rejection {
  return positionsOf(ctx, org).find((p) => p.id === id) ?? refuse("bad_position", `${labelOf(ctx, org)} has no position ${id}`);
}

function isRejection<T>(v: T | Rejection): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/** Powers as an action's words list them: ids separated by commas or spaces. */
function powersOf(v: JsonValue | undefined): OrgPower[] | Rejection {
  const words = (Array.isArray(v) ? v.map(String) : strOf(v).split(/[\s,]+/)).map((w) => w.trim()).filter((w) => w !== "");
  const unknown = words.find((w) => !isOrgPower(w));
  return unknown !== undefined ? refuse("bad_power", `${unknown} isn't a power`) : [...new Set(words as OrgPower[])];
}

/** Limits in words, as a History line gives them: ", up to $200.00 a payment and $1,000.00 a month". */
function limitWords(ctx: ReadContext, limits: OrgLimits): string {
  const { currency } = ctx.world;
  const parts = [...(limits.payment !== undefined ? [`${formatMoney(limits.payment, currency)} a payment`] : []), ...(limits.month !== undefined ? [`${formatMoney(limits.month, currency)} a month`] : [])];
  return parts.length > 0 ? `, up to ${parts.join(" and ")}` : "";
}

/** The limits `by`'s own hold of `power` at `org` rests under (§3.5): its position's or its delegation's; none for an owner or a member. */
function heldLimits(ctx: ReadContext, by: EntityId, org: EntityId, power: OrgPower): { limits: OrgLimits | undefined; below: Position | undefined } {
  const grant = orgPower(ctx, by, org, power);
  if (grant?.basis === "position") {
    const held = heldPositions(ctx, by, org).find((h) => h.position.id === grant.id)?.position;
    return { limits: held?.limits, below: held?.scope === "below" ? held : undefined };
  }
  if (grant?.basis === "delegate") return { limits: delegationsOf(ctx, org).find((d) => d.who === by && d.powers.includes(power))?.limits, below: undefined };
  return { limits: undefined, below: undefined };
}

/** The staff and member powers a position's scope confines. */
const SCOPED: readonly OrgPower[] = ["members.admit", "members.remove", "members.appoint", "staff.hire", "staff.fire", "staff.pay"];

/** A member's History line, ending with why when the act gives one (a GM's reason, the reply's own words). */
function withWhy(text: string, a: Args): string {
  const why = strOf(a.why).trim();
  return why === "" ? text : `${text}: ${why}`;
}

/** Who did it and the power they used, as its History line keeps them: none for the GM's own change (no `by`), nor a power for what they may do as themselves. */
function actedBy(by: EntityId, power: OrgPower | null): { by?: EntityId; power?: OrgPower } {
  return by === "" ? {} : { by, ...(power !== null ? { power } : {}) };
}

function admitMember(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const who = strOf(a.who);
  const by = strOf(a.by);
  if (!own(ctx.state.entities, who) || who === org) return refuse("missing_entity", `no one ${labelOf(ctx, who)} to admit`);
  if (memberLink(ctx, who, org)) return refuse("already_member", `${labelOf(ctx, who)} is already a member of ${labelOf(ctx, org)}`);
  // New members join in the position named, else the organization's default one (§3.3).
  const named = strOf(a.position);
  const id = named || (positionsOf(ctx, org).find((p) => p.default === true)?.id ?? "");
  const position = id === "" ? undefined : positionAt(ctx, org, id);
  if (position !== undefined && isRejection(position)) return position;
  if (by !== "") {
    const denied = mayReach(ctx, by, org, "members.admit", who, position?.id) ?? (named !== "" ? mayReach(ctx, by, org, "members.appoint", who, named) : null);
    if (denied) return denied;
  }
  if (position) {
    const full = seatFree(ctx, org, position, who);
    if (full) return full;
  }
  const titled = strOf(a.title).trim();
  const linked = relink(ctx, who, org, { ...(titled !== "" ? { role: titled } : {}), ...(position ? { position: position.id } : {}) });
  if (isRejection(linked)) return linked;
  const as = position?.title ?? titled;
  return [...linked, orgLog(ctx, org, withWhy(`Admitted ${labelOf(ctx, who)}${as !== "" ? ` as ${as}` : ""}`, a), { ...actedBy(by, "members.admit"), names: [who] })];
}

function removeMember(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const who = strOf(a.who);
  const by = strOf(a.by);
  if (!memberLink(ctx, who, org)) return refuse("not_member", `${labelOf(ctx, who)} isn't a member of ${labelOf(ctx, org)}`);
  if (by !== "") {
    const denied = mayReach(ctx, by, org, "members.remove", who);
    if (denied) return denied;
  }
  return [{ type: "unlink", rel: MEMBER_OF, from: who, to: org }, orgLog(ctx, org, withWhy(`Removed ${labelOf(ctx, who)}`, a), { ...actedBy(by, "members.remove"), names: [who] })];
}

/** Anyone may leave (§3.13); an owner leaves a company only by selling their share. */
function leaveOrg(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const who = strOf(a.who);
  if (!memberLink(ctx, who, org)) {
    const owner = ownersIn(own(ctx.state.entities, org)?.fields ?? {}).some((o) => o.party === who && ROLE_RIGHTS[o.role].worth);
    return owner ? refuse("owner", `${labelOf(ctx, who)} owns part of ${labelOf(ctx, org)}: selling that share is how to leave it`) : refuse("not_member", `${labelOf(ctx, who)} isn't a member of ${labelOf(ctx, org)}`);
  }
  return [{ type: "unlink", rel: MEMBER_OF, from: who, to: org }, orgLog(ctx, org, withWhy(`${labelOf(ctx, who)} left`, a), { by: who, names: [who] })];
}

/** Into a position, or out of every one with none (§3.3): one position per membership link, which is made when there is none. */
function appointMember(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const who = strOf(a.who);
  const by = strOf(a.by);
  if (!own(ctx.state.entities, who) || who === org) return refuse("missing_entity", `no one ${labelOf(ctx, who)} to appoint`);
  const id = strOf(a.position);
  const position = id === "" ? undefined : positionAt(ctx, org, id);
  if (position !== undefined && isRejection(position)) return position;
  const was = strOf(objOf(memberLink(ctx, who, org)?.fields).position);
  if (was === (position?.id ?? "")) return [];
  if (by !== "") {
    const denied = mayReach(ctx, by, org, "members.appoint", who, position?.id);
    if (denied) return denied;
  }
  if (position) {
    const full = seatFree(ctx, org, position, who);
    if (full) return full;
  }
  const linked = relink(ctx, who, org, { position: position?.id ?? null });
  if (isRejection(linked)) return linked;
  const left = positionsOf(ctx, org).find((p) => p.id === was)?.title ?? was;
  const text = position ? `Appointed ${labelOf(ctx, who)} ${position.title}` : `${labelOf(ctx, who)} no longer holds ${left}`;
  return [...linked, orgLog(ctx, org, withWhy(text, a), { ...actedBy(by, "members.appoint"), names: [who] })];
}

/** A member's own title (§3.3: `member_of.role`), by someone who may appoint, or by the member themselves; none clears it. */
function titleMember(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const who = strOf(a.who);
  const by = strOf(a.by);
  if (!own(ctx.state.entities, who) || who === org) return refuse("missing_entity", `no one ${labelOf(ctx, who)} to title`);
  const words = strOf(a.title).trim();
  if (strOf(objOf(memberLink(ctx, who, org)?.fields).role) === words) return [];
  if (by !== "" && by !== who) {
    const denied = mayReach(ctx, by, org, "members.appoint", who);
    if (denied) return denied;
  }
  const linked = relink(ctx, who, org, { role: words === "" ? null : words });
  if (isRejection(linked)) return linked;
  return [...linked, orgLog(ctx, org, withWhy(words !== "" ? `${labelOf(ctx, who)} goes by ${words}` : `${labelOf(ctx, who)} no longer has a title of their own`, a), { ...actedBy(by, by === who ? null : "members.appoint"), names: [who] })];
}

/**
 * A position added, changed or removed (§3.3, `org.govern`): the `positions` field written whole.
 * A new default clears the old one; a removed one's reports are left reporting to no one. What isn't
 * given stays as it was; `no_report` has it report to no one, and a limit given as 0 is none.
 */
function setPosition(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const by = strOf(a.by);
  if (by !== "") {
    const may = mayAct(ctx, by, org, "org.govern");
    if (!may.ok) return refuse("not_allowed", may.reason);
  }
  const positions = positionsOf(ctx, org);
  const id = strOf(a.id) || positionIdOf(strOf(a.title));
  if (id === "") return refuse("bad_position", "a position needs a title");
  const before = positions.find((p) => p.id === id);
  const write = (list: readonly Position[]): LedgerEvent => ({ type: "set", entity: org, field: "positions", value: list as unknown as JsonValue });
  if (a.remove === true) {
    if (!before) return refuse("bad_position", `${labelOf(ctx, org)} has no position ${id}`);
    const rest = positions.filter((p) => p.id !== id).map((p) => (p.reports_to === id ? (({ reports_to: _gone, ...keep }) => keep)(p) : p));
    return [write(rest), orgLog(ctx, org, `Removed the position ${before.title}`, by !== "" ? { by, power: "org.govern" } : {})];
  }
  const powers = a.powers === undefined || a.powers === null || a.powers === "" ? (before?.powers ?? []) : powersOf(a.powers);
  if (isRejection(powers)) return powers;
  const num = (k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k]) ? Math.round(a[k] as number) : undefined);
  const text = (k: string): string | undefined => (typeof a[k] === "string" && a[k] !== "" ? (a[k] as string) : undefined);
  const limits: OrgLimits = { ...(before?.limits ?? {}), ...(num("payment") !== undefined ? { payment: num("payment") } : {}), ...(num("month") !== undefined ? { month: num("month") } : {}) };
  if (limits.payment === 0) delete limits.payment;
  if (limits.month === 0) delete limits.month;
  const clearsReport = a.no_report === true;
  const kept: JsonObject = { ...((before ?? {}) as unknown as JsonObject) };
  if (clearsReport) delete kept.reports_to;
  delete kept.limits;
  const next = positionIn({
    ...kept,
    id,
    title: strOf(a.title).trim() || before?.title || id.replace(/_/g, " "),
    powers,
    ...(num("seats") !== undefined ? { seats: num("seats") } : {}),
    ...(text("reports_to") !== undefined ? { reports_to: text("reports_to") } : {}),
    ...(text("scope") !== undefined ? { scope: text("scope") } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(text("successor") !== undefined ? { successor: text("successor") } : {}),
    ...(typeof a.default === "boolean" ? { default: a.default } : {}),
  } as unknown as JsonObject);
  if (!next) return refuse("bad_position", "a position needs a title");
  if (a.default === false) delete next.default;
  if (next.reports_to !== undefined) {
    if (next.reports_to === id || !positions.some((p) => p.id === next.reports_to)) return refuse("bad_position", `${labelOf(ctx, org)} has no other position ${next.reports_to} to report to`);
    if (positionsBelow(positions, id).includes(next.reports_to)) return refuse("reports_cycle", `${next.title} can't report to a position that reports to it`);
  }
  const list = [...positions.filter((p) => p.id !== id).map((p) => (next.default === true && p.default === true ? (({ default: _was, ...keep }) => keep)(p) : p)), next];
  const ordered = before ? positions.map((p) => list.find((q) => q.id === p.id) ?? p) : list;
  return [write(ordered), orgLog(ctx, org, `${before ? "Changed" : "Added"} the position ${next.title}`, by !== "" ? { by, power: "org.govern" } : {})];
}

/** The last minute of the day a date names, as a link's `until` reads it; a clock as given. */
function endOfDay(ctx: ReadContext, v: JsonValue | undefined): number | undefined | Rejection {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const text = strOf(v).trim();
  if (text === "") return undefined;
  try {
    const cal = calendarOf(ctx.world);
    return clockAt(cal, dayIndexOfText(cal, text.slice(0, 10)) + 1, 0) - 1;
  } catch {
    return refuse("bad_date", "until is a date (YYYY-MM-DD)");
  }
}

/**
 * A delegation (§3.5): its granter holds `delegate` and gives only powers they hold themselves,
 * within their own limits (a limit of theirs stands on the delegation unless a lower one is given)
 * and never wider than a scope confined to those below them. It ends at the end of `until`'s day.
 */
function delegatePowers(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const to = strOf(a.to);
  const by = strOf(a.by);
  if (!own(ctx.state.entities, to) || to === org || to === by) return refuse("missing_entity", `no one ${labelOf(ctx, to)} to act for ${labelOf(ctx, org)}`);
  const powers = powersOf(a.powers);
  if (isRejection(powers)) return powers;
  if (powers.length === 0) return refuse("bad_power", "a delegation gives at least one power");
  const asked: OrgLimits = { ...(typeof a.payment === "number" && a.payment > 0 ? { payment: Math.round(a.payment) } : {}), ...(typeof a.month === "number" && a.month > 0 ? { month: Math.round(a.month) } : {}) };
  const limits: OrgLimits = { ...asked };
  if (by !== "") {
    const may = mayAct(ctx, by, org, "delegate");
    if (!may.ok) return refuse("not_allowed", may.reason);
    for (const power of powers) {
      if (orgPower(ctx, by, org, power) === null) return refuse("not_allowed", `${labelOf(ctx, by)} may not ${POWER_WORDS[power]} for ${labelOf(ctx, org)}, so can't give that`);
      const mine = heldLimits(ctx, by, org, power);
      if (mine.below && SCOPED.includes(power)) return refuse("not_allowed", `${labelOf(ctx, by)} may ${POWER_WORDS[power]} only for those below ${mine.below.title}, so can't give that for all of ${labelOf(ctx, org)}`);
      const theirs = mine.limits;
      if (theirs?.payment !== undefined && (limits.payment === undefined || limits.payment > theirs.payment)) limits.payment = theirs.payment;
      if (theirs?.month !== undefined && (limits.month === undefined || limits.month > theirs.month)) limits.month = theirs.month;
      if (theirs?.accounts !== undefined) limits.accounts = limits.accounts ? limits.accounts.filter((x) => theirs.accounts?.includes(x)) : [...theirs.accounts];
    }
  }
  const until = endOfDay(ctx, a.until);
  if (until !== undefined && isRejection(until)) return until;
  if (until !== undefined && until < ctx.state.clock) return refuse("bad_date", "a delegation ends after today");
  const fields: JsonObject = { powers, ...(limits.payment !== undefined ? { payment: limits.payment } : {}), ...(limits.month !== undefined ? { month: limits.month } : {}), ...(limits.accounts !== undefined ? { accounts: limits.accounts } : {}), ...(by !== "" ? { by } : {}) };
  const linked = linkEvents(ctx.registry, ctx.world, ctx.state, { rel: ACTS_FOR, from: to, to: org, fields, ...(until !== undefined ? { until } : {}) });
  if (isRejection(linked)) return linked;
  const when = typeof a.until === "string" && a.until.trim() !== "" ? `, until ${dateWords(ctx, a.until.trim().slice(0, 10))}` : "";
  return [...linked, orgLog(ctx, org, `Let ${labelOf(ctx, to)} ${powers.map((p) => POWER_WORDS[p]).join(", ")}${limitWords(ctx, limits)}${when}`, { ...actedBy(by, "delegate"), names: [to] })];
}

/** A delegation ended (§3.5): by its granter, or by a holder of `delegate` whose own powers cover it. */
function revokeDelegation(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const to = strOf(a.to);
  const by = strOf(a.by);
  const link = own(ctx.state.entities, to)?.relations.find((r) => r.type === ACTS_FOR && r.to === org);
  if (!link) return refuse("no_delegation", `${labelOf(ctx, to)} doesn't act for ${labelOf(ctx, org)}`);
  const f = objOf(link.fields);
  if (by !== "" && by !== strOf(f.by)) {
    const may = mayAct(ctx, by, org, "delegate");
    if (!may.ok) return refuse("not_allowed", may.reason);
    const given = Array.isArray(f.powers) ? f.powers.filter(isOrgPower) : [];
    const beyond = given.find((p) => orgPower(ctx, by, org, p) === null);
    if (beyond !== undefined) return refuse("not_allowed", `${labelOf(ctx, by)} may not ${POWER_WORDS[beyond]} for ${labelOf(ctx, org)}, so can't take that back`);
  }
  return [{ type: "unlink", rel: ACTS_FOR, from: to, to: org }, orgLog(ctx, org, `${labelOf(ctx, to)} no longer acts for it`, { ...actedBy(by, by === strOf(f.by) ? null : "delegate"), names: [to] })];
}

/** A new name (§3.13, `org.govern`), applied at once. */
function renameOrg(ctx: EffectContext, a: Args): LedgerEvent[] | Rejection {
  const org = orgOf(ctx, a);
  if (isRejection(org)) return org;
  const by = strOf(a.by);
  const name = strOf(a.name).trim();
  const was = own(ctx.state.entities, org)?.name ?? org;
  if (name === "") return refuse("bad_name", "a new name, please");
  if (name === was) return [];
  if (by !== "") {
    const may = mayAct(ctx, by, org, "org.govern");
    if (!may.ok) return refuse("not_allowed", may.reason);
  }
  return [{ type: ENGINE_EVENTS.rename, data: { entity: org, name, was } }, orgLog(ctx, org, `Renamed from ${was} to ${name}`, actedBy(by, "org.govern"))];
}

/** At once, as bookkeeping (§4.6): positions and renaming. */
const AT_ONCE = { duration: "2", observable: "does some paperwork", mechanical: true } as const;

const ACTIONS: readonly ActionDef[] = [
  {
    id: ORG_ACTIONS.admit,
    label: "Admit a member",
    description: "Admit someone to an organization, with a title or into a position.",
    pack: "orgs",
    params: { org: ORG_PARAM, who: { type: "ref", label: "Whom" }, title: { type: "text", optional: true, label: "Title" }, position: { type: "text", optional: true, label: "Position (its id)" } },
    requires: ["may(self, org, 'members.admit')"],
    outcomes: { default: [{ type: "orgs.admit", args: { org: "org", who: "who", title: "=params.title", position: "=params.position", by: "self" } }] },
    duration: "10",
    lexicon: ["admit", "take in as a member", "welcome into"],
    observable: "welcomes someone in",
  },
  {
    id: ORG_ACTIONS.remove,
    label: "Remove a member",
    description: "Remove someone from an organization.",
    pack: "orgs",
    params: { org: ORG_PARAM, who: { type: "ref", label: "Whom" } },
    requires: ["may(self, org, 'members.remove')"],
    outcomes: { default: [{ type: "orgs.remove", args: { org: "org", who: "who", by: "self" } }] },
    duration: "10",
    lexicon: ["throw out", "expel", "remove from the group"],
    observable: "has a word with someone",
  },
  {
    id: ORG_ACTIONS.leave,
    label: "Leave",
    description: "Leave an organization you're a member of.",
    pack: "orgs",
    params: { org: ORG_PARAM },
    requires: ["member_of(self, org)"],
    outcomes: { default: [{ type: "orgs.leave", args: { org: "org", who: "self" } }] },
    duration: "5",
    lexicon: ["leave the group", "quit the club", "resign from"],
    observable: "says their goodbyes",
  },
  {
    id: ORG_ACTIONS.appoint,
    label: "Appoint",
    description: "Appoint someone to a position in an organization, or take them out of theirs.",
    pack: "orgs",
    params: { org: ORG_PARAM, who: { type: "ref", label: "Whom" }, position: { type: "text", optional: true, label: "Position (its id; none takes them out of theirs)" } },
    requires: ["may(self, org, 'members.appoint')"],
    outcomes: { default: [{ type: "orgs.appoint", args: { org: "org", who: "who", position: "=params.position", by: "self" } }] },
    duration: "10",
    lexicon: ["appoint", "make them foreman", "promote"],
    observable: "has a word with someone",
  },
  {
    id: ORG_ACTIONS.title,
    label: "Change title",
    description: "Give someone in an organization a title of their own, or take it away.",
    pack: "orgs",
    params: { org: ORG_PARAM, who: { type: "ref", label: "Whom" }, title: { type: "text", optional: true, label: "Title (none clears it)" } },
    requires: ["who == self or may(self, org, 'members.appoint')"],
    outcomes: { default: [{ type: "orgs.title", args: { org: "org", who: "who", title: "=params.title", by: "self" } }] },
    duration: "5",
    lexicon: ["call them", "give them the title"],
    observable: "has a word with someone",
  },
  {
    id: ORG_ACTIONS.position,
    label: "Set a position",
    description: "Add, change or remove a position in an organization: its title, powers, seats, whom it reports to, its scope and limits.",
    pack: "orgs",
    params: {
      org: ORG_PARAM,
      title: { type: "text", label: "Title" },
      id: { type: "text", optional: true, label: "Id (else from the title)" },
      powers: { type: "text", optional: true, label: "Powers (ids, comma separated)" },
      seats: { type: "number", optional: true, label: "Seats (0 is any number)" },
      reports_to: { type: "text", optional: true, label: "Reports to (a position's id)" },
      no_report: { type: "bool", optional: true, label: "Reports to no one" },
      scope: { type: "text", optional: true, label: "Scope: org, or below" },
      payment: { type: "money", optional: true, label: "Each payment at most" },
      month: { type: "money", optional: true, label: "Each month at most" },
      successor: { type: "text", optional: true, label: "Successor: next, vacant, or someone's id" },
      default: { type: "bool", optional: true, label: "New members join in it" },
      remove: { type: "bool", optional: true, label: "Remove it" },
    },
    requires: ["may(self, org, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.position", args: { org: "org", title: "=params.title", id: "=params.id", powers: "=params.powers", seats: "=params.seats", reports_to: "=params.reports_to", no_report: "=params.no_report", scope: "=params.scope", payment: "=params.payment", month: "=params.month", successor: "=params.successor", default: "=params.default", remove: "=params.remove", by: "self" } }] },
    lexicon: ["add a position", "change the position"],
    ...AT_ONCE,
  },
  {
    id: ORG_ACTIONS.delegate,
    label: "Delegate",
    description: "Let someone act for an organization with some of your powers there, within limits, until a date.",
    pack: "orgs",
    params: { org: ORG_PARAM, to: { type: "ref", label: "To" }, powers: { type: "text", label: "Powers (ids, comma separated)" }, payment: { type: "money", optional: true, label: "Each payment at most" }, month: { type: "money", optional: true, label: "Each month at most" }, until: { type: "date", optional: true, label: "Until (YYYY-MM-DD)" } },
    requires: ["may(self, org, 'delegate')"],
    outcomes: { default: [{ type: "orgs.delegate", args: { org: "org", to: "to", powers: "=params.powers", payment: "=params.payment", month: "=params.month", until: "=params.until", by: "self" } }] },
    duration: "10",
    lexicon: ["let them act for", "delegate", "give them authority"],
    observable: "signs a letter of authority",
  },
  {
    id: ORG_ACTIONS.revoke,
    label: "Revoke",
    description: "End someone's delegation to act for an organization.",
    pack: "orgs",
    params: { org: ORG_PARAM, to: { type: "ref", label: "Whose" } },
    requires: ["may(self, org, 'delegate')"],
    outcomes: { default: [{ type: "orgs.revoke", args: { org: "org", to: "to", by: "self" } }] },
    duration: "5",
    lexicon: ["revoke", "take back their authority"],
    observable: "has a word with someone",
  },
  {
    id: ORG_ACTIONS.rename,
    label: "Rename",
    description: "Give an organization a new name.",
    pack: "orgs",
    params: { org: ORG_PARAM, name: { type: "text", label: "New name" } },
    requires: ["may(self, org, 'org.govern')"],
    outcomes: { default: [{ type: "orgs.rename", args: { org: "org", name: "=params.name", by: "self" } }] },
    lexicon: ["rename", "call it"],
    ...AT_ONCE,
  },
];

/** The org_* actions and their effects. Positions and delegations are the GM's to set too (GM → Orgs → Rules), with no `by` asking for no power. */
export function registerOrgActions(r: CoreRegistry): void {
  r.effect({ type: "orgs.admit", args: ["org", "who", "title?", "position?", "by?", "why?"], resolve: (a, ctx) => admitMember(ctx, a) });
  r.effect({ type: "orgs.remove", args: ["org", "who", "by?", "why?"], resolve: (a, ctx) => removeMember(ctx, a) });
  r.effect({ type: "orgs.leave", args: ["org", "who", "why?"], resolve: (a, ctx) => leaveOrg(ctx, a) });
  r.effect({ type: "orgs.appoint", args: ["org", "who", "position?", "by?", "why?"], resolve: (a, ctx) => appointMember(ctx, a) });
  r.effect({ type: "orgs.title", args: ["org", "who", "title?", "by?", "why?"], resolve: (a, ctx) => titleMember(ctx, a) });
  r.effect({ type: "orgs.position", args: ["org", "title?", "id?", "powers?", "seats?", "reports_to?", "no_report?", "scope?", "payment?", "month?", "successor?", "default?", "remove?", "by?"], resolve: (a, ctx) => setPosition(ctx, a), gm: true });
  r.effect({ type: "orgs.delegate", args: ["org", "to", "powers", "payment?", "month?", "until?", "by?"], resolve: (a, ctx) => delegatePowers(ctx, a), gm: true });
  r.effect({ type: "orgs.revoke", args: ["org", "to", "by?"], resolve: (a, ctx) => revokeDelegation(ctx, a), gm: true });
  r.effect({ type: "orgs.rename", args: ["org", "name", "by?"], resolve: (a, ctx) => renameOrg(ctx, a) });
  for (const def of ACTIONS) r.action(def);
}
