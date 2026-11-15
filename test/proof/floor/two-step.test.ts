// The two-step form timed as §17.1 l.1773 says (PlanGates-4 item 2), and streaming read from what RPE
// did (PlanGates-4-fix1 item 5): the reply is shown when its message ends, so RPE's time is taken to that
// moment and compared with plain's time to its last word; whether RPE's connection streams is run.json's
// (`agents[].streams`), and a two-step turn whose first word left RPE before its release streamed. A
// streamed two-step run leaves first words not judged, "streamed".

import { describe, expect, test } from "bun:test";
import { authorOf } from "../../../scripts/proof/floor/play";
import { runRecord } from "../../../scripts/proof/route/evidence";
import { measuredRows, streamedTurn } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { factsOf } from "./replay";

describe("first words on a two-step connection", () => {
  test("an unstreamed run is judged to the moment the message ended and was shown whole, against plain's last word", () => {
    const row = measuredRows(recordedRun({ form: "two-step" }))["first-words"];
    // Ended on the page at 3.60 s, less the record's 0.60 s; plain's last word at 2.80 s.
    expect(row.measured).toContain("RPE 3.00 s");
    expect(row.measured).toContain("plain 2.80 s");
    expect(row.verdict).toBe("pass");
  });

  test("the comparison is with plain's last word, not its first: 1.70 s over the last passes where 3.40 s over the first would fail", () => {
    const row = measuredRows(recordedRun({ form: "two-step", slower: () => 1500 }))["first-words"];
    expect(row.measured).toContain("RPE less plain 1.70 s");
    expect(row.verdict).toBe("pass");
    expect(measuredRows(recordedRun({ form: "two-step", slower: () => 3000 }))["first-words"].verdict).toBe("fail");
  });

  test("a run whose setting names RPE's connection by its id, so that run.json says it streams, is not judged: streamed", () => {
    const facts = factsOf(recordedRun({ form: "two-step" }), (f) => {
      f.settings.settings.push({ key: "reply.streamAnyway", name: "reply.streamAnyway", about: "Two-step connections that stream.", effect: "turn", effectWords: "from the next turn", row: null, set: [], joined: false, value: ["c0nn-rpe-floor-id"], default: [], from: "global", file: "RPE-global.yml", takes: { type: "texts" }, takesWords: "a list of texts", none: null, orNone: false, levels: [], passed: null });
      // RPH streams a connection named by its id as by its name; the runner's host reads that RPE streams it.
      f.agents = f.agents.map((a) => ({ ...a, streams: true }));
    });
    const run = runRecord(facts, { run: "rig-invented", mode: "rig", by: "a test", started: "2026-11-20T10:15:00.000Z", ended: null, asked: ["floor"], unplayed: [], known: { scenarios: [], gates: ["floor"] }, repeats: 10 });
    const author = authorOf(run);
    expect(author).toEqual({ form: "two-step", formWhy: null, streams: true });
    // No turn of the run streamed on the page: run.json's word alone leaves the row not judged.
    const row = measuredRows({ ...recordedRun({ form: "two-step" }), ...author })["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain("streamed: run.json says the Author's connection streams (agents[].streams)");
  });

  test("a turn whose first word came before its release is named streamed, though run.json says the connection does not stream", () => {
    const run = recordedRun({ form: "two-step", streams: false, streamedPairs: (pair) => pair === 4 });
    expect(run.turns.filter(streamedTurn).map((t) => t.pair)).toEqual([4]);
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain("streamed: the first word left RPE before the release on pair 4");
    // Its first streamed word, 2.37 s on the page less the record's 0.60 s, is shown and judges nothing.
    expect(row.measured).toContain("RPE's first streamed word less the record: 1.77 s, reported, not judged");
  });

  test("a turn released in the tag form on a two-step run leaves the row not judged, naming it", () => {
    const run = recordedRun({ form: "two-step" });
    const turn = run.turns.find((t) => t.arm === "rpe" && t.pair === 7);
    const released = turn?.rpe?.trace.find((r) => r.event.kind === "released");
    if (released?.event.kind !== "released") throw new Error("the recorded turn has no release");
    released.event.release.form = "tags";
    const row = measuredRows(run)["first-words"];
    expect(row.verdict).toBe("not judged");
    expect(row.why).toContain('pair 7 RPE (turn t-7) was released as "tags", while run.json gives the Author\'s form as two-step');
  });
});
