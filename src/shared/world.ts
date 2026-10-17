// The world document `lre-world-v1` (DESIGN §3, §4.1, §9, §10, §11; ARCHITECTURE §3).
//
// One JSON document per world revision. Formulas are strings in the safe expression language
// (`engine/expr`), dice are notation strings (`engine/dice`). Every collection is keyed by id.
// Packs extend kinds, relations, actions, rules, schedules and tables; the shape itself never
// changes with realism level (D18: levels gate processes, rendering and extraction only).

import type { JsonObject, JsonValue } from "./json";
import type {
  ActionId,
  ActivityType,
  Band,
  BoundMode,
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
  PackId,
  PlaceId,
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
  TrackId,
  TravelMode,
  Visibility,
  WorldId,
} from "./ids";
import type { DataTable } from "./tables";

export const WORLD_FORMAT = "lre-world-v1";

/** The engine version stamped on documents it writes (`WorldDoc.engineVersion`). */
export const ENGINE_VERSION = "0.1.0";

/** An expression in the safe formula language. */
export type Expr = string;
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

export interface FieldDef {
  type: FieldType;
  label?: string;
  default?: JsonValue;
  min?: number;
  max?: number;
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

export type Cardinality = "one_one" | "one_many" | "many_one" | "many_many";

/** Built-in relation types (DESIGN §3 feature mapping). */
export const BUILTIN_RELATIONS = ["in", "owns", "uses", "worn_by", "equipped", "knows", "member_of", "regard", "route"] as const;

export interface RelationTypeDef {
  id: RelationTypeId;
  label: string;
  /** Allowed source and target kinds; `*` allows any. */
  from: KindId | "*";
  to: KindId | "*";
  cardinality: Cardinality;
  symmetric: boolean;
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
  /** Lumiverse character id, for group chats. */
  characterId?: string;
  visibility?: Visibility;
  tags?: string[];
  /** Classification values by facet (`WorldDoc.classifications`); a single-valued facet holds at most one. Read live from the world. */
  class?: Record<FacetId, FacetValueId[]>;
  /** Import from lore (DESIGN §9.7): the `bookId/entryId` entries this came from; never edited. */
  sources?: string[];
  /** What the engine filled in rather than the lore, for review (DESIGN §9.7 "assumed"): fields from a data table, and `kind` when the lore named none. */
  assumed?: string[];
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
}

/**
 * Which entities something applies to. Every constraint given must hold; a list matches any of
 * its values; an empty selector matches every entity. Classes and tags are read live from the
 * world (definitional); kind follows inheritance; tier and group membership come from state.
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
  fields: JsonObject;
  visibility?: Visibility;
  /** Import from lore (DESIGN §9.7): the `bookId/entryId` entries this came from; never edited. */
  sources?: string[];
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
}

// ---------------------------------------------------------------- rules, actions, checks

/** An effect proposal. Its type is registered by the engine or a pack; args are values or formulas. */
export interface EffectSpec {
  type: string;
  args: Record<string, JsonValue>;
}

export type RuleTrigger =
  | { event: EventType }
  | { tick: "turn" | "slot" | "day" }
  | { enter: PlaceId }
  | { at: Expr };

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
}

export interface CheckBand {
  outcome: string;
  /** Inclusive range on the check total. */
  min?: number;
  max?: number;
}

/** The one check mechanism: a dice expression plus outcome bands, with exact odds. */
export interface CheckDef {
  id: CheckId;
  dice: DiceExpr;
  modifier?: Expr;
  bands: CheckBand[];
}

export interface ActivitySpec {
  type: ActivityType;
  /** When the activity ends: a formula over the scene (`until 07:00`, the shift's end, arrival). */
  until: Expr;
}

export interface ActionDef {
  id: ActionId;
  label: string;
  params: Record<string, ParamDef>;
  requires: Expr[];
  /** Inline check or a reference to `checks`. */
  check?: CheckId | CheckDef;
  /** Effects per check outcome; `default` when there is no check. */
  outcomes: Record<string, EffectSpec[]>;
  /** Duration in minutes. */
  duration: Expr;
  activity?: ActivitySpec;
  /** Verbs and phrases for the typed-input classifier. */
  lexicon?: string[];
  /** The label other characters can observe (no secrets; linted). */
  observable?: string;
  pack?: PackId;
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
}

/** Calendar recurrence plus a slot table: shifts, routines, weather, bills, paydays, price paths. */
export interface ScheduleDef {
  id: ScheduleId;
  /** The entity or kind the schedule applies to; absent for world processes (weather, prices). */
  owner?: EntityId | KindId;
  /** The field or relation the slot value sets (`place`, `activity`, `weather`, …). */
  target: string;
  recurrence: Recurrence;
  slots: ScheduleSlot[];
  pack?: PackId;
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

/** A slot section in the engine-managed lore book (DESIGN §4.2, §6.3). */
export interface SectionTemplate {
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
  | "contradiction"
  | "puzzle.answer"
  | "brief"
  | "outline"
  | "extract"
  | "choices";

/** A world-authored prompted or decision step template (DESIGN §5.2). */
export interface StepTemplateDef {
  id: StepTemplateId;
  purpose: StepPurpose;
  template: string;
  output: "text" | "effects" | "decision";
  signals: string[];
}

/**
 * World lore (DESIGN §4.2): what the world knows, authored in Build or imported with a world. It is
 * kept in the world document and not delivered to the narrator yet; the engine-managed book holds
 * slots only. Lore holds cue text only: a secret's truth lives in its track, never here (linted).
 */
export interface LoreEntryDef {
  id: string;
  title: string;
  content: string;
  /** Keywords the entry answers to (never host World Info keys). */
  keys: string[];
  /** Entity and place ids the entry is about (back-links). */
  links: string[];
  /** Entries sharing a group are alternatives to each other. */
  group?: string;
  /** Higher comes first among otherwise equal entries. */
  priority?: number;
  /** Secret lore is gated: it may be shown only while `gate` holds. */
  secret?: boolean;
  gate?: Expr;
}

export type SuppressedSource =
  | { bookId: string; entryId: string }
  | { bookId: string; comment: string; contentHash: string };

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
  rules: Record<RuleId, RuleDef>;
  actions: Record<ActionId, ActionDef>;
  checks: Record<CheckId, CheckDef>;
  calendar: CalendarDef;
  schedules: Record<ScheduleId, ScheduleDef>;
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
  /** Classification facets by id (DESIGN §4.1); entities hold values in `class`. */
  classifications: Record<FacetId, FacetDef>;
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

function grouped(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

/**
 * The `lre-state-v1` window event payload (DESIGN §15): the frontend announces it so a studio can
 * discover the engine. `inbound` lists the install paths offered (`"file"`, `"rpc:<endpoint>"`).
 */
export interface StudioState {
  engineVersion: string;
  worldFormat: typeof WORLD_FORMAT;
  packs: Record<string, number>;
  inbound: string[];
}

/** `userStorage/worlds/<worldId>/index.json`. */
export interface WorldIndex {
  id: WorldId;
  name: string;
  head: string;
  loreBookId: string | null;
  revisions: string[];
}
