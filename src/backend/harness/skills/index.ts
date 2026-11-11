// The skills the harness engine ships (HARNESS-SLICE3: "Skills RPEngine ships (defaults,
// editable)"): how a kind of situation is usually handled, for the author to load with LumiAH's
// `skill_load` when its description fits. Each skill's name, description and body is a registry text
// (`shared/harness-texts.ts`, the page "Harness engine"), so what the author reads is the user's own
// wording where they wrote one. A skill is advice the author may follow or not: no code reads one,
// and nothing a skill says happens unless the author calls the tools for it.

import { HARNESS_SKILL_IDS, HARNESS_TEXT } from "../../../shared/harness-texts";
import type { PromptTexts } from "../../../shared/prompts";
import { renderPrompt } from "../../prompts";
import type { Skill } from "../shapes";

/** The engine's skills in `texts`, in the order the Prompts page lists them. */
export function harnessSkills(texts: PromptTexts): Skill[] {
  return HARNESS_SKILL_IDS.map((id): Skill => ({ id, name: renderPrompt(HARNESS_TEXT.skill(id, "name"), texts, {}), description: renderPrompt(HARNESS_TEXT.skill(id, "description"), texts, {}), body: renderPrompt(HARNESS_TEXT.skill(id, "body"), texts, {}) }));
}
