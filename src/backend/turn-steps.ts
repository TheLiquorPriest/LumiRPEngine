// The model steps around a turn beyond interpret and extract (DESIGN §5.2, §5.3): which
// steps fire (signals), how many may run (phase budgets), what they ask (built-in prompts, or the
// world's own step templates), and what comes back:
//   - prompted text: `brief` and the prose `outline` (stacked on the engine's beats), `choices`;
//   - prompted `effects`: proposals, validated and bounded like extraction by the caller;
//   - decisions: `npc.choose` (present agents before the plan, off-screen ones after the reply),
//     `contradiction`, `puzzle.answer` and `judge` (the player's described approach, DESIGN §11).
// Secrecy batching rule: each step is its own call, and prose-producing steps only ever see
// player-visible facts (lines that would leak an unrevealed truth are dropped), so a question that
// carries a secret never shares a call with prose.

import type { EntityId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { LookupLimits, ModelUseSettings, StepConfig, UserSettings } from "../shared/settings";
import { stepConfigOf } from "../shared/settings";
import type { StepSignal } from "../shared/steps";
import { limitOf, MINDS_SLOT } from "../shared/minds";
import type { Timeout } from "../shared/timeouts";
import { within } from "../shared/timeouts";
import type { ActionDef, ParamDef, StepPurpose, StepTemplateDef, WorldCurrency, WorldDoc } from "../shared/world";
import { calendarOf, dateAt, dayPartAt, formatClock } from "../engine/calendar";
import type { Judgement } from "../engine/adjudication";
import type { Answers, Questions } from "../engine/decide";
import { sample } from "../engine/decide";
import { optionalQuery } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import { readPass } from "../engine/read-pass";
import type { Registry } from "../engine/registry-impl";
import type { Rng } from "../engine/rng";
import { kindIs, placeOfEntity } from "../engine/scope";
import { povLife } from "../engine/life";
import type { WorldState } from "../engine/state";
import type { EngineTurnPlan } from "../engine/turn";
import { canSeeEntity, findLeaks, povPlace } from "../engine/visibility";
import { LookupBudget, type StepLore } from "./lore-steps";
import type { Guidance } from "./preset-binding";
import { inMinorUnits, type Steps } from "./steps";

// ---------------------------------------------------------------- facts the steps see

/**
 * Player-visible fact lines (the engine's slot renders, minus the turn's own), leak-checked. Stance
 * is left out: its cues are hints for the narrator to play, and a prose helper given one could state
 * it (DESIGN §6.6). So is every other hint (People's usual routines): background for the narrator,
 * which a helper or the contradiction check would read as fact. So is the Minds section: under
 * `full` it carries each mind whole, which only the narrator may read, to depict and never state
 * (DESIGN §24.3).
 */
export function factLines(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, secrets: readonly string[]): string[] {
  // Every renderer reads the same state: one read pass (DESIGN §9.6).
  return readPass(() => {
    const ctx = registry.context(world, state);
    const out: string[] = [];
    const pov = state.entities[world.pov];
    // Where the POV is, as every player surface names it: a place it can't see is somewhere unnamed.
    const place = povPlace(registry, world, state);
    out.push(`${pov?.name ?? world.pov} is ${place === null ? "at an unknown place" : place.id === null ? "somewhere" : `at ${place.name}`}; it is ${formatClock(calendarOf(world), state.clock)}.`);
    for (const r of registry.renderers) {
      if (r.hint || r.slot === "outcome" || r.slot === "montage" || r.slot === "outline" || r.slot === "stance" || r.slot === MINDS_SLOT) continue;
      try {
        for (const line of r.render(ctx)) if (findLeaks(line, secrets).length === 0 && !out.includes(line)) out.push(line);
      } catch {
        // A renderer that can't render this state contributes nothing.
      }
      if (out.length >= 40) break;
    }
    return out.slice(0, 40);
  });
}

/** Agents at the POV's place that it can see: a hidden or removed one is never among them. */
function presentAgents(registry: Registry, world: WorldDoc, state: Readonly<WorldState>) {
  const here = placeOfEntity(state, world.pov);
  if (!here) return [];
  return Object.entries(state.entities).filter(([id, e]) => id !== world.pov && e.agent && placeOfEntity(state, id) === here && canSeeEntity(registry, world, state, world.pov, id));
}

/** People at the POV's place that it can see (by name), for prompts; a life state the POV knows follows the name ("Sir Alaric (lies dead)"). */
export function presentNames(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  return presentAgents(registry, world, state).map(([id, e]) => {
    const life = povLife(world, state, id);
    return life ? `${e.name} (${life.reads})` : e.name;
  });
}

/** Whether anyone here may act, as far as the POV knows (the `agents_present` signal): a body it knows of doesn't count. */
export function agentsActHere(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): boolean {
  return presentAgents(registry, world, state).some(([id]) => povLife(world, state, id)?.acts !== false);
}

/**
 * Open ties for `npc.choose`, split by whether the agent is with the POV: agents' day plans (sim's
 * `castlife.tie_zones`), and a fight's turns before the POV's next one (`combat.choices`), which
 * are always with the POV.
 */
export function tiesOf(ctx: ReadContext, world: WorldDoc, state: Readonly<WorldState>): { present: Tie[]; offscreen: Tie[] } {
  const all = optionalQuery(ctx, "castlife.tie_zones")?.(ctx) ?? [];
  const here = placeOfEntity(state, world.pov);
  const present: Tie[] = [];
  const offscreen: Tie[] = [];
  for (const t of all) (here !== null && placeOfEntity(state, t.agent) === here ? present : offscreen).push({ key: t.key, agent: t.agent, options: [...t.options] });
  for (const t of optionalQuery(ctx, "combat.choices")?.(ctx) ?? []) present.push({ key: t.key, agent: t.agent, options: [...t.options], labels: t.labels, decision: "combat.decision" });
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
  // A conflict in any of the turn's actions (DESIGN §11 action queue) counts.
  const conflict = (plan?.resolutions ?? []).some((res) => !res.ok || res.rejected.length > 0 || /fail|miss|bad/i.test(res.check?.outcome ?? (res.adjudged ? (res.outcome ?? "") : "")));
  return {
    sceneChange: before.place !== placeOfEntity(after, world.pov),
    slotCrossed: after.clock > before.clock && dayPartAt(cal, before.clock).id !== dayPartAt(cal, after.clock).id,
    dayStart: dateAt(cal, after.clock).dayIndex > dateAt(cal, before.clock).dayIndex,
    beat: (plan?.outline.length ?? 0) > 0,
    invitation: (plan?.events ?? []).some((e) => e.type === "castlife.invitation"),
    conflict,
    timelapse: !!plan?.timelapse,
  };
}

/** A ref param of `interpret`'s read that names nothing that fits (`unfitRef`): its name, its definition and what it held. */
export interface UnfitRef {
  param: string;
  def: ParamDef;
  value: JsonValue | undefined;
}

/**
 * The first ref param of `interpret`'s params that doesn't name the right real thing, or null when
 * every one does: an entity of the param's kind (with inheritance), or a place where the param takes
 * places. Typed text that names nothing that fits ("I take the cash" when cash is an account, not an
 * item) is roleplay for the narrator and `extract`, not an action that would fail; its reply says why
 * on a decline chip (DESIGN §9.4). An entity the POV may not know of (`mayKnow`) counts as nothing:
 * a guessed id of a hidden thing must read as one nothing has, or the outcome would tell the player
 * it exists.
 */
export function unfitRef(registry: Registry, action: ActionDef, params: JsonObject, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean, skip?: string): UnfitRef | null {
  for (const [name, def] of Object.entries(action.params)) {
    // `skip`: a param a claim fills (DESIGN §9.4), so only the action's others are judged.
    if (def.type !== "ref" || name === skip) continue;
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      if (!def.optional) return { param: name, def, value };
      continue;
    }
    if (!safeKey(value)) return { param: name, def, value };
    const entity = hasOwn(state.entities, value) ? state.entities[value] : undefined;
    if (entity) {
      if (!mayKnow(value) || (def.ref && !kindIs(registry, world, entity.kind, def.ref))) return { param: name, def, value };
      continue;
    }
    if (!hasOwn(world.places, value) || (def.ref !== undefined && def.ref !== "place")) return { param: name, def, value };
  }
  return null;
}

// ---------------------------------------------------------------- signals (DESIGN §5.2)

/** What happened this turn, as far as a phase can see it. */
export interface SignalFacts {
  /** The turn's user text was typed (not a palette or chip action). */
  typed: boolean;
  /** A reply exists (the post phase). */
  reply: boolean;
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
  return { typed: false, reply: false, sceneChange: false, slotCrossed: false, dayStart: false, beat: false, agentsPresent: false, present: false, offscreen: false, tieZone: false, invitation: false, timelapse: false, conflict: false, turn };
}

const FACT_OF: Record<Exclude<StepSignal, "always" | "never">, keyof SignalFacts> = {
  typed_input: "typed",
  reply: "reply",
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
function fires(signals: readonly string[], f: SignalFacts): boolean {
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

// ---------------------------------------------------------------- budgets (DESIGN §5.3, §5.4)

/**
 * A phase's call budget: steps run by priority and each takes one call before it starts (a JSON
 * repair call, a decision falling back to the helper or a need-form ask after a tool refusal is
 * not charged). The phase's time is the user's setting (`time`): when it runs out the signal aborts
 * with a `TimeoutFired` naming the setting, and the remaining steps fall back to engine-only; 0
 * leaves no time for any call, "none" sets no deadline. Its lore lookups have their own budget
 * (`lookup`): rounds, and the setting for how long after the phase starts one may begin.
 */
export class StepBudget {
  private used = 0;
  private readonly open: boolean;
  readonly signal: AbortSignal;
  readonly lookup: LookupBudget;

  constructor(
    readonly calls: number,
    time: Timeout,
    parent: AbortSignal | undefined,
    lookup: LookupLimits & { window: Timeout },
  ) {
    this.open = limitOf(time.limit) > 0;
    this.signal = within(parent, time.key, time.limit);
    this.lookup = new LookupBudget(lookup.calls, lookup.window, time, this.signal);
  }

  /** Takes a call, leaving `keep` free for a step that ranks higher but starts later (the judge, before npc.choose). */
  take(keep = 0): boolean {
    if (!this.open || this.used + keep >= this.calls || this.signal.aborted) return false;
    this.used++;
    return true;
  }

  get spent(): number {
    return this.used;
  }
}

/** Each phase's time limits (Settings → Timeouts): the phase's own, and its lookup window. */
const PHASE_TIMEOUTS = { pre: { time: "engineRunMs", window: "preLookupMs" }, post: { time: "postReplyMs", window: "postLookupMs" } } as const;

/** A phase's budget from the user's settings: its calls and lookup rounds (Model use), its time and lookup window (Timeouts). */
export function phaseBudget(settings: Pick<UserSettings, "modelUse" | "timeouts">, phase: "pre" | "post", parent?: AbortSignal): StepBudget {
  const b = settings.modelUse.budgets[phase];
  const keys = PHASE_TIMEOUTS[phase];
  return new StepBudget(b.calls, { key: keys.time, limit: settings.timeouts[keys.time] }, parent, { calls: b.lookup?.calls ?? 0, window: { key: keys.window, limit: settings.timeouts[keys.window] } });
}

// ---------------------------------------------------------------- what runs

export interface StepRun {
  purpose: StepPurpose;
  config: StepConfig;
  /** The world's template for this run; null for the built-in prompt. */
  template: StepTemplateDef | null;
  /** The active preset's style and rules for the step, appended after the prompt (DESIGN §6.8); "" for none. */
  guidance: string;
}

/** The world's step templates for a purpose, in id order (DESIGN §5.2 "templates with engine placeholders"). */
function templatesFor(world: WorldDoc, purpose: StepPurpose): StepTemplateDef[] {
  return Object.values(world.steps)
    .filter((t) => t.purpose === purpose)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The runs of a purpose this phase: one per world template (its own signals, else the step's),
 * or the built-in prompt; with `output`, only the templates with that output. The user's step
 * settings decide whether the purpose runs at all (`stepConfigOf`: `puzzle.answer` is the author's
 * opt-in, so it runs unless the user turned it off). Each run carries the preset's guidance for it.
 */
export function runsOf(modelUse: ModelUseSettings, world: WorldDoc, purpose: StepPurpose, facts: SignalFacts, options: { output?: StepTemplateDef["output"]; guidance?: Guidance } = {}): StepRun[] {
  const config = stepConfigOf(modelUse.steps, purpose);
  if (!config.enabled) return [];
  const guidance = options.guidance?.[purpose] ?? "";
  const templates = templatesFor(world, purpose).filter((t) => options.output === undefined || t.output === options.output);
  if (templates.length === 0) return options.output === "effects" ? [] : fires(config.signals, facts) ? [{ purpose, config, template: null, guidance }] : [];
  return templates.filter((t) => fires(t.signals.length > 0 ? t.signals : config.signals, facts)).map((template) => ({ purpose, config, template, guidance }));
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
  // The outline step's only: what the narrator has this turn (DESIGN §9.5).
  add("Sections the narrator has this turn (point at no other)", "sections");
  add("Recent turns", "recent");
  add("The player wrote", "user");
  add("The narrator's reply", "reply");
  return parts.join("\n\n") || "(no facts)";
}

/**
 * A prompted step's lines: its non-empty strings, trimmed, at most `max` of them. Each is checked whole
 * for an unrevealed secret and withheld when it carries one, before anything is cut, so a cut never
 * leaves part of a secret that the check looks for whole. One longer than `chars` is then cut to it,
 * or with `"drop"`, left out before the others are counted.
 */
function proseLines(v: JsonValue | undefined, max: number, secrets: readonly string[], chars = 300, long: "cut" | "drop" = "cut"): string[] {
  const all = (typeof v === "string" ? [v] : Array.isArray(v) ? v : []).flatMap((x) => (typeof x === "string" && x.trim() !== "" ? [x.trim()] : []));
  return (long === "drop" ? all.filter((x) => x.length <= chars) : all)
    .slice(0, max)
    .filter((x) => findLeaks(x, secrets).length === 0)
    .map((x) => x.slice(0, chars));
}

/**
 * A prompted step (`brief`, `outline`, `choices`): the world's template or the built-in
 * instructions, the output contract, and the facts. Prose comes back leak-checked; null when
 * the call fails.
 */
export async function promptedText(steps: Steps, run: StepRun, kind: "brief" | "outline" | "choices", vars: Readonly<Record<string, string>>, secrets: readonly string[], userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<string[] | null> {
  const instructions = renderTemplate(run.template?.template ?? BUILTIN[kind], vars);
  const raw = await steps.helperJson(run.purpose, `${instructions}\n${CONTRACT[kind]}`, dataBlock(vars), run.config, userId, signal, { lore, guidance: run.guidance });
  if (!isRecord(raw)) return null;
  // A brief or an outline beat may run long and is cut, once checked whole. A suggestion is a chip's
  // text and the player's next message: one too long for a chip is dropped rather than cut.
  return kind === "brief" ? proseLines(raw.text, 1, secrets, 600) : kind === "outline" ? proseLines(raw.beats, 4, secrets) : proseLines(raw.choices, 4, secrets, 120, "drop");
}

/** A prompted `effects` step (a world template with `output: "effects"`): proposals, for the caller to validate and bound like extraction. */
export async function promptedEffects(steps: Steps, run: StepRun, vars: Readonly<Record<string, string>>, currency: WorldCurrency, userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<JsonObject[]> {
  if (!run.template) return [];
  const money = `Money amounts are plain amounts in ${currency.code} as written (8 for ${currency.symbol}8).`;
  const raw = await steps.helperJson(run.purpose, `${renderTemplate(run.template.template, vars)}\n${CONTRACT.effects} ${money}`, dataBlock(vars), run.config, userId, signal, { lore, guidance: run.guidance });
  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : [];
  const out: JsonObject[] = [];
  for (const p of list.slice(0, 15)) if (isRecord(p) && typeof p.type === "string") out.push(inMinorUnits(JSON.parse(JSON.stringify(p)) as JsonObject, currency));
  return out;
}

// ---------------------------------------------------------------- decisions

/** An open tie for `npc.choose`: an agent's day plan (sim's `castlife.tie_zones`), or its turn in a fight (`combat.choices`). */
export interface Tie {
  key: string;
  agent: EntityId;
  options: string[];
  /** How each option reads in the question; its id in words otherwise. */
  labels?: Record<string, string>;
  /** The event that records the pick; `castlife.decision` otherwise. */
  decision?: `${string}.${string}`;
}

const humanize = (id: string): string => id.replace(/[_:.-]+/g, " ").trim();

/**
 * `npc.choose` (DESIGN §5.2): one choice question per open tie, answered as probabilities and
 * sampled with the turn's seeded rng; returns the decision events (`castlife.decision`, or the
 * tie's own). The questions may carry agents' private plans, so this call never includes prose.
 */
export async function npcChoose(steps: Steps, run: StepRun, ties: readonly Tie[], describe: (tie: Tie) => JsonValue, rng: Rng, userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<LedgerEvent[]> {
  const asked = ties.filter((t) => t.options.length > 1).slice(0, 12);
  if (asked.length === 0) return [];
  const questions: Questions = {};
  const state: Record<string, JsonValue> = {};
  asked.forEach((t, i) => {
    const criteria: Record<string, string> = {};
    for (const o of t.options) criteria[o] = t.labels?.[o] ?? humanize(o);
    questions[`t${i}`] = { type: "choice", instructions: run.template?.template ?? "What does this character choose to do, given their needs, plans and relationships? Pick what they would most plausibly do.", criteria };
    state[`t${i}`] = describe(t);
  });
  const answer = await steps.decide("npc.choose", state, questions, run.config, userId, signal, lore, run.guidance);
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
    out.push({ type: t.decision ?? "castlife.decision", data: { key: t.key, choice } });
  });
  return out;
}

/**
 * `contradiction` (DESIGN §5.2, §18 "narrator contradiction"): which engine fact, if any, the reply
 * contradicts. Facts are player-visible only. Null when no fact is contradicted or the call fails.
 */
export async function contradiction(steps: Steps, run: StepRun, facts: readonly string[], reply: string, userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<string | null> {
  const asked = facts.slice(0, 12);
  if (asked.length === 0 || reply.trim() === "") return null;
  const criteria: Record<string, string> = { none: "The reply is consistent with every fact." };
  asked.forEach((f, i) => {
    criteria[`f${i}`] = f;
  });
  const questions: Questions = { contradicts: { type: "choice", instructions: run.template?.template ?? "Does the narrator's reply contradict one of these engine facts? Pick the fact it contradicts, or none.", criteria } };
  const answer = await steps.decide("contradiction", { reply: reply.slice(0, 4000) }, questions, run.config, userId, signal, lore, run.guidance);
  const a = answer?.answers.contradicts;
  if (!a || a.type !== "choice" || a.choice === "none" || a.confidence < 0.5) return null;
  const index = Number(a.choice.slice(1));
  return Number.isInteger(index) ? (asked[index] ?? null) : null;
}

/**
 * `puzzle.answer` (DESIGN §10, authored opt-in): the probability that the player's answer is
 * correct. The question carries the accepted answers (a secret), so it is its own decision call.
 */
export async function puzzleAnswer(steps: Steps, run: StepRun, question: string, accepted: readonly string[], answer: string, userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<number | null> {
  const questions: Questions = { correct: { type: "noul", instructions: run.template?.template ?? "Is the player's answer correct: the same as one of the accepted answers, allowing for wording and spelling?" } };
  const result = await steps.decide("puzzle.answer", { question, accepted: [...accepted], answer }, questions, run.config, userId, signal, lore, run.guidance);
  const a = result?.answers.correct;
  return a && a.type === "noul" ? a.noul : null;
}

/** What `judge` is asked about one check: the action, the player's words, the scale, the scene, and (when the story decides) each outcome's exact odds. */
export interface JudgeAsk {
  action: string;
  text: string;
  max: number;
  /** Under narrative authority: the outcomes to pick from, with the dice's exact odds as guidance. */
  odds: Record<string, number> | null;
  /** Player-visible only: where the player character is and who is there. */
  scene: JsonValue;
}

/**
 * `judge` (DESIGN §11, §5.2): rates the player's described approach from 0 to `max` with a one-line
 * reason and, when the story decides, gives each outcome's probability. A decision only, in its own
 * call: no prose comes back. On the Decision route the rating is a score question and the outcome a
 * choice, so there is no reason. Null when the call fails or gives no rating.
 */
export async function judge(steps: Steps, run: StepRun, ask: JudgeAsk, userId: UserId, signal: AbortSignal, lore: StepLore | null = null): Promise<Judgement | null> {
  const scale = `0 (no particular approach, or one that works against them) to ${ask.max} (a clever, prepared approach that fits the situation)`;
  const choices = ask.odds ? Object.keys(ask.odds) : [];
  const guidance = ask.odds ? Object.fromEntries(Object.entries(ask.odds).map(([o, p]) => [o, `${Math.round(p * 100)}%`])) : null;
  const lead = run.template?.template ?? "Judge how well the player's described approach suits what their character attempts.";
  const outcomesOf = (raw: unknown): Record<string, number> | undefined => {
    if (!isRecord(raw)) return undefined;
    const out: Record<string, number> = {};
    for (const o of choices) if (typeof raw[o] === "number" && Number.isFinite(raw[o]) && raw[o] >= 0) out[o] = raw[o];
    return Object.keys(out).length > 0 ? out : undefined;
  };
  if (run.config.route?.provider === "decision") {
    const questions: Questions = { rating: { type: "score", instructions: `${lead} Rate it from ${scale}.`, criteria: Array.from({ length: ask.max + 1 }, (_, i) => String(i)) } };
    if (guidance) questions.outcome = { type: "choice", instructions: "How does it turn out? The dice's exact odds are guidance: a strong approach moves them toward success, a weak one away.", criteria: guidance };
    const answer = await steps.decide("judge", { action: ask.action, player: ask.text.slice(0, 2000), scene: ask.scene }, questions, run.config, userId, signal, lore, run.guidance);
    const rating = answer?.answers.rating;
    if (!rating || rating.type !== "score") return null;
    const outcome = answer?.answers.outcome;
    const outcomes = outcome?.type === "choice" ? outcomesOf(outcome.probabilities) : undefined;
    return { rating: Math.min(ask.max, Math.max(0, rating.score)), reason: "", ...(outcomes ? { outcomes } : {}) };
  }
  const system = [
    `${lead} Rate the approach from ${scale}, and give a one-line reason in plain words.`,
    guidance ? `Then decide how it turns out: give each outcome a probability. The dice's exact odds are guidance: lean on them, and move them toward success for a strong approach and away from it for a weak one.` : "",
    `Output JSON only: {"rating": number, "reason": string${guidance ? `, "outcomes": {${choices.map((o) => `"${o}": number`).join(", ")}}` : ""}}.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const user = `Action: ${ask.action}\nThe player wrote: ${ask.text.slice(0, 2000)}\nScene: ${JSON.stringify(ask.scene)}${guidance ? `\nOutcomes with the dice's exact odds: ${JSON.stringify(guidance)}` : ""}`;
  const raw = await steps.helperJson("judge", system, user, run.config, userId, signal, { lore, guidance: run.guidance });
  // A reply without a rating is no answer: a made-up middle rating would read as the model's.
  if (!isRecord(raw) || typeof raw.rating !== "number" || !Number.isFinite(raw.rating)) return null;
  const reason = typeof raw.reason === "string" ? raw.reason.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  const outcomes = outcomesOf(raw.outcomes);
  return { rating: Math.min(ask.max, Math.max(0, Math.round(raw.rating))), reason, ...(outcomes ? { outcomes } : {}) };
}
