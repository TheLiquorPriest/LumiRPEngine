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

export const USAGE = [
  "rpe: RPEngine's own application.",
  "",
  "  rpe up [--url <address>] [--user <username>] [--systemd] [--name <name>] [--port <port>]",
  "         [--listen <address>] [--allow-http] [--bun <path>] [--memory <size>] [--database <file>]",
  "         [--lumiverse <folder>] [--runtime <name> | --no-runtime] [--runtime-config <folder>]",
  "         [--runtime-data <folder>] [--identifier <id>]",
  "                                 set RPE up with Lumiverse: ask for the username and password, sign in,",
  "                                 make RPE's connection there, print a web token the first time, say what",
  "                                 is left to do, and serve in the foreground until told to stop; run again,",
  "                                 it changes nothing. --url defaults to the address the config holds;",
  "                                 the username is asked for unless --user (or --username) or",
  "                                 LUMIVERSE_USERNAME gives it",
  "                                 --systemd: run RPE as a service of this account (rpe-<name>.service)",
  "                                 --port, --listen, --allow-http, --bun, --memory: as the install line of",
  "                                 the previous build took them",
  "                                 With the previous build's runtime of yours in Lumiverse's data folder",
  "                                 and the extension switched to the new build, rpe up is the switch: wait",
  "                                 for the previous build to be idle, stop its service, migrate again, and",
  "                                 start RPE's service in its place, at its address, so every connection",
  "                                 in Lumiverse that reached it goes on working; then switch its service",
  "                                 off. Run from the extension's own folder it finds Lumiverse's data",
  "                                 folder itself; --lumiverse names it, and --runtime, --no-runtime,",
  "                                 --runtime-config, --runtime-data and --identifier say where the previous",
  "                                 build's runtime is. With the extension not switched yet, it says so",
  "                                 and changes nothing",
  "  rpe down                       stop and remove RPE's service; its data stays where it is",
  "  rpe serve                      run RPE in the foreground",
  "  rpe status                     what this RPE is, and whether it answers",
  "  rpe version                    this build's id (also rpe --version)",
  "  rpe lumiverse                  which Lumiverse this RPE belongs to, and its sign-in",
  "  rpe lumiverse --url <address> --user <username> [--database <file>] [--connection <id>]",
  "                                 set it and sign in; the password is asked for (or read from the",
  "                                 first line piped in), never kept",
  "  rpe key [provider|web]",
  "                                 make a new key, shown once; the one before it stops working.",
  "                                 After the switch from the previous build the one provider key is the",
  "                                 one your connection in Lumiverse holds, and none is made.",
  "                                 RPE makes the extension's key itself at every start and hands it",
  "                                 over, so there is no command that makes one",
  "  rpe connection list            the model connections",
  "  rpe connection add --name <name> --provider <provider> [--auth key|signin|none]",
  "                     [--model <model>] [--effort <effort>] [--base-url <address>]",
  "                     [--context-window <tokens>] [--max-tokens <tokens>]",
  "                                 add one; its key is asked for, never given on the line",
  "  rpe connection remove <name or id>",
  "  rpe allow [<name>] [--user <id>]  switch on something that runs a command or calls out, or a",
  "                                 connection's key at the place its connection now goes to; with no name,",
  "                                 list each user's own things and where each stands",
  "  rpe deny <name> [--user <id>]  switch it off",
  "  rpe backup [--out <file>]      one archive of the database and the file tree",
  "  rpe migrate [--rehearse] --lumiverse <folder> --user <id> [...]",
  "                                 carry the previous build's data into RPE; --rehearse writes nothing",
  "                                 (rpe migrate alone lists the rest)",
  "  rpe check [--into <folder>] [--within <seconds>]",
  "                                 whether this build starts on the data folder: it is started, as serve",
  "                                 starts it, on a scratch copy of the data (a copy of its database, a fresh",
  "                                 file tree, no Lumiverse), made under --into (a temporary folder where none",
  "                                 is given) and removed once it ends; it passes once it has mounted every",
  "                                 area, laid its shipped files and answered its status with its build,",
  "                                 within --within seconds (the setting commandLine.startMs where none)",
  "",
  "Every command takes --data <folder>: the data folder (default: $RPE_DATA, else ~/.local/share/rpe).",
].join("\n");

/** The flags each command takes. `up` and `down` read their own lines: `up` takes switches as well. */
const FLAGS: Readonly<Record<string, readonly string[]>> = {
  serve: ["data"],
  status: ["data"],
  lumiverse: ["data", "url", "user", "database", "connection"],
  key: ["data"],
  allow: ["data", "user"],
  deny: ["data", "user"],
  backup: ["data", "out"],
  connection: ["data", "name", "provider", "auth", "model", "effort", "base-url", "context-window", "max-tokens"],
  check: ["data", "into", "within"],
};

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
    if (command === undefined || command === "help" || command === "--help") {
      io.out(USAGE);
      return command === undefined ? 2 : 0;
    }
    if (command === "version" || command === "--version") return versionCommand(command, rest, io, options.version);
    // The migration reads its own line, and writes only once it is not a rehearsal; `up` and `down` read theirs, `up` with its switches.
    if (command === "migrate") return await migrateCommand(rest, io, options.version);
    if (command === "up") return await upCommand(rest, io, options, (paths, config) => serveCommand(paths, config, io, options));
    if (command === "down") return await downCommand(rest, io);
    const allowed = FLAGS[command];
    if (allowed === undefined) throw new UsageError(`rpe has no command "${command}".`);
    const { words, flags } = parseArgs(rest, allowed);
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
      io.err(error.message);
      io.err(USAGE);
      return 2;
    }
    io.err(plainError(error, dataFolder));
    return 1;
  }
}
