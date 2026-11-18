// The one table of the commands of `rpe` and their options. It feeds the whole usage (`rpe`, `rpe help`, `rpe --help`), each command's
// own help (`rpe <command> --help`, `-h`) and the reading of every command's line (`parseArgs`, `args.ts`), which refuses an option the
// table does not give that command, so the three cannot drift apart. `docs/install.md` lists every command; a test holds the two together.

/** One option of a command. A switch takes no value; any other takes the value `takes` names, as `--name value` or `--name=value`. */
export interface OptionSpec {
  name: string;
  /** What it takes, as the usage writes it (`<folder>`); absent: a switch. */
  takes?: string;
  about: string;
  /** What it is where it is not given, in words. */
  default?: string;
  /** May be given again, each value counting (`--mine`, `--theirs`). */
  repeat?: true;
  /** The command cannot run without it. */
  required?: true;
}

export interface CommandSpec {
  name: string;
  /** The words that follow the command's name on its line, as the usage writes them (`[provider|web]`). */
  words?: string;
  /** What it does, in a line or two: the usage's text for it. */
  summary: string;
  /** What else its own help says, a line each. */
  about?: readonly string[];
  options: readonly OptionSpec[];
  /** One example, where the docs give one, as they write it. */
  example?: string;
}

/** Where RPE's data folder is where `--data` does not say (`defaultDataFolder`, `config.ts`). */
const DATA_DEFAULT = "$RPE_DATA, else $XDG_DATA_HOME/rpe, else ~/.local/share/rpe";

const DATA: OptionSpec = { name: "data", takes: "<folder>", about: "RPE's data folder", default: DATA_DEFAULT };

/** `--help` and `-h`: every command takes them, and nothing runs. */
export const HELP_FLAGS: readonly string[] = ["--help", "-h"];

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "up",
    summary: "set RPE up with Lumiverse: ask for the username and password, sign in, make RPE's connection there, print a web token the first time, say what is left to do, and serve in the foreground until told to stop; run again, it changes only what is not as it should be",
    about: [
      "The password is asked for and never kept.",
      "With the previous build's runtime of yours in Lumiverse's data folder and the extension switched to the new build, rpe up is the switch: it waits for the previous build to be idle, stops its service, migrates again, starts RPE's service in its place, at its address, so every connection in Lumiverse that reached it goes on working, then switches its service off. Run from the extension's own folder it finds Lumiverse's data folder itself; --lumiverse names it, and --runtime, --no-runtime, --runtime-config, --runtime-data and --identifier say where the previous build's runtime is.",
      "With the extension not switched yet, it says so and changes nothing.",
    ],
    options: [
      { name: "url", takes: "<address>", about: "Lumiverse's address, as you open it in a browser", default: "the address RPE's config holds, else LUMIVERSE_URL, else asked" },
      { name: "user", takes: "<username>", about: "your Lumiverse username", default: "LUMIVERSE_USERNAME, else the kept sign-in's, else asked" },
      { name: "username", takes: "<username>", about: "the same as --user" },
      { name: "systemd", about: "run RPE as a service of this account (rpe-<name>.service)" },
      { name: "name", takes: "<name>", about: "the service's name", default: "the name of the service already there for this data folder, else made from the username" },
      { name: "port", takes: "<port>", about: "the port RPE listens on, as the install line of the previous build took it", default: "the config's port (7871 as shipped); where taken, the first free one after it" },
      { name: "listen", takes: "<address>", about: "the address RPE listens on besides loopback", default: "127.0.0.1" },
      { name: "allow-http", about: "accept a plain http address of another machine, where your password and the session token would cross the network in clear" },
      { name: "bun", takes: "<path>", about: "the Bun the service runs, as an absolute path", default: "the Bun running this command" },
      { name: "memory", takes: "<size>", about: "the most memory the service may hold, as systemd reads a size (768M, 2G or infinity), at least 256M; kept as the setting service.memory" },
      { name: "database", takes: "<file>", about: "Lumiverse's database file, where this does not run from the extension's own folder", default: "the one beside the extension, where run from its folder" },
      { name: "lumiverse", takes: "<folder>", about: "Lumiverse's data folder: it asks for the switch from the previous build", default: "where the extension sits, where run from its own folder" },
      { name: "runtime", takes: "<name>", about: "the runtime of the previous build that is yours; every other runtime there is left alone", default: "the one you registered with this Lumiverse" },
      { name: "no-runtime", about: "the server runs no runtime of the previous build for you" },
      { name: "runtime-config", takes: "<folder>", about: "the previous runtime's config folder", default: "where the previous runtime finds it, ~/.config/lumiah" },
      { name: "runtime-data", takes: "<folder>", about: "the previous runtime's data folder", default: "where the previous runtime finds it, ~/.local/share/lumiah" },
      { name: "identifier", takes: "<id>", about: "the extension's identifier in Lumiverse", default: "lumi_rp_engine" },
      DATA,
    ],
    example: "rpe up --url <Lumiverse's address> --user <your username>",
  },
  { name: "down", summary: "stop and remove RPE's service; its data stays where it is, and the steps of going back are printed", options: [DATA] },
  { name: "serve", summary: "run RPE in the foreground", options: [DATA] },
  { name: "status", summary: "what this RPE is, and whether it answers", options: [DATA] },
  { name: "version", summary: "this build's id (also rpe --version)", options: [] },
  {
    name: "lumiverse",
    summary: "which Lumiverse this RPE belongs to, and its sign-in; with --url and --user, set it and sign in (the password is asked for, or read from the first line piped in, never kept)",
    options: [
      { name: "url", takes: "<address>", about: "Lumiverse's address; with --user, it signs in again", default: "the address RPE's config holds" },
      { name: "user", takes: "<username>", about: "your Lumiverse username; with --url, it signs in again and prints the id of your Lumiverse user" },
      { name: "database", takes: "<file>", about: "Lumiverse's database file, read directly; given with --url and --user" },
      { name: "connection", takes: "<id>", about: "RPE's connection in Lumiverse; given with --url and --user" },
      DATA,
    ],
    example: "rpe lumiverse --url <Lumiverse's address> --user <your username>",
  },
  {
    name: "key",
    words: "[provider|web]",
    summary: "make a new key, shown once; the one before it stops working. After the switch from the previous build the one provider key is the one your connection in Lumiverse holds, and none is made. RPE makes the extension's key itself at every start and hands it over, so there is no command that makes one",
    options: [DATA],
    example: "rpe key web",
  },
  {
    name: "connection",
    words: "list | add | remove <name or id>",
    summary: "RPE's model connections: list them, add one (its key is asked for, never given on the line), or remove one; RPE must be running",
    options: [
      { name: "name", takes: "<name>", about: "the new connection's name; needed by add" },
      { name: "provider", takes: "<provider>", about: "the new connection's provider; needed by add" },
      { name: "auth", takes: "key|signin|none", about: "how the connection signs in", default: "key" },
      { name: "model", takes: "<model>", about: "the connection's model" },
      { name: "effort", takes: "<effort>", about: "the connection's reasoning effort" },
      { name: "base-url", takes: "<address>", about: "the provider's address, where it is not the provider's own" },
      { name: "context-window", takes: "<tokens>", about: "the model's context window; needs --model" },
      { name: "max-tokens", takes: "<tokens>", about: "the model's longest reply; needs --model" },
      DATA,
    ],
    example: "rpe connection add --name deepseek --provider deepseek --model deepseek-v4-flash",
  },
  {
    name: "allow",
    words: "[<name>]",
    summary: "switch on something that runs a command or calls out, or a connection's key at the place its connection now goes to; with no name, list each user's own things and where each stands",
    options: [{ name: "user", takes: "<id>", about: "the Lumiverse user whose own it is", default: "the user this RPE belongs to" }, DATA],
    example: "rpe allow <name>",
  },
  {
    name: "deny",
    words: "<name>",
    summary: "switch it off",
    options: [{ name: "user", takes: "<id>", about: "the Lumiverse user whose own it is", default: "the user this RPE belongs to" }, DATA],
    example: "rpe deny <name>",
  },
  {
    name: "backup",
    summary: "one archive of the database and the file tree",
    options: [{ name: "out", takes: "<file>", about: "where to write the archive; a file that is there is never written over", default: "backups/rpe-backup-<time>.tar in the data folder" }, DATA],
  },
  {
    name: "migrate",
    summary: "carry the previous build's data into RPE; --rehearse writes nothing (rpe migrate alone lists the rest)",
    about: [
      "Run from a copy of the new build in any folder while the previous build goes on running. A rehearsal reads everything, writes nothing and prints the report; the real run takes a backup and carries the data into RPE's data folder, the only place it writes.",
      "It exits 0 where the real run may start (after a rehearsal) or is done, 1 where it won't start or stopped, 2 where its line is not understood.",
    ],
    options: [
      { name: "rehearse", about: "read everything, write nothing, print the report" },
      { name: "lumiverse", takes: "<folder>", about: "Lumiverse's data folder (the one holding lumiverse.db)", required: true },
      { name: "user", takes: "<id>", about: "the id of the Lumiverse user whose data moves", required: true },
      { name: "runtime-config", takes: "<folder>", about: "the previous runtime's config folder", default: "as the previous runtime finds it, ~/.config/lumiah" },
      { name: "runtime-data", takes: "<folder>", about: "the previous runtime's data folder", default: "as the previous runtime finds it, ~/.local/share/lumiah" },
      { name: "runtime", takes: "<name>", about: "the runtime of the previous build that is this user's; every other runtime there is left alone", default: "the one they registered with this Lumiverse" },
      { name: "no-runtime", about: "the server runs no runtime of the previous build for this user" },
      { name: "mine", takes: "<name>", about: "a runtime folder no config names holds this user's working copy (give it again for each folder)", repeat: true },
      { name: "theirs", takes: "<name>", about: "a runtime folder no config names is not this user's: it is left alone", repeat: true },
      { name: "identifier", takes: "<id>", about: "the extension's identifier in Lumiverse", default: "lumi_rp_engine" },
      { name: "json", about: "print the report as JSON instead of words" },
      { ...DATA, about: "RPE's data folder: the only place the real run writes" },
    ],
    example: "rpe migrate --rehearse --lumiverse <Lumiverse's data folder> --user <your user id>",
  },
  {
    name: "check",
    summary: "whether this build starts on the data folder: it is started, as serve starts it, on a scratch copy of the data (a copy of its database, a fresh file tree, no Lumiverse), made under --into and removed once it ends; it passes once it has mounted every area, laid its shipped files and answered its status with its build",
    options: [
      { name: "into", takes: "<folder>", about: "where the scratch copy is made; the folder must be there", default: "a temporary folder" },
      { name: "within", takes: "<seconds>", about: "how long the build has to answer, at least 1", default: "the setting commandLine.startMs" },
      DATA,
    ],
  },
];

/** The command the table gives under `name`, or undefined. */
export function commandSpec(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** `[--name <takes>]` as a usage writes an option; without its brackets where the command needs it. */
function synopsisOf(option: OptionSpec): string {
  const text = `--${option.name}${option.takes === undefined ? "" : ` ${option.takes}`}`;
  return option.required === true ? text : `[${text}]`;
}

/** Words broken into lines of at most `width` characters, each after the first indented. */
function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = `${indent}${word}`;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** A command's line as the usage writes it: its name, its words and each of its options, broken into lines under it, an option never in two. */
function lineOf(spec: CommandSpec, lead: string, width: number): string[] {
  // `--data` is every command's and is said once, below the lines. Each unit's spaces are held as no-break spaces while the line is broken.
  const held = (unit: string): string => unit.replaceAll(" ", "\u00a0");
  const units = [`rpe ${spec.name}`, ...(spec.words === undefined ? [] : [spec.words]), ...spec.options.filter((o) => o.name !== "data").map(synopsisOf)].map(held);
  return wrap(units.join(" "), width, "    ").map((l) => `${lead}${l.replaceAll("\u00a0", " ")}`);
}

/** The whole usage: each command's line with every option it takes, and what it does. */
export function usageText(): string {
  const lines = ["rpe: RPEngine's own application.", ""];
  const column = 33;
  for (const spec of COMMANDS) {
    const line = lineOf(spec, "  ", 96);
    const said = wrap(spec.summary, 86, "");
    const [only] = line;
    // A line that leaves room has what the command does beside it; a longer one, under it.
    if (line.length === 1 && only !== undefined && only.length < column - 1) {
      const [first, ...rest] = said;
      lines.push(`${only.padEnd(column)}${first ?? ""}`, ...rest.map((l) => `${" ".repeat(column)}${l}`));
    } else lines.push(...line, ...said.map((l) => `${" ".repeat(column)}${l}`));
  }
  lines.push("", "Every command but version takes --data <folder>: the data folder (default: $RPE_DATA, else ~/.local/share/rpe).", "`rpe <command> --help` (or -h) says what one command takes, with each option's default, and runs nothing.");
  return lines.join("\n");
}

/** One command's own help: its line, what it does, each option with what it takes and its default, and an example where the docs have one. */
export function helpText(spec: CommandSpec): string {
  const lines = [...wrap(`rpe ${spec.name}: ${spec.summary}`, 96, "  "), "", "Usage:", ...lineOf(spec, "  ", 96)];
  for (const paragraph of spec.about ?? []) lines.push("", ...wrap(paragraph, 96, ""));
  const options = [...spec.options, { name: "help", about: "this help; nothing is run" } satisfies OptionSpec];
  const shown = options.map((o) => (o.name === "help" ? "--help, -h" : `--${o.name}${o.takes === undefined ? "" : ` ${o.takes}`}`));
  const width = Math.max(...shown.map((s) => s.length));
  lines.push("", "Options:");
  options.forEach((o, i) => {
    const text = `${o.about}${o.default === undefined ? "" : ` (default: ${o.default})`}`;
    const [first, ...rest] = wrap(text, 80, "");
    lines.push(`  ${(shown[i] ?? "").padEnd(width)}  ${first ?? ""}`, ...rest.map((l) => `  ${" ".repeat(width)}  ${l}`));
  });
  if (spec.example !== undefined) lines.push("", "Example:", `  ${spec.example}`);
  return lines.join("\n");
}
