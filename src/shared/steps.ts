// The model-step vocabulary shared by the backend (which runs steps) and world lint (which checks
// world step templates): signals, template placeholders, and which outputs each purpose uses
// (DESIGN §5.2).

import type { StepPurpose, StepTemplateDef } from "./world";

/** The signals a step can fire on; `every_n:<k>` is also accepted. */
export const STEP_SIGNALS = [
  "typed_input",
  "classifier",
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

/** Whether a signal name is known. */
export function knownSignal(s: string): boolean {
  return (STEP_SIGNALS as readonly string[]).includes(s) || /^every_n:[1-9]\d*$/.test(s);
}

/** The engine placeholders a step template may use (all player-visible). */
export const STEP_PLACEHOLDERS = ["world", "pov", "place", "clock", "scene", "present", "facts", "outcome", "beats", "brief", "user", "reply", "recent"] as const;

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
};
