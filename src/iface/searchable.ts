// The searchable tools (plan §6.8): the long tail of today's engine tools, which RPH's `tool_search`
// finds by words and its `tool_use` calls. Each keeps today's name and today's logic, and says what
// it reads or writes and its lane. They are added family by family (`families/`).

import type { ToolSpec } from "./kit";
import { CHECK_TOOLS } from "./families/checks";
import { FIGHT_TOOLS } from "./families/fights";
import { GROUP_TOOLS } from "./families/groups";
import { MONEY_TOOLS } from "./families/money";
import { PEOPLE_TOOLS } from "./families/people";
import { THING_TOOLS } from "./families/things";
import { TIME_TOOLS } from "./families/time";
import { VEHICLE_TOOLS } from "./families/vehicles";

export const SEARCHABLE_TOOLS: readonly ToolSpec[] = [...THING_TOOLS, ...MONEY_TOOLS, ...TIME_TOOLS, ...GROUP_TOOLS, ...FIGHT_TOOLS, ...VEHICLE_TOOLS, ...PEOPLE_TOOLS, ...CHECK_TOOLS];
