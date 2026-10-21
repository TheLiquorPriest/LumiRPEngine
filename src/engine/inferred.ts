// Inferred checks (DESIGN §11): a typed attempt no catalog action with its own check covers, read by
// `interpret` as the built-in Try something, and rolled with the world's own sheet through the one
// check mechanism. Pure: the policy, the world's skills, the read's checks and the roll read only the
// world, the state and the turn's seed, so the plan, a Re-run and every replay read the same.
//
//   policy     the chat's `infer` marker, else the world ruleset's default, else its realism preset's
//              at its Sheets level (`inferredDefaults`)
//   skills     the rows of each table a skill action names (Use a skill, Make a save: a check, a text
//              param from a table and a difficulty), rolled by that action's check; and, on the Sheets
//              pack's own sheet, its stats, rolled by Attempt's. Try something stands in for those
//              actions in `interpret`'s catalog, so a typed attempt is never read as both
//   the read   a skill the sheet has and the policy allows, a band within its bounds, companions and
//              opponents the POV may know; under `tries` the read must say the input tries, under
//              `risky` it must be risky against how hard it looks (the band, never anyone's numbers)
//   the roll   opponents set the difficulty first, rolling against it when everyone involved rolls
//              (and the turn's rolls allow), else by their passive score; then the POV's check plays
//              as an action (the adjudication policy, the judge's rating, retries); then each
//              companion rolls their own, plainly, as any NPC's check does. Their rolls are recorded
//              as `engine.check` events no player view shows

import type { EntityId } from "../shared/ids";
import { clampBand, DIFFICULTY_BANDS, INFER_DETAILS, INFER_OTHERS, INFER_WHENS, INFER_WHOS, INFERRED_BOUNDS, INFERRED_PRESETS, inferredDefaults, readInferred, type DifficultyBand, type InferDetail, type InferOthers, type InferredChecks, type InferredGuidance, type SheetSkill } from "../shared/inferred";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { tableChoices } from "../shared/tables";
import type { LintIssue } from "../shared/protocol";
import type { ActionDef, WorldDoc } from "../shared/world";
import { offersAction } from "../shared/world";
import { passOutcomes, policyOf } from "./adjudication";
import { checkOf, readyCheck, rollCheck, type ReadyCheck } from "./checks";
import { diceDistribution } from "./dice";
import { ENGINE_EVENTS } from "./engine-pack";
import { acts } from "./life";
import { materializeAll } from "./materialize";
import { optionalQuery, own } from "./pack-kit";
import { povMayKnow } from "./player-events";
import { presetOf } from "./realism";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { rulesetFloor } from "./registry-impl";
import { actionOdds, resolveAction, type ActionRequest, type ResolveOptions, type Resolution } from "./resolve";
import type { Rng } from "./rng";
import { evalExpr, isGone, kindIs, placeOfEntity, scopeEnv, truthy } from "./scope";
import type { WorldState } from "./state";
import { canSeeEntity } from "./visibility";
import { initialState } from "./world-state";
import type { Working } from "./working";

/** The built-in action an inferred check plays as (DESIGN §11): Try something, carrying the check. */
export const TRY_ACTION = "try";

/** The policy in force: the chat's own (an `infer` marker, starting ones included), else the world ruleset's default, else its realism preset's at its Sheets level (the world's floor included). */
export function inferredOf(world: Pick<WorldDoc, "ruleset" | "mapSettings">, state: Pick<WorldState, "inferred" | "realism">): InferredChecks {
  return state.inferred ?? readInferred(world.ruleset?.inferred) ?? inferredDefaults(presetOf(state.realism), rulesetFloor(world, "sheets", state.realism.levels.sheets));
}

/** A skill the world's sheet has, and what rolls it: the action whose check reads it through `param`. */
export interface SkillSource extends SheetSkill {
  action: ActionDef;
  param: string;
}

/** The text param an action names a skill through, with the skills it may name; null when it has none. */
function skillParam(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef): { param: string; rows: SheetSkill[] } | null {
  const params = Object.entries(action.params).filter(([name]) => name !== "difficulty");
  const [entry] = params;
  // One skill param and a difficulty: anything else it needs (a target, an item) isn't a plain roll.
  if (!entry || params.length !== 1 || action.params.difficulty?.type !== "text") return null;
  const [param, def] = entry;
  if (def.type !== "text") return null;
  if (def.table !== undefined) return { param, rows: tableChoices(own(world.tables, def.table)).map((c) => ({ id: c.key, label: c.label })) };
  // The Sheets pack's own sheet rolls its stats through Attempt; a world that designs a sheet shows
  // that one instead (Play → You), so the pack's stats aren't its sheet's.
  if (action.pack === "sheets" && action.id === "attempt" && param === "stat" && world.ruleset?.sheet === undefined) {
    const ctx = reg.context(world, state);
    return { param, rows: optionalQuery(ctx, "sheets.stats")?.(ctx) ?? [] };
  }
  return null;
}

/**
 * The skills the world's sheet has, in sheet order, each with what rolls it: an offered action with
 * a check, a skill param and a difficulty, whose requirements the POV meets now (a world's own
 * actions before the packs'). One without requirements rolls a skill before one with them (Use a
 * skill before Push a skill), and a skill two actions name is the first's. Ungated, every such
 * action counts whatever its requirements: a skill rolled once a requirement is met is still the sheet's.
 */
export function skillSources(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, gated = true): SkillSource[] {
  const env = scopeEnv({ reg, ctx: reg.context(world, state), bindings: { self: world.pov, actor: world.pov } });
  const actions = [...Object.values(world.actions), ...[...reg.actions.values()].filter((a) => !own(world.actions, a.id))];
  const ready = actions.filter((a) => offersAction(world, a) && a.combat === undefined && checkOf(world, a.check) !== null && (!gated || a.requires.every((r) => truthy(evalExpr(r, env, false)))));
  const ordered = [...ready.filter((a) => a.requires.length === 0), ...ready.filter((a) => a.requires.length > 0)];
  const out: SkillSource[] = [];
  const seen = new Set<string>();
  for (const action of ordered) {
    const named = skillParam(reg, world, state, action);
    for (const row of named?.rows ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ ...row, action, param: named?.param ?? "" });
    }
  }
  return out;
}

/** The skills the world's sheet has, as the Checks screens list them. */
export function worldSkills(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): SheetSkill[] {
  return skillSources(reg, world, state).map(({ id, label }) => ({ id, label }));
}

const GUIDANCE_PLACEHOLDERS = new Set(["who", "skill", "attempt", "against"]);

/**
 * Lint for the world's inferred-checks default (DESIGN §13): one the engine can't read (no mode, or
 * none it knows) plays as unset, so each chat's realism preset decides; a value it can't hold plays
 * as the value read for it; a listed skill the world's sheet doesn't have never rolls; difficulty
 * bounds the wrong way round play swapped; and a guidance line is cut to its length, a placeholder
 * it doesn't know reaching the narrator as written.
 */
export function lintInferred(world: WorldDoc, reg: Registry): LintIssue[] {
  const raw: unknown = isRecord(world.ruleset) ? world.ruleset.inferred : undefined;
  if (raw === undefined) return [];
  const at = "ruleset.inferred";
  const unset = "Until it does, inferred checks play as unset, by each chat's realism preset.";
  if (!isRecord(raw)) return [{ severity: "error", path: at, code: "inferred", message: `Inferred checks must be an object with a mode. ${unset}` }];
  const policy = readInferred(raw);
  if (!policy) return [{ severity: "error", path: `${at}.mode`, code: "inferred", message: `${raw.mode === undefined ? "It names no mode" : `"${String(raw.mode)}" isn't a mode`}: use off, suggest or auto. ${unset}` }];
  const issues: LintIssue[] = [];
  const warn = (path: string, code: string, message: string): void => void issues.push({ severity: "warning", path: `${at}${path}`, code, message });
  const plays = (key: string, given: unknown, value: unknown): void => warn(`.${key}`, "inferred_value", `${key} can't be ${JSON.stringify(given)}; it plays as ${JSON.stringify(value)}.`);
  const choices: [string, unknown, readonly string[], string][] = [["when", raw.when, INFER_WHENS, policy.when], ["who", raw.who, INFER_WHOS, policy.who], ["detail", raw.detail, INFER_DETAILS, policy.detail], ["others", raw.others, INFER_OTHERS, policy.others]];
  for (const [key, given, values, value] of choices) if (given !== undefined && !values.includes(String(given))) plays(key, given, value);
  const [lo, hi] = INFERRED_BOUNDS.most;
  if (raw.most !== undefined && raw.most !== policy.most) warn(".most", "inferred_value", `Rolls a turn are a whole number from ${lo} to ${hi}: ${JSON.stringify(raw.most)} plays as ${policy.most}.`);
  // Bands: each bound read alone first (an unknown one takes Grounded's), then the pair, which plays swapped.
  const ids = DIFFICULTY_BANDS.map((b) => b.id);
  const d = isRecord(raw.difficulty) ? raw.difficulty : {};
  if (raw.difficulty !== undefined && !isRecord(raw.difficulty)) plays("difficulty", raw.difficulty, policy.difficulty);
  const bound = (key: "lowest" | "highest"): number => {
    const given = d[key];
    const index = ids.findIndex((id) => id === given);
    if (given !== undefined && index < 0) plays(`difficulty.${key}`, given, INFERRED_PRESETS.grounded.difficulty[key]);
    return index < 0 ? ids.indexOf(INFERRED_PRESETS.grounded.difficulty[key]) : index;
  };
  const lowest = bound("lowest");
  const highest = bound("highest");
  if (lowest > highest) warn(".difficulty", "inferred_difficulty", `The easiest band, ${DIFFICULTY_BANDS[lowest]?.label}, is above the hardest, ${DIFFICULTY_BANDS[highest]?.label}: they play swapped, from ${DIFFICULTY_BANDS[highest]?.label} to ${DIFFICULTY_BANDS[lowest]?.label}.`);
  // Skills: a list that isn't one plays as Grounded's; an entry that isn't an id is left out; and one
  // the sheet lacks (read with every skill action, whatever its requirements) is never rolled.
  if (raw.skills !== undefined && raw.skills !== null && !Array.isArray(raw.skills)) plays("skills", raw.skills, policy.skills);
  if (Array.isArray(raw.skills)) {
    for (const s of raw.skills) if (typeof s !== "string" || s.trim() === "" || s.trim().length > INFERRED_BOUNDS.skillId) warn(".skills", "inferred_value", `${JSON.stringify(s)} isn't a skill's id, so it's left out.`);
    const sheet = new Set(skillSources(reg, world, initialState(world, "lint", reg), false).map((s) => s.id));
    for (const id of policy.skills ?? []) if (!sheet.has(id)) warn(".skills", "inferred_skill", `"${id}" isn't a skill the world's sheet has, so no attempt rolls it.`);
  }
  // Guidance: what the narrator is told after a result, filled by `inferredOutcome`'s placeholders.
  if (raw.guidance !== undefined && !isRecord(raw.guidance)) plays("guidance", raw.guidance, policy.guidance);
  const guidance = isRecord(raw.guidance) ? raw.guidance : {};
  for (const key of ["pass", "fail"] as const) {
    const given = guidance[key];
    if (given === undefined) continue;
    if (typeof given !== "string") {
      plays(`guidance.${key}`, given, policy.guidance[key]);
      continue;
    }
    const text = given.replace(/\s+/g, " ").trim();
    if (text.length > INFERRED_BOUNDS.guidance) warn(`.guidance.${key}`, "inferred_value", `A guidance line holds at most ${INFERRED_BOUNDS.guidance} characters; this one's ${text.length} are cut there.`);
    for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) if (!GUIDANCE_PLACEHOLDERS.has(name ?? "")) warn(`.guidance.${key}`, "inferred_guidance", `{${name}} isn't a placeholder ({who}, {skill}, {attempt} or {against}), so the narrator is told it as written.`);
  }
  return issues;
}

/** Whether Try something stands in for this action in `interpret`'s catalog: one the world's skills roll through, or the Sheets pack's Attempt, whose stats a designed sheet replaces. */
export function rolledByTry(action: Pick<ActionDef, "id" | "pack">, sources: readonly SkillSource[]): boolean {
  return (action.pack === "sheets" && action.id === "attempt") || sources.some((s) => s.action.id === action.id);
}

/** The skills a policy lets a check be inferred for: every one the sheet has, or those its list names. */
export function allowedSkills<T extends SheetSkill>(policy: Pick<InferredChecks, "skills">, skills: readonly T[]): T[] {
  return policy.skills === null ? [...skills] : skills.filter((s) => policy.skills?.includes(s.id) === true);
}

/** The skill a read names: by id, else by label in any case. */
function skillNamed(sources: readonly SkillSource[], said: string): SkillSource | undefined {
  const t = said.trim().toLowerCase();
  return sources.find((s) => s.id === said.trim()) ?? sources.find((s) => s.id.toLowerCase() === t || s.label.toLowerCase() === t);
}

/** Try something's read, as the engine plays it: a model's JSON, made sure of its shapes. */
export interface TryRead {
  /** What is attempted, in the input's words; empty when the read gave none, or one too long for a line. */
  attempt: string;
  skill: string;
  /** The band the read named, as given: it is clamped into the policy's when read. */
  difficulty: string;
  /** Companions the input has join in, by id. */
  with: EntityId[];
  /** The people it opposes or targets, each with the skill they resist with ("" for the attempt's own). */
  against: { who: EntityId; skill: string }[];
  /** Whether the read says the input itself has the player character try it. */
  tried: boolean;
}

/** The longest attempt a line repeats; a longer one is dropped, never cut. */
const ATTEMPT_CHARS = 160;
/** The most companions, and the most opponents, a read names. */
const PEOPLE = 8;

/** A read's ids: a list, or one string of ids between commas. */
function idsOf(v: JsonValue | undefined): string[] {
  const items: JsonValue[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return items.flatMap((x) => (typeof x === "string" && x.trim() !== "" ? [x.trim()] : []));
}

export function tryRead(params: JsonObject): TryRead {
  const attempt = typeof params.attempt === "string" ? params.attempt.replace(/\s+/g, " ").trim() : "";
  const rawAgainst: JsonValue[] = Array.isArray(params.against) ? params.against : idsOf(params.against);
  const against: TryRead["against"] = [];
  for (const x of rawAgainst) {
    // An opponent as {"who", "skill"}, or as "id" or "id:skill".
    const [who = "", skill = ""] = typeof x === "string" ? x.split(":").map((s) => s.trim()) : isRecord(x) && typeof x.who === "string" ? [x.who.trim(), typeof x.skill === "string" ? x.skill.trim() : ""] : [];
    if (who !== "" && !against.some((a) => a.who === who) && against.length < PEOPLE) against.push({ who, skill });
  }
  return {
    attempt: attempt.length <= ATTEMPT_CHARS ? attempt : "",
    skill: typeof params.skill === "string" ? params.skill.trim() : "",
    difficulty: typeof params.difficulty === "string" || typeof params.difficulty === "number" ? String(params.difficulty) : "",
    with: [...new Set(idsOf(params.with))].slice(0, PEOPLE),
    against,
    tried: params.tried === true || params.tried === "true" || params.tried === "yes",
  };
}

/**
 * The difficulty a check reads when it reads its roller's own modifier: `difficulty_of`'s moderate.
 * A check that folds the difficulty into its modifier (the Sheets pack's `− difficulty + 10`)
 * nets it out there, and one with a DC of its own doesn't read it in its modifier at all.
 */
const NEUTRAL_DC = 10;

/** `who`'s check for a skill against a difficulty, fixed from the state: the skill's own check, its param naming the skill. */
function readyFor(reg: Registry, w: Pick<Working, "world" | "ctx">, skill: SkillSource, who: EntityId, dc: number): ReadyCheck | Rejection {
  const check = checkOf(w.world, skill.action.check);
  if (!check) return { code: "unknown_check", reason: `no check rolls ${skill.label}` };
  return readyCheck(reg, w.ctx, check, { self: who, actor: who }, { [skill.param]: skill.id, difficulty: dc, params: { [skill.param]: skill.id, difficulty: dc } });
}

/** A score that sets a difficulty without a roll: the dice's average, rounded down (10 on a d20), plus the modifier. */
function passiveScore(ready: ReadyCheck): number {
  const dist = diceDistribution(ready.notation);
  return Math.floor(dist.probs.reduce((sum, p, i) => sum + p * (dist.min + i), 0)) + ready.modifier;
}

/** An action request whose action is a definition: an inferred check's Try something. */
export type TryRequest = Omit<ActionRequest, "action"> & { action: ActionDef };

/**
 * The POV's check as an action request: Try something carrying the skill's own check, read against
 * `dc`. The skill, the band and the opponents are its params, the key a retry rule knows an attempt
 * by (another skill or target is another attempt, as for any action); the difficulty it is read
 * against travels apart, since an opponent's roll is new each time.
 */
function tryRequest(world: WorldDoc, skill: SkillSource, band: DifficultyBand, against: readonly { who: EntityId }[], dc: number): TryRequest {
  const check = checkOf(world, skill.action.check);
  const key = against.map((a) => a.who).sort().join(",");
  return {
    action: {
      id: TRY_ACTION,
      label: `${skill.label} check`,
      params: { [skill.param]: skill.action.params[skill.param] ?? { type: "text" }, difficulty: { type: "text", optional: true }, against: { type: "text", optional: true } },
      requires: [],
      ...(check ? { check } : {}),
      outcomes: {},
      duration: skill.action.duration,
      observable: "makes an attempt",
      ...(skill.action.adjudicate === true ? { adjudicate: true } : {}),
    },
    params: { [skill.param]: skill.id, difficulty: band.id, ...(key !== "" ? { against: key } : {}) },
    vars: { difficulty: dc, params: { difficulty: dc } },
  };
}

/** Someone a read may involve: another person the POV may know, still in the world. */
function involvable(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  return id !== world.pov && hasOwn(state.entities, id) && !isGone(state, id) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && povMayKnow(reg, world, state, id);
}

export type InferredVerdict =
  /** It plays (or, under suggest, is offered): its params as the plan reads them, the skill and band they name, and the policy. */
  | { ok: true; params: JsonObject; read: TryRead; skill: SkillSource; band: DifficultyBand; policy: InferredChecks }
  /** It isn't a check here: the message plays without it, and the log says why. */
  | { ok: false; why: string };

/**
 * Whether a read of Try something is a check the chat infers (DESIGN §11), checked against the state
 * the turn starts from: the policy is on; the skill is the sheet's and the policy allows it; under
 * `tries` the read says the input tries it; under `risky` its chance against how hard it looks (its
 * band) is below the adjudication policy's `riskyAt`. Companions (only when they roll) and opponents
 * keep those the POV may know; whether they are there is the plan's to tell, once earlier actions
 * have moved anyone. An opponent's skill the sheet lacks, or the policy leaves out, is the attempt's own.
 */
export function inferredRead(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, params: JsonObject): InferredVerdict {
  const policy = inferredOf(world, state);
  if (policy.mode === "off") return { ok: false, why: "inferred checks are off in this chat" };
  const read = tryRead(params);
  const sources = allowedSkills(policy, skillSources(reg, world, state));
  const skill = skillNamed(sources, read.skill);
  if (!skill) return { ok: false, why: `"${read.skill}" isn't a skill this chat infers checks for` };
  if (policy.when === "tries" && !read.tried) return { ok: false, why: "the message doesn't say the player character tries it" };
  const band = clampBand(policy, read.difficulty);
  const companions = policy.who === "pov" ? [] : read.with.filter((id) => involvable(reg, world, state, id));
  const against = read.against.filter((a) => !companions.includes(a.who) && involvable(reg, world, state, a.who)).map((a) => ({ who: a.who, skill: skillNamed(sources, a.skill)?.id ?? skill.id }));
  if (policy.when === "risky") {
    const chance = actionOdds(reg, world, state, tryRequest(world, skill, band, against, band.dc)).verdict?.chance ?? null;
    if (chance !== null && chance >= policyOf(world, state).riskyAt) return { ok: false, why: `it isn't risky (${Math.round(chance * 100)}% to succeed at ${band.label.toLowerCase()})` };
  }
  const kept: JsonObject = { attempt: read.attempt, skill: skill.id, difficulty: band.id, with: companions, against: against.map((a) => ({ who: a.who, skill: a.skill })), ...(read.tried ? { tried: true } : {}) };
  return { ok: true, params: kept, read: { ...read, skill: skill.id, with: companions, against }, skill, band, policy };
}

/**
 * What the judge is asked about an inferred check: the POV's check as an action, read against how
 * hard it looks (its band), so no opponent's numbers reach a model whose reason the player reads.
 * Null when the read names no skill the sheet has.
 */
export function tryJudged(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, params: JsonObject): TryRequest | null {
  const read = tryRead(params);
  const policy = inferredOf(world, state);
  const skill = skillNamed(skillSources(reg, world, state), read.skill);
  if (!skill) return null;
  const band = clampBand(policy, read.difficulty);
  const request = tryRequest(world, skill, band, read.against, band.dc);
  return read.attempt === "" ? request : { ...request, action: { ...request.action, label: `${request.action.label}: ${read.attempt}` } };
}

/** A roll someone made beside the POV's, with their own numbers: the dice as rolled, their modifier and total, the difficulty never folded in. */
export interface InferredRoll {
  who: EntityId;
  name: string;
  outcome: string;
  pass: boolean;
  notation: string;
  modifier: number;
  total: number;
}

/** What an inferred check was, for the Outcome line and the receipt (DESIGN §11), beside the POV's own roll on the resolution. */
export interface InferredResult {
  /** "Persuasion check". */
  label: string;
  skill: string;
  attempt: string;
  /** The POV's name. */
  pov: string;
  /** The band the read named, clamped into the policy's: how hard it looked. */
  band: DifficultyBand;
  /** What the rolls were read against: the band's DC, or the highest an opponent set. */
  dc: number;
  /** The people it opposes, each with how they set the difficulty: a roll's total, or a passive score. Hidden from the player and the narrator unless others' numbers are shown. */
  against: { who: EntityId; name: string; rolled: boolean; score: number }[];
  companions: InferredRoll[];
  /** The difficulty's share of the POV's check modifier (the Sheets pack's check folds it in): their own modifier is the check's less it. */
  share: number;
  /** The outcomes that count as a success. */
  pass: string[];
  detail: InferDetail;
  others: InferOthers;
  guidance: InferredGuidance;
}

/**
 * Plays an inferred check (DESIGN §11) into the working state. Present companions and opponents
 * only (where the POV is, seen, acting, as the POV may know them). The turn's rolls go to the POV,
 * then companions in the read's order (one past them doesn't roll, and isn't in the check), then
 * opponents (one past them sets the difficulty with a passive score instead). Opponents first: each
 * sets the difficulty, the highest standing. Then the POV's check plays as an action, so the
 * adjudication policy, the judge's rating and a retry rule apply as to any check. Then each
 * companion rolls their own against the same difficulty, plainly, as any NPC's check does.
 */
export function resolveTry(reg: Registry, w: Working, params: JsonObject, rng: Rng, opts: ResolveOptions = {}): Resolution {
  const { world } = w;
  const pov = world.pov;
  const start = w.events.length;
  const policy = inferredOf(world, w.state);
  const read = tryRead(params);
  const sources = skillSources(reg, world, w.state);
  const skill = skillNamed(sources, read.skill);
  const band = clampBand(policy, read.difficulty);
  const ownCheck = skill ? readyFor(reg, w, skill, pov, band.dc) : null;
  if (!skill || !ownCheck || "code" in ownCheck) {
    const failed = ownCheck && "code" in ownCheck ? ownCheck : { code: "bad_param", reason: `${read.skill || "the attempt"} isn't a skill here` };
    return { action: TRY_ACTION, actor: pov, ok: false, failed, check: null, outcome: null, events: [], rejected: [], duration: 0, activity: null, observable: null, adjudged: null };
  }
  const nameOf = (id: EntityId): string => own(w.state.entities, id)?.name ?? id;
  const here = placeOfEntity(w.state, pov);
  const present = (id: EntityId): boolean => here !== null && placeOfEntity(w.state, id) === here && involvable(reg, world, w.state, id) && acts(world, w.state, id) && canSeeEntity(reg, world, w.state, pov, id);
  let rolls = policy.most - 1;
  const companions: EntityId[] = [];
  for (const id of policy.who === "pov" ? [] : read.with) {
    if (rolls <= 0) break;
    if (!present(id) || companions.includes(id)) continue;
    companions.push(id);
    rolls--;
  }
  const opponents = read.against.filter((a) => present(a.who) && !companions.includes(a.who));
  if (opts.runSeed !== undefined) for (const id of [...companions, ...opponents.map((o) => o.who)]) materializeAll(reg, w, id, opts.runSeed);
  const against: InferredResult["against"] = [];
  for (const o of opponents) {
    const theirs = skillNamed(sources, o.skill) ?? skill;
    const ready = readyFor(reg, w, theirs, o.who, NEUTRAL_DC);
    if ("code" in ready) continue;
    if (policy.who === "everyone" && rolls > 0) {
      rolls--;
      const rolled = rollCheck(ready, rng.fork(`actor:${o.who}`));
      w.apply({ type: ENGINE_EVENTS.check, data: { check: ready.check.id ?? "", skill: theirs.id, actor: o.who, target: pov, notation: ready.notation, natural: rolled.natural, total: rolled.total, dc: null, outcome: "opposed", npc: true } });
      against.push({ who: o.who, name: nameOf(o.who), rolled: true, score: rolled.total });
    } else against.push({ who: o.who, name: nameOf(o.who), rolled: false, score: passiveScore(ready) });
  }
  const dc = against.length > 0 ? Math.max(...against.map((a) => a.score)) : band.dc;
  const res = resolveAction(reg, w, tryRequest(world, skill, band, against, dc), rng, opts);
  const neutral = readyFor(reg, w, skill, pov, NEUTRAL_DC);
  const fixed = readyFor(reg, w, skill, pov, dc);
  const share = "code" in neutral || "code" in fixed ? 0 : fixed.modifier - neutral.modifier;
  const pass = passOutcomes(ownCheck.check, "code" in fixed ? ownCheck.bands : fixed.bands);
  const rolled: InferredRoll[] = [];
  for (const id of res.ok ? companions : []) {
    const ready = readyFor(reg, w, skill, id, dc);
    const base = readyFor(reg, w, skill, id, NEUTRAL_DC);
    if ("code" in ready || "code" in base) continue;
    const roll = rollCheck(ready, rng.fork(`actor:${id}`));
    w.apply({ type: ENGINE_EVENTS.check, data: { check: ready.check.id ?? "", skill: skill.id, actor: id, notation: ready.notation, natural: roll.natural, total: roll.total, dc: ready.dc, outcome: roll.outcome, npc: true } });
    rolled.push({ who: id, name: nameOf(id), outcome: roll.outcome, pass: pass.includes(roll.outcome), notation: ready.notation, modifier: base.modifier, total: roll.roll.total + base.modifier });
  }
  const inferred: InferredResult = { label: `${skill.label} check`, skill: skill.id, attempt: read.attempt, pov: nameOf(pov), band, dc, against, companions: rolled, share, pass, detail: policy.detail, others: policy.others, guidance: policy.guidance };
  return { ...res, events: w.events.slice(start), inferred };
}
