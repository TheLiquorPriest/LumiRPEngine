// `bun scripts/proof/run.ts <command>`: the proof scripts' runner (PlanScenarios-1; plan §17.0, §17.4,
// §18.3, §18.4).
//
//   check                         every scenario and gate script found and checked: the plan's 68 by
//                                 number with their waves, and what cannot be played as the plan asks
//   rig <ids> | --wave <w> | --all
//                                 plays rig forms in the rig (PlanScenarios-2's scripts/proof/rig/host.ts)
//   live <ids>                    plays live forms on the test bed (PlanScenarios-3's scripts/proof/live/host.ts),
//                                 only through PlanScenarios-5's cheap gate and the bed's lock
//   round                         every live form and every gate, in the order PlanScenarios-50 sets
//                                 (scripts/proof/round/order.ts), through the same gate and lock
//   report <run folder>           the report, written again from a run's bundle alone
//   checkpoint <w>                a wave's checkpoint (PlanScenarios-5's scripts/proof/checkpoint/checkpoint.ts)
//
// An id is a scenario's number, one stage of a staged scenario (`<number>:<stage>`) or a gate's id,
// each asked once. A run plays no script `check` faults,
// writes its bundle and its report under `--out` (or RPE_PROOF_OUT), a folder kept outside the
// repository, and names who started it with `--by` (or RPE_PROOF_BY). `--repeats` sets how many plays
// an "as shipped" part gets live, over scripts/proof/settings.json. `--root` is the proof folder to
// look in, this file's own by default. An option a command does not take, or one given no value, is a
// usage error. A run's exit code is 0 only when everything asked was played and passed (or measured
// as a rate) and its evidence holds no fault; `report` gives the same code for the bundle it reads.

import { resolve } from "node:path";
import { check, describeCheck } from "./route/check";
import { BundleRefused, readBundle } from "./route/evidence";
import type { LiveGuard, Mode } from "./route/host";
import { exitCode, writeReport } from "./route/report";
import { isRepeats, loadCheckpoint, loadGuard, loadHost, loadOrder, NothingToPlay, play, readSettings, round, RunRefused, type RunOptions, type Selection } from "./route/runner";

const ROOT = import.meta.dir;

/** The words a command line gave: the command, the words after it, and its `--name value` options; an option given no value holds "". */
export interface Args {
  command: string;
  words: string[];
  options: Map<string, string>;
}

/** Options that take no value. */
const FLAGS: Record<string, true> = { all: true };

/** The options each command takes; `checkpoint` hands its words on to the wave's checkpoint, which reads its own. */
const TAKES: Record<string, readonly string[]> = {
  check: ["root"],
  rig: ["root", "out", "by", "repeats", "wave", "all"],
  live: ["root", "out", "by", "repeats"],
  round: ["root", "out", "by", "repeats"],
  report: [],
};

export function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv;
  const words: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] ?? "";
    if (!word.startsWith("--")) words.push(word);
    else if (word.includes("=")) options.set(word.slice(2, word.indexOf("=")), word.slice(word.indexOf("=") + 1));
    // The next word is this option's value unless it is another option: `--wave --root x` gives --wave none.
    else if (!FLAGS[word.slice(2)] && i + 1 < rest.length && !(rest[i + 1] ?? "").startsWith("--")) options.set(word.slice(2), rest[++i] ?? "");
    else options.set(word.slice(2), "");
  }
  return { command, words, options };
}

/** What a test may give in place of what the runner finds on disk. */
export interface Deps {
  out?: (text: string) => void;
  openHost?: RunOptions["openHost"];
  guard?: LiveGuard;
  now?: () => Date;
}

/** Why the options given cannot be taken by the command; null when they can. */
function optionFault(args: Args): string | null {
  const takes = TAKES[args.command];
  if (!takes) return null;
  for (const [name, value] of args.options) {
    if (!takes.includes(name)) return `the command ${args.command} takes no option --${name}`;
    if (!FLAGS[name] && value === "") return name === "wave" ? "--wave needs a wave from 0 (the ground) to 5 (the formal round)" : `--${name} needs a value`;
  }
  return null;
}

/** Runs one command; returns its exit code. */
export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const out = deps.out ?? ((text: string) => process.stdout.write(text));
  const args = parseArgs(argv);
  const fault = optionFault(args);
  if (fault) return usage(out, fault);
  const root = resolve(args.options.get("root") || ROOT);
  try {
    switch (args.command) {
      case "check": {
        const result = await check(root);
        out(describeCheck(result));
        return result.faults.length === 0 ? 0 : 1;
      }
      case "rig":
      case "live":
      case "round":
        return await playing(args.command, args, root, deps, out);
      case "report": {
        const dir = args.words[0];
        if (!dir || args.words.length > 1) return usage(out, "report needs the one run's folder");
        out(writeReport(resolve(dir)));
        return exitCode(readBundle(resolve(dir)));
      }
      case "checkpoint": {
        const wave = Number(args.words[0]);
        if (!Number.isInteger(wave) || wave < 1 || wave > 5) return usage(out, "checkpoint needs a wave from 1 to 5");
        const checkpoint = await loadCheckpoint(root);
        if (!checkpoint) {
          out("Refused: a wave's checkpoint is PlanScenarios-5's scripts/proof/checkpoint/checkpoint.ts, and it is not here.\n");
          return 1;
        }
        return await checkpoint(wave, argv.slice(2));
      }
      default:
        return usage(out, `unknown command "${args.command}"`);
    }
  } catch (error) {
    if (error instanceof NothingToPlay) return usage(out, error.message);
    if (error instanceof RunRefused || error instanceof BundleRefused) {
      out(`Refused: ${error.message}.\n`);
      return 1;
    }
    throw error;
  }
}

async function playing(command: "rig" | "live" | "round", args: Args, root: string, deps: Deps, out: (text: string) => void): Promise<number> {
  const mode: Mode = command === "rig" ? "rig" : "live";
  const where = args.options.get("out") || process.env.RPE_PROOF_OUT || "";
  const by = args.options.get("by") || process.env.RPE_PROOF_BY || "";
  if (where === "") return usage(out, "a run needs --out <folder> (or RPE_PROOF_OUT), outside the repository, for its bundle");
  if (by === "") return usage(out, "a run needs --by <who> (or RPE_PROOF_BY), who started it");
  const repeatsWord = args.options.get("repeats");
  const repeats = repeatsWord === undefined ? readSettings(root).repeats : Number(repeatsWord);
  if (!isRepeats(repeats)) return usage(out, "--repeats is a whole number of at least 1");
  const selection = command === "round" ? null : selectionOf(args, mode);
  if (typeof selection === "string") return usage(out, selection);
  if (command === "round" && args.words.length > 0) return usage(out, "round plays everything, in the round's order");
  const openHost = deps.openHost ?? (await loadHost(root, mode));
  if (!openHost) throw new RunRefused(mode === "rig" ? "the rig is PlanScenarios-2's scripts/proof/rig/host.ts, and it is not here" : "the test bed's host is PlanScenarios-3's scripts/proof/live/host.ts, and it is not here");
  const guard = deps.guard ?? (mode === "live" ? await loadGuard(root) : null) ?? undefined;
  const options: RunOptions = { root, out: resolve(where), by, mode, repeats, openHost, guard, now: deps.now };
  let done;
  if (selection === null) {
    const order = await loadOrder(root);
    if (!order) throw new RunRefused("the round's order is PlanScenarios-50's scripts/proof/round/order.ts, and it is not here");
    done = await round(options, order);
  } else done = await play(options, selection);
  out(done.report);
  out(`\nThe bundle: ${done.dir}\n`);
  return done.code;
}

/** What `rig` or `live` was asked to play, or why the words ask nothing it can play. */
function selectionOf(args: Args, mode: Mode): Selection | string {
  const wave = args.options.get("wave");
  const all = args.options.has("all");
  if (mode === "live" && (wave !== undefined || all)) return "live plays the ids it is given; a wave's checkpoint and the round have commands of their own";
  if ([args.words.length > 0, wave !== undefined, all].filter(Boolean).length !== 1) return `${mode} needs ids, --wave <w> or --all, and only one of them`;
  if (all) return { all: true };
  if (wave !== undefined) {
    const w = Number(wave);
    return /^\d$/.test(wave) && w >= 0 && w <= 5 ? { wave: w } : "--wave needs a wave from 0 (the ground) to 5 (the formal round)";
  }
  return { ids: args.words };
}

function usage(out: (text: string) => void, why: string): number {
  out(`${why[0]?.toUpperCase()}${why.slice(1)}.\nThe commands: check; rig <ids> | --wave <w> | --all; live <ids>; round; report <run folder>; checkpoint <w>.\n`);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
