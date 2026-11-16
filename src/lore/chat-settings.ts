// The lore's settings as a chat's levels set them (plan §5.4 "Config"): the lore and its index are made once
// for every chat, so what one chat's levels set is read for it at the moment it is needed, through the config
// reader the host gives (`ConfigRead` of the chat's levels as their files stand now): a change applies at that
// chat's next call, with no restart. Kept apart from `settings.ts`, which the lore's own parts take their
// defaults from, so that no part takes a setting from the lore it is part of.

import type { ConfigRead } from "../app/config-read";
import type { SearchLimits } from "../engine/lore";
import type { LoreIndexSettings } from "./indexing";
import type { LoreSettings } from "./lore";
import { LORE_BOOKS_DEF, LORE_INDEX_ENTRY_DEF, LORE_INDEX_SETTING_DEFS, LORE_PROJECTION_DEF, LORE_SETTING_DEFS, LORE_STOP_WORDS_DEF } from "./settings";

/** The levels of the chat a read is for. */
export interface LoreScope {
  user: string;
  chat: string;
}

/** What a chat's levels set of the lore's settings. */
export interface LoreChatSettings {
  /** His own lore index entry, by its id in Lumiverse; null for none (`lore.index.entry`). */
  indexEntry: string | null;
  /** The lore's numbers (`lore.searchLimit`, `lore.snippetChars`, `lore.titleWords`, `lore.search.minTerm`, `lore.search.wordCap`). */
  lore: LoreSettings;
  /** What a search holds back: the shortest term, a repeated word's count and the stop words (`lore.search.*`). */
  search: SearchLimits;
  /** Which of the chat's books the lore reads (`lore.books`): the ids it names; null for `auto`, every book the chat reads. */
  books: readonly string[] | null;
  /** The index's numbers (`lore.index.*`). */
  index: LoreIndexSettings;
  /** Whether the chat has the projection book on (`lore.projection`). */
  projection: boolean;
}

/** The lore's settings for one chat, read when asked. */
export type LoreSettingsFor = (at: LoreScope) => Promise<LoreChatSettings>;

/** `LoreSettingsFor` over the host's reader of a chat's config levels. */
export function loreSettingsFor(config: (at: LoreScope) => Promise<ConfigRead>): LoreSettingsFor {
  return async (at) => {
    const read = await config(at);
    const entry = read.value(LORE_INDEX_ENTRY_DEF);
    const lore = read.numbers(LORE_SETTING_DEFS);
    const stop = read.value(LORE_STOP_WORDS_DEF);
    const books = read.value(LORE_BOOKS_DEF);
    const listed = Array.isArray(books) ? books.filter((id): id is string => typeof id === "string") : [];
    return {
      indexEntry: typeof entry === "string" && entry.trim() !== "" ? entry.trim() : null,
      lore,
      search: { minTerm: lore.minTerm, wordCap: lore.wordCap, stopWords: Array.isArray(stop) ? stop.filter((w): w is string => typeof w === "string") : [] },
      // `auto`, alone or among the names, reads every book; otherwise exactly those named.
      books: listed.includes("auto") ? null : listed,
      index: read.numbers(LORE_INDEX_SETTING_DEFS),
      projection: read.value(LORE_PROJECTION_DEF) === true,
    };
  };
}
