// The cheap gate (PlanScenarios-5 item 1; plan §17.0 l.1750: "the cheap gate before any live run is both suites and
// the scripted rig passing"): both typechecks, both whole suites (each repository's own `scripts/test-all.ts`, every
// file in its process, which holds each repository's run of the contract kit), and every rig form that exists, on
// exactly the RPE and RPH commits a live run will use, from a tree with no changes in it. Its result is kept with
// those commits (`record.ts`); the live runner admits a run only on a pair whose record passed (`guard.ts`).
//
//   bun scripts/proof/gate/cheap.ts            plays the gate on the checkout it is in, and writes its record
//
// Needs: `RPE_PROOF_RECORDS` (where the records are kept, outside both repositories), `RPE_PROOF_RPH_REPO` (a
// repository that holds RPH's commit: its checkout, whose own typecheck and suite are the ones the gate runs).
// A step that fails ends nothing early: every step runs, and the record says which did not pass.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkoutProblems, type GuardPlaces, placesFromEnv } from "./guard";
import { installedTag, pinProblems } from "./pin";
import { type GateRecord, type GateStep, writeGate } from "./record";

/** One command the gate runs, and what its end means. */
export interface Planned {
  name: string;
  command: string[];
  cwd: string;
  /** Whether an exit code passes the step, and the words for it. */
  judge(code: number): { ok: boolean; note: string };
}

const exit0 = (code: number): { ok: boolean; note: string } => ({ ok: code === 0, note: code === 0 ? "passed" : `exit ${code}` });

/** The steps of the gate, as commands. `out` is a folder the rig's run writes its bundle in. */
export function plan(places: GuardPlaces, out: string, bun: string = process.execPath): Planned[] {
  const rph = places.rphRepo;
  const steps: Planned[] = [
    { name: "RPE typecheck", command: [bun, "x", "tsc", "--noEmit", "-p", "."], cwd: places.repo, judge: exit0 },
    { name: "RPE preview typecheck", command: [bun, "x", "tsc", "--noEmit", "-p", "dev/preview"], cwd: places.repo, judge: exit0 },
  ];
  if (rph !== null) steps.push({ name: "RPH typecheck", command: [bun, "x", "tsc", "--noEmit", "-p", "."], cwd: rph, judge: exit0 });
  steps.push({ name: "RPE whole suite", command: [bun, "scripts/test-all.ts"], cwd: places.repo, judge: exit0 });
  if (rph !== null) steps.push({ name: "RPH whole suite", command: [bun, "scripts/test-all.ts"], cwd: rph, judge: exit0 });
  steps.push({
    name: "rig forms",
    command: [bun, "scripts/proof/run.ts", "rig", "--all", "--out", out, "--by", "the cheap gate"],
    cwd: places.repo,
    // Exit 0 is a verdict whose forms passed; 2 is a run that had no form to play (a usage error), which no form failed; any other code is a form that failed, was not seen or could not be played, or a trial.
    judge: (code) => (code === 0 ? { ok: true, note: "every rig form passed" } : code === 2 ? { ok: true, note: "no rig form exists to play" } : { ok: false, note: `exit ${code}` }),
  });
  return steps;
}

/** Runs the steps with `run` (a process runner, injected by a test) and gives the record for the commits. */
export async function play(places: GuardPlaces, run: (command: string[], cwd: string) => Promise<{ code: number | null; tail: string }>, now: () => Date = () => new Date()): Promise<{ record: GateRecord } | { refused: string[] }> {
  const head = Bun.spawnSync(["git", "-C", places.repo, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout.toString().trim();
  const tag = installedTag(places.repo);
  const refused = [...checkoutProblems(places.repo, head), ...(tag === null ? ["the installed rp-harness holds no .bun-tag: its commit is not known"] : [])];
  if (refused.length > 0) return { refused };
  const out = mkdtempSync(join(tmpdir(), "rpe-gate-"));
  try {
    const steps: GateStep[] = [];
    for (const step of plan(places, out)) {
      const started = Date.now();
      const done = await run(step.command, step.cwd).catch((error: unknown) => ({ code: null, tail: error instanceof Error ? error.message : String(error) }));
      const judged = done.code === null ? { ok: false, note: `could not start: ${done.tail}` } : step.judge(done.code);
      steps.push({ name: step.name, command: step.command.map((word, i) => (i === 0 ? "bun" : word)), cwd: step.cwd, code: done.code, seconds: Math.round((Date.now() - started) / 100) / 10, ok: judged.ok, note: judged.ok ? judged.note : `${judged.note}${done.tail === "" ? "" : `: ${done.tail}`}` });
    }
    const pin = pinProblems(places.repo, places.rphRepo);
    return { record: { rpe: head, rph: tag ?? "", at: now().toISOString(), passed: steps.every((s) => s.ok) && pin.length === 0, steps, pin } };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Runs a process in `cwd`; the tail of what it printed is kept for a failure. */
async function spawn(command: string[], cwd: string): Promise<{ code: number | null; tail: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${resolve(process.execPath, "..")}:${process.env.PATH ?? ""}` } });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, tail: `${out}\n${err}`.trim().split("\n").slice(-6).join(" | ").slice(0, 600) };
}

if (import.meta.main) {
  const places = placesFromEnv();
  if (places.records === null) {
    console.error("the gate's records have no folder: name it in RPE_PROOF_RECORDS");
    process.exit(2);
  }
  const played = await play(places, spawn);
  if ("refused" in played) {
    console.error(`the gate does not run on this tree: ${played.refused.join("; ")}`);
    process.exit(1);
  }
  const file = writeGate(places.records, played.record);
  for (const step of played.record.steps) console.log(`${step.ok ? "passed" : "FAILED"}  ${step.name}  (${step.seconds} s)  ${step.note}`);
  for (const problem of played.record.pin) console.log(`FAILED  RPH's pin: ${problem}`);
  console.log(`${played.record.passed ? "The gate passed" : "The gate did not pass"} on RPE ${played.record.rpe.slice(0, 8)} with RPH ${played.record.rph.slice(0, 8)}; its record is ${file}`);
  process.exit(played.record.passed ? 0 : 1);
}
