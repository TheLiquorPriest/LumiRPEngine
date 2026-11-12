// The skills the harness engine ships (HARNESS-SLICE3: "Skills RPEngine ships (defaults,
// editable)"): how a kind of situation is usually handled, for an agent to load with LumiAH's
// `skill_load` when its description fits. Each skill's name, description and body is a registry text
// (`shared/harness-texts.ts`, the page "Harness engine"), so what an agent reads is the user's own
// wording where they wrote one. A skill is advice the agent may follow or not: no code reads one,
// and nothing a skill says happens unless the agent calls the tools for it.
//
// Each is offered only to the agents that hold every tool it names (`agents`: the author's own to
// the author, a character's to the character), and each is the engine's own (`owned`): its texts
// are edited on the engine's Prompts page, so a copy the user keeps of it in LumiAH is not used.

import { HARNESS_SKILL_AGENTS, HARNESS_TEXT } from "../../../shared/harness-texts";
import type { PromptTexts } from "../../../shared/prompts";
import { renderPrompt } from "../../prompts";
import type { Skill } from "../shapes";

/** The engine's skills in `texts`, in the order the Prompts page lists them. */
export function harnessSkills(texts: PromptTexts): Skill[] {
  return Object.entries(HARNESS_SKILL_AGENTS).map(([id, agents]): Skill => ({ id, name: renderPrompt(HARNESS_TEXT.skill(id, "name"), texts, {}), description: renderPrompt(HARNESS_TEXT.skill(id, "description"), texts, {}), body: renderPrompt(HARNESS_TEXT.skill(id, "body"), texts, {}), agents: [...agents], owned: true }));
}
