// The cast's tools as the host hands them to RPH (plan §6.8, Appendix A `ToolsPort`): `cast_query`
// and `cast_update` for the omniscient side, `perceive`, and the character's own memory actions,
// each with its words from its file. Which agent holds which is its definition's tool list. The list
// depends on no turn, so it holds for a session; each call reads its user, chat and turn from its
// scope, and a memory action its character from the agent that calls it.

import type { HostTool } from "rp-harness/contract";
import { type CastDeps, castHostTool, castLines, type CastToolSpec } from "./kit";
import { DREAM, RECALL, REFLECT, REMEMBER } from "./memories";
import { PERCEIVE } from "./perceive";
import { CAST_QUERY } from "./query";
import { CAST_UPDATE } from "./update";

export const CAST_TOOLS: readonly CastToolSpec[] = [CAST_QUERY, CAST_UPDATE, PERCEIVE, RECALL, REMEMBER, REFLECT, DREAM];

/**
 * The cast's tools for a chat, as RPH holds them: each with its description and arguments' texts
 * from its file in `.tools/`, its answers worded from `.prompts/cast-answers.md`. A tool whose file
 * is not in force for the chat (switched off) is not offered.
 */
export async function castTools(deps: CastDeps): Promise<HostTool[]> {
  const lines = await castLines(deps.files);
  const out: HostTool[] = [];
  for (const spec of CAST_TOOLS) {
    const tool = await castHostTool(spec, lines, deps);
    if (tool !== null) out.push(tool);
  }
  return out;
}
