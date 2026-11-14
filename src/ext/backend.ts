// The light extension's backend entry (STANDALONE-PLAN §4.3). Lumiverse's worker sets the extension's
// API as the global `spindle` and then imports this module (`spindle/worker-runtime.ts:4693`, `:4718`).
// The global is declared here as core behaves (`spindle.ts`), not as the published types name it.

import type { ExtSpindle } from "./spindle";
import { startExtension } from "./start";

declare const spindle: ExtSpindle;

startExtension(spindle).catch((error: unknown) => spindle.log.error(`[RPE] the extension did not start: ${error instanceof Error ? error.message : String(error)}`));
