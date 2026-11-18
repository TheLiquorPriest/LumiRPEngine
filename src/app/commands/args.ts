// What every command of `rpe` reads its line with: words, options as `--name value` or `--name=value`, and the error that makes the command
// line print its usage. Which options a command takes is the table's (`table.ts`): one it does not give that command is refused here.

import { commandSpec, type OptionSpec } from "./table";

export class UsageError extends Error {}

export type Flags = Readonly<Record<string, string>>;

/** A command's line, read. */
export interface Line {
  words: string[];
  /** The options that take a value, each given once, by name. */
  flags: Flags;
  /** The switches given, by name. */
  switches: ReadonlySet<string>;
  /** The options that may be given again (`--mine`, `--theirs`), each with its values in the order given. */
  repeated: Readonly<Record<string, readonly string[]>>;
}

/** Reads `argv`, the words after the command's name, as the table says `command` takes them. */
export function parseArgs(argv: readonly string[], command: string): Line {
  const spec = commandSpec(command);
  if (spec === undefined) throw new Error(`The table of commands has no command ${command}.`);
  const options = new Map<string, OptionSpec>(spec.options.map((o) => [o.name, o]));
  const words: string[] = [];
  const flags: Record<string, string> = {};
  const switches = new Set<string>();
  const repeated: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!/^--?[A-Za-z]/.test(arg)) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") ? (eq === -1 ? arg.slice(2) : arg.slice(2, eq)) : arg.slice(1);
    const option = arg.startsWith("--") ? options.get(name) : undefined;
    if (option === undefined) throw new UsageError(`This command does not take ${arg.startsWith("--") ? `--${name}` : arg}. rpe ${command} --help says what it takes.`);
    if (option.takes === undefined) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value.`);
      switches.add(name);
      continue;
    }
    // `--name value`: a value never starts with `--`, so `--data --rehearse` is a folder left out, never a folder named `--rehearse`; `--name=--value` says it.
    const next = argv[i + 1];
    if (eq === -1 && next !== undefined && next.startsWith("--")) throw new UsageError(`--${name} needs a value, and ${next} is an option.`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "") throw new UsageError(`--${name} needs a value.`);
    if (option.repeat === true) (repeated[name] ??= []).push(value);
    else if (Object.hasOwn(flags, name)) throw new UsageError(`--${name} is given twice.`);
    else flags[name] = value;
  }
  return { words, flags, switches, repeated };
}
