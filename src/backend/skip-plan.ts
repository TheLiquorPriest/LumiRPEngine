// The model's skip plan (#53, DESIGN §8 "Routine roles"): as a time skip starts, the people whose skip
// life is `model` are planned, by one helper call for them all or, as the world's `skipPlanCalls`
// says, one call per person at once (so no answer grows with the cast and the span), and the checked
// answers are recorded as one `castlife.skip_plan` ahead of the timelapse, so the fold lives it and a
// replay never asks again. A Continue inside a planned span reuses the plan. Anyone whose call fails or
// runs out of time isn't planned: the event carries a note for the GM, and the skip still runs.

import type { UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { ROUTINE_EVENTS, routineSettingsOf, type SkipPlan } from "../shared/routines";
import type { Limit } from "../shared/minds";
import { firedTimeout, within } from "../shared/timeouts";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindIs } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { InterpretOutput } from "../engine/steps";
import { TimelapseRun } from "../engine/time";
import { timelapseOptions } from "../engine/turn";
import { Working } from "../engine/working";
import { checkSkipPlan, skipPlanBrief, skipPlanText } from "../packs/castlife/core/skip-plan";
import { skipLifeOf, skipPlanOf } from "../packs/castlife/core/routines";
import { livesPlans } from "../packs/castlife/core/commitments";
import { povSafe } from "../packs/castlife/core/usual";
import type { Steps } from "./steps";

/** The most of the latest reply the call reads. */
const REPLY_CAP = 2_000;

/** The call's instructions; tests tell the call apart by them. */
export const SKIP_PLAN_SYSTEM = [
  "You plan how some people in a roleplay spend a stretch of time that is skipped over. For each person, give a few blocks of time, only for what they do other than simply being at home asleep. Gaps are fine: whenever no block covers them, they go home to sleep and eat on their own, so don't plan hour by hour, and never plan a block just to send them home or to bed.",
  "Their usual routine is background you may follow, bend or ignore as the story suggests; it is never a rule. What the story already set for them comes first. Keep each person in character and consistent with the latest reply.",
  "Use only the places and activities listed, by id and word as given. Every block lies inside the skip, and one person's blocks never overlap. A label is a few plain words saying what they do, naming no one.",
  'Answer with JSON only: {"plans":[{"entity":"<person id>","blocks":[{"label":"...","start":"YYYY-MM-DD HH:MM","end":"YYYY-MM-DD HH:MM","place":"<place id>","activity":"<activity>"}]}]}. Leave out anyone with nothing worth planning.',
].join("\n");

export interface SkipPlanInput {
  userId: UserId;
  world: WorldDoc;
  /** The state the turn's plan starts from. */
  state: Readonly<WorldState>;
  intent: InterpretOutput;
  runSeed: string;
  /** The latest reply, and the Journal's recent lines (the chat's memory as the player may read it). */
  reply: string;
  journal: readonly string[];
  /** The engine run's clock, and the call's own limit (`skipPlanMs`). */
  signal: AbortSignal;
  limit: Limit;
}

export interface SkipPlanDeps {
  registry: Registry;
  steps: Steps;
  log: (message: string) => void;
}

/**
 * The `castlife.skip_plan` a timelapse turn records ahead of its timelapse: null when the timelapse
 * can't run, when no one in it has their skip planned by the model, or when it continues inside the
 * span the last plan covers (which the fold still holds).
 */
export async function planSkip(deps: SkipPlanDeps, input: SkipPlanInput): Promise<LedgerEvent | null> {
  const { target, opts } = timelapseOptions(input.intent, input.runSeed);
  const run = target ? TimelapseRun.start(deps.registry, new Working(deps.registry, input.world, input.state), target, opts) : null;
  if (!run || "code" in run || run.to <= run.from) return null;
  const { from, to } = run;
  const last = skipPlanOf(input.state);
  if (last && last.from <= from && from < last.to && to <= last.to) return null;
  const ctx = deps.registry.context(input.world, input.state);
  // Only people the engine lives a day for (an LOD1 agent from Cast life 3, §24.8): anyone else would
  // never take up a planned block, so planning them would only show plans nothing lives.
  const people = Object.keys(input.state.entities)
    .sort()
    .filter((id) => kindIs(deps.registry, input.world, input.state.entities[id]?.kind ?? "", "person") && !isGone(input.state, id) && livesPlans(ctx, id) && skipLifeOf(ctx, id) === "model");
  if (people.length === 0) return null;
  const safe = povSafe(ctx);
  const reply = input.reply.slice(-REPLY_CAP);
  const told = safe(reply) ? reply : "";
  const journal = input.journal.filter(safe);
  const signal = within(input.signal, "skipPlanMs", input.limit);
  const groups = routineSettingsOf(input.world).skipPlanCalls === "parallel" ? people.map((id) => [id]) : [people];
  // Each call is told only its own people; the calls run at once, each inside the same limit.
  const answers = await Promise.all(
    groups.map(async (group) => {
      const brief = skipPlanBrief(ctx, group, from, to);
      const failure = { reason: "" };
      // Spared: a failed plan leaves its people to their basic needs, and the skip runs without it.
      const raw = signal.aborted ? null : await deps.steps.helperJson("skip", SKIP_PLAN_SYSTEM, skipPlanText(ctx, brief, told, journal), null, input.userId, signal, { failure, spared: true });
      if (raw !== null) return { people: group.length, checked: checkSkipPlan(ctx, brief, raw), why: null };
      const fired = firedTimeout(signal);
      return { people: group.length, checked: null, why: fired ? fired.message : failure.reason || "the call didn't answer" };
    }),
  );
  const record = (plan: SkipPlan): LedgerEvent => ({ type: ROUTINE_EVENTS.skipPlan, data: JSON.parse(JSON.stringify(plan)) as JsonObject });
  const dropped = answers.flatMap((a) => a.checked?.dropped ?? []);
  if (dropped.length > 0) deps.log(`skip plan dropped ${dropped.length} block(s): ${dropped.join("; ")}`);
  const plans = answers.flatMap((a) => a.checked?.plans ?? []);
  const failed = answers.filter((a) => a.why !== null);
  if (failed.length === 0) return record({ from, to, plans });
  const why = failed[0]?.why ?? "the call didn't answer";
  const missed = failed.reduce((n, a) => n + a.people, 0);
  deps.log(`skip plan for ${missed} of ${people.length} people failed: ${why}`);
  // The note counts who wasn't planned and never names them.
  const note = missed === people.length ? `The skip plan wasn't made (${why}), so everyone it would have planned keeps to their basic needs.` : `The skip plan wasn't made for ${missed} of ${people.length} people (${why}), so they keep to their basic needs.`;
  return record({ from, to, plans, note });
}
