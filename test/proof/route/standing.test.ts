// A run's standing (PlanScenarios-8 item 4; plan §17: a verdict comes only from shipped guidance on a
// clean build). The runner works it out once per run from what its host gives: the shipped tree RPE
// served beside the build's own, and every layer of the user's own. A run whose served tree is not the
// build's, or with guidance in any layer, or whose host does not say, is a trial: a gate's measured
// part is printed as trial with its figure in the report, the results file and the exit's reckoning,
// never met or unmet. A clean run on shipped guidance gives met or unmet. Read back alone, the bundle
// gives the same standing, whatever run.json claims.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sha256, shippedOf } from "../../../scripts/proof/lib/record";
import { readBundle } from "../../../scripts/proof/route/evidence";
import type { RunFacts } from "../../../scripts/proof/route/host";
import { main, type Deps } from "../../../scripts/proof/run";
import { FAKE_BUILD, fakeFacts, fakeHost } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");
const made: string[] = [];
let root = "";
let out = "";

/** A gate whose form judges one measured part, met or not as `pass` says, with its figure. */
function gateFile(pass: boolean): string {
  const judge = `async (play: { judge(part: string, verdict: { pass: boolean; what: string }): Promise<void> }) => { await play.judge("time", { pass: ${pass}, what: "${pass ? "12.4 s, within 20 s" : "25.1 s, over 20 s"}" }); }`;
  return `import { gate } from ${JSON.stringify(FORM)};
export default gate({ id: "gate-timing", waves: [1], parts: [{ id: "time", words: "the first reply within 20 s", mark: "code", measured: "the first reply's time, from the turn's own record" }], fixtures: [], bed: [], rig: ${judge}, live: ${judge} });
`;
}

/** A clean run with a chat layer that holds settings only; a run whose server ran another shipped tree; one with guidance in a chat's layer. */
const CLEAN = fakeFacts({ layers: [{ level: "chat", files: [{ path: "RPE.yml", sha256: sha256("reply:\n  streamAnyway: true\n") }] }] });
const SERVED_OTHER = fakeFacts({ served: shippedOf([{ path: "author/turn.md", sha256: sha256("Write it shorter.") }], FAKE_BUILD.rpe) });
const CHAT_LAYER = fakeFacts({ layers: [{ level: "chat", files: [{ path: "author/turn.md", sha256: sha256("Write it as a sonnet.") }] }] });

function proofRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-standing-root-"));
  made.push(dir);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(dir, "scenarios"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

async function runOn(at: string, facts: RunFacts, deps: Deps = {}): Promise<{ code: number; printed: string; dir: string }> {
  const where = join(out, `run-${made.length}-${Math.random().toString(36).slice(2, 8)}`);
  const printed: string[] = [];
  const code = await main(["rig", "gate-timing", "--root", at, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => fakeHost("rig", { pages: {} }, facts), ...deps });
  const [name] = existsSync(where) ? readdirSync(where).filter((n) => existsSync(join(where, n, "run.json"))) : [];
  return { code, printed: printed.join(""), dir: name ? join(where, name) : "" };
}

function json(path: string): { [key: string]: unknown } {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The outcome and figure the results file holds for the gate's measured part. */
function judged(dir: string): { outcome: string; why: string } {
  const record = json(join(dir, "gate-timing", "result.json")) as { parts: { instances: { outcome: string; why: string }[] }[] };
  const [instance] = record.parts[0]?.instances ?? [];
  return { outcome: instance?.outcome ?? "", why: instance?.why ?? "" };
}

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-standing-out-"));
  made.push(out);
  root = proofRoot({ "timing/gate.ts": gateFile(true) });
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

test("a clean run on shipped guidance gives met or unmet", async () => {
  const met = await runOn(root, CLEAN);
  expect(json(join(met.dir, "run.json")).standing).toMatchObject({ is: "verdict", why: [] });
  expect(judged(met.dir)).toEqual({ outcome: "met", why: "12.4 s, within 20 s" });
  expect(met.printed).toContain("This run gives a verdict:");
  expect(met.printed).toContain('- Gate gate-timing: passed\n  - "the first reply within 20 s" (code): Passed\n');
  expect(met.code).toBe(0);

  const unmet = await runOn(proofRoot({ "timing/gate.ts": gateFile(false) }), CLEAN);
  expect(judged(unmet.dir)).toEqual({ outcome: "unmet", why: "25.1 s, over 20 s" });
  expect(unmet.printed).toContain('- Gate gate-timing: failed\n  - "the first reply within 20 s" (code): Failed\n');
  expect(unmet.code).toBe(1);
});

test("a run whose served tree is not the build's, or with guidance in a chat's layer, or whose host does not say, is a trial: its measured part is printed as trial with its figure everywhere, never met", async () => {
  const cases: [RunFacts, string][] = [
    [SERVED_OTHER, "the shipped tree the server ran is not the build's: 1 path differs (author/turn.md)"],
    [CHAT_LAYER, "the chat layer holds guidance of its own, so its agents did not run under the shipped guidance: author/turn.md"],
    [fakeFacts({ none: true }), "the host gave no account of the guidance the run stood on (the shipped tree it served, the build's own, the layers of the user's own), so nothing shows its agents ran under the shipped guidance"],
  ];
  for (const [facts, why] of cases) {
    const trial = await runOn(root, facts);
    expect(json(join(trial.dir, "run.json")).standing).toMatchObject({ is: "trial", why: [why] });
    // The results file: the figure, with the word trial, never met or unmet.
    expect(judged(trial.dir)).toEqual({ outcome: "trial", why: "12.4 s, within 20 s" });
    expect(readFileSync(join(trial.dir, "gate-timing", "notes.md"), "utf8")).toContain("Play 1: trial, no verdict: 12.4 s, within 20 s.");
    // The report: the standing and why, and the part as trial with its figure.
    expect(trial.printed).toContain(`This run is a trial, and gives no verdict on what rests on guidance: ${why}.`);
    expect(trial.printed).toContain('- Gate gate-timing: trial\n  - "the first reply within 20 s" (code): Trial, no verdict: 12.4 s, within 20 s\n');
    expect(trial.printed).toContain("Played 1 of 1, not played 0; passed 0, failed 0, not seen 0, measured as a rate 0, trial 1.");
    expect(trial.printed).not.toMatch(/\b(met|unmet|passed 1)\b/);
    // The exit counts a trial apart: neither a pass nor a failure.
    expect(trial.code).toBe(3);
    // Read back alone, the bundle gives the same standing and outcome.
    const read = readBundle(trial.dir);
    expect(read.standing).toEqual({ is: "trial", why: [why] });
    expect(read.forms[0]?.result).toBe("trial");
  }
});

test("read back alone, a run.json that claims a verdict its own facts deny is a trial, with a fault", async () => {
  const trial = await runOn(root, SERVED_OTHER);
  const file = join(trial.dir, "run.json");
  const run = json(file) as { standing: { is: string; why: string[] } };
  writeFileSync(file, JSON.stringify({ ...run, standing: { ...run.standing, is: "verdict", why: [] } }));
  const read = readBundle(trial.dir);
  expect(read.standing.is).toBe("trial");
  expect(read.faults).toContain("run.json says the run gives a verdict, and what it stood on makes it a trial: the shipped tree the server ran is not the build's: 1 path differs (author/turn.md)");
  // A run.json that does not give its standing at all is a trial too: never a verdict.
  const { standing: _, ...bare } = run;
  writeFileSync(file, JSON.stringify(bare));
  expect(readBundle(trial.dir).standing).toEqual({ is: "trial", why: ["run.json does not give the run's standing, so it gives no verdict"] });
});
