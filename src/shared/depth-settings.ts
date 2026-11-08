// Settings → Depth (DEPTH-PLAN §7; owner D-3: every place a model is used is the user's to choose).
// Two models the user names once, Strong and Fast (connection, model, effort, answer room), and a
// row per depth role that runs on one of them or on a model of its own. The presets Deepest,
// Balanced and Lean move roles between Strong and Fast and set how often the author may revise its
// notebook; every preset keeps every feature, so they differ in models and cadence, never in what is
// simulated (§7, `[D §2 D31]`). Beside the roles: the budget dial with its ceilings (§6.5), the
// narrator's recent raw window, what the thinking block shows (D-5), the preset's absorption
// (§3.13), redrafts per passage (§1.3), the author's steps per turn (§4.1: a bound, never a
// judgment), how real-time dialogue starts (§2.5), the background lanes, and the bootstrap's own
// settings (§8). Every value has a default the page shows and resets to.
// Model calls read a role through `depthCall`, never the rows themselves. Pure.

import { isRecord } from "./json";
import type { HelperCall, ReasoningChoice, UserSettings } from "./settings";

/** A limit: a number, or "none" for no limit. */
export type DepthLimit = number | "none";

/** Every place depth uses a model (§5.1, §7), in the page's order; two real-time rows (§2.5): the character's answer to each line, and the author's watch beside it. */
export const DEPTH_ROLES = ["author", "character", "gm", "check", "pov", "narrator", "historian", "realtime", "watch"] as const;
export type DepthRole = (typeof DEPTH_ROLES)[number];

export const DEPTH_ROLE_WORDS: Readonly<Record<DepthRole, { label: string; help: string }>> = Object.freeze({
  author: { label: "Author", help: "Runs each scene like a DM, keeps the notebook, polls who catches up, and reads the history in chapters." },
  character: { label: "Character agents", help: "Each character plays, remembers, catches up, reflects and answers interviews from its own mind." },
  gm: { label: "GM", help: "Resolves attempts by the rules, links beliefs to the world's truth, and reconciles imported memory." },
  check: { label: "Render check", help: "Checks each passage against its beat's canon before it streams." },
  pov: { label: "Point-of-view render", help: "Writes a character's own view of a beat that reached them only in part." },
  narrator: { label: "Narrator", help: "Renders the decided beats as the reply, passage by passage, with your preset's sampling; on a model of its own, the temperature, top P and answer room you set here go over your preset's." },
  historian: { label: "Historian", help: "Distils canon beats from the history written before depth (the bootstrap only)." },
  realtime: { label: "Real-time: the character", help: "The character's answer to each line while you talk with them in real time: what they say and do, from their own mind." },
  watch: { label: "Real-time: the author's watch", help: "The author reading each of your lines beside the character in real time: whether it can simply be answered or needs a full scene, and whether the world does anything." },
});

/** A model: a connection (null: the helper model's), its model (null: the connection's own), effort, the room an answer gets, and its temperature and top P (null: the helper model's). */
export interface DepthModel {
  connectionId: string | null;
  model: string | null;
  effort: ReasoningChoice;
  maxTokens: number;
  temperature: number | null;
  topP: number | null;
}

/** Which model a role runs on. */
export type DepthUses = "strong" | "fast" | "own";

export const DEPTH_USES_LABEL: Readonly<Record<DepthUses, string>> = Object.freeze({ strong: "Strong model", fast: "Fast model", own: "Its own" });

export interface DepthRoleSetting {
  uses: DepthUses;
  /** Its own model, read only while `uses` is "own". */
  own: DepthModel;
}

/** The lightest revision the author may make to its notebook (§4.5): after a turn where something moved, at a scene's end, or at a chapter's. It judges whether to revise; this bounds how often it is asked. */
export type DepthCadence = "turns" | "scenes" | "chapters";

export const DEPTH_CADENCE_LABEL: Readonly<Record<DepthCadence, string>> = Object.freeze({ turns: "After any turn", scenes: "At a scene's end", chapters: "At a chapter's end" });

/**
 * The treatments (§4.6, D-13), the Character Engine's effort off screen, one row each, dearest first
 * (the order is the ladder a part slides down when an allowance is spent): its label, and how a
 * part at it is played (`agent`: the character plays its own mind's agent; `mind`: the author plays
 * them from their mind's files; `author`: the author tells it). A new treatment is a row here and
 * its allowance's default, not a format change: parts, asks and spends name a treatment by key.
 */
export const DEPTH_TREATMENT_DEFS = Object.freeze({
  live: { label: "Live", plays: "agent" },
  campfire: { label: "Campfire", plays: "mind" },
  room: { label: "Room", plays: "author" },
  written: { label: "Written", plays: "author" },
} as const satisfies Record<string, { label: string; plays: "agent" | "mind" | "author" }>);
export type DepthTreatment = keyof typeof DEPTH_TREATMENT_DEFS;
export const DEPTH_TREATMENTS: readonly DepthTreatment[] = Object.freeze(Object.keys(DEPTH_TREATMENT_DEFS) as DepthTreatment[]);

export const DEPTH_TREATMENT_LABEL: Readonly<Record<DepthTreatment, string>> = Object.freeze(Object.fromEntries(DEPTH_TREATMENTS.map((t) => [t, DEPTH_TREATMENT_DEFS[t].label])) as Record<DepthTreatment, string>);

/** The budget dial (§6.5, D-7): allowances per story interval and treatment, the threshold the author applies, and per-turn and per-day ceilings over all of depth's model work, in tokens. */
export interface DepthBudget {
  interval: "day" | "week" | "month";
  allowances: Record<DepthTreatment, DepthLimit>;
  /** When an allowance is spent and the author judges a moment major, it asks you with a chip. */
  ask: boolean;
  /** What deserves more than "written", in your words; the author grades each candidate against it and shows its grade. */
  threshold: string;
  /** The threshold as a level, beside the words: how readily the author raises a part above written. */
  level: DepthThresholdLevel;
  perTurn: DepthLimit;
  perDay: DepthLimit;
  /** The on-screen allowance (W17): turns per story interval in which someone on screen plays as their own agent; spent, the scene's author plays them itself. */
  onScreen: DepthLimit;
}

/** The bootstrap's settings (§8): chunk size, jobs at once per stage, the run's cap, the spot checks. */
export interface DepthBootstrapSettings {
  /** A chunk's token bound: whole messages up to it (§8.1). */
  chunkTokens: number;
  /** Minds' jobs at once (§8.5): memory scales with this, not with the chat. The historian and the author read one chunk at a time, in order: each builds on the one before. */
  atOnce: { minds: number };
  /** The most characters the run gives a mind, in the order the author picks them; 0 for no limit. Fewer minds cost less. */
  mostMinds: number;
  /** The run's cap, set before it starts and raised at will (§8.3); "none" for no cap (a merge patch's null deletes). */
  cap: { unit: "money" | "tokens"; value: number } | "none";
  /** Spot-check cards per chapter, beside every flagged one (§8.6). */
  sample: number;
  /** Wrong marks in a row that pause the run and offer a redo (§8.6). */
  pauseAfterWrong: number;
  /** A character returning to the story before catching up on what LumiBooks held of their time away: `flag` (the standard), they're played from their core and the archive, and flagged; `auto`, the author runs a catch-up scoped to the book's nodes that name them, counted against the day's ceiling, and says so. */
  returning: "auto" | "flag";
}

/**
 * The Narrator row's own sampling (§3.13, Settings → Depth → Narrator), which goes over the preset's
 * (the request's body) on the narrator's call, in a scene and off it: while the narrator runs on a
 * model of its own, that model's temperature and top P where set, and its answer room where changed
 * from the default (`ownRoom`). Null keeps the preset's; for the room, the preset's, else the
 * narrator's model's own.
 */
export interface DepthNarratorSampling {
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
}

/** The Narrator row's own sampling over the preset's (see `DepthNarratorSampling`). */
export function narratorOverrides(depth: Readonly<Pick<DepthSettings, "roles">>): DepthNarratorSampling {
  const row = depth.roles.narrator;
  // Read as optional: a model's own temperature and top P are null, or absent, where it takes the helper model's.
  const own: Readonly<{ temperature?: number | null; topP?: number | null }> = row.own;
  return row.uses === "own" ? { temperature: own.temperature ?? null, topP: own.topP ?? null, maxTokens: ownRoom(depth, "narrator") } : { temperature: null, topP: null, maxTokens: null };
}

export interface DepthSettings {
  strong: DepthModel;
  fast: DepthModel;
  roles: Record<DepthRole, DepthRoleSetting>;
  cadence: DepthCadence;
  budget: DepthBudget;
  /** The narrator's recent raw window (§4.3): the last messages, up to this many tokens. */
  window: { messages: number; tokens: number };
  /** What the thinking block shows (D-5): the author's whole thinking with each beat and check, or progress lines only. */
  thinking: "whole" | "progress";
  /** How the narrator's prompt takes the preset (§3.13). */
  absorption: "keep" | "narrator";
  /** Redrafts per passage before it streams with a chip (§1.3). */
  redrafts: number;
  /** The author's steps between beats one turn takes at most (§4.1, a bound): it is told as it nears, and past it the player answers and the scene goes on next turn. */
  steps: number;
  /** The most beats one catch-up call lives (§4.4): more waiting are lived over several calls, in order. */
  catchUpBatch: number;
  /** The newest points of view that reached a character one play lives at most (a bound): the rest stays pending for its catch-up. */
  reached: number;
  /** The author's steps an episode played live off screen takes at most (a bound on its length, never a judgment of it). */
  episodeSteps: number;
  /** The beats of its stretch an author's reflection or chapter re-read reads in one call: past it the stretch is read a page at a time, oldest first, every beat read (a page's size, never a cut). */
  rereadBeats: number;
  /** The takes a character holds unremembered that call for its remembering (a count that calls a remember, never a cut). */
  takesKept: number;
  /** A prompt's own sizes, each a bound on what one call reads (newest kept), never a judgment of what matters: the scene's beats the author reads at a step; those elsewhere a scene's setup is told of; the places the setup lists, nearest first; the scene's beats the real-time watch reads; the story's beats an episode reads; the beats since its story time a settlement reads in one call (past it the draft waits, said); the beats since it last looked the poll reads; the plans falling due the poll reads; the archive quotes that reach the narrator; and what a reading's quotes are held to (words a quote, quotes a beat, quotes an answer; past them a quote is refused unmatched, said back). */
  reads: { sceneBeats: number; others: number; places: number; watchBeats: number; episodeBeats: number; settleBeats: number; pollBeats: number; due: number; narratorQuotes: number; quoteWords: number; quotesPerBeat: number; quotesPerAnswer: number };
  /** Real-time dialogue (§2.5): the author enters it on its own judgment, or only when you tap the chip. */
  realtime: "judged" | "chip";
  /** The background lanes (§5.3, §6.2): whether the author's poll and the work it asks for run between turns (off, only remembering and the truth links do, and the rest waits for the lanes to be on again), the off-screen lane's own pause (`offscreen` off: the settlements and episodes the poll asks for are put off, said, each read before it starts), and how many of depth's background calls one connection has under way at once (`depthPort`'s line; a turn's go first). */
  background: { on: boolean; offscreen: boolean; atOnce: number };
  bootstrap: DepthBootstrapSettings;
}

/** The shipped count of takes that calls a character's remembering (Settings → Depth → Takes before remembering). */
export const DEPTH_TAKES_KEPT = 400;

/** The most tokens Settings → Depth lets one answer's room be. */
export const DEPTH_ROOM_MOST = 1_000_000;

const model = (effort: ReasoningChoice, maxTokens: number): DepthModel => Object.freeze({ connectionId: null, model: null, effort, maxTokens, temperature: null, topP: null });

const STRONG_DEFAULT = model("high", 16384);
const FAST_DEFAULT = model("low", 8192);
const OWN_DEFAULT = model("inherit", 8192);

/** Which model each role uses in each preset. Balanced ships: the routine checks and renders on Fast (owner D-3: cheap roles on the cheap model), the rest on Strong, real time on the models of the roles it stands in for (§2.5). */
const PRESET_USES: Readonly<Record<DepthPresetId, Readonly<Record<DepthRole, Exclude<DepthUses, "own">>>>> = Object.freeze({
  deepest: { author: "strong", character: "strong", gm: "strong", check: "strong", pov: "strong", narrator: "strong", historian: "strong", realtime: "strong", watch: "strong" },
  balanced: { author: "strong", character: "strong", gm: "strong", check: "fast", pov: "fast", narrator: "strong", historian: "strong", realtime: "strong", watch: "strong" },
  lean: { author: "strong", character: "strong", gm: "fast", check: "fast", pov: "fast", narrator: "fast", historian: "fast", realtime: "fast", watch: "fast" },
});

const PRESET_CADENCE: Readonly<Record<DepthPresetId, DepthCadence>> = Object.freeze({ deepest: "turns", balanced: "turns", lean: "scenes" });

export const DEPTH_PRESETS = ["deepest", "balanced", "lean"] as const;
export type DepthPresetId = (typeof DEPTH_PRESETS)[number];

export const DEPTH_PRESET_WORDS: Readonly<Record<DepthPresetId, { label: string; summary: string }>> = Object.freeze({
  deepest: { label: "Deepest", summary: "Every role on the Strong model; the author may revise its notebook after any turn." },
  balanced: { label: "Balanced", summary: "The render check and the points of view on the Fast model; the rest on Strong." },
  lean: { label: "Lean", summary: "Only the author and the characters on Strong; the author revises at a scene's end at most." },
});

/** The shipped defaults: Balanced. */
export function defaultDepthSettings(): DepthSettings {
  return {
    strong: { ...STRONG_DEFAULT },
    fast: { ...FAST_DEFAULT },
    roles: Object.fromEntries(DEPTH_ROLES.map((r) => [r, { uses: PRESET_USES.balanced[r], own: { ...OWN_DEFAULT } }])) as Record<DepthRole, DepthRoleSetting>,
    cadence: PRESET_CADENCE.balanced,
    budget: {
      interval: "week",
      allowances: { live: 2, campfire: 4, room: 8, written: "none" },
      ask: true,
      threshold: DEPTH_THRESHOLD_DEFAULT,
      level: "balanced",
      perTurn: 600_000,
      perDay: 30_000_000,
      onScreen: 100,
    },
    window: { messages: 4, tokens: 8000 },
    thinking: "whole",
    absorption: "keep",
    redrafts: 2,
    steps: 12,
    catchUpBatch: 40,
    reached: 40,
    episodeSteps: 8,
    rereadBeats: 400,
    takesKept: DEPTH_TAKES_KEPT,
    reads: { sceneBeats: 60, others: 24, places: 60, watchBeats: 40, episodeBeats: 40, settleBeats: 200, pollBeats: 400, due: 24, narratorQuotes: 6, quoteWords: 120, quotesPerBeat: 8, quotesPerAnswer: 32 },
    realtime: "judged",
    background: { on: true, offscreen: true, atOnce: 2 },
    bootstrap: { chunkTokens: 60_000, atOnce: { minds: 3 }, mostMinds: 0, cap: { unit: "tokens", value: 20_000_000 }, sample: 5, pauseAfterWrong: 3, returning: "flag" },
  };
}

/** The threshold's shipped words (§6.5): guidance the author applies, never a rule. */
export const DEPTH_THRESHOLD_DEFAULT = "More than written when it could change what someone the player knows wants, believes or does, or when the player is likely to meet it soon.";

/** The threshold as a level (§6.5): how readily the author raises a part above written, read beside the words. */
export const DEPTH_THRESHOLD_LEVELS = ["sparing", "balanced", "generous"] as const;
export type DepthThresholdLevel = (typeof DEPTH_THRESHOLD_LEVELS)[number];

export const DEPTH_THRESHOLD_LEVEL_WORDS: Readonly<Record<DepthThresholdLevel, { label: string; guidance: string }>> = Object.freeze({
  sparing: { label: "Sparing", guidance: "Raise a part above written only when it clearly meets the words." },
  balanced: { label: "Balanced", guidance: "Raise a part above written when it fairly meets the words." },
  generous: { label: "Generous", guidance: "Raise a part above written whenever it plausibly meets the words." },
});

/** The threshold as the author reads it: the level's guidance, then the player's words. */
export function thresholdGuidance(budget: Pick<DepthBudget, "threshold" | "level">): string {
  return `${DEPTH_THRESHOLD_LEVEL_WORDS[budget.level].guidance} ${budget.threshold.trim() || "(no words given)"}`;
}

export const DEPTH_REASONING: readonly ReasoningChoice[] = ["inherit", "off", "auto", "minimal", "low", "medium", "high", "max", "xhigh"];

const int = (raw: unknown, min: number, max: number, base: number): number => (typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max ? raw : base);
const limit = (raw: unknown, min: number, base: DepthLimit): DepthLimit => (raw === "none" ? "none" : typeof raw === "number" && Number.isInteger(raw) && raw >= min ? raw : base);
const pick = <T extends string>(raw: unknown, options: readonly T[], base: T): T => (typeof raw === "string" && (options as readonly string[]).includes(raw) ? (raw as T) : base);
/** A sampling value: a number from 0 to `max`, null (the helper model's) when cleared, else `base`. */
const sampling = (raw: unknown, max: number, base: number | null): number | null => (raw === null ? null : typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= max ? raw : base);

function modelOf(raw: unknown, base: Readonly<DepthModel>): DepthModel {
  if (!isRecord(raw)) return { ...base };
  const connectionId = raw.connectionId === null ? null : typeof raw.connectionId === "string" && raw.connectionId.trim() !== "" ? raw.connectionId : base.connectionId;
  const named = typeof raw.model === "string" && raw.model.trim() !== "" ? raw.model : null;
  return {
    connectionId,
    // A model belongs to its connection: none without one.
    model: connectionId === null ? null : (named ?? (raw.model === undefined && connectionId === base.connectionId ? base.model : null)),
    effort: pick(raw.effort, DEPTH_REASONING, base.effort),
    maxTokens: int(raw.maxTokens, 256, DEPTH_ROOM_MOST, base.maxTokens),
    temperature: sampling(raw.temperature, 2, base.temperature),
    topP: sampling(raw.topP, 1, base.topP),
  };
}

/** Settings → Depth from what was stored, each value kept where it is valid, else its default (or `base`'s). */
export function depthSettingsOf(raw: unknown, base: Readonly<DepthSettings> = defaultDepthSettings()): DepthSettings {
  const v = isRecord(raw) ? raw : {};
  const r = isRecord(v.roles) ? v.roles : {};
  const b = isRecord(v.budget) ? v.budget : {};
  const a = isRecord(b.allowances) ? b.allowances : {};
  const w = isRecord(v.window) ? v.window : {};
  const bg = isRecord(v.background) ? v.background : {};
  const rd = isRecord(v.reads) ? v.reads : {};
  const boot = isRecord(v.bootstrap) ? v.bootstrap : {};
  const at = isRecord(boot.atOnce) ? boot.atOnce : {};
  const rawCap = isRecord(boot.cap) ? boot.cap : {};
  const unit = pick(rawCap.unit, ["money", "tokens"] as const, "tokens");
  const cap = boot.cap === "none" ? "none" : rawCap.unit === unit && typeof rawCap.value === "number" && rawCap.value > 0 ? { unit, value: rawCap.value } : base.bootstrap.cap;
  return {
    strong: modelOf(v.strong, base.strong),
    fast: modelOf(v.fast, base.fast),
    roles: Object.fromEntries(
      DEPTH_ROLES.map((id) => {
        const row = isRecord(r[id]) ? r[id] : {};
        return [id, { uses: pick(row.uses, ["strong", "fast", "own"] as const, base.roles[id].uses), own: modelOf(row.own, base.roles[id].own) }];
      }),
    ) as Record<DepthRole, DepthRoleSetting>,
    cadence: pick(v.cadence, ["turns", "scenes", "chapters"] as const, base.cadence),
    budget: {
      interval: pick(b.interval, ["day", "week", "month"] as const, base.budget.interval),
      allowances: Object.fromEntries(DEPTH_TREATMENTS.map((t) => [t, limit(a[t], 0, base.budget.allowances[t])])) as Record<DepthTreatment, DepthLimit>,
      ask: typeof b.ask === "boolean" ? b.ask : base.budget.ask,
      threshold: typeof b.threshold === "string" ? b.threshold : base.budget.threshold,
      level: pick(b.level, DEPTH_THRESHOLD_LEVELS, base.budget.level),
      perTurn: limit(b.perTurn, 1000, base.budget.perTurn),
      perDay: limit(b.perDay, 1000, base.budget.perDay),
      onScreen: limit(b.onScreen, 0, base.budget.onScreen),
    },
    window: { messages: int(w.messages, 0, 200, base.window.messages), tokens: int(w.tokens, 0, 1_000_000, base.window.tokens) },
    thinking: pick(v.thinking, ["whole", "progress"] as const, base.thinking),
    // "pick" (Pick blocks, never built: Spindle gives no preset block identity) reads as the default, Keep it.
    absorption: pick(v.absorption, ["keep", "narrator"] as const, base.absorption),
    redrafts: int(v.redrafts, 0, 10, base.redrafts),
    steps: int(v.steps, 1, 100, base.steps),
    catchUpBatch: int(v.catchUpBatch, 1, 1000, base.catchUpBatch),
    reached: int(v.reached, 1, 1000, base.reached),
    episodeSteps: int(v.episodeSteps, 1, 100, base.episodeSteps),
    rereadBeats: int(v.rereadBeats, 10, 10_000, base.rereadBeats),
    takesKept: int(v.takesKept, 20, 10_000, base.takesKept),
    reads: {
      sceneBeats: int(rd.sceneBeats, 5, 2000, base.reads.sceneBeats),
      others: int(rd.others, 0, 500, base.reads.others),
      watchBeats: int(rd.watchBeats, 5, 2000, base.reads.watchBeats),
      episodeBeats: int(rd.episodeBeats, 5, 2000, base.reads.episodeBeats),
      settleBeats: int(rd.settleBeats, 10, 10_000, base.reads.settleBeats),
      pollBeats: int(rd.pollBeats, 10, 10_000, base.reads.pollBeats),
      due: int(rd.due, 0, 500, base.reads.due),
      places: int(rd.places, 1, 1000, base.reads.places),
      narratorQuotes: int(rd.narratorQuotes, 0, 50, base.reads.narratorQuotes),
      quoteWords: int(rd.quoteWords, 10, 1000, base.reads.quoteWords),
      quotesPerBeat: int(rd.quotesPerBeat, 1, 100, base.reads.quotesPerBeat),
      quotesPerAnswer: int(rd.quotesPerAnswer, 1, 1000, base.reads.quotesPerAnswer),
    },
    realtime: pick(v.realtime, ["judged", "chip"] as const, base.realtime),
    background: { on: typeof bg.on === "boolean" ? bg.on : base.background.on, offscreen: typeof bg.offscreen === "boolean" ? bg.offscreen : base.background.offscreen, atOnce: int(bg.atOnce, 1, 16, base.background.atOnce) },
    bootstrap: {
      chunkTokens: int(boot.chunkTokens, 2000, 200_000, base.bootstrap.chunkTokens),
      atOnce: { minds: int(at.minds, 1, 16, base.bootstrap.atOnce.minds) },
      mostMinds: int(boot.mostMinds, 0, 500, base.bootstrap.mostMinds),
      cap,
      sample: int(boot.sample, 0, 50, base.bootstrap.sample),
      pauseAfterWrong: int(boot.pauseAfterWrong, 1, 50, base.bootstrap.pauseAfterWrong),
      returning: pick(boot.returning, ["auto", "flag"] as const, base.bootstrap.returning),
    },
  };
}

/** The model a role runs on now: its own, or Strong's or Fast's. */
export function depthModel(depth: Readonly<DepthSettings>, role: DepthRole): DepthModel {
  const row = depth.roles[role];
  return row.uses === "own" ? row.own : depth[row.uses];
}

/**
 * The answer room the user set a role (Settings → Depth → the role's row): its own model's, where it
 * runs on one and the user changed that room from its default. Null where none: the bootstrap's
 * long answers then ask for a room sized from what they read (`roomFor`, `BootstrapRun.roomRule`).
 */
export function ownRoom(depth: Readonly<Pick<DepthSettings, "roles">>, role: DepthRole): number | null {
  const row = depth.roles[role];
  return row.uses === "own" && row.own.maxTokens !== OWN_DEFAULT.maxTokens ? row.own.maxTokens : null;
}

/**
 * What a depth role's call runs with (owner D-3): its model's connection and model, or, on none,
 * the helper model's; its effort and answer room; the helper model's sampling parameters, with the
 * model's own temperature and top P over them where set.
 */
export function depthCall(settings: Pick<UserSettings, "depth" | "helper">, role: DepthRole): HelperCall {
  const m = depthModel(settings.depth, role);
  const own = m.connectionId;
  return {
    connectionId: own ?? settings.helper.connectionId,
    model: own !== null ? m.model : settings.helper.model,
    effort: m.effort,
    maxTokens: m.maxTokens,
    params: { ...settings.helper.params, ...(m.temperature !== null ? { temperature: m.temperature } : {}), ...(m.topP !== null ? { top_p: m.topP } : {}) },
  };
}

/** One line of a preset's list before Apply: the role (or the cadence), from → to. */
export interface DepthPresetChange {
  key: DepthRole | "cadence";
  label: string;
  from: string;
  to: string;
}

/** What a preset changes from `depth` (each role's model, the cadence), and the patch that applies it under `depth`. */
export function depthPresetChanges(depth: Readonly<DepthSettings>, id: DepthPresetId): { changes: DepthPresetChange[]; patch: { roles: Partial<Record<DepthRole, { uses: DepthUses }>>; cadence?: DepthCadence } } {
  const changes: DepthPresetChange[] = [];
  const patch: { roles: Partial<Record<DepthRole, { uses: DepthUses }>>; cadence?: DepthCadence } = { roles: {} };
  for (const role of DEPTH_ROLES) {
    const to = PRESET_USES[id][role];
    const from = depth.roles[role].uses;
    if (from === to) continue;
    changes.push({ key: role, label: DEPTH_ROLE_WORDS[role].label, from: DEPTH_USES_LABEL[from], to: DEPTH_USES_LABEL[to] });
    patch.roles[role] = { uses: to };
  }
  if (depth.cadence !== PRESET_CADENCE[id]) {
    changes.push({ key: "cadence", label: "Notebook revisions", from: DEPTH_CADENCE_LABEL[depth.cadence], to: DEPTH_CADENCE_LABEL[PRESET_CADENCE[id]] });
    patch.cadence = PRESET_CADENCE[id];
  }
  return { changes, patch };
}

/** The preset `depth` matches, or null when a role or the cadence is set otherwise. */
export function currentDepthPreset(depth: Readonly<DepthSettings>): DepthPresetId | null {
  return DEPTH_PRESETS.find((id) => depthPresetChanges(depth, id).changes.length === 0) ?? null;
}
