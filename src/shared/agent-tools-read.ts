// The read families' texts as shipped (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): each tool's description
// and its arguments', registry texts on the GM agent page (`shared/agent-tools.ts`). What each tool
// answers is `backend/agents/tools/read/<family>.ts`; every answer is filtered by the agent's
// knowledge, so each description says what it gives without promising what a knowledge setting hides.

import type { ToolText } from "./agent-tools";

const person = "The person: their id, or their name as the world has it.";
const place = "The place: its id, or its name.";
const thing = "The thing: its id, or its name.";
const track = "The quest, secret, puzzle or agenda: its id, or its label.";

export const READ_TOOL_TEXTS: readonly ToolText[] = [
  // ---------------------------------------------------------------- people
  {
    name: "people_find",
    family: "people",
    tier: "read",
    note: "Finds people by name, kind or place.",
    text: "Find people by part of their name, their kind or where they are. Gives each one's id, name, kind and place. With no arguments it lists everyone you can see. Use the ids it gives in later calls.",
    args: [
      { path: "name", text: "Part of a name, in any case; leave it out to match every name." },
      { path: "kind", text: "Only people of this kind." },
      { path: "place", text: "Only people at this place or somewhere inside it: its id or name." },
    ],
  },
  {
    name: "people_sheet",
    family: "people",
    tier: "read",
    note: "Reads one person's sheet.",
    text: "Read one person's sheet: their kind, tier and life state, their fields (who they are, their stats), what they are doing, their relations, and what the world's lore says about them.",
    args: [{ path: "person", text: person }],
  },
  {
    name: "people_where",
    family: "people",
    tier: "read",
    note: "Says where someone is and what they are doing.",
    text: "Where a person is now and what they are doing. Read with the player character's knowledge, someone away shows only where and when the player character last saw them.",
    args: [{ path: "person", text: person }],
  },
  {
    name: "people_regard",
    family: "people",
    tier: "read",
    note: "Says how someone regards others.",
    text: "How a person regards others: their warmth, trust and respect toward each, in the world's words. Give toward for one relationship, or leave it out for everyone they regard.",
    args: [
      { path: "person", text: "Whose regard: their id or name." },
      { path: "toward", text: "Toward whom: their id or name; leave it out for everyone." },
    ],
  },
  // ---------------------------------------------------------------- places and travel
  {
    name: "places_read",
    family: "places",
    tier: "read",
    note: "Reads a place: where it sits, what it is, the places inside it and its lore.",
    text: "Read a place: its name, the places around it (outermost first), its description and fields, the places inside it, the ways out of it, and what the world's lore says about it.",
    args: [{ path: "place", text: place }],
  },
  {
    name: "places_contents",
    family: "places",
    tier: "read",
    note: "Says who and what is at a place.",
    text: "Who and what is at a place now: the people there with what they are doing, and the things lying there loose (not carried, and not in a container).",
    args: [{ path: "place", text: place }],
  },
  {
    name: "places_route",
    family: "places",
    tier: "read",
    note: "Finds the way between two places and how long it takes.",
    text: "The way from one place to another and how long it takes, for each way of travelling there is (or the one you name): the minutes, the distance and the places it passes.",
    args: [
      { path: "to", text: "Where to: a place's id or name." },
      { path: "from", text: "Where from: a place's id or name; leave it out for where the player character is." },
      { path: "mode", text: "Only this way of travelling; leave it out for each." },
    ],
  },
  // ---------------------------------------------------------------- items
  {
    name: "items_inventory",
    family: "items",
    tier: "read",
    note: "Lists what someone wears, carries and owns.",
    text: "What a person wears, carries and owns: each thing with its id and name, what it is in, and its condition where the world keeps one.",
    args: [{ path: "person", text: person }],
  },
  {
    name: "items_holder",
    family: "items",
    tier: "read",
    note: "Says where a thing is and who holds it.",
    text: "Where a thing is and who holds it: the person or container it is in, the place, its owners with their shares, and who may use it.",
    args: [{ path: "thing", text: thing }],
  },
  {
    name: "items_condition",
    family: "items",
    tier: "read",
    note: "Reads a thing's condition and state.",
    text: "A thing's condition and state as the world keeps them: how worn it is, whether it works, and for a vehicle its fuel and mileage.",
    args: [{ path: "thing", text: thing }],
  },
  // ---------------------------------------------------------------- money
  {
    name: "money_balances",
    family: "money",
    tier: "read",
    note: "Reads someone's money: accounts, balances, debts and how well off they are.",
    text: "Someone's money: their accounts with each balance (a negative balance is owed), their cash, and how well off they are. Works for a person or a business; leave person out for the player character.",
    args: [{ path: "person", text: "Whose money: a person's or a business's id or name; leave it out for the player character's." }],
  },
  {
    name: "money_prices",
    family: "money",
    tier: "read",
    note: "Prices a thing, or lists what a place sells.",
    text: "What things cost: the price of a thing from the world's catalog at a place, with its usual range; leave item out to list what the place sells.",
    args: [
      { path: "item", text: "What to price, in words, or its catalog id; leave it out to list what the place sells." },
      { path: "place", text: "Where: a place's id or name; leave it out for where the player character is." },
    ],
  },
  // ---------------------------------------------------------------- quests and secrets
  {
    name: "quests_tracks",
    family: "quests",
    tier: "read",
    note: "Lists the quests, secrets, puzzles and agendas.",
    text: "List the quests, secrets, puzzles and agendas: each one's id, label, kind and the stage it is at.",
    args: [{ path: "kind", text: "Only this kind: quest, secret, puzzle or agenda." }],
  },
  {
    name: "quests_stage",
    family: "quests",
    tier: "read",
    note: "Reads where a quest or secret stands.",
    text: "Where one quest, secret, puzzle or agenda stands: its stage, since when, the objectives still to do, the hints earned and the truths revealed so far.",
    args: [{ path: "track", text: track }],
  },
  {
    name: "quests_moves",
    family: "quests",
    tier: "read",
    note: "Says what moves a quest or secret on.",
    text: "What moves a quest, secret, puzzle or agenda on from the stage it is at: the stages it can go to and what each needs, what fails it, and what gates it.",
    args: [{ path: "track", text: track }],
  },
  // ---------------------------------------------------------------- knowledge
  {
    name: "knowledge_who_knows",
    family: "knowledge",
    tier: "read",
    note: "Says who knows a fact, and how.",
    text: "Who knows a fact. Find facts by words of what they claim, by a fact's id, or by a person, place, thing or quest they are about. Gives each fact with everyone who holds it: how they came by it and from whom, since when, what they take it to be, how sure they are, and whom they keep it from.",
    args: [{ path: "about", text: "Words of the fact's claim, a fact id, or the id or name of a person, place, thing or quest it is about." }],
  },
  {
    name: "knowledge_what_knows",
    family: "knowledge",
    tier: "read",
    note: "Says what someone knows.",
    text: "What a person knows: each fact they hold, with how they came by it and from whom, since when, what they take it to be, how sure they are, and whom they keep it from.",
    args: [
      { path: "person", text: person },
      { path: "about", text: "Only facts matching these words, or about this person, place, thing or quest; leave it out for all they know." },
    ],
  },
  // ---------------------------------------------------------------- time
  {
    name: "time_clock",
    family: "time",
    tier: "read",
    note: "Reads the date and time.",
    text: "The time now: the date and time of day in the world's calendar, local to a place, the part of the day, that day's holidays, and whether the clock is paused.",
    args: [{ path: "place", text: "Where, for its local time: a place's id or name; leave it out for where the player character is." }],
  },
  {
    name: "time_day",
    family: "time",
    tier: "read",
    note: "Reads someone's day.",
    text: "A person's day: what they do when, and where, from their routine and their plans. Day 0 is today, 1 tomorrow, -1 yesterday.",
    args: [
      { path: "person", text: person },
      { path: "day", text: "Which day, counted from today: 0 today, 1 tomorrow, -1 yesterday; leave it out for today." },
    ],
  },
  // ---------------------------------------------------------------- checks
  {
    name: "checks_odds",
    family: "checks",
    tier: "read",
    note: "Gives an action's odds.",
    text: "The odds of an action: whether it can be tried now and, if not, why; for one that rolls, the chance of each outcome, the dice and the difficulty. The actor is the player character unless you name another.",
    args: [
      { path: "action", text: "The action's id." },
      { path: "actor", text: "Who tries it: a person's id or name; leave it out for the player character." },
      { path: "params", text: 'The action\'s arguments by name, such as its target or where to, written as a JSON object: {"target": "an id or a name"}.' },
    ],
  },
  // ---------------------------------------------------------------- minds and memory
  {
    name: "minds_read",
    family: "minds",
    tier: "read",
    note: "Reads a character's mind, memory and plans.",
    text: "A character's mind: their latest thoughts (what they make of the moment, what they intend, how they come across, their mood), their memory notes, the commitments they made and the plans they keep.",
    args: [{ path: "person", text: person }],
  },
];
