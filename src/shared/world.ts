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
  /** Free-form labels selectors match (`tag`). Read live from the world. */
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
  /** A ref param's candidates must also match this selector: the palette offers only those, and the resolver refuses others. */
  of?: Selector;
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

// ---------------------------------------------------------------- ruleset

/**
 * A progression (DESIGN §11): experience in one field, the level in another, and the thresholds
 * between them. After an effect changes an entity's XP, the engine raises its level to the last
 * threshold reached, one level at a time, running `onLevel` for each.
 */
export interface ProgressionDef {
  label: string;
  /** The number field that holds experience. */
  xpField: FieldId;
  /** The number field that holds the level; the engine sets it. */
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

/**
 * A world's tabletop ruleset (DESIGN §11): progression, the sheet layout and the realism floors its
 * math needs. Every key is optional; later parts of the ruleset add their own keys to this interface.
 */
export interface RulesetDef {
  progression?: Record<ProgressionId, ProgressionDef>;
  sheet?: SheetLayoutDef;
  /** The lowest effective level each domain plays at, whatever the realism settings: stat modifiers need Sheets 3. */
  minLevels?: Partial<Record<DomainId, Level>>;
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
