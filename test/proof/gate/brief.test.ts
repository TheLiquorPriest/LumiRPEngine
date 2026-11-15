// The review brief (PlanScenarios-5 item 6): the brief built for a wave holds the plan's sections, the intent, the whole diff between two named commits and the gaps claimed closed with
// their file and line; it holds no text of a lane's report and no line telling the reviewer what not to report, and it names two whole commits that exist, the first an ancestor of the second.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief, briefProblems, type BriefInput } from "../../../scripts/proof/gate/brief";

let repo: string;
let first = "";
let second = "";

function git(...args: string[]): string {
  const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=a lane", "-c", "user.email=lane@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(done.stderr.toString());
  return done.stdout.toString().trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "rpe-brief-"));
  git("init", "-q");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  git("commit", "-q", "-m", "the first state");
  first = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(repo, "b.ts"), "export const b = 1;\n");
  git("add", "a.ts", "b.ts");
  git("commit", "-q", "-m", "the second state, whose message a reviewer is not told");
  second = git("rev-parse", "HEAD");
});

afterAll(() => {
  if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
});

const input = (): BriefInput => ({
  wave: 2,
  sections: ["§17.0 l.1745-1753", "§18.3 l.1972-1986"],
  plan: "/plans/STANDALONE-PLAN.md",
  intent: "/plans/INTENT.md",
  repo,
  from: first,
  to: second,
  gaps: [
    { id: "AuProof-6", file: "a.ts", line: 1 },
    { id: "AuProof-425", file: "b.ts", line: 1 },
  ],
});

test("the brief names the plan's sections, the intent, two whole commits, the files the diff changes and each gap claimed closed with its file and line", () => {
  const text = brief(input());
  expect(text).toContain("# Review of wave 2");
  expect(text).toContain("§17.0 l.1745-1753");
  expect(text).toContain("/plans/INTENT.md");
  expect(text).toContain(`- from ${first}`);
  expect(text).toContain(`- to ${second}`);
  expect(text).toContain(`git -C ${repo} diff ${first} ${second}`);
  expect(text).toContain("a.ts");
  expect(text).toContain("b.ts");
  expect(text).toContain("- AuProof-6: a.ts:1");
  expect(text).toContain("- AuProof-425: b.ts:1");
});

test("it holds nothing of a lane's reasoning or report, and no line telling the reviewer what not to report", () => {
  const text = brief(input());
  // The commit messages, where a lane writes what it did, are not in it: the diff is read from the commits by the reviewer.
  expect(text).not.toContain("whose message a reviewer is not told");
  expect(text).not.toMatch(/do not report|don't report|need not report|not to report|already known|known gap|known missing|lane'?s report|reasoning/i);
  expect(text).toMatch(/report anything that is missing or wrong/i);
  // The brief takes no report as an input at all.
  expect(Object.keys(input()).sort()).toEqual(["from", "gaps", "intent", "plan", "repo", "sections", "to", "wave"]);
});

test("a brief is not made of a prefix, a commit the repository lacks, two commits that are one, a diff run backwards, or a gap with no line", () => {
  expect(briefProblems({ ...input(), from: first.slice(0, 12) })).toEqual([`the from commit is not a whole commit (40 hex digits): ${first.slice(0, 12)}`]);
  expect(briefProblems({ ...input(), to: "f".repeat(40) }).join(" ")).toContain(`the to commit ${"f".repeat(40)} is not a commit of ${repo}`);
  expect(briefProblems({ ...input(), to: first })).toEqual(["the two commits are one: a wave's diff lies between two"]);
  expect(briefProblems({ ...input(), from: second, to: first })).toEqual(["the first commit is not an ancestor of the second, so the diff between them is not the wave's"]);
  expect(briefProblems({ ...input(), gaps: [{ id: "AuProof-7", file: "", line: 0 }] })).toEqual(["the gap AuProof-7 has no file and line"]);
  expect(briefProblems({ ...input(), sections: [] })).toEqual(["no section of the plan is named for the reviewer to read"]);
  expect(() => brief({ ...input(), from: "abc" })).toThrow("the review brief for wave 2 cannot be made");
});
