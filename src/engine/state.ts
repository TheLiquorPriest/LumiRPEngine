// The folded world state (ARCHITECTURE §3.3). Plain JSON, so two folds compare with
// `hashJson` and re-convergence is keyed by state hash. Event reducers mutate a working copy;
// nothing else writes state. Derived fields and balances are never stored here: they are
// computed by query functions at read time.

import type { JsonObject, JsonValue } from "../shared/json";
import type { Band, DomainId, EntityId, InterruptClass, InterruptPolicy, KindId, Level, PackId, RevisionId, SceneTypeId, StageId, TierId, TrackId } from "../shared/ids";
import type { AdjudicationDef, FacetId, FacetValueId, RelationInstance } from "../shared/world";

export interface EntityState {
  kind: KindId;
  name: string;
  /** The entity's tier; the world maps it to a band when levels are read (DESIGN §9.1). */
  tier: TierId;
  fields: JsonObject;
  relations: RelationInstance[];
  levels: Partial<Record<DomainId, Level>>;
  agent: boolean;
  /**
   * A spawned entity's classes and tags, as its spawn gave them. Entities the world defines read
   * theirs live from the world instead, so these are absent for them.
   */
  class?: Record<FacetId, FacetValueId[]>;
  tags?: string[];
}

export interface TrackState {
  stage: StageId;
  since: number;
}

/** Realism as folded from the world defaults and `resolve` markers: levels, and caps per detail band. */
export interface RealismState {
  levels: Record<DomainId, Level>;
  tierCaps: Record<Band, Partial<Record<DomainId, Level>>>;
}

/** Time controls as folded from the world defaults, starting markers and `time` markers. */
export interface TimeState {
  sceneTicks: Record<SceneTypeId, number>;
  scale: number;
  paused: boolean;
  interrupts: Record<InterruptClass, InterruptPolicy>;
  speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
  montage: "key" | "day" | "week";
  unitCap: { agentDays: number; events: number };
  npcCalls: number;
}

export interface WorldState {
  /** The world revision in force (the latest `migrate` marker). */
  revision: RevisionId;
  /** Minutes since the world epoch. */
  clock: number;
  entities: Record<EntityId, EntityState>;
  /** Posting totals per account, in cents. Balances are these totals; the trial balance sums to 0 (L22). */
  accounts: Record<EntityId, number>;
  tracks: Record<TrackId, TrackState>;
  realism: RealismState;
  time: TimeState;
  /** The adjudication policy an `adjudicate` marker set (DESIGN §11); absent, the world's ruleset decides. */
  adjudication?: AdjudicationDef;
  /** First materialization per `<entityId>:<domain>`, with its pins (L24, L25). */
  materialized: Record<string, { generatorVersion: number; tablesRevision: string }>;
  /** Pack-owned state slices, keyed by pack id. */
  packs: Record<PackId, JsonObject>;
}

/** Read-only scalar lookup used by formulas and queries. */
export type FieldLookup = (entity: EntityId, field: string) => JsonValue | undefined;
