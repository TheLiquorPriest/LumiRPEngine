// One change to an organization (ORG-SPEC §7.2): the op vocabulary the GM edit `{op: "org", change}`,
// the GM assistant's `gm_org` and MCP's `lre_gm_edit` speak, its shape check (`parseOrgOp`), the
// ids each op names by what they must be (`ORG_OP_SLOTS`, which the writer holds to the agent's view
// and `gm_org` resolves names for), and the change type each lands under (§7.3). The orgs pack
// compiles an op to the packs' own effects, in one unit with its History line (`packs/orgs/core/ops.ts`).
// Pure.

import type { EntityId, PlaceId } from "./ids";
import { isRecord } from "./json";
import { DUES_EVERY, isAudience, isOrgPower, POSITION_SCOPES, WIND_PROPERTY, WIND_STAGES, type Audience, type OrgPower, type PositionScope, type WindProperty, type WindStage } from "./org";
import { ANSWERS, isVote, isVoteBasis, type Answer, type Vote, type VoteBasis } from "./org-motions";
import { isPartyTier, type PartyTier } from "./party";

/** A position as an op writes it (§3.3): its title, and any of the rest; one the organization has already keeps what the op leaves out. */
export interface PositionInput {
  id?: string;
  title: string;
  powers?: OrgPower[];
  /** How many may hold it; 0 is any number. */
  seats?: number;
  reports_to?: string;
  scope?: PositionScope;
  /** Each payment and each calendar month at most, in minor units. */
  limits?: { payment?: number; month?: number };
  /** "next", "vacant", or someone's id. */
  successor?: string;
  /** New members join in it. */
  default?: boolean;
}

export type OrgOp =
  /** A company (from Money 3) or a group of one of the world's group kinds, its founder its only owner or its Leader; `capital` in minor units from the founder's account `from`. */
  | { do: "found"; type: "company" | "group"; name: string; kind?: string; structure?: string; founder: EntityId; capital?: number; from?: EntityId; units?: number }
  | { do: "admit"; org: EntityId; who: EntityId; title?: string; position?: string; why: string }
  | { do: "remove"; org: EntityId; who: EntityId; why: string }
  /** Into a position, or out of theirs (`null`): a member's link, or a staff member's job. */
  | { do: "appoint"; org: EntityId; who: EntityId; position: string | null; why: string }
  /** Their own title there; `null` clears it. */
  | { do: "title"; org: EntityId; who: EntityId; title: string | null }
  | { do: "position"; org: EntityId; position: PositionInput }
  | { do: "unposition"; org: EntityId; position: string }
  /** Powers given to `to` by `by` (who granted it), within limits in minor units and accounts, until the end of a day (`YYYY-MM-DD`). */
  | { do: "delegate"; org: EntityId; to: EntityId; powers: OrgPower[]; payment?: number; month?: number; accounts?: EntityId[]; until?: string; by: EntityId }
  | { do: "revoke"; org: EntityId; to: EntityId }
  /** A job: `rate` in minor units per its basis (hour, salary, …); `hours` a week. */
  | { do: "hire"; org: EntityId; who: EntityId; position?: string; title?: string; basis?: string; rate?: number; hours?: number }
  | { do: "fire"; job: EntityId; why: string }
  /** A new rate in minor units, or a percentage more (less, negative). */
  | { do: "pay"; job: EntityId; rate?: number; pct?: number }
  /** New units to `to` at `price` a unit (minor units), paid from `to`'s account `from`. */
  | { do: "issue"; org: EntityId; to: EntityId; units: number; price: number; class?: string; from?: EntityId }
  /** Units bought back from the holder `from` at `price` a unit. */
  | { do: "buy_back"; org: EntityId; from: EntityId; units: number; price: number }
  /** A holder's stake, or part of it (units, or a percentage of the company), to `to`, for `price` in all (none: a gift). */
  | { do: "transfer"; org: EntityId; from: EntityId; to: EntityId; units?: number; pct?: number; price?: number }
  /** A C corporation on the market: `units` new units sold to the public at `price` a unit (else its books a unit; listed already, more units at its market price), under the ticker `symbol` (else its initials). */
  | { do: "list"; org: EntityId; units: number; price?: number; symbol?: string }
  /** A listed company off the market: every public unit bought back at `price` a unit (else its market price). */
  | { do: "delist"; org: EntityId; price?: number }
  /** A listed company's stock bought or sold by `who` on its market, `units` of it, held in `account` when bought (else held directly); units `who` holds on the cap table, and none on the market, sell into its float. */
  | { do: "trade"; org: EntityId; who: EntityId; side: "buy" | "sell"; units: number; account?: EntityId }
  /** Who may enter a place (`null`: as the world has it), and its keys (item ids or types). */
  | { do: "entry"; place: PlaceId; entry: Audience | null; keys?: string[] }
  /** What each member pays, in minor units, every period; `null` ends dues. */
  | { do: "dues"; org: EntityId; cents: number | null; every?: (typeof DUES_EVERY)[number] }
  /** Someone's party tier; `null` takes them out of the party. */
  | { do: "tier"; who: EntityId; tier: PartyTier | null }
  | { do: "restructure"; org: EntityId; structure: string }
  /** A company wound up (§3.13): all at once, or begun (it stops trading), finished (settled, paid out and dissolved) or resumed; its real estate and stakes handed to its owners by share or sold, its things and vehicles to `to` (else its largest holder). */
  | { do: "wind_up"; org: EntityId; stage?: WindStage; property?: WindProperty; to?: EntityId; why?: string }
  /** `org` folded into `into`: its holders get `ratio` of `into`'s units for each of theirs (absent: by value) and `cash` in all (minor units) from `into`'s account `from`; with `keep`, `into` takes all of it as its subsidiary instead. */
  | { do: "merge"; org: EntityId; into: EntityId; ratio?: number; cash?: number; from?: EntityId; keep?: boolean; why?: string }
  | { do: "rename"; org: EntityId; name: string }
  /** A decision (one of the ops above, short of `by`'s votes) put to a vote for `by`, deciding as `party` when that is an organization holder they act for (ORG-SPEC Phase 5). */
  | { do: "propose"; by: EntityId; change: OrgOp; party?: EntityId }
  /** `who`'s vote on an open motion, cast by the GM. */
  | { do: "vote"; org: EntityId; motion: string; who: EntityId; vote: Vote }
  /** An open motion closed now on the votes cast, or withdrawn. */
  | { do: "end_motion"; org: EntityId; motion: string; how: "close" | "withdraw" }
  /** A waiting request for approval answered: by `by` (one who may approve it, or its requester withdrawing it), else by the GM. */
  | { do: "answer"; org: EntityId; request: string; answer: Answer; by?: EntityId; why?: string }
  /** How its decisions are made: votes by shares or members, the quorum and pass mark in percent, the days a motion stays open and a request waits; `null` puts the default back. */
  | { do: "decisions"; org: EntityId; vote_by?: VoteBasis | null; quorum?: number | null; pass?: number | null; days?: number | null; approval_days?: number | null }
  /** Its tax-exempt status, a row of the world's exempt table (`charity`, `church`, `club`); `null` takes it off (ORG-SPEC §3.11, Phase 5). */
  | { do: "tax_status"; org: EntityId; status: string | null }
  /** A C corporation's election to file one consolidated return with the corporations it holds 80 % or more of, or its end. */
  | { do: "consolidate"; org: EntityId; elect: boolean };

export type OrgOpDo = OrgOp["do"];

/** Every op, in the order the spec lists them. */
export const ORG_OP_DOS: readonly OrgOpDo[] = ["found", "admit", "remove", "appoint", "title", "position", "unposition", "delegate", "revoke", "hire", "fire", "pay", "issue", "buy_back", "transfer", "list", "delist", "trade", "entry", "dues", "tier", "restructure", "wind_up", "merge", "rename", "propose", "vote", "end_motion", "answer", "decisions", "tax_status", "consolidate"];

/** The change types an agent's organization op lands under (§7.3). */
export const ORG_CHANGES = ["org_people", "org_powers", "org_shares", "org_rules"] as const;
export type OrgChange = (typeof ORG_CHANGES)[number];

/** Each op's change type (§7.3): people, powers, shares and structure (and the votes on them), and rules; an answer to a request for approval is powers'. */
export const ORG_OP_CHANGE: Readonly<Record<OrgOpDo, OrgChange>> = {
  found: "org_shares",
  admit: "org_people",
  remove: "org_people",
  appoint: "org_people",
  title: "org_people",
  position: "org_powers",
  unposition: "org_powers",
  delegate: "org_powers",
  revoke: "org_powers",
  hire: "org_people",
  fire: "org_people",
  pay: "org_people",
  issue: "org_shares",
  buy_back: "org_shares",
  transfer: "org_shares",
  list: "org_shares",
  delist: "org_shares",
  trade: "org_shares",
  entry: "org_rules",
  dues: "org_rules",
  tier: "org_people",
  restructure: "org_shares",
  wind_up: "org_shares",
  merge: "org_shares",
  rename: "org_rules",
  propose: "org_shares",
  vote: "org_shares",
  end_motion: "org_shares",
  answer: "org_powers",
  decisions: "org_rules",
  tax_status: "org_shares",
  consolidate: "org_shares",
};

/** What an id an op names must be: a person, any entity (an organization, a job, an account), a place, or a list of entities. */
export type OrgSlot = "person" | "entity" | "place" | "entities";

/** The ids each op names, by field and what each must be. */
export const ORG_OP_SLOTS: Readonly<Record<OrgOpDo, Readonly<Record<string, OrgSlot>>>> = {
  found: { founder: "entity", from: "entity" },
  admit: { org: "entity", who: "person" },
  remove: { org: "entity", who: "person" },
  appoint: { org: "entity", who: "person" },
  title: { org: "entity", who: "person" },
  position: { org: "entity" },
  unposition: { org: "entity" },
  delegate: { org: "entity", to: "entity", by: "entity", accounts: "entities" },
  revoke: { org: "entity", to: "entity" },
  hire: { org: "entity", who: "person" },
  fire: { job: "entity" },
  pay: { job: "entity" },
  issue: { org: "entity", to: "entity", from: "entity" },
  buy_back: { org: "entity", from: "entity" },
  transfer: { org: "entity", from: "entity", to: "entity" },
  list: { org: "entity" },
  delist: { org: "entity" },
  trade: { org: "entity", who: "entity", account: "entity" },
  entry: { place: "place" },
  dues: { org: "entity" },
  tier: { who: "person" },
  restructure: { org: "entity" },
  wind_up: { org: "entity", to: "entity" },
  merge: { org: "entity", into: "entity", from: "entity" },
  rename: { org: "entity" },
  propose: { by: "person", party: "entity" },
  vote: { org: "entity", who: "entity" },
  end_motion: { org: "entity" },
  answer: { org: "entity", by: "person" },
  decisions: { org: "entity" },
  tax_status: { org: "entity" },
  consolidate: { org: "entity" },
};

/** The ids an op names, by what each must be: people, entities and places; a proposal's, with its decision's. */
export function orgOpIds(op: OrgOp): { people: EntityId[]; entities: EntityId[]; places: PlaceId[] } {
  const out = { people: [] as string[], entities: [] as string[], places: [] as string[] };
  const fields = op as unknown as Record<string, unknown>;
  for (const [field, slot] of Object.entries(ORG_OP_SLOTS[op.do])) {
    const v = fields[field];
    if (slot === "entities") out.entities.push(...(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));
    else if (typeof v === "string") (slot === "person" ? out.people : slot === "place" ? out.places : out.entities).push(v);
  }
  if (op.do === "propose") {
    const inner = orgOpIds(op.change);
    out.people.push(...inner.people);
    out.entities.push(...inner.entities);
    out.places.push(...inner.places);
  }
  return out;
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const opt = <T>(ok: (v: unknown) => v is T, v: unknown): boolean => v === undefined || ok(v);
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
/** A rule left out, put back to its default (`null`), or set to a number. */
const rule = (v: unknown): v is number | null | undefined => v === undefined || v === null || num(v);

/** A position as an op writes it, checked for shape; null when it has no title or a field of the wrong kind. */
function positionInputOf(v: unknown): PositionInput | null {
  if (!isRecord(v) || !str(v.title) || !opt(str, v.id) || !opt(str, v.reports_to) || !opt(str, v.successor) || !opt(num, v.seats)) return null;
  if (v.powers !== undefined && !(Array.isArray(v.powers) && v.powers.every(isOrgPower))) return null;
  if (v.scope !== undefined && !(POSITION_SCOPES as readonly unknown[]).includes(v.scope)) return null;
  if (v.default !== undefined && typeof v.default !== "boolean") return null;
  const limits = v.limits;
  if (limits !== undefined && !(isRecord(limits) && opt(num, limits.payment) && opt(num, limits.month) && Object.keys(limits).every((k) => k === "payment" || k === "month"))) return null;
  return {
    title: v.title.trim(),
    ...(str(v.id) ? { id: v.id } : {}),
    ...(Array.isArray(v.powers) ? { powers: [...new Set(v.powers.filter(isOrgPower))] } : {}),
    ...(num(v.seats) ? { seats: v.seats } : {}),
    ...(str(v.reports_to) ? { reports_to: v.reports_to } : {}),
    ...(v.scope === "org" || v.scope === "below" ? { scope: v.scope } : {}),
    ...(isRecord(limits) ? { limits: { ...(num(limits.payment) ? { payment: limits.payment } : {}), ...(num(limits.month) ? { month: limits.month } : {}) } } : {}),
    ...(str(v.successor) ? { successor: v.successor } : {}),
    ...(typeof v.default === "boolean" ? { default: v.default } : {}),
  };
}

/** An organization op from outside data, checked for shape as `parseItemOp` checks an item op: null when malformed. What it names is checked when it resolves. */
export function parseOrgOp(o: unknown): OrgOp | null {
  if (!isRecord(o)) return null;
  switch (o.do) {
    case "found":
      if ((o.type !== "company" && o.type !== "group") || !str(o.name) || !str(o.founder) || !opt(str, o.kind) || !opt(str, o.structure) || !opt(num, o.capital) || !opt(str, o.from) || !opt(num, o.units)) return null;
      return { do: "found", type: o.type, name: o.name.trim(), founder: o.founder, ...(str(o.kind) ? { kind: o.kind } : {}), ...(str(o.structure) ? { structure: o.structure } : {}), ...(num(o.capital) ? { capital: o.capital } : {}), ...(str(o.from) ? { from: o.from } : {}), ...(num(o.units) ? { units: o.units } : {}) };
    case "admit":
      if (!str(o.org) || !str(o.who) || !str(o.why) || !opt(str, o.title) || !opt(str, o.position)) return null;
      return { do: "admit", org: o.org, who: o.who, why: o.why.trim(), ...(str(o.title) ? { title: o.title.trim() } : {}), ...(str(o.position) ? { position: o.position } : {}) };
    case "remove":
      return str(o.org) && str(o.who) && str(o.why) ? { do: "remove", org: o.org, who: o.who, why: o.why.trim() } : null;
    case "appoint":
      return str(o.org) && str(o.who) && str(o.why) && (o.position === null || str(o.position)) ? { do: "appoint", org: o.org, who: o.who, position: o.position, why: o.why.trim() } : null;
    case "title":
      return str(o.org) && str(o.who) && (o.title === null || str(o.title)) ? { do: "title", org: o.org, who: o.who, title: o.title === null ? null : o.title.trim() } : null;
    case "position": {
      const position = positionInputOf(o.position);
      return str(o.org) && position ? { do: "position", org: o.org, position } : null;
    }
    case "unposition":
      return str(o.org) && str(o.position) ? { do: "unposition", org: o.org, position: o.position } : null;
    case "delegate":
      if (!str(o.org) || !str(o.to) || !str(o.by) || !Array.isArray(o.powers) || o.powers.length === 0 || !o.powers.every(isOrgPower) || !opt(num, o.payment) || !opt(num, o.month) || !opt(strList, o.accounts) || !opt(str, o.until)) return null;
      return { do: "delegate", org: o.org, to: o.to, by: o.by, powers: [...new Set(o.powers.filter(isOrgPower))], ...(num(o.payment) ? { payment: o.payment } : {}), ...(num(o.month) ? { month: o.month } : {}), ...(strList(o.accounts) ? { accounts: o.accounts } : {}), ...(str(o.until) ? { until: o.until.trim() } : {}) };
    case "revoke":
      return str(o.org) && str(o.to) ? { do: "revoke", org: o.org, to: o.to } : null;
    case "hire":
      if (!str(o.org) || !str(o.who) || !opt(str, o.position) || !opt(str, o.title) || !opt(str, o.basis) || !opt(num, o.rate) || !opt(num, o.hours)) return null;
      return { do: "hire", org: o.org, who: o.who, ...(str(o.position) ? { position: o.position } : {}), ...(str(o.title) ? { title: o.title.trim() } : {}), ...(str(o.basis) ? { basis: o.basis } : {}), ...(num(o.rate) ? { rate: o.rate } : {}), ...(num(o.hours) ? { hours: o.hours } : {}) };
    case "fire":
      return str(o.job) && str(o.why) ? { do: "fire", job: o.job, why: o.why.trim() } : null;
    case "pay":
      if (!str(o.job) || !opt(num, o.rate) || !opt(num, o.pct) || (o.rate === undefined) === (o.pct === undefined)) return null;
      return { do: "pay", job: o.job, ...(num(o.rate) ? { rate: o.rate } : {}), ...(num(o.pct) ? { pct: o.pct } : {}) };
    case "issue":
      if (!str(o.org) || !str(o.to) || !num(o.units) || !num(o.price) || !opt(str, o.class) || !opt(str, o.from)) return null;
      return { do: "issue", org: o.org, to: o.to, units: o.units, price: o.price, ...(str(o.class) ? { class: o.class } : {}), ...(str(o.from) ? { from: o.from } : {}) };
    case "buy_back":
      return str(o.org) && str(o.from) && num(o.units) && num(o.price) ? { do: "buy_back", org: o.org, from: o.from, units: o.units, price: o.price } : null;
    case "transfer":
      if (!str(o.org) || !str(o.from) || !str(o.to) || !opt(num, o.units) || !opt(num, o.pct) || !opt(num, o.price)) return null;
      return { do: "transfer", org: o.org, from: o.from, to: o.to, ...(num(o.units) ? { units: o.units } : {}), ...(num(o.pct) ? { pct: o.pct } : {}), ...(num(o.price) ? { price: o.price } : {}) };
    case "list":
      if (!str(o.org) || !num(o.units) || !opt(num, o.price) || !opt(str, o.symbol)) return null;
      return { do: "list", org: o.org, units: o.units, ...(num(o.price) ? { price: o.price } : {}), ...(str(o.symbol) ? { symbol: o.symbol.trim() } : {}) };
    case "delist":
      return str(o.org) && opt(num, o.price) ? { do: "delist", org: o.org, ...(num(o.price) ? { price: o.price } : {}) } : null;
    case "trade":
      if (!str(o.org) || !str(o.who) || (o.side !== "buy" && o.side !== "sell") || !num(o.units) || !opt(str, o.account)) return null;
      return { do: "trade", org: o.org, who: o.who, side: o.side, units: o.units, ...(str(o.account) ? { account: o.account } : {}) };
    case "entry":
      if (!str(o.place) || !(o.entry === null || isAudience(o.entry)) || !opt(strList, o.keys)) return null;
      return { do: "entry", place: o.place, entry: o.entry, ...(strList(o.keys) ? { keys: o.keys } : {}) };
    case "dues": {
      const every = DUES_EVERY.find((e) => e === o.every);
      if (!str(o.org) || !(o.cents === null || num(o.cents)) || (o.every !== undefined && every === undefined)) return null;
      return { do: "dues", org: o.org, cents: o.cents, ...(every !== undefined ? { every } : {}) };
    }
    case "tier":
      return str(o.who) && (o.tier === null || isPartyTier(o.tier)) ? { do: "tier", who: o.who, tier: o.tier } : null;
    case "restructure":
      return str(o.org) && str(o.structure) ? { do: "restructure", org: o.org, structure: o.structure } : null;
    case "wind_up": {
      const stage = WIND_STAGES.find((s) => s === o.stage);
      const property = WIND_PROPERTY.find((p) => p === o.property);
      if (!str(o.org) || (o.stage !== undefined && stage === undefined) || (o.property !== undefined && property === undefined) || !opt(str, o.to) || !opt(str, o.why)) return null;
      return { do: "wind_up", org: o.org, ...(stage !== undefined ? { stage } : {}), ...(property !== undefined ? { property } : {}), ...(str(o.to) ? { to: o.to } : {}), ...(str(o.why) ? { why: o.why.trim() } : {}) };
    }
    case "merge":
      if (!str(o.org) || !str(o.into) || o.org === o.into || !opt(num, o.ratio) || !opt(num, o.cash) || !opt(str, o.from) || (o.keep !== undefined && typeof o.keep !== "boolean") || !opt(str, o.why)) return null;
      if ((num(o.ratio) && o.ratio < 0) || (num(o.cash) && o.cash < 0)) return null;
      return { do: "merge", org: o.org, into: o.into, ...(num(o.ratio) ? { ratio: o.ratio } : {}), ...(num(o.cash) ? { cash: o.cash } : {}), ...(str(o.from) ? { from: o.from } : {}), ...(o.keep === true ? { keep: true } : {}), ...(str(o.why) ? { why: o.why.trim() } : {}) };
    case "rename":
      return str(o.org) && str(o.name) ? { do: "rename", org: o.org, name: o.name.trim() } : null;
    case "propose": {
      const change = o.change === undefined || (isRecord(o.change) && o.change.do === "propose") ? null : parseOrgOp(o.change);
      return str(o.by) && change && opt(str, o.party) ? { do: "propose", by: o.by, change, ...(str(o.party) ? { party: o.party } : {}) } : null;
    }
    case "vote":
      return str(o.org) && str(o.motion) && str(o.who) && isVote(o.vote) ? { do: "vote", org: o.org, motion: o.motion.trim(), who: o.who, vote: o.vote } : null;
    case "end_motion":
      return str(o.org) && str(o.motion) && (o.how === "close" || o.how === "withdraw") ? { do: "end_motion", org: o.org, motion: o.motion.trim(), how: o.how } : null;
    case "answer": {
      const answer = ANSWERS.find((a) => a === o.answer);
      if (!str(o.org) || !str(o.request) || answer === undefined || !opt(str, o.by) || !opt(str, o.why)) return null;
      return { do: "answer", org: o.org, request: o.request.trim(), answer, ...(str(o.by) ? { by: o.by } : {}), ...(str(o.why) ? { why: o.why.trim() } : {}) };
    }
    case "decisions":
      if (!str(o.org) || !(o.vote_by === undefined || o.vote_by === null || isVoteBasis(o.vote_by)) || !rule(o.quorum) || !rule(o.pass) || !rule(o.days) || !rule(o.approval_days)) return null;
      return { do: "decisions", org: o.org, ...(o.vote_by !== undefined ? { vote_by: o.vote_by } : {}), ...(o.quorum !== undefined ? { quorum: o.quorum } : {}), ...(o.pass !== undefined ? { pass: o.pass } : {}), ...(o.days !== undefined ? { days: o.days } : {}), ...(o.approval_days !== undefined ? { approval_days: o.approval_days } : {}) };
    case "tax_status":
      return str(o.org) && (o.status === null || str(o.status)) ? { do: "tax_status", org: o.org, status: o.status === null ? null : o.status.trim() } : null;
    case "consolidate":
      return str(o.org) && typeof o.elect === "boolean" ? { do: "consolidate", org: o.org, elect: o.elect } : null;
    default:
      return null;
  }
}
