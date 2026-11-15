// What the World Info interceptor says of a prompt's entries with nothing but the entries to go by
// (DESIGN §6.1): the verdict a prompt gets when the chat's state can't be read, the interceptor threw,
// or the extension that hands it over was given no answer in time. One rule, in one home: RPE's own
// interceptor and the light extension both run it.

import type { WorldInfoCandidate, WorldInfoVerdict } from "../shared/host";
import { engineWroteEntry, loreIsSecret } from "../shared/lore";
import { hasSecretMarks, publicText, unreadableMarks, wholeEntrySecret } from "../shared/secret-marks";
import { bookSecrecy, secretTexts, textOf } from "./lore-secrets";

/** The entries of the user's books among a prompt's: the engine's own sections are no secret's. */
export function usersOwn(entries: readonly WorldInfoCandidate[]): WorldInfoCandidate[] {
  return entries.filter((e) => !engineWroteEntry(e.extensions));
}

/**
 * What is known without the chat's state (it can't be read, or the interceptor threw): every
 * earlier-build secret and whole-entry secret off, every other entry's marks out, read or not, and a
 * mark's twin off, for this prompt.
 */
export function blind(entries: readonly WorldInfoCandidate[]): WorldInfoVerdict {
  const texts = secretTexts({ entries });
  const out: Required<WorldInfoVerdict> = { disabled: [], enabled: [], mutated: [] };
  for (const e of entries) {
    if (hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0) {
      if (wholeEntrySecret(e.content)) out.disabled.push(e.id);
      else out.mutated.push({ id: e.id, content: publicText(e.content) });
    } else if (texts.marks.has(textOf(e.content)) || loreIsSecret(bookSecrecy(e, texts) ?? {})) out.disabled.push(e.id);
  }
  return out;
}
