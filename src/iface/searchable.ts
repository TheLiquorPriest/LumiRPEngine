// The searchable tools (plan §6.8): the long tail of today's engine tools, which RPH's `tool_search`
// finds by words and its `tool_use` calls. Each keeps today's name and today's logic, and says what
// it reads or writes and its lane. They are added family by family (`families/`).

import type { ToolSpec } from "./kit";
import { BUSINESS_TOOLS } from "./families/business";
import { CALENDAR_TOOLS } from "./families/calendar";
import { CARRIED_TOOLS } from "./families/carried";
import { CHECK_TOOLS } from "./families/checks";
import { FIGHT_TOOLS } from "./families/fights";
import { GROUP_TOOLS } from "./families/groups";
import { MONEY_TOOLS } from "./families/money";
import { NOTE_TOOLS } from "./families/notes";
import { PEOPLE_TOOLS } from "./families/people";
import { PLACE_TOOLS } from "./families/places";
import { READ_TOOLS } from "./families/reads";
import { ROUND_TOOLS } from "./families/rounds";
import { THING_TOOLS } from "./families/things";
import { TIME_TOOLS } from "./families/time";
import { TOTALS_TOOLS } from "./families/totals";
import { UPKEEP_TOOLS } from "./families/upkeep";
import { VEHICLE_TOOLS } from "./families/vehicles";

export const SEARCHABLE_TOOLS: readonly ToolSpec[] = [...THING_TOOLS, ...MONEY_TOOLS, ...BUSINESS_TOOLS, ...TIME_TOOLS, ...TOTALS_TOOLS, ...CALENDAR_TOOLS, ...GROUP_TOOLS, ...FIGHT_TOOLS, ...ROUND_TOOLS, ...VEHICLE_TOOLS, ...UPKEEP_TOOLS, ...PEOPLE_TOOLS, ...CHECK_TOOLS, ...NOTE_TOOLS, ...READ_TOOLS, ...PLACE_TOOLS, ...CARRIED_TOOLS];
