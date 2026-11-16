// Written by `bun scripts/ui/calls.ts` from the call files in this folder, and again by the build: never by hand.
// Every call file of the kept views, in name order.

import type { CallFile } from "../client";
import { calls as playCalls } from "./play";
import { calls as thingsCalls } from "./things";

export const CALLS: readonly CallFile[] = [playCalls, thingsCalls];
