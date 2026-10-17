// World lore helpers (DESIGN §4.2) shared by the lint, the backend and Build: an entry's source,
// the helpers a secret entry may reach, and the hash a book-sourced entry keeps of the World Info
// text it was indexed from. Pure.

import { hashParts } from "./hash";
import { STEP_OUTPUTS } from "./steps";
import type { LoreEntryDef, LoreSource, StepPurpose } from "./world";

/** Every helper a secret entry's audience may name, in Settings' order. */
export const LORE_AUDIENCE = Object.keys(STEP_OUTPUTS) as StepPurpose[];

/** Steps that write prose: what they read can reach the narrator, so a secret entry naming one is linted. */
export const PROSE_STEPS: readonly StepPurpose[] = ["brief", "outline", "choices"];

/** An entry's source: one written before sources existed was authored. */
export function loreSource(entry: Pick<LoreEntryDef, "source">): LoreSource {
  return entry.source ?? { kind: "authored" };
}

/** The hash a book-sourced entry keeps of its World Info entry's text; another hash now means the book changed. */
export function bookTextHash(content: string): string {
  return hashParts("lre-lore-book-v1", content);
}
