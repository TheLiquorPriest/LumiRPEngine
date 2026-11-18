// The host's searchers for `gap_check` (plan §10.5): beside the chat and the lore, which RPH searches itself, the folded state at the
// check's turn and the story record along its path. Each name the check gives (its topic and each other name) is its own search, the
// hits joined in the order the names were given, each thing once, at most the check's limit. Where he has an embedding connection, each
// adds what is nearest the check in meaning beyond what the words found, marked `meaning`, within the same limit (§9.4); with none,
// nothing is embedded and every hit is by words. A character's agent is given only what its character may know (§9.4): of the state,
// the people it knows and the places it can see; of the story record, the beats, scenes and chapters it is named in. Code matches
// words and compares vectors; it never judges what they mean.

import type { GapQuery, Scope, SearchHit, Searcher } from "rp-harness/contract";
import { placeAliases } from "../engine/place-names";
import { playerKnows } from "../engine/player-events";
import { isGone, kindDef } from "../engine/scope";
import { canSeePlace } from "../engine/visibility";
import { stateScan } from "../iface/search";
import type { MeaningDoc, MeaningIndex, MeaningPlace } from "../search/meaning";
import { hashJson } from "../shared/hash";
import type { Store } from "../store";
import type { FoldEnv } from "../store/fold";
import type { StoreState } from "../store/types";
import { storySliceOf, type StoryItemDoc } from "../story/fold";

/** What the searchers read beside the store: the world's person a character's agent plays, how long a hit's snippet may be, and the search by meaning. */
export interface SearchersDeps {
  store: Store;
  /** The world's person `plays` names in the chat at the turn; null for none, or several. */
  personPlayed(at: { user: string; chat: string; turn?: string }, plays: string): { id: string; name: string } | null;
  /** The most characters of a hit's snippet (`tools.gap.snippetChars`), for the chat. */
  snippet(scope: Scope): Promise<number>;
  /** The index of vectors; absent, every hit is by words. */
  meaning?: Pick<MeaningIndex, "nearest">;
}

/** A text a search by meaning compares, as its source holds it now, and the hit it makes when it is near. */
interface MeaningEntry {
  doc: MeaningDoc;
  title: string;
  snippet: string;
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

/** One entry of a place's search by meaning: its text the words said of it, one to a line; its revision the hash of that text. */
function entryOf(id: string, title: string, texts: readonly string[], snippet: string): MeaningEntry {
  const text = texts.filter((t) => t.trim() !== "").join("\n");
  return { doc: { id, revision: hashJson(text), text }, title, snippet: snippet.trim() === "" ? title : snippet };
}

/**
 * The words' hits and, where he has an embedding connection, the entries nearest the check in meaning beyond them that the reader may
 * know, each marked `meaning`, the two together at most the check's limit. The place's entries are read only once the connection is
 * known to be set; with none, the words' hits alone.
 */
async function withMeaning(deps: SearchersDeps, scope: Scope, place: MeaningPlace, query: GapQuery, words: SearchHit[], entries: () => MeaningEntry[], mayKnow: (ref: string) => boolean, most: number): Promise<SearchHit[]> {
  const room = query.limit - words.length;
  if (deps.meaning === undefined || room <= 0) return words;
  const read = new Map<string, MeaningEntry>();
  const docs = (): MeaningDoc[] => {
    for (const e of entries()) read.set(e.doc.id, e);
    return [...read.values()].map((e) => e.doc);
  };
  const near = await deps.meaning.nearest(scope.user, scope.chat, place, [query.topic, ...query.terms].join(" "), Number.MAX_SAFE_INTEGER, docs);
  if (near === null) return words;
  const taken = new Set(words.map((h) => h.ref));
  const more = near.flatMap((ref): SearchHit[] => {
    const e = read.get(ref);
    return e === undefined || taken.has(ref) || !mayKnow(ref) ? [] : [{ ref, title: e.title, snippet: cut(e.snippet, most), how: "meaning" }];
  });
  return [...words, ...more.slice(0, room)];
}

/** The folded state's places and the things not gone, as search by meaning reads them: each by its ref, with its names, kind, description and notes. */
function stateEntries(state: StoreState, env: FoldEnv): MeaningEntry[] {
  const doc = env.worlds(state.world.revision);
  if (doc === undefined) return [];
  const world = env.registry.context(doc, state.world).world;
  const out: MeaningEntry[] = [];
  for (const [id, p] of Object.entries(world.places)) {
    const description = typeof p.fields.description === "string" ? p.fields.description : "";
    const note = state.notes[`place:${id}`]?.text ?? "";
    out.push(entryOf(`place:${id}`, p.name, [p.name, ...placeAliases(p), description, note], [description, note].filter((t) => t !== "").join(" · ")));
  }
  for (const [id, e] of Object.entries(state.world.entities)) {
    if (isGone(state.world, id)) continue;
    const label = kindDef(env.registry, doc, e.kind)?.label ?? e.kind;
    const aliases = Array.isArray(e.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
    const description = typeof e.fields.description === "string" ? e.fields.description : "";
    const note = state.notes[`entity:${id}`]?.text ?? "";
    out.push(entryOf(`entity:${id}`, e.name, [e.name, ...aliases, label, description, note], [label, description, note].filter((t) => t !== "").join(" · ")));
  }
  return out;
}

/** The folded state: people, things, places and groups, by their names, other names, kind, description and notes, and by meaning where set up. */
export function stateSearcher(deps: SearchersDeps): Searcher {
  return {
    name: "state",
    async search(scope, query) {
      const state = stateAt(deps.store, scope, query.reader.job ?? null);
      if (state === null) return [];
      const env = deps.store.env;
      const most = await deps.snippet(scope);
      const known = mayKnowInState(deps, scope, state, query);
      const words = eachName(query, (name) =>
        stateScan
          .search(state, env, name, { limit: query.limit })
          .filter((h) => known(h.ref))
          .map((h) => ({ ref: h.ref, title: h.name, snippet: cut([h.what, h.matched, h.where].filter((x) => x !== undefined && x !== "").join(" · "), most), how: "words" as const })),
      );
      return await withMeaning(deps, scope, "state", query, words, () => stateEntries(state, env), known, most);
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

/** The title a story item is shown by: its title, else its name, else its id. */
const itemTitle = (item: StoryItemDoc): string => (typeof item.fields.title === "string" ? item.fields.title : typeof item.fields.name === "string" ? item.fields.name : item.id);

/** The story record along the path: its items (beats, threads, records, summaries and the rest), the lore's overlays and the horizon; its items by meaning where set up. */
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
      const items = Object.values(slice.items).filter((item) => !item.dropped);
      const words = eachName(query, (name) => {
        const said = wordsOf(name);
        if (said.length === 0) return [];
        const meets = (text: string): boolean => {
          const own = wordsOf(text);
          return said.every((w) => own.includes(w));
        };
        const hits: SearchHit[] = [];
        for (const item of items) {
          if (!mayKnow(item)) continue;
          const found = textsOf(item).find(meets);
          if (found === undefined) continue;
          hits.push({ ref: `story:${item.id}`, title: itemTitle(item), snippet: cut(found, most), how: "words" });
        }
        if (plays === undefined) {
          for (const o of slice.overlays) if (meets(o.note)) hits.push({ ref: `overlay:${o.entry}:${o.turn}`, title: o.entry, snippet: cut(o.note, most), how: "words" });
          for (const h of slice.horizon) if (meets(h.at)) hits.push({ ref: `horizon:${h.at}`, title: h.at, snippet: cut(h.at, most), how: "words" });
        }
        return hits.slice(0, query.limit);
      });
      const known = new Map(items.map((item) => [`story:${item.id}`, item]));
      const entries = (): MeaningEntry[] =>
        items.map((item) => {
          const texts = textsOf(item);
          return entryOf(`story:${item.id}`, itemTitle(item), texts, texts.find((t) => t.trim() !== "" && t !== itemTitle(item)) ?? "");
        });
      return await withMeaning(deps, scope, "story", query, words, entries, (ref) => {
        const item = known.get(ref);
        return item !== undefined && mayKnow(item);
      }, most);
    },
  };
}
