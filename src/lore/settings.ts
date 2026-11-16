// The lore's settings (plan §9.3, Appendix D.1): each of its defaults as a config file writes it,
// under `lore:`. The defaults stay where each part keeps them. Each is read for a chat from its levels'
// config files (`chat-settings.ts`) at each call, so a change on the Settings page applies at that chat's
// next turn with no restart; the global level and RPE's shipped defaults are what a chat that sets nothing gets.

import type { NumberSettings, Setting } from "../app/setting-list";
import { SEARCH_LIMITS } from "../engine/lore";
import { KNOWLEDGE_DEFAULTS } from "../shared/minds";
import { NARRATOR_DEFAULTS, NARRATOR_KNOWLEDGE, NARRATOR_SECRETS } from "../shared/settings";
import { LORE_INDEX_DEFAULTS, type LoreIndexSettings } from "./indexing";
import { LORE_DEFAULTS, type LoreSettings } from "./lore";

/** The lore's (`Lore`): searches and what an entry is titled by. */
export const LORE_SETTING_DEFS = {
  searchLimit: { key: "lore.searchLimit", default: LORE_DEFAULTS.searchLimit, takes: { type: "whole", least: 1 }, perConnection: false, name: "Hits a lore search gives", about: "Entries a search of the lore gives when it asks for no number.", effect: "use" },
  snippetChars: { key: "lore.snippetChars", default: LORE_DEFAULTS.snippetChars, takes: { type: "whole", least: 0 }, perConnection: false, name: "Snippet of a lore hit", about: "Characters of an entry's text a hit shows on each side of the first word the search matched.", effect: "use" },
  titleWords: { key: "lore.titleWords", default: LORE_DEFAULTS.titleWords, takes: { type: "whole", least: 1 }, perConnection: false, name: "Words that title an entry", about: "Words of its text that title a lore entry with no title of its own.", effect: "use" },
  minTerm: { key: "lore.search.minTerm", default: LORE_DEFAULTS.minTerm, takes: { type: "whole", least: 1 }, perConnection: false, name: "Shortest word a lore search matches", about: "A name or word shorter than this matches nothing in a search of the lore; lower it to find a two-letter name.", effect: "use" },
  wordCap: { key: "lore.search.wordCap", default: LORE_DEFAULTS.wordCap, takes: { type: "whole", least: 1 }, perConnection: false, name: "Most a repeated word counts", about: "A word repeated in an entry counts at most this often in how a search ranks it, so one long entry cannot outrank the rest on one word.", effect: "use" },
  heldBudget: { key: "lore.held.budget", default: LORE_DEFAULTS.heldBudget, takes: { type: "whole", least: 0 }, perConnection: false, name: "Tokens of held secrets a character is given", about: "The most tokens the secrets a character holds may take in the lore it is given as its own, with how it came by each; one that does not fit is left out and the next tried.", effect: "use" },
} as const satisfies NumberSettings<keyof LoreSettings>;

/** The words a search of the lore counts for nothing, as a list; today's, in the shipped config's default. */
export const LORE_STOP_WORDS_DEF = {
  key: "lore.search.stopWords",
  default: [...SEARCH_LIMITS.stopWords],
  takes: { type: "texts" },
  perConnection: false,
  name: "Words a lore search ignores",
  about: "Words that count for nothing in a search of the lore (articles and the like); change the list for a book in another language.",
  effect: "use",
} as const satisfies Setting;

/**
 * Which of his books the lore reads: `auto` (the default) reads every book the chat reads; a list of book ids reads only those of
 * them, exactly as today's choice narrows them. Part 1 of the lore map still lists every entry Lumiverse put in the prompt.
 */
export const LORE_BOOKS_DEF = {
  key: "lore.books",
  default: ["auto"],
  takes: { type: "texts" },
  perConnection: false,
  name: "Books the lore reads",
  about: "`auto` reads every book the chat reads. Otherwise a list of book ids: only those of the chat's books are read as lore, by the index, the lore map's fourth part, the search and every read.",
  effect: "use",
} as const satisfies Setting;

/** The lore index's (`LoreIndex`): an indexing run's batch, and the lore map's entries bound to the horizon. */
export const LORE_INDEX_SETTING_DEFS = {
  batch: { key: "lore.index.batch", default: LORE_INDEX_DEFAULTS.batch, takes: { type: "whole", least: 1 }, perConnection: false, name: "Lore indexing, entries per call", about: "Entries handed to one call of a lore indexing run.", effect: "use", row: "Lore indexing, entries per call" },
  bound: { key: "lore.index.bound", default: LORE_INDEX_DEFAULTS.bound, takes: { type: "whole", least: 0 }, perConnection: false, name: "Lore map, bound entries", about: "Entries bound to the horizon and not in the prompt that the lore map lists.", effect: "use", row: "Lore map, bound entries not in the prompt" },
  batchChars: { key: "lore.index.batchChars", default: LORE_INDEX_DEFAULTS.batchChars, takes: { type: "whole", least: 1 }, perConnection: false, name: "Lore indexing, characters per call", about: "The most characters of entry text handed to one call of a lore indexing run, so long entries never overrun a small model's window; one entry is handed at least, however long.", effect: "use" },
  // The route that pages the index reads its size once, from the global level.
  page: { key: "lore.index.page", default: LORE_INDEX_DEFAULTS.page, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false, name: "Lore index, entries per page", about: "Entries one page of the lore index on the Lore page holds.", effect: "start" },
} as const satisfies NumberSettings<keyof LoreIndexSettings>;

/**
 * The book entry that is his own lore index (Settings → Lore, carried over from today's): by its id in Lumiverse. Its text, as written,
 * heads `LORE-INDEX.md` in front of the lines RPE generates. Read for the chat, from the chat's level or the global one.
 */
export const LORE_INDEX_ENTRY_DEF = {
  key: "lore.index.entry",
  default: null,
  takes: { type: "text" },
  orNone: true,
  none: "no index entry of his own",
  perConnection: false,
  name: "Your own lore index entry",
  about: "A lore entry of yours whose text heads the readable lore index of each chat, in front of the lines RPE writes. Give its id in Lumiverse.",
  effect: "turn",
} as const satisfies Setting;

/**
 * What the narrator knows of the chat's secrets (the three choices of today's Settings → Narrator, carried as they are): the chat's own
 * value, else its world's own `narrator` at the point of the path, else the global one, else the shipped default. Each part is a
 * setting; a chat that sets one part follows its world's, then the global, for the other.
 */
export const SECRETS_NARRATOR_KNOWLEDGE_DEF = {
  key: "secrets.narrator.knowledge",
  default: NARRATOR_DEFAULTS.knowledge,
  takes: { type: "oneOf", values: NARRATOR_KNOWLEDGE },
  perConnection: false,
  name: "Narrator's knowledge",
  about: "What the narrator knows of the chat's secrets: `scene` (everyone in the scene) or `pov` (the player's character only). The chat's own choice wins over its world's own, which wins over this global one.",
  effect: "use",
} as const satisfies Setting;

export const SECRETS_NARRATOR_SECRETS_DEF = {
  key: "secrets.narrator.secrets",
  default: NARRATOR_DEFAULTS.secrets,
  takes: { type: "oneOf", values: NARRATOR_SECRETS },
  perConnection: false,
  name: "Narrator's secrets",
  about: "How a secret kept from the player's character reaches the narrator: `marked` (put in, marked as a secret) or `omit` (left out). The chat's own choice wins over its world's own, which wins over this global one.",
  effect: "use",
} as const satisfies Setting;

/** Whether a chat tracks who knows what: a holding of a secret counts only while it does. The chat's own, else the global one; each new turn records the value in force. */
export const SECRETS_TRACKED_DEF = {
  key: "secrets.tracked",
  default: KNOWLEDGE_DEFAULTS.enabled,
  takes: { type: "yesNo" },
  perConnection: false,
  name: "Track who knows what",
  about: "Whether a chat tracks who holds which secret. Off, no holding counts and every secret stays kept; what was recorded stays for when it is switched on again. Each new turn records the value in force, so a swipe or a branch judges a secret by what held there.",
  effect: "turn",
} as const satisfies Setting;

/** How sure a holding must be before it counts: the global one, and the chat's where set; each new turn records the value in force. */
export const SECRETS_THRESHOLD_DEF = {
  key: "secrets.threshold",
  default: KNOWLEDGE_DEFAULTS.threshold,
  takes: { type: "number", least: 0, most: 1 },
  perConnection: false,
  name: "How sure a holding must be",
  about: "How sure a holding of a secret must be, from 0 to 1, before it counts as the holder knowing it. Each new turn records the value in force, so a swipe or a branch judges a secret by what held there.",
  effect: "turn",
} as const satisfies Setting;

/** The settings of the secrets: what the narrator knows of them, and when a holding counts. */
export const SECRETS_SETTINGS: readonly Setting[] = [SECRETS_NARRATOR_KNOWLEDGE_DEF, SECRETS_NARRATOR_SECRETS_DEF, SECRETS_TRACKED_DEF, SECRETS_THRESHOLD_DEF];

/** Every setting the lore reads, as a config file writes it. */
export const LORE_SETTINGS: readonly Setting[] = [...Object.values(LORE_SETTING_DEFS), LORE_STOP_WORDS_DEF, LORE_BOOKS_DEF, ...Object.values(LORE_INDEX_SETTING_DEFS), LORE_INDEX_ENTRY_DEF, ...SECRETS_SETTINGS];
