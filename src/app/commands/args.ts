// What every command of `rpe` reads its line with: words and `--name value` (or `--name=value`) flags, each allowed flag at most once, and the error that makes the command line print its usage.



export class UsageError extends Error {}

export type Flags = Readonly<Record<string, string>>;

/** Words, and `--name value` (or `--name=value`) flags, each allowed flag at most once. */
export function parseArgs(argv: readonly string[], allowed: readonly string[]): { words: string[]; flags: Flags } {
  const words: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!allowed.includes(name)) throw new UsageError(`This command does not take --${name}.`);
    if (Object.hasOwn(flags, name)) throw new UsageError(`--${name} is given twice.`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "") throw new UsageError(`--${name} needs a value.`);
    flags[name] = value;
  }
  return { words, flags };
}
