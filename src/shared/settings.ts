// User-owned settings, `userStorage/settings.json` (DESIGN §4.1, §5.3, §9.1, §9.2).
// Realism and time settings seed new chats only, filling in what a world's own defaults leave out
// (or replacing them, when the user asks); a running chat changes through markers. Every
// conservative default is one tap to change (D31).

import type { Band, BoundMode, DomainId, InterruptClass, InterruptPolicy, Level, ModelUsePresetId, RealismPresetId, SceneTypeId } from "./ids";
import type { ClaimsPolicy } from "./claims";
import type { InferredChecks } from "./inferred";
import type { AdjudicationDef, StepPurpose } from "./world";
import type { Limit, MindsSettings } from "./minds";
import { isMindPurpose, limitIn } from "./minds";
import { isRecord, safeKey } from "./json";
import type { TimeoutSettings } from "./timeouts";
import type { AgentSettings } from "./agent-settings";
import type { PromptSettings, SwipeTexts } from "./prompts";
import type { DiagnosticsSettings } from "./diagnostics";
import type { RetentionSettings } from "./stores";
import { ITEM_CHANGES } from "./things";
import type { OffstageSettings } from "./offstage";

/**
 * How hard a model reasons on a call (Lumiverse's per-request reasoning override): `inherit` leaves
 * it to the connection's reasoning binding, else the user's Lumiverse setting; `off` turns reasoning
 * off; the rest ask for that effort, which the host maps to each provider's own field.
 */
export type ReasoningChoice = "inherit" | "off" | "auto" | "minimal" | "low" | "medium" | "high" | "max" | "xhigh";
export const REASONING_CHOICES: readonly ReasoningChoice[] = ["inherit", "off", "auto", "minimal", "low", "medium", "high", "max", "xhigh"];

/**
 * Helper steps run on reasoning models, which spend most of a reply thinking before the JSON
 * (DESIGN §5.3): too little room and the answer comes back empty.
 */
export const HELPER_MAX_TOKENS = 8192;

/**
 * Sampling parameters a helper call may set, by the names Lumiverse's generation call takes
 * (`GenerationParameters`). One left out is the connection's own (its preset's); the provider
 * decides which it honours.
 */
export interface SamplingParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export const SAMPLING_PARAMS: readonly { key: keyof SamplingParams; label: string; min: number; max: number; step: number; integer: boolean; fallback: number }[] = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05, integer: false, fallback: 1 },
  { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.01, integer: false, fallback: 1 },
  { key: "top_k", label: "Top K", min: 0, max: 1000, step: 1, integer: true, fallback: 40 },
  { key: "frequency_penalty", label: "Frequency penalty", min: -2, max: 2, step: 0.05, integer: false, fallback: 0 },
  { key: "presence_penalty", label: "Presence penalty", min: -2, max: 2, step: 0.05, integer: false, fallback: 0 },
];

/** Where a model step runs. `decision` uses `decisions.evaluate`; `helper` a helper JSON call. */
export interface StepRoute {
  provider: "decision" | "helper";
  /** Null: the helper model's connection (a helper call), or the Decisions API's default (a decision). */
  connectionId: string | null;
  /** Null: the connection's own model. Read only with this route's own connection. */
  model: string | null;
  /** Absent: the helper model's effort. The Decisions API takes none. */
  effort?: ReasoningChoice;
  /** Each one absent is the helper model's. The Decisions API takes none. */
  params?: SamplingParams;
}

/** The helper model (Settings → Helper model): what every helper call runs on unless its step chooses otherwise. */
export interface HelperDefault {
  /** Null: Lumiverse's default connection. */
  connectionId: string | null;
  /** Null: that connection's own model. */
  model: string | null;
  effort: ReasoningChoice;
  maxTokens: number;
  params: SamplingParams;
}

export const DEFAULT_HELPER: Readonly<HelperDefault> = Object.freeze({ connectionId: null, model: null, effort: "inherit", maxTokens: HELPER_MAX_TOKENS, params: Object.freeze({}) });

/** What a helper call runs with: the step's own choices, else the helper model's. */
export interface HelperCall {
  connectionId: string | null;
  model: string | null;
  effort: ReasoningChoice;
  maxTokens: number;
  params: SamplingParams;
}

/**
 * A helper call's settings: a step that chose a connection runs on it with its own model; one that
 * didn't runs on the helper model's connection and model. Its effort, max tokens and each sampling
 * parameter are its own, else the helper model's.
 */
export function helperCallOf(config: Pick<StepConfig, "route" | "maxTokens"> | null | undefined, helper: Readonly<HelperDefault>): HelperCall {
  const route = config?.route;
  const own = route?.connectionId ?? null;
  return {
    connectionId: own ?? helper.connectionId,
    model: own !== null ? (route?.model ?? null) : helper.model,
    effort: route?.effort ?? helper.effort,
    maxTokens: config?.maxTokens ?? helper.maxTokens,
    params: { ...helper.params, ...route?.params },
  };
}

/**
 * The steps that don't reason unless the user sets an effort on their cards (DESIGN §5.3): a
 * character's memory of the turn, the consolidation that folds their notes into a summary, the
 * knowledge step's record of who learned what, and a time skip's plan and beats. Their answers are
 * short records of what happened or is due; a reasoning model spent its whole max tokens thinking
 * through them and wrote nothing.
 */
export const UNREASONED_STEPS: readonly StepPurpose[] = ["memory", "consolidate", "knowledge", "skip"];

/** Those steps' route while unsaved, and in the presets: the helper model, reasoning off. */
export const UNREASONED_ROUTE: Readonly<StepRoute> = Object.freeze({ provider: "helper", connectionId: null, model: null, effort: "off" });

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
export const DEFAULT_STEP_LORE: Readonly<StepLore> = Object.freeze({ policy: "prefetch", tokens: 1200 });

/** The step's lore setting: its own, else `DEFAULT_STEP_LORE`. */
export function stepLoreOf(config: StepConfig | null | undefined): Readonly<StepLore> {
  return config?.lore ?? DEFAULT_STEP_LORE;
}

/**
 * A step's saved settings, else what it runs with while none are saved: `puzzle.answer` is the
 * author's opt-in, so it runs on every Answer unless the user turns it off; the minds steps run
 * whenever Settings → Minds is on (DESIGN §24.6), except the `skip` step, which is off until the
 * user turns it on (§24.7), and those of them that don't reason (`UNREASONED_STEPS`) run with
 * reasoning off; any other is off. The turn, the minds and Settings → Steps all read this, so the
 * card shows what runs and its switch flips it.
 * Puzzle answers with no signals saved reads its own: an older card saved Enabled with an empty
 * list, which showed On and never ran, and Enabled is what turns it off.
 */
export function stepConfigOf(steps: Partial<Record<StepPurpose, StepConfig>>, purpose: StepPurpose): StepConfig {
  const saved = steps[purpose];
  if (isMindPurpose(purpose)) return saved ?? { enabled: purpose !== "skip", signals: [], ...(UNREASONED_STEPS.includes(purpose) ? { route: { ...UNREASONED_ROUTE } } : {}) };
  if (purpose !== "puzzle.answer") return saved ?? { enabled: false, signals: [] };
  const signals = ["always"];
  return saved ? (saved.signals.length > 0 ? saved : { ...saved, signals }) : { enabled: true, signals };
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
  /** The messages before the turn's that the step reads; absent: `interpret` reads `DEFAULT_RECENT`, every other step none (`recentOf`). */
  recent?: RecentHistory;
}

/**
 * How much of the chat before the turn's message a step reads: whether it reads any, and the latest
 * messages, newest first, at most `messages` of them and about `tokens` in all, either one `"none"`
 * for no limit; it stops at whichever limit comes first.
 */
export interface RecentHistory {
  on: boolean;
  messages: Limit;
  tokens: Limit;
}

/** What `interpret` reads before the typed message unless its card says otherwise: the last 8 messages, about 3,000 tokens. */
export const DEFAULT_RECENT: Readonly<RecentHistory> = Object.freeze({ on: true, messages: 8, tokens: 3000 });

/** What every other step reads unless its card turns it on: nothing, with interpret's limits ready for when it is. */
export const RECENT_OFF: Readonly<RecentHistory> = Object.freeze({ ...DEFAULT_RECENT, on: false });

/** The step's recent-history setting: its own, else `interpret`'s default or, for every other step, off. */
export function recentOf(purpose: StepPurpose, config: StepConfig | null | undefined): Readonly<RecentHistory> {
  return config?.recent ?? (purpose === "interpret" ? DEFAULT_RECENT : RECENT_OFF);
}

/** Lore lookups a phase may make besides its calls: rounds. When one may still begin is a timeout (`TimeoutSettings`). */
export interface LookupLimits {
  calls: number;
}

/** The activities Speed through always lists (DESIGN §9.2), each offered as a timelapse past 30 minutes unless set otherwise; worlds may add more. */
export const SPEED_ACTIVITIES = ["sleep", "work_shift", "travel", "waiting"] as const;
export const SPEED_DEFAULT: Readonly<{ mode: "offer" | "auto"; thresholdMinutes: number }> = Object.freeze({ mode: "offer", thresholdMinutes: 30 });
/** A Speed-through threshold's range in whole minutes, 1 minute to 7 days (DESIGN §9.2): what Settings keeps, the controls offer and the engine reads. */
export const SPEED_THRESHOLD_MINUTES = [1, 7 * 1440] as const;
/** The farthest a timelapse reaches from now, 366 days in minutes (DESIGN §9.2): the engine's hard maximum, and the most a skip can run without asking. */
export const TIMELAPSE_REACH_MINUTES = 366 * 1440;
/** How long a skip runs without asking unless the user sets otherwise (`TimeSettings.askBeyondMinutes`): a day. */
export const ASK_BEYOND_DEFAULT = 1440;

/** A phase's model calls; how long the phase may take is a timeout (`TimeoutSettings`), apart from any preset. */
export interface PhaseBudget {
  calls: number;
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
  /** What a typed action's thing the world doesn't have becomes (DESIGN §9.4); each named preset carries its own. */
  claims: ClaimsPolicy;
}

export interface TimeSettings {
  sceneTicks: Record<SceneTypeId, number>;
  scale: number;
  interrupts: Record<InterruptClass, InterruptPolicy>;
  speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
  montage: "key" | "day" | "week";
  unitCap: { agentDays: number; events: number };
  /**
   * How long a skip runs without asking (DESIGN §9.2, §9.4), in whole minutes from 0 to the
   * timelapse's reach: a typed span or a narrated jump longer than this is offered as a Timelapse
   * chip instead. Unlike the rest, it isn't a seed for new chats: every chat reads it as it plays.
   */
  askBeyondMinutes: number;
}

/**
 * The change types with a per-type mode the reply's read lands under (DESIGN §9.4, §11; ITEMS-SPEC
 * §5.4). A thing fact the read gives (`THING_FACTS`) is settled into one of the item change types
 * (`ITEM_CHANGES`) before its mode is read, and a move to a place the world lacks into `place_make`
 * (a room, a spot or a venue made in play, §6.2). `membership` and `employment` are the story's
 * changes to organizations (ORG-SPEC §7.3): someone joins, leaves, is appointed or takes a title;
 * someone is hired, let go, quits, gets a raise or goes on leave. `agenda` is an organization's plan
 * item the reply says is under way, done, blocked or refused (ORG-SPEC §3.14). `vote` and `approval`
 * are its decisions as the story tells them (ORG-SPEC Phase 5): someone's vote on an open motion, and
 * an answer to a request for approval. `revenue` is a revenue stream earning more or less for a while
 * (a factor or an amount, up to 31 days), as the story tells it, on a stream its author opened to the
 * agents (DESIGN §26.2). `project_note` is a production project's step set back (up to 30 days) or
 * costing more (up to the narrated-price cap), as the story tells it. `learn` and `reveal` are the
 * knowledge step's (DESIGN §24.11): what the player character learns, and a secret the story reveals
 * to them; the reply's read never proposes them.
 */
export const EXTRACTION_TYPES = ["time_advance", "location", "place_make", "condition", "knows", "purchase", "transfer", "regard", "quantity", "spawn", "life", "routine", "membership", "employment", "agenda", "vote", "approval", "revenue", "project_note", ...ITEM_CHANGES, "learn", "reveal"] as const;
export type ExtractionType = (typeof EXTRACTION_TYPES)[number];

/**
 * D4: per-type cold-start modes, ITEMS-SPEC §5.4 amending it for things: moves, holds, use, wear
 * and condition apply; a change of owner and a loss ask. A thing made applies at or under the
 * world's claim cap and Armful or smaller, and asks otherwise (`item_make`'s default reads the make).
 * These are only the start: per-connection learning (ExtractionLearning) promotes a type to `auto`
 * at ≥ 0.90 acceptance over at least 30 confirm/undo outcomes. `quantity` keeps its field bounds'
 * mode.
 */
export const EXTRACTION_DEFAULTS: Readonly<Partial<Record<ExtractionType, BoundMode>>> = Object.freeze({
  time_advance: "auto",
  location: "auto",
  // A place made in play (ITEMS-SPEC §5.4): a room or a spot applies, with its Undo; a venue (a new place in town) asks first.
  place_make: "auto",
  condition: "auto",
  // A routine is a default that never moves anyone the story has: a wrong one costs little, and its chip undoes it.
  routine: "auto",
  regard: "confirm",
  transfer: "confirm",
  spawn: "confirm",
  life: "confirm",
  knows: "confirm",
  purchase: "confirm",
  // Organizations (ORG-SPEC §7.3, §9): who belongs, holds a position or works where asks first; how a plan goes lands with its Undo; a vote or an answer to a request, which carries out what it decides, asks first.
  membership: "confirm",
  employment: "confirm",
  agenda: "auto",
  vote: "confirm",
  approval: "confirm",
  // Things (ITEMS-SPEC §5.4): where a thing is and who holds it land with their Undo; whose it is, and a loss, ask.
  item_move: "auto",
  item_hand: "auto",
  item_own: "confirm",
  item_make: "auto",
  item_use: "auto",
  item_wear: "auto",
  item_condition: "auto",
  item_lose: "confirm",
  // Revenue (DESIGN §26.2): a stream earning more or less for a while, as the story tells it, asks first.
  revenue: "confirm",
  // A project's delay or extra cost the story tells (DESIGN §26.5): lands with its receipt and Undo, within its bounds.
  project_note: "auto",
  // Knowledge (DESIGN §24.11): what the player character learns applies, with its Undo; a secret's reveal asks first.
  learn: "auto",
  reveal: "confirm",
});

/**
 * What the reply's read tells and keeps of things (Settings → Changes from the reply, ITEMS-SPEC
 * §11): how many things its prefix shows (those the reply or the player's message names first,
 * then the scene's, then the player character's own), the longest reason a change keeps, and how
 * many things one reply may bring into the world (its read's thing facts that find nothing make
 * one each, §5.3 step 3; past the cap, a Not tracked receipt).
 */
export interface ThingReadSettings {
  shown: number;
  whyMax: number;
  madeMax: number;
}

export const THING_READ_DEFAULTS: Readonly<ThingReadSettings> = Object.freeze({ shown: 40, whyMax: 120, madeMax: 6 });
/** What each may be set to: at least one thing, at most what a prompt can carry; a reason of 20 to 500 characters; none to 500 things made (each a whole entity every fold carries). */
export const THING_READ_BOUNDS = Object.freeze({ shown: [1, 200] as const, whyMax: [20, 500] as const, madeMax: [0, 500] as const });

/** `UserSettings.thingReads` as the engine reads it: each a whole number in its bounds, else `base`'s. */
export function thingReadsOf(raw: unknown, base: Readonly<ThingReadSettings> = THING_READ_DEFAULTS): ThingReadSettings {
  const v = isRecord(raw) ? raw : {};
  const whole = (x: unknown, [min, max]: readonly [number, number], fallback: number): number => (typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : fallback);
  return { shown: whole(v.shown, THING_READ_BOUNDS.shown, base.shown), whyMax: whole(v.whyMax, THING_READ_BOUNDS.whyMax, base.whyMax), madeMax: whole(v.madeMax, THING_READ_BOUNDS.madeMax, base.madeMax) };
}

/**
 * What an agent (the GM assistant, the Curator) may change on its own, per type (AGENT-LOOP-PLAN §6,
 * §15; ITEMS-SPEC §5.4; ORG-SPEC §7.3). They take a mode as the extraction types do and share their
 * pins (`UserSettings.extraction`), but they are not extraction types: no reply proposes them, so the
 * extract step never lists them. A thing's resting place, who may use it, its names and size, two
 * things merged into one and a thing taken out of the world are only the Curator's and the GM's; so
 * are a saved outfit or loadout made, dropped or changed into (`item_set`). An organization's changes
 * (`{op: "org"}`) are its people, its powers, its shares and structure, and its rules.
 */
export const AGENT_CHANGE_TYPES = ["gm_spawn", "despawn", "destroy", "money_adjust", "stage", "gm_edit", "workspace", "item_home", "item_grant", "item_label", "item_merge", "item_set", "item_remove", "org_people", "org_powers", "org_shares", "org_rules", "world_document", "world_edit", "play", "mind"] as const;
export type AgentChangeType = (typeof AGENT_CHANGE_TYPES)[number];

/** Every type with a mode: what a reply may change, then what an agent may. */
export type ChangeType = ExtractionType | AgentChangeType;
export const CHANGE_TYPES: readonly ChangeType[] = [...EXTRACTION_TYPES, ...AGENT_CHANGE_TYPES];

/** AGENT-LOOP-PLAN §6: despawn, destroy, money adjustment, stage and GM spawn confirm; other GM edits and workspace notes apply. ITEMS-SPEC §5.4: a thing's rest, grants and labels apply; a merge and a removal ask. ORG-SPEC §9: an organization's people, powers and shares ask; its rules apply. The world's document lands (it is the harness engine's alone): the author decides, and the player reviews after, on the reply; an act that would publish or throw away the user's own Build edits asks first whatever the mode (`harness/turn.ts`). The world as a chat plays it (its places, paths and maps made or changed in play) lands with its turn. A pin keeps the mode the user chose. These are the older engines' defaults: on the harness every type lands unless the user set it (`effectiveMode`). */
export const AGENT_CHANGE_DEFAULTS: Readonly<Record<AgentChangeType, BoundMode>> = Object.freeze({
  gm_spawn: "confirm",
  despawn: "confirm",
  destroy: "confirm",
  money_adjust: "confirm",
  stage: "confirm",
  gm_edit: "auto",
  workspace: "auto",
  item_home: "auto",
  item_grant: "auto",
  item_label: "auto",
  item_merge: "confirm",
  item_set: "auto",
  item_remove: "confirm",
  org_people: "confirm",
  org_powers: "confirm",
  org_shares: "confirm",
  org_rules: "auto",
  world_document: "auto",
  world_edit: "auto",
  // The harness engine's own tools: what its author plays and what its characters' agents record land with the turn unless the player says otherwise.
  play: "auto",
  mind: "auto",
});

/** Each agent change type in plain words, for Settings and for the writer's refusals. */
export const AGENT_CHANGE_LABEL: Readonly<Record<AgentChangeType, string>> = Object.freeze({
  gm_spawn: "Adding people or things",
  despawn: "Removing people",
  destroy: "Destroying things",
  money_adjust: "Money adjustments",
  stage: "Quest and secret stages",
  gm_edit: "Other GM edits (fields, tiers, minds, routines, sections, the clock)",
  workspace: "Workspace notes",
  item_home: "Where things are kept",
  item_grant: "Who may use things",
  item_label: "Things' names, descriptions and sizes",
  item_merge: "Two things merged into one",
  item_set: "Saved outfits and loadouts, and changing into them",
  item_remove: "Things removed from the world",
  org_people: "Organizations' people (members, positions held, titles, staff, pay, the party's tiers)",
  org_powers: "Organizations' positions and delegations",
  org_shares: "Organizations' shares and structure (founding, issuing, buying back, transfers, restructuring)",
  org_rules: "Organizations' rules (entry, dues, names)",
  world_document: "The world's document (committing its draft, bringing this chat to a revision, dropping or restoring the draft)",
  world_edit: "The world as this chat plays it (its places, paths and maps, made or changed in play)",
  play: "What the author plays (an attempt and its roll, a fight's rounds)",
  mind: "Characters' minds (what they decide and remember, and their own files)",
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

/**
 * User overrides per type, extraction and agent change types alike. A set type is pinned: learning
 * still counts it but never flips it. `maxDelta` bounds an extraction type's change only.
 */
export type ExtractionBounds = Partial<Record<ChangeType, { mode: BoundMode; maxDelta?: number }>>;

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
  /**
   * Agent-made operations' outcomes, per role id, per connection id, per change type (AGENT-LOOP-PLAN §6:
   * learning keyed by role × connection × change type). Absent until an agent's change is first counted.
   */
  roles?: Record<string, Record<string, Partial<Record<ChangeType, ExtractionTypeStats>>>>;
}

/**
 * Where a turn waits for the player before it goes on (DESIGN §5.1 preview gates), each off by
 * default: `intent` shows a typed message's read action before it plays, `outline` the turn's
 * outline before the reply is written. Each waits on Play, Edit or Cancel.
 */
export interface GateSettings {
  intent: boolean;
  outline: boolean;
}

/** Whose knowledge the narrator gets (DESIGN §6.11): everyone's in the scene, or the player character's alone. */
export type NarratorKnowledge = "scene" | "pov";
export const NARRATOR_KNOWLEDGE: readonly NarratorKnowledge[] = ["scene", "pov"];

/** What the narrator gets of a secret: the secret, marked as one, or none of it. */
export type NarratorSecrets = "marked" | "omit";
export const NARRATOR_SECRETS: readonly NarratorSecrets[] = ["marked", "omit"];

/**
 * The narrator's knowledge (DESIGN §6.11). The user's default (Settings → Narrator), a world's
 * default (`WorldDoc.narrator`) and a chat's own choice (`backend/chat-knowledge-prefs.ts`) all
 * take this shape; the chat's wins, then the world's.
 */
export interface NarratorView {
  knowledge: NarratorKnowledge;
  secrets: NarratorSecrets;
}

/** The ruling's default (OPEN-DECISIONS core 3): what everyone in the scene knows, secrets included and marked. */
export const NARRATOR_DEFAULTS: Readonly<NarratorView> = Object.freeze({ knowledge: "scene", secrets: "marked" });

/** Each choice in the words Settings, Build and GM mode show. */
export const NARRATOR_KNOWLEDGE_LABEL: Readonly<Record<NarratorKnowledge, string>> = { scene: "Everyone in the scene", pov: "Your character's only" };
export const NARRATOR_SECRETS_LABEL: Readonly<Record<NarratorSecrets, string>> = { marked: "Marked", omit: "Left out" };

/** A narrator view read from outside data (a settings file, a world document, a chat's metadata): null unless both parts are ones it takes. */
export function narratorViewOf(raw: unknown): NarratorView | null {
  if (!isRecord(raw)) return null;
  const knowledge = NARRATOR_KNOWLEDGE.find((k) => k === raw.knowledge);
  const secrets = NARRATOR_SECRETS.find((s) => s === raw.secrets);
  return knowledge && secrets ? { knowledge, secrets } : null;
}

/** `UserSettings.narrator` as the engine reads it: each part checked, else `base`'s. */
export function narratorSettingsOf(raw: unknown, base: Readonly<NarratorView>): NarratorView {
  const n = isRecord(raw) ? raw : {};
  return { knowledge: NARRATOR_KNOWLEDGE.find((k) => k === n.knowledge) ?? base.knowledge, secrets: NARRATOR_SECRETS.find((s) => s === n.secrets) ?? base.secrets };
}

/** Which World Info books LRE reads as lore (`UserSettings.loreBooks`): every book a world chat reads, or only those of them listed. */
export type LoreBooks = "auto" | string[];

/** `UserSettings.loreBooks` as the engine reads it: a list keeps each book id once; anything else reads as every book the chat reads. */
export function loreBooksSettingOf(raw: unknown): LoreBooks {
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && id !== ""))] : "auto";
}

/** One World Info entry, by its book and its own id. */
export interface LoreEntryRef {
  bookId: string;
  entryId: string;
}

/** The lore index entry Build → Lore built (DESIGN §4.2): where it is, and the world whose books it lists, which LRE keeps it in step with. */
export interface BuiltLoreIndex extends LoreEntryRef {
  worldId: string;
}

/**
 * The lore index (Settings → Lore, DESIGN §4.2): the routing table the agents read, made from the
 * World Info books LRE reads, each entry by a short id and its title. `tagPattern`: a World Info key
 * of an entry that matches it (a regular expression) is that entry's id, a tag; an entry with none
 * gets one of LRE's own, `idPrefix` then its number padded to `idDigits` digits, kept for good.
 * `holdsChars`: the longest line of what an entry holds beside its title (0: none). `promptTokens`:
 * the most of the index a role's prompt carries when the role starts with it (Settings → Agents →
 * Context's `lore_index` source). `own`: an entry of the user's whose
 * text the agents get as the index instead, verbatim. `built`: the entry Build → Lore wrote, which LRE
 * keeps in sync; set by Build, taken off by Stop.
 */
export interface LoreIndexSettings {
  tagPattern: string;
  idPrefix: string;
  idDigits: number;
  holdsChars: number;
  promptTokens: number;
  own: LoreEntryRef | null;
  built: BuiltLoreIndex | null;
}

/** A new user's lore index: the tags `lr` and four digits are, LRE's own ids `lre` and four digits, a holds line of 100 characters, and 1,500 tokens of it in a prompt that starts with it. */
export const LORE_INDEX_DEFAULTS: Readonly<LoreIndexSettings> = Object.freeze({ tagPattern: "^lr\\d{4}$", idPrefix: "lre", idDigits: 4, holdsChars: 100, promptTokens: 1500, own: null, built: null });

/** What a short id is made of: letters, digits, `_`, `.` and `-`, so it never reads as a book's entry (`/`), a lore id (`:`) or a mark (`#`). */
const SHORT_ID = /^[\p{L}\p{N}_.-]+$/u;

/** The bounds each number of the lore index takes. */
export const LORE_INDEX_BOUNDS = { idPrefix: 16, idDigits: [1, 9], holdsChars: [0, 2000], promptTokens: [1, 1_000_000] } as const;

/** A tag pattern as the engine matches keys with, or null for one that isn't a regular expression. */
export function tagPatternOf(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}

/** Whether `id` can be a short id (`SHORT_ID`) and a stored key. */
export function isShortId(id: string): boolean {
  return SHORT_ID.test(id) && safeKey(id);
}

function entryRefOf(raw: unknown): LoreEntryRef | null {
  return isRecord(raw) && typeof raw.bookId === "string" && raw.bookId !== "" && typeof raw.entryId === "string" && raw.entryId !== "" ? { bookId: raw.bookId, entryId: raw.entryId } : null;
}

/** `UserSettings.loreIndex` as the engine reads it: each part checked, else `base`'s; a pattern that isn't a regular expression and a prefix that can't start an id keep `base`'s. */
export function loreIndexSettingsOf(raw: unknown, base: Readonly<LoreIndexSettings> = LORE_INDEX_DEFAULTS): LoreIndexSettings {
  const v = isRecord(raw) ? raw : {};
  const int = (x: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : fallback);
  const built = entryRefOf(v.built);
  const worldId = isRecord(v.built) && typeof v.built.worldId === "string" && v.built.worldId !== "" ? v.built.worldId : null;
  return {
    tagPattern: typeof v.tagPattern === "string" && v.tagPattern !== "" && tagPatternOf(v.tagPattern) !== null ? v.tagPattern : base.tagPattern,
    idPrefix: typeof v.idPrefix === "string" && v.idPrefix.length <= LORE_INDEX_BOUNDS.idPrefix && isShortId(v.idPrefix) ? v.idPrefix : base.idPrefix,
    idDigits: int(v.idDigits, LORE_INDEX_BOUNDS.idDigits, base.idDigits),
    holdsChars: int(v.holdsChars, LORE_INDEX_BOUNDS.holdsChars, base.holdsChars),
    promptTokens: int(v.promptTokens, LORE_INDEX_BOUNDS.promptTokens, base.promptTokens),
    own: v.own === undefined ? base.own : entryRefOf(v.own),
    built: v.built === undefined ? base.built : built && worldId ? { ...built, worldId } : null,
  };
}

export interface UserSettings {
  v: 1;
  /**
   * Which shipped defaults the file was last read against: a file from before the defaults rose
   * for reasoning models (absent) has every value still at an old default lifted to the new one;
   * one from before memory, consolidation and the time skip's steps stopped reasoning (2) has those
   * steps lifted to reasoning off where they were left to the helper model's; one from before
   * the sections told their facts whole (2 or 3) has a section budget still at Standard's or Full's
   * old default lifted to its new one; one from before the turn's tokens went unbounded (up to 4)
   * has a turn budget still at its old 100,000 prompt or 10,000 answer tokens set to No limit;
   * one from before organizations had tools (up to 5) has every role that reads money given the
   * `orgs` family too; one from before the final review's time rose (up to 6) has it still at
   * its old 2 minutes lifted to the new default; and one from before a swipe re-narrated by default
   * (up to 7) has a swipe default of Re-run lifted to Re-narrate. A file older than several
   * revisions has each of their lifts.
   */
  defaults: typeof SETTINGS_DEFAULTS_REV;
  /** The helper model, apart from the presets: picking one never changes it. */
  helper: HelperDefault;
  modelUse: ModelUseSettings;
  realism: RealismSettings;
  time: TimeSettings;
  /** New chats start from these realism and time settings instead of the world's own defaults (DESIGN §9.1). */
  overrideWorldDefaults: boolean;
  /** How checks are decided in new chats (DESIGN §11): it fills in for a world whose ruleset sets none. */
  adjudication: AdjudicationDef;
  /** New chats use `adjudication` even where the world's ruleset sets a policy of its own. */
  overrideWorldAdjudication: boolean;
  /**
   * How typed attempts are read as checks in new chats (DESIGN §11 inferred checks): it fills in for a
   * world whose ruleset sets none, or replaces it with `overrideWorldAdjudication` on (one switch for
   * the user's check rules). Null: each new chat plays by its realism preset and Sheets level.
   */
  inferred: InferredChecks | null;
  extraction: ExtractionBounds;
  /** What the reply's read tells and keeps of things (Settings → Changes from the reply, ITEMS-SPEC §11). */
  thingReads: ThingReadSettings;
  /** What a host swipe does (Settings → Swipes, DESIGN §6.12): tells the same turn again (`renarrate`, the default), or plays the turn again with the engine (`rerun`). */
  swipeDefault: "rerun" | "renarrate";
  /** Whether a host swipe first asks what should change (Settings → Swipes): off, it starts at once. */
  swipeAsk: boolean;
  /** What a Re-narrate is sent (Settings → Swipes, DESIGN §6.12): the texts its turn was made with (its prompt set), or the user's current ones. */
  swipeTexts: SwipeTexts;
  /** World chats hide each reply's `<json>…</json>` block on display, after the preset's own display scripts. World Info skips the block either way (DESIGN §6.7). */
  hideJsonBlocks: boolean;
  /** Character minds (DESIGN §24.6): on or off, the Live limit, refresh policies, memory, the Minds section's budget, prompts and time-skip caps. */
  minds: MindsSettings;
  /** Every wall clock the engine keeps (DESIGN §5.6, Settings → Timeouts), apart from the presets: picking one never changes a time limit. */
  timeouts: TimeoutSettings;
  /** Build's jobs (Settings → Steps and connections → Build jobs), apart from the presets. */
  jobs: JobSettings;
  /**
   * Which World Info books LRE reads as lore (Settings → Lore, DESIGN §4.2): `"auto"`, the default,
   * every book a world chat reads (the world's Lore books, the chat's own, the global ones and those
   * an earlier build copied the world's lore from); a list of book ids, only those of them.
   */
  loreBooks: LoreBooks;
  /** The lore index the agents read (Settings → Lore, DESIGN §4.2): its ids, its holds lines, whether the roles' prompts carry it, the user's own index entry, and the entry Build built. */
  loreIndex: LoreIndexSettings;
  /** Preview gates (Settings → Steps and connections → Preview before playing, DESIGN §5.1): off, a turn plays as soon as it is read. */
  gates: GateSettings;
  /** The agent runtime (Settings → Agents; AGENT-LOOP-PLAN §15): thinking in tool loops, budgets, the loop detector, clipping, throttles, caching and acceptance runs. No classic step reads it. */
  agents: AgentSettings;
  /** The user's own texts sent to models, and how long one may be (Settings → Agents → Prompts, DESIGN §6.12). */
  prompts: PromptSettings;
  /** How long the agent stores keep what nothing needs (Settings → Agents → Retention, DESIGN §4.4), apart from the presets. */
  retention: RetentionSettings;
  /** How many records each chat's diagnostics keep (Settings → Diagnostics, DESIGN §6.9). */
  diagnostics: DiagnosticsSettings;
  /**
   * The narrator's knowledge (Settings → Narrator, DESIGN §6.11): the user's default, which a world's
   * default and a chat's own choice override. How a secret is marked is the user's own in `prompts`
   * (the registry's Secret marks texts, §6.12).
   */
  narrator: NarratorView;
  /**
   * Whether the narrator is given the prices the engine charges, what is sold where the player
   * character is in the Money section, and told to state the engine's price whenever a purchase or a
   * price comes up (Settings → Narrator → Prices, DESIGN §9.5). Off, neither is sent.
   */
  statePrices: boolean;
  /**
   * Out-of-play actions (Settings → Narrator → Out-of-play actions, DESIGN §11): whether a money,
   * organization or Gear → Manage action done at once is told to the next turn's narrator, by its
   * group, and the amount from which a payment to someone else is. Each action's confirm step and its
   * chip start from these; the choice is recorded on the action when it is done.
   */
  offstage: OffstageSettings;
  /** Tidy up (GM → Things → Tidy up, ITEMS-SPEC §7.5, §11): how many findings one run shows. */
  tidy: TidySettings;
  /** The GM page (Settings → Speed → Pages): what it shows while a turn runs. */
  gm: GmPageSettings;
  /** Reusing work (Settings → Speed): whether built views are shared instead of built again. */
  perf: PerfSettings;
  /** The story engine's dials on a chat the harness plays (DEPTH2-PLAN §5): the budget of treatments, and what its story record keeps and gives at once. */
  story: StorySettings;
  /** What the story engine reads of the chat's preset (DEPTH2-PLAN §7): the part each category's blocks go to, and how much of each part an agent is given. */
  storyPreset: StoryPresetSettings;
  /** How a passage of the reply is told and let out on a chat the harness plays (DEPTH2-PLAN §3.3): who checks it, how often it may be drafted, the prose the narrator is handed for its voice, what the author may release in its own words, and whose the direct line's passage is. */
  narration: NarrationSettings;
}

/** What a swipe does as shipped (Settings → Swipes): it tells the same turn again, asking nothing first, with the texts its turn was made with. */
export const SWIPE_DEFAULTS: Readonly<Pick<UserSettings, "swipeDefault" | "swipeAsk" | "swipeTexts">> = Object.freeze({ swipeDefault: "renarrate", swipeAsk: false, swipeTexts: "turn" });

/** Tidy up's settings: how many findings a run shows at most (past that, fixing some shows the next). */
export interface TidySettings {
  findings: number;
}

export const TIDY_DEFAULTS: Readonly<TidySettings> = Object.freeze({ findings: 50 });
/** At least one finding a run; at most what a phone's list stays quick with. */
export const TIDY_BOUNDS = Object.freeze({ findings: [1, 500] as const });

/** `UserSettings.tidy` as the engine reads it: a whole number in its bounds, else `base`'s. */
export function tidySettingsOf(raw: unknown, base: Readonly<TidySettings> = TIDY_DEFAULTS): TidySettings {
  const v = isRecord(raw) ? raw.findings : undefined;
  const [min, max] = TIDY_BOUNDS.findings;
  return { findings: typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : base.findings };
}

/**
 * What the GM page shows while a turn runs (Settings → Speed → Pages): the chat as it was before the
 * turn, its parts held until Refresh shows the turn so far (`hold`), or every change as it lands (`live`).
 */
export type GmDuringTurn = "hold" | "live";
export const GM_DURING_TURN: readonly GmDuringTurn[] = ["hold", "live"];

export interface GmPageSettings {
  duringTurn: GmDuringTurn;
}

/** A new user's GM page: held while a turn runs, so its parts aren't built again on every change. */
export const GM_PAGE_DEFAULTS: Readonly<GmPageSettings> = Object.freeze({ duringTurn: "hold" });

/** `UserSettings.gm` as the engine reads it: a choice it takes, else `base`'s. */
export function gmPageSettingsOf(raw: unknown, base: Readonly<GmPageSettings> = GM_PAGE_DEFAULTS): GmPageSettings {
  const v = isRecord(raw) ? raw.duringTurn : undefined;
  return { duringTurn: GM_DURING_TURN.find((x) => x === v) ?? base.duringTurn };
}

/**
 * Reusing work (Settings → Speed → Reusing work): with `reuseViews` on, a view built for one ledger
 * head (the GM page's parts, the fold's state they read) is shared by every request at that head
 * instead of built and copied again; off, every request builds its own, as before.
 */
export interface PerfSettings {
  reuseViews: boolean;
}

export const PERF_DEFAULTS: Readonly<PerfSettings> = Object.freeze({ reuseViews: true });

/** `UserSettings.perf` as the engine reads it: a switch that isn't a boolean keeps `base`'s. */
export function perfSettingsOf(raw: unknown, base: Readonly<PerfSettings> = PERF_DEFAULTS): PerfSettings {
  const v = isRecord(raw) ? raw.reuseViews : undefined;
  return { reuseViews: typeof v === "boolean" ? v : base.reuseViews };
}

/**
 * The story engine's dials on a chat the harness plays (DEPTH2-PLAN §5): how many treatments of each
 * tier a stretch of story time allows (`budget`, T4 never counted), and what its story record keeps
 * and gives at once (`limits`). Each is the player's to change.
 */
export interface StorySettings {
  budget: StoryBudget;
  limits: StoryLimits;
  minds: StoryMinds;
  models: StoryModels;
  prepare: StoryPrepare;
}

/** How many T1, T2 and T3 treatments the drafts of any stretch of `stretchMinutes` of story time may hold between them: what `draft_open` and the scene tools refuse past. */
export interface StoryBudget {
  stretchMinutes: number;
  t1: number;
  t2: number;
  t3: number;
}

/** What the story record takes and gives at most. */
export interface StoryLimits {
  /** A beat's `what` and `surface`, and what someone got of it, in characters. */
  beatChars: number;
  /** One quote of a beat, in characters. */
  quoteChars: number;
  /** Quotes a beat holds. */
  quotes: number;
  /** People one beat is addressed to or reached, or one draft names. */
  people: number;
  /** Beats one turn's record holds, its jobs' included. */
  beatsPerTurn: number;
  /** A draft's `what` and its notes, in characters. */
  draftChars: number;
  /** Drafts one turn's record opens, its jobs' included. */
  draftsPerTurn: number;
  /** Why someone is cast as they are, or why a beat is struck, in characters. */
  whyChars: number;
  /** Beats one `beats_read` gives. */
  beatsRead: number;
  /** Items one `feed_read` gives. */
  feedItems: number;
  /** The moment the author is given as a turn begins (`authorOpening`), in characters. */
  openingChars: number;
}

/** A mind's files (DEPTH2-PLAN §4), by name without `.md`: `core` says who someone is (the author and the user write it); `now`, `memory`, `beliefs`, `people` and `plans` are the character's own, in its voice; `outline` is what they know only in outline of a past they didn't relive, written while the story is prepared; `profile` is all a supporting character has, and the author keeps it. */
export const MIND_FILE_IDS = ["core", "now", "memory", "beliefs", "people", "plans", "outline", "profile"] as const;
export type MindFileId = (typeof MIND_FILE_IDS)[number];

/** Each file of a mind by its title: the story pages show it, its size's row under Settings → Story → Minds is labelled by it, and a refusal past that size names it. */
export const MIND_FILE_TITLES: Readonly<Record<MindFileId, string>> = Object.freeze({ core: "Who they are", now: "Right now", memory: "Memory", beliefs: "Beliefs", people: "People", plans: "Plans", outline: "Their past in outline", profile: "Profile" });

/** What the story engine keeps of minds: how long each file may be, in characters, and whether the player's character has a mind while Sovereign Hand is on (the direction says what happens; the mind gives his voice and inner life). */
export interface StoryMinds {
  chars: Record<MindFileId, number>;
  playerMind: boolean;
}

/** How hard a model thinks, as LumiAH takes it. */
export const MODEL_EFFORTS = ["inherit", "off", "auto", "minimal", "low", "medium", "high", "max", "xhigh"] as const;
export type ModelEffortPick = (typeof MODEL_EFFORTS)[number];

/** Where an agent runs and how hard it thinks, as one level of the ladder picks it: a member left out is not picked here. */
export interface ModelPick {
  connectionId?: string;
  model?: string;
  effort?: ModelEffortPick;
}

/** A character's kinds of run: in a scene (or on the direct line), digesting what reached it, preparing for what may come, reliving the story's past. */
export const CHARACTER_RUNS = ["scene", "digest", "prepare", "relive"] as const;
export type CharacterRun = (typeof CHARACTER_RUNS)[number];

/** How an agent stands in its run, as LumiAH asks: one the run starts itself, one another agent started, a job's. */
export const AGENT_STANDINGS = ["turn", "sub", "job"] as const;
export type AgentStanding = (typeof AGENT_STANDINGS)[number];

/** The model ladder (`chooseAgentModel`): most specific first, this character, the kind of run, the standing, the agent, the default. Each level picks what it says; the rest falls through, and nothing picked leaves the agent's own. */
export interface StoryModels {
  default: ModelPick;
  /** By agent definition id (`author`, `game_master`, `narrator`, `character`, `historian`). */
  agents: Record<string, ModelPick>;
  standings: Partial<Record<AgentStanding, ModelPick>>;
  runs: Partial<Record<CharacterRun, ModelPick>>;
  /** By the entity id a character's agent runs as. */
  characters: Record<string, ModelPick>;
}

/**
 * The prepared start (`backend/story/prepare.ts`): how many messages one historian run reads (a
 * stretch), the reckoned cost of the whole preparation above which a plan always waits for the
 * player's word, how many principals may have reliving to do at once, what one stretch's read and
 * record hold, what one model call is reckoned to weigh before LumiAH has measured one, how much
 * one answer of the survey gives, how often its live view asks again and how many of the chat's
 * runs it looks through, and what one run of it may spend (`backend/story/prepare-run.ts`) and how
 * many runs in a row may move it nothing forward before it stops carrying on by itself
 * (`backend/story/prepare-carry.ts`).
 */
export interface StoryPrepare {
  /** The most messages one stretch takes: one historian run reads it. A longer stretch is planned as several. */
  stretchMessages: number;
  /** A plan the engine reckons above this many tokens in all, the author's own work included, waits for the player's word before anything is relived; 0: every plan waits. */
  askAboveTokens: number;
  /** How many principals may have moments to relive at once: opening a stretch past it is refused. */
  reliveAtOnce: number;
  /** The most beats the historian records for one stretch. */
  beatsPerStretch: number;
  /** The most characters one read of a stretch gives, its framing included. LumiAH hands the historian up to this whole (`stretch_read`'s `wholeChars`): fewer reads of a stretch, each a larger part of every later prompt. */
  readChars: number;
  /** Each text of a plan (what the story is, why a stretch or a principal, what is filled from summaries), in characters. */
  textChars: number;
  /** What one model call of the preparation is reckoned to weigh, in tokens, until LumiAH has measured a call of it or of this chat's last author run. */
  callTokens: number;
  /** The most one answer of `prepare_survey` gives, in characters: the summaries' own text and the lore's within it, the rest named with how to read it. LumiAH hands the author up to this whole (`prepare_survey`'s `wholeChars`): fewer answers, each a larger part of every later prompt. */
  surveyChars: number;
  /** While a run of the preparation is at work, how often the live view of it on Play → Now asks again, in seconds. It stops asking once none is. */
  watchSeconds: number;
  /** The most of the chat's latest runs (LumiAH's jobs) the live view looks through for the preparation's own each time it asks. */
  watchRuns: number;
  /** How long one run of the preparation may work, in minutes: its job's own time, whatever LumiAH allows a job. */
  runMinutes: number;
  /** How many rounds of tool calls one run of the preparation has, its author's and those of the agents it starts together: its job's own, whatever LumiAH allows a job. */
  runRounds: number;
  /** How many runs it started by itself in a row may end with the preparation's file moved nothing forward before it stops carrying on by itself. */
  idleRuns: number;
}

/** As shipped: a story day's stretch holds one T1, two T2 and four T3 treatments; a beat's texts as long as DEPTH2-PLAN §4 has them. */
export const STORY_DEFAULTS: Readonly<StorySettings> = Object.freeze({
  budget: Object.freeze({ stretchMinutes: 1440, t1: 1, t2: 2, t3: 4 }),
  // A beat's text and a quote are roomy: in live play a model put a whole speech in one quote and a full sentence or three in the event, and every refusal for length cost the turn another round.
  // A read of the record and what a character takes in at once hold 24 beats: forty whole beats ran far past what one tool result carries, and twenty-four fit one call whole and still cover a scene.
  limits: Object.freeze({ beatChars: 800, quoteChars: 600, quotes: 6, people: 24, beatsPerTurn: 40, draftChars: 600, draftsPerTurn: 12, whyChars: 300, beatsRead: 24, feedItems: 24, openingChars: 4000 }),
  // A mind holds what a person carries; past its size the character condenses, as memory does. The player's character has a mind under Sovereign Hand as shipped.
  minds: Object.freeze({ chars: Object.freeze({ core: 4000, now: 2000, memory: 8000, beliefs: 4000, people: 4000, plans: 2000, outline: 6000, profile: 1500 }), playerMind: true }),
  // Nothing picked: every agent runs on its own connection, model and effort until the user picks.
  models: Object.freeze({ default: Object.freeze({}), agents: Object.freeze({}), standings: Object.freeze({}), runs: Object.freeze({}), characters: Object.freeze({}) }),
  // A historian run reads about forty messages; a plan past 200,000 tokens in all asks first; three principals relive at once; a stretch keeps thirty beats; a call unmeasured is reckoned at 60,000 tokens; the live view asks every five seconds, through the chat's latest sixty runs. A run works an hour with 200 rounds, room for several stretches of a thousand-message chat each; two runs in a row that move nothing forward stop it.
  // A read and a survey answer of 60,000 characters (about 19,000 tokens) each reach their agent whole: a stretch of forty messages of 7,000 characters is read in five, and summaries of 300,000 characters in all in about six, where LumiAH's own 6,000 would take dozens of rounds, each sending the whole prompt again.
  prepare: Object.freeze({ stretchMessages: 40, askAboveTokens: 200_000, reliveAtOnce: 3, beatsPerStretch: 30, readChars: 60_000, textChars: 1200, callTokens: 60_000, surveyChars: 60_000, watchSeconds: 5, watchRuns: 60, runMinutes: 60, runRounds: 200, idleRuns: 2 }),
});

/** Each dial's bounds: a stretch from an hour to a story year; a tier's count from none to a hundred; a limit from one to what a record keeps sensibly. */
export const STORY_BOUNDS = Object.freeze({
  stretchMinutes: [60, 525_600] as const,
  treatments: [0, 100] as const,
  limits: Object.freeze({ beatChars: [40, 4000], quoteChars: [20, 2000], quotes: [0, 40], people: [1, 200], beatsPerTurn: [1, 400], draftChars: [40, 4000], draftsPerTurn: [1, 100], whyChars: [20, 2000], beatsRead: [1, 400], feedItems: [1, 400], openingChars: [500, 40_000] } satisfies Record<keyof StoryLimits, readonly [number, number]>),
  /** A mind's file, in characters: from a few lines to a long story's worth. */
  mindChars: [200, 50_000] as const,
  /** How many agents and characters the model ladder names, and how long a connection id or model name it keeps. */
  modelAgents: 64,
  modelCharacters: 500,
  modelChars: 200,
  /** The prepared start: a stretch from a few messages to a long scene; a ceiling from none to a hundred million tokens; a handful of principals at once; a read of a stretch and a survey answer from a page, for a small local model, to a million characters, for a model with a very long context; a call from a thousand tokens to two million; the live view asking from every two seconds to every five minutes, through ten to five hundred runs; a run from five minutes to a day, with ten to five thousand rounds; one to twenty runs without progress. */
  prepare: Object.freeze({ stretchMessages: [5, 400], askAboveTokens: [0, 100_000_000], reliveAtOnce: [1, 24], beatsPerStretch: [1, 200], readChars: [2000, 1_000_000], textChars: [200, 8000], callTokens: [1000, 2_000_000], surveyChars: [2000, 1_000_000], watchSeconds: [2, 300], watchRuns: [10, 500], runMinutes: [5, 1440], runRounds: [10, 5000], idleRuns: [1, 20] } satisfies Record<keyof StoryPrepare, readonly [number, number]>),
});

/** Each limit of the story record by the label of its row (Settings → Story → The record's limits): the page shows it, and a refusal that comes from the limit names it. */
export const STORY_LIMIT_LABELS: Readonly<Record<keyof StoryLimits, string>> = Object.freeze({
  beatChars: "A beat's text",
  quoteChars: "One quote",
  quotes: "Quotes in a beat",
  people: "People in a beat",
  beatsPerTurn: "Beats in a turn",
  draftChars: "A draft's text",
  draftsPerTurn: "Drafts in a turn",
  whyChars: "A reason",
  beatsRead: "Beats in one read",
  feedItems: "Beats taken in at once",
  openingChars: "The moment, as a turn begins",
});

/** Each dial of the prepared start by the label of its row (Settings → Story → Preparing): the page shows it, and a refusal or a note that comes from the dial names it. */
export const PREPARE_LABELS: Readonly<Record<keyof StoryPrepare, string>> = Object.freeze({
  stretchMessages: "Messages in a stretch",
  askAboveTokens: "Ask first above",
  reliveAtOnce: "Principals reliving at once",
  beatsPerStretch: "Beats in a stretch",
  readChars: "One read of a stretch",
  textChars: "Each text of the plan",
  callTokens: "A model call, before one is measured",
  surveyChars: "One answer of the survey",
  watchSeconds: "The live view asks every",
  watchRuns: "Runs the live view looks through",
  runMinutes: "Time for one run",
  runRounds: "Rounds for one run",
  idleRuns: "Runs without progress",
});

/** One level of the model ladder as the engine reads it: each member kept where it is one it takes, else left out. */
function modelPickOf(raw: unknown): ModelPick {
  const p = isRecord(raw) ? raw : {};
  const name = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" && x.length <= STORY_BOUNDS.modelChars ? x.trim() : null);
  const connectionId = name(p.connectionId);
  const model = name(p.model);
  const effort = MODEL_EFFORTS.find((e) => e === p.effort);
  return { ...(connectionId !== null ? { connectionId } : {}), ...(model !== null ? { model } : {}), ...(effort !== undefined ? { effort } : {}) };
}

/** Levels of the ladder by key: keys a stored key may be, each level that picks something, at most `most`. */
function modelPicksOf(raw: unknown, most: number, keyOk: (key: string) => boolean = () => true): Record<string, ModelPick> {
  const out: Record<string, ModelPick> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= most) break;
    if (!safeKey(key) || key.length > STORY_BOUNDS.modelChars || !keyOk(key)) continue;
    const pick = modelPickOf(value);
    if (Object.keys(pick).length > 0) out[key] = pick;
  }
  return out;
}

/** `StorySettings.models` as the engine reads it. */
export function storyModelsOf(raw: unknown): StoryModels {
  const m = isRecord(raw) ? raw : {};
  return {
    default: modelPickOf(m.default),
    agents: modelPicksOf(m.agents, STORY_BOUNDS.modelAgents),
    standings: modelPicksOf(m.standings, AGENT_STANDINGS.length, (key) => (AGENT_STANDINGS as readonly string[]).includes(key)) as StoryModels["standings"],
    runs: modelPicksOf(m.runs, CHARACTER_RUNS.length, (key) => (CHARACTER_RUNS as readonly string[]).includes(key)) as StoryModels["runs"],
    characters: modelPicksOf(m.characters, STORY_BOUNDS.modelCharacters),
  };
}

/** `StorySettings.prepare` as the engine reads it: each dial a whole number in its bounds, else `base`'s. */
export function storyPrepareOf(raw: unknown, base: Readonly<StoryPrepare> = STORY_DEFAULTS.prepare): StoryPrepare {
  const p = isRecord(raw) ? raw : {};
  const whole = (key: keyof StoryPrepare): number => {
    const x = p[key];
    const [lo, hi] = STORY_BOUNDS.prepare[key];
    return typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : base[key];
  };
  // A file from before a read reached its agent whole holds that build's 24,000 for a read of a stretch, sized to stay near LumiAH's cut, and no survey size yet: it reads as shipped now, not as the player's choice.
  const readChars = p.surveyChars === undefined && p.readChars === 24_000 ? base.readChars : whole("readChars");
  return { stretchMessages: whole("stretchMessages"), askAboveTokens: whole("askAboveTokens"), reliveAtOnce: whole("reliveAtOnce"), beatsPerStretch: whole("beatsPerStretch"), readChars, textChars: whole("textChars"), callTokens: whole("callTokens"), surveyChars: whole("surveyChars"), watchSeconds: whole("watchSeconds"), watchRuns: whole("watchRuns"), runMinutes: whole("runMinutes"), runRounds: whole("runRounds"), idleRuns: whole("idleRuns") };
}

/** `UserSettings.story` as the engine reads it: each dial a whole number in its bounds, else `base`'s; a file from before it reads as shipped. */
export function storySettingsOf(raw: unknown, base: Readonly<StorySettings> = STORY_DEFAULTS): StorySettings {
  const s = isRecord(raw) ? raw : {};
  const b = isRecord(s.budget) ? s.budget : {};
  const l = isRecord(s.limits) ? s.limits : {};
  const m = isRecord(s.minds) ? s.minds : {};
  const c = isRecord(m.chars) ? m.chars : {};
  const whole = (x: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : fallback);
  const [t1, t2, t3] = (["t1", "t2", "t3"] as const).map((tier) => whole(b[tier], STORY_BOUNDS.treatments, base.budget[tier]));
  const limit = (key: keyof StoryLimits): number => whole(l[key], STORY_BOUNDS.limits[key], base.limits[key]);
  const limits: StoryLimits = { beatChars: limit("beatChars"), quoteChars: limit("quoteChars"), quotes: limit("quotes"), people: limit("people"), beatsPerTurn: limit("beatsPerTurn"), draftChars: limit("draftChars"), draftsPerTurn: limit("draftsPerTurn"), whyChars: limit("whyChars"), beatsRead: limit("beatsRead"), feedItems: limit("feedItems"), openingChars: limit("openingChars") };
  const chars = Object.fromEntries(MIND_FILE_IDS.map((file) => [file, whole(c[file], STORY_BOUNDS.mindChars, base.minds.chars[file])])) as Record<MindFileId, number>;
  const minds: StoryMinds = { chars, playerMind: typeof m.playerMind === "boolean" ? m.playerMind : base.minds.playerMind };
  return { budget: { stretchMinutes: whole(b.stretchMinutes, STORY_BOUNDS.stretchMinutes, base.budget.stretchMinutes), t1: t1 ?? base.budget.t1, t2: t2 ?? base.budget.t2, t3: t3 ?? base.budget.t3 }, limits, minds, models: storyModelsOf(s.models ?? base.models), prepare: storyPrepareOf(s.prepare, base.prepare) };
}

/**
 * Where the story engine gives a block of the chat's preset (DEPTH2-PLAN §7, `backend/story/preset.ts`):
 * the story contract every agent reads, the author's direction, how to be a person for the
 * characters, rulings for the game master, prose for the narrator, how lines are written (the
 * narrator's, and a character's on the direct line), or the presentation modules the author calls
 * for by name.
 */
export type StoryPart = "contract" | "author" | "character" | "gm" | "narrator" | "voice" | "module";
export const STORY_PARTS: readonly StoryPart[] = ["contract", "author", "character", "gm", "narrator", "voice", "module"];

/** What the story engine reads of the chat's preset: the part each category's blocks go to, and how much of each part an agent is given. */
export interface StoryPresetSettings {
  /** A category's name and the part its blocks go to; a block in no category named here is the narrator's. Names match with case, spacing and the marks around words ignored (`storyCategoryKey`). */
  categories: Record<string, StoryPart>;
  limits: StoryPresetLimits;
}

/** The most characters an agent is given of each part, of the author's list of modules, of one module's line in it and of one module's text. A block that would pass its part's limit is left out whole. */
export interface StoryPresetLimits {
  contract: number;
  author: number;
  character: number;
  gm: number;
  narrator: number;
  voice: number;
  list: number;
  line: number;
  module: number;
}

/** As shipped: the categories of the story preset this engine is designed for, and room for each part. */
export const STORY_PRESET_DEFAULTS: Readonly<StoryPresetSettings> = Object.freeze({
  categories: Object.freeze({ "Story contract": "contract", Author: "author", Characters: "character", "Game master": "gm", Narrator: "narrator", Voice: "voice", "Presentation modules": "module" } satisfies Record<string, StoryPart>),
  limits: Object.freeze({ contract: 16_000, author: 40_000, character: 20_000, gm: 20_000, narrator: 48_000, voice: 12_000, list: 4_000, line: 160, module: 24_000 }),
});

/** At most 64 categories named, each name at most 80 characters; a part's limit from 100 to 400,000 characters, the list's to 100,000, a module's line from 20 to 1,000. */
export const STORY_PRESET_BOUNDS = Object.freeze({
  categories: 64,
  name: 80,
  limits: Object.freeze({ contract: [100, 400_000], author: [100, 400_000], character: [100, 400_000], gm: [100, 400_000], narrator: [100, 400_000], voice: [100, 400_000], list: [100, 100_000], line: [20, 1_000], module: [100, 400_000] } satisfies Record<keyof StoryPresetLimits, readonly [number, number]>),
});

/** A category's name as the story engine matches it: case, spacing and the marks around and between words ignored, so "----> Game Master" matches "Game master". */
export function storyCategoryKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** `UserSettings.storyPreset` as the engine reads it: each named category with a name it can match and a part it has (the rest dropped), else `base`'s mapping; each limit a whole number in its bounds, else `base`'s. */
export function storyPresetSettingsOf(raw: unknown, base: Readonly<StoryPresetSettings> = STORY_PRESET_DEFAULTS): StoryPresetSettings {
  const s = isRecord(raw) ? raw : {};
  const l = isRecord(s.limits) ? s.limits : {};
  const limits = Object.fromEntries(
    (Object.keys(STORY_PRESET_BOUNDS.limits) as (keyof StoryPresetLimits)[]).map((key) => {
      const [lo, hi] = STORY_PRESET_BOUNDS.limits[key];
      const v = l[key];
      return [key, typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : base.limits[key]];
    }),
  ) as unknown as StoryPresetLimits;
  let categories: Record<string, StoryPart> = { ...base.categories };
  if (isRecord(s.categories)) {
    categories = {};
    for (const [name, part] of Object.entries(s.categories).slice(0, STORY_PRESET_BOUNDS.categories)) {
      if (safeKey(name) && name.length <= STORY_PRESET_BOUNDS.name && storyCategoryKey(name) !== "" && STORY_PARTS.some((p) => p === part)) categories[name] = part as StoryPart;
    }
  }
  return { categories, limits };
}

/** Who holds a passage to its beats before the author may release it: the game master, the author itself, or no one. */
export type NarrationCheck = "gm" | "author" | "none";
export const NARRATION_CHECKS: readonly NarrationCheck[] = ["gm", "author", "none"];

/** Whose the direct line's passage is: the character's own, streamed as it speaks, or the narrator's, told afterwards. */
export type DirectLinePassage = "own" | "narrated";
export const DIRECT_LINE_PASSAGES: readonly DirectLinePassage[] = ["own", "narrated"];

/** How a passage of the reply is told and let out (DEPTH2-PLAN §3.3). Every number is the player's to change. */
export interface NarrationSettings {
  /** Who checks a passage against its beats before it is released. */
  check: NarrationCheck;
  /** How many times the narrator may draft a passage again after a check finds it at fault. */
  revisions: number;
  /** The end of the reply's own prose so far that the narrator is handed, in characters. */
  replyChars: number;
  /** The end of the chat's prose before the turn that the narrator is handed for its voice, in characters. */
  recentChars: number;
  /** The longest passage the narrator may draft, in characters. */
  passageChars: number;
  /** The most changes one check gives. */
  changes: number;
  /** The longest change a check gives, in characters. */
  changeChars: number;
  /** The most the author may release in its own words with no check (a line for an extra, an answer out of character), in characters; 0 for nothing. */
  ownChars: number;
  /** Whose the direct line's passage is. */
  directLine: DirectLinePassage;
}

/** The narration's numbers, by their keys in `NarrationSettings`. */
export type NarrationNumber = { [K in keyof NarrationSettings]: NarrationSettings[K] extends number ? K : never }[keyof NarrationSettings];

/** As shipped: the game master checks; two revisions; the narrator handed the reply's last 1,500 characters and the chat's last 4,000; a passage of up to 24,000 characters; up to 12 changes of 400 characters a check; 600 characters in the author's own words; the direct line's passage the character's own. */
// A passage of 24,000 characters: a long-form reply's told part runs to 3,000 words and more, and a player met the refusal at 12,000 in play.
export const NARRATION_DEFAULTS: Readonly<NarrationSettings> = Object.freeze({ check: "gm", revisions: 2, replyChars: 1500, recentChars: 4000, passageChars: 24_000, changes: 12, changeChars: 400, ownChars: 600, directLine: "own" });

/** Each number's bounds: up to ten revisions; prose windows up to a long chapter; a passage from a paragraph to a chapter; a check's changes from one to forty, each a sentence to a page. */
export const NARRATION_BOUNDS: Readonly<Record<NarrationNumber, readonly [number, number]>> = Object.freeze({ revisions: [0, 10], replyChars: [0, 20_000], recentChars: [0, 40_000], passageChars: [200, 60_000], changes: [1, 40], changeChars: [40, 2000], ownChars: [0, 4000] });

/** Each number of the narration by the label of its row (Settings → Story → Narration): the page shows it, and a refusal that comes from the number names it. */
export const NARRATION_LABELS: Readonly<Record<NarrationNumber, string>> = Object.freeze({
  revisions: "Revisions",
  changes: "Changes a check may ask",
  changeChars: "Longest change",
  replyChars: "The reply so far",
  recentChars: "The chat's recent prose",
  passageChars: "Longest passage",
  ownChars: "Released unchecked",
});

/** `UserSettings.narration` as the engine reads it: each choice one it takes and each number a whole one in its bounds, else `base`'s; a file from before it reads as shipped. */
export function narrationSettingsOf(raw: unknown, base: Readonly<NarrationSettings> = NARRATION_DEFAULTS): NarrationSettings {
  const s = isRecord(raw) ? raw : {};
  const whole = (key: NarrationNumber): number => {
    const v = s[key];
    const [lo, hi] = NARRATION_BOUNDS[key];
    return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : base[key];
  };
  return {
    check: NARRATION_CHECKS.find((c) => c === s.check) ?? base.check,
    revisions: whole("revisions"),
    replyChars: whole("replyChars"),
    recentChars: whole("recentChars"),
    passageChars: whole("passageChars"),
    changes: whole("changes"),
    changeChars: whole("changeChars"),
    ownChars: whole("ownChars"),
    directLine: DIRECT_LINE_PASSAGES.find((d) => d === s.directLine) ?? base.directLine,
  };
}

/** The shipped defaults' revision (`UserSettings.defaults`). */
export const SETTINGS_DEFAULTS_REV = 11;

/** Build's jobs (DESIGN §13.1): the user's own, which no preset sets. */
export interface JobSettings {
  /**
   * The lore Propose routines from lore gives the helper about each person or group, in tokens:
   * whole entries, the most about them first, until the next would pass it; "none" gives all of it.
   * No ceiling: a world with long lore is read as far as the user says.
   */
  routineLoreTokens: Limit;
}

/** A new user's job settings: room for a dozen long entries about each person or group. */
export const JOB_SETTINGS_DEFAULTS: Readonly<JobSettings> = Object.freeze({ routineLoreTokens: 8000 });

/** `UserSettings.jobs` as the engine reads it: each field checked, else `base`'s. */
export function jobSettingsOf(raw: unknown, base: Readonly<JobSettings> = JOB_SETTINGS_DEFAULTS): JobSettings {
  const j = isRecord(raw) ? raw : {};
  return { routineLoreTokens: limitIn(j.routineLoreTokens, 1, Number.MAX_SAFE_INTEGER, base.routineLoreTokens) };
}
