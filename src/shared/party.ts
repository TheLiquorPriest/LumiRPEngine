// The player character's party (DESIGN §9.3; ORG-SPEC §3.12; assess-party §6.1): people who travel
// with it, each in a tier. Its core and its companions come along on every move it makes (the one
// move path, `engine/relocate.ts`); hired hands and allies come only when taken along. Pure.

/** The relation from a party member to the player character. */
export const PARTY_RELATION = "travels_with";

/** The kind of the party's own entity (`party_<leader>`), made only when the party needs a name, a purse or a thing of its own. */
export const PARTY_KIND = "party";

/** How someone is in the party (assess-party §6.1): its core, a companion, a hand it hired, or an ally. */
export const PARTY_TIERS = ["core", "companion", "hired", "ally"] as const;
export type PartyTier = (typeof PARTY_TIERS)[number];

export function isPartyTier(v: unknown): v is PartyTier {
  return typeof v === "string" && (PARTY_TIERS as readonly string[]).includes(v);
}

/** A party link's tier: its own, else core (a link written before tiers). */
export function partyTierOf(fields: Readonly<Record<string, unknown>> | undefined): PartyTier {
  const tier = fields?.tier;
  return isPartyTier(tier) ? tier : "core";
}

/** Out of the party: the tier `party_tier` takes someone out with. */
export const PARTY_OUT = "out";

/** The tiers that come along on the player character's moves by themselves (assess-party §6.1): hired hands and allies come only when asked along. */
export const PARTY_FOLLOWS: readonly PartyTier[] = ["core", "companion"];

/** Each tier as a select or a badge names it. */
export const TIER_LABELS: Readonly<Record<PartyTier, string>> = { core: "Core", companion: "Companion", hired: "Hired", ally: "Ally" };

/** Each tier as a count names one or more of it ("1 companion"), and as a line names one ("as a companion"). */
export const TIER_NOUNS: Readonly<Record<PartyTier, [string, string]>> = { core: ["core member", "core members"], companion: ["companion", "companions"], hired: ["hired hand", "hired hands"], ally: ["ally", "allies"] };

/** How the People section marks someone in the party ("Danny Okafor (party companion) is here."). */
export const TIER_MARKS: Readonly<Record<PartyTier, string>> = { core: "core party", companion: "party companion", hired: "hired hand", ally: "party ally" };

/** What each tier means (assess-party §6.1), as the party's Rules tell it. */
export const TIER_MEANINGS: Readonly<Record<PartyTier, string>> = {
  core: "Comes along wherever you go. Sees the party's money and uses its things.",
  companion: "Comes along wherever you go, unless their own shift, appointment or plan is due. Uses the party's things.",
  hired: "Works for the party for pay. Comes along only when you take them.",
  ally: "On your side, but goes their own way: comes along only when you take them.",
};

/** The tier a party link to `leader` among `relations` gives, or null with none. */
export function partyTierIn(relations: readonly { type: string; to: string; fields?: Readonly<Record<string, unknown>> }[] | undefined, leader: string): PartyTier | null {
  const link = relations?.find((r) => r.type === PARTY_RELATION && r.to === leader);
  return link ? partyTierOf(link.fields) : null;
}

/** The party's own section of its page (ORG-SPEC §4.5; `OrgView.sections.party`). */
export const PARTY_SECTION = "party";

/** Someone in the party as its section reads them: their tier, and where they are as the reader knows it. */
export interface PartyMemberSection {
  id: string;
  tier: PartyTier;
  /** Where they are when not with the reader: their place's name, "last seen at …", or null when the reader doesn't know. */
  where: string | null;
}

/** What the leader does on the party's page (§4.5), each null when they may, else why not, in words. */
export interface PartyCan {
  /** Add someone they know, change a tier, take someone out. */
  manage: string | null;
  name: string | null;
  purse: string | null;
  hire: string | null;
  shareOut: string | null;
}

/** The party's section (`party`): its roster with where each is, whom the leader may add, its purse, whom a share-out pays, and the hired hands whose job with the party has ended. */
export interface PartySectionView {
  /** Its entity's id, or the id it will take (`party_<leader>`). */
  id: string;
  exists: boolean;
  leader: { id: string; name: string };
  members: PartyMemberSection[];
  /** People the reader may know who aren't in it, by name: whom Add someone you know offers. */
  candidates: { id: string; name: string }[];
  /** A hired hand whose every job with the party has ended, offered a way out of it (§3.12). */
  offers: { id: string; name: string; job: string }[];
  /** Its purse, for a reader who may see its money: the account and its balance in words. */
  purse: { account: string; name: string; balance: string } | null;
  /** Before it has a purse, the leader's accounts one may start from, the first the default. */
  sources: { id: string; name: string; balance: string }[];
  /** Whom a share-out pays (§3.8): its core and its companions, never the leader, hired hands or allies. */
  shareOut: { id: string; name: string }[];
  can: PartyCan;
}
