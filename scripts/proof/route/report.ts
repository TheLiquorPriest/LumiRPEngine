// The report (PlanScenarios-1 item 5; plan §18.4 l.1994: "A piece is done when its proof is recorded.
// Reports say what was run and what was not."). Written from the bundle alone: the 68 by wave, each
// played or not played (and why), passed, failed, not seen, or measured as a rate; every rate with its
// misses; the gates played, the same way; and every fault of the evidence. A part counts as passed only
// where the bundle's own screens show it (`evidence.ts` re-checks every look against the folder), and
// a folder with any fault of the evidence fails: a folder with no screen, a screen whose name does not
// say what it shows, notes naming a screen the folder lacks, a record that is not that folder's, are
// never passes. A scenario with an "as shipped" part played live is reported as its rate, beside its
// code (§17.4 l.1806), never as "passed". A gate is counted only by an id that can be a gate's, never
// by a scenario's number. It holds the plan's words, counts, reasons and the names of screens; nothing
// of a chat's own text beyond what the checks said they saw.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateIdFault, scenarioId } from "./form";
import { readBundle, titleOf, type ReadBundle, type ReadForm } from "./evidence";
import { LIST } from "./list";
import { describeVerdict, headline, verdictOf, type FormRecord, type FormResult } from "./results";

/** What came of one of the 68, or of a gate, in a run. */
export interface Counted {
  id: string;
  played: boolean;
  /** For one played: its result, `failed` whenever its evidence is at fault. */
  result: FormResult | null;
  /** For one played: whether a fault of its evidence is what failed it. */
  faulty: boolean;
  /** For one not played: why. */
  why: string | null;
}

export interface Summary {
  /** The 68, in order, each with what came of it. */
  scenarios: (Counted & { number: number; wave: number })[];
  gates: Counted[];
}

const SCENARIO_ID = /^\d{2}$/;
/** An id a run asked as a scenario's stage, well named or not (`40:before`): never a gate's, since a gate's id holds no colon. */
const STAGE_ASKED = /^\d{2}:/;

/** What came of each of the 68 and each gate, from the bundle alone. */
export function summarize(read: ReadBundle): Summary {
  const forms = new Map(read.forms.map((f) => [f.id, f]));
  const counted = (id: string): Counted => {
    const form = forms.get(id);
    if (form) return { id, played: true, result: form.result, faulty: (form.record === null && form.stages === null) || form.faults.length > 0, why: null };
    return { id, played: false, result: null, faulty: false, why: unplayedWhy(read, id) };
  };
  const scenarios = [...LIST].sort((a, b) => a.number - b.number).map((row) => ({ ...counted(scenarioId(row.number)), number: row.number, wave: row.wave }));
  // A gate the run knew by its file (one whose id cannot be read) is listed by its file; a folder is a gate's only when its name can be a gate's id.
  const named = [...read.run.known.gates, ...read.run.asked, ...read.forms.map((f) => f.id).filter((id) => gateIdFault(id) === null)];
  const gates = [...new Set(named)].filter((id) => !SCENARIO_ID.test(id) && !STAGE_ASKED.test(id)).sort();
  return { scenarios, gates: gates.map(counted) };
}

/** Why a form was not played, from the run's record: a scenario played in stages, none of whose stages was played, says so stage by stage. */
function unplayedWhy(read: ReadBundle, id: string): string {
  const own = read.run.unplayed.find((u) => u.id === id);
  if (own) return own.why;
  const staged = read.run.unplayed.filter((u) => u.id.startsWith(`${id}:`));
  if (staged.length > 0) {
    const name = (u: { id: string }) => u.id.slice(id.length + 1);
    const whys = [...new Set(staged.map((u) => u.why))];
    return whys.length === 1 ? `${whys[0]}: ${staged.length === 1 ? "stage" : "stages"} ${staged.map(name).join(", ")}` : staged.map((u) => `stage ${name(u)}: ${u.why}`).join("; ");
  }
  return read.run.asked.some((asked) => asked === id || asked.startsWith(`${id}:`)) ? "asked, and the run did not say why it was not played" : "not asked in this run";
}

/** A line of counts: how many were played and not, and what came of those played. */
function counts(list: Counted[]): string {
  const played = list.filter((c) => c.played);
  const of = (result: FormResult) => played.filter((c) => c.result === result).length;
  const faulty = played.filter((c) => c.faulty).length;
  const whole = of("not played whole");
  const trial = of("trial");
  const unjudged = of("not judged");
  return `played ${played.length} of ${list.length}, not played ${list.length - played.length}; passed ${of("passed")}, failed ${of("failed")}${faulty > 0 ? ` (${faulty} for faults of the evidence)` : ""}, not seen ${of("not seen")}, measured as a rate ${of("measured")}${whole > 0 ? `, not played whole ${whole}` : ""}${unjudged > 0 ? `, not judged ${unjudged}` : ""}${trial > 0 ? `, trial ${trial}` : ""}`;
}

function sentence(text: string): string {
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}.`;
}

/** The ones not played, by number, grouped by why. */
function notPlayed(list: Counted[], name: (c: Counted) => string): string[] {
  const byWhy = new Map<string, string[]>();
  for (const c of list) if (!c.played && c.why) byWhy.set(c.why, [...(byWhy.get(c.why) ?? []), name(c)]);
  return [...byWhy].map(([why, names]) => `- Not played (${why}): ${names.join(", ")}`);
}

/** A played form's lines: its result, then each part in the plan's words with what came of it and its screens; a scenario played in stages, stage by stage, each stage not played named with why. */
function playedLines(form: ReadForm, head: string, trial: boolean): string[] {
  if (!form.stages) return recordLines(form.record, form.faults, head, "", trial);
  const result = form.faults.length > 0 ? "failed: a fault of its evidence" : form.result === "measured" ? "measured as a rate, stage by stage" : form.result;
  const unplayed = form.stages.filter((stage) => stage.result === null).map((stage) => stage.name);
  const missing = unplayed.length === 0 ? "" : `${result === "not played whole" ? ":" : ";"} ${unplayed.length === 1 ? "stage" : "stages"} ${unplayed.join(", ")} ${unplayed.length === 1 ? "was" : "were"} not played`;
  const lines = [`- ${head}: ${result}${missing}`];
  for (const stage of form.stages) {
    if (stage.result === null) lines.push(`  - Stage ${stage.name}: not played (${stage.why})`);
    else lines.push(...recordLines(stage.record, stage.faults, `Stage ${stage.name}`, "  ", trial));
  }
  return lines;
}

/** One record's lines, at an indent: its result, its stops, and each part with what came of it; in a trial, what rests on guidance as figures only. */
function recordLines(record: FormRecord | null, faults: string[], head: string, indent: string, trial: boolean): string[] {
  if (!record) return [`${indent}- ${head}: failed: a fault of its evidence; its folder holds no record of what was played`];
  const lines = [`${indent}- ${head}: ${faults.length > 0 ? "failed: a fault of its evidence" : headline(record, trial)}`];
  for (const stop of record.stops) lines.push(`${indent}  - Play ${stop.play} stopped: ${stop.why}`);
  for (const part of record.parts) {
    const [first, ...rest] = describeVerdict(part, record.mode, trial);
    lines.push(`${indent}  - "${part.words}" (${part.mark}): ${first}`);
    for (const line of rest) lines.push(`${indent}    - ${line}`);
  }
  return lines;
}

/** The records a played form holds: its own, or each of its stages' that was played. */
function recordsOf(form: ReadForm): { record: FormRecord; faults: string[] }[] {
  if (form.record) return [{ record: form.record, faults: form.faults }];
  return (form.stages ?? []).flatMap((stage) => (stage.record ? [{ record: stage.record, faults: stage.faults }] : []));
}

/** The report in plain words, from the bundle alone. */
export function reportOf(read: ReadBundle): string {
  const { run } = read;
  const summary = summarize(read);
  const forms = new Map(read.forms.map((f) => [f.id, f]));
  const trial = read.standing.is === "trial";
  const lines: string[] = [
    `# Proof run ${run.run}`,
    "",
    `Played ${run.mode === "rig" ? "in the rig (the stand-in Lumiverse, a scripted model for each agent, RPE's real pages)" : "live on the test bed (the real Lumiverse UI and RPE's own UI, the real model)"}. Started by ${run.by}, ${run.started} to ${run.ended ?? "a run that broke off before its end"}.`,
    `RPE ${run.rpe.commit}${run.rpe.dirty ? " with changes not committed" : ""}. RPH ${run.rph.commit}, ${run.rph.pinned ? "the commit RPE pins" : run.rph.pin ? `not the commit RPE pins (${run.rph.pin})` : "and RPE pins no commit"}. Lumiverse ${run.lumiverse.version}. Browser ${run.browser.name} ${run.browser.version}.`,
    `Agents: ${run.agents.map((a) => `${a.agent} on ${a.connection} (${a.model}, ${a.replyForm}, effort ${a.effort}, ${a.streams ? "streaming" : "not streaming"})`).join("; ")}.`,
    trial
      ? `This run is a trial, and gives no verdict on what rests on guidance: ${read.standing.why.join("; ")}. A gate's measured parts and every "as shipped" part are printed as trial, with their figures, and counted apart.`
      : "This run gives a verdict: RPE's tree is its commit, RPH is the commit RPE pins, the shipped tree the server ran is the build's, and no layer of the user's own holds guidance.",
    `Asked: ${run.asked.length === 0 ? "nothing" : run.asked.join(", ")}. An "as shipped" part is played ${run.repeats} times live, each on a fresh chat; in the rig it is played once, as its code path only.`,
    "Only what was seen on screen counts as proof (plan §17.0). What code does is passed or failed; what the shipped guidance achieves is a rate, with every miss. A fault of the evidence fails what it concerns.",
    "",
    "## The 68 scenarios",
    "",
    `All 68: ${counts(summary.scenarios)}.`,
  ];
  for (const wave of [1, 2, 3, 4]) {
    const inWave = summary.scenarios.filter((s) => s.wave === wave);
    lines.push("", `### Wave ${wave} (${inWave.length})`, "", sentence(counts(inWave)));
    for (const s of inWave) {
      const form = forms.get(s.id);
      if (form) lines.push(...playedLines(form, `${s.number}. ${titleOf({ kind: "scenario", number: s.number, id: s.id }).replace(/^Scenario \d+: /, "")}`, trial));
    }
    lines.push(...notPlayed(inWave, (c) => String(Number(c.id))));
  }
  const rates = read.forms.flatMap((form) => recordsOf(form).flatMap(({ record, faults }) => (record.mode === "live" ? record.parts.filter((p) => p.mark === "as shipped" && ["rate", "trial"].includes(verdictOf(p, "live", trial).kind)).map((part) => ({ form, record, faults, part })) : [])));
  lines.push("", "## Rates of the shipped guidance", "");
  if (rates.length === 0) lines.push(run.mode === "rig" ? "None: the rig proves an \"as shipped\" part's code path only, and measures no rate." : "None: no \"as shipped\" part was played.");
  for (const { form, record, faults, part } of rates) {
    const [first, ...rest] = describeVerdict(part, "live", trial);
    const title = SCENARIO_ID.test(form.id) ? titleOf(record) : `Gate ${form.id}`;
    lines.push(`- ${title}, "${part.words}": ${first}${faults.length > 0 ? " (its evidence is at fault)" : ""}`, ...rest.map((line) => `  - ${line}`));
  }
  lines.push("", "## Gates", "", summary.gates.length === 0 ? "No gate was known to this run." : sentence(counts(summary.gates)));
  for (const g of summary.gates) {
    const form = forms.get(g.id);
    if (form) lines.push(...playedLines(form, `Gate ${g.id}`, trial));
  }
  lines.push(...notPlayed(summary.gates, (c) => c.id));
  const faults = [...read.faults.map((f) => `- The run: ${f}`), ...read.forms.flatMap((f) => f.faults.map((fault) => `- ${f.id}: ${fault}`))];
  lines.push("", "## Faults of the evidence", "", ...(faults.length === 0 ? ["None."] : faults));
  return `${lines.join("\n")}\n`;
}

/**
 * A run's exit code, from its bundle alone, so `report` gives the code the run gave:
 * - 1: a fault of the evidence; a run that broke off before its end; nothing asked; something asked not
 *   played; or a form failed, not seen, not played whole or not judged;
 * - 3: none of those, and a trial: what rests on guidance gave figures and no verdict (counted apart);
 * - 0: none of those, and every form passed or was measured as a rate. A miss of guidance is a finding,
 *   not a failure of the run (Y23).
 */
export function exitCode(read: ReadBundle): number {
  if (read.faults.length > 0 || read.run.ended === null || read.run.asked.length === 0 || read.run.unplayed.length > 0) return 1;
  if (read.forms.some((f) => f.result === "failed" || f.result === "not seen" || f.result === "not played whole" || f.result === "not judged")) return 1;
  return read.forms.some((f) => f.result === "trial") ? 3 : 0;
}

/** Reads a bundle, writes its `report.md`, and returns the report. */
export function writeReport(dir: string): string {
  const text = reportOf(readBundle(dir));
  writeFileSync(join(dir, "report.md"), text);
  return text;
}
