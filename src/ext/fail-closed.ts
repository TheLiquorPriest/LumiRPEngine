// What the extension answers by itself when RPE gives no answer in time (STANDALONE-PLAN §4.2, §9.6):
// today's fail-closed verdict, worked out from the candidate entries alone, together with what RPE
// said to keep out of the chat's prompt the last time it did answer. The first holds every marked
// passage, whole-entry secret, older build's secret and copy of a mark out; the second holds out what
// only RPE knows is secret (a book entry a world's secret was indexed from carries no mark). Beside it
// is where RPE last said to cut the chat's history, which the prompt interceptor cuts at again while
// that message is still on the path. That memory is the extension's only one: per chat, in memory,
// lost when its worker restarts.

import type { WorldInfoCandidate, WorldInfoVerdict } from "../shared/host";
import type { Answer, KeepPoint } from "../adapter/lumiverse/wire";
import { blind, usersOwn } from "../secrecy/blind";

/** What RPE last said of each chat's prompt: the entries it switched off, and the first history message to keep (null: all). */
export class KeptOut {
  private readonly byChat = new Map<string, { off: ReadonlySet<string>; keep: KeepPoint | null }>();

  /** `most`: how many chats are remembered; past it the one answered longest ago is forgotten. */
  constructor(private readonly most: number) {}

  /** RPE answered for the chat: its answer replaces what was remembered. Where it could not say where to cut, or what the secrets read as, what it said last of that is kept. */
  heard(user: string, chat: string, answer: Pick<Answer, "secrecy" | "cut">): void {
    const key = `${user}\u0000${chat}`;
    const before = this.byChat.get(key);
    const keep = answer.cut === null ? (before?.keep ?? null) : answer.cut.keep;
    const off = answer.secrecy === null ? (before?.off ?? new Set<string>()) : new Set(answer.secrecy.disabled);
    this.byChat.delete(key);
    this.byChat.set(key, { off, keep });
    for (const oldest of this.byChat.keys()) {
      if (this.byChat.size <= this.most) break;
      this.byChat.delete(oldest);
    }
  }

  of(user: string, chat: string): ReadonlySet<string> {
    return this.byChat.get(`${user}\u0000${chat}`)?.off ?? new Set();
  }

  /** Where RPE last said to cut the chat's history; null when it said to keep it all, or has said nothing. */
  cutOf(user: string, chat: string): KeepPoint | null {
    return this.byChat.get(`${user}\u0000${chat}`)?.keep ?? null;
  }
}

/** The verdict with no answer from RPE: today's fail-closed one, and every candidate RPE last kept out of this chat's prompt off too. */
export function failClosed(entries: readonly WorldInfoCandidate[], keptOut: ReadonlySet<string>): Required<WorldInfoVerdict> {
  const verdict = blind(usersOwn(entries));
  const out: Required<WorldInfoVerdict> = { disabled: [...verdict.disabled], enabled: [...verdict.enabled], mutated: [...(verdict.mutated ?? [])] };
  for (const e of entries) if (keptOut.has(e.id) && !out.disabled.includes(e.id)) out.disabled.push(e.id);
  return out;
}
