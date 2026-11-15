// Playing proof scripts (PlanScenarios-1 item 6): the forms asked are played one after another on a
// host, each play on its own footing, every part looked for through its shared checks and every look
// kept in the run's bundle; then the report is written from the bundle alone.
//
// A live run is never started without PlanScenarios-5's cheap gate and the bed's lock: the lock is
// taken before the run's first step (before the bed's host is opened) and given back after its last,
// and the commits the bed reports must be admitted by the gate. Plays run one at a time and nothing
// here waits a fixed time: the host's own waits are on what shows.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import { findForms, fixturesDir, type Found } from "./check";
import { Bundle, factFaults, lookAt, readBundle, runRecord, widthsOf } from "./evidence";
import { formId, isMeasured, pageSlug, scenarioId, type Form, type GatePart, type Play, type ProofForm } from "./form";
import type { Host, HostOptions, Kept, LiveGuard, Mode, RoundStage, Session } from "./host";
import { LIST } from "./list";
import { reportOf } from "./report";
import { formResult, outcomeOf, type FormRecord, type Glance, type Instance, type PartRecord } from "./results";

/** A run that may not go ahead, with why. */
export class RunRefused extends Error {}

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
  /** 0 when everything played passed (or is a rate alone), nothing asked was refused, and the evidence has no fault. */
  code: number;
}

type Unplayed = { id: string; why: string }[];

/** An id as asked: a scenario's number as two digits, anything else as written. */
export function normalId(word: string): string {
  return /^\d{1,2}$/.test(word) ? scenarioId(Number(word)) : word;
}

/** Plays what was asked, in the order asked, and writes its bundle and report. */
export async function play(options: RunOptions, selection: Selection): Promise<RunDone> {
  const found = await findForms(options.root);
  const playable = found.filter((f): f is Found & { form: ProofForm } => f.form !== null && f.faults.length === 0);
  const gates = playable.filter((f) => f.form.kind === "gate" && ("all" in selection || ("wave" in selection && f.form.waves.includes(selection.wave))));
  const asked = "ids" in selection ? selection.ids.map(normalId) : [...LIST.filter((row) => "all" in selection || row.wave === selection.wave).map((row) => scenarioId(row.number)), ...gates.map((f) => formId(f.form))];
  return run(options, found, asked, async (_host, playIds) => playIds(asked));
}

/** The formal round: every scenario and every gate, live, in the round's order, the bed restored from its golden copy where a stage says so. */
export async function round(options: RunOptions, order: RoundStage[]): Promise<RunDone> {
  const found = await findForms(options.root);
  const gates = found.filter((f) => f.kind === "gate" && f.form !== null && f.faults.length === 0);
  const known = [...LIST.map((row) => scenarioId(row.number)), ...gates.flatMap((f) => (f.form ? [formId(f.form)] : []))];
  const placed = order.flatMap((stage) => stage.ids.map(normalId));
  const asked = [...placed, ...known.filter((id) => !placed.includes(id))];
  return run(options, found, asked, async (host, playIds, unplayed) => {
    for (const id of known) if (!placed.includes(id)) unplayed.push({ id, why: "the round's order does not place it" });
    for (const stage of order) {
      if (stage.restoreGolden) {
        if (!("restoreGolden" in host) || typeof host.restoreGolden !== "function") throw new RunRefused(`the round's stage "${stage.name}" restores the bed from its golden copy, and the bed's host cannot`);
        await host.restoreGolden();
      }
      await playIds(stage.ids.map(normalId));
    }
  });
}

type Player = (host: Host, playIds: (ids: string[]) => Promise<void>, unplayed: Unplayed) => Promise<void>;

async function run(options: RunOptions, found: Found[], asked: string[], playAll: Player): Promise<RunDone> {
  const now = options.now ?? (() => new Date());
  const bundle = Bundle.open(options.out, options.mode, now());
  let release: (() => Promise<void>) | null = null;
  let broke: unknown = null;
  let started = false;
  try {
    if (options.mode === "live") {
      if (!options.guard) throw new RunRefused("no live run starts without the cheap gate and the bed's lock (PlanScenarios-5, scripts/proof/gate/guard.ts)");
      const lock = await options.guard.lock(bundle.run);
      if (lock.held) throw new RunRefused(`the bed is taken by ${lock.by}: one run at a time`);
      release = lock.release;
    }
    const ground = options.mode === "rig" ? "the rig" : "the bed's host";
    const host = await options.openHost({ root: options.root, run: bundle.run }).catch((error: unknown) => {
      throw new RunRefused(`${ground} could not be opened: ${message(error)}`);
    });
    try {
      const facts = await host.facts().catch((error: unknown) => {
        throw new RunRefused(`${ground} could not say what the run stands on: ${message(error)}`);
      });
      const missing = factFaults(facts);
      if (missing.length > 0) throw new RunRefused(`${ground} does not report ${missing.join("; ")}, so the run would prove nothing`);
      if (options.guard && options.mode === "live") {
        const admitted = await options.guard.admit(facts);
        if (!admitted.ok) throw new RunRefused(`the cheap gate does not admit this build: ${admitted.why}`);
      }
      const unplayed: Unplayed = [];
      const known = {
        scenarios: found.flatMap((f) => (f.form?.kind === "scenario" && f.faults.length === 0 ? [formId(f.form)] : [])),
        gates: found.flatMap((f) => (f.form?.kind === "gate" && f.faults.length === 0 ? [formId(f.form)] : [])),
      };
      const record = runRecord(facts, { run: bundle.run, mode: options.mode, by: options.by, started: now().toISOString(), ended: null, asked, unplayed, known, repeats: options.repeats });
      bundle.writeRun(record);
      started = true;
      const played = new Set<string>();
      try {
        await playAll(
          host,
          async (ids) => {
            for (const id of ids) {
              const why = await playOne(options, bundle, host, found, id);
              if (why === null) played.add(id);
              else if (!unplayed.some((u) => u.id === id)) unplayed.push({ id, why });
            }
          },
          unplayed,
        );
        bundle.writeRun({ ...record, ended: now().toISOString(), unplayed });
      } catch (error) {
        // A run that breaks off keeps what it played, says why the rest was not, and is reported all the same.
        broke = error;
        for (const id of asked) if (!played.has(id) && !unplayed.some((u) => u.id === id)) unplayed.push({ id, why: `the run broke off: ${message(error)}` });
        bundle.writeRun({ ...record, unplayed });
      }
    } finally {
      await host.close();
    }
  } catch (error) {
    if (!started) rmSync(bundle.dir, { recursive: true, force: true });
    throw error;
  } finally {
    await release?.();
  }
  const read = readBundle(bundle.dir);
  const report = reportOf(read);
  writeFileSync(join(bundle.dir, "report.md"), report);
  if (broke !== null) throw broke;
  const refused = read.run.unplayed.some((u) => u.why.startsWith("its file is refused"));
  const bad = read.forms.some((f) => f.faults.length > 0 || f.record === null || formResult(f.record) === "failed" || formResult(f.record) === "not seen");
  return { dir: bundle.dir, report, code: refused || bad || read.faults.length > 0 ? 1 : 0 };
}

/** Plays one form as many times as its mode asks; returns why it was not played, or null. */
async function playOne(options: RunOptions, bundle: Bundle, host: Host, found: Found[], id: string): Promise<string | null> {
  const files = found.filter((f) => (f.form ? formId(f.form) === id : f.file.startsWith(`scenarios/${id}-`)));
  if (files.length === 0) return /^\d{2}$/.test(id) ? (LIST.some((row) => scenarioId(row.number) === id) ? "no file plays it" : "it is not one of the 68") : "no script has this id";
  const file = files.find((f) => f.form !== null && f.faults.length === 0);
  if (!file?.form) return `its file is refused: ${files.flatMap((f) => f.faults).join("; ")}`;
  const form = file.form;
  const fn: Form | undefined = options.mode === "rig" ? form.rig : form.live;
  if (!fn) return "the rig cannot play it: it has no rig form";
  const parts: GatePart[] = form.parts;
  // A scenario's "as shipped" part is a rate over fresh chats; a gate counts its own turns inside one play.
  const plays = options.mode === "live" && form.kind === "scenario" && parts.some((p) => p.mark === "as shipped") ? options.repeats : 1;
  bundle.formDir(id);
  const record: FormRecord = {
    id,
    kind: form.kind,
    number: form.kind === "scenario" ? form.number : null,
    waves: form.kind === "scenario" ? [form.wave] : form.waves,
    line: form.kind === "scenario" ? form.line : null,
    mode: options.mode,
    plays,
    stops: [],
    parts: parts.map((p): PartRecord => ({ id: p.id, words: p.words, mark: p.mark, pages: isMeasured(p) ? [] : p.on.map((s) => s.page), measured: isMeasured(p) ? p.measured : null, wants: p.wants ?? null, instances: [] })),
  };
  for (let n = 1; n <= plays; n++) await onePlay(options, bundle, host, file, form, fn, record, n);
  bundle.writeResult(record);
  bundle.writeNotes(record);
  return null;
}

async function onePlay(options: RunOptions, bundle: Bundle, host: Host, file: Found, form: ProofForm, fn: Form, record: FormRecord, n: number): Promise<void> {
  const { id, plays } = record;
  const keep = async (name: string, data: Kept) => bundle.keep(id, n, name, data);
  const looked = new Map<string, Set<string>>(form.parts.map((p) => [p.id, new Set<string>()]));
  const looks = new Map<string, number>();
  const add = (part: string, entry: Omit<Instance, "play" | "at">) => {
    looks.set(part, (looks.get(part) ?? 0) + 1);
    record.parts.find((p) => p.id === part)?.instances.push({ play: n, at: looks.get(part) ?? 1, ...entry });
  };
  let stopped: string | null = null;
  let session: Session | null = null;
  try {
    session = await host.begin({ form: { id, kind: form.kind, fixtures: form.fixtures, fixturesDir: fixturesDir(options.root, file.file, form), bed: form.bed }, play: n, plays, keep });
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
      keep,
      async see(partId, page) {
        const part = form.parts.find((p) => p.id === partId);
        if (!part) throw new Error(`the form looked for a part it does not have: ${partId}`);
        if (isMeasured(part)) throw new Error(`part ${partId} is measured: its form judges it`);
        const sightings = page === undefined ? part.on : part.on.filter((s) => pageSlug(s.page) === pageSlug(page));
        if (sightings.length === 0) throw new Error(`part ${partId} is not seen on the ${page} page`);
        const glances: Glance[] = [];
        for (const sighting of sightings) {
          looked.get(partId)?.add(pageSlug(sighting.page));
          for (const width of widthsOf(sighting.page)) glances.push(await lookAt(browser, sighting, width, (shot) => bundle.saveScreen(id, n, shot.page, partId, shot)));
        }
        add(partId, { ...outcomeOf(glances, part.mark, options.mode), glances });
      },
      async judge(partId, verdict) {
        const part = form.parts.find((p) => p.id === partId);
        if (!part || !isMeasured(part)) throw new Error(`the form judged ${partId}, which is not one of its measured parts`);
        looked.get(partId)?.add("");
        add(partId, { outcome: verdict.pass ? "met" : "unmet", why: verdict.what, glances: [] });
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
  // What the play never looked for is not seen; where the play stopped first, the stop broke it.
  for (const part of form.parts) {
    const done = looked.get(part.id) ?? new Set<string>();
    const owed = isMeasured(part) ? (done.has("") ? [] : ["judged"]) : part.on.map((s) => s.page).filter((page) => !done.has(pageSlug(page)));
    for (const page of owed) {
      const what = page === "judged" ? "it was judged" : `it was looked for on the ${page} page`;
      add(part.id, stopped ? { outcome: "broken", why: `${stopped}, before ${what}`, glances: [] } : { outcome: "unlooked", why: page === "judged" ? "its form never judged it" : `its form never looked for it on the ${page} page`, glances: [] });
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
