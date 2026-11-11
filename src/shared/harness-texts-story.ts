// What LumiRPEngine says to a model about recording what the reply told (the changes a reply's read records on the classic and agents engines), putting a thing away and taking something out of what holds it, on the harness engine: each tool's
// description and its arguments', and what those tools answer besides a result. Registry texts of the
// page "Harness engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";
import type { ExtractionType } from "./settings";

/** The tools, by name. */
export const STORY_TOOL = { record: "story_record", away: "item_away", takeOut: "gm_take_out" } as const;

/**
 * The kinds of change `story_record` records, each an argument of its own: the change types a
 * reply's read gives on the other engines that no other tool notes. A walk-on, a purchase, a place
 * made, a revenue stream and a project's setback have a note tool each, and a thing its own tools,
 * which hold the turn's caps and ask first where a change to a thing must.
 */
export const STORY_TYPES = ["location", "condition", "regard", "transfer", "quantity", "life", "knows", "routine", "membership", "employment", "agenda", "vote", "approval", "time_advance"] as const satisfies readonly ExtractionType[];
export type StoryType = (typeof STORY_TYPES)[number];

/** What these tools answer besides a result: ids, so code names each once. */
export const STORY_NOTE = {
  afterReply: "harness.note.story.after_reply",
  oneChange: "harness.note.story.one_change",
  badFact: "harness.note.story.bad_fact",
  noField: "harness.note.story.no_field",
  offer: "harness.note.story.offer",
  notQuoted: "harness.note.story.not_quoted",
  notNamed: "harness.note.story.not_named",
  bound: "harness.note.story.bound",
  noStep: "harness.note.story.no_step",
  timeMinutes: "harness.note.story.time_minutes",
  timeAsk: "harness.note.story.time_ask",
  timeTooMuch: "harness.note.story.time_too_much",
  awayNowhere: "harness.note.story.away_nowhere",
  badId: "harness.note.story.bad_id",
} as const;

// What every change that quotes the reply says of `said`: the read holds it to the reply's own words.
const said = '"said": "the reply\'s own words that state it, copied exactly"';

/** Each kind of change as the reply's read gives it on the other engines: what it is, and its fields. */
const CHANGE_TEXT: Readonly<Record<StoryType, string>> = {
  location: 'Someone or something moved: {"entity": "who or what, an id or a name; the player character when left out", "place": "where they are now: a place\'s id or name"}. Only a move the reply tells, to a place the world has: a place it lacks is made with place_make, which puts them there.',
  condition: 'A condition came over someone, or left them: {"who": "the person, an id or a name; the player character when left out", "condition": "its name, such as tired or injured", "minutes": 90, "clear": true}. minutes: how long it lasts, only when the reply says; clear: true only when the condition ends.',
  regard: 'How one person feels about another changed: {"from": "who feels it, an id or a name", "to": "about whom", "axis": "one of the world\'s regard axes, as people_regard lists them", "delta": -2}. delta: as far as the reply moves it, inside the axis\'s range: worse negative, better positive. Only a clear change the reply states.',
  transfer: 'Money changed hands: {"from": "who paid", "to": "who was paid", "amount": 20, "method": "cash"}. from and to are people, by id or name, or a person\'s own cash, checking, savings or card account, never things. amount: a plain amount as the reply writes it (20 for 20.00). method: cash when bills or coins change hands in person; leave it out for a bank transfer, an app payment or a card. A purchase covers its own payment: no transfer for one.',
  quantity: 'A count of things went up or down: {"entity": "who has them, an id or a name", "item": "the thing, by its id, its name or words for it", "delta": -1}. delta: how many more (positive) or fewer (negative), a whole number.',
  life: 'Someone died, is dying, collapsed or came round: {"entity": "who, an id or a name", "state": "one of the world\'s life states, such as dead"}. Only when the reply states it, or has the player character told so; never a threat, a fear or a guess.',
  knows: 'The player character newly learned of a public person, thing or place from what the reply says or shows: {"fact": "its id, or a place\'s name as the reply gives it"}. Never a sentence or what they learned about it, never one already known, never what others learn.',
  routine: 'Someone\'s week changed for good: {"entity": "who, an id or a name; the player character when left out", "change": "start for a new job, shift or habit, stop for one given up, move for a new home", "label": "what it is, in a few words", "days": "weekday names, weekdays, weekends or daily", "start": "HH:MM, or morning, afternoon, evening or night", "end": "HH:MM", "minutes": 60, "activity": "work, school, exercise, leisure, socialize or errand", "place": "a place\'s id or name, or home or work; for move, the new home", "with": ["people\'s ids or names"], "replaces": true}. replaces: true only when the reply says it takes the place of what they did then. Only a lasting change the reply states of the player character or of someone it names; never a one-off, a plan, a wish or a habit only mentioned.',
  membership: `Someone joined or left an organization, was appointed to a position or took a title: {"who": "the person, by id or name", "org": "the organization, by id or name", "change": "join, leave, appoint or title", "position": "for appoint, or a join into one: one of the organization's positions, by its id or title", "title": "for title, or a join with one: the words they go by now", "by": "who made the change, when the reply says; never the one it happens to", ${said}}. Only a change the reply states as done.`,
  employment: `Someone was hired, let go, quit, got a raise, went on leave or came back from it: {"who": "the person, by id or name", "change": "hired, let_go, quit, raise, leave or back", "org": "the employer, by id or name: an organization, a person or the place they work at", "job": "the job's id, when you know it", "title": "a hire's job title", "position": "one of the employer's positions", "rate": 18.5, "pct": 5, "hours": 40, "basis": "hourly, salary, per_shift, commission, tips or stipend", "by": "who hired them, let them go or changed their pay, when the reply says", ${said}}. rate: the new pay as the reply writes it; pct: a raise as a percentage instead; hours: hours a week. Only a change the reply states as done.`,
  agenda: `An open item of a plan moved along: {"id": "the item's id, as orgs_read shows it on the organization's plan", "status": "under_way, done, blocked or refused", "org": "the organization whose plan it is, when it isn't the party's", ${said}}. Someone offering to take a task on is not recorded: taking up an offer needs the player's yes, so say in your answer who offered what.`,
  vote: `Someone cast a vote on an open motion: {"who": "the voter, by id or name", "org": "its organization", "motion": "the motion's id, as orgs_read's decisions part lists it", "vote": "for, against or abstain", ${said}}. Only a vote the reply has them cast in so many words; never one they lean toward, promise or are asked for.`,
  approval: `Someone answered an open request for approval: {"who": "who answers, by id or name", "org": "its organization", "request": "the request's id, as orgs_read's decisions part lists it", "answer": "approve, deny, or withdraw when the one who asked takes it back", ${said}}. Only an answer the reply has them give in so many words.`,
  time_advance: 'Time the reply\'s telling added on top of what the turn itself took: {"minutes": 60}. Only an explicit jump or a stated length ("an hour later", "the next morning"); never a guess at how long what was described took, and never the turn\'s own time, which the author passed. At most what a reply may pass without asking (Settings → Time): a longer skip is the player\'s to run.',
};

/** The tools as shipped, in the order the Prompts page lists them. */
export const STORY_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: STORY_TOOL.record,
    family: HARNESS_FAMILY.people,
    tier: "write",
    note: "Records one thing the reply told that changed the world, as the reply's own read records it on the classic and agents engines.",
    text: "Record one thing the reply told that changed the world, once the reply is written: someone moved, a condition came or went, how one person feels about another changed, money changed hands, a count of things went up or down, someone died or came round, the player character learned of someone or somewhere, someone's week changed, someone joined, left or was hired, a plan's item moved along, a vote was cast, a request was answered, or time passed in the telling. Give exactly one of the arguments, the one for that kind of change, written as a JSON object with the fields its description lists; a field it doesn't list is refused. Record only what the reply states as having happened, never what was considered, refused or imagined, and each change once. The engine checks it as it checks a reply's own read on the other engines, and records it under the mode the player set for that kind of change (Settings → Changes from the reply): Auto records it at once, Confirm puts it on the reply's review card for the player's Apply, Never refuses it. The answer says what was recorded in plain words and where it stands. Not for what has a tool of its own: a newcomer (person_add), a purchase (purchase), a place the world lacks (place_make), a revenue stream earning more or less (revenue_note), a project set back (project_note), or anything done with a thing (item_make, item_move, item_hand, item_own, item_use, item_wear, item_condition, item_lose). Before the reply is written there is nothing to record: the author plays what happens, makes its changes as the game master and passes the turn's own time.",
    args: STORY_TYPES.map((type) => ({ path: type, text: CHANGE_TEXT[type] })),
  },
  {
    name: STORY_TOOL.away,
    family: HARNESS_FAMILY.items,
    tier: "write",
    note: "Puts a thing back where it is kept, as the game master's Put it away does.",
    text: "Put a thing away: it goes back where it is kept, as the game master's Put it away does. Where a thing is kept is the home it was given (item_home sets one); without one, what the engine works out: on its owner for what they carry every day, in what holds things of its sort where its owner lives, where a fixture stands, or where it was made. items_read says where a thing is kept. It is one move of the thing, checked as item_move checks one, and refused with why when it doesn't hold, or when the thing is there already or is kept nowhere. The answer is the change in plain words, its change type and its mode: in a turn it is staged and lands when the turn commits, or waits on the review card when its mode is confirm; after the reply it is written at once.",
    args: [
      { path: "item", text: 'The thing: its id, its name, or words for it ("the fridge").' },
      { path: "why", text: "Why, in a few words, as the reply has it." },
    ],
  },
  {
    name: STORY_TOOL.takeOut,
    family: HARNESS_FAMILY.places,
    tier: "write",
    note: "Takes someone or something out of what holds it, as the game master's Take out does.",
    text: "Take someone or something out of what it is inside, as the game master's Take out does: a thing out of the bag, box or car that holds it, or out of someone's hands, to lie where that holder stands; a person out of what they are in. It is refused, with why, when it is inside nothing. To put a thing into a holder, or anywhere else, use item_move. It is a game master's edit: the answer is the change in plain words, its change type and its mode; in a turn it is staged and lands when the turn commits, or waits on the review card when its mode is confirm.",
    args: [{ path: "entity", text: "Who or what to take out: an id or a name." }],
  },
];

const type = v("type", "the kind of change the call gave", true);

export const STORY_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(STORY_NOTE.afterReply, "Only once the reply is written", "story_record's answer before the turn's reply is written.", "story_record records what the reply told, so there is nothing for it to record until the reply is written. Until then the author plays what happens (action_play), makes its changes as the game master and passes the turn's own time (time_pass). Call story_record once the reply is written: it is work for after the reply."),
  answerPrompt(STORY_NOTE.oneChange, "One change a call", "story_record's answer when a call gives no change, or more than one.", "story_record records one change a call: give exactly one of {{types}}, written as a JSON object. This call gave {{count}} of them, so nothing was recorded.", [v("types", "the kinds of change it records", true), v("count", "how many the call gave")]),
  answerPrompt(STORY_NOTE.badFact, "A change it can't read", "story_record's answer when a change isn't written as a JSON object, or one of its fields can't be read.", "{{type}} can't be read as the call gave it, so nothing was recorded. What it takes: {{shape}}", [type, v("shape", "the kind's description, in the user's words", true)]),
  answerPrompt(STORY_NOTE.noField, "Not a field of that change", "story_record's answer when a change holds a field its kind doesn't take.", "{{field}} is no field of {{type}}. Its fields: {{fields}}. Leave it out and call again: nothing was recorded.", [v("field", "the field the call gave", true), type, v("fields", "the fields that kind of change takes")]),
  answerPrompt(
    STORY_NOTE.offer,
    "An offer needs the player's yes",
    "story_record's answer when an agenda change is someone offering to take a task on. On the other engines that always asks the player first, whatever the mode, and a recorded change can't ask.",
    "Someone offering to take a task on goes on a plan only when the player says yes, and a recorded change can't ask them, so nothing was recorded. Say in your answer who offered what, and that taking up the offer needs the player's yes: the author can put it to the player in the reply.",
  ),
  answerPrompt(STORY_NOTE.notQuoted, "Not the reply's own words", "story_record's answer when said, which a change to an organization quotes, isn't in the reply.", "said is the reply's own words that state the change, copied exactly, and these aren't in the reply, so nothing was recorded. Quote the reply; if it doesn't state the change, leave it out."),
  answerPrompt(STORY_NOTE.notNamed, "Someone the reply doesn't name", "story_record's answer when a change to someone's week is for a person the reply doesn't speak of.", "A change to someone's week is recorded only for the player character or for someone the reply names, and it doesn't name {{name}}, so nothing was recorded.", [v("name", "whom the change is for", true)]),
  answerPrompt(
    STORY_NOTE.bound,
    "A field its world bounds",
    "story_record's answer when the change would move a field the world's author bounded in Build: one the story never changes, or one that asks first, which a recorded change can't.",
    "{{field}} of {{name}} is bounded in Build ({{mode}}): the story doesn't change it by itself, so nothing was recorded. Say what the reply told in your answer.",
    [v("field", "the field the change would move", true), v("name", "whose it is"), v("mode", "the field's mode in Build: confirm or never")],
  ),
  answerPrompt(STORY_NOTE.noStep, "No step allowed", "story_record's answer when the largest step the player allows that kind of change (Settings → Changes from the reply) is none.", "The largest step the player allows a {{type}} change is none (Settings → Changes from the reply), so nothing was recorded.", [type]),
  answerPrompt(STORY_NOTE.timeMinutes, "A span it can't read", "story_record's answer when time_advance gives no whole number of minutes above none.", "time_advance takes minutes as a whole number above 0: the time the reply's telling added. Nothing was recorded."),
  answerPrompt(
    STORY_NOTE.timeAsk,
    "More than a reply may pass",
    "story_record's answer for narrated time past what a reply may pass without asking (Settings → Time), or past the farthest one call moves the clock (Settings → Agents).",
    "That is more time than a reply may pass without the player's say (at most {{minutes}} minutes), so it wasn't passed. Say so in your answer: the player can skip ahead themselves.",
    [v("minutes", "the most minutes a reply passes without asking", true)],
  ),
  answerPrompt(STORY_NOTE.timeTooMuch, "Too much happens", "story_record's answer when more happens in the narrated span than the engine runs in one go.", "Too much happens in that span to run in one go, so it wasn't passed. Say so in your answer: the player can skip ahead themselves."),
  answerPrompt(STORY_NOTE.awayNowhere, "Nowhere to put it away", "item_away's answer when the thing is where it is kept already, or nothing says where it is kept.", "{{name}} is where it is kept already, or is kept nowhere a move reaches, so nothing was moved. item_home sets where a thing is kept; item_move puts it anywhere.", [v("name", "the thing", true)]),
  answerPrompt(STORY_NOTE.badId, "An id it can't take", "gm_spawn's answer on the harness engine when id isn't in the form the engine makes its own ids in.", "{{id}} isn't an id an agent may give: an id is lower case letters and digits with _ between them, at most 40, as the engine makes its own. Give one in that form, or leave id out for one the engine makes.", [v("id", "the id the call gave", true)]),
];
