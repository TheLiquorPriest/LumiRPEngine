// The counts a wave is met on (PlanScenarios-5 item 10): never the exit code alone. The runner's exit is 0 for a run that
// measured a rate as for one that passed, by its documented rule (`route/report.ts`, `exitCode`), so a wave's checkpoint reads
// what each form and each part came to from the bundle's results files, counted by kind (passed, failed, measured as a rate with
// its misses, not seen, not played, trial, not judged), and is met only on them: every form asked was played; none failed, went
// unseen, was left not played whole, was not judged or was a trial; every code part passed, whatever the form's own word; every
// rate was decided on the plan's share where it has one; and the run itself is a verdict with no fault of its evidence.

import { readBundle, type ReadBundle } from "../route/evidence";
import { partTrial, verdictOf, type FormRecord } from "../route/results";

/** How many of the forms asked came to each kind of result. */
export interface Counts {
  asked: number;
  played: number;
  notPlayed: number;
  passed: number;
  failed: number;
  /** Forms that measured an "as shipped" part as a rate: each is given with its misses in `rates`. */
  measured: number;
  notSeen: number;
  notPlayedWhole: number;
  trial: number;
  notJudged: number;
  /** Forms with a fault of their evidence, which are counted failed as well. */
  faulty: number;
}

/** An "as shipped" part played live: what it came to, with every miss. */
export interface RateRead {
  form: string;
  part: string;
  hits: number;
  judged: number;
  /** The share the plan asks of it, and whether it was met (null: none asked, or too few judged to say). */
  wants: { hits: number; of: number } | null;
  meets: boolean | null;
  misses: number;
}

export interface CountsRead {
  counts: Counts;
  rates: RateRead[];
  /** Why the bundle does not give a met wave, in plain words; empty when it does. */
  problems: string[];
}

/** The records a form holds: one for a form played whole, one for each stage played of a form played in stages. */
function recordsOf(form: ReadBundle["forms"][number]): FormRecord[] {
  if (form.record !== null) return [form.record];
  return (form.stages ?? []).flatMap((stage) => (stage.record === null ? [] : [stage.record]));
}

/** What a bundle's results hold, counted, and what keeps it from meeting a wave. */
export function countsOf(read: ReadBundle): CountsRead {
  const counts: Counts = { asked: read.run.asked.length, played: read.forms.length, notPlayed: read.run.unplayed.length, passed: 0, failed: 0, measured: 0, notSeen: 0, notPlayedWhole: 0, trial: 0, notJudged: 0, faulty: 0 };
  const rates: RateRead[] = [];
  const problems: string[] = [...read.faults];
  if (read.run.ended === null) problems.push("the run did not end: it broke off");
  if (read.run.asked.length === 0) problems.push("the run was asked nothing");
  for (const u of read.run.unplayed) problems.push(`${u.id} was not played: ${u.why}`);
  if (read.standing.is === "trial") problems.push(`the run is a trial, and gives no verdict: ${read.standing.why.join("; ")}`);
  for (const form of read.forms) {
    if (form.faults.length > 0 || (form.record === null && form.stages === null)) {
      counts.faulty++;
      problems.push(`${form.id}: a fault of its evidence: ${form.faults.length > 0 ? form.faults.join("; ") : "it has no record"}`);
    }
    switch (form.result) {
      case "passed":
        counts.passed++;
        break;
      case "failed":
        counts.failed++;
        break;
      case "measured":
        counts.measured++;
        break;
      case "not seen":
        counts.notSeen++;
        break;
      case "not played whole":
        counts.notPlayedWhole++;
        break;
      case "trial":
        counts.trial++;
        break;
      case "not judged":
        counts.notJudged++;
        break;
    }
    // Whatever the form's own word, each part is looked at: a code part that is not passed, a rate whose share was not met, a play that was a trial.
    for (const record of recordsOf(form)) {
      const label = record.stage === undefined ? record.id : `${record.id}:${record.stage.name}`;
      for (const part of record.parts) {
        const verdict = verdictOf(part, record.mode, partTrial(record, part));
        if (verdict.kind === "code" && verdict.result !== "passed") problems.push(`${label}: the code part "${part.id}" is ${verdict.result}`);
        else if (verdict.kind === "trial") problems.push(`${label}: the part "${part.id}" was played as a trial and gives figures only, no verdict`);
        else if (verdict.kind === "rate") {
          rates.push({ form: label, part: part.id, hits: verdict.hits, judged: verdict.judged, wants: verdict.wants, meets: verdict.meets, misses: verdict.misses.length });
          if (verdict.meets === false) problems.push(`${label}: the "as shipped" part "${part.id}" missed the plan's share (${verdict.hits} of ${verdict.judged})`);
          else if (verdict.wants !== null && verdict.meets === null) problems.push(`${label}: too few plays of "${part.id}" were judged to decide the plan's share`);
          if (verdict.apart.length > 0) problems.push(`${label}: ${verdict.apart.length} play(s) of "${part.id}" were broken by the code or never seen on screen, and are kept out of its rate`);
        }
      }
    }
    if (form.result === "failed" || form.result === "not seen" || form.result === "not played whole" || form.result === "not judged" || form.result === "trial") problems.push(`${form.id} came to "${form.result}"`);
  }
  return { counts, rates, problems: [...new Set(problems)] };
}

/** The same, from a bundle's folder; a folder that is no bundle is a problem of its own, not a throw. */
export function countsOfFolder(dir: string): CountsRead & { read: ReadBundle | null } {
  try {
    const read = readBundle(dir);
    return { ...countsOf(read), read };
  } catch (error) {
    const empty: Counts = { asked: 0, played: 0, notPlayed: 0, passed: 0, failed: 0, measured: 0, notSeen: 0, notPlayedWhole: 0, trial: 0, notJudged: 0, faulty: 0 };
    return { counts: empty, rates: [], problems: [`${dir} cannot be read as a bundle: ${error instanceof Error ? error.message : String(error)}`], read: null };
  }
}
