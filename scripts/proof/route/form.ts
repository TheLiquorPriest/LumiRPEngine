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
// A gate is `scripts/proof/<name>/gate.ts` (any depth under `scripts/proof/` but `scenarios/`), whose
// default export is `gate({...})`: an id, the waves it is played at, its parts, a `rig` form where the
// rig can play it, a `live` form, its fixtures and what it needs of the bed. A gate's part may be
// measured instead of seen (the floor's times), judged by its form with `play.judge`. A wave's own
// checkpoint items are a gate kept with the scenarios: `scripts/proof/scenarios/w<n>-checkpoint.ts`,
// id `w<n>`, played at wave n.
//
// "A part that depends on an agent following a shipped file is 'as shipped' even where the row does
// not say so": the mark is the script writer's, and where the plan's row says "as shipped" the check
// holds the clause that follows it to that mark (`check.ts`).
//
// `run.ts check` loads every script to read its form, so a script does nothing when it is loaded:
// everything it does is in its forms and its checks.

import { isRecord } from "../../../src/shared/json";
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
  /** Runs the part's checks now, on every page it is seen on or only on `page`, and keeps the screens. */
  see(part: string, page?: string): Promise<void>;
  /** A measured part's verdict, with what was measured (gates only). */
  judge(part: string, verdict: { pass: boolean; what: string }): Promise<void>;
  /** Supporting evidence (route answers, rows, logs) into the form's `internal/` folder: never proof. */
  keep(name: string, data: Kept): Promise<void>;
}

export type Form<Acts = unknown> = (play: Play<Acts>) => Promise<void>;

export interface ScenarioDef<RigActs = unknown, LiveActs = unknown> {
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
  rig: Form<RigActs>;
  live: Form<LiveActs>;
}

export interface Scenario<RigActs = unknown, LiveActs = unknown> extends ScenarioDef<RigActs, LiveActs> {
  kind: "scenario";
}

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
    if (typeof value.id !== "string" || !GATE_ID.test(value.id)) out.push("it has no id of letters, digits, dots and hyphens");
    if (value.waves === undefined) out.push("it has no waves");
    else if (!Array.isArray(value.waves) || value.waves.length === 0 || !value.waves.every((w) => isWhole(w, 0, 5))) out.push("its waves are not a list of waves 0 to 5");
    else if (new Set(value.waves).size !== value.waves.length) out.push("its waves name a wave twice");
  }
  out.push(...partRefusals(value.parts, kind));
  if (!isTexts(value.fixtures)) out.push("it does not list its fixtures (an empty list when it has none)");
  if (!isTexts(value.bed)) out.push("it does not say what it needs of the bed (an empty list when nothing)");
  if (kind === "scenario" && typeof value.rig !== "function") out.push("it has no rig form");
  if (kind === "gate" && value.rig !== undefined && typeof value.rig !== "function") out.push("its rig form is not a form");
  if (typeof value.live !== "function") out.push("it has no live form");
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
