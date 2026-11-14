// What the extension answers by itself when RPE gives no answer in time (STANDALONE-PLAN §4.2, §9.6):
// today's fail-closed verdict, worked out from the candidate entries alone, together with what RPE
// said to keep out of the chat's prompt the last time it did answer. The first holds every marked
// passage, whole-entry secret, older build's secret and copy of a mark out; the second holds out what
// only RPE knows is secret (a book entry a world's secret was indexed from carries no mark). That
// memory is the extension's only one: per chat, in memory, lost when its worker restarts.

import type { WorldInfoCandidate, WorldInfoVerdict } from "../backend/host";
import { bookSecrecy, secretTexts, textOf } from "../backend/lore-secrets";
import type { SecrecyVerdict } from "../adapter/lumiverse/wire";
import { engineWroteEntry, loreIsSecret } from "../shared/lore";
import { hasSecretMarks, publicText, unreadableMarks, wholeEntrySecret } from "../shared/secret-marks";

// Carried over unchanged from `backend/wi-interceptor.ts:52-72`, where it is private: the same rules,
// so the verdict with no answer is today's.

/** The entries of the user's books among a prompt's: the engine's own sections are no secret's. */
function usersOwn(entries: readonly WorldInfoCandidate[]): WorldInfoCandidate[] {
  return entries.filter((e) => !engineWroteEntry(e.extensions));
}

/**
 * What is known without the chat's state (it can't be read, or the interceptor threw): every
 * earlier-build secret and whole-entry secret off, every other entry's marks out, read or not, and a
 * mark's twin off, for this prompt.
 */
function blind(entries: readonly WorldInfoCandidate[]): WorldInfoVerdict {
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

/** What RPE last said to keep out of each chat's prompt: the entries it switched off. */
export class KeptOut {
  private readonly byChat = new Map<string, ReadonlySet<string>>();

  /** `most`: how many chats are remembered; past it the one answered longest ago is forgotten. */
  constructor(private readonly most: number) {}

  /** RPE answered for the chat: its answer replaces what was remembered. */
  heard(user: string, chat: string, verdict: SecrecyVerdict): void {
    const key = `${user}\u0000${chat}`;
    this.byChat.delete(key);
    this.byChat.set(key, new Set(verdict.disabled));
    for (const oldest of this.byChat.keys()) {
      if (this.byChat.size <= this.most) break;
      this.byChat.delete(oldest);
    }
  }

  of(user: string, chat: string): ReadonlySet<string> {
    return this.byChat.get(`${user}\u0000${chat}`) ?? new Set();
  }
}

/** The verdict with no answer from RPE: today's fail-closed one, and every candidate RPE last kept out of this chat's prompt off too. */
export function failClosed(entries: readonly WorldInfoCandidate[], keptOut: ReadonlySet<string>): Required<WorldInfoVerdict> {
  const verdict = blind(usersOwn(entries));
  const out: Required<WorldInfoVerdict> = { disabled: [...verdict.disabled], enabled: [...verdict.enabled], mutated: [...(verdict.mutated ?? [])] };
  for (const e of entries) if (keptOut.has(e.id) && !out.disabled.includes(e.id)) out.disabled.push(e.id);
  return out;
}
