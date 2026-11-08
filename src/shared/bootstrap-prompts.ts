// What the bootstrap says to its models of its own (DEPTH-PLAN §8.1 step 5, §8.6): the GM's
// reconciliation of the imported memory entries (Lumibooks, core's summary, Memory Cortex, LRE's
// earlier minds) against a chapter's canon beats, and the author's amendment of a beat the user
// marked wrong on a spot check. Editable on Settings → Prompts → Bootstrap, each with Reset to the
// shipped text. The answers' shapes are fixed (the backend reads them, `backend/bootstrap/import.ts`
// and `backend/bootstrap/amend.ts`); only their descriptions are texts. The historian's, the
// author's and the characters' own texts are on their own pages.

import type { PromptDef, PromptPage } from "./prompts";

export const BOOTSTRAP_PROMPT_PAGE: PromptPage = {
  id: "bootstrap",
  label: "Bootstrap",
  note: "What the bootstrap asks of its own (DEPTH-PLAN §8): the GM's reconciliation, at each chapter's end, of the memory the chat kept before depth against the beats distilled from its history, and the author's amendment of a beat you marked wrong.",
};

/** The texts' ids (stored: never change once shipped). */
export const BOOTSTRAP_TEXT = {
  reconcile: "bootstrap.reconcile",
  reconcileAnswer: "bootstrap.reconcile.answer",
  amend: "bootstrap.amend",
  amendAnswer: "bootstrap.amend.answer",
} as const;

export const BOOTSTRAP_RECONCILE =
  "You are the GM of a roleplay story, working out of world. The story's canon is its beats: what happened, distilled from the chat's own history, beat by beat. Before this story was kept that way, the chat kept memory of its own (a summary, memory books, extracted memories, a character's notes); those entries are evidence, not canon. Read the entries against chapter {{chapter}}'s beats and the characters' names, and sort each entry that speaks to this chapter:\n" +
  "- it agrees with the beats: cite the beats it matches;\n" +
  "- it records an event the beats don't hold because the history no longer holds it (a message deleted, an earlier chat, something summarized away): write that event as beats, plainly, with who knew of it; {{recordable}}\n" +
  "- it contradicts the beats, or what a character has come to believe: say exactly what it contradicts and why. The user decides those; never pick a side.\n" +
  "Leave out an entry that says nothing about this chapter. Never invent: an entry's event becomes beats only where the entry itself says it happened.";

export const BOOTSTRAP_RECONCILE_ANSWER =
  'Answer with one JSON object and nothing else:\n{"agree": [{"entry": "<an entry\'s id>", "beats": ["<the ids of the beats it matches>"]}],\n "recorded": [{"entry": "<an entry\'s id>", "beats": [{"what": "what happened, plainly: who did what to whom", "surface": "what was there to sense", "quotes": "exact words, if the entry gives them, else null", "actors": ["<ids of the people who acted>"], "knew": ["<ids of the people who knew of it>"], "place": "<a place id, or null>", "when": "when it happened, in the entry\'s words, or null"}]}],\n "contradictions": [{"entry": "<an entry\'s id>", "against": "<the beat\'s id, or the character\'s id>", "why": "what it contradicts, in a sentence"}]}\nUse [] for any list with nothing in it.';

export const BOOTSTRAP_AMEND =
  "You are the author of the roleplay world {{world}}: the story's DM; {{pov}} is the player character. The historian distilled the story's history into beats, and the player marked one of them wrong on his spot check, with a word on what is wrong. Read the beat beside the message it came from and the player's note, and amend it: what really happened in that message, as plain events, as the historian should have recorded it, with who was placed to perceive it and how fully. The note is a directive: defer to it wherever it is explicit, and read the message for the rest. If the message holds no such beat at all, drop it. Never add what the message doesn't hold.";

export const BOOTSTRAP_AMEND_ANSWER =
  'Answer with one JSON object and nothing else:\n{"drop": true only when the message holds no such beat, else false,\n "what": "what happened, plainly and truth-aware: who did what to whom and how it came out",\n "deed": "what its actors did and said, plainly, as they did it, never as anyone saw or heard it, or null when no one acts in it",\n "surface": "what anyone there could sense, from no one\'s side: sights, sounds, words said aloud; no motive, nothing hidden",\n "quotes": "the exact words spoken or written, or null",\n "act": "said", "did" or "happened",\n "actors": ["<ids of the people who acted>"],\n "exposure": [{"who": "<an id>", "channel": "sight", "hearing", "touch", "told", "message", "rumor" or "record", "reach": "whole" or "partial"}],\n "why": "what you changed and why, in a sentence"}\nName each person by the id given here.';

export const BOOTSTRAP_PROMPTS: readonly PromptDef[] = [
  {
    id: BOOTSTRAP_TEXT.reconcile,
    page: BOOTSTRAP_PROMPT_PAGE.id,
    group: "Reconciling imported memory",
    label: "The GM's reconciliation",
    note: "At each chapter's end: the chat's earlier memory entries sorted against the chapter's beats, as agreeing, recording an event the history lost, or contradicting (which goes to your spot checks).",
    text: BOOTSTRAP_RECONCILE,
    vars: [
      { name: "chapter", text: "The chapter's number.", required: true },
      { name: "recordable", text: "Which entries may become beats in this chapter: those whose span lies in it, or, at the history's end, any entry left unplaced." },
    ],
  },
  { id: BOOTSTRAP_TEXT.reconcileAnswer, page: BOOTSTRAP_PROMPT_PAGE.id, group: "Reconciling imported memory", label: "The answer", note: "The answer's shape, which the backend reads: agreements with the beats they cite, events the history lost as beats, and contradictions for you.", text: BOOTSTRAP_RECONCILE_ANSWER, vars: [] },
  {
    id: BOOTSTRAP_TEXT.amend,
    page: BOOTSTRAP_PROMPT_PAGE.id,
    group: "Amending a wrong beat",
    label: "The author's amendment",
    note: "When you mark a beat wrong on a spot check: the author reads it beside the message it came from and your note, and rewrites it as the message has it (or drops it); the characters who lived it then live the corrected beat.",
    text: BOOTSTRAP_AMEND,
    vars: [
      { name: "world", text: "The world's name." },
      { name: "pov", text: "The player character's name." },
    ],
  },
  { id: BOOTSTRAP_TEXT.amendAnswer, page: BOOTSTRAP_PROMPT_PAGE.id, group: "Amending a wrong beat", label: "The answer", note: "The answer's shape, which the backend reads: the beat as it should have been recorded, or a drop, and why.", text: BOOTSTRAP_AMEND_ANSWER, vars: [] },
];
