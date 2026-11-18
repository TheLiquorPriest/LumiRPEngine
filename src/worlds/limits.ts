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
  /** How many of a world's revisions one page of its list gives when the caller names no number. */
  revisionsPage: number;
  /** The most revisions one page of a world's list may ask for. */
  revisionsPageMost: number;
  /** The most things a part of a changes list names; the rest are counted. */
  changesListed: number;
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
  revisionsPage: 10,
  revisionsPageMost: 50,
  changesListed: 25,
  bodyBytes: 4 * 1024 * 1024,
});

const GLOBAL = ["shipped", "global"] as const;

export const WORLD_SETTING_DEFS = {
  patchOps: { key: "worlds.maxPatchOps", default: WORLD_LIMIT_DEFAULTS.patchOps, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Operations in one world patch", about: "The most operations one patch of a world's draft may carry; a longer one is refused naming this setting.", effect: "use" },
  patchBytes: { key: "worlds.maxPatchChars", default: WORLD_LIMIT_DEFAULTS.patchBytes, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Size one world patch may bring in", about: "The most one patch of a world's draft may bring in, in characters of JSON: the values it adds or replaces and what it copies.", effect: "use" },
  depth: { key: "worlds.maxDepth", default: WORLD_LIMIT_DEFAULTS.depth, takes: { type: "whole", least: 1 }, advice: [{ below: 4, says: "A world document nests at least four deep: below it every write to a world is refused." }], levels: GLOBAL, perConnection: false, name: "Depth of a world document", about: "How deep a world document may nest; a write that would nest it deeper is refused.", effect: "use" },
  noteChars: { key: "worlds.noteChars", default: WORLD_LIMIT_DEFAULTS.noteChars, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Characters of a commit note", about: "The longest note a commit keeps in a world's history, cut to it.", effect: "use" },
  revisionsHeld: { key: "worlds.revisionsHeld", default: WORLD_LIMIT_DEFAULTS.revisionsHeld, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "World revisions the editor holds in memory", about: "Revisions of worlds the editor keeps loaded across requests, the least recently used going first; a revision is several MB once read.", effect: "use" },
  revisionsPage: { key: "worlds.revisionsPage", default: WORLD_LIMIT_DEFAULTS.revisionsPage, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Revisions on a page of a world's history", about: "How many of a world's revisions one page of its history gives when you ask for no number; each one is read beside the one before it to say how much it changed, so a longer page takes longer.", effect: "use" },
  revisionsPageMost: { key: "worlds.maxRevisionsPage", default: WORLD_LIMIT_DEFAULTS.revisionsPageMost, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Most revisions on a page of a world's history", about: "The most revisions one page of a world's history may ask for.", effect: "use" },
  changesListed: { key: "worlds.maxChangesListed", default: WORLD_LIMIT_DEFAULTS.changesListed, takes: { type: "whole", least: 0 }, levels: GLOBAL, perConnection: false, name: "Things named for each part of a change", about: "The most things the list of what changed between two versions of a world names under each part (the people, the places, the rules…); the rest are counted, not named. 0 names none.", effect: "use" },
  bodyBytes: { key: "worlds.maxBodyBytes", default: WORLD_LIMIT_DEFAULTS.bodyBytes, takes: { type: "whole", least: 1 }, advice: [{ below: 1024, says: "Under 1 KiB almost every world file and draft written whole is refused." }], levels: GLOBAL, perConnection: false, name: "Largest body a worlds route takes", about: "The most bytes a request of Build's worlds routes may carry (a world file imported, a draft written whole); a larger one is refused naming this setting.", effect: "start" },
} as const satisfies NumberSettings<keyof WorldLimits>;

/** Every setting the worlds area reads, as a config file writes it. */
export const WORLD_SETTINGS: readonly Setting[] = Object.values(WORLD_SETTING_DEFS);
