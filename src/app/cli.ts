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
import { switchCommand } from "./commands/switch";
import { upCommand } from "./commands/up";
import { versionCommand } from "./commands/version";
import type { Env } from "./config";
import { dataPaths, defaultDataFolder, loadConfig } from "./config";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  env: Env;
  home: string;
  now(): number;
  /** A secret the user gives: piped in, or typed at a prompt that does not show it; null when none is given. */
  secret(question: string): Promise<string | null>;
  /** Resolves when the process is told to stop (Ctrl-C, the service stopping). */
  stopped(): Promise<void>;
  /** Over the network, or, given `unix`, over that Unix socket (the running server's command socket). */
  fetch(url: string, init: BunFetchRequestInit): Promise<Response>;
}

export interface CliOptions {
  version: string;
  /** The areas `serve` mounts besides the app's own. */
  areas?: readonly Area[];
  /** The app file this process runs (`dist/rpe.js`, as `rpe up`'s service starts it): `serve` keeps its hash and restarts onto a new build of it. Absent where there is none. */
  appFile?: string;
}

export const USAGE = [
  "rpe: RPEngine's own application.",
  "",
  "  rpe up --url <address> --user <username> [--systemd] [--name <name>]",
  "         [--lumiverse <folder> [--runtime <name> | --no-runtime] [--runtime-config <folder>]",
  "          [--runtime-data <folder>] [--identifier <id>]]",
  "                                 set RPE up with Lumiverse: sign in, make RPE's connection there,",
  "                                 and say what is left to do; run again, it changes nothing.",
  "                                 --systemd: run RPE as a service of this account (rpe-<name>.service).",
  "                                 --lumiverse: the swap, once the extension runs the new build: wait for",
  "                                 today's build to be idle, stop its service, migrate again from",
  "                                 Lumiverse's data folder, and start RPE's service in its place, at its",
  "                                 address, under its model name and with its key, so its connection",
  "                                 in Lumiverse goes on working; then switch today's service off",
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
  "  rpe allow <name>               switch on something that runs a command or calls out",
  "  rpe deny <name>                switch it off",
  "  rpe backup [--out <file>]      one archive of the database and the file tree",
  "  rpe migrate [--rehearse] --lumiverse <folder> --user <id> [...]",
  "                                 carry today's build's data into RPE; --rehearse writes nothing",
  "                                 (rpe migrate alone lists the rest)",
  "  rpe check [--into <folder>]    whether this build starts on the data folder: its config read, and its",
  "                                 migrations applied to a copy of its database, made under --into (a",
  "                                 temporary folder where none is given) and removed once it ends",
  "",
  "Every command takes --data <folder>: the data folder (default: $RPE_DATA, else ~/.local/share/rpe).",
].join("\n");

/** The flags each command takes. `up` and `down` read their own lines: `up` takes switches as well. */
const FLAGS: Readonly<Record<string, readonly string[]>> = {
  serve: ["data"],
  status: ["data"],
  lumiverse: ["data", "url", "user", "database", "connection"],
  key: ["data"],
  allow: ["data"],
  deny: ["data"],
  backup: ["data", "out"],
  connection: ["data", "name", "provider", "auth", "model", "effort", "base-url", "context-window", "max-tokens"],
  check: ["data", "into"],
};

/** Runs one command; returns the exit code. */
export async function runCli(argv: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "help" || command === "--help") {
      io.out(USAGE);
      return command === undefined ? 2 : 0;
    }
    if (command === "version" || command === "--version") return versionCommand(command, rest, io, options.version);
    // The migration reads its own line, and writes only once it is not a rehearsal; `up` and `down` read theirs, `up` with its switches.
    if (command === "migrate") return await migrateCommand(rest, io, options.version);
    if (command === "up") return await upCommand(rest, io, options.version);
    if (command === "down") return await downCommand(rest, io);
    const allowed = FLAGS[command];
    if (allowed === undefined) throw new UsageError(`rpe has no command "${command}".`);
    const { words, flags } = parseArgs(rest, allowed);
    const paths = dataPaths(flags.data ?? defaultDataFolder(io.env, io.home));
    const config = await loadConfig(paths, io.env);
    if ((command === "serve" || command === "status" || command === "backup" || command === "lumiverse" || command === "check") && words.length > 0) throw new UsageError(`rpe ${command} takes no words.`);
    switch (command) {
      case "serve":
        return await serveCommand(paths, config, io, options);
      case "check":
        return await checkCommand(paths, config, flags.into, io, options);
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
        if (words.length !== 1 || name === undefined) throw new UsageError(`rpe ${command} takes one name.`);
        return await switchCommand(name, command === "allow" ? "on" : "off", paths, config, io, options.version);
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err(USAGE);
      return 2;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
