// The owner's G0 report (PlanGates-17 items 2 and 3; plan §18.1 G0, §17.1 l.1771-1773, §20 risk 13, §21
// item 20; READINGS N-7, N-15, R-92). One page he reads before wave 2 starts: each of §17.1's first four
// rows with its figure and verdict; whether the floor model needs the two-step form ("a test model that
// cannot stream a reply is a poor floor to build on"); the effort both arms ran at, which is the shipped
// Author definition's (an agent's effort is its definition's alone, R-92), with §22's low-effort figures
// beside it, since any change of the value is his choice made in that file; each pair's two replies side
// by side for him to read; and the call that is his: a key and the models he allows on the bed, or a
// checkpoint on his private server at wave 3 (§21 item 20, N-15).
//
// After a failed G0 nothing widens until the design is fixed; each variant (the reply form, the shipped
// wording, the Author's effort in its definition) is measured by the same script in a run of its own and
// listed here with its figures and what it changed, and the options are put to him again. The report is
// written from recorded runs alone (`entryOf` reads a bundle): the same bundle gives the same report.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { type FloorRun, type Row } from "../../testbed/floor-measure";
import { standingLines } from "../lib/record";
import { BundleRefused, readBundle, type ReadBundle } from "../route/evidence";
import { countWords, type FormReading, type FormsReading, needsTwoStep, usable } from "./forms";
import { FIX_THE_DESIGN, KEEP_TWO_STEP, OTHER_MODEL, STOP_HERE } from "./notice";
import { type ArmReply, g0Rows, type G0Kept } from "./verdict";

/** The gate's id as the bundle names its folder. */
export const G0_GATE = "G0";

/** One G0 run as the report holds it. */
export interface Entry {
  /** The run's name, and the lines that open its table (what it stood on). */
  name: string;
  head: string[];
  /** The shipped tree the server ran, by hash: what a run's wording is. */
  served: string | null;
  floor: FloorRun;
  kept: G0Kept;
}

/** §22 l.2166's figures for this model at three efforts, the first build's own: they say what the value does here, not what G0 measured. */
export const FIRST_BUILD_EFFORT = {
  from: "§22 l.2166, the first build's `G0Floor` (twenty simple turns each, the two-step form, one turn at a time); the record of a build the owner rejected, given beside the value, never in place of G0's figures",
  rows: [
    { effort: "high", first: "16.9 s", calls: "exactly 2 calls in 16 of 20 turns" },
    { effort: "low", first: "9.4 s", calls: "exactly 2 calls in 18 of 20 turns, the intent record written first in 20 of 20" },
    { effort: "off (no thinking)", first: "6.7 s", calls: "a median of 3 calls" },
  ],
  note: "Medium is high on this provider. Time is to the reply's first piece on RPE's side, not to first words on the page.",
} as const;

/** The question that is his (§21 item 20, N-15). */
export const HIS_CALL = "§21 item 20, which you left as your call: a frontier-model key on the test bed, for Phase 0's cache check and for tuning the guidance against the models you play on; or a checkpoint on your private server at wave 3. Built until you rule (N-15): no call is made to any other model, the cache check and the tuning run on the allowed model alone, and Anthropic and OpenAI stay unmeasured.";

const word = (v: Row["verdict"]): string => (v === "pass" ? "PASS" : v === "fail" ? "FAIL" : v === "reported" ? "REPORTED" : "NOT JUDGED");

/** A cell of a table: a pipe and a line break are not the table's own. */
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

/** A run's result in words. */
function resultOf(kept: G0Kept): string {
  const v = kept.verdict;
  if (v.verdict === "pass") return "PASSED: all four rows passed on a run whose conditions held";
  if (v.verdict === "fail") return "FAILED";
  return `NO VERDICT (${v.kind}): the plan gives none on this run`;
}

/** The rows as they are shown: a run with a trial or a stop gives no verdict on any row, only figures. */
function rowLines(entry: Entry, row: Row): string[] {
  const none = entry.kept.verdict.kind === "trial" || entry.kept.verdict.kind === "stopped";
  return [
    `### ${row.measure}: ${none ? `no verdict (${entry.kept.verdict.kind})` : word(row.verdict)}`,
    `- Asked: ${row.pass}`,
    `- Measured: ${row.measured}`,
    `- Stands on: ${row.stands}`,
    ...(none ? [] : row.why.map((w) => `- Not judged: ${w}`)),
    ...row.notes.map((n) => `- Note: ${n}`),
    "",
  ];
}

/** The count of one form in words, and why G0 does not stand on it where it does not. */
function formLines(name: string, reading: FormReading): string[] {
  if (reading.kept === null) return [`- ${name}: no count was read: ${reading.not.join("; ")}`];
  const lines = [`- ${name}: ${countWords(reading.kept)} (run ${reading.run ?? "not named"}).`];
  if (reading.not.length > 0) lines.push(`  G0 does not stand on this count: ${reading.not.join("; ")}.`);
  return lines;
}

/** What the floor model's form is, from the counts G0 may stand on. */
function formFinding(forms: FormsReading): string {
  if (needsTwoStep(forms.tags)) return "The floor model needs the two-step form: its tags were kept in fewer turns than the plan asks. A test model that cannot stream a reply is a poor floor to build on; you are told at G0, before anything is widened (§17.1 l.1773).";
  if (usable(forms.tags)) return "The floor model keeps the tags: the tag form stands for this connection.";
  return "Whether the floor model needs the two-step form is not known: no count of the tags that G0 may stand on was read. G0's rows below are measured in the form the run's Author ran in, but the owner's question (does it need the two-step form) is open until the tags run is read.";
}

/** How a run differs from the first, in words: the reply form, the Author's effort, the shipped files (the wording), and what its own label says. */
export function changes(first: Entry, other: Entry): string[] {
  const out: string[] = [];
  if (first.floor.form !== other.floor.form) out.push(`reply form ${first.floor.form === "tag" ? "the tags" : "the two-step form"} → ${other.floor.form === "tag" ? "the tags" : "the two-step form"}`);
  if (first.kept.effort.author !== other.kept.effort.author) out.push(`the Author's effort ${first.kept.effort.author ?? "not known"} → ${other.kept.effort.author ?? "not known"}`);
  if (first.kept.effort.plain !== other.kept.effort.plain) out.push(`plain generation's effort ${first.kept.effort.plain ?? "not known"} → ${other.kept.effort.plain ?? "not known"}`);
  if (first.served !== other.served) out.push(`the shipped files (the wording) ${first.served?.slice(0, 12) ?? "not known"} → ${other.served?.slice(0, 12) ?? "not known"}`);
  if (other.kept.variant !== null) out.push(`its label: ${other.kept.variant}`);
  return out.length > 0 ? out : ["nothing the run records differs from the first run's"];
}

/** The owner's choices after these runs: what the plan gives him, from the first run and the variants measured since. */
function choices(entries: readonly Entry[]): string[] {
  const passing = entries.filter((e) => e.kept.verdict.verdict === "pass");
  const out: string[] = [];
  if (entries[0]?.kept.verdict.verdict === "pass") out.push("G0 passed on the first run: nothing is to be fixed, and wave 2 may start once you have this report.");
  else if (passing.length > 0) out.push(`Keep the design of a run that passed (${passing.map((e) => e.name).join(", ")}): set what it changed in the files, which is your choice to make (the Author's effort is the \`effort:\` of its definition), and wave 2 may start once you say so.`);
  else if (entries.some((e) => e.kept.verdict.verdict === "fail")) out.push(FIX_THE_DESIGN, STOP_HERE);
  else out.push("No run has given a G0 verdict yet: the lead runs it again, and nothing of wave 2 starts until one has.");
  if (entries.some((e) => needsTwoStep(e.kept.forms.tags))) out.push(KEEP_TWO_STEP);
  out.push(OTHER_MODEL);
  return out;
}

/** One entry's section: its result, its four rows, the floor model's form, its effort, its replies. */
function body(entry: Entry): string[] {
  const { kept, floor } = entry;
  const rows = g0Rows(floor);
  const effort = kept.effort;
  const out: string[] = ["## The run", "", `Run ${entry.name}${kept.variant === null ? "" : ` (variant: ${kept.variant})`}`, ...entry.head.map((h) => `- ${h}`)];
  if (kept.verdict.why.length > 0) out.push(...kept.verdict.why.map((w) => `- ${kept.verdict.verdict === "fail" ? "Missed" : "Why no verdict"}: ${w}`));
  out.push("", "## The four rows (§17.1)", "");
  for (const row of rows) out.push(...rowLines(entry, row));
  out.push("## The floor model's reply form", "", formFinding(kept.forms), "", ...formLines("The tags (row 0.2, thirty turns, the floor chat)", kept.forms.tags), ...formLines("The two-step form (row 0.2, the same thirty lines)", kept.forms.twoStep));
  out.push(`- This run's Author ran in the ${floor.form === "tag" ? "tag" : "two-step"} form${floor.streams ? ", streaming" : ", not streaming"}. ${floor.form === "two-step" ? "Three rows read differently in that form (§17.1): calls exactly 2; first words timed to the moment the reply's message ends against plain generation's time to its last word; time per token reported, not gated." : "The rows are read in the tag form: calls exactly 1, first words to the reply's first word, time per token gated at 15%."}`, "");
  out.push("## The thinking effort", "", `- The Author ran at: ${effort.author ?? "not known"}. Plain generation, on the same model through Lumiverse, ran at: ${effort.plain ?? "not known"}. ${effort.refusal === null ? "The two arms' effort is the same." : `The comparison rows are not judged on effort: ${effort.refusal}.`}`, `- The shipped Author definition names: ${effort.shipped ?? "not read"}. An agent's effort is its definition's alone (R-92); neither arm is turned up or down to match the other. Any change of the value is your choice, made in that file.`, `- The first build's figures for this model at other efforts, beside it (${FIRST_BUILD_EFFORT.from}):`);
  out.push("", "  | Effort | To the reply's first piece | Calls |", "  |---|---|---|", ...FIRST_BUILD_EFFORT.rows.map((r) => `  | ${r.effort} | ${r.first} | ${r.calls} |`), "", `  ${FIRST_BUILD_EFFORT.note}`, "");
  out.push("## The replies, pair by pair", "", "Plain generation and RPE are each sent their own line (a chat takes each line once); each cell gives the line, then the reply the chat saved.", "", "| Pair | Plain generation | RPE |", "|---|---|---|");
  const armCell = (a: ArmReply): string => cell(a.reply === null ? `${a.line === null ? "" : `${a.line}\n\n`}(not read: ${a.why ?? "no reply"})` : `${a.line ?? ""}\n\n${a.reply}`);
  for (const r of kept.replies) out.push(`| ${r.pair} | ${armCell(r.plain)} | ${armCell(r.rpe)} |`);
  out.push("");
  return out;
}

/** The report over a first run and, after it, each variant measured in a run of its own (§20 risk 13): every run with its figures and what it changed, then his choices. */
export function renderReport(entries: readonly Entry[]): string {
  const [first, ...variants] = entries;
  if (first === undefined) throw new Error("the report is of at least one run");
  const out: string[] = ["# G0: the floor test in miniature", "", `Result of the first run: ${resultOf(first.kept)}.`, "", ...body(first)];
  if (variants.length > 0) {
    out.push("## Variants measured after the first run", "", "Each is the same script on the same ten pairs, played in a run of its own and kept with its figures (§20 risk 13).", "");
    for (const v of variants) {
      out.push(`### ${v.name}${v.kept.variant === null ? "" : ` (${v.kept.variant})`}: ${resultOf(v.kept)}`, "", `- Changed against the first run: ${changes(first, v).join("; ")}.`);
      for (const w of v.kept.verdict.why) out.push(`- ${v.kept.verdict.verdict === "fail" ? "Missed" : "Why no verdict"}: ${w}`);
      for (const row of g0Rows(v.floor)) out.push(`- ${row.measure}: ${word(row.verdict)}: ${row.measured} (${row.stands})`);
      out.push(`- Effort: the Author at ${v.kept.effort.author ?? "not known"}, plain generation at ${v.kept.effort.plain ?? "not known"}.`, "");
    }
  }
  out.push("## What is yours to decide", "", ...choices(entries).map((c, i) => `${i + 1}. ${c}`), "", `Your call, whatever G0 says: ${HIS_CALL}`, "");
  return out.join("\n");
}

/** The report's source could not be read as a G0 run. */
export class EntryRefused extends Error {}

/** One G0 run read back from its bundle: the run's record, the table's run (`turns.json`) and what G0 kept of itself (`g0.json`). */
export function entryOf(dir: string): Entry {
  let bundle: ReadBundle;
  try {
    bundle = readBundle(dir);
  } catch (error) {
    throw new EntryRefused(error instanceof BundleRefused || error instanceof Error ? error.message : String(error));
  }
  const at = join(dir, G0_GATE, "internal", "play-01");
  const read = (file: string): unknown => {
    if (!existsSync(join(at, file))) throw new EntryRefused(`${dir} holds no ${G0_GATE}/internal/play-01/${file}: this is not a run of G0`);
    return JSON.parse(readFileSync(join(at, file), "utf8"));
  };
  const turns = read("turns.json");
  const kept = read("g0.json");
  if (!isRecord(turns) || !Array.isArray(turns.turns)) throw new EntryRefused(`${at}/turns.json is not a floor run`);
  if (!isRecord(kept) || kept.kind !== "g0") throw new EntryRefused(`${at}/g0.json is not what G0 keeps`);
  if (kept.run !== bundle.run.run) throw new EntryRefused(`${at}/g0.json is of run ${String(kept.run)} and the folder is run ${bundle.run.run}`);
  return { name: bundle.run.run, head: standingLines(bundle.run), served: bundle.run.standing?.from?.served ?? null, floor: turns as unknown as FloorRun, kept: kept as unknown as G0Kept };
}
