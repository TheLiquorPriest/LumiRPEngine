// Written by `bun scripts/ui/pages.ts` from the modules of this folder, and again by the build: never by hand.
// Every section of the Turn page, in the order each declares.

import type { TurnSection } from "../types";
import { section as agentTokensSection } from "./agent-tokens";
import { section as askedSection } from "./asked";
import { section as continuedSection } from "./continued";
import { section as foundSection } from "./found";
import { section as frontSection } from "./front";
import { section as givenSection } from "./given";
import { section as intentSection } from "./intent";
import { section as lanesSection } from "./lanes";
import { section as lanesSummarySection } from "./lanes-summary";
import { section as marksSection } from "./marks";
import { section as openSection } from "./open";
import { section as perceptionsSection } from "./perceptions";
import { section as recordSection } from "./record";
import { section as replySection } from "./reply";
import { section as runsSection } from "./runs";
import { section as timingsSection } from "./timings";
import { section as tokensSection } from "./tokens";
import { section as toldSection } from "./told";
import { section as traceSection } from "./trace";
import { section as unsettledSection } from "./unsettled";
import { section as wholeSection } from "./whole";

export const TURN_SECTIONS: readonly TurnSection[] = [agentTokensSection, askedSection, continuedSection, foundSection, frontSection, givenSection, intentSection, lanesSection, lanesSummarySection, marksSection, openSection, perceptionsSection, recordSection, replySection, runsSection, timingsSection, tokensSection, toldSection, traceSection, unsettledSection, wholeSection].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
