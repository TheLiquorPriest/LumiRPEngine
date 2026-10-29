// The write tools' texts as shipped (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): the GM-tier edits, the
// workspace's tools and the lore's, each tool's description and its arguments', and the answers the
// writer and these tools give, all registry texts on the GM agent page (`shared/agent-tools.ts`).
// What each tool does is `backend/agents/tools/write/*.ts`, `tools/workspace.ts` and `tools/lore.ts`;
// every write is only proposed there (`tools/writer.ts`, a dry run): the engine checks it and says
// what it would change, and nothing changes until it is applied.

import type { ToolNote, ToolText } from "./agent-tools";

const entity = "The person or thing: their id, or their name as the world has it.";
const person = "The person: their id, or their name as the world has it.";
const field = "The field's id.";
const relation = "The relation type's id: knows, owns, member_of, regard, in, or one of the world's own.";
const path = "The workspace file's path: names joined by /, such as notes/marcus.md.";
const under = "Only files under this folder, such as notes/; leave it out for every file.";
const lore = "The lore entry's id, as lore_search or lore_grep gives it.";
const proposes = "The answer is the change in plain words, its change type and its mode; nothing changes until the game master applies it.";

export const WRITE_TOOL_TEXTS: readonly ToolText[] = [
  // ---------------------------------------------------------------- people
  {
    name: "gm_set_field",
    family: "people",
    tier: "gm",
    note: "Proposes a field of a person or thing, as the GM's Edit sets it.",
    text: `Propose setting one field of a person or thing, as the GM's Edit does, locked fields too. The engine checks the value against the field's type, values and bounds; money is in minor units (2500 is 25.00) and moves against a correction. ${proposes}`,
    args: [
      { path: "entity", text: entity },
      { path: "field", text: field },
      { path: "value", text: 'Its new value in the field\'s type, written as JSON: a number, true or false, "words" or an "id" in quotes, a list such as ["a", "b"], or null to clear a reference; plain words read as text.' },
    ],
  },
  {
    name: "gm_add_to_field",
    family: "people",
    tier: "gm",
    note: "Proposes adding to a number field, within its bounds.",
    text: `Propose adding to a number field of a person or thing, or taking from it with a negative amount; it stops at the field's bounds. Money is in minor units and moves against a correction. ${proposes}`,
    args: [
      { path: "entity", text: entity },
      { path: "field", text: field },
      { path: "delta", text: "How much to add; a negative amount takes away." },
    ],
  },
  {
    name: "gm_set_entity",
    family: "people",
    tier: "gm",
    note: "Proposes someone's tier, agent flag and levels.",
    text: `Propose a person's or thing's tier, whether they live on their own as an agent between turns, and their level of detail in each domain. Give any of the three. ${proposes}`,
    args: [
      { path: "entity", text: entity },
      { path: "tier", text: "Their new tier." },
      { path: "agent", text: "true: they live on their own between turns; false: only while the story is with them." },
      { path: "levels", text: 'Per domain, a level from 0 to 4, or -1 to follow their tier: {"money": 2, "gear": -1}.' },
    ],
  },
  {
    name: "gm_classify",
    family: "people",
    tier: "gm",
    note: "Proposes someone's classes and tags, whole.",
    text: `Propose a person's or thing's classes and tags, whole: each of the world's facets with its values, and every tag. The chat keeps them from then on over the world's definition. ${proposes}`,
    args: [
      { path: "entity", text: entity },
      { path: "class", text: 'Each facet\'s values, by the facet\'s id, written as a JSON object: {"role": ["ally"]}.' },
      { path: "tags", text: "Their tags, all of them." },
    ],
  },
  {
    name: "gm_set_life",
    family: "people",
    tier: "gm",
    note: "Proposes someone's life state, and who is told of it.",
    text: `Propose a person's life state (alive, dying, dead, or one the world has), and whom it is told to besides those with them. Give either or both. ${proposes}`,
    args: [
      { path: "person", text: person },
      { path: "state", text: "Their new life state." },
      { path: "tell", text: "Who else learns of it: each person's id or name." },
    ],
  },
  {
    name: "gm_spawn",
    family: "people",
    tier: "gm",
    note: "Proposes someone or something new in the chat.",
    text: `Propose bringing someone or something new into the chat: its kind and name, and if you like its id, tier, place and whether it lives as an agent. A new person counts against the world's spawn cap, the people a chat may bring in (Build → World). ${proposes}`,
    args: [
      { path: "kind", text: "Its kind." },
      { path: "name", text: "Its name." },
      { path: "id", text: "An id of your own for it; leave it out for one the engine makes. Reading with the player character's knowledge, always leave it out: an id is refused." },
      { path: "tier", text: "Its tier; leave it out for the world's spawn tier." },
      { path: "place", text: "Where it starts: a place's id or name." },
      { path: "agent", text: "true: it lives on its own between turns." },
    ],
  },
  {
    name: "gm_despawn",
    family: "people",
    tier: "gm",
    note: "Proposes taking someone or something out of the world.",
    text: `Propose taking a person or thing out of the world: it is kept, its relations end, and gm_restore brings it back. Removing a person and destroying a thing are change types of their own. ${proposes}`,
    args: [{ path: "entity", text: entity }],
  },
  {
    name: "gm_restore",
    family: "people",
    tier: "gm",
    note: "Proposes bringing back someone or something taken out.",
    text: `Propose bringing back a person or thing that was taken out of the world, where it was. ${proposes}`,
    args: [{ path: "entity", text: entity }],
  },
  {
    name: "gm_link",
    family: "people",
    tier: "gm",
    note: "Proposes a relation, or new fields for one.",
    text: `Propose a relation from one person or thing to another (or to a place), with its fields, or new fields for one already there. ${proposes}`,
    args: [
      { path: "relation", text: relation },
      { path: "from", text: "From whom or what: an id or name." },
      { path: "to", text: "To whom or what: an id or name, a place's for a relation to a place." },
      { path: "fields", text: 'The relation\'s fields, as the world defines them, written as a JSON object: {"heat": 3}.' },
      { path: "until", text: "When it ends, in the world's minutes; leave it out for never." },
    ],
  },
  {
    name: "gm_unlink",
    family: "people",
    tier: "gm",
    note: "Proposes ending a relation.",
    text: `Propose ending a relation from one person or thing to another. ${proposes}`,
    args: [
      { path: "relation", text: relation },
      { path: "from", text: "From whom or what: an id or name." },
      { path: "to", text: "To whom or what: an id or name." },
    ],
  },
  // ---------------------------------------------------------------- places
  {
    name: "gm_move",
    family: "places",
    tier: "gm",
    note: "Proposes moving someone or something to a place.",
    text: `Propose moving a person or thing to a place, out of any container, along the one path every move in the story takes (whoever is with them comes along). ${proposes}`,
    args: [
      { path: "entity", text: entity },
      { path: "to", text: "The place: its id or name." },
    ],
  },
  // ---------------------------------------------------------------- items
  {
    name: "gm_put",
    family: "items",
    tier: "gm",
    note: "Proposes putting a thing into another, or taking it out.",
    text: `Propose putting a thing inside another (a bag, a car, or a person who then carries it), or, leaving into out, taking it out to where its container is. ${proposes}`,
    args: [
      { path: "entity", text: "The thing, or a person going into a vehicle: an id or name." },
      { path: "into", text: "Into what: an id or name; leave it out to take it out." },
    ],
  },
  // ---------------------------------------------------------------- money
  {
    name: "gm_adjust_money",
    family: "money",
    tier: "gm",
    note: "Proposes money into or out of an account against a correction.",
    text: `Propose moving money into an account, or out of it with a negative amount, against the outside correction account. ${proposes}`,
    args: [
      { path: "account", text: "The account: its id or name." },
      { path: "cents", text: "How much, in minor units (2500 is 25.00); negative takes it out." },
    ],
  },
  {
    name: "gm_effect",
    family: "money",
    tier: "gm",
    note: "Proposes running one of the world's GM effects.",
    text: `Propose running one of the effects the world's packs let the GM run, with literal arguments: what no field holds, such as an asset's price. ${proposes}`,
    args: [
      { path: "effect", text: "The effect's id." },
      { path: "args", text: 'Its arguments, as literal values, written as a JSON object: {"account": "an account\'s id"}.' },
    ],
  },
  // ---------------------------------------------------------------- quests and secrets
  {
    name: "gm_set_stage",
    family: "quests",
    tier: "gm",
    note: "Proposes moving a quest or secret to a stage.",
    text: `Propose moving a quest, secret, puzzle or agenda to a stage: on to one that follows, as reaching it in the story would (its effects, rewards and reveal); back, only the stage. ${proposes}`,
    args: [
      { path: "track", text: "The quest, secret, puzzle or agenda: its id or label." },
      { path: "stage", text: "The stage: its id or label." },
    ],
  },
  // ---------------------------------------------------------------- knowledge
  {
    name: "gm_feed",
    family: "knowledge",
    tier: "gm",
    note: "Proposes a section's settings in this chat.",
    text: `Propose a section's settings in this chat over the world's: whether the narrator gets it, its lines and tokens at most, the sources that fill it, and whose knowledge it reads. Leave settings out to return the section to the world's. ${proposes}`,
    args: [
      { path: "section", text: "The section's id." },
      { path: "settings", text: 'Written as a JSON object: {"enabled": true or false, "maxLines": a count, "maxTokens": a count, "include": [its sources], "scope": "player", "scene" or "gm"}, any of them.' },
    ],
  },
  // ---------------------------------------------------------------- minds
  {
    name: "gm_mind_edit",
    family: "minds",
    tier: "gm",
    note: "Proposes a change to a character's mind, as GM → Minds makes it.",
    text: `Propose a change to a character's mind, as GM → Minds makes it. mind_pin pins their fidelity (level), or unpins it with level none; mind_refresh asks for a fresh mind next turn; mind_memory edits a note, commitment or plan (part, id and value: the fields to change), adds one (part and value, which needs its text, and a plan its what and when) or deletes one (part and id, no value); mind_intent sets what they mean to do now (text) and how they go about it (approach), either or both; mind_knowledge sets what one person holds of a fact the chat knows (fact and holding, whole), or takes it away (fact, no holding). Reading with the player character's knowledge, only the player character's own knowledge may be changed (mind_knowledge on them): a change to anyone else's mind is refused. ${proposes}`,
    args: [
      { path: "op", text: "Which change: mind_pin, mind_refresh, mind_memory, mind_intent or mind_knowledge." },
      { path: "person", text: person },
      { path: "level", text: "mind_pin: live, near, far or background; none unpins." },
      { path: "part", text: "mind_memory: note, commitment or plan." },
      { path: "id", text: "mind_memory: the note's, commitment's or plan's id; leave it out to add one." },
      { path: "value", text: "mind_memory: its fields, or the ones to change, written as a JSON object; leave it out to delete it." },
      { path: "text", text: "mind_intent: what they mean to do now, in your words (at most 600 characters); an empty text clears it." },
      { path: "approach", text: "mind_intent: reactive (they answer the scene), proactive (they pursue their own aims), or none (their mind decides)." },
      { path: "fact", text: "mind_knowledge: the fact's id, as the knowledge tools give it." },
      { path: "holding", text: 'mind_knowledge: the holding, whole, written as a JSON object: {"how": "authored", "witnessed", "told", "inferred" or "guessed", "by": who told them or null, "evidence": [fact ids], "since": {"msg", "at"}, "belief": "true", "false" or "uncertain", "confidence": 0 to 1, "keptFrom": [ids] or "everyone"}; leave it out to take it away.' },
    ],
  },
  // ---------------------------------------------------------------- time
  {
    name: "gm_routine_edit",
    family: "time",
    tier: "gm",
    note: "Proposes a change to a character's routine or schedules in this chat.",
    text: `Propose a change to a character's routine or schedules in this chat, as GM → Routine makes it. routine_follow sets how they follow their routine (mode, awareness, role, skips; default returns one to the world's); routine_block sets one block of it (block, and value: the block, or {"id", "off": true}; leave value out to drop the chat's change); schedule_override changes one of their schedules (schedule, and value: {"off": true, "until": minutes or null} or {"slots": [...]}; leave value out to drop the chat's change). ${proposes}`,
    args: [
      { path: "op", text: "Which change: routine_follow, routine_block or schedule_override." },
      { path: "person", text: person },
      { path: "mode", text: "routine_follow: follows, no_invitations (no invitations from it) or off (no routine at all); default returns it to the world's." },
      { path: "awareness", text: "routine_follow: story_first, balanced or routine_first; default returns it to the world's." },
      { path: "role", text: "routine_follow: informative (context only), enforced (lived, the story first) or off (not even context); default returns it to their level's." },
      { path: "skips", text: "routine_follow: how they live through a time skip; default returns it to their level's." },
      { path: "block", text: "routine_block: the block's id." },
      { path: "schedule", text: "schedule_override: the schedule's id." },
      { path: "value", text: "routine_block or schedule_override: the new block or schedule change, written as a JSON object; leave it out to drop the chat's change." },
    ],
  },
  {
    name: "gm_fix",
    family: "time",
    tier: "gm",
    note: "Proposes a ✎ fix: the clock, or a field as the player corrects it.",
    text: `Propose a ✎ fix, as the player corrects the HUD: the clock set to a time (a later time runs the time between; an earlier one sets the clock back), or one field set as the player could set it (a locked field is refused, and a place must be one the player character can see). Give time alone, or entity, field and value. ${proposes}`,
    args: [
      { path: "time", text: 'The clock: "YYYY-MM-DD HH:MM" in the world\'s calendar where the player character is.' },
      { path: "entity", text: entity },
      { path: "field", text: field },
      { path: "value", text: 'The field\'s new value in its type, written as JSON: a number, true or false, "words" or an "id" in quotes; plain words read as text.' },
    ],
  },
  // ---------------------------------------------------------------- workspace
  {
    name: "workspace_list",
    family: "workspace",
    tier: "read",
    note: "Lists the chat's workspace files.",
    text: "List the chat's workspace files, the notes the agents and the game master keep for this chat: each one's path, its size in characters, whether it is pinned, the turn it was written on and who wrote it. The workspace follows the chat's turns, so a swipe from before a note has none of it.",
    args: [{ path: "under", text: under }],
  },
  {
    name: "workspace_read",
    family: "workspace",
    tier: "read",
    note: "Reads a workspace file.",
    text: "Read one workspace file whole.",
    args: [{ path: "path", text: path }],
  },
  {
    name: "workspace_grep",
    family: "workspace",
    tier: "read",
    note: "Finds text in the workspace files.",
    text: "Find the lines of the workspace files that hold some text, in any case: each file's path, and each line's number and text.",
    args: [
      { path: "text", text: "What to look for." },
      { path: "under", text: under },
    ],
  },
  {
    name: "workspace_write",
    family: "workspace",
    tier: "gm",
    note: "Proposes writing a workspace file whole.",
    text: `Propose writing a workspace file whole: a new one, or a new text for one already there. ${proposes}`,
    args: [
      { path: "path", text: path },
      { path: "text", text: "The file's whole text." },
    ],
  },
  {
    name: "workspace_edit",
    family: "workspace",
    tier: "gm",
    note: "Proposes replacing text in a workspace file.",
    text: `Propose an edit to a workspace file: its text find replaced with replace, where find is there exactly once, or everywhere it is with all. ${proposes}`,
    args: [
      { path: "path", text: path },
      { path: "find", text: "The text to replace, as the file has it." },
      { path: "replace", text: "What goes in its place; an empty text removes it." },
      { path: "all", text: "true: replace it everywhere it is." },
    ],
  },
  {
    name: "workspace_move",
    family: "workspace",
    tier: "gm",
    note: "Proposes moving or renaming a workspace file.",
    text: `Propose moving or renaming a workspace file; its pin goes with it. ${proposes}`,
    args: [
      { path: "from", text: "The file's path now." },
      { path: "to", text: "Its new path, where no file is yet." },
    ],
  },
  {
    name: "workspace_delete",
    family: "workspace",
    tier: "gm",
    note: "Proposes deleting a workspace file.",
    text: `Propose deleting a workspace file. ${proposes}`,
    args: [{ path: "path", text: path }],
  },
  {
    name: "workspace_pin",
    family: "workspace",
    tier: "gm",
    note: "Proposes pinning a workspace file, or unpinning it.",
    text: `Propose pinning a workspace file, which marks it as one to keep in view, or unpinning it. ${proposes}`,
    args: [
      { path: "path", text: path },
      { path: "pinned", text: "true pins it; false unpins it." },
    ],
  },
  // ---------------------------------------------------------------- lore
  {
    name: "lore_search",
    family: "lore",
    tier: "read",
    note: "Searches the world's lore and the chat's World Info books.",
    text: "Search the lore: the world's own entries and those of the World Info books this chat reads, best matches first. Gives each match's id, title and why it matched, with its secret marker when it is a secret or a mark in a book (who knows it, whom it is kept from). Read one whole with lore_read.",
    args: [{ path: "query", text: "Words or names to look for." }],
  },
  {
    name: "lore_grep",
    family: "lore",
    tier: "read",
    note: "Finds lore entries that hold some text.",
    text: "Find the lore entries whose text holds some text, in any case: each entry's id and title, its secret marker, and the lines that hold it.",
    args: [{ path: "text", text: "What to look for." }],
  },
  {
    name: "lore_read",
    family: "lore",
    tier: "read",
    note: "Reads one lore entry, by its id.",
    text: "Read one lore entry whole, by its id, as your knowledge has it: a secret in its text is marked with who knows it, or left out where your knowledge doesn't reach.",
    args: [{ path: "id", text: lore }],
  },
  {
    name: "lore_save",
    family: "lore",
    tier: "gm",
    note: "Proposes saving a lore entry to a workspace file.",
    text: `Propose saving a lore entry's text, as you read it, to a workspace file. ${proposes}`,
    args: [
      { path: "id", text: lore },
      { path: "path", text: "The workspace file; leave it out for one under lore/ named after the entry." },
    ],
  },
  {
    name: "lore_draft",
    family: "lore",
    tier: "gm",
    note: "Proposes a draft edit of a lore entry, as a workspace file under lore-drafts/.",
    text: `Propose a draft of an edit to a lore entry, as a workspace file under lore-drafts/ that names the entry and holds your text. Nothing writes a book or the world's lore from it: the game master applies it in Build, on their own press. ${proposes}`,
    args: [
      { path: "id", text: lore },
      { path: "text", text: "The entry's text as you would have it." },
      { path: "path", text: "The draft file, under lore-drafts/; leave it out for one named after the entry." },
    ],
  },
];

/** The writer's and these tools' answers' ids, so code names them once. */
export const WRITE_NOTE = {
  noWriter: "tool.note.no_writer",
  badOp: "tool.note.bad_op",
  badPath: "tool.note.bad_path",
  noFile: "tool.note.no_file",
  pathTaken: "tool.note.path_taken",
  never: "tool.note.never",
  spawnCap: "tool.note.spawn_cap",
  spawnId: "tool.note.spawn_id",
  notYourMind: "tool.note.not_your_mind",
  povEffect: "tool.note.pov_effect",
  povRefused: "tool.note.pov_refused",
  learnedMove: "tool.note.learned_move",
  fileExists: "tool.note.file_exists",
  tooMany: "tool.note.too_many",
  editMissing: "tool.note.edit_missing",
  editSeveral: "tool.note.edit_several",
  noLore: "tool.note.no_lore",
  draftPath: "tool.note.draft_path",
  cancelled: "tool.note.cancelled",
  paused: "tool.note.paused",
  noWorld: "tool.note.no_world",
  noChange: "tool.note.no_change",
  stale: "tool.note.stale",
} as const;

const filePath = { name: "path", text: "the workspace path the call gave" };

/** The answers a write gives when it isn't made (`tools/writer.ts`), and those of the workspace's and lore's tools. */
export const WRITE_TOOL_NOTES: readonly ToolNote[] = [
  { id: WRITE_NOTE.noWriter, label: "Nothing to write with", note: "A write tool's answer when the agent may only read.", text: "This agent can't change anything here: it only reads.", vars: [] },
  { id: WRITE_NOTE.badOp, label: "A change it can't read", note: "A write's answer when the change it was given isn't one the engine can read.", text: "That change isn't one the engine can read: check it against the tool's description.", vars: [] },
  { id: WRITE_NOTE.badPath, label: "Not a workspace path", note: "A workspace write's answer when the path isn't one a file may have.", text: "{{path}} isn't a workspace path: names of letters, digits, “.”, “_” and “-”, joined by /.", vars: [filePath] },
  { id: WRITE_NOTE.noFile, label: "No such file", note: "A workspace tool's answer when no file is at the path, or none the agent's knowledge may read.", text: "No workspace file {{path}} here.", vars: [filePath] },
  { id: WRITE_NOTE.pathTaken, label: "A path taken by a file it can't read", note: "A workspace write's answer when a file the agent's knowledge may not read (Who may read it, GM → Workspace) is at the path.", text: "A workspace file you can't read is already at {{path}}: pick another path.", vars: [filePath] },
  { id: WRITE_NOTE.never, label: "A change type set to Never", note: "A write's answer when the user set its change type to Never in Settings → Changes from the reply.", text: "{{type}} is set to Never (Settings → Changes from the reply), so this change isn't made.", vars: [{ name: "type", text: "the change type, as Settings names it", required: true }] },
  { id: WRITE_NOTE.spawnCap, label: "The spawn cap", note: "A GM spawn's answer when the chat has brought in as many people as its world allows.", text: "This chat has brought in {{count}} people, all its world allows (its spawn cap, Build → World), so no one new can join it.", vars: [{ name: "count", text: "the people the chat has brought in", required: true }] },
  { id: WRITE_NOTE.spawnId, label: "An id a spawn can't take", note: "A GM spawn's answer, under the player character's knowledge, when the id it asks for is taken or isn't an id: one answer whoever holds it, so it never tells of someone the player character can't know.", text: "{{id}} can't be used for someone or something new: leave the id out, and one is made.", vars: [{ name: "id", text: "the id the spawn asked for" }] },
  { id: WRITE_NOTE.notYourMind, label: "Another's mind", note: "A minds change's answer, under the player character's knowledge, for anyone but the player character: one answer whoever it is and whatever their mind holds, so it never tells what another knows or thinks.", text: "{{pov}} can't see into anyone else's mind, and you read the world as {{pov}} knows it: only what {{pov}} knows may be changed.", vars: [{ name: "pov", text: "the player character's name" }] },
  { id: WRITE_NOTE.povEffect, label: "An effect under your character's knowledge", note: "gm_effect's answer under the player character's knowledge: one answer for every effect, whatever it would touch, since an effect works on what the player character may not know of.", text: "Effects aren't proposed with {{pov}}'s knowledge: their workings reach past what {{pov}} knows. Use the other tools, or ask the game master.", vars: [{ name: "pov", text: "the player character's name" }] },
  { id: WRITE_NOTE.povRefused, label: "A refusal under your character's knowledge", note: "A write's answer, under the player character's knowledge, whenever the engine refuses the change: one answer whatever the engine's reason, so a refusal never tells what the player character can't know.", text: "That change can't be made as {{pov}} knows the world: check it against what you can read, or propose another.", vars: [{ name: "pov", text: "the player character's name" }] },
  { id: WRITE_NOTE.tooMany, label: "Too many changes at once", note: "An apply's answer when one batch holds more changes than one GM edit may.", text: "One batch holds at most {{max}} changes, as one GM edit does.", vars: [{ name: "max", text: "the most one GM edit holds", required: true }] },
  { id: WRITE_NOTE.editMissing, label: "Text not in the file", note: "workspace_edit's answer when the file doesn't hold the text to replace.", text: "{{path}} doesn't hold that text.", vars: [filePath] },
  { id: WRITE_NOTE.learnedMove, label: "Into or out of learned/", note: "workspace_move's answer when it would take a file into or out of the learned area (learned/), which is kept apart from the turns.", text: "{{path}} can't move to {{to}}: files under learned/ stay there, and the others stay out of it. Write the file at its new path, then delete the old one.", vars: [filePath, { name: "to", text: "the path it was to move to" }] },
  { id: WRITE_NOTE.fileExists, label: "A path taken in learned/", note: "workspace_move's answer, in the learned area, when a file is already at the path it was to move to.", text: "A workspace file is already at {{to}}: pick another path.", vars: [{ name: "to", text: "the path it was to move to" }] },
  { id: WRITE_NOTE.editSeveral, label: "Text in the file more than once", note: "workspace_edit's answer when the text to replace is there more than once and all isn't set.", text: "{{path}} holds that text {{count}} times: give more of it to pick one, or set all to replace every one.", vars: [filePath, { name: "count", text: "how many times the file holds it", required: true }] },
  { id: WRITE_NOTE.noLore, label: "No such lore entry", note: "A lore tool's answer when no entry has the id, or none the agent's knowledge may read.", text: "No lore entry {{id}} here.", vars: [{ name: "id", text: "the entry id the call gave" }] },
  { id: WRITE_NOTE.draftPath, label: "A draft outside lore-drafts/", note: "lore_draft's answer when the path it was given isn't under lore-drafts/.", text: "A lore draft goes under lore-drafts/, and {{path}} isn't there.", vars: [filePath] },
  { id: WRITE_NOTE.cancelled, label: "Cancelled", note: "A write's answer when the agent's work was cancelled before it ran.", text: "The agent's work was cancelled, so nothing was checked or written.", vars: [] },
  { id: WRITE_NOTE.paused, label: "The chat is paused", note: "An apply's answer while an earlier message's edit waits for Keep or Discard.", text: "An earlier message was edited: Keep or Discard it first, under that message.", vars: [] },
  { id: WRITE_NOTE.noWorld, label: "No world", note: "A write's answer when the chat plays no LumiRPEngine world, or its world isn't loaded.", text: "This chat plays no LumiRPEngine world, or its world isn't loaded.", vars: [] },
  { id: WRITE_NOTE.noChange, label: "A change that changes nothing", note: "A write's answer when the change would leave everything as it is, or, under the player character's knowledge, when it can't be made for a reason the player mustn't learn of.", text: "That changes nothing.", vars: [] },
  { id: WRITE_NOTE.stale, label: "The chat changed meanwhile", note: "An apply's answer when the chat changed between the check and the write (a turn landed), so the engine no longer takes the change.", text: "The chat changed while this was being written, so it no longer applies: read it again and propose the change anew.", vars: [] },
];
