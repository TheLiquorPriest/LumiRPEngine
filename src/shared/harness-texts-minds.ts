// What LumiRPEngine says to a model about minds on the harness engine (DEPTH2-PLAN §4, §5): the
// character agent's own texts and the skills for its kinds of run, the mind tools' descriptions and
// their arguments', and what those tools answer besides a result. Registry texts of the page
// "Harness engine", gathered by `harness-texts.ts` (which this file never imports).

import { answerPrompt, type HarnessAgentText, type HarnessSkillText, type HarnessToolText, HARNESS_FAMILY, lines, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const MINDS_TOOL = { read: "mind_read", write: "mind_write", digested: "mind_digested", seed: "mind_seed" } as const;

/** The character agent's skills, by id: one for each kind of run. */
export const MINDS_SKILL = { scene: "character_scene", digest: "character_digest", prepare: "character_prepare", relive: "character_relive" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const MINDS_NOTE = {
  onlyCharacter: "harness.note.minds.only_character",
  noOne: "harness.note.minds.no_one",
  noPerson: "harness.note.minds.no_person",
  notPrincipal: "harness.note.minds.not_principal",
  playerNoMind: "harness.note.minds.player_no_mind",
  otherMind: "harness.note.minds.other_mind",
  notYours: "harness.note.minds.not_yours",
  noStory: "harness.note.minds.no_story",
  noWorkspace: "harness.note.minds.no_workspace",
  standingExtra: "harness.note.minds.standing.extra",
  standingSupporting: "harness.note.minds.standing.supporting",
  standingPrincipal: "harness.note.minds.standing.principal",
  standingPlayer: "harness.note.minds.standing.player",
  extraNoMind: "harness.note.minds.extra_no_mind",
  readHead: "harness.note.minds.read_head",
  fileHead: "harness.note.minds.file_head",
  fileEmpty: "harness.note.minds.file_empty",
  badFile: "harness.note.minds.bad_file",
  coreNotYours: "harness.note.minds.core_not_yours",
  profileNotYours: "harness.note.minds.profile_not_yours",
  charactersOwn: "harness.note.minds.characters_own",
  coreForPrincipal: "harness.note.minds.core_for_principal",
  profileForSupporting: "harness.note.minds.profile_for_supporting",
  gmReadsOnly: "harness.note.minds.gm_reads_only",
  fileLong: "harness.note.minds.file_long",
  appendLong: "harness.note.minds.append_long",
  fileAsks: "harness.note.minds.file_asks",
  stale: "harness.note.minds.stale",
  staleNew: "harness.note.minds.stale_new",
  writeRefused: "harness.note.minds.write_refused",
  written: "harness.note.minds.written",
  toUnknown: "harness.note.minds.to_unknown",
  toDone: "harness.note.minds.to_done",
  digested: "harness.note.minds.digested",
  turnOver: "harness.note.minds.turn_over",
  seedHead: "harness.note.minds.seed_head",
  seedSheet: "harness.note.minds.seed_sheet",
  seedMind: "harness.note.minds.seed_mind",
  seedKnows: "harness.note.minds.seed_knows",
  seedFiles: "harness.note.minds.seed_files",
  playerFights: "harness.note.minds.player_fights",
  outlineWritten: "harness.note.minds.outline_written",
  afterReply: "harness.note.minds.after_reply",
} as const;

const fileNames = "core.md, now.md, memory.md, beliefs.md, people.md, plans.md, outline.md or profile.md";
const who = "Whose mind: a person's name or id, or player for the player's character. A character's agent may leave it out, since its own mind is the only one it reaches.";

/** The tools as shipped, in the order the Prompts page lists them. */
export const MINDS_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: MINDS_TOOL.read,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    note: "Reads a mind's files, each with its version.",
    text: "Read a mind's files: who someone is at heart (core.md) and what they keep of their own (now.md, memory.md, beliefs.md, people.md, plans.md), or a supporting character's profile.md. Each comes with its version, which mind_write takes back. A character's agent reads only its own mind. The author and the game master read anyone's.",
    args: [
      { path: "who", text: who },
      { path: "file", text: `One file only: ${fileNames}. Leave it out for all of them.` },
    ],
  },
  {
    name: MINDS_TOOL.write,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    note: "Writes one file of a mind whole, or adds to its end.",
    text: "Write one file of a mind whole, or add to its end. A character's agent writes its own now.md, memory.md, beliefs.md, people.md and plans.md, in its own voice; core.md is never its to write. The author writes a principal's core.md (who they are at heart) and a supporting character's profile.md, and nothing else of a mind. Each file holds at most what the player set: past that the write is refused, and the file is to be written shorter. To change part of a file, read it, then write all of it with the version you read.",
    args: [
      { path: "who", text: who },
      { path: "file", text: `The file: ${fileNames}.` },
      { path: "text", text: "The file's whole new text; with append, what to add at its end." },
      { path: "append", text: "true to add text at the end of the file instead of replacing it." },
      { path: "version", text: "The version mind_read gave you: the write is refused, with the current version, when the file changed since. Leave it out to write over the file as it stands." },
    ],
  },
  {
    name: MINDS_TOOL.digested,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    note: "Marks a character's feed as taken in, up to one beat.",
    text: "Mark what reached you as taken in, up to and including one beat: your next feed_read starts after it. Call it once you have written what changed in you, with the last beat feed_read gave you. Only a character's own agent calls it, for the person it is.",
    args: [{ path: "to", text: "The last beat you took in: the last one feed_read gave you." }],
  },
  {
    name: MINDS_TOOL.seed,
    family: "minds",
    tier: "read",
    note: "What the engine holds of a person, for the author to write their core.md from.",
    text: "What the engine already holds of a person, for writing who they are at heart (core.md) when you cast them as a principal: their record in the world, what the older engine's mind of them held, what they knew, and their mind's files as they stand. It writes nothing: write core.md yourself with mind_write, in your own words. For the author and the game master.",
    args: [{ path: "who", text: "The person: their name or id, or player for the player's character." }],
  },
];

const tool = v("tool", "the tool that was called", true);
const name = v("name", "the person's name", true);
const standing = v("standing", "how the person is cast, in words (an extra, a supporting character, a principal)", true);
const file = v("file", "the file's name", true);
const size = v("size", "how long the file would be, in characters", true);
const max = v("max", "the most the file holds, in characters", true);

export const MINDS_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(MINDS_NOTE.onlyCharacter, "Only a character's own agent", "A character's own tool's answer to an agent that wasn't started as a character.", "{{tool}} belongs to a character's own agent, for the person it is. You weren't started as a character, so it didn't run.", [tool]),
  answerPrompt(MINDS_NOTE.noOne, "Started as no one", "A character's own tool's answer to a character agent that was started as no one in particular.", "You were started as no one in particular, so {{tool}} can't tell whose mind is yours. The author starts a character's agent as the person it is. Say so in your answer, and stop here.", [tool]),
  answerPrompt(MINDS_NOTE.noPerson, "Started as no one the world has", "A character's own tool's answer when the agent was started as an id the world has no person for.", "You were started as {{as}}, and the world has no person by that id. Say so in your answer, and stop here.", [v("as", "the id the agent was started as", true)]),
  answerPrompt(MINDS_NOTE.notPrincipal, "Not cast as a principal", "A character's own tool's answer when the person its agent was started as is an extra or a supporting character: only a principal has an agent, a mind and a feed.", "{{name}} is {{standing}}, not a principal, so no agent acts as them and they keep no mind or feed of their own. The author decides who is a principal. Say so in your answer, and stop here.", [name, standing]),
  answerPrompt(MINDS_NOTE.playerNoMind, "The player's character has no mind now", "A mind tool's answer about the player's character while they have no mind: Sovereign Hand is off for the run, or the setting for their mind is.", "{{name}} is the player's own character. They have a mind here only while Sovereign Hand is on and their mind is switched on in Settings; until then the player decides what they think and do. Say so in your answer, and stop here.", [name]),
  answerPrompt(MINDS_NOTE.otherMind, "Another person's mind", "A mind tool's answer to a character's agent that named someone else.", "You are {{self}}, and {{other}}'s mind is theirs alone: a character reads and writes only its own. Leave who out, or name yourself.", [v("self", "who the agent is", true), v("other", "who the call named", true)]),
  answerPrompt(MINDS_NOTE.notYours, "Not this agent's tool", "A mind tool's answer to an agent that is neither a character, the author nor the game master.", "{{tool}} is for a character's own agent, the author and the game master. You are none of them, so it didn't run.", [tool]),
  answerPrompt(MINDS_NOTE.noStory, "No story record here", "A mind tool's answer where the call reaches no story record: a chat that plays no world, or a call outside a turn.", "This call reaches no story record, so who is cast as what can't be told and nothing was done. Stop here, and say so in your answer."),
  answerPrompt(MINDS_NOTE.noWorkspace, "The workspace isn't connected", "A mind tool's answer on a chat whose harness gave the engine no workspace, where minds' files are kept.", "The chat's workspace isn't connected, so no mind's files can be read or written here. Say so in your answer."),
  answerPrompt(MINDS_NOTE.standingExtra, "Cast as an extra, in words", "How a mind tool names an extra in its answers.", "an extra"),
  answerPrompt(MINDS_NOTE.standingSupporting, "Cast as a supporting character, in words", "How a mind tool names a supporting character in its answers.", "a supporting character"),
  answerPrompt(MINDS_NOTE.standingPrincipal, "Cast as a principal, in words", "How a mind tool names a principal in its answers.", "a principal"),
  answerPrompt(MINDS_NOTE.standingPlayer, "The player's character, in words", "How a mind tool names the player's character's standing in its answers.", "the player's character"),
  answerPrompt(MINDS_NOTE.extraNoMind, "An extra keeps no mind", "mind_read's answer to the author or the game master about an extra.", "{{name}} is an extra: they keep no mind, and the author voices them. Cast them as a supporting character (a short profile) or a principal (a mind of their own) with cast_set.", [name]),
  answerPrompt(MINDS_NOTE.readHead, "A mind, read", "Opens mind_read's answer.", "{{name}}'s mind ({{standing}}). Each file comes with its version, which mind_write takes back.", [name, standing]),
  answerPrompt(MINDS_NOTE.fileHead, "One file, read", "Heads each file in mind_read's answer.", "{{file}} (version {{version}}, {{size}} of {{max}} characters)", [file, v("version", "the file's version", true), v("size", "the file's length, in characters", true), max]),
  answerPrompt(MINDS_NOTE.fileEmpty, "A file not written yet", "Stands for a file in mind_read's answer that holds nothing yet.", "{{file}}: nothing yet (it holds up to {{max}} characters)", [file, max]),
  answerPrompt(MINDS_NOTE.badFile, "No file of a mind", "mind_read's and mind_write's answer when file names none of a mind's files.", `{{file}} is no file of a mind. A mind's files are ${fileNames}.`, [file]),
  answerPrompt(MINDS_NOTE.coreNotYours, "core.md isn't the character's", "mind_write's answer to a character's agent that tried to write its own core.md.", "core.md says who you are at heart: the author and the player write it, never you. Keep what you make of things in now.md, memory.md, beliefs.md, people.md or plans.md."),
  answerPrompt(MINDS_NOTE.profileNotYours, "profile.md isn't the character's", "mind_write's answer to a character's agent that tried to write a profile.md.", "profile.md is the author's note on a supporting character. Your own files are now.md, memory.md, beliefs.md, people.md and plans.md."),
  answerPrompt(MINDS_NOTE.outlineWritten, "outline.md is written in a prepared start", "mind_write's answer to anyone naming outline.md: it is written only while the story is prepared.", "outline.md is what someone knows only in outline of a past they didn't relive. It is written while the story is prepared, and nowhere else."),
  answerPrompt(MINDS_NOTE.charactersOwn, "A character's own file", "mind_write's answer to the author naming one of a character's own files.", "{{file}} is {{name}}'s own, written in their voice by their own agent. The author writes only a principal's core.md and a supporting character's profile.md.", [file, name]),
  answerPrompt(MINDS_NOTE.coreForPrincipal, "core.md is a principal's", "mind_write's answer to the author writing core.md for someone who isn't a principal.", "{{name}} is {{standing}}: only a principal has a core.md. Cast them as a principal first (cast_set), or keep a supporting character's profile.md.", [name, standing]),
  answerPrompt(MINDS_NOTE.profileForSupporting, "profile.md is a supporting character's", "mind_write's answer to the author writing profile.md for someone who isn't a supporting character.", "{{name}} is {{standing}}: profile.md is a supporting character's. Who a principal is goes in core.md.", [name, standing]),
  answerPrompt(MINDS_NOTE.gmReadsOnly, "The game master writes no mind", "mind_write's answer to the game master.", "The game master reads minds and writes none. Tell the author what you think should change."),
  answerPrompt(MINDS_NOTE.fileLong, "A file too long", "mind_write's answer when the text is longer than the file holds (Settings: the story's minds).", "{{file}} would be {{size}} characters, past the {{max}} it holds, so nothing was written. Write it shorter: keep what matters and let the rest go.", [file, size, max]),
  answerPrompt(MINDS_NOTE.appendLong, "Too long with that added", "mind_write's answer when adding to a file would make it longer than it holds.", "{{file}} would be {{size}} characters with that added, past the {{max}} it holds, so nothing was written. Write it whole and shorter, without append: keep what still matters and let the small things fade.", [file, size, max]),
  answerPrompt(MINDS_NOTE.fileAsks, "A file can't wait for Apply", "mind_write's answer while the player has characters' minds set to Confirm (Settings → Changes from the reply): the tool writes a file at once, so no review card could make it.", "{{type}} is set to Confirm (Settings → Changes from the reply), and a mind's file can't wait on the review card, so {{file}} wasn't written. Say so in your answer.", [v("type", "the change type's name", true), file]),
  answerPrompt(MINDS_NOTE.stale, "Changed since it was read", "mind_write's answer when the file changed after the version the call gave.", "{{file}} changed since you read it: you gave version {{given}}, and it is at {{version}} now. Read it again and write it with your change made.", [file, v("given", "the version the call gave", true), v("version", "the file's version now", true)]),
  answerPrompt(MINDS_NOTE.staleNew, "Gone since it was read", "mind_write's answer when the file the call's version names no longer exists.", "{{file}} no longer exists (you gave version {{given}}). Read the mind again, and write the file anew.", [file, v("given", "the version the call gave", true)]),
  answerPrompt(MINDS_NOTE.writeRefused, "The workspace refused a write", "mind_write's answer when the workspace refused the write for its own reason.", "{{file}} wasn't written: {{reason}}", [file, v("reason", "the workspace's reason", true)]),
  answerPrompt(MINDS_NOTE.written, "Written", "Ends mind_write's answer once the file is written.", "Written. It is part of this mind from now on."),
  answerPrompt(MINDS_NOTE.toUnknown, "No such beat", "mind_digested's answer when to names no beat on the story's path.", "{{to}} is no beat of the story as it stands. Give the last beat feed_read gave you.", [v("to", "the beat the call named", true)]),
  answerPrompt(MINDS_NOTE.toDone, "Taken in already", "mind_digested's answer when to is at or before what was marked already.", "You took in everything up to {{to}} already. Read your feed again (feed_read) for anything newer.", [v("to", "the beat the call named", true)]),
  answerPrompt(MINDS_NOTE.digested, "Marked as taken in", "mind_digested's answer once the mark is kept.", "Marked: your next feed_read starts after this beat."),
  answerPrompt(MINDS_NOTE.turnOver, "The turn is over", "mind_digested's answer when the turn it would be kept with has ended.", "The turn this belongs to is over, so nothing was marked. Say so in your answer."),
  answerPrompt(MINDS_NOTE.afterReply, "Not during the turn", "mind_write's and mind_digested's answer to a character's own run inside a turn: a scene or the direct line.", "Writing your mind and marking what reached you as taken in are the work of the run after the reply, not of this moment. Act and answer now: you take it in then."),
  answerPrompt(MINDS_NOTE.seedHead, "What is held of someone", "Opens mind_seed's answer.", "What the engine holds of {{name}} ({{standing}}), to write who they are at heart. Write core.md yourself with mind_write, in your own words: their nature and history, how they speak, what they want and fear, and what they know of their past, in outline where you know it only in outline. Leave out what they couldn't know: a secret marked as kept from them stays out.", [name, standing]),
  answerPrompt(MINDS_NOTE.seedSheet, "Their record, heading", "Heads the part of mind_seed's answer that gives the person's record in the world.", "## Their record in the world"),
  answerPrompt(MINDS_NOTE.seedMind, "The older mind, heading", "Heads the part of mind_seed's answer that gives what the older engine's mind of them held.", "## What the older engine's mind of them held"),
  answerPrompt(MINDS_NOTE.seedKnows, "What they knew, heading", "Heads the part of mind_seed's answer that gives what they knew.", "## What they knew"),
  answerPrompt(MINDS_NOTE.seedFiles, "Their files, heading", "Heads the part of mind_seed's answer that gives their mind's files as they stand.", "## Their mind's files as they stand"),
  answerPrompt(MINDS_NOTE.playerFights, "The player's character fights as played", "mind_fight's answer to the player's character's own agent.", "The player's character fights as the player plays them: the author's fight_round takes their action. Say so in your answer."),
];

/** The character agent's definition id (`HARNESS_AGENT.character`, which this file can't import). */
const CHARACTER = "character";

/** The character agent as shipped: one definition, an instance for each principal (`as`). */
export const MINDS_AGENT_TEXTS: readonly HarnessAgentText[] = [
  {
    id: CHARACTER,
    label: "A character",
    name: "Character",
    description: "One principal's own mind: a person in the story, who knows only what reached them. Start one as that person (as: their id): in a scene to decide what they do and say; on the direct line (to_reply) to answer the player in the story's prose; after the reply to digest what reached them; in the background to prepare for what may come; in a prepared start to relive their past. Only a principal has one.",
    instructions: lines(
      "You are one person in a story, the one you were started as. You are not its narrator and not its author: you are them.",
      "",
      "Your mind is who you are at heart (core.md, which the author and the player write), what you know only in outline of a past you didn't live through here (outline.md, when there is one), and what your own senses and judgement have made of the world since (now.md, memory.md, beliefs.md, people.md and plans.md, which you write, in your own voice). mind_read reads it; mind_write writes your own files.",
      "",
      "You know only what reached you. Your feed (feed_read) gives what you saw, heard or were told since you last took things in, as it reached you: perhaps only part of it, perhaps second hand. What you make of it can be wrong, and you act on what you believe. Never reach for what you could not have sensed or been told.",
      "",
      "The author keeps the world: where everyone is, what happens around you, and whom what you do reaches. You decide only what you think, feel, say and do.",
      "",
      "How to judge:",
      "- Be the person: their wants, fears, habits and voice. Act from who you are and what you believe now, never from what would suit the story.",
      "- Everyone else decides for themselves. Never say what someone else does, says or feels.",
      "- Keep your files true to you and short: what a person like you would carry. Rewrite rather than pile up.",
      "- Your task says what kind of run this is. Load its skill (skill_load): character_scene in a scene or on the direct line, character_digest after the reply, character_prepare in the background, character_relive in a prepared start.",
      "- A tool's refusal says what to do. When it says no agent may act as this person, say so in your answer and stop.",
    ),
  },
];

/** The character agent's skills as shipped, one for each kind of run: each offered to the character alone, which holds every tool they name. */
export const MINDS_SKILL_TEXTS: readonly HarnessSkillText[] = [
  {
    id: MINDS_SKILL.scene,
    agents: [CHARACTER],
    name: "In a scene",
    description: "For a character in a scene or on the direct line: deciding what you do and say now, recording it as your own beat, and answering briefly, or on the direct line with the passage itself.",
    body: lines(
      "# In a scene",
      "",
      "Something just happened around you, and it is your move. Your task says what reached you and where you stand. Your feed (feed_read) holds anything newer that reached you, and now.md how you meant to meet a moment like this. Read them once.",
      "",
      "Decide what you do and say now, as yourself: a line, an act, both, or pointedly nothing. Keep to this moment, and leave others to answer for themselves.",
      "",
      "Record it with beat_write, as your own: what you truly do or say, what someone there could see or hear of it, the exact words you speak, and whom you speak to. A thought you keep to yourself is an inner beat: it reaches no one. Leave who it reached to the engine and the author unless you know better.",
      "",
      "Then answer in a line or two: what you did and said. Write nothing in your files and mark nothing as taken in here: that is the work of the run after the reply (character_digest).",
      "",
      "When your task says your answer goes straight to the reader (the direct line), your answer is the passage itself, after your beat is recorded: your words and what anyone could see you do, written as the prose guidance you were given says. Your private thoughts stay out of it, and so does anyone else's doing. Keep it to the length of a reply to a line.",
    ),
  },
  {
    id: MINDS_SKILL.digest,
    agents: [CHARACTER],
    name: "Digesting",
    description: "For a character after the reply: taking in what reached you, writing what you noticed, believe, think of others and mean to do, and marking your feed as taken in.",
    body: lines(
      "# Digesting",
      "",
      "The moment has passed. Now you take in what reached you, as a person does afterwards.",
      "",
      "Read your feed (feed_read) and your mind (mind_read). Then write what changed, in your own voice:",
      "- memory.md: what you noticed and will remember, as you lived it.",
      "- beliefs.md: what you now believe, and how sure you are.",
      "- people.md: what you think the others think and want, and how you feel about them.",
      "- plans.md: what you mean to do, and when.",
      "- now.md: where you stand at this moment.",
      "",
      "Change only what changed. Someone like you notices some things and misses others, and reads people through their own hopes and fears: so may you, and you may be wrong. Never add what you could not have sensed or been told, whatever you suspect the story holds. When a file grows long, write it whole and shorter, and let the small things fade.",
      "",
      "Then mark your feed as taken in (mind_digested) with the last beat feed_read gave you. If it said more remain, read again and go on. Answer in a line: what changed in you.",
    ),
  },
  {
    id: MINDS_SKILL.prepare,
    agents: [CHARACTER],
    name: "Preparing",
    description: "For a character in the background: getting ready for what is likely to come next, kept short in now.md, so your next scene is quick.",
    body: lines(
      "# Preparing",
      "",
      "Nothing is happening to you now. Use the quiet to get ready, so that when the story turns to you, you can answer at once.",
      "",
      "Read your mind (mind_read), and your feed (feed_read) if anything new reached you. Think about what is likely to come next for you: who you may meet, what they may say or ask, what you may have to decide. For the few likeliest, settle how you would meet them, as yourself.",
      "",
      "Keep it short, in now.md: where you stand, what is on your mind, and how you would likely meet what may come. Write it whole and keep it small. Prepare only from what you know, never from what the story holds that never reached you. Answer in a line.",
    ),
  },
  {
    id: MINDS_SKILL.relive,
    agents: [CHARACTER],
    name: "Reliving",
    description: "For a character in a prepared start: living through your own past a stretch at a time, as it reached you then, and taking it in as you would have.",
    body: lines(
      "# Reliving",
      "",
      "The story is being prepared, and you are living through your own past, a stretch at a time. What reached you then is in your feed (feed_read), oldest first, at the story times it happened.",
      "",
      "Take it in as you lived it then, without knowing what came after: what you noticed, what you made of it, what you came to believe and want, how you saw the people around you. Write it into memory.md, beliefs.md, people.md and plans.md as you would have then, and let later moments change your mind as they come. core.md says who you are at heart, and outline.md what you know only in outline of the stretches you don't relive.",
      "",
      "After each stretch, mark your feed as taken in (mind_digested) with the last beat feed_read gave you, and go on while more remain. At the end, now.md says where you stand as the story resumes. Answer in a line: how far you lived, and what stays with you.",
    ),
  },
];
