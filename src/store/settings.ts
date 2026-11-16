// The store's settings (plan §6.3, Appendix D.1): each of its numeric defaults as a config file writes
// it. The store reads no config file and knows nothing of who calls it, so these are plain
// declarations of the shape the application's settings registry takes (`Setting`, `src/app`); the
// host (the turn lane) reads the values and hands them in. The defaults stay where each part keeps
// them. What the store is made with once for every chat, when RPE starts, is read from the global level
// alone and changes from RPE's next start; the world state's, worked out for each briefing, at every
// level from the next turn.

import { STORE_DEFAULTS } from "./store";
import { WORLD_STATE_DEFAULTS } from "./world-state";
import { WORLD_DOCS_DEFAULTS } from "./worlds";

/** The levels a setting is read from where the host makes its part once for every chat. */
const GLOBAL = ["shipped", "global"] as const;

/** The store's own (`openStore`), made once for every chat: snapshots, and what is held in memory. */
export const STORE_SETTING_DEFS = {
  snapshotEvery: { key: "store.snapshotEvery", default: STORE_DEFAULTS.snapshotEvery, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Snapshot", about: "Turns between snapshots of a chat's world, from which its state is rebuilt.", effect: "start", row: "Snapshot" },
  foldsKept: { key: "store.foldsKept", default: STORE_DEFAULTS.foldsKept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World states held in memory", about: "Worked-out world states held in memory, the least recently used going first.", effect: "start" },
  notable: { key: "store.notable", default: STORE_DEFAULTS.notable, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Names of note in a reflection", about: "Names of note each reflection of the world lists.", effect: "start" },
  kindChain: { key: "engine.kindChain", default: STORE_DEFAULTS.kindChain, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Kinds followed up a kind's chain", about: "How many kinds up a kind's chain the engine follows to learn what something is; past it, it says where it stopped.", effect: "start" },
  holderDepth: { key: "engine.holderDepth", default: STORE_DEFAULTS.holderDepth, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Holders followed to find a thing's place", about: "How many holders up the engine looks for the place a thing is at; past it, it says where it stopped.", effect: "start" },
  visitDepth: { key: "space.visitDepth", default: STORE_DEFAULTS.visitDepth, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Places a visit counts for", about: "How many places up the place tree a visit of the point of view counts for; past it, it says where it stopped.", effect: "start" },
} as const satisfies Record<Exclude<keyof typeof STORE_DEFAULTS, "ownOnly">, object>;

/** The world state's (`worldState`), worked out for each turn's briefing: read at every level. */
export const WORLD_STATE_SETTING_DEFS = {
  budget: { key: "worldState.budget", default: WORLD_STATE_DEFAULTS.budget, takes: { type: "whole", least: 0 }, perConnection: false, name: "World state: everything else", about: "Tokens of the briefing's world state that everything but the horizon shares.", effect: "turn", row: "World state: everything else" },
  charsPerToken: { key: "worldState.charsPerToken", default: WORLD_STATE_DEFAULTS.charsPerToken, takes: { type: "number", least: 1 }, perConnection: false, name: "Characters per token, for the world state", about: "Characters counted as one token when the world state's budget is measured.", effect: "turn" },
  dueAhead: { key: "worldState.dueAhead", default: WORLD_STATE_DEFAULTS.dueAhead, takes: { type: "whole", least: 0 }, perConnection: false, name: "Time ahead listed as due", about: "Minutes of story time ahead that the world state's due section lists.", effect: "turn" },
} as const satisfies Record<keyof typeof WORLD_STATE_DEFAULTS, object>;

/** The world documents' (`storedWorlds`), read once for every chat: the revisions held in memory. */
export const WORLD_DOCS_SETTING_DEFS = {
  kept: { key: "store.worldsKept", default: WORLD_DOCS_DEFAULTS.kept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World revisions held in memory", about: "Revisions of world documents held in memory once read, the least recently used going first.", effect: "start" },
} as const satisfies Record<keyof typeof WORLD_DOCS_DEFAULTS, object>;

/** Every setting the store reads, as a config file writes it. */
export const STORE_SETTINGS = [...Object.values(STORE_SETTING_DEFS), ...Object.values(WORLD_STATE_SETTING_DEFS), ...Object.values(WORLD_DOCS_SETTING_DEFS)];
