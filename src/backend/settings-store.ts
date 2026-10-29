// User settings (`userStorage/settings.json`), the two preset families (D25; DESIGN §5.3, §9.1) and
// D4 per-connection extraction learning (`userStorage/extraction-learning.json`; DESIGN §11), with
// agent changes' learning per role beside it (AGENT-LOOP-PLAN §6).

import { defaultAdjudication, readAdjudication } from "../shared/adjudication";
import { CLAIM_PRESETS, readClaims } from "../shared/claims";
import { readInferred } from "../shared/inferred";
import type { DomainId, InterruptPolicy, Level, ModelUsePresetId, RealismPresetId, UserId } from "../shared/ids";
import { BANDS, DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { ExtractionModeView, SettingsResult } from "../shared/protocol";
import type { AgentChangeType, ChangeType, ExtractionBounds, ExtractionLearning, ExtractionType, ExtractionTypeStats, GateSettings, HelperDefault, LookupLimits, LorePolicy, ModelUseSettings, PhaseBudget, RealismSettings, RecentHistory, SamplingParams, StepConfig, StepLore, StepRoute, TimeSettings, UserSettings } from "../shared/settings";
import { AGENT_CHANGE_DEFAULTS, AGENT_CHANGE_TYPES, ASK_BEYOND_DEFAULT, CHANGE_TYPES, DEFAULT_HELPER, EXTRACTION_DEFAULTS, EXTRACTION_LEARNING, EXTRACTION_TYPES, LORE_POLICIES, LORE_TRANSPORTS, NARRATOR_DEFAULTS, narratorSettingsOf, REASONING_CHOICES, SAMPLING_PARAMS, SETTINGS_DEFAULTS_REV, SPEED_ACTIVITIES, SPEED_DEFAULT, SPEED_THRESHOLD_MINUTES, TIMELAPSE_REACH_MINUTES, UNREASONED_ROUTE, UNREASONED_STEPS } from "../shared/settings";
import type { BoundMode } from "../shared/ids";
import type { StepPurpose } from "../shared/world";
import { currentSignals } from "../shared/steps";
import type { Limit } from "../shared/minds";
import { defaultMindsSettings, isMindPurpose, migrateMindReads, MINDS_PRESETS, mindsSettingsOf } from "../shared/minds";
import { defaultTimeouts, migrateTimeouts, timeoutsOf } from "../shared/timeouts";
import { JOB_SETTINGS_DEFAULTS, jobSettingsOf, stepConfigOf } from "../shared/settings";
import { type AcceptanceConnection, agentSettingsOf, defaultAgentSettings } from "../shared/agent-settings";
import { MARK_TEXT_IDS, PROMPT_SETTINGS_DEFAULTS, promptSettingsOf, promptsWritten, SWIPE_TEXTS } from "../shared/prompts";
import { DIAGNOSTICS_DEFAULTS, diagnosticsSettingsOf } from "../shared/diagnostics";
import { RETENTION_DEFAULTS, retentionOf } from "../shared/stores";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

const SETTINGS_PATH = "settings.json";
const LEARNING_PATH = "extraction-learning.json";

export const REALISM_PRESETS: Record<Exclude<RealismPresetId, "custom">, Omit<RealismSettings, "preset">> = {
  story: {
    levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
    tierCaps: { principal: {}, supporting: {}, background: {} },
    claims: { ...CLAIM_PRESETS.story },
  },
  grounded: {
    levels: { money: 2, gear: 2, vehicles: 2, castlife: 2, relationships: 2, space: 2, calendar: 3, weather: 2, sheets: 2 },
    tierCaps: { principal: {}, supporting: {}, background: capAll(1) },
    claims: { ...CLAIM_PRESETS.grounded },
  },
  simulation: {
    levels: { money: 4, gear: 4, vehicles: 4, castlife: 4, relationships: 4, space: 4, calendar: 4, weather: 3, sheets: 3 },
    tierCaps: { principal: capAll(4), supporting: capAll(3), background: capAll(2) },
    claims: { ...CLAIM_PRESETS.simulation },
  },
};

function capAll(level: Level): Partial<Record<DomainId, Level>> {
  return { money: level, gear: level, vehicles: level, castlife: level, relationships: level, space: level, calendar: level, weather: level, sheets: level };
}

const DECISION = { provider: "decision", connectionId: null, model: null } as const;
const HELPER = { provider: "helper", connectionId: null, model: null } as const;

function step(enabled: boolean, signals: string[], route: StepConfig["route"], lore?: StepLore): StepConfig {
  // No max tokens of its own: a preset's step runs with the helper model's.
  return { enabled, signals, ...(route ? { route: { ...route } } : {}), ...(lore ? { lore: { ...lore } } : {}) };
}

const lore = (policy: LorePolicy, tokens: number): StepLore => ({ policy, tokens });
const NO_LOOKUPS: LookupLimits = { calls: 0 };

/**
 * Model-use presets (DESIGN §5.3, §5.4). Routing per D10: `interpret` and `extract` on the helper;
 * `npc.choose` on the Decision connection. `interpret` reads every typed message: whether one holds
 * an action is its call, never a word list's. `judge` runs only when a world's adjudication policy
 * needs it (the player's words weigh, or the story decides), never on Lean. Lore: Lean prefetches
 * and never looks up; Standard and Full let their decision and JSON steps look lore up on a budget
 * per phase, apart from the phase's calls; prose steps prefetch only. The tokens and lore are sized
 * for reasoning models on long chats with large lorebooks, where a call takes tens of seconds and
 * thinks before it answers; memory, consolidation, the knowledge step and the time skip's steps don't reason
 * (`UNREASONED_STEPS`). No preset sets a time limit: those are the user's (`UserSettings.timeouts`).
 */
export const MODEL_USE_PRESETS: Record<Exclude<ModelUsePresetId, "custom">, Omit<ModelUseSettings, "preset">> = {
  lean: {
    steps: {
      interpret: step(true, ["typed_input"], HELPER, lore("prefetch", 800)),
      extract: step(true, ["reply"], HELPER, lore("prefetch", 800)),
      "npc.choose": step(false, [], DECISION, lore("prefetch", 800)),
      judge: step(false, ["always"], HELPER, lore("prefetch", 800)),
    },
    budgets: { pre: { calls: 1, lookup: { ...NO_LOOKUPS } }, post: { calls: 1, lookup: { ...NO_LOOKUPS } } },
    tokens: { sections: 2000 },
  },
  standard: {
    steps: {
      interpret: step(true, ["typed_input"], HELPER, lore("prefetch+lookup", 1600)),
      extract: step(true, ["reply"], HELPER, lore("prefetch+lookup", 1600)),
      "npc.choose": step(true, ["tie_zone", "invitation"], DECISION, lore("prefetch+lookup", 1600)),
      judge: step(true, ["always"], HELPER, lore("prefetch+lookup", 1600)),
      // Minds run on their own cadence (`UserSettings.minds`), and what a mind reads, its lore included, is Settings → Minds': these cards set only where they run. The skip step is off until the user turns it on (DESIGN §24.7).
      mind: step(true, ["always"], HELPER),
      memory: step(true, ["reply"], UNREASONED_ROUTE),
      skip: step(false, ["timelapse"], UNREASONED_ROUTE),
      consolidate: step(true, ["reply"], UNREASONED_ROUTE),
      knowledge: step(true, ["reply"], UNREASONED_ROUTE),
    },
    budgets: { pre: { calls: 2, lookup: { calls: 4 } }, post: { calls: 2, lookup: { calls: 3 } } },
    // Detailed sections on a busy scene: a starter's busiest place is about 2,300 tokens, and a room whose lore is told whole (8 to 10 entries, about 3,000) beside a full garage and the rest comes to about 6,000; Lean trims to its 2,000.
    tokens: { sections: 8000 },
  },
  full: {
    steps: {
      interpret: step(true, ["always"], HELPER, lore("prefetch+lookup", 2400)),
      brief: step(true, ["always"], HELPER, lore("prefetch", 1600)),
      outline: step(true, ["always"], HELPER, lore("prefetch", 1600)),
      extract: step(true, ["reply"], HELPER, lore("prefetch+lookup", 2400)),
      "npc.choose": step(true, ["present", "offscreen"], DECISION, lore("prefetch+lookup", 2400)),
      judge: step(true, ["always"], HELPER, lore("prefetch+lookup", 2400)),
      mind: step(true, ["always"], HELPER),
      memory: step(true, ["reply"], UNREASONED_ROUTE),
      skip: step(false, ["timelapse"], UNREASONED_ROUTE),
      consolidate: step(true, ["reply"], UNREASONED_ROUTE),
      knowledge: step(true, ["reply"], UNREASONED_ROUTE),
    },
    budgets: { pre: { calls: 8, lookup: { calls: 6 } }, post: { calls: 4, lookup: { calls: 4 } } },
    tokens: { sections: 12000 },
  },
};

/**
 * The defaults before they rose for reasoning models (`UserSettings.defaults` absent), each old
 * value with the one that replaced it. A file's value that still equals an old default is taken
 * as one the user never changed, and is lifted; any other value is the user's and stays. A step's
 * old 2,000 max tokens is dropped, so the step takes the helper model's.
 */
const LIFTED = {
  maxTokens: 2000,
  loreTokens: new Map([
    [200, 800],
    [300, 1200],
    [400, 1600],
    [600, 2400],
  ]),
  /** Per phase: each preset's old lookups (`calls|ms`), lifted to that preset's new lookup count. */
  lookups: {
    pre: [
      { preset: "standard", was: "2|15000" },
      { preset: "full", was: "3|30000" },
    ],
    post: [
      { preset: "standard", was: "1|20000" },
      { preset: "full", was: "2|30000" },
    ],
  } satisfies Record<"pre" | "post", { preset: Exclude<ModelUsePresetId, "custom">; was: string }[]>,
  sections: new Map([
    [300, MODEL_USE_PRESETS.lean.tokens.sections],
    [600, MODEL_USE_PRESETS.standard.tokens.sections],
    [1000, MODEL_USE_PRESETS.full.tokens.sections],
  ]),
  /** The section budgets before sections told their facts whole (revisions 2 and 3), each lifted to its preset's new one. */
  wholeSections: new Map([
    [4000, MODEL_USE_PRESETS.standard.tokens.sections],
    [8000, MODEL_USE_PRESETS.full.tokens.sections],
  ]),
  /** The Minds section's own budget (`minds.tokens`), which shipped at the sections' values. */
  minds: new Map([
    [300, MINDS_PRESETS.lean.tokens],
    [600, MINDS_PRESETS.standard.tokens],
    [1000, MINDS_PRESETS.full.tokens],
  ]),
};

/**
 * A settings file read against older defaults, with each value still at an old default lifted to
 * its new one. A file from before revision 2 (`defaults` absent) has the values `LIFTED` lists; one
 * from before revision 3 has the steps that no longer reason (`UNREASONED_STEPS`) set to reasoning
 * off where it left their effort to a helper model at its default effort (Inherit): an effort the
 * user chose, the step's or the helper model's, stays; one from revision 2 or 3 has a section budget
 * still at Standard's or Full's old default lifted to its new one, since the sections now tell their
 * facts whole (a file from before revision 2 already lifts to the new ones). Only plain values are
 * touched; anything malformed is left to `conform`.
 */
function lifted(raw: Readonly<Record<string, unknown>>): JsonObject {
  const out = JSON.parse(JSON.stringify(raw)) as JsonObject;
  const rev = typeof out.defaults === "number" ? out.defaults : 0;
  if (rev >= SETTINGS_DEFAULTS_REV) return out;
  const mu = isRecord(out.modelUse) ? out.modelUse : null;
  const lift = (map: ReadonlyMap<number, number>, n: number): number => map.get(n) ?? n;
  if (rev < 2) {
    if (mu && isRecord(mu.steps)) {
      for (const s of Object.values(mu.steps)) {
        if (!isRecord(s)) continue;
        if (s.maxTokens === LIFTED.maxTokens) delete s.maxTokens;
        if (isRecord(s.lore) && typeof s.lore.tokens === "number") s.lore.tokens = lift(LIFTED.loreTokens, s.lore.tokens);
      }
    }
    if (mu && isRecord(mu.budgets)) {
      for (const phase of ["pre", "post"] as const) {
        const b = mu.budgets[phase];
        const l = isRecord(b) && isRecord(b.lookup) ? b.lookup : null;
        const old = l ? LIFTED.lookups[phase].find((x) => x.was === `${String(l.calls)}|${String(l.ms)}`) : undefined;
        if (l && old) l.calls = MODEL_USE_PRESETS[old.preset].budgets[phase].lookup?.calls ?? l.calls;
      }
    }
    if (mu && isRecord(mu.tokens) && typeof mu.tokens.sections === "number") mu.tokens.sections = lift(LIFTED.sections, mu.tokens.sections);
    if (isRecord(out.minds) && typeof out.minds.tokens === "number") out.minds.tokens = lift(LIFTED.minds, out.minds.tokens);
  } else if (mu && isRecord(mu.tokens) && typeof mu.tokens.sections === "number") mu.tokens.sections = lift(LIFTED.wholeSections, mu.tokens.sections);
  const helperEffort = isRecord(out.helper) ? out.helper.effort : undefined;
  if (rev < 3 && mu && isRecord(mu.steps) && (helperEffort === undefined || helperEffort === DEFAULT_HELPER.effort)) {
    for (const purpose of UNREASONED_STEPS) {
      const s = mu.steps[purpose];
      const route = isRecord(s) ? s.route : undefined;
      if (isRecord(route) && route.provider === "helper" && !hasOwn(route, "effort")) route.effort = "off";
    }
  }
  out.defaults = SETTINGS_DEFAULTS_REV;
  return out;
}

export function defaultSettings(): UserSettings {
  return {
    v: 1,
    defaults: SETTINGS_DEFAULTS_REV,
    helper: { ...DEFAULT_HELPER, params: {} },
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
      askBeyondMinutes: ASK_BEYOND_DEFAULT,
    },
    // New chats start from the world's own realism and time defaults (DESIGN §9.1).
    overrideWorldDefaults: false,
    // A world without a policy plays as every check always has; this fills in only for such worlds.
    adjudication: defaultAdjudication(),
    overrideWorldAdjudication: false,
    // New chats play inferred checks by their realism preset and Sheets level until the user picks a policy.
    inferred: null,
    extraction: {},
    swipeDefault: "rerun",
    // A Re-narrate keeps the texts its turn was made with until the user picks their current ones.
    swipeTexts: "turn",
    hideJsonBlocks: true,
    minds: defaultMindsSettings(),
    timeouts: defaultTimeouts(),
    jobs: { ...JOB_SETTINGS_DEFAULTS },
    // A turn plays as soon as it is read until the player asks to see it first.
    gates: { intent: false, outline: false },
    // The agent runtime's own: no classic turn reads them (AGENT-LOOP-PLAN §15).
    agents: defaultAgentSettings(),
    // Every text is the shipped one until the user writes their own.
    prompts: { texts: {}, maxChars: PROMPT_SETTINGS_DEFAULTS.maxChars },
    // A write made while the engine runs lands at once and the turn's reply doesn't start, as it always has (DESIGN §4.3 P2).
    holdWrites: false,
    // The agent stores keep a call's text a month and a blob nothing references a week, swept daily.
    retention: { ...RETENTION_DEFAULTS },
    diagnostics: { ...DIAGNOSTICS_DEFAULTS },
    // The narrator knows what everyone in the scene knows, secrets marked, in every chat that sets nothing of its own.
    narrator: { ...NARRATOR_DEFAULTS },
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
 * A settings file from before a secret's mark wording was a text of the prompt registry (DESIGN
 * §6.12): each part of its `narrator.marks` becomes the user's own text of that part
 * (`MARK_TEXT_IDS`; `marks.rule`, the narrator rules' sentence, is `narrator.secret_marks`), unless the
 * file already holds a text there. The moved texts are then read as any of the user's own
 * (`promptSettingsOf`), so the wording the user had stays theirs. Only a stored file is moved: a write
 * that sends `narrator.marks` sends a key Settings no longer has. The file keeps the field, as each
 * write makes it again (`storedForm`), for a build from before the move to read.
 */
function migrateMarkWording(raw: unknown): unknown {
  if (!isRecord(raw) || !isRecord(raw.narrator) || !hasOwn(raw.narrator, "marks")) return raw;
  const { marks, ...narrator } = raw.narrator;
  const prompts = isRecord(raw.prompts) ? raw.prompts : {};
  const texts: Record<string, unknown> = isRecord(prompts.texts) ? { ...prompts.texts } : {};
  if (isRecord(marks)) {
    for (const [part, id] of Object.entries(MARK_TEXT_IDS)) {
      const text = marks[part];
      if (typeof text === "string" && typeof texts[id] !== "string") texts[id] = text;
    }
  }
  return { ...raw, narrator, prompts: { ...prompts, texts } };
}

/**
 * The settings as their file stores them: with the user's own mark wording also under
 * `narrator.marks`, where a build from before the wording was a registry text (Increment 0) reads
 * it, so going back to one keeps the wording. It is made from the user's texts on each write, so a
 * part set back to the shipped one is gone from it too, and this build reads it only for a part its
 * texts don't hold (`migrateMarkWording`), which then never happens.
 */
function storedForm(settings: UserSettings): unknown {
  const marks: Record<string, string> = {};
  for (const [part, id] of Object.entries(MARK_TEXT_IDS)) {
    const text = settings.prompts.texts[id];
    if (text !== undefined) marks[part] = text;
  }
  return Object.keys(marks).length === 0 ? settings : { ...settings, narrator: { ...settings.narrator, marks } };
}

/**
 * Fills missing parts from the defaults, so a settings file from an older build still loads; then
 * checks every field. What a file lacks comes from its own preset (Custom fills in from Standard),
 * so one saved before lore settings existed reads with its preset's lore policies and lookups; one
 * saved before timeouts had their own settings takes them from its old budgets (`migrateTimeouts`),
 * after `lifted` has read the old lookup windows it matches presets by; and one saved before minds
 * had what they read takes the limits its reply allowance and its mind card's lore set
 * (`migrateMindReads`), after `lifted` has raised that lore's old defaults. A step's route is the
 * file's own where it has one: an effort or sampling parameter it leaves out is the helper model's,
 * never the preset's (a preset sets the effort of the steps that don't reason).
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
  // A file saved before player claims existed plays them as its named realism preset does.
  const realism = isRecord(raw.realism) ? raw.realism.preset : undefined;
  if (realism === "grounded" || realism === "simulation") fill.realism.claims = { ...CLAIM_PRESETS[realism] };
  const own = migrateTimeouts(migrateMindReads(lifted(raw)));
  const merged = mergePatch(JSON.parse(JSON.stringify(fill)) as JsonValue, own);
  const ownSteps = isRecord(own.modelUse) && isRecord(own.modelUse.steps) ? own.modelUse.steps : null;
  const mergedSteps = isRecord(merged) && isRecord(merged.modelUse) && isRecord(merged.modelUse.steps) ? merged.modelUse.steps : null;
  if (ownSteps && mergedSteps) {
    for (const purpose of STEP_PURPOSES) {
      const s = ownSteps[purpose];
      const step = mergedSteps[purpose];
      if (isRecord(s) && isRecord(s.route) && isRecord(step)) step.route = s.route;
    }
  }
  return isRecord(merged) && merged.v === 1 ? conform(merged, fill) : defaultSettings();
}

// ---------------------------------------------------------------- the settings schema

const STEP_PURPOSES: readonly StepPurpose[] = ["interpret", "npc.choose", "puzzle.answer", "brief", "outline", "extract", "choices", "judge", "mind", "memory", "skip", "consolidate", "knowledge"];

const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
/** A token or call budget: a whole number from `lo` (below it the budget can't work), with no ceiling. */
const atLeast = (v: unknown, lo: number): number | undefined => int(v, lo, Number.MAX_SAFE_INTEGER);
const real = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
/**
 * How long a skip runs without asking, as stored: whole minutes from 0 (every skip asks) up to the
 * timelapse's 366-day reach, the only ceiling, so a longer one keeps that much; anything else isn't one.
 */
function askBeyondOf(v: unknown): number | undefined {
  const minutes = real(v, 0, Number.POSITIVE_INFINITY);
  return minutes === undefined ? undefined : Math.min(TIMELAPSE_REACH_MINUTES, Math.round(minutes));
}
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

const text = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x.slice(0, 200) : null);

/** Sampling parameters, each within its range; one out of range or of the wrong type is left out. */
function paramsOf(v: unknown): SamplingParams {
  const out: SamplingParams = {};
  if (!isRecord(v)) return out;
  for (const p of SAMPLING_PARAMS) {
    const x = real(v[p.key], p.min, p.max);
    if (x !== undefined) out[p.key] = p.integer ? Math.round(x) : x;
  }
  return out;
}

function routeOf(v: unknown): StepRoute | undefined {
  if (!isRecord(v)) return undefined;
  const provider = oneOf(v.provider, ["decision", "helper"] as const);
  if (!provider) return undefined;
  const effort = oneOf(v.effort, REASONING_CHOICES);
  const params = paramsOf(v.params);
  return { provider, connectionId: text(v.connectionId), model: text(v.model), ...(effort ? { effort } : {}), ...(Object.keys(params).length > 0 ? { params } : {}) };
}

function helperOf(v: unknown, d: Readonly<HelperDefault>): HelperDefault {
  if (!isRecord(v)) return { ...d, params: { ...d.params } };
  return { connectionId: text(v.connectionId), model: text(v.model), effort: oneOf(v.effort, REASONING_CHOICES) ?? d.effort, maxTokens: atLeast(v.maxTokens, 1) ?? d.maxTokens, params: paramsOf(v.params) };
}

function loreOf(v: unknown): StepLore | undefined {
  if (!isRecord(v)) return undefined;
  const policy = oneOf(v.policy, LORE_POLICIES);
  const tokens = atLeast(v.tokens, 0);
  const transport = oneOf(v.transport, LORE_TRANSPORTS);
  return policy && tokens !== undefined ? { policy, tokens, ...(transport ? { transport } : {}) } : undefined;
}

/** The steps whose own prompt is Settings → Minds' (`minds.prompts`), not their card's `template`. */
const OWN_PROMPT_ELSEWHERE: Partial<Record<StepPurpose, true>> = { mind: true, memory: true, consolidate: true, knowledge: true };

/**
 * A step's settings, checked; a signal an earlier build had reads as the one that stands for it now
 * (`currentSignals`), so a step on `classifier` runs on every typed message and anything else the
 * user chose stays. A minds step keeps no lore and no recent history of its own: what a mind reads is
 * Settings → Minds' (`minds.reads`, which an older mind card's lore moved into), the lore pinned to
 * the other minds steps aside, and the recent chat they read is its Recent chat. `template` is the
 * user's own prompt for the step; a mind's, a memory's, consolidation's and the knowledge step's are Settings → Minds'
 * (`minds.prompts`), so theirs isn't kept, and the time-skip step's is the skip plan's (its beats'
 * is Settings → Minds' too).
 */
function stepOf(v: unknown, base: StepConfig | undefined, purpose: StepPurpose): StepConfig | undefined {
  if (!isRecord(v)) return base;
  const route = routeOf(v.route);
  const maxTokens = atLeast(v.maxTokens, 1);
  const lore = isMindPurpose(purpose) ? undefined : (loreOf(v.lore) ?? base?.lore);
  const recent = isMindPurpose(purpose) ? undefined : (recentHistoryOf(v.recent) ?? base?.recent);
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : (base?.enabled ?? false),
    signals: currentSignals(Array.isArray(v.signals) ? v.signals.filter((s): s is string => typeof s === "string").slice(0, 32).map((s) => s.slice(0, 64)) : (base?.signals ?? [])),
    ...(route ? { route } : {}),
    ...(typeof v.template === "string" && !OWN_PROMPT_ELSEWHERE[purpose] ? { template: v.template.slice(0, 20_000) } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(lore ? { lore: { ...lore } } : {}),
    ...(recent ? { recent: { ...recent } } : {}),
  };
}

/**
 * How much history a step reads: whole numbers from 0 or `"none"` (no limit), with no ceiling; one
 * that isn't reads as unset. Saved before the switch, only `interpret` had it, so a missing `on` reads on.
 */
function recentHistoryOf(v: unknown): RecentHistory | undefined {
  if (!isRecord(v)) return undefined;
  const limit = (x: unknown): Limit | undefined => (x === "none" ? "none" : atLeast(x, 0));
  const messages = limit(v.messages);
  const tokens = limit(v.tokens);
  return messages !== undefined && tokens !== undefined ? { on: typeof v.on === "boolean" ? v.on : true, messages, tokens } : undefined;
}

/**
 * Settings checked field by field against their schema: a value of the wrong type or out of range
 * falls back to the default, and open maps keep only safe keys (a settings file or a patch is
 * outside data).
 */
function conform(v: JsonObject, d: UserSettings): UserSettings {
  const mu = isRecord(v.modelUse) ? v.modelUse : {};
  const budgets = isRecord(mu.budgets) ? mu.budgets : {};
  const phase = (x: unknown, b: PhaseBudget): PhaseBudget => {
    if (!isRecord(x)) return b;
    const l = isRecord(x.lookup) ? x.lookup : null;
    const lookup = l ? { calls: atLeast(l.calls, 0) ?? b.lookup?.calls ?? 0 } : b.lookup;
    return { calls: atLeast(x.calls, 0) ?? b.calls, ...(lookup ? { lookup: { ...lookup } } : {}) };
  };
  const rawSteps = isRecord(mu.steps) ? mu.steps : {};
  const steps: ModelUseSettings["steps"] = {};
  for (const p of STEP_PURPOSES) {
    const s = hasOwn(rawSteps, p) ? stepOf(rawSteps[p], d.modelUse.steps[p], p) : d.modelUse.steps[p];
    if (s) steps[p] = s;
  }
  const tokens = isRecord(mu.tokens) ? mu.tokens : {};
  const modelUse: ModelUseSettings = {
    preset: oneOf(mu.preset, ["lean", "standard", "full", "custom"] as const) ?? d.modelUse.preset,
    steps,
    budgets: { pre: phase(budgets.pre, d.modelUse.budgets.pre), post: phase(budgets.post, d.modelUse.budgets.post) },
    tokens: { sections: atLeast(tokens.sections, 0) ?? d.modelUse.tokens.sections },
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
  const realism: RealismSettings = { preset: oneOf(re.preset, ["story", "grounded", "simulation", "custom"] as const) ?? d.realism.preset, levels, tierCaps, claims: readClaims(re.claims) ?? { ...d.realism.claims } };
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
    askBeyondMinutes: askBeyondOf(t.askBeyondMinutes) ?? d.time.askBeyondMinutes,
  };
  const rawBounds = isRecord(v.extraction) ? v.extraction : {};
  const extraction: ExtractionBounds = {};
  for (const type of CHANGE_TYPES) {
    const b = hasOwn(rawBounds, type) ? rawBounds[type] : undefined;
    const mode = isRecord(b) ? oneOf<BoundMode>(b.mode, ["auto", "confirm", "never"]) : undefined;
    // An agent change type is a mode only: no field bound applies to it.
    const maxDelta = isRecord(b) && !isAgentChangeType(type) ? real(b.maxDelta, 0, 1e12) : undefined;
    if (mode) extraction[type] = { mode, ...(maxDelta !== undefined ? { maxDelta } : {}) };
  }
  return {
    v: 1,
    defaults: SETTINGS_DEFAULTS_REV,
    helper: helperOf(v.helper, d.helper),
    modelUse,
    realism,
    time,
    overrideWorldDefaults: typeof v.overrideWorldDefaults === "boolean" ? v.overrideWorldDefaults : d.overrideWorldDefaults,
    // Read as a world's policy is: values that differ from its named preset make it Custom.
    adjudication: readAdjudication(v.adjudication) ?? d.adjudication,
    overrideWorldAdjudication: typeof v.overrideWorldAdjudication === "boolean" ? v.overrideWorldAdjudication : d.overrideWorldAdjudication,
    // A policy that names no mode (or none at all) leaves new chats to their realism preset.
    inferred: readInferred(v.inferred),
    extraction,
    swipeDefault: oneOf(v.swipeDefault, ["rerun", "renarrate"] as const) ?? d.swipeDefault,
    swipeTexts: oneOf(v.swipeTexts, SWIPE_TEXTS) ?? d.swipeTexts,
    hideJsonBlocks: typeof v.hideJsonBlocks === "boolean" ? v.hideJsonBlocks : d.hideJsonBlocks,
    minds: mindsSettingsOf(v.minds, d.minds),
    timeouts: timeoutsOf(v.timeouts, d.timeouts),
    jobs: jobSettingsOf(v.jobs, d.jobs),
    gates: gatesOf(v.gates, d.gates),
    agents: agentSettingsOf(v.agents, d.agents),
    prompts: promptSettingsOf(v.prompts, d.prompts),
    holdWrites: typeof v.holdWrites === "boolean" ? v.holdWrites : d.holdWrites,
    retention: retentionOf(v.retention, d.retention),
    diagnostics: diagnosticsSettingsOf(v.diagnostics, d.diagnostics),
    narrator: narratorSettingsOf(v.narrator, d.narrator),
  };
}

/** The preview gates as stored: a switch that isn't a boolean keeps its default (off). */
function gatesOf(value: unknown, d: GateSettings): GateSettings {
  const v = isRecord(value) ? value : {};
  return { intent: typeof v.intent === "boolean" ? v.intent : d.intent, outline: typeof v.outline === "boolean" ? v.outline : d.outline };
}

/**
 * Expands a named preset into its values (the UI sends `custom` with any manual change). A named
 * checks preset is the patch's policy alone: what the patch leaves out comes from that preset, not
 * from the policy before it, and values the patch sets with it make it Custom.
 */
function expandPresets(settings: UserSettings, patch: JsonObject): UserSettings {
  const out = structuredClone(settings);
  const adjudication = isRecord(patch.adjudication) && patch.adjudication.preset !== "custom" ? readAdjudication(patch.adjudication) : null;
  if (adjudication) out.adjudication = adjudication;
  const realism = isRecord(patch.realism) ? patch.realism.preset : undefined;
  if (realism === "story" || realism === "grounded" || realism === "simulation") out.realism = { preset: realism, ...structuredClone(REALISM_PRESETS[realism]) };
  const modelUse = isRecord(patch.modelUse) ? patch.modelUse.preset : undefined;
  if (modelUse === "lean" || modelUse === "standard" || modelUse === "full") {
    const before = out.modelUse.steps;
    out.modelUse = { preset: modelUse, ...structuredClone(MODEL_USE_PRESETS[modelUse]) };
    // A preset sets how steps run, never what they say: the user's own prompt for each step stays,
    // as their minds prompts do.
    for (const purpose of STEP_PURPOSES) {
      const template = before[purpose]?.template;
      if (template !== undefined) out.modelUse.steps[purpose] = { ...stepConfigOf(out.modelUse.steps, purpose), template };
    }
    // A preset is a whole policy for minds too; what a mind reads, the user's own prompts, memory overrides and knowledge stay.
    out.minds = { ...structuredClone(MINDS_PRESETS[modelUse]), reads: out.minds.reads, memory: out.minds.memory, prompts: out.minds.prompts, knowledge: out.minds.knowledge };
  }
  return out;
}

// ---------------------------------------------------------------- D4 learning

/**
 * A flip D4 learning made, of the type it was counted for: a reply's type (`ExtractionType`) from the
 * extract step's chips, whose mode-change chip the chat shows; an agent's type under its role, which
 * no chip announces, since the chat is a player surface.
 */
export interface ModeChange<T extends ChangeType = ChangeType> {
  connectionId: string;
  type: T;
  from: BoundMode;
  to: BoundMode;
  /** The agent role whose learning flipped (AGENT-LOOP-PLAN §6); absent for the extract step's. */
  role?: string;
}

/** Whether a change type is an agent's (AGENT-LOOP-PLAN §6) rather than a reply's. */
function isAgentChangeType(type: ChangeType): type is AgentChangeType {
  return AGENT_CHANGE_TYPES.some((t) => t === type);
}

function emptyStats(): ExtractionTypeStats {
  return { accepted: 0, rejected: 0, recent: "" };
}

/**
 * A type's stats on a connection, own keys only (role and connection ids are outside data): under
 * `role` when one is given, else the extract step's per-connection learning.
 */
function statsFor(learning: ExtractionLearning, connectionId: string, type: ChangeType, role?: string): ExtractionTypeStats | undefined {
  let byType: Partial<Record<ChangeType, ExtractionTypeStats>> | undefined;
  if (role === undefined) {
    if (!hasOwn(learning.connections, connectionId)) return undefined;
    byType = learning.connections[connectionId];
  } else {
    const roles = learning.roles;
    if (!roles || !hasOwn(roles, role)) return undefined;
    const byConnection = roles[role];
    if (!byConnection || !hasOwn(byConnection, connectionId)) return undefined;
    byType = byConnection[connectionId];
  }
  return byType && hasOwn(byType, type) ? byType[type] : undefined;
}

const MODES: readonly BoundMode[] = ["auto", "confirm", "never"];

/**
 * The learning file's valid entries only, as fresh objects: a role or connection that isn't an
 * object or has an unsafe id, and a type entry with a wrong-typed field, are dropped, so counting
 * never writes into a stored value. A file without `roles` reads back without it.
 */
function learningFrom(raw: Readonly<Record<string, unknown>>): ExtractionLearning {
  const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const statsFrom = (s: unknown): ExtractionTypeStats | undefined => {
    if (!isRecord(s) || !count(s.accepted) || !count(s.rejected) || typeof s.recent !== "string" || !/^[ar]*$/.test(s.recent)) return undefined;
    const learned = MODES.find((m) => m === s.learned);
    if ((s.learned !== undefined && !learned) || (s.changedAt !== undefined && typeof s.changedAt !== "number") || (s.holdUntil !== undefined && !count(s.holdUntil))) return undefined;
    return {
      accepted: s.accepted,
      rejected: s.rejected,
      recent: s.recent.slice(-EXTRACTION_LEARNING.window),
      ...(learned ? { learned } : {}),
      ...(typeof s.changedAt === "number" ? { changedAt: s.changedAt } : {}),
      ...(count(s.holdUntil) ? { holdUntil: s.holdUntil } : {}),
    };
  };
  const connections: ExtractionLearning["connections"] = {};
  for (const [connectionId, byType] of Object.entries(isRecord(raw.connections) ? raw.connections : {})) {
    if (!safeKey(connectionId) || !isRecord(byType)) continue;
    const kept: Partial<Record<ExtractionType, ExtractionTypeStats>> = {};
    for (const type of EXTRACTION_TYPES) {
      const stats = statsFrom(hasOwn(byType, type) ? byType[type] : undefined);
      if (stats) kept[type] = stats;
    }
    connections[connectionId] = kept;
  }
  if (!isRecord(raw.roles)) return { v: 1, connections };
  const roles: NonNullable<ExtractionLearning["roles"]> = {};
  for (const [role, byConnection] of Object.entries(raw.roles)) {
    if (!safeKey(role) || !isRecord(byConnection)) continue;
    const keptConnections: Record<string, Partial<Record<ChangeType, ExtractionTypeStats>>> = {};
    for (const [connectionId, byType] of Object.entries(byConnection)) {
      if (!safeKey(connectionId) || !isRecord(byType)) continue;
      const kept: Partial<Record<ChangeType, ExtractionTypeStats>> = {};
      for (const type of CHANGE_TYPES) {
        const stats = statsFrom(hasOwn(byType, type) ? byType[type] : undefined);
        if (stats) kept[type] = stats;
      }
      keptConnections[connectionId] = kept;
    }
    roles[role] = keptConnections;
  }
  return { v: 1, connections, roles };
}

/**
 * The effective mode for a type on a connection, with its source (DESIGN §11 precedence): pinned,
 * then learned (under `role` when an agent's change is asked about), then the type's default.
 */
export function effectiveMode(settings: UserSettings, learning: ExtractionLearning, connectionId: string | null, type: ChangeType, role?: string): { mode: BoundMode; source: ExtractionModeView["source"] } {
  const pinned = settings.extraction[type];
  if (pinned) return { mode: pinned.mode, source: "pinned" };
  const learned = connectionId ? statsFor(learning, connectionId, type, role)?.learned : undefined;
  if (learned) return { mode: learned, source: "learned" };
  const cold = isAgentChangeType(type) ? AGENT_CHANGE_DEFAULTS[type] : EXTRACTION_DEFAULTS[type];
  if (cold) return { mode: cold, source: "default" };
  return { mode: "confirm", source: "bound" };
}

/**
 * Records one chip outcome and applies the D4 rules: promotion at `promoteAt` acceptance over at
 * least `minProposals` outcomes (read from the rolling window), demotion past `demoteUndoRate`.
 * A pinned type is counted but never flips. Returns the flip, if any, for the mode-change chip.
 * An agent's outcome counts under its `role` (AGENT-LOOP-PLAN §6); one with no role counts on the
 * connection only for an extraction type, so an agent type with no role records nothing. `undone`
 * takes back an outcome counted accepted (an agent's change applied, then undone): it counts as
 * rejected instead, so a proposal still counts once.
 */
export function recordOutcome<T extends ChangeType>(settings: UserSettings, learning: ExtractionLearning, connectionId: string, type: T, outcome: "accepted" | "rejected" | "undone", now: number, role?: string): ModeChange<T> | null {
  if (!safeKey(connectionId)) return null;
  let byType: Partial<Record<ChangeType, ExtractionTypeStats>>;
  if (role === undefined) {
    if (isAgentChangeType(type)) return null;
    const kept = hasOwn(learning.connections, connectionId) ? (learning.connections[connectionId] ?? {}) : {};
    learning.connections[connectionId] = kept;
    byType = kept;
  } else {
    if (!safeKey(role)) return null;
    const roles = learning.roles ?? {};
    learning.roles = roles;
    const byConnection = hasOwn(roles, role) ? (roles[role] ?? {}) : {};
    roles[role] = byConnection;
    byType = hasOwn(byConnection, connectionId) ? (byConnection[connectionId] ?? {}) : {};
    byConnection[connectionId] = byType;
  }
  const stats = statsFor(learning, connectionId, type, role) ?? emptyStats();
  byType[type] = stats;
  if (outcome === "undone" && stats.accepted > 0) {
    stats.accepted--;
    stats.rejected++;
    const at = stats.recent.lastIndexOf("a");
    stats.recent = at >= 0 ? `${stats.recent.slice(0, at)}r${stats.recent.slice(at + 1)}` : `${stats.recent}r`.slice(-EXTRACTION_LEARNING.window);
  } else {
    if (outcome === "accepted") stats.accepted++;
    else stats.rejected++;
    stats.recent = `${stats.recent}${outcome === "accepted" ? "a" : "r"}`.slice(-EXTRACTION_LEARNING.window);
  }
  if (settings.extraction[type]) return null;
  const total = stats.accepted + stats.rejected;
  if (stats.holdUntil !== undefined && total < stats.holdUntil) return null;
  const window = stats.recent.length;
  const accepted = [...stats.recent].filter((c) => c === "a").length;
  const current = effectiveMode(settings, learning, connectionId, type, role).mode;
  let to: BoundMode | null = null;
  if (current === "confirm" && total >= EXTRACTION_LEARNING.minProposals && window >= EXTRACTION_LEARNING.minProposals && accepted / window >= EXTRACTION_LEARNING.promoteAt) to = "auto";
  else if (current === "auto" && window >= EXTRACTION_LEARNING.minProposals && (window - accepted) / window > EXTRACTION_LEARNING.demoteUndoRate) to = "confirm";
  if (!to) return null;
  stats.learned = to;
  stats.changedAt = now;
  return { connectionId, type, from: current, to, ...(role !== undefined ? { role } : {}) };
}

/** Undo on a mode-change chip: back to the previous mode, held for another `minProposals` outcomes. */
export function undoModeChange(learning: ExtractionLearning, change: ModeChange): void {
  const stats = statsFor(learning, change.connectionId, change.type, change.role);
  if (!stats) return;
  stats.learned = change.from;
  stats.holdUntil = stats.accepted + stats.rejected + EXTRACTION_LEARNING.minProposals;
}

// ---------------------------------------------------------------- the store

/**
 * What the acceptance runs' file holds of the connections they guard (`AgentAccounts.guard`): its
 * list, undefined until one was kept there; `lost`, the file was damaged and set aside and no list
 * was kept since; `setAside`, that was found as this read took it in, when the settings' own copy of
 * the list may stand for it (one written later, while the guard was unknown, says nothing).
 */
export interface GuardRead {
  connections: readonly AcceptanceConnection[] | undefined;
  lost: boolean;
  setAside: boolean;
}

/**
 * Where the connections acceptance runs guard are kept apart from the settings file (the runs'
 * own, `AgentAccounts`): read over the file's own list, and kept there on each change. `get` throws
 * when that file can't be read.
 */
export interface AcceptanceGuardStore {
  get(userId: UserId): Promise<GuardRead>;
  set(userId: UserId, connections: readonly AcceptanceConnection[]): Promise<void>;
}

/** Whether a settings file holds its own copy of the connections acceptance runs guard: a build from before the agents writes none. */
function hasGuardCopy(raw: unknown): boolean {
  return isRecord(raw) && isRecord(raw.agents) && isRecord(raw.agents.acceptance) && Array.isArray(raw.agents.acceptance.connections);
}

export class SettingsStore {
  private readonly settings = new Map<UserId, UserSettings>();
  private readonly learning = new Map<UserId, ExtractionLearning>();
  private readonly revisions = new Map<UserId, number>();

  /** `loaded` hears each user's settings as they are read or set (the context handler's timeout follows them); `guards` keeps the acceptance runs' guard apart from the settings file. */
  constructor(
    private readonly host: HostPort,
    private readonly loaded: (userId: UserId, settings: UserSettings) => void = () => undefined,
    private readonly guards: AcceptanceGuardStore | null = null,
  ) {}

  async get(userId: UserId): Promise<UserSettings> {
    return (await this.read(userId)).settings;
  }

  /**
   * The user's settings, and whether they are kept: not while which connections acceptance runs
   * guard is unknown (`withGuard`), so each read tries the guard again. The rest of them serve all
   * the same (a classic turn reads them), and `loaded` hears them on each read.
   */
  private async read(userId: UserId): Promise<{ settings: UserSettings; kept: boolean }> {
    const known = this.settings.get(userId);
    if (known) return { settings: known, kept: true };
    const raw = await readStoredJson(this.host, SETTINGS_PATH, userId, "settings", (r) => isRecord(r) && r.v === 1);
    const settings = normalize(migrateMarkWording(raw ?? null));
    const kept = await this.withGuard(userId, settings, hasGuardCopy(raw));
    if (kept) this.settings.set(userId, settings);
    this.loaded(userId, settings);
    return { settings, kept };
  }

  /**
   * The connections acceptance runs guard, as `guards` keeps them, over the settings file's own
   * list (`copy`: whether the file holds one): a build from before the agents writes the settings
   * without them, and the guard holds all the same. A list only the settings file holds (kept before
   * the guard was kept apart) moves there; one that can't be moved yet is read from the settings
   * file, and moved on a later start. False while which connections are guarded is unknown: the
   * runs' file can't be read, or it was lost with no copy here from before to stand for it; every
   * agent call is refused meanwhile (`AgentAccounts.reserve`).
   */
  private async withGuard(userId: UserId, settings: UserSettings, copy: boolean): Promise<boolean> {
    if (!this.guards) return true;
    let read: GuardRead;
    try {
      read = await this.guards.get(userId);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] the acceptance runs' file couldn't be read (${error instanceof Error ? error.message : String(error)}): which connections they guard isn't known, and no agent call goes until it can be read`, userId);
      return false;
    }
    if (read.connections !== undefined) {
      settings.agents.acceptance.connections = read.connections.map((c) => ({ ...c }));
      return true;
    }
    // A lost guard is known again only from the copy the settings held as it was lost.
    if (read.lost && !(read.setAside && copy)) return false;
    if (read.lost || settings.agents.acceptance.connections.length > 0) {
      await this.guards.set(userId, settings.agents.acceptance.connections).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the connections acceptance runs guard weren't kept beside the runs (${error instanceof Error ? error.message : String(error)}); they are read from the settings until they are`, userId));
    }
    return true;
  }

  /**
   * Sets the user's settings to what `patch` makes of them. `check` sees the settings before and
   * after and may refuse the write by throwing (a guard on what a caller may change, however its
   * patch says it). A change to the acceptance runs' guard is kept apart (`guards`) before the
   * settings file is written, and makes a guard that was unknown known again; till then the
   * settings aren't kept, as `read` keeps none.
   */
  async set(userId: UserId, patch: JsonObject, check?: (current: Readonly<UserSettings>, next: Readonly<UserSettings>) => void): Promise<UserSettings> {
    const { settings: current, kept } = await this.read(userId);
    const merged = normalize(mergePatch(JSON.parse(JSON.stringify(current)) as JsonValue, patch));
    const next = expandPresets(merged, patch);
    // A text of the user's own is stored only as it can be sent: one this write changed that can't be stays as it was.
    next.prompts = promptsWritten(current.prompts, next.prompts);
    check?.(current, next);
    const guard = JSON.stringify(next.agents.acceptance.connections) !== JSON.stringify(current.agents.acceptance.connections);
    if (this.guards && guard) await this.guards.set(userId, next.agents.acceptance.connections);
    await this.host.storage.write(`${SETTINGS_PATH}.tmp`, JSON.stringify(storedForm(next)), userId);
    await this.host.storage.move(`${SETTINGS_PATH}.tmp`, SETTINGS_PATH, userId);
    if (kept || guard) this.settings.set(userId, next);
    this.revisions.set(userId, this.revision(userId) + 1);
    this.loaded(userId, next);
    return next;
  }

  /** How many times the user's settings were set since the backend started (what a finding read from them is kept against). */
  revision(userId: UserId): number {
    return this.revisions.get(userId) ?? 0;
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

  /**
   * Settings plus each type's effective mode: a reply's type as learned on `connection` (the extract
   * step's), and an agent change type as learned for `agent.role` on the connection that role runs on.
   */
  async result(userId: UserId, connection: { id: string; name: string } | null, agent: { role: string; connection: { id: string; name: string } | null }): Promise<SettingsResult> {
    const settings = await this.get(userId);
    const learning = await this.learningOf(userId);
    const extraction = {} as Record<ChangeType, ExtractionModeView>;
    for (const type of CHANGE_TYPES) {
      const agentType = isAgentChangeType(type);
      const on = agentType ? agent.connection : connection;
      const role = agentType ? agent.role : undefined;
      const { mode, source } = effectiveMode(settings, learning, on?.id ?? null, type, role);
      const stats = on ? statsFor(learning, on.id, type, role) : undefined;
      extraction[type] = { mode, source, connection: on, accepted: stats?.accepted ?? 0, rejected: stats?.rejected ?? 0 };
    }
    return { settings, extraction };
  }

  /** The configured step, falling back to the preset's (DESIGN §5.3). */
  async stepConfig(userId: UserId, purpose: StepPurpose): Promise<StepConfig | null> {
    const settings = await this.get(userId);
    return settings.modelUse.steps[purpose] ?? null;
  }
}
