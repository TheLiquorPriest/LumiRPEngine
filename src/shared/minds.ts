// Character minds (DESIGN §24): the contract the minds pack, the backend's minds runner, the
// time-skip orchestrator, the castlife planner and the UI share.
//
// A mind is one model call made as one character, blind to every other mind, on a context scoped to
// what that character knows. Its answer is recorded as an event, so replay, Re-narrate and the
// background lane never call a model. Everything here is plain data and pure readers.

import type { JsonObject, JsonValue } from "./json";
import { hasOwn, isRecord, safeKey } from "./json";
import type { EntityId, MessageId, PlaceId } from "./ids";
import type { Selector, StepPurpose, StepTemplateDef, WorldDoc } from "./world";

// ---------------------------------------------------------------- fidelity

/** How closely a character is simulated this turn (DESIGN §24.1), highest first. */
export type Fidelity = "live" | "near" | "far" | "background";
export const FIDELITIES: readonly Fidelity[] = ["live", "near", "far", "background"];

/** Whether `a` is at least as close as `b` on the ladder. */
export function atLeast(a: Fidelity, b: Fidelity): boolean {
  return FIDELITIES.indexOf(a) <= FIDELITIES.indexOf(b);
}

/**
 * What each input adds to a character's focus score (DESIGN §24.1). Every number is points; a world
 * tunes them in `world.minds.weights`.
 */
export interface FidelityWeights {
  /** In the POV's scene: at its place. */
  here: number;
  /** Close by: under the same parent place as the POV (the same building, the same street). */
  nearby: number;
  /** Named or addressed in the latest message or reply. */
  mentioned: number;
  /** Regard between them and the POV (the axes' mean, whichever way is stronger) at its extreme (±100); scaled by its size. */
  regard: number;
  /** A `knows` relation between them and the POV, either way. */
  knows: number;
  /** Owns a track still under way (an agenda, a quest, a secret). */
  owner: number;
  /** Each track under way whose stages name them, up to three. */
  track: number;
  /** Role facet values (DESIGN §4.1 classifications), by value id; a value nested under a weighted one counts as it. */
  roles: Record<string, number>;
  /** Named by a world rule (its trigger, condition or effects). */
  rule: number;
  /** Each pending interaction with the POV, up to three: an invitation, an appointment, an open plan or commitment with them. */
  pending: number;
  /** The detail band their tier maps to. */
  band: { principal: number; supporting: number; background: number };
  /** Seen with the POV lately: all of it right after, nothing a day later. */
  recent: number;
}

/** The lowest score for each rung; anything under `far` is Background. Kept so that live ≥ near ≥ far ≥ 0. */
export interface FidelityThresholds {
  live: number;
  near: number;
  far: number;
}

/** One character's place on the ladder, and why (the GM view shows it). */
export interface FidelityScore {
  entity: EntityId;
  level: Fidelity;
  score: number;
  /** Each input that added points, in the order the ladder reads them; a pin is a reason with 0 points. */
  reasons: { label: string; points: number }[];
  /** The GM's pin in this chat and the author's (`always` reads Live, `never` Background); a pin decides the level. */
  pin: { gm: Fidelity | null; author: Fidelity | null };
}

/** This turn's texts, the only input fidelity takes besides the state. Both empty inside `advance` and at a beat. */
export interface FidelityTexts {
  user: string;
  reply: string;
}

// ---------------------------------------------------------------- the world's minds config

/** What the narrator gets of a mind (DESIGN §24.3): the monologue and intent to depict, or only a leak-checked depiction. */
export type MindsSecrecy = "full" | "brief";

/** How a world's minds remember (DESIGN §24.4): the author's defaults; a user's overrides win. */
export interface MindsMemoryConfig {
  /** Witness log entries shown to a mind (the state keeps the latest `WITNESS_KEEP`). */
  witness: { show: number };
  /** Recall by presence: the latest turns the character was there for, the ones that best match the moment, and the tokens they may take. */
  recall: { recent: number; relevant: number; tokens: number };
  /** Notes shown to a mind, and how many a character keeps before consolidation folds the oldest into their summary. */
  notes: { show: number; keep: number };
  /** Open commitments shown to a mind; they are kept until resolved, whatever this says. */
  commitments: { show: number };
  /** A note's salience halves every `halfLifeDays` of game time; one that falls under `floor` has faded and is no longer shown. */
  salience: { halfLifeDays: number; floor: number };
  /** Whether faded and surplus notes are folded into the summary by the `consolidate` step (otherwise they fade out), and at most how often per character, in game days. */
  consolidate: { enabled: boolean; periodDays: number };
}

/** `world.minds` (DESIGN §24.2); a world without it plays with `DEFAULT_WORLD_MINDS`. */
export interface WorldMindsConfig {
  secrecy: MindsSecrecy;
  weights: FidelityWeights;
  thresholds: FidelityThresholds;
  /** People who are always Live, whatever their score (null: no one). */
  always: Selector | null;
  /** People who never get a mind: always Background (null: no one). Wins over `always`. */
  never: Selector | null;
  memory: MindsMemoryConfig;
}

/** `world.minds`'s keys, in the order its editor shows them. */
export const WORLD_MINDS_KEYS = ["secrecy", "weights", "thresholds", "always", "never", "memory"] as const;

export const DEFAULT_FIDELITY_WEIGHTS: Readonly<FidelityWeights> = Object.freeze({
  here: 45,
  nearby: 20,
  mentioned: 40,
  regard: 10,
  knows: 10,
  owner: 15,
  track: 8,
  roles: { antagonist: 20 },
  rule: 5,
  pending: 15,
  band: { principal: 15, supporting: 5, background: 0 },
  recent: 10,
});

export const DEFAULT_FIDELITY_THRESHOLDS: Readonly<FidelityThresholds> = Object.freeze({ live: 60, near: 35, far: 15 });

export const DEFAULT_MINDS_MEMORY: Readonly<MindsMemoryConfig> = Object.freeze({
  witness: { show: 8 },
  recall: { recent: 4, relevant: 4, tokens: 1200 },
  notes: { show: 8, keep: 24 },
  commitments: { show: 8 },
  salience: { halfLifeDays: 7, floor: 0.5 },
  consolidate: { enabled: true, periodDays: 1 },
});

export const DEFAULT_WORLD_MINDS: Readonly<WorldMindsConfig> = Object.freeze({
  secrecy: "brief",
  weights: DEFAULT_FIDELITY_WEIGHTS,
  thresholds: DEFAULT_FIDELITY_THRESHOLDS,
  always: null,
  never: null,
  memory: DEFAULT_MINDS_MEMORY,
});

/** The ranges a number in the minds config is read within (lint names them; a value outside reads as the default). */
export const MINDS_RANGES = {
  weight: [-100, 200],
  threshold: [0, 1000],
  show: [0, 64],
  keep: [1, 64],
  recallTokens: [0, 8000],
  halfLifeDays: [0.1, 3650],
  floor: [0, 5],
  periodDays: [0.1, 365],
} as const;

const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);
const whole = (v: unknown, range: readonly [number, number], fallback: number): number => Math.round(num(v, range, fallback));
const obj = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

function selectorOrNull(v: unknown): Selector | null {
  if (!isRecord(v)) return null;
  const out: Selector = {};
  const list = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]).slice(0, 200) : undefined);
  const ids = list(v.ids);
  const kind = list(v.kind);
  const tier = list(v.tier);
  const memberOf = list(v.memberOf);
  const tag = list(v.tag);
  if (ids) out.ids = ids;
  if (kind) out.kind = kind;
  if (tier) out.tier = tier;
  if (memberOf) out.memberOf = memberOf;
  if (tag) out.tag = tag;
  if (isRecord(v.class)) {
    const classes: Record<string, string[]> = {};
    for (const [facet, values] of Object.entries(v.class)) {
      const vs = list(values);
      if (safeKey(facet) && vs) classes[facet] = vs;
    }
    out.class = classes;
  }
  // An empty selector matches everyone: one with nothing readable in it pins no one rather than all.
  return Object.keys(out).length > 0 ? out : null;
}

/** A world's memory config as the engine reads it: every number within its range, else the default. */
export function memoryConfigOf(raw: unknown, base: Readonly<MindsMemoryConfig> = DEFAULT_MINDS_MEMORY): MindsMemoryConfig {
  const m = obj(raw);
  const witness = obj(m.witness);
  const recall = obj(m.recall);
  const notes = obj(m.notes);
  const commitments = obj(m.commitments);
  const salience = obj(m.salience);
  const consolidate = obj(m.consolidate);
  return {
    witness: { show: whole(witness.show, MINDS_RANGES.show, base.witness.show) },
    recall: { recent: whole(recall.recent, MINDS_RANGES.show, base.recall.recent), relevant: whole(recall.relevant, MINDS_RANGES.show, base.recall.relevant), tokens: whole(recall.tokens, MINDS_RANGES.recallTokens, base.recall.tokens) },
    notes: { show: whole(notes.show, MINDS_RANGES.show, base.notes.show), keep: whole(notes.keep, MINDS_RANGES.keep, base.notes.keep) },
    commitments: { show: whole(commitments.show, MINDS_RANGES.show, base.commitments.show) },
    salience: { halfLifeDays: num(salience.halfLifeDays, MINDS_RANGES.halfLifeDays, base.salience.halfLifeDays), floor: num(salience.floor, MINDS_RANGES.floor, base.salience.floor) },
    consolidate: { enabled: typeof consolidate.enabled === "boolean" ? consolidate.enabled : base.consolidate.enabled, periodDays: num(consolidate.periodDays, MINDS_RANGES.periodDays, base.consolidate.periodDays) },
  };
}

/**
 * `world.minds` as the engine plays it (DESIGN §24.2): every part the world leaves out, or gets
 * wrong, reads as the default; thresholds out of order are put in order.
 */
export function worldMindsOf(world: { readonly minds?: unknown }): WorldMindsConfig {
  const raw = obj(world.minds);
  const w = obj(raw.weights);
  const band = obj(w.band);
  const d = DEFAULT_FIDELITY_WEIGHTS;
  const weight = (v: unknown, fallback: number): number => num(v, MINDS_RANGES.weight, fallback);
  const roles: Record<string, number> = {};
  const rawRoles = isRecord(w.roles) ? w.roles : d.roles;
  for (const [value, points] of Object.entries(rawRoles)) if (safeKey(value) && typeof points === "number" && Number.isFinite(points)) roles[value] = weight(points, 0);
  const t = obj(raw.thresholds);
  const far = num(t.far, MINDS_RANGES.threshold, DEFAULT_FIDELITY_THRESHOLDS.far);
  const near = Math.max(far, num(t.near, MINDS_RANGES.threshold, DEFAULT_FIDELITY_THRESHOLDS.near));
  const live = Math.max(near, num(t.live, MINDS_RANGES.threshold, DEFAULT_FIDELITY_THRESHOLDS.live));
  return {
    secrecy: raw.secrecy === "full" ? "full" : "brief",
    weights: {
      here: weight(w.here, d.here),
      nearby: weight(w.nearby, d.nearby),
      mentioned: weight(w.mentioned, d.mentioned),
      regard: weight(w.regard, d.regard),
      knows: weight(w.knows, d.knows),
      owner: weight(w.owner, d.owner),
      track: weight(w.track, d.track),
      roles,
      rule: weight(w.rule, d.rule),
      pending: weight(w.pending, d.pending),
      band: { principal: weight(band.principal, d.band.principal), supporting: weight(band.supporting, d.band.supporting), background: weight(band.background, d.band.background) },
      recent: weight(w.recent, d.recent),
    },
    thresholds: { live, near, far },
    always: selectorOrNull(raw.always),
    never: selectorOrNull(raw.never),
    memory: memoryConfigOf(raw.memory),
  };
}

// ---------------------------------------------------------------- the user's minds settings

/** A count or a period with "no limit" (or "never"); `"none"` because a settings patch's `null` deletes a key. */
export type Limit = number | "none";

/** A limit as a number to compare with: `"none"` is infinite. */
export function limitOf(limit: Limit): number {
  return limit === "none" ? Number.POSITIVE_INFINITY : limit;
}

/** What refreshes a Near character's mind (DESIGN §24.1); several may be on. Live minds run every turn, Far on their period. */
export interface NearRefresh {
  /** They came into the POV's scene, or the scene changed around them, since their last mind. */
  scene: boolean;
  /** The latest message or reply names or addresses them. */
  mention: boolean;
  /** This many turns have passed since their last mind. */
  turns: Limit;
  /** Their last mind is this many game minutes old. */
  minutes: Limit;
}

/** The Near refresh triggers, in the order Settings lists them. */
export const NEAR_REFRESH_TRIGGERS = ["scene", "mention", "turns", "minutes"] as const;

/** Why a mind ran: the GM asked, it had none, a Near trigger, a Far period, a rise on the ladder, or it's Live. */
export type RefreshReason = "live" | "gm" | "first" | "scene" | "mention" | "turns" | "minutes" | "period" | "promoted";

/** The model steps minds use (DESIGN §24.5): each mind, the memory written after a turn, a time skip's beats, and consolidation. */
export type MindPurpose = "mind" | "memory" | "skip" | "consolidate";
export const MIND_PURPOSES: readonly MindPurpose[] = ["mind", "memory", "skip", "consolidate"];

/** Whether a step purpose is one of the minds'. */
export function isMindPurpose(purpose: StepPurpose): purpose is MindPurpose {
  return (MIND_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * The world's template for a minds step (DESIGN §24.5), which runs unless the player has a prompt of
 * their own: the first by id of the purpose's templates with any text, a blank one being skipped. The
 * runtime, lint and Build → World → Minds all read this, so they agree on which one is used.
 */
export function worldMindTemplate(world: Pick<WorldDoc, "steps">, purpose: MindPurpose): StepTemplateDef | undefined {
  return Object.values(world.steps)
    .filter((t) => t.purpose === purpose && t.template.trim() !== "")
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** The user's overrides of a world's memory config: whatever they set wins, part by part. */
export type MindsMemoryOverrides = { [K in keyof MindsMemoryConfig]?: Partial<MindsMemoryConfig[K]> };

/** `UserSettings.minds` (DESIGN §24.6). A named Model use preset sets everything here but `prompts` and `memory`. */
export interface MindsSettings {
  enabled: boolean;
  /** How many Live minds run a turn, best score first; the rest wait for Near's triggers. */
  liveLimit: Limit;
  nearRefresh: NearRefresh;
  /** Game minutes between a Far character's minds. */
  farRefreshMinutes: Limit;
  /** How many Near and Far refreshes run a turn besides the Live minds, the most pressing first; a GM's request always runs. */
  refreshLimit: Limit;
  /** The levels whose present characters get the `memory` step after a reply. */
  memoryLevels: Fidelity[];
  /** The Minds section's own token budget, apart from the shared section budget (DESIGN §24.3). */
  tokens: number;
  memory: MindsMemoryOverrides;
  /** The user's own prompt for a purpose, which wins over a world template; absent, the world's (`worldMindTemplate`), else the built-in (`MIND_PROMPT_DEFAULTS`). */
  prompts: Partial<Record<MindPurpose, string>>;
  /** A time skip's caps (DESIGN §24.7): beats per skip and minds per beat. */
  skip: { maxBeats: Limit; maxMindsPerBeat: Limit };
}

type PresetMinds = Omit<MindsSettings, "prompts" | "memory">;

/** The minds part of each Model use preset (D25): Lean off; Standard 3 Live with notes for Live; Full no limit with notes for Live and Near. */
export const MINDS_PRESETS: Readonly<Record<"lean" | "standard" | "full", Readonly<PresetMinds>>> = Object.freeze({
  lean: { enabled: false, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 1, memoryLevels: [], tokens: 300, skip: { maxBeats: 4, maxMindsPerBeat: 2 } },
  standard: { enabled: true, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 2, memoryLevels: ["live"], tokens: 600, skip: { maxBeats: 6, maxMindsPerBeat: 3 } },
  full: { enabled: true, liveLimit: "none", nearRefresh: { scene: true, mention: true, turns: 4, minutes: 60 }, farRefreshMinutes: 720, refreshLimit: "none", memoryLevels: ["live", "near"], tokens: 1000, skip: { maxBeats: "none", maxMindsPerBeat: "none" } },
});

/** A new user's minds settings: Standard's. */
export function defaultMindsSettings(preset: keyof typeof MINDS_PRESETS = "standard"): MindsSettings {
  return { ...structuredClone(MINDS_PRESETS[preset]) as PresetMinds, memory: {}, prompts: {} };
}

/** Kept equal to `defaultMindsSettings()`: what Settings shows as the defaults. */
export const MINDS_DEFAULTS: Readonly<MindsSettings> = Object.freeze(defaultMindsSettings());

/** The longest prompt a user or a world template may set for a minds step. */
export const MIND_PROMPT_MAX = 20_000;

function limitIn(v: unknown, lo: number, hi: number, fallback: Limit): Limit {
  if (v === "none") return "none";
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
}

/** The user's memory overrides, each part checked; what doesn't read is left out (the world's then applies). */
function memoryOverridesOf(raw: unknown): MindsMemoryOverrides {
  const m = obj(raw);
  const full = memoryConfigOf(raw, DEFAULT_MINDS_MEMORY);
  const out: MindsMemoryOverrides = {};
  for (const part of Object.keys(DEFAULT_MINDS_MEMORY) as (keyof MindsMemoryConfig)[]) {
    const given = obj(m[part]);
    const read = full[part] as unknown as Record<string, JsonValue>;
    const keep: Record<string, JsonValue> = {};
    for (const key of Object.keys(given)) if (hasOwn(read, key) && given[key] === read[key]) keep[key] = read[key] ?? null;
    if (Object.keys(keep).length > 0) Object.assign(out, { [part]: keep });
  }
  return out;
}

/** `UserSettings.minds` as the engine reads it: each field checked, else `base`'s (the preset's). */
export function mindsSettingsOf(raw: unknown, base: Readonly<MindsSettings> = MINDS_DEFAULTS): MindsSettings {
  const m = obj(raw);
  const near = obj(m.nearRefresh);
  const skip = obj(m.skip);
  const levels = Array.isArray(m.memoryLevels) ? FIDELITIES.filter((f) => f !== "background" && (m.memoryLevels as unknown[]).includes(f)) : [...base.memoryLevels];
  const prompts: Partial<Record<MindPurpose, string>> = {};
  const rawPrompts = obj(m.prompts);
  for (const p of MIND_PURPOSES) {
    const text = rawPrompts[p];
    if (typeof text === "string" && text.trim() !== "") prompts[p] = text.slice(0, MIND_PROMPT_MAX);
  }
  return {
    enabled: typeof m.enabled === "boolean" ? m.enabled : base.enabled,
    liveLimit: limitIn(m.liveLimit, 0, 64, base.liveLimit),
    nearRefresh: {
      scene: typeof near.scene === "boolean" ? near.scene : base.nearRefresh.scene,
      mention: typeof near.mention === "boolean" ? near.mention : base.nearRefresh.mention,
      turns: limitIn(near.turns, 1, 1000, base.nearRefresh.turns),
      minutes: limitIn(near.minutes, 1, 525_600, base.nearRefresh.minutes),
    },
    farRefreshMinutes: limitIn(m.farRefreshMinutes, 1, 525_600, base.farRefreshMinutes),
    refreshLimit: limitIn(m.refreshLimit, 0, 64, base.refreshLimit),
    memoryLevels: levels,
    tokens: typeof m.tokens === "number" && Number.isInteger(m.tokens) && m.tokens >= 0 && m.tokens <= 100_000 ? m.tokens : base.tokens,
    memory: isRecord(m.memory) ? memoryOverridesOf(m.memory) : structuredClone(base.memory),
    prompts: isRecord(m.prompts) ? prompts : { ...base.prompts },
    skip: { maxBeats: limitIn(skip.maxBeats, 0, 200, base.skip.maxBeats), maxMindsPerBeat: limitIn(skip.maxMindsPerBeat, 0, 64, base.skip.maxMindsPerBeat) },
  };
}

/** The memory config a chat plays with: the built-in defaults, then the world's, then the user's overrides. */
export function effectiveMemory(world: { readonly minds?: unknown }, settings: Pick<MindsSettings, "memory">): MindsMemoryConfig {
  const fromWorld = worldMindsOf(world).memory;
  const merged: Record<string, JsonValue> = {};
  for (const part of Object.keys(fromWorld) as (keyof MindsMemoryConfig)[]) merged[part] = { ...(fromWorld[part] as unknown as JsonObject), ...((settings.memory[part] ?? {}) as unknown as JsonObject) };
  return memoryConfigOf(merged, fromWorld);
}

// ---------------------------------------------------------------- what a mind answers

/**
 * What a plan is: the castlife planner maps the everyday kinds to an activity (DESIGN §24.8); the
 * economy carries out `pay` and `lend`, handing `cents` to the first person the plan is with.
 */
export type PlanKind = "errand" | "meet" | "visit" | "work" | "rest" | "leisure" | "pay" | "lend" | "other";
export const PLAN_KINDS: readonly PlanKind[] = ["errand", "meet", "visit", "work", "rest", "leisure", "pay", "lend", "other"];
export type PlanStatus = "open" | "done" | "dropped";

/** A plan's priority: 1 (whenever it fits) to 5 (it must happen); 3 is ordinary. */
export const PLAN_PRIORITY = { min: 1, max: 5, normal: 3 } as const;

/**
 * Something a character means to do later (DESIGN §24.8): from a mind, the memory step or the GM.
 * Times are absolute game minutes. The castlife planner lays open plans into the character's day and
 * marks them `done` or `dropped` with `minds.plan`.
 */
export type MindPlan = {
  id: string;
  what: string;
  kind: PlanKind;
  when: { from: number; to: number };
  where: PlaceId | null;
  with: EntityId[];
  priority: number;
  status: PlanStatus;
  /** When it was made, and what made it. */
  made: number;
  source: "mind" | "memory" | "gm";
  /** When it closed and why (a planner reason, a GM note); null while open. */
  closed: number | null;
  reason: string | null;
  /** What a `pay` or `lend` plan hands over, in the world currency's minor units; no other kind has one. */
  cents?: number;
};

/** A promise, debt, grudge, favour or plan with someone: kept until resolved, never faded (DESIGN §24.4). */
export type CommitmentKind = "promise" | "debt" | "grudge" | "favour" | "plan" | "other";
export const COMMITMENT_KINDS: readonly CommitmentKind[] = ["promise", "debt", "grudge", "favour", "plan", "other"];
export type CommitmentStatus = "open" | "kept" | "broken" | "released";
export const COMMITMENT_STATUSES: readonly CommitmentStatus[] = ["open", "kept", "broken", "released"];

export type MindCommitment = {
  id: string;
  kind: CommitmentKind;
  with: EntityId[];
  text: string;
  /** When it falls due, if it does. */
  due: number | null;
  status: CommitmentStatus;
  made: number;
  closed: number | null;
};

/** A model-written note: what the character took from a turn, with its salience at the time (1–5). */
export type MindNote = {
  id: string;
  text: string;
  salience: number;
  at: number;
};

/** One line of a character's witness log: something notable they saw happen, or were told. */
export type WitnessEntry = {
  at: number;
  what: string;
  how: "saw" | "told";
  /** Who told them (`told`). */
  by: EntityId | null;
  place: PlaceId | null;
};

/** Who was in the POV's scene for one turn (DESIGN §24.4): recall reads the turns a character was there for. */
export type PresenceRecord = {
  /** The turn's assistant message. */
  msg: MessageId | null;
  at: number;
  place: PlaceId | null;
  who: EntityId[];
};

/** A character's latest mind as the state keeps it. */
export type MindRecord = {
  at: number;
  /** The turn's minds round (`minds.round`): a mind is this turn's when it equals the state's round. */
  round: number;
  level: Fidelity;
  /** Where they were when they thought it. */
  place: PlaceId | null;
  moment: "turn" | "beat";
  reason: string;
  monologue: string;
  depiction: string;
  intent: string;
  reactions: string[];
  /** The plans it made, by id. */
  plans: string[];
  mood: string | null;
  interrupt: string | null;
  /** The depiction carried an unrevealed secret or a name the POV can't see, so the narrator's brief got none (`brief` secrecy). */
  withheld: boolean;
};

/** Everything the minds pack keeps about one character (`state.packs.minds.chars[id]`). */
export type MindsCharacter = {
  mind: MindRecord | null;
  plans: MindPlan[];
  notes: MindNote[];
  commitments: MindCommitment[];
  witness: WitnessEntry[];
  summary: string;
  /** The GM's pin in this chat (`minds.pin`). */
  pin: Fidelity | null;
  /** The GM asked for a fresh mind next turn (`minds.refresh`); cleared by the next one. */
  refresh: boolean;
  /** The last turn they were in the POV's scene, as a clock reading. */
  lastPresent: number | null;
  /** When their notes were last folded into their summary (`minds.consolidated`). */
  consolidated: number | null;
};

/** The minds pack's state slice (`state.packs.minds`). */
export type MindsSlice = {
  /** Minds rounds so far: one per turn that ran the minds pre phase. */
  round: number;
  /** Whether minds were on at the latest round: the castlife planner's formula invitations run only while they're off. */
  on: boolean;
  chars: Record<EntityId, MindsCharacter>;
  /** The latest turns' presence, oldest first. */
  presence: PresenceRecord[];
};

/** The most the state keeps; beyond, the oldest go first (the fold's hard bounds, whatever the settings show). */
export const MINDS_KEEP = { notes: 64, openCommitments: 48, closedCommitments: 16, openPlans: 24, closedPlans: 16, witness: 48, presence: 400 } as const;

/** The longest each piece of model text is kept, in characters (DESIGN §24.5); a longer one is cut at a word. */
export const MIND_TEXT_CAPS = {
  monologue: 1200,
  depiction: 600,
  intent: 300,
  reaction: 200,
  reactions: 4,
  plans: 4,
  planWhat: 160,
  mood: 40,
  interrupt: 200,
  note: 300,
  notes: 4,
  commitment: 240,
  commitments: 3,
  summary: 900,
  told: 240,
  tolds: 3,
  reason: 160,
} as const;

/** A plan as a model writes it: names and local times, which the backend resolves to ids and clock minutes. */
export interface PlanDraft {
  what: string;
  kind: PlanKind;
  when: { from: string; to: string };
  where?: string;
  with?: string[];
  priority?: number;
  /** A `pay` or `lend` plan's amount, in the world currency's major units. */
  amount?: number | string;
}

/** A mind's answer (DESIGN §24.5), JSON. */
export interface MindOutput {
  monologue: string;
  depiction: string;
  intent: string;
  reactions: string[];
  plans: PlanDraft[];
  mood?: string;
  interrupt?: { reason: string };
}

/** The `memory` step's answer, written from the character's perspective about what the reply actually said. */
export interface MemoryOutput {
  notes: { text: string; salience: number }[];
  commitments: { kind: CommitmentKind; with: string[]; text: string; due?: string }[];
  /** Their open commitments (shown with ids) this turn kept, broke or released. */
  resolved: { id: string; status: Exclude<CommitmentStatus, "open"> }[];
  plans: PlanDraft[];
  /** What they told whom this turn: it reaches the listeners' witness logs. */
  told: { to: string[]; what: string }[];
  /** Their summary, rewritten only when it changed. */
  summary?: string;
}

/** The `consolidate` step's answer: the summary with the folded notes in it. */
export interface ConsolidateOutput {
  summary: string;
}

/** The `skip` step's answer (DESIGN §24.7): further moments in the skip worth stopping at, local times. */
export interface SkipOutput {
  beats: { at: string; reason: string }[];
}

// ---------------------------------------------------------------- events

/** The minds pack's events. Every model answer is one, so a fold never calls a model. */
export const MINDS_EVENTS = {
  /** A turn's minds round: every turn with minds on (`on` true), and once with `on` false on the first turn after they're switched off. */
  round: "minds.round",
  mind: "minds.mind",
  memory: "minds.memory",
  presence: "minds.presence",
  plan: "minds.plan",
  planEdit: "minds.plan_edit",
  noteEdit: "minds.note_edit",
  commitment: "minds.commitment",
  commitmentEdit: "minds.commitment_edit",
  consolidated: "minds.consolidated",
  pin: "minds.pin",
  refresh: "minds.refresh",
  skip: "minds.skip",
} as const;

export type RoundEventData = { at: number; on: boolean };

/**
 * `minds.mind`: one character's mind, as answered and screened. Its apply reads only its own data and
 * the minds slice, never an entity's fields, so a coarsened skip record (L21) folds it the same.
 */
export type MindEventData = {
  entity: EntityId;
  at: number;
  /** Where they were when they thought it. */
  place: PlaceId | null;
  level: Fidelity;
  moment: "turn" | "beat";
  /** Why it ran (`RefreshReason`, or a beat's reason). */
  reason: string;
  monologue: string;
  depiction: string;
  intent: string;
  reactions: string[];
  plans: MindPlan[];
  mood: string | null;
  interrupt: { reason: string } | null;
  withheld: boolean;
};

/** `minds.memory`: what one character took from a turn. */
export type MemoryEventData = {
  entity: EntityId;
  at: number;
  notes: MindNote[];
  commitments: MindCommitment[];
  resolved: { id: string; status: Exclude<CommitmentStatus, "open"> }[];
  plans: MindPlan[];
  told: { to: EntityId[]; what: string }[];
  /** Null: unchanged. */
  summary: string | null;
};

/** `minds.presence`: who was in the POV's scene for a turn, and the notable things they saw happen in it. */
export type PresenceEventData = {
  msg: MessageId | null;
  at: number;
  place: PlaceId | null;
  who: EntityId[];
  saw: string[];
};

/** `minds.plan`: a plan's status (the castlife planner during `advance`, or the GM). */
export type PlanStatusEventData = { entity: EntityId; plan: string; status: PlanStatus; at: number; reason: string | null };
/** `minds.plan_edit`: a plan replaced whole, added (a new id) or, with `value` null, deleted. */
export type PlanEditEventData = { entity: EntityId; plan: string; value: MindPlan | null };
/** `minds.note_edit`: a note replaced, added or deleted. */
export type NoteEditEventData = { entity: EntityId; note: string; value: MindNote | null };
/** `minds.commitment`: a commitment's status. */
export type CommitmentStatusEventData = { entity: EntityId; commitment: string; status: CommitmentStatus; at: number; reason: string | null };
/** `minds.commitment_edit`: a commitment replaced, added or deleted. */
export type CommitmentEditEventData = { entity: EntityId; commitment: string; value: MindCommitment | null };
/** `minds.consolidated`: notes folded into the summary, and gone. */
export type ConsolidatedEventData = { entity: EntityId; at: number; notes: string[]; summary: string };
/** `minds.pin`: the GM's pin, or null to unpin. */
export type PinEventData = { entity: EntityId; level: Fidelity | null };
/** `minds.refresh`: the GM wants a fresh mind for them next turn. */
export type RefreshEventData = { entity: EntityId };
/** `minds.skip`: a time skip's beats, as scanned and as the `skip` step proposed them. */
export type SkipEventData = { from: number; to: number; beats: { at: number; reason: string; source: "scan" | "model" }[] };

// ---------------------------------------------------------------- the narrator's section

/** The Minds section's slot and its preset outlet (DESIGN §6.8, §24.3). */
export const MINDS_SLOT = "minds";
export const MINDS_OUTLET = "lre_minds";

/** The Minds section's default template: it says each mind is scoped to its character, and depicted, never stated. */
export const MINDS_SECTION_TEMPLATE =
  "Each mind below is scoped to what that character knows and is blind to everyone else's. Show it through what they do and say; never state a thought, a reason or an intent outright, and never let one character act on another's private mind.\n{{lines}}";

// ---------------------------------------------------------------- the GM view and its controls

/** One character in the GM view's minds panel (DESIGN §24.9): everything, secrets included. */
export interface MindsGmCharacter {
  entity: EntityId;
  name: string;
  fidelity: FidelityScore;
  /** The GM asked for a fresh mind next turn. */
  refreshQueued: boolean;
  /** The latest mind, with its clock in words. */
  mind: (Omit<MindRecord, "plans"> & { clock: string; plans: MindPlan[] }) | null;
  /** Open plans first, then the latest closed; each with its times in words. */
  plans: (MindPlan & { fromText: string; toText: string })[];
  /** Notes, newest first, with their salience now (decayed) and whether they have faded. */
  notes: (MindNote & { now: number; faded: boolean; clock: string })[];
  /** Open commitments first, then the latest resolved, with who they're with by name. */
  commitments: (MindCommitment & { withNames: string[]; dueText: string | null })[];
  witness: (WitnessEntry & { clock: string })[];
  summary: string;
}

/** `GmView.minds`: the chat's minds as the GM sees them; `enabled` is the user's setting. */
export interface MindsGmView {
  enabled: boolean;
  secrecy: MindsSecrecy;
  /** The chat's clock (game minutes) and in words: what a plan added "in N hours" counts from. */
  now: number;
  nowText: string;
  /** Every person but the POV, closest on the ladder first. */
  characters: MindsGmCharacter[];
}

/**
 * The GM's minds controls, as `lre.edit` operations (one `fix` entry, with its Undo): pin a
 * character's fidelity (null unpins), ask for a fresh mind next turn, and edit, add (`id` null) or
 * delete (`value` null) a note, commitment or plan. A `value` is the item's fields to change; an added
 * one needs its text (and for a plan its `what` and `when`).
 */
export type MindEditOp =
  | { op: "mind_pin"; entity: EntityId; level: Fidelity | null }
  | { op: "mind_refresh"; entity: EntityId }
  | { op: "mind_memory"; entity: EntityId; part: "note" | "commitment" | "plan"; id: string | null; value: JsonObject | null };

/**
 * One minds model call in the inspector (DESIGN §6.5), a player surface: never any text, only calls
 * for people the POV can see and has met, and a withheld depiction reads as a plain `recorded`.
 */
export interface MindCallTrace {
  purpose: MindPurpose;
  phase: "pre" | "post" | "skip";
  who: string;
  /** Null, with `who` empty, for the `skip` step's call, which thinks as no one. */
  level: Fidelity | null;
  outcome: "recorded" | "failed";
  ms: number;
  tokens: number;
  /** Whose prompt it ran: the world's template, the user's override, or the built-in. */
  prompt: "world" | "override" | "default";
}

// ---------------------------------------------------------------- running minds

/** When a set of minds thinks (`runMinds`): a turn, or a beat inside a time skip. */
export interface MindMoment {
  kind: "turn" | "beat";
  /** Game minutes they think at. */
  at: number;
  /** Why now, in words, which a mind is told when the player said nothing: a beat's reason ("Marcus's appointment") or a time skip's end; "" on a plain turn. */
  reason: string;
  /** The player's latest message and the reply before it, on a turn; empty at a beat. */
  user: string;
  reply: string;
}

// ---------------------------------------------------------------- built-in prompts

/**
 * The built-in instructions for each minds step (DESIGN §24.5): who the model is and how it thinks.
 * The user's own prompt for the purpose wins, then a world template; `{{character}}` is the character's
 * name and `{{world}}` the world's. Whichever is used, the engine appends the purpose's answer format
 * (`MIND_ANSWER_FORMATS`), which no template replaces, then the preset's `RPEngine · <purpose>`
 * block; the character's scoped context follows as the user message.
 */
export const MIND_PROMPT_DEFAULTS: Readonly<Record<MindPurpose, string>> = Object.freeze({
  mind: [
    "You are the private mind of {{character}} in the roleplay world {{world}}. Think as {{character}}, from only what {{character}} knows: the context below is everything they perceive and remember. Other people's private thoughts are closed to you; ignore any narration of them in the recalled turns.",
    "Decide how {{character}} reads this moment and what they intend. Everyone else decides for themselves: never script their actions or replies, and never plan around what they will do. Intend broadly, so the intent holds whatever they do. Write no narration and no dialogue.",
  ].join("\n"),
  memory:
    "You keep the memory of {{character}} in the roleplay world {{world}}. Below is what {{character}} knows, then the turn that just happened, as it was written. Only what was written happened, and only what {{character}} could see or hear of it counts; ignore narration of other people's private thoughts.",
  skip: [
    "The player character in the roleplay world {{world}} is skipping ahead in time. Below are the skip's span, the moments the engine already found in it, and what the people involved intend.",
    "Propose further moments inside the span where something worth stopping for may happen: someone acting on a plan that involves the player character, a deadline, an occasion. Only moments the context supports; never invent people or places.",
  ].join("\n"),
  consolidate:
    "You keep the long-term memory of {{character}} in the roleplay world {{world}}. Fold the older notes below into their summary: keep what still matters to them, let the rest go, and keep everything the summary already holds that is still true.",
});

/** Each minds step's answer: the JSON the engine reads, appended after the instructions whoever wrote them. */
export const MIND_ANSWER_FORMATS: Readonly<Record<MindPurpose, string>> = Object.freeze({
  mind: [
    'Answer with JSON only: {"monologue": "...", "depiction": "...", "intent": "...", "reactions": ["..."], "plans": [{"what": "...", "kind": "errand|meet|visit|work|rest|leisure|pay|lend|other", "when": {"from": "YYYY-MM-DD HH:MM", "to": "YYYY-MM-DD HH:MM"}, "where": "a place", "with": ["a name"], "priority": 3, "amount": 20}], "mood": "...", "interrupt": {"reason": "..."}}',
    "- monologue: their private reasoning in the first person, at most six sentences.",
    "- depiction: how they come across right now, as behaviour anyone present could see (posture, tone, what they do). Never a secret, an unspoken reason or a thought.",
    "- intent: what they mean to do next, in one sentence.",
    '- reactions: up to three short conditional reactions ("if pressed about the cellar, changes the subject").',
    "- plans: only real intentions for later, with local times; priority 1 (whenever it fits) to 5 (it must happen); kind pay or lend, with amount, when they mean to hand someone money, and no amount otherwise. Leave the list empty when there are none.",
    "- mood: one or two words.",
    "- interrupt: only when the moment is a beat inside a time skip and what they'd do now would interrupt the player character's skipped time (seeking them out, calling them). Leave it out otherwise.",
  ].join("\n"),
  memory: [
    'Answer with JSON only: {"notes": [{"text": "...", "salience": 3}], "commitments": [{"kind": "promise|debt|grudge|favour|plan|other", "with": ["a name"], "text": "...", "due": "YYYY-MM-DD HH:MM"}], "resolved": [{"id": "...", "status": "kept|broken|released"}], "plans": [{"what": "...", "kind": "errand|meet|visit|work|rest|leisure|pay|lend|other", "when": {"from": "YYYY-MM-DD HH:MM", "to": "YYYY-MM-DD HH:MM"}, "where": "a place", "with": ["a name"], "priority": 3, "amount": 20}], "told": [{"to": ["a name"], "what": "..."}], "summary": "..."}',
    "- notes: at most three things they will remember, in their own perspective; salience 1 (passing) to 5 (unforgettable).",
    "- commitments: promises, debts, grudges, favours and plans with someone that this turn made; due only when a time was set.",
    "- resolved: their open commitments (listed with ids) that this turn kept, broke or released.",
    "- plans: intentions with times that this turn formed; kind pay or lend, with amount, when they mean to hand someone money, and no amount otherwise.",
    "- told: what they told whom in this turn, in a few words each.",
    "- summary: their one-paragraph summary rewritten, only when this turn changed who they are or what they're about; leave it out otherwise.",
    "Use empty lists for anything the turn didn't give.",
  ].join("\n"),
  skip: 'Answer with JSON only: {"beats": [{"at": "YYYY-MM-DD HH:MM", "reason": "..."}]}, at most five, in time order; an empty list when there are none.',
  consolidate: 'Answer with JSON only: {"summary": "..."}: at most 900 characters of plain prose, in their own perspective.',
});
