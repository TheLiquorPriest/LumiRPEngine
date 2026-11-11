// What the harness engine's text files share (`harness-texts.ts` and the `harness-texts-*.ts` beside
// it, one for each family of tools): the page its texts are listed on, the groups of that page, a
// tool's texts as shipped, and how a tool's texts and a tool's answers become registry texts. Kept
// apart so that a family's file reads nothing of the file that gathers them all.

import { toolArgTextId, toolTextId } from "./agent-tools";
import type { PromptDef, PromptPage, PromptVar } from "./prompts";

export const HARNESS_PAGE: PromptPage = {
  id: "harness",
  label: "Harness engine",
  note: "What a chat on the harness engine sends its agents (GM → This chat → Engine): each agent's name, what it is for and its instructions; the skills the author may load; the world's guidance and the line each of its settings adds to it; and the harness engine's own tools with what they answer. The classic and agents engines send none of these.",
};

/** The groups the page lists its texts under. */
export const HARNESS_GROUP = { agents: "Agents", skills: "Skills", guidance: "World guidance", tools: "Tools", answers: "Tool answers" } as const;

/**
 * The families the harness engine's own tools sit in, beside the engine's families
 * (`ToolFamily`): a definition is given a whole family as `@<family>`. A person's own mind's tools
 * are a family of their own (`mind`), apart from the tools that read and edit minds as the game
 * master does (`minds`), so the author can be given every family but that one. `world` is the
 * world's document as Build edits it, and `fights` a fight's rounds.
 */
export const HARNESS_FAMILY = {
  mind: "mind",
  knowledge: "knowledge",
  checks: "checks",
  time: "time",
  turn: "turn",
  world: "world",
  fights: "fights",
  people: "people",
  places: "places",
  items: "items",
  money: "money",
  lore: "lore",
} as const;

/** What approval is decided by on the harness: a tool that changes nothing, or one that changes what the engine keeps. */
export type HarnessToolTier = "read" | "write";

/** One of the harness engine's own tools as shipped: its family and tier, a line for the Prompts page, its description (`tool.<name>`) and each argument's (`tool.<name>.<path>`). */
export interface HarnessToolText {
  name: string;
  family: string;
  tier: HarnessToolTier;
  note: string;
  text: string;
  args: readonly { path: string; text: string }[];
}

/** A placeholder of a text: `required` when the text says nothing without it. */
export const v = (name: string, text: string, required?: true): PromptVar => (required ? { name, text, required } : { name, text });

/** Lines as one text. */
export const lines = (...parts: readonly string[]): string => parts.join("\n");

const TOOL_TIER_NOTE: Readonly<Record<HarnessToolTier, string>> = { read: "reads only", write: "a change, checked by the engine" };

/** The registry texts of `tools`: each one's description, then each of its arguments'. */
export function toolPrompts(tools: readonly HarnessToolText[]): PromptDef[] {
  const page = HARNESS_PAGE.id;
  return tools.flatMap((t): PromptDef[] => [
    { id: toolTextId(t.name), page, group: HARNESS_GROUP.tools, label: `${t.name}: what it does`, note: `${t.note} Harness engine only; ${TOOL_TIER_NOTE[t.tier]}.`, text: t.text, vars: [] },
    ...t.args.map((a): PromptDef => ({ id: toolArgTextId(t.name, a.path), page, group: HARNESS_GROUP.tools, label: `${t.name}: ${a.path}`, note: `The description of ${t.name}'s ${a.path} argument.`, text: a.text, vars: [] })),
  ]);
}

/** One answer of a harness tool as a registry text: `label` names it on the page, `note` says when it is given. */
export function answerPrompt(id: string, label: string, note: string, text: string, vars: readonly PromptVar[] = []): PromptDef {
  return { id, page: HARNESS_PAGE.id, group: HARNESS_GROUP.answers, label, note, text, vars: [...vars] };
}
