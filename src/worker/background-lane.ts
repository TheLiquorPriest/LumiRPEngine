// The background lane (DESIGN §9.6): a child process for Playtest and Check world. It heartbeats
// between steps so the host watchdog (15 s) never fires, and reports progress and the result to
// the parent. The work itself is the pure authoring module the studio seam also uses.

import type { SpindleBackendProcessContext } from "lumiverse-spindle-types";
import { isRecord } from "../shared/json";
import { checkWorldDay, isWorldDoc, lintWorld, playtestStart, playtestTurn, type PlaytestStep, type PlaytestTurn } from "../engine/authoring";
import { createRegistry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { planTurn, postTurn, timelapseIntent } from "../engine/turn";
import { ALL_PACKS } from "../packs/index";

/** Check world runs at most this many simulated days. */
export const CHECK_MAX_DAYS = 14;

export default function run(proc: SpindleBackendProcessContext): void {
  proc.ready();
  let stopped = false;
  proc.onStop(() => {
    stopped = true;
    proc.complete();
  });
  const p = proc.payload;
  if (!isRecord(p) || typeof p.jobId !== "string" || !isWorldDoc(p.world) || typeof p.revision !== "string") {
    proc.fail("bad lane payload");
    return;
  }
  const jobId = p.jobId;
  const world = p.world;
  const runSeed = typeof p.runSeed === "string" ? p.runSeed : jobId;
  const registry = createRegistry(ALL_PACKS);
  const pipeline = { plan: planTurn, post: postTurn };
  let step: (state: WorldState, i: number) => PlaytestStep;
  let count: number;
  if (p.kind === "check_world") {
    // Every interrupt class at `note`, so each day runs whole.
    const overrides: Record<string, string> = {};
    for (const id of Object.keys(world.time.interrupts)) overrides[id] = "note";
    const intent = timelapseIntent({ type: "duration", minutes: 24 * 60 }, overrides);
    count = Math.max(1, Math.min(CHECK_MAX_DAYS, typeof p.days === "number" ? Math.floor(p.days) : 3));
    step = (state, i) => checkWorldDay(registry, pipeline, world, state, runSeed, i, intent);
  } else {
    const turns = Array.isArray(p.turns) ? p.turns.filter((t): t is string => typeof t === "string") : [];
    count = turns.length;
    step = (state, i) => playtestTurn(registry, pipeline, world, state, turns[i] ?? "", runSeed, i);
  }
  let state = playtestStart(registry, world, p.revision);
  const out: PlaytestTurn[] = [];
  const next = (i: number): void => {
    if (stopped) return;
    if (i >= count) {
      proc.send({ jobId, done: true, result: { turns: out, lint: lintWorld(world, registry) } });
      proc.complete();
      return;
    }
    try {
      const result = step(state, i);
      state = result.state;
      out.push(result.turn);
      proc.heartbeat();
      proc.send({ jobId, progress: (i + 1) / count });
      setTimeout(() => next(i + 1), 0);
    } catch (error) {
      proc.send({ jobId, error: error instanceof Error ? error.message : String(error) });
      proc.fail(error instanceof Error ? error.message : String(error));
    }
  };
  next(0);
}
