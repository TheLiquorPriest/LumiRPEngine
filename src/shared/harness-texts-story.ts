// What LumiRPEngine says to a model about two of the game master's own moves on the harness engine:
// putting a thing away and taking something out of what holds it; and what those tools, and the
// harness's check of an id an agent gives, answer besides a result. Registry texts of the page
// "Harness engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const STORY_TOOL = { away: "item_away", takeOut: "gm_take_out" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const STORY_NOTE = {
  awayNowhere: "harness.note.story.away_nowhere",
  badId: "harness.note.story.bad_id",
} as const;

/** The tools as shipped, in the order the Prompts page lists them. */
export const STORY_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: STORY_TOOL.away,
    family: HARNESS_FAMILY.items,
    tier: "write",
    note: "Puts a thing back where it is kept, as the game master's Put it away does.",
    text: "Put a thing away: it goes back where it is kept, as the game master's Put it away does. Where a thing is kept is the home it was given (item_home sets one); without one, what the engine works out: on its owner for what they carry every day, in what holds things of its sort where its owner lives, where a fixture stands, or where it was made. items_read says where a thing is kept. It is one move of the thing, checked as item_move checks one, and refused with why when it doesn't hold, or when the thing is there already or is kept nowhere. The answer is the change in plain words, its change type and its mode: in a turn it is staged and lands when the turn commits, or waits on the review card when its mode is confirm; after the reply it is written at once.",
    args: [
      { path: "item", text: 'The thing: its id, its name, or words for it ("the fridge").' },
      { path: "why", text: "Why, in a few words, as the story has it." },
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

export const STORY_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(STORY_NOTE.awayNowhere, "Nowhere to put it away", "item_away's answer when the thing is where it is kept already, or nothing says where it is kept.", "{{name}} is where it is kept already, or is kept nowhere a move reaches, so nothing was moved. item_home sets where a thing is kept; item_move puts it anywhere.", [v("name", "the thing", true)]),
  answerPrompt(STORY_NOTE.badId, "An id it can't take", "gm_spawn's answer on the harness engine when id isn't in the form the engine makes its own ids in.", "{{id}} isn't an id an agent may give: an id is lower case letters and digits with _ between them, at most 40, as the engine makes its own. Give one in that form, or leave id out for one the engine makes.", [v("id", "the id the call gave", true)]),
];
