// The floor model's reply form as G0 reads it (PlanGates-17 items 1 and 2; plan §18.1 row 0.2 and G0,
// §17.1 l.1773): what the tags gate and the two-step gate of row 0.2 (`scripts/proof/phase0-0.2-tags`,
// `phase0-0.2-two-step`, PlanGates-24) keep of their thirty turns, and how G0 reads it back from the run
// folder that played them. The two gates are played in runs of their own, before G0's (each id once in a
// run), so G0 never counts a turn itself: it reads a count, and trusts it only as far as the folder shows.
//
// A count is one G0 may stand on when: the folder reads back as a whole bundle (`readBundle`), the gate's
// own record in it is the folder's and carries no fault, the count file names the run and nonce of the
// run.json beside it, the run was played in the same mode (a rig count says nothing of the floor model),
// the play was a verdict and not a trial, and it stood on the same shipped files and the same model as
// this run. A count that fails any of these is still printed with its figures, and says why G0 does not
// stand on it: a wrong "the floor model keeps its tags" is worse than a count not read.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { BundleRefused, readBundle, standingOfRunPlay, type ReadBundle } from "../route/evidence";
import type { Mode } from "../route/host";
import { type FormCount, TAGS_PASS } from "../lib/phase0";

/** The ids of the two gates of row 0.2 that count a reply form, and the file each keeps its count in (`play.keep("count", …)` makes `count.json`). */
export const TAGS_GATE = "phase0-0.2-tags";
export const TWO_STEP_GATE = "phase0-0.2-two-step";
export const COUNT_FILE = "count.json";

/** The two reply forms the row counts. */
export type CountedForm = "tags" | "two-step";

/** What one of the two gates keeps of its play, and G0 reads back. */
export interface FormKept {
  kind: "form-count";
  form: CountedForm;
  /** The run that made it, and its nonce: `run.json`'s own. */
  run: string;
  nonce: string | null;
  /** The Author's connection and model, as its trace names them (null: no turn named them). */
  connection: string | null;
  model: string | null;
  /** The thirty turns counted by the plan's pass: kept against 28 of 30. */
  count: FormCount;
  /** The two-step form only: calls on the reply's path per turn against exactly 2 (null in the tag form). */
  calls: { exact: number; of: number; each: string } | null;
  /** Each turn's line and what came of it, in order. */
  turns: { line: string; outcome: string; calls: number | null }[];
}

/** Why a value is not what a count gate keeps; null when it is. */
export function keptFault(value: unknown, form: CountedForm): string | null {
  if (!isRecord(value) || value.kind !== "form-count") return "it is not a count of a reply form";
  if (value.form !== form) return `it counts the ${String(value.form)} form, not the ${form} form`;
  if (typeof value.run !== "string" || value.run === "") return "it names no run";
  const count = value.count;
  if (!isRecord(count) || typeof count.played !== "number" || typeof count.kept !== "number" || typeof count.unread !== "number" || !isRecord(count.by) || !Array.isArray(count.why)) return "its count is not the turns kept, missed and unread";
  if (count.verdict !== "pass" && count.verdict !== "fail" && count.verdict !== "not judged") return "its count gives no verdict";
  if (!Array.isArray(value.turns)) return "it lists no turns";
  if (form === "two-step" && value.calls !== null && !isRecord(value.calls)) return "its calls are not counted";
  return null;
}

/** What G0 read of one form's count. */
export interface FormReading {
  /** The count the gate kept; null where none could be read, with why in `not`. */
  kept: FormKept | null;
  /** The run folder's name it was read from; null where no folder was found. */
  run: string | null;
  /** Why G0 does not stand on this count; empty where it may. A count with reasons is still reported with its figures. */
  not: string[];
}

/** Both forms' counts. */
export interface FormsReading {
  tags: FormReading;
  twoStep: FormReading;
}

/** What G0's own run stood on, to hold a count to: the mode, the shipped tree the server ran (by hash) and the Author's model. */
export interface Stands {
  mode: Mode;
  served: string | null;
  model: string | null;
}

/** The run folders under `out` that hold a count of this gate, newest first by the time each says it started. */
export function foldersWithCount(out: string, gate: string): string[] {
  if (!existsSync(out)) return [];
  const found = readdirSync(out, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(out, e.name, "run.json")) && existsSync(join(out, e.name, gate, "internal", "play-01", COUNT_FILE)))
    .map((e) => {
      let started = "";
      try {
        const raw: unknown = JSON.parse(readFileSync(join(out, e.name, "run.json"), "utf8"));
        started = isRecord(raw) && typeof raw.started === "string" ? raw.started : "";
      } catch {
        started = "";
      }
      return { dir: join(out, e.name), started };
    });
  return found.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0)).map((f) => f.dir);
}

/** Reads one gate's count out of one run folder, and says why G0 may not stand on it where it may not. */
export function readCount(dir: string, form: CountedForm, mine: Stands): FormReading {
  const gate = form === "tags" ? TAGS_GATE : TWO_STEP_GATE;
  let bundle: ReadBundle;
  try {
    bundle = readBundle(dir);
  } catch (error) {
    return { kept: null, run: null, not: [`${dir} could not be read back as a bundle: ${error instanceof BundleRefused || error instanceof Error ? error.message : String(error)}`] };
  }
  const run = bundle.run;
  const file = join(dir, gate, "internal", "play-01", COUNT_FILE);
  if (!existsSync(file)) return { kept: null, run: run.run, not: [`run ${run.run} holds no count of the ${form} form (${gate}/internal/play-01/${COUNT_FILE})`] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { kept: null, run: run.run, not: [`the count in run ${run.run} cannot be read: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const fault = keptFault(raw, form);
  if (fault !== null) return { kept: null, run: run.run, not: [`the count in run ${run.run} is not a count G0 can read: ${fault}`] };
  const kept = raw as FormKept;
  const not: string[] = [];
  if (kept.run !== run.run || (kept.nonce ?? null) !== (run.nonce ?? null)) not.push(`the count names run ${kept.run} and this folder is run ${run.run}: it was moved from another run's bundle`);
  const played = bundle.forms.find((f) => f.id === gate);
  if (played === undefined || played.record === null) not.push(`run ${run.run} holds no record of ${gate}`);
  else if (played.faults.length > 0) not.push(`${gate} in run ${run.run} has faults of its evidence: ${played.faults.join("; ")}`);
  if (bundle.faults.length > 0) not.push(`run ${run.run} has faults in its own record: ${bundle.faults.join("; ")}`);
  if (run.mode !== mine.mode) not.push(`run ${run.run} was played in the ${run.mode === "rig" ? "rig" : "test bed"}, and this run in the ${mine.mode === "rig" ? "rig" : "test bed"}`);
  const standing = standingOfRunPlay(run, gate, 1);
  if (standing.is === "trial") not.push(`the ${form} count's play was a trial, which gives figures and no verdict: ${standing.why.join("; ")}`);
  const served = run.standing?.from?.served ?? null;
  if (served === null || mine.served === null) not.push("the shipped files the count stood on, or the ones this run stands on, are not known");
  else if (served !== mine.served) not.push(`the count stood on other shipped files (${served.slice(0, 12)}) than this run (${mine.served.slice(0, 12)})`);
  const model = kept.model ?? run.agents.find((a) => a.agent === "author")?.model ?? null;
  if (model === null || mine.model === null) not.push("the model the count was played on, or this run's, is not known");
  else if (model !== mine.model) not.push(`the count was played on ${model} and this run's Author runs on ${mine.model}`);
  return { kept, run: run.run, not };
}

/** Where a run folder is named by option (`G0_TAGS_RUN`, `G0_TWO_STEP_RUN`), else the newest folder under `RPE_PROOF_OUT` that holds the gate's count. */
export function folderOf(env: Record<string, string | undefined>, form: CountedForm): { dir: string } | { why: string } {
  const named = (form === "tags" ? env.G0_TAGS_RUN : env.G0_TWO_STEP_RUN)?.trim();
  if (named !== undefined && named !== "") return existsSync(named) ? { dir: named } : { why: `${form === "tags" ? "G0_TAGS_RUN" : "G0_TWO_STEP_RUN"} names ${named}, which is not there` };
  const out = env.RPE_PROOF_OUT?.trim();
  if (out === undefined || out === "") return { why: `no run folder is named (${form === "tags" ? "G0_TAGS_RUN" : "G0_TWO_STEP_RUN"}) and RPE_PROOF_OUT, where the newest one would be found, is not set` };
  const [newest] = foldersWithCount(out, form === "tags" ? TAGS_GATE : TWO_STEP_GATE);
  return newest === undefined ? { why: `no run under ${out} holds a count of the ${form} form` } : { dir: newest };
}

/** Both counts as G0 reads them, from the folders the options name or the newest the proof's output folder holds. */
export function readForms(env: Record<string, string | undefined>, mine: Stands): FormsReading {
  const one = (form: CountedForm): FormReading => {
    const at = folderOf(env, form);
    return "why" in at ? { kept: null, run: null, not: [at.why] } : readCount(at.dir, form, mine);
  };
  return { tags: one("tags"), twoStep: one("two-step") };
}

/** Whether a reading is one G0 may stand on. */
export const usable = (reading: FormReading): reading is FormReading & { kept: FormKept } => reading.kept !== null && reading.not.length === 0;

/** The floor model needs the two-step form: the tag count was read, may be stood on, and is below the plan's 28 of 30 (row 0.2's fail column; the owner is told at G0). */
export function needsTwoStep(tags: FormReading): boolean {
  return usable(tags) && tags.kept.count.verdict === "fail";
}

/** The count in words: kept against the plan's pass, and each way a turn was missed. */
export function countWords(kept: FormKept): string {
  const { count } = kept;
  const misses = Object.entries(count.by)
    .filter(([outcome]) => outcome !== "kept")
    .map(([outcome, n]) => `${n} ${outcome}`);
  const unread = count.unread > 0 ? `; ${count.unread} turn(s) could not be read` : "";
  const calls = kept.calls === null ? "" : `; exactly 2 calls in ${kept.calls.exact} of ${kept.calls.of} turns`;
  // The plan asks 28 of 30 of the tags alone; the two-step form's count is reported, with no pass of the plan's.
  const asks = kept.form === "tags" ? ` (the plan asks ${TAGS_PASS.hits} of ${TAGS_PASS.of})` : "";
  return `${kept.form === "tags" ? "tag form" : "two-step form"}: kept in ${count.kept} of ${count.played} turns${asks}${misses.length > 0 ? `; missed: ${misses.join(", ")}` : ""}${unread}${calls}`;
}
