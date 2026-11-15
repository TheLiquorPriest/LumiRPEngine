// Two kinds of result, kept apart (PlanScenarios-1 item 3; plan §17.0 l.1753): "What code does is
// proved as pass or fail. What the shipped guidance achieves is measured as a rate on the test model:
// how often the agent did what the file asks, with every miss shown."
//
// A part is looked for once or more in every play; each look is an instance. A code part passes only
// if every instance was seen on screen, and fails on any it looked for and did not find, or could not
// look for. An "as shipped" part played live is a rate over its instances: hits and misses, each miss
// listed beside its own screens. A miss of guidance never fails a code part, and an instance the code
// broke (a page that would not open, a play that stopped, a page that shows it at one width and not the
// other) is never counted into a rate: it is listed apart, and it fails the form as the code failure it
// is. In the rig the agent is scripted to follow its file, so an "as shipped" part there proves the
// code path only and is judged as code, never reported as a rate.
//
// A scenario with an "as shipped" part played live is reported as a rate ("the result is reported as a
// rate over repeated runs", §17.4 l.1806), beside the pass or fail of its code parts: never as "passed",
// whatever its rate. A gate's "as shipped" part that carries the plan's share ("in at least 9 of 10")
// stands or falls by it, as the gate's own pass column says.
//
// A scenario played in stages (PlanScenarios-8) is recorded stage by stage, each stage's record beside
// its own screens, and has one result over all of them: no stage's pass stands for another stage.

import type { Mark, Share } from "./form";
import type { Mode } from "./host";

/** One look at one page at one width, as the runner made it. */
export interface Glance {
  page: string;
  /** Pixels for a page, columns for the terminal; null when neither was known. */
  width: number | null;
  /** True: the check saw it; false: it looked and it was not there; null: it could not look. */
  found: boolean | null;
  /** What the check saw or missed, or why it could not look, in plain words. */
  what: string;
  /** The texts the check said show it. */
  shows: string[];
  /** The screen saved, from the form's folder (`play-01/world-1440-four-values.png`); null when none was. */
  screen: string | null;
  /** The SHA-256 of the screen's bytes as saved, so a screen changed afterwards is told apart; null when none was saved. The read-back requires it of every screen. */
  sha256?: string | null;
  /** The page as the saved image named itself. */
  shotPage: string | null;
  /** The text visible in the saved image. */
  shotText: string | null;
  /** Why the screen does not show what the check saw; null when it does, or when nothing was seen. */
  unshown: string | null;
}

/**
 * What came of one instance: `shown` seen and on screen; `absent` looked for and not there; `unseen`
 * seen with no screen that shows it; `broken` could not be looked for (a code failure); `unlooked` the
 * play ended and its form never looked; `met` and `unmet` a measured part's verdict; `trial` a
 * measured part's figure in a run that gives no verdict (its standing, `evidence.ts`); `not judged` a
 * measured part its form said it could not judge, and why.
 */
export type Outcome = "shown" | "absent" | "unseen" | "broken" | "unlooked" | "met" | "unmet" | "trial" | "not judged";

/** The outcomes the runner writes for a part that is seen, and for one that is measured in a play that gives a verdict or is a trial: nothing else is a record of it. A seen part may be "not judged" in a trial play only. */
export const SEEN_OUTCOMES: readonly Outcome[] = ["shown", "absent", "unseen", "broken", "unlooked"];
export function measuredOutcomes(trial: boolean): readonly Outcome[] {
  return trial ? ["trial", "not judged", "broken", "unlooked"] : ["met", "unmet", "not judged", "broken", "unlooked"];
}

export interface Instance {
  play: number;
  /** The how-manyth look at the part in its play, from 1. */
  at: number;
  outcome: Outcome;
  why: string;
  /** For a look never made on a seen part (`unlooked`, or `broken` by a stop), the page it was owed on; null otherwise. */
  page: string | null;
  glances: Glance[];
}

/** A part as a run recorded it. */
export interface PartRecord {
  id: string;
  words: string;
  mark: Mark;
  /** The pages it is seen on; empty for a measured part. */
  pages: string[];
  /** What a measured part measures; null for a part that is seen. */
  measured: string | null;
  wants: Share | null;
  instances: Instance[];
}

/** A play's standing as `result.json` says it: a copy of what `run.json`'s `standing.plays` works out (its one home), so the results file carries the word trial beside the figures. A read-back works it out again and faults a difference. */
export interface PlayStanding {
  play: number;
  is: "verdict" | "trial";
  /** Why a play is a trial: what the run stood on and what its play changed; empty for a verdict. */
  why: string[];
}

/** A scenario or gate as a run recorded it: `result.json` in its folder. */
export interface FormRecord {
  /** The run that made it (`run.json`'s `run`): a record naming another run, or none, is not this run's. */
  run?: string;
  /** The run's nonce (`run.json`'s `nonce`), which no other run has, though two runs may share a name: a record with another's or none is not this run's. */
  nonce?: string;
  /** The scenario's number as two digits, or the gate's id. */
  id: string;
  kind: "scenario" | "gate";
  number: number | null;
  /** The waves it is played at: a scenario's one, a gate's several. */
  waves: number[];
  line: number | null;
  mode: Mode;
  plays: number;
  parts: PartRecord[];
  /** What stopped a play before its form ended, by play. */
  stops: { play: number; why: string }[];
  /** The standing of each play: a play that is a trial gives no verdict on what rests on guidance (`restsOnGuidance`). */
  standings?: PlayStanding[];
  /** For one stage of a scenario played in stages: its name, and the scenario's stages in their order. A scenario played whole, and a gate, have none. */
  stage?: { name: string; of: string[] };
}

/** A part judged as code: on its own as a code part, or as the code path of an "as shipped" part in the rig. */
export interface CodeVerdict {
  kind: "code";
  result: "passed" | "failed" | "not seen" | "not judged" | "not played";
  /** The instances behind a result other than passed. */
  behind: Instance[];
}

/** An "as shipped" part played live. */
export interface RateVerdict {
  kind: "rate";
  hits: number;
  /** Hits and misses: the instances the guidance was judged on. */
  judged: number;
  misses: Instance[];
  /** Code failures and instances not seen on screen, kept out of the rate. */
  apart: Instance[];
  /** Whether the plan's share (a gate's "in at least 9 of 10") was met; null with no share, or too few judged to say. */
  meets: boolean | null;
  wants: Share | null;
}

/**
 * A part a trial gives no verdict on: a gate's measured part, or any "as shipped" part (plan §17: a
 * verdict comes only from shipped guidance on a clean build). Its figures stand, with the word trial:
 * never met or unmet, passed or failed.
 */
export interface TrialVerdict {
  kind: "trial";
  /** For a part seen on screen: the looks that showed it, of those judged (shown and absent). */
  hits: number;
  judged: number;
  misses: Instance[];
  /** A measured part's figures, as its form gave them in each play. */
  figures: Instance[];
  /** Code failures, and looks never seen or never made, kept apart as from a rate. */
  apart: Instance[];
}

export type Verdict = CodeVerdict | RateVerdict | TrialVerdict;

/**
 * Whether a part's verdict rests on guidance, so a trial gives none: every measured part (only a gate
 * has one) and every "as shipped" part played live. In the rig the agent is scripted to follow its
 * file, so a part marked "as shipped" there is its code path and is judged as code, whatever the
 * run's standing (the lead's ruling after PlanScenarios-1-fix2's P1); a measured part marked "as
 * shipped" is judged as code there too, and one marked "code" still gives a figure only in a trial.
 */
export function restsOnGuidance(part: Pick<PartRecord, "measured" | "mark">, mode: Mode): boolean {
  if (part.mark === "as shipped") return mode === "live";
  return part.measured !== null;
}

/** Whether a part's plays were a trial and it rests on guidance: it then has figures and the word trial, and no verdict. */
export function partTrial(record: Pick<FormRecord, "standings" | "mode">, part: PartRecord): boolean {
  if (!restsOnGuidance(part, record.mode)) return false;
  return (record.standings ?? []).some((s) => s.is === "trial" && part.instances.some((i) => i.play === s.play));
}

/** Whether a part is judged as code in this mode: a code part always, an "as shipped" part in the rig. */
export function judgedAsCode(mark: Mark, mode: Mode): boolean {
  return mark === "code" || mode === "rig";
}

/** What one look at a part came to, from its glances: every page it was looked at on, at every width. */
export function outcomeOf(glances: Glance[], mark: Mark, mode: Mode): { outcome: Outcome; why: string } {
  if (glances.length === 0) return { outcome: "unlooked", why: "no look was made" };
  const blind = glances.find((g) => g.found === null);
  if (blind) return { outcome: "broken", why: `could not look on the ${place(blind)}: ${blind.what}` };
  const seen = glances.filter((g) => g.found === true);
  const missed = glances.filter((g) => g.found === false);
  if (missed.length === 0) {
    const unshown = seen.find((g) => g.screen === null || g.unshown !== null);
    if (unshown) return { outcome: "unseen", why: `seen on the ${place(unshown)}, and ${unshown.unshown ?? "no screen was saved"}` };
    return { outcome: "shown", why: seen.map((g) => g.what || `seen on the ${place(g)}`).join("; ") };
  }
  if (seen.length === 0) return { outcome: "absent", why: missed.map((g) => `not on the ${place(g)}: ${g.what}`).join("; ") };
  const split = `seen on the ${seen.map(place).join(", ")}, not on the ${missed.map(place).join(", ")}`;
  // An agent did it if any page shows it; a page that does not is the code's fault, never the guidance's.
  return judgedAsCode(mark, mode) ? { outcome: "absent", why: split } : { outcome: "broken", why: `${split}: a page that does not show what another does is a fault of the code` };
}

function place(glance: Glance): string {
  return glance.width === null ? `${glance.page} page` : `${glance.page} page at ${glance.width}`;
}

export function verdictOf(part: PartRecord, mode: Mode, trial = false): Verdict {
  const of = (...outcomes: Outcome[]) => part.instances.filter((i) => outcomes.includes(i.outcome));
  if (trial && restsOnGuidance(part, mode)) {
    const hits = of("shown").length;
    const misses = of("absent");
    return { kind: "trial", hits, judged: hits + misses.length, misses, figures: of("trial"), apart: of("broken", "unseen", "unlooked", "not judged") };
  }
  if (judgedAsCode(part.mark, mode)) {
    if (part.instances.length === 0) return { kind: "code", result: "not played", behind: [] };
    const failed = of("absent", "broken", "unmet");
    if (failed.length > 0) return { kind: "code", result: "failed", behind: failed };
    const unseen = of("unseen", "unlooked");
    if (unseen.length > 0) return { kind: "code", result: "not seen", behind: unseen };
    const unjudged = of("not judged");
    if (unjudged.length > 0) return { kind: "code", result: "not judged", behind: unjudged };
    return { kind: "code", result: "passed", behind: [] };
  }
  const hits = of("shown", "met").length;
  const misses = of("absent", "unmet");
  const judged = hits + misses.length;
  const wants = part.wants;
  // "At least 9 of 10" is decided once as many were judged as the plan counts, by the same share.
  const meets = wants === null || judged < wants.of ? null : hits * wants.of >= wants.hits * judged;
  return { kind: "rate", hits, judged, misses, apart: of("broken", "unseen", "unlooked", "not judged"), meets, wants };
}

/**
 * A scenario's or gate's own result:
 * - `failed`: a play stopped; a code part (or in the rig an "as shipped" part's code path) failed; an
 *   instance of a rate was broken by the code (kept out of the rate, still a code failure); or a gate's
 *   share was not met.
 * - `not seen`: a code part, or an instance of a rate, was never seen on screen; or too few of a
 *   gate's plays were judged to decide its share.
 * - `measured`: nothing failed and everything was seen, and an "as shipped" part with no share was
 *   played live: its result is its rate, shown with every miss.
 * - `passed`: every code part passed, and every share asked was met.
 * - `not played whole`: for a scenario played in stages, a stage was not played and none failed
 *   (`wholeResult`); one record never has it.
 * - `not judged`: nothing failed or went unseen, and a measured part's form said it could not judge it.
 * - `trial`: nothing failed, went unseen or unjudged, and the run is a trial: what rests on guidance
 *   gave figures and no verdict.
 */
export type FormResult = "passed" | "failed" | "not seen" | "measured" | "not played whole" | "trial" | "not judged";

/** A record's own result; a part that rests on guidance in a play that was a trial gives figures only (`TrialVerdict`), so a record whose every play was a trial is "trial" where its parts rest on guidance. */
export function formResult(record: FormRecord): FormResult {
  const verdicts = record.parts.map((p) => verdictOf(p, record.mode, partTrial(record, p)));
  const code = verdicts.filter((v): v is CodeVerdict => v.kind === "code");
  const rates = verdicts.filter((v): v is RateVerdict => v.kind === "rate");
  const trials = verdicts.filter((v): v is TrialVerdict => v.kind === "trial");
  const apart = [...rates, ...trials].flatMap((v) => v.apart);
  if (record.stops.length > 0 || code.some((v) => v.result === "failed") || apart.some((i) => i.outcome === "broken") || rates.some((v) => v.meets === false)) return "failed";
  if (code.some((v) => v.result === "not seen" || v.result === "not played") || apart.some((i) => i.outcome === "unseen" || i.outcome === "unlooked") || rates.some((v) => v.wants !== null && v.meets === null)) return "not seen";
  if (code.some((v) => v.result === "not judged") || apart.some((i) => i.outcome === "not judged")) return "not judged";
  if (trials.length > 0) return "trial";
  return rates.some((v) => v.wants === null) ? "measured" : "passed";
}

/**
 * A scenario played in stages has one result over all of them, a stage not played being null:
 * `failed` when any stage failed; `not played whole` when any stage was not played; then `not seen`,
 * `trial`, `measured`; `passed` only when every stage was played and passed.
 */
export function wholeResult(stages: (FormResult | null)[]): FormResult {
  if (stages.includes("failed")) return "failed";
  if (stages.some((result) => result === null || result === "not played whole")) return "not played whole";
  for (const result of ["not seen", "not judged", "trial", "measured"] as const) if (stages.includes(result)) return result;
  return "passed";
}

/** A form's result in plain words: a rate is given with its counts, and with every play missed said so. */
export function headline(record: FormRecord): string {
  const result = formResult(record);
  if (result !== "measured") return result;
  const rated = record.parts.flatMap((part) => {
    const verdict = verdictOf(part, record.mode, partTrial(record, part));
    return verdict.kind === "rate" && verdict.wants === null ? [{ part, verdict }] : [];
  });
  const counts = rated.map(({ part, verdict }) => `${rated.length > 1 ? `${part.id} ` : ""}${verdict.hits} of ${verdict.judged}${verdict.hits === 0 && verdict.judged > 0 ? ", every play missed" : ""}`);
  const code = record.parts.some((p) => verdictOf(p, record.mode, partTrial(record, p)).kind === "code") ? "its code passed; " : "";
  return `measured as a rate: ${code}as shipped ${counts.join("; ")}`;
}

/** The screens of an instance, as named in the bundle. */
export function screensOf(instance: Instance): string[] {
  return instance.glances.flatMap((g) => (g.screen === null ? [] : [g.screen]));
}

/**
 * What a part that passed or was met carries beside the word: a measured part's figure in each play it
 * was met, and a seen part's note from its check, once for the plays it was made in. The report prints
 * these; "Passed" alone says nothing of what was measured or noted.
 */
function figureLines(part: PartRecord): string[] {
  const lines: string[] = [];
  const notes = new Map<string, Set<number>>();
  for (const i of part.instances) {
    if (part.measured !== null) {
      if (i.outcome === "met" && i.why.trim() !== "") lines.push(`Met in play ${i.play}${i.at > 1 ? `, look ${i.at}` : ""}: ${i.why}`);
    } else
      for (const g of i.glances)
        if (g.found === true && g.what.trim() !== "") {
          const key = `the ${g.page} page: ${g.what}`;
          notes.set(key, (notes.get(key) ?? new Set<number>()).add(i.play));
        }
  }
  for (const [note, plays] of notes) lines.push(`Seen on ${note} (in ${plays.size === 1 ? "play" : "plays"} ${[...plays].sort((a, b) => a - b).join(", ")})`);
  return lines;
}

/** A part's verdict in plain words, the first line its result and each further line one instance behind it, with its screens; `trial` for a part whose plays were a trial. */
export function describeVerdict(part: PartRecord, mode: Mode, trial = false): string[] {
  const verdict = verdictOf(part, mode, trial);
  const screens = (instance: Instance) => {
    const list = screensOf(instance);
    return list.length === 0 ? "no screen" : list.join(", ");
  };
  const line = (label: string, instance: Instance) => `${label} in play ${instance.play}${instance.at > 1 ? `, look ${instance.at}` : ""}: ${instance.why}. Screens: ${screens(instance)}`;
  if (verdict.kind === "trial") {
    const figures = part.measured === null ? `${mode === "rig" ? "its code path only, " : ""}seen in ${verdict.hits} of ${verdict.judged}${verdict.misses.length > 0 ? ` (${verdict.misses.length} ${verdict.misses.length === 1 ? "miss" : "misses"})` : ""}` : verdict.figures.map((i) => i.why).join("; ") || "no figure";
    const head = `Trial, no verdict: ${figures}${verdict.apart.length > 0 ? `; ${verdict.apart.length} kept apart` : ""}`;
    return [head, ...verdict.misses.map((i) => line("Missed", i)), ...verdict.apart.map((i) => line(i.outcome === "broken" ? "Code failure, kept apart," : i.outcome === "not judged" ? "Not judged, kept apart," : "Not seen, kept apart,", i))];
  }
  if (verdict.kind === "code") {
    if (verdict.result === "not judged") return [`Not judged: ${[...new Set(verdict.behind.map((i) => i.why))].join("; ")}`];
    const head = part.mark === "as shipped" ? `the code path only (the rig plays the agent as its file asks): ${verdict.result}` : verdict.result;
    const behind = verdict.result === "passed" ? figureLines(part) : verdict.behind.map((i) => line(verdict.result === "failed" ? "Failed" : "Not seen", i));
    return [head[0]?.toUpperCase() + head.slice(1), ...behind];
  }
  const share = verdict.wants === null ? "" : verdict.meets === null ? `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}, and too few were judged to say` : verdict.meets ? `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}: met` : `; the plan asks at least ${verdict.wants.hits} of ${verdict.wants.of}: not met`;
  const head = `As shipped: ${verdict.hits} of ${verdict.judged} (${verdict.misses.length} ${verdict.misses.length === 1 ? "miss" : "misses"})${verdict.apart.length > 0 ? `; ${verdict.apart.length} kept out of the rate` : ""}${share}`;
  return [head, ...verdict.misses.map((i) => line("Missed", i)), ...verdict.apart.map((i) => line(i.outcome === "broken" ? "Code failure, kept out of the rate," : i.outcome === "not judged" ? "Not judged, kept out of the rate," : "Not seen, kept out of the rate,", i)), ...figureLines(part)];
}
