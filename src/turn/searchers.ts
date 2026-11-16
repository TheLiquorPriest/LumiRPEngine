// The host's searchers for `gap_check` (plan §10.5): beside the chat and the lore, which RPH searches itself, the folded state at the
// check's turn and the story record along its path. Each name the check gives (its topic and each other name) is its own search, the
// hits joined in the order the names were given, each thing once, at most the check's limit. A character's agent is given only what its
// character may know (§9.4): of the state, the people it knows and the places it can see; of the story record, the beats, scenes and
// chapters it is named in. Code matches words; it never judges what they mean.

import type { GapQuery, Scope, SearchHit, Searcher } from "rp-harness/contract";
import { playerKnows } from "../engine/player-events";
import { canSeePlace } from "../engine/visibility";
import { stateScan } from "../iface/search";
import type { Store } from "../store";
import type { StoreState } from "../store/types";
import { storySliceOf, type StoryItemDoc } from "../story/fold";

/** What the searchers read beside the store: the world's person a character's agent plays, and how long a hit's snippet may be. */
export interface SearchersDeps {
  store: Store;
  /** The world's person `plays` names in the chat at the turn; null for none, or several. */
  personPlayed(at: { user: string; chat: string; turn?: string }, plays: string): { id: string; name: string } | null;
  /** The most characters of a hit's snippet (`gap.snippet`), for the chat. */
  snippet(scope: Scope): Promise<number>;
}

/** The story parts a character may know of, as what happened with it there. */
const LIVED: Readonly<Record<string, true>> = { beat: true, scene: true, chapter: true };

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** The folded state at the scope's turn (a job's own, with its writes), or at the chat's head with none; null for a chat the store has not met. */
function stateAt(store: Store, scope: Scope, job: string | null): StoreState | null {
  const user = store.user(scope.user);
  if (user.chat(scope.chat) === null) return null;
  return (scope.turn !== undefined ? user.stateFor(scope.turn, job) : user.headState(scope.chat)).state;
}

/** Each name of the check on its own, the hits joined in the names' order, each ref once, at most `limit`. */
function eachName(query: GapQuery, find: (name: string) => SearchHit[]): SearchHit[] {
  const out = new Map<string, SearchHit>();
  for (const name of [query.topic, ...query.terms]) {
    for (const hit of find(name)) if (!out.has(hit.ref)) out.set(hit.ref, hit);
    if (out.size >= query.limit) break;
  }
  return [...out.values()].slice(0, Math.max(0, query.limit));
}

const cut = (text: string, most: number): string => (text.length <= most ? text : text.slice(0, most));

/** The folded state: people, things, places and groups, by their names, other names, kind, description and notes. */
export function stateSearcher(deps: SearchersDeps): Searcher {
  return {
    name: "state",
    async search(scope, query) {
      const state = stateAt(deps.store, scope, query.reader.job ?? null);
      if (state === null) return [];
      const env = deps.store.env;
      const most = await deps.snippet(scope);
      const known = mayKnowInState(deps, scope, state, query);
      return eachName(query, (name) =>
        stateScan
          .search(state, env, name, { limit: query.limit })
          .filter((h) => known(h.ref))
          .map((h) => ({ ref: h.ref, title: h.name, snippet: cut([h.what, h.matched, h.where].filter((x) => x !== undefined && x !== "").join(" · "), most), how: "words" as const })),
      );
    },
  };
}

/** Whether the reader may know a thing of the state: anything, for an agent that plays no one; for a character's, the people it knows and the places it can see. */
function mayKnowInState(deps: SearchersDeps, scope: Scope, state: StoreState, query: GapQuery): (ref: string) => boolean {
  const plays = query.reader.plays;
  if (plays === undefined) return () => true;
  const who = deps.personPlayed(scope, plays);
  const doc = deps.store.env.worlds(state.world.revision);
  if (who === null || doc === undefined) return () => false;
  const reg = deps.store.env.registry;
  const world = reg.context(doc, state.world).world;
  return (ref) => {
    const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    if (kind === "place") return canSeePlace(reg, world, state.world, who.id, id);
    return id === who.id || playerKnows(reg, world, state.world, who.id, id);
  };
}

/** Every text an item's fields hold, one string each. */
function textsOf(item: StoryItemDoc): string[] {
  const out: string[] = [];
  for (const v of Object.values(item.fields)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  }
  return out;
}

/** The story record along the path: its items (beats, threads, records, summaries and the rest), the lore's overlays and the horizon. */
export function storySearcher(deps: SearchersDeps): Searcher {
  return {
    name: "story",
    async search(scope, query) {
      const state = stateAt(deps.store, scope, query.reader.job ?? null);
      if (state === null) return [];
      const slice = storySliceOf(state);
      const most = await deps.snippet(scope);
      const plays = query.reader.plays;
      const who = plays === undefined ? null : deps.personPlayed(scope, plays);
      // A character's agent: the beats, scenes and chapters naming its character; nothing where it plays no one the world has.
      const mayKnow = (item: StoryItemDoc): boolean => {
        if (plays === undefined) return true;
        if (LIVED[item.part] !== true) return false;
        const named = typeof item.fields.who === "string" ? [item.fields.who] : Array.isArray(item.fields.who) ? item.fields.who.filter((w): w is string => typeof w === "string") : [];
        const keys = new Set(named.map((n) => n.trim().toLowerCase()));
        return keys.has(plays.trim().toLowerCase()) || (who !== null && (keys.has(who.name.trim().toLowerCase()) || keys.has(who.id.toLowerCase())));
      };
      return eachName(query, (name) => {
        const said = wordsOf(name);
        if (said.length === 0) return [];
        const meets = (text: string): boolean => {
          const own = wordsOf(text);
          return said.every((w) => own.includes(w));
        };
        const hits: SearchHit[] = [];
        for (const item of Object.values(slice.items)) {
          if (item.dropped || !mayKnow(item)) continue;
          const found = textsOf(item).find(meets);
          if (found === undefined) continue;
          const title = typeof item.fields.title === "string" ? item.fields.title : typeof item.fields.name === "string" ? item.fields.name : item.id;
          hits.push({ ref: `story:${item.id}`, title, snippet: cut(found, most), how: "words" });
        }
        if (plays === undefined) {
          for (const o of slice.overlays) if (meets(o.note)) hits.push({ ref: `overlay:${o.entry}:${o.turn}`, title: o.entry, snippet: cut(o.note, most), how: "words" });
          for (const h of slice.horizon) if (meets(h.at)) hits.push({ ref: `horizon:${h.at}`, title: h.at, snippet: cut(h.at, most), how: "words" });
        }
        return hits.slice(0, query.limit);
      });
    },
  };
}
