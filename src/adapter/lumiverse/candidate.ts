// A candidate lore entry as RPE is told of it (STANDALONE-PLAN §9.6): its id and its text key always; its text, its title and RPE's fields only where it
// carries secret marks or RPE's fields. The extension tells it so at the question, and RPE tells itself so on receipt, from the books' own entries: one
// rule in one home, so the verdict RPE works out on receipt is asked of the same entries the question would have carried.

import { textOf } from "../../secrecy/lore-secrets";
import { isRecord } from "../../shared/json";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import type { WorldInfoCandidate } from "../../shared/host";
import { hasSecretMarks, unreadableMarks } from "../../shared/secret-marks";
import type { QuestionEntry } from "./wire";

export function questionEntryOf(e: WorldInfoCandidate): QuestionEntry {
  const own = e.extensions[LEDGER_NAMESPACE];
  const telling = hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0 || isRecord(own);
  return {
    id: e.id,
    book: e.bookId,
    disabled: e.disabled,
    key: textOf(e.content),
    ...(telling ? { content: e.content, comment: e.comment, ...(isRecord(own) ? { extensions: { [LEDGER_NAMESPACE]: own } } : {}) } : {}),
  };
}
