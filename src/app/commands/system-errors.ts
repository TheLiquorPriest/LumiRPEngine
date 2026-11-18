// The command line's last line when a command is stopped by something the machine refused: a folder that is not there, a file that
// may not be opened, a database that cannot be. The system words ("ENOENT: no such file or directory, open '...'") are said once, here,
// in plain words that name the path and the one thing to do; any other error keeps its own words.

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { DataPaths } from "../config";

/** What an error holds under `name`, where it holds anything: the machine's errors carry `code`, `path` and `syscall` as fields. */
function fieldOf(error: Error, name: "code" | "path" | "syscall"): unknown {
  return Reflect.get(error, name);
}

/** The parts of an error the machine raised: its code, the path it names, and the call that failed. */
interface Raised {
  code: string;
  path: string | null;
  syscall: string | null;
}

/** The path a system error names: its own field, else the one its message ends with (`..., open '/path'`). */
function pathOf(error: Error): string | null {
  const named = fieldOf(error, "path");
  if (typeof named === "string" && named !== "") return named;
  return /, \w+ '(.+)'$/.exec(error.message)?.[1] ?? null;
}

/** An error the machine raised (a code such as ENOENT), as its parts; null for any other. */
function raisedBy(error: unknown): Raised | null {
  if (!(error instanceof Error)) return null;
  const code = fieldOf(error, "code");
  const syscall = fieldOf(error, "syscall");
  if (typeof code !== "string" || !/^E[A-Z0-9]+$/.test(code)) return null;
  return { code, path: pathOf(error), syscall: typeof syscall === "string" ? syscall : null };
}

/** Whether a database could not be opened: bun's SQLite says it with the code SQLITE_CANTOPEN and the words "unable to open database file". */
function cannotOpenDatabase(error: unknown): boolean {
  return error instanceof Error && (fieldOf(error, "code") === "SQLITE_CANTOPEN" || error.message === "unable to open database file");
}

/** A path with what it is to RPE, where it is one of the data folder's own. */
function shown(path: string, paths: DataPaths | undefined): string {
  if (paths === undefined) return path;
  if (path === paths.root) return `RPE's data folder ${path}`;
  if (path === paths.config) return `RPE's config file ${path}`;
  if (path === paths.secrets) return `RPE's secrets file ${path}`;
  if (path === paths.database) return `RPE's database ${path}`;
  return path;
}

const GIVE_ACCESS = "Give the account you run RPE as access to it (with chmod or chown).";

/**
 * The line to print for `error`: for one the machine raised, what could not be done, to which path, and the one thing to do; for a
 * database that could not be opened, the same with the data folder's database named; any other error as it says itself.
 */
export function plainError(error: unknown, paths?: DataPaths): string {
  const own = error instanceof Error ? error.message : String(error);
  if (cannotOpenDatabase(error)) return `RPE could not open its database${paths === undefined ? "" : ` ${paths.database}`}: your account may not read it, or may not write in the folder it is in. ${GIVE_ACCESS}`;
  const raised = raisedBy(error);
  if (raised === null || raised.path === null) return own;
  const { code, syscall } = raised;
  // A scratch folder is made under a name with letters added: the place the reader named is its folder.
  const path = syscall === "mkdtemp" ? dirname(raised.path) : raised.path;
  const at = shown(path, paths);
  switch (code) {
    case "ENOENT": {
      if (syscall === "mkdtemp") return `RPE could not make a folder in ${at}: that folder is not there. Make it first.`;
      const folder = dirname(path);
      return existsSync(folder) ? `${at} is not there. Check its name.` : `${at} is not there, and neither is the folder it belongs in (${folder}). Make that folder first.`;
    }
    case "EEXIST":
      return `${at} is there already, and RPE writes over nothing. Name a file that is not there yet.`;
    case "EACCES":
    case "EPERM":
      return `RPE may not ${syscall === "mkdtemp" || syscall === "mkdir" ? "make a folder in" : "open"} ${at}: your account has no permission for it. ${GIVE_ACCESS}`;
    case "ENOTDIR":
      return `${at} cannot be used: a part of that path is a file, where RPE needs a folder. Name a place under a folder.`;
    case "EISDIR":
      return `${at} is a folder, where RPE needs a file. Name a file.`;
    case "ENOSPC":
      return `There is no room left on the disk for ${at}. Free some space on that disk.`;
    case "EROFS":
      return `${at} is on a disk that cannot be written. Name a place on a disk that can.`;
    default:
      return own;
  }
}
