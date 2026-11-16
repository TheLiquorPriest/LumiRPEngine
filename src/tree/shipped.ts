// The shipped level (plan §5, §5.2 "Shipped defaults"): every shipped file in `files/defaults/`,
// read-only, to read and copy from. RPH's own shipped files are the lowest layer and RPE's are laid
// over them, so a file of RPE's with the same path replaces RPH's. RPE's `chat-defaults/` (`TURN.md`
// and its siblings) is laid at the level's root, where instruction files are found; everything else of
// RPE's (`ALL-AGENTS.md`, `RPE-global.yml`, `.agents/`, `.rules/`, `.skills/`, `.prompts/`, `.tools/`) is
// laid as it is. That rule lives once, in `shippedPlaces`, a pure function of the two folders' path
// lists: `layShippedChanges` copies each file where it says, and the proof's record of a run lays the
// build's tree by the same function.
//
// It is laid out again at every start, so an update's defaults reach the tree; a file the user put at
// another level is never touched. The new copy is made beside the data folder's tree, out of the
// agents' view, and moved in whole. What it changed of the files laid out before is given back, so the
// Files page can say which default changed under the user's own file (`defaults.ts`).

import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SHIPPED_FOLDER } from "./layout";

/** RPE's own shipped folder: the repository's `guidance/`, or where the build put it (`scripts/build.ts` stamps `RPE_GUIDANCE_DIR`, relative to the bundle). */
export const RPE_GUIDANCE = fileURLToPath(new URL(process.env.RPE_GUIDANCE_DIR ?? "../../guidance/", import.meta.url));

/** RPE's shipped folder that holds the chat-level defaults, laid at the shipped level's root. */
export const CHAT_DEFAULTS = "chat-defaults";

/**
 * Where a file or folder of a shipped folder lands in the shipped level, by its path below that folder
 * ("/" between names, a folder's ending in "/"): RPH's at its own path; RPE's at its own path, but for
 * what is below its `chat-defaults/`, which lands at the level's root ("" for that folder itself).
 * `shippedPlaces` is the rule's one export; this is its step for one path.
 */
function shippedPath(from: "rph" | "rpe", path: string): string {
  return from === "rpe" && path.startsWith(`${CHAT_DEFAULTS}/`) ? path.slice(CHAT_DEFAULTS.length + 1) : path;
}

/** A file of the shipped level: its place there, the folder it comes from, and its path below that folder. */
export interface ShippedPlace {
  path: string;
  from: "rph" | "rpe";
  source: string;
}

/**
 * The shipped level laid from the two folders' file paths (below each folder, "/" between names): each
 * file at the place `shippedPath` gives it; a file of RPE's replacing RPH's at the same place; of two of
 * RPE's at one place (one below `chat-defaults/`, one at its own path), the later in `rpe`, the order in
 * which they are copied. In the order of the places.
 */
export function shippedPlaces(rph: readonly string[], rpe: readonly string[]): ShippedPlace[] {
  const out = new Map<string, ShippedPlace>();
  for (const source of rph) out.set(shippedPath("rph", source), { path: shippedPath("rph", source), from: "rph", source });
  for (const source of rpe) out.set(shippedPath("rpe", source), { path: shippedPath("rpe", source), from: "rpe", source });
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every entry below a folder by its path below it ("/" between names): its folders, and what is copied as it is (files, and anything else that is no folder), each in the order `readdir` gives, a folder before what is in it. */
async function entriesBelow(folder: string): Promise<{ folders: string[]; copied: string[] }> {
  const folders: string[] = [];
  const copied: string[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(join(folder, at), { withFileTypes: true })) {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        folders.push(path);
        await walk(path);
      } else copied.push(path);
    }
  };
  await walk("");
  return { folders, copied };
}

/** Fixed: shipped files are read-only on disk; their folders stay the owner's, so the next start can lay them out again. */
const READ_ONLY_FILE = 0o444;
const SHIPPED_FOLDER_MODE = 0o755;

async function readOnly(folder: string): Promise<void> {
  await chmod(folder, SHIPPED_FOLDER_MODE);
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const at = join(folder, entry.name);
    if (entry.isDirectory()) await readOnly(at);
    else if (entry.isFile()) await chmod(at, READ_ONLY_FILE);
  }
}

/** Makes every folder below `folder` the owner's to change again, so it can be removed. */
async function writable(folder: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  await chmod(folder, SHIPPED_FOLDER_MODE);
  for (const entry of entries) if (entry.isDirectory()) await writable(join(folder, entry.name));
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

/** A shipped file an update changed or took away: its path below the shipped level, its text before, and whether the update removed it. */
export interface ShippedChange {
  path: string;
  before: string;
  removed?: true;
}

/** Every file below a folder by its path below it ("/" between names), with its text; none for a folder that is not there. */
async function textsBelow(folder: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let found;
  try {
    found = await readdir(folder, { recursive: true, withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of found) {
    if (!d.isFile()) continue;
    const at = join(d.parentPath, d.name);
    out.set(relative(folder, at).split(sep).join("/"), await readFile(at, "utf8"));
  }
  return out;
}

/**
 * Lays the shipped level of the tree at `files`: RPH's folder `rph`, then RPE's `rpe` over it.
 * `scratch` is a folder beside the tree, on the same disk, where the copy is made before it moves in.
 */
export async function layShipped(files: string, scratch: string, sources: { rph: string; rpe: string }): Promise<void> {
  await layShippedChanges(files, scratch, sources);
}

/** Lays the shipped level as `layShipped` does, and gives back each file laid out before whose text this copy changes, and each it no longer has. */
export async function layShippedChanges(files: string, scratch: string, sources: { rph: string; rpe: string }): Promise<ShippedChange[]> {
  const next = join(scratch, "shipped.next");
  const old = join(scratch, "shipped.old");
  for (const left of [next, old]) {
    await writable(left);
    await rm(left, { recursive: true, force: true });
  }
  await mkdir(next, { recursive: true });
  const [rph, rpe] = await Promise.all([entriesBelow(sources.rph), entriesBelow(sources.rpe)]);
  for (const [from, folders] of [
    ["rph", rph.folders],
    ["rpe", rpe.folders],
  ] as const) {
    for (const folder of folders) await mkdir(join(next, shippedPath(from, `${folder}/`)), { recursive: true });
  }
  for (const place of shippedPlaces(rph.copied, rpe.copied)) {
    const to = join(next, place.path);
    await mkdir(dirname(to), { recursive: true });
    await cp(join(sources[place.from], place.source), to, { recursive: true, force: true });
  }
  await readOnly(next);
  const target = join(files, SHIPPED_FOLDER);
  const [was, now] = await Promise.all([textsBelow(target), textsBelow(next)]);
  const changed = [...was].flatMap(([path, before]): ShippedChange[] => (!now.has(path) ? [{ path, before, removed: true }] : now.get(path) !== before ? [{ path, before }] : []));
  await mkdir(files, { recursive: true });
  if (await exists(target)) await rename(target, old);
  await rename(next, target);
  await writable(old);
  await rm(old, { recursive: true, force: true });
  return changed;
}
