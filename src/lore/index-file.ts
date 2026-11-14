// `LORE-INDEX.md` in a chat's folder (plan §9.1, §5.1): the readable view of the chat's lore index,
// written by code from the table whenever the index changes, never by an agent. Its words are lines of
// `.prompts/lore-answers.md`: a head, a count, and one line for each entry.

import type { LinesPart } from "rp-harness";
import type { IndexedEntry } from "./indexing";
import type { LoreAt } from "./lore";
import { entryFields, loreLine } from "./tools";

/** The file's name, at the top of the chat's folder (`GENERATED_FILES` in `src/tree/layout.ts`). */
export const LORE_INDEX_FILE = "LORE-INDEX.md";

/** Where the readable index is written, and in whose words. */
export interface LoreIndexFile {
  /** The chat's folder on disk; null while the chat has none. */
  folder(user: string, chat: string): string | null;
  /** The answers' lines in force for the chat. */
  lines(at: LoreAt): Promise<LinesPart | undefined>;
}

/** The readable index of a chat's lore, as the lines in force word it: a head, a count, then a line for each entry in the index's order. */
export function loreIndexText(lines: LinesPart | undefined, entries: readonly IndexedEntry[]): string {
  const unindexed = entries.filter((e) => !e.indexed).length;
  const head = [loreLine(lines, "index_file_head"), loreLine(lines, "index_file_count", { count: entries.length, unindexed })].filter((l): l is string => l !== undefined);
  const each = entries.flatMap((e) => loreLine(lines, "index_file_entry", entryFields(lines, e)) ?? []);
  return [...head, ...(each.length > 0 ? [each.join("\n")] : [])].join("\n\n");
}
