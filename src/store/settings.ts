// The store's settings (plan §6.3, Appendix D.1): each of its numeric defaults as a config file writes
// it. The store reads no config file and knows nothing of who calls it, so these are plain
// declarations of the shape the application's settings registry takes (`Setting`, `src/app`); the
// host (the turn lane) reads the values and hands them in. The defaults stay where each part keeps
// them. What the store is made with once for every chat, when RPE starts, is read from the global level
// alone and changes from RPE's next start; the world state's, worked out for each briefing, at every
// level from the next turn.

import { STORE_DEFAULTS } from "./store";
import { WORLD_STATE_DEFAULTS } from "./world-state";
import { STATE_SEARCH_DEFAULTS } from "./search";
import { WORLD_DOCS_DEFAULTS } from "./worlds";

/** The levels a setting is read from where the host makes its part once for every chat. */
const GLOBAL = ["shipped", "global"] as const;

/** The store's own (`openStore`), made once for every chat: snapshots, and what is held in memory. */
export const STORE_SETTING_DEFS = {
  snapshotEvery: { key: "store.snapshotEvery", default: STORE_DEFAULTS.snapshotEvery, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Snapshot", about: "Turns between snapshots of a chat's world, from which its state is rebuilt.", effect: "start", row: "Snapshot" },
  chatsHeld: { key: "store.chatsHeld", default: STORE_DEFAULTS.chatsHeld, takes: { type: "whole", least: 1 }, orNone: true, none: "every chat", levels: GLOBAL, perConnection: false, name: "Chats held in memory", about: "Chats whose world states are held in memory, the chat read least recently let go first and worked out again from its snapshot when next read.", effect: "start" },
  statesPerChat: { key: "store.statesPerChat", default: STORE_DEFAULTS.statesPerChat, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World states held for each chat", about: "Worked-out world states held for each chat (its newest reply, a running turn, a swipe's point), the least recently read going first.", effect: "start" },
  snapshotsHeld: { key: "store.snapshotsHeld", default: STORE_DEFAULTS.snapshotsHeld, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Snapshots waiting to be stored", about: "Snapshots a reading found worth keeping, held in memory until the next write stores them.", effect: "start" },
  branchHops: { key: "store.maxBranchHops", default: STORE_DEFAULTS.branchHops, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Branches followed back", about: "How many branches back a chat's messages are followed to the turns they share; past it, the comparison and the log say where it stopped.", effect: "start" },
  placeDepth: { key: "store.maxPlaceDepth", default: STORE_DEFAULTS.placeDepth, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Places a place inherits from", about: "How many places up the tree a place takes values from; past it, the tree says the chain stops there.", effect: "start" },
  notable: { key: "store.notable", default: STORE_DEFAULTS.notable, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Names of note in a reflection", about: "Names of note each reflection of the world lists.", effect: "start" },
  kindChain: { key: "engine.maxKindChain", default: STORE_DEFAULTS.kindChain, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Kinds followed up a kind's chain", about: "How many kinds up a kind's chain the engine follows to learn what something is; past it, it says where it stopped.", effect: "start" },
  holderDepth: { key: "engine.maxHolderDepth", default: STORE_DEFAULTS.holderDepth, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Holders followed to find a thing's place", about: "How many holders up the engine looks for the place a thing is at; past it, it says where it stopped.", effect: "start" },
  visitDepth: { key: "places.maxVisitDepth", default: STORE_DEFAULTS.visitDepth, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Places a visit counts for", about: "How many places up the place tree a visit of the point of view counts for; past it, it says where it stopped.", effect: "start" },
  workerFoldAt: { key: "store.workerFoldAt", default: STORE_DEFAULTS.workerFoldAt, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Changes a fold runs over before it goes to a worker", about: "A fold over more changes than this runs on a worker thread, as does one that starts from a stored snapshot or the chat's start (after a restart or an update), so a long chat's fold, fresh or after a swipe flipped on an early message, never stalls another chat's turn, the extension's question or a page.", effect: "start" },
} as const satisfies Record<Exclude<keyof typeof STORE_DEFAULTS, "ownOnly">, object>;

/** The world state's (`worldState`), worked out for each turn's briefing: read at every level. */
export const WORLD_STATE_SETTING_DEFS = {
  budget: { key: "worldState.tokens", default: WORLD_STATE_DEFAULTS.budget, takes: { type: "whole", least: 0 }, perConnection: false, name: "World state: everything else", about: "Tokens of the briefing's world state that everything but the horizon shares.", effect: "turn", row: "World state: everything else" },
  dueAhead: { key: "worldState.dueAheadMinutes", default: WORLD_STATE_DEFAULTS.dueAhead, takes: { type: "whole", least: 0 }, perConnection: false, name: "Time ahead listed as due", about: "Minutes of story time ahead that the world state's due section lists.", effect: "turn" },
} as const satisfies Record<keyof typeof WORLD_STATE_DEFAULTS, object>;

/** The world documents' (`storedWorlds`), read once for every chat: the revisions held in memory. */
export const WORLD_DOCS_SETTING_DEFS = {
  kept: { key: "store.worldsKept", default: WORLD_DOCS_DEFAULTS.kept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World revisions held in memory", about: "Revisions of world documents held in memory once read, the least recently used going first.", effect: "start" },
} as const satisfies Record<keyof typeof WORLD_DOCS_DEFAULTS, object>;

/** The state search's (`StateIndex`), made once for every chat: what the index gives back, and how long a chat is quiet before the index follows it. */
export const STATE_SEARCH_SETTING_DEFS = {
  candidates: { key: "store.searchCandidates", default: STATE_SEARCH_DEFAULTS.candidates, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Candidates a world search takes from its index", about: "Things the state index gives back for each word asked, before the search puts them in order by what the world says of them; a world with a very common word in many names may need more.", effect: "start" },
  settle: { key: "store.searchSettleMs", default: STATE_SEARCH_DEFAULTS.settle, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Quiet time before the state index follows a chat", about: "Milliseconds a chat's writes stay quiet before its search index follows its head: the many writes of one turn are followed once.", effect: "start" },
} as const satisfies Record<keyof typeof STATE_SEARCH_DEFAULTS, object>;

/** Every setting the store reads, as a config file writes it. */
export const STORE_SETTINGS = [...Object.values(STORE_SETTING_DEFS), ...Object.values(WORLD_STATE_SETTING_DEFS), ...Object.values(WORLD_DOCS_SETTING_DEFS), ...Object.values(STATE_SEARCH_SETTING_DEFS)];
