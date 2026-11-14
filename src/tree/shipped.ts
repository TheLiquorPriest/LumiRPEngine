// The shipped level (plan §5, §5.2 "Shipped defaults"): every shipped file in `files/defaults/`,
// read-only, to read and copy from. RPH's own shipped files are the lowest layer and RPE's are laid
// over them, so a file of RPE's with the same path replaces RPH's. RPE's `chat-defaults/` (`TURN.md`
// and its siblings) is laid at the level's root, where instruction files are found; everything else of
// RPE's (`ALL-AGENTS.md`, `RPE-global.yml`, `.agents/`, `.rules/`, `.skills/`, `.prompts/`, `.tools/`) is
// laid as it is.
//
// It is laid out again at every start, so an update's defaults reach the tree; a file the user put at
// another level is never touched. The new copy is made beside the data folder's tree, out of the
// agents' view, and moved in whole.

import { chmod, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHIPPED_FOLDER } from "./layout";

/** RPE's own shipped folder: the repository's `guidance/`, or where the build put it (`scripts/build.ts` stamps `RPE_GUIDANCE_DIR`, relative to the bundle). */
export const RPE_GUIDANCE = fileURLToPath(new URL(process.env.RPE_GUIDANCE_DIR ?? "../../guidance/", import.meta.url));

/** RPE's shipped folder that holds the chat-level defaults, laid at the shipped level's root. */
export const CHAT_DEFAULTS = "chat-defaults";

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

/**
 * Lays the shipped level of the tree at `files`: RPH's folder `rph`, then RPE's `rpe` over it.
 * `scratch` is a folder beside the tree, on the same disk, where the copy is made before it moves in.
 */
export async function layShipped(files: string, scratch: string, sources: { rph: string; rpe: string }): Promise<void> {
  const next = join(scratch, "shipped.next");
  const old = join(scratch, "shipped.old");
  for (const left of [next, old]) {
    await writable(left);
    await rm(left, { recursive: true, force: true });
  }
  await mkdir(next, { recursive: true });
  await cp(sources.rph, next, { recursive: true });
  for (const entry of await readdir(sources.rpe, { withFileTypes: true })) {
    const from = join(sources.rpe, entry.name);
    await cp(from, entry.name === CHAT_DEFAULTS && entry.isDirectory() ? next : join(next, entry.name), { recursive: true, force: true });
  }
  await readOnly(next);
  const target = join(files, SHIPPED_FOLDER);
  await mkdir(files, { recursive: true });
  if (await exists(target)) await rename(target, old);
  await rename(next, target);
  await writable(old);
  await rm(old, { recursive: true, force: true });
}
