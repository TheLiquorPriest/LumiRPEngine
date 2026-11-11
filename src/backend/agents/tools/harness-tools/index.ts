// The harness engine's own tools (HARNESS-SLICE3: "Agents RPEngine registers"), in the order the
// Prompts page lists their texts (`shared/harness-texts.ts`). They are given only through the harness
// (`tools/harness.ts`): none is among the tools a classic step or an agents-engine role is given
// (`TOOL_DEFINITIONS`), so those engines send and run exactly what they did.

import { CHECK_TOOLS } from "./checks";
import { FIGHT_TOOLS } from "./fight";
import { FILE_TOOLS } from "./files";
import type { HarnessToolDefinition } from "./kit";
import { KNOWLEDGE_TOOLS } from "./knowledge";
import { MIND_TOOLS } from "./minds";
import { PEOPLE_TOOLS } from "./people";
import { PLAY_TOOLS } from "./play";
import { STORY_TOOLS } from "./story";
import { SURFACE_TOOLS } from "./surfaces";
import { TIME_TOOLS } from "./time";
import { TURN_TOOLS } from "./turn";
import { WORLD_TOOLS } from "./world";
import { WORLD_BUILD_TOOLS } from "./world-build";

export type { HarnessToolDefinition } from "./kit";

export const HARNESS_TOOL_DEFINITIONS: readonly HarnessToolDefinition[] = [...MIND_TOOLS, ...KNOWLEDGE_TOOLS, ...CHECK_TOOLS, ...TIME_TOOLS, ...TURN_TOOLS, ...PLAY_TOOLS, ...FIGHT_TOOLS, ...FILE_TOOLS, ...PEOPLE_TOOLS, ...STORY_TOOLS, ...SURFACE_TOOLS, ...WORLD_TOOLS, ...WORLD_BUILD_TOOLS];
