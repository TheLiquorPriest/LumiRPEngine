// Playing proof scripts (PlanScenarios-1 item 6): the forms asked are played one after another on a
// host, each play on its own footing, every part looked for through its shared checks and every look
// kept in the run's bundle; then the report is written from the bundle alone, whatever happened to
// the host or the lock on the way out.
//
// What is played is what `run.ts check` passes, and nothing else. A script the check faults (a part of
// its row no part carries, a wave or line that is not the list's, a fixture missing, a gate that does
// not load) is refused by its fault and named as not played; one number with two files plays neither;
// a gate is asked by its own id, never by a scenario's number. An id asked twice, or placed twice in
// the round's order, refuses the run before anything plays: each id is played once in a run, so no
// play's result can stand behind another's. A wave run, `--all` and the round ask every gate that
// belongs to them, a faulty one included, so none drops out of the report.
//
// A scenario played in stages (PlanScenarios-8) is played stage by stage, each stage a play of its own
// parts with its own forms, its record and screens in its own folder: asked by its number, it plays
// each of its stages in its order, each named `<number>:<stage>` in the run.
//
// A live run is never started without PlanScenarios-5's cheap gate and the bed's lock: the lock is
// taken before the run's first step (before the bed's host is opened) and given back after its last,
// and the commits the bed reports must be admitted by the gate. Plays run one at a time and nothing
// here waits a fixed time: the host's own waits are on what shows.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { check, fixturesDir, type Found } from "./check";
import { guidanceOf, shippedOf, treeChanges, treeHash } from "../lib/record";
import { Bundle, factFaults, lookAt, readBundle, runRecord, widthsOf, type RunRecord, type StandingFrom } from "./evidence";
import { isMeasured, pageSlug, parseStageId, partsOfStage, scenarioId, stageId, stagesOf, type Form, type GatePart, type Play, type ProofForm } from "./form";
import type { Host, HostOptions, Kept, LiveGuard, Mode, RoundStage, RunFacts, Session } from "./host";
import { LIST, listFaults } from "./list";
import { exitCode, reportOf } from "./report";
import { outcomeOf, type FormRecord, type Glance, type Instance, type PartRecord } from "./results";

/** A run that may not go ahead, or that could not go on, with why. */
export class RunRefused extends Error {}

/** A run that would play nothing: a usage error, since nothing played proves nothing (`run.ts` exits 2). */
export class NothingToPlay extends RunRefused {}

/** The runner's own settings (`scripts/proof/settings.json`). */
export interface Settings {
  /** How many times an "as shipped" part is played live, each on a fresh chat: the plan's own ten (§17.1, §17.3, row 0.10). */
  repeats: number;
}

export function readSettings(root: string): Settings {
  const file = join(root, "settings.json");
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(raw) || !isRepeats(raw.repeats)) throw new RunRefused(`${file} does not give "repeats" as a whole number of at least 1`);
  return { repeats: raw.repeats };
}

export function isRepeats(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** What a run is asked to play: ids (scenario numbers, gate ids), a wave's checkpoint, or everything. */
export type Selection = { ids: string[] } | { wave: number } | { all: true };

export interface RunOptions {
  /** The proof folder (`scripts/proof`). */
  root: string;
  /** Where the run's bundle is made. */
  out: string;
  by: string;
  mode: Mode;
  repeats: number;
  openHost: (options: HostOptions) => Promise<Host>;
  /** PlanScenarios-5's gate and lock; a live run is refused without them. */
  guard?: LiveGuard;
  now?: () => Date;
}

export interface RunDone {
  dir: string;
  report: string;
  /** 0 when everything asked was played and passed or measured as a rate, and the evidence holds no fault (`exitCode`). */
  code: number;
}

type Unplayed = { id: string; why: string }[];

/** An id as asked: a scenario's number as two digits, a stage `<number>:<stage>` with its number as two digits, anything else as written. */
export function normalId(word: string): string {
  const numbered = /^(\d{1,2})(:.*)?$/.exec(word);
  return numbered ? `${scenarioId(Number(numbered[1]))}${numbered[2] ?? ""}` : word;
}

/**
 * Each id a list asks for, as it plays: a scenario played in stages, asked by its number, as each of
 * its stages. The first stage or id the list holds twice is returned with every way it was asked, so a
 * run refuses it before anything plays: each stage, like each id, is played once in a run.
 */
function placedOnce(found: Found[], asked: { id: string; at?: string }[]): { units: string[]; twice: { unit: string; ways: { as: string; at?: string }[] } | null } {
  const placed = asked.flatMap(({ id, at }) => unitsOf(found, id).map((unit) => ({ unit, as: id, at })));
  const doubled = placed.find((p, i) => placed.findIndex((q) => q.unit === p.unit) !== i);
  const twice = doubled ? { unit: doubled.unit, ways: placed.filter((p) => p.unit === doubled.unit).map(({ as, at }) => ({ as, at })) } : null;
  return { units: placed.map((p) => p.unit), twice };
}

/** Every script as `run.ts check` finds and faults it; refused outright when the list of the 68 itself is damaged. */
async function checked(root: string): Promise<Found[]> {
  const damaged = listFaults(LIST);
  if (damaged.length > 0) throw new RunRefused(`the list of the 68 is damaged, so no run can be held to it: ${damaged.map((f) => `${f.where}: ${f.what}`).join("; ")}`);
  return (await check(root)).found;
}

/** The gates found, by the id each is asked by (its own, or its file when that cannot be read), in the order found. */
function gateIds(found: Found[], keep: (f: Found) => boolean = () => true): string[] {
  return [...new Set(found.filter((f) => f.kind === "gate" && keep(f)).map((f) => f.id))];
}

/** What a run plays for an id: a scenario played in stages, asked by its number, is each of its stages in its order; anything else is itself. */
function unitsOf(found: Found[], id: string): string[] {
  if (!/^\d{2}$/.test(id)) return [id];
  const files = filesOf(found, id);
  const stages = files.length === 1 && files[0]?.form ? stagesOf(files[0].form) : null;
  return stages ? stages.map((stage) => stageId(id, stage.name)) : [id];
}

/** Plays what was asked, in the order asked, and writes its bundle and report. */
export async function play(options: RunOptions, selection: Selection): Promise<RunDone> {
  const found = await checked(options.root);
  let asked: string[];
  if ("ids" in selection) {
    const { units, twice } = placedOnce(found, selection.ids.map((id) => ({ id: normalId(id) })));
    if (twice) {
      const ways = [...new Set(twice.ways.map((w) => w.as))];
      const scenario = parseStageId(twice.unit)?.scenario;
      throw new RunRefused(ways.length === 1 ? `${twice.unit} is asked twice: each id is played once in a run, so ask it once` : `${twice.unit} is asked twice, as ${ways.join(" and as ")} (asked by its number, scenario ${Number(scenario)} plays each of its stages): each stage is played once in a run, so ask it once`);
    }
    asked = units;
  } else {
    // A gate whose waves cannot be read may be this wave's: it is asked, and named as faulty, rather than left out.
    const inWave = (f: Found) => "all" in selection || f.waves === null || f.waves.includes(selection.wave);
    asked = [...LIST.filter((row) => "all" in selection || row.wave === selection.wave).flatMap((row) => unitsOf(found, scenarioId(row.number))), ...gateIds(found, inWave)];
  }
  if (asked.length === 0) throw new NothingToPlay("ids" in selection ? "nothing was asked" : `nothing was asked: ${"all" in selection ? "the proof folder holds" : `wave ${selection.wave} has`} no scenario and no gate here`);
  return run(options, found, asked, async (_host, playIds) => playIds(asked));
}

/** The formal round: every scenario and every gate, live, in the round's order, the bed restored from its golden copy where a stage says so. */
export async function round(options: RunOptions, order: RoundStage[]): Promise<RunDone> {
  const found = await checked(options.root);
  const { units, twice } = placedOnce(found, order.flatMap((stage) => stage.ids.map((id) => ({ id: normalId(id), at: stage.name }))));
  if (twice) throw new RunRefused(`the round's order places ${twice.unit} twice (${twice.ways.map((w) => `"${w.at}"${w.as === twice.unit ? "" : ` as ${w.as}`}`).join(", ")}): each id is played once in a run`);
  const known = [...LIST.flatMap((row) => unitsOf(found, scenarioId(row.number))), ...gateIds(found)];
  const asked = [...units, ...known.filter((id) => !units.includes(id))];
  return run(options, found, asked, async (host, playIds, unplayed) => {
    for (const id of known) {
      if (units.includes(id)) continue;
      const refused = refusal(found, id);
      unplayed.push({ id, why: refused === null ? "the round's order does not place it" : `the round's order does not place it, and ${refused}` });
    }
    for (const stage of order) {
      if (stage.restoreGolden) {
        if (!("restoreGolden" in host) || typeof host.restoreGolden !== "function") throw new RunRefused(`the round's stage "${stage.name}" restores the bed from its golden copy, and the bed's host cannot`);
        await host.restoreGolden();
      }
      await playIds(stage.ids.map(normalId).flatMap((id) => unitsOf(found, id)));
    }
  });
}

type Player = (host: Host, playIds: (ids: string[]) => Promise<void>, unplayed: Unplayed) => Promise<void>;

async function run(options: RunOptions, found: Found[], asked: string[], playAll: Player): Promise<RunDone> {
  const now = options.now ?? (() => new Date());
  const ground = options.mode === "rig" ? "the rig" : "the bed's host";
  const bundle = Bundle.open(options.out, options.mode, now());
  let release: (() => Promise<void>) | null = null;
  let host: Host | null = null;
  let facts: RunFacts;
  try {
    if (options.mode === "live") {
      if (!options.guard) throw new RunRefused("no live run starts without the cheap gate and the bed's lock (PlanScenarios-5, scripts/proof/gate/guard.ts)");
      const lock = await options.guard.lock(bundle.run);
      if (lock.held) throw new RunRefused(`the bed is taken by ${lock.by}: one run at a time`);
      release = lock.release;
    }
    host = await options.openHost({ root: options.root, run: bundle.run }).catch((error: unknown) => {
      throw new RunRefused(`${ground} could not be opened: ${message(error)}`);
    });
    const opened = host;
    facts = await opened.facts().catch((error: unknown) => {
      throw new RunRefused(`${ground} could not say what the run stands on: ${message(error)}`);
    });
    const missing = factFaults(facts);
    if (missing.length > 0) throw new RunRefused(`${ground} does not report ${missing.join("; ")}, so the run would prove nothing`);
    if (options.guard && options.mode === "live") {
      const admitted = await options.guard.admit(facts);
      if (!admitted.ok) throw new RunRefused(`the cheap gate does not admit this build: ${admitted.why}`);
    }
  } catch (error) {
    // Refused before it started: no bundle is left, the host is put away and the lock given back.
    const also: string[] = [];
    if (host) await host.close().catch((e: unknown) => void also.push(`${ground} could not be closed: ${message(e)}`));
    if (release) await release().catch((e: unknown) => void also.push(`the bed's lock could not be given back: ${message(e)}`));
    rmSync(bundle.dir, { recursive: true, force: true });
    if (also.length > 0) throw new RunRefused(`${message(error)}; and ${also.join("; ")}`);
    throw error;
  }
  const unplayed: Unplayed = [];
  const faults: string[] = [];
  const known = { scenarios: [...new Set(found.filter((f) => f.kind === "scenario" && /^\d{2}$/.test(f.id)).map((f) => f.id))], gates: gateIds(found) };
  const record = runRecord(facts, { run: bundle.run, mode: options.mode, by: options.by, started: now().toISOString(), ended: null, asked, unplayed, known, repeats: options.repeats, faults }, guidanceFrom(facts));
  bundle.writeRun(record);
  const played = new Set<string>();
  let broke: unknown = null;
  try {
    await playAll(
      host,
      async (ids) => {
        for (const id of ids) {
          const why = await playOne(options, bundle, host, found, id, record);
          if (why === null) played.add(id);
          else if (!unplayed.some((u) => u.id === id)) unplayed.push({ id, why });
        }
      },
      unplayed,
    );
  } catch (error) {
    // A run that breaks off keeps what it played, says why the rest was not, and is reported all the same.
    broke = error;
    for (const id of asked) if (!played.has(id) && !unplayed.some((u) => u.id === id)) unplayed.push({ id, why: `the run broke off: ${message(error)}` });
  }
  // Putting the host away and giving the lock back can fail too: the run says so, and its report is written.
  await host.close().catch((error: unknown) => void faults.push(`${ground} could not be closed after the run: ${message(error)}`));
  if (release) await release().catch((error: unknown) => void faults.push(`the bed's lock could not be given back after the run: ${message(error)}`));
  bundle.writeRun({ ...record, ended: broke === null ? now().toISOString() : null, unplayed, faults });
  const read = readBundle(bundle.dir);
  const report = reportOf(read);
  writeFileSync(join(bundle.dir, "report.md"), report);
  if (broke instanceof RunRefused) throw new RunRefused(`${broke.message} (what was played, and the report, are in ${bundle.dir})`);
  if (broke !== null) throw broke;
  return { dir: bundle.dir, report, code: exitCode(read) };
}

/** The files the runner would play for an id: a scenario's by its number, a gate's by its id (or its file, when its id cannot be read). */
function filesOf(found: Found[], id: string): Found[] {
  const scenario = /^\d{2}$/.test(id);
  return found.filter((f) => (scenario ? f.kind === "scenario" : f.kind === "gate") && f.id === id);
}

/** Why the runner will not play an id, in plain words; null when it will. */
function refusal(found: Found[], id: string): string | null {
  const asStage = parseStageId(id);
  if (asStage) {
    const whole = refusal(found, asStage.scenario);
    if (whole !== null) return whole;
    const form = filesOf(found, asStage.scenario)[0]?.form;
    const stages = form ? stagesOf(form) : null;
    if (!stages) return `scenario ${Number(asStage.scenario)} is played whole, not in stages: ask it as ${asStage.scenario}`;
    if (!stages.some((stage) => stage.name === asStage.stage)) return `scenario ${Number(asStage.scenario)} has no stage ${asStage.stage}: its stages are ${stages.map((stage) => stage.name).join(", ")}`;
    return null;
  }
  if (/^\d{2}:/.test(id)) return `${id} is not a stage: a stage is asked as its scenario's number and its name, lowercase words joined by hyphens (40:before)`;
  const files = filesOf(found, id);
  if (files.length === 0) {
    if (/^\d{2}$/.test(id)) return LIST.some((row) => scenarioId(row.number) === id) ? "no file plays it" : "it is not one of the 68";
    const unloaded = found.filter((f) => f.kind === "gate" && !f.loaded);
    const own = unloaded.find((f) => basename(dirname(f.file)) === id);
    if (own) return `it is a gate that does not load: ${own.file}: ${loadError(own)}`;
    const unread = found.filter((f) => f.kind === "gate" && f.id === f.file);
    if (unread.length > 0) return `no gate that can be read has this id, and the ids of these cannot be read: ${unread.map((f) => `${f.file} (${f.faults.join("; ")})`).join(", ")}`;
    return "no script has this id";
  }
  if (files.length > 1) return `${files.length} ${/^\d{2}$/.test(id) ? "files play it" : "gates have this id"}, so ${files.length === 2 ? "neither" : "none"} is played: ${files.map((f) => f.file).join(", ")}`;
  const [file] = files;
  if (!file) return "no script has this id";
  if (file.kind === "gate" && !file.loaded) return `it is a gate that does not load, so its id and waves cannot be read: ${file.file}: ${loadError(file)}`;
  if (file.faults.length > 0 || !file.form) return `its script ${file.file} is refused: ${file.faults.join("; ")}`;
  return null;
}

function loadError(file: Found): string {
  return (file.faults[0] ?? "").replace(/^it does not load: /, "");
}

/** What one id plays: its form, the parts it looks for, the form it plays in this mode, and the id its evidence is kept by (`folderOf`). */
interface Unit {
  /** As the run asked it: a scenario's number, a gate's id, or a stage's `<number>:<stage>`. */
  id: string;
  file: Found;
  form: ProofForm;
  parts: GatePart[];
  fn: Form;
}

/** Plays one form, or one stage of a scenario played in stages, as many times as its mode asks; returns why it was not played, or null. */
async function playOne(options: RunOptions, bundle: Bundle, host: Host, found: Found[], id: string, run: RunRecord): Promise<string | null> {
  const refused = refusal(found, id);
  if (refused !== null) return refused;
  const asStage = parseStageId(id);
  const scenario = asStage ? asStage.scenario : id;
  const file = filesOf(found, scenario)[0];
  const form = file?.form;
  if (!file || !form) return "no script has this id";
  const stages = stagesOf(form);
  const stage = asStage && stages ? stages.find((s) => s.name === asStage.stage) : undefined;
  if (stages && !stage) return `scenario ${Number(scenario)} is played in stages, each by its own name: ${stages.map((s) => stageId(scenario, s.name)).join(", ")}`;
  const parts: GatePart[] = stage && form.kind === "scenario" ? partsOfStage(form, stage) : form.parts;
  const fn: Form | undefined = stage ? (options.mode === "rig" ? stage.rig : stage.live) : options.mode === "rig" ? form.rig : form.live;
  if (!fn) return "the rig cannot play it: it has no rig form";
  // A scenario's "as shipped" part is a rate over fresh chats; a gate counts its own turns inside one play.
  const plays = options.mode === "live" && form.kind === "scenario" && parts.some((p) => p.mark === "as shipped") ? options.repeats : 1;
  bundle.formDir(id);
  const record: FormRecord = {
    run: run.run,
    id: scenario,
    kind: form.kind,
    number: form.kind === "scenario" ? form.number : null,
    waves: form.kind === "scenario" ? [form.wave] : form.waves,
    line: form.kind === "scenario" ? form.line : null,
    mode: options.mode,
    plays,
    stops: [],
    parts: parts.map((p): PartRecord => ({ id: p.id, words: p.words, mark: p.mark, pages: isMeasured(p) ? [] : p.on.map((s) => s.page), measured: isMeasured(p) ? p.measured : null, wants: p.wants ?? null, instances: [] })),
    ...(stage && stages ? { stage: { name: stage.name, of: stages.map((s) => s.name) } } : {}),
  };
  for (let n = 1; n <= plays; n++) await onePlay(options, bundle, host, { id, file, form, parts, fn }, record, n, run);
  bundle.writeResult(record);
  bundle.writeNotes(record, run.standing?.is !== "verdict");
  return null;
}

/**
 * What the run stood on, for its standing: the shipped tree the host says RPE served and the build's
 * (RPH's shipped folder with RPE's over it), by hash and by the paths they differ at, and each layer of
 * the user's own with the guidance in it (the floor's own helpers, `scripts/proof/lib/record.ts`).
 * Null when the host gave no account of it, or gave one that is not one: the run is then a trial.
 */
function guidanceFrom(facts: RunFacts): StandingFrom | null {
  const given = facts.guidance;
  const files = (list: unknown) => Array.isArray(list) && list.every((f) => isRecord(f) && typeof f.path === "string" && typeof f.sha256 === "string");
  if (!given || !files(given.served) || !isRecord(given.build) || !files(given.build.rph) || !files(given.build.rpe) || !Array.isArray(given.layers) || !given.layers.every((l) => isRecord(l) && typeof l.level === "string" && files(l.files))) return null;
  const build = shippedOf(given.build.rph, given.build.rpe);
  return { served: treeHash(given.served), build: treeHash(build), changed: treeChanges(given.served, build), layers: given.layers.map((layer) => ({ level: layer.level, hash: treeHash(layer.files), guidance: guidanceOf(layer) })) };
}

async function onePlay(options: RunOptions, bundle: Bundle, host: Host, unit: Unit, record: FormRecord, n: number, run: RunRecord): Promise<void> {
  const { id, form, parts, fn } = unit;
  const { plays } = record;
  // A trial gives no verdict on what rests on guidance: a measured part's figure is kept, never met or unmet.
  const trial = run.standing?.is !== "verdict";
  const keep = async (name: string, data: Kept) => bundle.keep(id, n, name, data);
  const looked = new Map<string, Set<string>>(parts.map((p) => [p.id, new Set<string>()]));
  const looks = new Map<string, number>();
  const add = (part: string, entry: Omit<Instance, "play" | "at">) => {
    looks.set(part, (looks.get(part) ?? 0) + 1);
    record.parts.find((p) => p.id === part)?.instances.push({ play: n, at: looks.get(part) ?? 1, ...entry });
  };
  const own = (partId: string) => {
    const part = parts.find((p) => p.id === partId);
    if (part) return part;
    const other = stagesOf(form)?.find((s) => s.parts.includes(partId));
    throw new Error(other ? `part ${partId} is seen in stage ${other.name}, not in this one` : `the form looked for a part it does not have: ${partId}`);
  };
  let stopped: string | null = null;
  let session: Session | null = null;
  try {
    session = await host.begin({ form: { id, kind: form.kind, fixtures: form.fixtures, fixturesDir: fixturesDir(options.root, unit.file.file, form), bed: form.bed }, play: n, plays, keep });
  } catch (error) {
    stopped = `the host could not set up play ${n}: ${message(error)}`;
  }
  if (session) {
    const browser = session.browser;
    const ctx: Play = {
      mode: options.mode,
      play: n,
      plays,
      acts: session.acts,
      look: browser,
      run,
      keep,
      async see(partId, page) {
        const part = own(partId);
        if (isMeasured(part)) throw new Error(`part ${partId} is measured: its form judges it`);
        const sightings = page === undefined ? part.on : part.on.filter((s) => pageSlug(s.page) === pageSlug(page));
        if (sightings.length === 0) throw new Error(`part ${partId} is not seen on the ${page} page`);
        const glances: Glance[] = [];
        for (const sighting of sightings) {
          looked.get(partId)?.add(pageSlug(sighting.page));
          for (const width of widthsOf(sighting.page)) glances.push(await lookAt(browser, sighting, width, (shot) => bundle.saveScreen(id, n, shot.page, partId, shot)));
        }
        add(partId, { ...outcomeOf(glances, part.mark, options.mode), page: null, glances });
      },
      async judge(partId, verdict) {
        const part = parts.find((p) => p.id === partId);
        if (!part || !isMeasured(part)) throw new Error(`the form judged ${partId}, which is not one of its measured parts`);
        looked.get(partId)?.add("");
        add(partId, { outcome: trial ? "trial" : verdict.pass ? "met" : "unmet", why: verdict.what, page: null, glances: [] });
      },
      async notJudged(partId, why) {
        const part = parts.find((p) => p.id === partId);
        if (!part || !isMeasured(part)) throw new Error(`the form said ${partId} is not judged, which is not one of its measured parts`);
        looked.get(partId)?.add("");
        add(partId, { outcome: "not judged", why, page: null, glances: [] });
      },
    };
    try {
      await fn(ctx);
    } catch (error) {
      stopped = `its form stopped: ${message(error)}`;
    }
    try {
      await session.close();
    } catch (error) {
      record.stops.push({ play: n, why: `after its form ended, the host could not put play ${n}'s footing away: ${message(error)}` });
    }
  }
  if (stopped) record.stops.push({ play: n, why: stopped });
  // What the play never looked for is not seen; where the play stopped first, the stop broke it. Each is kept with the page it was owed on.
  for (const part of parts) {
    const done = looked.get(part.id) ?? new Set<string>();
    if (isMeasured(part)) {
      if (!done.has("")) add(part.id, stopped ? { outcome: "broken", why: `${stopped}, before it was judged`, page: null, glances: [] } : { outcome: "unlooked", why: "its form never judged it", page: null, glances: [] });
      continue;
    }
    for (const page of part.on.map((s) => s.page).filter((p) => !done.has(pageSlug(p)))) {
      add(part.id, stopped ? { outcome: "broken", why: `${stopped}, before it was looked for on the ${page} page`, page, glances: [] } : { outcome: "unlooked", why: `its form never looked for it on the ${page} page`, page, glances: [] });
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A module another package keeps at a known path under the proof folder, or null while it is not
 * there. The rig's and the bed's hosts, the gate and lock, the round's order and the wave's checkpoint
 * are written by later packages and found on disk when the runner runs, so no import of them can be
 * written ahead.
 */
export async function loadModule(root: string, path: string): Promise<Record<string, unknown> | null> {
  const file = join(root, path);
  if (!existsSync(file)) return null;
  const module: unknown = await import(file);
  return isRecord(module) ? module : null;
}

/** `scripts/proof/<mode>/host.ts`'s `openHost`; what the host it opens reports is checked before anything is played. */
export async function loadHost(root: string, mode: Mode): Promise<RunOptions["openHost"] | null> {
  const openHost = (await loadModule(root, `${mode}/host.ts`))?.openHost;
  if (typeof openHost !== "function") return null;
  return async (options) => {
    const host: unknown = await openHost(options);
    if (!isRecord(host) || typeof host.facts !== "function" || typeof host.begin !== "function" || typeof host.close !== "function") throw new RunRefused(`${mode}/host.ts opened something that is not a host`);
    // Its shape is checked above, and its facts and footing are checked as the run goes.
    return host as unknown as Host;
  };
}

export async function loadGuard(root: string): Promise<LiveGuard | null> {
  const guard = (await loadModule(root, "gate/guard.ts"))?.guard;
  if (!isRecord(guard) || typeof guard.lock !== "function" || typeof guard.admit !== "function") return null;
  // Both members are checked above; what each answers is checked where it is used.
  return guard as unknown as LiveGuard;
}

export async function loadOrder(root: string): Promise<RoundStage[] | null> {
  const order = (await loadModule(root, "round/order.ts"))?.order;
  if (!Array.isArray(order)) return null;
  const stages: RoundStage[] = [];
  for (const stage of order) {
    if (!isRecord(stage) || typeof stage.name !== "string" || !Array.isArray(stage.ids) || typeof stage.restoreGolden !== "boolean") return null;
    const ids = stage.ids.filter((i): i is string => typeof i === "string");
    if (ids.length !== stage.ids.length) return null;
    stages.push({ name: stage.name, ids, restoreGolden: stage.restoreGolden });
  }
  return stages;
}

export async function loadCheckpoint(root: string): Promise<((wave: number, argv: string[]) => Promise<number>) | null> {
  const checkpoint = (await loadModule(root, "checkpoint/checkpoint.ts"))?.checkpoint;
  if (typeof checkpoint !== "function") return null;
  return async (wave, argv) => {
    const code: unknown = await checkpoint(wave, argv);
    return typeof code === "number" ? code : 1;
  };
}
