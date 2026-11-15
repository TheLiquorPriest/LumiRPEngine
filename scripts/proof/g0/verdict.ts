// G0's verdict, as the plan gives it and no other way (STANDALONE-PLAN §18.1 G0: "the floor test in
// miniature", pass "§17.1's first four rows"; PlanGates-17 item 1). Pure: a recorded run gives the same
// verdict again. The four rows are the floor's own, measured by the floor's own table
// (`scripts/testbed/floor-measure.ts`), over the same ten pairs.
//
// A pass is given only when every one of the four rows was judged and passed (a reported row, the
// two-step form's time per token, counts as met with its figure), on a run with no trial and no stop, whose
// conditions of the whole test held (`floorConditions`), and whose Author ran in the form the floor model
// needs: with the tag count read, below the plan's 28 of 30, the connection works the two-step way and
// G0 is played in that form, so a tag-form run on it gives no verdict. "What the model was sent" not
// measured leaves the verdict none, whatever the other three say. A row that fails on a run that stood on
// its conditions is a fail whatever else was not measured: a miss is a miss, and the owner is told of it at
// once. Where the plan gives no verdict, none is given, with every reason.

import type { FloorRun, FloorTurn, Row, Verdict } from "../../testbed/floor-measure";
import { effortRefusal, floorConditions, floorTable, noVerdict } from "../../testbed/floor-measure";
import { leadStart } from "../lib/turn";
import { type FormsReading, needsTwoStep, usable } from "./forms";

/** §17.1's first four rows, the ones G0 judges, by the id the floor's table gives each. */
export const G0_ROWS = ["first-words", "per-token", "calls", "sent"] as const;

/** The four rows of a run, in the plan's order. */
export function g0Rows(run: FloorRun): Row[] {
  const table = floorTable(run);
  return G0_ROWS.flatMap((id) => table.filter((r) => r.id === id));
}

/** G0's verdict: a pass, a fail, or none (with what kind of none, and every reason). */
export interface G0Verdict {
  verdict: "pass" | "fail" | "none";
  /** "passed" and "failed", or what leaves the plan giving none: a trial, a stop, conditions of the whole test not held, the reply form, a row not judged. */
  kind: "passed" | "failed" | "trial" | "stopped" | "conditions" | "form" | "not judged";
  why: string[];
  /** The four rows' verdicts, in the plan's order. */
  rows: { id: string; measure: string; verdict: Verdict }[];
}

/** The tag count says the floor model works the two-step way, and the run's Author ran in the tag form: the form the rows are read in is not the connection's. */
function formMismatch(run: FloorRun, forms: FormsReading): string | null {
  if (run.form !== "tag" || !needsTwoStep(forms.tags) || !usable(forms.tags)) return null;
  const { count } = forms.tags.kept;
  return `the tags run counted ${count.kept} of ${count.played} turns kept, below the plan's 28 of 30, so the floor model works the two-step way (§10.7, row 0.2's fail column) and G0 is played in that form: this run's Author ran in the tag form`;
}

/** What the plan gives of G0 for a run, from its four rows. `standing` is the runner's own for the play. */
export function g0Verdict(run: FloorRun, rows: readonly Row[], standing: { is: "verdict" | "trial"; why: readonly string[] }, forms: FormsReading): G0Verdict {
  const tally = rows.map((r) => ({ id: r.id, measure: r.measure, verdict: r.verdict }));
  const missing = G0_ROWS.filter((id) => !rows.some((r) => r.id === id));
  if (standing.is === "trial") return { verdict: "none", kind: "trial", why: [...standing.why, ...run.trials], rows: tally };
  const none = noVerdict(run);
  if (none !== null) return { verdict: "none", kind: none.kind, why: [none.why], rows: tally };
  const unmet = floorConditions(run);
  if (unmet.length > 0) return { verdict: "none", kind: "conditions", why: unmet, rows: tally };
  if (missing.length > 0) return { verdict: "none", kind: "not judged", why: missing.map((id) => `the row ${id} is not among the rows judged`), rows: tally };
  const mismatch = formMismatch(run, forms);
  if (mismatch !== null) return { verdict: "none", kind: "form", why: [mismatch], rows: tally };
  const failed = rows.filter((r) => r.verdict === "fail");
  const unjudged = rows.filter((r) => r.verdict === "not judged");
  if (failed.length > 0) return { verdict: "fail", kind: "failed", why: [...failed.map((r) => `${r.measure}: ${r.measured}`), ...unjudged.map((r) => `${r.measure} was not judged: ${r.why.join("; ")}`)], rows: tally };
  if (unjudged.length > 0) return { verdict: "none", kind: "not judged", why: unjudged.map((r) => `${r.measure}: ${r.why.join("; ")}`), rows: tally };
  return { verdict: "pass", kind: "passed", why: [], rows: tally };
}

/** The thinking effort both arms ran at, and the shipped definition's. */
export interface EffortFacts {
  /** The Author's, from its `agent_started` in the turns' traces; several are joined; null where no trace names one. */
  author: string | null;
  /** Plain generation's, as Lumiverse holds it for the connection: its effort, "auto", "off", or "not set" where Lumiverse sets none; null where it was not read. */
  plain: string | null;
  /** The effort the shipped Author definition names (`effort:` in its header); null where it was not read. */
  shipped: string | null;
  /** Why the two arms' effort is not judged the same (R-92); null where it is. */
  refusal: string | null;
}

/** Both arms' effort from the run, and the shipped definition's (the caller reads it from the shipped file). */
export function effortOf(run: FloorRun, shipped: string | null): EffortFacts {
  const named = [...new Set(run.turns.flatMap((t) => (t.rpe === null ? [] : [leadStart(t.rpe.trace)])).flatMap((s) => (s === null ? [] : [s.effort ?? "not said"])))];
  const plain = run.plain === null ? null : run.plain.apiReasoning === null ? "not set" : run.plain.apiReasoning ? (run.plain.effort ?? "auto") : "off";
  return { author: named.length === 0 ? null : named.join(" and "), plain, shipped, refusal: effortRefusal(run) };
}

/** One arm's turn of a pair as the chat holds it: the line it was sent and the reply saved for it, or why there is none. */
export interface ArmReply {
  line: string | null;
  reply: string | null;
  why: string | null;
}

/** One pair's two turns: plain generation's and RPE's. The two arms are sent different lines (one chat takes each line once), so each is shown with its own. */
export interface PairReply {
  pair: number;
  plain: ArmReply;
  rpe: ArmReply;
}

/** Each pair's two turns, from the saved messages the turns name. */
export function repliesOf(turns: readonly FloorTurn[], messages: readonly { id: string; content: string }[]): PairReply[] {
  const pairs = [...new Set(turns.map((t) => t.pair))].sort((a, b) => a - b);
  const read = (pair: number, arm: "plain" | "rpe"): ArmReply => {
    const t = turns.find((x) => x.pair === pair && x.arm === arm);
    const name = arm === "plain" ? "plain generation" : "RPE";
    if (t === undefined) return { line: null, reply: null, why: `${name}'s turn was not played` };
    const id = t.socket.messageId;
    if (id === null) return { line: t.line, reply: null, why: `${name}'s turn gave no saved reply${t.error === null ? "" : ` (${t.error})`}` };
    const found = messages.find((m) => m.id === id);
    return { line: t.line, reply: found?.content ?? null, why: found === undefined ? `${name}'s saved reply was not found in the chat` : null };
  };
  return pairs.map((pair) => ({ pair, plain: read(pair, "plain"), rpe: read(pair, "rpe") }));
}

/** What G0's play keeps of itself (`g0.json`, in the gate's folder of the bundle), so the report can be written again from the bundle alone. */
export interface G0Kept {
  kind: "g0";
  /** The run's name, as `run.json` gives it. */
  run: string;
  /** What this run changed against the first G0 run (`G0_VARIANT`): free words naming the reply form, the shipped wording or the Author's effort tried; null for the first run. */
  variant: string | null;
  verdict: G0Verdict;
  forms: FormsReading;
  effort: EffortFacts;
  replies: PairReply[];
}
