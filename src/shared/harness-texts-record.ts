// What LumiRPEngine says to a model about the story record on the harness engine (DEPTH2-PLAN §4,
// §5): the beats that happened and whom each reached, what reached one person, the cast, and the
// drafts kept until the story needs them. Each tool's description and its arguments', and what those
// tools answer besides a result. Registry texts of the page "Harness engine", gathered by
// `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const RECORD_TOOL = {
  beatWrite: "beat_write",
  beatsRead: "beats_read",
  beatStrike: "beat_strike",
  feedRead: "feed_read",
  castSet: "cast_set",
  castList: "cast_list",
  draftOpen: "draft_open",
  draftSettle: "draft_settle",
  draftDrop: "draft_drop",
  draftsDue: "drafts_due",
} as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const RECORD_NOTE = {
  noRecord: "harness.note.record.no_record",
  notAuthorGm: "harness.note.record.not_author_gm",
  notAuthor: "harness.note.record.not_author",
  notWriter: "harness.note.record.not_writer",
  noSelf: "harness.note.record.no_self",
  notOwn: "harness.note.record.not_own",
  notOwnKind: "harness.note.record.not_own_kind",
  long: "harness.note.record.long",
  many: "harness.note.record.many",
  blank: "harness.note.record.blank",
  innerReach: "harness.note.record.inner_reach",
  reachActor: "harness.note.record.reach_actor",
  reachTwice: "harness.note.record.reach_twice",
  gotMissing: "harness.note.record.got_missing",
  proposed: "harness.note.record.proposed",
  staged: "harness.note.record.staged",
  written: "harness.note.record.written",
  full: "harness.note.record.full",
  closed: "harness.note.record.closed",
  offPath: "harness.note.record.off_path",
  noBasis: "harness.note.record.no_basis",
  noBeat: "harness.note.record.no_beat",
  struckAlready: "harness.note.record.struck_already",
  struck: "harness.note.record.struck",
  noDraft: "harness.note.record.no_draft",
  draftNotOpen: "harness.note.record.draft_not_open",
  budget: "harness.note.record.budget",
  pinned: "harness.note.record.pinned",
  playerCast: "harness.note.record.player_cast",
  badWhen: "harness.note.record.bad_when",
  feedNone: "harness.note.record.feed_none",
  feedMore: "harness.note.record.feed_more",
  beatsEarlier: "harness.note.record.beats_earlier",
  noAfter: "harness.note.record.no_after",
  noDue: "harness.note.record.no_due",
  stale: "harness.note.record.stale",
} as const;

const LANDS = "In a turn it is staged with the turn and kept when the turn commits. After the reply, it is written on the record of the turn the job belongs to.";
const STAMP = "a date and time in the world's calendar, at the player character's place, written as YYYY-MM-DD HH:MM";

/** The tools as shipped, in the order the Prompts page lists them. */
export const RECORD_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: RECORD_TOOL.beatWrite,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Writes one beat of the story record: what someone said or did, what the world did, or a thought, with whom it reached.",
    text: `Write one beat of the story record: something someone said or did, something the world did, or a thought. Give who did it (by), what kind it is, what happened as true (what), and what someone present could sense of it (surface). The author and the game master write any beat. A character's agent writes only its own: what that person says, does or thinks. Leave exposure out and nothing is written yet: the answer proposes whom it reached, everyone there, each as having taken in all of it. Call again with exposure as proposed, or adjusted: someone caught only part of it, someone was told of it, someone missed it. A thought reaches no one, so it needs no exposure. ${LANDS} Each person is given only what reached them of a beat, never what happened as true unless the beat is their own.`,
    args: [
      { path: "by", text: "Who did it: a person's id or name, player for the player's character, or world for what the world does. A character's agent gives the person it is." },
      { path: "kind", text: "say: words spoken. do: something done. happen: something the world does, no one's act. inner: a thought or a feeling, which reaches no one but its owner." },
      { path: "what", text: "What happened, as true, in a sentence or two." },
      { path: "surface", text: "What someone present could see or hear of it, as plainly as they would take it in. Leave it out only for a thought." },
      { path: "quotes", text: "The exact words spoken, each a quote of its own, without quotation marks." },
      { path: "to", text: "Whom it was addressed to: a list of ids or names, player for the player's character." },
      { path: "where", text: "Where it happened: a place's id or name. Left out: where the one who did it is." },
      { path: "when", text: `When it happened: ${STAMP}. Left out: now.` },
      { path: "exposure", text: "Whom it reached, and how: a list. Left out by the author or the game master, nothing is written: the answer proposes it from who is there. Left out by a person writing their own act, the beat is written as reaching everyone who is there." },
      { path: "exposure.who", text: "Who it reached: a person's id or name, or player." },
      { path: "exposure.reach", text: "whole: they took in all of it. part: they caught only part of it. told: they were told of it." },
      { path: "exposure.got", text: "For part and told: what they took in of it, in their own terms." },
      { path: "exposure.from", text: "For told: who told them, by id or name." },
      { path: "settles", text: "The id of the draft this beat plays out, when it does." },
    ],
  },
  {
    name: RECORD_TOOL.beatsRead,
    family: HARNESS_FAMILY.story,
    tier: "read",
    note: "Reads the beats on the chat's path, by person, place or time.",
    text: "Read the beats on the chat's path, oldest first: what happened as true, who did it, where and when, whom each reached and how, and why one that was struck no longer stands. Narrow them by a person (beats by them, to them, or that reached them), by a place, or by a time to start from. It gives the latest that fit, each whole, as many as the player allows, and says how many earlier ones it left out and how to read them. The author and the game master read it; a character's agent never does.",
    args: [
      { path: "who", text: "Only beats by this person, addressed to them, or that reached them: an id or a name, or player." },
      { path: "where", text: "Only beats at this place: an id or a name." },
      { path: "since", text: `Only beats from this time on: ${STAMP}.` },
      { path: "struck", text: "false: leave out beats that no longer stand. Left out, they are listed, each with why." },
      { path: "before", text: "Only beats before this one on the path: a beat's id, as an earlier answer names the oldest it gave. Left out: up to the newest." },
    ],
  },
  {
    name: RECORD_TOOL.beatStrike,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Strikes a beat that should not stand: a correction. It answers whom the beat had reached.",
    text: `Strike a beat that should not stand: a correction. The beat stays in the record with why, and no one is fed it any more. The answer says whom it had reached, so their minds can be set right. ${LANDS} It is undone with the turn that struck it.`,
    args: [
      { path: "beat", text: "The beat's id, as beats_read gives it." },
      { path: "why", text: "Why it no longer stands, in a sentence." },
    ],
  },
  {
    name: RECORD_TOOL.feedRead,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    note: "Gives a character what reached them since they last took things in, each beat as it reached them.",
    text: "What reached you, the one person you are, since you last took things in: each beat as it reached you. Your own acts and thoughts come whole. What you saw or heard comes as you could sense it, with who did it. What you caught only part of, or were told, comes as what you got of it, and who told you. Nothing else of what happened is given to you, and nothing that no longer stands. It gives the oldest first, as many as the player allows, and says how many more wait. last is the beat it read up to: what marks these as taken in.",
    args: [{ path: "after", text: "Read on past this beat: last from an earlier answer. Left out: from the last beat you took in." }],
  },
  {
    name: RECORD_TOOL.castSet,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Sets someone's standing in the story, with why. The author's alone.",
    text: `Set someone's standing in the story, with why. extra: no mind of their own; you voice them. supporting: a short profile you keep. principal: an agent and a mind of their own. A standing the player pinned is theirs: it is refused, and you can ask the player in your answer. The player's character is never cast: whether they have a mind is the player's setting. ${LANDS} Only the author casts.`,
    args: [
      { path: "who", text: "The person: an id or a name." },
      { path: "standing", text: "extra, supporting or principal." },
      { path: "why", text: "Why, in a sentence: what the story needs of them." },
    ],
  },
  {
    name: RECORD_TOOL.castList,
    family: HARNESS_FAMILY.story,
    tier: "read",
    note: "Lists the cast as it stands.",
    text: "List the cast as it stands: each person cast, their standing and why, whether the player pinned it, and the last beat their mind took in. Anyone not listed is an extra. The author and the game master read it.",
    args: [{ path: "standing", text: "Only those of this standing: extra, supporting or principal." }],
  },
  {
    name: RECORD_TOOL.draftOpen,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Opens a draft: off-screen work kept until the story needs it, within the player's story budget.",
    text: `Open a draft: off-screen work kept until the story needs it. Say what happens, how it is to be treated, who and where it concerns, and when in story time. Tier 1: the characters live it. 2: you play every part. 3: you and the game master decide it and brief the characters. 4: you just write it. Tiers 1 to 3 count against the player's story budget for any stretch of story time (Settings → Story → Budget): past it the draft is refused, and you choose a lighter tier. drafts_due answers it once its time comes, or once the story moves against it. ${LANDS}`,
    args: [
      { path: "what", text: "What happens, in a few sentences." },
      { path: "tier", text: "How it is to be treated: 1, 2, 3 or 4." },
      { path: "who", text: "The people it concerns: a list of ids or names, player for the player's character." },
      { path: "where", text: "The places it concerns: a list of ids or names." },
      { path: "when", text: `When it happens: ${STAMP}.` },
      { path: "notes", text: "What you want to remember about it." },
    ],
  },
  {
    name: RECORD_TOOL.draftSettle,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Settles a draft: what it held now stands in the story.",
    text: `Settle a draft: what it held now stands in the story, played out or written. Write the beats it comes to with beat_write, settles set to its id. ${LANDS}`,
    args: [
      { path: "draft", text: "The draft's id, as drafts_due gives it." },
      { path: "notes", text: "How it came out, in a sentence or two." },
    ],
  },
  {
    name: RECORD_TOOL.draftDrop,
    family: HARNESS_FAMILY.story,
    tier: "write",
    note: "Drops a draft: it will not happen.",
    text: `Drop a draft: it will not happen. ${LANDS}`,
    args: [
      { path: "draft", text: "The draft's id, as drafts_due gives it." },
      { path: "why", text: "Why it won't happen, in a sentence." },
    ],
  },
  {
    name: RECORD_TOOL.draftsDue,
    family: HARNESS_FAMILY.story,
    tier: "read",
    note: "Answers the open drafts whose time has come, and those gone stale.",
    text: "The open drafts the story needs now: each whose time has come, and each gone stale. A draft goes stale when the point of the chat it was written against left the path, or when beats were played after it was opened, at or past its time, in a place or with a person it names: those beats come with it, for you to judge. Settle or drop each, or open it again as it now stands.",
    args: [{ path: "all", text: "true: list every open draft, due or not." }],
  },
];

const tool = v("tool", "the tool called", true);
const field = v("field", "what was too long, or listed too many", true);
// Not required: a user's own wording saved before the row was named still loads, only without it (`promptSettingsOf` drops a text missing a required placeholder).
const row = v("row", "the label of the player's row that sets the limit, under Settings → Story → The record's limits");
const who = v("who", "the person's id, or player", true);

export const RECORD_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(RECORD_NOTE.noRecord, "No story record here", "A story tool's answer where the call reaches no story record: no harness turn or job holds it.", "The story record isn't reachable from this call, so nothing was read or written. It is kept for the agents of a turn on a chat the harness plays, and for its jobs."),
  answerPrompt(RECORD_NOTE.notAuthorGm, "The author's and the game master's", "A story tool's answer to an agent that is neither the author nor the game master.", "{{tool}} is for the author and the game master. A character's agent reads only what reached its person (feed_read) and writes only its own acts (beat_write).", [tool]),
  answerPrompt(RECORD_NOTE.notAuthor, "The author's alone", "cast_set's answer to any agent but the author.", "{{tool}} is the author's alone: casting is the author's judgement. Nothing was changed.", [tool]),
  answerPrompt(RECORD_NOTE.notWriter, "Not a writer of beats", "beat_write's answer to an agent that is neither the author, the game master, nor a character's agent.", "{{tool}} is for the author, the game master, and a character's agent for its own acts. Nothing was written.", [tool]),
  answerPrompt(RECORD_NOTE.noSelf, "A character with no person", "beat_write's and feed_read's answer to a character's agent that runs as no one.", "Your agent runs as no one, so it has no person of its own to read or write for. The author starts a character's agent as the person it is. Nothing was read or written."),
  answerPrompt(RECORD_NOTE.notOwn, "Someone else's act", "beat_write's answer when a character's agent writes a beat by someone other than the person it is.", "You are {{self}}, so you write only your own acts: what you say, do or think. {{other}} is someone else to write. Nothing was written.", [v("self", "the person the agent is", true), v("other", "who the call said did it", true)]),
  answerPrompt(RECORD_NOTE.notOwnKind, "Not a character's to write", "beat_write's answer when a character's agent writes something the world does.", "A character writes only what they say, do or think. What the world does is the author's to write. Nothing was written."),
  answerPrompt(RECORD_NOTE.long, "Too long", "A story tool's answer when a text is longer than the player's limit, named by its row (Settings → Story → The record's limits).", "{{field}} is {{size}} characters long, and holds at most {{max}} (the player's limit: {{row}}, in Settings → Story → The record's limits). Say it in fewer words and call again. Nothing was written.", [field, v("size", "how long it is"), v("max", "the most it holds", true), row]),
  answerPrompt(RECORD_NOTE.many, "Too many", "A story tool's answer when a list holds more than the player's limit, named by its row (Settings → Story → The record's limits).", "{{field}} lists {{count}}, and holds at most {{max}} (the player's limit: {{row}}, in Settings → Story → The record's limits). Keep the ones that matter and call again. Nothing was written.", [field, v("count", "how many the call gave"), v("max", "the most it holds", true), row]),
  answerPrompt(RECORD_NOTE.blank, "Can't be blank", "A story tool's answer when a text it needs is blank.", "{{field}} can't be blank. Nothing was written.", [field]),
  answerPrompt(RECORD_NOTE.innerReach, "A thought reaches no one", "beat_write's answer when an inner beat is given exposure.", "A thought reaches no one but its owner, so give no exposure for an inner beat. Nothing was written."),
  answerPrompt(RECORD_NOTE.reachActor, "The one who did it", "beat_write's answer when exposure names whoever did the beat.", "{{who}} did it, so it is theirs, not something that reached them. Leave them out of exposure. Nothing was written.", [who]),
  answerPrompt(RECORD_NOTE.reachTwice, "Someone named twice", "beat_write's answer when exposure names someone twice.", "{{who}} is in exposure twice. Name each person once. Nothing was written.", [who]),
  answerPrompt(RECORD_NOTE.gotMissing, "What they got", "beat_write's answer when someone reached part of a beat, or was told of it, without what they got.", "{{who}} took in {{reach}} of it, so say what they got (got). Nothing was written.", [who, v("reach", "part or told", true)]),
  answerPrompt(RECORD_NOTE.proposed, "Exposure proposed", "What beat_write says when exposure was left out and it proposes it from who is there.", "Nothing was written yet. exposure is who is there: each as having taken in all of it. Call beat_write again with the same beat and exposure, as proposed or adjusted."),
  answerPrompt(RECORD_NOTE.staged, "Staged with the turn", "Where a story change stands in a turn.", "Staged with the turn: it is kept when the turn commits, and goes if the turn doesn't stand."),
  answerPrompt(RECORD_NOTE.written, "Written on the record", "Where a story change stands after the reply.", "Written on the record of the turn this job belongs to."),
  answerPrompt(RECORD_NOTE.full, "The turn's record holds enough", "A story tool's answer when the turn's record would hold more beats or drafts than the player allows, named by its row (Settings → Story → The record's limits).", "This turn's record holds {{count}} {{what}} already, the most it keeps (the player's limit: {{row}}, in Settings → Story → The record's limits). Nothing was written.", [v("count", "how many it holds", true), v("what", "beats or drafts", true), row]),
  answerPrompt(RECORD_NOTE.closed, "The turn is over", "A story tool's answer when the turn it was called in is over.", "The turn is over, so nothing more is staged with it. Nothing was written."),
  answerPrompt(RECORD_NOTE.offPath, "Off the chat's path", "A story tool's answer in a job whose turn's record left the chat's path.", "The turn this job belongs to is no longer on the chat's path: its reply was swiped away, deleted, or something before it was edited. Nothing was written. Stop here."),
  answerPrompt(RECORD_NOTE.noBasis, "No record to write on", "A story tool's answer in a run whose turn never wrote its record.", "The turn this run belongs to left no record on the chat to write on. Nothing was written."),
  answerPrompt(RECORD_NOTE.noBeat, "No such beat", "A story tool's answer when a beat it names isn't on the chat's path.", "No beat {{beat}} is on the chat's path. beats_read lists them, each by its id.", [v("beat", "the id the call gave", true)]),
  answerPrompt(RECORD_NOTE.struckAlready, "Struck already", "beat_strike's answer for a beat that no longer stands already.", "Beat {{beat}} no longer stands already: {{why}}", [v("beat", "the beat's id", true), v("why", "why it was struck", true)]),
  answerPrompt(RECORD_NOTE.struck, "Struck", "What beat_strike says of a beat it struck.", "It no longer stands, and no one is fed it any more. Those it reached may still hold it in mind."),
  answerPrompt(RECORD_NOTE.noDraft, "No such draft", "A draft tool's answer when the draft it names isn't on the chat's path.", "No draft {{draft}} is on the chat's path. drafts_due with all set to true lists the open ones.", [v("draft", "the id the call gave", true)]),
  answerPrompt(RECORD_NOTE.draftNotOpen, "Not open", "A draft tool's answer for a draft that is settled or dropped already.", "Draft {{draft}} is {{state}} already, so nothing was changed.", [v("draft", "the draft's id", true), v("state", "settled or dropped", true)]),
  answerPrompt(
    RECORD_NOTE.budget,
    "Past the story budget",
    "The answer of draft_open, and of the scene tools, when a T1, T2 or T3 treatment would pass the player's story budget (Settings → Story → Budget).",
    "A T{{tier}} treatment would pass the player's story budget: any {{stretch}} of story time holds at most {{limit}}, and this one has {{used}}. Choose a lighter tier, or ask the player to raise it in Settings → Story → Budget. Nothing was opened.",
    [v("tier", "1, 2 or 3", true), v("stretch", "the stretch of story time, in words", true), v("limit", "the most the budget allows", true), v("used", "how many the stretch holds")],
  ),
  answerPrompt(RECORD_NOTE.pinned, "Pinned by the player", "cast_set's answer for someone whose standing the player pinned.", "The player pinned {{name}} as {{standing}}, so their standing is the player's to change. Nothing was changed. Ask the player in your answer if the story needs otherwise.", [v("name", "the person", true), v("standing", "the standing they pinned", true)]),
  answerPrompt(RECORD_NOTE.playerCast, "The player's character", "cast_set's answer for the player's character.", "{{name}} is the player's character. Whether they have a mind is the player's setting, so they aren't cast. Nothing was changed.", [v("name", "the player's character", true)]),
  answerPrompt(RECORD_NOTE.badWhen, "A time it can't read", "A story tool's answer when a time isn't one the world's calendar reads.", "{{arg}} isn't a time the world's calendar reads. Write it as {{now}} is written: a date and a time, YYYY-MM-DD HH:MM.", [v("arg", "the argument", true), v("now", "the time now, as it is written", true)]),
  answerPrompt(RECORD_NOTE.feedNone, "Nothing new", "What feed_read says when nothing reached the person since they last took things in.", "Nothing new reached you since you last took things in."),
  // setting, most and chars aren't required: a player's own wording saved before they were named still loads, only without them (`promptSettingsOf` drops a text missing a required placeholder).
  answerPrompt(RECORD_NOTE.feedMore, "More wait", "What feed_read says when more items wait past those it gave: how many, what bounds one read (the setting, Settings → Story → The record's limits, and the characters one read gives whole), and how to read on.", "{{more}} more wait after these: one read gives at most {{most}} ({{setting}}, Settings → Story → The record's limits) and {{chars}} characters. Read on with after set to last.", [v("more", "how many more", true), v("setting", "the setting's label"), v("most", "the most one read gives"), v("chars", "the most characters one read gives whole")]),
  answerPrompt(RECORD_NOTE.beatsEarlier, "Earlier beats left out", "What beats_read says when earlier beats that fit were left out: how many, what bounds one read (the setting, Settings → Story → The record's limits, and the characters one read gives whole), and how to read them.", "{{earlier}} earlier beats that fit are left out: one read gives at most {{most}} ({{setting}}, Settings → Story → The record's limits) and {{chars}} characters. Read them with before set to {{first}}.", [v("earlier", "how many are left out", true), v("setting", "the setting's label", true), v("most", "the most one read gives", true), v("chars", "the most characters one read gives whole", true), v("first", "the id of the oldest beat given", true)]),
  answerPrompt(RECORD_NOTE.noAfter, "Not a beat to read past", "feed_read's answer when after names no beat on the chat's path.", "No beat {{beat}} is on the chat's path. Leave after out to read from the last beat you took in.", [v("beat", "the id the call gave", true)]),
  answerPrompt(RECORD_NOTE.noDue, "Nothing due", "What drafts_due says when no open draft is due or stale.", "No open draft is due or stale now."),
  answerPrompt(RECORD_NOTE.stale, "Stale", "What drafts_due says of a stale draft.", "The story moved since this draft was opened. Judge whether it still holds: settle it, drop it, or open it again as it now stands."),
];
