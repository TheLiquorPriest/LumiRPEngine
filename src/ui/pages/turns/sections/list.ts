// Written by `bun scripts/ui/pages.ts` from the modules of this folder, and again by the build: never by hand.
// Every section of the Turn page, in the order each declares.

import type { TurnSection } from "../types";
import { section as agentTokensSection } from "./agent-tokens";
import { section as givenSection } from "./given";
import { section as intentSection } from "./intent";
import { section as replySection } from "./reply";
import { section as runsSection } from "./runs";
import { section as timingsSection } from "./timings";
import { section as tokensSection } from "./tokens";
import { section as traceSection } from "./trace";

export const TURN_SECTIONS: readonly TurnSection[] = [agentTokensSection, givenSection, intentSection, replySection, runsSection, timingsSection, tokensSection, traceSection].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
