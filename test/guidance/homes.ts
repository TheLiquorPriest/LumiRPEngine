// Appendix D.2: what the shipped guidance asks for, and the one file that asks (plan §17.2). Each row
// names its home as a file of the shipped set, as RPH's loader sees it (`set.ts`); `family guide` is a
// row whose home is one file per family of tools (`.tools/<family>.md`), which no single path names.
// The rows are the plan's own and the ones the build added for every shipped behaviour (N-11); the
// reminders are in force only while the home each names is, and the six are all there are.

export interface Row {
  /** The behaviour, as shipped. */
  behaviour: string;
  /** Its one home: a path in the shipped set, or `family guide`. */
  home: string;
  /** What the agents do with the home off. */
  off: string;
  /** How it is tested (plan §17.2): `off` switches the home off and the behaviour stops; `edit` changes it and the behaviour follows. */
  test: string;
}

export const HOMES: readonly Row[] = [
  { behaviour: "The intent record, first: wants, scope, story lane, engine lane, needs", home: "TURN.md", off: "No record is written", test: "off" },
  { behaviour: "Looking where the message points, then saying how deep to go and why (Direct, Assisted, Full)", home: "TURN.md", off: "No such line; the Author just answers", test: "off" },
  { behaviour: "Settling the engine lane each turn, or saying nothing changed", home: "TURN.md", off: "The engine lane is recorded only when the Author happens to", test: "off" },
  { behaviour: "Asking the GM to set the map when a scene opens on a mapped place with nobody on it", home: "TURN.md", off: "Nobody is placed until someone asks", test: "off" },
  { behaviour: "Reading its own reply for what it established", home: "TURN.md", off: "Not done", test: "off" },
  { behaviour: "An overlay when a turn leaves a lore entry behind", home: "TURN.md", off: "None written", test: "off" },
  { behaviour: "An intention and a whereabouts for a principal who leaves; what it did meanwhile when it returns", home: "TURN.md", off: "Not recorded", test: "off" },
  { behaviour: "Adding to the player model", home: "TURN.md", off: "Not done", test: "off" },
  { behaviour: "The horizon for the next turn", home: "TURN.md", off: "It stays where it was", test: "off" },
  { behaviour: "Keeping the record ahead of the window: beats every turn, scenes and chapters summarized, old beats summarized", home: "TURN.md", off: "Beats only when the Author happens to record them", test: "off" },
  { behaviour: "When a scene ends, and when a chapter turns", home: "TURN.md", off: "The Author's own judgment, unprompted", test: "edit" },
  { behaviour: "Starting the mapping, indexing and summarizing jobs", home: "TURN.md", off: "Started only by you", test: "off" },
  { behaviour: "Writing a turn's steps down with `todo` when there are several", home: "TURN.md", off: "No list is kept", test: "off" },
  { behaviour: "Handing the prose to the narrator when the threshold is met", home: "WRITING.md", off: "The Author writes every reply itself", test: "edit" },
  { behaviour: "Reading a narrator's draft before release; sending it back with what to change, or cutting it", home: "WRITING.md", off: "Drafts go out unread", test: "edit: the hand-off is kept and the paragraph on the draft is changed" },
  { behaviour: "What leads when story, lore and rules disagree; going on when a sum does not balance", home: "SIMULATION.md", off: "No order is given. Code applies and reports either way", test: "edit" },
  { behaviour: "When the GM rolls", home: "SIMULATION.md", off: "The GM's own judgment", test: "edit" },
  { behaviour: "Consent: look it up, ask the Author, a gap check before inventing; positions and plain layouts are not gaps", home: ".rules/consent.md", off: "Agents fill gaps as models do", test: "off" },
  { behaviour: "Perceptions: for every principal and supporting character on stage, per moment; the player's character perceived as it acts; a secret the player's character learns recorded as theirs; memory work and when it runs", home: ".rules/perceptions.md", off: "None are written, a learned secret stays kept from the player, and no memory work is asked for", test: "off" },
  { behaviour: "Saving what matters before a compaction", home: ".rules/save-before-compaction.md", off: "Compaction goes straight ahead", test: "off" },
  { behaviour: "Saying where a recorded thing comes from", home: "ALL-AGENTS.md", off: "Sources are given only by chance", test: "off" },
  { behaviour: "Never deciding for the player's character", home: "ALL-AGENTS.md", off: "The model's own habits, and whatever the preset says", test: "edit, on a test preset with no line of its own about the player's character" },
  { behaviour: "What the narrator may add (texture, not facts), and not deciding for the player's character", home: ".agents/narrator.md", off: "The narrator writes as the prompt alone has it", test: "off" },
  { behaviour: "How the GM rules, stages changes, decides what time brings due, and when it loads the map skill", home: ".agents/gm.md", off: "It answers what it is asked, its own way", test: "edit" },
  { behaviour: "How a character answers in a scene, and takes in what happened after it", home: ".agents/character.md", off: "It answers as the model would", test: "edit" },
  { behaviour: "Casting: each member of a group chat is a principal; the rest by their part in the story", home: ".skills/casting/SKILL.md", off: "No casting until the Author does it unprompted", test: "edit" },
  { behaviour: "How a sandbox is run: a scene sheet, a round per moment, characters together; no agent for the player's character", home: ".skills/sandbox/SKILL.md", off: "The Author runs agents its own way", test: "edit" },
  { behaviour: "Map upkeep: placing by prose, lore and plain sense, marked assumed; a room grid where the map is too coarse or missing; measuring instead of guessing", home: ".skills/places-and-maps/SKILL.md", off: "The GM uses the map tools its own way", test: "edit" },
  { behaviour: "Bootstrap: what \"done enough\" means; 8 key moments per principal", home: ".skills/bootstrap/SKILL.md", off: "The job has no stated end", test: "edit" },
  { behaviour: "What an index line holds", home: ".agents/indexer.md", off: "The indexer has no instructions", test: "edit: a field is added, and the lines carry it" },
  { behaviour: "How a prompt is mapped, with the kinds; which slices suit whom", home: "PRESET.md", off: "The raw layout serves as the map", test: "edit" },
  { behaviour: "Before the reply, only what the reply depends on (rulings, rolls, what characters do); the record comes after it", home: "TURN.md", off: "The Author orders its work its own way", test: "edit: changed to \"record before you write\", and the records land before the reply" },
  { behaviour: "The Author's record of the turn: the intent it read, what it decided and why (a departure from the files included), any ruling, any consent", home: "TURN.md", off: "No record of the turn is written", test: "off" },
  { behaviour: "What the reply established that nobody decided, recorded as canon or marked proposed", home: "TURN.md", off: "It stays unrecorded unless the Author happens to record it", test: "off" },
  { behaviour: "Touching the threads the turn moved, and updating the scene", home: "TURN.md", off: "Threads and the scene change only when the Author happens to", test: "off" },
  { behaviour: "Settling both lanes against an edited reply, or against the saved text where it differs from the released one", home: "TURN.md", off: "The record keeps what the reply first said", test: "off" },
  { behaviour: "After the player edits an earlier message, or an earlier reply shows another swipe: looking the stretch over and correcting what no longer holds", home: "TURN.md", off: "Nothing recorded since is corrected", test: "off" },
  { behaviour: "A stretch played without the Author: reading it and recording what matters, in passing or as a job", home: "TURN.md", off: "The stretch is not recorded", test: "off" },
  { behaviour: "A past nobody has read closely: reading that range when a turn touches it, and recording it", home: "TURN.md", off: "It is read only when the Author happens to", test: "off" },
  { behaviour: "On a chat with no premise yet: the premise and contract from the card, the preset and `WORLD.md`; `WORLD.md`, `SIMULATION.md` and `WRITING.md` offered as suggestions", home: "TURN.md", off: "The premise stays empty and nothing is suggested", test: "off" },
  { behaviour: "A place the turn changed: its \"since\", dated, with the beat that caused it", home: "TURN.md", off: "Only the lore overlay or the map shows the change", test: "off" },
  { behaviour: "A depth the player asked for on the composer: the turn played at that depth", home: "TURN.md", off: "The request is in the briefing and is weighed like anything else", test: "edit: changed to \"a requested depth is advice\", and the Turn page shows the Author choosing another" },
  { behaviour: "Redrawing the part of a principal's base the briefing lists as older than a bound source (§7.1 l.803; D-41)", home: "TURN.md", off: "No redraw is asked; the briefing goes on listing the base", test: "off" },
  { behaviour: "What the story is, by the chat's own choice: whose messages are the story, and whether the player's newest message is the turn's direction (R-176)", home: "TURN.md", off: "The Author reads the messages its own way; the chat tools still follow the setting", test: "edit" },
  { behaviour: "The narrator's brief: the beats in order, the outcomes, what must and must not be said, the point of view", home: "WRITING.md", off: "The Author briefs the narrator its own way", test: "edit" },
  { behaviour: "The narrator writing live only when the brief leaves nothing to add", home: "WRITING.md", off: "The Author chooses live or a draft its own way", test: "edit" },
  { behaviour: "What is tracked closely and what loosely", home: "SIMULATION.md", off: "Agents track what they happen to", test: "edit" },
  { behaviour: "Notes are notes: what should last goes through the state, cast or story tools", home: "ALL-AGENTS.md", off: "Facts may live only in notes; the Storage page shows where", test: "off" },
  { behaviour: "That the Author decides, and that the rules it reads are not its to set aside", home: ".agents/author.md", off: "The Author treats a rule like any other text", test: "edit" },
  { behaviour: "Bringing the record in line with a released reply: both lanes with sources, beats, threads; asking the Author about anything unclear", home: ".agents/keeper.md", off: "When delegated, it records as the model would", test: "edit" },
  { behaviour: "Reading a range for a stated purpose and recording each thing where it belongs, with the message it came from; summarizing a stretch that has beats and no summary", home: ".agents/historian.md", off: "It reads and records as the model would", test: "edit" },
  { behaviour: "Reading and changing the record with the Author's tools, explaining what it did, never writing a reply into the chat", home: ".agents/assistant.md", off: "It answers as the model would; it holds no reply tool either way", test: "edit" },
  { behaviour: "On a swipe or regenerate: another telling, not another world, unless the player's control or feedback asks for a fresh run with new rolls; reading why; not repeating the earlier attempt", home: "SWIPE.md", off: "A new reply written the Author's own way, the earlier attempts in view", test: "edit: changed to \"keep the prose, change the outcome\", and the next swipes change outcomes" },
  { behaviour: "After a deletion: checking what left with the deleted turns, and not referring to them", home: "DELETE.md", off: "The Author may refer to what was deleted", test: "off" },
  { behaviour: "Splitting a stretch of time into moments, and what each moment needs", home: ".skills/long-input/SKILL.md", off: "A long message is handled as one block", test: "edit" },
  { behaviour: "A closed scene's pass: its summary, the arcs of those in it, which threads are hot, futures", home: ".skills/scene-end/SKILL.md", off: "Whatever summary the Author writes unprompted", test: "edit" },
  { behaviour: "A chapter's pass: its summary; rereading the timeline against the premise, the arcs and the player model; rewriting what no longer fits", home: ".skills/chapter-pass/SKILL.md", off: "No reread is made", test: "edit" },
  { behaviour: "When something the story made belongs in the player's books, and how the entry is drafted", home: ".skills/lore-proposals/SKILL.md", off: "Proposals are offered the Author's own way, or not at all", test: "edit" },
  { behaviour: "How money is handled, with the tools it names", home: ".skills/economy/SKILL.md", off: "The tools are used by their descriptions alone", test: "edit" },
  { behaviour: "How items and wardrobe are handled, with the tools it names", home: ".skills/items-and-wardrobe/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How vehicles are handled, with the tools it names", home: ".skills/vehicles/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How a check is ruled and a sheet changed, with the tools it names", home: ".skills/ruleset-and-sheets/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How a fight is run, with the tools it names", home: ".skills/combat/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How a quest is opened, advanced and closed, with the tools it names", home: ".skills/quests/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How time is passed and what it brings due is recorded, with the tools it names", home: ".skills/time/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How groups and their powers are handled, with the tools it names", home: ".skills/groups/SKILL.md", off: "As above", test: "edit" },
  { behaviour: "How the tools of one family are called well (arguments, shapes, a worked call)", home: "family guide", off: "The tools are called by their descriptions alone", test: "edit, family by family" },
  { behaviour: "Sending a write that waits for the player's answer, because he set it to Confirm, alone or last in its message, since the message's other calls wait with it (R-200)", home: "family guide", off: "The other calls are sent beside it and wait for his answer", test: "edit" },
  { behaviour: "What a compaction's summary keeps and drops: the text a summary is written from", home: ".prompts/compaction.md", off: "The summary is written without a brief of what to keep", test: "edit" },
  { behaviour: "The line an agent goes on under after a rule stopped its reply", home: ".prompts/continue-after-rule.md", off: "The agent goes on with no line said", test: "edit" },
  { behaviour: "How the judging model is asked a rule's question (kept under N-9)", home: ".prompts/judge.md", off: "The judging model is asked with no words of the owner's", test: "edit" },
];

/** Every home that is one file, each once. */
export const HOME_FILES: readonly string[] = [...new Set(HOMES.map((row) => row.home).filter((home) => home !== "family guide"))];

/** The reminders (D.2): each its own file, in force only while the home it names is. A reminder of nothing a file asks has no home. */
export const REMINDERS: readonly { file: string; needs: string | null }[] = [
  { file: ".rules/perceptions-owed.md", needs: "perceptions" },
  { file: ".rules/perceptions-missing.md", needs: "perceptions" },
  { file: ".rules/memory-owed.md", needs: "perceptions" },
  { file: ".rules/memory-late.md", needs: "perceptions" },
  { file: ".rules/memory-scene-end.md", needs: "perceptions" },
  { file: ".rules/dream-due.md", needs: "perceptions" },
  { file: ".rules/unsourced.md", needs: "ALL-AGENTS" },
  { file: ".rules/engine-silent.md", needs: "TURN" },
  { file: ".rules/intent-owed.md", needs: "TURN" },
  { file: ".rules/history-leaving.md", needs: "TURN" },
  { file: ".rules/reply-missing.md", needs: null },
];
