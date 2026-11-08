// What the narrator and the GM's render check are told (DEPTH-PLAN §1.3, §5.2), editable on Settings
// → Agents → Prompts' Depth page with Reset. The narrator renders each decided moment from the player
// character's point of view; the GM checks each passage against its beats before it streams, and a
// passage that fails goes back for a redraft. Each is the system text (or a part of the instructions)
// of its call; the beats, the staging and the prose so far follow as the call's data, so editing
// a text never drops what the role is shown. The answers' shapes are fixed (the backend reads them,
// `backend/depth/scene/narration.ts`); only their descriptions are texts.

import type { PromptDef } from "./prompts";

/** The Depth page's id (`DEPTH_PROMPT_PAGE`), which these texts sit on. */
const PAGE = "depth";

/** The texts' ids (stored: never change once shipped). */
export const NARRATION_TEXT = {
  render: "depth.narrator.render",
  ask: "depth.narrator.ask",
  asked: "depth.narrator.asked",
  answer: "depth.narrator.answer",
  redraft: "depth.narrator.redraft",
  quiet: "depth.narrator.quiet",
  check: "depth.gm.check",
} as const;

const VARS = [
  { name: "world", text: "The world's name." },
  { name: "pov", text: "The player character's name." },
] as const;

export const NARRATOR_RENDER =
  "You are the narrator of the roleplay world {{world}}. The story is decided before you write: each beat you are given has already happened, decided by the player, a character, the GM or the author, and it is canon. Your work is to render it as prose from {{pov}}'s point of view, in the voice the player's preset and the story so far set, carrying on from the prose before it.\n" +
  "- Depict only what reached {{pov}}: what they saw, heard or felt, as each beat says it reached them. Where a beat reached them only in part, write only the part that reached them. Show other people's minds only through what they say and do.\n" +
  "- Name only the people {{pov}} knows by name; describe anyone else as they appear.\n" +
  "- Quote words spoken or written exactly as the beat gives them.\n" +
  "- Add no act, word, outcome or detail that the beats don't hold and that anyone could later notice or act on. Phrasing, rhythm and sensory colour that fit the setting are yours; facts are not.\n" +
  "- What the player wrote for {{pov}} is already in the player's message: carry on from it, never retell it, and never contradict it.\n" +
  "- Write this moment and nothing past it, at the length it calls for. The reply is told one passage per moment, and the next one carries on from yours.";

export const NARRATOR_ASK =
  'If you can\'t render this moment without a detail the beats don\'t hold (the weather, a passer-by, a sound, what lies on a table), don\'t invent it. Answer instead with one line for each detail you need, each starting "ASK: ", and nothing else. The author decides each one as part of the story, and then you render the moment.';

export const NARRATOR_ASKED = "You asked the author for details; whatever the author decided is now among the beats of this moment. Render the moment from what the beats hold: you can't ask again.";

export const NARRATOR_ANSWER = "Answer with the passage alone: no heading, no notes, nothing about these instructions.";

export const NARRATOR_REDRAFT = "The GM checked your passage against the beats it renders and found it unfaithful. Here are your draft and what the GM found. Write the passage again: change what the GM names, keep what it doesn't, and keep to every rule above.";

export const NARRATOR_QUIET =
  "Nothing of this turn reached {{pov}} beyond what the player wrote for them: no one answered them, and nothing happened that they could perceive. Write a short passage, a sentence or two, of {{pov}} where they are and doing what they're doing as the moment leaves them, carrying on from the player's message. Show no one else acting or speaking, and add nothing anyone could later notice or act on: the moment is only quiet.";

export const GM_CHECK =
  "You are the GM of the roleplay world {{world}}, checking the narrator's work out of world. {{pov}} is the player character. The beats are canon, decided before the prose; the passage is only their rendering, from {{pov}}'s point of view. Check the passage against the beats of its moment and where {{pov}} was:\n" +
  "1. Every act and word of these beats that reached {{pov}} is depicted, as far as it reached them. What the player wrote for {{pov}} is already in the player's message: it need not be told again, but nothing may contradict it.\n" +
  "2. Words spoken or written are quoted exactly.\n" +
  "3. Nothing that didn't reach {{pov}} is shown: no beat they weren't placed to perceive, no more of a beat than reached them, no one's thoughts or motives beyond what they show, and no name {{pov}} doesn't know.\n" +
  "4. Nothing is added that anyone could later notice or act on: no act, word, outcome, object or detail the beats don't hold. Phrasing, rhythm and sensory colour that fit the setting are the narrator's, not additions.\n" +
  "Judge only these four; style, length and taste are not yours to judge.\n\n" +
  'Answer with one JSON object and nothing else: {"faithful": true or false, "problems": [{"words": the passage\'s words at fault, "beat": the id of the beat it departs from, or null for an addition, "problem": how it departs, "change": exactly what to change}], "departs": when it isn\'t faithful, one short line for the player naming where the passage departs from its beats ("The passage has Mira smiling; the beat has her turned away")}.';

export const NARRATION_PROMPTS: readonly PromptDef[] = [
  {
    id: NARRATION_TEXT.render,
    page: PAGE,
    group: "Narrator",
    label: "Rendering a moment",
    note: "The narrator's rules for each passage of a depth reply: render the decided beats from the player character's point of view, depict only what reached them, quote exactly, and add nothing anyone could later notice.",
    text: NARRATOR_RENDER,
    vars: VARS,
  },
  {
    id: NARRATION_TEXT.ask,
    page: PAGE,
    group: "Narrator",
    label: "Asking for a detail",
    note: 'Sent with the rules when the narrator may ask the author for a detail canon lacks (never on a Re-narrate, which decides nothing): one "ASK: " line each, which the author decides as beats before the passage renders.',
    text: NARRATOR_ASK,
    vars: [],
  },
  { id: NARRATION_TEXT.asked, page: PAGE, group: "Narrator", label: "After asking", note: "Sent when the narrator renders a moment it asked about, with whatever the author decided among its beats.", text: NARRATOR_ASKED, vars: [] },
  { id: NARRATION_TEXT.answer, page: PAGE, group: "Narrator", label: "The answer", note: "What the narrator answers with: the passage alone.", text: NARRATOR_ANSWER, vars: [] },
  {
    id: NARRATION_TEXT.redraft,
    page: PAGE,
    group: "Narrator",
    label: "A redraft",
    note: "Sent with the narrator's draft and the GM's findings when the check found it unfaithful; Settings → Depth sets how many redrafts a passage gets before it streams with a chip.",
    text: NARRATOR_REDRAFT,
    vars: [],
  },
  {
    id: NARRATION_TEXT.quiet,
    page: PAGE,
    group: "Narrator",
    label: "A turn that didn't reach them",
    note: "Sent with the rules when nothing of a depth turn reached the player character beyond what the player wrote for them (a scene's after the author was given one more step for it, or a real-time line whose answer didn't reach them): the reply is a short passage of where they are and what they're doing, with a chip saying nothing reached them, so it is never empty.",
    text: NARRATOR_QUIET,
    vars: VARS,
  },
  {
    id: NARRATION_TEXT.check,
    page: PAGE,
    group: "Render check",
    label: "Checking a passage",
    note: "Out of world, the GM checks each passage against its beats before it streams: everything that reached the player character depicted, quotes exact, nothing they couldn't perceive, nothing added. Its verdict and notes go to the thinking block.",
    contract: '{"faithful": boolean, "problems": [{"words", "beat", "problem", "change"}], "departs"?: string}',
    text: GM_CHECK,
    vars: VARS,
  },
];
