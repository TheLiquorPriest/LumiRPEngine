// The core registry contract for packs (DESIGN §3 Modules, §9.2 level contracts; ARCHITECTURE §7).
//
// A pack is a pure `core` plus a `ui`. Its core default-exports a PackDef whose `register`
// receives a CoreRegistry and declares everything the pack contributes. Packs never import
// another pack's internals: cross-pack behavior goes through services and queries, typed by
// declaration merging on ServiceMap and QueryMap:
//
//   declare module "../../../engine/registry" {
//     interface ServiceMap { "economy.charge": ChargeService }
//   }
//
// All functions here are pure: same inputs, same outputs; randomness only from the Rng passed in.

import type { JsonObject, JsonValue } from "../shared/json";
import type { DomainId, EntityId, FieldId, Level, PackId, PanelId, RelationTypeId, SlotId, TableId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { LintIssue } from "../shared/protocol";
import type { ColumnDef, DataTable } from "../shared/tables";
import type { ActionDef, EffectSpec, FeedScope, FieldType, KindDef, MapDisplay, RelationTypeDef, RuleDef, ScheduleDef, WorldDoc } from "../shared/world";
import type { Value } from "./expr";
import type { Registry } from "./registry-impl";
import type { Rng } from "./rng";
import type { WorldState } from "./state";

/** Cross-pack services, merged by packs. Behavior is defined at every level (DESIGN §9.2). */
export interface ServiceMap {}

/** Level-independent query functions, merged by packs; also callable from formulas. */
export interface QueryMap {}

export interface Rejection {
  code: string;
  /** Why, as the player may read it: a refusal that would name someone the POV can't see words them as "someone" (DESIGN §7). */
  reason: string;
  /** The raw reason, naming everyone, when `reason` leaves someone out: for the GM view only. */
  gm?: string;
  /**
   * A refusal the player mustn't learn of, since no living person would get one (a body the POV
   * doesn't know is one, DESIGN §8): the change comes back as one that changed nothing, and only the
   * log says why (`gm`).
   */
  unseen?: true;
}

/** Read access to the pinned tables of the world revision in force. */
export interface TableReader {
  get(id: TableId): DataTable | undefined;
}

/** Everything a pure engine function may read. */
export interface ReadContext {
  /** The frozen registry (formulas, kinds, schedules, nested effects). */
  readonly registry: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  tables: TableReader;
  /** Effective level: the per-entity override, else min(domain level, the cap of the band its tier maps to); the POV is never capped (DESIGN §9.1). */
  levelOf(entity: EntityId, domain: DomainId): Level;
  service<K extends keyof ServiceMap>(name: K): ServiceMap[K];
  query<K extends keyof QueryMap>(name: K): QueryMap[K];
}

/**
 * Part of an entity's definition an applied event writes (DESIGN §4.3, the touched record): one of
 * its fields, one relation (by type and target), its tier, agent flag, level overrides, classes
 * and tags or life state, the entity itself when play created it, or an account's balance. Names
 * only, never values.
 */
export type Touch =
  | { entity: EntityId; field: FieldId }
  | { entity: EntityId; rel: RelationTypeId; to: string }
  | { entity: EntityId; aspect: TouchAspect };

export type TouchAspect = "tier" | "agent" | "levels" | "class" | "life" | "spawned" | "posted" | "name";

/** A registered event type: validation against the state before it, and its reducer. */
export interface EventTypeDef<E extends LedgerEvent = LedgerEvent> {
  type: E["type"];
  /** Null when the event may apply to this state; a rejection otherwise (re-validation drops it). */
  validate(event: E, ctx: ReadContext): Rejection | null;
  /** Applies the event to the working state. Must be total for any event `validate` accepted. */
  apply(event: E, state: WorldState, ctx: ReadContext): void;
  /**
   * One-line description, filtered by visibility by the caller. `viewer` is the POV a player's line
   * is worded for, so a describer can leave out what it can't see; it is absent for the GM's and
   * the author's lines, which name everything.
   */
  describe(event: E, ctx: ReadContext, viewer?: EntityId): string;
  /**
   * Record coarsening (DESIGN §4.3, L21): events of this type with the same non-null key, in one
   * timelapse or catch-up record, merge into one concrete event at the last one's position.
   * `merge` must keep the fold exact.
   */
  coarsen?: { key(event: E): string | null; merge(earlier: E, later: E): E };
  /**
   * What the event writes of entities' definitions, when its reducer writes any directly (fields,
   * relations, tier, agent, levels, a new entity, a balance). The registry records it after every
   * apply in the touched record, so an Upgrade never takes a revision's value over one play wrote.
   */
  touches?(event: E): Touch[];
}

/** An extra validation on an event type (`CoreRegistry.guard`). */
export interface EventGuardDef<E extends LedgerEvent = LedgerEvent> {
  type: E["type"];
  /** Null when the event may apply as far as this pack is concerned. Never changes state. */
  validate(event: E, ctx: ReadContext): Rejection | null;
}

export interface EffectContext extends ReadContext {
  rng: Rng;
  /** Evaluated action parameters. */
  params: Record<string, Value>;
}

/** Turns a validated effect proposal into concrete events. */
export interface EffectDef {
  type: string;
  /** The arguments it reads, by name, `?` marking one it can do without (the authors' reference lists them). */
  args: readonly string[];
  /**
   * A GM edit may run it (`lre.edit` op `effect`), with literal arguments: a GM control that changes
   * something no entity field holds, such as an asset's price. Effects without it are never offered there.
   */
  gm?: true;
  resolve(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection;
}

/**
 * One fact of a section as a scope beyond the player's gives it (DESIGN §6.11). `known`: who knows
 * it, `pov` (the player character: a plain line), `scene` (only people with him: `who` names them
 * as the narrator may know them) or `gm` (no one there). `group`: the fact the line tells part of,
 * when it is told in several lines (Who knows what's: who holds it and who doesn't know it); a
 * section keeps such lines together and keeps or leaves them out whole.
 */
export interface FeedLine {
  text: string;
  known: "pov" | "scene" | "gm";
  who?: string;
  /**
   * A secret kept from the player character (DESIGN §24.11): who knows it and whom it is kept from.
   * The narrator gets it marked so, in the secret mark's wording, or not at all, as its knowledge
   * says (`secretLineText`); never in the player scope.
   */
  secret?: { keptFrom: EntityId[] | "everyone"; known?: EntityId[] };
  group?: string;
}

export interface SectionRenderer {
  slot: SlotId;
  /**
   * The name a section's `include` picks it by (DESIGN §6.11); absent, its slot. A section without
   * `include` takes every renderer of its own slot, whatever their sources.
   */
  source?: string;
  /** What it tells, in the GM's plain words ("What people here wear and carry"): its name where a section's sources are picked. */
  label?: string;
  /**
   * Its lines are hints that follow what the POV doesn't know (Stance's cues, DESIGN §6.6): they ride
   * once every section has its place on the section budget, in what is left, and no size, clip or
   * total the player sees counts them, so an off-screen change never shows there.
   */
  hint?: true;
  /** Compact lines, at most one per fact; dynamic values never contain `{{` or `}}` (DESIGN §6.3). The player scope's, and every player surface's. */
  render(ctx: ReadContext): string[];
  /**
   * Its lines for a section's scope (DESIGN §6.11), for the narrator only: the player scope's facts
   * as `pov` lines, and in `scene` and `gm` the ones beyond them, each marked with who knows it.
   * Absent, `render` speaks for every scope.
   */
  feed?(ctx: ReadContext, scope: FeedScope): FeedLine[];
}

export interface MaterializerDef {
  domain: DomainId;
  /** The generator a new world pins. */
  version: number;
  /** Every generator version this build still carries (DESIGN §9.2 pinned versions); just `version` when absent. */
  versions?: readonly number[];
  /** Samples detail within the entity's current representation (DESIGN §9.2), as the world's pinned generator does. */
  materialize(entity: EntityId, ctx: ReadContext, rng: Rng, version: number): LedgerEvent[];
}

export interface SlotInfo {
  /** Slot start, minutes since epoch. */
  start: number;
  end: number;
  index: number;
  /**
   * False while the story holds the POV in this step (DESIGN §8, §9.2): an ordinary turn and its
   * catch-up, a span the player's words spend doing something, or a narrated time skip. The POV's own
   * routine doesn't move it then, and a scene with it holds whoever is in it. Absent: time runs on its
   * own (a timelapse): the POV follows its routine and no scene holds anyone.
   */
  povRoutine?: boolean;
  /**
   * True in a Timelapse (time skipped, not played): an off-screen Background agent lives their day at
   * slot steps only, as net state, and the cast the story is about is held only while with the POV
   * (DESIGN §8, §24.1).
   */
  timelapse?: boolean;
  /**
   * The span the run stepping this slot passes: where `advance` started and the minute it runs to.
   * A slot it catches someone up through, or the part of one before it started, was played in
   * ordinary turns, so only the story knows what they did then (the POV's lived needs read only
   * inside it, DESIGN §8). Absent: the whole slot.
   */
  run?: { from: number; to: number };
}

/** A moment inside a slot at which an agent process acts between its slot steps (`ProcessDef.instants`). */
export interface AgentInstant {
  at: number;
  /** What the process does then, as it reads it back in `atInstant`. */
  key: string;
  /**
   * A moment at the run's own start, which no earlier run could reach: it happens when a run starts
   * exactly there, before anything else in it, even on a slot's first minute (where moments otherwise
   * fall to the slot step before). A run starting anywhere else passes it over.
   */
  opens?: true;
}

/**
 * A recurring process stepped per schedule slot with a process seed (DESIGN §4.3 seeds). A `world`
 * process (the default) steps once per slot; an `agent` process steps once per LOD1 agent under the
 * engine's catch-up queue, with that agent as `agent`.
 */
export interface ProcessDef {
  id: string;
  domain: DomainId;
  /** Lowest effective level at which the process runs for an entity. */
  minLevel: Level;
  scope?: "world" | "agent";
  step(slot: SlotInfo, ctx: ReadContext, rng: (entity: EntityId) => Rng, agent?: EntityId): LedgerEvent[];
  /**
   * An agent process's moments strictly inside a slot (DESIGN §8): the blocks of a character's day
   * starting between slot steps, their own plans' starts and ends among them (§24.8). They apply at
   * their time among the schedule edges, in a turn and in a timelapse, to an agent stepped through
   * the slot before; catch-up has none. `slot.povRoutine` says whether the POV's routine runs. Read
   * from a state the slot's other moments may have changed already, so they must not depend on the
   * clock or on what moments change: a segment that starts mid-slot then gets the same ones.
   */
  instants?(ctx: ReadContext, agent: EntityId, slot: SlotInfo): AgentInstant[];
  /** What the process does at one of its instants, at that instant's clock, in the slot it falls in (`slot.povRoutine`: whether the story holds the POV). */
  atInstant?(ctx: ReadContext, agent: EntityId, instant: AgentInstant, slot: SlotInfo): LedgerEvent[];
  /**
   * What the POV lived through the ordinary time of a turn (`span`, a turn-mode advance; DESIGN §8),
   * read as that time ends: what the time itself gave, not what an action did. No slot step reads it:
   * a turn steps no one but the agents it catches up, never the POV, and a later skip passes over it
   * (`SlotInfo.run`), so this is the only reading.
   */
  lived?(ctx: ReadContext, agent: EntityId, span: { from: number; to: number }): LedgerEvent[];
  /**
   * What an activity met as its span ended within a turn's time (`activity`, ending at `until`;
   * DESIGN §9.2), read for the player character at that end: the span an action of the turn gave it,
   * as part of that action, so an Undo of it takes this too; or one an earlier turn began that they
   * are still doing, where they began it, as this turn's time saw it out.
   */
  ended?(ctx: ReadContext, agent: EntityId, activity: { type: string; until: number }): LedgerEvent[];
}

/** A pack's default table and its column contract (ARCHITECTURE §6). */
export interface TableDef {
  id: TableId;
  schema: string;
  columns: Record<string, ColumnDef>;
  defaults: DataTable | null;
}

/**
 * A model-proposal channel (DESIGN §9.4). A type's mode resolves per `ExtractionLearning` in
 * shared/settings: the player's pin, then the mode learned on the turn's connection, then the D4
 * cold-start default (`EXTRACTION_DEFAULTS`), then the bound.
 */
export interface ProposalChannelDef {
  /** Proposal type, e.g. `purchase`, `regard`, `time_advance`. */
  type: string;
  /** The field type whose bound applies (`knowledge`: none, the knowledge step's own types). */
  boundField: FieldType | "spawn" | "knows" | "life" | "routine" | "knowledge";
  validate(proposal: JsonObject, ctx: ReadContext): Rejection | null;
  toEffects(proposal: JsonObject, ctx: ReadContext): EffectSpec[];
  /**
   * The entity and field the proposal changes, when that isn't its own `entity` and `field` (a
   * thing's count, its condition): their bound in Build and their range apply to it (DESIGN §11).
   * Null when the proposal names nothing that is there.
   */
  boundTarget?(proposal: JsonObject, ctx: ReadContext): { entity: EntityId; field: FieldId } | null;
}

export interface LintRule {
  code: string;
  /** `registry` is the frozen registry the world lints against (absent where a caller runs one rule on its own). */
  check(world: WorldDoc, registry?: Registry): LintIssue[];
}

/** How the player chose to see a chat (kept beside it, never in its ledger): what a panel is drawn for. */
export interface ViewPrefs {
  /** The map's display the player picked for this chat; null follows the world's `mapSettings.display`. */
  mapDisplay: MapDisplay | null;
}

/** Builds a pack panel's view model (pure; the frontend renders it). */
export interface PanelViewDef {
  panel: PanelId;
  build(ctx: ReadContext, prefs: ViewPrefs): JsonValue;
}

export interface CoreRegistry {
  kind(def: KindDef): void;
  relation(def: RelationTypeDef): void;
  event<E extends LedgerEvent>(def: EventTypeDef<E>): void;
  /**
   * A state-dependent check a pack adds to any event type, core ones included (funds on a `post`):
   * the event validates only when its own check and every guard pass, so a rebased view
   * re-validates against the pack's rules too (DESIGN §4.3).
   */
  guard<E extends LedgerEvent>(def: EventGuardDef<E>): void;
  effect(def: EffectDef): void;
  service<K extends keyof ServiceMap>(name: K, impl: ServiceMap[K]): void;
  query<K extends keyof QueryMap>(name: K, impl: QueryMap[K]): void;
  /** Exposes a query to formulas under `name`. */
  formula(name: string, fn: (ctx: ReadContext, ...args: Value[]) => Value): void;
  renderer(def: SectionRenderer): void;
  action(def: ActionDef): void;
  rule(def: RuleDef): void;
  schedule(def: ScheduleDef): void;
  table(def: TableDef): void;
  materializer(def: MaterializerDef): void;
  process(def: ProcessDef): void;
  proposal(def: ProposalChannelDef): void;
  lint(rule: LintRule): void;
  view(def: PanelViewDef): void;
}

export interface PackDef {
  id: PackId;
  label: string;
  /** Pack format version; worlds record the version they were authored against. */
  version: number;
  /** The realism domain the pack implements, or null (Story, Sheets core). */
  domain: DomainId | null;
  requires: PackId[];
  register(registry: CoreRegistry): void;
}
