// The kinds the shipped indexer's file lists for an entry of a chat's lore (plan §9.1). They are suggestions, offered first in the Lore
// page's choice of a kind: a kind is any one line of text, and nothing holds an entry to these.

export const SUGGESTED_LORE_KINDS = ["character", "place", "item", "faction", "rule", "event", "concept", "style"] as const;

/** The kind that `text` names: its one line, trimmed; null where it is empty or runs over more than one line. */
export function loreKindOf(text: string): string | null {
  const kind = text.trim();
  return kind === "" || /[\r\n]/.test(kind) ? null : kind;
}
