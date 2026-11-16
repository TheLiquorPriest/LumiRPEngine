// `rpe migrate` (STANDALONE-PLAN §15.3 items 1 and 9), run from a copy of the new build in any folder
// while today's build goes on running: `--rehearse` reads everything, writes nothing and prints the
// report; without it, the real run takes the backup and carries today's data into RPE's data folder,
// the only place it writes. Today's data is named by path: Lumiverse's data folder, the user whose
// data moves, and the runtime's two folders. RPE's command line (`src/app/cli.ts`) runs this and
// gives it the file tree's layout: its folder names, its tables and where a chat's own folder is.

import type { Setting } from "../app/setting-list";
import { runtimeFoldersOf } from "./runtime-folders";
import { migrate } from "./migrate";
import type { TreeLayout } from "./own-files";
import { reportText } from "./report";

const USAGE = [
  "rpe migrate [--rehearse] --lumiverse <folder> --user <id> [--data <folder>]",
  "            [--runtime-config <folder> --runtime-data <folder>] [--runtime <name> | --no-runtime]",
  "            [--mine <folder>] [--theirs <folder>] [--identifier <id>] [--json]",
  "",
  "  --rehearse          read everything, write nothing, print the report",
  "  --lumiverse         Lumiverse's data folder (the one holding lumiverse.db)",
  "  --user              the id of the Lumiverse user whose data moves",
  "  --data              RPE's data folder: the only place the real run writes (default: RPE's own)",
  "  --runtime-config    today's runtime's config folder (default: as today's runtime finds it, ~/.config/lumiah)",
  "  --runtime-data      today's runtime's data folder (default: as today's runtime finds it, ~/.local/share/lumiah)",
  "  --runtime           the runtime of today's build that is this user's (default: the one they registered",
  "                      with this Lumiverse); every other runtime there is left alone",
  "  --no-runtime        the server runs no runtime of today's build for this user",
  "  --mine <name>       a runtime folder no config names holds this user's working copy (give it again for each folder)",
  "  --theirs <name>     a runtime folder no config names is not this user's: it is left alone",
  "  --identifier        the extension's identifier in Lumiverse (default: lumi_rp_engine)",
  "  --json              print the report as JSON instead of words",
].join("\n");

/** The extension's identifier as its manifest names it (`spindle.json`). */
const IDENTIFIER = "lumi_rp_engine";

const VALUED = ["lumiverse", "user", "data", "runtime-config", "runtime-data", "runtime", "identifier", "mine", "theirs"] as const;
const SWITCHES = ["rehearse", "no-runtime", "json"] as const;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}

/**
 * Runs the migration from the command line's words; the exit code: 0 done, 1 refused or failed, 2
 * misused. `tree` is the file tree's layout, which says where the user's own files go; `settings` the
 * app's one registry of settings, which takes each value the run carries as its own reader takes it.
 */
export async function migrateCli(argv: readonly string[], io: CliIo, tree: TreeLayout, settings?: readonly Setting[]): Promise<number> {
  const values: Record<string, string> = {};
  const folders: Record<string, "mine" | "theirs"> = {};
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const name = arg.startsWith("--") ? arg.slice(2) : "";
    const next = argv[i + 1];
    if ((SWITCHES as readonly string[]).includes(name)) switches.add(name);
    // A value never starts with `--`: `--data --rehearse` is a folder left out, never a real run into a folder named `--rehearse`.
    else if ((VALUED as readonly string[]).includes(name) && next !== undefined && !next.startsWith("--")) {
      const value = argv[++i] ?? "";
      if (name === "mine" || name === "theirs") {
        if (folders[value] !== undefined && folders[value] !== name) {
          io.err(`--mine ${value} and --theirs ${value} say opposite things: give one of them.\n\n${USAGE}`);
          return 2;
        }
        folders[value] = name;
      } else values[name] = value;
    } else {
      io.err(`${(VALUED as readonly string[]).includes(name) ? `--${name} needs a value${next === undefined ? "" : `, and ${next} is an option`}.` : `Not understood: ${arg}`}\n\n${USAGE}`);
      return 2;
    }
  }
  const { lumiverse, user, data } = values;
  if (lumiverse === undefined || user === undefined || data === undefined) {
    io.err(`--lumiverse, --user and --data are needed.\n\n${USAGE}`);
    return 2;
  }
  if (switches.has("no-runtime") && values.runtime !== undefined) {
    io.err(`--runtime names a runtime to take and --no-runtime says there is none: give one of them.\n\n${USAGE}`);
    return 2;
  }
  const found = runtimeFoldersOf(io.env, io.home);
  const runtime = switches.has("no-runtime") ? null : { configDir: values["runtime-config"] ?? found.configDir, dataDir: values["runtime-data"] ?? found.dataDir };
  try {
    const { report, ran } = await migrate({ lumiverse, identifier: values.identifier ?? IDENTIFIER, userId: user, runtime, ...(values.runtime !== undefined ? { runtimeName: values.runtime } : {}), ...(Object.keys(folders).length > 0 ? { runtimeFolders: folders } : {}) }, { data, rehearse: switches.has("rehearse"), version: io.env.LRE_BUILD_ID ?? "dev", env: io.env, tree, ...(settings ? { settings } : {}) });
    io.out(switches.has("json") ? `${JSON.stringify(report, null, 2)}\n` : reportText(report));
    return switches.has("rehearse") || ran ? 0 : 1;
  } catch (error) {
    io.err(`The migration stopped: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
