// What LumiRPEngine says to a model about a mind's own files and its notes folded into its summary,
// on the harness engine: each tool's description and its arguments', and what those tools answer
// besides a result; with them, what a mind is told of a turn its person wasn't there to hear
// (`mind_view`, `mind_remember`). Registry texts of the page "Harness engine", gathered by
// `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, lines, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const FILES_TOOL = { mindFiles: "mind_files", mindFileRead: "mind_file_read", mindFileWrite: "mind_file_write", mindConsolidate: "mind_consolidate" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const FILES_NOTE = {
  noWorkspace: "harness.note.files.no_workspace",
  noFiles: "harness.note.files.no_files",
  filesNext: "harness.note.files.files_next",
  badName: "harness.note.files.bad_name",
  noFile: "harness.note.files.no_file",
  noFileYet: "harness.note.files.no_file_yet",
  coreIsUsers: "harness.note.files.core_is_users",
  stale: "harness.note.files.stale",
  staleNew: "harness.note.files.stale_new",
  writeRefused: "harness.note.files.write_refused",
  written: "harness.note.files.written",
  viewFiles: "harness.note.files.view_files",
  viewFile: "harness.note.files.view_file",
  viewFold: "harness.note.files.view_fold",
  foldOff: "harness.note.files.fold_off",
  nothingDue: "harness.note.files.nothing_due",
  nameLong: "harness.note.files.name_long",
  fileLong: "harness.note.files.file_long",
  fileAsks: "harness.note.files.file_asks",
  viewAbsent: "harness.note.files.view_absent",
  rememberAbsent: "harness.note.files.remember_absent",
} as const;

const who = "Who you are: your own id or name. A mind reaches nothing of anyone else's.";
const file = "The file's name: letters, digits, - and _, ending in .md (now.md, people.md). No folders.";

/** The tools as shipped, in the order the Prompts page lists them. */
export const FILES_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: FILES_TOOL.mindFiles,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    note: "Lists the files a person's own mind keeps for itself.",
    text: "List the files you keep for yourself from turn to turn, each with its size in characters. They are yours alone: no other mind reads or writes them, and you reach no one else's. What a file is for is yours to decide; minds often keep core.md (who you are at heart: the user writes it, you only read it), self.md, now.md, on-my-mind.md, memories.md, beliefs.md, people.md and plans.md. Only an agent started as a character may call this, for the one person it is. mind_view lists the same names; mind_file_read reads one, mind_file_write writes one.",
    args: [{ path: "who", text: who }],
  },
  {
    name: FILES_TOOL.mindFileRead,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    note: "Reads one of a mind's own files, with its version.",
    text: "Read one of your own files whole: its text, its size and its version. Read a file before you rewrite it, and give the version you read to mind_file_write, so a change made since isn't written over unseen. mind_files and mind_view list the files you keep. Only an agent started as a character may call this, for the one person it is.",
    args: [
      { path: "who", text: who },
      { path: "file", text: file },
    ],
  },
  {
    name: FILES_TOOL.mindFileWrite,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    note: "Writes one of a mind's own files whole.",
    text: "Write one of your own files whole: text replaces everything the file held, or makes the file when you keep none of that name. Use it for what you want to carry to your later turns in your own words: how things stand for you now, what is on your mind, what you believe, what you make of the people you know. It is written to the workspace at once: a file can't wait for the turn's commit, or on the review card. So the player's mode for characters' minds (Settings → Changes from the reply) holds it here: as shipped it is written; set to Confirm or to Never it is refused, and what you want to carry goes in mind_remember instead. A file and its name each have a longest length the player set: past it the write is refused, with the limit. To change part of a file, read it (mind_file_read), then write all of it with the change made and the version you read. core.md is the user's: you never write it. What happened in a turn is still recorded with mind_remember; a file is your own keeping beside it. Only an agent started as a character may call this, for the one person it is.",
    args: [
      { path: "who", text: who },
      { path: "file", text: file },
      { path: "text", text: "The whole text of the file, as it should stand after the write." },
      { path: "version", text: "The version mind_file_read gave you: the write is refused, with the current version, when the file changed since. Leave it out to replace the file as it stands now, or to make a new one." },
    ],
  },
  {
    name: FILES_TOOL.mindConsolidate,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    note: "Folds a person's older memory notes into their summary, as their own mind rewrites it.",
    text: "Fold your older notes into your summary. When some of your notes are due (more than you keep, or faded), mind_view lists them under their own heading beside your summary as it stands. Rewrite the summary with them folded in: keep what still matters to you, let the rest go, and keep everything the summary already holds that is still true; plain prose, in your own perspective. Then call this with the new summary: the engine replaces your summary with it and lets those notes go. It folds exactly the notes mind_view listed, so read mind_view first; it refuses when none are due. A summary past the length the user set is cut, and the answer says so. It is one of the changes the player's mode for characters' minds decides (Settings → Changes from the reply): as shipped it is recorded; set to Confirm it waits for the player's Apply on the review card; set to Never it is refused. Only an agent started as a character may call this, for the one person it is.",
    args: [
      { path: "who", text: who },
      { path: "summary", text: "Your whole new summary, with the notes due folded in: plain prose, in your own perspective." },
    ],
  },
];

const fileVar = v("file", "the name the call gave", true);

export const FILES_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(FILES_NOTE.noWorkspace, "The workspace isn't connected", "A mind's file tool's answer on a chat whose harness gave the engine no workspace.", "The workspace isn't connected on this chat, so you keep no files here. Go on without them: what you perceive, know and remember comes from mind_view, and what you take from a turn is recorded with mind_remember."),
  answerPrompt(FILES_NOTE.noFiles, "No files yet", "mind_files's answer for a mind that keeps no file.", "You keep no files yet. mind_file_write makes one: give it a name such as now.md and the whole text."),
  answerPrompt(FILES_NOTE.filesNext, "What to do with the files", "Ends mind_files's answer when the mind keeps files.", "Sizes are in characters. mind_file_read reads one; mind_file_write replaces one whole. core.md is the user's to write."),
  answerPrompt(FILES_NOTE.badName, "A name a file can't have", "A mind's file tool's answer when file is no plain name: one with a folder, another ending, or other characters.", "{{file}} is no name a file of yours may have. A name is letters, digits, - and _, and ends in .md, such as now.md or people.md: no folders, no spaces, no other dots. Call {{tool}} again with such a name.", [fileVar, v("tool", "the tool called")]),
  answerPrompt(FILES_NOTE.noFile, "No such file", "mind_file_read's answer when the mind keeps no file of that name but keeps others.", "You keep no file called {{file}}. Your files: {{files}}.", [fileVar, v("files", "the names of the files the mind keeps", true)]),
  answerPrompt(FILES_NOTE.noFileYet, "No such file, and none kept", "mind_file_read's answer when the mind keeps no file at all.", "You keep no file called {{file}}, and no files yet. mind_file_write makes one.", [fileVar]),
  answerPrompt(FILES_NOTE.coreIsUsers, "core.md is the user's", "mind_file_write's answer when file is core.md, which only the user writes.", "core.md is the user's to write: it says who {{name}} is at heart, and you read it (mind_file_read) and never change it. Keep what you want to carry in another file of yours, such as self.md or now.md.", [v("name", "the person the mind is")]),
  answerPrompt(FILES_NOTE.stale, "The file changed since it was read", "mind_file_write's answer when the file is no longer at the version the call gave.", "{{file}} changed since the version you gave ({{given}}): it is now at version {{version}}, and nothing was written. Read it again (mind_file_read), make your change to what it holds now, and write it with version: {{version}}.", [fileVar, v("given", "the version the call gave"), v("version", "the file's version now", true)]),
  answerPrompt(FILES_NOTE.staleNew, "A version for a file not kept", "mind_file_write's answer when the call gives a version and the mind keeps no file of that name.", "You keep no file called {{file}}, so there is no version {{given}} of it to write over, and nothing was written. Leave version out to make the file.", [fileVar, v("given", "the version the call gave")]),
  answerPrompt(FILES_NOTE.writeRefused, "The workspace refused the write", "mind_file_write's answer when the workspace doesn't take the file, with the workspace's own reason.", "The workspace didn't take {{file}}: {{reason}}. Fix that and call mind_file_write again.", [fileVar, v("reason", "why, in the workspace's words", true)]),
  answerPrompt(FILES_NOTE.written, "Written to the mind's files", "Ends mind_file_write's answer.", "Written to your files now. It is yours on your later turns: mind_view lists it, mind_file_read reads it."),
  answerPrompt(FILES_NOTE.viewFiles, "The mind's files, in mind_view", "Heads the list of files mind_view shows a mind that keeps some: their names and sizes, never their text.", lines("## Your own files", "What you keep for yourself from turn to turn. mind_file_read reads one; mind_file_write replaces one whole.")),
  answerPrompt(FILES_NOTE.viewFile, "One of the mind's files, in mind_view", "One line of the files mind_view lists.", "- {{file}}: {{size}} characters", [v("file", "the file's name", true), v("size", "its size in characters", true)]),
  answerPrompt(
    FILES_NOTE.viewFold,
    "Notes due to fold, in mind_view",
    "Heads what mind_view shows a mind whose older notes are due to fold into its summary: the summary as it stands and those notes, as a classic consolidation reads them.",
    lines("## Upkeep: older notes to fold into your summary", "Some of your older notes are due to fold into your summary; they are listed below with your summary as it stands. Rewrite the summary with them folded in: keep what still matters to you, let the rest go, and keep everything it already holds that is still true; plain prose, in your own perspective, at most {{chars}} characters. Then call mind_consolidate with who and summary: your summary is replaced and those notes are let go."),
    [v("chars", "the most characters a summary may run to (Settings → Minds → Lengths)")],
  ),
  answerPrompt(FILES_NOTE.foldOff, "Folding notes is off", "mind_consolidate's answer while this world or the user has notes fade out instead of folding into the summary.", "Notes aren't folded into summaries in this chat (the world's memory settings, or Settings → Minds → Memory): older notes fade out by themselves, and nothing was changed. Don't call mind_consolidate here; to rewrite your summary, give summary to mind_remember."),
  answerPrompt(FILES_NOTE.nothingDue, "No notes are due", "mind_consolidate's answer when none of the mind's notes is due to fold.", "None of your notes is due to fold into your summary now, so nothing was changed. mind_view lists the notes to fold under their own heading when some are due: call mind_consolidate only then. To rewrite your summary without folding notes, give summary to mind_remember."),
  answerPrompt(FILES_NOTE.nameLong, "A name too long", "A mind's file tool's answer when file is longer than the longest name the player allows (the setting agents.harnessLimits.mindFileNameChars).", "That name is {{size}} characters long, and a file's name holds at most {{max}}, its .md included. Call {{tool}} again with a shorter name, such as now.md or people.md.", [v("size", "how long the name the call gave is, in characters", true), v("max", "the longest name the player allows, in characters", true), v("tool", "the tool called")]),
  answerPrompt(FILES_NOTE.fileLong, "A file too long", "mind_file_write's answer when text is longer than the longest file the player allows (the setting agents.harnessLimits.mindFileChars).", "{{file}} would be {{size}} characters long, and a file of yours holds at most {{max}}, so nothing was written. Keep what matters and write it shorter, or keep the rest in another file.", [fileVar, v("size", "how long the text the call gave is, in characters", true), v("max", "the longest file the player allows, in characters", true)]),
  answerPrompt(FILES_NOTE.fileAsks, "A file can't wait for Apply", "mind_file_write's answer while the player has characters' minds set to Confirm (Settings → Changes from the reply): the tool writes a file itself, so no review card could make it.", "{{type}} is set to Confirm (Settings → Changes from the reply), and a file can't wait on the review card as a memory can, so {{file}} wasn't written. Record what you want to carry with mind_remember: it waits for the player's Apply.", [v("type", "the change type, as Settings names it", true), fileVar]),
  answerPrompt(FILES_NOTE.viewAbsent, "Not there for the turn, in mind_view", "What mind_view tells a mind, once the turn's reply is written, whose person wasn't there to hear the turn: it is given its own view as before the reply, with this as why it thinks now, and nothing of the turn as written.", "You weren't there to hear the turn that was just written, so nothing of it is yours to know or to remember"),
  answerPrompt(FILES_NOTE.rememberAbsent, "Not there for the turn", "mind_remember's answer, once the turn's reply is written, to a mind whose person wasn't there to hear the turn.", "You weren't there to hear the turn that was just written, so nothing of it is yours to remember, and nothing was recorded. Say so in your answer, and don't call mind_remember for this turn."),
];
