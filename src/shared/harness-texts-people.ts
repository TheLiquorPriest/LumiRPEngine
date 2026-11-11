// What LumiRPEngine says to a model about making a person whole in play (their sheet, where they are, what they hold, how their mind starts), on the harness engine: each tool's
// description and its arguments', and what those tools answer besides a result. Registry texts of the
// page "Harness engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const PEOPLE_TOOL = { personMake: "person_make" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const PEOPLE_NOTE = {
  exists: "harness.note.people.exists",
  badId: "harness.note.people.bad_id",
  noField: "harness.note.people.no_field",
  badItem: "harness.note.people.bad_item",
  notOnThem: "harness.note.people.not_on_them",
  next: "harness.note.people.next",
  nextReview: "harness.note.people.next_review",
} as const;

/** The tools as shipped, in the order the Prompts page lists them. */
export const PEOPLE_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: PEOPLE_TOOL.personMake,
    family: HARNESS_FAMILY.people,
    tier: "write",
    note: "Makes a person whole in one call: their sheet, where they are, what they hold, how their mind starts.",
    text: "Make a person the story needs, whole, in one call: who they are (name, kind, tier), where they are, what their sheet says (fields), how they are classed, whom and what they are tied to (relations), what they hold and wear, and how their mind starts (what they mean to do, what they already remember). Look for them first (people_find): someone the world already has is changed with gm_set_field, gm_link, item_make and gm_mind_edit, never made twice. Give only what the story has established, and leave the rest out rather than invent it. The person is made first; each further part is then checked by the engine as a change of its own, under its own change type and mode, and a part it refuses is answered with why and the tool that fixes it, while the rest stand. A new person counts against the world's spawn cap (Build → World). It is a game master's change. Afterwards gm_despawn takes someone out of the world again (gm_restore brings them back), and gm_set_life changes whether they live.",
    args: [
      { path: "name", text: "Their name, as the story gives it." },
      { path: "kind", text: "The kind of person they are, among the world's; person when left out." },
      { path: "id", text: "An id of your own for them (lower case letters, digits and _); leave it out for one made from their name." },
      { path: "place", text: "Where they are: a place's id or name. Leave it out for someone who exists but is nowhere yet." },
      { path: "tier", text: "Their tier; leave it out for the world's spawn tier." },
      { path: "agent", text: "true: they live on their own between turns." },
      { path: "fields", text: 'Their sheet: the fields of their kind by id, written as a JSON object: {"occupation": "baker", "age": 41}. people_sheet of someone of the same kind shows which fields a kind has; a field it lacks is answered with those it has.' },
      { path: "tags", text: "Tags for them, as the world's classifications use tags." },
      { path: "class", text: 'How they are classed, by facet, written as a JSON object: {"faction": ["dockers"]}.' },
      { path: "relations", text: "Their ties to people, things and places, each a relation from them." },
      { path: "relations.relation", text: "The relation type's id: knows, owns, member_of, regard, in, or one of the world's own." },
      { path: "relations.to", text: "To whom or what: an id or name, a place's for a relation to a place." },
      { path: "relations.fields", text: 'The relation\'s fields, as the world defines them, written as a JSON object: {"heat": 3}.' },
      { path: "holds", text: "What they have on them when they appear, each thing made on them." },
      { path: "holds.name", text: 'Its name, as the story calls it ("a ring of keys").' },
      { path: "holds.type", text: "Its catalog type's id, when the world's catalogs have one; leave it out otherwise." },
      { path: "holds.qty", text: "How many, for a stack; 1 when left out." },
      { path: "holds.worn", text: "true: they are wearing it." },
      { path: "holds.description", text: "What it is like, in a sentence." },
      { path: "mind", text: "How their mind starts. Leave it out for a mind that starts with nothing in it." },
      { path: "mind.intent", text: "What they mean to do now, in a sentence." },
      { path: "mind.approach", text: "reactive (they answer the scene) or proactive (they pursue their own aims); leave it out to let their mind decide." },
      { path: "mind.notes", text: "What they already remember that matters to the story, one memory each, as they would put it." },
      { path: "mind.level", text: "Pins how closely their mind is run: live, near, far or background; leave it out to let the engine decide." },
      { path: "why", text: "Why they join the story, in a few words." },
    ],
  },
];

export const PEOPLE_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(PEOPLE_NOTE.exists, "The world already has them", "person_make's answer when a person of that name is in the world already.", "The world already has {{name}} ({{id}}): no one is made twice. Change them with gm_set_field, gm_link, item_make and gm_mind_edit, by that id. If this is someone else of the same name, give them a name that tells them apart.", [v("name", "the person's name"), v("id", "the id of the person the world has", true)]),
  answerPrompt(PEOPLE_NOTE.badId, "An id it can't take", "person_make's answer when id isn't an id, or is taken.", "{{id}} is taken already or isn't an id: an id is lower case letters, digits and _. Give another, or leave id out for one made from their name.", [v("id", "the id the call gave", true)]),
  answerPrompt(PEOPLE_NOTE.noField, "Not a field of that kind", "person_make's answer when fields names a field the person's kind doesn't have.", "{{field}} is no field of the kind {{kind}}. Its fields: {{fields}}. Fix fields and call person_make again: no one was made.", [v("field", "the field the call named", true), v("kind", "the person's kind"), v("fields", "the kind's fields, by id")]),
  answerPrompt(PEOPLE_NOTE.badItem, "A list item it can't read", "person_make's answer when an item of relations, holds or the mind's notes lacks what it needs.", "Item {{n}} of {{list}} can't be read: {{needs}}. Fix it and call person_make again: no one was made.", [v("n", "which item, counted from 1", true), v("list", "the argument it is in"), v("needs", "what the item needs", true)]),
  answerPrompt(PEOPLE_NOTE.notOnThem, "Nothing to put on", "Says person_make couldn't put a thing on the person because it didn't end up on them.", "it didn't end up on them (a thing too big to carry lies where they stand), so nothing was put on: item_wear puts it on once they hold it"),
  answerPrompt(PEOPLE_NOTE.next, "What follows a person made", "Ends person_make's answer for a person who is staged with the turn.", "{{name}} is {{id}} from here on. commit makes them definitive, so that your other tools and their own mind find them; then, when their choice matters, start their mind (delegate, agent: character) with who they are and what they walk into.", [v("name", "the person's name"), v("id", "their id", true)]),
  answerPrompt(PEOPLE_NOTE.nextReview, "A person who waits for Apply", "Ends person_make's answer for a person whose making waits on the review card.", "Making {{name}} ({{id}}) waits for the player's Apply on the review card, and the parts above wait with them: until then they are not in the world. Brief the writer on them as the story has them, and start their mind on the turn after they are applied.", [v("name", "the person's name"), v("id", "their id", true)]),
];
