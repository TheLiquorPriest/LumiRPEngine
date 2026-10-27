// The world document `lre-world-v1` (DESIGN §3, §4.1, §9, §10, §11; ARCHITECTURE §3).
//
// One JSON document per world revision. Formulas are strings in the safe expression language
// (`engine/expr`), dice are notation strings (`engine/dice`). Every collection is keyed by id.
// Packs extend kinds, relations, actions, rules, schedules and tables; the shape itself never
// changes with realism level (D18: levels gate processes, rendering and extraction only).
//
// The published JSON Schema, `schemas/lre-world-v1.schema.json`, is written by hand from these
// types and changes with them; its test checks it against the starters and the preview world.

import type { JsonObject, JsonValue } from "./json";
import { hasOwn, isRecord } from "./json";
import type {
  ActionId,
  ActivityType,
  Band,
  BoundMode,
  ChatId,
  CheckId,
  DomainId,
  EntityId,
  EventType,
  FieldId,
  GeneratorId,
  GridId,
  InterruptClass,
  InterruptPolicy,
  KindId,
  Level,
  MapId,
  MessageId,
  PackId,
  PlaceId,
  ProgressionId,
  RealismPresetId,
  RelationTypeId,
  RouteId,
  RuleId,
  ScheduleId,
  SceneTypeId,
  SlotId,
  StageId,
  StepTemplateId,
  TableId,
  TierId,
  TopicId,
  TrackId,
  TravelMode,
  Visibility,
  PlaceVisibility,
  WorldId,
} from "./ids";
import type { ClaimPlace, ClaimsPolicy } from "./claims";
import type { InferredChecks } from "./inferred";
import type { DataTable } from "./tables";
import type { WorldMindsConfig } from "./minds";
import type { RoutineDef, RoutineId, RoutineSettings, WorldRoutineSource } from "./routines";
import type { NeedsSettings } from "./needs";
import type { LedgerEvent } from "./ledger";

export const WORLD_FORMAT = "lre-world-v1";

/** The export file a world travels in (`lre.world export` writes it, Import reads it): `{format, world}`. */
export const EXPORT_FORMAT = "lre-world-export-v1";

/** The engine version stamped on documents it writes (`WorldDoc.engineVersion`). */
export const ENGINE_VERSION = "0.1.0";

/** An expression in the safe formula language. */
export type Expr = string;
/**
 * Expression functions only an effect argument (a `=` formula in an effect's args) may call
 * (DESIGN §11): `roll(notation)` draws from the effect's own seeded generator and its event stores
 * the result. Anywhere else it is a lint error and evaluates to null, so shown odds and reads stay
 * deterministic.
 */
export const EFFECT_ONLY_FUNCTIONS: readonly string[] = ["roll"];
/** Dice notation, e.g. `2d6+1`. */
export type DiceExpr = string;
/** In-world time as minutes since the world calendar's epoch. */
export type GameMinutes = number;

// ---------------------------------------------------------------- schema

export type FieldType = "number" | "text" | "bool" | "enum" | "ref" | "list" | "dice" | "money" | "date" | "duration";

/** Bound on model-proposed changes to a field (DESIGN §11). The most restrictive applicable bound wins. */
export interface FieldBound {
  /** Largest absolute change per turn. Absent: unbounded within the field's min/max. */
  maxDelta?: number;
  mode: BoundMode;
}

/** A band shown as words (sheets, wealth, regard). Bands are ordered and must not overlap. */
export interface BandDef {
  label: string;
  /** Inclusive lower bound; absent means unbounded. */
  min?: number;
  /** Exclusive upper bound; absent means unbounded. */
  max?: number;
}

/** An inclusive range on a number; either end may be open. */
export interface Span {
  min?: number;
  max?: number;
}

/**
 * A pool (DESIGN §11): a number field whose current value lives between `min` and a maximum read
 * from the entity (hit points, mana, stress). It stays a plain field, so undo, Keep and rebase
 * treat it like any other; the `set`, `add` and `recover` effects clamp it to the evaluated max.
 */
export interface PoolDef {
  /** The most it holds: the id of a field of the same entity (often a derived one), or a formula with the entity as `self`. */
  max: Expr | FieldId;
  /** The least it holds; default 0. */
  min?: number;
  /** What a `recover` effect restores when it names no amount (a night's rest): a formula with the entity as `self`. Absent: back to the max. */
  recover?: Expr;
}

export interface FieldDef {
  type: FieldType;
  label?: string;
  default?: JsonValue;
  min?: number;
  max?: number;
  /** A pool field: a current value under an evaluated max. Number fields only; an unset pool with no default is full. */
  pool?: PoolDef;
  /** `enum` values. */
  values?: string[];
  /** `ref` target kind (or any kind when absent). */
  ref?: KindId;
  /** `list` element type. */
  of?: Exclude<FieldType, "list">;
  bands?: BandDef[];
  /** A derived field is computed from this formula and never stored. */
  derived?: Expr;
  /** Locked fields are never offered to a model. */
  locked?: boolean;
  bound?: FieldBound;
  /** A `text` field naming a row of this table (an occupation, a region, a catalog item). */
  table?: TableId;
  visibility?: Visibility;
  /** With `known_by`: who knows the field besides those with a `knows` relation to its entity; matching is knowing (DESIGN §7). */
  knownBy?: Selector;
  /** Level contract: the domain and the lowest effective level at which the field is live. */
  domain?: DomainId;
  level?: Level;
}

export interface KindDef {
  id: KindId;
  label: string;
  /** Single inheritance. */
  extends?: KindId;
  fields: Record<FieldId, FieldDef>;
  /** Owning pack, when a pack defines it. */
  pack?: PackId;
}

/**
 * A world kind over the pack kind of the same id (DESIGN §4.1): the world's fields join the pack's,
 * its own winning a field both define, and its label and Extends win when it gives them.
 */
export function overlayKind(pack: KindDef, mine: KindDef): KindDef {
  return { ...pack, ...mine, fields: { ...pack.fields, ...mine.fields } };
}

/** Every kind a world plays with: the packs', each under the world's of the same id (`overlayKind`), and the world's own. */
export function playedKinds(packKinds: Readonly<Record<string, KindDef>> | undefined, kinds: Readonly<Record<string, KindDef>>): Record<string, KindDef> {
  const out: Record<string, KindDef> = { ...packKinds };
  for (const [id, mine] of Object.entries(kinds)) {
    const pack = packKinds && hasOwn(packKinds, id) ? packKinds[id] : undefined;
    out[id] = pack ? overlayKind(pack, mine) : mine;
  }
  return out;
}

export type Cardinality = "one_one" | "one_many" | "many_one" | "many_many";

/** Built-in relation types (DESIGN §3 feature mapping). */
export const BUILTIN_RELATIONS = ["in", "owns", "uses", "worn_by", "equipped", "knows", "member_of", "regard", "route"] as const;

/**
 * A relation type. A link written through the `link` effect must run between the allowed kinds and
 * stay within the cardinality (`many_one`: each source holds at most one; `one_many`: each target
 * has at most one source; `one_one`: both). A symmetric type (siblings) and an inverse pair
 * (`parent_of` / `child_of`) are kept two-sided: the effect writes and removes the other side too.
 */
export interface RelationTypeDef {
  id: RelationTypeId;
  label: string;
  /** Allowed source and target kinds (with inheritance); `*` allows any. */
  from: KindId | "*";
  to: KindId | "*";
  cardinality: Cardinality;
  symmetric: boolean;
  /** The relation the target holds back toward the source (`child_of` for `parent_of`). */
  inverse?: RelationTypeId;
  fields: Record<FieldId, FieldDef>;
  pack?: PackId;
}

// ---------------------------------------------------------------- entities and space

export interface RelationInstance {
  type: RelationTypeId;
  to: EntityId;
  fields?: JsonObject;
  /** End of a time-bounded relation (a use grant: assigned to, a loan). */
  until?: GameMinutes;
}

/**
 * Behaviour the narrator sees while one secret stays hidden (the Stance section, DESIGN §6.6): how
 * someone acts ("evasive about the cellar"), never the secret itself. It stands for exactly one
 * secret: a lore entry (while it is secret and its gate doesn't hold), a track (while it keeps
 * something from the POV) or a story flag (until it is set). One keyed to none or several never shows.
 */
export interface EntityCue {
  text: string;
  lore?: string;
  track?: TrackId;
  flag?: string;
}

export interface EntityDef {
  id: EntityId;
  kind: KindId;
  name: string;
  /** One of the world's tiers (`WorldDoc.tiers`); its band caps the entity's levels (DESIGN §9.1). */
  tier: TierId;
  fields: JsonObject;
  relations: RelationInstance[];
  /** Per-entity level overrides; never above the domain level (DESIGN §9.1). */
  levels?: Partial<Record<DomainId, Level>>;
  /** LOD1 agents run agendas and the planner (DESIGN §8). Unset: the tier's `agentDefault`. */
  agent?: boolean;
  /** The life state it starts in (DESIGN §8): one of the world's life states. Unset: alive. */
  life?: LifeStateId;
  /** Who knows the life state it starts in, besides itself (DESIGN §8); everyone else takes it for alive. Unset or empty: everyone. */
  lifeKnownBy?: EntityId[];
  /** Lumiverse character id, for group chats. */
  characterId?: string;
  /** `discoverable` (things, DESIGN §7): hidden until the POV searches where it is or opens what holds it, then known for good. */
  visibility?: Visibility | "discoverable";
  /** With `known_by`: who knows the entity besides those with a `knows` relation to it; matching is knowing (DESIGN §7). */
  knownBy?: Selector;
  /** Free-form labels selectors match (`tag`). Read live from the world. */
  tags?: string[];
  /** Classification values by facet (`WorldDoc.classifications`); a single-valued facet holds at most one. Read live from the world. */
  class?: Record<FacetId, FacetValueId[]>;
  /** Import from lore (DESIGN §9.7): the `bookId/entryId` entries this came from; never edited. */
  sources?: string[];
  /** What the engine filled in rather than the lore, for review (DESIGN §9.7 "assumed"): fields from a data table, and `kind` when the lore named none. */
  assumed?: string[];
  /** What the narrator sees them do while a secret of theirs stays hidden (DESIGN §6.6). Read live from the world. */
  cues?: EntityCue[];
}

export type FacetId = string;
export type FacetValueId = string;

/** One value of a classification facet; `parent` nests it under a broader value ("villain" under "antagonist"). */
export interface FacetValueDef {
  label: string;
  parent?: FacetValueId;
  description?: string;
}

/** A world-defined way of classifying entities (story role, disposition…), DESIGN §4.1. */
export interface FacetDef {
  id: FacetId;
  label: string;
  /** Whether an entity may hold several values of this facet. */
  multiple: boolean;
  values: Record<FacetValueId, FacetValueDef>;
  order?: number;
  description?: string;
  /**
   * Players can see this classification: Cast groups and filters by it. Unset or false keeps it to
   * Build and the GM side, so a value like "Villain" never reaches the player by default.
   */
  shown?: boolean;
}

/**
 * Which entities something applies to. Every constraint given must hold; a list matches any of
 * its values; an empty selector matches every entity. Classes and tags are definitional: read live
 * from the world for the entities it defines, from state for spawned ones. Kind follows
 * inheritance; tier and group membership come from state.
 */
export interface Selector {
  ids?: EntityId[];
  kind?: KindId[];
  tier?: TierId[];
  /** Facet → accepted values; an entity's value also matches when it nests under an accepted one. */
  class?: Record<FacetId, FacetValueId[]>;
  /** Members of any of these groups, directly or through a group that is itself a member. */
  memberOf?: EntityId[];
  tag?: string[];
}

export interface PlaceDef {
  id: PlaceId;
  name: string;
  parent?: PlaceId;
  /** IANA time zone; inherited from the parent when absent. */
  timeZone?: string;
  sceneType?: SceneTypeId;
  grid?: GridId;
  /** Position on the parent's grid. */
  cell?: { x: number; y: number };
  /** Position on the parent's node map (a parent without a grid); `cell` is for grids. */
  layoutPos?: { x: number; y: number };
  fields: JsonObject;
  visibility?: PlaceVisibility;
  /** With `known_by` or `discoverable`: who knows the place besides those with a `knows` relation to it; matching is knowing (DESIGN §7). */
  knownBy?: Selector;
  /** Import from lore (DESIGN §9.7): the `bookId/entryId` entries this came from; never edited. */
  sources?: string[];
  /** The map that compiled this place (it owns it; Build edits it in the map). Absent on authored places. */
  map?: MapId;
  /** Marked for the adjudication policy's `marked` timing: checks roll here and in the places inside it (DESIGN §11). */
  adjudicate?: boolean;
}

export interface RouteLeg {
  minutes: number;
  distanceKm?: number;
  terrain?: string;
}

export interface RouteDef {
  id: RouteId;
  from: PlaceId;
  to: PlaceId;
  modes: Partial<Record<TravelMode, RouteLeg>>;
  bidirectional: boolean;
  /** The map that compiled this route from its links; absent on authored routes. */
  map?: MapId;
}

export interface GridDef {
  id: GridId;
  width: number;
  height: number;
  cellMeters?: number;
  /** Terrain code per cell, row-major; length width × height. */
  terrain: string[];
  /** Blocked cell indexes. */
  blocked: number[];
  zones: Record<string, number[]>;
  /** Things that start lying at a cell of this grid: thing id → cell index (a map's legend places them). Each starts in the place whose area holds its cell, else in the place the grid draws (DESIGN §4.1). */
  items?: Record<EntityId, number>;
  /** The map that compiled this grid from its layout; absent on authored grids. */
  map?: MapId;
}

/**
 * What a character of a grid map's layout stands for (`lre-map-v1`): a wall, floor or door; a
 * terrain, blocked or not; part of one of the map's places (its area); part of a zone; or a thing
 * the world already has, lying on the floor there (in `place`'s area, else the area around it).
 */
export type MapCellDef = "wall" | "floor" | "door" | { terrain: string; blocked?: boolean } | { place: PlaceId } | { zone: string } | { item: EntityId; place?: PlaceId } | MapRoomDoorDef;

/**
 * A door on a room's edge (`lre-map-v1`): a door, walked through as any door is, that is also part
 * of `place`'s area, so whoever stands in it is in that room. A room door that touches another
 * room's area joins the two (§4.1).
 */
export interface MapRoomDoorDef {
  door: true;
  place: PlaceId;
}

/** A place a map draws inside its scope; the map creates it. */
export interface MapPlaceDef {
  id: PlaceId;
  /** Shown name; the id in words when absent. */
  name?: string;
  /** [x, y]: its cell on a grid map, its position on a node map. */
  at?: [number, number];
  /** The map that draws the inside of this place (its scope is this place). */
  opens?: MapId;
}

/** A way between two places, both directions unless `bidirectional` is false. */
export interface MapLinkDef {
  from: PlaceId;
  to: PlaceId;
  mode?: TravelMode;
  minutes: number;
  bidirectional?: boolean;
}

/**
 * A map (`lre-map-v1`, DESIGN §4.1): the source of truth for one place's interior. A grid map
 * (`layout` plus `legend`) draws an interior cell by cell; a node map (places plus links) draws a
 * town or a region. When the world is read, each map compiles into the places inside its scope, a
 * grid and routes, which it owns.
 */
export interface MapDoc {
  id: MapId;
  /** The place the map draws; its places go inside it. */
  scope: PlaceId;
  title?: string;
  /** [width, height]: the layout's size on a grid map, the frame `at` positions use on a node map. */
  size?: [number, number];
  /** A grid map's rows, top first, one character per cell. */
  layout?: string[];
  /** A grid map's cell size in metres, for walking times on it; a cell is 80 m unless it says. */
  cellMeters?: number;
  legend?: Record<string, MapCellDef>;
  places?: MapPlaceDef[];
  links?: MapLinkDef[];
}

// ---------------------------------------------------------------- rules, actions, checks

/** An effect proposal. Its type is registered by the engine or a pack; args are values or formulas. */
export interface EffectSpec {
  type: string;
  args: Record<string, JsonValue>;
}

/**
 * Someone stepping into a grid's zone, or onto one of its cells (the grid system, DESIGN §10): `in`
 * names the place whose grid it is (any grid with that zone when a zone trigger leaves it out);
 * `who` picks who counts, the POV when absent. It fires once per entry, not on each step inside.
 */
export type GridTrigger = { zone: string; in?: PlaceId; who?: Selector } | { cell: [number, number]; in: PlaceId; who?: Selector };

export type RuleTrigger =
  | { event: EventType }
  | { tick: "turn" | "slot" | "day" }
  | { enter: PlaceId }
  | { at: Expr }
  | GridTrigger;

export interface RuleDef {
  id: RuleId;
  on: RuleTrigger;
  when?: Expr;
  do: EffectSpec[];
  once?: boolean;
  cooldownMinutes?: number;
  /** Tagged rules count as quest/rule interrupts during a timelapse. */
  interrupt?: boolean;
  /** A storylet beat: an outline hint offered when the rule fires. */
  beat?: { hint: string; weight?: number };
  pack?: PackId;
}

export interface ParamDef {
  type: FieldType;
  label?: string;
  ref?: KindId;
  optional?: boolean;
  /** A ref param's candidates must also match this selector: the palette offers only those, and the resolver refuses others. */
  of?: Selector;
  /**
   * A `text` param naming a row of this data table (a skill, a save): the palette offers one option
   * per row, labelled by the row's `label`, and the resolver takes a row id or label and refuses others.
   */
  table?: TableId;
  /**
   * A ref param a thing the player says they have may fill when the world doesn't have it, as the POV
   * sees it (DESIGN §9.4 player claims): it is made where the action expects it, in the actor's
   * hands (`held`) or where the actor is (`here`), under the chat's claims policy.
   */
  claim?: ClaimPlace;
}

/**
 * A check outcome band. A band matches when every range it states holds; bands with a `natural`
 * range are tried first, in order, then the rest, in order (DESIGN §11).
 */
export interface CheckBand {
  outcome: string;
  /** Inclusive range on the check total. */
  min?: number;
  max?: number;
  /** Inclusive range on the natural die: the face of the first dice term's single kept die (`d20`, `2d20kh1`). */
  natural?: Span;
  /** Inclusive range on the margin, the total minus the DC. Needs a DC: `dc`, a passive opponent, or an opponent who rolls (DC 0). */
  margin?: Span;
}

/**
 * The other side of an opposed check, read with the opponent as `self` (DESIGN §11). An opponent
 * who rolls is folded into one notation (`1d20-1d20`) whose modifier is the difference, so the odds
 * stay exact and the total is the difference. With none of `check`, `modifier` and `passive`, the
 * opponent rolls this same check.
 */
export interface OpposedRoll {
  /** The binding that names the opponent: a ref parameter of the action, or the `check` effect's `target`. Default `target`. */
  who?: string;
  /** The opponent rolls this check (its dice, advantage and modifier). */
  check?: CheckId;
  /** The opponent rolls this check's own dice with this modifier. */
  modifier?: Expr;
  /** The opponent doesn't roll: this score becomes the DC. */
  passive?: Expr;
}

/**
 * The one check mechanism: a dice expression plus outcome bands, with exact odds. What a check
 * reads (modifier, advantage, DC, the opponent) is evaluated from the state before the roll.
 */
export interface CheckDef {
  id: CheckId;
  dice: DiceExpr;
  modifier?: Expr;
  /**
   * −1 (disadvantage), 0 or 1 (advantage). It changes the dice, never the modifier: the natural die
   * gets one more of its size and keeps the highest (`d20` → `2d20kh1`) or the lowest (`2d20kl1`).
   */
  advantage?: Expr;
  /** The difficulty. With a DC and no bands, the outcomes are `failure` (margin below 0) and `success`. */
  dc?: Expr;
  vs?: OpposedRoll;
  /** Absent or empty: the DC's two bands when the check has a DC or an opponent, else every roll reads `none`. */
  bands?: CheckBand[];
  /**
   * The outcomes that count as a success when the adjudication policy reads the check's chance or
   * tells a failure (DESIGN §11). Absent: `success` and every band listed after it.
   */
  pass?: string[];
  /** The outcome a check that isn't rolled passes with, when neither the action nor the check has `success`. */
  auto?: string;
}

export interface ActivitySpec {
  type: ActivityType;
  /** When the activity ends: a formula over the scene (`until 07:00`, the shift's end, arrival). */
  until: Expr;
}

/**
 * What someone is doing decides whether the span an action gave it (`activity_until`) goes on
 * (DESIGN §9.2): it ends when another activity is set or when they move. These record the activity
 * the span was given for and where it began, written with it by the action, and by a GM edit of the
 * activity or its end. Anything else that sets `activity` (a meal's `set`, a narrated move, a
 * routine, a ✎ edit) leaves the old end behind, which isn't the new activity's.
 */
export const ACTIVITY_SPAN_OF = "_activity_span";
export const ACTIVITY_PLACE = "_activity_place";

/**
 * The engine's own records on an entity, which no view, mind or prompt lists: the span's, and the
 * end of a Speed through offered that an earlier build recorded and chats played then still hold.
 */
export const ENGINE_FIELDS: Readonly<Record<string, true>> = { [ACTIVITY_SPAN_OF]: true, [ACTIVITY_PLACE]: true, _activity_offered: true };

/**
 * When someone's current activity ends, as the action that began it said: `activity_until` while the
 * activity is still the one it was given for and they are still where it began; null when there is
 * none, another activity has been set since, or they have moved. A state from before a span named
 * its activity, or its place, reads the end as it did then.
 */
export function activitySpanEnd(fields: Readonly<JsonObject> | undefined): number | null {
  const until = fields?.activity_until;
  if (typeof until !== "number") return null;
  const of = fields?.[ACTIVITY_SPAN_OF];
  const at = fields?.[ACTIVITY_PLACE];
  if (of !== undefined && of !== fields?.activity) return null;
  return typeof at === "string" && at !== fields?.place ? null : until;
}

/** The records a span's end needs for `fields`' activity, where they are now: what an action or a GM edit writes with the end. */
export function spanRecords(entity: string, fields: Readonly<JsonObject> | undefined): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  if (typeof fields?.activity === "string" && fields[ACTIVITY_SPAN_OF] !== fields.activity) out.push({ type: "set", entity, field: ACTIVITY_SPAN_OF, value: fields.activity });
  // Nowhere in particular (inside something): a place an earlier span began at no longer applies.
  const place = typeof fields?.place === "string" ? fields.place : null;
  if ((fields?.[ACTIVITY_PLACE] ?? null) !== place) out.push({ type: "set", entity, field: ACTIVITY_PLACE, value: place });
  return out;
}

/**
 * What makes an action a combat action (DESIGN §11): only worlds whose ruleset defines combat offer
 * it, and in a fight it is taken on its actor's turn, spending its cost from the actor's economy.
 */
export interface CombatActionDef {
  /** Budget id → how many it spends ("action": 1); empty: it's free. */
  cost: Record<string, number>;
  /** It starts a fight (Fight, an ambush): taken only while none is under way. Every other combat action needs one. */
  start?: boolean;
  /** How the engine's tactics use it for everyone but the POV: `attack` a foe, `defend` when hurt. Absent: only an `npc.choose` decision picks it. */
  role?: "attack" | "defend";
}

/**
 * An action's requirement (DESIGN §11): a formula, or one its author marks as a hard lock (`hard`).
 * The player's will decides what a typed action is, so one whose plain requirement doesn't hold still
 * plays, as plain roleplay; only a hard lock that doesn't hold vetoes it, and the narrator tells the
 * attempt failing ("the safe stays shut"). Every other reader (the palette, the catalog's needs, an
 * NPC's choice) holds both alike.
 */
export type Requirement = Expr | { expr: Expr; hard?: boolean };

/** A requirement's formula. */
export function requirementExpr(req: Requirement): Expr {
  return typeof req === "string" ? req : req.expr;
}

/** Whether a requirement is its author's hard lock. */
export function isHardLock(req: Requirement): boolean {
  return typeof req !== "string" && req.hard === true;
}

export interface ActionDef {
  id: ActionId;
  label: string;
  /** What the action does, in a line: `interpret`'s catalog gives it the model with the label (DESIGN §5.2). Public text, like the label. */
  description?: string;
  params: Record<string, ParamDef>;
  requires: Requirement[];
  /** Inline check or a reference to `checks`. */
  check?: CheckId | CheckDef;
  /** Effects per check outcome; `default` when there is no check. */
  outcomes: Record<string, EffectSpec[]>;
  /** Duration in minutes. */
  duration: Expr;
  activity?: ActivitySpec;
  /** Ways players say it ("head over to", "walk to"): `interpret`'s catalog shows them as hints (DESIGN §5.2); no word list decides what an input is. */
  lexicon?: string[];
  /** The label other characters can observe (no secrets; linted). */
  observable?: string;
  combat?: CombatActionDef;
  pack?: PackId;
  /** Marked for the adjudication policy's `marked` timing: its check rolls wherever it is taken (DESIGN §11). */
  adjudicate?: boolean;
  /** Pure bookkeeping the player does alone (a trade, a transfer between their own accounts): a panel tap with no words records it at once, with no message, no reply and no clock time, since nothing in it needs telling (DESIGN §11). */
  mechanical?: boolean;
}

/** Whether a world offers an action: a combat action only where the ruleset defines combat (DESIGN §11). */
export function offersAction(world: Pick<WorldDoc, "ruleset">, action: Pick<ActionDef, "combat">): boolean {
  return action.combat === undefined || world.ruleset?.combat !== undefined;
}

// ---------------------------------------------------------------- calendar, schedules, tracks

export interface DayPart {
  id: string;
  label: string;
  /** Start as `HH:MM`. */
  start: string;
}

export type DateRule =
  | { type: "fixed"; month: number; day: number }
  | { type: "nth_weekday"; month: number; weekday: number; n: number }
  | { type: "relative"; to: string; days: number }
  | { type: "easter"; days: number };

export interface HolidayDef {
  id: string;
  label: string;
  rule: DateRule;
  dayOff: boolean;
}

export interface CalendarDef {
  system: "gregorian" | "custom";
  /** Epoch as ISO local date-time, e.g. `2026-10-16T06:00`. GameMinutes count from here. */
  epoch: string;
  timeZone: string;
  dayParts: DayPart[];
  holidays: HolidayDef[];
  /** Custom calendars only. */
  custom?: { monthLengths: number[]; monthNames: string[]; weekdayNames: string[] };
}

export interface Recurrence {
  every: "day" | "week" | "month" | "year";
  /** Weekdays, 0 = Sunday, for `week`. */
  weekdays?: number[];
  /** Days of the month for `month`. */
  days?: number[];
  /** Holiday ids on which the schedule does not run. */
  except?: string[];
  from?: string;
  until?: string;
}

export interface WeightedValue {
  value: JsonValue;
  weight: number;
}

export interface ScheduleSlot {
  start: string;
  end: string;
  /** A fixed value, or a weighted distribution sampled with the process seed. */
  value?: JsonValue;
  weighted?: WeightedValue[];
  /** Distribution conditioned on the previous slot's value. */
  given?: Record<string, WeightedValue[]>;
  /** What the slot rests on (`shared/routines`); absent, the schedule's own source. */
  source?: WorldRoutineSource;
}

/**
 * Calendar recurrence plus a slot table: shifts, routines, weather, bills, paydays, price paths.
 * When several schedules set the same field of the same entity, the most specific owner wins:
 * the entity's own, then a group it belongs to, then its kind, then a selector.
 */
export interface ScheduleDef {
  id: ScheduleId;
  /**
   * Who the schedule applies to: an entity; a group (its members that aren't groups themselves,
   * directly or through member groups); a kind (with inheritance); or a selector. Absent for world
   * processes (weather, prices).
   */
  owner?: EntityId | KindId | Selector;
  /** The field or relation the slot value sets (`place`, `activity`, `weather`, …). */
  target: string;
  recurrence: Recurrence;
  slots: ScheduleSlot[];
  pack?: PackId;
  /** What the schedule rests on (`shared/routines`): authored (absent), a lore entry or a sheet field, with its quote. */
  source?: WorldRoutineSource;
}

export type TrackKind = "quest" | "secret" | "puzzle" | "agenda";

export interface StageAnswer {
  expect: string[];
  normalize: boolean;
  /** Authored opt-in: `puzzle.answer` with a probability threshold (DESIGN §10). */
  decision?: { threshold: number };
}

/** A stage objective: an expression, or a prose label with the expression that decides it is done. */
export type Objective = Expr | { label: string; when: Expr };

export function objectiveWhen(o: Objective): Expr {
  return typeof o === "string" ? o : o.when;
}

/** What the quest panel shows: the label, or the expression itself when there is none. */
export function objectiveLabel(o: Objective): string {
  return typeof o === "string" ? o : o.label;
}

export interface StageDef {
  label: string;
  objectives?: Objective[];
  next: { to: StageId; when: Expr }[];
  effects?: EffectSpec[];
  gate?: Expr;
  fail?: { when: Expr; to: StageId };
  rewards?: EffectSpec[];
  /** Player-facing cue text. */
  cue?: string;
  /** Secret truth: GM-only, reaches a slot only at reveal (DESIGN §7). */
  truth?: string;
  answer?: StageAnswer;
  hints?: string[];
  /** Agenda tracks: planner priority while in this stage. */
  priority?: number;
}

export interface TrackDef {
  id: TrackId;
  kind: TrackKind;
  label: string;
  owner?: EntityId;
  start: StageId;
  stages: Record<StageId, StageDef>;
  visibility: Visibility;
  /** With `known_by`: who knows the track besides its owner and those who know the owner; matching is knowing (DESIGN §7). */
  knownBy?: Selector;
  /** Marked for the adjudication policy's `marked` timing: checks roll while the track is in progress (DESIGN §11). */
  adjudicate?: boolean;
}

// ---------------------------------------------------------------- packs, realism, time, context

export interface PackConfig {
  /** The pack's format version the world was authored against. */
  version: number;
  config: JsonObject;
}

/** Pinned generator versions and data-table revisions (DESIGN §9.2). */
export interface WorldPins {
  generators: Record<GeneratorId, number>;
  tables: Record<TableId, string>;
}

export interface RealismDefaults {
  preset: RealismPresetId;
  levels: Record<DomainId, Level>;
  /** Caps per detail band, keyed by band id; the POV is never capped. */
  tierCaps: Record<Band, Partial<Record<DomainId, Level>>>;
  /** What a typed action's thing the world doesn't have becomes in new chats (DESIGN §9.4); absent, the user's setting fills in. */
  claims?: ClaimsPolicy;
}

/**
 * A world tier (DESIGN §9.1): a named rank of importance that maps to one of the three detail bands,
 * so its people are capped by that band's caps. Worlds name, add and order their own.
 */
export interface TierDef {
  label: string;
  band: Band;
  /** Position in lists, lowest first. */
  order: number;
  /** Its people are LOD1 agents unless their entity says otherwise (never the POV). */
  agentDefault?: boolean;
  description?: string;
}

export interface TimeDefaults {
  /** Default tick per scene type in minutes; worlds may add types. */
  sceneTicks: Record<SceneTypeId, number>;
  interrupts: Record<InterruptClass, InterruptPolicy>;
  speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
  montage: "key" | "day" | "week";
  unitCap: { agentDays: number; events: number };
}

export type SlotPosition =
  | { type: "native" }
  | { type: "outlet"; name: string }
  | { type: "chat_depth"; role: "system" | "user" | "assistant"; depth: number; direction: "from_start" | "from_end" };

/**
 * Whose knowledge a section's facts come from (DESIGN §6.11): `player`, what the player character
 * knows (the default); `scene`, also what the characters with him know or plainly see; `gm`,
 * everything. A fact beyond the player character's is marked for the narrator, never for a player surface.
 */
export type FeedScope = "player" | "scene" | "gm";
export const FEED_SCOPES: readonly FeedScope[] = ["player", "scene", "gm"];

/** Each scope in the GM's and the author's words: Build's Sections field and GM → This chat → Sections both say them. */
export const SCOPE_LABEL: Record<FeedScope, string> = {
  player: "What your character knows",
  scene: "Also what the people with your character know",
  gm: "Everything, with what your character doesn't know marked",
};

/**
 * What goes into a section (DESIGN §6.11): the world's defaults on its section, the GM's per chat
 * over them. Every part is optional; a section with none delivers as it always has.
 */
export interface SectionFeed {
  /** False leaves the section out of the prompt. */
  enabled?: boolean;
  /** At most this many tokens of the section: lines past it are cut from the end. */
  maxTokens?: number;
  /** At most this many lines. */
  maxLines?: number;
  /** The renderer sources that fill it (`SectionRenderer.source`); absent, the renderers of its own slot. */
  include?: string[];
  scope?: FeedScope;
}

export const SECTION_FEED_KEYS: readonly (keyof SectionFeed)[] = ["enabled", "maxTokens", "maxLines", "include", "scope"];

/** A section's feed read from outside data: null when any part is malformed. Counts are whole and at least 1; sources are non-empty words. */
export function readSectionFeed(raw: unknown): SectionFeed | null {
  if (!isRecord(raw)) return null;
  const out: SectionFeed = {};
  for (const key of Object.keys(raw)) if (!SECTION_FEED_KEYS.some((k) => k === key)) return null;
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") return null;
    out.enabled = raw.enabled;
  }
  for (const key of ["maxTokens", "maxLines"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return null;
    out[key] = v;
  }
  if (raw.include !== undefined) {
    if (!Array.isArray(raw.include) || !raw.include.every((s): s is string => typeof s === "string" && s.trim() !== "")) return null;
    // No sources is the default (its own slot's renderers), not a section nothing fills.
    if (raw.include.length > 0) out.include = raw.include;
  }
  if (raw.scope !== undefined) {
    const scope = FEED_SCOPES.find((s) => s === raw.scope);
    if (!scope) return null;
    out.scope = scope;
  }
  return out;
}

/** A slot section in the engine-managed lore book (DESIGN §4.2, §6.3), with its feed defaults (§6.11). */
export interface SectionTemplate extends SectionFeed {
  id: SlotId;
  label: string;
  /** Lower ranks are reserved first on the section budget; Outcome is never evicted. */
  rank: number;
  template: string;
  position: SlotPosition;
}

export type StepPurpose =
  | "interpret"
  | "npc.choose"
  | "puzzle.answer"
  | "brief"
  | "outline"
  | "extract"
  | "choices"
  | "judge"
  /** Character minds (DESIGN §24): each mind, the memory written after a reply, a time skip's beats, and consolidation. */
  | "mind"
  | "memory"
  | "skip"
  | "consolidate";

/** A world-authored prompted or decision step template (DESIGN §5.2). */
export interface StepTemplateDef {
  id: StepTemplateId;
  purpose: StepPurpose;
  template: string;
  output: "text" | "effects" | "decision";
  signals: string[];
}

/**
 * Where a lore entry came from (DESIGN §4.2). An entry without one was authored in Build, as is
 * every entry written before sources existed. A book entry keeps the hash of the World Info text it
 * was indexed from (`bookTextHash`), so Build can tell when the book has changed since; a chat
 * entry names the message it was saved from; an AI entry was written by an indexing job from
 * pasted text, and is `pending` until the author accepts it.
 */
export type LoreSource =
  | { kind: "authored" }
  | { kind: "book"; bookId: string; entryId: string; hash: string }
  | { kind: "chat"; chatId: ChatId; messageId: MessageId }
  | { kind: "ai"; status: "pending" | "accepted" };

/**
 * World lore (DESIGN §4.2): what the world knows, authored in Build, indexed from World Info books
 * or text, saved from a chat, or imported with a world. It is kept in the world document and read
 * by RPEngine's own helpers through the lore search (`engine/lore.ts`), not delivered to the
 * narrator yet; the engine-managed book holds slots only. A secret entry may hold the secret
 * itself: only the helpers in its `audience` read it, and only until its `gate` holds.
 */
export interface LoreEntryDef {
  id: string;
  title: string;
  content: string;
  /** Keywords the entry answers to (never host World Info keys). */
  keys: string[];
  /** Entity and place ids the entry is about (back-links). */
  links: string[];
  /** Other names its subject goes by ("the old lighthouse"); the lookup table's terms can route them here. */
  aliases?: string[];
  /** Topics the entry belongs under, by label ("harbor law"); the lookup table's topics gather them. */
  topics?: string[];
  /** Absent: authored. */
  source?: LoreSource;
  /** Entries sharing a group are alternatives to each other: a search returns the best of them. */
  group?: string;
  /** Higher comes first among otherwise equal entries. */
  priority?: number;
  /**
   * Who may read a non-secret entry: `public` (absent), or `known_by`, read only once the POV knows
   * every person and place it links. Any other value hides the entry from every helper.
   */
  visibility?: "public" | "known_by";
  /** Secret lore is gated: it is revealed only once `gate` holds, and it needs one. */
  secret?: boolean;
  gate?: Expr;
  /**
   * The helpers that may read a secret entry before its gate holds; none when absent. Steps whose
   * output reaches the narrator or the player (`brief`, `outline`, `choices`, `extract`) never
   * read it, even when listed (linted).
   */
  audience?: StepPurpose[];
  /**
   * The people whose own secret it is: their minds read it, gate or no gate (DESIGN §24.5). A
   * person's cue that stands for the entry makes it theirs too; no other mind ever reads it.
   */
  holders?: EntityId[];
}

/** A topic in the lore lookup table: its label and its entries, in reading order. */
export interface LoreTopic {
  label: string;
  entries: string[];
}

/**
 * The world's lore lookup table (DESIGN §4.2): the curated routing RPEngine's own lore searches
 * follow, whether the author or an indexing job wrote it. Entry aliases and topics feed its
 * suggestions; the table is what a lookup reads.
 */
export interface LoreIndex {
  /** A lowercase term or alias → the ids of the entries it means. */
  terms: Record<string, string[]>;
  /** The table of contents by topic id. */
  topics: Record<TopicId, LoreTopic>;
}

/**
 * A lore entry pinned to a character, a place or a step (DESIGN §24.5, §5.4): one of the world's own
 * (`lore`, an entry id), an entry of one of the user's Lumiverse World Info books (`book` and
 * `entry`, the host's ids), or a whole book (`book` alone), read from the book whenever it is used: a
 * whole book's switched-on entries in the book's own order, so one added to the book is read unasked.
 * `keep: "end"`: when the entry doesn't fit, its end is kept rather than its start, so a timeline
 * written oldest first keeps its newest events (absent: the start).
 */
export type LorePin = ({ lore: string } | { book: string; entry: string } | { book: string }) & { keep?: LoreKeep };

/** Which part of a long entry a cut keeps: its start, or its end. */
export type LoreKeep = "start" | "end";

/**
 * Lore pinned where calls always read it (DESIGN §24.5, §5.4): `characters` by entity id, read by
 * that character's mind calls; `places` by place id, read by every helper call while the player
 * character is there and every mind call of someone there, a place's pins holding in the places
 * inside it; `steps` by step, read by every call of that step whatever its lore policy (the mind
 * step's by every mind). Pinned text counts against the call's lore tokens, nearest first, and is cut
 * to fit. Pins never widen who may read an entry: a secret or Known by entry reaches a call only when
 * its reader may read it.
 */
export interface LorePins {
  characters: Record<EntityId, LorePin[]>;
  places: Record<PlaceId, LorePin[]>;
  steps: Partial<Record<StepPurpose, LorePin[]>>;
}

export type SuppressedSource =
  | { bookId: string; entryId: string }
  | { bookId: string; comment: string; contentHash: string };

// ---------------------------------------------------------------- ruleset

/**
 * A progression (DESIGN §11): experience in one field, the level in another, and the thresholds
 * between them. The level follows the XP, both ways: after an effect changes an entity's XP, the
 * engine raises its level to the last threshold reached one level at a time, running `onLevel` for
 * each, or lowers it straight there, running nothing, with any pool then above its lower max capped
 * at it. Nothing else writes the level.
 */
export interface ProgressionDef {
  label: string;
  /** The number field that holds experience. */
  xpField: FieldId;
  /** The number field that holds the level; the engine sets it from the XP, and refuses any other write. */
  levelField: FieldId;
  /**
   * The XP each level needs, from level 1 (usually 0): the level is how many thresholds the XP has
   * reached. A list, or a data table's column read in row order.
   */
  thresholds: number[] | { table: TableId; column: string };
  /** Run once per level gained, with the entity as `self`, `level` the level reached and `from` the level before the gain. */
  onLevel?: EffectSpec[];
  /** The highest level; XP beyond its threshold raises nothing. */
  maxLevel?: number;
  /** The kind it applies to (descendants included); absent: every entity whose kind has both fields. */
  kind?: KindId;
}

/** One row of a designed sheet: a field, a formula, a pool's bar or a progression's level and XP. */
export type SheetRowDef = { field: FieldId; label?: string } | { formula: Expr; label: string } | { pool: FieldId; label?: string } | { progression: ProgressionId; label?: string };

export interface SheetSectionDef {
  id: string;
  label: string;
  rows: SheetRowDef[];
}

/** The sheet Play → You shows in place of the Sheets pack's own (DESIGN §11), laid out in Build's Sheet Designer. */
export interface SheetLayoutDef {
  sections: SheetSectionDef[];
}

/** One budget of a fight's action economy (DESIGN §11): how many a participant has, and when it refills. */
export interface CombatBudgetDef {
  label: string;
  /** How many: a number, or a formula with the participant as `self`; default 1. */
  count?: number | Expr;
  /** Refilled at the start of the participant's own turn (the default) or of every round. */
  per?: "turn" | "round";
  /** Spent outside one's own turn (a reaction): an unspent one never keeps a turn open. */
  offTurn?: boolean;
}

/**
 * A world's combat rules (DESIGN §11), all data. Combat actions are actions with `combat`; an attack
 * is one whose check reads the defense (a DC or an opposed roll) and whose hit outcomes take
 * `roll()` damage off the HP pool.
 */
export interface CombatDef {
  /** Rolled by every participant when a fight starts, highest first: a check id or an inline check, with the participant as `self`. */
  initiative: CheckId | CheckDef;
  /** Breaks equal initiative totals, higher first: a formula with the participant as `self` (default: its initiative modifier). Then the POV's side goes first, then id order. */
  tieBreak?: Expr;
  /** The action economy by budget id ("action", "bonus", "move", "reaction"). */
  economy: Record<string, CombatBudgetDef>;
  /** The pool field that holds hit points. */
  hp: FieldId;
  /**
   * When a participant is down (default: no HP left), the condition it then has (default `down`),
   * and the life state it falls into (DESIGN §8; none by default): back up, it is alive again.
   */
  down?: { when?: Expr; condition?: string; life?: LifeStateId };
  /** Who is hostile to whom (default: a `hostile` relation either way), and who fights beside whom (default: no one), with `self` and `other`. */
  sides?: { hostile?: Expr; ally?: Expr };
  /** When the fight is over (default: one side has no one standing). */
  end?: Expr;
  /** How many whole rounds in a row in which no one attacks (hit or miss) and no one's HP changes end a fight as a stalemate (default 3); 0: a fight never peters out. */
  stalemate?: number;
  /** The POV's turn ends once none of its combat actions fits what is left (`spent`, the default), or only on End turn (`manual`). */
  endTurn?: "spent" | "manual";
  /**
   * Who settles the POV's combat actions: the dice, every time (`dice`, the default), or the world's
   * adjudication policy like any other check (`policy`). Everyone else's always roll: no player
   * chose them and no judge reads them. Under `policy` each new round counts as a change for a
   * `changed` retry rule, since a fight takes no clock time.
   */
  adjudicate?: "dice" | "policy";
  /** How everyone else fights: the foe it attacks (the highest `threat`, with `self` and `target`; default the foe's HP) and when it defends (`lowHp`; default a quarter of its HP or less). */
  tactics?: { threat?: Expr; lowHp?: Expr };
  /** Others' HP as the player sees it: wound bands (the default) or exact numbers, where the HP field is visible. */
  showHp?: "wounds" | "exact";
  /** Wound bands over the HP left, in percent of the max. */
  wounds?: BandDef[];
}

/**
 * A world's tabletop ruleset (DESIGN §11): progression, the sheet layout, combat and the realism
 * floors its math needs. Every key is optional; later parts of the ruleset add their own keys to this interface.
 */
export interface RulesetDef {
  progression?: Record<ProgressionId, ProgressionDef>;
  sheet?: SheetLayoutDef;
  /** Fights: initiative, the action economy, HP, who is down and when it's over. Absent: the world has no combat. */
  combat?: CombatDef;
  /** The lowest effective level each domain plays at, whatever the realism settings: stat modifiers need Sheets 3. */
  minLevels?: Partial<Record<DomainId, Level>>;
  /** How the world's checks are decided: when they roll, what the player's words weigh, who settles them (DESIGN §11). */
  adjudication?: AdjudicationDef;
  /** The world's default for inferred checks: how a typed attempt no catalog action with its own check covers is read as a check of its sheet (DESIGN §11). */
  inferred?: InferredChecks;
  /** The profile the ruleset last started from (Build → Ruleset → Start from a profile), by id; nothing reads it as rules. */
  profile?: string;
}

/** A named adjudication preset expands to concrete values; `custom` keeps them as edited. */
export type AdjudicationPresetId = "narrative" | "balanced" | "crunchy" | "custom";
/** When an action's check rolls: every time, only when it is risky, only where the author marked, or never. */
export type CheckTiming = "every" | "risky" | "marked" | "never";
/** How the player's described approach shifts a rolled check: not at all, a bonus, advantage, or a lower DC. */
export type DescriptionWeight = "none" | "bonus" | "advantage" | "dc";
/** Who settles a check: the roll; the roll, with close calls told to the narrator; or the story, through the judge. */
export type CheckAuthority = "mechanics" | "hybrid" | "narrative";
/** Retrying a failed check: a fresh roll; the same failure until something changed; the same failure until the scene changes. */
export type RetryRule = "free" | "changed" | "once";

/**
 * The adjudication policy (DESIGN §11): when checks happen and who settles them. A world without
 * one plays as every check always has: rolled, and settled by the roll.
 */
export interface AdjudicationDef {
  preset: AdjudicationPresetId;
  checks: CheckTiming;
  /** With `risky`: a check rolls only when its success chance is below this (0–1). */
  riskyAt: number;
  /** A success chance at or above this passes without a roll; null never does. */
  trivialAt: number | null;
  /** A success chance at or below this fails without a roll; null never does. */
  impossibleAt: number | null;
  description: {
    weight: DescriptionWeight;
    /** The judge rates an approach from 0 to this: the most a bonus adds, or a DC drops by. */
    max: number;
    /** With `advantage`: the rating that grants it. */
    advantageAt: number;
  };
  authority: CheckAuthority;
  /** With `hybrid`: a roll that many points or fewer from another outcome is a close call. */
  closeBy: number;
  retry: RetryRule;
  /** With `changed`: game minutes after which the same check may be rolled again. */
  retryAfter: number;
}

/** How the map shows the world (DESIGN §12): what the POV knows, places only heard of drawn dashed; or fog over what it hasn't seen. */
export type MapDisplay = "knowledge" | "fog";

/**
 * A world's map settings (DESIGN §4.1, §12); a world without them plays with `DEFAULT_MAP_SETTINGS`
 * (`shared/maps` `mapSettingsOf`). The grid system is optional: with `movement` on, walls and doors
 * steer the POV across grids, things lie in cells, cells and zones trigger rules, and the POV sees
 * `sightRadius` cells around it. `travelSimulation` (off unless set) makes Go need a walking route;
 * a narrated move lands either way, story first.
 */
export interface MapSettings {
  display: MapDisplay;
  grid: { movement: boolean; sightRadius: number };
  /** Absent: off. */
  travelSimulation?: boolean;
  /** Absent, or any part of it: `DEFAULT_TRAVEL` (`shared/maps` `travelTuningOf`). */
  travel?: Partial<TravelTuning>;
}

/**
 * How long travel takes (DESIGN §9.1), tuned per world. Speeds are km/h: a mode's (or a vehicle
 * class's) speed times every leg it takes by the leg's distance, in place of the route's own
 * minutes; one not set leaves each route's minutes as authored, and a leg with no distance always
 * keeps them. The rest are a vehicle trip's overheads.
 */
export interface TravelTuning {
  speeds: Partial<Record<TravelMode, number>>;
  /** By vehicle class (a `vehicles.classes` row), on every mode it goes by; before the mode's own speed. */
  vehicleSpeeds: Record<string, number>;
  /** Getting a vehicle going: in, started and out of its spot. */
  startMinutes: number;
  /** Parking it where the trip leaves it. */
  parkMinutes: number;
  /** The longest walk to a vehicle parked elsewhere that a trip takes; 0: only a vehicle where you are. */
  fetchMinutes: number;
}

export interface WorldDoc {
  format: typeof WORLD_FORMAT;
  id: WorldId;
  name: string;
  /** Engine version that last wrote the document. */
  engineVersion: string;
  packs: Record<PackId, PackConfig>;
  pins: WorldPins;
  kinds: Record<KindId, KindDef>;
  relations: Record<RelationTypeId, RelationTypeDef>;
  entities: Record<EntityId, EntityDef>;
  places: Record<PlaceId, PlaceDef>;
  routes: Record<RouteId, RouteDef>;
  grids: Record<GridId, GridDef>;
  /** Maps by id (`lre-map-v1`): the source of truth for the places, grids and routes they compile into. */
  maps: Record<MapId, MapDoc>;
  rules: Record<RuleId, RuleDef>;
  actions: Record<ActionId, ActionDef>;
  checks: Record<CheckId, CheckDef>;
  calendar: CalendarDef;
  schedules: Record<ScheduleId, ScheduleDef>;
  /** Routines by id (DESIGN §8, `shared/routines`): the soft shape of people's days, owner by owner; absent, none (everyone has the basic needs only). */
  routines?: Record<RoutineId, RoutineDef>;
  /** How strictly people keep to routine against the story, whom routines invite, how social people are, how plans bend routine, each level's routine role, the narrator's soft routine context and the palette Timelapse's Follow my routine default; absent, the defaults (`routineSettingsOf`). */
  routineSettings?: RoutineSettings;
  /** Each need on or off, its rate an hour and the points it is told and alerts at (DESIGN §8, `shared/needs`); absent, every need on as earlier builds had them (`needsSettingsOf`). */
  needs?: NeedsSettings;
  tracks: Record<TrackId, TrackDef>;
  tables: Record<TableId, DataTable>;
  realism: RealismDefaults;
  time: TimeDefaults;
  sections: Record<SlotId, SectionTemplate>;
  steps: Record<StepTemplateId, StepTemplateDef>;
  /** Sources of adopted user entries (a retired design, DESIGN §4.2): kept for the format; nothing reads them. */
  suppressed: SuppressedSource[];
  /** World lore by id (DESIGN §4.2): authored data, not delivered yet. */
  lore: Record<string, LoreEntryDef>;
  /** The lore lookup table (DESIGN §4.2); empty in documents written before it existed. */
  loreIndex: LoreIndex;
  /** Lore pinned to characters and places (DESIGN §24.5, §5.4); absent, none. */
  lorePins?: LorePins;
  /**
   * World Info books the world reads lore from live (DESIGN §4.2), beside a chat's own books and the
   * user's global ones: a character's or persona's book is read only when it is listed here. Each
   * entry is lore with LRE's fields from its extension data (`BookLoreFields`); absent, none listed.
   */
  loreBooks?: string[];
  /** How the map shows the world, and the optional grid system (DESIGN §12); absent, the defaults. */
  mapSettings?: MapSettings;
  /** Classification facets by id (DESIGN §4.1); entities hold values in `class`. */
  classifications: Record<FacetId, FacetDef>;
  /** Character minds (DESIGN §24.2): secrecy, the fidelity weights and thresholds, the author's pins and memory defaults; absent, the defaults (`worldMindsOf`). */
  minds?: WorldMindsConfig;
  /** The world's tabletop ruleset (DESIGN §11); absent in worlds that have none. */
  ruleset?: RulesetDef;
  /** Action seeds: a fresh seed per Re-run, or `hash(runSeed, parent path, action)` (DESIGN §4.3). */
  seedMode: "fresh" | "same_roll";
  /** Lenient worlds accept a narrated price inside its band (DESIGN §9.5). */
  lenientPricing: boolean;
  /** How money displays. State keeps integer minor units; the UI formats them with this. */
  currency: WorldCurrency;
  /** The POV entity; never capped, whatever its tier. */
  pov: EntityId;
  /** The world's tiers by id (DESIGN §9.1). */
  tiers: Record<TierId, TierDef>;
  /** The tier a spawned entity gets when it names none; unset, the lowest-order tier in the Background band. */
  spawnTier?: TierId;
  /** Characters replies may introduce in a chat, in total (DESIGN §9.4); absent, `DEFAULT_SPAWN_CAP`. */
  spawnCap?: number;
  /** The world's own life states besides alive, dying and dead (DESIGN §8); absent, only those three. */
  lifeStates?: Record<LifeStateId, LifeStateDef>;
  /** Where the POV starts. */
  start: { place: PlaceId; at: string };
}

/** A world's money display (DESIGN §9.5). Amounts are integer minor units everywhere in state. */
export interface WorldCurrency {
  /** ISO 4217 code, or a world's own ("GP"). */
  code: string;
  symbol: string;
  /** The minor unit's name ("cent", "copper"). */
  minorUnit: string;
  /** Minor units per major unit as a power of ten: 2 → 100 cents to the dollar; 0 → no subunit. */
  decimals: number;
  /**
   * Display template. Placeholders: `{sign}`, `{symbol}`, `{code}`, `{amount}` (the major amount
   * with `decimals` places and thousands separators), `{major}` (whole major units, separated),
   * `{minor}` (the remaining minor units). Modern US: `"{sign}{symbol}{amount}"`; a coin world:
   * `"{sign}{major} sp {minor} cp"`.
   */
  format: string;
}

/** Modern US, and the default for documents written before `currency` existed. */
export const DEFAULT_CURRENCY: WorldCurrency = { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" };

/** Characters replies may introduce in a world that sets no `spawnCap`. */
export const DEFAULT_SPAWN_CAP = 24;
/** The most a world's `spawnCap` allows: each newcomer is a whole entity every fold carries and the helpers' prompts may list. */
export const MAX_SPAWN_CAP = 500;

/** The spawn cap a world plays by: its own, as a whole number from 0 to `MAX_SPAWN_CAP` (lint reports one outside), else the default. */
export function spawnCapOf(world: Pick<WorldDoc, "spawnCap">): number {
  const cap: unknown = world.spawnCap;
  return typeof cap === "number" && Number.isFinite(cap) ? Math.max(0, Math.min(MAX_SPAWN_CAP, Math.trunc(cap))) : DEFAULT_SPAWN_CAP;
}

/** A life state's id: `alive`, `dying`, `dead`, or one the world defines (DESIGN §8). */
export type LifeStateId = string;

/** A life state (DESIGN §8): how players and the narrator read it, and whether someone in it still acts. */
export interface LifeStateDef {
  label: string;
  /** Whether someone in this state still acts: follows schedules and day plans, chooses, takes combat turns. */
  acts: boolean;
  /** How the narrator reads someone in it, after their name: "lies dead", "is dying". */
  reads: string;
}

/** The life state everyone is in unless the world or play says otherwise. */
export const ALIVE: LifeStateId = "alive";

/** The built-in life states. A world adds its own beside them (`WorldDoc.lifeStates`) and can't redefine these. */
export const BUILTIN_LIFE_STATES: Readonly<Record<string, LifeStateDef>> = {
  alive: { label: "Alive", acts: true, reads: "is alive" },
  dying: { label: "Dying", acts: false, reads: "is dying" },
  dead: { label: "Dead", acts: false, reads: "lies dead" },
};

/** A world's own life state as the engine reads it: a missing label is its id, a missing reading "is <label>", and only `acts: true` acts. */
function ownLifeState(id: LifeStateId, raw: unknown): LifeStateDef {
  const def = isRecord(raw) ? raw : {};
  const label = typeof def.label === "string" && def.label.trim() !== "" ? def.label : id.replace(/_/g, " ");
  return { label, acts: def.acts === true, reads: typeof def.reads === "string" && def.reads.trim() !== "" ? def.reads : `is ${label.toLowerCase()}` };
}

/** Every life state a world has: the built-ins, then its own in id order (one that reuses a built-in's id is the built-in, and lint flags it). */
export function lifeStatesOf(world: Pick<WorldDoc, "lifeStates">): [LifeStateId, LifeStateDef][] {
  const own = isRecord(world.lifeStates) ? Object.keys(world.lifeStates).filter((id) => !hasOwn(BUILTIN_LIFE_STATES, id)).sort() : [];
  return [...Object.entries(BUILTIN_LIFE_STATES), ...own.map((id): [LifeStateId, LifeStateDef] => [id, ownLifeState(id, world.lifeStates?.[id])])];
}

/** Whether a world has this life state. */
export function isLifeState(world: Pick<WorldDoc, "lifeStates">, id: LifeStateId): boolean {
  return hasOwn(BUILTIN_LIFE_STATES, id) || (isRecord(world.lifeStates) && hasOwn(world.lifeStates, id));
}

/**
 * A life state's definition. One the world no longer has (an Upgrade dropped it while someone was
 * in it) reads as its id and doesn't act: an unknown state never sets anyone acting again.
 */
export function lifeStateOf(world: Pick<WorldDoc, "lifeStates">, id: LifeStateId): LifeStateDef {
  const builtIn = hasOwn(BUILTIN_LIFE_STATES, id) ? BUILTIN_LIFE_STATES[id] : undefined;
  if (builtIn) return builtIn;
  if (isRecord(world.lifeStates) && hasOwn(world.lifeStates, id)) return ownLifeState(id, world.lifeStates[id]);
  const label = id.replace(/_/g, " ");
  return { label, acts: false, reads: `is ${label}` };
}

function grouped(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A temperature as the player and narrator read it, in whole °F, from the °C the world stores (`formatTemperature(12)` → `"54 °F"`). */
export function formatTemperature(celsius: number): string {
  return `${Math.round((celsius * 9) / 5 + 32)} °F`;
}

/** Formats integer minor units with a world's currency (`formatMoney(123456, DEFAULT_CURRENCY)` → `"$1,234.56"`). */
export function formatMoney(minorUnits: number, currency: WorldCurrency): string {
  const units = BigInt(Math.trunc(minorUnits));
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const decimals = Math.max(0, Math.min(6, Math.trunc(currency.decimals)));
  const scale = 10n ** BigInt(decimals);
  const major = abs / scale;
  const minor = abs % scale;
  const amount = decimals > 0 ? `${grouped(major)}.${minor.toString().padStart(decimals, "0")}` : grouped(major);
  const values: Record<string, string> = { sign: negative ? "-" : "", symbol: currency.symbol, code: currency.code, amount, major: grouped(major), minor: minor.toString() };
  return currency.format.replace(/\{(sign|symbol|code|amount|major|minor)\}/g, (_, key: string) => values[key] ?? "");
}

/** How one revision became a world's head (DESIGN §23). */
export interface RevisionNote {
  revision: string;
  /** When it became head, in ms since the epoch. */
  at: number;
  /** What made it head: a new world, a commit from Build or from an outside agent, or an import. */
  source: "create" | "build" | "agent" | "import";
  /** The note given with the commit, if any (at most 200 characters). */
  note?: string;
}

/** `userStorage/worlds/<worldId>/index.json`. */
export interface WorldIndex {
  id: WorldId;
  name: string;
  head: string;
  loreBookId: string | null;
  revisions: string[];
  /**
   * The version of the world's working copy while no draft is stored (DESIGN §23): the next one
   * after the last discard or commit. A new draft starts one above it; absent until
   * the first. The world's history is kept beside the index (`history.json`), not in it.
   */
  draftVersion?: number;
}
