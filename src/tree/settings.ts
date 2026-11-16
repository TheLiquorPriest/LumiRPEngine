// The file tree's settings (plan §5.2, §5.5, Appendix D.1): each of its limits, and which files are in
// force, as a config file writes them. The tree reads its limits at each use, through the one reader of
// the config levels (`src/app/config-read.ts`), so a change holds from the next use on. The files'
// keys (`off:`, `layered:`, `added:`, `instructions:`, `pins:`) are the files layer's: RPH reads them as
// it loads guidance for a turn, and they are declared here so the Settings page shows and writes them
// at each level, in their own shapes.
//
// The tree also says where the config files of a chat's levels are (`levelFiles`, `sharedLevels`), and
// makes the reader the composition hands every area (`treeReader`).

import { statSync } from "node:fs";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { type ConfigRead, diskTextsNow, type LevelFile, type LevelText, readConfig, type SettingsReader } from "../app/config-read";
import { readText } from "../app/disk";
import type { Declared, NumberSettings, Setting } from "../app/setting-list";
import type { ChatFolders } from "./chats";
import { FILE_KEYS } from "./layout";
import { type ChatLocation, levelBase, locate, treeLayers, viewPath } from "./view";

/** Every limit of the tree, each a setting with this default. */
export const TREE_DEFAULTS = Object.freeze({
  /** How many of a chat's newest turn folders are kept whole (plan §5.5, Appendix D.1). */
  turnFolders: 50,
  /** The most hits a find gives when its query names no number: a listing, a glob or a grep, an agent's or RPH's own. */
  findLimit: 200,
  /** Files larger than this many bytes are passed over by a grep. */
  grepBytes: 1024 * 1024,
  /** A grep hit's line is cut to this many UTF-16 code units, and a grep tests no more of a line than that. */
  grepLineChars: 1000,
  /** A grep stops once it has run this many milliseconds, with the hits it found by then: a pattern can take long on long lines. */
  grepMs: 2000,
  /** The most line pairs a difference the Files page shows compares one by one; past it, the changed middle is shown removed, then added whole. */
  diffCells: 4_000_000,
  /** How many note files each of the Storage page's lists gives when the page names no number. */
  notesListed: 20,
  /** The most note files each of those lists gives. */
  notesMost: 200,
  /** The longest id that names a folder: a session's, a turn's. RPE's own are 36 (a UUID), so it takes no less. */
  idChars: 128,
  /** Files and folders one page of the Files page's listing holds when it names no number (plan §5, §14). */
  listPage: 200,
  /** The most one page of that listing holds. */
  listMost: 1000,
  /** Lines of a file the Files page reads when it names none. */
  readLines: 500,
  /** The most suggestions of a chat open at once (plan §5.1): a new one past it is not kept. */
  suggestionsOpenMost: 50,
  /** How many decided suggestions of a chat are kept. */
  suggestionsDecidedKept: 500,
});

export type TreeSettings = { -readonly [K in keyof typeof TREE_DEFAULTS]: number };

/** Each of the tree's limits as a config file writes it, read at every level, at each use. */
export const TREE_SETTING_DEFS = {
  turnFolders: {
    key: "retention.turnFolders",
    default: TREE_DEFAULTS.turnFolders,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "Turn folders kept whole",
    about: "How many of a chat's newest turn folders keep everything; each older one keeps its turn.json, output and transcripts. The next turn's prompt is compared over the folders kept.",
    effect: "use",
    row: "Turn folders kept whole",
  },
  findLimit: { key: "files.findLimit", default: TREE_DEFAULTS.findLimit, takes: { type: "whole", least: 1 }, perConnection: false, name: "Hits a find gives", about: "The most files a listing, a glob or a grep of the agents' files gives when it asks for no number.", effect: "use" },
  grepBytes: { key: "files.grepBytes", default: TREE_DEFAULTS.grepBytes, takes: { type: "whole", least: 0 }, perConnection: false, name: "Largest file a grep reads", about: "Bytes past which a file is passed over by a grep of the agents' files.", effect: "use" },
  grepLineChars: { key: "files.grepLineChars", default: TREE_DEFAULTS.grepLineChars, takes: { type: "whole", least: 1 }, perConnection: false, name: "Line a grep tests", about: "Characters of a line a grep tests and shows of a hit; the rest of the line is cut.", effect: "use" },
  grepMs: { key: "files.grepMs", default: TREE_DEFAULTS.grepMs, takes: { type: "whole", least: 1 }, perConnection: false, name: "Time a grep runs", about: "Milliseconds a grep runs before it stops with the hits it has found.", effect: "use" },
  diffCells: { key: "files.diffCells", default: TREE_DEFAULTS.diffCells, takes: { type: "whole", least: 0 }, perConnection: false, name: "Lines a difference compares", about: "Line pairs the Files page's difference compares one by one; past it, the changed middle is shown removed, then added whole.", effect: "use" },
  notesListed: { key: "notes.listed", default: TREE_DEFAULTS.notesListed, takes: { type: "whole", least: 1 }, perConnection: false, name: "Notes listed", about: "Note files each of the Storage page's lists gives when the page asks for no number.", effect: "use" },
  notesMost: { key: "notes.most", default: TREE_DEFAULTS.notesMost, takes: { type: "whole", least: 1 }, perConnection: false, name: "Most notes listed", about: "The most note files one of the Storage page's lists gives.", effect: "use" },
  idChars: { key: "files.idChars", default: TREE_DEFAULTS.idChars, takes: { type: "whole", least: 36, most: 240 }, perConnection: false, name: "Longest id that names a folder", about: "Characters of a session's or a turn's id, which names its folder; RPE's own ids are 36, and an id is letters, digits, _ and - whatever this says.", effect: "use" },
  listPage: { key: "files.listPage", default: TREE_DEFAULTS.listPage, takes: { type: "whole", least: 1 }, perConnection: false, name: "Entries a Files page lists", about: "Files and folders the Files page lists in one page of a folder, or of a search, when it asks for no number.", effect: "use" },
  listMost: { key: "files.listMost", default: TREE_DEFAULTS.listMost, takes: { type: "whole", least: 1 }, perConnection: false, name: "Most entries a Files page lists", about: "The most files and folders one page of the Files page's listing gives, whatever number it asks for.", effect: "use" },
  readLines: { key: "files.readLines", default: TREE_DEFAULTS.readLines, takes: { type: "whole", least: 1 }, perConnection: false, name: "Lines of a file read at once", about: "Lines of a file the Files page reads in one go when it names none: a long file is read a part at a time, never whole.", effect: "use" },
  suggestionsOpenMost: { key: "suggestions.openMost", default: TREE_DEFAULTS.suggestionsOpenMost, takes: { type: "whole", least: 0 }, perConnection: false, name: "Open suggestions kept", about: "The most suggestions of a chat that wait for the user at once; past it an agent's new suggestion is not kept, and the agent is told so.", effect: "use" },
  suggestionsDecidedKept: { key: "suggestions.decidedKept", default: TREE_DEFAULTS.suggestionsDecidedKept, takes: { type: "whole", least: 0 }, perConnection: false, name: "Decided suggestions kept", about: "How many accepted and dismissed suggestions of a chat are kept, the oldest going after each decision and when the Storage page prunes them.", effect: "use" },
} as const satisfies NumberSettings<keyof TreeSettings>;

/** A name of a file in force as the files layer reads it: an instruction file by its own name, anything else by its folder and name. */
const NAMES = { type: "texts" } as const;

/**
 * Which files are in force (plan §5.2, R-30, R-174), as the files layer reads them at each level's
 * config: RPH reads them as it loads a turn's guidance, so a change is in force from the next turn.
 */
export const FILE_SETTINGS = [
  {
    key: FILE_KEYS.off,
    default: [],
    takes: NAMES,
    perConnection: false,
    joined: true,
    name: "Files switched off",
    about: "Files switched off by name, an instruction file by its own (WORLD), anything else by its folder and name (rules/perceptions-owed); a name in any level's list is off everywhere.",
    effect: "turn",
  },
  { key: FILE_KEYS.layered, default: [], takes: NAMES, perConnection: false, joined: true, name: "Files read at every level", about: "Instruction files read at every level that has one, the farther first, in place of the nearest alone.", effect: "turn" },
  {
    key: FILE_KEYS.added,
    default: {},
    takes: { type: "table", of: NAMES },
    perConnection: false,
    name: "Files added for a kind of turn",
    about: "For each kind of turn (swipe, regenerate, delete), the instruction files added to its briefing beside TURN.md; a nearer level's entry for a kind replaces the farther one's.",
    effect: "turn",
  },
  {
    key: FILE_KEYS.instructions,
    default: [],
    takes: { type: "table", of: NAMES, whole: true },
    perConnection: false,
    joined: true,
    name: "Files added to stacks",
    about: "Files added to the stack of every agent that reads instruction files, or, as a table, to each named agent's alone; every level's list applies.",
    effect: "turn",
  },
  {
    key: FILE_KEYS.pins,
    default: [],
    takes: {
      type: "records",
      fields: [
        { name: "file", takes: { type: "text" }, about: "The file, by its path in the chat's view." },
        { name: "agent", takes: { type: "text" }, about: "The agent it is pinned for, by its definition's name." },
      ],
    },
    perConnection: false,
    joined: true,
    name: "Pinned files",
    about: "Files handed whole to an agent at the start of each of its runs, each a file and the agent it is pinned for; every level's list applies.",
    effect: "turn",
  },
] as const satisfies readonly Setting[];

/** Every setting the tree declares, as a config file writes it. */
export const TREE_SETTINGS: readonly Setting[] = [...Object.values(TREE_SETTING_DEFS), ...FILE_SETTINGS];

/** Where the config files of a chat's levels are on disk, farthest first; a level the chat has no folder for yet is left out. */
export function levelFiles(loc: ChatLocation): LevelFile[] {
  return treeLayers().flatMap((layer) => {
    const base = levelBase(loc, layer.level);
    return layer.config === undefined || base === null ? [] : [{ level: layer.level, file: `${layer.mount}${layer.config}`, disk: join(loc.files, ...base, layer.config) }];
  });
}

/** The config files of the levels every chat shares, the shipped one and the user's own. */
export function sharedLevels(files: string): LevelFile[] {
  return levelFiles({ files, character: null, chat: null });
}

/** The texts of a chat's levels' config files as the agents' view holds them: a file the view refuses (a link) holds nothing. */
export async function levelTexts(loc: ChatLocation): Promise<LevelText[]> {
  const out: LevelText[] = [];
  for (const layer of treeLayers()) {
    if (layer.config === undefined) continue;
    const view = viewPath(layer.level, [layer.config]);
    const lookup = await locate(loc, view);
    if (lookup.ok && lookup.at.disk === null) continue;
    const text = lookup.ok && lookup.at.is === "file" && lookup.at.disk !== null ? await readText(lookup.at.disk) : null;
    out.push({ level: layer.level, file: view, text });
  }
  return out;
}

/** The tree's limits for a chat, as its levels' config files set them over the defaults; `log` hears of what is passed over. */
export async function treeSettingsOf(loc: ChatLocation, log: Log | null = null): Promise<TreeSettings> {
  return readConfig(await levelTexts(loc), log, TREE_SETTINGS).numbers(TREE_SETTING_DEFS);
}

/** What the reader the composition hands every area reads by. */
export interface TreeReaderDeps {
  /** The tree's folder. */
  files(): string;
  /** A chat's folders; null for a chat not placed yet. */
  folders(user: string, chat: string): ChatFolders | null;
  log(): Log;
  /** Every setting of the registry: the short forms a section may hold. */
  known(): readonly Declared[];
}

/** What a file on disk is now, to tell whether it changed since it was read: its inode, size and time of change; "-" where there is none. */
function stampOf(disk: string): string {
  try {
    const s = statSync(disk, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch {
    return "-";
  }
}

/**
 * The one reader of the config levels, over the tree's levels: a chat's as they stand now, or those
 * every chat shares. The shared levels are read for parts that ask at every use, some many times a
 * second, so their read is kept until one of their files changes on disk: a change holds from the
 * next use on, as for every other read.
 */
export function treeReader(deps: TreeReaderDeps): SettingsReader {
  let shared: { stamp: string; read: ConfigRead } | null = null;
  return {
    read: async (user: string, chat: string | null): Promise<ConfigRead> => {
      const folders = chat === null ? null : deps.folders(user, chat);
      return readConfig(await levelTexts({ files: deps.files(), character: folders?.character ?? null, chat: folders?.chat ?? null }), deps.log(), deps.known());
    },
    shared: (): ConfigRead => {
      const files = sharedLevels(deps.files());
      const stamp = files.map((f) => `${f.disk}=${stampOf(f.disk)}`).join("\n");
      if (shared?.stamp !== stamp) shared = { stamp, read: readConfig(diskTextsNow(files), deps.log(), deps.known()) };
      return shared.read;
    },
  };
}
