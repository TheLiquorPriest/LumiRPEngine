// The turn probe's entry (the probe is `turn-parts-run.ts`): a turn's parts timed on copies of a user's RPE data, with no network.
//
//   bun build scripts/perf/turn-parts.ts --target bun --outfile turn-parts.js
//   RPE_GUIDANCE_DIR=<this build's guidance/> bun turn-parts.js <copy of rpe.db> <copy of files/> <copy of the index file> <Lumiverse's database> <chat id> <build id>

import { ON_WORKER_THREAD } from "../../src/app/workers/pool";

// A worker thread RPE starts runs this file too, and serves its tasks there (`workers/pool.ts`); the probe runs on the main thread
// alone, so it is imported only there, as `src/app/main.ts` imports the application: a static import would run it on every thread.
if (!ON_WORKER_THREAD) await import("./turn-parts-run");
