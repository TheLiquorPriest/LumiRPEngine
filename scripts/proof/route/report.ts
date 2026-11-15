// The report (PlanScenarios-1 item 5; plan §18.4 l.1994: "A piece is done when its proof is recorded.
// Reports say what was run and what was not."). Written from the bundle alone: the 68 by wave, each
// played or not played (and why), passed, failed or not seen; every rate with its misses; the gates
// played, the same way; and every fault of the evidence. A part counts as passed only where the
// bundle's own screens show it (`evidence.ts` re-checks every one against the folder), so a folder
// with no screen, a screen whose name does not say what it shows, or notes naming a screen the folder
// lacks is reported as a fault and never as a pass. It holds the plan's words, counts, reasons and the
// names of screens; nothing of a chat's own text beyond what the checks said they saw.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scenarioId } from "./form";
import { readBundle, titleOf, type ReadBundle, type ReadForm } from "./evidence";
import { LIST } from "./list";
import { describeVerdict, formResult, verdictOf, type FormResult } from "./results";

/** What came of one of the 68, or of a gate, in a run. */
export interface Counted {
  id: string;
  played: boolean;
  /** For one played: its result; a folder with no record of what was played is not seen. */
  result: FormResult | null;
  /** For one not played: why. */
  why: string | null;
}

export interface Summary {
  /** The 68, in order, each with what came of it. */
  scenarios: (Counted & { number: number; wave: number })[];
  gates: Counted[];
}

/** What came of each of the 68 and each gate, from the bundle alone. */
export function summarize(read: ReadBundle): Summary {
  const forms = new Map(read.forms.map((f) => [f.id, f]));
  const counted = (id: string): Counted => {
    const form = forms.get(id);
    if (form) return { id, played: true, result: form.record ? formResult(form.record) : "not seen", why: null };
    const unplayed = read.run.unplayed.find((u) => u.id === id);
    return { id, played: false, result: null, why: unplayed?.why ?? (read.run.asked.includes(id) ? "asked, and the run did not say why it was not played" : "not asked in this run") };
  };
  const scenarios = [...LIST].sort((a, b) => a.number - b.number).map((row) => ({ ...counted(scenarioId(row.number)), number: row.number, wave: row.wave }));
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const gateIds = [...new Set([...read.run.known.gates, ...read.run.asked.filter((id) => !scenarioIds.has(id)), ...read.forms.filter((f) => f.record?.kind === "gate").map((f) => f.id)])].sort();
  return { scenarios, gates: gateIds.map(counted) };
}

/** A line of counts: how many were played and not, and what came of those played. */
function counts(list: Counted[]): string {
  const played = list.filter((c) => c.played);
  const of = (result: FormResult) => played.filter((c) => c.result === result).length;
  const parts = [`played ${played.length} of ${list.length}`, `not played ${list.length - played.length}`, `passed ${of("passed")}`, `failed ${of("failed")}`, `not seen ${of("not seen")}`];
  if (of("rates only") > 0) parts.push(`rates only ${of("rates only")}`);
  return parts.join(", ");
}

/** The ones not played, by number, grouped by why. */
function notPlayed(list: Counted[], name: (c: Counted) => string): string[] {
  const byWhy = new Map<string, string[]>();
  for (const c of list) if (!c.played && c.why) byWhy.set(c.why, [...(byWhy.get(c.why) ?? []), name(c)]);
  return [...byWhy].map(([why, names]) => `- Not played (${why}): ${names.join(", ")}`);
}

/** A played form's lines: its result, then each part in the plan's words with what came of it and its screens. */
function playedLines(form: ReadForm, head: string): string[] {
  if (!form.record) return [`- ${head}: not seen: its folder holds no record of what was played`];
  const lines = [`- ${head}: ${formResult(form.record)}`];
  for (const stop of form.record.stops) lines.push(`  - Play ${stop.play} stopped: ${stop.why}`);
  for (const part of form.record.parts) {
    const [first, ...rest] = describeVerdict(part, form.record.mode);
    lines.push(`  - "${part.words}" (${part.mark}): ${first}`);
    for (const line of rest) lines.push(`    - ${line}`);
  }
  return lines;
}

/** The report in plain words, from the bundle alone. */
export function reportOf(read: ReadBundle): string {
  const { run } = read;
  const summary = summarize(read);
  const forms = new Map(read.forms.map((f) => [f.id, f]));
  const lines: string[] = [
    `# Proof run ${run.run}`,
    "",
    `Played ${run.mode === "rig" ? "in the rig (the stand-in Lumiverse, a scripted model for each agent, RPE's real pages)" : "live on the test bed (the real Lumiverse UI and RPE's own UI, the real model)"}. Started by ${run.by}, ${run.started} to ${run.ended ?? "a run that broke off before its end"}.`,
    `RPE ${run.rpe.commit}${run.rpe.dirty ? " with changes not committed" : ""}. RPH ${run.rph.commit}, ${run.rph.pinned ? "the commit RPE pins" : run.rph.pin ? `not the commit RPE pins (${run.rph.pin})` : "and RPE pins no commit"}. Lumiverse ${run.lumiverse.version}. Browser ${run.browser.name} ${run.browser.version}.`,
    `Agents: ${run.agents.map((a) => `${a.agent} on ${a.connection} (${a.model}, ${a.replyForm}, effort ${a.effort}, ${a.streams ? "streaming" : "not streaming"})`).join("; ")}.`,
    `Asked: ${run.asked.length === 0 ? "nothing" : run.asked.join(", ")}. An "as shipped" part is played ${run.repeats} times live, each on a fresh chat; in the rig it is played once, as its code path only.`,
    "Only what was seen on screen counts as proof (plan §17.0). What code does is passed or failed; what the shipped guidance achieves is a rate, with every miss.",
    "",
    "## The 68 scenarios",
    "",
    `All 68: ${counts(summary.scenarios)}.`,
  ];
  for (const wave of [1, 2, 3, 4]) {
    const inWave = summary.scenarios.filter((s) => s.wave === wave);
    lines.push("", `### Wave ${wave} (${inWave.length})`, "", `${counts(inWave)[0]?.toUpperCase()}${counts(inWave).slice(1)}.`);
    for (const s of inWave) {
      const form = forms.get(s.id);
      if (form) lines.push(...playedLines(form, `${s.number}. ${titleOf({ kind: "scenario", number: s.number, id: s.id }).replace(/^Scenario \d+: /, "")}`));
    }
    lines.push(...notPlayed(inWave, (c) => String(Number(c.id))));
  }
  const rates = read.forms.flatMap((form) => (form.record?.mode === "live" ? form.record.parts.filter((p) => verdictOf(p, "live").kind === "rate").map((part) => ({ form, part })) : []));
  lines.push("", "## Rates of the shipped guidance", "");
  if (rates.length === 0) lines.push(run.mode === "rig" ? "None: the rig proves an \"as shipped\" part's code path only, and measures no rate." : "None: no \"as shipped\" part was played.");
  for (const { form, part } of rates) {
    const [first, ...rest] = describeVerdict(part, "live");
    lines.push(`- ${form.record ? titleOf(form.record) : form.id}, "${part.words}": ${first}`, ...rest.map((line) => `  - ${line}`));
  }
  lines.push("", "## Gates", "", summary.gates.length === 0 ? "No gate was known to this run." : `${counts(summary.gates)[0]?.toUpperCase()}${counts(summary.gates).slice(1)}.`);
  for (const g of summary.gates) {
    const form = forms.get(g.id);
    if (form) lines.push(...playedLines(form, `Gate ${g.id}`));
  }
  lines.push(...notPlayed(summary.gates, (c) => c.id));
  const faults = [...read.faults.map((f) => `- The run: ${f}`), ...read.forms.flatMap((f) => f.faults.map((fault) => `- ${f.id}: ${fault}`))];
  lines.push("", "## Faults of the evidence", "", ...(faults.length === 0 ? ["None."] : faults));
  return `${lines.join("\n")}\n`;
}

/** Reads a bundle, writes its `report.md`, and returns the report. */
export function writeReport(dir: string): string {
  const text = reportOf(readBundle(dir));
  writeFileSync(join(dir, "report.md"), text);
  return text;
}
