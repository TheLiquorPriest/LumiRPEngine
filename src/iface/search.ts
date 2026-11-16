// Finding things by words in a chat's folded state (plan §6.8 `world_search`): people, things,
// places and groups, by their names, their other names, their kind, their description, the values of
// their facts and the agents' own lines on them. Code matches words; it never judges what words mean.
// Whole names first, then names holding every word, then names holding some, then the rest of what is
// said of them (`src/store/search.ts` holds that order and what is said of a thing).
//
// `indexedSearch` is what `world_search` runs on a world of thousands: the store's state index
// (`StateIndex`, in the index file) gives candidates and the state orders them. `stateScan` reads
// every thing of one state, with no index: for a store the index file is not behind, and a reading of
// one state taken apart from any chat (the gap check's searcher).

import { type Found, ordered, readingOf, refsOf, scoreThing, thingOf, wordsOf, type StateIndex } from "../store/search";
import type { StateHit, StateKind, StateSearch } from "./kit";

const hitOf = ({ score: _score, ...hit }: Found): StateHit => hit;

/** The scan of one state: every thing it holds, read; its answer is the index's, an index being only a way to read fewer. */
export const stateScan: { search: (...args: Parameters<StateSearch["search"]>) => StateHit[] } = {
  search(state, env, words, opts) {
    const said = wordsOf(words);
    if (said.length === 0) return [];
    const r = readingOf(state, env);
    if (r === null) return [];
    const whole = said.join(" ");
    const found: Found[] = [];
    for (const ref of refsOf(r)) {
      const t = thingOf(r, ref);
      if (t === null || t.gone || (opts.kind !== undefined && t.kind !== opts.kind)) continue;
      const hit = scoreThing(t, said, whole);
      if (hit !== null) found.push(hit);
    }
    return ordered(found, opts.limit).map(hitOf);
  },
};

/** The search over a chat's state index (`StateIndex.search`), for the user and chat the host's tools are made for. */
export function indexedSearch(index: StateIndex, who: { user: string; chat: string }): StateSearch {
  return {
    async search(state, env, words, opts: { kind?: StateKind; limit: number }) {
      return (await index.search(who.user, who.chat, state, env, words, opts)).map(hitOf);
    },
  };
}
