// The world store's limits (plan §14, PlanChatUI-B1 item 4): each was a constant of today's world store, and each is a
// setting now with today's value as its default, read from the global level (`RPE-global.yml`) at each use.

import type { NumberSettings, Setting } from "../app/setting-list";

/** What bounds a write to a world: the patch, the document it leaves, the note a commit keeps, the revisions held in memory, and the body a worlds route takes. */
export interface WorldLimits {
  /** The most operations one patch may carry. */
  patchOps: number;
  /** The most one patch may bring in, in characters of JSON: the values it adds or replaces and what it copies. */
  patchBytes: number;
  /** How deep a world document may nest. */
  depth: number;
  /** The longest commit note the history keeps, in characters. */
  noteChars: number;
  /** Loaded revisions kept across chats, least recently used first. */
  revisionsHeld: number;
  /** The largest body a worlds route takes. */
  bodyBytes: number;
}

/** Today's values: the host's 4 MiB frame is the most one request can carry; 64 levels sits well inside the 128 `hashJson` hashes through; a revision is several MB once parsed, so few are kept. */
export const WORLD_LIMIT_DEFAULTS: Readonly<WorldLimits> = Object.freeze({
  patchOps: 500,
  patchBytes: 4 * 1024 * 1024,
  depth: 64,
  noteChars: 200,
  revisionsHeld: 8,
  bodyBytes: 4 * 1024 * 1024,
});

const GLOBAL = ["shipped", "global"] as const;

export const WORLD_SETTING_DEFS = {
  patchOps: { key: "worlds.patchOps", default: WORLD_LIMIT_DEFAULTS.patchOps, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Operations in one world patch", about: "The most operations one patch of a world's draft may carry; a longer one is refused naming this setting.", effect: "use" },
  patchBytes: { key: "worlds.patchBytes", default: WORLD_LIMIT_DEFAULTS.patchBytes, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Size one world patch may bring in", about: "The most one patch of a world's draft may bring in, in characters of JSON: the values it adds or replaces and what it copies.", effect: "use" },
  depth: { key: "worlds.depth", default: WORLD_LIMIT_DEFAULTS.depth, takes: { type: "whole", least: 4 }, levels: GLOBAL, perConnection: false, name: "Depth of a world document", about: "How deep a world document may nest; a write that would nest it deeper is refused.", effect: "use" },
  noteChars: { key: "worlds.noteChars", default: WORLD_LIMIT_DEFAULTS.noteChars, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Characters of a commit note", about: "The longest note a commit keeps in a world's history, cut to it.", effect: "use" },
  revisionsHeld: { key: "worlds.revisionsHeld", default: WORLD_LIMIT_DEFAULTS.revisionsHeld, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World revisions the editor holds in memory", about: "Revisions of worlds the editor keeps loaded across requests, the least recently used going first; a revision is several MB once read.", effect: "use" },
  bodyBytes: { key: "worlds.bodyBytes", default: WORLD_LIMIT_DEFAULTS.bodyBytes, takes: { type: "whole", least: 1024 }, levels: GLOBAL, perConnection: false, name: "Largest body a worlds route takes", about: "The most bytes a request of Build's worlds routes may carry (a world file imported, a draft written whole); a larger one is refused naming this setting.", effect: "start" },
} as const satisfies NumberSettings<keyof WorldLimits>;

/** Every setting the worlds area reads, as a config file writes it. */
export const WORLD_SETTINGS: readonly Setting[] = Object.values(WORLD_SETTING_DEFS);
