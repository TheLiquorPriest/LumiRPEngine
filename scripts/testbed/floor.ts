// The floor test's command line (STANDALONE-PLAN §17.1). The floor itself is a gate the proof runner
// plays (`scripts/proof/floor/gate.ts`: `bun scripts/proof/run.ts live floor`, or in the rig); this file
// sets its fixture up, takes it away, prints a played run's table from its bundle with the run's standing
// first, and counts runs that give a verdict apart from trials.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { authorEffort, removeFixture, setupFixture } from "./floor-fixture";
import { floorTable, intentCrossCheck, tableText, type FloorRun } from "./floor-measure";
import { readEnv } from "./lib/env";
import { Lumiverse, savedToken } from "./lib/lumiverse";
import { RpeReader } from "../proof/lib/read";
import { buildFromRepos, countApart, readRecord, readRun, standingLines, writeRecord } from "../proof/lib/record";

const USAGE = `usage:
  floor.ts setup
      make the floor's invented card, persona, preset and book (what is missing of them), and set plain
      generation's reasoning to the effort the shipped Author definition names, as RPE serves it
  floor.ts remove
      delete the floor chats, the card, the persona, the preset and the book that setup made
  floor.ts table <bundle> [--rph <RPH checkout>]
      write the floor's record beside the bundle's run.json (scripts/proof/lib/record.ts) and print the
      §17.1 table, the run's standing first; a trial prints its figures and no verdict
  floor.ts runs <folder>
      the floor runs under a folder of bundles, those that give a verdict counted apart from trials

environment, besides what scripts/testbed/README.md lists for every script (setup and remove):
  FLOOR_PLAIN_CONNECTION  the Lumiverse connection that calls the model directly, by name
  FLOOR_RPE_URL           RPE's address, as its server listens (rpe status prints it)
  FLOOR_RPE_TOKEN         a token RPE's pages are let in with (rpe key web)`;

const GATE = "floor";
const RPE_ROOT = resolve(import.meta.dir, "..", "..");

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`set ${name}`);
  return value;
}

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
  if (found.length !== 1) throw new Error(`${found.length} connections are named "${name}"; the floor needs exactly one`);
  await setupFixture(host, effort, (found[0] as { id: string }).id);
}

/** The run kept in the bundle by the floor's form. */
function keptRun(bundle: string): FloorRun {
  const file = join(bundle, GATE, "internal", "play-01", "turns.json");
  if (!existsSync(file)) throw new Error(`${bundle} holds no floor run (${file} is missing)`);
  return JSON.parse(readFileSync(file, "utf8")) as FloorRun;
}

function table(bundle: string, rph: string | null): void {
  const repos = { rpe: RPE_ROOT, rph: rph ?? realpathSync(join(RPE_ROOT, "node_modules", "rp-harness")) };
  const addition = writeRecord(bundle, GATE, buildFromRepos(repos));
  const run = keptRun(bundle);
  process.stdout.write(tableText(floorTable(run), standingLines(readRun(bundle), addition), addition.standing === "trial", intentCrossCheck(run)));
}

function runs(folder: string): void {
  const bundles = readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(folder, e.name, "run.json")) && existsSync(join(folder, e.name, GATE)))
    .map((e) => ({ run: e.name, addition: readRecord(join(folder, e.name), GATE) }));
  const counted = countApart(bundles);
  console.log(`Floor runs under ${folder}: ${counted.verdicts.length} give a verdict, ${counted.trials.length} are trials.`);
  for (const run of counted.verdicts) console.log(`  verdict  ${run}`);
  for (const t of counted.trials) console.log(`  trial    ${t.run}: ${t.why}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === undefined || command === "help" || command === "--help" || command === "-h") console.log(USAGE);
  else if (command === "setup" && rest.length === 0) await setup();
  else if (command === "remove" && rest.length === 0) {
    const env = readEnv();
    await removeFixture(new Lumiverse(env.hostUrl, savedToken(env)), env);
  } else if (command === "table" && (rest.length === 1 || (rest.length === 3 && rest[1] === "--rph"))) table(rest[0] as string, rest[2] ?? null);
  else if (command === "runs" && rest.length === 1) runs(rest[0] as string);
  else {
    console.error(`floor.ts: not a command: ${[command, ...rest].join(" ")}\n\n${USAGE}`);
    process.exit(2);
  }
} catch (error) {
  console.error(`floor.ts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
