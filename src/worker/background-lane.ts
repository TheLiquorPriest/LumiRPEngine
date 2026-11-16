// The kept worker (DESIGN §9.6; PlanChatUI-B2): Build's Playtest and Check world, played by the pure engine on one of RPE's worker threads
// (`app.workers`, the tasks `labStep` and `labLint` of `src/app/workers/tasks.ts`), never on the thread that serves a request and
// never as a turn of a chat: each step is one typed turn of Playtest or one simulated day of Check world, from the state the step is handed,
// and the job (`build/jobs/lab.ts`) hands each its predecessor's state, so a step is short, progress is told after each and a cancel stops
// the next one. No model is called; the engine reads no clock of its own, so a Check world day's processes are timed here, by the wall clock.

import type { LintIssue } from "../shared/protocol";
import { checkWorldDay, lintWorld, playtestTurn, type PlaytestTurn } from "../engine/authoring";
import { createRegistry, type Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { planTurn, postTurn, timelapseIntent } from "../engine/turn";
import { ALL_PACKS } from "../packs/index";
import type { WorldDoc } from "../shared/world";

/** One step of a lab job: the world as committed, the state it begins from, which step it is, and what a Playtest turn typed. */
export interface LabStepInput {
  kind: "playtest" | "check_world";
  world: WorldDoc;
  state: WorldState;
  index: number;
  runSeed: string;
  /** Playtest: the typed turn. */
  text?: string;
}

export interface LabStepOutput {
  state: WorldState;
  turn: PlaytestTurn;
}

const pipeline = { plan: planTurn, post: postTurn };

let registry: Registry | null = null;

/** The shipped packs' registry, made once on each thread that plays a step. */
function registryOf(): Registry {
  registry ??= createRegistry(ALL_PACKS);
  return registry;
}

/** One typed turn of Playtest, or one simulated day of Check world with every interrupt class at `note` so each day runs whole. */
export function labStep(input: LabStepInput): LabStepOutput {
  const reg = registryOf();
  if (input.kind === "playtest") {
    const step = playtestTurn(reg, pipeline, input.world, input.state, input.text ?? "", input.runSeed, input.index);
    return { state: step.state, turn: step.turn };
  }
  const overrides: Record<string, string> = {};
  for (const id of Object.keys(input.world.time.interrupts)) overrides[id] = "note";
  const intent = timelapseIntent({ type: "duration", minutes: 24 * 60 }, overrides);
  // The wall clock times each day's processes (the engine reads none of its own).
  const step = checkWorldDay(reg, pipeline, input.world, input.state, input.runSeed, input.index, intent, { clock: () => performance.now() });
  return { state: step.state, turn: step.turn };
}

/** The lint of the world a lab job ran on, which ends its result. */
export function labLint(world: WorldDoc): LintIssue[] {
  return lintWorld(world, registryOf());
}
