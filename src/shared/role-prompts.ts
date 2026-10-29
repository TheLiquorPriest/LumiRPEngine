// What an agent turn's roles say to their models (AGENT-LOOP-PLAN §9, INC2-SPEC lane T2): one Prompts
// page per role, each with its system prompt, its instructions, and for each task it works its task
// text and the description of the answer it gives (its output contract, §16, which is fixed: only its
// description is a text). A task's text may name the world's or your own wording of the classic step
// it stands in for, which reads as the text's world level (`world: "after-user"`): your text here wins,
// then that wording, then the shipped text. A shared page holds what every role is told: what its
// tools show it, and how the preset's guidance leads in. Tool descriptions are the tools' own texts
// (`tool.<name>`, GM agent page). Each shipped text is classic's own wording where the role stands in
// for a classic step, so a role works its task as that step does.

import type { RoleId } from "./agent-roles";
import { ROLE_LABEL } from "./agent-roles";
import { KNOWLEDGE_ANSWER_SHAPE, MEMORY_ANSWER_V2, MIND_ANSWER_FORMATS, MIND_PROMPT_DEFAULTS } from "./minds";
import type { PromptDef, PromptPage, PromptVar } from "./prompts";
import { SKIP_PLAN_ANSWER, SKIP_PLAN_PROMPT } from "./skip-plan";
import { DECISION_PROMPTS, PROSE_PROMPTS } from "./steps";

/** The page every role's shared texts are on. */
export const ROLES_PAGE: PromptPage = { id: "roles", label: "Every role", note: "What every role of an agent turn is told besides its own prompts: what its tools show it, how the preset's guidance for its steps leads in, and how its pinned files come." };

/** A role's own page. */
export function rolePageId(role: RoleId): string {
  return `role.${role}`;
}

/** A role's text that isn't a task's: its system prompt or its instructions. */
export function roleTextId(role: RoleId, part: "system" | "instructions"): string {
  return `role.${role}.${part}`;
}

/** A role's text for one of its tasks (`sub`): what to do, an answer's description, or one of the task's own parts. */
export function roleTaskTextId(role: RoleId, sub: string, part: string): string {
  return `role.${role}.${sub}.${part}`;
}

/** The output contract a role's task keeps (§16): the JSON its answer is checked against, by id. */
export function roleContractId(role: RoleId, sub: string): string {
  return `role.${role}.${sub}`;
}

/** The shared texts' ids. */
export const ROLES_TEXT = {
  sees: { pov: "role.sees.pov", everyone: "role.sees.everyone", gm: "role.sees.gm", own: "role.sees.own" },
  guidance: "role.guidance",
  guidanceBlock: "role.guidance.block",
  pins: "role.pins",
  pinsFile: "role.pins.file",
  pinsHeadings: "role.pins.headings",
  pinsNoHeadings: "role.pins.no_headings",
} as const;

/** Every role's tasks, by the classic step each stands in for, in the order its page lists them: the first is the one a Test of its system prompt or instructions runs. */
export const ROLE_TASKS: Readonly<Record<RoleId, readonly string[]>> = {
  intent: ["interpret", "judge", "puzzle"],
  scene: ["scene"],
  minds: ["mind"],
  knowledge: ["knowledge"],
  director: ["decisions", "prose", "choices"],
  read: ["extract"],
  memory: ["memory", "consolidate"],
  skip: ["beats", "plan"],
  world: ["effects"],
};

const WORLD_VARS: readonly PromptVar[] = [
  { name: "world", text: "the world's name" },
  { name: "pov", text: "the player character's name" },
];

/** What a role's system prompt may name besides: what its tools show it, in the words of the shared page. */
const SYSTEM_VARS: readonly PromptVar[] = [...WORLD_VARS, { name: "knowledge", text: "what the role's tools show it: the shared page's text for the knowledge it reads with (Settings → Agents → Roles → Knowledge)" }];

/** What a minds step's prompt is filled with, as Settings → Minds names them. */
const MIND_VARS: readonly PromptVar[] = [
  { name: "character", text: "the character the call thinks for; empty for one about no one" },
  { name: "world", text: "the world's name" },
  { name: "pov", text: "the player character, as that character knows them" },
  { name: "place", text: "where that character is" },
  { name: "clock", text: "the time in the world" },
];

/** What the prose steps' texts are filled with, as Settings → Steps and connections names them. */
const PROSE_VARS: readonly PromptVar[] = [
  ...WORLD_VARS,
  { name: "place", text: "where the player character is" },
  { name: "clock", text: "the time in the world" },
  { name: "scene", text: "the scene as the player character knows it" },
  { name: "present", text: "who is present" },
  { name: "facts", text: "the facts of the turn" },
  { name: "outcome", text: "the turn's Outcome lines" },
  { name: "beats", text: "the engine's beats for the turn" },
  { name: "brief", text: "the brief, once written" },
  { name: "user", text: "the player's message" },
  { name: "reply", text: "the narrator's reply, after it" },
  { name: "recent", text: "the recent turns" },
  { name: "gear", text: "what the player character carries and wears" },
  { name: "money", text: "the player character's money" },
  { name: "property", text: "what the player character owns or may use" },
  { name: "positions", text: "who is here with the player character, and what they're doing" },
  { name: "knowledge", text: "what the player character knows of the quests" },
  { name: "usual", text: "the usual routines of the people with the player character" },
  { name: "sections", text: "the sections the narrator has this turn" },
];

const INSTRUCTIONS = "Instructions";

function page(role: RoleId, note: string): PromptPage {
  return { id: rolePageId(role), label: ROLE_LABEL[role], note };
}

/** A role's system prompt and instructions, whose Test runs its first task. */
function roleTexts(role: RoleId, system: string, instructions: string): PromptDef[] {
  const contract = roleContractId(role, ROLE_TASKS[role][0] ?? role);
  return [
    { id: roleTextId(role, "system"), page: rolePageId(role), group: INSTRUCTIONS, label: "System prompt", note: "Who the role's agent is, what it does in the turn, and what it may rely on.", text: system, vars: SYSTEM_VARS, contract },
    { id: roleTextId(role, "instructions"), page: rolePageId(role), group: INSTRUCTIONS, label: "Role instructions", note: "How it works through each of its tasks. The preset's guidance for its steps follows them.", text: instructions, vars: WORLD_VARS, contract },
  ];
}

/** One text of one of a role's tasks. */
function taskText(role: RoleId, sub: string, group: string, part: string, def: Omit<PromptDef, "id" | "page" | "group" | "contract">): PromptDef {
  return { id: roleTaskTextId(role, sub, part), page: rolePageId(role), group, contract: roleContractId(role, sub), ...def };
}

/** How every role works: look up what the task leaves unclear, never invent, answer only in the task's form. */
function howToWork(role: string, extra: readonly string[] = []): string {
  return [
    "How to work:",
    "- Read the task through first. Look things up with your tools only where the task leaves something unclear, by the names it uses; a name the tools don't find is one you can't see, so work without it.",
    "- Never invent people, places, things, amounts or ids: use those the task and the tools give, as they give them.",
    ...extra.map((line) => `- ${line}`),
    `- Your answer is the ${role}'s: the engine checks it and uses only what holds. Answer once, with JSON only, in exactly the form the task's answer asks for, with nothing around it.`,
  ].join("\n");
}

const SEES_NOTE = "Fills {{knowledge}} in a role's system prompt while it reads with ";

const SHARED_PROMPTS: readonly PromptDef[] = [
  { id: ROLES_TEXT.sees.pov, page: ROLES_PAGE.id, group: "What a role's tools show it", label: "Your character's knowledge", note: `${SEES_NOTE}your character's knowledge.`, text: "only what {{pov}}, the player character, knows: nobody and nothing they haven't met, seen or been told of", vars: WORLD_VARS },
  { id: ROLES_TEXT.sees.everyone, page: ROLES_PAGE.id, group: "What a role's tools show it", label: "Everyone's knowledge, secrets marked", note: `${SEES_NOTE}what everyone in the world knows.`, text: "what everyone in the world knows, each secret marked with whom it is known to and whom it is kept from", vars: WORLD_VARS },
  { id: ROLES_TEXT.sees.gm, page: ROLES_PAGE.id, group: "What a role's tools show it", label: "The GM's knowledge", note: `${SEES_NOTE}the game master's knowledge.`, text: "everything, as the game master sees it: every secret, plan and hidden person, place and thing", vars: WORLD_VARS },
  { id: ROLES_TEXT.sees.own, page: ROLES_PAGE.id, group: "What a role's tools show it", label: "A character's own knowledge", note: `${SEES_NOTE}one character's own knowledge, as a mind does: it has no tools, and its task holds what it reads.`, text: "nothing beyond the task: it holds only what the character it is about knows, and that is all you work from", vars: WORLD_VARS },
  { id: ROLES_TEXT.guidance, page: ROLES_PAGE.id, group: "The preset's guidance", label: "Before the guidance", note: "Leads the blocks of your preset's guidance for the steps a role stands in for (RPEngine · <step>), after its instructions, when the preset has any.", text: "Style and rules from the player's preset, each under the step it is for. Follow them where they fit the instructions above; they never change what you answer or its form:\n{{blocks}}", vars: [{ name: "blocks", text: "the preset's blocks for the role's steps, each under its step's name", required: true }] },
  { id: ROLES_TEXT.guidanceBlock, page: ROLES_PAGE.id, group: "The preset's guidance", label: "One step's guidance", note: "One block of the preset's guidance, under the name of the step it is for.", text: "{{step}}:\n{{text}}", vars: [{ name: "step", text: "the step's name, as Settings → Steps and connections names it", required: true }, { name: "text", text: "the block's text", required: true }] },
  { id: ROLES_TEXT.pins, page: ROLES_PAGE.id, group: "Pinned files", label: "Pinned files", note: "Frames a role's pinned files after its instructions and guidance: those .pins.json lists for the role, then those pinned in GM → Workspace, read with its knowledge within its pins budget. A role reading with a character's own knowledge gets none.", text: "Pinned files for your work (at most {{tokens}} {{unit}} of them; a file past that comes as its headings):\n{{files}}", vars: [{ name: "tokens", text: "the role's pins budget: the manifest's for it, else Settings → Agents → Main agent's Pinned files, per role" }, { name: "unit", text: '"token" for 1, else "tokens"' }, { name: "files", text: "each file, as below", required: true }] },
  { id: ROLES_TEXT.pinsFile, page: ROLES_PAGE.id, group: "Pinned files", label: "A pinned file", note: "One of a role's pinned files, whole.", text: "[{{path}}]\n{{text}}", vars: [{ name: "path", text: "the file's path", required: true }, { name: "text", text: "the file's text", required: true }] },
  { id: ROLES_TEXT.pinsHeadings, page: ROLES_PAGE.id, group: "Pinned files", label: "A file past the budget", note: "One of a role's pinned files past its pins budget: its headings only.", text: "[{{path}}: its headings]\n{{headings}}", vars: [{ name: "path", text: "the file's path", required: true }, { name: "headings", text: "the file's heading lines, or the text for none" }] },
  { id: ROLES_TEXT.pinsNoHeadings, page: ROLES_PAGE.id, group: "Pinned files", label: "No headings", note: "Stands in for the headings of a file past the pins budget that has none.", text: "(no headings)", vars: [] },
];

// ---------------------------------------------------------------- intent

const INTERPRET_VARS: readonly PromptVar[] = [
  ...WORLD_VARS,
  { name: "pov_id", text: "the player character's id" },
  { name: "instructions", text: "the world's or your own words for the interpret step (Settings → Steps and connections), which lead it; empty when there are none" },
  { name: "scene", text: "the scene as the player character knows it" },
  { name: "places", text: "the places nearby, nearest first, each by id and name" },
  { name: "recent", text: "the messages before the input, oldest first" },
  { name: "catalog", text: "every action the player character can take here, one to a line", required: true },
  { name: "text", text: "the player's input", required: true },
  { name: "currency", text: "the world's money, as its code" },
  { name: "symbol", text: "the world's money sign" },
  { name: "more", text: "how many more actions one input may take after its first" },
  { name: "timelapse", text: "the time-skip rule below, while the catalog has the time skip; else empty" },
  { name: "try", text: "the Try something rule below, while the catalog has it; else empty" },
];

const INTERPRET_TASK = [
  "{{instructions}}",
  "Map the player's typed input in this roleplay to the engine actions it takes, in order.",
  "World: {{world}}. The player character is {{pov}} (id {{pov_id}}).",
  "",
  "Scene:",
  "{{scene}}",
  "",
  "Places (id: name), nearest first:",
  "{{places}}",
  "",
  "Recent messages, oldest first:",
  "{{recent}}",
  "",
  "Action catalog:",
  "{{catalog}}",
  "",
  "Rules:",
  '- Read what the player character does in the input. Work out what it refers to ("what she offered", "there", "him") from the scene and the recent messages.',
  '- Only the player character\'s own deliberate actions count, whether said in the first person ("I", "we"), as a stage direction ("[{{pov}} heads to the roof]") or as narration about {{pov}} in the third person. "I\'ll …" about what the player character does now is an action.',
  '- No action ("action": null) for speech alone, out-of-character text ("OOC:", "((…))") that doesn\'t say time passes, questions, requests to others, what someone else does, hypotheticals, plans for another time, recaps or feelings.',
  "{{timelapse}}",
  '- Use only the catalog\'s actions, as described there: never invent one. When no catalog action fits, "action" is null. An incidental action that fits none, or names someone or somewhere nothing lists where its param takes only what is listed, is left out: it never hides the actions after it.',
  '- An action on a thing the player says they have that nothing lists ("I pour Theresa a coffee" with no coffee listed) is still read, in order with the rest: its param holds the thing in the input\'s own words ("coffee"), and "thing" says what sort of thing it is: "food", "drink", "weapon", "key", "document", "money" or "other".',
  '- When the input and its context still leave it unclear which action or which target is meant, give "action": null and a short "reason"; never guess.',
  '- Params are world ids, from the scene, Places and the catalog\'s lists, except a thing nothing lists, or anyone or anything a param takes in the input\'s own words ("I drop a coin in the tip jar": its receiver is "the tip jar"), which keeps the input\'s own words. A text param that names an item keeps its qualifiers as written ("large pizza, delivered", not "pizza"). Money params are plain amounts in {{currency}} as written (200 for {{symbol}}200).',
  '- Read every action in the input, in order, not only the first. Return the first as "action" with its "params" and its "text": that action written as the player would type it, with whatever and whoever it involves ("I take the envelope from the clerk"). If the input has more actions after it, list them in order in "more" (at most {{more}}), each {"action": a catalog id, "params": {...}, "text": that action written as the player would type it}: "I walk to the market and buy bread" → "action" for the walk, and "more": [{"action": <the buy\'s id>, "params": {"item": "bread"}, "text": "I buy bread"}]. An action after them that no catalog action fits goes in "next", written as the player would type it.',
  '- If the input lets time pass after its last action, in character ("…and sleep until the next morning", "…then wait two hours", "…then skip ahead to Friday at 6 PM") or out of character after the input gets the player character out of bed or up from a rest, add "then": {"span": its words for how long or until when, with "minutes", "until" (a day part, "shift" or "commitment") or "at" ("YYYY-MM-DD HH:MM" for a stated day and time)}; time passing is never in "more" or "next", nor is anything else that isn\'t an action.',
  '- If the input itself plainly states, as settled fact, a lasting change to someone\'s week (the player character\'s own, "I start nights at the marina Monday", or one the input says someone told of, "Marcus says he\'s started swimming on Tuesdays"), add it to "routine": [{"entity": their id, "change": "start" for a new job, shift or habit, "stop" for one given up, "move" for a new home, "label": what it is in the input\'s words, "days": the days the input states (weekday names, "weekdays", "weekends" or "daily"; leave it out when the input states none, never guess), "start"?/"end"?: "HH:MM" as stated (or "start": morning|afternoon|evening|night), "activity"?: work|school|exercise|leisure|socialize|errand, "place"?: any place the input names for it, as a place id, or in the input\'s own words when nothing lists it ("the community pool"); left out only when the input names none (for "move", the new home), "with"?: people\'s ids, "replaces"?: true only when the input says it takes the place of what they did then, "said": the input\'s own words that state it, copied exactly}]. Never for a question ("do you still swim on Tuesdays?"), a one-off, a plan, a wish, a hypothetical, someone\'s thoughts, or a habit only mentioned in passing ("I walk past the pool where I swim on Tuesdays"). It is never an action, and changes nothing about "action", "more", "then" or "next".',
  "{{try}}",
  "- When the input takes for granted that {{pov}} is somewhere other than the scene's place (beside someone who isn't here, at a fixture of another place), read the move there first, as \"I go there\" is read: to where that person was last seen, or the place with that fixture.",
  "- When it takes for granted that what the scene lists as left from the last message happened, read those actions first, in order.",
  "",
  "The player's input:",
  "{{text}}",
].join("\n");

const TIMELAPSE_RULE =
  '- A time skip is "action": "{{action}}", whatever else the input says: an out-of-character instruction that time passes or skips ahead ("OOC: over the next hour, I sort the stock", "(OOC: skip ahead two hours)", "[OOC] later that evening", "((cover the next hour))"), and in character a span spent on something no catalog action covers ("I spend the next hour sorting the stock"). Its "params" hold "span", the input\'s own words for how long or until when ("over the next hour"), with "minutes", "until" or "at" as the catalog says. Its "text" is what the input says happens in that time, in the input\'s own words ("I sort the stock"), left out when it says nothing happens. What the input says happens in that time fills it: never an action of its own, nor in "more", "next" or "then". The one exception is in-character input that, before the out-of-character instruction, gets the player character out of bed or up from a rest with a catalog action ("I get out of bed and make coffee. (OOC: skip an hour.)"): read that action, and any actions after it, as usual, and the time as their "then". What the out-of-character instruction itself says happens ("OOC: skip to morning, I get up", "OOC: over the next two hours, I walk to the gym") still fills the time.';

const TRY_RULE =
  '- An attempt whose outcome is uncertain that no other catalog action covers is "{{action}}" (Try something), even asked as a question ("I watch him as he answers: is he lying?" is the player character\'s reading of him against his deceit). Never read an attempt a catalog action covers as "{{action}}", nor both: that action alone. "attempt" is what is attempted, in the input\'s words; "skill" and "difficulty" come from its lists; "with" lists the companions the input has join in ("we sneak past"); "against" lists the people here it opposes or targets, each with the skill they resist with.';

const INTERPRET_ANSWER =
  'Output JSON only, exactly this shape: {"action": string|null, "params": {...}, "text"?: string, "thing"?: string, "confidence": number, "reason"?: string, "more"?: [{"action": string, "params": {...}, "text": string, "thing"?: string}], "then"?: {"span": string, "minutes"?: number, "until"?: string, "at"?: string}, "next"?: string, "routine"?: [{"entity": string, "change": string, "label": string, "days"?: string|string[], "start"?: string, "end"?: string, "activity"?: string, "place"?: string, "with"?: string[], "replaces"?: boolean, "said": string}]}.';

const ACTION_VAR: readonly PromptVar[] = [{ name: "action", text: "the action's id in the catalog", required: true }];

const JUDGE_VARS: readonly PromptVar[] = [
  ...WORLD_VARS,
  { name: "question", text: "the question it answers: the text above, or the world's or your own words for the judge step", required: true },
  { name: "max", text: "the top of the scale" },
  { name: "outcomes", text: "the outcomes rule below, when the story decides how it turns out; else empty" },
  { name: "action", text: "what the player character attempts" },
  { name: "text", text: "the player's words for how they go about it", required: true },
  { name: "scene", text: "where the player character is and who is there, as the player may know them" },
];

const PUZZLE_VARS: readonly PromptVar[] = [
  ...WORLD_VARS,
  { name: "question", text: "the question it answers: the text above, or the world's or your own words for the puzzle step", required: true },
  { name: "puzzle", text: "the puzzle the player answers" },
  { name: "accepted", text: "the answers the puzzle accepts", required: true },
  { name: "answer", text: "the player's answer", required: true },
];

const INTENT_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "intent",
    "You are the intent agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. Each of your tasks reads what the player wrote: the engine actions it takes, how well an approach suits a check, or whether an answer to a puzzle is right. Your tools show you {{knowledge}}. They and the task are your only sources: never guess or fill a gap from memory.",
    howToWork("intent agent", ["A name in the player's words is one of the scene's, the places' or the catalog's when it can be, by its id; look someone or somewhere up only when the task's lists don't settle it."]),
  ),
  taskText("intent", "interpret", "Reading the message", "task", { label: "What to do", note: "The interpret step's work: the player's typed input read into the engine actions it takes, in order, from the catalog the player character may play now.", text: INTERPRET_TASK, vars: INTERPRET_VARS }),
  taskText("intent", "interpret", "Reading the message", "timelapse", { label: "The time-skip rule", note: "Joins the rules while the catalog has the time skip.", text: TIMELAPSE_RULE, vars: ACTION_VAR }),
  taskText("intent", "interpret", "Reading the message", "try", { label: "The Try something rule", note: "Joins the rules while the chat infers checks and the catalog has Try something.", text: TRY_RULE, vars: ACTION_VAR }),
  taskText("intent", "interpret", "Reading the message", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the first action and its params, the further ones, time passing after them, and the routine changes the input states.", text: INTERPRET_ANSWER, vars: [] }),
  taskText("intent", "judge", "Judging an approach", "question", { label: "The question", note: "What the judge is asked. The world's or your own words for the judge step stand in for it.", text: DECISION_PROMPTS.judge, vars: [], world: "after-user" }),
  taskText("intent", "judge", "Judging an approach", "task", { label: "What to do", note: "The judge step's work: the approach the player described rated for the check their action rolls, and, when the story decides, each outcome's odds.", text: "{{question}} Rate the approach from 0 (no particular approach, or one that works against them) to {{max}} (a clever, prepared approach that fits the situation), and give a one-line reason in plain words.\n{{outcomes}}\n\nAction: {{action}}\nThe player wrote: {{text}}\nScene: {{scene}}", vars: JUDGE_VARS }),
  taskText("intent", "judge", "Judging an approach", "outcomes", { label: "When the story decides", note: "Joins the task when the story decides how the attempt turns out: the outcomes to give odds to, with the dice's.", text: "Then decide how it turns out: give each outcome a probability. The dice's exact odds are guidance: lean on them, and move them toward success for a strong approach and away from it for a weak one.\nOutcomes with the dice's exact odds: {{odds}}", vars: [{ name: "odds", text: "each outcome with the dice's exact odds of it", required: true }] }),
  taskText("intent", "judge", "Judging an approach", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the rating, a reason in a line, and each outcome's probability when the story decides.", text: 'Output JSON only: {"rating": number, "reason": string{{keys}}}.', vars: [{ name: "keys", text: "the outcomes the answer gives odds to, in its form, when the story decides; else empty" }] }),
  taskText("intent", "puzzle", "A puzzle's answer", "question", { label: "The question", note: "What the puzzle step is asked. The world's or your own words for it stand in for it.", text: DECISION_PROMPTS["puzzle.answer"], vars: [], world: "after-user" }),
  taskText("intent", "puzzle", "A puzzle's answer", "task", { label: "What to do", note: "The puzzle step's work: how likely the player's answer to a puzzle is right. It is told the accepted answers, a secret, so it is its own call.", text: "{{question}}\n\nThe puzzle: {{puzzle}}\nAccepted answers: {{accepted}}\nThe player's answer: {{answer}}", vars: PUZZLE_VARS }),
  taskText("intent", "puzzle", "A puzzle's answer", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): one probability.", text: 'Output JSON only: {"correct": {"p": number}}, p being the probability, from 0 to 1, that the answer is correct.', vars: [] }),
];

// ---------------------------------------------------------------- scene

const SCENE_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "scene",
    "You are the scene agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. Before each turn is planned you choose what the narrator should have in front of it for the scene: the lore entries that bear on what is happening now, and short notes on what matters in it. Your tools show you {{knowledge}}. They and the task are your only sources: never guess or fill a gap from memory.",
    howToWork("scene agent", ["Choose a lore entry only once you have read it with the lore tools, by the id they give; never one that only might matter.", "A note states what the world as your tools show it already holds: never invent, decide or foretell anything, and leave out whatever the narrator's sections already give."]),
  ),
  taskText("scene", "scene", "Choosing the scene's lore", "task", { label: "What to do", note: "The scene's work, before the plan: the lore and notes the narrator should have for this turn.", text: "Choose what the narrator should have for this turn's scene: the lore entries that bear on what is happening now, and up to a few short notes on what matters in it (who is here and in what state, what is pressing).\n\nThe player wrote:\n{{text}}\n\nWhere: {{place}}\nPresent: {{present}}", vars: [...WORLD_VARS, { name: "text", text: "the player's message", required: true }, { name: "place", text: "where the player character is, as they know it" }, { name: "present", text: "who is present, as the player character may know them" }] }),
  taskText("scene", "scene", "Choosing the scene's lore", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): lore entry ids and notes.", text: 'Output JSON only: {"lore": ["<lore entry id>"], "notes": ["..."]}; empty lists when the scene needs nothing.', vars: [] }),
];

// ---------------------------------------------------------------- minds, knowledge, memory, skip

const MINDS_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "minds",
    "You are the minds agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. Each task is one character's private mind at a moment of the story, blind to every other mind. Your tools show you {{knowledge}}.",
    howToWork("mind", ["Think only from what the task gives the character: what they perceive, remember and hold. Nothing else is theirs to know."]),
  ),
  taskText("minds", "mind", "A mind", "task", { label: "What to do", note: "The mind step's work: how one character reads the moment and what they intend. Their context follows it. The world's or your own wording of the mind step (Settings → Minds) stands in for it.", text: MIND_PROMPT_DEFAULTS.mind, vars: MIND_VARS, world: "after-user" }),
  taskText("minds", "mind", "A mind", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): thoughts, depiction, intent, reactions and mood.", text: MIND_ANSWER_FORMATS.mind, vars: [] }),
];

const KNOWLEDGE_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "knowledge",
    "You are the knowledge agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. You keep track of who knows what: after a reply, and before a turn is planned when a decision turns on it, you work out what each person present or told learned, inferred, doubted or forgot. Your tools show you {{knowledge}}.",
    howToWork("knowledge agent", ["Record only the few facts that would change what someone does, says, hides or believes, each saying why it matters and to whom.", "No one learns what they couldn't have perceived or been told, and whoever tells something must already hold it; the engine refuses anything else."]),
  ),
  taskText("knowledge", "knowledge", "Who learned what", "task", { label: "What to do", note: "The knowledge step's work. What happened, who could perceive it and what each already holds follow it. The world's or your own wording of the knowledge step (Settings → Minds) stands in for it.", text: MIND_PROMPT_DEFAULTS.knowledge, vars: MIND_VARS, world: "after-user" }),
  taskText("knowledge", "knowledge", "Who learned what", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): new facts, learnings, inferences and doubts. Its lists' wording is yours from Settings → Minds → Knowledge.", text: `${KNOWLEDGE_ANSWER_SHAPE}\n{{lists}}`, vars: [{ name: "lists", text: "what each list holds, in your wording (Settings → Minds → Knowledge)" }] }),
];

const MEMORY_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "memory",
    "You are the memory agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. Each task keeps one character's memory: what they will remember of a turn as written, and, now and then, their older notes folded into their summary. Your tools show you {{knowledge}}.",
    howToWork("memory", ["Only what was written happened, and only what the character could see or hear of it counts."]),
  ),
  taskText("memory", "memory", "Remembering a turn", "task", { label: "What to do", note: "The memory step's work. What the character knows and the turn as written follow it. The world's or your own wording of the memory step (Settings → Minds) stands in for it.", text: MIND_PROMPT_DEFAULTS.memory, vars: MIND_VARS, world: "after-user" }),
  taskText("memory", "memory", "Remembering a turn", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): notes, commitments, what they resolved, plans, what they told whom, and their summary.", text: MIND_ANSWER_FORMATS.memory, vars: [] }),
  taskText("memory", "memory", "Remembering a turn", "answer_knowing", { label: "Its answer while knowledge is tracked", note: "The same, without what they told whom (a fixed output contract, the memory step's second version): while the chat tracks knowledge, the knowledge step records telling.", text: MEMORY_ANSWER_V2, vars: [] }),
  taskText("memory", "consolidate", "Folding notes", "task", { label: "What to do", note: "The consolidate step's work. The notes to fold and the summary follow it. The world's or your own wording of the consolidate step (Settings → Minds) stands in for it.", text: MIND_PROMPT_DEFAULTS.consolidate, vars: MIND_VARS, world: "after-user" }),
  taskText("memory", "consolidate", "Folding notes", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the summary.", text: MIND_ANSWER_FORMATS.consolidate, vars: [] }),
];

const SKIP_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "skip",
    "You are the time-skip agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. When the player skips ahead in time you find the moments inside the skip worth stopping for, and plan how the people the engine lives a day for spend it. Your tools show you {{knowledge}}.",
    howToWork("time-skip agent", ["Use only the people, places, activities and times the task lists, by the ids and words it gives."]),
  ),
  taskText("skip", "beats", "Moments in a skip", "task", { label: "What to do", note: "The skip step's work: further moments inside the span worth stopping for. The span, the moments found and what the people involved plan follow it. The world's or your own wording of the skip step (Settings → Minds) stands in for it.", text: MIND_PROMPT_DEFAULTS.skip, vars: MIND_VARS, world: "after-user" }),
  taskText("skip", "beats", "Moments in a skip", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the moments.", text: MIND_ANSWER_FORMATS.skip, vars: [] }),
  taskText("skip", "plan", "Planning a skip", "task", { label: "What to do", note: "The skip plan's work: blocks of time for each person planned. Who they are, the span and the places and activities follow it. Your own wording of the time-skip step (Settings → Steps and connections) stands in for it.", text: SKIP_PLAN_PROMPT, vars: [...WORLD_VARS, { name: "place", text: "where the player character is, as they know it" }, { name: "clock", text: "when the skip starts" }], world: "after-user" }),
  taskText("skip", "plan", "Planning a skip", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): each person's blocks.", text: SKIP_PLAN_ANSWER, vars: [] }),
];

// ---------------------------------------------------------------- director

const PROSE_DATA = ["Facts:", "{{facts}}", "", "Present:", "{{present}}", "", "Outcome:", "{{outcome}}", "", "Engine beats:", "{{beats}}", "", "Brief:", "{{brief}}", "", "Recent turns:", "{{recent}}", "", "The player wrote:", "{{user}}"].join("\n");

const DIRECTOR_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "director",
    "You are the director agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. You decide nothing yourself: you give the odds of what the people of the world choose, which the engine samples; you brief and outline the narrator's next reply from the facts the engine planned; and you suggest what the player might do next. Your tools show you {{knowledge}}.",
    howToWork("director", ["A person's choice reads only what they know: the task gives it, and nothing else of theirs or anyone's counts for it."]),
  ),
  taskText("director", "decisions", "A person's choices", "question", { label: "The question", note: "What each person's choices are asked. The world's or your own words for the npc.choose step stand in for it.", text: DECISION_PROMPTS["npc.choose"], vars: [], world: "after-user" }),
  taskText("director", "decisions", "A person's choices", "task", { label: "What to do", note: "The npc.choose step's work, one person at a time: the odds of each option of each choice they have open, which the engine samples on the turn's seeded generator. It reads what they hold, never anyone else's.", text: "{{question}} Give the odds of each option of each of their choices.\n\nWho: {{who}}\nWhere: {{place}}\nWhen: {{time}}\n\n{{holdings}}\n\nTheir choices, each by its key, with what is known of it and its options:\n{{choices}}", vars: [...WORLD_VARS, { name: "question", text: "the question: the text above, or the world's or your own words for the npc.choose step", required: true }, { name: "who", text: "the person who chooses" }, { name: "place", text: "where they are" }, { name: "time", text: "the time in the world" }, { name: "holdings", text: "what they know, while the chat tracks knowledge; else empty" }, { name: "choices", text: "their open choices, each by its key", required: true }] }),
  taskText("director", "decisions", "A person's choices", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): each choice's odds.", text: 'Output JSON only: {"<choice key>": {"probabilities": {"<option>": number}}}, one entry for each of their choices, each option\'s probability from 0 to 1.', vars: [] }),
  taskText("director", "prose", "Briefing the narrator", "brief", { label: "The brief", note: "What the brief is asked, when the brief step runs. The world's or your own words for the brief step stand in for it.", text: PROSE_PROMPTS.brief, vars: PROSE_VARS, world: "after-user" }),
  taskText("director", "prose", "Briefing the narrator", "outline", { label: "The outline", note: "What the outline is asked, when the outline step runs. The world's or your own words for the outline step stand in for it.", text: PROSE_PROMPTS.outline, vars: PROSE_VARS, world: "after-user" }),
  taskText("director", "prose", "Briefing the narrator", "task", { label: "What to do", note: "The brief and outline steps' work for the planned turn: what the narrator is told before the reply, from the facts the engine planned.", text: `{{asks}}\n\n${PROSE_DATA}\n\nSections the narrator has this turn (point at no other):\n{{sections}}`, vars: [...PROSE_VARS, { name: "asks", text: "the brief's and the outline's texts above, for each step that runs this turn", required: true }] }),
  taskText("director", "prose", "Briefing the narrator", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the brief and the outline's beats.", text: 'Output JSON only: {"brief": string, "beats": string[]}, with at most {{beats_max}} beats, in order. Leave out "brief" or "beats" when the task doesn\'t ask for it.', vars: [{ name: "beats_max", text: "the most outline beats the narrator is given" }] }),
  taskText("director", "choices", "Suggesting next moves", "rule", { label: "The suggestions", note: "What the suggestions are asked. The world's or your own words for the choices step stand in for it.", text: PROSE_PROMPTS.choices, vars: PROSE_VARS, world: "after-user" }),
  taskText("director", "choices", "Suggesting next moves", "task", { label: "What to do", note: "The choices step's work after the reply: what the player might do next, as chips.", text: `{{rule}}\n\n${PROSE_DATA}\n\nThe narrator's reply:\n{{reply}}`, vars: [...PROSE_VARS, { name: "rule", text: "the suggestions' text above", required: true }] }),
  taskText("director", "choices", "Suggesting next moves", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the suggestions.", text: 'Output JSON only: {"choices": string[]}.', vars: [] }),
];

// ---------------------------------------------------------------- read

const EXTRACT_TYPES =
  'time_advance{minutes} · location{entity,place} (place: its id from Places, or its name as Places lists it) · purchase{item,category,payer?,qty?,price?,method?} (payer: the person who pays, an entity id, never an account or a card; method: how the prose says they paid, in its words, e.g. "cash", "debit card", "credit card" or "savings"; leave it out when not said) · transfer{from,to,amount,method?} (from and to: people, entity ids, or a person\'s own cash, checking, savings or card account, never things; method: "cash" when bills or coins change hands in person, as in "hands me $20" or "slips her a twenty"; leave it out for a bank transfer, an app payment or a card) · give{item,from,to,amount?} (amount: for cash or money handed over, the amount) · quantity{entity,item,delta} · condition{who,condition,minutes?,clear?} (a named condition such as tired or injured; clear:true when it ends) · regard{from,to,axis,delta} (axis {{axes}}; delta: as far as the prose moves it, inside the axis\'s range: worse negative, better positive) · knows{who,fact} (fact: the id of a person, thing or place the player character newly learns of, or the name of a place they first hear of; never a sentence) · spawn{kind,name,place?,role?} (a new character the reply introduces by name{{kinds}}; never a thing) · life{entity,state} (state: {{life}}) · routine{entity,change,label,days,start?,end?,minutes?,activity?,place?,with?,replaces?} (change: start for a new job, shift or habit, stop for one given up, move for a new home, its place the home; days: weekday names, weekdays, weekends or daily; start and end: HH:MM, or start morning|afternoon|evening|night; activity: work|school|exercise|leisure|socialize|errand; place: any place the prose names for it, as a place id, or in the prose\'s own words when nothing lists it ("the community pool"), left out only when the prose names none; with: people\'s ids; replaces: true only when the prose says it takes the place of what they did then) · take{entity,item} · drop{entity,item} · use_up{entity,item,qty?} (qty: how many, 1 when not said) · wear{entity,item,off?} · lose{entity,item,by?} (by: who stole it) · item_condition{entity?,item,delta} (delta: as far as the prose says it changed, on the condition\'s 0..100 scale: damage negative, mending positive)';

const EXTRACT_STRICT = [
  'time_advance only for an explicit jump or stated duration ("an hour later", "the next morning", "for twenty minutes"), as all the time the reply says passes from the player\'s message to its end, never less for what the turn already took; never estimate how long described activity took.',
  "knows only when the player character newly learns of a public person, thing or place from what is said or shown in this reply: fact is its id, or a place's name as the prose gives it; never a sentence or what they learned about it, never one already known, never what others learn.",
  "regard only when the prose states a clear change in how one character feels about another.",
  "give only for an explicit handover between two characters; a seller handing over what was bought is part of the purchase; picking something up is not a give.",
  "A purchase already covers its payment: do not add a transfer for it.",
  "One purchase per item: two things bought are two purchases, each with its own item and price; never one item that names both.",
  "life only when the prose states that someone died, is dying, collapsed or came round, or that the player character is told so; never a threat, a fear or a guess.",
  "routine only when the prose states a lasting change to someone's week: a new job or shift, a new habit, one they gave up, or a move to a new home, with the days and times the prose gives; never a one-off, a plan, a wish, someone's thoughts, or a habit only mentioned.",
  "take, drop, use_up, wear and lose only for a thing the prose says changed hands or state this reply: picked up or found (take), put down (drop), eaten, drunk or used up (use_up), put on or taken off (wear, off: true), lost or stolen (lose, by: the thief); item_condition only when it says a thing was damaged, worn out or mended.",
  "Never duplicate a change. When unsure, leave it out.",
];

const EXTRACT_TASK = [
  "{{instructions}}",
  "You read a narrator's roleplay reply and propose concrete state changes that the prose states actually happened.",
  "World: {{world}}. The player character is {{pov}} (id {{pov_id}}). Entities: {{entities}}. Places, those the reply names and the nearest first: {{places}}.",
  "Proposal types: {{types}}. {{enabled}}",
  "Rules: no considered, refused or hypothetical changes; use world ids where they exist; one proposal per change. Money amounts are plain amounts in {{currency}} as written (8 for {{symbol}}8).",
  "Strict rules:",
  ...EXTRACT_STRICT.map((rule) => `- ${rule}`),
  "{{where}}",
  "{{usual_rule}}",
  "",
  "State before: {{state}}",
  "{{usual}}",
  "{{message}}",
  "Narration:",
  "{{reply}}",
].join("\n");

const READ_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "read",
    "You are the read agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. After each reply you read it against the world and propose the changes it states actually happened; the engine checks each against the world and the player's settings, and refuses what doesn't hold. Your tools show you {{knowledge}}.",
    howToWork("read agent", ["Look up the people, things and places a change names when the task's lists don't give their ids, and what someone holds or owes when a change turns on it."]),
  ),
  taskText("read", "extract", "Reading the reply", "task", {
    label: "What to do",
    note: "The extract step's work: the changes the reply states, and where it leaves the player character.",
    text: EXTRACT_TASK,
    vars: [
      ...WORLD_VARS,
      { name: "pov_id", text: "the player character's id" },
      { name: "instructions", text: "the world's or your own words for the extract step (Settings → Steps and connections), which lead it; empty when there are none" },
      { name: "entities", text: "the entities it may name, each by id, name and kind" },
      { name: "places", text: "the places it is offered, each by id and name" },
      { name: "types", text: "the proposal types text below", required: true },
      { name: "enabled", text: "the enabled types text below, when only some are; else empty" },
      { name: "currency", text: "the world's money, as its code" },
      { name: "symbol", text: "the world's money sign" },
      { name: "where", text: "the where text below, while moves are read; else empty" },
      { name: "usual_rule", text: "the usual routines rule below, when it is given them; else empty" },
      { name: "state", text: "the state before the reply", required: true },
      { name: "usual", text: "the usual routines list below, when it is given them; else empty" },
      { name: "message", text: "the player's message text below, when there is one; else empty" },
      { name: "reply", text: "the narrator's reply", required: true },
    ],
  }),
  taskText("read", "extract", "Reading the reply", "types", { label: "Proposal types", note: "Each change the read may propose, with its fields. The axes, kinds and life states are the world's.", text: EXTRACT_TYPES, vars: [{ name: "axes", text: "the world's regard axes, each with its range" }, { name: "kinds", text: "the kinds a newcomer may be, after \"; kind: \"; empty when there are none" }, { name: "life", text: "the world's life states" }] }),
  taskText("read", "extract", "Reading the reply", "enabled", { label: "Enabled types", note: "Joins the task when only some types are read (Settings → Changes from the reply).", text: "Only these types are enabled: {{types}}.", vars: [{ name: "types", text: "the enabled types", required: true }] }),
  taskText("read", "extract", "Reading the reply", "where", { label: "Where it leaves the player character", note: "Joins the task while moves are read: a reply can take a move as given without telling it.", text: 'Beside "proposals", give "where": the place where the reply leaves the player character at its end, whether it tells how they got there or takes it as given, as its id from Places (or its name as Places lists it); null when it doesn\'t say.', vars: [] }),
  taskText("read", "extract", "Reading the reply", "usual_rule", { label: "Usual routines", note: "Joins the task when it is given the usual routines of the people with the player character.", text: 'Usual routines are given below the state, only to tell where a move the reply describes is going: someone who heads out to their usual spot ("his usual lunch place", "off to her regular bar") moves to that place; give its id from their usual routine, or place "usual" when the reply doesn\'t say which. A usual routine is never a move by itself: no location for someone the reply doesn\'t describe leaving or arriving.', vars: [] }),
  taskText("read", "extract", "Reading the reply", "usual", { label: "The usual routines", note: "Gives the usual routines, below the state.", text: "Usual routines (where a described move goes; never a move by itself):\n{{lines}}", vars: [{ name: "lines", text: "each one's usual routine, one to a line", required: true }] }),
  taskText("read", "extract", "Reading the reply", "message", { label: "The player's message", note: "Gives the player's message the reply answers: context for what the reply means, never a change of its own.", text: "The player's message this reply answers (context only; propose only what the narration states happened):\n{{text}}", vars: [{ name: "text", text: "the player's message", required: true }] }),
  taskText("read", "extract", "Reading the reply", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the proposals.", text: 'Output JSON only: {"proposals":[{"type":...}, ...]}.', vars: [] }),
];

// ---------------------------------------------------------------- world

const WORLD_PROMPTS: readonly PromptDef[] = [
  ...roleTexts(
    "world",
    "You are the world-steps agent of LumiRPEngine, the engine that keeps the roleplay world {{world}}; {{pov}} is the player character. Each task is one of the world's own steps, written by its author: you work it as its text says, and answer in the engine's form. Your tools show you {{knowledge}}.",
    howToWork("world-steps agent"),
  ),
  taskText("world", "effects", "A world's effects step", "task", { label: "What to do", note: "A world's effects step after the reply: its author's text, then what the turn gives it.", text: `{{template}}\n\n${PROSE_DATA}\n\nThe narrator's reply:\n{{reply}}`, vars: [...PROSE_VARS, { name: "template", text: "the world's step, as its author wrote it, its placeholders filled", required: true }] }),
  taskText("world", "effects", "A world's effects step", "answer", { label: "Its answer", note: "Describes the answer the engine reads (a fixed output contract): the proposals, checked and bounded as the reply's read is.", text: 'Propose only concrete state changes the facts or the reply establish. Types: time_advance{minutes} · location{entity,place} · purchase{item,category,payer?,qty?,price?} · transfer{from,to,amount} · give{item,from,to} · quantity{entity,item,delta} · condition{who,condition,minutes?,clear?} · regard{from,to,axis,delta} · knows{who,fact} · spawn{kind,name,place?,role?}. Use world ids. Output JSON only: {"proposals": [{"type": ...}]}. Money amounts are plain amounts in {{currency}} as written (8 for {{symbol}}8).', vars: [{ name: "currency", text: "the world's money, as its code" }, { name: "symbol", text: "the world's money sign" }] }),
];

/** Every role's page, in §5's order, after the shared one. */
export const ROLE_PROMPT_PAGES: readonly PromptPage[] = [
  ROLES_PAGE,
  page("intent", "The intent role (before the plan): it reads the player's message into the actions it takes, judges a described approach, and checks a puzzle's answer."),
  page("scene", "The scene role (before the plan): the lore and notes the narrator should have for the turn's scene."),
  page("minds", "The minds role (before the plan): each character's private mind at the turn's moment."),
  page("knowledge", "The knowledge role (after the reply, and before the plan when a decision turns on it): who learned, inferred, doubted or forgot what."),
  page("director", "The director role: the odds of each person's choices before the plan and off-screen after the reply, the brief and outline before the reply, and suggested next moves after it."),
  page("read", "The read role (after the reply): the changes the reply states."),
  page("memory", "The memory role (after the reply, or before the next turn): each character's memory of the turn, and their older notes folded into their summary."),
  page("skip", "The time-skip role (on a skip): the moments worth stopping for, and how the people the engine lives a day for spend it."),
  page("world", "The world-steps role: a world's own steps, as their author wrote them."),
];

/** Every role's texts, the shared page's first. */
export const ROLE_PROMPTS: readonly PromptDef[] = [...SHARED_PROMPTS, ...INTENT_PROMPTS, ...SCENE_PROMPTS, ...MINDS_PROMPTS, ...KNOWLEDGE_PROMPTS, ...DIRECTOR_PROMPTS, ...READ_PROMPTS, ...MEMORY_PROMPTS, ...SKIP_PROMPTS, ...WORLD_PROMPTS];
