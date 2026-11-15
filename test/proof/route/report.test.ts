// The report (PlanScenarios-1 item 5; plan §18.4 l.1994, "Reports say what was run and what was not"):
// from a bundle alone, a run that played 3 of the 68 reports the 65 it did not play, by number and
// why; no part counts as passed without its screen in the folder; a folder with no screen, or an empty
// one, is a fault of the evidence and fails its scenario, never a pass.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bundle, readBundle, runRecord } from "../../../scripts/proof/route/evidence";
import { summarize, writeReport } from "../../../scripts/proof/route/report";
import type { FormRecord, Glance } from "../../../scripts/proof/route/results";
import { sha256 } from "../../../scripts/proof/lib/record";
import { fakeFacts } from "./fake";

let out = "";
let report = "";
let bundle: Bundle;

/** A look on the World page at a width, its screen named as the bundle names it, with the digest of the bytes saved for it. */
function glance(width: number, part: string): Glance {
  return { page: "World", width, found: true, what: "time, place, coin and holder as before", shows: ["Coin: 40 silver"], screen: `play-01/world-${width}-${part}.png`, sha256: sha256("png"), shotPage: "World", shotText: "Time: dusk. Place: the mill. Coin: 40 silver. Lantern: Oskar", unshown: null };
}

function record(id: string, number: number, line: number, part: string, words: string): FormRecord {
  return { run: bundle.run, id, kind: "scenario", number, waves: [2], line, mode: "rig", plays: 1, stops: [], parts: [{ id: part, words, mark: "code", pages: ["World"], measured: null, wants: null, instances: [{ play: 1, at: 1, outcome: "shown", why: "time, place, coin and holder as before", page: null, glances: [glance(1440, part), glance(390, part)] }] }] };
}

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-report-"));
  bundle = Bundle.open(out, "rig", new Date("2026-11-15T04:00:00.000Z"));
  // 04: played, its screens saved.
  bundle.formDir("04");
  const four = record("04", 4, 1814, "vague-fact", "A vague fact on the World page beside the last exact amount; a later exact amount settles it");
  for (const g of four.parts[0]?.instances[0]?.glances ?? []) bundle.saveScreen("04", 1, "World", "vague-fact", { image: new TextEncoder().encode("png"), format: "png", page: "World", width: g.width ?? 0, text: g.shotText ?? "" });
  bundle.writeResult(four);
  bundle.writeNotes(four);
  // 22: its record calls the part seen, and the folder holds no screen of it.
  bundle.formDir("22");
  const twentyTwo = record("22", 22, 1836, "four-values", "The four values are as before those turns; a note written in them is back to its earlier text");
  bundle.writeResult(twentyTwo);
  bundle.writeNotes(twentyTwo);
  // 38: a folder made and nothing saved in it.
  mkdirSync(join(bundle.dir, "38"));
  bundle.writeRun(runRecord(fakeFacts(), { run: bundle.run, mode: "rig", by: "a test", started: "2026-11-15T04:00:00.000Z", ended: "2026-11-15T04:01:00.000Z", asked: ["04", "22", "38"], unplayed: [], known: { scenarios: ["04", "22", "38"], gates: [] }, repeats: 10, faults: [] }));
  report = writeReport(bundle.dir);
});

afterAll(() => {
  if (out !== "") rmSync(out, { recursive: true, force: true });
});

test("a bundle with 3 of the 68 played reports the 65 not played, by number", () => {
  const summary = summarize(readBundle(bundle.dir));
  expect(summary.scenarios.filter((s) => s.played).map((s) => s.number)).toEqual([4, 22, 38]);
  const listed = report
    .split("\n")
    .filter((line) => line.startsWith("- Not played (not asked in this run): "))
    .flatMap((line) => line.slice(line.indexOf(": ") + 2).split(", ").map(Number));
  const expected = Array.from({ length: 68 }, (_, i) => i + 1).filter((n) => ![4, 22, 38].includes(n));
  expect(listed.sort((a, b) => a - b)).toEqual(expected);
  expect(report).toContain("All 68: played 3 of 68, not played 65; passed 1, failed 2 (2 for faults of the evidence), not seen 0, measured as a rate 0.");
  expect(report).toContain("### Wave 2 (15)\n\nPlayed 2 of 15, not played 13; passed 1, failed 1 (1 for faults of the evidence), not seen 0, measured as a rate 0.");
});

test("no part counts as passed without its screen in the folder", () => {
  expect(report).toContain("- 4. \"She spent most of her coin\": passed");
  expect(report).toContain("- 22. Delete two turns: failed: a fault of its evidence");
  expect(report).toContain('  - "The four values are as before those turns; a note written in them is back to its earlier text" (code): Not seen');
  expect(report).toContain("    - Not seen in play 1: seen on the World page at 1440, and its screen play-01/world-1440-four-values.png is not in the folder. Screens: play-01/world-1440-four-values.png, play-01/world-390-four-values.png");
  expect(report).toContain("- 22: the folder holds no screen");
  expect(report).toContain("- 22: notes.md names play-01/world-1440-four-values.png, which the folder lacks");
});

test("an empty scenario folder is a fault of the evidence and fails its scenario, never a pass", () => {
  expect(report).toContain("- 38: the folder is empty");
  expect(report).toContain("- 38. The rehearsal on the test instance of §15.5, run from a copy of the new build in another folder: failed: a fault of its evidence; its folder holds no record of what was played");
  expect(report).toContain("### Wave 1 (1)\n\nPlayed 1 of 1, not played 0; passed 0, failed 1 (1 for faults of the evidence), not seen 0, measured as a rate 0.");
});
