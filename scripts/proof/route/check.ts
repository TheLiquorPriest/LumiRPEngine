// `run.ts check` (PlanScenarios-1 items 1 and 2): finds every proof script by itself, so no list is
// shared between the packages that write them, and refuses every one the runner could not play as
// the plan asks. The scenarios are `scripts/proof/scenarios/*.ts`; the gates are every `gate.ts`
// under `scripts/proof/` but in `scenarios/`. A hidden file (a name beginning with ".", such as the
// `.gitkeep` that keeps the scenarios' folder in git) is not a script. Every scenario is held to the
// list of the 68 (`list.ts`): every number with no file, every number with two, every file with no
// number, and every file whose wave, line or words differ from the plan's are faults, so a scenario
// dropped, doubled, renumbered or reworded shows. The runner plays no script that has a fault here.

import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { formId, gateIdFault, refusals, scenarioId, type Mark, type ProofForm } from "./form";
import { LIST, listFaults, type Listed } from "./list";

/** A proof script as the check found it. */
export interface Found {
  /** The file, from the proof folder. */
  file: string;
  kind: "scenario" | "gate";
  /**
   * The id the runner asks it by: a scenario's number as two digits, from its file's name; a gate's id,
   * read from the gate even when the gate is refused for something else; and for a gate whose id cannot
   * be read (it does not load, or its id is not one), its file.
   */
  id: string;
  /** A gate's waves, read from it even when it is refused for something else; null when they cannot be read. A scenario's wave is the list's. */
  waves: number[] | null;
  /** Whether the file loaded at all. */
  loaded: boolean;
  /** Its form, when it loads and is one. */
  form: ProofForm | null;
  /** Why it cannot be played as it stands; empty when it can. After `check`, every fault the check finds in it. */
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
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const file = join("scenarios", entry.name);
      const asScenario = SCENARIO_FILE.exec(entry.name);
      const asCheckpoint = CHECKPOINT_FILE.exec(entry.name);
      if (asScenario) {
        const id = asScenario[1] ?? "";
        found.push(await load(root, file, "scenario", id, (form) => (form.kind === "scenario" && scenarioId(form.number) !== id ? [`its name says scenario ${Number(id)} and its number is ${form.number}`] : [])));
      } else if (asCheckpoint) {
        const wave = Number(asCheckpoint[1]);
        found.push(await load(root, file, "gate", file, (form) => (form.kind === "gate" && (form.id !== `w${wave}` || form.waves.length !== 1 || form.waves[0] !== wave) ? [`a wave's checkpoint named for wave ${wave} has the id w${wave} and is played at wave ${wave} alone`] : [])));
      } else found.push({ file, kind: "scenario", id: file, waves: null, loaded: false, form: null, faults: ["it is neither a scenario named <nn>-<word>.ts nor a wave's checkpoint named w<n>-checkpoint.ts"] });
    }
  }
  for (const file of gateFiles(root, "")) found.push(await load(root, file, "gate", file, () => []));
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

/** Loads one script. `id` is a scenario's number from its file's name, or a gate's file until its id is read. */
async function load(root: string, file: string, kind: "scenario" | "gate", id: string, byName: (form: ProofForm) => string[]): Promise<Found> {
  let value: unknown;
  try {
    // The scripts are found on disk when the check runs, so no import of them can be written ahead.
    const module: unknown = await import(join(root, file));
    value = isRecord(module) ? module.default : undefined;
  } catch (error) {
    return { file, kind, id, waves: null, loaded: false, form: null, faults: [`it does not load: ${error instanceof Error ? error.message : String(error)}`] };
  }
  // What a refused gate says of itself is kept where it can be read, so a wave run can name it.
  const said = isRecord(value) ? value : {};
  const ownId = kind === "gate" && gateIdFault(said.id) === null && typeof said.id === "string" ? said.id : id;
  const ownWaves = kind === "gate" && Array.isArray(said.waves) && said.waves.length > 0 && said.waves.every((w) => typeof w === "number" && Number.isInteger(w) && w >= 0 && w <= 5) ? said.waves.filter((w): w is number => typeof w === "number") : null;
  const faults = refusals(value, kind);
  if (faults.length > 0) return { file, kind, id: ownId, waves: ownWaves, loaded: true, form: null, faults };
  // refusals has checked it is a form of this kind.
  const form = value as ProofForm;
  return { file, kind, id: kind === "scenario" ? id : formId(form), waves: form.kind === "gate" ? form.waves : null, loaded: true, form, faults: [...byName(form), ...missingFixtures(root, file, form)] };
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
 * Finds every script and checks it. A script that cannot be played is a fault; so is an id two gates
 * share, a number of the list with no file or with two, a file whose number the list lacks, and a
 * file whose wave, line or words are not the list's. Every fault about a file is also kept on that
 * file's `Found`, so the runner refuses exactly the files the check faults.
 */
export async function check(root: string, list: readonly Listed[] = LIST): Promise<CheckResult> {
  const found = await findForms(root);
  const general = [...listFaults(list), ...leftFaults(list)];
  const gates = found.filter((f) => f.kind === "gate" && f.id !== f.file);
  for (const id of new Set(gates.map((f) => f.id))) {
    const same = gates.filter((f) => f.id === id);
    if (same.length > 1) for (const f of same) f.faults.push(`${same.length} gates have the id ${id}: ${same.map((g) => g.file).join(", ")}`);
  }
  const formsOf = (form: ProofForm) => (form.rig ? "rig and live" : "live");
  const scenarioFiles = found.filter((f) => f.kind === "scenario" && SCENARIO_FILE.test(basename(f.file)));
  const noFile: { where: string; what: string }[] = [];
  const scenarios = [...list].sort((a, b) => a.number - b.number).map((row) => {
    const named = scenarioFiles.filter((f) => f.id === scenarioId(row.number));
    const played = named.find((f) => f.form?.kind === "scenario");
    if (named.length === 0) noFile.push({ where: `scenario ${row.number}`, what: "no file plays it" });
    if (named.length > 1) for (const f of named) f.faults.push(`scenario ${row.number} has ${named.length} files: ${named.map((n) => n.file).join(", ")}`);
    return { number: row.number, wave: row.wave, file: named[0]?.file ?? null, forms: played?.form ? formsOf(played.form) : named.length > 0 ? "refused" : null };
  });
  for (const f of scenarioFiles) {
    const row = list.find((r) => scenarioId(r.number) === f.id);
    if (!row) {
      f.faults.push(`the list of the 68 has no scenario ${Number(f.id)}`);
      continue;
    }
    if (f.form?.kind !== "scenario") continue;
    if (f.form.wave !== row.wave) f.faults.push(`its wave is ${f.form.wave}, and §18.3's table lists scenario ${row.number} at wave ${row.wave}`);
    if (f.form.line !== row.line) f.faults.push(`its plan line is ${f.form.line}, and scenario ${row.number}'s row is at line ${row.line}`);
    f.faults.push(...wordFaults(row, f.form.parts));
  }
  const faults = [...general, ...found.flatMap((f) => f.faults.map((what) => ({ where: f.file, what }))), ...noFile];
  return { found, scenarios, faults };
}

/**
 * Clauses inside an "As shipped:" sentence that name a means the plan gives to code, left to the script
 * writer's mark. Row 62's sentence goes on, after the GM lays the grid, to three things code does: a map
 * made in play belongs to the chat until he chooses to keep it in the world (plan l.1020), a grid has a
 * time step of its own so a fight counts seconds (l.964), and keeping it in the world is his press
 * (l.1020). Held to "as shipped", a broken button would be counted as a miss of guidance.
 */
const LEFT_TO_THE_WRITER: Record<number, readonly string[]> = {
  62: ["it shows on the Places page as belonging to the chat", "five rounds of the fight move the clock by seconds, not minutes", '"keep in the world" copies it into the world\'s draft'],
};

/** A clause left to the writer that its row does not hold: the reading has gone stale against the list. */
function leftFaults(list: readonly Listed[]): { where: string; what: string }[] {
  return Object.entries(LEFT_TO_THE_WRITER).flatMap(([number, clauses]) => {
    const row = list.find((r) => r.number === Number(number));
    return clauses.filter((clause) => !row?.seen.includes(clause)).map((clause) => ({ where: `scenario ${number}`, what: `check.ts leaves "${clause}" to the writer's mark, and the row does not hold it` }));
  });
}

/**
 * The stretches of a row the plan's "as shipped" governs, as [start, end) in its words. "as shipped,"
 * (or "as shipped" with nothing after it) governs its own clause, to the next ";" or the end of its
 * sentence. "As shipped:" (or "as shipped, with …:" or "as shipped (…):") opens the rest of its
 * sentence, and governs every clause in it, each ";" included, to the sentence's end.
 */
export function shippedScopes(seen: string): [number, number][] {
  const scopes: [number, number][] = [];
  for (const m of seen.matchAll(/as shipped/gi)) {
    const start = (m.index ?? 0) + m[0].length;
    const rest = seen.slice(start);
    const stop = rest.search(/[:;]|\.(?= |$)/);
    if (stop >= 0 && rest[stop] === ":") {
      const end = rest.slice(stop + 1).search(/\.(?= |$)/);
      scopes.push([start, end < 0 ? seen.length : start + stop + 1 + end]);
    } else scopes.push([start, stop < 0 ? seen.length : start + stop]);
  }
  return scopes;
}

/**
 * Where a scenario's parts are not the plan's words of what must be seen: a part whose words are not
 * in the row as written; words of the row no part carries ("as shipped" itself aside, which the marks
 * carry); and a part the row's "as shipped" governs that is marked "code" (`shippedScopes`; a clause
 * `LEFT_TO_THE_WRITER` names is the writer's to mark). A part beginning inside a governed stretch, or
 * holding the words "as shipped", is held to that mark. Any other part that rests on an agent following
 * a shipped file is "as shipped" by the writer's own mark, where the row does not say so.
 */
export function wordFaults(row: Listed, parts: readonly { id: string; words: string; mark: Mark }[]): string[] {
  const text = row.seen;
  const out: string[] = [];
  const covered = new Array<boolean>(text.length).fill(false);
  const scopes = shippedScopes(text);
  const left = (LEFT_TO_THE_WRITER[row.number] ?? []).map((clause) => [text.indexOf(clause), text.indexOf(clause) + clause.length] as const).filter(([start]) => start >= 0);
  const governed = (i: number) => scopes.some(([start, end]) => i >= start && i < end) && !left.some(([start, end]) => i >= start && i < end);
  for (const part of parts) {
    const at: number[] = [];
    for (let i = text.indexOf(part.words); part.words !== "" && i >= 0; i = text.indexOf(part.words, i + 1)) at.push(i);
    if (at.length === 0) {
      out.push(`part ${part.id}'s words are not in scenario ${row.number}'s row as the plan writes it: "${part.words}"`);
      continue;
    }
    for (const i of at) covered.fill(true, i, i + part.words.length);
    const underAsShipped = /as shipped/i.test(part.words) || at.every((i) => governed(i));
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
  const numbers = new Set(result.scenarios.map((s) => scenarioId(s.number)));
  const unlisted = result.found.filter((f) => f.kind === "scenario" && !numbers.has(f.id));
  if (unlisted.length > 0) lines.push(`Files in scenarios/ that play none of the 68 (${unlisted.length}):`, ...unlisted.map((f) => `  ${f.file}`));
  const gates = result.found.filter((f) => f.kind === "gate");
  lines.push(`Gates (${gates.length}):`);
  for (const f of gates) lines.push(f.form?.kind === "gate" ? `  ${f.form.id}  waves ${f.form.waves.join(", ")}  ${f.file}  ${formsOf(f.form)}` : `  ${f.file}  refused`);
  lines.push(result.faults.length === 0 ? "No faults." : `Faults (${result.faults.length}):`);
  for (const fault of result.faults) lines.push(`  ${fault.where}: ${fault.what}`);
  return `${lines.join("\n")}\n`;
}
