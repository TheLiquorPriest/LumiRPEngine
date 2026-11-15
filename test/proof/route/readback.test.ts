// Read back from the bundle alone, a pass stands only on screens that show it (PlanScenarios-1 items 4
// and 5; plan §17.0 l.1751). Bundles are made here by hand, as a record written or changed outside the
// runner would be: a look recorded seen with no look on a page, an outcome word the runner never
// writes, a part with no look in a play, a page or a width never looked at, a record whose looks say
// otherwise, a folder holding another scenario's or a gate's record, words of the row no part carries,
// fewer plays than the run made, notes missing: each is a fault of the evidence, and each fails the
// result it concerns. An honest record of the same shape passes.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../../../scripts/proof/lib/record";
import { Bundle, notesOf, readBundle } from "../../../scripts/proof/route/evidence";
import { main } from "../../../scripts/proof/run";
import { pageSlug, type Mark } from "../../../scripts/proof/route/form";
import { reportOf, summarize } from "../../../scripts/proof/route/report";
import type { FormRecord, Glance, Instance, PartRecord } from "../../../scripts/proof/route/results";
import { fakePlays, fakeRun } from "./fake";

let out = "";
let count = 0;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-readback-"));
});

afterAll(() => {
  if (out !== "") rmSync(out, { recursive: true, force: true });
});

const pad = (n: number) => String(n).padStart(2, "0");

/** One look at a page at a width, its screen named as the bundle names it, with the digest of the bytes `bundle` writes for it, its page showing the part. */
function glance(page: string, width: number, part: string, play = 1, found: boolean | null = true): Glance {
  const text = `${page}: ${part} as recorded`;
  return { page, width, found, what: found ? `${part} seen` : `${part} not there`, shows: found ? [text] : [], screen: `play-${pad(play)}/${pageSlug(page)}-${width}-${part}.png`, sha256: sha256("png"), shotPage: page, shotText: found ? text : `${page}: nothing`, unshown: null };
}

type PartSpec = { id: string; words: string; mark?: Mark; pages?: string[] };

/** An honest record: every part shown on every page, at both widths, in every play. */
function record(id: string, number: number | null, parts: PartSpec[], fields: Partial<FormRecord> = {}): FormRecord {
  const plays = fields.plays ?? 1;
  const partRecords: PartRecord[] = parts.map((p) => {
    const pages = p.pages ?? ["World"];
    const instances: Instance[] = [];
    for (let n = 1; n <= plays; n++) instances.push({ play: n, at: 1, outcome: "shown", why: "seen", page: null, glances: pages.flatMap((page) => [glance(page, 390, p.id, n), glance(page, 1440, p.id, n)]) });
    return { id: p.id, words: p.words, mark: p.mark ?? "code", pages, measured: null, wants: null, instances };
  });
  const row = number === null ? null : { 4: [2, 1814], 22: [2, 1836], 23: [2, 1837], 26: [3, 1840] }[number];
  return { id, kind: number === null ? "gate" : "scenario", number, waves: row ? [row[0] ?? 0] : [2], line: row ? (row[1] ?? null) : null, mode: "rig", plays, stops: [], parts: partRecords, ...fields };
}

const FOUR: PartSpec[] = [
  { id: "vague-fact", words: "A vague fact on the World page beside the last exact amount" },
  { id: "settles", words: "a later exact amount settles it" },
];
const DELETE_TWO: PartSpec[] = [
  { id: "four-values", words: "The four values are as before those turns" },
  { id: "note", words: "a note written in them is back to its earlier text", pages: ["Files"] },
];
const BRANCH: PartSpec[] = [{ id: "values", words: "The new chat's World page shows the same four values. After one more turn in each chat, the value that turn changed differs between them, and the source chat's other values are as they were" }];

/** A folder of the bundle: its record, the screens it holds ("all" those the record names), and its notes ("made" from the record, "none", or a text of their own). */
type FolderSpec = { folder: string; record: unknown; screens?: "all" | "none" | string[]; notes?: string };

/** How many plays a folder's record says it holds (one for anything that is not a record). */
const playsOf = (record: unknown): number => (record !== null && typeof record === "object" && typeof (record as FormRecord).plays === "number" ? (record as FormRecord).plays : 1);

/** A bundle holding the folders given, each with its record, the screens it names (or none), and notes made from its record; its run.json carries a clean account of every play of every folder. */
function bundle(folders: FolderSpec[], fields: { mode?: "rig" | "live"; repeats?: number; asked?: string[] } = {}): string {
  const made = Bundle.open(out, fields.mode ?? "rig", new Date(Date.UTC(2026, 10, 15, 5, 0, count++)));
  for (const spec of folders) {
    const dir = join(made.dir, spec.folder);
    mkdirSync(join(dir, "internal"), { recursive: true });
    // A record is this run's, a verdict in every play, unless the test says it is another's.
    const standings = Array.from({ length: playsOf(spec.record) }, (_, n) => ({ play: n + 1, is: "verdict" as const, why: [] }));
    const rec = { run: made.run, nonce: made.nonce, standings, ...(spec.record as FormRecord) };
    writeFileSync(join(dir, "result.json"), JSON.stringify(spec.record !== null && typeof spec.record === "object" ? rec : spec.record));
    const named = rec.parts?.flatMap((p) => p.instances?.flatMap((i) => i.glances?.flatMap((g) => (g.screen ? [g.screen] : [])) ?? []) ?? []) ?? [];
    const screens = spec.screens === undefined || spec.screens === "all" ? named : spec.screens === "none" ? [] : spec.screens;
    for (const screen of screens) {
      mkdirSync(join(dir, dirname(screen)), { recursive: true });
      writeFileSync(join(dir, screen), "png");
    }
    if (spec.notes !== "none") writeFileSync(join(dir, "notes.md"), spec.notes === undefined || spec.notes === "made" ? notesOf(rec, made.run) : spec.notes);
  }
  const asked = fields.asked ?? folders.map((f) => f.folder);
  made.writeRun(fakeRun({ run: made.run, nonce: made.nonce, mode: fields.mode ?? "rig", by: "a test", started: "2026-11-15T05:00:00.000Z", ended: "2026-11-15T05:01:00.000Z", asked, unplayed: [], known: { scenarios: asked.filter((a) => /^\d{2}$/.test(a)), gates: asked.filter((a) => !/^\d{2}$/.test(a)) }, repeats: fields.repeats ?? 10, faults: [] }, folders.flatMap((f) => fakePlays(f.folder, playsOf(f.record)))));
  return made.dir;
}

function resultOf(dir: string, id: string): string | null | undefined {
  const s = summarize(readBundle(dir));
  return [...s.scenarios, ...s.gates].find((c) => c.id === id)?.result;
}

function faultsOf(dir: string, id: string): string[] {
  return readBundle(dir).forms.find((f) => f.id === id)?.faults ?? [];
}

test("an honest record with its screens and notes passes", () => {
  const dir = bundle([{ folder: "04", record: record("04", 4, FOUR) }]);
  expect(faultsOf(dir, "04")).toEqual([]);
  expect(resultOf(dir, "04")).toBe("passed");
});

test("four folders whose looks are recorded seen and name no look on a page fail, every one, and are never counted passed", () => {
  const bare = (id: string, number: number, parts: PartSpec[]) => {
    const rec = record(id, number, parts);
    for (const part of rec.parts) for (const instance of part.instances) instance.glances = [];
    return { folder: id, record: rec, screens: "none" as const };
  };
  const dir = bundle([bare("04", 4, FOUR), bare("22", 22, DELETE_TWO), bare("23", 23, BRANCH), bare("26", 26, [{ id: "range", words: "The briefing gives the range", pages: ["Turn"] }, { id: "records", words: "the Author records what matters", mark: "as shipped", pages: ["Story"] }])]);
  for (const id of ["04", "22", "23", "26"]) expect(resultOf(dir, id)).toBe("failed");
  expect(faultsOf(dir, "04")).toEqual(expect.arrayContaining(["the folder holds no screen", 'part vague-fact: look 1 of play 1 is recorded "shown" and names no look on a page']));
  const report = reportOf(readBundle(dir));
  expect(report).toContain("All 68: played 4 of 68, not played 64; passed 0, failed 4 (4 for faults of the evidence), not seen 0, measured as a rate 0.");
  expect(report).toContain("- 4. \"She spent most of her coin\": failed: a fault of its evidence");
});

test("an outcome word the runner never writes, a measured verdict on a seen part, and a part with no look in a play are faults that fail the scenario", () => {
  const word = record("04", 4, FOUR);
  (word.parts[0]?.instances[0] as { outcome: string }).outcome = "ok";
  const met = record("22", 22, DELETE_TWO);
  (met.parts[0]?.instances[0] as { outcome: string }).outcome = "met";
  const none = record("23", 23, BRANCH);
  (none.parts[0] as PartRecord).instances = [];
  const dir = bundle([
    { folder: "04", record: word },
    { folder: "22", record: met },
    { folder: "23", record: none },
  ]);
  expect(faultsOf(dir, "04")).toContain('part vague-fact: look 1 of play 1 is recorded "ok", which the runner never writes');
  expect(faultsOf(dir, "22")).toContain('part four-values: look 1 of play 1 is recorded "met", which the runner writes only for a measured part of a gate');
  expect(faultsOf(dir, "23")).toContain("part values has no look in play 1");
  for (const id of ["04", "22", "23"]) expect(resultOf(dir, id)).toBe("failed");
});

test("a page or a width never looked at, and a record its own looks contradict, are faults", () => {
  // A part seen on two pages whose record drops the look on one, and says nothing of it.
  const page = record("22", 22, [{ ...(DELETE_TWO[0] as PartSpec), pages: ["World", "Files"] }, DELETE_TWO[1] as PartSpec]);
  const both = page.parts[0]?.instances[0] as Instance;
  both.glances = both.glances.filter((g) => g.page === "World");
  const width = record("04", 4, FOUR);
  const first = width.parts[0]?.instances[0] as Instance;
  first.glances = first.glances.filter((g) => g.width === 1440);
  const contradicted = record("23", 23, BRANCH);
  (contradicted.parts[0]?.instances[0] as { outcome: string }).outcome = "absent";
  const dir = bundle([
    { folder: "22", record: page },
    { folder: "04", record: width },
    { folder: "23", record: contradicted },
  ]);
  expect(faultsOf(dir, "22")).toContain("part four-values in play 1 was never looked for on the Files page, and its record does not say so");
  expect(faultsOf(dir, "04")).toContain("part vague-fact: look 1 of play 1 looks at the World page at 1440 and not at 390");
  expect(faultsOf(dir, "23")).toContain('part values: look 1 of play 1 is recorded "absent", and its looks make it "shown"');
  for (const id of ["22", "04", "23"]) expect(resultOf(dir, id)).toBe("failed");
});

test("a folder holding another scenario's or a gate's record fails as that folder's scenario, and is never counted as a gate", () => {
  const dir = bundle([
    { folder: "23", record: record("04", null, FOUR, { kind: "gate" }) },
    { folder: "22", record: record("04", 4, FOUR) },
  ]);
  expect(faultsOf(dir, "23")).toContain("its record is of gate 04, not of scenario 23");
  expect(faultsOf(dir, "22")).toContain("its record is of scenario 4, not of scenario 22");
  expect(resultOf(dir, "23")).toBe("failed");
  expect(resultOf(dir, "22")).toBe("failed");
  const report = reportOf(readBundle(dir));
  expect(report).not.toContain("Gate 23");
  expect(report).not.toContain("Gate 04");
  expect(summarize(readBundle(dir)).gates).toEqual([]);
});

test("a record that does not carry its row's words, or holds fewer plays than the run made, fails", () => {
  const partial = record("22", 22, DELETE_TWO.slice(0, 1));
  const short = record("26", 26, [{ id: "range", words: "The briefing gives the range", pages: ["Turn"] }, { id: "records", words: "the Author records what matters", mark: "as shipped", pages: ["Story"] }], { mode: "live", plays: 3 });
  const dir = bundle(
    [
      { folder: "22", record: { ...partial, mode: "live" } },
      { folder: "26", record: short },
    ],
    { mode: "live", repeats: 10 },
  );
  expect(faultsOf(dir, "22")).toContain(`its record: no part carries the plan's words "a note written in them is back to its earlier text"`);
  expect(faultsOf(dir, "26")).toContain('its record has 3 plays, and this run played a scenario with an "as shipped" part 10 times');
  expect(resultOf(dir, "22")).toBe("failed");
  expect(resultOf(dir, "26")).toBe("failed");
});

test("a record that names a part twice is not a record of the runner's, and fails", () => {
  const twice = record("04", 4, FOUR);
  twice.parts.push(twice.parts[0] as PartRecord);
  const dir = bundle([{ folder: "04", record: twice }]);
  expect(faultsOf(dir, "04")).toContain("result.json is not a run's record of a form: part vague-fact is named twice");
  expect(resultOf(dir, "04")).toBe("failed");
});

test("a fault of the evidence always changes the result it concerns: an honest record with no notes fails", () => {
  const dir = bundle([{ folder: "04", record: record("04", 4, FOUR), notes: "none" }]);
  expect(faultsOf(dir, "04")).toEqual(["notes.md is missing"]);
  expect(resultOf(dir, "04")).toBe("failed");
});

test("a screen no look names, and notes that leave out a screen the record names, are faults; `report` exits non-zero on them", async () => {
  const honest = record("04", 4, FOUR);
  const stray = bundle([{ folder: "04", record: honest, screens: [...honest.parts.flatMap((p) => p.instances.flatMap((i) => i.glances.map((g) => g.screen ?? ""))), "play-01/world-1440-vague-fact-2.png"] }]);
  expect(faultsOf(stray, "04")).toEqual(["play-01/world-1440-vague-fact-2.png: no look in result.json names it"]);
  expect(resultOf(stray, "04")).toBe("failed");
  const quiet = bundle([{ folder: "04", record: honest, notes: "# Scenario 4\n\nNo screens are named here.\n" }]);
  expect(faultsOf(quiet, "04")).toContain("notes.md does not name play-01/world-390-vague-fact.png, which result.json names");
  const printed: string[] = [];
  expect(await main(["report", quiet], { out: (text) => printed.push(text) })).toBe(1);
  expect(printed.join("")).toContain("- 4. \"She spent most of her coin\": failed: a fault of its evidence");
  expect(await main(["report", bundle([{ folder: "04", record: honest }])], { out: () => {} })).toBe(0);
});

test("a folder another run left, notes that say other than their record, and a screen whose bytes were changed are faults, never a pass", () => {
  const other = bundle([{ folder: "04", record: record("04", 4, FOUR, { run: "rig-20261114T100000Z" }) }]);
  expect(faultsOf(other, "04").some((f) => f.startsWith("its record is of run rig-20261114T100000Z, and this bundle is run "))).toBe(true);
  expect(resultOf(other, "04")).toBe("failed");

  const told = bundle([{ folder: "04", record: record("04", 4, FOUR) }]);
  const notes = join(told, "04", "notes.md");
  writeFileSync(notes, readFileSync(notes, "utf8").replace("Passed", "Failed"));
  expect(faultsOf(told, "04").some((f) => f.startsWith("notes.md is not what its record says (notesOf): the first line that differs is "))).toBe(true);
  expect(resultOf(told, "04")).toBe("failed");

  const swapped = bundle([{ folder: "04", record: record("04", 4, FOUR) }]);
  writeFileSync(join(swapped, "04", "play-01", "world-390-vague-fact.png"), "other bytes");
  expect(faultsOf(swapped, "04")).toContain("play-01/world-390-vague-fact.png: its bytes are not the screen the run saved (their digest is not result.json's)");
  expect(resultOf(swapped, "04")).toBe("failed");
});

test("a share written on a scenario's part is refused on read-back, and a run that broke off exits non-zero on its bundle alone", async () => {
  const shared = record("04", 4, FOUR);
  (shared.parts[0] as PartRecord).wants = { hits: 1, of: 1 };
  const dir = bundle([{ folder: "04", record: shared }]);
  expect(faultsOf(dir, "04")).toContain("part vague-fact asks a share, and a scenario's rates are findings with no share (plan §17.0)");
  expect(resultOf(dir, "04")).toBe("failed");

  const broke = bundle([{ folder: "04", record: record("04", 4, FOUR) }]);
  expect(await main(["report", broke], { out: () => {} })).toBe(0);
  const file = join(broke, "run.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ended: null }));
  expect(await main(["report", broke], { out: () => {} })).toBe(1);
});
