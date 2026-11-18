// The kinds an entry of a chat's lore may be given (plan §9.1): a short fixed list, which the Lore page offers in its choice and the
// lore index's route holds an edit to.

export const LORE_KINDS = ["character", "place", "item", "faction", "rule", "event", "concept", "style"] as const;
export type LoreKind = (typeof LORE_KINDS)[number];

/** The kind that `text` names, as written or in other letters or with spaces round it; null where it names none of the list. */
export function loreKindOf(text: string): LoreKind | null {
  const key = text.trim().toLowerCase();
  return LORE_KINDS.find((kind) => kind === key) ?? null;
}

/** The list in words: `character, place, … or style`. */
export function loreKindsWords(): string {
  return `${LORE_KINDS.slice(0, -1).join(", ")} or ${LORE_KINDS[LORE_KINDS.length - 1]}`;
}
