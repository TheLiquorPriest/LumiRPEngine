// Two kinds of result, kept apart (PlanScenarios-1 item 3; plan §17.0 l.1753): a recorded live run in
// which one code part fails once and an "as shipped" part is missed 3 times in 10 plays reports exactly
// that, each miss with its own screens; a code failure is never counted into a rate and a miss never
// fails a code part; the rig reports an "as shipped" part as its code path only, never as a rate.

import { expect, test } from "bun:test";
import { describeVerdict, formResult, outcomeOf, verdictOf, type FormRecord, type Glance, type Instance, type Outcome, type PartRecord } from "../../../scripts/proof/route/results";

const play = (n: number) => `play-${String(n).padStart(2, "0")}`;

/** Both widths of one look on the Turn page, each with its screen. */
function glances(n: number, part: string, found: boolean): Glance[] {
  return [1440, 390].map((width) => ({
    page: "Turn",
    width,
    found,
    what: found ? "the list names Mirela" : "the list names nobody",
    shows: found ? ["Mirela"] : [],
    screen: `${play(n)}/turn-${width}-${part}.png`,
    shotPage: "Turn",
    shotText: found ? "Perceptions: Mirela has none" : "Perceptions:",
    unshown: null,
  }));
}

function instance(n: number, part: string, outcome: Outcome): Instance {
  const found = outcome === "shown";
  return { play: n, at: 1, outcome, why: found ? "the list names Mirela" : "not on the Turn page: the list names nobody", glances: glances(n, part, found) };
}

function part(id: string, mark: "code" | "as shipped", outcomes: Record<number, Outcome>): PartRecord {
  const instances = Array.from({ length: 10 }, (_, i) => instance(i + 1, id, outcomes[i + 1] ?? "shown"));
  return { id, words: id === "missing" ? "The Turn page shows who has no perception for that turn" : "the Author writes them before those characters act", mark, pages: ["Turn"], measured: null, wants: null, instances };
}

function record(mode: "rig" | "live", parts: PartRecord[]): FormRecord {
  return { id: "08", kind: "scenario", number: 8, waves: [3], line: 1819, mode, plays: mode === "live" ? 10 : 1, parts, stops: [] };
}

test("one code part failing and an as-shipped part missed 3 times of 10 report exactly that, each miss with its screens", () => {
  const code = part("missing", "code", { 4: "absent" });
  const shipped = part("written", "as shipped", { 2: "absent", 5: "absent", 9: "absent" });
  const run = record("live", [code, shipped]);

  const codeVerdict = verdictOf(code, "live");
  expect(codeVerdict).toMatchObject({ kind: "code", result: "failed" });
  expect(codeVerdict.kind === "code" && codeVerdict.behind.map((i) => i.play)).toEqual([4]);

  const rate = verdictOf(shipped, "live");
  expect(rate).toMatchObject({ kind: "rate", hits: 7, judged: 10, apart: [] });
  // Play 4's code failure did not touch the rate: the agent's own instance there counts as the hit it was.
  expect(rate.kind === "rate" && rate.misses.map((i) => i.play)).toEqual([2, 5, 9]);
  expect(formResult(run)).toBe("failed");

  expect(describeVerdict(code, "live")).toEqual(["Failed", "Failed in play 4: not on the Turn page: the list names nobody. Screens: play-04/turn-1440-missing.png, play-04/turn-390-missing.png"]);
  expect(describeVerdict(shipped, "live")).toEqual([
    "As shipped: 7 of 10 (3 misses)",
    "Missed in play 2: not on the Turn page: the list names nobody. Screens: play-02/turn-1440-written.png, play-02/turn-390-written.png",
    "Missed in play 5: not on the Turn page: the list names nobody. Screens: play-05/turn-1440-written.png, play-05/turn-390-written.png",
    "Missed in play 9: not on the Turn page: the list names nobody. Screens: play-09/turn-1440-written.png, play-09/turn-390-written.png",
  ]);
});

test("a code failure is never counted into a rate, and a miss of guidance never fails a code part", () => {
  const shipped = part("written", "as shipped", { 3: "absent", 6: "broken", 7: "unseen" });
  const rate = verdictOf(shipped, "live");
  expect(rate).toMatchObject({ kind: "rate", hits: 7, judged: 8 });
  expect(rate.kind === "rate" && rate.apart.map((i) => [i.play, i.outcome])).toEqual([
    [6, "broken"],
    [7, "unseen"],
  ]);
  // Kept out of the rate, the code failure in play 6 still fails the scenario; the misses alone would not.
  expect(formResult(record("live", [part("missing", "code", {}), shipped]))).toBe("failed");
  expect(formResult(record("live", [part("missing", "code", {}), part("written", "as shipped", { 3: "absent", 8: "absent" })]))).toBe("passed");
  expect(formResult(record("live", [part("missing", "code", {}), part("written", "as shipped", { 7: "unseen" })]))).toBe("not seen");

  // Seen at 1440 and not at 390: for an "as shipped" part the agent did it, and the page is at fault.
  const split = [...glances(1, "written", true).slice(0, 1), ...glances(1, "written", false).slice(1)];
  expect(outcomeOf(split, "as shipped", "live").outcome).toBe("broken");
  expect(outcomeOf(split, "code", "live")).toEqual({ outcome: "absent", why: "seen on the Turn page at 1440, not on the Turn page at 390" });
});

test("a gate's share is met or not only once as many were judged as the plan counts", () => {
  const shipped = { ...part("written", "as shipped", { 1: "absent" }), wants: { hits: 9, of: 10 } };
  expect(verdictOf(shipped, "live")).toMatchObject({ kind: "rate", hits: 9, judged: 10, meets: true });
  const short = { ...part("written", "as shipped", { 1: "absent", 2: "broken" }), wants: { hits: 9, of: 10 } };
  expect(verdictOf(short, "live")).toMatchObject({ kind: "rate", hits: 8, judged: 9, meets: null });
  const below = { ...part("written", "as shipped", { 1: "absent", 2: "absent" }), wants: { hits: 9, of: 10 } };
  expect(verdictOf(below, "live")).toMatchObject({ meets: false });
});

test("the rig reports an as-shipped part as its code path only, never as a rate", () => {
  const shipped: PartRecord = { ...part("written", "as shipped", {}), instances: [instance(1, "written", "absent")] };
  const verdict = verdictOf(shipped, "rig");
  expect(verdict).toMatchObject({ kind: "code", result: "failed" });
  expect(describeVerdict(shipped, "rig")[0]).toBe("The code path only (the rig plays the agent as its file asks): failed");
  expect(formResult(record("rig", [shipped]))).toBe("failed");
  // Played live, the same part with no code part beside it is a rate alone.
  expect(formResult(record("live", [part("written", "as shipped", { 1: "absent" })]))).toBe("rates only");
});
