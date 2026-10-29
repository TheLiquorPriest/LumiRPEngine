// The GM-tier write families (AGENT-LOOP-PLAN §6's table; INC1-SPEC R3b), in the order their texts
// list them (`shared/agent-tools-write.ts`). Each only proposes its change (`tools/propose.ts`).

import type { ToolDefinition } from "../registry";
import { ITEMS_WRITES } from "./items";
import { KNOWLEDGE_WRITES } from "./knowledge";
import { MINDS_WRITES } from "./minds";
import { MONEY_WRITES } from "./money";
import { PEOPLE_WRITES } from "./people";
import { PLACES_WRITES } from "./places";
import { QUESTS_WRITES } from "./quests";
import { TIME_WRITES } from "./time";

export const WRITE_TOOLS: readonly ToolDefinition[] = [...PEOPLE_WRITES, ...PLACES_WRITES, ...ITEMS_WRITES, ...MONEY_WRITES, ...QUESTS_WRITES, ...KNOWLEDGE_WRITES, ...MINDS_WRITES, ...TIME_WRITES];
