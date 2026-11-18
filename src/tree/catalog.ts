// What the Files page shows of the tree (plan §5.2, §5.4, §14): every file at every level of a chat's
// view, with the name RPH loads it by, whether it is the one taken, the nearer file taken in its place,
// and whether a config's `stack.off` list switches its name off. The names follow RPH's own (`itemKey` and
// `writtenKey` in RPH's `files/tree.ts`, which its package does not export): an instruction file by its
// own name, anything else by its kind and name. RPH stays the one that loads guidance; this shows the
// files as it will find them.

import { stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import type { FileKind, GuidanceKind, HookEvent, Layer, LayerLevel, SwitchState } from "rp-harness/contract";
import { hookEvent } from "../app";
import { readText } from "../app/disk";
import { isRecord } from "../shared/json";
import { yamlMapping } from "../app/yaml";
import { type DefaultStanding, type DefaultUpdate, updatesSince } from "./defaults";
import { walk } from "./files";
import { CHARACTER_FOLDERS, FILE_KEYS } from "./layout";
import { type ChatLocation, kindOf, levelBase, locate, treeLayers, viewPath } from "./view";

/** One file of the tree as the Files page lists it. */
export interface TreeFileEntry {
  /** Its path in the chat's view, as the file routes take it: `@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder. */
  path: string;
  level: LayerLevel;
  kind: FileKind;
  bytes: number;
  /** The name RPH loads it by, and a `stack.off` list names it by (`WORLD`, `rules/consent`); null for a file RPH does not load by its name. */
  item: string | null;
  /** Whether RPH takes it: a named file when it is the nearest of its name (each level's, for a name in a `stack.layered` list), not switched off and not an example; any other file as it is. */
  applies: boolean;
  /** The nearer file of the same name taken in its place; null when none is. */
  replacedBy: string | null;
  /** Its name is in a config's `stack.off` list, which switches it off at every level. */
  off: boolean;
  /** The levels whose config's `stack.off` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing. Empty when it is not off. */
  offIn: LayerLevel[];
  /** Whether the user may write it where it is: never a shipped file or a generated one. */
  editable: boolean;
  /** The shipped file of the same name, for a file of another level that has one; null otherwise. */
  shipped: string | null;
  /** For a file of the user's in place of a shipped one: when the latest update that changed that shipped file did so, if it did since this file was last written; null otherwise. */
  defaultChanged: number | null;
  /** For a file of the user's in place of a default an update has since taken away: when the update that removed it ran, if it did since this file was last written. Absent or null otherwise. */
  defaultRemoved?: number | null;
  /** The agents it is pinned for, handed it whole at the start of each of their runs, and the level whose config says so. Empty for a file pinned for none. */
  pinnedFor?: PinnedFor[];
  /** Whether it is a level's config file (`RPE-global.yml`, a chat's `RPE.yml`): the Settings page edits it too. */
  isConfig?: boolean;
  /** The levels where a file of its kind and name has a place that the user may write, so "save as" offers only those. */
  placeable?: LayerLevel[];
  /** For a generated file, the page where what it shows is edited, if one is; null otherwise. */
  editedOn?: string | null;
  /** Why RPH leaves it out of force, in RPH's own terms, though it is the nearest of its name and not switched off: its `needs:` is not in force, or its header does not parse; null when nothing does. Absent where RPH was not asked. */
  held?: "needs" | "broken" | null;
  /** What RPH found wrong with it, in its own words, line by line. Absent where RPH was not asked. */
  problems?: string[];
  /** The agents whose stacks it joins (a file `stack.instructions` names, or one they read), by definition name. Absent where RPH was not asked. */
  joins?: string[];
  /** For a level's hooks file (`hooks.yml` in its hooks folder): each hook it names, as RPH's hook reader takes it. Absent for any other file. */
  hooks?: TreeHook[];
}

/**
 * A hook as a hooks file names it (plan §5.4 "Hooks"): its name, which a `stack.off` list names as `hooks/<name>`; the moment it runs at and
 * the command line, as written; switched off, and by which levels; the nearer level's hooks file that names it in its place; whether RPH
 * runs it; and, where RPH lists it, whether its command is switched on.
 */
export interface TreeHook {
  name: string;
  on: HookEvent;
  runs: string;
  off: boolean;
  offIn: LayerLevel[];
  replacedBy: string | null;
  applies: boolean;
  state?: SwitchState;
}

/** The file a level's hooks are written in, inside its hooks folder, as RPH reads it. */
export const HOOKS_FILE = "hooks.yml";
/** Every moment a hook runs at, as a hooks file writes it (RPH's `HookEvent`, held to it where the live trace declares it). */
const HOOK_MOMENTS = hookEvent.values;

/** The hooks a hooks file names, as RPH reads them: under a moment, each with its name and command; none where it does not read (RPH says why). */
export function hooksNamed(text: string): { name: string; on: HookEvent; runs: string }[] {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const doc = parsed;
  return HOOK_MOMENTS.flatMap((on) => {
    const list = doc[on];
    return Array.isArray(list) ? list.flatMap((h: unknown) => (isRecord(h) && typeof h.name === "string" && h.name.trim() !== "" && typeof h.command === "string" && h.command.trim() !== "" ? [{ name: h.name.trim(), on, runs: h.command.trim() }] : [])) : [];
  });
}

/** What the levels' config files say of the names in force (RPH's `stack.off` and `stack.layered`, `CONFIG_KEYS`): each name switched off, with the levels whose list names it. */
export interface NamesInForce {
  off: Map<string, LayerLevel[]>;
  layered: Set<string>;
  /** The files pinned for agents (RPH's `stack.pins`), each at the level whose config says so; every level's list applies. */
  pins: PinOf[];
}

/** A pin as a level's config says it: a file, by its path in the chat's view, and the agent it is pinned for, by its definition's name. */
export interface Pin {
  file: string;
  agent: string;
}

/** A pin and the level whose config holds it. */
export type PinOf = Pin & { level: LayerLevel };

/** The agents a file is pinned for, and at which level each pin is written. */
export interface PinnedFor {
  agent: string;
  level: LayerLevel;
}

/** The config keys read here, as RPH reads them, dotted as a config writes them. */
export const OFF_KEY = FILE_KEYS.off;
const LAYERED_KEY = FILE_KEYS.layered;
export const PINS_KEY = FILE_KEYS.pins;

/** What a config holds at a dotted key (`stack.off`); undefined where it holds nothing there, or a part on the way is no mapping. */
export function atKey(doc: Record<string, unknown>, key: string): unknown {
  let at: unknown = doc;
  for (const part of key.split(".")) {
    if (!isRecord(at)) return undefined;
    at = at[part];
  }
  return at;
}

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

/** The records of a `stack.pins` list, each with a file and an agent; nothing for none; undefined for anything else. */
export function pinRecords(value: unknown): Pin[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const pins: Pin[] = [];
  for (const v of value as unknown[]) {
    if (!isRecord(v) || typeof v.file !== "string" || typeof v.agent !== "string") return undefined;
    pins.push({ file: v.file, agent: v.agent });
  }
  return pins;
}

/** A pinned file's path as the view writes it: without a leading `./` or `/`. */
export function pinPath(file: string): string {
  return file.trim().replace(/^(?:\.\/|\/)+/, "");
}

/** The kind a folder's name is at any level, or the kind's own word. */
function kindOfFolder(name: string, layers: readonly Layer[]): GuidanceKind | undefined {
  const word = KINDS.find((k) => k === name);
  if (word !== undefined) return word;
  for (const layer of layers) for (const kind of KINDS) if (layer.folders[kind] === name) return kind;
  return undefined;
}

/** A name as RPH reads it from a `stack.off` entry, however it is written: with a mount, a level's own folder name, `.md` or `/SKILL.md`. */
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
  const names: NamesInForce = { off: new Map(), layered: new Set(), pins: [] };
  for (const layer of layers) {
    const text = await configText(loc, layer);
    if (text === null) continue;
    let doc: Record<string, unknown>;
    try {
      doc = yamlMapping(text, viewPath(layer.level, [layer.config ?? ""]));
    } catch {
      continue;
    }
    for (const name of nameList(atKey(doc, OFF_KEY)) ?? []) {
      const item = writtenItem(name, layers);
      const levels = names.off.get(item) ?? [];
      if (!levels.includes(layer.level)) names.off.set(item, [...levels, layer.level]);
    }
    for (const name of nameList(atKey(doc, LAYERED_KEY)) ?? []) names.layered.add(writtenItem(name, layers));
    for (const pin of pinRecords(atKey(doc, PINS_KEY)) ?? []) names.pins.push({ file: pinPath(pin.file), agent: pin.agent.trim(), level: layer.level });
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

/** The levels a name's files are looked for at, the farthest first: the nearest file of a name is the one taken. */
const FARTHEST_FIRST: readonly LayerLevel[] = ["shipped", "global", "character", "chat"];

/** Where a generated file at the top of a chat's folder is edited, if anywhere: the page that makes it again from what he edits there. */
const EDITED_ON: Readonly<Record<string, string>> = { "PROMPT-MAP.md": "Prompt" };

/** What the entries of one chat's view are made against: its levels, the config's names in force, and what updates changed of the defaults. */
export interface ListingContext {
  loc: ChatLocation;
  layers: Layer[];
  names: NamesInForce;
  standing: DefaultStanding;
}

export async function listingContext(loc: ChatLocation, standing: DefaultStanding = { updates: new Map(), written: new Map() }): Promise<ListingContext> {
  const layers = treeLayers();
  return { loc, layers, names: await namesInForce(loc, layers), standing };
}

/**
 * The entry of one file at one level: what it is, whether RPH takes it, the file of its name at each other level (found by where the
 * name goes there, `placeAt`) and so the one taken in its place, what an update changed of its default or took away since the user
 * wrote it, and the levels his save-as may name. No other file of the view is read, so a page of a folder costs what it holds.
 */
export async function entryAt(ctx: ListingContext, level: LayerLevel, rest: readonly string[], disk: string): Promise<TreeFileEntry> {
  const layer = ctx.layers.find((l) => l.level === level);
  if (layer === undefined) throw new Error(`The tree has no ${level} level.`);
  const kind = kindOf(level, rest);
  const item = itemOf(layer, rest, kind);
  const offIn = item === null ? [] : (ctx.names.off.get(item) ?? []);
  const info = await stat(disk);
  const place = (to: LayerLevel): string[] | null => (levelBase(ctx.loc, to) === null ? null : placeAt(level, rest, to));
  const placeable = (["global", "character", "chat"] as const).filter((to) => {
    const at = place(to);
    return at !== null && userMayWrite(to, at, kindOf(to, at));
  });
  const entry: TreeFileEntry = {
    path: viewPath(level, rest),
    level,
    kind,
    bytes: info.size,
    item,
    applies: true,
    replacedBy: null,
    off: offIn.length > 0,
    offIn,
    editable: userMayWrite(level, rest, kind),
    shipped: null,
    defaultChanged: null,
    defaultRemoved: null,
    pinnedFor: ctx.names.pins.filter((p) => p.file === viewPath(level, rest)).map(({ agent, level: at }) => ({ agent, level: at })),
    isConfig: rest.length === 1 && rest[0] === layer.config,
    placeable,
    editedOn: kind === "generated" && level === "chat" ? (EDITED_ON[rest.join("/")] ?? null) : null,
  };
  // A level's hooks file is no one name: it names its hooks, each switched off and replaced on its own.
  if (rest.length === 2 && rest[1] === HOOKS_FILE && kindAt(layer, rest[0]) === "hooks") entry.hooks = await hooksAt(ctx, level, disk, place);
  if (item === null) return entry;
  // The file of this name at each level, the farthest first; the nearest is the one taken.
  const same = await filesOfName(ctx, level, rest, item, entry.path);
  const layered = !item.includes("/") && ctx.names.layered.has(item);
  const taken = FARTHEST_FIRST.findLast((l) => same.has(l));
  const takenPath = taken === undefined ? undefined : same.get(taken);
  entry.replacedBy = layered || takenPath === undefined || takenPath === entry.path ? null : takenPath;
  entry.applies = !entry.off && entry.replacedBy === null && !item.startsWith(`rules/${EXAMPLES}/`);
  if (level === "shipped") return entry;
  /** The updates since the file was last written that touched the shipped file at `path`. */
  const since = (path: string): readonly DefaultUpdate[] => {
    const updates = ctx.standing.updates.get(path);
    return updates === undefined ? [] : updatesSince(updates, ctx.standing.written.get(writtenKey(ctx.loc.files, disk)), info.mtimeMs);
  };
  const theirs = same.get("shipped");
  if (theirs !== undefined) {
    entry.shipped = theirs;
    entry.defaultChanged = since(theirs).findLast((u) => !u.removed)?.at ?? null;
    return entry;
  }
  // A file of his that replaces a default an update has taken away since he wrote it: the default is not there to name, but the place it was is.
  const was = placeAt(level, rest, "shipped");
  if (was !== null) entry.defaultRemoved = since(viewPath("shipped", was)).findLast((u) => u.removed)?.at ?? null;
  return entry;
}

/** The file of the name `item` at each level that has one, found by where the name of `rest` at `level` goes there (`placeAt`); `own`: the path at `level` itself, where it is known to be a file of that name. */
async function filesOfName(ctx: ListingContext, level: LayerLevel, rest: readonly string[], item: string, own: string | null): Promise<Map<LayerLevel, string>> {
  const same = new Map<LayerLevel, string>(own === null ? [] : [[level, own]]);
  for (const other of FARTHEST_FIRST) {
    const at = (other === level && own !== null) || levelBase(ctx.loc, other) === null ? null : placeAt(level, rest, other);
    if (at === null) continue;
    const lookup = await locate(ctx.loc, viewPath(other, at));
    const otherLayer = ctx.layers.find((l) => l.level === other);
    if (lookup.ok && lookup.at.is === "file" && otherLayer !== undefined && itemOf(otherLayer, lookup.at.rest, lookup.at.kind) === item) same.set(other, lookup.at.path);
  }
  return same;
}

/**
 * The file a chat's agents are given by the name of the file at `level` and `rest`, whether or not that file is there: the nearest
 * level's file of that name (of a name in a `stack.layered` list, whose every level's is given, the nearest too). Null where the path is
 * no place of a file RPH loads by its name, the name is switched off or an example's, or no level has a file of it.
 */
export async function inForceOf(ctx: ListingContext, level: LayerLevel, rest: readonly string[]): Promise<string | null> {
  const layer = ctx.layers.find((l) => l.level === level);
  const item = layer === undefined ? null : itemOf(layer, rest, kindOf(level, rest));
  if (item === null || ctx.names.off.has(item) || item.startsWith(`rules/${EXAMPLES}/`)) return null;
  const same = await filesOfName(ctx, level, rest, item, null);
  const taken = FARTHEST_FIRST.findLast((l) => same.has(l));
  return taken === undefined ? null : (same.get(taken) ?? null);
}

/** The hooks a level's hooks file names, each as RPH takes it: off where a config's `stack.off` list names `hooks/<name>`, replaced where a nearer level's hooks file names it too. */
async function hooksAt(ctx: ListingContext, level: LayerLevel, disk: string, place: (to: LayerLevel) => string[] | null): Promise<TreeHook[]> {
  const nearer: { path: string; names: Set<string> }[] = [];
  for (const other of FARTHEST_FIRST.slice(FARTHEST_FIRST.indexOf(level) + 1)) {
    const at = place(other);
    const lookup = at === null ? null : await locate(ctx.loc, viewPath(other, at));
    if (lookup?.ok !== true || lookup.at.is !== "file" || lookup.at.disk === null) continue;
    nearer.push({ path: lookup.at.path, names: new Set(hooksNamed((await readText(lookup.at.disk)) ?? "").map((h) => h.name)) });
  }
  return hooksNamed((await readText(disk)) ?? "").map((h) => {
    const offIn = ctx.names.off.get(`hooks/${h.name}`) ?? [];
    const replacedBy = nearer.findLast((n) => n.names.has(h.name))?.path ?? null;
    return { ...h, off: offIn.length > 0, offIn, replacedBy, applies: offIn.length === 0 && replacedBy === null };
  });
}

/**
 * Every file of the chat's view, level by level (shipped, global, character, chat), each in the order of its path. `standing`: what
 * updates changed of the shipped files and when the user wrote their own (`defaultStanding`).
 */
export async function treeListing(loc: ChatLocation, standing?: DefaultStanding): Promise<TreeFileEntry[]> {
  const ctx = await listingContext(loc, standing);
  const found: TreeFileEntry[] = [];
  for (const layer of ctx.layers) {
    const top = await locate(loc, layer.mount);
    if (!top.ok || top.at.is !== "folder" || top.at.disk === null) continue;
    for await (const e of walk(loc, layer.level, [], top.at.disk, Number.POSITIVE_INFINITY)) if (!e.folder) found.push(await entryAt(ctx, layer.level, e.rest, e.disk));
  }
  return found;
}
