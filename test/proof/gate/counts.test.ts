// The counts a wave is met on (PlanScenarios-5 item 10): the runner's exit is 0 for a run that measured a rate as for one that passed, by its documented rule, so the checkpoint reads the
// counts of each kind of result from the bundle's results and meets a wave only on them. A run whose exit is 0 but whose results hold a code part not passed (a rate that missed the plan's
// share, a part not seen, a part not played) is not recorded as met.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countsOf } from "../../../scripts/proof/checkpoint/counts";
import { Bundle, readBundle } from "../../../scripts/proof/route/evidence";
import { exitCode } from "../../../scripts/proof/route/report";
import type { FormRecord, Glance, Instance, PartRecord } from "../../../scripts/proof/route/results";
import { sha256 } from "../../../scripts/proof/lib/record";
import { fakePlays, fakeRun } from "../route/fake";

let out = "";
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-counts-"));
});
afterAll(() => {
  if (out !== "") rmSync(out, { recursive: true, force: true });
});

const glance = (part: string, width: number): Glance => ({ page: "World", width, found: true, what: "the four values as before", shows: ["Coin: 40 silver"], screen: `play-01/world-${width}-${part}.png`, sha256: sha256("png"), shotPage: "World", shotText: "Time: dusk. Coin: 40 silver.", unshown: null });

const seen = (id: string, outcome: Instance["outcome"]): PartRecord => ({ id, words: `what ${id} shows`, mark: "code", pages: ["World"], measured: null, wants: null, instances: [{ play: 1, at: 1, outcome, why: "as it was", page: null, glances: outcome === "shown" ? [glance(id, 1440), glance(id, 390)] : [] }] });

/** A rate over `hits` and `misses` plays: "as shipped", with the plan's share of 9 in 10. */
const rate = (hits: number, misses: number): PartRecord => ({
  id: "calls",
  words: "Model calls on the reply's path: exactly 1 in at least 9 of 10",
  mark: "as shipped",
  pages: [],
  measured: "calls on the path",
  wants: { hits: 9, of: 10 },
  instances: [...Array.from({ length: hits }, (_, i): Instance => ({ play: 1, at: i + 1, outcome: "met", why: "one call", page: null, glances: [] })), ...Array.from({ length: misses }, (_, i): Instance => ({ play: 1, at: hits + i + 1, outcome: "unmet", why: "three calls", page: null, glances: [] }))],
});

/** A bundle of one gate whose parts are `parts`, played `plays` times, written as the runner writes one and read back. */
function made(name: string, mode: "rig" | "live", parts: PartRecord[], unsaved: readonly string[] = []) {
  const plays = 1;
  const bundle = Bundle.open(join(out, name), mode, new Date("2026-11-15T04:00:00.000Z"));
  bundle.formDir("floor");
  const record: FormRecord = { run: bundle.run, nonce: bundle.nonce, id: "floor", kind: "gate", number: null, waves: [1], line: null, mode, plays, stops: [], standings: Array.from({ length: plays }, (_, i) => ({ play: i + 1, is: "verdict" as const, why: [] })), parts };
  for (const part of parts.filter((p) => !unsaved.includes(p.id))) for (const g of part.instances.flatMap((i) => i.glances)) bundle.saveScreen("floor", 1, "World", part.id, { image: new TextEncoder().encode("png"), format: "png", page: "World", width: g.width ?? 0, text: g.shotText ?? "" });
  bundle.writeResult(record);
  bundle.writeNotes(record);
  bundle.writeRun(fakeRun({ run: bundle.run, nonce: bundle.nonce, mode, by: "a test", started: "2026-11-15T04:00:00.000Z", ended: "2026-11-15T04:01:00.000Z", asked: ["floor"], unplayed: [], known: { scenarios: [], gates: ["floor"] }, repeats: 1 }, fakePlays("floor", plays)));
  return readBundle(bundle.dir);
}

test("a clean rig bundle is met on its counts: the form passed, no part short of passed, no trial", () => {
  const read = made("clean", "rig", [seen("replies-shown", "shown")]);
  const counted = countsOf(read);
  expect(counted.counts).toMatchObject({ asked: 1, played: 1, notPlayed: 0, passed: 1, failed: 0, measured: 0, notSeen: 0, trial: 0, notJudged: 0, faulty: 0 });
  expect(counted.problems).toEqual([]);
});

test("a live run that measured a rate below the plan's share is not met: the counts name the miss", () => {
  const read = made("missed", "live", [seen("replies-shown", "shown"), rate(7, 3)]);
  const counted = countsOf(read);
  expect(counted.counts.failed + counted.counts.measured).toBe(1);
  expect(counted.rates).toEqual([{ form: "floor", part: "calls", hits: 7, judged: 10, wants: { hits: 9, of: 10 }, meets: false, misses: 3 }]);
  expect(counted.problems.join(" ")).toContain('the "as shipped" part "calls" missed the plan\'s share (7 of 10)');
});

test("a rate that met the share is met, and a rate too few plays were judged to decide is not", () => {
  const met = countsOf(made("met", "live", [seen("replies-shown", "shown"), rate(9, 1)]));
  expect(met.rates[0]).toMatchObject({ hits: 9, judged: 10, meets: true });
  expect(met.problems).toEqual([]);
  const few = countsOf(made("few", "live", [seen("replies-shown", "shown"), rate(4, 0)]));
  expect(few.problems.join(" ")).toContain('too few plays of "calls" were judged to decide the plan\'s share');
});

test("a code part not seen, or not played, is not recorded as met, whatever the form says of itself", () => {
  // The record calls the part seen and its screens are not in the folder: read back, it is not seen.
  const unseen = countsOf(made("unseen", "rig", [seen("replies-shown", "shown")], ["replies-shown"]));
  expect(unseen.problems.join(" ")).toContain('the code part "replies-shown" is not seen');
  expect(unseen.counts.notSeen + unseen.counts.failed).toBeGreaterThan(0);
  const none: PartRecord = { ...seen("stack-shown", "shown"), instances: [] };
  const unplayed = countsOf(made("unplayed", "rig", [seen("replies-shown", "shown"), none]));
  expect(unplayed.problems.join(" ")).toContain('the code part "stack-shown" is not played');
});

test("a form that calls itself measured as a rate, and so exits 0, is not met when a code part of it was not played or not passed", () => {
  const read = made("calls-itself-measured", "rig", [seen("replies-shown", "shown")]);
  const form = read.forms[0];
  const record = form?.record;
  if (form === undefined || record === undefined || record === null) throw new Error("the made bundle holds no form record");
  // The form's own word is "measured as a rate" (exit 0 by the runner's rule); its one code part has not one instance.
  const claimed = { ...read, forms: [{ ...form, result: "measured" as const, record: { ...record, parts: record.parts.map((p) => ({ ...p, instances: [] })) } }] };
  expect(exitCode(claimed)).toBe(0);
  const counted = countsOf(claimed);
  expect(counted.counts.measured).toBe(1);
  expect(counted.problems.join(" ")).toContain('the code part "replies-shown" is not played');
});

test("a folder that is no bundle is a problem of its own, not a throw, and a run that broke off is not met", () => {
  const read = made("broke", "rig", [seen("replies-shown", "shown")]);
  expect(countsOf({ ...read, run: { ...read.run, ended: null } }).problems).toContain("the run did not end: it broke off");
  expect(countsOf({ ...read, run: { ...read.run, asked: [] } }).problems).toContain("the run was asked nothing");
});
