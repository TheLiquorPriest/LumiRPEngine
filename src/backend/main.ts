// Starts the backend on the real host: every pack, the simulation pipeline, the spindle adapter,
// the runtime, the protocol dispatcher and the background lane's message route.

import { ALL_PACKS, STARTER_INFO, STARTER_WORLDS } from "../packs/index";
import { planTurn, postTurn } from "../engine/turn";
import { Dispatcher } from "./dispatch";
import { JobRunner } from "./jobs";
import { Runtime } from "./runtime";
import { createSpindleHost } from "./spindle-host";

export function startBackend(): Runtime {
  const host = createSpindleHost();
  const runtime = new Runtime({ host, packs: ALL_PACKS, pipeline: { plan: planTurn, post: postTurn }, templates: STARTER_WORLDS, templateInfo: STARTER_INFO });
  const jobs = new JobRunner(host, runtime.worlds, runtime.steps, runtime.settings, runtime.registry);
  runtime.start();
  new Dispatcher(runtime, jobs).start();
  host.processes.onMessage((event) => jobs.onLane(event.payload));
  host.log("info", `[LumiRPEngine] backend started with ${ALL_PACKS.length} packs`);
  return runtime;
}
