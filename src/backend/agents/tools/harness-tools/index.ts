// The harness engine's own tools (HARNESS-SLICE3: "Agents RPEngine registers"), in the order the
// Prompts page lists their texts (`shared/harness-texts.ts`). They are given only through the harness
// (`tools/harness.ts`): none is among the tools a classic step or an agents-engine role is given
// (`TOOL_DEFINITIONS`), so those engines send and run exactly what they did.

import { CHECK_TOOLS } from "./checks";
import { FIGHT_TOOLS } from "./fight";
import type { HarnessToolDefinition } from "./kit";
import { PEOPLE_TOOLS } from "./people";
import { PLAY_TOOLS } from "./play";
import { STORY_TOOLS } from "./story";
import { PREPARE_TOOLS } from "./story-prepare";
import { RECORD_TOOLS } from "./story-record";
import { MIND_FILE_TOOLS } from "./story-minds";
import { STAGE_TOOLS } from "./story-stage";
import { SURFACE_TOOLS } from "./surfaces";
import { TIME_TOOLS } from "./time";
import { TURN_TOOLS } from "./turn";
import { WORLD_TOOLS } from "./world";
import { WORLD_BUILD_TOOLS } from "./world-build";

export type { HarnessToolDefinition } from "./kit";

export const HARNESS_TOOL_DEFINITIONS: readonly HarnessToolDefinition[] = [...CHECK_TOOLS, ...TIME_TOOLS, ...TURN_TOOLS, ...PLAY_TOOLS, ...FIGHT_TOOLS, ...MIND_FILE_TOOLS, ...PEOPLE_TOOLS, ...STORY_TOOLS, ...SURFACE_TOOLS, ...WORLD_TOOLS, ...WORLD_BUILD_TOOLS, ...RECORD_TOOLS, ...STAGE_TOOLS, ...PREPARE_TOOLS];
