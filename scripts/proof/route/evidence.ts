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
// not blank, and the texts the check said show the part are in the page's text when it was saved. A
// part whose check found what it looks for and has no such screen is "not seen", never "pass". Reading
// a bundle back re-checks all of it against the files themselves, so a screen taken away, misnamed or
// blank, or notes naming a screen the folder lacks, is a fault of the evidence and never a pass.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { SettingsReply } from "../../../src/ui/api";
import { pageSlug, TERMINAL, WIDTHS, type Seen, type Sighting } from "./form";
import type { AgentFacts, Browser, Kept, Mode, RunFacts, Shot } from "./host";
import { LIST } from "./list";
import { describeVerdict, type FormRecord, type Glance, type Instance, type Outcome } from "./results";

/** `run.json`: what a run stood on, who started it, when, and what it was asked. */
export interface RunRecord {
  run: string;
  mode: Mode;
  by: string;
  started: string;
  /** Null while the run goes on, and in a run that broke off before its end. */
  ended: string | null;
  /** Scenario numbers as two digits and gate ids, as asked. */
  asked: string[];
  /** What was asked and not played, and why. */
  unplayed: { id: string; why: string }[];
  /** The scripts the runner found when the run began. */
  known: { scenarios: string[]; gates: string[] };
  /** How many plays an "as shipped" part gets live. */
  repeats: number;
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

/**
 * One look at a part on one page at one width: open the page, run the part's check, save a screen of
 * what shows, and keep whether that screen shows what the check saw. Nothing here waits a fixed time;
 * the host's own waits are on what shows.
 */
export async function lookAt(browser: Browser, sighting: Sighting, width: number | undefined, save: (shot: Shot) => string): Promise<Glance> {
  const page = sighting.page;
  let seen: Seen | null = null;
  let blind: string | null = null;
  try {
    await browser.open(page, width);
    try {
      seen = await sighting.check(browser);
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
    what: blind ?? seen?.what ?? "",
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

/** Why a saved screen does not show what its check saw, from what the page named itself and showed then; null when it does. */
export function unshownBy(glance: Pick<Glance, "page" | "shows" | "shotPage" | "shotText">): string | null {
  if (glance.shotPage === null || pageSlug(glance.shotPage) !== pageSlug(glance.page)) return `the screen shows the ${glance.shotPage ?? "unnamed"} page, not the ${glance.page} page`;
  if (glance.shotText === null || glance.shotText.trim() === "") return "the screen is blank";
  if (glance.shows.length === 0) return "the check named nothing on the page that shows it";
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
  return `Play ${instance.play}${instance.at > 1 ? `, look ${instance.at}` : ""}: ${OUTCOME_WORDS[instance.outcome]}: ${instance.why}. ${screens.length === 0 ? "No screen." : `Screens: ${screens.join(", ")}`}`;
}

/** A scenario's or gate's folder as read back, its record re-checked against the files. */
export interface ReadForm {
  id: string;
  /** Null when `result.json` is missing or unreadable. */
  record: FormRecord | null;
  /** Faults of the evidence, in plain words. */
  faults: string[];
}

export interface ReadBundle {
  dir: string;
  run: RunRecord;
  forms: ReadForm[];
  /** Faults of the run's own record. */
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
  const forms: ReadForm[] = [];
  const faults: string[] = [];
  const folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const id of folders) {
    if (!run.asked.includes(id)) faults.push(`a folder for ${id}, which the run did not ask for`);
    forms.push(readForm(join(dir, id), id));
  }
  for (const id of run.asked) if (!folders.includes(id) && !run.unplayed.some((u) => u.id === id)) faults.push(`${id} was asked, and neither played nor said why not`);
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
  if (!isRecord(raw.known) || !Array.isArray(raw.known.scenarios) || !Array.isArray(raw.known.gates)) out.push("the scripts the runner found");
  if (typeof raw.repeats !== "number") out.push("how many plays an \"as shipped\" part gets");
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

function readForm(dir: string, id: string): ReadForm {
  const files = filesUnder(dir);
  const faults: string[] = [];
  if (files.length === 0 && readdirSync(dir).length === 0) return { id, record: null, faults: ["the folder is empty"] };
  let record: FormRecord | null = null;
  if (!files.includes("result.json")) faults.push("result.json is missing, so nothing played here can be counted");
  else {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
      record = isFormRecord(raw) ? raw : null;
      if (record === null) faults.push("result.json is not a run's record of a form");
    } catch (error) {
      faults.push(`result.json cannot be read: ${message(error)}`);
    }
  }
  const screens = files.filter((f) => /\.(png|webp|txt)$/.test(f));
  if (screens.length === 0) faults.push("the folder holds no screen");
  const parts = new Set(record?.parts.map((p) => p.id) ?? []);
  const pages = new Set(record?.parts.flatMap((p) => p.pages.map(pageSlug)) ?? []);
  for (const file of screens) {
    const name = parseScreen(file);
    if (!name) faults.push(`${file}: its name does not say its play, the page, the width and what it shows`);
    else if (record && partOfScreen(name.what, parts) === null) faults.push(`${file}: named for "${name.what}", which is none of its parts`);
    else if (record && !pages.has(name.page)) faults.push(`${file}: named for the ${name.page} page, which none of its parts is seen on`);
    if (statSync(join(dir, file)).size === 0) faults.push(`${file} is empty`);
  }
  if (!files.includes("notes.md")) faults.push("notes.md is missing");
  else {
    const notes = readFileSync(join(dir, "notes.md"), "utf8");
    for (const named of new Set(notes.match(/play-\d{2}\/[^\s,)]+\.(?:png|webp|txt)/g) ?? [])) if (!files.includes(named)) faults.push(`notes.md names ${named}, which the folder lacks`);
  }
  if (record) record = recheck(record, dir, files, faults);
  return { id, record, faults };
}

/** The record with every instance it calls seen on screen held to its screens as they are in the folder. */
function recheck(record: FormRecord, dir: string, files: string[], faults: string[]): FormRecord {
  const parts = record.parts.map((part) => ({
    ...part,
    instances: part.instances.map((instance) => {
      if (instance.outcome !== "shown") return instance;
      for (const glance of instance.glances) {
        const why = screenFault(glance, part.id, dir, files) ?? unshownBy(glance);
        if (why !== null) {
          if (glance.screen !== null && !files.includes(glance.screen)) faults.push(`result.json names ${glance.screen}, which the folder lacks`);
          return { ...instance, outcome: "unseen" as const, why: `seen on the ${glance.page} page, and ${why}` };
        }
      }
      return instance;
    }),
  }));
  return { ...record, parts };
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

function isFormRecord(raw: unknown): raw is FormRecord {
  if (!isRecord(raw) || typeof raw.id !== "string" || (raw.kind !== "scenario" && raw.kind !== "gate") || (raw.mode !== "rig" && raw.mode !== "live")) return false;
  if (!Array.isArray(raw.waves) || typeof raw.plays !== "number" || !Array.isArray(raw.stops) || !Array.isArray(raw.parts)) return false;
  return raw.parts.every((p) => isRecord(p) && typeof p.id === "string" && typeof p.words === "string" && (p.mark === "code" || p.mark === "as shipped") && Array.isArray(p.pages) && Array.isArray(p.instances) && p.instances.every((i) => isRecord(i) && typeof i.play === "number" && typeof i.outcome === "string" && Array.isArray(i.glances)));
}
