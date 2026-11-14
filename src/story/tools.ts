// The story lane's tools as the host hands them to RPH (plan §6.8, Appendix A `ToolsPort`):
// `story_query` and `story_record`, each with its words from its file. The list depends on no turn,
// so it holds for a session; each call reads its user, chat and turn from its scope.

import type { HostTool } from "rp-harness/contract";
import { type StoryDeps, storyHostTool, storyLines, type StoryToolSpec } from "./kit";
import { STORY_QUERY } from "./query";
import { STORY_RECORD } from "./write";

export const STORY_TOOLS: readonly StoryToolSpec[] = [STORY_QUERY, STORY_RECORD];

/**
 * The story tools for a chat, as RPH holds them: each with its description and arguments' texts from
 * its file in `.tools/`, its answers worded from `.prompts/story-answers.md`. A tool whose file is
 * not in force for the chat (switched off) is not offered.
 */
export async function storyTools(deps: StoryDeps): Promise<HostTool[]> {
  const lines = await storyLines(deps.files);
  const out: HostTool[] = [];
  for (const spec of STORY_TOOLS) {
    const tool = await storyHostTool(spec, lines, deps);
    if (tool !== null) out.push(tool);
  }
  return out;
}
