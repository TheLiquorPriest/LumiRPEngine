// `run.ts check` (PlanScenarios-1 items 1 and 2): finds every proof script by itself, so no list is
// shared between the packages that write them, and refuses every one the runner could not play as
// the plan asks. The scenarios are `scripts/proof/scenarios/*.ts`; the gates are every `gate.ts`
// under `scripts/proof/` but in `scenarios/`. Every scenario is held to the list of the 68
// (`list.ts`): every number with no file, every file with no number, and every file whose wave, line
// or words differ from the plan's are faults, so a scenario dropped, renumbered or reworded shows.

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { formId, refusals, scenarioId, type Mark, type ProofForm } from "./form";
import { LIST, listFaults, type Listed } from "./list";

/** A proof script as the check found it. */
export interface Found {
  /** The file, from the proof folder. */
  file: string;
  kind: "scenario" | "gate";
  /** Its form, when it loads and is one. */
  form: ProofForm | null;
  /** Why it cannot be played as it stands; empty when it can. */
  faults: string[];
}

export interface CheckResult {
  found: Found[];
  /** Each of the 68 with the file that plays it (null: none), from the list. */
  scenarios: { number: number; wave: number; file: string | null; forms: string | null }[];
  /** Every fault, each with the file or number it is about. */
  faults: { where: string; what: string }[];
}

const SCENARIO_FILE = /^(\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.ts$/;
const CHECKPOINT_FILE = /^w([0-5])-checkpoint\.ts$/;

/** Every proof script under the proof folder, loaded and checked one by one. */
export async function findForms(root: string): Promise<Found[]> {
  const found: Found[] = [];
  const scenarios = join(root, "scenarios");
  if (existsSync(scenarios)) {
    for (const entry of readdirSync(scenarios, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      const file = join("scenarios", entry.name);
      const asScenario = SCENARIO_FILE.exec(entry.name);
      const asCheckpoint = CHECKPOINT_FILE.exec(entry.name);
      if (asScenario) found.push(await load(root, file, "scenario", (form) => (form.kind === "scenario" && scenarioId(form.number) !== asScenario[1] ? [`its name says scenario ${Number(asScenario[1])} and its number is ${form.number}`] : [])));
      else if (asCheckpoint) {
        const wave = Number(asCheckpoint[1]);
        found.push(await load(root, file, "gate", (form) => (form.kind === "gate" && (form.id !== `w${wave}` || form.waves.length !== 1 || form.waves[0] !== wave) ? [`a wave's checkpoint named for wave ${wave} has the id w${wave} and is played at wave ${wave} alone`] : [])));
      } else found.push({ file, kind: "scenario", form: null, faults: ["it is neither a scenario named <nn>-<word>.ts nor a wave's checkpoint named w<n>-checkpoint.ts"] });
    }
  }
  for (const file of gateFiles(root, "")) found.push(await load(root, file, "gate", () => []));
  return found;
}

/** Every `gate.ts` under the proof folder, `scenarios/` and hidden folders left out. */
function gateFiles(root: string, under: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, under), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(under, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || path === "scenarios") continue;
      out.push(...gateFiles(root, path));
    } else if (entry.isFile() && entry.name === "gate.ts" && under !== "") out.push(path);
  }
  return out;
}

async function load(root: string, file: string, kind: "scenario" | "gate", byName: (form: ProofForm) => string[]): Promise<Found> {
  let value: unknown;
  try {
    // The scripts are found on disk when the check runs, so no import of them can be written ahead.
    const module: unknown = await import(join(root, file));
    value = isRecord(module) ? module.default : undefined;
  } catch (error) {
    return { file, kind, form: null, faults: [`it does not load: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const faults = refusals(value, kind);
  if (faults.length > 0) return { file, kind, form: null, faults };
  const form = value as ProofForm;
  faults.push(...byName(form), ...missingFixtures(root, file, form));
  return { file, kind, form, faults };
}

/** A fixture a script names and nobody made. */
function missingFixtures(root: string, file: string, form: ProofForm): string[] {
  const dir = fixturesDir(root, file, form);
  return form.fixtures.filter((name) => !existsSync(join(dir, name))).map((name) => `its fixture ${name} is not in ${relative(root, dir) || "."}`);
}

/** Where a script's fixtures are: the scenarios' `fixtures/` folder, or a gate's own folder. */
export function fixturesDir(root: string, file: string, form: ProofForm): string {
  return form.kind === "scenario" || file.startsWith("scenarios/") ? join(root, "scenarios", "fixtures") : join(root, file, "..");
}

/**
 * Finds every script and checks it: a script that cannot be played is a fault; so is an id two
 * scripts share, a number of the list with no file, a file whose number the list lacks, and a file
 * whose wave, line or words are not the list's.
 */
export async function check(root: string, list: readonly Listed[] = LIST): Promise<CheckResult> {
  const found = await findForms(root);
  const faults = [...listFaults(list), ...found.flatMap((f) => f.faults.map((what) => ({ where: f.file, what })))];
  const byId = new Map<string, string[]>();
  for (const f of found) if (f.form) byId.set(formId(f.form), [...(byId.get(formId(f.form)) ?? []), f.file]);
  for (const [id, files] of byId) if (files.length > 1) for (const file of files) faults.push({ where: file, what: `${files.length} scripts have the id ${id}: ${files.join(", ")}` });
  const formsOf = (form: ProofForm) => (form.rig ? "rig and live" : "live");
  const scenarioFiles = found.filter((f) => f.kind === "scenario" && SCENARIO_FILE.test(f.file.slice("scenarios/".length)));
  const scenarios = [...list].sort((a, b) => a.number - b.number).map((row) => {
    const named = scenarioFiles.filter((f) => f.file.startsWith(`scenarios/${scenarioId(row.number)}-`));
    const played = named.find((f) => f.form?.kind === "scenario");
    if (named.length === 0) faults.push({ where: `scenario ${row.number}`, what: "no file plays it" });
    return { number: row.number, wave: row.wave, file: named[0]?.file ?? null, forms: played?.form ? formsOf(played.form) : named.length > 0 ? "refused" : null };
  });
  for (const f of scenarioFiles) {
    const number = Number(f.file.slice("scenarios/".length, "scenarios/".length + 2));
    const row = list.find((r) => r.number === number);
    if (!row) {
      faults.push({ where: f.file, what: `the list of the 68 has no scenario ${number}` });
      continue;
    }
    if (f.form?.kind !== "scenario") continue;
    if (f.form.wave !== row.wave) faults.push({ where: f.file, what: `its wave is ${f.form.wave}, and §18.3's table lists scenario ${row.number} at wave ${row.wave}` });
    if (f.form.line !== row.line) faults.push({ where: f.file, what: `its plan line is ${f.form.line}, and scenario ${row.number}'s row is at line ${row.line}` });
    for (const what of wordFaults(row, f.form.parts)) faults.push({ where: f.file, what });
  }
  return { found, scenarios, faults };
}

/**
 * Where a scenario's parts are not the plan's words of what must be seen: a part whose words are not
 * in the row as written; words of the row no part carries ("as shipped" itself aside, which the marks
 * carry); and a part the row puts under "as shipped" that is marked "code". An "as shipped" reaches
 * to the end of its clause (the next ";" or the end of its sentence), and a part that begins inside
 * it, or holds the words "as shipped", is held to that mark. Clauses after it are the writer's to
 * mark, as is any part that rests on an agent following a shipped file where the row does not say so.
 */
export function wordFaults(row: Listed, parts: readonly { id: string; words: string; mark: Mark }[]): string[] {
  const text = row.seen;
  const out: string[] = [];
  const covered = new Array<boolean>(text.length).fill(false);
  const scopes = [...text.matchAll(/as shipped/gi)].map((m) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = text.slice(start).search(/;|\.(?= |$)/);
    return [start, end < 0 ? text.length : start + end] as const;
  });
  for (const part of parts) {
    const at: number[] = [];
    for (let i = text.indexOf(part.words); part.words !== "" && i >= 0; i = text.indexOf(part.words, i + 1)) at.push(i);
    if (at.length === 0) {
      out.push(`part ${part.id}'s words are not in scenario ${row.number}'s row as the plan writes it: "${part.words}"`);
      continue;
    }
    for (const i of at) covered.fill(true, i, i + part.words.length);
    const underAsShipped = /as shipped/i.test(part.words) || at.every((i) => scopes.some(([start, end]) => i >= start && i < end));
    if (underAsShipped && part.mark !== "as shipped") out.push(`part ${part.id} is marked "${part.mark}", and the plan's row puts "${part.words}" under "as shipped"`);
  }
  const rest = [...text].map((ch, i) => (covered[i] ? "\u0000" : ch)).join("").replace(/as shipped/gi, " ");
  const missing = rest
    .split("\u0000")
    .map((span) => span.replace(/^[^A-Za-z0-9`"]+|[^A-Za-z0-9`"]+$/g, ""))
    .filter((span) => /[A-Za-z0-9]/.test(span));
  for (const span of missing) out.push(`no part carries the plan's words "${span}"`);
  return out;
}

/** What `run.ts check` prints: each of the 68 with its wave and the file that plays it, each file the list lacks, each gate with its waves, then every fault. */
export function describeCheck(result: CheckResult): string {
  const lines: string[] = [];
  const formsOf = (form: ProofForm) => (form.rig ? "rig and live" : "live");
  const withFile = result.scenarios.filter((s) => s.file !== null).length;
  lines.push(`The plan's ${result.scenarios.length} scenarios: ${withFile} with a file, ${result.scenarios.length - withFile} with none.`);
  for (const s of result.scenarios) lines.push(`  ${s.number}  wave ${s.wave}  ${s.file ? `${s.file}  ${s.forms}` : "no file"}`);
  const listed = new Set(result.scenarios.map((s) => s.file));
  const unlisted = result.found.filter((f) => f.kind === "scenario" && !listed.has(f.file));
  if (unlisted.length > 0) lines.push(`Files in scenarios/ that play none of the 68 (${unlisted.length}):`, ...unlisted.map((f) => `  ${f.file}`));
  const gates = result.found.filter((f) => f.kind === "gate");
  lines.push(`Gates (${gates.length}):`);
  for (const f of gates) lines.push(f.form?.kind === "gate" ? `  ${f.form.id}  waves ${f.form.waves.join(", ")}  ${f.file}  ${formsOf(f.form)}` : `  ${f.file}  refused`);
  lines.push(result.faults.length === 0 ? "No faults." : `Faults (${result.faults.length}):`);
  for (const fault of result.faults) lines.push(`  ${fault.where}: ${fault.what}`);
  return `${lines.join("\n")}\n`;
}
