// The owner's notices (PlanGates-17 item 4; plan §18.4 l.2006: "A blocker is reported the moment it is
// found"; §17.1 l.1773; §18.1 rows 0.2, 0.5 and G0; READINGS N-7, N-15). Every finding the plan says the
// owner is told of is printed as a notice with its figures and his options the moment a script finds it:
// G0's own, and those of row 0.2's packages (the floor model's form, the loop, the sampling), row 0.5's
// (the stores). The lead puts it before the owner then and enters its line under "Needs the owner" in
// `build/QUEUE.md`, never only in a decisions file. This module only builds and prints: what a notice says
// of a figure is the figure as the script that found it measured it, and every option is one the plan
// gives him. Row 0.2's and 0.5's own packages print their findings through `findingNotice` and `tell`.

import type { FloorRun, Row } from "../../testbed/floor-measure";
import { countWords, type FormsReading, needsTwoStep, usable } from "./forms";
import { TAGS_PASS } from "../lib/phase0";
import type { EffortFacts, G0Verdict } from "./verdict";

/** One finding the owner is told of. */
export interface Notice {
  /** One word for what was found; names the notice's file beside the evidence. */
  id: string;
  title: string;
  /** The plan's place that says he is told. */
  at: string;
  /** What was found, in plain words. */
  found: string[];
  /** The figures it stands on, as the script that found it measured them. */
  figures: string[];
  /** What he may choose, each one the plan gives him. */
  options: string[];
  /** What is built until he answers. */
  until: string;
  /** The line the lead enters under "Needs the owner" in `build/QUEUE.md`. */
  queue: string;
}

/** The notice as it is printed. */
export function renderNotice(notice: Notice): string {
  const out = [`NOTICE FOR THE OWNER: ${notice.title}`, `The plan says you are told of this when it is found (${notice.at}).`, "", "What was found"];
  for (const line of notice.found) out.push(`  ${line}`);
  out.push("", "The figures");
  for (const line of notice.figures) out.push(`  - ${line}`);
  out.push("", "Your choices");
  notice.options.forEach((option, i) => out.push(`  ${i + 1}. ${option}`));
  out.push("", `Until you answer: ${notice.until}`, "", `For the lead: put this before the owner now, and enter the line below under "Needs the owner" in build/QUEUE.md (plan §18.4: a blocker is reported the moment it is found, never only in a decisions file).`, `  ${notice.queue}`, "");
  return out.join("\n");
}

/** Where a notice goes the moment it is found: printed, and kept beside the evidence of the play that found it. */
export interface Telling {
  out: (text: string) => void;
  keep?: (name: string, text: string) => Promise<void>;
}

/** Prints a notice and keeps it (`notice-<id>.md`). */
export async function tell(notice: Notice, to: Telling): Promise<void> {
  const text = renderNotice(notice);
  to.out(text);
  await to.keep?.(`notice-${notice.id}.md`, text);
}

/** What a finding of a Phase 0 package is told with: the package fills in what it found and the options its row's fail column gives. */
export interface Finding {
  id: string;
  title: string;
  at: string;
  found: string[];
  figures: string[];
  options: string[];
  until: string;
}

/** A notice for a finding, with its QUEUE.md line made from it: the title, the first lines of what was found, and the options in one line. */
export function findingNotice(finding: Finding): Notice {
  const queue = `${finding.title}: ${finding.found.join(" ")} Your choices: ${finding.options.map((o, i) => `(${i + 1}) ${o}`).join(" ")} Built until you rule: ${finding.until}`;
  return { ...finding, queue };
}

/** The choices about the floor model itself, which are his in every finding about it (§21 item 20, N-15). */
export const OTHER_MODEL = "Choose another floor model: a key for a frontier model and the models you allow on the test bed, so the floor is measured on it (§21 item 20, N-15), or a checkpoint on your private server at wave 3. Until you give one, no call is made to any other model.";

export const KEEP_TWO_STEP = "Build on the floor model as it is, in the two-step form (§10.7): the reply is written in a call of its own and shown when its message ends, the time to first words taken to that moment against plain generation's last word, calls exactly 2. The form is one setting for that connection (`reply.forms.<connection>`), the tag form stays the default for a connection that keeps it.";

/** G0's fail column: the design is fixed first, each variant measured by G0's own script in a run of its own (§18.1 G0; PlanGates-17 item 3). The first build's figures are the plan's §22 l.2166, not G0's. */
export const FIX_THE_DESIGN = "Fix the design and measure again, as the plan says: the reply form (the two-step form, §10.7), the shipped wording (tried one wording at a time), or the Author's effort in its definition, which is yours to set in the file (the first build measured this model at low effort at 9.4 s to the reply's first piece with exactly 2 calls in 18 of 20, and at high effort at 16.9 s and 16 of 20, §22 l.2166: those are the first build's figures, not G0's). Each variant is measured by this same script in a run of its own, kept with its figures, and you are told again with the options before wave 2.";

export const STOP_HERE = "Stop here: nothing of wave 2 starts (§20 risk 13: stop and report with options rather than widen).";

/** The floor model needs the two-step form: its tags were kept in too few of thirty turns (row 0.2's fail column; §17.1 l.1773). */
export function formNotice(forms: FormsReading): Notice | null {
  if (!needsTwoStep(forms.tags) || !usable(forms.tags)) return null;
  const tags = forms.tags.kept;
  const two = usable(forms.twoStep) ? forms.twoStep.kept : null;
  const figures = [countWords(tags), ...(two === null ? [`the two-step form's own count was not read, or G0 may not stand on it: ${forms.twoStep.not.join("; ") || "no count"}`] : [countWords(two)])];
  return findingNotice({
    id: "floor-form",
    title: "the floor model cannot keep the reply's tags, so it works in the two-step form",
    at: "§17.1 l.1773 and §18.1 row 0.2, told at G0 before anything is widened",
    found: [`The floor model kept the intent record and the reply in their tags in ${tags.count.kept} of ${tags.count.played} turns, below the ${TAGS_PASS.hits} of ${TAGS_PASS.of} the plan asks. Row 0.2's fail column: that connection works the two-step way, and as it is the floor model you are told: a test model that cannot stream a reply is a poor floor to build on.`],
    figures,
    options: [KEEP_TWO_STEP, OTHER_MODEL],
    until: "the build goes on on the floor model in the two-step form, nothing rests on it before you have this notice, and the setting undoes it in one line.",
  });
}

/** G0 failed: a row of §17.1's first four did not pass (§18.1 G0's fail column; §20 risk 13). */
export function g0FailedNotice(run: FloorRun, rows: readonly Row[], verdict: G0Verdict, effort: EffortFacts, variant: string | null): Notice | null {
  if (verdict.verdict !== "fail") return null;
  const failed = rows.filter((r) => r.verdict === "fail");
  const figures = [
    ...rows.map((r) => `${r.measure}: ${r.verdict === "pass" ? "PASS" : r.verdict === "fail" ? "FAIL" : r.verdict === "reported" ? "reported" : "not judged"}: ${r.measured} (asked: ${r.pass}; ${r.stands})`),
    `the Author ran in the ${run.form === "tag" ? "tag" : "two-step"} form at effort ${effort.author ?? "not known"}; plain generation at ${effort.plain ?? "not known"}${effort.shipped === null ? "" : `; the shipped Author definition names ${effort.shipped}`}`,
  ];
  return findingNotice({
    id: variant === null ? "g0-failed" : "g0-variant-failed",
    title: `G0 failed${variant === null ? "" : ` on a variant (${variant})`}: ${failed.map((r) => r.measure.toLowerCase()).join(", ")}`,
    at: "§18.1 G0's fail column, §20 risk 13",
    found: [`The floor test in miniature, ten pairs of plain generation and RPE on the same model, did not pass §17.1's first four rows: ${failed.map((r) => `${r.measure} (${r.measured})`).join("; ")}. Nothing is widened before the design is fixed.`],
    figures,
    options: [FIX_THE_DESIGN, OTHER_MODEL, STOP_HERE],
    until: "nothing of wave 2 starts; the design is fixed first, the first choice carried out, each variant measured and reported to you, and no call is made to any model but the test bed's own.",
  });
}

/** Every notice a G0 run's findings call for, in the order they are told: the floor model's form first, then a failed G0. A run with no verdict, or a pass, tells nothing but the report. */
export function g0Notices(input: { run: FloorRun; rows: readonly Row[]; verdict: G0Verdict; forms: FormsReading; effort: EffortFacts; variant: string | null }): Notice[] {
  const out: Notice[] = [];
  const form = formNotice(input.forms);
  if (form !== null) out.push(form);
  const failed = g0FailedNotice(input.run, input.rows, input.verdict, input.effort, input.variant);
  if (failed !== null) out.push(failed);
  return out;
}
