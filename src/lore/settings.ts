// The lore's settings (plan §9.3, Appendix D.1): each of its defaults as a config file writes it,
// under `lore:`. The defaults stay where each part keeps them. The host (the turn lane) makes the lore
// and its index once for every chat, when RPE starts, so it reads these from the global level alone
// and hands them in: a change is in force from RPE's next start.

import type { NumberSettings, Setting } from "../app/setting-list";
import { LORE_INDEX_DEFAULTS, type LoreIndexSettings } from "./indexing";
import { LORE_DEFAULTS, type LoreSettings } from "./lore";

const GLOBAL = ["shipped", "global"] as const;

/** The lore's (`Lore`): searches and what an entry is titled by. */
export const LORE_SETTING_DEFS = {
  searchLimit: { key: "lore.searchLimit", default: LORE_DEFAULTS.searchLimit, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Hits a lore search gives", about: "Entries a search of the lore gives when it asks for no number.", effect: "start" },
  snippetChars: { key: "lore.snippetChars", default: LORE_DEFAULTS.snippetChars, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Snippet of a lore hit", about: "Characters of an entry's text a hit shows on each side of the first word the search matched.", effect: "start" },
  titleWords: { key: "lore.titleWords", default: LORE_DEFAULTS.titleWords, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Words that title an entry", about: "Words of its text that title a lore entry with no title of its own.", effect: "start" },
} as const satisfies NumberSettings<keyof LoreSettings>;

/** The lore index's (`LoreIndex`): an indexing run's batch, and the lore map's entries bound to the horizon. */
export const LORE_INDEX_SETTING_DEFS = {
  batch: { key: "lore.index.batch", default: LORE_INDEX_DEFAULTS.batch, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Lore indexing, entries per call", about: "Entries handed to one call of a lore indexing run.", effect: "start", row: "Lore indexing, entries per call" },
  bound: { key: "lore.index.bound", default: LORE_INDEX_DEFAULTS.bound, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Lore map, bound entries", about: "Entries bound to the horizon and not in the prompt that the lore map lists.", effect: "start", row: "Lore map, bound entries not in the prompt" },
  // Read for the chat: its own level, else the global one.
  batchChars: { key: "lore.index.batchChars", default: LORE_INDEX_DEFAULTS.batchChars, takes: { type: "whole", least: 1 }, perConnection: false, name: "Lore indexing, characters per call", about: "The most characters of entry text handed to one call of a lore indexing run, so long entries never overrun a small model's window; one entry is handed at least, however long.", effect: "use" },
  page: { key: "lore.index.page", default: LORE_INDEX_DEFAULTS.page, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Lore index, entries per page", about: "Entries one page of the lore index on the Lore page holds.", effect: "use" },
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

/** Every setting the lore reads, as a config file writes it. */
export const LORE_SETTINGS: readonly Setting[] = [...Object.values(LORE_SETTING_DEFS), ...Object.values(LORE_INDEX_SETTING_DEFS), LORE_INDEX_ENTRY_DEF];
