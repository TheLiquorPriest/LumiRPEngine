// User-owned settings, `userStorage/settings.json` (DESIGN §4.1, §5.3, §9.1, §9.2).
// Realism and time settings seed new chats only, filling in what a world's own defaults leave out
// (or replacing them, when the user asks); a running chat changes through markers. Every
// conservative default is one tap to change (D31).

import type { Band, BoundMode, DomainId, InterruptClass, InterruptPolicy, Level, ModelUsePresetId, RealismPresetId, SceneTypeId } from "./ids";
import type { AdjudicationDef, StepPurpose } from "./world";

/** Where a model step runs. `decision` uses `decisions.evaluate`; `helper` a helper JSON call. */
export interface StepRoute {
  provider: "decision" | "helper";
  connectionId: string | null;
  model: string | null;
}

/** What a step does with the world's lore (DESIGN §5.4): nothing; a prefetch from its own inputs, at no extra call; lookups the model asks for, on the phase's lookup budget; or both. */
export type LorePolicy = "none" | "prefetch" | "lookup" | "prefetch+lookup";
export const LORE_POLICIES: readonly LorePolicy[] = ["none", "prefetch", "lookup", "prefetch+lookup"];

/** How a step's lookups reach the model: native tool calls, the two-phase `{"need": [...]}` form, or `auto`: tools until its connection is seen refusing them. */
export type LoreTransport = "auto" | "tools" | "need";
export const LORE_TRANSPORTS: readonly LoreTransport[] = ["auto", "tools", "need"];

export interface StepLore {
  policy: LorePolicy;
  /** Tokens the step's lore may take: the prefetch block, and the results of each lookup. */
  tokens: number;
  /** Absent: `auto`. */
  transport?: LoreTransport;
}

/** A step no preset gives a lore setting (puzzle answers, or a step only Custom turns on): a prefetch, which costs no call. */
export const DEFAULT_STEP_LORE: Readonly<StepLore> = Object.freeze({ policy: "prefetch", tokens: 300 });

/** The step's lore setting: its own, else `DEFAULT_STEP_LORE`. */
export function stepLoreOf(config: StepConfig | null | undefined): Readonly<StepLore> {
  return config?.lore ?? DEFAULT_STEP_LORE;
}

export interface StepConfig {
  enabled: boolean;
  /** Signals that trigger the step (DESIGN §5.2). */
  signals: string[];
  route?: StepRoute;
  template?: string;
  maxTokens?: number;
  /** The step's lore policy; a settings file without one reads with its preset's. */
  lore?: StepLore;
}

/** Lore lookups a phase may make besides its calls: rounds, and the time from the phase's start in which one may begin. */
export interface LookupLimits {
  calls: number;
  ms: number;
}

/** Lumiverse's longest wait for a context handler: it clamps a registration's timeout to 1–120 s. */
export const CONTEXT_HANDLER_MAX_MS = 120_000;
/** What a turn's plan needs of the context handler's wait once the before-the-reply steps stop: the plan, its lines and the journal write. */
export const PLAN_MARGIN_MS = 15_000;
/** The longest before-the-reply wall clock: the rest of the host's wait, so the plan always lands (DESIGN §5.1). */
export const PRE_REPLY_MAX_MS = CONTEXT_HANDLER_MAX_MS - PLAN_MARGIN_MS;

export interface PhaseBudget {
  calls: number;
  ms: number;
  /** Absent: no lookups; a settings file without one reads with its preset's. */
  lookup?: LookupLimits;
}

export interface ModelUseSettings {
  preset: ModelUsePresetId;
  steps: Partial<Record<StepPurpose, StepConfig>>;
  budgets: { pre: PhaseBudget; post: PhaseBudget };
  /** Engine budget in tokens for the sections (DESIGN §5.3). */
  tokens: { sections: number };
}

export interface RealismSettings {
  preset: RealismPresetId;
  levels: Record<DomainId, Level>;
  /** Caps per detail band, keyed by band id. */
  tierCaps: Record<Band, Partial<Record<DomainId, Level>>>;
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
  /** New chats start from these realism and time settings instead of the world's own defaults (DESIGN §9.1). */
  overrideWorldDefaults: boolean;
  /** How checks are decided in new chats (DESIGN §11): it fills in for a world whose ruleset sets none. */
  adjudication: AdjudicationDef;
  /** New chats use `adjudication` even where the world's ruleset sets a policy of its own. */
  overrideWorldAdjudication: boolean;
  extraction: ExtractionBounds;
  swipeDefault: "rerun" | "renarrate";
}
