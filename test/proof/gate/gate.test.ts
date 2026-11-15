// The cheap gate and the bed's lock (PlanScenarios-5 items 1, 2, 3 and 8), on repositories made up for it: a live
// run on a commit with no gate record is refused, one from a changed tree is refused, RPH held as a link or with a
// file that is not the commit's or pinned by a prefix is refused, two runs at once are refused the second, and a run
// with no never-touch list in force is refused; the gate's own record is made only from steps that all passed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { play } from "../../../scripts/proof/gate/cheap";
import { checkoutProblems, type GuardPlaces, makeGuard, neverTouch, placesFromEnv } from "../../../scripts/proof/gate/guard";
import { pinProblems } from "../../../scripts/proof/gate/pin";
import { gateFile, type GateRecord, readGate, writeGate } from "../../../scripts/proof/gate/record";
import type { RunFacts } from "../../../scripts/proof/route/host";
import { pinName } from "../../../scripts/proof/route/pin";
import { fakeFacts, fakeHeld } from "../route/fake";

const git = (repo: string, ...args: string[]): string => {
  const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
};

let dir: string;
let rpe: string;
let rph: string;
let rpeCommit: string;
let rphCommit: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-gate-test-"));
  rph = join(dir, "rph");
  mkdirSync(join(rph, "guidance"), { recursive: true });
  writeFileSync(join(rph, "guidance", "rules.md"), "Keep to the tags.\n");
  git(rph, "init", "-q");
  git(rph, "add", "guidance");
  git(rph, "commit", "-q", "-m", "first");
  rphCommit = git(rph, "rev-parse", "HEAD");

  rpe = join(dir, "rpe");
  mkdirSync(rpe, { recursive: true });
  writeFileSync(join(rpe, ".gitignore"), "node_modules\n");
  writeFileSync(join(rpe, "package.json"), JSON.stringify({ dependencies: { "rp-harness": `git+https://rph.invalid/RPHarness.git#${rphCommit}` } }));
  git(rpe, "init", "-q");
  git(rpe, "add", ".gitignore", "package.json");
  git(rpe, "commit", "-q", "-m", "first");
  rpeCommit = git(rpe, "rev-parse", "HEAD");
  install();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The installed `rp-harness` as `bun install` leaves it: a real folder with the commit's files and its tag. */
function install(): void {
  const into = join(rpe, "node_modules", "rp-harness");
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  cpSync(join(rph, "guidance"), join(into, "guidance"), { recursive: true });
  writeFileSync(join(into, ".bun-tag"), rphCommit);
}

const places = (over: Partial<GuardPlaces> = {}): GuardPlaces => ({ repo: rpe, rphRepo: rph, records: join(dir, "records"), lock: join(dir, "bed.lock"), neverTouch: ["chat-bed-", "bed-unit"], stage: "before-publishing", ...over });
const facts = (over: Partial<RunFacts> = {}): RunFacts => ({ ...fakeFacts(), rpe: { commit: rpeCommit, dirty: false }, rph: { commit: rphCommit, pin: rphCommit, held: fakeHeld(rphCommit) }, ...over });
const passing = (): GateRecord => ({ rpe: rpeCommit, rph: rphCommit, at: "2026-11-15T20:00:00.000Z", passed: true, steps: [{ name: "RPE typecheck", command: ["bun"], cwd: rpe, code: 0, seconds: 1, ok: true, note: "passed" }], pin: [] });

test("a live run on a commit with no gate record is refused, and one with a record that passed is admitted", async () => {
  rmSync(join(dir, "records"), { recursive: true, force: true });
  const guard = makeGuard(() => places());
  const refused = await guard.admit(facts());
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.why).toContain("no gate record");
  writeGate(join(dir, "records"), passing());
  expect(await guard.admit(facts())).toEqual({ ok: true });
});

test("a record of the gate that did not pass admits nothing, naming the step", async () => {
  const failing: GateRecord = { ...passing(), passed: false, steps: [{ name: "RPE whole suite", command: ["bun"], cwd: rpe, code: 1, seconds: 2, ok: false, note: "exit 1" }] };
  writeGate(join(dir, "records"), failing);
  const refused = await makeGuard(() => places()).admit(facts());
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.why).toContain("RPE whole suite");
  // A record that says it passed with a step that did not is not one the gate made.
  writeFileSync(gateFile(join(dir, "records"), rpeCommit, rphCommit), JSON.stringify({ ...failing, passed: true }));
  expect(() => readGate(join(dir, "records"), rpeCommit, rphCommit)).toThrow("its own steps and pin say failed");
  writeGate(join(dir, "records"), passing());
});

test("a live run from a tree with changes not committed is refused", async () => {
  writeFileSync(join(rpe, "changed.txt"), "not committed\n");
  try {
    const refused = await makeGuard(() => places()).admit(facts());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.why).toContain("changes not committed");
    expect(checkoutProblems(rpe, rpeCommit).join(" ")).toContain("changed.txt");
    const dirty = await makeGuard(() => places()).admit(facts({ rpe: { commit: rpeCommit, dirty: true } }));
    expect(dirty.ok).toBe(false);
  } finally {
    rmSync(join(rpe, "changed.txt"));
  }
  expect(checkoutProblems(rpe, rpeCommit)).toEqual([]);
  expect(checkoutProblems(rpe, "0".repeat(40))[0]).toContain("the run says RPE is");
});

test("RPH held as a link, with a file that is not the commit's, or pinned by a prefix, fails the gate", async () => {
  expect(pinProblems(rpe, rph, "before-publishing")).toEqual([]);
  // A prefix of the commit is no pin.
  const guard = makeGuard(() => places());
  const prefix = await guard.admit(facts({ rph: { commit: rphCommit, pin: rphCommit.slice(0, 8), held: fakeHeld(rphCommit) } }));
  expect(prefix.ok).toBe(false);
  if (!prefix.ok) expect(prefix.why).toContain("a shared prefix is no pin");

  // A file of the installed package that differs from the commit's.
  writeFileSync(join(rpe, "node_modules", "rp-harness", "guidance", "rules.md"), "Keep to something else.\n");
  expect(pinProblems(rpe, rph, "before-publishing").join(" ")).toContain("differs from the commit's: guidance/rules.md");
  const differs = await guard.admit(facts());
  expect(differs.ok).toBe(false);
  install();

  // A file of the commit that is missing.
  rmSync(join(rpe, "node_modules", "rp-harness", "guidance", "rules.md"));
  expect(pinProblems(rpe, rph, "before-publishing").join(" ")).toContain("missing from the installed rp-harness: guidance/rules.md");
  install();

  // A link in place of the package.
  const real = join(dir, "real-rph");
  rmSync(real, { recursive: true, force: true });
  cpSync(join(rpe, "node_modules", "rp-harness"), real, { recursive: true });
  rmSync(join(rpe, "node_modules", "rp-harness"), { recursive: true });
  symlinkSync(real, join(rpe, "node_modules", "rp-harness"));
  expect(pinProblems(rpe, rph, "before-publishing").join(" ")).toContain("is a link");
  rmSync(join(rpe, "node_modules", "rp-harness"));
  install();

  // No repository to hold the files against is a fault, never a pass.
  expect(pinProblems(rpe, null, "before-publishing").join(" ")).toContain("RPE_PROOF_RPH_REPO");
  expect(pinProblems(rpe, rph, "before-publishing")).toEqual([]);
  // The name RPE's manifest holds is the stage's own: rph.invalid's before publishing passes, and fails in a run recorded after it; GitHub's the other way round.
  expect(pinProblems(rpe, rph, "after-publishing").join(" ")).toContain(`after publishing is ${pinName("after-publishing", rphCommit)}`);
  const github = await guard.admit(facts({ rph: { commit: rphCommit, pin: rphCommit, held: { ...fakeHeld(rphCommit), name: pinName("after-publishing", rphCommit), stage: "after-publishing" } } }));
  expect(github.ok).toBe(false);
  // Once published, the manifest holds GitHub's name: it passes the after stage and fails the before one.
  const manifest = join(rpe, "package.json");
  const was = readFileSync(manifest, "utf8");
  writeFileSync(manifest, JSON.stringify({ dependencies: { "rp-harness": pinName("after-publishing", rphCommit) } }));
  try {
    expect(pinProblems(rpe, rph, "after-publishing")).toEqual([]);
    expect(pinProblems(rpe, rph, "before-publishing").join(" ")).toContain(`before publishing is ${pinName("before-publishing", rphCommit)}`);
  } finally {
    writeFileSync(manifest, was);
  }
});

test("a run with no never-touch list in force is refused, and the list is the one the variable names", async () => {
  expect(neverTouch({ LRE_NEVER_TOUCH: " chat-bed- , 7744 ,bed-unit," })).toEqual(["chat-bed-", "7744", "bed-unit"]);
  expect(neverTouch({})).toEqual([]);
  expect(placesFromEnv({ LRE_NEVER_TOUCH: "a,b", RPE_PROOF_RECORDS: "/somewhere" }).neverTouch).toEqual(["a", "b"]);
  const none = await makeGuard(() => places({ neverTouch: [] })).admit(facts());
  expect(none.ok).toBe(false);
  if (!none.ok) expect(none.why).toContain("never-touch");
  expect(makeGuard(() => places()).neverTouch()).toEqual(["chat-bed-", "bed-unit"]);
});

test("two runs at once: the second is refused, told which run holds the bed; a run that died leaves a lock that is taken over", async () => {
  rmSync(join(dir, "bed.lock"), { force: true });
  const guard = makeGuard(() => places());
  const first = await guard.lock("live-20261115-200000");
  expect(first.held).toBe(false);
  const second = await guard.lock("live-20261115-200100");
  expect(second.held).toBe(true);
  if (second.held) expect(second.by).toContain("live-20261115-200000");
  if (!first.held) await first.release();
  const third = await guard.lock("live-20261115-200200");
  expect(third.held).toBe(false);
  // A run that is not the holder cannot give the lock back.
  const other = await guard.lock("live-someone-else");
  expect(other.held).toBe(true);
  // A lock whose process is gone is taken over.
  const dead = makeGuard(() => places({ alive: () => false }));
  const took = await dead.lock("live-20261115-200300");
  expect(took.held).toBe(false);
  if (!took.held) await took.release();
  if (!third.held) await third.release();
});

test("the gate's record is made from every step, passing only when each did and RPH is held as the plan says", async () => {
  const ran: string[] = [];
  const all = await play(places(), async (command) => {
    ran.push(command.slice(1).join(" "));
    return { code: command.includes("rig") ? 2 : 0, tail: "" };
  });
  if ("refused" in all) throw new Error(all.refused.join("; "));
  expect(all.record.passed).toBe(true);
  expect(all.record.steps.map((s) => s.name)).toEqual(["RPE typecheck", "RPE preview typecheck", "RPH typecheck", "RPE whole suite", "RPH whole suite", "rig forms"]);
  expect(all.record.rpe).toBe(rpeCommit);
  expect(all.record.rph).toBe(rphCommit);
  expect(all.record.steps.at(-1)?.note).toBe("no rig form exists to play");

  const broke = await play(places(), async (command) => ({ code: command.includes("scripts/test-all.ts") && command.length === 2 ? 1 : 0, tail: "1 failed" }));
  if ("refused" in broke) throw new Error(broke.refused.join("; "));
  expect(broke.record.passed).toBe(false);
  expect(broke.record.steps.filter((s) => !s.ok).map((s) => s.name)).toContain("RPE whole suite");
  // A rig form that failed fails the gate.
  const rig = await play(places(), async (command) => ({ code: command.includes("rig") ? 1 : 0, tail: "" }));
  if ("refused" in rig) throw new Error(rig.refused.join("; "));
  expect(rig.record.passed).toBe(false);

  // The gate does not run on a tree with changes in it.
  writeFileSync(join(rpe, "changed.txt"), "x\n");
  try {
    const refused = await play(places(), async () => ({ code: 0, tail: "" }));
    expect("refused" in refused).toBe(true);
  } finally {
    rmSync(join(rpe, "changed.txt"));
  }
});
