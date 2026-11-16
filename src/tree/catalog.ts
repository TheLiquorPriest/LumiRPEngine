// What the Files page shows of the tree (plan §5.2, §5.4, §14): every file at every level of a chat's
// view, with the name RPH loads it by, whether it is the one taken, the nearer file taken in its place,
// and whether a config's `off:` list switches its name off. The names follow RPH's own (`itemKey` and
// `writtenKey` in RPH's `files/tree.ts`, which its package does not export): an instruction file by its
// own name, anything else by its kind and name. RPH stays the one that loads guidance; this shows the
// files as it will find them.

import { stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import type { FileKind, GuidanceKind, Layer, LayerLevel } from "rp-harness/contract";
import { readText } from "../app/disk";
import { yamlMapping } from "../app/yaml";
import { type DefaultStanding, type DefaultUpdate, updatesSince } from "./defaults";
import { walk } from "./files";
import { CHARACTER_FOLDERS, FILE_KEYS } from "./layout";
import { type ChatLocation, kindOf, locate, treeLayers, viewPath } from "./view";

/** One file of the tree as the Files page lists it. */
export interface TreeFileEntry {
  /** Its path in the chat's view, as the file routes take it: `@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder. */
  path: string;
  level: LayerLevel;
  kind: FileKind;
  bytes: number;
  /** The name RPH loads it by, and an `off:` list names it by (`WORLD`, `rules/consent`); null for a file RPH does not load by its name. */
  item: string | null;
  /** Whether RPH takes it: a named file when it is the nearest of its name (each level's, for a name in a `layered:` list), not switched off and not an example; any other file as it is. */
  applies: boolean;
  /** The nearer file of the same name taken in its place; null when none is. */
  replacedBy: string | null;
  /** Its name is in a config's `off:` list, which switches it off at every level. */
  off: boolean;
  /** The levels whose config's `off:` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing. Empty when it is not off. */
  offIn: LayerLevel[];
  /** Whether the user may write it where it is: never a shipped file or a generated one. */
  editable: boolean;
  /** The shipped file of the same name, for a file of another level that has one; null otherwise. */
  shipped: string | null;
  /** For a file of the user's in place of a shipped one: when the latest update that changed that shipped file did so, if it did since this file was last written; null otherwise. */
  defaultChanged: number | null;
  /** For a file of the user's in place of a default an update has since taken away: when the update that removed it ran, if it did since this file was last written. Absent or null otherwise. */
  defaultRemoved?: number | null;
}

/** What the levels' config files say of the names in force (RPH's `off:` and `layered:`, `CONFIG_KEYS`): each name switched off, with the levels whose list names it. */
export interface NamesInForce {
  off: Map<string, LayerLevel[]>;
  layered: Set<string>;
}

/** The config keys read here, as RPH reads them. */
export const OFF_KEY = FILE_KEYS.off;
const LAYERED_KEY = FILE_KEYS.layered;

const KINDS: readonly GuidanceKind[] = ["agents", "skills", "rules", "hooks", "prompts", "tools"];

/** The folder of the rules that are never in force (RPH: "Under `<rules>/examples/` a rule is listed and never in force"). */
const EXAMPLES = "examples";

/** A name list as RPH reads one: nothing, one name, or a list of names; undefined for anything else. */
export function nameList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.map((v: string) => v.trim()).filter((v) => v !== "");
  return undefined;
}

/** The kind a folder's name is at any level, or the kind's own word. */
function kindOfFolder(name: string, layers: readonly Layer[]): GuidanceKind | undefined {
  const word = KINDS.find((k) => k === name);
  if (word !== undefined) return word;
  for (const layer of layers) for (const kind of KINDS) if (layer.folders[kind] === name) return kind;
  return undefined;
}

/** A name as RPH reads it from an `off:` entry, however it is written: with a mount, a level's own folder name, `.md` or `/SKILL.md`. */
export function writtenItem(entry: string, layers: readonly Layer[]): string {
  let s = entry.trim().replace(/^(?:\.\/|\/)+/, "");
  const mounted = layers.find((l) => l.mount !== "" && s.startsWith(l.mount));
  if (mounted !== undefined) s = s.slice(mounted.mount.length);
  if (s.endsWith("/SKILL.md")) s = s.slice(0, -"/SKILL.md".length);
  else if (s.endsWith(".md")) s = s.slice(0, -".md".length);
  const slash = s.indexOf("/");
  if (slash > 0) {
    const kind = kindOfFolder(s.slice(0, slash), layers);
    if (kind !== undefined) return `${kind}/${s.slice(slash + 1)}`;
  }
  return s;
}

/** The kind of guidance whose folder at `layer` is `folder`. */
export function kindAt(layer: Layer, folder: string | undefined): GuidanceKind | undefined {
  return folder === undefined ? undefined : KINDS.find((k) => layer.folders[k] === folder);
}

function markdownName(name: string | undefined): string | undefined {
  return name !== undefined && name.endsWith(".md") && name.length > 3 ? name.slice(0, -3) : undefined;
}

/** The name RPH loads a file of `layer` by, from its segments below the level's folder; null for a file it does not load by name. */
export function itemOf(layer: Layer, rest: readonly string[], kind: FileKind): string | null {
  if (kind !== "yours") return null;
  if (rest.length === 1) return markdownName(rest[0]) ?? null;
  const folder = kindAt(layer, rest[0]);
  if (folder === undefined || folder === "hooks") return null;
  if (folder === "skills") return rest.length === 3 && rest[2] === "SKILL.md" ? `skills/${rest[1]}` : null;
  if (folder === "rules" && rest.length === 3 && rest[1] === EXAMPLES) {
    const name = markdownName(rest[2]);
    return name === undefined ? null : `rules/${EXAMPLES}/${name}`;
  }
  const name = rest.length === 2 ? markdownName(rest[1]) : undefined;
  return name === undefined ? null : `${folder}/${name}`;
}

/** Whether the user may write a file of a level where it is: never at the shipped level or in a generated place; at a character's level, its own files and its guidance folders, never its chats. */
export function userMayWrite(level: LayerLevel, rest: readonly string[], kind: FileKind): boolean {
  if (level === "shipped" || kind === "generated" || rest.length === 0) return false;
  if (level !== "character") return true;
  return rest.length === 1 || Object.values(CHARACTER_FOLDERS).some((f) => f === rest[0]);
}

/** The text of a level's config file, as the view finds it; null when there is none. */
export async function configText(loc: ChatLocation, layer: Layer): Promise<string | null> {
  if (layer.config === undefined) return null;
  const lookup = await locate(loc, viewPath(layer.level, [layer.config]));
  if (!lookup.ok || lookup.at.is !== "file" || lookup.at.disk === null) return null;
  return await readText(lookup.at.disk);
}

/** The names switched off, with the levels that switch each off, and the names layered, from every level's config. A config that does not read as YAML, or a key that is not a list of names, says nothing here; RPH reports it. */
export async function namesInForce(loc: ChatLocation, layers: readonly Layer[] = treeLayers()): Promise<NamesInForce> {
  const names: NamesInForce = { off: new Map(), layered: new Set() };
  for (const layer of layers) {
    const text = await configText(loc, layer);
    if (text === null) continue;
    let doc: Record<string, unknown>;
    try {
      doc = yamlMapping(text, viewPath(layer.level, [layer.config ?? ""]));
    } catch {
      continue;
    }
    for (const name of nameList(doc[OFF_KEY]) ?? []) {
      const item = writtenItem(name, layers);
      const levels = names.off.get(item) ?? [];
      if (!levels.includes(layer.level)) names.off.set(item, [...levels, layer.level]);
    }
    for (const name of nameList(doc[LAYERED_KEY]) ?? []) names.layered.add(writtenItem(name, layers));
  }
  return names;
}

/** The key of a file the user wrote, as `tree_written` keeps it: its place below the tree's folder, "/" between names. */
export function writtenKey(files: string, disk: string): string {
  return relative(files, disk).split(sep).join("/");
}

/**
 * Where a file found at one level goes at another, by what it is there: a level's config is the other level's config, a file in a
 * folder of guidance goes in that level's folder of the same kind, a file at a level's top goes at the other's top. Anything else is
 * its own level's alone. Null: the other level has no such place.
 */
export function placeAt(from: LayerLevel, rest: readonly string[], to: LayerLevel): string[] | null {
  if (from === to) return [...rest];
  const layers = treeLayers();
  const source = layers.find((l) => l.level === from);
  const target = layers.find((l) => l.level === to);
  if (source === undefined || target === undefined) return null;
  const [first, ...below] = rest;
  if (rest.length === 1 && first === source.config) return target.config === undefined ? null : [target.config];
  const kind = kindAt(source, first);
  if (kind !== undefined && below.length > 0) {
    const folder = target.folders[kind];
    return folder === undefined ? null : [folder, ...below];
  }
  return rest.length === 1 ? [...rest] : null;
}

/**
 * Every file of the chat's view, level by level (shipped, global, character, chat), each in the order of its path. `standing`: what
 * updates changed of the shipped files and when the user wrote their own (`defaultStanding`).
 */
export async function treeListing(loc: ChatLocation, standing: DefaultStanding = { updates: new Map(), written: new Map() }): Promise<TreeFileEntry[]> {
  const layers = treeLayers();
  const names = await namesInForce(loc, layers);
  const found: TreeFileEntry[] = [];
  const origin = new Map<TreeFileEntry, { changed: number; key: string; rest: string[] }>();
  for (const layer of layers) {
    const top = await locate(loc, layer.mount);
    if (!top.ok || top.at.is !== "folder" || top.at.disk === null) continue;
    for await (const e of walk(loc, layer.level, [], top.at.disk, Number.POSITIVE_INFINITY)) {
      if (e.folder) continue;
      const kind = kindOf(layer.level, e.rest);
      const item = itemOf(layer, e.rest, kind);
      const offIn = item === null ? [] : (names.off.get(item) ?? []);
      const info = await stat(e.disk);
      const entry: TreeFileEntry = { path: viewPath(layer.level, e.rest), level: layer.level, kind, bytes: info.size, item, applies: true, replacedBy: null, off: offIn.length > 0, offIn, editable: userMayWrite(layer.level, e.rest, kind), shipped: null, defaultChanged: null, defaultRemoved: null };
      found.push(entry);
      origin.set(entry, { changed: info.mtimeMs, key: writtenKey(loc.files, e.disk), rest: e.rest });
    }
  }
  // The nearest file of a name is the one taken; the levels were walked farthest first, the shipped one first of all.
  const nearest = new Map<string, TreeFileEntry>();
  const shipped = new Map<string, TreeFileEntry>();
  for (const f of found) {
    if (f.item === null) continue;
    nearest.set(f.item, f);
    if (f.level === "shipped") shipped.set(f.item, f);
  }
  /** The updates since the file was last written that touched the shipped file at `path`. */
  const since = (f: TreeFileEntry, path: string): readonly DefaultUpdate[] => {
    const at = origin.get(f);
    const updates = standing.updates.get(path);
    return at === undefined || updates === undefined ? [] : updatesSince(updates, standing.written.get(at.key), at.changed);
  };
  for (const f of found) {
    if (f.item === null) continue;
    const layered = !f.item.includes("/") && names.layered.has(f.item);
    const taken = nearest.get(f.item);
    f.replacedBy = layered || taken === undefined || taken === f ? null : taken.path;
    f.applies = !f.off && f.replacedBy === null && !f.item.startsWith(`rules/${EXAMPLES}/`);
    if (f.level === "shipped") continue;
    const theirs = shipped.get(f.item);
    if (theirs !== undefined) {
      f.shipped = theirs.path;
      f.defaultChanged = since(f, theirs.path).findLast((u) => !u.removed)?.at ?? null;
      continue;
    }
    // A file of his that replaces a default an update has taken away since he wrote it: the default is not there to name, but the place it was is.
    const rest = origin.get(f)?.rest;
    const was = rest === undefined ? null : placeAt(f.level, rest, "shipped");
    if (was !== null) f.defaultRemoved = since(f, viewPath("shipped", was)).findLast((u) => u.removed)?.at ?? null;
  }
  return found;
}
