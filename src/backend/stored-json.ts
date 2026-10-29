// Reading the extension's own JSON files from user storage. A file that doesn't parse, or parses
// to the wrong shape, is moved aside as `<path>.corrupt-<epoch ms>` (so nothing overwrites it, not
// even a later set-aside of the same file, before someone can look at it), a warning is logged, and
// the caller starts from a fresh value.

import type { UserId } from "../shared/ids";
import type { HostPort } from "./host";

/** What a damaged file's kept copy appends to its path, before the epoch milliseconds of the set-aside. */
export const CORRUPT_SUFFIX = ".corrupt-";

/**
 * The parsed file when it exists and `valid` accepts it; `undefined` when it is missing, or when it
 * is damaged (then it has been set aside, and `damaged` is told, for a caller to whom a lost file
 * isn't a fresh one). `what` names it in the warning. A file that can't be read at all throws.
 */
export async function readStoredJson(host: Pick<HostPort, "storage" | "log">, path: string, userId: UserId, what: string, valid: (raw: unknown) => boolean, damaged?: () => void): Promise<unknown> {
  const text = await host.storage.read(path, userId);
  if (text === null) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    await setAside(host, path, userId, what, "unreadable");
    damaged?.();
    return undefined;
  }
  if (valid(raw)) return raw;
  await setAside(host, path, userId, what, "malformed");
  damaged?.();
  return undefined;
}

/**
 * Moves a damaged file to `<path>.corrupt-<epoch ms>` (the next free millisecond when that name is
 * taken) and logs it; returns the kept path. A failed move is logged too and returns null (the
 * caller still starts fresh).
 */
export async function setAside(host: Pick<HostPort, "storage" | "log">, path: string, userId: UserId, what: string, why: string): Promise<string | null> {
  try {
    let at = Date.now();
    while ((await host.storage.read(`${path}${CORRUPT_SUFFIX}${at}`, userId)) !== null) at++;
    const aside = `${path}${CORRUPT_SUFFIX}${at}`;
    await host.storage.move(path, aside, userId);
    host.log("warn", `[LumiRPEngine] the ${what} file was ${why}; it is kept as ${aside} and a fresh one is used`, userId);
    return aside;
  } catch (error) {
    host.log("warn", `[LumiRPEngine] the ${what} file was ${why} and could not be set aside (${error instanceof Error ? error.message : String(error)}); a fresh one is used`, userId);
    return null;
  }
}
