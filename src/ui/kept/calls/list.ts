// Written by `bun scripts/ui/calls.ts` from the call files in this folder, and again by the build: never by hand.
// Every call file of the kept views, in name order.

import type { CallFile } from "../client";
import { calls as jobsCalls } from "./jobs";
import { calls as mapCalls } from "./map";
import { calls as playCalls } from "./play";
import { calls as thingsCalls } from "./things";
import { calls as worldsCalls } from "./worlds";

export const CALLS: readonly CallFile[] = [jobsCalls, mapCalls, playCalls, thingsCalls, worldsCalls];
