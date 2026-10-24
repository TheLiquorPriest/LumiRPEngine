// A character as its own model (DESIGN §7, the Character model): a person entity read for Build's
// Character page and GM's Character sheet, over the existing entity storage. `engine/character.ts`
// builds it, pure, from a draft world (Build) or a chat's head world and state (GM); both are author
// or GM views, so it carries every place and person with its visibility rather than hiding them.

import type { JsonValue } from "./json";
import type { EntityId, KindId, PlaceId, PlaceVisibility, TierId } from "./ids";
import type { FieldType } from "./world";

/** How public a place or an entity is: a place's visibility, which an entity's is a subset of. */
export type VisibilityValue = PlaceVisibility;

/**
 * A place as a picker shows it: its name and the names of the places around it, outermost first,
 * and its parent's id (names repeat, so browsing goes by ids).
 */
export interface PlaceRef {
  id: PlaceId;
  name: string;
  path: string[];
  parent: PlaceId | null;
  visibility: VisibilityValue;
}

/** A thing as a picker shows it: its name, its kind and where it lies. */
export interface ThingRef {
  id: EntityId;
  name: string;
  kind: KindId;
  place: PlaceRef | null;
}

/** Where they sleep: at home (no bed of their own), at a place, or in a thing (a bed, a sofa). */
export interface CharacterBed {
  kind: "home" | "place" | "item";
  place: PlaceRef | null;
  item: ThingRef | null;
}

/**
 * One field as a form shows it: a plain label, its value, `help` only when it tells something (a
 * hint the label carried, a table that isn't just the label again) and a number's range as `hint`.
 */
export interface CharacterField {
  id: string;
  label: string;
  type: FieldType;
  value: JsonValue | null;
  values?: string[];
  min?: number;
  max?: number;
  ref?: string;
  /** A list's item type (text when the kind doesn't say): a list of text is edited as its items, never as JSON. */
  of?: FieldType;
  locked?: boolean;
  help?: string;
  /** A number's range in words ("3–18", "0 or more"). */
  hint?: string;
}

/** Who they work for: a place (a shop they run in the world) or a business entity. */
export type CharacterEmployer = { kind: "place"; place: PlaceRef } | { kind: "business"; thing: ThingRef };

/** One of their schedules in words: its own label, else its summary; never its id. */
export interface CharacterSchedule {
  id: string;
  label: string;
  /** When and what, from its days and slots ("Weekdays 8:00 AM–5:30 PM: Alder Automotive"). */
  summary: string;
}

/** One of their relations as words: the relation's label and group, who it's to, and what it holds ("warm"; "Role: Owner"). */
export interface CharacterRelation {
  type: string;
  typeLabel: string;
  group: "family" | "feelings" | "groups" | "other";
  to: { id: EntityId; name: string };
  words: string;
}

/** The character's fields, by what they're about. */
export interface CharacterSection {
  id: "identity" | "where" | "day" | "work" | "stats" | "advanced";
  fields: CharacterField[];
}

/** What the GM sees of a character now: what they're doing until when, the party, and what the story holds. */
export interface CharacterNow {
  activity: string;
  activityLabel: string;
  until: string | null;
  party: boolean;
  holds: { label: string; until: string | null }[];
}

export interface CharacterDTO {
  id: EntityId;
  name: string;
  kind: { id: KindId; label: string };
  tier: { id: TierId; label: string };
  pov: boolean;
  agent: boolean;
  life: { state: string; label: string } | null;
  visibility: VisibilityValue;
  /** Where they are (GM: now; Build: where the world starts them), and what holds them (a car, a room's bed…). */
  place: PlaceRef | null;
  inside: ThingRef | null;
  home: PlaceRef | null;
  bed: CharacterBed;
  /** Where the bed picker looks first: places inside their home, and things lying there, the likeliest beds first. */
  bedChoices: { places: PlaceRef[]; items: ThingRef[] };
  employer: CharacterEmployer | null;
  schedules: CharacterSchedule[];
  relations: CharacterRelation[];
  /** GM only. */
  now?: CharacterNow;
  sections: CharacterSection[];
}

/**
 * The answer to `lre.character get`: the character, every place for the place picker, and every
 * thing that isn't a person (an item, a vehicle), with where it lies, for "A thing somewhere else…".
 */
export interface CharacterResult {
  character: CharacterDTO;
  places: PlaceRef[];
  things: ThingRef[];
}
