// Playtest and Check world (DESIGN §9.6; PlanChatUI-B2): the pure engine played over a world's head revision on RPE's worker threads
// (`app.workers`, the tasks `labStep` and `labLint`, whose functions are `src/worker/background-lane.ts`). The opening state is the one RPE's
// store makes of the revision (`initialStoreState`, the state a chat starts from); each step is one typed turn or one simulated day on a thread,
// handed its predecessor's state, so progress is told after each, a cancel stops the next, and no turn of a chat waits on it. No model is called.

import type { Workers } from "../../app/workers/pool";
import type { Store } from "../../store";
import { initialStoreState } from "../../store/fold";
import type { JsonObject } from "../../shared/json";
import type { LintIssue } from "../../shared/lint";
import type { PlaytestTurn } from "../../engine/authoring";
import type { WorldService } from "../../worlds/service";
import { JobError, type JobRunner } from "./home";

export interface LabDeps {
  worlds: WorldService;
  store: Store;
  workers: Pick<Workers, "run">;
}

/** The runners of the two kinds that need no model. */
export function labRunners(deps: LabDeps): { playtest: JobRunner; check_world: JobRunner } {
  /** One lab job: the revision it plays, from its opening state, a step at a time. */
  const play = async (kind: "playtest" | "check_world", job: Parameters<JobRunner["run"]>[0], count: number, text: (i: number) => string): ReturnType<JobRunner["run"]> => {
    const read = await deps.worlds.read(job.user, job.world);
    const opening = initialStoreState(deps.store.env, read.revision);
    if (opening === null) throw new Error(`the world's revision ${read.revision} is not one RPE holds`);
    let state = opening.world;
    const turns: PlaytestTurn[] = [];
    const runSeed = kind === "playtest" ? `playtest:${job.id}` : `check:${read.revision}`;
    for (let index = 0; index < count; index++) {
      if (job.signal.aborted) return { result: { turns: [], lint: [] } };
      const out = await deps.workers.run("labStep", { kind, world: read.world, state, index, runSeed, ...(kind === "playtest" ? { text: text(index) } : {}) });
      state = out.state;
      turns.push(out.turn);
      job.report((index + 1) / count);
    }
    const lint: LintIssue[] = await deps.workers.run("labLint", read.world);
    return { result: { turns, lint } };
  };
  return {
    playtest: {
      bound(input, limits): JsonObject {
        const turns = (Array.isArray(input.turns) ? input.turns.filter((t): t is string => typeof t === "string") : []).slice(0, limits.turns).map((t) => t.slice(0, limits.turnChars));
        if (turns.length === 0) throw new JobError("bad_request", "a playtest needs at least one typed turn");
        return { turns };
      },
      run: (job) => play("playtest", job, (job.input.turns as string[]).length, (i) => (job.input.turns as string[])[i] ?? ""),
    },
    check_world: {
      bound(input, limits): JsonObject {
        const asked = typeof input.days === "number" && Number.isFinite(input.days) ? Math.floor(input.days) : limits.days;
        return { days: Math.max(1, Math.min(limits.daysMost, asked)) };
      },
      run: (job) => play("check_world", job, job.input.days as number, () => ""),
    },
  };
}
