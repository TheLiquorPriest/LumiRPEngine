// The evidence bundle (PlanScenarios-1 item 4; plan §17.0 l.1751): "Only what can be seen on screen
// counts as proof of a scenario; anything internal is supporting evidence."
//
// Every run leaves one folder named for the run: `run.json` (the builds, Lumiverse's version, rig or
// bed, every agent's connection, model, reply form, effort and streaming, the settings in force as
// `GET /api/v1/settings` gave them, who started it, start and end, what was asked); and a folder per
// scenario or gate with its screens (`play-01/world-1440-four-values.png`: the play, the page, the
// width, the part it shows), `result.json`, `notes.md` saying part by part in the plan's words which
// screen shows it, and `internal/` for route answers, rows and logs, marked as supporting evidence.
//
// A screen counts only when it shows what its check saw: the page it names was the page showing, it is
// not blank, and the texts the check said show the part are in the text visible in the saved image
// (the host's contract, `host.ts`). A part whose check found what it looks for and has no such screen
// is "not seen", never "pass".
//
// Reading a bundle back trusts nothing the record says that the folder can contradict. Every look of
// every part is held to the runner's own way of recording it: an outcome word it writes, a look on
// every page of the part at every width, every play accounted for, screens that are in the folder and
// show what was seen, a record that is the folder's own scenario or gate and carries its row's words,
// notes that name the record's screens. Anything else is a fault of the evidence, and a fault of the
// evidence fails the result it concerns: it is never a pass.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { SettingsReply } from "../../../src/ui/api";
import { wordFaults } from "./check";
import { gateIdFault, pageSlug, scenarioId, TERMINAL, WIDTHS, type Seen, type Sighting } from "./form";
import type { AgentFacts, Browser, Kept, Mode, RunFacts, Shot } from "./host";
import { LIST } from "./list";
import { describeVerdict, formResult, MEASURED_OUTCOMES, outcomeOf, SEEN_OUTCOMES, type FormRecord, type FormResult, type Glance, type Instance, type Outcome, type PartRecord } from "./results";

/** `run.json`: what a run stood on, who started it, when, and what it was asked. */
export interface RunRecord {
  run: string;
  mode: Mode;
  by: string;
  started: string;
  /** Null while the run goes on, and in a run that broke off before its end. */
  ended: string | null;
  /** Scenario numbers as two digits and gate ids, as asked; a gate whose id cannot be read, by its file. */
  asked: string[];
  /** What was asked and not played, and why. */
  unplayed: { id: string; why: string }[];
  /** The scripts the runner found when the run began: scenarios by number, gates by id, a gate whose id cannot be read by its file. */
  known: { scenarios: string[]; gates: string[] };
  /** How many plays an "as shipped" part gets live. */
  repeats: number;
  /** What went wrong in the run itself, outside any form (the host or the lock could not be put away). A record that has none may leave it out. */
  faults?: string[];
  rpe: { commit: string; dirty: boolean };
  rph: { commit: string; pin: string | null; pinned: boolean };
  lumiverse: { version: string };
  browser: { name: string; version: string };
  agents: AgentFacts[];
  settings: SettingsReply;
}

/** A bundle that cannot be read as evidence, with why. */
export class BundleRefused extends Error {}

export const SUPPORTING = "supporting-evidence.txt";

/**
 * A screen's name as the bundle writes it, `play-01/world-1440-four-values.png`: its play, the page,
 * the width, and what it shows (a part, with a count when the part was seen there again). A page's
 * name has no word of digits (the form refuses one), so the first such word is the width.
 */
export function parseScreen(file: string): { play: number; page: string; width: number; what: string } | null {
  const name = /^play-(\d{2})\/([a-z0-9]+(?:-[a-z0-9]+)*?)-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.(?:png|webp|txt)$/.exec(file);
  if (!name || (name[2] ?? "").split("-").some((word) => /^\d+$/.test(word))) return null;
  return { play: Number(name[1]), page: name[2] ?? "", width: Number(name[3]), what: name[4] ?? "" };
}

/** The part a screen's name says it shows, given the form's parts: the name itself, or the name less its count. */
export function partOfScreen(what: string, parts: ReadonlySet<string>): string | null {
  if (parts.has(what)) return what;
  const counted = /^(.*)-\d+$/.exec(what);
  return counted && parts.has(counted[1] ?? "") ? (counted[1] ?? null) : null;
}

/** Writes one run's bundle. */
export class Bundle {
  private constructor(readonly dir: string) {}

  /** A new folder under `out`, named for the run: its mode and when it started. */
  static open(out: string, mode: Mode, now: Date): Bundle {
    mkdirSync(out, { recursive: true });
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    let name = `${mode}-${stamp}`;
    for (let n = 2; existsSync(join(out, name)); n++) name = `${mode}-${stamp}-${n}`;
    mkdirSync(join(out, name));
    return new Bundle(join(out, name));
  }

  get run(): string {
    return this.dir.split(/[\\/]/).pop() ?? this.dir;
  }

  writeRun(record: RunRecord): void {
    writeFileSync(join(this.dir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  /** The form's folder, made with its `internal/` and the line that marks what is in there. */
  formDir(id: string): string {
    const dir = join(this.dir, id);
    mkdirSync(join(dir, "internal"), { recursive: true });
    writeFileSync(join(dir, "internal", SUPPORTING), "Supporting evidence only: route answers, rows and logs kept beside the screens. Nothing here counts as proof of a scenario (plan §17.0).\n");
    return dir;
  }

  /** Saves a screen in the play's folder, named for the page it showed, its width and the part; returns its name from the form's folder. */
  saveScreen(id: string, play: number, page: string, part: string, shot: Shot): string {
    const folder = `play-${String(play).padStart(2, "0")}`;
    mkdirSync(join(this.dir, id, folder), { recursive: true });
    const base = `${pageSlug(page)}-${shot.width}-${part}`;
    let name = `${folder}/${base}.${shot.format}`;
    for (let n = 2; existsSync(join(this.dir, id, name)); n++) name = `${folder}/${base}-${n}.${shot.format}`;
    writeFileSync(join(this.dir, id, name), shot.image);
    return name;
  }

  /** Supporting evidence of one play, in `internal/`. */
  keep(id: string, play: number, name: string, data: Kept): void {
    const dir = join(this.dir, id, "internal", `play-${String(play).padStart(2, "0")}`);
    mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[\\/]+/g, "-");
    if (typeof data === "string") writeFileSync(join(dir, /\.\w+$/.test(safe) ? safe : `${safe}.txt`), data);
    else if (data instanceof Uint8Array) writeFileSync(join(dir, safe), data);
    else writeFileSync(join(dir, /\.\w+$/.test(safe) ? safe : `${safe}.json`), `${JSON.stringify(data, null, 2)}\n`);
  }

  writeResult(record: FormRecord): void {
    writeFileSync(join(this.dir, record.id, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  writeNotes(record: FormRecord): void {
    writeFileSync(join(this.dir, record.id, "notes.md"), notesOf(record, this.run));
  }
}

/** The run's record from the host's facts. RPH is the pinned commit when the two name one commit, whether either is written short or whole. */
export function runRecord(facts: RunFacts, fields: Omit<RunRecord, "rpe" | "rph" | "lumiverse" | "browser" | "agents" | "settings">): RunRecord {
  const { commit, pin } = facts.rph;
  // Seven characters is the shortest form git writes a commit in.
  const pinned = pin !== null && Math.min(pin.length, commit.length) >= 7 && (pin.startsWith(commit) || commit.startsWith(pin));
  return { ...fields, rpe: facts.rpe, rph: { commit, pin, pinned }, lumiverse: facts.lumiverse, browser: facts.browser, agents: facts.agents, settings: facts.settings };
}

/** What is missing from a host's facts, which would leave a run without its provenance. */
export function factFaults(facts: unknown): string[] {
  if (!isRecord(facts)) return ["the host gave no facts"];
  const out: string[] = [];
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (!isRecord(facts.rpe) || !text(facts.rpe.commit) || typeof facts.rpe.dirty !== "boolean") out.push("RPE's commit, and whether its tree is changed");
  if (!isRecord(facts.rph) || !text(facts.rph.commit) || !(facts.rph.pin === null || text(facts.rph.pin))) out.push("RPH's commit and the commit RPE pins");
  if (!isRecord(facts.lumiverse) || !text(facts.lumiverse.version)) out.push("Lumiverse's version");
  if (!isRecord(facts.browser) || !text(facts.browser.name) || !text(facts.browser.version)) out.push("the browser and its version");
  if (!Array.isArray(facts.agents) || facts.agents.length === 0) out.push("every agent's connection, model, reply form, effort and streaming");
  else
    facts.agents.forEach((agent, i) => {
      if (!isRecord(agent) || !text(agent.agent) || !text(agent.connection) || !text(agent.model) || !text(agent.replyForm) || !text(agent.effort) || typeof agent.streams !== "boolean") out.push(`agent ${i + 1}'s connection, model, reply form, effort or streaming`);
    });
  if (!isRecord(facts.settings) || !Array.isArray(facts.settings.settings)) out.push("the settings in force, as GET /api/v1/settings gives them");
  return out;
}

const NAMED_NOTHING = "the check said it saw the part and named no words, or an empty text, as what shows it: a check names the words the page shows";

/** Why a check's answer cannot be taken as a sighting; null when it can. */
function answerFault(answer: unknown): string | null {
  if (!isRecord(answer) || typeof answer.found !== "boolean") return "the check's answer is not a sighting: it says found, and the words that show it or what is missing";
  if (answer.found && (!Array.isArray(answer.shows) || answer.shows.length === 0 || answer.shows.some((text) => typeof text !== "string" || text.trim() === ""))) return NAMED_NOTHING;
  return null;
}

/**
 * One look at a part on one page at one width: open the page, run the part's check, save a screen of
 * what shows, and keep whether that screen shows what the check saw. A check that answers it saw the
 * part and names no words, or an empty text, is refused as a fault of its script: the look is one the
 * code could not make. Nothing here waits a fixed time; the host's own waits are on what shows.
 */
export async function lookAt(browser: Browser, sighting: Sighting, width: number | undefined, save: (shot: Shot) => string): Promise<Glance> {
  const page = sighting.page;
  let seen: Seen | null = null;
  let blind: string | null = null;
  try {
    await browser.open(page, width);
    try {
      const answer: unknown = await sighting.check(browser);
      blind = answerFault(answer);
      // answerFault has checked the answer is a sighting.
      if (blind === null) seen = answer as Seen;
    } catch (error) {
      blind = `the check could not look: ${message(error)}`;
    }
  } catch (error) {
    blind = `the page would not open: ${message(error)}`;
  }
  let shot: Shot | null = null;
  let noShot = "";
  try {
    shot = await browser.screen();
  } catch (error) {
    noShot = message(error);
  }
  const screen = shot && shot.image.length > 0 ? save(shot) : null;
  const glance: Glance = {
    page,
    width: width ?? shot?.width ?? null,
    found: blind !== null || seen === null ? null : seen.found,
    what: blind ?? (seen?.found === false ? String(seen.what) : (seen?.what ?? "")),
    shows: seen?.found ? seen.shows : [],
    screen,
    shotPage: shot?.page ?? null,
    shotText: shot?.text ?? null,
    unshown: null,
  };
  if (glance.found === true) {
    if (screen === null) glance.unshown = `no screen was saved${noShot ? `: ${noShot}` : shot ? ": the screen was empty" : ""}`;
    else if (width !== undefined && shot && shot.width !== width) glance.unshown = `the screen is ${shot.width} wide, and it was looked at ${width} wide`;
    else glance.unshown = unshownBy(glance);
  }
  return glance;
}

/** Why a saved screen does not show what its check saw, from what the saved image named itself and showed; null when it does. */
export function unshownBy(glance: Pick<Glance, "page" | "shows" | "shotPage" | "shotText">): string | null {
  if (glance.shotPage === null || pageSlug(glance.shotPage) !== pageSlug(glance.page)) return `the screen shows the ${glance.shotPage ?? "unnamed"} page, not the ${glance.page} page`;
  if (glance.shotText === null || glance.shotText.trim() === "") return "the screen is blank";
  if (glance.shows.length === 0) return "the check named nothing on the page that shows it";
  if (glance.shows.some((text) => text.trim() === "")) return "the check named an empty text as what shows it";
  const missing = glance.shows.filter((text) => !(glance.shotText ?? "").includes(text));
  return missing.length === 0 ? null : `the screen does not show ${missing.map((m) => `"${m}"`).join(", ")}`;
}

/** The widths a page is looked at: R-40's two for a page, the terminal's own for the terminal. */
export function widthsOf(page: string): (number | undefined)[] {
  return pageSlug(page) === TERMINAL ? [undefined] : [...WIDTHS];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const OUTCOME_WORDS: Record<Outcome, string> = {
  shown: "seen on screen",
  absent: "looked for and not there",
  unseen: "seen, and no screen shows it",
  broken: "could not be looked for, a fault of the code",
  unlooked: "never looked for",
  met: "met",
  unmet: "not met",
};

/** A form's heading: its number and the plan's own scenario, or the gate's id. */
export function titleOf(record: Pick<FormRecord, "kind" | "number" | "id">): string {
  if (record.kind === "gate") return `Gate ${record.id}`;
  return `Scenario ${record.number}: ${LIST.find((row) => row.number === record.number)?.title ?? "not in the list of the 68"}`;
}

/** `notes.md`: part by part, in the plan's words, what came of every look and which screens show it. */
export function notesOf(record: FormRecord, run: string): string {
  const where = record.mode === "rig" ? "in the rig" : "live on the test bed";
  const lines = [
    `# ${titleOf(record)}`,
    "",
    `${record.line ? `Plan line ${record.line}. ` : ""}${record.waves.length === 1 ? `Wave ${record.waves[0]}` : `Waves ${record.waves.join(", ")}`}. Played ${where}, ${record.plays === 1 ? "once" : `${record.plays} times, each on a fresh chat`}, in run ${run}.`,
    "Only the screens named below count as proof (plan §17.0). `internal/` holds route answers, rows and logs: supporting evidence only.",
  ];
  for (const stop of record.stops) lines.push("", `Play ${stop.play} stopped: ${stop.why}.`);
  for (const part of record.parts) {
    lines.push("", `## "${part.words}" (${part.mark})`, "", describeVerdict(part, record.mode)[0] ?? "");
    lines.push(part.measured ? `Measured: ${part.measured}.` : `Seen on: ${part.pages.join(", ")}.`, "");
    for (const instance of part.instances) lines.push(`- ${instanceLine(instance)}`);
  }
  return `${lines.join("\n")}\n`;
}

function instanceLine(instance: Instance): string {
  const screens = instance.glances.flatMap((g) => (g.screen ? [g.screen] : []));
  return `Play ${instance.play}${instance.at > 1 ? `, look ${instance.at}` : ""}: ${OUTCOME_WORDS[instance.outcome] ?? instance.outcome}: ${instance.why}. ${screens.length === 0 ? "No screen." : `Screens: ${screens.join(", ")}`}`;
}

// ---------------------------------------------------------------- reading a bundle back

/** A scenario's or gate's folder as read back, its record re-checked against the files. */
export interface ReadForm {
  id: string;
  /** The record as re-checked against the folder; null when `result.json` is missing, unreadable or not a record. */
  record: FormRecord | null;
  /** Faults of the evidence, in plain words. */
  faults: string[];
  /** Its result: `failed` whenever the folder has a fault of the evidence or no record, otherwise the record's own. */
  result: FormResult;
}

export interface ReadBundle {
  dir: string;
  run: RunRecord;
  forms: ReadForm[];
  /** Faults of the run's own record, and what went wrong in the run outside any form. */
  faults: string[];
}

/** Reads a bundle back. Refused without a whole `run.json`: what is not tied to its build, its settings and who ran it proves nothing. */
export function readBundle(dir: string): ReadBundle {
  const runFile = join(dir, "run.json");
  if (!existsSync(runFile)) throw new BundleRefused(`${dir} has no run.json, so what was run, on which build and settings, and by whom, is unknown: nothing in it counts`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(runFile, "utf8"));
  } catch (error) {
    throw new BundleRefused(`${dir}/run.json cannot be read: ${message(error)}`);
  }
  const missing = runFaults(raw);
  if (missing.length > 0) throw new BundleRefused(`${dir}/run.json lacks ${missing.join("; ")}`);
  // runFaults has checked every field this reader and the report use.
  const run = raw as RunRecord;
  const faults: string[] = [...(run.faults ?? [])];
  const folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const forms = folders.map((id) => readForm(join(dir, id), id, run));
  const seen = new Set<string>();
  for (const id of run.asked) {
    if (seen.has(id)) faults.push(`${id} is asked twice`);
    seen.add(id);
    const played = folders.includes(id);
    const unplayed = run.unplayed.some((u) => u.id === id);
    if (!played && !unplayed) faults.push(`${id} was asked, and neither played nor said why not`);
    if (played && unplayed) faults.push(`${id} is both played and said not to be`);
  }
  return { dir, run, forms, faults };
}

function runFaults(raw: unknown): string[] {
  if (!isRecord(raw)) return ["everything"];
  const out = factFaults(raw);
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (!text(raw.run)) out.push("the run's name");
  if (raw.mode !== "rig" && raw.mode !== "live") out.push("rig or bed");
  if (!text(raw.by)) out.push("who started it");
  if (!text(raw.started)) out.push("when it started");
  if (!(raw.ended === null || text(raw.ended))) out.push("when it ended");
  if (!Array.isArray(raw.asked) || !raw.asked.every(text)) out.push("what was asked");
  if (!Array.isArray(raw.unplayed) || !raw.unplayed.every((u) => isRecord(u) && text(u.id) && text(u.why))) out.push("what was not played, and why");
  if (!isRecord(raw.known) || !Array.isArray(raw.known.scenarios) || !Array.isArray(raw.known.gates) || !raw.known.gates.every(text)) out.push("the scripts the runner found");
  if (typeof raw.repeats !== "number" || !Number.isInteger(raw.repeats) || raw.repeats < 1) out.push("how many plays an \"as shipped\" part gets");
  if (raw.faults !== undefined && (!Array.isArray(raw.faults) || !raw.faults.every(text))) out.push("what went wrong in the run, as a list");
  if (!isRecord(raw.rph) || typeof raw.rph.pinned !== "boolean") out.push("whether RPH is the pinned commit");
  return out;
}

/** Every file under a folder, `internal/` left out, from the folder. */
function filesUnder(dir: string, under = ""): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) => {
    const path = under === "" ? entry.name : `${under}/${entry.name}`;
    if (entry.isDirectory()) return path === "internal" ? [] : filesUnder(dir, path);
    return entry.isFile() ? [path] : [];
  });
}

const SCREEN_FILE = /\.(png|webp|txt)$/;

function readForm(dir: string, id: string, run: RunRecord): ReadForm {
  const files = filesUnder(dir);
  const faults: string[] = [];
  if (!run.asked.includes(id)) faults.push("the run did not ask for it");
  if (!/^\d{2}$/.test(id)) {
    const fault = gateIdFault(id);
    if (fault) faults.push(`its folder's name is neither one of the 68 nor a gate's id: ${fault}`);
  } else if (!LIST.some((row) => scenarioId(row.number) === id)) faults.push(`its folder is named for scenario ${Number(id)}, which is not one of the 68`);
  if (files.length === 0 && readdirSync(dir).length === 0) return finish(id, null, [...faults, "the folder is empty"]);
  let record: FormRecord | null = null;
  if (!files.includes("result.json")) faults.push("result.json is missing, so nothing played here can be counted");
  else {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
      const shape = shapeFaults(raw);
      if (shape.length > 0) faults.push(`result.json is not a run's record of a form: ${shape.join("; ")}`);
      // shapeFaults has checked every field the re-check and the report read.
      else record = raw as FormRecord;
    } catch (error) {
      faults.push(`result.json cannot be read: ${message(error)}`);
    }
  }
  const screens = files.filter((f) => SCREEN_FILE.test(f));
  if (screens.length === 0 && (record === null || record.parts.some((p) => p.measured === null))) faults.push("the folder holds no screen");
  const parts = new Set(record?.parts.map((p) => p.id) ?? []);
  const pages = new Set(record?.parts.flatMap((p) => p.pages.map(pageSlug)) ?? []);
  const named = new Set(record?.parts.flatMap((p) => p.instances.flatMap((i) => i.glances.flatMap((g) => (g.screen ? [g.screen] : [])))) ?? []);
  for (const file of screens) {
    const name = parseScreen(file);
    if (!name) faults.push(`${file}: its name does not say its play, the page, the width and what it shows`);
    else if (record && partOfScreen(name.what, parts) === null) faults.push(`${file}: named for "${name.what}", which is none of its parts`);
    else if (record && !pages.has(name.page)) faults.push(`${file}: named for the ${name.page} page, which none of its parts is seen on`);
    else if (record && !named.has(file)) faults.push(`${file}: no look in result.json names it`);
    if (statSync(join(dir, file)).size === 0) faults.push(`${file} is empty`);
  }
  if (!files.includes("notes.md")) faults.push("notes.md is missing");
  else {
    const notes = new Set(readFileSync(join(dir, "notes.md"), "utf8").match(/play-\d{2}\/[^\s,)]+\.(?:png|webp|txt)/g) ?? []);
    for (const screen of notes) if (!files.includes(screen)) faults.push(`notes.md names ${screen}, which the folder lacks`);
    for (const screen of notes) if (record && !named.has(screen)) faults.push(`notes.md names ${screen}, which no look in result.json names`);
    for (const screen of named) if (!notes.has(screen)) faults.push(`notes.md does not name ${screen}, which result.json names`);
  }
  if (record) {
    faults.push(...identityFaults(record, id, run));
    record = recheck(record, dir, files, faults);
  }
  return finish(id, record, faults);
}

function finish(id: string, record: FormRecord | null, faults: string[]): ReadForm {
  const unique = [...new Set(faults)];
  return { id, record, faults: unique, result: record === null || unique.length > 0 ? "failed" : formResult(record) };
}

/** Why a value is not a record the runner writes, at the level of its fields; empty when it is one. */
function shapeFaults(raw: unknown): string[] {
  if (!isRecord(raw)) return ["it is not an object"];
  const out: string[] = [];
  const texts = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === "string");
  const textOrNull = (value: unknown) => value === null || typeof value === "string";
  const whole = (value: unknown, least: number) => typeof value === "number" && Number.isInteger(value) && value >= least;
  if (typeof raw.id !== "string" || raw.id === "") out.push("it has no id");
  if (raw.kind !== "scenario" && raw.kind !== "gate") out.push("it is neither a scenario's nor a gate's");
  if (raw.mode !== "rig" && raw.mode !== "live") out.push("it was played neither in the rig nor live");
  if (!(raw.number === null || whole(raw.number, 1))) out.push("its number is not a number");
  if (!Array.isArray(raw.waves) || !raw.waves.every((w) => whole(w, 0))) out.push("its waves are not waves");
  if (!(raw.line === null || whole(raw.line, 1))) out.push("its line is not a line");
  if (!whole(raw.plays, 1)) out.push("its plays are not a count");
  if (!Array.isArray(raw.stops) || !raw.stops.every((s) => isRecord(s) && whole(s.play, 1) && typeof s.why === "string")) out.push("its stops are not stops");
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) return [...out, "it has no parts"];
  raw.parts.forEach((part, p) => {
    if (!isRecord(part) || typeof part.id !== "string" || typeof part.words !== "string" || (part.mark !== "code" && part.mark !== "as shipped") || !texts(part.pages) || !textOrNull(part.measured) || !(part.wants === null || (isRecord(part.wants) && whole(part.wants.hits, 1) && whole(part.wants.of, 1))) || !Array.isArray(part.instances)) {
      out.push(`part ${p + 1} is not a part`);
      return;
    }
    part.instances.forEach((instance, i) => {
      const where = `part ${part.id}'s look ${i + 1}`;
      if (!isRecord(instance) || !whole(instance.play, 1) || !whole(instance.at, 1) || typeof instance.outcome !== "string" || typeof instance.why !== "string" || !(instance.page === undefined || textOrNull(instance.page)) || !Array.isArray(instance.glances)) {
        out.push(`${where} is not a look`);
        return;
      }
      instance.glances.forEach((glance, g) => {
        const ok = isRecord(glance) && typeof glance.page === "string" && (glance.width === null || typeof glance.width === "number") && (glance.found === null || typeof glance.found === "boolean") && typeof glance.what === "string" && texts(glance.shows) && textOrNull(glance.screen) && textOrNull(glance.shotPage) && textOrNull(glance.shotText) && textOrNull(glance.unshown);
        if (!ok) out.push(`${where}'s glance ${g + 1} is not a glance`);
      });
    });
  });
  const ids = raw.parts.flatMap((part) => (isRecord(part) && typeof part.id === "string" ? [part.id] : []));
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) out.push(`part ${id} is named twice`);
  return out;
}

/** Whether the record is the folder's own scenario or gate, played in this run's way, carrying its row's words. */
function identityFaults(record: FormRecord, id: string, run: RunRecord): string[] {
  const out: string[] = [];
  const of = record.kind === "gate" ? `gate ${record.id}` : `scenario ${record.number}`;
  if (/^\d{2}$/.test(id)) {
    if (record.kind !== "scenario" || record.number !== Number(id) || record.id !== id) out.push(`its record is of ${of}, not of scenario ${Number(id)}`);
  } else if (record.kind !== "gate" || record.id !== id) out.push(`its record is of ${of}, not of gate ${id}`);
  if (record.mode !== run.mode) out.push(`its record was played ${record.mode === "rig" ? "in the rig" : "live"}, and this run was played ${run.mode === "rig" ? "in the rig" : "live"}`);
  const shipped = record.parts.some((p) => p.mark === "as shipped");
  const plays = run.mode === "live" && record.kind === "scenario" && shipped ? run.repeats : 1;
  if (record.plays !== plays) out.push(plays === 1 ? `its record has ${record.plays} plays, and this run plays it once` : `its record has ${record.plays} plays, and this run played a scenario with an "as shipped" part ${plays} times`);
  if (record.kind === "scenario") {
    const row = LIST.find((r) => r.number === record.number);
    if (!row) out.push(`its record is of scenario ${record.number}, which is not one of the 68`);
    else {
      if (record.waves.length !== 1 || record.waves[0] !== row.wave) out.push(`its record gives wave ${record.waves.join(", ")}, and §18.3's table lists scenario ${row.number} at wave ${row.wave}`);
      if (record.line !== row.line) out.push(`its record gives line ${record.line}, and scenario ${row.number}'s row is at line ${row.line}`);
      for (const fault of wordFaults(row, record.parts)) out.push(`its record: ${fault}`);
    }
    for (const part of record.parts) if (part.measured !== null) out.push(`part ${part.id} is measured, and only what is seen on screen counts as proof of a scenario`);
  } else {
    const fault = gateIdFault(record.id);
    if (fault) out.push(`its record's gate ${fault.replace(/^its /, "")}`);
    if (record.waves.length === 0 || record.waves.some((w) => w > 5)) out.push("its record's waves are not waves 0 to 5");
  }
  return out;
}

/**
 * The record with every look held to the runner's own way of recording it, and to its screens as
 * they are in the folder: each fault found is added to `faults`, and each look the folder does not
 * bear out is changed to what its screens make it (never to a pass).
 */
function recheck(record: FormRecord, dir: string, files: string[], faults: string[]): FormRecord {
  const parts = record.parts.map((part) => {
    const seenPart = part.measured === null;
    const allowed = seenPart ? SEEN_OUTCOMES : MEASURED_OUTCOMES;
    if (seenPart && part.pages.length === 0) faults.push(`part ${part.id} is seen on no page`);
    if (!seenPart && part.pages.length > 0) faults.push(`part ${part.id} is measured and names pages`);
    const instances = part.instances.map((instance): Instance => {
      const where = `part ${part.id}: look ${instance.at} of play ${instance.play}`;
      const broken = (why: string): Instance => ({ ...instance, outcome: "broken", why: `its record is at fault: ${why}`, page: instance.page ?? null });
      if (instance.play > record.plays) {
        faults.push(`${where} is of a play the record does not have`);
        return broken("a play the record does not have");
      }
      if (!allowed.includes(instance.outcome)) {
        const why = `is recorded "${instance.outcome}", which the runner ${!(SEEN_OUTCOMES as readonly string[]).concat(MEASURED_OUTCOMES).includes(instance.outcome) ? "never writes" : seenPart ? "writes only for a measured part of a gate" : "writes only for a part that is seen"}`;
        faults.push(`${where} ${why}`);
        return broken(why);
      }
      if (!seenPart) {
        if (instance.glances.length > 0) faults.push(`${where} is a measured verdict that names looks on pages`);
        return instance;
      }
      if (instance.glances.length === 0) {
        if (instance.outcome !== "unlooked" && instance.outcome !== "broken") {
          const why = `is recorded "${instance.outcome}" and names no look on a page`;
          faults.push(`${where} ${why}`);
          return broken(why);
        }
        if (!instance.page || !part.pages.some((p) => pageSlug(p) === pageSlug(instance.page ?? ""))) faults.push(`${where} is recorded "${instance.outcome}" and names no page of its part it was owed on`);
        return instance;
      }
      for (const fault of coverageFaults(instance, part)) faults.push(`${where} ${fault}`);
      let missingScreen = false;
      const glances = instance.glances.map((glance): Glance => {
        if (glance.screen !== null && !files.includes(glance.screen)) {
          faults.push(`result.json names ${glance.screen}, which the folder lacks`);
          missingScreen = true;
        }
        if (glance.found !== true) return glance;
        return { ...glance, unshown: screenFault(glance, part.id, dir, files) ?? unshownBy(glance) };
      });
      const again = outcomeOf(glances, part.mark, record.mode);
      if (again.outcome === instance.outcome) return { ...instance, glances };
      if (!missingScreen) faults.push(`${where} is recorded "${instance.outcome}", and its looks make it "${again.outcome}"`);
      return { ...instance, outcome: again.outcome, why: again.why, glances };
    });
    for (let play = 1; play <= record.plays; play++) {
      const ofPlay = instances.filter((i) => i.play === play);
      if (ofPlay.length === 0) {
        faults.push(`part ${part.id} has no look in play ${play}`);
        continue;
      }
      if (!seenPart) continue;
      for (const page of part.pages) {
        const looked = ofPlay.some((i) => i.glances.some((g) => pageSlug(g.page) === pageSlug(page)) || (i.glances.length === 0 && pageSlug(i.page ?? "") === pageSlug(page)));
        if (!looked) faults.push(`part ${part.id} in play ${play} was never looked for on the ${page} page, and its record does not say so`);
      }
    }
    return { ...part, instances };
  });
  return { ...record, parts };
}

/** Where a look's glances fall short of a look the runner makes: every page it names is a page of its part, at every width that page is looked at, once. */
function coverageFaults(instance: Instance, part: PartRecord): string[] {
  const out: string[] = [];
  const byPage = new Map<string, Glance[]>();
  for (const glance of instance.glances) {
    if (!part.pages.some((p) => pageSlug(p) === pageSlug(glance.page))) {
      out.push(`looks at the ${glance.page} page, which its part is not seen on`);
      continue;
    }
    byPage.set(pageSlug(glance.page), [...(byPage.get(pageSlug(glance.page)) ?? []), glance]);
  }
  for (const glances of byPage.values()) {
    const page = glances[0]?.page ?? "";
    const wanted = widthsOf(page);
    if (wanted[0] === undefined) {
      if (glances.length !== 1) out.push(`looks at the ${page} page ${glances.length} times`);
      continue;
    }
    const have = glances.map((g) => g.width);
    const said = (widths: (number | null | undefined)[]) => widths.map((w) => (typeof w === "number" ? String(w) : "no width")).join(" and ");
    const lacking = wanted.filter((w) => !have.includes(w ?? null));
    if (lacking.length > 0) out.push(`looks at the ${page} page at ${said(have)} and not at ${said(lacking)}`);
    const twice = have.filter((w, i) => have.indexOf(w) !== i);
    if (twice.length > 0) out.push(`looks at the ${page} page at ${said(twice)} twice`);
    const other = have.filter((w) => !wanted.includes(w ?? undefined));
    if (other.length > 0) out.push(`looks at the ${page} page at ${said(other)}, a width it is not looked at`);
  }
  return out;
}

/** Why a glance's screen, as it is in the folder, cannot show its part: missing, empty, or named for another page, width or part. */
function screenFault(glance: Glance, part: string, dir: string, files: string[]): string | null {
  if (glance.screen === null) return "no screen was saved";
  if (!files.includes(glance.screen)) return `its screen ${glance.screen} is not in the folder`;
  if (statSync(join(dir, glance.screen)).size === 0) return `its screen ${glance.screen} is empty`;
  const name = parseScreen(glance.screen);
  if (!name) return `its screen ${glance.screen}'s name does not say what it shows`;
  if (name.page !== pageSlug(glance.page)) return `its screen ${glance.screen} is named for the ${name.page} page, not the ${glance.page} page`;
  if (glance.width !== null && name.width !== glance.width) return `its screen ${glance.screen} is named for ${name.width} wide, and it was looked at ${glance.width} wide`;
  if (partOfScreen(name.what, new Set([part])) === null) return `its screen ${glance.screen} is named for "${name.what}", not for this part`;
  return null;
}
