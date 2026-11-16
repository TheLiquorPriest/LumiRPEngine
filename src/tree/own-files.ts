// The user's own files of the tree, written as him (plan §5.2, §5.4, §14): a file written as the user at a
// level, which for a file of another level is his own file of that name there, taken in place of the
// farther one, and kept as written by him (`recordWritten`) so the Files page can say which updates came
// after; a file of his removed, which for one in place of a default is resetting to the default; a name
// switched off or on again in a level's config (`off:`), which is what "Delete" on a shipped file does;
// and a folder made, a file or folder of his renamed, moved or copied, never a shipped one or one RPE
// makes again. The Files routes call these, and so does the migration's switch-on, which writes his
// files too. Every path is a path of the chat's view, found by the view (`locate`): none leaves the tree,
// and a link is refused. A chat RPE has not played yet is placed, as its first turn places it, at his
// first write to it.

import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { GuidanceKind, LayerLevel } from "rp-harness/contract";
import { RouteError } from "../app";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import { LayoutRefused, withTopLevelKey, yamlMapping } from "../app/yaml";
import { kindAt, nameList, OFF_KEY, PINS_KEY, pinPath, pinRecords, placeAt, userMayWrite, writtenItem, writtenKey } from "./catalog";
import type { ChatFolders, TreeChats, TreeWrites } from "./chats";
import { recordWritten } from "./defaults";
import { type ChatLocation, type Located, locate, treeLayers, viewPath } from "./view";

export interface OwnFilesDeps {
  /** The tree's folder: the global level. */
  files: string;
  chats: TreeChats;
  writes: TreeWrites;
  now(): number;
  /** Places a chat RPE has not played yet, by Lumiverse's own names for it and its character, as its first turn places it; absent where RPE cannot (a test's own tree). */
  place?(user: string, chat: string): Promise<ChatFolders>;
}

/** A path of the view, found: where it is, and where on disk. */
export type FoundFile = Located & { disk: string };

/** The levels a config's `off:` list is written at (plan §5.2: `RPE-global.yml` or the chat's `RPE.yml`). */
export const OFF_LEVELS: readonly LayerLevel[] = ["global", "chat"];

export class OwnFiles {
  readonly #d: OwnFilesDeps;

  constructor(deps: OwnFilesDeps) {
    this.#d = deps;
  }

  /** The chat's view of the tree, for the user; with no chat, the shipped and global levels alone. */
  locationOf(user: string, chat: string | null): ChatLocation {
    const folders = chat === null ? null : this.#d.chats.folders(user, chat);
    return { files: this.#d.files, character: folders?.character ?? null, chat: folders?.chat ?? null };
  }

  /** The chat's view for a write: a chat RPE has not played yet is placed first, so its levels have folders. */
  async locationFor(user: string, chat: string | null): Promise<ChatLocation> {
    if (chat !== null && this.#d.chats.folders(user, chat) === null && this.#d.place !== undefined) await this.#d.place(user, chat);
    return this.locationOf(user, chat);
  }

  /** A path of the view, found; a 400 for one that is not a path, a 404 for one the view does not hold. */
  async found(loc: ChatLocation, path: string): Promise<FoundFile> {
    const lookup = await locate(loc, path);
    if (!lookup.ok) throw new RouteError(lookup.reason === "invalid" ? 400 : 404, `The tree has no file ${path} that a page can reach.`);
    if (lookup.at.disk === null) throw new RouteError(404, `RPE has not played this chat yet, so it has no folder for ${lookup.at.path}.`);
    return { ...lookup.at, disk: lookup.at.disk };
  }

  /**
   * Writes `text` as the user at `level`, for the file at `path`: there itself, or the user's own file of its name at that level
   * (where the level has a place for it). The path written. RPE keeps that the user wrote it now.
   */
  async writeAsUser(user: string, loc: ChatLocation, path: string, level: LayerLevel, text: string): Promise<string> {
    const from = await this.found(loc, path);
    const place = placeAt(from.level, from.rest, level);
    if (place === null) throw new RouteError(400, `The ${level} level has no place for ${from.path}.`);
    const at = await this.found(loc, viewPath(level, place));
    if (at.is === "folder") throw new RouteError(409, `${at.path} is a folder.`);
    if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? "The shipped files are read-only: write your own at the global, character or chat level." : `${at.path} is not a file you write: RPE makes it again.`);
    await oneFileAtATime(at.disk, async () => {
      await mkdir(dirname(at.disk), { recursive: true });
      await writeWhole(at.disk, text);
    });
    await recordWritten(this.#d.writes, user, writtenKey(this.#d.files, at.disk), this.#d.now());
    return at.path;
  }

  /** Removes a file of the user's, found already; for one in place of a default, that is resetting to the default. */
  async remove(at: FoundFile): Promise<void> {
    if (at.is !== "file") throw new RouteError(404, `The tree has no file ${at.path}.`);
    if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? "A shipped file is not removed: switch it off instead." : `${at.path} is not a file you remove: RPE makes it again.`);
    await oneFileAtATime(at.disk, () => rm(at.disk, { force: true }));
  }

  /**
   * Switches the name `item` off, or on again, in the `off:` list of the config of `level` (the global level's, or the chat's, the
   * chat being the one `loc` is the view of), keeping what else the config holds and says. A name already as asked changes nothing.
   */
  async switchOff(loc: ChatLocation, level: LayerLevel, item: string, off: boolean): Promise<void> {
    const layers = treeLayers();
    await this.#changeList(loc, level, OFF_KEY, nameList, "a list of names", (names) => {
      const kept = names.filter((n) => writtenItem(n, layers) !== item);
      return off ? [...kept, item] : kept;
    });
  }

  /**
   * Pins the file at `path` for `agent`, or takes the pin away, in the `pins:` list of the config of `level`, keeping what else the config
   * holds and says. Pinning names a file the view holds; a pin already as asked changes nothing, and one whose file is gone is taken away
   * all the same.
   */
  async pin(loc: ChatLocation, level: LayerLevel, path: string, agent: string, pinned: boolean): Promise<string> {
    let file = pinPath(path);
    if (pinned) {
      const at = await this.found(loc, file);
      if (at.is !== "file") throw new RouteError(409, `${at.path} is not a file: only a file is pinned.`);
      file = at.path;
    }
    await this.#changeList(loc, level, PINS_KEY, pinRecords, "a list of records, each with a file and an agent", (pins) => {
      const kept = pins.filter((p) => !(pinPath(p.file) === file && p.agent === agent));
      return pinned ? [...kept, { file, agent }] : kept;
    });
    return file;
  }

  /**
   * Changes the list under `key` in the config of `level`: `next` is given the list as it stands and answers the one to write; the rest of
   * the config, its comments and its layout, is kept. An unchanged list writes nothing; a key that is not such a list, or a config in a
   * layout the splice does not follow, is refused in words.
   */
  async #changeList<T>(loc: ChatLocation, level: LayerLevel, key: string, parse: (value: unknown) => T[] | undefined, shown: string, next: (list: readonly T[]) => T[]): Promise<void> {
    const layers = treeLayers();
    const layer = layers.find((l) => l.level === level);
    if (layer?.config === undefined) throw new RouteError(400, `The ${level} level has no config to write \`${key}:\` in.`);
    const config = await this.found(loc, viewPath(level, [layer.config]));
    if (config.is === "folder") throw new RouteError(409, `${config.path} is a folder.`);
    await oneFileAtATime(config.disk, async () => {
      const text = (await readText(config.disk)) ?? "";
      let read: T[] | undefined;
      try {
        read = parse(yamlMapping(text, config.path)[key]);
      } catch (error) {
        throw new RouteError(409, error instanceof Error ? error.message : String(error));
      }
      if (read === undefined) throw new RouteError(409, `\`${key}:\` in ${config.path} is not ${shown}: make it one, then try again.`);
      const now = next(read);
      if (JSON.stringify(now) === JSON.stringify(read)) return;
      let spliced: string;
      try {
        spliced = withTopLevelKey(text, key, now, config.path);
      } catch (error) {
        // His file in a layout the splice does not follow: nothing is written, and the answer names the line.
        if (error instanceof LayoutRefused) throw new RouteError(409, error.message);
        throw error;
      }
      await mkdir(dirname(config.disk), { recursive: true });
      await writeWhole(config.disk, spliced);
    });
  }

  /** Refuses what is not the user's: a shipped file or folder, or one RPE makes again. A 403 that says which. */
  #yours(at: FoundFile): void {
    if (!userMayWrite(at.level, at.rest, at.kind)) throw new RouteError(403, at.level === "shipped" ? `${at.path} is shipped: the shipped files are read-only, and your own go at the global, character or chat level.` : `${at.path} is not yours to change: RPE makes it again.`);
  }

  /** Makes a folder of the user's, and the folders above it; one already there is left as it is. */
  async makeFolder(loc: ChatLocation, path: string): Promise<FoundFile> {
    const at = await this.found(loc, path);
    this.#yours(at);
    if (at.is === "file") throw new RouteError(409, `${at.path} is a file.`);
    if (at.is === "none") await mkdir(at.disk, { recursive: true }).catch(conflict);
    return at;
  }

  /**
   * Renames or moves a file or folder of the user's to a path that is not taken, or with `copy` copies it there (a copy of a folder
   * leaves its links out). Both are the user's: neither a shipped file nor one RPE makes again. A file written there is kept as the
   * user's now. Answers where it went, and the kind of guidance the place is a folder of, if it is one (a file moved into `rules/`
   * is a rule).
   */
  async relocate(user: string, loc: ChatLocation, from: string, to: string, copy: boolean): Promise<{ at: FoundFile; guidance: GuidanceKind | null }> {
    const source = await this.found(loc, from);
    if (source.is === "none") throw new RouteError(404, `The tree has no file or folder ${source.path}.`);
    this.#yours(source);
    const target = await this.found(loc, to);
    if (target.is !== "none") throw new RouteError(409, `${target.path} is there already.`);
    this.#yours(target);
    if (source.is === "folder" && target.disk.startsWith(`${source.disk}${sep}`)) throw new RouteError(409, `${source.path} cannot go inside itself.`);
    const [first, second] = [source.disk, target.disk].sort();
    await oneFileAtATime(first ?? source.disk, () =>
      oneFileAtATime(second ?? target.disk, async () => {
        await mkdir(dirname(target.disk), { recursive: true }).catch(conflict);
        if (copy) await cp(source.disk, target.disk, { recursive: true, errorOnExist: true, force: false, filter: (path) => !lstatSync(path).isSymbolicLink() });
        else await rename(source.disk, target.disk);
      }),
    );
    const written = source.is === "file" ? [target.disk] : (await readdir(target.disk, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
    for (const disk of written) await recordWritten(this.#d.writes, user, writtenKey(this.#d.files, disk), this.#d.now());
    const layer = treeLayers().find((l) => l.level === target.level);
    return { at: target, guidance: layer === undefined || target.rest.length < 2 ? null : (kindAt(layer, target.rest[0]) ?? null) };
  }
}

/** A refusal for a path that has a file where a folder is needed, or a folder where a file is. */
function conflict(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "ENOTDIR" || code === "EEXIST") throw new RouteError(409, "A file stands where a folder is needed.");
  throw error;
}
