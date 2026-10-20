// Player claims (DESIGN §9.4): what becomes of a thing a typed action uses that the world doesn't
// have, as the POV sees it. Make it real creates it and plays the action, Ask first pauses the turn
// on a question, and Hold me to the world drops the action with its decline chip. The policy is
// layered as realism is (§9.1): the world's default, the user's setting for new chats, then the
// chat's own `claims` marker; the realism presets carry its defaults.

import { isRecord } from "./json";
import type { RealismPresetId } from "./ids";

export type ClaimMode = "real" | "ask" | "hold";

export const CLAIM_MODES: readonly ClaimMode[] = ["real", "ask", "hold"];

export const CLAIM_MODE_LABEL: Readonly<Record<ClaimMode, string>> = { real: "Make it real", ask: "Ask first", hold: "Hold me to the world" };

export interface ClaimsPolicy {
  mode: ClaimMode;
  /** Under Make it real, a thing whose catalog price is over the world's claim cap asks first instead. */
  capped: boolean;
}

/** Where a claimed thing appears for the action it serves: in the actor's hands, or where the actor is. */
export type ClaimPlace = "held" | "here";

/** What each realism preset plays claims by: Story makes everything real at any price, Grounded up to the cap, Simulation asks. */
export const CLAIM_PRESETS: Readonly<Record<Exclude<RealismPresetId, "custom">, Readonly<ClaimsPolicy>>> = {
  story: { mode: "real", capped: false },
  grounded: { mode: "real", capped: true },
  simulation: { mode: "ask", capped: true },
};

/** Story's, the default preset's: a chat older than claims, in a Custom realism and a world that sets none, plays by it. */
export const DEFAULT_CLAIMS: Readonly<ClaimsPolicy> = CLAIM_PRESETS.story;

/** A policy from outside data (a world, a settings file, a marker), or null when it isn't one; `capped` is off unless it says true. */
export function readClaims(raw: unknown): ClaimsPolicy | null {
  if (!isRecord(raw)) return null;
  const mode = CLAIM_MODES.find((m) => m === raw.mode);
  return mode ? { mode, capped: raw.capped === true } : null;
}
