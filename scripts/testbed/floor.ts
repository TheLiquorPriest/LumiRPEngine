// The floor test's command line (STANDALONE-PLAN §17.1). The floor itself is a gate the proof runner
// plays (`scripts/proof/floor/gate.ts`: `bun scripts/proof/run.ts live floor`, or in the rig); this file
// sets its fixture up, takes it away, prints a played run's table from its bundle with the runner's
// standing first (read from `run.json`, never worked out again: PlanGates-42), and counts runs that give
// a verdict apart from trials, a run giving one only where `run.json` says so and the floor's own
// record of it names no trial and no stop (PlanGates-4-fix2 item 4). Where `run.json` gives no account of the guidance, the record lays the
// build's shipped tree from RPE's repository at the run's commit and RPH's installed folder, which is no
// git repository (R-196), and says whether the floor's chat was served it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { authorEffort, fileRecord, RECORD_FILE, removeFixture, setupFixture } from "./floor-fixture";
import { floorHead, floorTable, intentCrossCheck, noVerdict, noVerdictKind, tableText, type FloorRun } from "./floor-measure";
import { readEnv } from "./lib/env";
import { Lumiverse, savedToken } from "./lib/lumiverse";
import { RpeReader } from "../proof/lib/read";
import { standingOfRun } from "../proof/route/evidence";
import { additionLines, buildFrom, countApart, installedRph, readRun, standingLines, writeRecord } from "../proof/lib/record";

const USAGE = `usage:
  floor.ts setup
      make the floor's invented card, persona, preset and book (what is missing of them), list each by id in
      the fixture's record, and set plain generation's reasoning to the effort the shipped Author definition
      names, as RPE serves it
  floor.ts remove
      delete what the fixture's record lists: its chats, card, persona, preset and book
  floor.ts table <bundle> [--rph <RPH's installed shipped folder>]
      write the floor's record beside the bundle's run.json (scripts/proof/lib/record.ts) and print the
      §17.1 table, the runner's standing first; a trial prints its figures and no verdict
  floor.ts runs <folder>
      the floor runs under a folder of bundles, those that give a verdict counted apart from trials

environment, besides what scripts/testbed/README.md lists for every script (setup and remove):
  FLOOR_PLAIN_CONNECTION  the Lumiverse connection that calls the model directly, by name
  FLOOR_RPE_URL           RPE's address, as its server listens (rpe status prints it)
  FLOOR_RPE_TOKEN         a token RPE's pages are let in with (rpe key web)
the fixture's record is kept in LRE_INSTANCE_DIR as ${RECORD_FILE}; the floor's play finds its fixture by the ids it lists`;

const GATE = "floor";
const RPE_ROOT = resolve(import.meta.dir, "..", "..");

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`set ${name}`);
  return value;
}

/** The fixture's record of an instance: in the scripts' own folder for it. */
const recordFile = (instanceDir: string): string => join(instanceDir, RECORD_FILE);

async function setup(): Promise<void> {
  const env = readEnv();
  const host = new Lumiverse(env.hostUrl, savedToken(env));
  const rpe = new RpeReader(need("FLOOR_RPE_URL").replace(/\/+$/, ""), need("FLOOR_RPE_TOKEN"));
  // The effort the shipped Author definition names, read as the server runs it (R-92): never one of the script's.
  const definition = await rpe.viewFile("", "@shipped/.agents/author.md");
  const effort = authorEffort(definition);
  if (effort === null) throw new Error("the shipped Author definition names no effort, so the floor has none to set plain generation to");
  const name = need("FLOOR_PLAIN_CONNECTION");
  const found = (await host.connections()).filter((c) => c.name === name);
  const [connection] = found;
  if (found.length !== 1 || connection === undefined) throw new Error(`${found.length} connections are named "${name}"; the floor needs exactly one`);
  const made = await setupFixture(host, effort, connection.id, fileRecord(recordFile(env.instanceDir)));
  console.log(made.lines.join("\n"));
}

/** The run kept in the bundle by the floor's form. */
function keptRun(bundle: string): FloorRun {
  const file = join(bundle, GATE, "internal", "play-01", "turns.json");
  if (!existsSync(file)) throw new Error(`${bundle} holds no floor run (${file} is missing)`);
  return JSON.parse(readFileSync(file, "utf8")) as FloorRun;
}

/** The floor's table of a bundle, its record written beside run.json: the runner's standing, what the record adds, the floor's own trial and stop, then the rows. */
export function table(bundle: string, rph: string = installedRph(RPE_ROOT)): string {
  const addition = writeRecord(bundle, GATE, buildFrom(RPE_ROOT, rph));
  const run = readRun(bundle);
  const floor = keptRun(bundle);
  const kind = noVerdictKind(floor, standingOfRun(run).is === "trial");
  return tableText(floorTable(floor), [...standingLines(run), ...additionLines(addition), ...floorHead(floor)], kind, intentCrossCheck(floor));
}

/** Why the floor's own record of a bundle's run gives it no verdict: the floor's trial or stop it names, or the record that could not be read; empty when it names none. */
function floorReasons(bundle: string): string[] {
  try {
    const none = noVerdict(keptRun(bundle));
    return none === null ? [] : [`the floor's own ${none.kind}: ${none.why}`];
  } catch (error) {
    return [`the floor's own record of the run could not be read: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** The floor runs under a folder, counted apart by the runner's standing and by the floor's own record: a run gives a verdict only where both say so. */
export function runs(folder: string): string {
  const bundles = readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(folder, e.name, "run.json")) && existsSync(join(folder, e.name, GATE)))
    .map((e) => ({ run: readRun(join(folder, e.name)), own: floorReasons(join(folder, e.name)) }));
  const counted = countApart(bundles);
  return [`Floor runs under ${folder}: ${counted.verdicts.length} give a verdict, ${counted.trials.length} are trials.`, ...counted.verdicts.map((run) => `  verdict  ${run}`), ...counted.trials.map((t) => `  trial    ${t.run}: ${t.why}`)].join("\n");
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") console.log(USAGE);
    else if (command === "setup" && rest.length === 0) await setup();
    else if (command === "remove" && rest.length === 0) {
      const env = readEnv();
      console.log((await removeFixture(new Lumiverse(env.hostUrl, savedToken(env)), env, fileRecord(recordFile(env.instanceDir)))).join("\n"));
    } else if (command === "table" && (rest.length === 1 || (rest.length === 3 && rest[1] === "--rph"))) process.stdout.write(table(rest[0] as string, rest[2]));
    else if (command === "runs" && rest.length === 1) console.log(runs(rest[0] as string));
    else {
      console.error(`floor.ts: not a command: ${[command, ...rest].join(" ")}\n\n${USAGE}`);
      process.exit(2);
    }
  } catch (error) {
    console.error(`floor.ts: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
