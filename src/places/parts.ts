// The parts of a place's record (plan §8.2): the nine, and the three of them that are written as facts of the place, each fact keeping
// the part it belongs to and, when its writer names one, the beat of the story that caused it.

/** The nine parts of a place's record, in the plan's order. */
export const PLACE_PARTS = ["sources", "base", "since", "features", "here", "ways", "access", "history", "known"] as const;
export type PlacePart = (typeof PLACE_PARTS)[number];

/** The part a fact about a place says it belongs to (`fact`'s `part`): what the story changed, a feature, access and state. */
export const PLACE_FACT_PARTS = ["since", "feature", "access"] as const;
export type PlaceFactPart = (typeof PLACE_FACT_PARTS)[number];

export function isPlaceFactPart(part: string): part is PlaceFactPart {
  return (PLACE_FACT_PARTS as readonly string[]).includes(part);
}
