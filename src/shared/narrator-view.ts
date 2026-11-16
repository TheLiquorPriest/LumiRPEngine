// The narrator's view of what the scene knows and of secrets (DESIGN §6.11; kept by §15.2 l.1620): the
// user's default, a world's and a chat's own choice all take this shape. Moved unchanged out of the
// previous extension's settings registry (PlanSwap-13), which takes it back from here until it goes.

import { isRecord } from "./json";

/** Whose knowledge the narrator gets (DESIGN §6.11): everyone's in the scene, or the player character's alone. */
export type NarratorKnowledge = "scene" | "pov";
export const NARRATOR_KNOWLEDGE: readonly NarratorKnowledge[] = ["scene", "pov"];

/** What the narrator gets of a secret: the secret, marked as one, or none of it. */
export type NarratorSecrets = "marked" | "omit";
export const NARRATOR_SECRETS: readonly NarratorSecrets[] = ["marked", "omit"];

/**
 * The narrator's knowledge (DESIGN §6.11). The user's default (Settings → Narrator), a world's
 * default (`WorldDoc.narrator`) and a chat's own choice (`backend/chat-knowledge-prefs.ts`) all
 * take this shape; the chat's wins, then the world's.
 */
export interface NarratorView {
  knowledge: NarratorKnowledge;
  secrets: NarratorSecrets;
}

/** The ruling's default (OPEN-DECISIONS core 3): what everyone in the scene knows, secrets included and marked. */
export const NARRATOR_DEFAULTS: Readonly<NarratorView> = Object.freeze({ knowledge: "scene", secrets: "marked" });

/** A narrator view read from outside data (a settings file, a world document, a chat's metadata): null unless both parts are ones it takes. */
export function narratorViewOf(raw: unknown): NarratorView | null {
  if (!isRecord(raw)) return null;
  const knowledge = NARRATOR_KNOWLEDGE.find((k) => k === raw.knowledge);
  const secrets = NARRATOR_SECRETS.find((s) => s === raw.secrets);
  return knowledge && secrets ? { knowledge, secrets } : null;
}
