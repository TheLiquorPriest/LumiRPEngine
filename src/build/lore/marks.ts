// A change to the secret marks of one World Info entry's text (plan §9; PlanChatUI-B3), Build's Make secret: what the request carries as a
// `LoreMarkChange`, and the entry's text with that change made (`markedContent`), nothing else of the text changed. The write itself is the
// service's, through the one recorded writer with a revision check.

import { isRecord, type JsonObject } from "../../shared/json";
import { bookLoreFieldsOf, loreIsSecret, secretCopyOf } from "../../shared/lore";
import type { LoreMarkChange } from "../../shared/lore-views";
import { parseSecretMarks, SecretMarkError, type SecretMark, type SecretMarkInput, unreadableMarks, writeSecretMark } from "../../shared/secret-marks";

/** Why Build can't change a book entry's marks as asked (`markedContent`), in words for the user. */
export class MarkChangeError extends Error {}

/** A change to an entry's marks as a request gives it (`lre.lore mark`), or null when it isn't one; names absent read as none, and "kept from" absent as everyone. */
export function markChangeOf(raw: unknown): LoreMarkChange | null {
  if (!isRecord(raw)) return null;
  const names = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x): x is string => typeof x === "string") ? [...v] : null);
  const knownTo = raw.knownTo === undefined ? [] : names(raw.knownTo);
  const keptFrom = raw.keptFrom === undefined || raw.keptFrom === "everyone" ? "everyone" : names(raw.keptFrom);
  const mark = typeof raw.mark === "number" && Number.isInteger(raw.mark) && raw.mark >= 0 ? raw.mark : null;
  if (raw.kind === "public") return mark === null ? null : { kind: "public", mark };
  if (knownTo === null || keptFrom === null) return null;
  if (raw.kind === "secret") return { kind: "secret", knownTo, keptFrom };
  if (raw.kind === "add") return typeof raw.text === "string" ? { kind: "add", text: raw.text, knownTo, keptFrom } : null;
  if (raw.kind === "names") return mark === null ? null : { kind: "names", mark, knownTo, keptFrom };
  return null;
}

/**
 * An entry's text with `change` made to its secret marks: nothing else of the text changes. An entry an earlier build keeps secret by its
 * fields is refused: its secrecy moves to marks with the rest of its book's, where it is kept for a restore. Throws `MarkChangeError`
 * with why it can't be made.
 */
export function markedContent(e: { content: string; extensions: JsonObject }, change: LoreMarkChange): string {
  const marks = parseSecretMarks(e.content);
  const old = bookLoreFieldsOf(e.extensions);
  if (marks.length === 0 && ((old !== null && loreIsSecret(old)) || secretCopyOf(e.extensions) !== null)) throw new MarkChangeError("an earlier build keeps this entry secret by its own fields: move its book's secrecy to marks first (Build → Lore), which keeps the entry as it stood for a restore");
  const written = (input: SecretMarkInput): string => {
    try {
      return writeSecretMark(input);
    } catch (error) {
      if (error instanceof SecretMarkError) throw new MarkChangeError(error.message);
      throw error;
    }
  };
  const at = (n: number): SecretMark => {
    const mark = marks[n];
    if (!Number.isInteger(n) || !mark) throw new MarkChangeError("that entry has no such secret mark");
    return mark;
  };
  switch (change.kind) {
    case "secret":
      if (marks.length > 0 || unreadableMarks(e.content).length > 0) throw new MarkChangeError("this entry already holds secret marks: change those, or make them public first");
      return written({ text: e.content, knownTo: change.knownTo, keptFrom: change.keptFrom });
    case "add": {
      const line = written({ text: change.text, knownTo: change.knownTo, keptFrom: change.keptFrom });
      return e.content === "" || e.content.endsWith("\n") ? `${e.content}${line}` : `${e.content}\n${line}`;
    }
    case "names":
    case "public": {
      const mark = at(change.mark);
      const text = change.kind === "public" ? mark.text : written({ text: mark.text, knownTo: change.knownTo, keptFrom: change.keptFrom });
      return `${e.content.slice(0, mark.start)}${text}${e.content.slice(mark.end)}`;
    }
  }
}
