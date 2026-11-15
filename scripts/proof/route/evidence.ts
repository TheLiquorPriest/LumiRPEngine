// The evidence bundle (PlanScenarios-1 item 4; plan §17.0 l.1751): "Only what can be seen on screen
// counts as proof of a scenario; anything internal is supporting evidence."
//
// Every run leaves one folder named for the run: `run.json` (the builds, Lumiverse's version, rig or
// bed, every agent's connection, model, reply form, effort and streaming, the settings in force as
// `GET /api/v1/settings` gave them, who started it, start and end, what was asked); and a folder per
// scenario or gate with its screens (`play-01/world-1440-four-values.png`: the play, the page, the
// width, the part it shows), `result.json`, `notes.md` saying part by part in the plan's words which
// screen shows it, and `internal/` for route answers, rows and logs, marked as supporting evidence.
// A scenario played in stages has a folder for each stage played inside its own (`40/before/`), each
// holding what a scenario's folder holds; its folder holds nothing else (`folderOf`, `form.ts`).
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
// evidence fails the result it concerns: it is never a pass. A scenario played in stages is read back
// stage by stage and has one result over all of them: every stage the run asked must be in its own
// folder, every part in exactly one stage, and the row's words carried by its stages together.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { SettingsReply } from "../../../src/shared/api";
import { wordFaults } from "./check";
import { folderOf, gateIdFault, isStageName, pageSlug, parseStageId, scenarioId, stageId, TERMINAL, WIDTHS, type Seen, type Sighting } from "./form";
import type { AgentFacts, Browser, Kept, Mode, NamesFacts, RunFacts, Shot } from "./host";
import { LIST } from "./list";
import { describeVerdict, formResult, measuredOutcomes, outcomeOf, partTrial, restsOnGuidance, SEEN_OUTCOMES, wholeResult, type FormRecord, type FormResult, type Glance, type Instance, type Outcome, type PartRecord, type PlayStanding } from "./results";

/** `run.json`: what a run stood on, who started it, when, and what it was asked. */
export interface RunRecord {
  run: string;
  /**
   * Which run this is, as no other run is: a random text made when the run's folder was made. A run's
   * name is its mode and its start to the second, so two runs started in one second into two folders
   * share it; every record of a form carries its run's nonce, and a folder moved from another run's
   * bundle is told by it. A `run.json` without one is not one the runner wrote.
   */
  nonce?: string;
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
  /** Whether the run gives a verdict or is a trial, and why: its one home. A record without it gives no verdict. */
  standing?: Standing;
  rpe: { commit: string; dirty: boolean };
  rph: { commit: string; pin: string | null; pinned: boolean };
  lumiverse: { version: string };
  browser: { name: string; version: string };
  agents: AgentFacts[];
  settings: SettingsReply;
}

/**
 * What a run's, or a play's, standing was worked out from: the shipped tree the server ran and the
 * build's, by hash, the paths at which they differ, and each layer of the user's own with the
 * guidance it holds, and the names its configs switch. `files` and `names` are what the runner always
 * writes: a record without either gives no account of what it concerns, and is a trial.
 */
export interface StandingFrom {
  served: string;
  build: string;
  changed: string[];
  layers: { level: string; hash: string; guidance: string[] }[];
  /** How many files the served tree and the build's hold: a tree with none is no account of the guidance, as an empty folder read is no proof there is none. */
  files?: { served: number; build: number };
  /** The names the levels' configs switch off, layer or add (`NamesFacts`): they are settings, so the layers' guidance cannot show them. */
  names?: NamesFacts;
}

/**
 * What one play's own chat stood on, asked of the host when its footing was ready and again when its
 * form had ended (`Session.guidance`), in `run.json`'s `standing.plays`, which is a standing's one
 * home: its facts are held there, and worked out again whenever the bundle is read.
 */
export interface PlayGuidance {
  /** What the run asked: a scenario's number, a gate's id, or a stage `<number>:<stage>`. */
  id: string;
  play: number;
  /** Null when the host gave no account, or one that is not one. */
  before: StandingFrom | null;
  after: StandingFrom | null;
  /** The form's word that it changed the guidance on purpose (`Play.declareGuidanceChange`); null when it said nothing. */
  declared: string | null;
  /** Whether a part of the play rests on guidance (`restsOnGuidance`): only then does a declared change make the play a trial. */
  rests: boolean;
}

/** Whether a run gives a verdict or is a trial, and why (plan §17: a verdict comes only from shipped guidance on a clean build). */
export interface Standing {
  is: "verdict" | "trial";
  /** Why it is a trial; empty for a verdict. */
  why: string[];
  /** Null when the host gave no account of the guidance the run stood on when it began. */
  from: StandingFrom | null;
  /** What each play's own chat stood on, play by play, as the run went. */
  plays?: PlayGuidance[];
}

/** Whether RPH as installed is the commit RPE pins: the one rule, worked out when a run is made and again whenever its bundle is read. Seven characters is the shortest form git writes a commit in, and either may be the shorter. */
export function isPinned(commit: string, pin: string | null): boolean {
  return pin !== null && Math.min(pin.length, commit.length) >= 7 && (pin.startsWith(commit) || commit.startsWith(pin));
}

/** Every name a `NamesFacts` holds, as the words a run's reasons give: `off: TURN (global)`, `layered: AGENTS`, `added: notes.md`. */
function namesOf(names: NamesFacts): string[] {
  return [...names.off.map((o) => `off: ${o.name}${o.levels.length > 0 ? ` (${o.levels.join(", ")})` : ""}`), ...names.layered.map((n) => `layered: ${n}`), ...names.added.map((n) => `added: ${n}`)];
}

/**
 * Why what a run or a play stood on is not the shipped guidance as shipped, in plain words; empty
 * when it is. `stood` says whose account it is. A missing account, an empty tree, and names the host
 * did not give each make a trial: nothing shows the agents ran under the shipped guidance.
 */
export function reasonsOf(from: StandingFrom | null, stood: string): string[] {
  if (from === null) return [`the host gave no account of the guidance ${stood} (the shipped tree it served, the build's own, the layers of the user's own, the names its configs switch), so nothing shows its agents ran under the shipped guidance`];
  const why: string[] = [];
  const empty = from.files !== undefined && (from.files.served === 0 || from.files.build === 0);
  if (!from.files) why.push(`the host did not say how many files the shipped trees ${stood} hold, so an empty tree cannot be told from a full one`);
  else if (empty) why.push(`the shipped tree ${from.files.served === 0 ? "the server ran" : "the build holds"} has no file, which is no account of the guidance ${stood}`);
  if (!empty && (from.served !== from.build || from.changed.length > 0)) why.push(`the shipped tree the server ran is not the build's: ${from.changed.length} ${from.changed.length === 1 ? "path differs" : "paths differ"}${from.changed.length > 0 ? ` (${from.changed.join(", ")})` : ""}`);
  for (const layer of from.layers) if (layer.guidance.length > 0) why.push(`the ${layer.level} layer holds guidance of its own, so its agents did not run under the shipped guidance: ${layer.guidance.join(", ")}`);
  if (!from.names) why.push(`the host did not say which names the configs ${stood} switch off, layer or add, so a file switched off cannot be told from one in force`);
  else {
    const named = namesOf(from.names);
    if (named.length > 0) why.push(`a config switches shipped guidance: ${named.join(", ")}, so its agents did not run under the shipped guidance as shipped`);
  }
  return why;
}

/** Where two accounts of the guidance differ, by what differs; empty when they agree. */
function changesOf(a: StandingFrom, b: StandingFrom): string[] {
  const out: string[] = [];
  if (a.served !== b.served) out.push("the shipped tree its chat was served");
  if (a.build !== b.build) out.push("the build's shipped tree");
  const hashes = (from: StandingFrom, level: string) => from.layers.filter((l) => l.level === level).map((l) => l.hash).sort().join(",");
  for (const level of new Set([...a.layers, ...b.layers].map((l) => l.level))) if (hashes(a, level) !== hashes(b, level)) out.push(`the ${level} layer`);
  const names = (from: StandingFrom) => (from.names ? namesOf(from.names).sort().join("\n") : null);
  if (names(a) !== names(b)) out.push("the names its configs switch");
  return out;
}

/**
 * Why one play is a trial for what its own chat stood on: no account, or an account of guidance that
 * is not the shipped guidance, when its footing was ready; and the same when its form had ended,
 * where the guidance changed during the play. A change its form did not declare is a reason in
 * itself. A change it declared is its own act (a gate that cuts every shipped file to a stub, a
 * scenario that switches one off) and is no reason for a play whose parts do not rest on guidance;
 * for a play with a part that rests on guidance, the declared change is the reason, since that part
 * is then not under the shipped guidance.
 */
export function playReasons(play: PlayGuidance): string[] {
  const out = [...reasonsOf(play.before, "the play's chat stood on when its footing was ready")];
  if (play.after === null) out.push("the host gave no account of the guidance the play's chat stood on when its form had ended, so a change the play made cannot be seen");
  else {
    const moved = play.before === null ? [] : changesOf(play.before, play.after);
    if (play.declared === null) {
      out.push(...reasonsOf(play.after, "the play's chat stood on when its form had ended"));
      if (moved.length > 0) out.push(`its guidance changed during the play (${moved.join("; ")}) and its form did not say so`);
    } else if (moved.length > 0 && play.rests) out.push(`its form changed the guidance on purpose (${play.declared}), so what rests on guidance in it is not under the shipped guidance as shipped`);
  }
  return [...new Set(out)];
}

/** What makes a run a trial before any play: RPE's tree changed, RPH not the commit RPE pins, and the guidance it stood on when it began. */
function startReasons(rpe: RunRecord["rpe"], rph: RunRecord["rph"], from: StandingFrom | null): string[] {
  const why: string[] = [];
  if (rpe.dirty) why.push(`RPE's tree held changes beyond its commit ${rpe.commit}`);
  if (!rph.pinned) why.push(`RPH as installed (${rph.commit}) is not the commit RPE pins (${rph.pin ?? "none"})`);
  return [...why, ...reasonsOf(from, "the run stood on")];
}

/**
 * A run's standing from what it stood on and what each of its plays' chats stood on, the same way
 * when the run is made and when its bundle is read back. A verdict needs all of it: RPE's tree at its
 * commit, RPH at the commit RPE pins, the shipped tree the server ran equal to the build's and not
 * empty, no layer of the user's own holding guidance, no config switching a name, and every play's
 * own chat the same (`playReasons`). A fact missing is a trial, with that as its why.
 */
export function standingOf(rpe: RunRecord["rpe"], rph: RunRecord["rph"], from: StandingFrom | null, plays: readonly PlayGuidance[] = []): Standing {
  const start = startReasons(rpe, rph, from);
  const why = [...start];
  const grouped = new Map<string, { id: string; reason: string; plays: number[] }>();
  for (const play of plays)
    for (const reason of playReasons(play)) {
      if (start.includes(reason)) continue;
      const held = grouped.get(`${play.id}\0${reason}`);
      if (held) held.plays.push(play.play);
      else grouped.set(`${play.id}\0${reason}`, { id: play.id, reason, plays: [play.play] });
    }
  for (const { id, reason, plays: at } of grouped.values()) why.push(`${id}, play ${at.join(", ")}: ${reason}`);
  return { is: why.length === 0 ? "verdict" : "trial", why, from, ...(plays.length > 0 ? { plays: [...plays] } : {}) };
}

/** One play's standing: the run's start reasons and the play's own. A play that is a trial gives no verdict on what rests on guidance. */
export function standingOfPlay(rpe: RunRecord["rpe"], rph: RunRecord["rph"], from: StandingFrom | null, play: PlayGuidance): PlayStanding {
  const why = [...new Set([...startReasons(rpe, rph, from), ...playReasons(play)])];
  return { play: play.play, is: why.length === 0 ? "verdict" : "trial", why };
}

/** The run's RPH as its commit and pin make it, never as its record says. */
function rphOf(run: RunRecord): RunRecord["rph"] {
  return { ...run.rph, pinned: isPinned(run.rph.commit, run.rph.pin) };
}

/** The standing a bundle gives, worked out again from what its run.json says the run and its plays stood on, whether RPH is the pinned commit among it, never taken on its word; a run.json without one gives no verdict. */
export function standingOfRun(run: RunRecord): { is: "verdict" | "trial"; why: string[] } {
  if (!run.standing) return { is: "trial", why: ["run.json does not give the run's standing, so it gives no verdict"] };
  const { is, why } = standingOf(run.rpe, rphOf(run), run.standing.from, run.standing.plays);
  return { is, why };
}

/** What one play of a run stood on, worked out again from run.json: a play it holds no account of is a trial. */
export function standingOfRunPlay(run: RunRecord, id: string, play: number): PlayStanding {
  const held = run.standing?.plays?.find((p) => p.id === id && p.play === play);
  if (!run.standing) return { play, is: "trial", why: ["run.json does not give the run's standing, so it gives no verdict"] };
  if (!held) return { play, is: "trial", why: [`run.json gives no account of the guidance play ${play} of ${id} stood on, so it gives no verdict`] };
  return standingOfPlay(run.rpe, rphOf(run), run.standing.from, held);
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
  private constructor(
    readonly dir: string,
    /** The run's nonce: no other run has it, though another may share the run's name (`RunRecord.nonce`). */
    readonly nonce: string,
  ) {}

  /** A new folder under `out`, named for the run: its mode and when it started, with a nonce of its own beside the name. */
  static open(out: string, mode: Mode, now: Date): Bundle {
    mkdirSync(out, { recursive: true });
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    let name = `${mode}-${stamp}`;
    for (let n = 2; existsSync(join(out, name)); n++) name = `${mode}-${stamp}-${n}`;
    mkdirSync(join(out, name));
    return new Bundle(join(out, name), randomUUID());
  }

  get run(): string {
    return this.dir.split(/[\\/]/).pop() ?? this.dir;
  }

  writeRun(record: RunRecord): void {
    writeFileSync(join(this.dir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  /** The folder of what the run asked by `id` (a stage's in its scenario's, `folderOf`), made with its `internal/` and the line that marks what is in there. */
  formDir(id: string): string {
    const dir = join(this.dir, folderOf(id));
    mkdirSync(join(dir, "internal"), { recursive: true });
    writeFileSync(join(dir, "internal", SUPPORTING), "Supporting evidence only: route answers, rows and logs kept beside the screens. Nothing here counts as proof of a scenario (plan §17.0).\n");
    return dir;
  }

  /** Saves a screen in the play's folder, named for the page it showed, its width and the part; returns its name from the form's folder (a stage's own folder for a stage). */
  saveScreen(id: string, play: number, page: string, part: string, shot: Shot): string {
    const at = join(this.dir, folderOf(id));
    const folder = `play-${String(play).padStart(2, "0")}`;
    mkdirSync(join(at, folder), { recursive: true });
    const base = `${pageSlug(page)}-${shot.width}-${part}`;
    let name = `${folder}/${base}.${shot.format}`;
    for (let n = 2; existsSync(join(at, name)); n++) name = `${folder}/${base}-${n}.${shot.format}`;
    writeFileSync(join(at, name), shot.image);
    return name;
  }

  /** Supporting evidence of one play, in `internal/`. */
  keep(id: string, play: number, name: string, data: Kept): void {
    const dir = join(this.dir, folderOf(id), "internal", `play-${String(play).padStart(2, "0")}`);
    mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[\\/]+/g, "-");
    if (typeof data === "string") writeFileSync(join(dir, /\.\w+$/.test(safe) ? safe : `${safe}.txt`), data);
    else if (data instanceof Uint8Array) writeFileSync(join(dir, safe), data);
    else writeFileSync(join(dir, /\.\w+$/.test(safe) ? safe : `${safe}.json`), `${JSON.stringify(data, null, 2)}\n`);
  }

  writeResult(record: FormRecord): void {
    writeFileSync(join(this.dir, folderOf(askedIdOf(record)), "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  writeNotes(record: FormRecord): void {
    writeFileSync(join(this.dir, folderOf(askedIdOf(record)), "notes.md"), notesOf(record, this.run));
  }
}

/** The id a run asked a record's form by: the scenario's number or the gate's id, or for a stage `<number>:<stage>`. */
export function askedIdOf(record: Pick<FormRecord, "id" | "stage">): string {
  return record.stage ? stageId(record.id, record.stage.name) : record.id;
}

/** The run's record from the host's facts, its standing worked out from what the host said the run stood on (none said: a trial). RPH is the pinned commit by `isPinned`. */
export function runRecord(facts: RunFacts, fields: Omit<RunRecord, "rpe" | "rph" | "lumiverse" | "browser" | "agents" | "settings" | "standing">, from: StandingFrom | null = null): RunRecord {
  const { commit, pin } = facts.rph;
  const rph = { commit, pin, pinned: isPinned(commit, pin) };
  return { ...fields, standing: standingOf(facts.rpe, rph, from), rpe: facts.rpe, rph, lumiverse: facts.lumiverse, browser: facts.browser, agents: facts.agents, settings: facts.settings };
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
    sha256: screen === null || !shot ? null : digestOf(shot.image),
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
  trial: "trial, no verdict",
  "not judged": "not judged",
};

/** A form's heading: its number and the plan's own scenario, or the gate's id; a stage's adds its name. */
export function titleOf(record: Pick<FormRecord, "kind" | "number" | "id" | "stage">): string {
  if (record.kind === "gate") return `Gate ${record.id}`;
  return `Scenario ${record.number}: ${LIST.find((row) => row.number === record.number)?.title ?? "not in the list of the 68"}${record.stage ? `, stage ${record.stage.name}` : ""}`;
}

/** `notes.md`: part by part, in the plan's words, what came of every look and which screens show it; a play that was a trial is named, and what rests on guidance in it is figures only. */
export function notesOf(record: FormRecord, run: string): string {
  const where = record.mode === "rig" ? "in the rig" : "live on the test bed";
  const lines = [
    `# ${titleOf(record)}`,
    "",
    `${record.line ? `Plan line ${record.line}. ` : ""}${record.waves.length === 1 ? `Wave ${record.waves[0]}` : `Waves ${record.waves.join(", ")}`}. Played ${where}, ${record.plays === 1 ? "once" : `${record.plays} times, each on a fresh chat`}, in run ${run}.`,
    ...(record.stage ? [`Played in stages (${record.stage.of.join(", ")}): this is stage ${record.stage.name}, its parts alone, each stage in its own folder.`] : []),
    "Only the screens named below count as proof (plan §17.0). `internal/` holds route answers, rows and logs: supporting evidence only.",
  ];
  for (const stop of record.stops) lines.push("", `Play ${stop.play} stopped: ${stop.why}.`);
  for (const standing of record.standings ?? []) if (standing.is === "trial") lines.push("", `Play ${standing.play} is a trial, and gives no verdict on what rests on guidance: ${standing.why.join("; ")}.`);
  for (const part of record.parts) {
    lines.push("", `## "${part.words}" (${part.mark})`, "", describeVerdict(part, record.mode, partTrial(record, part))[0] ?? "");
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
  /** The record as re-checked against the folder; null when `result.json` is missing, unreadable or not a record, and for a scenario played in stages. */
  record: FormRecord | null;
  /** For a scenario played in stages: each of its stages, in its order, played or not; null for one played whole and for a gate. */
  stages: ReadStage[] | null;
  /** Faults of the evidence, in plain words; a stage's are given with its name. */
  faults: string[];
  /** Its result: `failed` whenever the folder has a fault of the evidence or no record, otherwise the record's own; for a scenario played in stages, one over all of them. */
  result: FormResult;
}

/** One stage of a scenario played in stages, as read back from its own folder. */
export interface ReadStage {
  name: string;
  /** Its record as re-checked against its folder; null when it was not played, or its record is missing, unreadable or not a record. */
  record: FormRecord | null;
  /** Faults of the evidence in its folder. */
  faults: string[];
  /** Its own result; null when it was not played. */
  result: FormResult | null;
  /** For a stage not played: why, as the run said, or that the run did not ask for it. */
  why: string | null;
}

export interface ReadBundle {
  dir: string;
  run: RunRecord;
  forms: ReadForm[];
  /** Faults of the run's own record, and what went wrong in the run outside any form. */
  faults: string[];
  /** The run's standing, worked out again from what run.json says it stood on (`standingOfRun`). */
  standing: { is: "verdict" | "trial"; why: string[] };
}

/** Reads a bundle back. Refused without a whole `run.json`: what is not tied to its build, its settings and who ran it proves nothing. Every fact is worked out again from what the files hold, and none is taken on a record's word. */
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
  const standing = standingOfRun(run);
  const said = run.standing;
  const pinned = isPinned(run.rph.commit, run.rph.pin);
  if (run.rph.pinned !== pinned) faults.push(`run.json says RPH ${run.rph.pinned ? "is" : "is not"} the commit RPE pins, and its commit ${run.rph.commit} and pin ${run.rph.pin ?? "none"} make it ${pinned ? "the pinned commit" : "not the pinned commit"}`);
  if (said && (said.is !== standing.is || said.why.join("\n") !== standing.why.join("\n"))) faults.push(said.is === "verdict" ? `run.json says the run gives a verdict, and what it stood on makes it a trial: ${standing.why.join("; ")}` : `run.json gives the run's standing as ${said.is} (${said.why.join("; ") || "no why"}), and what it stood on makes it ${standing.is === "verdict" ? "a verdict" : `a trial (${standing.why.join("; ")})`}`);
  const folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const forms = folders.map((id) => readForm(join(dir, id), id, run));
  const seen = new Set<string>();
  for (const id of run.asked) {
    if (seen.has(id)) faults.push(`${id} is asked twice`);
    seen.add(id);
    const played = folders.includes(id) || (parseStageId(id) !== null && isFolder(join(dir, folderOf(id))));
    const unplayed = run.unplayed.some((u) => u.id === id);
    if (!played && !unplayed) faults.push(`${id} was asked, and neither played nor said why not`);
    if (played && unplayed) faults.push(`${id} is both played and said not to be`);
  }
  return { dir, run, forms, faults, standing };
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
  if (!text(raw.nonce)) out.push("the run's nonce, which ties each record to its own run");
  if (!isRecord(raw.rph) || typeof raw.rph.pinned !== "boolean") out.push("whether RPH is the pinned commit");
  if (raw.standing !== undefined && !isStanding(raw.standing)) out.push("the run's standing as the runner writes it");
  return out;
}

function isFromOf(from: unknown): boolean {
  if (from === null) return true;
  const texts = (list: unknown) => Array.isArray(list) && list.every((t) => typeof t === "string");
  const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!isRecord(from) || typeof from.served !== "string" || typeof from.build !== "string" || !texts(from.changed) || !Array.isArray(from.layers)) return false;
  if (!from.layers.every((l) => isRecord(l) && typeof l.level === "string" && typeof l.hash === "string" && texts(l.guidance))) return false;
  if (from.files !== undefined && !(isRecord(from.files) && count(from.files.served) && count(from.files.build))) return false;
  const names = from.names;
  return names === undefined || (isRecord(names) && texts(names.layered) && texts(names.added) && Array.isArray(names.off) && names.off.every((o) => isRecord(o) && typeof o.name === "string" && texts(o.levels)));
}

function isStanding(value: unknown): boolean {
  if (!isRecord(value) || (value.is !== "verdict" && value.is !== "trial") || !Array.isArray(value.why) || !value.why.every((w) => typeof w === "string")) return false;
  if (value.plays !== undefined && !(Array.isArray(value.plays) && value.plays.every((p) => isRecord(p) && typeof p.id === "string" && p.id !== "" && typeof p.play === "number" && Number.isInteger(p.play) && p.play >= 1 && isFromOf(p.before) && isFromOf(p.after) && (p.declared === null || typeof p.declared === "string") && typeof p.rests === "boolean"))) return false;
  return isFromOf(value.from);
}

/** Every file under a folder, `internal/` left out, from the folder. */
function filesUnder(dir: string, under = ""): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) => {
    const path = under === "" ? entry.name : `${under}/${entry.name}`;
    if (entry.isDirectory()) return path === "internal" ? [] : filesUnder(dir, path);
    return entry.isFile() ? [path] : [];
  });
}

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

const SCREEN_FILE = /\.(png|webp|txt)$/;

/** A folder at the top of a bundle: a scenario played whole or a gate, or a scenario played in stages, read stage by stage. */
function readForm(dir: string, id: string, run: RunRecord): ReadForm {
  if (isStaged(dir, id, run)) return readStaged(dir, id, run);
  const { record, faults } = readFolder(dir, id, run, null);
  return { id, record, stages: null, faults, result: record === null || faults.length > 0 ? "failed" : formResult(record) };
}

/**
 * Whether a scenario's folder is one played in stages: the run asked for its stages, or it holds
 * folders only a stage's can be and no record of its own. A folder that holds its own `result.json` is
 * a scenario played whole, whatever else the run asked of the number: a stage asked of a scenario that
 * has none was refused, and the run's `unplayed` says so.
 */
function isStaged(dir: string, id: string, run: RunRecord): boolean {
  if (!/^\d{2}$/.test(id) || existsSync(join(dir, "result.json"))) return false;
  if ([...run.asked, ...run.unplayed.map((u) => u.id)].some((asked) => parseStageId(asked)?.scenario === id)) return true;
  const inner = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "internal" && !/^play-\d+$/.test(entry.name));
  return inner.length > 0;
}

/**
 * A scenario played in stages, read back: each stage's own folder as a form's folder is read, then the
 * scenario whole. Its stages are the ones its records name, and the records must agree; every stage
 * must be in its own folder; every part is in exactly one stage; and once every stage has its record,
 * the row's words must be carried by its stages together. One result over all of them.
 */
function readStaged(dir: string, id: string, run: RunRecord): ReadForm {
  const faults = folderNameFaults(id);
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) if (!entry.isDirectory()) faults.push(`${entry.name}: the folder of a scenario played in stages holds its stages' folders and nothing else`);
  const read = new Map(entries.filter((entry) => entry.isDirectory()).map((entry) => [entry.name, readFolder(join(dir, entry.name), id, run, entry.name)] as const));
  const askedStages = [...run.asked, ...run.unplayed.map((u) => u.id)].flatMap((asked) => {
    const stage = parseStageId(asked);
    return stage && stage.scenario === id ? [stage.stage] : [];
  });
  const lists = [...read.values()].flatMap((folder) => (folder.record?.stage ? [folder.record.stage.of] : []));
  const of = lists[0] ?? [...new Set([...askedStages, ...read.keys()])];
  if (lists.some((list) => list.join(", ") !== of.join(", "))) faults.push(`its stages' records do not agree on its stages: ${[...new Set(lists.map((list) => list.join(", ")))].map((list) => `(${list})`).join(" and ")}`);
  if (lists.length > 0 && (of.length < 2 || new Set(of).size !== of.length || !of.every(isStageName))) faults.push(`its records name its stages as ${of.join(", ")}: a scenario played in stages has two or more, each named once`);
  for (const name of read.keys()) if (!of.includes(name)) faults.push(`${name}/: a folder for a stage scenario ${Number(id)} does not have (its stages are ${of.join(", ")})`);
  // A stage asked of a scenario that has none is a fault only where the run did not say it was refused: its `unplayed` is the run's own word, and the scenario's own stages stand on their own.
  for (const name of new Set(askedStages)) if (!of.includes(name) && !run.unplayed.some((u) => u.id === stageId(id, name))) faults.push(`the run asked for its stage ${name}, which it does not have (its stages are ${of.join(", ")})`);
  const stages: ReadStage[] = of.map((name) => {
    const folder = read.get(name);
    if (folder) return { name, record: folder.record, faults: folder.faults, result: folder.record === null || folder.faults.length > 0 ? "failed" : formResult(folder.record), why: null };
    const asked = stageId(id, name);
    const unplayed = run.unplayed.find((u) => u.id === asked);
    // A stage the run asked for and neither played nor said why not is a fault; one it said why of, or never asked, leaves the scenario not played whole.
    if (!unplayed && run.asked.includes(asked)) faults.push(`stage ${name} was asked, and neither played nor said why not`);
    return { name, record: null, faults: [], result: null, why: unplayed?.why ?? (run.asked.includes(asked) ? "asked, and the run did not say why it was not played" : "not asked in this run") };
  });
  const holders = new Map<string, string[]>();
  for (const stage of stages) for (const part of stage.record?.parts ?? []) holders.set(part.id, [...(holders.get(part.id) ?? []), stage.name]);
  for (const [part, names] of holders) if (names.length > 1) faults.push(`part ${part} is in stages ${names.join(" and ")}: every part is in exactly one stage`);
  const records = stages.map((stage) => stage.record);
  const row = LIST.find((r) => scenarioId(r.number) === id);
  if (row && records.every((record): record is FormRecord => record !== null)) for (const fault of wordFaults(row, records.flatMap((record) => record.parts))) faults.push(`its stages' records together: ${fault}`);
  const all = [...new Set([...faults, ...stages.flatMap((stage) => stage.faults.map((fault) => `stage ${stage.name}: ${fault}`))])];
  return { id, record: null, stages, faults: all, result: all.length > 0 ? "failed" : wholeResult(stages.map((stage) => stage.result)) };
}

/** Why a folder's name at the top of a bundle is not one a form's evidence is kept under. */
function folderNameFaults(id: string): string[] {
  if (!/^\d{2}$/.test(id)) {
    const fault = gateIdFault(id);
    return fault ? [`its folder's name is neither one of the 68 nor a gate's id: ${fault}`] : [];
  }
  return LIST.some((row) => scenarioId(row.number) === id) ? [] : [`its folder is named for scenario ${Number(id)}, which is not one of the 68`];
}

/** One folder of evidence, a form's or one stage's: its record re-checked against its files, and every fault of the evidence found in it. */
function readFolder(dir: string, id: string, run: RunRecord, stage: string | null): { record: FormRecord | null; faults: string[] } {
  const files = filesUnder(dir);
  const faults: string[] = [];
  if (!run.asked.includes(stage === null ? id : stageId(id, stage))) faults.push("the run did not ask for it");
  if (stage === null) faults.push(...folderNameFaults(id));
  if (files.length === 0 && readdirSync(dir).length === 0) return { record: null, faults: [...new Set([...faults, "the folder is empty"])] };
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
  const digests = new Map(record?.parts.flatMap((p) => p.instances.flatMap((i) => i.glances.flatMap((g) => (g.screen ? [[g.screen, g.sha256 ?? null] as const] : [])))) ?? []);
  for (const file of screens) {
    const name = parseScreen(file);
    if (!name) faults.push(`${file}: its name does not say its play, the page, the width and what it shows`);
    else if (record && partOfScreen(name.what, parts) === null) faults.push(`${file}: named for "${name.what}", which is none of its parts`);
    else if (record && !pages.has(name.page)) faults.push(`${file}: named for the ${name.page} page, which none of its parts is seen on`);
    else if (record && !named.has(file)) faults.push(`${file}: no look in result.json names it`);
    if (statSync(join(dir, file)).size === 0) faults.push(`${file} is empty`);
    // The bytes of each screen a look names are the ones the run saved: a screen changed afterwards proves nothing.
    else if (record && named.has(file)) {
      const digest = digests.get(file);
      if (!digest) faults.push(`${file}: result.json gives no digest of it, so nothing shows it is the screen the run saved`);
      else if (digest !== digestOf(readFileSync(join(dir, file)))) faults.push(`${file}: its bytes are not the screen the run saved (their digest is not result.json's)`);
    }
  }
  if (!files.includes("notes.md")) faults.push("notes.md is missing");
  else {
    const text = readFileSync(join(dir, "notes.md"), "utf8");
    const notes = new Set(text.match(/play-\d{2}\/[^\s,)]+\.(?:png|webp|txt)/g) ?? []);
    for (const screen of notes) if (!files.includes(screen)) faults.push(`notes.md names ${screen}, which the folder lacks`);
    for (const screen of notes) if (record && !named.has(screen)) faults.push(`notes.md names ${screen}, which no look in result.json names`);
    for (const screen of named) if (!notes.has(screen)) faults.push(`notes.md does not name ${screen}, which result.json names`);
    // The notes say what the record says, word for word, for this run: notes taken from another run or rewritten are a fault.
    if (record) {
      const said = notesOf(record, run.run).split("\n");
      const lines = text.split("\n");
      const at = lines.findIndex((line, i) => line !== said[i]);
      if (at >= 0 || lines.length !== said.length) {
        const n = at >= 0 ? at : Math.min(lines.length, said.length);
        faults.push(`notes.md is not what its record says (notesOf): the first line that differs is ${n + 1}: "${lines[n] ?? ""}"`);
      }
    }
  }
  if (record) {
    faults.push(...identityFaults(record, id, run, stage));
    // Each play's standing is worked out again from run.json, and the record's word for it is held to that: a record that calls a play a verdict where the run's account makes it a trial changes nothing.
    const askedId = stage === null ? id : stageId(id, stage);
    const worked = Array.from({ length: record.plays }, (_, n) => standingOfRunPlay(run, askedId, n + 1));
    const said = record.standings ?? [];
    for (const standing of worked) {
      const held = said.find((s) => s.play === standing.play);
      if (!held) faults.push(`its record gives no standing for play ${standing.play}, which run.json's account of the play makes ${standing.is === "trial" ? "a trial" : "a verdict"}`);
      else if (held.is !== standing.is || held.why.join("\n") !== standing.why.join("\n")) faults.push(`its record gives play ${standing.play}'s standing as ${held.is}${held.why.length > 0 ? ` (${held.why.join("; ")})` : ""}, and run.json's account of the play makes it ${standing.is === "trial" ? `a trial (${standing.why.join("; ")})` : "a verdict"}`);
    }
    for (const held of said) if (held.play < 1 || held.play > record.plays) faults.push(`its record gives a standing for play ${held.play}, which it does not have`);
    record = recheck({ ...record, standings: worked }, dir, files, faults);
  }
  return { record, faults: [...new Set(faults)] };
}

/** Why a value is not a record the runner writes, at the level of its fields; empty when it is one. */
function shapeFaults(raw: unknown): string[] {
  if (!isRecord(raw)) return ["it is not an object"];
  const out: string[] = [];
  const texts = (value: unknown) => Array.isArray(value) && value.every((v) => typeof v === "string");
  const textOrNull = (value: unknown) => value === null || typeof value === "string";
  const whole = (value: unknown, least: number) => typeof value === "number" && Number.isInteger(value) && value >= least;
  if (typeof raw.id !== "string" || raw.id === "") out.push("it has no id");
  if (raw.run !== undefined && typeof raw.run !== "string") out.push("its run is not a run's name");
  if (raw.nonce !== undefined && typeof raw.nonce !== "string") out.push("its nonce is not a nonce");
  if (raw.kind !== "scenario" && raw.kind !== "gate") out.push("it is neither a scenario's nor a gate's");
  if (raw.mode !== "rig" && raw.mode !== "live") out.push("it was played neither in the rig nor live");
  if (!(raw.number === null || whole(raw.number, 1))) out.push("its number is not a number");
  if (!Array.isArray(raw.waves) || !raw.waves.every((w) => whole(w, 0))) out.push("its waves are not waves");
  if (!(raw.line === null || whole(raw.line, 1))) out.push("its line is not a line");
  if (!whole(raw.plays, 1)) out.push("its plays are not a count");
  if (!Array.isArray(raw.stops) || !raw.stops.every((s) => isRecord(s) && whole(s.play, 1) && typeof s.why === "string")) out.push("its stops are not stops");
  if (raw.stage !== undefined && !(isRecord(raw.stage) && isStageName(raw.stage.name) && Array.isArray(raw.stage.of) && raw.stage.of.every(isStageName))) out.push("its stage is not a stage of a scenario");
  if (raw.standings !== undefined && !(Array.isArray(raw.standings) && raw.standings.every((s) => isRecord(s) && whole(s.play, 1) && (s.is === "verdict" || s.is === "trial") && texts(s.why)))) out.push("its standings are not the standing of each play");
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
        const ok = isRecord(glance) && typeof glance.page === "string" && (glance.width === null || typeof glance.width === "number") && (glance.found === null || typeof glance.found === "boolean") && typeof glance.what === "string" && texts(glance.shows) && textOrNull(glance.screen) && (glance.sha256 === undefined || textOrNull(glance.sha256)) && textOrNull(glance.shotPage) && textOrNull(glance.shotText) && textOrNull(glance.unshown);
        if (!ok) out.push(`${where}'s glance ${g + 1} is not a glance`);
      });
    });
  });
  const ids = raw.parts.flatMap((part) => (isRecord(part) && typeof part.id === "string" ? [part.id] : []));
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) out.push(`part ${id} is named twice`);
  return out;
}

/** Whether the record is the folder's own scenario, stage or gate, played in this run's way, carrying its row's words (a stage's are checked with its scenario's other stages). */
function identityFaults(record: FormRecord, id: string, run: RunRecord, stage: string | null): string[] {
  const out: string[] = [];
  const of = record.kind === "gate" ? `gate ${record.id}` : `scenario ${record.number}`;
  if (/^\d{2}$/.test(id)) {
    if (record.kind !== "scenario" || record.number !== Number(id) || record.id !== id) out.push(`its record is of ${of}, not of scenario ${Number(id)}`);
  } else if (record.kind !== "gate" || record.id !== id) out.push(`its record is of ${of}, not of gate ${id}`);
  if (stage !== null && record.stage?.name !== stage) out.push(`its record is of ${record.stage ? `stage ${record.stage.name}` : "a scenario played whole"}, not of stage ${stage}`);
  if (stage === null && record.stage) out.push(`its record is of stage ${record.stage.name}, and its folder is that of a form played whole`);
  if (record.run !== run.run) out.push(record.run === undefined ? "its record names no run, so nothing ties it to this run" : `its record is of run ${record.run}, and this bundle is run ${run.run}`);
  else if (record.nonce !== run.nonce) out.push(record.nonce === undefined ? "its record carries no nonce, so nothing ties it to this very run: two runs can share a name" : "its record carries another run's nonce: it comes from another run that has this run's name");
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
      if (stage === null) for (const fault of wordFaults(row, record.parts)) out.push(`its record: ${fault}`);
    }
    for (const part of record.parts) if (part.measured !== null) out.push(`part ${part.id} is measured, and only what is seen on screen counts as proof of a scenario`);
    for (const part of record.parts) if (part.wants !== null) out.push(`part ${part.id} asks a share, and a scenario's rates are findings with no share (plan §17.0)`);
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
 * bear out is changed to what its screens make it (never to a pass). The record's standings are the
 * ones worked out from `run.json`: a play that was a trial gives its measured parts as figures, and
 * may leave a seen part not judged.
 */
function recheck(record: FormRecord, dir: string, files: string[], faults: string[]): FormRecord {
  const trialPlays = new Set((record.standings ?? []).filter((s) => s.is === "trial").map((s) => s.play));
  const parts = record.parts.map((part) => {
    const seenPart = part.measured === null;
    const rests = restsOnGuidance(part, record.mode);
    if (seenPart && part.pages.length === 0) faults.push(`part ${part.id} is seen on no page`);
    if (!seenPart && part.pages.length > 0) faults.push(`part ${part.id} is measured and names pages`);
    const instances = part.instances.map((instance): Instance => {
      const where = `part ${part.id}: look ${instance.at} of play ${instance.play}`;
      const broken = (why: string): Instance => ({ ...instance, outcome: "broken", why: `its record is at fault: ${why}`, page: instance.page ?? null });
      if (instance.play > record.plays) {
        faults.push(`${where} is of a play the record does not have`);
        return broken("a play the record does not have");
      }
      const allowed = seenPart ? (trialPlays.has(instance.play) ? [...SEEN_OUTCOMES, "not judged"] : SEEN_OUTCOMES) : measuredOutcomes(rests && trialPlays.has(instance.play));
      if (!allowed.includes(instance.outcome)) {
        const known = [...SEEN_OUTCOMES, "not judged", ...measuredOutcomes(true), ...measuredOutcomes(false)].includes(instance.outcome);
        const why = `is recorded "${instance.outcome}", which the runner ${!known ? "never writes" : seenPart ? (instance.outcome === "not judged" ? "writes for a part that is seen only in a play that was a trial" : "writes only for a measured part of a gate") : rests && trialPlays.has(instance.play) ? "never writes in a play that was a trial, which gives no verdict" : "writes only in a trial"}`;
        faults.push(`${where} ${why}`);
        return broken(why);
      }
      if (!seenPart) {
        if (instance.glances.length > 0) faults.push(`${where} is a measured verdict that names looks on pages`);
        return instance;
      }
      if (instance.glances.length === 0) {
        if (instance.outcome !== "unlooked" && instance.outcome !== "broken" && instance.outcome !== "not judged") {
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
  if (!glance.sha256 || glance.sha256 !== digestOf(readFileSync(join(dir, glance.screen)))) return `its screen ${glance.screen} is not the image the run saved`;
  const name = parseScreen(glance.screen);
  if (!name) return `its screen ${glance.screen}'s name does not say what it shows`;
  if (name.page !== pageSlug(glance.page)) return `its screen ${glance.screen} is named for the ${name.page} page, not the ${glance.page} page`;
  if (glance.width !== null && name.width !== glance.width) return `its screen ${glance.screen} is named for ${name.width} wide, and it was looked at ${glance.width} wide`;
  if (partOfScreen(name.what, new Set([part])) === null) return `its screen ${glance.screen} is named for "${name.what}", not for this part`;
  return null;
}

function digestOf(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
