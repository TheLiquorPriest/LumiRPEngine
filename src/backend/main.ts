// Starts the backend on the real host: every pack, the simulation pipeline, the spindle adapter,
// the runtime, the protocol dispatcher, the background lane's message route and the memory budget.

import { ALL_PACKS, STARTER_INFO, STARTER_WORLDS } from "../packs/index";
import { planTurn, postTurn } from "../engine/turn";
import { Dispatcher } from "./dispatch";
import { JobRunner } from "./jobs";
import { watchMemory } from "./memory-budget";
import { Runtime } from "./runtime";
import { createSpindleHost } from "./spindle-host";

export function startBackend(): Runtime {
  const host = createSpindleHost();
  const runtime = new Runtime({ host, packs: ALL_PACKS, pipeline: { plan: planTurn, post: postTurn }, templates: STARTER_WORLDS, templateInfo: STARTER_INFO });
  const jobs = new JobRunner(host, runtime.worlds, runtime.steps, runtime.settings, runtime.registry);
  runtime.start();
  new Dispatcher(runtime, jobs).start();
  host.processes.onMessage((event) => jobs.onLane(event.payload));
  // The host gives no sign of memory pressure: the engine minds its own RSS (DESIGN §9.6).
  const probe = {
    rss: () => process.memoryUsage.rss(),
    // On a fresh stack: a collection inside a read's would keep what that stack still holds.
    collect: () => {
      setTimeout(() => Bun.gc(true), 0);
    },
  };
  watchMemory(runtime, probe, (line) => host.log("info", `[LumiRPEngine] ${line}`));
  host.log("info", `[LumiRPEngine] backend started with ${ALL_PACKS.length} packs`);
  return runtime;
}
