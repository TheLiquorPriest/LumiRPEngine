// The run's record in one home (PlanGates-42 item 1; PlanGates-4-fix1 item 3): the floor's table prints
// the runner's standing from `run.json` first and works none out again; the addition beside `run.json`
// holds only what it lacks; the build's shipped tree is laid by RPE's one rule over an RPE repository
// holding `guidance/chat-defaults/`, with RPH's installed folder read without git.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { standingOf, type RunRecord } from "../../../scripts/proof/route/evidence";
import { buildFrom, buildTree, countApart, floorTrials, folderTree, gitTree, plainReasoning, readRun, recordPath, repeated, sha256, shippedOf, standingLines, treeChanges, treeHash, writeRecord, type Observed, type TreeFile } from "../../../scripts/proof/lib/record";
import { runs, table } from "../../../scripts/testbed/floor";
import type { FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { LEADS } from "./replay";

const FIXTURE = join(import.meta.dir, "fixtures", "bundle-trial");
const REPO = resolve(import.meta.dir, "../../..");

/** A copy of the recorded bundle with a recorded floor run kept in it, so writing the addition never changes the fixture; `edit` changes its run.json first. */
function bundle(edit?: (run: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "floor-record-"));
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, "floor", "internal", "play-01", "turns.json"), JSON.stringify(recordedRun({ form: "two-step" })));
  if (edit) {
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, unknown>;
    edit(run);
    writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  }
  return dir;
}

const observed = (dir: string): Observed => JSON.parse(readFileSync(join(dir, "floor", "internal", "play-01", "observed.json"), "utf8")) as Observed;

/** run.json's standing as the runner works it out for a clean run on the bundle's own trees. */
function clean(run: Record<string, unknown>): void {
  run.rpe = { commit: "4f1c2a9e7b3d5a61", dirty: false };
  const record = run as unknown as RunRecord;
  record.standing = standingOf(record.rpe, record.rph, record.standing?.from ?? null);
}

describe("the standing read from run.json, never worked out again", () => {
  test("a bundle whose run.json says trial prints the trial first and no verdict on any row", () => {
    const dir = bundle();
    try {
      const printed = table(dir);
      expect(printed).toContain("TRIAL: no verdict. RPE's tree held changes beyond its commit 4f1c2a9e7b3d5a61.");
      expect(printed.indexOf("TRIAL")).toBeLessThan(printed.indexOf("First words on screen"));
      expect(printed).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
      expect(printed).toContain("First words on screen: no verdict (trial)");
      expect(printed).not.toContain("gives a verdict");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the standing is run.json's: the same trees on a clean tree, as the runner wrote it, give a verdict and the rows theirs", () => {
    const dir = bundle(clean);
    try {
      const printed = table(dir);
      expect(printed).toContain("this run gives a verdict");
      expect(printed).toContain("First words on screen: PASS");
      // run.json saying trial is believed only as the runner would work it out again from what it stood on.
      expect(standingLines(readRun(dir)).join("\n")).not.toContain("TRIAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the addition holds only what run.json lacks, repeats nothing it holds, and the check names any copy", () => {
    const dir = bundle();
    try {
      const run = readRun(dir);
      const addition = writeRecord(dir, "floor", null);
      // The global layer's hash is run.json's own, so only plain generation's reasoning is added.
      expect(addition).toEqual({ gate: "floor", plain: observed(dir).plain, layers: [], shipped: null });
      expect(repeated(run, addition)).toEqual([]);
      expect(JSON.parse(readFileSync(recordPath(dir, "floor"), "utf8"))).toEqual(addition);
      const copying = { ...addition, rpe: run.rpe, layers: [{ level: "global" as const, hash: run.standing?.from?.layers[0]?.hash ?? "", guidance: [] }], plain: { ...addition.plain, connection: run.rph.commit } } as unknown as typeof addition;
      expect(repeated(run, copying)).toEqual(["rpe", "rpe.commit", "rph.commit", "rph.pin", "standing.from.layers (global)"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a chat layer the floor's chat stood on that run.json does not carry is added, with the guidance in it", () => {
    const dir = bundle();
    try {
      const seen = observed(dir);
      seen.layers.push({ level: "chat", files: [{ path: "rules/no-weather.md", sha256: sha256("invented rule") }, { path: "RPE.yml", sha256: sha256("history:\n  window: 40\n") }] });
      writeFileSync(join(dir, "floor", "internal", "play-01", "observed.json"), JSON.stringify(seen));
      const addition = writeRecord(dir, "floor", null);
      expect(addition.layers.map((l) => [l.level, l.guidance])).toEqual([["chat", ["rules/no-weather.md"]]]);
      expect(repeated(readRun(dir), addition)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs are counted apart by the runner's standing, each by name", () => {
    const dir = bundle();
    const verdict = bundle(clean);
    try {
      const counted = countApart([{ run: { ...readRun(dir), run: "live-a" }, own: [] }, { run: { ...readRun(verdict), run: "live-b" }, own: [] }, { run: { ...readRun(dir), run: "live-c", standing: undefined }, own: [] }]);
      expect(counted.verdicts).toEqual(["live-b"]);
      expect(counted.trials).toEqual([
        { run: "live-a", why: "RPE's tree held changes beyond its commit 4f1c2a9e7b3d5a61" },
        { run: "live-c", why: "run.json does not give the run's standing, so it gives no verdict" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(verdict, { recursive: true, force: true });
    }
  });
});

describe("the build's shipped tree, laid by RPE's one rule", () => {
  const git = (repo: string, ...args: string[]) => {
    const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=Floor Test", "-c", "user.email=floor@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(new TextDecoder().decode(done.stderr));
    return new TextDecoder().decode(done.stdout).trim();
  };
  const write = (dir: string, files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  /** An invented RPE repository holding `guidance/chat-defaults/TURN.md`, and an installed RPH shipped folder that is no git repository. */
  function trees(root: string): { repo: string; commit: string; rph: string } {
    const repo = join(root, "rpe");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q");
    write(repo, { "guidance/chat-defaults/TURN.md": "rpe's turn", "guidance/.agents/author.md": "---\neffort: low\n---\n", "guidance/.prompts/prompt-frame.md": "rpe's frame" });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "invented");
    const rph = join(root, "installed", "guidance");
    write(rph, { ".tools/write_reply.md": "rph's tool guide", "TURN.md": "rph's turn", ".prompts/prompt-frame.md": "rph's frame" });
    return { repo, commit: git(repo, "rev-parse", "HEAD"), rph };
  }

  test("RPE's chat-defaults/TURN.md lands at the root over RPH's, read from the repository at its commit and RPH's folder without git", () => {
    const root = mkdtempSync(join(tmpdir(), "floor-build-"));
    try {
      const input = trees(root);
      expect(() => git(input.rph, "rev-parse", "HEAD")).toThrow();
      const expected: TreeFile[] = [
        { path: ".agents/author.md", sha256: sha256("---\neffort: low\n---\n") },
        { path: ".prompts/prompt-frame.md", sha256: sha256("rpe's frame") },
        { path: ".tools/write_reply.md", sha256: sha256("rph's tool guide") },
        { path: "TURN.md", sha256: sha256("rpe's turn") },
      ];
      expect(buildTree(input)).toEqual(expected);
      expect(shippedOf(folderTree(input.rph), gitTree(input.repo, input.commit, "guidance"))).toEqual(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a run on the unchanged build gives a verdict, and one changed file makes a trial, by the runner's way and the floor's", () => {
    const root = mkdtempSync(join(tmpdir(), "floor-build-"));
    try {
      const input = trees(root);
      const build = { rph: folderTree(input.rph), rpe: gitTree(input.repo, input.commit, "guidance") };
      const laid = shippedOf(build.rph, build.rpe);
      const fromOf = (served: TreeFile[]) => ({ served: treeHash(served), build: treeHash(laid), changed: treeChanges(served, laid), layers: [], files: { served: served.length, build: laid.length }, names: { off: [], layered: [], added: [] } });
      const rpe = { commit: input.commit, dirty: false };
      const rph = { commit: "9a8b7c6d5e4f3a21", pin: "9a8b7c6d5e4f3a21", pinned: true };
      expect(standingOf(rpe, rph, fromOf(laid)).is).toBe("verdict");
      const changed = laid.map((f) => (f.path === "TURN.md" ? { ...f, sha256: sha256("a turn changed on the server") } : f));
      expect(standingOf(rpe, rph, fromOf(changed))).toMatchObject({ is: "trial", why: ["the shipped tree the server ran is not the build's: 1 path differs (TURN.md)"] });
      // Where run.json gives no account of the guidance, the floor lays the build itself and finds the same.
      const run = { ...JSON.parse(readFileSync(join(FIXTURE, "run.json"), "utf8")), rpe, standing: undefined } as RunRecord;
      const reader = buildFrom(input.repo, input.rph);
      expect(floorTrials(run, { shipped: laid, layers: [], off: [], leads: LEADS }, reader)).toEqual([]);
      expect(floorTrials(run, { shipped: changed, layers: [], off: [], leads: LEADS }, reader)).toEqual(["the shipped tree RPE serves the floor's chat is not the build's: 1 path differs (TURN.md)"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("table over an installed RPH folder that is no git repository reads it, where run.json gives no account of the guidance", () => {
    const root = mkdtempSync(join(tmpdir(), "floor-build-"));
    const dir = bundle();
    try {
      const rph = join(root, "installed", "guidance");
      write(rph, { ".tools/write_reply.md": "rph's tool guide", ".prompts/system-note.md": "System note:\n{{text}}\n" });
      const head = git(REPO, "rev-parse", "HEAD");
      const served = buildTree({ repo: REPO, commit: head, rph });
      const runFile = join(dir, "run.json");
      const run = JSON.parse(readFileSync(runFile, "utf8")) as Record<string, unknown>;
      writeFileSync(runFile, JSON.stringify({ ...run, rpe: { commit: head, dirty: false }, standing: undefined }));
      writeFileSync(join(dir, "floor", "internal", "play-01", "observed.json"), JSON.stringify({ ...observed(dir), shipped: served }));
      const printed = table(dir, rph);
      expect(printed).toContain("TRIAL: no verdict. run.json does not give the run's standing, so it gives no verdict.");
      expect(printed).toContain(`The shipped tree the floor's chat was served (${treeHash(served).slice(0, 12)}) is the build's, laid from RPE's repository and RPH's installed folder`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("floor.ts runs counts the floor's own trials (PlanGates-4-fix2 item 4)", () => {
  /** A folder of bundles, each a clean recorded run whose floor record `edit` changes (or, for "none", takes away). */
  function folderOf(edits: Record<string, ((floor: FloorRun) => void) | "none">): string {
    const folder = mkdtempSync(join(tmpdir(), "floor-runs-"));
    for (const [name, edit] of Object.entries(edits)) {
      const dir = bundle(clean);
      const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(dir, "run.json"), JSON.stringify({ ...run, run: name }));
      const turns = join(dir, "floor", "internal", "play-01", "turns.json");
      if (edit === "none") rmSync(turns);
      else {
        const floor = JSON.parse(readFileSync(turns, "utf8")) as FloorRun;
        edit(floor);
        writeFileSync(turns, JSON.stringify(floor));
      }
      cpSync(dir, join(folder, name), { recursive: true });
      rmSync(dir, { recursive: true, force: true });
    }
    return folder;
  }

  test("a run whose run.json says verdict is counted a verdict only where the floor's own record names no trial and no stop", () => {
    const off = "shipped guidance is switched off by an off: list: .prompts/reply-contract.md (off in chat)";
    const folder = folderOf({
      "live-clean": () => undefined,
      "live-off": (floor) => {
        floor.trials = [off];
      },
      "live-stopped": (floor) => {
        floor.stopped = "pair 5: RPE's run was still going 15 min after the reply (LIMITS.runEnd), so no later pair was sent over it";
      },
      "live-lead": (floor) => {
        floor.trials = ["a turn was led by another definition than the Author (author): pair 3 by gm"];
      },
      "live-norecord": "none",
    });
    try {
      const printed = runs(folder);
      expect(printed).toContain("1 give a verdict, 4 are trials.");
      expect(printed).toContain("\n  verdict  live-clean\n");
      expect(printed).toContain(`\n  trial    live-off: the floor's own trial: ${off}\n`);
      expect(printed).toContain("\n  trial    live-stopped: the floor's own stopped: pair 5: RPE's run was still going 15 min after the reply");
      expect(printed).toContain("\n  trial    live-lead: the floor's own trial: a turn was led by another definition than the Author (author): pair 3 by gm\n");
      expect(printed).toMatch(/\n {2}trial {4}live-norecord: the floor's own record of the run could not be read: .*holds no floor run/);
      expect(printed).not.toContain("verdict  live-off");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("a trial of the runner's own is still a trial beside the floor's: both reasons are named", () => {
    const folder = folderOf({
      "live-both": (floor) => {
        floor.trials = ["a layer of the user's own holds guidance: TURN.md"];
      },
    });
    try {
      const run = JSON.parse(readFileSync(join(folder, "live-both", "run.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(folder, "live-both", "run.json"), JSON.stringify({ ...run, rpe: { commit: "4f1c2a9e7b3d5a61", dirty: true }, standing: { ...(run.standing as object), is: "trial", why: ["RPE's tree held changes beyond its commit 4f1c2a9e7b3d5a61"] } }));
      expect(runs(folder)).toContain("trial    live-both: RPE's tree held changes beyond its commit 4f1c2a9e7b3d5a61; the floor's own trial: a layer of the user's own holds guidance: TURN.md");
    } finally {
      rmSync(folder, { recursive: true, force: true });
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
