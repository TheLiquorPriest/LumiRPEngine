// The form every proof script is written in (PlanScenarios-1 item 1; plan §17.0, §17.4).
//
// A scenario is one file, `scripts/proof/scenarios/<nn>-<word>.ts`, whose default export is
// `scenario({...})`: its number, its wave as §18.3's table gives it, its plan line, its parts in the
// plan's own words each marked "code" or "as shipped", the pages each part is seen on with what must
// be seen there, its fixtures, what it needs of the test bed, and two forms, `rig` and `live`. The two
// forms only bring the moment about; what must be seen is checked by the part's own checks, which both
// forms share: a form calls `play.see(part)` and the runner runs that part's checks on every page it
// is seen on, at both of R-40's widths, saving a screen of each.
//
// A scenario whose parts are seen in different states of the bed (40 to 43 in the formal round: before
// the cutover, after it, and after going back) is written in stages (PlanScenarios-8): its parts as
// always and, in place of its own two forms, `stages`, each with a name, the ids of the parts seen in
// it (every part in exactly one stage) and its own `rig` and `live` forms. A scenario with no stages is
// one stage, played whole, as before. A stage is never a second play of its scenario: a run plays each
// stage once, at its own place, and the scenario passes only when every stage was played and every
// part seen.
//
// A run, the round's order, a host and the report name a stage `<number>:<stage>` (`40:before`). That
// id is never a path: a stage's evidence is kept in the stage's own folder inside its scenario's
// folder, `40/before/`, so no name in a bundle holds a colon, on any filesystem the proof runs on.
// `folderOf` is that mapping, and the one place it is made.
//
// A gate is `scripts/proof/<name>/gate.ts` (any depth under `scripts/proof/` but `scenarios/`), whose
// default export is `gate({...})`: an id, the waves it is played at, its parts, a `rig` form where the
// rig can play it, a `live` form, its fixtures and what it needs of the bed. A gate's part may be
// measured instead of seen (the floor's times), judged by its form with `play.judge`. A wave's own
// checkpoint items are a gate kept with the scenarios: `scripts/proof/scenarios/w<n>-checkpoint.ts`,
// id `w<n>`, played at wave n.
//
// A gate's id names it on the command line, in `run.json`, and as its folder in the bundle. So it is
// letters, digits, dots and hyphens, beginning with a letter or a digit, with at least one letter:
// never a "/" (a gate PlanGates names `phase0/0.2-tags` is written `phase0-0.2-tags`), and never a
// number, since a number names one of the plan's scenarios. It never names the bundle's own files
// (`run.json`, `report.md`), and no two gates' ids differ only in case, since a disk may not tell case
// apart. A part's id is lowercase words joined by hyphens.
//
// "A part that depends on an agent following a shipped file is 'as shipped' even where the row does
// not say so": the mark is the script writer's, and where the plan's row says "as shipped" the check
// holds the clauses it governs to that mark (`check.ts`).
//
// A check reads its page as a person would and answers with the words on the page that show the part
// (`shows`). An answer that says the part was seen and names no words, or an empty or blank text, is
// refused when it comes, as a fault of the script: the look counts as one the code could not make.
// A check names words only its outcome shows: the value, the line, the entry that proves the part,
// never words every such page shows (its heading, a label), which would pass whatever the page holds.
// Nothing in the runner can tell the two apart, so each script's checks are read when it lands.
// What may lie outside the window, a check first brings into view (`Browser.show`, `Browser.scroll`).
//
// `run.ts check` loads every script to read its form, so a script does nothing when it is loaded:
// everything it does is in its forms and its checks. The runner never plays a script `check` faults.

import { isRecord } from "../../../src/shared/json";
import type { RunRecord } from "./evidence";
import type { Browser, Kept, Mode } from "./host";

export type Mark = "code" | "as shipped";
export const MARKS: readonly Mark[] = ["code", "as shipped"];

/** R-40: "laid out without loss or sideways scrolling at 390 and at 1440 pixels", shown in the browser rounds. */
export const WIDTHS: readonly number[] = [390, 1440];

/** The page a command typed on the server is seen on, as the owner sees it (PlanScenarios-3 item 3). */
export const TERMINAL = "terminal";

/** What a check saw on its page. `shows` are texts on the page that show it: each must be on the screen saved beside it, or the part is not seen. */
export type Seen = { found: true; shows: string[]; what?: string } | { found: false; what: string };

/**
 * What must be seen on one page: the check reads the page as a person would and says what it saw. It
 * throws only when it cannot look (the page, or a control it needs to reach the thing, is not there),
 * which is a fault of the code, never a miss of guidance.
 */
export type Check = (look: Browser) => Promise<Seen>;

export interface Sighting {
  /** The page as a person names it: one of RPE's pages ("World"), a surface of Lumiverse's ("Lumiverse chat"), or "terminal". */
  page: string;
  check: Check;
}

/** A part shown on pages. */
export interface SeenPart {
  /** Its name in the forms and in its screens' names: lowercase words joined by hyphens. */
  id: string;
  /** The plan's own words for it. */
  words: string;
  mark: Mark;
  on: Sighting[];
}

/** The share of plays the plan asks of an "as shipped" part of a gate ("in at least 9 of 10"). */
export interface Share {
  hits: number;
  of: number;
}

/** A gate's part that is measured rather than shown (a time, a count), judged by its form. */
export interface MeasuredPart {
  id: string;
  words: string;
  mark: Mark;
  /** What is measured, and from what, in plain words. */
  measured: string;
}

export type GatePart = (SeenPart | MeasuredPart) & { wants?: Share };

/** What a form is given for one play. */
export interface Play<Acts = unknown> {
  readonly mode: Mode;
  /** Which play this is, from 1, of `plays`. */
  readonly play: number;
  readonly plays: number;
  /** What the host lets the form do: the player's acts on the stand-in, or the steps on the bed's pages. */
  readonly acts: Acts;
  /** The browser the checks read with, for the form's own steps. */
  readonly look: Browser;
  /**
   * The run's record as `run.json` held it when this play began (a copy, frozen: a form cannot change
   * the standing it is judged by), its standing in it (`standing.is`, `standing.why`): a trial gives no
   * verdict on what rests on guidance.
   */
  readonly run: RunRecord;
  /**
   * This play's standing so far: the run's own, and what its chat stood on when its footing was ready.
   * What its form does, or what changes during it, may still make the play a trial; a play that is a
   * trial here is one for good.
   */
  readonly standing: { readonly is: "verdict" | "trial"; readonly why: readonly string[] };
  /** Runs the part's checks now, on every page it is seen on or only on `page`, and keeps the screens. */
  see(part: string, page?: string): Promise<void>;
  /** A measured part's verdict, with what was measured (gates only). */
  judge(part: string, verdict: { pass: boolean; what: string }): Promise<void>;
  /**
   * That a part is not judged in this play, and why: recorded as "not judged", never a pass. A measured
   * part (gates only) may be said so in any play; a part seen on screen only in a play that is a
   * trial (`standing`), where what rests on guidance gives no verdict.
   */
  notJudged(part: string, why: string): Promise<void>;
  /**
   * That this play's form changes guidance on purpose (a gate that cuts every shipped file to a stub, a
   * scenario that switches a file off, a layer it lays), and why. The runner asks the host what the
   * play's chat stands on before the form and after it; a difference no form declared makes the play a
   * trial. A declared change is the form's own act and leaves the play as it was for parts that do not
   * rest on guidance; a part that rests on guidance (a measured part, or an "as shipped" part played
   * live) in a play whose form changed the guidance gives figures and no verdict.
   */
  declareGuidanceChange(why: string): void;
  /** Supporting evidence (route answers, rows, logs) into the form's `internal/` folder: never proof. */
  keep(name: string, data: Kept): Promise<void>;
}

export type Form<Acts = unknown> = (play: Play<Acts>) => Promise<void>;

/** What every scenario gives, whether it is played whole or in stages. */
interface ScenarioFields {
  /** Its number in §17.4. */
  number: number;
  /** Its wave, as §18.3's table gives it. */
  wave: number;
  /** Its row's line in `STANDALONE-PLAN.md`. */
  line: number;
  parts: SeenPart[];
  /** Its fixtures: folders under `scripts/proof/scenarios/fixtures/`. */
  fixtures: string[];
  /** What it needs of the test bed, in plain words; empty when nothing. */
  bed: string[];
}

/** One stage of a scenario played in stages: the parts seen in one state of the bed, and its two forms. */
export interface Stage<RigActs = unknown, LiveActs = unknown> {
  /** Its name, after the scenario's number wherever a run names it (`40:before`): lowercase words joined by hyphens. */
  name: string;
  /** The ids of the scenario's parts seen in this stage. Every part of the scenario is in exactly one stage. */
  parts: string[];
  rig: Form<RigActs>;
  live: Form<LiveActs>;
}

/** A scenario played whole: one stage, its own two forms. */
export interface WholeScenarioDef<RigActs = unknown, LiveActs = unknown> extends ScenarioFields {
  rig: Form<RigActs>;
  live: Form<LiveActs>;
  stages?: undefined;
}

/** A scenario played in stages: its forms are its stages', each played at its own place in a run. */
export interface StagedScenarioDef<RigActs = unknown, LiveActs = unknown> extends ScenarioFields {
  stages: Stage<RigActs, LiveActs>[];
  rig?: undefined;
  live?: undefined;
}

export type ScenarioDef<RigActs = unknown, LiveActs = unknown> = WholeScenarioDef<RigActs, LiveActs> | StagedScenarioDef<RigActs, LiveActs>;

export type Scenario<RigActs = unknown, LiveActs = unknown> = ScenarioDef<RigActs, LiveActs> & { kind: "scenario" };

export interface GateDef<RigActs = unknown, LiveActs = unknown> {
  /** `floor`, `floor-20`, `G0`, `gate-17.2-files`, `w1`… */
  id: string;
  /** The waves it is played at: 0 the ground before wave 1, 1 to 4 the waves, 5 the formal round. */
  waves: number[];
  parts: GatePart[];
  /** Its fixtures: files or folders beside its `gate.ts`. */
  fixtures: string[];
  bed: string[];
  /** Where the rig can play it. */
  rig?: Form<RigActs>;
  live: Form<LiveActs>;
}

export interface Gate<RigActs = unknown, LiveActs = unknown> extends GateDef<RigActs, LiveActs> {
  kind: "gate";
}

export type ProofForm = Scenario | Gate;

export function scenario<RigActs = unknown, LiveActs = unknown>(def: ScenarioDef<RigActs, LiveActs>): Scenario<RigActs, LiveActs> {
  return { kind: "scenario", ...def };
}

export function gate<RigActs = unknown, LiveActs = unknown>(def: GateDef<RigActs, LiveActs>): Gate<RigActs, LiveActs> {
  return { kind: "gate", ...def };
}

/** A scenario's id as the runner and the bundle name it: its number, two digits. */
export function scenarioId(number: number): string {
  return String(number).padStart(2, "0");
}

export function formId(form: ProofForm): string {
  return form.kind === "scenario" ? scenarioId(form.number) : form.id;
}

/** A scenario's stages, in their order; null for a scenario played whole and for a gate. */
export function stagesOf(form: ProofForm): Stage[] | null {
  return form.kind === "scenario" && form.stages ? form.stages : null;
}

/** The parts seen in one stage, in the scenario's order. */
export function partsOfStage(form: Scenario, stage: Stage): SeenPart[] {
  return form.parts.filter((part) => stage.parts.includes(part.id));
}

/** Whether a text can name a stage: lowercase words joined by hyphens, and never a name a form's folder keeps for its own (`internal`, `play-01`). */
export function isStageName(name: unknown): name is string {
  return typeof name === "string" && PART_ID.test(name) && !reservedName(name);
}

function reservedName(name: string): boolean {
  return name === "internal" || /^play-\d+$/.test(name);
}

/** A stage's id as a run, the round's order, a host and the report name it: `40:before`. */
export function stageId(scenario: string, stage: string): string {
  return `${scenario}:${stage}`;
}

/** A stage's id read back into its scenario's number and its name; null when the text names no stage. */
export function parseStageId(id: string): { scenario: string; stage: string } | null {
  const named = /^(\d{2}):(.+)$/.exec(id);
  return named && isStageName(named[2]) ? { scenario: named[1] ?? "", stage: named[2] } : null;
}

/**
 * The folder of a run's bundle an id's evidence is kept in: a scenario's number or a gate's id as it
 * is, and a stage `<number>:<stage>` as `<number>/<stage>`, its own folder inside its scenario's. The
 * one place a stage's id becomes a path, so no name in a bundle holds a colon.
 */
export function folderOf(id: string): string {
  const stage = parseStageId(id);
  return stage ? `${stage.scenario}/${stage.stage}` : id;
}

export function isMeasured(part: GatePart | SeenPart): part is MeasuredPart & { wants?: Share } {
  return "measured" in part;
}

/** A page's name as screens are named for it: lowercase words joined by hyphens. */
export function pageSlug(page: string): string {
  return page
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PART_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Why a value cannot be a gate's id, in plain words; null when it can. */
export function gateIdFault(id: unknown): string | null {
  if (typeof id !== "string" || id === "") return "it has no id";
  if (id.includes("/")) return `its id ${id} holds a "/": a gate's id names its folder in the bundle, so it is letters, digits, dots and hyphens (write it ${id.replaceAll("/", "-")})`;
  if (!GATE_ID.test(id)) return `its id ${id} is not letters, digits, dots and hyphens`;
  if (!/[A-Za-z]/.test(id)) return `its id ${id} has no letter, so it would read as a scenario's number: a gate's id is a name with a letter in it`;
  const own = BUNDLE_FILES.find((file) => file === id.toLowerCase());
  if (own) return `its id ${id} is the name of the bundle's own ${own}, so the gate's folder would take its place: give the gate a name of its own`;
  return null;
}

/** The files a run's bundle holds beside its forms' folders, which no gate's id may name. */
const BUNDLE_FILES = ["run.json", "report.md"];

/**
 * Why a module's default export is not a proof form the runner can play: each reason in plain words.
 * Empty when it is one. `kind` says what the file's place asks for.
 */
export function refusals(value: unknown, kind: "scenario" | "gate"): string[] {
  if (!isRecord(value)) return ["it has no default export of a form"];
  if (value.kind !== kind) return [kind === "scenario" ? "its default export is not a scenario (write it with scenario())" : "its default export is not a gate (write it with gate())"];
  const out: string[] = [];
  if (kind === "scenario") {
    if (!isWhole(value.number, 1, 68)) out.push("it has no number from 1 to 68");
    if (value.wave === undefined) out.push("it has no wave");
    else if (!isWhole(value.wave, 1, 4)) out.push("its wave is not one of §18.3's waves 1 to 4");
    if (!isWhole(value.line, 1, Number.MAX_SAFE_INTEGER)) out.push("it has no plan line");
  } else {
    const idFault = gateIdFault(value.id);
    if (idFault) out.push(idFault);
    if (value.waves === undefined) out.push("it has no waves");
    else if (!Array.isArray(value.waves) || value.waves.length === 0 || !value.waves.every((w) => isWhole(w, 0, 5))) out.push("its waves are not a list of waves 0 to 5");
    else if (new Set(value.waves).size !== value.waves.length) out.push("its waves name a wave twice");
  }
  out.push(...partRefusals(value.parts, kind));
  if (!isTexts(value.fixtures)) out.push("it does not list its fixtures (an empty list when it has none)");
  if (!isTexts(value.bed)) out.push("it does not say what it needs of the bed (an empty list when nothing)");
  if (kind === "scenario" && value.stages !== undefined) out.push(...stageRefusals(value));
  else {
    if (kind === "scenario" && typeof value.rig !== "function") out.push("it has no rig form");
    if (kind === "gate" && value.rig !== undefined && typeof value.rig !== "function") out.push("its rig form is not a form");
    if (typeof value.live !== "function") out.push("it has no live form");
  }
  if (kind === "gate" && value.stages !== undefined) out.push("it names stages, and only a scenario is played in stages");
  return out;
}

/** Why a scenario's stages are not stages the runner can play, each at its own place: every part in exactly one stage, each stage with its own two forms. */
function stageRefusals(value: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (value.rig !== undefined || value.live !== undefined) out.push("it has forms of its own beside its stages: a scenario played in stages has its forms in each stage");
  const stages = value.stages;
  if (!Array.isArray(stages) || stages.length === 0) return [...out, "its stages are not a list of stages"];
  if (stages.length === 1) out.push("it names one stage: a scenario with one stage is written without stages, and played whole");
  const partIds = Array.isArray(value.parts) ? value.parts.flatMap((part) => (isRecord(part) && typeof part.id === "string" ? [part.id] : [])) : [];
  const names = new Set<string>();
  const inStages = new Map<string, string[]>();
  stages.forEach((stage, index) => {
    if (!isRecord(stage)) {
      out.push(`stage ${index + 1} is not a stage`);
      return;
    }
    const name = isStageName(stage.name) ? stage.name : String(index + 1);
    if (typeof stage.name === "string" && PART_ID.test(stage.name) && reservedName(stage.name)) out.push(`stage ${index + 1} is named ${stage.name}, a name a form's folder keeps for its own`);
    else if (!isStageName(stage.name)) out.push(`stage ${index + 1} has no name of lowercase words joined by hyphens`);
    else if (names.has(name)) out.push(`stage ${name} is named twice`);
    else names.add(name);
    if (!Array.isArray(stage.parts) || stage.parts.length === 0) out.push(`stage ${name} names no part: a stage shows at least one part of its scenario`);
    else {
      const own = new Set<string>();
      for (const id of stage.parts) {
        if (typeof id !== "string" || !partIds.includes(id)) out.push(`stage ${name} names ${typeof id === "string" ? `part ${id}` : "a part by no id"}, which the scenario does not have`);
        else if (own.has(id)) out.push(`stage ${name} names part ${id} twice`);
        else {
          own.add(id);
          inStages.set(id, [...(inStages.get(id) ?? []), name]);
        }
      }
    }
    if (typeof stage.rig !== "function") out.push(`stage ${name} has no rig form`);
    if (typeof stage.live !== "function") out.push(`stage ${name} has no live form`);
  });
  for (const id of new Set(partIds)) {
    const where = inStages.get(id) ?? [];
    if (where.length === 0) out.push(`part ${id} is in no stage: every part is in exactly one stage`);
    else if (where.length > 1) out.push(`part ${id} is in stages ${where.join(" and ")}: every part is in exactly one stage`);
  }
  return out;
}

function partRefusals(parts: unknown, kind: "scenario" | "gate"): string[] {
  if (!Array.isArray(parts) || parts.length === 0) return ["it has no parts"];
  const out: string[] = [];
  const ids = new Set<string>();
  parts.forEach((part, index) => {
    const name = isRecord(part) && typeof part.id === "string" && part.id !== "" ? `part ${part.id}` : `part ${index + 1}`;
    if (!isRecord(part)) {
      out.push(`${name} is not a part`);
      return;
    }
    if (typeof part.id !== "string" || !PART_ID.test(part.id)) out.push(`${name} has no id of lowercase words joined by hyphens`);
    else if (ids.has(part.id)) out.push(`${name} is named twice`);
    else ids.add(part.id);
    if (typeof part.words !== "string" || part.words.trim() === "") out.push(`${name} does not give the plan's words`);
    if (part.mark === undefined) out.push(`${name} has no mark ("code" or "as shipped")`);
    else if (!MARKS.includes(part.mark as Mark)) out.push(`${name} is marked neither "code" nor "as shipped"`);
    const measured = part.measured !== undefined;
    if (measured && kind === "scenario") out.push(`${name} is measured, and only what is seen on screen counts as proof of a scenario (plan §17.0)`);
    else if (measured && part.on !== undefined) out.push(`${name} is both measured and seen`);
    else if (measured && (typeof part.measured !== "string" || part.measured.trim() === "")) out.push(`${name} does not say what is measured`);
    else if (!measured) out.push(...sightingRefusals(name, part.on));
    if (part.wants !== undefined) {
      if (kind === "scenario") out.push(`${name} asks a share, and a scenario's rates are findings with no share (plan §17.0)`);
      else if (part.mark !== "as shipped") out.push(`${name} asks a share, and only an "as shipped" part is a rate`);
      else if (!isRecord(part.wants) || !isWhole(part.wants.of, 1, Number.MAX_SAFE_INTEGER) || !isWhole(part.wants.hits, 1, typeof part.wants.of === "number" ? part.wants.of : 0)) out.push(`${name} asks a share that is not some of so many`);
    }
  });
  return out;
}

function sightingRefusals(name: string, on: unknown): string[] {
  if (!Array.isArray(on) || on.length === 0) return [`${name} names no page it is seen on`];
  const out: string[] = [];
  on.forEach((sighting, index) => {
    if (!isRecord(sighting) || typeof sighting.page !== "string" || pageSlug(sighting.page) === "") {
      out.push(`${name}'s page ${index + 1} has no name`);
      return;
    }
    // A screen is named `<page>-<width>-<part>`: a word of digits in the page would read as the width.
    if (pageSlug(sighting.page).split("-").some((word) => /^\d+$/.test(word))) out.push(`${name}'s page "${sighting.page}" has a word of digits, which a screen's name would read as its width`);
    if (typeof sighting.check !== "function") out.push(`${name} has no check of what must be seen on the ${sighting.page} page`);
  });
  const pages = on.filter(isRecord).map((s) => (typeof s.page === "string" ? pageSlug(s.page) : ""));
  if (new Set(pages).size !== pages.length) out.push(`${name} names a page twice`);
  return out;
}

function isWhole(value: unknown, least: number, most: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= least && value <= most;
}

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim() !== "");
}
