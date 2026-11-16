// The engine's tools as the host hands them to RPH (plan §6.8, Appendix A `ToolsPort`): the four
// fixed tools and the searchable ones, each with its words from its file. The list depends on no
// turn, so it holds for a session; each call reads its chat and turn from its scope.

import type { HostTool } from "rp-harness/contract";
import { JoinedTurnError } from "../store/types";
import { readPart } from "../store/words";
import { WORLD_APPLY } from "./apply";
import { ROLL, WORLD_QUERY, WORLD_SEARCH } from "./fixed";
import { ANSWERS_PART, type AreaWords, areaTools, type Call, type EngineDeps, IFACE_DEFAULTS, type IfaceSettings, type ToolSpec, type Words } from "./kit";
import { MAP_TOOLS } from "./maptools";
import { saysUnreadable, ScopeError } from "./reading";
import { SEARCHABLE_TOOLS } from "./searchable";
import { Lines } from "./texts";

export { ANSWERS_PART };

/** The prompt part that words the world's tree wherever it is shown: the world state, and `world_query`. */
export const TREE_PART = "world-state";

/** The four tools an agent's definition lists to hold them fixed: the state family. */
export const FIXED_TOOLS: readonly ToolSpec[] = [WORLD_QUERY, WORLD_SEARCH, WORLD_APPLY, ROLL];

/** Every tool the engine registers, fixed first. */
export const ENGINE_TOOLS: readonly ToolSpec[] = [...FIXED_TOOLS, ...SEARCHABLE_TOOLS, ...MAP_TOOLS];

/** The answers' lines in force for the chat; none when the part is switched off, so every answer is given with no words. */
export async function answerLines(deps: Pick<EngineDeps, "files">): Promise<Lines> {
  const text = await deps.files.read("prompts", ANSWERS_PART);
  return text === undefined ? Lines.none() : Lines.parse(text, `.prompts/${ANSWERS_PART}.md`);
}

/** The words of every answer in force for the chat: the answers' lines, and the tree's part (switched off, the tree is shown with no words). */
export async function answerWords(deps: Pick<EngineDeps, "files">): Promise<Words> {
  const tree = await deps.files.read("prompts", TREE_PART);
  return { lines: await answerLines(deps), tree: readPart(tree ?? "", `.prompts/${TREE_PART}.md`) };
}

/**
 * The engine's tools for a chat, as RPH holds them: each with its description and arguments' texts
 * from its file in `.tools/`, its answers worded from `.prompts/engine-answers.md`, and the tree it
 * shows worded by `.prompts/world-state.md`. A tool whose file is not in force for the chat
 * (switched off) is not offered. Each call works on the chat and the turn its scope names, and
 * records through the write queue.
 */
export async function engineTools(deps: EngineDeps): Promise<HostTool[]> {
  const words = await answerWords(deps);
  const settings: IfaceSettings = { ...IFACE_DEFAULTS, ...(deps.settings ?? {}) };
  const area: AreaWords<Call> = {
    part: ANSWERS_PART,
    lines: words.lines,
    ...(deps.lastUse !== undefined ? { lastUse: deps.lastUse } : {}),
    failed: (fault) => deps.env.failed?.(fault),
    call: (base) => ({ ...base, deps, settings, tree: words.tree }),
    // A scope found unreadable while the call ran (a turn joined to another in between) is told as the fact.
    told: (error, call) => {
      if (error instanceof ScopeError) return saysUnreadable(call.reply(), error.why);
      if (error instanceof JoinedTurnError) return saysUnreadable(call.reply(), { missing: "joined", id: error.turn, into: error.joined });
      return undefined;
    },
  };
  return areaTools(ENGINE_TOOLS, deps.files, area);
}
