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
  "npc.choose": { phase: "before the reply", vars: [], note: "Sent as written." },
  judge: { phase: "before the reply", vars: [], note: "Sent as written." },
  "puzzle.answer": { phase: "before the reply", vars: [], note: "Sent as written." },
  brief: { phase: "before the reply", vars: PROSE_VARS },
  outline: { phase: "before the reply", vars: [...PROSE_VARS, "sections"] },
  extract: { phase: "after the reply", vars: [...PROSE_VARS, "usual"] },
  choices: { phase: "after the reply", vars: [...PROSE_VARS, "usual"] },
  contradiction: { phase: "after the reply", vars: [], note: "A decision template is sent as written; an effects template gets extract's." },
  mind: { phase: "with the minds", vars: MIND_VARS },
  memory: { phase: "with the minds", vars: MIND_VARS },
  consolidate: { phase: "with the minds", vars: MIND_VARS },
  skip: { phase: "as a time skip starts", vars: MIND_VARS, note: "The beats think for no one: character is empty." },
  skip_plan: { phase: "as a time skip starts", vars: ["world", "pov", "place", "clock"] },
};

/** The prose steps' built-in instructions, which a world template or the user's own prompt replaces; their answer format stays. */
export const PROSE_PROMPTS: Record<"brief" | "outline" | "choices", string> = {
  brief: "You brief a roleplay narrator before their next reply. In two or three sentences, say what matters right now in {{world}}: where {{pov}} is, who is present, what the player just did and how it turned out, and anything pressing. Use only the facts given; invent nothing.",
  outline: "You outline a roleplay narrator's next reply. Expand the engine's beats into two to four short beats, in order, consistent with the facts and the outcome. Don't decide anything the facts don't settle, and don't add events.",
  choices: "Suggest three short, distinct things {{pov}} could do next, given the narrator's reply and the facts. Each under twelve words, first person, as the player would type it.",
};

/** What a step's own prompt (the user's, else the world's template) does to its built-in one, as Settings says it. */
export const PROMPT_EFFECT: Record<StepPurpose, string> = {
  interpret: "Added before the built-in instructions, which it can't change; on a Decision connection it is the question asked.",
  extract: "Added before the built-in instructions and rules, which it can't change.",
  brief: "Replaces the built-in instructions; the answer format stays.",
  outline: "Replaces the built-in instructions; the answer format stays.",
  choices: "Replaces the built-in instructions; the answer format stays.",
  "npc.choose": "Replaces the question it is asked; the choices stay the engine's.",
  contradiction: "Replaces the question it is asked; the facts it checks stay the engine's.",
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
export const PURPOSE_PLACEHOLDERS: Partial<Record<StepPurpose, readonly string[]>> = { extract: ["usual"], contradiction: ["usual"], choices: ["usual"], outline: ["sections"] };

/**
 * The outputs a world template may declare per purpose. `text` on a decision purpose is its
 * question's instructions; `effects` runs in the post phase only, so only post purposes take it.
 */
export const STEP_OUTPUTS: Record<StepPurpose, readonly StepTemplateDef["output"][]> = {
  interpret: ["decision", "text"],
  "npc.choose": ["decision", "text"],
  contradiction: ["decision", "text", "effects"],
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
