// The command line `rpe` (plan §4.4, §4.6, §16): the dispatcher. Each command is answered from its
// own file under `commands/`, and none of those files imports another's; this file reads the line,
// the data folder and the config once, and hands each command what it takes. `main.ts` gives it the
// process's real input and output.

import type { Area } from "./app";
import { parseArgs, UsageError } from "./commands/args";
import { backupCommand } from "./commands/backup";
import { checkCommand } from "./commands/check";
import { connectionCommand } from "./commands/connection";
import { downCommand } from "./commands/down";
import { keyCommand } from "./commands/key";
import { lumiverseCommand } from "./commands/lumiverse";
import { migrateCommand } from "./commands/migrate";
import { serveCommand } from "./commands/serve";
import { statusCommand } from "./commands/status";
import { listSwitchesCommand, switchCommand } from "./commands/switch";
import { commandSpec, helpText, HELP_FLAGS, usageText } from "./commands/table";
import { plainError } from "./commands/system-errors";
import { upCommand } from "./commands/up";
import { versionCommand } from "./commands/version";
import type { DataPaths, Env } from "./config";
import { dataPaths, defaultDataFolder, loadConfig } from "./config";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  env: Env;
  home: string;
  now(): number;
  /** A secret the user gives: piped in, or typed at a prompt that does not show it; null when none is given. */
  secret(question: string): Promise<string | null>;
  /** A line the user types, shown as typed, or the next line piped in; null when none is given. */
  ask(question: string): Promise<string | null>;
  /** Resolves when the process is told to stop (Ctrl-C, the service stopping). */
  stopped(): Promise<void>;
  /** Over the network, or, given `unix`, over that Unix socket (the running server's command socket). */
  fetch(url: string, init: BunFetchRequestInit): Promise<Response>;
  /** How this process was started, as the words that run it again: the Bun and the app file. Every line the command line prints for the owner to run begins with it (`rpe` where it is not known). */
  invoked?: string;
}

export interface CliOptions {
  version: string;
  /** The areas `serve` mounts besides the app's own. */
  areas?: readonly Area[];
  /** The app file this process runs (`dist/rpe.js`, as `rpe up`'s service starts it): `serve` keeps its hash and restarts onto a new build of it. Absent where there is none. */
  appFile?: string;
  /** The machine the command runs on, as `rpe up --systemd` needs to know it: its platform, the account's number (null where there is none) and the Bun running it. Read from the process where absent. */
  host?: { platform: string; uid: number | null; bun: string };
}

/** The usage: every command with the options it takes and what it does, from the table of commands (`commands/table.ts`). */
export const USAGE = usageText();

/** `--within`: a number of seconds. */
function withinOf(given: string | undefined): number | undefined {
  if (given === undefined) return undefined;
  const seconds = Number(given);
  if (!/^\d+$/.test(given) || seconds < 1) throw new UsageError(`--within is "${given}": give a number of seconds, at least 1.`);
  return seconds;
}

/** Runs one command; returns the exit code. */
export async function runCli(argv: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const [command, ...rest] = argv;
  // The data folder once the line named it, so that an error of the machine can name its files.
  let dataFolder: DataPaths | undefined;
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.out(USAGE);
      return command === undefined ? 2 : 0;
    }
    if (command === "--version") return versionCommand(command, rest, io, options.version);
    const spec = commandSpec(command);
    if (spec === undefined) throw new UsageError(`rpe has no command "${command}".`);
    // `--help` or `-h` after a command: that command's own help, and nothing runs.
    if (rest.some((arg) => HELP_FLAGS.includes(arg))) {
      io.out(helpText(spec));
      return 0;
    }
    if (command === "version") return versionCommand(command, rest, io, options.version);
    // The migration reads its own line, and writes only once it is not a rehearsal; `up` and `down` read theirs.
    if (command === "migrate") return await migrateCommand(rest, io, options.version);
    if (command === "up") return await upCommand(rest, io, options, (paths, config) => serveCommand(paths, config, io, options));
    if (command === "down") return await downCommand(rest, io);
    const { words, flags } = parseArgs(rest, command);
    const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
    dataFolder = paths;
    const config = await loadConfig(paths, io.env);
    if ((command === "serve" || command === "status" || command === "backup" || command === "lumiverse" || command === "check") && words.length > 0) throw new UsageError(`rpe ${command} takes no words.`);
    switch (command) {
      case "serve":
        return await serveCommand(paths, config, io, options);
      case "check":
        return await checkCommand(paths, config, flags.into, withinOf(flags.within), io, options);
      case "status":
        return await statusCommand(paths, config, io, options.version);
      case "lumiverse":
        return await lumiverseCommand(flags, paths, config, io, options.version);
      case "backup":
        return await backupCommand(paths, flags.out, io);
      case "key":
        return await keyCommand(words, paths, config, io, options.version);
      case "connection":
        return await connectionCommand(words, flags, paths, config, io);
      default: {
        const name = words[0];
        if (command === "allow" && words.length === 0) return await listSwitchesCommand(flags.user, paths, config, io, options.version);
        if (words.length !== 1 || name === undefined) throw new UsageError(`rpe ${command} takes one name.`);
        return await switchCommand(name, command === "allow" ? "on" : "off", flags.user, paths, config, io, options.version);
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      // A line the command did not take is answered with that command's own help; a line that names no command, with the usage.
      const spec = command === undefined ? undefined : commandSpec(command);
      io.err(error.message);
      io.err(spec === undefined ? USAGE : helpText(spec));
      return 2;
    }
    io.err(plainError(error, dataFolder));
    return 1;
  }
}
