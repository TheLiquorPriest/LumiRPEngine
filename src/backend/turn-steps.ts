// The model steps around a turn beyond interpret, extract and select (DESIGN §5.2, §5.3): which
// steps fire (signals), how many may run (phase budgets), what they ask (built-in prompts, or the
// world's own step templates), and what comes back:
//   - prompted text: `brief` and the prose `outline` (stacked on the engine's beats), `choices`;
//   - prompted `effects`: proposals, validated and bounded like extraction by the caller;
//   - decisions: `npc.choose` (present agents before the plan, off-screen ones after the reply),
//     `contradiction` and `puzzle.answer`.
// Secrecy batching rule: each step is its own call, and prose-producing steps only ever see
// player-visible facts (lines that would leak an unrevealed truth are dropped), so a question that
// carries a secret never shares a call with prose.

import type { EntityId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { ModelUseSettings, StepConfig } from "../shared/settings";
import type { StepSignal } from "../shared/steps";
import type { ActionDef, StepPurpose, StepTemplateDef, WorldCurrency, WorldDoc } from "../shared/world";
import { calendarOf, dateAt, dayPartAt, formatClock } from "../engine/calendar";
import type { Answers, Questions } from "../engine/decide";
import { sample } from "../engine/decide";
import { optionalQuery } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import type { Rng } from "../engine/rng";
import { kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { EngineTurnPlan } from "../engine/turn";
import { findLeaks } from "../engine/visibility";
import { inMinorUnits, type Steps } from "./steps";

// ---------------------------------------------------------------- facts the steps see

/** Player-visible fact lines (the engine's slot renders, minus the turn's own), leak-checked. */
export function factLines(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, secrets: readonly string[]): string[] {
  const ctx = registry.context(world, state);
  const out: string[] = [];
  const pov = state.entities[world.pov];
  const place = placeOfEntity(state, world.pov);
  out.push(`${pov?.name ?? world.pov} is at ${place ? (world.places[place]?.name ?? place) : "an unknown place"}; it is ${formatClock(calendarOf(world), state.clock)}.`);
  for (const r of registry.renderers) {
    if (r.slot === "outcome" || r.slot === "montage" || r.slot === "outline") continue;
    try {
      for (const line of r.render(ctx)) if (findLeaks(line, secrets).length === 0 && !out.includes(line)) out.push(line);
    } catch {
      // A renderer that can't render this state contributes nothing.
    }
    if (out.length >= 40) break;
  }
  return out.slice(0, 40);
}

/** People at the POV's place (by name), for prompts. */
export function presentNames(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  const here = placeOfEntity(state, world.pov);
  if (!here) return [];
  return Object.entries(state.entities)
    .filter(([id, e]) => id !== world.pov && e.agent && placeOfEntity(state, id) === here)
    .map(([, e]) => e.name);
}

/** Open ties in agents' day plans (sim's `castlife.tie_zones`), split by whether the agent is with the POV. */
export function tiesOf(ctx: ReadContext, world: WorldDoc, state: Readonly<WorldState>): { present: Tie[]; offscreen: Tie[] } {
  const all = optionalQuery(ctx, "castlife.tie_zones")?.(ctx) ?? [];
  const here = placeOfEntity(state, world.pov);
  const present: Tie[] = [];
  const offscreen: Tie[] = [];
  for (const t of all) (here !== null && placeOfEntity(state, t.agent) === here ? present : offscreen).push({ key: t.key, agent: t.agent, options: [...t.options] });
  return { present, offscreen };
}

/** Where the POV was and when, before a plan (all `planFacts` needs of the earlier state). */
export interface PlanStart {
  place: string | null;
  clock: number;
}

/** What a plan changed that signals read: scene, day part, day, beats, invitations, conflict, timelapse. */
export function planFacts(world: WorldDoc, before: PlanStart, after: Readonly<WorldState>, plan: EngineTurnPlan | undefined): Pick<SignalFacts, "sceneChange" | "slotCrossed" | "dayStart" | "beat" | "invitation" | "conflict" | "timelapse"> {
  const cal = calendarOf(world);
  const res = plan?.resolution ?? null;
  return {
    sceneChange: before.place !== placeOfEntity(after, world.pov),
    slotCrossed: after.clock > before.clock && dayPartAt(cal, before.clock).id !== dayPartAt(cal, after.clock).id,
    dayStart: dateAt(cal, after.clock).dayIndex > dateAt(cal, before.clock).dayIndex,
    beat: (plan?.outline.length ?? 0) > 0,
    invitation: (plan?.events ?? []).some((e) => e.type === "castlife.invitation"),
    conflict: !!res && (!res.ok || res.rejected.length > 0 || /fail|miss|bad/i.test(res.check?.outcome ?? "")),
    timelapse: !!plan?.timelapse,
  };
}

/**
 * Whether `interpret`'s params name the right real things: a ref param must be an entity of the
 * param's kind (with inheritance), or a place where the param takes places. Typed text that names
 * nothing that fits ("I take the cash" when cash is an account, not an item) is roleplay for the
 * narrator and `extract`, not an action that would fail.
 */
export function refsExist(registry: Registry, action: ActionDef | undefined, params: JsonObject, world: WorldDoc, state: Readonly<WorldState>): boolean {
  if (!action) return false;
  for (const [name, def] of Object.entries(action.params)) {
    if (def.type !== "ref") continue;
    const v = params[name];
    if (v === undefined || v === null || v === "") {
      if (!def.optional) return false;
      continue;
    }
    if (!safeKey(v)) return false;
    const entity = hasOwn(state.entities, v) ? state.entities[v] : undefined;
    if (entity) {
      if (def.ref && !kindIs(registry, world, entity.kind, def.ref)) return false;
      continue;
    }
    if (!hasOwn(world.places, v) || (def.ref !== undefined && def.ref !== "place")) return false;
  }
  return true;
}

// ---------------------------------------------------------------- signals (DESIGN §5.2)

/** What happened this turn, as far as a phase can see it. */
export interface SignalFacts {
  /** The turn's user text was typed (not a palette or chip action). */
  typed: boolean;
  /** The typed-input classifier fired. */
  classifier: boolean;
  /** A reply exists (the post phase). */
  reply: boolean;
  /** Lore candidates without a cached decision (the select phase). */
  uncached: boolean;
  candidatesChanged: boolean;
  hitSetChanged: boolean;
  /** The POV's place changed since the last turn (or by this turn's plan). */
  sceneChange: boolean;
  /** The plan crossed a day part. */
  slotCrossed: boolean;
  /** The plan crossed midnight. */
  dayStart: boolean;
  /** The plan has outline beats. */
  beat: boolean;
  /** Agents are at the POV's place. */
  agentsPresent: boolean;
  /** Open ties for agents at the POV's place. */
  present: boolean;
  /** Open ties for agents elsewhere. */
  offscreen: boolean;
  /** Open ties for the agents this phase decides for. */
  tieZone: boolean;
  /** An invitation was made in the last turn or this plan. */
  invitation: boolean;
  timelapse: boolean;
  /** The turn's action failed, was declined, or rolled a failing band. */
  conflict: boolean;
  /** Assistant turns so far, counting this one. */
  turn: number;
}

export function noFacts(turn = 0): SignalFacts {
  return { typed: false, classifier: false, reply: false, uncached: false, candidatesChanged: false, hitSetChanged: false, sceneChange: false, slotCrossed: false, dayStart: false, beat: false, agentsPresent: false, present: false, offscreen: false, tieZone: false, invitation: false, timelapse: false, conflict: false, turn };
}

const FACT_OF: Record<Exclude<StepSignal, "always" | "never">, keyof SignalFacts> = {
  typed_input: "typed",
  classifier: "classifier",
  reply: "reply",
  uncached: "uncached",
  candidates_changed: "candidatesChanged",
  hit_set_changed: "hitSetChanged",
  scene_change: "sceneChange",
  slot_crossed: "slotCrossed",
  day_start: "dayStart",
  beat: "beat",
  agents_present: "agentsPresent",
  present: "present",
  offscreen: "offscreen",
  tie_zone: "tieZone",
  invitation: "invitation",
  timelapse: "timelapse",
  conflict: "conflict",
};
const FACTS_BY_SIGNAL = new Map<string, keyof SignalFacts>(Object.entries(FACT_OF));

/** Whether any of `signals` fires; `never` wins over everything. */
export function fires(signals: readonly string[], f: SignalFacts): boolean {
  if (signals.includes("never")) return false;
  for (const s of signals) {
    if (s === "always") return true;
    const every = /^every_n:(\d+)$/.exec(s);
    if (every) {
      const k = Number(every[1]);
      if (k > 0 && f.turn % k === 0) return true;
      continue;
    }
    const key = FACTS_BY_SIGNAL.get(s);
    if (key && f[key] === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------- budgets (DESIGN §5.3)

/**
 * A phase's call budget: steps run by priority and each takes one call before it starts (a JSON
 * repair call or a decision falling back to the helper is not charged). At the deadline the
 * remaining steps fall back to engine-only; a deadline of 0 ms leaves no time for any call.
 */
export class StepBudget {
  private used = 0;
  private readonly open: boolean;
  readonly signal: AbortSignal;

  constructor(
    readonly calls: number,
    ms: number,
    parent?: AbortSignal,
  ) {
    this.open = ms > 0;
    const timeout = AbortSignal.timeout(Math.max(1, ms));
    this.signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
  }

  take(): boolean {
    if (!this.open || this.used >= this.calls || this.signal.aborted) return false;
    this.used++;
    return true;
  }

  get spent(): number {
    return this.used;
  }
}

// ---------------------------------------------------------------- what runs

export interface StepRun {
  purpose: StepPurpose;
  config: StepConfig;
  /** The world's template for this run; null for the built-in prompt. */
  template: StepTemplateDef | null;
}

/** The world's step templates for a purpose, in id order (DESIGN §5.2 "templates with engine placeholders"). */
export function templatesFor(world: WorldDoc, purpose: StepPurpose): StepTemplateDef[] {
  return Object.values(world.steps)
    .filter((t) => t.purpose === purpose)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The runs of a purpose this phase: one per world template (its own signals, else the step's),
 * or the built-in prompt. The user's step settings decide whether the purpose runs at all;
 * `puzzle.answer` is the author's opt-in, so it runs unless the user turned it off.
 */
export function runsOf(modelUse: ModelUseSettings, world: WorldDoc, purpose: StepPurpose, facts: SignalFacts, output?: StepTemplateDef["output"]): StepRun[] {
  const config = modelUse.steps[purpose] ?? (purpose === "puzzle.answer" ? { enabled: true, signals: ["always"] } : null);
  if (!config?.enabled) return [];
  const templates = templatesFor(world, purpose).filter((t) => output === undefined || t.output === output);
  if (templates.length === 0) return output === "effects" ? [] : fires(config.signals, facts) ? [{ purpose, config, template: null }] : [];
  return templates.filter((t) => fires(t.signals.length > 0 ? t.signals : config.signals, facts)).map((template) => ({ purpose, config, template }));
}

// ---------------------------------------------------------------- prompts

/** Fills `{{name}}` engine placeholders; unknown names render empty. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, name: string) => vars[name.toLowerCase()] ?? "");
}

/** Prompt variables, every one player-visible: lines that would leak an unrevealed truth are dropped. */
export function safeVars(vars: Readonly<Record<string, string>>, secrets: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = v.split("\n").filter((line) => findLeaks(line, secrets).length === 0).join("\n");
  return out;
}

const BUILTIN: Record<"brief" | "outline" | "choices", string> = {
  brief: "You brief a roleplay narrator before their next reply. In two or three sentences, say what matters right now in {{world}}: where {{pov}} is, who is present, what the player just did and how it turned out, and anything pressing. Use only the facts given; invent nothing.",
  outline: "You outline a roleplay narrator's next reply. Expand the engine's beats into two to four short beats, in order, consistent with the facts and the outcome. Don't decide anything the facts don't settle, and don't add events.",
  choices: "Suggest three short, distinct things {{pov}} could do next, given the narrator's reply and the facts. Each under twelve words, first person, as the player would type it.",
};

const CONTRACT: Record<"brief" | "outline" | "choices" | "effects", string> = {
  brief: 'Output JSON only: {"text": string}.',
  outline: 'Output JSON only: {"beats": string[]}.',
  choices: 'Output JSON only: {"choices": string[]}.',
  effects:
    'Propose only concrete state changes the facts or the reply establish. Types: time_advance{minutes} · location{entity,place} · purchase{item,category,payer?,qty?,price?} · transfer{from,to,amount} · give{item,from,to} · quantity{entity,item,delta} · condition{who,condition,minutes?,clear?} · regard{from,to,axis,delta} · knows{who,fact} · spawn{kind,name,place?,role?}. Use world ids. Output JSON only: {"proposals": [{"type": ...}]}.',
};

function dataBlock(vars: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  const add = (label: string, key: string): void => {
    const v = vars[key];
    if (v && v.trim() !== "") parts.push(`${label}:\n${v}`);
  };
  add("Facts", "facts");
  add("Present", "present");
  add("Outcome", "outcome");
  add("Engine beats", "beats");
  add("Brief", "brief");
  add("Recent messages", "recent");
  add("The player wrote", "user");
  add("The narrator's reply", "reply");
  return parts.join("\n\n") || "(no facts)";
}

function strings(v: JsonValue | undefined, max: number, chars = 300): string[] {
  if (typeof v === "string") return v.trim() === "" ? [] : [v.trim().slice(0, chars)];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .slice(0, max)
    .map((x) => x.trim().slice(0, chars));
}

/**
 * A prompted step (`brief`, `outline`, `choices`): the world's template or the built-in
 * instructions, the output contract, and the facts. Prose comes back leak-checked; null when
 * the call fails.
 */
export async function promptedText(steps: Steps, run: StepRun, kind: "brief" | "outline" | "choices", vars: Readonly<Record<string, string>>, secrets: readonly string[], userId: UserId, signal: AbortSignal): Promise<string[] | null> {
  const instructions = renderTemplate(run.template?.template ?? BUILTIN[kind], vars);
  const raw = await steps.helperJson(run.purpose, `${instructions}\n${CONTRACT[kind]}`, dataBlock(vars), run.config, userId, signal);
  if (!isRecord(raw)) return null;
  const lines = kind === "brief" ? strings(raw.text, 1, 600) : kind === "outline" ? strings(raw.beats, 4) : strings(raw.choices, 4, 120);
  return lines.filter((l) => findLeaks(l, secrets).length === 0);
}

/** A prompted `effects` step (a world template with `output: "effects"`): proposals, for the caller to validate and bound like extraction. */
export async function promptedEffects(steps: Steps, run: StepRun, vars: Readonly<Record<string, string>>, currency: WorldCurrency, userId: UserId, signal: AbortSignal): Promise<JsonObject[]> {
  if (!run.template) return [];
  const money = `Money amounts are plain amounts in ${currency.code} as written (8 for ${currency.symbol}8).`;
  const raw = await steps.helperJson(run.purpose, `${renderTemplate(run.template.template, vars)}\n${CONTRACT.effects} ${money}`, dataBlock(vars), run.config, userId, signal);
  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : [];
  const out: JsonObject[] = [];
  for (const p of list.slice(0, 15)) if (isRecord(p) && typeof p.type === "string") out.push(inMinorUnits(JSON.parse(JSON.stringify(p)) as JsonObject, currency));
  return out;
}

// ---------------------------------------------------------------- decisions

/** An open tie in an agent's day plan (sim's `castlife.tie_zones`). */
export interface Tie {
  key: string;
  agent: EntityId;
  options: string[];
}

const humanize = (id: string): string => id.replace(/[_:.-]+/g, " ").trim();

/**
 * `npc.choose` (DESIGN §5.2): one choice question per open tie, answered as probabilities and
 * sampled with the turn's seeded rng; returns `castlife.decision` events. The questions may carry
 * agents' private plans, so this call never includes prose.
 */
export async function npcChoose(steps: Steps, run: StepRun, ties: readonly Tie[], describe: (tie: Tie) => JsonValue, rng: Rng, userId: UserId, signal: AbortSignal): Promise<LedgerEvent[]> {
  const asked = ties.filter((t) => t.options.length > 1).slice(0, 12);
  if (asked.length === 0) return [];
  const questions: Questions = {};
  const state: Record<string, JsonValue> = {};
  asked.forEach((t, i) => {
    const criteria: Record<string, string> = {};
    for (const o of t.options) criteria[o] = humanize(o);
    questions[`t${i}`] = { type: "choice", instructions: run.template?.template ?? "What does this character choose to do, given their needs, plans and relationships? Pick what they would most plausibly do.", criteria };
    state[`t${i}`] = describe(t);
  });
  const answer = await steps.decide("npc.choose", state, questions, run.config, userId, signal);
  if (!answer) return [];
  return decisionEvents(asked, answer.answers, rng);
}

export function decisionEvents(asked: readonly Tie[], answers: Answers, rng: Rng): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  asked.forEach((t, i) => {
    const a = answers[`t${i}`];
    if (!a || a.type !== "choice") return;
    const probabilities: Record<string, number> = {};
    for (const o of t.options) probabilities[o] = Math.max(0, a.probabilities[o] ?? 0);
    if (Object.values(probabilities).every((p) => p === 0)) return;
    const choice = sample(probabilities, rng.fork(t.key), t.options);
    out.push({ type: "castlife.decision", data: { key: t.key, choice } });
  });
  return out;
}

/**
 * `contradiction` (DESIGN §5.2, §18 "narrator contradiction"): which engine fact, if any, the reply
 * contradicts. Facts are player-visible only. Null when no fact is contradicted or the call fails.
 */
export async function contradiction(steps: Steps, run: StepRun, facts: readonly string[], reply: string, userId: UserId, signal: AbortSignal): Promise<string | null> {
  const asked = facts.slice(0, 12);
  if (asked.length === 0 || reply.trim() === "") return null;
  const criteria: Record<string, string> = { none: "The reply is consistent with every fact." };
  asked.forEach((f, i) => {
    criteria[`f${i}`] = f;
  });
  const questions: Questions = { contradicts: { type: "choice", instructions: run.template?.template ?? "Does the narrator's reply contradict one of these engine facts? Pick the fact it contradicts, or none.", criteria } };
  const answer = await steps.decide("contradiction", { reply: reply.slice(0, 4000) }, questions, run.config, userId, signal);
  const a = answer?.answers.contradicts;
  if (!a || a.type !== "choice" || a.choice === "none" || a.confidence < 0.5) return null;
  const index = Number(a.choice.slice(1));
  return Number.isInteger(index) ? (asked[index] ?? null) : null;
}

/**
 * `puzzle.answer` (DESIGN §10, authored opt-in): the probability that the player's answer is
 * correct. The question carries the accepted answers (a secret), so it is its own decision call.
 */
export async function puzzleAnswer(steps: Steps, run: StepRun, question: string, accepted: readonly string[], answer: string, userId: UserId, signal: AbortSignal): Promise<number | null> {
  const questions: Questions = { correct: { type: "noul", instructions: run.template?.template ?? "Is the player's answer correct: the same as one of the accepted answers, allowing for wording and spelling?" } };
  const result = await steps.decide("puzzle.answer", { question, accepted: [...accepted], answer }, questions, run.config, userId, signal);
  const a = result?.answers.correct;
  return a && a.type === "noul" ? a.noul : null;
}
