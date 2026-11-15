// A measured part not judged (PlanScenarios-8 item 5). A gate's form may say one of its measured parts
// is not judged, and why (`play.notJudged`): the runner records the outcome "not judged" with that why,
// and the results file and the report print "not judged: <why>". A part its form neither judged nor
// declared stays as before: "unlooked", its form never judged it. Neither is ever a pass.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readBundle } from "../../../scripts/proof/route/evidence";
import { main } from "../../../scripts/proof/run";
import { fakeHost } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");
const made: string[] = [];
let root = "";
let out = "";

const TOKENS = { id: "tokens", words: "the Author's guidance stack against a target of about 6,000 tokens", mark: "code", measured: "the opening tokens of the Author's first call" };
const TIME = { id: "time", words: "the first reply within 20 s", mark: "code", measured: "the first reply's time" };

/** A gate of measured parts whose form runs `body` for each play. */
function gateFile(id: string, parts: object[], body: string): string {
  const form = `async (play: { notJudged(part: string, why: string): Promise<void> }) => { ${body} }`;
  return `import { gate } from ${JSON.stringify(FORM)};
export default gate({ id: ${JSON.stringify(id)}, waves: [1], parts: ${JSON.stringify(parts)}, fixtures: [], bed: [], rig: ${form}, live: ${form} });
`;
}

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-not-judged-out-"));
  made.push(out);
  root = mkdtempSync(join(tmpdir(), "proof-not-judged-root-"));
  made.push(root);
  writeFileSync(join(root, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(root, "scenarios"));
  const files: Record<string, string> = {
    "rows/gate.ts": gateFile("gate-rows", [TOKENS, TIME], 'await play.notJudged("tokens", "the stack was not reported at this wave");'),
    "stack/gate.ts": gateFile("gate-stack", [TOKENS], 'await play.notJudged("tokens", "the stack was not reported at this wave");'),
    "wrong/gate.ts": gateFile("gate-wrong", [TOKENS], 'await play.notJudged("replies", "there were none");'),
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function instancesOf(dir: string, gate: string): Record<string, { outcome: string; why: string }[]> {
  const record = JSON.parse(readFileSync(join(dir, gate, "result.json"), "utf8")) as { parts: { id: string; instances: { outcome: string; why: string }[] }[] };
  return Object.fromEntries(record.parts.map((p) => [p.id, p.instances.map(({ outcome, why }) => ({ outcome, why }))]));
}

test("a measured part declared not judged is recorded and reported not judged, with why; one never touched stays unlooked", async () => {
  const where = join(out, "run");
  const printed: string[] = [];
  const code = await main(["rig", "gate-rows", "gate-stack", "gate-wrong", "--root", root, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => fakeHost("rig", { pages: {} }) });
  const [name] = readdirSync(where).filter((n) => existsSync(join(where, n, "run.json")));
  const dir = join(where, name ?? "");
  const report = printed.join("");

  // The results file: the declared part's outcome and why; the untouched part as before.
  expect(instancesOf(dir, "gate-rows")).toEqual({
    tokens: [{ outcome: "not judged", why: "the stack was not reported at this wave" }],
    time: [{ outcome: "unlooked", why: "its form never judged it" }],
  });
  expect(readFileSync(join(dir, "gate-rows", "notes.md"), "utf8")).toContain("Play 1: not judged: the stack was not reported at this wave.");
  expect(readFileSync(join(dir, "gate-rows", "notes.md"), "utf8")).toContain("Play 1: never looked for: its form never judged it.");

  // The report: "not judged: <why>" for the declared part; the untouched part never judged, as before; neither a pass.
  expect(report).toContain(`  - "${TOKENS.words}" (code): Not judged: the stack was not reported at this wave\n`);
  expect(report).toContain(`  - "${TIME.words}" (code): Not seen\n    - Not seen in play 1: its form never judged it. Screens: no screen\n`);
  expect(report).toContain("- Gate gate-rows: not seen\n");
  expect(report).toContain("- Gate gate-stack: not judged\n");
  expect(report).toContain("not judged 1");

  // A form that says a part not judged which is none of its measured parts stops, as a fault of its script.
  expect(report).toContain("- Gate gate-wrong: failed\n  - Play 1 stopped: its form stopped: the form said replies is not judged, which is not one of its measured parts\n");
  expect(code).toBe(1);

  // Read back alone, the bundle gives the same.
  const read = readBundle(dir);
  expect(Object.fromEntries(read.forms.map((f) => [f.id, f.result]))).toEqual({ "gate-rows": "not seen", "gate-stack": "not judged", "gate-wrong": "failed" });
  expect(read.forms.flatMap((f) => f.faults)).toEqual([]);
});
