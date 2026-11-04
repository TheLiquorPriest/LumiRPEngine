// Organizations as the player's Orgs tab reads them (ORG-SPEC §4): the `orgs.list` panel (the party,
// where you belong, the organizations you know of) and the `orgs.org` panel (each organization's page:
// your place there, who runs it, its people, positions and delegations, and the packs' sections, each
// behind its power). Names the player can't see never reach these: such members are counted and stand
// in under an opaque id no action takes (§3.16). Pure.

import type { EntityId, PlaceId } from "./ids";
import type { JsonValue } from "./json";
import type { Audience, DUES_EVERY, MemberHow, OrgBasis, OrgLimits, OrgPower, OrgType, PositionScope } from "./org";
import type { OwnerRole } from "./finance";
import type { PartyTier } from "./party";

/** The panels' ids. */
export const ORGS_LIST_PANEL = "orgs.list";
export const ORGS_ORG_PANEL = "orgs.org";

/** Someone the reader can see, named. */
export interface OrgRef {
  id: EntityId;
  name: string;
}

/** A power someone holds, what it rests on (the position, or the delegation's granter), and what it lets them do, in words. */
export interface OrgPowerView {
  power: OrgPower;
  basis: OrgBasis;
  id: string | null;
  words: string;
}

/** A delegation in force (§3.5): who acts for the organization, with what powers and limits, until when, granted by whom. */
export interface OrgDelegationView {
  who: OrgRef;
  powers: OrgPower[];
  limits: OrgLimits | null;
  /** When it ends, as the world's calendar writes it; null while it stands. */
  until: string | null;
  by: OrgRef | null;
}

/** One person on an organization's page, every way they belong in one row. */
export interface OrgPersonView {
  id: EntityId;
  name: string;
  /** The title they go by there (§3.3). */
  title: string;
  hows: MemberHow[];
  position: { id: string; title: string } | null;
  rank: number | null;
  /** Since when (a membership's `since`, a job's start, a party link's): a date in the world's calendar's words ("12 Jan 2026"), other text as written. */
  since: string | null;
  /** With the player character, at the same place. */
  here: boolean;
  /** Staff: their job, and whether it runs or they're on leave. */
  job: EntityId | null;
  status: "active" | "leave" | null;
  /** Owners: their role, and their share of its worth in percent. */
  role: OwnerRole | null;
  share: number | null;
  /** A member of a member group: the group they count through. */
  via: OrgRef | null;
  /** The powers they hold there, each with what it rests on (a delegation's granter the reader can't see under an opaque id). */
  powers: OrgPowerView[];
  you: boolean;
}

/** A position, with its holders the reader can see and a count of those they can't. */
export interface OrgPositionView {
  id: string;
  title: string;
  powers: OrgPower[];
  /** 0 is any number. */
  seats: number;
  filled: number;
  reportsTo: { id: string; title: string } | null;
  scope: PositionScope;
  limits: OrgLimits | null;
  /** "next", "vacant", or a named successor; `successorId` is that person's id (an opaque one for someone the reader can't see). */
  successor: string;
  successorId: string | null;
  /** New members join in it. */
  joinsIn: boolean;
  /** A type's default position (a household's Head, the party's Leader) rather than one the organization defines. */
  implied: boolean;
  holders: EntityId[];
  hidden: number;
}

/** The reader's own place in an organization (§4.4 Your place here). */
export interface OrgYouView {
  belongs: boolean;
  title: string | null;
  position: { id: string; title: string } | null;
  since: string | null;
  /** The holders of the position theirs reports to. */
  reportsTo: OrgRef[];
  powers: OrgPowerView[];
  /** The delegations they hold there. */
  delegations: OrgDelegationView[];
}

/** A line of an organization's History (`orgs.log`, §4.4) as the reader may read it: anyone they can't see named "someone". */
export interface OrgHistoryLineView {
  /** When, in the world's calendar's words. */
  at: string;
  text: string;
  /** Who did it; null when no one did (the GM, a process). */
  by: OrgRef | null;
}

/** An organization's dues (§3.8): so much from each member, every week, month or year, on a day of it (a weekday, 0 Sunday; a day of the month, -1 its last); null `day` is the first. */
export interface OrgDuesView {
  cents: number;
  every: (typeof DUES_EVERY)[number];
  day: number | null;
}

/** One organization's page (`orgs.org`). */
export interface OrgView {
  id: EntityId;
  name: string;
  type: OrgType;
  /** Its kind's label ("Faction", "Business"). */
  kind: string;
  /** A company's structure ("LLC"); null otherwise. */
  structure: string | null;
  /** The header's type badge: "Company · LLC", "Household", "Group · Faction", "Trust", "Party". */
  badge: string;
  /** Its Money level: a business's and a trust's own, any other's its members' highest. */
  level: number;
  /** False for the party before it has an entity of its own. */
  exists: boolean;
  you: OrgYouView;
  /** Who runs it: the holders of its governing power by ownership or position. */
  runBy: OrgRef[];
  /** Everyone the reader can see, in id order. */
  people: OrgPersonView[];
  /** Members the reader can't see: how many, and the opaque ids they stand under. */
  hidden: { count: number; ids: string[] };
  positions: OrgPositionView[];
  delegations: OrgDelegationView[];
  /** The position new members join in. */
  defaultPosition: string | null;
  /** Its dues, for a reader in it or holding a power there; null when it sets none. */
  dues: OrgDuesView | null;
  /** Its History, newest first (the latest 40): a line done with a money power only for a reader who may see its money. */
  history: OrgHistoryLineView[];
  /** Whom the player character may name in its editors (Hire someone, Admit a member, Delegate…): everyone they may know of, by name, while they hold one of those powers there; none for the GM. */
  candidates: OrgRef[];
  /** The packs' sections the reader may see (`r.orgSection`), by id: money, payroll, ownership, taxes. */
  sections: Record<string, JsonValue>;
}

/** A row of the Orgs home: an organization, the reader's title there, and one figure they may see. */
export interface OrgRowView {
  id: EntityId;
  name: string;
  type: OrgType;
  kind: string;
  title: string | null;
  /** A company's profit this month, a household's shared costs and the reader's share, a group's members, a trust's worth; null when the reader may see none. */
  figure: string | null;
}

/** Someone in the party, in their tier. */
export interface PartyMemberView extends OrgRef {
  tier: PartyTier;
  here: boolean;
}

/**
 * What Orgs' Start something… offers (§4.2, §3.13): a company, off with why while the player
 * character may not start one, and the accounts its capital may come from; a group, of one of the
 * world's group kinds, or null when the world has none.
 */
export interface OrgStartView {
  company: { why: string | null; sources: { id: EntityId; name: string; balance: string }[] };
  group: { kinds: { id: string; label: string }[] } | null;
}

/** The Orgs home (`orgs.list`). */
export interface OrgListView {
  /** The party's card: its name, who is in it by tier, and its purse's balance in words when it has one the player character may see. */
  party: { id: EntityId; name: string; exists: boolean; members: PartyMemberView[]; hidden: number; purse: string | null };
  /** The organizations the player character belongs to, secret ones included. */
  belong: OrgRowView[];
  /** Those they can see but don't belong to, with the people they know there. */
  known: (OrgRowView & { whom: OrgRef[] })[];
  /** Start something…: a company or a group. */
  start: OrgStartView;
}

/** A power someone holds in an organization, as GM → Orgs' Who may… answers it: its basis and the chain of bases it rests on, in words, the first step theirs. */
export interface OrgMayPowerView {
  power: OrgPower;
  basis: OrgBasis;
  chain: string[];
}

/** GM → Orgs (ORG-SPEC §6.1): one organization's page as the GM sees it (every member named), and every person holding a power in it, with what each rests on. */
export interface OrgGmView {
  page: OrgView;
  /** Everyone not removed who holds at least one power there, in id order; anyone missing holds none. */
  may: { who: OrgRef; powers: OrgMayPowerView[] }[];
}

/** A trespass a place keeps: who, and when. */
export interface TrespassView {
  who: string;
  at: string;
}

/** One place, as an organization's Premises (§4.4) and GM → Places show who may enter it. */
export interface PremiseView {
  id: PlaceId;
  name: string;
  /** The entry set on it, in play or by the world, or around it (`from`: the place that sets it); null while unset. */
  entry: Audience | null;
  from: string | null;
  /** The entry play set on this place itself, over the world's; null while play leaves it. */
  playEntry: Audience | null;
  /** Play set its entry or keys over the world's, so it can be put back. */
  inPlay: boolean;
  /** Whom it admits, in words ("Customers while it trades; staff only after hours"), and now ("Staff only now"). */
  words: string;
  now: string;
  /** The business trading there's days and hours ("Mon to Sat, 9:00 AM to 5:00 PM"); null where none trades. */
  hours: string | null;
  /** Its keys, in words (a thing's name, a type's), as set; and who carries one now, those the reader can't see counted. */
  keys: string[];
  keysSet: string[];
  carriers: { id: EntityId; name: string }[];
  hiddenCarriers: number;
  /** The latest trespasses here, newest first: for readers who may change its entry. */
  trespass: TrespassView[];
}

/** An organization's Premises (the orgs pack's `premises` section): its places, and whether the reader may change their entry and keys. */
export interface PremisesView {
  places: PremiseView[];
  canChange: boolean;
}

/** Who may enter one place as GM → Places shows it and sets it (the orgs pack's `orgs.place_entry`, by `orgs.entry`): as the Premises show it, with whose it is. */
export interface GmPlaceEntry extends PremiseView {
  /** Its presumed owners' names ("Marcus Delgado"); empty for a place no one holds. */
  owners: string[];
}

/** The parts of an organization's page an agent or an outside client reads on its own (ORG-SPEC §7.1, §7.5). */
export const ORG_PARTS = ["overview", "people", "money", "property", "ownership", "taxes", "rules", "log"] as const;
export type OrgPart = (typeof ORG_PARTS)[number];

/**
 * One part of a page (`orgs_read`, `lre_orgs`): what it is and your place there, its people (with
 * those not shown counted and Payroll), its sections (Money, Premises, Ownership, Taxes; null where
 * the reader may see none), its positions and delegations, or its History. Pure.
 */
export function orgPart(page: OrgView, part: OrgPart): Record<string, unknown> {
  const s = page.sections;
  switch (part) {
    case "overview":
      return { type: page.type, kind: page.kind, badge: page.badge, structure: page.structure, level: page.level, exists: page.exists, you: page.you, runBy: page.runBy, counts: { people: page.people.length, hidden: page.hidden.count, positions: page.positions.length, delegations: page.delegations.length } };
    case "people":
      return { people: page.people, hidden: page.hidden, payroll: s.payroll ?? null };
    case "money":
      return { money: s.money ?? null };
    case "property":
      return { premises: s.premises ?? null };
    case "ownership":
      return { ownership: s.ownership ?? null };
    case "taxes":
      return { taxes: s.taxes ?? null };
    case "rules":
      return { positions: page.positions, delegations: page.delegations, defaultPosition: page.defaultPosition };
    case "log":
      return { history: page.history };
  }
}
