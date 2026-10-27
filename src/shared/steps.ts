// The model-step vocabulary shared by the backend (which runs steps) and world lint (which checks
// world step templates): signals, template placeholders, and which outputs each purpose uses
// (DESIGN §5.2).

import type { StepPurpose, StepTemplateDef } from "./world";

/** The signals a step can fire on; `every_n:<k>` is also accepted. */
export const STEP_SIGNALS = [
  "typed_input",
  "reply",
  "scene_change",
  "slot_crossed",
  "day_start",
  "beat",
  "agents_present",
  "present",
  "offscreen",
  "tie_zone",
  "invitation",
  "timelapse",
  "conflict",
  "always",
  "never",
] as const;

export type StepSignal = (typeof STEP_SIGNALS)[number];

/**
 * Signals earlier builds had, each with the one that stands for it now. `classifier` fired when a
 * word list thought typed text looked like an action; whether it is one is `interpret`'s call, so
 * it reads as `typed_input` (DESIGN §5.2).
 */
const RETIRED_SIGNALS: ReadonlyMap<string, StepSignal> = new Map<string, StepSignal>([["classifier", "typed_input"]]);

/** Whether a signal name is known. */
export function knownSignal(s: string): boolean {
  return (STEP_SIGNALS as readonly string[]).includes(s) || /^every_n:[1-9]\d*$/.test(s);
}

/** Signals as this build reads them: each retired one becomes the one that stands for it, listed once. */
export function currentSignals(signals: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of signals) {
    const now = RETIRED_SIGNALS.get(s) ?? s;
    if (!out.includes(now)) out.push(now);
  }
  return out;
}

/** Whether any of `signals` is a retired one (`currentSignals` changes them). */
export function hasRetiredSignal(signals: readonly string[]): boolean {
  return signals.some((s) => RETIRED_SIGNALS.has(s));
}

/** Each step by the name Settings and Build give it, and what Caveats' pre-flight calls it. */
export const STEP_LABEL: Record<StepPurpose, string> = {
  interpret: "Interpret typed input",
  "npc.choose": "NPC choices",
  "puzzle.answer": "Puzzle answers",
  brief: "Scene brief",
  outline: "Prose outline",
  extract: "Extract changes",
  choices: "Suggested choices",
  judge: "Judge your approach",
  mind: "Character minds",
  memory: "Character memory",
  skip: "Time-skip beats",
  consolidate: "Memory consolidation",
};

/** What a world step template's `output` means, as Build names it, in the order Build offers them. */
export const STEP_OUTPUT_LABEL: Record<StepTemplateDef["output"], string> = {
  text: "Text: instructions for the step's call",
  effects: "Changes: effects it proposes after the reply",
  decision: "A decision: the question its call answers",
};

/**
 * The engine placeholders a step template may use (all player-visible), and `character`, the name
 * of the character a minds step thinks for (DESIGN §24.5), empty in every other step.
 */
export const STEP_PLACEHOLDERS = ["world", "pov", "place", "clock", "scene", "present", "facts", "outcome", "beats", "brief", "user", "reply", "recent", "gear", "money", "property", "positions", "knowledge", "character"] as const;

/** What each placeholder holds, as the vars panel beside every template editor says it. Every one is player-visible: a line that would give away an unrevealed truth is dropped. */
export const VAR_TEXT: Record<string, string> = {
  world: "the world's name",
  pov: "the player character's name",
  place: "where the player character is",
  clock: "the day and time",
  scene: "the first lines of the facts",
  facts: "the facts the narrator gets (up to 40 lines)",
  present: "who is with the player character",
  outcome: "what the turn's action came to",
  beats: "the engine's outline of the turn",
  brief: "this turn's brief (empty in the brief itself)",
  user: "the player's message",
  reply: "the reply (empty before it is written)",
  recent: "the Journal's last five lines",
  gear: "what the player character carries and wears",
  money: "the player character's money",
  property: "what the player character owns or may use",
  positions: "who is here with the player character, and what they're doing",
  knowledge: "what the player character knows of the quests",
  usual: "the usual routines of the people with the player character",
  sections: "the sections the narrator has this turn",
  character: "the character the step thinks for",
};

/** The prose steps' placeholders. */
const PROSE_VARS = ["world", "pov", "place", "clock", "scene", "present", "facts", "outcome", "beats", "brief", "user", "reply", "recent", "gear", "money", "property", "positions", "knowledge"] as const;

/** The placeholders a minds step's prompt is given. */
const MIND_VARS = ["character", "world", "pov", "place", "clock"] as const;

/**
 * Which placeholders each step's prompt is filled with, and when it runs, as the vars panel shows it
 * (DESIGN §5.2): the steps before the reply, the steps reading it, the minds steps and the skip plan.
 * A step with none sends its prompt as written. A world's `effects` template gets the reply-reading
 * steps' set whatever its purpose.
 */
export const STEP_VARS: Record<StepPurpose | "skip_plan", { phase: "before the reply" | "after the reply" | "with the minds" | "as a time skip starts"; vars: readonly string[]; note?: string }> = {
  interpret: { phase: "before the reply", vars: ["world", "pov"], note: "None on a Decision connection." },
  "npc.choose": { phase: "before the reply", vars: [] },
  judge: { phase: "before the reply", vars: [] },
  "puzzle.answer": { phase: "before the reply", vars: [] },
  brief: { phase: "before the reply", vars: PROSE_VARS },
  outline: { phase: "before the reply", vars: [...PROSE_VARS, "sections"] },
  extract: { phase: "after the reply", vars: [...PROSE_VARS, "usual"] },
  choices: { phase: "after the reply", vars: [...PROSE_VARS, "usual"] },
  mind: { phase: "with the minds", vars: MIND_VARS },
  memory: { phase: "with the minds", vars: MIND_VARS },
  consolidate: { phase: "with the minds", vars: MIND_VARS },
  skip: { phase: "as a time skip starts", vars: MIND_VARS, note: "The beats think for no one: character is empty." },
  skip_plan: { phase: "as a time skip starts", vars: ["world", "pov", "place", "clock"] },
};

/**
 * The prose steps' built-in instructions, which a world template or the user's own prompt replaces;
 * their answer format stays. The brief and the outline reach the narrator, which must be able to
 * write the reply from them without inferring anything: each asks for every detail the reply needs,
 * from the facts given only (the facts hold nothing the player character doesn't know).
 */
export const PROSE_PROMPTS: Record<"brief" | "outline" | "choices", string> = {
  brief: [
    "You brief a roleplay narrator before their next reply in {{world}}, so they can write it without guessing at anything. From the facts given only, in one paragraph, say:",
    "where and when the scene is (the place, the time of day) and what it is like now; who is present and what each of them is doing; what the player just did and exactly how it turned out, with the results, rolls and amounts as the Outcome gives them; anything that changed hands, moved or was spent, and between whom; how much time passes; and what is pressing or about to happen.",
    "Name people and places as the facts do. State only what the facts establish: invent nothing, decide nothing they leave open, and never say what {{pov}} doesn't know.",
  ].join("\n"),
  outline: [
    "You outline a roleplay narrator's next reply in {{world}}, beat by beat, so the narrator can write it without inferring anything. Expand the engine's beats into a complete outline, in order, consistent with the facts and the Outcome. Account for everything the reply must cover:",
    "- every beat, in the order it happens;",
    "- who does and says what, in substance (no dialogue lines);",
    "- what is decided and why, as the Outcome states it;",
    "- every result with its numbers: rolls, amounts, prices;",
    "- each item that changes hands, from whom to whom;",
    "- each place reached and each move, by name;",
    "- how much time passes;",
    "- what each person knows or doesn't. Where the facts leave something unknown to {{pov}}, or someone keeps a thing to themselves, add a beat saying it stays unsaid.",
    "Write each beat as one full sentence that names its people and places (never a bare \"he\" or \"there\"). Decide nothing the facts don't settle and add no events of your own; point only at the sections the narrator has this turn.",
  ].join("\n"),
  choices:
    "Suggest three short, distinct things {{pov}} could do next, given the narrator's reply and the facts: each something the scene as written makes possible right now, with the people present and the things {{pov}} has. Each under twelve words, first person, as the player would type it, naming who or what it involves.",
};

/** The decision steps' built-in questions, which a world template or the user's own prompt replaces; the choices or the scale stay the engine's. */
export const DECISION_PROMPTS: Record<"npc.choose" | "puzzle.answer" | "judge", string> = {
  "npc.choose": "What does this character choose to do, given their needs, plans and relationships? Pick what they would most plausibly do.",
  "puzzle.answer": "Is the player's answer correct: the same as one of the accepted answers, allowing for wording and spelling?",
  judge: "Judge how well the player's described approach suits what their character attempts.",
};

/**
 * What the built-in instructions hold for the steps a prompt is added before, as Settings shows them.
 * They are made fresh each turn from the scene and the world, so the parts are named, not quoted.
 */
export const ADDED_BEFORE: Record<"interpret" | "extract", string> = {
  interpret: [
    "The task: map the player's typed input to the engine actions it takes, in order.",
    "The world and the player character.",
    "The scene, the places nearby and the recent messages.",
    "The action catalog: every action your character can take here, with its details.",
    "The rules for reading it: ids and amounts, several actions in one message, time passing after them, routine changes.",
    "The answer format.",
  ].join("\n"),
  extract: [
    "The task: propose the changes the reply's prose says actually happened.",
    "The world, and the change types switched on.",
    "The rules: nothing considered, refused or hypothetical; world ids; amounts as written; the strict rule for each change type.",
    "Where the reply leaves your character, and the usual routines of the people with them.",
    "The answer format.",
  ].join("\n"),
};

/** What a step's own prompt (the user's, else the world's template) does to its built-in one, as Settings says it. */
export const PROMPT_EFFECT: Record<StepPurpose, string> = {
  interpret: "Added before the built-in instructions, which it can't change; on a Decision connection it is the question asked.",
  extract: "Added before the built-in instructions and rules, which it can't change.",
  brief: "Replaces the built-in instructions; the answer format stays.",
  outline: "Replaces the built-in instructions; the answer format stays.",
  choices: "Replaces the built-in instructions; the answer format stays.",
  "npc.choose": "Replaces the question it is asked; the choices stay the engine's.",
  "puzzle.answer": "Replaces the question it is asked.",
  judge: "Replaces the question it is asked; the rating scale stays.",
  mind: "Replaces the built-in instructions; the answer format stays.",
  memory: "Replaces the built-in instructions; the answer format stays.",
  skip: "Replaces the built-in instructions; the answer format stays.",
  consolidate: "Replaces the built-in instructions; the answer format stays.",
};

/**
 * Placeholders only the steps that are given them may use: `usual`, the usual routines of the people
 * with the player character, in the steps that read the reply (`extract`, and the `effects` and
 * `choices` templates); `sections`, the sections the narrator has this turn, in the outline.
 */
export const PURPOSE_PLACEHOLDERS: Partial<Record<StepPurpose, readonly string[]>> = { extract: ["usual"], choices: ["usual"], outline: ["sections"] };

/**
 * The outputs a world template may declare per purpose. `text` on a decision purpose is its
 * question's instructions; `effects` runs in the post phase only, so only post purposes take it.
 */
export const STEP_OUTPUTS: Record<StepPurpose, readonly StepTemplateDef["output"][]> = {
  interpret: ["decision", "text"],
  "npc.choose": ["decision", "text"],
  "puzzle.answer": ["decision", "text"],
  brief: ["text"],
  outline: ["text"],
  extract: ["text", "effects"],
  choices: ["text", "effects"],
  // A decision only: the rating, its reason and (under narrative authority) the outcome's odds.
  judge: ["decision", "text"],
  // A minds step's template is its instructions; its answer is the step's own JSON (DESIGN §24.5).
  mind: ["text"],
  memory: ["text"],
  skip: ["text"],
  consolidate: ["text"],
};
