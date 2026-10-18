// The adjudication policy (DESIGN §11): when an action's check rolls, what the player's described
// approach weighs, who settles the check, and what a retry takes. Pure: a verdict reads the state
// before the action and the turn's recorded judgement, never a model, so the palette, the turn and
// every replay read the same one.
//
//   policy     the chat's `adjudicate` marker, else the world ruleset's, else Crunchy (every check rolls)
//   success    the check's `pass` outcomes, else `success` and every band listed after it; a check
//              that names none has no success to grant, so it rolls whenever its action runs
//   order      a refused retry, then too hard (impossible), then a sure thing (trivial), then the
//              timing (every, risky, marked, never), then the authority (the dice or the story)
//   unrolled   passes with `success` (the action's or the check's), else the check's `auto`, else its
//              most likely passing band; an impossible check fails with `failure`, else its most
//              likely failing band; a refused retry takes the earlier failure's outcome
//   judgement  `judge`'s rating shifts a rolled check; under narrative authority its outcome odds
//              are sampled with the turn's seed, and without them (or for an NPC) the dice decide

import { defaultAdjudication, readAdjudication } from "../shared/adjudication";
import { hashJson, hashParts } from "../shared/hash";
import type { EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LintIssue } from "../shared/protocol";
import type { PaletteOption } from "../shared/state-view";
import type { ActionDef, AdjudicationDef, CheckAuthority, CheckDef, RetryRule, WorldDoc } from "../shared/world";
import { bandOutcome, checkBands, NO_BAND, type CheckReading, type CheckShift, type ReadyCheck } from "./checks";
import { readEngineSlice, type TryRecord } from "./engine-pack";
import type { Value } from "./expr";
import { optionalQuery, own } from "./pack-kit";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import type { Availability } from "./resolve";
import type { Rng } from "./rng";
import { placeOfEntity } from "./scope";
import { placeVisit } from "./seen";
import type { WorldState } from "./state";
import { playerTrack } from "./visibility";

/** How far up the place tree a marked place counts. */
const PARENT_DEPTH = 32;

/** The `judge` step's answer for a turn (DESIGN §5.2), recorded with the turn's intent. */
export interface Judgement {
  /** The player's described approach, rated from 0 to the policy's `description.max`. */
  rating: number;
  /** One line on why. */
  reason: string;
  /** Under narrative authority: the judge's probability of each outcome. */
  outcomes?: Record<string, number>;
}

/** Why a check wasn't rolled. */
export type NoRoll = "trivial" | "impossible" | "safe" | "unmarked" | "never" | "story" | "retry";

/** What the policy makes of a check before anything is rolled or judged. */
export interface Verdict {
  roll: boolean;
  /** Why the dice don't roll; null when they do. */
  why: NoRoll | null;
  /** The outcome without a roll; null when it rolls, or the story decides it. */
  outcome: string | null;
  /** The check's exact success chance before any approach; null when it names no success. */
  chance: number | null;
  /** The outcomes that count as a success. */
  pass: string[];
  /** The earlier failure a refused retry takes. */
  prior: TryRecord | null;
}

/** How the policy decided a resolved check, for the narrator and the chips. Absent under a plain-rolling policy. */
export interface Adjudged {
  rolled: boolean;
  why: NoRoll | null;
  chance: number | null;
  pass: string[];
  authority: CheckAuthority;
  retry: RetryRule;
  /** The judge's rating of the described approach, when the policy read it. */
  approach: { rating: number; max: number; reason: string } | null;
  /** Hybrid: the outcome the same roll a few points off would have read, and by how many points (negative: lower). */
  close: { outcome: string; points: number } | null;
}

/** The policy in force: the chat's own (an `adjudicate` marker, starting ones included), else the world ruleset's, else Crunchy. */
export function policyOf(world: WorldDoc, state: Readonly<WorldState>): AdjudicationDef {
  return state.adjudication ?? readAdjudication(world.ruleset?.adjudication) ?? defaultAdjudication();
}

/**
 * The policy a check of this action answers to (DESIGN §11). A combat action rolls plainly unless
 * the world's combat hands fights to the policy and the POV takes it: everyone else's attacks always
 * roll, as the `check` effect's NPC checks do, since no player chose them and no judge reads them.
 */
export function policyFor(world: WorldDoc, state: Readonly<WorldState>, action: Pick<ActionDef, "combat">, actor: EntityId): AdjudicationDef {
  return action.combat !== undefined && (actor !== world.pov || world.ruleset?.combat?.adjudicate !== "policy") ? defaultAdjudication() : policyOf(world, state);
}

/** The fight under way and its round, as the retry record keeps them; null without one. */
export function fightRound(ctx: ReadContext): string | null {
  return optionalQuery(ctx, "combat.round_key")?.(ctx) ?? null;
}

/** The outcomes that count as a success: the check's `pass`, else `success` and every band listed after it; empty when it names none. */
export function passOutcomes(check: CheckDef, bands: ReadyCheck["bands"]): string[] {
  if (Array.isArray(check.pass) && check.pass.length > 0) return [...new Set(check.pass.filter((o): o is string => typeof o === "string"))];
  const at = bands.findIndex((b) => b.outcome === "success");
  return at < 0 ? [] : [...new Set(bands.slice(at).map((b) => b.outcome))];
}

/** The key a retry rule knows an attempt by: the same actor taking the same action with the same parameters. */
export function tryKey(actor: EntityId, action: string, params: Readonly<Record<string, Value>>): string {
  return `t${hashParts("lre.try", actor, action, hashJson(params))}`;
}

/** The check as it rolls (dice, modifier, DC), kept with an attempt: a retry with other odds is a change. */
export function oddsSignature(ready: ReadyCheck): string {
  return `${ready.notation}|${ready.modifier}|${ready.dc ?? ""}`;
}

/** The highest-odds outcome among `among`, the first on a tie; `none` is never picked. */
function mostLikely(odds: Readonly<Record<string, number>>, among: readonly string[]): string | null {
  let best: string | null = null;
  for (const o of among) if (o !== NO_BAND && (best === null || (odds[o] ?? 0) > (odds[best] ?? 0))) best = o;
  return best;
}

/** The outcome a check passes with when it isn't rolled: `success` (the action's or the check's), else the check's `auto`, else its most likely passing band. */
export function passOutcome(action: ActionDef, ready: ReadyCheck, odds: Readonly<Record<string, number>>, pass: readonly string[]): string {
  if (own(action.outcomes, "success") || ready.bands.some((b) => b.outcome === "success")) return "success";
  if (typeof ready.check.auto === "string" && ready.check.auto !== "") return ready.check.auto;
  return mostLikely(odds, pass) ?? NO_BAND;
}

/** The outcome a check too hard to try fails with: `failure` (the action's or the check's), else its most likely failing band. */
function failOutcome(action: ActionDef, ready: ReadyCheck, odds: Readonly<Record<string, number>>, pass: readonly string[]): string {
  if (own(action.outcomes, "failure") || ready.bands.some((b) => b.outcome === "failure")) return "failure";
  return mostLikely(odds, Object.keys(odds).filter((o) => !pass.includes(o))) ?? NO_BAND;
}

/**
 * Whether the `marked` timing asks for a roll: the action is marked, the actor is at a marked place
 * or inside one, or a marked track the POV can see is in progress (past a dormant start and not at
 * its end). A track the POV can't see (`playerTrack`: a secret one with nothing shown yet, or one it
 * doesn't know of) never counts, so whether the dice roll never gives it away.
 */
export function markedFor(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, actor: EntityId): boolean {
  if (action.adjudicate === true) return true;
  let place = placeOfEntity(state, actor);
  for (let depth = 0; place !== null && depth < PARENT_DEPTH; depth++) {
    const def = own(world.places, place);
    if (!def) break;
    if (def.adjudicate === true) return true;
    place = def.parent ?? null;
  }
  for (const [id, t] of Object.entries(world.tracks)) {
    if (t.adjudicate !== true) continue;
    const stageId = own(state.tracks, id)?.stage ?? t.start;
    const stage = own(t.stages, stageId);
    if (!stage) continue;
    const ended = stage.next.length === 0 && !stage.fail;
    const dormant = stageId === t.start && (stage.objectives ?? []).length === 0 && stage.answer === undefined && stage.cue === undefined;
    if (!ended && !dormant && playerTrack(registry, world, state, world.pov, id) !== null) return true;
  }
  return false;
}

/**
 * Whether something relevant changed since a failed attempt: the scene (the actor is elsewhere, or
 * the POV left and came back), and under `changed` also the time passed, a new round of the fight
 * the attempt was made in (a fight takes no clock time), or the check's odds.
 */
function changedSince(policy: AdjudicationDef, registry: Registry, world: WorldDoc, state: Readonly<WorldState>, actor: EntityId, ready: ReadyCheck, prior: TryRecord): boolean {
  const here = placeOfEntity(state, actor);
  if (here !== prior.place) return true;
  // The POV's observations know when it last arrived; nobody else's movements are kept.
  if (actor === world.pov && here !== null && (placeVisit(state, here)?.last ?? 0) > prior.at) return true;
  if (policy.retry === "once") return false;
  if (prior.round !== undefined && fightRound(registry.context(world, state)) !== prior.round) return true;
  return state.clock - prior.at >= policy.retryAfter || oddsSignature(ready) !== prior.odds;
}

export interface VerdictInput {
  /** What tells whether the POV can see a marked track. */
  registry: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  action: ActionDef;
  actor: EntityId;
  /** The action's parameters as resolved (the retry key). */
  params: Readonly<Record<string, Value>>;
  /** The check as it would roll, before any approach. */
  ready: ReadyCheck;
  odds: Readonly<Record<string, number>>;
}

/** What the policy makes of a check before anything is rolled or judged (the palette shows it as is). */
export function verdictOf(policy: AdjudicationDef, input: VerdictInput): Verdict {
  const { registry, world, state, action, actor, ready, odds } = input;
  const pass = passOutcomes(ready.check, ready.bands);
  const chance = pass.length > 0 ? pass.reduce((sum, o) => sum + (odds[o] ?? 0), 0) : null;
  const unrolled = (why: NoRoll, outcome: string | null, prior: TryRecord | null = null): Verdict => ({ roll: false, why, outcome, chance, pass, prior });
  if (policy.retry !== "free" && pass.length > 0) {
    const prior = own(readEngineSlice(state).tries, tryKey(actor, action.id, input.params));
    if (prior?.failed && !changedSince(policy, registry, world, state, actor, ready, prior)) return unrolled("retry", prior.outcome, prior);
  }
  if (chance !== null && policy.impossibleAt !== null && chance <= policy.impossibleAt) return unrolled("impossible", failOutcome(action, ready, odds, pass));
  if (chance !== null && policy.trivialAt !== null && chance >= policy.trivialAt) return unrolled("trivial", passOutcome(action, ready, odds, pass));
  const asked = pass.length === 0 || policy.checks === "every" || (policy.checks === "risky" && (chance === null || chance < policy.riskyAt)) || (policy.checks === "marked" && markedFor(registry, world, state, action, actor));
  if (!asked) return unrolled(policy.checks === "never" ? "never" : policy.checks === "risky" ? "safe" : "unmarked", passOutcome(action, ready, odds, pass));
  if (policy.authority === "narrative") return unrolled("story", null);
  return { roll: true, why: null, outcome: null, chance, pass, prior: null };
}

/** Whether the policy needs the `judge` step: a rolled check the approach may shift, or one the story decides. */
export function needsJudge(policy: AdjudicationDef, verdict: Verdict): boolean {
  return (verdict.roll && policy.description.weight !== "none") || verdict.why === "story";
}

/** The rating the policy reads from a judgement: a whole number from 0 to its `description.max`. */
export function ratingOf(policy: AdjudicationDef, judgement: Judgement): number {
  return Math.min(policy.description.max, Math.max(0, Math.round(judgement.rating)));
}

/** What a judged approach does to a rolled check: a bonus up to `max`, advantage from `advantageAt`, or a DC lower by up to `max`. */
export function approachShift(policy: AdjudicationDef, judgement: Judgement | null): CheckShift | null {
  if (!judgement || policy.description.weight === "none") return null;
  const rating = ratingOf(policy, judgement);
  if (rating === 0) return null;
  switch (policy.description.weight) {
    case "bonus":
      return { modifier: rating };
    case "advantage":
      return rating >= policy.description.advantageAt ? { advantage: 1 } : null;
    case "dc":
      return { dc: rating };
  }
}

/**
 * Under hybrid authority: the outcome the same roll would have read `by` points or fewer either way
 * (the natural die unchanged), nearest first and lower first on a tie; null when none differs.
 */
export function closeCall(ready: ReadyCheck, reading: CheckReading, outcome: string, by: number): { outcome: string; points: number } | null {
  for (let d = 1; d <= by; d++) {
    for (const points of [-d, d]) {
      const other = bandOutcome(ready.bands, { natural: reading.natural, total: reading.total + points, margin: reading.margin === null ? null : reading.margin + points }) ?? NO_BAND;
      if (other !== outcome && other !== NO_BAND) return { outcome: other, points };
    }
  }
  return null;
}

/** The outcomes the story may pick from: the check's band outcomes (as its odds list them), then the action's own, `default` and `none` aside. */
export function outcomeChoices(action: ActionDef, bandOutcomes: readonly string[]): string[] {
  return [...new Set([...bandOutcomes, ...Object.keys(action.outcomes)])].filter((o) => o !== "default" && o !== NO_BAND);
}

/** Under narrative authority: the judge's outcome, sampled from its odds over the choices; null without a usable answer. */
export function judgedOutcome(judgement: Judgement | null, choices: readonly string[], rng: Rng): string | null {
  const odds = judgement?.outcomes;
  if (!odds) return null;
  const items = choices.map((value) => ({ value, weight: Math.max(0, Number(own(odds, value)) || 0) })).filter((i) => i.weight > 0);
  return items.length > 0 ? rng.weighted(items) : null;
}

/**
 * Lint for the ruleset's policy (DESIGN §13): a preset that isn't one, values a custom policy can't
 * hold (each reads as the value it plays with), thresholds that leave no room to roll, `marked`
 * with nothing marked, and checks whose success the policy can't tell.
 */
export function lintAdjudication(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const raw: unknown = isRecord(world.ruleset) ? world.ruleset.adjudication : undefined;
  if (raw === undefined) return issues;
  const at = "ruleset.adjudication";
  if (!isRecord(raw)) return [{ severity: "error", path: at, code: "adjudication", message: "How checks are decided must be an object with a preset." }];
  const policy = readAdjudication(raw);
  if (!policy) return [{ severity: "error", path: `${at}.preset`, code: "adjudication", message: `"${String(raw.preset)}" isn't a preset: use narrative, balanced, crunchy or custom.` }];
  if (policy.preset === "custom") {
    const description = isRecord(raw.description) ? raw.description : {};
    const read: [string, unknown, unknown][] = [
      ...(["checks", "riskyAt", "trivialAt", "impossibleAt", "authority", "closeBy", "retry", "retryAfter"] as const).map((k): [string, unknown, unknown] => [k, raw[k], policy[k]]),
      ...(["weight", "max", "advantageAt"] as const).map((k): [string, unknown, unknown] => [`description.${k}`, description[k], policy.description[k]]),
    ];
    for (const [key, given, plays] of read) {
      if (given !== undefined && given !== plays) issues.push({ severity: "warning", path: `${at}.${key}`, code: "adjudication_value", message: `${key} can't be ${JSON.stringify(given)}; it plays as ${JSON.stringify(plays)}.` });
    }
  }
  if (policy.trivialAt !== null && policy.impossibleAt !== null && policy.trivialAt <= policy.impossibleAt) {
    issues.push({ severity: "error", path: `${at}.trivialAt`, code: "adjudication", message: "A sure thing must start above too hard to try, or no check would ever roll." });
  }
  if (policy.checks === "risky" && policy.riskyAt <= 0) issues.push({ severity: "warning", path: `${at}.riskyAt`, code: "adjudication", message: "No check's chance is below 0, so no check ever rolls." });
  const marks = Object.values(world.actions).some((a) => a.adjudicate === true) || Object.values(world.places).some((p) => p.adjudicate === true) || Object.values(world.tracks).some((t) => t.adjudicate === true);
  if (policy.checks === "marked" && !marks) issues.push({ severity: "warning", path: `${at}.checks`, code: "adjudication_unmarked", message: "Checks roll only for marked actions, places and tracks, and nothing is marked: no check will ever roll." });
  // Every timing but `every`, a threshold and a retry rule read a check's success (a retry must tell a failure).
  const readsChance = policy.checks !== "every" || policy.trivialAt !== null || policy.impossibleAt !== null || policy.retry !== "free";
  // Each check the world defines (by id or inline in an action), read with the bands it rolls with. The
  // combat rules' initiative rolls when a fight starts, never through the policy, unless an action takes it too.
  const combat: unknown = isRecord(world.ruleset) ? world.ruleset.combat : undefined;
  const initiative = isRecord(combat) && typeof combat.initiative === "string" ? combat.initiative : null;
  const policyChecks = Object.entries(world.checks).filter(([id]) => id !== initiative || Object.values(world.actions).some((a) => a.check === id));
  const checks: [string, CheckDef][] = [...policyChecks.map(([id, c]): [string, CheckDef] => [`checks.${id}`, c]), ...Object.entries(world.actions).flatMap(([id, a]): [string, CheckDef][] => (typeof a.check === "object" && a.check !== null ? [[`actions.${id}.check`, a.check]] : []))];
  for (const [path, check] of checks) {
    const bands = checkBands(check, check.dc !== undefined || check.vs !== undefined ? 0 : null);
    const known = new Set(bands.map((b) => b.outcome));
    for (const o of check.pass ?? []) if (!known.has(o)) issues.push({ severity: "warning", path: `${path}.pass`, code: "adjudication_outcome", message: `"${o}" counts as a success, but no band of this check reads it.` });
    if (typeof check.auto === "string" && check.auto !== "" && !known.has(check.auto)) issues.push({ severity: "warning", path: `${path}.auto`, code: "adjudication_outcome", message: `An unrolled check passes as "${check.auto}", which no band of this check reads.` });
    if (readsChance && passOutcomes(check, bands).length === 0) issues.push({ severity: "info", path, code: "adjudication_success", message: "This check names no success (no success band and no pass list), so the policy can't tell its chance or grant it without a roll: it rolls whenever its action runs (under narrative authority the story decides, and the dice when it can't), and a failed try isn't remembered." });
  }
  return issues;
}

/**
 * How an option's check reads in the palette and the Encounter card (DESIGN §11): what the
 * adjudication policy makes of it when nothing rolls ("No roll needed", "Too hard to try", "Retry
 * needs a change"), else advantage or disadvantage and the DC when it isn't an opposed roll (the
 * option already names the opponent). The odds bar shows only for a check the dice roll or the story
 * decides, where it is the guidance.
 */
export function checkView(a: Availability, retry: RetryRule): Pick<PaletteOption, "detail" | "odds"> {
  const c = a.check;
  const v = a.verdict;
  const rolls = !v || v.roll;
  const verdict = !v || v.roll ? null : v.why === "impossible" ? "Too hard to try" : v.why === "story" ? (v.chance === null ? "The story decides" : `The story decides (odds ${Math.round(v.chance * 100)}%)`) : v.why === "retry" ? (retry === "once" ? "Retry needs a new scene" : "Retry needs a change") : "No roll needed";
  const parts = [verdict ?? "", c && rolls ? (c.advantage > 0 ? "with advantage" : c.advantage < 0 ? "with disadvantage" : "") : "", c && rolls && c.dc !== null && c.opponent === null ? `DC ${c.dc}` : ""].filter((p) => p !== "");
  return { ...(parts.length > 0 ? { detail: parts.join(" · ") } : {}), ...(a.odds && (rolls || v?.why === "story") ? { odds: Object.entries(a.odds).map(([outcome, p]) => ({ outcome, p })) } : {}) };
}
