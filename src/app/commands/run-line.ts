// The lines the command line prints for the owner to run: whole lines, which run as printed. Each
// begins with how this process was started (the Bun and the app file), as today's command prints
// its own, and names the data folder where it is not the default one.

import { resolve } from "node:path";
import { shellWord } from "../../migrate/going-back";
import type { CliIO } from "../cli";
import type { DataPaths } from "../config";
import { defaultDataFolder } from "../config";

/** The words that run an app file with a Bun, as a shell line begins. */
export function invokedAs(bun: string, file: string): string {
  return `${shellWord(bun)} ${shellWord(file)}`;
}

/** A line that runs `rpe <words>` on this data folder, as this process was started. */
export function runLine(io: CliIO, paths: DataPaths, ...words: readonly string[]): string {
  const data = resolve(paths.root) === resolve(defaultDataFolder(io.env, io.home)) ? [] : ["--data", resolve(paths.root)];
  return [io.invoked ?? "rpe", ...[...words, ...data].map(shellWord)].join(" ");
}
