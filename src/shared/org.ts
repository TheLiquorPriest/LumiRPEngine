// Organizations as the rest of the engine reads them (ORG-SPEC §3): what an organization is
// (`OrgType`), the 21 powers in seven families and the bases a grant of one rests on, positions and
// delegations as an organization's fields and links hold them, a membership row, and the audience
// ladder a thing's `access` and a place's `entry` share. The hooks that answer them are
// `engine/org.ts`. Pure.

import type { OwnerRole } from "./finance";
import type { EntityId } from "./ids";
import { isRecord, type JsonValue } from "./json";
import { PARTY_TIERS } from "./party";
import { formatMoney, type FieldDef, type WorldCurrency } from "./world";

/** What an organization is: a household, a group of any other kind, a company (a business), a trust, or the player character's party. */
export const ORG_TYPES = ["household", "group", "company", "trust", "party"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** The 21 powers, in their seven families (§3.4). */
export const ORG_POWER_FAMILIES = {
  members: ["members.admit", "members.remove", "members.appoint"],
  staff: ["staff.hire", "staff.fire", "staff.pay"],
  money: ["money.view", "money.spend", "money.manage", "money.invoice", "money.payout", "money.borrow"],
  assets: ["assets.use", "assets.assign", "assets.dispose"],
  property: ["property.manage", "property.trade"],
  shares: ["shares.manage"],
  governance: ["org.govern", "orders.give", "delegate"],
} as const;
export type OrgPowerFamily = keyof typeof ORG_POWER_FAMILIES;
export type OrgPower = (typeof ORG_POWER_FAMILIES)[OrgPowerFamily][number];

/** Every power, family by family. */
export const ORG_POWERS: readonly OrgPower[] = Object.values(ORG_POWER_FAMILIES).flat();

/** Each family as Build and the Rules tab head it. */
export const POWER_FAMILY_LABELS: Readonly<Record<OrgPowerFamily, string>> = { members: "Members", staff: "Staff", money: "Money", assets: "Things", property: "Property", shares: "Ownership", governance: "Governance" };

/** What each power lets its holder do, as "you may …" finishes it. */
export const POWER_WORDS: Readonly<Record<OrgPower, string>> = {
  "members.admit": "admit members",
  "members.remove": "remove members",
  "members.appoint": "appoint people to positions and give titles",
  "staff.hire": "hire staff",
  "staff.fire": "let staff go",
  "staff.pay": "set staff pay, hours, schedules and leave",
  "money.view": "see its money",
  "money.spend": "spend its money",
  "money.manage": "manage its accounts, standing payments, autopay and cards",
  "money.invoice": "send and void its invoices",
  "money.payout": "pay out its profit",
  "money.borrow": "borrow in its name",
  "assets.use": "use its things",
  "assets.assign": "lend and assign its things",
  "assets.dispose": "sell, give away or use up its things",
  "property.manage": "manage its property: leases, rent, entry and keys",
  "property.trade": "buy and sell its property",
  "shares.manage": "issue, buy back and register its shares",
  "org.govern": "set its positions, rules and structure",
  "orders.give": "give orders",
  delegate: "delegate its powers",
};

export function isOrgPower(v: unknown): v is OrgPower {
  return typeof v === "string" && (ORG_POWERS as readonly string[]).includes(v);
}

/** Powers a held one implies (§3.4): each money power lets its holder see the money it reaches, and assigning or disposing of things lets them use them. */
export function impliedBy(power: OrgPower): readonly OrgPower[] {
  if (power === "money.view") return ORG_POWER_FAMILIES.money.filter((p) => p !== "money.view");
  if (power === "assets.use") return ["assets.assign", "assets.dispose"];
  return [];
}

/** Whether holding `held` gives `power`: the same power, or one that implies it. */
export function powerCovers(held: OrgPower, power: OrgPower): boolean {
  return held === power || impliedBy(power).includes(held);
}

/** What a power rests on: an owner role, a position held, a delegation (`acts_for`), or the type's default for a member. */
export const ORG_BASES = ["owner", "position", "delegate", "member"] as const;
export type OrgBasis = (typeof ORG_BASES)[number];

/** A power held: its basis, and the position that gives it, or the granter of the delegation that does. */
export interface OrgGrant {
  basis: OrgBasis;
  id?: EntityId;
}

/** Whom a position's staff and member powers reach: the whole organization, or only the positions below it. */
export const POSITION_SCOPES = ["org", "below"] as const;
export type PositionScope = (typeof POSITION_SCOPES)[number];

/** Spending limits on a position or a delegation, in minor units: each payment, each calendar month, and only these accounts. */
export interface OrgLimits {
  payment?: number;
  month?: number;
  accounts?: EntityId[];
}

/** A position an organization defines (§3.3), as its `positions` field holds it. */
export interface Position {
  id: string;
  title: string;
  powers: OrgPower[];
  /** How many may hold it; 0 is any number. */
  seats: number;
  reports_to?: string;
  scope: PositionScope;
  limits?: OrgLimits;
  /** Who fills it when it falls vacant: the next-ranked holder, a named person, or nobody. */
  successor: "next" | "vacant" | EntityId;
  /** New members join in it. */
  default?: true;
  no_dues?: true;
}

/** A position's id from its title ("Head Mechanic" → `head_mechanic`). */
export function positionIdOf(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cents(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

/** Limits as a position or a delegation writes them; undefined when none is set. */
export function limitsIn(v: unknown): OrgLimits | undefined {
  if (!isRecord(v)) return undefined;
  const payment = cents(v.payment);
  const month = cents(v.month);
  const accounts = Array.isArray(v.accounts) ? v.accounts.filter((x): x is string => typeof x === "string" && x !== "") : undefined;
  const out: OrgLimits = { ...(payment !== undefined ? { payment } : {}), ...(month !== undefined ? { month } : {}), ...(accounts !== undefined ? { accounts } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Why a payment of `cents` for an organization (`org`, its name) is over a limit (§3.4), in the
 * words its refusal gives (`mayAct`, and Pay as… before it is sent): each payment, then the month,
 * with what was `spent` for it this month (null: not known, so the month isn't checked); null within them.
 */
export function overLimit(limits: OrgLimits, cents: number, spent: number | null, org: string, currency: WorldCurrency): string | null {
  if (limits.payment !== undefined && cents > limits.payment) return `Over your limit of ${formatMoney(limits.payment, currency)} a payment for ${org}`;
  if (limits.month !== undefined && spent !== null && spent + cents > limits.month) return `Over your limit of ${formatMoney(limits.month, currency)} a month for ${org}`;
  return null;
}

/** The powers a list names, in the order given, each once; unknown ones are left out (lint names them). */
export function powersIn(v: unknown): OrgPower[] {
  return Array.isArray(v) ? [...new Set(v.filter(isOrgPower))] : [];
}

/** One position as written; null when it has neither an id nor a title. */
export function positionIn(v: unknown): Position | null {
  if (!isRecord(v)) return null;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  const id = typeof v.id === "string" && v.id !== "" ? v.id : positionIdOf(title);
  if (id === "") return null;
  const seats = typeof v.seats === "number" && Number.isInteger(v.seats) && v.seats >= 0 ? v.seats : 1;
  const limits = limitsIn(v.limits);
  const successor = typeof v.successor === "string" && v.successor !== "" ? v.successor : "vacant";
  return {
    id,
    title: title || id.replace(/_/g, " "),
    powers: powersIn(v.powers),
    seats,
    ...(typeof v.reports_to === "string" && v.reports_to !== "" ? { reports_to: v.reports_to } : {}),
    scope: v.scope === "below" ? "below" : "org",
    ...(limits ? { limits } : {}),
    successor,
    ...(v.default === true ? { default: true as const } : {}),
    ...(v.no_dues === true ? { no_dues: true as const } : {}),
  };
}

/** An organization's `positions` field, each position once by id (the first wins). */
export function positionsIn(v: JsonValue | undefined): Position[] {
  if (!Array.isArray(v)) return [];
  const out: Position[] = [];
  for (const raw of v) {
    const p = positionIn(raw);
    if (p && !out.some((q) => q.id === p.id)) out.push(p);
  }
  return out;
}

/** The relation that lets someone act for an organization (§3.5), from the delegate to it. */
export const ACTS_FOR = "acts_for";

/** A delegation as its `acts_for` link holds it. */
export interface Delegation {
  /** Who acts for the organization. */
  who: EntityId;
  org: EntityId;
  powers: OrgPower[];
  limits?: OrgLimits;
  /** Who granted it. */
  by?: EntityId;
  /** When it ends (the link's `until`); absent, it stands until revoked. */
  until?: number;
}

/**
 * A line of an organization's History (`orgs.log`): when, what was done in words, who did it, the
 * people its words name, as they were named then, and the power it was done with, when one was: a
 * money power's line reads only to whoever may see its money.
 */
export interface OrgLogLine {
  at: number;
  text: string;
  by?: EntityId;
  names?: { id: EntityId; name: string }[];
  power?: OrgPower;
}

/**
 * An act done for an organization (§3.6), as an action reports it to the orgs pack (`orgs.acted`):
 * who did it, with which power, what it paid out of the organization's money (counted toward the
 * month's limit), its History line and the people that line names.
 */
export interface OrgAct {
  org: EntityId;
  by: EntityId;
  power: OrgPower;
  cents?: number;
  text: string;
  names?: EntityId[];
}

/** How someone belongs to an organization (§3.2): a member by `member_of`, an owner, staff by a job, the party's leader, or a party tier. */
export const MEMBER_HOWS = ["member", "owner", "staff", "leader", ...PARTY_TIERS] as const;
export type MemberHow = (typeof MEMBER_HOWS)[number];

/**
 * One way someone belongs to an organization. `title` is the link's own words (a member's title, a
 * job's); `position` the position it holds there; `via` the member group it counts through, for a
 * member of a member group. Someone may belong in several ways at once (an owner who works there).
 */
export interface OrgMember {
  who: EntityId;
  how: MemberHow;
  title?: string;
  position?: string;
  rank?: number;
  since?: string;
  /** Staff: the job. */
  job?: EntityId;
  /** Owners: their role, and their share of its worth in percent. */
  role?: OwnerRole;
  share?: number;
  via?: EntityId;
}

/** Dues as an organization sets them: so much from each member, every period, on a day of it. */
export const DUES_EVERY = ["week", "month", "year"] as const;

/**
 * A company winding up, dissolved, or folded into another (ORG-SPEC §3.13, Phase 5), as its business
 * fields: the day it began winding up and the day it was dissolved (`YYYY-MM-DD`), and the company a
 * merger folded it into.
 */
export const WINDING_FIELD = "winding_up";
export const DISSOLVED_FIELD = "dissolved";
export const MERGED_INTO_FIELD = "merged_into";

/** Winding up (§3.13): all at once; begin (stop trading); finish (settle, pay out and dissolve); resume (trade again). */
export const WIND_STAGES = ["all", "begin", "finish", "resume"] as const;
export type WindStage = (typeof WIND_STAGES)[number];

/** What a company winding up does with the real estate and stakes it holds: hands them to its owners by share, or sells them to the market at their value. */
export const WIND_PROPERTY = ["distribute", "sell"] as const;
export type WindProperty = (typeof WIND_PROPERTY)[number];

/** The fields every organization has (§3.17): on the base `group` kind, and on `trust`, which is no group. */
export const ORG_FIELDS: Readonly<Record<string, FieldDef>> = {
  positions: { type: "list", label: "Positions ({id, title, powers, seats?, reports_to?, scope?, limits?, successor?, default?, no_dues?})" },
  places: { type: "list", label: "Its places", of: "ref" },
  payroll: { type: "list", label: "Pay schedule ({every, anchor, weekday, days})", domain: "money", level: 3 },
  payroll_account: { type: "ref", label: "Payroll account", ref: "account", domain: "money", level: 3 },
  dues: { type: "list", label: "Dues ({cents, every, day?})", domain: "money", level: 3 },
  tax_exempt: { type: "text", label: "Tax-exempt status (a row of the exempt table: charity, church, club)", table: "economy.exempt", domain: "money", level: 3 },
  suta_pct: { type: "number", label: "Its state unemployment tax rate (%), when it isn't its state's new-employer rate", min: 0, max: 100, domain: "money", level: 3 },
  // Its decisions (ORG-SPEC Phase 5, `shared/org-motions.ts`): how votes are counted, the quorum and pass mark of a motion, how long it stays open, the standing votes, and how long a request for approval waits.
  vote_by: { type: "enum", label: "Votes are counted by (shares, or one each for members; a company counts shares unless set)", values: ["shares", "members"] },
  quorum_pct: { type: "number", label: "A motion needs at least % of the votes to take part (50 unless set)", min: 0, max: 100 },
  pass_pct: { type: "number", label: "A motion passes with more than % of the votes cast for or against (50 unless set)", min: 0, max: 99.9 },
  motion_days: { type: "number", label: "A motion stays open for days (7 unless set)", min: 1, max: 365 },
  vote_rules: { type: "list", label: "Standing votes ({who, vote: for, against, abstain or with, with?})" },
  approval_days: { type: "number", label: "A request for approval waits for days (7 unless set)", min: 1, max: 365, domain: "money", level: 2 },
};

/**
 * Who a thing's `access` or a place's `entry` admits, counted from the owner: each step admits
 * those before it (the owner; an organization's members or a person's household; its staff or the
 * people a person employs; customers; anyone).
 */
export const AUDIENCES = ["owner", "members", "staff", "customers", "public"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** Whether `audience` admits those at step `step` of the ladder. */
export function admits(audience: Audience, step: Audience): boolean {
  return AUDIENCES.indexOf(step) <= AUDIENCES.indexOf(audience);
}

/** An organization's own actions (§3.17), as the orgs pack registers them and the Orgs page sends them. Founding sends `{type: "company", name, amount, from?, units?, as?}` or `{type: "group", name, kind}`. */
export const ORG_ACTIONS = {
  admit: "org_admit",
  remove: "org_remove",
  leave: "org_leave",
  appoint: "org_appoint",
  title: "org_title",
  position: "org_position",
  delegate: "org_delegate",
  revoke: "org_revoke",
  rename: "org_rename",
  windUp: "org_wind_up",
  merge: "org_merge",
  found: "org_found",
  restructure: "org_restructure",
} as const;

/** Who may enter, in words, by the entry set (ORG-SPEC §3.9): the Premises' and GM → Places' picker. */
export const ENTRY_WORDS: Readonly<Record<Audience, string>> = { owner: "Owner only", members: "Members only", staff: "Staff only", customers: "Customers", public: "Anyone" };
/** An entry change's entry or keys put back to the place as the world sets them. */
export const AS_THE_WORLD = "default";
/** An entry change's keys: none, over any the world names. */
export const NO_KEYS = "none";
/** The GM effect setting a place's entry and keys in play (`{place, entry?, keys?, org?, by?}`), and the action a holder of `property.manage` changes an organization's place's entry by (`{org, place, entry, keys?}`). */
export const ORGS_ENTRY = "orgs.entry";
export const ORG_ENTRY_ACTION = "org_entry";
