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
export const STEP_PLACEHOLDERS = ["world", "pov", "place", "clock", "scene", "present", "facts", "outcome", "beats", "brief", "user", "reply", "recent", "character"] as const;

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
