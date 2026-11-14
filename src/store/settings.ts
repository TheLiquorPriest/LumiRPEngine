// The store's settings (plan §6.3, Appendix D.1): each of its numeric defaults as a config file writes
// it. The store reads no config file and knows nothing of who calls it, so these are plain
// declarations of the shape the application's settings list takes (`SettingDef`, `src/app`); the host
// (the turn lane) reads the values and hands them in. The defaults stay where each part keeps them.

import { STORE_DEFAULTS } from "./store";
import { WORLD_STATE_DEFAULTS } from "./world-state";
import { WORLD_DOCS_DEFAULTS } from "./worlds";

/** The levels a setting is read from where the host makes its part once for every chat. */
const GLOBAL = ["shipped", "global"] as const;

/** The store's own (`openStore`), made once for every chat: snapshots, and what is held in memory. */
export const STORE_SETTING_DEFS = {
  snapshotEvery: { key: "store.snapshotEvery", default: STORE_DEFAULTS.snapshotEvery, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false },
  foldsKept: { key: "store.foldsKept", default: STORE_DEFAULTS.foldsKept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false },
  notable: { key: "store.notable", default: STORE_DEFAULTS.notable, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false },
} as const satisfies Record<Exclude<keyof typeof STORE_DEFAULTS, "ownOnly">, object>;

/** The world state's (`worldState`), worked out for each turn's briefing: read at every level. */
export const WORLD_STATE_SETTING_DEFS = {
  budget: { key: "worldState.budget", default: WORLD_STATE_DEFAULTS.budget, takes: { type: "whole", least: 0 }, perConnection: false },
  charsPerToken: { key: "worldState.charsPerToken", default: WORLD_STATE_DEFAULTS.charsPerToken, takes: { type: "number", least: 1 }, perConnection: false },
  dueAhead: { key: "worldState.dueAhead", default: WORLD_STATE_DEFAULTS.dueAhead, takes: { type: "whole", least: 0 }, perConnection: false },
} as const satisfies Record<keyof typeof WORLD_STATE_DEFAULTS, object>;

/** The world documents' (`storedWorlds`), read once for every chat: the revisions held in memory. */
export const WORLD_DOCS_SETTING_DEFS = {
  kept: { key: "store.worldsKept", default: WORLD_DOCS_DEFAULTS.kept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false },
} as const satisfies Record<keyof typeof WORLD_DOCS_DEFAULTS, object>;

/** Every setting the store reads, as a config file writes it. */
export const STORE_SETTINGS = [...Object.values(STORE_SETTING_DEFS), ...Object.values(WORLD_STATE_SETTING_DEFS), ...Object.values(WORLD_DOCS_SETTING_DEFS)];
