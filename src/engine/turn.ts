// The turn pipeline (DESIGN §5.1 steps 2 and 5): the engine side of `TurnPipeline` (engine/steps).
//
// plan (pre-reply, fold order):
//   pause bookkeeping → the actions in order (DESIGN §11 action queue), each against the state the
//   one before it left: materialization, requirements, check, effects and event rules, with a
//   fight's turns around it (`combat.round`), then its time through `advance` (world processes,
//   schedules, slot rules, tracks; none for an action inside a fight already under way, whose rounds
//   take no clock time, while the action that starts one keeps its time; the scene tick when no
//   action ran), until the queue stops at a check, a failure or an interruption → a timelapse
//   (explicit, or Speed through `auto`; never in a fight) → off-screen catch-up when time moved.
// post (after extraction): catch-up when time didn't move in plan, turn rules and tracks.
//
// Intents: `interpret`'s answer, or a palette/command intent of the same shape. The built-in
// `timelapse` action takes `params: {target, overrides?, segment?}` (time.ts `TimelapseTarget`).

import type { JsonObject, JsonValue } from "../shared/json";
import { hashParts } from "../shared/hash";
import type { ActionId, EntityId } from "../shared/ids";
import type { LedgerEvent, TimelapseTarget } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import type { Judgement } from "./adjudication";
import { outline } from "./beats";
import { ENGINE_EVENTS, signalOf } from "./engine-pack";
import { materializeAll } from "./materialize";
import type { Registry } from "./registry-impl";
import { findAction, resolveAction, type Resolution } from "./resolve";
import { resolveTry, TRY_ACTION } from "./inferred";
import { createRng } from "./rng";
import { runRulesOnEvents, runRulesOnTick } from "./rules";
import { acts } from "./life";
import { isGone, placeOfEntity } from "./scope";
import { advance, catchUp, coarsen, interruptPolicy } from "./simulate";
import type { Claim, InterpretOutput, PostTurnInput, TurnPipeline, TurnPlan, TurnPlanInput } from "./steps";
import { buildMontage, fightHoldsClock, IN_FIGHT, pauseBookkeeping, parseOverrides, parseTarget, replaySkip, runTimelapse, sceneKey, speedThrough, turnElapsed, type Montage, type TimelapseOptions, type TimelapseOutcome } from "./time";
import { TIME_LIMITS } from "./time-limits";
import { stepTracks } from "./tracks";
import { signalVisible } from "./visibility";
import { Working } from "./working";
import { optionalService, own } from "./pack-kit";

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

/**
 * Whether the action queue stops after an action (DESIGN §11), and why: a failure (it couldn't run,
 * or part of it was refused), a check (resolved, then the player sees how it fell), or an
 * interruption: the POV no longer acting (dying, dead, any state that doesn't act), a fight (one
 * starting, or one under way, where each turn is one act), a long activity Speed through offers or
 * runs, a change of place or scene the action's own effects didn't make, or a signal the POV can see
 * whose class stops a timelapse. A signal the POV can't see never stops it, since stopping would give
 * it away.
 */
function queueStop(w: Working, res: Resolution, since: number, scene: string, speeding: boolean): QueueStop | null {
  if (!res.ok || res.rejected.length > 0) return "failure";
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
 * Makes a claim real (DESIGN §9.4 player claims) through the gear pack's `gear.claim`, all or
 * nothing: the entity the action takes, and how many events made it (none when the claimer already
 * holds the thing, made by an earlier action of the turn). Null when it can't be made, and the
 * action then fails as one naming nothing.
 */
function claimThing(w: Working, claim: Claim, salt: string): { entity: EntityId; events: number } | null {
  const made = optionalService(w.ctx, "gear.claim")?.(w.ctx, { ...claim, by: w.world.pov, salt });
  if (!made || !("entity" in made)) return null;
  const before = w.mark();
  for (const e of made.events) {
    if (w.apply(e)) {
      w.restore(before);
      return null;
    }
  }
  return { entity: made.entity, events: made.events.length };
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
  let stopped: EngineTurnPlan["stopped"] = null;
  let timelapse: TimelapseOutcome | null = null;
  const combat: string[] = [];

  if (intent?.action === TIMELAPSE_ACTION) {
    const { target, opts } = timelapseOptions(intent, input.runSeed);
    // A fight's rounds take no clock time (DESIGN §11), so nothing skips ahead while the POV is in one.
    // A time skip's pre phase recorded the minds at its beats: the plan replays them (DESIGN §24.7).
    const outcome = !target
      ? { code: "bad_target", reason: "no timelapse target" }
      : fightHoldsClock(w.ctx)
        ? { code: "in_fight", reason: IN_FIGHT }
        : input.skip
          ? replaySkip(reg, w, target, input.skip, opts)
          : runTimelapse(reg, w, target, opts);
    if ("code" in outcome) w.apply({ type: ENGINE_EVENTS.note, data: { text: `Timelapse not run: ${outcome.reason}` } });
    else timelapse = outcome;
  } else {
    const steps: TurnStep[] = intent?.action ? [{ action: intent.action, params: intent.params, judgement: intent.judgement ?? null, claim: intent.claim ?? null }, ...(intent.queue ?? []).map((q) => ({ action: q.action, params: q.params, judgement: q.judgement ?? null, claim: q.claim ?? null }))] : [];
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
      let made: { entity: EntityId; name: string; events: number } | null = null;
      let ruled = mark;
      if (step) {
        // A thing the player said they had comes into being where the action expects it, just
        // before the action, which takes it (DESIGN §9.4 player claims).
        const claimed = step.claim ? claimThing(w, step.claim, hashParts(seed, "claim")) : null;
        if (claimed && step.claim) made = { entity: claimed.entity, name: step.claim.name, events: claimed.events };
        const params = claimed && step.claim ? { ...step.params, [step.claim.param]: claimed.entity } : step.params;
        // An inferred check plays as Try something, carrying the world's own check (DESIGN §11).
        resolution = step.action === TRY_ACTION ? resolveTry(reg, w, params, draws, { runSeed: input.runSeed, judgement: step.judgement }) : resolveAction(reg, w, { action: step.action, params }, draws, { runSeed: input.runSeed, judgement: step.judgement });
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
        resolution = { ...resolution, events: w.events.slice(mark, end), ...(made && made.events > 0 ? { claimed: { entity: made.entity, name: made.name, events: w.events.slice(mark, ruled) } } : {}) };
        resolutions.push(resolution);
      }
      // A fight's rounds are seconds long: a turn inside one already under way, that still is, moves no
      // clock, whatever its action took, so no day plan or schedule runs mid-fight (the combat pack also
      // holds its participants in place). The turn whose action starts one keeps that action's time (a
      // long stalk that ends in an ambush); nothing speeds through while one is under way. Each action
      // takes its own time, so durations add up; the scene tick stands in only when none ran.
      const fighting = fightHoldsClock(w.ctx);
      const elapsed = (inFight && fighting) || (i > 0 && !resolution?.ok) ? null : turnElapsed(w.world, w.state, resolution?.ok ? resolution.duration : null);
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
  return {
    events,
    elapsedMinutes: w.state.clock - from,
    resolutions,
    stopped,
    timelapse,
    montage,
    chips,
    outline: outline(reg, w.world, w.state, { resolutions, timelapse, events: w.events }, rng.fork("beats")),
    combat,
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
