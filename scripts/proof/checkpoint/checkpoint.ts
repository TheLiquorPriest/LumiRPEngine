// `bun scripts/proof/run.ts checkpoint <wave> [--records <dir>] [--mark] [--brief --plan <file> --intent <file> [--repo <dir>]]` (PlanScenarios-5 items 4, 5, 6 and 10; plan §18.3, §20 risk 13).
//
// A wave's checkpoint: the wave's record (`<records>/checkpoints/wave-<n>.json`, outside the repositories; `$RPE_PROOF_RECORDS` unless `--records` names the folder) is read, and the wave
// is met only when every check of `wave.ts` holds, on the counts of each kind of result in its bundles and never on an exit code alone. The next wave's checkpoint refuses unless every wave
// before it is met on its record (and still is: a record that says "met" is read again), so a wave that was not met stops what follows it. With `--mark` the try is written into the record:
// the round it was made in, that the wave was met, or that the build stopped. G0 failing at wave 1, or a wave not met in two rounds of fixes, stops the build (§20 risk 13): the record says
// so, the wave cannot be marked met until the owner's ruling is put there, and the report to the owner is printed with his options. With `--brief` the review's brief is printed instead
// (`gate/brief.ts`). Exit 0: the wave is met. 1: it is not, or what is before it is not. 2: a usage error.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findForms } from "../route/check";
import { LIST } from "../route/list";
import { scenarioId } from "../route/form";
import { findingNotice, FIX_THE_DESIGN, renderNotice, STOP_HERE } from "../g0/notice";
import { brief } from "../gate/brief";
import { evaluate, type Evaluation, MOST_AT_ONCE, readRecord, type ReadFolder, type WaveRecord } from "./wave";
import { countsOfFolder } from "./counts";

const ROOT = resolve(import.meta.dir, "..");
const REPO = resolve(ROOT, "..", "..");

/** How many failed rounds of fixes a wave gets before the build stops (§20 risk 13). */
export const ROUNDS_BEFORE_STOP = 2;

/** Where a wave's record is kept. */
export const recordFile = (records: string, wave: number): string => join(records, "checkpoints", `wave-${wave}.json`);

export interface Options {
  records: string;
  mark: boolean;
  brief: { plan: string; intent: string; repo: string } | null;
}

/** The words after `checkpoint <w>`: the options, or why they are not any. */
export function parseOptions(argv: readonly string[], env: Record<string, string | undefined> = process.env): Options | string {
  const named = new Map<string, string>();
  let mark = false;
  let wantsBrief = false;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] ?? "";
    if (word === "--mark") mark = true;
    else if (word === "--brief") wantsBrief = true;
    else if (["--records", "--plan", "--intent", "--repo"].includes(word)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return `${word} takes a value`;
      named.set(word, value);
    } else return `the checkpoint takes --records <dir>, --mark and --brief (with --plan, --intent and --repo): not ${word}`;
  }
  const records = named.get("--records") ?? env.RPE_PROOF_RECORDS?.trim();
  if (records === undefined || records === "") return "set RPE_PROOF_RECORDS, or give --records <dir>: the folder the wave records are kept in, outside the repositories";
  if (mark && wantsBrief) return "--mark and --brief are two things: the brief is printed, and nothing is marked";
  if (!wantsBrief) return { records: resolve(records), mark, brief: null };
  const plan = named.get("--plan") ?? env.RPE_PROOF_PLAN?.trim();
  const intent = named.get("--intent") ?? env.RPE_PROOF_INTENT?.trim();
  if (plan === undefined || plan === "" || intent === undefined || intent === "") return "--brief needs the plan and INTENT.md: --plan <file> and --intent <file> (or RPE_PROOF_PLAN and RPE_PROOF_INTENT)";
  return { records: resolve(records), mark, brief: { plan, intent, repo: resolve(named.get("--repo") ?? REPO) } };
}

/** The ids the wave's checkpoint plays in the rig: every scenario of the wave, and every gate whose waves name it. */
export async function askedAt(wave: number, root: string = ROOT): Promise<string[]> {
  const found = await findForms(root);
  const gates = found.filter((f) => f.kind === "gate" && (f.waves === null || f.waves.includes(wave))).map((f) => f.id);
  return [...LIST.filter((row) => row.wave === wave).map((row) => scenarioId(row.number)), ...gates];
}

/** A record read from its file; a file that is not there is an empty record, and says so. */
function load(records: string, wave: number): { record: WaveRecord; problems: string[]; present: boolean } {
  const file = recordFile(records, wave);
  if (!existsSync(file)) return { ...readRecord({ wave }, wave), problems: [`there is no record of wave ${wave} (${file})`], present: false };
  try {
    return { ...readRecord(JSON.parse(readFileSync(file, "utf8")), wave), present: true };
  } catch (error) {
    return { ...readRecord(null, wave), problems: [`the record of wave ${wave} cannot be read: ${error instanceof Error ? error.message : String(error)}`], present: true };
  }
}

/** Writes the record whole, through a temporary file, so a record is never half written. */
function save(records: string, record: WaveRecord): void {
  const file = recordFile(records, record.wave);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, file);
}

export interface Judged {
  evaluation: Evaluation;
  problems: string[];
}

/** Everything that keeps a wave from being met: the record's own faults, what the checks find, and a build that stopped without the owner's ruling. */
export function judge(loaded: { record: WaveRecord; problems: string[]; present: boolean }, asked: readonly string[] | null, folder: ReadFolder = countsOfFolder): Judged {
  const evaluation = loaded.present ? evaluate(loaded.record, asked, folder) : { problems: [], g0: null, rates: [], read: [] };
  const problems = [...loaded.problems, ...evaluation.problems];
  if (loaded.record.stopped !== null && loaded.record.stopped.ruling === null) problems.unshift(`the build stopped on ${loaded.record.stopped.at} (${loaded.record.stopped.why}) and the owner has not ruled: the wave cannot be marked met until his ruling is put in the record`);
  return { evaluation, problems };
}

/** The report to the owner when the build stops: what was found, the figures it stands on, and the choices that are his (§20 risk 13). */
export function stopReport(wave: number, why: string, judged: Judged, rounds: number): string {
  const g0 = judged.evaluation.g0;
  const notice = findingNotice({
    id: `wave-${wave}-stop`,
    title: g0?.standing === "failed" ? `G0 failed at wave 1: the build stops here` : `Wave ${wave}'s checkpoint cannot be met: the build stops widening`,
    at: "plan §20 risk 13; §18.3",
    found: [why, ...judged.problems.slice(0, 12).map((p) => `- ${p}`), ...(judged.problems.length > 12 ? [`- and ${judged.problems.length - 12} more in the record`] : [])],
    figures: [
      `${rounds} round${rounds === 1 ? "" : "s"} of fixes tried; the plan allows ${ROUNDS_BEFORE_STOP}`,
      ...judged.evaluation.read.map((r) => `${r.what} bundle ${r.dir}: ${r.counts}`),
      ...judged.evaluation.rates.map((r) => `${r.form} ${r.part}: ${r.hits} of ${r.judged} judged${r.wants === null ? "" : ` against ${r.wants.hits} of ${r.wants.of}`}, ${r.misses} miss${r.misses === 1 ? "" : "es"}`),
      ...(g0 === null ? [] : [`G0: ${g0.why}`]),
    ],
    options: [
      ...(g0?.standing === "failed" ? [FIX_THE_DESIGN] : [`One more round of fixes on what is listed, which you allow, and the checkpoint tried again.`]),
      `Change what the wave must meet or what it holds, which is the plan's (§18.3's table), so only you change it.`,
      STOP_HERE,
    ],
    until: "nothing of the next wave starts, and nothing widens: the record says the build stopped",
  });
  return renderNotice(notice);
}

/** The report of one try: each thing the wave needs, and whether it holds. */
export function report(wave: number, judged: Judged, record: WaveRecord): string {
  const out = [`Wave ${wave}'s checkpoint`, "", judged.problems.length === 0 ? "Met: every check holds." : `Not met: ${judged.problems.length} thing${judged.problems.length === 1 ? "" : "s"} stand${judged.problems.length === 1 ? "s" : ""} in the way.`, ""];
  out.push(`Packages: ${record.packages.length} run, ${record.packages.filter((p) => p.ended !== null).length} ended, at most ${MOST_AT_ONCE} at once.`);
  out.push(`Gaps claimed closed: ${record.gaps.length}. Items left open: ${record.open.length}, ${record.open.filter((o) => o.lane !== null).length} with a lane.`);
  if (record.review !== null) out.push(`Review: ${record.review.from.slice(0, 12) || "no commit"} to ${record.review.to.slice(0, 12) || "no commit"}, ${record.review.findings.length} finding(s), ${record.review.findings.filter((f) => f.fixed !== null).length} fixed.`);
  out.push(`Pinned commit of RPH: ${record.pin ?? "not on the record"}.`);
  for (const r of judged.evaluation.read) out.push(`The ${r.what} bundle ${r.dir}: ${r.counts}.`);
  if (judged.evaluation.rates.length > 0) {
    out.push("E12's rates from the live turns:");
    for (const r of judged.evaluation.rates) out.push(`  ${r.form} ${r.part}: ${r.hits} of ${r.judged} judged${r.wants === null ? "" : `, the plan asks ${r.wants.hits} of ${r.wants.of}`}, ${r.misses} miss${r.misses === 1 ? "" : "es"}`);
  }
  if (judged.evaluation.g0 !== null) out.push(`G0: ${judged.evaluation.g0.standing}. ${judged.evaluation.g0.why}.`);
  if (judged.problems.length > 0) {
    out.push("", "In the way:");
    for (const p of judged.problems) out.push(`  - ${p}`);
  }
  return `${out.join("\n")}\n`;
}

/**
 * The wave's checkpoint. Every earlier wave is read again and must be met on its record; then this wave's record is judged and reported. With `--mark` the try is written: its round, and
 * that it is met, or that the build stopped (G0 failed at wave 1, or the second round failed).
 */
export async function checkpoint(wave: number, argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (typeof options === "string") {
    process.stdout.write(`Refused: ${options}.\n`);
    return 2;
  }
  if (options.brief !== null) {
    const loaded = load(options.records, wave);
    const review = loaded.record.review;
    if (review === null) {
      process.stdout.write(`Refused: wave ${wave}'s record holds no review (its two commits and the plan's sections), so there is nothing to brief.\n`);
      return 1;
    }
    try {
      process.stdout.write(brief({ wave, sections: review.sections, plan: options.brief.plan, intent: options.brief.intent, repo: options.brief.repo, from: review.from, to: review.to, gaps: loaded.record.gaps }));
      return 0;
    } catch (error) {
      process.stdout.write(`Refused: ${error instanceof Error ? error.message : String(error)}.\n`);
      return 1;
    }
  }

  // What is before this wave must be met, on its record, and still be.
  for (let before = 1; before < wave; before++) {
    const earlier = load(options.records, before);
    const judged = judge(earlier, await askedAt(before));
    if (earlier.record.met === null || judged.problems.length > 0) {
      process.stdout.write(`Refused: wave ${before} is not met on its record, so wave ${wave} does not start.\n${earlier.record.met === null ? `  - the record of wave ${before} does not say it was met\n` : ""}${judged.problems.map((p) => `  - ${p}`).join("\n")}\n`);
      return 1;
    }
  }

  const loaded = load(options.records, wave);
  const judged = judge(loaded, await askedAt(wave));
  process.stdout.write(report(wave, judged, loaded.record));
  const met = judged.problems.length === 0;
  const g0Failed = judged.evaluation.g0?.standing === "failed";
  // Rounds count from the owner's ruling, where there is one: a build that was ruled on goes on with its rounds new.
  const since = loaded.record.stopped?.ruling?.at;
  const failedRounds = loaded.record.rounds.filter((r) => !r.met && (since === undefined || r.at > since)).length + (met || !options.mark ? 0 : 1);
  const stops = !met && (g0Failed || failedRounds >= ROUNDS_BEFORE_STOP);
  const why = g0Failed ? (judged.evaluation.g0?.why ?? "G0 failed") : `the wave's checkpoint was not met in ${ROUNDS_BEFORE_STOP} rounds of fixes`;
  if (options.mark && loaded.present) {
    const now = new Date().toISOString();
    const record: WaveRecord = { ...loaded.record, rounds: [...loaded.record.rounds, { at: now, met, problems: judged.problems }] };
    if (met) record.met = { at: now };
    else {
      record.met = null;
      if (stops && (record.stopped === null || record.stopped.ruling !== null)) record.stopped = { at: now, why, ruling: null };
    }
    save(options.records, record);
  }
  // The report to the owner is printed whenever the build has stopped, marked or not: a record that says so is read again with it.
  if (!met && (stops || (loaded.record.stopped !== null && loaded.record.stopped.ruling === null))) process.stdout.write(`\n${stopReport(wave, loaded.record.stopped?.why ?? why, judged, failedRounds)}\n`);
  return met ? 0 : 1;
}
