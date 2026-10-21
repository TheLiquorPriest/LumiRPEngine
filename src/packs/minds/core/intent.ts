// The GM's intent for a character (DESIGN §24.9): what they mean to do now, in the GM's own words, and
// whether they answer the scene or pursue their own aims. Only their own mind reads it (DESIGN §24.5),
// first after who they are, so it works from it and the story follows what that mind intends; no
// other mind, no narrator's section and no player surface is given it.

import type { EntityId } from "../../../shared/ids";
import type { MindApproach, MindIntent } from "../../../shared/minds";
import type { WorldState } from "../../../engine/state";
import { readCharacter } from "./state";

/** How each approach reads to the mind it steers. */
const APPROACH_LINE: Record<MindApproach, string> = {
  reactive: "You let others lead: you answer what happens and what is asked of you, and start nothing of your own.",
  proactive: "You act on your own aims: you pursue them unprompted, and don't wait for anyone to give you a reason.",
};

/** The intent the GM set for `who` in this chat, or null. */
export function intentOf(state: Readonly<WorldState>, who: EntityId): MindIntent | null {
  return readCharacter(state, who).intent ?? null;
}

/** The intent as the lines of their own mind's context: their aim in the GM's words, then how they go about it; none without one. */
export function intentLines(intent: MindIntent | null): string[] {
  if (!intent) return [];
  const out: string[] = [];
  if (intent.text !== "") out.push(intent.text, "Hold to this: let it shape how you read the moment and what you intend.");
  if (intent.approach) out.push(APPROACH_LINE[intent.approach]);
  return out;
}
