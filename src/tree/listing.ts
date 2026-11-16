// The Files page's listing (plan §5, §14): the tree read like a filesystem, one folder at a time and a page
// of it at a time, so a chat of thousands of turn files opens at once; or searched, by name and by text,
// across every level. A folder is read for its own entries alone, each file made into its entry against
// the other levels' (`entryAt`) and, where RPH was asked, RPH's standing of it (`withStanding`).

import { join } from "node:path";
import type { LayerLevel } from "rp-harness/contract";
import { RouteError } from "../app";
import { readText } from "../app/disk";
import { entryAt, type ListingContext, type TreeFileEntry } from "./catalog";
import { walk } from "./files";
import { entriesOf, levelBase, locate, viewPath } from "./view";

/** One entry of a listing: a folder, or a file with its entry. */
export interface Listed {
  name: string;
  /** Its path in the chat's view, as the file routes take it. */
  path: string;
  folder: boolean;
  level: LayerLevel;
  entry: TreeFileEntry | null;
}

/** One page of a listing. */
export interface ListedPage {
  /** The folder listed, as the view names it ("" for the chat's own top, with the other levels' folders beside its files); the search's page names where it searched. */
  folder: string;
  items: Listed[];
  /** Where the next page starts after; null at the end. */
  next: string | null;
  /** The levels the view has now: the shipped and the user's own always, a chat's and its character's once the chat has its folders. */
  levels: LayerLevel[];
  /** A search that ran out of its time (`files.grepMs`) with the entries it had found: it did not look everywhere. */
  stopped: "time" | null;
}

export interface PageAsk {
  limit: number;
  after: string | undefined;
}

/** The levels of the view that have a folder. */
function levelsOf(ctx: ListingContext): LayerLevel[] {
  return ctx.layers.map((l) => l.level).filter((level) => levelBase(ctx.loc, level) !== null);
}

/** The page of a sorted list that follows `after` (the key of the last entry of the page before), and where the next starts. */
function pageOf<T>(all: readonly T[], keyOf: (item: T) => string, ask: PageAsk): { items: T[]; next: string | null } {
  const from = ask.after === undefined ? 0 : all.findIndex((i) => keyOf(i) > (ask.after as string));
  if (from < 0) return { items: [], next: null };
  const items = all.slice(from, from + ask.limit);
  return { items, next: from + ask.limit < all.length ? keyOf(items.at(-1) as T) : null };
}

/**
 * The entries of one folder of the view, folders first, each by name, a page of them. `folder` is "" for the chat's own top, which
 * holds the other levels' folders (`@shipped`, `@global`, and `@character` once the chat has one) beside its files.
 */
export async function listFolder(ctx: ListingContext, folder: string, ask: PageAsk): Promise<ListedPage> {
  const loc = ctx.loc;
  const top = folder === "" || folder === ".";
  const at = await locate(loc, top ? "" : folder);
  if (!at.ok) throw new RouteError(at.reason === "invalid" ? 400 : 404, `The tree has no folder ${folder} that a page can reach.`);
  if (!top && at.at.is !== "folder") throw new RouteError(404, `The tree has no folder ${folder}.`);
  const names: { name: string; folder: boolean; level: LayerLevel; rest: string[]; disk: string }[] = [];
  if (at.at.disk !== null) {
    for (const e of await entriesOf(loc, at.at.level, at.at.rest, at.at.disk)) names.push({ ...e, level: at.at.level, rest: [...at.at.rest, e.name], disk: join(at.at.disk, e.name) });
  }
  const mounts = top ? ctx.layers.filter((l) => l.level !== "chat" && levelBase(loc, l.level) !== null).map((l) => ({ name: l.mount.slice(0, -1), folder: true, level: l.level, rest: [] as string[], disk: "" })) : [];
  const sorted = [...mounts, ...names].sort((a, b) => (a.folder === b.folder ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.folder ? -1 : 1));
  const page = pageOf(sorted, (e) => `${e.folder ? 0 : 1}${e.name}`, ask);
  const items = await Promise.all(
    page.items.map(async (e): Promise<Listed> => {
      if (e.folder) return { name: e.name, path: e.disk === "" ? e.name : viewPath(e.level, e.rest), folder: true, level: e.level, entry: null };
      const entry = await entryAt(ctx, e.level, e.rest, e.disk);
      return { name: e.name, path: entry.path, folder: false, level: e.level, entry };
    }),
  );
  return { folder: top ? "" : at.at.path, items, next: page.next, levels: levelsOf(ctx), stopped: null };
}

/** What a search is limited by (`files.grepBytes`: a larger file is searched by its name alone; `files.grepMs`: the time it runs). */
export interface SearchLimits {
  grepBytes: number;
  grepMs: number;
}

/**
 * The files of every level whose path holds `text`, or whose text does (case aside), a page of them in the order of the levels and
 * their paths. A file larger than the limit is found by its name alone, and a search that runs past its time stops and says so.
 */
export async function searchTree(ctx: ListingContext, text: string, ask: PageAsk, limits: SearchLimits, now: () => number = Date.now): Promise<ListedPage> {
  const wanted = text.toLowerCase();
  const stopAt = now() + limits.grepMs;
  const items: Listed[] = [];
  let passed = ask.after === undefined;
  let next: string | null = null;
  let stopped: "time" | null = null;
  search: for (const layer of ctx.layers) {
    const top = await locate(ctx.loc, layer.mount);
    if (!top.ok || top.at.is !== "folder" || top.at.disk === null) continue;
    for await (const e of walk(ctx.loc, layer.level, [], top.at.disk, Number.POSITIVE_INFINITY)) {
      if (e.folder) continue;
      const path = viewPath(layer.level, e.rest);
      if (!passed) {
        passed = path === ask.after;
        continue;
      }
      if (now() > stopAt) {
        stopped = "time";
        break search;
      }
      const named = path.toLowerCase().includes(wanted);
      if (!named) {
        const body = await readText(e.disk).catch(() => null);
        if (body === null || body.length > limits.grepBytes || !body.toLowerCase().includes(wanted)) continue;
      }
      if (items.length === ask.limit) {
        next = items.at(-1)?.path ?? null;
        break search;
      }
      const entry = await entryAt(ctx, layer.level, e.rest, e.disk);
      items.push({ name: e.rest.at(-1) ?? path, path, folder: false, level: layer.level, entry });
    }
  }
  return { folder: "", items, next: stopped === null ? next : (items.at(-1)?.path ?? ask.after ?? null), levels: levelsOf(ctx), stopped };
}
