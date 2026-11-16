// The user's own files of the tree, written as him (plan §5.2, §5.4, §14): a file written as the user at a
// level, which for a file of another level is his own file of that name there, taken in place of the
// farther one, and kept as written by him (`recordWritten`) so the Files page can say which updates came
// after; a file of his removed, which for one in place of a default is resetting to the default; and a
// name switched off or on again in a level's config (`off:`), which is what "Delete" on a shipped file
// does. The Files routes call these, and so does the migration's switch-on, which writes his files too.
// Every path is a path of the chat's view, found by the view (`locate`): none leaves the tree, and a link
// is refused.

import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { LayerLevel } from "rp-harness/contract";
import { RouteError } from "../app";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import { LayoutRefused, withTopLevelKey, yamlMapping } from "../app/yaml";
import { nameList, OFF_KEY, placeAt, userMayWrite, writtenItem, writtenKey } from "./catalog";
import type { TreeChats, TreeWrites } from "./chats";
import { recordWritten } from "./defaults";
import { type ChatLocation, type Located, locate, treeLayers, viewPath } from "./view";

export interface OwnFilesDeps {
  /** The tree's folder: the global level. */
  files: string;
  chats: TreeChats;
  writes: TreeWrites;
  now(): number;
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
    const layer = layers.find((l) => l.level === level);
    if (layer?.config === undefined) throw new RouteError(400, `The ${level} level has no config to switch a file off in.`);
    const config = await this.found(loc, viewPath(level, [layer.config]));
    if (config.is === "folder") throw new RouteError(409, `${config.path} is a folder.`);
    await oneFileAtATime(config.disk, async () => {
      const text = (await readText(config.disk)) ?? "";
      let read: string[] | undefined;
      try {
        read = nameList(yamlMapping(text, config.path)[OFF_KEY]);
      } catch (error) {
        throw new RouteError(409, error instanceof Error ? error.message : String(error));
      }
      if (read === undefined) throw new RouteError(409, `\`${OFF_KEY}:\` in ${config.path} is not a list of names: make it one, then try again.`);
      const names = read;
      const kept = names.filter((n) => writtenItem(n, layers) !== item);
      const next = off ? [...kept, item] : kept;
      if (next.length === names.length && next.every((n, i) => n === names[i])) return;
      let spliced: string;
      try {
        spliced = withTopLevelKey(text, OFF_KEY, next, config.path);
      } catch (error) {
        // His file in a layout the splice does not follow: nothing is written, and the answer names the line.
        if (error instanceof LayoutRefused) throw new RouteError(409, error.message);
        throw error;
      }
      await mkdir(dirname(config.disk), { recursive: true });
      await writeWhole(config.disk, spliced);
    });
  }
}
