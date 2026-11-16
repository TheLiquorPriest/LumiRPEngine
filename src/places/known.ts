// Who knows of a place, and how well (plan §8.2 "Known to", §7.3): the characters whose knowledge names it by ref, each with how they
// came by it (the perception it was drawn from: how much reached them and who told them) and what they hold; and the people the world's
// own record says know it (a `knows` link), marked as the world's. A character's knowledge names a place or a quest by the ref its `about`
// found (`about_refs`). Code reads the refs and the perception's fields; it judges nothing of what is known.

import type { CastItem } from "../cast/record";
import type { PlaceKnown } from "./whole";

/** The cast as a place's record reads it at a point of the path: every item of every character's record, and the characters' names. */
export interface CastKnowledge {
  items: Iterable<CastItem>;
  nameOf(character: string): string | undefined;
}

/** A character's knowledge that names a ref: who, what they hold, how it reached them and, from a perception, how much of the moment did. */
export interface Knowing {
  character: string;
  name: string;
  text: string;
  /** The ref it names, whole: the place, the quest, or `quest:<id>/<stage>`. */
  ref: string;
  /** How much of the moment reached the character, as the perception it was drawn from says (whole, part, told, none); null where it stands on no perception. */
  reach: string | null;
  /** Who told them, where the perception says. */
  toldBy: string | null;
}

/** The knowledge of `cast` that names a ref `names` accepts, each with the perception it was drawn from. */
export function knowledgeNaming(cast: CastKnowledge, names: (ref: string) => boolean): Knowing[] {
  const all = [...cast.items];
  const perceptions = new Map(all.filter((i) => i.part === "perception").map((i) => [i.id, i]));
  const out: Knowing[] = [];
  for (const item of all) {
    if (item.part !== "knowledge" || item.dropped || !Array.isArray(item.fields.about_refs)) continue;
    const from = typeof item.fields.from === "string" ? perceptions.get(item.fields.from) : undefined;
    for (const ref of item.fields.about_refs) {
      if (typeof ref !== "string" || !names(ref)) continue;
      const said = item.fields.text ?? item.fields.secret;
      out.push({
        character: item.character,
        name: cast.nameOf(item.character) ?? item.character,
        text: typeof said === "string" ? said : "",
        ref,
        reach: typeof from?.fields.reach === "string" ? from.fields.reach : null,
        toldBy: typeof item.fields.told_by === "string" ? item.fields.told_by : typeof from?.fields.told_by === "string" ? from.fields.told_by : null,
      });
    }
  }
  return out;
}

/** The characters whose knowledge names the place, each once per statement, with how it reached them and how much of the moment did. */
export function knownByCast(cast: CastKnowledge, place: string): PlaceKnown[] {
  return knowledgeNaming(cast, (ref) => ref === `place:${place}`).map(
    (k): PlaceKnown => ({ who: k.character, name: k.name, by: "knowledge", how: k.toldBy === null ? "perceived" : `told by ${k.toldBy}`, reach: k.reach, precision: null, standing: null }),
  );
}
