// The run's record in one home (PlanGates-4 item 1): the addition beside `run.json` holds only what
// `run.json` lacks, and a run on a changed tree is a trial that prints no verdict.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { additionOf, countApart, gitTree, plainReasoning, readRecord, readRun, recordPath, repeated, sha256, shippedOf, standingLines, writeRecord, type Observed, type TreeFile } from "../../../scripts/proof/lib/record";

const FIXTURE = join(import.meta.dir, "fixtures", "bundle-trial");

/** A copy of the recorded bundle, so writing the addition never changes the fixture; `edit` changes its run.json first. */
function bundle(edit?: (run: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "floor-record-"));
  cpSync(FIXTURE, dir, { recursive: true });
  if (edit) {
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, unknown>;
    edit(run);
    writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  }
  return dir;
}

const observed = (dir: string): Observed => JSON.parse(readFileSync(join(dir, "floor", "internal", "play-01", "observed.json"), "utf8")) as Observed;

describe("the record's addition", () => {
  test("a recorded run from a changed tree is a trial, and what is printed of it gives no verdict", () => {
    const dir = bundle();
    try {
      const addition = writeRecord(dir, "floor", () => observed(dir).shipped);
      expect(addition.standing).toBe("trial");
      expect(addition.why.join(" ")).toContain("rpe.dirty");
      const printed = standingLines(readRun(dir), readRecord(dir, "floor")).join("\n");
      expect(printed).toContain("TRIAL: no verdict");
      expect(printed).not.toContain("gives a verdict");
      expect(JSON.parse(readFileSync(recordPath(dir, "floor"), "utf8")).standing).toBe("trial");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the same run on a clean tree, the shipped tree the build's and only settings of the user's own, gives a verdict", () => {
    const dir = bundle((run) => (run.rpe = { commit: "4f1c2a9e7b3d5a61", dirty: false }));
    try {
      const addition = writeRecord(dir, "floor", () => observed(dir).shipped);
      expect(addition.why).toEqual([]);
      expect(addition.standing).toBe("verdict");
      expect(standingLines(readRun(dir), addition).join("\n")).toContain("This run gives a verdict.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a shipped tree other than the build's, RPH off its pin, or guidance in a layer of the user's own each make a trial, named", () => {
    const dir = bundle((run) => {
      run.rpe = { commit: "4f1c2a9e7b3d5a61", dirty: false };
      run.rph = { commit: "1234567890ab", pin: "9a8b7c6d5e4f3a21", pinned: false };
    });
    try {
      const run = readRun(dir);
      const seen = observed(dir);
      seen.layers.push({ level: "chat", files: [{ path: "rules/no-weather.md", sha256: sha256("invented rule") }, { path: "RPE.yml", sha256: sha256("history:\n  window: 40\n") }] });
      const build = seen.shipped.map((f) => (f.path === "TURN.md" ? { ...f, sha256: sha256("the build's TURN.md") } : f));
      const addition = additionOf("floor", run, seen, build);
      expect(addition.standing).toBe("trial");
      expect(addition.shipped.changed).toEqual(["TURN.md"]);
      expect(addition.why.some((w) => w.includes("not the commit RPE pins"))).toBe(true);
      expect(addition.why.some((w) => w.includes("TURN.md"))).toBe(true);
      expect(addition.layers.find((l) => l.level === "chat")?.guidance).toEqual(["rules/no-weather.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the addition repeats none of run.json's fields, and the check names any it would", () => {
    const dir = bundle();
    try {
      const run = readRun(dir);
      const addition = writeRecord(dir, "floor", () => observed(dir).shipped);
      expect(repeated(run, addition)).toEqual([]);
      const copying = { ...addition, rpe: run.rpe, plain: { ...addition.plain, connection: run.rph.commit } } as unknown as typeof addition;
      // The copied `rpe` holds RPE's commit; the plain arm's field holds RPH's, which is also the pin.
      expect(repeated(run, copying)).toEqual(["rpe", "rpe.commit", "rph.commit", "rph.pin"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("trials and runs that give a verdict are counted apart, each by name", () => {
    const dir = bundle();
    try {
      const trial = writeRecord(dir, "floor", () => observed(dir).shipped);
      const counted = countApart([
        { run: "live-a", addition: trial },
        { run: "live-b", addition: { ...trial, standing: "verdict", why: [] } },
        { run: "live-c", addition: null },
      ]);
      expect(counted.verdicts).toEqual(["live-b"]);
      expect(counted.trials.map((t) => t.run)).toEqual(["live-a", "live-c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the build's shipped tree", () => {
  test("RPE's guidance over RPH's, read from each repository at its commit", () => {
    const root = mkdtempSync(join(tmpdir(), "floor-git-"));
    const git = (repo: string, ...args: string[]) => {
      const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=Floor Test", "-c", "user.email=floor@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
      if (done.exitCode !== 0) throw new Error(new TextDecoder().decode(done.stderr));
      return new TextDecoder().decode(done.stdout).trim();
    };
    const repo = (name: string, files: Record<string, string>): { dir: string; commit: string } => {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      git(dir, "init", "-q");
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "invented");
      return { dir, commit: git(dir, "rev-parse", "HEAD") };
    };
    try {
      const rph = repo("rph", { "guidance/.tools/write_reply.md": "rph's tool guide", "guidance/TURN.md": "rph's turn", "src/x.ts": "not guidance" });
      const rpe = repo("rpe", { "guidance/TURN.md": "rpe's turn", "guidance/.agents/author.md": "---\neffort: low\n---\n" });
      const shipped = shippedOf(gitTree(rph.dir, rph.commit, "guidance"), gitTree(rpe.dir, rpe.commit, "guidance"));
      const expected: TreeFile[] = [
        { path: ".agents/author.md", sha256: sha256("---\neffort: low\n---\n") },
        { path: ".tools/write_reply.md", sha256: sha256("rph's tool guide") },
        { path: "TURN.md", sha256: sha256("rpe's turn") },
      ];
      expect(shipped).toEqual(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("plain generation's reasoning, as Lumiverse holds it", () => {
  test("the connection's binding before the global setting; reasoning on with no effort is the provider's own; a preset's body applies only where the setting has none", () => {
    const bound = plainReasoning({ connection: "c", preset: "p", binding: { apiReasoning: true, reasoningEffort: "low" }, global: { apiReasoning: false }, presetCustomBody: null });
    expect([bound.source, bound.apiReasoning, bound.effort]).toEqual(["connection", true, "low"]);
    const global = plainReasoning({ connection: "c", preset: "p", binding: undefined, global: { apiReasoning: true }, presetCustomBody: { enabled: true, rawJson: '{"reasoning_effort":"max","top_k":40}' } });
    expect([global.source, global.effort]).toEqual(["global", "auto"]);
    expect(global.customBody).toEqual({ from: "preset", reasoningKeys: ["reasoning_effort"] });
    const own = plainReasoning({ connection: "c", preset: "p", binding: { apiReasoning: true, reasoningEffort: "low", customBody: { enabled: false, rawJson: "{}" } }, global: null, presetCustomBody: { enabled: true, rawJson: '{"thinking":{"type":"enabled"}}' } });
    expect(own.customBody).toBeNull();
  });
});
