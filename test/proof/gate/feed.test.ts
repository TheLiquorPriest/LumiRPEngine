// The rebuild's code reaches the bed by bundle (PlanScenarios-5 item 9): on two scratch repositories, bundles fed into scratch mirrors give a checkout at the commit under proof whose install
// resolves the `rph.invalid` name to the mirror, with no network, and passes the pin's check; a checkout at another commit than the bundle's is refused; so is a commit that is a prefix, a
// commit the repository lacks, and an install that does not hold the commit the manifest names.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BED = resolve(import.meta.dir, "../../../scripts/proof/bed");
let dir: string;
let rpeRepo: string;
let rphRepo: string;
let rpe = "";
let rph = "";
let later = "";
let proof: string;

function git(repo: string, ...args: string[]): string {
  const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=a lane", "-c", "user.email=lane@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
}

/** A script run as the bed's would be, its environment the test's own with the proof root and no more; the output and the exit code. */
function run(script: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  const done = Bun.spawnSync(["bash", join(BED, script), ...args], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: dir, RPE_PROOF_ROOT: proof, BUN: process.execPath, ...env } });
  return { code: done.exitCode ?? -1, out: `${done.stdout.toString()}${done.stderr.toString()}` };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-feed-"));
  proof = join(dir, "proof");
  // RPH: a package of one file and a folder, which is all the pin's check needs of it.
  rphRepo = join(dir, "rph");
  mkdirSync(join(rphRepo, "src"), { recursive: true });
  git(rphRepo, "init", "-q");
  writeFileSync(join(rphRepo, "package.json"), '{"name":"rp-harness","version":"0.0.1","main":"index.js"}\n');
  writeFileSync(join(rphRepo, "index.js"), "module.exports = 1;\n");
  writeFileSync(join(rphRepo, "src", "a.js"), "module.exports = 'a';\n");
  git(rphRepo, "add", "-A");
  git(rphRepo, "commit", "-q", "-m", "RPH's state");
  rph = git(rphRepo, "rev-parse", "HEAD");
  // RPE: a manifest naming RPH at that commit under the name that is no host, and the lock an install with the name sent to RPH's repository makes.
  rpeRepo = join(dir, "rpe");
  mkdirSync(rpeRepo, { recursive: true });
  git(rpeRepo, "init", "-q");
  writeFileSync(join(rpeRepo, "package.json"), `${JSON.stringify({ name: "rpe", version: "1.0.0", dependencies: { "rp-harness": `git+https://rph.invalid/RPHarness.git#${rph}` } })}\n`);
  const settings = join(dir, "gitconfig");
  writeFileSync(settings, `[url "${rphRepo}"]\n\tinsteadOf = https://rph.invalid/RPHarness.git\n`);
  const locked = Bun.spawnSync([process.execPath, "install"], { cwd: rpeRepo, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_GLOBAL: settings, GIT_CONFIG_NOSYSTEM: "1" } });
  if (locked.exitCode !== 0) throw new Error(`the scratch lock could not be made: ${locked.stderr.toString()}`);
  rmSync(join(rpeRepo, "node_modules"), { recursive: true, force: true });
  git(rpeRepo, "add", "-A");
  git(rpeRepo, "commit", "-q", "-m", "RPE's state under proof");
  rpe = git(rpeRepo, "rev-parse", "HEAD");
  writeFileSync(join(rpeRepo, "later.txt"), "a later commit the bed was never fed\n");
  git(rpeRepo, "add", "-A");
  git(rpeRepo, "commit", "-q", "-m", "a later state");
  later = git(rpeRepo, "rev-parse", "HEAD");
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

test("bundles fed into mirrors give a checkout at the commit under proof, whose install reaches RPH only through the mirror and passes the check of what was installed", () => {
  const fed = run("feed.sh", [rpeRepo, rpe, rphRepo, rph]);
  expect(fed.code).toBe(0);
  expect(fed.out).toContain(`fed rpe at ${rpe}`);
  expect(fed.out).toContain(`fed rph at ${rph}`);
  expect(readFileSync(join(proof, "bundles.txt"), "utf8")).toBe(`rpe ${rpe}\nrph ${rph}\n`);
  // The repositories are as they were: the tag made for each bundle is taken away.
  expect(git(rpeRepo, "tag", "--list", "rpe-proof-*")).toBe("");
  expect(git(rphRepo, "tag", "--list", "rpe-proof-*")).toBe("");

  const into = join(dir, "bed-checkout");
  const checked = run("checkout.sh", [rpe, into]);
  expect(checked.code).toBe(0);
  expect(git(into, "rev-parse", "HEAD")).toBe(rpe);
  expect(checked.out).toContain("3 file(s)");
  expect(checked.out).toContain("0 wrong");
  // The name that is no host goes to RPH's mirror by the settings file alone; what is installed is a real folder of the commit's files.
  expect(readFileSync(join(proof, "gitconfig"), "utf8")).toBe(`[url "${join(proof, "remotes", "rph.git")}"]\n\tinsteadOf = https://rph.invalid/RPHarness.git\n`);
  const installed = join(into, "node_modules", "rp-harness");
  expect(lstatSync(installed).isSymbolicLink()).toBe(false);
  expect(readFileSync(join(installed, "src", "a.js"), "utf8")).toBe("module.exports = 'a';\n");
});

test("a checkout at another commit than the bundle's is refused, as is a prefix, a commit the repository lacks, and a destination with something in it", () => {
  const other = run("checkout.sh", [later, join(dir, "other-checkout")]);
  expect(other.code).toBe(1);
  expect(other.out).toContain("is not a commit the mirror was fed");
  expect(existsSync(join(dir, "other-checkout"))).toBe(false);
  expect(run("checkout.sh", [rpe.slice(0, 12), join(dir, "prefix-checkout")])).toMatchObject({ code: 2 });
  expect(run("feed.sh", [rpeRepo, rpe.slice(0, 12), rphRepo, rph])).toMatchObject({ code: 2 });
  const lacking = run("feed.sh", [rpeRepo, "e".repeat(40), rphRepo, rph]);
  expect(lacking.code).toBe(2);
  expect(lacking.out).toContain("is not a commit of RPE's repository");
  const full = join(dir, "full");
  mkdirSync(full);
  writeFileSync(join(full, "file"), "x");
  expect(run("checkout.sh", [rpe, full]).out).toContain("is not empty");
});

test("an install that is not what the manifest names is refused by the check of what was installed", () => {
  // A package manager that installs, then changes a file of RPH's, as a copy that is not the commit's would be.
  const tampering = join(dir, "tamper-bun.sh");
  writeFileSync(tampering, `#!/bin/bash\n"${process.execPath}" "$@" && echo changed >> node_modules/rp-harness/index.js\n`);
  chmodSync(tampering, 0o755);
  const refused = run("checkout.sh", [rpe, join(dir, "tampered-checkout")], { BUN: tampering });
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("differs: index.js");
  expect(refused.out).toContain("what was installed is not the commit the manifest names");
});
