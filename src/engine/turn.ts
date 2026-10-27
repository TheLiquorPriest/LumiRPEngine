// The turn pipeline (DESIGN §5.1 steps 2 and 5): the engine side of `TurnPipeline` (engine/steps).
//
// plan (pre-reply, fold order):
//   pause bookkeeping → the actions in order (DESIGN §11 action queue), each against the state the
//   one before it left: materialization, requirements, check, effects and event rules, with a
//   fight's turns around it (`combat.round`), then its time through `advance` (world processes,
//   schedules, slot rules, tracks; none for an action inside a fight already under way, whose rounds
//   take no clock time, while the action that starts one keeps its time; the scene tick when no
//   action ran), then the tracks, so a stage this action made true is this turn's (DESIGN §10),
//   until the queue stops at a check, a failure or an interruption → a timelapse (explicit, or
//   Speed through `auto`; never in a fight) → off-screen catch-up when time moved.
// post (after extraction): catch-up when time didn't move in plan, turn rules and tracks.
//
// Intents: `interpret`'s answer, or a palette/command intent of the same shape. The built-in
// `timelapse` action takes `params: {target, overrides?, segment?}` (time.ts `TimelapseTarget`).

import type { JsonObject, JsonValue } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { ActionId, EntityId } from "../shared/ids";
import type { LedgerEvent, TimelapseTarget } from "../shared/ledger";
import { activitySpanEnd, formatMoney, type WorldDoc } from "../shared/world";
import type { Judgement } from "./adjudication";
import { actionWords, toldAction, type BeforeAction } from "./action-words";
import { outline } from "./beats";
import { ENGINE_EVENTS, signalOf } from "./engine-pack";
import { materializeAll } from "./materialize";
import type { Registry } from "./registry-impl";
import { findAction, missedPlainRequirement, playsAsRoleplay, resolveAction, unmetNeeds, type Resolution } from "./resolve";
import { IDLE_OPTION } from "./plan-day";
import { resolveTry, TRY_ACTION } from "./inferred";
import { createRng } from "./rng";
import { runRulesOnEvents, runRulesOnTick } from "./rules";
import { acts } from "./life";
import { isGone, placeOfEntity } from "./scope";
import { advance, catchUp, coarsen, interruptPolicy } from "./simulate";
import type { Claim, InterpretOutput, Needs, PostTurnInput, TurnPipeline, TurnPlan, TurnPlanInput } from "./steps";
import { buildMontage, fightHoldsClock, pauseBookkeeping, parseOverrides, parseTarget, replaySkip, runTimelapse, sceneKey, speedThrough, turnElapsed, type Montage, type TimelapseOptions, type TimelapseOutcome } from "./time";
import { TIME_LIMITS } from "./time-limits";
import { stepTracks } from "./tracks";
import { signalVisible } from "./visibility";
import { Working } from "./working";
import { optionalQuery, optionalService, own } from "./pack-kit";

export const TIMELAPSE_ACTION = "timelapse";
/** Off-screen agents caught up per turn (K) and their agent-day budget. */
export const AGENTS_PER_TURN = 4;
export const TURN_AGENT_DAYS = 30;

/** `povRoutine` false: the timelapse holds the POV where the story has it (`TimelapseOptions.povRoutine`). */
export type TurnChip =
  | { kind: "timelapse_offer"; activity: string; target: TimelapseTarget; remaining: number; povRoutine?: false }
  | { kind: "continue_timelapse"; target: TimelapseTarget; remaining: number; povRoutine?: false };

/** Why a turn's action queue stopped before its last action (DESIGN §11). */
export type QueueStop = "check" | "failure" | "interruption";

/** The plan plus what the renderers and chips need. Only `events` and `elapsedMinutes` are recorded. */
export interface EngineTurnPlan extends TurnPlan {
  /** The POV's actions as played, in order (the first, then the queued ones until the queue stopped); each with its events as recorded, with the rest of any event group they're in (a fight's act record and the rule events it fires). */
  resolutions: Resolution[];
  /** How many queued actions the turn left unplayed, and why the queue stopped before them; null when it played them all. */
  stopped: { left: number; cause: QueueStop } | null;
  timelapse: TimelapseOutcome | null;
  montage: Montage | null;
  chips: TurnChip[];
  outline: string[];
  /** A fight's part of the turn as the Outcome slot tells it (the combat pack, DESIGN §11); empty without one. */
  combat: string[];
  /** What the player's message says the player character does in the turn's time skip, in their words; null without one, or a skip it doesn't fill. */
  fill: string | null;
}

/** LOD1 agents with the POV who still act (DESIGN §8): caught up with it, not off-screen. */
function onScreen(w: Working): EntityId[] {
  const here = placeOfEntity(w.state, w.world.pov);
  if (!here) return [];
  return Object.keys(w.state.entities).filter((id) => id !== w.world.pov && own(w.state.entities, id)?.agent && placeOfEntity(w.state, id) === here && !isGone(w.state, id) && acts(w.world, w.state, id));
}

/** One of a turn's actions: the intent's first, or one queued after it. */
interface TurnStep {
  action: ActionId;
  params: JsonObject;
  judgement: Judgement | null;
  claim: Claim | null;
  needs: Needs | null;
}

/**
 * Whether the player's own words gave the action its length: a `duration` param it was given, which
 * interpret fills only from a length the input states (DESIGN §8), so the span is theirs to spend.
 */
function statedSpan(reg: Registry, world: WorldDoc, step: TurnStep | null): boolean {
  const def = step ? findAction(reg, world, step.action) : undefined;
  return Object.entries(def?.params ?? {}).some(([name, p]) => {
    const given = step?.params[name];
    return p.type === "duration" && typeof given === "number" && given > 0;
  });
}

/** The player character's activity span while it is still the current activity's (`activitySpanEnd`). */
function povSpan(w: Working): { type: string; until: number } | null {
  const fields = own(w.state.entities, w.world.pov)?.fields;
  const until = activitySpanEnd(fields);
  return until !== null && typeof fields?.activity === "string" ? { type: fields.activity, until } : null;
}

/** Activities an action's span gives for getting somewhere: arriving, the span's end, ends them. */
const ENDS_ON_ARRIVAL: Readonly<Record<string, true>> = { travel: true };

/** Which of this turn's resolutions began `span` for `pov` (a queued action's too), or -1 when none did. */
function spanOwner(resolutions: readonly Resolution[], pov: EntityId, span: { type: string; until: number }): number {
  for (let k = resolutions.length - 1; k >= 0; k--) {
    const a = resolutions[k]?.activity;
    if (resolutions[k]?.actor === pov && a?.type === span.type && a.until === span.until) return k;
  }
  return -1;
}

/**
 * Whether the action queue stops after an action (DESIGN §11), and why: a failure (a hard lock or
 * anything else it couldn't run, or part of it refused), a check (resolved, then the player sees how
 * it fell), or an interruption: the POV no longer acting (dying, dead, any state that doesn't act),
 * a fight (one starting, or one under way, where each turn is one act), a long activity Speed
 * through offers or runs, a change of place or scene the action's own effects didn't make, or a
 * signal the POV can see whose class stops a timelapse. A signal the POV can't see never stops it,
 * since stopping would give it away. An action that plays as plain roleplay (`playsAsRoleplay`)
 * changed nothing the rest of the message could hang on, so the rest goes on.
 */
function queueStop(w: Working, res: Resolution, since: number, scene: string, speeding: boolean): QueueStop | null {
  if ((!res.ok && !playsAsRoleplay(res)) || res.rejected.length > 0) return "failure";
  if (res.check || res.adjudged) return "check";
  if (!acts(w.world, w.state, w.world.pov) || speeding || fightHoldsClock(w.ctx) || sceneKey(w.world, w.state) !== scene) return "interruption";
  const policy = interruptPolicy(w.state);
  const signalled = w.events.slice(since).some((e) => {
    const s = "data" in e ? signalOf(e) : null;
    return s !== null && s.stops !== false && policy[s.class] === "stop" && signalVisible(w.reg, w.world, w.state, w.world.pov, s);
  });
  return signalled ? "interruption" : null;
}

/**
 * What every planned turn does first (DESIGN §5.1 step 2): a fresh pause is pinned to its scene, or
 * a lifted one cleared, and the POV's representation materializes. A time skip's pre phase starts
 * here too, so it reaches its beats in the state the plan will (DESIGN §24.7).
 */
export function turnStart(reg: Registry, w: Working, runSeed: string): void {
  w.applyAll(pauseBookkeeping(w.world, w.state));
  // The POV is always shown (HUD, panels): its representation materializes in its first planned turn.
  materializeAll(reg, w, w.world.pov, runSeed);
}

/** A timelapse intent's target and run options, read alike by the plan and by a time skip's pre phase (DESIGN §24.7). */
export function timelapseOptions(intent: InterpretOutput, runSeed: string): { target: TimelapseTarget | null; opts: TimelapseOptions } {
  const seg = intent.params.segment;
  return { target: parseTarget(intent.params.target), opts: { runSeed, overrides: parseOverrides(intent.params.overrides), segment: typeof seg === "number" ? seg : 1, ...(intent.params.povRoutine === false ? { povRoutine: false } : {}) } };
}

/**
 * A time skip the player asked for moves the story past a fight under way (DESIGN §11): a fight's
 * rounds take no clock time, so no skip runs inside one, and the fight ends before it
 * (`combat.break_off`). The plan and a time skip's pre phase both start a skip this way, from the
 * run's seed, so the pre phase reaches its beats in the state the plan will (DESIGN §24.7). The
 * narrator's lines for the fight's end; none without one.
 */
export function skipPastFight(w: Working, runSeed: string): string[] {
  if (!fightHoldsClock(w.ctx)) return [];
  return optionalService(w.ctx, "combat.break_off")?.(w, hashParts(runSeed, "skip", "fight")) ?? [];
}

/**
 * Makes a claim real (DESIGN §9.4 player claims), all or nothing: a thing through the gear pack's
 * `gear.claim`, money through the economy's `economy.claim_cash` (into the claimer's carried cash):
 * only what that cash lacks of the amount as the action plays, so what they carry is never made
 * again. The entity the action takes, or the cash account money went into, how many events made it
 * and the cash added. Null when nothing needs making (the claimer already holds the thing, made by
 * an earlier action of the turn, or carries the money by then) or it can't be made, and the action
 * then plays without it.
 */
function claimThing(w: Working, claim: Claim, salt: string): { entity: EntityId; events: number; cents?: number } | null {
  const lacking = claim.cents === undefined ? undefined : claim.cents - Math.max(0, optionalQuery(w.ctx, "economy.carried_cash")?.(w.ctx, w.world.pov) ?? 0);
  if (lacking !== undefined && lacking <= 0) return null;
  const made = lacking !== undefined ? optionalService(w.ctx, "economy.claim_cash")?.(w.ctx, w.world.pov, lacking) : optionalService(w.ctx, "gear.claim")?.(w.ctx, { ...claim, by: w.world.pov, salt });
  if (!made || !("entity" in made)) return null;
  const before = w.mark();
  for (const e of made.events) {
    if (w.apply(e)) {
      w.restore(before);
      return null;
    }
  }
  return { entity: made.entity, events: made.events.length, ...(lacking !== undefined ? { cents: lacking } : {}) };
}

export function planTurn(input: TurnPlanInput): EngineTurnPlan {
  const reg: Registry = input.registry;
  const w = new Working(reg, input.world, input.state);
  const rng = createRng(input.seed);
  const chips: TurnChip[] = [];
  turnStart(reg, w, input.runSeed);
  const from = w.state.clock;
  const intent = input.intent;
  const resolutions: Resolution[] = [];
  // Each played action's picks in words and where the POV stood before it, by its index in `resolutions`, to tell it once the turn has played.
  const played: BeforeAction[] = [];
  let stopped: EngineTurnPlan["stopped"] = null;
  let timelapse: TimelapseOutcome | null = null;
  const combat: string[] = [];
  // What the player's message fills a time skip with, in their words (the read's `text`): the content
  // the narrator tells of the span, a directive the engine's lines never overrule (DESIGN §9.2).
  const fill = intent?.action === TIMELAPSE_ACTION ? (intent.text?.trim() ?? "") || null : null;

  if (intent?.action === TIMELAPSE_ACTION) {
    const { target, opts } = timelapseOptions(intent, input.runSeed);
    // A fight under way ends first, and the skip runs from there (`skipPastFight`). A time skip's pre
    // phase recorded the minds at its beats from the same start: the plan replays them (DESIGN §24.7).
    // A skip that can't run (the clock paused) leaves the fight as it was.
    const before = w.mark();
    const broke = target ? skipPastFight(w, input.runSeed) : [];
    const outcome = !target ? { code: "bad_target", reason: "no timelapse target" } : input.skip ? replaySkip(reg, w, target, input.skip, opts) : runTimelapse(reg, w, target, opts);
    if ("code" in outcome) {
      w.restore(before);
      w.apply({ type: ENGINE_EVENTS.note, data: { text: `Timelapse not run: ${outcome.reason}` } });
    } else {
      combat.push(...broke);
      timelapse = outcome;
    }
  } else {
    const steps: TurnStep[] = intent?.action ? [{ action: intent.action, params: intent.params, judgement: intent.judgement ?? null, claim: intent.claim ?? null, needs: intent.needs ?? null }, ...(intent.queue ?? []).map((q) => ({ action: q.action, params: q.params, judgement: q.judgement ?? null, claim: q.claim ?? null, needs: q.needs ?? null }))] : [];
    const heard = input.userTexts.join("\n");
    // With no action the loop runs once all the same: a fight under way takes its turns, and the turn its tick.
    for (let i = 0; i < Math.max(1, steps.length); i++) {
      const step = steps[i] ?? null;
      // The first action draws from the turn's own streams, as a turn of one action always has; each
      // queued one from its own, so no two actions share a roll.
      const draws = i === 0 ? rng : rng.fork(`queue:${i}`);
      const seed = i === 0 ? input.seed : hashParts(input.seed, "queue", i);
      // A fight under way runs everyone else's turns around the POV's action (the combat pack).
      const fight = optionalService(w.ctx, "combat.round")?.(w, draws.fork("combat"));
      const mark = w.events.length;
      // Whether the action comes inside a fight already under way (the turns still due have run).
      const inFight = fightHoldsClock(w.ctx);
      let resolution: Resolution | null = null;
      // The place and scene as the action's own effects leave them; any other change interrupts the queue.
      let scene = sceneKey(w.world, w.state);
      let made: { entity: EntityId; name: string; events: number; cents?: number } | null = null;
      let ruled = mark;
      const before: BeforeAction = { picks: "", from: placeOfEntity(w.state, w.world.pov), fields: { ...own(w.state.entities, w.world.pov)?.fields } };
      if (step) {
        // What the player typed is their will (DESIGN §11); one picked in the engine's own controls is held to its requirements.
        const typed = i > 0 || intent?.picked !== true;
        // An action played in the place of the one the player's words named (money handed over, as
        // Pay) is held to that one's needs too; when they don't hold, nothing is made for it.
        const unmet = step.needs ? unmetNeeds(reg, w.world, w.state, step.needs) : null;
        // A thing the player said they had comes into being where the action expects it, just
        // before the action, which takes it; money goes into their cash, which the action pays over
        // (DESIGN §9.4 player claims).
        const claimed = step.claim && unmet === null ? claimThing(w, step.claim, hashParts(seed, "claim")) : null;
        if (claimed && step.claim) made = { entity: claimed.entity, name: claimed.cents !== undefined ? formatMoney(claimed.cents, w.world.currency) : step.claim.name, events: claimed.events, ...(claimed.cents !== undefined ? { cents: claimed.cents } : {}) };
        const params = claimed && step.claim && step.claim.cents === undefined ? { ...step.params, [step.claim.param]: claimed.entity } : step.params;
        // Its picks in words as the POV knows them now, before the action gives away or uses up what it
        // names; the turn's own message counts as said, since the narrator reads it anyway (DESIGN §7).
        const def = findAction(reg, w.world, step.action);
        before.picks = def ? actionWords(reg, w.world, w.state, def, params, "", heard) : "";
        const acting = w.mark();
        // An inferred check plays as Try something, carrying the world's own check (DESIGN §11).
        resolution = step.action === TRY_ACTION ? resolveTry(reg, w, params, draws, { runSeed: input.runSeed, judgement: step.judgement, heard }) : resolveAction(reg, w, { action: step.action, params }, draws, { runSeed: input.runSeed, judgement: step.judgement, ...(step.needs ? { needs: step.needs } : {}) });
        // A typed action whose plain requirement doesn't hold plays as plain roleplay; hard locks hold it.
        if (typed && missedPlainRequirement(resolution)) resolution = { ...resolution, roleplay: true };
        // So does one whose payment the money can't cover: what money covers is the engine's default,
        // not a lock, and the reply's read charges a purchase the story tells (DESIGN §9.5). None of it plays.
        const uncovered = typed && resolution.ok ? resolution.rejected.find((r) => r.rejection.code === "declined") : undefined;
        if (uncovered) {
          w.restore(acting);
          resolution = { ...resolution, ok: false, failed: { code: "declined", reason: uncovered.rejection.reason }, check: null, outcome: null, events: [], rejected: [], duration: 0, activity: null, adjudged: null, roleplay: true };
        }
        scene = sceneKey(w.world, w.state);
        // The rules see the claimed thing's making too, so a world rule can react to its mark.
        const done = w.events.slice(mark, mark + (made?.events ?? 0) + resolution.events.length);
        if (done.length > 0) runRulesOnEvents(reg, w, done, { seed });
        ruled = w.events.length;
      }
      combat.push(...(fight?.after(resolution ? { resolution, params: step?.params ?? {} } : null) ?? []));
      if (resolution) {
        // A fight makes the POV's act one event group with its record and the rule events it fires,
        // after the act applied: the resolution carries the act as recorded, so an Undo of the action
        // ("Not an action?") finds and takes all of it. A claimed thing's making leads its events.
        let end = mark + (made?.events ?? 0) + resolution.events.length;
        const groups = new Set(w.events.slice(mark, end).flatMap((e) => (e.group !== undefined ? [e.group] : [])));
        for (; end < w.events.length; end++) {
          const group = w.events[end]?.group;
          if (group === undefined || !groups.has(group)) break;
        }
        resolution = { ...resolution, events: w.events.slice(mark, end), ...(made && made.events > 0 ? { claimed: { entity: made.entity, name: made.name, events: w.events.slice(mark, ruled), ...(made.cents !== undefined ? { cents: made.cents } : {}) } } : {}) };
        resolutions.push(resolution);
        played.push(before);
      }
      // A fight's rounds are seconds long: a turn inside one already under way, that still is, moves no
      // clock, whatever its action took, so no day plan or schedule runs mid-fight (the combat pack also
      // holds its participants in place). The turn whose action starts one keeps that action's time (a
      // long stalk that ends in an ambush); nothing speeds through while one is under way. Each action
      // takes its own time, so durations add up; the scene tick stands in only when none ran.
      const fighting = fightHoldsClock(w.ctx);
      const elapsed = (inFight && fighting) || (i > 0 && !resolution?.ok) ? null : turnElapsed(w.world, w.state, resolution?.ok ? resolution.duration : null);
      const began = w.state.clock;
      if (elapsed && elapsed.minutes > 0) advance(reg, w, w.state.clock + elapsed.minutes, { runSeed: input.runSeed, mode: "turn", cause: elapsed.source === "action" ? "action" : "tick" });
      const act = resolution?.activity;
      let speeding = false;
      if (act && elapsed && elapsed.source !== "paused" && !fighting) {
        const remaining = act.until - w.state.clock;
        const mode = speedThrough(w.state, act.type, remaining);
        // A span the player's own words gave the action ("sleep for eight hours") is theirs to spend
        // (DESIGN §8): the policy carries all of it past the action's own time.
        const stated = statedSpan(reg, w.world, step);
        if (mode !== "elapse") {
          speeding = true;
          const until: TimelapseTarget = { type: "at", at: act.until };
          // Its Timelapse holds the POV in it to its end, as a typed out-of-character span does, so its
          // routine doesn't wake a daytime sleeper for dinner. Going to bed for the night follows the routine.
          const hold = stated ? { povRoutine: false as const } : {};
          const offer: TurnChip = { kind: "timelapse_offer", activity: act.type, target: until, remaining, ...hold };
          if (mode === "auto") {
            const outcome = runTimelapse(reg, w, until, { runSeed: input.runSeed, ...hold });
            if ("code" in outcome) chips.push(offer);
            else timelapse = outcome;
          } else chips.push(offer);
        } else if (stated && remaining > 0) {
          // Under its threshold, or with no policy, the rest passes within the turn (DESIGN §9.2):
          // "sleep for 20 minutes" is a 20-minute turn though going to bed takes five.
          advance(reg, w, Math.min(act.until, w.state.clock + TIME_LIMITS.timelapseMinutes), { runSeed: input.runSeed, mode: "turn", cause: "action" });
        }
      }
      // The player character's activity span that ended within this step's time meets its needs at
      // its end (`ProcessDef.ended`). The action of this turn that began it, a queued one's too, owns
      // what it met, so "Not an action?" and a claimed thing's Undo take it back with the rest (DESIGN
      // §9.2); one an earlier turn began is this turn's time's. One its Speed through runs is met by
      // that Timelapse. A span goes on until another activity is set or the player character moves
      // (`activitySpanEnd`): a turn that plays no action ("Goodnight, Rosa") keeps it.
      const span = speeding ? null : povSpan(w);
      if (span && span.until > began && span.until <= w.state.clock) {
        const met: LedgerEvent[] = [];
        for (const def of reg.processes) {
          if (def.scope === "agent" && def.ended && w.ctx.levelOf(w.world.pov, def.domain) >= def.minLevel) met.push(...w.applyAll(def.ended(w.ctx, w.world.pov, span)));
        }
        // Arriving ends travel: once the walk or the drive is over, the player character isn't travelling.
        if (ENDS_ON_ARRIVAL[span.type] && own(w.state.entities, w.world.pov)?.fields.activity === span.type) met.push(...w.applyAll([{ type: "set", entity: w.world.pov, field: "activity", value: IDLE_OPTION }]));
        const owner = spanOwner(resolutions, w.world.pov, span);
        const starter = owner >= 0 ? resolutions[owner] : undefined;
        if (starter && met.length > 0) {
          const owned: Resolution = { ...starter, events: [...starter.events, ...met], ...(starter.claimed ? { claimed: { ...starter.claimed, events: [...starter.claimed.events, ...met] } } : {}) };
          resolutions[owner] = owned;
          if (resolution && owner === resolutions.length - 1) resolution = owned;
        }
        // World rules hear what an activity met, as they hear what a turn's own time met.
        if (met.length > 0) runRulesOnEvents(reg, w, met, { seed: hashParts(seed, "ended") });
      }
      // The story moves on from what this step did (DESIGN §10): a stage its action, its rules or its
      // time made true is entered now, before the reply, so this turn's narrator is told of it (the
      // Quest section and the Outline read the plan), and the next action of the message stands where
      // the story now does. A quest's signal stops the queue as any other may.
      stepTracks(reg, w, hashParts(seed, "tracks"));
      const left = steps.length - 1 - i;
      const cause = resolution && left > 0 ? queueStop(w, resolution, mark, scene, speeding) : null;
      if (cause) {
        stopped = { left, cause };
        break;
      }
    }
  }
  if (timelapse?.chip) chips.push(timelapse.chip);
  if (w.state.clock > from) catchUp(reg, w, { runSeed: input.runSeed, agents: AGENTS_PER_TURN, onScreen: onScreen(w), agentDays: TURN_AGENT_DAYS });
  // Timelapse records are coarsened (DESIGN §4.3); the Montage is built from the record so it matches the ledger.
  const events = timelapse ? coarsen(reg, w.world, input.state, w.events) : [...w.events];
  const montage = timelapse ? buildMontage(reg, w.world, input.state, w.state, events, w.state.time.montage) : null;
  if (timelapse && montage) timelapse = { ...timelapse, montage };
  // Each action as the narrator is told it, read against the turn's end state as the Journal reads its events.
  const told = resolutions.map((r, k) => ({ ...r, told: toldAction(reg, w.world, w.state, r, played[k] ?? { picks: "", from: null, fields: {} }) }));
  return {
    events,
    elapsedMinutes: w.state.clock - from,
    resolutions: told,
    stopped,
    timelapse,
    montage,
    chips,
    outline: outline(reg, w.world, w.state, { resolutions: told, timelapse, events: w.events, fill: timelapse ? fill : null }, rng.fork("beats")),
    combat,
    fill: timelapse ? fill : null,
  };
}

export function postTurn(input: PostTurnInput): LedgerEvent[] {
  const reg = input.registry;
  const w = new Working(reg, input.world, input.state);
  if (input.extracted.length > 0) runRulesOnEvents(reg, w, input.extracted, { seed: input.seed });
  catchUp(reg, w, { runSeed: input.runSeed, agents: AGENTS_PER_TURN, onScreen: onScreen(w), agentDays: TURN_AGENT_DAYS });
  runRulesOnTick(reg, w, "turn", { seed: input.seed });
  stepTracks(reg, w, input.seed);
  // Catch-up output is derivable process output: recorded coarsened, like a timelapse.
  return coarsen(reg, input.world, input.state, w.events);
}

export const turnPipeline: TurnPipeline = { plan: planTurn, post: postTurn };

/**
 * A timelapse intent for a target (palette, chips, commands). `povRoutine` false: a span the player's
 * own words spend doing something, which keeps the POV where the story has it (`TimelapseOptions`).
 */
export function timelapseIntent(target: TimelapseTarget, overrides?: Record<string, string>, segment = 1, povRoutine = true): { action: string; params: Record<string, JsonValue>; probabilities: Record<string, number> } {
  return { action: TIMELAPSE_ACTION, params: { target, ...(overrides ? { overrides } : {}), segment, ...(povRoutine ? {} : { povRoutine: false }) }, probabilities: {} };
}
