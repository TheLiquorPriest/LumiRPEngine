// What LumiRPEngine says about a passage of the reply on its way out, on the harness engine
// (DEPTH2-PLAN §3.3): the game master's and the narrator's texts (`HarnessAgentText`, registered by
// `harness-texts.ts`), the tools that hand the narrator what reached the point-of-view character,
// record its drafts and hold them to their beats, what those tools and the release gate answer, the
// engine's own prose where the chat's preset gives the narrator none, what a character on the direct
// line is handed about writing its own passage, and the lines the author's guidance carries for the
// narration settings. Registry texts of the page "Harness engine", gathered by `harness-texts.ts`;
// this file reads nothing of it.

import { answerPrompt, HARNESS_FAMILY, HARNESS_GROUP, HARNESS_PAGE, type HarnessAgentText, type HarnessToolText, lines, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";
import type { DirectLinePassage, NarrationCheck } from "./settings";

/** The tools, by name. */
export const STAGE_TOOL = { narrationRead: "narration_read", passageDraft: "passage_draft", passageRead: "passage_read", passageCheck: "passage_check" } as const;

/** The texts that are no tool's: ids, so code names each once. */
export const STAGE_TEXT = {
  /** The narrator's prose where the chat's preset gives it none. */
  prose: "harness.narration.prose",
  /** Someone the point-of-view character has never met, as the narrator is told of them. */
  stranger: "harness.narration.stranger",
  /** What a character on the direct line is told of writing its own passage. */
  lineIntro: "harness.narration.direct",
  /** How lines are written here, where the chat's preset says nothing of its voice. */
  lineVoice: "harness.narration.direct_voice",
  /** The author's guidance: who checks a passage. */
  check: (who: NarrationCheck): string => `harness.guidance.check.${who}`,
  /** The author's guidance: what it may release in its own words. */
  own: "harness.guidance.own_lines",
  ownNone: "harness.guidance.own_lines.none",
  /** The author's guidance: whose passage the direct line's is. */
  directLine: (mode: DirectLinePassage): string => `harness.guidance.direct_line.${mode}`,
} as const;

/** What these tools and the release gate answer besides a result: ids, so code names each once. */
export const STAGE_NOTE = {
  notTurn: "harness.note.narration.not_turn",
  narratorOnly: "harness.note.narration.narrator_only",
  povAuthor: "harness.note.narration.pov_author",
  nothing: "harness.note.narration.nothing",
  moduleUnknown: "harness.note.narration.module_unknown",
  noModules: "harness.note.narration.no_modules",
  readFirst: "harness.note.narration.read_first",
  draftEmpty: "harness.note.narration.draft_empty",
  draftLong: "harness.note.narration.draft_long",
  released: "harness.note.narration.released",
  draftPassed: "harness.note.narration.draft_passed",
  draftSpent: "harness.note.narration.draft_spent",
  drafted: "harness.note.narration.drafted",
  draftedChecked: "harness.note.narration.drafted_checked",
  draftedFree: "harness.note.narration.drafted_free",
  quotesMissing: "harness.note.narration.quotes_missing",
  quotesUnheld: "harness.note.narration.quotes_unheld",
  readWho: "harness.note.narration.read_who",
  noPassage: "harness.note.narration.no_passage",
  noneYet: "harness.note.narration.none_yet",
  checkNone: "harness.note.narration.check_none",
  checkWho: "harness.note.narration.check_who",
  checkNothing: "harness.note.narration.check_nothing",
  checkChanges: "harness.note.narration.check_changes",
  checkedHolds: "harness.note.narration.checked_holds",
  checkedRevise: "harness.note.narration.checked_revise",
  checkedSpent: "harness.note.narration.checked_spent",
  gateAuthor: "harness.note.narration.gate_author",
  gateTwice: "harness.note.narration.gate_twice",
  gateEarlier: "harness.note.narration.gate_earlier",
  gateUnchecked: "harness.note.narration.gate_unchecked",
  gateFault: "harness.note.narration.gate_fault",
  gateClose: "harness.note.narration.gate_close",
  gateUnknown: "harness.note.narration.gate_unknown",
} as const;

// ---------------------------------------------------------------- agents

/** The game master and the narrator, as shipped; `harness-texts.ts` registers them with the rest of the cast (`HARNESS_AGENT.gm`, `.narrator`). */
export const STAGE_AGENT_TEXTS: readonly HarnessAgentText[] = [
  {
    id: "game_master",
    label: "The game master",
    name: "Game master",
    description: "Rules on what the world's rules leave open, checks each passage of the narrator's against what happened before it is released, and settles what happened with you when you ask. Give it what is attempted and how (in the player's own words where it is the player's), or the number of the passage to check. It rolls nothing and writes no prose.",
    instructions: lines(
      "You are the game master of a roleplay world that LumiRPEngine keeps. The author starts you for a ruling, for a check of a passage before it reaches the player, or to settle what happened. You never roll: the engine's dice fall when the author plays an attempt. You never write the story's prose.",
      "",
      "A ruling. The author says what someone attempts and how they go about it.",
      "- Find the action the attempt is, and read its odds with checks_odds: whether it can be tried now, the chance of each outcome, and what this world's policy makes of it. An attempt of the player character's that no action covers is the open attempt: checks_stakes with action try, the skill that fits, how hard it looks, and whom it is against.",
      "- Look up only what the ruling turns on: the people involved, what they carry, where they are.",
      "- Judge the approach: how well what was described suits what is attempted, from 0 to the top the policy gives, with a reason in one plain line. A clever, prepared approach that fits the moment rates high. None, or one that works against them, rates 0.",
      "- Read the attempt with checks_stakes, with the same action, actor and arguments and your rating. Where the policy leaves the outcome to the story, give each outcome its odds: start from the dice's own, and move them toward success for a strong approach and away from it for a weak one.",
      "- Answer in a few lines: what is attempted; the action, who acts and its arguments exactly as you read them; your rating and why; the odds; what each outcome does. Never say how it turns out: the roll is the author's to play.",
      "",
      "A check. The author asks you to hold a passage to what happened.",
      "- Read it with passage_read. It gives the latest draft, every beat the passage tells as it truly happened and as it reached the point-of-view character, and the beats of the turn that never reached them.",
      "- Judge the passage against the beats passage_read shows you. Look into the world (places, people, things) only for a fact the passage states that no beat holds.",
      "- The passage holds when every act and every word that reached the point-of-view character is in it, every quote is word for word, and it adds nothing anyone could later notice: no act, word, outcome, injury, object, name or fact that the beats don't hold. It shows nothing the point-of-view character could not perceive, and other people's minds only through what they do and say. The rhythm, the voice, what the point-of-view character dwells on, and the presentation the author asked for are the narrator's.",
      "- passage_read also lists the quotes it could not find word for word and the spoken words no beat holds. Judge each one: a quote broken up by narration is still exact.",
      "- Record your verdict with passage_check: it holds, or it doesn't, with each change the narrator must make, exactly: the words at fault and what to put instead. Judge against the beats, never against your own taste.",
      "- Answer in a line: the verdict, and the changes if there are any.",
      "",
      "Settling what happened. When the author works something out with you (a contested outcome, a stretch of time decided between you), read the beats so far with beats_read, then write each thing that happened as a beat with beat_write, with whom it reached and how fully. Nothing you write may contradict a beat that stands.",
      "",
      "A tool's refusal says what to fix: fix it, or go on without it. Never repeat the same call unchanged.",
    ),
  },
  {
    id: "narrator",
    label: "The narrator",
    name: "Narrator",
    description: "Tells what happened: turns what reached the point-of-view character into a passage of the reply, in the voice this story is written in. Start it once a moment is decided. Name a point of view other than the player character's with as, and any presentation the preset offers in its task. Its passage is checked before you release it.",
    instructions: lines(
      "You are the narrator of a roleplay. The author decides what happens; you tell it. You turn what reached one person, the point-of-view character, into a passage of the story, in the voice the story is written in. Before the author releases your passage to the player, it is checked against what happened.",
      "",
      "How to work:",
      "- Call narration_read first. It gives what reached the point-of-view character, in the order it happened: what they saw and heard whole, what they caught only in part or were told, and their own acts and words. It says where they are and who is plainly there, and gives the end of the reply so far, the story's recent prose, and the presentation the author asked for. If your task names presentation, pass those names in modules.",
      "- Write no fact of your own. Every act and every word you show is one you were given. Quote spoken words exactly. Show nothing the point-of-view character could not see, hear or know, and other people's minds only through what they do and say. Call someone by name only where you were given the name.",
      "- The telling is yours: its rhythm, its voice, what the point-of-view character dwells on. Nothing you add may be something anyone could later notice.",
      "- Go on from the reply so far without repeating it. When it already holds prose, start your passage with a blank line.",
      "- Record the passage with passage_draft. If it notes a quote you missed, draft again with the quote in it.",
      "- When narration_read shows your last draft with the changes a check asks for, make exactly those changes and keep the rest.",
      "- Then answer with the passage exactly as you drafted it, and nothing else.",
    ),
  },
];

// ---------------------------------------------------------------- tools

/** The tools as shipped, in the order the Prompts page lists them. */
export const STAGE_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: STAGE_TOOL.narrationRead,
    family: HARNESS_FAMILY.narration,
    tier: "read",
    note: "Gives the narrator what reached the point-of-view character in this turn that no passage has told yet.",
    text: "The narrator's first call: what it is given to tell. It answers with what reached the point-of-view character in this turn that no earlier passage has told, in the order it happened (seen and heard whole, caught in part, told by someone, or their own act), where they are and who is plainly there, the end of the reply so far and the story's recent prose for its voice, and the presentation the author asked for. It never gives what reached no one, or more of what happened than reached them. The point of view is the player character's unless the author named someone else when it started you. Called again, it gives the same passage, with your last draft and the changes a check asked for. The author may call it with pov to see what a narrator would be given.",
    args: [
      { path: "pov", text: "The author's only: whose eyes to see through, a person's id or name. A narrator reads without it: the author names the point of view when it starts you." },
      { path: "modules", text: "The names of the presentation the author asked for in your task, if any." },
    ],
  },
  {
    name: STAGE_TOOL.passageDraft,
    family: HARNESS_FAMILY.narration,
    tier: "write",
    note: "Records the narrator's draft of its passage.",
    text: "Record your passage: the narrator's draft of what narration_read gave it. Each call is a new draft of the same passage, and a passage has a set number of drafts. The answer notes the quotes it could not find word for word and the spoken words no beat holds, and says whether the passage is checked before the author releases it.",
    args: [{ path: "text", text: "The whole passage, exactly as it should reach the player." }],
  },
  {
    name: STAGE_TOOL.passageRead,
    family: HARNESS_FAMILY.narration,
    tier: "read",
    note: "Reads a passage for its check: its latest draft and the beats it tells, whole.",
    text: "Read a passage for its check: its latest draft, every beat it tells as it truly happened and as it reached the point-of-view character, the beats of the turn that never reached them, the quotes the draft lacks and the spoken words no beat holds, and the checks made so far. The game master and the author read with it; a narrator never does.",
    args: [{ path: "passage", text: "The passage's number; leave it out for the latest one waiting for a check." }],
  },
  {
    name: STAGE_TOOL.passageCheck,
    family: HARNESS_FAMILY.narration,
    tier: "write",
    note: "Records a check of a passage's latest draft: whether it holds to its beats, and what to change.",
    text: "Record your check of a passage's latest draft: whether it holds to its beats, and if not, each change the narrator must make. Only the one the settings name checks: the game master, or the author. A draft at fault goes back to the narrator; one that holds may be released.",
    args: [
      { path: "passage", text: "The passage's number." },
      { path: "holds", text: "Whether the draft holds to its beats: true or false." },
      { path: "changes", text: "Each change the narrator must make, exactly: the words at fault and what to put instead. Needed when it doesn't hold." },
    ],
  },
];

// ---------------------------------------------------------------- the other texts

const AGENTS = HARNESS_GROUP.agents;
const GUIDANCE = HARNESS_GROUP.guidance;
const page = HARNESS_PAGE.id;

const pov = v("pov", "the point-of-view character's name", true);
const n = v("n", "the passage's number", true);
const tool = v("tool", "the tool called", true);

/** The texts that are no tool's answer: the narrator's own prose, the direct line's guidance, and the author's guidance lines. */
const TEXT_PROMPTS: readonly PromptDef[] = [
  {
    id: STAGE_TEXT.prose,
    page,
    group: AGENTS,
    label: "The narrator: prose where the preset gives none",
    note: "What narration_read gives the narrator about how to write when the chat's preset gives it no prose and no voice of its own.",
    text: "How to write: match the story's recent prose, its person, its tense and its voice. With none to match, write in the third person and the past tense, close to the point-of-view character. Set speech in quotation marks, with who speaks and what they do around it.",
    vars: [],
    nonEmpty: true,
  },
  {
    id: STAGE_TEXT.stranger,
    page,
    group: AGENTS,
    label: "The narrator: someone not met",
    note: "How the narrator is told of someone the point-of-view character has never met, in place of their name.",
    text: "someone {{pov}} hasn't met",
    vars: [pov],
    nonEmpty: true,
  },
  {
    id: STAGE_TEXT.lineIntro,
    page,
    group: AGENTS,
    label: "A character on the direct line",
    note: "Ends every character's instructions: what a character whose answer is the reply itself (the direct line) is told of writing it, should its task put it there. The chat preset's voice follows it, or the text below where the preset says nothing of its voice.",
    text: "When your task says you answer the player on the direct line, your answer is the passage itself, and it streams to the player as you write it. Write it the way this story's prose is written, as below: your words in quotation marks, with what you do around them. Write only the passage, nothing outside the story. In any other task, what you answer is for the author alone, and this does not apply.",
    vars: [],
    nonEmpty: true,
  },
  {
    id: STAGE_TEXT.lineVoice,
    page,
    group: AGENTS,
    label: "The direct line: voice where the preset gives none",
    note: "How lines are written here, for a character on the direct line, when the chat's preset says nothing of its voice.",
    text: "Match the story's recent prose: its person, its tense and its voice.",
    vars: [],
    nonEmpty: true,
  },
  {
    id: STAGE_TEXT.check("gm"),
    page,
    group: GUIDANCE,
    label: "Each passage: the game master checks",
    note: "The author's guidance when the game master checks each passage (the narration setting Who checks).",
    text: "Each passage is checked by the game master in this chat. Before you release a passage of the narrator's, start the game master to check it. A passage at fault goes back to the narrator with the changes, up to {{revisions}} times; then you may release its last draft as it stands, or leave it out. reply_write refuses a passage that hasn't passed its check.",
    vars: [v("revisions", "the revisions a passage is allowed", true)],
  },
  {
    id: STAGE_TEXT.check("author"),
    page,
    group: GUIDANCE,
    label: "Each passage: the author checks",
    note: "The author's guidance when it checks each passage itself (the narration setting Who checks).",
    text: "You check each passage of the narrator's yourself in this chat. Before you release one, read it against its beats with passage_read and give your verdict with passage_check. A passage at fault goes back to the narrator with the changes, up to {{revisions}} times; then you may release its last draft as it stands, or leave it out. reply_write refuses a passage that hasn't passed its check.",
    vars: [v("revisions", "the revisions a passage is allowed", true)],
  },
  {
    id: STAGE_TEXT.check("none"),
    page,
    group: GUIDANCE,
    label: "Each passage: no one checks",
    note: "The author's guidance when no one checks a passage (the narration setting Who checks).",
    text: "No one checks a passage of the narrator's in this chat: release each with reply_write as it comes.",
    vars: [],
  },
  {
    id: STAGE_TEXT.own,
    page,
    group: GUIDANCE,
    label: "What the author may release in its own words",
    note: "The author's guidance on what reply_write takes from it without a check, where each passage is checked.",
    text: "You may release up to {{chars}} characters in your own words with no check: a line for someone who has no mind of their own, or a short answer out of character. Anything longer is the narrator's to write.",
    vars: [v("chars", "the characters it may release so", true)],
  },
  {
    id: STAGE_TEXT.ownNone,
    page,
    group: GUIDANCE,
    label: "Nothing in the author's own words",
    note: "The author's guidance where each passage is checked and the author may release nothing in its own words.",
    text: "Everything you release is the narrator's to write: reply_write takes nothing in your own words.",
    vars: [],
  },
  {
    id: STAGE_TEXT.directLine("own"),
    page,
    group: GUIDANCE,
    label: "The direct line: the character's own passage",
    note: "The author's guidance when the direct line's passage is the character's own (the narration setting The direct line).",
    text: "On the direct line, a character's own passage is the reply: hand it the stream (delegate with to_reply) and it speaks as itself.",
    vars: [],
  },
  {
    id: STAGE_TEXT.directLine("narrated"),
    page,
    group: GUIDANCE,
    label: "The direct line: the narrator tells it",
    note: "The author's guidance when the narrator tells the direct line's passage afterwards (the narration setting The direct line).",
    text: "On the direct line, the reply is still the narrator's: have the character answer, then have the narrator tell it. Never hand the stream to a character.",
    vars: [],
  },
];

const NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(STAGE_NOTE.notTurn, "No reply to narrate", "A narration tool's answer in a run that writes no reply: a job's, or a conversation outside a turn.", "Narration belongs to the turn that writes the reply. This run writes none, so there is nothing to narrate here."),
  answerPrompt(STAGE_NOTE.narratorOnly, "The narrator's tool", "narration_read's and passage_draft's answer to an agent that isn't the narrator (the author may read with narration_read).", "{{tool}} is the narrator's. The game master and the author read a passage with passage_read.", [tool]),
  answerPrompt(STAGE_NOTE.povAuthor, "Only the author names the point of view", "narration_read's answer to a narrator that names a point of view itself.", "Only the author names whose eyes a passage is seen through, when it starts the narrator. Call narration_read without pov."),
  answerPrompt(STAGE_NOTE.nothing, "Nothing to narrate", "narration_read's answer when nothing reached the point-of-view character that an earlier passage hasn't told.", "Nothing has reached {{pov}} in this turn that an earlier passage hasn't told. There is nothing to narrate yet: say so in your answer.", [pov]),
  answerPrompt(STAGE_NOTE.moduleUnknown, "No such presentation", "narration_read's answer when a presentation it is asked for isn't in the chat's preset.", "This chat's preset has no presentation called {{names}}. What it offers: {{offered}}.", [v("names", "the names it doesn't have", true), v("offered", "the names it has", true)]),
  answerPrompt(STAGE_NOTE.noModules, "No presentation to ask for", "narration_read's answer when it is asked for presentation and the chat's preset offers none.", "This chat's preset offers no presentation to ask for. Call narration_read without modules."),
  answerPrompt(STAGE_NOTE.readFirst, "Read before drafting", "passage_draft's answer to a narrator that hasn't been given its passage yet.", "Call narration_read first: it gives the passage you draft."),
  answerPrompt(STAGE_NOTE.draftEmpty, "A draft with no text", "passage_draft's answer when it is given no text.", "A draft needs the passage's text: the whole passage, as it should reach the player."),
  answerPrompt(STAGE_NOTE.draftLong, "A passage too long", "passage_draft's answer when a draft is longer than a passage may be (the narration setting Longest passage).", "A passage is at most {{chars}} characters. Tell less in this one: what is left can be the next passage's.", [v("chars", "the most a passage may be", true)]),
  answerPrompt(STAGE_NOTE.released, "The passage is out", "A narration tool's answer about a passage that has been released already.", "Passage {{n}} has been released already: nothing of it can change.", [n]),
  answerPrompt(STAGE_NOTE.draftPassed, "The draft passed", "passage_draft's answer when the passage's last draft passed its check.", "Your last draft of passage {{n}} passed its check, and the author releases it as it stands. Answer with that draft.", [n]),
  answerPrompt(STAGE_NOTE.draftSpent, "No drafts left", "passage_draft's answer when the passage has had all the drafts the settings allow.", "Passage {{n}} has had {{made}} drafts, all the settings allow. The author decides what becomes of it: answer with your last draft as it stands.", [n, v("made", "the drafts it has had", true)]),
  answerPrompt(STAGE_NOTE.drafted, "A draft recorded", "Heads passage_draft's answer once the draft is recorded.", "Passage {{n}}, draft {{draft}} of {{of}}, is recorded.", [n, v("draft", "this draft's number", true), v("of", "the drafts a passage may have", true)]),
  answerPrompt(STAGE_NOTE.draftedChecked, "It is checked next", "Ends passage_draft's answer where each passage is checked.", "It is checked against what happened before the author releases it. Answer with the passage exactly as you drafted it."),
  answerPrompt(STAGE_NOTE.draftedFree, "No one checks it", "Ends passage_draft's answer where no one checks a passage.", "No one checks it in this chat: the author may release it now. Answer with the passage exactly as you drafted it."),
  answerPrompt(STAGE_NOTE.quotesMissing, "Quotes the draft lacks", "In passage_draft's and passage_read's answers: words spoken where the point-of-view character heard them that the draft doesn't have word for word.", "These words were spoken where {{pov}} heard them, and the passage doesn't have them word for word: {{quotes}}.", [pov, v("quotes", "the quotes, each in quotation marks", true)]),
  answerPrompt(STAGE_NOTE.quotesUnheld, "Spoken words no beat holds", "In passage_draft's and passage_read's answers: words spoken in the draft that no beat holds.", "These words are spoken in the passage, and no beat holds them: {{quotes}}.", [v("quotes", "the words, each in quotation marks", true)]),
  answerPrompt(STAGE_NOTE.readWho, "Not for the narrator", "passage_read's answer to an agent that doesn't check a passage.", "passage_read is for whoever checks a passage, the game master or the author. A narrator is given only what narration_read gives."),
  answerPrompt(STAGE_NOTE.noPassage, "No such passage", "A narration tool's answer when the turn has no passage of that number.", "This turn has no passage {{n}}.", [n]),
  answerPrompt(STAGE_NOTE.noneYet, "No passage yet", "passage_read's answer when no passage of the turn has been drafted yet.", "No passage has been drafted in this turn yet: the narrator drafts one first."),
  answerPrompt(STAGE_NOTE.checkNone, "No one checks", "passage_check's answer where the settings have no one check a passage.", "No one checks a passage in this chat: the author releases each without a check."),
  answerPrompt(STAGE_NOTE.checkWho, "Not yours to check", "passage_check's answer to an agent the settings don't name to check a passage.", "Checking a passage isn't yours in this chat: the settings give it to another."),
  answerPrompt(STAGE_NOTE.checkNothing, "Nothing to check", "passage_check's answer when the passage has no draft waiting for a check.", "Passage {{n}} has no draft waiting for a check: the narrator drafts it first, or its latest draft was checked already.", [n]),
  answerPrompt(STAGE_NOTE.checkChanges, "What to change", "passage_check's answer when a draft that doesn't hold comes with no changes, or with too many or too long (the narration settings Changes and Longest change).", "A draft that doesn't hold needs the changes the narrator must make: at least one and at most {{most}}, each at most {{chars}} characters.", [v("most", "the most changes a check gives", true), v("chars", "the longest change", true)]),
  answerPrompt(STAGE_NOTE.checkedHolds, "It holds", "passage_check's answer when the draft holds.", "Passage {{n}} holds. The author may release it with reply_write, exactly as drafted.", [n]),
  answerPrompt(STAGE_NOTE.checkedRevise, "It goes back", "passage_check's answer when the draft doesn't hold and the passage may be drafted again.", "Passage {{n}} doesn't hold. It goes back to the narrator with your changes: {{left}} more drafts allowed.", [n, v("left", "the drafts still allowed", true)]),
  answerPrompt(STAGE_NOTE.checkedSpent, "It doesn't hold, and no drafts are left", "passage_check's answer when the draft doesn't hold and the passage has had all its drafts.", "Passage {{n}} doesn't hold, and its drafts are spent. The author may release its last draft as it stands, or leave it out.", [n]),
  answerPrompt(STAGE_NOTE.gateAuthor, "Release is the author's", "reply_write's answer to an agent other than the author.", "Only the author releases text into the reply."),
  answerPrompt(STAGE_NOTE.gateTwice, "Released already", "reply_write's answer to a passage that has been released already.", "Passage {{n}} has been released already.", [n]),
  answerPrompt(STAGE_NOTE.gateEarlier, "An earlier draft", "reply_write's answer to a draft of a passage that isn't its latest.", "That is an earlier draft of passage {{n}}. Release its latest, draft {{draft}}, exactly as drafted.", [n, v("draft", "the latest draft's number", true)]),
  answerPrompt(STAGE_NOTE.gateUnchecked, "Not checked yet", "reply_write's answer to a passage whose latest draft hasn't been checked, where each passage is checked.", "Passage {{n}} hasn't been checked yet. Have it checked first (passage_check), then release it.", [n]),
  answerPrompt(STAGE_NOTE.gateFault, "Found at fault", "reply_write's answer to a passage its check found at fault while it may still be drafted again.", "The check found passage {{n}} at fault. The narrator revises it first: {{left}} more drafts allowed.", [n, v("left", "the drafts still allowed", true)]),
  answerPrompt(STAGE_NOTE.gateClose, "Not the same as the draft", "reply_write's answer to text close to a passage's latest draft but not the same.", "This is close to passage {{n}}'s latest draft, but not the same. Release that draft exactly as drafted: passage_read gives it.", [n]),
  answerPrompt(STAGE_NOTE.gateUnknown, "Not a passage", "reply_write's answer to text that is no passage and longer than the author may release in its own words (the narration setting The author's own words).", "This isn't a passage that passed its check, and it is longer than the {{chars}} characters you may release in your own words. Have the narrator tell it, and release that passage once it passes.", [v("chars", "what the author may release in its own words", true)]),
];

/** Every text of this file but the agents' and the tools' (`harness-texts.ts` registers those with the rest), in the order the page lists them. */
export const STAGE_PROMPTS: readonly PromptDef[] = [...TEXT_PROMPTS, ...NOTE_PROMPTS];
