// Things as Build's pages read them (ITEMS-SPEC §10.1): every thing with its size, where it is and
// whose it is, by place and by owner; one thing's page (where it is and where it is kept, whose it
// is, who may use it, what it holds); a person's things in groups; the catalog's types; and the
// choices the where and whose pickers offer. `engine/thing-view.ts` builds them, pure, from a world
// and the state a chat starts from, which is how Build reads its draft. An author's view: every
// thing shows, a secret one marked. Also the words the pages share for sizes, where a size comes
// from and whose a thing is.

import type { EntityId, KindId } from "./ids";
import type { OrgType } from "./org";
import type { AccessBasis, GrantBasis, Size, SizeClass, SizeFrom, Spot } from "./things";
import { SIZE_LABELS } from "./things";
import { listWords, possessive } from "./words";

// ---------------------------------------------------------------- parts

/** One place or holder on the way to a thing, outermost first. */
export interface WhereStep {
  id: string;
  name: string;
  /** A place, a person, or a thing that holds things. */
  is: "place" | "person" | "thing";
}

/** What a party is: a person, an organization of its type, or a place an older world names as an owner. */
export type PartyIs = "person" | OrgType | "place" | "other";

/** A person or an organization, as a page names it and a picker offers it. */
export interface PartyRef {
  id: string;
  name: string;
  is: PartyIs;
}

/** How an unowned thing's owner is presumed (ITEMS-SPEC §4.2); `nobody`: no one is, so it is anyone's to use. */
export type Presumption = "on" | "holder" | "business" | "household" | "property" | "residents" | "nobody";

/** Whose a thing is: its stated owners, or those presumed, how, and at which place a place presumes them. */
export interface WhoseView {
  owners: PartyRef[];
  /** Null when its owners are stated. */
  presumed: Presumption | null;
  /** The place that presumes them (a business's, a household's, a property's, the residents'), by name. */
  at: string | null;
}

/** One thing as a list shows it. */
export interface ThingRow {
  id: EntityId;
  name: string;
  kind: KindId;
  /** Its type's name, when its catalog names a row. */
  type: string | null;
  size: SizeClass;
  /** Where it is, outermost first, ending at the place it lies at or what holds it; empty for nowhere. */
  where: WhereStep[];
  whose: WhoseView;
  /** Who has it: the nearest person up what holds it. */
  with: EntityId | null;
  /** The slot it is worn in, when it is worn. */
  worn: string | null;
  /** The slot it takes, when it is worn at all: its own `slot`, else its type row's `equip_slot`. */
  slot: string | null;
  /** Where Put away takes it (its rest, ITEMS-SPEC §4.3): a place, or a holder (its owner, when it rests on them); null when nothing says. */
  rest: Spot | null;
  /** The largest size it takes, for what holds things. */
  holds: Size | null;
  /** How many things are directly in it. */
  inside: number;
  /** Hidden until searched (`discoverable`). */
  hidden: boolean;
  /** Secret, or known only to some. */
  secret: boolean;
}

/** An owner's things in Things' By owner: with them, at their home (an organization's: at its places), and elsewhere. Null `owner`: nobody's. */
export interface OwnerGroup {
  owner: PartyRef | null;
  on: EntityId[];
  home: EntityId[];
  away: EntityId[];
}

/** A choice of the where picker: a place by its path, a person, or a thing that holds things, with whose it is and where. */
export interface WhereChoice {
  id: string;
  is: "place" | "person" | "thing";
  name: string;
  /** Where it is, outermost first: a place's places around it; a holder's place and holders. */
  path: WhereStep[];
  /** What it is in, for browsing: a place's parent, a holder's place or holder; null at the top. */
  parent: string | null;
  /** The largest size it takes (a person: the ceiling); null for a place, where anything lies. */
  holds: Size | null;
  /** Only vehicles take a vehicle. */
  vehicle: boolean;
  /** Whose a holder is; null for a place. */
  whose: WhoseView | null;
  /** Whose a thing nobody owns is presumed, put here. */
  presumes: WhoseView;
  secret: boolean;
}

/** What the pickers offer: every place and holder, every party, and the largest size a person carries. */
export interface ThingPicks {
  where: WhereChoice[];
  /** People and organizations (the party included), people first, each by name. */
  parties: PartyRef[];
  ceiling: Size;
}

/** Things: every thing, by owner too, and the pickers' choices. */
export interface ThingsList {
  rows: ThingRow[];
  owners: OwnerGroup[];
  pick: ThingPicks;
}

/** Who may use a thing on one ground, as its page shows it: "The Kowalczyks · members", with whom it covers. */
export interface AccessChip {
  basis: AccessBasis;
  label: string;
  who: string[];
}

/** A use grant to the thing (a `uses` relation from `who`): its basis, and when it ends in words. */
export interface GrantView {
  who: PartyRef;
  basis: GrantBasis;
  until: string | null;
}

/** One thing's page. */
export interface ThingPage {
  row: ThingRow;
  kindLabel: string;
  sizeFrom: SizeFrom;
  /** Where it is kept: on its owner (`owner`), at a place or in a holder (`where`), or where it is (neither); `set` when its own `home` says so. */
  kept: { set: boolean; owner: boolean; where: WhereStep[] };
  /** Who may use it beyond a grant, ground by ground, as a chat starts. */
  use: AccessChip[];
  grants: GrantView[];
  contents: ThingRow[];
}

/** A person's clothing at home in one holder (a wardrobe, a dresser), or lying loose there (`holder` null). */
export interface WardrobeRows {
  holder: WhereStep | null;
  rows: ThingRow[];
}

/** A person's things, in Build's Character page groups. */
export interface PersonThings {
  /** Theirs (or nobody else's) that they have. */
  on: ThingRow[];
  /** Theirs at their home. */
  home: ThingRow[];
  /** Theirs anywhere else, nobody having it. */
  away: ThingRow[];
  /** Theirs that someone else has. */
  lent: ThingRow[];
  /** Someone else's that they have. */
  holding: ThingRow[];
  /** What they wear or hold in hand, by slot (Gear 3); empty below Gear 3. Derived, never stored. */
  outfit: ThingRow[];
  /** What they have on them and don't wear, directly; below Gear 3, everything directly on them. */
  carried: ThingRow[];
  /** Their clothing at home that nobody has, by what holds it (Gear 3); empty below Gear 3. */
  wardrobe: WardrobeRows[];
}

/** A catalog type as Add a thing offers it: its row, its name and category, and the size it gives. */
export interface ThingType {
  id: string;
  table: "gear.items" | "gear.containers" | "economy.catalog";
  name: string;
  category: string | null;
  size: SizeClass;
}

// ---------------------------------------------------------------- words

/** Each size in words (ITEMS-SPEC §3.2): what it means, and things of that size. */
export const SIZE_WORDS: Readonly<Record<Size, { means: string; examples: string }>> = {
  pocket: { means: "Fits a pocket or a wallet", examples: "keys, a phone, a ring, a letter" },
  hand: { means: "One hand, or a bag", examples: "a book, a wrench, a bottle" },
  armful: { means: "Both hands, or a big bag", examples: "a toolbox, grocery bags, a guitar" },
  heavy: { means: "One or two people, a short way; never carried around", examples: "a TV, an armchair, a crate, a mini-fridge" },
  furniture: { means: "Moved only by a delivery or a move", examples: "a fridge, a sofa, a bed, a wardrobe" },
  builtin: { means: "Part of the building or of what holds it; never moved", examples: "a sink, a mantel, a safe in the wall, an installed relay" },
};

/** A size as a chip says it. */
export function sizeLabel(size: SizeClass): string {
  return size === "part" ? "Built into its holder" : size === "vehicle" ? "Vehicle" : size === "unknown" ? "Size unknown" : SIZE_LABELS[size];
}

/** Where a size comes from (ITEMS-SPEC §4.1), as "Hand, from its type" says it. */
export const SIZE_FROM_WORDS: Readonly<Record<SizeFrom, string>> = {
  size: "set on it",
  fixed: "fixed in place",
  part: "built into what holds it",
  vehicle: "a vehicle",
  row: "from its type",
  location: "from where its type stands",
  volume: "from its volume",
  name: "from its name",
  category: "from its category",
  unknown: "nothing says",
};

/** A party's possessive: "Jordan Ellis's", "The Kowalczyks'" (a household named for a family is a plural). */
export function partyPossessive(party: Pick<PartyRef, "name" | "is">): string {
  return party.is === "household" && /s$/i.test(party.name) ? `${party.name}'` : possessive(party.name);
}

/** Whose a thing is, as a row says it: "Jordan Ellis's", "The Kowalczyks' (presumed)", "Nobody's". */
export function whoseWords(whose: WhoseView): string {
  if (whose.owners.length === 0) return "Nobody's";
  const owners = whose.owners.length === 1 && whose.owners[0] ? partyPossessive(whose.owners[0]) : `${listWords(whose.owners.map((o) => o.name))}'s`;
  return whose.presumed === null ? owners : `${owners} (presumed)`;
}

/**
 * What an owner nobody states amounts to, in a sentence (ITEMS-SPEC §4.2): "Presumed the
 * Kowalczyks' at 114 Harbor Street." Null for stated owners.
 */
export function presumedLine(whose: WhoseView): string | null {
  if (whose.presumed === null) return null;
  const at = whose.at !== null ? ` at ${whose.at}` : "";
  const who = whose.owners.length === 1 && whose.owners[0] ? partyPossessive(whose.owners[0]) : `${listWords(whose.owners.map((o) => o.name))}'s`;
  switch (whose.presumed) {
    case "nobody":
      return "Nobody's: anyone may use it.";
    case "on":
      return `Presumed ${who}, as they have it.`;
    case "holder":
      return `Presumed ${who}, as what holds it is.`;
    case "business":
      return `Presumed ${who}, the business trading${at}.`;
    case "household":
      return `Presumed the household's${at}: ${who}.`;
    case "property":
      return `Presumed ${who}, who own the property${at}.`;
    case "residents":
      return `Presumed ${who}, who live${at}.`;
  }
}

/** A use grant's basis in words: "holding it for its owner", "borrowing it", "may use it". */
export const GRANT_WORDS: Readonly<Record<GrantBasis, string>> = { hold: "holding it for its owner", loan: "borrowing it", assign: "may use it" };
