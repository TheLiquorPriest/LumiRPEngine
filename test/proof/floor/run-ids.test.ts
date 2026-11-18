// A run's id is not its turn's (RPH `ff1c9839`; U03b item 5): a turn's first run, a continue and a
// "Settle now" each have an id of their own, and the turn is in each record's scope. The floor's
// measures find a turn's pieces by the turn in the records' scope, across its runs, and hold a call, a
// release or an intent to its own run: never by the turn's id taken for a run's.

import { describe, expect, test } from "bun:test";
import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import { callsOf, deltasOfTurn, intentOf, releaseOf, replyCall, traceIntentMs } from "../../../scripts/proof/lib/turn";
import { intentCrossCheck, measuredRows, replyCallPerToken, type FloorRun, type FloorTurn } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

const rpeOf = (run: FloorRun, pair: number): FloorTurn => {
  const turn = run.turns.find((t) => t.arm === "rpe" && t.pair === pair);
  if (turn === undefined || turn.rpe === null) throw new Error(`no RPE turn ${pair}`);
  return turn;
};

/** The turn's trace with a second run of it, a continue, as RPH records one: its own run id, the same turn in its scope, the same agent and call numbers again, its pieces streamed long after. */
function continued(turn: FloorTurn): { runs: string[] } {
  const rpe = turn.rpe;
  if (rpe === null) throw new Error("no RPE side");
  // The first record of an agent's run: a record of the host's own word (a session opened) names no agent.
  const first = rpe.trace.find((r) => r.agent !== undefined);
  const agent = first?.agent;
  if (first === undefined || agent === undefined) throw new Error("no trace");
  const run = `${first.run}-continue`;
  const base = (rpe.trace.at(-1)?.at ?? 0) + 60_000;
  const record = (seq: number, at: number, event: TraceRecord["event"]): TraceRecord => ({ seq, run, scope: first.scope, at, agent, event });
  rpe.trace = [
    ...rpe.trace,
    record(1, base, { kind: "run_started", run: "turn", turn: "continue", lead: "author" }),
    record(2, base + 5, { kind: "agent_started", definition: "author", connection: "rpe-floor", model: "deepseek-v4-flash", effort: "low", session: "s-floor", given: [] }),
    record(3, base + 10, { kind: "call_started", call: 1, connection: "rpe-floor", model: "deepseek-v4-flash", messages: 14, tools: 30 }),
    record(4, base + 3000, { kind: "released", release: { by: agent, form: "tags", length: 90 } }),
  ];
  const pieces: TraceDelta[] = [0, 500, 1000, 1500].map((offset) => ({ run, agent: agent.id, call: 1, text: " later", at: base + 100 + offset }));
  rpe.deltas = [...rpe.deltas, ...pieces];
  return { runs: [first.run, run] };
}

describe("a turn's pieces are those of its runs", () => {
  test("by the turn in the records' scope, across the turn's runs, and not another turn's", () => {
    const run = recordedRun({ form: "tag" });
    const turn = rpeOf(run, 1);
    const { runs } = continued(turn);
    const rpe = turn.rpe;
    if (rpe === null) throw new Error("no RPE side");
    const other: TraceDelta = { run: "run-2-1", agent: "lead", call: 1, text: "another turn's", at: 1 };
    const got = deltasOfTurn(rpe.trace, [...rpe.deltas, other], rpe.turn);
    expect(new Set(got.map((d) => d.run))).toEqual(new Set(runs));
    expect(got).not.toContain(other);
    // The turn's own id names no run: taken for one, nothing is found.
    expect(rpe.turn).not.toBe(runs[0]);
    expect(rpe.deltas.filter((d) => d.run === rpe.turn)).toEqual([]);
    expect(deltasOfTurn(rpe.trace, rpe.deltas, "t-99")).toEqual([]);
  });

  test("a recorded turn whose run id differs from its turn id is measured as before: the reply call's time per token, the intent's own time, the rows", () => {
    const tag = recordedRun({ form: "tag" });
    const two = recordedRun({ form: "two-step" });
    for (const run of [tag, two]) {
      const rpe = rpeOf(run, 1).rpe;
      expect(rpe?.trace.every((r) => r.run !== rpe.turn && r.scope.turn === rpe.turn)).toBe(true);
      expect(intentCrossCheck(run)).toEqual([]);
    }
    expect(replyCallPerToken(rpeOf(two, 1))).toBeCloseTo(8.05, 1);
    expect(measuredRows(two)["per-token"].measured).toContain("RPE's reply call 8.1 ms per token");
    expect(measuredRows(tag)["per-token"].verdict).toBe("pass");
    expect(measuredRows(tag)["first-words"].verdict).toBe("pass");
  });
});

describe("a call, a release and an intent are held to their own run", () => {
  test("with a continue after the first run, the reply call and the intent's time are the first run's, not the later run's pieces on the same agent and call number", () => {
    for (const form of ["tag", "two-step"] as const) {
      const run = recordedRun({ form });
      const before = { perToken: replyCallPerToken(rpeOf(run, 1)), intent: traceIntentMs(form, rpeOf(run, 1).rpe?.trace ?? [], rpeOf(run, 1).rpe?.deltas ?? []) };
      continued(rpeOf(run, 1));
      const turn = rpeOf(run, 1);
      const rpe = turn.rpe;
      if (rpe === null) throw new Error("no RPE side");
      // The release is the first run's, and its reply call that run's last call before it.
      const release = releaseOf(rpe.trace);
      expect(release?.run).toBe(rpe.trace[0]?.run);
      expect(replyCall(callsOf(rpe.trace), release)?.run).toBe(release?.run);
      expect(intentOf(rpe.trace)?.run).toBe(release?.run);
      expect(replyCallPerToken(turn)).toBe(before.perToken);
      expect(traceIntentMs(form, rpe.trace, rpe.deltas)).toBe(before.intent);
      expect(intentCrossCheck(run)).toEqual([]);
    }
  });

  test("a call ended in one run is not the end of another run's call of the same number", () => {
    const run = recordedRun({ form: "tag" });
    const turn = rpeOf(run, 1);
    continued(turn);
    const calls = callsOf(turn.rpe?.trace ?? []);
    const firsts = calls.filter((c) => c.call === 1);
    const first = turn.rpe?.trace[0]?.run ?? "";
    expect(firsts.map((c) => c.run)).toEqual([first, `${first}-continue`]);
    // The first run's call 1 ended; the continue's did not, and takes no end from the first.
    expect(firsts[0]?.endedAt).not.toBeNull();
    expect(firsts[1]?.endedAt).toBeNull();
  });
});
