// The file tree's settings (plan §5.5, Appendix D.1): each of its limits, with its default, as a config
// file writes it. The tree reads them itself, as the turn lane reads its own: the config files of the
// chat's levels read farthest first and merged mapping by mapping, the nearer level's value over the
// farther one's, at each use, so a change holds from the next use on. A file that does not read as
// YAML says nothing here, as RPH passes it over and reports it; a value a setting does not take leaves
// its default.

import { readText } from "../app/disk";
import { isMapping, type Mapping, mergedConfig, type NumberSettings, numbersIn, type SettingDef } from "../app/setting-list";
import { yamlMapping } from "../app/yaml";
import { type ChatLocation, locate, treeLayers, viewPath } from "./view";

/** Every limit of the tree, each a setting with this default. */
export const TREE_DEFAULTS = Object.freeze({
  /** How many of a chat's newest turn folders are kept whole (plan §5.5, Appendix D.1). */
  turnFolders: 50,
  /** The most hits a find gives when its query names no number: a listing, a glob or a grep, an agent's or RPH's own. */
  findLimit: 200,
  /** Files larger than this many bytes are passed over by a grep. */
  grepBytes: 1024 * 1024,
  /** A grep hit's line is cut to this many UTF-16 code units. */
  grepLineChars: 1000,
  /** The most line pairs a difference the Files page shows compares one by one; past it, the changed middle is shown removed, then added whole. */
  diffCells: 4_000_000,
  /** How many note files each of the Storage page's lists gives when the page names no number. */
  notesListed: 20,
  /** The most note files each of those lists gives. */
  notesMost: 200,
});

export type TreeSettings = { -readonly [K in keyof typeof TREE_DEFAULTS]: number };

/** Each of the tree's settings as a config file writes it, read at every level. */
export const TREE_SETTING_DEFS = {
  turnFolders: { key: "retention.turnFolders", default: TREE_DEFAULTS.turnFolders, takes: { type: "whole", least: 0 }, perConnection: false },
  findLimit: { key: "files.findLimit", default: TREE_DEFAULTS.findLimit, takes: { type: "whole", least: 1 }, perConnection: false },
  grepBytes: { key: "files.grepBytes", default: TREE_DEFAULTS.grepBytes, takes: { type: "whole", least: 0 }, perConnection: false },
  grepLineChars: { key: "files.grepLineChars", default: TREE_DEFAULTS.grepLineChars, takes: { type: "whole", least: 1 }, perConnection: false },
  diffCells: { key: "files.diffCells", default: TREE_DEFAULTS.diffCells, takes: { type: "whole", least: 0 }, perConnection: false },
  notesListed: { key: "notes.listed", default: TREE_DEFAULTS.notesListed, takes: { type: "whole", least: 1 }, perConnection: false },
  notesMost: { key: "notes.most", default: TREE_DEFAULTS.notesMost, takes: { type: "whole", least: 1 }, perConnection: false },
} as const satisfies NumberSettings<keyof TreeSettings>;

/** Every setting the tree reads, as a config file writes it. */
export const TREE_SETTINGS: readonly SettingDef[] = Object.values(TREE_SETTING_DEFS);

/** The config files of a chat's levels, merged; for a chat RPE has not placed, those of the levels it shares with every chat. */
async function configOf(loc: ChatLocation): Promise<Mapping> {
  let config: Mapping = {};
  for (const layer of treeLayers()) {
    if (layer.config === undefined) continue;
    const view = viewPath(layer.level, [layer.config]);
    const lookup = await locate(loc, view);
    if (!lookup.ok || lookup.at.is !== "file" || lookup.at.disk === null) continue;
    const text = await readText(lookup.at.disk);
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = yamlMapping(text, view);
    } catch {
      continue;
    }
    if (isMapping(doc)) config = mergedConfig(config, doc);
  }
  return config;
}

/** The tree's settings for a chat, as its levels' config files set them over the defaults. */
export async function treeSettingsOf(loc: ChatLocation): Promise<TreeSettings> {
  return numbersIn(await configOf(loc), TREE_SETTING_DEFS);
}
