// What LumiRPEngine says to a model about the surfaces a game master reads and changes in play
// that no tool of the old engines reaches, on the harness engine: each tool's description and its
// arguments', and what those tools answer besides a result. And the two lore tools that keep a
// file, which the old engines have too: what they do on the harness (`HARNESS_DESCRIBED`), and what
// they answer there. Registry texts of the page "Harness engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, HARNESS_GROUP, HARNESS_PAGE, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const SURFACE_TOOL = { placeRemove: "place_remove", setDrop: "set_drop", gmEffects: "gm_effects", sectionsRead: "sections_read" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const SURFACE_NOTE = {
  noSet: "harness.note.surface.no_set",
  noSets: "harness.note.surface.no_sets",
  noEffect: "harness.note.surface.no_effect",
  effectsNext: "harness.note.surface.effects_next",
  noSection: "harness.note.surface.no_section",
  noPreview: "harness.note.surface.no_preview",
  lorePath: "harness.note.surface.lore_path",
  loreId: "harness.note.surface.lore_id",
} as const;

const filed = "The file is a workspace note, under the mode the player set for those (Settings → Changes from the reply). As shipped it is written to the workspace at once, and the answer says where: workspace_read reads it. Set to Confirm, it waits for the player's Apply on the review card; set to Never, it is refused. On a chat with no workspace connected it is staged with the turn instead, and kept when the turn commits.";

/** The old engines' tools the harness words itself, as shipped, each with the id of its text there: on the harness a lore file goes to the harness's workspace, and only under its own folder. */
const DESCRIBED: readonly { name: string; id: string; text: string }[] = [
  { name: "lore_save", id: "harness.tool.lore_save", text: `Save a lore entry's text, as you read it, as a file of the workspace under lore/: one named after the entry, or the file path names there. A path anywhere else is refused. ${filed} Nothing here writes a book or the world's lore.` },
  { name: "lore_draft", id: "harness.tool.lore_draft", text: `Draft an edit to a lore entry, or a new entry, as a file of the workspace under lore-drafts/ that names the entry and holds your text. Nothing writes a book or the world's lore from it: the game master applies it in Build, on their own press. A new entry takes an id of your own: lower case letters, digits and _. ${filed}` },
];

/**
 * The old engines' tools a harness chat describes in its own words, by name: each with the id of
 * the text it sends as that tool's description in place of the old engines' (`tool.<name>`). What
 * the tool does differently on the harness is said there, and what the old engines send stays
 * theirs.
 */
export const HARNESS_DESCRIBED: Readonly<Record<string, string>> = Object.fromEntries(DESCRIBED.map((d) => [d.name, d.id]));

const dry = "true to only check it: the answer says what it would change, and nothing is staged.";

/** The tools as shipped, in the order the Prompts page lists them. */
export const SURFACE_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: SURFACE_TOOL.placeRemove,
    family: HARNESS_FAMILY.places,
    tier: "write",
    note: "Takes a place made in play out of the world.",
    text: "Take a place that was made in play (place_make) out of the world: a room, a spot or a venue the story no longer has, or one made by mistake. Only a place made in play can go; a place of the world's document is changed there (world_place). The engine refuses a place that still holds someone or something, or that has places inside it, and says what is in the way: move them out first. It is a game master's change.",
    args: [
      { path: "place", text: "The place made in play: its id or name." },
      { path: "dry", text: dry },
    ],
  },
  {
    name: SURFACE_TOOL.setDrop,
    family: HARNESS_FAMILY.items,
    tier: "write",
    note: "Forgets one of someone's saved outfits or loadouts.",
    text: "Forget one of a person's saved outfits or loadouts (set_save keeps one, set_apply changes them into one). The things in it stay where they are: only the saved set goes. items_inventory lists a person's sets.",
    args: [
      { path: "who", text: "Whose set: a person's id or name." },
      { path: "set", text: "The saved set: its id or its name." },
      { path: "dry", text: dry },
    ],
  },
  {
    name: SURFACE_TOOL.gmEffects,
    family: HARNESS_FAMILY.money,
    tier: "read",
    note: "Lists the effects gm_effect can run, each with its arguments.",
    text: "List the effects the world's packs let the game master run (gm_effect), each with the arguments it takes: what no field holds and no other tool changes, such as opening or closing an account, hiring someone or ending a job, founding or winding up an organization, positions and delegated powers, shares issued or bought back, a place's entry rule and its keys, a tax status. Give search to narrow the list. An effect's id starts with the pack it belongs to (economy., orgs.). gm_effect refuses arguments an effect can't use and says why.",
    args: [{ path: "search", text: "Only the effects whose id holds these words: account, hire, shares, entry. Leave it out for every effect." }],
  },
  {
    name: SURFACE_TOOL.sectionsRead,
    family: HARNESS_FAMILY.knowledge,
    tier: "read",
    note: "Reads what the reply's writer is given of the world, section by section.",
    text: "Read the sections the reply's writer is given of the world beside your brief, as they would be built now: each section's id, whether it is sent, how many tokens it takes, how many lines were cut to fit, and its settings in this chat (its limits, its sources, whose knowledge it reads, and whether this chat changed them from the world's: gm_feed changes them). Give section to read one section's text as the writer would get it. What a section already tells the writer, your brief need not repeat.",
    args: [{ path: "section", text: "One section's id, to read its text. Leave it out for the list." }],
  },
];

/** What these tools answer besides a result, then the descriptions of `HARNESS_DESCRIBED`, which the page lists with the harness's tools. */
export const SURFACE_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(SURFACE_NOTE.noSet, "No such saved set", "set_drop's answer when the person has no saved set of that id or name.", "{{who}} has no saved set called {{set}}. Their sets: {{sets}}.", [v("who", "the person's name"), v("set", "what the call gave"), v("sets", "the names of the sets the person has, or that they have none", true)]),
  answerPrompt(SURFACE_NOTE.noSets, "No saved sets at all", "What set_drop's answer gives as the person's sets when they have none.", "none"),
  answerPrompt(SURFACE_NOTE.noEffect, "No effect matches", "gm_effects's answer when search matches no effect the game master may run.", "No effect the game master may run has {{search}} in its id. Call gm_effects without search for all of them.", [v("search", "the words searched for", true)]),
  answerPrompt(SURFACE_NOTE.effectsNext, "How an effect is run", "Ends gm_effects's answer: how to run one of the effects it lists.", 'Run one with gm_effect: effect is the id, args the arguments by name as a JSON object. An argument listed under optional may be left out. Arguments that name someone or something take an id.'),
  answerPrompt(SURFACE_NOTE.noSection, "No such section", "sections_read's answer when section names no section of the world.", "The world has no section called {{section}}. Its sections: {{sections}}.", [v("section", "what the call gave"), v("sections", "the world's sections, by id", true)]),
  answerPrompt(SURFACE_NOTE.noPreview, "The sections can't be built here", "Says sections_read gives each section's settings only, where the call can't have the sections built.", "Only each section's settings are given: the sections themselves can't be built from this call."),
  answerPrompt(SURFACE_NOTE.lorePath, "A lore file outside lore/", "lore_save's answer on the harness when path isn't under lore/.", "A lore entry is saved under lore/, and {{path}} isn't there, so nothing was written. Give a path under lore/, or leave path out for a file named after the entry.", [v("path", "the path the call gave", true)]),
  answerPrompt(SURFACE_NOTE.loreId, "An id a new entry can't have", "lore_draft's answer on the harness when id names no entry the agent may read and isn't an id a new one may have.", "No lore entry {{id}} here, and a new entry's id is lower case letters, digits and _, so nothing was written. Give an entry's id as lore_index, lore_search or lore_grep gives it, or an id of that form for a new entry.", [v("id", "the id the call gave", true)]),
  ...DESCRIBED.map((d): PromptDef => ({ id: d.id, page: HARNESS_PAGE.id, group: HARNESS_GROUP.tools, label: `${d.name}: what it does on the harness`, note: `What a harness chat sends as ${d.name}'s description, in place of the old engines' own text for it (Every agent → Tools).`, text: d.text, vars: [] })),
];
