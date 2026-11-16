// A book entry as the Author and the GM read it (plan §9.6; App. A `LoreSecret`): every passage, each secret mark in place worded as a
// secret with the id a perception names and who holds it, never as the raw mark; and the list of the entry's secrets with each id and its
// holders. A mark has the entry's id and its place among the entry's marks from 1 (`e-112#2`); an entry that is one secret has the entry's
// own id. The wording is a line of `.prompts/lore-answers.md` (`secret_mark`); with no such line a mark is left out, as it is from any
// reader's text, which fails closed.

import type { LinesPart } from "../../app/guidance";
import type { LoreSecret } from "rp-harness/contract";
import { bookLoreId } from "../../secrecy/book-lore";
import { bookLoreFieldsOf, loreIsSecret } from "../../shared/lore";
import { hasSecretMarks, renderSecretMarks, unreadableMarks, wholeEntrySecret } from "../../shared/secret-marks";
import type { LoreBookEntry } from "../sources";
import type { HoldersAt } from "./holders";

/** The line of `lore-answers.md` that words a secret in an entry's text: its text, its id and who holds it. */
export const SECRET_MARK_LINE = "secret_mark";

/** A secret as it is worded in an entry's text. */
export interface ShownSecret {
  text: string;
  id: string;
  holders: readonly string[];
}

/** How a secret is worded in an entry's text: by the part's line, or not at all (the empty text) where the part has none. */
export type SecretWords = (secret: ShownSecret) => string;

export function secretWords(lines: LinesPart | undefined): SecretWords {
  return ({ text, id, holders }) => lines?.line(SECRET_MARK_LINE, { text, id, holders: holders.join(", ") }) ?? "";
}

/** A book entry's text with each secret worded as one, and the secrets it holds. `id` is the entry's RPE id; `holders` is none for a chat with no world. */
export function bookRead(row: LoreBookEntry, id: string, holders: HoldersAt | null, word: SecretWords): { text: string; secrets: LoreSecret[] } {
  const secrets: LoreSecret[] = [];
  if (hasSecretMarks(row.content) || unreadableMarks(row.content).length > 0) {
    const whole = wholeEntrySecret(row.content);
    const text = renderSecretMarks(row.content, (mark, n) => {
      const alone = whole !== null && whole.start === mark.start;
      const shown = alone ? id : `${id}#${n}`;
      const heldBy = holders === null ? [...mark.knownTo] : holders.ofMark(mark, row.book, row.id, alone ? null : n);
      secrets.push({ id: shown, heldBy });
      return word({ text: mark.text, id: shown, holders: heldBy });
    });
    return { text, secrets };
  }
  // An earlier build's secrecy fields on an entry with no mark: the entry is the secret, held by those they name and those who hold it in play.
  const fields = bookLoreFieldsOf(row.extensions);
  if (fields !== null && loreIsSecret(fields)) {
    const named = (fields.holders ?? []).map((who) => holders?.name(who) ?? who);
    secrets.push({ id, heldBy: [...new Set([...named, ...(holders?.holding(bookLoreId(row.book, row.id)) ?? [])])] });
  }
  return { text: row.content, secrets };
}
