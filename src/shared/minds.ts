// Character minds (DESIGN §24): the contract the minds pack, the backend's minds runner, the
// time-skip orchestrator, the castlife planner and the UI share.
//
// A mind is one model call made as one character, blind to every other mind, on a context scoped to
// what that character knows. Its answer is recorded as an event, so replay, Re-narrate and the
// background lane never call a model. Everything here is plain data and pure readers.

import type { JsonObject, JsonValue } from "./json";
import { hashParts } from "./hash";
import { hasOwn, isRecord, safeKey } from "./json";
import type { EntityId, FieldId, MessageId, PlaceId, StageId, TrackId } from "./ids";
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
  /** Recall by presence: the latest turns the character was there for, the ones that best match the moment, and the most tokens they may take ("none": no limit). */
  recall: { recent: number; relevant: number; tokens: Limit };
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
  /** What each person holds from the start (Build → World → Minds, DESIGN §24.11), which seeds their holdings in every chat. */
  holdings: AuthoredHoldings;
}

/** `world.minds`'s keys, in the order its editor shows them. */
export const WORLD_MINDS_KEYS = ["secrecy", "weights", "thresholds", "always", "never", "memory", "holdings"] as const;

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
  recall: { recent: 4, relevant: 4, tokens: 4000 },
  notes: { show: 8, keep: 24 },
  commitments: { show: 8 },
  salience: { halfLifeDays: 7, floor: 0.5 },
  consolidate: { enabled: true, periodDays: 1 },
});

/** A world that says nothing of secrecy plays `full`; one that says `brief` stays brief (DESIGN §24.3). */
export const DEFAULT_WORLD_MINDS: Readonly<WorldMindsConfig> = Object.freeze({
  secrecy: "full",
  weights: DEFAULT_FIDELITY_WEIGHTS,
  thresholds: DEFAULT_FIDELITY_THRESHOLDS,
  always: null,
  never: null,
  memory: DEFAULT_MINDS_MEMORY,
  holdings: {},
});

/** The ranges a number in the minds config is read within (lint names them; a value outside reads as the default). */
export const MINDS_RANGES = {
  weight: [-100, 200],
  threshold: [0, 1000],
  show: [0, 64],
  keep: [1, 64],
  recallTokens: [0, Number.MAX_SAFE_INTEGER],
  halfLifeDays: [0.1, 3650],
  floor: [0, 5],
  periodDays: [0.1, 365],
} as const;

const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);
const whole = (v: unknown, range: readonly [number, number], fallback: number): number => Math.round(num(v, range, fallback));
/** A whole number within its range, or "none" (no limit); anything else is `fallback`. */
const wholeOrNone = (v: unknown, range: readonly [number, number], fallback: Limit): Limit => (v === "none" ? "none" : typeof v === "number" && Number.isFinite(v) && v >= range[0] && v <= range[1] ? Math.round(v) : fallback);
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
    recall: { recent: whole(recall.recent, MINDS_RANGES.show, base.recall.recent), relevant: whole(recall.relevant, MINDS_RANGES.show, base.recall.relevant), tokens: wholeOrNone(recall.tokens, MINDS_RANGES.recallTokens, base.recall.tokens) },
    notes: { show: whole(notes.show, MINDS_RANGES.show, base.notes.show), keep: whole(notes.keep, MINDS_RANGES.keep, base.notes.keep) },
    commitments: { show: whole(commitments.show, MINDS_RANGES.show, base.commitments.show) },
    salience: { halfLifeDays: num(salience.halfLifeDays, MINDS_RANGES.halfLifeDays, base.salience.halfLifeDays), floor: num(salience.floor, MINDS_RANGES.floor, base.salience.floor) },
    consolidate: { enabled: typeof consolidate.enabled === "boolean" ? consolidate.enabled : base.consolidate.enabled, periodDays: num(consolidate.periodDays, MINDS_RANGES.periodDays, base.consolidate.periodDays) },
  };
}

/**
 * `world.minds` as the engine plays it (DESIGN §24.2): every part the world leaves out, or gets
 * wrong, reads as the default; thresholds out of order are put in order. Secrecy is `full` unless
 * the world says `brief`.
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
    secrecy: raw.secrecy === "brief" ? "brief" : "full",
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
    holdings: authoredHoldingsOf(raw.holdings),
  };
}

/** The fact kinds an author gives someone from the start: world lore, a track's stage, an entity's field. A book's marks name their own holders, and a claim arises in play. */
export const AUTHORED_FACT_KINDS: readonly FactKind[] = ["lore", "track", "field"];

/** Whom someone keeps a fact from, as stored: "everyone", or the people named, once each and never themselves; none (an empty list, or anything else) is null. */
export function keptFromOf(v: unknown, self: EntityId | null = null): KeptFrom | null {
  if (v === "everyone") return "everyone";
  if (!Array.isArray(v)) return null;
  const ids = [...new Set(v.filter((id): id is string => typeof id === "string" && id !== "" && id !== self))];
  return ids.length > 0 ? ids : null;
}

/** A confidence (DESIGN §24.11, a fixed range): a finite number from 0 to 1. */
export function isConfidence(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/**
 * `world.minds.holdings` as the engine reads it: per person, each fact they hold from the start by
 * its id, with their belief (true when unset), their confidence (1 when unset) and whom they keep it
 * from (no one when unset). A fact of a kind an author can't give or an id not in its kind's form
 * is left out, as is anyone left holding nothing; lint names each, and anything named that the
 * world doesn't have.
 */
export function authoredHoldingsOf(raw: unknown): AuthoredHoldings {
  const out: AuthoredHoldings = {};
  for (const [who, facts] of Object.entries(obj(raw))) {
    if (!safeKey(who) || who === "" || !isRecord(facts)) continue;
    const held: Record<FactId, AuthoredHolding> = {};
    for (const [fact, v] of Object.entries(facts)) {
      const ref = safeKey(fact) ? parseFactId(fact) : null;
      if (!ref || !AUTHORED_FACT_KINDS.includes(ref.kind) || !isRecord(v)) continue;
      const keptFrom = keptFromOf(v.keptFrom, who);
      held[fact] = { belief: (HOLDING_BELIEFS as readonly unknown[]).includes(v.belief) ? (v.belief as HoldingBelief) : "true", confidence: isConfidence(v.confidence) ? v.confidence : 1, ...(keptFrom ? { keptFrom } : {}) };
    }
    if (Object.keys(held).length > 0) out[who] = held;
  }
  return out;
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

/**
 * The model steps minds use (DESIGN §24.5, §24.11): each mind, the memory written after a turn, a
 * time skip's beats, consolidation, and the knowledge step after the reply (who learned what).
 */
export type MindPurpose = "mind" | "memory" | "skip" | "consolidate" | "knowledge";
export const MIND_PURPOSES: readonly MindPurpose[] = ["mind", "memory", "skip", "consolidate", "knowledge"];

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

/**
 * The sources a mind's context is read from (DESIGN §24.5, Settings → Minds → What a mind reads), in
 * the order Settings lists them: the story as it stands (the lore pinned to them and to where they
 * are, the lore the turn activates, the latest reply and the player's message), the recent chat as
 * the player sees it (turns they weren't there for included), then their own summary, notes and what
 * they saw, last thoughts, recall of the turns they were there for, their usual routine (their
 * routine blocks and schedules while their routine is informative or enforced, a private block only
 * when it is their own, never social life the planner made up: `RoutineRole`), their plans (the
 * plans in force the story and the GM gave them, never the day the planner lays), their life
 * (money, the day and commitments), and what they know (their own holdings, DESIGN §24.11, while
 * knowledge is tracked). Who they are, where they are and what they mean to do are in every
 * context, outside these.
 */
export type MindSource = "pinned" | "activated" | "reply" | "message" | "history" | "summary" | "memory" | "thoughts" | "recall" | "routine" | "plans" | "life" | "knowledge";
export const MIND_SOURCES: readonly MindSource[] = ["pinned", "activated", "reply", "message", "history", "summary", "memory", "thoughts", "recall", "routine", "plans", "life", "knowledge"];

/** One source as the user sets it: whether a mind reads it, and the most it may take, in tokens ("none": no limit). */
export interface MindRead {
  on: boolean;
  tokens: Limit;
}

/** The recent chat as the user sets it: on or off, and at most so many of the latest messages and about so many tokens in all, whichever runs out first ("none": no limit). */
export type MindHistoryRead = MindRead & { messages: Limit };

/**
 * What a mind reads: each source on or off with its own limit. Recall's limit is the memory setting
 * it always had (`recall.tokens`: the world's, or the user's override), and what they know has the
 * knowledge setting's (`knowledge.mindTokens`), so each of their entries is the switch; the recent
 * chat has a messages limit beside its tokens.
 */
export type MindsReads = Record<Exclude<MindSource, "recall" | "history" | "knowledge">, MindRead> & { recall: Pick<MindRead, "on">; history: MindHistoryRead; knowledge: Pick<MindRead, "on"> };

/**
 * What a mind reads unless the user says otherwise: the story as it stands, their usual routine as
 * context, their own plans, and nothing else of its own memory or life. Each of those can carry what
 * no story set up: the day the Cast life planner lays (meals, friends, outings), commitments the
 * memory step took from narration that depicted another mind, and older replies and thoughts that
 * acted on them (DESIGN §24.5). Their usual routine is the world's and the story's, never the
 * planner's guesses; their plans are what the turns stated and the GM set, which they mean to keep.
 */
export const DEFAULT_MIND_READS: Readonly<MindsReads> = Object.freeze({
  pinned: { on: true, tokens: "none" },
  activated: { on: true, tokens: 1600 },
  reply: { on: true, tokens: "none" },
  message: { on: true, tokens: "none" },
  // Off: it tells of turns they weren't there for. Once on, what a helper reads before a typed message.
  history: { on: false, messages: 8, tokens: 3000 },
  summary: { on: false, tokens: "none" },
  memory: { on: false, tokens: "none" },
  thoughts: { on: false, tokens: "none" },
  recall: { on: false },
  routine: { on: true, tokens: 400 },
  plans: { on: true, tokens: 400 },
  life: { on: false, tokens: "none" },
  // On: while the chat tracks knowledge, their own holdings in place of the secrets in who they are.
  knowledge: { on: true },
});

/** How the knowledge step asks (DESIGN §24.11): one batched call per scene, or one per character. */
export type KnowledgeBatch = "scene" | "character";
export const KNOWLEDGE_BATCHES: readonly KnowledgeBatch[] = ["scene", "character"];

/**
 * `UserSettings.minds.knowledge` (DESIGN §24.11, Settings → Minds → Knowledge): whether knowledge
 * is tracked, the confidence under which a holding is a suspicion, how the knowledge step asks, the
 * longest claim a fact keeps, the tokens a mind's own holdings, the narrator's Who knows what and
 * the step's own context may take, and the user's own wording of its texts. Each limit applies when
 * a proposal is checked or a call is made, never in the fold, so changing one never changes a past
 * turn. A chat's own switch (GM → This chat) wins over `enabled`. No Model use preset sets any of it.
 */
export interface KnowledgeSettings {
  enabled: boolean;
  /** From 0 to 1: a holding whose confidence is under it is a suspicion (`isSuspicion`). */
  threshold: number;
  batch: KnowledgeBatch;
  /** The longest claim a fact is recorded with, in characters. */
  claimChars: number;
  /** What a mind reads of its own holdings, in tokens. */
  mindTokens: number;
  /** The narrator's Who knows what section, in tokens. */
  narratorTokens: number;
  /** The knowledge step's context (what happened, who could perceive it, each person's holdings, witness log and traits), in tokens. */
  stepTokens: number;
  /** Facts made in play a chat holds at most (claims): past it, the knowledge step makes no new one. */
  factsPerChat: number;
  /** Holders a fact has at most: past it, no one else learns it from the knowledge step. */
  holdersPerFact: number;
  /** New facts and learnings one turn's knowledge step records at most. */
  factsPerTurn: number;
  learningsPerTurn: number;
  /** A fact is in play while it was learned within this many of the latest turns (beside being about someone or somewhere here). */
  inPlayTurns: number;
  /** The narrator's Who knows what gives each person at most this many facts, the most relevant first. */
  perPerson: number;
  /** The user's own wording of each text knowledge sends a model, by the text's id (`KNOWLEDGE_TEXTS`); one left out reads as the shipped text, so clearing it resets it. */
  prompts: Record<string, string>;
}

export const KNOWLEDGE_DEFAULTS: Readonly<KnowledgeSettings> = Object.freeze({ enabled: true, threshold: 0.7, batch: "scene", claimChars: 240, mindTokens: 400, narratorTokens: 600, stepTokens: 4000, factsPerChat: 512, holdersPerFact: 64, factsPerTurn: 6, learningsPerTurn: 24, inPlayTurns: 3, perPerson: 3, prompts: {} });

/** The ranges knowledge settings are read within: only what keeps each meaningful (a threshold is a confidence, a claim has a character, no count is negative). */
export const KNOWLEDGE_RANGES = { threshold: [0, 1], claimChars: [1, Number.MAX_SAFE_INTEGER], tokens: [0, Number.MAX_SAFE_INTEGER], count: [0, Number.MAX_SAFE_INTEGER] } as const;

/** The knowledge settings that are whole numbers within a range, as Settings → Minds → Knowledge lists its limits. */
export const KNOWLEDGE_LIMITS = ["claimChars", "mindTokens", "narratorTokens", "stepTokens", "factsPerChat", "holdersPerFact", "factsPerTurn", "learningsPerTurn", "inPlayTurns", "perPerson"] as const satisfies readonly (keyof KnowledgeSettings)[];
export type KnowledgeLimit = (typeof KNOWLEDGE_LIMITS)[number];

/** Each limit's range: a claim has at least a character; the rest are tokens or counts, none negative. */
export function knowledgeLimitRange(limit: KnowledgeLimit): readonly [number, number] {
  return limit === "claimChars" ? KNOWLEDGE_RANGES.claimChars : limit.endsWith("Tokens") ? KNOWLEDGE_RANGES.tokens : KNOWLEDGE_RANGES.count;
}

/**
 * Every text knowledge sends a model besides the knowledge step's own prompt (which is
 * `minds.prompts.knowledge`, as each minds step's), by id, with its shipped wording: what a mind is
 * told of its own holdings, the words a holding reads in (for a mind, the narrator's Who knows what
 * and the knowledge step alike), and the knowledge step's context headings. The user's own wording
 * (`KnowledgeSettings.prompts`) wins; one left out, or emptied, reads as shipped (`knowledgeText`).
 * `{{…}}` are the placeholders each fills.
 */
export const KNOWLEDGE_TEXTS = Object.freeze({
  mindTitle: "What you know",
  mindLead: "The facts you hold and how you came by them. You know only these and what is in front of you: never act on, hint at or guess anything that isn't here.",
  known: "{{claim}} ({{how}})",
  suspected: "Suspects: {{claim}} ({{how}}, about {{percent}}% sure)",
  disbelieved: "Doesn't believe: {{claim}} ({{how}})",
  unsure: "Unsure whether: {{claim}} ({{how}})",
  keeps: "keeps it from {{whom}}",
  everyone: "everyone",
  authored: "from the start",
  witnessed: "saw it",
  told: "told by {{by}}",
  inferred: "worked it out",
  guessed: "a guess",
  person: "{{name}}: {{line}}",
  notKnown: "{{name}} doesn't know: {{claim}}",
  stepHappened: "What happened this turn",
  stepPresent: "Who could perceive it",
  stepPeople: "What each of them already knows, and has witnessed lately",
  stepFacts: "Facts in play (reuse these by id)",
  stepPerson: "{{name}} (id: {{id}})",
  stepYou: '{{name}} (id: {{id}}; the player character, "you")',
  stepSaid: "{{name}} said or did: {{text}}",
  stepStory: "The story, as written: {{text}}",
  stepThroughout: "there throughout",
  stepLeft: "there from the start, then left behind partway",
  stepCame: "came in during the turn, or was met at its end: perceived only what came after",
  stepOpen: "(an open question)",
  stepFalse: "(false)",
  stepPinned: "Pinned lore",
  stepTraits: "Is like:",
  stepHolds: "Holds:",
  stepNothing: "nothing the story tracks yet",
  stepWitnessed: "Witnessed lately:",
  stepSomeone: "someone",
  stepAnswer: [
    "- facts: the new facts this turn establishes or raises, each one short sentence, with a ref of your own (n1, n2…) the lists below use; about: the people or places it concerns; truth: true, false (a lie or a false rumour) or open (an open question, such as who did something).",
    '- learned: who came to know a fact this turn, and how: witnessed (they saw it, heard it said aloud or read it themselves, so they were there for it) or told (by: who told them, who must already know it). Name the player character "you". keptFrom: only when the turn shows they mean to keep it from someone, or "everyone"; leave it out otherwise.',
    "- inferred: something one person (never the player character) could work out or guess this turn: confidence from 0 to 1; evidence: the ids of facts they hold and the refs of lines from their own witness log it rests on, at least one; belief: true, false or uncertain.",
    "- doubted: a fact someone (never the player character) held that this turn makes them doubt: their confidence now, from 0 to 1, and what they now take it to be.",
    "Use empty lists for anything the turn didn't give.",
  ].join("\n"),
} as const);
export type KnowledgeTextId = keyof typeof KNOWLEDGE_TEXTS;
export const KNOWLEDGE_TEXT_IDS = Object.keys(KNOWLEDGE_TEXTS) as KnowledgeTextId[];

/** A knowledge text as this user has it: their own wording, else the shipped one. */
export function knowledgeText(settings: Pick<KnowledgeSettings, "prompts">, id: KnowledgeTextId): string {
  const own = settings.prompts[id];
  return own !== undefined && own.trim() !== "" ? own : KNOWLEDGE_TEXTS[id];
}

/** A text with its `{{name}}` placeholders filled in one pass; a placeholder with no value is left as written. */
export function fillText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (hasOwn(values, key) ? (values[key] ?? whole) : whole));
}

/** `UserSettings.minds` (DESIGN §24.6). A named Model use preset sets everything here but `reads`, `memory`, `prompts` and `knowledge`. */
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
  /** What a mind reads (DESIGN §24.5): the user's own, so no preset sets it. The memory step reads the turn within the reply's and the message's limits too. */
  reads: MindsReads;
  memory: MindsMemoryOverrides;
  /** The user's own prompt for a purpose, which wins over a world template; absent, the world's (`worldMindTemplate`), else the built-in (`MIND_PROMPT_DEFAULTS`). */
  prompts: Partial<Record<MindPurpose, string>>;
  /** A time skip's caps (DESIGN §24.7): beats per skip and minds per beat. */
  skip: { maxBeats: Limit; maxMindsPerBeat: Limit };
  /** Knowledge (DESIGN §24.11): the user's own, so no preset sets it. */
  knowledge: KnowledgeSettings;
}

type PresetMinds = Omit<MindsSettings, "prompts" | "memory" | "reads" | "knowledge">;

/** The minds part of each Model use preset (D25): Lean off; Standard 3 Live with notes for Live; Full no limit with notes for Live and Near. */
export const MINDS_PRESETS: Readonly<Record<"lean" | "standard" | "full", Readonly<PresetMinds>>> = Object.freeze({
  lean: { enabled: false, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 1, memoryLevels: [], tokens: 1200, skip: { maxBeats: 4, maxMindsPerBeat: 2 } },
  standard: { enabled: true, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 2, memoryLevels: ["live"], tokens: 2400, skip: { maxBeats: 6, maxMindsPerBeat: 3 } },
  full: { enabled: true, liveLimit: "none", nearRefresh: { scene: true, mention: true, turns: 4, minutes: 60 }, farRefreshMinutes: 720, refreshLimit: "none", memoryLevels: ["live", "near"], tokens: 4000, skip: { maxBeats: "none", maxMindsPerBeat: "none" } },
});

/** A new user's minds settings: Standard's, reading what minds read by default. */
export function defaultMindsSettings(preset: keyof typeof MINDS_PRESETS = "standard"): MindsSettings {
  return { ...structuredClone(MINDS_PRESETS[preset]) as PresetMinds, reads: structuredClone(DEFAULT_MIND_READS), memory: {}, prompts: {}, knowledge: structuredClone(KNOWLEDGE_DEFAULTS) };
}

/** Kept equal to `defaultMindsSettings()`: what Settings shows as the defaults. */
export const MINDS_DEFAULTS: Readonly<MindsSettings> = Object.freeze(defaultMindsSettings());

/** The longest prompt a user or a world template may set for a minds step. */
export const MIND_PROMPT_MAX = 20_000;

/** A stored limit as read: "none", or a whole number from `lo` to `hi`; anything else is `fallback`. Job settings read theirs so too. */
export function limitIn(v: unknown, lo: number, hi: number, fallback: Limit): Limit {
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

/** One source as stored, checked: a switch, and a whole number of tokens from 1 or "none"; what doesn't read is `base`'s. */
function readOf(raw: unknown, base: Readonly<MindRead>): MindRead {
  const r = obj(raw);
  return { on: typeof r.on === "boolean" ? r.on : base.on, tokens: limitIn(r.tokens, 1, Number.MAX_SAFE_INTEGER, base.tokens) };
}

/** What a mind reads as stored, each source checked, else `base`'s. */
function readsOf(raw: unknown, base: Readonly<MindsReads>): MindsReads {
  const r = obj(raw);
  const recall = obj(r.recall);
  return {
    pinned: readOf(r.pinned, base.pinned),
    activated: readOf(r.activated, base.activated),
    reply: readOf(r.reply, base.reply),
    message: readOf(r.message, base.message),
    history: { ...readOf(r.history, base.history), messages: limitIn(obj(r.history).messages, 1, Number.MAX_SAFE_INTEGER, base.history.messages) },
    summary: readOf(r.summary, base.summary),
    memory: readOf(r.memory, base.memory),
    thoughts: readOf(r.thoughts, base.thoughts),
    recall: { on: typeof recall.on === "boolean" ? recall.on : base.recall.on },
    routine: readOf(r.routine, base.routine),
    // A file saved before minds read their plans on their own takes the default: on.
    plans: readOf(r.plans, base.plans),
    life: readOf(r.life, base.life),
    knowledge: { on: typeof obj(r.knowledge).on === "boolean" ? (obj(r.knowledge).on as boolean) : base.knowledge.on },
  };
}

/**
 * A settings file saved before minds had what they read (`minds.reads`), read as before where the
 * user had a say: the reply allowance it replaces (`minds.replyTokens`) is the latest reply's limit,
 * and under Custom, the lore setting the user gave Settings → Steps' Character minds card, which no
 * longer has one, gives each lore source its tokens (or turns both off where that lore was off), so
 * neither reads less than the card allowed. Under a preset the card's lore was the preset's, whose
 * cap is what cut pinned lore, so the sources take their defaults. The switches take the new
 * defaults: what minds read before let the planner's day and plans made from other minds into them.
 * A file that has `reads`, or no minds settings, comes back as it is.
 */
export function migrateMindReads(raw: JsonObject): JsonObject {
  const minds = raw.minds;
  if (!isRecord(minds) || minds.reads !== undefined) return raw;
  const { replyTokens, ...rest } = minds;
  const reads: JsonObject = { reply: { tokens: limitIn(replyTokens, 1, Number.MAX_SAFE_INTEGER, DEFAULT_MIND_READS.reply.tokens) } };
  const custom = isRecord(raw.modelUse) && raw.modelUse.preset === "custom";
  const steps: JsonObject = custom && isRecord(raw.modelUse) && isRecord(raw.modelUse.steps) ? raw.modelUse.steps : {};
  const lore = isRecord(steps.mind) && isRecord(steps.mind.lore) ? steps.mind.lore : null;
  const tokens = lore && typeof lore.tokens === "number" && Number.isSafeInteger(lore.tokens) && lore.tokens >= 0 ? lore.tokens : null;
  if (lore && (lore.policy === "none" || tokens === 0)) {
    reads.pinned = { on: false };
    reads.activated = { on: false };
  } else if (tokens !== null) {
    reads.pinned = { tokens };
    reads.activated = { tokens };
  }
  return { ...raw, minds: { ...rest, reads } };
}

/** `UserSettings.minds.knowledge` as the engine reads it: each field checked, else `base`'s; a wording for a text knowledge doesn't send is dropped. */
export function knowledgeSettingsOf(raw: unknown, base: Readonly<KnowledgeSettings> = KNOWLEDGE_DEFAULTS): KnowledgeSettings {
  const k = obj(raw);
  const whole = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= lo && v <= hi ? v : fallback);
  const prompts: Record<string, string> = {};
  for (const [id, text] of Object.entries(obj(k.prompts))) if ((KNOWLEDGE_TEXT_IDS as readonly string[]).includes(id) && typeof text === "string" && text.trim() !== "") prompts[id] = text.slice(0, MIND_PROMPT_MAX);
  const [lo, hi] = KNOWLEDGE_RANGES.threshold;
  const limits = Object.fromEntries(KNOWLEDGE_LIMITS.map((limit) => [limit, whole(k[limit], knowledgeLimitRange(limit), base[limit])])) as Record<KnowledgeLimit, number>;
  return {
    enabled: typeof k.enabled === "boolean" ? k.enabled : base.enabled,
    threshold: typeof k.threshold === "number" && Number.isFinite(k.threshold) && k.threshold >= lo && k.threshold <= hi ? k.threshold : base.threshold,
    batch: k.batch === "scene" || k.batch === "character" ? k.batch : base.batch,
    ...limits,
    prompts: isRecord(k.prompts) ? prompts : { ...base.prompts },
  };
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
    tokens: typeof m.tokens === "number" && Number.isSafeInteger(m.tokens) && m.tokens >= 0 ? m.tokens : base.tokens,
    reads: readsOf(m.reads, base.reads),
    memory: isRecord(m.memory) ? memoryOverridesOf(m.memory) : structuredClone(base.memory),
    prompts: isRecord(m.prompts) ? prompts : { ...base.prompts },
    skip: { maxBeats: limitIn(skip.maxBeats, 0, 200, base.skip.maxBeats), maxMindsPerBeat: limitIn(skip.maxMindsPerBeat, 0, 64, base.skip.maxMindsPerBeat) },
    knowledge: knowledgeSettingsOf(m.knowledge, base.knowledge),
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
 * Something a character means to do later (DESIGN §24.8): from the memory step or the GM. Times are
 * absolute game minutes. The castlife planner lays open plans in force (`planInForce`) into the
 * character's day and marks them `done` or `dropped` with `minds.plan`.
 */
export type MindPlan = {
  id: string;
  what: string;
  kind: PlanKind;
  when: { from: number; to: number };
  where: PlaceId | null;
  /** Everyone else in it, from this holder's side. */
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
  /**
   * One plan everyone in it holds (`sharesPlan`): each person in `with` but the player character has
   * it too, under the same id, from their own side, and settles it as they live it. Absent on a plan
   * of one person's, and on every plan recorded before plans were shared, which folds as it did.
   */
  shared?: true;
  /**
   * Whose memory recorded a shared plan (absent for the GM's): its words are that memory's reading of
   * the turn, so everyone else in it reads its kind, time, place and people, never its words (`planWords`).
   */
  by?: EntityId;
};

/**
 * What `who`'s mind is told a plan is (DESIGN §24.5): its words when the plan is theirs or the GM's;
 * for a shared plan another's memory recorded, only its kind, since another memory's reading of a
 * turn never reaches a mind.
 */
export function planWords(p: Pick<MindPlan, "what" | "kind" | "by">, who: EntityId): string {
  return p.by === undefined || p.by === who ? p.what : `a ${p.kind} plan`;
}

/**
 * Whether a plan is one everyone in it shares (DESIGN §24.8): any with others in it but a payment or
 * a loan, which goes one way, from the planner to the first person it's with.
 */
export function sharesPlan(p: Pick<MindPlan, "kind" | "with">): boolean {
  return p.with.length > 0 && p.kind !== "pay" && p.kind !== "lend";
}

/**
 * A shared plan's id: who is in it and when it starts, so the same plan has the same id whoever's
 * memory writes it, and a second memory of the turn finds it already held (DESIGN §24.8).
 */
export function sharedPlanId(people: readonly EntityId[], from: number): string {
  return `p_${hashParts("minds.plan.shared", String(from), ...[...new Set(people)].sort()).slice(0, 10)}`;
}

/**
 * Whether a plan drives anything: schedules, money, skip beats, fidelity and what a mind is told it
 * plans. Only plans the turn stated (the memory step's) and the GM's do. A mind's own (`source:
 * "mind"`), made in chats from before minds stopped proposing plans, were its guesses at a day the
 * story never set up, so they stay as thoughts the GM view shows and nothing acts on. Every consumer
 * reads plans through `keptPlans`, which keeps only these, so none can drift from another.
 */
export function planInForce(p: Pick<MindPlan, "source">): boolean {
  return p.source !== "mind";
}

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

/** When a mind was last due and at what level, as its cadence and a character's tier read it. */
export type MindDue = Pick<MindRecord, "at" | "round" | "level" | "place">;

/**
 * How a character goes about things, as the GM sets it (DESIGN §24.9): `reactive` answers the scene
 * and starts nothing of their own; `proactive` pursues their own aims unprompted.
 */
export type MindApproach = "reactive" | "proactive";
export const MIND_APPROACHES: readonly MindApproach[] = ["reactive", "proactive"];

/**
 * What the GM says a character means to do now, in the GM's own words, and how they go about it
 * (`minds.intent`). Their own mind reads it first and works from it; nothing else does. Either part
 * may be empty, never both: an intent with neither is cleared.
 */
export type MindIntent = {
  text: string;
  approach: MindApproach | null;
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
  /** The GM's intent for them in this chat (`minds.intent`); absent until one is set, and gone once cleared. */
  intent?: MindIntent;
  /**
   * Their mind was last due but not called (`minds.round` `levels`: off the POV's scene and in nothing
   * that could surface soon, DESIGN §24.1). The later of it and `mind` is when it was last due (`lastDue`).
   */
  passed?: MindDue;
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
  /** What everyone knows (DESIGN §24.11), the player character included: absent until a knowledge event, so a chat with none folds as it always did. */
  knowledge?: MindsKnowledge;
};

/** The most the state keeps; beyond, the oldest go first (the fold's hard bounds, whatever the settings show). */
export const MINDS_KEEP = { notes: 64, openCommitments: 48, closedCommitments: 16, openPlans: 24, closedPlans: 16, witness: 48, presence: 400 } as const;

/** The longest each piece of model text is kept, in characters (DESIGN §24.5); a longer one is cut at a word. */
export const MIND_TEXT_CAPS = {
  monologue: 1200,
  depiction: 600,
  intent: 300,
  /** The GM's intent for a character, in the GM's own words. */
  gmIntent: 600,
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

// ---------------------------------------------------------------- knowledge

/**
 * A fact's id (DESIGN §24.11): one per thing anyone can know, the same in every mind. `lore:<loreId>`
 * for world lore; `wi:<bookId>:<entryId>` for a whole World Info entry, `wi:<bookId>:<entryId>:<n>`
 * for its mark at index n (from 0, in the entry's order); `track:<trackId>:<stageId>`;
 * `field:<entityId>:<fieldId>`; `claim:<hash>` for a claim made in play (`claimFactId`). A `%` or a
 * `:` inside an id is written `%25` or `%3A` (`factId`), so each part reads back whole (`parseFactId`).
 */
export type FactId = string;

/** What a fact refers to. */
export type FactKind = "lore" | "wi" | "track" | "field" | "claim";
export const FACT_KINDS: readonly FactKind[] = ["lore", "wi", "track", "field", "claim"];

/** A fact's truth as the GM holds it: true, false (a wrong belief, a false rumour), or an open question. */
export type FactTruth = "true" | "false" | "open";
export const FACT_TRUTHS: readonly FactTruth[] = ["true", "false", "open"];

/**
 * One thing someone can know, held once in the minds slice (`minds.fact`): its id says where it
 * lives, never copying it; a short claim the narrator can read; the ids it is about (relevance only,
 * never who knows); and its truth. A claim made in play keeps its source; a book entry's keeps the
 * hash of the text it was read from (`textHash`), so a change to the entry shows. How long a claim
 * may be is a setting (`KnowledgeSettings.claimChars`), applied when one is proposed, never here.
 */
export type KnowledgeFact = {
  id: FactId;
  kind: FactKind;
  claim: string;
  about: EntityId[];
  truth: FactTruth;
  source?: { msg: MessageId | null; at: number };
  textHash?: string;
};

/** How someone came to hold a fact. */
export type HoldingHow = "authored" | "witnessed" | "told" | "inferred" | "guessed";
export const HOLDING_HOWS: readonly HoldingHow[] = ["authored", "witnessed", "told", "inferred", "guessed"];

/** What they take a fact to be. */
export type HoldingBelief = "true" | "false" | "uncertain";
export const HOLDING_BELIEFS: readonly HoldingBelief[] = ["true", "false", "uncertain"];

/** Whom someone keeps a fact from: the people named, or everyone. */
export type KeptFrom = EntityId[] | "everyone";

/**
 * One person's hold on one fact (DESIGN §24.11): how they came by it and from whom (`by`: who told
 * them, for one told), the evidence it rests on (fact ids, and refs to their witness entries:
 * `witnessRef`), since when, what they take it to be and how sure they are, from 0 to 1 (under the
 * threshold it is a suspicion), and whom they keep it from. No holding is not knowing. It keeps its
 * own source, so it outlives the witness log's bound.
 */
export type Holding = {
  how: HoldingHow;
  by: EntityId | null;
  evidence: string[];
  since: { msg: MessageId | null; at: number };
  belief: HoldingBelief;
  confidence: number;
  keptFrom?: KeptFrom;
};

/**
 * The knowledge part of the minds slice: every fact once, and each person's holdings by fact. `off`:
 * the chat stopped tracking knowledge (`minds.knowledge`), so every reader of it reads as before it
 * (DESIGN §24.11); absent, it tracks.
 */
export type MindsKnowledge = {
  facts: Record<FactId, KnowledgeFact>;
  holdings: Record<EntityId, Record<FactId, Holding>>;
  off?: true;
  /** The user's threshold as the chat's turns last recorded it (`minds.knowledge`), when it isn't the default: how sure a holding must be to reveal its fact (`revealsFact`). */
  threshold?: number;
};

/**
 * Whether a chat's state tracks knowledge (DESIGN §24.11): a chat that switched it off recorded so
 * (`minds.knowledge`), and every other one tracks what it holds (a chat that never learned anything
 * holds nothing). Reads the minds slice as it is stored, so the engine's own readers (the player
 * screens, `engine/visibility.ts`) and the pack's agree.
 */
export function knowledgeTracked(slice: unknown): boolean {
  const k = isRecord(slice) ? slice.knowledge : undefined;
  return !(isRecord(k) && k.off === true);
}

/** How sure a holding must be to reveal its fact, as the chat last recorded the user's threshold (`minds.knowledge`); the default when it never did. */
export function knowledgeThreshold(slice: unknown): number {
  const k = isRecord(slice) ? slice.knowledge : undefined;
  return isRecord(k) && isConfidence(k.threshold) ? k.threshold : KNOWLEDGE_DEFAULTS.threshold;
}

/**
 * Whether a holding reveals its fact to whoever holds it, as the player screens count the player
 * character's (DESIGN §24.11): believed true and at least as sure as the threshold, so a suspicion
 * or a disbelief reveals nothing; and never a track's stage or a world lore entry someone holds from
 * the start (`authored`: an owner's or a holder's, by the world's design), which the world's own
 * visibility shows or keeps. A World Info mark's holder from the start reads it as the mark says.
 */
export function revealsFact(fact: FactId, h: Pick<Holding, "how" | "belief" | "confidence">, threshold: number): boolean {
  if (h.belief !== "true" || !(h.confidence >= threshold)) return false;
  const kind = parseFactId(fact)?.kind;
  return !(h.how === "authored" && (kind === "track" || kind === "lore"));
}

/**
 * The secrets `who` holds as the player screens count them revealed (DESIGN §24.11, `revealsFact`):
 * each track stage (`track:<track>:<stage>`), each world lore entry (`lore:<id>`), and each World Info
 * entry or mark by its live lore id (`liveLoreIdOfWiFact`), while the chat tracks knowledge; none once
 * it stopped. Reads the minds slice as stored (`state.packs.minds`).
 */
export function heldSecrets(slice: unknown, who: EntityId): { stages: Record<TrackId, StageId[]>; lore: string[] } {
  const out: { stages: Record<TrackId, StageId[]>; lore: string[] } = { stages: {}, lore: [] };
  if (!knowledgeTracked(slice) || !isRecord(slice) || !isRecord(slice.knowledge)) return out;
  const holdings = isRecord(slice.knowledge.holdings) && hasOwn(slice.knowledge.holdings, who) ? slice.knowledge.holdings[who] : undefined;
  if (!isRecord(holdings)) return out;
  const threshold = knowledgeThreshold(slice);
  for (const [fact, h] of Object.entries(holdings)) {
    if (!isRecord(h) || typeof h.how !== "string" || typeof h.belief !== "string" || typeof h.confidence !== "number" || !revealsFact(fact, h as unknown as Holding, threshold)) continue;
    const ref = parseFactId(fact);
    if (ref?.kind === "track") out.stages[ref.track] = [...(hasOwn(out.stages, ref.track) ? (out.stages[ref.track] ?? []) : []), ref.stage];
    else if (ref?.kind === "lore") out.lore.push(ref.lore);
    else if (ref?.kind === "wi") out.lore.push(liveLoreIdOfWiFact(fact) ?? fact);
  }
  return out;
}

/** What an author gives someone from the start (`world.minds.holdings`): it seeds an `authored` holding. */
export type AuthoredHolding = Pick<Holding, "belief" | "confidence" | "keptFrom">;
/** Per person, each fact they hold from the start, by its id. */
export type AuthoredHoldings = Record<EntityId, Record<FactId, AuthoredHolding>>;

/** A fact id's parts (`parseFactId`, `factId`); a World Info entry's `mark` is null for the whole entry. */
export type FactRef =
  | { kind: "lore"; lore: string }
  | { kind: "wi"; book: string; entry: string; mark: number | null }
  | { kind: "track"; track: TrackId; stage: StageId }
  | { kind: "field"; entity: EntityId; field: FieldId }
  | { kind: "claim"; hash: string };

const escapePart = (s: string): string => s.replace(/%/g, "%25").replace(/:/g, "%3A");
const unescapePart = (s: string): string => s.replace(/%(25|3A)/gi, (m) => (m === "%25" ? "%" : ":"));

/** The id of the fact a reference names. */
export function factId(ref: FactRef): FactId {
  switch (ref.kind) {
    case "lore":
      return `lore:${escapePart(ref.lore)}`;
    case "wi":
      return `wi:${escapePart(ref.book)}:${escapePart(ref.entry)}${ref.mark === null ? "" : `:${ref.mark}`}`;
    case "track":
      return `track:${escapePart(ref.track)}:${escapePart(ref.stage)}`;
    case "field":
      return `field:${escapePart(ref.entity)}:${escapePart(ref.field)}`;
    case "claim":
      return `claim:${escapePart(ref.hash)}`;
  }
}

/** A fact id's parts, or null when it isn't in one of the five forms. */
export function parseFactId(id: string): FactRef | null {
  const [kind = "", ...raw] = id.split(":");
  if (raw.length === 0 || raw.some((p) => p === "")) return null;
  const [a = "", b = "", c = ""] = raw.map(unescapePart);
  switch (kind) {
    case "lore":
      return raw.length === 1 ? { kind: "lore", lore: a } : null;
    case "wi":
      if (raw.length === 2) return { kind: "wi", book: a, entry: b, mark: null };
      return raw.length === 3 && /^\d+$/.test(c) && Number.isSafeInteger(Number(c)) ? { kind: "wi", book: a, entry: b, mark: Number(c) } : null;
    case "track":
      return raw.length === 2 ? { kind: "track", track: a, stage: b } : null;
    case "field":
      return raw.length === 2 ? { kind: "field", entity: a, field: b } : null;
    case "claim":
      return raw.length === 1 ? { kind: "claim", hash: a } : null;
    default:
      return null;
  }
}

/** A book entry's or mark's live lore id (`book:<book>/<entry>`, a mark's `#<n>` from 1, as `backend/book-lore.ts` reads them), in its parts. */
const LIVE_BOOK_LORE = /^book:(.+)\/([^/#]+)(?:#(\d+))?$/;

/**
 * The World Info fact a live lore entry is (DESIGN §24.11): a book entry's own, `book:<book>/<entry>`,
 * is the whole entry `wi:<book>:<entry>`; its `n`th mark, `book:<book>/<entry>#<n>` from 1, is
 * `wi:<book>:<entry>:<n - 1>`, marks counting from 0. Null for any other lore id.
 */
export function wiFactIdOfLiveLore(loreId: string): FactId | null {
  const m = LIVE_BOOK_LORE.exec(loreId);
  if (!m) return null;
  const n = m[3] === undefined ? null : Number(m[3]);
  if (n !== null && (!Number.isSafeInteger(n) || n < 1)) return null;
  return factId({ kind: "wi", book: m[1] ?? "", entry: m[2] ?? "", mark: n === null ? null : n - 1 });
}

/** The live lore id of a World Info fact (`wiFactIdOfLiveLore`'s inverse), or null when the id isn't one. */
export function liveLoreIdOfWiFact(factIdText: FactId): string | null {
  const ref = parseFactId(factIdText);
  return ref?.kind === "wi" ? `book:${ref.book}/${ref.entry}${ref.mark === null ? "" : `#${ref.mark + 1}`}` : null;
}

/**
 * The fact a claim made in play is: its words (case, spacing and closing punctuation aside) and the
 * message it was made in, so the same claim from the same message is one fact whoever records it.
 */
export function claimFactId(claim: string, msg: MessageId | null): FactId {
  const words = claim.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.!?;:,]+$/u, "");
  return factId({ kind: "claim", hash: hashParts("minds.claim", words, msg ?? "").slice(0, 10) });
}

/** A witness entry as a holding's evidence names it: the entry whole, hashed, so it reads back from the log that keeps it. */
export function witnessRef(entry: Pick<WitnessEntry, "at" | "what" | "how" | "by" | "place">): string {
  return `witness:${hashParts("minds.witness", String(entry.at), entry.how, entry.by ?? "", entry.place ?? "", entry.what).slice(0, 10)}`;
}

/** Whether a piece of evidence names a witness entry (`witnessRef`) rather than a fact. */
export function isWitnessRef(ref: string): boolean {
  return /^witness:[0-9a-f]{10}$/.test(ref);
}

// ---------------------------------------------------------------- events

/** The minds pack's events. Every model answer is one, so a fold never calls a model. */
export const MINDS_EVENTS = {
  /** A turn's minds round: every turn with minds on (`on` true), and once with `on` false on the first turn after they're switched off; `levels`, the minds due that weren't called. */
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
  intent: "minds.intent",
  skip: "minds.skip",
  /** Knowledge (DESIGN §24.11): a fact recorded whole; people learning it, forgetting it, keeping it from others; its truth settled. */
  fact: "minds.fact",
  learn: "minds.learn",
  forget: "minds.forget",
  keep: "minds.keep",
  settle: "minds.settle",
  /** Whether the chat tracks knowledge from this turn on: recorded only when that changes in a chat that holds some. */
  knowledge: "minds.knowledge",
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
/** `minds.intent`: the GM's intent for a character, whole, or null to clear it. */
export type IntentEventData = { entity: EntityId; intent: MindIntent | null };
/** `minds.skip`: a time skip's beats, as scanned and as the `skip` step proposed them. */
export type SkipEventData = { from: number; to: number; beats: { at: number; reason: string; source: "scan" | "model" }[] };
/** `minds.fact`: a fact, recorded whole; one already held is replaced whole, and who holds it still does. */
export type FactEventData = { fact: KnowledgeFact };
/**
 * `minds.learn`: each of `who` holds the fact as given, since `msg` and `at`, in place of any holding
 * of it they had. `witness`, on a learning the knowledge step recorded: the line it adds to each
 * learner's witness log at `at`, what they saw (`witnessed`) or were told (`told`, by `by`), the
 * evidence the holding rests on (`witnessRef`), as `minds.presence` and `minds.memory` add theirs.
 */
export type LearnEventData = { who: EntityId[]; fact: FactId; how: HoldingHow; by: EntityId | null; evidence: string[]; belief: HoldingBelief; confidence: number; keptFrom?: KeptFrom; msg: MessageId | null; at: number; witness?: { what: string; place: PlaceId | null } };
/** `minds.forget`: none of `who` holds the fact any more. */
export type ForgetEventData = { who: EntityId[]; fact: FactId };
/** `minds.keep`: whom someone keeps a fact they hold from; an empty list keeps it from no one. */
export type KeepEventData = { who: EntityId; fact: FactId; keptFrom: KeptFrom };
/** `minds.settle`: a fact's truth as the GM holds it. */
export type SettleEventData = { fact: FactId; truth: FactTruth };
/** `minds.knowledge`: whether the chat tracks knowledge from this turn on (DESIGN §24.11). */
export type KnowledgeEventData = { on: boolean; threshold?: number };

/**
 * The knowledge step's answer (DESIGN §24.11), JSON, names as the model wrote them: new facts (a ref
 * of its own the lists use, the claim, whom it is about, its truth), who learned which fact and how
 * (witnessed, or told by someone), what someone worked out with how sure they are and what it rests
 * on, and what someone now doubts.
 */
export interface KnowledgeOutput {
  facts: { ref: string; claim: string; about?: string[]; truth?: FactTruth }[];
  learned: { who: string[]; fact: string; how: "witnessed" | "told"; by?: string; keptFrom?: string[] | "everyone" }[];
  inferred: { who: string; fact: string; confidence: number; evidence: string[]; belief?: HoldingBelief }[];
  doubted: { who: string; fact: string; confidence: number; belief?: HoldingBelief }[];
}

/**
 * The change types the knowledge step proposes for the player character (C4, Settings → Changes from
 * the reply, with learning as every type has): `learn`, a fact they learned (automatic by default);
 * `reveal`, the story revealing a secret to them (a world lore entry, a track's stage, a World Info
 * mark they didn't hold), which opens it on the player's screens (confirm by default).
 */
export const KNOWLEDGE_CHANGES = ["learn", "reveal"] as const;
export type KnowledgeChange = (typeof KNOWLEDGE_CHANGES)[number];

/**
 * A knowledge change as a proposal (C4): the player character's learning whole, with every fact it
 * names that the turn's start didn't hold (so it applies on its own, wherever it lands among the
 * read's changes), the fact's claim and who told them for the chip, and who learned it with them.
 */
export type KnowledgeProposal = {
  type: KnowledgeChange;
  facts: KnowledgeFact[];
  learn: LearnEventData;
  claim: string;
  with: EntityId[];
};

// ---------------------------------------------------------------- the narrator's section

/** The Minds section's slot and its preset outlet (DESIGN §6.8, §24.3). */
export const MINDS_SLOT = "minds";
export const MINDS_OUTLET = "lre_minds";

/** The Who knows what section's slot and its preset outlet (DESIGN §24.11, C5). */
export const KNOWLEDGE_SLOT = "knowledge";
export const KNOWLEDGE_OUTLET = "lre_knowledge";

// ---------------------------------------------------------------- Play → What you know

/** Play's What you know panel (DESIGN §24.11). */
export const KNOWN_PANEL = "minds.known";

/** One fact the player character holds, as What you know shows it: its claim, how and since when, what they make of it, and whom they keep it from, by name. */
export interface KnownItem {
  /** The row's key: opaque, never the fact's id, which may name a secret track or lore entry (DESIGN §7). */
  key: string;
  claim: string;
  how: HoldingHow;
  byName: string | null;
  sinceText: string;
  belief: HoldingBelief;
  confidence: number;
  /** Held less surely than the user's threshold. */
  suspicion: boolean;
  /** The fact is an open question. */
  open: boolean;
  keptFrom: string[] | "everyone" | null;
}

/** What you know: whether the chat tracks knowledge, and the player character's holdings, newest first. */
export interface KnownView {
  tracking: boolean;
  items: KnownItem[];
}

// ---------------------------------------------------------------- the GM view and its controls

/** One character in the GM view's minds panel (DESIGN §24.9): everything, secrets included. */
export interface MindsGmCharacter {
  entity: EntityId;
  name: string;
  fidelity: FidelityScore;
  /** The GM asked for a fresh mind next turn. */
  refreshQueued: boolean;
  /** The intent the GM set for them, or null. */
  intent: MindIntent | null;
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
  /** What they know (DESIGN §24.11), newest first. */
  holdings: MindsGmHolding[];
}

/**
 * One holding as GM → Minds shows it (DESIGN §24.11): the fact's claim, kind and truth, who told
 * them by name, since when in words, whether it is a suspicion (under the threshold), whom it is
 * kept from by name, and its evidence, each fact by its claim and each witness entry by its line.
 */
export type MindsGmHolding = Holding & {
  fact: FactId;
  claim: string;
  kind: FactKind;
  truth: FactTruth;
  byName: string | null;
  sinceText: string;
  suspicion: boolean;
  keptFromNames: string[] | "everyone";
  evidenceShown: MindsGmEvidence[];
};

/** One piece of a holding's evidence: a fact by its claim, a witness entry still in their log by its line, or one the log no longer keeps. */
export type MindsGmEvidence = { ref: string; kind: "fact" | "witness" | "gone"; text: string };

/** The chat's knowledge as the GM sees it: every fact with who holds it, the player character's own holdings, and the threshold a suspicion is under. */
export interface MindsGmKnowledge {
  facts: (KnowledgeFact & { holders: EntityId[] })[];
  pov: { entity: EntityId; name: string; holdings: MindsGmHolding[] } | null;
  threshold: number;
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
  knowledge: MindsGmKnowledge;
}

/**
 * The GM's minds controls, as `lre.edit` operations (one `fix` entry, with its Undo): pin a
 * character's fidelity (null unpins), ask for a fresh mind next turn, edit, add (`id` null) or
 * delete (`value` null) a note, commitment or plan, and set what they mean to do now. A `value` is
 * the item's fields to change; an added one needs its text (and for a plan its `what` and `when`).
 * An intent names only what changes, at least one part: `text` "" empties it and `approach` null
 * leaves it to their mind; with both empty the intent is cleared. `mind_knowledge` sets one holding
 * of a fact the chat holds, whole (anyone's, the player character's too), or with `holding` null
 * takes it away (DESIGN §24.11).
 */
export type MindEditOp =
  | { op: "mind_pin"; entity: EntityId; level: Fidelity | null }
  | { op: "mind_refresh"; entity: EntityId }
  | { op: "mind_memory"; entity: EntityId; part: "note" | "commitment" | "plan"; id: string | null; value: JsonObject | null }
  | { op: "mind_intent"; entity: EntityId; text?: string; approach?: MindApproach | null }
  | { op: "mind_knowledge"; entity: EntityId; fact: FactId; holding: Holding | null };

/**
 * A lore entry a call was given (DESIGN §24.5), as a player surface may show it: its title (or "A
 * hidden entry" when the title would say what the player doesn't know), its token cost, and whether
 * it was cut to fit its limit.
 */
export interface PinnedTrace {
  title: string;
  tokens: number;
  cut: boolean;
}

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
  /** The pinned lore it was given (DESIGN §24.5) that the player may know of; absent: none. */
  pinned?: PinnedTrace[];
  /** The lore the turn activated that it was given, the player may know of; absent: none. */
  activated?: PinnedTrace[];
  /** How many lines of their usual routine it was given (DESIGN §24.5); absent: none. A count, never the lines: a routine can hold a private block. */
  routine?: number;
  /** How many of their plans it was given (DESIGN §24.5); absent: none. A count, never the plans: a plan's words are private. */
  plans?: number;
  /** How many of the chat's latest messages it was given (Recent chat, DESIGN §24.5); absent: none. */
  history?: number;
  /** What the player should know of how it went: lore or routine cut or left out over what a mind reads of it, and why. */
  notes?: string[];
}

// ---------------------------------------------------------------- running minds

/** When a set of minds thinks (`runMinds`): a turn, or a beat inside a time skip. */
export interface MindMoment {
  kind: "turn" | "beat";
  /** Game minutes they think at. */
  at: number;
  /** Why now, in words, which a mind is told when the player said nothing: a beat's reason ("Marcus's appointment"), a time skip's end, or a GM's run between turns; "" on a plain turn. */
  reason: string;
  /** The player's latest message and the reply before it, on a turn; empty at a beat. */
  user: string;
  reply: string;
  /** At a time skip's beats and its end: what the player's message says the player character does in the skip, in their words (its fill); absent otherwise. */
  skip?: string;
}

/** How a time skip's calls (its plan, its beats, the minds in it) are given the player's words for the span: their directive, which comes first. */
export const SKIP_FILL_HEAD = "What the player's message says the player character does in this time, in their words (it comes first):";

/**
 * How one mind of a GM's run went (DESIGN §24.9): GM data, never on a player surface. `pinned`
 * lists the pinned lore it was given, by its own title, with what was cut or left out to fit.
 */
export interface MindsRunEntry {
  entity: EntityId;
  name: string;
  level: Fidelity;
  status: "waiting" | "thinking" | "recorded" | "failed" | "cancelled";
  /** Why it failed, in words. */
  reason?: string;
  ms?: number;
  tokens?: number;
  pinned?: (PinnedTrace & { left?: true })[];
}

/**
 * A GM's minds run (`lre.minds`, DESIGN §24.9): the minds asked, each with how it went, and how the
 * run ended. `message` says why it failed or how it ended when nothing was recorded; `pending`: its
 * edit was held while a reply was written and lands when it finishes; `undo`: the GM edit chip
 * that takes the recorded minds back, once there is one.
 */
export interface MindsRunView {
  runId: string;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  entries: MindsRunEntry[];
  message: string | null;
  pending: boolean;
  undo: string | null;
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
  knowledge: [
    "You keep track of who knows what in the roleplay world {{world}}. Below is a turn that just happened, as it was written: what was said and done, who could perceive it, the facts already in play, and what each person already knows, has witnessed lately and is like.",
    "Record only what the turn as written gives each person. Someone learns by witnessing what happens in front of them (seeing it, hearing it said aloud, reading it) or by being told it; whoever wasn't there witnessed nothing, and whoever tells something must already know it. Someone may also work something out, or guess at it, from what they already hold or witnessed: say how sure they are, and what it rests on. Note anyone the turn makes doubt something they held.",
    "A fact is one short, plain claim. Reuse a fact already listed, by its id, rather than restating it; make a new one only for what the turn establishes or raises. Never give anyone what they couldn't have learned here, and never reveal a secret they don't hold.",
  ].join("\n"),
});

/** The knowledge step's answer shape (DESIGN §24.11, a fixed output contract, §16): the engine reads these keys whatever its instructions say. */
export const KNOWLEDGE_ANSWER_SHAPE =
  'Answer with JSON only: {"facts": [{"ref": "n1", "claim": "...", "about": ["a name"], "truth": "true"}], "learned": [{"who": ["a name"], "fact": "a fact id or n1", "how": "witnessed", "by": "a name", "keptFrom": ["a name"]}], "inferred": [{"who": "a name", "fact": "a fact id or n1", "confidence": 0.5, "evidence": ["a fact id or a witness ref"], "belief": "true"}], "doubted": [{"who": "a name", "fact": "a fact id", "confidence": 0.3, "belief": "uncertain"}]}';

/** Each minds step's answer: the JSON the engine reads, appended after the instructions whoever wrote them. */
export const MIND_ANSWER_FORMATS: Readonly<Record<MindPurpose, string>> = Object.freeze({
  mind: [
    'Answer with JSON only: {"monologue": "...", "depiction": "...", "intent": "...", "reactions": ["..."], "mood": "...", "interrupt": {"reason": "..."}}',
    "- monologue: their private reasoning in the first person, at most six sentences.",
    "- depiction: how they come across right now, as behaviour anyone present could see (posture, tone, what they do). Never a secret, an unspoken reason or a thought.",
    "- intent: what they mean to do next, in one sentence.",
    '- reactions: up to three short conditional reactions ("if pressed about the cellar, changes the subject").',
    "- mood: one or two words.",
    "- interrupt: only when the moment is a beat inside a time skip and what they'd do now would interrupt the player character's skipped time (seeking them out, calling them). Leave it out otherwise.",
  ].join("\n"),
  memory: [
    'Answer with JSON only: {"notes": [{"text": "...", "salience": 3}], "commitments": [{"kind": "promise|debt|grudge|favour|plan|other", "with": ["a name"], "text": "...", "due": "YYYY-MM-DD HH:MM"}], "resolved": [{"id": "...", "status": "kept|broken|released"}], "plans": [], "told": [{"to": ["a name"], "what": "..."}], "summary": "..."}',
    "- notes: at most three things they will remember, in their own perspective; salience 1 (passing) to 5 (unforgettable).",
    "- commitments: promises, debts, grudges, favours and plans with someone that this turn made; due only when a time was set.",
    "- resolved: their open commitments (listed with ids) that this turn kept, broke or released.",
    '- plans: only what this turn states they will do later: said aloud, agreed with someone, or scheduled in the story as written; never a guess at what they might do. Each {"what": "...", "kind": "errand|meet|visit|work|rest|leisure|pay|lend|other", "when": {"from": "YYYY-MM-DD HH:MM", "to": "YYYY-MM-DD HH:MM"}, "where": "a place", "with": ["a name"], "priority": 3, "amount": 20}, with local times; priority 1 (whenever it fits) to 5 (it must happen); kind pay or lend, with amount, when they mean to hand someone money, and no amount otherwise.',
    "- told: what they told whom in this turn, in a few words each.",
    "- summary: their one-paragraph summary rewritten, only when this turn changed who they are or what they're about; leave it out otherwise.",
    "Use empty lists for anything the turn didn't give.",
  ].join("\n"),
  skip: 'Answer with JSON only: {"beats": [{"at": "YYYY-MM-DD HH:MM", "reason": "..."}]}, at most five, in time order; an empty list when there are none.',
  consolidate: 'Answer with JSON only: {"summary": "..."}: at most 900 characters of plain prose, in their own perspective.',
  knowledge: `${KNOWLEDGE_ANSWER_SHAPE}\n${KNOWLEDGE_TEXTS.stepAnswer}`,
});

/** The knowledge step's answer format as this user has it: its JSON shape, which is fixed (§16), then their own wording of what each list holds (`stepAnswer`). */
export function knowledgeAnswerFormat(settings: Pick<KnowledgeSettings, "prompts">): string {
  return `${KNOWLEDGE_ANSWER_SHAPE}\n${knowledgeText(settings, "stepAnswer")}`;
}

/**
 * The memory step's answer once the chat tracks knowledge (DESIGN §24.11, a fixed output contract
 * read beside the first, §16): the same, without `told`. The knowledge step is then telling's only
 * writer, as the listener's holding and `told` witness entry.
 */
export const MEMORY_ANSWER_V2: string = MIND_ANSWER_FORMATS.memory
  .replace(', "told": [{"to": ["a name"], "what": "..."}]', "")
  .split("\n")
  .filter((line) => !line.startsWith("- told:"))
  .join("\n");
