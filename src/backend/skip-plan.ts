// The model's skip plan (#53, DESIGN §8 "Routine roles"): as a time skip starts, the people whose skip
// life is `model` are planned, by one helper call for them all or, as the world's `skipPlanCalls`
// says, one call per person at once (so no answer grows with the cast and the span), and the checked
// answers are recorded as one `castlife.skip_plan` ahead of the timelapse, so the fold lives it and a
// replay never asks again. A Continue inside a planned span reuses the plan. Anyone whose call fails or
// runs out of time isn't planned: the event carries a note for the GM, and the skip still runs.

import type { ChatId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { ROUTINE_EVENTS, routineSettingsOf, type SkipPlan } from "../shared/routines";
import type { Limit, MindsReads } from "../shared/minds";
import type { StepConfig } from "../shared/settings";
import { firedTimeout, within } from "../shared/timeouts";
import type { WorldDoc } from "../shared/world";
import { SKIP_PLAN_ANSWER, SKIP_PLAN_PROMPT } from "../shared/skip-plan";
import { calendarOf, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { povPlace, unrevealedSecrets } from "../engine/visibility";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindIs } from "../engine/scope";
import { pinsFor } from "../engine/lore-pins";
import type { WorldState } from "../engine/state";
import type { InterpretOutput } from "../engine/steps";
import { TimelapseRun } from "../engine/time";
import { timelapseOptions } from "../engine/turn";
import { Working } from "../engine/working";
import { checkSkipPlan, skipPlanBrief, skipPlanText } from "../packs/castlife/core/skip-plan";
import { skipLifeOf, skipPlanOf } from "../packs/castlife/core/routines";
import { livesPlans } from "../packs/castlife/core/commitments";
import { povSafe } from "../packs/castlife/core/usual";
import type { HostPort } from "./host";
import { readPins } from "./lore-pins";
import { chatBefore } from "./minds";
import { pinnedLines, recentChat } from "./minds-context";
import type { Steps } from "./steps";
import { renderTemplate, safeVars } from "./turn-steps";

/** The most of the latest reply the call reads. */
const REPLY_CAP = 2_000;

/**
 * The call's instructions: the user's own prompt for the time-skip step (Settings → Steps and
 * connections, `config.template`), its placeholders filled, else the built-in; then the answer format,
 * which no prompt replaces.
 */
export function skipPlanSystem(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, from: number, config: Pick<StepConfig, "template"> | null): string {
  const mine = config?.template ?? "";
  if (mine.trim() === "") return `${SKIP_PLAN_PROMPT}\n${SKIP_PLAN_ANSWER}`;
  // The place as the player character knows it: a secret place's real name never reaches the prompt.
  const vars = safeVars({ world: world.name, pov: own(state.entities, world.pov)?.name ?? world.pov, place: povPlace(reg, world, state)?.name ?? "", clock: formatClock(calendarOf(world), from) }, unrevealedSecrets(reg, world, state));
  return `${renderTemplate(mine, vars)}\n${SKIP_PLAN_ANSWER}`;
}

export interface SkipPlanInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state the turn's plan starts from. */
  state: Readonly<WorldState>;
  intent: InterpretOutput;
  runSeed: string;
  /** The latest reply, and the Journal's recent lines (the chat's memory as the player may read it). */
  reply: string;
  journal: readonly string[];
  /** What minds read (Settings → Minds): the `skip` step's pins within its pinned lore limit, and Recent chat while it's on. */
  reads: MindsReads;
  hideJson: boolean;
  /** The engine run's clock, and the call's own limit (`skipPlanMs`). */
  signal: AbortSignal;
  limit: Limit;
  /** The time-skip step's own settings (connection, model, max tokens, sampling) and the preset's guidance for it: the plan is part of that step. */
  config: StepConfig | null;
  guidance: string;
}

export interface SkipPlanDeps {
  registry: Registry;
  steps: Steps;
  log: (message: string) => void;
  /** Where the lore pinned to the `skip` step and the recent chat come from (DESIGN §24.5). */
  host: Pick<HostPort, "books" | "log" | "chats">;
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
  // The `skip` step's pins, read as no one as the beats' call reads them, so a secret entry stays out.
  const pinned = pinnedLines({ reg: deps.registry, world: input.world, state: input.state, reads: input.reads, pinned: await readPins(deps.host, input.world, pinsFor(input.world, null, undefined, ["skip"]), input.userId) }, "skip");
  // Recent chat while minds read it: the chat before the skip's turn, less the latest reply the call
  // already reads, each line held to the same check as the journal's.
  const before = input.reads.history.on ? chatBefore(await deps.host.chats.messages(input.chatId, input.userId).catch(() => []), true) : [];
  const chat = recentChat({ reads: input.reads, hideJson: input.hideJson, history: told !== "" && before.at(-1)?.isUser === false ? before.slice(0, -1) : before }).filter(safe);
  const extra = [pinned.length > 0 ? `Pinned lore:\n${pinned.join("\n")}` : "", chat.length > 0 ? `Recent chat (as the player sees it):\n${chat.join("\n")}` : ""].filter((part) => part !== "");
  const signal = within(input.signal, "skipPlanMs", input.limit);
  const system = skipPlanSystem(deps.registry, input.world, input.state, from, input.config);
  const groups = routineSettingsOf(input.world).skipPlanCalls === "parallel" ? people.map((id) => [id]) : [people];
  // Each call is told only its own people; the calls run at once, each inside the same limit.
  const answers = await Promise.all(
    groups.map(async (group) => {
      const brief = skipPlanBrief(ctx, group, from, to);
      const failure = { reason: "" };
      // Spared: a failed plan leaves its people to their basic needs, and the skip runs without it.
      const raw = signal.aborted ? null : await deps.steps.helperJson("skip", system, [skipPlanText(ctx, brief, told, journal), ...extra].join("\n\n"), input.config, input.userId, signal, { failure, spared: true, guidance: input.guidance });
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
