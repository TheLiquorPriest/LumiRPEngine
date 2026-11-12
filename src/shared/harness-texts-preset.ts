// What LumiRPEngine says to a model about the chat's preset on the harness engine (DEPTH2-PLAN §7,
// `backend/story/preset.ts`): the author's list of the presentation modules it can call for, and
// the answer when a module asked for is none of the preset's. Registry texts of the page "Harness
// engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_GROUP, HARNESS_PAGE, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The texts, by id. */
export const PRESET_NOTE = {
  modules: "harness.preset.modules",
  noModule: "harness.preset.no_module",
} as const;

export const PRESET_NOTE_PROMPTS: readonly PromptDef[] = [
  {
    id: PRESET_NOTE.modules,
    page: HARNESS_PAGE.id,
    group: HARNESS_GROUP.guidance,
    label: "The presentation modules",
    note: "Ends the author's part of the chat's preset when the preset has presentation modules: each module's name and what it is for.",
    text: "Presentation modules: ways to show part of a passage beyond prose, such as a phone screen or a chapter header. The narrator uses one only when you name it for that passage, exactly as it is listed here.\n{{modules}}",
    vars: [v("modules", "each module on a line of its own: its name, then what it is for", true)],
  },
  answerPrompt(PRESET_NOTE.noModule, "No such presentation module", "The answer when a passage asks for a presentation module the chat's preset doesn't have.", "There is no presentation module called {{names}}. The modules are: {{modules}}.", [v("names", "the names asked for that are no module", true), v("modules", "every module's name, or none")]),
];
