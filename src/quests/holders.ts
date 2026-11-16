// Who holds a quest's secret (plan §8.3, §9.6): the characters whose knowledge names the quest, or one of its stages, by ref (a statement
// of what a character now knows, from `perceive` or `cast_update`, keeps the refs of what it is about). The quest's record shows them;
// what the player sees changes only by the Author's visibility write. Code reads the refs; it judges nothing of what is known.

import type { CastItem } from "../cast/record";
import { questRef } from "./read";

/** A character that holds something of a quest: who, and the knowledge, with the stage it names where it names one. */
export interface QuestHolder {
  character: string;
  name: string;
  /** The statement, as the character holds it: its words, or the secret's id. */
  text: string;
  /** The stage it is about; null for the quest as a whole. */
  stage: string | null;
}

/**
 * The knowledge of `items` that names the quest or one of its stages by ref, with who holds it. `nameOf` gives a character's name by
 * its id (the cast's); one it does not know is shown by its id.
 */
export function holdersOf(items: Iterable<CastItem>, nameOf: (character: string) => string | undefined, quest: string): QuestHolder[] {
  const ref = questRef(quest);
  const out: QuestHolder[] = [];
  for (const item of items) {
    if (item.part !== "knowledge" || item.dropped) continue;
    const about = item.fields.about_refs;
    if (!Array.isArray(about)) continue;
    for (const r of about) {
      if (typeof r !== "string" || (r !== ref && !r.startsWith(`${ref}/`))) continue;
      const said = item.fields.text ?? item.fields.secret;
      out.push({ character: item.character, name: nameOf(item.character) ?? item.character, text: typeof said === "string" ? said : "", stage: r === ref ? null : r.slice(ref.length + 1) });
    }
  }
  return out;
}
