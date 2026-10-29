// The read families (AGENT-LOOP-PLAN §6's table; INC1-SPEC R3a), in the order their texts list them
// (`shared/agent-tools-read.ts`). Each answers through the agent's `ToolReadView` only.

import type { ToolDefinition } from "../registry";
import { CHECKS_TOOLS } from "./checks";
import { ITEMS_TOOLS } from "./items";
import { KNOWLEDGE_TOOLS } from "./knowledge";
import { MINDS_TOOLS } from "./minds";
import { MONEY_TOOLS } from "./money";
import { PEOPLE_TOOLS } from "./people";
import { PLACES_TOOLS } from "./places";
import { QUESTS_TOOLS } from "./quests";
import { TIME_TOOLS } from "./time";

export const READ_TOOLS: readonly ToolDefinition[] = [...PEOPLE_TOOLS, ...PLACES_TOOLS, ...ITEMS_TOOLS, ...MONEY_TOOLS, ...QUESTS_TOOLS, ...KNOWLEDGE_TOOLS, ...TIME_TOOLS, ...CHECKS_TOOLS, ...MINDS_TOOLS];
