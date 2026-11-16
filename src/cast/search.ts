// Memories found by words at the owner's size (plan §4.7, §7.4, Appendix B): a character holds hundreds of memories after ten story
// days, and every recall and every scene's what-comes-to-mind asks which of them touch a cue. The index file's `memories` index
// (`src/app/index-file`) holds each memory's tokens by id and revision, never its text; a search answers the ids that hold a word
// of the cue, and `touches` (`memory.ts`) then settles which of those touch it by the one rule, so the index only narrows what is
// read and never decides what matches: what comes back is what a scan of every memory would give.
//
// A character's memories are fed to the index when a search finds one it does not hold at its revision (a memory's revision is the
// count of its writes and the change that wrote it last), so a memory written, changed by a later write or taken back by a swipe is
// indexed again by its new words, and one the record no longer holds is never asked for. Texts go to the index once per revision.

import { sayingsOf, words } from "./memory";
import type { CastItem, CastRecord } from "./record";

/** The index file's face, as the memories' search uses it (`IndexFile` is one). */
export interface MemoryIndexPort {
  put(index: "memories", user: string, docs: readonly { id: string; revision: string; scope: string; text: string }[]): Promise<{ written: number }>;
  search(index: "memories", user: string, query: string, options: { scope?: string | null; limit: number }): Promise<{ id: string; revision: string; scope: string; rank: number }[]>;
}

/** A memory's revision: how many writes it has and the change that wrote it last, which a later write or a swipe changes. */
const revisionOf = (m: CastItem): string => `${m.rows.length}.${m.rows.at(-1)?.s ?? 0}`;

export class MemorySearch {
  readonly #index: MemoryIndexPort;
  /** The revision of each memory the index holds, by user and id: what is fed once is not sent again. */
  readonly #fed = new Map<string, string>();

  constructor(index: MemoryIndexPort) {
    this.#index = index;
  }

  /**
   * The ids of the character's memories on `record` whose words or tags hold a word of any of `cues`: every memory that touches a cue
   * is among them, and others may be, which `touches` then rules out. Null where a cue holds no word the index could ask for: read every memory.
   */
  async candidates(user: string, record: CastRecord, character: string, cues: readonly string[]): Promise<Set<string> | null> {
    const asked = [...new Set(cues.flatMap((cue) => words(cue).trim().split(" ")))];
    if (asked.some((word) => word === "")) return null;
    const memories = record.of(character, "memory");
    const stale = memories.filter((m) => this.#fed.get(`${user}\u0000${m.id}`) !== revisionOf(m));
    if (stale.length > 0) {
      await this.#index.put(
        "memories",
        user,
        stale.map((m) => ({ id: m.id, revision: revisionOf(m), scope: character, text: sayingsOf(m).said.join(" ") })),
      );
      for (const m of stale) this.#fed.set(`${user}\u0000${m.id}`, revisionOf(m));
    }
    const found = await Promise.all(asked.map((word) => this.#index.search("memories", user, word, { scope: character, limit: Number.MAX_SAFE_INTEGER })));
    return new Set(found.flatMap((hits) => hits.map((h) => h.id)));
  }
}
