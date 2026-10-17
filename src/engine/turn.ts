// The turn pipeline (DESIGN §5.1 steps 2 and 5): the engine side of `TurnPipeline` (engine/steps).
//
// plan (pre-reply, fold order):
//   pause bookkeeping → the action (materialization, requirements, check, effects, event rules)
//   with a fight's turns around it (`combat.round`) → the elapsed time through `advance` (world
//   processes, schedules, slot rules, tracks) → a timelapse (explicit, or Speed through `auto`)
//   → off-screen catch-up when time moved.
// post (after extraction): catch-up when time didn't move in plan, turn rules and tracks.
//
// Intents: `interpret`'s answer, or a palette/command intent of the same shape. The built-in
// `timelapse` action takes `params: {target, overrides?, segment?}` (time.ts `TimelapseTarget`).

import type { JsonValue } from "../shared/json";
import type { EntityId } from "../shared/ids";
import type { LedgerEvent, TimelapseTarget } from "../shared/ledger";
import { outline } from "./beats";
import { ENGINE_EVENTS } from "./engine-pack";
import { materializeAll } from "./materialize";
import type { Registry } from "./registry-impl";
import { resolveAction, type Resolution } from "./resolve";
import { createRng } from "./rng";
import { runRulesOnEvents, runRulesOnTick } from "./rules";
import { isGone, placeOfEntity } from "./scope";
import { advance, catchUp, coarsen } from "./simulate";
import type { PostTurnInput, TurnPipeline, TurnPlan, TurnPlanInput } from "./steps";
import { buildMontage, pauseBookkeeping, parseOverrides, parseTarget, runTimelapse, speedThrough, turnElapsed, type Montage, type TimelapseOutcome } from "./time";
import { stepTracks } from "./tracks";
import { Working } from "./working";
import { optionalService, own } from "./pack-kit";

export const TIMELAPSE_ACTION = "timelapse";
/** Off-screen agents caught up per turn (K) and their agent-day budget. */
export const AGENTS_PER_TURN = 4;
export const TURN_AGENT_DAYS = 30;

export type TurnChip =
  | { kind: "timelapse_offer"; activity: string; target: TimelapseTarget; remaining: number }
  | { kind: "continue_timelapse"; target: TimelapseTarget; remaining: number };

/** The plan plus what the renderers and chips need. Only `events` and `elapsedMinutes` are recorded. */
export interface EngineTurnPlan extends TurnPlan {
  resolution: Resolution | null;
  timelapse: TimelapseOutcome | null;
  montage: Montage | null;
  chips: TurnChip[];
  outline: string[];
  /** A fight's part of the turn as the Outcome slot tells it (the combat pack, DESIGN §11); empty without one. */
  combat: string[];
}

function onScreen(w: Working): EntityId[] {
  const here = placeOfEntity(w.state, w.world.pov);
  if (!here) return [];
  return Object.keys(w.state.entities).filter((id) => id !== w.world.pov && own(w.state.entities, id)?.agent && placeOfEntity(w.state, id) === here && !isGone(w.state, id));
}

export function planTurn(input: TurnPlanInput): EngineTurnPlan {
  const reg: Registry = input.registry;
  const w = new Working(reg, input.world, input.state);
  const rng = createRng(input.seed);
  const chips: TurnChip[] = [];
  w.applyAll(pauseBookkeeping(w.world, w.state));
  // The POV is always shown (HUD, panels): its representation materializes in its first planned turn.
  materializeAll(reg, w, w.world.pov, input.runSeed);
  const from = w.state.clock;
  const intent = input.intent;
  let resolution: Resolution | null = null;
  let timelapse: TimelapseOutcome | null = null;
  let combat: string[] = [];

  if (intent?.action === TIMELAPSE_ACTION) {
    const target = parseTarget(intent.params.target);
    const seg = intent.params.segment;
    const outcome = target
      ? runTimelapse(reg, w, target, { runSeed: input.runSeed, overrides: parseOverrides(intent.params.overrides), segment: typeof seg === "number" ? seg : 1 })
      : { code: "bad_target", reason: "no timelapse target" };
    if ("code" in outcome) w.apply({ type: ENGINE_EVENTS.note, data: { text: `Timelapse not run: ${outcome.reason}` } });
    else timelapse = outcome;
  } else {
    // A fight under way runs everyone else's turns around the POV's action (the combat pack).
    const fight = optionalService(w.ctx, "combat.round")?.(w, rng.fork("combat"));
    if (intent?.action) {
      resolution = resolveAction(reg, w, { action: intent.action, params: intent.params }, rng, { runSeed: input.runSeed, judgement: intent.judgement ?? null });
      if (resolution.events.length > 0) runRulesOnEvents(reg, w, resolution.events, { seed: input.seed });
    }
    combat = fight?.after(resolution ? { resolution, params: intent?.params ?? {} } : null) ?? [];
    const elapsed = turnElapsed(w.world, w.state, resolution?.ok ? resolution.duration : null);
    if (elapsed.minutes > 0) advance(reg, w, w.state.clock + elapsed.minutes, { runSeed: input.runSeed, mode: "turn", cause: elapsed.source === "action" ? "action" : "tick" });
    const act = resolution?.activity;
    if (act && elapsed.source !== "paused") {
      const remaining = act.until - w.state.clock;
      const mode = speedThrough(w.state, act.type, remaining);
      if (mode !== "elapse") {
        const until: TimelapseTarget = { type: "at", at: act.until };
        if (mode === "auto") {
          const outcome = runTimelapse(reg, w, until, { runSeed: input.runSeed });
          if ("code" in outcome) chips.push({ kind: "timelapse_offer", activity: act.type, target: until, remaining });
          else timelapse = outcome;
        } else chips.push({ kind: "timelapse_offer", activity: act.type, target: until, remaining });
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
    resolution,
    timelapse,
    montage,
    chips,
    outline: outline(reg, w.world, w.state, { resolution, timelapse, events: w.events }, rng.fork("beats")),
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

/** A timelapse intent for a target (palette, chips, commands). */
export function timelapseIntent(target: TimelapseTarget, overrides?: Record<string, string>, segment = 1): { action: string; params: Record<string, JsonValue>; probabilities: Record<string, number> } {
  return { action: TIMELAPSE_ACTION, params: { target, ...(overrides ? { overrides } : {}), segment }, probabilities: {} };
}
