// An organization op (ORG-SPEC §7.2) as the orgs pack compiles it (`orgs.op`): the packs' own effects,
// named with no actor, so they are the GM's and ask for no power (an effect with no `by`), and the
// op's History line where the effect writes none (the economy's staff effects write one only for an
// actor). The GM edit `{op: "org"}` runs them as one unit (`engine/edits.ts`), and the reply's
// membership and employment channels speak the same effects (`story.ts`). An op naming who did it
// (a delegation's granter) lands with them, and, when they don't hold the power, flagged with a GM
// note, as a grant from someone who may not make it is (O7). Pure.

import type { EntityId } from "../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { listingIn, ownersIn, unitsOf } from "../../../shared/finance";
import { ACTS_FOR, AS_THE_WORLD, DUES_EVERY, ORGS_ENTRY, POWER_WORDS, type OrgPower } from "../../../shared/org";
import { DECISION_EFFECTS } from "../../../shared/org-motions";
import type { OrgOp } from "../../../shared/org-ops";
import { PARTY_OUT } from "../../../shared/party";
import { formatMoney, type EffectSpec } from "../../../shared/world";
import { calendarOf, clockAt, dayIndexOfText } from "../../../engine/calendar";
import { dayWords, dissolvedOn, isStaff, orgPower, orgTypeOf, positionsOf } from "../../../engine/org";
import { labelOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { isGone } from "../../../engine/scope";
import { MEMBER_OF } from "../../../engine/selector";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** An organization op (§7.2) as the packs' own effects, the GM's (no actor, so no power asked), with its History line where they write none; or why it can't be. */
    "orgs.op": (ctx: ReadContext, op: OrgOp) => EffectSpec[] | Rejection;
  }
}

function refuse(code: string, reason: string): Rejection {
  return { code, reason };
}

/**
 * Words an effect reads as given: a leading `=` would make an effect run through a channel read it
 * as a formula, so words never start with one.
 */
export function plainWords(text: string): string {
  return text.trim().replace(/^=+\s*/, "");
}

/**
 * A History line for `org` (`orgs.note`): `names` the people its words name, so a reader who can't
 * see one of them reads "someone" there; `by` who did it, when someone did.
 */
export function historyLine(org: EntityId, text: string, opts: { by?: EntityId; names?: readonly EntityId[] } = {}): EffectSpec {
  const names = [...new Set((opts.names ?? []).filter((id) => id !== ""))];
  return { type: "orgs.note", args: { org, text: plainWords(text), ...(opts.by !== undefined && opts.by !== "" ? { by: opts.by } : {}), ...(names.length > 0 ? { names } : {}) } };
}

/** A History line with its reason: "Hired Jess Kowalczyk as Receptionist: she starts Monday". */
export function withWhy(text: string, why: string | undefined): string {
  const reason = plainWords(why ?? "");
  return reason === "" ? text : `${text}: ${reason}`;
}

/**
 * A GM note flagging a change someone made for an organization without the power it needs (O7: the
 * story's change lands, flagged); none when they hold it, or when they are the organization.
 */
export function flagged(ctx: ReadContext, by: EntityId | undefined, org: EntityId, power: OrgPower, did: string): EffectSpec[] {
  if (by === undefined || by === "" || by === org || orgTypeOf(ctx, org) === null || orgPower(ctx, by, org, power) !== null) return [];
  const who = labelOf(ctx, by);
  return [{ type: "note", args: { text: plainWords(`${who} ${did}, though ${who} may not ${POWER_WORDS[power]} for ${labelOf(ctx, org)}.`), visibility: "secret" } }];
}

/** The id of `org`'s position that `said` names: its id, or its title in any case; null for none it defines. */
export function positionNamed(ctx: ReadContext, org: EntityId, said: string): string | null {
  const key = said.trim().toLowerCase().replace(/\s+/g, " ");
  if (key === "") return null;
  const positions = positionsOf(ctx, org);
  return (positions.find((p) => p.id === said.trim()) ?? positions.find((p) => p.title.toLowerCase().replace(/\s+/g, " ") === key))?.id ?? null;
}

/** The job's worker, its employer when that is an organization, and its fields; null for no job. */
export function jobOf(ctx: ReadContext, job: EntityId): { worker: EntityId; org: EntityId | null; fields: Readonly<Record<string, JsonValue>> } | null {
  const e = own(ctx.state.entities, job);
  if (!e || isGone(ctx.state, job) || strOf(e.fields.worker) === "") return null;
  const employer = strOf(e.fields.employer);
  return { worker: strOf(e.fields.worker), org: orgTypeOf(ctx, employer) !== null ? employer : null, fields: e.fields };
}

function money(ctx: ReadContext, cents: number): string {
  return formatMoney(Math.round(cents), ctx.world.currency);
}

/** The last minute of the day a date names (`YYYY-MM-DD`), as a link's `until` reads it; a rejection for words that name no day. */
function endOfDay(ctx: ReadContext, date: string): number | Rejection {
  try {
    const cal = calendarOf(ctx.world);
    return clockAt(cal, dayIndexOfText(cal, date.slice(0, 10)) + 1, 0) - 1;
  } catch {
    return refuse("bad_date", "until is a date (YYYY-MM-DD)");
  }
}

/** An organization an op names, or why not. */
function orgProblem(ctx: ReadContext, org: EntityId): Rejection | null {
  if (orgTypeOf(ctx, org) === null || isGone(ctx.state, org)) return refuse("missing_entity", `no organization ${labelOf(ctx, org)}`);
  const dissolved = dissolvedOn(ctx.state, org);
  return dissolved === null ? null : refuse("dissolved", `${labelOf(ctx, org)} was dissolved on ${dayWords(ctx.world, dissolved)}`);
}

/** The cadence an organization's dues run on now, and the day they fall on when its `dues` field (a one-record list) sets one; null when it sets none. */
function duesNow(ctx: ReadContext, org: EntityId): { every: (typeof DUES_EVERY)[number]; day?: number } | null {
  const raw = own(ctx.state.entities, org)?.fields.dues;
  const d = Array.isArray(raw) ? raw.find(isRecord) : raw;
  const every = isRecord(d) ? DUES_EVERY.find((e) => e === (d.every ?? "month")) : undefined;
  if (!isRecord(d) || every === undefined) return null;
  return { every, ...(typeof d.day === "number" && Number.isInteger(d.day) ? { day: d.day } : {}) };
}

/** An effect another lane's pack registers (shares, founding, entry, the party), or why this world can't run it. */
function needs(ctx: ReadContext, type: string, what: string): Rejection | null {
  return ctx.registry.effects.has(type) ? null : refuse("not_available", `this world can't ${what}`);
}

/** The op's effects, or why not. */
export function compileOrgOp(ctx: ReadContext, op: OrgOp): EffectSpec[] | Rejection {
  const name = (id: EntityId): string => labelOf(ctx, id);
  switch (op.do) {
    case "found": {
      const missing = needs(ctx, "orgs.found", "found an organization");
      if (missing) return missing;
      // An organization founding another names itself as `founder` (a subsidiary, a trust it settles, a nonprofit; no actor, so no power or votes asked); a person founds as themselves.
      const founder: JsonObject = orgTypeOf(ctx, op.founder) !== null ? { founder: op.founder } : { by: op.founder };
      const terms: JsonObject = { ...(op.trustee !== undefined ? { trustee: op.trustee } : {}), ...(op.beneficiary !== undefined ? { beneficiary: op.beneficiary } : {}), ...(op.revocable !== undefined ? { revocable: op.revocable } : {}), ...(op.purpose !== undefined ? { purpose: plainWords(op.purpose) } : {}), ...(op.until !== undefined ? { until: op.until } : {}) };
      return [{ type: "orgs.found", args: { type: op.type, name: plainWords(op.name), ...(op.kind !== undefined ? { kind: op.kind } : {}), ...(op.structure !== undefined ? { structure: op.structure } : {}), ...(op.capital !== undefined ? { cents: Math.round(op.capital) } : {}), ...(op.from !== undefined ? { from: op.from } : {}), ...(op.units !== undefined ? { units: Math.round(op.units) } : {}), ...terms, ...founder } }];
    }
    case "admit": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.admit", args: { org: op.org, who: op.who, ...(op.title !== undefined ? { title: plainWords(op.title) } : {}), ...(op.position !== undefined ? { position: op.position } : {}), why: plainWords(op.why) } }];
    }
    case "remove": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.remove", args: { org: op.org, who: op.who, why: plainWords(op.why) } }];
    }
    case "appoint": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      // A member holds a position by their membership; staff who aren't members, by their job (§3.3).
      const job = own(ctx.state.entities, op.who)?.relations.some((r) => r.type === MEMBER_OF && r.to === op.org) === true ? null : isStaff(ctx, op.who, op.org);
      if (!job) return [{ type: "orgs.appoint", args: { org: op.org, who: op.who, position: op.position ?? "", why: plainWords(op.why) } }];
      const title = op.position === null ? null : (positionsOf(ctx, op.org).find((p) => p.id === op.position)?.title ?? op.position);
      const text = title === null ? `${name(op.who)} no longer holds a position` : `Appointed ${name(op.who)} ${title}`;
      return [{ type: "economy.job_position", args: { job: job.id, position: op.position ?? "" } }, historyLine(op.org, withWhy(text, op.why), { names: [op.who] })];
    }
    case "title": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.title", args: { org: op.org, who: op.who, title: op.title === null ? "" : plainWords(op.title) } }];
    }
    case "position": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      const p = op.position;
      const args: JsonObject = { org: op.org, title: plainWords(p.title) };
      if (p.id !== undefined) args.id = p.id;
      if (p.powers !== undefined) args.powers = p.powers;
      if (p.seats !== undefined) args.seats = Math.round(p.seats);
      if (p.reports_to !== undefined) args.reports_to = p.reports_to;
      if (p.scope !== undefined) args.scope = p.scope;
      if (p.limits?.payment !== undefined) args.payment = Math.round(p.limits.payment);
      if (p.limits?.month !== undefined) args.month = Math.round(p.limits.month);
      if (p.successor !== undefined) args.successor = p.successor;
      if (p.default !== undefined) args.default = p.default;
      return [{ type: "orgs.position", args }];
    }
    case "unposition": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.position", args: { org: op.org, id: op.position, remove: true } }];
    }
    case "delegate": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      if (!own(ctx.state.entities, op.to) || op.to === op.org) return refuse("missing_entity", `no one ${name(op.to)} to act for ${name(op.org)}`);
      if (op.to === op.by) return refuse("bad_delegation", "a delegation is to someone else");
      // The GM records it as its granter gave it: their name on it, flagged when they couldn't.
      const until = op.until === undefined ? undefined : endOfDay(ctx, op.until);
      if (typeof until === "object") return until;
      if (until !== undefined && until < ctx.state.clock) return refuse("bad_date", "a delegation ends after today");
      const fields: JsonObject = { powers: op.powers, ...(op.payment !== undefined && op.payment > 0 ? { payment: Math.round(op.payment) } : {}), ...(op.month !== undefined && op.month > 0 ? { month: Math.round(op.month) } : {}), ...(op.accounts !== undefined ? { accounts: op.accounts } : {}), by: op.by };
      const limits = [...(op.payment !== undefined && op.payment > 0 ? [`${money(ctx, op.payment)} a payment`] : []), ...(op.month !== undefined && op.month > 0 ? [`${money(ctx, op.month)} a month`] : [])];
      const text = `${name(op.by)} let ${name(op.to)} ${op.powers.map((p) => POWER_WORDS[p]).join(", ")}${limits.length > 0 ? `, up to ${limits.join(" and ")}` : ""}${op.until !== undefined ? `, until ${op.until.slice(0, 10)}` : ""}`;
      const lacking = op.powers.find((p) => orgPower(ctx, op.by, op.org, p) === null);
      return [
        { type: "link", args: { rel: ACTS_FOR, from: op.to, to: op.org, fields, ...(until !== undefined ? { until } : {}) } },
        historyLine(op.org, text, { by: op.by, names: [op.by, op.to] }),
        ...flagged(ctx, op.by, op.org, "delegate", `let ${name(op.to)} act for ${name(op.org)}`),
        ...(lacking !== undefined && orgPower(ctx, op.by, op.org, "delegate") !== null ? flagged(ctx, op.by, op.org, lacking, `let ${name(op.to)} ${POWER_WORDS[lacking]}`) : []),
      ];
    }
    case "revoke": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.revoke", args: { org: op.org, to: op.to } }];
    }
    case "hire": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      const title = op.title ?? (op.position !== undefined ? positionsOf(ctx, op.org).find((p) => p.id === op.position)?.title : undefined);
      return [
        { type: "economy.hire", args: { business: op.org, worker: op.who, ...(op.position !== undefined ? { position: op.position } : {}), ...(op.title !== undefined ? { title: plainWords(op.title) } : {}), ...(op.basis !== undefined ? { basis: op.basis } : {}), ...(op.rate !== undefined ? { rate: Math.round(op.rate) } : {}), ...(op.hours !== undefined ? { hours_per_week: op.hours } : {}) } },
        historyLine(op.org, `Hired ${name(op.who)}${title !== undefined && title !== "" ? ` as ${title}` : ""}`, { names: [op.who] }),
      ];
    }
    case "fire": {
      const job = jobOf(ctx, op.job);
      if (!job) return refuse("missing_entity", `no job ${name(op.job)}`);
      return [{ type: "economy.job_end", args: { job: op.job } }, ...(job.org !== null ? [historyLine(job.org, withWhy(`Let ${name(job.worker)} go`, op.why), { names: [job.worker] })] : [])];
    }
    case "pay": {
      const job = jobOf(ctx, op.job);
      if (!job) return refuse("missing_entity", `no job ${name(op.job)}`);
      const was = typeof job.fields.rate === "number" ? job.fields.rate : 0;
      const rate = op.rate !== undefined ? Math.round(op.rate) : Math.round(was * (1 + (op.pct ?? 0) / 100));
      return [{ type: "economy.job_raise", args: { job: op.job, ...(op.rate !== undefined ? { rate: Math.round(op.rate) } : { pct: op.pct ?? 0 }) } }, ...(job.org !== null && rate > 0 ? [historyLine(job.org, `Set ${name(job.worker)}'s pay to ${money(ctx, rate)}`, { names: [job.worker] })] : [])];
    }
    case "issue": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.shares_issue", "issue shares");
      if (missing) return missing;
      return [{ type: "economy.shares_issue", args: { business: op.org, to: op.to, units: Math.round(op.units), price: Math.round(op.price), ...(op.class !== undefined ? { class: op.class } : {}), ...(op.from !== undefined ? { from: op.from } : {}) } }];
    }
    case "buy_back": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.shares_buy_back", "buy back shares");
      if (missing) return missing;
      return [{ type: "economy.shares_buy_back", args: { business: op.org, from: op.from, units: Math.round(op.units), price: Math.round(op.price) } }];
    }
    case "transfer": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      if (op.units === undefined && op.pct === undefined) return refuse("bad_args", "a transfer gives its units or its percentage");
      // Sold, or given for nothing: the price is the whole stake's.
      return [{ type: "economy.stake_sell", args: { business: op.org, party: op.from, buyer: op.to, ...(op.units !== undefined ? { units: Math.round(op.units) } : {}), ...(op.pct !== undefined ? { share: op.pct } : {}), price: Math.round(op.price ?? 0) } }];
    }
    case "list": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.list", "list a company on a market");
      if (missing) return missing;
      return [{ type: "economy.list", args: { business: op.org, units: Math.round(op.units), ...(op.price !== undefined ? { price: Math.round(op.price) } : {}), ...(op.symbol !== undefined ? { symbol: op.symbol } : {}) } }];
    }
    case "delist": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.delist", "take a company off a market");
      if (missing) return missing;
      return [{ type: "economy.delist", args: { business: op.org, ...(op.price !== undefined ? { price: Math.round(op.price) } : {}) } }];
    }
    case "trade": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      const fields = own(ctx.state.entities, op.org)?.fields ?? {};
      const listing = listingIn(fields);
      if (!listing) return refuse("not_listed", `${name(op.org)} isn't on a market`);
      // Units held on the cap table, and none on the market, sell into its float as a stake with no buyer.
      const onMarket = Object.values(ctx.state.entities).some((e) => e.kind === "holding" && e.fields.asset === listing.asset && ownersIn(own(ctx.state.entities, strOf(e.fields.account))?.fields ?? e.fields).some((o) => o.party === op.who));
      if (op.side === "sell" && !onMarket && unitsOf(ownersIn(fields), op.who) > 0) return [{ type: "economy.stake_sell", args: { business: op.org, party: op.who, units: Math.round(op.units), price: 0 } }];
      return [{ type: "economy.trade", args: { side: op.side, party: op.who, asset: listing.asset, qty: Math.round(op.units), ...(op.account !== undefined ? { account: op.account } : {}) } }];
    }
    case "entry":
      return [{ type: ORGS_ENTRY, args: { place: op.place, entry: op.entry ?? AS_THE_WORLD, ...(op.keys !== undefined ? { keys: op.keys } : {}) } }];
    case "dues": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      const cents = op.cents === null ? 0 : Math.round(op.cents);
      // A cadence not given is the one the dues run on, and a cadence kept keeps the day they fall on.
      const was = duesNow(ctx, op.org);
      const every = op.every ?? was?.every ?? "month";
      const day = was !== null && was.every === every ? was.day : undefined;
      return [{ type: "economy.dues", args: { org: op.org, cents, every, ...(day !== undefined ? { day } : {}) } }, historyLine(op.org, cents > 0 ? `Set dues of ${money(ctx, cents)} a ${every}` : "Ended dues")];
    }
    case "tier":
      // The party pack's own: a tier for someone the player character knows, or out of the party.
      return [{ type: "orgs.party_tier", args: { who: op.who, tier: op.tier ?? PARTY_OUT } }];
    case "restructure": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "orgs.restructure", "restructure a company");
      if (missing) return missing;
      return [{ type: "orgs.restructure", args: { org: op.org, structure: op.structure } }];
    }
    case "wind_up": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "orgs.wind_up", "wind up a company");
      if (missing) return missing;
      return [{ type: "orgs.wind_up", args: { org: op.org, ...(op.stage !== undefined ? { stage: op.stage } : {}), ...(op.property !== undefined ? { property: op.property } : {}), ...(op.to !== undefined ? { to: op.to } : {}), ...(op.why !== undefined ? { why: plainWords(op.why) } : {}) } }];
    }
    case "merge": {
      const missing = orgProblem(ctx, op.org) ?? orgProblem(ctx, op.into) ?? needs(ctx, "orgs.merge", "merge companies");
      if (missing) return missing;
      return [{ type: "orgs.merge", args: { org: op.org, into: op.into, ...(op.ratio !== undefined ? { ratio: op.ratio } : {}), ...(op.cash !== undefined ? { cash: Math.round(op.cash) } : {}), ...(op.from !== undefined ? { from: op.from } : {}), ...(op.keep === true ? { keep: true } : {}), ...(op.why !== undefined ? { why: plainWords(op.why) } : {}) } }];
    }
    case "rename": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: "orgs.rename", args: { org: op.org, name: plainWords(op.name) } }];
    }
    case "tax_status": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.tax_status", "change a tax-exempt status");
      if (missing) return missing;
      const row = op.status === null ? undefined : ctx.tables.get("economy.exempt")?.rows[op.status];
      const words = op.status === null ? "No longer exempt from income tax" : `Exempt from income tax as ${strOf(row?.name, op.status)}`;
      return [{ type: "economy.tax_status", args: { org: op.org, status: op.status ?? "" } }, historyLine(op.org, words)];
    }
    case "consolidate": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.consolidate", "file a consolidated return");
      if (missing) return missing;
      return [{ type: "economy.consolidate", args: { org: op.org, elect: op.elect } }, historyLine(op.org, op.elect ? "Elected to file one consolidated return" : "Stopped filing a consolidated return")];
    }
    // Decisions (ORG-SPEC Phase 5), each the orgs pack's own effect, which writes its History line: a decision put to a vote for someone, the GM's vote, a motion closed or withdrawn, a request answered, the rules.
    case "propose":
      return [{ type: DECISION_EFFECTS.propose, args: { change: op.change as unknown as JsonObject, by: op.by, ...(op.party !== undefined ? { party: op.party } : {}) } }];
    case "vote": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: DECISION_EFFECTS.vote, args: { org: op.org, motion: op.motion, who: op.who, vote: op.vote } }];
    }
    case "end_motion": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: DECISION_EFFECTS.end, args: { org: op.org, motion: op.motion, how: op.how } }];
    }
    case "answer": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      return [{ type: DECISION_EFFECTS.answer, args: { org: op.org, request: op.request, answer: op.answer, ...(op.by !== undefined ? { by: op.by } : {}), ...(op.why !== undefined ? { why: plainWords(op.why) } : {}) } }];
    }
    case "decisions": {
      const bad = orgProblem(ctx, op.org);
      if (bad) return bad;
      const { do: _do, org, ...rules } = op;
      return [{ type: DECISION_EFFECTS.rules, args: { org, ...rules } }];
    }
    case "project": {
      // The projects' own effects write their History lines.
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.project_start", "run production projects");
      if (missing) return missing;
      return [{ type: `economy.project_${op.act}`, args: { org: op.org, ...(op.project !== undefined ? { project: op.project } : {}), ...(op.template !== undefined ? { template: op.template } : {}), ...(op.name !== undefined ? { name: plainWords(op.name) } : {}), ...(op.account !== undefined ? { account: op.account } : {}), ...(op.step !== undefined ? { step: op.step } : {}), ...(op.days !== undefined ? { days: Math.round(op.days) } : {}), ...(op.cents !== undefined ? { cents: Math.round(op.cents) } : {}), ...(op.why !== undefined ? { text: plainWords(op.why) } : {}), ...(op.act === "note" ? { source: "gm" } : {}) } }];
    }
    case "lend": {
      const missing = orgProblem(ctx, op.org) ?? needs(ctx, "economy.lend", "lend money");
      if (missing) return missing;
      return [{ type: "economy.lend", args: { who: op.org, to: op.to, cents: Math.round(op.cents), ...(op.apr !== undefined ? { apr: op.apr } : {}), ...(op.months !== undefined ? { months: op.months } : {}), ...(op.from !== undefined ? { from: op.from } : {}) } }, historyLine(op.org, `Lent ${money(ctx, op.cents)} to ${name(op.to)}`, { names: [op.to] })];
    }
  }
}

