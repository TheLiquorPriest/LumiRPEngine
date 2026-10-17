// User-owned settings, `userStorage/settings.json` (DESIGN §4.1, §5.3, §9.1, §9.2).
// Settings seed new chats only; a running chat changes through markers. Every conservative
// default is one tap to change (D31).

import type { BoundMode, DomainId, InterruptClass, InterruptPolicy, Level, ModelUsePresetId, RealismPresetId, SceneTypeId, Tier } from "./ids";
import type { StepPurpose } from "./world";

/** Where a model step runs. `decision` uses `decisions.evaluate`; `helper` a helper JSON call. */
export interface StepRoute {
  provider: "decision" | "helper";
  connectionId: string | null;
  model: string | null;
}

export interface StepConfig {
  enabled: boolean;
  /** Signals that trigger the step (DESIGN §5.2). */
  signals: string[];
  route?: StepRoute;
  template?: string;
  maxTokens?: number;
}

export interface PhaseBudget {
  calls: number;
  ms: number;
}

export interface ModelUseSettings {
  preset: ModelUsePresetId;
  steps: Partial<Record<StepPurpose, StepConfig>>;
  budgets: { pre: PhaseBudget; select: PhaseBudget; post: PhaseBudget };
  /** Engine budget in tokens: sections plus lore (DESIGN §5.3). */
  tokens: { sections: number; lore: number };
}

export interface RealismSettings {
  preset: RealismPresetId;
  levels: Record<DomainId, Level>;
  tierCaps: Record<Exclude<Tier, "pov">, Partial<Record<DomainId, Level>>>;
}

export interface TimeSettings {
  sceneTicks: Record<SceneTypeId, number>;
  scale: number;
  interrupts: Record<InterruptClass, InterruptPolicy>;
  speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
  montage: "key" | "day" | "week";
  unitCap: { agentDays: number; events: number };
  npcCallsPerTimelapse: number;
}

/** Extraction proposal types with a per-type mode (DESIGN §9.4, §11). */
export const EXTRACTION_TYPES = ["time_advance", "location", "condition", "knows", "give", "purchase", "transfer", "regard", "quantity", "spawn"] as const;
export type ExtractionType = (typeof EXTRACTION_TYPES)[number];

/**
 * D4: per-type cold-start modes. These are only the start: per-connection learning
 * (ExtractionLearning) promotes a type to `auto` at ≥ 0.90 acceptance over at least 30
 * confirm/undo outcomes. `quantity` keeps its field bounds' mode.
 */
export const EXTRACTION_DEFAULTS: Readonly<Partial<Record<ExtractionType, BoundMode>>> = Object.freeze({
  time_advance: "auto",
  location: "auto",
  condition: "auto",
  regard: "confirm",
  transfer: "confirm",
  spawn: "confirm",
  knows: "confirm",
  give: "confirm",
  purchase: "confirm",
});

/**
 * D4 learning (from D31): promotion learns on the player's own connection. Outcomes come
 * from the confirm and undo chips only: no new surface, no model calls.
 */
export const EXTRACTION_LEARNING = Object.freeze({
  /** Acceptance a type needs on a connection to flip from `confirm` to `auto`. */
  promoteAt: 0.9,
  /** Outcomes a type needs on a connection before it can flip. */
  minProposals: 30,
  /** The rolling window of latest outcomes that promotion and demotion read. */
  window: 30,
  /** An `auto` type flips back to `confirm` when the window's undo rate exceeds this. */
  demoteUndoRate: 0.1,
});

/** User overrides per type. A set type is pinned: learning still counts it but never flips it. */
export type ExtractionBounds = Partial<Record<ExtractionType, { mode: BoundMode; maxDelta?: number }>>;

/**
 * One type's outcomes on one connection. A proposal counts once: `a` when confirmed, or applied
 * automatically and not undone by the next turn's commit; `r` when rejected or undone.
 */
export interface ExtractionTypeStats {
  accepted: number;
  rejected: number;
  /** The latest outcomes, oldest first, at most `EXTRACTION_LEARNING.window` letters of `a` or `r`. */
  recent: string;
  /** The learned mode; absent while the cold-start default applies. */
  learned?: BoundMode;
  /** When `learned` last changed (epoch ms); its notification chip shows once. */
  changedAt?: number;
  /** The player undid a flip: no flip until `accepted + rejected` reaches this. */
  holdUntil?: number;
}

/**
 * `userStorage/extraction-learning.json`, beside settings.json: per connection id (the connection
 * the extract step ran on), per type. A type's mode resolves as: pinned in `UserSettings.extraction`,
 * then `learned` here for the turn's connection, then EXTRACTION_DEFAULTS, then its field bound.
 */
export interface ExtractionLearning {
  v: 1;
  connections: Record<string, Partial<Record<ExtractionType, ExtractionTypeStats>>>;
}

export interface UserSettings {
  v: 1;
  modelUse: ModelUseSettings;
  realism: RealismSettings;
  time: TimeSettings;
  extraction: ExtractionBounds;
  swipeDefault: "rerun" | "renarrate";
  passThroughBooks: string[];
}
