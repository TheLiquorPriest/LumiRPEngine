// The lore's settings (plan §9.3, Appendix D.1): each of its defaults as a config file writes it,
// under `lore:`. The defaults stay where each part keeps them. The host (the turn lane) makes the lore
// and its index once for every chat, so it reads these from the global level alone and hands them in.

import type { NumberSettings, SettingDef } from "../app/setting-list";
import { LORE_INDEX_DEFAULTS, type LoreIndexSettings } from "./indexing";
import { LORE_DEFAULTS, type LoreSettings } from "./lore";

/** The lore's (`Lore`): searches and what an entry is titled by. */
export const LORE_SETTING_DEFS = {
  searchLimit: { key: "lore.searchLimit", default: LORE_DEFAULTS.searchLimit, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  snippetChars: { key: "lore.snippetChars", default: LORE_DEFAULTS.snippetChars, takes: { type: "whole", least: 0 }, levels: ["shipped", "global"], perConnection: false },
  titleWords: { key: "lore.titleWords", default: LORE_DEFAULTS.titleWords, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
} as const satisfies NumberSettings<keyof LoreSettings>;

/** The lore index's (`LoreIndex`): an indexing run's batch, and the lore map's entries bound to the horizon. */
export const LORE_INDEX_SETTING_DEFS = {
  batch: { key: "lore.index.batch", default: LORE_INDEX_DEFAULTS.batch, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  bound: { key: "lore.index.bound", default: LORE_INDEX_DEFAULTS.bound, takes: { type: "whole", least: 0 }, levels: ["shipped", "global"], perConnection: false },
} as const satisfies NumberSettings<keyof LoreIndexSettings>;

/** Every setting the lore reads, as a config file writes it. */
export const LORE_SETTINGS: readonly SettingDef[] = [...Object.values(LORE_SETTING_DEFS), ...Object.values(LORE_INDEX_SETTING_DEFS)];
