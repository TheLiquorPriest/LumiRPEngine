// The wave record, the stop rule and the order of the waves (PlanScenarios-5 items 4 and 5): `run.ts checkpoint 2` refuses while wave 1's record lacks its review, while an item left open
// names no taker, or when seven packages ran at once; a record with a failing G0 cannot be marked met, and `checkpoint` prints the report to the owner; two failed rounds stop the build;
// and a wave is met on what its bundles hold, never on an exit code. The bundles are given as the counts and facts they read back to (`ReadFolder`).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint, judge, parseOptions, recordFile, stopReport } from "../../../scripts/proof/checkpoint/checkpoint";
import type { Counts, CountsRead } from "../../../scripts/proof/checkpoint/counts";
import { evaluate, mostAtOnce, readRecord, type ReadFolder, type WaveRecord } from "../../../scripts/proof/checkpoint/wave";
import type { ReadBundle } from "../../../scripts/proof/route/evidence";
import type { FormRecord } from "../../../scripts/proof/route/results";

const FROM = "1".repeat(40);
const TO = "2".repeat(40);
const FIX = "3".repeat(40);
const PIN = "4".repeat(40);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-checkpoint-"));
});
afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const NONE: Counts = { asked: 3, played: 3, notPlayed: 0, passed: 3, failed: 0, measured: 0, notSeen: 0, notPlayedWhole: 0, trial: 0, notJudged: 0, faulty: 0 };

/** A bundle as it reads back: the commits it ran at, how its RPH was pinned, what it was asked, and its forms. */
function bundle(mode: "rig" | "live", forms: ReadBundle["forms"] = []): ReadBundle {
  // Only the fields the checkpoint reads are given: the bundle's run record is not rebuilt whole here.
  const read = { dir: "x", forms, faults: [], standing: { is: "verdict", why: [] }, run: { mode, asked: ["02", "04", "floor"], unplayed: [], ended: "2026-11-15T05:00:00.000Z", rpe: { commit: TO, dirty: false }, rph: { commit: PIN, pin: PIN, pinned: true } } };
  return read as unknown as ReadBundle;
}

/** A folder reads back to these counts and this bundle; a folder not named is no bundle. */
function folders(table: Record<string, { problems?: string[]; read: ReadBundle }>): ReadFolder {
  return (name) => {
    const held = table[name];
    if (held === undefined) return { counts: { ...NONE, asked: 0, played: 0, passed: 0 }, rates: [], problems: [`${name} cannot be read as a bundle`], read: null };
    const counted: CountsRead = { counts: NONE, rates: [], problems: held.problems ?? [] };
    return { ...counted, read: held.read };
  };
}

/** G0's record in a live bundle, its verdict part judged `outcome`. */
function g0(outcome: "met" | "unmet"): ReadBundle["forms"] {
  const record: FormRecord = {
    id: "G0",
    kind: "gate",
    number: null,
    waves: [1],
    line: null,
    mode: "live",
    plays: 1,
    parts: [{ id: "verdict", words: "G0's word", mark: "code", pages: [], measured: "all four rows judged and passed", wants: null, instances: [{ play: 1, at: 1, outcome, why: outcome === "met" ? "all four rows passed" : "the first-words row failed", page: null, glances: [] }] }],
    stops: [],
    standings: [{ play: 1, is: "verdict", why: [] }],
  };
  return [{ id: "G0", record, stages: null, faults: [], result: outcome === "met" ? "passed" : "failed" }];
}

/** A wave's record with everything it needs, which a test then breaks one thing of. */
function whole(wave: number, over: Partial<WaveRecord> = {}): WaveRecord {
  const packages = ["PlanA-1", "PlanA-2", "PlanB-1", "PlanB-2"].map((id, i) => ({ id, started: `2026-11-1${i}T08:00:00.000Z`, ended: `2026-11-1${i}T20:00:00.000Z`, lane: `Lane${i}` }));
  return {
    wave,
    packages,
    gaps: [{ id: "AuProof-1", file: "scripts/proof/route/runner.ts", line: 120 }],
    open: [{ package: "PlanB-2", item: "7", lane: "Lane9" }],
    rig: "rig-bundle",
    live: wave === 1 || wave === 5 ? "live-bundle" : null,
    review: { from: FROM, to: TO, sections: ["§17.0 l.1745-1753"], findings: [{ id: "F1", fixed: FIX }] },
    lead: { checked: "2026-11-16T09:00:00.000Z", by: "the lead" },
    fixedValues: { putToOwner: true, at: "2026-11-16T09:30:00.000Z" },
    pin: PIN,
    rounds: [],
    met: null,
    stopped: null,
    ...over,
  };
}

const READ_RIG = { "rig-bundle": { read: bundle("rig") } };
const READ_ALL = { ...READ_RIG, "live-bundle": { read: bundle("live", g0("met")) } };

test("a wave with everything on its record, its bundles met on their counts, is met", () => {
  expect(evaluate(whole(2), ["02", "04", "floor"], folders(READ_RIG)).problems).toEqual([]);
  const first = evaluate(whole(1), ["02", "04", "floor"], folders(READ_ALL));
  expect(first.problems).toEqual([]);
  expect(first.g0?.standing).toBe("met");
});

test("seven packages at once, an item left open with no taker, a gap with no line, a package not ended and a missing review each keep a wave from being met", () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `P-${i + 1}`, started: "2026-11-10T08:00:00.000Z", ended: "2026-11-10T20:00:00.000Z", lane: `L${i}` }));
  expect(mostAtOnce(seven).most).toBe(7);
  const found = evaluate(whole(2, { packages: seven }), null, folders(READ_RIG)).problems;
  expect(found.join(" ")).toContain("7 packages ran at once");
  // Halves: six, then one that starts as the others end, is no seventh.
  const halves = [...seven.slice(0, 6), { id: "P-7", started: "2026-11-10T20:00:00.000Z", ended: "2026-11-11T08:00:00.000Z", lane: "L7" }];
  expect(mostAtOnce(halves).most).toBe(6);

  expect(evaluate(whole(2, { open: [{ package: "PlanB-2", item: "7", lane: null }] }), null, folders(READ_RIG)).problems.join(" ")).toContain("item 7 of PlanB-2 is left open and names no lane");
  expect(evaluate(whole(2, { gaps: [{ id: "AuProof-9", file: "", line: 0 }] }), null, folders(READ_RIG)).problems.join(" ")).toContain("the gap AuProof-9 is claimed closed with no file and line");
  expect(evaluate(whole(2, { packages: [{ id: "PlanA-1", started: "2026-11-10T08:00:00.000Z", ended: null, lane: "L" }] }), null, folders(READ_RIG)).problems.join(" ")).toContain("package PlanA-1 has not ended");
  expect(evaluate(whole(2, { review: null }), null, folders(READ_RIG)).problems.join(" ")).toContain("holds no review");
  expect(evaluate(whole(2, { review: { from: "abc123", to: TO, sections: ["§1"], findings: [] } }), null, folders(READ_RIG)).problems.join(" ")).toContain("by anything but a whole commit");
  expect(evaluate(whole(2, { review: { from: FROM, to: TO, sections: ["§1"], findings: [{ id: "F2", fixed: null }] } }), null, folders(READ_RIG)).problems.join(" ")).toContain("finding F2 is not fixed");
  expect(evaluate(whole(2, { lead: null, fixedValues: null, pin: "4444" }), null, folders(READ_RIG)).problems.join(" ")).toContain("lead's check is not on the record");
});

test("a wave is met on the counts of its bundles, never on an exit code: a code part not passed, a bundle of another commit or pin, or one not asked a form of the wave keeps it unmet", () => {
  const counted = evaluate(whole(2), null, folders({ "rig-bundle": { read: bundle("rig"), problems: ['04: the code part "vague-fact" is not seen'] } })).problems;
  expect(counted.join(" ")).toContain('the rig bundle: 04: the code part "vague-fact" is not seen');
  const elsewhere = bundle("rig");
  const run = { ...elsewhere.run, rpe: { commit: "9".repeat(40), dirty: false }, rph: { ...elsewhere.run.rph, pin: null, pinned: false } };
  const other = evaluate(whole(2), null, folders({ "rig-bundle": { read: { ...elsewhere, run } } })).problems.join(" ");
  expect(other).toContain("not at the commit the wave's review ends at");
  expect(other).toContain("RPH is not the pinned commit");
  expect(evaluate(whole(2), ["02", "04", "17"], folders(READ_RIG)).problems.join(" ")).toContain("was not asked 17");
  expect(evaluate(whole(2, { rig: null }), null, folders(READ_RIG)).problems.join(" ")).toContain("names no rig bundle");
  expect(evaluate(whole(2, { rig: "gone" }), null, folders(READ_RIG)).problems.join(" ")).toContain("gone cannot be read as a bundle");
});

test("G0 failing at wave 1 is not met, and the stop report to the owner names it with his choices; a wave 1 with no live bundle is not met either", () => {
  const failed = evaluate(whole(1), null, folders({ ...READ_RIG, "live-bundle": { read: bundle("live", g0("unmet")) } }));
  expect(failed.g0?.standing).toBe("failed");
  expect(failed.problems.join(" ")).toContain("G0 is not met: G0's verdict part failed: the first-words row failed");
  const report = stopReport(1, "G0's verdict part failed", { evaluation: failed, problems: failed.problems }, 0);
  expect(report).toContain("NOTICE FOR THE OWNER: G0 failed at wave 1: the build stops here");
  expect(report).toContain("Your choices");
  expect(report).toContain("Stop here");
  expect(evaluate(whole(1, { live: null }), null, folders(READ_RIG)).problems.join(" ")).toContain("names no live bundle");
  expect(evaluate(whole(1), null, folders({ ...READ_RIG, "live-bundle": { read: bundle("live") } })).problems.join(" ")).toContain("G0 is not met");
});

test("a record is read as written: a field of the wrong kind is named, and a field left out is an empty one", () => {
  const read = readRecord({ wave: 2, packages: "all of them", gaps: [{ id: "G1", file: "a.ts", line: "12" }], review: { from: FROM, to: TO, findings: [{ id: "F1" }] } }, 2);
  expect(read.problems).toEqual(["packages is not a list"]);
  expect(read.record.gaps).toEqual([{ id: "G1", file: "a.ts", line: 0 }]);
  expect(read.record.review?.findings).toEqual([{ id: "F1", fixed: null }]);
  expect(readRecord({ wave: 3 }, 2).problems).toEqual(["the record says it is wave 3, and it is read as wave 2"]);
  expect(readRecord("no", 2).problems).toEqual(["the record is not an object"]);
});

test("the command: the next wave's checkpoint refuses while the wave before it lacks its review or is not met, and says so", async () => {
  const records = join(dir, "records");
  mkdirSync(join(records, "checkpoints"), { recursive: true });
  const lacking = whole(1, { review: null, met: { at: "2026-11-16T10:00:00.000Z" } });
  writeFileSync(recordFile(records, 1), JSON.stringify(lacking));
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
  try {
    expect(await checkpoint(2, ["--records", records])).toBe(1);
    expect(lines.join("")).toContain("Refused: wave 1 is not met on its record, so wave 2 does not start.");
    expect(lines.join("")).toContain("the record holds no review of the wave's diff");
    lines.length = 0;
    // No record of wave 1 at all: it is not met.
    expect(await checkpoint(3, ["--records", records])).toBe(1);
    expect(lines.join("")).toContain("wave 1 is not met");
    lines.length = 0;
    // A wave asked of with no record of its own is not met, and nothing is marked.
    expect(await checkpoint(1, ["--records", join(dir, "nowhere")])).toBe(1);
    expect(lines.join("")).toContain("there is no record of wave 1");
    lines.length = 0;
    expect(await checkpoint(2, ["--bogus"])).toBe(2);
  } finally {
    process.stdout.write = write;
  }
  expect(parseOptions(["--records"])).toBe("--records takes a value");
  expect(parseOptions(["--mark", "--brief"], { RPE_PROOF_RECORDS: "x" })).toContain("two things");
  expect(parseOptions([], {})).toContain("set RPE_PROOF_RECORDS");
});

test("a try marked in the record is kept as a round; two failed rounds stop the build, a stopped record cannot be marked met without the owner's ruling, and the ruling makes the rounds new", async () => {
  const records = join(dir, "marked");
  mkdirSync(join(records, "checkpoints"), { recursive: true });
  // Wave 1 needs no wave before it. Its bundles are not on this disk, so every try fails, which is what the rounds count.
  const file = recordFile(records, 1);
  writeFileSync(file, JSON.stringify(whole(1)));
  const mute = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
  try {
    expect(await checkpoint(1, ["--records", records, "--mark"])).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ rounds: [{ met: false }], met: null, stopped: null });
    expect(lines.join("")).not.toContain("NOTICE FOR THE OWNER");
    lines.length = 0;
    expect(await checkpoint(1, ["--records", records, "--mark"])).toBe(1);
    const stopped = JSON.parse(readFileSync(file, "utf8"));
    expect(stopped.rounds).toHaveLength(2);
    expect(stopped.stopped).toMatchObject({ ruling: null });
    expect(lines.join("")).toContain("NOTICE FOR THE OWNER: Wave 1's checkpoint cannot be met: the build stops widening");
    lines.length = 0;
    // Stopped: the problems say the owner has not ruled, and the report is printed again.
    expect(await checkpoint(1, ["--records", records])).toBe(1);
    expect(lines.join("")).toContain("the owner has not ruled");
    expect(lines.join("")).toContain("NOTICE FOR THE OWNER");
    // His ruling is put in the record by the lead: the stop is lifted, and the rounds count from it.
    writeFileSync(file, JSON.stringify({ ...stopped, stopped: { ...stopped.stopped, ruling: { answer: "one more round", at: "2999-01-01T00:00:00.000Z" } } }));
    lines.length = 0;
    expect(await checkpoint(1, ["--records", records])).toBe(1);
    expect(lines.join("")).not.toContain("the owner has not ruled");
  } finally {
    process.stdout.write = mute;
  }
});

test("a record that says it is met is read again: what was marked met is not taken for met when its bundles no longer say so", () => {
  const judged = judge({ record: whole(2, { met: { at: "2026-11-16T10:00:00.000Z" } }), problems: [], present: true }, null, folders({}));
  expect(judged.problems.join(" ")).toContain("rig-bundle cannot be read as a bundle");
});
