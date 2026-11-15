// The shapes of a typed decision ("System 1" questions): a question asks for a choice, a score or a
// noul, and its answer gives probabilities. They are data both the host's shapes (`./host`) and the
// engine's rule for picking from them (`src/engine/decide.ts`) carry, so they live here.
//
// Adapted from Warp's engine/decide.ts (see NOTICE). The question and answer shapes mirror the
// Decision API's choice / score / noul primitives so any provider can fill them in.

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type Answer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number };

export type Questions = Record<string, Question>;
export type Answers = Record<string, Answer>;
