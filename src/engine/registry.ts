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
import type { DomainId, EntityId, Level, PackId, PanelId, SlotId, TableId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { LintIssue } from "../shared/protocol";
import type { ColumnDef, DataTable } from "../shared/tables";
import type { ActionDef, EffectSpec, FieldType, KindDef, RelationTypeDef, RuleDef, ScheduleDef, WorldDoc } from "../shared/world";
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
  reason: string;
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

/** A registered event type: validation against the state before it, and its reducer. */
export interface EventTypeDef<E extends LedgerEvent = LedgerEvent> {
  type: E["type"];
  /** Null when the event may apply to this state; a rejection otherwise (re-validation drops it). */
  validate(event: E, ctx: ReadContext): Rejection | null;
  /** Applies the event to the working state. Must be total for any event `validate` accepted. */
  apply(event: E, state: WorldState, ctx: ReadContext): void;
  /** Player-facing one-line description, filtered by visibility by the caller. */
  describe(event: E, ctx: ReadContext): string;
  /**
   * Record coarsening (DESIGN §4.3, L21): events of this type with the same non-null key, in one
   * timelapse or catch-up record, merge into one concrete event at the last one's position.
   * `merge` must keep the fold exact.
   */
  coarsen?: { key(event: E): string | null; merge(earlier: E, later: E): E };
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
  resolve(args: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection;
}

export interface SectionRenderer {
  slot: SlotId;
  /** Compact lines, at most one per fact; dynamic values never contain `{{` or `}}` (DESIGN §6.3). */
  render(ctx: ReadContext): string[];
}

export interface MaterializerDef {
  domain: DomainId;
  version: number;
  /** Samples detail within the entity's current representation (DESIGN §9.2). */
  materialize(entity: EntityId, ctx: ReadContext, rng: Rng): LedgerEvent[];
}

export interface SlotInfo {
  /** Slot start, minutes since epoch. */
  start: number;
  end: number;
  index: number;
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
  /** The field type whose bound applies. */
  boundField: FieldType | "spawn" | "knows";
  validate(proposal: JsonObject, ctx: ReadContext): Rejection | null;
  toEffects(proposal: JsonObject, ctx: ReadContext): EffectSpec[];
}

export interface LintRule {
  code: string;
  check(world: WorldDoc): LintIssue[];
}

/** Builds a pack panel's view model (pure; the frontend renders it). */
export interface PanelViewDef {
  panel: PanelId;
  build(ctx: ReadContext): JsonValue;
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
