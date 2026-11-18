// `rpe migrate` (STANDALONE-PLAN §15.3 items 1 and 9), run from a copy of the new build in any folder
// while today's build goes on running: `--rehearse` reads everything, writes nothing and prints the
// report; without it, the real run takes the backup and carries today's data into RPE's data folder,
// the only place it writes. Today's data is named by path: Lumiverse's data folder, the user whose
// data moves, and the runtime's two folders. RPE's command line (`src/app/cli.ts`) runs this and
// gives it the file tree's layout: its folder names, its tables and where a chat's own folder is.

import type { Setting } from "../app/setting-list";
import { type Line, parseArgs, UsageError } from "../app/commands/args";
import { commandSpec, helpText } from "../app/commands/table";
import { runtimeFoldersOf } from "./runtime-folders";
import type { CarriedRuns } from "./import-chats";
import { migrate } from "./migrate";
import type { TreeLayout } from "./own-files";
import { reportText } from "./report";
import { dataPaths } from "../app/config";
import { lastSwap, readRpe } from "./going-back";
import { notCarriedEnd, notCarriedLines, notCarriedOf } from "./not-carried";

/** The extension's identifier as its manifest names it (`spindle.json`). */
const IDENTIFIER = "lumi_rp_engine";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}

/**
 * Runs the migration from the command line's words; the exit code: 0 done, 1 refused or failed, 2
 * misused. A rehearsal is done when it has printed its report, and it exits 0 where the report says the
 * real run may start and 1 where it says the real run won't. A real run that left a chat holding records
 * of the previous build not carried names each first, ahead of the report, and exits 1 (`not-carried.ts`).
 * `tree` is the file tree's layout, which says where the user's own files go; `settings` the app's one
 * registry of settings, which takes each value the run carries as its own reader takes it; `runs` the turn
 * lane's writer of a carried turn's run record, with its tables; `lines` the lines that run the migration
 * again and go back, as the command line writes them (absent: `rpe migrate` and `rpe down`).
 */
export async function migrateCli(argv: readonly string[], io: CliIo, tree: TreeLayout, settings?: readonly Setting[], runs?: CarriedRuns, lines?: { again: string; down: string }): Promise<number> {
  const spec = commandSpec("migrate");
  if (spec === undefined) throw new Error("The table of commands has no command migrate.");
  const usage = helpText(spec);
  let line: Line;
  try {
    line = parseArgs(argv, "migrate");
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`${error.message}\n\n${usage}`);
    return 2;
  }
  const [word] = line.words;
  if (word !== undefined) {
    io.err(`Not understood: ${word}\n\n${usage}`);
    return 2;
  }
  const { flags: values, switches } = line;
  // A runtime folder no config names is this user's (`--mine`) or not (`--theirs`), by its name; one told both ways is refused.
  const folders: Record<string, "mine" | "theirs"> = {};
  for (const kind of ["mine", "theirs"] as const) {
    for (const value of line.repeated[kind] ?? []) {
      if (folders[value] !== undefined && folders[value] !== kind) {
        io.err(`--mine ${value} and --theirs ${value} say opposite things: give one of them.\n\n${usage}`);
        return 2;
      }
      folders[value] = kind;
    }
  }
  const { lumiverse, user, data } = values;
  // `--data` is `rpe migrate`'s own default folder where the command line does not name one, so it is missing only for a caller that gave none.
  const missing = [lumiverse === undefined ? "--lumiverse" : "", user === undefined ? "--user" : "", data === undefined ? "--data" : ""].filter((m) => m !== "");
  if (lumiverse === undefined || user === undefined || data === undefined) {
    io.err(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} needed.\n\n${usage}`);
    return 2;
  }
  if (switches.has("no-runtime") && values.runtime !== undefined) {
    io.err(`--runtime names a runtime to take and --no-runtime says there is none: give one of them.\n\n${usage}`);
    return 2;
  }
  const found = runtimeFoldersOf(io.env, io.home);
  const folderPair = { configDir: values["runtime-config"] ?? found.configDir, dataDir: values["runtime-data"] ?? found.dataDir };
  const none = switches.has("no-runtime");
  // Told there is none, the run reads none; where it is found all the same, the report says what that leaves out.
  const runtime = none ? null : folderPair;
  try {
    const { report, ran } = await migrate({ lumiverse, identifier: values.identifier ?? IDENTIFIER, userId: user, runtime, ...(none ? { ignored: folderPair } : {}), ...(values.runtime !== undefined ? { runtimeName: values.runtime } : {}), ...(Object.keys(folders).length > 0 ? { runtimeFolders: folders } : {}) }, { data, rehearse: switches.has("rehearse"), version: io.env.LRE_BUILD_ID ?? "dev", env: io.env, tree, ...(settings ? { settings } : {}), ...(runs ? { runs } : {}) });
    // A chat that holds records of the previous build and that the run did not carry is named first, ahead of the report, and last again; the run then ends with 1.
    const missing = ran ? notCarriedOf(report) : [];
    const switched = missing.length > 0 && readRpe(dataPaths(data).database, (db) => lastSwap(db, user)) !== null;
    if (switches.has("json")) io.out(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const first = notCarriedLines(missing, { again: lines?.again ?? "rpe migrate", back: switched ? (lines?.down ?? "rpe down") : null }, { lumiverse, user });
      if (first.length > 0) io.out(`${first.join("\n")}\n`);
      io.out(reportText(report));
      if (missing.length > 0) io.out(notCarriedEnd(missing, false));
    }
    return (switches.has("rehearse") ? report.refusals.length === 0 : ran && missing.length === 0) ? 0 : 1;
  } catch (error) {
    io.err(`The migration stopped: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
