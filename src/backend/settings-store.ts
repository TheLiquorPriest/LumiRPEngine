// User settings (`userStorage/settings.json`), the two preset families (D25; DESIGN §5.3, §9.1) and
// D4 per-connection extraction learning (`userStorage/extraction-learning.json`; DESIGN §11).

import { defaultAdjudication, readAdjudication } from "../shared/adjudication";
import type { DomainId, InterruptPolicy, Level, ModelUsePresetId, RealismPresetId, UserId } from "../shared/ids";
import { BANDS, DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { ExtractionModeView, SettingsResult } from "../shared/protocol";
import type { ExtractionBounds, ExtractionLearning, ExtractionType, ExtractionTypeStats, LookupLimits, LorePolicy, ModelUseSettings, PhaseBudget, RealismSettings, StepConfig, StepLore, StepRoute, TimeSettings, UserSettings } from "../shared/settings";
import { EXTRACTION_DEFAULTS, EXTRACTION_LEARNING, EXTRACTION_TYPES, HELPER_MAX_TOKENS, LORE_POLICIES, LORE_TRANSPORTS, PRE_REPLY_MAX_MS, SPEED_ACTIVITIES, SPEED_DEFAULT, SPEED_THRESHOLD_MINUTES } from "../shared/settings";
import type { BoundMode } from "../shared/ids";
import type { StepPurpose } from "../shared/world";
import { defaultMindsSettings, MINDS_PRESETS, mindsSettingsOf } from "../shared/minds";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

const SETTINGS_PATH = "settings.json";
const LEARNING_PATH = "extraction-learning.json";

export const REALISM_PRESETS: Record<Exclude<RealismPresetId, "custom">, Omit<RealismSettings, "preset">> = {
  story: {
    levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
    tierCaps: { principal: {}, supporting: {}, background: {} },
  },
  grounded: {
    levels: { money: 2, gear: 2, vehicles: 2, castlife: 2, relationships: 2, space: 2, calendar: 3, weather: 2, sheets: 2 },
    tierCaps: { principal: {}, supporting: {}, background: capAll(1) },
  },
  simulation: {
    levels: { money: 4, gear: 4, vehicles: 4, castlife: 4, relationships: 4, space: 4, calendar: 4, weather: 3, sheets: 3 },
    tierCaps: { principal: capAll(4), supporting: capAll(3), background: capAll(2) },
  },
};

function capAll(level: Level): Partial<Record<DomainId, Level>> {
  return { money: level, gear: level, vehicles: level, castlife: level, relationships: level, space: level, calendar: level, weather: level, sheets: level };
}

const DECISION = { provider: "decision", connectionId: null, model: null } as const;
const HELPER = { provider: "helper", connectionId: null, model: null } as const;

function step(enabled: boolean, signals: string[], route: StepConfig["route"], lore?: StepLore): StepConfig {
  return { enabled, signals, ...(route ? { route: { ...route } } : {}), maxTokens: HELPER_MAX_TOKENS, ...(lore ? { lore: { ...lore } } : {}) };
}

const lore = (policy: LorePolicy, tokens: number): StepLore => ({ policy, tokens });
const NO_LOOKUPS: LookupLimits = { calls: 0, ms: 0 };

/**
 * Model-use presets (DESIGN §5.3, §5.4). Routing per D10: `interpret` and `extract` on the helper;
 * `npc.choose` on the Decision connection. `judge` runs only when a world's adjudication policy
 * needs it (the player's words weigh, or the story decides), never on Lean. Lore: Lean prefetches
 * and never looks up; Standard and Full let their decision and JSON steps look lore up on a small
 * budget per phase, apart from the phase's calls; prose steps prefetch only.
 */
export const MODEL_USE_PRESETS: Record<Exclude<ModelUsePresetId, "custom">, Omit<ModelUseSettings, "preset">> = {
  lean: {
    steps: {
      interpret: step(true, ["classifier"], HELPER, lore("prefetch", 200)),
      extract: step(true, ["reply"], HELPER, lore("prefetch", 200)),
      "npc.choose": step(false, [], DECISION, lore("prefetch", 200)),
      judge: step(false, ["always"], HELPER, lore("prefetch", 200)),
    },
    budgets: { pre: { calls: 1, ms: 20_000, lookup: { ...NO_LOOKUPS } }, post: { calls: 1, ms: 30_000, lookup: { ...NO_LOOKUPS } } },
    tokens: { sections: 300 },
  },
  standard: {
    steps: {
      interpret: step(true, ["classifier"], HELPER, lore("prefetch+lookup", 400)),
      extract: step(true, ["reply"], HELPER, lore("prefetch+lookup", 400)),
      "npc.choose": step(true, ["tie_zone", "invitation"], DECISION, lore("prefetch+lookup", 400)),
      judge: step(true, ["always"], HELPER, lore("prefetch+lookup", 400)),
      // Minds run on their own cadence (`UserSettings.minds`): these cards set only where they run and their lore.
      mind: step(true, ["always"], HELPER, lore("prefetch", 400)),
      memory: step(true, ["reply"], HELPER, lore("none", 0)),
      skip: step(true, ["timelapse"], HELPER, lore("prefetch", 300)),
      consolidate: step(true, ["reply"], HELPER, lore("none", 0)),
    },
    budgets: { pre: { calls: 2, ms: 30_000, lookup: { calls: 2, ms: 15_000 } }, post: { calls: 2, ms: 45_000, lookup: { calls: 1, ms: 20_000 } } },
    tokens: { sections: 600 },
  },
  full: {
    steps: {
      interpret: step(true, ["always"], HELPER, lore("prefetch+lookup", 600)),
      brief: step(true, ["always"], HELPER, lore("prefetch", 400)),
      outline: step(true, ["always"], HELPER, lore("prefetch", 400)),
      extract: step(true, ["reply"], HELPER, lore("prefetch+lookup", 600)),
      contradiction: step(true, ["reply"], HELPER, lore("prefetch+lookup", 600)),
      "npc.choose": step(true, ["present", "offscreen"], DECISION, lore("prefetch+lookup", 600)),
      judge: step(true, ["always"], HELPER, lore("prefetch+lookup", 600)),
      mind: step(true, ["always"], HELPER, lore("prefetch", 600)),
      memory: step(true, ["reply"], HELPER, lore("none", 0)),
      skip: step(true, ["timelapse"], HELPER, lore("prefetch", 400)),
      consolidate: step(true, ["reply"], HELPER, lore("none", 0)),
    },
    budgets: { pre: { calls: 8, ms: 60_000, lookup: { calls: 3, ms: 30_000 } }, post: { calls: 4, ms: 60_000, lookup: { calls: 2, ms: 30_000 } } },
    tokens: { sections: 1000 },
  },
};

export function defaultSettings(): UserSettings {
  return {
    v: 1,
    modelUse: { preset: "standard", ...structuredClone(MODEL_USE_PRESETS.standard) },
    realism: { preset: "story", ...structuredClone(REALISM_PRESETS.story) },
    time: {
      sceneTicks: { conversation: 2, action: 1, exploration: 10, downtime: 30 },
      scale: 1,
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "note", arrival: "stop", overdue: "note", needs: "ignore", weather: "ignore" },
      // Every activity Settings → Time lists has the policy it shows.
      speedThrough: Object.fromEntries(SPEED_ACTIVITIES.map((activity) => [activity, { ...SPEED_DEFAULT }])),
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    // New chats start from the world's own realism and time defaults (DESIGN §9.1).
    overrideWorldDefaults: false,
    // A world without a policy plays as every check always has; this fills in only for such worlds.
    adjudication: defaultAdjudication(),
    overrideWorldAdjudication: false,
    extraction: {},
    swipeDefault: "rerun",
    hideJsonBlocks: true,
    minds: defaultMindsSettings(),
  };
}

/** RFC 7386 JSON merge patch: objects merge recursively, `null` deletes, anything else replaces. */
export function mergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  if (!isRecord(patch)) return patch;
  const out: JsonObject = isRecord(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    // A patch from the frontend never reaches a prototype.
    if (!safeKey(k)) continue;
    if (v === null) delete out[k];
    else out[k] = mergePatch(hasOwn(out, k) ? (out[k] ?? null) : null, v);
  }
  return out;
}

/**
 * Fills missing parts from the defaults, so a settings file from an older build still loads; then
 * checks every field. What a file lacks comes from its own preset (Custom fills in from Standard),
 * so one saved before lore settings existed reads with its preset's lore policies and lookups.
 */
function normalize(raw: unknown): UserSettings {
  if (!isRecord(raw)) return defaultSettings();
  // What a file lacks comes from its own named preset: one saved before the judge step or lore
  // settings existed reads with that preset's judge (a Lean player's stays off), lore policies and
  // lookups. Standard and Custom fill in from the defaults, which are Standard's.
  const fill = defaultSettings();
  const preset = isRecord(raw.modelUse) ? raw.modelUse.preset : undefined;
  if (preset === "lean" || preset === "full") {
    fill.modelUse = { preset, ...structuredClone(MODEL_USE_PRESETS[preset]) };
    fill.minds = defaultMindsSettings(preset);
  }
  const merged = mergePatch(JSON.parse(JSON.stringify(fill)) as JsonValue, JSON.parse(JSON.stringify(raw)) as JsonValue);
  return isRecord(merged) && merged.v === 1 ? conform(merged, fill) : defaultSettings();
}

// ---------------------------------------------------------------- the settings schema

const STEP_PURPOSES: readonly StepPurpose[] = ["interpret", "npc.choose", "contradiction", "puzzle.answer", "brief", "outline", "extract", "choices", "judge", "mind", "memory", "skip", "consolidate"];
/** A phase deadline above this is a typo, not a wish (10 min). */
const MAX_PHASE_MS = 600_000;

const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const real = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => values.find((x) => x === v);
const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];
const level = (v: unknown): Level | undefined => LEVELS.find((l) => l === v);
function speedOf(x: unknown): TimeSettings["speedThrough"][string] | undefined {
  if (!isRecord(x)) return undefined;
  const mode = oneOf(x.mode, ["offer", "auto"] as const);
  // Clamped, not refused: a threshold saved before the range held (0 from the old stepper) keeps its policy.
  const [lo, hi] = SPEED_THRESHOLD_MINUTES;
  const raw = real(x.thresholdMinutes, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
  return mode && raw !== undefined ? { mode, thresholdMinutes: Math.round(Math.min(hi, Math.max(lo, raw))) } : undefined;
}
/** An open map's own, safe entries, each checked by `entry` (dropped when it returns undefined). */
function entries<T>(v: unknown, max: number, entry: (value: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, max)) {
    if (!safeKey(k)) continue;
    const checked = entry(x);
    if (checked !== undefined) out[k] = checked;
  }
  return out;
}

function routeOf(v: unknown): StepRoute | undefined {
  if (!isRecord(v)) return undefined;
  const provider = oneOf(v.provider, ["decision", "helper"] as const);
  if (!provider) return undefined;
  const text = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x.slice(0, 200) : null);
  return { provider, connectionId: text(v.connectionId), model: text(v.model) };
}

function loreOf(v: unknown): StepLore | undefined {
  if (!isRecord(v)) return undefined;
  const policy = oneOf(v.policy, LORE_POLICIES);
  const tokens = int(v.tokens, 0, 8000);
  const transport = oneOf(v.transport, LORE_TRANSPORTS);
  return policy && tokens !== undefined ? { policy, tokens, ...(transport ? { transport } : {}) } : undefined;
}

function stepOf(v: unknown, base: StepConfig | undefined): StepConfig | undefined {
  if (!isRecord(v)) return base;
  const route = routeOf(v.route);
  const maxTokens = int(v.maxTokens, 1, 65_536);
  const lore = loreOf(v.lore) ?? base?.lore;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : (base?.enabled ?? false),
    signals: Array.isArray(v.signals) ? v.signals.filter((s): s is string => typeof s === "string").slice(0, 32).map((s) => s.slice(0, 64)) : (base?.signals ?? []),
    ...(route ? { route } : {}),
    ...(typeof v.template === "string" ? { template: v.template.slice(0, 20_000) } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(lore ? { lore: { ...lore } } : {}),
  };
}

/**
 * Settings checked field by field against their schema: a value of the wrong type or out of range
 * falls back to the default, and open maps keep only safe keys (a settings file or a patch is
 * outside data).
 */
function conform(v: JsonObject, d: UserSettings): UserSettings {
  const mu = isRecord(v.modelUse) ? v.modelUse : {};
  const budgets = isRecord(mu.budgets) ? mu.budgets : {};
  // A phase deadline past `max` is read as `max`: the before-the-reply wall clock must leave the plan
  // its part of the host's wait for the context handler, or the host drops the plan.
  const phase = (x: unknown, b: PhaseBudget, max: number): PhaseBudget => {
    if (!isRecord(x)) return b;
    const l = isRecord(x.lookup) ? x.lookup : null;
    const lookup = l ? { calls: int(l.calls, 0, 32) ?? b.lookup?.calls ?? 0, ms: int(l.ms, 0, MAX_PHASE_MS) ?? b.lookup?.ms ?? 0 } : b.lookup;
    return { calls: int(x.calls, 0, 32) ?? b.calls, ms: Math.min(max, int(x.ms, 0, MAX_PHASE_MS) ?? b.ms), ...(lookup ? { lookup: { ...lookup } } : {}) };
  };
  const rawSteps = isRecord(mu.steps) ? mu.steps : {};
  const steps: ModelUseSettings["steps"] = {};
  for (const p of STEP_PURPOSES) {
    const s = hasOwn(rawSteps, p) ? stepOf(rawSteps[p], d.modelUse.steps[p]) : d.modelUse.steps[p];
    if (s) steps[p] = s;
  }
  const tokens = isRecord(mu.tokens) ? mu.tokens : {};
  const modelUse: ModelUseSettings = {
    preset: oneOf(mu.preset, ["lean", "standard", "full", "custom"] as const) ?? d.modelUse.preset,
    steps,
    budgets: { pre: phase(budgets.pre, d.modelUse.budgets.pre, PRE_REPLY_MAX_MS), post: phase(budgets.post, d.modelUse.budgets.post, MAX_PHASE_MS) },
    tokens: { sections: int(tokens.sections, 0, 100_000) ?? d.modelUse.tokens.sections },
  };
  const re = isRecord(v.realism) ? v.realism : {};
  const rawLevels = isRecord(re.levels) ? re.levels : {};
  const levels = { ...d.realism.levels };
  for (const dom of DOMAINS) if (hasOwn(rawLevels, dom)) levels[dom] = level(rawLevels[dom]) ?? d.realism.levels[dom];
  const rawCaps = isRecord(re.tierCaps) ? re.tierCaps : {};
  const tierCaps = structuredClone(d.realism.tierCaps);
  for (const band of BANDS) {
    if (!hasOwn(rawCaps, band)) continue;
    const caps: Partial<Record<DomainId, Level>> = {};
    const raw = rawCaps[band];
    for (const dom of DOMAINS) {
      const l = isRecord(raw) && hasOwn(raw, dom) ? level(raw[dom]) : undefined;
      if (l !== undefined) caps[dom] = l;
    }
    tierCaps[band] = caps;
  }
  const realism: RealismSettings = { preset: oneOf(re.preset, ["story", "grounded", "simulation", "custom"] as const) ?? d.realism.preset, levels, tierCaps };
  const t = isRecord(v.time) ? v.time : {};
  const rawInterrupts = isRecord(t.interrupts) ? t.interrupts : {};
  const interrupts = { ...d.time.interrupts };
  for (const c of INTERRUPT_CLASSES) if (hasOwn(rawInterrupts, c)) interrupts[c] = oneOf<InterruptPolicy>(rawInterrupts[c], ["stop", "note", "ignore"]) ?? d.time.interrupts[c];
  const unitCap = isRecord(t.unitCap) ? t.unitCap : {};
  const time: TimeSettings = {
    // Engine time is whole minutes: a tick between them reads as the minute it plays, so its row stays.
    sceneTicks: isRecord(t.sceneTicks)
      ? entries(t.sceneTicks, 64, (x) => {
          const minutes = real(x, 0, 1440);
          return minutes === undefined ? undefined : Math.round(minutes);
        })
      : d.time.sceneTicks,
    scale: real(t.scale, 0.01, 1000) ?? d.time.scale,
    interrupts,
    speedThrough: isRecord(t.speedThrough) ? entries(t.speedThrough, 64, speedOf) : d.time.speedThrough,
    montage: oneOf(t.montage, ["key", "day", "week"] as const) ?? d.time.montage,
    unitCap: { agentDays: int(unitCap.agentDays, 1, 1_000_000) ?? d.time.unitCap.agentDays, events: int(unitCap.events, 1, 10_000_000) ?? d.time.unitCap.events },
  };
  const rawBounds = isRecord(v.extraction) ? v.extraction : {};
  const extraction: ExtractionBounds = {};
  for (const type of EXTRACTION_TYPES) {
    const b = hasOwn(rawBounds, type) ? rawBounds[type] : undefined;
    const mode = isRecord(b) ? oneOf<BoundMode>(b.mode, ["auto", "confirm", "never"]) : undefined;
    const maxDelta = isRecord(b) ? real(b.maxDelta, 0, 1e12) : undefined;
    if (mode) extraction[type] = { mode, ...(maxDelta !== undefined ? { maxDelta } : {}) };
  }
  return {
    v: 1,
    modelUse,
    realism,
    time,
    overrideWorldDefaults: typeof v.overrideWorldDefaults === "boolean" ? v.overrideWorldDefaults : d.overrideWorldDefaults,
    // A named preset reads as its own values, so choosing one is a whole policy.
    adjudication: readAdjudication(v.adjudication) ?? d.adjudication,
    overrideWorldAdjudication: typeof v.overrideWorldAdjudication === "boolean" ? v.overrideWorldAdjudication : d.overrideWorldAdjudication,
    extraction,
    swipeDefault: oneOf(v.swipeDefault, ["rerun", "renarrate"] as const) ?? d.swipeDefault,
    hideJsonBlocks: typeof v.hideJsonBlocks === "boolean" ? v.hideJsonBlocks : d.hideJsonBlocks,
    minds: mindsSettingsOf(v.minds, d.minds),
  };
}

/** Expands a named preset into its values (the UI sends `custom` with any manual change). */
function expandPresets(settings: UserSettings, patch: JsonObject): UserSettings {
  const out = structuredClone(settings);
  const realism = isRecord(patch.realism) ? patch.realism.preset : undefined;
  if (realism === "story" || realism === "grounded" || realism === "simulation") out.realism = { preset: realism, ...structuredClone(REALISM_PRESETS[realism]) };
  const modelUse = isRecord(patch.modelUse) ? patch.modelUse.preset : undefined;
  if (modelUse === "lean" || modelUse === "standard" || modelUse === "full") {
    out.modelUse = { preset: modelUse, ...structuredClone(MODEL_USE_PRESETS[modelUse]) };
    // A preset is a whole policy for minds too; the user's own prompts and memory overrides stay.
    out.minds = { ...structuredClone(MINDS_PRESETS[modelUse]), memory: out.minds.memory, prompts: out.minds.prompts };
  }
  return out;
}

// ---------------------------------------------------------------- D4 learning

export interface ModeChange {
  connectionId: string;
  type: ExtractionType;
  from: BoundMode;
  to: BoundMode;
}

function emptyStats(): ExtractionTypeStats {
  return { accepted: 0, rejected: 0, recent: "" };
}

/** A connection's stats for a type, own keys only (a connection id is outside data). */
function statsOf(learning: ExtractionLearning, connectionId: string, type: ExtractionType): ExtractionTypeStats | undefined {
  if (!hasOwn(learning.connections, connectionId)) return undefined;
  const byType = learning.connections[connectionId];
  return byType && hasOwn(byType, type) ? byType[type] : undefined;
}

const MODES: readonly BoundMode[] = ["auto", "confirm", "never"];

/**
 * The learning file's valid entries only, as fresh objects: a connection that isn't an object and a
 * type entry with a wrong-typed field are dropped, so counting never writes into a stored value.
 */
function learningFrom(raw: Readonly<Record<string, unknown>>): ExtractionLearning {
  const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const connections: ExtractionLearning["connections"] = {};
  for (const [connectionId, byType] of Object.entries(isRecord(raw.connections) ? raw.connections : {})) {
    if (!safeKey(connectionId) || !isRecord(byType)) continue;
    const kept: Partial<Record<ExtractionType, ExtractionTypeStats>> = {};
    for (const type of EXTRACTION_TYPES) {
      const s = hasOwn(byType, type) ? byType[type] : undefined;
      if (!isRecord(s) || !count(s.accepted) || !count(s.rejected) || typeof s.recent !== "string" || !/^[ar]*$/.test(s.recent)) continue;
      const learned = MODES.find((m) => m === s.learned);
      if ((s.learned !== undefined && !learned) || (s.changedAt !== undefined && typeof s.changedAt !== "number") || (s.holdUntil !== undefined && !count(s.holdUntil))) continue;
      kept[type] = {
        accepted: s.accepted,
        rejected: s.rejected,
        recent: s.recent.slice(-EXTRACTION_LEARNING.window),
        ...(learned ? { learned } : {}),
        ...(typeof s.changedAt === "number" ? { changedAt: s.changedAt } : {}),
        ...(count(s.holdUntil) ? { holdUntil: s.holdUntil } : {}),
      };
    }
    connections[connectionId] = kept;
  }
  return { v: 1, connections };
}

/** The effective mode for a type on a connection, with its source (DESIGN §11 precedence). */
export function effectiveMode(settings: UserSettings, learning: ExtractionLearning, connectionId: string | null, type: ExtractionType): { mode: BoundMode; source: ExtractionModeView["source"] } {
  const pinned = settings.extraction[type];
  if (pinned) return { mode: pinned.mode, source: "pinned" };
  const learned = connectionId ? statsOf(learning, connectionId, type)?.learned : undefined;
  if (learned) return { mode: learned, source: "learned" };
  const cold = EXTRACTION_DEFAULTS[type];
  if (cold) return { mode: cold, source: "default" };
  return { mode: "confirm", source: "bound" };
}

/**
 * Records one chip outcome and applies the D4 rules: promotion at `promoteAt` acceptance over at
 * least `minProposals` outcomes (read from the rolling window), demotion past `demoteUndoRate`.
 * A pinned type is counted but never flips. Returns the flip, if any, for the mode-change chip.
 */
export function recordOutcome(settings: UserSettings, learning: ExtractionLearning, connectionId: string, type: ExtractionType, outcome: "accepted" | "rejected", now: number): ModeChange | null {
  if (!safeKey(connectionId)) return null;
  const byType = hasOwn(learning.connections, connectionId) ? (learning.connections[connectionId] ?? {}) : {};
  learning.connections[connectionId] = byType;
  const stats = statsOf(learning, connectionId, type) ?? emptyStats();
  byType[type] = stats;
  if (outcome === "accepted") stats.accepted++;
  else stats.rejected++;
  stats.recent = `${stats.recent}${outcome === "accepted" ? "a" : "r"}`.slice(-EXTRACTION_LEARNING.window);
  if (settings.extraction[type]) return null;
  const total = stats.accepted + stats.rejected;
  if (stats.holdUntil !== undefined && total < stats.holdUntil) return null;
  const window = stats.recent.length;
  const accepted = [...stats.recent].filter((c) => c === "a").length;
  const current = effectiveMode(settings, learning, connectionId, type).mode;
  let to: BoundMode | null = null;
  if (current === "confirm" && total >= EXTRACTION_LEARNING.minProposals && window >= EXTRACTION_LEARNING.minProposals && accepted / window >= EXTRACTION_LEARNING.promoteAt) to = "auto";
  else if (current === "auto" && window >= EXTRACTION_LEARNING.minProposals && (window - accepted) / window > EXTRACTION_LEARNING.demoteUndoRate) to = "confirm";
  if (!to) return null;
  stats.learned = to;
  stats.changedAt = now;
  return { connectionId, type, from: current, to };
}

/** Undo on a mode-change chip: back to the previous mode, held for another `minProposals` outcomes. */
export function undoModeChange(learning: ExtractionLearning, change: ModeChange): void {
  const stats = statsOf(learning, change.connectionId, change.type);
  if (!stats) return;
  stats.learned = change.from;
  stats.holdUntil = stats.accepted + stats.rejected + EXTRACTION_LEARNING.minProposals;
}

// ---------------------------------------------------------------- the store

export class SettingsStore {
  private readonly settings = new Map<UserId, UserSettings>();
  private readonly learning = new Map<UserId, ExtractionLearning>();

  /** `loaded` hears each user's settings as they are read or set (the context handler's timeout follows them). */
  constructor(
    private readonly host: HostPort,
    private readonly loaded: (userId: UserId, settings: UserSettings) => void = () => undefined,
  ) {}

  async get(userId: UserId): Promise<UserSettings> {
    const known = this.settings.get(userId);
    if (known) return known;
    const raw = await readStoredJson(this.host, SETTINGS_PATH, userId, "settings", (r) => isRecord(r) && r.v === 1);
    const settings = normalize(raw ?? null);
    this.settings.set(userId, settings);
    this.loaded(userId, settings);
    return settings;
  }

  async set(userId: UserId, patch: JsonObject): Promise<UserSettings> {
    const current = await this.get(userId);
    const merged = normalize(mergePatch(JSON.parse(JSON.stringify(current)) as JsonValue, patch));
    const next = expandPresets(merged, patch);
    await this.host.storage.write(`${SETTINGS_PATH}.tmp`, JSON.stringify(next), userId);
    await this.host.storage.move(`${SETTINGS_PATH}.tmp`, SETTINGS_PATH, userId);
    this.settings.set(userId, next);
    this.loaded(userId, next);
    return next;
  }

  /** The settings already loaded for the user (the latest set), without reading storage. */
  known(userId: UserId): UserSettings | undefined {
    return this.settings.get(userId);
  }

  async learningOf(userId: UserId): Promise<ExtractionLearning> {
    const known = this.learning.get(userId);
    if (known) return known;
    const raw = await readStoredJson(this.host, LEARNING_PATH, userId, "extraction learning", (r) => isRecord(r) && r.v === 1 && isRecord(r.connections));
    const learning: ExtractionLearning = isRecord(raw) && raw.v === 1 && isRecord(raw.connections) ? learningFrom(raw) : { v: 1, connections: {} };
    this.learning.set(userId, learning);
    return learning;
  }

  async saveLearning(userId: UserId): Promise<void> {
    const learning = await this.learningOf(userId);
    await this.host.storage.write(`${LEARNING_PATH}.tmp`, JSON.stringify(learning), userId);
    await this.host.storage.move(`${LEARNING_PATH}.tmp`, LEARNING_PATH, userId);
  }

  /** Settings plus each type's effective mode for `connection` and the caveats. */
  async result(userId: UserId, connection: { id: string; name: string } | null, caveats: SettingsResult["caveats"]): Promise<SettingsResult> {
    const settings = await this.get(userId);
    const learning = await this.learningOf(userId);
    const extraction = {} as Record<ExtractionType, ExtractionModeView>;
    for (const type of EXTRACTION_TYPES) {
      const { mode, source } = effectiveMode(settings, learning, connection?.id ?? null, type);
      const stats = connection ? statsOf(learning, connection.id, type) : undefined;
      extraction[type] = { mode, source, connection, accepted: stats?.accepted ?? 0, rejected: stats?.rejected ?? 0 };
    }
    return { settings, extraction, caveats };
  }

  /** The configured step, falling back to the preset's (DESIGN §5.3). */
  async stepConfig(userId: UserId, purpose: StepPurpose): Promise<StepConfig | null> {
    const settings = await this.get(userId);
    return settings.modelUse.steps[purpose] ?? null;
  }
}
